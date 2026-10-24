'use strict';
// B20: TTL chỉ gỡ mô hình JIT, khớp tên không còn tiền tố mơ hồ / đường dẫn,
// #110 N1 DeviceLost, N2 khoá driver, N3 tệp hỏng, N4 giữ generate lúc restart CPU.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { world, runTtl, sleep, mainSrc } = require('./b10-race-harness');
const { createApiServer } = require('../src/server');
const { resolveModel } = require('../src/model-ref');
const LF = require('../src/load-fail');
const OM = require('../src/offload-memory');

const UI = 'qwen2.5-3b';
const LONG = 'qwen2.5-3b-instruct';
const BASE = 'qwen2.5-3b-base';
const OTHER = 'other-model';
const PATH_ID = 'D:\\models\\qwen2.5-3b-instruct';
const PATH_REQ = 'D:\\models\\qwen2.5-3b';
const BAD_FILE_MSG = 'Tệp mô hình bị hỏng hoặc tải chưa xong. Hãy xoá mô hình này và tải lại.';
const SHADOW = (have) => `Mô hình đã đổi trong lúc nạp (${have}). Yêu cầu này không trả lời bằng mô hình khác. Hãy gửi lại.`;
const LOAD_FAIL = 'Nạp mô hình không thành công. Hãy thử lại.';
const UNKNOWN = ['gpt-4o-mini', 'claude-3-5-sonnet-latest', 'claude-sonnet-4-20250514'];

function runIdle(ctx) {
  ctx.perfProfile = async () => ({ idleUnloadMin: 5 });
  ctx.api = { status: () => ({ running: false }) };
  ctx.lastUse = 0;
  ctx.busy = 0;
  const mark = 'idleUnloadTimer = setInterval(async () => {';
  const i = mainSrc.indexOf(mark);
  const j = mainSrc.indexOf('}, 60000)', i);
  assert.ok(i > 0 && j > i, 'không thấy bộ đếm gỡ khi rảnh');
  const body = mainSrc.slice(i + 'idleUnloadTimer = setInterval('.length, j + 1);
  return vm.runInContext('(' + body + ')()', ctx);
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

function stableChat(j) {
  const c = j && j.choices && j.choices[0];
  return {
    object: j && j.object,
    model: j && j.model,
    role: c && c.message && c.message.role,
    content: c && c.message && c.message.content,
    finish_reason: c && c.finish_reason,
    usage: j && j.usage,
  };
}

function stableMsg(j) {
  const block = j && j.content && j.content[0];
  return {
    type: j && j.type,
    role: j && j.role,
    model: j && j.model,
    text: block && block.text,
    blockType: block && block.type,
    stop_reason: j && j.stop_reason,
    stop_sequence: j && j.stop_sequence,
    usage: j && j.usage,
  };
}

function offloadIdentityFromMain(h, m) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const start = src.indexOf('function offloadIdentity(');
  const end = src.indexOf('async function noteOffload');
  const body = src.slice(start, end);
  const settings = { data: { gpu: true, gpuDevice: null, gpuLayers: null, vramLimitGB: null } };
  const fn = new Function('OM', 'settings', body + '\nreturn offloadIdentity;');
  return fn(OM, settings)(m, h);
}

