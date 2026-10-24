// Bộ Kinh doanh 0.16 (theo cách làm của Odoo): Bán hàng (báo giá → đơn bán → giao hàng → hoá đơn), Kho (nhập/xuất/điều chỉnh,
// tồn thực tế/dự báo, giá vốn bình quân), Hoá đơn khách hàng (nháp → vào sổ → thanh toán, giấy báo có), Báo cáo.
// Dùng chung CSDL SQLite với CRM (src/crm/db.js), lưu trên máy, không gửi đi đâu. Tiền: số nguyên VND.
const crypto = require('crypto');
const T = require('./text');
const { CrmError } = require('./crm');

const PICK_KIND = { in: 'Nhập kho', out: 'Giao hàng', adj: 'Điều chỉnh tồn' };
const PICK_STATE = { draft: 'Nháp', ready: 'Sẵn sàng', done: 'Hoàn tất', cancel: 'Đã huỷ' };
const INV_STATE = { draft: 'Nháp', posted: 'Đã vào sổ', cancel: 'Đã huỷ' };
const PAY_STATE = { not_paid: 'Chưa thanh toán', partial: 'Thanh toán một phần', paid: 'Đã thanh toán', reversed: 'Đã đảo' };
const INV_KIND = { out_invoice: 'Hoá đơn', out_refund: 'Giấy báo có' };
const PAY_METHOD = { bank: 'Chuyển khoản', cash: 'Tiền mặt' };
const PROD_TYPE = { product: 'Hàng lưu kho', consu: 'Hàng tiêu dùng', service: 'Dịch vụ' };
const SO_STATE = { draft: 'Báo giá', sent: 'Báo giá đã gửi', sale: 'Đơn bán hàng', cancel: 'Đã huỷ' };
const INVOICE_STATUS = { no: 'Không có gì để lập hoá đơn', to_invoice: 'Chờ lập hoá đơn', invoiced: 'Đã lập hoá đơn đủ' };
const DELIVERY_STATUS = { none: 'Không cần giao', pending: 'Chưa giao', partial: 'Giao một phần', full: 'Đã giao đủ' };

