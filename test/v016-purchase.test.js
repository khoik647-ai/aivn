'use strict';
// 0.16 Kinh doanh P0/P1: Mua hàng (RFQ → đơn mua → nhận hàng → hoá đơn NCC → trả tiền → công nợ phải trả), thuế GTGT theo dòng,
// thông tin công ty, VietQR (NAPAS EMVCo) + bộ mã QR tự viết
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');
const TAX = require('../src/crm/tax'); const V = require('../src/crm/vietqr'); const QR = require('../src/crm/qr');
let day = '2026-10-21';
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-po-')), 'crm.db');
async function setup(file) {
  const db = await openDb(file || tmp());
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => day });
  const ven = crm.saveContact({ name: 'Công ty Gỗ Bình Dương', kind: 'company', tax_id: '3701234567' });
  const cus = crm.saveContact({ name: 'Công ty An Phát', kind: 'company', tax_id: '0312345678' });
  const ban = crm.saveProduct({ name: 'Bàn làm việc', sku: 'BAN-01', price: 2000000, cost: 0, type: 'product', unit: 'cái' });
  const ship = crm.saveProduct({ name: 'Vận chuyển', price: 300000, type: 'service', vat_pct: 8 });
  return { db, crm, biz, ven, cus, ban, ship };
}
const cost = (crm, p) => crm.listProducts({}).find(x => x.id === p.id).cost;

