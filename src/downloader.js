// Hàng đợi tải mô hình: tải tiếp (Range), nhiều tệp/phần, tốc độ & thời gian còn lại, tự thử lại khi rớt mạng.
// Token Hugging Face chỉ gửi tới huggingface.co (tự xử lý chuyển hướng), không bao giờ ghi ra log.
const fs = require('fs');
const path = require('path');
const NAMES = require('./model-names');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const HF_HOST = 'huggingface.co';
const RETRIES = 4;

function friendlyHttp(status) {
  if (status === 401 || status === 403) return 'Mô hình này yêu cầu đăng nhập hoặc chấp nhận giấy phép trên Hugging Face. Hãy chấp nhận giấy phép trên trang của mô hình, rồi nhập HF token trong Khám phá → Token Hugging Face.';
  if (status === 404) return 'Không tìm thấy tệp trên Hugging Face (có thể đã bị đổi tên hoặc xoá).';
  if (status === 429) return 'Hugging Face đang giới hạn lượt tải, vui lòng thử lại sau.';
  return `Máy chủ trả về lỗi ${status}.`;
}
const isTransient = (e) => /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|EPIPE|socket|terminated|other side closed|UND_ERR|fetch failed|timeout/i.test(String(e && (e.code || '') + ' ' + (e.message || '') + ' ' + (e.cause && (e.cause.code || e.cause.message) || '')));

