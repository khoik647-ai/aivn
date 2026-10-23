'use strict';
// B218: recoverMove giữ nhật ký khi ổ đích chưa truy cập được, rồi hoàn tất khi đích trở lại.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { spawnSync } = require('child_process');
const MD = require('../src/models-dir');
const CORE = require('../src/i18n/core');
const tr = CORE.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
const LOG = require('../src/logger');
const root = path.join(__dirname, '..');

function sha256(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  try { const buf = Buffer.alloc(1 << 16); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function tree(dir) {
  const m = new Map();
  if (!dir || !fs.existsSync(dir)) return m;
  for (const f of MD.listFiles(dir)) {
    const p = path.join(dir, f.rel);
    const st = fs.statSync(p);
    m.set(f.rel, { hash: sha256(p), ino: st.ino, size: st.size });
  }
  return m;
}
function put(dir, rel, buf) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  return p;
}
function modelBuf(i, size) {
  const buf = Buffer.alloc(size);
  for (let j = 0; j < size; j++) buf[j] = (i * 17 + j * 3) & 255;
  return buf;
}
const RELS = ['m/f1.gguf', 'm/f2.gguf', 'm/f3.gguf', 'm/f4.gguf', 'm/f5.gguf'];
function seed(from) {
  const hashes = new Map();
  RELS.forEach((rel, i) => { put(from, rel, modelBuf(i + 1, 4096 + i * 257)); hashes.set(rel, sha256(path.join(from, rel))); });
  return hashes;
}
function crossFsRoot() {
  try {
    fs.accessSync('/dev/shm', fs.constants.W_OK);
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-devchk-'));
    const b = fs.mkdtempSync(path.join('/dev/shm', 'aivn-devchk-'));
    const diff = fs.statSync(a).dev !== fs.statSync(b).dev;
    fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true });
    return diff ? '/dev/shm' : null;
  } catch { return null; }
}
const SHM = crossFsRoot();
function rmAll(...ps) { for (const p of ps) { try { if (p) fs.rmSync(p, { recursive: true, force: true }); } catch {} } }
function sameTree(a, b, label) {
  assert.deepStrictEqual([...a.keys()].sort(), [...b.keys()].sort(), label);
  for (const [rel, meta] of a) assert.deepStrictEqual(b.get(rel), meta, label + ' ' + rel);
}
function assertNoLoss(srcBefore, from, to) {
  const a = tree(from), b = tree(to);
  const lost = [];
  for (const [rel, hash] of srcBefore) {
    if (a.get(rel)?.hash !== hash && b.get(rel)?.hash !== hash) lost.push(rel);
  }
  assert.deepStrictEqual(lost, []);
}
function countReads(fn) {
  const orig = fs.createReadStream;
  let n = 0;
  fs.createReadStream = function (...a) { n++; return orig.apply(this, a); };
  return Promise.resolve().then(fn).finally(() => { fs.createReadStream = orig; }).then(() => n);
}
function countMutations(fn) {
  const names = ['unlinkSync', 'rmSync', 'renameSync', 'rmdirSync', 'copyFileSync', 'writeFileSync', 'linkSync'];
  const orig = {}; const hits = [];
  for (const name of names) { orig[name] = fs[name]; fs[name] = function (...a) { hits.push(name); return orig[name].apply(this, a); }; }
  const pu = fs.promises.unlink, pr = fs.promises.rm, pre = fs.promises.rename;
  fs.promises.unlink = async (...a) => { hits.push('unlink'); return pu(...a); };
  fs.promises.rm = async (...a) => { hits.push('rm'); return pr(...a); };
  fs.promises.rename = async (...a) => { hits.push('rename'); return pre(...a); };
  return Promise.resolve().then(fn).finally(() => {
    for (const name of names) fs[name] = orig[name];
    fs.promises.unlink = pu; fs.promises.rm = pr; fs.promises.rename = pre;
  }).then(() => hits);
}
function mockDestError(code, pred, fn) {
  const lstatSync = fs.lstatSync, readdirSync = fs.readdirSync, lstat = fs.promises.lstat, readdir = fs.promises.readdir;
  const boom = (p) => { const e = new Error(code); e.code = code; e.path = String(p); throw e; };
  fs.lstatSync = (p, ...a) => { if (pred(p)) boom(p); return lstatSync(p, ...a); };
  fs.readdirSync = (p, ...a) => { if (pred(p)) boom(p); return readdirSync(p, ...a); };
  fs.promises.lstat = async (p, ...a) => { if (pred(p)) boom(p); return lstat(p, ...a); };
  fs.promises.readdir = async (p, ...a) => { if (pred(p)) boom(p); return readdir(p, ...a); };
  return Promise.resolve().then(fn).finally(() => {
    fs.lstatSync = lstatSync; fs.readdirSync = readdirSync; fs.promises.lstat = lstat; fs.promises.readdir = readdir;
  });
}
function under(rootDir, p) { const r = path.resolve(rootDir); const x = path.resolve(p); return x === r || x.startsWith(r + path.sep); }
function assertPending(rec, from, to) {
  assert.ok(rec && rec.pending, 'pending');
  assert.strictEqual(rec.state, 'pending');
  assert.strictEqual(rec.reason, 'destination missing');
  assert.strictEqual(rec.dir, path.resolve(from), 'cài đặt giữ thư mục cũ');
  assert.strictEqual(rec.to, path.resolve(to));
  assert.match(rec.log, /chờ ổ đích/);
  assert.match(rec.log, /chỉ còn ở ổ đích đang thiếu/);
  assert.match(rec.log, /Sẽ thử lại khi thư mục này truy cập được/);
  assert.ok(rec.log.includes(path.resolve(to)), 'nhật ký liệt kê thư mục đích');
  assert.doesNotMatch(rec.log, /Đã hoàn tác/);
  assert.doesNotMatch(rec.log, /Chưa xoá hay dời/);
  assert.match(rec.notice, /chờ ổ đích/);
  assert.match(rec.notice, /chỉ còn ở ổ đích đang thiếu/);
  assert.match(rec.notice, /sẽ được phục hồi khi ổ này có lại/);
  assert.doesNotMatch(rec.notice, /Đã hoàn tác/);
  assert.doesNotMatch(rec.notice, /Chưa xoá hay dời/);
  assert.ok(!rec.notice.includes(path.resolve(to)), 'thông báo không kèm đường dẫn riêng');
  const en = tr.tr(rec.log, 'en'), zh = tr.tr(rec.log, 'zh');
  assert.match(en, /waiting for the destination drive/);
  assert.match(en, /may currently exist only on the missing destination drive/);
  assert.doesNotMatch(en, /Nothing was deleted/);
  assert.ok(en.includes(path.resolve(to)));
  assert.doesNotMatch(en, /Đã hoàn tác/);
  assert.match(zh, /等待目标磁盘/);
  assert.match(zh, /可能只在缺失的目标磁盘上/);
  assert.doesNotMatch(zh, /尚未删除或移动/);
  assert.ok(zh.includes(path.resolve(to)));
  const enN = tr.tr(rec.notice, 'en'), zhN = tr.tr(rec.notice, 'zh');
  assert.match(enN, /waiting for destination drive/);
  assert.match(enN, /may currently exist only on the missing destination drive/);
  assert.match(enN, /will be recovered when this drive is back/);
  assert.doesNotMatch(enN, /Nothing was deleted/);
  assert.ok(!enN.includes(path.resolve(to)));
  assert.match(zhN, /可能只在缺失的目标磁盘上/);
  assert.match(zhN, /重新连接后会恢复/);
  assert.doesNotMatch(zhN, /尚未删除或移动/);
}
function logPending(rec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b218-log-'));
  LOG.init(dir, 'b218');
  LOG.log('app', rec.log);
  const text = fs.readFileSync(LOG.file, 'utf8');
  assert.match(text, /chờ ổ đích/);
  assert.match(text, /chỉ còn ở ổ đích đang thiếu/);
  assert.match(text, /Sẽ thử lại khi thư mục này truy cập được/);
  assert.ok(text.includes(path.resolve(rec.to)));
  assert.doesNotMatch(text, /Đã hoàn tác/);
  assert.doesNotMatch(text, /Chưa xoá hay dời/);
  rmAll(dir);
}

