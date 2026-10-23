'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');
let day = '2026-09-10';
async function setup() {
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adv90-')), 'crm.db'));
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => day });
  const c1 = crm.saveContact({ name: 'KH1', kind: 'company' }); const c2 = crm.saveContact({ name: 'KH2', kind: 'company' });
  return { db, crm, biz, c1, c2 };
}
const line = (price) => ({ name: 'X', unit: 'cái', qty: 1, price });
const post = (biz, pid, price, extra = {}) => biz.postInvoice(biz.saveInvoice({ partner_id: pid, lines: [line(price)], ...extra }).id);
const sumB = (a) => ['current', 'd30', 'd60', 'd90', 'older'].reduce((s, k) => s + a[k], 0);

test('ADV-A1 biên ngày bao gồm cả from và to; ngày trước/sau bị loại', async () => {
  day = '2026-10-01'; const { biz, c1 } = await setup();
  const I = post(biz, c1.id, 1000000);
  biz.registerPayment(I.id, { amount: 100000, date: '2026-09-30' }); biz.registerPayment(I.id, { amount: 200000, date: '2026-10-01' });
  biz.registerPayment(I.id, { amount: 300000, date: '2026-10-31' }); biz.registerPayment(I.id, { amount: 400000, date: '2026-11-01' });
  assert.strictEqual(biz.invoiceReport({ from: '2026-10-01', to: '2026-10-31' }).totals.paid, 500000);
  assert.strictEqual(biz.invoiceReport({ from: '2026-10-31', to: '2026-10-31' }).totals.paid, 300000);
  assert.strictEqual(biz.invoiceReport({ from: '2026-10-01', to: '2026-09-30' }).totals.paid, 0, 'from>to');
  assert.strictEqual(biz.invoiceReport({ from: 'rác', to: '' }).totals.paid, 1000000, 'from không hợp lệ bị bỏ qua');
});

test('ADV-A2 thu tiền có ngày TRƯỚC ngày hoá đơn → tính theo ngày thu', async () => {
  day = '2026-10-15'; const { biz, c1 } = await setup();
  const I = post(biz, c1.id, 1000000); biz.registerPayment(I.id, { amount: 500000, date: '2026-09-20' });
  assert.strictEqual(biz.invoiceReport({ from: '2026-09-01', to: '2026-09-30' }).totals.paid, 500000);
  assert.strictEqual(biz.invoiceReport({ from: '2026-10-01', to: '2026-10-31' }).totals.paid, 0);
});

test('ADV-A3 hoá đơn nháp/huỷ không vào Đã thu, không vào công nợ', async () => {
  day = '2026-10-15'; const { biz, c1 } = await setup();
  const d = biz.saveInvoice({ partner_id: c1.id, lines: [line(700000)] }); const x = biz.saveInvoice({ partner_id: c1.id, lines: [line(900000)] }); biz.cancelInvoice(x.id);
  assert.throws(() => biz.registerPayment(d.id, { amount: 1 }));
  const r = biz.invoiceReport({}); assert.strictEqual(r.totals.paid, 0); assert.strictEqual(r.agedTotals.total, 0); assert.strictEqual(biz.overview().receivable, 0);
});

test('ADV-A4 báo có một phần đối trừ hết với hoá đơn còn nợ → không còn phần trừ, không trừ hai lần', async () => {
  day = '2026-10-15'; const { biz, c1 } = await setup();
  const I = post(biz, c1.id, 1000000); biz.registerPayment(I.id, { amount: 600000 }); // còn 500k (1.1M - 600k)
  const cn = biz.creditNote(I.id, {}); biz.saveInvoice({ id: cn.id, partner_id: c1.id, lines: [line(200000)] }); const rf = biz.postInvoice(cn.id); // 220k
  assert.strictEqual(rf.residual, 0); assert.strictEqual(biz.getInvoice(I.id).residual, 280000);
  const r = biz.invoiceReport({}); assert.strictEqual(r.agedTotals.total, 280000); assert.strictEqual(r.agedTotals.credit, 0); assert.strictEqual(biz.overview().receivable, 280000);
});

test('ADV-A5 báo có lớn hơn số còn nợ → phần dư là nợ lại khách; hoàn tiền một phần; Tổng quan = báo cáo ở mọi bước', async () => {
  day = '2026-10-15'; const { biz, c1, c2 } = await setup();
  const I = post(biz, c1.id, 1000000); biz.registerPayment(I.id, { amount: 700000 }); // còn 400k
  const J = post(biz, c1.id, 500000); // 550k, không liên quan
  const K = post(biz, c2.id, 300000);
  const rf = biz.postInvoice(biz.creditNote(I.id, {}).id); // 1.1M → đối trừ 400k, dư 700k
  assert.strictEqual(rf.residual, 700000);
  let r = biz.invoiceReport({}); let ov = biz.overview();
  assert.strictEqual(r.agedTotals.total, 550000 - 700000 + 330000); assert.strictEqual(r.agedTotals.credit, 700000);
  assert.strictEqual(ov.receivable, r.agedTotals.total); assert.strictEqual(ov.customerCredit, r.agedTotals.credit); assert.strictEqual(sumB(r.agedTotals), r.agedTotals.total);
  biz.registerPayment(rf.id, { amount: 300000, date: '2026-10-16' });
  r = biz.invoiceReport({}); ov = biz.overview();
  assert.strictEqual(r.agedTotals.credit, 400000); assert.strictEqual(ov.receivable, r.agedTotals.total); assert.strictEqual(r.totals.refunded, 300000);
  assert.strictEqual(r.totals.paid, 700000, 'đối trừ báo có không phải tiền thu');
});

