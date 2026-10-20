const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const catalog = require('./catalog');
const { JsonStore } = require('./store');
const { createApiServer } = require('./server');
const docs = require('./docs');
const { createUpdater } = require('./updater');
const hf = require('./hf');
const { createDownloader } = require('./downloader');

const isTest = process.env.AIVN_TEST === '1';
if (process.env.AIVN_USER_DATA) app.setPath('userData', process.env.AIVN_USER_DATA);

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
  engine = createEngineProxy({ nodePath, hostScript, log: (m) => console.log(m),
    onCrash: (e) => { send('model:status', { loaded: false }); send('engine:crash', { message: e.message }); } });
} else {
  console.warn('[engine] không tìm thấy Node.js đi kèm, chạy llama.cpp ngay trong Electron (mô hình > 2 GB chạy CPU có thể lỗi)');
  const inproc = require('./engine');
  engine = { ...inproc, external: false, calibrate: async () => {}, ocr: (b) => require('./ocr').recognize(b), start: async () => {}, stop: async () => {} };
}

let win = null;
let paths, settings, convos;
let downloader = null;
let hwCache = null;
const hw = async () => (hwCache ||= await engine.hardwareInfo().catch(() => ({ ram: require('os').totalmem() })));
const generations = new Map(); // reqId -> AbortController
const serverLog = [];

function initStores() {
  const ud = app.getPath('userData');
  paths = { userData: ud, models: path.join(ud, 'models') };
  fs.mkdirSync(paths.models, { recursive: true });
  settings = new JsonStore(path.join(ud, 'settings.json'), {
    systemPrompt: 'Bạn là AIVN, một trợ lý AI thân thiện. Hãy trả lời bằng tiếng Việt, rõ ràng và chính xác.',
    temperature: 0.7, maxTokens: 1024, contextSize: 4096, apiPort: 1234, apiAutoStart: false, imported: [], lastModel: null, hfToken: '', theme: 'light',
  });
  convos = new JsonStore(path.join(ud, 'conversations.json'), { list: [] });
  downloader = createDownloader({ dir: paths.models, send, getToken: () => settings.data.hfToken || null, maxConcurrent: 2, log: (m) => isTest && console.log(m) });
}
// Cài đặt gửi sang giao diện: không bao giờ kèm token
const publicSettings = () => { const { hfToken, ...rest } = settings.data; return { ...rest, hfTokenSet: !!hfToken }; };

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const log = (msg) => { const e = { t: Date.now(), msg }; serverLog.push(e); if (serverLog.length > 200) serverLog.shift(); send('server:log', e); };

const SPLIT_RE = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;
function modelIdFromFile(f) { const b = path.basename(f); const m = b.match(SPLIT_RE); return (m ? m[1] : b.replace(/\.gguf$/i, '')).toLowerCase(); }

// Quét thư mục mô hình (models/<tác giả>/<repo>/<tệp>.gguf và tệp ở gốc). Mô hình chia phần chỉ hiện một dòng.
function scanDir(dir, depth, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const files = ents.filter(e => e.isFile() && /\.gguf$/i.test(e.name) && !/mmproj/i.test(e.name));
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
      out.push({ id: modelIdFromFile(e.name), file: e.name, path: full, size, mtime: fs.statSync(full).mtimeMs, source: 'downloaded', parts, incomplete: missing > 0, repo: rel && rel.split(path.sep).length === 2 ? rel.split(path.sep).join('/') : null });
    } catch {}
  }
  if (depth > 0) for (const e of ents) if (e.isDirectory()) scanDir(path.join(dir, e.name), depth - 1, out);
}

function listModels() {
  const out = [];
  scanDir(paths.models, 3, out);
  for (const full of settings.data.imported) {
    try { const s = fs.statSync(full); out.push({ id: modelIdFromFile(full), file: path.basename(full), path: full, size: s.size, mtime: s.mtimeMs, source: 'imported', parts: 1 }); } catch {}
  }
  const st = engine.status();
  const seen = new Set();
  return out.filter(m => !m.incomplete && !seen.has(m.id) && seen.add(m.id))
    .map(m => ({ ...m, loaded: st.loaded && st.path === m.path, catalog: catalog.find(c => c.file.toLowerCase() === m.file.toLowerCase()) || null }));
}
const isInstalled = (file) => listModels().some(m => m.file.toLowerCase() === path.basename(file).toLowerCase());

