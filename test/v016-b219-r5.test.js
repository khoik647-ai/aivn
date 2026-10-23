'use strict';
// R5: a retraction inside the after-colon "message content" must still refuse sending.
const test = require('node:test'); const assert = require('node:assert');
const SV = require('../src/agent/send-verify.js');
const REFUSE = ['Gửi cho An: hẹn mai. À thôi, đừng gửi','Send An: see you. Actually never mind, don\'t send','发给An：明天见。算了别发','Nhắn An: ok nhé, thôi khỏi gửi','Send An: hi — wait, do not send it'];
const SEND = ['Gửi tin cho An: đừng quên họp','Nhắn An: hẹn mai','Send An: "don\'t send the report yet"','发给An：别忘了开会','Gửi cho An: chỉ xem thôi nhé'];
for (const q of REFUSE) test('retraction refuses: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), false));
for (const q of SEND) test('content negation still sends: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), true));
