const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ocr = require('../src/ocr');
const { packDocuments, buildUserContent } = require('../src/docs');
const F = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n));
test.after(() => ocr.terminate());

for (const f of ['lich-thi.png', 'lich-thi.jpg', 'lich-thi.webp']) {
  test(`OCR tiếng Việt ngoại tuyến: ${f}`, async () => {
    const r = await ocr.recognize(F(f));
    assert.match(r.text, /Cấu trúc dữ liệu và giải thuật/);
    assert.match(r.text, /15\/12\/2026/);
    assert.match(r.text, /phòng B\.204/);
    assert.match(r.text, /thẻ sinh viên/);
    assert.ok(r.confidence >= 80, 'độ tin cậy ' + r.confidence);
  });
}

test('Ảnh không có chữ -> văn bản rỗng', async () => {
  const r = await ocr.recognize(F('anh.png'));
  assert.ok(r.chars < 5);
});

test('Chữ OCR được đóng gói với nhãn ảnh riêng', () => {
  const p = packDocuments('Thi ở phòng nào?', [{ name: 'lich-thi.png', kind: 'image', text: 'Ngày thi 15/12, phòng B.204' }], 2000, (t) => Math.ceil(t.length / 3));
  assert.match(p.block, /<<<CHỮ ĐỌC ĐƯỢC TRONG ẢNH \(OCR, có thể sai sót\): lich-thi\.png>>>/);
  assert.match(p.block, /<<<HẾT ẢNH>>>/);
  assert.match(buildUserContent('Thi ở phòng nào?', p.block), /OCR\) có thể có lỗi chính tả nhỏ/);
});
