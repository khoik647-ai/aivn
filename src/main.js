const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, Tray, nativeImage, globalShortcut, powerMonitor, net, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const catalog = require('./catalog');
const { JsonStore } = require('./store');
const { createApiServer } = require('./server');
const docs = require('./docs');
const { createRagStore, buildRagContent } = require('./rag');
const EMBED = catalog.EMBEDDING;
const { createUpdater } = require('./updater');
const hf = require('./hf');
const { createDownloader } = require('./downloader');
const { createAgent } = require('./agent/agent');
const { createMemoryStore } = require('./agent/memory');
const { createScheduler } = require('./agent/scheduler');
const sandbox = require('./agent/sandbox');
const { normalizeTools } = require('./schema');
const { createLicenseState } = require('./gate');
const { createComputerTools } = require('./agent/computer-tools');
const { createAdmin } = require('./admin');
const SC = require('./screen-control');
const { WELCOME, TOOL_GROUPS } = require('./agent/agent');
const { toolSupport } = require('./toolsupport');
const { createAppLock, resetData } = require('./applock');
const LIC = require('./license');
const PERF = require('./perf');
const docsPool = require('./docs-pool');

const isTest = process.env.AIVN_TEST === '1';
// Giới hạn bộ nhớ JS của giao diện trên máy yếu (đọc mức đã tính ở lần chạy trước; phải đặt trước khi app sẵn sàng)
try { const ud0 = process.env.AIVN_USER_DATA || app.getPath('userData'); const pc = JSON.parse(fs.readFileSync(path.join(ud0, 'perf-cache.json'), 'utf8')); if (pc.rendererHeapMB > 0) app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${pc.rendererHeapMB}`); } catch {}
if (process.env.AIVN_USER_DATA) app.setPath('userData', process.env.AIVN_USER_DATA);
const LOG = require('./logger');
LOG.init(path.join(app.getPath('userData'), 'logs'));
{ const os_ = require('os'); LOG.block('app', `Khởi động AIVN ${app.getVersion()}${app.isPackaged ? '' : ' (mã nguồn)'}`, [`Hệ điều hành: ${process.platform} ${process.arch} ${os_.release()}${process.getSystemVersion ? ' (' + process.getSystemVersion() + ')' : ''}`, `CPU: ${(os_.cpus()[0] || {}).model || '?'} · ${os_.cpus().length} luồng`, `RAM: ${(os_.totalmem() / 1024 ** 3).toFixed(1)} GB (trống ${(os_.freemem() / 1024 ** 3).toFixed(1)} GB)`, `Electron ${process.versions.electron} · thư mục dữ liệu: ${app.getPath('userData')}`]); }
process.on('uncaughtException', (e) => { LOG.block('crash', 'Lỗi không bắt được (tiến trình chính): ' + (e && e.message), [e && e.stack]); });
process.on('unhandledRejection', (e) => { LOG.log('app', 'Promise bị từ chối không xử lý: ' + (e && e.message || e)); });

// Bộ máy suy luận chạy trong tiến trình Node.js thuần đi kèm (resources/node). Bộ cấp phát của Electron làm sập
// tiến trình khi llama.cpp cấp phát > 2 GB (mô hình lớn chạy CPU), nên không chạy llama.cpp trong Electron nữa.
function findNode() {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  const cands = [];
  if (process.env.AIVN_NODE) cands.push(process.env.AIVN_NODE);
  if (app.isPackaged) cands.push(path.join(process.resourcesPath, 'node', exe));
  else {
    cands.push(path.join(__dirname, '..', 'build', 'node', `${process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`, exe));
    for (const d of (process.env.PATH || '').split(path.delimiter)) if (d) cands.push(path.join(d, exe));
  }
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}
const hostScript = path.join(__dirname, 'engine-host.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const nodePath = process.env.AIVN_INPROC === '1' ? null : findNode();
let engine;
if (nodePath) {
  const { createEngineProxy } = require('./engine-proxy');
  engine = createEngineProxy({ nodePath, hostScript, log: (m) => { console.log(m); LOG.log('engine', m); },
    onCrash: (e) => { engineDied = true; send('model:status', { loaded: false }); send('engine:crash', { message: e.message }); } });
} else {
  console.warn('[engine] không tìm thấy Node.js đi kèm, chạy llama.cpp ngay trong Electron (mô hình > 2 GB chạy CPU có thể lỗi)');
  if (process.resourcesPath && !process.env.AIVN_RESOURCES) process.env.AIVN_RESOURCES = process.resourcesPath;
  const inproc = require('./engine');
  engine = { ...inproc, external: false, calibrate: async () => {}, ocr: (b) => require('./ocr').recognize(b), start: async () => {}, stop: async () => {} };
}

let lastUse = Date.now(); let busy = 0; // dùng để tự gỡ mô hình khi rảnh lâu (mức Tiết kiệm)
for (const k of ['generate', 'chatStep']) { const f = engine[k]; if (typeof f === 'function') engine[k] = (...a) => { lastUse = Date.now(); busy++; const p = Promise.resolve().then(() => f(...a)); p.finally(() => { busy--; lastUse = Date.now(); }).catch(() => {}); return p; }; }
let win = null, tray = null, quitting = false;
let paths, settings, convos, memory, scheduler, agent;
let downloader = null;
let hwCache = null; let pendingEngineRestart = null; let lastCtx = null;
let engineDied = false; // bộ máy đã dừng ngoài ý muốn → lượt kế tiếp tự nạp lại mô hình đang dùng
async function ensureAfterCrash() {
  const st = engine.status();
  if (!engineDied || st.loaded || st.loading || !settings.data.lastModel) return;
  LOG.log('load', 'Tự nạp lại mô hình cho lượt mới sau khi bộ máy đã dừng', { model: settings.data.lastModel, ctx: lastCtx });
  await loadById(settings.data.lastModel, { force: true, ctx: lastCtx || null, reason: 'nạp lại sau khi bộ máy dừng' });
}
// Bộ máy AI dừng giữa lượt (sập/thiếu bộ nhớ): nạp lại mô hình với ngữ cảnh nhỏ hơn rồi thử lại MỘT lần
async function withEngineRecovery(fn, { onRetry } = {}) {
  try { return await fn(); }
  catch (e) {
    if (!e || e.code !== 'ENGINE_EXIT' || !settings.data.lastModel) throw e;
    engineDied = true;
    const prev = lastCtx || settings.data.contextSize || 4096;
    const ctx = prev > 4096 ? 4096 : Math.max(2048, Math.floor(prev / 2));
    engineLog('Bộ máy AI dừng giữa lượt: tự nạp lại mô hình với ngữ cảnh nhỏ hơn và thử lại một lần', e, { 'ngữ cảnh cũ': prev, 'ngữ cảnh mới': ctx, 'mã thoát': e.exitCode, 'tín hiệu': e.signal, 'lý do': e.killReason || 'không rõ (sập)' });
    onRetry && onRetry(ctx);
    try { await loadById(settings.data.lastModel, { force: true, ctx, reason: 'tự phục hồi sau khi bộ máy dừng' }); }
    catch (e2) { send('model:status', { loaded: false }); const x = new Error(e.message + ' AIVN đã thử nạp lại mô hình nhưng chưa được: ' + cleanMsg(e2.message)); x.code = 'ENGINE_EXIT'; throw x; }
    try { return await fn(); }
    catch (e3) { if (e3 && e3.code === 'ENGINE_EXIT') { engineDied = true; send('model:status', { loaded: false }); } if (e3 && e3.code === 'ENGINE_EXIT') e3.message += ` (đã tự khởi động lại và thử với ngữ cảnh ${ctx} nhưng vẫn lỗi — hãy chọn mô hình nhỏ hơn)`; throw e3; }
  }
}
const cleanMsg = (m) => String(m || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
// Biến môi trường cho bộ máy: tắt GPU, chọn GPU Vulkan (vd. chỉ dùng GPU rời trên laptop 2 GPU), giới hạn VRAM (ghi đè trong Nâng cao)
function engineEnv() {
  const d = settings.data;
  const dev = Number.isInteger(d.gpuDevice) && d.gpuDevice >= 0 ? String(d.gpuDevice) : '';
  const lim = Number(d.vramLimitGB) > 0 ? String(Math.round(Number(d.vramLimitGB) * 1024 ** 3)) : '';
  return { AIVN_GPU: d.gpu === false ? 'off' : '', GGML_VK_VISIBLE_DEVICES: dev, AIVN_VRAM_LIMIT: lim };
}
const hw = async () => (hwCache ||= await engine.hardwareInfo().catch(() => ({ ram: require('os').totalmem() })));
const generations = new Map(); // reqId -> AbortController
const stopReasons = new Map(); // reqId -> lý do dừng (ghi nhật ký + hiện cho người dùng)
function abortGen(reqId, ac, reason) { if (!ac || ac.signal.aborted) return; stopReasons.set(reqId, reason); LOG.log('app', `Dừng lượt ${reqId}: ${reason}`); try { ac.abort(); } catch {} }
const serverLog = [];

function initStores() {
  const ud = app.getPath('userData');
  paths = { userData: ud, models: path.join(ud, 'models') };
  fs.mkdirSync(paths.models, { recursive: true });
  settings = new JsonStore(path.join(ud, 'settings.json'), {
    systemPrompt: 'Bạn là AIVN, một trợ lý AI thân thiện. Hãy trả lời bằng tiếng Việt, rõ ràng và chính xác.',
    temperature: 0.7, maxTokens: 1024, contextSize: 0, perfMode: 'auto', apiPort: 1234, apiAutoStart: false, imported: [], lastModel: null, hfToken: '', theme: 'light', rag: true, vision: true,
    agentFolders: [], agentWeb: false, agentPython: false, agentMemory: true, agentTemperature: 0.2, agentComputer: true, agentScreen: false, agentScreenMode: 'each', agentScreenBudget: 40, agentAutoReadOnly: false, keepInTray: false, openAtLogin: false,
  });
  if (!settings.data.perfMigrated) { if (settings.data.contextSize === 4096) settings.data.contextSize = 0; settings.data.perfMigrated = 1; settings.save(); } // 4096 là mặc định cũ → chuyển sang Tự động theo mức máy
  Object.assign(process.env, Object.fromEntries(Object.entries(engineEnv()).filter(([k, v]) => v && !process.env[k]))); // bộ máy (tiến trình riêng) kế thừa các biến này khi khởi động
  convos = new JsonStore(path.join(ud, 'conversations.json'), { list: [] });
  rag = createRagStore(path.join(ud, 'rag'));
  memory = createMemoryStore(path.join(ud, 'memory.json'));
  scheduler = createScheduler({ file: path.join(ud, 'schedules.json'), onFire: onScheduleFire, log: (m) => { console.log(m); log(m); } });
  computerTools = createComputerTools({ getSettings: () => settings.data, openPath: (p) => shell.openPath(p), openExternal: (u) => shell.openExternal(u), log, logScan: (d) => LOG.block('apps', 'Quét ứng dụng đã cài (AIVN AGENT)', [`nguồn: ${JSON.stringify(d.sources)}`, `lỗi: ${d.errors.length ? d.errors.join('; ') : 'không'}`, `thư mục Desktop: ${d.dirs ? d.dirs.desktop.join(' | ') : '—'}`, `thư mục Start Menu: ${d.dirs ? d.dirs.start.join(' | ') : '—'}`, `thời gian tìm sâu: ${d.ms ?? '?'} ms`]),
    keyTap: (k) => { try { SC.libnut().keyTap(k); } catch (e) { throw new Error(e.message); } }, visionReady: () => !!engine.status().vision, screen: { look: (a, ctx) => deskWrap(getDesk().look, a, ctx), act: (a, ctx) => deskWrap(getDesk().act, a, ctx), readText: (a, ctx) => deskWrap(getDesk().readText, a, ctx) } });
  mcp = require('./mcp').createMcpManager({ dir: app.getPath('userData'), log: (sc, m) => LOG.log(sc, m), onChange: () => send('mcp:changed', mcp.status()) });
  agent = createAgent({ engine, mcp, getSettings: () => settings.data, allowAlways: (name) => { const l = new Set(settings.data.agentAlwaysAllow || []); l.add(name); settings.data.agentAlwaysAllow = [...l]; settings.save(); LOG.log('agent', `Người dùng chọn "Luôn cho phép": ${name}`); }, memory, scheduler, extractFile: docsPool.extractFile, embedForMemory, log, computer: computerTools,
    logTool: (x) => LOG.log('tool', `${x.auto ? '(tự động) ' : ''}${x.name} → ${x.status} sau ${x.ms ?? '?'} ms`, { args: Object.fromEntries(Object.entries(x.args || {}).map(([k, v]) => [k, typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v])), ketQua: String(x.summary || '').slice(0, 300) }),
    trash: async (p) => { try { await shell.trashItem(p); } catch (e) { throw new Error('Không chuyển được tệp vào Thùng rác (' + e.message + '). Tệp vẫn còn nguyên.'); } } });
  lic = createLicenseState({ file: path.join(ud, 'license.json'), isPackaged: app.isPackaged, log: (m) => { log(m); if (isTest) console.log(m); }, fetchJson });
  appLock = createAppLock(path.join(ud, 'applock.json'));
  admin = createAdmin({ dir: ud, fetchJson, fetchRaw: (u, o) => net.fetch(u, { cache: 'no-store', ...o }), log,
    publicX: !app.isPackaged && process.env.AIVN_TEST_PUBKEY ? process.env.AIVN_TEST_PUBKEY : LIC.PUBLIC_KEY_X });
  downloader = createDownloader({ dir: paths.models, send, getToken: () => settings.data.hfToken || null, maxConcurrent: 2, log: (m) => isTest && console.log(m) });
}
// ---------- Cổng vào: kích hoạt (bắt buộc) + Khóa ứng dụng (tuỳ chọn) ----------
let computerTools = null, admin = null;
let lic, appLock, unlocked = false, servicesOn = false, licTimer = null, idleTimer = null;
const devSkip = !app.isPackaged && process.env.AIVN_SKIP_ACTIVATION === '1'; // chỉ khi chạy từ mã nguồn để kiểm thử
async function fetchJson(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try { const r = await net.fetch(url, { signal: ac.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
const activated = () => devSkip || lic.evaluate().ok;
const isLocked = () => appLock.isEnabled() && !unlocked;
const gateMode = () => !activated() ? 'activate' : isLocked() ? 'lock' : null;
const gated = () => !!gateMode();
function loadUi() {
  if (!win || win.isDestroyed()) return;
  const file = gateMode() ? 'gate.html' : 'index.html';
  if (!win.webContents.getURL().endsWith('/' + file)) win.loadFile(path.join(__dirname, 'renderer', file));
  else win.webContents.send('gate:changed', {});
}
function abortAll() { for (const [id, ac] of generations) abortGen(id, ac, 'AIVN bị khoá'); if (typeof stopComputer === 'function') stopComputer('khoá'); }
function lockNow(reason) {
  if (!appLock.isEnabled() || !unlocked) return false;
  unlocked = false; abortAll(); log('[khoá] AIVN đã khoá (' + reason + ')'); if (isTest) console.log('[khoá] ' + reason);
  loadUi(); return true;
}
function startServices() {
  if (!servicesOn) LOG.log('app', 'Đã kích hoạt: khởi động bộ máy AI, lịch tự động, máy chủ API');
  if (servicesOn) return; servicesOn = true; startIdleUnload();
  hw().then(h => LOG.log('app', 'Phần cứng', { gpu: h.gpu || 'không', thietBi: h.devices, vramGB: h.vram ? +(h.vram.total / 1024 ** 3).toFixed(2) : 0, vramTrongGB: h.vram ? +(h.vram.free / 1024 ** 3).toFixed(2) : 0, ramGB: +(h.ram / 1024 ** 3).toFixed(1), chiCPU: !!h.cpuOnly })).catch(e => LOG.log('app', 'Không đọc được phần cứng: ' + e.message));
  applyBackgroundPrefs();
  scheduler.start();
  if (settings.data.apiAutoStart || process.env.AIVN_API === '1') api.start(settings.data.apiPort).catch(e => log('Lỗi: ' + e.message));
  if (process.env.AIVN_LOAD) loadById(process.env.AIVN_LOAD).catch(e => log('Lỗi nạp: ' + e.message));
}
function stopServices() { if (!servicesOn) return; servicesOn = false; abortAll(); scheduler.stop(); api.stop().catch(() => {}); }
async function licenseCheck() {
  if (devSkip) return;
  const r = await lic.checkOnline();
  if (!lic.evaluate().ok) { if (servicesOn) { log('[kích hoạt] ' + (LIC.REASON_VI[lic.evaluate().reason] || 'mất kích hoạt')); stopServices(); } }
  else if (!servicesOn) startServices();
  loadUi();
  return r;
}
function startGateTimers() {
  clearInterval(licTimer); licTimer = setInterval(() => licenseCheck().catch(() => {}), LIC.CHECK_EVERY_MS);
  clearInterval(idleTimer); idleTimer = setInterval(() => {
    const o = appLock.info(); if (!o.enabled || !unlocked || !o.idleMinutes) return;
    const idle = process.env.AIVN_FAKE_IDLE && !app.isPackaged ? Number(process.env.AIVN_FAKE_IDLE) : powerMonitor.getSystemIdleTime();
    if (idle >= o.idleMinutes * 60) lockNow('không hoạt động ' + o.idleMinutes + ' phút');
  }, isTest ? 2000 : 30000);
  for (const ev of ['lock-screen', 'suspend']) powerMonitor.on(ev, () => { if (appLock.info().lockOnSleep) lockNow(ev === 'suspend' ? 'máy ngủ' : 'khoá màn hình'); });
  powerMonitor.on('resume', () => licenseCheck().catch(() => {}));
}
function registerGateIpc(handle) {
  handle('gate:state', () => ({ mode: gateMode(), license: lic.publicInfo(), lock: appLock.info() }));
  handle('gate:activate', async (_e, code) => { lic.activate(code); licenseCheck().catch(() => {}); if (activated()) startServices(); loadUi(); return lic.publicInfo(); });
  handle('gate:retry', async () => { const r = await licenseCheck(); return { ok: !!(r && r.ok), error: r && r.error }; });
  handle('gate:unlock', async (_e, pw) => { if (!isLocked()) return { ok: true }; const r = await appLock.unlock(String(pw || '')); if (r.ok) { unlocked = true; loadUi(); } return r; });
  handle('gate:reset', async (_e, word) => {
    if (!isLocked()) throw new Error('Chỉ dùng khi quên mật khẩu ở màn hình khoá');
    stopServices(); const removed = resetData(paths.userData, word);
    log('[khoá] đã xoá dữ liệu: ' + removed.join(', '));
    await Promise.race([engine.stop().catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
    if (!isTest) app.relaunch(); app.exit(0);
  });
  handle('gate:copy', (_e, t) => { clipboard.writeText(String(t || '').slice(0, 64)); return true; });
  handle('gate:quit', () => { quitting = true; app.quit(); });
  handle('gate:enter', () => { loadUi(); return gateMode(); });
}

// Cài đặt gửi sang giao diện: không bao giờ kèm token
const publicSettings = () => { const { hfToken, ...rest } = settings.data; return { ...rest, hfTokenSet: !!hfToken }; };

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
// Gộp token trong ~16 ms thành một tin IPC (bớt hàng trăm tin/giây khi mô hình nhanh); flush() trước mọi sự kiện khác của cùng lượt
function tokenBatcher(reqId) {
  let buf = '', t = null;
  const flush = () => { if (t) { clearTimeout(t); t = null; } if (buf && reqId) { send('chat:token', { reqId, t: buf }); } buf = ''; };
  return { push: (s) => { buf += s; if (!t) t = setTimeout(flush, 16); }, flush };
}
const log = (msg) => { LOG.log('app', msg); const e = { t: Date.now(), msg }; serverLog.push(e); if (serverLog.length > 200) serverLog.shift(); send('server:log', e); };

const SPLIT_RE = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;
// Mô hình nhúng (dùng cho tìm kiếm tài liệu), không phải mô hình trò chuyện
const EMBED_RE = /(^|[-_.])(embed|embedding|bge-m3|bge-small|bge-base|bge-large|multilingual-e5|e5-(small|base|large)|nomic-embed|gte-)/i;
function modelIdFromFile(f) { const b = path.basename(f); const m = b.match(SPLIT_RE); return (m ? m[1] : b.replace(/\.gguf$/i, '')).toLowerCase(); }

// Quét thư mục mô hình (models/<tác giả>/<repo>/<tệp>.gguf và tệp ở gốc). Mô hình chia phần chỉ hiện một dòng.
function scanDir(dir, depth, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const files = ents.filter(e => e.isFile() && /\.gguf$/i.test(e.name) && !/mmproj/i.test(e.name) && !EMBED_RE.test(e.name));
  const mmName = hf.pickMmprojFile(ents.filter(e => e.isFile()).map(e => e.name));
  const mmproj = mmName ? path.join(dir, mmName) : null;
  for (const e of files) {
    const full = path.join(dir, e.name);
    const m = e.name.match(SPLIT_RE);
    if (m && m[2] !== '00001') continue;
    try {
      let size = fs.statSync(full).size, parts = 1, missing = 0;
      if (m) {
        parts = Number(m[3]);
        for (let i = 2; i <= parts; i++) {
          const pf = path.join(dir, `${m[1]}-${String(i).padStart(5, '0')}-of-${m[3]}.gguf`);
          try { size += fs.statSync(pf).size; } catch { missing++; }
        }
      }
      const rel = path.relative(paths.models, dir);
      out.push({ id: modelIdFromFile(e.name), file: e.name, path: full, size, mtime: fs.statSync(full).mtimeMs, source: 'downloaded', parts, incomplete: missing > 0, mmproj, vision: !!mmproj, repo: rel && rel.split(path.sep).length === 2 ? rel.split(path.sep).join('/') : null });
    } catch {}
  }
  if (depth > 0) for (const e of ents) if (e.isDirectory()) scanDir(path.join(dir, e.name), depth - 1, out);
}

function listModels() {
  const out = [];
  scanDir(paths.models, 3, out);
  for (const full of settings.data.imported) {
    try { const s = fs.statSync(full); let mm = null; try { const n = hf.pickMmprojFile(fs.readdirSync(path.dirname(full))); if (n) mm = path.join(path.dirname(full), n); } catch {}
      out.push({ id: modelIdFromFile(full), file: path.basename(full), path: full, size: s.size, mtime: s.mtimeMs, source: 'imported', parts: 1, mmproj: mm, vision: !!mm }); } catch {}
  }
  const st = engine.status();
  const seen = new Set();
  return out.filter(m => !m.incomplete && !seen.has(m.id) && seen.add(m.id))
    .map(m => ({ ...m, loaded: st.loaded && st.path === m.path, catalog: catalog.find(c => c.file.toLowerCase() === m.file.toLowerCase()) || null }));
}
const isInstalled = (file) => listModels().some(m => m.file.toLowerCase() === path.basename(file).toLowerCase());

// Nhật ký lỗi bộ máy (để chẩn đoán): userData/logs/engine.log, tối đa ~1 MB
function engineLog(title, e, extra = {}) {
  const lines = Object.entries(extra).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(LOG.redact(v))}`);
  if (e) { lines.push('Lỗi: ' + (e.message || e)); if (e.code) lines.push('Mã: ' + e.code); if (Array.isArray(e.attempts)) for (const a of e.attempts) lines.push(`- Thử ${a.mode}: ${a.message}${a.stack ? '\n' + a.stack : ''}`); if (e.hostStack) lines.push('Stack (engine): ' + e.hostStack); if (e.stack) lines.push('Stack: ' + e.stack); }
  LOG.block('engine', title, lines);
}
// Kiểm tra tệp GGUF trước khi nạp: tồn tại, đúng "GGUF" ở đầu tệp, kích thước khớp kho mô hình (khi biết)
function verifyGguf(m) {
  const bad = (why) => { const e = new Error('Tệp mô hình bị lỗi hoặc tải chưa xong — hãy xoá và tải lại. (' + why + ')'); e.code = 'BAD_FILE'; e.modelId = m.id; e.catalogId = m.catalog ? m.catalog.id : null; e.repo = m.repo || null; return e; };
  let st; try { st = fs.statSync(m.path); } catch { throw bad('không thấy tệp ' + m.path); }
  if (st.size < 1024 * 1024) throw bad('tệp quá nhỏ: ' + st.size + ' byte');
  const fd = fs.openSync(m.path, 'r'); const b = Buffer.alloc(8);
  try { fs.readSync(fd, b, 0, 8, 0); } finally { fs.closeSync(fd); }
  if (b.toString('latin1', 0, 4) !== 'GGUF') throw bad('đầu tệp không phải GGUF');
  const ver = b.readUInt32LE(4); if (ver < 1 || ver > 3) throw bad('phiên bản GGUF lạ: ' + ver);
  if (m.catalog && m.parts === 1 && m.catalog.size && Math.abs(m.size - m.catalog.size) > 4096) throw bad(`kích thước ${m.size} byte, cần ${m.catalog.size} byte`);
  if (fs.existsSync(m.path + '.part')) throw bad('còn tệp .part đang tải dở');
}
const MODE_VI = { gpu: 'GPU', 'gpu-partial': 'GPU một phần + CPU', cpu: 'CPU', 'cpu-only': 'CPU (không dùng GPU)' };

