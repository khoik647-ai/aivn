'use strict';
// Bí mật MCP, plugins-meta.json, và thẻ xin phép (mục 15, PR 2).
// Không có HTML cửa hàng. Không ghi giá trị bí mật ra nhật ký, IPC, thẻ, hay câu lỗi.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mcpMod = require('./mcp');

const { safeName, classifyUrl, claimCatalogId, isExcelServer, validate, presets, secretIdOf, secretPlaceholder } = mcpMod;

// Tên bí mật là QUY TẮC theo từ, không theo danh sách khoá đã biết.
// Tách camelCase rồi tách tiếp trên ký tự không phải chữ. Từ đúng, hoặc hậu tố khi tên không tách được.
const SECRET_WORDS = new Set([
  'key', 'apikey', 'token', 'secret', 'pass', 'password', 'passwd', 'pwd',
  'auth', 'authorization', 'authentication', 'bearer', 'credential', 'credentials',
  'cookie', 'session', 'jwt', 'pat', 'dsn', 'private', 'signature', 'sig',
  'otp', 'totp', 'pin', 'appid',
]);
const SECRET_SUFFIXES = ['password', 'secret', 'token', 'pass', 'key'];
const SECRET_VALUE = /^(?:sk-|sk_|ghp_|github_pat_|hf_|AKIA[0-9A-Z]{16}|xox[baprs]-)/;
const BEARER_VALUE = /^bearer\s+\S/i;
const JWT_VALUE = /^(?:eyJ[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{20,})\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
const PEM_VALUE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/;
const FILE_EXT = /\.(?:gguf|bin|json|ya?ml|txt|safetensors|md|png|jpe?g|gif|webp|onnx|pt|pth|ckpt|ggml|pdf|csv|tsv|xml|html?|log|toml|ini|cfg)$/i;
const SOON = ['zalo', 'gmail', 'drive', 'calendar', 'notion'];
const BIZ_READ = ['listStock', 'getPicking', 'listPickings', 'getOrder', 'listOrders', 'getInvoice', 'listInvoices', 'salesReport', 'invoiceReport', 'stockReport', 'overview'];
const BIZ_WRITE = ['createReceipt', 'setDone', 'validatePicking', 'adjustStock', 'sendQuote', 'confirmOrder', 'resetToQuote', 'saveInvoice', 'invoiceOrder', 'postInvoice', 'resetInvoice'];
const BIZ_DANGER = ['cancelPicking', 'cancelOrder', 'cancelInvoice', 'registerPayment', 'creditNote', 'deleteInvoice'];
const EXCEL_WRITE = ['excel_write_to_sheet', 'excel_create_table', 'excel_copy_sheet', 'excel_format_range'];
const QA_DENY = ['connector_connect', 'mcp_connect', 'mcp_import', 'mcp_replace', 'excel_folders', ...BIZ_DANGER.map(n => 'biz_' + n)];

const KEYCHAIN_OK = 'Khoá được mã hoá bằng kho khoá của hệ điều hành và không bao giờ hiện lại hay ghi vào nhật ký.';
const KEYCHAIN_NO = 'Máy này không có kho khoá an toàn của hệ điều hành: khoá chỉ giữ trong bộ nhớ đến khi thoát AIVN (không ghi ra đĩa).';
const MASTER_OFF = 'Công tắc “Cho AIVN AGENT dùng các ứng dụng đã kết nối” đang tắt. AIVN sẽ kết nối khi bạn bật công tắc.';
const SAVED_PAUSED = 'Đã lưu. Sẽ kết nối khi bạn bật “Cho AIVN AGENT dùng các ứng dụng đã kết nối”.';
const MEMORY_TITLE = 'Sổ tay agent';
const MEMORY_DESC = 'Sổ tay riêng của AIVN AGENT, nằm trong ứng dụng này. Không phải tính năng Ghi nhớ của AIVN và không ghi vào đó.';
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
const UNPINNED_NPX = 'Lệnh này không ghim phiên bản. npx có thể tải mã mới từ internet.';
const UNPINNED_UVX = 'Lệnh này không ghim phiên bản. uvx có thể tải mã mới từ internet.';
const UNPINNED_DOCKER = 'Lệnh này không ghim phiên bản. docker pull có thể tải mã mới từ internet.';
const NOT_MOVED = 'Chưa chuyển khoá vào kho bảo mật. Chưa lưu mcp.json.';
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
  UNPINNED_NPX,
  UNPINNED_UVX,
  UNPINNED_DOCKER,
  NOT_MOVED,
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
  MASTER_OFF,
  SAVED_PAUSED,
];

