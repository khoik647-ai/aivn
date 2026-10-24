'use strict';
// Các kịch bản đối đầu của vòng rà PR #70 (X1–X10, mọi độ trễ X7, X7c).
// X2/X2b tái hiện M1. X7 (độ trễ 0–49) và X7c tái hiện M2.
const test = require('node:test');
const assert = require('node:assert');
const { world, runTtl, sleep, root } = require('./b10-race-harness');
const { createApiServer } = require('../src/server');
const loads = (W) => W.ev.filter((e) => e.startsWith('load-start')).length;
function snap(W, x) { const j = W.ctx.getApiJit(); return { loaded: W.loaded, apiJit: j && j.id, lastModel: W.settings.data.lastModel, loads: loads(W), inflight: W.ctx.inflight(), ev: W.ev.join(' | '), ...x }; }
async function ttl(W) { W.ctx.lastUse = 0; runTtl(W.ctx); await sleep(5); }

test('X1 API waits on B, UI switches to C: UI C wins, not JIT, API not silently C', async () => {
  const W = world(); const ac = new AbortController();
  let apiSawLoaded;
  const pa = W.api('b', ac).then((r) => { apiSawLoaded = W.loaded; return r; });
  await sleep(60); const ui = W.ui('c');
  const r = await pa; await ui; await ttl(W);
  const s = snap(W, { apiResult: r, apiSawLoaded });
  console.log('X1', JSON.stringify(s));
  assert.strictEqual(s.loaded, 'c'); assert.strictEqual(s.apiJit, null); assert.strictEqual(s.lastModel, 'c'); assert.strictEqual(s.inflight, 0);
});

test('X2 rapid UI picks B, C, B: last pick (B) wins', async () => {
  const W = world();
  const p1 = W.ui('b'); await sleep(10); const p2 = W.ui('c'); await sleep(10); const p3 = W.ui('b');
  const rs = await Promise.allSettled([p1, p2, p3]);
  await sleep(10);
  const s = snap(W, { r3: rs[2].value && rs[2].value.id });
  console.log('X2', JSON.stringify(s));
  assert.strictEqual(s.loaded, 'b', 'last UI pick lost'); assert.strictEqual(s.lastModel, 'b');
});

test('X2b rapid UI picks B, C, B with load already started', async () => {
  const W = world();
  const p1 = W.ui('b'); await sleep(80); const p2 = W.ui('c'); await sleep(10); const p3 = W.ui('b');
  await Promise.allSettled([p1, p2, p3]); await sleep(10);
  const s = snap(W); console.log('X2b', JSON.stringify(s));
  assert.strictEqual(s.loaded, 'b', 'last UI pick lost'); assert.strictEqual(s.lastModel, 'b');
});

test('X3 API A and UI B concurrently: UI B wins and stays', async () => {
  const W = world(); const ac = new AbortController();
  const pa = W.api('a', ac); const ui = W.ui('b');
  const r = await pa; await ui; await sleep(10); await ttl(W);
  const s = snap(W, { apiResult: r }); console.log('X3', JSON.stringify(s));
  assert.strictEqual(s.loaded, 'b'); assert.strictEqual(s.lastModel, 'b'); assert.strictEqual(s.apiJit, null);
});

test('X3b UI B then API A immediately', async () => {
  const W = world(); const ac = new AbortController();
  const ui = W.ui('b'); await sleep(5); const pa = W.api('a', ac);
  const r = await pa; await ui; await sleep(10); await ttl(W);
  const s = snap(W, { apiResult: r }); console.log('X3b', JSON.stringify(s));
  assert.strictEqual(s.lastModel, 'b');
});

test('X4 shared load failure reaches both, no leak, retry reloads', async () => {
  const W = world(); W.fail = 'boom'; const ac = new AbortController();
  const pa = W.api('b', ac); await sleep(30); const ui = W.ui('b').then(() => 'ok', (e) => 'ERR ' + e.message);
  const [ra, ru] = await Promise.all([pa, ui]);
  const s = snap(W, { ra, ru }); console.log('X4', JSON.stringify(s));
  assert.match(ra, /boom/); assert.match(ru, /boom/); assert.strictEqual(s.inflight, 0); assert.strictEqual(s.apiJit, null);
  const r2 = await W.api('b', new AbortController());
  console.log('X4 retry', r2, JSON.stringify(snap(W)));
  assert.strictEqual(r2, 'ok'); assert.strictEqual(W.loaded, 'b'); assert.strictEqual(loads(W), 2);
});

