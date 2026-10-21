// AIVN — bộ nghe chạy trong cửa sổ ẩn (Chromium): giải mã âm thanh/video bằng bộ giải mã có sẵn của Chromium,
// chép lời bằng Whisper large-v3-turbo (ONNX, q4) qua transformers.js — WebGPU nếu có, không thì WASM nhiều luồng.
// Không có gì rời khỏi máy: mô hình đọc từ thư mục mô hình của AIVN (aivnm://models), tệp đọc qua aivnm://in/<mã dùng một lần>.
import { pipeline, env, Tensor } from './vendor/asr-bundle.mjs';

const MODEL = 'onnx-community/whisper-large-v3-turbo';
const SR = 16000, WIN = 30, CUT_SEARCH = 5;
env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = 'aivnm://models/'; env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = { mjs: 'aivnm://app/vendor/ort-wasm-simd-threaded.jsep.mjs', wasm: 'aivnm://app/vendor/ort-wasm-simd-threaded.jsep.wasm' };

let asr = null, asrDevice = null, loading = null;
const cancelled = new Set();
mediaIO.onCancel((id) => cancelled.add(id));
const check = (id) => { if (cancelled.has(id)) { const e = new Error('Đã huỷ'); e.code = 'cancel'; throw e; } };

async function gpuOk() { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; } }
async function loadAsr(pref, threads) {
  if (asr && (pref !== 'wasm' || asrDevice === 'wasm')) return asr;
  if (loading) return loading;
  loading = (async () => {
    env.backends.onnx.wasm.numThreads = threads;
    const dtype = { encoder_model: 'q4', decoder_model_merged: 'q4' };
    if (pref !== 'wasm' && await gpuOk()) {
      try { asr = await pipeline('automatic-speech-recognition', MODEL, { dtype, device: 'webgpu' }); asrDevice = 'webgpu'; return asr; } catch (e) { console.warn('webgpu lỗi, dùng WASM:', e && e.message); }
    }
    asr = await pipeline('automatic-speech-recognition', MODEL, { dtype, device: 'wasm' }); asrDevice = 'wasm'; return asr;
  })();
  try { return await loading; } finally { loading = null; }
}

// Giải mã cả tệp → 16 kHz một kênh. decodeAudioData của OfflineAudioContext 16 kHz tự đổi tần số lấy mẫu.
async function decodeAudio(src) {
  const buf = await (await fetch(src)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, SR);
  const ab = await ctx.decodeAudioData(buf);
  const n = ab.length, ch = ab.numberOfChannels; const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
  return out;
}
const rms = (a, s, e) => { let t = 0; for (let i = s; i < e; i++) t += a[i] * a[i]; return Math.sqrt(t / Math.max(1, e - s)); };
// Cắt cửa sổ ~30 s tại chỗ lặng nhất trong 5 s cuối để không cắt đôi một từ
function windows(a) {
  const out = []; let s = 0; const W = WIN * SR, S = CUT_SEARCH * SR, step = SR / 10;
  while (s < a.length) {
    let e = Math.min(a.length, s + W);
    if (e < a.length) { let best = e, bv = Infinity; for (let p = e - S; p + step <= e; p += step) { const v = rms(a, p, p + step); if (v < bv) { bv = v; best = p + step / 2; } } e = Math.round(best); }
    out.push([s, e]); s = e;
  }
  return out;
}
// Whisper trong transformers.js không tự nhận ngôn ngữ (mặc định tiếng Anh → "dịch" luôn sang tiếng Anh).
// Tự nhận: một bước giải mã sau <|startoftranscript|>, chọn mã ngôn ngữ có logit cao nhất trên đoạn có tiếng đầu tiên.
async function detectLang(p, chunk) {
  const gc = p.model.generation_config; const l2i = gc && gc.lang_to_id; if (!l2i) return null;
  const { input_features } = await p.processor(chunk);
  const dec = new Tensor('int64', BigInt64Array.of(BigInt(gc.decoder_start_token_id)), [1, 1]);
  const o = await p.model({ input_features, decoder_input_ids: dec });
  const lg = o.logits; const V = lg.dims[lg.dims.length - 1]; const data = lg.data; const base = data.length - V;
  let best = null, bv = -Infinity;
  for (const [tok, id] of Object.entries(l2i)) { const v = data[base + id]; if (v > bv) { bv = v; best = tok; } }
  return best ? best.replace(/^<\|/, '').replace(/\|>$/, '') : null;
}
// Câu "ảo giác" quen thuộc của Whisper trên đoạn lặng/nhạc nền
const HALLU = /^(hãy subscribe|đăng ký kênh|cảm ơn các bạn đã (theo dõi|xem)|thanks for watching|subtitles by|字幕|請不吝|ご視聴)/i;

