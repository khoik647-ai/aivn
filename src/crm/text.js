// Chuẩn hoá tiếng Việt, số điện thoại, tiền VND, đọc số thành chữ
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();

// Số điện thoại Việt Nam: +84 / 84 / 0084 → 0; Excel làm mất số 0 đầu (9 chữ số) → thêm lại
function normPhone(p) {
  let s = String(p ?? '').trim(); if (!s) return '';
  s = s.replace(/^\s*(\(\s*\+?84\s*\)|\+\s*84|0084)/, '0').replace(/[^\d]/g, '');
  if (/^84\d{9,10}$/.test(s)) s = '0' + s.slice(2);
  if (/^[1-9]\d{8}$/.test(s)) s = '0' + s; // 912345678 → 0912345678 (mất số 0 khi mở bằng Excel)
  return s;
}
const validPhone = (n) => /^0\d{9,10}$/.test(n) || /^1[89]00\d{4,6}$/.test(n);
function fmtPhone(p) {
  const n = normPhone(p); if (!n) return '';
  if (/^0[35789]\d{8}$/.test(n)) return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`; // di động 0912 345 678
  if (/^02\d{9}$/.test(n)) return `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`; // cố định 028 3822 1234
  if (/^1[89]00\d+$/.test(n)) return `${n.slice(0, 4)} ${n.slice(4)}`;
  return n;
}
const normEmail = (e) => String(e ?? '').trim().toLowerCase();
const validEmail = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const normTax = (t) => String(t ?? '').replace(/[^\d-]/g, '');
const validTax = (t) => !t || /^\d{10}(-\d{3})?$/.test(t) || /^\d{12}$/.test(t); // MST 10 số, chi nhánh -xxx; cá nhân CCCD 12 số

// B73 (QA lượt 8): đọc số dùng chung src/crm/num.js (cùng tệp với giao diện) — “0.125” = 0,125; “1,000” = 1000; “1.234,5” = “1,234.5” = 1234,5
const N = require('./num');
// "15.000.000", "15,5 triệu", "2 tỷ", "15000000đ" → số nguyên VND; không đọc được → 0 (nơi cần chặn chữ dùng N.parseMoney → NaN)
const parseVnd = (v) => { const n = N.parseMoney(v); return Number.isFinite(n) ? n : 0; };
const round3 = N.round3;
const parseQty = N.parseQty;
const fmtVnd = (n) => (Math.round(Number(n) || 0)).toLocaleString('vi-VN') + ' ₫';

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function read3(n, full) {
  const h = Math.floor(n / 100), t = Math.floor(n % 100 / 10), u = n % 10; const out = [];
  if (h || full) out.push(DIGITS[h] + ' trăm');
  if (t > 1) { out.push(DIGITS[t] + ' mươi'); if (u === 1) out.push('mốt'); else if (u === 5) out.push('lăm'); else if (u === 4) out.push('tư'); else if (u) out.push(DIGITS[u]); }
  else if (t === 1) { out.push('mười'); if (u === 5) out.push('lăm'); else if (u) out.push(DIGITS[u]); }
  else if (u) { if (h || full) out.push('lẻ'); out.push(DIGITS[u]); }
  return out.join(' ');
}
// 1250000 → "Một triệu hai trăm năm mươi nghìn đồng"
function vndWords(n) {
  n = Math.round(Math.abs(Number(n) || 0)); if (!n) return 'Không đồng';
  const units = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ', ' triệu tỷ']; const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) { const g = groups[i]; if (!g) continue; parts.push(read3(g, i < groups.length - 1) + units[i]); }
  const s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + ' đồng';
}
module.exports = { parseQty, round3, fold, normPhone, validPhone, fmtPhone, normEmail, validEmail, normTax, validTax, parseVnd, fmtVnd, vndWords };
