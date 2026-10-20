// Build macOS riêng cho từng kiến trúc, mỗi bản chỉ chứa binary llama.cpp của kiến trúc đó
const builder = require('electron-builder');
// "publish" được electron-builder đọc từ package.json; truyền lại qua config sẽ bị gộp sai (lỗi mergePublish)
const { publish: _publish, ...base } = require('../package.json').build;
const fs = require('fs');
const path = require('path');
const target = process.env.MAC_TARGET || 'zip';
// Với target "dir" electron-builder không ghi app-update.yml → tự ghi để electron-updater biết repo GitHub (phải làm trước khi ký)
function writeUpdateYml(arch) {
  const pub = [].concat(_publish || [])[0];
  if (!pub) return;
  const dir = path.join(__dirname, '..', 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', 'AIVN.app', 'Contents', 'Resources');
  if (!fs.existsSync(dir)) return;
  const yml = `owner: ${pub.owner}\nrepo: ${pub.repo}\nprovider: ${pub.provider}\nreleaseType: ${pub.releaseType || 'release'}\nupdaterCacheDirName: aivn-updater\n`;
  fs.writeFileSync(path.join(dir, 'app-update.yml'), yml);
  console.log('đã ghi', path.join(dir, 'app-update.yml'));
}
(async () => {
  for (const [arch, other] of [['arm64', 'mac-x64'], ['x64', 'mac-arm64-metal']]) {
    // Node.js thuần đúng kiến trúc để chạy bộ máy suy luận ngoài Electron (xem src/engine-proxy.js)
    const node = [{ from: `build/node/darwin-${arch}`, to: 'node', filter: ['node', 'LICENSE'] }, { from: `build/llama/darwin-${arch}`, to: 'llama', filter: ['**/*', '!.build'] }];
    if (!fs.existsSync(path.join(__dirname, 'llama', `darwin-${arch}`, 'llama-server'))) throw new Error(`thiếu build/llama/darwin-${arch}/llama-server — chạy: node build/fetch-llama.cjs`);
    if (!fs.existsSync(path.join(__dirname, 'node', `darwin-${arch}`, 'node'))) throw new Error(`thiếu build/node/darwin-${arch}/node — chạy: node build/fetch-node.cjs`);
    const config = { ...base, mac: { ...base.mac, extraResources: node, files: [...base.mac.files, `!node_modules/@node-llama-cpp/${other}/**`] } };
    await builder.build({ targets: builder.Platform.MAC.createTarget([target], builder.Arch[arch]), config, publish: 'never' });
    if (target === 'dir') writeUpdateYml(arch);
  }
})().catch(e => { console.error(e); process.exit(1); });
