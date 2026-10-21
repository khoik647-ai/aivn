'use strict';
// electron-builder beforePack: ghi src/build-info.json (commit đang đóng gói) vào gói — bản đã cài báo đúng commit (QA result.json, nhật ký khởi động)
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
function info(root, version) {
  const git = (...a) => { try { return execFileSync('git', a, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
  const full = git('rev-parse', 'HEAD');
  const dirty = full ? (git('status', '--porcelain', '--untracked-files=no') || '').split('\n').filter(l => l.trim() && !/src\/build-info\.json$/.test(l)).length > 0 : null;
  return { commit: full ? full.slice(0, 7) : null, commitFull: full, dirty, version: version || null, builtAt: new Date().toISOString() };
}
function write(root, version) { const i = info(root, version); fs.writeFileSync(path.join(root, 'src', 'build-info.json'), JSON.stringify(i, null, 1) + '\n'); return i; }
module.exports = async function beforePack(context) {
  const root = (context && context.packager && (context.packager.projectDir || (context.packager.info && context.packager.info.projectDir))) || path.join(__dirname, '..');
  const version = context && context.packager && context.packager.appInfo ? context.packager.appInfo.version : null;
  const i = write(root, version); console.log(`  • build-info: ${i.commit}${i.dirty ? ' (có thay đổi chưa commit)' : ''} · ${i.version}`);
};
module.exports.info = info; module.exports.write = write;
