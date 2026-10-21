'use strict';
// 0.16 — tệp đính kèm mới: Office/OpenDocument, ZIP, PDF scan (OCR)
const test = require('node:test'); const assert = require('node:assert'); const path = require('path');
const { extractFile } = require('../src/docs');
const F = (n) => path.join(__dirname, 'fixtures', n);
test('XLSX: tên trang tính, ô tiếng Việt, ngày tháng dd/mm/yyyy', async () => {
  const r = await extractFile(F('bang.xlsx')); assert.strictEqual(r.kind, 'sheet');
  assert.match(r.text, /\[Trang tính: bang\]/); assert.match(r.text, /Trần Thị Bình\t02\/11\/2003\t9/);
});
test('ODS', async () => { assert.match((await extractFile(F('bang.ods'))).text, /Lê Hoàng Cường\t2004-07-21\t7.25/); });
test('PPTX và ODP: thứ tự trang chiếu và ghi chú', async () => {
  for (const f of ['slides.pptx', 'slides.odp']) {
    const r = await extractFile(F(f)); assert.strictEqual(r.pages, 2, f);
    assert.match(r.text, /\[Trang chiếu 1\]\nKế hoạch học kỳ 2\nMôn Trí tuệ nhân tạo & Học máy\nGhi chú: Nhớ nhắc lịch thi ngày 12\/12/, f);
    assert.match(r.text, /\[Trang chiếu 2\]\nNgân sách: 1.766.000 đồng/, f);
  }
});
test('ODT: đoạn văn và bảng', async () => { const r = await extractFile(F('van.odt')); assert.match(r.text, /Nhóm đã hoàn thành phần giao diện/); assert.match(r.text, /Kiểm thử\tKhôi/); });
test('ZIP: liệt kê mọi tệp, đọc tệp văn bản bên trong, bỏ qua ảnh', async () => {
  const r = await extractFile(F('goi.zip')); assert.strictEqual(r.kind, 'zip');
  assert.match(r.text, /\[Nội dung tệp nén: 3 tệp\]/); assert.match(r.text, /=== bang.csv ===\nHọ và tên/); assert.match(r.text, /- scan1.png/); assert.doesNotMatch(r.text, /=== scan1.png/);
});
test('ZIP: chặn "bom nén" (tỉ lệ nén bất thường)', async () => {
  const { zipSync } = require('fflate'); const fs = require('fs'), os = require('os');
  const p = path.join(os.tmpdir(), 'aivn-bomb.zip'); fs.writeFileSync(p, zipSync({ 'a.txt': new Uint8Array(70 * 1048576) }, { level: 9 }));
  await assert.rejects(extractFile(p), (e) => /quá lớn khi giải nén/.test(e.userMessage)); fs.unlinkSync(p);
});
test('Định dạng cũ .xls/.ppt: hướng dẫn lưu lại', async () => {
  const fs = require('fs'), os = require('os'); const p = path.join(os.tmpdir(), 'aivn-x.xls'); fs.writeFileSync(p, 'x');
  await assert.rejects(extractFile(p), (e) => /lưu .* thành \.xlsx/.test(e.userMessage)); fs.unlinkSync(p);
});
test('PDF scan (JPEG và 1 bit Group4): OCR đọc đúng chữ tiếng Việt', async () => {
  const O = require('../src/ocr');
  try {
    const a = await extractFile(F('scan.pdf')); assert.strictEqual(a.scanned.length, 2);
    const t1 = await O.recognize(a.scanned[0].png); assert.match(t1.text, /Trần Quỳnh Anh/); assert.match(t1.text, /1\.250\.000/);
    const t2 = await O.recognize(a.scanned[1].png); assert.match(t2.text, /30 ngày/);
    const g = await extractFile(F('scan-g4.pdf')); const t3 = await O.recognize(g.scanned[0].png); assert.match(t3.text, /HOÁ ĐƠN BÁN HÀNG/);
  } finally { await O.terminate(); }
});
