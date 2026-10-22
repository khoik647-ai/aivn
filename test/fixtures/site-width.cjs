// B162: đo scrollWidth của trang web ở các bề rộng nhỏ (vi/en/zh, menu đóng/mở). Dùng: electron site-width.cjs FILE.html 280,320 → in JSON
const { app, BrowserWindow } = require('electron');
const [file, widths] = process.argv.slice(-2);
app.on('window-all-closed', () => {}); // giữ app giữa các cửa sổ đo
app.whenReady().then(async () => {
  process.on('unhandledRejection', (e) => { process.stdout.write('ERROR ' + e + '\n'); app.exit(2); });
  const out = [];
  for (const w of widths.split(',').map(Number)) for (const lang of ['vi', 'en', 'zh']) {
    const win = new BrowserWindow({ show: false, useContentSize: true, width: w, height: 653, webPreferences: { offscreen: true } });
    await win.loadFile(file, { query: { lang } }).catch(() => {});
    await new Promise(r => win.webContents.isLoading() ? win.webContents.once('did-stop-loading', r) : r());
    await win.webContents.insertCSS('::-webkit-scrollbar{width:0!important;height:0!important}html{scrollbar-width:none}'); // như điện thoại: thanh cuộn nổi, không chiếm bề rộng
    const r = await win.webContents.executeJavaScript(`new Promise(res=>setTimeout(()=>{const d=document.documentElement;const a={sw:d.scrollWidth,cw:d.clientWidth,iw:innerWidth};
      const b=document.getElementById('burger'); if(b)b.click(); setTimeout(()=>{a.swMenu=d.scrollWidth;res(a)},300)},300))`);
    out.push({ w, lang, ...r }); win.destroy();
  }
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n'); app.quit();
});
