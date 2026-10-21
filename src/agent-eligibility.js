'use strict';
// AIVN AGENT chỉ chạy với mô hình làm được việc thật trên máy:
//   (1) nhìn được màn hình (có tệp thị giác), (2) gọi công cụ ổn định — AIVN đã tự kiểm chứng (docs/verified.md),
//   (3) định vị được nút trên màn hình — điểm định vị ≥ 6/10 trên máy thử của AIVN hoặc đã kiểm chứng, (4) vừa máy (chạy tốt).
// Trò chuyện thường thì nạp mô hình nào cũng được; quy tắc này chỉ áp cho AIVN AGENT.
const MIN_GROUND = 6;
const MIN_SLOW_TPS = 5;
const MIN_VERYSLOW_TPS = 1.5; // “Rất chậm” (tuỳ chọn bật tay, máy yếu): dưới mức này một bước mất vài phút — không cho
const VERYSLOW_SCALE = 3;  // thời gian chờ mỗi bước của AIVN AGENT nhân lên khi dùng mô hình “Rất chậm” // dưới mức này mỗi bước điều khiển máy mất quá lâu (trên 30 giây) — không cho dùng
const nf = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
const slowReason = (f) => `Chạy chậm trên máy này (~${nf(f.tps)} token/giây${f.ram ? `, tràn ${nf(f.ram / 1024 ** 3)} GB sang RAM` : ''}): AIVN AGENT vẫn làm được nhưng mỗi bước có thể mất 10–30 giây.`;
const verySlowReason = (f) => `Rất chậm trên máy này (~${nf(f.tps)} token/giây${f.ram ? `, tràn ${nf(f.ram / 1024 ** 3)} GB sang RAM` : ''}) — bạn đã tự bật. Mỗi bước có thể mất 1–3 phút, máy nóng và ồn hơn, các ứng dụng khác chậm lại; AIVN AGENT chờ lâu gấp ${VERYSLOW_SCALE} lần trước khi báo hết giờ. Không phải lựa chọn gợi ý.`;
const verySlowOff = (f) => `Rất chậm trên máy này (~${nf(f.tps)} token/giây${f.ram ? `, tràn ${nf(f.ram / 1024 ** 3)} GB sang RAM` : ''}) — muốn thử thì bật “Cho dùng mô hình Rất chậm” trong Cài đặt › AIVN AGENT`;
// kết quả bộ đo AIVN AGENT đầy đủ trên máy này (Nhà phát triển → Bộ đo): chưa đạt → xếp sau mô hình khác (thang dự phòng laptop: 2B → 4B “Chạy chậm”)
const benchFailed = (local) => !!(local && local.full && local.full.complete && local.full.agentOk === false);
const REASONS = {
  text: 'Chỉ đọc chữ, không nhìn được màn hình',
  tools: 'Không gọi công cụ ổn định',
  ground: 'Không định vị được nút trên màn hình',
  heavy: 'Quá nặng cho máy',
  unknown: 'Chưa được AIVN kiểm chứng cho AIVN AGENT',
};
// m: { vision, catalog: mục Kho (có claims) | null, fit: { level } | null }; shipped/local: điểm đo { grounding: {score,total} }
function eligibility(m, { shipped = null, local = null, allowSlow = false, maxSpill = Infinity, offerVerySlow = false, allowVerySlow = false } = {}) {
  if (!m) return { ok: false, code: 'none', reason: 'Chưa chọn mô hình' };
  if (!m.vision) return { ok: false, code: 'text', reason: REASONS.text };
  const c = m.catalog; const claims = (c && c.claims) || [];
  if (!c) return { ok: false, code: 'unknown', reason: REASONS.unknown };
  const tools = claims.filter(x => x.t === 'tools');
  if (!tools.some(x => x.k === 'v') || tools.some(x => x.k === 'x')) return { ok: false, code: 'tools', reason: REASONS.tools };
  const g = (local && local.grounding && local.grounding.total === 10 ? local.grounding : null) || (shipped && shipped.grounding) || null;
  if (claims.some(x => x.t === 'gui' && x.k === 'x')) return { ok: false, code: 'ground', reason: REASONS.ground };
  if (g && g.score < MIN_GROUND) return { ok: false, code: 'ground', reason: `${REASONS.ground} (điểm định vị ${g.score}/10)` };
  if (!g && !claims.some(x => x.t === 'gui' && x.k === 'v')) return { ok: false, code: 'ground', reason: REASONS.ground + ' (chưa đo)' };
  if (m.fit && m.fit.level !== 'fit') {
    // 0.16: máy yếu (vd. laptop GPU 4 GB) không có mô hình nào chạy mượt cho AIVN AGENT → vẫn cho dùng mô hình "Chạy chậm"
    // (một phần trên GPU, phần còn lại trên CPU/RAM) nếu đủ nhanh, kèm cảnh báo — thay vì chặn hẳn. "Không chạy được" vẫn chặn.
    if (allowSlow && m.fit.level === 'slow' && (m.fit.tps || 0) >= MIN_SLOW_TPS && (m.fit.ram || 0) <= maxSpill) return { ok: true, code: 'slow', slow: true, reason: slowReason(m.fit), score: g ? g.score : null, benchFail: benchFailed(local) };
    // 0.16 beta.2 (Khôi duyệt): laptop GPU 4 GB, cả 2B và 4B chưa đạt bộ đo → cho dùng 8B tràn RAM, CHỈ khi người dùng tự bật,
    // nhãn “Rất chậm”, cảnh báo thật, thời gian chờ mỗi bước ×3; không bao giờ là ⭐ gợi ý / mô hình tự chọn (xem bestFor)
    if (offerVerySlow && m.fit.level === 'slow' && (m.fit.tps || 0) >= MIN_VERYSLOW_TPS) {
      if (allowVerySlow) return { ok: true, code: 'veryslow', slow: true, verySlow: true, stepScale: VERYSLOW_SCALE, reason: verySlowReason(m.fit), score: g ? g.score : null, benchFail: benchFailed(local) };
      return { ok: false, code: 'veryslow-off', reason: verySlowOff(m.fit) };
    }
    return { ok: false, code: 'heavy', reason: REASONS.heavy + (m.fit.hint ? ` (${m.fit.hint.charAt(0).toLowerCase() + m.fit.hint.slice(1)})` : '') };
  }
  return { ok: true, code: 'ok', benchFail: benchFailed(local), reason: (benchFailed(local) ? 'Chưa đạt bộ đo AIVN AGENT trên máy này — AIVN ưu tiên mô hình khác. ' : '') + (g ? `Nhìn màn hình, gọi công cụ đã kiểm chứng, điểm định vị ${g.score}/10` : 'Nhìn màn hình, gọi công cụ và định vị đã kiểm chứng') };
}
// mô hình tốt nhất cho AIVN AGENT trong danh sách (độ vừa máy tính theo ngữ cảnh của AIVN AGENT: agentFit nếu có) (đã cài trước, rồi điểm định vị cao, rồi nhỏ)
function bestFor(list, scores = {}, { allowSlow = false, maxSpill = Infinity, offerVerySlow = false, allowVerySlow = false } = {}) {
  const sc = (m) => { const c = m.catalog; const id = c && c.id; const s = (scores.shipped || {})[id]; const l = (scores.local || {})[m.id] || (scores.local || {})[id]; const g = (l && l.grounding) || (s && s.grounding); return g ? g.score : 7; };
  const fitOf = (m) => m.agentFit || m.fit || null;
  // mô hình chạy chậm: điểm định vị nhân hệ số tốc độ (dưới 20 token/giây bị trừ) — tránh chọn mô hình mạnh nhưng mỗi bước mất cả phút
  const val = (m) => { const f = fitOf(m); const slow = f && f.level === 'slow'; return sc(m) * (slow ? Math.min(1, (f.tps || 0) / 20) : 1); };
  return list.map(m => ({ m, e: eligibility({ ...m, fit: fitOf(m) }, { shipped: m.catalog && (scores.shipped || {})[m.catalog.id], local: (scores.local || {})[m.id], allowSlow, maxSpill, offerVerySlow, allowVerySlow }) })).filter(x => x.e.ok && !x.e.verySlow) // “Rất chậm” không bao giờ được tự chọn
    .sort((a, b) => (!!a.e.benchFail - !!b.e.benchFail) || (!!b.e.slow === !!a.e.slow ? 0 : a.e.slow ? 1 : -1)
      // 0.16 beta.2 (máy thật 12 GB chọn 2B vì đã cài sẵn): chạy mượt thì chọn mô hình MẠNH NHẤT (lớn nhất) trước, đã cài chỉ để phân định khi ngang nhau
      || (a.e.slow ? (val(b.m) - val(a.m)) : ((b.m.size || 0) - (a.m.size || 0)))
      || (!!b.m.installed - !!a.m.installed) || (val(b.m) - val(a.m))).map(x => x.m)[0] || null;
}
// có mô hình nào dùng được cho AIVN AGENT mà chạy MƯỢT trên máy này không (xét cả Khám phá) — không có thì cho phép "Chạy chậm"
function needSlowAllowance(entries, scores = {}) {
  return !entries.some(m => eligibility({ ...m, fit: m.agentFit || m.fit }, { shipped: m.catalog && (scores.shipped || {})[m.catalog.id], local: (scores.local || {})[m.id] }).ok);
}
module.exports = { eligibility, bestFor, needSlowAllowance, slowReason, verySlowReason, benchFailed, REASONS, MIN_GROUND, MIN_SLOW_TPS, MIN_VERYSLOW_TPS, VERYSLOW_SCALE };
