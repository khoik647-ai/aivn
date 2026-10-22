'use strict';
// POST /v1/embeddings: một tiến trình llama-server riêng với --embeddings.
// Chỉ khởi động khi có yêu cầu, một lần spawn dù nhiều yêu cầu đến cùng lúc, tắt sau một khoảng rảnh.
// GPU ≤ 4 GB, GPU tích hợp, hoặc mô hình trò chuyện đang nạp mà VRAM còn ít → -ngl 0 hoặc vài lớp.
// Không tự tải mô hình. Hỏi đáp tài liệu (RAG) vẫn dùng mô hình nhúng trong tiến trình engine.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const gguf = require('./gguf');
const NAMES = require('./model-names');
const VS = require('./vision-server');

const EMBED_ARCH = new Set(['bert', 'nomic-bert', 'jina-bert', 'jina-bert-v2', 'neo-bert', 'xlm-roberta']);
const EMBED_RE = /(^|[-_.])(embed|embedding|bge-m3|bge-small|bge-base|bge-large|multilingual-e5|e5-(small|base|large)|nomic-embed|gte-)/i;
const SPLIT_RE = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;
const POOL = { 1: 'mean', 2: 'cls', 3: 'last', 4: 'rank', mean: 'mean', cls: 'cls', last: 'last', rank: 'rank' };
const DLL_NOT_FOUND = [3221225781, -1073741515];
const GB = 1024 * 1024 * 1024;
const DEFAULT_IDLE_MS = 5 * 60 * 1000;
// Chưa nạp mô hình trò chuyện: không bỏ -ngl (llama-server sẽ đẩy hết lớp lên GPU và giữ VRAM đến khi tiến trình tắt).
const EMBED_IDLE_NGL = 8;
const MAX_STRING_CHARS = 100000;
const MAX_TOTAL_CHARS = 1000000;
const MAX_EMBED_BODY = 2 * 1024 * 1024;
const META_CACHE_MAX = 64;

class EmbedError extends Error {
  constructor(msg, status = 500, code) { super(msg); this.status = status; this.code = code; }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function poolingOf(kv, arch) {
  const v = kv[`${arch}.pooling_type`];
  if (v == null) return null;
  if (typeof v === 'string') return POOL[v.toLowerCase()] || null;
  if (typeof v === 'number') return POOL[v] || null;
  return null;
}

// Ngữ cảnh huấn luyện, kẹp 128–8192. -c, -b và -ub dùng cùng số này (mặc định llama-server chỉ nhận 512 token nếu thiếu -ub).
function contextLimit(train) {
  const n = Number(train);
  const ctx = Number.isFinite(n) && n > 0 ? Math.floor(n) : 512;
  return Math.min(8192, Math.max(128, ctx));
}

// Đọc siêu dữ liệu theo mtime + kích thước: /v1/models gọi lại nhiều lần, không parse GGUF mỗi lần.
const metaCache = new Map();
let metaReads = 0;
function inspectFile(file) {
  const base = path.basename(file);
  if (!/\.gguf$/i.test(base) || /mmproj/i.test(base)) return null;
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = path.resolve(file);
  const hit = metaCache.get(key);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.info;
  let meta;
  try { meta = gguf.readMeta(file); } catch { return null; }
  metaReads += 1;
  const kv = meta.kv || {};
  const arch = String(kv['general.architecture'] || '');
  const pooling = poolingOf(kv, arch);
  const byArch = EMBED_ARCH.has(arch);
  const byPool = !!pooling;
  const byName = EMBED_RE.test(base);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const info = (!byArch && !byPool && !byName) ? null : {
    arch: arch || null,
    pooling,
    dims: num(kv[`${arch}.embedding_length`]),
    context: num(kv[`${arch}.context_length`]),
    size: meta.size,
  };
  if (metaCache.size >= META_CACHE_MAX) metaCache.delete(metaCache.keys().next().value);
  metaCache.set(key, { mtime: st.mtimeMs, size: st.size, info });
  return info;
}

// Id mô hình nhúng không được nằm trong danh sách trò chuyện (kể cả khi tên tệp không khớp EMBED_RE).
function chatIdsExcept(chatIds, embedModels) {
  const skip = new Set((embedModels || []).map((m) => String((m && m.id) || m).toLowerCase()));
  return (chatIds || []).filter((id) => !skip.has(String(id).toLowerCase()));
}

function assertInputLengths(texts) {
  if (!Array.isArray(texts)) return;
  let total = 0;
  for (let i = 0; i < texts.length; i++) {
    const s = texts[i];
    if (typeof s !== 'string') continue;
    const n = s.length;
    if (n > MAX_STRING_CHARS) throw new EmbedError(`Chuỗi thứ ${i + 1} dài ${n} ký tự, vượt quá ${MAX_STRING_CHARS} ký tự cho một chuỗi embeddings.`, 400, 'INPUT_TOO_LONG');
    total += n;
  }
  if (total > MAX_TOTAL_CHARS) throw new EmbedError(`Tổng văn bản dài ${total} ký tự, vượt quá ${MAX_TOTAL_CHARS} ký tự cho một yêu cầu embeddings.`, 400, 'INPUT_TOO_LONG');
}

function walkGguf(dir, depth, out, seen) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (!e.isFile() || !/\.gguf$/i.test(e.name)) continue;
    const full = path.resolve(dir, e.name);
    if (seen.has(full)) continue;
    const info = inspectFile(full);
    if (!info) continue;
    seen.add(full);
    let st; try { st = fs.statSync(full); } catch { continue; }
    out.push({ id: NAMES.idFor(full, SPLIT_RE), path: full, mtime: st.mtimeMs, ...info });
  }
  if (depth > 0) for (const e of ents) if (e.isDirectory()) walkGguf(path.join(dir, e.name), depth - 1, out, seen);
}

