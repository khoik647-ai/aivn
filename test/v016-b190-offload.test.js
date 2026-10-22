'use strict';
// B190: offload GPU — mô hình vừa VRAM thì đưa HẾT lớp và giữ ngữ cảnh; GPU nhỏ vẫn một phần, dưới VRAM trống.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const G = require('../src/gguf');
const { loadPlans, oomSchedule, explicitFlash, flashForContext, contextTries } = require('../src/engine');
const OM = require('../src/offload-memory');
const VS = require('../src/vision-server');

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
// Kích thước tệp lấy từ danh mục (Q4_K_M / MXFP4). KV f16 theo kiến trúc: 14B 40×8×128, 20B 24×8×64.
const MODELS = {
  '2B': { fileSize: 1708582752, layers: 28, kvPerToken: 115000 },
  '4B': { fileSize: 2497281120, layers: 36, kvPerToken: 147456 },
  '8B': { fileSize: 5027784224, layers: 36, kvPerToken: 147456 },
  '14B': { fileSize: 9001752960, layers: 40, kvPerToken: 163840 },
  '20B': { fileSize: 12109566624, layers: 24, kvPerToken: 49152 },
};
// 12 GB: VRAM trống đo trên RTX 4070 SUPER (11437 MiB) — đúng máy QA.
const CARDS = {
  '4': { total: 4 * GiB, free: 3.6 * GiB },
  '6': { total: 6 * GiB, free: 5.4 * GiB },
  '8': { total: 8 * GiB, free: 7.2 * GiB },
  '12': { total: 12 * GiB, free: 11437 * MiB },
  '16': { total: 16 * GiB, free: 15 * GiB },
};
const CTX = 16384;

test('B190: 12 GB — 2B/4B/8B/14B trọn lớp ở 16384 KV f16; 20B một phần; không confident khi chưa có byte tensor; 4 GB thì một phần', () => {
  for (const name of ['2B', '4B', '8B', '14B']) {
    const d = G.chooseOffload(MODELS[name], { ctx: CTX, vram: CARDS['12'] });
    assert.strictEqual(d.gpuLayers, d.totalLayers, name + ' trên 12 GB phải đủ lớp, nhận ' + d.gpuLayers);
    assert.strictEqual(d.kv, 'f16', name + ' trên 12 GB không bị ép q8_0');
    assert.ok(d.used <= d.free, name + ' vượt VRAM trống');
    assert.notStrictEqual(d.confident, true, name + ' chưa đo tensor thì không bỏ kiểm tra bộ nhớ');
    const plans = loadPlans({ gpu: 'cuda', vram: CARDS['12'], fileSize: MODELS[name].fileSize, geo: MODELS[name], ctx: CTX, minCtx: 8192 });
    assert.strictEqual(plans[0].gpuLayers, d.totalLayers);
    assert.strictEqual(plans[0].ctx, CTX);
    assert.notStrictEqual(plans[0].confident, true);
  }
  const big = G.chooseOffload(MODELS['20B'], { ctx: CTX, vram: CARDS['12'] });
  assert.ok(big.gpuLayers > 0 && big.gpuLayers < big.totalLayers, '20B trên 12 GB là một phần, nhận ' + big.gpuLayers);
  assert.ok(big.gpuLayers >= 20, '20B không được rơi xuống dưới 20 lớp ở lô 512, nhận ' + big.gpuLayers);
  assert.strictEqual(big.kv, 'f16');
  assert.ok(big.used <= big.free);
  for (const name of ['14B', '20B', '8B']) {
    const d = G.chooseOffload(MODELS[name], { ctx: CTX, vram: CARDS['4'] });
    assert.ok(d.gpuLayers > 0 && d.gpuLayers < d.totalLayers, name + ' trên 4 GB phải một phần, nhận ' + d.gpuLayers + '/' + d.totalLayers);
    assert.ok(d.used <= d.free + 1, name + ' trên 4 GB vượt VRAM trống');
    assert.notStrictEqual(d.confident, true);
  }
});

