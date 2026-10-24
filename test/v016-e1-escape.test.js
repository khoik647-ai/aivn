'use strict';
// E1: đích bị xoá hoặc không trả lời thì không chờ mãi — hiện Thử lại, Về thư mục cũ, Chọn thư mục khác.
// Về thư mục cũ chỉ khi nguồn còn đủ tệp. Thiếu cả hai nơi hoặc đang chia hai thư mục thì giữ nhật ký, không xoá tệp.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const MD = require('../src/models-dir');
const CORE = require('../src/i18n/core');
const tr = CORE.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
const root = path.join(__dirname, '..');
const RELS = ['m/f1.gguf', 'm/f2.gguf', 'm/f3.gguf', 'm/f4.gguf', 'm/f5.gguf'];

function sha256(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  try { const buf = Buffer.alloc(1 << 16); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function modelBuf(i) { const buf = Buffer.alloc(320 + i * 13); for (let j = 0; j < buf.length; j++) buf[j] = (i * 19 + j) & 255; return buf; }
function put(dir, rel, buf) { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return p; }
function rmAll(...ps) { for (const p of ps) { try { if (p) fs.rmSync(p, { recursive: true, force: true }); } catch {} } }
function fresh() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-e1-'));
  const from = path.join(d, 'from'); const parent = path.join(d, 'vol'); const to = path.join(parent, 'models');
  fs.mkdirSync(from, { recursive: true }); fs.mkdirSync(to, { recursive: true });
  return { d, parent, from, to, journal: path.join(d, 'move.json'), away: null };
}
function seed(from) {
  const hashes = new Map();
  RELS.forEach((rel, i) => { put(from, rel, modelBuf(i + 1)); hashes.set(rel, sha256(path.join(from, rel))); });
  return hashes;
}
function metaOf(dir, rel, hashes) {
  const p = path.join(dir, rel);
  return { rel, size: fs.statSync(p).size, sha256: hashes.get(rel) };
}
function writeJournal(box, rels, phase) {
  const created = rels.map((r) => ({ ...r, kind: 'copy' }));
  fs.writeFileSync(box.journal, JSON.stringify({ from: path.resolve(box.from), to: path.resolve(box.to), rels, created, temps: [], phase: phase || 'commit' }));
}
function snap(dir) {
  const m = new Map();
  if (!dir || !fs.existsSync(dir)) return m;
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) m.set(r, sha256(p));
    }
  };
  walk(dir, '');
  return m;
}
function sameSnap(a, b, label) {
  assert.deepStrictEqual([...a.keys()].sort(), [...b.keys()].sort(), label);
  for (const [rel, hash] of a) assert.strictEqual(b.get(rel), hash, label + ' ' + rel);
}
function modelsOf(dir) { return MD.listFiles(dir).map((f) => f.rel).filter((r) => r.endsWith('.gguf')).sort(); }
function hideDrive(box) { const away = box.parent + '-away'; fs.renameSync(box.parent, away); box.away = away; return path.join(away, path.basename(box.to)); }
function showDrive(box) { fs.renameSync(box.away, box.parent); box.away = null; }
function under(rootDir, p) { const r = path.resolve(rootDir); const x = path.resolve(p); return x === r || x.startsWith(r + path.sep); }

test('E1 đích bị xoá: hiện ba thao tác, không treo', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    for (const rel of RELS) put(box.to, rel, fs.readFileSync(path.join(box.from, rel)));
    fs.unlinkSync(path.join(box.from, RELS[0]));
    fs.unlinkSync(path.join(box.from, RELS[1]));
    writeJournal(box, RELS.map((rel) => metaOf(box.to, rel, hashes)));
    const raw = fs.readFileSync(box.journal);
    const fromBefore = snap(box.from); const toBefore = snap(box.to);
    hideDrive(box);
    const t0 = Date.now();
    const rec = await MD.recoverMove(box.journal, { waitMs: 1500 });
    const ms = Date.now() - t0;
    assert.ok(ms < 1500, 'treo ' + ms + ' ms');
    assert.strictEqual(rec.pending, true);
    assert.strictEqual(rec.state, 'pending');
    assert.deepStrictEqual(rec.actions, ['retry', 'back', 'choose']);
    assert.match(rec.notice, /chờ/);
    const again = await MD.escapePending(box.journal, { action: 'retry', waitMs: 800 });
    assert.strictEqual(again.ok, false);
    assert.strictEqual(again.pending, true);
    assert.deepStrictEqual(again.actions, ['retry', 'back', 'choose']);
    assert.ok(Date.now() - t0 < 2500, 'thử lại cũng không được treo');
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    sameSnap(fromBefore, snap(box.from), 'nguồn');
    sameSnap(toBefore, snap(box.away && path.join(box.away, 'models')), 'đích đã giấu');
  } finally { rmAll(box.d, box.parent, box.away); }
});

