// 0.16 bước 3: hộp nạp mô hình — đọc GGUF, ước lượng bộ nhớ, khớp với kế hoạch nạp của bộ máy
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const G = require('../src/gguf');

function ggufBuf(kvs) { // tạo tệp GGUF v3 tối thiểu (không tensor) để kiểm tra bộ đọc
  const parts = []; const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); }; const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  parts.push(Buffer.from('GGUF')); u32(3); u64(0); u64(kvs.length);
  for (const [k, t, v] of kvs) { str(k); u32(t);
    if (t === 8) str(v); else if (t === 4) u32(v); else if (t === 10) u64(v);
    else if (t === 9) { const [at, arr] = v; u32(at); u64(arr.length); for (const x of arr) at === 8 ? str(x) : u32(x); } }
  return Buffer.concat(parts);
}
test('đọc GGUF: khoá chính, bỏ qua mảng chuỗi lớn, mảng số nhỏ theo lớp', () => {
  const toks = Array.from({ length: 200000 }, (_, i) => 'tok' + i); // > 1 MB → buộc đọc qua nhiều khối và nhảy qua
  const f = path.join(os.tmpdir(), 'aivn-test-' + process.pid + '.gguf');
  fs.writeFileSync(f, Buffer.concat([ggufBuf([
    ['general.architecture', 8, 'qwen3'], ['general.name', 8, 'Thử nghiệm'], ['general.file_type', 4, 15],
    ['tokenizer.ggml.tokens', 9, [8, toks]],
    ['qwen3.block_count', 4, 36], ['qwen3.context_length', 4, 262144], ['qwen3.embedding_length', 4, 2560],
    ['qwen3.attention.head_count', 4, 32], ['qwen3.attention.head_count_kv', 9, [4, Array(36).fill(8)]], ['qwen3.attention.key_length', 4, 128],
    ['tokenizer.chat_template', 8, '{% if tools %}...{% endif %}'],
  ]), Buffer.alloc(4096)]));
  try {
    const s = G.summarize(f);
    assert.strictEqual(s.arch, 'qwen3'); assert.strictEqual(s.name, 'Thử nghiệm'); assert.strictEqual(s.quant, 'Q4_K_M');
    assert.strictEqual(s.layers, 36); assert.strictEqual(s.trainCtx, 262144); assert.strictEqual(s.kvHeads, 8);
    assert.strictEqual(s.kvPerToken, 36 * 8 * 256 * 2); // Qwen3 4B: 144 KiB/token f16 → 1,125 GiB ở 8192
    assert.ok(s.templateTools);
  } finally { fs.unlinkSync(f); }
});
test('đọc GGUF: tệp hỏng báo lỗi rõ, không treo', () => {
  const f = path.join(os.tmpdir(), 'aivn-bad-' + process.pid + '.gguf'); fs.writeFileSync(f, Buffer.from('GGUF\x03\x00\x00\x00\x00'));
  try { assert.throws(() => G.summarize(f), /GGUF/); assert.ok(G.cachedSummary(f).error); } finally { fs.unlinkSync(f); }
  const g = path.join(os.tmpdir(), 'aivn-notg-' + process.pid + '.bin'); fs.writeFileSync(g, 'xin chao the gioi');
  try { assert.throws(() => G.summarize(g), /Không phải tệp GGUF/); } finally { fs.unlinkSync(g); }
});
const QWEN4B = { fileSize: 2.497e9, layers: 36, kvPerToken: 36 * 8 * 256 * 2 };
const LAPTOP = { total: 4.155e9, free: 3.87e9 }; // RTX 3050 Ti 4 GB của người dùng
test('ước lượng: số lớp tự động không vượt VRAM và giảm khi ngữ cảnh tăng', () => {
  let prev = 99;
  for (const ctx of [8192, 16384, 32768]) {
    const n = G.autoLayers(QWEN4B, { ctx, vram: LAPTOP }); const e = G.estimate(QWEN4B, { ctx, gpuLayers: n });
    assert.ok(e.vram <= LAPTOP.free * 0.92 + 1, `ctx ${ctx}: ${e.vram} > VRAM`); assert.ok(n < prev); prev = n;
  }
  const full = G.estimate(QWEN4B, { ctx: 8192, gpuLayers: 37 });
  assert.ok(full.vram > LAPTOP.free, 'trọn 37 lớp + KV 8k không vừa 4 GB — đúng như máy người dùng');
  assert.strictEqual(G.estimate(QWEN4B, { ctx: 8192, gpuLayers: 37, gpu: false }).vram, 0);
  const q8 = G.estimate(QWEN4B, { ctx: 8192, gpuLayers: 0, kvType: 'q8_0' }); const f16 = G.estimate(QWEN4B, { ctx: 8192, gpuLayers: 0 });
  assert.ok(q8.kv < f16.kv * 0.6);
});
test('kế hoạch nạp của bộ máy dùng đúng số lớp mà hộp nạp hiển thị (Tự động)', () => {
  const { loadPlans } = require('../src/engine');
  for (const ctx of [8192, 16384]) {
    const plans = loadPlans({ gpu: 'vulkan', vram: LAPTOP, fileSize: QWEN4B.fileSize, geo: { layers: 36, kvPerToken: QWEN4B.kvPerToken, trainCtx: 262144 }, ctx, minCtx: 8192 });
    assert.strictEqual(plans[0].gpuLayers, G.autoLayers(QWEN4B, { ctx, vram: LAPTOP }));
    assert.ok(plans.every(p => p.ctx >= 8192 || p.mode === 'cpu'), 'không bao giờ thu ngữ cảnh dưới 8192');
  }
  const man = loadPlans({ gpu: 'cuda', vram: LAPTOP, fileSize: QWEN4B.fileSize, geo: { layers: 36, kvPerToken: QWEN4B.kvPerToken }, ctx: 8192, userLayers: 18 });
  assert.deepStrictEqual([man[0].mode, man[0].gpuLayers, man[0].ctx], ['gpu-manual', 18, 8192]);
});
test('gguf.js được giải nén khỏi asar (bộ máy chạy bằng Node riêng cần đọc được)', () => {
  const pkg = require('../package.json'); assert.ok(pkg.build.asarUnpack.includes('src/gguf.js'));
});
const REAL = '/tmp/aivn-ud11/models/bartowski/Qwen_Qwen3-0.6B-GGUF/Qwen_Qwen3-0.6B-Q4_K_M.gguf';
test('đọc GGUF thật (nếu có trên máy)', { skip: !fs.existsSync(REAL) }, () => {
  const t = Date.now(); const s = G.summarize(REAL);
  assert.strictEqual(s.arch, 'qwen3'); assert.strictEqual(s.layers, 28); assert.strictEqual(s.trainCtx, 32768); assert.ok(Date.now() - t < 2000);
});
