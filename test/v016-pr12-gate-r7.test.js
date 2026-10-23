'use strict';
// Cổng vòng 7 của PR #12. Ca mới, thêm vào; không sửa ca cổng cũ. Không thêm todo.
// Mọi khoá giả được ghép lúc chạy. Không có chuỗi trông như khoá thật trong tệp.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/plugins');
const LOG = require('../src/logger');

const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BOTH = LOWER + UPPER;

function letters(n, alphabet) {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[(i * 5 + 1) % alphabet.length];
  return s;
}
function mixKey() {
  let s = '';
  for (let i = 0; i < 32; i++) s += AL[(i * 7 + 3) % AL.length];
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/\d/.test(s)) throw new Error('mix');
  return s;
}
function hexChars(n) {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < n; i++) s += h[i % 16];
  return s;
}

const KEY = mixKey();
const AI = 'AI' + 'za';
const RK_LIVE = 'rk' + '_' + 'live' + '_';
const RK_TEST = 'rk' + '_' + 'test' + '_';
const SK_LIVE = 'sk' + '_' + 'live' + '_';
const WH = 'wh' + 'sec' + '_';
const TG_MARK = ':' + 'A' + 'A';

function aiza(n) {
  const v = AI + letters(n, BOTH);
  if (/\d/.test(v) || v.length !== AI.length + n) throw new Error('aiza');
  return v;
}
function telegram(digits) {
  const v = String(digits) + TG_MARK + letters(33, UPPER);
  if (/[a-z]/.test(v)) throw new Error('tg');
  return v;
}
function tail(prefix, n) {
  const v = prefix + letters(n, LOWER);
  if (/[A-Z]/.test(v) || /\d/.test(v)) throw new Error('tail');
  return v;
}

const AIZA = aiza(35);
const TG8 = telegram('12345678');
const TG9 = telegram('123456789');
const TG10 = telegram('1234567890');
const RK = tail(RK_LIVE, 16);
const RKT = tail(RK_TEST, 16);
const RK_LONG = tail(RK_LIVE, 24);
const SKL = tail(SK_LIVE, 16);
const WHSEC = tail(WH, 24);
const WH_LONG = tail(WH, 30);

function blobs(value) {
  const out = [];
  const red = LOG.redact(value);
  out.push(typeof red === 'string' ? red : JSON.stringify(red));
  if (typeof value === 'string') out.push(P.maskKnownSecrets(value));
  else out.push(LOG.redact(JSON.stringify(value)), P.maskKnownSecrets(JSON.stringify(value)));
  return out;
}
function assertGone(label, value, secrets) {
  for (const blob of blobs(value)) {
    for (const secret of secrets) {
      assert.ok(secret && !blob.includes(secret), 'LEAK ' + label);
    }
  }
}
function assertKept(label, value, bits) {
  for (const blob of blobs(value)) {
    for (const bit of bits) assert.ok(blob.includes(bit), 'FP bị che ' + label + ' ' + bit.slice(0, 40));
  }
}

test('[r7 M1] nhãn không bí mật đứng trước không nuốt header', () => {
  const lines = [
    ['Error: x-api-key: ' + KEY, 'Error:'],
    ['WARN: password: ' + KEY, 'WARN:'],
    ['ERROR: Authorization: Bearer ' + KEY, 'ERROR:'],
    ['info: token: ' + KEY, 'info:'],
    ['failed: api_key: ' + KEY, 'failed:'],
    ['ERROR: Authorization: token ' + KEY, 'ERROR:'],
    ['Error: X-Api-Key: ' + KEY + ' tail', 'Error:'],
  ];
  for (const [line, keep] of lines) {
    assertGone(keep, line, [KEY]);
    const r = LOG.redact(line);
    assert.ok(r.includes(keep), 'mất nhãn ' + keep);
    assert.ok(r.includes('••••'));
  }
});

test('[r7 M2] header trong nháy đôi và nháy đơn', () => {
  const lines = [
    '-H "Authorization: token ' + KEY + '"',
    '-H "X-Api-Key: ' + KEY + '"',
    "-H 'Authorization: token " + KEY + "'",
    "-H 'X-Api-Key: " + KEY + "'",
    "--header 'Cookie: session=" + KEY + "'",
    '--header "Cookie: session=' + KEY + '"',
  ];
  for (const line of lines) {
    assertGone('header', line, [KEY]);
    const r = LOG.redact(line);
    assert.ok(r.includes('••••'));
    assert.ok(r.includes('-H') || r.includes('--header'));
  }
});

test('[r7 M3] tiền tố đứng một mình và sau tên không bí mật', () => {
  const keys = [AIZA, TG8, TG9, TG10, RK, RKT, RK_LONG, SKL, WHSEC, WH_LONG];
  for (const key of keys) {
    assertGone('tự do', 'note ' + key + ' tail', [key]);
    assertGone('Error', 'Error: ' + key, [key]);
    assertGone('NOTE', 'NOTE=' + key, [key]);
    assertGone('label', 'label: ' + key, [key]);
    assertGone('failed', 'failed: ' + key, [key]);
    assertGone('query', 'https://h.example/cb?q=' + key, [key]);
    assertGone('argv', ['qa-bin', '--q', key], [key]);
    assertGone('args', { command: 'qa-bin', args: [key] }, [key]);
    const free = LOG.redact('note ' + key + ' tail');
    assert.ok(free.includes('note ') && free.includes(' tail'));
    assert.ok(free.includes('••••'));
  }
});

test('[r7 M3] độ dài lệch tiền tố không bị coi là khoá', () => {
  const keep = [
    aiza(34),
    aiza(36),
    '1234567' + TG_MARK + letters(33, UPPER),
    '12345678901' + TG_MARK + letters(33, UPPER),
    tail(RK_LIVE, 15),
    tail(RK_TEST, 15),
    tail(WH, 23),
  ];
  for (const token of keep) {
    const line = 'note ' + token + ' tail';
    assertKept(token.slice(0, 6), line, [token, 'note ', ' tail']);
  }
});

test('[r7] FP AUTHOR KEYBOARD_LAYOUT MAX_TOKENS auth none MODEL gguf sha digest uuid path nhãn', () => {
  const sha = hexChars(40);
  const digest = hexChars(64);
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  const line = 'AUTHOR=Khoi KEYBOARD_LAYOUT=us MAX_TOKENS=4096 --auth none MODEL=Qwen.gguf ' + sha + ' ghcr.io/a/b@sha256:' + digest + ' file.gguf ' + uuid + ' /home/a/m.gguf';
  assertKept('dòng', line, ['AUTHOR=Khoi', 'KEYBOARD_LAYOUT=us', '4096', '--auth none', 'Qwen.gguf', sha, 'sha256:' + digest, 'file.gguf', uuid, '/home/a/m.gguf']);
  assertKept('Error', 'Error: file not found', ['Error: file not found']);
  assertKept('ctype', 'Content-Type: application/json', ['Content-Type: application/json']);
  assertKept('ctype nháy', '"Content-Type: application/json"', ['Content-Type: application/json']);
  assertKept('url', 'Error: http://example.com/a', ['http://example.com/a']);
});

test('[r7] chuỗi a:a:a không treo maskAssignments', () => {
  let s = 'note';
  for (let i = 0; i < 2000; i++) s += ':aa';
  const t0 = Date.now();
  const r = LOG.redact(s);
  assert.equal(typeof r, 'string');
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(r.startsWith('note'));
});
