'use strict';
// 0.16 bộ Kinh doanh theo Odoo: báo giá → đơn bán → giao hàng (kho) → hoá đơn → thanh toán / giấy báo có → báo cáo
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');
let day = '2026-10-21';
async function setup(file) {
  const db = await openDb(file || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-biz-')), 'crm.db'));
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => day });
  const cus = crm.saveContact({ name: 'Công ty An Phát', kind: 'company', tax_id: '0312345678' });
  const ban = crm.saveProduct({ name: 'Bàn làm việc', sku: 'BAN-01', price: 2000000, cost: 1200000, type: 'product', unit: 'cái' });
  const ghe = crm.saveProduct({ name: 'Ghế xoay', sku: 'GHE-01', price: 800000, type: 'product' });
  const lap = crm.saveProduct({ name: 'Lắp đặt', price: 300000, type: 'service' });
  return { db, crm, biz, cus, ban, ghe, lap };
}
const leads = (crm) => { const r = crm.listLeads({}); return Array.isArray(r) ? r : r.rows; };
const L = (p, qty, extra = {}) => ({ product_id: p.id, name: p.name, unit: p.unit, qty, price: p.price, ...extra });

test('Kho: nhập kho cộng tồn và tính giá vốn bình quân; kiểm kê tạo điều chỉnh; tồn dự báo trừ hàng sắp giao', async () => {
  day = '2026-10-21'; const { crm, biz, ban, ghe, lap } = await setup();
  assert.throws(() => biz.createReceipt({ lines: [L(lap, 1)] }), /không phải hàng lưu kho/);
  assert.throws(() => biz.createReceipt({ lines: [{ product_id: ban.id, qty: 0 }] }), /lớn hơn 0/);
  let r = biz.createReceipt({ lines: [{ product_id: ban.id, qty: 10, unit_cost: 1000000 }] });
  assert.match(r.number, /^WH\/IN\/00001$/); assert.strictEqual(r.state, 'ready'); assert.strictEqual(biz.onHand(ban.id), 0);
  biz.validatePicking(r.id); assert.strictEqual(biz.onHand(ban.id), 10);
  assert.strictEqual(crm.listProducts({}).find(p => p.id === ban.id).cost, 1000000, 'tồn 0 → giá vốn = giá nhập');
  r = biz.createReceipt({ lines: [{ product_id: ban.id, qty: 10, unit_cost: 1400000 }] }); biz.validatePicking(r.id);
  assert.strictEqual(crm.listProducts({}).find(p => p.id === ban.id).cost, 1200000, 'bình quân (10×1,0tr + 10×1,4tr)/20');
  assert.throws(() => biz.validatePicking(r.id), /đã hoàn tất/);
  const a = biz.adjustStock(ban.id, 18, 'Kiểm kê tháng 10'); assert.strictEqual(a.diff, -2); assert.strictEqual(biz.onHand(ban.id), 18);
  assert.strictEqual(biz.adjustStock(ban.id, 18).changed, false);
  assert.throws(() => biz.adjustStock(lap.id, 3), /không phải hàng lưu kho/);
  const s = biz.listStock({}); const row = s.rows.find(x => x.id === ban.id); assert.strictEqual(row.value, 18 * 1200000); assert.ok(!s.rows.find(x => x.id === lap.id), 'dịch vụ không có trong tồn kho');
  crm.saveProduct({ ...ghe, min_qty: 5 }); assert.ok(biz.listStock({ filter: 'low' }).rows.some(x => x.id === ghe.id));
  assert.throws(() => crm.saveProduct({ ...ban, type: 'service' }), /không đổi loại/);
  assert.throws(() => crm.saveProduct({ name: 'Trùng', sku: 'BAN-01' }), /đã dùng/);
});

