'use strict';
// QA lượt 8: B73 — một bộ đọc số dùng chung (máy chủ + giao diện), bảng ca vi/en/zh; đơn vị tính dịch theo ngôn ngữ; B54/N3 — định giá lại hàng xuất khi tồn âm
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const vm = require('vm');
const N = require('../src/crm/num'); const U = require('../src/crm/uom'); const T = require('../src/crm/text'); const TAX = require('../src/crm/tax');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');

// [chuỗi người dùng gõ, số đúng] — gom theo thói quen từng ngôn ngữ; mọi ca phải đúng bất kể ngôn ngữ giao diện
const QTY = {
  vi: [['0.125', 0.125], ['0,125', 0.125], ['0,250 kg', 0.25], ['0.500 m', 0.5], ['1.000', 1000], ['1.000.000', 1000000], ['1.234,5', 1234.5], ['1,5', 1.5], ['12,25', 12.25],
    ['2,75 m²', 2.75], ['3 cái', 3], ['1 000', 1000], ['-0,5', -0.5], [',5', 0.5], ['1234,567', 1234.567], ['10', 10], ['5,', 5]],
  en: [['1,000', 1000], ['1,000,000', 1000000], ['1,234.5', 1234.5], ['1.5', 1.5], ['0.25', 0.25], ['0.250 kg', 0.25], ['.5', 0.5], ['2.75', 2.75], ['1234.567', 1234.567],
    ['12 pcs', 12], ['1,234,567.891', 1234567.891], ['−3', -3]],
  zh: [['１２，５', 12.5], ['１，０００', 1000], ['0.125', 0.125], ['3件', 3], ['1,234.5', 1234.5], ['２.５ 千克', 2.5], ['10', 10]],
};
const BAD = ['abc', '1.2.3', '1..0', '1,23,456', '1.234.5', '1.000.', '--1', '1.2,3,4', '', '   ', '1e5', 'mười', 'Infinity', '0x10'];

test('B73: bảng ca số lượng vi/en/zh — “0.125” = 0,125; “0.250 kg” = 0,25; “1,000” = 1000; hai loại dấu thì dấu sau cùng là thập phân', () => {
  for (const [lang, rows] of Object.entries(QTY)) for (const [s, want] of rows) assert.strictEqual(N.parseQty(s), want, `${lang} “${s}”`);
  for (const s of BAD) assert.ok(Number.isNaN(N.parseQty(s)), `“${s}” phải là NaN, ra ${N.parseQty(s)}`);
  // máy chủ (text.js) dùng đúng bộ đọc này
  assert.strictEqual(T.parseQty('0.125'), 0.125); assert.strictEqual(T.parseQty('1,000'), 1000); assert.strictEqual(T.parseQty('1.000'), 1000);
  assert.strictEqual(N.parseQty(1.1234), 1.123, 'làm tròn 3 chữ số như Odoo');
});

test('B73: tiền VND — “1.000.000” = “1,000,000 ₫” = “1 triệu” = “1m” = “100万”; số lẻ làm tròn đồng; chữ báo lỗi, không thành 0', () => {
  const M = [['1.000.000', 1e6], ['1,000,000 ₫', 1e6], ['1.000.000đ', 1e6], ['1.000.000 VND', 1e6], ['1 triệu', 1e6], ['1,5 triệu', 1.5e6], ['1.5 million', 1.5e6], ['1m', 1e6],
    ['500k', 5e5], ['500 nghìn', 5e5], ['2 tỷ', 2e9], ['1.250 triệu', 1.25e9], ['100万', 1e6], ['2亿', 2e8], ['300000.6', 300001], ['0', 0], ['  2.500.000  ', 2.5e6], ['１，５００，０００', 1.5e6]];
  for (const [s, want] of M) assert.strictEqual(N.parseMoney(s), want, `“${s}”`);
  for (const s of ['abc', '1.2.3', 'triệu', '5 quả']) assert.ok(Number.isNaN(N.parseMoney(s)), s);
  assert.throws(() => TAX.moneyIn('abc'), /không phải là số tiền hợp lệ/);
  assert.strictEqual(TAX.moneyIn('', 7), 7); assert.strictEqual(TAX.pctIn('7,5%'), 7.5); assert.strictEqual(TAX.pctIn('0.125'), 0.125, 'phần trăm: một dấu luôn là thập phân');
  assert.throws(() => TAX.pctIn('mười'), /Chiết khấu/);
});

