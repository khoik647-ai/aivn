// AIVN 0.16 — Kinh doanh: Bán hàng, Kho, Hoá đơn, Báo cáo (giao diện theo Odoo: danh sách → biểu mẫu có thanh trạng thái, nút thông minh, dòng sửa trực tiếp).
// Chạy sau app.js, dùng chung $, $$, esc, toast, modalAsk, C (gọi CRM), crm, vnd, LOC. Dữ liệu lưu trên máy (SQLite), không gửi đi đâu.
'use strict';
(() => {
  const APPS = {
    sales: { name: 'Bán hàng', subs: [['quotes', 'Báo giá'], ['orders', 'Đơn bán hàng'], ['toinv', 'Chờ lập hoá đơn'], ['products', 'Sản phẩm']] },
    stock: { name: 'Kho', subs: [['onhand', 'Tồn kho'], ['out', 'Phiếu giao hàng'], ['in', 'Phiếu nhập kho'], ['adj', 'Điều chỉnh tồn']] },
    invoices: { name: 'Hoá đơn', subs: [['inv', 'Hoá đơn khách hàng'], ['refund', 'Giấy báo có'], ['unpaid', 'Chưa thu'], ['overdue', 'Quá hạn']] },
    reports: { name: 'Báo cáo', subs: [['sales', 'Bán hàng'], ['invoice', 'Hoá đơn & công nợ'], ['stock', 'Tồn kho'], ['pipeline', 'Cơ hội']] },
  };
  const B = { sub: { sales: 'quotes', stock: 'onhand', invoices: 'inv', reports: 'sales' }, form: null, edit: null, products: [], contacts: [], rep: { groupBy: 'month', from: '', to: '' }, lastRows: null };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dt = (s) => s ? new Date(String(s).length === 10 ? s + 'T00:00:00' : s).toLocaleDateString(LOC()) : '';
  const qn = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString(LOC());
  // B50: cùng quy tắc với máy chủ (crm/text.parseQty): “1.000” = 1000, “1,5” = 1,5
  const parseQty = (v) => { const t = String(v ?? '').replace(/\s/g, ''); if (/^[-+]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.')); if (/^[-+]?\d+(?:,\d+)?$/.test(t)) return Number(t.replace(',', '.')); if (/^[-+]?\d*\.\d+$/.test(t)) return Number(t); return NaN; };
  const amt = (l) => Math.round((parseQty(l.qty) || 0) * (parseMoney(l.price)) * (1 - (Number(l.discount_pct) || 0) / 100));
  const parseMoney = (v) => typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d-]/g, '')) || 0;
  const badge = (txt, tone) => `<span class="biz-badge ${tone || ''}">${esc(txt)}</span>`;
  const TONE = { draft: '', sent: 'info', sale: 'ok', cancel: 'muted', ready: 'info', done: 'ok', posted: 'ok', not_paid: 'warn', partial: 'info', paid: 'ok', reversed: 'muted', to_invoice: 'warn', invoiced: 'ok', no: 'muted', pending: 'warn', full: 'ok', none: 'muted' };
  const PAY_TERMS = [[0, 'Thanh toán ngay'], [15, '15 ngày'], [30, '30 ngày'], [45, '45 ngày'], [60, '60 ngày']];
  const body = () => $('#crmBody');
  async function loadRefs() { [B.products, B.contacts] = await Promise.all([C('listProducts', {}), C('listContacts', {}).then(r => r.rows)]); }
  const opt = (list, cur, empty = '—') => `<option value="">${esc(empty)}</option>` + list.map(([v, n]) => `<option value="${esc(v)}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('');

  // ---------- khung: thanh menu phụ + đường dẫn ----------
  function subnav(app) {
    return `<nav class="biz-subnav" role="tablist" aria-label="${esc(APPS[app].name)}">${APPS[app].subs.map(([k, n]) => `<button type="button" role="tab" data-biz-sub="${k}" class="${B.sub[app] === k ? 'on' : ''}" aria-selected="${B.sub[app] === k}">${esc(n)}</button>`).join('')}</nav>`;
  }
  const crumbs = (parts) => `<div class="biz-crumbs">${parts.map((p, i) => i < parts.length - 1 ? `<a href="#" data-biz-back="${i}">${esc(p)}</a> <span class="muted">›</span> ` : `<b>${esc(p)}</b>`).join('')}</div>`;
  function statusbar(steps, cur) { return `<div class="biz-status" role="list">${steps.map(([k, n]) => `<span role="listitem" class="${k === cur ? 'on' : ''}" ${k === cur ? 'aria-current="step"' : ''}>${esc(n)}</span>`).join('')}</div>`; }
  const btn = (act, label, primary = false, extra = '') => `<button type="button" class="btn sm${primary ? ' primary' : ''}" data-biz-act="${act}" ${extra}>${esc(label)}</button>`;
  const smart = (act, icon, n, label) => `<button type="button" class="biz-smart" data-biz-act="${act}"><span>${icon}</span><b>${n}</b> ${esc(label)}</button>`;

  // #74 (B204): show('crm') tự vẽ lại (bất đồng bộ) với chứng từ đang mở; nếu cùng tick lại đổi B.form và gọi renderCrm(), lượt vẽ CŨ
  // chờ xong sau có thể gán B.edit của chứng từ trước (rồi lượt mới dùng nhầm B.edit đó) hoặc ghi đè màn hình. Mỗi lượt vẽ có số phiên;
  // sau mỗi lần chờ dữ liệu, lượt nào không còn là lượt mới nhất thì bỏ, không đụng B.edit hay #crmBody.
  let renderGen = 0;
  const STALE = Symbol('stale');
  const live = (gen) => { if (gen !== renderGen || !Object.hasOwn(APPS, crm.tab)) throw STALE; }; // đã chuyển sang thẻ CRM thường (Tổng quan, Liên hệ…) cũng là cũ
  async function render(app) {
    const gen = ++renderGen;
    const el = body(); const q = $('#crmQ').value.trim();
    $('#crmAdd').textContent = app === 'sales' ? (B.sub.sales === 'products' ? '＋ Sản phẩm' : '＋ Báo giá') : app === 'stock' ? '＋ Phiếu nhập kho' : app === 'invoices' ? '＋ Hoá đơn' : '⬇ Xuất CSV';
    try {
      if (B.form) return await renderForm(gen);
      let html = subnav(app);
      const s = B.sub[app];
      if (app === 'sales') html += s === 'products' ? await productList(q) : await orderList(s, q);
      else if (app === 'stock') html += s === 'onhand' ? await stockList(q) : await pickingList(s, q);
      else if (app === 'invoices') html += await invoiceList(s, q);
      else html += await reportView(s);
      live(gen); el.innerHTML = html;
    } catch (e) { if (e !== STALE && gen === renderGen) el.innerHTML = `<div class="empty-state">⚠ ${esc(e.message)}</div>`; }
  }
  const empty = (icon, text) => `<div class="empty-state"><div class="big">${icon}</div>${esc(text)}</div>`;

  // ---------- Bán hàng ----------
  async function orderList(s, q) {
    const rows = await C('listOrders', { q, kind: s === 'quotes' ? 'quotes' : 'orders', invoiceStatus: s === 'toinv' ? 'to_invoice' : '' });
    if (!rows.length) return empty('🧾', q ? 'Không có đơn nào khớp.' : s === 'quotes' ? 'Chưa có báo giá. Bấm “＋ Báo giá” để tạo báo giá đầu tiên.' : s === 'toinv' ? 'Không có đơn nào chờ lập hoá đơn.' : 'Chưa có đơn bán hàng. Xác nhận một báo giá để tạo đơn.');
    const sum = rows.reduce((a, r) => a + r.total, 0);
    return `<table class="crm-table biz-list"><thead><tr><th>Số</th><th>Ngày</th><th>Khách hàng</th><th>Phụ trách</th><th class="num">Tổng cộng</th><th>Trạng thái</th>${s !== 'quotes' ? '<th>Giao hàng</th><th>Hoá đơn</th>' : ''}</tr></thead><tbody>
      ${rows.map(r => `<tr data-biz-open="order:${esc(r.id)}" tabindex="0"><td><b>${esc(r.number)}</b></td><td>${dt(r.date)}</td><td>${esc(r.contact_name || '')}</td><td>${esc(r.owner || '')}</td><td class="num">${vnd(r.total)}</td><td>${badge(r.state_vi, TONE[r.status])}</td>${s !== 'quotes' ? `<td>${badge(r.delivery_status_vi, TONE[r.delivery_status])}</td><td>${badge(r.invoice_status_vi, TONE[r.invoice_status])}</td>` : ''}</tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">${rows.length} dòng</td><td class="num"><b>${vnd(sum)}</b></td><td colspan="${s !== 'quotes' ? 3 : 1}"></td></tr></tfoot></table>`;
  }
  async function productList(q) {
    const rows = await C('listProducts', { q }); const st = await C('listStock', {}); const by = Object.fromEntries(st.rows.map(r => [r.id, r]));
    if (!rows.length) return empty('📦', q ? 'Không có sản phẩm nào khớp.' : 'Chưa có sản phẩm. Bấm “＋ Sản phẩm”.');
    const TYPE = { product: 'Hàng lưu kho', consu: 'Hàng tiêu dùng', service: 'Dịch vụ' };
    return `<table class="crm-table biz-list"><thead><tr><th>Sản phẩm</th><th>Mã</th><th>Loại</th><th class="num">Giá bán</th><th class="num">Giá vốn</th><th class="num">Tồn thực tế</th><th class="num">Dự báo</th><th></th></tr></thead><tbody>
      ${rows.map(p => `<tr data-biz-open="product:${esc(p.id)}" tabindex="0"><td><b>${esc(p.name)}</b>${p.category ? `<div class="small muted">${esc(p.category)}</div>` : ''}</td><td>${esc(p.sku || '')}</td><td>${esc(TYPE[p.type] || '')}</td><td class="num">${vnd(p.price)}</td><td class="num">${vnd(p.cost)}</td><td class="num">${by[p.id] ? qn(by[p.id].on_hand) + ' ' + esc(p.unit) : '—'}</td><td class="num">${by[p.id] ? qn(by[p.id].forecast) : '—'}</td><td><button type="button" class="btn sm" data-biz-act="archiveProduct" data-id="${esc(p.id)}" title="Lưu trữ (ẩn khỏi danh sách, giữ lịch sử)">Lưu trữ</button></td></tr>`).join('')}</tbody></table>`;
  }
  function newOrder() { return { id: null, status: 'draft', contact_id: '', date: today(), valid_until: '', payment_days: 0, commitment_date: '', vat_pct: 10, notes: '', lines: [], owner: '' }; }
  async function orderForm(gen) {
    const id = B.form.id; await loadRefs();
    const o = id ? await C('getOrder', id) : null; live(gen);
    if (!B.edit) B.edit = o ? { ...o, lines: o.lines.map(l => ({ ...l })) } : newOrder();
    const e = B.edit; const st = o ? o.status : 'draft'; const editable = ['draft', 'sent'].includes(st);
    const lines = e.lines; const sub = lines.reduce((a, l) => a + amt(l), 0); const vat = Math.round(sub * (Number(e.vat_pct) || 0) / 100);
    const actions = [];
    if (editable) { actions.push(btn('saveOrder', 'Lưu', true)); if (o) { if (st === 'draft') actions.push(btn('sendQuote', 'Đánh dấu đã gửi')); actions.push(btn('confirmOrder', 'Xác nhận', true)); } }
    if (o && st === 'sale' && o.invoice_status === 'to_invoice') actions.push(btn('invoiceOrder', 'Tạo hoá đơn', true));
    if (o && st !== 'cancel') actions.push(btn('cancelOrder', 'Huỷ'));
    if (o && st === 'cancel') actions.push(btn('resetToQuote', 'Đặt lại báo giá'));
    if (o) actions.push(btn('printOrder', '🖨 In'));
    const smarts = o ? [o.pickings.length ? smart('openPickings', '🚚', o.pickings.length, 'Giao hàng') : '', o.invoices.length ? smart('openInvoices', '🧾', o.invoices.length, 'Hoá đơn') : ''].join('') : '';
    const lineRow = (l, i) => editable ? `<tr data-line="${i}"><td><select data-lf="product_id" aria-label="Sản phẩm">${opt(B.products.map(p => [p.id, p.name]), l.product_id, '(dòng tự ghi)')}</select></td><td><input data-lf="name" value="${esc(l.name || '')}" aria-label="Mô tả"></td><td class="num"><input data-lf="qty" inputmode="decimal" value="${esc(l.qty ?? 1)}" class="biz-num" aria-label="Số lượng"></td><td><input data-lf="unit" value="${esc(l.unit || 'cái')}" class="biz-unit" aria-label="Đơn vị"></td><td class="num"><input data-lf="price" inputmode="numeric" value="${esc(l.price ?? 0)}" class="biz-money" aria-label="Đơn giá"></td><td class="num"><input data-lf="discount_pct" inputmode="decimal" value="${esc(l.discount_pct || 0)}" class="biz-num" aria-label="Chiết khấu %"></td><td class="num">${vnd(amt(l))}</td><td><button type="button" class="btn sm" data-biz-act="delLine" data-i="${i}" aria-label="Xoá dòng">✕</button></td></tr>`
      : `<tr><td colspan="2">${esc(l.name)}</td><td class="num">${qn(l.qty)}</td><td>${esc(l.unit || '')}</td><td class="num">${vnd(l.price)}</td><td class="num">${l.discount_pct ? qn(l.discount_pct) + '%' : ''}</td><td class="num">${vnd(l.amount)}</td><td class="small muted">${st === 'sale' ? `giao ${qn(l.qty_delivered)} · HĐ ${qn(l.qty_invoiced)}` : ''}</td></tr>`;
    const contactOpts = B.contacts.map(c => [c.id, c.name + (c.company_name ? ' — ' + c.company_name : '')]);
    return `${crumbs(['Bán hàng', st === 'sale' ? 'Đơn bán hàng' : 'Báo giá', o ? o.number : 'Mới'])}
      <div class="biz-bar"><div class="biz-actions">${actions.join('')}${!o ? btn('discard', 'Bỏ') : ''}</div>${statusbar([['draft', 'Báo giá'], ['sent', 'Báo giá đã gửi'], ['sale', 'Đơn bán hàng']].concat(st === 'cancel' ? [['cancel', 'Đã huỷ']] : []), st)}</div>
      <div class="biz-sheet">${smarts ? `<div class="biz-smarts">${smarts}</div>` : ''}
        <h2 class="biz-title">${esc(o ? o.number : 'Báo giá mới')}</h2>
        <div class="biz-grid">
          <label>Khách hàng *<select data-f="contact_id" ${editable ? '' : 'disabled'}>${opt(contactOpts, e.contact_id, '— chọn khách hàng —')}</select></label>
          <label>Ngày báo giá<input type="date" data-f="date" value="${esc(e.date || '')}" ${editable ? '' : 'disabled'}></label>
          <label>Hiệu lực đến<input type="date" data-f="valid_until" value="${esc(e.valid_until || '')}" ${editable ? '' : 'disabled'}></label>
          <label>Điều khoản thanh toán<select data-f="payment_days" ${editable ? '' : 'disabled'}>${PAY_TERMS.map(([v, n]) => `<option value="${v}" ${Number(e.payment_days || 0) === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <label>Ngày giao cam kết<input type="date" data-f="commitment_date" value="${esc(e.commitment_date || '')}" ${editable ? '' : 'disabled'}></label>
          <label>Thuế GTGT<select data-f="vat_pct" ${editable ? '' : 'disabled'}>${[0, 5, 8, 10].map(v => `<option value="${v}" ${Number(e.vat_pct) === v ? 'selected' : ''}>${v}%</option>`).join('')}</select></label>
          ${o ? `<div class="biz-ro"><span class="muted small">Phụ trách</span><div>${esc(o.owner || '—')}</div></div>` : ''}
          ${o && st === 'sale' ? `<div class="biz-ro"><span class="muted small">Giao hàng · Hoá đơn</span><div>${badge(o.delivery_status_vi, TONE[o.delivery_status])} ${badge(o.invoice_status_vi, TONE[o.invoice_status])}</div></div>` : ''}
        </div>
        <h3>Dòng đơn hàng</h3>
        <table class="crm-table biz-lines"><thead><tr><th>Sản phẩm</th><th>Mô tả</th><th class="num">SL</th><th>ĐVT</th><th class="num">Đơn giá</th><th class="num">CK %</th><th class="num">Thành tiền</th><th></th></tr></thead><tbody>${lines.map(lineRow).join('') || `<tr><td colspan="8" class="muted">Chưa có dòng nào.</td></tr>`}</tbody></table>
        ${editable ? `<div class="row">${btn('addLine', '＋ Thêm dòng')}</div>` : ''}
        <div class="biz-totals"><div><span>Tiền trước thuế</span><b>${vnd(sub)}</b></div><div><span>Thuế GTGT ${Number(e.vat_pct) || 0}%</span><b>${vnd(vat)}</b></div><div class="grand"><span>Tổng cộng</span><b>${vnd(sub + vat)}</b></div></div>
        <label class="biz-notes">Điều khoản và ghi chú<textarea data-f="notes" rows="2" ${editable ? '' : 'disabled'}>${esc(e.notes || '')}</textarea></label>
      </div>`;
  }
  function readForm() {
    const e = B.edit; if (!e) return;
    $$('#crmBody [data-f]').forEach(x => { e[x.dataset.f] = x.value; });
    $$('#crmBody tr[data-line]').forEach(tr => { const l = e.lines[Number(tr.dataset.line)]; if (!l) return; tr.querySelectorAll('[data-lf]').forEach(x => { l[x.dataset.lf] = x.value; }); });
  }
  const orderPayload = () => { const e = B.edit; return { id: B.form.id || undefined, contact_id: e.contact_id, date: e.date, valid_until: e.valid_until, payment_days: e.payment_days, commitment_date: e.commitment_date, vat_pct: e.vat_pct, notes: e.notes, lines: e.lines.map(l => ({ product_id: l.product_id || null, name: l.name, unit: l.unit, qty: l.qty, price: parseMoney(l.price), discount_pct: l.discount_pct })) }; };

  // ---------- Sản phẩm (hộp thoại) ----------
  function productDialog(p = {}) {
    const F = [['name', 'Tên sản phẩm *'], ['type', 'Loại sản phẩm', [['product', 'Hàng lưu kho (theo dõi tồn kho)'], ['consu', 'Hàng tiêu dùng (không theo dõi tồn)'], ['service', 'Dịch vụ']]], ['sku', 'Mã nội bộ'], ['barcode', 'Mã vạch'], ['category', 'Nhóm sản phẩm'], ['unit', 'Đơn vị tính'], ['price', 'Giá bán (đ)'], ['cost', 'Giá vốn (đ)'], ['min_qty', 'Tồn tối thiểu (cảnh báo khi thấp hơn)'], ['description', 'Mô tả', 'area']];
    return dialog(p.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm', F, { unit: 'cái', type: 'product', ...p }, async (o) => { await C('saveProduct', { ...o, id: p.id || undefined }); toast('Đã lưu ✓'); render('sales'); });
  }
  // hộp thoại biểu mẫu dùng chung (theo kiểu crmForm)
  function dialog(title, fields, data, onSave) {
    let m = $('#bizModal');
    if (!m) { m = document.createElement('div'); m.className = 'modal-back'; m.id = 'bizModal'; m.hidden = true; m.innerHTML = '<form class="modal crm-form" id="bizForm"><h3 id="bizFormTitle"></h3><div id="bizFields"></div><p class="small" id="bizErr" style="color:#82071e"></p><div class="row"><button type="button" class="btn" id="bizCancel">Huỷ</button><button type="submit" class="btn primary" id="bizOk">Lưu</button></div></form>'; document.body.appendChild(m);
      m.querySelector('#bizCancel').addEventListener('click', () => { m.hidden = true; }); m.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.hidden = true; }); }
    m.querySelector('#bizFormTitle').textContent = title;
    m.querySelector('#bizFields').innerHTML = fields.map(([k, l, t]) => `<label>${esc(l)}${Array.isArray(t) ? `<select name="${k}">${t.map(([v, n]) => `<option value="${esc(v)}" ${String(data[k] ?? '') === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : t === 'area' ? `<textarea name="${k}" rows="3">${esc(data[k] || '')}</textarea>` : `<input name="${k}" type="${t === 'date' ? 'date' : 'text'}" value="${esc(data[k] ?? '')}">`}</label>`).join('');
    m.querySelector('#bizErr').textContent = '';
    const f = m.querySelector('#bizForm'); const nf = f.cloneNode(true); f.replaceWith(nf);
    nf.querySelector('#bizCancel').addEventListener('click', () => { m.hidden = true; });
    nf.addEventListener('submit', async (ev) => { ev.preventDefault(); const o = Object.fromEntries(new FormData(nf).entries()); try { await onSave(o); m.hidden = true; } catch (err) { nf.querySelector('#bizErr').textContent = err.message; } });
    m.hidden = false; const first = nf.querySelector('input,select,textarea'); if (first) first.focus();
  }

  // ---------- Kho ----------
  async function stockList(q) {
    const r = await C('listStock', { q, filter: B.stockFilter || 'all' });
    const filters = `<div class="biz-filters">${[['all', 'Tất cả'], ['available', 'Còn hàng'], ['low', 'Dưới tồn tối thiểu'], ['negative', 'Tồn âm']].map(([k, n]) => `<button type="button" class="chip ${(B.stockFilter || 'all') === k ? 'on' : ''}" data-biz-filter="${k}">${esc(n)}</button>`).join('')}</div>`;
    if (!r.rows.length) return filters + empty('🏬', q || (B.stockFilter && B.stockFilter !== 'all') ? 'Không có sản phẩm nào khớp.' : 'Chưa có hàng lưu kho. Thêm sản phẩm loại “Hàng lưu kho” ở Bán hàng → Sản phẩm.');
    B.lastRows = [['Sản phẩm', 'Mã', 'Tồn thực tế', 'Dự báo', 'Đơn vị', 'Giá vốn', 'Giá trị'], ...r.rows.map(x => [x.name, x.sku || '', x.on_hand, x.forecast, x.unit, x.cost, x.value])];
    return filters + `<table class="crm-table biz-list"><thead><tr><th>Sản phẩm</th><th>Mã</th><th class="num">Tồn thực tế</th><th class="num">Sắp nhập</th><th class="num">Sắp giao</th><th class="num">Dự báo</th><th class="num">Giá vốn</th><th class="num">Giá trị</th><th></th></tr></thead><tbody>
      ${r.rows.map(x => `<tr><td><b>${esc(x.name)}</b>${x.below_min ? ' ' + badge('dưới tối thiểu', 'warn') : ''}</td><td>${esc(x.sku || '')}</td><td class="num ${x.on_hand < 0 ? 'neg' : ''}">${qn(x.on_hand)} ${esc(x.unit)}</td><td class="num">${qn(x.incoming)}</td><td class="num">${qn(x.outgoing)}</td><td class="num">${qn(x.forecast)}</td><td class="num">${vnd(x.cost)}</td><td class="num">${vnd(x.value)}</td><td><button type="button" class="btn sm" data-biz-act="count" data-id="${esc(x.id)}" data-name="${esc(x.name)}" data-qty="${esc(x.on_hand)}">Kiểm kê</button></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="7">Tổng giá trị tồn kho</td><td class="num"><b>${vnd(r.totalValue)}</b></td><td></td></tr></tfoot></table>`;
  }
  async function pickingList(kind, q) {
    const rows = await C('listPickings', { kind, q });
    if (!rows.length) return empty(kind === 'in' ? '📥' : kind === 'out' ? '🚚' : '⚖', kind === 'in' ? 'Chưa có phiếu nhập kho. Bấm “＋ Phiếu nhập kho”.' : kind === 'out' ? 'Chưa có phiếu giao hàng. Phiếu giao được tạo khi xác nhận đơn bán hàng.' : 'Chưa có lần kiểm kê nào. Bấm “Kiểm kê” ở Kho → Tồn kho.');
    return `<table class="crm-table biz-list"><thead><tr><th>Số phiếu</th><th>Đối tác</th><th>Ngày dự kiến</th><th>Chứng từ gốc</th><th>Trạng thái</th></tr></thead><tbody>
      ${rows.map(p => `<tr data-biz-open="picking:${esc(p.id)}" tabindex="0"><td><b>${esc(p.number)}</b></td><td>${esc(p.partner_name)}</td><td>${dt(p.scheduled)}</td><td>${esc(p.origin || '')}</td><td>${badge(p.state_vi, TONE[p.state])}</td></tr>`).join('')}</tbody></table>`;
  }
  async function pickingForm() {
    const p = await C('getPicking', B.form.id); const open = ['draft', 'ready'].includes(p.state);
    const acts = open && p.kind !== 'adj' ? btn('validatePicking', 'Xác nhận', true) + btn('cancelPicking', 'Huỷ') : '';
    return `${crumbs(['Kho', p.kind_vi, p.number])}
      <div class="biz-bar"><div class="biz-actions">${acts}</div>${statusbar([['draft', 'Nháp'], ['ready', 'Sẵn sàng'], ['done', 'Hoàn tất']].concat(p.state === 'cancel' ? [['cancel', 'Đã huỷ']] : []), p.state)}</div>
      <div class="biz-sheet">${p.so_id ? `<div class="biz-smarts">${smart('openSo', '🧾', 1, 'Đơn bán hàng')}</div>` : ''}<h2 class="biz-title">${esc(p.number)}</h2>
        <div class="biz-grid"><div class="biz-ro"><span class="muted small">Đối tác</span><div>${esc(p.partner_name || '—')}</div></div><div class="biz-ro"><span class="muted small">Ngày dự kiến</span><div>${dt(p.scheduled)}</div></div><div class="biz-ro"><span class="muted small">Chứng từ gốc</span><div>${esc(p.origin || '—')}</div></div>${p.done_at ? `<div class="biz-ro"><span class="muted small">Ngày hoàn tất</span><div>${new Date(p.done_at).toLocaleString(LOC())}</div></div>` : ''}${p.backorders.length ? `<div class="biz-ro"><span class="muted small">Phiếu chờ phần còn lại</span><div>${p.backorders.map(b => `<a href="#" data-biz-open="picking:${esc(b.id)}">${esc(b.number)}</a>`).join(', ')}</div></div>` : ''}</div>
        <h3>Hoạt động</h3>
        <table class="crm-table biz-lines"><thead><tr><th>Sản phẩm</th><th class="num">Nhu cầu</th><th class="num">Đã làm</th><th class="num">Tồn hiện tại</th>${p.kind === 'in' ? '<th class="num">Giá nhập</th>' : ''}</tr></thead><tbody>
        ${p.moves.map(m => `<tr><td>${esc(m.product_name || '')}</td><td class="num">${qn(m.qty)} ${esc(m.unit || '')}</td><td class="num">${open ? `<input class="biz-num" inputmode="decimal" data-move="${esc(m.id)}" value="${m.qty_done ? esc(m.qty_done) : ''}" placeholder="${esc(qn(m.qty))}" aria-label="Số lượng đã làm">` : qn(m.qty_done)}</td><td class="num ${m.on_hand < 0 ? 'neg' : ''}">${qn(m.on_hand)}</td>${p.kind === 'in' ? `<td class="num">${vnd(m.unit_cost)}</td>` : ''}</tr>`).join('')}</tbody></table>
        ${open ? '<p class="small muted">Để trống cột “Đã làm” = làm đủ như nhu cầu. Ghi ít hơn → AIVN hỏi có tạo phiếu chờ cho phần còn lại không.</p>' : ''}
        ${p.notes ? `<p class="small">${esc(p.notes)}</p>` : ''}</div>`;
  }
  function receiptDialog() {
    const prods = B.products.filter(p => p.type === 'product');
    if (!prods.length) { toast('Chưa có sản phẩm loại “Hàng lưu kho”. Thêm ở Bán hàng → Sản phẩm.', true); return; }
    B.form = { type: 'receipt' }; B.edit = { partner_id: '', scheduled: today(), notes: '', lines: [{ product_id: prods[0].id, qty: 1, unit_cost: prods[0].cost || 0 }] }; render('stock');
  }
  function receiptForm() {
    const e = B.edit; const prods = B.products.filter(p => p.type === 'product');
    return `${crumbs(['Kho', 'Phiếu nhập kho', 'Mới'])}<div class="biz-bar"><div class="biz-actions">${btn('saveReceipt', 'Lưu', true)}${btn('discard', 'Bỏ')}</div>${statusbar([['draft', 'Nháp'], ['ready', 'Sẵn sàng'], ['done', 'Hoàn tất']], 'draft')}</div>
      <div class="biz-sheet"><h2 class="biz-title">Phiếu nhập kho mới</h2><div class="biz-grid"><label>Nhà cung cấp<select data-f="partner_id">${opt(B.contacts.map(c => [c.id, c.name]), e.partner_id)}</select></label><label>Ngày dự kiến<input type="date" data-f="scheduled" value="${esc(e.scheduled)}"></label><label>Ghi chú<input data-f="notes" value="${esc(e.notes)}"></label></div>
      <table class="crm-table biz-lines"><thead><tr><th>Sản phẩm</th><th class="num">Số lượng</th><th class="num">Giá nhập (đ)</th><th></th></tr></thead><tbody>${e.lines.map((l, i) => `<tr data-line="${i}"><td><select data-lf="product_id" aria-label="Sản phẩm">${opt(prods.map(p => [p.id, p.name]), l.product_id)}</select></td><td class="num"><input class="biz-num" data-lf="qty" inputmode="decimal" value="${esc(l.qty)}" aria-label="Số lượng"></td><td class="num"><input class="biz-money" data-lf="unit_cost" inputmode="numeric" value="${esc(l.unit_cost)}" aria-label="Giá nhập"></td><td><button type="button" class="btn sm" data-biz-act="delLine" data-i="${i}" aria-label="Xoá dòng">✕</button></td></tr>`).join('')}</tbody></table>
      <div class="row">${btn('addLine', '＋ Thêm dòng')}</div></div>`;
  }

  // ---------- Hoá đơn ----------
  async function invoiceList(s, q) {
    const rows = await C('listInvoices', { q, kind: s === 'refund' ? 'out_refund' : s === 'inv' ? 'out_invoice' : '', payment: s === 'unpaid' ? 'unpaid' : s === 'overdue' ? 'overdue' : '' });
    if (!rows.length) return empty('🧾', q ? 'Không có hoá đơn nào khớp.' : s === 'overdue' ? 'Không có hoá đơn quá hạn. 👍' : s === 'unpaid' ? 'Không còn hoá đơn chưa thu.' : 'Chưa có hoá đơn. Tạo từ đơn bán hàng (nút “Tạo hoá đơn”) hoặc bấm “＋ Hoá đơn”.');
    const sum = (k) => rows.reduce((a, r) => a + (r.kind === 'out_refund' ? -1 : 1) * r[k], 0);
    B.lastRows = [['Số', 'Khách hàng', 'Ngày hoá đơn', 'Hạn thanh toán', 'Tổng cộng', 'Còn phải thu', 'Trạng thái', 'Thanh toán'], ...rows.map(r => [r.display_number, r.partner_name, r.invoice_date || '', r.due_date || '', r.amount_total, r.residual, r.state_vi, r.payment_state_vi])];
    return `<table class="crm-table biz-list"><thead><tr><th>Số</th><th>Khách hàng</th><th>Ngày hoá đơn</th><th>Hạn thanh toán</th><th class="num">Tổng cộng</th><th class="num">Còn phải thu</th><th>Trạng thái</th><th>Thanh toán</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-biz-open="invoice:${esc(r.id)}" tabindex="0"><td><b>${esc(r.display_number)}</b>${r.kind === 'out_refund' ? ' ' + badge('Giấy báo có', 'muted') : ''}</td><td>${esc(r.partner_name)}</td><td>${dt(r.invoice_date)}</td><td class="${r.overdue ? 'neg' : ''}">${dt(r.due_date)}</td><td class="num">${vnd(r.amount_total)}</td><td class="num">${r.state === 'posted' ? vnd(r.residual) : ''}</td><td>${badge(r.state_vi, TONE[r.state])}</td><td>${r.state === 'posted' ? badge(r.payment_state_vi, TONE[r.payment_state]) : ''}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">${rows.length} dòng</td><td class="num"><b>${vnd(sum('amount_total'))}</b></td><td class="num"><b>${vnd(rows.filter(r => r.state === 'posted').reduce((a, r) => a + (r.kind === 'out_refund' ? -1 : 1) * r.residual, 0))}</b></td><td colspan="2"></td></tr></tfoot></table>`;
  }
  async function invoiceForm(gen) {
    const id = B.form.id; await loadRefs();
    const inv = id ? await C('getInvoice', id) : null; live(gen);
    if (!B.edit) B.edit = inv ? { ...inv, lines: inv.lines.map(l => ({ ...l })) } : { partner_id: '', invoice_date: '', due_date: '', vat_pct: 10, notes: '', lines: [] };
    const e = B.edit; const st = inv ? inv.state : 'draft'; const editable = st === 'draft';
    const acts = [];
    if (editable) { acts.push(btn('saveInvoice', 'Lưu', true)); if (inv) acts.push(btn('postInvoice', 'Vào sổ', true)); }
    if (inv && st === 'posted' && inv.residual > 0) acts.push(btn('payInvoice', inv.kind === 'out_refund' ? 'Ghi nhận hoàn tiền' : 'Ghi nhận thanh toán', true));
    if (inv && st === 'posted' && inv.kind === 'out_invoice') acts.push(btn('creditNote', 'Tạo giấy báo có'));
    if (inv && st === 'posted') acts.push(btn('resetInvoice', 'Đặt lại nháp'));
    if (inv && st === 'draft') acts.push(btn('cancelInvoice', 'Huỷ'));
    if (inv && st === 'cancel') acts.push(btn('resetInvoice', 'Đặt lại nháp'));
    if (inv) acts.push(btn('printInvoice', '🖨 In')); else acts.push(btn('discard', 'Bỏ'));
    const lines = e.lines; const sub = lines.reduce((a, l) => a + amt(l), 0); const vat = Math.round(sub * (Number(e.vat_pct) || 0) / 100);
    const ribbon = inv && st === 'posted' && ['paid', 'reversed', 'partial'].includes(inv.payment_state) ? `<div class="biz-ribbon ${inv.payment_state}">${esc(inv.payment_state_vi)}</div>` : '';
    const lineRow = (l, i) => editable ? `<tr data-line="${i}"><td><select data-lf="product_id" aria-label="Sản phẩm">${opt(B.products.map(p => [p.id, p.name]), l.product_id, '(dòng tự ghi)')}</select></td><td><input data-lf="name" value="${esc(l.name || '')}" aria-label="Mô tả"></td><td class="num"><input data-lf="qty" class="biz-num" inputmode="decimal" value="${esc(l.qty ?? 1)}" aria-label="Số lượng"></td><td class="num"><input data-lf="price" class="biz-money" inputmode="numeric" value="${esc(l.price ?? 0)}" aria-label="Đơn giá"></td><td class="num"><input data-lf="discount_pct" class="biz-num" inputmode="decimal" value="${esc(l.discount_pct || 0)}" aria-label="Chiết khấu %"></td><td class="num">${vnd(amt(l))}</td><td><button type="button" class="btn sm" data-biz-act="delLine" data-i="${i}" aria-label="Xoá dòng">✕</button></td></tr>`
      : `<tr><td colspan="2">${esc(l.name)}</td><td class="num">${qn(l.qty)}</td><td class="num">${vnd(l.price)}</td><td class="num">${l.discount_pct ? qn(l.discount_pct) + '%' : ''}</td><td class="num">${vnd(amt(l))}</td><td></td></tr>`;
    return `${crumbs(['Hoá đơn', inv && inv.kind === 'out_refund' ? 'Giấy báo có' : 'Hoá đơn khách hàng', inv ? inv.display_number : 'Mới'])}
      <div class="biz-bar"><div class="biz-actions">${acts.join('')}</div>${statusbar([['draft', 'Nháp'], ['posted', 'Đã vào sổ']].concat(st === 'cancel' ? [['cancel', 'Đã huỷ']] : []), st)}</div>
      <div class="biz-sheet">${ribbon}${inv && (inv.so_id || inv.refunds.length || inv.reversed_id) ? `<div class="biz-smarts">${inv.so_id ? smart('openSo', '🧾', 1, 'Đơn bán hàng') : ''}${inv.refunds.length ? smart('openRefunds', '↩', inv.refunds.length, 'Giấy báo có') : ''}${inv.reversed_id ? smart('openOrigin', '📄', 1, 'Hoá đơn gốc') : ''}</div>` : ''}
        <h2 class="biz-title">${inv ? esc(inv.display_number) : 'Hoá đơn mới'}</h2>
        <div class="biz-grid"><label>Khách hàng *<select data-f="partner_id" ${editable ? '' : 'disabled'}>${opt(B.contacts.map(c => [c.id, c.name]), e.partner_id, '— chọn khách hàng —')}</select></label>
          <label>Ngày hoá đơn<input type="date" data-f="invoice_date" value="${esc(e.invoice_date || '')}" ${editable ? '' : 'disabled'}></label>
          <label>Hạn thanh toán<input type="date" data-f="due_date" value="${esc(e.due_date || '')}" ${editable ? '' : 'disabled'}></label>
          <label>Thuế GTGT<select data-f="vat_pct" ${editable ? '' : 'disabled'}>${[0, 5, 8, 10].map(v => `<option value="${v}" ${Number(e.vat_pct) === v ? 'selected' : ''}>${v}%</option>`).join('')}</select></label>
          ${inv && inv.so_number ? `<div class="biz-ro"><span class="muted small">Đơn bán hàng</span><div>${esc(inv.so_number)}</div></div>` : ''}${inv && inv.reversed_number ? `<div class="biz-ro"><span class="muted small">Đảo của</span><div>${esc(inv.reversed_number)}</div></div>` : ''}</div>
        <table class="crm-table biz-lines"><thead><tr><th>Sản phẩm</th><th>Mô tả</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">CK %</th><th class="num">Thành tiền</th><th></th></tr></thead><tbody>${lines.map(lineRow).join('') || '<tr><td colspan="7" class="muted">Chưa có dòng nào.</td></tr>'}</tbody></table>
        ${editable ? `<div class="row">${btn('addLine', '＋ Thêm dòng')}</div>` : ''}
        <div class="biz-totals"><div><span>Tiền trước thuế</span><b>${vnd(sub)}</b></div><div><span>Thuế GTGT ${Number(e.vat_pct) || 0}%</span><b>${vnd(vat)}</b></div><div class="grand"><span>Tổng cộng</span><b>${vnd(sub + vat)}</b></div>
          ${inv && inv.payments.length ? inv.payments.map(p => `<div class="small"><span><span>${esc(p.method_vi)}</span> ${dt(p.date)} · ${esc(p.number)}</span><b>− ${vnd(p.amount)}</b></div>`).join('') : ''}
          ${inv && st === 'posted' ? `<div class="grand"><span>Còn phải thu</span><b>${vnd(inv.residual)}</b></div>` : ''}</div>
        ${inv && inv.total_words && UIL() === 'vi' ? `<p class="small muted">Bằng chữ: ${esc(inv.total_words)}</p>` : ''}
        <label class="biz-notes">Ghi chú<textarea data-f="notes" rows="2" ${editable ? '' : 'disabled'}>${esc(e.notes || '')}</textarea></label></div>`;
  }
  const invPayload = () => { const e = B.edit; return { id: B.form.id || undefined, partner_id: e.partner_id, invoice_date: e.invoice_date, due_date: e.due_date, vat_pct: e.vat_pct, notes: e.notes, lines: e.lines.map(l => ({ product_id: l.product_id || null, so_line_id: l.so_line_id || null, name: l.name, unit: l.unit, qty: l.qty, price: parseMoney(l.price), discount_pct: l.discount_pct })) }; };

  // ---------- Báo cáo ----------
  async function reportView(s) {
    const r = B.rep; const range = `<label>Từ<input type="date" data-rep="from" value="${esc(r.from)}"></label><label>Đến<input type="date" data-rep="to" value="${esc(r.to)}"></label>`;
    if (s === 'sales') {
      const d = await C('salesReport', { groupBy: r.groupBy, from: r.from, to: r.to }); const max = Math.max(1, ...d.rows.map(x => x.untaxed));
      const G = [['month', 'Tháng'], ['customer', 'Khách hàng'], ['product', 'Sản phẩm'], ['category', 'Nhóm sản phẩm'], ['owner', 'Người phụ trách']];
      B.lastRows = [[(G.find(g => g[0] === r.groupBy) || G[0])[1], 'Số đơn', 'Số lượng', 'Trước thuế', 'Tổng cộng'], ...d.rows.map(x => [x.label, x.orders, x.qty, x.untaxed, x.total])];
      return `<div class="biz-filters"><label>Nhóm theo<select data-rep="groupBy">${G.map(([k, n]) => `<option value="${k}" ${r.groupBy === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>${range}</div>
        ${d.rows.length ? `<table class="crm-table biz-list"><thead><tr><th>${esc((G.find(g => g[0] === r.groupBy) || G[0])[1])}</th><th class="num">Số đơn</th><th class="num">Số lượng</th><th class="num">Trước thuế</th><th class="num">Tổng cộng</th><th class="biz-barcol"></th></tr></thead><tbody>${d.rows.map(x => `<tr><td>${esc(x.label)}</td><td class="num">${x.orders}</td><td class="num">${qn(x.qty)}</td><td class="num">${vnd(x.untaxed)}</td><td class="num">${vnd(x.total)}</td><td class="biz-barcol"><span class="biz-hbar" style="width:${Math.round(100 * x.untaxed / max)}%"></span></td></tr>`).join('')}</tbody><tfoot><tr><td>Tổng</td><td class="num">${d.totals.orders}</td><td class="num">${qn(d.totals.qty)}</td><td class="num"><b>${vnd(d.totals.untaxed)}</b></td><td class="num"><b>${vnd(d.totals.total)}</b></td><td></td></tr></tfoot></table>` : empty('📊', 'Chưa có đơn bán hàng đã xác nhận trong khoảng này.')}`;
    }
    if (s === 'invoice') {
      const d = await C('invoiceReport', { from: r.from, to: r.to }); const a = d.agedTotals;
      B.lastRows = [['Khách hàng', 'Chưa đến hạn', '1–30 ngày', '31–60 ngày', '61–90 ngày', 'Trên 90 ngày', 'Tổng'], ...d.aged.map(x => [x.partner_name, x.current, x.d30, x.d60, x.d90, x.older, x.total])];
      return `<div class="biz-filters">${range}</div><div class="kpis"><div class="kpi">Doanh thu đã lập hoá đơn<b>${vnd(d.totals.untaxed)}</b><span class="small muted">gồm thuế ${vnd(d.totals.total)}</span></div><div class="kpi">Đã thu<b>${vnd(d.totals.paid)}</b></div><div class="kpi">Còn phải thu<b>${vnd(a.total)}</b><span class="small muted">quá hạn ${vnd(a.total - a.current)}</span>${a.credit ? `<span class="small muted">đã trừ giấy báo có khách hàng ${vnd(a.credit)}</span>` : ''}</div></div>
        <h3>Theo tháng</h3>${d.byMonth.length ? `<table class="crm-table biz-list"><thead><tr><th>Tháng</th><th class="num">Số chứng từ</th><th class="num">Trước thuế</th><th class="num">Thuế</th><th class="num">Tổng cộng</th></tr></thead><tbody>${d.byMonth.map(x => `<tr><td>${esc(x.key)}</td><td class="num">${x.count}</td><td class="num">${vnd(x.untaxed)}</td><td class="num">${vnd(x.tax)}</td><td class="num">${vnd(x.total)}</td></tr>`).join('')}</tbody></table>` : empty('🧾', 'Chưa có hoá đơn vào sổ trong khoảng này.')}
        <h3>Công nợ phải thu theo tuổi nợ</h3>${d.aged.length ? `<table class="crm-table biz-list"><thead><tr><th>Khách hàng</th><th class="num">Chưa đến hạn</th><th class="num">1–30 ngày</th><th class="num">31–60 ngày</th><th class="num">61–90 ngày</th><th class="num">Trên 90 ngày</th><th class="num">Tổng</th></tr></thead><tbody>${d.aged.map(x => `<tr><td>${esc(x.partner_name)}</td>${['current', 'd30', 'd60', 'd90', 'older', 'total'].map(k => `<td class="num ${k !== 'current' && k !== 'total' && x[k] ? 'neg' : ''}">${x[k] ? vnd(x[k]) : ''}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><td>Tổng</td>${['current', 'd30', 'd60', 'd90', 'older', 'total'].map(k => `<td class="num"><b>${vnd(a[k])}</b></td>`).join('')}</tr></tfoot></table>` : '<p class="muted">Không còn công nợ phải thu. 👍</p>'}`;
    }
    if (s === 'stock') {
      const d = await C('stockReport');
      B.lastRows = [['Sản phẩm', 'Mã', 'Tồn thực tế', 'Dự báo', 'Giá vốn', 'Giá trị'], ...d.rows.map(x => [x.name, x.sku || '', x.on_hand, x.forecast, x.cost, x.value])];
      return `<div class="kpis"><div class="kpi">Giá trị tồn kho<b>${vnd(d.totalValue)}</b><span class="small muted">theo giá vốn bình quân</span></div><div class="kpi">Dưới tồn tối thiểu<b>${d.low.length}</b></div><div class="kpi">Tồn âm<b>${d.negative.length}</b></div></div>
        ${d.rows.length ? `<table class="crm-table biz-list"><thead><tr><th>Sản phẩm</th><th class="num">Tồn thực tế</th><th class="num">Dự báo</th><th class="num">Tối thiểu</th><th class="num">Giá trị</th></tr></thead><tbody>${d.rows.map(x => `<tr><td>${esc(x.name)}${x.below_min ? ' ' + badge('cần nhập thêm', 'warn') : ''}</td><td class="num ${x.on_hand < 0 ? 'neg' : ''}">${qn(x.on_hand)}</td><td class="num">${qn(x.forecast)}</td><td class="num">${x.min_qty ? qn(x.min_qty) : ''}</td><td class="num">${vnd(x.value)}</td></tr>`).join('')}</tbody></table>` : empty('🏬', 'Chưa có hàng lưu kho.')}`;
    }
    const d = await C('dashboard'); const max = Math.max(1, ...d.byStage.map(x => x.sum));
    B.lastRows = [['Giai đoạn', 'Số cơ hội', 'Giá trị'], ...d.byStage.map(x => [x.name, x.n, x.sum])];
    return `<div class="kpis"><div class="kpi">Cơ hội đang mở<b>${d.open.n}</b><span class="small muted">${vnd(d.open.sum)} · dự kiến ${vnd(d.open.weighted)}</span></div><div class="kpi">Tỉ lệ thắng<b>${d.winRate == null ? '—' : Math.round(d.winRate) + '%'}</b></div></div>
      <table class="crm-table biz-list"><thead><tr><th>Giai đoạn</th><th class="num">Số cơ hội</th><th class="num">Giá trị</th><th class="biz-barcol"></th></tr></thead><tbody>${d.byStage.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${x.n}</td><td class="num">${vnd(x.sum)}</td><td class="biz-barcol"><span class="biz-hbar" style="width:${Math.round(100 * x.sum / max)}%"></span></td></tr>`).join('')}</tbody></table>`;
  }

  // ---------- In (cửa sổ in của hệ điều hành) ----------
  function printDoc(title, html) {
    // bản in mở ở cửa sổ riêng (không có bộ dịch giao diện) → dịch sẵn từng đoạn chữ theo ngôn ngữ đang dùng
    if (window.I18N && I18N.lang !== 'vi') { const t = document.createElement('template'); t.innerHTML = html; const w0 = document.createTreeWalker(t.content, NodeFilter.SHOW_TEXT); for (let n = w0.nextNode(); n; n = w0.nextNode()) n.nodeValue = I18N.tr(n.nodeValue, I18N.lang); html = t.innerHTML; title = I18N.tr(title, I18N.lang); }
    const w = window.open('', '_blank', 'width=820,height=1000'); if (!w) { toast('Không mở được cửa sổ in.', true); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:13px system-ui,sans-serif;margin:32px;color:#111}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}td.num,th.num{text-align:right}.tot{margin-left:auto;width:320px}.tot div{display:flex;justify-content:space-between;padding:3px 0}.grand{font-weight:700;border-top:2px solid #111}</style>${html}`);
    w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch {} }, 250);
  }
  const printLines = (d, lines) => `<table><tr><th>Mô tả</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">CK</th><th class="num">Thành tiền</th></tr>${lines.map(l => `<tr><td>${esc(l.name)}</td><td class="num">${qn(l.qty)} ${esc(l.unit || '')}</td><td class="num">${vnd(l.price)}</td><td class="num">${l.discount_pct ? qn(l.discount_pct) + '%' : ''}</td><td class="num">${vnd(l.amount ?? amt(l))}</td></tr>`).join('')}</table>`;

  // ---------- hành động ----------
  async function act(a, el) {
    const f = B.form;
    try {
      if (a === 'discard') { B.form = null; B.edit = null; return rerender(); }
      if (a === 'addLine') { readForm(); if (f.type === 'receipt') { const p = B.products.find(x => x.type === 'product'); B.edit.lines.push({ product_id: p ? p.id : '', qty: 1, unit_cost: p ? p.cost : 0 }); } else B.edit.lines.push({ product_id: '', name: '', qty: 1, unit: 'cái', price: 0, discount_pct: 0 }); return rerender(); }
      if (a === 'delLine') { readForm(); B.edit.lines.splice(Number(el.dataset.i), 1); return rerender(); }
      if (a === 'archiveProduct') { if (await modalAsk({ icon: '📦', title: 'Lưu trữ sản phẩm?', message: 'Sản phẩm sẽ ẩn khỏi danh sách và không chọn được cho đơn mới. Đơn, hoá đơn và lịch sử kho cũ vẫn giữ nguyên.', okLabel: 'Lưu trữ', noLabel: 'Giữ lại' })) { const r = await A.crm('deleteProduct', el.dataset.id); if (!r.ok && r.code === 'stock') { if (!await modalAsk({ icon: '⚠', title: 'Sản phẩm còn tồn kho', message: r.error, okLabel: 'Vẫn lưu trữ', noLabel: 'Giữ lại' })) return rerender(); const r2 = await A.crm('deleteProduct', el.dataset.id, { force: true }); if (!r2.ok) throw new Error(r2.error); } else if (!r.ok) throw new Error(r.error); toast('Đã lưu trữ ✓'); } return rerender(); }
      if (a === 'count') { return dialog(`Kiểm kê: ${el.dataset.name}`, [['counted', 'Số lượng đếm được thực tế'], ['note', 'Ghi chú (vd. Kiểm kê cuối tháng)']], { counted: el.dataset.qty }, async (o) => { const r = await C('adjustStock', el.dataset.id, o.counted, o.note); toast(r.changed ? `Đã điều chỉnh tồn: ${r.diff > 0 ? '+' : ''}${qn(r.diff)}` : 'Tồn kho đã đúng, không cần điều chỉnh.'); rerender(); }); }
      // Bán hàng
      if (a === 'saveOrder') { readForm(); const o = await C('saveQuote', orderPayload()); B.form = { type: 'order', id: o.id }; B.edit = null; toast('Đã lưu ✓'); return rerender(); }
      if (a === 'sendQuote' || a === 'confirmOrder') { readForm(); if (['draft', 'sent'].includes(B.edit.status)) await C('saveQuote', orderPayload()); const o = await C(a, f.id); B.edit = null; toast(a === 'confirmOrder' ? (o.pickings.length ? `Đã xác nhận đơn ${o.number} · đã tạo phiếu giao hàng` : `Đã xác nhận đơn ${o.number}`) : 'Đã đánh dấu báo giá đã gửi'); return rerender(); }
      if (a === 'invoiceOrder') { const inv = await C('invoiceOrder', f.id); toast('Đã tạo hoá đơn nháp'); return open('invoice', inv.id, 'invoices'); }
      if (a === 'cancelOrder') { if (!await modalAsk({ icon: '⚠', title: 'Huỷ đơn này?', message: 'Phiếu giao hàng chưa làm và hoá đơn nháp của đơn cũng sẽ bị huỷ.', okLabel: 'Huỷ đơn', noLabel: 'Không' })) return; await C('cancelOrder', f.id); B.edit = null; return rerender(); }
      if (a === 'resetToQuote') { await C('resetToQuote', f.id); B.edit = null; return rerender(); }
      if (a === 'openPickings') { const o = await C('getOrder', f.id); return o.pickings.length === 1 ? open('picking', o.pickings[0].id, 'stock') : (crm.tab = 'stock', B.sub.stock = 'out', B.form = null, $('#crmQ').value = o.number, renderCrm()); }
      if (a === 'openInvoices') { const o = await C('getOrder', f.id); return o.invoices.length === 1 ? open('invoice', o.invoices[0].id, 'invoices') : (crm.tab = 'invoices', B.sub.invoices = 'inv', B.form = null, $('#crmQ').value = o.number, renderCrm()); }
      if (a === 'printOrder') { const o = await C('getOrder', f.id); return printDoc(o.number, `<h2>${esc(o.status === 'sale' ? 'Đơn bán hàng' : 'Báo giá')} ${esc(o.number)}</h2><p>${esc(o.contact ? o.contact.name : '')}<br>${esc(o.contact && o.contact.address || '')}</p><p>Ngày: ${dt(o.date)}${o.valid_until ? ' · Hiệu lực đến: ' + dt(o.valid_until) : ''}</p>${printLines(o, o.lines)}<div class="tot"><div><span>Tiền trước thuế</span><b>${vnd(o.subtotal)}</b></div><div><span>Thuế GTGT ${o.vat_pct}%</span><b>${vnd(o.vat)}</b></div><div class="grand"><span>Tổng cộng</span><b>${vnd(o.total)}</b></div></div>${UIL() === 'vi' ? `<p>Bằng chữ: ${esc(o.total_words || '')}</p>` : ''}${o.notes ? `<p>${esc(o.notes)}</p>` : ''}`); }
      // Kho
      if (a === 'saveReceipt') { readForm(); const p = await C('createReceipt', { partner_id: B.edit.partner_id || null, scheduled: B.edit.scheduled, notes: B.edit.notes, lines: B.edit.lines.map(l => ({ product_id: l.product_id, qty: l.qty, unit_cost: parseMoney(l.unit_cost) })) }); toast(`Đã tạo ${p.number}`); return open('picking', p.id, 'stock'); }
      if (a === 'validatePicking') {
        const done = {}; $$('#crmBody [data-move]').forEach(x => { if (x.value.trim() !== '') done[x.dataset.move] = x.value; });
        if (Object.keys(done).length) await C('setDone', f.id, done);
        const p = await C('getPicking', f.id); const partial = Object.keys(done).length && p.moves.some(m => (m.qty_done || 0) < m.qty);
        let backorder = true;
        if (partial) backorder = await modalAsk({ icon: '📦', title: 'Làm thiếu so với nhu cầu', message: 'Một số dòng làm ít hơn nhu cầu. Tạo phiếu chờ (backorder) cho phần còn lại?', okLabel: 'Tạo phiếu chờ', noLabel: 'Không, bỏ phần còn lại' });
        const r = await A.crm('validatePicking', f.id, { backorder });
        if (!r.ok && (r.code === 'short' || r.code === 'over')) { if (!await modalAsk({ icon: '⚠', title: r.code === 'over' ? 'Giao vượt số lượng đặt' : 'Không đủ hàng trong kho', message: r.error, okLabel: r.code === 'over' ? 'Vẫn giao vượt' : 'Vẫn giao (tồn âm)', noLabel: 'Để sau' })) return; const r2 = await A.crm('validatePicking', f.id, { backorder, force: true }); if (!r2.ok) throw new Error(r2.error); }
        else if (!r.ok) throw new Error(r.error);
        toast('Đã xác nhận phiếu ✓'); return rerender();
      }
      if (a === 'cancelPicking') { if (!await modalAsk({ icon: '⚠', title: 'Huỷ phiếu kho?', message: 'Phiếu sẽ không còn được làm.', okLabel: 'Huỷ phiếu', noLabel: 'Không' })) return; await C('cancelPicking', f.id); return rerender(); }
      if (a === 'openSo') { const id = f.type === 'picking' ? (await C('getPicking', f.id)).so_id : (await C('getInvoice', f.id)).so_id; return open('order', id, 'sales'); }
      // Hoá đơn
      if (a === 'saveInvoice') { readForm(); const inv = await C('saveInvoice', invPayload()); B.form = { type: 'invoice', id: inv.id }; B.edit = null; toast('Đã lưu ✓'); return rerender(); }
      if (a === 'postInvoice') { readForm(); await C('saveInvoice', invPayload()); const inv = await C('postInvoice', f.id); B.edit = null; toast(`Đã vào sổ ${inv.number}`); return rerender(); }
      if (a === 'payInvoice') { const inv = await C('getInvoice', f.id); return dialog(inv.kind === 'out_refund' ? 'Ghi nhận hoàn tiền' : 'Ghi nhận thanh toán', [['amount', 'Số tiền (đ)'], ['date', 'Ngày thanh toán', 'date'], ['method', 'Hình thức', [['bank', 'Chuyển khoản'], ['cash', 'Tiền mặt']]], ['memo', 'Nội dung']], { amount: inv.residual, date: today(), method: 'bank', memo: inv.number }, async (o) => { await C('registerPayment', f.id, o); toast('Đã ghi nhận ✓'); B.edit = null; rerender(); }); }
      if (a === 'creditNote') { return dialog('Tạo giấy báo có', [['reason', 'Lý do (vd. khách trả hàng, giảm giá)']], {}, async (o) => { const r = await C('creditNote', f.id, o); toast('Đã tạo giấy báo có nháp'); open('invoice', r.id, 'invoices'); }); }
      if (a === 'resetInvoice') { await C('resetInvoice', f.id); B.edit = null; return rerender(); }
      if (a === 'cancelInvoice') { await C('cancelInvoice', f.id); B.edit = null; return rerender(); }
      if (a === 'openRefunds') { const inv = await C('getInvoice', f.id); return open('invoice', inv.refunds[0].id, 'invoices'); }
      if (a === 'openOrigin') { const inv = await C('getInvoice', f.id); return open('invoice', inv.reversed_id, 'invoices'); }
      if (a === 'printInvoice') { const inv = await C('getInvoice', f.id); return printDoc(inv.display_number, `<h2><span>${esc(inv.kind_vi)}</span> ${esc(inv.display_number)}</h2><p>${esc(inv.partner ? inv.partner.name : '')}${inv.partner && inv.partner.tax_id ? '<br>MST: ' + esc(inv.partner.tax_id) : ''}<br>${esc(inv.partner && inv.partner.address || '')}</p><p>Ngày hoá đơn: ${dt(inv.invoice_date)} · Hạn thanh toán: ${dt(inv.due_date)}</p>${printLines(inv, inv.lines)}<div class="tot"><div><span>Tiền trước thuế</span><b>${vnd(inv.amount_untaxed)}</b></div><div><span>Thuế GTGT ${inv.vat_pct}%</span><b>${vnd(inv.amount_tax)}</b></div><div class="grand"><span>Tổng cộng</span><b>${vnd(inv.amount_total)}</b></div><div><span>Còn phải thu</span><b>${vnd(inv.residual)}</b></div></div>${UIL() === 'vi' ? `<p>Bằng chữ: ${esc(inv.total_words || '')}</p>` : ''}`); }
    } catch (e) { toast(e.message, true); }
  }
  function open(type, id, app) { B.form = { type, id }; B.edit = null; if (app && crm.tab !== app) crm.tab = app; renderCrm(); }
  const rerender = () => renderCrm();
  async function renderForm(gen = ++renderGen) {
    const t = B.form.type; const el = body();
    try {
      const html = t === 'order' ? await orderForm(gen) : t === 'picking' ? await pickingForm() : t === 'invoice' ? await invoiceForm(gen) : t === 'receipt' ? receiptForm() : '';
      live(gen); el.innerHTML = html;
    } catch (e) { if (e !== STALE) throw e; }
  }
  // thêm: nút “＋”
  async function add(app) {
    await loadRefs();
    if (app === 'sales') { if (B.sub.sales === 'products') return productDialog(); B.form = { type: 'order', id: null }; B.edit = newOrder(); return renderCrm(); }
    if (app === 'stock') return receiptDialog();
    if (app === 'invoices') { B.form = { type: 'invoice', id: null }; B.edit = null; return renderCrm(); }
    if (app === 'reports') { if (!B.lastRows || B.lastRows.length < 2) return toast('Báo cáo này chưa có dữ liệu để xuất.', true); const r = await A.crmSaveCsv({ name: 'bao-cao-' + B.sub.reports, rows: B.lastRows }); if (r.ok) toast('Đã xuất ' + r.file); else if (!r.canceled) toast('⚠ ' + r.error, true); }
  }

  // ---------- sự kiện ----------
  const el = body();
  el.addEventListener('click', async (e) => {
    if (!BIZ.tabs.includes(crm.tab)) return;
    const sub = e.target.closest('[data-biz-sub]'); if (sub) { B.sub[crm.tab] = sub.dataset.bizSub; B.form = null; B.edit = null; B.lastRows = null; return renderCrm(); }
    const flt = e.target.closest('[data-biz-filter]'); if (flt) { B.stockFilter = flt.dataset.bizFilter; return renderCrm(); }
    const back = e.target.closest('[data-biz-back]'); if (back) { e.preventDefault(); B.form = null; B.edit = null; return renderCrm(); }
    const a = e.target.closest('[data-biz-act]'); if (a) { e.preventDefault(); return act(a.dataset.bizAct, a); }
    const o = e.target.closest('[data-biz-open]'); if (o && !e.target.closest('button,input,select')) { e.preventDefault(); const [type, id] = o.dataset.bizOpen.split(':');
      if (type === 'product') { await loadRefs(); return productDialog(B.products.find(p => p.id === id) || {}); }
      return open(type, id); }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-biz-open]')) e.target.click(); });
  // chọn sản phẩm trên dòng → điền mô tả, đơn vị, giá; sửa số → tính lại thành tiền
  el.addEventListener('change', (e) => {
    if (!BIZ.tabs.includes(crm.tab) || !B.edit) return;
    const lf = e.target.closest('[data-lf]'); const f = e.target.closest('[data-f]'); if (!lf && !f) return;
    readForm();
    if (lf && lf.dataset.lf === 'product_id') { const l = B.edit.lines[Number(lf.closest('tr').dataset.line)]; const p = B.products.find(x => x.id === lf.value); if (p && l) { if (B.form.type === 'receipt') l.unit_cost = p.cost || 0; else { l.name = p.name; l.unit = p.unit; l.price = p.price; } } }
    if ((lf && ['product_id', 'qty', 'price', 'discount_pct'].includes(lf.dataset.lf)) || (f && f.dataset.f === 'vat_pct')) renderForm();
  });
  el.addEventListener('change', (e) => { const r = e.target.closest('[data-rep]'); if (r && crm.tab === 'reports') { B.rep[r.dataset.rep] = r.value; renderCrm(); } });

  // Tổng quan: thêm số liệu Bán hàng / Kho / Hoá đơn
  async function dashExtra(target) {
    try {
      const o = await C('overview');
      const card = (label, val, sub, go) => `<button type="button" class="kpi biz-kpi" data-biz-go="${go}">${esc(label)}<b>${val}</b>${sub ? `<span class="small muted">${esc(sub)}</span>` : ''}</button>`;
      const div = document.createElement('div'); div.className = 'kpis biz-dash';
      div.innerHTML = card('Doanh số tháng này', vnd(o.salesMonth), `đã lập hoá đơn ${vnd(o.invoicedMonth)}`, 'reports:sales') + card('Báo giá đang mở', o.quotesDraft, '', 'sales:quotes') + card('Đơn chờ lập hoá đơn', o.toInvoice, '', 'sales:toinv') + card('Phiếu giao sẵn sàng', o.deliveriesReady, o.receiptsReady ? `${o.receiptsReady} phiếu nhập chờ` : '', 'stock:out') + card('Còn phải thu', vnd(o.receivable), o.overdue.n ? `${o.overdue.n} hoá đơn quá hạn · ${vnd(o.overdue.sum)}` : '', o.overdue.n ? 'invoices:overdue' : 'invoices:unpaid') + (o.lowStock ? card('Sắp hết hàng', o.lowStock, 'dưới tồn tối thiểu', 'stock:onhand') : '');
      div.addEventListener('click', (e) => { const b = e.target.closest('[data-biz-go]'); if (!b) return; const [app, s] = b.dataset.bizGo.split(':'); crm.tab = app; B.sub[app] = s; B.form = null; if (app === 'stock' && s === 'onhand' && o.lowStock) B.stockFilter = 'low'; renderCrm(); });
      if (crm.tab !== 'dash' || !target.isConnected) return;
      target.querySelectorAll('.biz-dash').forEach(x => x.remove()); // renderCrm gọi chồng nhau → chỉ giữ một hàng KPI
      target.prepend(div);
    } catch {}
  }
  window.BIZ = { tabs: Object.keys(APPS), render, add, dashExtra, state: B, reset: () => { B.form = null; B.edit = null; } };
})();
