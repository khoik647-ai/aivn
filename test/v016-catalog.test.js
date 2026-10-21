'use strict';
// 0.16 — Kho mô hình mở rộng: mọi nhãn khả năng đều có nguồn, không gắn nhãn điều khiển màn hình cho mô hình chỉ đọc chữ.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const CATALOG = require('../src/catalog');
const { CLAIMS, TAGS, KIND, SCREEN_TAGS, VER } = require('../src/catalog-claims');
const hf = require('../src/hf');

test('mọi mô hình trong kho đều có nhãn kèm nguồn, và không có nhãn mồ côi', () => {
  const ids = new Set(CATALOG.map(c => c.id));
  assert.strictEqual(ids.size, CATALOG.length, 'trùng id');
  for (const c of CATALOG) assert.ok(c.claims.length > 0, `${c.id} chưa có nhãn nào`);
  for (const id of Object.keys(CLAIMS)) assert.ok(ids.has(id), `CLAIMS có ${id} nhưng kho không có`);
});

test('mỗi nhãn: loại hợp lệ, khoá nhãn đã biết, nguồn https; "Theo nhà phát triển" phải có câu trích', () => {
  for (const c of CATALOG) for (const cl of c.claims) {
    assert.ok(KIND[cl.k], `${c.id}: loại ${cl.k}`);
    assert.ok(TAGS[cl.t], `${c.id}: nhãn ${cl.t}`);
    assert.match(cl.src, /^https:\/\//, `${c.id}: nguồn`);
    if (cl.k === 'd') assert.ok(cl.q && cl.q.length >= 8, `${c.id}/${cl.t}: thiếu câu trích`);
    if (cl.k === 'v' || cl.k === 'x') { assert.ok(cl.src.startsWith(VER + '#'), `${c.id}/${cl.t}: kiểm chứng phải trỏ về docs/verified.md`); assert.ok(cl.note, `${c.id}/${cl.t}: thiếu ghi chú`); }
  }
});

test('nhãn kiểm chứng trỏ tới mục có thật trong docs/verified.md', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'verified.md'), 'utf8');
  const anchors = new Set([...md.matchAll(/<a id="([^"]+)"><\/a>/g)].map(m => m[1]));
  for (const c of CATALOG) for (const cl of c.claims) if (cl.k !== 'd') assert.ok(anchors.has(cl.src.split('#')[1]), `${c.id}: thiếu mục #${cl.src.split('#')[1]}`);
});

test('mô hình chỉ đọc chữ KHÔNG BAO GIỜ có nhãn định vị giao diện / điều khiển máy tính', () => {
  for (const c of CATALOG) {
    const screen = c.claims.filter(cl => SCREEN_TAGS.includes(cl.t));
    if (!c.vision) { assert.deepStrictEqual(screen, [], `${c.id} chỉ đọc chữ mà có nhãn màn hình`); assert.ok(!c.computer, `${c.id}: computer`); }
    if (c.vision) assert.ok(c.mmproj, `${c.id}: mô hình nhìn ảnh phải có mmproj`);
  }
});

test('nhãn hiển thị (tags) chỉ lấy từ nhãn đạt — nhãn "AIVN thử chưa đạt" không được hiện như khả năng', () => {
  for (const c of CATALOG) {
    const ok = new Set(c.claims.filter(x => x.k !== 'x').map(x => x.label));
    assert.deepStrictEqual(new Set(c.tags), ok, c.id);
    for (const cl of c.claims.filter(x => x.k === 'x')) if (!ok.has(cl.label)) assert.ok(!c.tags.includes(cl.label), c.id);
  }
});

test('mọi kiến trúc trong kho đều được llama.cpp đi kèm hỗ trợ; tệp và url khớp nhau', () => {
  for (const c of CATALOG) {
    assert.ok(hf.archSupported(c.arch), `${c.id}: kiến trúc ${c.arch}`);
    assert.ok(c.url.startsWith(`https://huggingface.co/${c.repo}/resolve/main/`) && c.url.endsWith(c.file), `${c.id}: url`);
    assert.ok(c.size > 1e8, `${c.id}: size`);
  }
});

test('điểm đo trên máy người dùng (lưu theo id tệp đã cài) hiện đúng trên thẻ Kho mô hình', () => {
  const R = require('../src/recommend');
  const holo = CATALOG.find(c => c.id === 'holo1.5-3b-q4_k_m');
  const local = { 'holo1.5-3b.q4_k_m': { grounding: { score: 8, total: 10, seconds: 100, date: '2026-10-21' } } };
  const { list } = R.annotate([{ ...holo, fit: { level: 'fit' }, installed: true }], { local, shipped: {} }, 0);
  assert.strictEqual(list[0].bench && list[0].bench.grounding.score, 8);
  const coder = CATALOG.find(c => /-00001-of-/.test(c.file));
  if (coder) { const id = coder.file.replace(/-00001-of-\d{5}\.gguf$/i, '').toLowerCase();
    const r = R.annotate([{ ...coder }], { local: { [id]: { score: 3, done: 10, safety: true } }, shipped: {} }, 0); assert.strictEqual(r.list[0].bench.score, 3); }
});