function listEmbeddingModels(dirs) {
  const out = []; const seen = new Set();
  for (const dir of dirs || []) if (dir) walkGguf(dir, 3, out, seen);
  const used = new Set();
  for (const m of out) {
    let id = m.id;
    if (used.has(id)) id = `${id}-${used.size}`;
    used.add(id); m.id = id;
  }
  return out;
}

// 0 = CPU (-ngl 0). Số nguyên dương = ít lớp. null = mô hình trò chuyện đang nạp và VRAM còn rộng, để llama-server tự chọn.
// Chưa nạp mô hình trò chuyện trên GPU rời trên 4 GB: luôn có -ngl (EMBED_IDLE_NGL), không chiếm hết VRAM.
function gpuLayersFor({ vramTotal = 0, vramFree = null, chatLoaded = false, integratedOnly = false } = {}) {
  if (integratedOnly || !(vramTotal > 0) || vramTotal <= 4 * GB) return 0;
  if (chatLoaded) {
    const free = vramFree == null ? 0 : vramFree;
    if (free <= 2 * GB) return 0;
    if (free <= 6 * GB) return 4;
    return null;
  }
  return EMBED_IDLE_NGL;
}

function vectorsFrom(body, n) {
  let rows = null;
  if (body && Array.isArray(body.data)) rows = body.data;
  else if (Array.isArray(body)) rows = body;
  else if (body && Array.isArray(body.embedding)) rows = [{ index: 0, embedding: body.embedding }];
  if (!rows) throw new EmbedError('Máy nhúng trả về dữ liệu không đọc được', 503);
  const sorted = rows.slice().sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  if (sorted.length !== n) throw new EmbedError('Máy nhúng trả về số vector không khớp', 503);
  return sorted.map((row) => toF32(row.embedding != null ? row.embedding : row));
}
function toF32(e) {
  if (!Array.isArray(e) || !e.length) throw new EmbedError('Vector nhúng rỗng', 503);
  if (Array.isArray(e[0])) {
    const d = e[0].length;
    const o = new Float32Array(d);
    for (const row of e) for (let i = 0; i < d; i++) o[i] += Number(row[i]) || 0;
    let n = 0;
    for (let i = 0; i < d; i++) { o[i] /= e.length; n += o[i] * o[i]; }
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < d; i++) o[i] /= n;
    return o;
  }
  return Float32Array.from(e, (x) => Number(x) || 0);
}

