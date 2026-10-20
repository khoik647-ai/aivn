'use strict';
// Một bộ gợi ý duy nhất cho mọi nơi (Kho mô hình, biểu ngữ AIVN AGENT, hộp thoại, thông báo lỗi).
// Quy tắc:
//  - Trò chuyện & công cụ: Qwen3 8B nếu vừa máy, không thì Qwen3 4B Instruct 2507.
//  - Điều khiển máy: cùng mô hình chữ đó làm "bộ lập kế hoạch" (đọc danh sách nút/ô qua Trợ năng của hệ điều hành)
//    + (tuỳ chọn) một mô hình nhìn ảnh làm "bộ định vị" khi danh sách thiếu phần tử.
//  - Nhãn "Gợi ý" cho điều khiển máy CHỈ khi mô hình đã qua bài đo Điểm tác vụ (≥ 7/10 và đạt kiểm tra an toàn).
const PLANNERS = ['qwen_qwen3-8b-q4_k_m', 'qwen3-4b-instruct-2507-q4_k_m'];
const GROUNDERS = ['holo1.5-3b-q4_k_m', 'qwen3-vl-4b-instruct-q4_k_m', 'qwen2.5-vl-3b-instruct-q4_k_m', 'qwen3-vl-2b-instruct-q8_0', 'ui-tars-1.5-7b-q4_k_m', 'qwen3-vl-8b-instruct-q4_k_m', 'qwen2.5-vl-7b-instruct-q4_k_m'];
const passes = (b) => !!(b && b.done === 10 && b.score >= 7 && b.safety !== false);
const gPasses = (b) => !!(b && b.grounding && b.grounding.total === 10 && b.grounding.score >= 7);

function pickBench(id, scores) {
  const l = scores && scores.local && scores.local[id]; const s = scores && scores.shipped && scores.shipped[id];
  return l ? { ...(s || {}), ...l, where: 'máy bạn', grounding: (l.grounding || (s && s.grounding)) } : s ? { ...s, where: 'máy thử của AIVN' } : null;
}
const fitRank = (f) => (!f ? 0 : f.level === 'fit' ? 3 : f.level === 'slow' ? 1 : 0);

// list: mục Kho mô hình (đã có fit, size, mmproj, installed); scores: { local, shipped }
function recommend(list, scores = {}) {
  const by = (id) => list.find(c => c.id === id);
  const planners = PLANNERS.map(by).filter(Boolean);
  const chat = planners.find(c => fitRank(c.fit) >= 3) || planners[planners.length - 1] || null;
  // bộ lập kế hoạch cho điều khiển máy: mô hình chữ đạt bài đo (ưu tiên mô hình chat đã gợi ý)
  const plannerOk = [chat, ...planners].filter(Boolean).find(c => passes(pickBench(c.id, scores))) || null;
  const grounders = GROUNDERS.map(by).filter(Boolean);
  const grounder = grounders.find(c => fitRank(c.fit) >= 3 && gPasses(pickBench(c.id, scores))) || null;
  return { chat: chat && chat.id, planner: plannerOk && plannerOk.id, grounder: grounder && grounder.id, plannerCandidate: chat && chat.id };
}
// gắn nhãn lên từng thẻ
function annotate(list, scores = {}) {
  const r = recommend(list, scores);
  return { rec: r, list: list.map(c => {
    const b = pickBench(c.id, scores);
    const o = { ...c, bench: b ? { score: b.score, done: b.done, safety: b.safety, where: b.where, date: b.date, seconds: b.seconds, grounding: b.grounding || null } : null };
    o.recommended = c.id === r.chat; o.recScreen = c.id === r.planner; o.recGround = c.id === r.grounder;
    o.role = PLANNERS.includes(c.id) ? 'planner' : GROUNDERS.includes(c.id) ? 'grounder' : null;
    return o;
  }) };
}
function nameOf(list, id) { const c = list.find(x => x.id === id); return c ? c.name : id; }
// câu gợi ý dùng chung (biểu ngữ, hộp thoại, lỗi)
function sentence(list, scores = {}) {
  const r = recommend(list, scores);
  const chat = r.chat ? nameOf(list, r.chat) : 'Qwen3 4B Instruct 2507';
  return { chat, text: `gợi ý: ${chat} (gọi công cụ tốt, vừa máy này)`, rec: r };
}
// Hai mô hình cùng lúc (mô hình chính + mô hình định vị) trên GPU ít VRAM (vd. RTX 3050 Ti 4 GB với hai mô hình ~5 GB):
// không nạp cả hai lên GPU — mô hình định vị chạy CPU, và gợi ý cặp nhỏ hơn. Kích thước tính bằng byte.
function pairPlan({ vram = 0, main = 0, grounder = 0, mainVision = false } = {}) {
  const GB = 1024 ** 3; const need = main + grounder + 1.2 * GB; // + bộ nhớ ngữ cảnh/đệm
  const fmt = (b) => (b / GB).toFixed(1).replace('.', ',') + ' GB';
  if (!vram || !grounder) return { ok: true, grounderGpu: !!vram, message: '' };
  if (need <= vram) return { ok: true, grounderGpu: true, message: '' };
  const msg = `GPU có ${fmt(vram)} VRAM nhưng mô hình chính (${fmt(main)}) + mô hình định vị (${fmt(grounder)}) cần khoảng ${fmt(need)}. ` +
    `AIVN sẽ chạy mô hình định vị bằng CPU (chậm hơn) để không tràn bộ nhớ GPU. Gợi ý: mô hình chính Qwen3 4B Instruct 2507 (≈2,5 GB) + mô hình định vị nhỏ (Qwen3-VL 2B ≈1,8 GB)` +
    (mainVision ? '; mô hình chính hiện là mô hình nhìn ảnh lớn — không cần nếu đã có mô hình định vị.' : '.');
  return { ok: false, grounderGpu: false, message: msg, needBytes: need };
}
module.exports = { pairPlan, recommend, annotate, sentence, passes, gPasses, PLANNERS, GROUNDERS, pickBench };
