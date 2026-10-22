const SMP = require('./agent/sampling');
const TP = require('./agent/textproto');
// Chế độ "nhìn ảnh": chạy llama-server chính thức của llama.cpp (MIT) với --mmproj cho mô hình thị giác.
// Chỉ dùng cho mô hình có tệp mmproj; mô hình chữ thường vẫn chạy bằng node-llama-cpp.
// Máy chủ chỉ nghe 127.0.0.1, cổng ngẫu nhiên, có khoá API ngẫu nhiên theo phiên.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
// Đọc luồng SSE theo BYTE: giữ phần byte dở của một chữ UTF-8 nhiều byte (tiếng Việt 2–3 byte) sang gói sau (TextDecoder stream:true)
// và phần dòng dở sang lần sau. Trả các đối tượng JSON của từng dòng "data:".
function sseParser() {
  const dec = new TextDecoder('utf-8'); let buf = '';
  return {
    push(chunk) {
      buf += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
      const out = []; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim(); if (data === '[DONE]') continue;
        try { out.push(JSON.parse(data)); } catch {}
      }
      return out;
    },
  };
}
// Windows: STATUS_DLL_NOT_FOUND khi thiếu Microsoft Visual C++ Redistributable
const DLL_NOT_FOUND = [3221225781, -1073741515];

