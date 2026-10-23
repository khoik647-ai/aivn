'use strict';
// R6: a bare cancel clause ending the after-colon content (no send verb) still refuses.
const test = require('node:test'); const assert = require('node:assert');
const SV = require('../src/agent/send-verify.js');
const REFUSE = ['Gửi cho An: hẹn mai. Mà thôi','Send An: ok. Cancel.','Nhắn An: hẹn mai, khỏi','发给An：好的。不了','Send An: see you. Never mind.','Gửi An: ok. Thôi khỏi.','发给An：明天见。算了'];
const SEND = ['Gửi cho An: không sao đâu','Send An: no problem','Nhắn An: không đi được','发给An：不去了','Gửi cho An: ăn thôi','Nhắn An: xong rồi thôi về'];
for (const q of REFUSE) test('trailing cancel refuses: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), false));
for (const q of SEND) test('content still sends: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), true));
