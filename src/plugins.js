'use strict';
// Bí mật MCP, plugins-meta.json, và thẻ xin phép (mục 15, PR 2).
// Không có HTML cửa hàng. Không ghi giá trị bí mật ra nhật ký, IPC, thẻ, hay câu lỗi.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mcpMod = require('./mcp');

const { safeName, classifyUrl, claimCatalogId, isExcelServer, validate, presets, secretIdOf, secretPlaceholder } = mcpMod;

const SECRET_NAME = /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;
const SECRET_VALUE = /^(?:sk-|ghp_|github_pat_|hf_|Bearer )/;
const SOON = ['zalo', 'gmail', 'drive', 'calendar', 'notion'];
const BIZ_READ = ['listStock', 'getPicking', 'listPickings', 'getOrder', 'listOrders', 'getInvoice', 'listInvoices', 'salesReport', 'invoiceReport', 'stockReport', 'overview'];
const BIZ_WRITE = ['createReceipt', 'setDone', 'validatePicking', 'adjustStock', 'sendQuote', 'confirmOrder', 'resetToQuote', 'saveInvoice', 'invoiceOrder', 'postInvoice', 'resetInvoice'];
const BIZ_DANGER = ['cancelPicking', 'cancelOrder', 'cancelInvoice', 'registerPayment', 'creditNote', 'deleteInvoice'];
const EXCEL_WRITE = ['excel_write_to_sheet', 'excel_create_table', 'excel_copy_sheet', 'excel_format_range'];
const QA_DENY = ['connector_connect', 'mcp_connect', 'mcp_import', 'mcp_replace', 'excel_folders', ...BIZ_DANGER.map(n => 'biz_' + n)];

const KEYCHAIN_OK = 'Khoá được mã hoá bằng kho khoá của hệ điều hành và không bao giờ hiện lại hay ghi vào nhật ký.';
const KEYCHAIN_NO = 'Máy này không có kho khoá an toàn của hệ điều hành: khoá chỉ giữ trong bộ nhớ đến khi thoát AIVN (không ghi ra đĩa).';
const MCP_WARN = '⚠ Máy chủ MCP là chương trình chạy trên máy bạn (stdio) hoặc dịch vụ bên ngoài (http/SSE) và có thể đọc/ghi dữ liệu. Chỉ thêm máy chủ bạn tin tưởng. AIVN luôn xin phép trước mỗi lần gọi công cụ MCP (trừ khi bạn chọn “Luôn cho phép”).';
const BIZ_WARN = 'AIVN Kinh doanh đọc và sửa dữ liệu kinh doanh trên máy này. Xoá, huỷ và ghi nhận thanh toán vẫn hỏi bạn từng lần.';
const EXCEL_WARN = 'Ghi tệp Excel trong thư mục của Excel. Ghi đè vẫn hỏi bạn trước.';
const KEPT = 'Kết nối được giữ khi bạn mở lại AIVN.';
const ALWAYS_READY = 'Luôn chạy sẵn';
const ALWAYS_ADVANCED = ALWAYS_READY;
const ALWAYS_IMPORT = ALWAYS_READY;
const AUTOSTART_LINE = 'Cho phép máy chủ này tự chạy mỗi khi mở AIVN.';
const LEAVES = 'Dữ liệu gửi tới máy chủ này rời khỏi máy bạn.';
const LAN_HTTP = 'Địa chỉ http này nằm trong mạng nội bộ của bạn.';
const UNPINNED = 'Lệnh này không ghim phiên bản. npx có thể tải mã mới.';
const NO_SECRET = 'không có';
const REPLACE_WARN = 'Tiến trình cũ sẽ bị dừng.';
const DATA_HERE = 'Dữ liệu nằm trên máy này (crm.db).';
const NO_EXCEL_APP = 'Không cần cài Microsoft Excel.';
const PROBE_NOTE = 'AIVN sẽ chạy thử khoảng 15 giây, xem danh sách chức năng, rồi tắt. Máy chủ chỉ chạy thật khi AIVN AGENT dùng tới.';
const PROBE_TIMEOUT = 'Chạy thử quá 15 giây nên đã tắt. Hãy kiểm tra lệnh trong Chi tiết, rồi chạy thử lại.';
const PROBE_MISSING = 'Không thấy chương trình để chạy. Hãy kiểm tra lệnh trong Chi tiết.';
const PROBE_KEY = 'Thiếu khoá bí mật nên chưa chạy thử được. Hãy nhập khoá, rồi chạy thử lại.';
const PROBE_NET = 'Không tới được máy chủ qua mạng. Hãy kiểm tra địa chỉ trong Chi tiết.';
const PROBE_OTHER = 'Chạy thử không xong. Hãy xem Chi tiết rồi chạy thử lại.';
const PROBE_OK = 'Chạy thử được · {0} chức năng';

