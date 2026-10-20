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

async function terminate() { clearTimeout(idleTimer); const w = workerP; workerP = null; try { (await w)?.terminate(); } catch {} }

module.exports = { recognize, terminate };
