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
];
const VERSION = 1;

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
  db.run('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)', ['schema', String(VERSION)]);
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