test('E1 thăm đích không trả lời: hết giờ thì vẫn hiện lối thoát', async () => {
  const box = fresh();
  const orig = fs.promises.lstat; const sync = fs.lstatSync; const syncHits = [];
  try {
    seed(box.from);
    writeJournal(box, RELS.map((rel) => metaOf(box.from, rel, new Map(RELS.map((r) => [r, sha256(path.join(box.from, r))])))));
    fs.lstatSync = (p, ...a) => { if (under(box.to, p) || path.resolve(p) === path.resolve(box.parent)) syncHits.push(String(p)); return sync(p, ...a); };
    fs.promises.lstat = (p, ...a) => { if (under(box.to, p) || path.resolve(p) === path.resolve(box.parent)) return new Promise(() => {}); return orig(p, ...a); };
    const raw = fs.readFileSync(box.journal);
    const t0 = Date.now();
    const rec = await MD.recoverMove(box.journal, { waitMs: 250 });
    const ms = Date.now() - t0;
    assert.ok(ms < 1200, 'không được chờ mãi, mất ' + ms);
    assert.ok(ms >= 200, 'phải tôn trọng hạn chờ');
    assert.strictEqual(rec.pending, true);
    assert.strictEqual(rec.reason, 'destination unreachable');
    assert.strictEqual(rec.fsCode, 'ETIMEOUT');
    assert.deepStrictEqual(rec.actions, ['retry', 'back', 'choose']);
    assert.match(rec.notice, /không trả lời kịp/);
    assert.match(tr.tr(rec.notice, 'en'), /did not respond in time/);
    assert.match(tr.tr(rec.notice, 'en'), /go back to the previous folder/i);
    assert.match(tr.tr(rec.notice, 'en'), /choose another folder/i);
    assert.match(tr.tr(rec.notice, 'zh'), /没有及时响应/);
    assert.match(tr.tr(rec.notice, 'zh'), /回到原文件夹/);
    assert.match(tr.tr(rec.notice, 'zh'), /选择其他文件夹/);
    assert.deepStrictEqual(syncHits, [], 'không được lstatSync trên đích đang kẹt');
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    assert.deepStrictEqual(modelsOf(box.from), RELS.slice().sort());
  } finally { fs.promises.lstat = orig; fs.lstatSync = sync; rmAll(box.d, box.parent, box.away); }
});

test('E1 về thư mục cũ: trỏ lại nguồn còn tệp, danh sách mô hình trở lại, không xoá tệp', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    for (const rel of RELS) put(box.to, rel, fs.readFileSync(path.join(box.from, rel)));
    writeJournal(box, RELS.map((rel) => metaOf(box.from, rel, hashes)), 'moving');
    const fromBefore = snap(box.from); const toBefore = snap(box.to);
    const parked = hideDrive(box);
    let modelsDir = path.resolve(box.to);
    assert.deepStrictEqual(modelsOf(modelsDir), [], 'đích đã mất thì danh sách đang trống');
    const back = await MD.escapePending(box.journal, { action: 'back', waitMs: 800 });
    assert.strictEqual(back.ok, true);
    assert.strictEqual(back.action, 'back');
    assert.strictEqual(back.cleared, true);
    assert.strictEqual(back.pending, false);
    modelsDir = back.dir;
    assert.strictEqual(modelsDir, path.resolve(box.from));
    assert.deepStrictEqual(modelsOf(modelsDir), RELS.slice().sort());
    assert.ok(!fs.existsSync(box.journal));
    sameSnap(fromBefore, snap(box.from), 'nguồn giữ nguyên');
    sameSnap(toBefore, snap(parked), 'bản trên ổ đã rút không bị xoá');
    const viaSourcePath = path.resolve(box.from);
    assert.notStrictEqual(viaSourcePath, parked);
  } finally { rmAll(box.d, box.parent, box.away); }
});

