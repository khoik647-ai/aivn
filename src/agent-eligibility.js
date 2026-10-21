'use strict';
// AIVN AGENT chỉ chạy với mô hình làm được việc thật trên máy:
//   (1) nhìn được màn hình (có tệp thị giác), (2) gọi công cụ ổn định — AIVN đã tự kiểm chứng (docs/verified.md),
//   (3) định vị được nút trên màn hình — điểm định vị ≥ 6/10 trên máy thử của AIVN hoặc đã kiểm chứng, (4) vừa máy (chạy tốt).
// Trò chuyện thường thì nạp mô hình nào cũng được; quy tắc này chỉ áp cho AIVN AGENT.
const MIN_GROUND = 6;
const MIN_SLOW_TPS = 5; // dưới mức này mỗi bước điều khiển máy mất quá lâu (trên 30 giây) — không cho dùng
const nf = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
const slowReason = (f) => `Chạy chậm trên máy này (~${nf(f.tps)} token/giây${f.ram ? `, tràn ${nf(f.ram / 1024 ** 3)} GB sang RAM` : ''}): AIVN AGENT vẫn làm được nhưng mỗi bước có thể mất 10–30 giây.`;
const REASONS = {
  text: 'Chỉ đọc chữ, không nhìn được màn hình',
  tools: 'Không gọi công cụ ổn định',
  ground: 'Không định vị được nút trên màn hình',
  heavy: 'Quá nặng cho máy',
  unknown: 'Chưa được AIVN kiểm chứng cho AIVN AGENT',
};
// m: { vision, catalog: mục Kho (có claims) | null, fit: { level } | null }; shipped/local: điểm đo { grounding: {score,total} }
function eligibility(m, { shipped = null, local = null, allowSlow = false, maxSpill = Infinity } = {}) {
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
    if (allowSlow && m.fit.level === 'slow' && (m.fit.tps || 0) >= MIN_SLOW_TPS && (m.fit.ram || 0) <= maxSpill) return { ok: true, code: 'slow', slow: true, reason: slowReason(m.fit), score: g ? g.score : null };
    return { ok: false, code: 'heavy', reason: REASONS.heavy + (m.fit.hint ? ` (${m.fit.hint.charAt(0).toLowerCase() + m.fit.hint.slice(1)})` : '') };
  }
  return { ok: true, code: 'ok', reason: g ? `Nhìn màn hình, gọi công cụ đã kiểm chứng, điểm định vị ${g.score}/10` : 'Nhìn màn hình, gọi công cụ và định vị đã kiểm chứng' };
}
// mô hình tốt nhất cho AIVN AGENT trong danh sách (độ vừa máy tính theo ngữ cảnh của AIVN AGENT: agentFit nếu có) (đã cài trước, rồi điểm định vị cao, rồi nhỏ)
function bestFor(list, scores = {}, { allowSlow = false, maxSpill = Infinity } = {}) {
  const sc = (m) => { const c = m.catalog; const id = c && c.id; const s = (scores.shipped || {})[id]; const l = (scores.local || {})[m.id] || (scores.local || {})[id]; const g = (l && l.grounding) || (s && s.grounding); return g ? g.score : 7; };
  const fitOf = (m) => m.agentFit || m.fit || null;
  // mô hình chạy chậm: điểm định vị nhân hệ số tốc độ (dưới 20 token/giây bị trừ) — tránh chọn mô hình mạnh nhưng mỗi bước mất cả phút
  const val = (m) => { const f = fitOf(m); const slow = f && f.level === 'slow'; return sc(m) * (slow ? Math.min(1, (f.tps || 0) / 20) : 1); };
  return list.map(m => ({ m, e: eligibility({ ...m, fit: fitOf(m) }, { shipped: m.catalog && (scores.shipped || {})[m.catalog.id], local: (scores.local || {})[m.id], allowSlow, maxSpill }) })).filter(x => x.e.ok)
    .sort((a, b) => (!!b.e.slow === !!a.e.slow ? 0 : a.e.slow ? 1 : -1) || (!!b.m.installed - !!a.m.installed) || (val(b.m) - val(a.m)) || ((a.m.size || 0) - (b.m.size || 0))).map(x => x.m)[0] || null;
}
// có mô hình nào dùng được cho AIVN AGENT mà chạy MƯỢT trên máy này không (xét cả Khám phá) — không có thì cho phép "Chạy chậm"
function needSlowAllowance(entries, scores = {}) {
  return !entries.some(m => eligibility({ ...m, fit: m.agentFit || m.fit }, { shipped: m.catalog && (scores.shipped || {})[m.catalog.id], local: (scores.local || {})[m.id] }).ok);
}
module.exports = { eligibility, bestFor, needSlowAllowance, slowReason, REASONS, MIN_GROUND, MIN_SLOW_TPS };
