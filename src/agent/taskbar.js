'use strict';
// B115 (máy thật beta.2.5): thanh tác vụ Windows TỰ ẨN bật lên khi chuột chạm đáy màn hình (AIVN bấm ô soạn ở y≈1408/1440) và che hàng ô soạn tin
// → phép kiểm B104 đọc nhầm “ô soạn trống”. Phát hiện chế độ tự ẩn bằng SHAppBarMessage(ABM_GETSTATE); khi tự ẩn: không bấm trong ~2% đáy màn hình
// (dời điểm bấm lên trong phạm vi phần tử) và trước khi đọc lại ô soạn thì đưa chuột ra xa đáy, chờ thanh tác vụ ẩn.
const ABS_AUTOHIDE = 0x1;
const PS = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class AivnAppBar {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
  [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
  public static uint State() { var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d); return (uint)SHAppBarMessage(4, ref d); }
}
"@
[Console]::Out.Write([AivnAppBar]::State())`;
let cache = null;
function parseState(out) { const n = parseInt(String(out || '').trim(), 10); return Number.isFinite(n) ? { state: n, autoHide: !!(n & ABS_AUTOHIDE) } : null; }
// chỉ Windows; lỗi/khác hệ điều hành → false. Lưu 2 phút (người dùng hiếm khi đổi giữa chừng)
function autoHide({ platform = process.platform, run = null, now = Date.now() } = {}) {
  if (platform !== 'win32' && !run) return Promise.resolve(false);
  if (cache && now - cache.at < 120000) return cache.p;
  const exec = run || (() => new Promise((resolve) => {
    const enc = Buffer.from(PS, 'utf16le').toString('base64');
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { timeout: 15000, windowsHide: true }, (e, out) => resolve(e ? '' : out));
  }));
  const p = new Promise((r) => r(exec(PS))).then(o => { const r = parseState(o); return !!(r && r.autoHide); }).catch(() => false);
  cache = { at: now, p }; return p;
}
// điểm bấm an toàn: không nằm trong dải đáy (≈3% chiều cao, tối thiểu 6 px) của màn hình chứa điểm; giữ trong phần tử nếu biết khung [x,y,w,h]
function safeY(y, bounds, box) {
  if (!bounds || !(bounds.height > 0)) return y;
  // “khoảng 2%”: lấy 3% cho chắc (QA: bấm ở y≈1408/1440 vẫn làm thanh tác vụ bật lên)
  const band = Math.max(6, Math.round(bounds.height * 0.03)); const limit = bounds.y + bounds.height - band - 1;
  if (y <= limit) return y;
  if (Array.isArray(box) && box.length >= 4) { if (box[1] + 2 <= limit) return Math.max(box[1] + 2, Math.min(limit, box[1] + box[3] - 2)); return y; } // phần tử nằm trọn trong dải đáy: không dời được
  return limit;
}
const _reset = () => { cache = null; };
module.exports = { autoHide, safeY, parseState, PS, _reset };
