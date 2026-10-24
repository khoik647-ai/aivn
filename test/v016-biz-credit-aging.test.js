'use strict';
// Tái hiện hai lỗi có sẵn trên be7989a:
// 1) giấy báo có (credit note) bị nhét âm vào nhóm 1–30 và kéo “Còn phải thu” xuống âm
// 2) R3-K1: doanh số theo tháng chỉ đúng khi máy đang ở UTC+7
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');

let day = '2026-10-21';
async function setup(now) {
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-ar-')), 'crm.db'));
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' });
  const biz = createBiz({ db, crm, today: () => day, now: now || (() => Date.parse(day + 'T04:00:00Z')) });
  const cus = crm.saveContact({ name: 'Công ty An Phát', kind: 'company' });
  const cus2 = crm.saveContact({ name: 'Cửa hàng Minh Châu', kind: 'company' });
  return { db, crm, biz, cus, cus2 };
}
const line = (price) => ({ name: 'Bàn làm việc', unit: 'cái', qty: 1, price });
const post = (biz, partner_id, price, extra = {}) => biz.postInvoice(biz.saveInvoice({ partner_id, lines: [line(price)], ...extra }).id);
const BUCKETS = ['current', 'd30', 'd60', 'd90', 'older', 'total'];
const nonNeg = (r, label) => {
  for (const k of BUCKETS) {
    assert.ok(r.agedTotals[k] >= 0, `${label}: tổng ${k} = ${r.agedTotals[k]}`);
    for (const row of r.aged) assert.ok(row[k] >= 0, `${label}: ${row.partner_name} ${k} = ${row[k]}`);
  }
};

test('giấy báo có không làm nhóm 1–30 và Còn phải thu âm', async () => {
  // Hoá đơn đã thu đủ, giấy báo có vào sổ hôm qua → phần chưa đối trừ. Trước đây rơi vào nhóm 1–30 với số âm
  // và “Còn phải thu” = −1.100.000. Đúng: nhóm tuổi và phải thu không âm; số dư hiện ở credit.
  const { biz, cus } = await setup();
  day = '2026-10-22';
  const paid = post(biz, cus.id, 1000000);
  biz.registerPayment(paid.id, {});
  const cn = biz.postInvoice(biz.creditNote(paid.id, { reason: 'Khách trả hàng' }).id);
  assert.strictEqual(cn.residual, 1100000);
  assert.strictEqual(cn.due_date, '2026-10-22');
  day = '2026-10-23';
  const r = biz.invoiceReport({});
  const ov = biz.overview();
  nonNeg(r, 'báo có chưa đối trừ');
  assert.strictEqual(r.agedTotals.d30, 0, 'nhóm 1–30 không nhận giấy báo có');
  assert.strictEqual(r.agedTotals.total, 0, 'Còn phải thu không âm');
  assert.strictEqual(r.agedTotals.credit, 1100000, 'phần chưa đối trừ hiện riêng');
  assert.strictEqual(ov.receivable, r.agedTotals.total);
  assert.strictEqual(ov.customerCredit, r.agedTotals.credit);
  assert.strictEqual(r.agedTotals.overdue, 0);
  assert.strictEqual(ov.overdue.sum, 0);
});

test('giấy báo có đối trừ hoá đơn mở cũ nhất trước, phần dư là credit chưa đối trừ', async () => {
  const { biz, cus, cus2 } = await setup();
  day = '2026-07-01';
  const oldest = post(biz, cus.id, 500000, { due_date: '2026-07-01' }); // 550.000, quá hạn lâu
  day = '2026-10-01';
  const newer = post(biz, cus.id, 1000000, { due_date: '2026-11-20' }); // 1.100.000, chưa đến hạn
  day = '2026-10-22';
  const paid = post(biz, cus.id, 2000000);
  biz.registerPayment(paid.id, {});
  const cn = biz.postInvoice(biz.creditNote(paid.id, {}).id); // 2.200.000 chưa đối trừ, hạn hôm qua
  assert.strictEqual(cn.residual, 2200000);
  const other = post(biz, cus2.id, 300000, { due_date: '2026-12-01' }); // 330.000, khách khác — không bị trừ
  day = '2026-10-23';
  const r = biz.invoiceReport({});
  const ov = biz.overview();
  const row = r.aged.find(x => x.partner_id === cus.id);
  nonNeg(r, 'đối trừ cũ nhất');
  // 2.200.000 trừ hoá đơn cũ 550.000 rồi hoá đơn mới 1.100.000; còn 550.000 chưa đối trừ
  assert.strictEqual(biz.getInvoice(oldest.id).residual, 550000, 'sổ không tự gạch hoá đơn khác — đối trừ nằm ở báo cáo');
  assert.strictEqual(row.older, 0);
  assert.strictEqual(row.d30, 0);
  assert.strictEqual(row.current, 0);
  assert.strictEqual(row.total, 0);
  assert.strictEqual(row.credit, 2200000 - 550000 - 1100000);
  assert.strictEqual(r.aged.find(x => x.partner_id === cus2.id).total, other.amount_total);
  assert.strictEqual(r.agedTotals.d30, 0);
  assert.strictEqual(r.agedTotals.total, other.amount_total, 'Còn phải thu = phần khách kia còn nợ, không âm');
  assert.strictEqual(r.agedTotals.credit, row.credit);
  assert.strictEqual(ov.receivable, r.agedTotals.total);
  assert.strictEqual(ov.customerCredit, r.agedTotals.credit);
  assert.strictEqual(['current', 'd30', 'd60', 'd90', 'older'].reduce((s, k) => s + r.agedTotals[k], 0), r.agedTotals.total);
});

