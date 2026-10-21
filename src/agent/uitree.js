// Cây giao diện (UI tree) của cửa sổ đang dùng, để mô hình KHÔNG nhìn ảnh (Qwen3 4B/8B) vẫn thao tác được theo id/tên phần tử.
// Windows: UI Automation (.NET, qua PowerShell). macOS: Accessibility (JXA/osascript). Linux: danh sách cửa sổ (xdotool) + chữ OCR.
// Toạ độ "gốc" (native) của từng nền tảng: Windows = điểm ảnh vật lý, macOS = point, Linux = điểm ảnh X11 — cùng hệ toạ độ libnut dùng để bấm.
const { execFile } = require('child_process');

const psEncoded = (script) => Buffer.from(script, 'utf16le').toString('base64');
function run(cmd, args, { timeout = 20000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env }, (err, out, errOut) => {
      if (err) { err.stderr = String(errOut || '').slice(0, 2000); return reject(err); }
      resolve(String(out || ''));
    });
  });
}
const ps = (script, env, timeout) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(script)], { env, timeout });

// ---------- Windows: UI Automation ----------
const PS_PRELUDE = String.raw`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
if (-not ('AivnW' -as [type])) {
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class AivnW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
}
"@
}
try { [void][AivnW]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { try { [void][AivnW]::SetProcessDPIAware() } catch {} }
`;
// Duyệt theo chiều rộng cửa sổ (hwnd hoặc cửa sổ đang dùng), lấy phần tử nhìn thấy được: vai trò, tên, khung, trạng thái
const PS_TREE = PS_PRELUDE + String.raw`
$max = [int]$env:AIVN_MAX; if ($max -le 0) { $max = 300 }
$h = [int64]$env:AIVN_HWND
if ($h -eq 0) { $h = [AivnW]::GetForegroundWindow().ToInt64() }
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$h)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$VP = [System.Windows.Automation.ValuePattern]::Pattern
$out = New-Object System.Collections.ArrayList
$q = New-Object System.Collections.Queue
$q.Enqueue(@($root, 0)); $seen = 0; $t0 = [DateTime]::UtcNow
while ($q.Count -gt 0 -and $out.Count -lt $max -and $seen -lt 2500 -and ([DateTime]::UtcNow - $t0).TotalSeconds -lt 12) {
  $it = $q.Dequeue(); $el = $it[0]; $d = $it[1]; $seen++
  try { $c = $el.Current } catch { continue }
  $r = $c.BoundingRectangle
  $vis = (-not $c.IsOffscreen) -and (-not $r.IsEmpty) -and $r.Width -gt 1 -and $r.Height -gt 1
  if ($vis -and $d -gt 0) {
    $ct = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    $v = $null
    if (($ct -eq 'Edit' -or $ct -eq 'ComboBox' -or $ct -eq 'Document') -and -not $c.IsPassword) { try { $v = $el.GetCurrentPattern($VP).Current.Value; if ($v.Length -gt 200) { $v = $v.Substring(0, 200) } } catch {} }
    [void]$out.Add([ordered]@{ r = $ct; n = $c.Name; a = $c.AutomationId; b = @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height); e = $c.IsEnabled; p = $c.IsPassword; f = $c.HasKeyboardFocus; v = $v; d = $d })
  }
  if ($d -lt 40 -and ($vis -or $d -eq 0)) {
    try { $ch = $walker.GetFirstChild($el); while ($ch -ne $null) { $q.Enqueue(@($ch, $d + 1)); $ch = $walker.GetNextSibling($ch) } } catch {}
  }
}
$rc = $root.Current; $rb = $rc.BoundingRectangle
$pn = ''; try { $pn = (Get-Process -Id $rc.ProcessId).ProcessName } catch {}
[ordered]@{ win = [ordered]@{ title = $rc.Name; pid = $rc.ProcessId; proc = $pn; hwnd = $h; b = @([int]$rb.X, [int]$rb.Y, [int]$rb.Width, [int]$rb.Height) }; els = $out; seen = $seen } | ConvertTo-Json -Depth 6 -Compress
`;
const PS_WINDOWS = PS_PRELUDE + String.raw`
$fg = [AivnW]::GetForegroundWindow().ToInt64()
$list = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { [ordered]@{ hwnd = $_.MainWindowHandle.ToInt64(); title = $_.MainWindowTitle; pid = $_.Id; proc = $_.ProcessName; active = ($_.MainWindowHandle.ToInt64() -eq $fg); min = [AivnW]::IsIconic($_.MainWindowHandle) } }
$list = @($list)
if ($fg -ne 0 -and -not ($list | Where-Object { $_.hwnd -eq $fg })) {
  $fp = [uint32]0; [void][AivnW]::GetWindowThreadProcessId([IntPtr]$fg, [ref]$fp); $sb = New-Object System.Text.StringBuilder 512; [void][AivnW]::GetWindowText([IntPtr]$fg, $sb, 512)
  $pn = ''; try { $pn = (Get-Process -Id $fp).ProcessName } catch {}
  $list += [ordered]@{ hwnd = $fg; title = $sb.ToString(); pid = [int]$fp; proc = $pn; active = $true; min = $false; dialog = $true }
}
@($list) | ConvertTo-Json -Depth 3 -Compress
`;
const PS_FOCUS = PS_PRELUDE + String.raw`
$h = [IntPtr][int64]$env:AIVN_HWND
if ([AivnW]::IsIconic($h)) { [void][AivnW]::ShowWindowAsync($h, 9) }
[AivnW]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [void][AivnW]::SetForegroundWindow($h); [void][AivnW]::BringWindowToTop($h); [AivnW]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150
[ordered]@{ ok = ([AivnW]::GetForegroundWindow() -eq $h) } | ConvertTo-Json -Compress
`;

