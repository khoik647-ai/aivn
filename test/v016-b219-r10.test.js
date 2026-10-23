'use strict';
// R10: zero-width inside a word must not split a negator; fillers cần/nên/phải govern a tail send;
// Khoan đã / Stop / Thôi bỏ đi / "don t" retract; over-length does not skip the typing check.
const test = require('node:test'); const assert = require('node:assert');
const SV = require('../src/agent/send-verify.js');

const SPLIT = [
  'Gửi cho An, đừ\u200dng gửi',
  'Gửi cho An, đừ\u200cng gửi',
  'Gửi cho An, đừ\u2060ng gửi',
  'Gửi cho An, đừ\ufeffng gửi',
  'Gửi cho An, đừ\u200bng gửi',
  'Gửi cho An, khô\u2060ng gửi',
  "Send An hi, do\u2060n't send",
  "Send An hi, don\ufeff't send",
  'Gửi cho An, đừng\u2060gửi',
  'Gửi cho An, đừng\u200dgửi',
  'Gửi cho An, đừng\ufeffgửi',
];
for (const q of SPLIT) test('R10-1 zero-width does not hide a negator: ' + q, () => assert.strictEqual(SV.allowsSend(q), false));

const TAIL_REFUSE = [
  'Gửi cho An: hẹn mai, Không cần gửi',
  'Gửi cho An: hẹn mai, Chưa cần gửi',
  'Gửi cho An: hẹn mai, Không nên gửi',
  'Gửi cho An: hẹn mai, Không cần phải gửi',
  'Gui cho An: hen mai, Khong can gui',
  'Gửi cho An: hẹn mai. Khoan đã',
  'Send An: see you. Stop.',
  'Gửi cho An: hẹn mai. Thôi bỏ đi',
  'Send An: see you, don t send',
  'Gửi cho An: hẹn mai, don t send',
];
const TAIL_ALLOW = [
  'Gửi cho An: hẹn mai, cho gửi',
  'Gui cho An: hen mai, cho gui',
  'Gửi cho An: đừng quên họp',
  'Gửi cho An: ăn thôi',
  'Gửi cho An: không sao đâu',
  'Send An: no problem',
];
for (const q of TAIL_REFUSE) test('R10-2 tail retraction refuses: ' + q, () => assert.strictEqual(SV.allowsSend(q), false));
for (const q of TAIL_ALLOW) test('R10-2 tail content still sends: ' + q, () => assert.strictEqual(SV.allowsSend(q), true));

test('R10-3 over-length fails closed for typing as well as sending', () => {
  const q = 'x'.repeat(1_000_000);
  const tx = 'hello';
  const t0 = process.hrtime.bigint();
  assert.strictEqual(SV.allowsSend(q), false);
  assert.strictEqual(SV.msgSend(q), false);
  assert.strictEqual(SV.textFromRequest(q, tx), false);
  // desktop-agent.js ~941: chỗ không phải chat dùng msgSend để bỏ qua textFromRequest.
  const chatS = false;
  const okS = chatS ? SV.textFromRequest(q, tx) : (SV.msgSend(q) || SV.textFromRequest(q, tx));
  assert.strictEqual(okS, false);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 200, `${ms.toFixed(1)}ms`);
  assert.strictEqual(SV.textFromRequest('Gửi cho An: xin chào bạn', 'xin chào bạn'), true);
});
