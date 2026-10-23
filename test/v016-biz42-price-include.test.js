'use strict';
// #42 K3: “Giá đã gồm thuế” (Odoo account.tax price_include = “Included in price”) theo dòng / theo sản phẩm, làm tròn theo dòng như Odoo.
// SỐ KỲ VỌNG: test/fixtures/odoo-price-include.json do test/fixtures/odoo-price-include.py sinh ra (máy này không cài Odoo). Tệp .py nạp
// NGUYÊN VĂN odoo/tools/float_utils.py 17.0 (như #41) rồi tính mỗi dòng theo HAI cách và đòi bằng nhau:
//   Odoo 18 _add_tax_details_in_base_line (round_per_line, price_include): tổng gồm thuế = float_round(đơn giá sau CK × SL),
//     thuế = float_round(tổng × 1/(1 + mức/100) × mức/100), price_subtotal = tổng − thuế;
//   Odoo 17 compute_all: total_excluded = float_round(tổng / (1 + mức/100)), thuế = tổng − total_excluded.
// Thuế nhóm = round(Σ thuế dòng cùng mức). 5 mẫu S11–S15 (báo giá, đơn bán, hoá đơn, đơn mua, hoá đơn NCC), đủ 0/5/8/10%.
// Chạy lại: python3 test/fixtures/odoo-price-include.py <float_utils.py 17.0> > test/fixtures/odoo-price-include.json
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const vm = require('vm'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz, BIZ_CALLS } = require('../src/crm/biz');
const TAX = require('../src/crm/tax'); const P = require('../src/crm/print'); const NUM = require('../src/crm/num');
const SAMPLES = require('./fixtures/odoo-price-include.json').samples; const OLD = require('./fixtures/odoo-round-per-line.json').samples;
const F = require('./fixtures/pdf-docs');
const TYPES = ['quote', 'sale_order', 'invoice', 'purchase_order', 'vendor_bill'];
const DAY = '2026-10-23';
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-k3-')), 'crm.db');
const byRate = (gs) => gs.map(g => [g.rate, g.base, g.tax]).sort((a, b) => a[0] - b[0]);
const want = (s) => ({ untaxed: s.odoo.amount_untaxed, tax: s.odoo.amount_tax, total: s.odoo.amount_total, groups: byRate(s.odoo.tax_groups), lines: s.odoo.lines.map(l => l.price_subtotal) });
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

async function setup(file) {
  const db = await openDb(file || tmp());
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => DAY });
  const cus = crm.saveContact({ name: 'Công ty TNHH Sen Vàng', kind: 'company', tax_id: '0312345678' });
  const ven = crm.saveContact({ name: 'Công ty Gỗ Bình Dương', kind: 'company', tax_id: '3701234567' });
  return { db, crm, biz, cus, ven };
}
const linesOf = (s) => s.lines.map(l => ({ name: l.name, unit: 'cái', qty: l.qty, price: l.price, discount_pct: l.discount_pct, vat_pct: l.vat_pct, price_include: l.price_include ? 1 : 0 }));
const ofQ = (o) => ({ untaxed: o.subtotal, tax: o.vat, total: o.total, groups: byRate(o.tax_groups), lines: o.lines.map(l => TAX.lineSubtotal(l, TAX.roundingOf(o.tax_rounding))) });
const ofI = (i) => ({ untaxed: i.amount_untaxed, tax: i.amount_tax, total: i.amount_total, groups: byRate(i.tax_groups), lines: i.lines.map(l => l.amount) });
function make({ crm, biz, cus, ven }, type, s) {
  const lines = linesOf(s);
  if (type === 'quote') { const q = crm.saveQuote({ contact_id: cus.id, lines }); return ['quote', q.id, ofQ(biz.getOrder(q.id))]; }
  if (type === 'sale_order') {
    const q = crm.saveQuote({ contact_id: cus.id, lines }); biz.confirmOrder(q.id); const o = biz.getOrder(q.id); assert.strictEqual(o.status, 'sale');
    const inv = biz.invoiceOrder(q.id); assert.deepStrictEqual(ofI(inv), ofQ(o), 'hoá đơn lập từ đơn bán = đơn bán');
    biz.postInvoice(inv.id); const r = biz.creditNote(inv.id, {}); assert.deepStrictEqual(ofI(biz.getInvoice(r.id)), ofQ(o), 'giấy báo có giữ cờ gồm thuế');
    return ['quote', q.id, ofQ(o)];
  }
  if (type === 'purchase_order') {
    const o = biz.savePurchase({ partner_id: ven.id, lines }); biz.confirmPurchase(o.id); const p = biz.getPurchase(o.id); assert.strictEqual(p.state, 'purchase');
    return ['purchase', o.id, ofQ(p)];
  }
  const side = type === 'vendor_bill' ? 'in_invoice' : 'out_invoice';
  const inv = biz.saveInvoice({ partner_id: side === 'in_invoice' ? ven.id : cus.id, kind: side, lines }); biz.postInvoice(inv.id);
  const g = biz.getInvoice(inv.id); assert.strictEqual(g.state, 'posted'); return ['invoice', inv.id, ofI(g)];
}

