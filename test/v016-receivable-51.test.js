'use strict';
// #51 (B188): báo cáo công nợ phải thu — “Đã thu” chỉ cộng tiền thu có NGÀY trong khoảng lọc; giấy báo có khách hàng chưa đối trừ
// được trừ vào công nợ phải thu như Odoo Aged Receivable; Tổng quan cùng số với báo cáo (giống #38 bên công nợ phải trả)
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
  assert.strictEqual(r.aged.find(x => x.partner_id === cus.id).total, B.amount_total - 3000000 - A.amount_total);
  assert.strictEqual(r.aged.find(x => x.partner_id === cus.id).credit, A.amount_total); assert.strictEqual(r.aged.find(x => x.partner_id === cus2.id).total, C.amount_total);
  assert.strictEqual(r.agedTotals.credit, A.amount_total); assert.strictEqual(r.agedTotals.total, open - A.amount_total);
  assert.strictEqual(['current', 'd30', 'd60', 'd90', 'older'].reduce((s, k) => s + r.agedTotals[k], 0), r.agedTotals.total, 'các nhóm tuổi nợ cộng lại = tổng');
  const ov = biz.overview(); assert.strictEqual(ov.receivable, r.agedTotals.total, 'Tổng quan “Còn phải thu” = báo cáo'); assert.strictEqual(ov.customerCredit, A.amount_total);
  assert.strictEqual(r.totals.total, B.amount_total + C.amount_total, 'phân tích hoá đơn: A − báo có A = 0');

  // hoàn tiền cho khách ngày 03/11 → hết phần trừ; “Đã hoàn tiền” cũng theo ngày
  biz.registerPayment(rf.id, { amount: A.amount_total, date: '2026-11-03' });
  r = biz.invoiceReport({});
  assert.strictEqual(r.agedTotals.total, open); assert.strictEqual(r.agedTotals.credit, 0); assert.strictEqual(r.totals.refunded, A.amount_total);
  assert.strictEqual(biz.overview().receivable, open); assert.strictEqual(biz.overview().customerCredit, 0);
  assert.strictEqual(biz.invoiceReport({ from: '2026-10-01', to: '2026-10-31' }).totals.refunded, 0);
  assert.strictEqual(biz.invoiceReport({ from: '2026-11-01', to: '2026-11-30' }).totals.refunded, A.amount_total);
  // công nợ phải trả không bị ảnh hưởng
  assert.strictEqual(biz.overview().payable, 0);
});

test('#51 hoá đơn thu một phần rồi báo có toàn bộ: phần báo có đối trừ được trừ vào hoá đơn, phần dư (đã thu) thành nợ lại khách — ròng như Odoo', async () => {
  day = '2026-10-21'; const { biz, cus } = await setup();
  const D = post(biz, cus.id, [line(1000000)]); biz.registerPayment(D.id, { amount: 300000 });
  const rf = biz.postInvoice(biz.creditNote(D.id, {}).id);
  assert.strictEqual(biz.getInvoice(D.id).residual, 0); assert.strictEqual(rf.residual, 300000, 'báo có còn 300.000 phải hoàn cho khách');
  const r = biz.invoiceReport({});
  assert.strictEqual(r.agedTotals.total, -300000); assert.strictEqual(r.agedTotals.credit, 300000); assert.strictEqual(biz.overview().receivable, -300000);
  assert.strictEqual(r.totals.total, 0); assert.strictEqual(r.totals.paid, 300000);
});

test('#51 vi/en/zh: dòng “đã trừ giấy báo có khách hàng {0}” có trong khoá dịch và bản dịch; giao diện báo cáo dùng đúng chuỗi', () => {
  const root = path.join(__dirname, '..'); const key = 'đã trừ giấy báo có khách hàng {0}';
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/strings.json'), 'utf8')).includes(key));
  assert.strictEqual(require('../src/i18n/en.js')[key], '{0} customer credit deducted');
  assert.strictEqual(require('../src/i18n/zh.js')[key], '已扣除客户贷项通知单 {0}');
  assert.match(fs.readFileSync(path.join(root, 'src/renderer/biz.js'), 'utf8'), /a\.credit \? `<span class="small muted">đã trừ giấy báo có khách hàng \$\{vnd\(a\.credit\)\}<\/span>`/);
});
