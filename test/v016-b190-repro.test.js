'use strict';
// Tái hiện từng lỗi B190 / #102 trên mã gốc 56bfe11 (đỏ) và trên đầu nhánh này (xanh).
// Không đổi logic sửa — chỉ gọi fit / gguf / câu lỗi đang có.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const F = require('../src/fit');

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const hw3050 = (vram) => ({ gpu: 'cuda', ram: 16 * GiB, vram, devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU'] });
const llama3b = { id: 'llama-3.2-3b', params: '3B', size: 1.88 * GiB };

test('repro: VRAM trống thật — 0,7 GB không tính như tổng, không đo được thì dùng tổng', () => {
  const held = F.machineFit(llama3b, hw3050({ total: 4 * GiB, free: 0.7 * GiB, freeKnown: true }), { ctx: 4096 });
  assert.match(held.hint, /Tràn/, held.hint);
  assert.notStrictEqual(held.group, 'smooth', held.hint);
  const unknown = F.machineFit(llama3b, hw3050({ total: 4 * GiB, free: 0.7 * GiB, freeKnown: false }), { ctx: 4096 });
  const totalOnly = F.machineFit(llama3b, hw3050({ total: 4 * GiB }), { ctx: 4096 });
  assert.strictEqual(unknown.hint, totalOnly.hint, `${unknown.hint} khác ${totalOnly.hint}`);
  assert.strictEqual(unknown.freeUnknown, true);
  const V = require('../src/vram-query');
  const mixed = V.resolveVram({ total: 4 * GiB, reportedFree: 3.55 * GiB, mixed: true }, { freeBytes: 0.7 * GiB });
  assert.strictEqual(mixed.freeSource, 'nvidia-smi');
  assert.ok(Math.abs(mixed.free - 0.7 * GiB) < 1);
  const missed = V.resolveVram({ total: 4 * GiB, reportedFree: 3.55 * GiB, mixed: true }, null);
  assert.strictEqual(missed.freeKnown, false);
  assert.strictEqual(missed.free, 4 * GiB);
  assert.match(V.UNKNOWN_FREE_LOG, /tạm tính theo tổng VRAM/);
  assert.match(read('src/engine.js'), /UNKNOWN_FREE_LOG/);
});

test('repro: bước xuống khi đo chậm, giữ lớp khi đo nhanh', async () => {
  const { loadWith, raceDuringProbe } = require('./b190-adv-run');
  const race = await raceDuringProbe();
  assert.strictEqual(race.seen.loaded, false, 'bản nháp được coi là đã nạp trong lúc đo');
  assert.strictEqual(race.seen.loading, true);
  assert.ok(!(race.userRes instanceof Error), race.userRes && race.userRes.message);
  assert.ok(race.loadRes && race.loadRes.gpuLayers < 29, 'không bước xuống');
  const slow = await loadWith({ msFor: (n) => (n >= 29 ? 60 : 4) }, 'repro-slow');
  assert.strictEqual(slow.loaded, true);
  assert.ok(slow.gpuLayers < 29 && slow.gpuLayers > 0, 'chậm mà không bước xuống: ' + slow.gpuLayers);
  const fast = await loadWith({ msFor: () => 4 }, 'repro-fast');
  assert.strictEqual(fast.loaded, true);
  assert.strictEqual(fast.gpuLayers, 29, 'nhanh mà vẫn bước xuống: ' + fast.gpuLayers);
  const S = require('../src/gpu-speed');
  const exp = S.expectedTps({ bytes: 2e9, gpuFrac: 1, gpuBw: 192 });
  assert.ok(exp > 55 && exp < 70, String(exp));
  assert.strictEqual(S.shouldStepDown({ tps: 22, expected: exp, tokens: 24 }).step, true);
  assert.strictEqual(S.shouldStepDown({ tps: 72, expected: exp, tokens: 24 }).step, false);
});

test('repro: số cách, danh sách và nhật ký là một', () => {
  const main = read('src/main.js');
  assert.doesNotMatch(main, /đã thử \$\{n\} cách: GPU, GPU một phần, CPU/);
  assert.match(read('src/engine.js'), /\[engine\] thử nạp /);
  const LF = require('../src/load-fail');
  const attempts = [
    { mode: 'gpu (29 lớp GPU, ngữ cảnh 8192)', message: 'Failed to load model' },
    { mode: 'cpu-only (0 lớp GPU, ngữ cảnh 8192)', message: 'Failed to load model' },
  ];
  const s = LF.failureText('broken.gguf', attempts, 'Failed to load model');
  assert.match(s, /đã thử 2 cách: GPU, CPU/);
  assert.doesNotMatch(s, /GPU một phần/);
  const ctxRetry = [
    { mode: 'gpu FA auto', message: 'out of memory', context: true },
    { mode: 'gpu (29 lớp GPU, ngữ cảnh 8192)', message: 'Failed to load model' },
  ];
  assert.deepStrictEqual(LF.waysOf(ctxRetry), ['GPU']);
  assert.match(main, /failureText\(/);
});

test('repro: chỉ chậm thì không lưu gpu=false, lỗi nạp GPU thật thì vẫn lưu', async () => {
  const { loadErr, LF } = require('./b190-adv-run');
  const slow = await loadErr({ msFor: () => 60 }, 'repro-slow-only');
  assert.strictEqual(slow && slow.code, 'LOAD_FAILED');
  assert.strictEqual(slow.gpu, true);
  assert.ok(slow.attempts.every((a) => a.slow), JSON.stringify(slow.attempts));
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: slow.attempts }), false, 'chỉ chậm vẫn ghi gpu=false');
  const oom = await loadErr({ loadFail: 'cudaMalloc failed' }, 'repro-oom');
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: oom.attempts }), true);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: false, attempts: oom.attempts }), false);
});

