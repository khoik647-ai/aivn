'use strict';
// bản đóng gói ghi commit: electron-builder beforePack → src/build-info.json (QA result.json “commit”, dòng khởi động trong nhật ký)
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'); const BI = require('../build/build-info.cjs');
test('beforePack ghi commit (ngắn + đầy đủ), cờ dirty, phiên bản; tệp không vào git', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-bi-')); fs.mkdirSync(path.join(d, 'src'));
  const g = (...a) => execFileSync('git', a, { cwd: d, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  g('init', '-q'); fs.writeFileSync(path.join(d, 'a.txt'), '1'); g('add', '.'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
  const full = g('rev-parse', 'HEAD');
  await BI({ packager: { projectDir: d, appInfo: { version: '9.9.9-beta.1' } } });
  let j = JSON.parse(fs.readFileSync(path.join(d, 'src/build-info.json'), 'utf8'));
  assert.deepStrictEqual([j.commit, j.commitFull, j.dirty, j.version], [full.slice(0, 7), full, false, '9.9.9-beta.1']);
  fs.writeFileSync(path.join(d, 'a.txt'), '2'); j = BI.write(d, 'x'); assert.strictEqual(j.dirty, true);
  const pk = require('../package.json'); assert.strictEqual(pk.build.beforePack, 'build/build-info.cjs');
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^src\/build-info\.json$/m);
  const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'); assert.match(m, /commit \$\{bi_\.commit\}/); assert.match(m, /function qaCommit\(\) \{ try \{ return JSON\.parse\(fs\.readFileSync\(path\.join\(__dirname, 'build-info\.json'\)/);
});
