'use strict';
// B78 (pass 8): “Chạy mượt” cạnh “Đo được 0,1 token/giây”; GGUF giả 2 KB ước “~1000 token/giây”; huy hiệu “Đang nạp” khi đã nạp xong
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const F = require('../src/fit');
const CORE = require('../src/i18n/core'); const T = CORE.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
const HW = { ram: 32 * 1024 ** 3, gpu: 'cuda', vram: { total: 12 * 1024 ** 3 }, devices: ['NVIDIA GeForce RTX 4070 SUPER'] };
test('B78: tệp GGUF quá nhỏ (2 KB) → Không chạy được, không ước tốc độ/bộ nhớ', () => {
  const f = F.machineFit({ size: 2048, params: '0.5B' }, HW); assert.strictEqual(f.group, 'no'); assert.strictEqual(f.tps, 0); assert.ok(f.invalid); assert.strictEqual(F.fmtFit(f), '');
  assert.match(T.tr(f.hint, 'en'), /too small/); const real = F.machineFit({ size: 120 * 1024 ** 2, params: '135M' }, HW); assert.ok(!real.invalid);
});
test('B78: số đo thật < 5 token/giây → Chạy chậm (theo số đo), không còn “Chạy mượt”; số đo nhanh giữ nguyên', () => {
  const slow = F.machineFit({ size: 2.5 * 1024 ** 3, params: '4B', measuredTps: 0.1 }, HW);
  assert.strictEqual(slow.group, 'slow'); assert.strictEqual(slow.label, 'Chạy chậm'); assert.ok(slow.tpsMeasured); assert.match(slow.hint, /Đo được chỉ ~0,1 token\/giây/);
  assert.strictEqual(T.tr(slow.hint, 'en'), 'Measured only ~0.1 tokens/s on this computer');
  const fast = F.machineFit({ size: 2.5 * 1024 ** 3, params: '4B', measuredTps: 110 }, HW); assert.strictEqual(fast.group, 'smooth'); assert.strictEqual(fast.tps, 110);
});
test('B78: huy hiệu mô hình đã nạp là “Đang dùng”, không phải “Đang nạp”', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app.js'), 'utf8');
  assert.match(a, /m\.loaded \? '<span class="badge">Đang dùng<\/span>'/); assert.ok(!/m\.loaded \? '<span class="badge">Đang nạp/.test(a));
});