test('X5 API abort during shared load with UI B: B kept, not JIT', async () => {
  const W = world(); const ac = new AbortController();
  const pa = W.api('b', ac); await sleep(30); const ui = W.ui('b'); await sleep(30); ac.abort();
  await Promise.all([pa, ui]); await ttl(W);
  const s = snap(W); console.log('X5', JSON.stringify(s));
  assert.strictEqual(s.loaded, 'b'); assert.strictEqual(s.apiJit, null); assert.strictEqual(s.lastModel, 'b'); assert.strictEqual(s.loads, 1);
});

test('X5b API abort during own load (no UI): unloaded, no leak', async () => {
  const W = world(); const ac = new AbortController();
  const pa = W.api('b', ac); await sleep(30); ac.abort(); await pa; await sleep(10);
  const s = snap(W); console.log('X5b', JSON.stringify(s));
  assert.strictEqual(s.loaded, null); assert.strictEqual(s.inflight, 0);
});

test('X6 TTL cleared when UI picks the JIT-loaded model', async () => {
  const W = world();
  assert.strictEqual(await W.api('b', new AbortController()), 'ok');
  const before = snap(W).apiJit; await W.ui('b'); await ttl(W);
  const s = snap(W, { before }); console.log('X6', JSON.stringify(s));
  assert.strictEqual(before, 'b'); assert.strictEqual(s.apiJit, null); assert.strictEqual(s.loaded, 'b');
});

test('X7 UI B first, API B joins: not JIT, one load', async () => {
  const W = world();
  const ui = W.ui('b'); await sleep(30); const pa = W.api('b', new AbortController());
  const r = await pa; await ui; await ttl(W);
  const s = snap(W, { r }); console.log('X7', JSON.stringify(s));
  assert.strictEqual(s.loaded, 'b'); assert.strictEqual(s.apiJit, null); assert.strictEqual(s.loads, 1);
});

for (const d of [0, 10, 30, 49, 55, 100]) test('X7 delay ' + d, async () => {
  const W = world(); const ui = W.ui('b'); await sleep(d); const r = await W.api('b', new AbortController()); await ui;
  const j = W.ctx.getApiJit(); const jit = j && j.id; W.ctx.lastUse = 0; runTtl(W.ctx); await sleep(5);
  console.log('d=' + d, JSON.stringify({ r, jitAfterLoad: jit, loaded: W.loaded, ev: W.ev.join('|') }));
  assert.strictEqual(W.loaded, 'b');
});

test('X7c UI B, API B joins in pre-phase, API aborts', async () => {
  const W = world(); const ui = W.ui('b'); await sleep(10); const ac = new AbortController(); const pa = W.api('b', ac); await sleep(100); ac.abort();
  await Promise.all([pa, ui]); await sleep(10);
  console.log('X7c', JSON.stringify({ loaded: W.loaded, ev: W.ev.join('|'), last: W.settings.data.lastModel }));
  assert.strictEqual(W.loaded, 'b');
});

test('X8 Ctrl+L load options do not join a plain in-flight load', async () => {
  const W = world(); W.dropOnOverlap = true;
  const pa = W.api('b', new AbortController()); await sleep(60);
  W.ctx.noteUiPick('b'); const ui = W.ctx.shareLoad('b', { load: { contextSize: 8192 } });
  const r = await pa; const apiSaw = W.loaded; await ui; await ttl(W);
  const s = snap(W, { r, apiSaw }); console.log('X8', JSON.stringify(s));
  // Hộp nạp (Ctrl+L) mang lựa chọn ngữ cảnh/GPU riêng nên không gom vào lần nạp thường.
  assert.strictEqual(s.loads, 2);
  assert.strictEqual(s.loaded, 'b');
  assert.strictEqual(s.apiJit, null);
  assert.strictEqual(s.lastModel, 'b');
});

