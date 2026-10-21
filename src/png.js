'use strict';
// Mã hoá PNG tối giản (không phụ thuộc Electron, chạy được trong worker_threads): dùng cho trang PDF scan → OCR
const zlib = require('zlib');
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// pixels: Uint8Array; channels: 1 (xám), 3 (RGB) hoặc 4 (RGBA)
function encodePng(width, height, pixels, channels) {
  const colorType = { 1: 0, 3: 2, 4: 6 }[channels]; if (colorType == null) throw new Error('Số kênh màu không hỗ trợ: ' + channels);
  const stride = width * channels; const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
// ảnh 1 bit/điểm ảnh (pdf.js GRAYSCALE_1BPP: mỗi hàng đệm tới bội số 8) → xám 8 bit
function unpack1bpp(width, height, data) {
  const out = new Uint8Array(width * height); const rb = (width + 7) >> 3;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = (data[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
  return out;
}
module.exports = { encodePng, unpack1bpp, crc32 };
