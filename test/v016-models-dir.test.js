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
  assert.ok(!MD.listFiles(b).some(f => /\.aivn-moving/.test(f.rel)));
});
test('huỷ giữa chừng khi chép: tệp đang chép dở bị xoá, bản gốc còn nguyên', async () => {
  const d = tmp(); const a = path.join(d, 'a'), b = path.join(d, 'b'); fill(a); const ac = new AbortController();
  await assert.rejects(MD.moveModels(a, b, { copy: true, signal: ac.signal, onProgress: () => ac.abort() }), /huỷ/);
  assert.strictEqual(MD.listFiles(a).length >= 2, true); assert.ok(!MD.listFiles(b).some(f => /\.aivn-moving/.test(f.rel)));
});
test('repro treo: chép không bao giờ xong thì lời hứa không kết thúc khi tắt watchdog', async () => {
  const d = tmp(); const a = path.join(d, 'a'), b = path.join(d, 'b'); fill(a); let settled = false;
  const p = MD.moveModels(a, b, { copy: true, stallMs: 0, copyFile: () => new Promise(() => {}) });
  p.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(r => setTimeout(r, 200));
  assert.strictEqual(settled, false, 'không có watchdog thì chuyển mô hình treo');
  assert.strictEqual(MD.listFiles(a).length, 3, 'chưa xoá bản gốc');
});
test('hết hạn khi chép treo: báo lỗi, xoá tệp dở, giữ bản gốc', async () => {
  const d = tmp(); const a = path.join(d, 'a'), b = path.join(d, 'b'); fill(a); const t0 = Date.now();
  await assert.rejects(MD.moveModels(a, b, { copy: true, stallMs: 250, copyFile: (_s, tmp) => { fs.writeFileSync(tmp, 'dở'); return new Promise(() => {}); } }), (e) => e.code === 'ESTALL' && e.message === MD.STALL_MSG);
  assert.ok(Date.now() - t0 < 5000, 'watchdog phải cắt sớm, không chờ mãi');
  assert.strictEqual(MD.listFiles(a).length, 3); assert.deepStrictEqual(MD.listFiles(b), []);
});
test('lỗi giữa chừng: hoàn tác đổi tên và bản chép, thư mục cũ còn đủ tệp', async () => {
  for (const copy of [false, true]) {
    const d = tmp(); const a = path.join(d, 'a'), b = path.join(d, 'b'); fill(a);
    await assert.rejects(MD.moveModels(a, b, { copy, afterEach: () => { throw new Error('đứt'); } }), /đứt/);
    assert.strictEqual(MD.listFiles(a).length, 3, copy ? 'chép' : 'đổi tên'); assert.deepStrictEqual(MD.listFiles(b), []);
  }
});
test('tiến độ ném lỗi không làm lời hứa chép treo', async () => {
  const d = tmp(); const a = path.join(d, 'a'), b = path.join(d, 'b'); fill(a);
  const r = await MD.moveModels(a, b, { copy: true, onProgress: () => { throw new Error('ui'); } });
  assert.strictEqual(r.moved, 3); assert.strictEqual(MD.listFiles(a).length, 0); assert.strictEqual(MD.listFiles(b).length, 3);
});
test('cổng tiến độ: sự kiện đến sau khi xong không bật lại thanh', () => {
  assert.strictEqual(MD.dirProgressGate(null, { done: 1 }).show, false);
  assert.strictEqual(MD.dirProgressGate({ moving: true }, { done: 1, total: 2 }).show, true);
  const fin = MD.dirProgressGate({ moving: true }, { finished: true });
  assert.strictEqual(fin.hide, true); assert.strictEqual(fin.moving, false);
  assert.strictEqual(MD.dirProgressGate({ moving: false }, { done: 1, total: 1, file: 'late.gguf' }).show, false);
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  assert.match(app, /if \(!mdirJob \|\| !mdirJob\.moving\) return/);
  assert.match(app, /MDIR_STALL_MSG/); assert.match(app, /mdir-retry|mdirRetry/);
});
test('nhật ký chuyển: sập khi đang dở thì hoàn tác, đủ tệp thì tiếp tục, xoá nhật ký sau khi đã lưu cấu hình', async () => {
  const d = tmp(); const a = path.join(d, 'a'), b = path.join(d, 'b'), j = path.join(d, 'move.json'); fill(a);
  const rels = MD.listFiles(a).map(f => ({ rel: f.rel, size: f.size })); const first = rels[0];
  fs.mkdirSync(path.dirname(path.join(b, first.rel)), { recursive: true }); fs.renameSync(path.join(a, first.rel), path.join(b, first.rel));
  fs.writeFileSync(j, JSON.stringify({ from: path.resolve(a), to: path.resolve(b), rels, phase: 'moving' }));
  const back = MD.recoverMove(j);
  assert.strictEqual(back.rolledBack, true); assert.strictEqual(back.dir, path.resolve(a));
  assert.strictEqual(MD.listFiles(a).length, 3); assert.deepStrictEqual(MD.listFiles(b), []); assert.ok(!fs.existsSync(j));
  fill(a); const rels2 = MD.listFiles(a).map(f => ({ rel: f.rel, size: f.size }));
  for (const f of rels2) { fs.mkdirSync(path.dirname(path.join(b, f.rel)), { recursive: true }); fs.renameSync(path.join(a, f.rel), path.join(b, f.rel)); }
  fs.writeFileSync(j, JSON.stringify({ from: path.resolve(a), to: path.resolve(b), rels: rels2, phase: 'commit' }));
  const go = MD.recoverMove(j);
  assert.strictEqual(go.resumed, true); assert.strictEqual(go.dir, path.resolve(b)); assert.strictEqual(MD.listFiles(b).length, 3); assert.ok(!fs.existsSync(j));
  fill(a); await MD.moveModels(a, b, { journal: j }); assert.ok(fs.existsSync(j), 'chưa xoá nhật ký trước khi lưu cấu hình'); MD.journalClear(j); assert.ok(!fs.existsSync(j));
});
test('trình tải: thư mục đích theo thư mục mô hình HIỆN TẠI, kiểm dung lượng trước khi tải', () => {
  const s = fs.readFileSync(path.join(root, 'src/downloader.js'), 'utf8');
  assert.match(s, /typeof dir === 'function' \? dir\(\) : dir/); assert.match(s, /if \(checkSpace && j\.total\) checkSpace\(/);
  const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'); assert.match(m, /createDownloader\(\{ dir: \(\) => paths\.models, checkSpace:/);
  assert.match(m, /if \(QA_PROFILE\) return \{ ok: false, error: 'Hồ sơ QA/);
});
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
const runUi = (ud, script, out, extra) => spawnSync('timeout', ['200', 'nice', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--qa-ui', script, '--out', out], { cwd: root, encoding: 'utf8', env: { ...process.env, AIVN_QA_MODE: '1', AIVN_SKIP_ACTIVATION: '1', AIVN_USER_DATA: ud, ...(extra || {}) } });
for (const mode of ['move', 'point']) test(`giao diện thật (Xvfb): Cài đặt → Chung → Đổi thư mục… (${mode === 'move' ? 'chuyển mô hình' : 'chỉ trỏ sang thư mục mới'})`, { skip: !hasX && 'cần xvfb', timeout: 240e3 }, () => {
  const d = tmp(); const ud = path.join(d, 'ud'), nd = path.join(d, 'D-models'); fill(path.join(ud, 'models')); fs.mkdirSync(nd);
  const s = { name: 'mdir-' + mode, steps: [{ goto: 'chat' }, { waitFor: ['ob-skip', 4000], optional: true }, { click: 'ob-skip', optional: true },
    { goto: 'settings/general' }, { expectText: ['mdir-info', path.join(ud, 'models')] }, { setFiles: ['mdir-change', nd] },
    { expectText: ['confirm-modal', 'Chuyển 3 tệp'] }, mode === 'move' ? { click: 'cf-yes' } : { click: 'cf-no' }, ...(mode === 'point' ? [{ expectText: ['confirm-modal', 'Chỉ dùng thư mục mới'] }, { click: 'cf-yes' }] : []),
    { expectHidden: 'mdir-prog', timeout: 20000 }, { expectText: ['mdir-info', nd] }, { goto: 'models' }, { expectText: ['models-dir', nd] }] };
  fs.writeFileSync(path.join(d, 's.json'), JSON.stringify(s)); const r = runUi(ud, path.join(d, 's.json'), path.join(d, 'r.json'));
  const j = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8'));
  assert.deepStrictEqual(j.steps.filter(x => !x.ok).map(x => `${x.n} ${x.action}: ${x.error}`), []); assert.strictEqual(r.status, 0);
  const st = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')); assert.strictEqual(st.modelsDir, nd);
  if (mode === 'move') { assert.strictEqual(MD.listFiles(nd).length, 3); assert.strictEqual(MD.listFiles(path.join(ud, 'models')).length, 0); }
  else { assert.strictEqual(MD.listFiles(nd).length, 0); assert.strictEqual(MD.listFiles(path.join(ud, 'models')).length, 3); assert.deepStrictEqual(st.modelDirsExtra, [path.join(ud, 'models')]); }
});
test('giao diện: sự kiện tiến độ đến muộn không giữ thanh đang chuyển', { skip: !hasX && 'cần xvfb', timeout: 240e3 }, () => {
  const d = tmp(); const ud = path.join(d, 'ud'), nd = path.join(d, 'D-models'); fill(path.join(ud, 'models')); fs.mkdirSync(nd);
  const s = { name: 'mdir-late', steps: [{ goto: 'chat' }, { waitFor: ['ob-skip', 4000], optional: true }, { click: 'ob-skip', optional: true },
    { goto: 'settings/general' }, { expectText: ['mdir-info', path.join(ud, 'models')] }, { setFiles: ['mdir-change', nd] },
    { expectText: ['confirm-modal', 'Chuyển 3 tệp'] }, { click: 'cf-yes' },
    { expectHidden: 'mdir-prog', timeout: 20000 }, { wait: 1200 }, { expectHidden: 'mdir-prog', timeout: 3000 }, { expectText: ['mdir-info', nd] }] };
  fs.writeFileSync(path.join(d, 's.json'), JSON.stringify(s));
  const r = runUi(ud, path.join(d, 's.json'), path.join(d, 'r.json'), { AIVN_MDIR_LATE_PROGRESS: '1' });
  const j = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8'));
  assert.deepStrictEqual(j.steps.filter(x => !x.ok).map(x => `${x.n} ${x.action}: ${x.error}`), []); assert.strictEqual(r.status, 0);
});
