// Tải llama-server chính thức của llama.cpp (giấy phép MIT) cho chế độ "nhìn ảnh" (mmproj).
// Chỉ giữ llama-server và các thư viện nó cần; kiểm tra SHA-256 theo digest của GitHub Release.
// Dùng: node build/fetch-llama.cjs [win-x64 darwin-arm64 darwin-x64 linux-x64]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const BUILD = 'b11751'; // llama.cpp 0.7.0-dev (build 11751, commit 846639535) — cùng thế hệ với node-llama-cpp 3.22.2
const BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${BUILD}/`;
const TARGETS = {
  'win-x64': { file: `llama-${BUILD}-bin-win-vulkan-x64.zip`, sha256: '68aee00b9eca247ea5a2d1f04205c6afeec98974b6c7b2e0426b6ae6c9b3d729' },
  'darwin-arm64': { file: `llama-${BUILD}-bin-macos-arm64.tar.gz`, sha256: '41ac1a78b89ffa641837c24c260905b800691f431c090aa49f4a07af4bc8f7c5' },
  'darwin-x64': { file: `llama-${BUILD}-bin-macos-x64.tar.gz`, sha256: 'e0a72ace58cdfa9ef4714adde1cb7f53fddd8719be7b88c6c0f8f692161701c7' },
  'linux-x64': { file: `llama-${BUILD}-bin-ubuntu-x64.tar.gz`, sha256: '4e0199fe7230a944b177f260cb7525a6ad1e8ee788090a7ae0b893f65365659e' },
};
// Thư viện llama-server cần (các công cụ khác như llama-cli, bench… bị bỏ để giảm dung lượng)
const KEEP = /^(llama-server(\.exe)?|LICENSE.*|lib(ggml|llama-server-impl|llama-common|llama|mtmd)\b.*\.(dylib|so)(\.\d+)*|(ggml[\w-]*|llama|llama-common|llama-server-impl|mtmd|libomp)\.dll)$/;
const DROP = /(rpc-server|-(cli|bench|batched-bench|completion|perplexity|quantize|fit-params|imatrix|tts|results|tokenize)-impl)/;

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}
async function licenseText(src) {
  const local = path.join(src, 'LICENSE'); if (fs.existsSync(local)) return fs.readFileSync(local, 'utf8');
  const c = path.join(__dirname, 'llama', '.cache', `LICENSE-${BUILD}`);
  if (!fs.existsSync(c)) await download(`https://raw.githubusercontent.com/ggml-org/llama.cpp/${BUILD}/LICENSE`, c);
  return fs.readFileSync(c, 'utf8');
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function fetchTarget(t) {
  const spec = TARGETS[t]; if (!spec) throw new Error('không rõ nền tảng ' + t);
  const out = path.join(__dirname, 'llama', t);
  const stamp = path.join(out, '.build');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === BUILD) { console.log('đã có', out); return; }
  const cache = path.join(__dirname, 'llama', '.cache'); fs.mkdirSync(cache, { recursive: true });
  const arc = path.join(cache, spec.file);
  if (!fs.existsSync(arc) || sha(arc) !== spec.sha256) { console.log('tải', spec.file); await download(BASE + spec.file, arc); }
  if (sha(arc) !== spec.sha256) throw new Error('SHA-256 không khớp: ' + spec.file);
  const tmp = fs.mkdtempSync(path.join(cache, 'x-'));
  if (arc.endsWith('.zip')) execFileSync('unzip', ['-q', arc, '-d', tmp]); else execFileSync('tar', ['xzf', arc, '-C', tmp]);
  let src = tmp; const sub = fs.readdirSync(tmp); if (sub.length === 1 && fs.statSync(path.join(tmp, sub[0])).isDirectory()) src = path.join(tmp, sub[0]);
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const names = fs.readdirSync(src).filter(n => KEEP.test(n) && !DROP.test(n));
  // Làm phẳng symlink: chỉ giữ tên mà trình nạp thư viện tìm (libX.0.dylib / libX.so.0), bỏ bản đánh số đầy đủ và tên dev
  const links = new Map(), real = new Set();
  for (const n of names) { const p = path.join(src, n); fs.lstatSync(p).isSymbolicLink() ? links.set(n, fs.realpathSync(p)) : real.add(n); }
  const soname = (n) => /\.0\.dylib$|\.so\.0$/.test(n);
  const covered = new Set();
  for (const [n, target] of links) if (soname(n)) { fs.copyFileSync(target, path.join(out, n)); covered.add(path.basename(target)); }
  for (const n of real) if (!covered.has(n)) fs.copyFileSync(path.join(src, n), path.join(out, n));
  for (const n of fs.readdirSync(out)) fs.chmodSync(path.join(out, n), /^LICENSE/.test(n) ? 0o644 : 0o755);
  fs.writeFileSync(path.join(out, 'LICENSE-llama.cpp.txt'), `llama-server từ llama.cpp ${BUILD} (https://github.com/ggml-org/llama.cpp, giấy phép MIT)\nTệp gốc: ${spec.file} sha256 ${spec.sha256}\n\n` + await licenseText(src));
  fs.writeFileSync(stamp, BUILD + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  const size = fs.readdirSync(out).reduce((s, n) => s + fs.statSync(path.join(out, n)).size, 0);
  console.log(`${t}: ${fs.readdirSync(out).length} tệp, ${(size / 1048576).toFixed(1)} MB → ${out}`);
}

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : ['win-x64', 'darwin-arm64', 'darwin-x64'];
  for (const t of want) await fetchTarget(t);
})().catch(e => { console.error(e.message || e); process.exit(1); });
