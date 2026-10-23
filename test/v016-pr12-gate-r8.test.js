'use strict';
// Cổng vòng 8 của PR #12. Ca mới, thêm vào; không sửa ca cổng cũ. Không thêm todo.
// Khoá giả ghép lúc chạy. Không có chuỗi trông như khoá thật trong tệp.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/plugins');
const LOG = require('../src/logger');

const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function mixKey() {
  let s = '';
  for (let i = 0; i < 32; i++) s += AL[(i * 7 + 3) % AL.length];
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/\d/.test(s)) throw new Error('mix');
  return s;
}
function hexKey() {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 40; i++) s += h[i % 16];
  if (!/^[0-9a-f]{40}$/.test(s)) throw new Error('hex');
  return s;
}
const KEY = mixKey();
const HEX = hexKey();
// redactText: đường che chữ mà LOG.redact gọi cho chuỗi.
function redactText(s) { return P.maskKnownSecrets(s); }

function leading(n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) parts.push('Error');
    else if (i === 1) parts.push('WARN');
    else parts.push(String.fromCharCode(97 + ((i - 2) % 26)));
  }
  return parts.map(p => p + ':').join(' ') + ' ';
}

test('[r8] từ nhãn thứ 9, khoá không tiền tố sau password / x-api-key / api_key bị che', () => {
  for (const n of [9, 10, 12, 16]) {
    for (const name of ['password', 'x-api-key', 'api_key']) {
      for (const key of [KEY, HEX]) {
        const line = leading(n) + name + ': ' + key;
        const err = new Error(line);
        for (const out of [LOG.redact(line), redactText(line), LOG.redact(err.message)]) {
          assert.equal(typeof out, 'string');
          assert.ok(!out.includes(key), 'LEAK ' + n + ' ' + name);
          assert.ok(out.includes('••••'), 'không che ' + n + ' ' + name);
          assert.ok(out.includes('Error:'), 'mất nhãn ' + n);
          assert.ok(out.includes(name + ':'), 'mất ' + name);
        }
      }
    }
  }
});

test('[r8] 1 MB nhãn lặp xong dưới 1000 ms', () => {
  const mb = 1024 * 1024;
  const unitA = 'a: ';
  const labels = unitA.repeat(Math.ceil(mb / unitA.length)).slice(0, mb);
  assert.equal(labels.length, mb);
  let t = performance.now();
  const plain = LOG.redact(labels);
  const msLabels = performance.now() - t;
  assert.equal(typeof plain, 'string');
  assert.ok(msLabels < 1000, 'a: ' + msLabels.toFixed(1) + ' ms');

  const unit = 'Error: x-api-key: ' + KEY + ' ';
  let blob = '';
  while (blob.length < mb) blob += unit;
  blob = blob.slice(0, mb);
  assert.equal(blob.length, mb);
  t = performance.now();
  const masked = LOG.redact(blob);
  const msKey = performance.now() - t;
  assert.ok(msKey < 1000, 'x-api-key ' + msKey.toFixed(1) + ' ms');
  assert.ok(!masked.includes(KEY));
  console.log('[r8 timing] a: ' + msLabels.toFixed(1) + ' ms; Error: x-api-key: ' + msKey.toFixed(1) + ' ms');
});
