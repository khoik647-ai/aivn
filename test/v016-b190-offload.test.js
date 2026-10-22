'use strict';
// B190: offload GPU — mô hình vừa VRAM thì đưa HẾT lớp và giữ ngữ cảnh; GPU nhỏ vẫn một phần, dưới VRAM trống.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const G = require('../src/gguf');
const { loadPlans, oomSchedule } = require('../src/engine');
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

test('B190: 12 GB offload trọn 14B và 20B ở ngữ cảnh 16384, KV f16; 4 GB thì một phần và dưới VRAM trống', () => {
  for (const name of ['2B', '4B', '8B', '14B', '20B']) {
    const d = G.chooseOffload(MODELS[name], { ctx: CTX, vram: CARDS['12'] });
    assert.strictEqual(d.gpuLayers, d.totalLayers, name + ' trên 12 GB phải đủ lớp');
    assert.strictEqual(d.kv, 'f16', name + ' trên 12 GB không bị ép q8_0');
    assert.ok(d.used <= d.free, name + ' vượt VRAM trống');
    const plans = loadPlans({ gpu: 'cuda', vram: CARDS['12'], fileSize: MODELS[name].fileSize, geo: MODELS[name], ctx: CTX, minCtx: 8192 });
    assert.strictEqual(plans[0].gpuLayers, d.totalLayers);
    assert.strictEqual(plans[0].ctx, CTX);
    assert.strictEqual(plans[0].confident, true);
  }
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

test('B190: hết VRAM thì bước xuống tối đa 3 lần GPU rồi CPU; lần nạp sau bắt đầu từ mức đã chọn', () => {
  const model = MODELS['14B'];
  const plans = loadPlans({ gpu: 'cuda', vram: CARDS['12'], fileSize: model.fileSize, geo: model, ctx: CTX, minCtx: 8192 });
  const sched = oomSchedule(plans);
  assert.ok(sched.length >= 2 && sched.length <= 4, JSON.stringify(sched));
  assert.ok(sched.filter(p => Number(p.gpuLayers) > 0).length <= 3);
  assert.strictEqual(sched[0].gpuLayers, 41);
  assert.strictEqual(sched[0].ctx, CTX);
  assert.ok(sched[1].gpuLayers < sched[0].gpuLayers, 'bước xuống bớt lớp trước');
  assert.strictEqual(sched[sched.length - 1].gpuLayers, 0);
  const ctxDrop = sched.find(p => p.ctx < CTX && p.gpuLayers > 0);
  assert.ok(ctxDrop, 'vẫn có một bước giảm ngữ cảnh trong số lần thử');
  assert.ok(sched.indexOf(ctxDrop) > sched.indexOf(sched[1]));
  const winner = sched[2];
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
