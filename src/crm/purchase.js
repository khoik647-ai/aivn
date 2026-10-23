// Mua hàng 0.16 (theo Odoo 19 purchase): Yêu cầu báo giá (RFQ) → Đã gửi RFQ → Đơn mua hàng (tạo phiếu nhập WH/IN gắn đơn) → nhận hàng (cộng tồn,
// giá vốn bình quân) → Hoá đơn nhà cung cấp (theo số ĐÃ NHẬN với hàng lưu kho/tiêu dùng, theo số ĐÃ ĐẶT với dịch vụ) → trả tiền → công nợ phải trả.
// Nhà cung cấp dùng chung danh bạ Liên hệ. Dữ liệu trên máy (SQLite), tiền là số nguyên VND.
'use strict';
const crypto = require('crypto');
const T = require('./text');
const UOM = require('./uom'); // đơn vị tính: lưu khoá chuẩn tiếng Việt, hiện theo ngôn ngữ
const TAX = require('./tax');
const { CrmError } = require('./crm');

const PO_STATE = { draft: 'Yêu cầu báo giá', sent: 'Đã gửi yêu cầu báo giá', purchase: 'Đơn mua hàng', done: 'Đã khoá', cancel: 'Đã huỷ' };
const RECEIPT_STATUS = { none: 'Không cần nhận hàng', pending: 'Chưa nhận hàng', partial: 'Nhận một phần', full: 'Đã nhận đủ' };
const BILL_STATUS = { no: 'Không có gì để lập hoá đơn', to_invoice: 'Chờ hoá đơn', invoiced: 'Đã nhận đủ hoá đơn' };
const BILL_PAY = { not_paid: 'Chưa thanh toán', partial: 'Thanh toán một phần', paid: 'Đã thanh toán' };
const newId = (p) => p + '_' + crypto.randomBytes(6).toString('hex');
const str = (v, max = 500) => (v == null ? '' : String(v)).trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const EPS = 1e-9;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const fmtQ = (q) => (Math.round(q * 1000) / 1000).toLocaleString('vi-VN');
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };

function createPurchase({ db, crm, now, today, log = () => {}, h }) {
  const product = h.product; const partner = h.partner;
  // chính sách lập hoá đơn (Odoo purchase_method): hàng lưu kho / tiêu dùng theo số đã nhận, dịch vụ theo số đã đặt
  const byReceipt = (type) => !type || type === 'product' || type === 'consu';
  const qtyReceived = (lid) => db.get("SELECT COALESCE(SUM(qty_done), 0) AS q FROM moves WHERE po_line_id = ? AND kind = 'in' AND state = 'done'", [lid]).q;
  const qtyBilled = (lid) => db.get("SELECT COALESCE(SUM(CASE i.kind WHEN 'in_refund' THEN -l.qty ELSE l.qty END), 0) AS q FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.po_line_id = ? AND i.state != 'cancel'", [lid]).q;
  function poLines(poId, state) {
    const rd = TAX.roundingOf((db.get('SELECT tax_rounding FROM purchase_orders WHERE id = ?', [poId]) || {}).tax_rounding);
    return db.all('SELECT l.*, p.type AS product_type FROM purchase_lines l LEFT JOIN products p ON p.id = l.product_id WHERE l.po_id = ? ORDER BY l.pos', [poId]).map(l => {
      const rcv = T.round3(qtyReceived(l.id)), billed = T.round3(qtyBilled(l.id)); const policy = byReceipt(l.product_type) && l.product_id ? 'receive' : 'order';
      const base = ['purchase', 'done'].includes(state) ? (policy === 'receive' ? rcv : l.qty) : 0;
      return { ...l, amount: TAX.lineSubtotal(l, rd), tax: TAX.lineTax(l, rd), qty_received: rcv, qty_billed: billed, bill_policy: policy, qty_to_bill: T.round3(Math.max(0, base - billed)), receivable: !!l.product_id && byReceipt(l.product_type) };
    });
  }
  function statusOf(po, lines) {
    const confirmed = ['purchase', 'done'].includes(po.state);
    const rl = lines.filter(l => l.receivable && l.qty > EPS);
    const receipt_status = !confirmed || !rl.length ? 'none' : rl.every(l => l.qty_received + EPS >= l.qty) ? 'full' : rl.some(l => l.qty_received > EPS) ? 'partial' : 'pending';
    const invoice_status = !confirmed ? 'no' : lines.some(l => l.qty_to_bill > EPS) ? 'to_invoice' : lines.some(l => l.qty_billed > EPS) ? 'invoiced' : 'no';
    const bills = db.all("SELECT * FROM invoices WHERE po_id = ? AND kind = 'in_invoice' AND state = 'posted'", [po.id]).map(h.pubInvoice);
    const due = bills.reduce((a, b) => a + b.residual, 0), total = bills.reduce((a, b) => a + b.amount_total, 0);
    const bill_payment = !bills.length ? null : due <= 0 ? 'paid' : due < total ? 'partial' : 'not_paid';
    return { receipt_status, invoice_status, bill_payment, amount_due: due };
  }
  const pub = (po, lines) => { const t = TAX.totals(lines, TAX.roundingOf(po.tax_rounding)); const st = statusOf(po, lines);
    return { ...po, partner_name: (partner(po.partner_id) || {}).name || '', state_vi: PO_STATE[po.state], ...st, receipt_status_vi: RECEIPT_STATUS[st.receipt_status], invoice_status_vi: BILL_STATUS[st.invoice_status], bill_payment_vi: st.bill_payment ? BILL_PAY[st.bill_payment] : '',
      subtotal: t.amount_untaxed, vat: t.amount_tax, total: t.amount_total, tax_groups: t.tax_groups }; };
  function getPurchase(id) {
    const po = db.get('SELECT * FROM purchase_orders WHERE id = ?', [id]); if (!po) throw new CrmError('Không tìm thấy đơn mua.');
    const lines = poLines(id, po.state); const out = pub(po, lines);
    out.lines = lines; out.partner = partner(po.partner_id); out.total_words = T.vndWords(out.total);
    out.pickings = h.listPickings({ poId: id }); out.bills = db.all("SELECT * FROM invoices WHERE po_id = ? AND kind IN ('in_invoice','in_refund') ORDER BY created_at", [id]).map(h.pubInvoice);
    return out;
  }
  function listPurchases({ q = '', kind = '', partnerId = '' } = {}) {
    const where = [], p = [];
    if (kind === 'rfq') where.push("o.state IN ('draft','sent')"); else if (['orders', 'toreceive', 'tobill'].includes(kind)) where.push("o.state IN ('purchase','done')"); else if (kind === 'cancel') where.push("o.state = 'cancel'");
    if (partnerId) { where.push('o.partner_id = ?'); p.push(partnerId); }
    if (q) { where.push('(lower(o.number) LIKE ? OR c.name_norm LIKE ? OR lower(o.partner_ref) LIKE ?)'); p.push('%' + q.toLowerCase() + '%', '%' + T.fold(q) + '%', '%' + q.toLowerCase() + '%'); }
    let rows = db.all(`SELECT o.* FROM purchase_orders o LEFT JOIN contacts c ON c.id = o.partner_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC`, p).map(o => pub(o, poLines(o.id, o.state)));
    if (kind === 'toreceive') rows = rows.filter(r => ['pending', 'partial'].includes(r.receipt_status)); else if (kind === 'tobill') rows = rows.filter(r => r.invoice_status === 'to_invoice');
    return rows;
  }
  function nextNumber() { const r = db.get("SELECT number FROM purchase_orders WHERE number LIKE 'P%' ORDER BY length(number) DESC, number DESC LIMIT 1"); const n = r ? (parseInt(String(r.number).slice(1), 10) || 0) + 1 : 1; return 'P' + String(n).padStart(5, '0'); }
  // ---------- #42 K1: bảng giá nhà cung cấp (Odoo product.supplierinfo) ----------
  // Mỗi dòng: sản phẩm × NCC × số lượng tối thiểu → đơn giá + số ngày giao. Chọn giá như Odoo _select_seller: dòng của NCC đó có
  // số lượng tối thiểu ≤ số lượng đặt, lấy giá thấp nhất; không có dòng nào → giá vốn sản phẩm, 0 ngày.
  const pubVp = (r) => ({ ...r, partner_name: (partner(r.partner_id) || {}).name || '', product_name: (product(r.product_id) || {}).name || '' });
  function listVendorPrices({ productId = '', partnerId = '' } = {}) {
    const where = [], p = []; if (productId) { where.push('product_id = ?'); p.push(productId); } if (partnerId) { where.push('partner_id = ?'); p.push(partnerId); }
    return db.all(`SELECT * FROM vendor_prices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sequence, min_qty, created_at`, p).map(pubVp);
  }
  // lưu cả bảng giá NCC của một sản phẩm (thay toàn bộ, giữ thứ tự)
  function saveVendorPrices(productId, rows = []) {
    const pr = product(productId); if (!pr) throw new CrmError('Không tìm thấy sản phẩm.');
    if (!Array.isArray(rows) || rows.length > 200) throw new CrmError('Bảng giá nhà cung cấp không hợp lệ.');
    const seen = new Set();
    const clean = rows.filter(r => r && (r.partner_id || String(r.price ?? '').trim() !== '')).map((r, i) => {
      if (!partner(r.partner_id)) throw new CrmError('Hãy chọn nhà cung cấp cho mọi dòng giá.');
      const mq = T.parseQty(r.min_qty); if (r.min_qty != null && String(r.min_qty).trim() !== '' && !Number.isFinite(mq)) throw new CrmError(`Số lượng “${r.min_qty}” không phải là số.`);
      const dl = String(r.delay ?? '').trim() === '' ? 0 : Number(String(r.delay).trim()); if (!Number.isInteger(dl) || dl < 0 || dl > 365) throw new CrmError(`Số ngày giao “${r.delay}” phải là số nguyên từ 0 đến 365.`);
      const row = { id: newId('vp'), product_id: pr.id, partner_id: r.partner_id, min_qty: T.round3(Math.max(0, Number.isFinite(mq) ? mq : 0)), price: Math.max(0, TAX.moneyIn(r.price, 0)), delay: dl, sequence: i + 1 };
      const k = row.partner_id + '|' + row.min_qty; if (seen.has(k)) throw new CrmError(`Nhà cung cấp “${(partner(row.partner_id) || {}).name}” có hai dòng giá cùng số lượng tối thiểu ${fmtQ(row.min_qty)}.`); seen.add(k);
      return row;
    });
    db.tx(() => { db.run('DELETE FROM vendor_prices WHERE product_id = ?', [pr.id]); for (const r of clean) db.run('INSERT INTO vendor_prices(id, product_id, partner_id, min_qty, price, delay, sequence, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [r.id, r.product_id, r.partner_id, r.min_qty, r.price, r.delay, r.sequence, now(), now()]); });
    return listVendorPrices({ productId: pr.id });
  }
  function deleteVendorPrice(id) { return db.run('DELETE FROM vendor_prices WHERE id = ?', [id]) > 0; }
  function sellerOf(productId, partnerId, qty) {
    if (!productId || !partnerId) return null; const q = Number.isFinite(Number(qty)) ? Number(qty) : 0;
    const rows = db.all('SELECT * FROM vendor_prices WHERE product_id = ? AND partner_id = ? ORDER BY sequence, min_qty DESC', [productId, partnerId]).filter(r => (r.min_qty || 0) <= q + EPS);
    return rows.reduce((b, r) => (!b || r.price < b.price ? r : b), null);
  }
  // giá + ngày giao gợi ý cho một dòng đơn mua (giao diện gọi khi chọn sản phẩm / đổi số lượng / đổi NCC)
  function vendorPrice({ productId = '', partnerId = '', qty = 1, dateOrder = '' } = {}) {
    const pr = productId ? product(productId) : null; if (!pr) return { price: 0, delay: 0, source: 'none', date_planned: null };
    const q = T.parseQty(qty); const s = sellerOf(pr.id, partnerId, Number.isFinite(q) ? q : 0); const d0 = isDate(dateOrder) ? dateOrder : today();
    return s ? { price: s.price, delay: s.delay || 0, source: 'vendor', vendor_price_id: s.id, min_qty: s.min_qty, date_planned: addDays(d0, s.delay || 0) } : { price: pr.cost || 0, delay: 0, source: 'cost', date_planned: null };
  }
  // tạo / sửa yêu cầu báo giá (dòng khoá sau khi xác nhận, như Bán hàng)
  function savePurchase(input = {}) {
    const old = input.id ? db.get('SELECT * FROM purchase_orders WHERE id = ?', [input.id]) : null;
    if (input.id && !old) throw new CrmError('Không tìm thấy đơn mua.');
    if (old && ['purchase', 'done', 'cancel'].includes(old.state) && Array.isArray(input.lines)) throw new CrmError(old.state === 'cancel' ? 'Đơn mua đã huỷ: bấm “Đặt lại nháp” trước khi sửa.' : 'Đơn mua đã xác nhận: không sửa dòng được nữa. Huỷ đơn (khi chưa nhận hàng) rồi đặt lại nháp nếu cần sửa.');
    const o = { ...(old || {}), ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'lines')) };
    if (!partner(o.partner_id)) throw new CrmError('Hãy chọn nhà cung cấp.');
    o.state = old ? old.state : 'draft';
    o.partner_ref = str(o.partner_ref, 80); o.notes = str(o.notes, 3000); o.owner = str(o.owner || (old ? old.owner : ''), 80);
    o.date_order = isDate(o.date_order) ? o.date_order : today(); o.date_planned = isDate(o.date_planned) ? o.date_planned : null;
    if (o.date_planned && o.date_planned < o.date_order) throw new CrmError('Ngày nhận dự kiến không được trước ngày đặt hàng.');
    o.payment_days = Math.max(0, Math.min(365, parseInt(o.payment_days, 10) || 0));
    o.vat_pct = TAX.vatOf(o.vat_pct, h.company().default_vat); o.tax_rounding = old ? TAX.roundingOf(old.tax_rounding) : h.company().tax_rounding;
    const docVatGiven = input.vat_pct !== undefined && input.vat_pct !== null && input.vat_pct !== '';
    const delays = []; // #42 K1: số ngày giao của các dòng có giá NCC → ngày nhận dự kiến khi chưa nhập
    const lines = Array.isArray(input.lines) ? input.lines.map((l, i) => {
      const pr = l.product_id ? product(l.product_id) : null; if (l.product_id && (!pr || !pr.active)) throw new CrmError('Dòng đơn mua có sản phẩm không tồn tại hoặc đã lưu trữ.');
      const qty = T.parseQty(l.qty); if (l.qty != null && String(l.qty).trim() !== '' && !Number.isFinite(qty)) throw new CrmError(`Số lượng “${l.qty}” không phải là số.`);
      const given = l.vat_pct !== undefined && l.vat_pct !== null && l.vat_pct !== '';
      const q = Math.max(0, Number.isFinite(qty) ? qty : 0); const seller = pr ? sellerOf(pr.id, o.partner_id, q) : null; if (seller) delays.push(seller.delay || 0);
      return { id: newId('pol'), product_id: pr ? pr.id : null, name: str(l.name || (pr && pr.name), 300), unit: UOM.canon(str(l.unit || (pr && pr.unit), 30)) || 'cái', qty: q,
        price: Math.max(0, TAX.moneyIn(l.price, seller ? seller.price : pr ? pr.cost || 0 : 0)), discount_pct: TAX.pctIn(l.discount_pct),
        vat_pct: given ? TAX.vatOf(l.vat_pct) : !docVatGiven && pr && pr.vat_pct != null ? TAX.vatOf(pr.vat_pct) : o.vat_pct, price_include: TAX.inclIn(l.price_include), pos: i }; // #42 K3: mặc định giá mua chưa thuế
    }).filter(l => l.name) : null;
    if (!o.date_planned && delays.length) o.date_planned = addDays(o.date_order, Math.min(...delays)); // như Odoo: ngày đặt + số ngày giao (dòng sớm nhất)
    db.tx(() => {
      if (old) db.run('UPDATE purchase_orders SET partner_id=?, partner_ref=?, date_order=?, date_planned=?, payment_days=?, vat_pct=?, owner=?, notes=?, updated_at=? WHERE id=?', [o.partner_id, o.partner_ref, o.date_order, o.date_planned, o.payment_days, o.vat_pct, o.owner, o.notes, now(), o.id]);
      else { o.id = newId('po'); o.number = nextNumber(); db.run('INSERT INTO purchase_orders(id, number, partner_id, partner_ref, state, date_order, date_planned, payment_days, vat_pct, tax_rounding, owner, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [o.id, o.number, o.partner_id, o.partner_ref, 'draft', o.date_order, o.date_planned, o.payment_days, o.vat_pct, o.tax_rounding, o.owner, o.notes, now(), now()]); }
      if (lines) { db.run('DELETE FROM purchase_lines WHERE po_id = ?', [o.id]); for (const l of lines) db.run('INSERT INTO purchase_lines(id, po_id, product_id, name, unit, qty, price, discount_pct, vat_pct, price_include, pos) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [l.id, o.id, l.product_id, l.name, l.unit, l.qty, l.price, l.discount_pct, l.vat_pct, l.price_include, l.pos]); }
    });
    const full = getPurchase(o.id);
    if (!old) h.hist(o.partner_id, `Tạo yêu cầu báo giá ${full.number}: ${T.fmtVnd(full.total)}`);
    return full;
  }
  // #42 K2: quy tắc tồn tối thiểu / tối đa → yêu cầu báo giá nháp (Odoo stock.warehouse.orderpoint, chạy tay bằng nút “Đặt hàng bổ sung”).
  // Tồn dự báo (thực tế + sắp nhập − sắp giao) < tối thiểu → đặt đến tối đa (tối đa < tối thiểu thì lấy tối thiểu). NCC ưu tiên = dòng đầu bảng giá NCC
  // (thứ tự, rồi SL tối thiểu) có “Từ SL” ≤ số cần đặt. Đã có yêu cầu báo giá nháp cho sản phẩm → chỉ sửa số lượng dòng đó; đã gửi → để nguyên.
  function preferredVendor(pid, qty) {
    const rows = db.all('SELECT * FROM vendor_prices WHERE product_id = ? ORDER BY sequence, min_qty, created_at', [pid]);
    const r = rows.find(x => (x.min_qty || 0) <= qty + EPS) || rows[0]; return r ? r.partner_id : null;
  }
  function reorderPlan() {
    const out = [];
    for (const pr of db.all("SELECT * FROM products WHERE active = 1 AND type = 'product' AND min_qty > 0 ORDER BY name")) {
      const s = h.stockOf(pr.id); if (s.forecast >= pr.min_qty - EPS) continue;
      const max = Math.max(pr.max_qty || 0, pr.min_qty); const qty = T.round3(max - s.forecast);
      const open = db.get("SELECT l.id AS line_id, l.qty, o.id AS po_id, o.number, o.state, o.partner_id FROM purchase_lines l JOIN purchase_orders o ON o.id = l.po_id WHERE l.product_id = ? AND o.state IN ('draft', 'sent') ORDER BY o.state = 'draft' DESC, o.created_at, l.pos LIMIT 1", [pr.id]);
      const vendor = open ? open.partner_id : preferredVendor(pr.id, qty);
      out.push({ product_id: pr.id, name: pr.name, unit: pr.unit, forecast: s.forecast, min_qty: pr.min_qty, max_qty: max, qty, partner_id: vendor, partner_name: vendor ? (partner(vendor) || {}).name || '' : '',
        action: open ? (open.state === 'draft' ? 'update' : 'sent') : vendor ? 'create' : 'no_vendor', po_id: open ? open.po_id : null, po_number: open ? open.number : '', line_id: open ? open.line_id : null, old_qty: open ? open.qty : null });
    }
    return out;
  }
  // giá vốn nhập kho của một đơn vị: giá sau CK, bỏ thuế nếu giá gồm thuế (#42 K3; Odoo _get_stock_move_price_unit: compute_all(price_unit)['total_excluded'])
  const unitCostOf = (l) => { const pu = l.price * (1 - (l.discount_pct || 0) / 100); return Math.round(TAX.inclOf(l) ? pu / (1 + (Number(l.vat_pct) || 0) / 100) : pu); };
  const keepLine = (l) => ({ product_id: l.product_id, name: l.name, unit: l.unit, qty: l.qty, price: l.price, discount_pct: l.discount_pct, vat_pct: l.vat_pct, price_include: TAX.inclOf(l) });
  function runReorder() {
    const items = reorderPlan(); const touched = new Map(); const created = []; const updated = [];
    const save = (poId, edit) => { const po = getPurchase(poId); const lines = po.lines.map(keepLine); edit(lines, po); return savePurchase({ id: poId, lines }); };
    for (const it of items.filter(x => x.action === 'update')) {
      if (Math.abs(it.old_qty - it.qty) < EPS) continue;
      save(it.po_id, (lines, po) => { const i = po.lines.findIndex(l => l.id === it.line_id); if (i >= 0) lines[i].qty = it.qty; }); touched.set(it.po_id, true);
    }
    const byVendor = new Map(); for (const it of items.filter(x => x.action === 'create')) { if (!byVendor.has(it.partner_id)) byVendor.set(it.partner_id, []); byVendor.get(it.partner_id).push(it); }
    for (const [vid, its] of byVendor) {
      const draft = db.get("SELECT id FROM purchase_orders WHERE partner_id = ? AND state = 'draft' ORDER BY created_at LIMIT 1", [vid]);
      const add = its.map(it => ({ product_id: it.product_id, qty: it.qty }));
      const po = draft ? save(draft.id, (lines) => lines.push(...add)) : savePurchase({ partner_id: vid, lines: add, notes: 'Tạo từ “Đặt hàng bổ sung” (tồn dự báo dưới mức tối thiểu).' });
      if (draft) touched.set(po.id, true); else created.push(po.number);
      for (const it of its) { it.po_id = po.id; it.po_number = po.number; }
    }
    for (const id of touched.keys()) { const n = (db.get('SELECT number FROM purchase_orders WHERE id = ?', [id]) || {}).number; if (n && !created.includes(n)) updated.push(n); }
    return { items, created, updated, no_vendor: items.filter(x => x.action === 'no_vendor').map(x => x.name) };
  }
  const need = (id) => { const po = db.get('SELECT * FROM purchase_orders WHERE id = ?', [id]); if (!po) throw new CrmError('Không tìm thấy đơn mua.'); return po; };
  function sendRfq(id) {
    const po = need(id); if (!['draft', 'sent'].includes(po.state)) throw new CrmError('Chỉ đánh dấu “đã gửi” được với yêu cầu báo giá chưa xác nhận.');
    if (po.state === 'draft') { db.run("UPDATE purchase_orders SET state = 'sent', updated_at = ? WHERE id = ?", [now(), id]); h.hist(po.partner_id, `Yêu cầu báo giá ${po.number} đã gửi cho nhà cung cấp`); }
    return getPurchase(id);
  }
  // Xác nhận đơn (Odoo: Confirm Order): RFQ → Đơn mua hàng; tạo phiếu nhập kho cho hàng lưu kho / tiêu dùng, giá nhập = đơn giá sau chiết khấu (chưa thuế)
  function confirmPurchase(id) {
    const po = need(id);
    if (['purchase', 'done'].includes(po.state)) throw new CrmError('Đơn mua này đã được xác nhận.');
    if (po.state === 'cancel') throw new CrmError('Đơn mua đã huỷ: bấm “Đặt lại nháp” trước.');
    const lines = poLines(id, po.state).filter(l => l.qty > EPS);
    if (!lines.length) throw new CrmError('Yêu cầu báo giá chưa có dòng sản phẩm nào có số lượng.');
    const rcv = lines.filter(l => l.receivable);
    db.tx(() => {
      db.run("UPDATE purchase_orders SET state = 'purchase', confirmed_at = ?, updated_at = ? WHERE id = ?", [now(), now(), id]);
      if (rcv.length) h.insertPicking({ kind: 'in', partner_id: po.partner_id, po_id: id, origin: po.number, scheduled: isDate(po.date_planned) ? po.date_planned : today(), lines: rcv.map(l => ({ product_id: l.product_id, qty: l.qty, po_line_id: l.id, unit_cost: unitCostOf(l) })) });
    });
    h.hist(po.partner_id, `Xác nhận đơn mua hàng ${po.number}`);
    return getPurchase(id);
  }
  // #42 K1: sau khi xác nhận, đơn giá trên đơn khác bảng giá NCC (hoặc NCC chưa có trong bảng giá sản phẩm) → gợi ý cập nhật (Odoo tự thêm NCC mới vào sản phẩm khi xác nhận)
  function vendorPriceChanges(poId) {
    const po = need(poId); const out = [];
    for (const l of poLines(poId, po.state)) {
      if (!l.product_id || !(l.qty > EPS) || !(l.price > 0)) continue;
      const vp = TAX.inclOf(l) ? Math.round(l.price / (1 + (Number(l.vat_pct) || 0) / 100)) : l.price; // #42 K3: bảng giá NCC lưu giá CHƯA thuế
      const mine = db.all('SELECT * FROM vendor_prices WHERE product_id = ? AND partner_id = ?', [l.product_id, po.partner_id]);
      const s = sellerOf(l.product_id, po.partner_id, l.qty);
      if (!mine.length) out.push({ line_id: l.id, product_id: l.product_id, name: l.name, action: 'add', old_price: null, price: vp, min_qty: 0, delay: isDate(po.date_planned) ? Math.max(0, Math.min(365, daysBetween(po.date_order || today(), po.date_planned))) : 0 });
      else if (s && s.price !== vp) out.push({ line_id: l.id, product_id: l.product_id, name: l.name, action: 'update', vendor_price_id: s.id, old_price: s.price, price: vp, min_qty: s.min_qty, delay: s.delay });
    }
    return out;
  }
  function applyVendorPrices(poId, lineIds = null) {
    const po = need(poId); const want = Array.isArray(lineIds) ? new Set(lineIds) : null; const todo = vendorPriceChanges(poId).filter(c => !want || want.has(c.line_id)); const seenAdd = new Set();
    db.tx(() => { for (const c of todo) {
      if (c.action === 'update') db.run('UPDATE vendor_prices SET price = ?, updated_at = ? WHERE id = ?', [c.price, now(), c.vendor_price_id]);
      else if (!seenAdd.has(c.product_id)) { seenAdd.add(c.product_id); const seq = (db.get('SELECT COALESCE(MAX(sequence), 0) AS m FROM vendor_prices WHERE product_id = ?', [c.product_id]).m || 0) + 1;
        db.run('INSERT INTO vendor_prices(id, product_id, partner_id, min_qty, price, delay, sequence, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [newId('vp'), c.product_id, po.partner_id, 0, c.price, c.delay, seq, now(), now()]); }
    } });
    if (todo.length) h.hist(po.partner_id, `Cập nhật bảng giá nhà cung cấp theo đơn mua ${po.number}: ${todo.length} dòng`);
    return todo;
  }
  function cancelPurchase(id) {
    const po = need(id); if (po.state === 'cancel') return getPurchase(id);
    if (db.get("SELECT id FROM pickings WHERE po_id = ? AND kind = 'in' AND state = 'done' LIMIT 1", [id])) throw new CrmError('Đơn mua đã nhận hàng (phiếu nhập hoàn tất): không huỷ được. Hãy trả hàng cho nhà cung cấp nếu cần.');
    if (db.get("SELECT id FROM invoices WHERE po_id = ? AND state = 'posted' LIMIT 1", [id])) throw new CrmError('Đơn mua đã có hoá đơn nhà cung cấp vào sổ: hãy đặt lại nháp / huỷ hoá đơn đó trước.');
    db.tx(() => {
      for (const pk of db.all("SELECT id FROM pickings WHERE po_id = ? AND state IN ('draft','ready')", [id])) { db.run("UPDATE moves SET state = 'cancel' WHERE picking_id = ?", [pk.id]); db.run("UPDATE pickings SET state = 'cancel', updated_at = ? WHERE id = ?", [now(), pk.id]); }
      db.run("UPDATE invoices SET state = 'cancel', updated_at = ? WHERE po_id = ? AND state = 'draft'", [now(), id]);
      db.run("UPDATE purchase_orders SET state = 'cancel', updated_at = ? WHERE id = ?", [now(), id]);
    });
    h.hist(po.partner_id, `Huỷ ${['purchase', 'done'].includes(po.state) ? 'đơn mua hàng' : 'yêu cầu báo giá'} ${po.number}`);
    return getPurchase(id);
  }
  function resetPurchase(id) { const po = need(id); if (po.state !== 'cancel') throw new CrmError('Chỉ đặt lại nháp được với đơn mua đã huỷ.'); db.run("UPDATE purchase_orders SET state = 'draft', confirmed_at = NULL, updated_at = ? WHERE id = ?", [now(), id]); return getPurchase(id); }
  // Khoá / Mở khoá (Odoo: Lock / Unlock) — đơn đã khoá vẫn nhận hàng và nhận hoá đơn được, chỉ không sửa
  function lockPurchase(id, lock = true) { const po = need(id); if (lock && po.state !== 'purchase') throw new CrmError('Chỉ khoá được đơn mua hàng đã xác nhận.'); if (!lock && po.state !== 'done') throw new CrmError('Đơn mua này không bị khoá.'); db.run('UPDATE purchase_orders SET state = ?, updated_at = ? WHERE id = ?', [lock ? 'done' : 'purchase', now(), id]); return getPurchase(id); }
  function deletePurchase(id) {
    const po = db.get('SELECT * FROM purchase_orders WHERE id = ?', [id]); if (!po) return false;
    if (!['draft', 'sent', 'cancel'].includes(po.state)) throw new CrmError('Không xoá được đơn mua đã xác nhận — hãy huỷ đơn trước.');
    if (db.get("SELECT id FROM pickings WHERE po_id = ? AND state = 'done' LIMIT 1", [id]) || db.get("SELECT id FROM invoices WHERE po_id = ? AND (state = 'posted' OR number IS NOT NULL) LIMIT 1", [id])) throw new CrmError('Đơn mua đã có phiếu nhập hoặc hoá đơn: không xoá được, chỉ huỷ.');
    db.tx(() => { db.run('DELETE FROM moves WHERE picking_id IN (SELECT id FROM pickings WHERE po_id = ?)', [id]); db.run('DELETE FROM pickings WHERE po_id = ?', [id]); db.run("DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE po_id = ? AND state != 'posted')", [id]); db.run("DELETE FROM invoices WHERE po_id = ? AND state != 'posted'", [id]); db.run('DELETE FROM purchase_lines WHERE po_id = ?', [id]); db.run('DELETE FROM purchase_orders WHERE id = ?', [id]); });
    h.hist(po.partner_id, `Xoá yêu cầu báo giá ${po.number}`); return true;
  }
  // Tạo hoá đơn nhà cung cấp (Odoo: Create Bill) cho phần chưa lập: hàng lưu kho/tiêu dùng theo số đã nhận, dịch vụ theo số đã đặt
  function createBill(poId) {
    const po = need(poId); if (!['purchase', 'done'].includes(po.state)) throw new CrmError('Chỉ lập hoá đơn nhà cung cấp cho đơn mua đã xác nhận.');
    const lines = poLines(poId, po.state); const todo = lines.filter(l => l.qty_to_bill > EPS);
    if (!todo.length) throw new CrmError(lines.some(l => l.bill_policy === 'receive' && l.qty_received + EPS < l.qty) ? 'Chưa có hàng nào nhận mà chưa lập hoá đơn. Hàng lưu kho được lập hoá đơn theo số đã nhận — hãy xác nhận phiếu nhập kho trước.' : 'Không còn gì để lập hoá đơn cho đơn mua này.');
    const id = db.tx(() => {
      const iid = newId('inv');
      db.run('INSERT INTO invoices(id, kind, partner_id, po_id, state, invoice_date, vat_pct, notes, ref, tax_rounding, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [iid, 'in_invoice', po.partner_id, poId, 'draft', today(), po.vat_pct, '', po.partner_ref || '', TAX.roundingOf(po.tax_rounding), now(), now()]);
      h.writeLines(iid, todo.map((l, i) => ({ product_id: l.product_id, po_line_id: l.id, name: `${po.number}: ${l.name}`, unit: l.unit, qty: l.qty_to_bill, price: l.price, discount_pct: l.discount_pct, vat_pct: l.vat_pct, price_include: TAX.inclOf(l), pos: i })));
      h.refreshAmounts(iid); return iid;
    });
    h.hist(po.partner_id, `Tạo hoá đơn nhà cung cấp nháp cho đơn mua ${po.number}`);
    return h.getInvoice(id);
  }
  // ---------- Báo cáo ----------
  const monthOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const inRange = (d, from, to) => (!isDate(from) || d >= from) && (!isDate(to) || d <= to);
  // Phân tích mua hàng (Odoo: Purchase Analysis): đơn đã xác nhận, nhóm theo tháng / nhà cung cấp / sản phẩm / nhóm sản phẩm
  function purchaseReport({ groupBy = 'month', from = '', to = '' } = {}) {
    const orders = db.all("SELECT * FROM purchase_orders WHERE state IN ('purchase','done')").filter(o => inRange(o.date_order || ymd(new Date(o.confirmed_at || o.updated_at)), from, to));
    const m = new Map();
    for (const o of orders) for (const l of poLines(o.id, o.state)) {
      const pr = l.product_id ? product(l.product_id) : null; const pn = (partner(o.partner_id) || {}).name || '(không rõ)';
      const [k, label] = groupBy === 'vendor' ? [o.partner_id || '-', pn] : groupBy === 'product' ? [l.product_id || 'name:' + l.name, l.name] : groupBy === 'category' ? [(pr && pr.category) || '-', (pr && pr.category) || '(chưa phân nhóm)'] : [String(o.date_order || '').slice(0, 7) || monthOf(o.confirmed_at), String(o.date_order || '').slice(0, 7) || monthOf(o.confirmed_at)];
      const g = m.get(k) || { key: k, label, orders: new Set(), qty: 0, received: 0, billed: 0, untaxed: 0, total: 0 };
      g.orders.add(o.id); g.qty += l.qty; g.received += l.qty_received; g.billed += l.qty_billed; g.untaxed += l.amount; g.total += l.amount + l.tax; m.set(k, g);
    }
    const rows = [...m.values()].map(g => ({ ...g, orders: g.orders.size, qty: T.round3(g.qty), received: T.round3(g.received), billed: T.round3(g.billed) })).sort((a, b) => groupBy === 'month' ? a.key.localeCompare(b.key) : b.untaxed - a.untaxed);
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    return { rows, totals: { orders: orders.length, qty: T.round3(sum('qty')), received: T.round3(sum('received')), billed: T.round3(sum('billed')), untaxed: sum('untaxed'), total: sum('total') } };
  }
  // Công nợ phải trả theo tuổi nợ (Odoo: Aged Payable) + hoá đơn nhà cung cấp theo tháng
  function payablesReport({ from = '', to = '' } = {}) {
    const all = db.all("SELECT * FROM invoices WHERE state = 'posted' AND kind IN ('in_invoice','in_refund')").map(h.pubInvoice).filter(i => inRange(i.invoice_date, from, to));
    const sign = (i) => (i.kind === 'in_refund' ? -1 : 1);
    const byMonth = new Map(); for (const i of all) { const k = i.invoice_date.slice(0, 7); const g = byMonth.get(k) || { key: k, untaxed: 0, tax: 0, total: 0, count: 0 }; g.untaxed += sign(i) * i.amount_untaxed; g.tax += sign(i) * i.amount_tax; g.total += sign(i) * i.amount_total; g.count++; byMonth.set(k, g); }
    const t = today(); const aged = new Map();
    // #38: giấy báo có NCC chưa được đối trừ / chưa nhận lại tiền (vd. báo có cho hoá đơn đã trả đủ) là tiền NCC nợ lại mình → trừ vào công nợ phải trả (Odoo Aged Payable cũng vậy)
    for (const i of db.all("SELECT * FROM invoices WHERE state = 'posted' AND kind IN ('in_invoice','in_refund')").map(h.pubInvoice).filter(i => i.residual > 0)) {
      const late = isDate(i.due_date) ? daysBetween(i.due_date, t) : 0; const b = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'older';
      const amt = sign(i) * i.residual;
      const g = aged.get(i.partner_id) || { partner_id: i.partner_id, partner_name: i.partner_name, current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0, credit: 0 }; g[b] += amt; g.total += amt; if (amt < 0) g.credit -= amt; aged.set(i.partner_id, g);
    }
    const agedRows = [...aged.values()].sort((a, b) => b.total - a.total);
    const sum = (k) => all.reduce((a, i) => a + sign(i) * i[k], 0);
    // #38: “Đã trả” theo NGÀY thanh toán trong khoảng lọc (trước đây cộng mọi lần trả từ trước tới nay → lệch chứng từ khi lọc theo tháng)
    const payIn = (kind) => db.all("SELECT p.amount, p.date FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.kind = ? AND i.state = 'posted'", [kind]).filter(p => inRange(p.date || '', from, to)).reduce((a, p) => a + p.amount, 0);
    return { byMonth: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)), totals: { untaxed: sum('amount_untaxed'), tax: sum('amount_tax'), total: sum('amount_total'), paid: payIn('in_invoice'), refunded: payIn('in_refund') },
      aged: agedRows, agedTotals: ['current', 'd30', 'd60', 'd90', 'older', 'total', 'credit'].reduce((o, k) => (o[k] = agedRows.reduce((a, r) => a + r[k], 0), o), {}) };
  }
  function purchaseOverview() {
    const orders = listPurchases({ kind: 'orders' });
    return { rfqOpen: db.get("SELECT count(*) AS n FROM purchase_orders WHERE state IN ('draft','sent')").n, poToReceive: orders.filter(o => ['pending', 'partial'].includes(o.receipt_status)).length, poToBill: orders.filter(o => o.invoice_status === 'to_invoice').length };
  }
  return { PO_STATE, RECEIPT_STATUS, BILL_STATUS, reorderPlan, runReorder, listVendorPrices, saveVendorPrices, deleteVendorPrice, vendorPrice, vendorPriceChanges, applyVendorPrices, listPurchases, getPurchase, savePurchase, sendRfq, confirmPurchase, cancelPurchase, resetPurchase, lockPurchase, deletePurchase, createBill, purchaseReport, payablesReport, purchaseOverview };
}
const PURCHASE_CALLS = ['listPurchases', 'getPurchase', 'savePurchase', 'sendRfq', 'confirmPurchase', 'cancelPurchase', 'resetPurchase', 'lockPurchase', 'deletePurchase', 'createBill', 'purchaseReport', 'payablesReport',
  'listVendorPrices', 'saveVendorPrices', 'deleteVendorPrice', 'vendorPrice', 'vendorPriceChanges', 'applyVendorPrices', 'reorderPlan', 'runReorder' /* #42 K2 */]; // #42 K1
module.exports = { createPurchase, PURCHASE_CALLS, PO_STATE };
