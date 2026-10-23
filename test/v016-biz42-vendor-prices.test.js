'use strict';
// #42 K1: giá và thời gian giao theo nhà cung cấp (Odoo product.supplierinfo / _select_seller)
// NCC A: 1.000.000 từ 1 cái, 950.000 từ 10 cái, giao trong 5 ngày → đơn 10 cái lấy 950.000, ngày nhận dự kiến +5; NCC B không có bảng giá → giá vốn.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz, BIZ_CALLS } = require('../src/crm/biz');
const root = path.join(__dirname, '..');
let day = '2026-10-21';
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-vp-')), 'crm.db');
async function setup(file) {
  const db = await openDb(file || tmp());
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => day });
  const A = crm.saveContact({ name: 'Công ty Gỗ Bình Dương', kind: 'company' });
  const Bv = crm.saveContact({ name: 'Xưởng Mộc Thủ Đức', kind: 'company' });
  const ban = crm.saveProduct({ name: 'Bàn làm việc', sku: 'BAN-01', price: 2000000, cost: 1200000, type: 'product', unit: 'cái' });
  return { db, crm, biz, A, Bv, ban };
}
const tiers = (biz, ban, A) => biz.saveVendorPrices(ban.id, [{ partner_id: A.id, min_qty: '1', price: '1.000.000', delay: 5 }, { partner_id: A.id, min_qty: 10, price: '950.000', delay: '5' }]);

test('nghiệm thu K1: đơn 10 cái của NCC A → 950.000, ngày nhận dự kiến +5 ngày; 5 cái → 1.000.000; NCC B → giá vốn', async () => {
  day = '2026-10-21'; const { biz, A, Bv, ban } = await setup();
  const rows = tiers(biz, ban, A);
  assert.strictEqual(rows.length, 2); assert.deepStrictEqual(rows.map(r => [r.min_qty, r.price, r.delay]), [[1, 1000000, 5], [10, 950000, 5]]);
  assert.strictEqual(rows[0].partner_name, 'Công ty Gỗ Bình Dương');
  // gợi ý cho giao diện
  assert.deepStrictEqual((({ price, delay, source, date_planned }) => ({ price, delay, source, date_planned }))(biz.vendorPrice({ productId: ban.id, partnerId: A.id, qty: 10, dateOrder: '2026-10-21' })), { price: 950000, delay: 5, source: 'vendor', date_planned: '2026-10-26' });
  assert.strictEqual(biz.vendorPrice({ productId: ban.id, partnerId: A.id, qty: '9,5' }).price, 1000000);
  assert.strictEqual(biz.vendorPrice({ productId: ban.id, partnerId: A.id, qty: 25 }).price, 950000);
  assert.deepStrictEqual((({ price, source, date_planned }) => ({ price, source, date_planned }))(biz.vendorPrice({ productId: ban.id, partnerId: Bv.id, qty: 10 })), { price: 1200000, source: 'cost', date_planned: null });
  // đơn mua không ghi giá → lấy theo bảng giá NCC, ngày nhận dự kiến = ngày đặt + 5
  const po = biz.savePurchase({ partner_id: A.id, date_order: '2026-10-21', lines: [{ product_id: ban.id, qty: 10 }] });
  assert.strictEqual(po.lines[0].price, 950000); assert.strictEqual(po.subtotal, 9500000); assert.strictEqual(po.date_planned, '2026-10-26');
  const po5 = biz.savePurchase({ partner_id: A.id, date_order: '2026-10-21', lines: [{ product_id: ban.id, qty: 5 }] });
  assert.strictEqual(po5.lines[0].price, 1000000); assert.strictEqual(po5.date_planned, '2026-10-26');
  // NCC B không có bảng giá → giá vốn, không tự đặt ngày nhận
  const pb = biz.savePurchase({ partner_id: Bv.id, date_order: '2026-10-21', lines: [{ product_id: ban.id, qty: 10 }] });
  assert.strictEqual(pb.lines[0].price, 1200000); assert.strictEqual(pb.date_planned, null);
  // ngày nhận do người dùng nhập và giá ghi tay vẫn giữ nguyên
  const pm = biz.savePurchase({ partner_id: A.id, date_order: '2026-10-21', date_planned: '2026-11-02', lines: [{ product_id: ban.id, qty: 10, price: '990.000' }] });
  assert.strictEqual(pm.lines[0].price, 990000); assert.strictEqual(pm.date_planned, '2026-11-02');
  // phiếu nhập theo ngày nhận dự kiến, giá vốn = giá NCC
  const c = biz.confirmPurchase(po.id); const pk = biz.getPicking(c.pickings[0].id);
  assert.strictEqual(pk.scheduled, '2026-10-26'); assert.strictEqual(pk.moves[0].unit_cost, 950000);
  // giá khớp bảng giá → không hỏi cập nhật
  assert.deepStrictEqual(biz.vendorPriceChanges(po.id), []);
});