test('B190: bảng VRAM 4/6/8/12/16 GB × 2B/4B/8B/14B/20B — không bao giờ vượt VRAM trống', () => {
  for (const [gb, vram] of Object.entries(CARDS)) {
    for (const [name, model] of Object.entries(MODELS)) {
      const d = G.chooseOffload(model, { ctx: CTX, vram });
      assert.ok(d.gpuLayers >= 0 && d.gpuLayers <= d.totalLayers, gb + ' ' + name);
      assert.ok(d.used <= d.free + 1, `${gb}GB ${name} used ${d.used} > free ${d.free}`);
      if (gb === '16') assert.strictEqual(d.gpuLayers, d.totalLayers, name);
    }
  }
  // GPU 6 GB không được coi là “dưới 6 GB” để ép q8 khi f16 đã vừa (4B).
  const q = G.chooseOffload(MODELS['4B'], { ctx: CTX, vram: CARDS['6'] });
  assert.strictEqual(q.gpuLayers, q.totalLayers);
  assert.strictEqual(q.kv, 'f16');
});

test('B190: hết VRAM thì bước xuống 4 lớp, tối đa 3 lần GPU rồi CPU; ngữ cảnh GPU không bị cắt trước', () => {
  const model = MODELS['14B'];
  const plans = loadPlans({ gpu: 'cuda', vram: CARDS['12'], fileSize: model.fileSize, geo: model, ctx: CTX, minCtx: 8192 });
  const sched = oomSchedule(plans);
  const gpuTries = sched.filter(p => Number(p.gpuLayers) > 0);
  assert.ok(sched.length >= 2 && sched.length <= 6, JSON.stringify(sched));
  assert.ok(gpuTries.length <= 3 && gpuTries.length >= 2);
  assert.strictEqual(sched[0].gpuLayers, 41);
  assert.strictEqual(sched[0].ctx, CTX);
  assert.strictEqual(sched[1].gpuLayers, 37, 'bước −4, không nhảy 41 → 30');
  assert.strictEqual(sched[1].ctx, CTX);
  assert.ok(gpuTries.every(p => p.ctx === CTX), 'lần thử GPU giữ ngữ cảnh xin');
  assert.strictEqual(sched[sched.length - 1].gpuLayers, 0);
  assert.ok(sched.some(p => p.gpuLayers === 0 && p.ctx === 4096), 'CPU còn bậc 4096');
  const winner = gpuTries[gpuTries.length - 1];
  const next = loadPlans({ gpu: 'cuda', vram: CARDS['12'], fileSize: model.fileSize, geo: model, ctx: CTX, capLayers: winner.gpuLayers });
  assert.ok(next[0].gpuLayers <= winner.gpuLayers);
  assert.notStrictEqual(next[0].confident, true, 'không thử lại offload trọn sau khi đã phải bước xuống');
  const crashed = loadPlans({ gpu: 'cuda', vram: CARDS['12'], fileSize: model.fileSize, geo: model, ctx: CTX, safe: true });
  assert.strictEqual(crashed[0].gpuLayers, 41);
  assert.notStrictEqual(crashed[0].confident, true, 'sau khi tiến trình sập thì không bỏ qua kiểm tra bộ nhớ');
  const stuck = loadPlans({ gpu: 'cuda', vram: CARDS['12'], fileSize: model.fileSize, geo: model, ctx: CTX, capLayers: 0 });
  assert.ok(stuck.every(p => p.gpuLayers === 0));
});