test('Bán hàng: báo giá → gửi → xác nhận tạo phiếu giao (không giao dịch vụ), cơ hội sang Thắng; đơn đã xác nhận khoá dòng', async () => {
  day = '2026-10-21'; const { crm, biz, cus, ban, ghe, lap } = await setup();
  const lead = crm.saveLead({ title: 'Nội thất văn phòng An Phát', contact_id: cus.id, expected_revenue: 10000000 });
  let so = crm.saveQuote({ contact_id: cus.id, lead_id: lead.id, vat_pct: 10, payment_days: 30, lines: [L(ban, 3), L(ghe, 4, { discount_pct: 10 }), L(lap, 1)] });
  assert.strictEqual(so.status, 'draft'); assert.strictEqual(so.subtotal, 3 * 2000000 + Math.round(4 * 800000 * 0.9) + 300000);
  assert.strictEqual(leads(crm).find(l => l.id === lead.id).stage, 'quoted');
  so = biz.sendQuote(so.id); assert.strictEqual(so.status, 'sent'); assert.strictEqual(so.state_vi, 'Báo giá đã gửi');
  crm.saveQuote({ id: so.id, status: 'sale' }); assert.strictEqual(biz.getOrder(so.id).status, 'sent', 'không xác nhận đơn qua lưu báo giá');
  so = biz.confirmOrder(so.id); assert.strictEqual(so.status, 'sale'); assert.strictEqual(so.delivery_status, 'pending'); assert.strictEqual(so.invoice_status, 'to_invoice');
  assert.strictEqual(so.pickings.length, 1); const pk = biz.getPicking(so.pickings[0].id);
  assert.strictEqual(pk.kind, 'out'); assert.strictEqual(pk.origin, so.number); assert.deepStrictEqual(pk.moves.map(m => [m.product_name, m.qty]).sort(), [['Bàn làm việc', 3], ['Ghế xoay', 4]]);
  assert.strictEqual(leads(crm).find(l => l.id === lead.id).stage, 'won');
  assert.throws(() => crm.saveQuote({ id: so.id, lines: [L(ban, 1)] }), /đã xác nhận/);
  assert.throws(() => biz.confirmOrder(so.id), /đã được xác nhận/);
  assert.throws(() => crm.deleteQuote(so.id), /huỷ đơn trước/);
  assert.ok(biz.listOrders({ kind: 'orders' }).some(o => o.id === so.id)); assert.ok(!biz.listOrders({ kind: 'quotes' }).some(o => o.id === so.id));
  // huỷ (chưa giao, chưa có hoá đơn vào sổ) → phiếu giao huỷ theo; đặt lại báo giá → sửa được
  so = biz.cancelOrder(so.id); assert.strictEqual(so.status, 'cancel'); assert.strictEqual(biz.getPicking(pk.id).state, 'cancel');
  so = biz.resetToQuote(so.id); assert.strictEqual(so.status, 'draft'); crm.saveQuote({ id: so.id, lines: [L(ban, 2)] });
  assert.throws(() => biz.confirmOrder(crm.saveQuote({ contact_id: cus.id, lines: [] }).id), /chưa có dòng/);
});

test('Giao hàng: thiếu hàng thì chặn (trừ khi đồng ý tồn âm); giao một phần tạo phiếu chờ; trạng thái giao của đơn', async () => {
  day = '2026-10-21'; const { crm, biz, cus, ban, ghe } = await setup();
  biz.validatePicking(biz.createReceipt({ lines: [{ product_id: ban.id, qty: 5, unit_cost: 1000000 }, { product_id: ghe.id, qty: 2, unit_cost: 500000 }] }).id);
  let so = biz.confirmOrder(crm.saveQuote({ contact_id: cus.id, lines: [L(ban, 3), L(ghe, 4)] }).id);
  const pk = so.pickings[0];
  assert.throws(() => biz.validatePicking(pk.id), (e) => e.code === 'short' && /Ghế xoay.*cần 4, còn 2/.test(e.message));
  const g = biz.getPicking(pk.id); const mv = Object.fromEntries(g.moves.map(m => [m.product_name, m.id]));
  biz.setDone(pk.id, { [mv['Bàn làm việc']]: 3, [mv['Ghế xoay']]: 2 });
  const done = biz.validatePicking(pk.id); assert.ok(done.backorder_id, 'có phiếu chờ phần còn lại');
  const bo = biz.getPicking(done.backorder_id); assert.deepStrictEqual(bo.moves.map(m => [m.product_name, m.qty]), [['Ghế xoay', 2]]); assert.strictEqual(bo.state, 'ready');
  so = biz.getOrder(so.id); assert.strictEqual(so.delivery_status, 'partial'); assert.strictEqual(biz.onHand(ghe.id), 0); assert.strictEqual(biz.onHand(ban.id), 2);
  assert.strictEqual(biz.stockOf(ghe.id).forecast, -2, 'dự báo trừ phần chờ giao');
  biz.validatePicking(bo.id, { force: true }); assert.strictEqual(biz.onHand(ghe.id), -2);
  assert.strictEqual(biz.getOrder(so.id).delivery_status, 'full');
  assert.throws(() => biz.cancelOrder(so.id), /đã giao hàng/);
});

