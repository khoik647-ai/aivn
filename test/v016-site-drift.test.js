'use strict';
// Trang thật (gh-pages) có sửa nóng (B68) không được mất khi release.sh ghi đè: site/ phải chứa chúng; tools/site_drift.py chặn triển khai
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync, spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const site = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');

test('B68 (sửa nóng trên gh-pages) đã có trong site/index.html; release.sh chạy kiểm tra trôi lệch trước khi đăng', () => {
  assert.match(site, /var REL='https:\/\/github\.com\/khoik647-ai\/aivn\/releases\/latest\/download\/';/);
  assert.match(site, /function directUrl\(\)\{if\(mobile\)return null;/); assert.match(site, /var mobile=phone;/);
  assert.match(site, /#tai-ve\{scroll-margin-top:calc\(var\(--hdr,72px\) \+ 20px\)\}/); assert.match(site, /@keyframes dlflash/);
  const rel = fs.readFileSync(path.join(root, 'release.sh'), 'utf8');
  const i = rel.indexOf('tools/site_drift.py --rendered "$SITE" --live'); assert.ok(i > 0);
  assert.ok(i < rel.indexOf('if [[ "$DRY_RUN" == "1" ]]') && i < rel.indexOf('git push -q -f origin gh-pages'), 'kiểm tra chạy trước DRY_RUN và trước khi đẩy gh-pages');
});

test('site_drift: dòng/khoá i18n thêm trên gh-pages sau lần triển khai gốc mà site/ không có → từ chối; có → cho qua; xác nhận bằng hash', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-drift-t-')); const live = path.join(tmp, 'live'); const ren = path.join(tmp, 'ren'); fs.mkdirSync(live); fs.mkdirSync(ren);
  const g = (...a) => execFileSync('git', ['-C', live, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'pipe' });
  const base = '<html><body>\n<p>Phiên bản 0.15.3</p>\n<script>var D=/*I18N*/{"en": {"hero.1": "v", "a": "A"}, "zh": {"hero.1": "v"}}/*END*/;\nvar x=1;\n</script></body></html>\n';
  g('init', '-q', '-b', 'gh-pages'); fs.writeFileSync(path.join(live, 'index.html'), base); g('add', '-A'); g('commit', '-qm', 'Trang web AIVN 0.15.3');
  const hot = base.replace('var x=1;', 'var x=1;\nvar REL=1; // sửa nóng').replace('"a": "A"}', '"a": "A", "hot": "H"}');
  fs.writeFileSync(path.join(live, 'index.html'), hot); g('commit', '-qam', 'Trang web: sửa nóng');
  const run = (rendered, env = {}) => { fs.writeFileSync(path.join(ren, 'index.html'), rendered); return spawnSync('python3', [path.join(root, 'tools/site_drift.py'), '--rendered', ren, '--live', live], { encoding: 'utf8', env: { ...process.env, ...env } }); };
  const newer = base.replace('0.15.3', '0.16.0'); // site/ mới hơn trang thật: không sao
  let r = run(newer); assert.strictEqual(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /var REL=#; \/\/ sửa nóng/); assert.match(r.stderr, /i18n en\.hot = H/);
  r = run(hot.replace('0.15.3', '0.16.0')); assert.strictEqual(r.status, 0, r.stderr);
  const digest = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(live, 'index.html'))).digest('hex').slice(0, 12);
  assert.strictEqual(run(newer, { SITE_DRIFT_ACK: digest }).status, 0); assert.strictEqual(run(newer, { SITE_DRIFT_ACK: 'sai' }).status, 1);
});
