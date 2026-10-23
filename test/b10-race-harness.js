'use strict';
// B10: ensureModel thật + jit-load thật, chỉ loadById được thay.
// UI chọn mô hình đi qua noteUiPick, như IPC models:load.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.env.REPO || path.join(__dirname, '..');
const mainPath = path.join(root, 'src', 'main.js');
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
    require: (m) => (m === './jit-load' ? require(path.join(root, 'src', 'jit-load')) : m === './model-ref' ? require(path.join(root, 'src', 'model-ref')) : require(m)),
    engine, settings, loadById,
    listModels: () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    busy: 0, generations: new Map(), apiJit: null, lastUse: 0, log: () => {}, send: () => {}, console,
    setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.ensureModel = ensureModel; globalThis.noteUiPick = noteUiPick; globalThis.shareLoad = (typeof shareLoad === "function") ? shareLoad : null; globalThis.getApiJit = () => apiJit; globalThis.inflight = () => (typeof loadInflight !== "undefined" ? loadInflight.size : -1);', ctx);
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

module.exports = { world, runTtl, sleep, root, mainSrc };
