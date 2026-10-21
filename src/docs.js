// Đọc tệp đính kèm (PDF có lớp chữ, DOCX, văn bản/mã nguồn) và đóng gói vào prompt. Chạy hoàn toàn cục bộ.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log', 'html', 'htm', 'css', 'scss',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'kts', 'scala',
  'sql', 'sh', 'bash', 'ps1', 'bat', 'r', 'm', 'lua', 'pl', 'dart', 'vue', 'svelte', 'tex', 'srt', 'vtt', 'env', 'gitignore', 'dockerfile']);
const OCR_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'svg', 'ico']);

class DocError extends Error { constructor(msg) { super(msg); this.userMessage = msg; } }

function extOf(file) {
  const base = path.basename(file).toLowerCase();
  if (base === 'dockerfile' || base === '.gitignore' || base === '.env') return base.replace(/^\./, '');
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1) : '';
}

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const base = path.dirname(require.resolve('pdfjs-dist/package.json')).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    require('./dommatrix-polyfill');
    pdfjsPromise = import(pathToFileURL(path.join(base, 'legacy', 'build', 'pdf.mjs')).href).then((m) => {
      m.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(base, 'legacy', 'build', 'pdf.worker.mjs')).href;
      return { pdfjs: m, base };
    });
  }
  return pdfjsPromise;
}

async function extractPdf(buf) {
  const { pdfjs, base } = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
    cMapUrl: pathToFileURL(path.join(base, 'cmaps') + path.sep).href, cMapPacked: true, verbosity: 0,
  }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let line = '', out = [];
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        line += it.str;
        if (it.hasEOL) { out.push(line); line = ''; }
      }
      if (line) out.push(line);
      pages.push(out.join('\n').replace(/[ \t]+\n/g, '\n').trim());
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  const text = pages.map((t, i) => (t ? `[Trang ${i + 1}]\n${t}` : '')).filter(Boolean).join('\n\n');
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters < 20) {
    // PDF scan / ảnh chụp: lấy ảnh của từng trang để đọc chữ bằng OCR (tiến trình chính làm, có báo tiến độ)
    const scans = await pdfPageImages(buf).catch(() => []);
    if (!scans.length) throw new DocError('PDF này không có lớp chữ và AIVN không tách được ảnh trang để đọc chữ (OCR). Hãy dùng PDF có thể bôi đen chữ, hoặc chuyển sang DOCX/TXT.');
    return { text: '', pages: doc.numPages, scanned: scans };
  }
  return { text, pages: doc.numPages };
}

// Ảnh lớn nhất của mỗi trang PDF (bản scan thường là một ảnh/trang) → PNG; tối đa SCAN_MAX_PAGES trang
const SCAN_MAX_PAGES = 40;
async function pdfPageImages(buf) {
  const { pdfjs, base } = await loadPdfjs(); const { encodePng, unpack1bpp } = require('./png');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    cMapUrl: pathToFileURL(path.join(base, 'cmaps') + path.sep).href, cMapPacked: true, verbosity: 0 }).promise;
  const out = [];
  try {
    const OPS = pdfjs.OPS; const n = Math.min(doc.numPages, SCAN_MAX_PAGES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i); const ops = await page.getOperatorList();
      let best = null;
      for (let k = 0; k < ops.fnArray.length; k++) {
        const fn = ops.fnArray[k]; if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) continue;
        const a = ops.argsArray[k][0]; let img = null;
        if (typeof a === 'string') img = await new Promise((res) => { const store = a.startsWith('g_') ? page.commonObjs : page.objs; try { store.get(a, res); } catch { res(null); } setTimeout(() => res(null), 5000); });
        else img = a;
        if (img && img.data && img.width && img.height && (!best || img.width * img.height > best.width * best.height)) best = img;
      }
      if (best && best.width * best.height >= 200 * 200) {
        const ch = best.kind === 1 ? 1 : best.kind === 2 ? 3 : 4;
        const px = best.kind === 1 ? unpack1bpp(best.width, best.height, best.data) : best.data;
        if (px.length >= best.width * best.height * ch) out.push({ page: i, png: encodePng(best.width, best.height, px, ch) });
      }
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  return out;
}

