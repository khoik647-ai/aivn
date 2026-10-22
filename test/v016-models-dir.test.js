'use strict';
// Đổi thư mục mô hình (beta.3, máy thật: C: còn 11,8 GB) + kiểm dung lượng trống trước khi tải
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const MD = require('../src/models-dir'); const root = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-md-'));
const fill = (d) => { fs.mkdirSync(path.join(d, 'org', 'm'), { recursive: true }); fs.writeFileSync(path.join(d, 'org', 'm', 'a-q4_k_m.gguf'), Buffer.alloc(3 << 20, 7)); fs.writeFileSync(path.join(d, 'org', 'm', 'mmproj-f16.gguf'), Buffer.alloc(1 << 20, 3)); fs.writeFileSync(path.join(d, 'org', 'm', 'b.gguf.part'), 'x'); };
test('kiểm thư mục đích: phải ghi được, không nằm trong / chứa thư mục hiện tại', () => {
  const d = tmp(); const cur = path.join(d, 'models'); fs.mkdirSync(cur);
  assert.strictEqual(MD.validateTarget('relative/x').ok, false);
  assert.match(MD.validateTarget(cur, { from: cur }).error, /hiện tại/); assert.match(MD.validateTarget(path.join(cur, 'sub'), { from: cur }).error, /BÊN TRONG/);
  assert.match(MD.validateTarget(d, { from: cur }).error, /CHỨA/);
  const ok = MD.validateTarget(path.join(d, 'D', 'AIVN-models'), { from: cur }); assert.strictEqual(ok.ok, true); assert.ok(fs.existsSync(ok.dir)); assert.ok(ok.free > 0);
  if (process.getuid && process.getuid() !== 0) { const ro = path.join(d, 'ro'); fs.mkdirSync(ro); fs.chmodSync(ro, 0o500); assert.match(MD.validateTarget(ro).error, /Không ghi được/); fs.chmodSync(ro, 0o700); }
});
test('thiếu dung lượng → lỗi rõ ràng (cần bao nhiêu, ổ nào còn bao nhiêu, cách đổi thư mục)', () => {
  const statfs = () => ({ bavail: 11.8 * 1024 ** 3 / 4096, bsize: 4096 });
  assert.throws(() => MD.checkSpace('C:\\Users\\k\\AppData\\Roaming\\AIVN\\models', 12.1 * 1024 ** 3, statfs), (e) => e.code === 'ENOSPC_AIVN' && /cần 12,6 GB/.test(e.message) && /ổ C: chỉ còn 11,8 GB/.test(e.message) && /đổi thư mục mô hình/.test(e.message));
  assert.doesNotThrow(() => MD.checkSpace('/x', 5 * 1024 ** 3, statfs));
});
for (const copy of [false, true]) test(`chuyển mô hình (${copy ? 'khác ổ: chép + kiểm kích thước rồi mới xoá' : 'cùng ổ: đổi tên'}), có tiến độ, giữ cấu trúc thư mục`, async () => {
  const d = tmp(); const a = path.join(d, 'a'), b = path.join(d, 'b'); fill(a); const ps = [];
  const r = await MD.moveModels(a, b, { copy, onProgress: (p) => ps.push(p) });
  assert.strictEqual(r.files, 3); assert.strictEqual(r.moved, 3); assert.strictEqual(r.sameDrive, !copy);
  assert.strictEqual(fs.statSync(path.join(b, 'org', 'm', 'a-q4_k_m.gguf')).size, 3 << 20); assert.ok(fs.existsSync(path.join(b, 'org', 'm', 'b.gguf.part')));
  assert.deepStrictEqual(MD.listFiles(a), []); assert.ok(fs.existsSync(a), 'giữ thư mục gốc cũ'); assert.ok(!fs.existsSync(path.join(a, 'org')), 'dọn thư mục rỗng');
  const last = ps.at(-1); assert.strictEqual(last.done, 3); assert.strictEqual(last.bytesDone, last.bytesTotal); assert.ok(ps.length >= 3);
  assert.ok(!MD.listFiles(b).some(f => /\.aivn-moving$/.test(f.rel)));
});
test('huỷ giữa chừng khi chép: tệp đang chép dở bị xoá, bản gốc còn nguyên', async () => {
  const d = tmp(); const a = path.join(d, 'a'), b = path.join(d, 'b'); fill(a); const ac = new AbortController();
  await assert.rejects(MD.moveModels(a, b, { copy: true, signal: ac.signal, onProgress: () => ac.abort() }), /huỷ/);
  assert.strictEqual(MD.listFiles(a).length >= 2, true); assert.ok(!MD.listFiles(b).some(f => /\.aivn-moving$/.test(f.rel)));
});
test('trình tải: thư mục đích theo thư mục mô hình HIỆN TẠI, kiểm dung lượng trước khi tải', () => {
  const s = fs.readFileSync(path.join(root, 'src/downloader.js'), 'utf8');
  assert.match(s, /typeof dir === 'function' \? dir\(\) : dir/); assert.match(s, /if \(checkSpace && j\.total\) checkSpace\(/);
  const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'); assert.match(m, /createDownloader\(\{ dir: \(\) => paths\.models, checkSpace:/);
  assert.match(m, /if \(QA_PROFILE\) return \{ ok: false, error: 'Hồ sơ QA/);
});
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
// B187: máy tải nặng làm bước chuyển mô hình (test 7, mode move) kéo ~29s thay vì ~9s và hết hạn 20s của expectHidden.
// Chờ đúng trạng thái trên DOM (thanh tiến độ biến mất, rồi đường dẫn mới hiện), hạn mức rộng; không ngủ cố định.
const UI_WAIT = 120000;
const runUi = (ud, script, out) => spawnSync('timeout', ['420', 'nice', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--qa-ui', script, '--out', out], { cwd: root, encoding: 'utf8', env: { ...process.env, AIVN_QA_MODE: '1', AIVN_SKIP_ACTIVATION: '1', AIVN_USER_DATA: ud } });
for (const mode of ['move', 'point']) test(`giao diện thật (Xvfb): Cài đặt → Chung → Đổi thư mục… (${mode === 'move' ? 'chuyển mô hình' : 'chỉ trỏ sang thư mục mới'})`, { skip: !hasX && 'cần xvfb', timeout: 480e3 }, () => {
  const d = tmp(); const ud = path.join(d, 'ud'), nd = path.join(d, 'D-models'); fill(path.join(ud, 'models')); fs.mkdirSync(nd);
  const s = { name: 'mdir-' + mode, steps: [{ goto: 'chat' }, { waitFor: ['ob-skip', 20000], optional: true }, { click: 'ob-skip', optional: true },
    { goto: 'settings/general' }, { expectText: ['mdir-info', path.join(ud, 'models')], timeout: 30000 }, { setFiles: ['mdir-change', nd], timeout: 30000 },
    { expectText: ['confirm-modal', 'Chuyển 3 tệp'], timeout: 30000 }, mode === 'move' ? { click: 'cf-yes', timeout: 30000 } : { click: 'cf-no', timeout: 30000 }, ...(mode === 'point' ? [{ expectText: ['confirm-modal', 'Chỉ dùng thư mục mới'], timeout: 30000 }, { click: 'cf-yes', timeout: 30000 }] : []),
    { expectHidden: 'mdir-prog', timeout: UI_WAIT }, { expectText: ['mdir-info', nd], timeout: UI_WAIT }, { goto: 'models' }, { expectText: ['models-dir', nd], timeout: UI_WAIT }] };
  fs.writeFileSync(path.join(d, 's.json'), JSON.stringify(s)); const r = runUi(ud, path.join(d, 's.json'), path.join(d, 'r.json'));
  const j = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8'));
  assert.deepStrictEqual(j.steps.filter(x => !x.ok).map(x => `${x.n} ${x.action}: ${x.error}`), []); assert.strictEqual(r.status, 0);
  const st = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')); assert.strictEqual(st.modelsDir, nd);
  if (mode === 'move') { assert.strictEqual(MD.listFiles(nd).length, 3); assert.strictEqual(MD.listFiles(path.join(ud, 'models')).length, 0); }
  else { assert.strictEqual(MD.listFiles(nd).length, 0); assert.strictEqual(MD.listFiles(path.join(ud, 'models')).length, 3); assert.deepStrictEqual(st.modelDirsExtra, [path.join(ud, 'models')]); }
});
