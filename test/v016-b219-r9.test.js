'use strict';
// R9: retractions after the colon, apostrophe folds, joiner-as-space, and the 16KiB fail-closed cap.
const test = require('node:test'); const assert = require('node:assert');
const SV = require('../src/agent/send-verify.js');
const REFUSE = [
  'Gửi cho An: hẹn mai, chưa gửi',
  'Gửi cho An: hẹn mai. Khoan gửi',
  'Gửi cho An: hẹn mai, Chớ gửi',
  'Send An: see you. Hold off sending',
  'Send An: see you. Refrain from sending',
  'Gui cho An: hen mai, chua gui',
  'Gui cho An: hen mai, khoan gui',
];
const ALLOW = [
  'Gửi cho An: hẹn mai, cho gui',
  'Gui cho An: hen mai, cho gui',
  'Gửi cho An: đừng quên họp',
  'Gửi cho An: chỉ xem thôi nhé',
];
for (const q of REFUSE) test('R9-1 tail retraction refuses: ' + q, () => assert.strictEqual(SV.allowsSend(q), false));
for (const q of ALLOW) test('R9-1 tail content still sends: ' + q, () => assert.strictEqual(SV.allowsSend(q), true));
test('R9-2 apostrophe variants block dont send', () => {
  for (const a of ['\u02bc', '\uff07', '`', '\u00b4', '\u2032']) {
    assert.strictEqual(SV.allowsSend(`Send An hi, don${a}t send`), false, a);
    assert.strictEqual(SV.allowsSend(`Send An: see you, don${a}t send`), false, a);
  }
});
test('R9-3 word joiner between negator and verb blocks', () => {
  assert.strictEqual(SV.allowsSend('Gửi cho An, đừng\u2060gửi'), false);
  assert.strictEqual(SV.allowsSend('Gửi cho An, đừng\ufeffgửi'), false);
  assert.strictEqual(SV.allowsSend('Gửi cho An, đừng\u200dgửi'), false);
  assert.strictEqual(SV.allowsSend('Gửi cho An, đừ\u200bng gửi'), false);
});
test('R9-4 over-length query is fail-closed and under 200ms', () => {
  const q = 'x'.repeat(1_000_000);
  const t0 = process.hrtime.bigint();
  assert.strictEqual(SV.allowsSend(q), false);
  assert.strictEqual(SV.lookOnly(q), false);
  assert.strictEqual(SV.hasSendVerb(q), false);
  assert.strictEqual(SV.msgSend(q), false);
  assert.strictEqual(SV.missingRecipient(q), true);
  assert.strictEqual(SV.intentText(q), '');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 200, `${ms.toFixed(1)}ms`);
});
