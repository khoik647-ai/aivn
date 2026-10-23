// B162 (#32): màn 280 px (Galaxy Fold) không tràn ngang, chữ và nút không tràn khung.
// site_check có ca Playwright 280/320/390 × vi/en/zh; dải hẹp bắt đầu từ 280, không từ 320.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
const check = fs.readFileSync(path.join(root, 'tools/site_check.py'), 'utf8');

test('B162: CSS ≤380 px giữ nút mã, dòng bước và thẻ tính năng trong khung', () => {
  const i = html.indexOf('/* B162: Fold 280 px');
  assert.ok(i > html.indexOf('/*END-FIX-280*/'), 'khối 280 px của hộp phải đứng sau FIX-280 của đầu trang');
  const block = html.slice(i, html.indexOf('</style>', i));
  assert.match(block, /@media \(max-width:380px\)/);
  assert.match(block, /\.code-tabs\{flex-wrap:wrap;max-width:100%\}/);
  assert.match(block, /\.code-tabs \.copy\{margin-left:0\}/);
  assert.match(block, /\.steps-mock \.st em\{flex:1 0 100%;min-width:0;overflow-wrap:anywhere\}/);
  assert.match(block, /\.feat,\.model\{min-width:0;max-width:100%\}/);
  assert.strictEqual((html.match(/\/\*AIVN-FIX-280\*\//g) || []).length, 1, 'không nhân đôi dấu FIX-280');
  assert.ok(html.includes('NGUYỄN NGỌC KHÔI SINH VIÊN VLU'), 'dòng ghi công giữ nguyên');
});

test('B162: site_check đo từ 280 px cho vi/en/zh, không bắt đầu từ 320', () => {
  assert.match(check, /NARROW = \[280, 320, 390\]/);
  assert.ok(check.includes("('fold-280', dict(viewport={'width': 280"), 'vẫn có máy Fold 280');
  assert.match(check, /for w in NARROW:/);
  assert.match(check, /for lang in \('vi', 'en', 'zh'\)/);
  assert.match(check, /nút tải chính/);
  assert.match(check, /điều khiển <24px/);
  const narrow = check.match(/NARROW = \[(\d+),/)[1];
  assert.strictEqual(narrow, '280');
});
