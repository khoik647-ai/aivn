'use strict';
// B196 (#66): KV và MoE đọc từ siêu dữ liệu GGUF; băng thông RTX 3050 Ti Laptop là 192 GB/s.
// B197 (#67): thông báo nạp dự phòng dịch vi/en/zh.
// Bộ nhớ offload: không ghim CPU, không xoá khi mới nạp một phần, ngữ cảnh đã hạ vẫn áp dụng.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('../src/gguf');
const F = require('../src/fit');
const hf = require('../src/hf');
const L = require('../src/load-notice');
const OM = require('../src/offload-memory');
const CORE = require('../src/i18n/core');
const en = require('../src/i18n/en');
const zh = require('../src/i18n/zh');
const T = CORE.create({ en, zh });

function ggufBuf(kvs, tensors = []) {
  const parts = [];
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  parts.push(Buffer.from('GGUF')); u32(3); u64(tensors.length); u64(kvs.length);
  for (const [k, t, v] of kvs) {
    str(k); u32(t);
    if (t === 8) str(v); else if (t === 4) u32(v); else if (t === 10) u64(v);
  }
  for (const tensor of tensors) {
    str(tensor.name); u32(tensor.dims.length);
    for (const d of tensor.dims) u64(d);
    u32(tensor.type); u64(tensor.offset || 0);
  }
  return Buffer.concat(parts);
}
function writeGguf(name, kvs, tensors) {
  const f = path.join(os.tmpdir(), name + '-' + process.pid + '.gguf');
  fs.writeFileSync(f, ggufBuf(kvs, tensors));
  return f;
}

test('B196: GGUF đặc (không MoE) — KV từ block_count / head_count_kv / key_length', () => {
  const f = writeGguf('dense', [
    ['general.architecture', 8, 'qwen3'], ['general.name', 8, 'Qwen3-4B'],
    ['qwen3.block_count', 4, 36], ['qwen3.attention.head_count', 4, 32],
    ['qwen3.attention.head_count_kv', 4, 8], ['qwen3.attention.key_length', 4, 128], ['qwen3.embedding_length', 4, 2560],
  ]);
  try {
    const s = G.summarize(f);
    assert.strictEqual(s.kvPerToken, 36 * 8 * (128 + 128) * 2);
    assert.strictEqual(s.experts, null);
    assert.strictEqual(F.kvPerToken(s), s.kvPerToken);
    assert.strictEqual(F.kvPerToken({ params: '4B' }), 147e3);
  } finally { fs.unlinkSync(f); }
});

test('B196: MoE có -A3B trong tên — KV ~98 KB/token từ kiến trúc, không phải 262 KB từ tổng 30B', () => {
  const f = writeGguf('moe-a3b', [
    ['general.architecture', 8, 'qwen3moe'], ['general.name', 8, 'Qwen3-30B-A3B'],
    ['qwen3moe.block_count', 4, 48], ['qwen3moe.attention.head_count', 4, 32],
    ['qwen3moe.attention.head_count_kv', 4, 4], ['qwen3moe.attention.key_length', 4, 128], ['qwen3moe.attention.value_length', 4, 128],
    ['qwen3moe.expert_count', 4, 128], ['qwen3moe.expert_used_count', 4, 8],
  ]);
  try {
    const s = G.summarize(f);
    assert.strictEqual(s.kvPerToken, 48 * 4 * (128 + 128) * 2);
    assert.strictEqual(s.kvPerToken, 98304);
    assert.strictEqual(s.experts, 128); assert.strictEqual(s.expertsUsed, 8);
    assert.ok(F.kvPerToken({ params: '30B-A3B' }) > 200e3, 'tên không có siêu dữ liệu vẫn đi lối cũ');
    assert.ok(F.kvPerToken(s) < 120e3);
    assert.strictEqual(hf.paramLabel({ name: s.name, params: 30e9, experts: s.experts, expertsUsed: s.expertsUsed }), '30.00B-A3B');
  } finally { fs.unlinkSync(f); }
});

