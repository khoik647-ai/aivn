// Tạo latest-mac.yml + .blockmap cho các tệp zip macOS đã ký ad-hoc (vì zip được đóng gói lại sau khi ký, ngoài electron-builder).
// Dùng: node build/gen-latest-mac.cjs <version> <zip...>
const fs = require('fs');
const path = require('path');
const ablRoot = path.join(__dirname, '..', 'node_modules', 'app-builder-lib');
const { buildBlockMap } = require(path.join(ablRoot, 'out', 'targets', 'blockmap', 'blockmap.js'));

(async () => {
  const [version, ...zips] = process.argv.slice(2);
  if (!version || !zips.length) { console.error('Dùng: node build/gen-latest-mac.cjs <version> <zip...>'); process.exit(1); }
  const files = [];
  for (const z of zips) {
    const info = await buildBlockMap(z, 'gzip', z + '.blockmap'); // trả về { size, sha512 }
    files.push({ url: path.basename(z), sha512: info.sha512, size: info.size });
    console.log('blockmap:', z + '.blockmap');
  }
  // electron-updater trên Mac chọn tệp theo tên có/không có "arm64"; tệp đầu tiên là mặc định (x64)
  files.sort((a, b) => (a.url.includes('arm64') ? 1 : 0) - (b.url.includes('arm64') ? 1 : 0));
  const y = [`version: ${version}`, 'files:', ...files.flatMap(f => [`  - url: ${f.url}`, `    sha512: ${f.sha512}`, `    size: ${f.size}`]),
    `path: ${files[0].url}`, `sha512: ${files[0].sha512}`, `releaseDate: '${new Date().toISOString()}'`, ''].join('\n');
  const out = path.join(path.dirname(zips[0]), 'latest-mac.yml');
  fs.writeFileSync(out, y); console.log('đã ghi', out);
})().catch(e => { console.error(e); process.exit(1); });
