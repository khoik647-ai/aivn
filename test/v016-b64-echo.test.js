'use strict';
// b64 chập chờn (22/10, hồi quy 43d626e): sau khi bấm nhãn “Tìm kiếm trên Messenger” rồi gõ tên, AIVN báo nhầm “NHIỀU người cùng tên”.
// Nguyên nhân: trước khi gõ, OCR có lúc đọc chữ gợi ý của ô là “[Tim kiếm trên Messenger” (viền ô thành “[”, mất dấu) → không nhận là chữ gợi ý →
// chữ vừa gõ ở đúng chỗ đó không được coi là chữ trong ô; nếu lúc chụp con trỏ đang tắt (OCR không thấy “|”) thì chữ trong ô khớp đúng tên → 2 “kết quả”.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const SV = require('../src/agent/send-verify');

test('chữ gợi ý ô tìm kiếm có nhiễu OCR vẫn nhận ra (chuỗi thật của lần chạy lỗi)', () => {
  for (const n of ['[Tim kiếm trên Messenger', 'Tìm kiếm trên Messenger', 'Tim kiếm trên Messenger', 'Q Tìm kiếm', '| Search', '© Search Messenger', 'Nhập tin nhắn...', '搜索'])
    assert.ok(SV.placeholderLike(n), n);
  for (const n of ['Trần Quỳnh Anh', 'Timothy', 'Tim Cook', 'Q My Documents', 'Nhóm Lớp K27', 'Lê Quỳnh Anh']) assert.ok(!SV.placeholderLike(n), n);
});
test('desktop-agent dùng placeholderLike cho cả nhận “chữ trong ô” (isEcho) lẫn inBox', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  assert.match(s, /&& !SV\.placeholderLike\(p\.name\)\);/); assert.match(s, /\|\| SV\.placeholderLike\(p\.name\)\)/);
});
