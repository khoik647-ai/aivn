'use strict';
// Kiểm tra trimLoop trong src/agent/repeat.js: cắt bỏ phần câu trả lời bị lặp, giữ lại phần trước chỗ lặp.
const test = require('node:test'); const assert = require('node:assert');
const { trimLoop } = require('../src/agent/repeat');
const INTRO = 'Giá vàng SJC hôm nay được niêm yết ở mức cao. ';
const REP = 'Tôi sẽ kiểm tra lại giá vàng cho bạn ngay bây giờ. ';

test('trimLoop: câu lặp nhiều lần thì chỉ giữ một lần', () => {
  const r = trimLoop(INTRO + REP.repeat(5));
  assert.strictEqual(r.text, INTRO + REP.trim());
  assert.strictEqual(r.loop.kind, 'sentence');
});

test('trimLoop: câu trả lời ngắn không lặp thì giữ nguyên', () => {
  const r = trimLoop('Xin chào, tôi có thể giúp gì cho bạn?');
  assert.strictEqual(r.text, 'Xin chào, tôi có thể giúp gì cho bạn?');
  assert.strictEqual(r.loop, null);
});

test('trimLoop: đoạn dài nhưng các câu khác nhau thì không bị cắt', () => {
  const s = 'Hà Nội là thủ đô của Việt Nam. Thành phố có nhiều hồ đẹp. Món phở rất nổi tiếng. Mùa thu ở đây mát mẻ và dễ chịu. Người dân thân thiện.';
  assert.strictEqual(trimLoop(s).loop, null);
});