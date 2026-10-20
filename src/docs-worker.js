// Luồng phụ đọc tài liệu (PDF/DOCX/văn bản): không chặn tiến trình chính khi tệp lớn
const { parentPort } = require('worker_threads');
const docs = require('./docs');
parentPort.on('message', async ({ id, file }) => {
  try { parentPort.postMessage({ id, ok: true, result: await docs.extractFile(file) }); }
  catch (e) { parentPort.postMessage({ id, ok: false, error: { message: e.message, userMessage: e.userMessage || null } }); }
});
