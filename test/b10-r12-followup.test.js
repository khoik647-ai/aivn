'use strict';
const fs = require('fs');
const os = require('os');
// P1: hộp Ctrl+L, nạp ép, và tự phục hồi không đi qua shareLoad.
// Giữa GPU lỗi và lần thử CPU, engine.status().loading tắt (tối đa ~8 s).
// Người chờ API thoát vòng chờ và nhận 503 dù lần CPU sau đó nạp được.
// P2: chờ đúng id đang nạp (khác mô hình API xin) không có hạn.
// P3: tệp hỏng xin đúng id trả 400; phải 503 như lần nạp lỗi khác.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { world, sleep } = require('./b10-race-harness');
const { createApiServer } = require(path.join(__dirname, '..', 'src', 'server'));

const QWEN = 'qwen2.5-3b-instruct-q4_k_m';
const SMALL = 'qwen2.5-1.5b-instruct-q4_k_m';

function engineOf(W) {
  return {
    status: () => W.ctx.engine.status(),
    countTokens: (t) => String(t).length,
    async generate(m, o = {}) {
      if (o.onToken) o.onToken('hi');
      return { text: 'hi', finishReason: 'stop', toolCalls: [], usage: { completion_tokens: 1 } };
    },
    async chatStep() { return { text: 'hi', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 1 } }; },
  };
}

async function listen(W, seen) {
  const api = createApiServer({
    engine: engineOf(W),
    models: () => W.ctx.listModels(),
    ensureModel: (m, x = {}) => {
      const row = { model: m, signal: !!(x && x.signal), done: false };
      if (seen) seen.push(row);
      return W.ctx.ensureModel(m, { api: true, ...(x || {}) }).finally(() => { row.done = true; });
    },
    log: () => {},
    getOpts: () => ({}),
  });
  const port = 56000 + Math.floor(Math.random() * 8000);
  await api.start(port, '127.0.0.1');
  return { api, port };
}

async function post(port, route, model, extra = {}) {
  const isMsg = route === '/v1/messages';
  const isCmp = route === '/v1/completions';
  const body = isMsg
    ? { model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }
    : isCmp
      ? { model, prompt: 'hi' }
      : { model, messages: [{ role: 'user', content: 'hi' }] };
  try {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: extra.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  } catch (e) {
    return { status: 0, err: e.name, json: null, text: '' };
  }
}

// GPU thất bại → khoảng trống loading=false → CPU nạp xong. Cổng thả lúc test muốn.
function gpuGap(W) {
  let release;
  const gate = new Promise((r) => { release = r; });
  W.releaseGpu = release;
  W.ctx.loadById = async (id, opts = {}) => {
    W.opts.push({ id, force: !!opts.force, reason: opts.reason || null, hasLoad: !!opts.load, ctx: opts.ctx ?? null });
    W.loading = id;
    await gate;
    W.loading = null;
    W.sawGap = true;
    await sleep(300);
    W.loading = id;
    await sleep(20);
    W.loaded = id;
    W.loading = null;
    if (!opts.api) W.settings.data.lastModel = id;
    return W.ctx.engine.status();
  };
}

async function waiterAcrossGap(label, opts) {
  const W = world();
  W.ctx.listModels = () => [{ id: QWEN }];
  gpuGap(W);
  W.ctx.noteUiPick(QWEN);
  const ui = W.ctx.shareLoad(QWEN, opts);
  const seen = [];
  const { api, port } = await listen(W, seen);
  try {
    await sleep(30);
    assert.strictEqual(W.loading, QWEN, label + ' load must be in the GPU attempt');
    const pending = Promise.all([
      post(port, '/v1/chat/completions', 'gpt-4o-mini'),
      post(port, '/v1/messages', 'claude-3-5-sonnet-latest'),
    ]);
    const tEnter = Date.now();
    while (seen.length < 2 && Date.now() - tEnter < 1000) await sleep(10);
    assert.strictEqual(seen.length, 2, label + ' both requests must be inside ensureModel');
    await sleep(40);
    assert.strictEqual(W.loaded, null, label + ' CPU retry has not finished');
    W.releaseGpu();
    const [chat, messages] = await pending;
    console.log('#' + label, JSON.stringify({ chat: chat.status, messages: messages.status, chatBody: chat.json, msgBody: messages.json, loaded: W.loaded, sawGap: W.sawGap, inflight: W.ctx.inflight() }));
    assert.strictEqual(chat.status, 200, JSON.stringify(chat.json));
    assert.strictEqual(messages.status, 200, JSON.stringify(messages.json));
    assert.strictEqual(chat.json.choices[0].message.content, 'hi');
    assert.strictEqual(W.loaded, QWEN, 'CPU retry must be the load that answers');
    assert.strictEqual(W.sawGap, true);
  } finally {
    try { W.releaseGpu(); } catch {}
    await ui.catch(() => {});
    await api.stop();
  }
}

