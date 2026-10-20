const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const engine = require('./engine');
const catalog = require('./catalog');
const { JsonStore } = require('./store');
const { createApiServer } = require('./server');
const docs = require('./docs');
const { createUpdater } = require('./updater');

const isTest = process.env.AIVN_TEST === '1';
if (process.env.AIVN_USER_DATA) app.setPath('userData', process.env.AIVN_USER_DATA);

let win = null;
let paths, settings, convos;
const downloads = new Map(); // id -> { ac, received, total }
const generations = new Map(); // reqId -> AbortController
const serverLog = [];

function initStores() {
  const ud = app.getPath('userData');
  paths = { userData: ud, models: path.join(ud, 'models') };
  fs.mkdirSync(paths.models, { recursive: true });
  settings = new JsonStore(path.join(ud, 'settings.json'), {
    systemPrompt: 'Bạn là AIVN, một trợ lý AI thân thiện. Hãy trả lời bằng tiếng Việt, rõ ràng và chính xác.',
    temperature: 0.7, maxTokens: 1024, contextSize: 4096, apiPort: 1234, apiAutoStart: false, imported: [], lastModel: null,
  });
  convos = new JsonStore(path.join(ud, 'conversations.json'), { list: [] });
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const log = (msg) => { const e = { t: Date.now(), msg }; serverLog.push(e); if (serverLog.length > 200) serverLog.shift(); send('server:log', e); };

function modelIdFromFile(f) { return path.basename(f).replace(/\.gguf$/i, '').toLowerCase(); }

function listModels() {
  const out = [];
  for (const f of fs.readdirSync(paths.models)) {
    if (!/\.gguf$/i.test(f)) continue;
    const full = path.join(paths.models, f);
    try { const s = fs.statSync(full); out.push({ id: modelIdFromFile(f), file: f, path: full, size: s.size, mtime: s.mtimeMs, source: 'downloaded' }); } catch {}
  }
  for (const full of settings.data.imported) {
    try { const s = fs.statSync(full); out.push({ id: modelIdFromFile(full), file: path.basename(full), path: full, size: s.size, mtime: s.mtimeMs, source: 'imported' }); } catch {}
  }
  const st = engine.status();
  return out.map(m => ({ ...m, loaded: st.loaded && st.path === m.path, catalog: catalog.find(c => c.file.toLowerCase() === m.file.toLowerCase()) || null }));
}

async function loadById(id) {
  const m = listModels().find(x => x.id === id);
  if (!m) throw new Error(`Không tìm thấy mô hình "${id}"`);
  send('model:status', { loading: true, id });
  try {
    const st = await engine.loadModel(m.id, m.path, { contextSize: settings.data.contextSize });
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
function packForPrompt(messages, attached, maxTokens) {
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
async function startDownload(id) {
  const item = catalog.find(c => c.id === id);
  if (!item) throw new Error('Mô hình không có trong danh mục');
  if (downloads.has(id)) return;
  const dest = path.join(paths.models, item.file);
  const part = dest + '.part';
  const ac = new AbortController();
  const d = { ac, received: 0, total: item.size, started: Date.now() };
  downloads.set(id, d);
  let start = 0;
  try { start = fs.statSync(part).size; } catch {}
  try {
    const res = await fetch(item.url, { signal: ac.signal, redirect: 'follow', headers: start ? { Range: `bytes=${start}-` } : {} });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    if (res.status !== 206) start = 0;
    d.received = start;
    const len = Number(res.headers.get('content-length')) || 0;
    if (len) d.total = start + len;
    let last = 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', (c) => {
      d.received += c.length;
      const now = Date.now();
      if (now - last > 250) { last = now; send('download:progress', { id, received: d.received, total: d.total, speed: (d.received - start) / ((now - d.started) / 1000) }); }
    });
    await pipeline(body, fs.createWriteStream(part, { flags: start ? 'a' : 'w' }));
    fs.renameSync(part, dest);
    send('download:done', { id });
  } catch (e) {
    if (ac.signal.aborted) send('download:cancelled', { id });
    else send('download:error', { id, message: e.message });
  } finally { downloads.delete(id); }
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:info', async () => ({ version: app.getVersion(), paths, hardware: await engine.hardwareInfo().catch(e => ({ error: e.message })) }));
  ipcMain.handle('settings:get', () => settings.data);
  ipcMain.handle('settings:set', (_e, patch) => { Object.assign(settings.data, patch); settings.save(); return settings.data; });

  ipcMain.handle('catalog:list', () => {
    const local = listModels();
    return catalog.map(c => ({ ...c, installed: local.some(m => m.file.toLowerCase() === c.file.toLowerCase()), downloading: downloads.has(c.id) ? { received: downloads.get(c.id).received, total: downloads.get(c.id).total } : null }));
  });
  ipcMain.handle('download:start', (_e, id) => { startDownload(id); return true; });
  ipcMain.handle('download:cancel', (_e, id) => { const d = downloads.get(id); if (d) d.ac.abort(); return true; });

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
    else fs.rmSync(m.path, { force: true });
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
        const packed = packForPrompt(messages, attached, maxTokens);
        messages = packed.messages; docInfo = packed.docInfo;
        send('chat:docinfo', { reqId, ...docInfo });
      }
      const r = await engine.generate(messages, { temperature, maxTokens, signal: ac.signal, onToken: t => send('chat:token', { reqId, t }) });
      return { ...r, docInfo };
    } finally { generations.delete(reqId); }
  });
  ipcMain.handle('files:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Chọn tệp để gửi kèm', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Tài liệu', extensions: ['pdf', 'docx', 'txt', 'md', 'csv', 'json', 'html', 'xml', 'yaml', 'yml', 'log', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'sql', 'sh'] }, { name: 'Tất cả tệp', extensions: ['*'] }] });
    return r.canceled ? [] : r.filePaths;
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

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, backgroundColor: '#0a0d12', title: 'AIVN',
    icon: path.join(__dirname, '..', 'build', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
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
  const packed = packForPrompt([{ role: 'system', content: 'Bạn là AIVN, trả lời bằng tiếng Việt, ngắn gọn.' }, { role: 'user', content: q }], extracted, maxTokens);
  const r = await engine.generate(packed.messages, { temperature: 0.1, maxTokens });
  const out = { question: q, files: packed.docInfo.files, truncated: packed.docInfo.truncated, budget: packed.docInfo.budget, promptChars: packed.docInfo.context.length, answer: r.text, usage: r.usage };
  fs.writeFileSync(process.env.AIVN_SELFTEST_OUT || path.join(paths.userData, 'selftest.json'), JSON.stringify(out, null, 2));
  if (process.env.AIVN_SELFTEST_UPDATE === '1') { const st = await updater.check(); out.update = st; fs.writeFileSync(process.env.AIVN_SELFTEST_OUT, JSON.stringify(out, null, 2)); }
  app.quit();
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
    if (process.env.AIVN_SELFTEST_DOC) selfTestDoc().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); });
    if (process.env.AIVN_SHOT) setTimeout(async () => { // chỉ dùng khi kiểm thử: chụp màn hình cửa sổ
      try { if (process.env.AIVN_SHOT_JS) await win.webContents.executeJavaScript(process.env.AIVN_SHOT_JS); await new Promise(r => setTimeout(r, 1500));
        fs.writeFileSync(process.env.AIVN_SHOT, (await win.webContents.capturePage()).toPNG()); } catch (e) { console.error(e); }
      if (process.env.AIVN_SHOT_QUIT) app.quit();
    }, Number(process.env.AIVN_SHOT_DELAY || 8000));
  });
  app.on('window-all-closed', async () => { await api.stop().catch(() => {}); await engine.unloadModel().catch(() => {}); app.quit(); });
}
