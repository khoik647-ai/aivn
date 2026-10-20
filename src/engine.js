// Bộ máy suy luận: bọc node-llama-cpp
const path = require('path');
const os = require('os');

let lib = null;           // module node-llama-cpp (ESM)
let llama = null;         // instance Llama
let current = null;       // { id, path, model, context }
let loading = null;       // promise khi đang nạp
let queue = Promise.resolve(); // tuần tự hoá các yêu cầu sinh văn bản

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
  if (current && current.path === modelPath) return status();
  if (loading) await loading.catch(() => {});
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
  if (!current) return;
  const c = current; current = null;
  await queue.catch(() => {});
  try { await c.context.dispose(); } catch {}
  try { await c.model.dispose(); } catch {}
}

function status() {
  return current ? { loaded: true, id: current.id, path: current.path, contextSize: current.context.contextSize, gpu: llama && llama.gpu } : { loaded: false, loading: !!loading };
}

function normalizeContent(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p && p.type === 'text' ? p.text : '')).join('');
  return c == null ? '' : String(c);
}

/**
 * Sinh câu trả lời từ danh sách messages kiểu OpenAI.
 * onToken(text) được gọi cho từng đoạn văn bản. Trả về { text, usage, finishReason }.
 */
function generate(messages, { temperature = 0.7, maxTokens = 1024, topP, signal, onToken } = {}) {
  const run = async () => {
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

function countTokens(text) { if (!current) return Math.ceil(text.length / 3); try { return current.model.tokenize(text).length; } catch { return Math.ceil(text.length / 3); } }

module.exports = { countTokens, hardwareInfo, loadModel, unloadModel, status, generate, getLlama };
