'use strict';
// Xếp mô hình theo mức chạy được trên CHÍNH máy này (quy tắc 0.16, áp cho Trò chuyện, AIVN AGENT và Khám phá):
//   1) “Chạy mượt”  — nằm trọn trong VRAM cùng ngữ cảnh cần dùng (Mac: vừa bộ nhớ hợp nhất; máy không GPU: đủ nhanh trên CPU)
//      Sát giới hạn vẫn là “Chạy mượt”, kèm cảnh báo (ước tính cách LM Studio: vừa, nhưng gần hết phần dành cho mô hình).
//   2) “Chạy chậm” — tràn sang RAM
//   3) “Không chạy được” — lớn hơn VRAM + RAM (hiện mờ)
// Trong mỗi nhóm: mạnh trước. Gợi ý hàng đầu luôn là mô hình mạnh nhất chạy mượt.
// Ước tính tốc độ: sinh mỗi token phải đọc toàn bộ trọng số (MoE: phần hoạt động) → token/giây ≈ băng thông hiệu dụng / số byte đọc.
// Bộ nhớ ước theo cách llama.cpp / LM Studio thực sự cấp phát, không theo bảng “≥ 16B = 262 KB/token”:
//   trọng số trên GPU = tệp − tensor nằm ở CPU (token_embd), KV theo số lớp / đầu KV / độ dài đầu / cửa sổ trượt, bộ đệm tính toán theo lô nhỏ.
// Việc CHIA số lớp khi nạp (issue #57) nằm ở engine.js / gguf.js, không ở đây.
const GB = 1e9, MiB = 1024 * 1024;
const GROUPS = [
  { key: 'smooth', label: 'Chạy mượt' },
  { key: 'slow', label: 'Chạy chậm' },
  { key: 'no', label: 'Không chạy được' },
];
const LABEL = Object.fromEntries(GROUPS.map(g => [g.key, g.label]));
// “Chạy mượt” nhưng phần còn trống trong ngân sách nhỏ hơn mức này → cảnh báo sát giới hạn.
const TIGHT_SLACK = 128 * MiB;
// Mac: Metal recommendedMaxWorkingSetSize ≈ 2/3 RAM khi RAM < 64 GB, 3/4 khi ≥ 64 GB.
// Vượt 85 % thì “Chạy chậm”; sát giới hạn khi nhu cầu > 90 % phần “mượt”.
const MAC_SLOW = 0.85, MAC_TIGHT = 0.9;
function macFitFrac(mem) { return mem >= 64 * 1024 ** 3 ? 0.75 : 2 / 3; }

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