async function loadById(id) {
  const m = listModels().find(x => x.id === id);
  if (!m) throw new Error(`Không tìm thấy mô hình "${id}"`);
  send('model:status', { loading: true, id });
  try {
    let st;
    try { st = await engine.loadModel(m.id, m.path, { contextSize: settings.data.contextSize }); }
    catch (e) {
      const a = String(e.message).match(/unknown model architecture: '([^']+)'/i);
      if (a) throw new Error(`Kiến trúc mô hình "${a[1]}" chưa được hỗ trợ bởi llama.cpp ${hf.llamaCpp} trong AIVN. Hãy chờ bản AIVN mới hơn.`);
      if (/mmproj|clip/i.test(m.file)) throw new Error('Đây là tệp thị giác (mmproj), không phải mô hình trò chuyện.');
      throw e;
    }
    settings.data.lastModel = m.id; settings.save();
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


// Đóng gói tài liệu đính kèm vào tin nhắn cuối, vừa với ngân sách ngữ cảnh của mô hình
async function packForPrompt(messages, attached, maxTokens) {
  await engine.calibrate([...messages.map(m => typeof m.content === 'string' ? m.content : ''), ...attached.map(a => a.text)]).catch(() => {});
  const st = engine.status();
  const ctx = st.contextSize || settings.data.contextSize || 4096;
  const last = messages[messages.length - 1];
  const question = last.content;
  const used = engine.countTokens(messages.map(m => m.content).join('\n')) + 64 * messages.length;
  const reserve = Math.min(maxTokens || 1024, Math.floor(ctx / 3));
  const budget = Math.max(256, ctx - used - reserve - 256);
  const packed = docs.packDocuments(question, attached, budget, (t) => engine.countTokens(t));
  const content = docs.buildUserContent(question, packed.block);
  return { messages: [...messages.slice(0, -1), { ...last, content }], docInfo: { truncated: packed.truncated, files: packed.files, budget, context: content } };
}

const api = createApiServer({ engine, models: listModels, ensureModel, log });
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
  return hw().then(h => catalog.map(c => {
    const job = downloader.get(`${c.repo}::${c.file}`);
    const part = downloader.partialFor(c.repo, [{ path: c.file, size: c.size }]);
    return { ...c, installed: part.complete || isInstalled(c.file), partial: part.complete ? 0 : part.received, job, fit: hf.fitFor(c.size, h) };
  }));
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:info', async () => ({ version: app.getVersion(), paths, hardware: await hw(), llamaCpp: hf.llamaCpp }));
  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:set', (_e, patch = {}) => {
    const { hfToken, hfTokenSet, ...rest } = patch;
    Object.assign(settings.data, rest);
    if (typeof hfToken === 'string') settings.data.hfToken = hfToken.trim().slice(0, 300);
    if (['light', 'dark', 'system'].includes(settings.data.theme)) require('electron').nativeTheme.themeSource = settings.data.theme;
    settings.save(); return publicSettings();
  });

  ipcMain.handle('catalog:list', () => catalogList());
  ipcMain.handle('hf:search', (_e, { q, sort } = {}) => hf.search({ q: String(q || '').slice(0, 200), sort, limit: 30, token: settings.data.hfToken || null }));
  ipcMain.handle('hf:repo', async (_e, repo) => {
    if (!safeRepo(repo)) throw new Error('Tên repo không hợp lệ');
    const r = await hf.repoFiles(repo, { token: settings.data.hfToken || null, hw: await hw() });
    return { ...r, groups: r.groups.map(g => annotateGroup(repo, g)) };
  });
  ipcMain.handle('dl:start', (_e, spec) => {
    if (spec && spec.catalogId) {
      const c = catalog.find(x => x.id === spec.catalogId); if (!c) throw new Error('Mô hình không có trong danh mục');
      return downloader.enqueue({ repo: c.repo, files: [{ path: c.file, size: c.size }], name: c.name, quant: c.quant, catalogId: c.id, urlFor: hf.resolveUrl });
    }
    if (!spec || !safeRepo(spec.repo) || !Array.isArray(spec.files) || !spec.files.length || !spec.files.every(f => safeFile(f.path))) throw new Error('Yêu cầu tải không hợp lệ');
    return downloader.enqueue({ repo: spec.repo, files: spec.files.map(f => ({ path: f.path, size: Number(f.size) || 0 })), name: spec.name, quant: spec.quant, urlFor: hf.resolveUrl });
  });
  ipcMain.handle('dl:pause', (_e, id) => downloader.pause(id));
  ipcMain.handle('dl:resume', (_e, id) => downloader.resume(id));
  ipcMain.handle('dl:remove', (_e, id) => downloader.remove(id));
  ipcMain.handle('dl:list', () => downloader.list());
  ipcMain.handle('hw:info', () => hw());

  ipcMain.handle('models:list', () => listModels());
  ipcMain.handle('models:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Chọn tệp mô hình GGUF', filters: [{ name: 'Mô hình GGUF', extensions: ['gguf'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return listModels();
    for (const f of r.filePaths) if (!settings.data.imported.includes(f)) settings.data.imported.push(f);
    settings.save();
    return listModels();
  });
  ipcMain.handle('models:load', (_e, id) => loadById(id));
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

  ipcMain.handle('chat:generate', async (_e, { reqId, messages, temperature, maxTokens, docs: attached }) => {
    const ac = new AbortController();
    generations.set(reqId, ac);
    try {
      let docInfo = null;
      if (attached && attached.length) {
        const packed = await packForPrompt(messages, attached, maxTokens);
        messages = packed.messages; docInfo = packed.docInfo;
        send('chat:docinfo', { reqId, ...docInfo });
      }
      const r = await engine.generate(messages, { temperature, maxTokens, signal: ac.signal, onToken: t => send('chat:token', { reqId, t }) });
      return { ...r, docInfo };
    } finally { generations.delete(reqId); }
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
      try { const d = await docs.extractFile(p); out.push({ ok: true, name: d.name, size: d.size, kind: d.kind, pages: d.pages, chars: d.chars, text: d.text }); }
      catch (e) { out.push({ ok: false, name: path.basename(p), error: e.userMessage || ('Không đọc được tệp: ' + e.message) }); }
    }
    return out;
  });
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => updater.install());
  ipcMain.handle('update:open', () => updater.openReleases());
  ipcMain.handle('update:state', () => updater.state());
  ipcMain.handle('chat:stop', (_e, reqId) => { generations.get(reqId)?.abort(); return true; });

  ipcMain.handle('convos:list', () => convos.data.list);
  ipcMain.handle('convos:save', (_e, c) => {
    const i = convos.data.list.findIndex(x => x.id === c.id);
    if (i >= 0) convos.data.list[i] = c; else convos.data.list.unshift(c);
    convos.data.list.sort((a, b) => b.updatedAt - a.updatedAt);
    convos.save(); return true;
  });
  ipcMain.handle('convos:delete', (_e, id) => { convos.data.list = convos.data.list.filter(x => x.id !== id); convos.save(); return true; });

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
    ...(isMac ? [{ label: 'AIVN', submenu: [{ role: 'about', label: 'Giới thiệu AIVN' }, { type: 'separator' }, { role: 'hide', label: 'Ẩn AIVN' }, { role: 'hideOthers', label: 'Ẩn ứng dụng khác' }, { role: 'unhide', label: 'Hiện tất cả' }, { type: 'separator' }, { role: 'quit', label: 'Thoát AIVN' }] }] : [{ label: 'Tệp', submenu: [{ role: 'quit', label: 'Thoát' }] }]),
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
function createWindow() {
  if (['light', 'dark', 'system'].includes(settings.data.theme)) require('electron').nativeTheme.themeSource = settings.data.theme;
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, backgroundColor: windowBg(), title: 'AIVN',
    icon: path.join(__dirname, '..', 'build', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  buildMenus();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
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

const gotLock = isTest || app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    initStores();
    registerIpc();
    createWindow();
    if (settings.data.apiAutoStart || process.env.AIVN_API === '1') api.start(settings.data.apiPort).catch(e => log('Lỗi: ' + e.message));
    if (process.env.AIVN_LOAD) loadById(process.env.AIVN_LOAD).catch(e => log('Lỗi nạp: ' + e.message));
    if (app.isPackaged || process.env.AIVN_UPDATE_CHECK === '1') setTimeout(() => updater.check({ silent: true }), Number(process.env.AIVN_UPDATE_DELAY || 5000));
    if (process.env.AIVN_SELFTEST_UI) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestUi().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1500));
    if (process.env.AIVN_SELFTEST_HF) selfTestHf().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); });
    if (process.env.AIVN_SELFTEST_DOC) selfTestDoc().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); });
    if (process.env.AIVN_SHOT) setTimeout(async () => { // chỉ dùng khi kiểm thử: chụp màn hình cửa sổ
      try { if (process.env.AIVN_SHOT_JS) await win.webContents.executeJavaScript(process.env.AIVN_SHOT_JS); await new Promise(r => setTimeout(r, 1500));
        fs.writeFileSync(process.env.AIVN_SHOT, (await win.webContents.capturePage()).toPNG()); } catch (e) { console.error(e); }
      if (process.env.AIVN_SHOT_QUIT) app.quit();
    }, Number(process.env.AIVN_SHOT_DELAY || 8000));
  });
  app.on('window-all-closed', async () => { await api.stop().catch(() => {}); await engine.unloadModel().catch(() => {}); await engine.stop().catch(() => {}); app.quit(); });
  app.on('will-quit', () => { engine.stop().catch(() => {}); });
}
