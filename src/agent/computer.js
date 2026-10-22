// Truy cập máy tính cấp 1 cho AIVN AGENT: liệt kê/mở ứng dụng, mở tệp/thư mục/địa chỉ web, đóng ứng dụng,
// chạy lệnh terminal (luôn qua thẻ xác nhận), thao tác hệ thống cơ bản. Hỗ trợ Windows và macOS (Linux: cơ bản).
// Mọi hàm nhận deps để kiểm thử được: { openPath, openExternal, platform, home, env, exec }
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

// ---------- Danh sách chặn / danh sách an toàn ----------
// Chặn tuyệt đối (không cả hỏi): lệnh có thể phá hệ thống, xoá hàng loạt, tải mã từ mạng rồi chạy, đổi quyền/tài khoản.
const BLOCK = [
  [/\bformat(\.com)?\s+[a-z]:/i, 'định dạng ổ đĩa'],
  [/\b(diskpart|bcdedit|bootrec|fdisk|mkfs(\.\w+)?|parted|gdisk|wipefs|diskutil\s+(erase|zero|secureErase|partition|apfs\s+delete))\b/i, 'thao tác ổ đĩa / khởi động'],
  [/\bdd\b[^|;&]*\bof=\/dev\//i, 'ghi thẳng vào thiết bị'],
  [/\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(-[a-z]*\s+)*(\/|~|\$HOME|\/\*|~\/\*|\/(users|home|system|library|etc|usr|bin|var|applications)\b)(\s|$)/i, 'xoá hàng loạt thư mục hệ thống / thư mục người dùng'],
  [/\brm\s+(-[a-z]*\s+)*--no-preserve-root/i, 'xoá gốc hệ thống'],
  [/\b(rd|rmdir)\s+(\/s|\/q|\s)+\s*[a-z]:\\?(\s|$|windows|users|program)/i, 'xoá thư mục hệ thống'],
  [/\bdel\s+(\/[a-z]\s+)*[a-z]:\\(\*|windows|users|program)/i, 'xoá tệp hệ thống'],
  [/remove-item\b[^|;]*(-recurse)[^|;]*\s([a-z]:\\?(\s|$|windows|users|program)|~|\$env:(userprofile|systemroot|windir))/i, 'xoá hàng loạt thư mục hệ thống'],
  [/\b(vssadmin|wbadmin)\b.*\bdelete\b/i, 'xoá bản sao lưu'],
  [/\bcipher\s+\/w/i, 'xoá trắng ổ đĩa'],
  [/\breg(\.exe)?\s+(delete|add)\s+hklm/i, 'sửa sổ đăng ký hệ thống'],
  [/\b(takeown|icacls)\b[^|;]*[a-z]:\\(windows|program)/i, 'đổi quyền thư mục hệ thống'],
  [/\bnet\s+(user|localgroup)\b[^|;]*\/(add|delete)/i, 'thêm/xoá tài khoản'],
  [/\b(dscl|sysadminctl)\b[^|;]*(-create|-delete|-addUser|-deleteUser)/i, 'thêm/xoá tài khoản'],
  [/\bset-executionpolicy\b/i, 'đổi chính sách chạy script'],
  [/\b(csrutil|spctl)\b\s+(disable|--master-disable)/i, 'tắt bảo vệ hệ thống'],
  [/\b(set-mppreference|add-mppreference)\b|\bdisablerealtimemonitoring\b/i, 'tắt phần mềm diệt virus'],
  [/\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^\n]*\|\s*(sh|bash|zsh|iex|invoke-expression|python3?|node|powershell|pwsh)\b/i, 'tải mã từ mạng rồi chạy ngay'],
  [/\b(iex|invoke-expression)\b/i, 'chạy mã động (Invoke-Expression)'],
  [/\s-(e|ec|enc|encodedcommand)\s+[a-z0-9+/=]{16,}/i, 'lệnh mã hoá base64 (không đọc được)'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'fork bomb'],
  [/\b(chmod|chown)\s+(-[a-z]*r[a-z]*\s+)[^|;]*\s(\/|\/(etc|usr|bin|system|library))(\s|$)/i, 'đổi quyền hàng loạt thư mục hệ thống'],
  [/\bsudo\b|\brunas\b|start-process\b[^|;]*-verb\s+runas/i, 'chạy với quyền quản trị (sudo/runas)'],
  [/\b(shutdown|halt|poweroff|reboot)\b|\brestart-computer\b|\bstop-computer\b/i, 'tắt/khởi động lại máy (hãy dùng công cụ thao tác hệ thống, có hỏi xác nhận riêng)'],
  [/\b(schtasks\s+\/create|crontab\s+-r|launchctl\s+(load|bootstrap))\b/i, 'tạo tác vụ chạy ngầm'],
  [/\b(history\s+-c|clear-history|wevtutil\s+cl)\b/i, 'xoá nhật ký hệ thống'],
  [/(\\|\/)(\.ssh|\.aws|\.gnupg)(\\|\/)|\bid_rsa\b|keychain|security\s+(find|dump)-/i, 'đọc khoá bí mật / mật khẩu đã lưu'],
];
// Lệnh chỉ đọc thông dụng: vẫn hiện thẻ xác nhận, nhưng được đánh dấu "chỉ đọc" (và có thể bật chế độ không hỏi lại)
const SAFE_FIRST = new Set(['dir', 'ls', 'pwd', 'cd', 'echo', 'whoami', 'hostname', 'date', 'time', 'ipconfig', 'ifconfig', 'ping', 'tracert', 'traceroute', 'nslookup', 'systeminfo', 'ver', 'uname', 'sw_vers', 'uptime', 'df', 'du', 'free', 'tasklist', 'ps', 'top', 'type', 'cat', 'head', 'tail', 'wc', 'find', 'where', 'which', 'tree', 'get-date', 'get-childitem', 'get-process', 'get-content', 'get-location', 'get-computerinfo', 'get-volume', 'get-netipaddress', 'python', 'python3', 'node', 'npm', 'git', 'java', 'pip', 'pip3', 'winget', 'brew', 'code', 'netstat', 'getmac', 'arp', 'vm_stat', 'system_profiler', 'diskutil', 'pmset', 'networksetup', 'scutil', 'wmic']);
const SAFE_SUB = { git: /^git\s+(status|log|diff|branch|remote|show|--version)\b/i, npm: /^npm\s+(-v|--version|ls|list|outdated|view)\b/i, pip: /^pip3?\s+(list|show|--version|freeze)\b/i, pip3: /^pip3?\s+(list|show|--version|freeze)\b/i, python: /^python3?\s+(-V|--version)\s*$/i, python3: /^python3?\s+(-V|--version)\s*$/i, node: /^node\s+(-v|--version)\s*$/i, java: /^java\s+(-version|--version)\s*$/i, winget: /^winget\s+(list|search|show|--version)\b/i, brew: /^brew\s+(list|search|info|--version)\b/i, code: /^code\s+(--version|-v)\s*$/i, diskutil: /^diskutil\s+(list|info)\b/i, pmset: /^pmset\s+-g\b/i, networksetup: /^networksetup\s+-(list|get)/i, scutil: /^scutil\s+--(get|dns|nwi)\b/i, wmic: /^wmic\s+[\w]+\s+get\b/i, find: /^find\s(?!.*-(delete|exec))/i };