// Câu trên thẻ. Khoá là tiếng Việt; en.js và zh.js dịch.
const CARD_STRINGS = [
  'Cho phép kết nối “{0}”?',
  ALWAYS_READY,
  'Tự bật lại kết nối này khi mở AIVN',
  'Nhập {0} máy chủ từ mcp.json?',
  'Thay thế máy chủ “{0}”?',
  'Đã tách {0} khoá bí mật ra khỏi tệp. Chúng được mã hoá bằng kho khoá hệ điều hành và không ghi dạng chữ vào mcp.json.',
  LEAVES,
  LAN_HTTP,
  UNPINNED,
  BIZ_WARN,
  EXCEL_WARN,
  KEPT,
  AUTOSTART_LINE,
  'Chi tiết',
  'Lệnh',
  'Lệnh cũ',
  'Lệnh mới',
  'Khoá bí mật',
  'Khoá',
  'Thư mục',
  'Máy chủ',
  'Dữ liệu',
  'Mạng',
  'Phiên bản',
  DATA_HERE,
  NO_EXCEL_APP,
  REPLACE_WARN,
  KEYCHAIN_OK,
  KEYCHAIN_NO,
  'AIVN Kinh doanh sẽ xoá, huỷ hoặc ghi nhận thanh toán. Bước này luôn hỏi bạn.',
  'AIVN Kinh doanh sẽ sửa dữ liệu trên máy này mà không hỏi lại.',
  'AIVN Kinh doanh sẽ đọc dữ liệu trên máy này mà không hỏi lại.',
  'Ghi tệp Excel trong thư mục của Excel sẽ chạy mà không hỏi lại. Ghi đè vẫn nên được xem trước.',
  'Kết nối cửa hàng không có tự chạy.',
  PROBE_NOTE,
  PROBE_TIMEOUT,
  PROBE_MISSING,
  PROBE_KEY,
  PROBE_NET,
  PROBE_OTHER,
  PROBE_OK,
  'Đổi tên hiển thị',
  'Dùng tên gốc',
  'Tên gốc',
  'Tên hiển thị không được để trống.',
  'Sổ tay agent',
  'Sổ tay riêng của AIVN AGENT, nằm trong ứng dụng này. Không phải tính năng Ghi nhớ của AIVN và không ghi vào đó.',
  'Đổi thư mục của Excel?',
  'Đang chạy thử…',
  'Chạy thử lại',
  'Hãy cho phép kết nối trước khi chạy thử.',
];

function isSecretName(name) { return SECRET_NAME.test(String(name || '')); }
function looksLikeSecretValue(v) { return typeof v === 'string' && v !== '' && SECRET_VALUE.test(v); }
function isSecret(name, value) {
  if (typeof value !== 'string' || value === '') return false;
  return isSecretName(name) || looksLikeSecretValue(value);
}
function secretRef(v) { return secretIdOf(v) != null; }
function blankSecure() {
  return { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' };
}
function storageSecure(safeStorage) {
  try {
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) return false;
    const b = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : null;
    return b !== 'basic_text' && b !== 'unknown';
  } catch { return false; }
}

function createSecretStore({ dir, safeStorage = null } = {}) {
  const file = path.join(dir, 'mcp-secrets.json');
  const mem = new Map();
  const noted = new Set();
  const secure = () => storageSecure(safeStorage);
  function remember(v) {
    if (typeof v !== 'string' || v.length < 8) return;
    noted.add(v);
    if (v.startsWith('Bearer ') && v.length > 15) noted.add(v.slice(7));
  }
  function mask(text) {
    let s = text == null ? '' : String(text);
    const list = [...noted].sort((a, b) => b.length - a.length);
    for (const v of list) if (v && s.includes(v)) s = s.split(v).join('••••');
    return s;
  }
  function maskDeep(value, seen = new WeakSet()) {
    if (typeof value === 'string') return mask(value);
    if (value instanceof Error) return { message: mask(value.message), stack: mask(value.stack || '') };
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) return value.map(x => maskDeep(x, seen));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'env' || k === 'headers' || k === 'enc') continue;
      if (typeof v === 'string' && v && (isSecretName(k) || looksLikeSecretValue(v))) { out[k] = '••••'; continue; }
      out[k] = maskDeep(v, seen);
    }
    return out;
  }
  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) return { v: 1, entries: {} };
      return { v: 1, entries: raw.entries };
    } catch { return { v: 1, entries: {} }; }
  }
  function write(data) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, entries: data.entries || {} }), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* quyền tệp */ }
  }
  function get(id) {
    if (mem.has(id)) return mem.get(id);
    if (!secure()) return null;
    const row = read().entries[id];
    if (!row || typeof row.enc !== 'string' || !row.enc) return null;
    try {
      const v = safeStorage.decryptString(Buffer.from(row.enc, 'base64'));
      if (typeof v !== 'string' || v === '') return null;
      mem.set(id, v); remember(v); return v;
    } catch { return null; }
  }
  function put(id, value) {
    const v = String(value ?? '');
    if (!v) return { persisted: false };
    remember(v); mem.set(id, v);
    if (!secure()) return { persisted: false };
    try {
      const enc = safeStorage.encryptString(v).toString('base64');
      const data = read();
      data.entries[id] = { enc };
      write(data);
      return { persisted: true };
    } catch { return { persisted: false }; }
  }
  function forget(id) {
    mem.delete(id);
    if (!secure() || !fs.existsSync(file)) return;
    const data = read();
    if (!data.entries[id]) return;
    delete data.entries[id];
    write(data);
  }
  function deleteBySafeName(sn) {
    const prefix = `mcp:${sn}:`;
    for (const id of [...mem.keys()]) if (id.startsWith(prefix)) mem.delete(id);
    if (!secure() || !fs.existsSync(file)) return;
    const data = read(); let changed = false;
    for (const id of Object.keys(data.entries)) if (id.startsWith(prefix)) { delete data.entries[id]; changed = true; }
    if (changed) write(data);
  }
  function loadKnown() {
    if (!secure() || !fs.existsSync(file)) return;
    for (const id of Object.keys(read().entries)) get(id);
  }
  loadKnown();
  return {
    file, secure, get, put, forget, deleteBySafeName, mask, maskDeep, remember, note: remember,
    exists: () => fs.existsSync(file),
    sentence: () => (secure() ? KEYCHAIN_OK : KEYCHAIN_NO),
    ids: () => (secure() ? Object.keys(read().entries) : [...mem.keys()]),
  };
}