test('P1: Ctrl+L load keeps API waiters across the GPU-to-CPU gap', async () => {
  await waiterAcrossGap('p1-ctrl', { force: true, load: { contextSize: 8192 } });
});

test('P1: force load keeps API waiters across the GPU-to-CPU gap', async () => {
  await waiterAcrossGap('p1-force', { force: true });
});

test('P1: auto-recovery load keeps API waiters across the GPU-to-CPU gap', async () => {
  await waiterAcrossGap('p1-recover', { force: true, ctx: 4096, reason: 'tự phục hồi sau khi bộ máy dừng' });
});

test('P1: status() stays loading across restart until the CPU loadModel finishes', async () => {
  const { createEngineProxy } = require(path.join(__dirname, '..', 'src', 'engine-proxy'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-hold-'));
  const host = path.join(dir, 'host.js');
  fs.writeFileSync(host, [
    "process.send({ type: 'ready', pid: process.pid, node: process.version });",
    "process.on('message', (m) => {",
    "  if (!m || m.id == null) return;",
    "  if (m.method === 'loadModel') process.send({ id: m.id, result: { loaded: true, id: m.args[0] } });",
    "  else process.send({ id: m.id, result: { ok: true } });",
    '});',
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  const p = createEngineProxy({ nodePath: process.execPath, hostScript: host, log: () => {} });
  let watch = null;
  let release = () => {};
  try {
    await p.hardwareInfo();
    release = typeof p.holdLoading === 'function' ? p.holdLoading(QWEN) : () => {};
    let dropped = false;
    watch = setInterval(() => {
      const s = p.status();
      if (!s.loaded && !s.loading) dropped = true;
    }, 10);
    const rst = p.restart({}, 'GPU không nạp được mô hình, chuyển sang chỉ CPU');
    await sleep(40);
    const during = p.status();
    assert.strictEqual(during.loaded, false);
    assert.strictEqual(during.loading, true, 'status().loading dropped during the CPU retry');
    await rst;
    const mid = p.status();
    assert.strictEqual(mid.loaded, false);
    assert.strictEqual(mid.loading, true, 'status().loading dropped after restart, before CPU loadModel');
    assert.strictEqual(dropped, false, 'status() reported not-loading during restart');
    const st = await p.loadModel(QWEN, '/fake/m.gguf', {});
    assert.strictEqual(st.loaded, true);
    assert.strictEqual(st.id, QWEN);
  } finally {
    clearInterval(watch);
    release();
    await p.stop('test xong').catch(() => {});
  }
});

test('P2: waiting for another exact id in flight times out with 504', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: SMALL }, { id: QWEN }];
  W.settings.data.apiLoadWaitMs = 80;
  let release;
  const gate = new Promise((r) => { release = r; });
  W.ctx.loadById = async (id) => {
    W.loading = id;
    await gate;
    W.loaded = id;
    W.loading = null;
    return W.ctx.engine.status();
  };
  W.ctx.noteUiPick(QWEN);
  const ui = W.ctx.shareLoad(QWEN, {});
  const seen = [];
  const { api, port } = await listen(W, seen);
  try {
    await sleep(20);
    assert.strictEqual(W.loading, QWEN);
    const t0 = Date.now();
    const raced = await Promise.race([
      Promise.all([
        post(port, '/v1/chat/completions', SMALL),
        post(port, '/v1/messages', SMALL),
      ]).then((pair) => ({ hung: false, pair })),
      sleep(1000).then(() => ({ hung: true })),
    ]);
    const dt = Date.now() - t0;
    assert.strictEqual(raced.hung, false, 'exact-id wait hung ' + dt + 'ms');
    const [chat, messages] = raced.pair;
    console.log('# p2-timeout', JSON.stringify({ dt, chat: chat.status, messages: messages.status, chatBody: chat.json, msgBody: messages.json }));
    assert.ok(dt < 700, 'exact-id wait took ' + dt + 'ms');
    assert.strictEqual(chat.status, 504, JSON.stringify(chat));
    assert.strictEqual(messages.status, 504, JSON.stringify(messages));
    assert.strictEqual(chat.json.error.type, 'timeout');
    assert.match(chat.json.error.message, /Hết thời gian chờ/);
    assert.strictEqual(messages.json.type, 'error');
    assert.strictEqual(messages.json.error.type, 'timeout');
    assert.match(messages.json.error.message, /Hết thời gian chờ/);
    assert.strictEqual(W.loading, QWEN, 'timeout must not cancel the in-flight load');
  } finally {
    release();
    await ui.catch(() => {});
    await api.stop();
  }
});

test('P2: client disconnect aborts the exact-id in-flight wait', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: SMALL }, { id: QWEN }];
  W.settings.data.apiLoadWaitMs = 60000;
  let release;
  const gate = new Promise((r) => { release = r; });
  W.ctx.loadById = async (id) => {
    W.loading = id;
    await gate;
    W.loaded = id;
    W.loading = null;
    return W.ctx.engine.status();
  };
  W.ctx.noteUiPick(QWEN);
  const ui = W.ctx.shareLoad(QWEN, {});
  const seen = [];
  const { api, port } = await listen(W, seen);
  const acChat = new AbortController();
  const acMsg = new AbortController();
  try {
    await sleep(20);
    const chatP = post(port, '/v1/chat/completions', SMALL, { signal: acChat.signal });
    const msgP = post(port, '/v1/messages', SMALL, { signal: acMsg.signal });
    const tEnter = Date.now();
    while (seen.length < 2 && Date.now() - tEnter < 1000) await sleep(10);
    assert.strictEqual(seen.length, 2);
    assert.ok(seen.every((s) => s.signal), 'exact-id wait must receive an AbortSignal');
    acChat.abort();
    acMsg.abort();
    await sleep(200);
    const settled = seen.filter((s) => s.done);
    console.log('# p2-abort', JSON.stringify({ settled: settled.length, loading: W.loading }));
    assert.strictEqual(settled.length, 2, 'disconnect must stop the exact-id wait');
    assert.strictEqual(W.loading, QWEN);
    await Promise.all([chatP, msgP]);
  } finally {
    release();
    await ui.catch(() => {});
    await api.stop();
  }
});

