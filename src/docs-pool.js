// Đọc tài liệu trong worker_threads; lỗi tạo luồng → đọc ngay trong tiến trình (như cũ)
const path = require('path');
const docs = require('./docs');
let worker = null, seq = 0, broken = false; const pending = new Map(); let idleT = null;
function getWorker() {
  if (worker || broken) return worker;
  try {
    const { Worker } = require('worker_threads');
    const file = path.join(__dirname, 'docs-worker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    worker = new Worker(file);
    worker.on('message', ({ id, ok, result, error }) => { const p = pending.get(id); if (!p) return; pending.delete(id); if (!pending.size && worker) worker.unref(); if (ok) p.resolve(result); else { const e = new docs.DocError(error.userMessage || error.message); if (!error.userMessage) e.userMessage = undefined; p.reject(e); } armIdle(); });
    const die = (e) => { for (const p of pending.values()) p.fallback(); pending.clear(); worker = null; if (e) broken = true; };
    worker.on('error', die); worker.on('exit', () => die(null));
    worker.unref();
  } catch { broken = true; worker = null; }
  return worker;
}
// đóng luồng sau 60 giây rảnh để trả lại bộ nhớ (pdf.js khá nặng)
function armIdle() { clearTimeout(idleT); idleT = setTimeout(() => { if (worker && !pending.size) { worker.terminate().catch(() => {}); worker = null; } }, 60000); if (idleT.unref) idleT.unref(); }
function extractFile(file) {
  const w = getWorker();
  if (!w) return docs.extractFile(file);
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, fallback: () => docs.extractFile(file).then(resolve, reject) }); clearTimeout(idleT); w.ref(); w.postMessage({ id, file }); });
}
module.exports = { extractFile };
