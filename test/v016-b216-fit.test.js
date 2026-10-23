'use strict';
// B216 / issue #81: machineFit xếp đúng RAM, VRAM, lượng tử, ngữ cảnh (KV + cửa sổ trượt) và Mac bộ nhớ hợp nhất.
// Neo đo: RTX 4070 SUPER 12213 MiB, gpt-oss-20b MXFP4, llama.cpp nạp 25/25 lớp, VRAM 11458 MiB ở ctx 16384 (model 10949 + KV 402 + compute 107).
const test = require('node:test'); const assert = require('node:assert');
const F = require('../src/fit');
const catalog = require('../src/catalog');
const MiB = 1048576, GiB = 1024 ** 3;
const oss = catalog.find(c => c.id === 'gpt-oss-20b-mxfp4');
const q14 = catalog.find(c => c.id === 'qwen3-14b-q4_k_m');
const q30 = catalog.find(c => c.id === 'qwen3-30b-a3b-instruct-2507-q4_k_m');

const card = { gpu: 'cuda', ram: 32604 * MiB, vram: { total: 12213 * MiB, free: 11437 * MiB }, devices: ['NVIDIA GeForce RTX 4070 SUPER'] };
const pc12 = { gpu: 'cuda', ram: 32 * GiB, vram: { total: 12 * GiB, free: 11.4 * GiB }, devices: ['NVIDIA GeForce RTX 4070 SUPER'] };
const gpu8 = { gpu: 'cuda', ram: 16 * GiB, vram: { total: 8 * GiB, free: 7.2 * GiB }, devices: ['NVIDIA GeForce RTX 4060'] };
const gpu24 = { gpu: 'cuda', ram: 64 * GiB, vram: { total: 24 * GiB, free: 22 * GiB }, devices: ['NVIDIA GeForce RTX 4090'] };
const laptop = { gpu: 'vulkan', ram: 16 * GiB, vram: { total: 4 * GiB, free: 3.5 * GiB }, devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU'] };
const mac = (gb) => ({ gpu: 'metal', ram: gb * GiB, vram: { total: gb * GiB, free: gb * GiB * 0.7 } });
const cpu = (gb) => ({ ram: gb * GiB });

function fit(model, hw, ctx, extra) {
  return F.machineFit({ ...model, ...(extra || {}) }, hw, { ctx });
}

test('câu tái hiện #81: gpt-oss-20b MXFP4, không metadata, RTX 4070 SUPER', () => {
  const m = { size: 12109566624, params: '20B (MoE)' };
  const a = F.machineFit(m, card, { ctx: 8192 });
  const b = F.machineFit(m, card, { ctx: 16384 });
  // Ước tính bộ nhớ vẫn khớp lần nạp 25/25, nhưng loader (gpuFit) chỉ để 21/25 và 20/25 lớp trên GPU.
  assert.strictEqual(a.label, 'Chạy chậm', a.hint);
  assert.match(a.hint, /Khoảng 84 % mô hình nằm trên GPU/);
  assert.strictEqual(a.tight, false);
  assert.strictEqual(b.label, 'Chạy chậm', b.hint);
  assert.match(b.hint, /Khoảng 80 % mô hình nằm trên GPU/);
  assert.strictEqual(b.tight, false);
  assert.ok(!/Nằm trọn trong VRAM/.test(a.hint + b.hint));
  assert.ok(b.need <= 12 * GiB, (b.need / GiB).toFixed(2));
  // 11458 MiB đo được = model 10949 + KV 402 + compute 107. Cho phép lệch 80 MiB.
  assert.ok(Math.abs(b.need - 11458 * MiB) < 80 * MiB, (b.need / MiB).toFixed(1));
  assert.ok(Math.abs(b.parts.kv - 402 * MiB) < 4 * MiB, (b.parts.kv / MiB).toFixed(1));
  assert.ok(b.parts.cpuResident > 500 * MiB, 'token_embd phải nằm ngoài VRAM');
});

test('metadata GGUF (24 lớp, 8 đầu KV, độ dài 64) vẫn tính cửa sổ trượt — không nhân cả 24 lớp với ctx', () => {
  const m = { size: 12109566624, params: '20B (MoE)', layers: 24, heads: 64, kvHeads: 8, keyLength: 64, valueLength: 64 };
  const full = F.machineFit(m, card, { ctx: 16384, swaFull: true });
  const swa = F.machineFit(m, card, { ctx: 16384 });
  assert.ok(swa.parts.kv < full.parts.kv * 0.6);
  assert.strictEqual(full.label, 'Chạy chậm', 'SWA tắt thì KV gấp đôi và tràn');
  assert.ok(!/Nằm trọn trong VRAM/.test(swa.hint), swa.hint);
  assert.strictEqual(F.kvPerToken(m), 24 * 8 * (64 + 64) * 2);
});

test('danh mục gpt-oss và 30B-A3B: KV theo kiến trúc, không theo bảng ≥ 16B', () => {
  assert.strictEqual(F.kvPerToken(F.metaOf({ catalog: oss })), 24 * 8 * 128 * 2);
  assert.strictEqual(F.kvPerToken(F.metaOf({ catalog: q30 })), 48 * 4 * 256 * 2);
  assert.ok(F.kvPerToken(F.metaOf({ catalog: q30 })) < 110e3);
  assert.strictEqual(F.kvPerToken(F.metaOf({ catalog: q14 })), 40 * 8 * 256 * 2);
});

// profile, model, ctx, group, tight (null = không xét)
const ROWS = [
  ['4070S 12GB', card, { size: oss.size, params: oss.params, id: oss.id, arch: oss.arch }, 4096, 'slow', false],
  ['4070S 12GB', card, { size: oss.size, params: oss.params, id: oss.id, arch: oss.arch }, 8192, 'slow', false],
  ['4070S 12GB', card, { size: oss.size, params: oss.params, id: oss.id, arch: oss.arch }, 16384, 'slow', false],
  ['4070S 12GB', card, { size: oss.size, params: oss.params, id: oss.id, arch: oss.arch }, 32768, 'slow', false],
  ['4070S 12GB', card, { size: q14.size, params: q14.params, id: q14.id, arch: q14.arch }, 8192, 'smooth', false],
  ['4070S 12GB', card, { size: q14.size, params: q14.params, id: q14.id, arch: q14.arch }, 16384, 'slow', false],
  ['4070S 12GB', card, { size: q30.size, params: q30.params, id: q30.id, arch: q30.arch }, 8192, 'slow', false],
  ['4070S 12GB', card, { size: q30.size, params: q30.params, id: q30.id, arch: q30.arch }, 16384, 'slow', false],
  ['4070S 12GB', card, { id: 'qwen3-14b', params: '14B', arch: 'qwen3', quant: 'Q8_0', size: 15.2e9 }, 8192, 'slow', false],
  ['4070S 12GB', card, { id: 'llama-3.1-70b', params: '70B', size: 40e9 }, 8192, 'no', false],
  ['PC 12GiB', pc12, { size: q14.size, params: '14B', id: 'qwen3-14b-q4_k_m', arch: 'qwen3' }, 8192, 'smooth', false],
  ['PC 12GiB', pc12, { size: 14333915264, params: '24B', id: 'mistral-small-3.2-24b', mmprojSize: 878054144 }, 8192, 'slow', false],
  ['GPU 8GB', gpu8, { id: 'qwen3-8b', params: '8B', arch: 'qwen3', size: 5 * GiB }, 2048, 'smooth', false],
  ['GPU 8GB', gpu8, { id: 'qwen3-8b', params: '8B', arch: 'qwen3', size: 5 * GiB }, 8192, 'smooth', false],
  ['GPU 8GB', gpu8, { id: 'qwen3-8b', params: '8B', arch: 'qwen3', size: 5 * GiB }, 32768, 'slow', false],
  ['GPU 8GB', gpu8, { id: 'qwen3-8b', params: '8B', arch: 'qwen3', size: 5 * GiB }, 131072, 'no', false],
  ['GPU 24GB', gpu24, { size: q30.size, params: q30.params, id: q30.id, arch: q30.arch }, 8192, 'smooth', false],
  ['GPU 24GB', gpu24, { size: q30.size, params: q30.params, id: q30.id, arch: q30.arch }, 131072, 'slow', false],
  ['laptop 4GB', laptop, { id: 'llama-3.2-3b', params: '3B', size: 1.88 * GiB }, 8192, 'smooth', false],
  ['laptop 4GB', laptop, { id: 'qwen3-8b', params: '8B', arch: 'qwen3', size: 4.68 * GiB }, 8192, 'slow', false],
  ['laptop 4GB', laptop, { id: 'qwen3-vl-4b', params: '4B', arch: 'qwen3vl', size: 2.33 * GiB, mmprojSize: 0.42 * GiB }, 16384, 'slow', false],
  ['Mac 8GB', mac(8), { size: oss.size, params: oss.params, id: oss.id }, 8192, 'no', false],
  ['Mac 16GB', mac(16), { size: oss.size, params: oss.params, id: oss.id }, 8192, 'slow', false],
  ['Mac 32GB', mac(32), { size: oss.size, params: oss.params, id: oss.id }, 8192, 'smooth', false],
  ['Mac 16GB', mac(16), { id: 'qwen3-4b', params: '4B', arch: 'qwen3', size: 2.5 * GiB }, 8192, 'smooth', false],
  ['Mac 8GB', mac(8), { id: 'qwen3-14b', params: '14B', arch: 'qwen3', size: q14.size }, 8192, 'no', false],
  ['CPU 8GB', cpu(8), { id: 'qwen3-0.6b', params: '0.6B', size: 0.5e9 }, 8192, 'smooth', false],
  ['CPU 8GB', cpu(8), { id: 'qwen3-14b', params: '14B', size: q14.size }, 8192, 'no', false],
  ['CPU 32GB', cpu(32), { size: q30.size, params: q30.params, id: q30.id, arch: q30.arch }, 8192, 'smooth', false],
];

test('bảng máy × mô hình × ngữ cảnh', () => {
  for (const [name, hw, model, ctx, group, tight] of ROWS) {
    const r = fit(model, hw, ctx);
    assert.ok(r, name);
    assert.strictEqual(r.group, group, `${name} ctx ${ctx} ${model.id || model.params}: ${r.group} ${r.hint} need ${(r.need / GiB).toFixed(2)} GiB`);
    if (tight != null) assert.strictEqual(!!r.tight, tight, `${name} ctx ${ctx} tight`);
  }
});

test('14B đặc không lạc quan hơn số đo: ctx 16384 ước ≥ 10,2 GiB và vẫn ≤ 12 GB', () => {
  const r = F.machineFit(F.metaOf({ catalog: q14 }), card, { ctx: 16384 });
  assert.ok(r.need >= 10.2 * GiB, (r.need / GiB).toFixed(2));
  assert.ok(r.need <= 12 * GiB, (r.need / GiB).toFixed(2));
  // logits (ubatch × vocab × 4) đẩy nhu cầu quá phần VRAM chừa sẵn → không còn “nằm trọn”
  assert.notStrictEqual(r.group, 'smooth');
  assert.ok(!/Nằm trọn trong VRAM/.test(r.hint), r.hint);
});

test('lượng tử quyết định vừa máy: cùng kiến trúc, Q4 vừa 12 GB, Q8 không', () => {
  const arch = { id: 'qwen3-14b-q4_k_m', params: '14B', arch: 'qwen3' };
  const q4 = F.machineFit({ ...arch, quant: 'Q4_K_M', size: q14.size }, card, { ctx: 8192 });
  const q8 = F.machineFit({ ...arch, id: 'qwen3-14b-q8_0', quant: 'Q8_0', size: 15.2e9 }, card, { ctx: 8192 });
  assert.strictEqual(q4.group, 'smooth');
  assert.notStrictEqual(q8.group, 'smooth');
  assert.ok(q8.need > q4.need);
});

test('ngữ cảnh dài hơn thì KV tăng và có thể đổi nhóm, cửa sổ trượt thì không tăng tuyến tính', () => {
  const m = { size: oss.size, params: oss.params, id: oss.id };
  const k8 = F.machineFit(m, card, { ctx: 8192 }).parts.kv;
  const k16 = F.machineFit(m, card, { ctx: 16384 }).parts.kv;
  const k32 = F.machineFit(m, card, { ctx: 32768 }).parts.kv;
  assert.ok(k16 > k8 && k32 > k16);
  assert.ok(k16 < k8 * 2.2, 'SWA giữ một nửa lớp gần như không đổi');
  const dense = { id: 'qwen3-8b', params: '8B', arch: 'qwen3', size: 5 * GiB };
  const d8 = F.machineFit(dense, gpu8, { ctx: 8192 }).parts.kv;
  const d16 = F.machineFit(dense, gpu8, { ctx: 16384 }).parts.kv;
  assert.ok(Math.abs(d16 / d8 - 2) < 0.05);
});

test('Gemma 3 dùng cửa sổ trượt: KV nhỏ hơn tính đủ mọi lớp', () => {
  const g = { id: 'gemma-3-4b-it', params: '4B', arch: 'gemma3', size: 2.4 * GiB };
  const swa = F.kvCacheBytes(g, 32768);
  const full = g.layers ? 0 : F.kvPerToken(g) * 32768;
  assert.ok(swa < full * 0.5, `${swa} vs ${full}`);
});