function findServer() {
  const plat = process.platform === 'win32' ? 'win' : process.platform;
  const cands = [process.env.AIVN_LLAMA_SERVER,
    process.env.AIVN_RESOURCES && path.join(process.env.AIVN_RESOURCES, 'llama', EXE),
    path.join(__dirname, '..', 'build', 'llama', `${plat}-${process.arch}`, EXE)].filter(Boolean);
  return cands.find(p => fs.existsSync(p)) || null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// B13: mọi llama-server đang chạy trong tiến trình này — để giết ĐỒNG BỘ khi tiến trình sắp mất (không chờ dỡ mô hình)
const LIVE = new Set(); const HOOKS = { spawn: null, exit: null }; // HOOKS: chạy trong Electron (AIVN_INPROC) thì tiến trình chính ghi pid vào tệp
function killAllSync() { for (const p of LIVE) { try { p.kill('SIGKILL'); } catch {} } LIVE.clear(); }
class VisionError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

// B107: thiết bị của llama-server: `llama-server --list-devices` in “CUDA0: NVIDIA GeForce RTX 4070 SUPER (12281 MiB, 11071 MiB free)”
function parseDevices(text) {
  const out = [];
  for (const l of String(text || '').split(/\r?\n/)) { const m = /^\s*((?:CUDA|Vulkan|Metal|ROCm|SYCL|CPU)\d*)\s*:\s*(.+?)\s*(?:\((\d+)\s*MiB(?:,\s*(\d+)\s*MiB free)?\))?\s*$/i.exec(l); if (m) out.push({ id: m[1], name: m[2].trim(), totalMiB: m[3] ? +m[3] : null, freeMiB: m[4] ? +m[4] : null }); }
  return out;
}
const devCache = new Map();
function listDevices(exe, { timeoutMs = 20000, allDevices = false } = {}) {
  let st = null; try { st = fs.statSync(exe); } catch { return Promise.resolve({ ok: false, cuda: [], all: [], error: 'không thấy ' + exe }); }
  // allDevices: liệt kê MỌI GPU kể cả khi người dùng đã giới hạn bằng GGML_VK_VISIBLE_DEVICES (bộ chọn GPU cần cả danh sách)
  const env = { ...process.env }; if (allDevices) delete env.GGML_VK_VISIBLE_DEVICES;
  const key = `${exe}|${st.mtimeMs}|${st.size}|${env.GGML_VK_VISIBLE_DEVICES || ''}`; if (devCache.has(key)) return devCache.get(key);
  const p = new Promise((resolve) => {
    require('child_process').execFile(exe, ['--list-devices'], { cwd: path.dirname(exe), env, timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (e, out, err) => {
      const all = parseDevices(`${out || ''}\n${err || ''}`);
      if (e && !all.length) return resolve({ ok: false, cuda: [], all, error: String(e.message || e).split('\n')[0] });
      resolve({ ok: true, cuda: all.filter(d => /^CUDA\d+$/i.test(d.id)), all });
    });
  });
  devCache.set(key, p); p.then(r => { if (!r.ok) devCache.delete(key); }); return p;
}

function createVisionServer({ log = () => {} } = {}) {
  let proc = null, port = 0, key = '', info = null, tail = [];

  // Runtime CUDA tải riêng (runtimes.js): thử trước; lỗi khởi động hoặc không thấy GPU NVIDIA → tự quay về bản đi kèm (Vulkan) và ghi lý do
  // B107 (máy thật beta.2.5): llama.cpp b11751 ở mức log mặc định KHÔNG in “ggml_cuda_init/using device CUDA0” → trước đây luôn coi là
  // “không thấy GPU NVIDIA”, nạp lại bằng Vulkan (thời gian nạp gấp đôi). Nay chọn CUDA theo `llama-server --list-devices` (không phụ thuộc mức log);
  // không thấy thiết bị CUDA nào → dùng ngay bản đi kèm, không nạp hai lần. Dòng log chỉ còn là tín hiệu phụ khi không dò được.
  async function start(o) {
    let fallback = null;
    if (o.serverExe && o.gpu !== false && fs.existsSync(o.serverExe)) {
      const dev = await (o.listDevices || listDevices)(o.serverExe);
      if (dev.ok && !dev.cuda.length) { fallback = 'runtime CUDA: --list-devices không thấy GPU NVIDIA nào'; log(`[vision] ${fallback} → dùng bản đi kèm (Vulkan)`); }
      else try {
        if (dev.ok) log(`[vision] --list-devices: ${dev.cuda.map(d => d.name).join(', ')}`);
        await startOn(o.serverExe, o, 'cuda');
        if (!dev.ok && !cudaSeen) throw new VisionError('runtime CUDA không thấy GPU NVIDIA nào', 'CUDA_NO_DEVICE');
        if (info) info.cudaDevices = dev.ok ? dev.cuda : null;
        return { runtime: 'cuda', runtimeFallback: null };
      } catch (e) {
        if (e.code === 'TIMEOUT') throw e;
        fallback = (e.message || String(e)).slice(0, 300);
        log(`[vision] runtime CUDA lỗi → quay về bản đi kèm (Vulkan): ${fallback}`);
        await stop();
      }
    }
    await startOn(findServer(), o, 'bundled');
    if (fallback && info) info.runtimeFallback = fallback;
    return { runtime: 'bundled', runtimeFallback: fallback };
  }
  let cudaSeen = false;
  async function startOn(exe, { id, modelPath, mmprojPath, contextSize = 4096, gpu = true, threads, batchSize, extraArgs, multiGpu = false, devicePref = null, gpuLayers = null, fitTargetMiB = 0, kvCache = null, flashAttention = null, listDevices: listDev = null }, runtime) {
    await stop();
    if (!exe) throw new VisionError('Bản AIVN này thiếu bộ máy nhìn ảnh (llama-server). Hãy cài lại AIVN.', 'NO_SERVER');
    if (runtime === 'cuda') log(`[vision] dùng runtime CUDA: ${exe}`);
    port = await freePort(); key = crypto.randomBytes(18).toString('hex'); tail = []; cudaSeen = false;
    const args = ['-m', modelPath, ...(mmprojPath ? ['--mmproj', mmprojPath] : []), ...(process.env.AIVN_TEST_CHAT_TEMPLATE ? ['--chat-template-file', process.env.AIVN_TEST_CHAT_TEMPLATE] : []), '--host', '127.0.0.1', '--port', String(port), '--api-key', key,
      '-c', String(contextSize), '-np', '1', '--no-webui', '--offline', '--jinja'];
    args.push('-lv', '4'); // B107: in “offloaded N/M layers to GPU” + thiết bị dùng (b11751 chỉ in ở mức 4) → gpuLayers/totalLayers có giá trị
    if (!gpu) args.push('-ngl', '0', ...(mmprojPath ? ['--no-mmproj-offload'] : []));
    // B168: máy có GPU tích hợp + GPU rời → chọn RÕ thiết bị (GPU rời lớn nhất, hoặc thiết bị người dùng chọn) bằng --device;
    // ước lượng/nhãn dùng đúng thiết bị đó. Chỉ dò khi node-llama-cpp thấy hơn một GPU (không tốn thời gian trên máy một GPU).
    let device = null;
    if (gpu && (multiGpu || devicePref != null)) {
      const d = await (listDev || listDevices)(exe, { timeoutMs: 10000 }).catch(() => null);
      const gpus = d && d.ok ? d.all.filter(x => !/^cpu/i.test(x.id)) : [];
      device = require('./gpu-pick').pick(gpus, devicePref);
      if (device && device.id && gpus.length > 1) { args.push('--device', device.id); log(`[vision] chọn GPU ${device.id} (${device.name})${device.manual ? ' theo cài đặt' : ' — ưu tiên GPU rời'}; có: ${gpus.map(g => g.id + ' ' + g.name).join(', ')}`); }
    }
    // B170: số lớp GPU do --fit của llama-server quyết — AIVN đặt RÕ lề VRAM (--fit-target) và ước lượng trong hộp nạp dùng CÙNG lề
    // (gguf.serverFit) nên hai số khớp nhau. Người dùng đặt số lớp → -ngl N (fit không đổi giá trị người dùng đặt).
    if (gpu && Number.isInteger(gpuLayers) && gpuLayers >= 0) args.push('-ngl', String(gpuLayers));
    else if (gpu && Number(fitTargetMiB) > 0) args.push('--fit-target', String(Math.round(fitTargetMiB)));
    if (kvCache === 'q8_0') args.push('--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '-fa', 'on');
    else if (flashAttention === true) args.push('-fa', 'on'); else if (flashAttention === false) args.push('-fa', 'off');
    if (Number(threads) > 0) args.push('-t', String(Math.round(threads)), '-tb', String(Math.round(threads)));
    if (Number(batchSize) > 0) args.push('-b', String(Math.min(Math.round(batchSize), contextSize)));
    // mô hình agent mới: --reasoning off, --n-cpu-moe N… (model-launch.js; lọc lại theo danh sách cho phép)
    const xa = require('./model-launch').sanitize(extraArgs); if (xa.length) { args.push(...xa); log(`[vision] tham số riêng của mô hình: ${xa.join(' ')}`); }
    const t0 = Date.now();
    proc = spawn(exe, args, { cwd: path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, LLAMA_ARG_HOST: '127.0.0.1' } });
    // 0.15.1: báo pid cho tiến trình chính — nếu engine-host bị giết (SIGKILL/sập), llama-server không bị bỏ lại chiếm 5–6 GB RAM/VRAM
    try { if (process.send && proc.pid) { process.send({ type: 'child', pid: proc.pid }); const p0 = proc; p0.once('exit', () => { try { process.send({ type: 'child-exit', pid: p0.pid }); } catch {} }); } } catch {}
    LIVE.add(proc); { const pp = proc; try { HOOKS.spawn && HOOKS.spawn(pp.pid); } catch {} pp.once('exit', () => { LIVE.delete(pp); try { HOOKS.exit && HOOKS.exit(pp.pid); } catch {} }); }
    let layers = null; const used = []; // B168: thiết bị llama.cpp THẬT SỰ dùng (dòng “using device … MiB free” ở -lv 4)
    const onData = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { tail.push(l); if (/ggml_cuda_init: found [1-9]|using device CUDA\d|\bCUDA0\b/.test(l)) cudaSeen = true; if (tail.length > 40) tail.shift(); const m = l.match(/offloaded (\d+)\/(\d+) layers to GPU/); if (m) { layers = { gpu: +m[1], total: +m[2] }; if (info) Object.assign(info, { gpuLayers: layers.gpu, totalLayers: layers.total }); }
      const u = /using device (\S+) \((.+?)\)(?: \([^)]*\))? - (\d+) MiB free/.exec(l); if (u && !used.some(x => x.id === u[1])) used.push({ id: u[1], name: u[2], freeMiB: +u[3] }); } };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    const exited = new Promise((resolve) => proc.once('exit', (code, signal) => resolve({ code, signal })));
    proc.once('exit', (code, signal) => { log(`[vision] llama-server kết thúc code=${code} signal=${signal}`); proc = null; info = null; });
    // Chờ /health trả 200 (mô hình + mmproj đã nạp) hoặc tiến trình thoát
    while (true) {
      const r = await Promise.race([exited.then(x => ({ exit: x })), new Promise(r => setTimeout(r, 400, null))]);
      if (r && r.exit) {
        const { code } = r.exit;
        if (process.platform === 'win32' && DLL_NOT_FOUND.includes(code)) throw new VisionError('Máy thiếu Microsoft Visual C++ Redistributable (x64), cần cho chế độ nhìn ảnh.', 'VCREDIST');
        const last = tail.filter(l => /error|failed|unknown|unsupported/i.test(l)).slice(-2).join(' · ');
        throw new VisionError('Không nạp được mô hình nhìn ảnh' + (last ? ': ' + last.slice(0, 300) : ` (mã ${code})`), 'START_FAILED');
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: 'Bearer ' + key } });
        if (res.ok) break;
      } catch {}
      if (Date.now() - t0 > 10 * 60 * 1000) { await stop(); throw new VisionError('Nạp mô hình nhìn ảnh quá lâu.', 'TIMEOUT'); }
    }
    let ctx = contextSize, template = TP.analyzeTemplate('');
    try { const p = await (await fetch(`http://127.0.0.1:${port}/props`, { headers: { authorization: 'Bearer ' + key } })).json(); ctx = p?.default_generation_settings?.n_ctx || ctx; template = TP.analyzeTemplate(p?.chat_template); } catch {}
    info = { id, path: modelPath, mmproj: mmprojPath, contextSize: ctx, vision: true, loadedAt: Date.now(), template, runtime, serverExe: exe, gpuLayers: layers ? layers.gpu : (gpu ? null : 0), totalLayers: layers ? layers.total : null, device: used.length ? used.map(x => x.name).join(' + ') : (device ? device.name : null), devicesUsed: used, deviceAll: device, textTools: template.strict || (template.known && !template.nativeTools) };
    if (info.textTools) log(`[vision] mẫu chat ${template.strict ? 'bắt buộc xen kẽ user/assistant' : 'không hỗ trợ tools'}: dùng giao thức công cụ dạng văn bản của AIVN`);
    log(`[vision] llama-server sẵn sàng (cổng ${port}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    return info;
  }

  async function stop() {
    if (!proc) return;
    const p = proc; proc = null; info = null;
    await new Promise((resolve) => { const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 3000); p.once('exit', () => { clearTimeout(t); resolve(); }); try { p.kill(); } catch { resolve(); } });
  }

  // messages kiểu OpenAI; phần ảnh: {type:'image_url', image_url:{url:'data:image/png;base64,…'}}
  async function stream(extra, messages, { temperature = 0.7, maxTokens = 1024, topP, signal, onToken, sampling = null, seed = null, stop = null, jsonSchema = null } = {}) {
    if (!info) throw new Error('Chưa nạp mô hình nhìn ảnh.');
    const t0 = Date.now();
    // chống lặp: DRY (bắt chuỗi lặp dài) + phạt lặp nhẹ; mô hình nhìn ảnh nhỏ dễ lặp câu khi mô tả
    // cache_prompt + một khe (-np 1): phần đầu lời nhắc giống lượt trước (hệ thống + công cụ của AIVN AGENT) không phải tính lại (B165)
    const body = { messages, temperature, max_tokens: maxTokens, stream: true, cache_prompt: true, stream_options: { include_usage: true }, top_k: 40, min_p: 0.05,
      repeat_penalty: 1.1, repeat_last_n: 256, presence_penalty: 0.3, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, top_p: 0.9,
      ...(extra.response_format || (extra.tool_choice && extra.tool_choice !== 'auto' && extra.tool_choice !== 'none') ? SMP.toServer(SMP.samplingFor('', 'json')) : SMP.toServer(sampling)), ...(topP != null ? { top_p: topP } : {}), ...extra };
    if (Number.isInteger(seed) && seed >= 0) { body.seed = seed; body.cache_prompt = false; } // seed: tính lại lời nhắc từ đầu như engine.js
    if (Array.isArray(stop) && stop.length) body.stop = stop.filter(x => typeof x === 'string' && x).slice(0, 8);
    if (jsonSchema) body.json_schema = jsonSchema;
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    let res; let ttft = null, thought = '';
    const empty = () => ({ text: '', toolCalls: [], finishReason: 'abort', usage: { completion_tokens: 0, tokensPerSecond: 0, seconds: 0 } });
    try {
      res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
    } catch (e) { if (signal?.aborted) return empty(); throw e; }
    if (!res.ok) { const t = await res.text().catch(() => ''); let m = t; try { m = JSON.parse(t).error.message; } catch {} throw new Error('Mô hình nhìn ảnh báo lỗi: ' + String(m).slice(0, 300)); }
    let text = '', finishReason = 'stop', usage = null, buf = '';
    const calls = []; // gom tool_calls theo index
    const sse = sseParser(); let fffd = 0;
    try {
      for await (const chunk of res.body) {
        for (const j of sse.push(chunk)) {
          const c = j.choices && j.choices[0];
          // ký tự thay thế U+FFFD: máy chủ cắt một chữ UTF-8 nhiều byte giữa hai token (“thư thử�”) — chữ thật không bao giờ là U+FFFD
          const clean = (x) => { if (typeof x !== 'string' || !x.includes('\ufffd')) return x; fffd++; return x.replace(/\ufffd/g, ''); };
          const piece = clean(c?.delta?.content); const rpiece = clean(c?.delta?.reasoning_content);
          if ((piece || rpiece) && ttft == null) ttft = (Date.now() - t0) / 1000;
          if (rpiece) { thought += rpiece; if (!extra.response_format) onToken && onToken(rpiece, 'think'); }
          if (piece) { text += piece; if (!extra.response_format) onToken && onToken(piece); }
          for (const tc of c?.delta?.tool_calls || []) {
            const k = tc.index ?? calls.length;
            calls[k] ||= { id: tc.id || '', name: '', args: '' };
            if (tc.id) calls[k].id = tc.id;
            if (tc.function?.name) calls[k].name += tc.function.name;
            if (tc.function?.arguments) calls[k].args += tc.function.arguments;
          }
          if (c?.finish_reason) finishReason = c.finish_reason;
          if (j.usage) usage = j.usage;
        }
      }
    } catch (e) { if (!signal?.aborted) throw e; finishReason = 'abort'; }
    if (fffd) log && log(`[vision] bỏ ${fffd} ký tự U+FFFD (chữ UTF-8 bị cắt giữa hai token) trong luồng của llama-server`);
    if (signal?.aborted) finishReason = 'abort';
    const secs = (Date.now() - t0) / 1000;
    const ct = usage?.completion_tokens ?? Math.ceil(text.length / 3.5);
    const toolCalls = calls.filter(Boolean).filter(c => c.name).map(c => { let a = {}; try { a = JSON.parse(c.args || '{}'); } catch { a = { _raw: c.args }; } return { id: c.id || 'call_' + crypto.randomBytes(9).toString('hex'), name: c.name, arguments: a }; });
    if (toolCalls.length && finishReason !== 'abort') finishReason = 'tool_calls';
    const gs = Math.max(0.001, secs - (ttft || 0));
    return { text: text.replace(/^\s+/, ''), thought: thought || null, toolCalls, finishReason, stopReason: finishReason === 'length' ? 'maxTokens' : finishReason === 'abort' ? 'abort' : 'eogToken', usage: { prompt_tokens: usage?.prompt_tokens, completion_tokens: ct, tokensPerSecond: ct > 1 ? (ct - 1) / gs : 0, seconds: secs, ttft, contextTokens: usage ? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0) : null, contextSize: info && info.contextSize || null } };
  }
  const generate = (messages, opts = {}) => stream({}, info && info.template && info.template.strict ? TP.normalizeMessages(messages) : messages, opts);
  // Chế độ văn bản: không gửi "tools" cho llama-server (tránh bộ sinh parser --jinja), mô tả công cụ trong lời nhắc và tự tách <tool_call>
  async function textStep(messages, { tools = [], toolChoice = 'auto', responseFormat = null, ...opts }) {
    const offer = toolChoice === 'none' ? [] : tools;
    const extra = {};
    const forced = offer.length && toolChoice && toolChoice !== 'auto' ? (typeof toolChoice === 'object' ? offer.filter(t => t.name === toolChoice.name) : offer) : null;
    if (forced && forced.length) {
      // buộc gọi công cụ: ràng buộc đầu ra JSON {"name","arguments"} bằng json_schema của llama-server
      const schema = { oneOf: forced.map(t => ({ type: 'object', properties: { name: { const: t.name }, arguments: t.parameters && t.parameters.properties && Object.keys(t.parameters.properties).length ? t.parameters : { type: 'object' } }, required: ['name', 'arguments'] })) };
      const note = { role: 'user', content: 'Chỉ trả lời bằng MỘT đối tượng JSON {"name": "<tên công cụ>", "arguments": {…}} để gọi một công cụ trong danh sách.' };
      const r = await stream({ response_format: { type: 'json_schema', json_schema: { name: 'call', schema } } }, TP.normalizeMessages([...messages, note], { tools: forced }), { ...opts, onToken: null });
      let j = null; try { j = JSON.parse(r.text); } catch {}
      if (j && typeof j.name === 'string') return { ...r, text: '', toolCalls: [{ id: 'call_' + crypto.randomBytes(9).toString('hex'), name: j.name, arguments: j.arguments || {} }], finishReason: 'tool_calls' };
      return r;
    }
    if (responseFormat) extra.response_format = responseFormat.type === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'output', schema: responseFormat.schema || {} } } : { type: 'json_object' };
    const f = TP.streamFilter(opts.onToken);
    const r = await stream(extra, TP.normalizeMessages(messages, { tools: offer }), { ...opts, onToken: (t) => f.push(t) });
    f.end();
    if (!offer.length || r.finishReason === 'abort') return r;
    const p = TP.parseToolCalls(r.text, offer.map(t => t.name));
    return { ...r, text: p.text, toolCalls: p.toolCalls, finishReason: p.toolCalls.length ? 'tool_calls' : r.finishReason };
  }
  // Có công cụ / đầu ra JSON: llama-server tự áp mẫu hội thoại (--jinja) và ngữ pháp cho tool_calls / json_schema
  // Lời nhắc dài hơn ngữ cảnh: thử lại với công cụ rút gọn + lịch sử ngắn, rồi báo rõ cách sửa
  async function chatStep(messages, o = {}) {
    try { return await chatStep1(messages, o); }
    catch (e) {
      if (!TP.CTX_RE.test(String(e && e.message))) throw e;
      try { return await chatStep1(TP.trimHistory(messages), { ...o, tools: TP.compactTools(o.tools || []) }); }
      catch (e2) { if (!TP.CTX_RE.test(String(e2 && e2.message))) throw e2; throw TP.ctxSmallError(info && info.contextSize); }
    }
  }
  async function chatStep1(messages, { tools = [], toolChoice = 'auto', responseFormat = null, ...opts } = {}) {
    if (info && (info.textTools || (info.template && info.template.strict))) return textStep(messages, { tools, toolChoice, responseFormat, ...opts });
    try { return await nativeStep(messages, { tools, toolChoice, responseFormat, ...opts }); }
    catch (e) {
      if (!TP.isTemplateError(e.message) || !info) throw e;
      // llama-server không dựng được parser cho mẫu chat này (vd. Gemma 3): chuyển hẳn sang giao thức văn bản cho mô hình này
      log('[vision] mẫu chat lỗi với --jinja/tools, chuyển sang giao thức công cụ văn bản: ' + String(e.message).slice(0, 200));
      info.textTools = true; info.template = { ...(info.template || {}), strict: true };
      return textStep(messages, { tools, toolChoice, responseFormat, ...opts });
    }
  }
  function nativeStep(messages, { tools = [], toolChoice = 'auto', responseFormat = null, ...opts } = {}) {
    const extra = {};
    if (tools.length) {
      extra.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } } }));
      extra.tool_choice = typeof toolChoice === 'object' && toolChoice ? { type: 'function', function: { name: toolChoice.name } } : toolChoice || 'auto';
      extra.parallel_tool_calls = true;
    }
    if (responseFormat) extra.response_format = responseFormat.type === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'output', schema: responseFormat.schema || {} } } : { type: 'json_object' };
    return stream(extra, messages, opts);
  }

  async function countTokens(texts) {
    if (!info) return null;
    try {
      return await Promise.all(texts.map(async (t) => (await (await fetch(`http://127.0.0.1:${port}/tokenize`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ content: t }) })).json()).tokens.length));
    } catch { return null; }
  }

  return { start, stop, generate, chatStep, countTokens, status: () => info, available: () => !!findServer(), _startOn: startOn /* kiểm thử: đối số dòng lệnh */ };
}

module.exports = { sseParser, createVisionServer, findServer, VisionError, killAllSync, LIVE, HOOKS, parseDevices, listDevices };
