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
let loggedUnknownFree = false;
async function vramInfo(l) {
  const empty = { total: 0, free: 0, shared: 0, mixed: false, freeKnown: false, freeSource: 'none' };
  if (!l.gpu) return empty;
  let v; try { v = await l.getVramState(); } catch { return empty; }
  const VQ = require('./vram-query');
  const unified = v.unifiedSize || 0;
  const mixed = unified > 0 && unified < v.total;
  const integratedOnly = l.gpu !== 'metal' && unified >= v.total;
  let total, reportedFree;
  if (l.gpu === 'metal' || unified >= v.total) { total = v.total; reportedFree = v.free; } // Mac / chỉ có GPU tích hợp: bộ nhớ hợp nhất
  else { total = v.total - unified; reportedFree = Math.max(0, Math.min(total, v.free * (total / v.total))); }
  const lim = Number(process.env.AIVN_VRAM_LIMIT || 0);
  if (lim > 0) { total = Math.min(total, lim); reportedFree = Math.min(reportedFree, total); }
  let measured = null;
  // AIVN_VRAM_LIMIT là số giả lập cho kiểm thử — không hỏi GPU thật. GPU tích hợp / Metal dùng đúng ngân sách của nó.
  if (!(lim > 0) && l.gpu !== 'metal' && !integratedOnly) {
    try {
      const rows = await VQ.queryNvidiaSmi();
      const row = VQ.pickNvidiaRow(rows, total);
      if (row) measured = { freeBytes: row.freeBytes };
    } catch { measured = null; }
  }
  const resolved = l.gpu === 'metal'
    ? { total, free: Math.max(0, Math.min(total, Number(reportedFree) || 0)), freeKnown: Number.isFinite(Number(reportedFree)), freeSource: 'metal' }
    : VQ.resolveVram({ total, reportedFree, mixed, integratedOnly }, measured);
  if (!resolved.freeKnown && !loggedUnknownFree) {
    loggedUnknownFree = true;
    console.log(VQ.UNKNOWN_FREE_LOG);
  }
  return { total: resolved.total, free: resolved.free, shared: unified, reportedTotal: v.total, mixed, integratedOnly, freeKnown: resolved.freeKnown, freeSource: resolved.freeSource };
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
// Khoá nhận GPU: phiên bản driver và/hoặc id thiết bị mà thư viện đã báo. Đổi driver thì nhớ offload không còn khớp.
async function gpuDriverKey(l) {
  const bits = [];
  try {
    if (l && typeof l.getGpuDriverVersion === 'function') {
      const v = await l.getGpuDriverVersion();
      if (v) bits.push(String(v));
    } else if (l && l.gpuDriver) bits.push(String(l.gpuDriver));
  } catch {}
  try {
    let devs = [];
    if (l && typeof l.getGpuDevices === 'function') devs = (await l.getGpuDevices()) || [];
    else if (l && Array.isArray(l.devices)) devs = l.devices;
    const ids = [];
    for (const d of devs) {
      if (!d || typeof d !== 'object') continue;
      const id = d.id || d.deviceId || d.uuid;
      if (id) ids.push(String(id));
    }
    if (ids.length) bits.push(ids.join(','));
  } catch {}
  return bits.join('|');
}
let nvidiaDriverCache;
async function nvidiaDriverVersion() {
  if (nvidiaDriverCache !== undefined) return nvidiaDriverCache;
  nvidiaDriverCache = '';
  try {
    const { execFile } = require('child_process');
    const bins = require('./vram-query').nvidiaSmiCandidates();
    for (const bin of bins) {
      const text = await new Promise((resolve) => {
        execFile(bin, ['--query-gpu=driver_version', '--format=csv,noheader'], { timeout: 800, windowsHide: true }, (err, out) => resolve(err ? '' : String(out || '')));
      });
      const line = String(text).split(/\r?\n/).map((s) => s.trim()).find((s) => /^\d/.test(s));
      if (line) { nvidiaDriverCache = line.split(',')[0].trim(); break; }
    }
  } catch { nvidiaDriverCache = ''; }
  return nvidiaDriverCache;
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
  let driver = await gpuDriverKey(l);
  if (!driver) { try { driver = await nvidiaDriverVersion(); } catch { driver = ''; } }
  return { gpu: l.gpu || false, vram, devices: GP.order(devices), devicesRaw: devices, gpuName, gpuMixed: GP.mixed(devices), ram: os.totalmem(), freeRam: os.freemem(), cpus: os.cpus().length, mathCores: l.cpuMathCores || null, cpu, platform: process.platform, arch: process.arch, cpuOnly: process.env.AIVN_GPU === 'off', driver: driver || '' };
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
// B190: người dùng chọn số lớp (kể cả 0 = CPU) thì phương án đó đứng đầu; thang dự phòng chỉ đi xuống, không leo lên.
// Thiếu VRAM: tối đa 3 lần GPU (bắt đầu, rồi −4 hoặc −2 lớp) ở ĐÚNG ngữ cảnh xin, rồi CPU ở ngữ cảnh đó, rồi 4096.
function loadPlans({ gpu, vram, fileSize, geo, ctx, userLayers, kvScale = 1, kvType, minCtx = 8192, capLayers, safe = false, batchSize, mmprojBytes, weightBytes } = {}) {
  const plans = [];
  const add = (p) => {
    const row = { mode: p.mode, gpuLayers: p.gpuLayers, ctx: p.ctx, minCtx: Math.min(minCtx, p.ctx) };
    if (p.kv) row.kv = p.kv;
    if (p.confident && !safe) row.confident = true;
    if (!plans.some(x => x.gpuLayers === row.gpuLayers && x.ctx === row.ctx && x.kv === row.kv)) plans.push(row);
  };
  if (geo && geo.trainCtx) ctx = Math.min(ctx, geo.trainCtx);
  minCtx = Math.min(minCtx, ctx);
  const small = Math.max(minCtx, Math.min(ctx, 2048));
  const batch = Math.max(1, Math.min(Number(batchSize) > 0 ? Number(batchSize) : 512, 2048, ctx || 2048));
  if (gpu) {
    const L = geo && geo.layers ? geo.layers + 1 : null; // + lớp đầu ra
    const manual = Number.isInteger(userLayers) && userLayers >= 0;
    if (manual) add({ mode: userLayers ? 'gpu-manual' : 'cpu', gpuLayers: userLayers, ctx });
    let fitN = null, fitKv = null, fitSure = false;
    if (!manual && L && vram && vram.total > 0 && gpu !== 'metal') {
      // 0.16 / B190: cùng công thức với hộp nạp (src/gguf.js), gồm VRAM trống, mmproj và bộ đệm tính toán theo lô
      const choice = require('./gguf').chooseOffload({ fileSize, layers: geo.layers, kvPerToken: geo.kvPerToken }, { ctx, kvScale, kvType, vram, batch, mmprojBytes: mmprojBytes || 0, weightBytes: weightBytes || 0 });
      fitN = choice.gpuLayers; fitKv = choice.kv === 'q8_0' ? 'q8_0' : null; fitSure = !!choice.confident;
      // Trần lấy từ bộ nhớ — kể cả khi nó bằng đúng fitN — không bao giờ bỏ qua kiểm tra bộ nhớ của thư viện.
      if (Number.isInteger(capLayers) && capLayers >= 0) { if (capLayers < fitN) fitN = capLayers; fitSure = false; }
    }
    if (!manual) {
      if (fitN === null) add({ mode: 'gpu', gpuLayers: 'auto', ctx });
      else if (L && fitN >= L) add({ mode: 'gpu', gpuLayers: L, ctx, kv: fitKv, confident: fitSure });
      else if (fitN > 0) add({ mode: 'gpu-partial', gpuLayers: fitN, ctx, kv: fitKv });
    }
    // Hai bước xuống nữa (tối đa 3 lần GPU). Không nhảy 41 → 30, không giảm ngữ cảnh khi còn lớp GPU để thử.
    let base = manual ? userLayers : (fitN == null ? 0 : fitN);
    const step = base >= 16 ? 4 : 2;
    for (let i = 0; i < 2 && base - step > 0; i++) {
      base -= step;
      if (manual && base >= userLayers) break;
      add({ mode: 'gpu-partial', gpuLayers: base, ctx });
    }
    add({ mode: 'cpu', gpuLayers: 0, ctx });
    if (small < ctx) add({ mode: 'cpu', gpuLayers: 0, ctx: small });
  } else {
    add({ mode: 'cpu-only', gpuLayers: 0, ctx });
    if (small < ctx) add({ mode: 'cpu-only', gpuLayers: 0, ctx: small });
  }
  // phương án cuối: CPU, ngữ cảnh 4096 (vẫn trò chuyện được; AIVN AGENT sẽ tự xin nạp lại với ngữ cảnh lớn hơn khi cần)
  if (ctx > 4096) { const last = { mode: gpu ? 'cpu' : 'cpu-only', gpuLayers: 0, ctx: 4096 }; if (!plans.some(x => x.gpuLayers === 0 && x.ctx === 4096)) plans.push({ ...last, minCtx: 4096 }); }
  return plans;
}
// Flash attention: 'auto' để llama.cpp chọn theo thiết bị và để node-llama-cpp tắt FA với kiến trúc không hỗ trợ (Gemma2, grok).
// true chỉ khi người dùng bật rõ, hoặc lần thử KV q8 (q8 cần FA). Lần thử sau, nếu tạo ngữ cảnh lỗi, là false.
function explicitFlash(optsFlash, perfFlash) {
  if (optsFlash === true || optsFlash === false) return optsFlash;
  if (perfFlash === true || perfFlash === false) return perfFlash;
  return null;
}
function flashForContext(user, kvQ8) {
  if (kvQ8) return true;
  if (user === true) return true;
  if (user === false) return false;
  return 'auto';
}
function contextTries(userFlash, kvQ8) {
  const fa = flashForContext(userFlash, !!kvQ8);
  const tries = [{ fa, kv: !!kvQ8 }];
  if (fa !== false) tries.push({ fa: false, kv: false });
  return tries;
}
// B190: tối đa 3 lần GPU rồi tối đa 3 lần CPU. Không bao giờ chọn số lớp cao hơn bước trước.
function oomSchedule(plans) {
  const picked = [];
  let gpuN = 0, cpuN = 0, lastGpu = Infinity;
  for (const p of plans) {
    const isGpu = p.gpuLayers === 'auto' || Number(p.gpuLayers) > 0;
    if (isGpu) {
      if (gpuN >= 3) continue;
      const layers = p.gpuLayers === 'auto' ? Infinity : Number(p.gpuLayers);
      if (layers > lastGpu) continue;
      picked.push(p); gpuN++; lastGpu = layers;
    } else if (cpuN < 3) { picked.push(p); cpuN++; }
  }
  return picked;
}

// Đo trên bản nháp, không đi qua generate() và không đưa bản nháp vào `current`.
// generate() trong lúc nạp phải đợi mô hình cuối; nếu lần đo gọi generate() thì chờ lẫn nhau.
async function runSpeedProbe(draft, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const { LlamaChatSession } = await getLib();
    const sequence = draft.context.getSequence(draft.tokenPredictor ? { tokenPredictor: draft.tokenPredictor } : undefined);
    const session = new LlamaChatSession({ contextSequence: sequence, autoDisposeSequence: false });
    const t0 = Date.now();
    let text = '', ttft = null;
    try {
      const res = await session.promptWithMeta('Hi', {
        temperature: 0, maxTokens: 24, signal: ac.signal, stopOnAbortSignal: true,
        onResponseChunk: (c) => {
          if (ttft == null) ttft = (Date.now() - t0) / 1000;
          if (c && c.text) text += c.text;
        },
      });
      if (res && typeof res.responseText === 'string') text = res.responseText;
    } finally {
      try { session.dispose({ disposeSequence: false }); } catch {}
      try { if (sequence && !sequence.disposed) sequence.dispose(); } catch {}
    }
    const completionTokens = draft.model.tokenize(text).length;
    const secs = (Date.now() - t0) / 1000;
    const genSecs = Math.max(0.001, secs - (ttft || 0));
    return { tps: completionTokens > 1 ? (completionTokens - 1) / genSecs : 0, tokens: completionTokens };
  } catch { return null; }
  finally { clearTimeout(timer); }
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
      const vramV = l && l.gpu ? await vramInfo(l).catch(() => null) : null;
      const geoV = await modelGeometry(modelPath).catch(() => ({ layers: null }));
      const gg = require('./gguf');
      const fitTargetMiB = gg.serverMarginMiB(mmprojBytes(opts.mmproj), vramV);
      // B190: GPU lớn và mô hình vừa VRAM → -ngl trọn lớp, không --fit-target ~1 GiB. GPU nhỏ giữ --fit (lề B170).
      let sureLayers = null, partialLayers = null, visionWeights = 0;
      try { visionWeights = gg.summarize(modelPath).weightBytes || 0; } catch {}
      if (!Number.isInteger(opts.gpuLayers) && geoV && geoV.layers && vramV && vramV.total > 0) {
        const choice = gg.chooseOffload({ fileSize: opts.fileSize || 0, layers: geoV.layers, kvPerToken: geoV.kvPerToken }, { ctx: opts.contextSize || 4096, vram: vramV, allowQ8: false, batch: 512, mmprojBytes: mmprojBytes(opts.mmproj), weightBytes: visionWeights });
        if (choice.confident && vramV.total >= 8 * 1024 * 1024 * 1024 && !opts.safe) sureLayers = choice.totalLayers;
        else if (choice.gpuLayers > 0 && choice.gpuLayers < choice.totalLayers) partialLayers = Math.max(1, choice.gpuLayers - (choice.gpuLayers >= 16 ? 4 : 2));
      }
      const vpf = opts.perf || {}; const vx = { ...(vpf.threads ? { threads: vpf.threads } : {}), ...(vpf.batchSize ? { batchSize: vpf.batchSize } : {}), extraArgs: opts.serverArgs, serverExe: opts.serverExe || null,
        // B168/B170: chọn GPU rời trên máy nhiều GPU, lề VRAM rõ ràng cho --fit (cùng công thức với ước lượng ở hộp nạp), số lớp/KV/flash attention người dùng đặt
        multiGpu: await (l && l.gpu ? Promise.resolve().then(() => l.getGpuDeviceNames()) : Promise.resolve([])).then(n => (n || []).length > 1).catch(() => false), devicePref: opts.devicePref ?? null,
        fitTargetMiB, ...(Number.isInteger(opts.gpuLayers) ? { gpuLayers: opts.gpuLayers } : sureLayers != null ? { gpuLayers: sureLayers } : {}),
        ...(opts.kvCache ? { kvCache: opts.kvCache } : {}), ...(opts.flashAttention != null ? { flashAttention: opts.flashAttention } : {}) }; // B26: số luồng/lô của từng mô hình áp dụng cả cho llama-server
      const visionTry = async (extra) => { await getVision().stop().catch(() => {}); await getVision().start({ id, modelPath, mmprojPath: opts.mmproj, contextSize: opts.contextSize || 4096, gpu: !!(l && l.gpu), ...vx, ...extra }); };
      try {
        await visionTry({});
      } catch (e) {
        if (!(l && l.gpu) || ['VCREDIST', 'NO_SERVER'].includes(e.code)) throw e;
        // một bước xuống (bớt lớp, vẫn đúng ngữ cảnh) rồi mới CPU — tối đa 2 lần thử lại
        const stepped = sureLayers != null ? Math.max(1, sureLayers - (sureLayers >= 16 ? 4 : 2)) : (Number.isInteger(opts.gpuLayers) && opts.gpuLayers > 0 ? Math.max(1, opts.gpuLayers - (opts.gpuLayers >= 16 ? 4 : 2)) : partialLayers);
        let recovered = false;
        if (stepped != null) {
          try { console.warn('[engine] máy chủ nhìn ảnh hết VRAM, thử lại với ít lớp hơn: ' + stepped); await visionTry({ gpuLayers: stepped, fitTargetMiB: 0 }); recovered = true; }
          catch (e2) { if (['VCREDIST', 'NO_SERVER'].includes(e2.code)) throw e2; }
        }
        if (!recovered) {
          console.warn('[engine] máy chủ nhìn ảnh lỗi với GPU, thử lại bằng CPU: ' + e.message);
          await getVision().stop().catch(() => {});
          await getVision().start({ id, modelPath, mmprojPath: opts.mmproj, contextSize: opts.contextSize || 4096, gpu: false, ...vx, gpuLayers: 0, fitTargetMiB: 0 });
        }
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
    // f16 người dùng chọn không được biến thành “chưa đặt” rồi bị ép q8. Chỉ 'q8_0' rõ ràng mới nhân KV 0,55.
    const kvType = opts.kvType === 'f16' || opts.kvType === 'q8_0' ? opts.kvType : 'auto';
    // node-llama-cpp đặt n_ubatch = n_batch. Lô 2048 của perf trên thẻ 12 GB làm bộ đệm tính toán ~1,9 GB. Mặc định 512, tối đa 2048.
    const batchCap = Math.max(1, Math.min(Number.isInteger(opts.batchSize) ? opts.batchSize : 512, 2048));
    let weightBytes = 0;
    try { const s = require('./gguf').summarize(modelPath); weightBytes = s.weightBytes || 0; if (s.kvPerToken && !(geo.kvPerToken > 0)) geo.kvPerToken = s.kvPerToken; if (s.layers && !geo.layers) geo.layers = s.layers; } catch {}
    let plans = oomSchedule(loadPlans({ gpu: l.gpu, vram, fileSize, geo, ctx: ctxMax, userLayers: opts.gpuLayers, kvScale: kvType === 'q8_0' ? 0.55 : 1, kvType, minCtx: opts.minContextSize || 8192, capLayers: opts.capLayers, safe: !!opts.safe, batchSize: batchCap, weightBytes }));
    if (opts.singleTry) plans = plans.slice(0, 1);
    const userFlash = explicitFlash(opts.flashAttention, pf.flashAttention);
    // B190: ghim đúng ngữ cảnh của phương án (không để node-llama-cpp tự cắt từ max xuống min). Hết VRAM thì ném lỗi và bước xuống.
    // ignoreMemorySafetyChecks chỉ khi kế hoạch confident (tensor thật + lề + không phải GPU tích hợp).
    const ctxOpts = (plan, kv, fa) => ({ contextSize: plan.ctx, batchSize: Math.max(1, Math.min(batchCap, plan.ctx)), flashAttention: fa, ...(plan.confident ? { ignoreMemorySafetyChecks: true } : {}),
      ...(pf.threads ? { threads: pf.threads } : {}),
      ...(kv ? { experimentalKvCacheKeyType: 'Q8_0', experimentalKvCacheValueType: 'Q8_0' } : {}) });
    const LF = require('./load-fail');
    const GS = require('./gpu-speed');
    let abandoned = false, oomGpu = null, steppedSlow = null, probeSpent = 0;
    let devices = [];
    try { devices = l.getGpuDeviceNames ? await l.getGpuDeviceNames() : []; } catch { devices = []; }
    const gpuBw = require('./fit').gpuBandwidth({ devices, vram });
    for (const plan of plans) {
      const gpuPlan = plan.gpuLayers === 'auto' || Number(plan.gpuLayers) > 0;
      // gpuLayers 0 trong tiến trình GPU không phải bộ máy CPU thật (DLL ggml trùng tên). Tiến trình chính khởi động lại với AIVN_GPU=off.
      if (l.gpu && !gpuPlan) continue;
      let model = null;
      try {
        console.log(`[engine] thử nạp ${plan.mode}, ${plan.gpuLayers} lớp GPU, ngữ cảnh ${plan.ctx}`);
        const report = (pct) => { try { progressCb && progressCb({ id, pct, mode: plan.mode, gpuLayers: plan.gpuLayers, ctx: plan.ctx }); } catch {} };
        report(0);
        let lastPct = -1; model = await l.loadModel({ modelPath, gpuLayers: plan.gpuLayers, onLoadProgress: (x) => { const pct = Math.floor(x * 100); if (pct >= lastPct + 2 || pct === 100) { lastPct = pct; report(pct); } }, ...(opts.useMmap === false ? { useMmap: false } : {}), ...(opts.useMlock ? { useMlock: true } : {}) });
        const tries = contextTries(userFlash, plan.kv === 'q8_0' || kvType === 'q8_0');
        let context = null, kvUsed = false, faUsed = tries[0].fa;
        for (let i = 0; i < tries.length; i++) {
          const tryOf = tries[i];
          try { context = await model.createContext(ctxOpts(plan, tryOf.kv, tryOf.fa)); kvUsed = !!tryOf.kv; faUsed = tryOf.fa; break; }
          catch (e) {
            if (i === tries.length - 1) throw e;
            // q8 cần FA: lỗi tạo ngữ cảnh → thử lại FA tắt và KV f16. Mọi lỗi tạo ngữ cảnh khác cũng được lần thử FA tắt này.
            attempts.push({ mode: `${plan.mode}${tryOf.kv ? ' KV q8_0' : ''} FA ${tryOf.fa === true ? 'on' : tryOf.fa}`, message: String(e && e.message || e), context: true });
          }
        }
        let tokenPredictor; if (pf.lookup) { try { const { InputLookupTokenPredictor } = await getLib(); tokenPredictor = new InputLookupTokenPredictor(); } catch {} }
        const draft = { id, path: modelPath, model, context, tokenPredictor, loadedAt: Date.now(), mode: plan.mode, meta: { name: geo.name, arch: geo.arch, sizeLabel: geo.sizeLabel, toolTemplate: geo.toolTemplate, trainCtx: geo.trainCtx || null }, gpuLayers: model.gpuLayers, totalLayers: geo.layers ? geo.layers + 1 : null, attempts: attempts.map(a => a.mode + ': ' + a.message),
          offload: { gpu: Number.isInteger(plan.gpuLayers) ? plan.gpuLayers : model.gpuLayers, ctx: plan.ctx, requestedCtx: ctxMax, kv: kvUsed ? 'q8_0' : 'f16', oom: abandoned, ...(oomGpu > 0 ? { oomGpu } : {}), confident: !!plan.confident },
          perf: { threads: pf.threads || l.cpuMathCores || null, batchSize: Math.max(1, Math.min(batchCap, plan.ctx)), kv: kvUsed ? 'q8_0' : 'f16', flashAttention: context.flashAttention ?? faUsed, lookup: !!tokenPredictor, profile: pf.effective || null } };
        // Trần nhớ từ lần nạp trước (capLayers) mà lần này nạp đúng mức đó: không đo tốc độ lại. Kế hoạch mới vẫn đo.
        const atRememberedCap = Number.isInteger(opts.capLayers) && opts.capLayers > 0 && plan.gpuLayers === opts.capLayers;
        if (gpuPlan && !atRememberedCap && !(vram && vram.integratedOnly) && !opts.skipSpeedProbe && process.env.AIVN_SKIP_SPEED_PROBE !== '1') {
          // Chưa công bố current: status() vẫn báo đang nạp. generate và chatStep đợi whenReady đến mô hình cuối.
          const layersOn = Number.isInteger(plan.gpuLayers) ? plan.gpuLayers : (Number(model.gpuLayers) || 0);
          const totalL = geo.layers ? geo.layers + 1 : layersOn;
          const gpuFrac = totalL > 0 ? Math.min(1, layersOn / totalL) : 1;
          const expected = GS.expectedTps({ bytes: fileSize, gpuFrac, gpuBw });
          const windowMs = GS.probeWindow(probeSpent);
          let measured = null;
          if (windowMs > 0) {
            const tProbe = Date.now();
            measured = typeof opts.measureSpeed === 'function' ? await opts.measureSpeed({ plan, fileSize, expected }) : await runSpeedProbe(draft, windowMs);
            probeSpent += Date.now() - tProbe;
          }
          const after = await vramInfo(l).catch(() => null);
          const decision = GS.shouldStepDown({ tps: measured && measured.tps, expected, tokens: measured && measured.tokens, freeBytes: after && after.freeKnown ? after.free : null });
          if (decision.step) {
            const tps = measured && Number(measured.tps) > 0 ? Math.round(measured.tps) : null;
            const exp = expected > 0 ? Math.round(expected) : null;
            steppedSlow = { tps, expected: exp, reason: decision.reason };
            abandoned = true;
            if (Number.isInteger(plan.gpuLayers) && plan.gpuLayers > 0) oomGpu = oomGpu == null ? plan.gpuLayers : Math.min(oomGpu, plan.gpuLayers);
            attempts.push({ mode: `${plan.mode} (${plan.gpuLayers} lớp GPU, ngữ cảnh ${plan.ctx})`, message: decision.reason === 'vram' ? 'VRAM trống gần hết sau khi nạp' : `chậm: ${tps == null ? '?' : tps} token/giây`, slow: true });
            console.log(`[engine] ${plan.mode} quá chậm hoặc hết VRAM trống (${decision.reason}), bước xuống`);
            try { await context.dispose(); } catch {}
            try { await model.dispose(); } catch {}
            continue;
          }
        }
        if (steppedSlow) {
          draft.slow = steppedSlow;
          draft.offload = { ...draft.offload, oom: true, slow: steppedSlow, ...(oomGpu > 0 ? { oomGpu } : {}) };
        }
        draft.attempts = attempts.map(a => a.mode + ': ' + a.message);
        current = draft;
        return status();
      } catch (e) {
        current = null;
        abandoned = true;
        if (Number.isInteger(plan.gpuLayers) && plan.gpuLayers > 0) oomGpu = oomGpu == null ? plan.gpuLayers : Math.min(oomGpu, plan.gpuLayers);
        attempts.push({ mode: `${plan.mode} (${plan.gpuLayers} lớp GPU, ngữ cảnh ${plan.ctx})`, message: String(e && e.message || e), stack: String(e && e.stack || '') });
        try { if (model) await model.dispose(); } catch {}
        // Hết VRAM thì đi tiếp thang lớp. Lỗi tệp / kiến trúc thì dừng: mỗi lần thử thêm chỉ lặp cùng một lỗi.
        if (!LF.isMemoryError(e && e.message)) break;
      }
    }
    const err = new Error(attempts.length ? attempts[attempts.length - 1].message : 'Không đủ VRAM để nạp mô hình trên GPU');
    err.code = 'LOAD_FAILED'; err.attempts = attempts; err.gpu = !!l.gpu; err.slow = steppedSlow;
    err.memory = !attempts.length || LF.wantsCpuLadder(attempts);
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
  // B123: bộ máy THẬT đang chạy mô hình nhìn ảnh (llama-server), không phải GPU của node-llama-cpp.
  // Kiểm tra trước cờ loading: exclusiveLoad vẫn giữ loading lúc return status() sau khi visionOn đã bật.
  if (visionOn) { const v = getVision().status(); if (v) return { loaded: true, id: v.id, path: v.path, contextSize: v.contextSize, vision: true, gpu: llama && llama.gpu, backend: serverBackend(v), gpuLayers: v.gpuLayers ?? null, totalLayers: v.totalLayers ?? null, device: v.device || null, toolMode: v.textTools ? 'text' : 'native', runtime: v.runtime || 'bundled', runtimeFallback: v.runtimeFallback || null, meta: v.template ? { toolTemplate: !!v.template.nativeTools } : null }; }
  // Đang nạp, đang đo tốc độ hoặc đang bước xuống: current chưa được công bố. Không báo loaded.
  // exclusiveLoad đặt loading trước khi fn chạy; mô hình chữ đã công bố (current) vẫn là loaded.
  if (loading && !current) return { loaded: false, loading: true };
  return current ? { loaded: true, id: current.id, path: current.path, contextSize: current.context.contextSize, gpu: llama && llama.gpu, mode: current.mode, gpuLayers: current.gpuLayers, totalLayers: current.totalLayers, toolMode: current.toolMode || null, chatWrapper: current.chatWrapper || null, meta: current.meta || null, perf: current.perf || null, offload: current.offload || null, slow: current.slow || null, fallbackFrom: current.attempts && current.attempts.length ? current.attempts : null } : { loaded: false, loading: false };
}

// Đợi lần nạp đang chạy, kể cả khi một lần nạp khác nối đuôi (đổi A sang B). Có hạn, và dừng được theo AbortSignal.
const LOAD_WAIT_MS = 10 * 60 * 1000;
function abortErr() { const e = new Error('Đã dừng.'); e.name = 'AbortError'; return e; }
function waitOrAbort(promise, ms, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(done, ms);
    function done(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (err) reject(err); else resolve();
    }
    function onAbort() { done(abortErr()); }
    if (signal) {
      if (signal.aborted) done(abortErr());
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    Promise.resolve(promise).then(() => done(), () => done());
  });
}
async function whenReady(signal) {
  const deadline = Date.now() + LOAD_WAIT_MS;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) throw abortErr();
    const pending = loading;
    if (pending) {
      await waitOrAbort(pending.catch(() => {}), Math.max(1, deadline - Date.now()), signal);
      continue;
    }
    return status();
  }
  return status();
}
async function waitPublished(signal) {
  const deadline = Date.now() + LOAD_WAIT_MS;
  while (Date.now() < deadline) {
    const st = await whenReady(signal);
    if (loading) continue;
    if (st && st.loaded) return st;
    throw new Error('Chưa nạp mô hình nào.');
  }
  if (status().loaded) return status();
  throw new Error('Chưa nạp mô hình nào.');
}
function enqueueWhenReady(signal, run, onAbort) {
  const go = async () => {
    await waitPublished(signal);
    for (;;) {
      const ticket = current;
      const sawVision = visionOn;
      const wrapped = async () => {
        if (loading || current !== ticket || visionOn !== sawVision) {
          const e = new Error('đang nạp');
          e.code = 'RETRY_LOAD';
          throw e;
        }
        return run();
      };
      try {
        const p = queue.then(wrapped, wrapped);
        queue = p.catch(() => {});
        return await p;
      } catch (e) {
        if (e && e.code === 'RETRY_LOAD') { await waitPublished(signal); continue; }
        throw e;
      }
    }
  };
  return go().catch((e) => {
    if (e && e.name === 'AbortError') return onAbort();
    throw e;
  });
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
  return enqueueWhenReady(signal, run, () => ({ text: '', thought: null, finishReason: 'abort', stopReason: 'abort', usage: { completion_tokens: 0, tokensPerSecond: 0, seconds: 0, ttft: null, contextTokens: null, contextSize: null } }));
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
  return enqueueWhenReady(signal, runSafe, () => ({ text: '', toolCalls: [], finishReason: 'abort', usage: { completion_tokens: 0, tokensPerSecond: 0, seconds: 0 } }));
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
module.exports = { setLoadProgress, loadPlans, oomSchedule, explicitFlash, flashForContext, contextTries, modelGeometry, vramInfo, countTokens, countTokensAsync, hardwareInfo, gpuDriverKey, loadModel, unloadModel, status, whenReady, generate, chatStep, toChatHistory, getLlama, loadEmbedder, unloadEmbedder, embedStatus, embed, embedCount, exclusiveLoad };

// B123: llama-server CUDA → 'cuda'; bản đi kèm → vulkan (Windows) / metal (Mac) / cpu (Linux); 0 lớp lên GPU → 'cpu'
function serverBackend(v) { if (!v) return null; if (v.gpuLayers === 0) return 'cpu'; if (v.runtime === 'cuda') return 'cuda'; return process.platform === 'win32' ? 'vulkan' : process.platform === 'darwin' ? 'metal' : 'cpu'; }
module.exports.serverBackend = serverBackend;