function proxyHost() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b20-proxy-'));
  const host = path.join(dir, 'host.js');
  fs.writeFileSync(host, [
    "process.send({ type: 'ready', pid: process.pid, node: process.version });",
    'let loaded = false;',
    "process.on('message', (m) => {",
    "  if (!m || m.type === 'abort' || m.id == null) return;",
    "  if (m.method === 'loadModel') { loaded = true; process.send({ id: m.id, result: { loaded: true, id: m.args[0] } }); return; }",
    "  if (m.method === 'generate' || m.method === 'chatStep') {",
    "    if (!loaded) process.send({ id: m.id, error: 'Chưa nạp mô hình nào.' });",
    "    else process.send({ id: m.id, result: { text: 'xin chào', thought: null, finishReason: 'stop', stopReason: 'stop', toolCalls: [], usage: { completion_tokens: 2 } } });",
    '    return;',
    '  }',
    "  process.send({ id: m.id, result: null });",
    '});',
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  return host;
}

test('TTL: mô hình chọn trên UI không bị gỡ sau khi hết hạn rảnh', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: UI }, { id: LONG }];
  await W.ui(UI);
  assert.strictEqual(W.loaded, UI);
  assert.strictEqual(W.ctx.getApiJit(), null);
  await runIdle(W.ctx);
  assert.strictEqual(W.loaded, UI, 'mô hình UI bị gỡ: ' + W.ev.join(' | '));
});

test('TTL: Ctrl+L không bị gỡ sau khi hết hạn rảnh', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: UI }];
  W.ctx.noteUiPick(UI);
  await W.ctx.shareLoad(UI, { force: true, load: { contextSize: 8192 } });
  assert.strictEqual(W.loaded, UI);
  assert.strictEqual(W.ctx.getApiJit(), null);
  await runIdle(W.ctx);
  assert.strictEqual(W.loaded, UI, 'Ctrl+L bị gỡ: ' + W.ev.join(' | '));
});

test('TTL: mô hình JIT bị gỡ sau khi hết hạn', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: UI }, { id: LONG }];
  assert.strictEqual(await W.api(LONG, new AbortController()), 'ok');
  assert.strictEqual(W.ctx.getApiJit() && W.ctx.getApiJit().id, LONG);
  W.ctx.lastUse = 0;
  W.settings.data.apiTtlMin = 5;
  runTtl(W.ctx);
  await sleep(20);
  assert.strictEqual(W.loaded, null, 'JIT không bị TTL gỡ: ' + W.ev.join(' | '));
});

test('TTL: UI chọn lại đúng mô hình JIT thì không còn bị gỡ', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: LONG }];
  assert.strictEqual(await W.api(LONG, new AbortController()), 'ok');
  assert.ok(W.ctx.getApiJit());
  await W.ui(LONG);
  assert.strictEqual(W.ctx.getApiJit(), null);
  assert.strictEqual(W.loaded, LONG);
  await runIdle(W.ctx);
  assert.strictEqual(W.loaded, LONG, 'UI nhận mô hình JIT rồi vẫn bị gỡ: ' + W.ev.join(' | '));
});

test('khớp đúng id ngắn, không lấy bản instruct dài hơn', () => {
  const rows = [{ id: UI, file: UI + '.gguf' }, { id: LONG, file: LONG + '.gguf' }];
  assert.strictEqual(resolveModel(rows, UI).id, UI);
  assert.strictEqual(resolveModel(rows, UI + '.gguf').id, UI);
  assert.strictEqual(resolveModel(rows, 'Qwen2.5-3B.GGUF').id, UI);
  assert.strictEqual(resolveModel(rows, LONG).id, LONG);
  assert.strictEqual(resolveModel([{ id: LONG, file: LONG + '.gguf' }], '3b-instruct'), null);
  assert.strictEqual(resolveModel([{ id: LONG, path: PATH_ID + '.gguf', file: LONG + '.gguf' }], UI).id, LONG);
});

test('id dạng đường dẫn không khớp theo tiền tố', () => {
  const rows = [{ id: PATH_ID, file: LONG + '.gguf', path: PATH_ID + '.gguf' }];
  assert.strictEqual(resolveModel(rows, PATH_REQ), null);
  assert.strictEqual(resolveModel(rows, PATH_ID).id, PATH_ID);
  assert.strictEqual(resolveModel([{ id: LONG, path: '/models/' + LONG + '.gguf' }], '/models/qwen2.5-3b'), null);
});

