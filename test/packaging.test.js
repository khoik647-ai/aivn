// 0.15.1 — hồi quy: 0.15.0 trên Windows/macOS không nạp được mô hình nào ("Bộ máy AI đã đóng đột ngột (mã 1)")
// vì engine.js require('./agent/sampling') nhưng tệp đó KHÔNG nằm trong asarUnpack → Node thuần chạy engine-host không tìm thấy mô-đun.
// Bài này bắt mọi require tương đối của các tệp chạy ngoài asar phải cũng được giải nén.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');
const unpack = pkg.build.asarUnpack;
const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*') + '$');
const isUnpacked = (rel) => unpack.some(g => globToRe(g).test(rel));
function relRequires(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8'); const out = [];
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    let t = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
    if (!/\.(js|json|node)$/.test(t)) t = fs.existsSync(path.join(ROOT, t + '.js')) ? t + '.js' : fs.existsSync(path.join(ROOT, t + '.json')) ? t + '.json' : t + '/index.js';
    out.push(t);
  }
  return out;
}
test('mọi mô-đun mà engine-host cần đều được giải nén ra ngoài asar (Node thuần không đọc được asar)', () => {
  const seen = new Set(); const queue = ['src/engine-host.js']; const missing = [];
  while (queue.length) {
    const f = queue.shift(); if (seen.has(f)) continue; seen.add(f);
    if (!isUnpacked(f)) missing.push(f);
    if (/\.js$/.test(f) && fs.existsSync(path.join(ROOT, f))) queue.push(...relRequires(f));
  }
  assert.deepStrictEqual(missing, [], 'thiếu trong build.asarUnpack: ' + missing.join(', '));
  assert.ok(seen.has('src/agent/sampling.js'));
});
test('thông báo lỗi khi bộ máy sập nêu dòng lỗi thật', () => {
  const { firstErrorLine } = require('../src/engine-proxy');
  const err = "node:internal/modules/cjs/loader:1215\n  throw err;\n  ^\n\nError: Cannot find module './agent/sampling'\nRequire stack:\n- C:\\app\\engine.js";
  assert.strictEqual(firstErrorLine(err), "Error: Cannot find module './agent/sampling'");
});