async function childMain() {
  const cfg = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--child') + 1], 'utf8'));
  try {
    await MD.moveModels(cfg.from, cfg.to, { copy: !!cfg.copy, killAt: cfg.killAt, journal: cfg.journal, stallMs: 0 });
    process.exit(2);
  } catch (e) { console.error(e && e.stack || e); process.exit(1); }
}

if (process.argv.includes('--child')) {
  childMain().catch((e) => { console.error(e); process.exit(1); });
} else {
  function fresh(cross) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b218-'));
    const from = path.join(d, 'from');
    const vol = cross ? fs.mkdtempSync(path.join(SHM, 'aivn-b218-')) : path.join(d, 'vol');
    const to = path.join(vol, 'to');
    fs.mkdirSync(from, { recursive: true }); fs.mkdirSync(to, { recursive: true });
    return { d, parent: vol, from, to, journal: path.join(d, 'move.json'), away: null };
  }
  // Ổ vắng thật: cả thư mục cha của đích cũng mất (không chỉ xoá đúng thư mục đích).
  function hideDrive(box) {
    const away = box.parent + '-away';
    fs.renameSync(box.parent, away);
    box.away = away;
    return path.join(away, path.basename(box.to));
  }
  function showDrive(box) {
    fs.renameSync(box.away, box.parent);
    box.away = null;
  }
  function handCommit(box) {
    const srcBefore = seed(box.from);
    for (const rel of RELS) put(box.to, rel, fs.readFileSync(path.join(box.from, rel)));
    fs.unlinkSync(path.join(box.from, RELS[0]));
    fs.unlinkSync(path.join(box.from, RELS[1]));
    const rels = RELS.map((rel) => ({ rel, size: fs.statSync(path.join(box.to, rel)).size, sha256: srcBefore.get(rel) }));
    const created = rels.map((r) => ({ ...r, kind: 'copy' }));
    fs.writeFileSync(box.journal, JSON.stringify({ from: path.resolve(box.from), to: path.resolve(box.to), rels, created, temps: [], phase: 'commit' }));
    return srcBefore;
  }

  test('B218 ổ đích vắng (cha cũng mất): giữ nhật ký, không xoá, trạng thái pending, không nói chưa xoá tệp nào', async () => {
    const box = fresh(false);
    try {
      const srcBefore = handCommit(box);
      const fromBefore = tree(box.from), toBefore = tree(box.to);
      const raw = fs.readFileSync(box.journal);
      const parked = hideDrive(box);
      let rec;
      const hits = await countMutations(async () => {
        const reads = await countReads(async () => {
          rec = await MD.recoverMove(box.journal);
          assertPending(rec, box.from, box.to);
          let modelsDir = path.resolve(box.from);
          if (rec.resumed) modelsDir = rec.dir;
          assert.strictEqual(modelsDir, path.resolve(box.from));
          const again = await MD.recoverMove(box.journal);
          assertPending(again, box.from, box.to);
          const third = await MD.recoverMove(box.journal);
          assertPending(third, box.from, box.to);
        });
        assert.strictEqual(reads, 0, 'không băm khi đích vắng');
      });
      logPending(rec);
      assert.deepStrictEqual(hits, [], 'không xoá hay dời khi đích vắng: ' + hits.join(','));
      assert.ok(fs.existsSync(box.journal));
      assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
      sameTree(fromBefore, tree(box.from), 'from');
      sameTree(toBefore, tree(parked), 'away');
      assertNoLoss(srcBefore, box.from, parked);
      showDrive(box);
      const done = await MD.recoverMove(box.journal);
      assert.strictEqual(done.resumed, true);
      assert.ok(!done.pending);
      assert.ok(!fs.existsSync(box.journal));
      assertNoLoss(srcBefore, box.from, box.to);
      assert.strictEqual(tree(box.to).size, 5);
      assert.strictEqual(tree(box.from).size, 0);
    } finally { rmAll(box.d, box.parent, box.away); }
  });

  test('B218 lỗi fs trên đích: giữ nhật ký, không đụng tệp cũ', async () => {
    const box = fresh(false);
    try {
      const srcBefore = handCommit(box);
      const fromBefore = tree(box.from), toBefore = tree(box.to);
      const raw = fs.readFileSync(box.journal);
      for (const code of ['EIO', 'EACCES', 'ENODEV', 'EPERM']) {
        const hits = await countMutations(() => mockDestError(code, (p) => under(box.to, p), async () => {
          const reads = await countReads(async () => {
            const rec = await MD.recoverMove(box.journal);
            assertPending(rec, box.from, box.to);
            assert.strictEqual(rec.fsCode, code);
            const again = await MD.recoverMove(box.journal);
            assertPending(again, box.from, box.to);
          });
          assert.strictEqual(reads, 0, code);
        }));
        assert.deepStrictEqual(hits, [], code + ' ' + hits.join(','));
        assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
        sameTree(fromBefore, tree(box.from), code + ' from');
        sameTree(toBefore, tree(box.to), code + ' to');
        assertNoLoss(srcBefore, box.from, box.to);
      }
      const readsOnly = fs.promises.lstat;
      fs.promises.lstat = async (p, ...a) => { if (under(box.to, p)) { const e = new Error('EIO'); e.code = 'EIO'; throw e; } return readsOnly(p, ...a); };
      try {
        const rec = await MD.recoverMove(box.journal);
        assertPending(rec, box.from, box.to);
        assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
      } finally { fs.promises.lstat = readsOnly; }
      sameTree(fromBefore, tree(box.from), 'lstat from');
      sameTree(toBefore, tree(box.to), 'lstat to');
    } finally { rmAll(box.d, box.parent, box.away); }
  });

  test('B218 ENOENT khi cha cũng mất: vẫn pending, không đụng tệp', async () => {
    const box = fresh(false);
    try {
      handCommit(box);
      const raw = fs.readFileSync(box.journal);
      const parent = path.resolve(box.parent);
      const hits = await countMutations(() => mockDestError('ENOENT', (p) => under(box.to, p) || path.resolve(p) === parent, async () => {
        const rec = await MD.recoverMove(box.journal);
        assertPending(rec, box.from, box.to);
        assert.strictEqual(rec.fsCode, 'ENOENT');
      }));
      assert.deepStrictEqual(hits, [], hits.join(','));
      assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    } finally { rmAll(box.d, box.parent, box.away); }
  });

  test('B218 main: log pending, không đổi modelsDir, thử lại khi mở thư mục mô hình', () => {
    const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
    const fn = main.slice(main.indexOf('function noteRecover'), main.indexOf('async function finishPendingMove'));
    const pend = fn.slice(fn.indexOf('if (rec.pending)'), fn.indexOf('pendingAnnounced = false'));
    assert.match(pend, /LOG\.log\('app', T\(rec\.log\)\)/);
    assert.match(pend, /T\(rec\.notice\)/);
    assert.match(pend, /app:notice/);
    assert.doesNotMatch(pend, /modelsDir/);
    assert.doesNotMatch(pend, /Đã hoàn tác/);
    assert.match(main, /await finishPendingMove\(false\)/);
    assert.match(main, /setInterval\(\(\) => \{ retryPendingMove\(\)/);
    assert.match(main, /models:dir-info', async \(\) => \{ if \(!dirMove\)/);
    assert.match(main, /if \(dirMove \|\| modelInUse\(\)\) return Promise\.resolve\(null\)/);
    assert.match(main, /recoverChain\.then\(\(\) => \{ if \(dirMove\) return null; return finishPendingMove\(true\); \}\)/);
    assert.match(main, /dirMove = hold/);
    assert.match(main, /await recoverChain/);
    assert.match(main, /T\('Đang chờ ổ đích của lần chuyển trước\.'\)/);
    assert.strictEqual(tr.tr('Đang chờ ổ đích của lần chuyển trước.', 'en'), 'Waiting for the destination drive of the previous move.');
    assert.strictEqual(tr.tr('Đang chờ ổ đích của lần chuyển trước.', 'zh'), '正在等待上一次移动的目标磁盘。');
  });

  async function crashRepro(name, { copy, cross, point, resumed }) {
    const box = fresh(!!cross);
    try {
      const srcBefore = seed(box.from);
      const cfg = path.join(box.d, 'cfg.json');
      fs.writeFileSync(cfg, JSON.stringify({ from: box.from, to: box.to, journal: box.journal, copy: !!copy, killAt: point }));
      const r = spawnSync(process.execPath, [__filename, '--child', cfg], { encoding: 'utf8', timeout: 20000 });
      assert.strictEqual(r.signal, 'SIGKILL', `${name} signal=${r.signal} status=${r.status} stderr=${(r.stderr || '').slice(-400)}`);
      assert.ok(fs.existsSync(box.journal), name + ' nhật ký');
      const fromBefore = tree(box.from), toBefore = tree(box.to);
      const raw = fs.readFileSync(box.journal);
      const parked = hideDrive(box);
      let rec;
      const hits = await countMutations(async () => {
        const reads = await countReads(async () => {
          rec = await MD.recoverMove(box.journal);
          assertPending(rec, box.from, box.to);
          const again = await MD.recoverMove(box.journal);
          assert.strictEqual(again.state, 'pending');
          assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
        });
        assert.strictEqual(reads, 0, name + ' băm khi vắng');
      });
      logPending(rec);
      assert.deepStrictEqual(hits, [], name + ' đổi tệp khi vắng');
      sameTree(fromBefore, tree(box.from), name + ' from');
      sameTree(toBefore, tree(parked), name + ' away');
      assertNoLoss(srcBefore, box.from, parked);
      showDrive(box);
      const done = await MD.recoverMove(box.journal);
      assert.strictEqual(!!done.resumed, resumed, name + ' resumed=' + !!done.resumed);
      assert.ok(!fs.existsSync(box.journal), name + ' xoá nhật ký sau khi xong');
      assertNoLoss(srcBefore, box.from, box.to);
      if (resumed) { assert.strictEqual(tree(box.from).size, 0); assert.strictEqual(tree(box.to).size, 5); }
      else { assert.strictEqual(tree(box.from).size, 5); assert.strictEqual(tree(box.to).size, 0); assert.strictEqual(done.rolledBack, true); }
    } finally { rmAll(box.d, box.parent, box.away); }
  }

  test('B218 P7: recover không xoá nhật ký của lần chuyển mới ghi đè giữa lúc băm', async () => {
    const box = fresh(false);
    try {
      handCommit(box);
      const newer = JSON.stringify({ from: path.resolve(box.from), to: path.resolve(box.to) + '-new', rels: [{ rel: 'n.gguf', size: 1, sha256: 'ab' }], created: [], temps: [], moveId: 'new-move', phase: 'moving' });
      const orig = fs.createReadStream;
      let swapped = false;
      fs.createReadStream = function (...a) {
        if (!swapped) { swapped = true; fs.writeFileSync(box.journal, newer); }
        return orig.apply(this, a);
      };
      try {
        await MD.recoverMove(box.journal);
        assert.ok(swapped, 'đã băm nên mới có cửa sổ ghi đè');
      } finally { fs.createReadStream = orig; }
      assert.strictEqual(fs.readFileSync(box.journal, 'utf8'), newer, 'nhật ký lần chuyển mới còn nguyên');
      assert.strictEqual(JSON.parse(fs.readFileSync(box.journal, 'utf8')).moveId, 'new-move');
    } finally { rmAll(box.d, box.parent, box.away); }
  });

  test('B218 P9: xoá thư mục đích nhưng cha còn thì không kẹt pending', async () => {
    const box = fresh(false);
    try {
      const srcBefore = seed(box.from);
      const rels = RELS.map((rel) => ({ rel, size: fs.statSync(path.join(box.from, rel)).size, sha256: srcBefore.get(rel) }));
      fs.writeFileSync(box.journal, JSON.stringify({ from: path.resolve(box.from), to: path.resolve(box.to), rels, created: rels.map((r) => ({ ...r, kind: 'copy' })), temps: [], moveId: 'p9', phase: 'moving' }));
      const fromBefore = tree(box.from);
      fs.rmSync(box.to, { recursive: true, force: true });
      assert.ok(fs.existsSync(box.parent), 'cha của đích còn');
      assert.ok(!fs.existsSync(box.to));
      const rec = await MD.recoverMove(box.journal);
      assert.ok(rec && !rec.pending, 'không kẹt chờ ổ');
      assert.strictEqual(rec.rolledBack, true);
      assert.ok(!fs.existsSync(box.journal), 'xoá nhật ký sau khi hoàn tác');
      sameTree(fromBefore, tree(box.from), 'nguồn không đổi');
      assertNoLoss(srcBefore, box.from, box.to);
    } finally { rmAll(box.d, box.parent, box.away); }
  });

  test('B218 QA cùng ổ commit:2', { timeout: 30000 }, () => crashRepro('same commit:2', { copy: false, point: 'commit:2', resumed: true }));
  test('B218 QA cùng ổ after:3', { timeout: 30000 }, () => crashRepro('same after:3', { copy: false, point: 'after:3', resumed: false }));
  test('B218 QA ép chép commit:2', { timeout: 30000 }, () => crashRepro('copy commit:2', { copy: true, point: 'commit:2', resumed: true }));
  test('B218 QA khác ổ commit:2', { timeout: 30000, skip: !SHM && 'không có /dev/shm khác ổ' }, () => crashRepro('cross commit:2', { copy: false, cross: true, point: 'commit:2', resumed: true }));
}
