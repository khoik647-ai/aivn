'use strict';
// #113 follow-up (N1, N2, N3, N5). Mỗi test đỏ trên 1c1f897, xanh sau bản sửa.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { world, mainSrc } = require('./b10-race-harness');
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