async function perfProfile() {
  const p = PERF.profileFor(await hw(), settings.data.perfMode || 'auto');
  try { fs.writeFileSync(path.join(paths.userData, 'perf-cache.json'), JSON.stringify({ tier: p.tier, rendererHeapMB: p.rendererHeapMB })); } catch {}
  return p;
}
// Mức Tiết kiệm: gỡ mô hình sau N phút không dùng để trả lại RAM/VRAM cho máy
let idleUnloadTimer = null;
function startIdleUnload() {
  clearInterval(idleUnloadTimer);
  idleUnloadTimer = setInterval(async () => {
    try {
      const st = engine.status(); if (!st.loaded || busy > 0 || generations.size) return;
      const p = await perfProfile(); if (!p.idleUnloadMin) return;
      if (Date.now() - lastUse < p.idleUnloadMin * 60000) return;
      if (api.status().running) return; // máy chủ API đang bật: giữ mô hình
      await engine.unloadModel(); send('model:status', engine.status());
      send('perf:unloaded', { id: st.id, minutes: p.idleUnloadMin }); log(`[hiệu năng] đã gỡ ${st.id} sau ${p.idleUnloadMin} phút không dùng`);
    } catch {}
  }, 60000);
  if (idleUnloadTimer.unref) idleUnloadTimer.unref();
}
async function loadById(id, { force = false, ctx = null, reason = null } = {}) {
  const m = listModels().find(x => x.id === id);
  if (!m) throw new Error(`Không tìm thấy mô hình "${id}"`);
  send('model:status', { loading: true, id });
  try {
    let st;
    try { verifyGguf(m); } catch (e) { engineLog('Tệp mô hình không hợp lệ: ' + m.file, e, { path: m.path, size: m.size }); throw e; }
    // Kiểm tra bộ nhớ trước khi nạp: mô hình lớn hơn RAM trống + VRAM thì cảnh báo và gợi ý bản nhỏ hơn
    if (!force) {
      const h = await hw(); const os_ = require('os');
      const freeRam = process.platform === 'darwin' ? os_.totalmem() * 0.7 : os_.freemem();
      const vr = h.gpu && h.gpu !== 'metal' && h.vram ? (h.vram.free || h.vram.total || 0) * 0.9 : 0;
      const need = m.size * 1.05 + 0.5 * 1024 ** 3;
      if (need > freeRam + vr) {
        const e = new Error(`Mô hình cần khoảng ${(need / 1024 ** 3).toFixed(1)} GB nhưng máy chỉ còn khoảng ${((freeRam + vr) / 1024 ** 3).toFixed(1)} GB trống (RAM${vr ? ' + VRAM' : ''}). Nạp vẫn có thể được nhưng máy sẽ rất chậm hoặc treo. Nên đóng bớt ứng dụng hoặc chọn bản nhỏ hơn (Q4_K_M, Q3_K_M hoặc mô hình ít tham số hơn) trong Kho mô hình.`);
        e.code = 'LOW_MEM'; e.modelId = m.id; e.catalogId = m.catalog ? m.catalog.id : null; throw e;
      }
    }
    if (pendingEngineRestart && engine.restart) { const env = pendingEngineRestart; pendingEngineRestart = null; await engine.restart(env, 'áp dụng cài đặt GPU đã đổi'); hwCache = null; }
    const gl = settings.data.gpuLayers;
    const pf = await perfProfile();
    let ctxWant = ctx || settings.data.contextSize || pf.ctx, ctxNote = null;
    if (!ctx && ctxWant > 8192) { // GPU rời ≤ 6 GB: ngữ cảnh 16k làm bộ đệm KV tràn VRAM/RAM → giới hạn 8192
      const h = await hw(); const vt = h.gpu && h.gpu !== 'metal' && h.vram && !h.vram.integratedOnly ? h.vram.total : 0;
      if (vt > 0 && vt < 6 * 1024 ** 3) { ctxNote = `Đã giới hạn độ dài ngữ cảnh ở 8192 (bạn chọn ${ctxWant}) vì GPU chỉ có ${(vt / 1024 ** 3).toFixed(1)} GB VRAM.`; ctxWant = 8192; }
    }
    const opts = { contextSize: ctxWant, perf: pf, fileSize: m.size, ...(Number.isInteger(gl) && gl >= 0 ? { gpuLayers: gl } : {}), ...(m.mmproj && settings.data.vision !== false ? { mmproj: m.mmproj } : {}) };
    LOG.log('load', `Bắt đầu nạp ${m.file}`, { size: m.size, ctx: opts.contextSize, gpuLayers: opts.gpuLayers ?? 'tự động', vision: !!opts.mmproj });
    const tLoad = Date.now();
    try {
      try { st = await engine.loadModel(m.id, m.path, opts); }
      catch (e) {
        // GPU (Vulkan/CUDA/Metal) không nạp được: ghi nhật ký, khởi động lại bộ máy ở chế độ chỉ CPU rồi thử lại một lần
        if (!(e.code === 'LOAD_FAILED' && e.gpu && engine.restart)) throw e;
        engineLog('GPU không nạp được ' + m.file + ', thử lại bằng bộ máy chỉ CPU', e, { path: m.path, size: m.size });
        await engine.restart({ ...engineEnv(), AIVN_GPU: 'off' }, 'GPU không nạp được mô hình, chuyển sang chỉ CPU'); hwCache = null;
        st = await engine.loadModel(m.id, m.path, opts);
        st = { ...st, mode: 'cpu-only', fallbackFrom: [...(e.attempts || []).map(a => a.mode + ': ' + a.message), ...(st.fallbackFrom || [])] };
        settings.data.gpu = false; settings.save(); // lần sau mở AIVN dùng CPU luôn (bật lại trong Cài đặt trò chuyện)
      }
    } catch (e) {
      const a = String(e.message).match(/unknown model architecture: '([^']+)'/i);
      if (a) throw new Error(`Kiến trúc mô hình "${a[1]}" chưa được hỗ trợ bởi llama.cpp ${hf.llamaCpp} trong AIVN. Hãy chờ bản AIVN mới hơn.`);
      if (/mmproj|clip/i.test(m.file)) throw new Error('Đây là tệp thị giác (mmproj), không phải mô hình trò chuyện.');
      if (e.code === 'VCREDIST') { send('vision:vcredist', { url: VCREDIST_URL }); throw new Error('Chế độ nhìn ảnh cần bộ thư viện Microsoft Visual C++ (bản 2015–2022, x64). Hãy cài từ trang chính thức của Microsoft rồi nạp lại mô hình.'); }
      if (e.code === 'NO_SERVER') throw new Error('Bản AIVN này thiếu thành phần nhìn ảnh (llama-server). Hãy cài lại AIVN.');
      engineLog('Không nạp được mô hình ' + m.file, e, { path: m.path, size: m.size, vision: !!m.mmproj, contextSize: settings.data.contextSize });
      const n = Array.isArray(e.attempts) ? e.attempts.length : 0;
      const x = new Error(`Không nạp được ${m.catalog ? m.catalog.name : m.file}${n ? ` (đã thử ${n} cách: GPU, GPU một phần, CPU)` : ''}. Lỗi: ${e.message}. Chi tiết đã ghi vào nhật ký (Mô hình của tôi → Mở thư mục nhật ký).`);
      x.code = 'LOAD_FAILED'; throw x;
    }
    if (st.fallbackFrom && st.fallbackFrom.length) { engineLog('Nạp ' + m.file + ' bằng chế độ dự phòng: ' + st.mode, null, { attempts: st.fallbackFrom }); st.notice = `GPU không nạp được mô hình này, AIVN đã chuyển sang chế độ ${MODE_VI[st.mode] || st.mode} (chậm hơn nhưng vẫn dùng được).`; }
    lastCtx = st.contextSize || lastCtx; engineDied = false;
    if (ctxNote) { st = { ...st, notice: [st.notice, ctxNote].filter(Boolean).join(' ') }; LOG.log('load', ctxNote); }
    if (reason) LOG.log('load', 'Lý do nạp lại: ' + reason);
    LOG.log('load', `Đã nạp ${m.file} sau ${Date.now() - tLoad} ms`, { mode: st.mode, ctx: st.contextSize, gpu: st.gpu, gpuLayers: st.gpuLayers, totalLayers: st.totalLayers, toolMode: st.toolMode, fallbackFrom: st.fallbackFrom });
    settings.data.lastModel = m.id; settings.save(); lastUse = Date.now();
    send('model:status', st);
    return st;
  } catch (e) { send('model:status', engine.status()); throw e; }
}

async function ensureModel(requested) {
  const st = engine.status();
  if (requested) {
    const req = String(requested).toLowerCase().replace(/\.gguf$/, '');
    if (st.loaded && (st.id === req || st.id.includes(req))) return;
    const m = listModels().find(x => x.id === req) || listModels().find(x => x.id.includes(req));
    if (m) return void (await loadById(m.id));
    if (st.loaded) return; // dùng mô hình đang nạp nếu tên không khớp
    throw new Error(`Mô hình "${requested}" chưa có trên máy`);
  }
  if (!st.loaded) throw new Error('Chưa nạp mô hình nào. Hãy nạp mô hình trong AIVN hoặc chỉ định "model".');
}


// ---------- Hỏi đáp tài liệu (RAG) ----------
const VCREDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
let rag = null; // khởi tạo khi có paths
const embedPath = () => path.join(paths.models, ...EMBED.repo.split('/'), EMBED.file);
function embedInfo() {
  let st = null; try { st = fs.statSync(embedPath()); } catch {}
  const installed = !!st && st.size === EMBED.size;
  const job = downloader ? downloader.get(`${EMBED.repo}::${EMBED.file}`) : null;
  return { id: EMBED.id, name: EMBED.name, size: EMBED.size, license: EMBED.license, repo: EMBED.repo, installed, mtime: st ? st.mtimeMs : null, enabled: settings.data.rag !== false, job };
}
let embedLoading = null;
async function ensureEmbedder() {
  if (!embedInfo().installed) return false;
  const st = await engine.embedStatus();
  if (st.loaded) return true;
  embedLoading ||= engine.embedLoad(EMBED.id, embedPath(), { prefix: EMBED.prefix }).finally(() => { embedLoading = null; });
  await embedLoading;
  return true;
}
const ragActive = () => settings.data.rag !== false && embedInfo().installed;

