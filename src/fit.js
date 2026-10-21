'use strict';
// Xếp mô hình theo mức chạy được trên CHÍNH máy này (quy tắc 0.16, áp cho Trò chuyện, AIVN AGENT và Khám phá):
//   1) “Chạy mượt”  — nằm trọn trong VRAM cùng ngữ cảnh cần dùng (Mac: vừa bộ nhớ hợp nhất; máy không GPU: đủ nhanh trên CPU)
//   2) “Chạy chậm” — tràn sang RAM
//   3) “Không chạy được” — lớn hơn VRAM + RAM (hiện mờ)
// Trong mỗi nhóm: mạnh trước. Gợi ý hàng đầu luôn là mô hình mạnh nhất chạy mượt.
// Ước tính tốc độ: sinh mỗi token phải đọc toàn bộ trọng số (MoE: phần hoạt động) → token/giây ≈ băng thông hiệu dụng / số byte đọc.
const GB = 1e9, MiB = 1024 * 1024;
const GROUPS = [
  { key: 'smooth', label: 'Chạy mượt' },
  { key: 'slow', label: 'Chạy chậm' },
  { key: 'no', label: 'Không chạy được' },
];
const LABEL = Object.fromEntries(GROUPS.map(g => [g.key, g.label]));

// “30B (MoE, 3B hoạt động)”, “E4B (8B, tương đương 4B)”, “20B (MoE)”, “7B”
function parseParams(s, size = 0) {
  const t = String(s || '');
  const nums = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*B/gi)].map(m => parseFloat(m[1].replace(',', '.')));
  let total = nums[0] || 0, active = null;
  const eq = /tương đương\s*(\d+(?:[.,]\d+)?)\s*B/i.exec(t); if (eq) return { total: nums[1] || total, active: null, effective: parseFloat(eq[1].replace(',', '.')) };
  const act = /(\d+(?:[.,]\d+)?)\s*B\s*hoạt động/i.exec(t) || /-A(\d+(?:\.\d+)?)B/i.exec(t);
  if (act) active = parseFloat(act[1].replace(',', '.'));
  else if (/MoE/i.test(t)) active = +(total * 0.18).toFixed(1); // gpt-oss-20b ≈ 3,6B hoạt động
  if (!total && size) total = +(size / 0.6 / GB).toFixed(1); // Q4: ~0,6 byte/tham số
  return { total, active, effective: null };
}
// Độ mạnh tương đối (chỉ để xếp thứ tự): số tham số (MoE: trung bình nhân tổng × hoạt động) × hệ số thế hệ
const GEN = [
  [/qwen3.*2507|gpt-oss/i, 1.2], [/qwen3/i, 1.15], [/gemma-3n|gemma-3|phi-4|mistral-small-3/i, 1.05],
  [/qwen2\.5|glm-4|internvl3/i, 1.0], [/llama-3|nemo|granite|lfm2/i, 0.9], [/gemma-2|phi-3|deepseek-r1-distill/i, 0.85],
  [/ui-tars|holo|venus/i, 0.8], [/mistral-7b|smol/i, 0.75],
];
function strength(m) {
  if (typeof m.strength === 'number') return m.strength;
  const p = parseParams(m.params || m.sizeLabel, m.size);
  const base = p.effective || (p.active ? Math.sqrt(p.total * p.active) : p.total);
  const id = String(m.id || m.file || '');
  const g = (GEN.find(([re]) => re.test(id)) || [null, 0.95])[1];
  return +(base * g).toFixed(2);
}
// KV cache f16 mỗi token: dùng số đo từ GGUF nếu có, nếu không ước theo số tham số (GQA phổ biến: 8B ≈ 110 KB/token)
// B38 (máy thật của Khôi: Qwen3-VL 4B ước 4,4 GB nhưng VRAM thật tăng ~7,2 GB): hiệu chỉnh theo kiến trúc thật của các họ phổ biến
// (Qwen3/Qwen3-VL: 28 lớp × 8 đầu KV × 128 ≈ 115 KB/token cho ≤ 2B; 36 lớp ≈ 147 KB/token cho 4B/8B; 14B 40 lớp ≈ 164 KB; 32B 64 lớp ≈ 262 KB)
const kvPerToken = (m) => { if (m.kvPerToken) return m.kvPerToken; const P = parseParams(m.params || m.sizeLabel, m.size).total || 4; return P <= 2.6 ? 115e3 : P <= 9.5 ? 147e3 : P <= 16 ? 164e3 : 262e3; };
// bộ đệm tính toán của llama.cpp lớn dần theo ngữ cảnh (đo: ~0,7 GB ở 16K cho mô hình 4B)
const computeBuf = (ctx) => 300 * MiB + ctx * 24 * 1024;
// mô hình nhìn ảnh: bộ đệm mã hoá ảnh (ảnh chụp màn hình ~1 triệu điểm ảnh) ngoài trọng số mmproj
const VISION_BUF = 600 * MiB;
// CUDA/Vulkan context + bộ máy
const RUNTIME = 350 * MiB;
// Một cách tính duy nhất cho Khám phá và Mô hình của tôi: gom thông tin mô hình (catalog / tệp đã cài / số đo thật) thành đầu vào của machineFit
// measured: { bytes, ctx } = VRAM tăng thật khi nạp trên máy này (main.js ghi lại sau mỗi lần nạp lên GPU)
function metaOf({ catalog = null, size = 0, mmprojSize = null, file = '', kvPerToken = null, measured = null } = {}) {
  return { id: catalog ? catalog.id : null, size: size || (catalog && catalog.size) || 0, mmprojSize: mmprojSize != null ? mmprojSize : (catalog && catalog.mmproj ? catalog.mmproj.size || 0 : 0),
    params: (catalog && catalog.params) || (String(file).match(/(\d+(?:\.\d+)?)\s*[bB](?![a-z])/) || [])[0] || null, kvPerToken: kvPerToken || (catalog && catalog.kvPerToken) || null, measured: measured && measured.bytes > 0 ? measured : null };
}
// Băng thông bộ nhớ GPU (GB/s) theo tên; không biết thì ước theo dung lượng VRAM
const GPU_BW = [
  [/5090/, 1790], [/5080/, 960], [/5070 ?ti/i, 896], [/5070/, 672], [/5060 ?ti/i, 448], [/5060/, 448],
  [/4090/, 1008], [/4080/, 717], [/4070 ?ti ?super/i, 672], [/4070 ?ti/i, 504], [/4070 ?super/i, 504], [/4070/, 504], [/4060 ?ti/i, 288], [/4060/, 272],
  [/3090/, 936], [/3080/, 760], [/3070/, 448], [/3060 ?ti/i, 448], [/3060/, 360], [/3050/, 224], [/2080/, 448], [/2070/, 448], [/2060/, 336], [/1660/, 192], [/1650/, 128],
  [/7900 ?xtx/i, 960], [/7900/, 800], [/7800/, 624], [/7700/, 432], [/7600/, 288], [/6800/, 512], [/6700/, 384], [/6600/, 224],
  [/arc.*a770/i, 560], [/arc.*a750/i, 512],
];
function gpuBandwidth(hw) {
  const name = (hw.devices || []).join(' ');
  const hit = GPU_BW.find(([re]) => re.test(name)); if (hit) return hit[1];
  const v = hw.vram && hw.vram.total ? hw.vram.total / GB : 0;
  return Math.max(100, Math.min(600, 30 * v + 80));
}
// RAM: ước 2 kênh DDR4/DDR5 ≈ 50 GB/s; Mac Apple Silicon dùng bộ nhớ hợp nhất ≈ 100+ GB/s
const cpuBandwidth = (hw) => hw.gpu === 'metal' ? 120 : (hw.ramBandwidth || 60);
// hiệu chỉnh theo số đo thật (RTX 4070 SUPER: Qwen3-VL 4B Q4_K_M 114,7 token/giây): băng thông hiệu dụng 75 % + ~2,5 ms chi phí cố định mỗi token trên GPU
const EFF_GPU = 0.75, EFF_CPU = 0.7, TOK_OVH_GPU = 0.0025, TOK_OVH_CPU = 0.001;

