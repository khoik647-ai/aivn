// QA lượt 2: test HÀNH VI trên giao diện thật (Electron + xvfb), thay cho test chỉ dò chuỗi mã nguồn.
// B4: nút công cụ bị chặn ghi lý do ngắn, không ghi “· tắt”. B11: không màn hình nào còn “Kho mô hình”. B12: tiêu đề câu trả lời hiện tên hiển thị.
const test = require('node:test'); const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const hasX = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));

let R = null;
function run() {
  if (R) return R;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-behav-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-behav-ud-'));
  const r = spawnSync('timeout', ['150', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'],
    { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QAUI: dir, AIVN_QAUI_BEHAV: '1' }) });
  const f = path.join(dir, 'behav.json'); assert.ok(fs.existsSync(f), 'giao diện không chạy xong: ' + (r.stderr || '').slice(-800));
  R = JSON.parse(fs.readFileSync(f, 'utf8')); return R;
}

test('B4: nút “Điều khiển màn hình” bị chặn ghi lý do ngắn, không ghi “· tắt”', { skip: !hasX && 'cần xvfb-run + electron' }, () => {
  const b = run().b4; assert.ok(b, 'không thấy nút');
  assert.match(b.cls, /\bblocked\b/); assert.strictEqual(b.text, '🖱 Điều khiển màn hình · cần mô hình nhìn màn hình');
  assert.ok(!/tắt/.test(b.text)); assert.match(b.aria, /chưa dùng được/);
});
test('B11: thanh bên và mọi màn hình gọi “Khám phá”, không còn “Kho mô hình” (chữ, title, aria-label, data-tip)', { skip: !hasX && 'cần xvfb-run + electron' }, () => {
  const b = run().b11; assert.strictEqual(b.nav, 'Khám phá'); assert.deepStrictEqual(b.hits, []);
  assert.ok(run().views.length >= 8, 'phải duyệt đủ các màn hình');
});
test('B11: tài liệu người dùng (README, docs/glossary, docs/verified, trang release) dùng “Khám phá”', () => {
  for (const f of ['README.md', 'docs/glossary.md', 'docs/verified.md', 'release.sh', 'build/md-page.cjs', 'src/renderer/styles.css']) {
    const t = fs.readFileSync(path.join(root, f), 'utf8').replace(/không dùng “Kho mô hình”/g, '');
    assert.ok(!/Kho mô hình|Model Hub|模型库/.test(t), f);
  }
  assert.match(fs.readFileSync(path.join(root, 'docs/glossary.md'), 'utf8'), /\| Khám phá \| Discover \| 发现 \|/);
});
test('B12: tiêu đề câu trả lời hiện tên hiển thị của mô hình (không phải tên tệp .gguf)', { skip: !hasX && 'cần xvfb-run + electron' }, () => {
  const w = run().b12; assert.strictEqual(w[0], 'AIVN · Qwen3-VL 2B Instruct');
  assert.strictEqual(w[1], 'AIVN · khong-co-trong-danh-sach'); for (const x of w) assert.ok(!/\.gguf/i.test(x), x);
});
test('bộ não đám mây trên giao diện thật: kiểm tra kết nối máy chủ giả, khoá không quay lại giao diện/settings.json, thanh AIVN AGENT báo rõ dữ liệu gửi đi', { skip: !hasX && 'cần xvfb-run + electron' }, () => {
  const c = run().cloud; assert.ok(c, 'không có kết quả');
  assert.match(c.msg, /Kết nối được/); assert.match(c.msg, /gọi công cụ được/);
  assert.strictEqual(c.keyField, ''); assert.strictEqual(c.settingsHasKey, false); assert.strictEqual(c.fileHasKey, false);
  assert.match(c.warn, /bộ não đám mây gia-lap/); assert.match(c.warn, /ảnh chụp màn hình thì không/);
  assert.deepStrictEqual([run().cloudCleared.keySet, run().cloudCleared.on], [false, false]);
});
