// 0.15.0: AIVN AGENT chỉ tự giới thiệu khi được hỏi rõ
const test = require('node:test');
const assert = require('node:assert');
const { stripIntro, sanitizeHistory, IDENTITY } = require('../src/agent/agent');
const INTRO = 'Xin chào! Mình là **AIVN AGENT**, trợ lý có sẵn trong AIVN, chạy ngay trên máy tính của bạn. Cha đỡ đầu của mình là anh Nguyễn Ngọc Khôi.\n\nMình có thể:\n- Trò chuyện\n- Dùng công cụ';
test('lời giới thiệu ở đầu câu trả lời bị bỏ khi người dùng không hỏi', () => {
  assert.strictEqual(stripIntro(INTRO + '\n\n2 + 2 = 4.', '2 cộng 2 bằng mấy?'), '2 + 2 = 4.');
  assert.strictEqual(stripIntro('Mình là AIVN AGENT.\n\nĐã mở Zalo.', 'mở zalo', { history: [{ role: 'user' }, { role: 'assistant' }] }), 'Đã mở Zalo.');
});
test('được hỏi "bạn là ai / làm được gì / ai tạo ra" thì giữ nguyên', () => {
  for (const q of ['Bạn là ai?', 'bạn làm được những gì', 'Ai tạo ra bạn vậy?']) assert.strictEqual(stripIntro(INTRO, q), INTRO);
});
test('lời chào đầu tiên được chào lại; chào lần sau chỉ một câu ngắn', () => {
  assert.strictEqual(stripIntro(INTRO, 'chào bạn'), INTRO);
  assert.strictEqual(stripIntro(INTRO, 'chào bạn', { history: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] }), 'Chào bạn! Bạn cần mình giúp gì?');
});
test('câu trả lời không có giới thiệu thì không đổi', () => {
  const t = 'Hà Nội là thủ đô của Việt Nam.\n\nMình có thể giải thích thêm.';
  assert.strictEqual(stripIntro(t, 'Thủ đô Việt Nam?'), t);
});
test('lịch sử: lời giới thiệu cũ bị bỏ để mô hình không bắt chước', () => {
  const r = sanitizeHistory([{ role: 'user', content: 'mở notepad' }, { role: 'assistant', content: INTRO + '\n\nĐã mở Notepad.' }, { role: 'user', content: 'cảm ơn' }]);
  assert.strictEqual(r.messages[1].content, 'Đã mở Notepad.');
});
test('lời nhắc hệ thống: chỉ giới thiệu khi được hỏi rõ, giữ cha đỡ đầu', () => {
  assert.match(IDENTITY, /CHỈ tự giới thiệu khi người dùng hỏi RÕ/);
  assert.match(IDENTITY, /KHÔNG chào hỏi, KHÔNG tự giới thiệu/);
  assert.match(IDENTITY, /Nguyễn Ngọc Khôi/);
});
