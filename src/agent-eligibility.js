'use strict';
// AIVN AGENT chỉ chạy với mô hình làm được việc thật trên máy:
//   (1) nhìn được màn hình (có tệp thị giác), (2) gọi công cụ ổn định — AIVN đã tự kiểm chứng (docs/verified.md),
//   (3) định vị được nút trên màn hình — điểm định vị ≥ 6/10 trên máy thử của AIVN hoặc đã kiểm chứng, (4) vừa máy (chạy tốt).
// Trò chuyện thường thì nạp mô hình nào cũng được; quy tắc này chỉ áp cho AIVN AGENT.
const MIN_GROUND = 6;
const REASONS = {
  text: 'Chỉ đọc chữ, không nhìn được màn hình',
  tools: 'Không gọi công cụ ổn định',
  ground: 'Không định vị được nút trên màn hình',
  heavy: 'Quá nặng cho máy',
  unknown: 'Chưa được AIVN kiểm chứng cho AIVN AGENT',
};
// m: { vision, catalog: mục Kho (có claims) | null, fit: { level } | null }; shipped/local: điểm đo { grounding: {score,total} }
function eligibility(m, { shipped = null, local = null } = {}) {
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
  if (m.fit && m.fit.level !== 'fit') return { ok: false, code: 'heavy', reason: REASONS.heavy + (m.fit.hint ? ` (${m.fit.hint.toLowerCase()})` : '') };
  return { ok: true, code: 'ok', reason: g ? `Nhìn màn hình, gọi công cụ đã kiểm chứng, điểm định vị ${g.score}/10` : 'Nhìn màn hình, gọi công cụ và định vị đã kiểm chứng' };
}
// mô hình tốt nhất cho AIVN AGENT trong danh sách (đã cài trước, rồi điểm định vị cao, rồi nhỏ)
function bestFor(list, scores = {}) {
  const sc = (m) => { const c = m.catalog; const id = c && c.id; const s = (scores.shipped || {})[id]; const l = (scores.local || {})[m.id] || (scores.local || {})[id]; const g = (l && l.grounding) || (s && s.grounding); return g ? g.score : 7; };
  return list.map(m => ({ m, e: eligibility(m, { shipped: m.catalog && (scores.shipped || {})[m.catalog.id], local: (scores.local || {})[m.id] }) })).filter(x => x.e.ok)
    .sort((a, b) => (!!b.m.installed - !!a.m.installed) || (sc(b.m) - sc(a.m)) || ((a.m.size || 0) - (b.m.size || 0))).map(x => x.m)[0] || null;
}
module.exports = { eligibility, bestFor, REASONS, MIN_GROUND };