function kindOf(def) {
  if (!def || !def.url) return 'stdio';
  if (def.type === 'sse' || /\/sse\/?$/.test(String(def.url))) return 'sse';
  return 'http';
}
function isLoopback(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return !!m && Number(m[1]) === 127 && [m[2], m[3], m[4]].every(x => Number(x) <= 255);
}
function versionPinned(def) {
  return (def && Array.isArray(def.args) ? def.args : []).some(a => /@\d+\.\d+\.\d+/.test(String(a)));
}
function unpinned(def) {
  if (!def || def.url) return false;
  return !versionPinned(def);
}
function connectDanger(def) {
  if (!def) return true;
  if (def.url) {
    if (classifyUrl(def.url).lan) return true;
    if (isLoopback(def.url)) return false;
    return !claimCatalogId(def);
  }
  if (unpinned(def)) return true;
  if (isExcelServer(def)) return false;
  return !claimCatalogId(def);
}
function commandRaw(def) {
  if (!def) return '';
  if (def.url) return String(def.url);
  return [def.command, ...(Array.isArray(def.args) ? def.args : [])].filter(x => x != null && x !== '').join(' ');
}
function secretKeyNames(def) {
  const names = [];
  for (const bag of ['env', 'headers']) {
    for (const [k, v] of Object.entries((def && def[bag]) || {})) {
      if (secretRef(v) || (typeof v === 'string' && isSecret(k, v))) names.push(k);
    }
  }
  return names;
}
function fingerprint(def) {
  const body = JSON.stringify({
    command: def && def.command || '',
    args: def && Array.isArray(def.args) ? def.args : [],
    url: def && def.url || '',
    headers: Object.keys((def && def.headers) || {}).sort(),
    env: Object.keys((def && def.env) || {}).sort(),
  });
  return crypto.createHash('sha256').update(body).digest('hex');
}
function movedLine(n) {
  return `Đã tách ${n} khoá bí mật ra khỏi tệp. Chúng được mã hoá bằng kho khoá hệ điều hành và không ghi dạng chữ vào mcp.json.`;
}

function cardVisibleText(card) {
  const c = card || {};
  const parts = [c.title, c.sub, c.note, c.warn, c.alwaysLabel, c.label, c.tool, c.preview, c.path];
  for (const row of c.fields || []) parts.push(row[0], row[1], row[2]);
  for (const row of c.details || []) parts.push(row[0], row[1]);
  return parts.filter(x => x != null).join('\n');
}
function checkboxLabel(card) {
  if (!card || !card.allowAlways) return null;
  return card.alwaysLabel || 'Luôn cho phép công cụ này';
}
function commandInDetails(card) {
  const fields = JSON.stringify(card && card.fields || []);
  const details = JSON.stringify(card && card.details || []);
  return !/"Lệnh"/.test(fields) && /"Lệnh"/.test(details);
}

