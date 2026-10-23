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

test('#38 báo cáo khớp chứng từ: phân tích mua hàng = tổng các đơn; công nợ phải trả = Σ còn phải trả của hoá đơn NCC − báo có NCC chưa đối trừ; “Đã trả” lọc theo ngày trả', async () => {
  day = '2026-09-10'; const { biz, ven, ban, ship, crm } = await setup();
  const ven2 = crm.saveContact({ name: 'Cơ sở Sắt Thép Hoà Phát', kind: 'company' });
  // tháng 9: đơn 2 bàn, nhận đủ, hoá đơn trả đủ
  let a = biz.confirmPurchase(biz.savePurchase({ partner_id: ven.id, lines: [{ product_id: ban.id, qty: 2, price: 1000000 }] }).id);
  biz.validatePicking(a.pickings[0].id); const ba = biz.postInvoice(biz.createBill(a.id).id); biz.registerPayment(ba.id, { amount: ba.amount_total });
  // tháng 10: đơn 10 @1.000.000 + vận chuyển 8%, nhận 6, hoá đơn, trả 2.000.000; NCC thứ hai trả chậm
  day = '2026-10-21';
  let b = biz.confirmPurchase(biz.savePurchase({ partner_id: ven.id, payment_days: 30, lines: [{ product_id: ban.id, qty: 10, price: 1000000 }, { product_id: ship.id, qty: 1, price: 500000 }] }).id);
  const pk = biz.getPicking(b.pickings[0].id); biz.setDone(pk.id, { [pk.moves[0].id]: 6 }); biz.validatePicking(pk.id);
  const bb = biz.postInvoice(biz.createBill(b.id).id); assert.strictEqual(bb.amount_total, 6 * 1100000 + 540000);
  biz.registerPayment(bb.id, { amount: 2000000 });
  let c = biz.confirmPurchase(biz.savePurchase({ partner_id: ven2.id, lines: [{ product_id: ban.id, qty: 1, price: 900000 }] }).id);
  biz.validatePicking(c.pickings[0].id); const bc = biz.postInvoice(biz.createBill(c.id).id);
  // phân tích mua hàng = cộng từ chứng từ
  const docs = [a, b, c].map(x => biz.getPurchase(x.id));
  const pr = biz.purchaseReport({});
  assert.strictEqual(pr.totals.orders, 3); assert.strictEqual(pr.totals.untaxed, docs.reduce((s, d) => s + d.subtotal, 0)); assert.strictEqual(pr.totals.total, docs.reduce((s, d) => s + d.total, 0));
  assert.strictEqual(pr.totals.received, docs.reduce((s, d) => s + d.lines.reduce((x, l) => x + l.qty_received, 0), 0)); assert.strictEqual(pr.totals.billed, docs.reduce((s, d) => s + d.lines.reduce((x, l) => x + l.qty_billed, 0), 0));
  for (const gb of ['vendor', 'product', 'category']) { const r = biz.purchaseReport({ groupBy: gb }); assert.strictEqual(r.rows.reduce((s, x) => s + x.untaxed, 0), pr.totals.untaxed, gb); }
  assert.strictEqual(biz.purchaseReport({ from: '2026-10-01', to: '2026-10-31' }).totals.untaxed, docs[1].subtotal + docs[2].subtotal);
  // công nợ phải trả = Σ residual của hoá đơn NCC, theo từng NCC; Tổng quan khớp
  const bills = biz.listInvoices({ scope: 'in' }).filter(i => i.state === 'posted');
  let ap = biz.payablesReport({}); const open = bills.filter(i => i.kind === 'in_invoice').reduce((s, i) => s + i.residual, 0);
  assert.strictEqual(open, bb.amount_total - 2000000 + bc.amount_total); assert.strictEqual(ap.agedTotals.total, open); assert.strictEqual(biz.overview().payable, open);
  assert.strictEqual(ap.aged.find(r => r.partner_id === ven.id).total, bb.amount_total - 2000000); assert.strictEqual(ap.aged.find(r => r.partner_id === ven2.id).total, bc.amount_total);
  assert.strictEqual(ap.totals.paid, ba.amount_total + 2000000);
  // lọc tháng 10: “Đã trả” chỉ tính tiền trả trong tháng 10 (trước đây cộng cả tiền trả tháng 9)
  const oct = biz.payablesReport({ from: '2026-10-01', to: '2026-10-31' });
  assert.strictEqual(oct.totals.paid, 2000000); assert.strictEqual(oct.totals.total, bb.amount_total + bc.amount_total);
  // báo có cho hoá đơn tháng 9 ĐÃ TRẢ ĐỦ → NCC nợ lại mình: công nợ phải trả của NCC đó giảm (như Odoo Aged Payable), Tổng quan khớp
  const rf = biz.postInvoice(biz.creditNote(ba.id, {}).id); assert.strictEqual(rf.residual, ba.amount_total);
  ap = biz.payablesReport({});
  assert.strictEqual(ap.aged.find(r => r.partner_id === ven.id).total, bb.amount_total - 2000000 - ba.amount_total); assert.strictEqual(ap.agedTotals.credit, ba.amount_total);
  assert.strictEqual(ap.agedTotals.total, open - ba.amount_total); assert.strictEqual(biz.overview().payable, ap.agedTotals.total); assert.strictEqual(biz.overview().vendorCredit, ba.amount_total);
  // NCC hoàn tiền → hết phần trừ
  biz.registerPayment(rf.id, { amount: ba.amount_total }); ap = biz.payablesReport({});
  assert.strictEqual(ap.agedTotals.total, open); assert.strictEqual(ap.agedTotals.credit, 0); assert.strictEqual(ap.totals.refunded, ba.amount_total);
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
  assert.strictEqual(V.memoOf('Hoá đơn INV/2026/00001 — Đặng'), 'Hoa don INV-2026-00001 Da', 'tối đa 25 ký tự, bỏ dấu, “/” → “-”, bỏ ký tự lạ (#40)');
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
  assert.strictEqual(p.crcOk, true); assert.strictEqual(p.amount, 1000000); assert.strictEqual(p.memo, inv.number.replace(/\//g, '-')); assert.match(qr.svg, /^<svg/);
  biz.registerPayment(inv.id, {}); assert.strictEqual(biz.invoiceQr(inv.id).ok, false, 'đã thu đủ thì không hiện QR');
});

test('Mẫu in A4: báo giá, hoá đơn (VietQR, thuế theo mức, bằng chữ), phiếu nhập, đơn mua — vi/en/zh; số tiền bằng chữ tiếng Anh và chữ Hán viết hoa', async () => {
  const P = require('../src/crm/print');
  assert.strictEqual(P.zhWords(20050000), '贰仟零伍万越南盾整'); assert.strictEqual(P.zhWords(1010), '壹仟零壹拾越南盾整'); assert.strictEqual(P.zhWords(1000000001), '壹拾亿零壹越南盾整');
  assert.strictEqual(P.enWords(3603999), 'Three million six hundred and three thousand nine hundred and ninety-nine Vietnamese dong');
  day = '2026-10-21'; const { crm, biz, ven, cus, ban, ship } = await setup();
  biz.saveCompany({ name: 'Công ty TNHH Giải pháp AIVN', tax_id: '0312345678', bank_bin: '970436', bank_account: '0011001234567', bank_holder: 'CONG TY TNHH GIAI PHAP AIVN', signer: 'Đặng Văn Khôi' });
  let inv = biz.saveInvoice({ partner_id: cus.id, lines: [{ name: 'Phần mềm <b>kế toán</b>', qty: 1, price: 12000000, vat_pct: 8 }, { product_id: ban.id, name: 'Bàn', qty: 2, price: 2500000, vat_pct: 10 }] });
  inv = biz.postInvoice(inv.id); biz.registerPayment(inv.id, { amount: 5000000 });
  const vi = P.renderDoc(biz, crm, 'invoice', inv.id, 'vi');
  assert.strictEqual(vi.name, 'INV-2026-00001.pdf');
  for (const s of ['HOÁ ĐƠN BÁN HÀNG', 'Hoá đơn bán hàng', 'Công ty TNHH Giải pháp AIVN', 'Thuế GTGT 8%', 'Thuế GTGT 10%', '960.000 ₫', '500.000 ₫', '18.460.000 ₫', 'Còn phải thu', '13.460.000 ₫', 'Mười tám triệu bốn trăm sáu mươi nghìn đồng', 'Người mua hàng', 'Người bán hàng', 'Đặng Văn Khôi', 'Nghị định 123/2020/NĐ-CP', '<svg', 'Đơn vị mua hàng'])
    assert.ok(vi.html.includes(s) || vi.html.toUpperCase().includes(s.toUpperCase()), 'thiếu: ' + s);
  assert.ok(!vi.html.includes('<b>kế toán</b>') && vi.html.includes('&lt;b&gt;kế toán&lt;/b&gt;'), 'tên dòng phải được thoát HTML');
  const en = P.renderDoc(biz, crm, 'invoice', inv.id, 'en').html;
  for (const s of ['Sales invoice', 'VAT 8%', '18,460,000 ₫', 'Eighteen million four hundred and sixty thousand Vietnamese dong', 'Tax ID', 'Amount due', 'Buyer']) assert.ok(en.includes(s), 'en thiếu: ' + s);
  const zh = P.renderDoc(biz, crm, 'invoice', inv.id, 'zh').html;
  for (const s of ['销售发票', '增值税 8%', '壹仟捌佰肆拾陆万越南盾整', '税号', '应收余额', '2026年10月21日']) assert.ok(zh.includes(s), 'zh thiếu: ' + s);
  // đơn mua + phiếu nhập + báo giá
  const po = biz.confirmPurchase(biz.savePurchase({ partner_id: ven.id, payment_days: 30, lines: [{ product_id: ban.id, qty: 10, price: 1000000 }, { product_id: ship.id, qty: 1, price: 500000 }] }).id);
  const ph = P.renderDoc(biz, crm, 'purchase', po.id, 'en').html; for (const s of ['Purchase order', 'P00001', '30 days', 'Vendor acceptance', 'Eleven million five hundred and forty thousand Vietnamese dong']) assert.ok(ph.includes(s), 'đơn mua thiếu: ' + s);
  const pk = P.renderDoc(biz, crm, 'picking', po.pickings[0].id, 'vi'); assert.strictEqual(pk.name, 'WH-IN-00001.pdf'); for (const s of ['Phiếu nhập kho', 'Thủ kho', 'Kế toán trưởng', 'BAN-01']) assert.ok(pk.html.includes(s), 'phiếu nhập thiếu: ' + s);
  assert.ok(P.renderDoc(biz, crm, 'picking', po.pickings[0].id, 'en').html.includes('Goods receipt'));
  const q = crm.saveQuote({ contact_id: cus.id, lines: [{ product_id: ban.id, name: 'Bàn', qty: 1, price: 2000000 }] });
  const qh = P.renderDoc(biz, crm, 'quote', q.id, 'vi').html; for (const s of ['Báo giá', 'Kính gửi', 'Khách hàng xác nhận', 'Thanh toán ngay']) assert.ok(qh.includes(s), 'báo giá thiếu: ' + s);
  assert.throws(() => P.describe(biz, crm, 'x', 'y'), /không hỗ trợ/);
});

// Giao diện thật (Electron + xvfb), vi/en/zh: Cài đặt › Công ty → RFQ → đơn mua → nhận 6/10 → hoá đơn NCC → trả một phần → báo cáo → hoá đơn 8% + 10% có VietQR → PDF
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron'));
const USER_DATA = new Set([]); // đơn vị tính nay dịch theo ngôn ngữ (cái → Units/件, chuyến → Trips/趟, gói → Packs/包)
for (const lang of ['vi', 'en', 'zh']) {
  test(`Mua hàng + công ty + VietQR + PDF — giao diện thật (${lang})`, { skip: !hasX && 'cần xvfb-run + electron' }, () => {
    const dir = process.env.AIVN_QA_SHOTS ? path.join(process.env.AIVN_QA_SHOTS) : fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qapo-'));
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qapo-ud-'));
    const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_PURCHASE: dir, AIVN_QA_BIZ_LANG: lang, AIVN_QA_PDF_DIR: path.join(dir, 'pdf') });
    const r = spawnSync('timeout', ['300', 'xvfb-run', '-a', '-s', '-screen 0 1366x900x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: ROOT, encoding: 'utf8', env });
    const f = path.join(dir, `qapurchase-${lang}.json`); assert.ok(fs.existsSync(f), 'QA Mua hàng không chạy xong: ' + (r.stderr || '').slice(-800));
    const d = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!d.error, d.error); assert.deepStrictEqual(d.errs, []);
    for (const [k, s] of Object.entries(d.steps)) { assert.ok(!s.error, k + ': ' + s.error); assert.strictEqual(s.err || '', '', k); assert.deepStrictEqual((s.leftover || []).filter(t => !USER_DATA.has(t)), [], `${k}: còn tiếng Việt chưa dịch`); }
    assert.strictEqual(d.company.qr_ready, true); assert.ok(d.company.logo > 1000 && d.company.logo < 400 * 1024, 'logo đã thu nhỏ và lưu');
    // nghiệm thu: nhận 6/10 → tồn 6, chờ nhập 4, giá vốn 1.000.000; hoá đơn NCC 6 bàn + vận chuyển; trả 2.000.000 → còn 5.140.000
    assert.deepStrictEqual(d.stock, [{ name: 'Bàn làm việc gỗ sồi', on_hand: 6, incoming: 4, cost: 1000000 }]);
    assert.match(d.bill.number, /^BILL\/\d{4}\/\d{2}\/0001$/);
    assert.strictEqual(d.payable.agedTotals.total, 5140000); assert.strictEqual(d.overview.payable, 5140000); assert.strictEqual(d.overview.poToReceive, 1);
    assert.strictEqual(d.inv.qr, true);
    // #40: ảnh chụp màn hình và PDF hoá đơn giải mã (zbar) ra CÙNG một chuỗi VietQR: số tiền = còn phải thu 18.460.000, nội dung = số hoá đơn
    if (spawnSync('which', ['zbarimg']).status === 0 && spawnSync('which', ['pdftoppm']).status === 0) {
      const zb = (png) => spawnSync('zbarimg', ['--raw', '-q', '-Sdisable', '-Sqrcode.enable', png], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
      const scr = zb(path.join(dir, `${lang}-22-hoa-don-vietqr.png`)); assert.strictEqual(scr.length, 1, 'màn hình: đúng một mã QR');
      assert.match(scr[0], /^00020101021238570010A00000072701270006970436011300110012345670208QRIBFTTA53037045408184600005802VN62180814INV-\d{4}-000016304[0-9A-F]{4}$/);
      const pdfPng = path.join(dir, `${lang}-hoa-don-pdf`); assert.strictEqual(spawnSync('pdftoppm', ['-r', '150', '-png', '-singlefile', path.join(dir, 'pdf', `${lang}-INV-${d.inv.number.slice(4, 8)}-00001.pdf`), pdfPng]).status, 0);
      assert.deepStrictEqual(zb(pdfPng + '.png'), scr, 'PDF: cùng mã với màn hình');
    }
    assert.match(d.inv.qrText, { vi: /Số tiền: 18\.460\.000 ₫ · Nội dung: INV-\d{4}-00001/, en: /Amount: 18,460,000 ₫ · Memo: INV-\d{4}-00001/, zh: /金额： 18,460,000 ₫ · 备注： INV-\d{4}-00001/ }[lang]);
    // B73: “6,5” (vi) / “6.5” (en) / “６.５” (zh) = 6,5; ô điền sẵn không sửa → không đổi tồn; 1,125 không thành 1125
    assert.deepStrictEqual([d.b73.typed.on_hand, d.b73.same.on_hand, d.b73.three.on_hand], [6.5, 6.5, 1.125]);
    assert.strictEqual(d.b73.three.shown, { vi: '1,125', en: '1.125', zh: '1.125' }[lang]);
    assert.strictEqual(d.units[0], { vi: '1,125 cái', en: '1.125 Units', zh: '1.125 件' }[lang]);
    assert.deepStrictEqual(d.pdfs.filter(f => f.startsWith(lang + '-')).sort(), [`${lang}-INV-${d.inv.number.slice(4, 8)}-00001.pdf`, `${lang}-P00001.pdf`, `${lang}-WH-IN-00001.pdf`].sort());
    const money = { vi: (s) => s.replace(/,/g, '.'), en: (s) => s, zh: (s) => s }[lang];
    assert.match(d.po.taxes.join(' | '), new RegExp(money('40,000 ₫').replace('.', '\\.'))); assert.match(d.inv.totals.at(-1), new RegExp(money('18,460,000 ₫').replace(/\./g, '\\.')));
    assert.match(d.bill.due.at(-1), new RegExp(money('5,140,000 ₫').replace(/\./g, '\\.')));
    if (lang === 'vi') { assert.strictEqual(d.bill.ribbon, 'THANH TOÁN MỘT PHẦN'); assert.deepStrictEqual(d.poAfterReceipt.badges, ['Nhận một phần', 'Chờ hoá đơn']); assert.match(d.inv.qrText, /Nội dung: INV-\d{4}-00001/); }
    if (lang === 'en') { assert.strictEqual(d.bill.ribbon, 'PARTIALLY PAID'); assert.deepStrictEqual(d.poAfterReceipt.badges, ['Partially received', 'To bill']); assert.match(d.invDraft.join(' | '), /VAT 8% on 12,000,000 ₫ 960,000 ₫/); }
    if (lang === 'zh') assert.deepStrictEqual(d.poAfterReceipt.badges, ['部分收货', '待收账单']);
    // PDF: chữ có dấu tiếng Việt trích ra được (phông nhúng đúng)
    if (spawnSync('which', ['pdftotext']).status === 0) {
      const txt = spawnSync('pdftotext', ['-layout', path.join(dir, 'pdf', `${lang}-P00001.pdf`), '-'], { encoding: 'utf8' }).stdout;
      assert.match(txt, /Công ty TNHH Giải pháp AIVN/i); assert.match(txt, /Bàn làm việc gỗ sồi/); assert.match(txt, /Đặng Văn Khôi/);
      if (lang === 'vi') { assert.match(txt, /ĐƠN MUA HÀNG/); assert.match(txt, /Mười một triệu năm trăm bốn mươi nghìn đồng/); }
      if (lang === 'en') assert.match(txt, /Eleven million five hundred and forty thousand Vietnamese dong/);
      if (lang === 'zh') assert.match(txt, /壹仟壹佰伍拾肆万越南盾整/);
    }
  });
}
