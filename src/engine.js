// Bộ máy suy luận: bọc node-llama-cpp
const path = require('path');
const os = require('os');

let lib = null;           // module node-llama-cpp (ESM)
let llama = null;         // instance Llama
let current = null;       // { id, path, model, context }
let loading = null;       // promise khi đang nạp
let queue = Promise.resolve(); // tuần tự hoá các yêu cầu sinh văn bản
let vision = null;        // llama-server (mmproj) khi mô hình nhìn được ảnh
let visionOn = false;
let embedder = null;      // { id, path, model, ctx, prefix }
let embedQueue = Promise.resolve();
function getVision() { if (!vision) vision = require('./vision-server').createVisionServer({ log: (m) => console.log(m) }); return vision; }

async function getLib() { if (!lib) lib = await import('node-llama-cpp'); return lib; }

async function getLlama() {
  if (llama) return llama;
  const { getLlama } = await getLib();
  try { llama = await getLlama({ gpu: 'auto' }); }
  catch (e) { console.warn('GPU không khả dụng, chuyển sang CPU:', e.message); llama = await getLlama({ gpu: false }); }
  return llama;
}

async function hardwareInfo() {
  const l = await getLlama();
  let vram = null;
  try { const v = await l.getVramState(); vram = { total: v.total, free: v.free }; } catch {}
  return { gpu: l.gpu || false, vram, ram: os.totalmem(), freeRam: os.freemem(), cpus: os.cpus().length, platform: process.platform };
}

async function loadModel(id, modelPath, opts = {}) {
  if (!opts.mmproj && current && current.path === modelPath) return status();
  if (opts.mmproj && visionOn && getVision().status()?.path === modelPath) return status();
  if (loading) await loading.catch(() => {});
  if (opts.mmproj) {
    loading = (async () => {
      await unloadModel();
      const l = await getLlama().catch(() => null);
      await getVision().start({ id, modelPath, mmprojPath: opts.mmproj, contextSize: opts.contextSize || 4096, gpu: !!(l && l.gpu) });
      visionOn = true;
    })();
    try { await loading; } finally { loading = null; }
    return status();
  }
  loading = (async () => {
    await unloadModel();
    const l = await getLlama();
    const model = await l.loadModel({ modelPath, gpuLayers: 'auto' });
    let context;
    try {
      context = await model.createContext({ contextSize: { min: 512, max: opts.contextSize || 4096 } });
    } catch (e) { await model.dispose(); throw e; }
    current = { id, path: modelPath, model, context, loadedAt: Date.now() };
  })();
  try { await loading; } finally { loading = null; }
  return status();
}

async function unloadModel() {
  if (visionOn) { visionOn = false; await queue.catch(() => {}); await getVision().stop(); }
  if (!current) return;
  const c = current; current = null;
  await queue.catch(() => {});
  try { await c.context.dispose(); } catch {}
  try { await c.model.dispose(); } catch {}
}

function status() {
  if (visionOn) { const v = getVision().status(); if (v) return { loaded: true, id: v.id, path: v.path, contextSize: v.contextSize, vision: true, gpu: llama && llama.gpu }; }
  return current ? { loaded: true, id: current.id, path: current.path, contextSize: current.context.contextSize, gpu: llama && llama.gpu } : { loaded: false, loading: !!loading };
}

function normalizeContent(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p && p.type === 'text' ? p.text : '')).join(''); // mô hình chữ: bỏ phần ảnh
  return c == null ? '' : String(c);
}

/**
 * Sinh câu trả lời từ danh sách messages kiểu OpenAI.
 * onToken(text) được gọi cho từng đoạn văn bản. Trả về { text, usage, finishReason }.
 */
