// 0.16 Kinh doanh — xuất PDF chứng từ (báo giá, hoá đơn, phiếu kho, đơn mua) bằng Chromium (webContents.printToPDF), khổ A4, có số trang.
// Mẫu HTML ở src/crm/print.js. Cửa sổ ẩn, không chạy JavaScript, không tải gì từ mạng (CSP chặn hết, ảnh logo là data: URL).
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');

function registerBizPdf({ ipcMain, BrowserWindow, dialog, shell, getWin, getCrm, T, uiLang, log = () => {} }) {
  async function toPdf(html, { footer = '' } = {}) {
    const tmp = path.join(os.tmpdir(), `aivn-doc-${process.pid}-${Date.now()}-${require('crypto').randomBytes(4).toString('hex')}.html`);
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">';
    fs.writeFileSync(tmp, html.replace('<head>', '<head>' + csp));
    const w = new BrowserWindow({ show: false, width: 794, height: 1123, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: false } });
    try {
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); w.webContents.on('will-navigate', (e) => e.preventDefault());
      await w.loadFile(tmp);
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      return await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;font:8px Arial,sans-serif;color:#666;padding:0 14mm;display:flex;justify-content:space-between"><span>${esc(footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>` });
    } finally { try { w.destroy(); } catch {} try { fs.unlinkSync(tmp); } catch {} }
  }
  // { type: quote|invoice|picking|purchase, id, lang?, save?: false → chỉ trả HTML (xem trước / kiểm thử) }
  ipcMain.handle('biz:pdf', async (_e, { type, id, lang } = {}) => {
    try {
      if (!['quote', 'invoice', 'picking', 'purchase'].includes(type) || typeof id !== 'string') return { ok: false, error: T('Chứng từ không hợp lệ.') };
      const c = await getCrm(); const L = ['vi', 'en', 'zh'].includes(lang) ? lang : uiLang();
      const doc = require('./crm/print').renderDoc(c.biz, c, type, id, L);
      const pdf = await toPdf(doc.html, { footer: `${doc.number || ''} · AIVN` });
      let file;
      const qaDir = process.env.AIVN_QA_PDF_DIR;
      if (qaDir) { fs.mkdirSync(qaDir, { recursive: true }); file = path.join(qaDir, `${L}-${doc.name}`); }
      else {
        const r = await dialog.showSaveDialog(getWin(), { buttonLabel: T('Lưu'), title: T('Lưu chứng từ PDF'), defaultPath: path.join(require('electron').app.getPath('documents'), doc.name), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (r.canceled || !r.filePath) return { ok: false, canceled: true };
        file = r.filePath;
      }
      fs.writeFileSync(file, pdf);
      if (!qaDir) shell.openPath(file).catch(() => {});
      log(`biz:pdf ${type} ${doc.number || id} → ${file} (${pdf.length} B)`);
      return { ok: true, file, bytes: pdf.length };
    } catch (e) { return { ok: false, error: e.userMessage || e.message }; }
  });
  return { toPdf };
}
module.exports = { registerBizPdf };
