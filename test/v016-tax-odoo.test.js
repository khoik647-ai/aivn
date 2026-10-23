'use strict';
// #41 (C4): thuế GTGT theo dòng — 0/5/8/10% tách theo mức trên MÀN HÌNH và trong PDF, làm tròn từng dòng GIỐNG HỆT Odoo
// (tax_calculation_rounding_method = 'round_per_line'), đủ 6 loại chứng từ (báo giá, đơn bán, hoá đơn, giấy báo có, đơn mua,
// hoá đơn NCC), vi/en/zh; chứng từ một mức thuế của bản cũ (0.16.0-beta.3) mở ra giữ nguyên tổng, báo cáo bán hàng / công nợ không đổi.
//
// SỐ KỲ VỌNG LẤY TỪ ĐÂU (máy này KHÔNG cài Odoo): test/fixtures/odoo-round-per-line.json do test/fixtures/odoo-round-per-line.py sinh ra.
// Tệp .py nạp NGUYÊN VĂN odoo/tools/float_utils.py của Odoo 17.0 (commit 657d92130e501843316542524f074a2f094c27e2, sha256 ghi trong
// đầu tệp .py) để có đúng float_round/round() của Odoo, rồi chép lại từng bước của account.tax.compute_all (addons/account/models/
// account_tax.py 17.0) cho thuế phần trăm, giá chưa gồm thuế, làm tròn theo dòng: đơn giá sau CK = price_unit × (1 − discount/100)
// (_compute_totals của account.move.line), base = round(đơn giá sau CK × quantity), thuế = float_round(base × amount/100,
// precision_rounding = 1.0 — res.currency VND rounding 1.00), price_subtotal = total_excluded; tổng chứng từ: tiền trước thuế = Σ
// price_subtotal, thuế của nhóm = round(Σ thuế dòng cùng nhóm). Đối chiếu Odoo 18.0 (_add_tax_details_in_base_line) cho cùng kết
// quả; mức 8% lấy theo l10n_vn 18.0 (tax_group_8). Chạy lại: python3 test/fixtures/odoo-round-per-line.py <đường dẫn float_utils.py>.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');
const TAX = require('../src/crm/tax'); const P = require('../src/crm/print');
const FX = require('./fixtures/odoo-round-per-line.json'); const SAMPLES = FX.samples;
const TYPES = ['quote', 'sale_order', 'invoice', 'credit_note', 'purchase_order', 'vendor_bill'];
const DAY = '2026-10-23';
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-tax41-')), 'crm.db');
const byRate = (gs) => gs.map(g => [g.rate, g.base, g.tax]).sort((a, b) => a[0] - b[0]);
const want = (s) => ({ untaxed: s.odoo.amount_untaxed, tax: s.odoo.amount_tax, total: s.odoo.amount_total, groups: byRate(s.odoo.tax_groups), lines: s.odoo.lines.map(l => l.price_subtotal) });

