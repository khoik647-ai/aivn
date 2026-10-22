'use strict';
// QA: AIVN.exe --qa-input-diag --out diag.json   (cổng bật như QA runner: AIVN_QA_MODE=1 + cờ)
// Bằng chứng trên Windows thật cho B62 (bấm không ăn) / B66 (“Invalid key flag specified.”): mở cửa sổ kiểm tra RIÊNG của AIVN,
// bấm/gõ bằng ĐÚNG đường libnut + quy đổi DPI mà AIVN AGENT dùng, rồi ghi lại cửa sổ thật sự nhận được gì.
// Windows: trình phụ PowerShell (C#) ghi móc bàn phím/chuột cấp thấp (VK, mã quét, cờ LLKHF_* đúng như hệ điều hành thấy, có cờ “injected”),
// WindowFromPoint ở MỖI cú bấm (trước khi bấm), DPI từng màn hình, quyền admin (elevation) của AIVN và của ứng dụng đang ở trên cùng.
// Móc phím chỉ chạy trong lúc kiểm tra (~30 giây) và chỉ ghi mã phím — không ghi chữ; đừng gõ phím trong lúc chạy.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const { writeJson } = require('./qa-runner');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CLICK_DELAYS = [0, 50, 120, 300];
const COMBOS = ['ctrl+l', 'ctrl+t', 'ctrl+f', 'ctrl+h', 'ctrl + a', ' Ctrl + Shift + Z ', 'enter', 'up', 'home', 'delete', 'win+s', 'win + s', 'alt+tab'];
const TEXTS = [{ lang: 'vi', text: 'Xin chào, tôi là AIVN — tiếng Việt có dấu: ằẳẵặ ữự ỹ đĐ Ơ Ư' }, { lang: 'zh', text: '你好，世界。中文输入测试：简体字。' }];
const LLKHF = { EXTENDED: 0x01, LOWER_IL_INJECTED: 0x02, INJECTED: 0x10, ALTDOWN: 0x20, UP: 0x80 };
const flagNames = (f) => Object.entries(LLKHF).filter(([, v]) => f & v).map(([k]) => k);

