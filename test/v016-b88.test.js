// B88: sau nâng cấp (hoặc tệp cũ không BOM) → xoay tệp cũ, tệp mới UTF-8 có BOM.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const fresh = () => { delete require.cache[require.resolve('../src/logger')]; return require('../src/logger'); };
const bom = (f) => fs.readFileSync(f).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));

test('B88: tệp cũ không BOM (bản trước) → xoay sang .1, tệp mới có BOM, tiếng Việt đọc đúng', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b88-'));
  fs.writeFileSync(path.join(d, 'aivn.log'), '2026-10-01 [app] dòng cũ không BOM\n', 'utf8');
  const L = fresh(); L.init(d, '0.16.0-beta.3'); L.log('app', 'Xin chào tiếng Việt');
  const f = path.join(d, 'aivn.log');
  assert.ok(bom(f)); assert.ok(!bom(f + '.1')); assert.match(fs.readFileSync(f + '.1', 'utf8'), /dòng cũ/);
  const t = fs.readFileSync(f, 'utf8'); assert.match(t, /xoay vòng: aivn\.log → aivn\.log\.1/); assert.match(t, /Xin chào tiếng Việt/); assert.doesNotMatch(t, /dòng cũ/);
  assert.match(L.tail(50), /dòng cũ[\s\S]*Xin chào/, 'tail vẫn đọc nối tệp .1');
  assert.strictEqual(fs.readFileSync(path.join(d, '.version'), 'utf8'), '0.16.0-beta.3');
});

test('B88: cùng phiên bản + có BOM → nối tiếp; đổi phiên bản → tệp mới', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b88-'));
  let L = fresh(); L.init(d, '1.0.0'); L.log('app', 'một');
  L = fresh(); L.init(d, '1.0.0'); L.log('app', 'hai');
  const f = path.join(d, 'aivn.log');
  assert.ok(!fs.existsSync(f + '.1')); assert.match(fs.readFileSync(f, 'utf8'), /một[\s\S]*hai/); assert.ok(bom(f));
  assert.strictEqual((fs.readFileSync(f, 'utf8').match(/\ufeff/g) || []).length, 1, 'chỉ một BOM ở đầu');
  L = fresh(); L.init(d, '1.0.1'); L.log('app', 'ba');
  assert.match(fs.readFileSync(f + '.1', 'utf8'), /hai/); const t = fs.readFileSync(f, 'utf8');
  assert.ok(bom(f)); assert.match(t, /nâng cấp 1\.0\.0 → 1\.0\.1/); assert.doesNotMatch(t, /hai/);
  assert.ok(bom(path.join(d, 'engine.log')));
});

test('B88: thư mục mới tinh — không xoay, không dòng thông báo', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b88-'));
  const L = fresh(); L.init(d, '1.0.0'); const f = path.join(d, 'aivn.log');
  assert.ok(!fs.existsSync(f + '.1')); assert.strictEqual(fs.readFileSync(f, 'utf8'), '\ufeff');
});
