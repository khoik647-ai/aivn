'use strict';
// ensure_app(app): bước CHẠY BẰNG MÃ (không nhờ mô hình) đưa một ứng dụng về trạng thái sẵn sàng thao tác, từ BẤT KỲ trạng thái nào:
//   chưa mở → mở (lối tắt Start Menu, shell:AppsFolder/AUMID, App Paths, thư mục cài phổ biến — dùng lại chuỗi tìm của open_app, nhớ cách mở theo từng ứng dụng)
//   thu nhỏ → khôi phục (SW_RESTORE + SetForegroundWindow, AttachThreadInput / mẹo phím Alt khi Windows chặn giành tiêu điểm)
//   bị che → đưa lên trước · chỉ còn biểu tượng ở khay hệ thống → chạy lại tệp .exe (ứng dụng một-phiên-bản tự hiện cửa sổ), không được thì bấm
//   biểu tượng khay qua UI Automation (vùng thông báo + “Hiện biểu tượng ẩn”), cuối cùng ShowWindow cửa sổ ẩn
//   rồi CHỜ SẴN SÀNG: cửa sổ chính hiện, không “Not Responding”, cây giao diện/OCR giống nhau 2 lần nhìn liên tiếp; quá hạn → lỗi rõ ràng.
// Ứng dụng web (Gmail, Google Docs…): bảo đảm trình duyệt (Chrome) rồi mở địa chỉ; gặp màn hình đăng nhập → DỪNG và hỏi người dùng (không tự đăng nhập).
// Lõi không phụ thuộc hệ điều hành (mọi thao tác qua `d`) để kiểm thử bằng ứng dụng giả; phần Windows ở cuối tệp.
const crypto = require('crypto');

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const key = (s) => fold(s).replace(/[^a-z0-9]/g, '');
// tên tiến trình của các ứng dụng hay gặp (tên hiển thị ≠ tên .exe)
const PROC_ALIASES = {
  chrome: ['chrome'], googlechrome: ['chrome'], trinhduyet: ['chrome', 'msedge', 'firefox', 'browser'], edge: ['msedge'], microsoftedge: ['msedge'],
  coccoc: ['browser'], firefox: ['firefox'], zalo: ['zalo'], word: ['winword'], microsoftword: ['winword'], excel: ['excel'], microsoftexcel: ['excel'],
  powerpoint: ['powerpnt'], outlook: ['outlook', 'olk'], teams: ['msteams', 'teams'], telegram: ['telegram'], fileexplorer: ['explorer'],
  vscode: ['code'], notepad: ['notepad'], paint: ['mspaint'], messenger: ['messenger'], discord: ['discord'], slack: ['slack'], whatsapp: ['whatsapp'], viber: ['viber'],
};
const BROWSER_PROCS = ['chrome', 'msedge', 'firefox', 'browser', 'brave', 'opera'];
const procNames = (app) => { const k = key(app); return [...new Set([...(PROC_ALIASES[k] || []), k].filter(x => x.length >= 2))]; };

// màn hình đăng nhập: tiêu đề rõ ràng, hoặc ≥2 dấu hiệu trong đó có ít nhất một dấu hiệu mạnh
const LOGIN_TITLE = /(?:^|[\s\-–|·:])(sign in|log ?in|đăng nhập|登录|登入|choose an account|chọn tài khoản)(?:$|[\s\-–|·:])|accounts\.google\.com|login\.(?:live|microsoftonline)\.com/iu;
const LOGIN_STRONG = /(enter your password|nhập mật khẩu|forgot (?:your )?password|quên mật khẩu|use another account|sử dụng (?:một )?tài khoản khác|quét mã qr|scan (?:the )?qr ?code|email or phone|email hoặc số điện thoại|create account|tạo tài khoản|扫码登录|输入密码)/giu;
const LOGIN_WEAK = /(sign in|đăng nhập|log ?in|password|mật khẩu|登录)/giu;
function loginWall(title, text) {
  if (LOGIN_TITLE.test(String(title || ''))) return 'tiêu đề cửa sổ';
  const t = String(text || ''); const strong = new Set((t.match(LOGIN_STRONG) || []).map(x => fold(x))); const weak = new Set((t.match(LOGIN_WEAK) || []).map(x => fold(x)));
  return strong.size >= 1 && strong.size + weak.size >= 2 ? [...strong][0] : null;
}

