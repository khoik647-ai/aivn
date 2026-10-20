// Tải Node.js chính thức (cùng phiên bản Node của Electron) để chạy bộ máy AI ngoài Electron.
// Kiểm tra SHA-256 theo SHASUMS256.txt của nodejs.org. Kết quả: build/node/<nền tảng>/node(.exe) + LICENSE
// Dùng: node build/fetch-node.cjs [win-x64 darwin-arm64 darwin-x64 linux-x64]
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { execFileSync } = require('child_process');
const VERSION = process.env.AIVN_NODE_VERSION || 'v24.22.0';
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['win-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'];
const out = path.join(__dirname, 'node');
const tmp = path.join(require('os').tmpdir(), 'aivn-node-dl');
fs.mkdirSync(tmp, { recursive: true });
const sh = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
(async () => {
  const sums = await (await fetch(`https://nodejs.org/dist/${VERSION}/SHASUMS256.txt`)).text();
  for (const t of targets) {
    const ext = t.startsWith('win') ? 'zip' : 'tar.gz';
    const name = `node-${VERSION}-${t}.${ext}`;
    const dest = path.join(out, t);
    const bin = path.join(dest, t.startsWith('win') ? 'node.exe' : 'node');
    if (fs.existsSync(bin) && fs.existsSync(path.join(dest, '.version')) && fs.readFileSync(path.join(dest, '.version'), 'utf8') === VERSION) { console.log('đã có', bin); continue; }
    const file = path.join(tmp, name);
    const want = (sums.split('\n').find(l => l.endsWith('  ' + name)) || '').split(' ')[0];
    if (!want) throw new Error('Không có SHA-256 cho ' + name);
    const have = () => fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === want;
    if (!have()) sh('curl', ['-fsSL', '-o', file, `https://nodejs.org/dist/${VERSION}/${name}`]);
    if (!have()) throw new Error('SHA-256 không khớp: ' + name);
    const x = path.join(tmp, t); fs.rmSync(x, { recursive: true, force: true }); fs.mkdirSync(x);
    if (ext === 'zip') sh('unzip', ['-q', file, '-d', x]); else sh('tar', ['-xzf', file, '-C', x]);
    const root = path.join(x, `node-${VERSION}-${t}`);
    fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(root, t.startsWith('win') ? 'node.exe' : 'bin/node'), bin);
    fs.chmodSync(bin, 0o755);
    fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dest, 'LICENSE'));
    fs.writeFileSync(path.join(dest, '.version'), VERSION);
    console.log('OK', t, (fs.statSync(bin).size / 1e6).toFixed(1) + ' MB', 'sha256 ' + want.slice(0, 12));
  }
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