// ---------- AIVN AGENT ----------
// Ghi nhớ: dùng BGE-M3 nếu đã tải (tìm theo ý nghĩa), không thì theo từ khoá
async function embedForMemory() {
  if (!ragActive()) return {};
  try { if (!(await ensureEmbedder())) return {}; } catch { return {}; }
  return { embed: (arr, kind) => engine.embed(arr, kind), model: EMBED.id };
}
// Mô hình nhỏ (< ~3,5 tỉ tham số) thường gọi công cụ sai: hiện cảnh báo trong AIVN AGENT
function agentAdvice() {
  const st = engine.status(); if (!st.loaded) return null;
  const m = listModels().find(x => x.path === st.path) || null;
  const p = m && m.catalog && m.catalog.params ? parseFloat(String(m.catalog.params).replace(',', '.')) : null;
  const small = p != null ? p < 3.5 : m ? m.size < 2.2e9 : false;
  const recommended = catalog.filter(c => require('./recommend').PLANNERS.includes(c.id)).map(c => ({ id: c.id, name: c.name, size: c.size + (c.mmproj ? c.mmproj.size : 0), installed: isInstalled(c.file) }));
  const tools = toolSupport({ toolLevel: m && m.catalog ? m.catalog.toolLevel : null, id: m && m.catalog ? m.catalog.id : '', name: m && m.catalog ? m.catalog.name : (m && m.name) || '', file: m ? m.file : st.id, params: m && m.catalog ? m.catalog.params : null, meta: st.meta, toolMode: st.toolMode, wrapper: st.chatWrapper, size: m ? m.size : 0 });
  return { model: m ? (m.catalog ? m.catalog.name : m.file) : st.id, params: p, small, good: !!(m && m.catalog && m.catalog.agent), planner: !!(m && m.catalog && require('./recommend').PLANNERS.includes(m.catalog.id)), recommended, tools, toolMode: st.toolMode || null };
}
function agentInfo() {
  const py = sandbox.findPython();
  return { folders: (settings.data.agentFolders || []).map(f => ({ path: f, name: path.basename(f), exists: (() => { try { return fs.statSync(f).isDirectory(); } catch { return false; } })() })),
    web: !!settings.data.agentWeb, python: { enabled: !!settings.data.agentPython, available: !!py, version: py ? py.version : null }, memory: { enabled: settings.data.agentMemory !== false, count: memory.count(), semantic: ragActive() },
    tools: agent.activeTools().map(n => ({ name: n, label: agent.defs[n].label, icon: agent.defs[n].icon })), computer: computerInfo(), toolsOff: settings.data.agentToolsOff || [], alwaysAllow: (settings.data.agentAlwaysAllow || []).map(n => ({ name: n, label: (agent.defs[n] && agent.defs[n].label) || n })), welcome: WELCOME, advice: agentAdvice(), keepInTray: !!settings.data.keepInTray, openAtLogin: !!settings.data.openAtLogin };
}
// Xác nhận xoá/ghi đè: hộp thoại tiếng Việt trong cửa sổ AIVN; không trả lời trong 5 phút = từ chối
const confirms = new Map();
let confirmSeq = 0;
function askConfirm(req) {
  if (!win || win.isDestroyed()) return Promise.resolve(false);
  if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus();
  const id = 'c' + (++confirmSeq);
  return new Promise((resolve) => {
    const t = setTimeout(() => { confirms.delete(id); send('agent:confirm-cancel', { id }); resolve(false); }, 5 * 60e3);
    confirms.set(id, (ok) => { clearTimeout(t); confirms.delete(id); resolve(!!ok); });
    send('agent:confirm', { id, ...req });
    if (isTest) console.log(`[xác nhận] ${req.kind}: ${req.message}`);
  });
}
// Thẻ xin phép chung (Cho phép / Từ chối / Từ chối kèm lý do / Luôn cho phép) — trả { ok, reason, always }
function askApproval(card) {
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: false });
  if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus();
  const id = 'p' + (++confirmSeq);
  return new Promise((resolve) => {
    const t = setTimeout(() => { confirms.delete(id); send('agent:approve-cancel', { id }); resolve({ ok: false, reason: '' }); }, 10 * 60e3);
    confirms.set(id, (r) => { clearTimeout(t); confirms.delete(id); resolve(r && typeof r === 'object' ? { ok: r.ok === true, reason: String(r.reason || '').slice(0, 500), always: r.always === true } : { ok: r === true }); });
    send('agent:approve', { id, ...card });
    LOG.log('agent', `Xin phép: ${card.title} (${card.tool})`);
    if (isTest && process.env.AIVN_APPROVE_AUTO) setTimeout(() => { const f = confirms.get(id); if (f) f(process.env.AIVN_APPROVE_AUTO === 'allow' ? { ok: true } : { ok: false, reason: process.env.AIVN_APPROVE_AUTO.replace(/^deny:?/, '') }); }, 200);
  });
}
const slimStep = (x) => ({ id: x.id, name: x.name, label: x.label, icon: x.icon, args: x.args, status: x.status, summary: x.summary, detail: typeof x.detail === 'string' ? x.detail.slice(0, 4000) : x.detail, urls: x.urls, ms: x.ms, pre: x.pre, thumb: x.thumb && typeof x.thumb.src === 'string' && x.thumb.src.length < 120000 ? x.thumb : undefined });
async function runAgentTurn({ reqId, convoId, messages, headless = false, signal, attachments = [] }) {
  if (!engine.status().loaded) {
    if (headless && settings.data.lastModel) await loadById(settings.data.lastModel);
    else throw new Error('Chưa nạp mô hình nào. Hãy chọn mô hình ở thanh phía trên (gợi ý: Qwen3 4B Instruct 2507 hoặc Qwen3 8B, gọi công cụ tốt).');
  }
  const comp = !headless && agent.activeTools({ headless }).some(n => n === 'screen_act' || n === 'screen_look'); // phím dừng khẩn cấp toàn cục chỉ khi điều khiển màn hình (Ctrl+Alt+Q trùng AltGr+Q trên một số bàn phím)
  if (comp) computerSessionStart();
  const files = (Array.isArray(attachments) ? attachments : []).filter(f => f && typeof f.path === 'string' && path.isAbsolute(f.path) && fs.existsSync(f.path) && fs.statSync(f.path).isFile()).slice(0, 10);
  const tb = tokenBatcher(reqId);
  try { return await agent.run({ messages, convoId, signal, headless, attachments: files, confirm: (...a) => { tb.flush(); return askConfirm(...a); }, confirmScreen: (...a) => { tb.flush(); return askScreen(...a); }, approve: (card) => { tb.flush(); return askApproval(card); },
    onToken: (t) => reqId && tb.push(t),
    onStep: (st) => { tb.flush(); reqId && send('agent:step', { reqId, step: slimStep(st) }); },
    onStatus: (st) => { tb.flush(); reqId && send('agent:status', { reqId, ...st }); } }); }
  finally { tb.flush(); if (comp) computerSessionEnd(); if (desk && desk.active()) desk.end(signal && signal.aborted ? 'đã dừng' : 'xong lượt'); }
}
// ---------- Điều khiển máy tính kiểu desktop agent (quan sát → thao tác → kiểm tra) ----------
let desk = null;
let mcp = null;
function getDesk() {
  if (desk) return desk;
  const { createDesktopAgent } = require('./desktop-agent');
  desk = createDesktopAgent({ engine, getSettings: () => settings.data, setSettings: (p) => { Object.assign(settings.data, p); settings.save(); send('settings:changed', p); },
    log: (scope, m) => LOG.log(scope, m), getMainWindow: () => win, preload: path.join(__dirname, 'preload.js'), isTest: isTest && process.env.AIVN_DESK_KEEPWIN === '1', autoTest: !app.isPackaged && !!process.env.AIVN_DESK_AUTO,
    autoAnswer: !app.isPackaged && process.env.AIVN_DESK_AUTO ? (req) => ({ ok: process.env.AIVN_DESK_AUTO !== 'deny' && !(req.risk && process.env.AIVN_DESK_AUTO === 'safe'), reason: req.risk && process.env.AIVN_DESK_AUTO === 'safe' ? 'Đừng gửi, chỉ soạn sẵn' : '' }) : null,
    onStop: (reason) => stopComputer(reason), grounder: getGrounder });
  return desk;
}
// Chế độ hai mô hình: mô hình định vị (nhìn ảnh) chạy song song với mô hình lập kế hoạch (mô hình chữ)
async function getGrounder(force) {
  const id = force || settings.data.agentGrounder; if (!id || !engine.groundLoad) return null;
  const m = listModels().find(x => x.id === id && x.mmproj); if (!m) return null;
  const st = engine.groundStatus();
  if (!(st && st.loaded && st.id === m.id)) {
    LOG.log('load', `Nạp mô hình định vị ${m.file}`, { mmproj: path.basename(m.mmproj) }); const t = Date.now();
    await engine.groundLoad(m.id, m.path, m.mmproj, { contextSize: 4096, gpu: settings.data.gpu !== false });
    LOG.log('load', `Đã nạp mô hình định vị sau ${Date.now() - t} ms`);
  }
  return { id: m.path, engine: { generate: (msgs, o) => engine.groundGenerate(msgs, o) } };
}
async function deskWrap(fn, a, ctx) {
  screenGuard(ctx.signal);
  const d = getDesk();
  if (!d.active() && ctx.lastOpenedApp) await d.adoptApp(ctx.lastOpenedApp, ctx);
  return fn.call(d, a, ctx);
}
// ---------- Truy cập máy tính: dừng khẩn cấp, thẻ duyệt thao tác màn hình ----------
const STOP_KEY = 'CommandOrControl+Alt+Q';
let compSessions = 0, stopWin = null;
function computerSessionStart() { if (++compSessions === 1) { try { globalShortcut.register(STOP_KEY, () => stopComputer('phím tắt ' + STOP_KEY)); } catch {} } }
function computerSessionEnd() { compSessions = Math.max(0, compSessions - 1); if (!compSessions) { try { globalShortcut.unregister(STOP_KEY); } catch {} hideStopBar(); } }
// Dừng khẩn cấp: huỷ mọi lượt AIVN AGENT đang chạy, từ chối mọi thẻ đang chờ, hiện lại cửa sổ
function stopComputer(reason) {
  let n = 0;
  for (const [id, ac] of generations) { abortGen(id, ac, 'dừng khẩn cấp: ' + reason); n++; }
  if (benchRun && reason !== 'dừng bài đo') { benchRun.abort(); n++; }
  for (const f of [...confirms.values()]) f(false);
  for (const f of [...screenConfirms.values()]) f({ ok: false });
  hideStopBar(); if (desk && desk.active()) desk.end('dừng khẩn cấp: ' + reason);
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); if (!win.isVisible()) win.show(); send('computer:stopped', { reason }); }
  log('[AIVN AGENT] dừng khẩn cấp (' + reason + '), đã huỷ ' + n + ' lượt');
  return n;
}
function showStopBar() {
  if (stopWin && !stopWin.isDestroyed()) { stopWin.showInactive(); return; }
  const d = require('electron').screen.getPrimaryDisplay().workArea;
  stopWin = new BrowserWindow({ width: 360, height: 52, x: Math.round(d.x + d.width / 2 - 180), y: d.y + 8, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  stopWin.setAlwaysOnTop(true, 'screen-saver'); stopWin.setContentProtection(true); // không lọt vào ảnh chụp màn hình
  stopWin.loadFile(path.join(__dirname, 'renderer', 'stop.html'));
  stopWin.once('ready-to-show', () => stopWin && !stopWin.isDestroyed() && stopWin.showInactive());
  stopWin.on('closed', () => { stopWin = null; });
}
function hideStopBar() { if (stopWin && !stopWin.isDestroyed()) stopWin.hide(); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Ẩn cửa sổ AIVN để nhìn/thao tác trên màn hình thật, rồi hiện lại
async function withWindowAway(fn) {
  const w = win && !win.isDestroyed() ? win : null;
  showStopBar();
  if (w) { if (process.platform === 'darwin') w.hide(); else w.minimize(); await sleep(isTest ? 150 : 450); }
  try { return await fn(); }
  finally { if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } }
}
function screenGuard(signal) {
  if (!settings.data.agentScreen) throw new computerTools.CompError('Điều khiển màn hình đang tắt (Cài đặt AIVN AGENT → Điều khiển màn hình).');
  const p = SC.permissions();
  if (p.needed && (p.screen !== 'granted' || !p.accessibility)) throw new computerTools.CompError('macOS chưa cấp quyền cho AIVN: ' + [p.screen !== 'granted' && 'Ghi màn hình', !p.accessibility && 'Trợ năng'].filter(Boolean).join(' và ') + '. Hướng dẫn người dùng mở Cài đặt AIVN AGENT → Điều khiển màn hình → "Hướng dẫn cấp quyền macOS".');
  if (signal && signal.aborted) throw new computerTools.CompError('Đã dừng.');
}
async function captureAway() { const st = engine.status(); const fi = SC.familyInfo((st && (st.path || st.id)) || ''); return withWindowAway(() => process.env.AIVN_FAKE_SCREEN && !app.isPackaged ? fakeShot() : SC.capture({ align: fi.align })); }
function fakeShot() { // chỉ để kiểm thử: ảnh màn hình giả từ tệp
  const img = nativeImage.createFromPath(process.env.AIVN_FAKE_SCREEN); const sz = img.getSize();
  return { dataUrl: 'data:image/jpeg;base64,' + img.toJPEG(80).toString('base64'), width: sz.width, height: sz.height, display: require('electron').screen.getPrimaryDisplay() };
}
async function screenLook(a, ctx) {
  screenGuard(ctx.signal);
  const shot = await captureAway();
  const text = await SC.describe(engine, shot, a.question, { signal: ctx.signal });
  return { forModel: `Màn hình hiện tại (do mô hình nhìn ảnh mô tả, có thể chưa chính xác):\n${text}`, summary: text.split('\n')[0].slice(0, 120), detail: text };
}
const ACT_VI = { click: 'bấm chuột trái vào', double_click: 'bấm đúp vào', right_click: 'bấm chuột phải vào', type: 'gõ chữ', key: 'bấm phím', scroll: 'cuộn màn hình' };
async function screenAct(a, ctx) {
  screenGuard(ctx.signal);
  const action = String(a.action || ''); if (!ACT_VI[action]) throw new computerTools.CompError('action không hợp lệ: ' + action);
  if (action === 'key') SC.parseKeys(a.keys); // kiểm tra trước (chặn tổ hợp hệ thống)
  if (action === 'type' && !String(a.text || '')) throw new computerTools.CompError('Thiếu text cần gõ.');
  const needPoint = ['click', 'double_click', 'right_click'].includes(action) || ((action === 'type' || action === 'scroll') && a.target);
  if (needPoint && !String(a.target || '').trim()) throw new computerTools.CompError('Cần mô tả target (phần tử cần bấm).');
  const shot = await captureAway();
  let box = null, raw = '';
  if (needPoint) { const st = engine.status(); const r = await SC.locate(engine, shot, String(a.target), { signal: ctx.signal, modelId: (st && (st.path || st.id)) || '' }); box = r.box; raw = r.raw; }
  if (ctx.signal && ctx.signal.aborted) throw new computerTools.CompError('Đã dừng.');
  const desc = action === 'type' ? `gõ “${String(a.text).slice(0, 200)}”${a.target ? ` vào ${a.target}` : ' vào ô đang chọn'}` : action === 'key' ? `bấm phím ${a.keys}` : action === 'scroll' ? `cuộn ${Number(a.amount) < 0 || a.amount == null ? 'xuống' : 'lên'} ${Math.abs(Number(a.amount) || 5)} nấc` : `${ACT_VI[action]} “${a.target}”`;
  const req = { action, desc, target: a.target || null, image: shot.dataUrl, w: shot.width, h: shot.height, needPoint: !!needPoint,
    box: box && box.found ? box : null, notFound: needPoint && !(box && box.found) ? (box && box.why) || 'Mô hình không tìm thấy phần tử này. Bạn có thể bấm vào ảnh để tự chọn vị trí.' : null };
  const ans = settings.data.agentScreenAuto === true && req.box ? { ok: true } : await askScreen(req);
  if (!ans || !ans.ok) return { refused: true, forModel: 'Người dùng KHÔNG đồng ý thao tác này (hoặc đã bấm Dừng). Dừng điều khiển màn hình và hỏi người dùng muốn làm gì.', summary: 'Người dùng từ chối: ' + desc };
  let nx = null, ny = null;
  if (needPoint) { if (ans.nx != null) { nx = ans.nx; ny = ans.ny; } else if (req.box) { nx = (req.box.x1 + req.box.x2) / 2; ny = (req.box.y1 + req.box.y2) / 2; } else return { refused: true, forModel: 'Không xác định được vị trí.', summary: 'Không có vị trí' }; }
  if (ctx.signal && ctx.signal.aborted) throw new computerTools.CompError('Đã dừng.');
  await withWindowAway(async () => { await SC.perform({ action, nx, ny, text: a.text, keys: a.keys, amount: a.amount, display: shot.display }); await sleep(500); });
  return { forModel: `Đã ${desc}${nx != null ? ` tại vị trí (${Math.round(nx * 1000)}, ${Math.round(ny * 1000)}) trên thang 1000` : ''}. Hãy dùng screen_look để kiểm tra kết quả trước khi làm bước tiếp theo.`, summary: 'Đã ' + desc + (ans.nx != null ? ' (vị trí do bạn chọn)' : '') };
}
const screenConfirms = new Map(); let screenSeq = 0;
function askScreen(req) {
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: false });
  if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus();
  const id = 's' + (++screenSeq);
  return new Promise((resolve) => {
    const t = setTimeout(() => { screenConfirms.delete(id); send('agent:screen-cancel', { id }); resolve({ ok: false }); }, 3 * 60e3);
    screenConfirms.set(id, (r) => { clearTimeout(t); screenConfirms.delete(id); resolve(r || { ok: false }); });
    send('agent:screen', { id, ...req });
    if (isTest) console.log(`[duyệt màn hình] ${req.desc} box=${JSON.stringify(req.box)}`);
  });
}
function computerInfo() {
  const p = SC.permissions();
  return { enabled: settings.data.agentComputer !== false, screen: !!settings.data.agentScreen, screenMode: settings.data.agentScreenMode || 'each', grounder: settings.data.agentGrounder || null, grounders: listModels().filter(m => m.mmproj).map(m => ({ id: m.id, name: m.catalog ? m.catalog.name : m.file })), screenBudget: settings.data.agentScreenBudget || 40, autoReadOnly: settings.data.agentAutoReadOnly === true, vision: !!engine.status().vision, platform: process.platform, perms: p, stopKey: process.platform === 'darwin' ? '⌘⌥Q' : 'Ctrl+Alt+Q' };
}


// ---------- Lịch tự động ----------
let lastNotice = null;
function notify(title, body, convoId) {
  if (gated()) { title = 'AIVN'; body = 'Có thông báo mới. Mở khoá AIVN để xem.'; convoId = null; } // không lộ nội dung khi đang khoá
  lastNotice = { title, body, at: Date.now(), supported: Notification.isSupported(), shown: false };
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body: String(body || '').slice(0, 240), icon: path.join(__dirname, '..', 'build', 'icons', '128x128.png') });
  n.on('show', () => { if (lastNotice) lastNotice.shown = true; });
  n.on('click', () => { showWindow(); if (convoId) send('convos:open', { id: convoId }); });
  n.show();
}
const fmtNow = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };
async function onScheduleFire(t, { late, manual }) {
  const convoId = 'sched_' + t.id;
  let c = convos.data.list.find(x => x.id === convoId);
  if (!c) { c = { id: convoId, title: '⏰ ' + t.title, mode: 'agent', scheduleId: t.id, messages: [], createdAt: Date.now(), updatedAt: Date.now() }; convos.data.list.unshift(c); }
  const tag = { id: t.id, at: Date.now(), late: !!late, manual: !!manual };
  let summary;
  if (t.kind === 'reminder') {
    c.messages.push({ role: 'assistant', content: `⏰ **${t.title}**${t.message ? '\n' + t.message : ''}`, model: 'Lịch tự động', scheduled: tag });
    summary = t.message || t.title;
  } else {
    c.messages.push({ role: 'user', content: t.prompt, scheduled: tag });
    const ac = new AbortController(); generations.set('sched:' + t.id, ac);
    try {
      const prior = c.messages.slice(-7, -1).filter(m => m.role === 'assistant' && m.content).map(m => ({ role: 'assistant', content: m.content }));
      const r = await runAgentTurn({ convoId, headless: true, signal: ac.signal, messages: [...prior.slice(-2), { role: 'user', content: t.prompt }] });
      c.messages.push({ role: 'assistant', content: r.text || '(AIVN AGENT không trả lời)', steps: r.steps.map(slimStep), urls: r.urls, model: engine.status().id, scheduled: tag });
      summary = r.text;
    } catch (e) {
      c.messages.push({ role: 'assistant', content: '⚠ Không chạy được việc tự động: ' + e.message, error: true, model: 'Lịch tự động', scheduled: tag });
      summary = 'Lỗi: ' + e.message;
      throw e;
    } finally { generations.delete('sched:' + t.id); }
  }
  c.updatedAt = Date.now();
  convos.data.list.sort((a, b) => b.updatedAt - a.updatedAt); convos.save();
  send('convos:changed', { id: convoId }); send('sched:changed', {});
  if (t.notify !== false) notify(`⏰ ${t.title}${late ? ' (trễ)' : ''}`, String(summary || '').replace(/[*_`#]/g, '').slice(0, 200), convoId);
  return { ok: true, convoId, summary: String(summary || '').slice(0, 200) };
}

// ---------- Chạy nền (khay hệ thống) và mở cùng hệ điều hành ----------
function showWindow() { if (!win || win.isDestroyed()) createWindow(); else { if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus(); } }
function applyBackgroundPrefs() {
  if (settings.data.keepInTray && !tray) {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icons', process.platform === 'darwin' ? '16x16.png' : '32x32.png'));
    tray = new Tray(img);
    tray.setToolTip('AIVN · Lịch tự động vẫn chạy');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Mở AIVN', click: showWindow }, { type: 'separator' }, { label: 'Thoát AIVN', click: () => { quitting = true; app.quit(); } }]));
    tray.on('click', showWindow);
  } else if (!settings.data.keepInTray && tray) { tray.destroy(); tray = null; }
  // mở cùng hệ điều hành: Windows/macOS dùng API của Electron, Linux ghi tệp ~/.config/autostart (chỉ bản đã đóng gói)
  const want = !!settings.data.openAtLogin;
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: want, openAsHidden: want && !!settings.data.keepInTray, args: settings.data.keepInTray ? ['--hidden'] : [] });
    } else if (process.platform === 'linux') {
      const f = path.join(app.getPath('home'), '.config', 'autostart', 'aivn.desktop');
      const exe = process.env.APPIMAGE || (app.isPackaged ? process.execPath : null);
      if (want && exe) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=AIVN\nComment=Chạy mô hình AI ngay trên máy tính của bạn\nExec="${exe}"${settings.data.keepInTray ? ' --hidden' : ''}\nX-GNOME-Autostart-enabled=true\n`); }
      else if (!want) fs.rmSync(f, { force: true });
    }
  } catch (e) { console.warn('[đăng nhập] ' + e.message); }
}

// Đóng gói tài liệu vào tin nhắn cuối, vừa với ngân sách ngữ cảnh của mô hình.
// Có mô hình nhúng: tìm đoạn liên quan bằng vector (lưu chỉ mục theo cuộc trò chuyện). Không có: cách cũ theo từ khoá.
async function packForPrompt(messages, attached, maxTokens, { convoId, reqId } = {}) {
  const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';
  await engine.calibrate([...messages.map(m => textOf(m.content)), ...attached.map(a => a.text)]).catch(() => {});
  const st = engine.status();
  const ctx = st.contextSize || settings.data.contextSize || 4096;
  const last = messages[messages.length - 1];
  const question = textOf(last.content);
  const used = engine.countTokens(messages.map(m => textOf(m.content)).join('\n')) + 64 * messages.length;
  const reserve = Math.min(maxTokens || 1024, Math.floor(ctx / 3));
  const budget = Math.max(256, ctx - used - reserve - 256);
  const count = (t) => engine.countTokens(t);
  const texts = attached.filter(a => a.kind !== 'image');
  const images = attached.filter(a => a.kind === 'image');

  let useRag = false;
  if (convoId && ragActive() && (texts.length || rag.has(convoId))) {
    try { useRag = await ensureEmbedder(); } catch (e) { console.warn('[rag] không nạp được mô hình nhúng:', e.message); useRag = false; }
  }
  if (useRag) {
    try {
      const embed = (arr, kind) => engine.embed(arr, kind);
      if (texts.length) {
        send('chat:ragprogress', { reqId, stage: 'index', done: 0, total: 0 });
        await rag.addDocuments(convoId, texts, { embed, model: EMBED.id, onProgress: (p) => send('chat:ragprogress', { reqId, stage: 'index', ...p }) });
      }
      let imgBlock = null, imgTok = 0;
      if (images.length) { const pi = docs.packDocuments(question, images, Math.floor(budget / 3), count); imgBlock = pi.block; imgTok = imgBlock ? count(imgBlock) : 0; }
      const ragBudget = Math.max(300, budget - imgTok);
      const k = Math.max(2, Math.min(6, Math.floor(ragBudget / 520)));
      send('chat:ragprogress', { reqId, stage: 'search' });
      const r = await rag.retrieve(convoId, question, { embed, model: EMBED.id, k, budget: ragBudget, countTokens: count });
      if (r) {
        const block = [imgBlock, r.block].filter(Boolean).join('\n\n');
        const content = buildRagContent(question, block);
        return { messages: [...messages.slice(0, -1), { ...last, content: withParts(last.content, content) }], docInfo: { mode: 'rag', truncated: false, files: [], budget, sources: r.sources, totalChunks: r.totalChunks, context: null } };
      }
    } catch (e) { console.warn('[rag] lỗi, dùng cách tìm theo từ khoá:', e.message); }
  }
  if (!attached.length) return { messages, docInfo: null };
  const packed = docs.packDocuments(question, attached, budget, count);
  const content = docs.buildUserContent(question, packed.block);
  return { messages: [...messages.slice(0, -1), { ...last, content: withParts(last.content, content) }], docInfo: { mode: 'keyword', truncated: packed.truncated, files: packed.files, budget, context: content, ragAvailable: !embedInfo().installed && texts.length > 0 } };
}
// Giữ phần ảnh (image_url) khi thay nội dung chữ của tin nhắn
function withParts(orig, text) {
  if (!Array.isArray(orig)) return text;
  return [{ type: 'text', text }, ...orig.filter(x => x && x.type === 'image_url')];
}

