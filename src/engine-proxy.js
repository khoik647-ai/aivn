// Cầu nối tới tiến trình engine-host.js (Node.js thuần đi kèm ứng dụng). Cùng giao diện với engine.js.
const { fork } = require('child_process');

// dòng lỗi có ích đầu tiên trong stderr của Node (vd. "Error: Cannot find module './agent/sampling'")
function firstErrorLine(t) {
  const lines = String(t || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const l = lines.find(x => /^(\w*Error|Error)\b[:\s]/.test(x) || /^(Uncaught|FATAL|Fatal)/i.test(x)) || lines.find(x => /cannot find module|not found|failed|lỗi/i.test(x));
  return l ? l.slice(0, 240) : '';
}
function createEngineProxy({ nodePath, hostScript, log = () => {}, onCrash = () => {}, onProgress = () => {} }) {
  let child = null, readyP = null, seq = 0;
  const pending = new Map(); // id -> {resolve, reject}
  const tokenCbs = new Map(); // reqId -> onToken
  let cached = { loaded: false }; let groundCached = { loaded: false };
  let loading = null;
  let ratio = 1 / 3;
  let errTail = '', ready = false; const kids = new Set(); // pid llama-server do engine-host sinh ra // 0.15.1: giữ phần cuối stderr để báo đúng lỗi thật khi bộ máy sập (vd. thiếu mô-đun khi đóng gói)
  let extraEnv = {}, restarting = false, killReason = null; const inflight = new Map(); // id -> tên lệnh (ghi vào nhật ký khi bộ máy dừng) // token / ký tự, được hiệu chỉnh theo văn bản thật

  function start() {
    if (readyP) return readyP;
    readyP = new Promise((resolve, reject) => {
      const env = { ...process.env, ...extraEnv }; for (const k of Object.keys(env)) if (env[k] === '' || env[k] == null) delete env[k]; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; if (process.resourcesPath && !env.AIVN_RESOURCES) env.AIVN_RESOURCES = process.resourcesPath;
      child = fork(hostScript, [], { execPath: nodePath, execArgv: [], serialization: 'json', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env, windowsHide: true });
      child.stdout.on('data', (d) => log(String(d).trimEnd()));
      errTail = ''; ready = false;
      child.stderr.on('data', (d) => { const t = String(d); errTail = (errTail + t).slice(-4000); log(t.trimEnd()); });
      child.on('message', (m) => {
        if (m.type === 'ready') { ready = true; log(`[engine] tiến trình ${m.pid}, Node ${m.node}`); return resolve(); }
        if (m.type === 'child') { kids.add(m.pid); return; }
        if (m.type === 'child-exit') { kids.delete(m.pid); return; }
        if (m.type === 'token') { tokenCbs.get(m.reqId)?.(m.t); return; }
        if (m.type === 'progress') { try { onProgress(m); } catch {} return; }
        const p = pending.get(m.id); if (!p) return; pending.delete(m.id); inflight.delete(m.id);
        if (m.error) { const e = new Error(m.error); if (m.code) e.code = m.code; if (m.stack) e.hostStack = m.stack; if (m.attempts) e.attempts = m.attempts; if (m.gpu != null) e.gpu = m.gpu; p.reject(e); } else p.resolve(m.result);
      });
      child.on('error', (e) => { log('[engine] lỗi khởi động: ' + e.message); reject(e); });
      child.on('exit', (code, signal) => {
        for (const pid of kids) { try { process.kill(pid); log(`[engine] dừng llama-server mồ côi (pid ${pid})`); } catch {} } kids.clear();
        const wasLoaded = cached.loaded || !!loading;
        child = null; readyP = null; cached = { loaded: false }; groundCached = { loaded: false };
        const busy = [...inflight.values()]; inflight.clear();
        const why = killReason; killReason = null;
        // signal (SIGTERM…) chỉ có khi chính AIVN dừng tiến trình; sập thật (thiếu bộ nhớ, lỗi driver) cho mã thoát
        const first = firstErrorLine(errTail); const atStart = !ready && !why;
        const err = why ? new Error(`Bộ máy AI đã được khởi động lại (${why}).`) : (atStart || first) && code ? new Error(`Bộ máy AI ${atStart ? 'không khởi động được' : 'đã dừng đột ngột'} (mã ${code})${first ? ': ' + first : ''}`) : new Error( `Bộ máy AI đã dừng đột ngột${signal ? ` (${signal})` : code ? ` (mã ${code}${code > 0xC0000000 ? ' = 0x' + (code >>> 0).toString(16).toUpperCase() : ''})` : ''}. Có thể máy không đủ bộ nhớ (RAM/VRAM) cho mô hình hoặc độ dài ngữ cảnh này.`);
        err.code = 'ENGINE_EXIT'; err.exitCode = code; err.signal = signal; err.killReason = why; err.startup = atStart; err.detail = errTail.slice(-2000);
        for (const p of pending.values()) p.reject(err);
        pending.clear(); tokenCbs.clear();
        log(`[engine] tiến trình kết thúc code=${code} signal=${signal}${why ? ' · do AIVN: ' + why : ''}${busy.length ? ' · đang chạy: ' + busy.join(', ') : ''}${wasLoaded ? ' · đang có mô hình' : ''}`);
        reject(err);
        if ((wasLoaded || code) && !restarting && !busy.length) onCrash(err); // đang có lượt chạy: lỗi hiện ngay trong câu trả lời (và tự phục hồi)
      });
    });
    return readyP;
  }

  async function call(method, ...args) {
    await start();
    return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); inflight.set(id, method); child.send({ id, method, args }); });
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
    ocrLines: (buf) => call('ocrLines', Buffer.from(buf).toString('base64')),
    groundLoad: async (id, p, mm, o) => { groundCached = await call('groundLoad', id, p, mm, o); groundCached.loaded = true; return groundCached; },
    groundUnload: async () => { groundCached = { loaded: false }; if (child) await call('groundUnload'); },
    groundStatus: () => groundCached,
    async groundGenerate(messages, { signal, ...opts } = {}) {
      const reqId = 'G' + (++seq); const onAbort = () => { try { child && child.send({ type: 'abort', reqId }); } catch {} };
      signal?.addEventListener('abort', onAbort);
      try { return await call('groundGenerate', messages, opts, reqId); } finally { signal?.removeEventListener('abort', onAbort); }
    },
    embedLoad: (id, p, opts) => call('embedLoad', id, p, opts),
    embedUnload: () => call('embedUnload'),
    embedStatus: () => call('embedStatus'),
    embedCount: (texts) => call('embedCount', texts),
    // trả Float32Array[] (chuẩn hoá L2)
    async embed(texts, kind) { const r = await call('embed', texts, kind); return r.map(b => { const u = Uint8Array.from(Buffer.from(b, 'base64')); return new Float32Array(u.buffer); }); },
    async stop(reason = 'thoát ứng dụng') { if (child) { killReason = reason; log('[engine] dừng tiến trình: ' + reason); try { child.kill(); } catch {} } },
    busy: () => inflight.size > 0,
    // Khởi động lại tiến trình bộ máy với biến môi trường mới (vd. AIVN_GPU=off để chỉ dùng CPU)
    async restart(envPatch = {}, reason = 'đổi cài đặt bộ máy') {
      extraEnv = { ...extraEnv, ...envPatch };
      const c = child; restarting = true; if (c) { killReason = reason; log('[engine] khởi động lại: ' + reason + (inflight.size ? ' (đang có ' + inflight.size + ' lệnh chạy)' : '')); }
      if (c) await new Promise((r) => { const t = setTimeout(r, 8000); c.once('exit', () => { clearTimeout(t); r(); }); try { c.kill(); } catch { r(); } });
      restarting = false; cached = { loaded: false };
    },
    env: () => ({ ...extraEnv }),
  };
}

module.exports = { createEngineProxy, firstErrorLine };