async function setup(file) {
  const db = await openDb(file || tmp());
  const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => DAY });
  const cus = crm.saveContact({ name: 'Công ty TNHH Sen Vàng', kind: 'company', tax_id: '0312345678' });
  const ven = crm.saveContact({ name: 'Công ty Gỗ Bình Dương', kind: 'company', tax_id: '3701234567' });
  return { db, crm, biz, cus, ven };
}
// tạo chứng từ loại `type` với các dòng của mẫu bằng đúng luồng nghiệp vụ; trả về [loại in, id, số liệu đọc lại]
function make({ crm, biz, cus, ven }, type, s) {
  const lines = s.lines.map(l => ({ name: l.name, unit: 'cái', qty: l.qty, price: l.price, discount_pct: l.discount_pct, vat_pct: l.vat_pct }));
  const ofQ = (o) => ({ untaxed: o.subtotal, tax: o.vat, total: o.total, groups: byRate(o.tax_groups), lines: o.lines.map(l => TAX.lineSubtotal(l, TAX.roundingOf(o.tax_rounding))), rounding: o.tax_rounding });
  const ofI = (i) => ({ untaxed: i.amount_untaxed, tax: i.amount_tax, total: i.amount_total, groups: byRate(i.tax_groups), lines: i.lines.map(l => l.amount), rounding: i.tax_rounding });
  if (type === 'quote') { const q = crm.saveQuote({ contact_id: cus.id, lines }); assert.deepStrictEqual(ofQ(biz.getOrder(q.id)), ofQ(q)); return ['quote', q.id, ofQ(q)]; }
  if (type === 'sale_order') {
    const q = crm.saveQuote({ contact_id: cus.id, lines }); biz.confirmOrder(q.id); const o = biz.getOrder(q.id); assert.strictEqual(o.status, 'sale');
    const inv = biz.invoiceOrder(q.id); const { rounding, ...a } = ofI(inv); const { rounding: r2, ...b } = ofQ(o); assert.deepStrictEqual(a, b, 'hoá đơn lập từ đơn bán = đơn bán');
    return ['quote', q.id, ofQ(o)];
  }
  if (type === 'purchase_order') { const o = biz.savePurchase({ partner_id: ven.id, lines }); biz.confirmPurchase(o.id); const p = biz.getPurchase(o.id); assert.strictEqual(p.state, 'purchase'); return ['purchase', o.id, ofQ(p)]; }
  const side = type === 'vendor_bill' ? 'in_invoice' : 'out_invoice';
  const inv = biz.saveInvoice({ partner_id: side === 'in_invoice' ? ven.id : cus.id, kind: side, lines }); biz.postInvoice(inv.id);
  if (type === 'credit_note') { const r = biz.creditNote(inv.id, {}); biz.postInvoice(r.id); const g = biz.getInvoice(r.id); assert.strictEqual(g.kind, 'out_refund'); return ['invoice', r.id, ofI(g)]; }
  const g = biz.getInvoice(inv.id); assert.strictEqual(g.state, 'posted'); return ['invoice', inv.id, ofI(g)];
}

test('10 mẫu Odoo round_per_line: thành tiền từng dòng, thuế từng dòng, nhóm thuế và tổng — lệch 0 ₫', () => {
  assert.strictEqual(SAMPLES.length, 10);
  const rates = new Set(); let lines = 0;
  for (const s of SAMPLES) {
    s.lines.forEach((l, i) => { assert.strictEqual(TAX.lineSubtotal(l, 'line'), s.odoo.lines[i].price_subtotal, `${s.id} dòng ${i + 1}: thành tiền`); assert.strictEqual(TAX.lineTax(l, 'line'), s.odoo.lines[i].tax, `${s.id} dòng ${i + 1}: thuế`); lines++; rates.add(l.vat_pct); });
    const t = TAX.totals(s.lines, 'line');
    assert.deepStrictEqual([t.amount_untaxed, t.amount_tax, t.amount_total], [s.odoo.amount_untaxed, s.odoo.amount_tax, s.odoo.amount_total], s.id);
    assert.deepStrictEqual(byRate(t.tax_groups), byRate(s.odoo.tax_groups), s.id + ': nhóm thuế');
    assert.strictEqual(s.odoo.amount_total, s.odoo.amount_untaxed + s.odoo.amount_tax);
  }
  assert.deepStrictEqual([...rates].sort((a, b) => a - b), [0, 5, 8, 10]); assert.ok(lines >= 40);
  assert.deepStrictEqual([...new Set(SAMPLES.map(s => s.doc))].sort(), ['credit_note', 'invoice', 'purchase_order', 'quote', 'sale_order', 'vendor_bill']);
  // công thức cũ (Math.round(SL × giá × (1 − CK))) lệch Odoo ở các mẫu số thực ,4999… → mẫu thật sự kiểm được điều cần kiểm
  const old = SAMPLES.filter(s => s.lines.reduce((a, l) => a + TAX.lineSubtotal(l, 'global'), 0) !== s.odoo.amount_untaxed).map(s => s.id);
  assert.ok(old.length >= 5, 'mẫu phải có trường hợp công thức cũ sai: ' + old);
  // làm tròn kiểu Odoo (float_round): nửa đơn vị lên xa số 0, nhận ra ,4999… là ,5
  assert.deepStrictEqual([TAX.floatRound(2.5), TAX.floatRound(-2.5), TAX.floatRound(0.5), TAX.floatRound(1.4999999999999998), TAX.floatRound(1.49), TAX.floatRound(5.25), TAX.floatRound(0)], [3, -3, 1, 2, 1, 5, 0]);
  assert.strictEqual(Math.round(50 * (1 - 67 / 100)), 16); assert.strictEqual(TAX.floatRound((50 * (1 - 67 / 100.0)) * 1), 17); // Odoo: 16,5 → 17
});

