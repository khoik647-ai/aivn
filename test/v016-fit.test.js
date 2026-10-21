'use strict';
// Quy tắc 0.16: mọi danh sách mô hình xếp theo mức chạy trên CHÍNH máy này — Chạy mượt → Chạy chậm → Không chạy được, mạnh trước;
// gợi ý hàng đầu luôn là mô hình mạnh nhất chạy mượt; mỗi mô hình có tốc độ và bộ nhớ ước tính.
// AIVN AGENT chỉ nhận mô hình nhìn màn hình + gọi công cụ đã kiểm chứng + định vị đạt + chạy mượt.
const test = require('node:test'); const assert = require('node:assert');
const F = require('../src/fit'); const hf = require('../src/hf'); const R = require('../src/recommend'); const AE = require('../src/agent-eligibility');
const catalog = require('../src/catalog'); const shipped = require('../src/bench-results.json').models;
const G = 1024 ** 3;
// máy thật của người dùng: i5-12400F (12 luồng), RTX 4070 Super 12 GB, 32 GB RAM
const PC = { ram: 32 * G, gpu: 'cuda', vram: { total: 12 * G, free: 11.4 * G }, devices: ['NVIDIA GeForce RTX 4070 SUPER'], cpus: 12 };
const LAPTOP = { ram: 16 * G, gpu: 'vulkan', vram: { total: 4 * G }, devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU'] };
const withFit = (hw, ctx) => catalog.map(c => ({ ...c, fit: hf.fitFor(c.size, hw, { id: c.id, params: c.params, mmprojSize: c.mmproj ? c.mmproj.size : 0, ctx }) }));

test('ba nhóm theo đúng thứ tự, mạnh trước trong mỗi nhóm', () => {
  const list = withFit(PC); const sorted = F.sortByFit(list, c => c.fit);
  const order = { smooth: 0, slow: 1, no: 2 }; const gs = sorted.map(c => order[c.fit.group]);
  assert.deepStrictEqual(gs, [...gs].sort((a, b) => a - b), 'nhóm phải theo thứ tự mượt → chậm → không chạy');
  for (const g of ['smooth', 'slow']) { const s = sorted.filter(c => c.fit.group === g).map(F.strength); assert.deepStrictEqual(s, [...s].sort((a, b) => b - a), g); }
  assert.deepStrictEqual(F.groupByFit(list, c => c.fit).map(g => g.label).slice(0, 2), ['Chạy mượt', 'Chạy chậm']);
});
test('PC RTX 4070 Super 12 GB: 14B Q4 nằm trọn trong VRAM; 24B và 30B MoE tràn sang RAM; gợi ý hàng đầu là mô hình mạnh nhất chạy mượt', () => {
  const list = withFit(PC); const by = (id) => list.find(c => c.id === id);
  assert.strictEqual(by('qwen3-14b-q4_k_m').fit.group, 'smooth');
  assert.strictEqual(by('qwen3-vl-8b-instruct-q4_k_m').fit.group, 'smooth');
  assert.strictEqual(by('mistral-small-3.2-24b-instruct-2506-q4_k_m').fit.group, 'slow');
  assert.strictEqual(by('qwen3-30b-a3b-instruct-2507-q4_k_m').fit.group, 'slow');
  const rec = R.recommend(list, { shipped });
  assert.strictEqual(rec.chat, 'qwen3-14b-q4_k_m');
  const smoothMax = Math.max(...list.filter(c => c.fit.group === 'smooth' && !/ui-tars|holo|venus/.test(c.id)).map(F.strength));
  assert.strictEqual(F.strength(by(rec.chat)), smoothMax);
  assert.strictEqual(rec.agent, 'qwen3-vl-8b-instruct-q4_k_m');
});
test('mô hình 32B (video t128) trên PC 12 GB: tràn RAM → Chạy chậm, tốc độ vài token/giây', () => {
  const f = F.machineFit({ id: 'qwen2.5-32b-instruct-q4_k_m', params: '32B', size: 19.85e9 }, PC, { ctx: 32768 });
  assert.strictEqual(f.group, 'slow'); assert.ok(f.tps > 0.5 && f.tps < 8, String(f.tps)); assert.ok(f.ram > 0 && f.vram > 0);
});
test('máy không đủ VRAM + RAM → Không chạy được', () => {
  assert.strictEqual(F.machineFit({ size: 60e9, params: '70B' }, PC).group, 'no');
  assert.strictEqual(F.machineFit({ size: 20e9, params: '32B' }, { ram: 8 * G }).group, 'no');
});
test('mỗi mô hình có tốc độ và bộ nhớ ước tính hiển thị được', () => {
  for (const c of withFit(PC)) { assert.ok(c.fit.text, c.id); if (c.fit.group !== 'no') assert.match(c.fit.text, /token\/giây/, c.id); assert.match(c.fit.text, /GB/, c.id); }
  assert.match(F.machineFit({ size: 5e9, params: '8B' }, PC).text, /^~\d+ token\/giây · \d+,\d GB VRAM$/);
});
test('MoE: tốc độ tính theo phần hoạt động; E4B tính theo độ mạnh tương đương', () => {
  assert.deepStrictEqual(F.parseParams('30B (MoE, 3B hoạt động)'), { total: 30, active: 3, effective: null });
  assert.strictEqual(F.parseParams('E4B (8B, tương đương 4B)').effective, 4);
  const moe = F.machineFit({ size: 18.6e9, params: '30B (MoE, 3B hoạt động)' }, PC), dense = F.machineFit({ size: 18.6e9, params: '30B' }, PC);
  assert.ok(moe.tps > dense.tps * 3);
});
test('laptop 4 GB: Qwen3-VL 4B (tràn sang RAM, Chạy chậm) là mô hình AIVN AGENT — 2B bị bỏ vì gọi công cụ 13/25; máy không GPU: mô hình nhỏ chạy mượt bằng CPU', () => {
  const l4 = withFit(LAPTOP, 16384); const r = R.recommend(l4, { shipped }); assert.strictEqual(r.agent, 'qwen3-vl-4b-instruct-q4_k_m'); assert.strictEqual(l4.find(c => c.id === 'qwen3-vl-4b-instruct-q4_k_m').fit.group, 'slow');
  assert.strictEqual(F.machineFit({ size: 0.5e9, params: '0.6B' }, { ram: 8 * G }).group, 'smooth');
});

// ---- AIVN AGENT: bộ chọn mô hình ----
const asInstalled = (id, hw = PC) => { const c = catalog.find(x => x.id === id); return { id, file: c.file, size: c.size, vision: !!c.mmproj, catalog: c, fit: hf.fitFor(c.size, hw, { id, params: c.params, mmprojSize: c.mmproj ? c.mmproj.size : 0, ctx: 16384 }) }; };
const elig = (m) => AE.eligibility(m, { shipped: shipped[m.catalog && m.catalog.id] });
test('AIVN AGENT: mô hình chỉ đọc chữ bị khoá kèm lý do “Chỉ đọc chữ, không nhìn được màn hình”', () => {
  for (const id of ['qwen_qwen3-8b-q4_k_m', 'qwen3-4b-instruct-2507-q4_k_m', 'llama-3.2-3b-instruct-q4_k_m', 'qwen3-14b-q4_k_m']) {
    const e = elig(asInstalled(id)); assert.strictEqual(e.ok, false, id); assert.strictEqual(e.reason, 'Chỉ đọc chữ, không nhìn được màn hình');
  }
});
test('AIVN AGENT: mô hình nhìn ảnh nhưng gọi công cụ chưa ổn định bị khoá “Không gọi công cụ ổn định”', () => {
  for (const id of ['ui-tars-1.5-7b-q4_k_m', 'qwen2.5-vl-7b-instruct-q4_k_m', 'smolvlm-500m-instruct-q8_0']) assert.strictEqual(elig(asInstalled(id)).reason, 'Không gọi công cụ ổn định', id);
});
test('AIVN AGENT: định vị dưới 6/10 bị khoá; mô hình quá nặng bị khoá “Quá nặng cho máy”', () => {
  assert.match(elig(asInstalled('qwen2.5-vl-3b-instruct-q4_k_m')).reason, /^Không định vị được nút trên màn hình \(điểm định vị 2\/10\)$/);
  const tiny = { ram: 4 * G }; const m = asInstalled('qwen3-vl-8b-instruct-q4_k_m', tiny);
  assert.match(elig(m).reason, /^Quá nặng cho máy/);
});
test('AIVN AGENT: Qwen3-VL 8B/4B dùng được, 2B bị khoá “Không gọi công cụ ổn định” (13/25); mô hình tốt nhất đã cài là mạnh nhất chạy mượt', () => {
  for (const id of ['qwen3-vl-8b-instruct-q4_k_m', 'qwen3-vl-4b-instruct-q4_k_m']) assert.ok(elig(asInstalled(id)).ok, id);
  assert.strictEqual(elig(asInstalled('qwen3-vl-2b-instruct-q8_0')).reason, 'Không gọi công cụ ổn định');
  const inst = ['qwen_qwen3-8b-q4_k_m', 'qwen3-vl-2b-instruct-q8_0', 'qwen3-vl-8b-instruct-q4_k_m', 'ui-tars-1.5-7b-q4_k_m'].map(id => ({ ...asInstalled(id), installed: true }));
  assert.strictEqual(AE.bestFor(inst, { shipped }).id, 'qwen3-vl-8b-instruct-q4_k_m');
  assert.strictEqual(AE.bestFor([asInstalled('qwen_qwen3-8b-q4_k_m')], { shipped }), null);
});
test('AIVN AGENT: mô hình tự nhập không rõ nguồn gốc không được tự nhận là dùng được', () => {
  assert.strictEqual(AE.eligibility({ vision: true, catalog: null, fit: { level: 'fit' } }).ok, false);
});
test('giao diện: bộ chọn AIVN AGENT khoá mô hình không đạt, chặn chạy và có nút chuyển một chạm', () => {
  const app = require('fs').readFileSync(require('path').join(__dirname, '../src/renderer/app.js'), 'utf8');
  const main = require('fs').readFileSync(require('path').join(__dirname, '../src/main.js'), 'utf8');
  assert.match(app, /Không dùng được cho AIVN AGENT/); assert.match(app, /data-switch=/); assert.match(app, /agentGateOk\(\)/);
  assert.match(main, /const gate = await agentModelGate\(\); if \(!gate\.ok && engine\.status\(\)\.loaded\) return \{ blocked: true/);
  // khi gửi, kiểm tra cổng trước khi lấy tệp đính kèm (không mất tệp của người dùng)
  const i = app.indexOf('async function sendAgent'); const body = app.slice(i, i + 600);
  assert.ok(body.indexOf('agentGateOk') < body.indexOf('pending = []'));
});

test('Khám phá không còn nhãn cặp hai mô hình / "Lập kế hoạch · cần mắt nhìn" (AIVN AGENT chỉ dùng mô hình tự nhìn được)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/renderer/app.js'), 'utf8');
  const role = src.slice(src.indexOf('const roleTag'), src.indexOf('function benchTag'));
  assert.ok(!/cần mắt nhìn/.test(role)); assert.ok(/Chỉ dùng cho Trò chuyện/.test(role));
  assert.ok(!/Điểm tác vụ: chưa đo/.test(src));
  const R = require('../src/recommend');
  const list = [{ id: 'qwen3-vl-4b-instruct-q4_k_m', name: 'Qwen3-VL 4B', fit: { level: 'fit', group: 'smooth' }, vision: true }, { id: 'holo1.5-3b-q4_k_m', name: 'Holo', fit: { level: 'fit', group: 'smooth' }, vision: true }];
  const { list: out } = R.annotate(list, { local: { 'holo1.5-3b-q4_k_m': { grounding: { score: 9, total: 10 } } } }, 12 * 1024 ** 3);
  assert.ok(out.every(c => !c.recGround && !c.recPairPlanner));
});