function checkCommand(cmd) {
  const c = String(cmd || '').trim();
  if (!c) return { ok: false, reason: 'Lệnh trống' };
  if (c.length > 2000) return { ok: false, reason: 'Lệnh quá dài (tối đa 2000 ký tự)' };
  for (const [re, why] of BLOCK) if (re.test(c)) return { ok: false, blocked: true, reason: `AIVN chặn lệnh này vì nguy hiểm: ${why}.` };
  // "chỉ đọc" khi mọi đoạn (nối bằng |, &&, ;) đều là lệnh chỉ đọc và không chuyển hướng ghi ra tệp
  const parts = c.split(/\|\||&&|[|;&]/).map(s => s.trim()).filter(Boolean);
  const readOnly = !/(^|[^>])>{1,2}(?!\s*&?\s*(nul|\/dev\/null)\b)/i.test(c.replace(/2>&1/g, '')) && parts.every(p => {
    const first = p.split(/\s+/)[0].toLowerCase().replace(/\.exe$/, '');
    if (!SAFE_FIRST.has(first)) return false;
    return SAFE_SUB[first] ? SAFE_SUB[first].test(p) : true;
  });
  return { ok: true, readOnly };
}

// ---------- Ứng dụng đã cài ----------
function walk(dir, depth, out, pred, max = 4000) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (out.length >= max) return;
    const full = path.join(dir, e.name);
    if (pred(e, full)) { out.push(full); continue; }
    if (e.isDirectory() && depth > 0 && !e.name.endsWith('.app')) walk(full, depth - 1, out, pred, max);
  }
}
// Đọc đích của lối tắt .lnk (MS-SHLLINK) không cần PowerShell: LinkInfo → LocalBasePath (ưu tiên bản Unicode)
function lnkTarget(file) {
  let b; try { b = fs.readFileSync(file); } catch { return null; }
  try {
    if (b.length < 0x4c || b.readUInt32LE(0) !== 0x4c) return null;
    const flags = b.readUInt32LE(0x14); let off = 0x4c;
    if (flags & 1) off += 2 + b.readUInt16LE(off);
    if (!(flags & 2)) return null;
    const li = off, hs = b.readUInt32LE(li + 4), lf = b.readUInt32LE(li + 8);
    if (!(lf & 1)) return null;
    const cstr = (o) => { let e = o; while (e < b.length && b[e]) e++; return b.toString('latin1', o, e); };
    const wstr = (o) => { let e = o; while (e + 1 < b.length && (b[e] || b[e + 1])) e += 2; return b.toString('utf16le', o, e); };
    let base = hs >= 0x24 && b.readUInt32LE(li + 28) ? wstr(li + b.readUInt32LE(li + 28)) : cstr(li + b.readUInt32LE(li + 16));
    const suf = hs >= 0x24 && b.readUInt32LE(li + 32) ? wstr(li + b.readUInt32LE(li + 32)) : cstr(li + b.readUInt32LE(li + 24));
    if (suf) base = base.replace(/\\?$/, '\\') + suf;
    return base || null;
  } catch { return null; }
}
// Thư mục Desktop / Start Menu có thể có trên Windows: hồ sơ thường, Public, OneDrive (cá nhân + tổ chức, vd. "OneDrive - Văn Lang"),
// cộng thêm các thư mục thật lấy từ sổ đăng ký / [Environment]::GetFolderPath (extraDirs)
function winDirs({ home, env, extraDirs = {} }) {
  const prof = env.USERPROFILE || home;
  const one = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean);
  try { for (const e of fs.readdirSync(prof, { withFileTypes: true })) if (e.isDirectory() && /^OneDrive/i.test(e.name)) one.push(path.join(prof, e.name)); } catch {}
  const desk = [path.join(prof, 'Desktop'), path.join(env.PUBLIC || 'C:\\Users\\Public', 'Desktop'), ...one.flatMap(o => [path.join(o, 'Desktop'), path.join(o, 'Màn hình nền')]), ...(extraDirs.desktop || [])];
  const start = [path.join(env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(env.APPDATA || path.join(prof, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), ...(extraDirs.start || [])];
  const uniq = (a) => { const seen = new Set(); return a.filter(d => { const k = d.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
  return { desk: uniq(desk), start: uniq(start) };
}
const APPDATA_SKIP = /^(microsoft|packages|temp|google|mozilla|programs|npm|npm-cache|pip|nuget|d3dscache|crashdumps|connecteddevicesplatform|comms|publishers|virtualstore|history|ms-playwright|electron|node-gyp|cache|caches)$/i;
const SKIP_LNK = /^(uninstall|gỡ|readme|help|website|license|release notes)\b|\buninstall\b/i;
function listApps({ platform = process.platform, home = os.homedir(), env = process.env, extraDirs = {}, diag = null } = {}) {
  const out = [];
  const count = (k, n) => { if (diag) diag.sources[k] = (diag.sources[k] || 0) + n; };
  if (platform === 'win32') {
    const { desk, start } = winDirs({ home, env, extraDirs });
    if (diag) diag.dirs = { desktop: desk.filter(d => fs.existsSync(d)), start: start.filter(d => fs.existsSync(d)) };
    const add = (f, source) => {
      const name = path.basename(f).replace(/\.(lnk|url|appref-ms|exe)$/i, ''); if (SKIP_LNK.test(name)) return false;
      const target = /\.lnk$/i.test(f) ? lnkTarget(f) : /\.exe$/i.test(f) ? f : null;
      out.push({ name, path: f, target: target || undefined, source }); return true;
    };
    for (const r of start) { const files = []; walk(r, 4, files, (e) => e.isFile() && /\.(lnk|url|appref-ms)$/i.test(e.name)); count('startmenu', files.filter(f => add(f, 'startmenu')).length); }
    for (const d of desk) { const files = []; walk(d, 0, files, (e) => e.isFile() && /\.(lnk|url|appref-ms|exe)$/i.test(e.name)); count('desktop', files.filter(f => add(f, 'desktop')).length); }
    // ứng dụng cài theo người dùng (Zalo, VS Code, Discord…): %LOCALAPPDATA%\Programs\<Tên>\<Tên>.exe
    const progs = path.join(env.LOCALAPPDATA || path.join(env.USERPROFILE || home, 'AppData', 'Local'), 'Programs');
    let dirs = []; try { dirs = fs.readdirSync(progs, { withFileTypes: true }).filter(e => e.isDirectory()); } catch {}
    let nLocal = 0;
    for (const d of dirs) {
      let exes = []; try { exes = fs.readdirSync(path.join(progs, d.name)).filter(f => /\.exe$/i.test(f) && !/unins|update|setup|crash|helper/i.test(f)); } catch {}
      const exe = exes.find(f => fold(f.replace(/\.exe$/i, '')) === fold(d.name)) || exes.find(f => fold(f).startsWith(fold(d.name).slice(0, 3))) || (exes.length === 1 ? exes[0] : null);
      if (exe) { out.push({ name: d.name, path: path.join(progs, d.name, exe), source: 'localappdata' }); nLocal++; }
    }
    count('localappdata', nLocal);
    // 0.16: ứng dụng ghim trên thanh tác vụ (lối tắt riêng, có khi không có trong Start Menu)
    const appData = env.APPDATA || path.join(env.USERPROFILE || home, 'AppData', 'Roaming');
    const pinned = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
    { const files = []; walk(pinned, 0, files, (e) => e.isFile() && /\.lnk$/i.test(e.name)); count('taskbar', files.filter(f => add(f, 'taskbar')).length); }
    // 0.16: ứng dụng tự cài thẳng vào AppData (vd. %APPDATA%\Telegram Desktop\Telegram.exe, %LOCALAPPDATA%\<Tên>\<Tên>.exe)
    let nApp = 0;
    for (const root of [env.LOCALAPPDATA || path.join(env.USERPROFILE || home, 'AppData', 'Local'), appData]) {
      let ds = []; try { ds = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !APPDATA_SKIP.test(e.name)); } catch {}
      for (const d of ds) {
        let exes = []; try { exes = fs.readdirSync(path.join(root, d.name)).filter(f => /\.exe$/i.test(f) && !/unins|update|setup|crash|helper|install|squirrel/i.test(f)); } catch {}
        const k = fold(d.name).replace(/\s+/g, '');
        const exe = exes.find(f => fold(f.replace(/\.exe$/i, '')).replace(/\s+/g, '') === k) || exes.find(f => { const e = fold(f.replace(/\.exe$/i, '')).replace(/\s+/g, ''); return e.length >= 3 && k.startsWith(e); });
        if (exe) { out.push({ name: d.name, path: path.join(root, d.name, exe), source: 'appdata' }); nApp++; }
      }
    }
    count('appdata', nApp);
  } else if (platform === 'darwin') {
    const files = []; for (const r of ['/Applications', '/System/Applications', '/System/Applications/Utilities', '/Applications/Utilities', path.join(home, 'Applications')]) walk(r, 1, files, (e) => e.name.endsWith('.app'));
    for (const f of files) out.push({ name: path.basename(f, '.app'), path: f });
    count('applications', files.length);
    const more = []; for (const r of ['/Applications']) walk(r, 2, more, (e) => e.name.endsWith('.app')); // thư mục con: "Microsoft Office", "Setapp"…
    for (const f of more) out.push({ name: path.basename(f, '.app'), path: f });
  } else {
    const files = []; for (const r of ['/usr/share/applications', '/usr/local/share/applications', path.join(home, '.local/share/applications'), '/var/lib/flatpak/exports/share/applications']) walk(r, 1, files, (e) => e.name.endsWith('.desktop'));
    for (const f of files) { let name = path.basename(f, '.desktop'); try { const t = fs.readFileSync(f, 'utf8'); if (/^NoDisplay=true/m.test(t)) continue; const m = t.match(/^Name=(.+)$/m); if (m) name = m[1].trim(); } catch {} out.push({ name, path: f }); }
  }
  const seen = new Set();
  return out.filter(a => { const k = fold(a.name); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
// ---------- Tìm sâu (Windows: sổ đăng ký Uninstall/App Paths + Get-StartApps/Store; macOS: Spotlight) ----------
const PS_APPS = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='SilentlyContinue'
$o=@()
foreach($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'){ Get-ItemProperty $k | Where-Object { $_.DisplayName -and -not $_.SystemComponent } | ForEach-Object { $o += [pscustomobject]@{ s='uninstall'; n=$_.DisplayName; i=$_.DisplayIcon; l=$_.InstallLocation } } }
foreach($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\*'){ Get-ItemProperty $k | ForEach-Object { $o += [pscustomobject]@{ s='apppath'; n=$_.PSChildName; i=$_.'(default)' } } }
if(Get-Command Get-StartApps){ Get-StartApps | ForEach-Object { $o += [pscustomobject]@{ s='start'; n=$_.Name; a=$_.AppID } } }
foreach($f in 'Desktop','CommonDesktopDirectory','StartMenu','CommonStartMenu','Programs','CommonPrograms'){ $d=[Environment]::GetFolderPath($f); if($d){ $o += [pscustomobject]@{ s='dir'; n=$f; i=$d } } }
ConvertTo-Json -InputObject @($o) -Compress -Depth 2`;
// -EncodedCommand (UTF-16LE base64): không vướng dấu nháy / xuống dòng / chính sách thực thi
const psEncoded = (script) => Buffer.from(script, 'utf16le').toString('base64');
function exeFromIcon(icon, loc, name) {
  let p = String(icon || '').trim().replace(/^"|"?,\s*-?\d+$|"$/g, '').replace(/^"|"$/g, '');
  if (/\.exe$/i.test(p) && !/unins|setup|update/i.test(path.basename(p))) return p;
  if (loc) { try { const ex = fs.readdirSync(loc).filter(f => /\.exe$/i.test(f) && !/unins|setup|update|crash/i.test(f)); const hit = ex.find(f => fold(name).includes(fold(f.replace(/\.exe$/i, '')))) || ex[0]; if (hit) return path.join(loc, hit); } catch {} }
  return null;
}
function parseWinApps(json, diag = null) {
  let arr; try { arr = JSON.parse(String(json || '[]').replace(/^\uFEFF/, '').trim() || '[]'); } catch (e) { if (diag) diag.errors.push('PowerShell trả dữ liệu không đọc được'); return []; }
  if (!Array.isArray(arr)) arr = [arr];
  const out = []; const dirs = { desktop: [], start: [] };
  for (const x of arr) {
    if (!x || !x.n) continue;
    if (x.s === 'dir') { if (x.i) (/desktop/i.test(x.n) ? dirs.desktop : dirs.start).push(x.i); continue; }
    if (x.s === 'start') out.push({ name: x.n, appId: x.a, source: 'start' });
    else if (x.s === 'apppath') { const exe = String(x.i || '').replace(/^"|"$/g, ''); if (exe) out.push({ name: x.n.replace(/\.exe$/i, ''), path: exe, source: 'apppath' }); }
    else { const exe = exeFromIcon(x.i, x.l, x.n); out.push({ name: x.n, path: exe || null, source: 'uninstall' }); }
  }
  if (diag) { for (const a of out) diag.sources[a.source] = (diag.sources[a.source] || 0) + 1; diag.shellDirs = dirs; }
  Object.defineProperty(out, 'dirs', { value: dirs, enumerable: false });
  return out;
}
// Tìm sâu; trả mảng ứng dụng, kèm .diag (nguồn → số mục, lỗi) không liệt kê
async function deepApps({ platform = process.platform, run = null, timeout = 25000 } = {}) {
  const diag = { sources: {}, errors: [] };
  const exec_ = run || ((cmd, args) => new Promise(res => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (e, out, err) => {
    if (e) diag.errors.push(`PowerShell ${e.killed || e.signal ? 'quá thời gian ' + Math.round(timeout / 1000) + ' giây' : 'lỗi: ' + String(err || e.message).split('\n')[0].slice(0, 160)}`);
    res(String(out || ''));
  })));
  let list = [];
  if (platform === 'win32') {
    const t0 = Date.now();
    let out = ''; try { out = await exec_('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(PS_APPS)]); } catch (e) { diag.errors.push('PowerShell không chạy được: ' + e.message); }
    if (!String(out).trim() && !diag.errors.length) diag.errors.push('PowerShell không trả kết quả');
    list = parseWinApps(out, diag); diag.ms = Date.now() - t0;
  }
  Object.defineProperty(list, 'diag', { value: diag, enumerable: false });
  return list;
}
async function macSpotlight(query, { run = null } = {}) {
  const q = String(query || '').replace(/["'*\\]/g, '').trim(); if (!q) return [];
  const exec_ = run || ((cmd, args) => new Promise(res => execFile(cmd, args, { timeout: 8000 }, (e, out) => res(e ? '' : String(out)))));
  const out = await exec_('mdfind', [`kMDItemContentTypeTree == "com.apple.application-bundle" && kMDItemDisplayName == "*${q}*"cd`]);
  return out.split('\n').filter(l => l.endsWith('.app')).map(p => ({ name: path.basename(p, '.app'), path: p, source: 'spotlight' }));
}
// Gộp danh sách: ưu tiên mục mở được trực tiếp (có path/appId)
function mergeApps(...lists) {
  const m = new Map();
  for (const l of lists) for (const a of l || []) { const k = fold(a.name); const cur = m.get(k); if (!cur || (!cur.path && !cur.appId && (a.path || a.appId))) m.set(k, a); }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

// Tên gọi thông dụng (tiếng Việt / viết tắt) → tên ứng dụng
const ALIASES = { 'trinh duyet': ['Google Chrome', 'Microsoft Edge', 'Safari', 'Firefox', 'Cốc Cốc', 'Coc Coc'], chrome: ['Google Chrome'], edge: ['Microsoft Edge'], 'coc coc': ['Cốc Cốc', 'CocCoc'], word: ['Microsoft Word', 'Word'], excel: ['Microsoft Excel', 'Excel'], powerpoint: ['Microsoft PowerPoint', 'PowerPoint'], 'may tinh': ['Calculator', 'Máy tính'], calculator: ['Calculator'], notepad: ['Notepad', 'TextEdit'], 'ghi chu': ['Notepad', 'Notes', 'Sticky Notes'], terminal: ['Terminal', 'Windows Terminal', 'Command Prompt', 'PowerShell'], cmd: ['Command Prompt'], 'cai dat': ['Settings', 'System Settings', 'System Preferences'], settings: ['Settings', 'System Settings'], 'file explorer': ['File Explorer'], explorer: ['File Explorer'], finder: ['Finder'], zalo: ['Zalo'], 'vs code': ['Visual Studio Code'], vscode: ['Visual Studio Code'], paint: ['Paint'], 'nhac': ['Music', 'Spotify', 'Media Player'], spotify: ['Spotify'], telegram: ['Telegram', 'Telegram Desktop'], zoom: ['Zoom', 'zoom.us'], teams: ['Microsoft Teams'], outlook: ['Microsoft Outlook', 'Outlook'] };
// Ứng dụng có sẵn của hệ điều hành không có lối tắt trong Start Menu: mở bằng lệnh hệ thống
const WIN_BUILTIN = { calculator: 'calc.exe', 'máy tính': 'calc.exe', notepad: 'notepad.exe', paint: 'mspaint.exe', 'file explorer': 'explorer.exe', explorer: 'explorer.exe', 'command prompt': 'cmd.exe', cmd: 'cmd.exe', powershell: 'powershell.exe', settings: 'ms-settings:', 'cài đặt': 'ms-settings:', 'task manager': 'taskmgr.exe', 'snipping tool': 'snippingtool.exe', 'control panel': 'control.exe' };
const NOISE = /\b(pc|app|apps|desktop|for (windows|mac|macos)|ung dung|phan mem|chuong trinh|cho (windows|mac))\b/g;
function score(q, name) {
  const a0 = fold(q), b0 = fold(name);
  const a = a0.replace(NOISE, ' ').replace(/\s+/g, ' ').trim() || a0, b = b0.replace(/\s+/g, ' ');
  if (a && b && a !== a0 && (a === b || a === b.replace(NOISE, ' ').replace(/\s+/g, ' ').trim())) return 95;
  if (a && b.length >= 3 && a.startsWith(b + ' ')) return 70; // "zalo pc" ↔ "Zalo"
  if (!a) return 0; if (a === b) return 100; if (b.startsWith(a)) return 80; if (b.includes(a)) return 60;
  const words = a.split(/\s+/).filter(w => w.length > 1); const hit = words.filter(w => b.includes(w)).length;
  return words.length ? Math.round(40 * hit / words.length) : 0;
}
function findApp(query, apps) {
  const q = fold(query); const names = [query, ...(ALIASES[q] || [])];
  let best = null;
  for (const a of apps) for (const [i, n] of names.entries()) { const s = score(n, a.name) - (i ? 5 : 0); if (s > 0 && (!best || s > best.s)) best = { ...a, s }; }
  return best && best.s >= 40 ? best : null;
}

// ---------- Đường dẫn: ~, thư mục quen thuộc bằng tiếng Việt ----------
function knownFolder(name, home = os.homedir()) {
  const f = fold(name).replace(/^thu muc\s+/, '');
  const map = { 'desktop': 'Desktop', 'man hinh': 'Desktop', 'man hinh chinh': 'Desktop', 'documents': 'Documents', 'tai lieu': 'Documents', 'downloads': 'Downloads', 'tai ve': 'Downloads', 'pictures': 'Pictures', 'anh': 'Pictures', 'hinh anh': 'Pictures', 'music': 'Music', 'nhac': 'Music', 'videos': process.platform === 'darwin' ? 'Movies' : 'Videos', 'video': process.platform === 'darwin' ? 'Movies' : 'Videos', 'home': '', 'nha': '', 'thu muc nha': '', 'ca nhan': '' };
  return f in map ? path.join(home, map[f]) : null;
}
function expandPath(p, home = os.homedir(), env = process.env) {
  let s = String(p || '').trim().replace(/^["'`]|["'`]$/g, '');
  const k = knownFolder(s, home); if (k) return k;
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(home, s.slice(1));
  s = s.replace(/%([A-Za-z_]+)%/g, (m, v) => env[v] ?? env[v.toUpperCase()] ?? m).replace(/\$(HOME|USERPROFILE)\b/g, home);
  if (!path.isAbsolute(s) && !/^[A-Za-z]:/.test(s)) { // đường dẫn tương đối: tính từ thư mục nhà (không phải thư mục cài AIVN)
    const seg = s.split(/[\\/]/); const k2 = knownFolder(seg[0], home);
    return k2 ? path.join(k2, ...seg.slice(1)) : path.resolve(home, s);
  }
  return path.resolve(s);
}
const EXEC_EXT = /\.(exe|msi|bat|cmd|com|ps1|vbs|vbe|js|jse|wsf|wsh|scr|pif|hta|cpl|reg|jar|sh|command|app|pkg|dmg|appimage|run|lnk|url)$/i;

// ---------- Chạy lệnh ----------
function runCommand(cmd, { cwd = os.homedir(), timeoutMs = 60000, signal, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    const isWin = platform === 'win32';
    const args = isWin ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + cmd]] : [process.env.SHELL && /zsh|bash/.test(process.env.SHELL) ? process.env.SHELL : '/bin/sh', ['-c', cmd]];
    const t0 = Date.now(); let out = '', err = '', done = false;
    let p; try { p = spawn(args[0], args[1], { cwd, windowsHide: true, env: { ...process.env, PAGER: 'cat', GIT_PAGER: 'cat' } }); } catch (e) { return resolve({ ok: false, code: -1, out: '', err: e.message, ms: 0 }); }
    const cap = (s, d) => (s.length > 60000 ? s : s + d);
    p.stdout.on('data', d => { out = cap(out, d.toString('utf8')); });
    p.stderr.on('data', d => { err = cap(err, d.toString('utf8')); });
    const kill = () => { try { if (isWin) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); else p.kill('SIGKILL'); } catch {} };
    const t = setTimeout(() => { if (!done) { err += `\n[AIVN] Đã dừng lệnh sau ${timeoutMs / 1000} giây.`; kill(); } }, timeoutMs);
    const onAbort = () => { err += '\n[AIVN] Đã dừng theo yêu cầu.'; kill(); };
    signal && signal.addEventListener('abort', onAbort, { once: true });
    p.on('error', e => { err += e.message; });
    p.on('close', (code) => { done = true; clearTimeout(t); signal && signal.removeEventListener('abort', onAbort); resolve({ ok: code === 0, code, out: out.trim(), err: err.trim(), ms: Date.now() - t0 }); });
  });
}
const run = (file, args, opts = {}) => new Promise((res) => execFile(file, args, { windowsHide: true, timeout: 15000, encoding: 'utf8', maxBuffer: 4e6, ...opts }, (e, so, se) => res({ ok: !e, out: String(so || ''), err: String(se || (e && e.message) || '') })));

// ---------- Ứng dụng đang chạy / đóng ứng dụng ----------
const PROTECTED = /^(explorer|winlogon|csrss|lsass|services|svchost|smss|wininit|dwm|system|registry|fontdrvhost|sihost|ctfmon|finder|dock|loginwindow|windowserver|systemuiserver|launchd|kernel_task|aivn|electron)$/i;
async function runningApps({ platform = process.platform } = {}) {
  if (platform === 'win32') {
    const r = await run('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + "`t" + $_.MainWindowTitle }']);
    return r.out.split(/\r?\n/).filter(Boolean).map(l => { const [proc, title] = l.split('\t'); return { name: proc, title: title || '' }; });
  }
  if (platform === 'darwin') {
    const r = await run('osascript', ['-e', 'tell application "System Events" to get name of every application process whose background only is false']);
    return r.out.trim().split(/,\s*/).filter(Boolean).map(n => ({ name: n, title: '' }));
  }
  const r = await run('ps', ['-eo', 'comm=']);
  return [...new Set(r.out.split('\n').map(s => s.trim()).filter(Boolean))].slice(0, 200).map(n => ({ name: n, title: '' }));
}
function matchRunning(query, list) {
  let best = null;
  for (const a of list) { const s = Math.max(score(query, a.name), score(query, a.title) - 10, ...(ALIASES[fold(query)] || []).map(x => score(x, a.name) - 5)); if (s >= 40 && (!best || s > best.s)) best = { ...a, s }; }
  return best;
}
async function closeApp(name, { platform = process.platform, force = false } = {}) {
  if (PROTECTED.test(name)) throw new Error(`Không đóng "${name}": đây là tiến trình của hệ thống hoặc của chính AIVN.`);
  if (platform === 'win32') { const r = await run('taskkill', ['/IM', name.replace(/\.exe$/i, '') + '.exe', ...(force ? ['/F'] : [])]); if (!r.ok) throw new Error(r.err.trim() || 'Không đóng được'); return r.out.trim(); }
  if (platform === 'darwin') { const r = await run('osascript', ['-e', `tell application "${name.replace(/["\\]/g, '')}" to quit`]); if (!r.ok) throw new Error(r.err.trim() || 'Không đóng được'); return 'Đã gửi lệnh thoát'; }
  const r = await run('pkill', ['-x', name]); if (!r.ok) throw new Error('Không đóng được'); return 'Đã đóng';
}

// ---------- Thao tác hệ thống ----------
// ask: câu của người dùng (đã bỏ dấu) có yêu cầu ĐÚNG thao tác này không. Không có yêu cầu rõ ràng → luôn hỏi trước (QA B1:
// agent tự khoá màn hình khi người dùng chỉ hỏi một câu). confirm: luôn hỏi kể cả khi được yêu cầu.
const SYS = {
  lock: { label: 'Khoá màn hình', confirm: false, ask: /\b(khoa|lock)\s*(lai\s*)?(man hinh|may|screen|pc|computer)|\block\b/ },
  sleep: { label: 'Cho máy ngủ', confirm: true, ask: /\b(ngu|sleep)\b/ },
  shutdown: { label: 'Tắt máy', confirm: true, danger: true, ask: /tat may|shut ?down/ },
  restart: { label: 'Khởi động lại máy', confirm: true, danger: true, ask: /khoi dong lai|restart|reboot/ },
  volume_up: { label: 'Tăng âm lượng', confirm: false, ask: /(tang|to len|lon len|vặn to|van to).{0,20}(am luong|tieng|loa)|(am luong|tieng|loa).{0,12}(to|lon) (len|hon)|volume up/ },
  volume_down: { label: 'Giảm âm lượng', confirm: false, ask: /(giam|nho lai|van nho|ha).{0,20}(am luong|tieng|loa)|(am luong|tieng|loa).{0,12}nho (lai|xuong|hon)|volume down/ },
  volume_set: { label: 'Đặt âm lượng', confirm: false, ask: /(am luong|volume|loa).{0,20}\d{1,3}/ },
  volume_change: { label: 'Đổi âm lượng', confirm: false, ask: /(am luong|volume|loa).{0,20}\d{1,3}/ }, // B89: ±N% so với mức hiện tại (đặt mức tuyệt đối qua Core Audio)
  mute: { label: 'Tắt/bật tiếng', confirm: false, ask: /(tat|bat|mo) (tieng|am thanh|loa)|im lang|mute|unmute/ },
  open_settings: { label: 'Mở Cài đặt hệ thống', confirm: false, ask: /cai dat|settings|thiet lap/ },
  show_desktop: { label: 'Hiện màn hình chính (thu nhỏ mọi cửa sổ)', confirm: false, ask: /man hinh chinh|desktop|thu nho (het|tat ca|moi)/ },
  empty_trash: { label: 'Dọn Thùng rác', confirm: true, danger: true, ask: /thung rac|trash|recycle/ },
};
// người dùng có yêu cầu đúng thao tác hệ thống này trong câu của lượt hiện tại không
// B16: nhận ý định theo cấu trúc từng mệnh đề (phủ định, câu hỏi, chuỗi lệnh, đối tượng hẹp) — xem sys-intent.js
const sysAsked = (action, query) => !!SYS[action] && (action === 'volume_set' ? require('./sys-intent').volumeLevel(query) != null : action === 'volume_change' ? require('./sys-intent').volumeDelta(query) != null : require('./sys-intent').sysAsked(action, query));
// B44: đặt âm lượng chính xác N% — Windows: Core Audio (IAudioEndpointVolume) qua PowerShell
const PS_VOLUME = (level, delta = null) => String.raw`$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float fLevel, Guid ctx); int j(); int GetMasterVolumeLevelScalar(out float pfLevel); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid ctx); int GetMute(out bool pbMute); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public static class AivnVol {
  static IAudioEndpointVolume V() { var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d = null; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d)); IAudioEndpointVolume v = null; var id = typeof(IAudioEndpointVolume).GUID; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, 0, out v)); return v; }
  public static int Get() { var v = V(); float r; Marshal.ThrowExceptionForHR(v.GetMasterVolumeLevelScalar(out r)); return (int)Math.Round(r * 100); }
  public static int Set(int pct) { var v = V(); Marshal.ThrowExceptionForHR(v.SetMute(false, Guid.Empty)); Marshal.ThrowExceptionForHR(v.SetMasterVolumeLevelScalar(pct / 100f, Guid.Empty)); float r; v.GetMasterVolumeLevelScalar(out r); return (int)Math.Round(r * 100); }
}
"@
${delta == null ? `[AivnVol]::Set(${Math.max(0, Math.min(100, Math.round(Number(level) || 0)))})` : `$b = [AivnVol]::Get(); $a = [AivnVol]::Set([Math]::Max(0, [Math]::Min(100, $b + (${Math.round(Number(delta) || 0)})))); "$b $a"`}
`;
async function systemAction(action, { platform = process.platform, keyTap = null, openExternal = null, level = null } = {}) {
  const win = platform === 'win32', mac = platform === 'darwin';
  const ps = (c) => run('powershell.exe', ['-NoProfile', '-Command', c]);
  const osa = (c) => run('osascript', ['-e', c]);
  let r;
  switch (action) {
    case 'lock': r = win ? await run('rundll32.exe', ['user32.dll,LockWorkStation']) : mac ? await run('pmset', ['displaysleepnow']) : await run('loginctl', ['lock-session']); break;
    case 'sleep': r = win ? await run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']) : mac ? await run('pmset', ['sleepnow']) : await run('systemctl', ['suspend']); break;
    case 'shutdown': r = win ? await run('shutdown', ['/s', '/t', '30', '/c', 'AIVN AGENT: máy sẽ tắt sau 30 giây (gõ shutdown /a để huỷ)']) : mac ? await osa('tell application "System Events" to shut down') : await run('systemctl', ['poweroff']); break;
    case 'restart': r = win ? await run('shutdown', ['/r', '/t', '30', '/c', 'AIVN AGENT: máy sẽ khởi động lại sau 30 giây (gõ shutdown /a để huỷ)']) : mac ? await osa('tell application "System Events" to restart') : await run('systemctl', ['reboot']); break;
    case 'volume_up': case 'volume_down': case 'mute':
      if (mac) r = await osa(action === 'mute' ? 'set volume output muted (not (output muted of (get volume settings)))' : `set volume output volume ((output volume of (get volume settings)) ${action === 'volume_up' ? '+' : '-'} 10)`);
      else if (keyTap) { const k = { volume_up: 'audio_vol_up', volume_down: 'audio_vol_down', mute: 'audio_mute' }[action]; for (let i = 0; i < (action === 'mute' ? 1 : 5); i++) keyTap(k); r = { ok: true }; }
      else r = await ps(`$w = New-Object -ComObject WScript.Shell; 1..5 | % { $w.SendKeys([char]${action === 'volume_up' ? 175 : action === 'volume_down' ? 174 : 173}) }`);
      break;
    case 'volume_set': {
      const n = Math.max(0, Math.min(100, Math.round(Number(level))));
      if (!Number.isFinite(n)) throw new Error('Thiếu mức âm lượng (0–100).');
      if (win) r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(PS_VOLUME(n))]);
      else if (mac) r = await osa(`set volume output volume ${n} without output muted`);
      else { r = await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', n + '%']); if (!r.ok) r = await run('amixer', ['-q', 'set', 'Master', n + '%', 'unmute']); }
      if (r.ok) return `Đặt âm lượng ${n}%`;
      break;
    }
    case 'volume_change': { // B89: “thêm 10%” = đọc mức hiện tại rồi đặt mức tuyệt đối hiện tại ± N (không phải một nấc phím âm lượng)
      const dl = Math.round(Number(level)); if (!Number.isFinite(dl) || !dl) throw new Error('Thiếu mức thay đổi âm lượng (±1–100).');
      let b = null, a2 = null;
      if (win) { r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(PS_VOLUME(null, dl))]); const m = /(\d+)\s+(\d+)/.exec(r.out || ''); if (m) { b = +m[1]; a2 = +m[2]; } }
      else if (mac) { const g = await osa('output volume of (get volume settings)'); b = parseInt(g.out, 10); if (Number.isFinite(b)) { a2 = Math.max(0, Math.min(100, b + dl)); r = await osa(`set volume output volume ${a2} without output muted`); } else r = g; }
      else { const g = await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@']); const m = /(\d+)%/.exec(g.out || ''); b = m ? +m[1] : null; if (b != null) { a2 = Math.max(0, Math.min(100, b + dl)); r = await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', a2 + '%']); } else r = g.ok ? { ok: false, err: 'không đọc được âm lượng hiện tại' } : g; }
      if (r.ok && b != null && a2 != null) return `Âm lượng ${b}% → ${a2}% (${dl > 0 ? '+' : ''}${dl}%)`;
      if (r.ok) r = { ok: false, err: 'không đọc được âm lượng sau khi đổi' };
      break;
    }
    case 'open_settings': if (openExternal && win) { await openExternal('ms-settings:'); r = { ok: true }; } else r = mac ? await run('open', ['x-apple.systempreferences:']) : await run('gnome-control-center', []); break;
    case 'show_desktop': r = win ? await ps('(New-Object -ComObject Shell.Application).MinimizeAll()') : mac ? await osa('tell application "System Events" to key code 103') : { ok: false, err: 'Chưa hỗ trợ trên Linux' }; break;
    case 'empty_trash': r = win ? await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue') : mac ? await osa('tell application "Finder" to empty trash') : { ok: false, err: 'Chưa hỗ trợ trên Linux' }; break;
    default: throw new Error('Thao tác không hỗ trợ: ' + action);
  }
  if (!r.ok) throw new Error((r.err || '').trim().split('\n')[0] || 'Không thực hiện được');
  return SYS[action].label;
}

