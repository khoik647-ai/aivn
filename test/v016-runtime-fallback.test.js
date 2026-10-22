'use strict';
// runtime CUDA lỗi → vision-server tự quay về bản đi kèm (máy chủ giả, không cần GPU)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-rtfb-'));
function fake(name, { banner = '', exitCode = null } = {}) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!${process.execPath}
const a = process.argv.slice(2); const port = +a[a.indexOf('--port') + 1];
${banner ? `console.error(${JSON.stringify(banner)});` : ''}
${exitCode != null ? `console.error('error: failed to initialize backend'); process.exit(${exitCode});` : ''}
fs = require('fs'); fs.writeFileSync(${JSON.stringify(p)} + '.args', JSON.stringify(a));
require('http').createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(q.url === '/props' ? JSON.stringify({ default_generation_settings: { n_ctx: 4096 }, chat_template: '' }) : '{}'); }).listen(port, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
`); fs.chmodSync(p, 0o755); return p;
}
const bundled = fake('bundled-server');
process.env.AIVN_LLAMA_SERVER = bundled;
const VS = require('../src/vision-server');
const mk = () => { const logs = []; return { vs: VS.createVisionServer({ log: (m) => logs.push(m) }), logs }; };
const base = { id: 'm', modelPath: '/x/m.gguf', mmprojPath: '/x/mm.gguf', contextSize: 4096, gpu: true };

test('CUDA build that finds an NVIDIA device is used', async () => {
  const { vs } = mk(); const cuda = fake('cuda-ok', { banner: 'ggml_cuda_init: found 1 CUDA devices:\n  Device 0: NVIDIA GeForce RTX 4070 SUPER' });
  const r = await vs.start({ ...base, serverExe: cuda });
  assert.deepEqual(r, { runtime: 'cuda', runtimeFallback: null }); assert.equal(vs.status().runtime, 'cuda'); assert.equal(vs.status().serverExe, cuda);
  await vs.stop();
});
test('CUDA build that exits (driver/DLL problem) → bundled build, reason recorded', async () => {
  const { vs, logs } = mk(); const cuda = fake('cuda-crash', { exitCode: 1 });
  const r = await vs.start({ ...base, serverExe: cuda });
  assert.equal(r.runtime, 'bundled'); assert.match(r.runtimeFallback, /Không nạp được|failed/);
  assert.equal(vs.status().runtime, 'bundled'); assert.equal(vs.status().runtimeFallback, r.runtimeFallback);
  assert.ok(logs.some(l => /quay về bản đi kèm/.test(l)));
  await vs.stop();
});
test('CUDA build that starts without any CUDA device (would silently run on CPU) → bundled build', async () => {
  const { vs } = mk(); const cuda = fake('cuda-nodev', { banner: 'ggml_cuda_init: failed to initialize CUDA: no CUDA-capable device is detected' });
  const r = await vs.start({ ...base, serverExe: cuda });
  assert.equal(r.runtime, 'bundled'); assert.match(r.runtimeFallback, /không thấy GPU NVIDIA/);
  await vs.stop();
});
test('CPU mode or no serverExe never tries CUDA', async () => {
  const { vs } = mk(); const cuda = fake('cuda-unused', { banner: 'ggml_cuda_init: found 1 CUDA devices' });
  let r = await vs.start({ ...base, gpu: false, serverExe: cuda }); assert.equal(r.runtime, 'bundled'); assert.equal(r.runtimeFallback, null);
  assert.ok(!fs.existsSync(cuda + '.args')); assert.ok(JSON.parse(fs.readFileSync(bundled + '.args')).includes('-ngl'));
  r = await vs.start({ ...base }); assert.equal(r.runtime, 'bundled');
  await vs.stop();
});
test('wiring: engine/host/main pass serverExe; main notes fallback; settings tab exists', () => {
  const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(rd('src/engine.js'), /serverExe: opts\.serverExe \|\| null/); assert.match(rd('src/engine.js'), /runtimeFallback: v\.runtimeFallback/);
  assert.match(rd('src/engine-host.js'), /serverExe: gopts\.serverExe \|\| null/);
  assert.match(rd('src/main.js'), /if \(opts\.mmproj\) opts\.serverExe = await serverExeFor\(\)/); assert.match(rd('src/main.js'), /noteRuntime\(gres/);
  assert.match(rd('src/renderer/index.html'), /data-stab="runtime"/); assert.match(rd('src/preload.js'), /runtimeInstall: inv\('runtime:install'\)/);
  // bộ cài không to thêm: runtime CUDA không nằm trong gói
  const pkg = JSON.parse(rd('package.json')); const pats = JSON.stringify(pkg.build).match(/"[^"]*cuda[^"]*"/ig) || [];
  assert.ok(pats.every(x => x.startsWith('"!')), 'only exclusions mention cuda: ' + pats);
  assert.match(rd('build/fetch-llama.cjs'), /vulkan/i);
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