async function transcribe(id, src, opt) {
  mediaIO.progress(id, { stage: 'decode' });
  let audio;
  try { audio = await decodeAudio(src); } catch (e) { if (opt.kind === 'video') return { duration: null, segments: [], noAudio: true }; throw Object.assign(new Error('Không giải mã được âm thanh: ' + (e && e.message || e)), { code: 'decode' }); }
  check(id);
  const total = audio.length / SR; const maxS = Math.min(audio.length, Math.round((opt.maxSec || 7200) * SR));
  const ws = windows(audio.subarray(0, maxS));
  mediaIO.progress(id, { stage: 'load' });
  const t0 = performance.now();
  const p = await loadAsr(opt.device, opt.threads || 4);
  const loadMs = Math.round(performance.now() - t0);
  let language = opt.language || null, detected = null;
  if (!language) {
    const first = ws.find(([a, b]) => rms(audio, a, b) >= 0.004);
    if (first) { try { detected = await detectLang(p, audio.subarray(first[0], first[1])); } catch (e) { console.warn('nhận ngôn ngữ lỗi:', e && e.message); } }
    language = detected || opt.fallbackLanguage || null;
  }
  const segs = []; let last = '';
  for (let k = 0; k < ws.length; k++) {
    check(id);
    mediaIO.progress(id, { stage: 'asr', done: k, total: ws.length, sec: Math.round(ws[k][0] / SR), of: Math.round(maxS / SR), device: asrDevice });
    const [s, e] = ws[k]; const chunk = audio.subarray(s, e);
    if (rms(chunk, 0, chunk.length) < 0.004) continue; // lặng → bỏ (Whisper hay bịa chữ trên đoạn lặng)
    const r = await p(chunk, { task: 'transcribe', return_timestamps: true, ...(language ? { language } : {}) });
    for (const c of (r.chunks && r.chunks.length ? r.chunks : [{ timestamp: [0, (e - s) / SR], text: r.text }])) {
      const t = String(c.text || '').trim(); if (!t || HALLU.test(t) || t === last) continue; last = t;
      const a0 = s / SR + (c.timestamp[0] || 0), a1 = s / SR + (c.timestamp[1] != null ? c.timestamp[1] : (e - s) / SR);
      segs.push({ start: +a0.toFixed(2), end: +Math.min(a1, e / SR).toFixed(2), text: t });
    }
  }
  return { duration: +total.toFixed(2), segments: segs, truncated: maxS < audio.length, device: asrDevice, language, detected, loadMs, asrMs: Math.round(performance.now() - t0 - loadMs) };
}

// Khung hình đại diện của video (cách đều), cạnh dài ≤ 1024 px, JPEG
async function frames(id, src, n) {
  mediaIO.progress(id, { stage: 'frames' });
  const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; v.src = src;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Không mở được video (định dạng/codec chưa hỗ trợ)')); setTimeout(() => rej(new Error('Mở video quá lâu')), 20000); });
  const dur = v.duration; const out = [];
  if (!isFinite(dur) || !v.videoWidth) return { duration: isFinite(dur) ? dur : null, frames: [], width: 0, height: 0 };
  const sc = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight)); const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc);
  const g = c.getContext('2d');
  for (let i = 0; i < n; i++) {
    check(id);
    const t = Math.min(dur - 0.05, (i + 0.5) * dur / n);
    await new Promise((res) => { const done = () => { v.onseeked = null; res(); }; v.onseeked = done; v.currentTime = Math.max(0, t); setTimeout(done, 8000); });
    g.drawImage(v, 0, 0, c.width, c.height); out.push({ at: +t.toFixed(2), url: c.toDataURL('image/jpeg', 0.85) });
  }
  v.removeAttribute('src'); v.load();
  return { duration: dur, frames: out, width: v.videoWidth, height: v.videoHeight };
}

mediaIO.onJob(async (j) => {
  try {
    const r = { kind: j.kind };
    if (j.kind === 'video' && j.frames > 0) { try { Object.assign(r, await frames(j.id, j.src, j.frames)); } catch (e) { if (e.code === 'cancel') throw e; r.frameError = e.message; r.frames = []; } }
    const vDur = r.duration; const t = await transcribe(j.id, j.src, j);
    Object.assign(r, t, { duration: t.duration || vDur || (t.segments.length ? t.segments[t.segments.length - 1].end : null) });
    mediaIO.result(j.id, r);
  } catch (e) { mediaIO.fail(j.id, e && e.message || String(e), e && e.code); }
  finally { cancelled.delete(j.id); }
});
mediaIO.ready({ coi: self.crossOriginIsolated, threads: navigator.hardwareConcurrency, gpu: !!navigator.gpu });