test('B196: MoE không có -A3B trong tên (gpt-oss-20b) — expert_count / expert_used_count', () => {
  const f = writeGguf('moe-plain', [
    ['general.architecture', 8, 'gptoss'], ['general.name', 8, 'gpt-oss-20b'],
    ['gptoss.block_count', 4, 24], ['gptoss.attention.head_count', 4, 32],
    ['gptoss.attention.head_count_kv', 4, 8], ['gptoss.attention.key_length', 4, 64],
    ['gptoss.expert_count', 10, 32], ['gptoss.expert_used_count', 10, 4],
  ]);
  try {
    const s = G.summarize(f);
    assert.strictEqual(s.experts, 32); assert.strictEqual(s.expertsUsed, 4);
    assert.strictEqual(s.kvPerToken, 24 * 8 * (64 + 64) * 2);
    assert.strictEqual(hf.paramLabel({ name: 'gpt-oss-20b', params: 20e9 }), '20.00B');
    const label = hf.paramLabel({ name: s.name, params: 20e9, experts: s.experts, expertsUsed: s.expertsUsed });
    assert.strictEqual(label, '20.00B-A2.5B');
    assert.strictEqual(F.parseParams(label).active, 2.5);
  } finally { fs.unlinkSync(f); }
});

test('B196: byte tensor cộng được; kiểu lạ thì không đủ để confident', () => {
  const known = writeGguf('tensors', [
    ['general.architecture', 8, 'qwen3'], ['qwen3.block_count', 4, 1],
  ], [{ name: 'token_embd.weight', dims: [4], type: 0, offset: 0 }, { name: 'blk.0.attn_q.weight', dims: [256], type: 12, offset: 64 }]);
  const weird = writeGguf('mxfp4', [
    ['general.architecture', 8, 'gptoss'], ['gptoss.block_count', 4, 1],
  ], [{ name: 'blk.0.ffn.weight', dims: [32], type: 39, offset: 0 }]);
  try {
    assert.strictEqual(G.summarize(known).weightBytes, 16 + 144);
    assert.strictEqual(G.summarize(weird).weightBytes, null);
  } finally { fs.unlinkSync(known); fs.unlinkSync(weird); }
});

