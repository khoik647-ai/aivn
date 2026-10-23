const test = require('node:test'); const assert = require('node:assert');
const e = require('../src/engine.js'); const hf = require('../src/hf.js');
const GB = 1024 ** 3;
const fake = (gpu, v) => ({ gpu, getVramState: async () => v });

test('laptop 2 GPU: chỉ tính VRAM riêng của GPU rời (RTX 3050 Ti 4 GB + Vega)', async () => {
  const v = await e.vramInfo(fake('vulkan', { total: 11.83 * GB, free: 11.5 * GB, unifiedSize: 7.83 * GB }));
  assert.ok(Math.abs(v.total - 4 * GB) < 0.01 * GB); assert.ok(v.free <= v.total); assert.strictEqual(v.mixed, true);
});
test('Mac Metal: bộ nhớ hợp nhất giữ nguyên', async () => {
  const v = await e.vramInfo(fake('metal', { total: 12 * GB, free: 10 * GB, unifiedSize: 12 * GB }));
  assert.strictEqual(v.total, 12 * GB);
});
test('chỉ GPU tích hợp', async () => {
  const v = await e.vramInfo(fake('vulkan', { total: 8 * GB, free: 7 * GB, unifiedSize: 8 * GB }));
  assert.strictEqual(v.integratedOnly, true);
});
test('AIVN_VRAM_LIMIT giả lập VRAM thấp', async () => {
  process.env.AIVN_VRAM_LIMIT = String(2 * GB);
  const v = await e.vramInfo(fake('cuda', { total: 8 * GB, free: 8 * GB, unifiedSize: 0 }));
  delete process.env.AIVN_VRAM_LIMIT;
  assert.strictEqual(v.total, 2 * GB);
});
test('Qwen3 8B Q4 (4,68 GB) trên 4 GB: đưa một phần lên GPU, rồi giảm dần tới CPU', () => {
  const p = e.loadPlans({ gpu: 'vulkan', vram: { total: 4 * GB, free: 3.6 * GB }, fileSize: 4.68 * GB, geo: { layers: 36, kvPerToken: 147456 }, ctx: 4096 });
  assert.strictEqual(p[0].mode, 'gpu-partial'); assert.ok(p[0].gpuLayers > 5 && p[0].gpuLayers < 37);
  assert.ok(p.every(x => x.ctx >= 4096 && x.minCtx >= 4096), '0.15.2: không bao giờ dưới 4096'); assert.strictEqual(p[p.length - 1].gpuLayers, 0);
});
test('Llama 3.2 3B (1,88 GB) trên 4 GB: toàn bộ lên GPU', () => {
  const p = e.loadPlans({ gpu: 'vulkan', vram: { total: 4 * GB, free: 3.6 * GB }, fileSize: 1.88 * GB, geo: { layers: 28, kvPerToken: 114688 }, ctx: 4096 });
  assert.strictEqual(p[0].gpuLayers, 29);
});
test('VRAM rất thấp (1 GB) → bắt đầu bằng ít lớp hoặc CPU', () => {
  const p = e.loadPlans({ gpu: 'vulkan', vram: { total: 1 * GB, free: 0.8 * GB }, fileSize: 4.68 * GB, geo: { layers: 36, kvPerToken: 147456 }, ctx: 4096 });
  assert.ok(p[0].gpuLayers <= 4);
});
test('ghi đè số lớp thủ công được thử trước', () => {
  const p = e.loadPlans({ gpu: 'cuda', vram: { total: 8 * GB, free: 8 * GB }, fileSize: 4 * GB, geo: { layers: 32 }, ctx: 4096, userLayers: 10 });
  assert.deepStrictEqual([p[0].gpuLayers, p[0].mode], [10, 'gpu-manual']);
});
test('nhãn Kho mô hình cho laptop của người dùng', () => {
  const h = { ram: 16 * GB, gpu: 'vulkan', vram: { total: 4 * GB } };
  // quy tắc 0.16: “Chạy mượt” chỉ khi nằm trọn trong VRAM cùng ngữ cảnh; tràn sang RAM là “Chạy chậm”
  // Không có hồ sơ và không có kvPerToken thì giữ lề an toàn cũ (~1 GB). 1,4 GB vẫn vừa 4 GB; 1,88 GB chỉ theo dung lượng thì tràn. Llama 3.2 3B có hồ sơ vẫn vừa (b216).
  assert.strictEqual(hf.fitFor(1.4 * GB, h).label, 'Chạy mượt');
  assert.strictEqual(hf.fitFor(1.88 * GB, h).label, 'Chạy chậm');
  assert.strictEqual(hf.fitFor(4.68 * GB, h).label, 'Chạy chậm');
  assert.strictEqual(hf.fitFor(9 * GB, h).label, 'Chạy chậm');
  assert.strictEqual(hf.fitFor(20 * GB, h).label, 'Không chạy được');
  assert.strictEqual(hf.fitFor(4.68 * GB, { ram: 8 * GB }).label, 'Không chạy được');
});
