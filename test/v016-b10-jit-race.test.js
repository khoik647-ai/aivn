'use strict';
// B10: ensureModel thật + jit-load thật, chỉ loadById được thay. Các kịch bản S1–S14
// là bản chạy được của harness jit-race (UI chọn mô hình đi qua noteUiPick, như IPC models:load).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createJitGuard } = require('../src/jit-load');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
const mainSrc = fs.readFileSync(mainPath, 'utf8');
const lines = mainSrc.split('\n');
const start = lines.findIndex((l) => l.startsWith('const { createJitGuard }'));
const end = lines.findIndex((l, i) => i > start && l.startsWith('let apiJit'));
const src = lines.slice(start, end).join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function world() {
  const ev = [];
  const W = { ev, loaded: null, loading: null, cur: null, opts: [] };
  const engine = {
    status: () => (W.loaded ? { loaded: true, id: W.loaded } : { loaded: false, loading: !!W.loading }),
    async unloadModel() { ev.push('UNLOAD ' + W.loaded); W.loaded = null; },
  };
  const settings = { data: { lastModel: null, apiTtlMin: 5 }, save() {} };
  async function loadById(id, opts = {}) {
    W.opts.push({ id, api: !!opts.api });
    await sleep(50);
    if (W.loading) { await W.cur; }
    // engine.loadModel của lần nạp thứ hai gỡ mô hình ngay khi bắt đầu. Chỉ S12 bật cờ này.
    if (W.dropOnOverlap && W.seenLoad) { W.loaded = null; ev.push('RACE-CLEAR ' + id); }
    W.seenLoad = true;
    W.loading = id; ev.push('load-start ' + id);
    W.cur = (async () => {
      await sleep(200);
      if (W.fail) { const f = W.fail; W.fail = null; throw new Error(f); }
      W.loaded = id;
    })();
    try { await W.cur; } finally { W.loading = null; }
    if (!opts.api) settings.data.lastModel = id;
    ev.push('loaded ' + id);
    return engine.status();
  }
  const ctx = {
    require: (m) => (m === './jit-load' ? require(path.join(__dirname, '..', 'src', 'jit-load')) : m === './model-ref' ? require(path.join(__dirname, '..', 'src', 'model-ref')) : require(m)),
    engine, settings, loadById,
    listModels: () => [{ id: 'a' }, { id: 'b' }],
    busy: 0, generations: new Map(), apiJit: null, lastUse: 0, log: () => {}, send: () => {}, console,
    setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.ensureModel = ensureModel; globalThis.noteUiPick = noteUiPick; globalThis.shareLoad = (typeof shareLoad === "function") ? shareLoad : null; globalThis.getApiJit = () => apiJit;', ctx);
  W.ctx = ctx; W.settings = settings; W.loadById = loadById;
  W.api = (id, ac) => ctx.ensureModel(id, { api: true, signal: ac.signal }).then(() => 'ok', (e) => 'ERR ' + e.message);
  // IPC models:load: noteUiPick rồi nạp. shareLoad (nếu có) gom UI và API vào một lần nạp đang chạy.
  W.ui = (id) => { ctx.noteUiPick(id); return typeof ctx.shareLoad === 'function' ? ctx.shareLoad(id, {}) : loadById(id); };
  return W;
}

// TTL thật trong main.js. lastUse = 0 trong harness nên hết hạn ngay nếu apiJit còn trỏ vào mô hình.
function runTtl(ctx) {
  const i = mainSrc.indexOf('setInterval(() => { // TTL:');
  const j = mainSrc.indexOf('}, 30000)', i);
  const body = mainSrc.slice(i + 'setInterval(() => '.length, j + 1);
  vm.runInContext('(function () ' + body + ')()', ctx);
}

function snapshot(W, out) {
  const jit = W.ctx.getApiJit();
  return {
    loaded: W.loaded,
    apiJit: jit && jit.id,
    unloads: W.ev.filter((e) => e.startsWith('UNLOAD')).length,
    lastModel: W.settings.data.lastModel,
    ...(out || {}),
  };
}

async function scen(expect, fn) {
  const W = world();
  const out = await fn(W);
  const got = snapshot(W, out);
  for (const [k, v] of Object.entries(expect)) {
    assert.strictEqual(got[k], v, JSON.stringify(got));
  }
  return got;
}

test('S1 one API request, aborts during load', async () => {
  await scen({ loaded: null, unloads: 1 }, async (W) => {
    const ac = new AbortController(); const p = W.api('a', ac); await sleep(120); ac.abort(); await p;
  });
});

test('S2a two requests same model, B arrives in pre-phase, A aborts', async () => {
  await scen({ loaded: 'a', unloads: 0, apiJit: 'a' }, async (W) => {
    const A = new AbortController(), B = new AbortController();
    const pa = W.api('a', A); await sleep(10); const pb = W.api('a', B); await sleep(100); A.abort(); await Promise.all([pa, pb]);
  });
});

test('S2b two requests same model, B arrives while loading, A aborts', async () => {
  await scen({ loaded: 'a', unloads: 0, apiJit: 'a' }, async (W) => {
    const A = new AbortController(), B = new AbortController();
    const pa = W.api('a', A); await sleep(120); const pb = W.api('a', B); await sleep(10); A.abort(); await Promise.all([pa, pb]);
  });
});

test('S2c two requests, B aborts, A continues', async () => {
  await scen({ loaded: 'a', unloads: 0, apiJit: 'a' }, async (W) => {
    const A = new AbortController(), B = new AbortController();
    const pa = W.api('a', A); await sleep(120); const pb = W.api('a', B); await sleep(10); B.abort(); await Promise.all([pa, pb]);
  });
});

test('S3 both requests abort', async () => {
  await scen({ loaded: null }, async (W) => {
    const A = new AbortController(), B = new AbortController();
    const pa = W.api('a', A); await sleep(120); const pb = W.api('a', B); await sleep(10); A.abort(); B.abort(); await Promise.all([pa, pb]);
  });
});

test('S4 UI picks the SAME model during API load, API aborts', async () => {
  await scen({ loaded: 'a', unloads: 0 }, async (W) => {
    const A = new AbortController(); const pa = W.api('a', A); await sleep(60); const ui = W.ui('a'); await sleep(20); A.abort(); await Promise.all([pa, ui]);
  });
});

test('S4b UI picks the SAME model during pre-phase, API aborts', async () => {
  await scen({ loaded: 'a', unloads: 0 }, async (W) => {
    const A = new AbortController(); const pa = W.api('a', A); await sleep(5); const ui = W.ui('a'); await sleep(100); A.abort(); await Promise.all([pa, ui]);
  });
});

test('S5 UI picks a DIFFERENT model b during API load of a, API aborts', async () => {
  await scen({ loaded: 'b', unloads: 0 }, async (W) => {
    const A = new AbortController(); const pa = W.api('a', A); await sleep(120); const ui = W.ui('b'); A.abort(); await Promise.all([pa, ui]);
  });
});

test('S6 abort after load finished', async () => {
  await scen({ loaded: 'a', unloads: 0, apiJit: 'a' }, async (W) => {
    const A = new AbortController(); await W.api('a', A); A.abort();
  });
});

test('S7 load throws, then a fresh abort must still unload', async () => {
  await scen({ loaded: null, unloads: 1, first: 'ERR boom' }, async (W) => {
    W.fail = 'boom'; const first = await W.api('a', new AbortController());
    const A = new AbortController(); const p = W.api('a', A); await sleep(120); A.abort(); await p;
    return { first };
  });
});

test('S7b load throws while another request aborts', async () => {
  await scen({ loaded: null }, async (W) => {
    const A = new AbortController(), B = new AbortController();
    const pa = W.api('a', A); await sleep(120); W.fail = 'boom'; const pb = W.api('a', B); A.abort();
    const r = await Promise.all([pa, pb]);
    const C = new AbortController(); const pc = W.api('a', C); await sleep(120); C.abort(); await pc;
    return { r: r.join('|') };
  });
});

test('S8 UI chat generation running when API aborts keeps the model and arms TTL', async () => {
  await scen({ loaded: 'a', unloads: 0, apiJit: 'a' }, async (W) => {
    W.ctx.generations.set('x', {});
    const A = new AbortController(); const p = W.api('a', A); await sleep(120); A.abort(); await p;
  });
});

test('S9 stale lastModel a while b is loaded; API a aborts and b stays', async () => {
  await scen({ loaded: 'b' }, async (W) => {
    W.settings.data.lastModel = 'a'; W.loaded = 'b';
    const A = new AbortController(); const p = W.api('a', A); await sleep(120); A.abort(); await p;
  });
});

test('S10 UI had b loaded and selected; API JIT a aborts without rewriting lastModel', async () => {
  await scen({ lastModel: 'b' }, async (W) => {
    await W.ui('b');
    const A = new AbortController(); const p = W.api('a', A); await sleep(120); A.abort(); await p;
    assert.ok(W.opts.some((o) => o.id === 'a' && o.api === true));
  });
});

test('S4c UI joins the in-flight load of the same model, API aborts', async () => {
  await scen({ loaded: 'a', unloads: 0 }, async (W) => {
    const A = new AbortController(); const pa = W.api('a', A); await sleep(60);
    const ui = (async () => { W.ctx.noteUiPick('a'); await W.cur; W.ev.push('ui-joined'); return 'ui-sees-loaded'; })();
    await sleep(20); A.abort(); const r = await Promise.all([pa, ui]); await sleep(5); return { uiThinks: r[1] };
  });
});

test('S11 UI is loading b when API asks a and aborts; kept model has TTL', async () => {
  await scen({ apiJit: 'a' }, async (W) => {
    const ui = W.ui('b'); await sleep(60);
    const A = new AbortController(); const p = W.api('a', A); await sleep(300); A.abort(); await Promise.all([p, ui]);
  });
});

test('API abort while UI is still loading b does not replace b', async () => {
  await scen({ loaded: 'b', unloads: 0, apiJit: null }, async (W) => {
    const ui = W.ui('b'); await sleep(60);
    const A = new AbortController(); const p = W.api('a', A); await sleep(30); A.abort(); await Promise.all([p, ui]);
  });
});

test('shouldUnload matches the loaded id exactly', () => {
  const g = createJitGuard();
  g.enter('m1');
  assert.strictEqual(g.shouldUnload('m1', { triggered: true, status: { loaded: true, id: 'm1-extra' } }), false);
  assert.strictEqual(g.shouldUnload('m1', { triggered: true, status: { loaded: true, id: 'm1' } }), true);
});

test('S12 API request for B waits for the in-flight load while the UI picks B, no abort', async () => {
  await scen({ loaded: 'b', apiResult: 'ok' }, async (W) => {
    W.dropOnOverlap = true;
    const ac = new AbortController();
    const pa = W.api('b', ac);
    await sleep(60);
    const ui = W.ui('b');
    const apiResult = await pa;
    assert.strictEqual(W.loaded, 'b', 'request would generate before B is loaded: ' + JSON.stringify(W.ev));
    await ui;
    return { apiResult };
  });
});

test('S13 UI pick of B during the API load is not JIT, so TTL leaves B loaded', async () => {
  await scen({ loaded: 'b', apiJit: null, unloads: 0, lastModel: 'b' }, async (W) => {
    const ac = new AbortController();
    const pa = W.api('b', ac);
    await sleep(60);
    const ui = W.ui('b');
    const apiResult = await Promise.all([pa, ui]);
    assert.strictEqual(apiResult[0], 'ok');
    W.ctx.lastUse = 0;
    runTtl(W.ctx);
    await sleep(0);
  });
});

test('S14 UI and API share one in-flight load of the same model', async () => {
  await scen({ loaded: 'b', loads: 1 }, async (W) => {
    const ac = new AbortController();
    const pa = W.api('b', ac);
    await sleep(30);
    const ui = W.ui('b');
    await Promise.all([pa, ui]);
    return { loads: W.ev.filter((e) => e.startsWith('load-start')).length };
  });
});

test('loadById skips lastModel for api loads; models:load notes the UI pick first', () => {
  const loadFn = mainSrc.slice(mainSrc.indexOf('async function loadById'), mainSrc.indexOf('const { createJitGuard }'));
  assert.match(loadFn, /api = false/);
  assert.match(loadFn, /if \(!api\) \{ settings\.data\.lastModel = m\.id; settings\.save\(\); \}/);
  const i = mainSrc.indexOf("ipcMain.handle('models:load'");
  const h = mainSrc.slice(i, mainSrc.indexOf('ipcMain.handle', i + 20));
  const callAt = h.includes('shareLoad') ? h.indexOf('shareLoad') : h.indexOf('loadById');
  assert.ok(h.indexOf('noteUiPick(id)') >= 0 && callAt > h.indexOf('noteUiPick(id)'), h);
  const ens = mainSrc.slice(mainSrc.indexOf('async function ensureModel'), mainSrc.indexOf('function apiHost'));
  assert.ok(ens.indexOf('await Promise.resolve()') < ens.indexOf('jitGuard.shouldUnload('));
  assert.ok(ens.indexOf('uiPick.seq') < ens.indexOf('jitGuard.shouldUnload('));
  assert.doesNotMatch(ens, /settings\.data\.lastModel === m\.id/);
  const proxy = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine-proxy.js'), 'utf8');
  assert.match(proxy, /async generate\(messages, \{ signal, onToken, \.\.\.opts \} = \{\}\) \{[\s\S]*?if \(signal\?\.aborted\) onAbort\(\)/);
});