test('Đủ 6 loại chứng từ × 10 mẫu (báo giá, đơn bán, hoá đơn, giấy báo có, đơn mua, hoá đơn NCC): số lưu và đọc lại = Odoo, lệch 0 ₫', async () => {
  const ctx = await setup(); let n = 0;
  for (const s of SAMPLES) for (const type of TYPES) {
    const [, , got] = make(ctx, type, s); assert.strictEqual(got.rounding, 'line', `${s.id}/${type}: chứng từ mới làm tròn theo dòng`);
    const { rounding, ...g } = got; assert.deepStrictEqual(g, want(s), `${s.id} / ${type}`); n++;
  }
  assert.strictEqual(n, 60);
  // báo cáo khớp chứng từ: doanh số (đơn đã xác nhận), phân tích hoá đơn + công nợ phải thu, phải trả
  const sum = (k) => SAMPLES.reduce((a, s) => a + s.odoo[k], 0);
  const sr = ctx.biz.salesReport({}); assert.strictEqual(sr.totals.untaxed, sum('amount_untaxed')); assert.strictEqual(sr.totals.total, sum('amount_total'));
  const ir = ctx.biz.invoiceReport({}); // hoá đơn khách: mẫu loại invoice, sale_order chưa vào sổ, credit_note (hoá đơn + giấy báo có = 0)
  assert.deepStrictEqual([ir.totals.untaxed, ir.totals.tax, ir.totals.total], [sum('amount_untaxed'), sum('amount_tax'), sum('amount_total')]);
  assert.strictEqual(ir.agedTotals.total, sum('amount_total'), 'phải thu: mỗi mẫu một hoá đơn đã vào sổ; cặp hoá đơn + giấy báo có tự đối trừ = 0');
  const pr = ctx.biz.payablesReport({}); assert.strictEqual(pr.agedTotals.total, sum('amount_total')); assert.strictEqual(pr.totals.total, sum('amount_total'));
});

const LOC = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN' };
const LBL = { vi: ['Thuế GTGT', 'trên', 'Cộng tiền hàng', 'Tổng cộng thanh toán'], en: ['VAT', 'on', 'Untaxed amount', 'Total amount'], zh: ['增值税', '基数', '未税金额', '应付总额'] };
const money = (n, L) => `${Math.round(n).toLocaleString(LOC[L])} ₫`;
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<title>[\s\S]*?<\/title>/, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// dòng thuế trong PDF: “VAT 8% (on 999,999 ₫) 80,000 ₫” — mỗi mức đúng một dòng
const taxRowRe = (L, g) => new RegExp(`${rx(LBL[L][0])} ${g.rate}% \\(${rx(LBL[L][1])} ${rx(money(g.base, L))}\\)\\s+${rx(money(g.tax, L))}`);

