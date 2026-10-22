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
// Số lớp tối đa đưa lên GPU mà vẫn giữ trọn ngữ cảnh: mỗi lớp trên GPU mang theo trọng số + bộ đệm K/V của lớp đó (mặc định llama.cpp).
// Dùng chung cho engine.loadPlans (khi nạp thật) và hộp nạp (ước lượng hiển thị) để hai bên luôn khớp nhau.
const computeBuf = (ctx) => 300 * MB + ctx * 2048;
function gpuFit({ fileSize, layers, kvPerToken }, { ctx = 8192, kvScale = 1, vram = null } = {}) {
  const L = (layers || 32) + 1;
  if (!vram || !(vram.total > 0)) return null;
  const avail = Math.min(vram.free || vram.total, vram.total) * 0.92 - computeBuf(ctx);
  const perLayer = fileSize / L;
  const kvPerLayer = kvPerToken && layers ? kvPerToken * ctx * kvScale / layers : 400 * MB * kvScale / L;
  return Math.max(0, Math.min(L, Math.floor(avail / (perLayer + kvPerLayer))));
}
// B170: mô hình nhìn ảnh chạy bằng llama-server; số lớp GPU do --fit của llama-server chọn: VRAM TRỐNG của đúng thiết bị đó
// trừ lề --fit-target (AIVN đặt rõ = serverMarginMiB) trừ bộ đệm tính toán; mmproj nạp SAU nên nằm trong lề.
// Hộp nạp dùng đúng công thức này (trước đây dùng 92 % VRAM, không trừ lề 1 GiB của llama.cpp → báo 23/37 trong khi thật là 16/37).
const serverMarginMiB = (mmprojBytes = 0) => Math.max(1024, Math.round((mmprojBytes || 0) / MB) + 512);
function serverFit({ fileSize, layers, kvPerToken }, { ctx = 8192, kvScale = 1, vram = null, mmprojBytes = 0 } = {}) {
  const L = (layers || 32) + 1;
  if (!vram || !(vram.total > 0)) return null;
  const avail = Math.min(vram.free || vram.total, vram.total) - serverMarginMiB(mmprojBytes) * MB - computeBuf(ctx);
  const perLayer = fileSize / L;
  const kvPerLayer = kvPerToken && layers ? kvPerToken * ctx * kvScale / layers : 400 * MB * kvScale / L;
  return Math.max(0, Math.min(L, Math.floor(avail / (perLayer + kvPerLayer))));
}
function autoLayers(g, { ctx = 8192, kvType = 'f16', vram = null, server = null } = {}) {
  const kvScale = kvType === 'q8_0' ? 0.55 : 1;
  const n = server ? serverFit(g, { ctx, kvScale, vram, mmprojBytes: server.mmprojBytes || 0 }) : gpuFit(g, { ctx, kvScale, vram });
  return n == null ? (g.layers || 32) + 1 : n;
}
function estimate(g, o = {}) {
  const { fileSize, layers, kvPerToken } = g; const { ctx = 8192, kvType = 'f16', gpu = true } = o;
  let { gpuLayers = 0 } = o; const auto = gpuLayers === 'auto' || gpuLayers == null;
  if (auto) gpuLayers = gpu ? autoLayers(g, o) : 0;
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

module.exports = { serverMarginMiB, serverFit, readMeta, summarize, estimate, autoLayers, gpuFit, computeBuf, cachedSummary, FILE_TYPES };