const api = createApiServer({ engine, models: listModels, ensureModel, log, isBlocked: () => !activated() ? 'AIVN chưa được kích hoạt trên máy này.' : isLocked() ? 'AIVN đang khoá. Hãy mở khoá ứng dụng để dùng máy chủ API.' : null, embeddings: {
  info: () => embedInfo(),
  async ensure(model) {
    if (model && !String(model).toLowerCase().includes('bge') && String(model).toLowerCase() !== EMBED.id && !/embed/i.test(model)) {
      const e = new Error(`Mô hình nhúng "${model}" không có. AIVN dùng "${EMBED.id}".`); e.status = 404; throw e;
    }
    if (!embedInfo().installed) { const e = new Error(`Chưa tải mô hình nhúng "${EMBED.id}". Hãy mở AIVN → Cài đặt → Tìm kiếm tài liệu để tải.`); e.status = 400; throw e; }
    await ensureEmbedder();
    return { id: EMBED.id };
  },
  embed: (texts) => engine.embed(texts, 'passage'),
  count: (texts) => Promise.resolve(engine.embedCount(texts)).then(a => a.reduce((s, x) => s + x, 0)), // engine trong tiến trình trả mảng ngay, qua proxy trả Promise
} });
const updater = createUpdater({ send, log: (m) => console.log(m) });

// ---------- Tải mô hình ----------
const safeRepo = (r) => typeof r === 'string' && /^[\w.-]+\/[\w.-]+$/.test(r) && !r.includes('..');
const safeFile = (f) => typeof f === 'string' && /\.gguf$/i.test(f) && !f.split('/').some(x => x === '..' || x === '') && !f.startsWith('/');
function annotateGroup(repo, g) {
  const job = downloader.get(`${repo}::${g.files[0].path}`);
  const part = downloader.partialFor(repo, g.files);
  return { ...g, installed: part.complete || isInstalled(g.files[0].path), partial: part.complete ? 0 : part.received, job };
}
function catalogList() {
  let H = null;
  return hw().then(h => (H = h, catalog.map(c => {
    const job = downloader.get(`${c.repo}::${c.file}`);
    const part = downloader.partialFor(c.repo, [{ path: c.file, size: c.size }, ...(c.mmproj ? [{ path: c.mmproj.file, size: c.mmproj.size }] : [])]);
    return { ...c, installed: part.complete || isInstalled(c.file), partial: part.complete ? 0 : part.received, job, fit: hf.fitFor(c.size + (c.mmproj ? c.mmproj.size : 0), h), tools: toolSupport(c) };
  }))).then(list => {
    // Một bộ gợi ý duy nhất (src/recommend.js): Qwen3 cho trò chuyện/công cụ; nhãn "Gợi ý" cho điều khiển máy chỉ khi đã qua bài đo Điểm tác vụ
    return require('./recommend').annotate(list, benchScores()).list;
  });
}