test('PDF (HTML in) vi/en/zh: mỗi mức thuế một dòng “Thuế GTGT x% (trên …)” đúng số Odoo; thành tiền từng dòng; 6 loại chứng từ', async () => {
  const ctx = await setup(); let n = 0;
  const jobs = SAMPLES.map(s => [s, s.doc]).concat(TYPES.map(t => [SAMPLES[0], t]));
  for (const [s, type] of jobs) {
    const [kind, id] = make(ctx, type, s); const w = want(s);
    for (const L of ['vi', 'en', 'zh']) {
      const html = P.renderDoc(ctx.biz, ctx.crm, kind, id, L).html; const v = visible(html);
      for (const g of s.odoo.tax_groups) { assert.match(v, taxRowRe(L, g), `${s.id}/${type}/${L}: thiếu dòng thuế ${g.rate}%`); }
      assert.strictEqual((v.match(new RegExp(`${rx(LBL[L][0])} \\d+% \\(`, 'g')) || []).length, s.odoo.tax_groups.length, `${s.id}/${type}/${L}: số dòng thuế`);
      assert.match(v, new RegExp(`${rx(LBL[L][2])} ${rx(money(w.untaxed, L))}`), `${s.id}/${type}/${L}: tiền trước thuế`);
      assert.match(v, new RegExp(`${rx(LBL[L][3])} ${rx(money(w.total, L))}`), `${s.id}/${type}/${L}: tổng`);
      for (const a of w.lines) assert.ok(v.includes(money(a, L)), `${s.id}/${type}/${L}: thành tiền dòng ${a}`);
      if (L !== 'vi') assert.ok(!/Thuế GTGT|trên \d/.test(v), `${s.id}/${type}/${L}: còn chữ tiếng Việt ở dòng thuế`);
      n++;
    }
  }
  assert.strictEqual(n, 48);
});