// Kiến trúc đã biết khi danh mục / tên tệp chưa có block_count. Số đo từ GGUF (layers, kvHeads, keyLength…) luôn thắng.
// KV f16 mỗi lớp mỗi token = kvHeads × (headDim + headDim) × 2.
const GPT_OSS_20B_MXFP4 = 12109566624;
// token_embd Q8_0 của gpt-oss-20b: vocab 201088 × hidden 2880 × 34/32. llama.cpp để tensor này ở CPU_Mapped kể cả khi nạp 25/25 lớp (đo #81: 586,82 MiB).
const GPT_OSS_EMBD = 201088 * 2880 * 34 / 32;
const GPT_OSS = { layers: 24, kvHeads: 8, headDim: 64, slidingWindow: 128, swaLayers: 12, cpuResident: GPT_OSS_EMBD };
const GPT_OSS_120B = { layers: 36, kvHeads: 8, headDim: 64, slidingWindow: 128, swaLayers: 18, cpuResident: GPT_OSS_EMBD };
// Qwen2/Qwen2.5/Qwen3: vocab 151936. Logits f32 = n_ubatch × vocab × 4 nằm trong bộ đệm tính toán.
const QWEN_VOCAB = 151936;
const QWEN3_MOE = { layers: 48, kvHeads: 4, headDim: 128, vocab: QWEN_VOCAB }; // 30B-A3B: 48×4×128, không phải bảng 32B đặc (262 KB/token)
const QWEN3_BANDS = [
  { max: 2.6, layers: 28, kvHeads: 8, headDim: 128, vocab: QWEN_VOCAB },
  { max: 9.5, layers: 36, kvHeads: 8, headDim: 128, vocab: QWEN_VOCAB },
  { max: 20, layers: 40, kvHeads: 8, headDim: 128, vocab: QWEN_VOCAB },
  { max: 80, layers: 64, kvHeads: 8, headDim: 128, vocab: QWEN_VOCAB },
];
const QWEN2_BANDS = [
  { max: 0.8, layers: 24, kvHeads: 2, headDim: 64, vocab: QWEN_VOCAB },
  { max: 2.2, layers: 28, kvHeads: 2, headDim: 128, vocab: QWEN_VOCAB },
  { max: 4.5, layers: 36, kvHeads: 2, headDim: 128, vocab: QWEN_VOCAB },
  { max: 10, layers: 28, kvHeads: 4, headDim: 128, vocab: QWEN_VOCAB },
  { max: 20, layers: 48, kvHeads: 8, headDim: 128, vocab: QWEN_VOCAB },
  { max: 100, layers: 64, kvHeads: 8, headDim: 128, vocab: QWEN_VOCAB },
];
// Phi-3.5-mini: MHA 32 đầu × head 96 (393 KB/token). Phi-4-mini: GQA 8×128. Phi-4 14B: 40 lớp, 10 đầu KV.
const PHI35_MINI = { layers: 32, kvHeads: 32, headDim: 96, vocab: 32064 };
const PHI4_MINI = { layers: 32, kvHeads: 8, headDim: 128, vocab: 200064 };
const PHI4 = { layers: 40, kvHeads: 10, headDim: 128, vocab: 100352 };
// SmolLM2 1.7B: MHA 32 đầu × head 64, không phải bucket 115 KB/token.
const SMOLLM2 = { layers: 24, kvHeads: 32, headDim: 64, vocab: 49152 };
const LLAMA3_BANDS = [
  { max: 1.5, layers: 16, kvHeads: 8, headDim: 64 },
  { max: 4, layers: 28, kvHeads: 8, headDim: 128 },
  { max: 12, layers: 32, kvHeads: 8, headDim: 128 },
  { max: 200, layers: 80, kvHeads: 8, headDim: 128 },
];
// Gemma 3: mỗi lớp thứ 6 (1-based) là full attention, còn lại cửa sổ trượt.
function gemma3(layers, kvHeads, slidingWindow) {
  const full = Math.floor(layers / 6);
  return { layers, kvHeads, headDim: 256, slidingWindow, swaLayers: layers - full };
}
const GEMMA3 = {
  1: gemma3(26, 1, 512),
  4: gemma3(34, 4, 1024),
  12: gemma3(48, 8, 1024),
  27: gemma3(62, 16, 1024),
};

