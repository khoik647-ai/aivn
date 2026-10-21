// chạy bằng Electron: node_modules/.bin/electron test/fixtures/b56-ocr.js — in JSON kết quả OCR thường và OCR khối màu
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const ocr = require(path.join(__dirname, '../../src/ocr')); const OB = require(path.join(__dirname, '../../src/agent/ocr-boost'));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 700, height: 180, show: true });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="margin:20px;font:15px sans-serif"><button style="background:#0f6cbd;color:#fff;border:0;border-radius:4px;padding:8px 14px;font-size:14px">✉ Thư mới</button> <span style="margin-left:30px">Hộp thư đến</span> <button style="background:#1a73e8;color:#fff;border:0;padding:8px 14px">Gửi</button></body>'));
  await new Promise(r => setTimeout(r, 800));
  const img = await w.webContents.capturePage();
  const plain = (await ocr.recognizeLines(img.resize({ width: img.getSize().width * 2, quality: 'best' }).toPNG())).lines.map(l => l.text);
  const boosted = [];
  for (const bx of OB.coloredBlocks(img)) boosted.push(...(await ocr.recognizeLines(OB.invertForOcr(nativeImage, img.crop(bx).resize({ width: bx.width * 3, quality: 'best' })).toPNG())).lines.map(l => l.text));
  process.stdout.write('B56RESULT ' + JSON.stringify({ plain, boosted }) + '\n'); app.quit();
});