test('tiền tố đúng một mô hình vẫn khớp; hai tiền tố thì HTTP 409', async () => {
  const one = [{ id: LONG, file: LONG + '.gguf' }, { id: OTHER, file: OTHER + '.gguf' }];
  assert.strictEqual(resolveModel(one, UI).id, LONG);
  const W = world();
  W.ctx.listModels = () => [{ id: LONG }, { id: BASE }, { id: OTHER }];
  const { api, port } = await listen(W);
  try {
    const [chat, messages] = await Promise.all([
      post(port, '/v1/chat/completions', UI),
      post(port, '/v1/messages', UI),
    ]);
    assert.strictEqual(chat.status, 409, JSON.stringify(chat.json));
    assert.strictEqual(messages.status, 409, JSON.stringify(messages.json));
    assert.strictEqual(chat.json.error.message, SHADOW('chưa có mô hình'));
    assert.strictEqual(chat.json.error.type, 'model_changed');
    assert.strictEqual(messages.json.error.message, SHADOW('chưa có mô hình'));
    assert.strictEqual(messages.json.error.type, 'invalid_request_error');
    assert.strictEqual(W.loaded, null);
  } finally { await api.stop(); }
});

test('tiền tố mơ hồ khi đang có mô hình khác vẫn 409, không trả lời bằng mô hình đó', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: LONG }, { id: BASE }, { id: OTHER }];
  W.loaded = OTHER;
  const { api, port } = await listen(W);
  try {
    const [chat, messages] = await Promise.all([
      post(port, '/v1/chat/completions', UI),
      post(port, '/v1/messages', UI),
    ]);
    assert.strictEqual(chat.status, 409, JSON.stringify(chat.json));
    assert.strictEqual(messages.status, 409, JSON.stringify(messages.json));
    assert.strictEqual(chat.json.error.message, SHADOW(OTHER));
    assert.strictEqual(chat.json.error.type, 'model_changed');
    assert.strictEqual(messages.json.error.message, SHADOW(OTHER));
    assert.strictEqual(W.loaded, OTHER);
  } finally { await api.stop(); }
});

test('tên là đường dẫn không nạp mô hình theo tiền tố', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: PATH_ID, file: LONG + '.gguf' }, { id: LONG, file: LONG + '.gguf' }];
  const { api, port } = await listen(W);
  try {
    const [chat, messages] = await Promise.all([
      post(port, '/v1/chat/completions', PATH_REQ),
      post(port, '/v1/messages', PATH_REQ),
    ]);
    assert.strictEqual(chat.status, 400, JSON.stringify(chat.json));
    assert.strictEqual(messages.status, 404, JSON.stringify(messages.json));
    assert.match(chat.json.error.message, /chưa có trên máy/);
    assert.match(messages.json.error.message, /chưa có trên máy/);
    assert.strictEqual(W.loaded, null, 'đã nạp theo tiền tố đường dẫn: ' + W.loaded);
  } finally { await api.stop(); }
});

test('tên lạ giữ đúng trạng thái #70 trên chat và messages', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: LONG }, { id: UI }];
  W.loaded = LONG;
  const chatExpect = {
    object: 'chat.completion', model: LONG, role: 'assistant', content: 'hi', finish_reason: 'stop',
    usage: { prompt_tokens: 6, completion_tokens: 1, total_tokens: 7 },
  };
  const msgExpect = {
    type: 'message', role: 'assistant', model: LONG, text: 'hi', blockType: 'text',
    stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 6, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
  const { api, port } = await listen(W);
  try {
    for (const name of UNKNOWN) {
      const [chat, messages] = await Promise.all([
        post(port, '/v1/chat/completions', name),
        post(port, '/v1/messages', name),
      ]);
      assert.strictEqual(chat.status, 200, name + ' ' + JSON.stringify(chat.json));
      assert.strictEqual(messages.status, 200, name + ' ' + JSON.stringify(messages.json));
      assert.deepStrictEqual(stableChat(chat.json), chatExpect, name);
      assert.deepStrictEqual(stableMsg(messages.json), msgExpect, name);
      assert.strictEqual(W.loaded, LONG);
    }
  } finally { await api.stop(); }
});