// fetch với chuyển hướng thủ công: bỏ Authorization khi rời huggingface.co (vd. sang CDN)
async function fetchFollow(url, { headers = {}, token, signal, fetchImpl = fetch, max = 10 } = {}) {
  let u = url;
  for (let i = 0; i <= max; i++) {
    const h = { 'User-Agent': 'AIVN-desktop', ...headers };
    if (token && new URL(u).hostname === HF_HOST) h.Authorization = 'Bearer ' + token;
    const res = await fetchImpl(u, { headers: h, redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      try { await res.body?.cancel(); } catch {}
      u = new URL(res.headers.get('location'), u).toString();
      continue;
    }
    return res;
  }
  throw new Error('Quá nhiều lần chuyển hướng');
}

function createDownloader({ dir, checkSpace = null, send = () => {}, getToken = () => null, maxConcurrent = 2, fetchImpl = fetch, log = () => {} }) {
  const jobs = new Map();
  const snap = (j) => ({ id: j.id, repo: j.repo, name: j.name, quant: j.quant, status: j.status, received: j.received, total: j.total, speed: j.speed || 0, eta: j.eta ?? null,
    error: j.error || null, parts: j.files.length, part: j.part || 0, dest: j.files[0].dest, catalogId: j.catalogId || null });
  const emit = (j, force) => { const now = Date.now(); if (!force && now - (j.lastEmit || 0) < 300) return; j.lastEmit = now; send('dl:update', snap(j)); };

  // tên tệp chung (q4_k_m.gguf, mmproj.f16.gguf…) → lưu kèm tên repo (model-names.js); tệp cũ đã có dưới tên chung thì dùng tiếp, không tải lại
  function destFor(repo, file, localName) {
    const [author, name] = repo.split('/');
    const safe = (s) => s.replace(/[^\w.\-]+/g, '_');
    const d = path.join(typeof dir === 'function' ? dir() : dir, safe(author), safe(name));
    const want = path.join(d, NAMES.localNameFor(repo, file, localName)); const legacy = path.join(d, safe(file.split('/').pop()));
    if (want !== legacy && !fs.existsSync(want) && !fs.existsSync(want + '.part') && (fs.existsSync(legacy) || fs.existsSync(legacy + '.part'))) return legacy;
    return want;
  }
  const fileSize = (p) => { try { return fs.statSync(p).size; } catch { return -1; } };

  function receivedOnDisk(j) {
    let r = 0;
    for (const f of j.files) { const s = fileSize(f.dest); if (s >= 0 && (!f.size || s === f.size)) r += s; else { const p = fileSize(f.dest + '.part'); if (p > 0) r += p; } }
    return r;
  }

  // spec: { repo, files: [{path,size}], name, quant, catalogId }
  function enqueue(spec) {
    const id = spec.id || `${spec.repo}::${spec.files[0].path}`;
    let j = jobs.get(id);
    if (j && (j.status === 'queued' || j.status === 'downloading')) return snap(j);
    const files = spec.files.map(f => ({ path: f.path, size: f.size || 0, url: spec.urlFor(spec.repo, f.path), localName: f.localName || null, dest: destFor(spec.repo, f.path, f.localName) }));
    j = { id, repo: spec.repo, name: spec.name || files[0].path.split('/').pop(), quant: spec.quant || null, catalogId: spec.catalogId || null, files,
      total: files.reduce((s, f) => s + f.size, 0), status: 'queued', error: null, samples: [] };
    j.received = receivedOnDisk(j);
    jobs.set(id, j); emit(j, true); pump();
    return snap(j);
  }

  function pump() {
    const active = [...jobs.values()].filter(j => j.status === 'downloading').length;
    let free = maxConcurrent - active;
    for (const j of jobs.values()) { if (free <= 0) break; if (j.status === 'queued') { free--; run(j); } }
  }

  function updateSpeed(j) {
    const now = Date.now();
    j.samples.push([now, j.received]);
    while (j.samples.length > 2 && now - j.samples[0][0] > 6000) j.samples.shift();
    const [t0, r0] = j.samples[0];
    j.speed = now > t0 ? (j.received - r0) / ((now - t0) / 1000) : 0;
    j.eta = j.speed > 0 && j.total ? Math.max(0, (j.total - j.received) / j.speed) : null;
  }

  async function downloadFile(j, f, k) {
    j.part = k + 1;
    if (f.size && fileSize(f.dest) === f.size) return;
    fs.mkdirSync(path.dirname(f.dest), { recursive: true });
    const part = f.dest + '.part';
    for (let attempt = 0; ; attempt++) {
      let start = Math.max(0, fileSize(part));
      if (f.size && start > f.size) { fs.rmSync(part, { force: true }); start = 0; }
      try {
        if (f.size && start === f.size) { fs.renameSync(part, f.dest); return; }
        const res = await fetchFollow(f.url, { headers: start ? { Range: `bytes=${start}-` } : {}, token: getToken(), signal: j.ac.signal, fetchImpl });
        if (res.status === 416 && f.size && start >= f.size) { fs.renameSync(part, f.dest); return; }
        if (!res.ok) { const e = new Error(friendlyHttp(res.status)); e.http = res.status; throw e; }
        if (res.status !== 206) start = 0; // máy chủ không hỗ trợ Range → tải lại từ đầu
        const len = Number(res.headers.get('content-length')) || 0;
        if (!f.size && len) { f.size = start + len; j.total = j.files.reduce((s, x) => s + x.size, 0); }
        const before = j.received - Math.max(0, fileSize(part)) ; // phần đã tính của các tệp khác
        j.received = before + start;
        const body = Readable.fromWeb(res.body);
        body.on('data', (c) => { j.received += c.length; updateSpeed(j); emit(j); });
        await pipeline(body, fs.createWriteStream(part, { flags: start ? 'a' : 'w' }), { signal: j.ac.signal });
        const got = fileSize(part);
        if (f.size && got !== f.size) throw Object.assign(new Error(`Tệp tải về chưa đủ (${got}/${f.size} byte)`), { code: 'ECONNRESET' });
        fs.renameSync(part, f.dest);
        return;
      } catch (e) {
        if (j.ac.signal.aborted) throw e;
        if (e.http || attempt >= RETRIES || !isTransient(e)) throw e;
        log(`[tải] lỗi mạng, thử lại lần ${attempt + 1}: ${e.code || e.message}`);
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  async function run(j) {
    j.status = 'downloading'; j.error = null; j.ac = new AbortController(); j.samples = []; j.received = receivedOnDisk(j); emit(j, true);
    try {
      // thư mục mô hình có thể vừa đổi: đặt lại đích cho tệp chưa có gì; kiểm tra dung lượng trống TRƯỚC khi tải (lỗi rõ ràng, không tải dở rồi hỏng)
      for (const f of j.files) if (fileSize(f.dest) < 0 && fileSize(f.dest + '.part') < 0) f.dest = destFor(j.repo, f.path, f.localName);
      if (checkSpace && j.total) checkSpace(path.dirname(j.files[0].dest), Math.max(0, j.total - receivedOnDisk(j)));
      for (let k = 0; k < j.files.length; k++) await downloadFile(j, j.files[k], k);
      j.status = 'done'; j.received = j.total; j.speed = 0; j.eta = 0; emit(j, true);
      send('dl:done', snap(j));
    } catch (e) {
      if (j.ac.signal.aborted) { j.status = j.removing ? 'removed' : 'paused'; }
      else { j.status = 'error'; j.error = e.http || e.code === 'ENOSPC_AIVN' ? e.message : e.code === 'ENOSPC' ? 'Ổ đĩa đã đầy khi đang tải. Giải phóng dung lượng hoặc đổi thư mục mô hình (Cài đặt → Chung) rồi bấm "Tiếp tục".' : (isTransient(e) ? 'Mất kết nối mạng khi tải. Bấm "Tiếp tục" để tải tiếp.' : 'Lỗi tải: ' + e.message); }
      j.speed = 0; j.eta = null; emit(j, true);
      if (j.status === 'removed') { for (const f of j.files) fs.rmSync(f.dest + '.part', { force: true }); jobs.delete(j.id); send('dl:removed', { id: j.id }); }
    } finally { pump(); }
  }

  return {
    enqueue,
    pause(id) { const j = jobs.get(id); if (!j) return; if (j.status === 'downloading') j.ac.abort(); else if (j.status === 'queued') { j.status = 'paused'; emit(j, true); } },
    resume(id) { const j = jobs.get(id); if (j && (j.status === 'paused' || j.status === 'error')) { j.status = 'queued'; j.error = null; emit(j, true); pump(); } },
    remove(id) {
      const j = jobs.get(id); if (!j) return;
      if (j.status === 'downloading') { j.removing = true; j.ac.abort(); return; }
      if (j.status !== 'done') for (const f of j.files) fs.rmSync(f.dest + '.part', { force: true });
      jobs.delete(id); send('dl:removed', { id });
    },
    list: () => [...jobs.values()].map(snap),
    get: (id) => (jobs.has(id) ? snap(jobs.get(id)) : null),
    destFor,
    partialFor(repo, files) { // byte đã có trên máy (để hiện "Tiếp tục")
      let r = 0, complete = true;
      for (const f of files) { const d = destFor(repo, f.path, f.localName); const s = fileSize(d); if (s >= 0 && (!f.size || s === f.size)) r += s; else { complete = false; const p = fileSize(d + '.part'); if (p > 0) r += p; } }
      return { received: r, complete };
    },
  };
}

module.exports = { createDownloader, fetchFollow, friendlyHttp };
