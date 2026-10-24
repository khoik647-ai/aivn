'use strict';
// Quá hạn phải theo ngày dân sự Việt Nam (UTC+7) của đồng hồ nghiệp vụ `now`, không theo múi giờ máy
// và không theo Date.now() khi `now` đã được ghim.
// 2026-10-24T18:30:00Z = 2026-10-25 01:30 tại Việt Nam, vẫn là 2026-10-24 ở UTC và Los Angeles.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');

const STAMP = Date.parse('2026-10-24T18:30:00.000Z');
const VN_TODAY = '2026-10-25';

async function setup() {
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-odtz-')), 'crm.db'));
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' });
  // Không truyền today: hạn quá hạn phải tự lấy từ `now` qua UTC+7.
  const biz = createBiz({ db, crm, now: () => STAMP });
  const cus = crm.saveContact({ name: 'Công ty An Phát', kind: 'company' });
  return { biz, cus };
}
const post = (biz, partner_id, price, extra) => biz.postInvoice(biz.saveInvoice({ partner_id, lines: [{ name: 'Bàn làm việc', unit: 'cái', qty: 1, price }], invoice_date: '2026-10-01', ...extra }).id);

test('quá hạn theo ngày Việt Nam của đồng hồ đã ghim, không theo múi giờ máy', async () => {
  const { biz, cus } = await setup();
  const late = post(biz, cus.id, 1000000, { due_date: '2026-10-24' }); // trước ngày VN 2026-10-25
  const dueToday = post(biz, cus.id, 500000, { due_date: VN_TODAY });
  assert.strictEqual(late.due_date, '2026-10-24');
  assert.strictEqual(dueToday.due_date, VN_TODAY);

  assert.strictEqual(biz.getInvoice(late.id).overdue, true, 'hạn 2026-10-24 là quá hạn khi hôm nay theo giờ Việt Nam là 2026-10-25');
  assert.strictEqual(biz.getInvoice(dueToday.id).overdue, false, 'hạn đúng ngày Việt Nam thì chưa quá hạn');

  const tab = biz.listInvoices({ payment: 'overdue' });
  assert.deepStrictEqual(tab.map(r => r.id), [late.id], 'tab Quá hạn chỉ gồm hoá đơn hạn 2026-10-24');
  assert.ok(tab.every(r => r.kind === 'out_invoice' && r.overdue));
  const ov = biz.overview();
  const report = biz.invoiceReport({});
  assert.strictEqual(ov.overdue.n, 1);
  assert.strictEqual(ov.overdue.n, tab.length, 'số đếm KPI quá hạn khớp tab');
  assert.strictEqual(ov.overdue.sum, late.residual);
  assert.strictEqual(report.agedTotals.overdue, ov.overdue.sum, 'KPI báo cáo khớp Tổng quan');
  assert.strictEqual(report.aged.find(r => r.partner_id === cus.id).d30, late.residual, 'hạn hôm qua rơi vào nhóm 1–30, không phải chưa đến hạn');
  assert.strictEqual(report.aged.find(r => r.partner_id === cus.id).current, dueToday.residual);
});
