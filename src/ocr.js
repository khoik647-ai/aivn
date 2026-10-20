// Đọc chữ trong ảnh (OCR) hoàn toàn ngoại tuyến: tesseract.js + dữ liệu tiếng Việt và tiếng Anh đi kèm ứng dụng.
const fs = require('fs');
const path = require('path');

let workerP = null;
let idleTimer = null;

const LANGS = ['vie', 'eng'];
// Gom dữ liệu ngôn ngữ đi kèm (gói @tesseract.js-data) vào một thư mục cục bộ để tesseract.js đọc từ đĩa
function langDir() {
  const dir = path.join(require('os').tmpdir(), 'aivn-tessdata-4.0.0_best_int');
  fs.mkdirSync(dir, { recursive: true });
  for (const code of LANGS) {
    const src = path.join(path.dirname(require.resolve(`@tesseract.js-data/${code}/package.json`)), '4.0.0_best_int', `${code}.traineddata.gz`);
    const dst = path.join(dir, `${code}.traineddata.gz`);
    try { if (fs.statSync(dst).size === fs.statSync(src).size) continue; } catch {}
    fs.copyFileSync(src, dst);
  }
  return dir;
}

async function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker, OEM } = require('tesseract.js');
      // Không tải gì từ mạng: dữ liệu ngôn ngữ truyền trực tiếp, không dùng bộ nhớ đệm
      return createWorker(LANGS.join('+'), OEM.LSTM_ONLY, { langPath: langDir(), cacheMethod: 'none', gzip: true, logger: () => {}, errorHandler: () => {} });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

function scheduleIdle() { // giải phóng bộ nhớ sau 3 phút không dùng
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => { const w = workerP; workerP = null; try { (await w)?.terminate(); } catch {} }, 180000);
  idleTimer.unref?.();
}

// image: Buffer/Uint8Array (PNG/JPEG). Trả về { text, confidence, lines }
async function recognize(image) {
  const w = await getWorker();
  try {
    const { data } = await w.recognize(Buffer.from(image));
    const text = String(data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text, confidence: Math.round(data.confidence || 0), chars: text.replace(/\s/g, '').length };
  } finally { scheduleIdle(); }
}

// Chữ kèm vị trí (từng dòng): dùng để mô hình không nhìn ảnh vẫn bấm được vào chữ trên màn hình
async function recognizeLines(image, { minConf = 45 } = {}) {
  const w = await getWorker();
  try {
    const { data } = await w.recognize(Buffer.from(image), {}, { blocks: true, text: true });
    const lines = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      // tách dòng thành các cụm chữ cách xa nhau (vd. các nút trên thanh công cụ nằm cùng một dòng)
      const words = (l.words || []).filter(wd => String(wd.text || '').trim());
      const lh = Math.max(8, l.bbox.y1 - l.bbox.y0); const segs = []; let cur = null;
      for (const wd of words) {
        if (!cur || wd.bbox.x0 - cur.x1 > lh * 0.9) { cur = { words: [], x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1, conf: 0 }; segs.push(cur); }
        cur.words.push(wd.text); cur.x1 = Math.max(cur.x1, wd.bbox.x1); cur.y0 = Math.min(cur.y0, wd.bbox.y0); cur.y1 = Math.max(cur.y1, wd.bbox.y1); cur.conf += wd.confidence || 0;
      }
      if (!words.length) segs.push({ words: [l.text], x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, conf: (l.confidence || 0) });
      for (const sg of segs) {
        const t = sg.words.join(' ').replace(/\s+/g, ' ').trim(); const conf = words.length ? sg.conf / sg.words.length : sg.conf;
        if (!t || conf < minConf || t.replace(/[^\p{L}\p{N}]/gu, '').length < 2) continue;
        lines.push({ text: t.slice(0, 160), conf: Math.round(conf), box: [sg.x0, sg.y0, sg.x1 - sg.x0, sg.y1 - sg.y0] });
      }
    }
    return { text: String(data.text || '').trim(), lines };
  } finally { scheduleIdle(); }
}

async function terminate() { clearTimeout(idleTimer); const w = workerP; workerP = null; try { (await w)?.terminate(); } catch {} }

module.exports = { recognize, recognizeLines, terminate };
