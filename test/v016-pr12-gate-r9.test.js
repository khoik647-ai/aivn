'use strict';
// Cổng vòng 9 của PR #12. Ca mới, thêm vào; không sửa ca cổng cũ. Không thêm todo.
// Khoá giả ghép lúc chạy. Không có chuỗi trông như khoá thật trong tệp.
// Chín nhãn đứng trước đẩy phần đuôi vào maskLabelTail (độ sâu >= 8).
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

function leading(n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) parts.push('Error');
    else if (i === 1) parts.push('WARN');
    else parts.push(String.fromCharCode(97 + ((i - 2) % 26)));
  }
  return parts.map(p => p + ':').join(' ') + ' ';
}

function surfaces(line) {
  const err = new Error(line);
  return [
    ['LOG.redact', LOG.redact(line)],
    ['maskKnownSecrets', P.maskKnownSecrets(line)],
    ['Error.message', LOG.redact(err.message)],
  ];
}

function assertMasked(label, line, key, keep) {
  for (const [via, out] of surfaces(line)) {
    assert.equal(typeof out, 'string', via + ' ' + label);
    assert.ok(!out.includes(key), 'LEAK ' + via + ' ' + label);
    assert.ok(out.includes('••••'), 'không che ' + via + ' ' + label);
    for (const bit of keep) assert.ok(out.includes(bit), 'mất ' + bit + ' ' + via + ' ' + label);
  }
}

test('[r9] từ nhãn thứ 9, Authorization: token và Authorization: Basic bị che', () => {
  for (const n of [9, 12, 20]) {
    for (const key of [KEY, HEX]) {
      assertMasked('L' + n + ' token', leading(n) + 'Authorization: token ' + key, key, ['Error:', 'Authorization:']);
      assertMasked('L' + n + ' Basic', leading(n) + 'Authorization: Basic ' + key, key, ['Error:', 'Authorization:']);
    }
  }
});

test('[r9] từ nhãn thứ 9, password cách dấu hai chấm bị che', () => {
  for (const n of [9, 12, 20]) {
    for (const key of [KEY, HEX]) {
      assertMasked('L' + n + ' space', leading(n) + 'password : ' + key, key, ['Error:', 'password']);
    }
  }
});

test('[r9] từ nhãn thứ 9, password dính hex 40 bị che', () => {
  for (const n of [9, 12, 20]) {
    assertMasked('L' + n + ' hex', leading(n) + 'password:' + HEX, HEX, ['Error:', 'password:']);
  }
});

test('[r9] redact ném lỗi thì trả chỗ giữ đã che', () => {
  const raw = 'prefix-' + KEY + '-suffix';
  const orig = P.maskKnownSecrets;
  P.maskKnownSecrets = () => { throw new Error('boom'); };
  try {
    const out = LOG.redact(raw);
    assert.equal(out, '••••');
    assert.ok(!out.includes(KEY));
    assert.ok(!out.includes('prefix-'));
  } finally {
    P.maskKnownSecrets = orig;
  }
});

test('[r9] 1 MB a:a:a xong dưới 1.5 s', () => {
  const mb = 1024 * 1024;
  const unit = 'a:a:a';
  const blob = unit.repeat(Math.ceil(mb / unit.length)).slice(0, mb);
  assert.equal(blob.length, mb);
  const t = performance.now();
  const out = LOG.redact(blob);
  const ms = performance.now() - t;
  assert.equal(typeof out, 'string');
  assert.ok(out.includes('a:a:a'), 'mất a:a:a');
  assert.ok(ms < 1500, 'a:a:a ' + ms.toFixed(1) + ' ms');
  console.log('[r9 timing] a:a:a ' + ms.toFixed(1) + ' ms');
});
