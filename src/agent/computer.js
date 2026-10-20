// Truy cập máy tính cấp 1 cho AIVN BOT: liệt kê/mở ứng dụng, mở tệp/thư mục/địa chỉ web, đóng ứng dụng,
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
function listApps({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const out = [];
  if (platform === 'win32') {
    const roots = [path.join(env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
    const files = []; for (const r of roots) walk(r, 4, files, (e) => e.isFile() && /\.(lnk|url|appref-ms)$/i.test(e.name));
    const desk = [path.join(env.USERPROFILE || home, 'Desktop'), path.join(env.PUBLIC || 'C:\\Users\\Public', 'Desktop'), path.join(env.OneDrive || path.join(home, 'OneDrive'), 'Desktop')];
    for (const d of desk) walk(d, 0, files, (e) => e.isFile() && /\.(lnk|url|appref-ms)$/i.test(e.name));
    for (const f of files) { const name = path.basename(f).replace(/\.(lnk|url|appref-ms)$/i, ''); if (/^(uninstall|gỡ|readme|help|website|license|release notes)\b|\buninstall\b/i.test(name)) continue; out.push({ name, path: f, source: 'shortcut' }); }
    // ứng dụng cài theo người dùng (Zalo, VS Code, Discord…): %LOCALAPPDATA%\Programs\<Tên>\<Tên>.exe
    const progs = path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs');
    let dirs = []; try { dirs = fs.readdirSync(progs, { withFileTypes: true }).filter(e => e.isDirectory()); } catch {}
    for (const d of dirs) {
      let exes = []; try { exes = fs.readdirSync(path.join(progs, d.name)).filter(f => /\.exe$/i.test(f) && !/unins|update|setup|crash|helper/i.test(f)); } catch {}
      const exe = exes.find(f => fold(f.replace(/\.exe$/i, '')) === fold(d.name)) || exes.find(f => fold(f).startsWith(fold(d.name).slice(0, 3))) || (exes.length === 1 ? exes[0] : null);
      if (exe) out.push({ name: d.name, path: path.join(progs, d.name, exe), source: 'localappdata' });
    }
  } else if (platform === 'darwin') {
    const files = []; for (const r of ['/Applications', '/System/Applications', '/System/Applications/Utilities', '/Applications/Utilities', path.join(home, 'Applications')]) walk(r, 1, files, (e) => e.name.endsWith('.app'));
    for (const f of files) out.push({ name: path.basename(f, '.app'), path: f });
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
const PS_APPS = `$ErrorActionPreference='SilentlyContinue'
$o=@()
foreach($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'){ Get-ItemProperty $k | Where-Object { $_.DisplayName -and -not $_.SystemComponent } | ForEach-Object { $o += [pscustomobject]@{ s='uninstall'; n=$_.DisplayName; i=$_.DisplayIcon; l=$_.InstallLocation } } }
foreach($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\*'){ Get-ItemProperty $k | ForEach-Object { $o += [pscustomobject]@{ s='apppath'; n=$_.PSChildName; i=$_.'(default)' } } }
if(Get-Command Get-StartApps){ Get-StartApps | ForEach-Object { $o += [pscustomobject]@{ s='start'; n=$_.Name; a=$_.AppID } } }
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$o | ConvertTo-Json -Compress -Depth 2`;
function exeFromIcon(icon, loc, name) {
  let p = String(icon || '').trim().replace(/^"|"?,\s*-?\d+$|"$/g, '').replace(/^"|"$/g, '');
  if (/\.exe$/i.test(p) && !/unins|setup|update/i.test(path.basename(p))) return p;
  if (loc) { try { const ex = fs.readdirSync(loc).filter(f => /\.exe$/i.test(f) && !/unins|setup|update|crash/i.test(f)); const hit = ex.find(f => fold(name).includes(fold(f.replace(/\.exe$/i, '')))) || ex[0]; if (hit) return path.join(loc, hit); } catch {} }
  return null;
}
function parseWinApps(json) {
  let arr; try { arr = JSON.parse(json || '[]'); } catch { return []; }
  if (!Array.isArray(arr)) arr = [arr];
  const out = [];
  for (const x of arr) {
    if (!x || !x.n) continue;
    if (x.s === 'start') out.push({ name: x.n, appId: x.a, source: 'start' });
    else if (x.s === 'apppath') { const exe = String(x.i || '').replace(/^"|"$/g, ''); if (exe) out.push({ name: x.n.replace(/\.exe$/i, ''), path: exe, source: 'apppath' }); }
    else { const exe = exeFromIcon(x.i, x.l, x.n); if (exe) out.push({ name: x.n, path: exe, source: 'uninstall' }); else out.push({ name: x.n, path: null, source: 'uninstall' }); }
  }
  return out;
}
async function deepApps({ platform = process.platform, run = null } = {}) {
  const exec_ = run || ((cmd, args) => new Promise(res => execFile(cmd, args, { timeout: 20000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (e, out) => res(e ? '' : String(out)))));
  if (platform === 'win32') return parseWinApps(await exec_('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_APPS]));
  return [];
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
const SYS = {
  lock: { label: 'Khoá màn hình', confirm: false },
  sleep: { label: 'Cho máy ngủ', confirm: true },
  shutdown: { label: 'Tắt máy', confirm: true, danger: true },
  restart: { label: 'Khởi động lại máy', confirm: true, danger: true },
  volume_up: { label: 'Tăng âm lượng', confirm: false }, volume_down: { label: 'Giảm âm lượng', confirm: false }, mute: { label: 'Tắt/bật tiếng', confirm: false },
  open_settings: { label: 'Mở Cài đặt hệ thống', confirm: false },
  show_desktop: { label: 'Hiện màn hình chính (thu nhỏ mọi cửa sổ)', confirm: false },
  empty_trash: { label: 'Dọn Thùng rác', confirm: true, danger: true },
};
async function systemAction(action, { platform = process.platform, keyTap = null, openExternal = null } = {}) {
  const win = platform === 'win32', mac = platform === 'darwin';
  const ps = (c) => run('powershell.exe', ['-NoProfile', '-Command', c]);
  const osa = (c) => run('osascript', ['-e', c]);
  let r;
  switch (action) {
    case 'lock': r = win ? await run('rundll32.exe', ['user32.dll,LockWorkStation']) : mac ? await run('pmset', ['displaysleepnow']) : await run('loginctl', ['lock-session']); break;
    case 'sleep': r = win ? await run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']) : mac ? await run('pmset', ['sleepnow']) : await run('systemctl', ['suspend']); break;
    case 'shutdown': r = win ? await run('shutdown', ['/s', '/t', '30', '/c', 'AIVN BOT: máy sẽ tắt sau 30 giây (gõ shutdown /a để huỷ)']) : mac ? await osa('tell application "System Events" to shut down') : await run('systemctl', ['poweroff']); break;
    case 'restart': r = win ? await run('shutdown', ['/r', '/t', '30', '/c', 'AIVN BOT: máy sẽ khởi động lại sau 30 giây (gõ shutdown /a để huỷ)']) : mac ? await osa('tell application "System Events" to restart') : await run('systemctl', ['reboot']); break;
    case 'volume_up': case 'volume_down': case 'mute':
      if (mac) r = await osa(action === 'mute' ? 'set volume output muted (not (output muted of (get volume settings)))' : `set volume output volume ((output volume of (get volume settings)) ${action === 'volume_up' ? '+' : '-'} 10)`);
      else if (keyTap) { const k = { volume_up: 'audio_vol_up', volume_down: 'audio_vol_down', mute: 'audio_mute' }[action]; for (let i = 0; i < (action === 'mute' ? 1 : 5); i++) keyTap(k); r = { ok: true }; }
      else r = await ps(`$w = New-Object -ComObject WScript.Shell; 1..5 | % { $w.SendKeys([char]${action === 'volume_up' ? 175 : action === 'volume_down' ? 174 : 173}) }`);
      break;
    case 'open_settings': if (openExternal && win) { await openExternal('ms-settings:'); r = { ok: true }; } else r = mac ? await run('open', ['x-apple.systempreferences:']) : await run('gnome-control-center', []); break;
    case 'show_desktop': r = win ? await ps('(New-Object -ComObject Shell.Application).MinimizeAll()') : mac ? await osa('tell application "System Events" to key code 103') : { ok: false, err: 'Chưa hỗ trợ trên Linux' }; break;
    case 'empty_trash': r = win ? await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue') : mac ? await osa('tell application "Finder" to empty trash') : { ok: false, err: 'Chưa hỗ trợ trên Linux' }; break;
    default: throw new Error('Thao tác không hỗ trợ: ' + action);
  }
  if (!r.ok) throw new Error((r.err || '').trim().split('\n')[0] || 'Không thực hiện được');
  return SYS[action].label;
}

module.exports = { deepApps, parseWinApps, macSpotlight, mergeApps, exeFromIcon, checkCommand, listApps, findApp, score, fold, expandPath, knownFolder, EXEC_EXT, runCommand, runningApps, matchRunning, closeApp, systemAction, SYS, WIN_BUILTIN, PROTECTED, BLOCK };
