// Thuế GTGT theo từng dòng (theo Odoo account.tax, nhóm thuế trên chứng từ). Mức hợp lệ ở Việt Nam: 0%, 5%, 8%, 10%.
// Hai cách làm tròn như Odoo (Cài đặt › Kế toán › Làm tròn thuế):
//   'line'   = round_per_line: thuế của từng dòng làm tròn tới 1 ₫ rồi cộng lại (mặc định cho chứng từ mới);
//   'global' = round_globally: cộng tiền trước thuế theo từng mức rồi mới tính thuế và làm tròn (chứng từ tạo trước 0.16 dùng cách này,
//              nên tổng tiền của dữ liệu cũ không lệch một đồng nào sau khi chuyển sang thuế theo dòng).
const fail = (m) => { const { CrmError } = require('./crm'); return new CrmError(m); }; // nạp muộn: crm.js cũng dùng tệp này
const T = require('./text');
const N = require('./num');
const VAT_RATES = [0, 5, 8, 10];
const ROUNDING = ['line', 'global'];
// B52: mức thuế không hợp lệ (vd. 7%) → báo lỗi, không tự đổi; bỏ trống → mức mặc định
function vatOf(x, dflt = 10) {
  if (x === undefined || x === null || x === '') return dflt;
  const n = Number(String(x).replace('%', '').replace(',', '.').trim());
  if (!VAT_RATES.includes(n)) throw fail(`Thuế suất GTGT “${x}” không hợp lệ — chỉ nhận 0%, 5%, 8% hoặc 10%.`);
  return n;
}
const roundingOf = (m) => (ROUNDING.includes(m) ? m : 'line');
// #41: làm tròn đúng như Odoo (odoo/tools/float_utils.py float_round, HALF-UP, precision_rounding = 1 ₫ vì res.currency VND
// có rounding 1.00): chia cho bước làm tròn, cộng epsilon = 2^(log2|x| − 52) cùng dấu, rồi round() kiểu Python 2 (ra xa số 0).
// Nhờ epsilon, số như 21,4999999999 (thực ra là 21,5 bị sai số dấu phẩy động) vẫn lên 22 — Math.round thì ra 21.
const floatRound = N.floatRound; // dùng chung với giao diện (src/crm/num.js)
// thành tiền trước thuế của một dòng (sau chiết khấu), làm tròn tới 1 ₫.
//   'line' (Odoo round_per_line, mọi chứng từ mới): như account.tax.compute_all — đơn giá sau CK = price × (1 − CK/100),
//          base = float_round(đơn giá sau CK × SL), thuế dòng = float_round(base × mức / 100).
//   'global' (chứng từ trước 0.16): GIỮ NGUYÊN công thức cũ Math.round(SL × giá × (1 − CK/100)) để tổng cũ không đổi một đồng.
const lineSubtotal = (l, rounding = 'line') => {
  const q = Number(l.qty) || 0, p = Number(l.price) || 0, d = Number(l.discount_pct) || 0;
  return rounding === 'global' ? Math.round(q * p * (1 - d / 100)) : floatRound((p * (1 - d / 100.0)) * q);
};
const lineTax = (l, rounding = 'line') => {
  const sub = lineSubtotal(l, rounding), r = Number(l.vat_pct) || 0;
  return rounding === 'global' ? Math.round(sub * r / 100) : floatRound(sub * r / 100);
};
// tổng chứng từ + nhóm thuế theo mức (Odoo: tax_totals → groups_by_subtotal)
function totals(lines, rounding = 'line') {
  rounding = roundingOf(rounding);
  const groups = new Map(); let untaxed = 0, taxLine = 0;
  for (const l of lines || []) {
    const sub = lineSubtotal(l, rounding); const rate = Number(l.vat_pct) || 0; untaxed += sub;
    const g = groups.get(rate) || { rate, base: 0, tax: 0 }; g.base += sub;
    if (rounding === 'line') { const t = lineTax(l, 'line'); g.tax += t; taxLine += t; }
    groups.set(rate, g);
  }
  const list = [...groups.values()].sort((a, b) => a.rate - b.rate);
  if (rounding !== 'line') for (const g of list) g.tax = Math.round(g.base * g.rate / 100);
  const tax = rounding === 'line' ? taxLine : list.reduce((a, g) => a + g.tax, 0);
  return { amount_untaxed: untaxed, amount_tax: tax, amount_total: untaxed + tax, tax_groups: list };
}
// Một mức thuế duy nhất? (để hiện “Thuế GTGT 10%” gọn như trước)
const singleRate = (lines) => { const s = new Set((lines || []).map(l => Number(l.vat_pct) || 0)); return s.size === 1 ? [...s][0] : null; };
// chia một số tiền GỒM thuế (vd. phần còn lại chưa báo có) thành các dòng theo tỉ lệ các nhóm thuế, tổng không vượt `gross`
function splitGross(gross, groups, rounding = 'line') {
  const g = (groups || []).filter(x => x.base > 0); if (!g.length || gross <= 0) return [];
  const all = g.reduce((a, x) => a + x.base + Math.round(x.base * x.rate / 100), 0);
  const out = g.map(x => ({ rate: x.rate, base: Math.floor(gross * (x.base + Math.round(x.base * x.rate / 100)) / all / (1 + x.rate / 100)) }));
  const sum = () => totals(out.map(x => ({ qty: 1, price: x.base, vat_pct: x.rate })), rounding).amount_total;
  // nhích phần dư vào dòng lớn nhất cho tới sát `gross` (không vượt)
  const big = out.reduce((a, x) => (x.base > a.base ? x : a), out[0]);
  for (let i = 0; i < 50 && sum() < gross; i++) { big.base++; if (sum() > gross) { big.base--; break; } }
  while (sum() > gross && big.base > 0) big.base--;
  return out.filter(x => x.base > 0);
}
const fmtRate = (r) => `${T.round3(r)}%`;
// B73: ô nhập từ người dùng: bỏ trống → mặc định; có chữ mà không đọc được → báo lỗi rõ ràng (không lặng lẽ thành 0)
const blank = (v) => v == null || String(v).trim() === '';
function moneyIn(v, dflt = 0) { if (blank(v)) return dflt; const n = N.parseMoney(v); if (!Number.isFinite(n)) throw fail(`“${String(v).trim()}” không phải là số tiền hợp lệ.`); return n; }
function pctIn(v, dflt = 0) { if (blank(v)) return dflt; const n = N.parsePct(String(v).replace(/%\s*$/, '')); if (!Number.isFinite(n)) throw fail(`Chiết khấu “${String(v).trim()}” không phải là số.`); return Math.max(0, Math.min(100, N.round3(n))); }
module.exports = { floatRound, moneyIn, pctIn, VAT_RATES, ROUNDING, vatOf, roundingOf, lineSubtotal, lineTax, totals, singleRate, splitGross, fmtRate };
