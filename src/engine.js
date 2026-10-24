// Bộ máy suy luận: bọc node-llama-cpp
const SMP = require('./agent/sampling');
const path = require('path');
const os = require('os');
const TP = require('./agent/textproto');

let lib = null;           // module node-llama-cpp (ESM)
let llama = null;         // instance Llama
let current = null;       // { id, path, model, context }
let loading = null;       // promise khi đang nạp
let loadTail = Promise.resolve(); // hàng đợi nạp: hai lời gọi đang chờ không được chạy song song
let queue = Promise.resolve(); // tuần tự hoá các yêu cầu sinh văn bản
let vision = null;        // llama-server (mmproj) khi mô hình nhìn được ảnh
let visionOn = false;
let visionVramCache = null; // { at, free, ok } — VRAM trống thật khi llama-server nhìn ảnh đang giữ GPU
let embedder = null;      // { id, path, model, ctx, prefix }
let embedQueue = Promise.resolve();
function getVision() { if (!vision) vision = require('./vision-server').createVisionServer({ log: (m) => console.log(m) }); return vision; }

async function getLib() { if (!lib) lib = await import('node-llama-cpp'); return lib; }

async function getLlama() {
  if (llama) return llama;
  const { getLlama } = await getLib();
  if (process.env.AIVN_GPU === 'off') { llama = await getLlama({ gpu: false }); return llama; } // chế độ chỉ CPU (sau khi GPU nạp lỗi, hoặc người dùng tắt GPU)
  try { llama = await getLlama({ gpu: 'auto' }); }
  catch (e) { console.warn('GPU không khả dụng, chuyển sang CPU:', e.message); llama = await getLlama({ gpu: false }); }
  return llama;
}

// Phần cứng thật: VRAM RIÊNG của GPU rời (node-llama-cpp cộng cả bộ nhớ dùng chung của GPU tích hợp vào "total",
// ví dụ RTX 3050 Ti 4 GB + Radeon Vega tích hợp → báo 11,8 GB). Có thể giới hạn bằng AIVN_VRAM_LIMIT (byte) để kiểm thử/ghi đè.
async function vramInfo(l) {
  if (!l.gpu) return { total: 0, free: 0, shared: 0, mixed: false };
  let v; try { v = await l.getVramState(); } catch { return { total: 0, free: 0, shared: 0, mixed: false }; }
  const unified = v.unifiedSize || 0;
  let total, free;
  if (l.gpu === 'metal' || unified >= v.total) { total = v.total; free = v.free; } // Mac / chỉ có GPU tích hợp: bộ nhớ hợp nhất
  else { total = v.total - unified; free = Math.max(0, Math.min(total, v.free * (total / v.total))); }
  const lim = Number(process.env.AIVN_VRAM_LIMIT || 0);
  if (lim > 0) { total = Math.min(total, lim); free = Math.min(free, lim); }
  return { total, free, shared: unified, reportedTotal: v.total, mixed: unified > 0 && unified < v.total, integratedOnly: l.gpu !== 'metal' && unified >= v.total };
}
let progressCb = null; // 0.16: báo tiến độ nạp mô hình (viên chọn mô hình hiển thị %)
const setLoadProgress = (cb) => { progressCb = cb; };
// node-llama-cpp không tính VRAM của tiến trình llama-server khác. Hỏi --list-devices; không đo được thì kẹp số trống.
async function visionFreeBytes() {
  const now = Date.now();
  if (visionVramCache && now - visionVramCache.at < (visionVramCache.ok ? 8000 : 1500)) return visionVramCache.free;
  let free = null;
  let ok = false;
  let timer = null;
  try {
    const VS = require('./vision-server');
    const exe = VS.findServer();
    if (exe) {
      const d = await Promise.race([
        VS.listDevices(exe, { timeoutMs: 1200, fresh: true }),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1200); }),
      ]);
      const gpus = d && Array.isArray(d.all) ? d.all.filter((x) => x.freeMiB != null && !/^cpu/i.test(x.id)) : [];
      if (gpus.length) { free = Math.min(...gpus.map((g) => g.freeMiB)) * 1024 * 1024; ok = true; }
    }
  } catch { free = null; ok = false; }
  finally { if (timer) clearTimeout(timer); }
  visionVramCache = { at: now, free, ok };
  return free;
}
async function hardwareInfo() {
  const l = await getLlama();
  let vram = await vramInfo(l).catch(() => null);
  if (visionOn && vram && vram.total > 0) {
    try { vram = require('./embed-server').freeForEmbed(vram, { visionRunning: true, measuredFree: await visionFreeBytes() }); }
    catch { vram = require('./embed-server').freeForEmbed(vram, { visionRunning: true }); }
  }
  let devices = []; try { devices = await l.getGpuDeviceNames(); } catch {}
  const cpu = (os.cpus()[0] || {}).model || '';
  // B168: GPU tích hợp thường đứng trước trong danh sách Vulkan → nhãn dùng gpuName (GPU rời được ưu tiên), danh sách xếp GPU rời trước
  const GP = require('./gpu-pick'); const pk = GP.pick(devices); const gpuName = pk ? pk.name : null;
  return { gpu: l.gpu || false, vram, devices: GP.order(devices), devicesRaw: devices, gpuName, gpuMixed: GP.mixed(devices), ram: os.totalmem(), freeRam: os.freemem(), cpus: os.cpus().length, mathCores: l.cpuMathCores || null, cpu, platform: process.platform, arch: process.arch, cpuOnly: process.env.AIVN_GPU === 'off' };
}