// adapted from the reviewer's probe per the #90 review fix
test('ADV-A6 KPI “quá hạn” dùng agedTotals.overdue: khớp Tổng quan và không âm', async () => {
  const { biz, c1, c2 } = await setup();
  day = '2026-07-01'; const A = post(biz, c1.id, 1000000); biz.registerPayment(A.id, {}); biz.postInvoice(biz.creditNote(A.id, {}).id); // báo có dư 1.1M, hạn 2026-07-01
  day = '2026-10-23'; post(biz, c2.id, 2000000, { due_date: '2026-11-20' }); // chưa đến hạn
  const r = biz.invoiceReport({}); const ov = biz.overview(); const overdueKpi = r.agedTotals.overdue;
  console.log('report total', r.agedTotals.total, 'current', r.agedTotals.current, 'quá hạn KPI', overdueKpi, '| overview overdue', JSON.stringify(ov.overdue), 'receivable', ov.receivable);
  assert.strictEqual(overdueKpi, ov.overdue.sum, 'quá hạn báo cáo ≠ Tổng quan');
  assert.ok(overdueKpi >= 0, 'quá hạn âm');
  assert.strictEqual(r.agedTotals.total - r.agedTotals.current, -1100000, 'báo có vẫn hiện trong bảng tuổi nợ');
});

// adapted from the reviewer's probe per the #90 review fix
test('ADV-A7 báo có đăng hôm qua, thanh toán ngay → nhóm 1–30 ngày −1.100.000, KPI quá hạn = 0', async () => {
  const { biz, c1 } = await setup();
  day = '2026-10-22'; const A = post(biz, c1.id, 1000000); biz.registerPayment(A.id, {}); biz.postInvoice(biz.creditNote(A.id, {}).id);
  day = '2026-10-23'; const r = biz.invoiceReport({}); console.log('A7 buckets', JSON.stringify(r.agedTotals));
  assert.strictEqual(r.agedTotals.d30, -1100000, 'báo có vào nhóm tuổi theo hạn');
  assert.strictEqual(r.agedTotals.overdue, 0);
});

test('ADV-A8 ngẫu nhiên 200 thao tác: Tổng quan.receivable = agedTotals.total; tổng các nhóm = total; credit = tổng residual báo có', async () => {
  day = '2026-10-01'; const { db, biz, c1, c2 } = await setup();
  const invs = [];
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 200; k++) {
    try {
      const op = rnd(4);
      if (op === 0 || !invs.length) invs.push(post(biz, rnd(2) ? c1.id : c2.id, 100000 * (1 + rnd(20))).id);
      else if (op === 1) { const id = invs[rnd(invs.length)]; const i = biz.getInvoice(id); if (i.residual > 0) biz.registerPayment(id, { amount: 1 + rnd(i.residual), date: `2026-10-${String(1 + rnd(28)).padStart(2, '0')}` }); }
      else if (op === 2) { const id = invs[rnd(invs.length)]; const cn = biz.creditNote(id, {}); if (rnd(2)) biz.saveInvoice({ id: cn.id, partner_id: cn.partner_id, lines: [line(10000 * (1 + rnd(50)))] }); invs.push(biz.postInvoice(cn.id).id); }
      else { day = `2026-${String(10 + rnd(3)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`; }
    } catch (e) { if (!/vượt|đã được|toàn bộ|Hạn|lớn hơn|Chỉ/.test(e.message)) throw e; }
    const r = biz.invoiceReport({}); const ov = biz.overview();
    assert.strictEqual(ov.receivable, r.agedTotals.total, 'bước ' + k); assert.strictEqual(sumB(r.agedTotals), r.agedTotals.total);
    const cred = db.all("SELECT * FROM invoices WHERE state='posted' AND kind='out_refund'").reduce((a, i) => a + Math.max(0, i.amount_total - i.amount_paid), 0);
    assert.strictEqual(r.agedTotals.credit, cred); assert.strictEqual(ov.customerCredit, cred);
    const net = db.all("SELECT * FROM invoices WHERE state='posted'").reduce((a, i) => a + (i.kind === 'out_refund' ? -1 : 1) * Math.max(0, i.amount_total - i.amount_paid), 0);
    assert.strictEqual(r.agedTotals.total, net);
    // Đã thu không lọc = tổng payments hoá đơn
    assert.strictEqual(r.totals.paid, db.get("SELECT COALESCE(SUM(p.amount),0) s FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.kind='out_invoice'").s);
  }
});