test('E1 về thư mục cũ bị từ chối khi tệp mất cả hai nơi, và khi tệp đang chia hai thư mục', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    put(box.to, RELS[0], fs.readFileSync(path.join(box.from, RELS[0])));
    fs.unlinkSync(path.join(box.from, RELS[0]));
    writeJournal(box, RELS.map((rel) => metaOf(fs.existsSync(path.join(box.to, rel)) ? box.to : box.from, rel, hashes)), 'commit');
    const fromBefore = snap(box.from); const toBefore = snap(box.to); const raw = fs.readFileSync(box.journal);
    const split = await MD.escapePending(box.journal, { action: 'back', waitMs: 800 });
    assert.strictEqual(split.ok, false);
    assert.strictEqual(split.pending, true);
    assert.strictEqual(split.code, 'EKEEP');
    assert.strictEqual(split.reason, 'split');
    assert.match(split.error, /không xoá tệp nào/);
    assert.match(tr.tr(split.error, 'en'), /no file was deleted/);
    assert.match(tr.tr(split.error, 'en'), /previous folder/);
    assert.match(tr.tr(split.error, 'zh'), /不会删除任何文件/);
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    sameSnap(fromBefore, snap(box.from), 'nguồn');
    sameSnap(toBefore, snap(box.to), 'đích còn f1');
    assert.strictEqual(sha256(path.join(box.to, RELS[0])), hashes.get(RELS[0]));
    fs.rmSync(box.to, { recursive: true, force: true });
    const both = await MD.escapePending(box.journal, { action: 'back', waitMs: 800 });
    assert.strictEqual(both.ok, false);
    assert.strictEqual(both.pending, true);
    assert.strictEqual(both.reason, 'files missing both');
    assert.match(both.error, /không thấy ở cả hai thư mục/);
    assert.match(both.error, /không xoá/);
    assert.match(tr.tr(both.error, 'en'), /missing from both folders/);
    assert.match(tr.tr(both.error, 'zh'), /两个文件夹里都没有/);
    assert.ok(fs.existsSync(box.journal));
    sameSnap(fromBefore, snap(box.from), 'nguồn sau khi từ chối');
    assert.ok(!fs.existsSync(path.join(box.from, RELS[0])));
    const choose = await MD.escapePending(box.journal, { action: 'choose', waitMs: 800 });
    assert.strictEqual(choose.ok, false);
    assert.strictEqual(choose.reason, 'files missing both');
    assert.ok(fs.existsSync(box.journal));
  } finally { rmAll(box.d, box.parent, box.away); }
});

test('E1 thử lại khi đích có lại thì chuyển tiếp, không xoá nhật ký khi đích còn mất', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    for (const rel of RELS) put(box.to, rel, fs.readFileSync(path.join(box.from, rel)));
    fs.unlinkSync(path.join(box.from, RELS[0]));
    fs.unlinkSync(path.join(box.from, RELS[1]));
    writeJournal(box, RELS.map((rel) => metaOf(box.to, rel, hashes)));
    const parked = hideDrive(box);
    const toBefore = snap(parked);
    const waiting = await MD.escapePending(box.journal, { action: 'retry', waitMs: 800 });
    assert.strictEqual(waiting.pending, true);
    assert.strictEqual(waiting.ok, false);
    assert.deepStrictEqual(waiting.actions, ['retry', 'back', 'choose']);
    sameSnap(toBefore, snap(parked), 'chưa xoá khi đang chờ');
    assert.ok(fs.existsSync(box.journal));
    showDrive(box);
    const done = await MD.escapePending(box.journal, { action: 'retry', waitMs: 4000 });
    assert.strictEqual(done.ok, true);
    assert.strictEqual(done.resumed, true);
    assert.strictEqual(done.dir, path.resolve(box.to));
    assert.ok(!fs.existsSync(box.journal));
    assert.deepStrictEqual(modelsOf(box.to), RELS.slice().sort());
    for (const rel of RELS) assert.strictEqual(sha256(path.join(box.to, rel)), hashes.get(rel), rel);
    assert.deepStrictEqual(modelsOf(box.from), []);
  } finally { rmAll(box.d, box.parent, box.away); }
});