test('xác nhận đơn với giá mới → gợi ý cập nhật bảng giá NCC (sửa dòng khớp, thêm NCC chưa có); không cập nhật nếu người dùng không đồng ý', async () => {
  day = '2026-10-21'; const { biz, A, Bv, ban } = await setup(); tiers(biz, ban, A);
  const po = biz.savePurchase({ partner_id: A.id, lines: [{ product_id: ban.id, qty: 12, price: '930.000' }] }); biz.confirmPurchase(po.id);
  const ch = biz.vendorPriceChanges(po.id);
  assert.strictEqual(ch.length, 1); assert.strictEqual(ch[0].action, 'update'); assert.strictEqual(ch[0].old_price, 950000); assert.strictEqual(ch[0].price, 930000); assert.strictEqual(ch[0].min_qty, 10);
  // người dùng bấm “Không” → không có gì đổi
  assert.strictEqual(biz.listVendorPrices({ productId: ban.id }).find(r => r.min_qty === 10).price, 950000);
  assert.strictEqual(biz.applyVendorPrices(po.id).length, 1);
  assert.deepStrictEqual(biz.listVendorPrices({ productId: ban.id }).map(r => r.price), [1000000, 930000]);
  assert.deepStrictEqual(biz.vendorPriceChanges(po.id), []);
  // NCC B chưa có trong bảng giá → thêm dòng (từ 0, số ngày giao theo ngày nhận dự kiến của đơn)
  const pb = biz.savePurchase({ partner_id: Bv.id, date_order: '2026-10-21', date_planned: '2026-10-24', lines: [{ product_id: ban.id, qty: 3, price: '1.100.000' }] }); biz.confirmPurchase(pb.id);
  const cb = biz.vendorPriceChanges(pb.id); assert.strictEqual(cb.length, 1); assert.strictEqual(cb[0].action, 'add'); assert.strictEqual(cb[0].delay, 3);
  biz.applyVendorPrices(pb.id);
  const rb = biz.listVendorPrices({ productId: ban.id, partnerId: Bv.id }); assert.deepStrictEqual(rb.map(r => [r.min_qty, r.price, r.delay]), [[0, 1100000, 3]]);
  assert.strictEqual(biz.vendorPrice({ productId: ban.id, partnerId: Bv.id, qty: 1, dateOrder: '2026-11-01' }).date_planned, '2026-11-04');
});

test('bảng giá NCC: kiểm tra dữ liệu nhập, lưu thay toàn bộ, xoá dòng', async () => {
  const { biz, A, Bv, ban } = await setup();
  assert.throws(() => biz.saveVendorPrices('nope', []), /sản phẩm/);
  assert.throws(() => biz.saveVendorPrices(ban.id, [{ partner_id: 'x', price: 1 }]), /nhà cung cấp/);
  assert.throws(() => biz.saveVendorPrices(ban.id, [{ partner_id: A.id, min_qty: 'abc', price: 1 }]), /không phải là số/);
  assert.throws(() => biz.saveVendorPrices(ban.id, [{ partner_id: A.id, price: 1, delay: -1 }]), /0 đến 365/);
  assert.throws(() => biz.saveVendorPrices(ban.id, [{ partner_id: A.id, min_qty: 1, price: 1 }, { partner_id: A.id, min_qty: '1', price: 2 }]), /hai dòng giá/);
  tiers(biz, ban, A); assert.strictEqual(biz.listVendorPrices({ partnerId: A.id }).length, 2);
  const r = biz.saveVendorPrices(ban.id, [{ partner_id: Bv.id, min_qty: 0, price: '800.000', delay: 2 }, { partner_id: '', price: '' }]);
  assert.strictEqual(r.length, 1); assert.strictEqual(biz.listVendorPrices({ partnerId: A.id }).length, 0, 'lưu là thay toàn bộ');
  assert.strictEqual(biz.deleteVendorPrice(r[0].id), true); assert.strictEqual(biz.listVendorPrices({ productId: ban.id }).length, 0);
});

