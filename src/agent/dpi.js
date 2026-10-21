'use strict';
// 0.16 (T1a): toạ độ theo TỪNG màn hình, tự nhận tỉ lệ (100/125/150/175/200%), nhiều màn hình (kể cả toạ độ âm).
// Ba không gian toạ độ:
//   • DIP (điểm logic của Electron): bounds của screen.getAllDisplays()
//   • vật lý (physical): điểm ảnh thật — thứ SendInput/SetCursorPos (tiến trình per-monitor-v2), UIA và ảnh chụp dùng trên Windows;
//     X11 dùng điểm ảnh X (= DIP × tỉ lệ); macOS dùng điểm (= DIP)
//   • chuẩn hoá 0..1 của ẢNH CHỤP một màn hình (OCR, mô hình nhìn ảnh, toạ độ 0..1000 cho mô hình)
// Mô-đun thuần (không cần Electron) để kiểm thử được mọi tỉ lệ/bố cục màn hình.

const r = Math.round;
// một màn hình → { id, scale, primary, dip:{x,y,width,height}, phys:{x,y,width,height} }
function geoOf(d, { platform = process.platform, dipToScreenRect = null, primaryId = null } = {}) {
  const b = d.bounds || { x: 0, y: 0, width: (d.size || {}).width || 0, height: (d.size || {}).height || 0 };
  const s = Number(d.scaleFactor) || 1;
  let phys;
  if (platform === 'win32') {
    // Windows: gốc vật lý của màn hình phụ KHÔNG phải DIP × tỉ lệ (mỗi màn hình một tỉ lệ) → hỏi Electron nếu có
    let p = null; try { p = dipToScreenRect ? dipToScreenRect(b) : null; } catch {}
    phys = p && p.width > 0 ? { x: r(p.x), y: r(p.y), width: r(p.width), height: r(p.height) }
      : { x: r(b.x * s), y: r(b.y * s), width: r(b.width * s), height: r(b.height * s) };
    // kích thước vật lý: tin Electron (DIP đã làm tròn: 2560 px @150% = 1707 DIP → DIP × tỉ lệ = 2561, lệch 1 px); chỉ sửa khi Electron trả lệch nhiều
    if (!(p && Math.abs(phys.width - b.width * s) <= 3)) phys.width = r(b.width * s);
    if (!(p && Math.abs(phys.height - b.height * s) <= 3)) phys.height = r(b.height * s);
  } else if (platform === 'linux') phys = { x: r(b.x * s), y: r(b.y * s), width: r(b.width * s), height: r(b.height * s) };
  else phys = { x: b.x, y: b.y, width: b.width, height: b.height }; // macOS: điểm
  return { id: d.id, scale: s, primary: primaryId != null ? String(d.id) === String(primaryId) : (b.x === 0 && b.y === 0), dip: { x: b.x, y: b.y, width: b.width, height: b.height }, phys };
}
function geometry(displays, opts = {}) { return (displays || []).map(d => geoOf(d, opts)); }
const inside = (R, x, y) => x >= R.x && y >= R.y && x < R.x + R.width && y < R.y + R.height;
const overlap = (R, x, y, w, h) => Math.max(0, Math.min(R.x + R.width, x + w) - Math.max(R.x, x)) * Math.max(0, Math.min(R.y + R.height, y + h) - Math.max(R.y, y));
const primaryOf = (geos) => geos.find(g => g.primary) || geos[0] || null;
function displayAtPhys(geos, x, y) { return geos.find(g => inside(g.phys, x, y)) || primaryOf(geos); }
function displayAtDip(geos, x, y) { return geos.find(g => inside(g.dip, x, y)) || primaryOf(geos); }
// cửa sổ [x,y,w,h] (vật lý) → màn hình chứa phần lớn nhất của nó
function displayForRect(geos, b) {
  if (!Array.isArray(b) || !(b[2] > 0)) return primaryOf(geos);
  let best = null, bo = 0; for (const g of geos) { const o = overlap(g.phys, b[0], b[1], b[2], b[3]); if (o > bo) { bo = o; best = g; } }
  return best || primaryOf(geos);
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// chuẩn hoá 0..1 trên ẢNH CHỤP màn hình geo → toạ độ vật lý (chỗ chuột phải tới)
function normToPhys(geo, nx, ny) { const P = geo.phys; return { x: r(P.x + clamp01(nx) * (P.width - 1)), y: r(P.y + clamp01(ny) * (P.height - 1)) }; }
function physToNorm(geo, x, y) { const P = geo.phys; return { nx: (x - P.x) / Math.max(1, P.width - 1), ny: (y - P.y) / Math.max(1, P.height - 1) }; }
// điểm ảnh của ảnh chụp (ảnh có thể đã thu nhỏ, vd. 2560 → 1920) → vật lý
function shotToPhys(shot, sx, sy) { return normToPhys(shot.geo, sx / Math.max(1, shot.width - 1), sy / Math.max(1, shot.height - 1)); }
function physToDip(geos, x, y) { const g = displayAtPhys(geos, x, y); return { x: g.dip.x + (x - g.phys.x) / g.scale, y: g.dip.y + (y - g.phys.y) / g.scale }; }
function dipToPhys(geos, x, y) { const g = displayAtDip(geos, x, y); return { x: r(g.phys.x + (x - g.dip.x) * g.scale), y: r(g.phys.y + (y - g.dip.y) * g.scale) }; }

// Hiệu chỉnh theo thực tế: đã bảo bộ điều khiển chuột tới `sent` mà con trỏ nằm ở `actual` (vật lý).
// Lệch kiểu tỉ lệ (luồng gửi chuột không nhận DPI: Windows tự nhân/chia 1,25…) → actual ≈ sent × k quanh gốc màn hình chính.
function calibrate(sent, actual) {
  const k = (a, s) => (Math.abs(s) >= 40 ? a / s : null);
  const kx = k(actual.x, sent.x), ky = k(actual.y, sent.y);
  const ok = (v) => v != null && v > 0.3 && v < 3.5;
  if (!ok(kx) && !ok(ky)) return null;
  return { kx: ok(kx) ? kx : (ok(ky) ? ky : 1), ky: ok(ky) ? ky : (ok(kx) ? kx : 1) };
}
function applyCal(cal, p) { return cal ? { x: r(p.x / cal.kx), y: r(p.y / cal.ky) } : { x: r(p.x), y: r(p.y) }; }
const near = (a, b, tol = 3) => !!a && !!b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
const pct = (s) => `${r(s * 100)}%`;
function describe(geos) {
  return geos.map(g => `${g.primary ? 'chính' : 'phụ'} ${g.phys.width}×${g.phys.height} @${pct(g.scale)} (logic ${g.dip.width}×${g.dip.height} tại ${g.dip.x},${g.dip.y}; vật lý tại ${g.phys.x},${g.phys.y})`).join(' | ');
}
// Giả lập Electron.screen cho kiểm thử: danh sách màn hình kiểu Windows (toạ độ DIP của màn hình phụ suy từ vật lý)
function fakeWinDisplays(spec) {
  // spec: [{ phys:[x,y,w,h], scale }] → displays như Electron trả về + dipToScreenRect tương ứng
  const ds = spec.map((m, i) => { const [px, py, pw, ph] = m.phys; const s = m.scale; return { id: i + 1, scaleFactor: s, bounds: { x: r(px / (px === 0 ? 1 : s)), y: r(py / (py === 0 ? 1 : s)), width: r(pw / s), height: r(ph / s) }, _phys: { x: px, y: py, width: pw, height: ph } }; });
  const dipToScreenRect = (b) => { const d = ds.find(x => x.bounds.x === b.x && x.bounds.y === b.y) || ds[0]; return { ...d._phys }; };
  return { displays: ds, dipToScreenRect };
}
// B62 (máy thật 2560×1440 @125%): một dòng nhật ký cho MỖI cú bấm — QA đọc trong %APPDATA%\AIVN\logs\aivn.log
// el: phần tử đích (id, b = khung theo px vật lý), shot: ảnh chụp ({width,height,full,geo}), pt: điểm vật lý sẽ bấm,
// api: cách đưa chuột ('libnut moveMouse' | 'SetCursorPos'), got: vị trí con trỏ đọc lại, fg0/fg1: cửa sổ ở trước trước/sau khi bấm
function clickDiag({ el = null, query = '', shot = null, pt, geos = [], api = 'libnut', cal = null, got = null, fg0 = null, fg1 = null, under = null, overlayIgnore = null, phase = 'trước' } = {}) {
  const g = (shot && shot.geo) || displayAtPhys(geos, pt.x, pt.y) || primaryOf(geos);
  const out = [`Bấm (${phase})`, el ? `đích ${el.id || '?'} “${String(el.name || '').slice(0, 40)}”${el.ocr ? ' [OCR]' : ''}` : query ? `đích “${String(query).slice(0, 40)}”` : 'đích toạ độ'];
  if (el && Array.isArray(el.b) && g && shot && shot.width) {
    const n1 = physToNorm(g, el.b[0], el.b[1]), n2 = physToNorm(g, el.b[0] + el.b[2], el.b[1] + el.b[3]);
    const sx = (v) => r(v * (shot.width - 1)), sy = (v) => r(v * (shot.height - 1));
    out.push(`khung ảnh chụp [${sx(n1.nx)},${sy(n1.ny)},${sx(n2.nx) - sx(n1.nx)},${sy(n2.ny) - sy(n1.ny)}] px trên ảnh ${shot.width}×${shot.height}${shot.full ? ` (gốc ${shot.full.width}×${shot.full.height})` : ''}`);
    out.push(`khung vật lý [${el.b.map(r).join(',')}]`);
  }
  if (pt && g) { const d = { x: g.dip.x + (pt.x - g.phys.x) / g.scale, y: g.dip.y + (pt.y - g.phys.y) / g.scale }; out.push(`điểm vật lý (${r(pt.x)},${r(pt.y)}) = logic (${r(d.x)},${r(d.y)})`); }
  if (g) out.push(`tỉ lệ ${pct(g.scale)} · màn hình vật lý ${g.phys.x},${g.phys.y} ${g.phys.width}×${g.phys.height} / logic ${g.dip.x},${g.dip.y} ${g.dip.width}×${g.dip.height}`);
  out.push(`API ${api}${cal ? ` ×${cal.kx.toFixed(3)}/×${cal.ky.toFixed(3)}` : ''} + libnut mouseClick`);
  if (got) out.push(`con trỏ đọc lại (${got.x},${got.y})`);
  if (under) out.push(`cửa sổ dưới điểm bấm: “${String(under.title || '').slice(0, 50)}” pid ${under.pid ?? '?'}${under.pid === process.pid ? ' (CHÍNH AIVN!)' : ''}`);
  if (overlayIgnore != null) out.push(`lớp phủ ${overlayIgnore ? 'xuyên chuột' : 'ĐANG NHẬN CHUỘT'}`);
  const w = (f) => f ? `“${String(f.title || '').slice(0, 50)}” pid ${f.pid ?? '?'}` : '?';
  if (fg0 !== null || fg1 !== null) out.push(`cửa sổ trước: ${w(fg0)}${phase === 'sau' ? ` → sau: ${w(fg1)}` : ''}`);
  return out.join(' · ');
}
module.exports = { clickDiag, geoOf, geometry, displayAtPhys, displayAtDip, displayForRect, normToPhys, physToNorm, shotToPhys, physToDip, dipToPhys, calibrate, applyCal, near, describe, fakeWinDisplays, primaryOf };
