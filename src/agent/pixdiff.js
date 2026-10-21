'use strict';
// T1a: “bấm có tác dụng không?” — so ảnh chụp TRƯỚC và SAU thao tác (ứng dụng Electron/CEF như Zalo: tiêu đề cửa sổ không đổi,
// Trợ năng không báo gì, OCR đếm số dòng gần như bằng nhau khi mở cuộc trò chuyện khác → bộ kiểm tra cũ luôn nói “không thay đổi”).
// a, b: ảnh BGRA/RGBA cùng kích thước w×h. region: vùng quanh chỗ bấm (chuẩn hoá 0..1). Trả tỉ lệ điểm ảnh đổi rõ (0..1).
// scope: chỉ tính “toàn bộ” trong cửa sổ đích (đồng hồ, cửa sổ khác đổi không tính)
function diffBitmaps(a, b, w, h, region = null, thr = 32, scope = null) {
  if (!a || !b || a.length !== b.length || a.length < w * h * 4) return null;
  let all = 0, ch = 0, rAll = 0, rCh = 0;
  const R = region ? { x1: Math.max(0, Math.floor(region.x1 * w)), y1: Math.max(0, Math.floor(region.y1 * h)), x2: Math.min(w, Math.ceil(region.x2 * w)), y2: Math.min(h, Math.ceil(region.y2 * h)) } : null;
  const Sc = scope ? { x1: Math.max(0, Math.floor(scope.x1 * w)), y1: Math.max(0, Math.floor(scope.y1 * h)), x2: Math.min(w, Math.ceil(scope.x2 * w)), y2: Math.min(h, Math.ceil(scope.y2 * h)) } : { x1: 0, y1: 0, x2: w, y2: h };
  for (let y = Sc.y1; y < Sc.y2; y++) for (let x = Sc.x1; x < Sc.x2; x++) {
    const i = (y * w + x) * 4;
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    all++; const c = d > thr; if (c) ch++;
    if (R && x >= R.x1 && x < R.x2 && y >= R.y1 && y < R.y2) { rAll++; if (c) rCh++; }
  }
  return { global: all ? ch / all : 0, region: R && rAll ? rCh / rAll : null };
}
// vùng quanh điểm bấm (chuẩn hoá), mở rộng ±pad
function around(box, pad = 0.06) {
  if (!box) return null;
  return { x1: Math.max(0, box.x1 - pad), y1: Math.max(0, box.y1 - pad), x2: Math.min(1, box.x2 + pad), y2: Math.min(1, box.y2 + pad) };
}
// có tác dụng nhìn thấy được? (con trỏ nhấp nháy/đồng hồ chỉ đổi vài điểm ảnh: dưới ngưỡng)
function changed(d) { if (!d) return null; return d.global >= 0.02 || (d.region != null && d.region >= 0.015); } // viền tiêu điểm của ô khác (≈1%) không tính
const pct = (v) => v == null ? '?' : (v >= 0.1 ? Math.round(v * 100) : Math.round(v * 1000) / 10) + '%';
// vùng quanh chỗ bấm không đo được (chỗ bấm ngoài ảnh chụp) → nói rõ, không in “?” (QA máy thật tưởng là lỗi mã hoá UTF-8)
function describe(d) { return d ? `${d.region == null ? 'không đo được vùng' : pct(d.region)} quanh chỗ bấm, ${d.global == null ? 'không đo được' : pct(d.global)} cả cửa sổ` : ''; }
module.exports = { diffBitmaps, around, changed, describe };