test('P3: corrupt model requested by exact id is 503, not 400', async () => {
  const W = world();
  W.ctx.listModels = () => [{ id: QWEN }];
  W.ctx.loadById = async () => {
    const e = new Error('Tệp mô hình bị lỗi hoặc tải chưa xong — hãy xoá và tải lại. (đầu tệp không phải GGUF)');
    e.code = 'BAD_FILE';
    throw e;
  };
  const { api, port } = await listen(W);
  try {
    const [chat, messages] = await Promise.all([
      post(port, '/v1/chat/completions', QWEN),
      post(port, '/v1/messages', QWEN),
    ]);
    console.log('# p3', JSON.stringify({ chat: chat.status, messages: messages.status, chatBody: chat.json, msgBody: messages.json }));
    assert.strictEqual(chat.status, 503, JSON.stringify(chat.json));
    assert.match(chat.json.error.message, /xoá/);
    assert.match(chat.json.error.message, /tải lại/);
    assert.doesNotMatch(chat.json.error.message, /chưa có trên máy/);
    assert.notStrictEqual(chat.json.error.type, 'model_not_found');
    assert.strictEqual(messages.status, 503, JSON.stringify(messages.json));
    assert.strictEqual(messages.json.type, 'error');
    assert.match(messages.json.error.message, /xoá/);
    assert.match(messages.json.error.message, /tải lại/);
    assert.doesNotMatch(messages.json.error.message, /chưa có trên máy/);
    assert.notStrictEqual(messages.json.error.type, 'invalid_request_error');
  } finally { await api.stop(); }
});