// Đọc số lớp + kích thước KV từ GGUF để tự chọn số lớp đưa lên GPU (có chừa khoảng trống)
async function modelGeometry(modelPath) {
  try {
    const { readGgufFileInfo } = await getLib();
    const info = await readGgufFileInfo(modelPath, { readTensorInfo: false });
    const arch = info.metadata && info.metadata.general && info.metadata.general.architecture;
    const m = (arch && info.metadata[arch]) || {};
    const layers = Number(m.block_count) || null;
    const heads = Number(m.attention && m.attention.head_count) || null;
    const kvHeads = Number(m.attention && m.attention.head_count_kv) || heads;
    const headDim = Number(m.attention && m.attention.key_length) || (m.embedding_length && heads ? m.embedding_length / heads : null);
    const kvPerToken = layers && kvHeads && headDim ? 2 * layers * kvHeads * headDim * 2 : null; // K+V, f16
    const trainCtx = Number(m.context_length) || null;
    const g = (info.metadata && info.metadata.general) || {};
    const tpl = String((info.metadata && info.metadata.tokenizer && info.metadata.tokenizer.chat_template) || '');
    return { arch, layers, kvPerToken, trainCtx, name: g.name || g.basename || null, sizeLabel: g.size_label || null, toolTemplate: TP.templateHasTools(tpl) };
  } catch { return { arch: null, layers: null, kvPerToken: null }; }
}
const MB = 1024 * 1024;
const mmprojBytes = (p) => { try { return p ? require('fs').statSync(p).size : 0; } catch { return 0; } };
// Kế hoạch nạp: thử lần lượt từ nhanh nhất tới an toàn nhất
// 0.15.2: KHÔNG BAO GIỜ thu nhỏ ngữ cảnh dưới minCtx (mặc định 8192 — lời nhắc hệ thống + công cụ của AIVN AGENT cần chỗ).
// Thiếu VRAM thì đưa ít lớp lên GPU hơn; ngữ cảnh chỉ giảm (tới minCtx) ở các phương án cuối cùng.
function loadPlans({ gpu, vram, fileSize, geo, ctx, userLayers, kvScale = 1, minCtx = 8192 }) {
  const plans = []; const add = (p) => { p = { ...p, minCtx: Math.min(minCtx, p.ctx) }; if (!plans.some(x => x.gpuLayers === p.gpuLayers && x.ctx === p.ctx)) plans.push(p); };
  if (geo && geo.trainCtx) ctx = Math.min(ctx, geo.trainCtx);
  minCtx = Math.min(minCtx, ctx);
  const small = Math.max(minCtx, Math.min(ctx, 2048));
  if (gpu) {
    const L = geo.layers ? geo.layers + 1 : null; // + lớp đầu ra
    if (Number.isInteger(userLayers) && userLayers >= 0) add({ mode: userLayers ? 'gpu-manual' : 'cpu', gpuLayers: userLayers, ctx });
    let fitN = null;
    if (L && vram && vram.total > 0 && gpu !== 'metal') {
      // 0.16: cùng công thức với hộp nạp (src/gguf.js) — mỗi lớp trên GPU mang theo cả bộ đệm K/V của nó
      fitN = require('./gguf').gpuFit({ fileSize, layers: geo.layers, kvPerToken: geo.kvPerToken }, { ctx, kvScale, vram });
    }
    if (fitN === null) add({ mode: 'gpu', gpuLayers: 'auto', ctx });
    else if (fitN >= L) add({ mode: 'gpu', gpuLayers: L, ctx });
    else if (fitN > 0) add({ mode: 'gpu-partial', gpuLayers: fitN, ctx });
    const base = fitN ?? (L || 32);
    if (base > 4) add({ mode: 'gpu-partial', gpuLayers: Math.floor(base * 3 / 4), ctx });
    if (base > 4) add({ mode: 'gpu-partial', gpuLayers: Math.floor(base / 2), ctx });
    if (base > 4) add({ mode: 'gpu-partial', gpuLayers: Math.floor(base / 2), ctx: small });
    if (base > 8) add({ mode: 'gpu-partial', gpuLayers: Math.floor(base / 4), ctx }); // ít lớp → KV trên GPU cũng ít; vẫn nhanh hơn chỉ CPU
    add({ mode: 'cpu', gpuLayers: 0, ctx });
    add({ mode: 'cpu', gpuLayers: 0, ctx: small });
  } else { add({ mode: 'cpu-only', gpuLayers: 0, ctx }); add({ mode: 'cpu-only', gpuLayers: 0, ctx: small }); }
  // phương án cuối: CPU, ngữ cảnh 4096 (vẫn trò chuyện được; AIVN AGENT sẽ tự xin nạp lại với ngữ cảnh lớn hơn khi cần)
  if (ctx > 4096) { const last = { mode: gpu ? 'cpu' : 'cpu-only', gpuLayers: 0, ctx: 4096 }; if (!plans.some(x => x.gpuLayers === 0 && x.ctx === 4096)) plans.push({ ...last, minCtx: 4096 }); }
  return plans;
}

