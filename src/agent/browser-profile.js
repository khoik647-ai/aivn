'use strict';
// B153/B154 (máy thật beta.2.7, laptop): trình duyệt người dùng NÊU TÊN (Chrome, Edge…) — mở bằng đúng hồ sơ đang dùng
// (Local State → profile.last_used, tham số --profile-directory), nhận ra màn hình chọn hồ sơ / cửa sổ trống,
// và mở địa chỉ web TRONG trình duyệt đó (không qua “start <url>” / trình duyệt mặc định).
// Lõi thuần (không gọi hệ điều hành trừ khi được truyền fs/env) để kiểm thử.
const path = require('path');

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// thứ tự quan trọng: “google chrome” trước “chrome”
const BROWSERS = [
  { id: 'chrome', name: 'Chrome', brand: 'Google Chrome', proc: 'chrome', exe: 'chrome.exe', re: /(?:google\s+)?chrome(?![\p{L}])/iu,
    userData: ['Google', 'Chrome', 'User Data'], dirs: [['Google', 'Chrome', 'Application']], picker: /who'?s using chrome|ai (?:sẽ|se|đang) (?:sử dụng|dùng) chrome|谁在使用\s*chrome|chọn hồ sơ|choose a profile/iu },
  { id: 'edge', name: 'Microsoft Edge', brand: 'Microsoft Edge', proc: 'msedge', exe: 'msedge.exe', re: /(?:microsoft\s+)?edge(?![\p{L}])/iu,
    userData: ['Microsoft', 'Edge', 'User Data'], dirs: [['Microsoft', 'Edge', 'Application']], picker: /who'?s browsing|ai (?:đang|sẽ) duyệt|ai (?:sẽ|đang) (?:sử dụng|dùng) (?:microsoft )?edge|chọn hồ sơ|choose a profile|谁在浏览/iu },
  { id: 'coccoc', name: 'Cốc Cốc', brand: 'Cốc Cốc', proc: 'browser', exe: 'browser.exe', re: /c[ốo]c\s*c[ốo]c(?![\p{L}])/iu,
    userData: ['CocCoc', 'Browser', 'User Data'], dirs: [['CocCoc', 'Browser', 'Application']], picker: /chọn hồ sơ|choose a profile|who'?s using/iu },
  { id: 'brave', name: 'Brave', brand: 'Brave', proc: 'brave', exe: 'brave.exe', re: /brave(?![\p{L}])/iu,
    userData: ['BraveSoftware', 'Brave-Browser', 'User Data'], dirs: [['BraveSoftware', 'Brave-Browser', 'Application']], picker: /who'?s using brave|ai (?:sẽ|đang) (?:sử dụng|dùng) brave|chọn hồ sơ|choose a profile/iu },
  { id: 'firefox', name: 'Firefox', brand: 'Mozilla Firefox', proc: 'firefox', exe: 'firefox.exe', re: /firefox(?![\p{L}])/iu, userData: null, dirs: [['Mozilla Firefox']], picker: null },
  { id: 'opera', name: 'Opera', brand: 'Opera', proc: 'opera', exe: 'opera.exe', re: /opera(?![\p{L}])/iu, userData: null, dirs: [['Programs', 'Opera']], picker: null },
];
const byId = (id) => BROWSERS.find(b => b.id === id) || null;
// trình duyệt có tên trong câu lệnh (null nếu chỉ nói “trình duyệt” chung chung)
function browserOf(query) {
  const q = String(query || ''); let best = null, at = Infinity;
  for (const b of BROWSERS) { const m = b.re.exec(q); if (m && m.index < at) { best = b; at = m.index; } }
  return best;
}
// tên ứng dụng (ensure_app/open_app) → trình duyệt
function browserOfApp(app) { const k = fold(app).replace(/[^a-z]/g, ''); return BROWSERS.find(b => k === b.id || k === fold(b.brand).replace(/[^a-z]/g, '') || k === fold(b.name).replace(/[^a-z]/g, '') || (k.length >= 5 && fold(b.brand).replace(/[^a-z]/g, '').includes(k))) || null; }

// Local State (JSON) → hồ sơ đang dùng { dir, name }
function lastProfile(localState) {
  let j = localState; if (typeof j === 'string') { try { j = JSON.parse(j); } catch { j = null; } }
  const p = (j && j.profile) || {}; const cache = p.info_cache || {};
  let dir = typeof p.last_used === 'string' && p.last_used.trim() ? p.last_used.trim() : '';
  if (!dir || (Object.keys(cache).length && !cache[dir])) { const act = Array.isArray(p.last_active_profiles) ? p.last_active_profiles.find(x => cache[x]) : null; dir = act || (cache.Default ? 'Default' : Object.keys(cache)[0] || 'Default'); }
  if (!/^(?:Default|Profile \d+|Guest Profile|[\w .-]{1,40})$/.test(dir) || /\.\./.test(dir)) dir = 'Default';
  const info = cache[dir] || {};
  const names = [info.name, info.gaia_given_name, info.gaia_name, info.user_name].filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
  return { dir, name: names[0] || null, names };
}
function userDataDir(b, env = process.env) { if (!b || !b.userData) return null; const base = env.LOCALAPPDATA; return base ? path.win32.join(base, ...b.userData) : null; }
function readProfile(b, { fs = require('fs'), env = process.env } = {}) {
  const ud = userDataDir(b, env); if (!ud) return null;
  try { return { ...lastProfile(fs.readFileSync(path.win32.join(ud, 'Local State'), 'utf8')), userData: ud }; } catch { return { dir: 'Default', name: null, names: [], userData: ud, missing: true }; }
}
// đường dẫn .exe: các thư mục cài phổ biến (Program Files, Program Files (x86), LocalAppData)
function exeCandidates(b, env = process.env) {
  const out = []; for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) { if (!root) continue; for (const d of b.dirs) out.push(path.win32.join(root, ...d, b.exe)); }
  return out;
}
function findExe(b, { fs = require('fs'), env = process.env } = {}) { for (const p of exeCandidates(b, env)) { try { if (fs.existsSync(p)) return p; } catch {} } return null; }
// tham số dòng lệnh: hồ sơ đang dùng (trình duyệt họ Chromium) + địa chỉ (đã chuẩn hoá qua URL)
function launchArgs(b, profile, url) {
  const a = []; if (b && b.userData && profile && profile.dir) a.push(`--profile-directory=${profile.dir}`);
  if (url) { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw new Error('chỉ mở địa chỉ http/https'); a.push(u.href); }
  return a;
}

// màn hình chọn hồ sơ: tiêu đề chỉ là tên trình duyệt (không có “… - Google Chrome”) và chữ trên màn hình là câu hỏi chọn hồ sơ
const PICKER_TXT = /who'?s using|ai (?:sẽ|đang) (?:sử dụng|dùng)|chọn hồ sơ|choose a profile|谁在使用|add profile|thêm hồ sơ|guest mode|chế độ khách|show on startup|hiển thị khi khởi động/iu;
function bareTitle(b, title) { const t = String(title || '').trim(); return !t || fold(t) === fold(b ? b.brand : '') || fold(t) === fold(b ? b.name : '') || /^(?:google chrome|microsoft edge|chrome|edge|cốc cốc)$/iu.test(t); }
function pickerShown(b, title, text) {
  const t = String(text || ''); if (!bareTitle(b, title)) return false;
  if (b && b.picker && b.picker.test(t)) return true;
  const hits = (t.match(new RegExp(PICKER_TXT.source, 'giu')) || []).map(fold); return new Set(hits).size >= 2;
}
// cửa sổ trống: tiêu đề chỉ là tên trình duyệt và gần như không có chữ (không thẻ, không thanh địa chỉ)
function blankShown(b, title, text) { return bareTitle(b, title) && String(text || '').replace(/[\s·]+/g, '').length < 12; }
// phần tử để bấm trên màn hình chọn hồ sơ: tên hồ sơ đang dùng → “Cá nhân 1/Person 1/Default” → ô hồ sơ đầu tiên
function profileTarget(elements, profile) {
  const els = (elements || []).filter(e => e && (e.name || e.value) && Array.isArray(e.b));
  const nm = (e) => fold(e.name || e.value).trim();
  const bad = /^(?:them|add|guest|khach|che do khach|guest mode|hien thi khi khoi dong|show on startup|tuy chinh|customize|dang nhap|sign in)/;
  for (const n of (profile && profile.names) || []) { const k = fold(n); const e = els.find(x => nm(x) === k) || els.find(x => nm(x).includes(k) && !bad.test(nm(x))); if (e) return { el: e, why: `hồ sơ đang dùng “${n}”` }; }
  const def = els.find(x => /^(?:ca nhan 1|person 1|default|mac dinh|nguoi dung 1|user 1|个人 1)$/.test(nm(x)));
  if (def) return { el: def, why: `hồ sơ mặc định “${def.name || def.value}”` };
  return null;
}
// B154: lệnh run_command dùng để MỞ một địa chỉ web (start/Start-Process/explorer/open/xdg-open/rundll32 url.dll, hay gọi thẳng .exe trình duyệt)
const OPENER = /(?:^|[;&|(\s"'])(?:start(?:-process)?|saps|explorer(?:\.exe)?|invoke-item|ii|open|xdg-open|gio\s+open|rundll32(?:\.exe)?\s+url\.dll,\S+|(?:chrome|msedge|firefox|brave|opera|browser|iexplore)(?:\.exe)?)(?=[\s"'])/i;
function urlOpenOf(cmd) {
  const c = String(cmd || ''); const m = /(https?:\/\/[^\s"'`<>|]+|www\.[^\s"'`<>|]+\.[a-z]{2,}[^\s"'`<>|]*)/i.exec(c); if (!m || !OPENER.test(c.slice(0, m.index))) return null;
  let u = m[1].replace(/[),;]+$/, ''); if (/^www\./i.test(u)) u = 'https://' + u; try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
}
module.exports = { urlOpenOf, BROWSERS, byId, browserOf, browserOfApp, lastProfile, userDataDir, readProfile, exeCandidates, findExe, launchArgs, pickerShown, blankShown, bareTitle, profileTarget, fold };
