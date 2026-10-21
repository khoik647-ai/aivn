'use strict';
// B17 (QA lượt 2): MỘT cách tính duy nhất cho “mô hình AIVN AGENT nào chạy được trên máy này”, dùng chung cho
// gợi ý ⭐ trong Khám phá, nhãn/nhóm của thẻ, bộ chọn mô hình, cổng AIVN AGENT và việc theo lịch.
//
// Quyết định cho máy yếu (laptop GPU 4 GB):
//   1) Ngữ cảnh AIVN AGENT mặc định 16K. Nếu KHÔNG có mô hình AIVN AGENT nào nằm trọn VRAM ở 16K, AIVN dùng 12K cho
//      AIVN AGENT (lịch sử + ảnh được tự thu gọn — compact.js — nên 12K đủ cho việc nhiều bước). Vd. RTX 3050 Ti 4 GB:
//      Qwen3-VL 2B Q8_0 tràn 0,1 GB ở 16K nhưng nằm trọn VRAM ở 12K (~67 token/giây) → “Chạy mượt”, gợi ý ⭐.
//   2) Khi đã phải hạ xuống 12K (máy yếu), mô hình tràn ÍT (≤ 1 GB sang RAM, ≥ 5 token/giây) vẫn chọn được, nhóm “Chạy chậm”
//      kèm cảnh báo (vd. Qwen3-VL 4B tràn 0,7 GB, định vị tốt hơn). Không có mô hình nào chạy mượt kể cả ở 12K → cho mọi mô hình
//      “Chạy chậm” đủ nhanh (≥ 5 token/giây).
//   3) Máy đủ mạnh (có mô hình chạy mượt ở 16K): chỉ nhận mô hình chạy mượt (quy tắc gốc).
const AE = require('./agent-eligibility');
const CTX_FULL = 16384, CTX_LOW = 12288;
const GiB = 1024 ** 3;
const SMALL_SPILL = 1 * GiB;

// entries: [{ id, vision, catalog, size, mmprojSize?, params? }]; fitAt(entry, ctx) → fit; scores: { shipped, local }
function plan(entries, fitAt, scores = {}) {
  const at = (ctx) => entries.map(e => ({ ...e, agentFit: fitAt(e, ctx) }));
  const smooth = (list) => list.some(m => AE.eligibility({ ...m, fit: m.agentFit }, { shipped: m.catalog && (scores.shipped || {})[m.catalog.id], local: (scores.local || {})[m.id] }).ok);
  if (smooth(at(CTX_FULL))) return { ctx: CTX_FULL, lowered: false, allowSlow: false, maxSpill: 0 };
  if (smooth(at(CTX_LOW))) return { ctx: CTX_LOW, lowered: true, allowSlow: true, maxSpill: SMALL_SPILL };
  return { ctx: CTX_LOW, lowered: true, allowSlow: true, maxSpill: Infinity };
}
const elOpts = (p) => ({ allowSlow: !!(p && p.allowSlow), maxSpill: !p ? 0 : p.maxSpill == null ? Infinity : p.maxSpill });
// câu giải thích cho giao diện
function note(p) {
  if (!p || !p.lowered) return '';
  return p.maxSpill === Infinity
    ? 'Máy này không có mô hình AIVN AGENT nào nằm trọn trong VRAM, nên AIVN dùng ngữ cảnh 12K cho AIVN AGENT và cho phép mô hình “Chạy chậm” (mỗi bước có thể mất 10–30 giây).'
    : 'AIVN AGENT dùng ngữ cảnh 12K trên máy này để mô hình nằm trọn trong VRAM (lịch sử và ảnh màn hình được tự thu gọn). Mô hình tràn ít (dưới 1 GB) vẫn chọn được nhưng chậm hơn.';
}
module.exports = { plan, elOpts, note, CTX_FULL, CTX_LOW, SMALL_SPILL };
