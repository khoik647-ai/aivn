'use strict';
// R3: negated send phrases must never become a real send request; they must be look-only (all sends refused).
const test = require('node:test'); const assert = require('node:assert');
const SV = require('../src/agent/send-verify.js');
const NEG = ["Chỉ xem ô soạn tin, đừng gửi","Nhìn ô soạn tin đang có chữ gì? Chỉ nhìn, đừng gửi.","Xem ô soạn tin nhưng không được gửi","Đọc tin nhắn của An, không gửi gì cả","Xem ô soạn tin có chữ gì, đừng bấm gửi","Kiểm tra bản nháp, chưa gửi nhé","Xem ô soạn tin, ko gửi","看看消息输入框，别发","看看输入框里写了什么，不要发送","看看草稿，先别发出去","Look at the compose box, don't send","Just read the draft, do not send it","Check the message box but never press send","Read the draft, without sending"];
const SEND = ["Xem ô soạn tin rồi gửi luôn cho An","Đọc ô soạn tin rồi bấm nút gửi","Xem ô soạn tin. Gửi.","看看消息输入框，然后发出去","Look at the compose box then send it to An"];
for (const q of NEG) test('negated send stays look-only: ' + q, () => { assert.strictEqual(!!SV.msgSend(q), false); assert.strictEqual(!!SV.lookOnly(q), true); assert.strictEqual(SV.allowsSend(q), false); });
for (const q of SEND) test('real send is not look-only: ' + q, () => { assert.strictEqual(!!SV.lookOnly(q), false); assert.strictEqual(SV.allowsSend(q), true); assert.strictEqual(SV.msgSend('看看消息输入框，然后发出去'), true); });
// Không phân loại được, hoặc phủ định lạ: không phải lệnh gửi rõ → từ chối mọi thao tác gửi.
const CLOSED = ['khỏi gửi', 'thôi đừng có gửi', 'hold off on sending', 'xyzzy plugh'];
for (const q of CLOSED) test('fail closed, send refused: ' + q, () => {
  assert.strictEqual(SV.allowsSend(q), false, q);
  assert.strictEqual(SV.msgSend(q), false, q);
  for (const k of ['enter', 'ctrl+enter', 'alt+s']) assert.strictEqual(SV.allowsSend(q), false, k + ' ' + q);
});
test('fail closed is the desktop send gate', () => {
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  assert.match(src, /!SV\.allowsSend\(/);
});