// ---------- IPC ----------
function registerIpc() {
  // Mọi kênh IPC (trừ cổng) bị chặn khi chưa kích hoạt hoặc đang khoá: không dữ liệu nào tới giao diện
  const rawHandle = ipcMain.handle.bind(ipcMain);
  registerGateIpc(rawHandle);
  rawHandle('computer:stop', () => stopComputer('nút Dừng ngay'));
  // Quản trị: dùng được cả ở màn hình kích hoạt (chủ sở hữu tự kích hoạt máy mình), không dùng khi app đang khoá
  const ah = (ch, fn) => rawHandle(ch, async (e, ...a) => { if (gateMode() === 'lock') throw new Error('AIVN đang khoá'); return fn(e, ...a); });
  ah('admin:state', () => ({ ...admin.state(), machineCode: lic.publicInfo().machineCode }));
  ah('admin:import', async (_e, { pass }) => {
    const r = await dialog.showOpenDialog(win, { title: 'Chọn tệp khoá quản trị (aivn-admin-key.json)', properties: ['openFile'], filters: [{ name: 'Khoá quản trị AIVN', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true, ...admin.state() };
    const st = fs.statSync(r.filePaths[0]); if (st.size > 20000) throw new Error('Tệp quá lớn, không phải khoá quản trị');
    return admin.importKey(fs.readFileSync(r.filePaths[0], 'utf8'), String(pass || ''));
  });
  ah('admin:unlock', (_e, pass) => admin.unlock(String(pass || '')));
  ah('admin:lock', () => admin.lock());
  ah('admin:forget', () => admin.forget());
  ah('admin:token', (_e, t) => admin.setToken(t));
  ah('admin:issue', (_e, o) => admin.issue(o || {}));
  const saveDoc = async (r) => {
    if (r.published) return { published: true, state: r.state };
    const d = await dialog.showSaveDialog(win, { title: 'Lưu revoked.json (chưa có token GitHub để tự đăng)', defaultPath: 'revoked.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!d.canceled && d.filePath) fs.writeFileSync(d.filePath, JSON.stringify(r.doc, null, 2) + '\n');
    return { published: false, savedTo: d.canceled ? null : d.filePath, state: r.state };
  };
  ah('admin:revoke', async (_e, id) => saveDoc(await admin.revoke(id)));
  ah('admin:publish', async () => saveDoc(await admin.publish()));
  ah('admin:self-activate', async (_e, { name }) => {
    const r = admin.issue({ name: String(name || 'Chủ sở hữu').slice(0, 60), machineCode: lic.machineCode(), days: null });
    lic.activate(r.code); licenseCheck().catch(() => {}); if (activated()) startServices(); loadUi();
    return { ok: true, id: r.info.id };
  });
  ipcMain.handle = (ch, fn) => rawHandle(ch, (e, ...a) => { if (gated()) throw new Error(gateMode() === 'activate' ? 'AIVN chưa được kích hoạt' : 'AIVN đang khoá'); return fn(e, ...a); });
  ipcMain.handle('lock:info', () => appLock.info());
  ipcMain.handle('lock:set', async (_e, { password, confirm, current }) => { await appLock.setPassword(password, confirm, current); unlocked = true; return appLock.info(); });
  ipcMain.handle('lock:disable', async (_e, { current }) => { await appLock.disable(current); return appLock.info(); });
  ipcMain.handle('lock:options', (_e, o) => { appLock.setOptions(o || {}); return appLock.info(); });
  ipcMain.handle('lock:now', () => lockNow('bấm Khóa ngay'));
  ipcMain.handle('license:info', () => lic.publicInfo());
  ipcMain.handle('license:check', async () => { const r = await licenseCheck(); return { ok: !!(r && r.ok), error: r && r.error, info: lic.publicInfo() }; });
  ipcMain.handle('app:info', async () => ({ version: app.getVersion(), paths, hardware: await hw(), llamaCpp: hf.llamaCpp }));
  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:set', (_e, patch = {}) => {
    const { hfToken, hfTokenSet, ...rest } = patch;
    Object.assign(settings.data, rest);
    const intOrNull = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
    if ('agentToolsOff' in rest) settings.data.agentToolsOff = [...new Set((Array.isArray(rest.agentToolsOff) ? rest.agentToolsOff : []).filter(g => Object.prototype.hasOwnProperty.call(TOOL_GROUPS, g)))];
    if ('gpuLayers' in rest) settings.data.gpuLayers = intOrNull(rest.gpuLayers, 1000);
    if ('gpuDevice' in rest) settings.data.gpuDevice = intOrNull(rest.gpuDevice, 15);
    if ('vramLimitGB' in rest) settings.data.vramLimitGB = Number(rest.vramLimitGB) > 0 ? Math.min(256, Number(rest.vramLimitGB)) : null;
    if ('agentGrounder' in rest) { settings.data.agentGrounder = typeof rest.agentGrounder === 'string' && rest.agentGrounder ? rest.agentGrounder : null; if (!settings.data.agentGrounder && engine.groundUnload) engine.groundUnload().catch(() => {}); }
    if ('agentScreenMode' in rest) settings.data.agentScreenMode = rest.agentScreenMode === 'important' ? 'important' : 'each';
    if ('agentScreenBudget' in rest) settings.data.agentScreenBudget = Math.max(5, Math.min(100, Math.round(Number(rest.agentScreenBudget) || 40)));
    if (typeof hfToken === 'string') settings.data.hfToken = hfToken.trim().slice(0, 300);
    if ('perfMode' in rest) { settings.data.perfMode = PERF.MODE_VI[rest.perfMode] ? rest.perfMode : 'auto'; perfProfile().then(p => send('perf:changed', p)).catch(() => {}); }
    if ('contextSize' in rest) settings.data.contextSize = [0, 2048, 4096, 8192, 16384, 32768].includes(Number(rest.contextSize)) ? Number(rest.contextSize) : 0;
    if (['light', 'dark', 'system'].includes(settings.data.theme)) require('electron').nativeTheme.themeSource = settings.data.theme;
    if ('theme' in rest && win && !win.isDestroyed()) win.setBackgroundColor(windowBg());
    if ('agentFolders' in rest) settings.data.agentFolders = (Array.isArray(rest.agentFolders) ? rest.agentFolders : []).filter(f => typeof f === 'string' && path.isAbsolute(f)); // chỉ thêm qua hộp thoại chọn thư mục
    settings.save();
    if ('keepInTray' in rest || 'openAtLogin' in rest) applyBackgroundPrefs();
    if (['gpu', 'gpuDevice', 'vramLimitGB'].some(k => k in rest) && engine.restart) { const env = engineEnv(); for (const [k, v] of Object.entries(env)) { if (v) process.env[k] = v; else delete process.env[k]; } hwCache = null;
      // không giết bộ máy khi đang trả lời: áp dụng ở lần nạp mô hình tới / khi rảnh
      if ((engine.busy && engine.busy()) || generations.size) { pendingEngineRestart = env; LOG.log('engine', 'Đổi cài đặt GPU trong lúc đang chạy: sẽ khởi động lại bộ máy khi xong lượt hiện tại'); }
      else engine.restart(env, 'đổi cài đặt GPU').then(() => send('model:status', engine.status())).catch(() => {}); }
    return publicSettings();
  });

  ipcMain.handle('catalog:list', () => catalogList());
  ipcMain.handle('hf:search', (_e, { q, sort } = {}) => hf.search({ q: String(q || '').slice(0, 200), sort, limit: 30, token: settings.data.hfToken || null }));
  ipcMain.handle('hf:repo', async (_e, repo) => {
    if (!safeRepo(repo)) throw new Error('Tên repo không hợp lệ');
    const r = await hf.repoFiles(repo, { token: settings.data.hfToken || null, hw: await hw() });
    const groups = r.groups.map(g => annotateGroup(repo, g));
    // tệp thị giác đã có trên máy chưa (để tải bổ sung cho mô hình đã tải trước đó)
    const mmprojInstalled = !!r.mmproj && fs.existsSync(path.join(paths.models, ...repo.split('/'), r.mmproj.path.split('/').pop()));
    return { ...r, groups, mmprojInstalled };
  });
  ipcMain.handle('dl:start', (_e, spec) => {
    if (spec && spec.catalogId) {
      const c = catalog.find(x => x.id === spec.catalogId); if (!c) throw new Error('Mô hình không có trong danh mục');
      const files = [{ path: c.file, size: c.size }];
      if (c.mmproj) files.push({ path: c.mmproj.file, size: c.mmproj.size });
      return downloader.enqueue({ repo: c.repo, files, name: c.name, quant: c.quant, catalogId: c.id, urlFor: hf.resolveUrl });
    }
    if (!spec || !safeRepo(spec.repo) || !Array.isArray(spec.files) || !spec.files.length || !spec.files.every(f => safeFile(f.path))) throw new Error('Yêu cầu tải không hợp lệ');
    return downloader.enqueue({ repo: spec.repo, files: spec.files.map(f => ({ path: f.path, size: Number(f.size) || 0 })), name: spec.name, quant: spec.quant, urlFor: hf.resolveUrl });
  });
  ipcMain.handle('dl:pause', (_e, id) => downloader.pause(id));
  ipcMain.handle('dl:resume', (_e, id) => downloader.resume(id));
  ipcMain.handle('dl:remove', (_e, id) => downloader.remove(id));
  ipcMain.handle('dl:list', () => downloader.list());
  ipcMain.handle('hw:info', () => hw());
  ipcMain.handle('perf:info', async () => { const h = await hw(); return { profile: await perfProfile(), hw: { ram: h.ram, cpus: h.cpus, mathCores: h.mathCores, gpu: h.gpu, vram: h.vram, cpu: h.cpu } }; });

  ipcMain.handle('models:list', () => listModels());
  ipcMain.handle('models:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Chọn tệp mô hình GGUF', filters: [{ name: 'Mô hình GGUF', extensions: ['gguf'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return listModels();
    for (const f of r.filePaths) if (!settings.data.imported.includes(f)) settings.data.imported.push(f);
    settings.save();
    return listModels();
  });
  ipcMain.handle('models:load', async (_e, id, o = {}) => { try { return { ok: true, status: await loadById(id, { force: !!(o && o.force) }) }; } catch (e) { return { ok: false, error: e.message, code: e.code || null, modelId: e.modelId || id, catalogId: e.catalogId || null }; } });
  ipcMain.handle('models:unload', async () => { await engine.unloadModel(); const st = engine.status(); send('model:status', st); return st; });
  ipcMain.handle('models:delete', async (_e, id) => {
    const m = listModels().find(x => x.id === id);
    if (!m) return listModels();
    const ok = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Huỷ', 'Xoá'], defaultId: 0, cancelId: 0, title: 'Xoá mô hình',
      message: m.source === 'imported' ? `Gỡ "${m.file}" khỏi danh sách? (Tệp gốc vẫn được giữ nguyên)` : `Xoá vĩnh viễn "${m.file}" khỏi máy?` });
    if (ok.response !== 1) return listModels();
    if (m.loaded) { await engine.unloadModel(); send('model:status', engine.status()); }
    if (m.source === 'imported') settings.data.imported = settings.data.imported.filter(p => p !== m.path), settings.save();
    else {
      const sm = m.file.match(SPLIT_RE);
      if (sm) for (let i = 1; i <= Number(sm[3]); i++) fs.rmSync(path.join(path.dirname(m.path), `${sm[1]}-${String(i).padStart(5, '0')}-of-${sm[3]}.gguf`), { force: true });
      else fs.rmSync(m.path, { force: true });
      // dọn thư mục repo/tác giả nếu đã trống
      for (let d = path.dirname(m.path); d.startsWith(paths.models + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch { break; } }
    }
    return listModels();
  });
  ipcMain.handle('models:reveal', (_e, p) => { shell.showItemInFolder(p || paths.models); return true; });
  ipcMain.handle('model:status', () => engine.status());
  ipcMain.handle('bench:run', async (_e, { ids }) => { try { return { ok: true, results: await runAgentBench(Array.isArray(ids) ? ids.slice(0, 4) : []) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('bench:stop', () => { if (benchRun) benchRun.abort(); stopComputer('dừng bài đo'); return true; });
  ipcMain.handle('bench:scores', () => benchScores());
  // ---- Kết nối (MCP) ----
  ipcMain.handle('mcp:status', () => ({ servers: mcp.status(), text: mcp.readText(), file: mcp.file, enabled: settings.data.agentMcp !== false }));
  ipcMain.handle('mcp:save', async (_e, text) => { try { await mcp.saveText(String(text)); LOG.log('mcp', 'Đã lưu mcp.json'); return { ok: true, servers: mcp.status() }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('mcp:toggle', async (_e, { name, on }) => { try { return { ok: true, server: await mcp.setEnabled(name, !!on) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('mcp:restart', async (_e, name) => { try { return { ok: true, server: await mcp.start(name) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('mcp:preset', async (_e, kind) => {
    let folder = null;
    if (kind === 'filesystem') { const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục cho máy chủ MCP filesystem', properties: ['openDirectory'] }); if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }; folder = r.filePaths[0]; }
    const P = require('./mcp').presets({ folder }); if (!P[kind]) return { ok: false, error: 'Không có mẫu này.' };
    const cfg = mcp.config(); let name = kind; let i = 2; while (cfg.mcpServers[name]) name = `${kind}-${i++}`;
    cfg.mcpServers[name] = P[kind];
    try { await mcp.saveText(JSON.stringify(cfg)); mcp.start(name).catch(() => {}); return { ok: true, name }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('mcp:master', (_e, on) => { settings.data.agentMcp = !!on; settings.save(); return true; });
  setTimeout(() => mcp.startEnabled().catch(() => {}), 4000);
  ipcMain.handle('bench:ground', async (_e, { id }) => { try { return { ok: true, result: await runGroundingBench(id) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('logs:open', () => { const d = LOG.dir || path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(d, { recursive: true }); LOG.log('app', 'Người dùng mở thư mục nhật ký'); shell.openPath(LOG.file && fs.existsSync(LOG.file) ? d : d); return d; });
  ipcMain.handle('apps:scan-test', async (_e, q) => { const r = await computerTools.scanReport(String(q || 'zalo').slice(0, 60)); LOG.block('apps', `Kiểm tra quét ứng dụng (tìm "${r.query}")`, [`tổng: ${r.total} mục · ${r.ms} ms`, `nguồn: ${JSON.stringify(r.sources)}`, `lỗi: ${r.errors.length ? r.errors.join('; ') : 'không'}`, `khớp tốt nhất: ${r.best ? r.best.name + ' → ' + (r.best.path || r.best.appId || '?') : 'không có'}`, ...r.matches.map(m => `- ${m.name} · ${m.path || m.appId || ''}${m.target ? ' → ' + m.target : ''}`)]); return r; });
  ipcMain.handle('logs:copy', () => { const t = LOG.tail(200); const head = `--- Nhật ký AIVN ${app.getVersion()} · ${process.platform} · ${new Date().toLocaleString('vi-VN')} (200 dòng cuối) ---\n`; clipboard.writeText(head + (t || '(nhật ký trống)')); return { lines: t ? t.split('\n').length : 0, file: LOG.file, error: LOG.error }; });

  ipcMain.handle('chat:generate', async (_e, { reqId, messages, temperature, maxTokens, docs: attached, convoId, images }) => {
    const ac = new AbortController();
    generations.set(reqId, ac);
    try {
      await ensureAfterCrash();
      let docInfo = null;
      // Mô hình nhìn ảnh: gửi ảnh trực tiếp (data URL) trong tin nhắn cuối
      if (Array.isArray(images) && images.length && engine.status().vision) {
        const ok = images.filter(u => typeof u === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(u) && u.length < 15e6).slice(0, 4);
        const last = messages[messages.length - 1];
        if (ok.length) messages = [...messages.slice(0, -1), { ...last, content: [{ type: 'text', text: String(last.content) }, ...ok.map(url => ({ type: 'image_url', image_url: { url } }))] }];
      }
      const hasIndex = convoId && rag && ragActive() && rag.has(convoId);
      if ((attached && attached.length) || hasIndex) {
        const packed = await packForPrompt(messages, attached || [], maxTokens, { convoId, reqId });
        messages = packed.messages; docInfo = packed.docInfo;
        if (docInfo) send('chat:docinfo', { reqId, ...docInfo });
      }
      const tb = tokenBatcher(reqId);
      let r; try { r = await withEngineRecovery(() => engine.generate(messages, { temperature, maxTokens, signal: ac.signal, onToken: t => tb.push(t) }), { onRetry: (ctx) => { tb.flush(); send('chat:recover', { reqId, ctx }); } }); } finally { tb.flush(); }
      return { ...r, docInfo, stoppedBy: r.finishReason === 'abort' ? (stopReasons.get(reqId) || 'không rõ') : null };
    } finally { generations.delete(reqId); stopReasons.delete(reqId); }
  });
  ipcMain.handle('files:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Chọn tệp để gửi kèm', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Tài liệu và ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'pdf', 'docx', 'txt', 'md', 'csv', 'json', 'html', 'xml', 'yaml', 'yml', 'log', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'sql', 'sh'] }, { name: 'Tất cả tệp', extensions: ['*'] }] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('clipboard:write', async (_e, t) => { await require('electron').clipboard.writeText(String(t ?? '')); return true; });
  ipcMain.handle('image:read', (_e, p) => { // ảnh chọn bằng nút ghim: trả bytes để giao diện chuyển sang PNG
    const st = fs.statSync(p);
    if (st.size > docs.MAX_FILE_BYTES) throw new Error(`"${path.basename(p)}" quá lớn (${(st.size / 1048576).toFixed(1)} MB). Giới hạn là 20 MB mỗi tệp.`);
    return { name: path.basename(p), size: st.size, bytes: fs.readFileSync(p) };
  });
  ipcMain.handle('image:ocr', async (_e, bytes) => {
    if (!bytes || bytes.length > 40 * 1048576) throw new Error('Ảnh quá lớn để đọc chữ.');
    const t0 = Date.now();
    const r = await engine.ocr(Buffer.from(bytes));
    if (isTest) console.log(`[ocr] ${r.chars} ký tự, tin cậy ${r.confidence}%, ${Date.now() - t0} ms`);
    return r;
  });
  ipcMain.handle('files:extract', async (_e, paths) => {
    const out = [];
    for (const p of paths || []) {
      try { const d = await docsPool.extractFile(p); out.push({ ok: true, name: d.name, size: d.size, kind: d.kind, pages: d.pages, chars: d.chars, text: d.text }); }
      catch (e) { out.push({ ok: false, name: path.basename(p), error: e.userMessage || ('Không đọc được tệp: ' + e.message) }); }
    }
    return out;
  });
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => updater.install());
  ipcMain.handle('update:open', () => updater.openReleases());
  ipcMain.handle('update:state', () => updater.state());
  ipcMain.handle('chat:stop', (_e, reqId) => { abortGen(reqId, generations.get(reqId), 'người dùng bấm Dừng'); return true; });

  ipcMain.handle('convos:list', () => convos.data.list);
  ipcMain.handle('convos:save', (_e, c) => {
    const i = convos.data.list.findIndex(x => x.id === c.id);
    if (i >= 0) convos.data.list[i] = c; else convos.data.list.unshift(c);
    convos.data.list.sort((a, b) => b.updatedAt - a.updatedAt);
    convos.save(); return true;
  });
  ipcMain.handle('convos:delete', (_e, id) => { convos.data.list = convos.data.list.filter(x => x.id !== id); convos.save(); if (rag) rag.remove(id); return true; });
  ipcMain.handle('rag:info', () => embedInfo());
  ipcMain.handle('rag:download', () => downloader.enqueue({ repo: EMBED.repo, files: [{ path: EMBED.file, size: EMBED.size }], name: EMBED.name, quant: 'Q8_0', catalogId: EMBED.id, urlFor: hf.resolveUrl }));
  ipcMain.handle('rag:delete', async () => {
    const ok = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Huỷ', 'Xoá'], defaultId: 0, cancelId: 0, title: 'Xoá mô hình nhúng', message: `Xoá "${EMBED.file}" khỏi máy? AIVN sẽ quay về cách tìm theo từ khoá.` });
    if (ok.response !== 1) return embedInfo();
    await engine.embedUnload().catch(() => {});
    fs.rmSync(embedPath(), { force: true });
    return embedInfo();
  });
  ipcMain.handle('rag:convo', (_e, id) => { try { return rag ? rag.summary(id) : null; } catch { return null; } });
  ipcMain.handle('vision:vcredist', () => shell.openExternal(VCREDIST_URL));

  // --- AIVN AGENT ---
  ipcMain.handle('agent:info', () => agentInfo());
  ipcMain.handle('agent:run', async (_e, { reqId, convoId, messages, attachments }) => {
    const ac = new AbortController(); generations.set(reqId, ac);
    try { await ensureAfterCrash(); const r = await withEngineRecovery(() => runAgentTurn({ reqId, convoId, messages, attachments, signal: ac.signal }), { onRetry: (ctx) => send('agent:status', { reqId, stage: 'recover', ctx }) }); return { ...r, steps: r.steps.map(slimStep), model: engine.status().id, stoppedBy: r.finishReason === 'abort' ? (stopReasons.get(reqId) || 'không rõ') : null }; }
    finally { generations.delete(reqId); stopReasons.delete(reqId); }
  });
  ipcMain.handle('agent:screen-reply', (_e, { id, ok, nx, ny }) => { const f = screenConfirms.get(id); if (f) f({ ok: ok === true, nx: Number.isFinite(nx) ? Math.min(1, Math.max(0, nx)) : null, ny: Number.isFinite(ny) ? Math.min(1, Math.max(0, ny)) : null }); return !!f; });
  ipcMain.handle('computer:perm-open', (_e, which) => { if (process.platform === 'darwin' && SC.PERM_URLS[which]) { if (which === 'accessibility') SC.permissions({ prompt: true }); shell.openExternal(SC.PERM_URLS[which]); } return computerInfo(); });
  ipcMain.handle('computer:perm-test', async () => { try { const shot = await SC.capture({ maxW: 320 }); return { ok: true, info: computerInfo(), w: shot.width }; } catch (e) { return { ok: false, error: e.message, info: computerInfo() }; } });
  ipcMain.handle('agent:confirm-reply', (_e, { id, ok }) => { const f = confirms.get(id); if (f) f(ok === true); return !!f; });
  ipcMain.handle('agent:approve-reply', (_e, r) => { const f = r && confirms.get(r.id); if (f) f({ ok: r.ok === true, reason: r.reason || '', always: r.always === true }); return !!f; });
  ipcMain.handle('agent:always-revoke', (_e, name) => { settings.data.agentAlwaysAllow = (settings.data.agentAlwaysAllow || []).filter(n => n !== name); settings.save(); LOG.log('agent', `Bỏ "Luôn cho phép": ${name}`); return settings.data.agentAlwaysAllow; });
  ipcMain.handle('agent:add-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục AIVN AGENT được phép làm việc', properties: ['openDirectory', 'createDirectory', 'multiSelections'] });
    if (!r.canceled) { for (const f of r.filePaths) if (!settings.data.agentFolders.includes(f)) settings.data.agentFolders.push(f); settings.save(); }
    return agentInfo();
  });
  ipcMain.handle('agent:remove-folder', (_e, f) => { settings.data.agentFolders = settings.data.agentFolders.filter(x => x !== f); settings.save(); return agentInfo(); });
  ipcMain.handle('agent:open-folder', (_e, f) => { if ((settings.data.agentFolders || []).includes(f)) shell.openPath(f); return true; });
  ipcMain.handle('memory:list', () => memory.list());
  ipcMain.handle('memory:add', (_e, text) => memory.add(text, { source: 'user' }));
  ipcMain.handle('memory:update', (_e, { id, text }) => memory.update(id, text));
  ipcMain.handle('memory:delete', (_e, id) => memory.remove(id));
  ipcMain.handle('memory:clear', async () => {
    const ok = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Huỷ', 'Xoá tất cả'], defaultId: 0, cancelId: 0, title: 'Xoá mọi ghi nhớ', message: `Xoá toàn bộ ${memory.count()} ghi nhớ của AIVN AGENT? Không hoàn tác được.` });
    if (ok.response === 1) memory.clear();
    return memory.list();
  });
  ipcMain.handle('sched:list', () => scheduler.list());
  ipcMain.handle('sched:create', (_e, spec) => { const t = scheduler.create(spec); send('sched:changed', {}); return t; });
  ipcMain.handle('sched:update', (_e, { id, ...spec }) => { const t = scheduler.update(id, spec); send('sched:changed', {}); return t; });
  ipcMain.handle('sched:delete', (_e, id) => { scheduler.remove(id); send('sched:changed', {}); return scheduler.list(); });
  ipcMain.handle('sched:run', async (_e, id) => scheduler.runNow(id));
  ipcMain.handle('notify:test', () => { notify('AIVN · Thử thông báo', 'Thông báo của Lịch tự động hiện như thế này.'); return lastNotice; });

  ipcMain.handle('server:start', async (_e, port) => {
    port = Number(port) || settings.data.apiPort;
    try { await api.start(port); settings.data.apiPort = port; settings.save(); }
    catch (e) { log(`Lỗi: ${e.code === 'EADDRINUSE' ? `cổng ${port} đang bị chiếm` : e.message}`); throw new Error(e.code === 'EADDRINUSE' ? `Cổng ${port} đang được dùng bởi ứng dụng khác` : e.message); }
    return api.status();
  });
  ipcMain.handle('server:stop', async () => { await api.stop(); return api.status(); });
  ipcMain.handle('server:status', () => ({ ...api.status(), log: serverLog }));
  ipcMain.handle('open:external', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });
}

// Menu: trên macOS phải có menu Sửa (Edit) thì Cmd+C/Cmd+V/Cmd+X/Cmd+A mới hoạt động; Windows/Linux ẩn thanh menu nhưng giữ phím tắt
function buildMenus() {
  const isMac = process.platform === 'darwin';
  const edit = { label: 'Sửa', submenu: [
    { role: 'undo', label: 'Hoàn tác' }, { role: 'redo', label: 'Làm lại' }, { type: 'separator' },
    { role: 'cut', label: 'Cắt' }, { role: 'copy', label: 'Sao chép' }, { role: 'paste', label: 'Dán' },
    ...(isMac ? [{ role: 'pasteAndMatchStyle', label: 'Dán và khớp định dạng' }] : []),
    { role: 'delete', label: 'Xoá' }, { role: 'selectAll', label: 'Chọn tất cả' }] };
  const view = { label: 'Xem', submenu: [{ role: 'resetZoom', label: 'Cỡ chữ mặc định' }, { role: 'zoomIn', label: 'Phóng to' }, { role: 'zoomOut', label: 'Thu nhỏ' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Toàn màn hình' }] };
  const template = [
    ...(isMac ? [{ label: 'AIVN', submenu: [{ role: 'about', label: 'Giới thiệu AIVN' }, { type: 'separator' }, { label: 'Khóa ngay', accelerator: 'CmdOrCtrl+Shift+L', click: () => lockNow('phím tắt') }, { type: 'separator' }, { role: 'hide', label: 'Ẩn AIVN' }, { role: 'hideOthers', label: 'Ẩn ứng dụng khác' }, { role: 'unhide', label: 'Hiện tất cả' }, { type: 'separator' }, { role: 'quit', label: 'Thoát AIVN' }] }] : [{ label: 'Tệp', submenu: [{ label: 'Khóa ngay', accelerator: 'CmdOrCtrl+Shift+L', click: () => lockNow('phím tắt') }, { type: 'separator' }, { role: 'quit', label: 'Thoát' }] }]),
    edit, view,
    { label: 'Cửa sổ', submenu: [{ role: 'minimize', label: 'Thu nhỏ' }, ...(isMac ? [{ role: 'zoom', label: 'Phóng to' }, { role: 'front', label: 'Đưa tất cả lên trước' }] : [{ role: 'close', label: 'Đóng' }])] },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

function contextMenuItems(p) {
  const f = p.editFlags || {};
  if (p.isEditable) return [{ role: 'undo', label: 'Hoàn tác', enabled: f.canUndo }, { role: 'redo', label: 'Làm lại', enabled: f.canRedo }, { type: 'separator' },
    { role: 'cut', label: 'Cắt', enabled: f.canCut }, { role: 'copy', label: 'Sao chép', enabled: f.canCopy }, { role: 'paste', label: 'Dán', enabled: f.canPaste },
    { type: 'separator' }, { role: 'selectAll', label: 'Chọn tất cả', enabled: f.canSelectAll }];
  const items = [];
  if (p.selectionText) items.push({ role: 'copy', label: 'Sao chép' });
  if (p.linkURL && /^https?:/.test(p.linkURL)) items.push({ label: 'Sao chép liên kết', click: () => { require('electron').clipboard.writeText(p.linkURL).catch(() => {}); } });
  items.push({ role: 'selectAll', label: 'Chọn tất cả' });
  return items;
}
function attachContextMenu(wc) {
  wc.on('context-menu', (_e, p) => {
    const items = contextMenuItems(p);
    if (isTest) console.log('[context-menu] ' + items.filter(i => i.label).map(i => i.label + (i.enabled === false ? '(tắt)' : '')).join(', '));
    Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) || undefined });
  });
}

function windowBg() { // màu nền trước khi giao diện vẽ xong, tránh nháy màu
  const t = settings?.data?.theme;
  const dark = t === 'dark' || (t === 'system' && require('electron').nativeTheme.shouldUseDarkColors);
  return dark ? '#17181b' : '#ffffff';
}
function createWindow({ hidden = false } = {}) {
  if (['light', 'dark', 'system'].includes(settings.data.theme)) require('electron').nativeTheme.themeSource = settings.data.theme;
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, backgroundColor: windowBg(), title: 'AIVN',
    icon: path.join(__dirname, '..', 'build', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [`--aivn-theme=${windowBg() === '#ffffff' ? 'light' : 'dark'}`] }, // giao diện đã lưu, áp dụng trước lần vẽ đầu tiên
  });
  buildMenus();
  loadUi();
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
  // Chạy nền: đóng cửa sổ thì thu xuống khay để Lịch tự động tiếp tục chạy
  win.on('close', (e) => {
    if (settings.data.keepInTray && tray && !quitting) {
      e.preventDefault(); win.hide();
      if (!settings.data.trayHintShown) { settings.data.trayHintShown = true; settings.save(); notify('AIVN vẫn đang chạy', 'Lịch tự động tiếp tục chạy trong khay hệ thống. Bấm biểu tượng AIVN để mở lại, hoặc chọn Thoát.'); }
    }
  });
  if (process.platform !== 'darwin') { win.setMenuBarVisibility(false); win.autoHideMenuBar = true; }
  attachContextMenu(win.webContents);
  if (isTest) win.webContents.on('console-message', (e) => console.log('[renderer]', e.message || e));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

// Chỉ dùng khi kiểm thử: hỏi về một tài liệu đính kèm qua đúng đường xử lý của giao diện, ghi kết quả ra JSON
async function selfTestDoc() {
  const id = process.env.AIVN_LOAD || listModels()[0]?.id;
  await loadById(id);
  const files = process.env.AIVN_SELFTEST_DOC.split(path.delimiter);
  const extracted = [];
  for (const f of files) extracted.push(await docs.extractFile(f));
  const q = process.env.AIVN_SELFTEST_Q || 'Tóm tắt tài liệu này.';
  const maxTokens = 200;
  const packed = await packForPrompt([{ role: 'system', content: 'Bạn là AIVN, trả lời bằng tiếng Việt, ngắn gọn.' }, { role: 'user', content: q }], extracted, maxTokens);
  const r = await engine.generate(packed.messages, { temperature: 0.1, maxTokens });
  const out = { question: q, files: packed.docInfo.files, truncated: packed.docInfo.truncated, budget: packed.docInfo.budget, promptChars: packed.docInfo.context.length, answer: r.text, usage: r.usage };
  fs.writeFileSync(process.env.AIVN_SELFTEST_OUT || path.join(paths.userData, 'selftest.json'), JSON.stringify(out, null, 2));
  if (process.env.AIVN_SELFTEST_UPDATE === '1') { const st = await updater.check(); out.update = st; fs.writeFileSync(process.env.AIVN_SELFTEST_OUT, JSON.stringify(out, null, 2)); }
  app.quit();
}

// Chỉ dùng khi kiểm thử: tìm kiếm HF, gom tệp chia phần, tải + nạp + trò chuyện với một mô hình (AIVN_SELFTEST_HF=<repo>|<tệp>)
async function selfTestHf() {
  const out = { steps: [] };
  const step = (k, v) => { out.steps.push(k); out[k] = v; fs.writeFileSync(process.env.AIVN_SELFTEST_OUT, JSON.stringify(out, null, 2)); console.log('[selftest]', k); };
  const t0 = Date.now();
  const res = await hf.search({ q: process.env.AIVN_SELFTEST_Q_SEARCH || 'qwen3 0.6b', sort: 'downloads', token: settings.data.hfToken || null });
  step('search', { count: res.length, top: res.slice(0, 5).map(r => ({ id: r.id, downloads: r.downloads, likes: r.likes, arch: r.arch, ok: r.archSupported, license: r.license })) });
  const split = await hf.repoFiles(process.env.AIVN_SELFTEST_SPLIT || 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF', { hw: await hw() });
  step('split', split.groups.filter(g => g.kind === 'chat').map(g => ({ name: g.name, quant: g.quant, parts: g.parts, files: g.files.length, size: g.size, fit: g.fit && g.fit.label, recommended: !!g.recommended })));
  const [repo, file] = process.env.AIVN_SELFTEST_HF.split('|');
  const info = await hf.repoFiles(repo, { hw: await hw() });
  const g = info.groups.find(x => x.files[0].path === file) || info.groups.find(x => x.recommended);
  step('repo', { repo, arch: info.arch, archSupported: info.archSupported, chosen: g.name, quant: g.quant, size: g.size, recommended: !!g.recommended, fit: g.fit });
  const done = new Promise((resolve, reject) => { const iv = setInterval(() => { const j = downloader.get(`${repo}::${g.files[0].path}`); if (j && j.status === 'done') { clearInterval(iv); resolve(j); } if (j && j.status === 'error') { clearInterval(iv); reject(new Error(j.error)); } }, 500); });
  downloader.enqueue({ repo, files: g.files, name: g.name, quant: g.quant, urlFor: hf.resolveUrl });
  const j = await done;
  step('download', { seconds: (Date.now() - t0) / 1000, received: j.received, total: j.total, dest: j.dest });
  const m = listModels().find(x => x.path === j.dest);
  await loadById(m.id);
  step('load', engine.status());
  const r = await engine.generate([{ role: 'system', content: 'Bạn là AIVN, trả lời bằng tiếng Việt, ngắn gọn.' }, { role: 'user', content: process.env.AIVN_SELFTEST_Q || 'Thủ đô của Việt Nam là gì? /no_think' }], { temperature: 0.2, maxTokens: 300 });
  step('chat', { answer: r.text, usage: r.usage });
  app.quit();
}

// Chỉ dùng khi kiểm thử giao diện: sao chép/dán chữ, dán ảnh từ clipboard (OCR), menu chuột phải, hỏi về ảnh
async function selfTestUi() {
  const { clipboard, ClipboardItem } = require('electron');
  const wc = win.webContents; const out = {};
  const js = (code) => wc.executeJavaScript(code);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const save = () => fs.writeFileSync(process.env.AIVN_SELFTEST_OUT, JSON.stringify(out, null, 2));
  const until = async (code, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await sleep(250); } return false; };
  await until('!!document.querySelector("#input")');
  if (process.env.AIVN_LOAD) { await loadById(process.env.AIVN_LOAD); await sleep(500); }
  // 1) dán chữ, chọn tất cả, cắt
  await clipboard.writeText('Xin chào AIVN 👋 tiếng Việt có dấu');
  await js('document.querySelector("#input").focus()'); wc.paste(); await sleep(300);
  out.pastedText = await js('document.querySelector("#input").value');
  wc.selectAll(); wc.cut(); await sleep(300);
  out.cutToClipboard = await clipboard.readText(); out.inputAfterCut = await js('document.querySelector("#input").value');
  // 2) menu chuột phải trên ô nhập
  const r = await js('(() => { const b = document.querySelector("#input").getBoundingClientRect(); return [Math.round(b.x + 40), Math.round(b.y + 10)]; })()');
  const logs = []; const orig = console.log; console.log = (...a) => { logs.push(a.join(' ')); orig(...a); };
  wc.sendInputEvent({ type: 'mouseDown', x: r[0], y: r[1], button: 'right', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: r[0], y: r[1], button: 'right', clickCount: 1 });
  await sleep(800); console.log = orig;
  out.contextMenu = logs.find(l => l.startsWith('[context-menu]')) || null;
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  out.appMenu = Menu.getApplicationMenu()?.items.map(i => i.label + ': ' + i.submenu.items.filter(x => x.label).map(x => x.label).join('/'));
  // 3) dán ảnh từ clipboard
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([fs.readFileSync(process.env.AIVN_TEST_IMAGE)], { type: 'image/png' }) })]);
  await js('document.querySelector("#input").focus()'); wc.paste();
  out.chipAppeared = await until('!!document.querySelector(".chip.img")', 5000);
  out.ocrDone = await until('!!document.querySelector(".chip.img:not(.loading)")', 60000);
  out.chip = await js('document.querySelector(".chip.img") && document.querySelector(".chip.img").innerText');
  save();
  // 4) hỏi về ảnh
  await js(`document.querySelector("#input").value = ${JSON.stringify(process.env.AIVN_SELFTEST_Q || 'Ngày thi và phòng thi là gì?')}; document.querySelector("#composer").requestSubmit();`);
  await sleep(500);
  out.answered = await until('!document.querySelector("#sendBtn").hidden && document.querySelectorAll("#messages .msg.assistant").length > 0', 300000);
  out.answer = await js('[...document.querySelectorAll("#messages .msg.assistant .body")].pop().innerText');
  out.note = await js('[...document.querySelectorAll("#messages .doc-warn.ocr")].map(e => e.innerText).join(" | ")');
  out.userAttachment = await js('document.querySelector("#messages .msg.user .att") && document.querySelector("#messages .msg.user .att").innerText');
  out.hasThumb = await js('!!document.querySelector("#messages .msg.user .att img.thumb")');
  out.saved = (convos.data.list[0]?.messages || []).map(m => ({ role: m.role, attachments: m.attachments?.map(a => a.name + ':' + a.kind), ocrNote: m.ocrNote || null, ctx: m.context ? m.context.slice(0, 160) : null }));
  // 5) nút sao chép câu trả lời
  await js('document.querySelector("#messages .copy-btn").click()'); await sleep(400);
  out.copiedAnswer = (await clipboard.readText()).slice(0, 200);
  if (process.env.AIVN_SHOT) fs.writeFileSync(process.env.AIVN_SHOT, (await wc.capturePage()).toPNG());
  save(); app.quit();
}

// ---------- Điểm tác vụ: bài đo 10 việc điều khiển máy (chạy thật, chấm bằng trạng thái cửa sổ AIVN Bench) ----------
const BENCH_FILE = () => path.join(app.getPath('userData'), 'agent-bench.json');
function benchScores() {
  let local = {}; try { local = JSON.parse(fs.readFileSync(BENCH_FILE(), 'utf8')).models || {}; } catch {}
  let shipped = {}; try { shipped = require('./bench-results.json').models || {}; } catch {}
  return { local, shipped };
}
let benchRun = null;
async function runAgentBench(ids, { only = null, onProgress = null } = {}) {
  if (benchRun) throw new Error('Bài đo đang chạy.');
  const AB = require('./agent-bench'); const U = require('./agent/uitree');
  const keep = { agentComputer: settings.data.agentComputer, agentScreen: settings.data.agentScreen, agentScreenMode: settings.data.agentScreenMode, agentToolsOff: settings.data.agentToolsOff };
  const ac = new AbortController(); benchRun = ac; const results = {};
  Object.assign(settings.data, { agentComputer: true, agentScreen: true, agentScreenMode: 'important', agentToolsOff: [] });
  try {
    for (const id of ids) {
      if (ac.signal.aborted) break;
      const t0 = Date.now(); await loadById(id, { force: true }); send('model:status', engine.status());
      LOG.log('bench', `Bắt đầu đo Điểm tác vụ: ${id}`);
      const r = await AB.runBench({ BrowserWindow, desk: getDesk(), windows: U.windows, modelId: id, only, signal: ac.signal, perTaskMs: Number(process.env.AIVN_AGENTBENCH_TASKMS || 300000),
        runTurn: ({ messages, signal }) => runAgentTurn({ reqId: null, convoId: 'bench', messages, signal }),
        killPid: (pid) => { try { process.kill(pid); } catch {} },
        out: process.env.AIVN_AGENTBENCH && !app.isPackaged ? path.join(process.env.AIVN_AGENTBENCH, `bench-${id}.json`) : null,
        onProgress: (p) => { onProgress && onProgress({ model: id, ...p }); send('bench:progress', { model: id, ...p }); } });
      r.loadMs = Date.now() - t0 - r.seconds * 1000; r.mode = engine.status().mode; r.machine = `${process.platform} · ${require('os').cpus()[0].model} · ${engine.status().mode || ''}`;
      results[id] = r;
      if (!only) { let all = {}; try { all = JSON.parse(fs.readFileSync(BENCH_FILE(), 'utf8')); } catch {} all.models = { ...(all.models || {}), [id]: { score: r.score, total: 10, done: r.done, safety: r.safety, seconds: r.seconds, date: r.started, machine: r.machine, tasks: r.tasks.map(t => ({ id: t.id, pass: t.pass, seconds: t.seconds })) } }; fs.writeFileSync(BENCH_FILE(), JSON.stringify(all, null, 2)); }
      LOG.log('bench', `${id}: Điểm tác vụ ${r.score}/10 · an toàn ${r.safety === null ? '—' : r.safety ? 'đạt' : 'KHÔNG đạt'} · ${r.seconds} giây`);
    }
  } finally { Object.assign(settings.data, keep); settings.save(); benchRun = null; }
  return results;
}
async function runGroundingBench(id) {
  const AB = require('./agent-bench'); const SC = require('./screen-control');
  const g = await getGrounder(id); if (!g) throw new Error('Không nạp được mô hình định vị (cần mô hình nhìn ảnh đã tải kèm tệp thị giác).');
  const fi = SC.familyInfo(g.id);
  const r = await AB.runGroundBench({ BrowserWindow, modelId: id, align: fi.align, locate: async (shot, q) => (await SC.locate(g.engine, shot, q, { modelId: g.id })).box });
  let all = {}; try { all = JSON.parse(fs.readFileSync(BENCH_FILE(), 'utf8')); } catch {}
  all.models = all.models || {}; all.models[id] = { ...(all.models[id] || {}), grounding: { score: r.score, total: r.total, seconds: r.seconds, date: r.started } };
  fs.writeFileSync(BENCH_FILE(), JSON.stringify(all, null, 2));
  LOG.log('bench', `${id}: Điểm định vị ${r.score}/${r.total} · ${r.seconds} giây`);
  return r;
}
async function qaBench() {
  const dir = process.env.AIVN_AGENTBENCH; fs.mkdirSync(dir, { recursive: true });
  const ids = String(process.env.AIVN_AGENTBENCH_MODELS || '').split(',').filter(Boolean);
  const only = process.env.AIVN_AGENTBENCH_ONLY ? process.env.AIVN_AGENTBENCH_ONLY.split(',') : null;
  if (process.env.AIVN_GROUNDBENCH) { const out = {}; for (const g of process.env.AIVN_GROUNDBENCH.split(',')) { try { out[g] = await runGroundingBench(g); } catch (e) { out[g] = { error: e.message }; } fs.writeFileSync(path.join(dir, 'grounding.json'), JSON.stringify(out, null, 2)); } if (!ids.length) return app.quit(); }
  const r = await runAgentBench(ids, { only, onProgress: (p) => console.log('[bench]', JSON.stringify(p)) });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { score: v.score, done: v.done, safety: v.safety, seconds: v.seconds, tasks: v.tasks.map(t => `${t.pass ? '✔' : '✘'} ${t.id} ${t.seconds}s${t.timeout ? ' (hết giờ)' : ''}`) }])), null, 2));
  app.quit();
}

// QA 0.15.0 (AIVN_QACU=thư mục, AIVN_QACU_TASK=câu lệnh, AIVN_QACU_MODEL=id; chỉ khi phát triển): AIVN AGENT điều khiển máy thật
async function qaCU() {
  const cp = require('child_process');
  const dir = process.env.AIVN_QACU; fs.mkdirSync(dir, { recursive: true });
  const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  const until = async (c, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(250); } return false; };
  const out = { task: process.env.AIVN_QACU_TASK, started: new Date().toISOString() }; const save = () => fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(out, null, 2));
  let n = 0; const snap = () => { try { cp.execSync(`import -window root -resize 50% ${JSON.stringify(path.join(dir, 'live-' + String(++n).padStart(3, '0') + '.jpg'))}`, { timeout: 8000 }); } catch {} };
  await until('typeof show === "function" && !!state.settings', 60000);
  Object.assign(settings.data, { agentComputer: true, agentScreen: true, agentScreenMode: process.env.AIVN_QACU_MODE || 'each', agentToolsOff: [] }); settings.save();
  const id = process.env.AIVN_QACU_MODEL; const t0 = Date.now();
  out.load = await loadById(id, { force: true }).then(st => ({ ok: true, ms: Date.now() - t0, ctx: st.contextSize, mode: st.mode })).catch(e => ({ ok: false, error: e.message })); save();
  send('model:status', engine.status());
  await js('show("agent")'); await until('!!state.agent', 20000); await sleep(800);
  await js(`(() => { const i = document.querySelector('#input'); i.value = ${JSON.stringify(process.env.AIVN_QACU_TASK)}; i.dispatchEvent(new Event('input')); document.querySelector('#sendBtn').click(); })()`);
  const tStart = Date.now(); const timer = setInterval(snap, 4000);
  await until('state.generating', 20000);
  await until('!state.generating', Number(process.env.AIVN_QACU_TIMEOUT || 900000));
  clearInterval(timer); snap();
  const m = await js('(() => { const m = state.current.messages.at(-1); return { content: m.content, warning: m.warning, steps: (m.steps || []).map(s => ({ name: s.name, status: s.status, args: s.args, summary: s.summary, ms: s.ms, thumb: !!(s.thumb && s.thumb.src) })) }; })()');
  out.seconds = Math.round((Date.now() - tStart) / 1000); Object.assign(out, m); save();
  await sleep(1200); fs.writeFileSync(path.join(dir, 'chat-timeline.png'), (await wc.capturePage()).toPNG());
  await js('document.querySelectorAll("#messages .msg:last-child details.step").forEach((d, i, a) => { if (i >= a.length - 3) d.open = true; }); document.querySelector("#messages").scrollTop = 1e9');
  await sleep(500); fs.writeFileSync(path.join(dir, 'chat-timeline-open.png'), (await wc.capturePage()).toPNG());
  save(); app.quit();
}

// QA 0.14.4 (AIVN_QA144=thư mục, chỉ khi phát triển): bộ máy sập giữa lượt → tự phục hồi; thẻ lỗi có nút nhật ký; chống bấm đúp Gửi→Dừng; quét ứng dụng; tệp nhật ký
async function qa144() {
  const { clipboard } = require('electron'); const cp = require('child_process');
  const dir = process.env.AIVN_QA144; fs.mkdirSync(dir, { recursive: true });
  const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (c, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(100); } return false; };
  const out = { stages: {} }; const save = () => fs.writeFileSync(path.join(dir, 'qa144.json'), JSON.stringify(out, null, 2));
  const shot = async (n) => { await sleep(300); fs.writeFileSync(path.join(dir, n), (await wc.capturePage()).toPNG()); };
  const stage = async (k, f) => { console.log('[qa144] ' + k); try { out.stages[k] = (await f()) || { ok: true }; } catch (e) { out.stages[k] = { error: e.stack || String(e) }; } save(); };
  const killEngine = () => { try { cp.execSync("pkill -9 -f '[e]ngine-host'"); return true; } catch { return false; } };
  const send = async (text) => { await js(`(() => { const i = document.querySelector('#input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); document.querySelector('#sendBtn').click(); })()`); };
  const last = () => js(`(() => { const m = state.current.messages.at(-1); return { content: m.content, error: !!m.error, stats: document.querySelector('#genStats').textContent, btns: [...document.querySelectorAll('#messages .msg:last-child [data-logs]')].map(b => b.textContent) }; })()`);
  win.setBounds({ x: 0, y: 0, width: 1280, height: 720 });
  await until('typeof show === "function" && !!state.settings && state.status && state.status.loaded', 120000);
  await stage('crash-recover-chat', async () => {
    await js('show("chat"); newConvo && newConvo()').catch(() => {});
    await send('Kể một câu chuyện ngắn khoảng 200 chữ về chú mèo ở Hội An.');
    await until('state.generating && state.current.messages.at(-1).content.length > 20');
    const killed = killEngine();
    const sawRecover = await until('/tự nạp lại mô hình/.test(document.querySelector("#genStats").textContent)', 15000);
    await until('!state.generating', 180000);
    const r = await last(); await shot('recover-chat.png');
    return { killed, sawRecover, ...r, ok: killed && !r.error && r.content.length > 50 };
  });
  await stage('crash-twice-error-card', async () => {
    await send('Viết 10 câu tục ngữ Việt Nam và giải thích từng câu.');
    await until('state.generating && state.current.messages.at(-1).content.length > 10'); killEngine();
    await until('/tự nạp lại mô hình/.test(document.querySelector("#genStats").textContent)', 15000);
    await until('state.current.messages.at(-1).content.length > 10', 120000); killEngine();
    await until('!state.generating', 120000);
    const r = await last(); await shot('error-card.png');
    return { ...r, ok: r.error && r.btns.length === 2 };
  });
  await stage('next-turn-after-crash', async () => {
    await send('Thủ đô của Việt Nam là gì?');
    await until('state.generating', 60000); await until('!state.generating', 120000);
    const r = await last(); return { ...r, ok: !r.error && r.content.length > 3 };
  });
  await stage('double-click-guard', async () => {
    await send('Liệt kê 5 tỉnh miền Tây.');
    await until('state.generating', 20000); await sleep(120); await js('document.querySelector("#stopBtn").click()');
    await until('!state.generating', 120000);
    const r = await last(); return { ...r, ok: !/Đã dừng/.test(r.content) && !/đã dừng/.test(r.stats) && r.content.length > 10 };
  });
  await stage('user-stop', async () => {
    await send('Viết bài văn 500 chữ về mùa thu Hà Nội.');
    await until('state.generating && state.current.messages.at(-1).content.length > 20'); await sleep(900);
    await js('document.querySelector("#stopBtn").click()'); await until('!state.generating', 60000);
    const r = await last(); return { stats: r.stats, tail: r.content.slice(-80), ok: /đã dừng/.test(r.stats) };
  });
  await stage('copy-logs', async () => {
    clipboard.writeText('');
    await js('document.querySelector("#advBox").open = true; document.querySelector("#advBox [data-logs=copy]").click()'); await sleep(800);
    const t = String(clipboard.readText() || ''); const viaIpc = await js('A.copyLogs()'); await shot('copy-logs-toast.png');
    return { viaIpc, lines: t.split('\n').length, hasStart: /AIVN 0\.14/.test(t), hasExit: /signal=SIGKILL|tiến trình kết thúc/.test(t), ok: viaIpc.lines > 20 };
  });
  await stage('scan-test', async () => {
    await js('document.querySelector("#advBox .scan-q").value = "firefox"; document.querySelector("#advBox [data-scan]").click()');
    await until('!document.querySelector("#confirmModal").hidden', 60000); await shot('scan-modal.png');
    const r = await js('({ title: cfTitle.textContent, msg: cfMsg.textContent, pre: cfPreview.textContent })'); await js('document.querySelector("#cfNo").click()');
    return { ...r, ok: /ứng dụng/.test(r.pre) };
  });
  await stage('agent-open', async () => {
    await js('show("agent")'); await until('!!state.agent'); await sleep(500);
    await send('Mở Firefox giúp mình'); await until('!state.generating', 120000);
    const r = await js('(() => { const m = state.current.messages.at(-1); return { content: m.content, steps: (m.steps || []).map(s => s.name + ":" + s.status) }; })()');
    await shot('agent-open.png'); return { ...r, ok: r.steps.some(x => /^open_app/.test(x)) };
  });
  await stage('log-files', async () => {
    const a = path.join(LOG.dir, 'aivn.log'), e = path.join(LOG.dir, 'engine.log');
    const ta = fs.readFileSync(a, 'utf8'); return { aivn: fs.statSync(a).size, engine: fs.existsSync(e) ? fs.statSync(e).size : 0, tool: /\[tool\]/.test(ta), load: /\[load\]/.test(ta), ok: fs.statSync(a).size > 1000 && /\[tool\]/.test(ta) };
  });
  save(); app.quit();
}

// QA 0.14.3 (AIVN_QA143=thư mục, chỉ khi phát triển): nút công cụ, đính kèm ở cả hai chế độ, đổi giao diện + giảm chuyển động, tìm trong Kho
async function qa143() {
  const { clipboard, ClipboardItem } = require('electron');
  const dir = process.env.AIVN_QA143; fs.mkdirSync(dir, { recursive: true });
  const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (c, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(150); } return false; };
  const out = { stages: {} }; const save = () => fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify(out, null, 2));
  const shot = async (n) => { await sleep(300); fs.writeFileSync(path.join(dir, n), (await wc.capturePage()).toPNG()); };
  const stage = async (k, f) => { console.log('[qa143] ' + k); try { out.stages[k] = (await f()) || { ok: true }; } catch (e) { out.stages[k] = { error: e.stack || String(e) }; } save(); };
  win.setBounds({ x: 0, y: 0, width: 1400, height: 900 });
  await until('typeof show === "function" && !!state.settings && !!document.querySelector("#input")');
  const fx = process.env.AIVN_QA_FIXTURES; // thư mục có ghi-chu.txt và anh.png
  await stage('chips', async () => {
    await js('show("agent")'); await until('!!state.agent && document.querySelectorAll("#toolChips .tool-chip").length > 0');
    const ids = await js('CHIPS.map(c => c.id)'); const rows = [];
    for (const id of ids) {
      const before = await js(`document.querySelector('[data-chip="${id}"]').className.replace('tool-chip ', '')`);
      const toolsBefore = agent.activeTools();
      await js(`document.querySelector('[data-chip="${id}"] .tc-main').click()`); await sleep(500);
      const consent = await js('!!modalOpen && document.querySelector("#cfTitle").textContent'); if (consent) { await js('document.querySelector("#cfYes").click()'); await sleep(900); } else await sleep(400);
      const after = await js(`document.querySelector('[data-chip="${id}"]').className.replace('tool-chip ', '')`);
      const pop = await js('!!document.querySelector(".chip-pop")');
      const toolsAfter = agent.activeTools();
      const removed = toolsBefore.filter(n => !toolsAfter.includes(n)), added = toolsAfter.filter(n => !toolsBefore.includes(n));
      if (before !== 'blocked' || pop) { await js('closeChipPop()'); }
      if (after !== before && before !== 'blocked') { await js(`document.querySelector('[data-chip="${id}"] .tc-main').click()`); await sleep(900); }
      const restored = await js(`document.querySelector('[data-chip="${id}"]').className.replace('tool-chip ', '')`);
      rows.push({ id, consent: consent || undefined, before, after, popoverForBlocked: before === 'blocked' ? pop : undefined, removed, added, restored, toolsOff: settings.data.agentToolsOff });
    }
    // bàn phím: Tab tới nút, Enter bật/tắt
    await js('document.querySelector(\'[data-chip="calc"] .tc-main\').focus()');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); wc.sendInputEvent({ type: 'char', keyCode: ' ' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); await sleep(900);
    const kb = await js('document.querySelector(\'[data-chip="calc"]\').className');
    await js('document.querySelector(\'[data-chip="calc"] .tc-main\').focus()');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); wc.sendInputEvent({ type: 'char', keyCode: '\r' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); await sleep(900);
    return { rows, keyboardSpace: kb, afterEnter: await js('document.querySelector(\'[data-chip="calc"]\').className') };
  });
  const attachSuite = async (mode) => {
    await js(`show("${mode}"); pending = []; renderChips();`); await sleep(400);
    const r = {};
    // chép/dán chữ
    clipboard.writeText('Dán chữ tiếng Việt: Văn Lang ✓'); await js('document.querySelector("#input").value=""; document.querySelector("#input").focus()'); wc.paste(); await sleep(300);
    r.pasteText = await js('document.querySelector("#input").value');
    await js('document.querySelector("#input").select()'); wc.copy(); await sleep(200); r.copyBack = await clipboard.readText();
    await js('document.querySelector("#input").value=""');
    // dán ảnh
    clipboard.write([new ClipboardItem({ 'image/png': new Blob([fs.readFileSync(path.join(fx, 'anh.png'))], { type: 'image/png' }) })]);
    await js('document.querySelector("#input").focus()'); wc.paste();
    r.pasteImage = await until('!!document.querySelector(".chip.img:not(.loading)")', 60000) && await js('document.querySelector(".chip.img").innerText');
    await js('pending = []; renderChips()');
    // kéo thả (sự kiện drop với DataTransfer chứa ảnh)
    const b64 = fs.readFileSync(path.join(fx, 'anh.png')).toString('base64');
    await js(`(() => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], 'keo-tha.png', { type: 'image/png' })); dt.items.add(new File(['xin chao'], 'ao.txt', { type: 'text/plain' }));
      const p = document.querySelector('#chatPane'); p.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
      window.__dzOn = document.querySelector('#dropzone').classList.contains('on'); p.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true })); })()`);
    r.dropzoneShown = await js('window.__dzOn');
    r.dropImage = await until('!!document.querySelector(".chip.img:not(.loading)")', 60000) && await js('[...document.querySelectorAll("#chips .chip")].map(c => c.innerText.replace(/\\s+/g, " "))');
    await js('pending = []; renderChips()');
    // chọn tệp (hộp thoại giả lập trả 2 tệp)
    const orig = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(fx, 'ghi-chu.txt'), path.join(fx, 'anh.png')] });
    await js('document.querySelector("#attachBtn").click()');
    r.picker = await until('document.querySelectorAll("#chips .chip:not(.loading)").length === 2', 60000) && await js('pending.map(a => a.name + ":" + a.kind + (a.path ? ":path" : ""))');
    dialog.showOpenDialog = orig;
    r.attachBtnVisible = await js('!document.querySelector("#attachBtn").hidden');
    await shot(`attach-${mode}.png`);
    return r;
  };
  await stage('attachChat', () => attachSuite('chat'));
  await stage('attachAgent', async () => {
    const r = await attachSuite('agent');
    if (process.env.AIVN_LOAD) {
      const L = process.env.AIVN_LOAD; const lm = listModels().find(x => x.id === L || (x.path || '').includes(L)); await loadById(lm.id); await until('state.status && state.status.loaded', 60000);
      await js('pending = pending.filter(a => a.kind !== "image"); renderChips()');
      let seen = null; const origRun = agent.run; agent.run = (o) => { seen = { files: (o.attachments || o.files || []).map(f => f.name || f), last: JSON.stringify(o.messages[o.messages.length - 1].content).slice(0, 160) }; return origRun(o); };
      const n = await js('document.querySelectorAll("#messages .msg.assistant").length');
      await js('document.querySelector("#input").value = "Tệp ghi-chu.txt nói về môn học nào? Trả lời ngắn."; document.querySelector("#composer").requestSubmit()');
      await sleep(600); await until(`!document.querySelector("#sendBtn").hidden && document.querySelectorAll("#messages .msg.assistant").length > ${n}`, 240000);
      agent.run = origRun;
      r.agentRun = seen; r.agentAnswer = await js('[...document.querySelectorAll("#messages .msg.assistant")].pop().innerText.slice(0, 300)');
      await shot('agent-attachment-answer.png');
    }
    return r;
  });
  await stage('theme', async () => {
    await js('show("chat"); applyTheme("light"); state.settings.theme = "light";'); await sleep(400);
    const watch = 'window.__veil = false; window.__mo && window.__mo.disconnect(); window.__mo = new MutationObserver(() => { if (document.querySelector("#themeVeil").classList.contains("on")) window.__veil = true; }); window.__mo.observe(document.querySelector("#themeVeil"), { attributes: true }); window.__t0 = performance.now(); new MutationObserver((m, o) => { window.__applied = Math.round(performance.now() - window.__t0); o.disconnect(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });';
    await js(watch); await js('document.querySelector("#themeRow button[data-theme=dark]").click()'); await sleep(1300);
    const normal = { theme: await js('document.documentElement.dataset.theme'), logoVeil: await js('window.__veil'), appliedMs: await js('window.__applied'), saved: settings.data.theme };
    // giảm chuyển động (giả lập cài đặt hệ điều hành qua CDP)
    wc.debugger.attach('1.3'); await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const mq = await js('matchMedia("(prefers-reduced-motion: reduce)").matches');
    await js(watch); await js('document.querySelector("#themeRow button[data-theme=light]").click()'); await sleep(60);
    const fade = await js('document.documentElement.classList.contains("theme-anim")'); await sleep(700);
    const reduced = { mq, theme: await js('document.documentElement.dataset.theme'), logoVeil: await js('window.__veil'), appliedMs: await js('window.__applied'), crossfadeClass: fade, vtLeft: await js('document.documentElement.classList.contains("vt-theme")') };
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); wc.debugger.detach();
    // bấm liên tục 4 lần: kết quả cuối phải đúng nút cuối
    await js('for (const t of ["dark","light","dark","light"]) document.querySelector(`#themeRow button[data-theme=${t}]`).click()'); await sleep(2500);
    const rapid = { theme: await js('document.documentElement.dataset.theme'), veilLeft: await js('document.querySelector("#themeVeil").classList.contains("on")'), saved: settings.data.theme };
    return { normal, reduced, rapid };
  });
  await stage('khoSearch', async () => {
    await js('show("discover")'); await sleep(500);
    const sel = '#searchQ';
    await js(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = "qwen3 0.6b"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); const f = i.closest("form"); if (f) f.requestSubmit(); })()`);
    const ok = await until('document.querySelectorAll("#view-discover .res, #view-discover .result, #results .card, #hfResults > *").length > 0', 30000);
    await shot('kho-search.png');
    return { input: sel, ok, first: await js('(() => { const r = document.querySelector("#view-discover .res, #view-discover .result, #results .card, #hfResults > *"); return r ? r.innerText.slice(0, 160) : null; })()') };
  });
  save(); app.exit(0);
}

// Ảnh chụp 0.14.1 (AIVN_SHOTS141=thư mục): lời chào AIVN AGENT, nút công cụ bật/tắt + bảng ví dụ, 3 khung hình đổi giao diện
async function shots141() {
  const dir = process.env.AIVN_SHOTS141; fs.mkdirSync(dir, { recursive: true });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  const shot = async (n, wait = 400) => { await sleep(wait); fs.writeFileSync(path.join(dir, n), (await wc.capturePage()).toPNG()); };
  const out = {};
  win.setBounds({ x: 0, y: 0, width: 1400, height: 900 }); await sleep(500);
  await js('show("agent"); document.querySelector("#newChat").click()'); await sleep(1200);
  out.header = await js('document.querySelector(".agent-title b").textContent');
  out.welcome = await js('(document.querySelector("#messages .msg.welcome") || {}).innerText || null');
  await shot('01-aivn-bot-welcome.png');
  await js('toggleChip("calc")'); await sleep(900);
  out.chips = await js('[...document.querySelectorAll("#toolChips .tool-chip")].map(c => c.dataset.chip + ":" + c.className.replace("tool-chip ", ""))');
  out.toolsOffSaved = settings.data.agentToolsOff;
  await shot('02-chips-on-off.png');
  await js('openChipPop("web", true)'); await shot('03-chip-popover-web.png');
  await js('document.querySelector(".chip-pop [data-cp=ex]").click()'); await sleep(300);
  out.inserted = await js('document.querySelector("#input").value');
  await js('openChipPop("files", true)'); await shot('04-chip-blocked-files.png');
  await js('closeChipPop(); toggleChip("calc"); document.querySelector("#input").value = ""'); await sleep(800);
  // 3 khung hình đổi giao diện: quay màn hình Xvfb rồi tách khung (capturePage không chụp lớp chuyển cảnh)
  const vid = path.join(dir, 'theme.mp4');
  const grab = require('child_process').spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '30', '-video_size', '1400x900', '-i', process.env.DISPLAY + '+0,0', '-t', '2.2', vid]);
  await sleep(700);
  await js('document.querySelector("#themeRow button[data-theme=dark]").click()');
  await new Promise(r => grab.once('exit', r));
  out.themeAfter = await js('document.documentElement.dataset.theme');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(out, null, 2));
  app.exit(0);
}

// Tự kiểm thử v0.12 (AIVN_SELFTEST_V12=1): nhìn ảnh, RAG trên PDF dài, /v1/embeddings, Kho mô hình, đổi giao diện
async function selfTestV12() {
  const { clipboard, ClipboardItem } = require('electron');
  const wc = win.webContents; const out = { started: new Date().toISOString() };
  const js = (code) => wc.executeJavaScript(code);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const save = () => fs.writeFileSync(process.env.AIVN_SELFTEST_OUT, JSON.stringify(out, null, 2));
  const until = async (code, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await sleep(250); } return false; };
  const shotDir = process.env.AIVN_SHOTS; if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const shot = async (name) => { if (shotDir) { await sleep(350); fs.writeFileSync(path.join(shotDir, name), (await wc.capturePage()).toPNG()); } };
  const ask = async (q) => {
    const n = await js('document.querySelectorAll("#messages .msg.assistant").length');
    await js(`document.querySelector("#input").value = ${JSON.stringify(q)}; document.querySelector("#composer").requestSubmit();`);
    await sleep(500);
    await until(`!document.querySelector("#sendBtn").hidden && document.querySelectorAll("#messages .msg.assistant").length > ${n}`, 600000);
    return js('(() => { const m = [...document.querySelectorAll("#messages .msg.assistant")].pop(); return { body: m.querySelector(".body").innerText, sources: [...m.querySelectorAll(".sources .src")].map(e => e.innerText), stats: document.querySelector("#genStats").innerText }; })()');
  };
  try {
    await until('!!document.querySelector("#input") && !!state.settings');
    out.initialTheme = await js('[window.aivn.initialTheme, document.documentElement.dataset.theme]');
    out.viewTransitions = await js('typeof document.startViewTransition === "function"');
    out.reducedMotion = await js('matchMedia("(prefers-reduced-motion: reduce)").matches');
    // 1) Nhìn ảnh
    const vm = process.env.AIVN_VISION_MODEL;
    if (vm) {
      const t0 = Date.now(); const st = await loadById(vm); out.visionLoad = { ms: Date.now() - t0, vision: !!st.vision, ctx: st.contextSize };
      await until('state.status.vision === true', 20000);
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([fs.readFileSync(process.env.AIVN_TEST_IMAGE)], { type: 'image/png' }) })]);
      await js('document.querySelector("#input").focus()'); wc.paste();
      await until('!!document.querySelector(".chip.img:not(.loading)")', 20000);
      out.visionChip = await js('document.querySelector(".chip.img").innerText');
      const a = await ask('Bức ảnh này vẽ gì? Hãy mô tả bằng tiếng Việt, nêu màu sắc của ngôi nhà và mái nhà.');
      out.visionAnswer = a;
      out.visionNote = await js('[...document.querySelectorAll("#messages .doc-warn.vis")].map(e => e.innerText).join(" | ")');
      out.ocrNoteShown = await js('document.querySelectorAll("#messages .doc-warn.ocr").length');
      await shot('app-vision-light.png');
      await js('document.querySelector("#messages .msg.user").scrollIntoView({ block: "start" })'); await shot('app-vision-image-light.png');
      const f = await ask('Mặt trời trong ảnh màu gì?'); // hỏi tiếp: ảnh được gửi lại trong phiên
      out.visionFollowUp = f.body;
      save();
    }
    // 2) RAG trên PDF dài
    const tm = process.env.AIVN_TEXT_MODEL;
    if (tm && process.env.AIVN_TEST_DOC) {
      if (tm !== vm) await loadById(tm);
      await js('document.querySelector("#newChat").click()');
      out.ragInfo = embedInfo();
      await js(`addFiles([${JSON.stringify(process.env.AIVN_TEST_DOC)}])`);
      await until('!!document.querySelector(".chip:not(.loading)")', 60000);
      out.docChip = await js('document.querySelector(".chip").innerText');
      const t1 = Date.now();
      const a = await ask('Nhà máy Cần Thơ khánh thành ngày nào và công suất thiết kế là bao nhiêu tấn mỗi tháng?');
      out.rag1 = { ...a, ms: Date.now() - t1 };
      await shot('app-rag-sources-light.png');
      const b = await ask('Mã dự án chuyển đổi số là gì và ai phụ trách?'); // không đính kèm lại: tìm trong chỉ mục của cuộc trò chuyện
      out.rag2 = b;
      const cid = await js('state.current && state.current.id'); out.ragIndex = rag.summary(cid);
      save();
    }
    // 2b) Chưa có mô hình nhúng: tìm theo từ khoá + lời mời tải BGE-M3 (tải lần đầu), rồi huỷ tải
    if (process.env.AIVN_RAG_DL_TEST && process.env.AIVN_TEST_DOC) {
      out.fallbackRagInfo = { installed: embedInfo().installed };
      await js('document.querySelector("#newChat").click()');
      await js(`addFiles([${JSON.stringify(process.env.AIVN_TEST_DOC)}])`);
      await until('!!document.querySelector(".chip:not(.loading)")', 60000);
      const a = await ask('Tỷ lệ tái chế bao bì năm 2025 đạt bao nhiêu phần trăm?');
      out.fallback = { body: a.body, sources: a.sources, offer: await js('document.querySelector("#ragOffer").hidden ? null : document.querySelector("#ragOffer").innerText'), keywordContext: !!(await js('[...state.current.messages].reverse().find(m => m.role === "user").context')) };
      await shot('app-rag-offer-light.png');
      await js('document.querySelector("#ragOffer [data-rag=dl]").click()');
      await sleep(6000);
      out.firstUseDownload = { ragText: await js('document.querySelector("#ragText").innerText'), progressVisible: await js('!document.querySelector("#ragProg").hidden'), job: embedInfo().job && { status: embedInfo().job.status, received: embedInfo().job.received, total: embedInfo().job.total, url: hf.resolveUrl(EMBED.repo, EMBED.file) } };
      await shot('app-rag-downloading-light.png');
      const jid = `${EMBED.repo}::${EMBED.file}`; await downloader.remove(jid); await sleep(500);
      out.downloadRemoved = !embedInfo().installed;
      save();
    }
    // 3) /v1/embeddings bằng curl
    if (process.env.AIVN_API_TEST === '1') {
      const port = await api.start(settings.data.apiPort).catch(() => settings.data.apiPort);
      const { execFile } = require('child_process'); // bất đồng bộ: máy chủ API chạy cùng tiến trình
      const curl = (args) => new Promise((res, rej) => execFile('curl', ['-s', ...args], { encoding: 'utf8', timeout: 180000 }, (e, so) => e ? rej(e) : res(so)));
      out.curlCommand = `curl http://localhost:${port}/v1/embeddings -H "Content-Type: application/json" -d '{"model":"bge-m3-q8_0","input":[…3 câu…]}'`;
      const raw = await curl(['http://localhost:' + port + '/v1/embeddings', '-H', 'Content-Type: application/json', '-d', JSON.stringify({ model: 'bge-m3-q8_0', input: ['Nhà máy Cần Thơ có công suất 2.750 tấn mỗi tháng.', 'Công suất của nhà máy ở Cần Thơ là bao nhiêu?', 'Hôm nay trời mưa to ở Hà Nội.'] })]);
      const j = JSON.parse(raw);
      const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
      out.embeddings = { object: j.object, model: j.model, n: j.data && j.data.length, dims: j.data && j.data[0].embedding.length, usage: j.usage,
        simRelated: +dot(j.data[0].embedding, j.data[1].embedding).toFixed(3), simUnrelated: +dot(j.data[0].embedding, j.data[2].embedding).toFixed(3), error: j.error || null };
      out.modelsList = JSON.parse(await curl(['http://localhost:' + port + '/v1/models'])).data.map(m => m.id + (m.type ? ':' + m.type : '') + (m.vision ? ':vision' : ''));
      save();
    }
    // 4) Kho mô hình
    await js('show("discover")'); await until('document.querySelectorAll("#catalog .card").length > 0', 20000);
    out.kho = await js('({ nav: document.querySelector(".nav-item[data-view=discover]").innerText, title: document.querySelector("#view-discover h2").innerText, cards: document.querySelectorAll("#catalog .card").length, visionCards: [...document.querySelectorAll("#catalog .card")].filter(c => c.querySelector(".tag.vis")).map(c => c.querySelector("h4").innerText) })');
    await shot('app-kho-mo-hinh-light.png');
    await js('document.querySelector("#catalog .card .tag.vis").scrollIntoView({ block: "center" })'); await shot('app-kho-vision-cards-light.png');
    if (process.env.AIVN_REPO_TEST) {
      await js(`openRepo(${JSON.stringify(process.env.AIVN_REPO_TEST)})`);
      await until('!!document.querySelector("#repoArea .qtable") || !!document.querySelector("#repoArea .err")', 30000);
      out.repoNotes = await js('[...document.querySelectorAll("#repoArea .note")].map(n => n.innerText)');
      out.repoVisionTag = await js('[...document.querySelectorAll("#repoArea .qr .tag.vis")].length');
      await shot('app-kho-repo-vision-light.png');
    }
    // 5) Đổi giao diện mượt (vòng tròn từ nút bấm)
    await js('show("chat")'); await sleep(300);
    await js('(() => { const o = document.startViewTransition.bind(document); window.__vt = []; document.startViewTransition = (cb) => { const v = o(cb); const t0 = performance.now(); v.ready.then(() => __vt.push("ready " + Math.round(performance.now() - t0)), e => __vt.push("rej " + e.name + ": " + e.message)); v.finished.then(() => __vt.push("fin " + Math.round(performance.now() - t0))); return v; }; })()');
    let grab = null; // quay màn hình Xvfb để thấy hiệu ứng vòng tròn (capturePage không chụp lớp view-transition)
    if (process.env.AIVN_GRAB) { grab = require('child_process').spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '60', '-video_size', '1400x900', '-i', process.env.DISPLAY, '-t', '2.5', process.env.AIVN_GRAB]); await sleep(900); }
    await js('window.__t0 = performance.now(); new MutationObserver((m, o) => { window.__applied = Math.round(performance.now() - window.__t0); o.disconnect(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); document.querySelector("#themeRow button[data-theme=dark]").click()');
    await sleep(150); if (shotDir) fs.writeFileSync(path.join(shotDir, 'app-theme-switch-mid.png'), (await wc.capturePage()).toPNG()); // chụp giữa hiệu ứng (480 ms)
    out.vtClassDuringSwitch = await js('document.documentElement.classList.contains("vt-theme") || document.documentElement.classList.contains("theme-anim")');
    if (grab) await new Promise(r => grab.once('exit', r));
    await sleep(700); out.themeAfter = await js('document.documentElement.dataset.theme'); out.themeAppliedMs = await js('window.__applied'); out.vtLog = await js('window.__vt'); await shot('app-chat-dark.png');
    await js('show("discover")'); await shot('app-kho-mo-hinh-dark.png');
    await js('show("chat")');
    out.themeBeforeBack = await js('[document.documentElement.dataset.theme, applyTheme.pending, state.settings.theme]');
    await js('document.querySelector("#themeRow button[data-theme=light]").click()'); await sleep(900);
    out.themeBack = await js('[document.documentElement.dataset.theme, applyTheme.pending, state.settings.theme]');
    out.saved = (convos.data.list || []).slice(0, 2).map(c => ({ id: c.id, msgs: c.messages.map(m => ({ role: m.role, sources: m.sources ? m.sources.length : 0, visionNote: m.visionNote || null, ctx: !!m.context })) }));
  } catch (e) { out.error = e.stack || String(e); }
  save(); app.quit();
}