test('X9 two API B + UI B, one API aborts', async () => {
  const W = world(); const a1 = new AbortController(), a2 = new AbortController();
  const p1 = W.api('b', a1); await sleep(10); const p2 = W.api('b', a2); await sleep(10); const ui = W.ui('b'); await sleep(20); a1.abort();
  const rs = await Promise.all([p1, p2, ui]); await ttl(W);
  const s = snap(W, { r2: rs[1] }); console.log('X9', JSON.stringify(s));
  assert.strictEqual(s.loaded, 'b'); assert.strictEqual(s.apiJit, null); assert.strictEqual(s.loads, 1);
});

test('X10 UI picks C while API B load already complete-but-not-returned (microtask window)', async () => {
  const W = world();
  const pa = W.api('b', new AbortController());
  await sleep(255); const ui = W.ui('c');
  const r = await pa; await ui; await ttl(W);
  const s = snap(W, { r }); console.log('X10', JSON.stringify(s));
  assert.strictEqual(s.loaded, 'c'); assert.strictEqual(s.lastModel, 'c');
});

test('N2 chat and completions return 409 when the loaded model changed during ensureModel', async () => {
  let id = 'b';
  let generated = 0;
  const engine = {
    status: () => ({ loaded: true, id }),
    async generate() { generated += 1; return { text: 'từ ' + id, finishReason: 'stop', usage: { completion_tokens: 1 } }; },
    countTokens: (t) => String(t).length,
  };
  const api = createApiServer({
    engine,
    models: () => [{ id: 'b', mtime: 1 }, { id: 'c', mtime: 1 }],
    ensureModel: async () => { id = 'c'; },
    log: () => {},
  });
  const port = 23000 + Math.floor(Math.random() * 8000);
  await api.start(port, '127.0.0.1');
  try {
    const chat = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'b', messages: [{ role: 'user', content: 'xin chào' }] }),
    });
    const chatBody = await chat.json();
    assert.strictEqual(chat.status, 409);
    assert.match(chatBody.error.message, /không trả lời bằng mô hình khác/);
    assert.notStrictEqual(chatBody.error.type, 'server_error');
    id = 'b';
    const cmp = await fetch(`http://127.0.0.1:${port}/v1/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'b', prompt: 'xin chào' }),
    });
    const cmpBody = await cmp.json();
    assert.strictEqual(cmp.status, 409);
    assert.match(cmpBody.error.message, /không trả lời bằng mô hình khác/);
    assert.strictEqual(generated, 0);
  } finally { await api.stop(); }
});

test('N2 /v1/messages returns 409 instead of answering with the other model', async () => {
  let id = 'b';
  let generated = 0;
  const engine = {
    status: () => ({ loaded: true, id }),
    async generate() { generated += 1; return { text: 'từ ' + id, finishReason: 'stop', toolCalls: [], usage: { completion_tokens: 1 } }; },
    countTokens: (t) => String(t).length,
  };
  const api = createApiServer({
    engine,
    models: () => [{ id: 'b', mtime: 1 }],
    ensureModel: async () => { id = 'c'; },
    log: () => {},
  });
  const port = 24000 + Math.floor(Math.random() * 8000);
  await api.start(port, '127.0.0.1');
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'b', max_tokens: 16, messages: [{ role: 'user', content: 'xin chào' }] }),
    });
    const body = await r.json();
    assert.strictEqual(r.status, 409);
    assert.match(body.error.message, /không trả lời bằng mô hình khác/);
    assert.notStrictEqual(body.error.type, 'api_error');
    assert.strictEqual(generated, 0);
  } finally { await api.stop(); }
});

test('N4 exclusiveLoad runs waiting loads one at a time', async () => {
  const { exclusiveLoad } = require(require('path').join(root, 'src', 'engine'));
  let active = 0; let max = 0; const order = [];
  const one = (name, ms) => exclusiveLoad(async () => {
    active += 1; max = Math.max(max, active); order.push('start ' + name);
    await sleep(ms);
    order.push('end ' + name);
    active -= 1;
  });
  await Promise.all([one('a', 40), one('b', 20), one('c', 10)]);
  assert.strictEqual(max, 1);
  assert.deepStrictEqual(order, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
});
