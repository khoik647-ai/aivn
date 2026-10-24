'use strict';
// #51 (B188): báo cáo công nợ phải thu — “Đã thu” chỉ cộng tiền thu có NGÀY trong khoảng lọc; giấy báo có khách hàng chưa đối trừ
// được trừ vào công nợ phải thu như Odoo Aged Receivable; Tổng quan cùng số với báo cáo.
// Trên wip-0.16 thuế GTGT là một mức của cả hoá đơn (mặc định 10%); các phép thử dùng amount_total nên không phụ thuộc mức thuế.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');
let day = '2026-09-10';
async function setup() {
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-ar51-')), 'crm.db'));
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => day });
  const cus = crm.saveContact({ name: 'Công ty An Phát', kind: 'company' }); const cus2 = crm.saveContact({ name: 'Cửa hàng Minh Châu', kind: 'company' });
  return { db, crm, biz, cus, cus2 };
}
const line = (price, vat_pct = 10, qty = 1) => ({ name: 'Bàn làm việc', unit: 'cái', qty, price, vat_pct });
const post = (biz, partner_id, lines, extra = {}) => biz.postInvoice(biz.saveInvoice({ partner_id, lines, ...extra }).id);

test('#51 “Đã thu” theo ngày thu trong khoảng lọc; báo có khách hàng chưa đối trừ trừ vào phải thu; Tổng quan khớp báo cáo', async () => {
  const { biz, cus, cus2 } = await setup();
  // tháng 9: hoá đơn A thu đủ ngày 10/9
  day = '2026-09-10'; const A = post(biz, cus.id, [line(2000000), line(500000, 8)]); biz.registerPayment(A.id, { amount: A.amount_total, date: '2026-09-10' });
  // tháng 10: hoá đơn B thu 2.000.000 ngày 21/10 và 1.000.000 ngày 05/11; hoá đơn C (khách khác) chưa thu, hạn 30 ngày
  day = '2026-10-21';
  const B = post(biz, cus.id, [line(3000000), line(1000000, 5), line(700000, 0)]); biz.registerPayment(B.id, { amount: 2000000, date: '2026-10-21' }); biz.registerPayment(B.id, { amount: 1000000, date: '2026-11-05' });
  const C = post(biz, cus2.id, [line(900000, 10, 2)], { due_date: '2026-11-20' });
  assert.ok([A, B, C].every(i => i.state === 'posted'));

  // không lọc: Đã thu = mọi lần thu của hoá đơn khách
  let r = biz.invoiceReport({});
  assert.strictEqual(r.totals.paid, A.amount_total + 3000000); assert.strictEqual(r.totals.refunded, 0);
  const open = B.amount_total - 3000000 + C.amount_total;
  assert.strictEqual(r.agedTotals.total, open); assert.strictEqual(r.agedTotals.credit, 0); assert.strictEqual(biz.overview().receivable, open); assert.strictEqual(biz.overview().customerCredit, 0);

  // lọc tháng 10: chỉ tiền thu NGÀY 21/10 (trước đây cộng cả 10/9 và 05/11 → lệch chứng từ)
  const oct = biz.invoiceReport({ from: '2026-10-01', to: '2026-10-31' });
  assert.strictEqual(oct.totals.paid, 2000000, 'Đã thu tháng 10 = chỉ lần thu 21/10');
  assert.strictEqual(oct.totals.total, B.amount_total + C.amount_total, 'doanh thu lập hoá đơn tháng 10');
  assert.notStrictEqual(oct.totals.paid, r.totals.paid);
  assert.strictEqual(biz.invoiceReport({ from: '2026-09-01', to: '2026-09-30' }).totals.paid, A.amount_total);
  assert.strictEqual(biz.invoiceReport({ from: '2026-11-01', to: '2026-11-30' }).totals.paid, 1000000, 'tháng 11: chưa có hoá đơn mới nhưng có tiền thu');
  assert.strictEqual(biz.invoiceReport({ from: '2026-11-01' }).totals.paid, 1000000); assert.strictEqual(biz.invoiceReport({ to: '2026-09-30' }).totals.paid, A.amount_total);
  // tổng các tháng = không lọc
  assert.strictEqual(['09', '10', '11'].reduce((s, m) => s + biz.invoiceReport({ from: `2026-${m}-01`, to: `2026-${m}-31` }).totals.paid, 0), r.totals.paid);

  // báo có cho hoá đơn A ĐÃ THU ĐỦ → mình nợ lại khách: phải thu của khách đó giảm (Odoo Aged Receivable), Tổng quan khớp
  day = '2026-10-25'; const rf = biz.postInvoice(biz.creditNote(A.id, { reason: 'Khách trả hàng' }).id);
  assert.strictEqual(rf.kind, 'out_refund'); assert.strictEqual(rf.residual, A.amount_total);
  r = biz.invoiceReport({});
  const bOpen = B.amount_total - 3000000; const unapplied = A.amount_total - bOpen;
  const rowCus = r.aged.find(x => x.partner_id === cus.id);
  assert.ok(unapplied > 0); assert.strictEqual(rowCus.total, 0, 'báo có đối trừ hết hoá đơn B còn mở');
  assert.strictEqual(rowCus.credit, unapplied); assert.ok(['current', 'd30', 'd60', 'd90', 'older'].every(k => rowCus[k] >= 0));
  assert.strictEqual(r.aged.find(x => x.partner_id === cus2.id).total, C.amount_total);
  assert.strictEqual(r.agedTotals.credit, unapplied); assert.strictEqual(r.agedTotals.total, C.amount_total);
  assert.strictEqual(['current', 'd30', 'd60', 'd90', 'older'].reduce((s, k) => s + r.agedTotals[k], 0), r.agedTotals.total, 'các nhóm tuổi nợ cộng lại = tổng');
  const ov = biz.overview(); assert.strictEqual(ov.receivable, r.agedTotals.total, 'Tổng quan “Còn phải thu” = báo cáo'); assert.strictEqual(ov.customerCredit, unapplied);
  assert.strictEqual(r.totals.total, B.amount_total + C.amount_total, 'phân tích hoá đơn: A − báo có A = 0');

  // hoàn tiền cho khách ngày 03/11 → hết phần trừ; “Đã hoàn tiền” cũng theo ngày
  biz.registerPayment(rf.id, { amount: A.amount_total, date: '2026-11-03' });
  r = biz.invoiceReport({});
  assert.strictEqual(r.agedTotals.total, open); assert.strictEqual(r.agedTotals.credit, 0); assert.strictEqual(r.totals.refunded, A.amount_total);
  assert.strictEqual(biz.overview().receivable, open); assert.strictEqual(biz.overview().customerCredit, 0);
  assert.strictEqual(biz.invoiceReport({ from: '2026-10-01', to: '2026-10-31' }).totals.refunded, 0);
  assert.strictEqual(biz.invoiceReport({ from: '2026-11-01', to: '2026-11-30' }).totals.refunded, A.amount_total);
});