function cardMcpConnect(name, def, secrets, { displayName = '' } = {}) {
  const names = secretKeyNames(def);
  const fields = [['Khoá bí mật', names.length ? names.join(', ') : NO_SECRET]];
  if (def && def.url && !isLoopback(def.url)) fields.push(['Dữ liệu', LEAVES]);
  if (def && def.url && classifyUrl(def.url).lan) fields.push(['Mạng', LAN_HTTP]);
  if (unpinned(def)) fields.push(['Phiên bản', UNPINNED]);
  if (names.length && secrets && !secrets.secure()) fields.push(['Khoá', secrets.sentence()]);
  const shown = secrets ? secrets.mask(commandRaw(def)) : commandRaw(def);
  const label = typeof displayName === 'string' && displayName.trim() && displayName.trim() !== name ? displayName.trim() : name;
  const details = [];
  if (label !== name) details.push(['Tên gốc', name]);
  details.push(['Lệnh', shown], ['Loại', kindOf(def)]);
  return {
    tool: 'mcp_connect', title: `Cho phép kết nối “${label}”?`, sub: String(label),
    alwaysLabel: ALWAYS_ADVANCED, allowAlways: true, fields,
    details, warn: MCP_WARN, danger: connectDanger(def), note: PROBE_NOTE,
  };
}
function cardAutostart(name) {
  return {
    tool: 'mcp_connect', title: AUTOSTART_LINE, sub: String(name),
    allowAlways: false, fields: [], details: [], warn: '', danger: false, note: '',
  };
}
function cardConnector(id, { folders = [] } = {}) {
  if (id === 'excel') {
    const rows = (folders || []).filter(f => typeof f === 'string' && f);
    const fields = [['Việc', NO_EXCEL_APP]];
    if (!rows.length) fields.push(['Thư mục', 'Chưa có thư mục nào được phép cho Excel. Hãy chọn thư mục trong Chi tiết.', '', 'raw']);
    else for (const f of rows) fields.push(['Thư mục', path.basename(f) || f, f, 'raw']);
    return {
      tool: 'connector_connect', title: 'Cho phép kết nối “Excel”?', sub: 'Excel',
      allowAlways: false, fields, details: [], note: KEPT, warn: EXCEL_WARN, danger: false,
    };
  }
  return {
    tool: 'connector_connect', title: 'Cho phép kết nối “AIVN Kinh doanh”?', sub: 'AIVN Kinh doanh',
    allowAlways: false, fields: [['Việc', DATA_HERE]], details: [], note: KEPT, warn: BIZ_WARN, danger: false,
  };
}
function cardImport(items, { secretCount = 0, secretsSecure = true } = {}) {
  const list = items || [];
  const fields = [['Máy chủ', list.map(s => `${s.name} · ${s.kind || kindOf(s.def)}`).join('\n') || NO_SECRET]];
  if (secretCount > 0) fields.push(['Khoá bí mật', secretsSecure ? movedLine(secretCount) : KEYCHAIN_NO]);
  return {
    tool: 'mcp_import', title: `Nhập ${list.length} máy chủ từ mcp.json?`,
    alwaysLabel: ALWAYS_IMPORT, allowAlways: true, fields,
    details: list.map(s => ['Lệnh', `${s.name}: ${s.commandRedacted || ''}`]),
    warn: MCP_WARN, danger: list.some(s => s.danger || (s.def && connectDanger(s.def))), note: PROBE_NOTE,
  };
}
function cardExcelFolders(folders) {
  const rows = (folders || []).filter(f => typeof f === 'string' && f);
  const fields = rows.length
    ? rows.map(f => ['Thư mục', path.basename(f) || f, f, 'raw'])
    : [['Thư mục', 'Chưa có thư mục nào được phép cho Excel. Hãy chọn thư mục trong Chi tiết.', '', 'raw']];
  return {
    tool: 'excel_folders', title: 'Đổi thư mục của Excel?', allowAlways: false,
    fields, details: [], warn: EXCEL_WARN, danger: false, note: '',
  };
}
function cardReplace(name, oldDef, newDef, secrets) {
  const mask = (d) => secrets ? secrets.mask(commandRaw(d)) : commandRaw(d);
  return {
    tool: 'mcp_replace', title: `Thay thế máy chủ “${name}”?`,
    allowAlways: false, fields: [],
    details: [['Lệnh cũ', mask(oldDef)], ['Lệnh mới', mask(newDef)]],
    warn: REPLACE_WARN, danger: true, note: '',
  };
}

function extractSecrets(cfg, store) {
  const next = JSON.parse(JSON.stringify(cfg || {}));
  let count = 0;
  const servers = next.mcpServers && typeof next.mcpServers === 'object' ? next.mcpServers : {};
  for (const [name, def] of Object.entries(servers)) {
    if (!def || typeof def !== 'object') continue;
    for (const bag of ['env', 'headers']) {
      if (!def[bag] || typeof def[bag] !== 'object' || Array.isArray(def[bag])) continue;
      for (const [k, v] of Object.entries(def[bag])) {
        const old = secretIdOf(v);
        if (old && typeof v === 'object') { def[bag][k] = secretPlaceholder(old); continue; }
        if (typeof v === 'string' && old) continue;
        if (typeof v !== 'string' || !isSecret(k, v)) continue;
        const id = `mcp:${safeName(name)}:${k}`;
        if (store) store.put(id, v);
        def[bag][k] = secretPlaceholder(id);
        count++;
      }
    }
    if (Array.isArray(def.args)) {
      def.args = def.args.map((a, i) => {
        if (typeof a !== 'string' || secretIdOf(a)) return a;
        const known = !!(store && store.mask(a) !== a);
        if (!looksLikeSecretValue(a) && !known) return a;
        const id = `mcp:${safeName(name)}:arg${i}`;
        if (store) store.put(id, a);
        count++;
        return secretPlaceholder(id);
      });
    }
  }
  return { cfg: next, count };
}
function secretStamp(def, secrets) {
  const parts = [];
  const take = (slot, v) => {
    const id = secretIdOf(v);
    const raw = id ? (secrets && secrets.get(id)) : (typeof v === 'string' && isSecret(slot, v) ? v : null);
    if (raw == null || raw === '') return;
    parts.push(slot + '=' + crypto.createHash('sha256').update(String(raw)).digest('hex'));
  };
  for (const bag of ['env', 'headers']) for (const [k, v] of Object.entries((def && def[bag]) || {})) take(bag + ':' + k, v);
  (def && Array.isArray(def.args) ? def.args : []).forEach((a, i) => take('arg' + i, a));
  return crypto.createHash('sha256').update(parts.sort().join('\n')).digest('hex');
}
function observeSecrets(cfg, store) {
  if (!store) return;
  for (const def of Object.values((cfg && cfg.mcpServers) || {})) {
    if (!def || typeof def !== 'object') continue;
    for (const bag of ['env', 'headers']) {
      for (const [k, v] of Object.entries(def[bag] || {})) if (typeof v === 'string' && isSecret(k, v)) store.note(v);
    }
    for (const a of Array.isArray(def.args) ? def.args : []) if (typeof a === 'string' && looksLikeSecretValue(a)) store.note(a);
  }
}