test('B196: RTX 3050 Ti Laptop là 192 GB/s; 3050 để bàn vẫn 224', () => {
  assert.strictEqual(F.gpuBandwidth({ devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU'] }), 192);
  assert.strictEqual(F.gpuBandwidth({ devices: ['NVIDIA GeForce RTX 3050'] }), 224);
  assert.strictEqual(F.gpuBandwidth({ devices: ['AMD Radeon(TM) Graphics', 'NVIDIA GeForce RTX 3050 Ti Laptop GPU'] }), 192);
});

test('B197: thông báo nạp dự phòng dịch đủ vi, en, zh', () => {
  const partial = { mode: 'gpu-partial', gpuLayers: 15, totalLayers: 25, contextSize: 16384 };
  const cpu = { mode: 'cpu-only', contextSize: 8192 };
  const gpu = { mode: 'gpu', contextSize: 16384 };
  const manual = { mode: 'gpu-manual', gpuLayers: 10, totalLayers: 41, contextSize: 16384 };
  assert.match(L.loadNotice(partial), /GPU một phần \+ CPU \(15\/25 lớp trên GPU\), ngữ cảnh 16\.384/);
  assert.strictEqual(L.loadNotice(partial, (s) => T.tr(s, 'en'), 'en'), 'Loaded with Partial GPU + CPU (15/25 layers on GPU), context 16,384. The model doesn\'t fit entirely in VRAM, so the rest runs on the CPU — slower, but it works.');
  const zhPartial = L.loadNotice(partial, (s) => T.tr(s, 'zh'), 'zh');
  assert.match(zhPartial, /部分 GPU \+ CPU/); assert.match(zhPartial, /15\/25 层在 GPU 上/); assert.match(zhPartial, /16,384/); assert.ok(!/[àáảãạăâêôơưđ]/i.test(zhPartial));
  assert.match(L.loadNotice(cpu, (s) => T.tr(s, 'en'), 'en'), /switched to CPU \(no GPU\), context 8,192/);
  assert.match(L.loadNotice(cpu, (s) => T.tr(s, 'zh'), 'zh'), /CPU（不使用 GPU）/);
  assert.strictEqual(L.loadNotice(gpu, (s) => T.tr(s, 'en'), 'en'), 'Loaded on the GPU, context 16,384.');
  assert.match(L.loadNotice(gpu, (s) => T.tr(s, 'zh'), 'zh'), /已在 GPU 上加载，上下文 16,384。/);
  assert.match(L.loadNotice(manual), /GPU \(số lớp tự chọn\), 10\/41 lớp trên GPU, ngữ cảnh 16\.384/);
  const enManual = L.loadNotice(manual, (s) => T.tr(s, 'en'), 'en');
  assert.strictEqual(enManual, 'Loaded with GPU (manual layer count), 10/41 layers on GPU, context 16,384. The model doesn\'t fit entirely in VRAM, so the rest runs on the CPU — slower, but it works.');
  assert.ok(!/số lớp|tự chọn/.test(enManual));
  const zhManual = L.loadNotice(manual, (s) => T.tr(s, 'zh'), 'zh');
  assert.match(zhManual, /GPU（手动层数）/); assert.match(zhManual, /10\/41 层在 GPU 上/); assert.match(zhManual, /16,384/);
  assert.ok(!/số lớp|tự chọn/.test(zhManual)); assert.ok(!/[àáảãạăâêôơưđ]/i.test(zhManual));
  assert.match(L.ctxReducedNote(16384, 8192), /8\.192/);
  assert.match(L.ctxReducedNote(16384, 8192, (s) => T.tr(s, 'en'), 'en'), /context 8,192 instead of 16,384/);
  assert.match(L.ctxReducedNote(16384, 8192, (s) => T.tr(s, 'zh'), 'zh'), /上下文 8,192/);
});

test('bộ nhớ offload: không ghim CPU, không xoá khi nạp một phần, ngữ cảnh đã hạ vẫn áp dụng', () => {
  const id = OM.identity({ file: '/m/a.gguf', size: 9, mtime: 3, backend: 'vulkan', gpuName: 'RTX 4070 SUPER', vramTotal: 12e9, settings: 'true|null|null|null' });
  const now = 1_700_000_000_000;
  let rec = OM.note(null, { gpu: 0, totalLayers: 41, ctx: 8192, requestedCtx: 16384, oom: true, freeAt: 2e9 }, id, now);
  assert.ok(rec && rec.gpu == null, 'CPU tạm không thành capLayers 0');
  assert.deepStrictEqual(OM.recall(rec, { ctx: 16384, free: 2e9, identity: id, now }), {});
  assert.deepStrictEqual(OM.recall(rec, { ctx: 16384, free: 8e9, identity: id, now }), {});
  rec = OM.note(null, { gpu: 23, totalLayers: 25, ctx: 8192, requestedCtx: 16384, oom: true, freeAt: 6e9 }, id, now);
  let again = OM.note(rec, { gpu: 23, totalLayers: 25, ctx: 8192, requestedCtx: 16384, oom: false, freeAt: 6e9 }, id, now + 10);
  assert.ok(again, 'nạp một phần thành công không xoá bộ nhớ');
  assert.strictEqual(again.gpu, 23);
  const applied = OM.recall(again, { ctx: 16384, free: 6e9, identity: id, now: now + 10 });
  assert.strictEqual(applied.capLayers, 23);
  assert.strictEqual(applied.ctx, 8192);
  assert.strictEqual(applied.reducedCtx, true);
  const rose = OM.recall(again, { ctx: 16384, free: 6e9 + OM.FREE_ROSE + 1, identity: id, now: now + 10 });
  assert.ok(rose.capLayers == null, 'VRAM trống tăng thì dò lại, không giữ mức lúc thẻ bận');
  let clean = again;
  for (let i = 0; i < 3; i++) clean = OM.note(clean, { gpu: 23, totalLayers: 25, ctx: 16384, requestedCtx: 16384, oom: false, freeAt: 6e9 }, id, now + 100 + i);
  const up = OM.recall(clean, { ctx: 16384, free: 6e9, identity: id, now: now + 200 });
  assert.strictEqual(up.capLayers, 25, 'sau vài lần sạch được bước lên, không vượt tổng số lớp');
  assert.strictEqual(OM.note(clean, { gpu: 25, totalLayers: 25, ctx: 16384, oom: false, freeAt: 6e9 }, id, now + 300), null);
  const crashed = OM.noteCrash(null, id, { ctx: 16384, gpu: 41 }, now);
  assert.notStrictEqual(crashed.gpu, 0);
  assert.strictEqual(OM.recall(crashed, { ctx: 16384, free: 11e9, identity: id, now }).safe, true);
  assert.ok(OM.recall(crashed, { ctx: 16384, free: 11e9, identity: id, now }).capLayers == null);
  const other = OM.identity({ ...id, settings: 'false|0|0|8' });
  assert.deepStrictEqual(OM.recall(again, { ctx: 16384, free: 6e9, identity: other, now: now + 10 }), {});
  assert.deepStrictEqual(OM.recall(again, { ctx: 16384, free: 6e9, identity: id, now: again.at + OM.EXPIRY_MS + 1 }), {});
});
