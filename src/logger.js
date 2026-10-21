// Nhật ký chung của AIVN: ghi ĐỒNG BỘ (không mất khi bộ máy sập) vào userData/logs/aivn.log, xoay vòng ~5 MB.
// Dùng cho tiến trình chính, bộ máy AI (qua tiến trình chính) và công cụ của AIVN AGENT. Tự che token/mật khẩu.
const fs = require('fs');
const path = require('path');
const MAX = 5 * 1024 * 1024;
let dir = null, file = null, engineFile = null, broken = null;
const SECRET_KEY = /(token|password|passwd|pw|secret|api[-_]?key|authorization|cookie|hfToken|privateKey|adminKey)/i;
function redact(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === 'string') return v.replace(/\bhf_[A-Za-z0-9]{8,}\b/g, 'hf_***').replace(/\b(gh[pousr]_)[A-Za-z0-9]{10,}\b/g, '$1***').replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1***');
  if (typeof v !== 'object' || depth > 4) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => redact(x, depth + 1));
  const o = {}; for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEY.test(k) ? '***' : redact(x, depth + 1); return o;
}
const short = (s, n = 400) => { s = String(s); return s.length > n ? s.slice(0, n) + `…(+${s.length - n} ký tự)` : s; };
function fmt(x) { if (x === undefined) return ''; if (typeof x === 'string') return short(redact(x), 4000); try { return short(JSON.stringify(redact(x)), 4000); } catch { return String(x); } }
function init(logDir) {
  dir = logDir; file = path.join(dir, 'aivn.log'); engineFile = path.join(dir, 'engine.log');
  try { fs.mkdirSync(dir, { recursive: true }); for (const f of [file, engineFile]) fs.appendFileSync(f, withBom(f, ''), 'utf8'); broken = null; } catch (e) { broken = e.message; try { process.stderr.write('[AIVN] không ghi được nhật ký: ' + e.message + '\n'); } catch {} }
  return file;
}
function rotate(f) { try { if (fs.statSync(f).size > MAX) { try { fs.rmSync(f + '.1', { force: true }); } catch {} fs.renameSync(f, f + '.1'); } } catch {} }
// UTF-8 CÓ BOM, nhất quán (tệp mới và sau mỗi lần xoay vòng): Windows PowerShell 5.1 (Get-Content, Select-String…) đọc tệp
// UTF-8 không BOM theo bảng mã ANSI → tiếng Việt thành “?”/ký tự lạ. Có BOM thì PowerShell, Notepad, Excel đều đọc đúng.
const BOM = '\ufeff';
function withBom(f, text) { let empty = true; try { empty = fs.statSync(f).size === 0; } catch {} return empty ? BOM + text : text; }
function append(f, text) {
  if (!f) return false;
  try { rotate(f); fs.appendFileSync(f, withBom(f, text), 'utf8'); return true; }
  catch (e) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, withBom(f, text), 'utf8'); return true; } catch (e2) { broken = e2.message; try { process.stderr.write('[AIVN] ghi nhật ký lỗi: ' + e2.message + '\n'); } catch {} return false; } }
}
// scope: 'app' | 'engine' | 'tool' | 'apps' | 'load' …
function log(scope, msg, extra) {
  const line = `${new Date().toISOString()} [${scope}] ${redact(String(msg))}${extra === undefined ? '' : ' ' + fmt(extra)}\n`;
  append(file, line);
  if (/^(engine|load|apps|crash)$/.test(scope)) append(engineFile, line);
  for (const fn of taps) { try { fn(line, scope); } catch {} }
  return line;
}
// QA runner: nghe các dòng nhật ký trong lúc chạy một việc (toạ độ bấm, mã phím…) — trả hàm huỷ nghe
const taps = new Set();
function tap(fn) { taps.add(fn); return () => taps.delete(fn); }
// khối nhiều dòng (lỗi có stack, danh sách lần thử nạp…)
function block(scope, title, lines = []) { const head = `${new Date().toISOString()} [${scope}] ${redact(title)}\n`; const body = lines.filter(x => x != null && x !== '').map(l => '    ' + redact(String(l)).replace(/\n/g, '\n    ')).join('\n'); const t = head + (body ? body + '\n' : ''); append(file, t); if (/^(engine|load|apps|crash)$/.test(scope)) append(engineFile, t); }
function tail(n = 200) {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^\ufeff/, ''); } catch { return ''; } };
  let t = read(file); let lines = t.split('\n'); if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length < n) { const old = read(file + '.1').split('\n'); if (old[old.length - 1] === '') old.pop(); lines = [...old.slice(-(n - lines.length)), ...lines]; }
  return lines.slice(-n).join('\n');
}
module.exports = { init, log, block, tail, redact, tap, get file() { return file; }, get dir() { return dir; }, get error() { return broken; } };
