'use strict';
// B219 review: câu GỬI thật không được biến thành câu chỉ nhìn. Nguồn: probe đối kháng của review PR #91.
// Cổng Ctrl+Enter (send-gate) chỉ coi là gửi khi msgSend đúng; QA không được cho qua một câu nhìn mà tin đã bị gửi.
const test = require('node:test'); const assert = require('node:assert');
const SV = require('../src/agent/send-verify');
const Q = require('../src/qa-runner');
const SG = require('../src/agent/send-gate');

const qa = (q, steps, draft = SV.DRAFT_ONLY.test(q)) => Q.statusOf({ outcome: 'done', text: 'Done.', steps }, { task: q, draft }).status;
const typeGate = (q, text, { submit = false, searchField = false } = {}) => {
  const state = {};
  const g = SV.chatGate({ query: q, text, submit, searchField, proc: 'Zalo', title: 'Zalo', state, header: ['Lan'] });
  return { g, askWho: state.askWho };
};

test('B219 adv: gửi thật vẫn là gửi trên câu GỐC — Ctrl+Enter bị chặn, QA đòi bằng chứng (vi/en/zh)', () => {
  const sends = [
    'Gửi nội dung trong ô soạn tin cho An',
    'Bấm gửi trong ô soạn tin',
    'Gửi tin đang có trong ô soạn tin đi',
    'soạn tin trong ô soạn tin rồi gửi',
    'gõ "hi" vào ô soạn tin rồi bấm gửi cho An',
    'gõ "hi" vào ô soạn tin rồi bấm gửi',
    'gõ "hi" vào ô soạn tin rồi nhấn Enter',
    'Xem ô soạn tin có chữ gì rồi gửi nó cho An',
    'Nhập "hi" vào ô soạn tin và gửi cho An nhé?',
    'gửi tin cho An',
    'send a message to An',
    '给An发消息',
  ];
  for (const q of sends) {
    assert.strictEqual(SV.lookOnly(q), false, q);
    assert.strictEqual(SV.msgSend(q), true, q);
    assert.strictEqual(qa(q, [{ name: 'screen_look', status: 'ok' }]), 'failed', 'thiếu bằng chứng đã gửi: ' + q);
    assert.strictEqual(qa(q, [{ verify: { sent: true } }]), 'done', q);
    const st = { chatOpen: false, recipient: SV.recipientOf(q), messaging: SV.msgSend(q), searchTarget: false, lastTyped: '', targetName: '', inComposerRow: false };
    assert.strictEqual(SG.classify('hotkey', { keys: 'ctrl+enter' }, st).send, true, 'Ctrl+Enter: ' + q);
  }
  // phủ định một kênh nhưng vẫn có lệnh gửi khác (“đừng gửi email, nhắn tin…”) — vẫn là gửi.
  // “đừng gửi” cũng bật cờ chỉ-soạn của QA, nên tin đã gửi bị chấm thất bại (không được coi là xong).
  for (const q of ['đừng gửi email, nhắn tin cho An trong ô soạn tin', "don't send an email; text An via the message box"]) {
    assert.strictEqual(SV.lookOnly(q), false, q);
    assert.strictEqual(SV.msgSend(q), true, q);
    assert.strictEqual(qa(q, [{ verify: { sent: true } }]), 'failed', q);
    const st = { chatOpen: false, recipient: SV.recipientOf(q), messaging: true, lastTyped: '', targetName: '' };
    assert.strictEqual(SG.classify('hotkey', { keys: 'ctrl+enter' }, st).send, true, q);
  }
  // “nội dung trong ô soạn tin” là tên ô, không nuốt “cho An”
  assert.strictEqual(SV.recipientOf('Gửi nội dung trong ô soạn tin cho An'), 'An');
  assert.strictEqual(SV.missingRecipient('Gửi nội dung trong ô soạn tin cho An'), false);
  for (const q of ['Could you type hi in the message box and send it to An?', 'Look at the message box, then hit send', 'Send what is in the message box to An', 'Press send in the message box', '看看消息输入框，然后发送给An', '在消息输入框输入你好然后发送', 'xem message box rồi send cho An', 'look at the message box and gửi cho An']) {
    assert.strictEqual(SV.lookOnly(q), false, 'không phải câu chỉ nhìn: ' + q);
    assert.strictEqual(qa(q, [{ name: 'screen_look', status: 'ok' }]), 'failed', q);
  }
  // “发给” không khớp MSG_SEND/SEND_TASK từ trước (chữ 给 chen giữa) — không được coi là câu chỉ nhìn
  assert.strictEqual(SV.lookOnly('把消息输入框里的内容发给An'), false);
  assert.strictEqual(SV.msgSend('把消息输入框里的内容发给An'), false);
});

test('B219 adv: dấu hỏi không biến lệnh gửi thành câu chỉ nhìn; câu chỉ nhìn thì không gõ vào ô soạn (vi/en/zh)', () => {
  const looks = [
    ['vi', 'Is "hi" in the message box?', 'hi'],
    ['vi', 'Nhìn ô soạn tin có chữ "hi" không?', 'hi'],
    ['zh', '看看消息输入框里有没有"你好"', '你好'],
    ['vi', 'Nhìn ô soạn tin đang có chữ gì? Chỉ nhìn, đừng gửi.', 'ô soạn trống'],
    ['en', 'Look at the message box and tell me if it is empty (don\'t send).', 'empty'],
    ['zh', '看看消息输入框里有什么？只看，不要发送。', '你好'],
    ['en', 'Is the message box empty? Do not send a message.', 'hi'],
    ['en', "Check the message box but don't send a message to anyone", 'hi'],
    ['vi', 'Nhìn ô soạn tin nhắn có trống không, đừng nhắn gì', 'hi'],
    ['zh', '看看消息输入框里有什么，不要发消息', '你好'],
    ['vi', 'Kiểm tra ô nhập tin nhắn có trống không', 'hi'],
    ['vi', 'Xem khung chat có tin nhắn mới không', 'hi'],
    ['vi', 'Đọc tin nhắn cuối trong khung soạn thảo', 'hi'],
    ['en', 'Check the chat input, is it empty?', 'hi'],
    ['en', 'what does the textbox say', 'hi'],
    ['en', 'Look at the message field and tell me what is typed', 'hi'],
  ];
  for (const [, q, sample] of looks) {
    assert.strictEqual(SV.lookOnly(q), true, q);
    assert.strictEqual(SV.msgSend(q), false, q);
    assert.strictEqual(SV.missingRecipient(q), false, q);
    const typed = typeGate(q, sample);
    assert.match(typed.g, /KHÔNG gõ/, q);
    assert.strictEqual(typed.askWho, undefined, q);
    const search = typeGate(q, 'Lan', { searchField: true });
    assert.strictEqual(search.g, null, 'ô tìm kiếm đã xác nhận vẫn gõ được: ' + q);
    assert.strictEqual(search.askWho, undefined, q);
    assert.strictEqual(qa(q, [{ name: 'screen_look', status: 'ok' }]), 'done', q);
    assert.strictEqual(qa(q, [{ name: 'screen_look', status: 'ok', verify: { sent: true } }]), 'failed', 'đã gửi dù chỉ được nhìn: ' + q);
  }
  // chữ trong ngoặc kép của câu hỏi vẫn “có trong yêu cầu” (B108) — cổng nhìn phải chặn TRƯỚC, không để Enter gửi
  assert.strictEqual(SV.textFromRequest('Is "hi" in the message box?', 'hi'), true);
  assert.strictEqual(SV.textFromRequest('Nhìn ô soạn tin có chữ "hi" không?', 'hi'), true);
});
