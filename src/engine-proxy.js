// Cầu nối tới tiến trình engine-host.js (Node.js thuần đi kèm ứng dụng). Cùng giao diện với engine.js.
const { fork } = require('child_process');

function createEngineProxy({ nodePath, hostScript, log = () => {}, onCrash = () => {} }) {
  let child = null, readyP = null, seq = 0;
  const pending = new Map(); // id -> {resolve, reject}
  const tokenCbs = new Map(); // reqId -> onToken
  let cached = { loaded: false };
  let loading = null;
  let ratio = 1 / 3;
  let extraEnv = {}, restarting = false; // token / ký tự, được hiệu chỉnh theo văn bản thật

  function start() {
    if (readyP) return readyP;
    readyP = new Promise((resolve, reject) => {
      const env = { ...process.env, ...extraEnv }; for (const k of Object.keys(env)) if (env[k] === '' || env[k] == null) delete env[k]; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; if (process.resourcesPath && !env.AIVN_RESOURCES) env.AIVN_RESOURCES = process.resourcesPath;
      child = fork(hostScript, [], { execPath: nodePath, execArgv: [], serialization: 'json', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env, windowsHide: true });
      child.stdout.on('data', (d) => log(String(d).trimEnd()));
      child.stderr.on('data', (d) => log(String(d).trimEnd()));
      child.on('message', (m) => {
        if (m.type === 'ready') { log(`[engine] tiến trình ${m.pid}, Node ${m.node}`); return resolve(); }
        if (m.type === 'token') { tokenCbs.get(m.reqId)?.(m.t); return; }
        const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
        if (m.error) { const e = new Error(m.error); if (m.code) e.code = m.code; if (m.stack) e.hostStack = m.stack; if (m.attempts) e.attempts = m.attempts; if (m.gpu != null) e.gpu = m.gpu; p.reject(e); } else p.resolve(m.result);
      });
      child.on('error', (e) => { log('[engine] lỗi khởi động: ' + e.message); reject(e); });
      child.on('exit', (code, signal) => {
        const wasLoaded = cached.loaded || !!loading;
        child = null; readyP = null; cached = { loaded: false };
        const err = new Error(`Bộ máy AI đã dừng đột ngột${signal ? ` (${signal})` : code ? ` (mã ${code})` : ''}. Có thể máy không đủ bộ nhớ cho mô hình này, hãy thử bản lượng tử nhỏ hơn.`);
        for (const p of pending.values()) p.reject(err);
        pending.clear(); tokenCbs.clear();
        log(`[engine] tiến trình kết thúc code=${code} signal=${signal}`);
        reject(err);
        if ((wasLoaded || code) && !restarting) onCrash(err);
      });
    });
    return readyP;
  }

  async function call(method, ...args) {
    await start();
    return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); child.send({ id, method, args }); });
  }

  return {
    external: true,
    start,
    hardwareInfo: () => call('hardwareInfo'),
    async loadModel(id, modelPath, opts) {
      loading = id;
      try { cached = await call('loadModel', id, modelPath, opts); return cached; }
      finally { loading = null; }
    },
    async unloadModel() { if (!child) { cached = { loaded: false }; return; } cached = await call('unloadModel'); },
    status: () => (cached.loaded ? cached : { loaded: false, loading: !!loading }),
    async generate(messages, { signal, onToken, ...opts } = {}) {
      const reqId = 'g' + (++seq);
      if (onToken) tokenCbs.set(reqId, onToken);
      const onAbort = () => { try { child && child.send({ type: 'abort', reqId }); } catch {} };
      signal?.addEventListener('abort', onAbort);
      try { return await call('generate', messages, opts, reqId); }
      finally { tokenCbs.delete(reqId); signal?.removeEventListener('abort', onAbort); }
    },
    async chatStep(messages, { signal, onToken, ...opts } = {}) {
      const reqId = 's' + (++seq);
      if (onToken) tokenCbs.set(reqId, onToken);
      const onAbort = () => { try { child && child.send({ type: 'abort', reqId }); } catch {} };
      if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort);
      try { return await call('chatStep', messages, opts, reqId); }
      finally { tokenCbs.delete(reqId); signal?.removeEventListener('abort', onAbort); }
    },
    // Ước lượng đồng bộ (đã hiệu chỉnh) + đếm chính xác bất đồng bộ
    countTokens: (text) => Math.ceil(String(text).length * ratio * 1.05),
    async calibrate(texts) {
      if (!cached.loaded) return;
      const sample = texts.filter(Boolean).map(t => String(t).slice(0, 12000));
      const chars = sample.reduce((s, t) => s + t.length, 0); if (chars < 200) return;
      const n = (await call('countTokens', sample)).reduce((s, x) => s + x, 0);
      if (n > 0) ratio = n / chars;
    },
    ocr: (buf) => call('ocr', Buffer.from(buf).toString('base64')),
    embedLoad: (id, p, opts) => call('embedLoad', id, p, opts),
    embedUnload: () => call('embedUnload'),
    embedStatus: () => call('embedStatus'),
    embedCount: (texts) => call('embedCount', texts),
    // trả Float32Array[] (chuẩn hoá L2)
    async embed(texts, kind) { const r = await call('embed', texts, kind); return r.map(b => { const u = Uint8Array.from(Buffer.from(b, 'base64')); return new Float32Array(u.buffer); }); },
    async stop() { if (child) { try { child.kill(); } catch {} } },
    // Khởi động lại tiến trình bộ máy với biến môi trường mới (vd. AIVN_GPU=off để chỉ dùng CPU)
    async restart(envPatch = {}) {
      extraEnv = { ...extraEnv, ...envPatch };
      const c = child; restarting = true;
      if (c) await new Promise((r) => { const t = setTimeout(r, 8000); c.once('exit', () => { clearTimeout(t); r(); }); try { c.kill(); } catch { r(); } });
      restarting = false; cached = { loaded: false };
    },
    env: () => ({ ...extraEnv }),
  };
}

module.exports = { createEngineProxy };
