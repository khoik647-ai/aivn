'use strict';
// Hành vi B190 sau phản biện PR #63: bản nháp lúc đo tốc độ, và gpu=false khi chỉ chậm.
// Đỏ trên aea3e61 (current được công bố giữa lúc đo; mọi lần chậm đều LOAD_FAILED gpu:true và được ghi gpu=false).
const test = require('node:test');
const assert = require('node:assert');
const { raceDuringProbe, loadErr, loadWith, LF } = require('./b190-adv-run');

test('A1: yêu cầu trong lúc đo tốc độ không chạy trên mô hình bị bước xuống huỷ', async () => {
  const { seen, userRes, loadRes, finalReady, log } = await raceDuringProbe();
  assert.strictEqual(seen.loaded, false, 'status().loaded trong lúc đo: ' + JSON.stringify(seen));
  assert.strictEqual(seen.loading, true, 'status() phải báo đang nạp khi đang đo');
  assert.ok(!(userRes instanceof Error), 'yêu cầu người dùng lỗi: ' + (userRes && userRes.message));
  assert.ok(!log.some((x) => x.startsWith('USE-AFTER-DISPOSE')), log.join(' | '));
  assert.strictEqual(loadRes && loadRes.loaded, true, loadRes && loadRes.message);
  assert.ok(loadRes.gpuLayers < 29 && loadRes.gpuLayers > 0, 'không bước xuống: ' + loadRes.gpuLayers);
  assert.strictEqual(finalReady && finalReady.loaded, true);
  assert.strictEqual(finalReady.gpuLayers, loadRes.gpuLayers);
  const userLayer = (log.find((x) => x.startsWith('gen-start user')) || '').split(' ').pop();
  assert.strictEqual(Number(userLayer), loadRes.gpuLayers, log.join(' | '));
});

test('A2: chỉ chậm thì không ghi gpu=false; lỗi GPU thật thì vẫn ghi sau khi CPU nạp được', async () => {
  const slow = await loadErr({ msFor: () => 60 }, 'slow');
  assert.strictEqual(slow && slow.code, 'LOAD_FAILED', slow && slow.message);
  assert.strictEqual(slow.gpu, true, 'lần nạp này vẫn phải được chuyển sang CPU');
  assert.ok(slow.attempts && slow.attempts.length >= 3, JSON.stringify(slow.attempts));
  assert.ok(slow.attempts.every((a) => a.slow), JSON.stringify(slow.attempts));
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: slow.attempts }), false);
  const oom = await loadErr({ loadFail: 'out of memory' }, 'oom');
  assert.strictEqual(oom && oom.code, 'LOAD_FAILED');
  assert.ok(oom.attempts.some((a) => /out of memory/i.test(a.message)));
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: oom.attempts }), true);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: false, attempts: oom.attempts }), false);
});

test('N2: VRAM trống dưới 96 MiB nhưng tốc độ tốt thì không bước xuống', async () => {
  const st = await loadWith({ msFor: () => 4, freeAfter: 0.02 }, 'pinch');
  assert.strictEqual(st.loaded, true);
  assert.strictEqual(st.gpuLayers, 29, 'đã bước xuống dù nhanh: ' + st.gpuLayers);
});
