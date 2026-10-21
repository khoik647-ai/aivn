// AIVN 0.16 — B73 (QA lượt 8): MỘT bộ đọc số dùng chung cho mọi ô số lượng, đơn giá, tồn kho — ở tiến trình chính (crm/*) và giao diện (renderer).
// Người dùng vi viết “1.000,5”, người dùng en/zh viết “1,000.5”; ứng dụng phải hiểu cả hai mà không cần biết họ đang dùng ngôn ngữ nào:
//   • không có dấu phân cách → số nguyên;
//   • có HAI loại dấu (“1.234,5” / “1,234.5”) → dấu xuất hiện SAU CÙNG là dấu thập phân, dấu kia là phân cách hàng nghìn (phải đúng nhóm 3 chữ số);
//   • một loại dấu lặp lại (“1.000.000” / “1,000,000”) → phân cách hàng nghìn;
//   • một dấu duy nhất: phần nguyên bằng 0 hoặc trống (“0.125”, “0,25”, “.5”) → thập phân; theo sau đúng 3 chữ số và phần nguyên 1–3 chữ số
//     khác 0 (“1.000”, “1,000”) → hàng nghìn; còn lại (“1,5”, “2.75”, “1234.567”) → thập phân.
// Chấp nhận chữ số/dấu toàn chiều rộng (１２，５), dấu trừ “−”, khoảng trắng nhóm số (“1 000”), và đơn vị đi sau (“0.250 kg”, “3 cái”, “12%”).
// Không đọc được → NaN (không bao giờ đoán thành 0).
(function (root) {
  'use strict';
  const SPACE = /[\s\u00a0\u2007\u2009\u202f]/g;
  const clean = (v) => String(v ?? '').normalize('NFKC').replace(/[\u2212\u2012\u2013]/g, '-').replace(SPACE, '');
  // phần số + phần đuôi (đơn vị/ký hiệu) — đuôi phải bắt đầu bằng chữ cái hoặc %, ₫
  const SPLIT = /^([+-]?)(\d[\d.,]*|[.,]\d+)((?:\p{L}|%|₫|°)[\p{L}\p{M}/.%°]*[²³23]?)?$/u; // “1e5”, “0x10” không phải số + đơn vị

  function readBody(b, decimalFirst) {
    if (/[.,]{2}/.test(b)) return NaN;
    if (/[.,]$/.test(b)) { if (/[.,]/.test(b.slice(0, -1))) return NaN; b = b.slice(0, -1); } // “5.” = 5; “1.000.” → không rõ
    const seps = b.match(/[.,]/g) || [];
    if (!seps.length) return Number(b);
    const kinds = [...new Set(seps)];
    if (kinds.length === 2) {
      const dec = seps[seps.length - 1], grp = kinds.find(k => k !== dec);
      const i = b.lastIndexOf(dec); const ip = b.slice(0, i), fp = b.slice(i + 1);
      if (ip.includes(dec) || !fp || /[.,]/.test(fp)) return NaN;
      const g = grp === '.' ? '\\.' : ',';
      if (!new RegExp(`^\\d{1,3}(?:${g}\\d{3})+$`).test(ip)) return NaN;
      return Number(ip.split(grp).join('') + '.' + fp);
    }
    const c = kinds[0];
    if (seps.length > 1) {
      if (decimalFirst) return NaN;
      const g = c === '.' ? '\\.' : ',';
      return new RegExp(`^\\d{1,3}(?:${g}\\d{3})+$`).test(b) ? Number(b.split(c).join('')) : NaN;
    }
    const [ip, fp] = b.split(c);
    if (!fp) return Number(ip);
    if (!decimalFirst && fp.length === 3 && /^\d{1,3}$/.test(ip) && !/^0+$/.test(ip)) return Number(ip + fp); // hàng nghìn
    return Number((ip || '0') + '.' + fp);
  }
  // parseNumber(v, { decimalFirst, unit }) — unit=false: không chấp nhận đuôi chữ
  function parseNumber(v, opts = {}) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (v == null || typeof v === 'boolean') return NaN;
    const s = clean(v); if (!s) return NaN;
    const m = SPLIT.exec(s); if (!m) return NaN;
    if (m[3] && opts.unit === false) return NaN;
    const n = readBody(m[2], !!opts.decimalFirst);
    return Number.isFinite(n) ? (m[1] === '-' ? -n : n) : NaN;
  }
  const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
  const parseQty = (v) => { const n = parseNumber(v); return Number.isFinite(n) ? round3(n) : NaN; };
  // phần trăm: “10”, “7,5%”, “0.5” (không có hàng nghìn — một dấu luôn là thập phân)
  const parsePct = (v) => parseNumber(v, { decimalFirst: true });

  // Tiền VND: “15.000.000”, “15,000,000 ₫”, “15,5 triệu”, “2 tỷ”, “500k”, “1.5 million”, “3万”, “15000000đ”. Trả số nguyên đồng hoặc NaN.
  const fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const MULT = [[/^(?:ty|ti|billion|bn)$/, 1e9], [/^亿$/, 1e8], [/^(?:trieu|tr|million|mil|m|百万)$/, 1e6], [/^万$/, 1e4], [/^(?:nghin|ngan|k|thousand|千)$/, 1e3]];
  function parseMoney(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : NaN;
    let s = fold(clean(v)).replace(/(?:vnd|vnđ|dong|越南盾|₫|元)$/u, '').replace(/d$/, '');
    if (!s) return NaN;
    let mul = 1; const w = /^([+-]?[\d.,]+)(\D+)$/u.exec(s);
    if (w) { const hit = MULT.find(([re]) => re.test(w[2])); if (!hit) return NaN; mul = hit[1]; s = w[1]; }
    const n = parseNumber(s, { unit: false });
    return Number.isFinite(n) ? Math.round(n * mul) : NaN;
  }
  const LOCALE = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN' };
  // số → chuỗi đặt vào ô nhập theo ngôn ngữ giao diện (đọc lại đúng bằng parseNumber khi không mơ hồ; giao diện giữ số gốc ở data-num)
  const fmtInput = (n, lang = 'vi', max = 3) => Number.isFinite(Number(n)) ? Number(n).toLocaleString(LOCALE[lang] || 'vi-VN', { maximumFractionDigits: max, useGrouping: true }) : '';
  const api = { parseNumber, parseQty, parsePct, parseMoney, round3, fmtInput, LOCALE };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AIVN_NUM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
