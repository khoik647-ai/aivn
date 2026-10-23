'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { setup, tick } = require('./v016-adv90-harness');

test('ADV-R1 mở A rồi B nhanh, A trả về NHANH hơn B (B chậm) → cuối cùng B', async () => {
  const { ctx, B, body, delay, settle, invA, invB } = await setup();
  delay[invB.id] = 50; delay[invA.id] = 0;
  B.form = { type: 'invoice', id: invA.id }; B.edit = null; ctx.renderCrm();
  await tick(1);
  B.form = { type: 'invoice', id: invB.id }; B.edit = null; ctx.renderCrm();
  await settle(); await tick(70);
  assert.strictEqual(B.edit.id, invB.id); assert.match(body().innerHTML, /Dòng của B/); assert.ok(!/Dòng của A/.test(body().innerHTML));
});

test('ADV-R2 mở A, B, A, B liên tiếp với độ trễ ngẫu nhiên (50 vòng) → editor và màn hình luôn là chứng từ cuối', async () => {
  const { ctx, B, body, delay, settle, invA, invB } = await setup();
  for (let k = 0; k < 50; k++) {
    const seq = Array.from({ length: 2 + (k % 4) }, (_, i) => (i + k) % 2 ? invB : invA);
    for (const d of seq) { delay[invA.id] = Math.floor(Math.random() * 15); delay[invB.id] = Math.floor(Math.random() * 15); B.form = { type: 'invoice', id: d.id }; B.edit = null; ctx.renderCrm(); if (Math.random() < 0.5) await tick(Math.floor(Math.random() * 5)); }
    await settle(); await tick(30);
    const last = seq[seq.length - 1];
    assert.strictEqual(B.edit.id, last.id, 'vòng ' + k); assert.match(body().innerHTML, last === invA ? /Dòng của A/ : /Dòng của B/);
  }
});

test('ADV-R3 chuyển thẻ nhanh invoices→stock→reports→sales (danh sách chậm) → chỉ lượt cuối ghi DOM', async () => {
  const { ctx, B, body, delay, settle } = await setup();
  delay['fn:listInvoices'] = 40; delay['fn:listStock'] = 30; delay['fn:salesReport'] = 20; delay['fn:listQuotes'] = 0; delay['fn:listOrders'] = 0;
  const writes = []; let html = '';
  Object.defineProperty(body(), 'innerHTML', { get: () => html, set: (v) => { html = v; writes.push(ctx.crm.tab); } });
  for (const t of ['invoices', 'stock', 'reports', 'sales']) { ctx.crm.tab = t; B.form = null; B.edit = null; ctx.renderCrm(); }
  await settle(); await tick(80);
  assert.deepStrictEqual(writes, ['sales'], 'số lần ghi DOM: ' + JSON.stringify(writes));
  assert.ok(!/⚠/.test(html), html.slice(0, 200));
});

test('ADV-R4 đang chờ vẽ Kinh doanh thì chuyển sang Tổng quan và lượt chờ LỖI → không được ghi lỗi đè Tổng quan', async () => {
  const { ctx, B, body, delay, settle } = await setup();
  delay['nope'] = 30; B.form = { type: 'invoice', id: 'nope' }; B.edit = null; ctx.renderCrm();
  ctx.crm.tab = 'dash'; body().innerHTML = 'TONG-QUAN';
  await settle(); await tick(50);
  assert.strictEqual(body().innerHTML, 'TONG-QUAN', 'bị ghi đè: ' + body().innerHTML);
});

test('ADV-R5 rời Kinh doanh rồi quay lại cùng thẻ trước khi lượt cũ xong → chỉ lượt mới ghi, B.edit đúng', async () => {
  const { ctx, B, body, delay, settle, invA, invB } = await setup();
  delay[invA.id] = 40; B.form = { type: 'invoice', id: invA.id }; B.edit = null; ctx.renderCrm();
  ctx.crm.tab = 'dash'; await tick(5); ctx.crm.tab = 'invoices';
  delay[invB.id] = 0; B.form = { type: 'invoice', id: invB.id }; B.edit = null; ctx.renderCrm();
  await settle(); await tick(60);
  assert.strictEqual(B.edit.id, invB.id); assert.match(body().innerHTML, /Dòng của B/);
});

test('ADV-R6 đang sửa A (B.edit đã có thay đổi) rồi show("crm") vẽ lại → giữ thay đổi chưa lưu', async () => {
  const { ctx, B, body, settle, invA } = await setup();
  B.form = { type: 'invoice', id: invA.id }; B.edit = null; ctx.renderCrm(); await settle();
  B.edit.notes = 'GHI-CHU-CHUA-LUU'; ctx.show('crm'); ctx.show('crm'); await settle();
  assert.strictEqual(B.edit.notes, 'GHI-CHU-CHUA-LUU'); assert.strictEqual(B.edit.id, invA.id);
});
