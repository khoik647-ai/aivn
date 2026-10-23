'use strict';
// #42 K2: quy tắc tồn tối thiểu / tối đa → yêu cầu báo giá nháp (Odoo stock.warehouse.orderpoint, nút “Đặt hàng bổ sung” trong Kho → Tồn kho)
// Dự báo 3, tối thiểu 5, tối đa 20 → RFQ nháp 17 cái cho NCC ưu tiên; bấm lần 2 không tạo đơn mới, chỉ sửa số lượng; hàng chưa có NCC được liệt kê.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz, BIZ_CALLS } = require('../src/crm/biz');
const root = path.join(__dirname, '..');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-rr-')), 'crm.db');
async function setup(file) {
  const db = await openDb(file || tmp());
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => '2026-10-23' });
  const A = crm.saveContact({ name: 'Công ty Gỗ Bình Dương', kind: 'company' });
  const Bv = crm.saveContact({ name: 'Xưởng Mộc Thủ Đức', kind: 'company' });
  const ban = crm.saveProduct({ name: 'Bàn làm việc', sku: 'BAN-01', price: 2000000, cost: 1200000, type: 'product', unit: 'cái', min_qty: 5, max_qty: '20' });
  biz.saveVendorPrices(ban.id, [{ partner_id: A.id, min_qty: 1, price: '1.000.000', delay: 5 }, { partner_id: A.id, min_qty: 10, price: '950.000', delay: 5 }]);
  biz.adjustStock(ban.id, 3, 'Kiểm kê');
  return { db, crm, biz, A, Bv, ban };
}
const pos = (db) => db.all('SELECT * FROM purchase_orders ORDER BY created_at, number');

test('nghiệm thu K2: dự báo 3, tối thiểu 5, tối đa 20 → RFQ nháp 17 cái (giá NCC), không tự xác nhận; bấm lần 2 không tạo đơn mới', async () => {
  const { db, biz, A, ban } = await setup();
  assert.strictEqual(biz.stockOf(ban.id).forecast, 3); assert.strictEqual(ban.max_qty, 20);
  const plan = biz.reorderPlan(); assert.strictEqual(plan.length, 1);
  assert.deepStrictEqual((({ qty, action, partner_id, max_qty }) => ({ qty, action, partner_id, max_qty }))(plan[0]), { qty: 17, action: 'create', partner_id: A.id, max_qty: 20 });
  assert.strictEqual(pos(db).length, 0, 'xem trước không tạo gì');
  const r = biz.runReorder(); assert.strictEqual(r.created.length, 1); assert.deepStrictEqual(r.updated, []); assert.deepStrictEqual(r.no_vendor, []);
  const all = pos(db); assert.strictEqual(all.length, 1); assert.strictEqual(all[0].state, 'draft', 'chỉ là yêu cầu báo giá nháp');
  const po = biz.getPurchase(all[0].id); assert.strictEqual(po.number, r.created[0]); assert.strictEqual(po.partner_id, A.id);
  assert.strictEqual(po.lines.length, 1); assert.strictEqual(po.lines[0].qty, 17); assert.strictEqual(po.lines[0].price, 950000, 'giá theo bảng giá NCC (từ 10 cái)');
  assert.strictEqual(po.date_planned, '2026-10-28'); assert.deepStrictEqual(po.pickings || [], []);
  assert.strictEqual(biz.stockOf(ban.id).incoming, 0, 'RFQ nháp chưa tạo phiếu nhập');
  // bấm lần 2, không có gì đổi → không tạo đơn mới, không sửa
  const r2 = biz.runReorder(); assert.deepStrictEqual([r2.created, r2.updated], [[], []]); assert.strictEqual(r2.items[0].action, 'update');
  assert.strictEqual(pos(db).length, 1);
  // tồn giảm còn 1 → bấm lần 3 chỉ sửa số lượng dòng cũ thành 19, vẫn một đơn
  biz.adjustStock(ban.id, 1, 'Hỏng 2');
  const r3 = biz.runReorder(); assert.deepStrictEqual(r3.created, []); assert.deepStrictEqual(r3.updated, [po.number]);
  assert.strictEqual(pos(db).length, 1); const po3 = biz.getPurchase(po.id); assert.strictEqual(po3.lines.length, 1); assert.strictEqual(po3.lines[0].qty, 19); assert.strictEqual(po3.state, 'draft');
  assert.strictEqual(po3.lines[0].price, 950000, 'giữ đơn giá dòng cũ');
  // xác nhận đơn → có hàng sắp nhập, dự báo 20 ≥ 5 → không đặt thêm
  biz.confirmPurchase(po.id); assert.strictEqual(biz.stockOf(ban.id).forecast, 20);
  assert.deepStrictEqual(biz.reorderPlan(), []); const r4 = biz.runReorder(); assert.deepStrictEqual([r4.created, r4.updated, r4.items], [[], [], []]); assert.strictEqual(pos(db).length, 1);
});

