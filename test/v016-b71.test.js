'use strict';
// B71 (máy thật: gpt-oss-20b-MXFP4 12,1 GB trên RTX 4070 SUPER 12 GB)
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const L = require('../src/load-notice'); const F = require('../src/fit');
test('B71: thông báo nạp nói đúng trạng thái CUỐI (GPU một phần 15/25 lớp, ngữ cảnh 16.384), không còn “GPU không nạp được”', () => {
  const t = L.loadNotice({ mode: 'gpu-partial', gpuLayers: 15, totalLayers: 25, contextSize: 16384 });
  assert.match(t, /GPU một phần \+ CPU \(15\/25 lớp trên GPU\), ngữ cảnh 16\.384/); assert.ok(!/không nạp được|8192|8\.192/.test(t));
  assert.match(L.loadNotice({ mode: 'cpu-only', contextSize: 8192 }), /chuyển sang CPU \(không dùng GPU\), ngữ cảnh 8\.192/);
  assert.strictEqual(L.attemptText('gpu (25 lớp GPU, ngữ cảnh 16384): A context size of 8192 is too large for the available VRAM'), 'gpu (25 lớp GPU, ngữ cảnh 16384): không đủ VRAM');
  const m = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'); assert.match(m, /st\.notice = require\('\.\/load-notice'\)\.loadNotice\(st/);
  assert.match(m, /final: \{ mode: st\.mode, ctx: st\.contextSize, gpuLayers: st\.gpuLayers, totalLayers: st\.totalLayers \}/);
});
test('B71: nhãn khớp máy cho gpt-oss-20b trên 12 GB VRAM là “Chạy chậm” (8k và 16k)', () => {
  const c = require('../src/catalog').find ? require('../src/catalog').find(x => x.id === 'gpt-oss-20b-mxfp4') : null;
  const cat = c || [].concat(...Object.values(require('../src/catalog'))).find(x => x && x.id === 'gpt-oss-20b-mxfp4');
  for (const vr of [12000, 12282, 12288]) for (const ctx of [8192, 16384]) {
    const hw = { gpu: 'cuda', vram: { total: vr * 1048576, free: vr * 1048576 * 0.9 }, ram: 32 * 1024 ** 3, devices: ['NVIDIA GeForce RTX 4070 SUPER'] };
    const r = F.machineFit(F.metaOf({ catalog: cat }), hw, { ctx }); assert.strictEqual(r.label, 'Chạy chậm', `${vr} MiB ctx ${ctx}`);
  }
});
test('B71: gpt-oss dùng mẫu Harmony của node-llama-cpp; phần suy luận (analysis) tách khỏi câu trả lời (final)', () => {
  const e = fs.readFileSync(path.join(__dirname, '../src/engine.js'), 'utf8');
  assert.match(e, /segmentType === 'thought'/); assert.match(e, /res\.responseText/);
  assert.ok(fs.existsSync(require.resolve('node-llama-cpp').replace(/dist[\\/].*$/, 'dist/chatWrappers/HarmonyChatWrapper.js')));
});
test('B71: giới hạn phần suy luận (budgets.thoughtTokens) để luôn còn chỗ cho câu trả lời', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '../src/engine.js'), 'utf8'), /budgets: \{ thoughtTokens: Math\.max\(256, Math\.floor\(maxTokens \* 0\.6\)\) \}/);
});
const OSS = process.env.AIVN_GPTOSS_GGUF || '/workspace/bench-models/gpt-oss-20b-MXFP4.gguf';
test('B71: tệp gpt-oss-20b thật → node-llama-cpp chọn HarmonyChatWrapper (kênh analysis = thought)', { skip: !fs.existsSync(OSS) && 'không có tệp gpt-oss' }, async () => {
  const { readGgufFileInfo, resolveChatWrapper } = await import('node-llama-cpp');
  const w = resolveChatWrapper({ fileInfo: await readGgufFileInfo(OSS, { readTensorInfo: false }), bosString: '', eosString: '' });
  assert.strictEqual(w.constructor.name, 'HarmonyChatWrapper'); assert.ok(w.settings.segments.thought);
});