function pickMain(list, names, title, loose) {
  const ks = names.map(key).filter(Boolean); const tk = title ? key(title) : ''; const lk = loose ? key(loose) : '';
  const mine = (w) => { const p = key(w.proc); const procOk = !!p && ks.some(n => p === n || (n.length >= 4 && p.includes(n)) || (p.length >= 4 && n.includes(p))); return tk ? procOk && key(w.title).includes(tk) : procOk || (!!lk && lk.length >= 3 && key(w.title).startsWith(lk)); }; // loose: nền tảng không có tên tiến trình tin cậy → tiêu đề bắt đầu bằng tên ứng dụng // web: phải đúng THẺ (tiêu đề), không phải mọi cửa sổ trình duyệt
  const c = (list || []).filter(w => mine(w) && !w.cloaked && !w.tool && w.title).filter(w => !w.b || w.min || (w.b[2] >= 160 && w.b[3] >= 120));
  const score = (w) => (w.vis !== false ? 4 : 0) + (w.active ? 2 : 0) + (w.min ? 1 : 0) + (w.b ? Math.min(1, (w.b[2] * w.b[3]) / 2e6) : 0);
  return c.sort((a, b) => score(b) - score(a))[0] || null;
}

async function ensureApp(app, d, opt = {}) {
  const t0 = d.now ? d.now() : Date.now(); const now = () => (d.now ? d.now() : Date.now());
  const sleep = d.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const timeout = opt.timeoutMs || 45000; const deadline = t0 + timeout;
  const steps = []; const note = (x) => { steps.push(x); d.log && d.log(`ensure_app ${app}: ${x}`); };
  const fail = (code, error, extra = {}) => ({ ok: false, app, code, error, steps, ms: now() - t0, ...extra });
  const state = async (names) => { try { return await d.state(names); } catch (e) { note('không đọc được danh sách cửa sổ: ' + String(e.message || e).slice(0, 80)); return { windows: [], procs: [] }; } };
  const web = d.webApp ? d.webApp(app) : null;
  const cache = d.cache || new Map();

  // ---- ứng dụng web: trình duyệt + địa chỉ, dừng ở màn hình đăng nhập ----
  if (web && web.webOnly && !opt.native) {
    const browser = opt.browser || 'Chrome';
    let st = await state([...BROWSER_PROCS]);
    let w = pickMain((st.windows || []).filter(x => BROWSER_PROCS.includes(key(x.proc))), BROWSER_PROCS, web.name);
    if (w) note(`đã có thẻ/cửa sổ “${w.title}”`);
    else {
      const b = await ensureApp(browser, { ...d, webApp: null }, { ...opt, timeoutMs: Math.max(5000, deadline - now()), native: true, noLoginCheck: true });
      steps.push(...b.steps.map(x => `${browser}: ${x}`));
      if (!b.ok) return fail(b.code, `Chưa mở được trình duyệt ${browser} để vào ${web.name}: ${b.error}`);
      note(`mở ${web.url} trong ${browser}`);
      try { await d.openUrl(web.url, b.window); } catch (e) { return fail('open-url', `Chưa mở được ${web.url}: ${String(e.message || e).slice(0, 120)}`); }
      while (now() < deadline) {
        await sleep(700); st = await state([...BROWSER_PROCS]);
        const wins = (st.windows || []).filter(x => BROWSER_PROCS.includes(key(x.proc)));
        w = pickMain(wins, BROWSER_PROCS, web.name) || wins.find(x => loginWall(x.title, '')) || null;
        if (w) break;
      }
      if (!w) return fail('timeout', `Đã mở ${web.url} nhưng sau ${Math.round(timeout / 1000)} giây vẫn chưa thấy thẻ “${web.name}” trong ${browser}.`);
    }
    return finish(w, BROWSER_PROCS, web.name, 'web');
  }

  // ---- ứng dụng cài trên máy ----
  const names = [...new Set([...procNames(app), ...((cache.get(key(app)) || {}).procs || [])])];
  let st = await state(names);
  const L = d.looseTitle ? app : null;
  let w = pickMain(st.windows, names, null, L);
  let how;
  if (w && w.vis !== false) {
    how = w.min ? 'restored' : !w.active ? 'raised' : 'already';
    note(w.min ? `cửa sổ “${w.title}” đang thu nhỏ → khôi phục` : !w.active ? `cửa sổ “${w.title}” đang bị che/không ở trước → đưa lên trước${w.covered > 0.25 ? ` (bị che ${Math.round(w.covered * 100)}%)` : ''}` : `“${w.title}” đã ở trước`);
  } else {
    const procs = (st.procs || []).filter(p => names.some(n => key(p.proc) === n || (n.length >= 4 && key(p.proc).includes(n))));
    if (procs.length) {
      // đang chạy nhưng không có cửa sổ hiện: chỉ còn ở khay hệ thống
      how = 'tray'; note(`đang chạy (${procs[0].proc}) nhưng không có cửa sổ — chỉ còn biểu tượng ở khay hệ thống`);
      const exe = (procs.find(p => p.path) || {}).path;
      if (exe && d.launchPath) { note(`chạy lại ${exe.split(/[\\/]/).pop()} (ứng dụng một phiên bản sẽ tự hiện cửa sổ)`); try { await d.launchPath(exe); } catch (e) { note('chạy lại lỗi: ' + String(e.message || e).slice(0, 80)); } w = await waitWin(names, Math.min(8000, deadline - now())); }
      if (!w && d.tray) { note('bấm biểu tượng ở khay hệ thống (UI Automation)'); let r = null; try { r = await d.tray([app, ...names]); } catch (e) { note('khay hệ thống lỗi: ' + String(e.message || e).slice(0, 80)); } if (r && r.ok) { note(`đã bấm biểu tượng “${r.name || app}” (${r.how})`); w = await waitWin(names, Math.min(6000, deadline - now())); } else if (r) note('không thấy biểu tượng trên khay' + (r.error ? ': ' + r.error : '')); }
      if (!w) { const hid = pickMain(st.windows || [], names, null, L); if (hid && d.show) { note(`hiện cửa sổ ẩn “${hid.title}”`); try { await d.show(hid); } catch {} w = await waitWin(names, Math.min(4000, deadline - now())); } }
      if (!w) return fail('tray', `${app} đang chạy ẩn ở khay hệ thống nhưng mình chưa mở được cửa sổ (đã thử: ${steps.slice(1).join('; ')}). Bạn bấm vào biểu tượng ${app} ở góc phải thanh tác vụ giúp mình nhé.`);
    } else {
      how = 'launched'; note('chưa mở → khởi động');
      let r; try { r = await d.launch(app); } catch (e) { r = { ok: false, tried: [String(e.message || e)] }; }
      if (!r || !r.ok) return fail('not-found', `Không mở được ${app}${r && r.tried && r.tried.length ? ` (đã thử: ${r.tried.join('; ').slice(0, 300)})` : ''}. Kiểm tra ${app} đã cài trên máy chưa.`);
      note(`đã chạy qua ${r.how || 'lối tắt'}`);
      if (r.window && r.window.proc) { const pk = key(r.window.proc); if (!names.includes(pk)) { names.push(pk); cache.set(key(app), { ...(cache.get(key(app)) || {}), procs: [pk] }); } }
      w = await waitWin(names, Math.max(0, deadline - now()));
      if (!w) return fail('timeout', `Đã khởi động ${app} nhưng sau ${Math.round(timeout / 1000)} giây vẫn chưa thấy cửa sổ chính.`);
    }
  }
  return finish(w, names, null, how);

  async function waitWin(ns, ms) {
    const end = now() + Math.max(0, ms);
    for (;;) { const s2 = await state(ns); const x = pickMain(s2.windows, ns, null, L); if (x && x.vis !== false) return x; if (now() >= end) return null; await sleep(600); }
  }
  async function finish(win, ns, title, how0) {
    // đưa lên trước (khôi phục nếu thu nhỏ), kiểm lại là cửa sổ đang ở trước
    let w0 = win; let warn = null;
    if (!w0.active || w0.min) {
      for (let i = 0; i < 2; i++) {
        let r = null; try { r = await d.focus(w0); } catch (e) { r = { ok: false, error: e.message }; }
        if (r && r.how && r.how !== 'set') note(`giành tiêu điểm bằng ${r.how === 'attach' ? 'AttachThreadInput' : r.how === 'alt' ? 'mẹo phím Alt' : r.how}`);
        const s2 = await state(ns); const x = (s2.windows || []).find(y => String(y.hwnd) === String(w0.hwnd)) || pickMain(s2.windows, ns, title, title ? null : L);
        if (x) w0 = x;
        if (x && x.active && !x.min) break;
        if (i === 1) warn = `chưa đưa được “${w0.title}” lên trước (hệ điều hành chặn giành tiêu điểm) — thao tác có thể rơi vào cửa sổ khác`;
      }
      if (warn) note(warn);
    }
    // chờ sẵn sàng: không treo, cây giao diện/OCR giống nhau 2 lần nhìn liên tiếp
    let prev = null, hungSince = null, looks = 0, last = null;
    for (;;) {
      const s2 = await state(ns); const x = (s2.windows || []).find(y => String(y.hwnd) === String(w0.hwnd)) || pickMain(s2.windows, ns, title, title ? null : L);
      if (!x || x.vis === false) { if (now() >= deadline) return fail('timeout', `Cửa sổ ${app} biến mất trong lúc chờ sẵn sàng.`); await sleep(600); continue; }
      w0 = x;
      if (x.hung) { hungSince = hungSince || now(); if (now() >= deadline) return fail('hung', `${app} đang “Không phản hồi” (Not Responding) suốt ${Math.round((now() - hungSince) / 1000)} giây — mình dừng để không bấm nhầm. Đợi ứng dụng hồi lại hoặc khởi động lại ${app} rồi giao lại việc.`, { window: x }); await sleep(800); continue; }
      let lk = null; try { lk = await d.look(x); } catch (e) { lk = null; }
      looks++; last = lk;
      if (lk && lk.sig && prev && lk.sig === prev.sig) break; // cần giao diện KHÔNG rỗng và giống nhau 2 lần liên tiếp
      prev = lk;
      if (now() >= deadline) { if (lk) { note(`giao diện vẫn đang đổi sau ${Math.round(timeout / 1000)} giây — tiếp tục`); break; } return fail('timeout', `${app} chưa sẵn sàng sau ${Math.round(timeout / 1000)} giây (chưa đọc được giao diện).`, { window: x }); }
      await sleep(opt.lookGapMs || 700);
    }
    note(`sẵn sàng sau ${looks} lần nhìn`);
    if (!opt.noLoginCheck) { const why = loginWall(w0.title, last && last.text); if (why) { const ask = `${title || app} đang ở màn hình đăng nhập (${why}). Mình không tự đăng nhập — bạn đăng nhập ${title || app} giúp mình rồi bảo mình làm tiếp nhé.`; return { ...fail('login', ask, { window: w0 }), ask, stop: true }; } }
    if (how0 === 'launched' && d.remember) { try { d.remember(app, w0); } catch {} }
    return { ok: true, app, how: how0, window: w0, warn, steps, ms: now() - t0 };
  }
}