test('Hoá đơn: tạo từ đơn (phần chưa lập), vào sổ đánh số INV/năm/xxxxx + hạn theo điều khoản, thanh toán một phần → đủ; không trả vượt; quá hạn', async () => {
  day = '2026-10-21'; const { crm, biz, cus, ban, lap } = await setup();
  let so = biz.confirmOrder(crm.saveQuote({ contact_id: cus.id, vat_pct: 10, payment_days: 30, lines: [L(ban, 2), L(lap, 1)] }).id);
  assert.throws(() => biz.invoiceOrder(crm.saveQuote({ contact_id: cus.id, lines: [L(ban, 1)] }).id), /đã xác nhận/);
  let inv = biz.invoiceOrder(so.id);
  assert.strictEqual(inv.state, 'draft'); assert.strictEqual(inv.display_number, 'Nháp'); assert.strictEqual(inv.amount_untaxed, 4300000); assert.strictEqual(inv.amount_tax, 430000); assert.strictEqual(inv.amount_total, 4730000);
  assert.strictEqual(biz.getOrder(so.id).invoice_status, 'invoiced', 'hoá đơn nháp cũng tính là đã lập');
  assert.throws(() => biz.invoiceOrder(so.id), /Không còn gì/);
  assert.throws(() => biz.registerPayment(inv.id, {}), /đã vào sổ/);
  inv = biz.saveInvoice({ id: inv.id, lines: [...inv.lines.map(l => ({ ...l })), { name: 'Phí vận chuyển', qty: 1, price: 200000 }] }); assert.strictEqual(inv.amount_untaxed, 4500000);
  inv = biz.postInvoice(inv.id); assert.strictEqual(inv.number, 'INV/2026/00001'); assert.strictEqual(inv.invoice_date, '2026-10-21'); assert.strictEqual(inv.due_date, '2026-11-20');
  assert.throws(() => biz.saveInvoice({ id: inv.id, notes: 'x' }), /Chỉ sửa được hoá đơn nháp/);
  assert.throws(() => biz.registerPayment(inv.id, { amount: inv.amount_total + 1 }), /lớn hơn số còn phải thu/);
  inv = biz.registerPayment(inv.id, { amount: '2.000.000', method: 'cash' }); assert.strictEqual(inv.payment_state, 'partial'); assert.strictEqual(inv.residual, 4950000 - 2000000);
  assert.throws(() => biz.resetInvoice(inv.id), /đã có thanh toán/);
  day = '2026-12-01'; assert.ok(biz.getInvoice(inv.id).overdue); assert.strictEqual(biz.overview().overdue.n, 1);
  assert.strictEqual(biz.invoiceReport({}).aged[0].d30, 2950000, 'quá hạn 11 ngày → nhóm 1–30');
  inv = biz.registerPayment(inv.id, {}); assert.strictEqual(inv.payment_state, 'paid'); assert.strictEqual(inv.residual, 0); assert.ok(!inv.overdue);
  assert.throws(() => biz.registerPayment(inv.id, {}), /thanh toán đủ/);
  assert.match(inv.payments[1].number, /^PAY\/2026\/00002$/);
  assert.throws(() => biz.deleteInvoice(inv.id), /không xoá được/);
  const inv2 = biz.saveInvoice({ partner_id: cus.id, lines: [{ name: 'Tư vấn', qty: 2, price: 500000 }], vat_pct: 8 });
  assert.strictEqual(biz.postInvoice(inv2.id).number, 'INV/2026/00002');
});

