'use strict';
// beta.2.3 (tìm ra khi chạy lại hồi quy): tab Runtime gọi window.api.* (cầu nối thật là window.aivn = A) → lỗi khi nạp app.js, mọi dòng sau đó
// không chạy (thẻ Cài đặt bấm không đổi, phím ↑↓…), nhưng qa-ui vẫn báo consoleErrors 0 vì lỗi xảy ra trước khi bộ chạy gắn bộ nghe
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const R = path.join(__dirname, '..', 'src');
test('giao diện chỉ dùng cầu nối window.aivn (A), không có window.api', () => {
  const pre = fs.readFileSync(path.join(R, 'preload.js'), 'utf8'); assert.match(pre, /exposeInMainWorld\('aivn'/); assert.doesNotMatch(pre, /exposeInMainWorld\('api'/);
  for (const f of fs.readdirSync(path.join(R, 'renderer')).filter(f => /\.(js|html)$/.test(f))) assert.doesNotMatch(fs.readFileSync(path.join(R, 'renderer', f), 'utf8'), /window\.api\b/, f);
  // mọi hàm A.xxx mà app.js gọi đều có trong preload
  const app = fs.readFileSync(path.join(R, 'renderer/app.js'), 'utf8');
  const used = new Set([...app.matchAll(/\bA\.([a-zA-Z]\w*)\s*\(/g)].map(m => m[1]));
  const missing = [...used].filter(k => !new RegExp(`\\b${k}\\s*:`).test(pre)); assert.deepStrictEqual(missing, [], 'A.* thiếu trong preload');
});
test('app.js kết thúc bằng cờ window.__aivnBoot; qa-ui coi thiếu cờ là lỗi (status failed)', () => {
  const app = fs.readFileSync(path.join(R, 'renderer/app.js'), 'utf8').trimEnd(); assert.match(app.split('\n').pop(), /^window\.__aivnBoot = 'ok';$/);
  const q = fs.readFileSync(path.join(R, 'qa-ui.js'), 'utf8'); assert.match(q, /window\.__aivnBoot/); assert.match(q, /if \(boot !== 'ok'\) \{ res\.consoleErrors\.push\([\s\S]*?failed\+\+; \}/);
});
const { spawnSync } = require('child_process'); const os = require('os');
const ROOT = path.join(__dirname, '..');
test('Electron: thẻ Runtime vẽ được (phiên bản llama-server + node-llama-cpp thật), bấm “Chung” đổi thẻ, phím ↓ sang thẻ kế; không lỗi khi nạp', { skip: !fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')) || spawnSync('which', ['xvfb-run']).status !== 0, timeout: 200000 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-boot-'));
  spawnSync('timeout', ['150', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--qa-ui', 'test/fixtures/qa-ui/runtime-tab.json', '--out', path.join(d, 'r.json'), '--profile', path.join(d, 'p')],
    { cwd: ROOT, env: { ...process.env, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_MODE: '1', OMP_NUM_THREADS: '4' }, stdio: 'ignore' });
  const r = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8'));
  assert.deepStrictEqual(r.steps.filter(s => !s.ok).map(s => `${s.n} ${s.action}: ${s.error}`), []); assert.deepStrictEqual(r.consoleErrors, []); assert.strictEqual(r.status, 'done');
  assert.match(r.reads.ver, /llama-server\) b\d+/); assert.match(r.reads.ver, /node-llama-cpp \d+\.\d+\.\d+/); assert.match(r.reads.cuda, /\S/);
  assert.match(r.reads.active, /Chưa nạp mô hình nhìn ảnh — lần nạp tới sẽ dùng: (CUDA|bản đi kèm \((Vulkan|Metal|CPU)\))/, 'B123: runtime-active phải có chữ');
});
