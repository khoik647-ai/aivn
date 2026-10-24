'use strict';
// #74 (B204): show('crm') và renderCrm() trong cùng một tick — lượt vẽ cũ không được làm editor (B.edit) trỏ về chứng từ trước, không được ghi đè màn hình.
// Chạy src/renderer/biz.js thật trong vm với DOM tối thiểu; dữ liệu từ src/crm thật (SQLite tạm), độ trễ IPC điều khiển được.
// wip-0.16 chưa có Mua hàng: renderCrm giả lập đúng nhánh biz của app.js (BIZ.tabs), không nạp num.js/uom.js (chưa có trên nhánh này).
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
    const d = (typeof a[0] === 'string' && delay[a[0]]) || delay['fn:' + fn] || 0; await tick(d);
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

module.exports = { setup, tick };