// Tự kiểm thử v0.13 (AIVN_SELFTEST_V13=1): AIVN AGENT (nhiều bước, từ chối xoá, ghi nhớ, web), Lịch tự động, API công cụ, ảnh chụp

// Chỉ dùng khi kiểm thử 0.14: cổng kích hoạt, lời chào AIVN AGENT, hiệu ứng đổi giao diện, Bảo mật & Quản trị, thẻ duyệt màn hình
async function selfTestV14() {
  const out = { stages: {} }; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const wc = () => win.webContents; const js = (c) => wc().executeJavaScript(c);
  const save = () => fs.writeFileSync(process.env.AIVN_SELFTEST_OUT, JSON.stringify(out, null, 2));
  const until = async (c, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(150); } return false; };
  const dir = process.env.AIVN_SHOTS; fs.mkdirSync(dir, { recursive: true });
  const shot = async (n, wait = 300) => { if (wait) await sleep(wait); fs.writeFileSync(path.join(dir, n), (await wc().capturePage()).toPNG()); };
  const stage = async (k, f) => { console.log('[v14] ' + k); try { out.stages[k] = (await f()) || { ok: true }; } catch (e) { out.stages[k] = { error: e.stack || String(e) }; } save(); };
  await stage('gate', async () => {
    const mode = await js('window.aivn.gateState().then(s => s.mode)');
    await shot('activation-screen.png', 600);
    if (process.env.AIVN_TEST_CODE) {
      await js(`document.querySelector('#gaCode').value = ${JSON.stringify(process.env.AIVN_TEST_CODE)}; document.querySelector('#gaForm').requestSubmit();`);
      await sleep(1500);
    }
    await until('!!document.querySelector("#messages")', 15000);
    return { modeBefore: mode, url: wc().getURL().split('/').pop(), license: lic.publicInfo().status };
  });
  await stage('welcome', async () => {
    await until('typeof show === "function" && !!state.settings', 15000);
    await js('show("agent")'); await until('!!document.querySelector("#botWelcome")', 10000);
    const text = await js('document.querySelector("#botWelcome").innerText');
    await shot('aivn-bot-welcome.png', 600);
    return { text, nav: await js('document.querySelector(".nav-item[data-view=agent]").innerText'), header: await js('document.querySelector(".agent-title b").innerText') };
  });
  await stage('theme', async () => {
    await js('applyTheme("light"); state.settings.theme = "light";'); await sleep(500);
    const frames = [];
    await js('document.querySelector("#themeRow button[data-theme=dark]").click()');
    const t0 = Date.now();
    for (const [i, at] of [[1, 120], [2, 420], [3, 700]]) { const w = at - (Date.now() - t0); if (w > 0) await sleep(w); await shot(`theme-${i}.png`, 0); frames.push(Date.now() - t0); }
    await sleep(800);
    const after = await js('document.documentElement.dataset.theme');
    await js('document.querySelector("#themeRow button[data-theme=light]").click()'); await sleep(420); await shot('theme-back-mid.png', 0); await sleep(900);
    return { frames, after, back: await js('document.documentElement.dataset.theme'), vt: await js('!!document.startViewTransition') };
  });
  await stage('security', async () => { await js('show("security")'); await until('!!document.querySelector("#secMachine")'); await shot('security.png', 600); return { machine: await js('document.querySelector("#secMachine").innerText') }; });
  await stage('settings', async () => { await js('show("agent")'); await sleep(500); await shot('agent-settings.png', 300); return {}; });
  await stage('screencard', async () => {
    const shotImg = process.env.AIVN_FAKE_SCREEN ? fakeShot() : null; if (!shotImg) return { skipped: true };
    const p = askScreen({ action: 'click', desc: 'bấm chuột trái vào “nút Gửi”', target: 'nút Gửi', image: shotImg.dataUrl, w: shotImg.width, h: shotImg.height, needPoint: true, box: { x1: 0.62, y1: 0.7, x2: 0.74, y2: 0.78, found: true } });
    await until('!document.querySelector("#screenModal").hidden'); await shot('screen-approval.png', 500);
    await js('document.querySelector("#scNo").click()'); return { answer: await p };
  });
  out.done = true; save(); app.exit(0);
}
async function selfTestV13() {
  const wc = win.webContents; const out = { started: new Date().toISOString(), stages: {} };
  const js = (code) => wc.executeJavaScript(code);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const save = () => fs.writeFileSync(process.env.AIVN_SELFTEST_OUT, JSON.stringify(out, null, 2));
  const until = async (code, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await sleep(250); } return false; };
  const shotDir = process.env.AIVN_SHOTS; if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const shot = async (name) => { if (shotDir) { await sleep(400); fs.writeFileSync(path.join(shotDir, name), (await wc.capturePage()).toPNG()); } };
  const want = (k) => !process.env.AIVN_V13_ONLY || process.env.AIVN_V13_ONLY.split(',').includes(k);
  const stage = async (k, fn) => { if (!want(k)) return; const t0 = Date.now(); console.log('[v13] ' + k); try { out.stages[k] = { ...(await fn()), ms: Date.now() - t0 }; } catch (e) { out.stages[k] = { error: e.stack || String(e), ms: Date.now() - t0 }; } save(); };
  const lastMsg = () => js('(() => { const m = [...document.querySelectorAll("#messages .msg.assistant")].pop(); const i = Number(m.dataset.i); const d = state.current.messages[i] || {}; return { body: m.querySelector(".body").innerText, steps: (d.steps || []).map(s => ({ name: s.name, status: s.status, args: s.args, summary: s.summary })), urls: d.urls || [], memories: d.memories || [], stats: document.querySelector("#genStats").innerText, cards: m.querySelectorAll("details.step").length }; })()');
  const ask = async (q, { onBusy } = {}) => {
    const n = await js('document.querySelectorAll("#messages .msg.assistant").length');
    await js(`document.querySelector("#input").value = ${JSON.stringify(q)}; document.querySelector("#composer").requestSubmit();`);
    await sleep(400);
    if (onBusy) await onBusy();
    await until(`!document.querySelector("#sendBtn").hidden && document.querySelectorAll("#messages .msg.assistant").length > ${n}`, 900000);
    await sleep(300);
    return lastMsg();
  };
  const newAgentChat = () => js('show("agent"); document.querySelector("#newChat").click()').then(() => sleep(300));
  const dir = process.env.AIVN_AGENT_DIR;
  const small = process.env.AIVN_SMALL_MODEL, big = process.env.AIVN_AGENT_MODEL;
  try {
    await until('!!document.querySelector("#input") && !!state.settings');
    settings.data.agentFolders = dir ? [dir] : []; settings.data.agentWeb = false; settings.data.agentPython = false; settings.data.agentMemory = true; settings.save();
    await js('state.settings = null; A.getSettings().then(s => state.settings = s)'); await until('!!state.settings');

    await stage('smallWarning', async () => {
      if (!small) return { skipped: true };
      await loadById(small); await js('show("agent")'); await until('!document.querySelector("#agentWarn").hidden', 10000); await js('refreshAgent()'); await sleep(500);
      const r = { model: engine.status().id, advice: agentAdvice(), warn: await js('document.querySelector("#agentWarn").hidden ? null : document.querySelector("#agentWarn").innerText') };
      await shot('app-agent-small-model-warning.png'); return r;
    });
    await loadById(big); await js('show("agent")'); await sleep(300); await js('refreshAgent()'); await sleep(400);
    out.agentInfo = agentInfo();
    await stage('emptyState', async () => { await newAgentChat(); await shot('app-agent-empty-light.png'); return { warnHidden: await js('document.querySelector("#agentWarn").hidden'), chips: await js('document.querySelector("#toolChips").innerText') }; });

    await stage('multiStep', async () => {
      const target = path.join(dir, 'bao-cao-chi-tieu.md'); try { fs.unlinkSync(target); } catch {}
      await newAgentChat();
      const a = await ask('Đọc tệp chi-tieu-thang-9.csv trong thư mục được phép, tính tổng chi tiêu, trung bình mỗi khoản và nhóm chi nhiều nhất, rồi ghi bản tóm tắt ngắn vào tệp bao-cao-chi-tieu.md.');
      const written = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
      await js('[...document.querySelectorAll("#messages details.step")].slice(-3).forEach(d => d.open = true); document.querySelector("#messages .msg.assistant:last-child")?.scrollIntoView({ block: "start" })');
      await shot('app-agent-multistep-light.png');
      await js('document.querySelector("#messages").scrollTop = 1e9'); await shot('app-agent-multistep-answer-light.png');
      return { answer: a, fileWritten: !!written, fileContent: written, hasTotal: !!written && /1[.,]?766[.,]?000/.test(written), hasTop: !!written && /Ăn uống/i.test(written) };
    });

    await stage('refusedDelete', async () => {
      const victim = path.join(dir, 'ghi-chu-cu.txt'); fs.writeFileSync(victim, 'Ghi chú cũ, đừng xoá nhầm.\n');
      await newAgentChat();
      let modal = null;
      const a = await ask('Xoá tệp ghi-chu-cu.txt trong thư mục được phép giúp tôi.', { onBusy: async () => {
        const shown = await until('!document.querySelector("#confirmModal").hidden || !document.querySelector("#sendBtn").hidden', 300000);
        if (shown && await js('!document.querySelector("#confirmModal").hidden')) {
          modal = await js('({ title: cfTitle.innerText, msg: cfMsg.innerText, path: cfPath.innerText, yes: cfYes.innerText, no: cfNo.innerText })');
          await shot('app-agent-confirm-delete-light.png');
          await js('document.querySelector("#cfNo").click()');
        }
      } });
      await shot('app-agent-delete-refused-light.png');
      return { modal, answer: a, fileStillExists: fs.existsSync(victim) };
    });

    await stage('memory', async () => {
      memory.clear();
      await newAgentChat();
      const a = await ask('Hãy ghi nhớ giúp tôi: tôi tên Khôi, là sinh viên VLU, môn học tôi thích nhất là Trí tuệ nhân tạo.');
      const saved = memory.list().map(m => m.text);
      await newAgentChat();
      const convA = await js('state.current ? state.current.id : null');
      const b = await ask('Môn học tôi thích nhất là gì, và tôi học trường nào?');
      await shot('app-agent-memory-recall-light.png');
      await js('show("memory")'); await sleep(600); await shot('app-memory-page-light.png');
      return { save: a, saved, recall: b, newConvo: convA === null || convA !== (await js('state.current && state.current.id')), recalled: /trí tuệ nhân tạo/i.test(b.body) };
    });

    await stage('web', async () => {
      settings.data.agentWeb = false; settings.save(); await js('A.getSettings().then(s => state.settings = s); refreshAgent()');
      await newAgentChat();
      const off = await ask('Tìm trên mạng xem Trường Đại học Văn Lang được thành lập năm nào.');
      const offTools = agent.activeTools();
      await js('show("agent")'); await sleep(200);
      await js('document.querySelector("#agWeb").click()'); await sleep(800);
      await newAgentChat();
      const on = await ask('Tìm trên mạng xem Trường Đại học Văn Lang được thành lập năm nào.');
      await js('document.querySelector("#messages").scrollTop = 1e9'); await shot('app-agent-web-light.png');
      const onTools = agent.activeTools();
      await js('document.querySelector("#agWeb").click()'); await sleep(500);
      return { off: { ...off, toolsOffered: offTools, usedWeb: off.steps.some(s => /web_search|fetch_url/.test(s.name)) }, on: { ...on, toolsOffered: onTools, usedWeb: on.steps.some(s => /web_search|fetch_url/.test(s.name)) }, webAfter: settings.data.agentWeb };
    });

    await stage('schedule', async () => {
      // tạo lời nhắc qua biểu mẫu (phút tới), và một việc AIVN AGENT chạy sau ~25 giây
      await js('show("schedule")'); await sleep(400);
      const at = new Date(Date.now() + 60e3); const p2 = (n) => String(n).padStart(2, '0');
      await js(`(() => { document.querySelector("#sfTitle").value = "Uống nước"; document.querySelector('#sfKind [data-kind=reminder]').click(); document.querySelector("#sfMsg").value = "Đứng dậy uống một cốc nước nhé!"; document.querySelector('#sfRepeat [data-rep=once]').click(); document.querySelector("#sfDate").value = "${at.getFullYear()}-${p2(at.getMonth() + 1)}-${p2(at.getDate())}"; document.querySelector("#sfTime").value = "${p2(at.getHours())}:${p2(at.getMinutes())}"; document.querySelector("#schedForm").requestSubmit(); })()`);
      await sleep(600);
      const job = scheduler.create({ title: 'Tính tiền điện', kind: 'agent', prompt: 'Tính 15% của 2.400.000 đồng rồi trả lời một câu.', repeat: 'once', at: Date.now() + 25e3 });
      scheduler.create({ title: 'Ôn bài Trí tuệ nhân tạo', kind: 'reminder', message: 'Ôn chương 3 trước buổi học.', repeat: 'weekly', time: '19:30', days: [1, 3, 5] });
      scheduler.create({ title: 'Tóm tắt tin tức buổi sáng', kind: 'agent', prompt: 'Tìm 3 tin công nghệ nổi bật hôm nay và tóm tắt.', repeat: 'daily', time: '07:00' });
      await js('refreshSched()'); await sleep(400); await shot('app-schedule-light.png');
      const list0 = scheduler.list();
      const rem = list0.find(t => t.title === 'Uống nước');
      const fired = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 200e3) {
        const l = scheduler.list(); const r1 = l.find(t => t.id === rem.id), r2 = l.find(t => t.id === job.id);
        if (r1.runs.length && r2.runs.length) break; await sleep(2000);
      }
      const l = scheduler.list(); const r1 = l.find(t => t.id === rem.id), r2 = l.find(t => t.id === job.id);
      const conv = (id) => { const c = convos.data.list.find(x => x.id === 'sched_' + id); return c ? c.messages.map(m => ({ role: m.role, content: m.content.slice(0, 300), steps: (m.steps || []).map(s => s.name + ':' + s.status) })) : null; };
      await js('refreshSched()'); await sleep(400); await shot('app-schedule-fired-light.png');
      await js(`openConvo("sched_${job.id}")`); await sleep(800); await shot('app-schedule-agent-result-light.png');
      return { reminder: { scheduledFor: new Date(rem.at).toString(), runs: r1.runs, convo: conv(rem.id) }, agentJob: { runs: r2.runs, convo: conv(job.id) }, lastNotice, describe: l.map(t => t.title + ' — ' + t.schedule) };
    });

    await stage('api', async () => {
      const port = await api.start(settings.data.apiPort).catch(() => settings.data.apiPort);
      const { execFile } = require('child_process');
      const curl = (body) => new Promise((res, rej) => execFile('curl', ['-s', `http://localhost:${port}/v1/chat/completions`, '-H', 'Content-Type: application/json', '-d', JSON.stringify(body)], { encoding: 'utf8', timeout: 300000 }, (e, so) => e ? rej(e) : res(so)));
      const tools = [{ type: 'function', function: { name: 'get_weather', description: 'Lấy thời tiết hiện tại của một thành phố', parameters: { type: 'object', properties: { city: { type: 'string', description: 'Tên thành phố' }, unit: { type: 'string', enum: ['c', 'f'] } }, required: ['city'] } } }];
      const msgs = [{ role: 'user', content: 'Thời tiết ở Đà Nẵng bây giờ thế nào?' }];
      const r1 = JSON.parse(await curl({ model: 'local', messages: msgs, tools, temperature: 0.2 }));
      const call = r1.choices && r1.choices[0].message.tool_calls && r1.choices[0].message.tool_calls[0];
      let r2 = null;
      if (call) r2 = JSON.parse(await curl({ model: 'local', tools, messages: [...msgs, r1.choices[0].message, { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ city: 'Đà Nẵng', temp_c: 29, sky: 'nắng nhẹ, có mây', humidity: 74 }) }] }));
      const r3 = JSON.parse(await curl({ model: 'local', messages: [{ role: 'user', content: 'Chào bạn' }], tools, tool_choice: { type: 'function', function: { name: 'get_weather' } } }));
      const r4 = JSON.parse(await curl({ model: 'local', messages: [{ role: 'user', content: 'Trích thông tin: Nguyễn Văn An, 21 tuổi, học ngành Công nghệ thông tin tại VLU.' }], response_format: { type: 'json_schema', json_schema: { name: 'sv', schema: { type: 'object', properties: { ho_ten: { type: 'string' }, tuoi: { type: 'integer' }, nganh: { type: 'string' }, truong: { type: 'string' } }, required: ['ho_ten', 'tuoi', 'nganh', 'truong'] } } } }));
      const r5 = JSON.parse(await curl({ model: 'local', messages: msgs, tools, tool_choice: 'none', max_tokens: 80 }));
      return { port, curlExample: `curl http://localhost:${port}/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"local","messages":[{"role":"user","content":"Thời tiết ở Đà Nẵng bây giờ thế nào?"}],"tools":[…get_weather…]}'`,
        step1: { finish: r1.choices && r1.choices[0].finish_reason, message: r1.choices && r1.choices[0].message, error: r1.error },
        step2: r2 && { finish: r2.choices[0].finish_reason, content: r2.choices[0].message.content },
        forced: { finish: r3.choices && r3.choices[0].finish_reason, tool_calls: r3.choices && r3.choices[0].message.tool_calls, error: r3.error },
        jsonSchema: { content: r4.choices && r4.choices[0].message.content, parsed: (() => { try { return JSON.parse(r4.choices[0].message.content); } catch { return null; } })(), error: r4.error },
        none: { finish: r5.choices && r5.choices[0].finish_reason, hasToolCalls: !!(r5.choices && r5.choices[0].message.tool_calls), content: r5.choices && r5.choices[0].message.content } };
    });

    await stage('shots', async () => {
      await js('show("discover")'); await until('document.querySelectorAll("#catalog .card").length > 0', 20000);
      const tags = await js('[...document.querySelectorAll("#catalog .card")].filter(c => c.querySelector(".tag.agent")).map(c => c.querySelector("h4").innerText)');
      await js('document.querySelector("#catalog .card .tag.agent")?.scrollIntoView({ block: "center" })'); await shot('app-kho-agent-tags-light.png');
      await js('show("agent")'); await sleep(300);
      await js('document.querySelector("#themeRow button[data-theme=dark]").click()'); await sleep(1200);
      await js('state.current = state.convos.find(c => c.mode === "agent" && c.messages.some(m => m.steps && m.steps.length > 1)) || state.current; renderConvos(); renderMessages(); [...document.querySelectorAll("#messages details.step")].slice(0, 2).forEach(d => d.open = true)'); await shot('app-agent-dark.png');
      await js('show("schedule")'); await shot('app-schedule-dark.png');
      await js('show("memory")'); await shot('app-memory-dark.png');
      await js('show("agent")'); await js('document.querySelector("#themeRow button[data-theme=light]").click()'); await sleep(900);
      return { agentTaggedCards: tags };
    });
  } catch (e) { out.error = e.stack || String(e); }
  out.finished = new Date().toISOString(); save(); app.quit();
}

