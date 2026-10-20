// Kiểm thử trích xuất & đóng gói tài liệu: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { extractFile, packDocuments, buildUserContent, DocError } = require('../src/docs');
const F = (n) => path.join(__dirname, 'fixtures', n);

test('TXT tiếng Việt', async () => {
  const r = await extractFile(F('quy-che.txt'));
  assert.equal(r.kind, 'text'); assert.match(r.text, /tối đa 5 cuốn/);
});
test('DOCX', async () => {
  const r = await extractFile(F('quy-che.docx'));
  assert.equal(r.kind, 'docx'); assert.match(r.text, /2\.000 đồng/); assert.match(r.text, /Giờ mở cửa/);
});
test('PDF có lớp chữ', async () => {
  const r = await extractFile(F('quy-che.pdf'));
  assert.equal(r.kind, 'pdf'); assert.equal(r.pages, 1);
  assert.match(r.text, /7 giờ 30 đến 21 giờ/); assert.match(r.text, /\[Trang 1\]/);
});
test('PDF scan không có chữ -> thông báo tiếng Việt', async () => {
  await assert.rejects(extractFile(F('scan-khong-chu.pdf')), (e) => e instanceof DocError && /không có lớp chữ/.test(e.userMessage));
});
test('Ảnh không đi đường tài liệu (chuyển sang OCR); định dạng lạ bị từ chối rõ ràng', async () => {
  await assert.rejects(extractFile(F('anh.png')), (e) => /OCR/.test(e.userMessage));
  const fs = require('fs'), os = require('os'); const p = path.join(os.tmpdir(), 'aivn-x.heic'); fs.writeFileSync(p, 'x');
  await assert.rejects(extractFile(p), (e) => /chưa đọc được định dạng ảnh \.heic/.test(e.userMessage)); fs.unlinkSync(p);
});
test('CSV', async () => { assert.match((await extractFile(F('diem.csv'))).text, /Binh,7/); });
test('Tệp > 20 MB bị từ chối', async () => {
  const fs = require('fs'), os = require('os'); const p = path.join(os.tmpdir(), 'aivn-big.txt');
  fs.writeFileSync(p, Buffer.alloc(21 * 1024 * 1024, 97));
  await assert.rejects(extractFile(p), (e) => /Giới hạn là 20 MB/.test(e.userMessage)); fs.unlinkSync(p);
});
test('Đóng gói: tài liệu ngắn giữ nguyên', async () => {
  const d = await extractFile(F('quy-che.txt'));
  const r = packDocuments('Mượn được mấy cuốn?', [d], 2000);
  assert.equal(r.truncated, false); assert.match(r.block, /<<<TÀI LIỆU: quy-che.txt>>>/);
});
test('Đóng gói: tài liệu dài bị cắt nhưng giữ đoạn liên quan + phần đầu', async () => {
  const d = await extractFile(F('so-tay-dai.pdf'));
  assert.ok(d.pages > 3);
  const r = packDocuments('Giá in màu một trang là bao nhiêu?', [d], 1200);
  assert.equal(r.truncated, true); assert.ok(r.files[0].usedPct < 50);
  assert.match(r.block, /Sổ tay thư viện/);          // phần mở đầu
  assert.match(r.block, /1\.500 đồng một trang/);    // đoạn liên quan nằm sâu trong tệp
  assert.match(r.block, /chỉ trích một phần/); assert.match(r.block, /\[\.\.\.\]/);
  assert.match(buildUserContent('Q?', r.block), /Câu hỏi: Q\?$/);
});
