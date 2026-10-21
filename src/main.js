const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, Tray, nativeImage, globalShortcut, powerMonitor, net, clipboard, protocol } = require('electron');
// 0.16: ngôn ngữ giao diện (vi/en/zh) — menu, hộp thoại, khay, thông báo của tiến trình chính dịch theo cài đặt uiLang (khoá = câu tiếng Việt, src/i18n)
const I18N_CORE = require('./i18n/core');
const I18N = I18N_CORE.create({ en: require('./i18n/en'), zh: require('./i18n/zh') });
const uiLang = () => { const l = settings && settings.data && settings.data.uiLang; return I18N_CORE.LANGS.includes(l) ? l : 'vi'; };
const T = (s) => I18N.tr(s, uiLang());
const TO = (o) => I18N.trOpts(o, uiLang());
for (const k of ['showOpenDialog', 'showSaveDialog', 'showMessageBox', 'showOpenDialogSync', 'showSaveDialogSync', 'showMessageBoxSync']) {
  const f = dialog[k].bind(dialog); dialog[k] = (a, b) => (b === undefined ? f(TO(a)) : f(a, TO(b)));
}
{ const ebox = dialog.showErrorBox.bind(dialog); dialog.showErrorBox = (t, c) => ebox(T(t), T(c)); }
{ const bft = Menu.buildFromTemplate.bind(Menu); Menu.buildFromTemplate = (tpl) => bft(TO(tpl)); }
// Giao diện tiếng Việt: ô ngày/giờ và hộp thoại mặc định của Chromium theo vi-VN
app.commandLine.appendSwitch('lang', 'vi');
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
const { welcomeFor, TOOL_GROUPS } = require('./agent/agent');
const { toolSupport } = require('./toolsupport');
const { createAppLock, resetData } = require('./applock');
const LIC = require('./license');
const PERF = require('./perf');
const docsPool = require('./docs-pool');
const MEDIA = require('./media'); MEDIA.registerScheme(protocol); // âm thanh/video đính kèm: bộ nghe chạy trong cửa sổ ẩn (phải đăng ký giao thức trước khi app sẵn sàng)
let media = null;