// ---------------- Windows ----------------
// Trình phụ C# (biên dịch một lần ra DLL trong %TEMP%, tên theo hash mã nguồn): liệt kê cửa sổ cấp cao (cả thu nhỏ/ẩn của ứng dụng đích),
// treo (IsHungAppWindow), bị che (theo thứ tự Z), cloaked (DWM), tiến trình đang chạy + đường dẫn .exe; đưa cửa sổ lên trước nhiều cách.
const CS_SRC = String.raw`using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices; using System.Text;
public static class AivnEA {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint acc, bool inh, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int f, StringBuilder s, ref int n);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  static void Dpi() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } }
  static string J(string s) { if (s == null) return "\"\""; var b = new StringBuilder("\""); foreach (char c in s) { if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); } else if (c < 32) b.Append("\\u" + ((int)c).ToString("x4")); else b.Append(c); } return b.Append('"').ToString(); }
  static string Key(string s) { var b = new StringBuilder(); foreach (char c in (s ?? "").ToLowerInvariant()) if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) b.Append(c); return b.ToString(); }
  static string ExePath(uint pid) { IntPtr h = OpenProcess(0x1000, false, pid); if (h == IntPtr.Zero) return ""; try { var sb = new StringBuilder(1024); int n = 1024; return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : ""; } finally { CloseHandle(h); } }
  static bool Match(string proc, string title, string[] keys) { string p = Key(proc); foreach (var k in keys) { if (k.Length < 2) continue; if (p == k || (k.Length >= 4 && p.Contains(k)) || (p.Length >= 4 && k.Contains(p))) return true; } return false; }
  static long Inter(RECT a, RECT b) { long w = Math.Min(a.R, b.R) - Math.Max(a.L, b.L), h = Math.Min(a.B, b.B) - Math.Max(a.T, b.T); return w > 0 && h > 0 ? w * h : 0; }
  public static string State(string namesBar) {
    Dpi();
    string[] keys = (namesBar ?? "").Split('|'); for (int i = 0; i < keys.Length; i++) keys[i] = Key(keys[i]);
    IntPtr fg = GetForegroundWindow();
    var wins = new List<string>(); var above = new List<RECT>(); var pinfo = new Dictionary<uint, string>(); int z = 0;
    EnumWindows((h, l) => {
      z++;
      bool vis = IsWindowVisible(h), min = IsIconic(h); int ex = GetWindowLong(h, -20);
      bool tool = (ex & 0x80) != 0, clickThrough = (ex & 0x20) != 0; int cloaked = 0; try { DwmGetWindowAttribute(h, 14, out cloaked, 4); } catch { }
      RECT r; GetWindowRect(h, out r); uint pid; GetWindowThreadProcessId(h, out pid);
      int len = GetWindowTextLength(h); string title = ""; if (len > 0) { var sb = new StringBuilder(len + 2); GetWindowText(h, sb, len + 2); title = sb.ToString(); }
      string proc; if (!pinfo.TryGetValue(pid, out proc)) { try { proc = Process.GetProcessById((int)pid).ProcessName; } catch { proc = ""; } pinfo[pid] = proc; }
      bool owned = GetWindow(h, 4) != IntPtr.Zero; bool target = Match(proc, title, keys);
      double covered = 0;
      if (vis && !min && cloaked == 0) { long area = Math.Max(1L, (long)(r.R - r.L) * (r.B - r.T)), hit = 0; foreach (var a in above) hit += Inter(r, a); covered = Math.Min(1.0, (double)hit / area); if (!clickThrough && len > 0 && (r.R - r.L) > 40 && (r.B - r.T) > 40) above.Add(r); }
      if (len > 0 && !owned && !tool && (vis || target) && wins.Count < 120)
        wins.Add("{\"hwnd\":" + h.ToInt64() + ",\"title\":" + J(title) + ",\"pid\":" + pid + ",\"proc\":" + J(proc) + ",\"path\":" + J(target ? ExePath(pid) : "") + ",\"vis\":" + (vis ? "true" : "false") + ",\"min\":" + (min ? "true" : "false") + ",\"cloaked\":" + (cloaked != 0 ? "true" : "false") + ",\"hung\":" + (IsHungAppWindow(h) ? "true" : "false") + ",\"active\":" + (h == fg ? "true" : "false") + ",\"covered\":" + covered.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + ",\"z\":" + z + ",\"b\":[" + r.L + "," + r.T + "," + (r.R - r.L) + "," + (r.B - r.T) + "]}");
      return true; }, IntPtr.Zero);
    var procs = new List<string>();
    foreach (var p in Process.GetProcesses()) { try { if (procs.Count < 20 && Match(p.ProcessName, "", keys)) procs.Add("{\"pid\":" + p.Id + ",\"proc\":" + J(p.ProcessName) + ",\"path\":" + J(ExePath((uint)p.Id)) + "}"); } catch { } }
    return "{\"windows\":[" + string.Join(",", wins) + "],\"procs\":[" + string.Join(",", procs) + "]}";
  }
  public static string Focus(long hv) {
    Dpi(); IntPtr h = new IntPtr(hv); bool wasMin = IsIconic(h), wasVis = IsWindowVisible(h);
    if (wasMin) ShowWindow(h, 9); else if (!wasVis) ShowWindow(h, 5);
    string how = "set"; SetForegroundWindow(h); System.Threading.Thread.Sleep(60); bool ok = GetForegroundWindow() == h;
    if (!ok) { how = "attach"; uint pid; uint fgT = GetWindowThreadProcessId(GetForegroundWindow(), out pid), me = GetCurrentThreadId(), tT = GetWindowThreadProcessId(h, out pid);
      bool a1 = fgT != me && AttachThreadInput(me, fgT, true), a2 = tT != me && tT != fgT && AttachThreadInput(me, tT, true);
      BringWindowToTop(h); SetForegroundWindow(h); if (a1) AttachThreadInput(me, fgT, false); if (a2) AttachThreadInput(me, tT, false);
      System.Threading.Thread.Sleep(60); ok = GetForegroundWindow() == h; }
    if (!ok) { how = "alt"; keybd_event(0x12, 0, 0, UIntPtr.Zero); SetForegroundWindow(h); keybd_event(0x12, 0, 2, UIntPtr.Zero); BringWindowToTop(h); System.Threading.Thread.Sleep(80); ok = GetForegroundWindow() == h; }
    return "{\"ok\":" + (ok ? "true" : "false") + ",\"how\":" + J(how) + ",\"wasMin\":" + (wasMin ? "true" : "false") + ",\"wasVis\":" + (wasVis ? "true" : "false") + "}";
  }
  public static string Show(long hv) { IntPtr h = new IntPtr(hv); ShowWindow(h, 5); ShowWindow(h, 9); return Focus(hv); }
}
`;
const CS_VER = crypto.createHash('sha1').update(CS_SRC).digest('hex').slice(0, 10);
const PS_EA = (call) => String.raw`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if (-not ('AivnEA' -as [type])) {
  $dll = Join-Path $env:TEMP ('aivn-ea-' + $env:AIVN_EAV + '.dll')
  try { if (-not (Test-Path $dll)) { Add-Type -TypeDefinition $env:AIVN_EACS -Language CSharp -OutputAssembly $dll -OutputType Library }; Add-Type -Path $dll }
  catch { Add-Type -TypeDefinition $env:AIVN_EACS -Language CSharp }
}
` + call;
// Khay hệ thống: tìm nút có tên ứng dụng trong vùng thông báo (Shell_TrayWnd) và cửa sổ “biểu tượng ẩn” (mở bằng nút mũi tên nếu cần)
const PS_TRAY = String.raw`
$names = @($env:AIVN_NAMES -split '\|' | Where-Object { $_.Length -ge 2 } | ForEach-Object { $_.ToLowerInvariant() })
$AE = [System.Windows.Automation.AutomationElement]; $TS = [System.Windows.Automation.TreeScope]; $TRUE = [System.Windows.Automation.Condition]::TrueCondition
function Win($cls) { $c = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, $cls); return $AE::RootElement.FindFirst($TS::Children, $c) }
function FindBtn($scope) { if (-not $scope) { return $null }; foreach ($e in $scope.FindAll($TS::Descendants, $TRUE)) { try { $n = $e.Current.Name; $ct = $e.Current.ControlType.ProgrammaticName } catch { continue }; if (-not $n -or $ct -notmatch 'Button|MenuItem|ListItem') { continue }; $ln = $n.ToLowerInvariant(); foreach ($q in $names) { if ($ln.Contains($q)) { return $e } } }; return $null }
$tray = Win 'Shell_TrayWnd'; if (-not $tray) { [ordered]@{ ok = $false; error = 'không thấy thanh tác vụ' } | ConvertTo-Json -Compress; exit }
$b = FindBtn $tray; $where = 'khay'
if (-not $b) {
  foreach ($e in $tray.FindAll($TS::Descendants, $TRUE)) { try { $n = $e.Current.Name } catch { continue }; if ($n -match 'hidden icons|biểu tượng ẩn|bieu tuong an|隐藏的图标|Notification Chevron') { try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { try { $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle() } catch {} }; Start-Sleep -Milliseconds 700; break } }
  foreach ($cls in 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland', 'Xaml_WindowedPopupClass') { $b = FindBtn (Win $cls); if ($b) { $where = 'biểu tượng ẩn'; break } }
}
if (-not $b) { [ordered]@{ ok = $false; error = 'không thấy biểu tượng' } | ConvertTo-Json -Compress; exit }
$r = $b.Current.BoundingRectangle; $how = 'invoke'
try { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { $how = 'click' }
[ordered]@{ ok = $true; how = $how; where = $where; name = $b.Current.Name; x = [int]($r.X + $r.Width / 2); y = [int]($r.Y + $r.Height / 2) } | ConvertTo-Json -Compress
`;
function winDeps({ log, click } = {}) {
  const U = require('./uitree');
  const env = { AIVN_EAV: CS_VER, AIVN_EACS: CS_SRC };
  const js = (o) => { const t = String(o || '').trim(); const i = t.indexOf('{'); return JSON.parse(i > 0 ? t.slice(i) : t); };
  return {
    state: async (names) => js(await U.ps(PS_EA('[AivnEA]::State($env:AIVN_NAMES)'), { ...env, AIVN_NAMES: names.join('|') }, 20000)),
    focus: async (w) => js(await U.ps(PS_EA('[AivnEA]::Focus([int64]$env:AIVN_HWND)'), { ...env, AIVN_HWND: String(w.hwnd) }, 15000)),
    show: async (w) => js(await U.ps(PS_EA('[AivnEA]::Show([int64]$env:AIVN_HWND)'), { ...env, AIVN_HWND: String(w.hwnd) }, 15000)),
    tray: async (names) => { const r = js(await U.ps(U.PS_PRELUDE + PS_TRAY, { AIVN_NAMES: names.join('|') }, 20000)); if (r.ok && r.how === 'click' && click) { await click(r.x, r.y); } return r; },
    launchPath: async (exe) => { const { spawn } = require('child_process'); const c = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: require('path').dirname(exe) }); c.on('error', (e) => log && log('chạy lại lỗi: ' + e.message)); c.unref(); },
  };
}

