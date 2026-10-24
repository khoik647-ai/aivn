'use strict';
// #113 follow-up (N1, N2, N3, N5). Mỗi test đỏ trên 1c1f897, xanh sau bản sửa.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { world, mainSrc } = require('./b10-race-harness');
const { bootRenderer, loadByIdFactory, makeProxy, sleep } = require('./b113-renderer-harness');
const { createApiServer } = require('../src/server');
const PERF = require('../src/perf');
const OM = require('../src/offload-memory');

const UI = 'ui-a';
const JIT = 'jit-m';
const LONG = 'qwen2.5-3b-instruct';
const BASE = 'qwen2.5-3b-base';
const OTHER = 'other-model';
const PREFIX = 'qwen2.5-3b';
const UNKNOWN = 'gpt-4o-mini';

function saverProfile() {
  return PERF.profileFor({ ram: 4 * 1024 ** 3, cpus: 4, mathCores: 2 }, 'saver');
}

// Cùng biểu thức paintPerf gán vào #perfCfg — nhãn người dùng thấy ở chế độ Tiết kiệm.
function renderPerfCfg(p) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes("$('#perfCfg').innerHTML"));
  assert.ok(line, 'không thấy nhãn hiệu năng');
  const start = line.indexOf('`');
  const end = line.lastIndexOf('`');
  assert.ok(start >= 0 && end > start, 'nhãn hiệu năng không phải chuỗi mẫu');
  return new Function('p', 'return ' + line.slice(start, end + 1))(p);
}

function idleSrc() {
  const mark = 'idleUnloadTimer = setInterval(async () => {';
  const i = mainSrc.indexOf(mark);
  const j = mainSrc.indexOf('}, 60000)', i);
  assert.ok(i > 0 && j > i, 'không thấy bộ đếm gỡ khi rảnh');
  return mainSrc.slice(i + 'idleUnloadTimer = setInterval('.length, j + 1);
}

function engineOf(W) {
  return {
    status: () => W.ctx.engine.status(),
    countTokens: (t) => String(t || '').length,
    async generate(m, o = {}) {
      if (o.onToken) o.onToken('hi');
      return { text: 'hi', finishReason: 'stop', toolCalls: [], usage: { completion_tokens: 1 } };
    },
    async chatStep() {
      return { text: 'hi', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 1 } };
    },
  };
}

async function listen(W) {
  const api = createApiServer({
    engine: engineOf(W),
    models: () => W.ctx.listModels(),
    ensureModel: (m, x = {}) => W.ctx.ensureModel(m, { api: true, ...(x || {}) }),
    log: () => {},
    getOpts: () => ({}),
  });
  const port = 18000 + Math.floor(Math.random() * 8000);
  await api.start(port, '127.0.0.1');
  return { api, port };
}

async function post(port, route, model) {
  const isMsg = route === '/v1/messages';
  const body = isMsg
    ? { model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }
    : { model, messages: [{ role: 'user', content: 'hi' }] };
  const r = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text };
}

test('N1: nhãn Tiết kiệm không còn hứa gỡ sau 10 phút', () => {
  const p = saverProfile();
  assert.strictEqual(p.effective, 'saver');
  assert.strictEqual(p.effectiveLabel, 'Tiết kiệm');
  assert.strictEqual(p.idleUnloadMin, 10, 'không đổi thời gian gỡ thật của mức Tiết kiệm');
  const cfg = renderPerfCfg(p);
  const tips = (p.tips || []).join('\n');
  const shown = cfg + '\n' + tips;
  assert.doesNotMatch(shown, /gỡ sau\s*10\s*phút/, 'nhãn vẫn hứa gỡ sau 10 phút:\n' + shown);
  assert.doesNotMatch(shown, /unloads after 10/i);
  assert.match(cfg, /không gỡ mô hình đang chọn/, 'nhãn chưa nói đúng việc mô hình đang chọn không bị gỡ:\n' + cfg);
  assert.match(tips, /không tự gỡ/, 'gợi ý máy yếu vẫn hứa tự gỡ:\n' + tips);
});

