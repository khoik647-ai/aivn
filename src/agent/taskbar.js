'use strict';
// B115/B121 (máy thật beta.2.5/2.6): thanh tác vụ Windows TỰ ẨN bật lên khi chuột chạm đáy màn hình và che hàng ô soạn tin.
// Phát hiện: SHAppBarMessage(ABM_GETSTATE) & ABS_AUTOHIDE; không đọc được thì dùng byte 8 của
// HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3\Settings (3 = tự ẩn, 2 = không). Quyết định LUÔN được ghi nhật ký.
// Toạ độ: điểm bấm và khung màn hình đều là ĐIỂM ẢNH VẬT LÝ (beta.2.6 so toạ độ vật lý với khung DIP của Electron ở 125 % → không bao giờ dời).
const ABS_AUTOHIDE = 0x1;
const PS = `$ErrorActionPreference='Continue'
$abm = -1; $err = ''
try {
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class AivnAppBar2 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
  [DllImport("shell32.dll")] public static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
  public static long State() { var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA)); return SHAppBarMessage(4, ref d).ToInt64(); }
}
"@
$abm = [AivnAppBar2]::State()
} catch { $err = $_.Exception.Message }
$stuck = -1
try { $v = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects3' -Name Settings -ErrorAction Stop).Settings; if ($v.Length -gt 8) { $stuck = [int]$v[8] } } catch { if (-not $err) { $err = $_.Exception.Message } }
[Console]::Out.Write("ABM=$abm;STUCK=$stuck;ERR=" + ($err -replace '[\\r\\n;]', ' '))`;
let cache = null;
// đọc kết quả PowerShell: ABM=<số>;STUCK=<byte>;ERR=<chữ>. Cũ: chỉ một số (trạng thái ABM)
function parseState(out) {
  const t = String(out || '').trim(); if (!t) return null;
  if (/^\d+$/.test(t)) { const n = Number(t); return { abm: n, stuck: -1, autoHide: !!(n & ABS_AUTOHIDE), via: 'ABM_GETSTATE', state: n }; }
  const g = (k) => { const m = new RegExp(k + '=([^;]*)').exec(t); return m ? m[1].trim() : ''; };
  const abm = /^-?\d+$/.test(g('ABM')) ? Number(g('ABM')) : -1; const stuck = /^-?\d+$/.test(g('STUCK')) ? Number(g('STUCK')) : -1;
  if (abm >= 0) { const a = !!(abm & ABS_AUTOHIDE); const st = stuck === 3; return { abm, stuck, autoHide: a || st, via: a ? 'ABM_GETSTATE' : st ? 'StuckRects3 (ABM_GETSTATE báo không)' : 'ABM_GETSTATE', err: g('ERR') || '' }; }
  if (stuck >= 0) return { abm, stuck, autoHide: stuck === 3, via: 'StuckRects3', err: g('ERR') || '' };
  return { abm, stuck, autoHide: false, via: 'không đọc được', err: g('ERR') || '' };
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
const describe = (d) => `thanh tác vụ tự ẩn: ${d.autoHide ? 'CÓ' : 'KHÔNG'} (theo ${d.via}; ABM_GETSTATE=${d.abm}, StuckRects3=${d.stuck}${d.err ? `, lỗi: ${String(d.err).slice(0, 80)}` : ''})`;
// dải đáy (vật lý): ≈3 % chiều cao màn hình, tối thiểu 6 px
function bandOf(bounds) { return Math.max(6, Math.round(bounds.height * 0.03)); }
// điểm bấm an toàn trong khung phần tử [x,y,w,h] (vật lý): nếu điểm nằm trong dải đáy → bấm CAO HƠN trong chính khung phần tử
// (ở phía trên dải nếu được; phần tử nằm trọn trong dải → dòng trên cùng của phần tử)
function safeY(y, bounds, box) {
  if (!bounds || !(bounds.height > 0)) return y;
  const limit = bounds.y + bounds.height - bandOf(bounds) - 1;
  if (y <= limit) return y;
  if (Array.isArray(box) && box.length >= 4 && box[3] > 0) {
    const top = box[1] + Math.min(3, Math.max(1, Math.floor(box[3] / 4)));
    if (box[1] + 2 <= limit) return Math.max(box[1] + 2, Math.min(limit, box[1] + box[3] - 2));
    return Math.min(y, top); // trọn trong dải: dòng trên cùng của phần tử (xa đáy nhất có thể)
  }
  return limit;
}
const _reset = () => { cache = null; };
module.exports = { detect, autoHide, describe, safeY, bandOf, parseState, PS, _reset };