test('Giấy báo có: đảo toàn bộ hoá đơn chưa thu → “Đã đảo”, đơn lại chờ lập hoá đơn; hoá đơn đã thu thì giấy báo có còn phải hoàn tiền', async () => {
  day = '2026-10-21'; const { crm, biz, cus, ban } = await setup();
  const so = biz.confirmOrder(crm.saveQuote({ contact_id: cus.id, lines: [L(ban, 1)] }).id);
  let inv = biz.postInvoice(biz.invoiceOrder(so.id).id);
  let rf = biz.creditNote(inv.id, { reason: 'Khách trả hàng' }); assert.strictEqual(rf.kind, 'out_refund'); assert.strictEqual(rf.amount_total, inv.amount_total);
  assert.throws(() => biz.creditNote(rf.id), /Chỉ tạo giấy báo có/);
  rf = biz.postInvoice(rf.id); assert.strictEqual(rf.number, 'RINV/2026/00001'); assert.strictEqual(rf.residual, 0);
  inv = biz.getInvoice(inv.id); assert.strictEqual(inv.payment_state, 'reversed'); assert.strictEqual(inv.residual, 0);
  assert.strictEqual(biz.getOrder(so.id).invoice_status, 'to_invoice', 'đảo hết → lại chờ lập hoá đơn');
  assert.throws(() => biz.resetInvoice(inv.id), /giấy báo có/);
  const rep = biz.invoiceReport({}); assert.strictEqual(rep.totals.total, 0, 'hoá đơn − giấy báo có');
  // đã thu đủ rồi mới đảo: giấy báo có còn nợ khách → ghi nhận hoàn tiền
  const so2 = biz.confirmOrder(crm.saveQuote({ contact_id: cus.id, lines: [L(ban, 1)] }).id);
  const i2 = biz.registerPayment(biz.postInvoice(biz.invoiceOrder(so2.id).id).id, {});
  let r2 = biz.postInvoice(biz.creditNote(i2.id).id); assert.strictEqual(r2.residual, r2.amount_total);
  r2 = biz.registerPayment(r2.id, {}); assert.strictEqual(r2.payment_state, 'paid');
  // huỷ đơn có hoá đơn vào sổ → chặn
  assert.throws(() => biz.cancelOrder(so2.id), /hoá đơn vào sổ/);
});

test('Báo cáo: doanh số theo tháng / khách hàng / sản phẩm, tồn kho & giá trị; Tổng quan; CSDL cũ (0.15) được nâng cấp giữ dữ liệu', async () => {
  day = '2026-10-21'; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-biz-')); const file = path.join(dir, 'crm.db');
  const { crm, biz, cus, ban, ghe, db } = await setup(file);
  biz.confirmOrder(crm.saveQuote({ contact_id: cus.id, lines: [L(ban, 2), L(ghe, 1)] }).id);
  const r = biz.salesReport({ groupBy: 'product' }); assert.deepStrictEqual(r.rows.map(x => [x.label, x.qty]), [['Bàn làm việc', 2], ['Ghế xoay', 1]]);
  assert.strictEqual(r.totals.untaxed, 4800000); assert.strictEqual(biz.salesReport({ groupBy: 'customer' }).rows[0].label, 'Công ty An Phát');
  assert.strictEqual(biz.salesReport({ from: '2026-11-01' }).rows.length, 0);
  const o = biz.overview(); assert.strictEqual(o.toInvoice, 1); assert.strictEqual(o.deliveriesReady, 1); assert.strictEqual(o.salesMonth, 4800000);
  // CSDL kiểu 0.15: thiếu cột mới, trạng thái accepted → mở lại thì thêm cột, đổi sang sale
  db.run("UPDATE quotes SET status = 'accepted'"); db.flushSync(); db.close();
  const db2 = await openDb(file); assert.strictEqual(db2.get('SELECT status FROM quotes LIMIT 1').status, 'sale');
  assert.ok(db2.get("SELECT type FROM products WHERE name = 'Bàn làm việc'").type === 'product');
  assert.strictEqual(db2.get("SELECT value FROM meta WHERE key = 'schema'").value, '3');
  db2.close();
});