test('B73: giao diện nạp ĐÚNG tệp num.js/uom.js (window.AIVN_NUM/AIVN_UOM) — cùng kết quả với máy chủ; số hiện theo ngôn ngữ đọc lại được', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  assert.ok(html.indexOf('../crm/num.js') > 0 && html.indexOf('../crm/num.js') < html.indexOf('biz.js'), 'num.js nạp trước biz.js');
  assert.ok(html.indexOf('../crm/uom.js') > 0 && html.indexOf('../crm/uom.js') < html.indexOf('biz.js'));
  const win = {}; vm.createContext(win); win.globalThis = win;
  for (const f of ['num.js', 'uom.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/crm', f), 'utf8'), win);
  for (const rows of Object.values(QTY)) for (const [s, want] of rows) assert.strictEqual(win.AIVN_NUM.parseQty(s), want, s);
  assert.strictEqual(win.AIVN_UOM.label('cái', 'zh'), '件');
  // giá trị đặt vào ô nhập: vi “1.234,5”, en/zh “1,234.5” — đọc lại ra đúng số (trừ ca 1–999 có đúng 3 số lẻ: giao diện giữ data-num)
  for (const lang of ['vi', 'en', 'zh']) for (const n of [0.125, 0.25, 1234.5, 1000, 1000000, 2.5, 12.75, 1234567.891, 0])
    assert.strictEqual(N.parseQty(N.fmtInput(n, lang)), n, `${lang} ${n} → “${N.fmtInput(n, lang)}”`);
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/biz.js'), 'utf8');
  assert.ok(!/replace\(\/\[\^\\d-\]\/g/.test(src), 'không còn parseMoney cũ (bỏ mọi ký tự không phải số → “1,5” thành 15)');
  assert.match(src, /NUM\.parseQty/);
});

test('Đơn vị tính: lưu khoá tiếng Việt, hiện Units/件; gõ “Units”, “件”, “pcs” quy về khoá chuẩn; tên tự đặt giữ nguyên', async () => {
  assert.strictEqual(U.label('cái', 'en', 3), 'Units'); assert.strictEqual(U.label('cái', 'en', 1), 'Unit'); assert.strictEqual(U.label('cái', 'zh', 3), '件'); assert.strictEqual(U.label('cái', 'vi', 3), 'cái');
  assert.strictEqual(U.label('chuyến', 'en', 2), 'Trips'); assert.strictEqual(U.label('gói', 'zh'), '包'); assert.strictEqual(U.label('giờ', 'en', 8), 'Hours'); assert.strictEqual(U.label('kg', 'zh'), '千克');
  for (const [s, k] of [['Units', 'cái'], ['unit', 'cái'], ['件', 'cái'], ['pcs', 'chiếc'], ['Thùng', 'thùng'], ['m2', 'm²'], ['Hours', 'giờ'], ['小时', 'giờ'], ['  Hộp  ', 'hộp']]) assert.strictEqual(U.canon(s), k, s);
  assert.strictEqual(U.canon('Bình 20L'), 'Bình 20L'); assert.strictEqual(U.label('Bình 20L', 'en'), 'Bình 20L');
  // mọi tên en/zh khác nhau (không có hai đơn vị trùng tên hiển thị → quy ngược không lẫn)
  for (const lang of ['vi', 'en', 'zh']) { const n = U.names(lang).map(x => x.toLowerCase()); assert.strictEqual(new Set(n).size, n.length, lang); for (const x of U.names(lang)) assert.ok(U.known(x), x); }
  for (const r of U.LIST) for (const lang of ['vi', 'en', 'zh']) for (const q of [1, 2]) assert.strictEqual(U.canon(U.label(r[0], lang, q)), r[0], `${r[0]} ${lang} ${q}`);
  // máy chủ quy về khoá chuẩn khi lưu sản phẩm / dòng báo giá
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-uom-')), 'crm.db')); const crm = createCrm({ db, defaultOwner: () => 'Khôi' });
  const p = crm.saveProduct({ name: 'Nước suối', unit: 'Bottles', price: '5,000' }); assert.strictEqual(p.unit, 'chai'); assert.strictEqual(p.price, 5000);
  const c = crm.saveContact({ name: 'Khách lẻ' });
  const q = crm.saveQuote({ contact_id: c.id, lines: [{ product_id: p.id, name: p.name, unit: '件', qty: '0.125', price: '1,000' }] });
  assert.strictEqual(q.lines[0].unit, 'cái'); assert.strictEqual(q.lines[0].qty, 0.125); assert.strictEqual(q.lines[0].price, 1000);
  assert.throws(() => crm.saveProduct({ name: 'X', price: 'năm nghìn' }), /không phải là số tiền/);
});

