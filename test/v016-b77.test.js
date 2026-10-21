'use strict';
// B77 (pass 8): màn kích hoạt chỉ đọc localStorage → người dùng en/zh mới cài thấy toàn tiếng Việt, không có chỗ đổi ngôn ngữ
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const hasX = fs.existsSync(path.join(root, 'node_modules/.bin/electron')) && spawnSync('which', ['xvfb-run']).status === 0;
test('B77 thật (Xvfb, hồ sơ mới uiLang=en, CHƯA kích hoạt): màn kích hoạt tiếng Anh; ô chọn ngôn ngữ đổi sang zh ngay và lưu vào cài đặt', { skip: !hasX && 'cần xvfb + electron', timeout: 180e3 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b77-')); const ud = path.join(d, 'ud'); fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ uiLang: 'en' }));
  const env = { ...process.env, AIVN_USER_DATA: ud, AIVN_QA_GATE: d }; delete env.AIVN_SKIP_ACTIVATION;
  spawnSync('timeout', ['120', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: root, env, stdio: 'ignore' });
  const j = JSON.parse(fs.readFileSync(path.join(d, 'gate.json'), 'utf8'));
  assert.ok(!j.error, j.error); assert.strictEqual(j.mode, 'activate');
  assert.strictEqual(j.first.lang, 'en'); assert.strictEqual(j.first.sel, 'en'); assert.deepStrictEqual(j.first.opts, ['vi', 'en', 'zh']);
  assert.ok(!/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/i.test((j.first.title + j.first.steps + j.first.go).replace(/NGUYỄN NGỌC KHÔI SINH VIÊN VLU/g, '')), JSON.stringify(j.first));
  assert.strictEqual(j.after.lang, 'zh-CN'); assert.match(j.after.go, /[\u4e00-\u9fff]/); assert.strictEqual(j.saved, 'zh');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).uiLang, 'zh');
});
test('B77: gate:lang chỉ nhận vi/en/zh và chỉ đổi uiLang', () => {
  const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.match(m, /handle\('gate:lang', \(_e, l\) => \{ if \(I18N_CORE\.LANGS\.includes\(l\) && settings\.data\.uiLang !== l\) \{ settings\.data\.uiLang = l; settings\.save\(\);/);
  assert.match(m, /lang: uiLang\(\) \}\)\); \/\/ B77/);
});
