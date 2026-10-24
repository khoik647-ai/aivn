'use strict';
// Giấy báo có quá hạn không được lọt vào tab/danh sách/số đếm «Quá hạn».
// Trên 4a0d6a1, pubInvoice gắn overdue cho mọi chứng từ posted còn residual và quá hạn,
// listInvoices({ payment: 'overdue' }) không lọc kind === 'out_invoice'.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');

let day = '2026-07-01';
async function setup() {
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-od-')), 'crm.db'));
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' });
  const biz = createBiz({ db, crm, today: () => day, now: () => Date.parse(day + 'T04:00:00Z') });
  const cus = crm.saveContact({ name: 'Công ty An Phát', kind: 'company' });
  const cus2 = crm.saveContact({ name: 'Cửa hàng Minh Châu', kind: 'company' });
  return { biz, cus, cus2 };
}
const line = (price) => ({ name: 'Bàn làm việc', unit: 'cái', qty: 1, price });
const post = (biz, partner_id, price, extra = {}) => biz.postInvoice(biz.saveInvoice({ partner_id, lines: [line(price)], ...extra }).id);

test('giấy báo có quá hạn không vào tab Quá hạn; hoá đơn quá hạn và hoá đơn chỉ đối trừ một phần vẫn vào', async () => {
  const { biz, cus, cus2 } = await setup();
  day = '2026-07-01';
  const paid = post(biz, cus.id, 1000000);
  biz.registerPayment(paid.id, {});
  const cn = biz.postInvoice(biz.creditNote(paid.id, {}).id); // 1.100.000, hạn 2026-07-01, không có hoá đơn mở để đối trừ
  assert.strictEqual(cn.kind, 'out_refund');
  assert.strictEqual(cn.residual, 1100000);
  assert.ok(cn.due_date < '2026-10-23');

  const real = post(biz, cus2.id, 400000, { due_date: '2026-08-01' }); // 440.000, quá hạn thật
  const partial = post(biz, cus2.id, 1000000, { due_date: '2026-08-10' }); // 1.100.000
  day = '2026-08-20';
  const paid2 = post(biz, cus2.id, 200000);
  biz.registerPayment(paid2.id, {});
  const cn2 = biz.postInvoice(biz.creditNote(paid2.id, {}).id); // 220.000 trừ một phần hoá đơn cũ nhất
  day = '2026-10-23';

  assert.strictEqual(biz.getInvoice(cn.id).overdue, false, 'giấy báo có không mang cờ quá hạn');
  assert.strictEqual(biz.getInvoice(cn2.id).overdue, false);
  assert.strictEqual(biz.getInvoice(real.id).overdue, true, 'hoá đơn quá hạn thật vẫn quá hạn');
  assert.strictEqual(biz.getInvoice(partial.id).overdue, true, 'đối trừ một phần thì hoá đơn quá hạn vẫn còn');

  const late = biz.listInvoices({ payment: 'overdue' });
  assert.ok(late.every(r => r.kind === 'out_invoice'), 'tab Quá hạn chỉ có hoá đơn');
  assert.ok(!late.some(r => r.id === cn.id || r.id === cn2.id), 'giấy báo có không xuất hiện trong danh sách quá hạn');
  assert.ok(late.some(r => r.id === real.id));
  assert.ok(late.some(r => r.id === partial.id));
  assert.strictEqual(late.length, 2);
  assert.strictEqual(biz.overview().overdue.n, late.length, 'số đếm quá hạn khớp tab, không cộng giấy báo có');
  assert.strictEqual(biz.overview().overdue.n, 2);
});