test('5 mẫu Odoo giá đã gồm thuế (0/5/8/10%): thành tiền, thuế từng dòng, nhóm thuế, tổng — lệch 0 ₫; 10 mẫu #41 (chưa gồm thuế) không đổi', () => {
  assert.strictEqual(SAMPLES.length, 5); assert.deepStrictEqual(SAMPLES.map(s => s.id), ['S11', 'S12', 'S13', 'S14', 'S15']);
  const rates = new Set(); let incl = 0, excl = 0;
  for (const s of SAMPLES) {
    s.lines.forEach((l, i) => {
      const o = s.odoo.lines[i];
      assert.strictEqual(TAX.lineSubtotal(l, 'line'), o.price_subtotal, `${s.id} dòng ${i + 1}: thành tiền trước thuế`);
      assert.strictEqual(TAX.lineTax(l, 'line'), o.tax, `${s.id} dòng ${i + 1}: thuế`);
      assert.strictEqual(TAX.lineTotal(l, 'line'), o.price_total, `${s.id} dòng ${i + 1}: gồm thuế`);
      if (l.price_include) { incl++; assert.strictEqual(o.price_total, TAX.floatRound(l.price * (1 - l.discount_pct / 100) * l.qty), `${s.id} dòng ${i + 1}: khách trả đúng giá đã ghi`); } else excl++;
      rates.add(l.vat_pct);
    });
    const t = TAX.totals(s.lines, 'line');
    assert.deepStrictEqual([t.amount_untaxed, t.amount_tax, t.amount_total], [s.odoo.amount_untaxed, s.odoo.amount_tax, s.odoo.amount_total], s.id);
    assert.deepStrictEqual(byRate(t.tax_groups), byRate(s.odoo.tax_groups), s.id + ': nhóm thuế');
  }
  assert.deepStrictEqual([...rates].sort((a, b) => a - b), [0, 5, 8, 10]); assert.ok(incl >= 20 && excl >= 2, `${incl} dòng gồm thuế, ${excl} dòng chưa gồm thuế`);
  assert.deepStrictEqual(SAMPLES.map(s => s.doc).sort(), ['invoice', 'purchase_order', 'quote', 'sale_order', 'vendor_bill']);
  // nếu bỏ qua cờ (coi như chưa gồm thuế) thì sai ở mọi mẫu → mẫu kiểm được điều cần kiểm
  for (const s of SAMPLES) assert.notStrictEqual(TAX.totals(s.lines.map(l => ({ ...l, price_include: 0 })), 'line').amount_total, s.odoo.amount_total, s.id);
  // giá trị cờ: true/1/'1'/'true'/'on' = gồm thuế; còn lại = không; bỏ trống → mặc định
  assert.deepStrictEqual([true, 1, '1', 'true', 'on', 0, '0', false, '', null, undefined, 'x'].map(v => TAX.inclOf({ price_include: v })), [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual([TAX.inclIn(''), TAX.inclIn('', 1), TAX.inclIn(null, 1), TAX.inclIn(0, 1), TAX.inclIn('1')], [0, 1, 1, 0, 1]);
  // 10 mẫu #41 không có cờ: y nguyên số cũ
  for (const s of OLD) { const t = TAX.totals(s.lines, 'line'); assert.deepStrictEqual([t.amount_untaxed, t.amount_tax, t.amount_total], [s.odoo.amount_untaxed, s.odoo.amount_tax, s.odoo.amount_total], s.id); }
});

test('Màn hình (src/renderer/biz.js): cùng công thức — ô thành tiền và ô tổng/nhóm thuế đúng số Odoo ở 5 mẫu', () => {
  const R = src('src/renderer/biz.js');
  const pick = (re) => { const m = R.match(re); assert.ok(m, 'thiếu ' + re); return m[0]; };
  const code = [
    pick(/ {2}const parseQty = [^\n]*\n/), pick(/ {2}const parseMoney = [^\n]*\n/), pick(/ {2}const gross = [\s\S]*? {2}const amt = [^\n]*\n/),
    pick(/ {2}const defVat = [^\n]*\n/), pick(/ {2}const lineVat = [^\n]*\n/), pick(/ {2}function totalsOf\([\s\S]*?\n {2}\}\n/),
  ].join('') + '\n({ amt, totalsOf, inclOf });';
  const vmBox = vm.runInNewContext(code, { NUM, B: { company: { default_vat: 10 } }, Math, Number, Map });
  const box = { amt: vmBox.amt, totalsOf: (ls, r) => JSON.parse(JSON.stringify(vmBox.totalsOf(ls, r))) }; // mảng khác realm vm → JSON
  for (const s of SAMPLES) {
    const ui = s.lines.map(l => ({ ...l, price_include: l.price_include ? '1' : '0' })); // ô số giữ số gốc (data-num); <select> trả chuỗi '0'/'1'
    ui.forEach((l, i) => assert.strictEqual(box.amt(l, 'line'), s.odoo.lines[i].price_subtotal, `${s.id} dòng ${i + 1}`));
    const t = box.totalsOf(ui, 'line');
    assert.deepStrictEqual([t.untaxed, t.tax, t.total], [s.odoo.amount_untaxed, s.odoo.amount_tax, s.odoo.amount_total], s.id);
    assert.deepStrictEqual(byRate(t.groups), byRate(s.odoo.tax_groups), s.id);
    const g = box.totalsOf(ui, 'global'), gt = TAX.totals(s.lines, 'global'); // chứng từ làm tròn gộp: màn hình = tax.js
    assert.deepStrictEqual([g.untaxed, g.tax, g.total, byRate(g.groups)], [gt.amount_untaxed, gt.amount_tax, gt.amount_total, byRate(gt.tax_groups)], s.id + ' global');
  }
  for (const s of OLD) { const t = box.totalsOf(s.lines, 'line'); assert.strictEqual(t.total, s.odoo.amount_total, s.id + ' (#41)'); }
});

test('5 loại chứng từ × 5 mẫu (báo giá, đơn bán → hoá đơn → giấy báo có, hoá đơn, đơn mua, hoá đơn NCC): lưu và đọc lại = Odoo, lệch 0 ₫; báo cáo khớp', async () => {
  const ctx = await setup(); let n = 0;
  for (const s of SAMPLES) for (const type of TYPES) { const [, , got] = make(ctx, type, s); assert.deepStrictEqual(got, want(s), `${s.id} / ${type}`); n++; }
  assert.strictEqual(n, 25);
  const sum = (k) => SAMPLES.reduce((a, s) => a + s.odoo[k], 0);
  const sr = ctx.biz.salesReport({}); assert.strictEqual(sr.totals.untaxed, sum('amount_untaxed')); assert.strictEqual(sr.totals.total, sum('amount_total'));
  const pr = ctx.biz.payablesReport({}); assert.strictEqual(pr.totals.total, sum('amount_total'), 'phải trả = Σ hoá đơn NCC (gồm thuế)');
  // đơn mua → hoá đơn NCC lập từ đơn: giữ cờ, cùng số
  const s = SAMPLES[3]; const o = ctx.biz.savePurchase({ partner_id: ctx.ven.id, lines: linesOf(s) }); ctx.biz.confirmPurchase(o.id);
  for (const pk of ctx.biz.listPickings({ poId: o.id })) ctx.biz.validatePicking(pk.id);
  const bill = ctx.biz.createBill(o.id); assert.deepStrictEqual(ofI(ctx.biz.getInvoice(bill.id)), want(s), 'hoá đơn NCC từ đơn mua');
});

const LOC = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN' };
const LBL = { vi: ['Thuế GTGT', 'trên', 'Cộng tiền hàng', 'Tổng cộng thanh toán', 'gồm thuế'], en: ['VAT', 'on', 'Untaxed amount', 'Total amount', 'tax incl.'], zh: ['增值税', '基数', '未税金额', '应付总额', '含税'] };
const money = (n, L) => `${Math.round(n).toLocaleString(LOC[L])} ₫`;
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<title>[\s\S]*?<\/title>/, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('PDF (HTML in) vi/en/zh: “Cộng tiền hàng / Thuế GTGT x% (trên …) / Tổng cộng” đúng số Odoo; dòng gồm thuế có ghi chú; VietQR = tổng gồm thuế', async () => {
  const ctx = await setup(); F.seed && ctx.biz.saveCompany({ ...F.COMPANY }); let n = 0;
  for (const s of SAMPLES) for (const type of [s.doc, 'invoice']) {
    const [kind, id] = make(ctx, type, s); const w = want(s);
    for (const L of ['vi', 'en', 'zh']) {
      const v = visible(P.renderDoc(ctx.biz, ctx.crm, kind, id, L).html);
      assert.match(v, new RegExp(`${rx(LBL[L][2])} ${rx(money(w.untaxed, L))}`), `${s.id}/${type}/${L}: Cộng tiền hàng`);
      for (const g of s.odoo.tax_groups) assert.match(v, new RegExp(`${rx(LBL[L][0])} ${g.rate}% \\(${rx(LBL[L][1])} ${rx(money(g.base, L))}\\)\\s+${rx(money(g.tax, L))}`), `${s.id}/${type}/${L}: thuế ${g.rate}%`);
      assert.match(v, new RegExp(`${rx(LBL[L][3])} ${rx(money(w.total, L))}`), `${s.id}/${type}/${L}: Tổng`);
      for (const a of w.lines) assert.ok(v.includes(money(a, L)), `${s.id}/${type}/${L}: thành tiền dòng ${a}`);
      const nIncl = s.lines.filter(l => l.price_include).length;
      assert.strictEqual(v.split(` ${LBL[L][4]} `).length - 1, nIncl, `${s.id}/${type}/${L}: số dòng ghi “${LBL[L][4]}”`);
      if (L !== 'vi') assert.ok(!/gồm thuế|Thuế GTGT/.test(s.lines.reduce((a, l) => a.split(l.name).join(' '), v)), `${s.id}/${L}: còn chữ tiếng Việt (ngoài tên hàng)`);
      n++;
    }
    if (kind === 'invoice' && type === 'invoice') { const q = ctx.biz.invoiceQr(id); assert.ok(q.ok, JSON.stringify(q)); assert.strictEqual(q.amount, w.total, `${s.id}: VietQR = tổng gồm thuế`); assert.match(q.payload, new RegExp(`54${String(w.total).length.toString().padStart(2, '0')}${w.total}`)); }
  }
  assert.strictEqual(n, 30);
  // chứng từ không có dòng gồm thuế: không có chữ ghi chú
  const [k0, i0] = make(ctx, 'invoice', OLD[0]); assert.ok(!visible(P.renderDoc(ctx.biz, ctx.crm, k0, i0, 'vi').html).includes(' gồm thuế '));
});

test('Sản phẩm “Giá bán đã gồm thuế”: báo giá/hoá đơn bán lấy cờ của sản phẩm; đơn mua/hoá đơn NCC mặc định chưa gồm; ghi rõ ở dòng thì theo dòng; giá vốn nhập kho và bảng giá NCC là giá trước thuế', async () => {
  const { db, crm, biz, cus, ven } = await setup();
  const tea = crm.saveProduct({ name: 'Trà ô long (hộp)', type: 'product', price: 110000, cost: 60000, vat_pct: 10, price_include: 1 });
  const pen = crm.saveProduct({ name: 'Bút bi', type: 'consu', price: 5000, vat_pct: 8 });
  assert.strictEqual(db.get('SELECT price_include FROM products WHERE id = ?', [tea.id]).price_include, 1);
  assert.strictEqual(db.get('SELECT price_include FROM products WHERE id = ?', [pen.id]).price_include, 0, 'mặc định: chưa gồm thuế');
  assert.strictEqual(crm.saveProduct({ id: pen.id, name: 'Bút bi', price_include: 'on' }).price_include ?? db.get('SELECT price_include FROM products WHERE id = ?', [pen.id]).price_include, 1);
  crm.saveProduct({ id: pen.id, name: 'Bút bi', price_include: 0 });
  // bán: dòng không ghi cờ → theo sản phẩm (110.000 gồm 10% → 100.000 + 10.000)
  const q = crm.saveQuote({ contact_id: cus.id, lines: [{ product_id: tea.id, name: 'Trà', qty: 3, price: 110000, vat_pct: 10 }, { product_id: pen.id, name: 'Bút', qty: 10, price: 5000, vat_pct: 8 }] });
  const o = biz.getOrder(q.id); assert.deepStrictEqual(o.lines.map(l => l.price_include), [1, 0]); assert.deepStrictEqual([o.subtotal, o.vat, o.total], [300000 + 50000, 30000 + 4000, 330000 + 54000]);
  const inv = biz.saveInvoice({ partner_id: cus.id, lines: [{ product_id: tea.id, name: 'Trà', qty: 1, price: 110000, vat_pct: 10 }] }); assert.strictEqual(inv.amount_total, 110000);
  const inv2 = biz.saveInvoice({ partner_id: cus.id, lines: [{ product_id: tea.id, name: 'Trà', qty: 1, price: 110000, vat_pct: 10, price_include: 0 }] }); assert.strictEqual(inv2.amount_total, 121000, 'ghi rõ ở dòng thắng cờ sản phẩm');
  // mua: giá nhập thường chưa gồm thuế → mặc định 0 dù sản phẩm có cờ bán gồm thuế
  const bill = biz.saveInvoice({ partner_id: ven.id, kind: 'in_invoice', lines: [{ product_id: tea.id, name: 'Trà', qty: 1, price: 66000, vat_pct: 10 }] }); assert.strictEqual(bill.amount_total, 72600);
  const po0 = biz.savePurchase({ partner_id: ven.id, lines: [{ product_id: tea.id, name: 'Trà', qty: 2, price: 66000, vat_pct: 10 }] }); assert.strictEqual(biz.getPurchase(po0.id).total, 145200);
  // đơn mua giá gồm thuế: giá vốn nhập kho = giá trước thuế/đơn vị (Odoo compute_all(price_unit, 1).total_excluded), có chiết khấu
  const po = biz.savePurchase({ partner_id: ven.id, lines: [{ product_id: tea.id, name: 'Trà', qty: 7, price: 66000, discount_pct: 5, vat_pct: 10, price_include: 1 }] });
  const p1 = biz.getPurchase(po.id); assert.strictEqual(p1.lines[0].price_include, 1); assert.deepStrictEqual([p1.subtotal, p1.vat, p1.total], [399000, 39900, 438900]);
  biz.confirmPurchase(po.id); const pk = biz.listPickings({ poId: po.id })[0]; const moves = biz.getPicking(pk.id).moves;
  assert.strictEqual(moves[0].unit_cost, 57000, '62.700 gồm 10% → 57.000 trước thuế'); assert.strictEqual(moves[0].unit_cost, TAX.lineSubtotal({ qty: 1, price: 66000 * 0.95, vat_pct: 10, price_include: 1 }));
  // bảng giá NCC lưu giá CHƯA thuế (66.000 gồm 10% → 60.000)
  const ch = biz.vendorPriceChanges(po.id); assert.strictEqual(ch.length, 1); assert.strictEqual(ch[0].price, 60000); biz.applyVendorPrices(po.id);
  assert.strictEqual(biz.listVendorPrices(tea.id).find(v => v.partner_id === ven.id).price, 60000);
  // hoá đơn NCC lập từ đơn: giữ cờ gồm thuế
  biz.validatePicking(pk.id); const b2 = biz.getInvoice(biz.createBill(po.id).id); assert.strictEqual(b2.lines[0].price_include, 1); assert.strictEqual(b2.amount_total, 438900);
  // dữ liệu cũ: đơn mua chưa có cờ giữ nguyên cách tính giá vốn cũ
  const po2 = biz.savePurchase({ partner_id: ven.id, lines: [{ product_id: tea.id, name: 'Trà', qty: 1, price: 66001, discount_pct: 5, vat_pct: 10 }] }); biz.confirmPurchase(po2.id);
  assert.strictEqual(biz.getPicking(biz.listPickings({ poId: po2.id })[0].id).moves[0].unit_cost, Math.round(66001 * 0.95));
});

test('Làm tròn gộp (chứng từ cũ) có dòng gồm thuế: dòng gồm thuế tách thuế theo dòng, dòng chưa gồm thuế dùng công thức cũ; trước thuế + thuế = tổng', async () => {
  const ctx = await setup(); const { db, biz } = ctx;
  for (const s of SAMPLES) {
    const t = TAX.totals(s.lines, 'global'); assert.strictEqual(t.amount_untaxed + t.amount_tax, t.amount_total);
    const g = s.lines.filter(l => l.price_include).reduce((a, l) => a + Math.round(l.qty * l.price * (1 - l.discount_pct / 100)), 0);
    const ex = s.lines.filter(l => !l.price_include); const exU = ex.reduce((a, l) => a + Math.round(l.qty * l.price * (1 - l.discount_pct / 100)), 0);
    const exT = [...new Set(ex.map(l => l.vat_pct))].reduce((a, r) => a + Math.round(ex.filter(l => l.vat_pct === r).reduce((b, l) => b + Math.round(l.qty * l.price * (1 - l.discount_pct / 100)), 0) * r / 100), 0);
    assert.strictEqual(t.amount_total, g + exU + exT, s.id + ': khách trả đúng giá đã ghi ở dòng gồm thuế');
    assert.ok(t.tax_groups.every(x => Object.keys(x).join() === 'rate,base,tax'), 'nhóm thuế chỉ có rate/base/tax');
    const [kind, id] = make(ctx, s.doc === 'purchase_order' ? 'purchase_order' : 'invoice', s);
    db.run(`UPDATE ${kind === 'purchase' ? 'purchase_orders' : 'invoices'} SET tax_rounding = 'global' WHERE id = ?`, [id]);
    const d = kind === 'purchase' ? biz.getPurchase(id) : biz.getInvoice(id); assert.deepStrictEqual(byRate(d.tax_groups), byRate(t.tax_groups), s.id);
  }
});

const BASE = '43595bf46be5643a74e5227a8951dff9cf9fdd13'; // K2 — chưa có cột price_include
const hasBase = spawnSync('git', ['cat-file', '-e', `${BASE}:src/crm/db.js`], { cwd: ROOT }).status === 0;
test('Dữ liệu cũ (bản trước K3, chưa có cột price_include): mở bằng bản mới thêm cột = 0, giữ nguyên tổng mọi chứng từ, báo cáo và PDF', { skip: !hasBase && `cần commit ${BASE.slice(0, 7)}` }, async () => {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-k3-old-'));
  const tar = spawnSync('sh', ['-c', `git archive ${BASE} src/crm src/i18n | tar -x -C "${old}"`], { cwd: ROOT }); assert.strictEqual(tar.status, 0, String(tar.stderr));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(old, 'node_modules'), 'dir');
  const O = (m) => require(path.join(old, 'src/crm', m));
  const file = tmp(); const db = await O('db').openDb(file);
  const crm = O('crm').createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = O('biz').createBiz({ db, crm, today: () => DAY });
  const cus = crm.saveContact({ name: 'Công ty TNHH Sen Vàng', kind: 'company' }); const ven = crm.saveContact({ name: 'Công ty Gỗ Bình Dương', kind: 'company' });
  for (const s of OLD.concat(SAMPLES)) {
    const lines = s.lines.map(l => ({ name: l.name, unit: 'cái', qty: l.qty, price: l.price, discount_pct: l.discount_pct, vat_pct: l.vat_pct, price_include: 1 })); // bản cũ bỏ qua cờ
    const q = crm.saveQuote({ contact_id: cus.id, lines }); biz.confirmOrder(q.id); biz.postInvoice(biz.invoiceOrder(q.id).id);
    biz.confirmPurchase(biz.savePurchase({ partner_id: ven.id, lines }).id); biz.saveInvoice({ partner_id: ven.id, kind: 'in_invoice', lines });
  }
  for (const t of ['products', 'quote_lines', 'invoice_lines', 'purchase_lines']) assert.ok(!db.all(`PRAGMA table_info(${t})`).some(c => c.name === 'price_include'), t + ': bản cũ chưa có cột');
  const inv0 = db.all('SELECT id, amount_untaxed, amount_tax, amount_total FROM invoices ORDER BY id');
  const q0 = db.all('SELECT id FROM quotes ORDER BY id').map(r => { const o = biz.getOrder(r.id); return [r.id, o.subtotal, o.vat, o.total]; });
  const p0 = db.all('SELECT id FROM purchase_orders ORDER BY id').map(r => { const o = biz.getPurchase(r.id); return [r.id, o.subtotal, o.vat, o.total]; });
  const sr0 = biz.salesReport({}).totals; const pr0 = biz.payablesReport({}).totals; db.close();
  const db2 = await openDb(file); const crm2 = createCrm({ db: db2 }); const biz2 = createBiz({ db: db2, crm: crm2, today: () => DAY });
  for (const t of ['products', 'quote_lines', 'invoice_lines', 'purchase_lines']) { assert.ok(db2.all(`PRAGMA table_info(${t})`).some(c => c.name === 'price_include'), t + ': đã thêm cột'); assert.strictEqual(db2.get(`SELECT COUNT(*) AS n FROM ${t} WHERE price_include != 0`).n, 0, t + ': dữ liệu cũ = chưa gồm thuế'); }
  assert.strictEqual(db2.get("SELECT value FROM meta WHERE key = 'schema'").value, '3', 'chỉ thêm cột (ADD_COLUMNS), không đổi số phiên bản');
  assert.deepStrictEqual(db2.all('SELECT id, amount_untaxed, amount_tax, amount_total FROM invoices ORDER BY id'), inv0, 'số đã lưu không đổi');
  for (const r of inv0) { const g = biz2.getInvoice(r.id); assert.deepStrictEqual([g.amount_untaxed, g.amount_tax, g.amount_total], [r.amount_untaxed, r.amount_tax, r.amount_total]); }
  assert.deepStrictEqual(db2.all('SELECT id FROM quotes ORDER BY id').map(r => { const o = biz2.getOrder(r.id); return [r.id, o.subtotal, o.vat, o.total]; }), q0, 'báo giá/đơn bán giữ tổng');
  assert.deepStrictEqual(db2.all('SELECT id FROM purchase_orders ORDER BY id').map(r => { const o = biz2.getPurchase(r.id); return [r.id, o.subtotal, o.vat, o.total]; }), p0, 'đơn mua giữ tổng');
  assert.deepStrictEqual(biz2.salesReport({}).totals, sr0); assert.deepStrictEqual(biz2.payablesReport({}).totals, pr0);
  const r = inv0[inv0.length - 1]; assert.match(visible(P.renderDoc(biz2, crm2, 'invoice', r.id, 'vi').html), new RegExp(`Tổng cộng thanh toán ${rx(money(r.amount_total, 'vi'))}`));
  // sửa nháp cũ sau nâng cấp (không gửi cờ) → vẫn chưa gồm thuế, cùng tổng
  const d = db2.get("SELECT id, amount_total FROM invoices WHERE state = 'draft' LIMIT 1"); assert.strictEqual(biz2.saveInvoice({ id: d.id, notes: 'sửa sau nâng cấp' }).amount_total, d.amount_total);
  db2.close(); fs.rmSync(old, { recursive: true, force: true });
});

test('Tĩnh: giao diện có ô “Đã gồm thuế” ở cột Thuế + form sản phẩm, gửi price_include ở 3 payload; IPC không đổi; i18n en/zh đủ; không đụng main.js/app.js/index.html', () => {
  const R = src('src/renderer/biz.js');
  assert.match(R, /<select data-lf="price_include"[^`]*>Chưa gồm thuế<\/option>[^`]*>Đã gồm thuế<\/option>/);
  assert.match(R, /\['price_include', 'Giá bán đã gồm thuế', \[\[0, 'Chưa gồm thuế \(cộng thuế khi bán\)'\], \[1, 'Đã gồm thuế \(giá khách trả\)'\]\]\]/);
  assert.strictEqual((R.match(/vat_pct: lineVat\(l\), price_include: inclOf\(l\) \}\)\) \}; \};/g) || []).length, 3, 'orderPayload, invPayload, poPayload');
  assert.match(R, /l\.price_include = buying \? 0 : inclOf\(p\)/, 'chọn sản phẩm: bán lấy cờ sản phẩm, mua = 0');
  assert.match(R, /'vat_pct', 'price_include'\]\.includes\(lf\.dataset\.lf\)/, 'đổi cờ → vẽ lại tổng');
  for (const c of ['saveInvoice', 'savePurchase', 'invoiceQr', 'getPurchase', 'createBill']) assert.ok(BIZ_CALLS.includes(c), 'IPC sẵn có: ' + c); // cờ đi trong dữ liệu dòng, không cần lệnh IPC mới
  const M = src('src/main.js'); for (const c of ['saveQuote', 'saveProduct']) assert.ok(M.includes(`'${c}'`), 'main.js CRM_OK có sẵn ' + c);
  const en = require('../src/i18n/en'), zh = require('../src/i18n/zh'); const E = en.dict || en, Z = zh.dict || zh;
  const KEYS = ['Chưa gồm thuế', 'Chưa gồm thuế (cộng thuế khi bán)', 'Giá bán đã gồm thuế', 'gồm thuế', 'Đã gồm thuế', 'Đã gồm thuế (giá khách trả)', 'Đơn giá đã gồm thuế?'];
  for (const k of KEYS) { assert.ok(E[k] && !/[ăâđêôơưàảãáạ]/i.test(E[k]), 'en: ' + k); assert.ok(Z[k] && /[\u4e00-\u9fff]/.test(Z[k]), 'zh: ' + k); assert.ok(!/[()?:,]/.test(Z[k]), 'zh dấu toàn khổ: ' + k); }
  const S = JSON.stringify(require('../src/i18n/strings.json')); for (const k of KEYS) assert.ok(S.includes(JSON.stringify(k)), 'strings.json: ' + k);
  // khoá K3 nằm cuối nhóm Kinh doanh: ngay sau khoá cuối của K2
  for (const f of ['en', 'zh']) { const t = src(`src/i18n/${f}.js`); const a = t.indexOf('"Đặt hàng bổ sung":'), b = t.indexOf('"Đơn giá đã gồm thuế?":'), c = t.indexOf('"AIVN tự đọc trang":'); assert.ok(a > 0 && a < b && b < c, f + ': vị trí khoá'); }
  const diff = spawnSync('git', ['diff', '--name-only', BASE, '--', 'src/main.js', 'src/renderer/app.js', 'index.html', 'src/index.html'], { cwd: ROOT, encoding: 'utf8' });
  if (diff.status === 0) assert.strictEqual(diff.stdout.trim(), '', 'không đụng main.js/app.js/index.html');
});