test('Mẫu in: cột ĐVT theo ngôn ngữ (en Units/Hours, zh 件/小时)', async () => {
  const P = require('../src/crm/print');
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-uomp-')), 'crm.db'));
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => '2026-10-22' });
  biz.saveCompany({ name: 'Công ty TNHH Giải pháp AIVN' }); const cus = crm.saveContact({ name: 'Công ty An Phát', kind: 'company' });
  const inv = biz.saveInvoice({ partner_id: cus.id, lines: [{ name: 'Bàn', unit: 'cái', qty: 3, price: 1000000 }, { name: 'Tư vấn', unit: 'giờ', qty: 1, price: 500000 }] });
  const h = (l) => P.renderDoc(biz, crm, 'invoice', inv.id, l).html;
  const en = h('en'), zh = h('zh'), vi = h('vi');
  assert.match(en, /<td>Units<\/td>/); assert.match(en, /<td>Hour<\/td>/); assert.match(zh, /<td>件<\/td>/); assert.match(zh, /<td>小时<\/td>/); assert.match(vi, /<td>cái<\/td>/);
  assert.ok(!/<td>cái<\/td>/.test(en) && !/<td>giờ<\/td>/.test(zh));
});

test('B54/N3: nhập hàng khi tồn âm — giá vốn = giá hàng về, phần đã xuất “chưa có hàng” được định giá lại (cũ trước), không định giá lại phần đã có hàng', async () => {
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-n3-')), 'crm.db'));
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => '2026-10-22' });
  const cus = crm.saveContact({ name: 'Công ty An Phát', kind: 'company' });
  const ban = crm.saveProduct({ name: 'Bàn', price: 2000000, cost: 0, type: 'product' });
  biz.validatePicking(biz.createReceipt({ lines: [{ product_id: ban.id, qty: 2, unit_cost: 1000000 }] }).id);
  const sell = (q) => { const so = biz.confirmOrder(crm.saveQuote({ contact_id: cus.id, lines: [{ product_id: ban.id, name: 'Bàn', qty: q, price: 2000000 }] }).id); return biz.validatePicking(so.pickings[0].id, { force: true }); };
  const o1 = sell(5); // 2 có hàng (giá 1.000.000), 3 “chưa có hàng”
  const mv1 = o1.moves[0]; assert.strictEqual(biz.onHand(ban.id), -3); assert.strictEqual(mv1.unit_cost, 1000000); assert.strictEqual(mv1.vacuum_qty, 3);
  const o2 = sell(2); const mv2 = o2.moves[0]; assert.strictEqual(mv2.vacuum_qty, 2); assert.strictEqual(biz.onHand(ban.id), -5);
  // nhập 4 @ 1.500.000: phủ 3 của phiếu 1 (cũ trước) + 1 của phiếu 2
  biz.validatePicking(biz.createReceipt({ lines: [{ product_id: ban.id, qty: 4, unit_cost: 1500000 }] }).id);
  assert.strictEqual(crm.getProduct ? (crm.getProduct(ban.id) || {}).cost ?? db.get('SELECT cost FROM products WHERE id = ?', [ban.id]).cost : db.get('SELECT cost FROM products WHERE id = ?', [ban.id]).cost, 1500000, 'tồn ≤ 0 → giá vốn = giá hàng về');
  let a = db.get('SELECT vacuum_qty, reval FROM moves WHERE id = ?', [mv1.id]), b = db.get('SELECT vacuum_qty, reval FROM moves WHERE id = ?', [mv2.id]);
  assert.deepStrictEqual([a.vacuum_qty, a.reval], [0, 3 * 500000]); assert.deepStrictEqual([b.vacuum_qty, b.reval], [1, 1 * 500000]);
  // nhập tiếp 3 @ 1.800.000: phủ 1 còn lại của phiếu 2 (giá xuất phiếu 2 = 1.000.000 lúc giao) → +800.000; tồn 2, giá vốn 1.800.000
  biz.validatePicking(biz.createReceipt({ lines: [{ product_id: ban.id, qty: 3, unit_cost: 1800000 }] }).id);
  b = db.get('SELECT vacuum_qty, reval FROM moves WHERE id = ?', [mv2.id]); assert.deepStrictEqual([b.vacuum_qty, b.reval], [0, 500000 + 800000]);
  assert.strictEqual(biz.onHand(ban.id), 2); assert.strictEqual(db.get('SELECT cost FROM products WHERE id = ?', [ban.id]).cost, 1800000);
  // giá trị tồn = 2 × 1.800.000; tổng giá vốn hàng đã bán = 7 × giá thực nhập theo thứ tự (2×1.0 + 4×1.5 + 1×1.8 triệu)
  assert.strictEqual(biz.listStock({}).rows.find(r => r.id === ban.id).value, 3600000);
  const cogs = db.all("SELECT qty_done * unit_cost + COALESCE(reval, 0) AS v FROM moves WHERE product_id = ? AND kind = 'out' AND state = 'done'", [ban.id]).reduce((s, r) => s + r.v, 0);
  assert.strictEqual(cogs, 2 * 1000000 + 4 * 1500000 + 1 * 1800000);
  // giao khi còn đủ hàng → không có phần chờ định giá
  const o3 = sell(1); assert.strictEqual(o3.moves[0].vacuum_qty, 0); assert.strictEqual(o3.moves[0].unit_cost, 1800000);
});