const newId = (p) => p + '_' + crypto.randomBytes(6).toString('hex');
const str = (v, max = 500) => (v == null ? '' : String(v)).trim().slice(0, max);
const num = (v) => { const n = T.parseQty(v); return Number.isFinite(n) ? n : 0; }; // B50: “1.000” = 1000, làm tròn 3 chữ số
// Ngày chứng từ là lịch dân sự, không qua múi giờ máy (new Date('YYYY-MM-DD') lệch một ngày ở UTC−).
// Mốc thời gian (lúc xác nhận đơn) quy về giờ Việt Nam UTC+7, không giờ mùa — R3-K1 trước đây chỉ đúng khi máy đang ở UTC+7.
const VN_MS = 7 * 60 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const parseCivil = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const formatCivil = (utcMs) => { const d = new Date(utcMs); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
const addDays = (s, n) => formatCivil(parseCivil(s) + n * 86400000);
const daysBetween = (a, b) => { const x = parseCivil(a), y = parseCivil(b); return x == null || y == null ? NaN : Math.round((y - x) / 86400000); };
const civilOf = (ms) => formatCivil(Number(ms) + VN_MS);
const monthOf = (ms) => civilOf(ms).slice(0, 7);
function ageBucket(due, t) {
  const late = isDate(due) ? daysBetween(due, t) : 0;
  if (!(late > 0)) return 'current';
  if (late <= 30) return 'd30';
  if (late <= 60) return 'd60';
  if (late <= 90) return 'd90';
  return 'older';
}
// Giấy báo có còn dư (chưa gạch trên sổ với hoá đơn gốc) được đối trừ vào hoá đơn mở của cùng khách, cũ nhất trước.
// Phần không đối trừ hết nằm ở credit — nhóm tuổi và “Còn phải thu” không âm.
function agedReceivable(open, t) {
  const partners = new Map();
  for (const i of open) {
    let g = partners.get(i.partner_id);
    if (!g) { g = { partner_id: i.partner_id, partner_name: i.partner_name, inv: [], cr: [] }; partners.set(i.partner_id, g); }
    (i.kind === 'out_refund' ? g.cr : g.inv).push(i);
  }
  const ord = (a, b) => {
    const ka = `${a.due_date || a.invoice_date || '9999-12-31'}\0${a.invoice_date || ''}\0${a.id}`;
    const kb = `${b.due_date || b.invoice_date || '9999-12-31'}\0${b.invoice_date || ''}\0${b.id}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  const rows = []; const remain = new Map(); let overdueN = 0, overdueSum = 0;
  for (const g of partners.values()) {
    g.inv.sort(ord);
    const left = g.inv.map(i => i.residual);
    let unapplied = 0;
    for (const c of g.cr) {
      let rem = c.residual;
      for (let k = 0; k < left.length && rem > 0; k++) { const use = Math.min(rem, left[k]); left[k] -= use; rem -= use; }
      unapplied += rem;
    }
    const row = { partner_id: g.partner_id, partner_name: g.partner_name, current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0, credit: unapplied };
    g.inv.forEach((i, k) => {
      remain.set(i.id, left[k]);
      if (!(left[k] > 0)) return;
      const b = ageBucket(i.due_date, t); row[b] += left[k]; row.total += left[k];
      if (i.kind === 'out_invoice' && isDate(i.due_date) && i.due_date < t) { overdueN += 1; overdueSum += left[k]; }
    });
    if (row.total > 0 || row.credit > 0) rows.push(row);
  }
  rows.sort((a, b) => b.total - a.total || String(a.partner_name).localeCompare(String(b.partner_name), 'vi'));
  const totals = {};
  for (const k of ['current', 'd30', 'd60', 'd90', 'older', 'total', 'credit']) totals[k] = rows.reduce((a, r) => a + r[k], 0);
  totals.overdue = overdueSum;
  return { rows, totals, overdueN, remain };
}
const lineAmount = (l) => Math.round(num(l.qty) * num(l.price) * (1 - num(l.discount_pct) / 100));
const EPS = 1e-9;
// B52 (QA lượt 6): thuế suất không hợp lệ (vd. 7%) → báo lỗi, không tự đổi thành 10%
const vatOf = (x) => { if (x === undefined || x === null || x === '') return 10; const n = Number(String(x).replace('%', '').trim()); if (![0, 5, 8, 10].includes(n)) throw new CrmError(`Thuế suất GTGT “${x}” không hợp lệ — chỉ nhận 0%, 5%, 8% hoặc 10%.`); return n; };

function createBiz({ db, crm, now = () => Date.now(), today = () => civilOf(Date.now()), log = () => {} }) {
  const hist = (partnerId, text) => { if (partnerId) db.run('INSERT INTO history(id, contact_id, lead_id, kind, text, at) VALUES (?,?,?,?,?,?)', [newId('h'), partnerId, null, 'biz', str(text, 2000), now()]); };
  const year = () => today().slice(0, 4);
  // số chứng từ theo Odoo: WH/OUT/00001, INV/2026/00001, RINV/2026/00001, PAY/2026/00001
  function seq(table, prefix) {
    const r = db.get(`SELECT number FROM ${table} WHERE number LIKE ? ORDER BY number DESC LIMIT 1`, [prefix + '%']);
    const n = r ? (parseInt(String(r.number).slice(prefix.length), 10) || 0) + 1 : 1;
    return prefix + String(n).padStart(5, '0');
  }
  const product = (id) => db.get('SELECT * FROM products WHERE id = ?', [id]);
  const partner = (id) => id ? db.get('SELECT id, name, kind, phone, email, address, tax_id, company_id FROM contacts WHERE id = ?', [id]) : null;
  const needPartner = (id) => { const p = partner(id); if (!p) throw new CrmError('Hãy chọn khách hàng / đối tác.'); return p; };

  // ---------- Kho ----------
  const MOVE_SIGN = "CASE kind WHEN 'in' THEN qty_done WHEN 'out' THEN -qty_done ELSE qty_done END";
  const onHand = (pid) => T.round3(db.get(`SELECT COALESCE(SUM(${MOVE_SIGN}), 0) AS q FROM moves WHERE product_id = ? AND state = 'done'`, [pid]).q);
  const incoming = (pid) => db.get("SELECT COALESCE(SUM(qty), 0) AS q FROM moves WHERE product_id = ? AND kind = 'in' AND state IN ('draft','ready')", [pid]).q;
  const outgoing = (pid) => db.get("SELECT COALESCE(SUM(qty), 0) AS q FROM moves WHERE product_id = ? AND kind = 'out' AND state IN ('draft','ready')", [pid]).q;
  function stockOf(pid) { const h = onHand(pid), i = incoming(pid), o = outgoing(pid); return { on_hand: h, incoming: i, outgoing: o, forecast: h + i - o }; }

  function listStock({ q = '', filter = 'all' } = {}) {
    const where = ["active = 1", "type = 'product'"], p = [];
    if (q) { where.push('(lower(name) LIKE ? OR lower(sku) LIKE ? OR barcode = ?)'); p.push('%' + q.toLowerCase() + '%', '%' + q.toLowerCase() + '%', q.trim()); }
    let rows = db.all(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name`, p).map(x => { const s = stockOf(x.id); return { ...x, ...s, value: Math.round(s.on_hand * (x.cost || 0)), below_min: x.min_qty > 0 && s.forecast < x.min_qty }; });
    if (filter === 'low') rows = rows.filter(r => r.below_min); else if (filter === 'negative') rows = rows.filter(r => r.on_hand < -EPS); else if (filter === 'available') rows = rows.filter(r => r.on_hand > EPS);
    return { rows, totalValue: rows.reduce((a, r) => a + r.value, 0) };
  }

  const pubPicking = (pk) => pk && ({ ...pk, kind_vi: PICK_KIND[pk.kind], state_vi: PICK_STATE[pk.state], partner_name: (partner(pk.partner_id) || {}).name || '', so_number: pk.so_id ? (db.get('SELECT number FROM quotes WHERE id = ?', [pk.so_id]) || {}).number || '' : '' });
  function cleanMoveLines(lines, kind) {
    if (!Array.isArray(lines)) throw new CrmError('Phiếu kho cần ít nhất một dòng sản phẩm.');
    const out = [];
    for (const l of lines) {
      const pr = product(l.product_id); if (!pr || !pr.active) throw new CrmError('Dòng phiếu kho có sản phẩm không tồn tại hoặc đã lưu trữ.');
      if (pr.type !== 'product' && kind === 'in') throw new CrmError(`“${pr.name}” không phải hàng lưu kho (loại: ${PROD_TYPE[pr.type]}) nên không nhập kho.`);
      const qty = num(l.qty); if (!(qty > 0)) throw new CrmError(`Số lượng của “${pr.name}” phải lớn hơn 0.`);
      out.push({ product_id: pr.id, qty, unit_cost: kind === 'in' ? Math.max(0, T.parseVnd(l.unit_cost ?? pr.cost)) : pr.cost || 0, so_line_id: l.so_line_id || null });
    }
    if (!out.length) throw new CrmError('Phiếu kho cần ít nhất một dòng sản phẩm.');
    return out;
  }
  function insertPicking({ kind, partner_id = null, so_id = null, origin = '', scheduled = null, notes = '', backorder_of = null, state = 'ready', lines }) {
    const id = newId('pk'); const number = seq('pickings', `WH/${kind === 'in' ? 'IN' : kind === 'out' ? 'OUT' : 'ADJ'}/`);
    db.run('INSERT INTO pickings(id, number, kind, partner_id, so_id, origin, backorder_of, state, scheduled, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, number, kind, partner_id, so_id, str(origin, 120), backorder_of, state, isDate(scheduled) ? scheduled : today(), str(notes, 2000), now(), now()]);
    for (const l of lines) db.run('INSERT INTO moves(id, picking_id, product_id, so_line_id, kind, qty, qty_done, unit_cost, state, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [newId('mv'), id, l.product_id, l.so_line_id || null, kind, l.qty, 0, l.unit_cost || 0, state, now()]);
    return id;
  }
  // phiếu nhập kho (Odoo: Receipt) — sẵn sàng ngay, bấm “Xác nhận” để cộng tồn
  function createReceipt({ partner_id = null, lines, scheduled, notes, origin } = {}) {
    if (partner_id && !partner(partner_id)) partner_id = null;
    const id = db.tx(() => insertPicking({ kind: 'in', partner_id, origin, scheduled, notes, lines: cleanMoveLines(lines, 'in') }));
    return getPicking(id);
  }
  function getPicking(id) {
    const pk = pubPicking(db.get('SELECT * FROM pickings WHERE id = ?', [id])); if (!pk) throw new CrmError('Không tìm thấy phiếu kho.');
    pk.moves = db.all('SELECT m.*, p.name AS product_name, p.unit, p.sku, p.type AS product_type FROM moves m LEFT JOIN products p ON p.id = m.product_id WHERE m.picking_id = ? ORDER BY m.created_at, m.id', [id])
      .map(m => ({ ...m, on_hand: onHand(m.product_id) }));
    pk.backorders = db.all('SELECT id, number, state FROM pickings WHERE backorder_of = ?', [id]);
    return pk;
  }
  function listPickings({ kind = '', state = '', q = '', soId = '' } = {}) {
    const where = [], p = [];
    if (kind) { where.push('k.kind = ?'); p.push(kind); }
    if (state === 'open') where.push("k.state IN ('draft','ready')"); else if (state) { where.push('k.state = ?'); p.push(state); }
    if (soId) { where.push('k.so_id = ?'); p.push(soId); }
    if (q) { where.push('(lower(k.number) LIKE ? OR lower(k.origin) LIKE ? OR c.name_norm LIKE ?)'); p.push('%' + q.toLowerCase() + '%', '%' + q.toLowerCase() + '%', '%' + T.fold(q) + '%'); }
    return db.all(`SELECT k.* FROM pickings k LEFT JOIN contacts c ON c.id = k.partner_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE k.state WHEN 'ready' THEN 0 WHEN 'draft' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, k.scheduled, k.number`, p).map(pubPicking);
  }
  // ghi số lượng đã làm từng dòng (trước khi xác nhận)
  function setDone(pickingId, done = {}) {
    const pk = db.get('SELECT * FROM pickings WHERE id = ?', [pickingId]); if (!pk) throw new CrmError('Không tìm thấy phiếu kho.');
    if (!['draft', 'ready'].includes(pk.state)) throw new CrmError('Phiếu đã hoàn tất hoặc đã huỷ: không sửa được.');
    db.tx(() => { for (const [mid, v] of Object.entries(done || {})) { const q = T.parseQty(v); if (!Number.isFinite(q) || q < 0) throw new CrmError('Số lượng đã làm phải là số ≥ 0.'); db.run('UPDATE moves SET qty_done = ? WHERE id = ? AND picking_id = ?', [q, mid, pickingId]); } });
    return getPicking(pickingId);
  }
  // Xác nhận phiếu (Odoo: Validate). Không ghi số lượng đã làm → làm đủ như yêu cầu. Làm thiếu → phiếu chờ phần còn lại (backorder) nếu backorder=true.
  // Giao vượt tồn kho → chặn, trừ khi force=true (người dùng đã đồng ý cho tồn âm).
  function validatePicking(id, { backorder = true, force = false } = {}) {
    const pk = db.get('SELECT * FROM pickings WHERE id = ?', [id]); if (!pk) throw new CrmError('Không tìm thấy phiếu kho.');
    if (pk.state === 'done') throw new CrmError('Phiếu này đã hoàn tất.');
    if (pk.state === 'cancel') throw new CrmError('Phiếu đã huỷ.');
    const moves = db.all('SELECT * FROM moves WHERE picking_id = ?', [id]);
    if (!moves.length) throw new CrmError('Phiếu không có dòng nào.');
    const anyDone = moves.some(m => m.qty_done > EPS);
    const plan = moves.map(m => ({ m, done: pk.kind === 'adj' ? m.qty_done : anyDone ? Math.max(0, m.qty_done) : m.qty }));
    if (pk.kind !== 'adj' && !plan.some(x => x.done > EPS)) throw new CrmError('Chưa có số lượng nào được làm.');
    if (pk.kind === 'out' && !force) {
      // B54: giao VƯỢT số đặt → hỏi lại (Odoo cảnh báo), không im lặng đánh dấu “Đã giao đủ”
      const over = plan.filter(x => x.m.so_line_id && x.done > x.m.qty + EPS).map(x => `“${(product(x.m.product_id) || {}).name || ''}”: giao ${fmtQ(x.done)}, đơn cần ${fmtQ(x.m.qty)}`);
      if (over.length) { const e = new CrmError('Giao nhiều hơn số lượng trên đơn — ' + over.join('; ') + '. Sửa số lượng đã làm, hoặc xác nhận vẫn giao vượt.'); e.code = 'over'; throw e; }
      const short = [];
      const need = new Map(); for (const x of plan) { const pr = product(x.m.product_id); if (pr && pr.type === 'product') need.set(pr.id, (need.get(pr.id) || 0) + x.done); }
      for (const [pid, q] of need) { const h = onHand(pid); if (h + EPS < q) short.push(`“${product(pid).name}”: cần ${fmtQ(q)}, còn ${fmtQ(h)}`); }
      if (short.length) { const e = new CrmError('Không đủ hàng trong kho — ' + short.join('; ') + '. Nhập kho thêm, giảm số lượng giao, hoặc xác nhận vẫn giao (tồn kho sẽ âm).'); e.code = 'short'; throw e; }
    }
    let boId = null;
    db.tx(() => {
      const rest = [];
      for (const { m, done } of plan) {
        if (pk.kind === 'in' && done > EPS) { // giá vốn bình quân (AVCO)
          const pr = product(m.product_id); const h = Math.max(0, onHand(m.product_id));
          const cost = h + done > EPS ? Math.round(((pr.cost || 0) * h + (m.unit_cost || 0) * done) / (h + done)) : m.unit_cost || 0;
          db.run('UPDATE products SET cost = ?, updated_at = ? WHERE id = ?', [cost, now(), m.product_id]);
        }
        if (pk.kind !== 'adj' && done + EPS < m.qty) rest.push({ product_id: m.product_id, qty: +(m.qty - done).toFixed(6), unit_cost: m.unit_cost, so_line_id: m.so_line_id });
        if (done > EPS || pk.kind === 'adj') db.run("UPDATE moves SET qty_done = ?, qty = ?, state = 'done', done_at = ? WHERE id = ?", [done, pk.kind === 'adj' ? m.qty : done, now(), m.id]);
        else db.run("UPDATE moves SET state = 'cancel' WHERE id = ?", [m.id]);
      }
      db.run("UPDATE pickings SET state = 'done', done_at = ?, updated_at = ? WHERE id = ?", [now(), now(), id]);
      if (rest.length && backorder) boId = insertPicking({ kind: pk.kind, partner_id: pk.partner_id, so_id: pk.so_id, origin: pk.origin, notes: pk.notes, backorder_of: id, lines: rest });
    });
    const fresh = getPicking(id);
    hist(pk.partner_id, `${PICK_KIND[pk.kind]} ${fresh.number} hoàn tất${boId ? ' (còn phiếu chờ ' + getPicking(boId).number + ')' : ''}`);
    return { ...fresh, backorder_id: boId };
  }
  function cancelPicking(id) {
    const pk = db.get('SELECT * FROM pickings WHERE id = ?', [id]); if (!pk) throw new CrmError('Không tìm thấy phiếu kho.');
    if (pk.state === 'done') throw new CrmError('Phiếu đã hoàn tất: không huỷ được.');
    db.tx(() => { db.run("UPDATE moves SET state = 'cancel' WHERE picking_id = ?", [id]); db.run("UPDATE pickings SET state = 'cancel', updated_at = ? WHERE id = ?", [now(), id]); });
    return getPicking(id);
  }
  // Kiểm kê (Odoo: Physical Inventory): đặt tồn thực tế = số đếm được → tạo dịch chuyển điều chỉnh phần chênh lệch
  function adjustStock(productId, counted, note = '') {
    const pr = product(productId); if (!pr) throw new CrmError('Không tìm thấy sản phẩm.');
    if (pr.type !== 'product') throw new CrmError(`“${pr.name}” không phải hàng lưu kho nên không kiểm kê.`);
    const c = T.parseQty(counted); if (!Number.isFinite(c) || c < 0) throw new CrmError('Số lượng đếm được phải là số ≥ 0.'); // B51: “abc” không còn bị hiểu là 0
    const diff = T.round3(c - onHand(productId)); if (Math.abs(diff) < EPS) return { changed: false, on_hand: c };
    const id = db.tx(() => { const pid = insertPicking({ kind: 'adj', origin: str(note, 120) || 'Kiểm kê', state: 'ready', lines: [{ product_id: productId, qty: diff, unit_cost: pr.cost }] }); db.run('UPDATE moves SET qty_done = ? WHERE picking_id = ?', [diff, pid]); return pid; });
    validatePicking(id);
    return { changed: true, on_hand: onHand(productId), diff, picking_id: id };
  }
  const fmtQ = (q) => (Math.round(q * 1000) / 1000).toLocaleString('vi-VN');

  // ---------- Bán hàng ----------
  const qtyDelivered = (lineId) => db.get(`SELECT COALESCE(SUM(qty_done), 0) AS q FROM moves WHERE so_line_id = ? AND kind = 'out' AND state = 'done'`, [lineId]).q;
  const qtyInvoiced = (lineId) => db.get(`SELECT COALESCE(SUM(CASE i.kind WHEN 'out_refund' THEN -l.qty ELSE l.qty END), 0) AS q FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.so_line_id = ? AND i.state != 'cancel'`, [lineId]).q;
  function orderLines(soId) {
    return db.all('SELECT l.*, p.type AS product_type FROM quote_lines l LEFT JOIN products p ON p.id = l.product_id WHERE l.quote_id = ? ORDER BY l.pos', [soId])
      .map(l => { const d = qtyDelivered(l.id), i = qtyInvoiced(l.id); return { ...l, amount: lineAmount(l), qty_delivered: d, qty_invoiced: i, qty_to_invoice: Math.max(0, +(l.qty - i).toFixed(6)), deliverable: !!l.product_id && ['product', 'consu'].includes(l.product_type) }; });
  }
  function orderStatus(so, lines) {
    if (so.status !== 'sale') return { invoice_status: 'no', delivery_status: 'none' };
    const del = lines.filter(l => l.deliverable && l.qty > EPS);
    const delivery_status = !del.length ? 'none' : del.every(l => l.qty_delivered + EPS >= l.qty) ? 'full' : del.some(l => l.qty_delivered > EPS) ? 'partial' : 'pending';
    const invoice_status = lines.some(l => l.qty_to_invoice > EPS) ? 'to_invoice' : lines.some(l => l.qty_invoiced > EPS) ? 'invoiced' : 'no';
    return { invoice_status, delivery_status };
  }
  function getOrder(id) {
    const q = crm.getQuote(id); const lines = orderLines(id); const st = orderStatus(q, lines);
    const pickings = listPickings({ soId: id }); const invoices = db.all('SELECT * FROM invoices WHERE so_id = ? ORDER BY created_at', [id]).map(pubInvoice);
    return { ...q, lines, state_vi: SO_STATE[q.status], ...st, invoice_status_vi: INVOICE_STATUS[st.invoice_status], delivery_status_vi: DELIVERY_STATUS[st.delivery_status], pickings, invoices };
  }
  function listOrders({ q = '', kind = '', invoiceStatus = '', partnerId = '' } = {}) {
    const where = [], p = [];
    if (kind === 'quotes') where.push("q.status IN ('draft','sent')"); else if (kind === 'orders') where.push("q.status = 'sale'"); else if (kind === 'cancel') where.push("q.status = 'cancel'");
    if (partnerId) { where.push('q.contact_id = ?'); p.push(partnerId); }
    if (q) { where.push('(lower(q.number) LIKE ? OR c.name_norm LIKE ?)'); p.push('%' + q.toLowerCase() + '%', '%' + T.fold(q) + '%'); }
    let rows = db.all(`SELECT q.*, c.name AS contact_name FROM quotes q LEFT JOIN contacts c ON c.id = q.contact_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.created_at DESC`, p)
      .map(x => { const lines = orderLines(x.id); const sub = lines.reduce((a, l) => a + l.amount, 0); const vat = Math.round(sub * (x.vat_pct || 0) / 100); const st = orderStatus(x, lines);
        return { ...x, subtotal: sub, vat, total: sub + vat, state_vi: SO_STATE[x.status], ...st, invoice_status_vi: INVOICE_STATUS[st.invoice_status], delivery_status_vi: DELIVERY_STATUS[st.delivery_status] }; });
    if (invoiceStatus) rows = rows.filter(r => r.invoice_status === invoiceStatus);
    return rows;
  }
  function sendQuote(id) {
    const so = db.get('SELECT * FROM quotes WHERE id = ?', [id]); if (!so) throw new CrmError('Không tìm thấy báo giá.');
    if (so.status !== 'draft' && so.status !== 'sent') throw new CrmError('Chỉ đánh dấu “đã gửi” được với báo giá chưa xác nhận.');
    if (so.status === 'draft') { db.run("UPDATE quotes SET status = 'sent', updated_at = ? WHERE id = ?", [now(), id]); hist(so.contact_id, `Báo giá ${so.number} đã gửi cho khách`); }
    return getOrder(id);
  }
  // Xác nhận (Odoo: Confirm): báo giá → đơn bán hàng; tạo phiếu giao hàng cho hàng lưu kho/tiêu dùng; cơ hội liên kết chuyển sang Thắng
  function confirmOrder(id) {
    const so = db.get('SELECT * FROM quotes WHERE id = ?', [id]); if (!so) throw new CrmError('Không tìm thấy báo giá.');
    if (so.status === 'sale') throw new CrmError('Đơn này đã được xác nhận.');
    if (so.status === 'cancel') throw new CrmError('Đơn đã huỷ: bấm “Đặt lại báo giá” trước.');
    const lines = orderLines(id).filter(l => l.qty > EPS);
    if (!lines.length) throw new CrmError('Báo giá chưa có dòng sản phẩm nào có số lượng.');
    const del = lines.filter(l => l.deliverable);
    db.tx(() => {
      db.run("UPDATE quotes SET status = 'sale', confirmed_at = ?, updated_at = ? WHERE id = ?", [now(), now(), id]);
      if (del.length) insertPicking({ kind: 'out', partner_id: so.contact_id, so_id: id, origin: so.number, scheduled: isDate(so.commitment_date) ? so.commitment_date : today(), lines: del.map(l => ({ product_id: l.product_id, qty: l.qty, so_line_id: l.id, unit_cost: (product(l.product_id) || {}).cost || 0 })) });
    });
    hist(so.contact_id, `Xác nhận đơn bán hàng ${so.number}`);
    if (so.lead_id) { const l = db.get('SELECT stage FROM leads WHERE id = ?', [so.lead_id]); if (l && l.stage !== 'won') { try { crm.moveLead(so.lead_id, 'won'); } catch (e) { log('Không chuyển cơ hội sang Thắng: ' + e.message); } } }
    return getOrder(id);
  }
  function cancelOrder(id) {
    const so = db.get('SELECT * FROM quotes WHERE id = ?', [id]); if (!so) throw new CrmError('Không tìm thấy đơn.');
    if (so.status === 'cancel') return getOrder(id);
    if (db.get("SELECT id FROM invoices WHERE so_id = ? AND state = 'posted' LIMIT 1", [id])) throw new CrmError('Đơn đã có hoá đơn vào sổ: hãy tạo giấy báo có / huỷ hoá đơn trước khi huỷ đơn.');
    if (db.get("SELECT id FROM pickings WHERE so_id = ? AND kind = 'out' AND state = 'done' LIMIT 1", [id])) throw new CrmError('Đơn đã giao hàng (phiếu xuất hoàn tất): không huỷ được.');
    db.tx(() => {
      for (const pk of db.all("SELECT id FROM pickings WHERE so_id = ? AND state IN ('draft','ready')", [id])) { db.run("UPDATE moves SET state = 'cancel' WHERE picking_id = ?", [pk.id]); db.run("UPDATE pickings SET state = 'cancel', updated_at = ? WHERE id = ?", [now(), pk.id]); }
      db.run("UPDATE invoices SET state = 'cancel', updated_at = ? WHERE so_id = ? AND state = 'draft'", [now(), id]);
      db.run("UPDATE quotes SET status = 'cancel', updated_at = ? WHERE id = ?", [now(), id]);
    });
    hist(so.contact_id, `Huỷ ${so.status === 'sale' ? 'đơn bán hàng' : 'báo giá'} ${so.number}`);
    return getOrder(id);
  }
  function resetToQuote(id) {
    const so = db.get('SELECT * FROM quotes WHERE id = ?', [id]); if (!so) throw new CrmError('Không tìm thấy đơn.');
    if (so.status !== 'cancel') throw new CrmError('Chỉ đặt lại báo giá được với đơn đã huỷ.');
    db.run("UPDATE quotes SET status = 'draft', confirmed_at = NULL, updated_at = ? WHERE id = ?", [now(), id]);
    return getOrder(id);
  }

  // ---------- Hoá đơn ----------
  function amounts(invId) {
    const inv = db.get('SELECT * FROM invoices WHERE id = ?', [invId]);
    const lines = db.all('SELECT * FROM invoice_lines WHERE invoice_id = ?', [invId]);
    const un = lines.reduce((a, l) => a + lineAmount(l), 0); const tax = Math.round(un * (inv.vat_pct || 0) / 100);
    return { amount_untaxed: un, amount_tax: tax, amount_total: un + tax };
  }
  const refundsOf = (invId) => db.all("SELECT * FROM invoices WHERE reversed_id = ? AND kind = 'out_refund' AND state = 'posted'", [invId]);
  function pubInvoice(inv) {
    if (!inv) return inv;
    const residual = inv.state === 'posted' ? Math.max(0, inv.amount_total - inv.amount_paid) : inv.amount_total;
    let ps = inv.state !== 'posted' ? 'not_paid' : residual <= 0 && inv.amount_total > 0 ? 'paid' : inv.amount_paid > 0 ? 'partial' : 'not_paid';
    if (inv.kind === 'out_invoice' && inv.state === 'posted' && residual <= 0) { const cr = refundsOf(inv.id).reduce((a, r) => a + r.amount_total, 0); if (cr >= inv.amount_total) ps = 'reversed'; }
    const overdue = inv.kind === 'out_invoice' && inv.state === 'posted' && residual > 0 && isDate(inv.due_date) && inv.due_date < today();
    return { ...inv, residual, payment_state: ps, payment_state_vi: PAY_STATE[ps], state_vi: INV_STATE[inv.state], kind_vi: INV_KIND[inv.kind], overdue, partner_name: (partner(inv.partner_id) || {}).name || '', display_number: inv.number || 'Nháp' };
  }
  function cleanInvLines(lines) {
    if (!Array.isArray(lines)) return null;
    return lines.map((l, i) => { const pr = l.product_id ? product(l.product_id) : null; return { product_id: pr ? pr.id : null, so_line_id: l.so_line_id || null, name: str(l.name || (pr && pr.name), 300), unit: str(l.unit || (pr && pr.unit), 30) || 'cái', qty: num(l.qty), price: Math.max(0, T.parseVnd(l.price ?? (pr && pr.price))), discount_pct: Math.max(0, Math.min(100, num(l.discount_pct))), pos: i }; })
      .filter(l => l.name && Math.abs(l.qty) > EPS);
  }
  function writeLines(invId, lines) { db.run('DELETE FROM invoice_lines WHERE invoice_id = ?', [invId]); for (const l of lines) db.run('INSERT INTO invoice_lines(id, invoice_id, so_line_id, product_id, name, unit, qty, price, discount_pct, pos) VALUES (?,?,?,?,?,?,?,?,?,?)', [newId('il'), invId, l.so_line_id, l.product_id, l.name, l.unit, l.qty, l.price, l.discount_pct, l.pos]); }
  function refreshAmounts(invId) { const a = amounts(invId); db.run('UPDATE invoices SET amount_untaxed = ?, amount_tax = ?, amount_total = ?, updated_at = ? WHERE id = ?', [a.amount_untaxed, a.amount_tax, a.amount_total, now(), invId]); }
  // hoá đơn nhập tay hoặc sửa hoá đơn nháp
  function saveInvoice(input = {}) {
    const old = input.id ? db.get('SELECT * FROM invoices WHERE id = ?', [input.id]) : null;
    if (input.id && !old) throw new CrmError('Không tìm thấy hoá đơn.');
    if (old && old.state !== 'draft') throw new CrmError('Chỉ sửa được hoá đơn nháp. Hoá đơn đã vào sổ: bấm “Đặt lại nháp” (khi chưa có thanh toán).');
    const v = { ...(old || {}), ...Object.fromEntries(Object.entries(input).filter(([k, x]) => x !== undefined && k !== 'lines')) };
    needPartner(v.partner_id);
    v.vat_pct = vatOf(v.vat_pct);
    v.invoice_date = isDate(v.invoice_date) ? v.invoice_date : null; v.due_date = isDate(v.due_date) ? v.due_date : null; v.notes = str(v.notes, 3000);
    const lines = cleanInvLines(input.lines);
    const id = db.tx(() => {
      if (old) db.run('UPDATE invoices SET partner_id=?, vat_pct=?, invoice_date=?, due_date=?, notes=?, updated_at=? WHERE id=?', [v.partner_id, v.vat_pct, v.invoice_date, v.due_date, v.notes, now(), old.id]);
      else { v.id = newId('inv'); db.run('INSERT INTO invoices(id, kind, partner_id, so_id, state, invoice_date, due_date, vat_pct, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [v.id, 'out_invoice', v.partner_id, null, 'draft', v.invoice_date, v.due_date, v.vat_pct, v.notes, now(), now()]); }
      if (lines) writeLines(v.id, lines);
      refreshAmounts(v.id); return v.id;
    });
    return getInvoice(id);
  }
  // Tạo hoá đơn từ đơn bán (Odoo: Create Invoice, chính sách “số lượng đặt”): lập hoá đơn cho phần chưa lập
  function invoiceOrder(soId) {
    const so = db.get('SELECT * FROM quotes WHERE id = ?', [soId]); if (!so) throw new CrmError('Không tìm thấy đơn.');
    if (so.status !== 'sale') throw new CrmError('Chỉ lập hoá đơn cho đơn bán hàng đã xác nhận.');
    const todo = orderLines(soId).filter(l => l.qty_to_invoice > EPS);
    if (!todo.length) throw new CrmError('Không còn gì để lập hoá đơn cho đơn này.');
    const id = db.tx(() => {
      const iid = newId('inv');
      db.run('INSERT INTO invoices(id, kind, partner_id, so_id, state, vat_pct, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [iid, 'out_invoice', so.contact_id, soId, 'draft', so.vat_pct, '', now(), now()]);
      writeLines(iid, todo.map((l, i) => ({ product_id: l.product_id, so_line_id: l.id, name: l.name, unit: l.unit, qty: l.qty_to_invoice, price: l.price, discount_pct: l.discount_pct, pos: i })));
      refreshAmounts(iid); return iid;
    });
    hist(so.contact_id, `Tạo hoá đơn nháp cho đơn ${so.number}`);
    return getInvoice(id);
  }
  function getInvoice(id) {
    const inv = pubInvoice(db.get('SELECT * FROM invoices WHERE id = ?', [id])); if (!inv) throw new CrmError('Không tìm thấy hoá đơn.');
    inv.lines = db.all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos', [id]).map(l => ({ ...l, amount: lineAmount(l) }));
    inv.payments = db.all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY date, created_at', [id]).map(p => ({ ...p, method_vi: PAY_METHOD[p.method] || p.method }));
    inv.partner = partner(inv.partner_id); inv.so_number = inv.so_id ? (db.get('SELECT number FROM quotes WHERE id = ?', [inv.so_id]) || {}).number || '' : '';
    inv.refunds = db.all("SELECT id, number, state, amount_total FROM invoices WHERE reversed_id = ? AND state != 'cancel'", [id]);
    inv.reversed_number = inv.reversed_id ? (db.get('SELECT number FROM invoices WHERE id = ?', [inv.reversed_id]) || {}).number || '' : '';
    inv.total_words = T.vndWords(inv.amount_total);
    return clearOffsetOverdue([inv])[0];
  }
  function listInvoices({ q = '', state = '', payment = '', kind = '', partnerId = '', soId = '' } = {}) {
    const where = [], p = [];
    if (state) { where.push('i.state = ?'); p.push(state); }
    if (kind) { where.push('i.kind = ?'); p.push(kind); }
    if (partnerId) { where.push('i.partner_id = ?'); p.push(partnerId); }
    if (soId) { where.push('i.so_id = ?'); p.push(soId); }
    if (q) { where.push('(lower(i.number) LIKE ? OR c.name_norm LIKE ? OR lower(s.number) LIKE ?)'); p.push('%' + q.toLowerCase() + '%', '%' + T.fold(q) + '%', '%' + q.toLowerCase() + '%'); }
    let rows = db.all(`SELECT i.* FROM invoices i LEFT JOIN contacts c ON c.id = i.partner_id LEFT JOIN quotes s ON s.id = i.so_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(i.invoice_date, '9999') DESC, i.created_at DESC`, p).map(pubInvoice);
    rows = clearOffsetOverdue(rows);
    if (payment === 'overdue') rows = rows.filter(r => r.kind === 'out_invoice' && r.overdue); else if (payment === 'unpaid') rows = rows.filter(r => r.state === 'posted' && r.residual > 0); else if (payment) rows = rows.filter(r => r.payment_state === payment);
    return rows;
  }
  // Vào sổ (Odoo: Confirm/Post): gán số hoá đơn, ngày hoá đơn, hạn thanh toán; giấy báo có thì trừ vào hoá đơn gốc
  function postInvoice(id) {
    const inv = db.get('SELECT * FROM invoices WHERE id = ?', [id]); if (!inv) throw new CrmError('Không tìm thấy hoá đơn.');
    if (inv.state !== 'draft') throw new CrmError('Chỉ vào sổ được hoá đơn nháp.');
    needPartner(inv.partner_id); refreshAmounts(id);
    const a = amounts(id); if (!(a.amount_total > 0)) throw new CrmError('Hoá đơn chưa có dòng nào hoặc tổng tiền bằng 0.');
    if (inv.kind === 'out_refund' && inv.reversed_id) { const orig = db.get('SELECT * FROM invoices WHERE id = ?', [inv.reversed_id]); const before = orig ? db.all("SELECT amount_total FROM invoices WHERE reversed_id = ? AND kind = 'out_refund' AND state = 'posted' AND id != ?", [orig.id, id]).reduce((x, r) => x + r.amount_total, 0) : 0;
      if (orig && before + a.amount_total > orig.amount_total) throw new CrmError(`Tổng giấy báo có (${T.fmtVnd(before + a.amount_total)}) vượt hoá đơn gốc ${orig.number} (${T.fmtVnd(orig.amount_total)}). Giảm giấy báo có này xuống tối đa ${T.fmtVnd(Math.max(0, orig.amount_total - before))}.`); }
    const date = isDate(inv.invoice_date) ? inv.invoice_date : today();
    let due = isDate(inv.due_date) ? inv.due_date : null;
    if (!due) { const so = inv.so_id ? db.get('SELECT payment_days FROM quotes WHERE id = ?', [inv.so_id]) : null; due = addDays(date, (so && so.payment_days) || 0); }
    if (due < date) throw new CrmError('Hạn thanh toán không được trước ngày hoá đơn.');
    db.tx(() => {
      const number = inv.number || seq('invoices', `${inv.kind === 'out_refund' ? 'RINV' : 'INV'}/${date.slice(0, 4)}/`);
      db.run("UPDATE invoices SET state = 'posted', number = ?, invoice_date = ?, due_date = ?, posted_at = ?, updated_at = ? WHERE id = ?", [number, date, due, now(), now(), id]);
      if (inv.kind === 'out_refund' && inv.reversed_id) { // đối trừ với hoá đơn gốc
        const orig = pubInvoice(db.get('SELECT * FROM invoices WHERE id = ?', [inv.reversed_id]));
        const credit = Math.min(orig.residual, a.amount_total);
        if (credit > 0) { db.run('UPDATE invoices SET amount_paid = amount_paid + ? WHERE id = ?', [credit, orig.id]); db.run('UPDATE invoices SET amount_paid = amount_paid + ? WHERE id = ?', [credit, id]); }
      }
    });
    const out = getInvoice(id);
    hist(inv.partner_id, `${INV_KIND[inv.kind]} ${out.number} vào sổ: ${T.fmtVnd(out.amount_total)}`);
    return out;
  }
  function resetInvoice(id) {
    const inv = pubInvoice(db.get('SELECT * FROM invoices WHERE id = ?', [id])); if (!inv) throw new CrmError('Không tìm thấy hoá đơn.');
    if (inv.state === 'draft') return getInvoice(id);
    if (db.get('SELECT id FROM payments WHERE invoice_id = ? LIMIT 1', [id])) throw new CrmError('Hoá đơn đã có thanh toán: không đặt lại nháp được.');
    if (inv.kind === 'out_invoice' && refundsOf(id).length) throw new CrmError('Hoá đơn đã có giấy báo có vào sổ: không đặt lại nháp được.');
    db.tx(() => {
      if (inv.state === 'posted' && inv.kind === 'out_refund' && inv.reversed_id && inv.amount_paid > 0) { db.run('UPDATE invoices SET amount_paid = MAX(0, amount_paid - ?) WHERE id = ?', [inv.amount_paid, inv.reversed_id]); }
      db.run("UPDATE invoices SET state = 'draft', amount_paid = 0, updated_at = ? WHERE id = ?", [now(), id]);
    });
    return getInvoice(id);
  }
  function cancelInvoice(id) {
    const inv = db.get('SELECT * FROM invoices WHERE id = ?', [id]); if (!inv) throw new CrmError('Không tìm thấy hoá đơn.');
    if (inv.state === 'posted') throw new CrmError('Hoá đơn đã vào sổ: bấm “Đặt lại nháp” trước, hoặc tạo giấy báo có.');
    db.run("UPDATE invoices SET state = 'cancel', updated_at = ? WHERE id = ?", [now(), id]);
    return getInvoice(id);
  }
  // Ghi nhận thanh toán (Odoo: Register Payment) — không cho trả vượt số còn nợ
  function registerPayment(invoiceId, { amount, date, method = 'bank', memo = '' } = {}) {
    const inv = pubInvoice(db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId])); if (!inv) throw new CrmError('Không tìm thấy hoá đơn.');
    if (inv.state !== 'posted') throw new CrmError('Chỉ ghi nhận thanh toán cho hoá đơn đã vào sổ.');
    if (inv.residual <= 0) throw new CrmError('Hoá đơn đã được thanh toán đủ.');
    const amt = amount == null || amount === '' ? inv.residual : T.parseVnd(amount);
    if (!(amt > 0)) throw new CrmError('Số tiền thanh toán phải lớn hơn 0.');
    if (amt > inv.residual) throw new CrmError(`Số tiền (${T.fmtVnd(amt)}) lớn hơn số còn phải thu (${T.fmtVnd(inv.residual)}).`);
    const d = isDate(date) ? date : today(); const m = PAY_METHOD[method] ? method : 'bank';
    db.tx(() => {
      db.run('INSERT INTO payments(id, number, invoice_id, partner_id, amount, date, method, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [newId('pay'), seq('payments', `PAY/${d.slice(0, 4)}/`), invoiceId, inv.partner_id, amt, d, m, str(memo || inv.number, 200), now()]);
      db.run('UPDATE invoices SET amount_paid = amount_paid + ?, updated_at = ? WHERE id = ?', [amt, now(), invoiceId]);
    });
    hist(inv.partner_id, `${inv.kind === 'out_refund' ? 'Hoàn tiền' : 'Thu tiền'} ${T.fmtVnd(amt)} cho ${inv.number} (${PAY_METHOD[m]})`);
    return getInvoice(invoiceId);
  }
  // Giấy báo có (Odoo: Credit Note / Reverse): bản nháp sao chép các dòng của hoá đơn gốc
  const creditedOf = (invId, exceptId = null) => db.all("SELECT id, amount_total FROM invoices WHERE reversed_id = ? AND kind = 'out_refund' AND state != 'cancel'", [invId]).filter(r => r.id !== exceptId).reduce((a, r) => a + (r.amount_total || 0), 0);
  function creditNote(invoiceId, { reason = '' } = {}) {
    const inv = db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]); if (!inv) throw new CrmError('Không tìm thấy hoá đơn.');
    if (inv.kind !== 'out_invoice' || inv.state !== 'posted') throw new CrmError('Chỉ tạo giấy báo có cho hoá đơn đã vào sổ.');
    // B53 (QA lượt 6): tổng giấy báo có không được vượt hoá đơn gốc; giấy mới mặc định = phần CHƯA bị đảo
    const credited = creditedOf(inv.id); const remain = inv.amount_total - credited;
    if (remain <= 0) throw new CrmError(`Hoá đơn ${inv.number} đã được báo có toàn bộ (${T.fmtVnd(credited)}) — không tạo thêm giấy báo có.`);
    const id = db.tx(() => {
      const rid = newId('inv');
      db.run('INSERT INTO invoices(id, kind, partner_id, so_id, reversed_id, state, vat_pct, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [rid, 'out_refund', inv.partner_id, inv.so_id, inv.id, 'draft', inv.vat_pct, str(reason ? `Đảo ${inv.number}: ${reason}` : `Đảo ${inv.number}`, 3000), now(), now()]);
      if (credited > 0) { // đã đảo một phần: một dòng bằng phần còn lại (trước thuế), không chép lại toàn bộ
        const un = Math.round(remain / (1 + (inv.vat_pct || 0) / 100));
        writeLines(rid, [{ product_id: null, so_line_id: null, name: `Phần còn lại chưa báo có của ${inv.number}`, unit: 'lần', qty: 1, price: un, discount_pct: 0, pos: 0 }]);
      } else writeLines(rid, db.all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos', [invoiceId]));
      refreshAmounts(rid); return rid;
    });
    return getInvoice(id);
  }
  function deleteInvoice(id) {
    const inv = db.get('SELECT * FROM invoices WHERE id = ?', [id]); if (!inv) return false;
    if (inv.state === 'posted' || inv.number) throw new CrmError('Hoá đơn đã từng vào sổ (đã có số): không xoá được, chỉ huỷ.');
    db.tx(() => { db.run('DELETE FROM invoice_lines WHERE invoice_id = ?', [id]); db.run('DELETE FROM invoices WHERE id = ?', [id]); });
    return true;
  }

  // ---------- Báo cáo ----------
  const inRange = (d, from, to) => (!isDate(from) || d >= from) && (!isDate(to) || d <= to);
  const openDocs = () => db.all("SELECT * FROM invoices WHERE state = 'posted' AND kind IN ('out_invoice','out_refund')").map(pubInvoice).filter(i => i.residual > 0);
  // Danh sách hoá đơn: quá hạn theo phần còn lại sau đối trừ giấy báo có. Hoá đơn bị đối trừ hết không còn cờ quá hạn.
  function clearOffsetOverdue(rows) {
    if (!rows.some(r => r && r.kind === 'out_invoice' && r.overdue)) return rows;
    const { remain } = agedReceivable(openDocs(), today());
    return rows.map(r => {
      if (!r || r.kind !== 'out_invoice' || !r.overdue) return r;
      const left = remain.has(r.id) ? remain.get(r.id) : 0;
      return left > 0 ? r : { ...r, overdue: false };
    });
  }
  // Phân tích bán hàng: đơn đã xác nhận, nhóm theo tháng / khách hàng / sản phẩm / nhóm sản phẩm / người phụ trách
  function salesReport({ groupBy = 'month', from = '', to = '' } = {}) {
    const orders = db.all("SELECT q.*, c.name AS contact_name FROM quotes q LEFT JOIN contacts c ON c.id = q.contact_id WHERE q.status = 'sale'").filter(o => inRange(civilOf(o.confirmed_at || o.updated_at), from, to));
    const m = new Map(); const add = (k, label, qty, un, tot, oid) => { const g = m.get(k) || { key: k, label, orders: new Set(), qty: 0, untaxed: 0, total: 0 }; g.orders.add(oid); g.qty += qty; g.untaxed += un; g.total += tot; m.set(k, g); };
    for (const o of orders) for (const l of db.all('SELECT l.*, p.category FROM quote_lines l LEFT JOIN products p ON p.id = l.product_id WHERE l.quote_id = ?', [o.id])) {
      const un = lineAmount(l); const tot = un + Math.round(un * (o.vat_pct || 0) / 100);
      const [k, label] = groupBy === 'customer' ? [o.contact_id || '-', o.contact_name || '(không rõ)'] : groupBy === 'product' ? [l.product_id || 'name:' + l.name, l.name] : groupBy === 'category' ? [l.category || '-', l.category || '(chưa phân nhóm)'] : groupBy === 'owner' ? [o.owner || '-', o.owner || '(chưa giao)'] : [monthOf(o.confirmed_at || o.updated_at), monthOf(o.confirmed_at || o.updated_at)];
      add(k, label, l.qty, un, tot, o.id);
    }
    const rows = [...m.values()].map(g => ({ ...g, orders: g.orders.size })).sort((a, b) => groupBy === 'month' ? a.key.localeCompare(b.key) : b.untaxed - a.untaxed);
    return { rows, totals: { orders: orders.length, qty: rows.reduce((a, r) => a + r.qty, 0), untaxed: rows.reduce((a, r) => a + r.untaxed, 0), total: rows.reduce((a, r) => a + r.total, 0) } };
  }
  // Phân tích hoá đơn + công nợ phải thu theo tuổi nợ
  function invoiceReport({ from = '', to = '' } = {}) {
    const all = db.all("SELECT * FROM invoices WHERE state = 'posted'").map(pubInvoice).filter(i => inRange(i.invoice_date, from, to));
    const sign = (i) => i.kind === 'out_refund' ? -1 : 1;
    const byMonth = new Map(); for (const i of all) { const k = i.invoice_date.slice(0, 7); const g = byMonth.get(k) || { key: k, untaxed: 0, tax: 0, total: 0, count: 0 }; g.untaxed += sign(i) * i.amount_untaxed; g.tax += sign(i) * i.amount_tax; g.total += sign(i) * i.amount_total; g.count++; byMonth.set(k, g); }
    const ar = agedReceivable(openDocs(), today());
    const sum = (k) => all.reduce((a, i) => a + sign(i) * i[k], 0);
    // #51: “Đã thu” chỉ cộng tiền thu có NGÀY trong khoảng lọc (trước đây cộng mọi lần thu từ trước tới nay, kể cả hoá đơn đã huỷ); thêm “refunded” (hoàn tiền cho khách)
    const payIn = (kind) => db.all("SELECT p.amount, p.date FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.kind = ? AND i.state = 'posted'", [kind]).filter(p => inRange(p.date || '', from, to)).reduce((a, p) => a + p.amount, 0);
    return { byMonth: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)), totals: { untaxed: sum('amount_untaxed'), tax: sum('amount_tax'), total: sum('amount_total'), paid: payIn('out_invoice'), refunded: payIn('out_refund') },
      aged: ar.rows, agedTotals: ar.totals };
  }
  function stockReport() { const s = listStock({}); return { rows: s.rows, totalValue: s.totalValue, low: s.rows.filter(r => r.below_min), negative: s.rows.filter(r => r.on_hand < -EPS) }; }
  // số liệu nhanh cho Tổng quan
  function overview() {
    const t = today(); const m = t.slice(0, 7);
    const orders = listOrders({ kind: 'orders' });
    const inv = db.all("SELECT * FROM invoices WHERE state = 'posted'").map(pubInvoice);
    const ar = agedReceivable(openDocs(), t); // #51: cùng số với báo cáo; credit là phần giấy báo có chưa đối trừ, phải thu không âm
    return {
      quotesDraft: db.get("SELECT count(*) AS n FROM quotes WHERE status IN ('draft','sent')").n,
      toInvoice: orders.filter(o => o.invoice_status === 'to_invoice').length,
      deliveriesReady: db.get("SELECT count(*) AS n FROM pickings WHERE kind = 'out' AND state = 'ready'").n,
      receiptsReady: db.get("SELECT count(*) AS n FROM pickings WHERE kind = 'in' AND state = 'ready'").n,
      overdue: { n: ar.overdueN, sum: ar.totals.overdue },
      receivable: ar.totals.total, customerCredit: ar.totals.credit,
      salesMonth: orders.filter(o => monthOf(o.confirmed_at || o.updated_at) === m).reduce((a, o) => a + o.subtotal, 0),
      invoicedMonth: inv.filter(i => (i.invoice_date || '').slice(0, 7) === m).reduce((a, i) => a + (i.kind === 'out_refund' ? -1 : 1) * i.amount_untaxed, 0),
      lowStock: listStock({ filter: 'low' }).rows.length,
    };
  }

  return { PICK_KIND, PICK_STATE, INV_STATE, PAY_STATE, INV_KIND, PAY_METHOD, PROD_TYPE, SO_STATE, INVOICE_STATUS, DELIVERY_STATUS,
    onHand, stockOf, listStock, createReceipt, getPicking, listPickings, setDone, validatePicking, cancelPicking, adjustStock,
    getOrder, listOrders, sendQuote, confirmOrder, cancelOrder, resetToQuote,
    saveInvoice, invoiceOrder, getInvoice, listInvoices, postInvoice, resetInvoice, cancelInvoice, registerPayment, creditNote, deleteInvoice,
    salesReport, invoiceReport, stockReport, overview };
}
// các hàm được gọi từ giao diện (IPC crm:call) — danh sách trắng
const BIZ_CALLS = ['listStock', 'createReceipt', 'getPicking', 'listPickings', 'setDone', 'validatePicking', 'cancelPicking', 'adjustStock', 'getOrder', 'listOrders', 'sendQuote', 'confirmOrder', 'cancelOrder', 'resetToQuote',
  'saveInvoice', 'invoiceOrder', 'getInvoice', 'listInvoices', 'postInvoice', 'resetInvoice', 'cancelInvoice', 'registerPayment', 'creditNote', 'deleteInvoice', 'salesReport', 'invoiceReport', 'stockReport', 'overview'];
module.exports = { createBiz, BIZ_CALLS, lineAmount, addDays };
