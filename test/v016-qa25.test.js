'use strict';
// QA máy thật beta.2.5 (22/10, DESKTOP-2G546S3): B107–B117
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const SV = require('../src/agent/send-verify');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('B113: “báo cho mình / cho tôi / tell me / report back / 告诉我” = trả lời trong AIVN, không hỏi “Gửi cho ai?”', () => {
  const self = [
    'mở Chrome tìm "giá vàng SJC hôm nay", mở kết quả đầu tiên rồi báo cho mình giá và đường dẫn trang', // đúng câu kịch bản A trong ghi chú phát hành
    'mở Chrome tìm "thời tiết TP.HCM hôm nay", mở kết quả đầu tiên rồi báo cho mình nhiệt độ và đường dẫn trang',
    'tìm giá xăng hôm nay rồi báo cho tôi biết giá', 'tìm giá vàng rồi cho mình biết giá', 'mở trang thoitiet.vn rồi báo lại cho mình nhé',
    'open Chrome, search the weather in Hanoi and tell me the temperature and the page link', 'search the gold price and report back with the link',
    'look up the exchange rate and let me know', '打开 Chrome 搜索今天的天气，然后告诉我温度和网址',
  ];
  for (const q of self) { assert.strictEqual(SV.msgSend(q), false, q); assert.strictEqual(SV.missingRecipient(q), false, q); }
  // vẫn là gửi tin khi nêu ứng dụng nhắn tin / người nhận
  assert.ok(SV.missingRecipient('báo cho mình giá vàng qua Zalo'));
  assert.ok(SV.missingRecipient('nhắn giúp mình là mai 8h họp nhé'));
  assert.ok(SV.msgSend('tìm giá vàng rồi nhắn cho Lan trên Zalo')); assert.strictEqual(SV.recipientOf('tìm giá vàng rồi nhắn cho Lan trên Zalo'), 'Lan');
  assert.ok(SV.msgSend('báo cho Lan biết mai nghỉ'));
  // desktop-agent/agent dùng msgSend (đã bỏ phần báo-cho-mình), không dùng MSG_SEND thô
  assert.doesNotMatch(src('src/desktop-agent.js'), /SV\.MSG_SEND\.test/); assert.doesNotMatch(src('src/agent/agent.js'), /MSG_SEND\.test/);
});

test('B110: gì/ai/không gửi gì không bao giờ là tên người nhận; mở chat X lấy đúng X', () => {
  const cases = [
    ['mở Zalo rồi mở cuộc trò chuyện Cloud của tôi, không gửi gì', 'Cloud của tôi'],
    ['mở Zalo và mở chat Cloud của tôi', 'Cloud của tôi'],
    ['mở Zalo và mở chat Cloud của tôi, đừng gửi gì cả', 'Cloud của tôi'],
    ["open Zalo and open the chat with Cloud của tôi, don't send anything", 'Cloud của tôi'],
    ['打开 Zalo 打开和 Lan 的聊天，不要发送任何消息', 'Lan'],
    ['mở cuộc trò chuyện với Trần Quỳnh Anh trên Zalo rồi nhắn "hi"', 'Trần Quỳnh Anh'],
    ['nhắn Trần Quỳnh Anh là mai họp', 'Trần Quỳnh Anh'],
    ['gửi tin "hi" cho Lan trên Zalo', 'Lan'],
  ];
  for (const [q, r] of cases) assert.strictEqual(SV.recipientOf(q), r, q);
  for (const q of ['gửi gì cho ai đó', 'nhắn gì', 'mở chat hiện tại rồi gửi "x"', 'không gửi gì', 'đừng nhắn ai cả', "don't send anything"]) assert.strictEqual(SV.recipientOf(q), null, q);
});