// ---------- macOS: Accessibility qua JXA ----------
const JXA_TREE = String.raw`
function run(argv) {
  const max = Number(argv[0]) || 200; const want = argv[1] || '';
  const se = Application('System Events');
  const procs = want ? se.applicationProcesses.whose({ name: want }) : se.applicationProcesses.whose({ frontmost: true });
  if (!procs.length) return JSON.stringify({ win: null, els: [] });
  const p = procs[0]; let w = null; try { w = p.windows[0]; w.name(); } catch (e) { return JSON.stringify({ win: { title: '', proc: p.name(), pid: p.unixId() }, els: [] }); }
  const out = []; const q = [[w, 0]]; let seen = 0; const t0 = Date.now();
  const g = (f) => { try { const v = f(); return v == null ? null : v; } catch (e) { return null; } };
  while (q.length && out.length < max && seen < 900 && Date.now() - t0 < 12000) {
    const [el, d] = q.shift(); seen++;
    const pos = g(() => el.position()), size = g(() => el.size());
    if (d > 0 && pos && size && size[0] > 1 && size[1] > 1) {
      const role = g(() => el.role()) || '', sub = g(() => el.subrole()) || '';
      let name = g(() => el.name()) || g(() => el.title()) || g(() => el.description()) || '';
      let v = null; if (/AXTextField|AXTextArea|AXComboBox|AXSearchField/.test(role) && sub !== 'AXSecureTextField') { v = g(() => el.value()); if (v != null) v = String(v).slice(0, 200); }
      if (!name && role === 'AXStaticText') name = String(g(() => el.value()) || '');
      out.push({ r: role, s: sub, n: String(name).slice(0, 200), b: [Math.round(pos[0]), Math.round(pos[1]), Math.round(size[0]), Math.round(size[1])], e: g(() => el.enabled()) !== false, p: sub === 'AXSecureTextField', f: !!g(() => el.focused()), v: v, d: d });
    }
    if (d < 25) { const kids = g(() => el.uiElements()) || []; for (const k of kids) q.push([k, d + 1]); }
  }
  const wp = g(() => w.position()) || [0, 0], ws = g(() => w.size()) || [0, 0];
  return JSON.stringify({ win: { title: g(() => w.name()) || '', proc: p.name(), pid: g(() => p.unixId()), b: [wp[0], wp[1], ws[0], ws[1]] }, els: out, seen: seen });
}`;
const JXA_WINDOWS = String.raw`
function run() {
  const se = Application('System Events'); const out = [];
  for (const p of se.applicationProcesses.whose({ backgroundOnly: false })()) {
    let wins = []; try { wins = p.windows(); } catch (e) {}
    for (const w of wins) { let t = ''; try { t = w.name() || ''; } catch (e) {} out.push({ title: t, proc: p.name(), pid: p.unixId(), active: p.frontmost() }); }
  }
  return JSON.stringify(out);
}`;