function generate(messages, { temperature = 0.7, maxTokens = 1024, topP, signal, onToken } = {}) {
  const run = async () => {
    if (visionOn) return getVision().generate(messages, { temperature, maxTokens, topP, signal, onToken });
    if (!current) throw new Error('Chưa nạp mô hình nào.');
    const { LlamaChatSession } = await getLib();
    const msgs = messages.map(m => ({ role: m.role, content: normalizeContent(m.content) }));
    const system = msgs.filter(m => m.role === 'system' || m.role === 'developer').map(m => m.content).join('\n\n');
    const rest = msgs.filter(m => m.role === 'user' || m.role === 'assistant');
    let lastUserIdx = -1;
    for (let i = rest.length - 1; i >= 0; i--) if (rest[i].role === 'user') { lastUserIdx = i; break; }
    if (lastUserIdx < 0) throw new Error('Cần ít nhất một tin nhắn của người dùng.');
    const prompt = rest[lastUserIdx].content;
    const history = [];
    if (system) history.push({ type: 'system', text: system });
    for (const m of rest.slice(0, lastUserIdx)) {
      history.push(m.role === 'user' ? { type: 'user', text: m.content } : { type: 'model', response: [m.content] });
    }
    const sequence = current.context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence, autoDisposeSequence: false });
    if (history.length) session.setChatHistory(history);
    const t0 = Date.now();
    let text = '';
    let finishReason = 'stop';
    try {
      const res = await session.promptWithMeta(prompt, {
        temperature, topP, maxTokens, signal, stopOnAbortSignal: true,
        onTextChunk: (chunk) => { text += chunk; onToken && onToken(chunk); },
      });
      if (res && res.stopReason === 'maxTokens') finishReason = 'length';
      if (res && res.stopReason === 'abort') finishReason = 'abort';
      if (res && typeof res.responseText === 'string') text = res.responseText;
      text = text.replace(/^\s+/, '');
    } catch (e) {
      if (!(signal && signal.aborted)) throw e;
      finishReason = 'abort';
    } finally {
      session.dispose({ disposeSequence: false });
      sequence.dispose();
    }
    const completionTokens = current ? current.model.tokenize(text).length : 0;
    const secs = (Date.now() - t0) / 1000;
    return { text, finishReason, usage: { completion_tokens: completionTokens, tokensPerSecond: secs > 0 ? completionTokens / secs : 0, seconds: secs } };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---- Nhúng văn bản (embedding) cho tìm kiếm ngữ nghĩa trong tài liệu (RAG) ----
async function loadEmbedder(id, modelPath, { prefix = null } = {}) {
  if (embedder && embedder.path === modelPath) return embedStatus();
  await unloadEmbedder();
  const l = await getLlama();
  const model = await l.loadModel({ modelPath, gpuLayers: 0 }); // mô hình nhúng nhỏ: chạy CPU để không tranh VRAM với mô hình chat
  let ctx;
  try { ctx = await model.createEmbeddingContext({ contextSize: Math.min(model.trainContextSize || 512, 2048) }); }
  catch (e) { await model.dispose(); throw e; }
  embedder = { id, path: modelPath, model, ctx, prefix, dims: null, maxTokens: Math.min(model.trainContextSize || 512, 2048) };
  return embedStatus();
}
async function unloadEmbedder() {
  if (!embedder) return;
  const e = embedder; embedder = null; await embedQueue.catch(() => {});
  try { await e.ctx.dispose(); } catch {} try { await e.model.dispose(); } catch {}
}
function embedCount(texts) { if (!embedder) throw new Error('Chưa nạp mô hình nhúng.'); return texts.map(t => embedder.model.tokenize(String(t)).length); }
function embedStatus() { return embedder ? { loaded: true, id: embedder.id, dims: embedder.dims, maxTokens: embedder.maxTokens } : { loaded: false }; }
// kind: 'query' | 'passage' (mô hình e5 cần tiền tố riêng). Trả mảng Float32 đã chuẩn hoá L2.
function embed(texts, kind = 'passage') {
  const run = async () => {
    if (!embedder) throw new Error('Chưa nạp mô hình nhúng.');
    const pre = embedder.prefix ? (embedder.prefix[kind] || '') : '';
    const out = [];
    for (const t of texts) {
      let s = pre + String(t);
      // cắt bớt nếu dài hơn ngữ cảnh của mô hình nhúng
      let toks = embedder.model.tokenize(s);
      if (toks.length > embedder.maxTokens - 4) s = embedder.model.detokenize(toks.slice(0, embedder.maxTokens - 4));
      const v = (await embedder.ctx.getEmbeddingFor(s)).vector;
      let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
      const f = Float32Array.from(v, x => x / n);
      embedder.dims = f.length; out.push(f);
    }
    return out;
  };
  const p = embedQueue.then(run, run); embedQueue = p.catch(() => {}); return p;
}

function countTokens(text) { if (!current) return Math.ceil(text.length / 3); try { return current.model.tokenize(text).length; } catch { return Math.ceil(text.length / 3); } }

async function countTokensAsync(texts) { if (visionOn) { const r = await getVision().countTokens(texts); if (r) return r; } return texts.map(countTokens); }
module.exports = { countTokens, countTokensAsync, hardwareInfo, loadModel, unloadModel, status, generate, getLlama, loadEmbedder, unloadEmbedder, embedStatus, embed, embedCount };