function createEmbedServer({ log = () => {}, idleMs, healthMs = 120000, findExe = null, gpuLayers = () => 0 } = {}) {
  const idle = Number.isFinite(idleMs) ? idleMs : (Number(process.env.AIVN_EMBED_IDLE_MS) > 0 ? Number(process.env.AIVN_EMBED_IDLE_MS) : DEFAULT_IDLE_MS);
  const locate = findExe || VS.findServer;
  let proc = null, port = 0, key = '', current = null, wanted = null, timer = null, spawns = 0, lastArgs = null, truncatedCount = 0, lastId = null;
  let chain = Promise.resolve();

  function enqueue(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }
  function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!(idle > 0) || !proc) return;
    timer = setTimeout(() => { log('[embed] dừng llama-server sau khi rảnh'); enqueue(() => stop()).catch(() => {}); }, idle);
    if (typeof timer.unref === 'function') timer.unref();
  }
  function disarm() { if (timer) clearTimeout(timer); timer = null; }

  async function stop() {
    disarm();
    current = null;
    if (!proc) return;
    const p = proc; proc = null;
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 3000);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      try { p.kill(); } catch { clearTimeout(t); resolve(); }
    });
  }

  async function postJson(pathname, obj) {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify(obj),
      signal: AbortSignal.timeout(healthMs),
    });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json, text };
  }

  async function fetchEmbeddings(texts) {
    let r;
    try { r = await postJson('/v1/embeddings', { input: texts }); }
    catch (e) { throw new EmbedError('Máy nhúng không phản hồi: ' + (e.message || e), 503, 'NO_RESPONSE'); }
    if (r.status === 404 || r.status === 405) {
      try { r = await postJson('/embedding', { content: texts.length === 1 ? texts[0] : texts }); }
      catch (e) { throw new EmbedError('Máy nhúng không phản hồi: ' + (e.message || e), 503, 'NO_RESPONSE'); }
    }
    if (r.status >= 400 || !r.json) throw new EmbedError('Máy nhúng trả lỗi' + (r.text ? ': ' + String(r.text).slice(0, 180) : ''), 503, 'BAD_RESPONSE');
    try { return vectorsFrom(r.json, texts.length); }
    catch (e) {
      if (texts.length < 2) throw e;
      const all = [];
      for (const t of texts) {
        const one = await postJson('/embedding', { content: t });
        if (!one.json || one.status >= 400) throw new EmbedError('Máy nhúng trả lỗi khi nhúng từng chuỗi', 503, 'BAD_RESPONSE');
        all.push(vectorsFrom(Array.isArray(one.json) ? one.json : one.json, 1)[0]);
      }
      return all;
    }
  }

  // Cùng cách engine.embed: tokenize, nếu dài hơn ngữ cảnh − 4 thì detokenize phần đầu. Không có cờ cắt trong phản hồi API.
  async function clipTexts(texts) {
    const ctx = (current && current.ctx) || contextLimit(wanted && wanted.context);
    const limit = Math.max(1, ctx - 4);
    const out = [];
    let n = 0;
    for (const raw of texts) {
      const text = String(raw);
      let tokens = null;
      try {
        const r = await postJson('/tokenize', { content: text });
        if (r.status < 400 && r.json && Array.isArray(r.json.tokens)) tokens = r.json.tokens;
      } catch { tokens = null; }
      if (!tokens) {
        if (text.length > limit) { out.push(text.slice(0, limit)); n += 1; } else out.push(text);
        continue;
      }
      if (tokens.length <= limit) { out.push(text); continue; }
      const slice = tokens.slice(0, limit);
      let next = null;
      try {
        const r = await postJson('/detokenize', { tokens: slice });
        const content = r.json && (typeof r.json.content === 'string' ? r.json.content : (typeof r.json.text === 'string' ? r.json.text : null));
        if (r.status < 400 && content) next = content;
      } catch { next = null; }
      if (next == null) next = text.slice(0, Math.max(1, Math.floor(text.length * limit / tokens.length)));
      out.push(next);
      n += 1;
    }
    if (n) {
      truncatedCount += n;
      log(`[embed] đã cắt ${n} chuỗi còn ${limit} token (ngữ cảnh ${ctx})`);
    }
    return out;
  }

  async function launch(exe, target, ngl, ctx) {
    port = await freePort();
    key = crypto.randomBytes(18).toString('hex');
    const args = ['-m', target.path, '--embeddings', '--host', '127.0.0.1', '--port', String(port), '--api-key', key, '-c', String(ctx), '-b', String(ctx), '-ub', String(ctx), '-np', '1', '--no-webui', '--offline'];
    if (target.pooling && target.pooling !== 'none') args.push('--pooling', target.pooling);
    if (Number.isInteger(ngl)) args.push('-ngl', String(ngl));
    lastArgs = args.slice();
    const tail = [];
    const child = spawn(exe, args, { cwd: path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, LLAMA_ARG_HOST: '127.0.0.1' } });
    proc = child; spawns += 1;
    VS.LIVE.add(child);
    try { if (child.pid && VS.HOOKS.spawn) VS.HOOKS.spawn(child.pid); } catch {}
    try { if (process.send && child.pid) process.send({ type: 'child', pid: child.pid }); } catch {}
    child.once('exit', () => {
      VS.LIVE.delete(child);
      try { if (child.pid && VS.HOOKS.exit) VS.HOOKS.exit(child.pid); } catch {}
      if (proc === child) { proc = null; current = null; }
    });
    const onData = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { tail.push(l); if (tail.length > 40) tail.shift(); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    let spawnErr = null;
    child.on('error', (e) => { spawnErr = e; tail.push(String(e && e.message || e)); });
    const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    const t0 = Date.now();
    while (true) {
      const r = await Promise.race([exited.then((x) => ({ exit: x })), new Promise((res) => setTimeout(res, 40, null))]);
      if (spawnErr || (r && r.exit) || proc !== child) {
        if (proc === child) proc = null;
        const code = r && r.exit ? r.exit.code : null;
        if (process.platform === 'win32' && DLL_NOT_FOUND.includes(code)) throw new EmbedError('Máy thiếu Microsoft Visual C++ Redistributable (x64), cần cho llama-server.', 503, 'VCREDIST');
        const last = tail.filter((l) => /error|failed|unknown|unsupported/i.test(l)).slice(-2).join(' · ');
        const why = spawnErr ? spawnErr.message : `mã ${code}`;
        throw new EmbedError('Không khởi động được máy nhúng' + (last ? ': ' + last.slice(0, 300) : ` (${why})`), 503, 'START_FAILED');
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
      } catch {}
      if (Date.now() - t0 > healthMs) {
        try { child.kill('SIGKILL'); } catch {}
        if (proc === child) proc = null;
        throw new EmbedError('Máy nhúng khởi động quá lâu.', 503, 'TIMEOUT');
      }
    }
  }

  async function start(target) {
    if (proc && current && current.path === target.path) { arm(); return { id: current.id }; }
    if (lastId && lastId !== target.id) log(`[embed] đổi mô hình ${lastId} → ${target.id}, khởi động lại llama-server`);
    await stop();
    const exe = locate();
    if (!exe || !fs.existsSync(exe)) throw new EmbedError('Không tìm thấy llama-server để tạo embeddings. Hãy cài lại AIVN.', 503, 'NO_SERVER');
    let ngl = 0;
    try { ngl = await Promise.resolve(gpuLayers(target)); } catch { ngl = 0; }
    if (ngl != null && (!Number.isInteger(ngl) || ngl < 0)) ngl = 0;
    const ctx = contextLimit(target.context);
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await launch(exe, target, ngl, ctx);
        current = { id: target.id, path: target.path, ctx };
        lastId = target.id;
        log(`[embed] llama-server --embeddings sẵn sàng (cổng ${port}, mô hình ${target.id})`);
        arm();
        return { id: current.id };
      } catch (e) {
        lastErr = e;
        if (proc) { try { proc.kill('SIGKILL'); } catch {} proc = null; }
        if (e.code !== 'START_FAILED' || attempt === 1) throw e;
        log('[embed] không giữ được cổng, thử cổng khác');
      }
    }
    throw lastErr;
  }

  function resolve(model, { models = [], fallbackId = '', chatIds = null, chatMessage = null } = {}) {
    const want = model == null ? '' : String(model).trim();
    const by = (id) => models.find((m) => m.id === id || m.id.toLowerCase() === String(id).toLowerCase());
    // Có trong danh sách nhúng thì là mô hình nhúng, kể cả khi tên tệp cũng lọt vào danh sách trò chuyện.
    if (want) {
      const hit = by(want);
      if (hit) return hit;
      const chatSet = new Set((Array.isArray(chatIds) ? chatIds : []).map((id) => String(id).toLowerCase()));
      if (chatSet.has(want.toLowerCase()) && want.toLowerCase() !== String(fallbackId || '').toLowerCase()) {
        const msg = typeof chatMessage === 'function' ? chatMessage(want) : `"${want}" là mô hình trò chuyện, không tạo embeddings được. Dùng "${fallbackId}" (hoặc bỏ trường "model").`;
        throw new EmbedError(msg, 400, 'CHAT_MODEL');
      }
    }
    const fb = (fallbackId && by(fallbackId)) || models[0];
    if (fb) return fb;
    throw new EmbedError('Chưa có mô hình nhúng. Hãy tải một tệp GGUF nhúng (ví dụ nomic-embed-text hoặc bge-small), hoặc BGE-M3 trong AIVN → Cài đặt → Tìm kiếm tài liệu. AIVN không tự tải mô hình này.', 400, 'NO_MODEL');
  }

  async function open(target) {
    if (!target || !target.path) throw new EmbedError('Thiếu mô hình nhúng.', 400, 'NO_MODEL');
    wanted = target;
    return enqueue(() => start(target));
  }
  async function embed(texts) {
    if (!Array.isArray(texts) || !texts.length || texts.some((t) => typeof t !== 'string')) throw new EmbedError('Thiếu văn bản để nhúng.', 400, 'BAD_INPUT');
    assertInputLengths(texts);
    return enqueue(async () => {
      if (!proc) {
        if (!wanted) throw new EmbedError('Chưa khởi động được máy nhúng.', 503, 'NOT_STARTED');
        await start(wanted);
      }
      disarm();
      try { return await fetchEmbeddings(await clipTexts(texts)); }
      finally { arm(); }
    });
  }
  async function count(texts) {
    const list = Array.isArray(texts) ? texts : [];
    return enqueue(async () => {
      if (!proc) return list.reduce((s, t) => s + Math.ceil(String(t).length / 3), 0);
      disarm();
      let n = 0;
      try {
        for (const t of list) {
          try {
            const r = await postJson('/tokenize', { content: String(t) });
            const len = r.json && Array.isArray(r.json.tokens) ? r.json.tokens.length : 0;
            n += len || Math.ceil(String(t).length / 3);
          } catch { n += Math.ceil(String(t).length / 3); }
        }
      } finally { arm(); }
      return n;
    });
  }

  return {
    list: (dirs) => listEmbeddingModels(dirs),
    resolve, open, embed, count, stop: () => enqueue(() => stop()),
    stats: () => ({ spawns, running: !!proc, lastArgs, pid: proc && proc.pid || null, idleMs: idle, truncated: truncatedCount }),
  };
}

function inspectCacheStats() { return { reads: metaReads }; }

module.exports = {
  createEmbedServer, listEmbeddingModels, gpuLayersFor, inspectFile, inspectCacheStats, EmbedError, EMBED_RE, DEFAULT_IDLE_MS,
  contextLimit, chatIdsExcept, assertInputLengths, EMBED_IDLE_NGL, MAX_STRING_CHARS, MAX_TOTAL_CHARS, MAX_EMBED_BODY,
};