// m: { size, mmprojSize?, params?, kvPerToken?, id? }; o: { ctx }
function machineFit(m, hw, o = {}) {
  if (!hw || !hw.ram) return null;
  const ctx = o.ctx || 8192;
  // B78: tệp quá nhỏ (GGUF giả/hỏng 2 KB từng được ước “Chạy mượt ~1000 token/giây”) — mô hình thật nhỏ nhất cũng ~100 MB
  if ((m.size || 0) < 16 * MiB) return { group: 'no', label: LABEL.no, level: 'big', hint: 'Tệp quá nhỏ, không phải mô hình dùng được (có thể tải lỗi hoặc tệp hỏng)', ctx, need: m.size || 0, vram: 0, ram: 0, tps: 0, measured: false, invalid: true };
  const weights = (m.size || 0) + (m.mmprojSize || 0);
  const kv = kvPerToken(m) * ctx;
  let need = weights + kv + computeBuf(ctx) + (m.mmprojSize ? VISION_BUF : 0) + RUNTIME;
  // có số đo thật trên máy này: dùng số đo (chỉnh theo phần KV + bộ đệm khác ngữ cảnh)
  const meas = m.measured && m.measured.bytes > 0 ? m.measured : null;
  if (meas) need = Math.max(weights, meas.bytes + (kvPerToken(m) + 24 * 1024) * (ctx - (meas.ctx || ctx)));
  const vramTotal = hw.gpu && hw.gpu !== 'metal' && hw.vram && hw.vram.total && !hw.vram.integratedOnly && !hw.cpuOnly ? hw.vram.total : 0;
  const vramBudget = vramTotal ? vramTotal - Math.max(600 * MiB, vramTotal * 0.06) : 0; // màn hình và Windows giữ một phần VRAM
  const ramBudget = Math.max(0, hw.ram * 0.85 - 1.5 * GB); // chừa cho hệ điều hành và ứng dụng khác
  const p = parseParams(m.params || m.sizeLabel, m.size);
  const readFrac = p.active && p.total ? Math.min(1, p.active / p.total) : 1; // MoE: mỗi token chỉ đọc phần hoạt động
  const perTok = (m.size || 0) * readFrac;
  let group, vramUse = 0, ramUse = 0, hint, tps;
  if (hw.gpu === 'metal') {
    ramUse = need; const ok = need <= hw.ram * 0.65;
    group = ok ? 'smooth' : need <= hw.ram * 0.8 ? 'slow' : 'no';
    tps = perTok ? (cpuBandwidth(hw) * EFF_GPU * GB) / perTok : 0;
    hint = ok ? 'Vừa bộ nhớ hợp nhất của Mac' : group === 'slow' ? 'Gần hết bộ nhớ, máy có thể chậm' : 'Lớn hơn bộ nhớ của máy';
  } else if (vramTotal) {
    if (need <= vramBudget) { group = 'smooth'; vramUse = need; tps = perTok ? 1 / (perTok / (gpuBandwidth(hw) * EFF_GPU * GB) + TOK_OVH_GPU) : 0; hint = 'Nằm trọn trong VRAM'; }
    else if (need <= vramBudget + ramBudget) {
      group = 'slow'; vramUse = vramBudget; ramUse = need - vramBudget;
      const onGpu = Math.max(0, Math.min(1, (vramBudget - kv - computeBuf(ctx)) / Math.max(1, weights)));
      const t = perTok * onGpu / (gpuBandwidth(hw) * EFF_GPU * GB) + perTok * (1 - onGpu) / (cpuBandwidth(hw) * EFF_CPU * GB) + TOK_OVH_GPU;
      tps = t ? 1 / t : 0; hint = `Tràn ${(ramUse / 1024 ** 3).toFixed(1).replace('.', ',')} GB sang RAM, phần đó chạy bằng CPU`;
    } else { group = 'no'; hint = 'Lớn hơn VRAM + RAM của máy'; tps = 0; ramUse = need; }
  } else {
    // máy không có GPU rời: “mượt” khi vừa RAM và ước tính ≥ 10 token/giây trên CPU
    ramUse = need; tps = perTok ? 1 / (perTok / (cpuBandwidth(hw) * EFF_CPU * GB) + TOK_OVH_CPU) : 0;
    group = need > ramBudget ? 'no' : tps >= 10 ? 'smooth' : 'slow';
    hint = group === 'no' ? 'Lớn hơn RAM của máy' : group === 'smooth' ? 'Chạy bằng CPU, vừa RAM' : 'Chạy bằng CPU, khá chậm';
  }
  const r = { group, label: LABEL[group], level: group === 'smooth' ? 'fit' : group === 'slow' ? 'slow' : 'big', hint, ctx,
    need: Math.round(need), vram: Math.round(vramUse), ram: Math.round(ramUse), tps: tps ? Math.max(0.5, Math.round(tps * 10) / 10) : 0, measured: !!meas,
    parts: { weights: Math.round(m.size || 0), mmproj: Math.round(m.mmprojSize || 0), kv: Math.round(kv), compute: Math.round(computeBuf(ctx) + (m.mmprojSize ? VISION_BUF : 0) + RUNTIME) } };
  if (m.measuredTps > 0 && group !== 'no') { r.tps = Math.round(m.measuredTps * 10) / 10; r.tpsMeasured = true; }
  // B78: số đo thật quá chậm (“Đo được 0,1 token/giây”) mà nhãn vẫn “Chạy mượt” → theo số đo: Chạy chậm
  if (r.tpsMeasured && r.tps < 5 && r.group === 'smooth') Object.assign(r, { group: 'slow', label: LABEL.slow, level: 'slow', hint: `Đo được chỉ ~${String(r.tps).replace('.', ',')} token/giây trên máy này` });
  r.text = fmtFit(r); r.detail = fitDetail(r); return r;
}
const ORDER = { smooth: 0, slow: 1, no: 2 };
// sắp xếp: nhóm (mượt → chậm → không chạy) rồi mạnh trước; f(m) trả về kết quả machineFit của m
function sortByFit(list, fitOf) {
  return list.map(m => ({ m, f: fitOf(m), s: strength(m) }))
    .sort((a, b) => (ORDER[(a.f || {}).group] ?? 1) - (ORDER[(b.f || {}).group] ?? 1) || b.s - a.s || (a.m.size || 0) - (b.m.size || 0)).map(x => x.m);
}
function groupByFit(list, fitOf) {
  const sorted = sortByFit(list, fitOf);
  return GROUPS.map(g => ({ ...g, items: sorted.filter(m => ((fitOf(m) || {}).group || 'slow') === g.key) })).filter(g => g.items.length);
}
// “Khoảng 55 token/giây · 7,4 GB VRAM” / “~3 token/giây · 12 GB VRAM + 9,8 GB RAM”
function fmtFit(f) {
  if (!f || f.invalid) return ''; // B78: tệp hỏng — không ghi số ước tính vô nghĩa (chú thích nằm ở hint)
  const gb = (b) => (b / 1024 ** 3).toFixed(1).replace('.', ',') + ' GB'; // GiB, khớp cách Windows/NVIDIA ghi dung lượng
  const mem = f.group === 'no' ? `cần ~${gb(f.need)}` : [f.vram ? gb(f.vram) + ' VRAM' : '', f.ram ? gb(f.ram) + ' RAM' : ''].filter(Boolean).join(' + ');
  const sp = f.tps ? `~${f.tps >= 10 ? Math.round(f.tps) : String(f.tps).replace('.', ',')} token/giây` : '';
  return [sp, mem].filter(Boolean).join(' · ');
}
// chú thích chi tiết (tooltip): trọng số + mmproj + KV ở ngữ cảnh N + bộ đệm
function fitDetail(f) {
  if (!f || !f.parts) return '';
  const gb = (b) => (b / 1024 ** 3).toFixed(1).replace('.', ',') + ' GB';
  const ms = f.measured ? ' (theo số đo VRAM thật khi nạp trên máy này)' : '';
  if (f.parts.mmproj) return `Ước tính ở ngữ cảnh ${f.ctx}: trọng số ${gb(f.parts.weights)} + tệp thị giác ${gb(f.parts.mmproj)} + bộ đệm KV ${gb(f.parts.kv)} + bộ đệm tính toán ${gb(f.parts.compute)} = ${gb(f.need)}${ms}`;
  return `Ước tính ở ngữ cảnh ${f.ctx}: trọng số ${gb(f.parts.weights)} + bộ đệm KV ${gb(f.parts.kv)} + bộ đệm tính toán ${gb(f.parts.compute)} = ${gb(f.need)}${ms}`;
}
module.exports = { GROUPS, LABEL, parseParams, strength, kvPerToken, computeBuf, metaOf, gpuBandwidth, machineFit, sortByFit, groupByFit, fmtFit, fitDetail };