test('repro #102: ngữ cảnh không vượt trainCtx', () => {
  const big = { gpu: 'cuda', ram: 32 * GiB, vram: { total: 24 * GiB, free: 22 * GiB, freeKnown: true }, devices: ['NVIDIA GeForce RTX 4090'] };
  const smol = F.machineFit({ id: 'smollm2-1.7b-instruct', params: '1.7B', size: 1.1e9 }, big, { ctx: 16384 });
  assert.strictEqual(smol.ctx, 8192);
  assert.strictEqual(F.resolveGeo({ id: 'llama-3-8b', params: '8B', size: 4e9 }).trainCtx, 8192);
  assert.strictEqual(F.resolveGeo({ id: 'llama-3.2-3b', params: '3B', size: 2e9 }).trainCtx, 131072);
  const cap = F.machineFit({ id: 'llama-3-8b', params: '8B', size: 4.5e9 }, big, { ctx: 16384 });
  assert.strictEqual(cap.ctx, 8192);
});

test('repro #102: logits Llama 3', () => {
  const llama = F.resolveGeo({ id: 'llama-3.2-3b-instruct', params: '3B', size: 2e9 });
  assert.strictEqual(llama.vocab, 128256);
  const delta = F.computeBuf(8192, llama.layers, llama.vocab) - F.computeBuf(8192, llama.layers, 0);
  assert.ok(delta > 190 * MiB, (delta / MiB).toFixed(1));
});

test('repro #102: logits Gemma 3', () => {
  const gemma = F.resolveGeo({ id: 'gemma-3-4b-it', params: '4B', size: 3e9 });
  assert.strictEqual(gemma.vocab, 262144);
  assert.strictEqual(F.computeBuf(8192, gemma.layers, gemma.vocab) - F.computeBuf(8192, gemma.layers, 0), 512 * 262144 * 4);
});

test('repro #102: logits Mistral', () => {
  const mistral = F.resolveGeo({ id: 'mistral-7b-instruct', params: '7B', size: 4e9 });
  assert.strictEqual(mistral.vocab, 32768);
  assert.ok(mistral.layers > 0);
  assert.ok(F.computeBuf(8192, mistral.layers, mistral.vocab) > F.computeBuf(8192, mistral.layers, 0));
});

test('repro #102: loaderLayers truyền kvScale', () => {
  const m = { id: 'llama-3.1-8b', params: '8B', size: 4.6 * GiB };
  const hw = { gpu: 'cuda', ram: 16 * GiB, vram: { total: 6 * GiB, free: 5.2 * GiB, freeKnown: true }, devices: ['NVIDIA GeForce RTX 4050'] };
  const f16 = F.machineFit(m, hw, { ctx: 4096, kvScale: 1 });
  const q8 = F.machineFit(m, hw, { ctx: 4096, kvScale: 0.55 });
  assert.notStrictEqual(f16.hint, q8.hint, `${f16.hint} == ${q8.hint}`);
  assert.strictEqual(q8.group, 'smooth', q8.hint);
  const src = read('src/fit.js');
  assert.match(src, /function loaderLayers\(m, g, hw, ctx, o/);
  assert.match(src, /kvScale: o\.kvScale/);
});

test('repro #102: không ghi Tràn 0,0 GB', () => {
  const hw = { gpu: 'cuda', ram: 64 * GiB, vram: { total: 8 * GiB, free: 8 * GiB, freeKnown: true }, devices: ['NVIDIA GeForce RTX 4060'] };
  const arch = { id: 'qwen3-8b', params: '8B', arch: 'qwen3' };
  const base = F.machineFit({ ...arch, size: 5 * GiB }, hw, { ctx: 8192 });
  const overhead = base.need - 5 * GiB;
  const budget = typeof F.vramBudgetOf === 'function'
    ? F.vramBudgetOf(hw.vram).budget
    : hw.vram.total - Math.max(600 * MiB, hw.vram.total * 0.06);
  const size = budget - overhead + 20 * MiB;
  const r = F.machineFit({ ...arch, size }, hw, { ctx: 8192 });
  assert.strictEqual(r.group, 'smooth', `${r.hint} | ${r.text}`);
  assert.doesNotMatch(`${r.hint} ${r.text}`, /Tràn/);
  assert.doesNotMatch(`${r.hint} ${r.text}`, /0,0 GB/);
});

test('repro #102: phi không khớp delphi, sophia, dolphin', () => {
  for (const id of ['delphi', 'sophia-7b', 'dolphin-2.9']) {
    assert.strictEqual(F.resolveGeo({ id, params: '7B', size: 4e9 }).layers, 0, id);
  }
  assert.strictEqual(F.resolveGeo({ id: 'phi-3.5-mini', params: '4B', size: 2e9 }).kvHeads, 32);
  assert.ok(F.resolveGeo({ id: 'phi-4-mini-instruct', params: '4B', size: 2e9 }).layers > 0);
  assert.ok(F.resolveGeo({ arch: 'phi3', params: '4B', size: 2e9 }).layers > 0);
});
