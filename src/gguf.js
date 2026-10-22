// Đọc siêu dữ liệu GGUF (chỉ phần đầu tệp, không đọc trọng số) — tự viết, không phụ thuộc bộ máy AI.
// Dùng cho hộp nạp mô hình: số lớp, ngữ cảnh huấn luyện, kích thước bộ đệm K/V mỗi token, kiến trúc, tên, mẫu chat.
'use strict';
const fs = require('fs');

const T = { U8: 0, I8: 1, U16: 2, I16: 3, U32: 4, I32: 5, F32: 6, BOOL: 7, STR: 8, ARR: 9, U64: 10, I64: 11, F64: 12 };
const FIXED = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

class Reader {
  constructor(fd, size) { this.fd = fd; this.size = size; this.buf = Buffer.alloc(0); this.bufPos = 0; this.pos = 0; }
  ensure(n) {
    if (this.buf.length - this.bufPos >= n) return;
    const rest = this.buf.subarray(this.bufPos);
    const want = Math.max(n - rest.length, 1 << 20);
    const chunk = Buffer.alloc(want); const got = fs.readSync(this.fd, chunk, 0, want, this.pos + this.bufPos + rest.length);
    if (rest.length + got < n) throw new Error('GGUF: hết tệp khi đang đọc siêu dữ liệu');
    this.buf = Buffer.concat([rest, chunk.subarray(0, got)]); this.pos += this.bufPos; this.bufPos = 0;
  }
  take(n) { this.ensure(n); const b = this.buf.subarray(this.bufPos, this.bufPos + n); this.bufPos += n; return b; }
  skip(n) { // nhảy qua n byte (vd. mảng token khổng lồ) mà không giữ trong bộ nhớ
    const have = this.buf.length - this.bufPos;
    if (n <= have) { this.bufPos += n; return; }
    const abs = this.pos + this.bufPos + n; this.buf = Buffer.alloc(0); this.bufPos = 0; this.pos = abs;
  }
  u32() { return this.take(4).readUInt32LE(0); }
  u64() { const b = this.take(8); const v = b.readBigUInt64LE(0); if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GGUF: số quá lớn'); return Number(v); }
  str(limit = 1 << 20) { const n = this.u64(); if (n > 64 << 20) throw new Error('GGUF: chuỗi quá dài'); if (n > limit) { this.skip(n); return null; } return this.take(n).toString('utf8'); }
  scalar(t) {
    switch (t) {
      case T.U8: return this.take(1).readUInt8(0); case T.I8: return this.take(1).readInt8(0);
      case T.U16: return this.take(2).readUInt16LE(0); case T.I16: return this.take(2).readInt16LE(0);
      case T.U32: return this.u32(); case T.I32: return this.take(4).readInt32LE(0);
      case T.F32: return this.take(4).readFloatLE(0); case T.BOOL: return this.take(1).readUInt8(0) !== 0;
      case T.U64: return this.u64(); case T.I64: return Number(this.take(8).readBigInt64LE(0)); case T.F64: return this.take(8).readDoubleLE(0);
      case T.STR: return this.str();
      default: throw new Error('GGUF: kiểu không rõ ' + t);
    }
  }
}

const FILE_TYPES = { 0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1', 10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 19: 'IQ2_XXS', 20: 'IQ2_XS', 21: 'Q2_K_S', 22: 'IQ3_XS', 23: 'IQ3_XXS', 24: 'IQ1_S', 25: 'IQ4_NL', 26: 'IQ3_S', 27: 'IQ3_M', 28: 'IQ2_S', 29: 'IQ2_M', 30: 'IQ4_XS', 31: 'IQ1_M', 32: 'BF16', 36: 'TQ1_0', 37: 'TQ2_0', 38: 'MXFP4' };

// Trả về các khoá cần thiết. Mảng (vd. tokenizer.ggml.tokens) chỉ được bỏ qua, trừ khi là mảng số nhỏ (vd. head_count_kv theo lớp).
function readMeta(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const r = new Reader(fd, size);
    if (r.take(4).toString('latin1') !== 'GGUF') throw new Error('Không phải tệp GGUF');
    const version = r.u32(); if (version < 2 || version > 3) throw new Error('Phiên bản GGUF không hỗ trợ: ' + version);
    const tensors = r.u64(); const kvCount = r.u64();
    if (kvCount > 100000) throw new Error('GGUF: quá nhiều khoá');
    const kv = {};
    for (let i = 0; i < kvCount; i++) {
      const key = r.str(4096); const t = r.u32();
      if (t === T.ARR) {
        const at = r.u32(); const n = r.u64();
        if (at === T.STR) { for (let j = 0; j < n; j++) { const len = r.u64(); r.skip(len); } kv[key] = { array: true, length: n }; }
        else if (FIXED[at] != null) {
          if (n <= 1024) { const a = []; for (let j = 0; j < n; j++) a.push(r.scalar(at)); kv[key] = a; } else { r.skip(n * FIXED[at]); kv[key] = { array: true, length: n }; }
        } else throw new Error('GGUF: mảng lồng nhau không hỗ trợ');
      } else if (t === T.STR && key === 'tokenizer.chat_template') { const s = r.str(256 << 10); kv[key] = s; }
      else kv[key] = r.scalar(t);
    }
    return { version, tensors, kv, size };
  } finally { fs.closeSync(fd); }
}

const num = (v) => Array.isArray(v) ? Math.max(...v.map(Number).filter(Number.isFinite)) : (Number.isFinite(Number(v)) ? Number(v) : null);
// Tóm tắt thông số hữu ích cho người dùng và cho ước lượng bộ nhớ
function summarize(file) {
  const { kv, size, tensors } = readMeta(file);
  const arch = kv['general.architecture'] || null;
  const g = (k) => kv[`${arch}.${k}`];
  const layers = num(g('block_count'));
  const heads = num(g('attention.head_count'));
  const kvHeads = num(g('attention.head_count_kv')) || heads;
  const emb = num(g('embedding_length'));
  const keyLen = num(g('attention.key_length')) || (emb && heads ? emb / heads : null);
  const valLen = num(g('attention.value_length')) || keyLen;
  const kvPerToken = layers && kvHeads && keyLen ? layers * kvHeads * (keyLen + valLen) * 2 : null; // f16, byte/token
  const tpl = typeof kv['tokenizer.chat_template'] === 'string' ? kv['tokenizer.chat_template'] : '';
  const ft = kv['general.file_type'];
  return {
    arch, name: kv['general.name'] || kv['general.basename'] || null, sizeLabel: kv['general.size_label'] || null,
    organization: kv['general.organization'] || null, license: kv['general.license'] || null,
    quant: ft != null ? (FILE_TYPES[ft] || null) : null,
    layers, trainCtx: num(g('context_length')), embedding: emb, heads, kvHeads, kvPerToken,
    experts: num(g('expert_count')) || null, splitCount: num(kv['split.count']) || 1,
    hasTemplate: !!tpl, templateTools: /\btools\b/.test(tpl), tensors, fileSize: size,
  };
}

// Ước lượng bộ nhớ khi nạp: phần trọng số trên GPU tỉ lệ số lớp; bộ đệm K/V của các lớp trên GPU nằm trên GPU (mặc định llama.cpp)
const MB = 1024 * 1024;
const GB = 1024 * MB;
// Số lớp tối đa đưa lên GPU mà vẫn giữ trọn ngữ cảnh: mỗi lớp trên GPU mang theo trọng số + bộ đệm K/V của lớp đó (mặc định llama.cpp).
// Dùng chung cho engine.loadPlans (khi nạp thật) và hộp nạp (ước lượng hiển thị) để hai bên luôn khớp nhau.
const computeBuf = (ctx) => 300 * MB + ctx * 2048;
// B190: tệp GGUF lớn hơn phần trọng số thật sự nằm trên GPU (siêu dữ liệu, căn chỉnh). 0,86 khớp phép đo llama.cpp
// trên RTX 4070 SUPER 12 GB — Qwen3-14B Q4 dự kiến ~10,6 GB và nạp đủ 41/41 @ 16384; gpt-oss-20b MXFP4 đủ 25/25.
const WEIGHT_PACK = 0.86;
// Lề trống: khoảng 5 % VRAM, kẹp 300–512 MiB. Không còn giữ 8 % + ~1 GiB (công thức cũ để 14B ở 37/41).
const headroomBytes = (total) => Math.min(512 * MB, Math.max(300 * MB, (total || 0) * 0.05));
const FIT_FLOOR = 256 * MB; // chỉ offload trọn khi nhu cầu còn dưới VRAM trống ít nhất chừng này
function freeBytes(vram) {
  if (!vram || !(vram.total > 0)) return 0;
  return Math.max(0, Math.min(vram.free || vram.total, vram.total));
}
// n = số lớp vừa ngân sách; confident = trọng số + KV + bộ đệm tính toán còn dưới VRAM trống (trừ FIT_FLOOR).
function fitCount({ fileSize, layers, kvPerToken }, { ctx = 8192, kvScale = 1, vram = null } = {}) {
  const L = (layers || 32) + 1;
  const free = freeBytes(vram);
  const scratch = computeBuf(ctx);
  const weights = (fileSize || 0) * WEIGHT_PACK;
  const kv = kvPerToken && layers ? kvPerToken * ctx * kvScale : 400 * MB * kvScale;
  const per = weights / L + kv / (layers || L);
  const avail = free - headroomBytes(vram.total) - scratch;
  let n = per > 0 ? Math.floor(Math.max(0, avail) / per) : 0;
  n = Math.max(0, Math.min(L, n));
  const fullCost = weights + kv + scratch;
  const confident = fullCost > 0 && fullCost <= free - FIT_FLOOR;
  if (confident) n = L;
  const used = (n / L) * weights + kv * (layers ? Math.min(1, n / layers) : n / L) + (n ? scratch : 0);
  return { n, L, confident, used, free, kvBytes: kv };
}
function gpuFit(model, opts = {}) {
  if (!opts.vram || !(opts.vram.total > 0)) return null;
  return fitCount(model, opts).n;
}
// B190: thứ tự ưu tiên — trọn lớp + đúng ngữ cảnh (KV đang dùng) → trọn lớp với KV q8_0 nếu được phép → một phần.
// q8_0 tự bật chỉ khi GPU rời dưới 6 GB (B163), hoặc khi người gọi đặt allowQ8. KV f16 người dùng chọn thì không đổi.
function chooseOffload(model, { ctx = 8192, kvType, kvScale, vram = null, allowQ8 } = {}) {
  const L = (model.layers || 32) + 1;
  const scale = kvScale != null ? kvScale : (kvType === 'q8_0' ? 0.55 : 1);
  if (!vram || !(vram.total > 0)) return { gpuLayers: L, totalLayers: L, kv: scale < 0.9 ? 'q8_0' : 'f16', confident: false, used: 0, free: 0 };
  const allow = allowQ8 != null ? !!allowQ8 : (kvType !== 'f16' && scale >= 0.9 && vram.total < 6 * GB);
  const cur = fitCount(model, { ctx, kvScale: scale, vram });
  const pack = (r, kv) => ({ gpuLayers: r.n, totalLayers: r.L, kv, confident: r.confident, used: r.used, free: r.free });
  if (cur.confident || cur.n >= cur.L) return pack(cur, scale < 0.9 ? 'q8_0' : 'f16');
  if (allow) {
    const q8 = fitCount(model, { ctx, kvScale: 0.55, vram });
    if (q8.confident) return pack(q8, 'q8_0');
  }
  return pack(cur, scale < 0.9 ? 'q8_0' : 'f16');
}
// B170: mô hình nhìn ảnh chạy bằng llama-server; số lớp GPU do --fit của llama-server chọn: VRAM TRỐNG của đúng thiết bị đó
// trừ lề --fit-target (AIVN đặt rõ = serverMarginMiB) trừ bộ đệm tính toán; mmproj nạp SAU nên nằm trong lề.
// GPU dưới 8 GB giữ lề cũ (tối thiểu 1024 MiB) — laptop 4 GB đo thật 16/37 @16K. GPU lớn: lề 300–512 MiB + mmproj, không còn sàn 1 GiB.
const serverMarginMiB = (mmprojBytes = 0, vram = null) => {
  const mm = Math.round((mmprojBytes || 0) / MB);
  const big = vram && vram.total >= 8 * GB;
  if (!big) return Math.max(1024, mm + 512);
  return Math.round(headroomBytes(vram.total) / MB) + mm;
};
function serverFit({ fileSize, layers, kvPerToken }, { ctx = 8192, kvScale = 1, vram = null, mmprojBytes = 0 } = {}) {
  const L = (layers || 32) + 1;
  if (!vram || !(vram.total > 0)) return null;
  const avail = freeBytes(vram) - serverMarginMiB(mmprojBytes, vram) * MB - computeBuf(ctx);
  const perLayer = fileSize / L;
  const kvPerLayer = kvPerToken && layers ? kvPerToken * ctx * kvScale / layers : 400 * MB * kvScale / L;
  return Math.max(0, Math.min(L, Math.floor(Math.max(0, avail) / (perLayer + kvPerLayer))));
}
function autoLayers(g, o = {}) {
  if (o.server) {
    const kvScale = o.kvType === 'q8_0' || o.kvScale < 0.9 ? 0.55 : 1;
    const n = serverFit(g, { ctx: o.ctx, kvScale, vram: o.vram, mmprojBytes: o.server.mmprojBytes || 0 });
    return n == null ? (g.layers || 32) + 1 : n;
  }
  return chooseOffload(g, o).gpuLayers;
}
function estimate(g, o = {}) {
  const { fileSize, layers, kvPerToken } = g; let { ctx = 8192, kvType = 'f16', gpu = true } = o;
  let { gpuLayers = 0 } = o; const auto = gpuLayers === 'auto' || gpuLayers == null;
  if (auto && gpu && !o.server) {
    const d = chooseOffload(g, o);
    gpuLayers = d.gpuLayers;
    if (d.kv === 'q8_0' && kvType !== 'f16') kvType = 'q8_0';
  } else if (auto) gpuLayers = gpu ? autoLayers(g, o) : 0;
  const L = (layers || 32) + 1; // + lớp đầu ra
  const n = gpu ? Math.max(0, Math.min(L, gpuLayers)) : 0;
  const frac = n / L;
  const kvScale = kvType === 'q8_0' ? 0.55 : 1;
  const kv = (kvPerToken || 0) * ctx * kvScale;
  const kvGpuFrac = layers ? Math.min(1, n / layers) : frac;
  const compute = computeBuf(ctx); // bộ đệm tính toán (ước chừng)
  const mmGpu = o.server && n ? (o.server.mmprojBytes || 0) : 0; // phần nhìn ảnh (mmproj) cũng nằm trên GPU
  const vram = n ? fileSize * frac + kv * kvGpuFrac + compute + mmGpu : 0;
  const ram = fileSize * (1 - frac) + kv * (1 - kvGpuFrac) + (n ? 150 * 1024 * 1024 : compute);
  return { vram: Math.round(vram), ram: Math.round(ram), kv: Math.round(kv), gpuLayers: n, totalLayers: L, auto };
}

const cache = new Map();
function cachedSummary(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const key = file + ':' + st.size + ':' + st.mtimeMs;
  if (cache.has(key)) return cache.get(key);
  let v; try { v = summarize(file); } catch (e) { v = { error: e.message }; }
  cache.set(key, v); return v;
}

module.exports = { serverMarginMiB, serverFit, readMeta, summarize, estimate, autoLayers, gpuFit, chooseOffload, fitCount, headroomBytes, computeBuf, cachedSummary, FILE_TYPES, WEIGHT_PACK };