const CS = String.raw`
using System; using System.Runtime.InteropServices; using System.Text; using System.Threading; using System.Diagnostics;
public static class AivnDiag {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct KB { public uint vk; public uint scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct MS { public POINT pt; public uint data; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr h; public uint m; public IntPtr w; public IntPtr l; public uint t; public POINT p; }
  public delegate IntPtr HookProc(int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id, HookProc f, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint f);
  [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr m, int t, out uint x, out uint y);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, uint pid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr p, uint a, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr t, int c, out int v, int len, out int ret);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr c);
  // trình phụ phải nhận DPI theo từng màn hình (v2), nếu không WindowFromPoint/GetCursorPos bị Windows “ảo hoá” ở 125%/150%
  public static void Init() { int before = -1, after = -1; string err = null; try { before = GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); SetThreadDpiAwarenessContext(new IntPtr(-4)); after = GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); } catch (Exception e) { err = e.Message; }
    Emit("{\"dpiAwareness\":{\"before\":" + before + ",\"after\":" + after + ",\"perMonitor\":" + (after == 2 ? "true" : "false") + ",\"error\":" + J(err) + "}}"); }
  static HookProc kp, mp; static readonly object L = new object();
  public static void Emit(string s) { lock (L) { Console.Out.WriteLine(s); Console.Out.Flush(); } }
  static string J(string s) { if (s == null) return "null"; var b = new StringBuilder("\""); foreach (char c in s) { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < 32) b.Append("\\u").Append(((int)c).ToString("x4")); else b.Append(c); } return b.Append('"').ToString(); }
  public static void StartHooks() { var t = new Thread(() => { kp = KeyCb; mp = MouseCb; IntPtr m = GetModuleHandle(null); IntPtr a = SetWindowsHookEx(13, kp, m, 0); IntPtr b = SetWindowsHookEx(14, mp, m, 0);
    Emit("{\"hooks\":{\"keyboard\":" + (a != IntPtr.Zero ? "true" : "false") + ",\"mouse\":" + (b != IntPtr.Zero ? "true" : "false") + ",\"err\":" + Marshal.GetLastWin32Error() + "}}"); MSG msg; while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { } }); t.IsBackground = true; t.Start(); }
  static IntPtr KeyCb(int n, IntPtr w, IntPtr l) { if (n >= 0) { var k = (KB)Marshal.PtrToStructure(l, typeof(KB)); Emit("{\"hook\":\"key\",\"msg\":" + w.ToInt64() + ",\"vk\":" + k.vk + ",\"scan\":" + k.scan + ",\"flags\":" + k.flags + ",\"t\":" + k.time + "}"); } return CallNextHookEx(IntPtr.Zero, n, w, l); }
  static IntPtr MouseCb(int n, IntPtr w, IntPtr l) { if (n >= 0 && w.ToInt64() != 0x200) { var k = (MS)Marshal.PtrToStructure(l, typeof(MS)); Emit("{\"hook\":\"mouse\",\"msg\":" + w.ToInt64() + ",\"x\":" + k.pt.X + ",\"y\":" + k.pt.Y + ",\"flags\":" + k.flags + ",\"t\":" + k.time + "}"); } return CallNextHookEx(IntPtr.Zero, n, w, l); }
  public static int Elevated(uint pid) { IntPtr h = OpenProcess(0x1000, false, pid); if (h == IntPtr.Zero) return -1; IntPtr t; if (!OpenProcessToken(h, 8, out t)) { CloseHandle(h); return -2; } int e, r; bool ok = GetTokenInformation(t, 20, out e, 4, out r); CloseHandle(t); CloseHandle(h); return ok ? e : -3; }
  static string Win(IntPtr h) { if (h == IntPtr.Zero) return "null"; var s = new StringBuilder(512); var c = new StringBuilder(256); GetWindowText(h, s, 512); GetClassName(h, c, 256); uint pid; GetWindowThreadProcessId(h, out pid); string pn = null; try { pn = Process.GetProcessById((int)pid).ProcessName; } catch { }
    return "{\"hwnd\":" + h.ToInt64() + ",\"title\":" + J(s.ToString()) + ",\"class\":" + J(c.ToString()) + ",\"pid\":" + pid + ",\"process\":" + J(pn) + ",\"elevated\":" + Elevated(pid) + ",\"dpi\":" + GetDpiForWindow(h) + "}"; }
  public static void Wfp(string id, int x, int y) { var p = new POINT { X = x, Y = y }; IntPtr h = WindowFromPoint(p); Emit("{\"id\":" + id + ",\"at\":[" + x + "," + y + "],\"window\":" + Win(h) + ",\"root\":" + Win(GetAncestor(h, 2)) + "}"); }
  public static void Fg(string id) { POINT c; GetCursorPos(out c); Emit("{\"id\":" + id + ",\"foreground\":" + Win(GetForegroundWindow()) + ",\"cursor\":[" + c.X + "," + c.Y + "]}"); }
  public static void Dpi(string id, int x, int y) { var p = new POINT { X = x, Y = y }; IntPtr m = MonitorFromPoint(p, 2); uint dx = 0, dy = 0; int hr = GetDpiForMonitor(m, 0, out dx, out dy); uint rx = 0, ry = 0; GetDpiForMonitor(m, 2, out rx, out ry); Emit("{\"id\":" + id + ",\"monitor\":" + m.ToInt64() + ",\"effectiveDpi\":" + dx + ",\"rawDpi\":" + rx + ",\"hr\":" + hr + "}"); }
  public static void Elev(string id, uint pid) { Emit("{\"id\":" + id + ",\"pid\":" + pid + ",\"elevated\":" + Elevated(pid) + "}"); }
}`;
const PS = (csFile) => `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try { Add-Type -TypeDefinition ([IO.File]::ReadAllText('${csFile.replace(/'/g, "''")}')) -Language CSharp } catch { [Console]::Out.WriteLine('{"fatal":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}'); exit 1 }
[AivnDiag]::Init()
[AivnDiag]::StartHooks()
[AivnDiag]::Emit('{"ready":true}')
while ($true) { $l = [Console]::In.ReadLine(); if ($l -eq $null -or $l -eq 'quit') { break }; $p = $l.Split(' ')
  try { switch ($p[1]) { 'wfp' { [AivnDiag]::Wfp($p[0], [int]$p[2], [int]$p[3]) } 'fg' { [AivnDiag]::Fg($p[0]) } 'dpi' { [AivnDiag]::Dpi($p[0], [int]$p[2], [int]$p[3]) } 'elev' { [AivnDiag]::Elev($p[0], [uint32]$p[2]) } } }
  catch { [AivnDiag]::Emit('{"id":' + $p[0] + ',"error":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}') } }`;