// ---- dữ liệu của bản ĐÃ PHÁT HÀNH trước thuế theo dòng (v0.16.0-beta.3: một mức thuế cho cả chứng từ, làm tròn gộp)
const LEGACY_TAG = 'v0.16.0-beta.3';
const hasGit = spawnSync('git', ['cat-file', '-e', `${LEGACY_TAG}:src/crm/biz.js`], { cwd: ROOT }).status === 0;
test(`Dữ liệu cũ (${LEGACY_TAG}, một mức thuế): mở bằng bản mới giữ nguyên tổng từng chứng từ, báo cáo bán hàng + công nợ phải thu không đổi; in ra cùng số`, { skip: !hasGit && `cần git tag ${LEGACY_TAG}` }, async () => {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-tax41-old-'));
  const tar = spawnSync('sh', ['-c', `git archive ${LEGACY_TAG} src/crm | tar -x -C "${old}"`], { cwd: ROOT }); assert.strictEqual(tar.status, 0, String(tar.stderr));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(old, 'node_modules'), 'dir');
  const O = (m) => require(path.join(old, 'src/crm', m));
  const file = tmp(); const db = await O('db').openDb(file);
  const crm = O('crm').createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = O('biz').createBiz({ db, crm, today: () => DAY });
  const cus = crm.saveContact({ name: 'Công ty TNHH Sen Vàng', kind: 'company' });
  const docs = []; const vats = [10, 8, 5, 0];
  // các mẫu có số thực ,4999… (công thức cũ khác Odoo) — đúng loại dữ liệu dễ bị lệch nếu bản mới tính lại
  SAMPLES.forEach((s, i) => {
    const lines = s.lines.map(l => ({ name: l.name, unit: 'cái', qty: l.qty, price: l.price, discount_pct: l.discount_pct })); const vat_pct = vats[i % 4];
    const q = crm.saveQuote({ contact_id: cus.id, vat_pct, lines });
    if (i % 2 === 0) { biz.confirmOrder(q.id); const inv = biz.invoiceOrder(q.id); biz.postInvoice(inv.id); if (i % 4 === 0) biz.registerPayment(inv.id, { amount: 1000, date: DAY }); if (i === 4) biz.postInvoice(biz.creditNote(inv.id, {}).id); docs.push(['invoice', inv.id]); }
    else { const inv = biz.saveInvoice({ partner_id: cus.id, vat_pct, lines }); if (i !== 9) biz.postInvoice(inv.id); docs.push(['invoice', inv.id]); }
    docs.push(['quote', q.id]);
  });
  const inv0 = db.all('SELECT id, amount_untaxed, amount_tax, amount_total, amount_paid, state FROM invoices ORDER BY id');
  const q0 = Object.fromEntries(db.all('SELECT id FROM quotes').map(r => { const q = crm.getQuote(r.id); return [r.id, [q.subtotal, q.vat, q.total]]; }));
  const rep0 = { sales: ['month', 'customer', 'product'].map(g => biz.salesReport({ groupBy: g })), inv: biz.invoiceReport({}) };
  // bản cũ thật sự làm tròn gộp, khác Odoo theo dòng ở ít nhất một chứng từ (nếu không, test này không chứng minh gì)
  assert.ok(Object.values(q0).some(([u], i) => u !== SAMPLES[i].odoo.amount_untaxed));
  db.close();

  const db2 = await openDb(file); const crm2 = createCrm({ db: db2 }); const biz2 = createBiz({ db: db2, crm: crm2, today: () => DAY });
  assert.deepStrictEqual(db2.all('SELECT id, amount_untaxed, amount_tax, amount_total, amount_paid, state FROM invoices ORDER BY id'), inv0, 'số đã lưu không đổi khi nâng cấp');
  for (const r of inv0) {
    const g = biz2.getInvoice(r.id); assert.strictEqual(g.tax_rounding, 'global');
    assert.deepStrictEqual([g.amount_untaxed, g.amount_tax, g.amount_total], [r.amount_untaxed, r.amount_tax, r.amount_total]);
    assert.strictEqual(g.tax_groups.length, 1, 'một mức thuế'); assert.deepStrictEqual([g.tax_groups[0].base, g.tax_groups[0].tax], [r.amount_untaxed, r.amount_tax], 'nhóm thuế tính lại = số cũ');
    assert.strictEqual(g.lines.reduce((a, l) => a + l.amount, 0), r.amount_untaxed);
    for (const L of ['vi', 'en', 'zh']) { const v = visible(P.renderDoc(biz2, crm2, 'invoice', r.id, L).html); assert.match(v, new RegExp(`${rx(LBL[L][3])} ${rx(money(r.amount_total, L))}`), `PDF ${L}: tổng cũ`); assert.match(v, new RegExp(`${rx(money(r.amount_tax, L))}`)); }
  }
  for (const [id, t] of Object.entries(q0)) { const q = crm2.getQuote(id); assert.deepStrictEqual([q.subtotal, q.vat, q.total], t, 'báo giá/đơn cũ giữ tổng'); assert.deepStrictEqual([biz2.getOrder(id).subtotal, biz2.getOrder(id).total], [t[0], t[2]]); }
  // sửa hoá đơn nháp cũ (tính lại) vẫn theo cách cũ → không lệch
  const draft = inv0.find(r => r.state === 'draft'); const d2 = biz2.saveInvoice({ id: draft.id, notes: 'sửa sau nâng cấp' });
  assert.deepStrictEqual([d2.amount_untaxed, d2.amount_tax, d2.amount_total], [draft.amount_untaxed, draft.amount_tax, draft.amount_total]);
  // báo cáo: cùng số từng nhóm
  const pick = (r) => ({ rows: r.rows.map(x => [x.key, x.orders, x.qty, x.untaxed, x.total]), totals: r.totals });
  ['month', 'customer', 'product'].forEach((g, i) => assert.deepStrictEqual(pick(biz2.salesReport({ groupBy: g })), pick(rep0.sales[i]), 'báo cáo bán hàng theo ' + g));
  const ir = biz2.invoiceReport({});
  assert.deepStrictEqual(ir.totals, rep0.inv.totals, 'phân tích hoá đơn'); assert.deepStrictEqual(ir.byMonth, rep0.inv.byMonth);
  assert.deepStrictEqual(ir.agedTotals, rep0.inv.agedTotals, 'công nợ phải thu theo tuổi nợ'); assert.deepStrictEqual(ir.aged.map(a => ({ ...a })), rep0.inv.aged.map(a => ({ ...a })));
  db2.close();
  // chứng từ mới tạo trên dữ liệu đã nâng cấp: theo dòng (Odoo)
  const db3 = await openDb(file); const crm3 = createCrm({ db: db3 }); const biz3 = createBiz({ db: db3, crm: crm3, today: () => DAY });
  const s = SAMPLES[2]; const n = biz3.saveInvoice({ partner_id: cus.id, lines: s.lines }); assert.strictEqual(n.tax_rounding, 'line'); assert.strictEqual(n.amount_total, s.odoo.amount_total);
  db3.close(); fs.rmSync(old, { recursive: true, force: true });
});