test('KPI không gọi giấy báo có chưa đối trừ là đã trừ', () => {
  // credit giờ là phần CHƯA đối trừ. Nhãn cũ “đã trừ …” khiến KPI kiểu “Còn phải thu 330.000 · đã trừ 550.000”
  // trong khi 550.000 thuộc khách khác, không phải số đã trừ khỏi 330.000.
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/biz.js'), 'utf8');
  const kpiAt = src.indexOf('Còn phải thu<b>${vnd(a.total)}');
  assert.ok(kpiAt > 0);
  const kpi = src.slice(kpiAt, src.indexOf('Theo tháng', kpiAt));
  assert.match(kpi, /giấy báo có chưa đối trừ \$\{vnd\(a\.credit\)\}/);
  assert.doesNotMatch(kpi, /đã trừ/);
  assert.doesNotMatch(src, /đã trừ giấy báo có khách hàng/);
  const key = 'giấy báo có chưa đối trừ {0}';
  assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname, '../src/i18n/strings.json'), 'utf8')).includes(key));
  assert.strictEqual(require('../src/i18n/en.js')[key], 'unapplied credit note {0}');
  assert.strictEqual(require('../src/i18n/zh.js')[key], '未抵扣的贷项通知单 {0}');
});

test('hoá đơn đã đối trừ hết bằng giấy báo có không còn bị đánh quá hạn', async () => {
  const { biz, cus, cus2 } = await setup();
  day = '2026-07-01';
  const covered = post(biz, cus.id, 1000000, { due_date: '2026-07-15' }); // 1.100.000, quá hạn
  const paid = post(biz, cus.id, 1000000);
  biz.registerPayment(paid.id, {});
  biz.postInvoice(biz.creditNote(paid.id, {}).id); // 1.100.000 đối trừ hết hoá đơn quá hạn
  const still = post(biz, cus2.id, 400000, { due_date: '2026-08-01' }); // 440.000, khách khác, vẫn quá hạn
  const partial = post(biz, cus2.id, 1000000, { due_date: '2026-08-10' }); // 1.100.000
  day = '2026-08-20';
  const paid2 = post(biz, cus2.id, 500000);
  biz.registerPayment(paid2.id, {});
  biz.postInvoice(biz.creditNote(paid2.id, {}).id); // 550.000 chỉ trừ một phần hoá đơn 1.100.000
  day = '2026-10-23';
  assert.strictEqual(biz.getInvoice(covered.id).residual, 1100000, 'sổ không gạch hoá đơn khác');
  assert.strictEqual(biz.getInvoice(covered.id).overdue, false, 'đối trừ hết thì không còn quá hạn');
  const listed = biz.listInvoices({}).find(r => r.id === covered.id);
  assert.strictEqual(listed.overdue, false);
  // 550.000 trừ hoá đơn cũ nhất của khách kia (440.000) trước; phần còn lại không hết hoá đơn 1.100.000
  assert.strictEqual(biz.getInvoice(still.id).overdue, false, 'hoá đơn cũ nhất bị đối trừ hết thì không còn quá hạn');
  assert.strictEqual(biz.getInvoice(partial.id).overdue, true, 'chỉ đối trừ một phần thì hoá đơn quá hạn vẫn còn');
  const late = biz.listInvoices({ payment: 'overdue' });
  assert.ok(!late.some(r => r.id === covered.id || r.id === still.id));
  assert.ok(late.some(r => r.id === partial.id));
  assert.strictEqual(biz.overview().overdue.n, 1);
});

test('bảng tuổi nợ xuất ra có cột giấy báo có chưa đối trừ', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/biz.js'), 'utf8');
  assert.match(src, /B\.lastRows = \[\['Khách hàng', 'Chưa đến hạn', '1–30 ngày', '31–60 ngày', '61–90 ngày', 'Trên 90 ngày', 'Tổng', 'Giấy báo có chưa đối trừ'\], \.\.\.d\.aged\.map\(x => \[x\.partner_name, x\.current, x\.d30, x\.d60, x\.d90, x\.older, x\.total, x\.credit\]\)\]/);
  assert.match(src, /<th class="num">Giấy báo có chưa đối trừ<\/th>/);
});

test('R3-K1: doanh số theo tháng không phụ thuộc múi giờ máy', async () => {
  // 2026-09-30 18:00 UTC = 2026-10-01 01:00 tại Việt Nam (UTC+7), vẫn là 30/9 ở UTC và Los Angeles.
  // Máy UTC+7 gom đơn vào tháng 10; máy UTC/Mỹ gom vào tháng 9. Kỳ vọng cố định theo lịch Việt Nam.
  const stamp = Date.parse('2026-09-30T18:00:00.000Z');
  day = '2026-10-01';
  const { crm, biz, cus } = await setup(() => stamp);
  const ban = crm.saveProduct({ name: 'Bàn làm việc', sku: 'BAN-R3', price: 2000000, type: 'product' });
  biz.confirmOrder(crm.saveQuote({ contact_id: cus.id, lines: [{ product_id: ban.id, name: ban.name, unit: 'cái', qty: 2, price: ban.price }] }).id);
  const byMonth = biz.salesReport({ groupBy: 'month' });
  assert.deepStrictEqual(byMonth.rows.map(x => x.key), ['2026-10']);
  assert.strictEqual(byMonth.rows[0].untaxed, 4000000);
  assert.strictEqual(biz.salesReport({ from: '2026-10-01', to: '2026-10-01' }).rows.length, 1, 'đơn rơi đúng ngày 1/10 theo giờ Việt Nam');
  assert.strictEqual(biz.salesReport({ from: '2026-09-01', to: '2026-09-30' }).rows.length, 0);
  assert.strictEqual(biz.overview().salesMonth, 4000000);
});