test('E1 giao diện không được đưa đường dẫn tuỳ ý', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    writeJournal(box, RELS.map((rel) => metaOf(box.from, rel, hashes)), 'moving');
    const evil = path.join(box.d, 'evil-models');
    fs.mkdirSync(evil);
    put(evil, 'm/stolen.gguf', Buffer.from('nope'));
    const raw = fs.readFileSync(box.journal);
    const fromBefore = snap(box.from);
    for (const action of ['back', 'retry', 'choose']) {
      const r = await MD.escapePending(box.journal, { action, path: evil, waitMs: 400 });
      assert.strictEqual(r.code, 'EPATH', action);
      assert.strictEqual(r.ok, false);
      assert.match(r.error, /Không nhận đường dẫn từ giao diện/);
      assert.match(tr.tr(r.error, 'en'), /was not accepted/);
      assert.match(tr.tr(r.error, 'zh'), /不接受来自界面的路径/);
    }
    const chooseOwn = await MD.escapePending(box.journal, { action: 'choose', path: path.resolve(box.from), waitMs: 400 });
    assert.strictEqual(chooseOwn.code, 'EPATH', 'chọn thư mục khác không nhận đường dẫn từ giao diện');
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    sameSnap(fromBefore, snap(box.from), 'nguồn');
    assert.ok(fs.existsSync(path.join(evil, 'm/stolen.gguf')));
    const allowed = await MD.escapePending(box.journal, { action: 'back', path: path.resolve(box.from), waitMs: 800 });
    assert.strictEqual(allowed.ok, true);
    assert.strictEqual(allowed.dir, path.resolve(box.from), 'dù gửi đúng nguồn thì vẫn dùng đường dẫn trong nhật ký');
    assert.notStrictEqual(allowed.dir, evil);
    sameSnap(fromBefore, snap(box.from), 'sau khi về');
  } finally { rmAll(box.d, box.parent, box.away); }
});

test('E1 giao diện và tiến trình chính: ba nút, hạn chờ, không gán đường dẫn của renderer', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
  assert.match(html, /data-testid="mdir-pending"/);
  assert.match(html, /data-testid="mdir-pending-retry"[^>]*>Thử lại</);
  assert.match(html, /data-testid="mdir-pending-back"[^>]*>Về thư mục cũ</);
  assert.match(html, /data-testid="mdir-pending-choose"[^>]*>Chọn thư mục khác</);
  assert.match(html, /Đang chờ thư mục đích\. Có thể thử lại, về thư mục cũ, hoặc chọn thư mục khác\./);
  assert.strictEqual(tr.tr('Thử lại', 'en'), 'Try again');
  assert.strictEqual(tr.tr('Về thư mục cũ', 'en'), 'Go back to the previous folder');
  assert.strictEqual(tr.tr('Chọn thư mục khác', 'en'), 'Choose another folder');
  assert.strictEqual(tr.tr('Thử lại', 'zh'), '重试');
  assert.strictEqual(tr.tr('Về thư mục cũ', 'zh'), '回到原文件夹');
  assert.strictEqual(tr.tr('Chọn thư mục khác', 'zh'), '选择其他文件夹');
  assert.strictEqual(tr.tr('Đang chờ thư mục đích. Có thể thử lại, về thư mục cũ, hoặc chọn thư mục khác.', 'en'), 'Waiting for the destination folder. You can try again, go back to the previous folder, or choose another folder.');
  const panel = app.slice(app.indexOf('function mdirShowPending'), app.indexOf('async function mdirRefresh'));
  assert.match(panel, /mdirProg/);
  assert.match(panel, /hidden = true/);
  assert.match(app, /MDIR_INFO_WAIT = 8000/);
  assert.match(app, /modelsDirEscape\(\{ action \}\)/);
  const escUi = app.slice(app.indexOf('async function mdirEscape'), app.indexOf('if (A.onModelsDirState)'));
  assert.doesNotMatch(escUi, /path\s*:/);
  assert.match(preload, /modelsDirEscape: inv\('models:dir-escape'\)/);
  assert.match(main, /waitMs: require\('\.\/models-dir'\)\.PENDING_WAIT_MS/);
  const ipc = main.slice(main.indexOf("ipcMain.handle('models:dir-escape'"), main.indexOf("ipcMain.handle('models:dir-reset'"));
  assert.match(ipc, /escapePending\(journal, \{ action, path: asked \}\)/);
  assert.match(ipc, /commitChoose\(journal, v\.dir\)/);
  assert.doesNotMatch(ipc, /paths\.models = asked/);
  assert.doesNotMatch(ipc, /paths\.models = body/);
  assert.match(ipc, /dialog\.showOpenDialog/);
  const ask = main.slice(main.indexOf('function askApproval'), main.indexOf('const slimStep'));
  assert.match(ask, /10 \* 60e3/, 'không đụng khối xin phép quanh dòng 711');
});