function nameWords(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .map(w => w.toLowerCase())
    .filter(Boolean);
}
function flatWords(name) {
  return String(name || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
}
function joinedSuffix(word) {
  for (const suf of SECRET_SUFFIXES) {
    if (word.length <= suf.length || !word.endsWith(suf)) continue;
    if (word === suf + 's') continue;
    return true;
  }
  return false;
}
function isSecretName(name) {
  const words = nameWords(name);
  if (words.some(w => SECRET_WORDS.has(w))) return true;
  const flat = flatWords(name);
  if (flat.some(w => SECRET_WORDS.has(w))) return true;
  if (words.length === 1 && joinedSuffix(words[0])) return true;
  if (flat.length === 1 && joinedSuffix(flat[0])) return true;
  return false;
}
function looksLikeSecretValue(v) {
  return typeof v === 'string' && v !== '' && (SECRET_VALUE.test(v) || BEARER_VALUE.test(v) || JWT_VALUE.test(v) || PEM_VALUE.test(v));
}
// Khoá AWS thường dài 40 ký tự. Mẫu QA dài 39. Chỉ tính khi cùng máy chủ có AKIA. Đường dẫn bắt đầu bằng / không phải.
function looksLikeAwsSecret(v) {
  return typeof v === 'string' && /^[A-Za-z0-9/+]{39,40}$/.test(v) && /[/+]/.test(v) && !v.startsWith('/');
}
function likelySecretValue(v) {
  if (looksLikeSecretValue(v)) return true;
  if (typeof v !== 'string' || secretIdOf(v)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return false;
  if (FILE_EXT.test(v)) return false;
  if (v.length < 20 || v.length > 500) return false;
  if (/[\s"'\\]/.test(v) || v.startsWith('-') || v.startsWith('.')) return false;
  if (v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v)) return false;
  if (/@\d+\.\d+\.\d+/.test(v)) return false;
  if (v.includes('/')) return false;
  const core = v.replace(/[-_.=+]/g, '');
  if (core.length < 20 || new Set(core).size < 8) return false;
  // Hex 32 ký tự là khoá. Hex 40 là git sha, hex 64 là sha256: không tự chuyển, kể cả khi có chữ hoa.
  if (/^[0-9a-f]+$/i.test(core)) return core.length >= 32 && core.length !== 40 && core.length !== 64;
  return /[a-z]/.test(core) && /[A-Z]/.test(core) && /\d/.test(core);
}
function isBenignLiteral(v) {
  return typeof v === 'string' && /^(none|null|false|true|off|no|yes|default)$/i.test(v);
}
function isFilePathName(name) {
  const words = nameWords(name);
  if (!words.length) return false;
  const last = words[words.length - 1];
  return last === 'file' || last === 'path';
}
function looksLikePath(v) {
  if (typeof v !== 'string' || v === '') return false;
  if (v.startsWith('/') || v.startsWith('~/') || v.startsWith('./') || v.startsWith('../') || v.startsWith('.\\') || v.startsWith('..\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(v)) return true;
  if (/^[A-Za-z0-9+/]+=*$/.test(v) && !v.startsWith('/')) return false;
  return /[/\\][^/\\]+/.test(v);
}
function valueMaskable(name, value) {
  if (typeof value !== 'string' || value === '') return false;
  if (isBenignLiteral(value)) return false;
  if (/^\d+$/.test(value)) return value.length >= 8;
  if (isFilePathName(name) && looksLikePath(value)) return false;
  return true;
}
function b64JsonSecrets(v) {
  if (typeof v !== 'string' || v.length < 16 || v.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(v)) return null;
  let raw;
  try { raw = Buffer.from(v, 'base64'); } catch { return null; }
  if (!raw.length) return null;
  const back = raw.toString('base64').replace(/=+$/, '');
  if (back !== v.replace(/=+$/, '')) return null;
  const text = raw.toString('utf8');
  if (!text || text.includes('\uFFFD') || text === v) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  const inners = [];
  (function walk(val, key) {
    if (typeof val === 'string') {
      if (key && valueLooksSecret(key, val)) inners.push(val);
      return;
    }
    if (Array.isArray(val)) val.forEach((item, i) => walk(item, String(i)));
    else if (val && typeof val === 'object') for (const [k, item] of Object.entries(val)) walk(item, k);
  })(parsed, '');
  return inners.length ? inners : null;
}
function valueLooksSecret(name, value) {
  if (typeof value !== 'string' || value === '' || isRedactedValue(value)) return false;
  if (isSecretName(name)) return valueMaskable(name, value);
  if (isBenignLiteral(value)) return false;
  if (likelySecretValue(value)) return true;
  if (looksLikeAwsSecret(value) && value.length === 40) return true;
  return false;
}
function isSecret(name, value) {
  if (valueLooksSecret(name, value)) return true;
  return !!b64JsonSecrets(value);
}
function isSecretQueryName(name) {
  let n = String(name || '');
  try { n = decodeURIComponent(n); } catch { /* giữ tên gốc */ }
  return n !== '' && isSecretName(n);
}
function decodePart(v) {
  try { return decodeURIComponent(String(v)); } catch { return String(v); }
}
function isRedactedValue(v) {
  return v == null || v === '' || String(v).includes('${secret:') || /^[•*]+$/.test(String(v));
}
function sanitizeSlot(name) {
  const s = String(name || 'secret').replace(/:/g, '').replace(/[^A-Za-z0-9_-]/g, '');
  return s || 'secret';
}
function slotFromPlaceholder(v, fallback) {
  const m = /\$\{secret:([^}]+)\}/.exec(String(v || ''));
  const slot = m ? String(m[1]).split(':').pop() : '';
  return slot || fallback;
}
// Giá trị query và mật khẩu userinfo. Placeholder ${secret:} và dấu che giữ nguyên.
function urlSecretSpans(text) {
  const s = String(text || '');
  const spans = [];
  let m;
  const teleRe = /\/bot(\d{6,}):([A-Za-z0-9_-]{20,})/g;
  while ((m = teleRe.exec(s))) {
    const value = m[2];
    const start = m.index + m[0].length - value.length;
    const end = start + value.length;
    if (isRedactedValue(value)) spans.push({ start, end, already: true, slotHint: slotFromPlaceholder(value, 'telegram') });
    else spans.push({ start, end, already: false, slotHint: 'telegram', value, note: [value] });
  }
  const userRe = /([a-z][a-z0-9+.-]*:\/\/)([^/?#@]*?):([^/?#@]*)@/gi;
  while ((m = userRe.exec(s))) {
    const value = m[3];
    const start = m.index + m[1].length + m[2].length + 1;
    const end = start + value.length;
    if (!value) continue;
    if (isRedactedValue(value)) spans.push({ start, end, already: true, slotHint: slotFromPlaceholder(value, 'userinfo') });
    else {
      const decoded = decodePart(value);
      spans.push({ start, end, already: false, slotHint: 'userinfo', value: decoded, note: decoded === value ? [decoded] : [decoded, value] });
    }
  }
  const bareUserRe = /([a-z][a-z0-9+.-]*:\/\/)([^:/?#@]+)@/gi;
  while ((m = bareUserRe.exec(s))) {
    const value = m[2];
    const start = m.index + m[1].length;
    const end = start + value.length;
    if (!value || isRedactedValue(value)) continue;
    const decoded = decodePart(value);
    spans.push({ start, end, already: false, slotHint: 'userinfo', value: decoded, note: decoded === value ? [decoded] : [decoded, value] });
  }
  const slackRe = /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/([A-Za-z0-9]+)/g;
  while ((m = slackRe.exec(s))) {
    const value = m[1];
    const start = m.index + m[0].length - value.length;
    const end = start + value.length;
    if (!value || isRedactedValue(value)) continue;
    spans.push({ start, end, already: false, slotHint: 'slack', value, note: [value] });
  }
  const discordRe = /discord(?:app)?\.com\/api\/webhooks\/\d+\/([A-Za-z0-9_-]+)/g;
  while ((m = discordRe.exec(s))) {
    const value = m[1];
    const start = m.index + m[0].length - value.length;
    const end = start + value.length;
    if (!value || isRedactedValue(value)) continue;
    spans.push({ start, end, already: false, slotHint: 'discord', value, note: [value] });
  }
  const pwRe = /(?:password|pwd)\s*=\s*([^;\s&#]+)/gi;
  while ((m = pwRe.exec(s))) {
    const value = m[1];
    const start = m.index + m[0].length - value.length;
    const end = start + value.length;
    if (!value) continue;
    if (isRedactedValue(value)) spans.push({ start, end, already: true, slotHint: slotFromPlaceholder(value, 'password') });
    else spans.push({ start, end, already: false, slotHint: 'password', value, note: [value] });
  }
  const qRe = /([?&#])([^=&#\s]+)=([^&#\s]*)/g;
  while ((m = qRe.exec(s))) {
    const rawName = m[2];
    const value = m[3];
    const start = m.index + m[1].length + rawName.length + 1;
    const end = start + value.length;
    let name = rawName;
    try { name = decodeURIComponent(rawName); } catch { /* giữ tên gốc */ }
    if (!isSecretQueryName(name) || !value) continue;
    if (isRedactedValue(value)) spans.push({ start, end, already: true, slotHint: slotFromPlaceholder(value, sanitizeSlot(name)) });
    else {
      const decoded = decodePart(value);
      spans.push({ start, end, already: false, slotHint: sanitizeSlot(name), value: decoded, note: decoded === value ? [decoded] : [decoded, value] });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const out = [];
  let last = -1;
  for (const sp of spans) {
    if (sp.start < last) continue;
    out.push(sp);
    last = sp.end;
  }
  return out;
}
function maskUrlSecrets(text) {
  const s = text == null ? '' : String(text);
  const spans = urlSecretSpans(s).filter(sp => !sp.already);
  let out = s;
  for (const sp of spans.sort((a, b) => b.start - a.start)) out = out.slice(0, sp.start) + '••••' + out.slice(sp.end);
  return out;
}
function splitFlag(a) {
  if (typeof a !== 'string' || secretIdOf(a) || !a.startsWith('-')) return null;
  const body = a.replace(/^-+/, '');
  const eq = body.indexOf('=');
  if (eq < 0) return { name: body, value: null, hasEq: false };
  return { name: body.slice(0, eq), value: body.slice(eq + 1), hasEq: true };
}
function isSecretFlagName(name) {
  const n = String(name || '');
  if (/^k$/i.test(n)) return true;
  return isSecretName(n);
}
function isRealFlag(a) {
  return typeof a === 'string' && (a.startsWith('--') || /^-[A-Za-z]$/.test(a));
}
function parseAssign(text) {
  const s = String(text || '');
  const eq = s.indexOf('=');
  if (eq <= 0) return null;
  return { name: s.slice(0, eq), value: s.slice(eq + 1) };
}
function isEnvFlag(a) {
  const f = splitFlag(a);
  return !!(f && !f.hasEq && /^(e|env)$/i.test(f.name));
}
function mysqlish(def) {
  const args = def && Array.isArray(def.args) ? def.args.map(a => String(a)) : [];
  const cmd = String(def && def.command || '');
  if (/\bmysql\b/i.test(cmd) || args.some(a => /\bmysql\b/i.test(a))) return true;
  return args.some(a => a === '-u' || /^--user(?:$|=)/i.test(a) || /^-u.+/.test(a));
}
function flaggedValueIsSecret(name, value) {
  if (typeof value !== 'string' || value === '' || isRedactedValue(value)) return false;
  if (isSecretFlagName(name)) return valueMaskable(name, value) || likelySecretValue(value);
  return likelySecretValue(value) || (looksLikeAwsSecret(value) && value.length === 40);
}
function isBareSecretFlag(a) {
  const f = splitFlag(a);
  return !!(f && !f.hasEq && f.name && isSecretFlagName(f.name));
}
function isHeaderFlag(a) {
  const f = splitFlag(a);
  return !!(f && !f.hasEq && /^(h|header)$/i.test(f.name));
}
function splitHeaderValue(a) {
  const m = /^([A-Za-z0-9-]+)(\s*:\s*)(\S[\s\S]*)$/.exec(String(a || ''));
  if (!m) return null;
  const start = m[1].length + m[2].length;
  return { name: m[1], value: m[3], valueStart: start, valueEnd: start + m[3].length };
}
function headerValueIsSecret(name, value) {
  if (!value || isRedactedValue(value)) return false;
  return isSecret(name, value);
}
function serverHasAkia(def) {
  return /AKIA[0-9A-Z]{16}/.test(JSON.stringify(def || {}));
}
// Một danh sách cho hộp thoại, lần chuyển, và dòng Khoá bí mật trên thẻ.
function secretFindings(def) {
  const out = [];
  const used = new Set();
  const akia = serverHasAkia(def);
  function claim(base) {
    let s = sanitizeSlot(base);
    if (!used.has(s)) { used.add(s); return s; }
    let i = 2;
    while (used.has(s + i)) i++;
    const n = s + i;
    used.add(n);
    return n;
  }
  function addAlready(slot, loc) { out.push({ slot: claim(slot), already: true, loc }); }
  function addNew(slot, value, loc, span, note) {
    const notes = (note || [value]).filter(x => typeof x === 'string' && x !== '');
    out.push({ slot: claim(slot), already: false, value, loc, span: span || null, note: notes });
  }
  function addSpans(text, loc) {
    for (const sp of urlSecretSpans(text)) {
      if (sp.already) addAlready(sp.slotHint, loc);
      else addNew(sp.slotHint, sp.value, loc, { start: sp.start, end: sp.end }, sp.note);
    }
  }
  function valueIsSecret(name, value) {
    if (typeof value !== 'string' || value === '' || isRedactedValue(value)) return false;
    if (isSecret(name, value)) return true;
    return !!(akia && looksLikeAwsSecret(value));
  }
  function notesFor(value) {
    const notes = [];
    if (typeof value === 'string' && value) notes.push(value);
    const inner = b64JsonSecrets(value);
    if (inner) for (const x of inner) if (x && !notes.includes(x)) notes.push(x);
    return notes;
  }
  function considerString(text, loc, keyName) {
    if (typeof text !== 'string' || text === '') return;
    const whole = secretIdOf(text);
    if (whole && !loc.index && loc.type !== 'arg') {
      addAlready(keyName || String(whole).split(':').pop() || 'secret', loc);
      return;
    }
    if (valueIsSecret(keyName, text)) { addNew(keyName || 'secret', text, loc, null, notesFor(text)); return; }
    addSpans(text, loc);
  }
  for (const bag of ['env', 'headers']) {
    const obj = def && def[bag];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    for (const [k, v] of Object.entries(obj)) {
      const loc = { type: bag === 'headers' ? 'header' : 'env', key: k };
      if (secretIdOf(v)) { addAlready(k, loc); continue; }
      if (typeof v !== 'string' || v === '') continue;
      if (valueIsSecret(k, v)) addNew(k, v, loc, null, notesFor(v));
      else addSpans(v, loc);
    }
  }
  const args = def && Array.isArray(def.args) ? def.args : [];
  const mysql = mysqlish(def);
  args.forEach((a, i) => {
    if (typeof a !== 'string') return;
    const loc = { type: 'arg', index: i };
    const whole = secretIdOf(a);
    if (whole) {
      const slot = String(whole).split(':').pop();
      addAlready(/^arg\d+$/.test(slot) ? slot : 'arg' + i, loc);
      return;
    }
    const flag = splitFlag(a);
    if (flag && flag.hasEq && /^(e|env)$/i.test(flag.name)) {
      const ev = parseAssign(flag.value);
      if (ev && ev.value && !isRedactedValue(ev.value) && valueIsSecret(ev.name, ev.value)) {
        const start = a.length - ev.value.length;
        addNew(sanitizeSlot(ev.name), ev.value, loc, { start, end: a.length }, notesFor(ev.value));
        return;
      }
    }
    if (flag && flag.hasEq && /^(h|header)$/i.test(flag.name)) {
      const h = splitHeaderValue(flag.value);
      if (h && isRedactedValue(h.value)) { addAlready(slotFromPlaceholder(h.value, sanitizeSlot(h.name)), loc); return; }
      if (h && headerValueIsSecret(h.name, h.value)) {
        const start = a.length - flag.value.length + h.valueStart;
        addNew(sanitizeSlot(h.name), h.value, loc, { start, end: start + h.value.length }, notesFor(h.value));
        return;
      }
    }
    if (flag && flag.hasEq) {
      if (flag.value && String(flag.value).includes('${secret:')) {
        addAlready(slotFromPlaceholder(flag.value, 'arg' + i), loc);
        return;
      }
      if (flag.value && !isRedactedValue(flag.value) && (flaggedValueIsSecret(flag.name, flag.value) || (akia && looksLikeAwsSecret(flag.value)))) {
        const notes = flag.value === a ? notesFor(a) : [a, ...notesFor(flag.value)];
        addNew('arg' + i, a, loc, null, notes);
        return;
      }
    }
    if (mysql && /^-[pP](.+)$/.test(a) && !a.startsWith('--')) {
      const val = a.slice(2);
      if (val && !isRealFlag(a) && valueIsSecret('password', val)) {
        addNew('password', val, loc, { start: 2, end: a.length }, [val]);
        return;
      }
    }
    if (i > 0 && isEnvFlag(args[i - 1]) && !isRealFlag(a)) {
      const ev = parseAssign(a);
      if (ev && ev.value && valueIsSecret(ev.name, ev.value)) {
        addNew(sanitizeSlot(ev.name), ev.value, loc, { start: ev.name.length + 1, end: a.length }, notesFor(ev.value));
        return;
      }
    }
    if (i > 0 && args[i - 1] === '-p' && mysql && !isRealFlag(a) && valueIsSecret('password', a)) {
      addNew('password', a, loc, null, [a]);
      return;
    }
    if (i > 0 && isHeaderFlag(args[i - 1]) && !isRealFlag(a)) {
      const h = splitHeaderValue(a);
      if (h && isRedactedValue(h.value)) { addAlready(slotFromPlaceholder(h.value, sanitizeSlot(h.name)), loc); return; }
      if (h && headerValueIsSecret(h.name, h.value)) {
        addNew(sanitizeSlot(h.name), h.value, loc, { start: h.valueStart, end: h.valueEnd }, notesFor(h.value));
        return;
      }
    }
    if (i > 0 && isBareSecretFlag(args[i - 1]) && !isRealFlag(a) && a !== '' && flaggedValueIsSecret(splitFlag(args[i - 1]).name, a)) {
      addNew('arg' + i, a, loc, null, notesFor(a));
      return;
    }
    if (i >= 2 && /^--api$/i.test(args[i - 2]) && /^key$/i.test(String(args[i - 1])) && !isRealFlag(a) && valueIsSecret('key', a)) {
      addNew('arg' + i, a, loc, null, notesFor(a));
      return;
    }
    if (valueIsSecret('', a) || (akia && looksLikeAwsSecret(a))) { addNew('arg' + i, a, loc, null, notesFor(a)); return; }
    addSpans(a, loc);
  });
  if (def && typeof def.url === 'string' && def.url) {
    const loc = { type: 'url' };
    const whole = secretIdOf(def.url);
    if (whole) addAlready(String(whole).split(':').pop() || 'url', loc);
    else if (valueIsSecret('url', def.url)) addNew('url', def.url, loc, null, [def.url]);
    else addSpans(def.url, loc);
  }
  if (def && typeof def === 'object') {
    for (const [k, v] of Object.entries(def)) {
      if (k === 'env' || k === 'headers' || k === 'args' || k === 'url') continue;
      walkNested(v, [k]);
    }
  }
  function walkNested(value, path) {
    if (typeof value === 'string') {
      considerString(value, { type: 'path', path: path.slice() }, String(path[path.length - 1]));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walkNested(item, path.concat(i)));
      return;
    }
    if (value && typeof value === 'object') {
      if (secretIdOf(value)) { addAlready(String(path[path.length - 1] || 'secret'), { type: 'path', path: path.slice() }); return; }
      for (const [k, v] of Object.entries(value)) walkNested(v, path.concat(k));
    }
  }
  return out;
}
function pullTool(def) {
  if (!def || def.url) return '';
  const base = String(def.command || '').toLowerCase().replace(/\.(cmd|exe)$/, '');
  const args = (Array.isArray(def.args) ? def.args : []).map(a => String(a).toLowerCase());
  if (base === 'npx' || args.includes('npx')) return 'npx';
  if (base === 'uvx' || args.includes('uvx')) return 'uvx';
  const docker = base === 'docker' || args[0] === 'docker';
  if (docker && args.includes('pull')) return 'docker pull';
  return '';
}
function pullsCode(def) { return pullTool(def) !== ''; }
function unpinnedLine(def) {
  const tool = pullTool(def);
  if (tool === 'npx') return UNPINNED_NPX;
  if (tool === 'uvx') return UNPINNED_UVX;
  if (tool === 'docker pull') return UNPINNED_DOCKER;
  return '';
}
function catalogTitle(name, def) {
  if (name === 'memory' || claimCatalogId(def) === 'memory') return MEMORY_TITLE;
  return '';
}
function explainProbeError(message) {
  const raw = String(message || '');
  if (!raw) return '';
  if (raw === PROBE_TIMEOUT || raw === PROBE_MISSING || raw === PROBE_KEY || raw === PROBE_NET || raw === PROBE_OTHER) return raw;
  if (/thời gian chạy thử|Quá 60 giây|timeout/i.test(raw)) return PROBE_TIMEOUT;
  if (/Không giải được khoá|khoá bí mật/i.test(raw)) return PROBE_KEY;
  if (/ENOENT|not found|không tìm thấy|spawn |không có lệnh/i.test(raw)) return PROBE_MISSING;
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|không tới|network|getaddrinfo/i.test(raw)) return PROBE_NET;
  return PROBE_OTHER;
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

function maskAwsAdjacent(text) {
  const s = text == null ? '' : String(text);
  return s.replace(/(^|[^A-Za-z0-9/+])([A-Za-z0-9/+]{39,40})(?![A-Za-z0-9/+])/g, (m, pre, body, offset) => {
    if (!looksLikeAwsSecret(body)) return m;
    if (body.length === 39) {
      const lo = Math.max(0, offset - 96);
      const hi = Math.min(s.length, offset + m.length + 96);
      if (!/akia|aws|secret/i.test(s.slice(lo, hi))) return m;
    }
    return pre + '••••';
  });
}
function maskHexRuns(text) {
  return String(text).replace(/\b[0-9a-f]{32,}\b/gi, (m, offset, str) => {
    if (m.length === 64) return m;
    if (m.length === 40) {
      const lo = Math.max(0, offset - 96);
      const hi = Math.min(str.length, offset + m.length + 96);
      if (!/aws|secret|akia/i.test(str.slice(lo, hi))) return m;
    }
    return '••••';
  });
}
function maskAssignments(text) {
  let s = String(text);
  const mysql = /\bmysql\b|(^|\s)-u(\s|=|$)/i.test(s);
  s = s.replace(/(^|[\s"'`=])([A-Za-z_][\w.-]{0,80})=([^\s"'`&]*)/g, (m, pre, name, value) => {
    if (!value || isRedactedValue(value)) return m;
    if (!valueLooksSecret(name, value) && !b64JsonSecrets(value)) return m;
    return pre + name + '=' + '••••';
  });
  s = s.replace(/(^|[\s])(--?[A-Za-z][\w.-]*)(=|\s+)(\S+)/g, (m, pre, flag, sep, value) => {
    const fname = flag.replace(/^-+/, '');
    if (!value || isRedactedValue(value)) return m;
    if (/^(e|env)$/i.test(fname)) {
      const ev = parseAssign(value);
      if (ev && ev.value && !isRedactedValue(ev.value) && (valueLooksSecret(ev.name, ev.value) || b64JsonSecrets(ev.value))) {
        return pre + flag + sep + ev.name + '=' + '••••';
      }
    }
    if (sep !== '=' && isRealFlag(value)) return m;
    if (/^p$/i.test(fname) && sep !== '=' && mysql && !isBenignLiteral(value)) return pre + flag + sep + '••••';
    if (!flaggedValueIsSecret(fname, value)) return m;
    return pre + flag + sep + '••••';
  });
  if (mysql) s = s.replace(/(^|\s)-p(\S+)/gi, (m, pre, val) => (val && !isRedactedValue(val) ? pre + '-p••••' : m));
  s = s.replace(/(^|\s)(--api)(\s+)(key)(\s+)(\S+)/gi, (m, pre, a, s1, k, s2, val) => {
    if (!val || isRealFlag(val) || isRedactedValue(val) || isBenignLiteral(val)) return m;
    return pre + a + s1 + k + s2 + '••••';
  });
  s = s.replace(/"([A-Za-z][A-Za-z0-9_-]*)"\s*:\s*"([^"]*)"/g, (m, name, value) => {
    if (!value || isRedactedValue(value) || !headerValueIsSecret(name, value)) return m;
    const i = m.lastIndexOf('"' + value + '"');
    if (i < 0) return m;
    return m.slice(0, i + 1) + '••••' + m.slice(i + 1 + value.length);
  });
  s = s.replace(/(^|[^\w"'-])([A-Za-z][A-Za-z0-9-]*)(\s*:\s*)(\S+(?:\s+\S+)?)/g, (m, pre, name, sep, value) => {
    if (!value || isRedactedValue(value)) return m;
    if (!headerValueIsSecret(name, value) && !headerValueIsSecret(name, value.split(/\s+/)[0])) return m;
    return pre + name + sep + '••••';
  });
  return s;
}
function maskKnownSecrets(text) {
  let s = text == null ? '' : String(text);
  s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '••••');
  s = s.replace(/(?:sk-|sk_|ghp_|github_pat_|hf_|xox[baprs]-)[A-Za-z0-9._~+/-]{8,}/g, '••••');
  s = s.replace(/bearer\s+[A-Za-z0-9._~+/-]{4,}/gi, '••••');
  s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, '••••');
  s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '••••');
  s = s.replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '••••');
  s = maskHexRuns(s);
  s = maskAwsAdjacent(s);
  s = s.replace(/(^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{40,}={0,2})(?![A-Za-z0-9+/])/g, (m, pre, body) => {
    if (body.startsWith('/')) return m;
    const mixed = /[a-z]/.test(body) && /[A-Z]/.test(body) && /\d/.test(body);
    if (!mixed && !b64JsonSecrets(body)) return m;
    return pre + '••••';
  });
  s = maskAssignments(s);
  return maskUrlSecrets(s);
}
function createSecretStore({ dir, safeStorage = null } = {}) {
  const file = path.join(dir, 'mcp-secrets.json');
  const mem = new Map();
  const noted = new Set();
  const secure = () => storageSecure(safeStorage);
  function remember(v) {
    if (typeof v !== 'string' || v.length < 4) return;
    noted.add(v);
    const bearer = /^bearer\s+/i.exec(v);
    if (bearer && v.length > bearer[0].length + 4) noted.add(v.slice(bearer[0].length));
  }
  function mask(text) {
    let s = text == null ? '' : String(text);
    const list = [...noted].sort((a, b) => b.length - a.length);
    for (const v of list) if (v && s.includes(v)) s = s.split(v).join('••••');
    return maskKnownSecrets(s);
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
      if (typeof v === 'string' && isSecret(k, v)) { out[k] = '••••'; continue; }
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
function scrubShown(def, secrets) {
  let shown = secrets ? secrets.mask(commandRaw(def)) : maskUrlSecrets(commandRaw(def));
  const notes = [];
  for (const f of secretFindings(def)) {
    if (f.already) continue;
    for (const n of (f.note && f.note.length ? f.note : [f.value])) if (typeof n === 'string' && n.length >= 4) notes.push(n);
  }
  notes.sort((a, b) => b.length - a.length);
  for (const n of notes) if (shown.includes(n)) shown = shown.split(n).join('••••');
  return shown;
}
function secretKeyNames(def) {
  return secretFindings(def).map(f => f.slot);
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
  const pull = unpinnedLine(def);
  if (pull) fields.push(['Phiên bản', pull]);
  if (names.length && secrets && !secrets.secure()) fields.push(['Khoá', secrets.sentence()]);
  const shown = scrubShown(def, secrets);
  const auto = catalogTitle(name, def);
  const custom = typeof displayName === 'string' && displayName.trim() && displayName.trim() !== name ? displayName.trim() : '';
  const label = custom || auto || name;
  if (auto && !custom) fields.push(['Việc', MEMORY_DESC]);
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
  const mask = (d) => scrubShown(d, secrets);
  return {
    tool: 'mcp_replace', title: `Thay thế máy chủ “${name}”?`,
    allowAlways: false, fields: [],
    details: [['Lệnh cũ', mask(oldDef)], ['Lệnh mới', mask(newDef)]],
    warn: REPLACE_WARN, danger: true, note: '',
  };
}

function dig(root, parts) {
  let cur = root;
  for (const p of parts || []) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function locKey(loc) {
  if (!loc) return '';
  if (loc.type === 'path') return 'path:' + JSON.stringify(loc.path || []);
  if (loc.key != null) return loc.type + ':' + loc.key;
  if (loc.index != null) return loc.type + ':' + loc.index;
  return loc.type || '';
}
function locText(def, loc) {
  if (!loc) return '';
  if (loc.type === 'env') return def.env ? def.env[loc.key] : '';
  if (loc.type === 'header') return def.headers ? def.headers[loc.key] : '';
  if (loc.type === 'arg') return Array.isArray(def.args) ? def.args[loc.index] : '';
  if (loc.type === 'url') return def.url;
  if (loc.type === 'path') {
    const v = dig(def, loc.path);
    return typeof v === 'string' ? v : '';
  }
  return '';
}
function locWrite(def, loc, text) {
  if (!loc) return;
  if (loc.type === 'env') def.env[loc.key] = text;
  else if (loc.type === 'header') def.headers[loc.key] = text;
  else if (loc.type === 'arg') def.args[loc.index] = text;
  else if (loc.type === 'url') def.url = text;
  else if (loc.type === 'path' && Array.isArray(loc.path) && loc.path.length) {
    let cur = def;
    for (let i = 0; i < loc.path.length - 1; i++) {
      cur = cur[loc.path[i]];
      if (cur == null) return;
    }
    cur[loc.path[loc.path.length - 1]] = text;
  }
}
function topLevelIsSecret(key, value) {
  if (typeof value !== 'string' || value === '' || secretIdOf(value)) return false;
  if (isSecret(key, value) || looksLikeSecretValue(value)) return true;
  return urlSecretSpans(value).some(sp => !sp.already);
}
function noteExtras(store, value) {
  if (!store || typeof value !== 'string') return;
  const inner = b64JsonSecrets(value);
  if (inner) for (const x of inner) if (x && x !== value) store.note(x);
  for (const sp of urlSecretSpans(value)) if (!sp.already && sp.value && sp.value !== value) store.note(sp.value);
}
function extractSecrets(cfg, store) {
  const next = JSON.parse(JSON.stringify(cfg || {}));
  let count = 0;
  let rewritten = 0;
  function bury(parts, value) {
    const id = 'mcp:global:' + sanitizeSlot(parts.map(p => String(p)).join('_'));
    if (store) {
      store.put(id, value);
      noteExtras(store, value);
    }
    let cur = next;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = secretPlaceholder(id);
    count++;
  }
  function walkTop(node, parts) {
    if (typeof node === 'string') {
      if (!topLevelIsSecret(String(parts[parts.length - 1]), node) && !isSecret(String(parts[parts.length - 1]), node)) return;
      bury(parts, node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walkTop(item, parts.concat(i)));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walkTop(v, parts.concat(k));
    }
  }
  for (const [k, v] of Object.entries(next)) {
    if (k === 'mcpServers') continue;
    if (typeof v === 'string') {
      if (!topLevelIsSecret(k, v)) continue;
      const id = `mcp:global:${sanitizeSlot(k)}`;
      if (store) {
        store.put(id, v);
        noteExtras(store, v);
      }
      delete next[k];
      count++;
      continue;
    }
    if (v && typeof v === 'object') walkTop(v, [k]);
  }
  const servers = next.mcpServers && typeof next.mcpServers === 'object' ? next.mcpServers : {};
  for (const [name, def] of Object.entries(servers)) {
    if (!def || typeof def !== 'object') continue;
    for (const bag of ['env', 'headers']) {
      if (!def[bag] || typeof def[bag] !== 'object' || Array.isArray(def[bag])) continue;
      for (const [k, v] of Object.entries(def[bag])) {
        const old = secretIdOf(v);
        if (old && typeof v === 'object') { def[bag][k] = secretPlaceholder(old); rewritten++; }
      }
    }
    const findings = secretFindings(def);
    const spans = new Map();
    for (const f of findings) {
      if (f.already) continue;
      const id = `mcp:${safeName(name)}:${f.slot}`;
      if (store) {
        store.put(id, f.value);
        for (const extra of f.note || []) if (extra !== f.value) store.note(extra);
      }
      count++;
      if (f.span) {
        const key = locKey(f.loc);
        if (!spans.has(key)) spans.set(key, []);
        spans.get(key).push(f);
      } else locWrite(def, f.loc, secretPlaceholder(id));
    }
    for (const list of spans.values()) {
      list.sort((a, b) => b.span.start - a.span.start);
      let text = String(locText(def, list[0].loc) || '');
      for (const f of list) {
        const id = `mcp:${safeName(name)}:${f.slot}`;
        text = text.slice(0, f.span.start) + secretPlaceholder(id) + text.slice(f.span.end);
      }
      locWrite(def, list[0].loc, text);
    }
  }
  return { cfg: next, count, rewritten };
}
function secretStamp(def, secrets) {
  const parts = [];
  const hash = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');
  const add = (slot, raw) => { if (raw != null && raw !== '') parts.push(slot + '=' + hash(raw)); };
  const walk = (slot, v) => {
    if (typeof v === 'string') {
      const id = secretIdOf(v);
      if (id) { add(slot, secrets && secrets.get(id)); return; }
      const re = /\$\{secret:([^}]+)\}/g;
      let m; let n = 0;
      while ((m = re.exec(v))) { n++; add(slot + '#' + n, (secrets && secrets.get(m[1])) || m[1]); }
      if (n) return;
      if (isSecret(slot, v)) add(slot, v);
      return;
    }
    const id = secretIdOf(v);
    if (id) add(slot, secrets && secrets.get(id));
  };
  for (const bag of ['env', 'headers']) for (const [k, v] of Object.entries((def && def[bag]) || {})) walk(bag + ':' + k, v);
  (def && Array.isArray(def.args) ? def.args : []).forEach((a, i) => walk('arg' + i, a));
  if (def && def.url) walk('url', def.url);
  return crypto.createHash('sha256').update(parts.sort().join('\n')).digest('hex');
}
function observeSecrets(cfg, store) {
  if (!store) return;
  for (const def of Object.values((cfg && cfg.mcpServers) || {})) {
    if (!def || typeof def !== 'object') continue;
    for (const f of secretFindings(def)) {
      if (f.already) continue;
      for (const n of f.note && f.note.length ? f.note : [f.value]) store.note(n);
    }
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
    const cfg = (mcp.config() && mcp.config().mcpServers) || {};
    return (Array.isArray(list) ? list : []).map(s => {
      const masked = secrets.maskDeep(s);
      if (masked && masked.error) masked.hint = explainProbeError(masked.error);
      const rec = meta.server(s.name);
      const auto = catalogTitle(s.name, cfg[s.name]);
      masked.displayName = (rec && rec.displayName) || auto || s.name;
      return masked;
    });
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
    if (!extracted.count && !extracted.rewritten) return 0;
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
    const before = JSON.parse(JSON.stringify((mcp.config() && mcp.config().mcpServers) || {}));
    const rawServers = parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers) ? parsed.mcpServers : {};
    const extracted = extractSecrets(parsed, secrets);
    try {
      await mcp.saveText(JSON.stringify(extracted.cfg));
      reconcile(extracted.cfg.mcpServers || {});
      const importItems = Object.entries(rawServers).filter(([, def]) => def && typeof def === 'object').map(([name, def]) => ({
        name, kind: kindOf(def), commandRedacted: scrubShown(def, secrets), danger: connectDanger(def), def,
      }));
      const importCard = secrets.maskDeep(cardImport(importItems, { secretCount: extracted.count, secretsSecure: secrets.secure() }));
      const replaceCards = [];
      const savedServers = extracted.cfg.mcpServers || {};
      for (const [name, raw] of Object.entries(rawServers)) {
        if (!raw || typeof raw !== 'object' || !before[name] || !savedServers[name]) continue;
        if (commandRaw(before[name]) === commandRaw(savedServers[name])) continue;
        replaceCards.push(secrets.maskDeep(cardReplace(name, before[name], raw, secrets)));
      }
      return { ok: true, servers: publicServers(), secretCount: extracted.count, secretsSecure: secrets.secure(), notice: extracted.count && !secrets.secure() ? KEYCHAIN_NO : null, importCard, replaceCards };
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
    return { ok: false, error: explainProbeError(raw), details: detail };
  }
  async function probeServer(name) {
    if (!agentEnabled()) return { ok: false, paused: true, error: MASTER_OFF, details: '' };
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
    if (!agentEnabled()) return { ok: false, paused: true, error: MASTER_OFF };
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
    if (!agentEnabled()) return { ok: false, paused: true, error: MASTER_OFF };
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
    const label = catalogTitle(name, def) || name;
    const probed = await probeServer(name);
    if (probed.paused) return { ok: true, paused: true, name, label, message: MASTER_OFF };
    return probed.ok ? { ...probed, name, label } : { ...probed, name, label };
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
    return { ok: true, id, removed: !text, persisted: !text || secrets.secure(), notice: text && !secrets.secure() ? KEYCHAIN_NO : null };
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
  function peekSecrets(text) {
    let parsed;
    try { parsed = JSON.parse(String(text)); } catch { return { count: 0 }; }
    try { return { count: extractSecrets(parsed, null).count }; } catch { return { count: 0 }; }
  }
  return {
    secrets, meta, seal, upgradeOnce, saveJson, startServer, toggle, addPreset, setAutostart,
    connectConnector, disconnectConnector, setExcelFolders, changeExcelFolders, setDisplayName, setUserSecret, probeServer, probeImported, startAuto, ensureLazy, connectorsForAgent, publicPayload, publicServers, connectorView, peekSecrets,
    sealAndUpgrade: async () => { await seal(); return upgradeOnce(); },
  };
}

module.exports = {
  createSecretStore, createMetaStore, createPluginGate, extractSecrets, observeSecrets,
  cardMcpConnect, cardAutostart, cardConnector, cardImport, cardReplace, cardExcelFolders, cardVisibleText, checkboxLabel,
  connectDanger, unpinned, kindOf, fingerprint, isSecret, isSecretName, looksLikeSecretValue, secretKeyNames,
  qaDenies, commandInDetails, CARD_STRINGS, KEYCHAIN_OK, KEYCHAIN_NO, MASTER_OFF, SAVED_PAUSED, MCP_WARN,
  explainProbeError, likelySecretValue, pullsCode, catalogTitle, NOT_MOVED, unpinnedLine,
  secretFindings, maskUrlSecrets, maskAwsAdjacent, maskKnownSecrets,
  BIZ_READ, BIZ_WRITE, BIZ_DANGER, EXCEL_WRITE, SOON, storageSecure,
};
