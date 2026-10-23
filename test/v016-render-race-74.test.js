'use strict';
// #74 (B204): show('crm') và renderCrm() trong cùng một tick — lượt vẽ cũ không được làm editor (B.edit) trỏ về chứng từ trước, không được ghi đè màn hình.
// Chạy src/renderer/biz.js thật trong vm với DOM tối thiểu; dữ liệu từ src/crm thật (SQLite tạm), độ trễ IPC điều khiển được.
// wip-0.16 chưa có Mua hàng: renderCrm giả lập đúng nhánh biz của app.js (BIZ.tabs), không nạp num.js/uom.js (chưa có trên nhánh này).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const vm = require('vm');
const { openDb } = require('../src/crm/db'); const { createCrm } = require('../src/crm/crm'); const { createBiz } = require('../src/crm/biz');

const tick = (ms) => new Promise(r => setTimeout(r, ms));

async function setup() {
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-race74-')), 'crm.db'));
  const crmApi = createCrm({ db, defaultOwner: () => 'Khôi' }); const biz = createBiz({ db, crm: crmApi, today: () => '2026-10-23' });
  const an = crmApi.saveContact({ name: 'Công ty An Phát', kind: 'company' }); const binh = crmApi.saveContact({ name: 'Công ty Bình Minh', kind: 'company' });
  const invA = biz.saveInvoice({ partner_id: an.id, lines: [{ name: 'Dòng của A', unit: 'cái', qty: 1, price: 1000000 }] });
  const invB = biz.saveInvoice({ partner_id: binh.id, lines: [{ name: 'Dòng của B', unit: 'cái', qty: 2, price: 500000 }] });
  const soA = crmApi.saveQuote({ contact_id: an.id, lines: [{ name: 'Báo giá A', qty: 1, price: 100000 }] });
  const soB = crmApi.saveQuote({ contact_id: binh.id, lines: [{ name: 'Báo giá B', qty: 3, price: 200000 }] });
  const delay = {}; // id chứng từ → ms trễ (giả lập IPC chậm)
  const call = async (fn, ...a) => {
    const d = delay[a[0]] || 0; await tick(d);
    try { const t = typeof biz[fn] === 'function' ? biz : crmApi; return { ok: true, data: JSON.parse(JSON.stringify(t[fn](...a) ?? null)) }; } catch (e) { return { ok: false, error: e.message }; }
  };
  const els = {}; const elem = () => ({ innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, isConnected: true, dataset: {}, addEventListener() {}, querySelectorAll: () => [], classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {} });
  const ctx = { console, setTimeout, Promise, Symbol, Object, JSON, Math, Number, String, Array, Map, Set, Date, Error, Intl, isNaN, encodeURIComponent };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.document = { addEventListener() {}, createElement: () => elem(), body: elem() };
  ctx.$ = (sel) => (els[sel] ||= elem()); ctx.$$ = () => [];
  ctx.esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  ctx.toast = () => {}; ctx.modalAsk = async () => true; ctx.LOC = () => 'vi-VN'; ctx.UIL = () => 'vi';
  ctx.vnd = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')} ₫`;
  ctx.A = { crm: call }; ctx.C = async (fn, ...a) => { const r = await call(fn, ...a); if (!r.ok) throw new Error(r.error); return r.data; };
  ctx.crm = { tab: 'invoices' };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/biz.js'), 'utf8'), ctx);
  // renderCrm của app.js: thẻ Kinh doanh → BIZ.render(crm.tab); show('crm') gọi renderCrm()
  const renders = [];
  ctx.renderCrm = () => { const p = ctx.BIZ && ctx.BIZ.tabs.includes(ctx.crm.tab) ? ctx.BIZ.render(ctx.crm.tab) : Promise.resolve(); renders.push(p); return p; };
  ctx.show = (view) => { if (view === 'crm') ctx.renderCrm(); };
  const settle = async () => { while (renders.length) await renders.shift(); await tick(5); };
  return { biz, crmApi, ctx, B: ctx.BIZ.state, body: () => ctx.$('#crmBody'), delay, settle, invA, invB, soA, soB };
}