test('Mua hàng (nghiệm thu): đơn 10 × 1.000.000, nhận 6 → tồn +6, phiếu chờ 4, giá vốn AVCO; hoá đơn NCC lấy 6; trả một phần → còn phải trả đúng', async () => {
  day = '2026-10-21'; const { crm, biz, ven, ban } = await setup();
  // tồn sẵn 4 cái giá vốn 1.500.000 để kiểm AVCO
  const r0 = biz.createReceipt({ lines: [{ product_id: ban.id, qty: 4, unit_cost: '1.500.000' }] }); biz.validatePicking(r0.id);
  assert.strictEqual(cost(crm, ban), 1500000);
  assert.throws(() => biz.savePurchase({ lines: [] }), /nhà cung cấp/);
  let po = biz.savePurchase({ partner_id: ven.id, partner_ref: 'BG-778', payment_days: 30, lines: [{ product_id: ban.id, qty: '10', price: '1.000.000' }] });
  assert.match(po.number, /^P00001$/); assert.strictEqual(po.state, 'draft'); assert.strictEqual(po.state_vi, 'Yêu cầu báo giá');
  assert.strictEqual(po.subtotal, 10000000); assert.strictEqual(po.vat, 1000000); assert.strictEqual(po.total, 11000000);
  assert.strictEqual(po.receipt_status, 'none'); assert.strictEqual(po.invoice_status, 'no');
  assert.strictEqual(biz.listPurchases({ kind: 'rfq' }).length, 1);
  assert.throws(() => biz.createBill(po.id), /đã xác nhận/);
  po = biz.sendRfq(po.id); assert.strictEqual(po.state, 'sent');
  po = biz.confirmPurchase(po.id); assert.strictEqual(po.state, 'purchase'); assert.strictEqual(po.receipt_status, 'pending');
  assert.throws(() => biz.confirmPurchase(po.id), /đã được xác nhận/);
  assert.throws(() => biz.savePurchase({ id: po.id, lines: [] }), /không sửa dòng/);
  assert.strictEqual(po.pickings.length, 1); const pk = biz.getPicking(po.pickings[0].id);
  assert.match(pk.number, /^WH\/IN\//); assert.strictEqual(pk.origin, 'P00001'); assert.strictEqual(pk.po_id, po.id);
  assert.throws(() => biz.createBill(po.id), /nhận/, 'hàng lưu kho: chưa nhận thì chưa có gì để lập hoá đơn');
  // không nhận vượt số đặt
  assert.throws(() => { biz.setDone(pk.id, { [pk.moves[0].id]: 11 }); biz.validatePicking(pk.id); }, (e) => e.code === 'over');
  biz.setDone(pk.id, { [pk.moves[0].id]: 6 }); const v = biz.validatePicking(pk.id);
  assert.strictEqual(biz.onHand(ban.id), 10, '4 + 6');
  assert.strictEqual(cost(crm, ban), 1200000, 'AVCO (4 × 1.500.000 + 6 × 1.000.000) / 10');
  po = biz.getPurchase(po.id); assert.strictEqual(po.receipt_status, 'partial'); assert.strictEqual(po.lines[0].qty_received, 6);
  const bo = po.pickings.find(p => p.state === 'ready'); assert.ok(bo, 'có phiếu chờ'); assert.strictEqual(biz.getPicking(bo.id).moves[0].qty, 4); assert.strictEqual(bo.po_id, po.id);
  assert.ok(v.backorder_id || po.pickings.length === 2);
  assert.strictEqual(po.invoice_status, 'to_invoice'); assert.strictEqual(biz.listPurchases({ kind: 'toreceive' }).length, 1); assert.strictEqual(biz.listPurchases({ kind: 'tobill' }).length, 1);
  // hoá đơn NCC theo số đã nhận
  let bill = biz.createBill(po.id);
  assert.strictEqual(bill.kind, 'in_invoice'); assert.strictEqual(bill.lines.length, 1); assert.strictEqual(bill.lines[0].qty, 6);
  assert.strictEqual(bill.amount_untaxed, 6000000); assert.strictEqual(bill.amount_tax, 600000); assert.strictEqual(bill.amount_total, 6600000); assert.strictEqual(bill.ref, 'BG-778');
  assert.throws(() => biz.createBill(po.id), /Không còn|nhận/, 'không lập trùng');
  // 3 bên: sửa hoá đơn thành 7 > đã nhận 6 → chặn, trừ khi xác nhận
  biz.saveInvoice({ id: bill.id, lines: bill.lines.map(l => ({ ...l, qty: 7 })) });
  assert.throws(() => biz.postInvoice(bill.id), (e) => e.code === 'over_bill' && /đã nhận 6/.test(e.message));
  biz.saveInvoice({ id: bill.id, lines: bill.lines.map(l => ({ ...l, qty: 6 })) });
  bill = biz.postInvoice(bill.id);
  assert.match(bill.number, /^BILL\/2026\/10\/0001$/); assert.strictEqual(bill.due_date, '2026-11-20'); assert.strictEqual(bill.po_number, 'P00001');
  assert.ok(!biz.listInvoices({}).some(i => i.id === bill.id), 'hoá đơn NCC không lẫn vào hoá đơn bán');
  assert.ok(biz.listInvoices({ scope: 'in' }).some(i => i.id === bill.id));
  po = biz.getPurchase(po.id); assert.strictEqual(po.invoice_status, 'invoiced', 'đã lập đủ phần đã nhận (Odoo: Fully Billed)'); assert.strictEqual(po.lines[0].qty_billed, 6); assert.strictEqual(po.bill_payment, 'not_paid');
  // trả một phần
  assert.throws(() => biz.registerPayment(bill.id, { amount: 7000000 }), /lớn hơn số còn phải trả/);
  bill = biz.registerPayment(bill.id, { amount: '2.000.000', method: 'bank' });
  assert.strictEqual(bill.residual, 4600000); assert.strictEqual(bill.payment_state, 'partial');
  const ap = biz.payablesReport({}); assert.strictEqual(ap.agedTotals.total, 4600000); assert.strictEqual(ap.aged[0].partner_name, 'Công ty Gỗ Bình Dương');
  assert.strictEqual(ap.totals.total, 6600000); assert.strictEqual(ap.totals.paid, 2000000);
  const ov = biz.overview(); assert.strictEqual(ov.payable, 4600000); assert.strictEqual(ov.receivable, 0, 'công nợ phải trả không tính vào phải thu'); assert.strictEqual(ov.poToReceive, 1);
  assert.strictEqual(biz.invoiceReport({}).totals.total, 0, 'báo cáo hoá đơn bán không tính hoá đơn NCC');
  assert.strictEqual(biz.getPurchase(po.id).bill_payment, 'partial');
  // nhận nốt 4 → chờ hoá đơn 4; huỷ đơn bị chặn vì đã nhận
  biz.validatePicking(bo.id); po = biz.getPurchase(po.id); assert.strictEqual(po.receipt_status, 'full'); assert.strictEqual(po.lines[0].qty_to_bill, 4);
  assert.strictEqual(biz.onHand(ban.id), 14); assert.strictEqual(cost(crm, ban), Math.round((10 * 1200000 + 4 * 1000000) / 14));
  assert.throws(() => biz.cancelPurchase(po.id), /đã nhận hàng/);
  const b2 = biz.postInvoice(biz.createBill(po.id).id); assert.match(b2.number, /^BILL\/2026\/10\/0002$/);
  po = biz.getPurchase(po.id); assert.strictEqual(po.invoice_status, 'invoiced');
  assert.strictEqual(biz.lockPurchase(po.id).state, 'done'); assert.strictEqual(biz.lockPurchase(po.id, false).state, 'purchase');
  // giấy báo có NCC 1 phần → còn phải trả giảm
  const rb = biz.creditNote(b2.id, { reason: 'Hàng lỗi' }); assert.strictEqual(rb.kind, 'in_refund');
  const rbp = biz.postInvoice(rb.id); assert.match(rbp.number, /^RBILL\/2026\/10\/0001$/);
  assert.strictEqual(biz.getInvoice(b2.id).residual, 0);
});

test('Mua hàng: dịch vụ lập hoá đơn theo số đã đặt; huỷ đơn chưa nhận huỷ luôn phiếu nhập; đặt lại nháp; xoá RFQ', async () => {
  day = '2026-10-21'; const { biz, ven, ban, ship } = await setup();
  let po = biz.confirmPurchase(biz.savePurchase({ partner_id: ven.id, lines: [{ product_id: ban.id, qty: 2, price: 1000000 }, { product_id: ship.id, qty: 1, price: 500000 }] }).id);
  assert.strictEqual(po.pickings.length, 1); assert.strictEqual(biz.getPicking(po.pickings[0].id).moves.length, 1, 'dịch vụ không vào phiếu nhập');
  assert.strictEqual(po.lines[1].vat_pct, 8, 'thuế theo sản phẩm'); assert.deepStrictEqual(po.tax_groups.map(g => [g.rate, g.base, g.tax]), [[8, 500000, 40000], [10, 2000000, 200000]]);
  const bill = biz.createBill(po.id); assert.deepStrictEqual(bill.lines.map(l => l.qty), [1]); biz.deleteInvoice(bill.id);
  po = biz.cancelPurchase(po.id); assert.strictEqual(po.state, 'cancel'); assert.strictEqual(biz.getPicking(po.pickings[0].id).state, 'cancel');
  po = biz.resetPurchase(po.id); assert.strictEqual(po.state, 'draft');
  assert.strictEqual(biz.deletePurchase(po.id), true); assert.strictEqual(biz.listPurchases({}).length, 0);
  assert.throws(() => biz.savePurchase({ partner_id: ven.id, lines: [{ product_id: ban.id, qty: 'mười' }] }), /không phải là số/);
  assert.throws(() => biz.savePurchase({ partner_id: ven.id, lines: [{ product_id: ban.id, qty: 1, vat_pct: 7 }] }), /7/);
  assert.throws(() => biz.savePurchase({ partner_id: ven.id, date_order: '2026-10-21', date_planned: '2026-10-01', lines: [] }), /Ngày nhận/);
});

test('Thuế GTGT theo dòng: hoá đơn có dòng 8% và 10% tách thuế theo mức, làm tròn từng dòng như Odoo; CSDL cũ giữ nguyên tổng', async () => {
  // làm tròn từng dòng vs gộp (Odoo round_per_line / round_globally)
  const lines = [{ qty: 1, price: 105, vat_pct: 5 }, { qty: 1, price: 105, vat_pct: 5 }]; // 5,25 + 5,25
  assert.strictEqual(TAX.totals(lines, 'line').amount_tax, 10); assert.strictEqual(TAX.totals(lines, 'global').amount_tax, 11);
  assert.throws(() => TAX.vatOf(7), /7/); assert.strictEqual(TAX.vatOf(''), 10); assert.strictEqual(TAX.vatOf('8'), 8);
  day = '2026-10-21'; const file = tmp(); const { db, crm, biz, cus, ban, ship } = await setup(file);
  const inv = biz.saveInvoice({ partner_id: cus.id, lines: [{ name: 'Phần mềm', qty: 3, price: 333333, vat_pct: 8 }, { product_id: ban.id, name: 'Bàn', qty: 1, price: 2000000 }, { product_id: ship.id, name: 'Vận chuyển', qty: 1, price: 300000 }] });
  assert.deepStrictEqual(inv.tax_groups.map(g => [g.rate, g.base, g.tax]), [[8, 1299999, 104000], [10, 2000000, 200000]]);
  assert.strictEqual(inv.amount_tax, 304000); assert.strictEqual(inv.amount_total, 3603999);
  // báo giá cũng theo dòng
  const q = crm.saveQuote({ contact_id: cus.id, lines: [{ product_id: ban.id, name: 'Bàn', qty: 1, price: 2000000 }, { product_id: ship.id, name: 'Vận chuyển', qty: 1, price: 300000 }] });
  assert.strictEqual(q.vat, 224000);
  // CSDL 0.15: một mức thuế cho cả chứng từ, không có cột thuế theo dòng → nâng cấp không đổi tổng
  db.run('UPDATE invoice_lines SET vat_pct = NULL'); db.run('UPDATE quote_lines SET vat_pct = NULL'); db.run('UPDATE invoices SET tax_rounding = NULL, vat_pct = 10'); db.run('UPDATE quotes SET tax_rounding = NULL, vat_pct = 10');
  const before = { inv: 999999 + 2000000 + 300000, invTax: Math.round((999999 + 2000000 + 300000) * 0.1) };
  db.run('UPDATE invoices SET amount_untaxed = ?, amount_tax = ?, amount_total = ?', [before.inv, before.invTax, before.inv + before.invTax]);
  db.run("UPDATE meta SET value = '2' WHERE key = 'schema'");
  db.flushSync(); db.close();
  const db2 = await openDb(file); const crm2 = createCrm({ db: db2 }); const biz2 = createBiz({ db: db2, crm: crm2, today: () => day });
  const i2 = biz2.saveInvoice({ id: inv.id, notes: 'tính lại sau nâng cấp' }); assert.strictEqual(i2.amount_untaxed, before.inv); assert.strictEqual(i2.amount_tax, before.invTax, 'giữ nguyên tổng cũ (làm tròn gộp)');
  assert.deepStrictEqual(i2.tax_groups.map(g => [g.rate, g.tax]), [[10, 330000]]); assert.strictEqual(i2.amount_total, 3629999); assert.strictEqual(db2.get("SELECT value FROM meta WHERE key = 'schema'").value, '3');
  assert.strictEqual(crm2.getQuote(q.id).vat, 230000);
  db2.close();
});

test('VietQR: chuỗi đúng chuẩn NAPAS (khớp mẫu công khai từng byte), CRC16, nội dung không dấu; mã QR tự viết khớp thư viện chuẩn', () => {
  assert.strictEqual(V.crc16('123456789'), '29B1');
  const sample = '00020101021238540010A00000072701240006970423011001234567890208QRIBFTTA530370454061500005802VN62120808DH123456630479AB';
  assert.strictEqual(V.build({ bin: '970423', account: '0123456789', amount: 150000, memo: 'DH123456' }), sample);
  const vcb = '00020101021238570010A00000072701270006970436011300110012345670208QRIBFTTA53037045405500005802VN62270823Thanh toan don hang 123630441DF';
  assert.strictEqual(V.build({ bin: '970436', account: '0011001234567', amount: 50000, memo: 'Thanh toán đơn hàng 123' }), vcb);
  const p = V.parse(vcb); assert.strictEqual(p.crcOk, true); assert.strictEqual(p.amount, 50000); assert.strictEqual(p.bin, '970436');
  assert.strictEqual(V.parse(vcb.slice(0, -1) + 'E').crcOk, false);
  assert.ok(V.build({ bin: '970436', account: '0011001234567' }).startsWith('000201010211'), 'mã tĩnh không có số tiền');
  assert.strictEqual(V.memoOf('Hoá đơn INV/2026/00001 — Đặng'), 'Hoa don INV/2026/00001 Da', 'tối đa 25 ký tự, bỏ dấu và ký tự lạ');
  const h = (q) => crypto.createHash('sha256').update(Array.from({ length: q.size }, (_, y) => Array.from({ length: q.size }, (_, x) => q.modules[y][x] ? '1' : '0').join('')).join('\n')).digest('hex');
  // tham chiếu: python-qrcode (border 0) cùng mức sửa lỗi và mặt nạ
  const ref = [[vcb, 'M', 3, 8, '5f5ae67dcce14f0d21bebda22800528c6325350642fe4b8e29ddea6c4caa0b14'], ['AIVN · Hoá đơn INV/2026/00001', 'Q', 5, 4, '59870d7f7b09f9e4e3df7f4dd5dc8f8a2f3e4564fc5e4311b009c129c64d5cdc'],
    ['x'.repeat(300), 'L', 7, 11, '44874a4f4cac40c63df9b231d344abff708ea94b653588a55274007d68a27e12'], ['HELLO', 'H', 1, 1, '20145244cc491b940daa8adaece2b88bd8d54edc5e67dd45fa17cf2b0f77fdc7']];
  for (const [t, ecl, mask, ver, hex] of ref) { const q = QR.encode(t, { ecl, mask }); assert.strictEqual(q.version, ver, t.slice(0, 20)); assert.strictEqual(h(q), hex, t.slice(0, 20)); }
  assert.match(QR.toSvg(QR.encode(vcb)), /^<svg[^>]+viewBox="0 0 57 57"/);
});

test('Công ty: lưu MST, ngân hàng, logo; kiểm tra dữ liệu; mã VietQR của hoá đơn = số còn phải thu, nội dung = số hoá đơn', async () => {
  day = '2026-10-21'; const { biz, cus } = await setup();
  assert.strictEqual(biz.getCompany().qr_ready, false);
  assert.throws(() => biz.saveCompany({ name: 'AIVN', tax_id: '12345' }), /MST|mã số thuế/i);
  assert.throws(() => biz.saveCompany({ name: 'AIVN', bank_bin: '999999', bank_account: '123456' }), /ngân hàng/i);
  assert.throws(() => biz.saveCompany({ name: 'AIVN', logo: 'data:text/html;base64,PGI+' }), /logo|ảnh/i);
  const c = biz.saveCompany({ name: 'Công ty TNHH AIVN', tax_id: '0312345678', address: '12 Lê Lợi, Quận 1, TP. Hồ Chí Minh', bank_bin: '970436', bank_account: '0011 0012 34567', bank_holder: 'CONG TY TNHH AIVN', default_vat: 8 });
  assert.strictEqual(c.bank_account, '0011001234567'); assert.strictEqual(c.bank_code, 'VCB'); assert.strictEqual(c.qr_ready, true); assert.strictEqual(biz.getCompany().default_vat, 8);
  assert.ok(biz.companyQr().ok); assert.strictEqual(V.parse(biz.companyQr().payload).account, '0011001234567');
  let inv = biz.saveInvoice({ partner_id: cus.id, lines: [{ name: 'Tư vấn', qty: 1, price: 1000000, vat_pct: 10 }] });
  assert.strictEqual(biz.invoiceQr(inv.id).ok, false, 'nháp chưa có QR');
  inv = biz.postInvoice(inv.id); biz.registerPayment(inv.id, { amount: 100000 });
  const qr = biz.invoiceQr(inv.id); assert.strictEqual(qr.ok, true); const p = V.parse(qr.payload);
  assert.strictEqual(p.crcOk, true); assert.strictEqual(p.amount, 1000000); assert.strictEqual(p.memo, inv.number); assert.match(qr.svg, /^<svg/);
  biz.registerPayment(inv.id, {}); assert.strictEqual(biz.invoiceQr(inv.id).ok, false, 'đã thu đủ thì không hiện QR');
});