async function extractDocx(buf) {
  const mammoth = require('mammoth');
  const r = await mammoth.extractRawText({ buffer: buf });
  const text = r.value.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new DocError('Tệp DOCX này không có nội dung chữ để đọc.');
  return { text };
}

function decodeText(buf) {
  if (buf.includes(0)) {
    // UTF-16 có BOM thì vẫn đọc được, còn lại coi là tệp nhị phân
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').slice(1);
    throw new DocError('Tệp này có vẻ là tệp nhị phân, không phải văn bản.');
  }
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

const OFFICE_EXT = new Set(['xlsx', 'xlsm', 'pptx', 'odt', 'ods', 'odp']);
const ARCHIVE_EXT = new Set(['zip']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv']);
const LEGACY = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' };
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const KIND = (ext) => ext === 'pdf' ? 'pdf' : ext === 'docx' || ext === 'odt' ? 'docx' : ['xlsx', 'xlsm', 'ods'].includes(ext) ? 'sheet' : ['pptx', 'odp'].includes(ext) ? 'slides' : ext === 'zip' ? 'zip' : 'text';
// tệp bên trong ZIP mà AIVN đọc được (không đọc ảnh/âm thanh/video lồng trong tệp nén)
const innerSupported = (n) => { const e = extOf(n); return TEXT_EXT.has(e) || OFFICE_EXT.has(e) || e === 'pdf' || e === 'docx'; };

// Đọc một tệp đã nằm trong bộ nhớ (dùng chung cho tệp thường và tệp trong ZIP)
async function extractBuffer(name, ext, buf, { depth = 0 } = {}) {
  const O = require('./office');
  const wrap = (label, p) => p.catch((e) => { if (e instanceof DocError) throw e; if (e && e.userMessage) throw new DocError(e.userMessage.includes(name) ? e.userMessage : `"${name}": ${e.userMessage}`); throw new DocError(`Không đọc được ${label} "${name}". Tệp có thể bị hỏng${label === 'PDF' ? ' hoặc có mật khẩu' : ''}.`); });
  if (ext === 'pdf') return wrap('PDF', extractPdf(buf));
  if (ext === 'docx') return wrap('DOCX', extractDocx(buf));
  if (ext === 'xlsx' || ext === 'xlsm') return wrap('bảng tính', Promise.resolve().then(() => O.xlsx(buf)));
  if (ext === 'pptx') return wrap('bản trình chiếu', Promise.resolve().then(() => O.pptx(buf)));
  if (ext === 'odt' || ext === 'ods' || ext === 'odp') return wrap('tệp OpenDocument', Promise.resolve().then(() => O.odf(buf, ext)));
  if (ext === 'zip') {
    if (depth > 0) return { text: '[tệp nén lồng bên trong: chỉ liệt kê, không mở]' };
    return wrap('tệp nén', O.zip(buf, Object.assign(async (n, b) => { const r = await extractBuffer(path.basename(n), extOf(n), Buffer.from(b.buffer, b.byteOffset, b.length), { depth: depth + 1 }); return r.scanned ? { text: '[PDF scan bên trong tệp nén: hãy giải nén và gửi riêng để AIVN đọc chữ bằng OCR]' } : r; }, { supports: innerSupported })));
  }
  if (LEGACY[ext]) throw new DocError(`Định dạng .${ext} cũ chưa được hỗ trợ. Hãy lưu "${name}" thành .${LEGACY[ext]} rồi gửi lại.`);
  if (TEXT_EXT.has(ext) || ext === '') return { text: decodeText(buf) };
  throw new DocError(`Định dạng .${ext} chưa được hỗ trợ. AIVN đọc được PDF (kể cả bản scan), Word (DOCX/ODT), Excel (XLSX/ODS), PowerPoint (PPTX/ODP), ZIP, âm thanh, video, ảnh, TXT/MD/CSV/JSON và tệp mã nguồn.`);
}

async function extractFile(file) {
  const name = path.basename(file);
  const ext = extOf(file);
  let st;
  try { st = fs.statSync(file); } catch { throw new DocError(`Không mở được tệp "${name}".`); }
  if (!st.isFile()) throw new DocError(`"${name}" không phải là tệp.`);
  if (IMAGE_EXT.has(ext)) throw new DocError(OCR_EXT.has(ext) ? `"${name}" là ảnh, AIVN sẽ đọc chữ trong ảnh bằng OCR.` : `AIVN chưa đọc được định dạng ảnh .${ext} ("${name}"). Hãy dùng PNG, JPG, WEBP, GIF hoặc BMP.`);
  if (AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext)) throw new DocError(`"${name}" là ${AUDIO_EXT.has(ext) ? 'âm thanh' : 'video'}: AIVN xử lý bằng mô hình nghe.`);
  const limit = ARCHIVE_EXT.has(ext) ? MAX_ARCHIVE_BYTES : MAX_FILE_BYTES;
  if (st.size > limit) throw new DocError(`"${name}" quá lớn (${(st.size / 1048576).toFixed(1)} MB). Giới hạn là ${limit / 1048576} MB mỗi tệp${ARCHIVE_EXT.has(ext) ? ' nén' : ''}.`);
  if (st.size === 0) throw new DocError(`"${name}" là tệp rỗng.`);
  const r = await extractBuffer(name, ext, fs.readFileSync(file));
  const base = { name, path: file, size: st.size, ext, kind: KIND(ext), pages: r.pages || null, unit: r.unit || null };
  if (r.scanned) return { ...base, scanned: r.scanned, text: '', chars: 0 };
  const text = String(r.text || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new DocError(`"${name}" không có nội dung chữ.`);
  return { ...base, text, chars: text.length, files: r.files || null };
}

// ---------- Đóng gói tài liệu vào prompt ----------
const STOP = new Set('và của là có cho các những được trong với này đó một không thì mà để khi như về từ ra vào lại cũng đã sẽ đang rất nào gì sao bao nhiêu hãy giúp mình tôi bạn em anh chị cái file tệp tài liệu nội dung the a an of to in is are and or what how which who why does do this that'.split(' '));
const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
function keywords(q) {
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(words.flatMap((w) => [w, strip(w)]))];
}
function chunkText(text, size = 900) {
  const paras = text.split(/\n{2,}|\n(?=\[Trang \d+\])/);
  const chunks = []; let cur = '';
  for (const p of paras) {
    if (p.length > size) { if (cur) { chunks.push(cur); cur = ''; } for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size)); continue; }
    if ((cur + '\n\n' + p).length > size && cur) { chunks.push(cur); cur = p; } else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
function scoreChunk(chunk, kws) {
  const lc = chunk.toLowerCase(), ls = strip(lc);
  let s = 0;
  for (const k of kws) { const hay = /[\u0300-\u036f]|[^\x00-\x7f]/.test(k) ? lc : ls; let i = 0, n = 0; while ((i = hay.indexOf(k, i)) >= 0 && n < 20) { n++; i += k.length; } s += n * Math.min(3, k.length / 3); }
  return s;
}

/**
 * docs: [{name, text, kind, pages}] ; budgetTokens: số token dành cho tài liệu ; countTokens(text) -> số token
 * Trả về { block, truncated, files: [{name, usedPct, truncated}] }
 */
function packDocuments(question, docs, budgetTokens, countTokens) {
  const est = countTokens || ((t) => Math.ceil(t.length / 3));
  // Ảnh: mô hình không nhìn được ảnh, chỉ nhận chữ AIVN đọc được bằng OCR
  const header = (d, part) => d.kind === 'image'
    ? `<<<CHỮ ĐỌC ĐƯỢC TRONG ẢNH (OCR, có thể sai sót): ${d.name}${part ? ' (chỉ trích một phần)' : ''}>>>`
    : `<<<TÀI LIỆU: ${d.name}${part ? ' (chỉ trích một phần)' : ''}>>>`;
  const footerOf = (d) => (d.kind === 'image' ? '<<<HẾT ẢNH>>>' : '<<<HẾT TÀI LIỆU>>>');
  const fullBlocks = docs.map((d) => `${header(d, false)}\n${d.text.trim()}\n${footerOf(d)}`);
  if (est(fullBlocks.join('\n\n')) <= budgetTokens) return { block: fullBlocks.join('\n\n'), truncated: false, files: docs.map((d) => ({ name: d.name, usedPct: 100, truncated: false })) };

  const kws = keywords(question);
  const per = Math.max(200, Math.floor(budgetTokens / docs.length));
  const files = []; const blocks = [];
  for (const d of docs) {
    const chunks = chunkText(d.text.trim());
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const chosen = new Set();
    let used = est(header(d, true) + footerOf(d)) + 10;
    const tryAdd = (i) => { if (chosen.has(i)) return true; const t = est(chunks[i]) + 4; if (used + t > per) return false; chosen.add(i); used += t; return true; };
    // 1) phần mở đầu (tiêu đề, mục lục, giới thiệu)
    for (let i = 0; i < Math.min(2, chunks.length); i++) tryAdd(i);
    // 2) các đoạn liên quan nhất tới câu hỏi
    const ranked = chunks.map((c, i) => ({ i, s: scoreChunk(c, kws) })).filter((x) => x.s > 0 && !chosen.has(x.i)).sort((a, b) => b.s - a.s);
    for (const r of ranked) { if (!tryAdd(r.i) && used > per * 0.95) break; if (r.i + 1 < chunks.length) tryAdd(r.i + 1); }
    // 3) còn chỗ thì lấp tiếp theo thứ tự
    for (let i = 0; i < chunks.length && used < per * 0.9; i++) tryAdd(i);
    const idx = [...chosen].sort((a, b) => a - b);
    const truncated = idx.length < chunks.length;
    let body = ''; let prev = -1;
    for (const i of idx) { if (prev >= 0 && i !== prev + 1) body += '\n\n[...]\n\n'; else if (prev >= 0) body += '\n\n'; body += chunks[i]; prev = i; }
    if (idx.length && idx[idx.length - 1] !== chunks.length - 1) body += '\n\n[...]';
    const usedChars = idx.reduce((a, i) => a + chunks[i].length, 0);
    files.push({ name: d.name, usedPct: total ? Math.round((usedChars / total) * 100) : 100, truncated });
    blocks.push(`${header(d, truncated)}\n${body}\n${footerOf(d)}`);
  }
  return { block: blocks.join('\n\n'), truncated: files.some((f) => f.truncated), files };
}

function buildUserContent(question, packedBlock) {
  if (!packedBlock) return question;
  return `Dưới đây là nội dung tài liệu người dùng gửi kèm. Hãy dựa vào tài liệu để trả lời; nếu tài liệu không có thông tin, hãy nói rõ. Phần chữ đọc từ ảnh (OCR) có thể có lỗi chính tả nhỏ.\n\n${packedBlock}\n\nCâu hỏi: ${question}`;
}

module.exports = { OCR_EXT, OFFICE_EXT, AUDIO_EXT, VIDEO_EXT, ARCHIVE_EXT, extOf, extractBuffer, extractFile, packDocuments, buildUserContent, keywords, scoreChunk, chunkText, DocError, MAX_FILE_BYTES, IMAGE_EXT, TEXT_EXT };
