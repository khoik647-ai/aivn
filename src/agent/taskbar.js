'use strict';
// B115/B121 (máy thật beta.2.5/2.6) và #27 (beta.3, d1b150d): thanh tác vụ Windows TỰ ẨN trồi lên khi chuột chạm mép màn hình và che ô soạn tin.
// beta.3 đã nhận ra tự ẩn (ABM_GETSTATE=1, StuckRects3=3) nhưng vẫn bấm y=1401: khung OCR của ô soạn (1398–1418) nằm trọn trong dải đáy 43 px.
// Kéo điểm ra ngoài khung (y=1396) thì bấm trượt ô. Đưa chuột ra xa cho thanh tác vụ kịp ẩn, rồi bấm TRONG khung. Chỉ làm vậy trên màn hình đang có thanh tác vụ.
// Phát hiện: SHAppBarMessage(ABM_GETSTATE=4) & ABS_AUTOHIDE là quyết định khi gọi được — trả 0 thì KHÔNG tự ẩn,
// dù byte registry nói khác (Explorer có thể chưa áp). StuckRects3 byte 8 chỉ khi ABM không đọc được.
// Trên đường đó, khung làm việc bị trừ độ dày thanh đúng cạnh (vd. đỉnh = 60) nghĩa là thanh đang hiện, không tự ẩn.
// Cạnh và độ dày: ABM_GETTASKBARPOS (5) + GetWindowRect(Shell_TrayWnd).
// Toạ độ bấm và khung màn hình là ĐIỂM ẢNH VẬT LÝ. Khung làm việc (work area) khi tự ẩn trùng khung màn hình — không được lấy chỗ lệch đó làm gốc toạ độ,
// cũng không được so điểm vật lý với chiều cao DIP (125 %: 1152 thay vì 1440).
const ABS_AUTOHIDE = 0x1;
const EDGES = ['left', 'top', 'right', 'bottom'];
const EDGE_VI = { left: 'trái', top: 'đỉnh', right: 'phải', bottom: 'đáy' };
const PS = `$ErrorActionPreference='Continue'
$abm = -1; $err = ''; $edge = -1; $smw = -1; $smh = -1
$tray = ''; $tray2 = ''; $abmpos = ''; $work = ''
try {
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class AivnAppBar3 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
  [DllImport("shell32.dll")] public static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint p, ref RECT r, uint f);
  public static void Aware() { try { SetProcessDpiAwarenessContext((IntPtr)(-4)); } catch { try { SetProcessDPIAware(); } catch {} } }
  public static long State() { var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA)); return SHAppBarMessage(4, ref d).ToInt64(); }
  public static string Pos() { var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA)); SHAppBarMessage(5, ref d); return d.uEdge + "," + d.rc.left + "," + d.rc.top + "," + d.rc.right + "," + d.rc.bottom; }
  public static string Tray(string cls) { var h = FindWindow(cls, null); if (h == IntPtr.Zero) return ""; var r = new RECT(); if (!GetWindowRect(h, out r)) return ""; return r.left + "," + r.top + "," + r.right + "," + r.bottom; }
  public static string Work() { var r = new RECT(); if (!SystemParametersInfo(48, 0, ref r, 0)) return ""; return r.left + "," + r.top + "," + r.right + "," + r.bottom; }
}
"@
[AivnAppBar3]::Aware()
$smw = [AivnAppBar3]::GetSystemMetrics(0); $smh = [AivnAppBar3]::GetSystemMetrics(1)
$abm = [AivnAppBar3]::State()
try { $abmpos = [AivnAppBar3]::Pos() } catch { if (-not $err) { $err = $_.Exception.Message } }
try { $tray = [AivnAppBar3]::Tray('Shell_TrayWnd') } catch { if (-not $err) { $err = $_.Exception.Message } }
try { $tray2 = [AivnAppBar3]::Tray('Shell_SecondaryTrayWnd') } catch {}
try { $work = [AivnAppBar3]::Work() } catch { if (-not $err) { $err = $_.Exception.Message } }
} catch { $err = $_.Exception.Message }
$stuck = -1; $edgeReg = -1
try { $v = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects3' -Name Settings -ErrorAction Stop).Settings; if ($v.Length -gt 8) { $stuck = [int]$v[8] }; if ($v.Length -gt 12) { $edgeReg = [int]$v[12] } } catch { if (-not $err) { $err = $_.Exception.Message } }
if ($abmpos -match '^(\d+),') { $edge = [int]$Matches[1] } elseif ($edgeReg -ge 0 -and $edgeReg -le 3) { $edge = $edgeReg }
[Console]::Out.Write("ABM=$abm;STUCK=$stuck;ERR=" + ($err -replace '[\\r\\n;]', ' ') + ";EDGE=$edge;SM=$smw,$smh;TRAY=$tray;TRAY2=$tray2;ABMPOS=$abmpos;WORK=$work")`;
let cache = null;
const num = (s) => /^-?\d+$/.test(String(s || '')) ? Number(s) : null;
function parseRect(s) {
  const p = String(s || '').split(','); if (p.length !== 4 || p.some(x => num(x.trim()) == null)) return null;
  const n = p.map(x => Number(x.trim())); return { l: n[0], t: n[1], r: n[2], b: n[3] };
}
function parsePair(s) {
  const p = String(s || '').split(','); if (p.length !== 2 || num(p[0].trim()) == null || num(p[1].trim()) == null) return null;
  return { w: Number(p[0].trim()), h: Number(p[1].trim()) };
}
// Khung làm việc (cùng đơn vị với SM_CXSCREEN) bị trừ một độ dày thanh hợp lý ĐÚNG cạnh đã biết → thanh đang hiện.
// Không biết cạnh thì không bác: lệch có thể là appbar khác. Lệch 0 (tự ẩn) và lệch dưới 8 px không tính.
// Chỉ bác StuckRects3; ABM đọc được thì không dùng đường này.
function workAreaShowsBar(base) {
  const sm = base && base.sm, work = base && base.work;
  const e = base && base.edge;
  if (!e || !sm || !work || !(sm.w > 0) || !(sm.h > 0)) return false;
  const span = e === 'left' || e === 'right' ? sm.w : sm.h;
  const gap = e === 'top' ? work.t : e === 'bottom' ? sm.h - work.b : e === 'left' ? work.l : sm.w - work.r;
  return plausible(gap, span);
}
// Cùng quy tắc trên khung VẬT LÝ (bounds) và khung làm việc Electron đã đổi sang vật lý. Cạnh phải biết.
function workInsetShowsBar(bounds, work, edge) {
  if (!bounds || !work || !EDGES.includes(edge)) return false;
  const g = workGap(bounds, work); if (!g) return false;
  const span = edge === 'left' || edge === 'right' ? bounds.width : bounds.height;
  const gap = edge === 'left' ? g.left : edge === 'right' ? g.right : edge === 'top' ? g.top : g.bottom;
  return plausible(gap, span);
}
// Quyết định tự ẩn dùng chung: ABM / StuckRects3 từ detect, rồi bác bằng khung làm việc Electron khi via còn StuckRects3 và cạnh đã biết.
// Không sửa object detect (bị nhớ cache).
function decideAutoHide(det, bounds, work) {
  const d = det && typeof det === 'object' ? { ...det } : { autoHide: false, via: 'không đọc được', abm: -1, stuck: -1 };
  if (d.via === 'StuckRects3' && workInsetShowsBar(bounds, work, d.edge)) { d.autoHide = false; d.via = 'khung làm việc'; }
  return d;
}
// đọc kết quả PowerShell: ABM=<số>;STUCK=<byte>;ERR=<chữ>[;EDGE=;SM=;TRAY=;...]. Cũ: chỉ một số (trạng thái ABM)
// abm >= 0: chỉ bit ABS_AUTOHIDE của ABM_GETSTATE. StuckRects3 chỉ khi ABM không có (âm hoặc lỗi).
function parseState(out) {
  const t = String(out || '').trim(); if (!t) return null;
  if (/^\d+$/.test(t)) { const n = Number(t); return { abm: n, stuck: -1, autoHide: !!(n & ABS_AUTOHIDE), via: 'ABM_GETSTATE', state: n }; }
  const g = (k) => { const m = new RegExp('(?:^|;)' + k + '=([^;]*)').exec(t); return m ? m[1].trim() : ''; };
  const abm = num(g('ABM')); const stuckN = num(g('STUCK'));
  const abmV = abm == null ? -1 : abm; const stuck = stuckN == null ? -1 : stuckN;
  let base;
  if (abmV >= 0) base = { abm: abmV, stuck, autoHide: !!(abmV & ABS_AUTOHIDE), via: 'ABM_GETSTATE', err: g('ERR') || '' };
  else if (stuck >= 0) base = { abm: abmV, stuck, autoHide: (stuck & ABS_AUTOHIDE) !== 0, via: 'StuckRects3', err: g('ERR') || '' };
  else base = { abm: abmV, stuck, autoHide: false, via: 'không đọc được', err: g('ERR') || '' };
  if (g('EDGE') === '' && !g('SM') && !g('TRAY') && !g('TRAY2') && !g('ABMPOS') && !g('WORK')) return base;
  const edgeN = num(g('EDGE')); const pos = String(g('ABMPOS') || ''); const pm = /^(\d+),(.*)$/.exec(pos); const pe = pm ? num(pm[1]) : null;
  base.edge = edgeN != null && edgeN >= 0 && edgeN <= 3 ? EDGES[edgeN] : (pe != null && pe >= 0 && pe <= 3 ? EDGES[pe] : null);
  base.sm = parsePair(g('SM'));
  base.tray = parseRect(g('TRAY'));
  base.tray2 = parseRect(g('TRAY2'));
  base.abmPos = pm ? { edge: Number(pm[1]) <= 3 ? EDGES[Number(pm[1])] : null, rect: parseRect(pm[2]) } : null;
  base.work = parseRect(g('WORK'));
  if (abmV < 0 && base.autoHide && workAreaShowsBar(base)) { base.autoHide = false; base.via = 'khung làm việc'; }
  return base;
}
// chi tiết quyết định (Windows); hệ điều hành khác → { autoHide:false, via:'không phải Windows' }. Lưu 2 phút
function detect({ platform = process.platform, run = null, now = Date.now() } = {}) {
  if (platform !== 'win32' && !run) return Promise.resolve({ autoHide: false, via: 'không phải Windows', abm: -1, stuck: -1 });
  if (cache && now - cache.at < 120000) return cache.p;
  const exec = run || (() => new Promise((resolve) => {
    const enc = Buffer.from(PS, 'utf16le').toString('base64');
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { timeout: 15000, windowsHide: true }, (e, out, err) => resolve(out || (e ? `ABM=-1;STUCK=-1;ERR=${String(e.message || err || '').slice(0, 120)}` : '')));
  }));
  const p = new Promise((r) => r(exec(PS))).then(o => parseState(o) || { autoHide: false, via: 'không đọc được', abm: -1, stuck: -1, err: 'không có kết quả' }).catch(e => ({ autoHide: false, via: 'lỗi', abm: -1, stuck: -1, err: String(e && e.message || e) }));
  cache = { at: now, p }; return p;
}
const autoHide = (o) => detect(o).then(d => !!d.autoHide);
const describe = (d) => `thanh tác vụ tự ẩn: ${d.autoHide ? 'CÓ' : 'KHÔNG'} (theo ${d.via}; ABM_GETSTATE=${d.abm}, StuckRects3=${d.stuck}${d.err ? `, lỗi: ${String(d.err).slice(0, 80)}` : ''}${d.edge ? `, cạnh ${EDGE_VI[d.edge] || d.edge}` : ''})`;
// dải mép (vật lý): ≈3 % cạnh màn hình, tối thiểu 6 px. Đây là dải beta.3 đo được (43 px trên màn 1440).
function bandOf(bounds) { return Math.max(6, Math.round((bounds.height > 0 ? bounds.height : 0) * 0.03)); }
function bandAlong(span) { return Math.max(6, Math.round(span * 0.03)); }
const edgeOf = (d) => (d && EDGES.includes(d.edge) ? d.edge : 'bottom');
// Hệ số DIP → vật lý khi PowerShell không vào được per-monitor v2 (SM_CYSCREEN là chiều cao logic của màn chính).
function dpiK(det, primaryH) {
  const sm = det && det.sm && Number(det.sm.h); const phys = Number(primaryH) || 0;
  if (!(sm > 0) || !(phys > 0)) return 1;
  const k = phys / sm; if (Math.abs(k - 1) < 0.02) return 1; return (k > 0.4 && k < 3.5) ? k : 1;
}
function scaleRect(r, k) {
  if (!r || !(k > 0) || Math.abs(k - 1) < 0.001) return r;
  return { l: Math.round(r.l * k), t: Math.round(r.t * k), r: Math.round(r.r * k), b: Math.round(r.b * k) };
}
// Thanh tác vụ của ĐÚNG màn hình này: tâm nằm trong màn hình (kể cả vừa thò ra ngoài ≤ 64 px khi đang ẩn).
function ownsBar(r, bounds) {
  if (!r || !bounds || !(r.r > r.l) || !(r.b > r.t)) return false;
  const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2, pad = 64;
  return cx >= bounds.x - pad && cx < bounds.x + bounds.width + pad && cy >= bounds.y - pad && cy < bounds.y + bounds.height + pad;
}
function rectThick(r, edge) {
  if (!r) return 0; const h = r.b - r.t, w = r.r - r.l;
  if (edge === 'left' || edge === 'right') return w > 0 ? w : 0;
  if (edge === 'top' || edge === 'bottom') return h > 0 ? h : 0;
  return h > 0 && w > 0 ? Math.min(h, w) : 0;
}
// Khung làm việc DIP của Electron → vật lý theo đúng màn hình (không nhân một tỉ lệ chung cho mọi màn).
function workToPhys(geo, workDip) {
  if (!geo || !geo.phys || !geo.dip || !workDip) return null;
  const s = geo.scale || 1;
  return {
    x: Math.round(geo.phys.x + (workDip.x - geo.dip.x) * s), y: Math.round(geo.phys.y + (workDip.y - geo.dip.y) * s),
    width: Math.round(workDip.width * s), height: Math.round(workDip.height * s),
  };
}
function workGap(bounds, work) {
  if (!bounds || !work) return null;
  return {
    left: work.x - bounds.x, top: work.y - bounds.y,
    right: (bounds.x + bounds.width) - (work.x + work.width), bottom: (bounds.y + bounds.height) - (work.y + work.height),
  };
}
function plausible(th, span) { return th >= 8 && th < span * 0.2; }
// Độ dày thanh tác vụ đang che (px vật lý) trên màn hình `bounds`. 0 nếu không đo được.
// Khung làm việc bằng khung màn hình (tự ẩn) → lệch 0, KHÔNG suy ra “không có thanh tác vụ”.
// Lệch cỡ chiều cao DIP (vd. 288 px khi 1440 so với 1152) bị loại — đó là lệch đơn vị, không phải độ dày.
function thickFrom(det, bounds, work, primaryH) {
  if (!bounds) return 0;
  const edge = edgeOf(det); const vertical = edge === 'top' || edge === 'bottom';
  const span = vertical ? bounds.height : bounds.width; if (!(span > 0)) return 0;
  const k = dpiK(det, primaryH || (bounds.y === 0 && bounds.x === 0 ? bounds.height : 0));
  let best = 0;
  for (const raw of [det && det.tray, det && det.tray2, det && det.abmPos && det.abmPos.rect]) {
    const r = scaleRect(raw, k); if (!ownsBar(r, bounds)) continue;
    const th = rectThick(r, edge); if (plausible(th, span) && th > best) best = th;
  }
  const g = workGap(bounds, work); if (g) {
    const gap = edge === 'left' ? g.left : edge === 'right' ? g.right : edge === 'top' ? g.top : g.bottom;
    if (plausible(gap, span) && gap > best) best = gap;
  }
  return best;
}
function seg(box, i, n) { return Array.isArray(box) && box.length >= 4 && box[n] > 0 ? [box[i], box[n]] : [0, 0]; }
function wseg(win, i, n) { return Array.isArray(win) && win.length >= 4 && win[n] > 0 ? [win[i], win[n]] : [null, 0]; }
// Giữ toạ độ trong đoạn [box0, box0+boxN). Không có khung thì trả pos.
function insideSpan(pos, box0, boxN) {
  if (!(boxN > 0)) return pos;
  const a = box0, b = box0 + boxN - 1;
  if (b < a) return a;
  return Math.max(a, Math.min(b, pos));
}
// Điểm an toàn phía trong mép CAO (đáy / phải). Khung còn nhô ra khỏi dải → bấm trong phần đó.
// Khung nằm trọn trong dải → giữ điểm TRONG khung (người gọi đã đưa chuột ra xa trước). Không bao giờ kéo ra ngoài khung.
function safeHigh(pos, origin, span, box0, boxN, win0, winN, band) {
  const limit = origin + span - band - 1;
  if (pos <= limit) return pos;
  if (boxN > 0 && box0 + 2 <= limit) return insideSpan(Math.max(box0 + 2, Math.min(limit, box0 + boxN - 2)), box0, boxN);
  if (boxN > 0) return insideSpan(pos, box0, boxN);
  return clampOut(limit, win0, winN, limit, 'high');
}
function safeLow(pos, origin, span, box0, boxN, win0, winN, band) {
  const limit = origin + band;
  if (pos >= limit) return pos;
  if (boxN > 0 && box0 + boxN - 2 >= limit) return insideSpan(Math.min(box0 + boxN - 2, Math.max(limit, box0 + 2)), box0, boxN);
  if (boxN > 0) return insideSpan(pos, box0, boxN);
  return clampOut(limit, win0, winN, limit, 'low');
}
// Không kéo điểm bấm ngược vào dải. Cửa sổ kết thúc trước dải thì bấm mép trong của cửa sổ.
function clampOut(ny, win0, winN, limit, side) {
  if (win0 == null || !(winN > 0)) return ny;
  const a = win0 + 2, b = win0 + winN - 2;
  if (ny >= a && ny <= b) return ny;
  if (side === 'high' && b < ny && b <= limit && b >= a) return b;
  if (side === 'low' && a > ny && a >= limit && a <= b) return a;
  return ny;
}
function reaches(edge, bounds, box, band) {
  if (!Array.isArray(box) || box.length < 4) return false;
  if (edge === 'bottom') return box[3] > 0 && box[1] + 2 <= bounds.y + bounds.height - band - 1;
  if (edge === 'top') return box[3] > 0 && box[1] + box[3] - 2 >= bounds.y + band;
  if (edge === 'right') return box[2] > 0 && box[0] + 2 <= bounds.x + bounds.width - band - 1;
  if (edge === 'left') return box[2] > 0 && box[0] + box[2] - 2 >= bounds.x + band;
  return false;
}
function inDanger(x, y, bounds, edge, band) {
  if (!bounds || !(band > 0)) return false;
  if (edge === 'top') return y < bounds.y + band;
  if (edge === 'left') return x < bounds.x + band;
  if (edge === 'right') return x > bounds.x + bounds.width - band - 1;
  return y > bounds.y + bounds.height - band - 1;
}
// Khung chữ OCR mỏng nằm trong ô nhập thật (UIA) → dùng khung ô nhập, phần trên của ô còn nằm ngoài dải đáy.
function preferBox(box, el, elements) {
  if (el && !el.ocr && el.editable && Array.isArray(el.b) && el.b[3] > 0) return el.b;
  if (!Array.isArray(box) || box.length < 4) return box || null;
  const cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2; let best = null;
  for (const e of elements || []) {
    if (!e || e.ocr || !e.editable || !Array.isArray(e.b) || !(e.b[3] > box[3] + 4)) continue;
    const b = e.b;
    if (cx < b[0] - 8 || cx > b[0] + b[2] + 8 || cy < b[1] - 8 || cy > b[1] + b[3] + 8) continue;
    if (!best || b[3] > best[3]) best = b;
  }
  return best || box;
}
// Thanh tác vụ đo được có thuộc đúng màn hình này không. Không có khung đo được → chỉ màn gốc (0,0),
// để màn phụ không bị dải 3 % khi chưa đọc được vị trí thanh. Có khung thì chỉ màn chứa thanh đó.
function barOnMonitor(det, bounds, primaryH) {
  if (!bounds) return false;
  const k = dpiK(det, primaryH || (bounds.x === 0 && bounds.y === 0 ? bounds.height : 0));
  const rects = [det && det.tray, det && det.tray2, det && det.abmPos && det.abmPos.rect].map(r => scaleRect(r, k)).filter(r => r && r.r > r.l && r.b > r.t);
  if (rects.length) return rects.some(r => ownsBar(r, bounds));
  return bounds.x === 0 && bounds.y === 0;
}
// Quyết định điểm bấm. autoHide tắt → giữ nguyên (cửa sổ đã nằm trong khung làm việc, không cộng thêm lệch).
// Chỉ dời trên màn hình đang có thanh tác vụ (opt.owns, hoặc opt.det). Không truyền gì → coi là màn có thanh (tương thích B121).
// Có khung phần tử → điểm bấm luôn nằm trong khung. Khung trọn trong dải: giữ điểm trong khung, không kéo ra ngoài.
function place(x, y, bounds, box, opt = {}) {
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return { x, y, moved: false, why: 'no-screen', band: 0 };
  const edge = EDGES.includes(opt.edge) ? opt.edge : 'bottom';
  const vertical = edge === 'top' || edge === 'bottom';
  const span = vertical ? bounds.height : bounds.width;
  const heur = bandAlong(span);
  const thick = Number(opt.thick) || 0;
  const full = plausible(thick, span) ? thick + 2 : 0;
  const band = full && reaches(edge, bounds, box, full) ? Math.max(heur, full) : heur;
  if (!opt.autoHide) return { x, y, moved: false, why: 'shown', band };
  const owns = opt.owns != null ? !!opt.owns : (opt.det ? barOnMonitor(opt.det, bounds, opt.primaryH) : true);
  if (!owns) return { x, y, moved: false, why: 'no-bar', band };
  if (!inDanger(x, y, bounds, edge, band)) return { x, y, moved: false, why: 'outside', band };
  const win = opt.win; let nx = x, ny = y;
  if (edge === 'bottom') { const [a, n] = seg(box, 1, 3); const [wa, wn] = wseg(win, 1, 3); ny = safeHigh(y, bounds.y, bounds.height, a, n, wa, wn, band); }
  else if (edge === 'top') { const [a, n] = seg(box, 1, 3); const [wa, wn] = wseg(win, 1, 3); ny = safeLow(y, bounds.y, bounds.height, a, n, wa, wn, band); }
  else if (edge === 'right') { const [a, n] = seg(box, 0, 2); const [wa, wn] = wseg(win, 0, 2); nx = safeHigh(x, bounds.x, bounds.width, a, n, wa, wn, band); }
  else { const [a, n] = seg(box, 0, 2); const [wa, wn] = wseg(win, 0, 2); nx = safeLow(x, bounds.x, bounds.width, a, n, wa, wn, band); }
  if (Array.isArray(box) && box.length >= 4 && box[2] > 0 && box[3] > 0) { nx = insideSpan(nx, box[0], box[2]); ny = insideSpan(ny, box[1], box[3]); }
  const moved = nx !== x || ny !== y;
  const wholly = !reaches(edge, bounds, box, band);
  const inB = Array.isArray(box) && box.length >= 4 && box[2] > 0 && box[3] > 0 && nx >= box[0] && nx < box[0] + box[2] && ny >= box[1] && ny < box[1] + box[3];
  const why = inB ? 'in-box' : (!moved ? 'still' : 'out-of-strip');
  return { x: nx, y: ny, moved, why, wholly, band };
}
// điểm bấm an toàn theo dải ĐÁY 3 % (tương thích B115/B121). Khung nằm trọn trong dải → bấm trong khung (#27), không kéo ra ngoài khung.
function safeY(y, bounds, box, win) {
  if (!bounds || !(bounds.height > 0)) return y;
  const [a, n] = seg(box, 1, 3); const [wa, wn] = wseg(win, 1, 3);
  return safeHigh(y, bounds.y, bounds.height, a, n, wa, wn, bandOf(bounds));
}
// Cửa sổ trước là thanh tác vụ (Shell_TrayWnd / explorer không tiêu đề) — cú bấm vừa bị thanh tác vụ lấy mất.
function isTaskbarFg(fg) {
  if (!fg || typeof fg !== 'object') return false;
  const cls = String(fg.cls || fg.className || fg.class || '');
  if (/Shell_TrayWnd|Shell_SecondaryTrayWnd/i.test(cls)) return true;
  const proc = String(fg.proc || '').replace(/\.exe$/i, '').toLowerCase();
  const title = String(fg.title || '').trim();
  if (proc === 'explorer' && title === '') return true;
  return /^(taskbar|thanh tác vụ)$/i.test(title);
}
const _reset = () => { cache = null; };
module.exports = {
  detect, autoHide, describe, safeY, bandOf, parseState, PS, _reset,
  place, preferBox, thickFrom, edgeOf, inDanger, isTaskbarFg, workToPhys, workGap, workInsetShowsBar, decideAutoHide, dpiK, ownsBar, barOnMonitor, EDGE_VI, EDGES,
};