const isTest = process.env.AIVN_TEST === '1';
// Giới hạn bộ nhớ JS của giao diện trên máy yếu (đọc mức đã tính ở lần chạy trước; phải đặt trước khi app sẵn sàng)
try { const ud0 = process.env.AIVN_USER_DATA || app.getPath('userData'); const pc = JSON.parse(fs.readFileSync(path.join(ud0, 'perf-cache.json'), 'utf8')); if (pc.rendererHeapMB > 0) app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${pc.rendererHeapMB}`); } catch {}
if (process.env.AIVN_USER_DATA) app.setPath('userData', process.env.AIVN_USER_DATA);
// QA runner --profile <thư mục>: hồ sơ RIÊNG (đặt TRƯỚC khoá một-phiên-bản → là một bản AIVN riêng, không đụng AIVN đang mở của người dùng
// cùng trò chuyện/kinh doanh/ghi nhớ/lịch của họ). Chỉ dùng chung thư mục mô hình (chỉ đọc, trừ khi tải thêm) và chép bản sao giấy phép (chỉ đọc).
const QA_PROFILE = (() => { try { const q = require('./qa-runner').fromArgv(process.argv, process.env); if (!q.enabled || !q.args.profile) return null;
  const real = app.getPath('userData'); const dir = q.args.profile; if (path.resolve(dir) === path.resolve(real)) return null;
  fs.mkdirSync(dir, { recursive: true }); app.setPath('userData', dir);
  try { const lf = path.join(real, 'license.json'); if (fs.existsSync(lf)) { fs.copyFileSync(lf, path.join(dir, 'license.json')); } } catch {}
  return { dir, real, models: path.join(real, 'models') }; } catch { return null; } })();
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
// B13 (QA lượt 2): ghi pid llama-server ra tệp; lần mở sau dọn tiến trình còn sót khi AIVN bị tắt đột ngột (kill, sập, mất điện…)
const ORPH = require('./orphans');
const pidFile = ORPH.createPidFile(path.join(app.getPath('userData'), 'llama-server-pids.json'));
{ const VS = require('./vision-server'); VS.HOOKS.spawn = (pid) => pidFile.add(pid); VS.HOOKS.exit = (pid) => pidFile.remove(pid); process.on('exit', () => VS.killAllSync()); }
let engine;
if (nodePath) {
  const { createEngineProxy } = require('./engine-proxy');
  engine = createEngineProxy({ nodePath, hostScript, pidFile, log: (m) => { console.log(m); LOG.log('engine', m); },
    onProgress: (p) => send('model:progress', { id: p.id, pct: p.pct, mode: p.mode }),
    onCrash: (e) => { engineDied = true; send('model:status', { loaded: false }); send('engine:crash', { message: e.message }); } });
} else {
  console.warn('[engine] không tìm thấy Node.js đi kèm, chạy llama.cpp ngay trong Electron (mô hình > 2 GB chạy CPU có thể lỗi)');
  if (process.resourcesPath && !process.env.AIVN_RESOURCES) process.env.AIVN_RESOURCES = process.resourcesPath;
  const inproc = require('./engine');
  inproc.setLoadProgress((p) => send('model:progress', { id: p.id, pct: p.pct, mode: p.mode }));
  engine = { ...inproc, external: false, calibrate: async () => {}, ocr: (b) => require('./ocr').recognize(b), start: async () => {}, stop: async () => {} };
}

let lastUse = Date.now(); let busy = 0; // dùng để tự gỡ mô hình khi rảnh lâu (mức Tiết kiệm)
for (const k of ['generate', 'chatStep']) { const f = engine[k]; if (typeof f === 'function') engine[k] = (...a) => { lastUse = Date.now(); busy++; const p = Promise.resolve().then(() => f(...a)); p.finally(() => { busy--; lastUse = Date.now(); }).catch(() => {}); p.then((r) => noteUsage(r), () => {}); return p; }; }
// 0.16 Mô hình của tôi: lần dùng cuối + tốc độ đo được thật (token/giây, trung bình trượt) cho mỗi mô hình
let usageSaveT = null;
function noteUsage(r, idOverride) {
  try {
    if (!settings) return; const st = engine.status(); const id = idOverride || st.id; if (!id) return;
    const u = settings.data.modelUsage || (settings.data.modelUsage = {}); const e = u[id] || (u[id] = { uses: 0 });
    e.lastUsed = Date.now(); if (!idOverride) e.uses = (e.uses || 0) + 1;
    const tps = r && r.usage && Number(r.usage.tokensPerSecond); const n = r && r.usage && Number(r.usage.completion_tokens);
    if (tps > 0 && n >= 16) e.tps = e.tps ? Math.round((e.tps * 0.7 + tps * 0.3) * 10) / 10 : Math.round(tps * 10) / 10;
    clearTimeout(usageSaveT); usageSaveT = setTimeout(() => { try { settings.save(); } catch {} }, 3000);
  } catch {}
}
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
// 0.15.2: ngữ cảnh tối thiểu. Lời nhắc hệ thống + mô tả công cụ của AIVN AGENT ~2–4 nghìn token, nên AGENT cần ≥ 8192.
const MIN_CTX_CHAT = 4096, MIN_CTX_AGENT = 8192;
const AGENT_CTX = 16384; // ngữ cảnh AIVN AGENT thường cần (ảnh chụp màn hình + lịch sử) — dùng khi xét “chạy mượt” cho agent
// Lỗi "ngữ cảnh không đủ" của node-llama-cpp / llama-server (tiếng Anh) → nhận ra để tự tăng ngữ cảnh hoặc báo tiếng Việt
const CTX_ERR_RE = /compress chat history|context shift|too long prompt|context size|exceeds? the (available )?context|input is too long|prompt is too long|n_ctx|context length/i;
const isCtxErr = (e) => !!e && (e.code === 'CTX_SMALL' || CTX_ERR_RE.test(String(e.message || e)));
function ctxSmallError(have, want) {
  const x = new Error(`Cuộc trò chuyện này cần nhiều ngữ cảnh hơn mức mô hình đang có (${have || '?'} token). AIVN chưa tăng được ngữ cảnh tự động${want ? ` lên ${want}` : ''}. Hãy bấm “Tăng ngữ cảnh”, bắt đầu cuộc trò chuyện mới, hoặc chọn mô hình nhỏ hơn.`);
  x.code = 'CTX_SMALL'; return x;
}
// Chạy fn; nếu lời nhắc không vừa ngữ cảnh: nạp lại mô hình với ngữ cảnh lớn hơn (giảm lớp GPU nếu cần, KHÔNG giảm ngữ cảnh) rồi thử lại MỘT lần
async function withCtxGrow(fn, { minCtx = MIN_CTX_CHAT, maxCtx = 0, onGrow } = {}) {
  try { return await fn(); }
  catch (e) {
    if (!isCtxErr(e) || cloudBrainOn()) throw e;
    const st = engine.status(); const have = st.contextSize || 0;
    if (e.stepsDone) { engineLog('Hết ngữ cảnh giữa lượt (đã chạy ' + e.stepsDone + ' bước công cụ) — không tự chạy lại để tránh lặp thao tác', e, { have }); throw ctxSmallError(have, null); }
    const train = (st.meta && st.meta.trainCtx) || 32768;
    const need = Number(e.need) || 0;
    // B17: máy yếu dùng ngữ cảnh AIVN AGENT 12K để mô hình nằm trọn VRAM — không tự nới quá mức đó (lịch sử được thu gọn thay vào)
    const want = Math.min(train, maxCtx > 0 ? Math.max(maxCtx, have) : Infinity, Math.max(minCtx, Math.ceil(Math.max(need * 1.3, have * 2) / 4096) * 4096));
    if (!settings.data.lastModel || !st.loaded || want <= have) { engineLog('Ngữ cảnh không đủ, không tăng được', e, { have, need, train }); throw ctxSmallError(have, null); }
    engineLog(`Ngữ cảnh ${have} không đủ (cần ~${need || '?'} token): tự nạp lại mô hình với ngữ cảnh ${want}`, e, { have, need, want });
    onGrow && onGrow(want);
    try { await loadById(settings.data.lastModel, { force: true, ctx: want, minCtx: want, reason: 'tăng ngữ cảnh' }); }
    catch (e2) { engineLog('Không nạp lại được với ngữ cảnh lớn hơn', e2, { want }); throw ctxSmallError(have, want); }
    const now = engine.status().contextSize || 0;
    try { return await fn(); }
    catch (e3) { if (isCtxErr(e3)) throw ctxSmallError(now, null); throw e3; }
  }
}
// Bộ máy AI dừng giữa lượt (sập/thiếu bộ nhớ): nạp lại mô hình với ngữ cảnh nhỏ hơn rồi thử lại MỘT lần
async function withEngineRecovery(fn, { onRetry, minCtx = MIN_CTX_CHAT } = {}) {
  try { return await fn(); }
  catch (e) {
    if (!e || e.code !== 'ENGINE_EXIT' || !settings.data.lastModel) throw e;
    engineDied = true;
    const prev = lastCtx || settings.data.contextSize || 4096;
    const ctx = Math.max(minCtx, prev > 8192 ? 8192 : MIN_CTX_CHAT); // 0.15.2: không xuống dưới 4096 (AIVN AGENT: 8192)
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
const hw = async () => (hwCache ||= await engine.hardwareInfo().catch(() => ({ ram: require('os').totalmem() })).then(h => (process.env.AIVN_QA_FAKEHW && !app.isPackaged ? { ...h, ...JSON.parse(process.env.AIVN_QA_FAKEHW) } : h)));
const generations = new Map(); // reqId -> AbortController
const stopReasons = new Map(); // reqId -> lý do dừng (ghi nhật ký + hiện cho người dùng)
function abortGen(reqId, ac, reason) { if (!ac || ac.signal.aborted) return; stopReasons.set(reqId, reason); LOG.log('app', `Dừng lượt ${reqId}: ${reason}`); try { ac.abort(); } catch {} }
const serverLog = [];

let modelsDirProblem = null;
function initStores() {
  const ud = app.getPath('userData');
  paths = { userData: ud, models: QA_PROFILE ? QA_PROFILE.models : path.join(ud, 'models') }; // hồ sơ QA: dùng chung mô hình của hồ sơ thật
  fs.mkdirSync(paths.models, { recursive: true });
  settings = new JsonStore(path.join(ud, 'settings.json'), {
    systemPrompt: 'Bạn là AIVN, một trợ lý AI thân thiện. Hãy trả lời bằng tiếng Việt, rõ ràng và chính xác.',
    temperature: 0.7, maxTokens: 1024, contextSize: 0, perfMode: 'auto', apiPort: 1234, apiAutoStart: false, apiLan: false, apiCors: false, apiKey: '', apiTtlMin: 0, imported: [], lastModel: null, hfToken: '', uiLang: 'vi', theme: 'light', themeFx: 'full', rag: true, vision: true,
    agentFolders: [], agentWeb: false, agentPython: false, agentMemory: true, agentTemperature: 0.2, agentComputer: true, agentScreen: false, agentScreenMode: 'each', agentAutonomy: false, agentScreenBudget: 40, agentAutoReadOnly: false, keepInTray: false, openAtLogin: false,
  });
  // thư mục mô hình do người dùng chọn (Cài đặt → Chung / Mô hình của tôi → Đổi thư mục); ổ đã rút / không ghi được → về mặc định, báo trong nhật ký
  if (!QA_PROFILE && settings.data.modelsDir) { const v = require('./models-dir').validateTarget(settings.data.modelsDir); if (v.ok) paths.models = v.dir; else { modelsDirProblem = `${settings.data.modelsDir}: ${v.error}`; LOG.log('app', 'Thư mục mô hình đã chọn không dùng được, tạm dùng thư mục mặc định: ' + modelsDirProblem); } }
  if (!settings.data.perfMigrated) { if (settings.data.contextSize === 4096) settings.data.contextSize = 0; settings.data.perfMigrated = 1; settings.save(); } // 4096 là mặc định cũ → chuyển sang Tự động theo mức máy
  Object.assign(process.env, Object.fromEntries(Object.entries(engineEnv()).filter(([k, v]) => v && !process.env[k]))); // bộ máy (tiến trình riêng) kế thừa các biến này khi khởi động
  convos = new JsonStore(path.join(ud, 'conversations.json'), { list: [] });
  rag = createRagStore(path.join(ud, 'rag'));
  memory = createMemoryStore(path.join(ud, 'memory.json'));
  scheduler = createScheduler({ file: path.join(ud, 'schedules.json'), onFire: onScheduleFire, log: (m) => { console.log(m); log(m); } });
  computerTools = createComputerTools({ sandbox: () => benchSandbox, getSettings: () => settings.data, listWindows: () => require('./agent/uitree').windows(), openPath: (p) => shell.openPath(p), openExternal: (u) => shell.openExternal(u), log, logScan: (d) => LOG.block('apps', 'Quét ứng dụng đã cài (AIVN AGENT)', [`nguồn: ${JSON.stringify(d.sources)}`, `lỗi: ${d.errors.length ? d.errors.join('; ') : 'không'}`, `thư mục Desktop: ${d.dirs ? d.dirs.desktop.join(' | ') : '—'}`, `thư mục Start Menu: ${d.dirs ? d.dirs.start.join(' | ') : '—'}`, `thời gian tìm sâu: ${d.ms ?? '?'} ms`]),
    keyTap: (k) => { try { SC.libnut().keyTap(k); } catch (e) { throw new Error(e.message); } }, visionReady: () => !!engine.status().vision, screen: { look: (a, ctx) => deskWrap(getDesk().look, a, ctx), act: (a, ctx) => deskWrap(getDesk().act, a, ctx), readText: (a, ctx) => deskWrap(getDesk().readText, a, ctx), pending: () => (desk && desk.active() ? desk.pending() : null), searchTodo: () => (desk && desk.active() ? desk.searchTodo() : null), searchFound: () => (desk && desk.active() ? desk.searchFound() : null), likely: (q) => (desk && desk.active() ? desk.likely(q) : null) } });
  mcp = require('./mcp').createMcpManager({ dir: app.getPath('userData'), log: (sc, m) => LOG.log(sc, m), onChange: () => send('mcp:changed', mcp.status()) });
  agent = createAgent({ engine: agentEngine, mcp, getSettings: () => settings.data, gateOk: () => lastGateOk, allowAlways: (name) => { const l = new Set(settings.data.agentAlwaysAllow || []); l.add(name); settings.data.agentAlwaysAllow = [...l]; settings.save(); LOG.log('agent', `Người dùng chọn "Luôn cho phép": ${name}`); }, memory, scheduler, extractFile: extractAny, embedForMemory, log, computer: computerTools,
    logTool: (x) => LOG.log('tool', `${x.auto ? '(tự động) ' : ''}${x.name} → ${x.status} sau ${x.ms ?? '?'} ms`, { args: Object.fromEntries(Object.entries(x.args || {}).map(([k, v]) => [k, typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v])), ketQua: String(x.summary || '').slice(0, 300) }),
    trash: async (p) => { try { await shell.trashItem(p); } catch (e) { throw new Error('Không chuyển được tệp vào Thùng rác (' + e.message + '). Tệp vẫn còn nguyên.'); } } });
  lic = createLicenseState({ file: path.join(ud, 'license.json'), isPackaged: app.isPackaged, log: (m) => { log(m); if (isTest) console.log(m); }, fetchJson });
  appLock = createAppLock(path.join(ud, 'applock.json'));
  admin = createAdmin({ dir: ud, fetchJson, fetchRaw: (u, o) => net.fetch(u, { cache: 'no-store', ...o }), log,
    publicX: !app.isPackaged && process.env.AIVN_TEST_PUBKEY ? process.env.AIVN_TEST_PUBKEY : LIC.PUBLIC_KEY_X });
  media = MEDIA.createMedia({ app, protocol, BrowserWindow, ipcMain, modelsDir: () => paths.models, isTest, log: (k, m, d) => LOG.log(k, m, d), threads: () => Math.max(2, Math.min(8, require('os').cpus().length - 2)) });
  downloader = createDownloader({ dir: () => paths.models, checkSpace: (d, need) => require('./models-dir').checkSpace(d, need), send: (ch, d) => { send(ch, d); if (ch === 'dl:done' && d && d.catalogId && d.catalogId === settings.data.pendingEyes) setTimeout(() => { const c = catalog.find(x => x.id === d.catalogId); const m = c && listModels().find(x => x.file.toLowerCase() === c.file.toLowerCase() && x.mmproj); if (m) { settings.data.agentGrounder = m.id; settings.data.pendingEyes = null; settings.save(); LOG.log('desk', 'Đã tải xong mắt nhìn ' + m.file + ' — dùng làm mô hình định vị'); send('settings:changed', { agentGrounder: m.id }); send('app:notice', { text: `Đã có mắt nhìn: ${c.name}. AIVN AGENT sẽ tự dùng mô hình này để nhìn màn hình.`, kind: 'ok' }); } }, 300); }, getToken: () => settings.data.hfToken || null, maxConcurrent: 2, log: (m) => isTest && console.log(m) });
}
// ---------- Cổng vào: kích hoạt (bắt buộc) + Khoá ứng dụng (tuỳ chọn) ----------
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
  // 0.15.1: tự kiểm tra bộ máy AI khi mở ứng dụng — nếu tiến trình không khởi động được thì báo ngay dòng lỗi thật (không đợi lúc nạp mô hình)
  if (engine.external && engine.start) { const t0 = Date.now(); engine.start().then(() => LOG.log('app', `Tự kiểm tra bộ máy AI: OK (${Date.now() - t0} ms)`)).catch((e) => {
    LOG.log('app', 'Tự kiểm tra bộ máy AI: LỖI ' + e.message, { stderr: e.detail || '' });
    setTimeout(() => send('app:notice', { text: `${e.message}. AIVN chưa nạp được mô hình nào. Bấm “Mở nhật ký” trong Cài đặt → Nâng cao và gửi cho nhà phát triển.`, kind: 'warn' }), 2500);
  }); }
  hw().then(h => LOG.log('app', 'Phần cứng', { gpu: h.gpu || 'không', thietBi: h.devices, vramGB: h.vram ? +(h.vram.total / 1024 ** 3).toFixed(2) : 0, vramTrongGB: h.vram ? +(h.vram.free / 1024 ** 3).toFixed(2) : 0, ramGB: +(h.ram / 1024 ** 3).toFixed(1), chiCPU: !!h.cpuOnly })).catch(e => LOG.log('app', 'Không đọc được phần cứng: ' + e.message));
  applyBackgroundPrefs();
  scheduler.start();
  if (settings.data.apiAutoStart || process.env.AIVN_API === '1') startApi(settings.data.apiPort).catch(e => log('Lỗi: ' + e.message));
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
const publicSettings = () => { const { hfToken, cloudBrain: _cb, apiKey, ...rest } = settings.data; return { ...rest, hfTokenSet: !!hfToken, apiKeySet: !!apiKey, cloudBrain: cloudPublic() }; };

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
function scanDir(dir, depth, out, root = paths.models) {
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
      const rel = path.relative(root, dir);
      out.push({ id: modelIdFromFile(e.name), file: e.name, path: full, size, mtime: fs.statSync(full).mtimeMs, source: 'downloaded', parts, incomplete: missing > 0, mmproj, vision: !!mmproj, repo: rel && rel.split(path.sep).length === 2 ? rel.split(path.sep).join('/') : null });
    } catch {}
  }
  if (depth > 0) for (const e of ents) if (e.isDirectory()) scanDir(path.join(dir, e.name), depth - 1, out, root);
}

function listModels() {
  const out = [];
  scanDir(paths.models, 3, out);
  // “chỉ trỏ sang thư mục mới”: thư mục mô hình cũ vẫn được quét (mô hình cũ vẫn hiện, vẫn nạp được)
  for (const d of settings.data.modelDirsExtra || []) if (d && path.resolve(d) !== path.resolve(paths.models) && fs.existsSync(d)) scanDir(d, 3, out, d);
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
const cleanChatParams = (p) => require('./chatfit').cleanChatParams(p);
function fitOverflow(messages, policy, maxTokens) { return require('./chatfit').fitOverflow(messages, policy, maxTokens, engine.status().contextSize || 0, (t) => engine.countTokens(t)); }
// 0.16: tham số nạp theo từng mô hình (hộp nạp kiểu LM Studio). Lưu ở settings.modelLoad[id].
const LOAD_KEYS = ['contextSize', 'gpuLayers', 'flashAttention', 'kvCache', 'threads', 'batchSize', 'mmap', 'mlock'];
function cleanLoad(o) {
  const r = {}; if (!o || typeof o !== 'object') return r;
  const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined; };
  if (o.contextSize != null) r.contextSize = int(o.contextSize, MIN_CTX_CHAT, 1 << 20);
  if (o.gpuLayers === 'auto' || o.gpuLayers == null) {} else r.gpuLayers = int(o.gpuLayers, 0, 1000);
  if (o.flashAttention === true || o.flashAttention === false) r.flashAttention = o.flashAttention;
  if (['f16', 'q8_0'].includes(o.kvCache)) r.kvCache = o.kvCache;
  if (o.threads != null && o.threads !== 0) r.threads = int(o.threads, 1, 256);
  if (o.batchSize != null) r.batchSize = int(o.batchSize, 32, 8192);
  if (typeof o.mmap === 'boolean') r.mmap = o.mmap; if (typeof o.mlock === 'boolean') r.mlock = o.mlock;
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
}
const modelLoadFor = (id) => cleanLoad(((settings.data.modelLoad || {})[id]) || {});
let idleVramUsed = null;
// sau khi nạp TRỌN lên GPU: VRAM tăng thêm = số đo thật cho mô hình này ở ngữ cảnh đã nạp (Khám phá / Mô hình của tôi dùng số này thay cho ước tính)
async function measureVram(id, st) {
  if (idleVramUsed == null || !st || st.mode === 'cpu-only' || !(Number.isInteger(st.gpuLayers) && st.gpuLayers > 0 && st.gpuLayers >= (st.totalLayers || 0))) return;
  await sleep(1500); const h = await engine.hardwareInfo(); if (!h || !h.vram || !(h.vram.total > 0)) return;
  const used = h.vram.total - h.vram.free - idleVramUsed; if (!(used > 200 * 1024 ** 2)) return;
  const u = settings.data.modelUsage || (settings.data.modelUsage = {}); const e = u[id] || (u[id] = { uses: 0 });
  e.vram = { bytes: Math.round(used), ctx: st.contextSize || null, at: Date.now() }; settings.save();
  LOG.log('load', `Đo VRAM thật: ${id} dùng ${(used / 1024 ** 3).toFixed(2)} GB ở ngữ cảnh ${st.contextSize}`);
}
async function loadById(id, { force = false, ctx = null, reason = null, minCtx = null, load = null } = {}) {
  const m = listModels().find(x => x.id === id);
  if (!m) throw new Error(`Không tìm thấy mô hình "${id}"`);
  const ml = { ...modelLoadFor(id), ...cleanLoad(load) };
  if (!ctx && ml.contextSize) ctx = ml.contextSize;
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
        const e = new Error(`Mô hình cần khoảng ${(need / 1024 ** 3).toFixed(1)} GB nhưng máy chỉ còn khoảng ${((freeRam + vr) / 1024 ** 3).toFixed(1)} GB trống (RAM${vr ? ' + VRAM' : ''}). Nạp vẫn có thể được nhưng máy sẽ rất chậm hoặc treo. Nên đóng bớt ứng dụng hoặc chọn bản nhỏ hơn (Q4_K_M, Q3_K_M hoặc mô hình ít tham số hơn) trong Khám phá.`);
        e.code = 'LOW_MEM'; e.modelId = m.id; e.catalogId = m.catalog ? m.catalog.id : null; throw e;
      }
    }
    if (pendingEngineRestart && engine.restart) { const env = pendingEngineRestart; pendingEngineRestart = null; await engine.restart(env, 'áp dụng cài đặt GPU đã đổi'); hwCache = null; }
    const gl = ml.gpuLayers != null ? ml.gpuLayers : settings.data.gpuLayers;
    let pf = await perfProfile();
    pf = { ...pf, ...(ml.flashAttention != null ? { flashAttention: ml.flashAttention } : {}), ...(ml.kvCache ? { kvQuant: ml.kvCache === 'q8_0' } : {}),
      ...(ml.threads ? { threads: ml.threads } : {}), ...(ml.batchSize ? { batchSize: ml.batchSize } : {}) };
    let ctxWant = ctx || settings.data.contextSize || pf.ctx, ctxNote = null;
    ctxWant = Math.max(MIN_CTX_CHAT, Number(ctxWant) || MIN_CTX_AGENT); // 0.15.2: không bao giờ nạp dưới 4096
    if (!ctx && ctxWant > 8192) { // GPU rời ≤ 6 GB: ngữ cảnh 16k làm bộ đệm KV tràn VRAM/RAM → giới hạn 8192
      const h = await hw(); const vt = h.gpu && h.gpu !== 'metal' && h.vram && !h.vram.integratedOnly ? h.vram.total : 0;
      if (vt > 0 && vt < 6 * 1024 ** 3) { ctxNote = `Đã giới hạn độ dài ngữ cảnh ở 8192 (bạn chọn ${ctxWant}) vì GPU chỉ có ${(vt / 1024 ** 3).toFixed(1)} GB VRAM.`; ctxWant = 8192; }
    }
    const opts = { contextSize: ctxWant, minContextSize: Math.min(ctxWant, Math.max(minCtx || 0, ctxWant >= MIN_CTX_AGENT ? MIN_CTX_AGENT : MIN_CTX_CHAT)), perf: pf, fileSize: m.size, ...(Number.isInteger(gl) && gl >= 0 ? { gpuLayers: gl } : {}), ...(m.mmproj && settings.data.vision !== false ? { mmproj: m.mmproj } : {}), ...(ml.mmap === false ? { useMmap: false } : {}), ...(ml.mlock ? { useMlock: true } : {}), ...(load ? { reload: true } : {}) };
    LOG.log('load', `Bắt đầu nạp ${m.file}`, { size: m.size, ctx: opts.contextSize, gpuLayers: opts.gpuLayers ?? 'tự động', vision: !!opts.mmproj });
    const tLoad = Date.now();
    // B38: số đo VRAM thật — VRAM đã dùng lúc chưa nạp mô hình (màn hình, ứng dụng khác) làm mốc
    try { if (!engine.status().loaded) { const h0 = await engine.hardwareInfo(); if (h0 && h0.vram && h0.vram.total > 0 && !h0.vram.integratedOnly) idleVramUsed = h0.vram.total - h0.vram.free; } } catch {}
    try {
      try { st = await engine.loadModel(m.id, m.path, opts); }
      catch (e) {
        // GPU (Vulkan/CUDA/Metal) không nạp được: ghi nhật ký, khởi động lại bộ máy ở chế độ chỉ CPU rồi thử lại một lần
        if (e.code === 'ENGINE_EXIT' && !e.startup && !e.killReason && engine.restart) {
          // 0.15.1: bộ máy sập khi đang nạp → thử lại MỘT lần với cấu hình an toàn (chỉ CPU, ngữ cảnh 4096)
          const safeCtx = Math.max(MIN_CTX_CHAT, Math.min(MIN_CTX_AGENT, opts.contextSize || MIN_CTX_AGENT));
          engineLog('Bộ máy AI sập khi nạp ' + m.file + ', thử lại với cấu hình an toàn (CPU, ngữ cảnh ' + safeCtx + ')', e, { path: m.path, size: m.size, stderr: e.detail });
          await engine.restart({ ...engineEnv(), AIVN_GPU: 'off' }, 'bộ máy sập khi nạp, thử lại chỉ CPU'); hwCache = null;
          st = await engine.loadModel(m.id, m.path, { ...opts, contextSize: safeCtx, minContextSize: Math.min(opts.minContextSize, safeCtx), gpuLayers: 0 });
          st = { ...st, mode: 'cpu-only', fallbackFrom: ['bộ máy sập: ' + e.message] };
          ctxNote = 'Đã nạp ở chế độ an toàn (chỉ CPU, ngữ cảnh ' + safeCtx + ') vì bộ máy AI bị sập khi nạp bình thường. Xem nhật ký để biết chi tiết.';
        } else {
        if (!(e.code === 'LOAD_FAILED' && e.gpu && engine.restart)) throw e;
        engineLog('GPU không nạp được ' + m.file + ', thử lại bằng bộ máy chỉ CPU', e, { path: m.path, size: m.size });
        await engine.restart({ ...engineEnv(), AIVN_GPU: 'off' }, 'GPU không nạp được mô hình, chuyển sang chỉ CPU'); hwCache = null;
        st = await engine.loadModel(m.id, m.path, opts);
        st = { ...st, mode: 'cpu-only', fallbackFrom: [...(e.attempts || []).map(a => a.mode + ': ' + a.message), ...(st.fallbackFrom || [])] };
        settings.data.gpu = false; settings.save(); // lần sau mở AIVN dùng CPU luôn (bật lại trong Cài đặt trò chuyện)
      }
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
    if (st.fallbackFrom && st.fallbackFrom.length) { engineLog('Nạp ' + m.file + ' bằng chế độ dự phòng: ' + st.mode, null, { attempts: st.fallbackFrom, final: { mode: st.mode, ctx: st.contextSize, gpuLayers: st.gpuLayers, totalLayers: st.totalLayers } }); st.notice = require('./load-notice').loadNotice(st); }
    st = { ...st, loadParams: ml }; lastCtx = st.contextSize || lastCtx; engineDied = false;
    if (ctxNote) { st = { ...st, notice: [st.notice, ctxNote].filter(Boolean).join(' ') }; LOG.log('load', ctxNote); }
    if (reason) LOG.log('load', 'Lý do nạp lại: ' + reason);
    measureVram(m.id, st).catch(() => {});
    LOG.log('load', `Đã nạp ${m.file} sau ${Date.now() - tLoad} ms`, { mode: st.mode, ctx: st.contextSize, gpu: st.gpu, gpuLayers: st.gpuLayers, totalLayers: st.totalLayers, toolMode: st.toolMode, fallbackFrom: st.fallbackFrom });
    noteUsage(null, m.id);
    settings.data.lastModel = m.id; settings.save(); lastUse = Date.now();
    send('model:status', st);
    return st;
  } catch (e) { send('model:status', engine.status()); throw e; }
}

async function ensureModel(requested, { api = false } = {}) {
  const st = engine.status();
  if (requested) {
    const req = String(requested).toLowerCase().replace(/\.gguf$/, '');
    if (st.loaded && (st.id === req || st.id.includes(req))) return;
    const m = listModels().find(x => x.id === req) || listModels().find(x => x.id.includes(req));
    if (m) { await loadById(m.id); if (api) { apiJit = { id: m.id, at: Date.now() }; log(`Nạp theo yêu cầu API (JIT): ${m.id}${settings.data.apiTtlMin > 0 ? ` · tự gỡ sau ${settings.data.apiTtlMin} phút không dùng` : ''}`); } return; }
    if (st.loaded) return; // dùng mô hình đang nạp nếu tên không khớp
    throw new Error(`Mô hình "${requested}" chưa có trên máy`);
  }
  if (!st.loaded) throw new Error('Chưa nạp mô hình nào. Hãy nạp mô hình trong AIVN hoặc chỉ định "model".');
}
// 0.16 Máy chủ API (như LM Studio): LAN (0.0.0.0, bắt buộc có khoá API), CORS (tắt mặc định), khoá API, TTL tự gỡ mô hình nạp theo yêu cầu API
let apiJit = null;
function apiHost() { return settings.data.apiLan ? '0.0.0.0' : '127.0.0.1'; }
async function startApi(port) {
  if (settings.data.apiLan && !settings.data.apiKey) throw new Error('Mở cho mạng nội bộ cần có khoá API (tạo khoá ở mục Máy chủ API) để thiết bị lạ không dùng được mô hình của bạn.');
  return api.start(port, apiHost());
}
function lanUrls(port) {
  const out = []; const ifs = require('os').networkInterfaces();
  for (const list of Object.values(ifs)) for (const a of list || []) if (a && a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}/v1`);
  return out;
}
setInterval(() => { // TTL: chỉ gỡ mô hình do API tự nạp (JIT), khi rảnh đủ lâu và không có lượt nào đang chạy
  try {
    const ttl = Number(settings && settings.data.apiTtlMin) || 0; if (!apiJit || ttl <= 0) return;
    const st = engine.status(); if (!st.loaded || st.id !== apiJit.id) { apiJit = null; return; }
    if (busy > 0 || Date.now() - lastUse < ttl * 60000) return;
    log(`TTL: gỡ ${apiJit.id} sau ${ttl} phút không dùng (nạp theo yêu cầu API)`); apiJit = null;
    engine.unloadModel().then(() => send('model:status', engine.status())).catch(() => {});
  } catch {}
}, 30000).unref();


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
// ---------- Mắt nhìn cho điều khiển màn hình ----------
// Mô hình chỉ đọc chữ KHÔNG nhìn được màn hình. Khi bật Điều khiển màn hình mà mô hình chính không nhìn được ảnh:
// dùng mô hình định vị đã chọn, không có thì tự dùng mô hình nhìn ảnh đã cài phù hợp nhất (eyesFor), không có thì cảnh báo + nút "Nạp thêm mắt nhìn".
const vramTotal = () => (hwCache && hwCache.gpu && hwCache.gpu !== 'metal' && hwCache.vram && !hwCache.vram.integratedOnly ? hwCache.vram.total || 0 : 0);
function catalogLite() { return catalog.map(c => ({ ...c, installed: isInstalled(c.file) })); }
function eyesModel() { // mô hình nhìn ảnh đã cài sẽ làm mắt nhìn (id trong listModels) hoặc null
  const ms = listModels().filter(m => m.mmproj);
  if (settings.data.agentGrounder) { const m = ms.find(x => x.id === settings.data.agentGrounder); if (m) return { model: m, auto: false }; }
  if (!ms.length) return null;
  const R = require('./recommend'); const order = [R.eyesFor(catalogLite(), vramTotal())].concat(R.PAIR_GROUNDER.map(x => catalog.find(c => c.id === x.id)), R.VISION_SOLO.map(x => catalog.find(c => c.id === x.id))).filter(Boolean);
  for (const c of order) { const m = ms.find(x => x.file.toLowerCase() === c.file.toLowerCase()); if (m) return { model: m, auto: true }; }
  return { model: ms[0], auto: true };
}
function eyesAdvice() {
  const st = engine.status(); if (!st.loaded || !settings.data.agentScreen) return null;
  if (st.vision) return { needed: false, mode: 'main' };
  const cur = eyesModel(); if (cur) return { needed: false, mode: 'grounder', name: cur.model.catalog ? cur.model.catalog.name : cur.model.file, auto: cur.auto };
  const rec = require('./recommend').eyesFor(catalogLite(), vramTotal());
  return { needed: true, rec: rec ? { id: rec.id, name: rec.name, installed: !!rec.installed, size: rec.size + (rec.mmproj ? rec.mmproj.size : 0) } : null, pending: settings.data.pendingEyes || null };
}
// Mô hình nhỏ (< ~3,5 tỉ tham số) thường gọi công cụ sai: hiện cảnh báo trong AIVN AGENT
function agentAdvice() {
  const st = engine.status(); if (!st.loaded) return null;
  const m = listModels().find(x => x.path === st.path) || null;
  const p = m && m.catalog && m.catalog.params ? parseFloat(String(m.catalog.params).replace(',', '.')) : null;
  const small = p != null ? p < 3.5 : m ? m.size < 2.2e9 : false;
  const recommended = catalog.filter(c => require('./recommend').PLANNERS.includes(c.id)).map(c => ({ id: c.id, name: c.name, size: c.size + (c.mmproj ? c.mmproj.size : 0), installed: isInstalled(c.file) }));
  const tools = toolSupport({ claims: m && m.catalog ? m.catalog.claims : null, mmproj: m ? m.mmproj || (m.catalog && m.catalog.mmproj) || null : null, toolLevel: m && m.catalog ? m.catalog.toolLevel : null, id: m && m.catalog ? m.catalog.id : '', name: m && m.catalog ? m.catalog.name : (m && m.name) || '', file: m ? m.file : st.id, params: m && m.catalog ? m.catalog.params : null, meta: st.meta, toolMode: st.toolMode, wrapper: st.chatWrapper, size: m ? m.size : 0 });
  return { model: m ? (m.catalog ? m.catalog.name : m.file) : st.id, params: p, small, good: !!(m && m.catalog && m.catalog.agent), planner: !!(m && m.catalog && require('./recommend').PLANNERS.includes(m.catalog.id)), recommended, tools, toolMode: st.toolMode || null, vision: !!st.vision, eyes: eyesAdvice() };
}
function agentInfo() {
  const py = sandbox.findPython();
  return { folders: (settings.data.agentFolders || []).map(f => ({ path: f, name: path.basename(f), exists: (() => { try { return fs.statSync(f).isDirectory(); } catch { return false; } })() })),
    web: !!settings.data.agentWeb, python: { enabled: !!settings.data.agentPython, available: !!py, version: py ? py.version : null }, memory: { enabled: settings.data.agentMemory !== false, count: memory.count(), semantic: ragActive() },
    tools: agent.activeTools().map(n => ({ name: n, label: agent.defs[n].label, icon: agent.defs[n].icon })), computer: computerInfo(), toolsOff: settings.data.agentToolsOff || [], alwaysAllow: (settings.data.agentAlwaysAllow || []).map(n => ({ name: n, label: (agent.defs[n] && agent.defs[n].label) || n })), welcome: (() => { const st = engine.status(); return welcomeFor({ lang: uiLang(), loaded: !!st.loaded || cloudBrainOn(), vision: !!st.vision, agentOk: lastGateOk !== false, cloud: cloudBrainOn() ? { model: cloudCfg().model, host: (() => { try { return new URL(cloudCfg().baseUrl).host; } catch { return ''; } })() } : null }); })(), advice: agentAdvice(), keepInTray: !!settings.data.keepInTray, openAtLogin: !!settings.data.openAtLogin };
}
// Xác nhận xoá/ghi đè: hộp thoại tiếng Việt trong cửa sổ AIVN; không trả lời trong 5 phút = từ chối
const confirms = new Map();
let confirmSeq = 0;
function askConfirm(req) {
  if (!win || win.isDestroyed()) return Promise.resolve(false);
  if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus();
  const id = 'c' + (++confirmSeq);
  return new Promise((resolve) => {
    const t = setTimeout(() => { confirms.delete(id); send('agent:confirm-cancel', { id }); resolve(null); }, 5 * 60e3); // null = hết thời gian (khác với false = từ chối)
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
    const t = setTimeout(() => { confirms.delete(id); send('agent:approve-cancel', { id }); resolve({ ok: false, reason: '', timeout: true }); }, 10 * 60e3);
    confirms.set(id, (r) => { clearTimeout(t); confirms.delete(id); resolve(r && typeof r === 'object' ? { ok: r.ok === true, reason: String(r.reason || '').slice(0, 500), always: r.always === true } : { ok: r === true }); });
    send('agent:approve', { id, ...card });
    LOG.log('agent', `Xin phép: ${card.title} (${card.tool})`);
    if (!app.isPackaged && process.env.AIVN_APPROVE_AUTO) setTimeout(async () => { if (process.env.AIVN_QACU && confirmSeq <= 3) { await sleep(500); try { fs.writeFileSync(path.join(process.env.AIVN_QACU, `approve-card-${confirmSeq}.png`), (await win.webContents.capturePage()).toPNG()); } catch {} } const f = confirms.get(id); if (f) f(process.env.AIVN_APPROVE_AUTO === 'allow' ? { ok: true } : { ok: false, reason: process.env.AIVN_APPROVE_AUTO.replace(/^deny:?/, '') }); }, 200);
  });
}
const slimStep = (x) => ({ id: x.id, name: x.name, label: x.label, icon: x.icon, args: x.args, status: x.status, summary: x.summary, detail: typeof x.detail === 'string' ? x.detail.slice(0, 4000) : x.detail, urls: x.urls, ms: x.ms, pre: x.pre, thumb: x.thumb && typeof x.thumb.src === 'string' && x.thumb.src.length < 120000 ? x.thumb : undefined });
async function runAgentTurn({ reqId, convoId, messages, headless = false, signal, attachments = [], gate = true, qa = null }) {
  if (!engine.status().loaded && !cloudBrainOn()) {
    if (headless && settings.data.lastModel) await loadById(settings.data.lastModel);
    else throw new Error('Chưa nạp mô hình nào. Hãy chọn mô hình ở thanh phía trên (trong chế độ AIVN AGENT, bộ chọn chỉ cho chọn mô hình dùng được cho AIVN AGENT).');
  }
  // B18 (QA lượt 2): MỌI lượt AIVN AGENT (bấm Gửi, việc theo Lịch tự động…) qua cùng một cổng mô hình; chỉ bài đo Điểm tác vụ được bỏ qua (gate: false)
  if (gate) {
    const g = await agentModelGate(); agentStepScale = g.stepScale || 1;
    if (!g.ok) {
      const e = new Error(`${g.modelName || 'Mô hình đang nạp'} chưa dùng được cho AIVN AGENT: ${g.reason}.${g.best ? ` Hãy chuyển sang ${g.best.name} (đã có trên máy).` : (g.recommended || []).length ? ` Gợi ý cho máy này: ${g.recommended[0].name}.` : ''}`);
      e.code = 'AGENT_GATE'; e.gate = g; throw e;
    }
  }
  const comp = !headless && agent.activeTools({ headless }).some(n => n === 'screen_act' || n === 'screen_look'); // phím dừng khẩn cấp toàn cục chỉ khi điều khiển màn hình (Ctrl+Alt+Q trùng AltGr+Q trên một số bàn phím)
  if (comp) computerSessionStart();
  const files = (Array.isArray(attachments) ? attachments : []).filter(f => f && typeof f.path === 'string' && path.isAbsolute(f.path) && fs.existsSync(f.path) && fs.statSync(f.path).isFile()).slice(0, 10);
  const tb = tokenBatcher(reqId);
  try { return await agent.run({ messages, convoId, signal, headless, attachments: files, confirm: qa ? qa.confirm : (...a) => { tb.flush(); return askConfirm(...a); }, confirmScreen: qa ? qa.confirmScreen : (...a) => { tb.flush(); return askScreen(...a); }, approve: qa ? qa.approve : (card) => { tb.flush(); return askApproval(card); }, // QA runner: thẻ xin phép luôn bị TỪ CHỐI tự động (qa-runner.js)
    onToken: (t) => reqId && tb.push(t),
    onStep: (st) => { tb.flush(); if (qa && qa.onStep) qa.onStep(st); reqId && send('agent:step', { reqId, step: slimStep(st) }); },
    onStatus: (st) => { tb.flush(); reqId && send('agent:status', { reqId, ...st }); } }); }
  finally { tb.flush(); if (comp) computerSessionEnd(); if (desk && desk.active()) desk.end(signal && signal.aborted ? 'đã dừng' : 'xong lượt'); }
}
// ---------- Điều khiển máy tính kiểu desktop agent (quan sát → thao tác → kiểm tra) ----------
let desk = null;
let mcp = null;
const qaAsks = []; // chỉ khi phát triển (AIVN_DESK_AUTO): ghi lại các thẻ xin phép để kiểm thử
let agentStepScale = 1; // ×3 khi mô hình đang nạp là “Rất chậm” (bật tay) — xem agent-eligibility.js
function getDesk() {
  if (desk) return desk;
  const { createDesktopAgent } = require('./desktop-agent');
  desk = createDesktopAgent({ engine, stepScale: () => agentStepScale, getSettings: () => settings.data, setSettings: (p) => { Object.assign(settings.data, p); settings.save(); send('settings:changed', p); },
    log: (scope, m) => LOG.log(scope, m), getMainWindow: () => win, preload: path.join(__dirname, 'preload.js'), isTest: isTest && process.env.AIVN_DESK_KEEPWIN === '1', autoTest: !app.isPackaged && !!process.env.AIVN_DESK_AUTO,
    autoAnswer: !app.isPackaged && process.env.AIVN_DESK_AUTO ? (req) => (qaAsks.push({ risk: req.risk || null, desc: req.desc || '', text: req.text || null }), { ok: process.env.AIVN_DESK_AUTO !== 'deny' && !(req.risk && process.env.AIVN_DESK_AUTO === 'safe'), reason: req.risk && process.env.AIVN_DESK_AUTO === 'safe' ? 'Đừng gửi, chỉ soạn sẵn' : '' }) : null,
    onStop: (reason) => stopComputer(reason), grounder: (process.env.AIVN_QA_DESK016 || process.env.AIVN_QA_B21 || process.env.AIVN_QA_ZALO_DPI) && !app.isPackaged ? async () => null : getGrounder }); // QA phím/gõ: không cần mắt nhìn (CPU chậm)
  return desk;
}
// Chế độ hai mô hình: mô hình định vị (nhìn ảnh) chạy song song với mô hình lập kế hoạch (mô hình chữ)
async function getGrounder(force) {
  if (!engine.groundLoad) return null;
  let m = null;
  if (force) m = listModels().find(x => x.id === force && x.mmproj);
  else { const cur = engine.status(); if (cur && cur.vision && !settings.data.agentGrounder) return null; const e = eyesModel(); m = e && e.model; if (m && e.auto) LOG.log('desk', `Mắt nhìn tự động: ${m.file} (mô hình chính không nhìn được ảnh)`); }
  if (!m) return null;
  const st = engine.groundStatus();
  if (!(st && st.loaded && st.id === m.id)) {
    LOG.log('load', `Nạp mô hình định vị ${m.file}`, { mmproj: path.basename(m.mmproj) }); const t = Date.now();
    let gpu = settings.data.gpu !== false;
    try { // GPU ít VRAM: không nạp hai mô hình lớn cùng lúc lên GPU
      const h = await hw(); const cur = engine.status(); const mm = cur && cur.loaded ? listModels().find(x => x.id === cur.id) : null;
      const plan = require('./recommend').pairPlan({ vram: h.vram ? h.vram.total : 0, main: mm ? mm.size || 0 : 0, grounder: m.size || 0, mainVision: !!(cur && cur.vision) });
      if (!plan.ok) { gpu = false; LOG.log('load', 'Cảnh báo bộ nhớ GPU: ' + plan.message); send('app:notice', { text: plan.message, kind: 'warn' }); }
    } catch {}
    const gml = modelLoadFor(m.id); const gpf = await perfProfile().catch(() => ({})); const gth = gml.threads || gpf.threads; const gbs = gml.batchSize || gpf.batchSize; // B26
    await engine.groundLoad(m.id, m.path, m.mmproj, { contextSize: 4096, gpu, ...(gth ? { threads: gth } : {}), ...(gbs ? { batchSize: gbs } : {}) });
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
  return { enabled: settings.data.agentComputer !== false, screen: !!settings.data.agentScreen, screenMode: settings.data.agentScreenMode || 'each', autonomy: settings.data.agentAutonomy === true, grounder: settings.data.agentGrounder || null, grounders: listModels().filter(m => m.mmproj).map(m => ({ id: m.id, name: m.catalog ? m.catalog.name : m.file })), screenBudget: settings.data.agentScreenBudget || 40, verySlow: settings.data.agentVerySlow === true, autoReadOnly: settings.data.agentAutoReadOnly === true, vision: !!engine.status().vision, platform: process.platform, perms: p, stopKey: process.platform === 'darwin' ? '⌘⌥Q' : 'Ctrl+Alt+Q' };
}


// ---------- Lịch tự động ----------
let lastNotice = null;
function notify(title, body, convoId) {
  if (gated()) { title = 'AIVN'; body = T('Có thông báo mới. Mở khoá AIVN để xem.'); convoId = null; } // không lộ nội dung khi đang khoá
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
function paintTray() {
  if (!tray) return;
  tray.setToolTip(T('AIVN · Lịch tự động vẫn chạy'));
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Mở AIVN', click: showWindow }, { type: 'separator' }, { label: 'Thoát AIVN', click: () => { quitting = true; app.quit(); } }]));
}
function applyBackgroundPrefs() {
  if (settings.data.keepInTray && !tray) {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icons', process.platform === 'darwin' ? '16x16.png' : '32x32.png'));
    tray = new Tray(img);
    paintTray();
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
// Âm thanh/video: bộ nghe tự nhận ngôn ngữ lời nói; chỉ khi không nhận được mới dùng ngôn ngữ giao diện
const avLang = () => ({ language: null, fallbackLanguage: ({ vi: 'vi', en: 'en', zh: 'zh' })[uiLang()] || 'vi' });
const pickFrames = (list, n) => list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.round(i * (list.length - 1) / (n - 1))]);
// Đọc tệp cho AIVN AGENT (read_file, tệp đính kèm): âm thanh/video đi qua bộ nghe, còn lại qua bộ đọc tài liệu
async function extractAny(file) {
  if (MEDIA.avKind(file)) { const r = await media.transcribe(file, { ...avLang(), frames: 6, ocr: (buf) => engine.ocr(buf) }); return { name: r.name, path: file, size: r.size, ext: path.extname(file).slice(1).toLowerCase(), kind: r.kind, pages: null, text: r.text, chars: r.chars }; }
  return docsPool.extractFile(file);
}
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

const api = createApiServer({ engine, models: listModels, ensureModel: (m) => ensureModel(m, { api: true }), log, getOpts: () => ({ cors: !!settings.data.apiCors, apiKey: settings.data.apiKey || null }), isBlocked: () => !activated() ? 'AIVN chưa được kích hoạt trên máy này.' : isLocked() ? 'AIVN đang khoá. Hãy mở khoá ứng dụng để dùng máy chủ API.' : null, embeddings: {
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
    return { ...c, installed: part.complete || isInstalled(c.file), partial: part.complete ? 0 : part.received, job, fit: hf.fitFor(c.size, h, fitMetaCat(c)), tools: toolSupport(c) };
  }))).then(list => {
    // B17: một cách tính duy nhất (agent-plan.js) cho ngữ cảnh AIVN AGENT, độ vừa máy của thẻ trong mục Điều khiển máy tính,
    // gợi ý ⭐ điều khiển máy và cổng AIVN AGENT
    const sc = benchScores(); const P = agentPlanFor(H, sc);
    list = list.map(c => ({ ...c, agentFit: catAgentFit(c, H, P.ctx) }));
    return require('./recommend').annotate(list, sc, vramTotal(), AP.elOpts(P)).list.map(c => ({ ...c, strength: require('./fit').strength(c), agentCtx: P.ctx,
      agentCheck: AE.eligibility({ vision: !!c.mmproj, catalog: c, fit: c.agentFit }, { shipped: sc.shipped[c.id], ...AP.elOpts(P) }) }));
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
    const r = await dialog.showOpenDialog(win, { buttonLabel: 'Mở', title: 'Chọn tệp khoá quản trị (aivn-admin-key.json)', properties: ['openFile'], filters: [{ name: 'Khoá quản trị AIVN', extensions: ['json'] }] });
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
    const d = await dialog.showSaveDialog(win, { buttonLabel: 'Lưu', title: 'Lưu revoked.json (chưa có token GitHub để tự đăng)', defaultPath: 'revoked.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
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
  ipcMain.handle('lock:now', () => lockNow('bấm Khoá ngay'));
  ipcMain.handle('license:info', () => lic.publicInfo());
  ipcMain.handle('license:check', async () => { const r = await licenseCheck(); return { ok: !!(r && r.ok), error: r && r.error, info: lic.publicInfo() }; });
  ipcMain.handle('app:info', async () => ({ version: app.getVersion(), paths, hardware: await hw(), llamaCpp: hf.llamaCpp }));
  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('cloud:get', () => cloudPublic());
  ipcMain.handle('cloud:save', (_e, p = {}) => {
    try {
      const c = { ...cloudCfg() };
      if ('baseUrl' in p) c.baseUrl = p.baseUrl ? CB.normalizeBase(p.baseUrl) : '';
      if ('model' in p) c.model = String(p.model || '').trim().slice(0, 200);
      if ('ctx' in p) c.ctx = [8192, 16384, 32768, 65536, 131072].includes(Number(p.ctx)) ? Number(p.ctx) : 32768;
      if ('enabled' in p) c.enabled = p.enabled === true;
      settings.data.cloudBrain = c; settings.save();
      let keyNote = null; if (typeof p.key === 'string' && p.key.trim()) keyNote = cloudKeys.save(p.key);
      if (c.enabled && !cloudBrainOn()) { c.enabled = false; settings.data.cloudBrain = c; settings.save(); return { ok: false, error: 'Cần đủ địa chỉ máy chủ, tên mô hình và khoá API trước khi bật.', cloud: cloudPublic() }; }
      LOG.log('agent', `Bộ não đám mây: ${c.enabled ? 'bật' : 'tắt'} · ${c.baseUrl ? new URL(c.baseUrl).host : '—'} · ${c.model || '—'}${keyNote ? (keyNote.persisted ? ' · đã lưu khoá (mã hoá bởi hệ điều hành)' : ' · khoá chỉ giữ trong phiên này') : ''}`);
      return { ok: true, keyPersisted: keyNote ? keyNote.persisted : undefined, cloud: cloudPublic() };
    } catch (e) { return { ok: false, error: e.message, cloud: cloudPublic() }; }
  });
  ipcMain.handle('cloud:clearKey', () => { cloudKeys.clear(); const c = { ...cloudCfg(), enabled: false }; settings.data.cloudBrain = c; settings.save(); LOG.log('agent', 'Bộ não đám mây: đã xoá khoá API'); return cloudPublic(); });
  ipcMain.handle('cloud:test', async () => { try { return await cloudBrain.test(); } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.on('ui:log', (_e, msg) => { if (typeof msg === 'string') log(msg.slice(0, 300)); });
  ipcMain.handle('settings:set', (_e, patch = {}) => {
    const { hfToken, hfTokenSet, cloudBrain: _cloudIgnored, apiKey: _k, apiLan: _l, apiCors: _c, apiTtlMin: _t, ...rest } = patch; // máy chủ API chỉ đổi qua server:config/server:key // bộ não đám mây chỉ đổi qua cloud:save (khoá không đi qua đây)
    Object.assign(settings.data, rest);
    const intOrNull = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
    if ('agentToolsOff' in rest) settings.data.agentToolsOff = [...new Set((Array.isArray(rest.agentToolsOff) ? rest.agentToolsOff : []).filter(g => Object.prototype.hasOwnProperty.call(TOOL_GROUPS, g)))];
    if ('gpuLayers' in rest) settings.data.gpuLayers = intOrNull(rest.gpuLayers, 1000);
    if ('gpuDevice' in rest) settings.data.gpuDevice = intOrNull(rest.gpuDevice, 15);
    if ('vramLimitGB' in rest) settings.data.vramLimitGB = Number(rest.vramLimitGB) > 0 ? Math.min(256, Number(rest.vramLimitGB)) : null;
    if ('agentGrounder' in rest) { settings.data.agentGrounder = typeof rest.agentGrounder === 'string' && rest.agentGrounder ? rest.agentGrounder : null; if (!settings.data.agentGrounder && engine.groundUnload) engine.groundUnload().catch(() => {}); }
    if ('agentScreenMode' in rest) settings.data.agentScreenMode = rest.agentScreenMode === 'important' ? 'important' : 'each';
    if ('agentAutonomy' in rest) settings.data.agentAutonomy = rest.agentAutonomy === true;
    if ('agentVerySlow' in rest) settings.data.agentVerySlow = rest.agentVerySlow === true;
    if ('agentScreenBudget' in rest) settings.data.agentScreenBudget = Math.max(5, Math.min(100, Math.round(Number(rest.agentScreenBudget) || 40)));
    if (typeof hfToken === 'string') settings.data.hfToken = hfToken.trim().slice(0, 300);
    if ('perfMode' in rest) { settings.data.perfMode = PERF.MODE_VI[rest.perfMode] ? rest.perfMode : 'auto'; perfProfile().then(p => send('perf:changed', p)).catch(() => {}); }
    if ('contextSize' in rest) settings.data.contextSize = [0, 2048, 4096, 8192, 16384, 32768].includes(Number(rest.contextSize)) ? Number(rest.contextSize) : 0;
    if ('uiLang' in rest) { settings.data.uiLang = I18N_CORE.LANGS.includes(rest.uiLang) ? rest.uiLang : 'vi'; try { buildMenus(); paintTray(); } catch {} }
    if (['light', 'dark', 'system'].includes(settings.data.theme)) require('electron').nativeTheme.themeSource = settings.data.theme;
    if ('theme' in rest && win && !win.isDestroyed()) win.setBackgroundColor(windowBg());
    if ('themeFx' in rest) settings.data.themeFx = ['full', 'os', 'off'].includes(rest.themeFx) ? rest.themeFx : 'full';
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
  // "Nạp thêm mắt nhìn": dùng mô hình nhìn ảnh đã cài, hoặc tải rồi tự đặt làm mô hình định vị
  ipcMain.handle('agent:eyes', async (_e, catalogId) => {
    await hw(); const R = require('./recommend');
    const c = catalog.find(x => x.id === catalogId) || R.eyesFor(catalogLite(), vramTotal()); if (!c || !c.mmproj) throw new Error('Không có mô hình nhìn ảnh phù hợp');
    const m = listModels().find(x => x.file.toLowerCase() === c.file.toLowerCase() && x.mmproj);
    if (m) { settings.data.agentGrounder = m.id; settings.data.pendingEyes = null; settings.save(); LOG.log('desk', 'Người dùng chọn mắt nhìn ' + m.file); return { ok: true, installed: true, name: c.name }; }
    settings.data.pendingEyes = c.id; settings.save();
    const files = [{ path: c.file, size: c.size }, { path: c.mmproj.file, size: c.mmproj.size }];
    const j = downloader.enqueue({ repo: c.repo, files, name: c.name, quant: c.quant, catalogId: c.id, urlFor: hf.resolveUrl });
    return { ok: true, installed: false, job: j, name: c.name };
  });
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
  // Thanh trạng thái (0.16): RAM và CPU của cả máy, đo nhẹ (không gọi bộ máy AI)
  let cpuPrev = null;
  ipcMain.handle('sys:stats', () => {
    const os_ = require('os'); const cs = os_.cpus(); let idle = 0, tot = 0;
    for (const c of cs) { const t = c.times; idle += t.idle; tot += t.user + t.nice + t.sys + t.idle + t.irq; }
    let cpu = null; if (cpuPrev && tot > cpuPrev.tot) cpu = Math.max(0, Math.min(100, 100 * (1 - (idle - cpuPrev.idle) / (tot - cpuPrev.tot)))); cpuPrev = { idle, tot };
    const st = engine.status ? engine.status() : {};
    return { ramTotal: os_.totalmem(), ramFree: os_.freemem(), cpu, cpus: cs.length, gpu: hwCache && hwCache.gpu || null, vram: hwCache && hwCache.vram || null, loaded: !!st.loaded };
  });
  // Đo tốc độ mô hình đang nạp (thời gian ra chữ đầu, token/giây) — lưu lịch sử để so sánh trước/sau khi đổi chế độ hiệu năng
  ipcMain.handle('perf:speed', async () => {
    const st = engine.status(); if (!st.loaded) return { ok: false, error: 'Chưa nạp mô hình.' };
    const pf = await perfProfile(); const t0 = Date.now(); let first = 0, n = 0;
    const prompt = 'Viết một đoạn khoảng 120 từ giới thiệu ngắn gọn về Vịnh Hạ Long cho khách du lịch: vị trí, cảnh đẹp nổi bật, thời điểm nên đến và một lời khuyên.';
    try {
      const r = await engine.generate([{ role: 'user', content: prompt }], { maxTokens: 128, temperature: 0, onToken: () => { if (!first) first = Date.now(); n++; } });
      const end = Date.now(); const toks = (r && r.usage && r.usage.completion_tokens) || n;
      const out = { ok: true, model: st.id, mode: pf.effective, modeLabel: pf.effectiveLabel, tier: pf.tierLabel, ttftMs: (first || end) - t0, tokens: toks, tokPerSec: +(toks / Math.max(0.05, (end - (first || t0)) / 1000)).toFixed(1), totalMs: end - t0, at: new Date().toISOString(), gpu: st.mode || '' };
      const hist = (settings.data.perfRuns || []).concat(out).slice(-12); settings.data.perfRuns = hist; settings.save();
      LOG.log('perf', `Đo tốc độ ${st.id}: ${out.tokPerSec} token/giây, chữ đầu sau ${out.ttftMs} ms (chế độ ${out.modeLabel})`);
      return out;
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('perf:runs', () => settings.data.perfRuns || []);
  ipcMain.handle('perf:info', async () => { const h = await hw(); return { profile: await perfProfile(), hw: { ram: h.ram, cpus: h.cpus, mathCores: h.mathCores, gpu: h.gpu, vram: h.vram, cpu: h.cpu } }; });

  ipcMain.handle('models:list', async () => withAgentCheck(listModels()));
  ipcMain.handle('models:import', async () => {
    const r = await dialog.showOpenDialog(win, { buttonLabel: 'Mở', title: 'Chọn tệp mô hình GGUF', filters: [{ name: 'Mô hình GGUF', extensions: ['gguf'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return listModels();
    for (const f of r.filePaths) if (!settings.data.imported.includes(f)) settings.data.imported.push(f);
    settings.save();
    return listModels();
  });
  ipcMain.handle('chat:defaults', () => { const st = engine.status(); const d = require('./agent/sampling').samplingFor(st.id || '', 'chat'); return { model: st.id || null, ...d }; });
  ipcMain.handle('presets:builtin', () => require('./presets').BUILTIN);
  ipcMain.handle('presets:export', async (_e, p) => {
    const PR = require('./presets'); const body = PR.toExport(p);
    const r = await dialog.showSaveDialog(win, { title: 'Xuất cấu hình mẫu', buttonLabel: 'Lưu', defaultPath: String(p.name || 'preset').replace(/[\\/:*?"<>|]+/g, '-') + '.aivn-preset.json', filters: [{ name: 'Cấu hình mẫu AIVN', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { ok: false }; fs.writeFileSync(r.filePath, body, 'utf8'); return { ok: true, path: r.filePath };
  });
  ipcMain.handle('presets:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Nhập cấu hình mẫu', buttonLabel: 'Mở', properties: ['openFile'], filters: [{ name: 'Cấu hình mẫu (AIVN hoặc preset LM Studio)', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try { const st = fs.statSync(r.filePaths[0]); if (st.size > 1e6) throw new Error('Tệp quá lớn'); return { ok: true, preset: require('./presets').parseImport(fs.readFileSync(r.filePaths[0], 'utf8')) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('models:meta', async (_e, id) => { const m = listModels().find(x => x.id === id); if (!m) return null; const g = require('./gguf').cachedSummary(m.path); return g ? { ...g, fileSize: m.size, file: m.file, id: m.id, vision: !!m.vision, saved: modelLoadFor(id), global: { contextSize: settings.data.contextSize || null, gpuLayers: Number.isInteger(settings.data.gpuLayers) ? settings.data.gpuLayers : null } } : null; });
  ipcMain.handle('models:estimate', async (_e, id, o = {}) => { const m = listModels().find(x => x.id === id); if (!m) return null; const g = require('./gguf').cachedSummary(m.path); if (!g || g.error) return null; let h = await hw().catch(() => ({})); if (process.env.AIVN_QA_FAKEHW && !app.isPackaged) h = { ...h, ...JSON.parse(process.env.AIVN_QA_FAKEHW) }; const gpu = !!(h.gpu); const est = require('./gguf').estimate({ ...g, fileSize: m.size }, { ...o, gpu, vram: gpu && h.gpu !== 'metal' ? h.vram : null }); return { ...est, hw: { gpu: h.gpu || false, vram: h.vram || null, ram: h.ram || 0, freeRam: h.freeRam || 0, devices: h.devices || [], unified: h.gpu === 'metal' } }; });
  ipcMain.handle('models:saveLoad', async (_e, id, o) => { settings.data.modelLoad = { ...(settings.data.modelLoad || {}) }; const c = cleanLoad(o); if (o === null || !Object.keys(c).length) delete settings.data.modelLoad[id]; else settings.data.modelLoad[id] = c; settings.save(); return modelLoadFor(id); });
  ipcMain.handle('models:load', async (_e, id, o = {}) => { try { if (o && o.remember && o.load) { settings.data.modelLoad = { ...(settings.data.modelLoad || {}), [id]: cleanLoad(o.load) }; settings.save(); } return { ok: true, status: await loadById(id, { force: !!(o && o.force), load: o && o.load || null }) }; } catch (e) { return { ok: false, error: e.message, code: e.code || null, modelId: e.modelId || id, catalogId: e.catalogId || null }; } });
  ipcMain.handle('models:unload', async () => { await engine.unloadModel(); const st = engine.status(); send('model:status', st); return st; });
  ipcMain.handle('models:delete', async (_e, id) => {
    if (QA_PROFILE) throw new Error('Hồ sơ QA chỉ đọc thư mục mô hình dùng chung: không xoá mô hình.');
    const m = listModels().find(x => x.id === id);
    if (!m) return listModels();
    const ok = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Huỷ', 'Xoá'], defaultId: 0, cancelId: 0, title: 'Xoá mô hình',
      message: m.source === 'imported' ? `Gỡ "${m.file}" khỏi danh sách? (Tệp gốc vẫn được giữ nguyên)` : `Xoá vĩnh viễn "${m.file}" khỏi máy?` });
    if (ok.response !== 1) return listModels();
    if (m.loaded) { await engine.unloadModel(); send('model:status', engine.status()); }
    if (m.source === 'imported') settings.data.imported = settings.data.imported.filter(p => p !== m.path), settings.save();
    else { const gone = require('./models-dir').deleteModelFiles(m, listModels(), paths.models); LOG.log('models', `Đã xoá mô hình ${m.file}`, { files: gone.map(f => path.basename(f)) }); }
    return listModels();
  });
  // ---------- Đổi thư mục mô hình (beta.3) ----------
  let dirMove = null; // { ac } khi đang chuyển
  const defaultModelsDir = () => path.join(paths.userData, 'models');
  const dirInfo = () => { const MD = require('./models-dir'); const files = MD.listFiles(paths.models); return { dir: paths.models, isDefault: path.resolve(paths.models) === path.resolve(defaultModelsDir()), default: defaultModelsDir(), free: MD.freeBytes(paths.models), drive: MD.driveOf(paths.models), bytes: files.reduce((s, f) => s + f.size, 0), files: files.length, extra: (settings.data.modelDirsExtra || []).filter(d => fs.existsSync(d)), problem: modelsDirProblem, moving: !!dirMove, qaProfile: !!QA_PROFILE }; };
  ipcMain.handle('models:dir-info', () => dirInfo());
  ipcMain.handle('models:dir-pick', async () => {
    if (QA_PROFILE) return { ok: false, error: 'Hồ sơ QA dùng chung thư mục mô hình của hồ sơ thật: không đổi được.' };
    const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục lưu mô hình', buttonLabel: 'Chọn thư mục này', properties: ['openDirectory', 'createDirectory'], defaultPath: paths.models });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const v = require('./models-dir').validateTarget(r.filePaths[0], { from: paths.models }); if (!v.ok) return v;
    const cur = dirInfo(); return { ok: true, dir: v.dir, free: v.free, drive: require('./models-dir').driveOf(v.dir), current: cur, fits: v.free == null || v.free >= cur.bytes + require('./models-dir').MARGIN };
  });
  ipcMain.handle('models:dir-apply', async (_e, { dir, mode } = {}) => {
    const MD = require('./models-dir');
    if (QA_PROFILE) return { ok: false, error: 'Hồ sơ QA: không đổi thư mục mô hình.' };
    if (dirMove) return { ok: false, error: 'Đang chuyển mô hình, hãy đợi xong.' };
    const v = MD.validateTarget(dir, { from: paths.models }); if (!v.ok) return v;
    if (downloader.list().some(j => j.status === 'downloading' || j.status === 'queued')) return { ok: false, error: 'Đang tải mô hình: hãy tạm dừng hoặc đợi tải xong rồi đổi thư mục.' };
    const old = paths.models;
    if (mode === 'move') {
      const st = engine.status(); if (st.loaded && st.path && path.resolve(st.path).startsWith(path.resolve(old) + path.sep)) { await engine.unloadModel(); send('model:status', engine.status()); }
      dirMove = { ac: new AbortController() }; LOG.log('app', `Chuyển mô hình: ${old} → ${v.dir}`);
      try { const r = await MD.moveModels(old, v.dir, { signal: dirMove.ac.signal, onProgress: (p) => send('models:dir-progress', p) });
        paths.models = v.dir; settings.data.modelsDir = v.dir; settings.data.modelDirsExtra = (settings.data.modelDirsExtra || []).filter(d => path.resolve(d) !== path.resolve(v.dir)); settings.save();
        LOG.log('app', `Đã chuyển ${r.moved} tệp (${(r.bytes / 1024 ** 3).toFixed(2)} GB)${r.sameDrive ? ' (cùng ổ, đổi tên)' : ''} → ${v.dir}`); send('models:dir-progress', { finished: true, ...r });
        return { ok: true, ...r, info: dirInfo() };
      } catch (e) { LOG.log('app', 'Chuyển mô hình dừng: ' + e.message); send('models:dir-progress', { finished: true, error: e.message }); return { ok: false, error: e.message, info: dirInfo() }; }
      finally { dirMove = null; }
    }
    // chỉ trỏ sang thư mục mới: thư mục cũ vẫn được quét
    const extra = new Set(settings.data.modelDirsExtra || []); if (MD.listFiles(old).length) extra.add(old); extra.delete(v.dir);
    paths.models = v.dir; settings.data.modelsDir = v.dir; settings.data.modelDirsExtra = [...extra]; settings.save(); modelsDirProblem = null;
    LOG.log('app', `Thư mục mô hình mới: ${v.dir} (mô hình ở ${old} vẫn dùng được)`); return { ok: true, moved: 0, info: dirInfo() };
  });
  ipcMain.handle('models:dir-cancel', () => { if (dirMove) dirMove.ac.abort(); return true; });
  ipcMain.handle('models:dir-reset', () => { if (QA_PROFILE || dirMove) return { ok: false }; settings.data.modelsDir = null; paths.models = defaultModelsDir(); fs.mkdirSync(paths.models, { recursive: true }); settings.save(); return { ok: true, info: dirInfo() }; });
  ipcMain.handle('models:reveal', (_e, p) => { shell.showItemInFolder(p || paths.models); return true; });
  ipcMain.handle('model:status', () => engine.status());
  ipcMain.handle('bench:run', async (_e, { ids }) => { try { return { ok: true, results: await runAgentBench(Array.isArray(ids) ? ids.slice(0, 4) : []) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('bench:stop', () => { if (benchRun) benchRun.abort(); stopComputer('dừng bài đo'); return true; });
  ipcMain.handle('bench:scores', () => benchScores());
  ipcMain.handle('bench:fullModels', () => fullBenchModels());
  ipcMain.handle('bench:full', async (_e, { ids } = {}) => { try { return { ok: true, ...(await runFullBench(Array.isArray(ids) ? ids : [])) }; } catch (e) { return { ok: false, error: e.message }; } });
  // ---- Kinh doanh → Khách hàng (CRM, lưu cục bộ SQLite) ----
  let crmP = null;
  const getCrm = () => crmP || (crmP = (async () => { const { openDb } = require('./crm/db'); const { createCrm } = require('./crm/crm'); const db = await openDb(path.join(app.getPath('userData'), 'crm.db')); const crm = createCrm({ db, defaultOwner: () => settings.data.crmOwner || require('os').userInfo().username, log: (m) => LOG.log('crm', m) }); crm.biz = require('./crm/biz').createBiz({ db, crm, log: (m) => LOG.log('crm', m) }); return crm; })());
  const CRM_OK = new Set(['saveContact', 'listContacts', 'getContact', 'deleteContact', 'facets', 'saveLead', 'moveLead', 'listLeads', 'deleteLead', 'saveActivity', 'completeActivity', 'deleteActivity', 'listActivities', 'addNote', 'listQuotes', 'dashboard', 'findDuplicates', 'find', 'saveProduct', 'listProducts', 'deleteProduct', 'saveQuote', 'getQuote', 'deleteQuote']);
  const BIZ_OK = new Set(require('./crm/biz').BIZ_CALLS); // 0.16 Bán hàng / Kho / Hoá đơn / Báo cáo
  ipcMain.handle('crm:call', async (_e, { fn, args }) => {
    if (!CRM_OK.has(fn) && !BIZ_OK.has(fn)) return { ok: false, error: 'Không hỗ trợ.' };
    try { const c = await getCrm(); const tgt = CRM_OK.has(fn) ? c : c.biz; return { ok: true, data: await tgt[fn](...(Array.isArray(args) ? args : [])) }; }
    catch (e) { if (!e.userMessage) LOG.log('crm', `Lỗi ${fn}: ${e.message}`); return { ok: false, error: e.userMessage || e.message, code: e.code || null }; }
  });
  ipcMain.handle('crm:export', async () => {
    try { const c = await getCrm(); const r = await dialog.showSaveDialog(win, { buttonLabel: 'Lưu', title: 'Xuất danh sách khách hàng', defaultPath: 'khach-hang.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] }); if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      const rows = c.exportContacts(); const S = require('./crm/sheet'); fs.writeFileSync(r.filePath, S.toCsv(Array.isArray(rows) ? rows : rows.rows)); return { ok: true, file: r.filePath }; } catch (e) { return { ok: false, error: e.message }; }
  });
  // 0.16 Báo cáo Kinh doanh: lưu bảng đang xem ra CSV (Excel mở được, UTF-8 có BOM)
  ipcMain.handle('crm:saveCsv', async (_e, { name, rows } = {}) => {
    try { if (!Array.isArray(rows) || !rows.length || rows.length > 100000) return { ok: false, error: 'Không có dữ liệu để xuất.' };
      const r = await dialog.showSaveDialog(win, { buttonLabel: 'Lưu', title: 'Xuất báo cáo', defaultPath: String(name || 'bao-cao').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + '.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] }); if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, require('./crm/sheet').toCsv(rows.map(x => (Array.isArray(x) ? x : []).slice(0, 200).map(v => v == null ? '' : typeof v === 'number' ? v : String(v).slice(0, 5000))))); return { ok: true, file: r.filePath }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('crm:import', async () => {
    try { const c = await getCrm(); const r = await dialog.showOpenDialog(win, { buttonLabel: 'Mở', title: 'Nhập khách hàng từ CSV/Excel', properties: ['openFile'], filters: [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx'] }] }); if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      const S = require('./crm/sheet'); const buf = fs.readFileSync(r.filePaths[0]); const rows = /\.xlsx$/i.test(r.filePaths[0]) ? S.parseXlsx(buf) : S.parseCsv(S.decodeBytes(buf));
      return { ok: true, result: c.importContacts(rows, { onDuplicate: 'merge' }) }; } catch (e) { return { ok: false, error: e.userMessage || e.message }; }
  });
  // ---- Kết nối (MCP) ----
  ipcMain.handle('mcp:status', () => ({ servers: mcp.status(), text: mcp.readText(), file: mcp.file, enabled: settings.data.agentMcp !== false }));
  ipcMain.handle('mcp:save', async (_e, text) => { try { await mcp.saveText(String(text)); LOG.log('mcp', 'Đã lưu mcp.json'); return { ok: true, servers: mcp.status() }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('mcp:toggle', async (_e, { name, on }) => { try { return { ok: true, server: await mcp.setEnabled(name, !!on) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('mcp:restart', async (_e, name) => { try { return { ok: true, server: await mcp.start(name) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('mcp:preset', async (_e, kind) => {
    let folder = null;
    if (kind === 'filesystem') { const r = await dialog.showOpenDialog(win, { buttonLabel: 'Chọn thư mục', title: 'Chọn thư mục cho máy chủ MCP filesystem', properties: ['openDirectory'] }); if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }; folder = r.filePaths[0]; }
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

  ipcMain.handle('chat:generate', async (_e, { reqId, messages, temperature, maxTokens, docs: attached, convoId, images, params = null }) => {
    const P = cleanChatParams(params);
    { const dir = I18N_CORE.replyDirective(uiLang()); // giao diện en/zh → mô hình trả lời bằng ngôn ngữ đó
      if (dir && Array.isArray(messages)) messages = messages[0] && messages[0].role === 'system' && typeof messages[0].content === 'string' ? [{ ...messages[0], content: `${messages[0].content}\n${dir}` }, ...messages.slice(1)] : [{ role: 'system', content: dir }, ...messages]; }
    if (P.jsonSchema) { const se = require('./chatfit').schemaError(P.jsonSchema); if (se) throw new Error('Lược đồ JSON chưa hợp lệ — ' + se + '. Sửa ở thẻ “Đầu ra” bên phải.'); }
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
      // chống lặp (0.15): tham số lấy mẫu theo họ mô hình + dừng khi câu trả lời lặp lại
      const SMP = require('./agent/sampling'); const RG = require('./agent/repeat');
      const guard = RG.createRepeatGuard((info) => { LOG.log('chat', `Phát hiện lặp (${info.kind}, ${info.count} lần): “${info.sample}” — dừng sinh`); stopReasons.set(reqId, 'mô hình bắt đầu lặp lại, AIVN tự dừng'); ac.abort(); });
      const sampling = SMP.samplingFor(engine.status().id || '', 'chat', { temperature: typeof temperature === 'number' ? temperature : null });
      for (const k of ['topK', 'topP', 'minP', 'repeatPenalty', 'presencePenalty']) if (P[k] != null) sampling[k] = P[k];
      if (P.jsonSchema) { sampling.repeatPenalty = 1; sampling.presencePenalty = 0; sampling.dry = null; } // phạt lặp làm hỏng JSON
      const ov = fitOverflow(messages, P.overflow, maxTokens); messages = ov.messages;
      if (ov.dropped) LOG.log('chat', `Tràn ngữ cảnh (${P.overflow}): bỏ ${ov.dropped} tin cũ`);
      const thb = { buf: '', t: null }; const thFlush = () => { if (thb.t) { clearTimeout(thb.t); thb.t = null; } if (thb.buf) send('chat:think', { reqId, t: thb.buf }); thb.buf = ''; };
      let r; try { r = await withCtxGrow(() => withEngineRecovery(() => engine.generate(messages, { temperature: sampling.temperature, maxTokens, sampling, signal: ac.signal, seed: P.seed, stop: P.stop, jsonSchema: P.jsonSchema, onToken: (t, k) => { if (k === 'think') { thb.buf += t; if (!thb.t) thb.t = setTimeout(thFlush, 16); return; } guard.push(t); if (!guard.hit) tb.push(t); } }), { onRetry: (ctx) => { tb.flush(); send('chat:recover', { reqId, ctx }); } }), { minCtx: MIN_CTX_CHAT, onGrow: (ctx) => { tb.flush(); send('chat:recover', { reqId, ctx, grow: true }); } }); } finally { tb.flush(); }
      if (guard.hit && typeof r.text === 'string') r = { ...r, text: r.text.slice(0, guard.hit.cut).trim() };
      thFlush();
      return { ...r, docInfo, dropped: ov.dropped, stoppedBy: r.finishReason === 'abort' ? (stopReasons.get(reqId) || 'không rõ') : null };
    } finally { generations.delete(reqId); stopReasons.delete(reqId); }
  });
  ipcMain.handle('files:pick', async () => {
    const r = await dialog.showOpenDialog(win, { buttonLabel: 'Mở', title: 'Chọn tệp để gửi kèm', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Tài liệu và ảnh AIVN đọc được', extensions: require('./docs').PICKER_EXT }, { name: 'Tất cả tệp', extensions: ['*'] }] });
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
  // Đọc tài liệu đính kèm; PDF scan: đọc chữ từng trang bằng OCR, báo tiến độ cho chip tệp (files:progress)
  ipcMain.handle('files:extract', async (e, paths) => {
    const out = []; const prog = (p, o) => { try { e.sender.send('files:progress', { path: p, ...o }); } catch {} };
    for (const p of paths || []) {
      try {
        prog(p, { stage: 'read' });
        if (MEDIA.avKind(p)) { // âm thanh/video: chép lời (+ khung hình video cho mô hình nhìn ảnh, chữ trên hình bằng OCR)
          const vision = !!(engine && engine.status().vision);
          const r = await media.transcribe(p, { onProgress: (o) => prog(p, o), frames: 6, ocr: (buf) => engine.ocr(buf), ...avLang() });
          out.push({ ok: true, name: r.name, size: r.size, kind: r.kind, pages: null, chars: r.chars, text: r.text, duration: r.duration, segments: r.segments.length, device: r.device, ...(vision && r.frames.length ? { frames: pickFrames(r.frames, 4) } : {}) });
          continue;
        }
        const d = await docsPool.extractFile(p);
        if (d.scanned) {
          const parts = []; let conf = 0, n = 0;
          for (let i = 0; i < d.scanned.length; i++) {
            prog(p, { stage: 'ocr', i: i + 1, n: d.scanned.length });
            const r = await engine.ocr(Buffer.from(d.scanned[i].png));
            if (r && r.chars >= 3) { parts.push(`[Trang ${d.scanned[i].page}]\n${r.text}`); conf += r.confidence; n++; }
          }
          if (!parts.length) throw Object.assign(new Error('x'), { userMessage: `"${d.name}" là PDF scan nhưng AIVN không tìm thấy chữ nào trên các trang (ảnh mờ hoặc chữ viết tay?).` });
          const more = d.pages > d.scanned.length ? `\n\n[PDF có ${d.pages} trang, AIVN đọc chữ ${d.scanned.length} trang đầu]` : '';
          const text = parts.join('\n\n') + more;
          out.push({ ok: true, name: d.name, size: d.size, kind: 'pdf', pages: d.pages, chars: text.length, text, ocr: { pages: n, confidence: Math.round(conf / n) } });
          continue;
        }
        out.push({ ok: true, name: d.name, size: d.size, kind: d.kind, pages: d.pages, unit: d.unit, files: d.files, chars: d.chars, text: d.text });
      } catch (err) { out.push({ ok: false, name: path.basename(p), path: p, error: err.userMessage || ('Không đọc được tệp: ' + err.message), ...(err.code === 'need-asr' ? { needAsr: true } : {}) }); }
      finally { prog(p, { stage: 'done' }); }
    }
    return out;
  });
  ipcMain.handle('media:status', () => ({ ...media.status(), job: downloader.list ? (downloader.list().find(j => j.id === MEDIA.ASR.id) || null) : null }));
  ipcMain.handle('media:install', () => { if (media.installed()) return { installed: true }; return downloader.enqueue({ id: MEDIA.ASR.id, repo: MEDIA.ASR.repo, files: MEDIA.ASR.files, name: MEDIA.ASR.name, quant: 'q4', urlFor: MEDIA.resolveAsrUrl }); });
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
  ipcMain.handle('agent:info', async () => { const gate = await agentModelGate().catch(() => null); return { ...agentInfo(), gate }; });
  ipcMain.handle('agent:run', async (_e, { reqId, convoId, messages, attachments }) => {
    const ac = new AbortController(); generations.set(reqId, ac);
    try { await ensureAfterCrash(); const gate = await agentModelGate(); if (!gate.ok && engine.status().loaded) return { blocked: true, gate, steps: [] };
      const r = await withCtxGrow(() => withEngineRecovery(() => runAgentTurn({ reqId, convoId, messages, attachments, signal: ac.signal }), { minCtx: MIN_CTX_AGENT, onRetry: (ctx) => send('agent:status', { reqId, stage: 'recover', ctx }) }), { minCtx: MIN_CTX_AGENT, maxCtx: gate.ctx && gate.ctx < AGENT_CTX ? gate.ctx : 0, onGrow: (ctx) => send('agent:status', { reqId, stage: 'recover', ctx, grow: true }) }); return { ...r, steps: r.steps.map(slimStep), model: engine.status().id, stoppedBy: r.finishReason === 'abort' ? (stopReasons.get(reqId) || 'không rõ') : null }; }
    finally { generations.delete(reqId); stopReasons.delete(reqId); }
  });
  ipcMain.handle('agent:screen-reply', (_e, { id, ok, nx, ny }) => { const f = screenConfirms.get(id); if (f) f({ ok: ok === true, nx: Number.isFinite(nx) ? Math.min(1, Math.max(0, nx)) : null, ny: Number.isFinite(ny) ? Math.min(1, Math.max(0, ny)) : null }); return !!f; });
  ipcMain.handle('computer:perm-open', (_e, which) => { if (process.platform === 'darwin' && SC.PERM_URLS[which]) { if (which === 'accessibility') SC.permissions({ prompt: true }); shell.openExternal(SC.PERM_URLS[which]); } return computerInfo(); });
  ipcMain.handle('computer:perm-test', async () => { try { const shot = await SC.capture({ maxW: 320 }); return { ok: true, info: computerInfo(), w: shot.width }; } catch (e) { return { ok: false, error: e.message, info: computerInfo() }; } });
  ipcMain.handle('agent:confirm-reply', (_e, { id, ok }) => { const f = confirms.get(id); if (f) f(ok === true); return !!f; });
  ipcMain.handle('agent:approve-reply', (_e, r) => { const f = r && confirms.get(r.id); if (f) f({ ok: r.ok === true, reason: r.reason || '', always: r.always === true }); return !!f; });
  ipcMain.handle('agent:always-revoke', (_e, name) => { settings.data.agentAlwaysAllow = (settings.data.agentAlwaysAllow || []).filter(n => n !== name); settings.save(); LOG.log('agent', `Bỏ "Luôn cho phép": ${name}`); return settings.data.agentAlwaysAllow; });
  ipcMain.handle('agent:add-folder', async () => {
    const r = await dialog.showOpenDialog(win, { buttonLabel: 'Chọn thư mục', title: 'Chọn thư mục AIVN AGENT được phép làm việc', properties: ['openDirectory', 'createDirectory', 'multiSelections'] });
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
    try { await startApi(port); settings.data.apiPort = port; settings.save(); }
    catch (e) { log(`Lỗi: ${e.code === 'EADDRINUSE' ? `cổng ${port} đang bị chiếm` : e.message}`); throw new Error(e.code === 'EADDRINUSE' ? `Cổng ${port} đang được dùng bởi ứng dụng khác` : e.message); }
    return serverInfo();
  });
  ipcMain.handle('server:stop', async () => { await api.stop(); return serverInfo(); });
  const serverInfo = () => { const st = engine.status(); const a = api.status(); const port = a.port || settings.data.apiPort;
    return { ...a, log: serverLog, lan: !!settings.data.apiLan, cors: !!settings.data.apiCors, keySet: !!settings.data.apiKey, ttlMin: settings.data.apiTtlMin || 0, lanUrls: settings.data.apiLan ? lanUrls(port) : [],
      loaded: [st.loaded ? { id: st.id, kind: 'chat', jit: !!(apiJit && apiJit.id === st.id), ctx: st.contextSize, vision: !!st.vision } : null, ...(st.grounder ? [{ id: st.grounder.id || String(st.grounder), kind: 'eyes' }] : [])].filter(Boolean) }; };
  ipcMain.handle('server:status', () => serverInfo());
  ipcMain.handle('server:key', (_e, action) => { // khoá API: tạo mới / xem (để sao chép) / xoá. Không ghi khoá vào nhật ký
    if (action === 'generate') { settings.data.apiKey = 'aivn-' + require('crypto').randomBytes(24).toString('base64url'); settings.save(); log('Đã tạo khoá API mới'); return { key: settings.data.apiKey, info: serverInfo() }; }
    if (action === 'reveal') return { key: settings.data.apiKey || null };
    if (action === 'clear') { if (settings.data.apiLan && api.status().running) throw new Error('Đang mở cho mạng nội bộ: hãy tắt tuỳ chọn đó trước khi xoá khoá API.'); settings.data.apiKey = ''; settings.save(); log('Đã xoá khoá API'); return { key: null, info: serverInfo() }; }
    throw new Error('Thao tác không hợp lệ');
  });
  ipcMain.handle('server:config', async (_e, p = {}) => {
    if ('cors' in p) settings.data.apiCors = p.cors === true;
    if ('ttlMin' in p) settings.data.apiTtlMin = [0, 5, 15, 60, 240].includes(Number(p.ttlMin)) ? Number(p.ttlMin) : 0;
    if ('lan' in p) {
      if (p.lan === true && !settings.data.apiKey) throw new Error('Hãy tạo khoá API trước khi mở cho mạng nội bộ.');
      const was = !!settings.data.apiLan; settings.data.apiLan = p.lan === true;
      if (was !== settings.data.apiLan && api.status().running) { const port = api.status().port; await api.stop(); await startApi(port); } // đổi địa chỉ lắng nghe: khởi động lại
    }
    settings.save(); return serverInfo();
  });
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
    ...(isMac ? [{ label: 'AIVN', submenu: [{ role: 'about', label: 'Giới thiệu AIVN' }, { type: 'separator' }, { label: 'Khoá ngay', accelerator: 'CmdOrCtrl+Shift+L', click: () => lockNow('phím tắt') }, { type: 'separator' }, { role: 'hide', label: 'Ẩn AIVN' }, { role: 'hideOthers', label: 'Ẩn ứng dụng khác' }, { role: 'unhide', label: 'Hiện tất cả' }, { type: 'separator' }, { role: 'quit', label: 'Thoát AIVN' }] }] : [{ label: 'Tệp', submenu: [{ label: 'Khoá ngay', accelerator: 'CmdOrCtrl+Shift+L', click: () => lockNow('phím tắt') }, { type: 'separator' }, { role: 'quit', label: 'Thoát' }] }]),
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
    width: 1280, height: 820, minWidth: 640, minHeight: 560, /* B46: dùng được khi chia đôi/ba màn hình */ backgroundColor: windowBg(), title: 'AIVN',
    icon: path.join(__dirname, '..', 'build', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [`--aivn-theme=${windowBg() === '#ffffff' ? 'light' : 'dark'}`] }, // giao diện đã lưu, áp dụng trước lần vẽ đầu tiên
  });
  if (typeof qaReq !== 'undefined' && qaReq.enabled && qaReq.kind === 'qa-ui') { const si = win.showInactive.bind(win); win.show = si; win.focus = () => {}; win.moveTop = () => {}; } // không có lệnh nào (thẻ xin phép, thông báo…) giành được tiêu điểm
  buildMenus();
  loadUi();
  // QA giao diện (--qa-ui): mở cửa sổ KHÔNG giành tiêu điểm (showInactive) để không làm phiền người dùng đang làm việc
  win.once('ready-to-show', () => { if (hidden) return; if (typeof qaReq !== 'undefined' && qaReq.enabled && qaReq.kind === 'qa-ui') { win.showInactive(); return; } win.show(); });
  // Chạy nền: đóng cửa sổ thì thu xuống khay để Lịch tự động tiếp tục chạy
  win.on('close', (e) => {
    if (settings.data.keepInTray && tray && !quitting) {
      e.preventDefault(); win.hide();
      if (!settings.data.trayHintShown) { settings.data.trayHintShown = true; settings.save(); notify('AIVN vẫn đang chạy', 'Lịch tự động tiếp tục chạy trong khay hệ thống. Bấm biểu tượng AIVN để mở lại, hoặc chọn Thoát.'); }
    }
  });
  win.on('closed', () => { if (media) media.close(); }); // cửa sổ ẩn của bộ nghe không được giữ app sống khi cửa sổ chính đã đóng
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
// AIVN AGENT chỉ nhận mô hình làm được việc (xem agent-eligibility.js); Trò chuyện thường thì mô hình nào cũng được
const AE = require('./agent-eligibility');
const AP = require('./agent-plan');
// B38: MỘT cách tính cho Khám phá và Mô hình của tôi (fit.metaOf): cùng dung lượng (mô hình + mmproj), cùng KV/bộ đệm, và số đo thật nếu đã nạp trên máy này
const usageOfCatalog = (cid) => { const inst = cid ? listModels().find(m => m.catalog && m.catalog.id === cid) : null; return inst ? (settings.data.modelUsage || {})[inst.id] || null : null; };
const fitMetaCat = (c) => { const u = usageOfCatalog(c.id); return { ...require('./fit').metaOf({ catalog: c, measured: u && u.vram }), measuredTps: u && u.tps }; };
const catAgentFit = (c, h, ctx = AGENT_CTX) => (h ? hf.fitFor(c.size || 0, h, { ...fitMetaCat(c), ctx }) : null);
// B17: kế hoạch AIVN AGENT cho máy này (ngữ cảnh 16K hoặc 12K, có cho “Chạy chậm” không) — xem agent-plan.js
function agentPlanFor(h, sc, installed = []) {
  if (!h) return { ctx: AGENT_CTX, lowered: false, allowSlow: false, maxSpill: 0 };
  const cat = catalog.map(c => ({ id: c.id, vision: !!c.mmproj, catalog: c, size: c.size, _fit: (ctx) => catAgentFit(c, h, ctx) }));
  const inst = installed.map(m => ({ ...m, _fit: m._fit || ((ctx) => hf.fitFor(m.size || 0, h, { ...(m._meta || {}), ctx })) }));
  return { ...AP.plan([...cat, ...inst], (e, ctx) => e._fit(ctx), sc), allowVerySlow: settings.data.agentVerySlow === true };
}
async function withAgentCheck(list) {
  const h = await hw().catch(() => null); const sc = benchScores();
  const out = list.map(m => {
    let mm = 0; try { if (m.mmproj) mm = fs.statSync(m.mmproj).size; } catch {}
    const u = (settings.data.modelUsage || {})[m.id] || null;
    const meta = { ...require('./fit').metaOf({ catalog: m.catalog || null, size: m.size, mmprojSize: mm, file: m.file, measured: u && u.vram }), id: m.catalog ? m.catalog.id : m.id, measuredTps: u && u.tps };
    const fit = h ? hf.fitFor(m.size || 0, h, meta) : null;
    return { ...m, fit, _meta: meta, strength: require('./fit').strength({ ...m, ...meta }), quant: hf.parseQuant(m.file) || null, params: m.catalog ? m.catalog.params : null, usage: u ? { lastUsed: u.lastUsed || null, uses: u.uses || 0, tps: u.tps || null, vram: u.vram || null } : null, mmprojSize: mm };
  });
  const P = agentPlanFor(h, sc, out);
  const res = out.map(({ _meta, ...m }) => { const agentFit = h ? hf.fitFor(m.size || 0, h, { ..._meta, ctx: P.ctx }) : null;
    return { ...m, agentFit, agentCtx: P.ctx, agent: AE.eligibility({ ...m, fit: agentFit }, { shipped: m.catalog && sc.shipped[m.catalog.id], local: sc.local[m.id], ...AP.elOpts(P) }) }; });
  Object.defineProperty(res, 'plan', { value: P, enumerable: false });
  return res;
}
// Trạng thái “mô hình cho AIVN AGENT”: mô hình đang nạp có dùng được không, mô hình đã cài tốt nhất, và gợi ý tải nếu chưa có
let lastGateOk = null; // kết quả cổng AIVN AGENT gần nhất (cho lời chào)
async function agentModelGate() {
  const st = engine.status(); const sc = benchScores(); const h = await hw().catch(() => null);
  const list = await withAgentCheck(listModels()); const cur = st.loaded ? list.find(m => m.path === st.path) : null;
  const P = list.plan || agentPlanFor(h, sc);
  const allowSlow = P.allowSlow; const eo = AP.elOpts(P);
  const best = AE.bestFor(list.map(m => ({ ...m, installed: true })), sc, eo);
  const catE = catalog.map(c => ({ id: c.id, vision: !!c.mmproj, catalog: c, agentFit: catAgentFit(c, h, P.ctx), size: c.size, dlSize: (c.size || 0) + (c.mmproj && c.mmproj.size || 0) })); // B22: dung lượng tải = mô hình + tệp thị giác (khớp thẻ Khám phá)
  const recommended = [];
  for (let k = 0; k < 2; k++) { const r = AE.bestFor(catE.filter(x => !recommended.some(y => y.id === x.id)), sc, eo); if (r) recommended.push(r); }
  const recOut = recommended.map(x => ({ id: x.id, name: x.catalog.name, size: x.dlSize || x.size, installed: list.some(m => m.catalog && m.catalog.id === x.id), slow: !!(x.agentFit && x.agentFit.level === 'slow'), fitText: x.agentFit ? x.agentFit.text : '' }));
  // mô hình đang nạp bị tràn khỏi VRAM (chỉ một phần lớp trên GPU) → mỗi bước chậm; gợi ý mô hình nhìn màn hình vừa VRAM
  const spill = st.loaded && Number.isInteger(st.gpuLayers) && Number.isInteger(st.totalLayers) && st.totalLayers > 0 && st.gpuLayers < st.totalLayers && h && h.gpu && h.gpu !== 'metal'
    ? { gpuLayers: st.gpuLayers, totalLayers: st.totalLayers, better: (() => { const b = AE.bestFor([...list.map(m => ({ ...m, installed: true })), ...catE].filter(m => (m.agentFit || {}).level === 'fit' && (!cur || m.id !== cur.id)), sc); return b ? { id: b.id, name: b.catalog ? b.catalog.name : b.file, installed: !!b.installed } : null; })() } : null;
  const cloud = cloudBrainOn();
  const e = !st.loaded ? { ok: false, code: 'none', reason: 'Chưa nạp mô hình' } : cur ? cur.agent : { ok: false, code: 'unknown', reason: AE.REASONS.unknown };
  lastGateOk = !!(cloud || e.ok);
  return { ok: cloud || e.ok, cloud, cloudInfo: cloud ? { model: cloudCfg().model, host: (() => { try { return new URL(cloudCfg().baseUrl).host; } catch { return ''; } })(), eyes: !!st.vision } : null, code: e.code, reason: e.reason, modelName: cur ? (cur.catalog ? cur.catalog.name : cur.file) : (st.id || null),
    best: best && (!cur || best.id !== cur.id) ? { id: best.id, name: best.catalog ? best.catalog.name : best.file, slow: !!(best.agentFit && best.agentFit.level === 'slow') } : null, recommended: recOut,
    slow: !!(e && e.slow), verySlow: !!(e && e.verySlow), stepScale: (e && e.stepScale) || 1, slowReason: e && e.slow ? e.reason : null, allowSlow, spill, ctx: P.ctx, planNote: AP.note(P) };
}
// ---------- 0.16: bộ não đám mây (tuỳ chọn) cho AIVN AGENT — xem cloud-brain.js ----------
const CB = require('./cloud-brain');
const cloudCfg = () => settings.data.cloudBrain || {};
const cloudKeys = CB.createKeyStore({ safeStorage: require('electron').safeStorage, get: () => cloudCfg().keyEnc || null,
  set: (v) => { const c = { ...cloudCfg() }; if (v) c.keyEnc = v; else delete c.keyEnc; settings.data.cloudBrain = c; settings.save(); } });
const cloudBrain = CB.createCloudBrain({ getConfig: cloudCfg, getKey: () => cloudKeys.get() });
const cloudBrainOn = () => { const c = cloudCfg(); return !!(c.enabled && c.model && c.baseUrl && cloudKeys.has()); };
const cloudPublic = () => { const c = cloudCfg(); return { enabled: !!c.enabled, baseUrl: c.baseUrl || '', model: c.model || '', ctx: c.ctx || 32768, keySet: cloudKeys.has(), keySecure: cloudKeys.secure(), on: cloudBrainOn() }; };
// AIVN AGENT thấy “bộ máy” này: khi bật bộ não đám mây thì lập kế hoạch/gọi công cụ đi qua máy chủ đó; mắt nhìn (vision) vẫn là mô hình trên máy
const agentEngine = new Proxy({}, { get(_t, k) {
  if (cloudBrainOn()) {
    if (k === 'chatStep') return (m, o) => cloudBrain.chatStep(m, o);
    if (k === 'status') return () => { const s0 = engine.status() || {}; const c = cloudCfg(); return { ...s0, loaded: true, id: 'cloud:' + c.model, contextSize: c.ctx || 32768, cloud: true, vision: !!s0.vision }; };
    if (k === 'countTokens') return (x) => Math.ceil(String(x || '').length / 3);
  }
  const v = engine[k]; return typeof v === 'function' ? v.bind(engine) : v;
} });
function benchScores() {
  let local = {}; try { local = JSON.parse(fs.readFileSync(BENCH_FILE(), 'utf8')).models || {}; } catch {}
  let shipped = {}; try { shipped = require('./bench-results.json').models || {}; } catch {}
  return { local, shipped };
}
let benchRun = null;
// bài đo (Điểm tác vụ và bộ đo đầy đủ) chạy cả mô hình chưa đạt để chấm điểm — chỉ chỗ này bỏ qua cổng AIVN AGENT
const benchTurn = ({ messages, signal }) => runAgentTurn({ reqId: null, convoId: 'bench', messages, signal, gate: false });
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
        runTurn: benchTurn,
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
// ---------- Bộ đo AIVN AGENT đầy đủ (Nhà phát triển → “Chạy bộ đo”): 2B/4B/8B đã tải, 20–40 phút, một tệp kết quả ----------
let benchSandbox = null;
function fullBenchModels() { return require('./agent-bench-full').findQwenVL(listModels()); }
async function runFullBench(ids, { parts = null, apps = null, out: outFile = null } = {}) {
  const on = (k) => !parts || parts.includes(k);
  if (benchRun) throw new Error('Bài đo đang chạy.');
  const FB = require('./agent-bench-full'); const AB = require('./agent-bench'); const U = require('./agent/uitree'); const os = require('os');
  const all = fullBenchModels(); const list = ids && ids.length ? all.filter(m => ids.includes(m.id)) : all;
  if (!list.length) throw new Error('Chưa thấy Qwen3-VL 2B/4B/8B đã tải đủ (cần cả tệp mô hình và tệp thị giác mmproj).');
  const ac = new AbortController(); benchRun = ac; const started = new Date();
  const keep = { agentComputer: settings.data.agentComputer, agentScreen: settings.data.agentScreen, agentScreenMode: settings.data.agentScreenMode, agentToolsOff: settings.data.agentToolsOff };
  Object.assign(settings.data, { agentComputer: true, agentScreen: true, agentScreenMode: 'important', agentToolsOff: [] });
  const perModelMs = Math.max(8, Math.min(20, Math.floor(40 / list.length))) * 60000; // tổng ≤ ~40 phút
  const prog = (p) => send('bench:fullProgress', { ...p, models: list.length });
  const h = await hw().catch(() => ({}));
  let disp = []; try { disp = require('electron').screen.getAllDisplays().map(d => ({ w: d.size.width, h: d.size.height, scale: d.scaleFactor, px: `${Math.round(d.size.width * d.scaleFactor)}x${Math.round(d.size.height * d.scaleFactor)}` })); } catch {}
  const out = { kind: 'aivn-agent-bench', format: 1, app: app.getVersion(), started: started.toISOString(), thresholds: FB.THRESH, note: 'Không gửi tin/thư thật: chỉ ứng dụng giả “AIVN Bench”, âm lượng giả lập.',
    machine: { platform: process.platform, os: os.release(), cpu: h.cpu || (os.cpus()[0] || {}).model, cores: h.cpus, ram: h.ram, gpu: h.gpu, vram: h.vram, displays: disp }, models: [] };
  const file = outFile || path.join(app.getPath('downloads'), `AIVN-bench-${app.getVersion()}-${started.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
  const save = () => FB.writeResult(file, out);
  try {
    for (const [mi, m] of list.entries()) {
      if (ac.signal.aborted) break;
      const deadline = Date.now() + perModelMs; const r = { model: m, started: new Date().toISOString() }; out.models.push(r);
      prog({ model: m.size, mi: mi + 1, phase: 'load' });
      const t0 = Date.now();
      try { const st = await loadById(m.id, { force: true }); send('model:status', engine.status()); r.load = { ms: Date.now() - t0, mode: st.mode, ctx: st.contextSize, gpuLayers: st.gpuLayers, vram: ((settings.data.modelUsage || {})[m.id] || {}).vram || null }; }
      catch (e) { r.load = { error: e.message }; r.verdict = FB.verdict(r); save(); continue; }
      LOG.log('bench', `Bộ đo đầy đủ: ${m.size} (${m.file})`);
      const spillHeavy = r.load && Number.isInteger(r.load.gpuLayers) && engine.status().totalLayers > 0 && r.load.gpuLayers < engine.status().totalLayers * 0.6; const tScale = spillHeavy ? 3 : 1; agentStepScale = tScale; r.stepScale = tScale;
      if (on('tools')) try { r.tools = await FB.runToolBench({ engine, defs: computerTools.defs || {}, signal: ac.signal, onProgress: (p) => prog({ model: m.size, mi: mi + 1, ...p }) }); } catch (e) { r.tools = { error: e.message }; }
      save();
      if (!ac.signal.aborted && on('grounding')) { prog({ model: m.size, mi: mi + 1, phase: 'grounding' }); try { const g = await runGroundingBench(m.id); r.grounding = { score: g.score, total: g.total, seconds: g.seconds, items: g.items }; } catch (e) { r.grounding = { error: e.message }; } save(); }
      const U2 = require('./agent/uitree'); benchSandbox = FB.createSandbox({ windows: U2.windows, matchWindow: U2.matchWindow, allowApp: AB.OPEN_APP[process.platform] || 'Notepad' });
      const runTurn = benchTurn;
      try {
        if (!ac.signal.aborted && on('apps')) { try { r.apps = await FB.runChatTasks({ only: apps, BrowserWindow, desk: getDesk(), runTurn, signal: ac.signal, deadline, perTaskMs: 180000 * tScale, sandboxCalls: (reset) => benchSandbox.calls(reset), onProgress: (p) => prog({ model: m.size, mi: mi + 1, ...p }) }); } catch (e) { r.apps = { error: e.message }; } save(); }
        if (!ac.signal.aborted && on('tasks')) {
          try { const b = await AB.runBench({ BrowserWindow, desk: getDesk(), windows: U.windows, modelId: m.id, signal: ac.signal, deadline, perTaskMs: 180000 * tScale, runTurn, killPid: (pid) => { try { process.kill(pid); } catch {} }, onProgress: (p) => prog({ model: m.size, mi: mi + 1, phase: 'tasks', ...p }) });
            r.tasks = { score: b.score, total: 10, done: b.done, safety: b.safety, seconds: b.seconds, items: b.tasks };
            let bf = {}; try { bf = JSON.parse(fs.readFileSync(BENCH_FILE(), 'utf8')); } catch {}
            bf.models = bf.models || {}; bf.models[m.id] = { ...(bf.models[m.id] || {}), score: b.score, total: 10, done: b.done, safety: b.safety, seconds: b.seconds, date: b.started, machine: `${process.platform} · ${out.machine.cpu} · ${engine.status().mode || ''}` };
            fs.writeFileSync(BENCH_FILE(), JSON.stringify(bf, null, 2));
          } catch (e) { r.tasks = { error: e.message }; }
        }
      } finally { r.sandbox = { violations: benchSandbox.violations() }; benchSandbox = null; }
      r.seconds = Math.round((Date.now() - t0) / 1000); r.verdict = FB.verdict(r); r.summary = FB.summaryLine(r);
      // kết quả cho bộ chọn mô hình trên máy này (thang dự phòng: mô hình chưa đạt bị xếp sau) — chỉ khi đo ĐỦ (không dừng giữa chừng, không bỏ phần nào)
      const complete = !ac.signal.aborted && !parts && !apps && !!(r.tools && r.tools.total && r.apps && r.apps.total === FB.CHAT_TASKS.length && !r.apps.items.some(x => x.skipped) && r.tasks && r.tasks.done === 10);
      try { let bf = {}; try { bf = JSON.parse(fs.readFileSync(BENCH_FILE(), 'utf8')); } catch {} bf.models = bf.models || {};
        bf.models[m.id] = { ...(bf.models[m.id] || {}), full: { agentOk: r.verdict.agentOk, complete, tools: r.tools && r.tools.rate, apps: r.apps && r.apps.score, appsTotal: r.apps && r.apps.total, wrongRecipient: r.apps && r.apps.wrongRecipient, date: r.started, app: app.getVersion() } };
        fs.writeFileSync(BENCH_FILE(), JSON.stringify(bf, null, 2)); } catch {}
      LOG.log('bench', r.summary); save();
    }
  } finally {
    benchSandbox = null; agentStepScale = 1; Object.assign(settings.data, keep); settings.save(); benchRun = null;
    out.finished = new Date().toISOString(); out.stopped = ac.signal.aborted;
    const since = out.started; out.log = String(LOG.tail(800) || '').split('\n').filter((l, i, a) => { const t = /^\d{4}-\d\d-\d\dT[\d:.]+Z/.exec(l); return t ? t[0] >= since : true; }).slice(-600).join('\n');
    save();
  }
  if (!outFile) try { shell.showItemInFolder(file); } catch {}
  return { file, summary: out.models.map(r => r.summary || `${r.model.size}: ${r.load && r.load.error ? 'không nạp được — ' + r.load.error : 'đã dừng'}`) };
}
async function runGroundingBench(id) {
  const AB = require('./agent-bench'); const SC = require('./screen-control');
  const g = await getGrounder(id); if (!g) throw new Error('Không nạp được mô hình định vị (cần mô hình nhìn ảnh đã tải kèm tệp thị giác).');
  const fi = SC.familyInfo(g.id);
  const r = await AB.runGroundBench({ BrowserWindow, modelId: id, align: fi.align, locate: async (shot, q) => { const r = await SC.locate(g.engine, shot, q, { modelId: g.id }); return { box: r.box, raw: r.raw }; } });
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
  win.setBounds({ x: 0, y: 0, width: 1280, height: 720 });
  await until('typeof show === "function" && !!state.settings', 60000);
  Object.assign(settings.data, process.env.AIVN_QACU_FOLDER ? { agentFolders: [process.env.AIVN_QACU_FOLDER], agentComputer: false, agentScreen: false, agentToolsOff: [] } : { agentComputer: true, agentScreen: true, agentScreenMode: process.env.AIVN_QACU_MODE || 'each', agentToolsOff: [] }); settings.save();
  const id = process.env.AIVN_QACU_MODEL; const t0 = Date.now();
  out.load = await loadById(id, { force: true }).then(st => ({ ok: true, ms: Date.now() - t0, ctx: st.contextSize, mode: st.mode })).catch(e => ({ ok: false, error: e.message })); save();
  send('model:status', engine.status());
  await js('show("agent")'); await until('!!state.agent', 20000); await sleep(800);
  if (process.env.AIVN_QACU_HISTORY) { await js(`(() => { const h = ${fs.readFileSync(process.env.AIVN_QACU_HISTORY, 'utf8')}; if (!state.current) state.current = { id: uid(), title: 'QA', messages: [], createdAt: Date.now(), updatedAt: Date.now(), mode: 'agent' }; state.current.messages.push(...h); renderMessages(); })()`).catch(e => { out.historyError = e.message; }); await sleep(500); }
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

// QA tương đương LM Studio (chỉ khi phát triển): AIVN_QAPAR=thư mục ảnh, AIVN_QAPAR_STEPS=tệp JSON [{n, js, w?, h?, wait?, cdp?: [{method, params}]}]
async function qaPar() {
  const dir = process.env.AIVN_QAPAR; fs.mkdirSync(dir, { recursive: true });
  const steps = JSON.parse(fs.readFileSync(process.env.AIVN_QAPAR_STEPS, 'utf8'));
  const errs = global.__qaErrs || [];
  const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  const until = async (c, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(150); } return false; };
  await until('typeof show === "function" && !!state.settings', 60000);
  await js('document.querySelectorAll(".modal-back").forEach(m => m.hidden = true)');
  const out = {};
  for (const st of steps) {
    try {
      if (st.w) { win.setBounds({ x: 0, y: 0, width: st.w, height: st.h }); await sleep(300); }
      if (st.cdp) { if (!wc.debugger.isAttached()) wc.debugger.attach('1.3'); for (const c of st.cdp) await wc.debugger.sendCommand(c.method, c.params || {}); }
      const r = st.js ? await js(`(async () => { ${st.js} })()`) : undefined;
      if (st.until) out[st.n + ':until'] = await until(st.until, st.untilMs || 30000);
      await sleep(st.wait ?? 600);
      if (!st.noshot) fs.writeFileSync(path.join(dir, st.n + '.png'), (await wc.capturePage()).toPNG());
      out[st.n] = r === undefined ? true : r;
    } catch (e) { out[st.n] = 'LỖI: ' + e.message; }
  }
  out._consoleErrors = errs; fs.writeFileSync(path.join(dir, 'qapar.json'), JSON.stringify(out, null, 2)); app.exit(0);
}
// QA 0.16 âm thanh/video (AIVN_QA_MEDIA=thư mục, AIVN_QA_MEDIA_FILES=tệp1<sep>tệp2, chỉ khi phát triển): đính kèm bằng đúng đường của giao diện
// (addFiles → files:extract → bộ nghe), ghi nhãn tiến độ đã thấy, kết quả từng chip; AIVN_QA_MEDIA_NOASR=1: chưa có bộ nghe → phải hỏi tải, "Để sau" bỏ chip
async function qaMedia() {
  const dir = process.env.AIVN_QA_MEDIA; fs.mkdirSync(dir, { recursive: true });
  const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  const errs = []; wc.on('console-message', (ev) => { const m = ev && ev.message; if (m && /error|uncaught/i.test(m)) errs.push(String(m).slice(0, 300)); });
  const until = async (c, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(200); } return false; };
  const out = { errs, installed: media.installed() }; const save = () => fs.writeFileSync(path.join(dir, 'qamedia.json'), JSON.stringify(out, null, 2));
  try {
    await until('typeof addFiles === "function" && !!state.settings', 60000);
    await js(`localStorage.setItem('aivn.onboarded', '1'); document.querySelector('#onboard') && (document.querySelector('#onboard').hidden = true)`);
    const files = String(process.env.AIVN_QA_MEDIA_FILES || '').split(path.delimiter).filter(Boolean);
    if (process.env.AIVN_QA_MEDIA_NOASR === '1') {
      await js(`addFiles(${JSON.stringify(files.slice(0, 1))})`);
      out.modalShown = await until(`!document.querySelector('#confirmModal').hidden`, 20000);
      out.modal = await js(`({ title: document.querySelector('#cfTitle').textContent, msg: document.querySelector('#cfMsg').textContent, ok: document.querySelector('#cfYes').textContent, no: document.querySelector('#cfNo').textContent, chip: (document.querySelector('#chips .chip .sz') || {}).textContent || '' })`);
      fs.writeFileSync(path.join(dir, 'noasr-modal.png'), (await wc.capturePage()).toPNG());
      await js(`document.querySelector('#cfNo').click()`); await sleep(500);
      out.chipsAfterNo = await js(`pending.length`);
    } else {
      const seen = new Set(); let shot = false; const toastsSeen = [];
      await js(`(() => { const o = window.toast; window.__qaToasts = []; window.toast = (m, e) => { window.__qaToasts.push(String(m)); return o(m, e); }; })()`).catch(() => {});
      js(`addFiles(${JSON.stringify(files)})`).catch(() => {});
      const t0 = Date.now();
      while (Date.now() - t0 < 1500000) {
        const st = await js(`({ loading: pending.filter(a => a.loading).length, n: pending.length, labels: [...document.querySelectorAll('#chips .chip .sz')].map(x => x.textContent) })`);
        st.labels.forEach(l => seen.add(l.replace(/\d+%.*$/, '%').replace(/^[^·]*· /, '')));
        if (!shot && st.labels.some(l => /chép lời \d+%/.test(l))) { shot = true; fs.writeFileSync(path.join(dir, 'chips-progress.png'), (await wc.capturePage()).toPNG()); }
        if (st.n && !st.loading) break; await sleep(300);
        if (!st.n && Date.now() - t0 > 5000) break;
      }
      out.ms = Date.now() - t0; out.labels = [...seen]; toastsSeen.push(...await js('window.__qaToasts || []'));
      out.items = await js(`pending.map(a => ({ name: a.name, ok: a.ok, kind: a.kind, duration: a.duration, frames: (a.frames || []).length, chars: (a.text || '').length, text: (a.text || '').slice(0, 2500), sz: a.size }))`);
      fs.writeFileSync(path.join(dir, 'chips-done.png'), (await wc.capturePage()).toPNG());
      out.toasts = toastsSeen;
      // AIVN AGENT read_file đi qua cùng bộ nghe
      if (files[0]) { try { const r = await extractAny(files[0]); out.agentRead = { kind: r.kind, chars: r.chars, head: r.text.slice(0, 300) }; } catch (e) { out.agentRead = { error: e.userMessage || e.message }; } }
      out.direct = [];
      for (const f of files.filter(x => MEDIA.avKind(x) === 'video')) { try { const r = await media.transcribe(f, { frames: 6, ocr: (b) => engine.ocr(b) }); out.direct.push({ name: r.name, language: r.language, detected: r.detected, frames: r.frames.length, frameAt: r.frameAt, frameError: r.frameError, duration: r.duration, device: r.device, ocrInText: /Chữ trên hình/.test(r.text), tail: r.text.slice(-400) }); if (r.frames[0]) fs.writeFileSync(path.join(dir, r.name + '-frame0.jpg'), Buffer.from(r.frames[0].split(',')[1], 'base64')); } catch (e) { out.direct.push({ name: f, error: e.userMessage || e.message }); } }
      out.status = media.status();
    }
  } catch (e) { out.error = String(e && e.stack || e); }
  save(); app.quit();
}

// QA 0.16 Kinh doanh (AIVN_QA_BIZ=thư mục, chỉ khi phát triển): đi trọn luồng Odoo bằng giao diện — nhập kho → báo giá → xác nhận → giao một phần
// (phiếu chờ) → hoá đơn → vào sổ → thu tiền → báo cáo; chụp từng màn hình, ghi trạng thái; AIVN_QA_BIZ_LANG=en|zh thì liệt kê chữ tiếng Việt còn sót
async function qaBiz() {
  const dir = process.env.AIVN_QA_BIZ; fs.mkdirSync(dir, { recursive: true });
  const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  const errs = []; wc.on('console-message', (ev) => { const m = ev && ev.message; if (m && /error|lỗi|uncaught/i.test(m)) errs.push(String(m).slice(0, 300)); });
  const until = async (c, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(150); } return false; };
  const out = { steps: {}, errs }; win.setBounds({ x: 0, y: 0, width: 1366, height: 860 });
  await until('typeof show === "function" && !!state.settings && !!window.BIZ', 60000);
  await js(`localStorage.setItem('aivn.onboarded', '1'); document.querySelector('#onboard') && (document.querySelector('#onboard').hidden = true)`);
  const lang = process.env.AIVN_QA_BIZ_LANG || 'vi';
  if (lang !== 'vi') { await js(`I18N.setLang(${JSON.stringify(lang)})`); await sleep(300); }
  const shot = async (n) => { await sleep(700); fs.writeFileSync(path.join(dir, `${lang}-${n}.png`), (await wc.capturePage()).toPNG()); };
  const look = () => js(`({ crumbs: (document.querySelector('.biz-crumbs') || {}).innerText || '', status: (document.querySelector('.biz-status .on') || {}).innerText || '', toasts: [...document.querySelectorAll('.toast-stack .toast-item')].map(t => t.innerText.trim()), err: (document.querySelector('#bizErr') || {}).textContent || '' })`);
  const left = () => js(`(() => { const VI = ${I18N_CORE.VI}; const hits = new Set(); const w = document.createTreeWalker(document.querySelector('#view-crm'), NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.trim(); if (t && VI.test(t) && n.parentElement.offsetParent && !n.parentElement.closest('.biz-lines td:nth-child(-n+2), select, .biz-title')) hits.add(t.slice(0, 80)); } document.querySelectorAll('#view-crm button, #view-crm th, #view-crm label').forEach(e => { if (e.offsetParent && VI.test(e.getAttribute('aria-label') || '')) hits.add('@aria ' + e.getAttribute('aria-label')); }); return [...hits]; })()`);
  const step = async (n, code, wait = 600) => { try { if (code) await js(code); await sleep(wait); await shot(n); out.steps[n] = await look(); if (lang !== 'vi') out.steps[n].leftover = await left(); } catch (e) { out.steps[n] = { error: e.message }; } };
  const click = (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('không thấy ' + ${JSON.stringify(sel)}); b.click(); })()`;
  const yes = `document.querySelector('#cfYes').click()`;
  try {
    await js(`(async () => { const C = async (fn, ...a) => { const r = await A.crm(fn, ...a); if (!r.ok) throw new Error(fn + ': ' + r.error); return r.data; };
      await C('saveContact', { name: 'Công ty TNHH Sen Vàng', kind: 'company', phone: '02838123456', email: 'lienhe@senvang.vn', address: '12 Nguyễn Huệ, Q.1, TP.HCM', tax_id: '0312345678' });
      await C('saveProduct', { name: 'Bàn làm việc gỗ sồi', sku: 'BAN-01', price: 2500000, cost: 1500000, type: 'product', unit: 'cái', min_qty: 2, category: 'Nội thất' });
      await C('saveProduct', { name: 'Ghế xoay lưới', sku: 'GHE-01', price: 900000, cost: 500000, type: 'product', unit: 'cái', category: 'Nội thất' });
      await C('saveProduct', { name: 'Lắp đặt tại nhà', price: 300000, type: 'service', unit: 'lần' }); })()`);
    await step('00-tong-quan', 'show("crm"); crm.tab = "dash"; renderCrm()', 1200);
    await step('01-san-pham', 'crm.tab = "sales"; BIZ.reset(); BIZ.state.sub.sales = "products"; renderCrm()');
    await step('02-san-pham-form', click('[data-biz-open^="product:"]'));
    await js(`document.querySelector('#bizModal').hidden = true`);
    // nhập kho: 3 bàn, 1 ghế
    await step('03-phieu-nhap-moi', 'crm.tab = "stock"; BIZ.reset(); BIZ.state.sub.stock = "in"; renderCrm().then(() => document.querySelector("#crmAdd").click())', 900);
    await js(`(async () => { const sel = document.querySelector('tr[data-line="0"] [data-lf=product_id]'); sel.value = [...sel.options].find(o => o.text.startsWith('Bàn')).value; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); document.querySelector('tr[data-line="0"] [data-lf=qty]').value = '3';
      document.querySelector('[data-biz-act=addLine]').click(); await new Promise(r => setTimeout(r, 300)); const s2 = document.querySelector('tr[data-line="1"] [data-lf=product_id]'); s2.value = [...s2.options].find(o => o.text.startsWith('Ghế')).value; s2.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); document.querySelector('tr[data-line="1"] [data-lf=qty]').value = '1'; })()`);
    await step('04-phieu-nhap-luu', click('[data-biz-act=saveReceipt]'), 1000);
    await step('05-phieu-nhap-xong', click('[data-biz-act=validatePicking]'), 1200);
    await step('06-ton-kho', 'BIZ.reset(); BIZ.state.sub.stock = "onhand"; renderCrm()');
    // báo giá: 2 bàn + 3 ghế + lắp đặt
    await step('07-bao-gia-moi', 'crm.tab = "sales"; BIZ.reset(); BIZ.state.sub.sales = "quotes"; renderCrm().then(() => document.querySelector("#crmAdd").click())', 1000);
    await js(`(async () => { const w = () => new Promise(r => setTimeout(r, 350)); const c = document.querySelector('[data-f=contact_id]'); c.value = [...c.options].find(o => o.text.includes('Sen Vàng')).value; c.dispatchEvent(new Event('change', { bubbles: true })); await w();
      document.querySelector('[data-f=payment_days]').value = '30';
      for (const [i, name, q] of [[0, 'Bàn', '2'], [1, 'Ghế', '3'], [2, 'Lắp', '1']]) { document.querySelector('[data-biz-act=addLine]').click(); await w(); const s = document.querySelector('tr[data-line="' + i + '"] [data-lf=product_id]'); s.value = [...s.options].find(o => o.text.startsWith(name)).value; s.dispatchEvent(new Event('change', { bubbles: true })); await w(); const qn = document.querySelector('tr[data-line="' + i + '"] [data-lf=qty]'); qn.value = q; qn.dispatchEvent(new Event('change', { bubbles: true })); await w(); } })()`);
    await step('08-bao-gia-dien', null, 300);
    await step('09-bao-gia-luu', click('[data-biz-act=saveOrder]'), 1000);
    await step('10-don-xac-nhan', click('[data-biz-act=confirmOrder]'), 1200);
    out.order = await js(`({ total: document.querySelector('.biz-totals .grand b').innerText, smart: [...document.querySelectorAll('.biz-smart')].map(b => b.innerText) })`);
    // giao: thiếu ghế (có 1, cần 3) → giao 2 bàn + 1 ghế, tạo phiếu chờ
    await step('11-phieu-giao', click('[data-biz-act=openPickings]'), 1000);
    await js(`(() => { const rows = [...document.querySelectorAll('[data-move]')]; for (const i of rows) { const name = i.closest('tr').cells[0].innerText; i.value = name.startsWith('Ghế') ? '1' : '2'; } })()`);
    await js(click('[data-biz-act=validatePicking]')); await sleep(800); await step('12-hoi-phieu-cho', null, 200);
    await js(yes); await sleep(1200); await step('13-phieu-giao-xong', null, 300);
    out.backorder = await js(`(document.querySelector('[data-biz-open^="picking:"]') || {}).innerText || ''`);
    // hoá đơn
    await step('14-ve-don', click('[data-biz-act=openSo]'), 1000);
    await step('15-hoa-don-nhap', click('[data-biz-act=invoiceOrder]'), 1200);
    await step('16-hoa-don-vao-so', click('[data-biz-act=postInvoice]'), 1200);
    await step('17-thanh-toan-hop', click('[data-biz-act=payInvoice]'), 800);
    await js(`(() => { const f = document.querySelector('#bizForm'); f.querySelector('[name=amount]').value = '5000000'; f.requestSubmit(); })()`); await sleep(1200);
    await step('18-thanh-toan-mot-phan', null, 300);
    out.invoice = await js(`({ ribbon: (document.querySelector('.biz-ribbon') || {}).innerText || '', due: [...document.querySelectorAll('.biz-totals .grand b')].map(b => b.innerText) })`);
    await step('19-ds-hoa-don', 'BIZ.reset(); renderCrm()', 800);
    await step('20-bc-ban-hang', 'crm.tab = "reports"; BIZ.reset(); BIZ.state.sub.reports = "sales"; BIZ.state.rep.groupBy = "product"; renderCrm()', 900);
    await step('21-bc-cong-no', 'BIZ.state.sub.reports = "invoice"; renderCrm()', 900);
    await step('22-bc-ton-kho', 'BIZ.state.sub.reports = "stock"; renderCrm()', 900);
    await step('23-tong-quan', 'crm.tab = "dash"; renderCrm()', 1200);
    out.db = await js(`(async () => { const r = await A.crm('overview'); return r.data; })()`);
  } catch (e) { out.error = e.message; }
  fs.writeFileSync(path.join(dir, `qabiz-${lang}.json`), JSON.stringify(out, null, 2)); app.exit(0);
}
// QA 0.15.0 giao diện (AIVN_QAUI=thư mục, chỉ khi phát triển): chụp 1280x720 các màn hình mới
async function qaUI() {
  const dir = process.env.AIVN_QAUI; fs.mkdirSync(dir, { recursive: true });
  const wc = win.webContents; const js = (c) => wc.executeJavaScript(c).catch((e) => { throw new Error(e.message + ' · đoạn mã: ' + String(c).slice(0, 160)); });
  wc.on('console-message', (ev) => { const m = ev && ev.message; if (m && /error|lỗi/i.test(m)) console.error('[renderer]', String(m).slice(0, 300)); });
  const until = async (c, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(150); } return false; };
  const out = {}; const shot = async (n) => { await sleep(700); fs.writeFileSync(path.join(dir, n + '.png'), (await wc.capturePage()).toPNG()); out[n] = true; };
  win.setBounds({ x: 0, y: 0, width: 1280, height: 720 });
  await until('typeof show === "function" && !!state.settings', 60000);
  const step = async (n, code) => { try { if (code) await js(code); await shot(n); } catch (e) { out[n] = 'lỗi: ' + e.message; } };
  if (process.env.AIVN_QAUI_ONBOARD) await step('00-onboarding', 'startOnboard(true)');
  if (process.env.AIVN_QAUI_016FIT) { // QA 0.16: nhóm theo mức chạy + bộ chọn mô hình AIVN AGENT
    await js('show("discover")'); await until('document.querySelectorAll("#catalog .fit-group").length > 0', 30000);
    await shot('016-discover-top'); await js('(document.querySelector("#screenArea:not([hidden])") || document.body).scrollIntoView(), 1'); await shot('016-discover-agent');
    await js('document.querySelector("#catalog").scrollIntoView(), 1'); await shot('016-discover-groups');
    await js('(document.querySelector(".fit-group-no") || document.body).scrollIntoView(), 1'); await shot('016-discover-cannot');
    out.discover = await js(`[...document.querySelectorAll("#screenCards .fit-head, #catalog .fit-head")].map(h => h.textContent)`);
    out.discoverFirst = await js(`[...document.querySelectorAll("#catalog .fit-group")].map(g => [g.querySelector(".fit-head").textContent, [...g.querySelectorAll(".card h4, .card b")].slice(0, 3).map(x => x.textContent), [...g.querySelectorAll(".fit")].slice(0, 3).map(x => x.textContent)])`);
    await js('show("chat"); 1'); await sleep(500);
    out.chatPicker = await js(`[...document.querySelectorAll("#modelSelect optgroup")].map(g => ({ g: g.label, o: [...g.querySelectorAll("option")].map(o => (o.disabled ? "[khoá] " : "") + o.textContent) }))`);
    await js('typeof setMode === "function" ? setMode("agent") : show("agent"); 1'); await sleep(2000);
    out.agentPicker = await js(`[...document.querySelectorAll("#modelSelect optgroup")].map(g => ({ g: g.label, o: [...g.querySelectorAll("option")].map(o => (o.disabled ? "[khoá] " : "") + o.textContent) }))`);
    out.agentWarn = await js('(w => w && !w.hidden ? w.innerText : null)(document.querySelector("#agentWarn"))');
    await shot('016-agent-gate');
    fs.writeFileSync(path.join(dir, 'qa016fit.json'), JSON.stringify(out, null, 2)); app.exit(0); return;
  }
  if (process.env.AIVN_QAUI_LAYOUT) { // B46: bố cục co giãn — mọi màn hình chính ở 1280/1024/800/640 px, vi/en/zh; đo tràn ngang, độ rộng ô nhập, chụp ảnh
    await js('document.querySelectorAll(".modal-back").forEach(m => m.hidden = true); localStorage.removeItem("aivn.railCompact"); localStorage.removeItem("aivn.noPanel"); 1');
    // vài cuộc trò chuyện tên dài để thấy dấu …
    await js(`(() => { const t = ["Viết bài 1000 chữ về trí tuệ nhân tạo và giáo dục đại học Việt Nam", "Giới thiệu ngắn gọn về Trường Đại học Văn Lang", "Trong kho mô hình thì mô hình nào hợp với máy 4 GB"]; state.convos = t.map((x, i) => ({ id: "qa" + i, title: x, mode: "chat", messages: [], updatedAt: Date.now() - i })); renderConvos(); return 1; })()`);
    const VIEWS = (process.env.AIVN_QAUI_LAYOUT_VIEWS || 'chat,agent,discover,models,server,settings,crm').split(',');
    const WIDTHS = (process.env.AIVN_QAUI_LAYOUT_W || '1280,1024,800,640').split(',').map(Number);
    const LANGS = (process.env.AIVN_QAUI_LAYOUT_LANGS || 'vi,en,zh').split(',');
    const measure = () => js(`(() => {
      const W = innerWidth; const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const clipR = (e) => { let p = e.parentElement; while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') return p.getBoundingClientRect().right; p = p.parentElement; } return Infinity; };
      const view = document.querySelector('.view.active'); const roots = [document.querySelector('.rail'), document.querySelector('.topbar'), view, document.querySelector('.statusbar')].filter(Boolean);
      const over = [];
      for (const r of roots) for (const e of [r, ...r.querySelectorAll('*')]) { if (!vis(e)) continue; const b = e.getBoundingClientRect(); if (b.right > W + 1 && Math.min(b.right, clipR(e)) > W + 1 && !e.closest('[hidden]')) { over.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) + ' r=' + Math.round(b.right)); if (over.length > 8) break; } }
      const xs = []; for (const r of roots) for (const e of [r, ...r.querySelectorAll('*')]) { if (!vis(e) || e.closest('textarea, pre, code, .allow-xscroll, .set-nav, .crm-tabs, .tool-chips')) continue; const o = getComputedStyle(e).overflowX; if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 2) xs.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) + ' +' + (e.scrollWidth - e.clientWidth)); }
      const page = { doc: document.documentElement.scrollWidth - W, body: document.body.scrollWidth - W, shell: (document.querySelector('.shell') || {}).scrollWidth - W };
      const cp = document.querySelector('#chatPane'); const ta = document.querySelector('#input');
      const chat = view && view.id === 'view-chat' && cp && vis(cp) ? { pane: Math.round(cp.getBoundingClientRect().width), input: Math.round(ta.getBoundingClientRect().width), ratio: +(ta.getBoundingClientRect().width / cp.getBoundingClientRect().width).toFixed(2), paneOfWin: +(cp.getBoundingClientRect().width / W).toFixed(2), inputH: Math.round(ta.getBoundingClientRect().height), phOneLine: (() => { const v = ta.value; ta.value = ''; const h = ta.scrollHeight; ta.value = v; return h <= 52; })() } : null;
      return { W, rail: Math.round(document.querySelector('.rail').getBoundingClientRect().width), page, over: [...new Set(over)], xscroll: [...new Set(xs)].slice(0, 6), chat };
    })()`);
    const res = []; const prevLang = await js('state.settings.uiLang || "vi"');
    for (const l of LANGS) {
      await js(`(() => { const s = document.querySelector('#uiLangSel'); s.value = ${JSON.stringify(l)}; s.dispatchEvent(new Event('change')); return 1; })()`); await sleep(700);
      for (const w of WIDTHS) {
        win.setBounds({ x: 0, y: 0, width: w, height: 720 }); await sleep(500);
        for (const v of VIEWS) {
          await js(`show(${JSON.stringify(v)}); 1`); await sleep(450);
          const m = await measure(); const n = `layout-${l}-${w}-${v}`; await shot(n); res.push({ lang: l, w, view: v, ...m, shot: n + '.png' });
        }
        if (w <= 999) { // ngăn kéo danh sách trò chuyện
          await js('show("chat"); document.querySelector("#convosBtn").click(); 1'); await sleep(400);
          const d = await js('(() => { const c = document.querySelector("#view-chat .convos"); const r = c.getBoundingClientRect(); return { btn: getComputedStyle(document.querySelector("#convosBtn")).display, open: document.querySelector("#view-chat").classList.contains("convos-open"), w: Math.round(r.width), items: document.querySelectorAll("#convoList .convo").length }; })()');
          await shot(`layout-${l}-${w}-chat-drawer`); res.push({ lang: l, w, view: 'chat-drawer', drawer: d, shot: `layout-${l}-${w}-chat-drawer.png` });
          await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); 1'); await sleep(200);
          res.push({ lang: l, w, view: 'chat-drawer-esc', closed: await js('!document.querySelector("#view-chat").classList.contains("convos-open")') });
        }
      }
    }
    await js(`(() => { const s = document.querySelector('#uiLangSel'); s.value = ${JSON.stringify(prevLang)}; s.dispatchEvent(new Event('change')); return 1; })()`);
    fs.writeFileSync(path.join(dir, 'qalayout.json'), JSON.stringify(res, null, 2)); app.exit(0); return;
  }
  if (process.env.AIVN_QAUI_I18N) { // 0.16 i18n: duyệt mọi màn hình/thẻ cài đặt/hộp thoại ở en và zh, tìm chữ tiếng Việt còn sót; đổi về vi phải khôi phục y nguyên
    await js('document.querySelectorAll(".modal-back").forEach(m => m.hidden = true); 1');
    const scan = (tag) => js(`(() => { const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i; const SK = 'pre, code, textarea, script, style, [data-noi18n], .msg:not(.welcome) .body, .msg .think-body, [contenteditable="true"], #convoList';
      const vis = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length)); const h = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const p = n.parentElement; if (!p || p.closest(SK)) continue; const t = n.nodeValue.trim(); if (t && VI.test(t)) h.push({ at: ${JSON.stringify(tag)}, vis: vis(p), t: t.slice(0, 600) }); }
      const SKA = 'pre, code, script, style, [data-noi18n], .msg:not(.welcome) .body, .msg .think-body, #convoList';
      for (const e of document.querySelectorAll('[title],[aria-label],[data-tip],[placeholder],[alt]')) { if (e.closest(SKA)) continue; for (const k of ['title', 'aria-label', 'data-tip', 'placeholder', 'alt']) { const x = e.getAttribute(k); if (x && VI.test(x)) h.push({ at: ${JSON.stringify(tag)} + ' @' + k, vis: vis(e), t: x.slice(0, 600) }); } }
      return h; })()`);
    const snapshot = () => js('JSON.stringify([document.title, document.querySelector("#newChat") && document.querySelector("#newChat").textContent.trim(), ...[...document.querySelectorAll(".nav-item[data-view]")].map(b => [b.getAttribute("aria-label"), b.dataset.tip]), ...[...document.querySelectorAll("#setNav [data-stab]")].map(b => b.textContent.trim()), document.querySelector("#input") && document.querySelector("#input").placeholder])');
    const views = await js('[...document.querySelectorAll(".nav-item[data-view]")].map(b => b.dataset.view)');
    const stabs = await js('[...document.querySelectorAll("#setNav [data-stab]")].map(b => b.dataset.stab)');
    await js('show("chat"); 1'); await sleep(400); const viBefore = await snapshot();
    out.langs = {};
    for (const l of ['en', 'zh']) {
      const r = out.langs[l] = { hits: [], menu: null, title: null };
      await js(`(() => { const s = document.querySelector('#uiLangSel'); s.value = ${JSON.stringify(l)}; s.dispatchEvent(new Event('change')); return 1; })()`); await sleep(800);
      for (const v of views) { await js(`show(${JSON.stringify(v)}); 1`); await sleep(350); r.hits.push(...await scan(v)); if (v === 'chat' || v === 'discover' || v === 'agent') await shot(`i18n-${l}-${v}`); }
      await js('show("settings"); 1'); await sleep(300);
      for (const t of stabs) { await js(`document.querySelector('#setNav [data-stab="${t}"]').click(); 1`); await sleep(250); r.hits.push(...await scan('settings/' + t)); if (t === 'general') await shot(`i18n-${l}-settings`); }
      for (const [k, code] of [['palette', 'document.querySelector("#paletteBtn") && document.querySelector("#paletteBtn").click()'], ['keys', 'document.querySelector("#keysModal") && (document.querySelector("#keysModal").hidden = false)']]) {
        await js('show("chat"); 1'); await sleep(200); await js(`(${code}, 1)`); await sleep(300); r.hits.push(...await scan('modal/' + k));
        await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.querySelectorAll(".modal-back").forEach(m => m.hidden = true); 1'); await sleep(150);
      }
      const menu = Menu.getApplicationMenu(); r.menu = menu ? menu.items.map(i => i.label) : null;
      r.title = await js('document.title'); r.htmlLang = await js('document.documentElement.lang');
      r.liveSample = await js('[document.querySelector(\'.nav-item[data-view="discover"]\').getAttribute("aria-label"), document.querySelector("#newChat") && document.querySelector("#newChat").textContent.trim()]');
    }
    await js('(() => { const s = document.querySelector("#uiLangSel"); s.value = "vi"; s.dispatchEvent(new Event("change")); show("chat"); return 1; })()'); await sleep(800);
    out.viRestored = { before: viBefore, after: await snapshot(), same: viBefore === await snapshot(), discover: await js('document.querySelector(\'.nav-item[data-view="discover"]\').getAttribute("aria-label")'), menu: (Menu.getApplicationMenu() || { items: [] }).items.map(i => i.label) };
    fs.writeFileSync(path.join(dir, 'qai18n.json'), JSON.stringify(out, null, 2)); app.exit(0); return;
  }
  if (process.env.AIVN_QAUI_BEHAV) { // test hành vi giao diện thật (QA lượt 2: thay test chỉ dò chuỗi cho B4, B11, B12)
    await js('document.querySelectorAll(".modal-back").forEach(m => m.hidden = true); 1');
    // B4: nút “Điều khiển màn hình” khi mô hình không nhìn được màn hình
    out.b4 = await js(`(() => { const info = Object.assign({ toolsOff: [], folders: [], web: false, python: { available: true, enabled: false }, memory: { enabled: true } }, state.agent || {}, { computer: { enabled: true, screen: true, vision: false } });
      renderToolChips(info); const el = document.querySelector('#toolChips [data-chip="screen"] .tc-main'); return el ? { text: el.textContent.trim(), aria: el.getAttribute('aria-label'), cls: el.parentElement.className } : null; })()`);
    // B12: tiêu đề câu trả lời hiện tên hiển thị, không phải tên tệp
    out.b12 = await js(`(() => { state.models = [{ id: 'Qwen3-VL-2B-Instruct-Q8_0.gguf', file: 'Qwen3-VL-2B-Instruct-Q8_0.gguf', catalog: { id: 'qwen3-vl-2b', name: 'Qwen3-VL 2B Instruct' } }];
      state.current = { id: 'qa-b12', title: 'qa', mode: 'chat', messages: [{ role: 'user', content: 'chào' }, { role: 'assistant', content: 'Xin chào', model: 'Qwen3-VL-2B-Instruct-Q8_0.gguf' }, { role: 'assistant', content: 'Ừ', model: 'khong-co-trong-danh-sach.gguf' }] };
      if (typeof setMode === 'function') setMode('chat'); state.current = state.current || null; renderMessages(); return [...document.querySelectorAll('#messages .msg.assistant .who')].map(w => w.textContent.trim()); })()`);
    // B11: duyệt mọi màn hình, không chỗ nào còn “Kho mô hình” (chữ, title, aria-label, data-tip, placeholder)
    out.b11 = { nav: await js('document.querySelector(\'.nav-item[data-view="discover"]\').getAttribute("aria-label")'), hits: [] };
    for (const v of await js('[...document.querySelectorAll(".nav-item[data-view]")].map(b => b.dataset.view)')) {
      await js(`show(${JSON.stringify(v)}); 1`); await sleep(300);
      out.b11.hits.push(...await js(`(() => { const h = []; const re = /Kho m\\u00f4 h\\u00ecnh/i; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (re.test(n.nodeValue)) h.push(${JSON.stringify(v)} + ': ' + n.nodeValue.trim().slice(0, 80));
        for (const e of document.querySelectorAll('[title],[aria-label],[data-tip],[placeholder]')) for (const k of ['title', 'aria-label', 'data-tip', 'placeholder']) { const x = e.getAttribute(k); if (x && re.test(x)) h.push(${JSON.stringify(v)} + ' @' + k + ': ' + x.slice(0, 80)); } return h; })()`));
    }

    // bộ não đám mây: máy chủ giả trên máy; khoá không quay lại giao diện; thanh AIVN AGENT báo đang dùng đám mây
    { const srv = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: '1', type: 'function', function: { name: 'get_time', arguments: '{"tz":"Asia/Ho_Chi_Minh"}' } }] } }] })); });
      await new Promise(r => srv.listen(0, '127.0.0.1', r)); const u = `http://127.0.0.1:${srv.address().port}/v1`;
      await js('show("chat"); typeof setMode === "function" ? setMode("agent") : show("agent"); 1'); await sleep(800);
      await js(`(async () => { document.querySelector('#cloudBlock').open = true; document.querySelector('#cloudUrl').value = ${JSON.stringify(u)}; document.querySelector('#cloudModel').value = 'gia-lap'; document.querySelector('#cloudKey').value = 'sk-qa-SECRET-1'; await cloudSave({ enabled: true }); document.querySelector('#cloudTestBtn').click(); })()`);
      await sleep(1500); await js('refreshAgent && refreshAgent(); 1'); await sleep(1200);
      out.cloud = await js(`(async () => ({ msg: document.querySelector('#cloudMsg').textContent, keyNote: document.querySelector('#cloudKeyNote').textContent, keyField: document.querySelector('#cloudKey').value, placeholder: document.querySelector('#cloudKey').placeholder, warn: (w => w && !w.hidden ? w.innerText : null)(document.querySelector('#agentWarn')), settingsHasKey: JSON.stringify(await A.getSettings ? await A.getSettings() : state.settings).includes('sk-qa-SECRET-1') }))()`);
      out.cloud.fileHasKey = fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8').includes('sk-qa-SECRET-1');
      await js('document.querySelector("#cloudBlock").scrollIntoView(); 1'); await shot('016-cloud');
      await js('document.querySelector("#cloudClearBtn").click(); 1'); await sleep(600); out.cloudCleared = await js('A.cloudGet()'); srv.close(); }
    if (process.env.AIVN_QAUI_MM) { // Mô hình của tôi dạng bảng: sắp xếp + lọc
      await js('show("models"); 1'); await sleep(1500);
      const rows = () => js('[...document.querySelectorAll("#modelTable .tr[data-id]")].map(r => r.querySelector("b").textContent + " | " + [...r.children].slice(1, 6).map(c => c.innerText.replace(/\\s+/g, " ")).join(" | "))');
      out.mm = { head: await js('[...document.querySelectorAll("#modelTable .tr.head > *")].map(x => x.textContent)'), rows: await rows() };
      await shot('016-mymodels');
      await js('document.querySelector(\'#modelTable [data-sort="size"]\').click(); 1'); out.mm.bySizeDesc = await js('[...document.querySelectorAll("#modelTable .tr[data-id]")].map(r => r.dataset.id)');
      await js('document.querySelector(\'#modelTable [data-sort="size"]\').click(); 1'); out.mm.bySizeAsc = await js('[...document.querySelectorAll("#modelTable .tr[data-id]")].map(r => r.dataset.id)');
      out.mm.sizes = await js('Object.fromEntries(state.models.map(m => [m.id, m.size]))');
      await js('document.querySelector("#mmKind").value = "vision"; document.querySelector("#mmKind").dispatchEvent(new Event("change")); 1'); out.mm.vision = await rows();
      await js('document.querySelector("#mmKind").value = ""; document.querySelector("#mmFilter").value = "qwen3 0.6"; document.querySelector("#mmFilter").dispatchEvent(new Event("input")); 1'); out.mm.filtered = await rows(); out.mm.count = await js('document.querySelector("#mmCount").textContent');
    }
    { // Máy chủ API: CORS, khoá, LAN (hộp xác nhận), TTL — bấm thật trên giao diện, gọi API thật
      await js('show("server"); 1'); await sleep(900);
      const sv = () => js('({ lan: document.querySelector("#srvLan").checked, cors: document.querySelector("#srvCors").checked, ttl: document.querySelector("#srvTtl").value, keyState: document.querySelector("#srvKeyState").textContent, keyShown: !document.querySelector("#srvKeyShow").hidden, keyLen: document.querySelector("#srvKeyShow").textContent.length, curl: document.querySelector("#curlEx").textContent, urls: document.querySelector("#srvLanUrls").textContent, loaded: document.querySelector("#srvLoaded").textContent })');
      out.server = { start: await sv() };
      await js('document.querySelector("#srvCors").click(); 1'); await sleep(500);
      await js('document.querySelector("#srvTtl").value = "15"; document.querySelector("#srvTtl").dispatchEvent(new Event("change")); 1'); await sleep(500);
      await js('document.querySelector("#srvKeyGen").click(); 1'); await sleep(800); out.server.afterKey = await sv();
      out.server.publicHasKey = await js('A.getSettings().then(s => "apiKey" in s)');
      await js('A.startServer(Number(document.querySelector("#srvPort").value) || 1234).then(paintServer)'); await sleep(500);
      await js('document.querySelector("#srvLan").click(); 1'); await sleep(500); out.server.lanModal = await js('!document.querySelector("#confirmModal").hidden && document.querySelector("#cfTitle").textContent');
      await js('document.querySelector("#cfYes").click(); 1'); await sleep(1500); out.server.afterLan = await sv(); out.server.status = await js('A.serverStatus()');
      if (out.server.status.running) { const port = out.server.status.port; const k = settings.data.apiKey;
        out.server.noKey = (await fetch(`http://127.0.0.1:${port}/v1/models`)).status; out.server.withKey = (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: 'Bearer ' + k } })).status;
        out.server.acao = (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: 'Bearer ' + k } })).headers.get('access-control-allow-origin'); }
      await js('document.querySelector("#srvLan").scrollIntoView(); 1'); await shot('016-server');
      await js('document.querySelector("#srvKeyClear").click(); 1'); await sleep(600); out.server.clearWhileLan = await sv();
      await js('document.querySelector("#srvLan").click(); 1'); await sleep(1500); await js('document.querySelector("#srvKeyClear").click(); 1'); await sleep(600); out.server.end = await sv(); out.server.endStatus = await js('A.serverStatus()');
      await js('A.stopServer(); 1');
    }
    out.views = await js('[...document.querySelectorAll(".nav-item[data-view]")].map(b => b.dataset.view)');
    fs.writeFileSync(path.join(dir, 'behav.json'), JSON.stringify(out, null, 2)); app.exit(0); return;
  }
  if (process.env.AIVN_QAUI_151) { // QA 0.15.1: điều hướng, thông báo, biểu mẫu
    await js('document.querySelectorAll(".modal-back").forEach(m => m.hidden = true)');
    const st = async (n) => { await shot(n); out[n] = await js(`({ toasts: [...document.querySelectorAll(".toast-stack .toast-item")].map(t => (t.classList.contains("err") ? "ERR " : "") + t.textContent.replace("×", "").trim()), crmNav: [...document.querySelectorAll("[data-crm-nav]")].map(e => getComputedStyle(e).display), active: document.querySelector(".view.active")?.id })`); };
    for (const th of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme = "${th}"`);
      await js('show("chat")'); await st(`151-nav-${th}`);
      await js(`toast("Đã lưu cài đặt"); toast("Đã sao chép nhật ký"); toast("Đã thêm thư mục tài liệu"); toast("Đã tải xong mô hình Qwen3 4B"); toast("Bộ máy AI không khởi động được (mã 1): Error: Cannot find module './agent/sampling'", true)`);
      await st(`151-toast-stack-${th}`);
      await js('show("discover")'); await st(`151-toast-after-nav-${th}`);
      await js('document.querySelectorAll(".toast-stack .toast-item button").forEach(b => b.click())');
      await js('show("schedule")'); await st(`151-form-schedule-${th}`);
      await js('show("memory")'); await st(`151-form-memory-${th}`);
      await js('show("security")'); await st(`151-form-security-${th}`);
      await js('{ show("agent"); const m = document.querySelector("#mcpBlock"); if (m) { m.open = true; m.scrollIntoView(); } }'); await st(`151-form-mcp-${th}`);
      await js('toast("Thông báo ngắn")'); await sleep(4200); out[`autodismiss-info-${th}`] = await js('document.querySelectorAll(".toast-stack .toast-item").length');
      await js('toast("Lỗi thử", true)'); await sleep(5000); out[`err-at-5s-${th}`] = await js('document.querySelectorAll(".toast-stack .toast-item").length'); await sleep(5600); out[`err-at-10.6s-${th}`] = await js('document.querySelectorAll(".toast-stack .toast-item").length');
    }
    out.inputs = await js(`[...document.querySelectorAll("input[type=text],input:not([type]),input[type=number],input[type=password],textarea")].filter(e => e.offsetParent).map(e => { const c = getComputedStyle(e); return { id: e.id, border: c.borderTopWidth + " " + c.borderTopStyle, bg: c.backgroundColor }; })`);
    out.english = await js(`(() => { const W = /\\b(Save|Cancel|Open|Close|Delete|Settings|Loading|Error|Submit|Search|Add|Edit)\\b/; const hits = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const t = n.textContent.trim(); if (t && W.test(t) && !/^(MCP|API|GPU|CPU|RAM|VRAM)/.test(t)) hits.push(t.slice(0, 80)); } document.querySelectorAll("[placeholder],[title],[aria-label]").forEach(e => { for (const a of ["placeholder", "title", "aria-label"]) { const v = e.getAttribute(a); if (v && W.test(v)) hits.push(a + ": " + v.slice(0, 80)); } }); return hits; })()`);
    fs.writeFileSync(path.join(dir, 'qa151.json'), JSON.stringify(out, null, 2)); app.exit(0); return;
  }
  await js('document.querySelectorAll(".modal-back").forEach(m => m.hidden = true)');
  await js(`(async () => { const C = async (fn, ...a) => { const r = await A.crm(fn, ...a); if (!r.ok) throw new Error(fn + ': ' + r.error); return r.data; };
    if ((await C('listContacts', {})).total) return;
    const a = await C('saveContact', { name: 'Trần Quỳnh Anh', phone: '0912345678', email: 'quynhanh@example.vn', tags: 'VIP, Hà Nội', job_title: 'Giám đốc mua hàng' });
    const b = await C('saveContact', { name: 'Công ty TNHH Sen Vàng', kind: 'company', phone: '02838123456', email: 'lienhe@senvang.vn', tags: 'Đại lý' });
    const d = await C('saveContact', { name: 'Lê Minh Tuấn', phone: '0987654321', email: 'tuan.le@example.vn', tags: 'Khách lẻ' });
    await C('saveLead', { title: 'Gói phần mềm 20 máy', contact_id: b.id, expected_revenue: 45000000, stage: 'quoted' });
    await C('saveLead', { title: 'Đơn hàng quý IV', contact_id: a.id, expected_revenue: 120000000, stage: 'negotiation' });
    await C('saveLead', { title: 'Tư vấn lắp đặt', contact_id: d.id, expected_revenue: 8000000, stage: 'new' });
    await C('saveLead', { title: 'Hợp đồng bảo trì', contact_id: b.id, expected_revenue: 15000000, stage: 'won' });
    await C('saveActivity', { title: 'Gọi lại chị Quỳnh Anh về báo giá', type: 'call', contact_id: a.id, due_at: Date.now() + 3600e3 });
    await C('saveActivity', { title: 'Gửi hợp đồng cho Sen Vàng', type: 'email', contact_id: b.id, due_at: Date.now() - 86400e3 });
  })()`).catch(e => { out.seed = e.message; });
  await step('01-crm-tong-quan', 'show("crm"); crm.tab = "dash"; renderCrm()');
  await step('02-crm-lien-he', 'crm.tab = "contacts"; renderCrm()');
  await step('03-crm-co-hoi', 'crm.tab = "leads"; renderCrm()');
  await step('04-crm-viec', 'crm.tab = "acts"; renderCrm()');
  await step('05-crm-form', 'crmForm("contact", {})');
  await js('document.querySelector("#crmModal").hidden = true');
  await step('06-crm-trong', 'crm.tab = "contacts"; document.querySelector("#crmQ").value = "không-có-ai"; renderCrm()');
  await js('document.querySelector("#crmQ").value = ""');
  await step('07-agent-mcp', 'show("agent"); const m = document.querySelector("#mcpBlock"); m.open = true; m.scrollIntoView()');
  await step('08-agent-perf', 'document.querySelector("#perfBox") && document.querySelector("#perfBox").scrollIntoView()');
  await step('09-agent-bench', 'document.querySelector("#benchBox") && (document.querySelector("#benchBox").closest("details") ? document.querySelector("#benchBox").closest("details").open = true : 0, document.querySelector("#benchBox").scrollIntoView())');
  const AP = require('./agent/approval');
  const kf = path.join(require('os').tmpdir(), 'ke-hoach-tuan.md'); fs.writeFileSync(kf, '# Kế hoạch tuần\n- Thứ Hai: họp nhóm 8h\n- Thứ Ba: nộp báo cáo\n');
  const card = AP.buildCard('write_file', { path: kf, content: '# Kế hoạch tuần\n- Thứ Hai: họp nhóm 9h\n- Thứ Ba: nộp báo cáo\n- Thứ Tư: ôn thi Toán rời rạc\n' }, { label: 'Ghi tệp', icon: '📝', resolvePath: (p) => ({ full: p }) });
  send('agent:approve', { id: 'qa-card', ...card });
  await step('10-the-xin-phep');
  await step('11-the-xin-phep-ly-do', 'const b = [...document.querySelectorAll("#approveCard button")].find(x => /lý do/i.test(x.textContent)); b && b.click()');
  await js('document.querySelector("#approveCard").hidden = true');
  await step('12-bang-lenh', 'openPalette()');
  await js('document.querySelector("#palette").hidden = true');
  await step('13-phim-tat', 'openKeys()');
  await js('document.querySelector("#keysModal").hidden = true');
  await step('14-thu-gon-panel', 'togglePanel(true)');
  await js('togglePanel(false)');
  await step('15-kho-mo-hinh', 'show("discover")');
  await step('16-mo-hinh-cua-toi', 'show("models")');
  fs.writeFileSync(path.join(dir, 'qaui.json'), JSON.stringify(out, null, 2)); app.quit();
}

// QA 0.14.4 (AIVN_QA144=thư mục, chỉ khi phát triển): bộ máy sập giữa lượt → tự phục hồi; thẻ lỗi có nút nhật ký; chống bấm đúp Gửi→Dừng; quét ứng dụng; tệp nhật ký
// QA 0.16 (AIVN_QA_DESK016=thư mục, chỉ khi phát triển): bấm ô + dán + Enter trong MỘT bước (submit), chữ có xuống dòng cuối = Enter,
// thẻ xin phép đánh dấu bước gửi, và kiểm chứng gửi chạy sau đó. Cửa sổ thử là một ô nhập: Enter → ghi "SENT:<chữ>".
async function qaDesk016() {
  const dir = process.env.AIVN_QA_DESK016; fs.mkdirSync(dir, { recursive: true });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {}; const save = () => fs.writeFileSync(path.join(dir, 'qadesk016.json'), JSON.stringify(out, null, 2));
  const html = '<!doctype html><meta charset="utf-8"><title>AIVN Test Chat</title><body style="font:20px sans-serif"><input id="i" aria-label="Soạn tin" style="font-size:22px;width:90%" autofocus><pre id="log"></pre><script>i.addEventListener("keydown",e=>{if(e.key==="Enter"){log.textContent+="SENT:"+i.value+"\\n";i.value=""}})</script>';
  const t = new BrowserWindow({ x: 60, y: 60, width: 900, height: 420, show: true, title: 'AIVN Test Chat', webPreferences: { contextIsolation: true } });
  await t.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); t.focus(); t.webContents.focus(); await sleep(600);
  const d = getDesk(); const ctx = { signal: new AbortController().signal, userQuery: 'nhắn "xin chào Lan" cho Lan', confirm: async () => true };
  const logOf = () => t.webContents.executeJavaScript('document.querySelector("#log").textContent');
  const focusIn = async () => { t.focus(); t.webContents.focus(); await t.webContents.executeJavaScript('document.querySelector("#i").focus()'); await sleep(300); };
  try {
    await focusIn(); qaAsks.length = 0;
    const r1 = await d.act({ action: 'type_text', text: 'xin chào Lan', submit: true }, ctx); await sleep(500);
    out.submit = { log: await logOf(), asks: qaAsks.slice(), summary: r1.summary, verify: r1.verify || null, forModel: String(r1.forModel || '').slice(0, 400) };
    await focusIn(); qaAsks.length = 0;
    const r2 = await d.act({ action: 'type_text', text: 'hẹn gặp lúc 7 giờ\n' }, ctx); await sleep(500);
    out.newline = { log: await logOf(), asks: qaAsks.slice(), summary: r2.summary };
    await focusIn(); qaAsks.length = 0;
    const r3 = await d.act({ action: 'type_text', text: 'chưa gửi' }, ctx); await sleep(400);
    out.plain = { log: await logOf(), value: await t.webContents.executeJavaScript('document.querySelector("#i").value'), asks: qaAsks.slice(), summary: r3.summary };
    // đoạn dài nhiều dòng tiếng Việt: dán MỘT lần, giữ nguyên dấu
    await t.webContents.executeJavaScript('document.querySelector("#i").value = ""'); await focusIn();
    const long = 'Chào cả nhà, tuần này họp nhóm lúc 19 giờ thứ Năm ở thư viện tầng 3. Nhớ mang báo cáo tiến độ, ảnh chụp màn hình và câu hỏi cho thầy hướng dẫn nhé!';
    const t0 = Date.now(); const r4 = await d.act({ action: 'type_text', text: long }, ctx);
    out.long = { ms: Date.now() - t0, exact: (await t.webContents.executeJavaScript('document.querySelector("#i").value')) === long, value: await t.webContents.executeJavaScript('document.querySelector("#i").value'), summary: r4.summary };
    // 0.16 “Tự làm không hỏi” (bật bằng câu trong yêu cầu): gõ thường không hỏi; gửi đúng tin người dùng nêu không hỏi; gửi chữ khác vẫn hỏi
    const actx = { ...ctx, userQuery: 'nhắn "xin chào Lan" cho Lan, không cần hỏi lại', auto: require('./agent/autonomy').forTurn({ setting: false, query: 'nhắn "xin chào Lan" cho Lan, không cần hỏi lại' }) };
    await t.webContents.executeJavaScript('document.querySelector("#i").value = ""; document.querySelector("#log").textContent = ""'); await focusIn(); qaAsks.length = 0;
    const a1 = await d.act({ action: 'type_text', text: 'gõ thử' }, actx); out.autoPlain = { asks: qaAsks.length, auto: a1.auto || null };
    await t.webContents.executeJavaScript('document.querySelector("#i").value = ""'); await focusIn(); qaAsks.length = 0;
    const a2 = await d.act({ action: 'type_text', text: 'xin chào Lan', submit: true }, actx); await sleep(500); out.autoSendNamed = { asks: qaAsks.length, log: await logOf(), auto: a2.auto || null };
    await focusIn(); qaAsks.length = 0;
    await d.act({ action: 'type_text', text: 'chào Lan, mai đi chơi không?', submit: true }, actx); await sleep(500); out.autoSendOther = { asks: qaAsks.length, risk: qaAsks[0] ? qaAsks[0].risk : null, log: await logOf() };
  } catch (e) { out.error = e.stack || String(e); }
  try { d.end('qa'); } catch {}
  save(); app.exit(0);
}
// QA B21 (lượt 3, AIVN_QA_B21=thư mục, chỉ khi phát triển): Messenger giả, chat SAI (“Nhóm Lớp K27”) đang mở sẵn và ô soạn đang được chọn.
// Lặp lại đúng các lời gọi của lượt h1 (gõ tên người nhận + Enter “vào” cụm chữ / vào ô đang chọn) → KHÔNG được gửi gì;
// rồi cách đúng: bấm ô Tìm kiếm → gõ tên + Enter (là TÌM, không phải bước rủi ro) → bấm kết quả → gõ tin + Enter → gửi đúng người.
async function qaB21() {
  const dir = process.env.AIVN_QA_B21; fs.mkdirSync(dir, { recursive: true });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = { steps: [] }; const save = () => fs.writeFileSync(path.join(dir, 'qab21.json'), JSON.stringify(out, null, 2));
  // B27 (QA lượt 4): AIVN_QA_B21_MODE=telegram — Telegram giả, “Trần Quỳnh Như” (bẫy) mở sẵn; tiêu đề cửa sổ “Telegram - <tên>”
  const tg = ['telegram', 'openchat', 'b69'].includes(process.env.AIVN_QA_B21_MODE); const APP = tg ? 'Telegram' : 'Messenger';
  const html0 = `<!doctype html><meta charset="utf-8"><title>Nhóm Lớp K27 | Messenger</title>
<style>body{margin:0;font:22px sans-serif;display:grid;grid-template-columns:340px 1fr;height:100vh}#left{border-right:1px solid #ccc;padding:10px}#search{width:300px;font-size:22px;padding:6px}
.it{padding:14px 8px;cursor:pointer}#right{display:flex;flex-direction:column}#hdr{font-weight:bold;padding:16px;border-bottom:1px solid #ccc}#msgs{flex:1;padding:16px}#comp{font-size:22px;margin:12px;padding:8px}</style>
<div id="left"><input id="search" aria-label="Tìm kiếm trên Messenger" placeholder="Tìm kiếm trên Messenger"><div id="list"></div></div>
<div id="right"><div id="hdr"></div><div id="msgs"></div><input id="comp" aria-label="Aa" placeholder="Aa"></div>
<script>
const chats = ['Nhóm Lớp K27', 'Trần Quỳnh Anh', 'Lê Quỳnh Anh']; window.S = { cur: 'Nhóm Lớp K27', sent: [], searches: [] };
const fold = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
function list(f) { const el = document.getElementById('list'); el.innerHTML = ''; for (const c of chats.filter(c => !f || fold(c).includes(fold(f)))) { const d = document.createElement('div'); d.className = 'it' + (c === S.cur ? ' sel' : ''); d.textContent = c; d.onclick = () => open(c); el.appendChild(d); } }
function open(c) { S.cur = c; document.getElementById('hdr').textContent = c; document.title = c + ' | Messenger'; document.getElementById('msgs').innerHTML = ''; document.getElementById('search').value = ''; list(''); document.getElementById('comp').focus(); }
document.getElementById('comp').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) { S.sent.push({ to: S.cur, text: e.target.value }); const b = document.createElement('div'); b.textContent = e.target.value; document.getElementById('msgs').appendChild(b); e.target.value = ''; } });
document.getElementById('search').addEventListener('input', e => list(e.target.value));
document.getElementById('search').addEventListener('keydown', e => { if (e.key === 'Enter') { S.searches.push(e.target.value); list(e.target.value); } });
list(''); open('Nhóm Lớp K27');
</script>`;
  const html = ['k1', 'b64slow'].includes(process.env.AIVN_QA_B21_MODE) ? html0.replace('<input id="search"', '<label for="search" style="display:block;font-weight:bold;padding:4px 0">Tìm kiếm trên Messenger</label><input id="search"') : !tg ? html0 : html0.replace('<input id="search"', '<label for="search" style="display:block;font-weight:bold;padding:4px 0">Tìm kiếm</label><input id="search"').replace('<title>Nhóm Lớp K27 | Messenger</title>', '<title>Telegram - Trần Quỳnh Như</title>').replace(/Tìm kiếm trên Messenger/g, 'Tìm kiếm')
    .replace("const chats = ['Nhóm Lớp K27', 'Trần Quỳnh Anh', 'Lê Quỳnh Anh']", "const chats = ['Trần Quỳnh Như', 'Nhóm Lớp K27', 'Trần Quỳnh Anh']")
    .replace("document.title = c + ' | Messenger'", "document.title = 'Telegram - ' + c").replace("list(''); open('Nhóm Lớp K27');", "list(''); open('Trần Quỳnh Như');");
  const t = new BrowserWindow({ x: 40, y: 40, width: 1000, height: 600, show: true, title: APP, webPreferences: { contextIsolation: true } });
  await t.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); t.focus(); t.webContents.focus(); await sleep(700);
  const st = () => t.webContents.executeJavaScript('JSON.parse(JSON.stringify(S))');
  // B24: AIVN_QA_B21_MODE=draft (chạy cùng AIVN_DESK_AUTO=safe): “chỉ soạn, đừng gửi” — mọi bước rủi ro bị từ chối; gõ tên + Enter ở ô tìm kiếm vẫn phải được làm
  const draft = process.env.AIVN_QA_B21_MODE === 'draft'; out.mode = draft ? 'draft' : 'auto';
  const q = process.env.AIVN_QA_B21_MODE === 'b69' ? 'Nhắn tin cho Trần Quỳnh Anh trên Telegram: "Gửi mình file slide nhé"' : tg ? 'Nhắn tin cho Trần Quỳnh Anh trên Telegram: "Gửi mình file slide nhé". Không cần hỏi lại.' : draft ? 'Nhắn tin cho Trần Quỳnh Anh trên Messenger: "Mai 8h họp nhóm nhé". Chỉ soạn sẵn, đừng gửi.' : 'Nhắn tin cho Trần Quỳnh Anh trên Messenger: "Mai 8h họp nhóm nhé". Không cần hỏi lại.';
  const ctx = { signal: new AbortController().signal, userQuery: q, confirm: async () => true, auto: require('./agent/autonomy').forTurn({ setting: false, query: q }) };
  const d = getDesk();
  const step = async (name, a) => { qaAsks.length = 0; let r; try { r = await d.act(a, ctx); } catch (e) { r = { error: String(e.message || e) }; } await sleep(700);
    const s = await st(); out.steps.push({ name, call: a, summary: r.summary || r.error || '', blocked: !!(r.error || r.refused), forModel: String(r.forModel || '').slice(0, 2500), asks: qaAsks.slice(), state: s }); save(); return { r, s }; };
  try {
    if (process.env.AIVN_QA_B21_MODE === 'k1') { // B34 (QA lượt 5, k1): bấm ô Tìm kiếm → type_text kèm id CŨ nay là chữ “Nhóm Lớp K27” → vẫn phải gõ vào ô tìm kiếm
      const l0 = String((await d.look({ window: 'Messenger' }, ctx)).forModel || ''); out.look0 = l0.slice(0, 1500);
      await step('k1-click-search', { action: 'click', element: 'Tìm kiếm trên Messenger' });
      const l1 = String((await d.look({}, ctx)).forModel || ''); const idK27 = (l1.match(/\[(e\d+)\][^\n]*"Nhóm Lớp K27"/) || [])[1]; out.idK27 = idK27;
      await step('k1-type-stale', { action: 'type_text', element: idK27 || 'Nhóm Lớp K27', text: 'Trần Quỳnh Anh', submit: true });
      await step('k1-click-result', { action: 'click', element: 'Trần Quỳnh Anh' });
      await step('k1-send', { action: 'type_text', text: 'Mai 8h họp nhóm nhé', submit: true });
      out.final = await st(); throw null;
    }
    if (process.env.AIVN_QA_B21_MODE === 'b69') { // B69/B70: KHÔNG có câu “không cần hỏi lại” → bước gửi phải hỏi; gửi xong không bao giờ gửi lại
      await step('b69-open', { action: 'open_chat', window: 'Telegram' });
      await step('b69-send', { action: 'type_text', text: 'Gửi mình file slide nhé', submit: true });
      await step('b70-resend', { action: 'type_text', text: 'Gửi mình file slide nhé', submit: true });
      await step('b70-enter', { action: 'hotkey', keys: 'enter' });
      await step('b70-click-send', { action: 'click', element: 'Gửi' });
      out.final = await st(); throw null;
    }
    if (process.env.AIVN_QA_B21_MODE === 'b76') { // B76 (QA lượt 8, Outlook o10): nội dung thư bị gõ vào ô Tiêu đề 3 lần (id đổi theo chữ trong ô)
      const ol = `<!doctype html><meta charset=utf-8><title>Thư mới - Outlook</title><style>body{font:16px sans-serif;margin:20px}input,textarea{display:block;width:700px;font:26px sans-serif;margin:18px 0;padding:10px;border:1px solid #888}textarea{height:220px}::placeholder{color:#222;opacity:1}</style>
<input id=to placeholder="Người nhận"><input id=subj placeholder="Thêm tiêu đề"><textarea id=body placeholder="Nhập nội dung thư tại đây"></textarea>
<script>window.S={};function benchRead(){return {to:to.value,subj:subj.value,body:body.value}}</script>`;
      await t.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(ol)); t.focus(); t.webContents.focus(); await sleep(600);
      const st2 = () => t.webContents.executeJavaScript('benchRead()');
      const q3 = 'Soạn thư Outlook gửi quynhanh.tran@truong.edu.vn, tiêu đề "Lịch họp nhóm", nội dung "Nhóm mình họp lúc 8h sáng thứ Năm nhé." Chỉ soạn, đừng gửi.';
      const c3 = { ...ctx, userQuery: q3, auto: require('./agent/autonomy').forTurn({ setting: false, query: q3 }) };
      const step3 = async (name, a) => { qaAsks.length = 0; let r; try { r = await d.act(a, c3); } catch (e) { r = { error: String(e.message || e) }; } await sleep(500);
        out.steps.push({ name, call: a, summary: r.summary || r.error || '', blocked: !!(r.error || r.refused), forModel: String(r.forModel || '').slice(0, 2500), state: await st2() }); save(); return r; };
      await d.look({ window: 'Outlook' }, c3);
      await step3('b76-click-subject', { action: 'click', element: 'Thêm tiêu đề' });
      await step3('b76-type-subject', { action: 'type_text', text: 'Lịch họp nhóm' });
      const l = String((await d.look({}, c3)).forModel || ''); out.look1 = l.slice(0, 1500);
      const sid = (l.match(/\[(e\d+)\][^\n]*"L\S{1,2}ch h\S{1,2}p[^"\n]*"/u) || [])[1]; out.subjId = sid || null;
      await step3('b76-type-body-into-subject', { action: 'type_text', element: sid || 'Lịch họp nhóm', text: 'Nhóm mình họp lúc 8h sáng thứ Năm nhé.' });
      await step3('b76-type-subject-again', { action: 'type_text', text: 'Lịch họp nhóm' });
      await step3('b76-click-body', { action: 'click', element: 'Nhập nội dung thư tại đây' });
      await step3('b76-type-body', { action: 'type_text', text: 'Nhóm mình họp lúc 8h sáng thứ Năm nhé.' });
      out.final = await st2(); throw null;
    }
    if (process.env.AIVN_QA_B21_MODE === 'b64slow') { // B64 (QA lượt 8, d10/zen): máy chậm — kiểm tra lại sau khi bấm mất > 60 giây; gõ tên KHÔNG kèm element ngay sau đó vẫn phải được coi là gõ vào ô tìm kiếm
      const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew; out.skews = [];
      const untap = LOG.tap((line, scope) => { if (scope === 'desk' && /Thao tác: bấm/.test(line) && out.skewNext) { out.skewNext = false; skew += 90000; out.skews.push(line.slice(0, 120)); } });
      out.look0 = String((await d.look({ window: 'Messenger' }, ctx)).forModel || '').slice(0, 1500);
      out.skewNext = true; await step('b64-click-search', { action: 'click', element: 'Tìm kiếm trên Messenger' });
      await t.webContents.executeJavaScript('document.activeElement && document.activeElement.blur && 0'); // giữ nguyên tiêu điểm
      await step('b64-type-name', { action: 'type_text', text: 'Trần Quỳnh Anh', submit: true });
      out.skewNext = true; const hit = ((out.steps[out.steps.length - 1] || {}).forModel || '').match(/click element "(e\d+)"/);
      await step('b64-click-result', { action: 'click', element: hit ? hit[1] : 'Trần Quỳnh Anh' });
      await step('b64-send', { action: 'type_text', text: 'Mai 8h họp nhóm nhé', submit: true });
      // đường Ctrl+F (dòng 625 cũ): ứng dụng mở ô tìm bằng phím tắt, máy chậm
      await t.webContents.executeJavaScript(`document.addEventListener('keydown', e => { if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); document.getElementById('search').focus(); } }, true); 1`);
      try { d.end('qa'); } catch {} const q2 = 'Nhắn tin cho Lê Quỳnh Anh trên Messenger: "Gửi mình file slide nhé". Không cần hỏi lại.';
      const ctx2 = { ...ctx, userQuery: q2, auto: require('./agent/autonomy').forTurn({ setting: false, query: q2 }) };
      const step2 = async (name, a) => { qaAsks.length = 0; let r; try { r = await d.act(a, ctx2); } catch (e) { r = { error: String(e.message || e) }; } await sleep(700);
        const s = await st(); out.steps.push({ name, call: a, summary: r.summary || r.error || '', blocked: !!(r.error || r.refused), forModel: String(r.forModel || '').slice(0, 2500), asks: qaAsks.slice(), state: s }); save(); return { r, s }; };
      t.focus(); t.webContents.focus(); await sleep(400); await d.look({ window: 'Messenger' }, ctx2);
      out.skewKeyNext = true; const untap2 = LOG.tap((line, scope) => { if (scope === 'desk' && /Thao tác: bấm phím/.test(line) && out.skewKeyNext) { out.skewKeyNext = false; skew += 90000; out.skews.push(line.slice(0, 120)); } });
      await step2('b64k-hotkey', { action: 'hotkey', keys: 'ctrl+f' });
      out.afterKey = await t.webContents.executeJavaScript(`({ active: document.activeElement && document.activeElement.id, hasFocus: document.hasFocus(), search: document.getElementById('search').value, comp: document.getElementById('comp').value })`);
      await step2('b64k-type-name', { action: 'type_text', text: 'Lê Quỳnh Anh', submit: true });
      out.afterType = await t.webContents.executeJavaScript(`({ active: document.activeElement && document.activeElement.id, search: document.getElementById('search').value, comp: document.getElementById('comp').value })`);
      const hit2 = ((out.steps[out.steps.length - 1] || {}).forModel || '').match(/click element "(e\d+)"/);
      await step2('b64k-click-result', { action: 'click', element: hit2 ? hit2[1] : 'Lê Quỳnh Anh' });
      await step2('b64k-send', { action: 'type_text', text: 'Gửi mình file slide nhé', submit: true });
      try { untap && untap(); untap2 && untap2(); } catch {} Date.now = realNow; out.final = await st(); throw null;
    }
    if (process.env.AIVN_QA_B21_MODE === 'openchat') { // B65: open_chat bằng mã — mô hình đưa tên sai/nội dung, AIVN vẫn tìm đúng “Trần Quỳnh Anh”, rồi chỉ gõ nội dung
      await step('oc-open', { action: 'open_chat', window: 'Telegram', recipient: 'Gửi mình file slide nhé' });
      await step('oc-send', { action: 'type_text', text: 'Gửi mình file slide nhé', submit: true });
      out.final = await st(); throw null;
    }
    if (tg) { out.look0 = String((await d.look({ window: 'Telegram' }, ctx)).forModel || '').slice(0, 1500);
      // đúng chuỗi của lượt t1: bấm Tìm kiếm → gõ tên + Enter → một thao tác khác → bấm kết quả theo TÊN → gõ tin
      await step('tg-before-open', { action: 'type_text', text: 'Gửi mình file slide nhé', submit: true });
      await step('tg-click-search', { action: 'click', element: 'Tìm kiếm' });
      await step('tg-type-search', { action: 'type_text', text: 'Trần Quỳnh Anh', submit: true });
      await step('tg-other', { action: 'hotkey', keys: 'end' });
      await step('tg-click-trap', { action: 'click', element: 'Trần Quỳnh Như' });
      await step('tg-send-trap', { action: 'type_text', text: 'Gửi mình file slide nhé', submit: true });
      out.afterBad = await st();
      await step('tg-click-search-2', { action: 'click', element: 'Tìm kiếm' });
      await step('tg-type-search-2', { action: 'type_text', text: 'Trần Quỳnh Anh', submit: true, replace: true });
      await step('tg-other-2', { action: 'hotkey', keys: 'end' });
      await step('tg-click-result', { action: 'click', element: 'Trần Quỳnh Anh' });
      await step('tg-send', { action: 'type_text', text: 'Gửi mình file slide nhé', submit: true });
      out.final = await st(); throw null;
    }
    await t.webContents.executeJavaScript('document.getElementById("comp").focus()'); await sleep(300);
    // h1: lời gọi sai y hệt QA (element là cụm chữ tên người nhận, submit) — hai lần
    await step('h1-element-name', { action: 'type_text', element: 'Trần Quỳnh Anh', text: 'Trần Quỳnh Anh', submit: true });
    await step('h1-element-name-2', { action: 'type_text', element: 'Trần Quỳnh Anh', text: 'Trần Quỳnh Anh', submit: true });
    // gõ tên vào ô đang chọn (ô soạn của chat sai) — không có element
    await t.webContents.executeJavaScript('document.getElementById("comp").focus()'); await sleep(200);
    await step('focused-composer-name', { action: 'type_text', text: 'Tran Quynh Anh', submit: true });
    // gõ TIN vào chat sai khi chưa mở người nhận
    await step('message-before-open', { action: 'type_text', text: 'Mai 8h họp nhóm nhé', submit: true });
    out.afterBad = await st();
    // cách đúng
    await step('click-search', { action: 'click', element: 'Tìm kiếm trên Messenger' });
    await step('type-search', { action: 'type_text', text: 'Trần Quỳnh Anh', submit: true });
    const look = await d.look({ query: 'Trần Quỳnh Anh' }, ctx); out.lookAfterSearch = String(look.forModel || '').slice(0, 1500);
    const hitId = ((out.steps.find(x => x.name === 'type-search') || {}).forModel || '').match(/click element "(e\d+)"/); out.hitId = hitId ? hitId[1] : null;
    await step('click-result', { action: 'click', element: out.hitId || 'Trần Quỳnh Anh' });
    await step('send-message', { action: 'type_text', text: 'Mai 8h họp nhóm nhé', submit: true });
    out.final = await st();
  } catch (e) { if (e !== null) out.error = e.stack || String(e); }
  try { d.end('qa'); } catch {}
  save(); app.exit(0);
}
// T1a (máy thật của Khôi: 2560×1440, 125%): Zalo GIẢ — tiêu đề cửa sổ luôn là “Zalo” (mở chat khác không đổi tiêu đề), chat “Nguyễn Ngọc Khôi” mở sẵn,
// chữ “Tìm kiếm” chỉ là chữ (bấm không có gì) — ô tìm kiếm thật mở bằng Ctrl+F như Zalo. AIVN_FAKE_INPUT_SCALE giả lập luồng chuột không nhận DPI.
// Ghi lại mọi cú bấm (toạ độ trong trang) để kiểm tra bấm TRÚNG phần tử.
async function qaZaloDpi() {
  const dir = process.env.AIVN_QA_ZALO_DPI; fs.mkdirSync(dir, { recursive: true });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = { steps: [] }; const save = () => fs.writeFileSync(path.join(dir, 'zalo-dpi.json'), JSON.stringify(out, null, 2));
  const html = `<!doctype html><meta charset="utf-8"><title>Zalo</title>
<style>body{margin:0;font:22px sans-serif;display:grid;grid-template-columns:360px 1fr;height:100vh}#left{border-right:1px solid #ccc;padding:10px}#fakesearch{padding:8px;color:#555;background:#eef0f1;border-radius:6px;user-select:none}
#search{display:none;width:310px;font-size:22px;padding:6px}.it{padding:16px 8px;cursor:pointer}.it.sel{background:#cfe3ff}#right{display:flex;flex-direction:column}#hdr{font-weight:bold;padding:16px;border-bottom:1px solid #ccc;background:#f7f9fa}#msgs{flex:1;padding:16px}#comp{font-size:22px;margin:12px;padding:8px}</style>
<div id="left"><div id="fakesearch">Tìm kiếm</div><input id="search" placeholder="Nhập tên nhóm"><div id="list"></div></div>
<div id="right"><div id="hdr"></div><div id="msgs"></div><input id="comp" placeholder="Nhập tin nhắn"></div>
<script>
const chats = ['Nguyễn Ngọc Khôi', 'AIVN test', 'Lớp K27 VLU']; window.S = { cur: '', sent: [], clicks: [], keys: [] };
const fold = (x) => x.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
document.addEventListener('mousedown', e => { const el = document.elementFromPoint(e.clientX, e.clientY); S.clicks.push({ x: e.clientX, y: e.clientY, text: el ? (el.textContent || el.placeholder || el.id || '').trim().slice(0, 40) : '', id: el ? el.id : '' }); }, true);
document.addEventListener('keydown', e => { if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); S.keys.push('ctrl+f'); const s = document.getElementById('search'); s.style.display = 'block'; document.getElementById('fakesearch').style.display = 'none'; s.focus(); } }, true);
function list(f) { const el = document.getElementById('list'); el.innerHTML = ''; for (const c of chats.filter(c => !f || fold(c).includes(fold(f)))) { const d = document.createElement('div'); d.className = 'it' + (c === S.cur ? ' sel' : ''); d.textContent = c; d.onclick = () => open(c); el.appendChild(d); } }
function open(c) { S.cur = c; document.getElementById('hdr').textContent = c; document.getElementById('msgs').innerHTML = '<div style="color:#888">Tin nhắn cũ của ' + c + '</div>'; const s = document.getElementById('search'); s.value = ''; s.style.display = 'none'; document.getElementById('fakesearch').style.display = 'block'; list(''); document.getElementById('comp').focus(); }
document.getElementById('comp').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) { S.sent.push({ to: S.cur, text: e.target.value }); const b = document.createElement('div'); b.textContent = e.target.value; document.getElementById('msgs').appendChild(b); e.target.value = ''; } });
document.getElementById('search').addEventListener('input', e => list(e.target.value));
list(''); open('Nguyễn Ngọc Khôi');
</script>`;
  const t = new BrowserWindow({ x: 60, y: 60, width: 1100, height: 680, show: true, title: 'Zalo', webPreferences: { contextIsolation: true } });
  t.on('page-title-updated', (e) => e.preventDefault());
  await t.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); t.focus(); t.webContents.focus(); await sleep(800);
  const st = () => t.webContents.executeJavaScript('JSON.parse(JSON.stringify(S))');
  const rects = () => t.webContents.executeJavaScript(`(() => { const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }; const o = { fakesearch: r(document.getElementById('fakesearch')), comp: r(document.getElementById('comp')) }; for (const el of document.querySelectorAll('.it')) o['it:' + el.textContent] = r(el); return o; })()`);
  const q = 'Gửi "AIVN test 1" vào nhóm Zalo "AIVN test". Không cần hỏi lại.';
  const ctx = { signal: new AbortController().signal, userQuery: q, confirm: async () => true, auto: require('./agent/autonomy').forTurn({ setting: false, query: q }) };
  const d = getDesk();
  const di = SC.displayInfo(); out.display = { text: di.text, nutSize: di.nutSize, displays: di.displays, fakeInputScale: Number(process.env.AIVN_FAKE_INPUT_SCALE) || 1, contentBounds: t.getContentBounds() };
  const step = async (name, a) => { const r0 = await rects(); const c0 = (await st()).clicks.length; let r; try { r = await d.act(a, ctx); } catch (e) { r = { error: String(e.message || e) }; } await sleep(600);
    const s = await st(); out.steps.push({ name, call: a, rects: r0, newClicks: s.clicks.slice(c0), summary: r.summary || r.error || '', error: r.error || null, check: String(r.detail || ''), forModel: String(r.forModel || '').slice(0, 900), state: { cur: s.cur, sent: s.sent, keys: s.keys } }); save(); return r; };
  try {
    out.look0 = String((await d.look({ window: 'Zalo' }, ctx)).forModel || '').slice(0, 1500);
    await step('click-search-text', { action: 'click', element: 'Tìm kiếm' });       // chữ không phản hồi → phải tự dùng Ctrl+F
    await step('type-search', { action: 'type_text', text: 'AIVN test' });           // gõ vào ô tìm kiếm (đã mở bằng Ctrl+F)
    const hit = (out.steps.at(-1).forModel.match(/click element "(e\d+)"/) || [])[1]; out.hitId = hit || null; // như mô hình: dùng id AIVN chỉ ra
    await step('click-result', { action: 'click', element: hit || 'AIVN test' });     // tiêu đề cửa sổ KHÔNG đổi, chỉ khung chat đổi
    await step('send', { action: 'type_text', text: 'AIVN test 1', submit: true });
    out.final = await st(); out.diag = d.diag ? d.diag() : null;
  } catch (e) { out.error = e.stack || String(e); }
  try { d.end('qa'); } catch {}
  save(); app.exit(0);
}
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
    await until('!state.generating', 120000); await until('!!document.querySelector("#messages .msg:last-child [data-logs]")', 5000);
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

// QA 0.14.3 (AIVN_QA143=thư mục, chỉ khi phát triển): nút công cụ, đính kèm ở cả hai chế độ, đổi giao diện + giảm chuyển động, tìm trong Khám phá
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
    await js('state.settings.themeFx = "os"');
    await js(watch); await js('document.querySelector("#themeRow button[data-theme=light]").click()'); await sleep(60);
    const fade = await js('document.documentElement.classList.contains("theme-anim")'); await sleep(700);
    // themeFx "full" (mặc định): vẫn chạy logo + vòng lan dù hệ điều hành giảm chuyển động
    await js('state.settings.themeFx = "full"'); await js(watch); await js('document.querySelector("#themeRow button[data-theme=dark]").click()'); await sleep(2500);
    const fullReduced = { theme: await js('document.documentElement.dataset.theme'), logoVeil: await js('window.__veil'), path: await js('window.__themePath') };
    await js('applyTheme("light")'); await sleep(200);
    const reduced = { mq, theme: await js('document.documentElement.dataset.theme'), logoVeil: await js('window.__veil'), appliedMs: await js('window.__applied'), crossfadeClass: fade, vtLeft: await js('document.documentElement.classList.contains("vt-theme")') };
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); wc.debugger.detach();
    // bấm liên tục 4 lần: kết quả cuối phải đúng nút cuối
    await js('for (const t of ["dark","light","dark","light"]) document.querySelector(`#themeRow button[data-theme=${t}]`).click()'); await sleep(2500);
    const rapid = { theme: await js('document.documentElement.dataset.theme'), veilLeft: await js('document.querySelector("#themeVeil").classList.contains("on")'), saved: settings.data.theme };
    return { normal, reduced, fullReduced, rapid };
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

// Tự kiểm thử v0.12 (AIVN_SELFTEST_V12=1): nhìn ảnh, RAG trên PDF dài, /v1/embeddings, Khám phá, đổi giao diện
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
    // 4) Khám phá
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
    // đếm theo dữ liệu cuộc trò chuyện (lời chào của cuộc mới không phải tin nhắn thật nên đếm thẻ trên màn hình bị lệch)
    const n = await js('(state.current && state.current.messages.length) || 0');
    await js(`document.querySelector("#input").value = ${JSON.stringify(q)}; document.querySelector("#composer").requestSubmit();`);
    await sleep(400);
    if (onBusy) await onBusy();
    await until(`!state.generating && !document.querySelector("#sendBtn").hidden && !!state.current && state.current.messages.filter(m => m.role === "assistant").length > 0 && state.current.messages.length >= ${n} + 2`, 900000);
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

// ---------- QA runner (beta.3): chỉ khi AIVN_QA_MODE=1 VÀ có cờ — xem docs/qa-runner.md. KHÔNG mở cổng mạng/CDP nào ----------
const QAR = require('./qa-runner');
const qaReq = QAR.fromArgv(process.argv, process.env);
let qaBusy = false;
function qaCommit() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')).commit || null; } catch {} if (app.isPackaged) return null; try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } }
function qaDisplays() { const { screen } = require('electron'); return { platform: process.platform, displays: screen.getAllDisplays().map(d => ({ id: d.id, primary: d.id === screen.getPrimaryDisplay().id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, dpi: Math.round(96 * d.scaleFactor), size: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) } })) }; }
async function qaRun(req) {
  const args = req.args; const runId = req.runId || String(Date.now());
  if (qaBusy) { const r = { schema: 1, runId, status: 'failed', reason: 'AIVN đang chạy một việc QA khác', exitCode: 2 }; try { QAR.writeJson(args.out, r); } catch {} return r; }
  qaBusy = true; LOG.log('qa', `QA runner bắt đầu (${req.kind || 'agent-task'}): ${String(args.task || args.script || args.out || '').slice(0, 200)}`);
  try {
    if (req.kind === 'input-diag') return await require('./qa-input-diag').run(args, { LOG, version: app.getVersion(), commit: qaCommit() }, { runId });
    if (req.kind === 'qa-ui') { const U = require('./qa-ui'); return await U.run(args, { win: () => win, LOG, version: app.getVersion(), commit: qaCommit(), displays: qaDisplays, profile: QA_PROFILE, engine, listModels, loadById,
      hookDialogs: (h) => U.hookDialogs(dialog, h), setMainClock: U.setMainClock, notifyModel: () => send('model:status', engine.status()), hw: () => engine.hardwareInfo(),
      metrics: () => ({ appMemMB: Math.round(app.getAppMetrics().reduce((s, x) => s + (x.memory ? x.memory.workingSetSize : 0), 0) / 1024) }) }, { runId }); }
    return await QAR.run(args, { version: app.getVersion(), commit: qaCommit(), engine, listModels, loadById, runAgentTurn, desk: getDesk(), displays: qaDisplays, LOG, activated,
      capture: (o) => require('./screen-control').capture(o),
      setLang: (l) => { const old = settings.data.uiLang; settings.data.uiLang = l; send('settings:changed', { uiLang: l }); return () => { settings.data.uiLang = old; send('settings:changed', { uiLang: old }); }; } }, { runId });
  } finally { qaBusy = false; }
}
// AIVN_QA_MODE=1 + cờ QA nhưng tham số sai: KHÔNG mở AIVN như thường (bot QA sẽ chờ mãi) → ghi result.json nếu biết --out, thoát mã 2
if (qaReq.invalid && String(process.env.AIVN_QA_MODE || '') === '1') {
  try { process.stderr.write('[AIVN QA] ' + qaReq.warn + '\n'); } catch {}
  try { const raw = QAR.parseArgs(process.argv); if (raw && raw.out) QAR.writeJson(path.resolve(raw.out), { schema: 1, status: 'failed', exitCode: 2, reason: qaReq.warn }); } catch {}
  process.exit(2);
}
const gotLock = isTest || app.requestSingleInstanceLock(qaReq.enabled ? { aivnQa: { ...qaReq, runId: qaReq.runId = `${process.pid}-${Date.now()}` } } : undefined);
if (!gotLock && qaReq.enabled && qaReq.kind === 'qa-ui') {
  // QA giao diện KHÔNG bao giờ điều khiển cửa sổ AIVN người dùng đang mở (dữ liệu thật, giành tiêu điểm) → cần --profile riêng
  try { QAR.writeJson(qaReq.args.out, { schema: 1, runId: qaReq.runId, kind: 'qa-ui', status: 'failed', exitCode: 2, reason: 'AIVN đang mở với hồ sơ thật: chạy --qa-ui kèm --profile <thư mục riêng> để có một phiên riêng không đụng dữ liệu người dùng' }); } catch {}
  app.exit(2);
} else if (!gotLock && qaReq.enabled) {
  // AIVN đang mở: chuyển việc QA cho bản đang chạy rồi chờ result.json của đúng lượt này → thoát với mã của nó
  const ms = ((qaReq.args.timeout || 600) + 180) * 1000;
  QAR.waitResult(qaReq.args.out, qaReq.runId, ms).then(j => { const code = j ? (j.exitCode ?? QAR.exitCodeOf(j.status)) : 2; if (!j) { try { process.stderr.write('[AIVN QA] không nhận được result.json từ bản AIVN đang chạy\n'); } catch {} } app.exit(code); });
} else if (!gotLock) app.quit();
else {
  // chỉ bản đang giữ khoá một-phiên-bản mới dọn (bản mở thứ hai không được giết llama-server của bản đang chạy)
  try { const k = pidFile.cleanup({ log: (m) => { console.log(m); LOG.log('engine', m); } }); if (k.length) LOG.log('engine', `Đã dừng ${k.length} llama-server còn sót từ lần chạy trước`); } catch (e) { console.warn('[dọn] ' + e.message); }
  app.on('second-instance', (_e, _argv, _cwd, extra) => {
    const q = extra && extra.aivnQa;
    // việc QA chuyển từ bản thứ hai (bản đó đã tự kiểm AIVN_QA_MODE=1 + cờ); kiểm lại tham số ở đây, không tin dữ liệu chuyển sang
    if (q && q.enabled && q.args && q.runId && q.kind !== 'qa-ui') { const v = q.kind === 'input-diag' ? { ok: true, args: q.args } : QAR.validate(q.args); if (v.ok) { LOG.log('qa', `Nhận việc QA chuyển từ bản mở thứ hai (lượt ${q.runId})`); qaRun({ ...q, args: v.args }).catch(e => LOG.log('qa', 'QA runner lỗi: ' + e.message)); return; } LOG.log('qa', 'Bỏ qua việc QA chuyển sang: ' + v.error); }
    showWindow();
  });
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(async () => {
    initStores();
    registerIpc();
    createWindow({ hidden: process.argv.includes('--hidden') && settings.data.keepInTray });
    if (activated()) startServices(); // chưa kích hoạt: không chạy lịch, API, mô hình
    else LOG.log('app', 'Máy chưa kích hoạt: chờ nhập mã (bộ máy AI, lịch tự động, máy chủ API chưa chạy)');
    licenseCheck().catch(() => {});
    startGateTimers();
    if (qaReq.warn) { LOG.log('qa', qaReq.warn); console.warn('[AIVN QA] ' + qaReq.warn); }
    if (qaReq.enabled) win.webContents.once('did-finish-load', () => setTimeout(async () => { let r = null; try { r = await qaRun(qaReq); } catch (e) { LOG.log('qa', 'QA runner lỗi: ' + (e.stack || e.message)); } const code = r ? (r.exitCode ?? QAR.exitCodeOf(r.status)) : 2; try { process.stdout.write(`[AIVN QA] ${r ? r.status : 'failed'} → ${qaReq.args.out}\n`); } catch {} app.exit(code); }, 2500));
    if (app.isPackaged || process.env.AIVN_UPDATE_CHECK === '1') setTimeout(() => updater.check({ silent: true }), Number(process.env.AIVN_UPDATE_DELAY || 5000));
    if (process.env.AIVN_SHOTS141) win.webContents.once('did-finish-load', () => setTimeout(() => shots141().catch(e => { console.error('SHOTS lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_FULLBENCH && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => runFullBench((process.env.AIVN_FULLBENCH_MODELS || '').split(',').filter(Boolean), { parts: process.env.AIVN_FULLBENCH_PARTS ? process.env.AIVN_FULLBENCH_PARTS.split(',') : null, apps: process.env.AIVN_FULLBENCH_APPS ? process.env.AIVN_FULLBENCH_APPS.split(',') : null, out: path.join(process.env.AIVN_FULLBENCH, 'result.json') }).then(r => { console.log('FULLBENCH', JSON.stringify(r)); app.quit(); }, e => { console.error('FULLBENCH lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_AGENTBENCH && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaBench().catch(e => { console.error('BENCH lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QAPAR && !app.isPackaged) { global.__qaErrs = []; win.webContents.on('console-message', (e, level, message, line, src) => { const lv = e && e.level != null ? e.level : level; const msg = (e && e.message) || message; if (lv === 3 || lv === 'error' || /Uncaught/.test(String(msg))) global.__qaErrs.push(String(msg).slice(0, 400) + ' @' + ((e && e.lineNumber) || line)); }); }
    if (process.env.AIVN_QAPAR && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaPar().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QA_MEDIA && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaMedia().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QA_BIZ && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaBiz().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QAUI && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaUI().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QACU && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaCU().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QA_B21 && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaB21().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QA_ZALO_DPI && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaZaloDpi().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QA_DESK016 && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qaDesk016().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QA144 && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qa144().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_QA143 && !app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => qa143().catch(e => { console.error('QA lỗi', e); app.exit(2); }), 2500));
    if (process.env.AIVN_SELFTEST_V14) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestV14().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1200));
    if (process.env.AIVN_SELFTEST_V13) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestV13().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1500));
    if (process.env.AIVN_SELFTEST_V12) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestV12().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1500));
    if (process.env.AIVN_SELFTEST_UI) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestUi().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1500));
    if (process.env.AIVN_SELFTEST_HF) selfTestHf().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); });
    if (process.env.AIVN_SELFTEST_DOC) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestDoc().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1500));
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
  app.on('will-quit', () => { media && media.close(); mcp && mcp.stopAll().catch(() => {}); scheduler && scheduler.stop(); engine.stop().catch(() => {}); });
}