test('#51 hoá đơn thu một phần rồi báo có toàn bộ: phần báo có đối trừ được trừ vào hoá đơn, phần dư (đã thu) thành nợ lại khách — ròng như Odoo', async () => {
  day = '2026-10-21'; const { biz, cus } = await setup();
  const D = post(biz, cus.id, [line(1000000)]); biz.registerPayment(D.id, { amount: 300000 });
  const rf = biz.postInvoice(biz.creditNote(D.id, {}).id);
  assert.strictEqual(biz.getInvoice(D.id).residual, 0); assert.strictEqual(rf.residual, 300000, 'báo có còn 300.000 phải hoàn cho khách');
  const r = biz.invoiceReport({});
  assert.strictEqual(r.agedTotals.total, 0); assert.strictEqual(r.agedTotals.credit, 300000); assert.strictEqual(biz.overview().receivable, 0);
  assert.strictEqual(biz.overview().customerCredit, 300000); assert.ok(r.agedTotals.d30 >= 0 && r.agedTotals.current >= 0);
  assert.strictEqual(r.totals.total, 0); assert.strictEqual(r.totals.paid, 300000);
});

test('#51 vi/en/zh: dòng “giấy báo có chưa đối trừ {0}” có trong khoá dịch và bản dịch; giao diện báo cáo dùng đúng chuỗi', () => {
  const root = path.join(__dirname, '..'); const key = 'giấy báo có chưa đối trừ {0}';
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/strings.json'), 'utf8')).includes(key));
  assert.strictEqual(require('../src/i18n/en.js')[key], 'unapplied credit note {0}');
  assert.strictEqual(require('../src/i18n/zh.js')[key], '未抵扣的贷项通知单 {0}');
  assert.match(fs.readFileSync(path.join(root, 'src/renderer/biz.js'), 'utf8'), /a\.credit \? `<span class="small muted">giấy báo có chưa đối trừ \$\{vnd\(a\.credit\)\}<\/span>`/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/renderer/biz.js'), 'utf8'), /đã trừ giấy báo có khách hàng/);
});

test('#51 KPI quá hạn = agedTotals.overdue = Tổng quan.overdue.sum; báo có quá hạn không kéo KPI xuống âm', async () => {
  const { biz, cus, cus2 } = await setup();
  // repro review: báo có 1,1 triệu đã quá hạn + hoá đơn chưa đến hạn. Công thức cũ total − current = −1.100.000; Tổng quan = 0.
  day = '2026-07-01';
  const paid = post(biz, cus.id, [line(1000000)]); biz.registerPayment(paid.id, {});
  const cn = biz.postInvoice(biz.creditNote(paid.id, {}).id);
  assert.strictEqual(cn.residual, 1100000); assert.strictEqual(cn.due_date, '2026-07-01');
  day = '2026-10-23';
  post(biz, cus.id, [line(2000000)], { due_date: '2026-11-20' });
  let r = biz.invoiceReport({}); let ov = biz.overview();
  const row = r.aged.find(x => x.partner_id === cus.id);
  assert.strictEqual(row.older, 0, 'báo có đối trừ vào hoá đơn mở, không nằm âm ở nhóm quá hạn');
  assert.strictEqual(row.current, 1100000); assert.strictEqual(row.credit, 0); assert.strictEqual(row.d30, 0);
  assert.strictEqual(r.agedTotals.total, 1100000); assert.ok(r.agedTotals.total >= 0 && r.agedTotals.d30 >= 0);
  assert.strictEqual(ov.overdue.sum, 0); assert.strictEqual(r.agedTotals.overdue, ov.overdue.sum);

  // thêm một hoá đơn khách thật sự quá hạn: hai số vẫn khớp và chỉ cộng hoá đơn đó
  const late = post(biz, cus2.id, [line(500000)], { invoice_date: '2026-08-01', due_date: '2026-08-20' });
  assert.strictEqual(late.residual, 550000); assert.ok(late.overdue);
  r = biz.invoiceReport({}); ov = biz.overview();
  assert.strictEqual(r.agedTotals.overdue, 550000); assert.strictEqual(r.agedTotals.overdue, ov.overdue.sum);
  assert.strictEqual(r.aged.find(x => x.partner_id === cus.id).older, 0, 'báo có đã đối trừ, không kéo nhóm quá hạn xuống âm');
  assert.match(fs.readFileSync(path.join(__dirname, '../src/renderer/biz.js'), 'utf8'), /quá hạn \$\{vnd\(a\.overdue\)\}/);
});
