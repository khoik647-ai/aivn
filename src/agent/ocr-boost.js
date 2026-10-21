'use strict';
// B56 (QA lượt 6): OCR thêm cho chữ sáng trên nền màu (nút chính “✉ Thư mới”, nút “Gửi” xanh): tìm khối màu cỡ nút, đảo màu + nhị phân hoá rồi đọc lại.
// img là nativeImage của Electron (truyền nativeImage vào để mô-đun không phụ thuộc Electron khi chạy kiểm thử Node).
// khối màu đậm/tối cỡ nút (≥ 30×14 px, ≤ 140 px cao) trên lưới 4 px — nơi có thể có chữ sáng
function coloredBlocks(img, max = 10) {
  const { width: w, height: h } = img.getSize(); const bm = img.toBitmap(); const G = 4; const gw = Math.ceil(w / G), gh = Math.ceil(h / G);
  const m = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) { const px = Math.min(w - 1, gx * G + 1), py = Math.min(h - 1, gy * G + 1); const i = (py * w + px) * 4; const b = bm[i], g = bm[i + 1], r = bm[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); m[gy * gw + gx] = (mx > 50 && (mx - mn) / mx > 0.4 && mx < 250 && (0.299 * r + 0.587 * g + 0.114 * b) < 170) || mx < 60 ? 1 : 0; }
  const seen = new Uint8Array(gw * gh); const out = [];
  for (let k = 0; k < m.length; k++) {
    if (!m[k] || seen[k]) continue; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0; const st = [k]; seen[k] = 1;
    while (st.length) { const c = st.pop(); const cx = c % gw, cy = (c / gw) | 0; n++; if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue; const q = ny * gw + nx; if (m[q] && !seen[q]) { seen[q] = 1; st.push(q); } } }
    const bw = (x1 - x0 + 1) * G, bh = (y1 - y0 + 1) * G; const fill = n / ((x1 - x0 + 1) * (y1 - y0 + 1));
    if (bw >= 30 && bh >= 14 && bh <= 140 && bw <= w * 0.9 && fill >= 0.45) out.push({ x: x0 * G + 4, y: y0 * G + 4, width: Math.min(w - x0 * G - 4, bw - 8), height: Math.min(h - y0 * G - 4, bh - 8), n }); // thu vào trong khối: bỏ viền/góc bo (OCR coi khung là hình)
  }
  return out.sort((a, b) => b.n - a.n).slice(0, max);
}
// đảo màu + nhị phân hoá theo ngưỡng giữa nền và chữ của chính khối, thêm viền trắng (OCR đọc kém khi chữ sát mép)
function invertForOcr(nativeImage, img, pad = 16) {
  const { width: w, height: h } = img.getSize(); const bm = img.toBitmap(); const Ls = new Float32Array(w * h); let lo = 255, hi = 0;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) { const L = 0.299 * bm[i + 2] + 0.587 * bm[i + 1] + 0.114 * bm[i]; Ls[p] = L; if (L < lo) lo = L; if (L > hi) hi = L; }
  const thr = (lo + hi) / 2; const W2 = w + pad * 2, H2 = h + pad * 2; const out = Buffer.alloc(W2 * H2 * 4, 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Ls[y * w + x] > thr ? 0 : 255; const o = ((y + pad) * W2 + x + pad) * 4; out[o] = out[o + 1] = out[o + 2] = v; }
  return nativeImage.createFromBitmap(out, { width: W2, height: H2 });
}
module.exports = { coloredBlocks, invertForOcr };
