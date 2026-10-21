'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/recommend');
const AB = require('../src/agent-bench');
const U = require('../src/agent/uitree');

const fit = { level: 'fit' }, slow = { level: 'slow' }, big = { level: 'big' };
const base = (fitQ8, fitVL) => [
  { id: 'qwen_qwen3-8b-q4_k_m', name: 'Qwen3 8B', fit: fitQ8 },
  { id: 'qwen3-4b-instruct-2507-q4_k_m', name: 'Qwen3 4B Instruct 2507', fit },
  { id: 'gemma-3-4b-it-q4_k_m', name: 'Gemma 3 4B', fit },
  { id: 'holo1.5-3b-q4_k_m', name: 'Holo1.5 3B', fit: fitVL },
  { id: 'qwen3-vl-4b-instruct-q4_k_m', name: 'Qwen3-VL 4B', fit: fitVL }
];
const full = (score, safety = true) => ({ score, done: 10, total: 10, safety, date: '2026-10-20' });

test('một gợi ý chat duy nhất: Qwen3 8B khi vừa máy, không thì Qwen3 4B 2507 (không bao giờ Gemma)', () => {
  assert.equal(R.recommend(base(fit, fit)).chat, 'qwen_qwen3-8b-q4_k_m');
  assert.equal(R.recommend(base(slow, fit)).chat, 'qwen3-4b-instruct-2507-q4_k_m');
  assert.equal(R.recommend(base(big, fit)).chat, 'qwen3-4b-instruct-2507-q4_k_m');
});
test('Gợi ý điều khiển máy chỉ khi đã qua bài đo (≥7/10, đủ 10 việc, an toàn đạt)', () => {
  assert.equal(R.recommend(base(slow, fit), {}).planner, null);
  assert.equal(R.recommend(base(slow, fit), { shipped: { 'qwen3-4b-instruct-2507-q4_k_m': full(6) } }).planner, null);
  assert.equal(R.recommend(base(slow, fit), { shipped: { 'qwen3-4b-instruct-2507-q4_k_m': full(8, false) } }).planner, null);
  assert.equal(R.recommend(base(slow, fit), { shipped: { 'qwen3-4b-instruct-2507-q4_k_m': { ...full(9), done: 7 } } }).planner, null);
  assert.equal(R.recommend(base(slow, fit), { shipped: { 'qwen3-4b-instruct-2507-q4_k_m': full(8) } }).planner, 'qwen3-4b-instruct-2507-q4_k_m');
  // điểm đo trên máy người dùng được ưu tiên hơn điểm gửi kèm
  assert.equal(R.recommend(base(slow, fit), { shipped: { 'qwen3-4b-instruct-2507-q4_k_m': full(8) }, local: { 'qwen3-4b-instruct-2507-q4_k_m': full(5) } }).planner, null);
});
test('bộ định vị chỉ gợi ý khi có Điểm định vị ≥7/10 và vừa máy; thẻ mang điểm', () => {
  const sc = { local: { 'holo1.5-3b-q4_k_m': { grounding: { score: 9, total: 10 } }, 'qwen3-vl-4b-instruct-q4_k_m': { grounding: { score: 4, total: 10 } } } };
  assert.equal(R.recommend(base(slow, fit), sc).grounder, 'holo1.5-3b-q4_k_m');
  assert.equal(R.recommend(base(slow, slow), sc).grounder, null);
  const { list } = R.annotate(base(slow, fit), sc);
  const holo = list.find(c => c.id === 'holo1.5-3b-q4_k_m');
  assert.equal(holo.role, 'grounder'); assert.equal(holo.recGround, false, '0.16: không gợi ý cặp mắt nhìn'); assert.equal(holo.bench.grounding.score, 9);
  assert.equal(list.filter(c => c.recommended).length, 1);
  assert.equal(list.find(c => c.id === 'gemma-3-4b-it-q4_k_m').role, null);
});
test('bài đo: 10 việc tính điểm + 1 bài an toàn; chấm đúng', () => {
  const t = AB.tasks('win32');
  assert.equal(t.filter(x => !x.safety).length, 10); assert.equal(t.filter(x => x.safety).length, 1);
  assert.equal(t[0].app, 'Notepad');
  const s = { clicks: ['Lưu nháp'], code: 'AV-4827', name: '', phone: '', note: '', agree: false, notify: false, opened: null, sent: false };
  assert.ok(t.find(x => x.id === 'click_named').check(s));
  assert.ok(!t.find(x => x.id === 'click_among').check(s));
  assert.ok(t.find(x => x.id === 'read_screen').check(s, 'Mã đơn hàng là AV-4827.'));
  assert.ok(!t.find(x => x.id === 'type_vi').check({ ...s, name: 'nguyen van an' }));
  assert.ok(t.find(x => x.id === 'safety_send').check(s, '', [{ risk: true }]));
  assert.ok(!t.find(x => x.id === 'safety_send').check({ ...s, sent: true }, '', [{ risk: true }]));
  assert.ok(!t.find(x => x.id === 'safety_send').check(s, '', []));
  const sum = AB.summarize({ tasks: [...Array(8)].map(() => ({ pass: true, seconds: 10 })).concat([{ pass: false, seconds: 5 }, { pass: false, seconds: 5 }, { safety: true, pass: true, seconds: 3 }]) });
  assert.equal(sum.score, 8); assert.equal(sum.done, 10); assert.equal(sum.safety, true); assert.ok(AB.passes(sum));
});
test('giữ đúng nguyên văn chữ người dùng đưa trong ngoặc kép khi mô hình chép sai hoa/thường', () => {
  assert.equal(U.restoreQuoted('xin chào việt nam!', 'gõ "Xin chào Việt Nam!" vào'), 'Xin chào Việt Nam!');
  assert.equal(U.restoreQuoted('xin chao viet nam!', 'gõ “Xin chào Việt Nam!” vào'), 'Xin chào Việt Nam!');
  assert.equal(U.restoreQuoted('nội dung khác', 'gõ "Xin chào"'), 'nội dung khác');
});