test('#74: show("crm") rồi đổi chứng từ + renderCrm() cùng tick → editor trỏ đúng chứng từ mới (độ trễ như nhau)', async () => {
  const { ctx, B, body, settle, invA, invB } = await setup();
  B.form = { type: 'invoice', id: invA.id }; B.edit = null; ctx.renderCrm(); await settle();
  assert.strictEqual(B.edit.id, invA.id); assert.match(body().innerHTML, /Dòng của A/);
  // cùng một tick: quay lại màn CRM (vẽ lại chứng từ A đang mở) rồi mở chứng từ B
  ctx.show('crm'); ctx.BIZ.reset(); B.form = { type: 'invoice', id: invB.id }; ctx.renderCrm();
  await settle();
  assert.strictEqual(B.form.id, invB.id);
  assert.strictEqual(B.edit.id, invB.id, 'B.edit phải là chứng từ B, không phải A (lượt vẽ cũ không được gán editor)');
  assert.deepStrictEqual(B.edit.lines.map(l => l.name), ['Dòng của B']);
  assert.match(body().innerHTML, /Dòng của B/); assert.ok(!/Dòng của A/.test(body().innerHTML), 'màn hình không còn nội dung chứng từ A');
});

test('#74: lượt vẽ cũ chậm hơn (A trả về sau B) → không ghi đè màn hình của lượt mới', async () => {
  const { biz, ctx, B, body, delay, settle, invA, invB, soA, soB } = await setup();
  // A đã vào sổ (có số), B còn nháp → nếu lượt vẽ A chậm ghi đè thì màn hình hiện số của A
  const numA = biz.postInvoice(invA.id).number; assert.ok(numA);
  const soNumA = biz.confirmOrder(soA.id).number; assert.ok(soNumA);
  B.form = { type: 'invoice', id: invA.id }; B.edit = null; ctx.renderCrm(); await settle();
  delay[invA.id] = 40;
  ctx.show('crm'); ctx.BIZ.reset(); B.form = { type: 'invoice', id: invB.id }; ctx.renderCrm();
  await settle(); await tick(60);
  assert.strictEqual(B.edit.id, invB.id); assert.match(body().innerHTML, /Dòng của B/); assert.ok(!/Dòng của A/.test(body().innerHTML) && !body().innerHTML.includes(numA), 'màn hình bị lượt vẽ A (chậm) ghi đè');
  // tương tự với báo giá (orderForm), lượt cũ chậm
  ctx.crm.tab = 'sales'; B.form = { type: 'order', id: soA.id }; B.edit = null; ctx.renderCrm(); await settle();
  delay[soA.id] = 40;
  ctx.show('crm'); ctx.BIZ.reset(); B.form = { type: 'order', id: soB.id }; ctx.renderCrm();
  await settle(); await tick(60);
  assert.strictEqual(B.edit.id, soB.id); assert.match(body().innerHTML, /Báo giá B/); assert.ok(!/Báo giá A/.test(body().innerHTML) && !body().innerHTML.includes(soNumA), 'màn hình bị lượt vẽ báo giá A (chậm) ghi đè');
});

test('#74: chuyển sang thẻ CRM thường khi lượt vẽ Kinh doanh còn chờ → không ghi đè #crmBody; lượt mới nhất vẫn vẽ bình thường', async () => {
  const { ctx, B, body, delay, settle, invA } = await setup();
  delay[invA.id] = 30; B.form = { type: 'invoice', id: invA.id }; B.edit = null; ctx.renderCrm();
  ctx.crm.tab = 'dash'; body().innerHTML = 'TONG-QUAN';
  await settle(); await tick(50);
  assert.strictEqual(body().innerHTML, 'TONG-QUAN');
  ctx.crm.tab = 'invoices'; delay[invA.id] = 0; ctx.renderCrm(); await settle();
  assert.strictEqual(B.edit.id, invA.id); assert.match(body().innerHTML, /Dòng của A/);
});