// Một lần nạp tại một thời điểm. `if (loading) await loading` rồi gán lại khiến hai lời gọi
// đang chờ cùng đi tiếp và gỡ mô hình của nhau. Hàng đợi gắn đuôi trước mọi await.
function exclusiveLoad(fn) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const prev = loadTail;
  loadTail = gate;
  const run = prev.catch(() => {}).then(async () => {
    loading = run;
    try { return await fn(); }
    finally { if (loading === run) loading = null; release(); }
  });
  return run;
}
async function loadModel(id, modelPath, opts = {}) {
  // cùng tệp đã nạp: giữ nguyên, TRỪ khi cần ngữ cảnh lớn hơn ngữ cảnh đang có (0.15.2: tự tăng ngữ cảnh)
  const wantCtx = opts.minContextSize || Math.min(Number(opts.contextSize) || 0, 8192);
  return exclusiveLoad(async () => {
  if (!opts.reload && !opts.mmproj && current && current.path === modelPath && !(wantCtx && current.context.contextSize < wantCtx)) return status();
  if (!opts.reload && opts.mmproj && visionOn && getVision().status()?.path === modelPath && !(wantCtx && (getVision().status().contextSize || 0) < wantCtx)) return status();
  if (opts.mmproj) {
      await unloadModel();
      const l = await getLlama().catch(() => null);
      const vpf = opts.perf || {}; const vx = { ...(vpf.threads ? { threads: vpf.threads } : {}), ...(vpf.batchSize ? { batchSize: vpf.batchSize } : {}), extraArgs: opts.serverArgs, serverExe: opts.serverExe || null,
        // B168/B170: chọn GPU rời trên máy nhiều GPU, lề VRAM rõ ràng cho --fit (cùng công thức với ước lượng ở hộp nạp), số lớp/KV/flash attention người dùng đặt
        multiGpu: await (l && l.gpu ? Promise.resolve().then(() => l.getGpuDeviceNames()) : Promise.resolve([])).then(n => (n || []).length > 1).catch(() => false), devicePref: opts.devicePref ?? null,
        fitTargetMiB: require('./gguf').serverMarginMiB(mmprojBytes(opts.mmproj)), ...(Number.isInteger(opts.gpuLayers) ? { gpuLayers: opts.gpuLayers } : {}),
        ...(opts.kvCache ? { kvCache: opts.kvCache } : {}), ...(opts.flashAttention != null ? { flashAttention: opts.flashAttention } : {}) }; // B26: số luồng/lô của từng mô hình áp dụng cả cho llama-server
      try { await getVision().start({ id, modelPath, mmprojPath: opts.mmproj, contextSize: opts.contextSize || 4096, gpu: !!(l && l.gpu), ...vx }); }
      catch (e) {
        if (!(l && l.gpu) || ['VCREDIST', 'NO_SERVER'].includes(e.code)) throw e;
        console.warn('[engine] máy chủ nhìn ảnh lỗi với GPU, thử lại bằng CPU: ' + e.message);
        await getVision().stop().catch(() => {});
        await getVision().start({ id, modelPath, mmprojPath: opts.mmproj, contextSize: opts.contextSize || 4096, gpu: false, ...vx });
      }
      visionOn = true; visionVramCache = null;
      return status();
  }
    await unloadModel();
    const ctxMax = opts.contextSize || 4096;
    const attempts = [];
    // Thử lần lượt: GPU với số lớp tự tính theo VRAM thật → ít lớp hơn → ngữ cảnh nhỏ hơn → CPU. Mỗi lần thất bại đều ghi lại lỗi thật.
    // (Không nạp thêm bản llama chỉ-CPU trong cùng tiến trình vì các DLL ggml trùng tên; tiến trình chính khởi động lại bộ máy với AIVN_GPU=off.)
    const l = await getLlama();
    const vram = await vramInfo(l).catch(() => null);
    const geo = await modelGeometry(modelPath);
    let fileSize = opts.fileSize || 0; if (!fileSize) { try { fileSize = require('fs').statSync(modelPath).size; } catch {} }
    const pf = opts.perf || {};
    const kvQuant = !!pf.kvQuant;
    const plans = loadPlans({ gpu: l.gpu, vram, fileSize, geo, ctx: ctxMax, userLayers: opts.gpuLayers, kvScale: kvQuant ? 0.55 : 1, minCtx: opts.minContextSize || 8192 });
    const ctxOpts = (plan, kv) => ({ contextSize: { min: plan.minCtx, max: plan.ctx },
      ...(pf.threads ? { threads: pf.threads } : {}), ...(pf.batchSize ? { batchSize: Math.min(pf.batchSize, plan.ctx) } : {}), ...(pf.flashAttention != null ? { flashAttention: kv ? true : pf.flashAttention } : {}),
      ...(kv ? { experimentalKvCacheKeyType: 'Q8_0', experimentalKvCacheValueType: 'Q8_0' } : {}) });
    for (const plan of plans) {
      let model = null;
      try {
        let lastPct = -1; model = await l.loadModel({ modelPath, gpuLayers: plan.gpuLayers, onLoadProgress: (x) => { const pct = Math.floor(x * 100); if (pct >= lastPct + 2 || pct === 100) { lastPct = pct; try { progressCb && progressCb({ id, pct, mode: plan.mode }); } catch {} } }, ...(opts.useMmap === false ? { useMmap: false } : {}), ...(opts.useMlock ? { useMlock: true } : {}) });
        let context, kvUsed = kvQuant;
        try { context = await model.createContext(ctxOpts(plan, kvUsed)); }
        catch (e) { if (!kvUsed) throw e; kvUsed = false; attempts.push({ mode: `${plan.mode} KV q8_0`, message: String(e && e.message || e) }); context = await model.createContext(ctxOpts(plan, false)); } // KV nén lỗi (mô hình/GPU không hỗ trợ) → f16
        let tokenPredictor; if (pf.lookup) { try { const { InputLookupTokenPredictor } = await getLib(); tokenPredictor = new InputLookupTokenPredictor(); } catch {} }
        current = { id, path: modelPath, model, context, tokenPredictor, loadedAt: Date.now(), mode: plan.mode, meta: { name: geo.name, arch: geo.arch, sizeLabel: geo.sizeLabel, toolTemplate: geo.toolTemplate, trainCtx: geo.trainCtx || null }, gpuLayers: model.gpuLayers, totalLayers: geo.layers ? geo.layers + 1 : null, attempts: attempts.map(a => a.mode + ': ' + a.message),
          perf: { threads: pf.threads || l.cpuMathCores || null, batchSize: pf.batchSize || 512, kv: kvUsed ? 'q8_0' : 'f16', flashAttention: context.flashAttention ?? null, lookup: !!tokenPredictor, profile: pf.effective || null } };
        return status();
      } catch (e) {
        attempts.push({ mode: `${plan.mode} (${plan.gpuLayers} lớp GPU, ngữ cảnh ${plan.ctx})`, message: String(e && e.message || e), stack: String(e && e.stack || '') });
        try { if (model) await model.dispose(); } catch {}
      }
    }
    const err = new Error(attempts[attempts.length - 1].message);
    err.code = 'LOAD_FAILED'; err.attempts = attempts; err.gpu = !!l.gpu;
    throw err;
  });
}