test('B190: --fit-target trên GPU lớn là lề 300–512 MiB, GPU 4 GB vẫn ≥ 1024; -ngl khi đã chọn số lớp', async () => {
  const mm = 453974304;
  assert.strictEqual(G.serverMarginMiB(mm), 1024);
  assert.strictEqual(G.serverMarginMiB(mm, CARDS['4']), 1024);
  const big = G.serverMarginMiB(0, CARDS['12']);
  assert.ok(big >= 300 && big <= 600, 'lề 12 GB = ' + big);
  assert.ok(G.serverMarginMiB(mm, CARDS['12']) < 1229, 'không còn mục tiêu 1229 MiB trên thẻ 12 GB');
  const exe = '/tmp/fakesrv-b190/llama-server';
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '#!/bin/sh\necho "$@" > "$(dirname "$0")/args.txt"\nexit 1\n');
  fs.chmodSync(exe, 0o755);
  const argsOf = async (o) => {
    try { fs.unlinkSync('/tmp/fakesrv-b190/args.txt'); } catch {}
    const vs = VS.createVisionServer({ log: () => {} });
    await vs._startOn(exe, { id: 'm', modelPath: '/tmp/x.gguf', mmprojPath: '/tmp/mm.gguf', contextSize: 16384, gpu: true, ...o }, 'vulkan').catch(() => {});
    for (let i = 0; i < 40 && !fs.existsSync('/tmp/fakesrv-b190/args.txt'); i++) await new Promise(r => setTimeout(r, 25));
    return fs.readFileSync('/tmp/fakesrv-b190/args.txt', 'utf8').trim().split(/\s+/);
  };
  let a = await argsOf({ fitTargetMiB: big });
  assert.strictEqual(a[a.indexOf('--fit-target') + 1], String(big));
  assert.strictEqual(a[a.indexOf('-c') + 1], '16384');
  assert.ok(!a.includes('-ngl'));
  a = await argsOf({ gpuLayers: 41 });
  assert.strictEqual(a[a.indexOf('-ngl') + 1], '41');
  assert.ok(!a.includes('--fit-target'));
});

test('B190: số lớp người dùng đứng đầu và thang chỉ đi xuống; CPU (0 lớp) không bị kế hoạch 41 lớp leo qua', () => {
  const model = MODELS['14B'];
  const base = { gpu: 'cuda', vram: CARDS['12'], fileSize: model.fileSize, geo: model, ctx: CTX, minCtx: 8192 };
  const manual = loadPlans({ ...base, userLayers: 10 });
  assert.deepStrictEqual([manual[0].mode, manual[0].gpuLayers], ['gpu-manual', 10]);
  assert.ok(manual.every(p => !(Number(p.gpuLayers) > 10)), JSON.stringify(manual.map(p => p.gpuLayers)));
  const cpu = loadPlans({ ...base, userLayers: 0 });
  assert.ok(cpu.every(p => p.gpuLayers === 0), JSON.stringify(cpu));
  assert.ok(oomSchedule(cpu).every(p => p.gpuLayers === 0));
  const none = loadPlans({ gpu: false, vram: null, fileSize: model.fileSize, geo: model, ctx: CTX });
  assert.strictEqual(none.filter(p => p.ctx === CTX).length, 1, 'CPU-only không thêm hai lần cùng ngữ cảnh');
  assert.ok(none.some(p => p.ctx === 4096 && p.mode === 'cpu-only'));
});

test('B190: mmproj trừ khỏi chỗ trống; GPU tích hợp không q8 và không confident; f16 tường minh không bị đổi', () => {
  const mm = Math.round(1.2 * GiB);
  const withMm = G.chooseOffload(MODELS['14B'], { ctx: CTX, vram: CARDS['12'], mmprojBytes: mm, weightBytes: MODELS['14B'].fileSize });
  assert.ok(withMm.gpuLayers < withMm.totalLayers, '14B + mmproj trên 12 GB không được -ngl 41, nhận ' + withMm.gpuLayers);
  assert.notStrictEqual(withMm.confident, true);
  const ig = G.chooseOffload(MODELS['2B'], { ctx: 4096, vram: { total: 8 * GiB, free: 7 * GiB, integratedOnly: true }, weightBytes: 1.2e9 });
  assert.strictEqual(ig.kv, 'f16');
  assert.notStrictEqual(ig.confident, true);
  const keep = G.chooseOffload(MODELS['4B'], { ctx: CTX, vram: CARDS['4'], kvType: 'f16' });
  assert.strictEqual(keep.kv, 'f16');
  const measured = G.chooseOffload(MODELS['2B'], { ctx: CTX, vram: CARDS['12'], weightBytes: Math.round(MODELS['2B'].fileSize * 0.9) });
  assert.strictEqual(measured.gpuLayers, measured.totalLayers);
  assert.strictEqual(measured.confident, true);
});