test('dữ liệu cũ (chưa có bảng vendor_prices) mở bình thường; luồng C2 (10 × 1.000.000 → nhận 6) không đổi', async () => {
  day = '2026-10-21'; const file = tmp(); const { db, biz, A, ban } = await setup(file);
  const po0 = biz.savePurchase({ partner_id: A.id, lines: [{ product_id: ban.id, qty: 10, price: '1.000.000' }] });
  db.run('DROP TABLE vendor_prices'); db.flushSync(); db.close();
  const db2 = await openDb(file); assert.strictEqual(db2.get("SELECT value FROM meta WHERE key = 'schema'").value, '3');
  const crm2 = createCrm({ db: db2, defaultOwner: () => 'Khôi' }); const biz2 = createBiz({ db: db2, crm: crm2, today: () => day });
  assert.deepStrictEqual(biz2.listVendorPrices({ productId: ban.id }), []);
  const po = biz2.getPurchase(po0.id); assert.strictEqual(po.subtotal, 10000000); assert.strictEqual(po.date_planned, null);
  const c = biz2.confirmPurchase(po.id); const pk = biz2.getPicking(c.pickings[0].id);
  biz2.setDone(pk.id, { [pk.moves[0].id]: 6 }); biz2.validatePicking(pk.id);
  const after = biz2.getPurchase(po.id); assert.strictEqual(after.receipt_status, 'partial'); assert.strictEqual(after.lines[0].qty_received, 6);
  assert.strictEqual(biz2.onHand(ban.id), 6);
  // NCC chưa có giá → gợi ý thêm (người dùng có thể bỏ qua)
  assert.strictEqual(biz2.vendorPriceChanges(po.id)[0].action, 'add');
  db2.close();
});

test('giao diện + IPC + vi/en/zh: gọi được qua danh sách trắng, form sản phẩm có phần Nhà cung cấp, đơn mua tự điền giá, khoá dịch đủ', () => {
  for (const k of ['listVendorPrices', 'saveVendorPrices', 'deleteVendorPrice', 'vendorPrice', 'vendorPriceChanges', 'applyVendorPrices']) assert.ok(BIZ_CALLS.includes(k), k);
  const r = fs.readFileSync(path.join(root, 'src/renderer/biz.js'), 'utf8');
  assert.match(r, /vendorSection\(p\)/); assert.match(r, /t === 'vprices' \? await vendorPricesForm/); assert.match(r, /C\('vendorPrice', \{ productId: l\.product_id, partnerId: e\.partner_id, qty: l\.qty/);
  assert.match(r, /if \(a === 'confirmPurchase'\) \{ await rerender\(\); await askVendorPrices\(o\)/); assert.match(r, /C\('applyVendorPrices', o\.id\)/);
  const en = require('../src/i18n/en'); const zh = require('../src/i18n/zh');
  const keys = ['Cập nhật bảng giá nhà cung cấp?', 'Sửa giá nhà cung cấp…', 'Từ SL', 'Giao trong (ngày)', 'Đã lưu giá nhà cung cấp ✓', '{0}: {1} → {2} (từ SL {3})', 'Số ngày giao “{0}” phải là số nguyên từ 0 đến 365.'];
  for (const k of keys) { assert.ok(en[k] && zh[k], k); }
  assert.strictEqual(en['Từ SL'], 'From qty'); assert.strictEqual(zh['Cập nhật bảng giá nhà cung cấp?'], '更新供应商价格表？');
  const ui = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/strings.json'), 'utf8')); assert.ok(ui.includes('Sửa giá nhà cung cấp…'));
});