test('N2: chọn mô hình trên UI trong lúc chờ perfProfile thì không gỡ', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: UI }, { id: JIT }];
  assert.strictEqual(await W.api(JIT, new AbortController()), 'ok');
  assert.strictEqual(W.loaded, JIT);
  assert.strictEqual(W.ctx.getApiJit() && W.ctx.getApiJit().id, JIT);
  let release;
  const gate = new Promise((r) => { release = r; });
  W.ctx.perfProfile = () => gate;
  W.ctx.api = { status: () => ({ running: false }) };
  W.ctx.lastUse = 0;
  W.ctx.busy = 0;
  const pending = vm.runInContext('(' + idleSrc() + ')()', W.ctx);
  await W.ui(UI);
  assert.strictEqual(W.loaded, UI, 'lần chọn UI chưa nạp xong trước khi xét gỡ');
  release({ idleUnloadMin: 10 });
  await pending;
  assert.strictEqual(W.loaded, UI, 'đã gỡ mô hình vừa chọn trên UI: ' + W.ev.join(' | '));
  assert.deepStrictEqual(W.ev.filter((e) => e.startsWith('UNLOAD')), []);
});

test('N3: tiền tố mơ hồ trả 409 mã riêng, liệt kê id, không bảo gửi lại', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: LONG }, { id: BASE }, { id: OTHER }];
  W.loaded = OTHER;
  const { api, port } = await listen(W);
  try {
    const [chat, messages, unknown] = await Promise.all([
      post(port, '/v1/chat/completions', PREFIX),
      post(port, '/v1/messages', PREFIX),
      post(port, '/v1/chat/completions', UNKNOWN),
    ]);
    for (const [name, res] of [['chat', chat], ['messages', messages]]) {
      assert.strictEqual(res.status, 409, name + ' ' + res.text);
      const err = res.json && res.json.error;
      assert.ok(err, name + ' thiếu error');
      assert.notStrictEqual(err.code, 'model_changed', name + ' vẫn dùng model_changed');
      assert.strictEqual(err.code, 'model_ambiguous', name + ' ' + res.text);
      assert.strictEqual(err.type, 'model_ambiguous', name + ' ' + res.text);
      assert.match(err.message, new RegExp(LONG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(err.message, new RegExp(BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(res.text, /gửi lại|resend/i, name + ' vẫn bảo gửi lại: ' + res.text);
    }
    assert.strictEqual(messages.json.type, 'error');
    assert.strictEqual(unknown.status, 200, 'tên lạ không còn giữ #70: ' + unknown.text);
    assert.notStrictEqual(unknown.status, 404);
    assert.strictEqual(W.loaded, OTHER, 'đã trả lời hoặc gỡ bằng mô hình khác');
  } finally { await api.stop(); }
});

test('N5: bản ghi offload cũ thiếu driver được giữ kèm noteCrash; driver khác thì bỏ', () => {
  const now = 1_700_000_000_000;
  const base = {
    file: '/m/a.gguf', size: 9, mtime: 3, backend: 'vulkan', gpuName: 'RTX 3050 Ti',
    vramTotal: 4e9, settings: 'true|null|null|null',
  };
  const legacy = { ...base, at: now, crash: true, safe: true, gpu: 20, ctx: 4096, oom: true, oomGpu: 30 };
  assert.strictEqual(Object.prototype.hasOwnProperty.call(legacy, 'driver'), false);
  const id = OM.identity({ ...base, driver: '560.94' });
  const recalled = OM.recall(legacy, { ctx: 8192, free: 1e9, identity: id, now: now + 10 });
  assert.strictEqual(recalled.safe, true, 'noteCrash của bản ghi không có driver bị bỏ');
  assert.strictEqual(recalled.capLayers, 20, 'trần lớp của bản ghi cũ bị bỏ');
  const kept = OM.noteCrash(legacy, id, { ctx: 4096, gpu: 20 }, now + 20);
  assert.strictEqual(kept.crash, true);
  assert.strictEqual(kept.oomGpu, 30, 'note() cũ mất khi ghi noteCrash');
  assert.strictEqual(kept.gpu, 20);
  assert.strictEqual(kept.driver, '560.94', 'lần ghi sau chưa điền driver');
  const mismatch = { ...legacy, driver: '111.00' };
  const droppedRecall = OM.recall(mismatch, { ctx: 8192, free: 1e9, identity: id, now: now + 10 });
  assert.strictEqual(droppedRecall.safe, undefined);
  assert.strictEqual(droppedRecall.capLayers, undefined);
  const dropped = OM.noteCrash(mismatch, id, { ctx: 4096, gpu: 8 }, now + 20);
  assert.strictEqual(dropped.oomGpu, undefined, 'driver khác vẫn giữ dữ liệu cũ');
  assert.notStrictEqual(dropped.gpu, 20);
  assert.strictEqual(dropped.driver, '560.94');
});

const MID = 'm';

function msgEl(page, i, content) {
  const box = page.doc.querySelector('#messages');
  const msg = page.doc.createElement('div');
  msg.className = 'msg';
  msg.dataset.i = String(i);
  msg.setAttribute('data-i', String(i));
  const body = page.doc.createElement('div');
  body.className = 'body';
  body.textContent = content;
  msg.appendChild(body);
  box.appendChild(msg);
  return msg;
}

test('M1: đang nạp thì gửi, tạo lại, sửa và agent không bỏ tin; một tin, Dừng/đổi cuộc/đổi mô hình thì huỷ', async () => {
  const page = await bootRenderer();
  const text = 'Trả lời đúng một từ: xin chào';
  const file = { id: 'f1', name: 'a.txt', size: 4, kind: 'text', text: 'aa', ok: true };
  page.state.status = { loaded: false, loading: true, id: MID };
  page.modelStatus = () => ({ loaded: false, loading: true, id: MID });
  page.state.current = { id: 'c1', title: 'c', messages: [], createdAt: 1, updatedAt: 1, mode: 'chat' };
  const first = page.submit(text, [file]);
  await sleep(40);
  assert.strictEqual(page.generates.length, 0, 'đã gửi trong lúc đang nạp');
  assert.strictEqual(page.inputValue(), text, 'ô nhập bị xoá trước khi nạp xong');
  assert.strictEqual(page.pending.length, 1, 'tệp đính kèm bị bỏ');
  assert.strictEqual(page.sendDisabled(), true, 'nút Gửi không khoá');
  assert.match(page.genText(), /Đang nạp/);
  assert.doesNotMatch(page.toasts().join('\n'), /gửi lại/);
  const second = page.submit('tin thứ hai');
  await sleep(20);
  assert.strictEqual(page.inputValue(), text, 'lần gửi thứ hai đã đè tin đang chờ');
  await second;
  page.modelStatus = () => ({ loaded: true, loading: false, id: MID, contextSize: 4096, gpu: false });
  page.pushStatus({ loaded: true, loading: false, id: MID, contextSize: 4096, gpu: false });
  await first;
  assert.strictEqual(page.generates.length, 1, 'không gửi sau khi nạp xong');
  assert.strictEqual(page.generates[0].messages.at(-1).content, text);
  assert.strictEqual(page.loadCalls.length, 0, 'giao diện tự nạp thêm một lần');

  page.state.status = { loaded: false, loading: true, id: MID };
  page.modelStatus = () => ({ loaded: false, loading: true, id: MID });
  page.state.current = { id: 'c1', messages: [{ role: 'user', content: 'cũ' }, { role: 'assistant', content: 'bản cũ', model: MID }], mode: 'chat' };
  msgEl(page, 1, 'bản cũ');
  const regenBtn = { dataset: { mact: 'regen' }, classList: { contains() { return false; } }, closest(sel) { return sel === '[data-mact]' ? this : sel === '.msg' ? { dataset: { i: '1' } } : null; } };
  const regen = (async () => { page.fire('#messages', 'click', regenBtn); })();
  await sleep(40);
  assert.strictEqual(page.state.current.messages[1].content, 'bản cũ', 'tạo lại đã xoá câu trả lời trước khi gửi thật');
  assert.strictEqual(page.generates.length, 1);
  page.fire('#stopBtn', 'click');
  page.modelStatus = () => ({ loaded: true, loading: false, id: MID, contextSize: 4096, gpu: false });
  page.pushStatus({ loaded: true, loading: false, id: MID, contextSize: 4096, gpu: false });
  await regen;
  await sleep(30);
  assert.strictEqual(page.generates.length, 1, 'Dừng không huỷ tin đang chờ');

  page.state.status = { loaded: false, loading: true, id: MID };
  page.modelStatus = () => ({ loaded: false, loading: true, id: MID });
  const edited = page.state.current.messages[0];
  const before = edited.content;
  msgEl(page, 0, before);
  const editBtn = { dataset: { mact: 'edit' }, classList: { contains() { return false; } }, closest(sel) { return sel === '[data-mact]' ? this : sel === '.msg' ? { dataset: { i: '0' } } : null; } };
  page.fire('#messages', 'click', editBtn);
  const ta = page.doc.querySelector('#messages').querySelector('.edit-box');
  assert.ok(ta, 'không mở ô sửa');
  ta.value = 'bản đã sửa';
  const sendEdit = page.doc.querySelector('.edit-acts').querySelector('[data-eact="send"]');
  const editP = (async () => { page.fire(page.doc.querySelector('.edit-acts'), 'click', sendEdit); })();
  await sleep(40);
  assert.strictEqual(edited.content, before, 'sửa đã đổi nội dung trước khi gửi thật');
  page.state.current = { id: 'c2', messages: [], mode: 'chat' };
  page.modelStatus = () => ({ loaded: true, loading: false, id: MID, contextSize: 4096, gpu: false });
  page.pushStatus({ loaded: true, loading: false, id: MID, contextSize: 4096, gpu: false });
  await editP;
  await sleep(30);
  assert.strictEqual(edited.content, before, 'đổi cuộc trò chuyện vẫn gửi bản sửa');
  assert.strictEqual(page.generates.length, 1);

  page.state.mode = 'agent';
  page.state.status = { loaded: false, loading: true, id: MID };
  page.modelStatus = () => ({ loaded: false, loading: true, id: MID });
  page.state.current = { id: 'a1', messages: [], mode: 'agent' };
  const agent = page.submit('việc cho agent');
  await sleep(30);
  assert.strictEqual(page.agentRuns.length, 0);
  page.doc.querySelector('#modelSelect').value = 'other';
  page.fire('#modelSelect', 'change');
  page.modelStatus = () => ({ loaded: true, loading: false, id: MID, contextSize: 4096, gpu: false });
  page.pushStatus({ loaded: true, loading: false, id: MID, contextSize: 4096, gpu: false });
  await agent;
  await sleep(30);
  assert.strictEqual(page.agentRuns.length, 0, 'đổi mô hình vẫn gửi việc agent');
  page.state.mode = 'chat';
});

test('M1: nạp lỗi hoặc hết giờ thì giữ chữ, giữ tệp, hiện lỗi thật, không cộng thêm 180 giây của backend', async () => {
  const page = await bootRenderer({ budgetMs: 80 });
  const file = { id: 'f1', name: 'a.txt', size: 4, kind: 'text', text: 'aa', ok: true };
  page.state.status = { loaded: false, loading: true, id: MID };
  page.modelStatus = () => ({ loaded: false, loading: true, id: MID });
  const hung = page.submit('giữ tôi', [file]);
  const raced = await Promise.race([hung.then(() => 'done', () => 'done'), sleep(500).then(() => 'hung')]);
  assert.strictEqual(raced, 'done', 'hết giờ vẫn chờ thêm ngân sách của backend');
  assert.strictEqual(page.generates.length, 0);
  assert.strictEqual(page.inputValue(), 'giữ tôi');
  assert.strictEqual(page.pending.length, 1);
  assert.match(page.toasts().join('\n'), /Hết thời gian chờ mô hình đang nạp/);

  const page2 = await bootRenderer();
  const err = 'Tệp mô hình bị lỗi — hãy xoá và tải lại.';
  page2.state.status = { loaded: false, loading: true, id: MID };
  page2.modelStatus = () => ({ loaded: false, loading: true, id: MID });
  const file2 = { id: 'f2', name: 'b.txt', size: 3, kind: 'text', text: 'bb', ok: true };
  const failed = page2.submit('đừng mất', [file2]);
  await sleep(30);
  page2.modelStatus = () => ({ loaded: false, loading: false });
  page2.pushStatus({ loaded: false, loading: false, error: err, id: MID });
  await failed;
  assert.strictEqual(page2.generates.length, 0);
  assert.strictEqual(page2.inputValue(), 'đừng mất');
  assert.strictEqual(page2.pending.length, 1, 'nạp lỗi làm mất tệp đính kèm');
  assert.match(page2.toasts().join('\n'), /xoá và tải lại/);
  assert.doesNotMatch(page2.toasts().join('\n'), /gửi lại/);
});

test('M2: 31 ms sau khi bắt đầu nạp, giao diện thấy cờ và vẫn gửi khi nạp xong', async () => {
  const proxy = makeProxy();
  try {
    const sends = [];
    const loadById = loadByIdFactory(proxy, { perfDelay: 120, sends });
    const page = await bootRenderer({ modelStatus: () => proxy.status() });
    page.state.models = [{ id: MID, file: 'm.gguf', size: 20 }];
    page.state.settings.lastModel = MID;
    const loadP = loadById(MID, { force: true, api: true });
    await sleep(31);
    assert.strictEqual(proxy.status().loading, true, '31 ms: engine vẫn báo chưa nạp');
    assert.strictEqual(proxy.status().id, MID);
    const text = 'Trả lời một từ: xin chào';
    const sent = page.submit(text);
    await sleep(20);
    assert.strictEqual(page.generates.length, 0, 'đã gọi generate trong cửa sổ 31 ms');
    assert.strictEqual(page.loadCalls.length, 0, 'giao diện nạp chồng');
    assert.doesNotMatch(page.toasts().join('\n'), /Chưa nạp mô hình nào|gửi lại/);
    assert.strictEqual(page.inputValue(), text);
    const st = await loadP;
    assert.strictEqual(st.loaded, true, st && st.message);
    page.modelStatus = () => proxy.status();
    await sent;
    assert.strictEqual(page.generates.length, 1, page.toasts().join(' | '));
    assert.strictEqual(page.generates[0].messages.at(-1).content, text);
    assert.strictEqual(page.generates[0].messages.at(-1).content.includes('xin chào'), true);
  } finally { await proxy.stop('test xong').catch(() => {}); }
});

test('M2: verifyGguf lỗi và finally của loadModel đều thả đúng lần giữ', async () => {
  const bad = makeProxy();
  try {
    const loadBad = loadByIdFactory(bad, { verify() { const e = new Error('Tệp mô hình bị lỗi — hãy xoá và tải lại.'); e.code = 'BAD_FILE'; throw e; } });
    const err = await loadBad(MID, { force: true, api: true }).catch((e) => e);
    assert.match(err.message, /xoá và tải lại/);
    assert.strictEqual(bad.status().loading, false, 'verifyGguf lỗi nhưng cờ nạp còn kẹt');
  } finally { await bad.stop('test xong').catch(() => {}); }

  const proxy = makeProxy({ failLoad: true });
  try {
    const release = proxy.holdLoading(MID);
    const failed = await proxy.loadModel(MID, '/models/m.gguf', {}).catch((e) => e);
    assert.ok(failed instanceof Error);
    assert.strictEqual(proxy.status().loading, true, 'finally của loadModel xoá lần giữ bên ngoài');
    release();
    assert.strictEqual(proxy.status().loading, false);
  } finally { await proxy.stop('test xong').catch(() => {}); }
});

test('N7: hết VRAM khi nhìn ảnh, 1000 lớp bị kẹp dưới số lớp thật', () => {
  const { visionRetryLayers } = require('../src/engine');
  const n = visionRetryLayers(1000, 32, null, null);
  assert.ok(n < 32, 'lần thử lại vẫn là mọi lớp trên GPU: ' + n);
  assert.ok(n >= 1, String(n));
  assert.notStrictEqual(n, 996);
  assert.notStrictEqual(n, 1000);
  const stepped = visionRetryLayers(20, 32, null, null);
  assert.ok(stepped < 20 && stepped >= 1, String(stepped));
  const fromSure = visionRetryLayers(1000, 32, 32, null);
  assert.ok(fromSure < 32, 'sureLayers vẫn mọi lớp: ' + fromSure);
});
