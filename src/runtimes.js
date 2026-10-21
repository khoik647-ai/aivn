'use strict';
// Runtime CUDA cho llama-server (bộ máy nhìn ảnh + AIVN AGENT) trên Windows có GPU NVIDIA — tải riêng khi cần, không làm to bộ cài.
// Bản đi kèm bộ cài vẫn là llama.cpp b11751 Vulkan (Windows) / Metal (Mac) / CPU (Linux).
// CUDA 12.4: chạy với mọi driver NVIDIA ≥ 528.33 (tương thích phiên bản phụ CUDA 12.x) và mọi driver mới hơn.
// (CUDA 13.x cần nhánh driver rất mới — không dùng.) Tải từ GitHub Release chính thức của llama.cpp, kiểm SHA-256 theo digest của release.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUILD = 'b11751';
const BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${BUILD}/`;
const CUDA = {
  id: 'cuda12', label: 'CUDA 12.4 (NVIDIA)', build: BUILD, platform: 'win32', arch: 'x64', minDriver: '528.33',
  files: [
    { name: `llama-${BUILD}-bin-win-cuda-12.4-x64.zip`, size: 271945179, sha256: '7134af549792518a7b3281553f658d1350e6f1eec0ad620bb643e7b9a3d6841f' },
    { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip', size: 391443627, sha256: '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6' },
  ],
};
// chỉ giữ llama-server và thư viện nó cần (giống build/fetch-llama.cjs) + thư viện CUDA runtime
const KEEP = /^(llama-server\.exe|LICENSE.*|(ggml[\w-]*|llama|llama-common|llama-server-impl|mtmd|libomp\d*)\.dll|(cudart|cublas|cublasLt)64_\d+\.dll)$/i;
const DROP = /(rpc-server|-(cli|bench|batched-bench|completion|perplexity|quantize|fit-params|imatrix|tts|results|tokenize)-impl)/i;
const PREFS = ['auto', 'cuda', 'bundled'];

const verNum = (v) => String(v || '').split('.').map(n => parseInt(n, 10) || 0);
function driverAtLeast(v, min) { const a = verNum(v), b = verNum(min); for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; }

function createRuntimes({ dir, platform = process.platform, arch = process.arch, fetchImpl = (...a) => fetch(...a), nvidiaSmi = null, log = () => {}, checkSpace = null } = {}) {
  const root = () => (typeof dir === 'function' ? dir() : dir);
  const rdir = () => path.join(root(), CUDA.id);
  const stampFile = () => path.join(rdir(), 'runtime.json');
  const exe = () => path.join(rdir(), 'bin', 'llama-server.exe');
  let job = null; let failed = null; let gpuCache;

  function installed() {
    try { const s = JSON.parse(fs.readFileSync(stampFile(), 'utf8')); return s.build === CUDA.build && fs.existsSync(exe()) ? s : null; } catch { return null; }
  }
  // GPU NVIDIA + phiên bản driver (nvidia-smi đi kèm driver, có sẵn trong System32)
  async function nvidia() {
    if (gpuCache !== undefined) return gpuCache;
    gpuCache = null;
    try {
      const run = nvidiaSmi || (() => new Promise((resolve) => require('child_process').execFile('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'], { timeout: 8000, windowsHide: true }, (e, out) => resolve(e ? '' : String(out || '')))));
      const line = String(await run() || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
      if (line) { const [name, driver, mem] = line.split(',').map(s => s.trim()); if (name && driver) gpuCache = { name, driver, vramMiB: Number(mem) || null }; }
    } catch {}
    return gpuCache;
  }
  async function status() {
    const g = await nvidia(); const ins = installed();
    const platOk = platform === CUDA.platform && arch === CUDA.arch;
    let supported = true, why = '';
    if (!platOk) { supported = false; why = 'Chỉ có trên Windows 64-bit — máy này dùng bản đi kèm (Metal trên Mac, Vulkan/CPU trên Linux).'; }
    else if (!g) { supported = false; why = 'Không thấy GPU NVIDIA (nvidia-smi) — CUDA chỉ dành cho card NVIDIA. Bản Vulkan đi kèm vẫn dùng GPU khác.'; }
    else if (!driverAtLeast(g.driver, CUDA.minDriver)) { supported = false; why = `Driver NVIDIA ${g.driver} quá cũ — cần ${CUDA.minDriver} trở lên. Cập nhật driver rồi mở lại AIVN.`; }
    return { id: CUDA.id, label: CUDA.label, build: CUDA.build, size: CUDA.files.reduce((s, f) => s + f.size, 0), installed: !!ins, installedAt: ins ? ins.at : null,
      supported, why, gpu: g, failed, job: job ? { received: job.received, total: job.total, phase: job.phase } : null };
  }
  // chọn llama-server cho lần nạp: { exe|null (null = bản đi kèm), runtime: 'cuda'|'bundled', why }
  async function pick(pref = 'auto') {
    const p = PREFS.includes(pref) ? pref : 'auto';
    if (p === 'bundled') return { exe: null, runtime: 'bundled', why: 'đã chọn bản đi kèm' };
    if (!installed()) return { exe: null, runtime: 'bundled', why: p === 'cuda' ? 'chưa tải runtime CUDA' : '' };
    if (failed && p === 'auto') return { exe: null, runtime: 'bundled', why: `CUDA lỗi lần trước: ${failed}` };
    const g = await nvidia(); if (!g && p === 'auto') return { exe: null, runtime: 'bundled', why: 'không thấy GPU NVIDIA' };
    return { exe: exe(), runtime: 'cuda', why: '' };
  }
  function markFailed(reason) { failed = String(reason || 'lỗi').slice(0, 200); log(`[runtime] CUDA lỗi → dùng bản đi kèm cho tới khi mở lại AIVN: ${failed}`); }

  async function downloadOne(f, signal, onProgress) {
    const dl = path.join(rdir(), '.dl'); fs.mkdirSync(dl, { recursive: true });
    const dest = path.join(dl, f.name); const part = dest + '.part';
    const ok = () => { try { return fs.statSync(dest).size === f.size; } catch { return false; } };
    if (!ok()) {
      let start = 0; try { start = fs.statSync(part).size; } catch {}
      if (start > f.size) { fs.rmSync(part, { force: true }); start = 0; }
      const res = await fetchImpl(BASE + f.name, { redirect: 'follow', signal, headers: start ? { range: `bytes=${start}-` } : {} });
      if (!(res.ok || res.status === 206)) throw new Error(`Tải ${f.name} lỗi HTTP ${res.status}`);
      if (start && res.status !== 206) start = 0;
      const out = fs.createWriteStream(part, { flags: start ? 'a' : 'w' });
      let got = start; job.base = job.base || 0;
      try {
        for await (const chunk of res.body) {
          if (signal && signal.aborted) throw Object.assign(new Error('Đã huỷ'), { code: 'ABORT' });
          if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
          got += chunk.length; job.received = job.done + got; onProgress && onProgress();
        }
      } finally { await new Promise(r => out.end(r)); }
      if (got !== f.size) throw new Error(`Tải ${f.name} chưa đủ (${got}/${f.size} byte) — bấm tải lại để tiếp tục.`);
      fs.renameSync(part, dest);
    }
    job.phase = 'verify'; onProgress && onProgress();
    const h = crypto.createHash('sha256'); await new Promise((resolve, reject) => fs.createReadStream(dest).on('data', d => h.update(d)).on('end', resolve).on('error', reject));
    const sum = h.digest('hex');
    if (sum !== f.sha256) { fs.rmSync(dest, { force: true }); throw new Error(`${f.name} sai SHA-256 (đã xoá, tải lại): ${sum}`); }
    job.done += f.size; job.received = job.done; job.phase = 'download';
    return dest;
  }
  // giải nén theo luồng (tệp 400 MB không nạp hết vào RAM), chỉ giữ tệp cần
  async function extract(zipPath, toDir) {
    const { Unzip, UnzipInflate } = require('fflate');
    const kept = []; const pending = [];
    await new Promise((resolve, reject) => {
      const uz = new Unzip((file) => {
        const base = file.name.split('/').pop();
        if (!base || !KEEP.test(base) || DROP.test(base)) return;
        const dest = path.join(toDir, base); const ws = fs.createWriteStream(dest); kept.push(base);
        pending.push(new Promise((res, rej) => { ws.on('finish', res); ws.on('error', rej); }));
        file.ondata = (err, data, final) => { if (err) { reject(err); return; } ws.write(Buffer.from(data)); if (final) ws.end(); };
        file.start();
      });
      uz.register(UnzipInflate);
      const rs = fs.createReadStream(zipPath, { highWaterMark: 1 << 20 });
      rs.on('data', (d) => { try { uz.push(new Uint8Array(d.buffer, d.byteOffset, d.length)); } catch (e) { rs.destroy(); reject(e); } });
      rs.on('end', () => { try { uz.push(new Uint8Array(0), true); resolve(); } catch (e) { reject(e); } });
      rs.on('error', reject);
    });
    await Promise.all(pending);
    return kept;
  }
  async function install({ onProgress } = {}) {
    if (job) return { ok: false, busy: true };
    const st = await status(); if (!st.supported && !process.env.AIVN_RUNTIME_FORCE) return { ok: false, error: st.why };
    const ac = new AbortController(); job = { ac, received: 0, done: 0, total: st.size, phase: 'download' };
    try {
      fs.mkdirSync(rdir(), { recursive: true });
      if (checkSpace) checkSpace(rdir(), st.size * 2.2);
      const zips = []; for (const f of CUDA.files) zips.push(await downloadOne(f, ac.signal, onProgress));
      job.phase = 'extract'; onProgress && onProgress();
      const tmp = path.join(rdir(), 'bin.new'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
      const kept = []; for (const z of zips) kept.push(...await extract(z, tmp));
      for (const need of [/^llama-server\.exe$/i, /^ggml-cuda\.dll$/i, /^cudart64_\d+\.dll$/i, /^cublas64_\d+\.dll$/i]) if (!kept.some(k => need.test(k))) throw new Error('Gói CUDA thiếu ' + need.source.replace(/[\\^$]/g, ''));
      fs.rmSync(path.join(rdir(), 'bin'), { recursive: true, force: true }); fs.renameSync(tmp, path.join(rdir(), 'bin'));
      fs.rmSync(path.join(rdir(), '.dl'), { recursive: true, force: true }); // tệp zip không cần nữa (~660 MB)
      fs.writeFileSync(stampFile(), JSON.stringify({ build: CUDA.build, id: CUDA.id, at: new Date().toISOString(), files: kept }, null, 2));
      failed = null; log(`[runtime] đã cài ${CUDA.label} (${CUDA.build}, ${kept.length} tệp)`);
      return { ok: true, files: kept };
    } catch (e) {
      const msg = e.code === 'ABORT' || (ac.signal.aborted) ? 'Đã huỷ tải runtime CUDA (phần đã tải được giữ để tiếp tục).' : (e.message || String(e));
      log('[runtime] cài CUDA lỗi: ' + msg); return { ok: false, error: msg, cancelled: ac.signal.aborted };
    } finally { job = null; onProgress && onProgress(); }
  }
  function cancel() { if (job) job.ac.abort(); return true; }
  function remove() { if (job) return { ok: false, busy: true }; fs.rmSync(rdir(), { recursive: true, force: true }); failed = null; log('[runtime] đã gỡ runtime CUDA'); return { ok: true }; }
  return { status, pick, install, cancel, remove, installed, markFailed, nvidia, exe, extract, get failed() { return failed; }, _resetGpu: () => { gpuCache = undefined; } };
}
module.exports = { createRuntimes, CUDA, KEEP, DROP, PREFS, driverAtLeast, BUILD };