// ---------- Linux (X11): xdotool ----------
async function linuxWindows() {
  let ids = [];
  try { ids = (await run('xdotool', ['search', '--onlyvisible', '--name', '.'])).split('\n').filter(Boolean); } catch { return []; }
  let active = ''; try { active = (await run('xdotool', ['getactivewindow'])).trim(); } catch {}
  const out = [];
  for (const id of ids.slice(0, 60)) {
    try {
      const title = (await run('xdotool', ['getwindowname', id])).trim(); if (!title) continue;
      let pid = null; try { pid = Number((await run('xdotool', ['getwindowpid', id])).trim()) || null; } catch {}
      const g = await run('xdotool', ['getwindowgeometry', '--shell', id]); const m = Object.fromEntries(g.split('\n').filter(Boolean).map(l => l.split('=')));
      if (+m.WIDTH < 50 || +m.HEIGHT < 50) continue;
      out.push({ hwnd: id, title, pid, active: id === active, b: [+m.X, +m.Y, +m.WIDTH, +m.HEIGHT] });
    } catch {}
  }
  return out;
}

// ---------- Chuẩn hoá ----------
const ROLE_VI = {
  Button: 'nút', SplitButton: 'nút', MenuItem: 'mục menu', Edit: 'ô nhập', Document: 'vùng soạn thảo', ComboBox: 'hộp chọn', ListItem: 'mục danh sách', DataItem: 'ô dữ liệu',
  TreeItem: 'mục cây', TabItem: 'thẻ', Hyperlink: 'liên kết', CheckBox: 'ô đánh dấu', RadioButton: 'nút chọn', Text: 'chữ', Image: 'ảnh', Slider: 'thanh trượt', Spinner: 'ô số',
  AXButton: 'nút', AXMenuItem: 'mục menu', AXMenuBarItem: 'mục menu', AXMenuButton: 'nút', AXPopUpButton: 'hộp chọn', AXTextField: 'ô nhập', AXSearchField: 'ô tìm kiếm', AXTextArea: 'vùng soạn thảo',
  AXComboBox: 'hộp chọn', AXRow: 'mục danh sách', AXCell: 'ô', AXLink: 'liên kết', AXCheckBox: 'ô đánh dấu', AXRadioButton: 'nút chọn', AXStaticText: 'chữ', AXImage: 'ảnh', AXTab: 'thẻ', AXRadioGroup: 'nhóm chọn',
  AXSlider: 'thanh trượt', AXDisclosureTriangle: 'nút mở rộng', OCR: 'chữ (OCR)',
};
const INTERACTIVE = new Set(['Button', 'SplitButton', 'MenuItem', 'Edit', 'Document', 'ComboBox', 'ListItem', 'DataItem', 'TreeItem', 'TabItem', 'Hyperlink', 'CheckBox', 'RadioButton', 'Slider', 'Spinner',
  'AXButton', 'AXMenuItem', 'AXMenuBarItem', 'AXMenuButton', 'AXPopUpButton', 'AXTextField', 'AXSearchField', 'AXTextArea', 'AXComboBox', 'AXRow', 'AXCell', 'AXLink', 'AXCheckBox', 'AXRadioButton', 'AXTab', 'AXSlider', 'AXDisclosureTriangle']);
const EDITABLE = /^(Edit|Document|ComboBox|AXTextField|AXSearchField|AXTextArea|AXComboBox)$/;
const PASSWORD_NAME = /(mật\s*khẩu|password|passcode|mã\s*pin|\bpin\b|\botp\b|mã\s*xác\s*(thực|nhận)|cvv|cvc)/i;