test('B190: bộ đệm tính toán theo lô (mốc 1,9 GB ở lô 2048); VRAM trống thật, không phải tổng', () => {
  assert.strictEqual(G.contextComputeBuf({ ctx: CTX, batch: 2048, layers: 40 }), 1907425280);
  const small = G.contextComputeBuf({ ctx: CTX, batch: 512, layers: 40 });
  assert.ok(small < 1907425280 / 3, 'lô 512 phải nhỏ hơn nhiều so với lô 2048, nhận ' + small);
  assert.ok(small >= 256 * MiB);
  const busy = { total: 12 * GiB, free: 12 * GiB - 5.8 * GiB };
  const d = G.chooseOffload(MODELS['14B'], { ctx: CTX, vram: busy });
  assert.ok(d.gpuLayers < 30 && d.gpuLayers >= 10, 'thẻ gần đầy không còn 41/41, nhận ' + d.gpuLayers);
  assert.notStrictEqual(d.confident, true);
  const plans = oomSchedule(loadPlans({ gpu: 'vulkan', vram: busy, fileSize: MODELS['14B'].fileSize, geo: MODELS['14B'], ctx: CTX, minCtx: 8192 }));
  const gpu = plans.filter(p => p.gpuLayers > 0);
  assert.ok(gpu.length >= 2, JSON.stringify(plans.map(p => p.gpuLayers)));
  assert.ok(gpu.some(p => p.gpuLayers >= 10 && p.gpuLayers <= 16), 'còn một bước khoảng 10–15 lớp, không nhảy thẳng CPU');
});

test('B190: ngữ cảnh node-llama-cpp nhận batchSize ≤ 2048 và flash attention auto, không lấy lô 2048 của perf', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/engine.js'), 'utf8');
  assert.match(src, /batchSize: Math\.max\(1, Math\.min\(batchCap, plan\.ctx\)\)/);
  assert.match(src, /flashAttention: fa/);
  assert.match(src, /contextTries\(userFlash/);
  assert.doesNotMatch(src, /flashAttention: flashOff \? false : true/);
  assert.match(src, /const batchCap = Math\.max\(1, Math\.min\(Number\.isInteger\(opts\.batchSize\) \? opts\.batchSize : 512, 2048\)\)/);
  assert.match(src, /ignoreMemorySafetyChecks: true/);
  assert.strictEqual(explicitFlash(undefined, 'auto'), null);
  assert.strictEqual(explicitFlash(undefined, false), false);
  assert.strictEqual(explicitFlash(true, false), true);
  assert.strictEqual(flashForContext(null, false), 'auto');
  assert.strictEqual(flashForContext(true, false), true);
  assert.strictEqual(flashForContext(false, false), false);
  assert.deepStrictEqual(contextTries(null, false), [{ fa: 'auto', kv: false }, { fa: false, kv: false }]);
  assert.deepStrictEqual(contextTries(true, false), [{ fa: true, kv: false }, { fa: false, kv: false }]);
  assert.deepStrictEqual(contextTries(false, false), [{ fa: false, kv: false }]);
  assert.deepStrictEqual(contextTries(null, true), [{ fa: true, kv: true }, { fa: false, kv: false }]);
  assert.deepStrictEqual(contextTries(false, true), [{ fa: true, kv: true }, { fa: false, kv: false }]);
});