test('bestFor xét độ vừa máy theo ngữ cảnh AIVN AGENT (agentFit), không theo ngữ cảnh trò chuyện', () => {
  const AE = require('../src/agent-eligibility');
  const cat = { id: 'qwen3-vl-2b', claims: [{ t: 'tools', k: 'v' }, { t: 'gui', k: 'v' }] };
  const m = { id: 'a', vision: true, catalog: cat, installed: true, fit: { level: 'fit' }, agentFit: { level: 'slow', hint: 'Tràn 0,1 GB sang RAM, phần đó chạy bằng CPU' } };
  assert.equal(AE.bestFor([m], {}), null, 'tràn RAM ở 16K ngữ cảnh → không gợi ý chuyển');
  assert.ok(AE.bestFor([{ ...m, agentFit: { level: 'fit' } }], {}));
  const e = AE.eligibility({ ...m, fit: m.agentFit });
  assert.equal(e.code, 'heavy'); assert.match(e.reason, /tràn 0,1 GB sang RAM, phần đó chạy bằng CPU/);
});

test('lời giải thích "Tràn … sang RAM" cùng đơn vị (GiB) với phần hiển thị bộ nhớ', () => {
  const F = require('../src/fit');
  const f = F.machineFit({ id: 'qwen3-vl-8b', size: 5.38 * 1024 ** 3, mmprojSize: 0.7 * 1024 ** 3, params: 8 }, { gpu: 'cuda', vram: { total: 4 * 1024 ** 3 }, ram: 8 * 1024 ** 3, cpus: 8 }, { ctx: 16384 });
  assert.equal(f.group, 'slow');
  const spill = f.hint.match(/Tràn ([\d,]+) GB/)[1]; assert.ok(f.text.includes(spill + ' GB RAM'), f.hint + ' | ' + f.text);
});