// Linux (máy kiểm thử Xvfb + trình quản lý cửa sổ): wmctrl liệt kê cả cửa sổ thu nhỏ (_NET_WM_STATE_HIDDEN), wmctrl -a khôi phục + đưa lên trước
function linuxDeps() {
  const { execFile } = require('child_process'); const fs = require('fs');
  const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 8000, encoding: 'utf8' }, (e, o) => (e ? rej(e) : res(String(o || '')))));
  const comm = (pid) => { try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return ''; } };
  return {
    looseTitle: true,
    state: async (names) => {
      const ks = names.map(key).filter(k => k.length >= 3);
      let active = 0; try { active = Number((await run('xdotool', ['getactivewindow'])).trim()) || 0; } catch {}
      const windows = [];
      for (const l of (await run('wmctrl', ['-lpG'])).split('\n').filter(Boolean)) {
        const m = /^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s?(.*)$/i.exec(l); if (!m || !m[8]) continue;
        const id = parseInt(m[1], 16); let st = ''; try { st = await run('xprop', ['-id', m[1], '_NET_WM_STATE']); } catch {}
        windows.push({ hwnd: id, title: m[8], pid: +m[3], proc: comm(+m[3]), vis: true, min: /_NET_WM_STATE_HIDDEN/.test(st), active: id === active, b: [+m[4], +m[5], +m[6], +m[7]] });
      }
      const procs = []; try { for (const p of fs.readdirSync('/proc')) { if (!/^\d+$/.test(p) || procs.length >= 20) continue; const c = comm(p); if (c && ks.some(k => key(c) === k)) { let exe = ''; try { exe = fs.readlinkSync(`/proc/${p}/exe`); } catch {} procs.push({ pid: +p, proc: c, path: exe }); } } } catch {}
      return { windows, procs };
    },
    focus: async (w) => { await run('wmctrl', ['-i', '-a', '0x' + Number(w.hwnd).toString(16)]); return { ok: true, how: 'set' }; },
    show: async (w) => { await run('wmctrl', ['-i', '-R', '0x' + Number(w.hwnd).toString(16)]); return { ok: true }; },
  };
}

module.exports = { linuxDeps, ensureApp, loginWall, pickMain, procNames, PROC_ALIASES, BROWSER_PROCS, CS_SRC, CS_VER, PS_EA, PS_TRAY, winDeps, key };
