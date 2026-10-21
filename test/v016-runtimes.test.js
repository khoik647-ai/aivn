'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const R = require('../src/runtimes');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-rt-'));
const smi = (line) => async () => line;

test('driver threshold + status: no NVIDIA / old driver / non-Windows', async () => {
  assert.ok(R.driverAtLeast('581.57', '528.33')); assert.ok(!R.driverAtLeast('527.41', '528.33'));
  let r = R.createRuntimes({ dir: tmp(), platform: 'win32', arch: 'x64', nvidiaSmi: smi('') });
  let s = await r.status(); assert.equal(s.supported, false); assert.match(s.why, /NVIDIA/);
  r = R.createRuntimes({ dir: tmp(), platform: 'win32', arch: 'x64', nvidiaSmi: smi('NVIDIA GeForce GTX 1060, 511.79, 6144') });
  s = await r.status(); assert.equal(s.supported, false); assert.match(s.why, /528\.33/);
  r = R.createRuntimes({ dir: tmp(), platform: 'darwin', arch: 'arm64', nvidiaSmi: smi('') });
  s = await r.status(); assert.equal(s.supported, false); assert.match(s.why, /Windows/);
  r = R.createRuntimes({ dir: tmp(), platform: 'win32', arch: 'x64', nvidiaSmi: smi('NVIDIA GeForce RTX 4070 SUPER, 581.57, 12282\n') });
  s = await r.status(); assert.equal(s.supported, true); assert.equal(s.gpu.vramMiB, 12282); assert.equal(s.installed, false);
  assert.equal(s.size, 271945179 + 391443627);
});

test('pick: bundled until installed; failure in auto mode falls back for the session', async () => {
  const dir = tmp();
  const r = R.createRuntimes({ dir, platform: 'win32', arch: 'x64', nvidiaSmi: smi('RTX, 581.57, 8192') });
  assert.deepEqual((await r.pick('auto')).runtime, 'bundled');
  assert.match((await r.pick('cuda')).why, /chưa tải/);
  const bin = path.join(dir, 'cuda12', 'bin'); fs.mkdirSync(bin, { recursive: true }); fs.writeFileSync(path.join(bin, 'llama-server.exe'), 'x');
  fs.writeFileSync(path.join(dir, 'cuda12', 'runtime.json'), JSON.stringify({ build: R.BUILD }));
  assert.equal((await r.pick('auto')).runtime, 'cuda'); assert.equal((await r.pick('bundled')).runtime, 'bundled');
  r.markFailed('no CUDA device');
  assert.equal((await r.pick('auto')).runtime, 'bundled'); assert.match((await r.pick('auto')).why, /CUDA lỗi/);
  assert.equal((await r.pick('cuda')).runtime, 'cuda', 'explicit CUDA choice still tries (user asked for it)');
  fs.writeFileSync(path.join(dir, 'cuda12', 'runtime.json'), JSON.stringify({ build: 'b1' }));
  assert.equal(r.installed(), null, 'stale build stamp = not installed');
  assert.ok(r.remove().ok); assert.ok(!fs.existsSync(path.join(dir, 'cuda12')));
});

test('install: bad sha is rejected and deleted; nothing half-installed', async () => {
  const dir = tmp();
  const fetchImpl = async () => new Response(Buffer.alloc(10));
  const r = R.createRuntimes({ dir, platform: 'win32', arch: 'x64', nvidiaSmi: smi('RTX, 581.57, 8192'), fetchImpl });
  const out = await r.install(); assert.equal(out.ok, false); assert.match(out.error, /chưa đủ|SHA/);
  assert.equal(r.installed(), null);
});

// Chạy được khi có sẵn gói thật (tải về /workspace/cuda-rt) — kiểm giải nén luồng + danh sách giữ lại
const REAL = process.env.AIVN_CUDA_ZIPS || '/workspace/cuda-rt';
test('install from the real b11751 CUDA 12.4 packages (local fetch)', { skip: !R.CUDA.files.every(f => { try { return fs.statSync(path.join(REAL, f.name)).size === f.size; } catch { return false; } }) }, async () => {
  const dir = tmp(); const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url); const name = url.split('/').pop(); const p = path.join(REAL, name);
    const { Readable } = require('stream');
    return new Response(Readable.toWeb(fs.createReadStream(p)), { status: 200, headers: { 'content-length': String(fs.statSync(p).size) } });
  };
  let ticks = 0;
  const r = R.createRuntimes({ dir, platform: 'win32', arch: 'x64', nvidiaSmi: smi('RTX 4070 SUPER, 581.57, 12282'), fetchImpl });
  const out = await r.install({ onProgress: () => ticks++ });
  assert.equal(out.ok, true, out.error);
  assert.ok(calls.every(u => u.startsWith('https://github.com/ggml-org/llama.cpp/releases/download/b11751/')));
  const files = fs.readdirSync(path.join(dir, 'cuda12', 'bin')).sort();
  for (const need of ['llama-server.exe', 'llama-server-impl.dll', 'ggml-cuda.dll', 'ggml-base.dll', 'ggml.dll', 'llama.dll', 'mtmd.dll', 'llama-common.dll', 'cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll', 'ggml-cpu-haswell.dll']) assert.ok(files.includes(need), need);
  for (const f of files) assert.ok(!/cli|bench|quantize|perplexity|rpc-server|tts|^llama\.exe$/i.test(f), 'unexpected ' + f);
  assert.equal(fs.statSync(path.join(dir, 'cuda12', 'bin', 'ggml-cuda.dll')).size, 577119744);
  assert.ok(!fs.existsSync(path.join(dir, 'cuda12', '.dl')), 'zips removed after install');
  assert.ok(r.installed()); assert.ok(ticks > 10);
  assert.equal((await r.pick('auto')).exe, path.join(dir, 'cuda12', 'bin', 'llama-server.exe'));
  fs.rmSync(dir, { recursive: true, force: true });
});
