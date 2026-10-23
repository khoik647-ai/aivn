// AIVN 0.16 — Kinh doanh: Bán hàng, Kho, Hoá đơn, Báo cáo (giao diện theo Odoo: danh sách → biểu mẫu có thanh trạng thái, nút thông minh, dòng sửa trực tiếp).
// Chạy sau app.js, dùng chung $, $$, esc, toast, modalAsk, C (gọi CRM), crm, vnd, LOC. Dữ liệu lưu trên máy (SQLite), không gửi đi đâu.
'use strict';
(() => {
  const APPS = {
    sales: { name: 'Bán hàng', subs: [['quotes', 'Báo giá'], ['orders', 'Đơn bán hàng'], ['toinv', 'Chờ lập hoá đơn'], ['products', 'Sản phẩm']] },
    stock: { name: 'Kho', subs: [['onhand', 'Tồn kho'], ['out', 'Phiếu giao hàng'], ['in', 'Phiếu nhập kho'], ['adj', 'Điều chỉnh tồn']] },
    purchase: { name: 'Mua hàng', subs: [['rfq', 'Yêu cầu báo giá'], ['po', 'Đơn mua hàng'], ['toreceive', 'Chờ nhận hàng'], ['tobill', 'Chờ hoá đơn']] },
    invoices: { name: 'Hoá đơn', subs: [['inv', 'Hoá đơn khách hàng'], ['refund', 'Giấy báo có'], ['unpaid', 'Chưa thu'], ['overdue', 'Quá hạn'], ['bills', 'Hoá đơn nhà cung cấp'], ['topay', 'Chưa trả']] },
    reports: { name: 'Báo cáo', subs: [['sales', 'Bán hàng'], ['invoice', 'Hoá đơn & công nợ'], ['purchase', 'Mua hàng'], ['payable', 'Công nợ phải trả'], ['stock', 'Tồn kho'], ['pipeline', 'Cơ hội']] },
  };
  const B = { sub: { sales: 'quotes', stock: 'onhand', purchase: 'rfq', invoices: 'inv', reports: 'sales' }, company: null, form: null, edit: null, products: [], contacts: [], rep: { groupBy: 'month', from: '', to: '' }, lastRows: null };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dt = (s) => s ? new Date(String(s).length === 10 ? s + 'T00:00:00' : s).toLocaleDateString(LOC()) : '';
  const qn = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString(LOC());
  // B73 (QA lượt 8): đọc số bằng CHÍNH bộ đọc của máy chủ (src/crm/num.js): “0.125” = 0,125; “1,000” = “1.000” = 1000; “1.234,5” = “1,234.5”
  const NUM = window.AIVN_NUM, UOM = window.AIVN_UOM;
  const parseQty = (v) => NUM.parseQty(v);
  const parseMoney = (v) => { const n = NUM.parseMoney(v); return Number.isFinite(n) ? n : 0; };
  // #41: thành tiền dòng như src/crm/tax.js lineSubtotal — 'line' = Odoo round_per_line (float_round(giá × (1 − CK/100) × SL)); 'global' = công thức cũ
  const amt = (l, rounding) => { const q = parseQty(l.qty) || 0, p = parseMoney(l.price), d = NUM.parsePct(l.discount_pct) || 0;
    return rounding === 'global' ? Math.round(q * p * (1 - d / 100)) : NUM.floatRound((p * (1 - d / 100.0)) * q); };
  // ô số: hiện theo ngôn ngữ (vi “1.234,5”, en/zh “1,234.5”) và giữ số gốc ở data-num — người dùng không sửa thì gửi đúng số gốc (kể cả 1,125 mơ hồ)
  const nv = (v, max = 3) => typeof v === 'number' && Number.isFinite(v) ? `value="${esc(NUM.fmtInput(v, UIL(), max))}" data-num="${v}"` : `value="${esc(v ?? '')}"`;
  const rv = (x) => (x.dataset.num != null && x.value === x.defaultValue ? Number(x.dataset.num) : x.value);
  // đơn vị tính: lưu khoá tiếng Việt (“cái”), hiện theo ngôn ngữ (Units/件); ô đơn vị có gợi ý (datalist) và quy tên gõ ở mọi ngôn ngữ về khoá chuẩn
  const uomL = (u, q) => UOM.label(u, UIL(), q);
  const uomList = () => `<datalist id="bizUoms" data-noi18n>${UOM.names(UIL()).map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
  const badge = (txt, tone) => `<span class="biz-badge ${tone || ''}">${esc(txt)}</span>`;
  const TONE = { draft: '', sent: 'info', sale: 'ok', purchase: 'ok', cancel: 'muted', ready: 'info', done: 'ok', posted: 'ok', not_paid: 'warn', partial: 'info', paid: 'ok', reversed: 'muted', to_invoice: 'warn', invoiced: 'ok', no: 'muted', pending: 'warn', full: 'ok', none: 'muted' };
  const PAY_TERMS = [[0, 'Thanh toán ngay'], [15, '15 ngày'], [30, '30 ngày'], [45, '45 ngày'], [60, '60 ngày']];
  const body = () => $('#crmBody');
  async function loadRefs() { [B.products, B.contacts, B.company] = await Promise.all([C('listProducts', {}), C('listContacts', {}).then(r => r.rows), C('getCompany')]); }
  // ---------- thuế GTGT theo dòng (cùng quy tắc với src/crm/tax.js: làm tròn từng dòng, hoặc gộp theo mức với chứng từ cũ) ----------
  const VATS = [0, 5, 8, 10];
  const defVat = () => (B.company && B.company.default_vat != null ? Number(B.company.default_vat) : 10);
  const lineVat = (l) => (l.vat_pct === '' || l.vat_pct == null ? defVat() : Number(l.vat_pct));
  function totalsOf(lines, rounding) {
    const g = new Map(); let un = 0, tx = 0;
    for (const l of lines) { const a = amt(l, rounding), r = lineVat(l); un += a; const x = g.get(r) || { rate: r, base: 0, tax: 0 }; x.base += a; if (rounding !== 'global') { const t = NUM.floatRound(a * r / 100); x.tax += t; tx += t; } g.set(r, x); }
    const groups = [...g.values()].sort((a, b) => a.rate - b.rate); if (rounding === 'global') { for (const x of groups) x.tax = Math.round(x.base * x.rate / 100); tx = groups.reduce((a, x) => a + x.tax, 0); }
    return { untaxed: un, tax: tx, total: un + tx, groups };
  }
  const roundingOf = (e) => e.tax_rounding || (B.company && B.company.tax_rounding) || 'line';
  function totalsBox(lines, rounding, extra = '') {
    const t = totalsOf(lines, rounding);
    return `<div class="biz-totals"><div><span>Tiền trước thuế</span><b>${vnd(t.untaxed)}</b></div>${t.groups.map(g => `<div><span>Thuế GTGT ${g.rate}% <small class="muted">trên ${vnd(g.base)}</small></span><b>${vnd(g.tax)}</b></div>`).join('')}<div class="grand"><span>Tổng cộng</span><b>${vnd(t.total)}</b></div>${extra}</div>`;
  }
  const vatSel = (v, attrs, aria = 'Thuế GTGT') => `<select ${attrs} aria-label="${esc(aria)}">${VATS.map(x => `<option value="${x}" ${Number(v) === x ? 'selected' : ''}>${x}%</option>`).join('')}</select>`;
  // bảng dòng dùng chung (báo giá/đơn bán, hoá đơn, đơn mua): sửa trực tiếp khi còn nháp
  function linesTable(lines, editable, { note = () => '', products = B.products, rounding = 'line' } = {}) {
    const head = `<thead><tr><th>Sản phẩm</th><th>Mô tả</th><th class="num">SL</th><th>ĐVT</th><th class="num">Đơn giá</th><th class="num">CK %</th><th class="num">Thuế</th><th class="num">Thành tiền</th><th></th></tr></thead>`;
    const row = (l, i) => editable ? `<tr data-line="${i}"><td><select data-lf="product_id" aria-label="Sản phẩm">${opt(products.map(p => [p.id, p.name]), l.product_id, '(dòng tự ghi)')}</select></td><td><input data-lf="name" value="${esc(l.name || '')}" aria-label="Mô tả"></td><td class="num"><input data-lf="qty" inputmode="decimal" ${nv(l.qty ?? 1)} class="biz-num" aria-label="Số lượng"></td><td><input data-lf="unit" list="bizUoms" value="${esc(uomL(l.unit || 'cái', l.qty))}" class="biz-unit" aria-label="Đơn vị"></td><td class="num"><input data-lf="price" inputmode="numeric" ${nv(l.price ?? 0, 0)} class="biz-money" aria-label="Đơn giá"></td><td class="num"><input data-lf="discount_pct" inputmode="decimal" ${nv(l.discount_pct || 0)} class="biz-num" aria-label="Chiết khấu %"></td><td class="num">${vatSel(lineVat(l), 'data-lf="vat_pct" class="biz-vat"')}</td><td class="num">${vnd(amt(l, rounding))}</td><td><button type="button" class="btn sm" data-biz-act="delLine" data-i="${i}" aria-label="Xoá dòng">✕</button></td></tr>`
      : `<tr><td colspan="2">${esc(l.name)}</td><td class="num">${qn(l.qty)}</td><td>${esc(uomL(l.unit || '', l.qty))}</td><td class="num">${vnd(l.price)}</td><td class="num">${l.discount_pct ? qn(l.discount_pct) + '%' : ''}</td><td class="num">${lineVat(l)}%</td><td class="num">${vnd(l.amount ?? amt(l, rounding))}</td><td class="small muted">${note(l)}</td></tr>`;
    return `<table class="crm-table biz-lines">${head}<tbody>${lines.map(row).join('') || '<tr><td colspan="9" class="muted">Chưa có dòng nào.</td></tr>'}</tbody></table>${editable ? uomList() : ''}`;
  }
  // PDF thật (Chromium printToPDF ở tiến trình chính) thay cho hộp thoại in của trình duyệt
  async function pdf(type, id) {
    const r = await A.bizPdf({ type, id, lang: window.I18N ? I18N.lang : 'vi' });
    if (r && r.ok) toast(`Đã lưu PDF: ${r.file}`); else if (r && !r.canceled) toast('⚠ ' + (r.error || 'Không tạo được PDF.'), true);
    return r;
  }
  const opt = (list, cur, empty = '—') => `<option value="">${esc(empty)}</option>` + list.map(([v, n]) => `<option value="${esc(v)}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('');

  // ---------- khung: thanh menu phụ + đường dẫn ----------
  function subnav(app) {
    return `<nav class="biz-subnav" role="tablist" aria-label="${esc(APPS[app].name)}">${APPS[app].subs.map(([k, n]) => `<button type="button" role="tab" data-biz-sub="${k}" class="${B.sub[app] === k ? 'on' : ''}" aria-selected="${B.sub[app] === k}">${esc(n)}</button>`).join('')}</nav>`;
  }
  const crumbs = (parts) => `<div class="biz-crumbs">${parts.map((p, i) => i < parts.length - 1 ? `<a href="#" data-biz-back="${i}">${esc(p)}</a> <span class="muted">›</span> ` : `<b>${esc(p)}</b>`).join('')}</div>`;
  function statusbar(steps, cur) { return `<div class="biz-status" role="list">${steps.map(([k, n]) => `<span role="listitem" class="${k === cur ? 'on' : ''}" ${k === cur ? 'aria-current="step"' : ''}>${esc(n)}</span>`).join('')}</div>`; }
  const btn = (act, label, primary = false, tip = '') => `<button type="button" class="btn sm${primary ? ' primary' : ''}" data-biz-act="${act}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(label)}</button>`;
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
    $('#crmAdd').textContent = app === 'sales' ? (B.sub.sales === 'products' ? '＋ Sản phẩm' : '＋ Báo giá') : app === 'stock' ? '＋ Phiếu nhập kho' : app === 'purchase' ? '＋ Yêu cầu báo giá' : app === 'invoices' ? (['bills', 'topay'].includes(B.sub.invoices) ? '＋ Hoá đơn nhà cung cấp' : '＋ Hoá đơn') : '⬇ Xuất CSV';
    try {
      if (B.form) return await renderForm(gen);
      let html = subnav(app);
      const s = B.sub[app];
      if (app === 'sales') html += s === 'products' ? await productList(q) : await orderList(s, q);
      else if (app === 'stock') html += s === 'onhand' ? await stockList(q) : await pickingList(s, q);
      else if (app === 'purchase') html += await purchaseList(s, q);
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
      ${rows.map(p => `<tr data-biz-open="product:${esc(p.id)}" tabindex="0"><td><b>${esc(p.name)}</b>${p.category ? `<div class="small muted">${esc(p.category)}</div>` : ''}</td><td>${esc(p.sku || '')}</td><td>${esc(TYPE[p.type] || '')}</td><td class="num">${vnd(p.price)}</td><td class="num">${vnd(p.cost)}</td><td class="num">${by[p.id] ? qn(by[p.id].on_hand) + ' ' + esc(uomL(p.unit, by[p.id].on_hand)) : '—'}</td><td class="num">${by[p.id] ? qn(by[p.id].forecast) : '—'}</td><td><button type="button" class="btn sm" data-biz-act="archiveProduct" data-id="${esc(p.id)}" title="Lưu trữ (ẩn khỏi danh sách, giữ lịch sử)">Lưu trữ</button></td></tr>`).join('')}</tbody></table>`;
  }
  function newOrder() { return { id: null, status: 'draft', contact_id: '', date: today(), valid_until: '', payment_days: 0, commitment_date: '', vat_pct: defVat(), notes: '', lines: [], owner: '' }; }
  async function orderForm(gen) {
    const id = B.form.id; await loadRefs();
    const o = id ? await C('getOrder', id) : null; live(gen);
    if (!B.edit) B.edit = o ? { ...o, lines: o.lines.map(l => ({ ...l })) } : newOrder();
    const e = B.edit; const st = o ? o.status : 'draft'; const editable = ['draft', 'sent'].includes(st);
    const lines = e.lines;
    const actions = [];
    if (editable) { actions.push(btn('saveOrder', 'Lưu', true)); if (o) { if (st === 'draft') actions.push(btn('sendQuote', 'Đánh dấu đã gửi')); actions.push(btn('confirmOrder', 'Xác nhận', true)); } }
    if (o && st === 'sale' && o.invoice_status === 'to_invoice') actions.push(btn('invoiceOrder', 'Tạo hoá đơn', true));
    if (o && st !== 'cancel') actions.push(btn('cancelOrder', 'Huỷ'));
    if (o && st === 'cancel') actions.push(btn('resetToQuote', 'Đặt lại báo giá'));
    if (o) actions.push(btn('printOrder', '⬇ PDF', false, 'Lưu báo giá / đơn bán hàng thành tệp PDF khổ A4'));
    const smarts = o ? [o.pickings.length ? smart('openPickings', '🚚', o.pickings.length, 'Giao hàng') : '', o.invoices.length ? smart('openInvoices', '🧾', o.invoices.length, 'Hoá đơn') : ''].join('') : '';
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
          ${editable ? `<label title="Áp cho mọi dòng; từng dòng vẫn chọn được mức riêng ở cột “Thuế”"><span>Thuế GTGT mặc định</span>${vatSel(e.vat_pct ?? defVat(), 'data-f="vat_pct"')}</label>` : ''}
          ${o ? `<div class="biz-ro"><span class="muted small">Phụ trách</span><div>${esc(o.owner || '—')}</div></div>` : ''}
          ${o && st === 'sale' ? `<div class="biz-ro"><span class="muted small">Giao hàng · Hoá đơn</span><div>${badge(o.delivery_status_vi, TONE[o.delivery_status])} ${badge(o.invoice_status_vi, TONE[o.invoice_status])}</div></div>` : ''}
        </div>
        <h3>Dòng đơn hàng</h3>
        ${linesTable(lines, editable, { rounding: roundingOf(e), note: (l) => st === 'sale' ? `giao ${qn(l.qty_delivered)} · HĐ ${qn(l.qty_invoiced)}` : '' })}
        ${editable ? `<div class="row">${btn('addLine', '＋ Thêm dòng')}</div>` : ''}
        ${totalsBox(lines, roundingOf(e))}
        <label class="biz-notes">Điều khoản và ghi chú<textarea data-f="notes" rows="2" ${editable ? '' : 'disabled'}>${esc(e.notes || '')}</textarea></label>
      </div>`;
  }
  function readForm() {
    const e = B.edit; if (!e) return;
    $$('#crmBody [data-f]').forEach(x => { e[x.dataset.f] = x.value; });
    $$('#crmBody tr[data-line]').forEach(tr => { const l = e.lines[Number(tr.dataset.line)]; if (!l) return; tr.querySelectorAll('[data-lf]').forEach(x => { l[x.dataset.lf] = x.dataset.lf === 'unit' ? UOM.canon(x.value) : rv(x); }); });
  }
  const orderPayload = () => { const e = B.edit; return { id: B.form.id || undefined, contact_id: e.contact_id, date: e.date, valid_until: e.valid_until, payment_days: e.payment_days, commitment_date: e.commitment_date, vat_pct: e.vat_pct, notes: e.notes, lines: e.lines.map(l => ({ product_id: l.product_id || null, name: l.name, unit: l.unit, qty: l.qty, price: parseMoney(l.price), discount_pct: l.discount_pct, vat_pct: lineVat(l) })) }; };

  // ---------- Sản phẩm (hộp thoại) ----------
  async function productDialog(p = {}) {
    if (!B.company) B.company = await C('getCompany');
    const F = [['name', 'Tên sản phẩm *'], ['type', 'Loại sản phẩm', [['product', 'Hàng lưu kho (theo dõi tồn kho)'], ['consu', 'Hàng tiêu dùng (không theo dõi tồn)'], ['service', 'Dịch vụ']]], ['sku', 'Mã nội bộ'], ['barcode', 'Mã vạch'], ['category', 'Nhóm sản phẩm'], ['unit', 'Đơn vị tính'], ['price', 'Giá bán (₫)'], ['cost', 'Giá vốn (₫)'], ['vat_pct', 'Thuế GTGT', VATS.map(v => [v, v + '%'])], ['min_qty', 'Tồn tối thiểu (cảnh báo khi thấp hơn)'], ['description', 'Mô tả', 'area']];
    return dialog(p.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm', F, { unit: 'cái', type: 'product', vat_pct: defVat(), ...p }, async (o) => { await C('saveProduct', { ...o, id: p.id || undefined }); toast('Đã lưu ✓'); render('sales'); });
  }
  // hộp thoại biểu mẫu dùng chung (theo kiểu crmForm)
  function dialog(title, fields, data, onSave) {
    let m = $('#bizModal');
    if (!m) { m = document.createElement('div'); m.className = 'modal-back'; m.id = 'bizModal'; m.hidden = true; m.innerHTML = '<form class="modal crm-form" id="bizForm"><h3 id="bizFormTitle"></h3><div id="bizFields"></div><p class="small" id="bizErr" style="color:#82071e"></p><div class="row"><button type="button" class="btn" id="bizCancel">Huỷ</button><button type="submit" class="btn primary" id="bizOk">Lưu</button></div></form>'; document.body.appendChild(m);
      m.querySelector('#bizCancel').addEventListener('click', () => { m.hidden = true; }); m.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.hidden = true; }); }
    m.querySelector('#bizFormTitle').textContent = title;
    m.querySelector('#bizFields').innerHTML = fields.map(([k, l, t]) => `<label>${esc(l)}${Array.isArray(t) ? `<select name="${k}">${t.map(([v, n]) => `<option value="${esc(v)}" ${String(data[k] ?? '') === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : t === 'area' ? `<textarea name="${k}" rows="3">${esc(data[k] || '')}</textarea>` : k === 'unit' ? `<input name="${k}" list="bizUoms" value="${esc(uomL(data[k] || ''))}">` : `<input name="${k}" type="${t === 'date' ? 'date' : 'text'}" ${t === 'date' ? `value="${esc(data[k] ?? '')}"` : nv(data[k])}${typeof data[k] === 'number' ? ' inputmode="decimal"' : ''}>`}</label>`).join('') + uomList();
    m.querySelector('#bizErr').textContent = '';
    const f = m.querySelector('#bizForm'); const nf = f.cloneNode(true); f.replaceWith(nf);
    nf.querySelector('#bizCancel').addEventListener('click', () => { m.hidden = true; });
    nf.addEventListener('submit', async (ev) => { ev.preventDefault(); const o = Object.fromEntries(new FormData(nf).entries()); nf.querySelectorAll('input[data-num]').forEach(x => { o[x.name] = rv(x); }); try { await onSave(o); m.hidden = true; } catch (err) { nf.querySelector('#bizErr').textContent = err.message; } });
    m.hidden = false; const first = nf.querySelector('input,select,textarea'); if (first) first.focus();
  }

  // ---------- Kho ----------
  async function stockList(q) {
    const r = await C('listStock', { q, filter: B.stockFilter || 'all' });
    const filters = `<div class="biz-filters">${[['all', 'Tất cả'], ['available', 'Còn hàng'], ['low', 'Dưới tồn tối thiểu'], ['negative', 'Tồn âm']].map(([k, n]) => `<button type="button" class="chip ${(B.stockFilter || 'all') === k ? 'on' : ''}" data-biz-filter="${k}">${esc(n)}</button>`).join('')}</div>`;
    if (!r.rows.length) return filters + empty('🏬', q || (B.stockFilter && B.stockFilter !== 'all') ? 'Không có sản phẩm nào khớp.' : 'Chưa có hàng lưu kho. Thêm sản phẩm loại “Hàng lưu kho” ở Bán hàng → Sản phẩm.');
    B.lastRows = [['Sản phẩm', 'Mã', 'Tồn thực tế', 'Dự báo', 'Đơn vị', 'Giá vốn', 'Giá trị'], ...r.rows.map(x => [x.name, x.sku || '', x.on_hand, x.forecast, uomL(x.unit), x.cost, x.value])];
    return filters + `<table class="crm-table biz-list"><thead><tr><th>Sản phẩm</th><th>Mã</th><th class="num">Tồn thực tế</th><th class="num">Sắp nhập</th><th class="num">Sắp giao</th><th class="num">Dự báo</th><th class="num">Giá vốn</th><th class="num">Giá trị</th><th></th></tr></thead><tbody>
      ${r.rows.map(x => `<tr><td><b>${esc(x.name)}</b>${x.below_min ? ' ' + badge('dưới tối thiểu', 'warn') : ''}</td><td>${esc(x.sku || '')}</td><td class="num ${x.on_hand < 0 ? 'neg' : ''}">${qn(x.on_hand)} ${esc(uomL(x.unit, x.on_hand))}</td><td class="num">${qn(x.incoming)}</td><td class="num">${qn(x.outgoing)}</td><td class="num">${qn(x.forecast)}</td><td class="num">${vnd(x.cost)}</td><td class="num">${vnd(x.value)}</td><td><button type="button" class="btn sm" data-biz-act="count" data-id="${esc(x.id)}" data-name="${esc(x.name)}" data-qty="${esc(x.on_hand)}">Kiểm kê</button></td></tr>`).join('')}
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
    const acts = (open && p.kind !== 'adj' ? btn('validatePicking', 'Xác nhận', true) + btn('cancelPicking', 'Huỷ') : '') + btn('printPicking', '⬇ PDF', false, p.kind === 'in' ? 'Lưu phiếu nhập kho thành tệp PDF' : 'Lưu phiếu giao hàng thành tệp PDF');
    return `${crumbs(['Kho', p.kind_vi, p.number])}
      <div class="biz-bar"><div class="biz-actions">${acts}</div>${statusbar([['draft', 'Nháp'], ['ready', 'Sẵn sàng'], ['done', 'Hoàn tất']].concat(p.state === 'cancel' ? [['cancel', 'Đã huỷ']] : []), p.state)}</div>
      <div class="biz-sheet">${p.so_id || p.po_id ? `<div class="biz-smarts">${p.so_id ? smart('openSo', '🧾', 1, 'Đơn bán hàng') : ''}${p.po_id ? smart('openPo', '🛒', 1, 'Đơn mua hàng') : ''}</div>` : ''}<h2 class="biz-title">${esc(p.number)}</h2>
        <div class="biz-grid"><div class="biz-ro"><span class="muted small">Đối tác</span><div>${esc(p.partner_name || '—')}</div></div><div class="biz-ro"><span class="muted small">Ngày dự kiến</span><div>${dt(p.scheduled)}</div></div><div class="biz-ro"><span class="muted small">Chứng từ gốc</span><div>${esc(p.origin || '—')}</div></div>${p.done_at ? `<div class="biz-ro"><span class="muted small">Ngày hoàn tất</span><div>${new Date(p.done_at).toLocaleString(LOC())}</div></div>` : ''}${p.backorders.length ? `<div class="biz-ro"><span class="muted small">Phiếu chờ phần còn lại</span><div>${p.backorders.map(b => `<a href="#" data-biz-open="picking:${esc(b.id)}">${esc(b.number)}</a>`).join(', ')}</div></div>` : ''}</div>
        <h3>Hoạt động</h3>
        <table class="crm-table biz-lines"><thead><tr><th>Sản phẩm</th><th class="num">Nhu cầu</th><th class="num">Đã làm</th><th class="num">Tồn hiện tại</th>${p.kind === 'in' ? '<th class="num">Giá nhập</th>' : ''}</tr></thead><tbody>
        ${p.moves.map(m => `<tr><td>${esc(m.product_name || '')}</td><td class="num">${qn(m.qty)} ${esc(uomL(m.unit || '', m.qty))}</td><td class="num">${open ? `<input class="biz-num" inputmode="decimal" data-move="${esc(m.id)}" ${m.qty_done ? nv(m.qty_done) : 'value=""'} placeholder="${esc(qn(m.qty))}" aria-label="Số lượng đã làm">` : qn(m.qty_done)}</td><td class="num ${m.on_hand < 0 ? 'neg' : ''}">${qn(m.on_hand)}</td>${p.kind === 'in' ? `<td class="num">${vnd(m.unit_cost)}</td>` : ''}</tr>`).join('')}</tbody></table>
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
      <table class="crm-table biz-lines"><thead><tr><th>Sản phẩm</th><th class="num">Số lượng</th><th class="num">Giá nhập (₫)</th><th></th></tr></thead><tbody>${e.lines.map((l, i) => `<tr data-line="${i}"><td><select data-lf="product_id" aria-label="Sản phẩm">${opt(prods.map(p => [p.id, p.name]), l.product_id)}</select></td><td class="num"><input class="biz-num" data-lf="qty" inputmode="decimal" ${nv(l.qty)} aria-label="Số lượng"></td><td class="num"><input class="biz-money" data-lf="unit_cost" inputmode="numeric" ${nv(l.unit_cost, 0)} aria-label="Giá nhập"></td><td><button type="button" class="btn sm" data-biz-act="delLine" data-i="${i}" aria-label="Xoá dòng">✕</button></td></tr>`).join('')}</tbody></table>
      <div class="row">${btn('addLine', '＋ Thêm dòng')}</div></div>`;
  }

  // ---------- Hoá đơn (khách hàng + nhà cung cấp) ----------
  const VENDOR_SUBS = ['bills', 'topay'];
  // hoá đơn khách / giấy báo có NCC → còn phải THU; hoá đơn NCC / giấy báo có khách → còn phải TRẢ
  const dueLabel = (kind) => (kind === 'in_invoice' || kind === 'out_refund' ? 'Còn phải trả' : 'Còn phải thu');
  async function invoiceList(s, q) {
    const vendor = VENDOR_SUBS.includes(s);
    const rows = await C('listInvoices', { q, scope: vendor ? 'in' : 'out', kind: s === 'refund' ? 'out_refund' : s === 'inv' ? 'out_invoice' : '', payment: s === 'unpaid' || s === 'topay' ? 'unpaid' : s === 'overdue' ? 'overdue' : '' });
    if (!rows.length) return empty('🧾', q ? 'Không có hoá đơn nào khớp.' : s === 'overdue' ? 'Không có hoá đơn quá hạn. 👍' : s === 'unpaid' ? 'Không còn hoá đơn chưa thu.' : s === 'topay' ? 'Không còn hoá đơn nhà cung cấp chưa trả. 👍' : vendor ? 'Chưa có hoá đơn nhà cung cấp. Tạo từ đơn mua hàng (nút “Tạo hoá đơn”) hoặc bấm “＋ Hoá đơn nhà cung cấp”.' : 'Chưa có hoá đơn. Tạo từ đơn bán hàng (nút “Tạo hoá đơn”) hoặc bấm “＋ Hoá đơn”.');
    const sg = (r) => (r.is_refund ? -1 : 1); const sum = (k) => rows.reduce((a, r) => a + sg(r) * r[k], 0);
    const P = vendor ? 'Nhà cung cấp' : 'Khách hàng'; const D = vendor ? 'Còn phải trả' : 'Còn phải thu';
    B.lastRows = [['Số', P, vendor ? 'Số tham chiếu' : 'Đơn bán hàng', 'Ngày hoá đơn', 'Hạn thanh toán', 'Tổng cộng', D, 'Trạng thái', 'Thanh toán'], ...rows.map(r => [r.display_number, r.partner_name, vendor ? r.ref || '' : r.so_number || '', r.invoice_date || '', r.due_date || '', r.amount_total, r.residual, r.state_vi, r.payment_state_vi])];
    return `<table class="crm-table biz-list"><thead><tr><th>Số</th><th>${esc(P)}</th>${vendor ? '<th>Số tham chiếu</th>' : ''}<th>Ngày hoá đơn</th><th>Hạn thanh toán</th><th class="num">Tổng cộng</th><th class="num">${esc(D)}</th><th>Trạng thái</th><th>Thanh toán</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-biz-open="invoice:${esc(r.id)}" tabindex="0"><td><b>${esc(r.display_number)}</b>${r.is_refund ? ' ' + badge('Giấy báo có', 'muted') : ''}</td><td>${esc(r.partner_name)}</td>${vendor ? `<td>${esc(r.ref || '')}</td>` : ''}<td>${dt(r.invoice_date)}</td><td class="${r.overdue ? 'neg' : ''}">${dt(r.due_date)}</td><td class="num">${vnd(r.amount_total)}</td><td class="num">${r.state === 'posted' ? vnd(r.residual) : ''}</td><td>${badge(r.state_vi, TONE[r.state])}</td><td>${r.state === 'posted' ? badge(r.payment_state_vi, TONE[r.payment_state]) : ''}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="${vendor ? 5 : 4}">${rows.length} dòng</td><td class="num"><b>${vnd(sum('amount_total'))}</b></td><td class="num"><b>${vnd(rows.filter(r => r.state === 'posted').reduce((a, r) => a + sg(r) * r.residual, 0))}</b></td><td colspan="2"></td></tr></tfoot></table>`;
  }
  async function invoiceForm(gen) {
    const id = B.form.id; await loadRefs();
    const inv = id ? await C('getInvoice', id) : null; live(gen);
    if (!B.edit) B.edit = inv ? { ...inv, lines: inv.lines.map(l => ({ ...l })) } : { kind: B.form.kind || 'out_invoice', partner_id: '', invoice_date: '', due_date: '', ref: '', vat_pct: defVat(), notes: '', lines: [] };
    const e = B.edit; const kind = inv ? inv.kind : e.kind; const vendor = kind.startsWith('in_'); const refund = kind.endsWith('_refund');
    const st = inv ? inv.state : 'draft'; const editable = st === 'draft';
    const acts = [];
    if (editable) { acts.push(btn('saveInvoice', 'Lưu', true)); if (inv) acts.push(btn('postInvoice', 'Vào sổ', true)); }
    if (inv && st === 'posted' && inv.residual > 0) acts.push(btn('payInvoice', kind === 'out_refund' ? 'Ghi nhận hoàn tiền' : kind === 'in_refund' ? 'Ghi nhận tiền nhà cung cấp hoàn' : 'Ghi nhận thanh toán', true));
    if (inv && st === 'posted' && !refund) acts.push(btn('creditNote', 'Tạo giấy báo có'));
    if (inv && st === 'posted') acts.push(btn('resetInvoice', 'Đặt lại nháp'));
    if (inv && st === 'draft') acts.push(btn('cancelInvoice', 'Huỷ'));
    if (inv && st === 'cancel') acts.push(btn('resetInvoice', 'Đặt lại nháp'));
    if (inv) acts.push(btn('printInvoice', '⬇ PDF', false, 'Lưu chứng từ thành tệp PDF khổ A4 (có VietQR khi còn phải thu)')); else acts.push(btn('discard', 'Bỏ'));
    const lines = e.lines;
    const ribbon = inv && st === 'posted' && ['paid', 'reversed', 'partial'].includes(inv.payment_state) ? `<div class="biz-ribbon ${inv.payment_state}">${esc(inv.payment_state_vi)}</div>` : '';
    const smarts = inv ? [inv.so_id ? smart('openSo', '🧾', 1, 'Đơn bán hàng') : '', inv.po_id ? smart('openPo', '🛒', 1, 'Đơn mua hàng') : '', inv.refunds.length ? smart('openRefunds', '↩', inv.refunds.length, 'Giấy báo có') : '', inv.reversed_id ? smart('openOrigin', '📄', 1, 'Hoá đơn gốc') : ''].join('') : '';
    const crumb = { out_invoice: 'Hoá đơn khách hàng', out_refund: 'Giấy báo có', in_invoice: 'Hoá đơn nhà cung cấp', in_refund: 'Giấy báo có nhà cung cấp' }[kind];
    const pays = inv && inv.payments.length ? inv.payments.map(p => `<div class="small"><span><span>${esc(p.method_vi)}</span> ${dt(p.date)} · ${esc(p.number)}</span><b>− ${vnd(p.amount)}</b></div>`).join('') : '';
    const due = inv && st === 'posted' ? `<div class="grand"><span>${esc(dueLabel(kind))}</span><b>${vnd(inv.residual)}</b></div>` : '';
    let qrBox = '';
    if (inv && kind === 'out_invoice' && st === 'posted' && inv.residual > 0) {
      const q = await C('invoiceQr', inv.id);
      qrBox = q.ok ? `<div class="biz-qr" aria-label="Mã VietQR chuyển khoản">${q.svg}<div><b>Quét mã VietQR để chuyển khoản</b><div class="small">${esc(q.bank)} · ${esc(q.account)}${q.holder ? ' · ' + esc(q.holder) : ''}</div><div class="small">Số tiền: <b>${vnd(q.amount)}</b> · Nội dung: <b>${esc(q.memo)}</b></div><div class="small muted">Mã đổi theo số còn phải thu; đã in kèm trong PDF.</div></div></div>`
        : `<p class="small muted biz-qr-hint">💡 Nhập tài khoản ngân hàng ở <a href="#" data-biz-act="openCompany">Cài đặt › Công ty</a> để hoá đơn có mã VietQR — khách quét là chuyển đúng số tiền và nội dung.</p>`;
    }
    const partners = B.contacts.map(c => [c.id, c.name]);
    return `${crumbs(['Hoá đơn', crumb, inv ? inv.display_number : 'Mới'])}
      <div class="biz-bar"><div class="biz-actions">${acts.join('')}</div>${statusbar([['draft', 'Nháp'], ['posted', 'Đã vào sổ']].concat(st === 'cancel' ? [['cancel', 'Đã huỷ']] : []), st)}</div>
      <div class="biz-sheet">${ribbon}${smarts ? `<div class="biz-smarts">${smarts}</div>` : ''}
        <h2 class="biz-title">${inv ? esc(inv.display_number) : vendor ? 'Hoá đơn nhà cung cấp mới' : 'Hoá đơn mới'}</h2>
        <div class="biz-grid"><label>${vendor ? 'Nhà cung cấp *' : 'Khách hàng *'}<select data-f="partner_id" ${editable ? '' : 'disabled'}>${opt(partners, e.partner_id, vendor ? '— chọn nhà cung cấp —' : '— chọn khách hàng —')}</select></label>
          ${vendor ? `<label title="Số hoá đơn do nhà cung cấp phát hành (in trên hoá đơn của họ)">Số hoá đơn của nhà cung cấp<input data-f="ref" value="${esc(e.ref || '')}" ${editable ? '' : 'disabled'}></label>` : ''}
          <label>Ngày hoá đơn<input type="date" data-f="invoice_date" value="${esc(e.invoice_date || '')}" ${editable ? '' : 'disabled'}></label>
          <label>Hạn thanh toán<input type="date" data-f="due_date" value="${esc(e.due_date || '')}" ${editable ? '' : 'disabled'}></label>
          ${editable ? `<label title="Áp cho mọi dòng; từng dòng vẫn chọn được mức riêng ở cột “Thuế”"><span>Thuế GTGT mặc định</span>${vatSel(e.vat_pct ?? defVat(), 'data-f="vat_pct"')}</label>` : ''}
          ${inv && inv.so_number ? `<div class="biz-ro"><span class="muted small">Đơn bán hàng</span><div>${esc(inv.so_number)}</div></div>` : ''}${inv && inv.po_number ? `<div class="biz-ro"><span class="muted small">Đơn mua hàng</span><div>${esc(inv.po_number)}</div></div>` : ''}${inv && inv.reversed_number ? `<div class="biz-ro"><span class="muted small">Đảo của</span><div>${esc(inv.reversed_number)}</div></div>` : ''}</div>
        ${linesTable(lines, editable, { products: B.products, rounding: roundingOf(e) })}
        ${editable ? `<div class="row">${btn('addLine', '＋ Thêm dòng')}</div>` : ''}
        ${totalsBox(lines, roundingOf(e), pays + due)}
        ${inv && inv.total_words && UIL() === 'vi' ? `<p class="small muted">Bằng chữ: ${esc(inv.total_words)}</p>` : ''}
        ${qrBox}
        <label class="biz-notes">Ghi chú<textarea data-f="notes" rows="2" ${editable ? '' : 'disabled'}>${esc(e.notes || '')}</textarea></label></div>`;
  }
  const invPayload = () => { const e = B.edit; return { id: B.form.id || undefined, kind: e.kind, partner_id: e.partner_id, invoice_date: e.invoice_date, due_date: e.due_date, ref: e.ref, vat_pct: e.vat_pct, notes: e.notes, lines: e.lines.map(l => ({ product_id: l.product_id || null, so_line_id: l.so_line_id || null, po_line_id: l.po_line_id || null, name: l.name, unit: l.unit, qty: l.qty, price: parseMoney(l.price), discount_pct: l.discount_pct, vat_pct: lineVat(l) })) }; };

  // ---------- Mua hàng (theo Odoo Purchase) ----------
  const PO_STEPS = [['draft', 'Yêu cầu báo giá'], ['sent', 'Đã gửi yêu cầu báo giá'], ['purchase', 'Đơn mua hàng']];
  async function purchaseList(s, q) {
    const rows = await C('listPurchases', { q, kind: s === 'rfq' ? 'rfq' : s === 'po' ? 'orders' : s });
    if (!rows.length) return empty('🛒', q ? 'Không có đơn mua nào khớp.' : s === 'rfq' ? 'Chưa có yêu cầu báo giá. Bấm “＋ Yêu cầu báo giá” để hỏi giá nhà cung cấp.' : s === 'toreceive' ? 'Không có đơn mua nào đang chờ nhận hàng.' : s === 'tobill' ? 'Không có đơn mua nào chờ hoá đơn nhà cung cấp.' : 'Chưa có đơn mua hàng. Xác nhận một yêu cầu báo giá để tạo đơn.');
    const rfq = s === 'rfq'; const sum = rows.reduce((a, r) => a + r.total, 0);
    B.lastRows = [['Số', 'Nhà cung cấp', 'Mã tham chiếu NCC', 'Ngày đặt hàng', 'Ngày nhận dự kiến', 'Tổng cộng', 'Trạng thái', 'Nhận hàng', 'Hoá đơn'], ...rows.map(r => [r.number, r.partner_name, r.partner_ref || '', r.date_order || '', r.date_planned || '', r.total, r.state_vi, r.receipt_status_vi, r.invoice_status_vi])];
    return `<table class="crm-table biz-list"><thead><tr><th>Số</th><th>Nhà cung cấp</th><th>Mã tham chiếu NCC</th><th>Ngày đặt hàng</th><th>Ngày nhận dự kiến</th><th class="num">Tổng cộng</th><th>Trạng thái</th>${rfq ? '' : '<th>Nhận hàng</th><th>Hoá đơn</th>'}</tr></thead><tbody>
      ${rows.map(r => `<tr data-biz-open="purchase:${esc(r.id)}" tabindex="0"><td><b>${esc(r.number)}</b></td><td>${esc(r.partner_name)}</td><td>${esc(r.partner_ref || '')}</td><td>${dt(r.date_order)}</td><td>${dt(r.date_planned)}</td><td class="num">${vnd(r.total)}</td><td>${badge(r.state_vi, TONE[r.state])}</td>${rfq ? '' : `<td>${badge(r.receipt_status_vi, TONE[r.receipt_status])}</td><td>${badge(r.invoice_status_vi, TONE[r.invoice_status])}${r.bill_payment ? ' ' + badge(r.bill_payment_vi, TONE[r.bill_payment]) : ''}</td>`}</tr>`).join('')}
      </tbody><tfoot><tr><td colspan="5">${rows.length} dòng</td><td class="num"><b>${vnd(sum)}</b></td><td colspan="${rfq ? 1 : 3}"></td></tr></tfoot></table>`;
  }
  const newPurchase = () => ({ id: null, state: 'draft', partner_id: '', partner_ref: '', date_order: today(), date_planned: '', payment_days: 0, vat_pct: defVat(), notes: '', lines: [] });
  async function purchaseForm(gen) {
    const id = B.form.id; await loadRefs();
    const o = id ? await C('getPurchase', id) : null; live(gen);
    if (!B.edit) B.edit = o ? { ...o, lines: o.lines.map(l => ({ ...l })) } : newPurchase();
    const e = B.edit; const st = o ? o.state : 'draft'; const editable = ['draft', 'sent'].includes(st); const confirmed = ['purchase', 'done'].includes(st);
    const acts = [];
    if (editable) { acts.push(btn('savePurchase', 'Lưu', true)); if (o) { if (st === 'draft') acts.push(btn('sendRfq', 'Đánh dấu đã gửi')); acts.push(btn('confirmPurchase', 'Xác nhận đơn', true)); } }
    if (o && confirmed && ['pending', 'partial'].includes(o.receipt_status)) acts.push(btn('receivePurchase', 'Nhận hàng', true));
    if (o && confirmed && o.invoice_status === 'to_invoice') acts.push(btn('createBill', 'Tạo hoá đơn', o.receipt_status === 'full' || o.receipt_status === 'none'));
    if (o && st === 'purchase') acts.push(btn('lockPurchase', 'Khoá', false, 'Khoá đơn để không sửa nữa (vẫn nhận hàng và nhận hoá đơn được)'));
    if (o && st === 'done') acts.push(btn('unlockPurchase', 'Mở khoá'));
    if (o && st !== 'cancel' && st !== 'done') acts.push(btn('cancelPurchase', 'Huỷ'));
    if (o && st === 'cancel') acts.push(btn('resetPurchase', 'Đặt lại nháp'));
    if (o) acts.push(btn('printPurchase', '⬇ PDF', false, 'Lưu yêu cầu báo giá / đơn mua hàng thành tệp PDF khổ A4')); else acts.push(btn('discard', 'Bỏ'));
    const smarts = o ? [o.pickings.length ? smart('openPoPickings', '📥', o.pickings.length, 'Nhận hàng') : '', o.bills.length ? smart('openBills', '🧾', o.bills.length, 'Hoá đơn nhà cung cấp') : ''].join('') : '';
    const steps = PO_STEPS.concat(st === 'done' ? [['done', 'Đã khoá']] : st === 'cancel' ? [['cancel', 'Đã huỷ']] : []);
    const vendors = B.contacts.map(c => [c.id, c.name + (c.company_name ? ' — ' + c.company_name : '')]);
    return `${crumbs(['Mua hàng', confirmed ? 'Đơn mua hàng' : 'Yêu cầu báo giá', o ? o.number : 'Mới'])}
      <div class="biz-bar"><div class="biz-actions">${acts.join('')}</div>${statusbar(steps, st === 'done' ? 'done' : st)}</div>
      <div class="biz-sheet">${smarts ? `<div class="biz-smarts">${smarts}</div>` : ''}
        <h2 class="biz-title">${esc(o ? o.number : 'Yêu cầu báo giá mới')}</h2>
        <div class="biz-grid">
          <label>Nhà cung cấp *<select data-f="partner_id" ${editable ? '' : 'disabled'}>${opt(vendors, e.partner_id, '— chọn nhà cung cấp —')}</select></label>
          <label title="Số báo giá / số đơn của nhà cung cấp">Mã tham chiếu NCC<input data-f="partner_ref" value="${esc(e.partner_ref || '')}" ${editable ? '' : 'disabled'}></label>
          <label>Ngày đặt hàng<input type="date" data-f="date_order" value="${esc(e.date_order || '')}" ${editable ? '' : 'disabled'}></label>
          <label>Ngày nhận dự kiến<input type="date" data-f="date_planned" value="${esc(e.date_planned || '')}" ${editable ? '' : 'disabled'}></label>
          <label>Điều khoản thanh toán<select data-f="payment_days" ${editable ? '' : 'disabled'}>${PAY_TERMS.map(([v, n]) => `<option value="${v}" ${Number(e.payment_days || 0) === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          ${editable ? `<label title="Áp cho mọi dòng; từng dòng vẫn chọn được mức riêng ở cột “Thuế”"><span>Thuế GTGT mặc định</span>${vatSel(e.vat_pct ?? defVat(), 'data-f="vat_pct"')}</label>` : ''}
          ${o && confirmed ? `<div class="biz-ro"><span class="muted small">Nhận hàng · Hoá đơn</span><div>${badge(o.receipt_status_vi, TONE[o.receipt_status])} ${badge(o.invoice_status_vi, TONE[o.invoice_status])}${o.bill_payment ? ' ' + badge(o.bill_payment_vi, TONE[o.bill_payment]) : ''}</div></div>` : ''}
          ${o && o.amount_due ? `<div class="biz-ro"><span class="muted small">Còn phải trả</span><div><b>${vnd(o.amount_due)}</b></div></div>` : ''}
        </div>
        <h3>Sản phẩm</h3>
        ${linesTable(e.lines, editable, { rounding: roundingOf(e), note: (l) => !confirmed ? '' : l.receivable ? `nhận ${qn(l.qty_received)} · HĐ ${qn(l.qty_billed)}` : `HĐ ${qn(l.qty_billed)}` })}
        ${editable ? `<div class="row">${btn('addLine', '＋ Thêm dòng')}</div>` : ''}
        ${totalsBox(e.lines, roundingOf(e))}
        ${confirmed ? '<p class="small muted">Hàng lưu kho và hàng tiêu dùng được lập hoá đơn theo số đã nhận; dịch vụ theo số đã đặt (như Odoo).</p>' : ''}
        <label class="biz-notes">Điều khoản và ghi chú<textarea data-f="notes" rows="2" ${editable ? '' : 'disabled'}>${esc(e.notes || '')}</textarea></label>
      </div>`;
  }
  const poPayload = () => { const e = B.edit; return { id: B.form.id || undefined, partner_id: e.partner_id, partner_ref: e.partner_ref, date_order: e.date_order, date_planned: e.date_planned, payment_days: e.payment_days, vat_pct: e.vat_pct, notes: e.notes, lines: e.lines.map(l => ({ product_id: l.product_id || null, name: l.name, unit: l.unit, qty: l.qty, price: parseMoney(l.price), discount_pct: l.discount_pct, vat_pct: lineVat(l) })) }; };

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
    const agedTable = (rows, tot, who) => `<table class="crm-table biz-list"><thead><tr><th>${esc(who)}</th><th class="num">Chưa đến hạn</th><th class="num">1–30 ngày</th><th class="num">31–60 ngày</th><th class="num">61–90 ngày</th><th class="num">Trên 90 ngày</th><th class="num">Tổng</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.partner_name)}</td>${['current', 'd30', 'd60', 'd90', 'older', 'total'].map(k => `<td class="num ${k !== 'current' && k !== 'total' && x[k] ? 'neg' : ''}">${x[k] ? vnd(x[k]) : ''}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><td>Tổng</td>${['current', 'd30', 'd60', 'd90', 'older', 'total'].map(k => `<td class="num"><b>${vnd(tot[k])}</b></td>`).join('')}</tr></tfoot></table>`;
    if (s === 'purchase') {
      const G = [['month', 'Tháng'], ['vendor', 'Nhà cung cấp'], ['product', 'Sản phẩm'], ['category', 'Nhóm sản phẩm']]; const gb = G.some(g => g[0] === r.groupBy) ? r.groupBy : 'month';
      const d = await C('purchaseReport', { groupBy: gb, from: r.from, to: r.to }); const max = Math.max(1, ...d.rows.map(x => x.untaxed)); const gl = (G.find(g => g[0] === gb) || G[0])[1];
      B.lastRows = [[gl, 'Số đơn', 'SL đặt', 'SL đã nhận', 'SL đã lập hoá đơn', 'Trước thuế', 'Tổng cộng'], ...d.rows.map(x => [x.label, x.orders, x.qty, x.received, x.billed, x.untaxed, x.total])];
      return `<div class="biz-filters"><label>Nhóm theo<select data-rep="groupBy">${G.map(([k, n]) => `<option value="${k}" ${gb === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>${range}</div>
        ${d.rows.length ? `<table class="crm-table biz-list"><thead><tr><th>${esc(gl)}</th><th class="num">Số đơn</th><th class="num">SL đặt</th><th class="num">SL đã nhận</th><th class="num">SL đã lập hoá đơn</th><th class="num">Trước thuế</th><th class="num">Tổng cộng</th><th class="biz-barcol"></th></tr></thead><tbody>${d.rows.map(x => `<tr><td>${esc(x.label)}</td><td class="num">${x.orders}</td><td class="num">${qn(x.qty)}</td><td class="num">${qn(x.received)}</td><td class="num">${qn(x.billed)}</td><td class="num">${vnd(x.untaxed)}</td><td class="num">${vnd(x.total)}</td><td class="biz-barcol"><span class="biz-hbar" style="width:${Math.round(100 * x.untaxed / max)}%"></span></td></tr>`).join('')}</tbody><tfoot><tr><td>Tổng</td><td class="num">${d.totals.orders}</td><td class="num">${qn(d.totals.qty)}</td><td class="num">${qn(d.totals.received)}</td><td class="num">${qn(d.totals.billed)}</td><td class="num"><b>${vnd(d.totals.untaxed)}</b></td><td class="num"><b>${vnd(d.totals.total)}</b></td><td></td></tr></tfoot></table>` : empty('🛒', 'Chưa có đơn mua hàng đã xác nhận trong khoảng này.')}`;
    }
    if (s === 'payable') {
      const d = await C('payablesReport', { from: r.from, to: r.to }); const a = d.agedTotals;
      B.lastRows = [['Nhà cung cấp', 'Chưa đến hạn', '1–30 ngày', '31–60 ngày', '61–90 ngày', 'Trên 90 ngày', 'Tổng'], ...d.aged.map(x => [x.partner_name, x.current, x.d30, x.d60, x.d90, x.older, x.total])];
      return `<div class="biz-filters">${range}</div><div class="kpis"><div class="kpi">Hoá đơn nhà cung cấp<b>${vnd(d.totals.untaxed)}</b><span class="small muted">gồm thuế ${vnd(d.totals.total)}</span></div><div class="kpi">Đã trả<b>${vnd(d.totals.paid)}</b></div><div class="kpi">Còn phải trả<b>${vnd(a.total)}</b><span class="small muted">quá hạn ${vnd(a.total - a.current)}</span>${a.credit ? `<span class="small muted">đã trừ báo có nhà cung cấp ${vnd(a.credit)}</span>` : ''}</div></div>
        <h3>Theo tháng</h3>${d.byMonth.length ? `<table class="crm-table biz-list"><thead><tr><th>Tháng</th><th class="num">Số chứng từ</th><th class="num">Trước thuế</th><th class="num">Thuế</th><th class="num">Tổng cộng</th></tr></thead><tbody>${d.byMonth.map(x => `<tr><td>${esc(x.key)}</td><td class="num">${x.count}</td><td class="num">${vnd(x.untaxed)}</td><td class="num">${vnd(x.tax)}</td><td class="num">${vnd(x.total)}</td></tr>`).join('')}</tbody></table>` : empty('🧾', 'Chưa có hoá đơn nhà cung cấp vào sổ trong khoảng này.')}
        <h3>Công nợ phải trả theo tuổi nợ</h3>${d.aged.length ? agedTable(d.aged, a, 'Nhà cung cấp') : '<p class="muted">Không còn công nợ phải trả. 👍</p>'}`;
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

  // ---------- hành động ----------
  async function act(a, el) {
    const f = B.form;
    try {
      if (a === 'discard') { B.form = null; B.edit = null; return rerender(); }
      if (a === 'addLine') { readForm(); if (f.type === 'receipt') { const p = B.products.find(x => x.type === 'product'); B.edit.lines.push({ product_id: p ? p.id : '', qty: 1, unit_cost: p ? p.cost : 0 }); } else B.edit.lines.push({ product_id: '', name: '', qty: 1, unit: 'cái', price: 0, discount_pct: 0, vat_pct: B.edit.vat_pct ?? defVat() }); return rerender(); }
      if (a === 'delLine') { readForm(); B.edit.lines.splice(Number(el.dataset.i), 1); return rerender(); }
      if (a === 'archiveProduct') { if (await modalAsk({ icon: '📦', title: 'Lưu trữ sản phẩm?', message: 'Sản phẩm sẽ ẩn khỏi danh sách và không chọn được cho đơn mới. Đơn, hoá đơn và lịch sử kho cũ vẫn giữ nguyên.', okLabel: 'Lưu trữ', noLabel: 'Giữ lại' })) { const r = await A.crm('deleteProduct', el.dataset.id); if (!r.ok && r.code === 'stock') { if (!await modalAsk({ icon: '⚠', title: 'Sản phẩm còn tồn kho', message: r.error, okLabel: 'Vẫn lưu trữ', noLabel: 'Giữ lại' })) return rerender(); const r2 = await A.crm('deleteProduct', el.dataset.id, { force: true }); if (!r2.ok) throw new Error(r2.error); } else if (!r.ok) throw new Error(r.error); toast('Đã lưu trữ ✓'); } return rerender(); }
      if (a === 'count') { return dialog(`Kiểm kê: ${el.dataset.name}`, [['counted', 'Số lượng đếm được thực tế'], ['note', 'Ghi chú (vd. Kiểm kê cuối tháng)']], { counted: Number(el.dataset.qty) }, async (o) => { const r = await C('adjustStock', el.dataset.id, o.counted, o.note); toast(r.changed ? `Đã điều chỉnh tồn: ${r.diff > 0 ? '+' : ''}${qn(r.diff)}` : 'Tồn kho đã đúng, không cần điều chỉnh.'); rerender(); }); }
      // Bán hàng
      if (a === 'saveOrder') { readForm(); const o = await C('saveQuote', orderPayload()); B.form = { type: 'order', id: o.id }; B.edit = null; toast('Đã lưu ✓'); return rerender(); }
      if (a === 'sendQuote' || a === 'confirmOrder') { readForm(); if (['draft', 'sent'].includes(B.edit.status)) await C('saveQuote', orderPayload()); const o = await C(a, f.id); B.edit = null; toast(a === 'confirmOrder' ? (o.pickings.length ? `Đã xác nhận đơn ${o.number} · đã tạo phiếu giao hàng` : `Đã xác nhận đơn ${o.number}`) : 'Đã đánh dấu báo giá đã gửi'); return rerender(); }
      if (a === 'invoiceOrder') { const inv = await C('invoiceOrder', f.id); toast('Đã tạo hoá đơn nháp'); return open('invoice', inv.id, 'invoices'); }
      if (a === 'cancelOrder') { if (!await modalAsk({ icon: '⚠', title: 'Huỷ đơn này?', message: 'Phiếu giao hàng chưa làm và hoá đơn nháp của đơn cũng sẽ bị huỷ.', okLabel: 'Huỷ đơn', noLabel: 'Không' })) return; await C('cancelOrder', f.id); B.edit = null; return rerender(); }
      if (a === 'resetToQuote') { await C('resetToQuote', f.id); B.edit = null; return rerender(); }
      if (a === 'openPickings') { const o = await C('getOrder', f.id); return o.pickings.length === 1 ? open('picking', o.pickings[0].id, 'stock') : (crm.tab = 'stock', B.sub.stock = 'out', B.form = null, $('#crmQ').value = o.number, renderCrm()); }
      if (a === 'openInvoices') { const o = await C('getOrder', f.id); return o.invoices.length === 1 ? open('invoice', o.invoices[0].id, 'invoices') : (crm.tab = 'invoices', B.sub.invoices = 'inv', B.form = null, $('#crmQ').value = o.number, renderCrm()); }
      if (a === 'printOrder') return pdf('quote', f.id);
      // Kho
      if (a === 'saveReceipt') { readForm(); const p = await C('createReceipt', { partner_id: B.edit.partner_id || null, scheduled: B.edit.scheduled, notes: B.edit.notes, lines: B.edit.lines.map(l => ({ product_id: l.product_id, qty: l.qty, unit_cost: parseMoney(l.unit_cost) })) }); toast(`Đã tạo ${p.number}`); return open('picking', p.id, 'stock'); }
      if (a === 'validatePicking') {
        const done = {}; $$('#crmBody [data-move]').forEach(x => { if (x.value.trim() !== '') done[x.dataset.move] = rv(x); });
        if (Object.keys(done).length) await C('setDone', f.id, done);
        const p = await C('getPicking', f.id); const partial = Object.keys(done).length && p.moves.some(m => (m.qty_done || 0) < m.qty);
        let backorder = true;
        if (partial) backorder = await modalAsk({ icon: '📦', title: 'Làm thiếu so với nhu cầu', message: 'Một số dòng làm ít hơn nhu cầu. Tạo phiếu chờ (backorder) cho phần còn lại?', okLabel: 'Tạo phiếu chờ', noLabel: 'Không, bỏ phần còn lại' });
        const r = await A.crm('validatePicking', f.id, { backorder });
        if (!r.ok && (r.code === 'short' || r.code === 'over')) { if (!await modalAsk({ icon: '⚠', title: r.code === 'over' ? (p.kind === 'in' ? 'Nhận vượt số lượng đặt' : 'Giao vượt số lượng đặt') : 'Không đủ hàng trong kho', message: r.error, okLabel: r.code === 'over' ? (p.kind === 'in' ? 'Vẫn nhận vượt' : 'Vẫn giao vượt') : 'Vẫn giao (tồn âm)', noLabel: 'Để sau' })) return; const r2 = await A.crm('validatePicking', f.id, { backorder, force: true }); if (!r2.ok) throw new Error(r2.error); }
        else if (!r.ok) throw new Error(r.error);
        toast('Đã xác nhận phiếu ✓'); return rerender();
      }
      if (a === 'cancelPicking') { if (!await modalAsk({ icon: '⚠', title: 'Huỷ phiếu kho?', message: 'Phiếu sẽ không còn được làm.', okLabel: 'Huỷ phiếu', noLabel: 'Không' })) return; await C('cancelPicking', f.id); return rerender(); }
      if (a === 'openSo') { const id = f.type === 'picking' ? (await C('getPicking', f.id)).so_id : (await C('getInvoice', f.id)).so_id; return open('order', id, 'sales'); }
      // Hoá đơn
      if (a === 'saveInvoice') { readForm(); const inv = await C('saveInvoice', invPayload()); B.form = { type: 'invoice', id: inv.id }; B.edit = null; toast('Đã lưu ✓'); return rerender(); }
      if (a === 'postInvoice') { readForm(); await C('saveInvoice', invPayload());
        let r = await A.crm('postInvoice', f.id);
        if (!r.ok && r.code === 'over_bill') { if (!await modalAsk({ icon: '⚠', title: 'Hoá đơn nhiều hơn số đã nhận', message: r.error, okLabel: 'Vẫn vào sổ', noLabel: 'Để sau' })) return; r = await A.crm('postInvoice', f.id, { force: true }); }
        if (!r.ok) throw new Error(r.error); B.edit = null; toast(`Đã vào sổ ${r.data.number}`); return rerender(); }
      if (a === 'payInvoice') { const inv = await C('getInvoice', f.id); return dialog(inv.kind === 'out_refund' ? 'Ghi nhận hoàn tiền' : 'Ghi nhận thanh toán', [['amount', 'Số tiền (₫)'], ['date', 'Ngày thanh toán', 'date'], ['method', 'Hình thức', [['bank', 'Chuyển khoản'], ['cash', 'Tiền mặt']]], ['memo', 'Nội dung']], { amount: inv.residual, date: today(), method: 'bank', memo: inv.number }, async (o) => { await C('registerPayment', f.id, o); toast('Đã ghi nhận ✓'); B.edit = null; rerender(); }); }
      if (a === 'creditNote') { return dialog('Tạo giấy báo có', [['reason', 'Lý do (vd. khách trả hàng, giảm giá)']], {}, async (o) => { const r = await C('creditNote', f.id, o); toast('Đã tạo giấy báo có nháp'); open('invoice', r.id, 'invoices'); }); }
      if (a === 'resetInvoice') { await C('resetInvoice', f.id); B.edit = null; return rerender(); }
      if (a === 'cancelInvoice') { await C('cancelInvoice', f.id); B.edit = null; return rerender(); }
      if (a === 'openRefunds') { const inv = await C('getInvoice', f.id); return open('invoice', inv.refunds[0].id, 'invoices'); }
      if (a === 'openOrigin') { const inv = await C('getInvoice', f.id); return open('invoice', inv.reversed_id, 'invoices'); }
      if (a === 'printInvoice') return pdf('invoice', f.id);
      if (a === 'printPicking') return pdf('picking', f.id);
      if (a === 'printPurchase') return pdf('purchase', f.id);
      if (a === 'openCompany') { show('settings'); setTab('company'); return renderCompany(); }
      // Mua hàng
      if (a === 'savePurchase') { readForm(); const o = await C('savePurchase', poPayload()); B.form = { type: 'purchase', id: o.id }; B.edit = null; toast('Đã lưu ✓'); return rerender(); }
      if (a === 'sendRfq' || a === 'confirmPurchase') { readForm(); if (['draft', 'sent'].includes(B.edit.state)) await C('savePurchase', poPayload()); const o = await C(a, f.id); B.edit = null; toast(a === 'confirmPurchase' ? (o.pickings.length ? `Đã xác nhận đơn mua ${o.number} · đã tạo phiếu nhập kho` : `Đã xác nhận đơn mua ${o.number}`) : 'Đã đánh dấu yêu cầu báo giá đã gửi'); return rerender(); }
      if (a === 'receivePurchase' || a === 'openPoPickings') { const o = await C('getPurchase', f.id); const ready = o.pickings.filter(p => ['draft', 'ready'].includes(p.state)); const list = a === 'receivePurchase' && ready.length ? ready : o.pickings; return list.length === 1 ? open('picking', list[0].id, 'stock') : (crm.tab = 'stock', B.sub.stock = 'in', B.form = null, $('#crmQ').value = o.number, renderCrm()); }
      if (a === 'createBill') { const inv = await C('createBill', f.id); toast('Đã tạo hoá đơn nhà cung cấp nháp'); return open('invoice', inv.id, 'invoices'); }
      if (a === 'openBills') { const o = await C('getPurchase', f.id); return o.bills.length === 1 ? open('invoice', o.bills[0].id, 'invoices') : (crm.tab = 'invoices', B.sub.invoices = 'bills', B.form = null, $('#crmQ').value = o.number, renderCrm()); }
      if (a === 'lockPurchase' || a === 'unlockPurchase') { await C('lockPurchase', f.id, a === 'lockPurchase'); B.edit = null; return rerender(); }
      if (a === 'cancelPurchase') { if (!await modalAsk({ icon: '⚠', title: 'Huỷ đơn mua này?', message: 'Phiếu nhập kho chưa làm và hoá đơn nhà cung cấp nháp của đơn cũng sẽ bị huỷ.', okLabel: 'Huỷ đơn', noLabel: 'Không' })) return; await C('cancelPurchase', f.id); B.edit = null; return rerender(); }
      if (a === 'resetPurchase') { await C('resetPurchase', f.id); B.edit = null; return rerender(); }
      if (a === 'openPo') { const id = f.type === 'picking' ? (await C('getPicking', f.id)).po_id : (await C('getInvoice', f.id)).po_id; return open('purchase', id, 'purchase'); }
    } catch (e) { toast(e.message, true); }
  }
  function open(type, id, app) { B.form = { type, id }; B.edit = null; if (app && crm.tab !== app) crm.tab = app; renderCrm(); }
  const rerender = () => renderCrm();
  async function renderForm(gen = ++renderGen) {
    const t = B.form.type; const el = body();
    try {
      const html = t === 'order' ? await orderForm(gen) : t === 'purchase' ? await purchaseForm(gen) : t === 'picking' ? await pickingForm() : t === 'invoice' ? await invoiceForm(gen) : t === 'receipt' ? receiptForm() : '';
      live(gen); el.innerHTML = html;
    } catch (e) { if (e !== STALE) throw e; }
  }
  // thêm: nút “＋”
  async function add(app) {
    await loadRefs();
    if (app === 'sales') { if (B.sub.sales === 'products') return productDialog(); B.form = { type: 'order', id: null }; B.edit = newOrder(); return renderCrm(); }
    if (app === 'stock') return receiptDialog();
    if (app === 'purchase') { B.form = { type: 'purchase', id: null }; B.edit = newPurchase(); return renderCrm(); }
    if (app === 'invoices') { B.form = { type: 'invoice', id: null, kind: VENDOR_SUBS.includes(B.sub.invoices) ? 'in_invoice' : 'out_invoice' }; B.edit = null; return renderCrm(); }
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
    const buying = B.form.type === 'purchase' || (B.form.type === 'invoice' && String(B.edit.kind || '').startsWith('in_'));
    if (lf && lf.dataset.lf === 'product_id') { const l = B.edit.lines[Number(lf.closest('tr').dataset.line)]; const p = B.products.find(x => x.id === lf.value); if (p && l) { if (B.form.type === 'receipt') l.unit_cost = p.cost || 0; else { l.name = p.name; l.unit = p.unit; l.price = buying ? (p.cost || 0) : p.price; if (p.vat_pct != null) l.vat_pct = p.vat_pct; } } }
    if (f && f.dataset.f === 'vat_pct') B.edit.lines.forEach(l => { l.vat_pct = Number(f.value); });
    if ((lf && ['product_id', 'qty', 'price', 'discount_pct', 'vat_pct'].includes(lf.dataset.lf)) || (f && f.dataset.f === 'vat_pct')) renderForm();
  });
  el.addEventListener('change', (e) => { const r = e.target.closest('[data-rep]'); if (r && crm.tab === 'reports') { B.rep[r.dataset.rep] = r.value; renderCrm(); } });

  // Tổng quan: thêm số liệu Bán hàng / Kho / Hoá đơn
  async function dashExtra(target) {
    try {
      const o = await C('overview');
      const card = (label, val, sub, go) => `<button type="button" class="kpi biz-kpi" data-biz-go="${go}">${esc(label)}<b>${val}</b>${sub ? `<span class="small muted">${esc(sub)}</span>` : ''}</button>`;
      const div = document.createElement('div'); div.className = 'kpis biz-dash';
      div.innerHTML = card('Doanh số tháng này', vnd(o.salesMonth), `đã lập hoá đơn ${vnd(o.invoicedMonth)}`, 'reports:sales') + card('Báo giá đang mở', o.quotesDraft, '', 'sales:quotes') + card('Đơn chờ lập hoá đơn', o.toInvoice, '', 'sales:toinv') + card('Phiếu giao sẵn sàng', o.deliveriesReady, o.receiptsReady ? `${o.receiptsReady} phiếu nhập chờ` : '', 'stock:out') + card('Còn phải thu', vnd(o.receivable), o.overdue.n ? `${o.overdue.n} hoá đơn quá hạn · ${vnd(o.overdue.sum)}` : '', o.overdue.n ? 'invoices:overdue' : 'invoices:unpaid')
        + card('Yêu cầu báo giá đang mở', o.rfqOpen, o.poToReceive ? `${o.poToReceive} đơn mua chờ nhận hàng` : '', o.poToReceive ? 'purchase:toreceive' : 'purchase:rfq') + card('Còn phải trả', vnd(o.payable), o.payableOverdue.n ? `${o.payableOverdue.n} hoá đơn nhà cung cấp quá hạn · ${vnd(o.payableOverdue.sum)}` : o.poToBill ? `${o.poToBill} đơn mua chờ hoá đơn` : '', 'invoices:topay') + (o.lowStock ? card('Sắp hết hàng', o.lowStock, 'dưới tồn tối thiểu', 'stock:onhand') : '');
      div.addEventListener('click', (e) => { const b = e.target.closest('[data-biz-go]'); if (!b) return; const [app, s] = b.dataset.bizGo.split(':'); crm.tab = app; B.sub[app] = s; B.form = null; if (app === 'stock' && s === 'onhand' && o.lowStock) B.stockFilter = 'low'; renderCrm(); });
      if (crm.tab !== 'dash' || !target.isConnected) return;
      target.querySelectorAll('.biz-dash').forEach(x => x.remove()); // renderCrm gọi chồng nhau → chỉ giữ một hàng KPI
      target.prepend(div);
    } catch {}
  }
  // ---------- Cài đặt › Công ty (Odoo: Settings › Companies) ----------
  const CO_KEYS = ['name', 'tax_id', 'address', 'phone', 'email', 'website', 'bank_bin', 'bank_account', 'bank_holder', 'bank_branch', 'signer', 'signer_title', 'accountant', 'default_vat', 'tax_rounding', 'doc_footer'];
  const CO = { data: null, logo: undefined, banks: null };
  async function renderCompany() {
    const host = $('#bizCompany'); if (!host) return;
    try {
      if (!CO.banks) CO.banks = await C('listBanks');
      const c = CO.data = await C('getCompany'); CO.logo = c.logo || null;
      const f = (k, label, extra = '', hint = '') => `<label class="biz-co-f">${esc(label)}<input data-co="${k}" value="${esc(c[k] ?? '')}" ${extra}>${hint ? `<small class="muted">${esc(hint)}</small>` : ''}</label>`;
      host.innerHTML = `<p class="small muted">Thông tin in trên báo giá, hoá đơn, phiếu kho và đơn mua (PDF). Lưu trên máy này, cùng dữ liệu Kinh doanh.</p>
        <div class="biz-co">
          <div class="biz-co-logo"><div class="biz-logo-box" id="coLogoBox">${CO.logo ? `<img src="${esc(CO.logo)}" alt="Logo công ty">` : '<span class="muted small">Chưa có logo</span>'}</div>
            <div class="row"><label class="btn sm">Chọn ảnh…<input type="file" id="coLogoFile" accept="image/png,image/jpeg,image/webp" hidden></label><button type="button" class="btn sm" id="coLogoDel" ${CO.logo ? '' : 'disabled'}>Bỏ logo</button></div>
            <small class="muted">PNG/JPEG/WebP, tự thu nhỏ còn tối đa 600 × 300 điểm ảnh.</small></div>
          <div class="biz-co-grid">
            ${f('name', 'Tên công ty *', 'autocomplete="organization"')}${f('tax_id', 'Mã số thuế (MST)', 'inputmode="numeric"', '10 số, chi nhánh 10 số-3 số')}
            <label class="biz-co-f wide">Địa chỉ<textarea data-co="address" rows="2">${esc(c.address || '')}</textarea></label>
            ${f('phone', 'Điện thoại', 'inputmode="tel"')}${f('email', 'Email', 'type="email"')}${f('website', 'Trang web')}
          </div>
        </div>
        <h4>Tài khoản ngân hàng nhận tiền (VietQR)</h4>
        <div class="biz-co-grid">
          <label class="biz-co-f">Ngân hàng<select data-co="bank_bin"><option value="">— chọn ngân hàng —</option>${CO.banks.map(b => `<option data-noi18n value="${esc(b.bin)}" ${c.bank_bin === b.bin ? 'selected' : ''}>${esc(b.code)} — ${esc(b.name)}</option>`).join('')}</select></label>
          ${f('bank_account', 'Số tài khoản', 'inputmode="numeric" autocomplete="off"')}${f('bank_holder', 'Chủ tài khoản', '', 'Viết hoa không dấu, đúng như ngân hàng hiển thị')}${f('bank_branch', 'Chi nhánh')}
        </div>
        <div class="biz-co-qr" id="coQr"></div>
        <h4>Chứng từ</h4>
        <div class="biz-co-grid">
          ${f('signer', 'Người đại diện ký')}${f('signer_title', 'Chức danh')}${f('accountant', 'Kế toán')}
          <label class="biz-co-f"><span>Thuế GTGT mặc định</span>${vatSel(c.default_vat, 'data-co="default_vat"')}<small class="muted">Cho sản phẩm và dòng mới</small></label>
          <label class="biz-co-f">Làm tròn thuế<select data-co="tax_rounding"><option value="line" ${c.tax_rounding !== 'global' ? 'selected' : ''}>Theo từng dòng (như Odoo, mặc định)</option><option value="global" ${c.tax_rounding === 'global' ? 'selected' : ''}>Gộp theo mức thuế</option></select><small class="muted">Áp cho chứng từ tạo mới</small></label>
          <label class="biz-co-f wide">Chân trang chứng từ<textarea data-co="doc_footer" rows="2" placeholder="vd. Cảm ơn quý khách đã tin dùng!">${esc(c.doc_footer || '')}</textarea></label>
        </div>
        <p class="small" id="coErr" role="alert" style="color:#82071e"></p>
        <div class="row"><button type="button" class="btn primary" id="coSave">Lưu thông tin công ty</button></div>`;
      paintQr();
    } catch (e) { host.innerHTML = `<div class="empty-state">⚠ ${esc(e.message)}</div>`; }
  }
  const coInput = () => { const o = {}; $$('#bizCompany [data-co]').forEach(x => { o[x.dataset.co] = x.value; }); o.logo = CO.logo; return o; };
  async function paintQr() {
    const box = $('#coQr'); if (!box) return; const o = coInput();
    const r = await C('companyQr', { bank_bin: o.bank_bin, bank_account: o.bank_account }).catch(() => ({ ok: false }));
    box.innerHTML = r.ok ? `<div class="biz-qr">${r.svg}<div><b>Mã thử (không có số tiền)</b><div class="small">Quét bằng ứng dụng ngân hàng: phải hiện đúng tên chủ tài khoản. Hoá đơn sẽ có mã kèm số tiền còn phải thu và nội dung là số hoá đơn.</div></div></div>`
      : '<p class="small muted">Chọn ngân hàng và nhập số tài khoản để hoá đơn có mã VietQR.</p>';
  }
  // thu nhỏ ảnh logo bằng canvas → data URL (PNG giữ nền trong suốt; quá lớn thì JPEG)
  function shrink(file) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = () => rej(new Error('Không đọc được ảnh.')); fr.onload = () => { const img = new Image(); img.onerror = () => rej(new Error('Tệp không phải ảnh hợp lệ.')); img.onload = () => {
      const k = Math.min(1, 600 / img.width, 300 / img.height); const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); let u = cv.toDataURL('image/png'); if (u.length > 380 * 1024) u = cv.toDataURL('image/jpeg', 0.85); res(u); }; img.src = fr.result; }; fr.readAsDataURL(file); });
  }
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#setNav [data-stab="company"]')) return renderCompany();
    if (e.target.closest('#coLogoDel')) { CO.logo = null; $('#coLogoBox').innerHTML = '<span class="muted small">Chưa có logo</span>'; $('#coLogoDel').disabled = true; return; }
    if (e.target.closest('#coSave')) { const err = $('#coErr'); err.textContent = ''; try { const o = coInput(); const out = {}; for (const k of CO_KEYS) out[k] = o[k]; out.logo = o.logo; await C('saveCompany', out); B.company = null; toast('Đã lưu thông tin công ty ✓'); renderCompany(); } catch (x) { err.textContent = x.message; } }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'coLogoFile' && e.target.files[0]) { try { CO.logo = await shrink(e.target.files[0]); $('#coLogoBox').innerHTML = `<img src="${esc(CO.logo)}" alt="Logo công ty">`; $('#coLogoDel').disabled = false; } catch (x) { toast(x.message, true); } e.target.value = ''; }
    if (e.target.closest('#bizCompany [data-co="bank_bin"], #bizCompany [data-co="bank_account"]')) paintQr();
  });
  window.BIZ = { tabs: Object.keys(APPS), render, add, dashExtra, renderCompany, state: B, reset: () => { B.form = null; B.edit = null; } };
})();