test('Chứng từ làm tròn gộp (global) ở cả 6 loại: dùng đúng công thức cũ — không đổi tổng; công nợ phải trả khớp', async () => {
  const ctx = await setup(); const { db, biz } = ctx;
  for (const s of SAMPLES.slice(2, 7)) for (const type of TYPES) {
    const [kind, id] = make(ctx, type, s);
    const tbl = kind === 'quote' ? 'quotes' : kind === 'purchase' ? 'purchase_orders' : 'invoices'; db.run(`UPDATE ${tbl} SET tax_rounding = 'global' WHERE id = ?`, [id]);
    const legacy = TAX.totals(s.lines, 'global');
    const un = s.lines.reduce((a, l) => a + Math.round(l.qty * l.price * (1 - l.discount_pct / 100)), 0); assert.strictEqual(legacy.amount_untaxed, un);
    const g = kind === 'quote' ? biz.getOrder(id) : kind === 'purchase' ? biz.getPurchase(id) : biz.getInvoice(id);
    assert.deepStrictEqual(byRate(g.tax_groups), byRate(legacy.tax_groups), `${s.id}/${type}`);
    if (kind !== 'invoice') assert.deepStrictEqual([g.subtotal, g.vat, g.total], [legacy.amount_untaxed, legacy.amount_tax, legacy.amount_total], `${s.id}/${type}`);
  }
});

