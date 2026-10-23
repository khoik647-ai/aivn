// Bộ tạo mã QR (ISO/IEC 18004) tự viết, chạy hoàn toàn trên máy: chế độ byte, mức sửa lỗi L/M/Q/H, phiên bản 1–40,
// tự chọn mặt nạ theo điểm phạt của chuẩn. Dùng cho VietQR trên hoá đơn (src/crm/vietqr.js) → ảnh SVG nhúng vào PDF và giao diện.
'use strict';
const ECL = { L: 1, M: 0, Q: 3, H: 2 }; // bit định dạng của từng mức
const ECC_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const NUM_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
// số mô-đun dành cho dữ liệu + sửa lỗi (trừ mẫu định vị, căn chỉnh, đường thời gian, thông tin định dạng/phiên bản)
function rawModules(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
}
const dataCodewords = (v, e) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[e][v] * NUM_BLOCKS[e][v];
function alignPositions(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2; const size = v * 4 + 17;
  const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6]; for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}
// trường GF(256), đa thức nguyên thuỷ 0x11D
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsDivisor(deg) { // hệ số đa thức sinh (bỏ hệ số bậc cao nhất = 1)
  const r = new Uint8Array(deg); r[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = mul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = mul(root, 2); }
  return r;
}
function rsRemainder(data, div) {
  const r = new Uint8Array(div.length);
  for (const b of data) { const f = b ^ r[0]; r.copyWithin(0, 1); r[r.length - 1] = 0; for (let i = 0; i < div.length; i++) r[i] ^= mul(div[i], f); }
  return r;
}
function encodeBytes(bytes, v, e) {
  const cap = dataCodewords(v, e) * 8; const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v <= 9 ? 8 : 16); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
  const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // chia khối, thêm mã sửa lỗi, đan xen
  const nb = NUM_BLOCKS[e][v], ecc = ECC_PER_BLOCK[e][v], raw = Math.floor(rawModules(v) / 8);
  const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb); const div = rsDivisor(ecc); const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) { const d = cw.slice(k, k + shortLen - ecc + (i < nShort ? 0 : 1)); k += d.length; const r = rsRemainder(d, div); const blk = [...d]; if (i < nShort) blk.push(0); blocks.push(blk.concat([...r])); }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecc || j >= nShort) out.push(b[i]); });
  return out;
}
const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0, (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
function build(v, e, codewords, mask) {
  const size = v * 4 + 17; const m = Array.from({ length: size }, () => new Array(size).fill(false)); const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue; const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = alignPositions(v); const last = al.length - 1;
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (mk) => { const data = (ECL[e] << 3) | mk; let r = data; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = ((data << 10) | r) ^ 0x5412; const bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i)); set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i)); set(8, size - 8, true); };
  format(0); // giữ chỗ, ghi lại sau khi chọn mặt nạ
  if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); const b = (v << 12) | r; for (let i = 0; i < 18; i++) { const d = ((b >>> i) & 1) === 1; const a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, d); set(c, a, d); } }
  let i = 0; const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j; const up = ((right + 1) & 2) === 0; const y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && i < total) { m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const apply = (mk) => { const f = MASKS[mk]; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && f(x, y)) m[y][x] = !m[y][x]; };
  if (mask == null) { // chọn mặt nạ có điểm phạt thấp nhất
    let best = 0, bestP = Infinity;
    for (let k = 0; k < 8; k++) { apply(k); format(k); const p = penalty(m); if (p < bestP) { bestP = p; best = k; } apply(k); }
    mask = best;
  }
  apply(mask); format(mask);
  return { size, modules: m, version: v, ecl: e, mask };
}
function penalty(m) {
  const n = m.length; let p = 0;
  const line = (get) => { for (let a = 0; a < n; a++) { let run = 1; for (let b = 1; b <= n; b++) { if (b < n && get(a, b) === get(a, b - 1)) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; } }
    for (let b = 0; b + 10 < n; b++) { const s = Array.from({ length: 11 }, (_, k) => get(a, b + k)); const pat = [1, 0, 1, 1, 1, 0, 1]; const ok7 = (o) => pat.every((x, k) => s[o + k] === !!x);
      if ((ok7(0) && !s[7] && !s[8] && !s[9] && !s[10]) || (ok7(4) && !s[0] && !s[1] && !s[2] && !s[3])) p += 40; } } };
  line((a, b) => m[a][b]); line((a, b) => m[b][a]);
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
  let dark = 0; for (const r of m) for (const c of r) if (c) dark++;
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}
// mã hoá chuỗi (UTF-8). Mặc định mức M như VietQR của các ngân hàng; phiên bản nhỏ nhất chứa vừa
function encode(text, { ecl = 'M', minVersion = 1, mask = null } = {}) {
  const bytes = [...Buffer.from(String(text), 'utf8')]; if (!ECL.hasOwnProperty(ecl)) throw new Error('Mức sửa lỗi QR không hợp lệ.');
  for (let v = Math.max(1, minVersion); v <= 40; v++) { const need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8; if (need <= dataCodewords(v, ecl) * 8) return build(v, ecl, encodeBytes(bytes, v, ecl), mask); }
  throw new Error('Dữ liệu quá dài cho mã QR.');
}
// ảnh SVG (vùng trắng 4 mô-đun theo chuẩn), tô bằng một <path> để nhẹ và nét khi in
function toSvg(qr, { margin = 4, size = null, dark = '#000', light = '#fff', title = '' } = {}) {
  const n = qr.size + margin * 2; let d = '';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${size ? ` width="${size}" height="${size}"` : ''} shape-rendering="crispEdges" role="img"${title ? ` aria-label="${esc(title)}"` : ''}><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
module.exports = { encode, toSvg, dataCodewords, alignPositions };
