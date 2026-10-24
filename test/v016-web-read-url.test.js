'use strict';
// Kiểm tra ba hàm nhỏ về đường dẫn trong src/agent/web-read.js (AGENT tự đọc trang trên trình duyệt).
const test = require('node:test'); const assert = require('node:assert');
const { isSearchUrl, isBlankUrl, googleUrl } = require('../src/agent/web-read');

test('isSearchUrl: trang kết quả Google là trang tìm kiếm, trang báo thì không', () => {
  assert.strictEqual(isSearchUrl('https://www.google.com/search?q=gia+vang'), true);
  assert.strictEqual(isSearchUrl('https://sjc.com.vn/gia-vang'), false);
});

test('isBlankUrl: thẻ mới và ô địa chỉ trống được coi là trang trống', () => {
  assert.strictEqual(isBlankUrl('chrome://newtab/'), true);
  assert.strictEqual(isBlankUrl(''), true);
});

test('googleUrl: mã hoá dấu tiếng Việt và đổi dấu cách thành +', () => {
  assert.strictEqual(googleUrl('giá vàng SJC'), 'https://www.google.com/search?q=gi%C3%A1+v%C3%A0ng+SJC');
});