// Giao diện thật (Electron + xvfb): chạy trọn luồng Kinh doanh bằng tay "người dùng" — vi và en.
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron'));
// Tên sản phẩm/khách/đơn vị là dữ liệu người dùng nhập — không dịch.
const USER_DATA = new Set(['Bàn làm việc gỗ sồi', 'Ghế xoay lưới', 'Lắp đặt tại nhà', 'Nội thất', 'Công ty TNHH Sen Vàng']); // đơn vị tính (cái, lần) nay dịch: Units/件, Times/次
const userData = (s) => USER_DATA.has(s);
for (const lang of ['vi', 'en']) {
  test(`Kinh doanh — giao diện thật (${lang}): nhập kho → báo giá → xác nhận → giao một phần (phiếu chờ) → hoá đơn → thu một phần → báo cáo`, { skip: !hasX && 'cần xvfb-run + electron' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qabiz-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qabiz-ud-'));
    const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_BIZ: dir, AIVN_QA_BIZ_LANG: lang });
    const r = spawnSync('timeout', ['300', 'xvfb-run', '-a', '-s', '-screen 0 1366x860x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: ROOT, encoding: 'utf8', env });
    const f = path.join(dir, `qabiz-${lang}.json`); assert.ok(fs.existsSync(f), 'QA Kinh doanh không chạy xong: ' + (r.stderr || '').slice(-800));
    const d = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!d.error, d.error);
    assert.deepStrictEqual(d.errs, []);
    for (const [k, s] of Object.entries(d.steps)) {
      assert.strictEqual(s.err || '', '', k);
      const left = (s.leftover || []).filter(t => !userData(t)); assert.deepStrictEqual(left, [], `${k}: còn tiếng Việt chưa dịch`);
    }
    assert.strictEqual(d.backorder, 'WH/OUT/00002');
    assert.strictEqual(d.db.receivable, 3800000); assert.strictEqual(d.db.salesMonth, 8000000); assert.strictEqual(d.db.deliveriesReady, 1);
    if (lang === 'vi') { assert.strictEqual(d.invoice.ribbon, 'THANH TOÁN MỘT PHẦN'); assert.strictEqual(d.order.total, '8.800.000 ₫'); }
    else { assert.strictEqual(d.invoice.ribbon, 'PARTIALLY PAID'); assert.strictEqual(d.order.total, '8,800,000 ₫'); assert.match(d.steps['10-don-xac-nhan'].toasts.join(' '), /Order BG-\d{4}-\d{4} confirmed · delivery created/); }
  });
}

