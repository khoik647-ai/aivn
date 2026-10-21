// Thuế GTGT theo từng dòng (theo Odoo account.tax, nhóm thuế trên chứng từ). Mức hợp lệ ở Việt Nam: 0%, 5%, 8%, 10%.
// Hai cách làm tròn như Odoo (Cài đặt › Kế toán › Làm tròn thuế):
//   'line'   = round_per_line: thuế của từng dòng làm tròn tới 1 ₫ rồi cộng lại (mặc định cho chứng từ mới);
//   'global' = round_globally: cộng tiền trước thuế theo từng mức rồi mới tính thuế và làm tròn (chứng từ tạo trước 0.16 dùng cách này,
//              nên tổng tiền của dữ liệu cũ không lệch một đồng nào sau khi chuyển sang thuế theo dòng).
const fail = (m) => { const { CrmError } = require('./crm'); return new CrmError(m); }; // nạp muộn: crm.js cũng dùng tệp này
const T = require('./text');
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
// thành tiền trước thuế của một dòng (sau chiết khấu), làm tròn tới 1 ₫
const lineSubtotal = (l) => Math.round((Number(l.qty) || 0) * (Number(l.price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100));
const lineTax = (l) => Math.round(lineSubtotal(l) * (Number(l.vat_pct) || 0) / 100);
// tổng chứng từ + nhóm thuế theo mức (Odoo: tax_totals → groups_by_subtotal)
function totals(lines, rounding = 'line') {
  const groups = new Map(); let untaxed = 0, taxLine = 0;
  for (const l of lines || []) {
    const sub = lineSubtotal(l); const rate = Number(l.vat_pct) || 0; untaxed += sub;
    const g = groups.get(rate) || { rate, base: 0, tax: 0 }; g.base += sub;
    if (rounding === 'line') { const t = lineTax(l); g.tax += t; taxLine += t; }
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
module.exports = { VAT_RATES, ROUNDING, vatOf, roundingOf, lineSubtotal, lineTax, totals, singleRate, splitGross, fmtRate };
