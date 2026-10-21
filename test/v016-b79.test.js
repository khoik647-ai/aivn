'use strict';
// QA lượt 8 B79: xoá mô hình chỉ xoá tệp .gguf, bỏ lại mmproj (hàng trăm MB) và thư mục rỗng
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const MD = require('../src/models-dir');
test('B79: xoá mô hình → xoá cả mmproj không dùng chung và thư mục trống; mmproj dùng chung thì giữ; không đụng ngoài thư mục mô hình', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b79-')); const w = (f) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); return f; };
  const a = { id: 'a', path: w(path.join(root, 'org', 'repoA', 'a.gguf')), mmproj: w(path.join(root, 'org', 'repoA', 'mmproj-a.gguf')) };
  const b1 = { id: 'b1', path: w(path.join(root, 'org', 'repoB', 'b-Q4.gguf')), mmproj: w(path.join(root, 'org', 'repoB', 'mmproj-b.gguf')) };
  const b2 = { id: 'b2', path: w(path.join(root, 'org', 'repoB', 'b-Q8.gguf')), mmproj: b1.mmproj };
  const sp = { id: 's', path: w(path.join(root, 'sp', 'x-00001-of-00002.gguf')) }; w(path.join(root, 'sp', 'x-00002-of-00002.gguf'));
  const outside = w(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b79o-')), 'mm.gguf')); const imp = { id: 'i', path: w(path.join(root, 'i', 'i.gguf')), mmproj: outside };
  const all = [a, b1, b2, sp, imp];
  assert.strictEqual(MD.deleteModelFiles(a, all, root).length, 2); assert.ok(!fs.existsSync(path.join(root, 'org', 'repoA')), 'thư mục trống đã dọn'); assert.ok(fs.existsSync(path.join(root, 'org')));
  MD.deleteModelFiles(b1, all, root); assert.ok(fs.existsSync(b1.mmproj), 'mmproj dùng chung với b2 phải giữ'); assert.ok(fs.existsSync(b2.path));
  MD.deleteModelFiles(b2, all.filter(x => x !== b1), root); assert.ok(!fs.existsSync(b1.mmproj)); assert.ok(!fs.existsSync(path.join(root, 'org')));
  MD.deleteModelFiles(sp, all, root); assert.ok(!fs.existsSync(path.join(root, 'sp')), 'xoá mọi phần của mô hình tách');
  MD.deleteModelFiles(imp, all, root); assert.ok(fs.existsSync(outside), 'không xoá tệp ngoài thư mục mô hình'); assert.ok(fs.existsSync(root));
});