test('N1: DeviceLost lúc tạo ngữ cảnh ghi gpu=false; hết VRAM thì không', () => {
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [{ mode: 'gpu', message: 'vk::DeviceLostError', context: true }] }), true);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [{ mode: 'gpu', message: 'VK_ERROR_DEVICE_LOST', context: true }] }), true);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [{ mode: 'gpu', message: 'invalid device', context: true }] }), true);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: false, attempts: [{ message: 'vk::DeviceLostError', context: true }] }), false);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [{ message: 'out of memory', context: true }] }), false);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [{ message: 'cudaMalloc failed', context: true }] }), false);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [{ message: 'VK_ERROR_OUT_OF_DEVICE_MEMORY', context: true }] }), false);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [] }), false);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [{ message: 'out of memory' }] }), true);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [{ message: 'chậm: 4 token/giây', slow: true }] }), false);
});

test('N2: driver khác thì bỏ trí nhớ offload, driver trùng thì giữ', () => {
  const now = 1_700_000_000_000;
  const base = { file: '/m/a.gguf', size: 9, mtime: 3, backend: 'vulkan', gpuName: 'RTX 3050 Ti', vramTotal: 4e9, settings: 'true|null|null|null' };
  const idA = OM.identity({ ...base, driver: '560.94' });
  const idB = OM.identity({ ...base, driver: '561.09' });
  let rec = OM.note(null, { gpu: 20, totalLayers: 37, ctx: 8192, oom: true, oomGpu: 30, freeAt: 1e9 }, idA, now);
  assert.strictEqual(rec.driver, '560.94');
  const hit = OM.recall(rec, { ctx: 8192, free: 1e9, identity: idA, now });
  const miss = OM.recall(rec, { ctx: 8192, free: 1e9, identity: idB, now });
  assert.strictEqual(hit.capLayers, 20);
  assert.strictEqual(miss.capLayers, undefined);
});

test('N2: offloadIdentity ghi khoá driver mà phần cứng báo', () => {
  const id = offloadIdentityFromMain(
    { gpu: 'vulkan', gpuName: 'RTX 3050 Ti', vram: { total: 4e9 }, driver: '560.94|Vulkan1' },
    { path: '/m/a.gguf', size: 9, mtime: 3 },
  );
  assert.strictEqual(id.driver, '560.94|Vulkan1');
});

test('N2: khoá driver lấy phiên bản hoặc id thiết bị mà bộ máy báo', async () => {
  const eng = require('../src/engine');
  assert.strictEqual(typeof eng.gpuDriverKey, 'function');
  const both = await eng.gpuDriverKey({
    getGpuDriverVersion: async () => '560.94',
    getGpuDevices: async () => [{ id: 'Vulkan1', name: 'RTX 3050 Ti' }],
  });
  assert.strictEqual(both, '560.94|Vulkan1');
  const fromField = await eng.gpuDriverKey({ gpuDriver: '32.0.15.6094' });
  assert.strictEqual(fromField, '32.0.15.6094');
});

test('N3: tệp hỏng trả 503 và bảo xoá rồi tải lại', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: LONG }];
  W.ctx.loadById = async () => {
    const e = new Error('Tệp mô hình bị lỗi hoặc tải chưa xong — hãy xoá và tải lại. (đầu tệp không phải GGUF)');
    e.code = 'BAD_FILE';
    throw e;
  };
  const { api, port } = await listen(W);
  try {
    const [chat, messages] = await Promise.all([
      post(port, '/v1/chat/completions', LONG),
      post(port, '/v1/messages', LONG),
    ]);
    assert.strictEqual(chat.status, 503, JSON.stringify(chat.json));
    assert.strictEqual(messages.status, 503, JSON.stringify(messages.json));
    assert.strictEqual(chat.json.error.message, BAD_FILE_MSG);
    assert.strictEqual(chat.json.error.type, 'api_error');
    assert.strictEqual(messages.json.type, 'error');
    assert.strictEqual(messages.json.error.type, 'api_error');
    assert.strictEqual(messages.json.error.message, BAD_FILE_MSG);
  } finally { await api.stop(); }
});

