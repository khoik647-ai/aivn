// AIVN — tệp âm thanh/video đính kèm: chép lời (Whisper large-v3-turbo, chạy trên máy) + khung hình đại diện của video.
// Tiến trình chính: giữ một cửa sổ ẩn "bộ nghe" (src/media/worker.html), phục vụ tệp qua giao thức riêng aivnm://
//   aivnm://app/…     tệp của bộ nghe (trang, bundle transformers.js, lõi WASM onnxruntime)
//   aivnm://models/…  đúng 7 tệp của mô hình Whisper trong thư mục mô hình AIVN (không phục vụ gì khác)
//   aivnm://in/<mã>   tệp người dùng đính kèm — mã ngẫu nhiên, chỉ sống trong một lần chép lời, hỗ trợ Range để tua video
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const SCHEME = 'aivnm';
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv']);
const MAX_AV_BYTES = 1024 * 1048576; // 1 GB mỗi tệp
const MAX_SECONDS = 2 * 3600;        // chép lời tối đa 2 giờ đầu
const IDLE_MS = 180000;              // rảnh 3 phút → đóng bộ nghe, trả RAM/VRAM
// Mô hình ghim theo commit để tệp không đổi dưới chân người dùng; kích thước kiểm khi tải xong
const ASR = {
  id: 'asr-whisper-large-v3-turbo', name: 'Bộ nghe Whisper large-v3-turbo (q4)', repo: 'onnx-community/whisper-large-v3-turbo', rev: '360ebcde2559d60bb474678be3c1de9ef347d01a',
  files: [
    { path: 'config.json', size: 1332 }, { path: 'generation_config.json', size: 3897 }, { path: 'preprocessor_config.json', size: 340 },
    { path: 'tokenizer.json', size: 2480617 }, { path: 'tokenizer_config.json', size: 282843 },
    { path: 'onnx/encoder_model_q4.onnx', size: 424942775 }, { path: 'onnx/decoder_model_merged_q4.onnx', size: 334147222 },
  ],
};
ASR.size = ASR.files.reduce((s, f) => s + f.size, 0);
const extOf = (f) => path.extname(String(f)).slice(1).toLowerCase();
const avKind = (f) => AUDIO_EXT.has(extOf(f)) ? 'audio' : VIDEO_EXT.has(extOf(f)) ? 'video' : null;
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.onnx': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.weba': 'audio/webm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.ogv': 'video/ogg' };
// Trang cần cô lập nguồn gốc (SharedArrayBuffer) để WASM chạy nhiều luồng
const ISO = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': `${'aivnm'}://app`, 'Cache-Control': 'no-store' };

function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
}
const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };

// Kết quả của bộ nghe → văn bản cho mô hình (giữ mốc thời gian để mô hình trích dẫn được “ở phút mấy”)
function transcriptText(name, r, { ocr = [] } = {}) {
  const kind = r.kind === 'video' ? 'video' : 'âm thanh';
  const head = [`[Bản chép lời ${kind} "${name}"${r.duration ? ` · dài ${mmss(r.duration)}` : ''} · AIVN tự chép lời trên máy bằng Whisper, có thể sai vài từ hoặc tên riêng]`];
  if (r.truncated) head.push(`[Tệp dài hơn ${MAX_SECONDS / 3600} giờ: AIVN chỉ chép lời ${MAX_SECONDS / 3600} giờ đầu]`);
  const lines = []; let cur = null;
  // gộp các câu ngắn liền nhau thành đoạn ~20 giây để đỡ tốn ngữ cảnh mà vẫn có mốc thời gian
  for (const s of r.segments || []) { if (cur && s.start - cur.start < 20 && cur.text.length < 400) cur.text += ' ' + s.text; else { if (cur) lines.push(cur); cur = { start: s.start, text: s.text }; } }
  if (cur) lines.push(cur);
  const body = lines.map(l => `[${mmss(l.start)}] ${l.text}`).join('\n');
  const parts = [head.join('\n')];
  if (body) parts.push(body);
  else parts.push(r.noAudio ? '[Video không có tiếng]' : '[Không nghe thấy lời nói nào (chỉ có nhạc/tiếng ồn hoặc im lặng)]');
  if (ocr.length) parts.push(ocr.map(o => `[Chữ trên hình ở ${mmss(o.at)}]\n${o.text}`).join('\n\n'));
  return parts.join('\n\n');
}
// Bỏ chữ OCR trùng (slide giữ nguyên qua nhiều khung hình)
function dedupeOcr(list) {
  const out = []; const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const o of list) { const n = norm(o.text); if (n.length < 8) continue; if (out.some(x => { const m = norm(x.text); return m === n || (m.length > 30 && (m.includes(n) || n.includes(m))); })) continue; out.push(o); }
  return out;
}