test('hàng chưa có NCC liệt kê “chưa có NCC”; gộp theo NCC; nối vào RFQ nháp sẵn có của NCC; RFQ đã gửi để nguyên; tối đa < tối thiểu → đặt đến tối thiểu', async () => {
  const { db, crm, biz, A, Bv, ban } = await setup();
  const ghe = crm.saveProduct({ name: 'Ghế xoay', type: 'product', unit: 'cái', cost: 500000, min_qty: 4 }); // không có tối đa → đặt đến 4
  biz.saveVendorPrices(ghe.id, [{ partner_id: Bv.id, min_qty: 0, price: '480.000', sequence: 1 }, { partner_id: A.id, min_qty: 0, price: '470.000', sequence: 2 }]);
  const tu = crm.saveProduct({ name: 'Tủ hồ sơ', type: 'product', unit: 'cái', cost: 900000, min_qty: 2, max_qty: 6 }); // không có NCC
  const ke = crm.saveProduct({ name: 'Kệ sách', type: 'product', unit: 'cái', cost: 300000, min_qty: 1, max_qty: 3 });
  biz.saveVendorPrices(ke.id, [{ partner_id: Bv.id, min_qty: 0, price: '310.000' }]);
  const sent = biz.savePurchase({ partner_id: Bv.id, lines: [{ product_id: ke.id, qty: 2 }] }); biz.sendRfq(sent.id);
  crm.saveProduct({ name: 'Dịch vụ lắp', type: 'service', min_qty: 5 }); // dịch vụ không theo dõi tồn → bỏ qua
  const draftB = biz.savePurchase({ partner_id: Bv.id, lines: [{ name: 'Phí vận chuyển', qty: 1, price: '200.000' }] });
  assert.ok(biz.listStock({ filter: 'low' }).rows.find(x => x.id === tu.id).no_vendor); assert.ok(!biz.listStock({}).rows.find(x => x.id === ban.id).no_vendor);
  const r = biz.runReorder();
  assert.deepStrictEqual(r.no_vendor, ['Tủ hồ sơ']); assert.strictEqual(r.created.length, 1, 'chỉ tạo đơn cho NCC A'); assert.deepStrictEqual(r.updated, [draftB.number]);
  const byName = Object.fromEntries(r.items.map(x => [x.name, x])); assert.strictEqual(byName['Ghế xoay'].partner_id, Bv.id, 'NCC ưu tiên theo thứ tự'); assert.strictEqual(byName['Ghế xoay'].qty, 4);
  assert.strictEqual(byName['Tủ hồ sơ'].action, 'no_vendor'); assert.strictEqual(byName['Kệ sách'].action, 'sent'); assert.strictEqual(byName['Kệ sách'].po_number, sent.number);
  const b = biz.getPurchase(draftB.id); assert.deepStrictEqual(b.lines.map(l => [l.name, l.qty, l.price]), [['Phí vận chuyển', 1, 200000], ['Ghế xoay', 4, 480000]]);
  assert.strictEqual(biz.getPurchase(sent.id).lines[0].qty, 2, 'RFQ đã gửi không bị sửa'); assert.strictEqual(biz.getPurchase(sent.id).state, 'sent');
  assert.strictEqual(pos(db).length, 3); assert.ok(pos(db).every(p => p.state !== 'purchase'), 'không tự xác nhận');
  const r2 = biz.runReorder(); assert.deepStrictEqual([r2.created, r2.updated, r2.no_vendor], [[], [], ['Tủ hồ sơ']]); assert.strictEqual(pos(db).length, 3);
  assert.throws(() => crm.saveProduct({ id: ke.id, name: 'Kệ sách', max_qty: 'abc' }), /không phải là số/);
});