async function unloadModel() {
  if (visionOn) { visionOn = false; visionVramCache = null; await queue.catch(() => {}); await getVision().stop(); }
  if (!current) return;
  const c = current; current = null;
  await queue.catch(() => {});
  try { if (c.seq && !c.seq.disposed) c.seq.dispose(); } catch {}
  try { await c.context.dispose(); } catch {}
  try { await c.model.dispose(); } catch {}
}

function status() {
  // B123: bộ máy THẬT đang chạy mô hình nhìn ảnh (llama-server), không phải GPU của node-llama-cpp
  if (visionOn) { const v = getVision().status(); if (v) return { loaded: true, id: v.id, path: v.path, contextSize: v.contextSize, vision: true, gpu: llama && llama.gpu, backend: serverBackend(v), gpuLayers: v.gpuLayers ?? null, totalLayers: v.totalLayers ?? null, device: v.device || null, toolMode: v.textTools ? 'text' : 'native', runtime: v.runtime || 'bundled', runtimeFallback: v.runtimeFallback || null, meta: v.template ? { toolTemplate: !!v.template.nativeTools } : null }; }
  return current ? { loaded: true, id: current.id, path: current.path, contextSize: current.context.contextSize, gpu: llama && llama.gpu, mode: current.mode, gpuLayers: current.gpuLayers, totalLayers: current.totalLayers, toolMode: current.toolMode || null, chatWrapper: current.chatWrapper || null, meta: current.meta || null, perf: current.perf || null, fallbackFrom: current.attempts && current.attempts.length ? current.attempts : null } : { loaded: false, loading: !!loading };
}

