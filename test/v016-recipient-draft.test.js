'use strict';
// Khoảng trống tìm ra khi thử B101 (22/10): “soạn sẵn tin "X" cho Y” không đọc được người nhận (AIVN hỏi lại “Gửi cho ai?”).
// Việc CHỈ SOẠN cũng phải đọc đúng người nhận (vi/en/zh), không đoán bừa tên từ câu không có người nhận.
const test = require('node:test'); const assert = require('node:assert');
const SV = require('../src/agent/send-verify');

const CASES = [
  ['soạn sẵn tin "AIVN b101 hai" cho Cloud của tôi trên Zalo, chưa gửi', 'Cloud của tôi'],
  ['soạn sẵn tin "X a" cho Trần Văn Bình trên Zalo, chưa gửi', 'Trần Văn Bình'],
  ['soạn sẵn tin nhắn "AIVN b101 hai" cho Cloud của tôi trên Zalo, đừng gửi', 'Cloud của tôi'],
  ['soạn nháp giúp tin "hi" cho Lê Quỳnh Anh', 'Lê Quỳnh Anh'],
  ['soạn tin "hi" cho Lê Quỳnh Anh nhưng đừng gửi', 'Lê Quỳnh Anh'],
  ['viết sẵn tin cho Lê Quỳnh Anh: "mai họp"', 'Lê Quỳnh Anh'],
  ['soạn sẵn email cho thầy Nam tiêu đề "Họp"', 'thầy Nam'],
  ['soạn sẵn tin nhắn cho Cloud của tôi trên Zalo: "AIVN b101 hai", chưa gửi', 'Cloud của tôi'],
  ['draft a message "hi" to Tran Van Binh on Zalo but don\'t send', 'Tran Van Binh'],
  ['write a draft "hi" to Tran Van Binh', 'Tran Van Binh'],
  ['compose a message "hi" for My Documents, do not send', 'My Documents'],
  ['prepare a message to Tran Van Binh: "hi", do not send', 'Tran Van Binh'],
  ['起草一条给王老师的消息“明天开会”，先不要发送', '王老师'],
  ['给 Trần Văn Bình 起草一条消息“你好”，先不要发送', 'Trần Văn Bình'],
  ['帮我写一封给 My Documents 的消息“你好”', 'My Documents'],
  // không đổi: câu gửi bình thường
  ['gửi tin "AIVN test" cho Cloud của tôi trên Zalo', 'Cloud của tôi'],
  ['send "hi" to Lan on Messenger', 'Lan'],
];
const NONE = ['soạn sẵn tin "mai họp"', 'soạn sẵn văn bản báo cáo', 'write a report for me', 'compose a reply', 'draft the plan'];

test('việc chỉ soạn (vi/en/zh): đọc đúng người nhận', () => {
  for (const [q, want] of CASES) assert.strictEqual(SV.recipientOf(q), want, q);
});
test('không có người nhận → null (hỏi “Gửi cho ai?”), không đoán bừa', () => {
  for (const q of NONE) assert.strictEqual(SV.recipientOf(q), null, q);
});
test('lệnh chỉ soạn (mọi cách nói ở trên) là CHỈ SOẠN → B101 không tự gửi; một nguồn DRAFT_ONLY cho desktop-agent / agent / qa-runner', () => {
  for (const [q] of CASES.slice(0, 15)) assert.ok(SV.DRAFT_ONLY.test(q), 'phải là chỉ soạn: ' + q);
  for (const q of ['gửi tin "AIVN test" cho Cloud của tôi trên Zalo', 'send "hi" to Lan on Messenger', 'nhắn Lan là mai họp', '给王老师发消息“明天开会”']) assert.ok(!SV.DRAFT_ONLY.test(q), 'không phải chỉ soạn: ' + q);
  const fs = require('fs'), path = require('path'); const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(rd('src/desktop-agent.js'), /const DRAFT_SEND = SV\.DRAFT_ONLY;/); assert.match(rd('src/qa-runner.js'), /const DRAFT_RE = require\('\.\/agent\/send-verify'\)\.DRAFT_ONLY;/);
  assert.match(rd('src/agent/agent.js'), /const DRAFT_RE = require\('\.\/send-verify'\)\.DRAFT_ONLY;/);
});