test('N4: generate từ UI trong lúc restart CPU được giữ đến khi nạp xong', async () => {
  const { createEngineProxy } = require('../src/engine-proxy');
  const host = proxyHost();
  const p = createEngineProxy({ nodePath: process.execPath, hostScript: host, log: () => {}, loadWaitMs: 180000 });
  const release = p.holdLoading(LONG);
  const t0 = Date.now();
  const pending = p.generate([{ role: 'user', content: 'hi' }], {}).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
  await sleep(300);
  try {
    await p.loadModel(LONG, '/fake/m.gguf', {});
    const out = await pending;
    assert.strictEqual(out.ok, true, out.e && out.e.message);
    assert.strictEqual(out.r.text, 'xin chào');
    assert.ok(Date.now() - t0 >= 250, 'generate không chờ, mất ' + (Date.now() - t0) + ' ms');
  } finally {
    release();
    await p.stop('test xong').catch(() => {});
  }
});

test('N4: hết 3 phút chờ lúc restart thì báo nạp không thành công, không phải Chưa nạp', async () => {
  const { createEngineProxy } = require('../src/engine-proxy');
  const host = proxyHost();
  const p = createEngineProxy({ nodePath: process.execPath, hostScript: host, log: () => {}, loadWaitMs: 80 });
  const release = p.holdLoading(LONG);
  const t0 = Date.now();
  try {
    const err = await p.generate([{ role: 'user', content: 'hi' }], {}).then(() => null, (e) => e);
    const dt = Date.now() - t0;
    assert.ok(err instanceof Error, 'generate trả lời trong lúc vẫn đang restart');
    assert.match(err.message, /Nạp mô hình không thành công/);
    assert.doesNotMatch(err.message, /Chưa nạp/);
    assert.strictEqual(err.message, LOAD_FAIL);
    assert.ok(dt >= 60, 'không chờ, mất ' + dt + ' ms');
  } finally {
    release();
    await p.stop('test xong').catch(() => {});
  }
});

test('N4: ngắt generate trong lúc chờ restart trả abort', async () => {
  const { createEngineProxy } = require('../src/engine-proxy');
  const host = proxyHost();
  const p = createEngineProxy({ nodePath: process.execPath, hostScript: host, log: () => {}, loadWaitMs: 180000 });
  const release = p.holdLoading(LONG);
  const ac = new AbortController();
  const t0 = Date.now();
  const pending = p.generate([{ role: 'user', content: 'hi' }], { signal: ac.signal }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
  await sleep(40);
  ac.abort();
  try {
    const out = await pending;
    assert.strictEqual(out.ok, true, out.e && out.e.message);
    assert.strictEqual(out.r.finishReason, 'abort');
    assert.ok(Date.now() - t0 < 1500, 'abort không cắt chờ');
  } finally {
    release();
    await p.stop('test xong').catch(() => {});
  }
});

test('N4: không đang nạp thì generate vẫn báo Chưa nạp ngay', async () => {
  const { createEngineProxy } = require('../src/engine-proxy');
  const host = proxyHost();
  const p = createEngineProxy({ nodePath: process.execPath, hostScript: host, log: () => {}, loadWaitMs: 180000 });
  const t0 = Date.now();
  try {
    const err = await p.generate([{ role: 'user', content: 'hi' }], {}).then(() => null, (e) => e);
    assert.ok(err instanceof Error);
    assert.match(err.message, /Chưa nạp/);
    assert.ok(Date.now() - t0 < 1500);
  } finally {
    await p.stop('test xong').catch(() => {});
  }
});