test('B190: 4B trên 4 GB — OOM 37 q8 không được bước lại thành 37 confident sau 3 lần sạch', () => {
  const model = MODELS['4B'];
  const vram = { total: 4 * GiB, free: 4 * GiB };
  const fit = G.chooseOffload(model, { ctx: 8192, vram, weightBytes: model.fileSize });
  assert.deepStrictEqual([fit.gpuLayers, fit.kv, fit.confident], [37, 'q8_0', true]);
  const eager = loadPlans({ gpu: 'vulkan', vram, fileSize: model.fileSize, geo: model, ctx: 8192, minCtx: 8192, weightBytes: model.fileSize });
  assert.strictEqual(eager[0].gpuLayers, 37);
  assert.strictEqual(eager[0].kv, 'q8_0');
  assert.strictEqual(eager[0].confident, true);
  const id = OM.identity({ file: '/m/4b.gguf', size: model.fileSize, mtime: 1, backend: 'vulkan', gpuName: 'dGPU 4GB', vramTotal: 4 * GiB, settings: 'true|null|null|null' });
  const now = 1_700_000_000_000;
  let rec = OM.note(null, { gpu: 33, totalLayers: 37, ctx: 8192, requestedCtx: 8192, oom: true, oomGpu: 37, freeAt: vram.free }, id, now);
  assert.strictEqual(rec.oomGpu, 37);
  assert.strictEqual(rec.gpu, 33);
  for (let i = 0; i < 3; i++) rec = OM.note(rec, { gpu: 33, totalLayers: 37, ctx: 8192, requestedCtx: 8192, oom: false, freeAt: vram.free }, id, now + 10 + i);
  assert.strictEqual(rec.oomGpu, 37, 'ba lần sạch không được quên số lớp đã OOM');
  const mem = OM.recall(rec, { ctx: 8192, free: vram.free, identity: id, now: now + 20 });
  assert.notStrictEqual(mem.capLayers, 37);
  assert.ok(mem.capLayers < 37, 'cap sau 3 lần sạch = ' + mem.capLayers);
  const again = loadPlans({ gpu: 'vulkan', vram, fileSize: model.fileSize, geo: model, ctx: 8192, minCtx: 8192, weightBytes: model.fileSize, capLayers: mem.capLayers });
  assert.notStrictEqual(again[0].gpuLayers, 37);
  assert.notStrictEqual(again[0].confident, true);
  assert.ok(!again.some(p => p.gpuLayers === 37 && p.confident));
  const sameCap = loadPlans({ gpu: 'vulkan', vram, fileSize: model.fileSize, geo: model, ctx: 8192, minCtx: 8192, weightBytes: model.fileSize, capLayers: 37 });
  assert.strictEqual(sameCap[0].gpuLayers, 37);
  assert.notStrictEqual(sameCap[0].confident, true, 'trần từ bộ nhớ bằng fitN vẫn không ignoreMemorySafetyChecks');
  const rose = OM.recall(rec, { ctx: 8192, free: vram.free + OM.FREE_ROSE + 1, identity: id, now: now + 20 });
  assert.ok(rose.capLayers == null, 'VRAM trống tăng ≥ FREE_ROSE thì được dò lại');
  const shy = OM.recall(rec, { ctx: 8192, free: vram.free + OM.FREE_ROSE - 1, identity: id, now: now + 20 });
  assert.ok(shy.capLayers < 37);
  let lower = OM.note(null, { gpu: 20, totalLayers: 37, ctx: 8192, oom: true, oomGpu: 30, freeAt: vram.free }, id, now);
  for (let i = 0; i < 3; i++) lower = OM.note(lower, { gpu: 20, totalLayers: 37, ctx: 8192, oom: false, freeAt: vram.free }, id, now + 10 + i);
  assert.strictEqual(OM.recall(lower, { ctx: 8192, free: vram.free, identity: id, now: now + 20 }).capLayers, 24);
  const crashed = OM.noteCrash(rec, id, { ctx: 8192, gpu: 37 }, now + 30);
  assert.strictEqual(crashed.crashedGpu, 37);
  assert.notStrictEqual(crashed.crashedGpu, rec.gpu);
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(main, /gpu: loadingGpu/);
  assert.doesNotMatch(main, /noteCrash\([\s\S]{0,240}rec\.offload && rec\.offload\.gpu/);
});