function emptyMeta() {
  return { v: 1, connectors: {}, notify: {}, servers: {}, upgradedAt: null };
}
function createMetaStore({ dir } = {}) {
  const file = path.join(dir, 'plugins-meta.json');
  const data = emptyMeta();
  function apply(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    data.v = 1;
    data.connectors = src.connectors && typeof src.connectors === 'object' ? src.connectors : {};
    data.notify = src.notify && typeof src.notify === 'object' ? src.notify : {};
    data.servers = src.servers && typeof src.servers === 'object' ? src.servers : {};
    data.upgradedAt = typeof src.upgradedAt === 'string' ? src.upgradedAt : null;
    return data;
  }
  function load() {
    try { return apply(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return apply(null); }
  }
  function save() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp-' + process.pid;
    const body = JSON.stringify({ v: 1, connectors: data.connectors, notify: data.notify, servers: data.servers, upgradedAt: data.upgradedAt }, null, 2);
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  load();
  function setConnector(id, rec) {
    if (id !== 'biz' && id !== 'excel') return;
    const out = { approvedAt: rec.approvedAt, enabled: rec.enabled !== false };
    if (id === 'excel') out.folders = (Array.isArray(rec.folders) ? rec.folders : []).filter(x => typeof x === 'string');
    data.connectors[id] = out;
    save();
  }
  return {
    file, load, save, data,
    setConnector,
    setNotify(id, on) {
      if (!SOON.includes(id)) return;
      if (on) data.notify[id] = true; else delete data.notify[id];
      save();
    },
    setServer(name, rec) {
      const prev = data.servers[name] || {};
      const row = { catalogId: rec.catalogId || null, approvedAt: rec.approvedAt || null, autoStart: !!rec.autoStart, fp: rec.fp || null };
      const shown = Object.prototype.hasOwnProperty.call(rec, 'displayName') ? rec.displayName : prev.displayName;
      if (shown) row.displayName = String(shown).slice(0, 80);
      const probedAt = Object.prototype.hasOwnProperty.call(rec, 'probedAt') ? rec.probedAt : prev.probedAt;
      const secretFp = Object.prototype.hasOwnProperty.call(rec, 'secretFp') ? rec.secretFp : prev.secretFp;
      if (probedAt) row.probedAt = probedAt;
      if (secretFp) row.secretFp = secretFp;
      data.servers[name] = row;
      save();
    },
    server: (name) => data.servers[name] || null,
  };
}

function qaDenies(req) {
  const tool = String(req && req.tool || '');
  if (/^mcp__/.test(tool)) return true;
  return QA_DENY.includes(tool);
}

function createPluginGate({ dir, mcp, secrets, meta = null, approve = async () => ({ ok: false }), log = () => {}, getAgentFolders = () => [], agentEnabled = () => true, probeMs = 15000, now = () => new Date().toISOString() } = {}) {
  if (!secrets) secrets = createSecretStore({ dir });
  if (!meta) meta = createMetaStore({ dir });
  const say = (m) => { try { log('mcp', secrets.mask(String(m))); } catch { /* nhật ký không được làm hỏng lối đi */ } };
  function publicServers() {
    const list = mcp.status() || [];
    return (Array.isArray(list) ? list : []).map(s => secrets.maskDeep(s));
  }
  function publicPayload() {
    return { servers: publicServers(), text: secrets.mask(mcp.readText()), file: mcp.file, secretsSecure: secrets.secure() };
  }
  async function seal() {
    let cfg;
    try { cfg = mcp.config(); } catch { return 0; }
    observeSecrets(cfg, secrets);
    let extracted;
    try { extracted = extractSecrets(cfg, secrets); } catch { return 0; }
    if (!extracted.count) return 0;
    try { validate(extracted.cfg); } catch { return 0; }
    try { await mcp.saveText(JSON.stringify(extracted.cfg)); } catch { return 0; }
    return extracted.count;
  }
  function upgradeOnce() {
    if (meta.data.upgradedAt) return [];
    const servers = (mcp.config() && mcp.config().mcpServers) || {};
    const names = [];
    for (const [name, def] of Object.entries(servers)) {
      if (!def || def.disabled || isExcelServer(def) || def.auth != null) continue;
      try { validate({ mcpServers: { [name]: def } }); } catch { continue; }
      if (meta.data.servers[name]) continue;
      meta.data.servers[name] = { catalogId: claimCatalogId(def), approvedAt: now(), autoStart: false, fp: fingerprint(def) };
      names.push(name);
    }
    meta.data.upgradedAt = now();
    meta.save();
    say(`Nâng cấp một lần: ${names.length} máy chủ Nâng cao được nhớ là đã duyệt. Luôn chạy sẵn mặc định tắt, nên chúng chạy ở lần dùng đầu. Không hiện thẻ. Không bật Kết nối cửa hàng.`);
    return names;
  }
  function reconcile(servers) {
    const names = new Set(Object.keys(servers || {}));
    for (const name of Object.keys(meta.data.servers)) {
      if (names.has(name)) continue;
      secrets.deleteBySafeName(safeName(name));
      delete meta.data.servers[name];
    }
    for (const [name, def] of Object.entries(servers || {})) {
      if (isExcelServer(def)) continue;
      const rec = meta.data.servers[name];
      if (!rec) continue;
      const fp = fingerprint(def);
      if (rec.fp && rec.fp !== fp) { rec.approvedAt = null; rec.autoStart = false; rec.catalogId = claimCatalogId(def); rec.probedAt = null; rec.secretFp = null; }
      rec.fp = fp;
    }
    meta.save();
  }
  async function saveJson(text) {
    let parsed;
    try { parsed = JSON.parse(String(text)); } catch { return { ok: false, error: 'mcp.json không phải JSON hợp lệ.' }; }
    try { validate(parsed); } catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    const extracted = extractSecrets(parsed, secrets);
    try {
      await mcp.saveText(JSON.stringify(extracted.cfg));
      reconcile(extracted.cfg.mcpServers || {});
      return { ok: true, servers: publicServers(), secretCount: extracted.count, secretsSecure: secrets.secure() };
    } catch (e) {
      say(`Lưu mcp.json lỗi\n${e && e.stack || e}`);
      return { ok: false, error: secrets.mask(e && e.message) };
    }
  }
  async function approveServer(name, intent) {
    const def = (mcp.config().mcpServers || {})[name];
    if (!def) return { ok: false, error: 'Không có máy chủ này.' };
    try { validate({ mcpServers: { [name]: def } }); } catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    if (def.auth != null) return { ok: false, error: `AIVN chưa hỗ trợ đăng nhập OAuth (trường auth) của máy chủ "${name}".` };
    const rec = meta.server(name);
    const approved = !!(rec && rec.approvedAt);
    let use = intent;
    if (use === 'start' && approved) return { ok: true, already: true };
    if (use === 'autostart' && !approved) use = 'start';
    const card = use === 'autostart' ? cardAutostart(name) : cardMcpConnect(name, def, secrets, { displayName: (meta.server(name) || {}).displayName || '' });
    let ans;
    try { ans = await approve(secrets.maskDeep(card)); } catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    if (!ans || ans.ok !== true) return { ok: false, canceled: !(ans && ans.timeout), timeout: !!(ans && ans.timeout) };
    meta.setServer(name, {
      catalogId: claimCatalogId(def),
      approvedAt: now(),
      autoStart: use === 'autostart' ? true : ans.always === true,
      fp: fingerprint(def),
    });
    return { ok: true, always: ans.always === true };
  }
  function probePlain(message, logs) {
    const raw = secrets.mask(String(message || ''));
    const detail = secrets.mask([raw, ...(Array.isArray(logs) ? logs : [])].filter(Boolean).join('\n'));
    let error = PROBE_OTHER;
    if (/thời gian chạy thử|Quá 60 giây|timeout/i.test(raw)) error = PROBE_TIMEOUT;
    else if (/Không giải được khoá|khoá bí mật/i.test(raw)) error = PROBE_KEY;
    else if (/ENOENT|not found|không tìm thấy|spawn |không có lệnh/i.test(raw)) error = PROBE_MISSING;
    else if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|không tới|network|getaddrinfo/i.test(raw)) error = PROBE_NET;
    return { ok: false, error, details: detail };
  }
  async function probeServer(name) {
    const def = (mcp.config().mcpServers || {})[name];
    if (!def) return { ok: false, error: 'Không có máy chủ này.', details: '' };
    if (!(meta.server(name) || {}).approvedAt) return { ok: false, error: 'Hãy cho phép kết nối trước khi chạy thử.', details: '' };
    const ms = Math.max(50, Math.min(15000, Number(probeMs) || 15000));
    let server = null;
    try { server = await mcp.start(name, { connectTimeout: ms }); }
    catch (e) {
      try { await mcp.stop(name, { quiet: true }); } catch { /* tắt tiến trình thử */ }
      say(`${name}: chạy thử lỗi\n${e && e.stack || e}`);
      return probePlain(e && e.message, null);
    }
    const tools = server && Array.isArray(server.tools) ? server.tools.length : 0;
    const bad = !!(server && server.state === 'error');
    const logs = server && server.logs;
    const errText = server && server.error;
    try { await mcp.stop(name, { quiet: true }); } catch (e) { say(`${name}: tắt sau chạy thử lỗi\n${e && e.stack || e}`); }
    if (bad) return probePlain(errText, logs);
    const rec = meta.server(name) || {};
    meta.setServer(name, { ...rec, catalogId: claimCatalogId(def), approvedAt: rec.approvedAt, autoStart: !!rec.autoStart, fp: fingerprint(def), probedAt: now(), secretFp: secretStamp(def, secrets) });
    return { ok: true, probed: true, tools, message: PROBE_OK.replace('{0}', String(tools)) };
  }
  async function openServer(name, { probe = false } = {}) {
    const gate = await approveServer(name, 'start');
    if (!gate.ok) return gate;
    const def = (mcp.config().mcpServers || {})[name];
    if (!def) return { ok: false, error: 'Không có máy chủ này.' };
    let st = null;
    try { st = mcp.status(name); } catch { st = null; }
    const rec = meta.server(name) || {};
    const sameCfg = rec.fp === fingerprint(def);
    const sameSec = !!rec.secretFp && rec.secretFp === secretStamp(def, secrets);
    if (!probe && st && st.state === 'on' && sameCfg && sameSec) return { ok: true, kept: true, server: secrets.maskDeep(st) };
    if (probe || !rec.probedAt || (st && st.state === 'error')) {
      const probed = await probeServer(name);
      return probed.ok ? { ...probed, name } : probed;
    }
    if (st && (st.state === 'on' || st.state === 'starting')) { try { await mcp.stop(name, { quiet: true }); } catch { /* chạy lại */ } }
    let server;
    try { server = await mcp.start(name); }
    catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    const bad = !server || server.state === 'error';
    if (!bad) {
      const cur = meta.server(name) || {};
      meta.setServer(name, { ...cur, catalogId: claimCatalogId(def), fp: fingerprint(def), secretFp: secretStamp(def, secrets) });
    }
    return { ok: !bad, direct: true, restarted: !!(st && st.state === 'on'), server: secrets.maskDeep(server), error: bad ? server && server.error : undefined };
  }
  async function startServer(name, opts = {}) { return openServer(name, { probe: !!(opts && opts.probe) }); }
  async function toggle(name, on) {
    if (!on) {
      try { return { ok: true, server: secrets.maskDeep(await mcp.setEnabled(name, false)) }; }
      catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    }
    try {
      const cfg = JSON.parse(JSON.stringify(mcp.config() || { mcpServers: {} }));
      if (cfg.mcpServers && cfg.mcpServers[name]) delete cfg.mcpServers[name].disabled;
      await mcp.saveText(JSON.stringify(cfg));
    } catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    return openServer(name);
  }
  async function addPreset(kind, folder) {
    const P = presets({ folder });
    if (!P[kind]) return { ok: false, error: 'Không có mẫu này.' };
    const cfg = JSON.parse(JSON.stringify(mcp.config() || { mcpServers: {} }));
    cfg.mcpServers = cfg.mcpServers || {};
    let name = kind; let i = 2;
    while (cfg.mcpServers[name]) name = `${kind}-${i++}`;
    const def = P[kind];
    const card = cardMcpConnect(name, def, secrets);
    let ans;
    try { ans = await approve(secrets.maskDeep(card)); } catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    if (!ans || ans.ok !== true) return { ok: false, canceled: !(ans && ans.timeout), timeout: !!(ans && ans.timeout) };
    cfg.mcpServers[name] = def;
    try { await mcp.saveText(JSON.stringify(cfg)); } catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    meta.setServer(name, { catalogId: claimCatalogId(def), approvedAt: now(), autoStart: ans.always === true, fp: fingerprint(def) });
    const probed = await probeServer(name);
    return probed.ok ? { ...probed, name } : { ...probed, name };
  }
  async function setAutostart(name, on) {
    if (name === 'biz' || name === 'excel') return { ok: false, error: 'Kết nối cửa hàng không có tự chạy.' };
    if (!on) {
      const rec = meta.server(name);
      if (rec) meta.setServer(name, { ...rec, autoStart: false });
      return { ok: true };
    }
    const gate = await approveServer(name, 'autostart');
    if (!gate.ok) return gate;
    return { ok: true };
  }
  async function connectConnector(id) {
    if (id !== 'biz' && id !== 'excel') return { ok: false, error: 'Không có kết nối này.' };
    const folders = id === 'excel' ? folderList('excel') : [];
    const preview = id === 'excel' && !folders.length ? (typeof getAgentFolders === 'function' ? getAgentFolders() : []) : folders;
    const card = cardConnector(id, { folders: preview });
    let ans;
    try { ans = await approve(secrets.maskDeep(card)); } catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    if (!ans || ans.ok !== true) return { ok: false, canceled: !(ans && ans.timeout), timeout: !!(ans && ans.timeout) };
    if (id === 'biz') meta.setConnector('biz', { approvedAt: now(), enabled: true });
    else {
      const existing = meta.data.connectors.excel;
      const keep = existing && Array.isArray(existing.folders) && existing.folders.length ? existing.folders : (typeof getAgentFolders === 'function' ? getAgentFolders() : []);
      meta.setConnector('excel', { approvedAt: now(), enabled: true, folders: (keep || []).filter(x => typeof x === 'string') });
    }
    return { ok: true, id };
  }
  function disconnectConnector(id, { remove = false } = {}) {
    if (id !== 'biz' && id !== 'excel') return { ok: false };
    if (remove) delete meta.data.connectors[id];
    else if (meta.data.connectors[id]) meta.data.connectors[id].enabled = false;
    meta.save();
    return { ok: true };
  }
  function folderList(id) {
    const row = meta.data.connectors[id];
    return row && Array.isArray(row.folders) ? row.folders.filter(x => typeof x === 'string') : [];
  }
  function setExcelFolders(folders) {
    const row = meta.data.connectors.excel || { approvedAt: null, enabled: false };
    meta.setConnector('excel', { ...row, folders: (folders || []).filter(x => typeof x === 'string') });
  }
  async function changeExcelFolders(folders) {
    const next = (folders || []).filter(x => typeof x === 'string');
    const cur = folderList('excel');
    if (cur.length === next.length && cur.every((f, i) => f === next[i])) return { ok: true, unchanged: true };
    const card = cardExcelFolders(next);
    let ans;
    try { ans = await approve(secrets.maskDeep(card)); } catch (e) { return { ok: false, error: secrets.mask(e && e.message) }; }
    if (!ans || ans.ok !== true) return { ok: false, canceled: !(ans && ans.timeout), timeout: !!(ans && ans.timeout) };
    setExcelFolders(next);
    return { ok: true, folders: next };
  }
  async function setUserSecret(name, key, value, bag) {
    const keyName = String(key || '').trim();
    if (!keyName) return { ok: false, error: 'Thiếu tên khoá.' };
    const which = bag === 'headers' ? 'headers' : 'env';
    const cfg = JSON.parse(JSON.stringify(mcp.config() || { mcpServers: {} }));
    const def = cfg.mcpServers && cfg.mcpServers[name];
    if (!def) return { ok: false, error: 'Không có máy chủ này.' };
    const live = meta.server(name);
    const before = live ? { ...live } : null;
    const id = `mcp:${safeName(name)}:${keyName}`;
    def[which] = def[which] && typeof def[which] === 'object' && !Array.isArray(def[which]) ? def[which] : {};
    const text = value == null ? '' : String(value);
    if (!text) { delete def[which][keyName]; secrets.forget(id); }
    else { secrets.put(id, text); def[which][keyName] = secretPlaceholder(id); }
    const saved = await saveJson(JSON.stringify(cfg));
    if (!saved.ok) return saved;
    if (before) {
      const nowDef = (mcp.config().mcpServers || {})[name] || def;
      const cur = meta.server(name) || {};
      meta.setServer(name, { ...cur, catalogId: before.catalogId, approvedAt: before.approvedAt, autoStart: !!before.autoStart, probedAt: before.probedAt || null, displayName: before.displayName, fp: fingerprint(nowDef), secretFp: before.secretFp || null });
    }
    return { ok: true, id, removed: !text };
  }
  function setDisplayName(name, label) {
    const rec = meta.server(name);
    if (!rec) return { ok: false, error: 'Không có máy chủ này.' };
    if (label == null) { meta.setServer(name, { ...rec, displayName: null }); return { ok: true, displayName: null }; }
    const text = String(label).trim();
    if (!text) return { ok: false, error: 'Tên hiển thị không được để trống.' };
    if (text === name) { meta.setServer(name, { ...rec, displayName: null }); return { ok: true, displayName: null }; }
    meta.setServer(name, { ...rec, displayName: text.slice(0, 80) });
    return { ok: true, displayName: text.slice(0, 80) };
  }
  async function startAuto() {
    await seal();
    upgradeOnce();
    if (!agentEnabled()) return [];
    const servers = (mcp.config().mcpServers || {});
    const names = [];
    for (const [name, def] of Object.entries(servers)) {
      if (!def || def.disabled || isExcelServer(def)) continue;
      const rec = meta.server(name);
      if (rec && rec.autoStart && rec.approvedAt) { names.push(name); mcp.start(name).catch(() => {}); }
    }
    return names;
  }
  async function ensureLazy() {
    if (!agentEnabled()) return [];
    const servers = (mcp.config().mcpServers || {});
    const names = [];
    for (const [name, def] of Object.entries(servers)) {
      if (!def || def.disabled || isExcelServer(def) || def.auth != null) continue;
      const rec = meta.server(name);
      if (!rec || !rec.approvedAt) continue;
      let st = null;
      try { st = mcp.status(name); } catch { st = null; }
      if (st && st.state !== 'off') continue;
      names.push(name);
      try { await mcp.start(name); } catch (e) { say(`${name}: lỗi\n${e && e.stack || e}`); }
    }
    return names;
  }
  function connectorsForAgent() {
    if (!agentEnabled()) return {};
    const view = connectorView();
    const out = {};
    for (const [id, row] of Object.entries(view)) if (row.enabled && row.approved) out[id] = row;
    return out;
  }
  function connectorView() {
    const pausedByMaster = !agentEnabled();
    const out = {};
    for (const id of ['biz', 'excel']) {
      const row = meta.data.connectors[id];
      const approved = !!(row && row.approvedAt);
      const enabled = !!(row && row.enabled);
      out[id] = { id, approved, enabled, pausedByMaster, state: !approved ? 'available' : enabled ? 'waiting' : 'off' };
      if (id === 'excel') {
        out[id].folders = folderList('excel');
        out[id].folderNames = out[id].folders.map(f => path.basename(f) || f);
      }
    }
    return out;
  }
  async function probeImported(names) {
    const out = [];
    for (const name of names || []) {
      const rec = meta.server(name);
      if (!rec || !rec.approvedAt) { out.push({ name, ok: false, error: 'Hãy cho phép kết nối trước khi chạy thử.' }); continue; }
      const probed = await probeServer(name);
      out.push({ name, ...probed });
    }
    return out;
  }
  return {
    secrets, meta, seal, upgradeOnce, saveJson, startServer, toggle, addPreset, setAutostart,
    connectConnector, disconnectConnector, setExcelFolders, changeExcelFolders, setDisplayName, setUserSecret, probeServer, probeImported, startAuto, ensureLazy, connectorsForAgent, publicPayload, publicServers, connectorView,
    sealAndUpgrade: async () => { await seal(); return upgradeOnce(); },
  };
}

module.exports = {
  createSecretStore, createMetaStore, createPluginGate, extractSecrets, observeSecrets,
  cardMcpConnect, cardAutostart, cardConnector, cardImport, cardReplace, cardExcelFolders, cardVisibleText, checkboxLabel,
  connectDanger, unpinned, kindOf, fingerprint, isSecret, isSecretName, looksLikeSecretValue, secretKeyNames,
  qaDenies, commandInDetails, CARD_STRINGS, KEYCHAIN_OK, KEYCHAIN_NO, MCP_WARN,
  BIZ_READ, BIZ_WRITE, BIZ_DANGER, EXCEL_WRITE, SOON, storageSecure,
};