// QA lượt 6 (B50–B54)
test('B50/B51: “1.000” = 1000 (dấu chấm hàng nghìn), số lượng làm tròn 3 chữ số, kiểm kê chữ không phải số bị chặn', async () => {
  day = '2026-10-21'; const { crm, biz, cus, ban, ghe } = await setup();
  const T = require('../src/crm/text');
  assert.strictEqual(T.parseQty('1.000'), 1000); assert.strictEqual(T.parseQty('1.234,5'), 1234.5); assert.strictEqual(T.parseQty('1,5'), 1.5); assert.strictEqual(T.parseQty('1.5'), 1.5); assert.ok(Number.isNaN(T.parseQty('abc')));
  const r = biz.createReceipt({ lines: [{ product_id: ban.id, qty: '1.000', unit_cost: '500.000' }] }); biz.validatePicking(r.id);
  assert.strictEqual(biz.onHand(ban.id), 1000);
  const q = crm.saveQuote({ contact_id: cus.id, lines: [L(ban, '1.000', { price: '1.000' })] }); assert.strictEqual(q.lines[0].qty, 1000);
  assert.throws(() => crm.saveQuote({ contact_id: cus.id, lines: [L(ban, 'mười')] }), /không phải là số/);
  biz.adjustStock(ghe.id, '1.200'); assert.strictEqual(biz.onHand(ghe.id), 1200);
  biz.adjustStock(ghe.id, '0,1'); biz.adjustStock(ghe.id, '0,3'); biz.adjustStock(ghe.id, 20); assert.strictEqual(biz.onHand(ghe.id), 20, 'không còn 20,000000000000046');
  assert.throws(() => biz.adjustStock(ghe.id, 'abc'), /phải là số ≥ 0/); assert.strictEqual(biz.onHand(ghe.id), 20);
  assert.throws(() => biz.adjustStock(ghe.id, '-1'), /phải là số ≥ 0/);
});
test('B52: thuế suất 7% báo lỗi (không tự đổi thành 10%); bỏ trống = 10%', async () => {
  day = '2026-10-21'; const { crm, biz, cus, ban } = await setup();
  assert.throws(() => biz.saveInvoice({ partner_id: cus.id, lines: [{ name: 'Tư vấn', qty: 1, price: 100000 }], vat_pct: 7 }), /không hợp lệ/);
  assert.throws(() => crm.saveQuote({ contact_id: cus.id, vat_pct: 7, lines: [L(ban, 1)] }), /không hợp lệ/);
  assert.strictEqual(biz.saveInvoice({ partner_id: cus.id, lines: [{ name: 'Tư vấn', qty: 1, price: 100000 }] }).vat_pct, 10);
  assert.strictEqual(crm.saveQuote({ contact_id: cus.id, vat_pct: '8%', lines: [L(ban, 1)] }).vat_pct, 8);
});
test('B53: tổng giấy báo có không vượt hoá đơn gốc; giấy báo có mới = phần chưa đảo', async () => {
  day = '2026-10-21'; const { biz, cus } = await setup();
  const inv = biz.postInvoice(biz.saveInvoice({ partner_id: cus.id, lines: [{ name: 'Tư vấn', qty: 10, price: 1000000 }], vat_pct: 10 }).id);
  let rf = biz.creditNote(inv.id); rf = biz.saveInvoice({ id: rf.id, lines: [{ name: 'Giảm giá', qty: 1, price: 2000000 }] }); rf = biz.postInvoice(rf.id);
  assert.strictEqual(rf.amount_total, 2200000);
  const rf2 = biz.creditNote(inv.id); assert.strictEqual(rf2.amount_total, inv.amount_total - 2200000, 'mặc định = phần còn lại');
  const big = biz.saveInvoice({ id: rf2.id, lines: [{ name: 'Đảo', qty: 1, price: 10000000 }] });
  assert.throws(() => biz.postInvoice(big.id), /vượt hoá đơn gốc/);
  biz.saveInvoice({ id: rf2.id, lines: [{ name: 'Đảo', qty: 1, price: 8000000 }] }); biz.postInvoice(rf2.id);
  assert.throws(() => biz.creditNote(inv.id), /báo có toàn bộ/);
});
test('B54: giá trị tồn âm hiện âm; lưu trữ sản phẩm còn tồn phải xác nhận; giao vượt số đặt phải xác nhận', async () => {
  day = '2026-10-21'; const { crm, biz, cus, ban } = await setup();
  const so = biz.confirmOrder(crm.saveQuote({ contact_id: cus.id, lines: [L(ban, 3)] }).id);
  const pk = so.pickings[0]; const mv = biz.getPicking(pk.id).moves[0];
  biz.setDone(pk.id, { [mv.id]: 5 });
  assert.throws(() => biz.validatePicking(pk.id), (e) => e.code === 'over' && /Giao nhiều hơn/.test(e.message));
  biz.validatePicking(pk.id, { force: true }); assert.strictEqual(biz.onHand(ban.id), -5);
  const row = biz.listStock({}).rows.find(r => r.id === ban.id); assert.ok(row.value < 0, 'giá trị tồn âm');
  biz.adjustStock(ban.id, 2);
  assert.throws(() => crm.deleteProduct(ban.id), (e) => e.code === 'stock');
  assert.strictEqual(crm.deleteProduct(ban.id, { force: true }), true);
});
