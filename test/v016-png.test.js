'use strict';
// Kiểm tra bộ mã hoá PNG tối giản src/png.js (dùng cho trang PDF scan → OCR).
const test = require('node:test'); const assert = require('node:assert');
const { encodePng, unpack1bpp, crc32 } = require('../src/png');

test('crc32: khớp giá trị chuẩn của chuỗi "123456789"', () => {
  assert.strictEqual(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('unpack1bpp: bit 1 thành 255, bit 0 thành 0, mỗi hàng đệm tới đủ 8 bit', () => {
  const out = unpack1bpp(3, 2, Uint8Array.from([0b10100000, 0b01000000]));
  assert.deepStrictEqual(Array.from(out), [255, 0, 255, 0, 255, 0]);
});

test('encodePng: có chữ ký PNG và ghi đúng rộng, cao trong IHDR', () => {
  const png = encodePng(2, 3, new Uint8Array(2 * 3), 1);
  assert.deepStrictEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.strictEqual(png.readUInt32BE(16), 2);
  assert.strictEqual(png.readUInt32BE(20), 3);
});

test('encodePng: số kênh màu không hỗ trợ thì báo lỗi rõ', () => {
  assert.throws(() => encodePng(1, 1, new Uint8Array(2), 2), /Số kênh màu không hỗ trợ: 2/);
});