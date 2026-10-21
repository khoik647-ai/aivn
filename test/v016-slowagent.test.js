'use strict';
// 0.16: máy yếu (laptop GPU 4 GB) — khi KHÔNG có mô hình AIVN AGENT nào chạy mượt ở ngữ cảnh 16K, vẫn cho dùng mô hình
// "Chạy chậm" (một phần GPU + CPU) kèm cảnh báo thay vì chặn hẳn; "Không chạy được" và tốc độ < 5 token/giây vẫn chặn.
// Máy đủ mạnh (PC RTX 4070 Super): giữ quy tắc chỉ nhận mô hình chạy mượt.
const test = require('node:test'); const assert = require('node:assert');
const hf = require('../src/hf'); const AE = require('../src/agent-eligibility');
const catalog = require('../src/catalog'); const shipped = require('../src/bench-results.json').models;
const G = 1024 ** 3; const AGENT_CTX = 16384;
const PC = { ram: 32 * G, gpu: 'cuda', vram: { total: 12 * G, free: 11.4 * G }, devices: ['NVIDIA GeForce RTX 4070 SUPER'], cpus: 12 };
const LAPTOP4 = { ram: 8 * G, gpu: 'cuda', vram: { total: 4 * G }, devices: ['NVIDIA GeForce GTX 1650'], cpus: 8 };
const entries = (hw) => catalog.map(c => ({ id: c.id, vision: !!c.mmproj, catalog: c, size: c.size, agentFit: hf.fitFor(c.size, hw, { id: c.id, params: c.params, mmprojSize: c.mmproj ? c.mmproj.size : 0, ctx: AGENT_CTX }) }));
const elig = (e, allowSlow) => AE.eligibility({ ...e, fit: e.agentFit }, { shipped: shipped[e.id], allowSlow });
const VL = (n) => `qwen3-vl-${n}b-instruct-q4_k_m`;

test('PC 12 GB: có mô hình chạy mượt → không nới quy tắc; mô hình chạy chậm vẫn bị khoá', () => {
  const E = entries(PC); const sc = { shipped };
  assert.strictEqual(AE.needSlowAllowance(E, sc), false);
  const best = AE.bestFor(E, sc, { allowSlow: false }); assert.strictEqual(best.id, VL(8));
  assert.strictEqual(elig(E.find(e => e.id === VL(8)), false).code, 'ok');
});
test('laptop GPU 4 GB / RAM 8 GB: không mô hình nào chạy mượt ở 16K → cho dùng "Chạy chậm" kèm cảnh báo, gợi ý 4B (định vị tốt, đủ nhanh)', () => {
  const E = entries(LAPTOP4); const sc = { shipped };
  const smoothOk = E.filter(e => elig(e, false).ok); assert.strictEqual(smoothOk.length, 0, 'tái hiện: không mô hình nào chạy mượt');
  assert.strictEqual(AE.needSlowAllowance(E, sc), true);
  const four = E.find(e => e.id === VL(4)); assert.strictEqual(four.agentFit.level, 'slow');
  const e4 = elig(four, true); assert.ok(e4.ok && e4.slow && e4.code === 'slow', JSON.stringify(e4));
  assert.match(e4.reason, /Chạy chậm trên máy này \(~[\d,]+ token\/giây, tràn [\d,]+ GB sang RAM\)/);
  const best = AE.bestFor(E, sc, { allowSlow: true });
  assert.strictEqual(best.id, VL(4), 'chọn 4B: điểm định vị 8/10 và nhanh hơn 8B nhiều');
  // mô hình chỉ đọc chữ / không định vị được vẫn bị chặn dù được nới
  const qwen25 = E.find(e => /qwen2\.5-vl-3b/.test(e.id)); if (qwen25) assert.strictEqual(elig(qwen25, true).ok, false);
  const text = E.find(e => !e.vision); assert.strictEqual(elig(text, true).code, 'text');
});
test('dù được nới: "Không chạy được" và tốc độ dưới 5 token/giây vẫn chặn', () => {
  const cat = { id: 'qwen3-vl-8b-instruct-q4_k_m', claims: [{ t: 'tools', k: 'v' }, { t: 'gui', k: 'v' }] };
  assert.strictEqual(AE.eligibility({ vision: true, catalog: cat, fit: { level: 'big', hint: 'Lớn hơn VRAM + RAM của máy' } }, { allowSlow: true }).code, 'heavy');
  assert.strictEqual(AE.eligibility({ vision: true, catalog: cat, fit: { level: 'slow', tps: 3.2, ram: G } }, { allowSlow: true }).code, 'heavy');
  assert.strictEqual(AE.eligibility({ vision: true, catalog: cat, fit: { level: 'slow', tps: 12, ram: G } }, { allowSlow: true }).code, 'slow');
});
test('bestFor: mô hình chạy mượt luôn đứng trước mô hình chạy chậm (kể cả khi chạy chậm đã cài sẵn)', () => {
  const cat = (id) => ({ id, claims: [{ t: 'tools', k: 'v' }, { t: 'gui', k: 'v' }] });
  const slow = { id: 'a', vision: true, installed: true, catalog: cat('a'), agentFit: { level: 'slow', tps: 30, ram: G } };
  const fast = { id: 'b', vision: true, installed: false, catalog: cat('b'), agentFit: { level: 'fit', tps: 40 } };
  assert.strictEqual(AE.bestFor([slow, fast], {}, { allowSlow: true }).id, 'b');
});
test('main + giao diện: cổng AIVN AGENT có slow/spill, banner cảnh báo không chặn, llama-server báo số lớp trên GPU', () => {
  const fs = require('fs'); const path = require('path'); const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const main = rd('src/main.js'); assert.match(main, /agentAllowSlow\(h, sc, out\)/); assert.match(main, /slow: !!\(e && e\.slow\)/); assert.match(main, /const spill = st\.loaded/);
  const app = rd('src/renderer/app.js'); assert.match(app, /function agentSlowHtml\(g\)/); assert.match(app, /g && g\.ok && !g\.cloud && \(g\.slow \|\| g\.spill\)/);
  assert.match(rd('src/vision-server.js'), /offloaded \(\\d\+\)\\\/\(\\d\+\) layers to GPU/);
});