// Một chuỗi ngữ cảnh dùng lại giữa các lượt (giữ bộ nhớ đệm KV: lượt sau chỉ tính phần mới của lời nhắc)
function seqFor(c) { if (!c.seq || c.seq.disposed) c.seq = c.context.getSequence(c.tokenPredictor ? { tokenPredictor: c.tokenPredictor } : undefined); return c.seq; }

function normalizeContent(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p && p.type === 'text' ? p.text : '')).join(''); // mô hình chữ: bỏ phần ảnh
  return c == null ? '' : String(c);
}

/**
 * Sinh câu trả lời từ danh sách messages kiểu OpenAI.
 * onToken(text) được gọi cho từng đoạn văn bản. Trả về { text, usage, finishReason }.
 */
async function chatGrammar(schema) { // đầu ra JSON theo lược đồ cho trò chuyện thường (dùng chung bộ nhớ đệm với chatStep)
  const l = await getLlama(); const sc = toGbnfSchema(schema || {});
  try { return await grammarFor('s:' + JSON.stringify(sc), () => l.createGrammarForJsonSchema(sc)); }
  catch (e) { const x = new Error('Lược đồ JSON không hợp lệ hoặc chưa được hỗ trợ: ' + (e && e.message || e)); x.code = 'BAD_SCHEMA'; throw x; }
}
// 0.16: seed, chuỗi dừng, đầu ra JSON theo lược đồ, khối suy nghĩ (onToken(t, 'think')), thời gian ra token đầu (ttft), lý do dừng, số token trong ngữ cảnh
function generate(messages, { temperature = 0.7, maxTokens = 1024, topP, signal, onToken, sampling = null, seed = null, stop = null, jsonSchema = null } = {}) {
  const run = async () => {
    if (visionOn) return getVision().generate(messages, { temperature, maxTokens, topP, signal, onToken, sampling, seed, stop, jsonSchema });
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
    const sequence = seqFor(current);
    // seed cố định: đánh giá lại lời nhắc từ đầu để kết quả lặp lại đúng từng chữ (dùng lại bộ đệm K/V làm sai khác số học nhỏ)
    if (Number.isInteger(seed) && seed >= 0) { try { await sequence.clearHistory(); } catch {} }
    const session = new LlamaChatSession({ contextSequence: sequence, autoDisposeSequence: false });
    if (history.length) session.setChatHistory(history);
    const t0 = Date.now();
    let text = '', ttft = null, thought = '';
    let finishReason = 'stop', stopReason = null;
    const stops = Array.isArray(stop) ? stop.filter(x => typeof x === 'string' && x.length).slice(0, 8) : [];
    const grammar = jsonSchema ? await chatGrammar(jsonSchema) : null;
    try {
      const res = await session.promptWithMeta(prompt, {
        temperature, topP, maxTokens, signal, stopOnAbortSignal: true, ...SMP.toLlamaCpp(sampling), ...(topP != null ? { topP } : {}),
        ...(Number.isInteger(seed) && seed >= 0 ? { seed } : {}), ...(stops.length ? { customStopTriggers: stops } : {}), ...(grammar ? { grammar } : {}),
        // B71: mô hình suy luận (gpt-oss Harmony, Qwen3 thinking) không được dùng hết maxTokens cho phần suy luận rồi trả câu trả lời RỖNG
        ...(maxTokens > 0 ? { budgets: { thoughtTokens: Math.max(256, Math.floor(maxTokens * 0.6)) } } : {}),
        onResponseChunk: (c) => {
          if (ttft == null) ttft = (Date.now() - t0) / 1000;
          if (c.type === 'segment') { if (c.segmentType === 'thought' && c.text) { thought += c.text; onToken && onToken(c.text, 'think'); } return; }
          if (c.text) { text += c.text; onToken && onToken(c.text); }
        },
      });
      stopReason = res && res.stopReason || null;
      if (res && res.stopReason === 'maxTokens') finishReason = 'length';
      if (res && res.stopReason === 'abort') finishReason = 'abort';
      if (res && typeof res.responseText === 'string') text = res.responseText;
      text = text.replace(/^\s+/, '');
    } catch (e) {
      if (!(signal && signal.aborted)) throw e;
      finishReason = 'abort';
    } finally {
      session.dispose({ disposeSequence: false });
    }
    const completionTokens = current ? current.model.tokenize(thought + text).length : 0;
    const secs = (Date.now() - t0) / 1000; const genSecs = Math.max(0.001, secs - (ttft || 0));
    let contextTokens = null; try { contextTokens = sequence.contextTokens.length; } catch {}
    return { text, thought: thought || null, finishReason, stopReason, usage: { completion_tokens: completionTokens, tokensPerSecond: completionTokens > 1 ? (completionTokens - 1) / genSecs : 0, seconds: secs, ttft, contextTokens, contextSize: current ? current.context.contextSize : null } };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---- Một bước hội thoại có công cụ (tool calling) / đầu ra JSON theo lược đồ ----
// messages kiểu OpenAI (system/user/assistant có tool_calls/tool). tools: [{name, description, parameters}]
// toolChoice: 'auto' | 'none' | 'required' | { name }. responseFormat: { type: 'json_object' } | { type: 'json_schema', schema }
// Trả về { text, toolCalls: [{ id, name, arguments }], finishReason, usage }
const { toGbnfSchema } = require('./schema');
const grammarCache = new Map();
async function grammarFor(key, make) {
  if (grammarCache.has(key)) return grammarCache.get(key);
  const g = await make(); grammarCache.set(key, g); if (grammarCache.size > 32) grammarCache.delete(grammarCache.keys().next().value);
  return g;
}
const callId = () => 'call_' + require('crypto').randomBytes(9).toString('hex');
function parseMaybeJson(v) { if (typeof v !== 'string') return v; const t = v.trim(); if (/^[\[{"]/.test(t)) { try { return JSON.parse(t); } catch {} } return v; }

function toChatHistory(messages) {
  const sys = [], items = [];
  const results = new Map();
  for (const m of messages) if (m && m.role === 'tool') results.set(m.tool_call_id, normalizeContent(m.content));
  let open = null; // phản hồi của mô hình đang mở (gộp assistant + kết quả công cụ + assistant tiếp theo)
  for (const m of messages) {
    if (!m) continue;
    if (m.role === 'system' || m.role === 'developer') { sys.push(normalizeContent(m.content)); continue; }
    if (m.role === 'user') { const last = items[items.length - 1]; const t = normalizeContent(m.content); if (last && last.type === 'user') last.text += '\n\n' + t; else items.push({ type: 'user', text: t }); open = null; continue; } // gộp các lượt user liền nhau (mẫu xen kẽ nghiêm ngặt)
    if (m.role === 'assistant') {
      if (!open) { open = { type: 'model', response: [] }; items.push(open); }
      const t = normalizeContent(m.content); if (t) open.response.push(t);
      (m.tool_calls || []).forEach((tc, i) => {
        const fn = tc && tc.function || {};
        let params = fn.arguments; if (typeof params === 'string') { try { params = JSON.parse(params || '{}'); } catch {} }
        open.response.push({ type: 'functionCall', name: String(fn.name || ''), params: params ?? {}, result: parseMaybeJson(results.has(tc.id) ? results.get(tc.id) : ''), ...(i === 0 ? { startsNewChunk: true } : {}) });
      });
    }
  }
  if (sys.length) items.unshift({ type: 'system', text: sys.join('\n\n') });
  return items;
}

// Mô hình đang nạp có gọi công cụ gốc không? (theo bộ bọc chat của node-llama-cpp / mẫu chat trong GGUF)
function toolModeFor(chat) {
  if (process.env.AIVN_TOOL_MODE) return process.env.AIVN_TOOL_MODE;
  if (current.toolMode) return current.toolMode;
  const name = (chat && chat.chatWrapper && chat.chatWrapper.wrapperName) || '';
  let mode = 'text';
  if (/^(Qwen|Llama 3|Functionary|Harmony|Mistral|DeepSeek|Seed)/i.test(name)) mode = 'native';
  else if (/jinja/i.test(name)) { let tpl = null; try { tpl = current.model.fileInfo.metadata.tokenizer.chat_template; } catch {} mode = TP.analyzeTemplate(tpl).nativeTools ? 'native' : 'text'; }
  current.toolMode = mode; current.chatWrapper = name;
  return mode;
}

function chatStep(messages, { tools = [], toolChoice = 'auto', responseFormat = null, temperature = 0.7, maxTokens = 1024, topP, signal, onToken, sampling = null } = {}) {
  const run = async (messages, tools) => {
    if (visionOn) return getVision().chatStep(messages, { tools, toolChoice, responseFormat, temperature, maxTokens, topP, signal, onToken, sampling });
    if (!current) throw new Error('Chưa nạp mô hình nào.');
    const { LlamaChat } = await getLib();
    const l = await getLlama();
    const chat = new LlamaChat({ contextSequence: seqFor(current), autoDisposeSequence: false });
    try {
    const textMode = toolModeFor(chat) === 'text';
    const forced = tools.length && toolChoice && toolChoice !== 'auto' && toolChoice !== 'none' ? (typeof toolChoice === 'object' ? tools.filter(t => t.name === toolChoice.name) : tools) : null;
    if (forced && !forced.length) throw new Error(`Không có công cụ "${toolChoice.name}" trong "tools"`);
    const useFns = tools.length && toolChoice !== 'none' && !forced && !responseFormat;
    // Mô hình không có gọi công cụ gốc (Gemma, Mistral cũ…): giao thức <tool_call> dạng văn bản của AIVN, hội thoại chuẩn hoá xen kẽ
    const textTools = textMode && tools.length && !forced && !responseFormat;
    let history = textMode ? toChatHistory(TP.normalizeMessages(messages, { tools: textTools && toolChoice !== 'none' ? tools : [] })) : toChatHistory(messages);
    const hasCalls = history.some(h => h.type === 'model' && h.response.some(r => r && r.type === 'functionCall'));
    const functions = {};
    const noParams = (p) => !p || (p.type === 'object' || !p.type) && (!p.properties || !Object.keys(p.properties).length) && !p.additionalProperties;
    for (const t of tools) functions[t.name] = { description: t.description || undefined, ...(noParams(t.parameters) ? {} : { params: toGbnfSchema(t.parameters) }) };
    let grammar = null;
    if (forced) {
      // buộc gọi công cụ: ràng buộc đầu ra thành {"name": …, "arguments": {…}} bằng ngữ pháp JSON
      const schema = { oneOf: forced.map(t => ({ type: 'object', properties: { name: { const: t.name }, arguments: noParams(t.parameters) ? { type: 'object', properties: {} } : toGbnfSchema(t.parameters) } })) };
      grammar = await grammarFor('f:' + JSON.stringify(schema), () => l.createGrammarForJsonSchema(schema));
      const doc = forced.map(t => `- ${t.name}: ${t.description || ''}\n  tham số (JSON Schema): ${JSON.stringify(t.parameters || {})}`).join('\n');
      const note = `Bạn phải gọi đúng một công cụ trong danh sách sau và chỉ trả lời bằng một đối tượng JSON dạng {"name": "<tên công cụ>", "arguments": {…}}.\n${doc}`;
      if (history[0] && history[0].type === 'system') history[0] = { type: 'system', text: history[0].text + '\n\n' + note }; else history.unshift({ type: 'system', text: note });
    } else if (responseFormat && responseFormat.type === 'json_schema') {
      const schema = toGbnfSchema(responseFormat.schema || {});
      grammar = await grammarFor('s:' + JSON.stringify(schema), () => l.createGrammarForJsonSchema(schema));
    } else if (responseFormat && responseFormat.type === 'json_object') {
      grammar = await grammarFor('json', () => l.getGrammarFor('json'));
    }
    const last = history[history.length - 1];
    if (!last || last.type !== 'model') history.push({ type: 'model', response: [] });
    else if (grammar) history.push({ type: 'user', text: 'Tiếp tục.' }, { type: 'model', response: [] });
    const t0 = Date.now();
    let streamed = '';
    const filt = textTools ? TP.streamFilter(onToken) : null;
    try {
      const opts = { temperature, topP, maxTokens, signal, stopOnAbortSignal: true,
        onTextChunk: (chunk) => { streamed += chunk; if (grammar) return; if (filt) filt.push(chunk); else onToken && onToken(chunk); } };
      if (!textMode && (useFns || (hasCalls && !grammar))) Object.assign(opts, { functions, documentFunctionParams: true, maxParallelFunctionCalls: 4 });
      if (grammar) opts.grammar = grammar;
      else if (sampling) { Object.assign(opts, SMP.toLlamaCpp(sampling)); if (topP != null) opts.topP = topP; } // chống lặp (không áp cho sinh JSON có ngữ pháp)
      const res = await chat.generateResponse(history, opts);
      const stop = res.metadata && res.metadata.stopReason;
      let text = (typeof res.response === 'string' ? res.response : streamed).replace(/^\s+/, '');
      let toolCalls = [];
      if (filt) { filt.end(); if (toolChoice !== 'none') { const pr = TP.parseToolCalls(text, tools.map(t => t.name)); text = pr.text; toolCalls = pr.toolCalls; } }
      else if (useFns || (hasCalls && !grammar)) toolCalls = (res.functionCalls || []).map(fc => ({ id: callId(), name: fc.functionName, arguments: fc.params ?? {} }));
      if (toolChoice === 'none' || !useFns && !forced && !textTools) toolCalls = []; // không được phép gọi: bỏ qua
      if (forced) {
        let j = null; try { j = JSON.parse(text); } catch {}
        if (j && typeof j.name === 'string') { toolCalls = [{ id: callId(), name: j.name, arguments: j.arguments ?? {} }]; text = ''; }
      }
      const callText = useFns ? toolCalls.map(c => c.name + JSON.stringify(c.arguments)).join('') : '';
      const completionTokens = current ? current.model.tokenize((streamed || text) + callText).length : 0;
      const secs = (Date.now() - t0) / 1000;
      const finishReason = signal && signal.aborted ? 'abort' : toolCalls.length ? 'tool_calls' : stop === 'maxTokens' ? 'length' : 'stop';
      return { text, toolCalls, finishReason, usage: { completion_tokens: completionTokens, tokensPerSecond: secs > 0 ? completionTokens / secs : 0, seconds: secs } };
    } catch (e) {
      if (signal && signal.aborted) return { text: streamed, toolCalls: [], finishReason: 'abort', usage: { completion_tokens: 0, tokensPerSecond: 0, seconds: (Date.now() - t0) / 1000 } };
      throw e;
    }
    } finally { chat.dispose({ disposeSequence: false }); }
  };
  // Lời nhắc hệ thống + mô tả công cụ dài hơn ngữ cảnh (vd. ngữ cảnh 2048): thử lại với mô tả công cụ rút gọn và lịch sử ngắn,
  // vẫn không vừa thì báo rõ cách sửa thay vì lỗi tiếng Anh của node-llama-cpp
  const CTX_RE = TP.CTX_RE;
  const runSafe = async () => {
    try { return await run(messages, tools); }
    catch (e) {
      if (!CTX_RE.test(String(e && e.message))) throw e;
      try { return await run(TP.trimHistory(messages), TP.compactTools(tools)); }
      catch (e2) {
        if (!CTX_RE.test(String(e2 && e2.message))) throw e2;
        const n = current && current.context ? current.context.contextSize : null;
        throw TP.ctxSmallError(n);
      }
    }
  };
  const p = queue.then(runSafe, runSafe);
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
module.exports = { setLoadProgress, loadPlans, modelGeometry, vramInfo, countTokens, countTokensAsync, hardwareInfo, loadModel, unloadModel, status, generate, chatStep, toChatHistory, getLlama, loadEmbedder, unloadEmbedder, embedStatus, embed, embedCount, exclusiveLoad };

// B123: llama-server CUDA → 'cuda'; bản đi kèm → vulkan (Windows) / metal (Mac) / cpu (Linux); 0 lớp lên GPU → 'cpu'
function serverBackend(v) { if (!v) return null; if (v.gpuLayers === 0) return 'cpu'; if (v.runtime === 'cuda') return 'cuda'; return process.platform === 'win32' ? 'vulkan' : process.platform === 'darwin' ? 'metal' : 'cpu'; }
module.exports.serverBackend = serverBackend;
