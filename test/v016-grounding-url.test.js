'use strict';
// Kiểm tra hai hàm nhỏ trong src/agent/grounding.js: lev (khoảng cách sửa chữ) và splitUrl (tách đường dẫn).
const test = require('node:test'); const assert = require('node:assert');
const { lev, splitUrl } = require('../src/agent/grounding');

test('lev: hai chuỗi giống nhau thì 0, chuỗi rỗng thì bằng độ dài chuỗi kia', () => {
  assert.strictEqual(lev('aivn', 'aivn'), 0);
  assert.strictEqual(lev('', 'abc'), 3);
});

test('lev: "kitten" thành "sitting" cần 3 lần sửa', () => {
  assert.strictEqual(lev('kitten', 'sitting'), 3);
});

test('splitUrl: bỏ www., tên miền về chữ thường, bỏ dấu chấm cuối câu', () => {
  assert.deepStrictEqual(splitUrl('HTTPS://www.VnExpress.net/Tin-Moi.'), { scheme: 'https', host: 'vnexpress.net', rest: '/Tin-Moi' });
});

test('splitUrl: youtu.be/ID được đổi thành youtube.com/watch?v=ID', () => {
  assert.deepStrictEqual(splitUrl('youtu.be/dQw4w9WgXcQ'), { scheme: '', host: 'youtube.com', rest: '/watch?v=dQw4w9WgXcQ' });
});