function createMedia({ app, protocol, BrowserWindow, ipcMain, modelsDir, log = () => {}, isTest = false, threads = () => 4 }) {
  const dirOf = () => path.join(modelsDir(), ...ASR.repo.split('/'));
  const fileFor = (p) => path.join(dirOf(), p.split('/').pop()); // trùng cách đặt tên của downloader (bỏ thư mục con)
  const installed = () => ASR.files.every(f => { try { return fs.statSync(fileFor(f.path)).size === f.size; } catch { return false; } });
  const tokens = new Map(); // mã → đường dẫn tệp người dùng
  const appDir = path.join(__dirname, 'media');
  const allowModel = new Map(ASR.files.map(f => [f.path, f]));

  function serveFile(file, req, extra = {}) {
    let st; try { st = fs.statSync(file); } catch { return new Response('not found', { status: 404 }); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', ...ISO, ...extra };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
    let start = 0, end = st.size - 1, status = 200;
    if (m && st.size) { start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2])); end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1; if (start > end || start >= st.size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } }); status = 206; h['Content-Range'] = `bytes ${start}-${end}/${st.size}`; }
    h['Content-Length'] = String(end - start + 1);
    if (!st.size) return new Response(new Uint8Array(0), { status, headers: h });
    const { Readable } = require('stream');
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers: h });
  }
  let handled = false;
  function handle() {
    if (handled) return; handled = true;
    protocol.handle(SCHEME, (req) => {
      let u; try { u = new URL(req.url); } catch { return new Response('bad', { status: 400 }); }
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (u.host === 'app') {
        const f = path.normalize(path.join(appDir, rel));
        if (!f.startsWith(appDir + path.sep) || !/\.(html|mjs|wasm|json)$/.test(f)) return new Response('forbidden', { status: 403 });
        return serveFile(f, req);
      }
      if (u.host === 'models') { // chỉ đúng các tệp của mô hình Whisper đã ghim
        const pre = ASR.repo + '/'; if (!rel.startsWith(pre)) return new Response('not found', { status: 404 });
        const want = rel.slice(pre.length).replace(/^resolve\/[^/]+\//, ''); if (!allowModel.has(want)) return new Response('not found', { status: 404 });
        return serveFile(fileFor(want), req);
      }
      if (u.host === 'in') { const f = tokens.get(rel); return f ? serveFile(f, req) : new Response('gone', { status: 404 }); }
      return new Response('not found', { status: 404 });
    });
  }

  // ---- cửa sổ ẩn ----
  let win = null, readyP = null, idleT = null; const jobs = new Map();
  const touch = () => { clearTimeout(idleT); idleT = setTimeout(() => { if (!jobs.size) close(); }, IDLE_MS); idleT.unref?.(); };
  function close() { const w = win; win = null; readyP = null; try { w && !w.isDestroyed() && w.destroy(); } catch {} }
  ipcMain.on('media:ready', (e, info) => { const j = readyWait; if (j && win && e.sender === win.webContents) { readyWait = null; j.res(info); } });
  ipcMain.on('media:progress', (e, id, p) => { const j = jobs.get(id); if (j && win && e.sender === win.webContents) j.onProgress(p); });
  ipcMain.on('media:result', (e, id, r) => { const j = jobs.get(id); if (j && win && e.sender === win.webContents) { jobs.delete(id); j.res(r); } });
  ipcMain.on('media:fail', (e, id, msg, code) => { const j = jobs.get(id); if (j && win && e.sender === win.webContents) { jobs.delete(id); j.rej(Object.assign(new Error(msg), { code })); } });
  let readyWait = null;
  function ensureWin() {
    if (win && !win.isDestroyed() && readyP) return readyP;
    handle();
    win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { preload: path.join(appDir, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    if (isTest) win.webContents.on('console-message', (e) => console.log('[media]', e.message || e));
    win.webContents.on('render-process-gone', (_e, d) => { log('media', 'Bộ nghe bị dừng: ' + (d && d.reason)); for (const [id, j] of jobs) { jobs.delete(id); j.rej(Object.assign(new Error('Bộ nghe bị dừng giữa chừng (có thể do thiếu RAM). Hãy thử lại với tệp ngắn hơn.'), { code: 'crash' })); } close(); });
    win.on('closed', () => { win = null; readyP = null; });
    readyP = new Promise((res, rej) => { readyWait = { res, rej }; setTimeout(() => { if (readyWait) { readyWait = null; rej(new Error('Bộ nghe không khởi động được')); } }, 30000); });
    win.loadURL(`${SCHEME}://app/worker.html`).catch((e) => { if (readyWait) { readyWait.rej(e); readyWait = null; } });
    readyP.catch(() => close());
    return readyP;
  }

  // file → { kind, duration, text, segments, frames, device, … }
  async function transcribe(file, { onProgress = () => {}, signal, frames = 0, language = null, fallbackLanguage = null, device = 'auto', ocr = null } = {}) {
    const kind = avKind(file); if (!kind) throw Object.assign(new Error('Không phải tệp âm thanh/video'), { userMessage: 'Không phải tệp âm thanh/video.' });
    const name = path.basename(file);
    let st; try { st = fs.statSync(file); } catch { throw Object.assign(new Error('x'), { userMessage: `Không mở được tệp "${name}".` }); }
    if (!st.size) throw Object.assign(new Error('x'), { userMessage: `"${name}" là tệp rỗng.` });
    if (st.size > MAX_AV_BYTES) throw Object.assign(new Error('x'), { userMessage: `"${name}" quá lớn (${(st.size / 1048576).toFixed(0)} MB). Giới hạn là ${MAX_AV_BYTES / 1048576} MB mỗi tệp âm thanh/video.` });
    if (!installed()) throw Object.assign(new Error('x'), { code: 'need-asr', userMessage: `Để chép lời "${name}", AIVN cần tải bộ nghe Whisper (${(ASR.size / 1048576).toFixed(0)} MB, một lần, chạy hoàn toàn trên máy).` });
    const info = await ensureWin();
    const id = crypto.randomUUID(); const tok = crypto.randomBytes(18).toString('hex') + path.extname(file).toLowerCase();
    tokens.set(tok, file); clearTimeout(idleT);
    const t0 = Date.now();
    try {
      const r = await new Promise((res, rej) => {
        jobs.set(id, { res, rej, onProgress });
        const abort = () => { try { win && win.webContents.send('media:cancel', id); } catch {} };
        if (signal) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }
        win.webContents.send('media:job', { id, src: `${SCHEME}://in/${tok}`, kind, frames: kind === 'video' ? frames : 0, language, fallbackLanguage, device, threads: threads(), maxSec: MAX_SECONDS });
      });
      let ocrList = [];
      if (ocr && r.frames && r.frames.length) {
        onProgress({ stage: 'ocr' });
        for (const f of r.frames) { try { const o = await ocr(Buffer.from(f.url.split(',')[1], 'base64')); if (o && o.chars >= 8 && o.confidence >= 55) ocrList.push({ at: f.at, text: o.text.trim() }); } catch {} }
        ocrList = dedupeOcr(ocrList);
      }
      const text = transcriptText(name, r, { ocr: ocrList });
      log('media', `Chép lời ${name}`, { kind, size: st.size, dur: r.duration, lang: r.language, segs: (r.segments || []).length, device: r.device, loadMs: r.loadMs, asrMs: r.asrMs, ms: Date.now() - t0, coi: info && info.coi });
      return { name, path: file, size: st.size, kind, duration: r.duration, text, chars: text.length, segments: r.segments || [], frames: (r.frames || []).map(f => f.url), frameAt: (r.frames || []).map(f => f.at), device: r.device, language: r.language || null, detected: r.detected || null, truncated: !!r.truncated, noAudio: !!r.noAudio, frameError: r.frameError || null, ms: Date.now() - t0 };
    } catch (e) {
      if (e.code === 'cancel') throw Object.assign(e, { userMessage: 'Đã huỷ chép lời.' });
      if (!e.userMessage) e.userMessage = `Không chép lời được "${name}": ${e.message}`;
      throw e;
    } finally { tokens.delete(tok); touch(); }
  }
  return { transcribe, installed, status: () => ({ installed: installed(), size: ASR.size, name: ASR.name, running: !!win, jobs: jobs.size }), close, ASR, avKind };
}

const resolveAsrUrl = (repo, file) => `https://huggingface.co/${repo}/resolve/${ASR.rev}/${file.split('/').map(encodeURIComponent).join('/')}`;
module.exports = { registerScheme, createMedia, transcriptText, dedupeOcr, avKind, mmss, ASR, AUDIO_EXT, VIDEO_EXT, MAX_AV_BYTES, MAX_SECONDS, resolveAsrUrl, SCHEME };
