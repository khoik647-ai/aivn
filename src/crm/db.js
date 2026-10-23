// Cơ sở dữ liệu SQLite (sql.js/WebAssembly, không cần biên dịch native) lưu trong userData/crm/aivn-crm.sqlite.
// Mỗi thay đổi được ghi xuống đĩa (gộp trong 300 ms, ghi tệp tạm rồi đổi tên để không hỏng khi mất điện).
const fs = require('fs');
const path = require('path');
let SQL = null;
async function sqlJs() {
  if (SQL) return SQL;
  const init = require('sql.js/dist/sql-wasm.js');
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  SQL = await init({ wasmBinary: fs.readFileSync(wasmPath) });
  return SQL;
}
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'person', name TEXT NOT NULL, name_norm TEXT, company_id TEXT, job_title TEXT,
    phone TEXT, phone_norm TEXT, email TEXT, email_norm TEXT, address TEXT, tax_id TEXT, tags TEXT DEFAULT '[]', owner TEXT, notes TEXT, avatar TEXT,
    created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_contacts_company ON contacts(company_id)`,
  `CREATE INDEX IF NOT EXISTS ix_contacts_phone ON contacts(phone_norm)`,
  `CREATE INDEX IF NOT EXISTS ix_contacts_email ON contacts(email_norm)`,
  `CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, title TEXT NOT NULL, contact_id TEXT, stage TEXT NOT NULL DEFAULT 'new', expected_revenue INTEGER DEFAULT 0, probability INTEGER DEFAULT 10,
    close_date TEXT, owner TEXT, notes TEXT, lost_reason TEXT, position REAL DEFAULT 0, created_at INTEGER, updated_at INTEGER, closed_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_leads_contact ON leads(contact_id)`,
  `CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, contact_id TEXT, lead_id TEXT, type TEXT NOT NULL DEFAULT 'todo', title TEXT NOT NULL, notes TEXT,
    due_at INTEGER, remind_min INTEGER, schedule_id TEXT, done_at INTEGER, owner TEXT, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_act_contact ON activities(contact_id)`,
  `CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, contact_id TEXT, lead_id TEXT, kind TEXT, text TEXT, at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_hist_contact ON history(contact_id, at)`,
  `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT, unit TEXT DEFAULT 'cái', price INTEGER DEFAULT 0, description TEXT, active INTEGER DEFAULT 1, created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, number TEXT, contact_id TEXT, lead_id TEXT, status TEXT DEFAULT 'draft', date TEXT, valid_until TEXT, notes TEXT,
    vat_pct REAL DEFAULT 10, created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS quote_lines (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, product_id TEXT, name TEXT, unit TEXT, qty REAL DEFAULT 1, price INTEGER DEFAULT 0, discount_pct REAL DEFAULT 0, pos INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS ix_qlines ON quote_lines(quote_id)`,
  `CREATE TABLE IF NOT EXISTS views (id TEXT PRIMARY KEY, entity TEXT, name TEXT, spec TEXT, created_at INTEGER)`,
  // 0.16 bộ Kinh doanh (theo Odoo): kho (phiếu nhập/xuất/điều chỉnh + dịch chuyển kho), hoá đơn khách hàng, thanh toán
  `CREATE TABLE IF NOT EXISTS pickings (id TEXT PRIMARY KEY, number TEXT, kind TEXT NOT NULL, partner_id TEXT, so_id TEXT, origin TEXT, backorder_of TEXT, state TEXT NOT NULL DEFAULT 'draft',
    scheduled TEXT, done_at INTEGER, notes TEXT, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_pick_so ON pickings(so_id)`,
  `CREATE TABLE IF NOT EXISTS moves (id TEXT PRIMARY KEY, picking_id TEXT, product_id TEXT NOT NULL, so_line_id TEXT, kind TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, qty_done REAL DEFAULT 0,
    unit_cost INTEGER DEFAULT 0, state TEXT NOT NULL DEFAULT 'draft', done_at INTEGER, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_moves_prod ON moves(product_id, state)`,
  `CREATE INDEX IF NOT EXISTS ix_moves_pick ON moves(picking_id)`,
  `CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, number TEXT, kind TEXT NOT NULL DEFAULT 'out_invoice', partner_id TEXT, so_id TEXT, reversed_id TEXT, state TEXT NOT NULL DEFAULT 'draft',
    invoice_date TEXT, due_date TEXT, vat_pct REAL DEFAULT 10, amount_untaxed INTEGER DEFAULT 0, amount_tax INTEGER DEFAULT 0, amount_total INTEGER DEFAULT 0, amount_paid INTEGER DEFAULT 0,
    notes TEXT, posted_at INTEGER, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_inv_so ON invoices(so_id)`,
  `CREATE INDEX IF NOT EXISTS ix_inv_partner ON invoices(partner_id)`,
  `CREATE TABLE IF NOT EXISTS invoice_lines (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, so_line_id TEXT, product_id TEXT, name TEXT, unit TEXT, qty REAL DEFAULT 1, price INTEGER DEFAULT 0, discount_pct REAL DEFAULT 0, pos INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS ix_invl ON invoice_lines(invoice_id)`,
  `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, number TEXT, invoice_id TEXT, partner_id TEXT, amount INTEGER NOT NULL, date TEXT, method TEXT DEFAULT 'bank', memo TEXT, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_pay_inv ON payments(invoice_id)`,
  // 0.16 Mua hàng (theo Odoo purchase.order): yêu cầu báo giá → đơn mua → nhận hàng → hoá đơn nhà cung cấp → trả tiền
  `CREATE TABLE IF NOT EXISTS purchase_orders (id TEXT PRIMARY KEY, number TEXT, partner_id TEXT, partner_ref TEXT, state TEXT NOT NULL DEFAULT 'draft', date_order TEXT, date_planned TEXT,
    payment_days INTEGER DEFAULT 0, vat_pct REAL DEFAULT 10, tax_rounding TEXT, owner TEXT, notes TEXT, confirmed_at INTEGER, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_po_partner ON purchase_orders(partner_id)`,
  `CREATE TABLE IF NOT EXISTS purchase_lines (id TEXT PRIMARY KEY, po_id TEXT NOT NULL, product_id TEXT, name TEXT, unit TEXT, qty REAL DEFAULT 1, price INTEGER DEFAULT 0, discount_pct REAL DEFAULT 0,
    vat_pct REAL DEFAULT 10, pos INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS ix_pol ON purchase_lines(po_id)`,
  // #42 K1: bảng giá nhà cung cấp theo sản phẩm (Odoo product.supplierinfo): giá theo số lượng tối thiểu, số ngày giao
  `CREATE TABLE IF NOT EXISTS vendor_prices (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, partner_id TEXT NOT NULL, min_qty REAL DEFAULT 0, price INTEGER DEFAULT 0, delay INTEGER DEFAULT 0,
    sequence INTEGER DEFAULT 10, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ix_vp_prod ON vendor_prices(product_id, partner_id)`,
];
// cột thêm cho bảng cũ (CSDL tạo từ 0.15.x): thêm nếu chưa có, giữ nguyên dữ liệu
const ADD_COLUMNS = {
  products: [['type', "TEXT DEFAULT 'product'"], ['cost', 'INTEGER DEFAULT 0'], ['barcode', 'TEXT'], ['min_qty', 'REAL DEFAULT 0'], ['category', 'TEXT'], ['vat_pct', 'REAL DEFAULT 10']],
  quotes: [['confirmed_at', 'INTEGER'], ['owner', 'TEXT'], ['payment_days', 'INTEGER DEFAULT 0'], ['commitment_date', 'TEXT'], ['tax_rounding', 'TEXT']],
  // 0.16 (lược đồ 3): thuế GTGT theo từng dòng, Mua hàng (phiếu nhập gắn đơn mua, hoá đơn nhà cung cấp), chiều thanh toán
  quote_lines: [['vat_pct', 'REAL']],
  invoices: [['tax_rounding', 'TEXT'], ['ref', 'TEXT'], ['po_id', 'TEXT']],
  invoice_lines: [['vat_pct', 'REAL'], ['po_line_id', 'TEXT']],
  pickings: [['po_id', 'TEXT']],
  // B54/N3: hàng xuất khi tồn âm — phần chưa có giá (vacuum_qty) và số đã định giá lại (reval) khi hàng về (Odoo: stock.valuation.layer remaining_qty < 0)
  moves: [['po_line_id', 'TEXT'], ['vacuum_qty', 'REAL DEFAULT 0'], ['reval', 'INTEGER DEFAULT 0']],
  payments: [['payment_type', "TEXT DEFAULT 'inbound'"]],
};
const VERSION = 3;

async function openDb(file) {
  const S = await sqlJs();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let db;
  if (fs.existsSync(file)) {
    try { db = new S.Database(fs.readFileSync(file)); db.exec('SELECT count(*) FROM sqlite_master'); }
    catch (e) { // tệp hỏng: giữ lại bản hỏng để cứu dữ liệu, tạo CSDL mới
      const bad = file + '.hong-' + Date.now(); try { fs.renameSync(file, bad); } catch {}
      db = new S.Database();
    }
  } else db = new S.Database();
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const q of SCHEMA) db.exec(q);
  for (const [t, cols] of Object.entries(ADD_COLUMNS)) {
    const have = new Set((db.exec(`PRAGMA table_info(${t})`)[0] || { values: [] }).values.map(r => r[1]));
    for (const [c, def] of cols) if (!have.has(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
  }
  // 0.16: trạng thái báo giá theo Odoo (draft/sent/sale/cancel); bản cũ “accepted/rejected” đổi sang “sale/cancel”
  db.exec("UPDATE quotes SET status = 'sale', confirmed_at = COALESCE(confirmed_at, updated_at) WHERE status = 'accepted'");
  db.exec("UPDATE quotes SET status = 'cancel' WHERE status = 'rejected'");
  // 0.16 lược đồ 3: thuế một mức cho cả chứng từ → thuế theo từng dòng. Dòng cũ nhận mức của chứng từ; chứng từ cũ làm tròn thuế
  // “toàn chứng từ” (Odoo round_globally) nên tổng tiền giữ nguyên từng đồng. Chạy lại vô hại (chỉ đụng giá trị còn trống).
  db.exec("UPDATE quote_lines SET vat_pct = COALESCE((SELECT q.vat_pct FROM quotes q WHERE q.id = quote_lines.quote_id), 10) WHERE vat_pct IS NULL");
  db.exec("UPDATE invoice_lines SET vat_pct = COALESCE((SELECT i.vat_pct FROM invoices i WHERE i.id = invoice_lines.invoice_id), 10) WHERE vat_pct IS NULL");
  db.exec("UPDATE quotes SET tax_rounding = 'global' WHERE tax_rounding IS NULL");
  db.exec("UPDATE invoices SET tax_rounding = 'global' WHERE tax_rounding IS NULL");
  db.exec("UPDATE purchase_orders SET tax_rounding = 'line' WHERE tax_rounding IS NULL");
  db.exec("UPDATE payments SET payment_type = 'inbound' WHERE payment_type IS NULL");
  const was = (db.exec("SELECT value FROM meta WHERE key = 'schema'")[0] || { values: [[null]] }).values[0][0];
  db.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', ['schema', String(Math.max(VERSION, Number(was) || 0))]);
  let timer = null, dirty = false;
  const flushSync = () => {
    clearTimeout(timer); timer = null; if (!dirty) return; dirty = false;
    const tmp = file + '.tmp'; fs.writeFileSync(tmp, Buffer.from(db.export())); fs.renameSync(tmp, file);
  };
  const touch = () => { dirty = true; if (!timer) { timer = setTimeout(() => { try { flushSync(); } catch (e) { console.error('[crm] ghi lỗi', e.message); } }, 300); if (timer.unref) timer.unref(); } };
  const all = (sql, params = []) => { const st = db.prepare(sql); try { st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); } };
  const get = (sql, params = []) => all(sql, params)[0] || null;
  const run = (sql, params = []) => { db.run(sql, params); touch(); return db.getRowsModified(); };
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); touch(); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; } };
  if (!fs.existsSync(file)) { dirty = true; flushSync(); }
  return { all, get, run, tx, flushSync, file, exportBytes: () => Buffer.from(db.export()), close: () => { flushSync(); db.close(); },
    // kiểm tra tệp sao lưu trước khi khôi phục
    validate: async (buf) => { const t = new S.Database(buf); try { const n = t.exec("SELECT count(*) FROM sqlite_master WHERE name IN ('contacts','leads')")[0].values[0][0]; return n === 2; } finally { t.close(); } } };
}
module.exports = { openDb };