// raw: { win, els:[{r,n,b,e,p,f,v,a?,s?}] } → danh sách phần tử có id e1..eN, bỏ khung trống/không tên, gộp trùng
function normalize(raw, { max = 150, ocr = [] } = {}) {
  const win = raw && raw.win ? raw.win : null;
  const seen = new Set(); const els = [];
  const src = [...((raw && Array.isArray(raw.els)) ? raw.els : (raw && raw.els ? [raw.els] : [])), ...ocr.map(o => ({ r: 'OCR', n: o.text, b: o.b, e: true }))];
  for (const x of src) {
    if (!x || !Array.isArray(x.b) || x.b.length < 4) continue;
    const role = String(x.r || ''); const name = String(x.n || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const interactive = INTERACTIVE.has(role);
    if (!interactive && !name) continue; // khung/nhóm không tên: bỏ
    if (!interactive && !/^(Text|AXStaticText|OCR|Image|AXImage)$/.test(role)) { if (!name || name.length > 80) continue; }
    if (/^(Image|AXImage)$/.test(role) && !name) continue;
    const [x0, y0, w, h] = x.b.map(Number); if (!(w > 1 && h > 1)) continue;
    const key = role + '|' + name + '|' + Math.round(x0 / 4) + '|' + Math.round(y0 / 4); if (seen.has(key)) continue; seen.add(key);
    // chữ OCR nằm gọn trong phần tử đã có cùng tên → bỏ
    if (role === 'OCR' && els.some(e => e.name && name && e.name.toLowerCase().includes(name.toLowerCase()) && x0 >= e.b[0] - 4 && y0 >= e.b[1] - 4 && x0 + w <= e.b[0] + e.b[2] + 4 && y0 + h <= e.b[1] + e.b[3] + 4)) continue;
    els.push({ role, kind: ROLE_VI[role] || role.replace(/^AX/, '').toLowerCase() || 'phần tử', name, b: [Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)], enabled: x.e !== false,
      password: !!x.p || (EDITABLE.test(role) && PASSWORD_NAME.test(name)), focused: !!x.f, value: x.v != null && !x.p ? String(x.v).slice(0, 200) : null, editable: EDITABLE.test(role), ocr: role === 'OCR', autoId: x.a || null });
  }
  // ưu tiên phần tử tương tác, rồi chữ; giữ thứ tự đọc (trên → dưới, trái → phải)
  const pick = [...els.filter(e => !e.ocr && INTERACTIVE.has(e.role)), ...els.filter(e => !INTERACTIVE.has(e.role))].slice(0, max);
  pick.sort((a, b) => (Math.abs(a.b[1] - b.b[1]) < 8 ? a.b[0] - b.b[0] : a.b[1] - b.b[1]));
  pick.forEach((e, i) => { e.id = 'e' + (i + 1); });
  return { win, elements: pick };
}

