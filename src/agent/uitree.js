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
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@
}
try { [void][AivnW]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { try { [void][AivnW]::SetProcessDPIAware() } catch {} }
`;
// Duyệt theo chiều rộng cửa sổ (hwnd hoặc cửa sổ đang dùng), lấy phần tử nhìn thấy được: vai trò, tên, khung, trạng thái
const PS_TREE = PS_PRELUDE + String.raw`
$max = [int]$env:AIVN_MAX; if ($max -le 0) { $max = 300 }
$vmax = 200; try { if ($env:AIVN_VMAX -and [int]$env:AIVN_VMAX -gt $vmax) { $vmax = [int]$env:AIVN_VMAX } } catch {}
$h = [int64]$env:AIVN_HWND
if ($h -eq 0) { $h = [AivnW]::GetForegroundWindow().ToInt64() }
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$h)
$VP = [System.Windows.Automation.ValuePattern]::Pattern
$script:seen = 0
# B124: duyệt theo một bộ duyệt (ControlView mặc định; RawView khi ControlView gần như rỗng — Chromium/Electron như Zalo, Chrome)
function Walk($walker, $secs) {
  $out = New-Object System.Collections.ArrayList
  $q = New-Object System.Collections.Queue
  $q.Enqueue(@($root, 0)); $script:seen = 0; $t0 = [DateTime]::UtcNow; $script:cutTrunc = $false; $script:cutTime = $false; $script:cutPartial = $false
  while ($q.Count -gt 0 -and $out.Count -lt $max -and $script:seen -lt 2500 -and ([DateTime]::UtcNow - $t0).TotalSeconds -lt $secs) {
    $it = $q.Dequeue(); $el = $it[0]; $d = $it[1]; $script:seen++
    try { $c = $el.Current } catch { $script:cutPartial = $true; continue }
    $r = $c.BoundingRectangle
    $vis = (-not $c.IsOffscreen) -and (-not $r.IsEmpty) -and $r.Width -gt 1 -and $r.Height -gt 1
    if ($vis -and $d -gt 0) {
      $ct = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
      $v = $null
      if (($ct -eq 'Edit' -or $ct -eq 'ComboBox' -or $ct -eq 'Document') -and -not $c.IsPassword) {
        $vpOk = $false
        try { $v = $el.GetCurrentPattern($VP).Current.Value; $vpOk = $true } catch { $v = $null }
        if ($ct -eq 'Document' -and (-not $vpOk -or $null -eq $v -or [string]$v -eq '')) {
          $tpOk = $false
          try { $TP = [System.Windows.Automation.TextPattern]::Pattern; $v = $el.GetCurrentPattern($TP).DocumentRange.GetText($vmax); $tpOk = $true } catch { $v = $null }
          if (-not $tpOk) { $v = $null }
        }
        if ($null -ne $v -and $v.Length -ge $vmax) { if ($v.Length -gt $vmax) { $v = $v.Substring(0, $vmax) }; $script:cutPartial = $true }
      }
      [void]$out.Add([ordered]@{ r = $ct; n = $c.Name; a = $c.AutomationId; b = @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height); e = $c.IsEnabled; p = $c.IsPassword; f = $c.HasKeyboardFocus; v = $v; d = $d })
    }
    if ($d -lt 40 -and ($vis -or $d -eq 0)) {
      try { $ch = $walker.GetFirstChild($el); while ($ch -ne $null) { $q.Enqueue(@($ch, $d + 1)); $ch = $walker.GetNextSibling($ch) } } catch { $script:cutPartial = $true }
    } elseif ($d -ge 40) { $script:cutPartial = $true }
  }
  # Dừng khi còn nút chưa duyệt: hết giờ, hoặc cắt vì đủ $max / đủ 2500 phần tử (dòng điều kiện vòng lặp phía trên).
  if ($q.Count -gt 0) { if (([DateTime]::UtcNow - $t0).TotalSeconds -ge $secs) { $script:cutTime = $true } else { $script:cutTrunc = $true } }
  return ,$out
}
$out = Walk ([System.Windows.Automation.TreeWalker]::ControlViewWalker) 10; $via = 'control'; $seen0 = $script:seen; $trunc = [bool]$script:cutTrunc; $timed = [bool]$script:cutTime; $part = [bool]$script:cutPartial
$named = @($out | Where-Object { $_.n }).Count
if ($named -lt 3) {
  try { $o2 = Walk ([System.Windows.Automation.TreeWalker]::RawViewWalker) 6; $n2 = @($o2 | Where-Object { $_.n }).Count; if ($n2 -gt $named) { $out = $o2; $via = 'raw'; $named = $n2; $trunc = [bool]$script:cutTrunc; $timed = [bool]$script:cutTime; $part = [bool]$script:cutPartial } } catch { $part = $true }
}
$seen = $script:seen
# chẩn đoán khi cây nghèo: lớp/framework của gốc + các con cấp 1 (RawView)
$diag = $null
if ($named -lt 3) {
  $kids = New-Object System.Collections.ArrayList
  try { $rw = [System.Windows.Automation.TreeWalker]::RawViewWalker; $ch = $rw.GetFirstChild($root); $k = 0; while ($ch -ne $null -and $k -lt 8) { $cc = $ch.Current; [void]$kids.Add(('{0}|{1}|{2}' -f ($cc.ControlType.ProgrammaticName -replace '^ControlType\.', ''), $cc.ClassName, $cc.Name)); $k++; $ch = $rw.GetNextSibling($ch) } } catch {}
  $rc0 = $root.Current
  $diag = [ordered]@{ via = $via; seenControl = $seen0; seen = $seen; named = $named; cls = $rc0.ClassName; fw = $rc0.FrameworkId; kids = $kids }
}
$rc = $root.Current; $rb = $rc.BoundingRectangle
$pn = ''; try { $pn = (Get-Process -Id $rc.ProcessId).ProcessName } catch {}
[ordered]@{ win = [ordered]@{ title = $rc.Name; pid = $rc.ProcessId; proc = $pn; hwnd = $h; b = @([int]$rb.X, [int]$rb.Y, [int]$rb.Width, [int]$rb.Height) }; els = $out; seen = $seen; via = $via; diag = $diag; truncated = [bool]$trunc; timedOut = [bool]$timed; partial = [bool]$part; dpi = @{ cx = [AivnW]::GetSystemMetrics(0); cy = [AivnW]::GetSystemMetrics(1) } } | ConvertTo-Json -Depth 6 -Compress
`;
// Mọi cửa sổ nhìn thấy, không bị che (cloaked) — kể cả cửa sổ thứ hai của cùng một tiến trình (Notepad mở hai tệp).
// EnumWindows + IsWindowVisible + DWMWA_CLOAKED. Cửa sổ thu nhỏ vẫn được liệt kê (min) để người gọi bỏ qua.
const PS_WINDOWS = PS_PRELUDE + String.raw`
$fg = [AivnW]::GetForegroundWindow().ToInt64()
if (-not ('AivnEnum' -as [type])) {
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class AivnEnum {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public static List<long> Collect() {
    var xs = new List<long>();
    EnumProc cb = (h, l) => { xs.Add(h.ToInt64()); return true; };
    EnumWindows(cb, IntPtr.Zero);
    GC.KeepAlive(cb);
    return xs;
  }
  public static bool OnScreen(IntPtr h) {
    if (!IsWindowVisible(h)) return false;
    int v = 0;
    try { DwmGetWindowAttribute(h, 14, out v, sizeof(int)); } catch { v = 0; }
    return v == 0;
  }
  public static int[] Box(IntPtr h) {
    RECT r;
    if (!GetWindowRect(h, out r)) return null;
    return new int[] { r.L, r.T, r.R - r.L, r.B - r.T };
  }
}
"@
}
$list = New-Object System.Collections.ArrayList
foreach ($id in [AivnEnum]::Collect()) {
  $h = [IntPtr]$id
  if (-not [AivnEnum]::OnScreen($h)) { continue }
  $box = [AivnEnum]::Box($h)
  if ($null -eq $box) { continue }
  $ww = $box[2]; $hh = $box[3]
  $min = [AivnEnum]::IsIconic($h)
  if (-not $min -and ($ww -lt 40 -or $hh -lt 40)) { continue }
  $sb = New-Object System.Text.StringBuilder 2048
  [void][AivnEnum]::GetWindowText($h, $sb, 2048)
  $title = $sb.ToString()
  [uint32]$wpid = 0
  [void][AivnEnum]::GetWindowThreadProcessId($h, [ref]$wpid)
  $pn = ''
  try { $pn = (Get-Process -Id $wpid -ErrorAction SilentlyContinue).ProcessName } catch {}
  [void]$list.Add([ordered]@{ hwnd = [int64]$id; title = $title; pid = [int]$wpid; proc = $pn; active = ([int64]$id -eq $fg); min = [bool]$min; b = @([int]$box[0], [int]$box[1], [int]$ww, [int]$hh) })
}
@($list) | ConvertTo-Json -Depth 4 -Compress
`;
const PS_FOCUS = PS_PRELUDE + String.raw`
$h = [IntPtr][int64]$env:AIVN_HWND
if ([AivnW]::IsIconic($h)) { [void][AivnW]::ShowWindowAsync($h, 9) }
[AivnW]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [void][AivnW]::SetForegroundWindow($h); [void][AivnW]::BringWindowToTop($h); [AivnW]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150
[ordered]@{ ok = ([AivnW]::GetForegroundWindow() -eq $h) } | ConvertTo-Json -Compress
`;

// B62: cửa sổ NẰM DƯỚI điểm sắp bấm (WindowFromPoint → cửa sổ gốc): nếu là cửa sổ của chính AIVN (lớp phủ…) thì cú bấm bị nuốt
const PS_WINAT = PS_PRELUDE + String.raw`
if (-not ('AivnP' -as [type])) { Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public struct AivnPt { public int X; public int Y; }
public static class AivnP {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(AivnPt p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
}
"@ }
$pt = New-Object AivnPt; $pt.X = [int]$env:AIVN_X; $pt.Y = [int]$env:AIVN_Y
$w = [AivnP]::WindowFromPoint($pt); $r = [AivnP]::GetAncestor($w, 2)
$sb = New-Object System.Text.StringBuilder 256; [void][AivnW]::GetWindowText($r, $sb, 256); [uint32]$wpid = 0; [void][AivnW]::GetWindowThreadProcessId($r, [ref]$wpid)
$ex = [AivnP]::GetWindowLong($r, -20)
[ordered]@{ hwnd = $r.ToInt64(); title = $sb.ToString(); pid = [int]$wpid; transparent = (($ex -band 0x20) -ne 0); layered = (($ex -band 0x80000) -ne 0) } | ConvertTo-Json -Compress
`;
async function windowAt(x, y) { if (process.platform !== 'win32') return null; try { const o = await ps(PS_WINAT, { AIVN_X: String(Math.round(x)), AIVN_Y: String(Math.round(y)) }, 8000); return JSON.parse(o.trim()); } catch { return null; } }
// Đặt con trỏ bằng SetCursorPos (PowerShell per-monitor-v2: toạ độ vật lý, mọi màn hình) — đường dự phòng khi chuột của libnut lệch
const PS_SETCURSOR = PS_PRELUDE + String.raw`
[void][AivnW]::SetCursorPos([int]$env:AIVN_X, [int]$env:AIVN_Y)
'ok'
`;
async function setCursor(x, y) { if (process.platform !== 'win32') return false; const o = await ps(PS_SETCURSOR, { AIVN_X: String(Math.round(x)), AIVN_Y: String(Math.round(y)) }, 10000); return /ok/.test(o); }
// UIA đọc trong tiến trình PowerShell KHÔNG nhận DPI → khung phần tử là toạ độ logic (nhỏ hơn thật 1,25 lần ở 125%): đổi về vật lý
function uiaScale(raw, primaryGeo) {
  const cx = raw && raw.dpi && Number(raw.dpi.cx); if (!cx || !primaryGeo) return 1;
  const k = primaryGeo.phys.width / cx; return Math.abs(k - 1) < 0.02 ? 1 : (k > 0.4 && k < 3.5 ? k : 1);
}
function rescaleTree(raw, k) {
  if (!raw || !k || k === 1) return raw; const m = (b) => Array.isArray(b) ? b.map(v => Math.round(v * k)) : b;
  if (raw.win && raw.win.b) raw.win.b = m(raw.win.b);
  for (const e of raw.els || []) if (e && e.b) e.b = m(e.b);
  raw.dpiScaled = k; return raw;
}

// ---------- macOS: Accessibility qua JXA ----------
const JXA_TREE = String.raw`
function run(argv) {
  const max = Number(argv[0]) || 200; const want = argv[1] || ''; const vmax = Math.max(1, Number(argv[2]) || 200);
  const hwnd = argv.length > 3 && argv[3] != null ? String(argv[3]) : '';
  const wantId = hwnd && hwnd !== '0' ? hwnd : '';
  const se = Application('System Events');
  const procs = want ? se.applicationProcesses.whose({ name: want }) : se.applicationProcesses.whose({ frontmost: true });
  if (!procs.length) return JSON.stringify({ win: null, els: [], unread: true });
  const p = procs[0];
  let list = [];
  try { const spec = p.windows; list = (typeof spec === 'function' ? spec() : spec) || []; } catch (e) { list = []; }
  if (!list || typeof list.length !== 'number') list = [];
  let w = null;
  if (wantId) {
    for (let i = 0; i < list.length; i++) {
      const cand = list[i]; let id = null;
      try { id = cand && typeof cand.id === 'function' ? cand.id() : (cand ? cand.id : null); } catch (e) { id = null; }
      if (id != null && String(id) === wantId) { w = cand; break; }
    }
    if (!w) return JSON.stringify({ win: null, els: [], unread: true, partial: true });
  } else {
    try { w = list[0]; if (w && typeof w.name === 'function') w.name(); } catch (e) { w = null; }
    if (!w) return JSON.stringify({ win: { title: '', proc: p.name(), pid: p.unixId() }, els: [], unread: true });
  }
  const out = []; const q = [[w, 0]]; let seen = 0; const t0 = Date.now(); let truncated = false, timedOut = false, partial = false;
  const g = (f) => { try { const v = f(); return v == null ? null : v; } catch (e) { return null; } };
  while (q.length && out.length < max && seen < 900 && Date.now() - t0 < 12000) {
    const [el, d] = q.shift(); seen++;
    const pos = g(() => el.position()), size = g(() => el.size());
    if (d > 0 && pos && size && size[0] > 1 && size[1] > 1) {
      const role = g(() => el.role()) || '', sub = g(() => el.subrole()) || '';
      let name = g(() => el.name()) || g(() => el.title()) || g(() => el.description()) || '';
      let v = null;
      if (/AXTextField|AXTextArea|AXComboBox|AXSearchField/.test(role) && sub !== 'AXSecureTextField') {
        v = g(() => el.value());
        if (v != null) { const s = String(v); if (s.length >= vmax) { v = s.slice(0, vmax); partial = true; } else v = s; }
      }
      if (!name && role === 'AXStaticText') name = String(g(() => el.value()) || '');
      out.push({ r: role, s: sub, n: String(name).slice(0, vmax), b: [Math.round(pos[0]), Math.round(pos[1]), Math.round(size[0]), Math.round(size[1])], e: g(() => el.enabled()) !== false, p: sub === 'AXSecureTextField', f: !!g(() => el.focused()), v: v, d: d });
    }
    if (d < 25) {
      let kids = null, kidsErr = false;
      try { kids = el.uiElements(); } catch (e) { kidsErr = true; }
      if (kidsErr) partial = true; else for (const k of kids || []) q.push([k, d + 1]);
    } else partial = true;
  }
  if (q.length) { if (Date.now() - t0 >= 12000) timedOut = true; else truncated = true; }
  const wp = g(() => w.position()) || [0, 0], ws = g(() => w.size()) || [0, 0];
  return JSON.stringify({ win: { title: g(() => w.name()) || '', proc: p.name(), pid: g(() => p.unixId()), hwnd: wantId || g(() => (typeof w.id === 'function' ? w.id() : w.id)), b: [wp[0], wp[1], ws[0], ws[1]] }, els: out, seen: seen, truncated: truncated, timedOut: timedOut, partial: partial });
}`;
const JXA_WINDOWS = String.raw`
function run() {
  const se = Application('System Events'); const out = [];
  for (const p of se.applicationProcesses.whose({ backgroundOnly: false })()) {
    let wins = []; try { wins = p.windows(); } catch (e) {}
    for (const w of wins) {
      let t = ''; try { t = w.name() || ''; } catch (e) {}
      let hwnd = null; try { hwnd = w.id(); } catch (e) {}
      if (hwnd == null) hwnd = String(p.unixId()) + ':' + t;
      let b = null; try { const pos = w.position(), sz = w.size(); if (pos && sz) b = [Math.round(pos[0]), Math.round(pos[1]), Math.round(sz[0]), Math.round(sz[1])]; } catch (e) {}
      let min = false; try { min = !!w.miniaturized(); } catch (e) {}
      out.push({ title: t, proc: p.name(), pid: p.unixId(), hwnd: hwnd, active: p.frontmost(), b: b, min: min });
    }
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

// B55 (QA lượt 6): id eN GIỮ NGUYÊN giữa các lần quan sát — khoá theo vai trò + nhãn + vị trí. Trước đây đánh số lại mỗi lần,
// mô hình dùng id cũ “e11 = Tiêu đề” trong khi e11 mới là nút “Gửi | Huỷ thư” → gõ tiêu đề vào nút.
// reg = { byKey: Map, info: Map(id → {role,name,b}), next } sống theo phiên (một việc).
const stableKey = (e) => `${e.role}|${fold(e.name).slice(0, 60)}|${Math.round((e.b[0] + e.b[2] / 2) / 48)}|${Math.round((e.b[1] + e.b[3] / 2) / 48)}`;
function stabilizeIds(elements, reg) {
  if (!reg) return elements;
  reg.byKey = reg.byKey || new Map(); reg.info = reg.info || new Map(); reg.next = reg.next || 1;
  const used = new Set(); const pending = [];
  const cx = (b) => b[0] + b[2] / 2, cy = (b) => b[1] + b[3] / 2;
  for (const e of elements) {
    const id = reg.byKey.get(stableKey(e));
    if (id && !used.has(id)) { e.id = id; used.add(id); } else pending.push(e);
  }
  for (const e of pending) {
    // cùng vai trò + cùng nhãn, dịch chuyển ít (cuộn nhẹ, cửa sổ đổi cỡ) → vẫn là phần tử cũ
    let best = null;
    for (const [id, inf] of reg.info) {
      if (used.has(id) || inf.role !== e.role || fold(inf.name) !== fold(e.name)) continue;
      const d = Math.hypot(cx(inf.b) - cx(e.b), cy(inf.b) - cy(e.b));
      if (d <= 120 && (!best || d < best.d)) best = { id, d };
    }
    const id = best ? best.id : (() => { let n = reg.next; while (used.has('e' + n) || reg.info.has('e' + n)) n++; reg.next = n + 1; return 'e' + n; })();
    e.id = id; used.add(id);
  }
  for (const e of elements) { reg.byKey.set(stableKey(e), e.id); reg.info.set(e.id, { role: e.role, kind: e.kind, name: e.name, b: e.b }); }
  return elements;
}
const BUTTONISH = /^(Button|SplitButton|MenuItem|TabItem|Hyperlink|CheckBox|RadioButton|AXButton|AXMenuItem|AXMenuBarItem|AXMenuButton|AXPopUpButton|AXLink|AXCheckBox|AXRadioButton|AXTab|AXRadioGroup|AXDisclosureTriangle)$/;
const isButtonish = (e) => !!e && BUTTONISH.test(e.role || '') && !e.editable;

// toạ độ gốc → thang 0..1000 của màn hình (để mô hình hình dung vị trí; khớp tham số x,y của screen_act)
// B40: phần tử có khả năng là BƯỚC TIẾP THEO của việc (Outlook “Thư mới”, Zalo “Tìm kiếm”…), theo câu lệnh của người dùng
const TASK_TARGETS = [
  [/\b(soan|viet|gui|tao)\b.{0,30}\b(email|e-mail|mail|thu)\b|\b(compose|new (?:mail|email|message)|write (?:an )?email|draft)\b/, ['Thư mới', 'New mail', 'New message', 'Soạn thư', 'Viết thư', 'Compose', 'Tin nhắn mới', 'Thư điện tử mới', 'New email']],
  [/\b(nhan|gui)\b.{0,40}\b(cho|toi|den|vao)\b|\b(message|text|dm)\b/, ['Tìm kiếm', 'Search', 'Tìm', 'Find']],
  [/\b(tao|dat|them)\b.{0,20}\b(lich|su kien|cuoc hop|meeting|event)\b/, ['Sự kiện mới', 'New event', 'Tạo', 'Create', 'Cuộc họp mới', 'New meeting']],
  [/\b(tao|mo)\b.{0,20}\b(tai lieu|van ban|bang tinh|trang tinh|trinh chieu|document|spreadsheet|presentation)\b/, ['Tài liệu trống', 'Blank document', 'Trống', 'Blank', 'Mới', 'New']],
  [/\b(tim|search|tra)\b/, ['Tìm kiếm', 'Search']],
];
function taskTargets(query) { const f = fold(query); const out = []; for (const [re, names] of TASK_TARGETS) if (re.test(f)) out.push(...names); return [...new Set(out)]; }
// xếp phần tử theo mức liên quan tới việc: khớp đích của việc > chứa từ trong câu lệnh > nút/ô nhập > còn lại (giữ thứ tự gốc trong mỗi nhóm)
function rankForTask(elements, query) {
  const tg = taskTargets(query).map(fold); const words = fold(query).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !/^(cho|tren|trong|nhung|khong|chi|gui|soan|email|mail|voi|cua|mot|cac|nay|the|and|for|with)$/.test(w));
  const score = (e) => { const n = fold(`${e.name || ''} ${e.value || ''}`); if (!n.trim()) return 0;
    if (tg.some(t => n === t || n.startsWith(t + ' ') || n.includes(t))) return 3;
    if (words.some(w => n.includes(w))) return 2;
    return INTERACTIVE.has(e.role) || e.editable || /nút|ô nhập|liên kết|mục/.test(e.kind || '') ? 1 : 0; };
  return elements.map((e, i) => ({ e, i, s: score(e) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.e);
}
function likelyTarget(elements, query) { const tg = taskTargets(query).map(fold); for (const t of tg) { const e = elements.find(x => { const n = fold(x.name || ''); return n === t || n.startsWith(t + ' ') || n.includes(t); }); if (e) return e; } return null; }
function formatForModel(obs, { toNorm, limit = 120 } = {}) {
  const lines = [];
  if (obs.win) lines.push(`Cửa sổ đang dùng: "${obs.win.title || '(không tên)'}"${obs.win.proc ? ` (${obs.win.proc})` : ''}`);
  const els = obs.elements.slice(0, limit);
  if (!els.length) lines.push('(Không đọc được phần tử nào trong cửa sổ này.)');
  for (const e of els) {
    const c = toNorm ? toNorm(e.b[0] + e.b[2] / 2, e.b[1] + e.b[3] / 2) : null;
    const flags = [e.focused && 'đang chọn', !e.enabled && 'đang mờ', e.password && 'Ô MẬT KHẨU – không gõ'].filter(Boolean);
    const shown = e.value ? require('./shot-guard').redactSecrets(String(e.value)) : '';
    lines.push(`[${e.id}] ${e.kind}${e.name ? ` "${e.name}"` : ''}${shown ? ` = "${shown.slice(0, 80)}"` : ''}${c ? ` @${c.x},${c.y}` : ''}${flags.length ? ' (' + flags.join(', ') + ')' : ''}`);
  }
  if (obs.elements.length > els.length) lines.push(`… và ${obs.elements.length - els.length} phần tử khác (dùng screen_look với query để lọc).`);
  return lines.join('\n');
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
// tìm phần tử theo id ("e12", "[e12]") hoặc theo tên/mô tả ("nút Gửi", "ô tìm kiếm")
// B56: tên nút/ô thường gặp theo nhiều ngôn ngữ — screen_look(query) / bấm theo tên khớp cả khi mô hình dùng ngôn ngữ khác ứng dụng
const SYN = [
  ['thư mới', 'new mail', 'new email', 'soạn thư', 'compose', 'viết thư', '新邮件', '写邮件', '撰写'],
  ['tin nhắn mới', 'new message', 'new chat', '新消息', '新聊天'],
  ['gửi', 'send', '发送', '傳送'], ['trả lời', 'reply', '回复'], ['chuyển tiếp', 'forward', '转发'],
  ['tìm kiếm', 'search', 'tìm', 'find', '搜索', '查找'], ['tiêu đề', 'subject', 'add a subject', '主题'],
  ['người nhận', 'đến', 'to', 'recipients', '收件人'], ['đính kèm', 'attach', 'thêm tệp', 'add file', 'upload', 'tải lên', '附件', '添加文件', '上传'],
  ['nộp bài', 'turn in', 'submit', 'nộp', '提交', '上交'], ['lưu', 'save', '保存'], ['huỷ', 'hủy', 'cancel', '取消'], ['xoá', 'xóa', 'delete', 'discard', '删除'],
  ['cài đặt', 'settings', '设置'], ['mở', 'open', '打开'], ['đóng', 'close', '关闭'], ['hộp thư đến', 'inbox', '收件箱'], ['thư nháp', 'drafts', '草稿'],
  ['cuộc họp mới', 'new meeting', '新会议'], ['sự kiện mới', 'new event', '新活动'], ['tạo', 'create', 'new', '新建', '创建'],
];
function queryVariants(q) {
  const f = fold(String(q || '').replace(/^[✉+✚＋\s]+/u, '')).trim(); if (!f) return [];
  const out = [f];
  for (const g of SYN) { const gf = g.map(x => fold(x)); if (gf.some(x => x === f || (x.length >= 4 && f.includes(x) && f.length <= x.length + 4))) for (const x of gf) if (!out.includes(x)) out.push(x); }
  return out;
}
function findElementAny(elements, query) {
  const e = findElement(elements, query); if (e) return e;
  for (const v of queryVariants(query).slice(1)) { const x = findElement(elements, v); if (x) return x; }
  return null;
}
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

async function tree({ hwnd = 0, app = '', max = 300, vmax = 0 } = {}) {
  if (process.platform === 'win32') {
    const env = { AIVN_HWND: String(hwnd || 0), AIVN_MAX: String(max) };
    if (vmax > 0) env.AIVN_VMAX = String(vmax);
    const o = await ps(PS_TREE, env, 25000); return JSON.parse(o.trim() || '{}');
  }
  if (process.platform === 'darwin') { const o = await run('osascript', ['-l', 'JavaScript', '-e', JXA_TREE, String(Math.min(max, 220)), app || '', String(vmax > 0 ? vmax : 200), hwnd ? String(hwnd) : ''], { timeout: 25000 }); return JSON.parse(o.trim() || '{}'); }
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

// T1a: phím tắt RIÊNG của từng ứng dụng (cây giao diện nghèo → bấm chữ OCR dễ trượt; phím tắt chắc chắn hơn)
const APP_KEYS = [
  [/^(zalo|zalopc)$/i, { search: `${MOD}+f`, name: 'Zalo' }],
  [/^slack$/i, { search: `${MOD}+k`, name: 'Slack' }],
  [/^discord$/i, { search: `${MOD}+k`, name: 'Discord' }],
  [/^(teams|ms-teams|msteams)$/i, { search: `${MOD}+e`, name: 'Teams' }],
  [/^(chrome|msedge|firefox|brave|opera|vivaldi|coccoc|browser)$/i, { address: `${MOD}+l`, name: 'trình duyệt' }],
];
function appKeys(proc, title = '') {
  const p = String(proc || '').replace(/\.exe$/i, '').trim(); const m = APP_KEYS.find(([re]) => re.test(p)); if (m) return m[1];
  // tiến trình không rõ tên (vỏ Electron…) nhưng cửa sổ tên ĐÚNG “Zalo”: vẫn là Zalo (không áp cho tab trình duyệt “Zalo - Chrome”)
  if (/^\s*zalo\s*$/i.test(String(title || ''))) return APP_KEYS[0][1];
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
// B76: OCR đọc sai dấu/ký tự (“Lich hop nhém” cho “Lịch họp nhóm”) — needle (đã fold) gần đúng nằm trong hay: khoảng cách sửa ≤ 25% độ dài trên một cửa sổ trượt
function fuzzyHas(hay, needle) {
  const h = String(hay || ''), n = String(needle || ''); if (!n) return true; if (h.includes(n)) return true; if (n.length < 5) return false;
  const L = n.length, lim = Math.floor(L * 0.25);
  const lev = (a, b) => { let prev = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[b.length]; };
  for (let i = 0; i <= Math.max(0, h.length - L + lim); i++) for (const w of [L - lim, L, L + lim]) { if (w <= 0 || i + w > h.length + 0) continue; if (lev(h.slice(i, i + w), n) <= lim) return true; }
  return h.length < L && h.length >= L - lim && lev(h, n) <= lim;
}
const inputLike = (el) => !!(el && !el.editable && el.ocr && String(el.name || '').trim().length <= 40 && INPUT_HINT.test(String(el.name || '').trim()));
// B60 (QA lượt 7): tham chiếu id phần tử do mô hình viết: “e10”, “[e12]”, “e10 Trần Quỳnh Anh”, “e3: "Send"”, “e11 (Tiêu đề)”.
// (?!\d) chặn quay lui: “e10” KHÔNG được hiểu thành e1 + nhãn “0”, “e22” không thành e2 + “2”; nhãn không bắt buộc.
const ID_REF = /^\[?(e\d+)(?!\d)\]?(?:(?:\s*[:\-–(“"']+\s*|\s+)(.*?))?\s*[)”"'\]]*$/iu;
function parseIdRef(q) {
  const m = ID_REF.exec(String(q == null ? '' : q).trim()); if (!m) return null;
  const label = String(m[2] || '').replace(/^[\s:\-–(“"'\[]+|[\s)”"'\]]+$/gu, '').trim();
  return { id: m[1].toLowerCase(), label: /[\p{L}\p{N}]/u.test(label) ? label : null };
}
// B55/B60: phần tử theo id (+ nhãn nếu có) trong lần quan sát mới nhất. Trả { el } | { labelChanged } | { goneId } | null (không phải id / không biết id)
function resolveIdRef(elements, q, info = null) {
  const ref = parseIdRef(q); if (!ref) return null;
  const el = (elements || []).find(e => e.id === ref.id); const lab = ref.label ? fold(ref.label).trim() : '';
  if (el && lab && el.name && !fold(el.name).includes(lab) && !lab.includes(fold(el.name))) return { labelChanged: { id: ref.id, now: el, want: ref.label } };
  if (el) return { el };
  const inf = info && info.get ? info.get(ref.id) : null; if (inf) return { goneId: { id: ref.id, inf } };
  return null;
}
// B37: chữ MỚI sau thao tác, đếm theo số lần xuất hiện (tệp thứ hai cùng tên cũng tính)
// B37: chỉ tên TỆP mới đếm theo số lần (tệp thứ 2 cùng tên); chữ khác theo tập hợp — OCR đọc trùng “Tìm kiếm” hai lần không phải “chữ mới”
const FILE_LIKE = /\.[a-z0-9]{2,5}\b/i;
function newTexts(beforeEls, afterEls, max = 4) {
  const old = new Map(); for (const e of beforeEls || []) { const k = fold(e.name || '').trim(); if (k) old.set(k, (old.get(k) || 0) + 1); }
  const out = []; for (const e of afterEls || []) { const n = String(e.name || '').trim(); const k = fold(n).trim(); if (!k) continue; const c = old.get(k) || 0; if (c > 0) { if (FILE_LIKE.test(n)) old.set(k, c - 1); continue; } if (n.length >= 3 && !out.includes(n)) out.push(n); }
  return out.slice(0, max);
}
const isIdRef = (q) => { const r = parseIdRef(q); return !!(r && !r.label); };
module.exports = { ps, PS_PRELUDE, fuzzyHas, windowAt, PS_WINAT, parseIdRef, isIdRef, resolveIdRef, newTexts, ID_REF, queryVariants, findElementAny, stabilizeIds, isButtonish, taskTargets, rankForTask, likelyTarget, appKeys, APP_KEYS, setCursor, uiaScale, rescaleTree, inputLike, poorTreeApp, POOR_TREE_APPS, noDiacritics, searchVariants, activeDialogOf, shortcutFor, restoreQuoted, tree, windows, focus, matchWindow, normalize, formatForModel, findElement, fold, PASSWORD_NAME, ROLE_VI, INTERACTIVE, PS_TREE, PS_WINDOWS, PS_FOCUS, JXA_TREE, JXA_WINDOWS, linuxWindows };
