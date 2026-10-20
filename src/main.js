const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
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
  if (process.resourcesPath && !process.env.AIVN_RESOURCES) process.env.AIVN_RESOURCES = process.resourcesPath;
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
    temperature: 0.7, maxTokens: 1024, contextSize: 4096, apiPort: 1234, apiAutoStart: false, imported: [], lastModel: null, hfToken: '', theme: 'light', rag: true, vision: true,
  });
  convos = new JsonStore(path.join(ud, 'conversations.json'), { list: [] });
  rag = createRagStore(path.join(ud, 'rag'));
  downloader = createDownloader({ dir: paths.models, send, getToken: () => settings.data.hfToken || null, maxConcurrent: 2, log: (m) => isTest && console.log(m) });
}
// Cài đặt gửi sang giao diện: không bao giờ kèm token
const publicSettings = () => { const { hfToken, ...rest } = settings.data; return { ...rest, hfTokenSet: !!hfToken }; };

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const log = (msg) => { const e = { t: Date.now(), msg }; serverLog.push(e); if (serverLog.length > 200) serverLog.shift(); send('server:log', e); };

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

async function loadById(id) {
  const m = listModels().find(x => x.id === id);
  if (!m) throw new Error(`Không tìm thấy mô hình "${id}"`);
  send('model:status', { loading: true, id });
  try {
    let st;
    try { st = await engine.loadModel(m.id, m.path, { contextSize: settings.data.contextSize, ...(m.mmproj && settings.data.vision !== false ? { mmproj: m.mmproj } : {}) }); }
    catch (e) {
      const a = String(e.message).match(/unknown model architecture: '([^']+)'/i);
      if (a) throw new Error(`Kiến trúc mô hình "${a[1]}" chưa được hỗ trợ bởi llama.cpp ${hf.llamaCpp} trong AIVN. Hãy chờ bản AIVN mới hơn.`);
      if (/mmproj|clip/i.test(m.file)) throw new Error('Đây là tệp thị giác (mmproj), không phải mô hình trò chuyện.');
      if (e.code === 'VCREDIST') { send('vision:vcredist', { url: VCREDIST_URL }); throw new Error('Chế độ nhìn ảnh cần bộ thư viện Microsoft Visual C++ (bản 2015–2022, x64). Hãy cài từ trang chính thức của Microsoft rồi nạp lại mô hình.'); }
      if (e.code === 'NO_SERVER') throw new Error('Bản AIVN này thiếu thành phần nhìn ảnh (llama-server). Hãy cài lại AIVN.');
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

const api = createApiServer({ engine, models: listModels, ensureModel, log, embeddings: {
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
  count: (texts) => engine.embedCount(texts).then(a => a.reduce((s, x) => s + x, 0)),
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
  return hw().then(h => catalog.map(c => {
    const job = downloader.get(`${c.repo}::${c.file}`);
    const part = downloader.partialFor(c.repo, [{ path: c.file, size: c.size }, ...(c.mmproj ? [{ path: c.mmproj.file, size: c.mmproj.size }] : [])]);
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
    if ('theme' in rest && win && !win.isDestroyed()) win.setBackgroundColor(windowBg());
    settings.save(); return publicSettings();
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

  ipcMain.handle('chat:generate', async (_e, { reqId, messages, temperature, maxTokens, docs: attached, convoId, images }) => {
    const ac = new AbortController();
    generations.set(reqId, ac);
    try {
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [`--aivn-theme=${windowBg() === '#ffffff' ? 'light' : 'dark'}`] }, // giao diện đã lưu, áp dụng trước lần vẽ đầu tiên
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
    if (process.env.AIVN_SELFTEST_V12) win.webContents.once('did-finish-load', () => setTimeout(() => selfTestV12().catch(e => { console.error('SELFTEST lỗi', e); app.exit(2); }), 1500));
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