const gotLock = isTest || app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(async () => {
    initStores();
    registerIpc();
    createWindow({ hidden: process.argv.includes('--hidden') && settings.data.keepInTray });
    if (activated()) startServices(); // chưa kích hoạt: không chạy lịch, API, mô hình
    else LOG.log('app', 'Máy chưa kích hoạt: chờ nhập mã (bộ máy AI, lịch tự động, máy chủ API chưa chạy)');
    licenseCheck().catch(() => {});
    startGateTimers();
    if (app.isPackaged || process.env.AIVN_UPDATE_CHECK === '1') setTimeout(() => updater.check({ silent: true }), Number(process.env.AIVN_UPDATE_DELAY || 5000));
    if (process.env.AIVN_SHOTS141) win.webContents.once('did-finish-load', () => setTimeout(() => shots141().catch(e => { console.error('SHOTS lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_AGENTBENCH && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaBench().catch(e => { console.error('BENCH lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QACU && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaCU().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QA144 && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qa144().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QA143 && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qa143().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_SELFTEST_V14) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestV14().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1200));
    if (process.env.AIVN_SELFTEST_V13) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestV13().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1500));
    if (process.env.AIVN_SELFTEST_V12) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestV12().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1500));
    if (process.env.AIVN_SELFTEST_UI) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestUi().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1500));
    if (process.env.AIVN_SELFTEST_HF) selfTestHf().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); });
    if (process.env.AIVN_SELFTEST_DOC) selfTestDoc().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); });
    if (process.env.AIVN_BENCH_STARTUP && !app.isPackaged) { // chỉ kiểm thử: đo thời gian khởi động + bộ nhớ
      const t0 = (process.getCreationTime && process.getCreationTime()) || Date.now();
      win.webContents.once('did-finish-load', async () => {
        const dfl = Date.now() - t0;
        const until = async (c) => { for (let i = 0; i < 200; i++) { try { if (await win.webContents.executeJavaScript(c)) return; } catch {} await new Promise(r => setTimeout(r, 25)); } };
        await until('typeof state !== "undefined" && !!(state.settings && document.querySelector("#input"))'); const ready = Date.now() - t0;
        await new Promise(r => setTimeout(r, 5000));
        const m = app.getAppMetrics(); const mem = m.reduce((a, x) => a + (x.memory ? x.memory.workingSetSize : 0), 0);
        let engMB = 0; try { const { execSync } = require('child_process'); engMB = Math.round(execSync(`for p in $(pgrep -P ${process.pid} -f engine-host); do ps -o rss= -p $p; done`, { shell: '/bin/bash' }).toString().split(/\s+/).filter(Boolean).map(Number).reduce((a, b) => a + b, 0) / 1024); } catch {}
        const res = { didFinishLoadMs: dfl, uiReadyMs: ready, appMemMB: Math.round(mem / 1024), engineHostMB: engMB, byType: m.map(x => x.type + ':' + Math.round((x.memory ? x.memory.workingSetSize : 0) / 1024)).join(' ') };
        fs.writeFileSync(process.env.AIVN_BENCH_STARTUP, JSON.stringify(res)); app.exit(0);
      });
    }
    if (process.env.AIVN_SHOTSET && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(async () => { // chỉ kiểm thử: chụp loạt ảnh theo danh sách JSON [{name, js, w, h, wait}]
      const dir = process.env.AIVN_SHOTSET; fs.mkdirSync(dir, { recursive: true });
      const list = JSON.parse(fs.readFileSync(process.env.AIVN_SHOTSET_LIST, 'utf8'));
      for (const s of list) {
        try { win.setBounds({ x: 0, y: 0, width: s.w || 1280, height: s.h || 720 }); await new Promise(r => setTimeout(r, 300));
          if (s.js) await win.webContents.executeJavaScript(s.js); await new Promise(r => setTimeout(r, s.wait || 900));
          fs.writeFileSync(path.join(dir, s.name + '.png'), (await win.webContents.capturePage()).toPNG()); console.log('[shot] ' + s.name);
        } catch (e) { console.error('[shot] ' + s.name, e.message); }
      }
      app.exit(0);
    }, Number(process.env.AIVN_SHOT_DELAY || 3000)));
    if (process.env.AIVN_SHOT) setTimeout(async () => { // chỉ dùng khi kiểm thử: chụp màn hình cửa sổ
      try { if (process.env.AIVN_SHOT_JS) await win.webContents.executeJavaScript(process.env.AIVN_SHOT_JS); await new Promise(r => setTimeout(r, 1500));
        fs.writeFileSync(process.env.AIVN_SHOT, (await win.webContents.capturePage()).toPNG()); } catch (e) { console.error(e); }
      if (process.env.AIVN_SHOT_QUIT) app.quit();
    }, Number(process.env.AIVN_SHOT_DELAY || 8000));
  });
  app.on('window-all-closed', async () => {
    if (settings && settings.data.keepInTray && tray && !quitting) return; // vẫn chạy trong khay
    await api.stop().catch(() => {}); await engine.unloadModel().catch(() => {}); await engine.stop().catch(() => {}); app.quit(); });
  app.on('will-quit', () => { mcp && mcp.stopAll().catch(() => {}); scheduler && scheduler.stop(); engine.stop().catch(() => {}); });
}
