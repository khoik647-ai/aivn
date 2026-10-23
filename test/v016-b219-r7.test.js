'use strict';
// R7: an unclosed quote is not a quote; its tail must still be scanned (fail closed).
const test = require('node:test'); const assert = require('node:assert');
const SV = require('../src/agent/send-verify.js');
const REFUSE = ['Gửi cho An "hẹn mai, đừng gửi','Gửi cho An “hẹn mai, đừng gửi','Gửi cho An 「hẹn mai，别发','发给An“明天见，别发','Send An "see you, don\'t send','Gửi cho An « hẹn mai, thôi khỏi'];
const SEND = ['Gửi cho An "hẹn mai, đừng quên"','发给An「别忘了开会」','Send An "don\'t forget"'];
for (const q of REFUSE) test('unclosed quote refuses: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), false));
for (const q of SEND) test('closed quote still sends: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), true));