// trình phụ Windows: trả { ok, call(cmd, args) → Promise<json>, hooks[], stop() }
// chỉ để kiểm thử khi phát triển (main.js chỉ dùng khi chưa đóng gói + AIVN_QA_DIAG_FAKEWFP): WindowFromPoint giả theo chuỗi F (cửa sổ khác) / O (AIVN)
function fakeHelper(seq = '') {
  const q = String(seq).toUpperCase().replace(/[^FO]/g, '').split(''); const me = { pid: process.pid, process: 'AIVN', title: 'AIVN · Kiểm tra chuột & phím' };
  return { ok: true, reason: 'giả lập (kiểm thử)', hooks: [], stop() {}, calls: 0,
    async call(name) { if (name === 'fg') return { foreground: me }; if (name !== 'wfp') return null; this.calls++;
      return (q.shift() || 'O') === 'F' ? { root: { pid: 999999, process: 'Zalo', title: 'Zalo' }, window: { pid: 999999, process: 'Zalo' } } : { root: me, window: me }; } };
}
async function startHelper(log) {
  if (process.platform !== 'win32') return { ok: false, reason: 'chỉ có trên Windows', call: async () => null, hooks: [], stop() {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-diag-')); const cs = path.join(dir, 'diag.cs'), ps = path.join(dir, 'diag.ps1');
  fs.writeFileSync(cs, CS, 'utf8'); fs.writeFileSync(ps, '\ufeff' + PS(cs), 'utf8');
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const h = { ok: false, reason: null, hooks: [], hookState: null, pending: new Map(), seq: 0, proc: p };
  let buf = ''; let readyRes; const ready = new Promise(r => { readyRes = r; });
  p.stdout.setEncoding('utf8'); p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.hook) { j.at = Date.now(); if (h.hooks.length < 20000) h.hooks.push(j); } else if (j.hooks) h.hookState = j.hooks; else if (j.dpiAwareness) h.dpiAwareness = j.dpiAwareness; else if (j.ready) { h.ok = true; readyRes(); } else if (j.fatal) { h.reason = j.fatal; readyRes(); } else if (j.id != null && h.pending.has(j.id)) { h.pending.get(j.id)(j); h.pending.delete(j.id); } } });
  let err = ''; p.stderr.on('data', (d) => { err += d; }); p.on('exit', (c) => { if (!h.ok) { h.reason = h.reason || `PowerShell thoát mã ${c}: ${err.slice(0, 400)}`; readyRes(); } });
  p.on('error', (e) => { h.reason = 'không chạy được PowerShell: ' + e.message; readyRes(); });
  await Promise.race([ready, sleep(25000)]); if (!h.ok && !h.reason) h.reason = 'PowerShell không phản hồi sau 25 giây';
  h.call = (cmd, ...a) => h.ok ? new Promise(res => { const id = ++h.seq; h.pending.set(id, res); try { p.stdin.write(`${id} ${cmd} ${a.join(' ')}\n`); } catch { res(null); } setTimeout(() => { if (h.pending.has(id)) { h.pending.delete(id); res({ error: 'hết thời gian' }); } }, 5000); }) : Promise.resolve(null);
  h.stop = () => { try { p.stdin.write('quit\n'); } catch {} setTimeout(() => { try { p.kill(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }, 800); };
  if (log) log(h.ok ? 'Trình phụ Windows (PowerShell) sẵn sàng' : 'Trình phụ Windows không chạy: ' + h.reason);
  return h;
}
const keyHooks = (hooks, t0, t1) => hooks.filter(x => x.hook === 'key' && x.at >= t0 && x.at <= t1).map(x => ({ vk: '0x' + x.vk.toString(16).toUpperCase().padStart(2, '0'), scan: '0x' + x.scan.toString(16).toUpperCase().padStart(2, '0'), flags: '0x' + x.flags.toString(16), flagNames: flagNames(x.flags), up: !!(x.flags & LLKHF.UP), injected: !!(x.flags & LLKHF.INJECTED), extended: !!(x.flags & LLKHF.EXTENDED) }));
const mouseHooks = (hooks, t0, t1) => hooks.filter(x => x.hook === 'mouse' && x.at >= t0 && x.at <= t1).map(x => ({ msg: { 0x201: 'LBUTTONDOWN', 0x202: 'LBUTTONUP', 0x204: 'RBUTTONDOWN', 0x205: 'RBUTTONUP', 0x20a: 'WHEEL' }[x.msg] || x.msg, x: x.x, y: x.y, injected: !!(x.flags & 1), lowerIlInjected: !!(x.flags & 2) }));

async function run(args, deps, { runId = String(Date.now()) } = {}) {
  const t0 = Date.now(); const SC = require('./screen-control'); const K = require('./agent/keys'); const { BrowserWindow, screen, clipboard } = require('electron');
  const res = { schema: 1, runId, kind: 'input-diag', version: deps.version || null, commit: deps.commit || null, platform: process.platform, arch: process.arch, osRelease: os.release(),
    status: null, helper: null, elevation: {}, displays: null, window: null, clicks: [], keys: [], typing: [], focusChanges: [], summary: {}, timings: { startedAt: new Date(t0).toISOString() } };
  const log = (m) => deps.LOG && deps.LOG.log('qa', 'Kiểm tra chuột/phím: ' + m);
  const helper = deps.helper || await startHelper(log); res.helper = { ok: helper.ok, reason: helper.reason };
  const w = new BrowserWindow({ width: 900, height: 620, x: 80, y: 60, title: 'AIVN · Kiểm tra chuột & phím', autoHideMenuBar: true, show: false, backgroundColor: '#ffffff', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  w.setMenu(null); await w.loadFile(path.join(__dirname, 'renderer', 'input-diag.html')); w.show(); try { w.setAlwaysOnTop(true, 'screen-saver'); } catch {} w.moveTop(); w.focus(); await sleep(800);
  const js = (c) => w.webContents.executeJavaScript(c, true);
  const pageLog = async (from) => (await js('window.__diag')).slice(from); const mark = async () => (await js('window.__diag.length'));
  const rectOf = async (id) => { const r = await js(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`); const cb = w.getContentBounds(); return { x: cb.x + r.x + r.w / 2, y: cb.y + r.y + r.h / 2, rect: r }; };
  const disp = () => screen.getDisplayMatching(w.getBounds());
  const physOf = (p) => { const d = disp(); const g = SC.geos().find(x => String(x.id) === String(d.id)); const nx = (p.x - d.bounds.x) / d.bounds.width, ny = (p.y - d.bounds.y) / d.bounds.height; return { nx, ny, phys: SC.toNut(nx, ny, g || null), geo: g || null }; };
  const ourPids = new Set([process.pid, w.webContents.getOSProcessId()]);
  const fg = async () => (await helper.call('fg')) || null;
  // B91 (máy thật beta.2.1): lần bấm đầu tiên rơi vào Zalo (cửa sổ kiểm tra chưa ở trên cùng). Nay: cửa sổ kiểm tra luôn ở trên cùng trong lúc chạy;
  // TRƯỚC MỖI lần bấm hỏi WindowFromPoint — không phải cửa sổ AIVN → đưa lên trước rồi thử lại (3 lần), vẫn không → BỎ QUA lần bấm đó (không bao giờ bấm vào ứng dụng khác)
  const raise = async () => { if (w.isDestroyed()) return; if (w.isMinimized()) w.restore(); w.show(); try { w.setAlwaysOnTop(true, 'screen-saver'); } catch {} w.moveTop(); w.focus(); await sleep(300); };
  const guard = { skipped: [], retries: 0 };
  const ours = async (P, label) => {
    if (!helper.ok) return { ok: true, verified: false, wfp: null };
    let wfp = null;
    for (let i = 0; i < 3; i++) {
      wfp = await helper.call('wfp', Math.round(P.phys.x), Math.round(P.phys.y));
      if (wfp && wfp.root && ourPids.has(wfp.root.pid)) return { ok: true, verified: true, wfp, tries: i + 1 };
      guard.retries++; log(`trước khi bấm ${label}: dưới con trỏ là “${wfp && wfp.root ? `${wfp.root.process || '?'} · ${wfp.root.title || ''}` : '?'}”, không phải AIVN — đưa cửa sổ kiểm tra lên trước rồi thử lại (${i + 1}/3)`);
      await raise();
    }
    guard.skipped.push({ label, windowFromPoint: wfp }); log(`BỎ QUA bấm ${label}: dưới con trỏ vẫn không phải cửa sổ AIVN`);
    return { ok: false, verified: true, wfp };
  };
  // bấm an toàn (chỉ khi điểm bấm thuộc cửa sổ AIVN); trả false nếu đã bỏ qua
  const safeClick = async (P, label, pre = 60) => { const g = await ours(P, label); if (!g.ok) return false; const n = SC.libnut(); n.moveMouse(P.phys.x, P.phys.y); await sleep(pre); n.mouseClick('left', false); return true; };
  const refocus = async () => { if (w.isDestroyed()) return; await raise(); const f = await fg(); if (f && f.foreground && !ourPids.has(f.foreground.pid)) { const p = physOf(await rectOf('st')); if (await safeClick(p, 'thanh trạng thái (lấy tiêu điểm)', 80)) await sleep(300); } };
  try {
    // ---- màn hình & DPI ----
    res.displays = screen.getAllDisplays().map(d => ({ id: d.id, label: d.label || null, primary: d.id === screen.getPrimaryDisplay().id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, electronDpi: Math.round(96 * d.scaleFactor), rotation: d.rotation, internal: d.internal }));
    try { res.screenControl = SC.displayInfo(); } catch (e) { res.screenControl = { error: e.message }; }
    for (const d of res.displays) { const c = { x: d.bounds.x + d.bounds.width / 2, y: d.bounds.y + d.bounds.height / 2 }; const ph = process.platform === 'win32' && screen.dipToScreenPoint ? screen.dipToScreenPoint(c) : c; d.monitorDpi = await helper.call('dpi', Math.round(ph.x), Math.round(ph.y)); }
    res.elevation.aivnMain = await helper.call('elev', process.pid); res.elevation.aivnRenderer = await helper.call('elev', w.webContents.getOSProcessId());
    res.elevation.foregroundAtStart = await fg();
    res.window = { bounds: w.getBounds(), contentBounds: w.getContentBounds(), display: disp().id, scaleFactor: disp().scaleFactor };
    // ---- bấm chuột: di chuyển → chờ (0/50/120/300 ms) → bấm; WindowFromPoint TRƯỚC khi bấm ----
    const n = SC.libnut(); let bi = 0;
    for (const delay of CLICK_DELAYS) for (const id of ['b1', 'b5']) {
      await refocus(); bi++; const tgt = await rectOf(id); const P = physOf(tgt);
      const g = await ours(P, `${id} (chờ ${delay} ms)`); const wfp = g.wfp; const fgB = await fg();
      if (!g.ok) { res.clicks.push({ n: bi, target: id, delayMs: delay, phys: P.phys, windowFromPoint: wfp, foregroundBefore: fgB && fgB.foreground, skipped: true, ok: false, pointIsOurWindow: false, error: 'bỏ qua: điểm bấm không thuộc cửa sổ AIVN (đã thử đưa lên trước 3 lần)' }); continue; }
      const m0 = await mark(); const h0 = Date.now();
      let err = null; try { n.moveMouse(P.phys.x, P.phys.y); if (delay) await sleep(delay); n.mouseClick('left', false); } catch (e) { err = e.message; }
      await sleep(350); const cur = SC.cursorPhys(); const ev = (await pageLog(m0)).filter(e => /mouse|click/.test(e.type));
      const clk = ev.find(e => e.type === 'click' && e.target === id);
      const c = { n: bi, target: id, delayMs: delay, dip: { x: Math.round(tgt.x), y: Math.round(tgt.y) }, norm: { x: +P.nx.toFixed(4), y: +P.ny.toFixed(4) }, phys: P.phys, cursorAfter: cur, error: err,
        windowFromPoint: wfp, foregroundBefore: fgB && fgB.foreground, received: ev.slice(0, 6), hook: mouseHooks(helper.hooks, h0, Date.now()), ok: !!clk && !err };
      if (wfp && wfp.root) c.pointIsOurWindow = ourPids.has(wfp.root.pid); if (clk) c.offsetPx = { x: Math.round(clk.clientX - tgt.rect.x - tgt.rect.w / 2), y: Math.round(clk.clientY - tgt.rect.y - tgt.rect.h / 2) };
      res.clicks.push(c); log(`bấm ${id} chờ ${delay} ms: ${c.ok ? 'NHẬN' : 'KHÔNG nhận'}${err ? ' — ' + err : ''}`);
    }
    // cùng đường perform() của AIVN AGENT (di chuyển → 120 ms → bấm)
    { await refocus(); const tgt = await rectOf('b3'); const P = physOf(tgt); const g = await ours(P, 'b3 (perform)');
      if (!g.ok) res.clicks.push({ n: ++bi, target: 'b3', via: 'screen-control.perform', phys: P.phys, windowFromPoint: g.wfp, skipped: true, ok: false, error: 'bỏ qua: điểm bấm không thuộc cửa sổ AIVN' });
      else { const m0 = await mark(); let err = null; try { await SC.perform({ action: 'click', nx: P.nx, ny: P.ny, display: P.geo }); } catch (e) { err = e.message; } await sleep(300);
        const ev = await pageLog(m0); res.clicks.push({ n: ++bi, target: 'b3', via: 'screen-control.perform', error: err, phys: P.phys, windowFromPoint: g.wfp, received: ev.filter(e => /click/.test(e.type)).slice(0, 4), ok: ev.some(e => e.type === 'click' && e.target === 'b3') && !err }); } }
    // ---- phím tắt ----
    for (const combo of COMBOS) {
      await refocus(); const f = physOf(await rectOf('field'));
      if (!(await safeClick(f, `ô nhập (phím “${combo}”)`))) { res.keys.push({ combo, skipped: true, ok: false, error: 'bỏ qua: ô nhập không thuộc cửa sổ AIVN dưới con trỏ' }); continue; } await sleep(200);
      const m0 = await mark(); const h0 = Date.now(); let k = null, err = null, diag = null;
      try { k = K.parse(combo, process.platform); diag = K.diag(k, process.platform); if (k.mods.length) n.keyTap(k.key, k.mods); else n.keyTap(k.key); } catch (e) { err = e.message; }
      await sleep(/win|alt\+tab/.test(combo.replace(/\s/g, '')) ? 900 : 300);
      const fgAfter = await fg(); const ev = (await pageLog(m0)).filter(e => /^key/.test(e.type)); const hk = keyHooks(helper.hooks, h0, Date.now());
      const lastKey = k ? (k.key.length === 1 ? k.key.toLowerCase() : { enter: 'Enter', up: 'ArrowUp', home: 'Home', delete: 'Delete', tab: 'Tab' }[k.key] || k.key) : null;
      const osConsumed = !!k && (k.mods.includes('meta') || (k.mods.includes('alt') && k.key === 'tab'));
      const pageGot = ev.some(e => e.type === 'keydown' && String(e.key).toLowerCase() === String(lastKey).toLowerCase());
      const winKeyOk = !k || !k.mods.includes('meta') || process.platform !== 'win32' || !helper.ok || (hk.some(x => x.vk === '0x5B' && !x.up && x.extended) && hk.some(x => x.vk === '0x5B' && x.up && x.extended));
      const r = { combo, parsed: k && { key: k.key, mods: k.mods, combo: k.combo }, sendInputExpected: diag, error: err, hook: hk, received: ev.slice(0, 10), foregroundAfter: fgAfter && fgAfter.foreground,
        ok: !err && (osConsumed ? winKeyOk : pageGot) };
      if (osConsumed) r.note = 'tổ hợp này do hệ điều hành xử lý (cửa sổ kiểm tra không nhận phím cuối) — đạt khi không lỗi và móc phím thấy VK_LWIN 0x5B có cờ EXTENDED lúc nhấn và lúc nhả';
      if (fgAfter && fgAfter.foreground && !ourPids.has(fgAfter.foreground.pid)) { res.focusChanges.push({ after: combo, to: fgAfter.foreground }); try { n.keyTap('escape'); } catch {} await sleep(400); }
      res.keys.push(r); log(`phím “${combo}”: ${r.ok ? 'đạt' : 'HỎNG'}${err ? ' — ' + err : ''}`);
    }
    // ---- gõ chữ: dán (đường AIVN AGENT dùng) và typeString của libnut ----
    for (const { lang, text } of TEXTS) for (const method of ['paste', 'typeString']) {
      await refocus(); await js('document.getElementById("area").value = ""'); const a = physOf(await rectOf('area'));
      if (!(await safeClick(a, `vùng gõ (${lang}/${method})`))) { res.typing.push({ lang, method, text, skipped: true, ok: false, error: 'bỏ qua: vùng gõ không thuộc cửa sổ AIVN dưới con trỏ' }); continue; } await sleep(200);
      let err = null; const h0 = Date.now();
      try { if (method === 'paste') await SC.perform({ action: 'type', text }); else n.typeString(text); } catch (e) { err = e.message; }
      await sleep(method === 'paste' ? 600 : 300 + text.length * 30); const got = await js('document.getElementById("area").value');
      res.typing.push({ lang, method, text, got, error: err, ok: got === text, ...(method === 'typeString' ? { informational: 'chỉ để so sánh — AIVN AGENT gõ bằng dán' } : {}), hookKeys: keyHooks(helper.hooks, h0, Date.now()).length }); log(`gõ ${lang} (${method}): ${got === text ? 'đúng' : 'SAI'}`);
    }
    res.elevation.foregroundAtEnd = await fg();
    res.guard = { verifiedBeforeClick: !!helper.ok, retries: guard.retries, skipped: guard.skipped };
    Object.assign(res.helper, { hooks: helper.hookState || null, dpiAwareness: helper.dpiAwareness || null, hookEvents: helper.hooks.length });
  } catch (e) { res.error = e.stack || e.message; }
  finally { helper.stop(); try { if (!w.isDestroyed()) w.destroy(); } catch {} }
  res.summary = { clicks: `${res.clicks.filter(c => c.ok).length}/${res.clicks.length}`, keys: `${res.keys.filter(k => k.ok).length}/${res.keys.length}`, typing: `${res.typing.filter(t => t.ok).length}/${res.typing.length}`,
    skipped: guard.skipped.length, failedKeys: res.keys.filter(k => !k.ok).map(k => k.combo), failedClicks: res.clicks.filter(c => !c.ok).map(c => `${c.target}@${c.delayMs ?? c.via}`), failedTyping: res.typing.filter(t => !t.ok && t.method === 'paste').map(t => `${t.lang}/${t.method}`),
    typeStringCompare: res.typing.filter(t => t.method === 'typeString').map(t => `${t.lang}: ${t.ok ? 'đúng' : 'sai'}`).join(', ') };
  // typeString chỉ để so sánh (AIVN AGENT gõ bằng dán) → không tính vào kết quả đạt/hỏng
  const must = [...res.clicks, ...res.keys, ...res.typing.filter(t => t.method === 'paste')];
  res.status = !res.error && must.every(x => x.ok) ? 'done' : 'failed'; res.exitCode = res.status === 'done' ? 0 : 2;
  if (guard.skipped.length) res.reason = `${guard.skipped.length} lần bấm bị BỎ QUA vì điểm bấm không thuộc cửa sổ AIVN (cửa sổ khác che) — không bấm vào ứng dụng khác`;
  res.timings.totalMs = Date.now() - t0; res.timings.finishedAt = new Date().toISOString();
  writeJson(args.out, res); log(`xong: ${res.status} — bấm ${res.summary.clicks}, phím ${res.summary.keys}, gõ ${res.summary.typing} → ${args.out}`);
  return res;
}
function validate(a, { cwd = process.cwd() } = {}) { if (!a || a.inputDiag == null) return { ok: false, error: 'không có cờ --qa-input-diag' }; if (!a.out) return { ok: false, error: 'thiếu --out <diag.json>' }; return { ok: true, args: { out: path.resolve(cwd, a.out), profile: a.profile ? path.resolve(cwd, a.profile) : null } }; }
module.exports = { fakeHelper, run, validate, COMBOS, CLICK_DELAYS, TEXTS, flagNames, CS, PS };