function textOf(m) { return `${m && m.id || ''} ${m && m.file || ''} ${m && m.arch || ''} ${m && m.name || ''}`; }
function band(bands, P) { if (!(P > 0)) return null; return bands.find(b => P <= b.max) || bands[bands.length - 1]; }
function gemma3Of(m, P) {
  const t = textOf(m);
  if (/27\s*b/i.test(t) || P > 16) return GEMMA3[27];
  if (/12\s*b/i.test(t) || (P > 8 && P <= 16)) return GEMMA3[12];
  if (/4\s*b/i.test(t) || (P > 2 && P <= 8)) return GEMMA3[4];
  return GEMMA3[1];
}
// Tổng tham số: câu “14B” thắng; nếu chỉ có tên tệp “qwen3-8b” thì lấy số đó, không đoán từ dung lượng tệp (Q4 ~0,6 byte/tham số hay nhảy nhầm nhóm).
function totalB(m) {
  const raw = String((m && (m.params || m.sizeLabel)) || '');
  const fromText = parseParams(raw, 0).total;
  if (fromText) return fromText;
  const idm = `${m && m.id || ''} ${m && m.file || ''}`.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)b(?:[^a-z]|$)/i);
  if (idm) return parseFloat(idm[1]);
  return parseParams(raw, m && m.size).total || 0;
}
function familyOf(m) {
  if (!m || typeof m !== 'object') return null;
  const t = textOf(m);
  const P = totalB(m);
  if (/gpt-oss/i.test(t) || m.arch === 'gpt-oss') return (/120\s*b/i.test(t) || P >= 100) ? GPT_OSS_120B : GPT_OSS;
  // Đúng câu tái hiện của #81: danh mục chỉ có size + “20B (MoE)”, không có id trong lời gọi tối thiểu.
  if (/^20\s*B\s*\(MoE\)$/i.test(String(m.params || '').trim()) && m.size && Math.abs(m.size - GPT_OSS_20B_MXFP4) < MiB) return GPT_OSS;
  if (/smollm2|smol-?lm-?2/i.test(t)) return SMOLLM2;
  if (/phi/i.test(t) || m.arch === 'phi3') {
    if (/phi-?4-mini/i.test(t)) return PHI4_MINI;
    if (/phi-?3\.5|phi-?3-mini/i.test(t)) return PHI35_MINI;
    if (/phi-?4/i.test(t) || P >= 10) return PHI4;
    return PHI35_MINI;
  }
  if (m.arch === 'qwen3moe' || /qwen3-30b-a3b|qwen3moe/i.test(t)) return QWEN3_MOE;
  if ((m.arch === 'gemma3' || /gemma-?3/i.test(t)) && m.arch !== 'gemma3n' && !/gemma-?3n|gemma3n/i.test(t)) return gemma3Of(m, P);
  if (/qwen3\.5|qwen35/i.test(t) || m.arch === 'qwen35' || m.arch === 'qwen35moe') return null;
  if (/qwen3/i.test(t) || m.arch === 'qwen3' || m.arch === 'qwen3vl') return band(QWEN3_BANDS, P);
  if (/qwen2/i.test(t) || m.arch === 'qwen2' || m.arch === 'qwen2vl') return band(QWEN2_BANDS, P);
  if (/llama-?3/i.test(t)) return band(LLAMA3_BANDS, P);
  return null;
}
const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
function resolveGeo(m) {
  const src = m && typeof m === 'object' ? m : {};
  const prof = familyOf(src) || {};
  const layers = pos(src.layers) || prof.layers || 0;
  // heads là số đầu query. Đầu KV của hồ sơ thắng heads, kvHeads tường minh vẫn thắng cả hai.
  const kvHeads = pos(src.kvHeads) || prof.kvHeads || pos(src.heads) || 0;
  const headFromEmb = pos(src.embedding) && pos(src.heads) ? pos(src.embedding) / pos(src.heads) : 0;
  const headDim = pos(src.headDim) || pos(src.keyLength) || headFromEmb || prof.headDim || 0;
  const keyLen = pos(src.keyLength) || headDim;
  const valLen = pos(src.valueLength) || keyLen;
  const slidingWindow = src.slidingWindow != null && src.slidingWindow !== '' ? Number(src.slidingWindow) : (prof.slidingWindow || 0);
  let swaLayers = src.swaLayers != null && src.swaLayers !== '' ? Number(src.swaLayers) : (prof.swaLayers || 0);
  if (!(swaLayers > 0) && slidingWindow > 0 && layers > 0 && prof.swaLayers == null && src.swaLayers == null) swaLayers = Math.floor(layers / 2);
  const cpuResident = src.cpuResident != null && src.cpuResident !== '' ? Number(src.cpuResident) : (prof.cpuResident || 0);
  return {
    layers, kvHeads, keyLen, valLen,
    slidingWindow: slidingWindow > 0 ? slidingWindow : 0,
    swaLayers: swaLayers > 0 ? swaLayers : 0,
    cpuResident: cpuResident > 0 ? cpuResident : 0,
    vocab: pos(src.vocab) || prof.vocab || 0,
    explicitKv: pos(src.kvPerToken),
  };
}
// Có hình học (hồ sơ, kvPerToken từ GGUF, hoặc lớp/đầu/head_dim trên chính mô hình) thì không cộng lề an toàn cũ.
function geoKnown(m) {
  const src = m && typeof m === 'object' ? m : {};
  if (pos(src.kvPerToken) || familyOf(src)) return true;
  const layers = pos(src.layers);
  const kvH = pos(src.kvHeads) || pos(src.heads);
  const hd = pos(src.headDim) || pos(src.keyLength) || (pos(src.embedding) && pos(src.heads) ? pos(src.embedding) / pos(src.heads) : 0);
  return layers > 0 && kvH > 0 && hd > 0;
}
function clampCtx(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 8192;
}
// B38: không có kiến trúc thì ước theo tổng tham số (Qwen3 đặc: ≤ 2B ≈ 115 KB/token, 4B/8B ≈ 147 KB, 14B ≈ 164 KB, ≥ 32B ≈ 262 KB).
function bucketKv(m) {
  const P = parseParams(m && (m.params || m.sizeLabel), m && m.size).total || 4;
  return P <= 2.6 ? 115e3 : P <= 9.5 ? 147e3 : P <= 16 ? 164e3 : 262e3;
}
// Byte/token nếu MỌI lớp giữ cả ngữ cảnh (chưa trừ cửa sổ trượt). Giữ cho chỗ gọi cũ.
function kvPerToken(m) {
  const g = resolveGeo(m);
  // kvPerToken từ gguf.readMeta / summarize luôn thắng hồ sơ (kể cả khi hồ sơ đã đủ lớp và đầu).
  if (g.explicitKv) return g.explicitKv;
  if (g.layers > 0 && g.kvHeads > 0 && g.keyLen > 0 && g.valLen > 0) return g.layers * g.kvHeads * (g.keyLen + g.valLen) * 2;
  return bucketKv(m);
}
// llama.cpp (llama_kv_cache_iswa): ô SWA = pad256(min(ctx, n_swa × n_seq + n_ubatch)), mặc định n_seq = 1, n_ubatch = 512.
// gpt-oss: 128 + 512 = 640 → 768 ô. Đo #81 ở ctx 16384: 384 MiB (12 lớp đầy đủ) + 18 MiB (12 lớp SWA) = 402 MiB.
const pad256 = (n) => Math.ceil(n / 256) * 256;
function kvCacheBytes(m, ctx, o = {}) {
  const g = resolveGeo(m);
  const scale = o.kvScale > 0 ? o.kvScale : 1;
  const c = clampCtx(ctx);
  if (g.explicitKv) return g.explicitKv * c * scale;
  const geo = g.layers > 0 && g.kvHeads > 0 && g.keyLen > 0 && g.valLen > 0;
  if (!geo) return bucketKv(m) * c * scale;
  const bpl = g.kvHeads * (g.keyLen + g.valLen) * 2;
  let full = g.layers, swa = 0, cells = c;
  if (g.slidingWindow > 0 && !o.swaFull) {
    swa = Math.max(0, Math.min(g.layers, Math.round(g.swaLayers)));
    full = g.layers - swa;
    const seq = o.nSeq > 0 ? o.nSeq : 1;
    const ub = o.ubatch > 0 ? o.ubatch : 512;
    cells = Math.min(c, pad256(g.slidingWindow * seq + ub));
  }
  return (full * c + swa * cells) * bpl * scale;
}
// Bộ đệm đồ thị llama.cpp ở n_ubatch 512. Neo: gpt-oss-20b, 24 lớp, ctx 16384, compute 106,77 MiB (#81).
// Công thức cũ (300 MiB + ctx×24 KiB + 350 MiB) cộng KV lần nữa và một bộ đệm prompt ~1 GB — mô hình vừa VRAM bị ghi “Chạy chậm”.
// n_ubatch mặc định của llama.cpp. Logits f32 = ubatch × n_vocab × 4 (Qwen2.5-0.5B @ 8K: công thức không logits ~83 MiB, đo ~315 MiB).
const UBATCH = 512;
function computeBuf(ctx, layers, vocab) {
  const c = clampCtx(ctx);
  const L = Math.max(1, Number(layers) || 32);
  const V = pos(vocab);
  const logits = V > 0 ? UBATCH * V * 4 : 0;
  return Math.round((64 + c / 1024 + L * 0.45) * MiB + logits);
}
// Công thức cũ: 300 MiB + ctx×24 KiB, cộng 350 MiB runtime. Khoảng 1 GB ở 16K — giữ khi không biết hình học, vì bucket KV ước thiếu.
const RUNTIME = 350 * MiB;
function legacyOverhead(ctx) {
  const c = clampCtx(ctx);
  return 300 * MiB + c * 24 * 1024 + RUNTIME;
}
function graphBytes(m, ctx, g) {
  if (!geoKnown(m)) return legacyOverhead(ctx);
  // gpt-oss: token_embd/output nằm ở CPU, logits không chiếm VRAM.
  const vocab = g && g.cpuResident > 0 ? 0 : (g && g.vocab) || 0;
  return computeBuf(ctx, (g && g.layers) || 32, vocab);
}
// mô hình nhìn ảnh: bộ đệm mã hoá ảnh (ảnh chụp màn hình ~1 triệu điểm ảnh) ngoài trọng số mmproj
const VISION_BUF = 600 * MiB;
function weightSplit(m, g) {
  const file = Math.max(0, m.size || 0);
  const mm = Math.max(0, m.mmprojSize || 0);
  let cpu = g && g.cpuResident > 0 ? g.cpuResident : 0;
  if (cpu > file * 0.25) cpu = file * 0.25;
  return { file, mm, cpu, gpu: Math.max(0, file - cpu) };
}
// Một cách tính duy nhất cho Khám phá và Mô hình của tôi: gom thông tin mô hình (catalog / tệp đã cài / số đo thật) thành đầu vào của machineFit
// measured: { bytes, ctx } = VRAM tăng thật khi nạp trên máy này (main.js ghi lại sau mỗi lần nạp lên GPU)
const GEO_KEYS = ['layers', 'heads', 'kvHeads', 'embedding', 'keyLength', 'valueLength', 'headDim', 'slidingWindow', 'swaLayers', 'vocab', 'cpuResident'];
function metaOf({ catalog = null, size = 0, mmprojSize = null, file = '', kvPerToken = null, measured = null } = {}) {
  const out = {
    id: catalog ? catalog.id : null,
    file: file || (catalog && catalog.file) || '',
    arch: catalog && catalog.arch || null,
    quant: catalog && catalog.quant || null,
    size: size || (catalog && catalog.size) || 0,
    mmprojSize: mmprojSize != null ? mmprojSize : (catalog && catalog.mmproj ? catalog.mmproj.size || 0 : 0),
    params: (catalog && catalog.params) || (String(file).match(/(\d+(?:\.\d+)?)\s*[bB](?![a-z])/) || [])[0] || null,
    kvPerToken: kvPerToken || (catalog && catalog.kvPerToken) || null,
    measured: measured && measured.bytes > 0 ? measured : null,
  };
  if (catalog) for (const k of GEO_KEYS) if (catalog[k] != null) out[k] = catalog[k];
  return out;
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

function scratchOf(m, ctx, g) {
  return graphBytes(m, ctx, g) + (m.mmprojSize ? VISION_BUF : 0);
}
// gpuFit (loader) phải đưa hết lớp lên GPU thì mới được ghi “Nằm trọn trong VRAM”.
function loaderLayers(m, g, hw, ctx) {
  if (!g || !(g.layers > 0) || !hw || !hw.vram || !(hw.vram.total > 0)) return null;
  const kv = g.explicitKv || (g.kvHeads > 0 && g.keyLen > 0 && g.valLen > 0 ? g.layers * g.kvHeads * (g.keyLen + g.valLen) * 2 : 0);
  const n = require('./gguf').gpuFit({ fileSize: Math.max(0, m.size || 0), layers: g.layers, kvPerToken: kv }, { ctx, vram: hw.vram });
  if (n == null) return null;
  return { n, total: g.layers + 1 };
}

// m: { size, mmprojSize?, params?, kvPerToken?, id?, layers?, kvHeads?, keyLength?, slidingWindow? }; o: { ctx, kvScale?, swaFull? }
function machineFit(m, hw, o = {}) {
  if (!hw || !hw.ram) return null;
  const ctx = clampCtx(o.ctx);
  // B78: tệp quá nhỏ (GGUF giả/hỏng 2 KB từng được ước “Chạy mượt ~1000 token/giây”) — mô hình thật nhỏ nhất cũng ~100 MB
  if ((m.size || 0) < 16 * MiB) return { group: 'no', label: LABEL.no, level: 'big', hint: 'Tệp quá nhỏ, không phải mô hình dùng được (có thể tải lỗi hoặc tệp hỏng)', ctx, need: m.size || 0, vram: 0, ram: 0, tps: 0, measured: false, invalid: true };
  const g = resolveGeo(m);
  const w = weightSplit(m, g);
  const kv = kvCacheBytes(m, ctx, o);
  const scratch = scratchOf(m, ctx, g);
  let need = w.gpu + w.mm + kv + scratch;
  // có số đo thật trên máy này: dùng số đo, chỉ chỉnh phần KV và bộ đệm đổi theo ngữ cảnh
  const meas = m.measured && m.measured.bytes > 0 ? m.measured : null;
  if (meas) {
    const ctx0 = meas.ctx || ctx;
    need = Math.max(w.gpu + w.mm, meas.bytes + (kv - kvCacheBytes(m, ctx0, o)) + (graphBytes(m, ctx, g) - graphBytes(m, ctx0, g)));
  }
  const vramTotal = hw.gpu && hw.gpu !== 'metal' && hw.vram && hw.vram.total && !hw.vram.integratedOnly && !hw.cpuOnly ? hw.vram.total : 0;
  const vramBudget = vramTotal ? vramTotal - Math.max(600 * MiB, vramTotal * 0.06) : 0; // màn hình và Windows giữ một phần VRAM
  const ramBudget = Math.max(0, hw.ram * 0.85 - 1.5 * GB); // chừa cho hệ điều hành và ứng dụng khác
  const p = parseParams(m.params || m.sizeLabel, m.size);
  const readFrac = p.active && p.total ? Math.min(1, p.active / p.total) : 1; // MoE: mỗi token chỉ đọc phần hoạt động
  const perTok = (m.size || 0) * readFrac;
  let group, vramUse = 0, ramUse = 0, hint, tps, tight = false;
  // B163 (laptop thật Ryzen + RTX 3050 Ti 4 GB, beta.2.8): mô hình nhìn ảnh chạy bằng llama-server --fit trên GPU RỜI. Tính theo đúng cách
  // llama.cpp chia lớp: VRAM TRỐNG thật của GPU rời − lề --fit-target − bộ đệm tính toán, chia cho trọng số + K/V (có thể q8_0).
  // Phần lớp không vừa chạy bằng CPU. ≥ 90 % số lớp trên GPU → “Chạy mượt” (vd. Qwen3-VL 2B @8K, K/V q8_0: ~100 %).
  if (o.server && hw.gpu && hw.gpu !== 'metal' && vramTotal && !meas) {
    const kvS = kv; const free = Math.min(hw.vram.free || vramTotal, vramTotal);
    const graph = graphBytes(m, ctx, g);
    const avail = free - Math.max(1024 * MiB, (m.mmprojSize || 0) + 512 * MiB) - graph;
    const frac = Math.max(0, Math.min(1, avail / Math.max(1, w.gpu + kvS)));
    const off = (w.gpu + kvS) * (1 - frac); need = w.gpu + w.mm + kvS + graph;
    if (off > ramBudget) { group = 'no'; hint = 'Lớn hơn VRAM + RAM của máy'; tps = 0; ramUse = need; }
    else {
      group = frac >= 0.9 ? 'smooth' : 'slow'; vramUse = Math.min(need, free); ramUse = Math.round(off);
      const t = perTok * frac / (gpuBandwidth(hw) * EFF_GPU * GB) + perTok * (1 - frac) / (cpuBandwidth(hw) * EFF_CPU * GB) + TOK_OVH_GPU; tps = t ? 1 / t : 0;
      hint = frac >= 0.999 ? 'Nằm trọn trong VRAM' : `Khoảng ${Math.round(frac * 100)} % mô hình nằm trên GPU, phần còn lại chạy bằng CPU`;
      tight = group === 'smooth' && frac < 0.999 && (free - (w.gpu + kvS) * frac) < TIGHT_SLACK;
      if (tight) hint = 'Nằm trọn trong VRAM, sát giới hạn';
    }
    const r = { group, label: LABEL[group], level: group === 'smooth' ? 'fit' : group === 'slow' ? 'slow' : 'big', hint, ctx, need: Math.round(need), vram: Math.round(vramUse), ram: Math.round(ramUse),
      tps: tps ? Math.max(0.5, Math.round(tps * 10) / 10) : 0, measured: false, tight, gpuFrac: Math.round(frac * 100) / 100, server: true, kv: o.kvScale && o.kvScale < 1 ? 'q8_0' : 'f16',
      parts: { weights: Math.round(w.gpu), mmproj: Math.round(w.mm), kv: Math.round(kvS), compute: Math.round(graph), cpuResident: Math.round(w.cpu) } };
    if (m.measuredTps > 0 && group !== 'no') { r.tps = Math.round(m.measuredTps * 10) / 10; r.tpsMeasured = true; }
    return r;
  }
  if (hw.gpu === 'metal') {
    const mem = Math.max(hw.ram, (hw.vram && hw.vram.total) || 0);
    ramUse = need;
    const fitCap = mem * macFitFrac(mem), slowCap = mem * MAC_SLOW;
    if (need <= fitCap) { group = 'smooth'; tight = need > fitCap * MAC_TIGHT; hint = tight ? 'Vừa bộ nhớ hợp nhất của Mac, sát giới hạn' : 'Vừa bộ nhớ hợp nhất của Mac'; }
    else if (need <= slowCap) { group = 'slow'; hint = 'Gần hết bộ nhớ, máy có thể chậm'; }
    else { group = 'no'; hint = 'Lớn hơn bộ nhớ của máy'; }
    tps = perTok ? (cpuBandwidth(hw) * EFF_GPU * GB) / perTok : 0;
  } else if (vramTotal) {
    if (need <= vramBudget) {
      group = 'smooth'; vramUse = need; tight = (vramBudget - need) < TIGHT_SLACK;
      tps = perTok ? 1 / (perTok / (gpuBandwidth(hw) * EFF_GPU * GB) + TOK_OVH_GPU) : 0;
      hint = tight ? 'Nằm trọn trong VRAM, sát giới hạn' : 'Nằm trọn trong VRAM';
      const off = loaderLayers(m, g, hw, ctx);
      if (off && off.n < off.total) {
        const frac = off.n / off.total;
        hint = `Khoảng ${Math.round(frac * 100)} % mô hình nằm trên GPU, phần còn lại chạy bằng CPU`;
        if (frac < 0.9) {
          group = 'slow'; tight = false;
          const spill = (w.gpu + kv) * (1 - frac);
          ramUse = spill; vramUse = Math.max(0, need - spill);
        }
      }
    } else if (need <= vramBudget + ramBudget) {
      group = 'slow'; vramUse = vramBudget; ramUse = need - vramBudget;
      const onGpu = Math.max(0, Math.min(1, (vramBudget - kv - scratch) / Math.max(1, w.gpu + w.mm)));
      const t = perTok * onGpu / (gpuBandwidth(hw) * EFF_GPU * GB) + perTok * (1 - onGpu) / (cpuBandwidth(hw) * EFF_CPU * GB) + TOK_OVH_GPU;
      tps = t ? 1 / t : 0; hint = `Tràn ${(ramUse / 1024 ** 3).toFixed(1).replace('.', ',')} GB sang RAM, phần đó chạy bằng CPU`;
    } else { group = 'no'; hint = 'Lớn hơn VRAM + RAM của máy'; tps = 0; ramUse = need; }
  } else {
    // máy không có GPU rời: “mượt” khi vừa RAM và ước tính ≥ 10 token/giây trên CPU
    ramUse = need; tps = perTok ? 1 / (perTok / (cpuBandwidth(hw) * EFF_CPU * GB) + TOK_OVH_CPU) : 0;
    group = need > ramBudget ? 'no' : tps >= 10 ? 'smooth' : 'slow';
    hint = group === 'no' ? 'Lớn hơn RAM của máy' : group === 'smooth' ? 'Chạy bằng CPU, vừa RAM' : 'Chạy bằng CPU, khá chậm';
  }
  const r = { group, label: LABEL[group], level: group === 'smooth' ? 'fit' : group === 'slow' ? 'slow' : 'big', hint, ctx, tight,
    need: Math.round(need), vram: Math.round(vramUse), ram: Math.round(ramUse), tps: tps ? Math.max(0.5, Math.round(tps * 10) / 10) : 0, measured: !!meas,
    parts: { weights: Math.round(w.gpu), mmproj: Math.round(w.mm), kv: Math.round(kv), compute: Math.round(scratch), cpuResident: Math.round(w.cpu) } };
  if (m.measuredTps > 0 && group !== 'no') { r.tps = Math.round(m.measuredTps * 10) / 10; r.tpsMeasured = true; }
  // B78: số đo thật quá chậm (“Đo được 0,1 token/giây”) mà nhãn vẫn “Chạy mượt” → theo số đo: Chạy chậm
  if (r.tpsMeasured && r.tps < 5 && r.group === 'smooth') Object.assign(r, { group: 'slow', label: LABEL.slow, level: 'slow', tight: false, hint: `Đo được chỉ ~${String(r.tps).replace('.', ',')} token/giây trên máy này` });
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
module.exports = { GROUPS, LABEL, parseParams, strength, kvPerToken, kvCacheBytes, resolveGeo, computeBuf, metaOf, gpuBandwidth, machineFit, sortByFit, groupByFit, fmtFit, fitDetail };
