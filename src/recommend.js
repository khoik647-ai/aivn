'use strict';
// Một bộ gợi ý duy nhất cho mọi nơi (Kho mô hình, biểu ngữ AIVN AGENT, hộp thoại, thông báo lỗi).
// Quy tắc:
//  - Trò chuyện & công cụ: Qwen3 8B nếu vừa máy, không thì Qwen3 4B Instruct 2507.
//  - Điều khiển máy: KHÔNG BAO GIỜ gợi ý một mô hình chỉ đọc chữ đứng một mình (không nhìn được màn hình; Zalo và
//    các ứng dụng Electron gần như không cho đọc danh sách nút/ô). Gợi ý theo VRAM (screenSetup):
//      (a) một mô hình nhìn ảnh vừa lập kế hoạch vừa nhìn: Qwen3-VL 8B (≥ 7,5 GB VRAM), Qwen3-VL 4B (≥ 3,5 GB), Qwen3-VL 2B;
//      (b) hoặc cặp: mô hình chữ lập kế hoạch + mô hình nhìn ảnh làm "mắt nhìn" (bộ định vị), nạp tự động.
//    Qwen3-VL: nhà phát triển ghi "Visual Agent: Operates PC/mobile GUIs" (huggingface.co/Qwen/Qwen3-VL-8B-Instruct).
//  - Nhãn điểm "Điểm tác vụ" vẫn chỉ từ bài đo thật.
const PLANNERS = ['qwen_qwen3-8b-q4_k_m', 'qwen3-4b-instruct-2507-q4_k_m'];
const GROUNDERS = ['holo1.5-3b-q4_k_m', 'qwen3-vl-4b-instruct-q4_k_m', 'qwen2.5-vl-3b-instruct-q4_k_m', 'qwen3-vl-2b-instruct-q8_0', 'ui-tars-1.5-7b-q4_k_m', 'qwen3-vl-8b-instruct-q4_k_m', 'qwen2.5-vl-7b-instruct-q4_k_m'];
const VISION_SOLO = [ // theo thứ tự ưu tiên, kèm VRAM tối thiểu (GB) để chạy trọn trên GPU
  { id: 'qwen3-vl-8b-instruct-q4_k_m', vram: 7.5 }, { id: 'qwen3-vl-4b-instruct-q4_k_m', vram: 3.5 }, { id: 'qwen3-vl-2b-instruct-q8_0', vram: 0 }];
const PAIR_GROUNDER = [ // mắt nhìn cho cặp: ưu tiên mô hình chuyên điều khiển máy
  { id: 'ui-tars-1.5-7b-q4_k_m', vram: 10 }, { id: 'holo1.5-3b-q4_k_m', vram: 0 }, { id: 'qwen3-vl-2b-instruct-q8_0', vram: 0 }];
const VISION_IDS = new Set([...VISION_SOLO, ...PAIR_GROUNDER].map(x => x.id).concat(GROUNDERS));
const passes = (b) => !!(b && b.done === 10 && b.score >= 7 && b.safety !== false);
const gPasses = (b) => !!(b && b.grounding && b.grounding.total === 10 && b.grounding.score >= 7);

// Kết quả đo trên máy người dùng được lưu theo id của mô hình đã cài (tên tệp, vd. "holo1.5-3b.q4_k_m"),
// còn Kho mô hình dùng id riêng ("holo1.5-3b-q4_k_m"): tra cả hai.
const fileId = (f) => { const b = String(f || '').split('/').pop(); const m = b.match(/^(.*)-\d{5}-of-\d{5}\.gguf$/i); return (m ? m[1] : b.replace(/\.gguf$/i, '')).toLowerCase(); };
function pickBench(id, scores, file) {
  const get = (o) => o && (o[id] || (file && o[fileId(file)]));
  const l = get(scores && scores.local); const s = get(scores && scores.shipped);
  return l ? { ...(s || {}), ...l, where: 'máy bạn', grounding: (l.grounding || (s && s.grounding)) } : s ? { ...s, where: 'máy thử của AIVN' } : null;
}
const fitRank = (f) => (!f ? 0 : f.level === 'fit' ? 3 : f.level === 'slow' ? 1 : 0);