// B66a (máy thật: open_app('Gmail') bị tìm như ứng dụng cài trên máy): ứng dụng WEB → trước hết tìm cửa sổ/thẻ trình duyệt đang mở có tên đó,
// không có thì mở đúng địa chỉ trên trình duyệt. web: true = chỉ có bản web (không tìm ứng dụng cài, trừ khi có ứng dụng trùng tên hẳn, vd. PWA “Gmail”);
// web: false = thường có bản cài (Messenger, Teams, Telegram…) → thử ứng dụng cài trước, không được mới mở bản web.
const WEB_APPS = [
  [/^(?:gmail|g mail|google mail|hop thu gmail)$/, 'Gmail', 'https://mail.google.com/', true],
  [/^(?:outlook web|outlook online|outlook\.com|hotmail|outlook live)$/, 'Outlook', 'https://outlook.live.com/mail/', true],
  [/^(?:outlook)$/, 'Outlook', 'https://outlook.live.com/mail/', false],
  [/^(?:messenger web|facebook messenger web)$/, 'Messenger', 'https://www.messenger.com/', true],
  [/^(?:messenger|facebook messenger)$/, 'Messenger', 'https://www.messenger.com/', false],
  [/^(?:facebook|fb|face book)$/, 'Facebook', 'https://www.facebook.com/', true],
  [/^(?:youtube|you tube|yt)$/, 'YouTube', 'https://www.youtube.com/', true],
  [/^(?:google docs|docs|google tai lieu|tai lieu google)$/, 'Google Docs', 'https://docs.google.com/document/', true],
  [/^(?:google sheets|sheets|google trang tinh)$/, 'Google Sheets', 'https://docs.google.com/spreadsheets/', true],
  [/^(?:google slides|slides|google trang trinh bay)$/, 'Google Slides', 'https://docs.google.com/presentation/', true],
  [/^(?:google drive|drive)$/, 'Google Drive', 'https://drive.google.com/', true],
  [/^(?:google classroom|classroom)$/, 'Google Classroom', 'https://classroom.google.com/', true],
  [/^(?:google calendar|lich google)$/, 'Google Calendar', 'https://calendar.google.com/', true],
  [/^(?:google meet|meet)$/, 'Google Meet', 'https://meet.google.com/', true],
  [/^(?:google|google search)$/, 'Google', 'https://www.google.com/', true],
  [/^(?:zalo web)$/, 'Zalo', 'https://chat.zalo.me/', true],
  [/^(?:telegram web)$/, 'Telegram', 'https://web.telegram.org/', true],
  [/^(?:telegram)$/, 'Telegram', 'https://web.telegram.org/', false],
  [/^(?:whatsapp web)$/, 'WhatsApp', 'https://web.whatsapp.com/', true],
  [/^(?:whatsapp)$/, 'WhatsApp', 'https://web.whatsapp.com/', false],
  [/^(?:teams web)$/, 'Microsoft Teams', 'https://teams.microsoft.com/', true],
  [/^(?:instagram|insta)$/, 'Instagram', 'https://www.instagram.com/', true],
  [/^(?:tiktok|tik tok)$/, 'TikTok', 'https://www.tiktok.com/', true],
  [/^(?:shopee)$/, 'Shopee', 'https://shopee.vn/', true],
  [/^(?:chatgpt|chat gpt)$/, 'ChatGPT', 'https://chatgpt.com/', true],
  [/^(?:gemini|google gemini)$/, 'Gemini', 'https://gemini.google.com/', true],
  [/^(?:canva)$/, 'Canva', 'https://www.canva.com/', true],
];
function webApp(name) {
  const f = fold(String(name || '')).replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/\b(?:trang|web ?site|app|ung dung|tren trinh duyet|trinh duyet|mo)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const r = WEB_APPS.find(([re]) => re.test(f)); if (r) return { name: r[1], url: r[2], webOnly: r[3] };
  const nw = f.replace(/\b(?:web|online)\b/g, ' ').replace(/\s+/g, ' ').trim(); // “Gmail web”, “YouTube online” → bản web
  const r2 = nw !== f && WEB_APPS.find(([re]) => re.test(nw)); return r2 ? { name: r2[1], url: r2[2], webOnly: true } : null;
}
module.exports = { WEB_APPS, webApp, PS_VOLUME, lnkTarget, winDirs, psEncoded, PS_APPS, deepApps, parseWinApps, macSpotlight, mergeApps, exeFromIcon, checkCommand, listApps, findApp, score, fold, expandPath, knownFolder, EXEC_EXT, runCommand, runningApps, matchRunning, closeApp, systemAction, SYS, sysAsked, WIN_BUILTIN, PROTECTED, BLOCK };