test('dữ liệu cũ (bảng sản phẩm chưa có max_qty) mở bình thường; tối đa mặc định 0 → đặt đến tối thiểu', async () => {
  const file = tmp(); const { db, ban } = await setup(file);
  db.run('ALTER TABLE products DROP COLUMN max_qty'); db.flushSync(); db.close();
  const db2 = await openDb(file); assert.strictEqual(db2.get("SELECT value FROM meta WHERE key = 'schema'").value, '3');
  const crm2 = createCrm({ db: db2, defaultOwner: () => 'Khôi' }); const biz2 = createBiz({ db: db2, crm: crm2, today: () => '2026-10-23' });
  assert.strictEqual(db2.get('SELECT max_qty FROM products WHERE id = ?', [ban.id]).max_qty, 0);
  assert.strictEqual(biz2.reorderPlan()[0].qty, 2);
  db2.close();
});

test('giao diện + IPC + vi/en/zh: nút “Đặt hàng bổ sung” ở Tồn kho, ô Tồn tối đa, nhãn “chưa có NCC”, khoá dịch đủ', () => {
  for (const k of ['reorderPlan', 'runReorder']) assert.ok(BIZ_CALLS.includes(k), k);
  const r = fs.readFileSync(path.join(root, 'src/renderer/biz.js'), 'utf8');
  assert.match(r, /data-biz-act="reorder"[^>]*>Đặt hàng bổ sung<\/button>/); assert.match(r, /if \(a === 'reorder'\) return reorder\(\)/); assert.match(r, /C\('runReorder'\)/);
  assert.match(r, /\['max_qty', 'Tồn tối đa \(đặt hàng bổ sung đến mức này\)'\]/); assert.match(r, /badge\('chưa có NCC'/);
  assert.doesNotMatch(r.slice(r.indexOf('async function reorder()'), r.indexOf('async function stockList')), /confirmPurchase/, 'không tự xác nhận');
  const en = require('../src/i18n/en'); const zh = require('../src/i18n/zh');
  const keys = ['Đặt hàng bổ sung', 'chưa có NCC', 'Chưa có NCC: {0}', 'Tạo yêu cầu báo giá nháp {0}', 'Cập nhật số lượng trong {0}', 'Tồn tối đa (đặt hàng bổ sung đến mức này)', 'Xem yêu cầu báo giá', '{0}: đã có yêu cầu báo giá đã gửi {1}', 'Không có sản phẩm nào dưới tồn tối thiểu.', 'Yêu cầu báo giá nháp đã đủ số lượng, không cần sửa.', 'Tạo từ “Đặt hàng bổ sung” (tồn dự báo dưới mức tối thiểu).'];
  for (const k of keys) assert.ok(en[k] && zh[k], k);
  assert.strictEqual(en['Đặt hàng bổ sung'], 'Replenish'); assert.strictEqual(zh['chưa có NCC'], '尚无供应商');
  const ui = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/strings.json'), 'utf8')); for (const k of keys.slice(0, 10)) assert.ok(ui.includes(k), k);
});