// toạ độ gốc → thang 0..1000 của màn hình (để mô hình hình dung vị trí; khớp tham số x,y của screen_act)
function formatForModel(obs, { toNorm, limit = 120 } = {}) {
  const lines = [];
  if (obs.win) lines.push(`Cửa sổ đang dùng: "${obs.win.title || '(không tên)'}"${obs.win.proc ? ` (${obs.win.proc})` : ''}`);
  const els = obs.elements.slice(0, limit);
  if (!els.length) lines.push('(Không đọc được phần tử nào trong cửa sổ này.)');
  for (const e of els) {
    const c = toNorm ? toNorm(e.b[0] + e.b[2] / 2, e.b[1] + e.b[3] / 2) : null;
    const flags = [e.focused && 'đang chọn', !e.enabled && 'đang mờ', e.password && 'Ô MẬT KHẨU – không gõ'].filter(Boolean);
    lines.push(`[${e.id}] ${e.kind}${e.name ? ` "${e.name}"` : ''}${e.value ? ` = "${e.value.slice(0, 80)}"` : ''}${c ? ` @${c.x},${c.y}` : ''}${flags.length ? ' (' + flags.join(', ') + ')' : ''}`);
  }
  if (obs.elements.length > els.length) lines.push(`… và ${obs.elements.length - els.length} phần tử khác (dùng screen_look với query để lọc).`);
  return lines.join('\n');
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
// tìm phần tử theo id ("e12", "[e12]") hoặc theo tên/mô tả ("nút Gửi", "ô tìm kiếm")
function findElement(elements, query) {
  const q = String(query || '').trim(); if (!q) return null;
  const idm = q.match(/^\[?(e\d+)\]?$/i); if (idm) return elements.find(e => e.id === idm[1].toLowerCase()) || null;
  const fq = fold(q.replace(/^(nút|ô|mục|thẻ|liên kết|chữ|biểu tượng|icon|button)\s+/i, '').replace(/^["“']|["”']$/g, ''));
  if (!fq) return null;
  const wantEdit = /(ô nhập|ô tìm|ô chat|ô soạn|ô tin nhắn|vùng soạn|soạn thảo|vùng văn bản|text ?box|text ?area|search ?box|input|editor)/i.test(q);
  let best = null;
  for (const e of elements) {
    const n = fold(e.name); if (!n && !(wantEdit && e.editable)) continue;
    let s = 0;
    if (!n) s = 40;
    else if (n === fq) s = 100; else if (n.startsWith(fq)) s = 85; else if (n.includes(fq)) s = 70; else if (fq.includes(n) && n.length >= 3) s = 55;
    else { const words = fq.split(' ').filter(w => w.length > 1); const hit = words.filter(w => n.includes(w)).length; if (words.length && hit) s = 30 + 30 * hit / words.length; }
    if (wantEdit && e.editable) s += 25;
    if (!e.ocr && INTERACTIVE.has(e.role)) s += 5;
    if (!e.enabled) s -= 20;
    if (s > 0 && (!best || s > best.s)) best = { e, s };
  }
  return best && best.s >= 45 ? best.e : null;
}

async function tree({ hwnd = 0, app = '', max = 300 } = {}) {
  if (process.platform === 'win32') { const o = await ps(PS_TREE, { AIVN_HWND: String(hwnd || 0), AIVN_MAX: String(max) }, 25000); return JSON.parse(o.trim() || '{}'); }
  if (process.platform === 'darwin') { const o = await run('osascript', ['-l', 'JavaScript', '-e', JXA_TREE, String(Math.min(max, 220)), app || ''], { timeout: 25000 }); return JSON.parse(o.trim() || '{}'); }
  const wins = await linuxWindows(); const w = wins.find(x => (hwnd ? String(x.hwnd) === String(hwnd) : x.active)) || null;
  return { win: w ? { title: w.title, pid: w.pid, hwnd: w.hwnd, b: w.b } : null, els: [], noTree: true };
}
async function windows() {
  if (process.platform === 'win32') { const o = (await ps(PS_WINDOWS, null, 15000)).trim(); const j = o ? JSON.parse(o) : []; return Array.isArray(j) ? j : [j]; }
  if (process.platform === 'darwin') return JSON.parse((await run('osascript', ['-l', 'JavaScript', '-e', JXA_WINDOWS], { timeout: 15000 })).trim() || '[]');
  return linuxWindows();
}
function matchWindow(list, query) {
  const fq = fold(query); if (!fq) return null;
  let best = null;
  for (const w of list) {
    const t = fold(w.title), p = fold(w.proc || '');
    let s = 0; if (p === fq || t === fq) s = 100; else if (t.includes(fq) || p.includes(fq)) s = 70; else { const ws = fq.split(' ').filter(Boolean); const h = ws.filter(x => t.includes(x) || p.includes(x)).length; if (h) s = 40 * h / ws.length; }
    if (s && (!best || s > best.s)) best = { w, s };
  }
  return best && best.s >= 40 ? best.w : null;
}
async function focus(w) {
  if (!w) return false;
  if (process.platform === 'win32') { const o = await ps(PS_FOCUS, { AIVN_HWND: String(w.hwnd) }, 10000); try { return JSON.parse(o.trim()).ok; } catch { return false; } }
  if (process.platform === 'darwin') { await run('osascript', ['-e', `tell application "System Events" to set frontmost of (first application process whose unix id is ${Number(w.pid)}) to true`]); return true; }
  await run('xdotool', ['windowactivate', '--sync', String(w.hwnd)], { timeout: 5000 }); return true;
}

// Cửa sổ đang ở trước cùng có thuộc cùng ứng dụng với cửa sổ mục tiêu nhưng là cửa sổ khác (hộp thoại Lưu, Mở…)?
function activeDialogOf(list, target) {
  if (!target || !Array.isArray(list)) return null;
  const a = list.find(w => w.active); if (!a) return null;
  if (String(a.hwnd) === String(target.hwnd)) return null;
  return (target.pid && a.pid === target.pid) ? a : null;
}
// Đoạn gõ chỉ khác chữ hoa/dấu so với một đoạn trong ngoặc kép của người dùng → trả đúng nguyên văn người dùng
function restoreQuoted(text, query) {
  const qs = []; const re = /["“”'‘’«]([^"“”'‘’«»]{2,400})["“”'‘’»]/g; let m;
  while ((m = re.exec(String(query || '')))) qs.push(m[1]);
  const ft = fold(text).replace(/\s+/g, ' ').trim();
  for (const q of qs) if (q !== text && fold(q).replace(/\s+/g, ' ').trim() === ft) return q;
  return text;
}
// Việc quen thuộc → phím tắt (dùng khi danh sách không có nút có chữ)
const MOD = process.platform === 'darwin' ? 'cmd' : 'ctrl';
function shortcutFor(query) {
  const f = fold(query);
  const T = [[/luu thanh|save as|luu duoi ten/, `${MOD}+shift+s`, 'Lưu thành…'], [/\bluu\b|\bsave\b/, `${MOD}+s`, 'lưu tệp'], [/mo tep|mo file|\bopen\b/, `${MOD}+o`, 'mở tệp'], [/tao moi|tep moi|\bnew\b/, `${MOD}+n`, 'tạo mới'],
    [/\bin\b|print/, `${MOD}+p`, 'in'], [/tim kiem|\bfind\b|\bsearch\b|\btim\b/, `${MOD}+f`, 'tìm'], [/hoan tac|undo/, `${MOD}+z`, 'hoàn tác'], [/chon het|select all/, `${MOD}+a`, 'chọn hết'],
    [/sao chep|\bcopy\b/, `${MOD}+c`, 'sao chép'], [/\bdan\b|paste/, `${MOD}+v`, 'dán']];
  for (const [re, keys, label] of T) if (re.test(f)) return { keys, label };
  return null;
}

// Ứng dụng Electron/Chromium (Zalo, Slack, Teams, VS Code…) gần như không cho đọc nút/ô qua Trợ năng: cần ảnh chụp + mô hình nhìn ảnh
const POOR_TREE_APPS = /^(zalo|zalopc|electron|code|cursor|slack|discord|teams|ms-teams|msteams|notion|figma|whatsapp|whatsapp\.root|messenger|spotify|skype|obsidian|postman|signal|lark|feishu|telegram|viber|line|kakaotalk|wechat|weixin)$/i;
const poorTreeApp = (proc) => POOR_TREE_APPS.test(String(proc || '').replace(/\.exe$/i, '').trim());
// bỏ dấu tiếng Việt nhưng giữ chữ hoa ("Trần Quỳnh Anh" → "Tran Quynh Anh")
const noDiacritics = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFC');
// các cách tìm lần lượt khi ô tìm kiếm không ra kết quả: nguyên văn → không dấu → tên gọi (2 chữ cuối) → tên (chữ cuối)
function searchVariants(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' '); if (!t) return [];
  // danh bạ thường lưu tên không dấu: mỗi cách tìm một phần tên đều thử cả bản có dấu và không dấu
  const w = t.split(' '); const out = [t, noDiacritics(t)];
  if (w.length >= 3) { const two = w.slice(-2).join(' '); out.push(two, noDiacritics(two)); }
  if (w.length >= 2) { const one = w[w.length - 1]; out.push(one, noDiacritics(one)); }
  const seen = new Set(); return out.filter(x => x && x.length >= 2 && !seen.has(x) && seen.add(x));
}
// Chữ OCR trông như ô nhập (chữ gợi ý "Tìm kiếm", "Nhập tin nhắn…"): ở ứng dụng không đọc được qua Trợ năng (Zalo…), đó là ô nhập thật
const INPUT_HINT = /(^|\s)(tìm|tim|search|find|nhập|nhap|soạn|soan|gõ|type|write|enter)(\s|$|…|\.)|tìm kiếm|tim kiem|tin nhắn|tin nhan|message|aa$/i;
const inputLike = (el) => !!(el && !el.editable && el.ocr && String(el.name || '').trim().length <= 40 && INPUT_HINT.test(String(el.name || '').trim()));
module.exports = { inputLike, poorTreeApp, POOR_TREE_APPS, noDiacritics, searchVariants, activeDialogOf, shortcutFor, restoreQuoted, tree, windows, focus, matchWindow, normalize, formatForModel, findElement, fold, PASSWORD_NAME, ROLE_VI, INTERACTIVE, PS_TREE, PS_WINDOWS, PS_FOCUS, JXA_TREE, JXA_WINDOWS, linuxWindows };
