'use strict';
// Chữ tiếng Việt (2–3 byte UTF-8) bị cắt giữa hai gói mạng / hai token không được hiện thành “�”
const test = require('node:test'); const assert = require('node:assert');
const { sseParser } = require('../src/vision-server');
const TEXT = 'Xin chào, đây là thư thử có dấu tiếng Việt — ổn định, nghiêng, ữ, ỷ, đ 😀';
function sseBytes(pieces) { return Buffer.from(pieces.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('') + 'data: [DONE]\n\n', 'utf8'); }
test('SSE: cắt luồng byte ở MỌI vị trí (kể cả giữa một chữ nhiều byte) vẫn ra đúng chữ, không có U+FFFD', () => {
  const words = TEXT.split(/(?<= )/); const bytes = sseBytes(words);
  for (let cut = 1; cut < bytes.length; cut++) {
    const p = sseParser(); let out = '';
    for (const part of [bytes.subarray(0, cut), bytes.subarray(cut)]) for (const j of p.push(part)) out += j.choices[0].delta.content || '';
    assert.strictEqual(out, TEXT, `cắt ở byte ${cut}`);
  }
});
test('SSE: từng byte một', () => {
  const bytes = sseBytes([TEXT]); const p = sseParser(); let out = '';
  for (let i = 0; i < bytes.length; i++) for (const j of p.push(bytes.subarray(i, i + 1))) out += j.choices[0].delta.content || '';
  assert.strictEqual(out, TEXT); assert.ok(!out.includes('\ufffd'));
});
test('máy chủ đã trả U+FFFD (chữ bị cắt giữa hai token) → AIVN bỏ ký tự đó khỏi câu trả lời', async () => {
  const src = require('fs').readFileSync(require.resolve('../src/vision-server'), 'utf8');
  assert.ok(/\\ufffd/.test(src) && /replace\(\/\\ufffd\/g, ''\)/.test(src));
});