// list: mục Kho mô hình (đã có fit, size, mmproj, installed); scores: { local, shipped }
function recommend(list, scores = {}) {
  const by = (id) => list.find(c => c.id === id);
  const planners = PLANNERS.map(by).filter(Boolean);
  const chat = planners.find(c => fitRank(c.fit) >= 3) || planners[planners.length - 1] || null;
  // bộ lập kế hoạch cho điều khiển máy: mô hình chữ đạt bài đo (ưu tiên mô hình chat đã gợi ý)
  const plannerOk = [chat, ...planners].filter(Boolean).find(c => passes(pickBench(c.id, scores, c.file))) || null;
  const grounders = GROUNDERS.map(by).filter(Boolean);
  const grounder = grounders.find(c => fitRank(c.fit) >= 3 && gPasses(pickBench(c.id, scores, c.file))) || null;
  return { chat: chat && chat.id, planner: plannerOk && plannerOk.id, grounder: grounder && grounder.id, plannerCandidate: chat && chat.id };
}
// Điều khiển màn hình: một mô hình nhìn ảnh (solo) hoặc cặp lập kế hoạch + mắt nhìn, chọn theo VRAM (byte).
// Không bao giờ trả về một mô hình chỉ đọc chữ đứng một mình.
function screenSetup(list, vramBytes = 0) {
  const GB = 1024 ** 3, v = (vramBytes || 0) / GB; const by = (id) => list.find(c => c.id === id);
  const soloC = VISION_SOLO.filter(x => v >= x.vram && by(x.id)); const solo = soloC[0] ? by(soloC[0].id) : by(VISION_SOLO[VISION_SOLO.length - 1].id) || null;
  const planner = by(v >= 7.5 ? PLANNERS[0] : PLANNERS[1]) || by(PLANNERS[1]) || null;
  const gC = PAIR_GROUNDER.filter(x => v >= x.vram && by(x.id)); const grounder = gC[0] ? by(gC[0].id) : null;
  return { solo: solo ? solo.id : null, pair: planner && grounder ? { planner: planner.id, grounder: grounder.id } : null, vramGB: Math.round(v * 10) / 10 };
}
// mô hình có nhìn được ảnh không (tệp mmproj hoặc trạng thái bộ máy)
const isVision = (c) => !!(c && (c.vision || c.mmproj || VISION_IDS.has(c.id)));
// Mắt nhìn cho một mô hình chữ khi bật điều khiển màn hình: ưu tiên mô hình đã cài, rồi theo VRAM
function eyesFor(list, vramBytes = 0) {
  const s = screenSetup(list, vramBytes); const order = [s.pair && s.pair.grounder, s.solo, ...PAIR_GROUNDER.map(x => x.id), ...VISION_SOLO.map(x => x.id)].filter(Boolean);
  const cands = [...new Set(order)].map(id => list.find(c => c.id === id)).filter(Boolean);
  return cands.find(c => c.installed) || cands[0] || null;
}
// gắn nhãn lên từng thẻ
function annotate(list, scores = {}, vramBytes = 0) {
  const r = recommend(list, scores); const ss = screenSetup(list, vramBytes); r.screen = ss;
  return { rec: r, list: list.map(c => {
    const b = pickBench(c.id, scores, c.file);
    const o = { ...c, bench: b ? { score: b.score, done: b.done, safety: b.safety, where: b.where, date: b.date, seconds: b.seconds, grounding: b.grounding || null } : null };
    o.recommended = c.id === r.chat; o.recScreen = c.id === ss.solo; o.recGround = c.id === r.grounder || !!(ss.pair && c.id === ss.pair.grounder); o.recPairPlanner = !!(ss.pair && c.id === ss.pair.planner);
    o.role = PLANNERS.includes(c.id) ? 'planner' : VISION_IDS.has(c.id) ? 'grounder' : null;
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
module.exports = { screenSetup, eyesFor, isVision, VISION_SOLO, PAIR_GROUNDER, pairPlan, recommend, annotate, sentence, passes, gPasses, PLANNERS, GROUNDERS, pickBench };
