'use strict';
// Hồi quy reviewer PR #94: không gắn “Chạy mượt” / “Nằm trọn trong VRAM” khi KV thật hoặc gpuFit nói là không vừa.
const test = require('node:test'); const assert = require('node:assert');
const F = require('../src/fit');
const G = require('../src/gguf');
const catalog = require('../src/catalog');
const MiB = 1048576, GiB = 1024 ** 3;

const card = { gpu: 'cuda', ram: 32604 * MiB, vram: { total: 12213 * MiB, free: 11437 * MiB }, devices: ['NVIDIA GeForce RTX 4070 SUPER'] };
const gpu6 = { gpu: 'cuda', ram: 16 * GiB, vram: { total: 6 * GiB, free: 5.4 * GiB }, devices: ['NVIDIA GeForce RTX 2060'] };
const gpu4 = { gpu: 'cuda', ram: 16 * GiB, vram: { total: 4 * GiB, free: 3.5 * GiB }, devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU'] };
const mac = (gb) => ({ gpu: 'metal', ram: gb * GiB, vram: { total: gb * GiB } });
const byId = (id) => catalog.find(c => c.id === id);
const fitCat = (id, hw, ctx) => F.machineFit(F.metaOf({ catalog: byId(id) }), hw, { ctx });

test('phi-3.5-mini, phi-4-mini, phi-4 và smollm2 dùng n_layer / n_head_kv / head_dim, không bucket', () => {
  assert.strictEqual(F.kvPerToken(F.metaOf({ catalog: byId('phi-3.5-mini-instruct-q4_k_m') })), 32 * 32 * 96 * 2 * 2);
  assert.strictEqual(F.kvPerToken(F.metaOf({ catalog: byId('microsoft_phi-4-mini-instruct-q4_k_m') })), 32 * 8 * 128 * 2 * 2);
  assert.strictEqual(F.kvPerToken(F.metaOf({ catalog: byId('phi-4-q4_k_m') })), 40 * 10 * 128 * 2 * 2);
  assert.strictEqual(F.kvPerToken(F.metaOf({ catalog: byId('smollm2-1.7b-instruct-q4_k_m') })), 24 * 32 * 64 * 2 * 2);
  const p = F.resolveGeo(F.metaOf({ catalog: byId('phi-3.5-mini-instruct-q4_k_m') }));
  assert.deepStrictEqual([p.layers, p.kvHeads, p.keyLen], [32, 32, 96]);
  const s = F.resolveGeo(F.metaOf({ catalog: byId('smollm2-1.7b-instruct-q4_k_m') }));
  assert.deepStrictEqual([s.layers, s.kvHeads, s.keyLen], [24, 32, 64]);
  const p4 = F.resolveGeo(F.metaOf({ catalog: byId('phi-4-q4_k_m') }));
  assert.deepStrictEqual([p4.layers, p4.kvHeads, p4.keyLen], [40, 10, 128]);
});

test('phi-3.5-mini trên GPU 6 GB @ 16K không còn Chạy mượt', () => {
  const r = fitCat('phi-3.5-mini-instruct-q4_k_m', gpu6, 16384);
  assert.notStrictEqual(r.group, 'smooth', r.hint);
  assert.ok(!/Nằm trọn trong VRAM/.test(r.hint), r.hint);
  assert.ok(Math.abs(r.parts.kv - 32 * 32 * 96 * 2 * 2 * 16384) < MiB, (r.parts.kv / MiB).toFixed(1));
});

test('phi-4 trên 4070S @ 16K không nằm trọn trong VRAM', () => {
  const r = fitCat('phi-4-q4_k_m', card, 16384);
  assert.notStrictEqual(r.group, 'smooth', `${r.hint} need ${(r.need / MiB).toFixed(0)}`);
  assert.ok(!/Nằm trọn trong VRAM/.test(r.hint), r.hint);
  assert.ok(Math.abs(r.parts.kv - 40 * 10 * 128 * 2 * 2 * 16384) < MiB);
});

test('smollm2 1.7B: ngữ cảnh gợi ý không vượt 8192 đã huấn luyện, và trên GPU 4 GB thì nằm trọn', () => {
  const r = fitCat('smollm2-1.7b-instruct-q4_k_m', gpu4, 16384);
  assert.strictEqual(r.ctx, 8192);
  assert.strictEqual(r.group, 'smooth', r.hint);
  assert.ok(!/Tràn/.test(r.hint), r.hint);
  assert.ok(Math.abs(r.parts.kv - 24 * 32 * 64 * 2 * 2 * 8192) < MiB);
});

test('Mac dưới 64 GB lấy 2/3 RAM; từ 64 GB lấy 0.75', () => {
  for (const id of ['qwen_qwen3-8b-q4_k_m', 'meta-llama-3.1-8b-instruct-q4_k_m', 'gemma-3n-e4b-it-q4_k_m', 'internvl3-8b-instruct-q4_k_m']) {
    const r = fitCat(id, mac(8), 8192);
    assert.notStrictEqual(r.group, 'smooth', `${id} ${r.group} need ${(r.need / GiB).toFixed(2)}`);
  }
  const oss16 = fitCat('gpt-oss-20b-mxfp4', mac(16), 8192);
  assert.notStrictEqual(oss16.group, 'smooth', oss16.hint);
  const m24 = fitCat('mistral-small-3.2-24b-instruct-2506-q4_k_m', mac(24), 8192);
  assert.notStrictEqual(m24.group, 'smooth', m24.hint);
  for (const gb of [8, 16, 24]) {
    const cap = gb * GiB * 2 / 3;
    for (const c of catalog) {
      const r = F.machineFit(F.metaOf({ catalog: c }), mac(gb), { ctx: 8192 });
      if (r && r.group === 'smooth') assert.ok(r.need <= cap + 1, `${c.id} Mac ${gb}GB need ${(r.need / GiB).toFixed(2)} > 2/3`);
    }
  }
  const mid = { layers: 1, kvHeads: 1, headDim: 64, size: 44 * GiB, params: '40B' };
  assert.notStrictEqual(F.machineFit(mid, mac(32), { ctx: 8192 }).group, 'smooth');
  assert.strictEqual(F.machineFit(mid, mac(64), { ctx: 8192 }).group, 'smooth');
});

test('gpt-oss-20b trên 4070S: 8K và 16K theo gpuFit, không ghi nằm trọn VRAM', () => {
  const oss = byId('gpt-oss-20b-mxfp4');
  const g = F.resolveGeo(F.metaOf({ catalog: oss }));
  const kv = g.layers * g.kvHeads * (g.keyLen + g.valLen) * 2;
  for (const [ctx, n] of [[8192, 24], [16384, 23]]) {
    const fit = G.gpuFit({ fileSize: oss.size, layers: g.layers, kvPerToken: kv }, { ctx, vram: card.vram });
    assert.strictEqual(fit, n, `gpuFit @ ${ctx}`);
    const r = F.machineFit(F.metaOf({ catalog: oss }), card, { ctx });
    assert.ok(!/Nằm trọn trong VRAM/.test(r.hint), r.hint);
    if (ctx === 8192) {
      assert.strictEqual(r.group, 'smooth', r.hint);
      assert.match(r.hint, /Khoảng 96 % mô hình nằm trên GPU/);
    } else {
      assert.notStrictEqual(r.group, 'smooth', r.hint);
      assert.match(r.hint, /Tràn/);
      assert.ok(!/0,0 GB/.test(r.hint), r.hint);
    }
  }
});

test('gpt-oss-120b có 36 lớp, KV @ 32K khoảng 1179 MiB', () => {
  const g120 = { id: 'gpt-oss-120b-mxfp4', file: 'gpt-oss-120b-mxfp4-00001-of-00003.gguf', params: '120B (MoE)', arch: 'gpt-oss', size: 63.4e9 };
  const geo = F.resolveGeo(g120);
  assert.strictEqual(geo.layers, 36);
  assert.strictEqual(geo.swaLayers, 18);
  const kv = F.kvCacheBytes(g120, 32768);
  const expect = (18 * 32768 + 18 * 768) * 8 * 128 * 2;
  assert.ok(Math.abs(kv - expect) < 1024, (kv / MiB).toFixed(2));
  assert.ok(Math.abs(kv / MiB - 1179) < 1, (kv / MiB).toFixed(2));
});

test('computeBuf cộng logits ubatch × n_vocab × 4 (Qwen2.5-0.5B @ 8K)', () => {
  const vocab = 151936, ctx = 8192, layers = 24, ubatch = 512;
  const buf = F.computeBuf(ctx, layers, vocab);
  const bare = Math.round((64 + ctx / 1024 + layers * 0.45) * MiB);
  assert.ok(bare < 100 * MiB, (bare / MiB).toFixed(1));
  assert.strictEqual(buf, bare + ubatch * vocab * 4);
  assert.ok(buf > 300 * MiB, (buf / MiB).toFixed(1));
  const q = fitCat('qwen2.5-0.5b-instruct-q4_k_m', card, 8192);
  assert.ok(q.parts.compute > 300 * MiB, (q.parts.compute / MiB).toFixed(1));
});

test('kvPerToken tường minh thắng hồ sơ; đầu KV của hồ sơ thắng heads; ctx âm về 8192', () => {
  assert.strictEqual(F.kvPerToken({ id: 'qwen3-8b', params: '8B', kvPerToken: 50000 }), 50000);
  assert.strictEqual(F.kvCacheBytes({ id: 'qwen3-8b', params: '8B', kvPerToken: 50000 }, 100), 50000 * 100);
  assert.strictEqual(F.kvPerToken({ id: 'qwen3-8b', params: '8B', heads: 32 }), F.kvPerToken({ id: 'qwen3-8b', params: '8B' }));
  const neg = F.machineFit({ id: 'qwen3-8b', params: '8B', size: 5e9 }, card, { ctx: -5 });
  const def = F.machineFit({ id: 'qwen3-8b', params: '8B', size: 5e9 }, card, { ctx: 8192 });
  assert.strictEqual(neg.ctx, 8192);
  assert.strictEqual(neg.parts.kv, def.parts.kv);
});

test('không có hồ sơ và không có kvPerToken thì giữ lề an toàn cũ', () => {
  const ctx = 16384;
  const legacy = 300 * MiB + ctx * 24 * 1024 + 350 * MiB;
  const unknown = F.machineFit({ size: 4e9, params: '7B' }, card, { ctx });
  assert.ok(Math.abs(unknown.parts.compute - legacy) < 1, unknown.parts.compute);
  const known = F.machineFit({ id: 'qwen3-4b', params: '4B', arch: 'qwen3', size: 4e9 }, card, { ctx });
  assert.ok(known.parts.compute < legacy * 0.5, (known.parts.compute / MiB).toFixed(1));
  assert.ok(unknown.parts.compute - known.parts.compute > 500 * MiB);
});
