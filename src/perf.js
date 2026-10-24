// Mức hiệu năng: tự nhận biết máy Yếu / Trung bình / Mạnh và chọn cấu hình suy luận + giao diện phù hợp.
// Người dùng có thể ghi đè bằng cài đặt "Hiệu năng": Tự động / Tiết kiệm / Cân bằng / Tối đa.
const GB = 1024 ** 3;
const TIER_VI = { weak: 'Yếu', medium: 'Trung bình', strong: 'Mạnh' };
const MODE_VI = { auto: 'Tự động', saver: 'Tiết kiệm', balanced: 'Cân bằng', max: 'Tối đa' };

// hw: { ram, cpus, mathCores, gpu, vram: { total } }
function detectTier(hw = {}) {
  const ram = (hw.ram || 0) / GB;
  const cores = hw.mathCores || Math.max(1, Math.round((hw.cpus || 2) / 2));
  const vram = hw.vram && hw.vram.total ? hw.vram.total / GB : 0;
  const discrete = hw.gpu && hw.gpu !== 'metal' && !(hw.vram && hw.vram.integratedOnly) && vram > 0;
  const metal = hw.gpu === 'metal';
  let tier = 'medium'; const why = [];
  if (ram < 7.5 || (cores <= 4 && !(discrete && vram >= 3.5) && !metal)) { tier = 'weak'; why.push(ram < 7.5 ? `RAM ${ram.toFixed(0)} GB` : `${cores} nhân CPU, không có GPU rời đủ mạnh`); }
  else if ((discrete && vram >= 7.5 && ram >= 15) || (metal && ram >= 15.5) || (!hw.gpu && cores >= 12 && ram >= 31)) { tier = 'strong'; why.push(discrete ? `GPU ${vram.toFixed(0)} GB VRAM, RAM ${ram.toFixed(0)} GB` : metal ? `Apple Silicon, bộ nhớ hợp nhất ${ram.toFixed(0)} GB` : `${cores} nhân CPU, RAM ${ram.toFixed(0)} GB`); }
  else why.push(`RAM ${ram.toFixed(0)} GB, ${cores} nhân CPU${discrete ? `, GPU ${vram.toFixed(1)} GB` : metal ? ', Apple Silicon' : ''}`);
  return { tier, label: TIER_VI[tier], why: why.join(', '), ram, cores, vram, discrete, metal };
}

const MODE_FOR_TIER = { weak: 'saver', medium: 'balanced', strong: 'max' };

// Cấu hình thật áp dụng khi nạp mô hình + cho giao diện
function profileFor(hw = {}, mode = 'auto') {
  const t = detectTier(hw);
  const eff = MODE_VI[mode] && mode !== 'auto' ? mode : MODE_FOR_TIER[t.tier];
  const cores = t.cores;
  const lowVram = t.discrete && t.vram < 6;
  const p = { tier: t.tier, tierLabel: t.label, why: t.why, mode, modeLabel: MODE_VI[mode] || MODE_VI.auto, effective: eff, effectiveLabel: MODE_VI[eff] };
  if (eff === 'saver') Object.assign(p, {
    threads: Math.max(1, cores >= 4 ? cores - 1 : cores), // chừa 1 nhân cho giao diện/hệ điều hành
    batchSize: 256, ctx: 4096, kvQuant: !!hw.gpu && hw.gpu !== 'metal', idleUnloadMin: 10, uiLite: true, streamMs: 80, rendererHeapMB: 512, lookup: false });
  else if (eff === 'balanced') Object.assign(p, {
    threads: cores, batchSize: 512, ctx: t.ram >= 11.5 ? 8192 : 4096, kvQuant: lowVram, idleUnloadMin: 0, uiLite: false, streamMs: 0, rendererHeapMB: 0, lookup: false });
  else Object.assign(p, {
    threads: cores, batchSize: hw.gpu ? 2048 : 1024, ctx: (t.discrete && t.vram >= 11.5) || (t.metal && t.ram >= 31) ? 16384 : 8192, kvQuant: lowVram, idleUnloadMin: 0, uiLite: false, streamMs: 0, rendererHeapMB: 0, lookup: false }); // dự đoán token kiểu tra cứu (InputLookup) đo trên CPU chậm hơn ~50% → tắt
  p.flashAttention = 'auto'; // llama.cpp tự bật khi mô hình + phần cứng hỗ trợ (cần cho KV q8_0)
  p.tips = tipsFor(t, p);
  return p;
}

function tipsFor(t, p) {
  const tips = [];
  if (t.tier === 'weak') {
    tips.push('Dùng mô hình nhỏ 0,5–3 tỉ tham số bản Q4_K_M (vd. Qwen3 1.7B, Gemma 3 1B) để trả lời nhanh.');
    tips.push('Đóng bớt trình duyệt/ứng dụng nặng khi trò chuyện để trả lại RAM. Mô hình đang chọn không tự gỡ.');
  } else if (t.tier === 'medium') {
    tips.push(t.discrete ? `GPU ${t.vram.toFixed(0)} GB: mô hình 3–4 tỉ (Q4_K_M) nằm trọn trên GPU, 7–8 tỉ chạy một phần GPU + CPU.` : 'Mô hình 3–4 tỉ tham số (Q4_K_M) là cân bằng tốt giữa tốc độ và chất lượng.');
  } else {
    tips.push(t.metal ? 'Mac Apple Silicon: mô hình 7–14 tỉ tham số chạy mượt bằng Metal.' : 'Máy mạnh: thử mô hình 7–14 tỉ tham số; AIVN đưa tối đa số lớp lên GPU và dùng ngữ cảnh dài hơn.');
  }
  if (p.kvQuant) tips.push('Bộ nhớ đệm ngữ cảnh (KV) được nén q8_0 để vừa ngữ cảnh dài hơn trên VRAM ít.');
  return tips;
}

module.exports = { detectTier, profileFor, TIER_VI, MODE_VI };