// ---- PDF thật (Electron printToPDF như ứng dụng) + màn hình thật (ứng dụng chạy dưới xvfb-run -a)
const EL = path.join(ROOT, 'node_modules/.bin/electron');
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(EL);
const hasPdf = hasX && spawnSync('which', ['pdftotext']).status === 0;
test('PDF thật (Electron): mẫu 4 mức thuế ở 6 loại chứng từ + mẫu số lẻ ,5 × vi/en/zh — dòng thuế từng mức đúng số Odoo', { skip: !hasPdf && 'cần xvfb-run + electron + pdftotext', timeout: 240e3 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-tax41-pdf-')); const script = path.join(dir, 'gen.js');
  const jobs = TYPES.map(t => ['S1', t]).concat([['S3', 'invoice'], ['S10', 'invoice']]);
  fs.writeFileSync(script, `
const { app, BrowserWindow } = require('electron'); const fs = require('fs'); const path = require('path');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const R = ${JSON.stringify(ROOT)}; const OUT = ${JSON.stringify(dir)};
    const { toPdf } = require(R + '/src/biz-pdf').registerBizPdf({ ipcMain: { handle() {} }, BrowserWindow, dialog: {}, shell: {}, getWin: () => null, getCrm: async () => null, T: s => s, uiLang: () => 'vi', log: () => {} });
    const docs = JSON.parse(fs.readFileSync(path.join(OUT, 'docs.json'), 'utf8')); const { biz, crm } = await require(path.join(OUT, 'mk.js'))(docs);
    const P = require(R + '/src/crm/print');
    for (const L of ['vi', 'en', 'zh']) for (const d of docs) { const r = P.renderDoc(biz, crm, d.kind, d.id, L); fs.writeFileSync(path.join(OUT, L + '-' + d.key + '.pdf'), await toPdf(r.html, { title: r.title, number: r.number, lang: L })); }
    fs.writeFileSync(path.join(OUT, 'done'), '1');
  } catch (e) { fs.writeFileSync(path.join(OUT, 'error.txt'), String(e && e.stack || e)); }
  app.exit(0);
});`);
  // chứng từ tạo ngay trong tiến trình Electron bằng cùng mã nguồn và cùng mẫu
  fs.writeFileSync(path.join(dir, 'mk.js'), `
const R = ${JSON.stringify(ROOT)}; const { openDb } = require(R + '/src/crm/db'); const { createCrm } = require(R + '/src/crm/crm'); const { createBiz } = require(R + '/src/crm/biz');
const S = require(R + '/test/fixtures/odoo-round-per-line.json').samples;
module.exports = async (docs) => { const db = await openDb(${JSON.stringify(path.join(dir, 'crm.db'))}); const crm = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm, today: () => ${JSON.stringify(DAY)} });
  const cus = crm.saveContact({ name: 'Công ty TNHH Sen Vàng', kind: 'company' }); const ven = crm.saveContact({ name: 'Công ty Gỗ Bình Dương', kind: 'company' });
  for (const d of docs) { const s = S.find(x => x.id === d.sample); const lines = s.lines.map(l => ({ ...l, unit: 'cái' }));
    if (d.type === 'quote' || d.type === 'sale_order') { d.kind = 'quote'; d.id = crm.saveQuote({ contact_id: cus.id, lines }).id; if (d.type === 'sale_order') biz.confirmOrder(d.id); }
    else if (d.type === 'purchase_order') { d.kind = 'purchase'; d.id = biz.savePurchase({ partner_id: ven.id, lines }).id; biz.confirmPurchase(d.id); }
    else { d.kind = 'invoice'; const k = d.type === 'vendor_bill' ? 'in_invoice' : 'out_invoice'; const i = biz.saveInvoice({ partner_id: k === 'in_invoice' ? ven.id : cus.id, kind: k, lines }); biz.postInvoice(i.id); d.id = i.id;
      if (d.type === 'credit_note') { d.id = biz.creditNote(i.id, {}).id; biz.postInvoice(d.id); } } }
  return { biz, crm }; };`);
  fs.writeFileSync(path.join(dir, 'docs.json'), JSON.stringify(jobs.map(([sample, type]) => ({ key: sample + '-' + type, sample, type }))));
  const r = spawnSync('timeout', ['200', 'xvfb-run', '-a', EL, script, '--no-sandbox'], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(!fs.existsSync(path.join(dir, 'error.txt')), fs.existsSync(path.join(dir, 'error.txt')) ? fs.readFileSync(path.join(dir, 'error.txt'), 'utf8') : '');
  assert.ok(fs.existsSync(path.join(dir, 'done')), 'Electron không xuất xong: ' + (r.stderr || '').slice(-600));
  let n = 0;
  for (const L of ['vi', 'en', 'zh']) for (const [sid, type] of jobs) {
    const s = SAMPLES.find(x => x.id === sid); const f = path.join(dir, `${L}-${sid}-${type}.pdf`); assert.strictEqual(fs.readFileSync(f).subarray(0, 5).toString(), '%PDF-');
    const t = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout.replace(/[ \t]+/g, ' ').replace(/(\d)₫/g, '$1 ₫'); // pdftotext đôi khi dính “0₫” (HTML là “0 ₫”)
    for (const g of s.odoo.tax_groups) assert.match(t, taxRowRe(L, g), `${f}: dòng thuế ${g.rate}%`);
    assert.match(t, new RegExp(`${rx(LBL[L][3])}\\s+${rx(money(s.odoo.amount_total, L))}`), f + ': tổng');
    assert.match(t, new RegExp(`${rx(LBL[L][2])}\\s+${rx(money(s.odoo.amount_untaxed, L))}`), f + ': tiền trước thuế');
    n++;
  }
  assert.strictEqual(n, 24);
});

test('Màn hình thật (ứng dụng + xvfb) vi/en/zh: ô tổng tách thuế 0/5/8/10% đúng số Odoo ở 6 loại chứng từ; hoá đơn gõ tay tính đúng trước và sau khi lưu', { skip: !hasX && 'cần xvfb-run + electron', timeout: 420e3 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-tax41-ui-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-tax41-ud-'));
  const docs = TYPES.map(t => ({ key: 'T-' + t, sample: 'S1', doc: t })).concat(SAMPLES.map(s => ({ key: s.id, sample: s.id, doc: s.doc, typed: s.id === 'S3' })));
  for (const d of docs) d.lines = SAMPLES.find(s => s.id === d.sample).lines;
  fs.writeFileSync(path.join(dir, 'docs.json'), JSON.stringify(docs));
  const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_PURCHASE: dir, AIVN_QA_TAX41: path.join(dir, 'docs.json') });
  const r = spawnSync('timeout', ['400', 'xvfb-run', '-a', '-s', '-screen 0 1366x900x24', EL, '.', '--no-sandbox'], { cwd: ROOT, encoding: 'utf8', env });
  const f = path.join(dir, 'qatax41.json'); assert.ok(fs.existsSync(f), 'QA thuế không chạy xong: ' + (r.stderr || '').slice(-800));
  const o = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!o.error, o.error); assert.deepStrictEqual(o.errs, []);
  const dig = (s) => Number(String(s).replace(/[^\d]/g, ''));
  const check = (scr, s, where, L) => {
    assert.ok(scr, where + ': không thấy ô tổng');
    const w = want(s); const taxes = scr.rows.filter(x => /\d+\s*%/.test(x.label));
    assert.strictEqual(dig(scr.rows[0].value), w.untaxed, where + ': tiền trước thuế');
    assert.deepStrictEqual(taxes.map(x => [Number(x.label.match(/(\d+)\s*%/)[1]), dig(x.label.replace(/^.*?%/, '')), dig(x.value)]), w.groups, where + ': thuế theo mức');
    assert.strictEqual(dig(scr.rows[1 + taxes.length].value), w.total, where + ': tổng cộng');
    assert.deepStrictEqual(scr.lines.map(dig), w.lines, where + ': thành tiền từng dòng');
    if (L !== 'vi') assert.deepStrictEqual(scr.left, [], where + ': còn tiếng Việt trong ô tổng');
    const lab = { vi: /^Thuế GTGT \d+% trên /, en: /^VAT \d+% on /, zh: /^增值税 \d+% 基数/ }[L]; for (const x of taxes) assert.match(x.label, lab, where);
  };
  for (const L of ['vi', 'en', 'zh']) {
    for (const d of docs) check(o.screens[L][d.key], SAMPLES.find(s => s.id === d.sample), `${L}/${d.key}/${d.doc}`, L);
    const t = o.typed[L]; assert.ok(t, L + ': thiếu hoá đơn gõ tay'); const s = SAMPLES.find(x => x.id === t.key);
    check(t.draft, s, `${L}/gõ tay (nháp, giao diện tự tính)`, L); check(t.saved, s, `${L}/gõ tay (đã lưu)`, L);
    assert.deepStrictEqual([t.stored.amount_untaxed, t.stored.amount_tax, t.stored.amount_total], [s.odoo.amount_untaxed, s.odoo.amount_tax, s.odoo.amount_total], L + ': số lưu của hoá đơn gõ tay');
  }
});
