'use strict';
// R4 (strict, per reviewer): ANY negator or look-only word anywhere in the request (outside quoted / after-colon message content) refuses sending. False refusal OK, false send not.
// R4: fail closed. Any negation in the same clause as (or answering) the send verb must refuse sending.
const test = require('node:test'); const assert = require('node:assert');
const SV = require('../src/agent/send-verify.js');
const REFUSE = ["Đừng có mà gửi cho An","Không cần gửi, xem thôi","Gửi? Không, chỉ xem thôi","No sending, just look","Đọc tin của An, tuyệt nhiên chẳng gửi gì","Xem ô soạn tin, cấm gửi","Không phải gửi đâu, xem thôi","Please refrain from sending to An","Read it, no need to send","不用发给An，看看就行","禁止发送，只看","khỏi gửi","hold off on sending","xyzzy plugh","Nhắn An là không gửi báo cáo được","Xem ô soạn tin có chữ gì không gửi tin cho An luôn","Gửi tin cho An rồi xem thôi"];
const SEND = ["Xem ô soạn tin rồi gửi luôn cho An","看看消息输入框，然后发出去","Gửi tin cho An: đừng quên họp","Nhắn An \"không gửi báo cáo được\"","Send it to An now","Send An: \"don't forget the meeting\""];
for (const q of REFUSE) test('refuse send: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), false));
for (const q of SEND) test('real send allowed: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), true));
