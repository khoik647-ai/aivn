'use strict';
// S3: commit bị cắt, thư mục đích trống hoặc ổ đích không còn, thì không hoàn tác và không xoá nhật ký.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const MD = require('../src/models-dir');
const CORE = require('../src/i18n/core');
const tr = CORE.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });

const RELS = ['m/f1.gguf', 'm/f2.gguf', 'm/f3.gguf', 'm/f4.gguf', 'm/f5.gguf'];
function sha256(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  try { const buf = Buffer.alloc(1 << 16); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function modelBuf(i) { const buf = Buffer.alloc(300 + i * 17); for (let j = 0; j < buf.length; j++) buf[j] = (i * 19 + j) & 255; return buf; }
function put(dir, rel, buf) { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return p; }
function rmAll(...ps) { for (const p of ps) { try { if (p) fs.rmSync(p, { recursive: true, force: true }); } catch {} } }
function fresh() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-s3-'));
  const from = path.join(d, 'from'), parent = path.join(d, 'vol'), to = path.join(parent, 'models');
  fs.mkdirSync(from, { recursive: true }); fs.mkdirSync(to, { recursive: true });
  return { d, parent, from, to, journal: path.join(d, 'move.json'), parked: null };
}
function seed(from) {
  const hashes = new Map();
  RELS.forEach((rel, i) => { put(from, rel, modelBuf(i + 1)); hashes.set(rel, sha256(path.join(from, rel))); });
  return hashes;
}
function snap(dir) {
  const m = new Map();
  if (!dir || !fs.existsSync(dir)) return m;
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = rel ? path.join(rel, e.name) : e.name;
      if (e.isSymbolicLink()) m.set(r, 'link:' + fs.readlinkSync(p));
      else if (e.isDirectory()) walk(p, r);
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
function meta(box, hashes) {
  return RELS.map((rel) => {
    const at = fs.existsSync(path.join(box.to, rel)) ? path.join(box.to, rel) : path.join(box.from, rel);
    return { rel, size: fs.statSync(at).size, sha256: hashes.get(rel) };
  });
}
// Commit dở: mọi tệp đã tới đích, f1/f2 đã rời nguồn (đúng chỗ models-dir.js xoá nguồn trong phase commit).
function handCommit(box, { destVol } = {}) {
  const hashes = seed(box.from);
  for (const rel of RELS) put(box.to, rel, fs.readFileSync(path.join(box.from, rel)));
  fs.unlinkSync(path.join(box.from, RELS[0]));
  fs.unlinkSync(path.join(box.from, RELS[1]));
  const rels = meta(box, hashes);
  const body = { from: path.resolve(box.from), to: path.resolve(box.to), rels, created: rels.map((r) => ({ ...r, kind: 'copy' })), temps: [], moveId: 's3', phase: 'commit' };
  if (destVol !== undefined) body.destVol = destVol;
  fs.writeFileSync(box.journal, JSON.stringify(body));
  return hashes;
}
function parkDest(box) {
  const parked = path.join(box.d, 'real-dest');
  fs.renameSync(box.to, parked);
  fs.mkdirSync(box.to, { recursive: true });
  box.parked = parked;
  return parked;
}
function restoreDest(box) {
  fs.rmSync(box.to, { recursive: true, force: true });
  fs.renameSync(box.parked, box.to);
  box.parked = null;
}
const MUT = ['unlinkSync', 'rmSync', 'renameSync', 'rmdirSync', 'copyFileSync', 'writeFileSync', 'linkSync'];
function countMutations(fn) {
  const orig = {}; const hits = [];
  for (const name of MUT) { orig[name] = fs[name]; fs[name] = function (...a) { hits.push(name + ':' + a[0]); return orig[name].apply(this, a); }; }
  const pu = fs.promises.unlink, pr = fs.promises.rm, pre = fs.promises.rename;
  fs.promises.unlink = async (...a) => { hits.push('unlink:' + a[0]); return pu(...a); };
  fs.promises.rm = async (...a) => { hits.push('rm:' + a[0]); return pr(...a); };
  fs.promises.rename = async (...a) => { hits.push('rename:' + a[0]); return pre(...a); };
  return Promise.resolve().then(fn).finally(() => {
    for (const name of MUT) fs[name] = orig[name];
    fs.promises.unlink = pu; fs.promises.rm = pr; fs.promises.rename = pre;
  }).then(() => hits);
}
function assertHold(rec, to, kind) {
  assert.ok(rec && rec.pending, 'pending');
  assert.strictEqual(rec.state, 'pending');
  assert.strictEqual(rec.code, 'EDEST');
  assert.strictEqual(rec.dir, path.resolve(to.from), 'cài đặt giữ thư mục cũ');
  assert.strictEqual(rec.to, path.resolve(to.to));
  assert.ok(rec.log.includes(path.resolve(to.to)), 'nhật ký ghi đường dẫn đích');
  assert.ok(!rec.notice.includes(path.resolve(to.to)), 'thông báo không kèm đường dẫn riêng');
  assert.doesNotMatch(rec.log, /Đã hoàn tác/);
  assert.doesNotMatch(rec.notice, /Đã hoàn tác/);
  const en = tr.tr(rec.log, 'en'), zh = tr.tr(rec.log, 'zh');
  const enN = tr.tr(rec.notice, 'en'), zhN = tr.tr(rec.notice, 'zh');
  assert.notStrictEqual(en, rec.log, 'có bản tiếng Anh');
  assert.notStrictEqual(zh, rec.log, 'có bản tiếng Trung');
  if (kind === 'volume') {
    assert.strictEqual(rec.reason, 'destination volume mismatch');
    assert.match(rec.log, /không nằm trên ổ đã ghi trong nhật ký/);
    assert.match(rec.notice, /không phải ổ đã ghi trong nhật ký/);
    assert.match(en, /not on the drive recorded in the log/);
    assert.match(en, /not rolled back/);
    assert.match(zh, /不在日志记录的磁盘上/);
    assert.match(zh, /不会回滚/);
    assert.match(enN, /not the drive recorded in the log/);
    assert.match(zhN, /不是日志记录的磁盘/);
  } else {
    assert.strictEqual(rec.reason, 'files missing both');
    assert.match(rec.log, /không còn ở thư mục cũ/);
    assert.match(rec.log, /không hoàn tác/);
    assert.match(rec.notice, /không thấy ở cả hai thư mục/);
    assert.match(en, /missing from the current destination folder/);
    assert.match(en, /not rolled back/);
    assert.match(zh, /当前目标文件夹里也没有/);
    assert.match(zh, /不会回滚/);
    assert.match(enN, /missing from both folders/);
    assert.match(zhN, /两个文件夹里都没有/);
  }
  const block = MD.applyMoveBlock({ journalExists: true, rec, modelInUse: false });
  assert.strictEqual(block.code, 'EDEST');
  assert.strictEqual(block.error, rec.notice);
}

test('S3 commit dở, đích trống: giữ nhật ký và mọi tệp, không hoàn tác; gắn lại nội dung thì tiếp tục', async () => {
  const box = fresh();
  try {
    const hashes = handCommit(box, { destVol: MD.volumeIdentity(box.to) });
    const fromBefore = snap(box.from);
    const parked = parkDest(box);
    const parkedBefore = snap(parked);
    put(box.to, 'notes.txt', Buffer.from('giữ-người-dùng'));
    const raw = fs.readFileSync(box.journal);
    let rec;
    const hits = await countMutations(async () => {
      rec = await MD.recoverMove(box.journal);
      assertHold(rec, box, 'missing');
      const again = await MD.recoverMove(box.journal);
      assertHold(again, box, 'missing');
    });
    assert.deepStrictEqual(hits, [], 'không xoá hay dời: ' + hits.join(','));
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw, 'giữ nguyên nhật ký');
    sameSnap(fromBefore, snap(box.from), 'nguồn');
    sameSnap(parkedBefore, snap(parked), 'bản trên ổ thật');
    assert.strictEqual(fs.readFileSync(path.join(box.to, 'notes.txt'), 'utf8'), 'giữ-người-dùng');
    for (const rel of RELS.slice(0, 2)) assert.ok(!fs.existsSync(path.join(box.from, rel)) && !fs.existsSync(path.join(box.to, rel)), rel);
    restoreDest(box);
    const done = await MD.recoverMove(box.journal);
    assert.strictEqual(done.resumed, true);
    assert.ok(!done.pending);
    assert.ok(!fs.existsSync(box.journal));
    assert.strictEqual(snap(box.from).size, 0);
    for (const rel of RELS) assert.strictEqual(sha256(path.join(box.to, rel)), hashes.get(rel), rel);
  } finally { rmAll(box.d, box.parked); }
});

test('S3 commit dở, ổ đích mất (đường dẫn không còn): giữ nhật ký và tệp; ổ có lại thì tiếp tục', async () => {
  const box = fresh();
  try {
    const hashes = handCommit(box, { destVol: MD.volumeIdentity(box.to) });
    const fromBefore = snap(box.from), toBefore = snap(box.to);
    const raw = fs.readFileSync(box.journal);
    const away = box.parent + '-away';
    fs.renameSync(box.parent, away);
    let rec;
    const hits = await countMutations(async () => {
      rec = await MD.recoverMove(box.journal);
      assert.ok(rec && rec.pending);
      assert.strictEqual(rec.reason, 'destination missing');
      assert.strictEqual(rec.state, 'pending');
      assert.match(rec.log, /chờ ổ đích/);
      assert.match(tr.tr(rec.log, 'en'), /waiting for the destination drive/);
      assert.match(tr.tr(rec.log, 'zh'), /等待目标磁盘/);
      const again = await MD.recoverMove(box.journal);
      assert.strictEqual(again.state, 'pending');
    });
    assert.deepStrictEqual(hits, [], 'ổ mất không đụng tệp: ' + hits.join(','));
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    sameSnap(fromBefore, snap(box.from), 'nguồn');
    sameSnap(toBefore, snap(path.join(away, 'models')), 'ổ đã cất');
    fs.renameSync(away, box.parent);
    const done = await MD.recoverMove(box.journal);
    assert.strictEqual(done.resumed, true);
    assert.ok(!fs.existsSync(box.journal));
    for (const rel of RELS) assert.strictEqual(sha256(path.join(box.to, rel)), hashes.get(rel), rel);
    assert.strictEqual(snap(box.from).size, 0);
  } finally { rmAll(box.d, box.parent + '-away', box.parent); }
});

test('S3 điểm gắn trống khác ổ đã ghi: không coi là thư mục đã xoá, giữ nhật ký', async () => {
  const box = fresh();
  try {
    const hashes = handCommit(box);
    const real = MD.volumeIdentity(box.to);
    assert.ok(real && real.root && real.dev);
    const fromBefore = snap(box.from);
    const parked = parkDest(box);
    const parkedBefore = snap(parked);
    const j = JSON.parse(fs.readFileSync(box.journal, 'utf8'));
    j.destVol = { dev: '0', root: '/aivn-s3-not-a-mounted-volume' };
    fs.writeFileSync(box.journal, JSON.stringify(j));
    const raw = fs.readFileSync(box.journal);
    let rec;
    const hits = await countMutations(async () => {
      rec = await MD.recoverMove(box.journal);
      assertHold(rec, box, 'volume');
      assert.strictEqual(rec.fsCode, 'ENODEV');
    });
    assert.deepStrictEqual(hits, [], hits.join(','));
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    sameSnap(fromBefore, snap(box.from), 'nguồn');
    sameSnap(parkedBefore, snap(parked), 'ổ thật');
    assert.ok(!fs.existsSync(path.join(box.to, RELS[0])));
    j.destVol = real;
    fs.writeFileSync(box.journal, JSON.stringify(j));
    restoreDest(box);
    const done = await MD.recoverMove(box.journal);
    assert.strictEqual(done.resumed, true);
    assert.ok(!fs.existsSync(box.journal));
    for (const rel of RELS) assert.strictEqual(sha256(path.join(box.to, rel)), hashes.get(rel), rel);
  } finally { rmAll(box.d, box.parked); }
});

test('S3 số dev đổi nhưng cùng gốc volume: vẫn phục hồi được', async () => {
  const box = fresh();
  try {
    const hashes = handCommit(box, { destVol: MD.volumeIdentity(box.to) });
    for (const rel of RELS.slice(2)) fs.unlinkSync(path.join(box.from, rel));
    const j = JSON.parse(fs.readFileSync(box.journal, 'utf8'));
    j.destVol = { dev: '0', root: j.destVol.root };
    fs.writeFileSync(box.journal, JSON.stringify(j));
    const rec = await MD.recoverMove(box.journal);
    assert.strictEqual(rec.resumed, true);
    assert.ok(!rec.pending);
    assert.ok(!fs.existsSync(box.journal));
    for (const rel of RELS) assert.strictEqual(sha256(path.join(box.to, rel)), hashes.get(rel), rel);
  } finally { rmAll(box.d); }
});

test('S3 lần chuyển mới ghi destVol; commit xong vẫn tiếp tục như cũ', async () => {
  const box = fresh();
  try {
    seed(box.from);
    await MD.moveModels(box.from, box.to, { journal: box.journal, stallMs: 0, copy: true });
    const j = JSON.parse(fs.readFileSync(box.journal, 'utf8'));
    const vol = MD.volumeIdentity(box.to);
    assert.strictEqual(j.phase, 'commit');
    assert.deepStrictEqual(j.destVol, vol);
    assert.strictEqual(fs.statSync(j.destVol.root).dev.toString(), j.destVol.dev);
    const up = path.dirname(j.destVol.root);
    if (up !== j.destVol.root) assert.notStrictEqual(fs.statSync(up).dev.toString(), j.destVol.dev);
    const again = MD.volumeIdentity(box.to);
    assert.deepStrictEqual(again, vol, 'gốc volume ổn định');
    const rec = await MD.recoverMove(box.journal);
    assert.strictEqual(rec.resumed, true);
    assert.ok(!fs.existsSync(box.journal));
    assert.strictEqual(snap(box.from).size, 0);
    assert.strictEqual(snap(box.to).size, RELS.length);
  } finally { rmAll(box.d); }
});

test('S3 hồi phục thường: đích trống nhưng nguồn còn đủ thì hoàn tác, không kẹt chờ', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    const rels = meta(box, hashes);
    const vol = MD.volumeIdentity(box.to);
    fs.writeFileSync(box.journal, JSON.stringify({ from: path.resolve(box.from), to: path.resolve(box.to), rels, created: rels.map((r) => ({ ...r, kind: 'copy' })), temps: [], destVol: vol, phase: 'commit' }));
    const fromBefore = snap(box.from);
    const rec = await MD.recoverMove(box.journal);
    assert.strictEqual(rec.rolledBack, true);
    assert.ok(!rec.pending);
    assert.ok(!fs.existsSync(box.journal));
    sameSnap(fromBefore, snap(box.from), 'nguồn');
    assert.strictEqual(snap(box.to).size, 0);
  } finally { rmAll(box.d); }
});

test('S3 hồi phục thường: đang chuyển, đích đã có bản chép, nguồn còn đủ → hoàn tác', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    put(box.to, RELS[0], fs.readFileSync(path.join(box.from, RELS[0])));
    const rels = meta(box, hashes);
    const created = [{ ...rels[0], kind: 'copy' }];
    fs.writeFileSync(box.journal, JSON.stringify({ from: path.resolve(box.from), to: path.resolve(box.to), rels, created, temps: [], destVol: MD.volumeIdentity(box.to), phase: 'moving' }));
    const rec = await MD.recoverMove(box.journal);
    assert.strictEqual(rec.rolledBack, true);
    assert.ok(!fs.existsSync(box.journal));
    for (const rel of RELS) assert.strictEqual(sha256(path.join(box.from, rel)), hashes.get(rel), rel);
    assert.ok(!fs.existsSync(path.join(box.to, RELS[0])), 'gỡ bản chép của lần chuyển, giữ nguồn');
  } finally { rmAll(box.d); }
});

test('S3 hồi phục thường: xoá thư mục đích, nguồn còn đủ, cùng ổ đã ghi → hoàn tác (không kẹt pending)', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    const rels = meta(box, hashes);
    fs.writeFileSync(box.journal, JSON.stringify({ from: path.resolve(box.from), to: path.resolve(box.to), rels, created: rels.map((r) => ({ ...r, kind: 'copy' })), temps: [], destVol: MD.volumeIdentity(box.to), phase: 'moving' }));
    fs.rmSync(box.to, { recursive: true, force: true });
    assert.ok(fs.existsSync(box.parent));
    const rec = await MD.recoverMove(box.journal);
    assert.strictEqual(rec.rolledBack, true);
    assert.ok(!rec.pending);
    assert.ok(!fs.existsSync(box.journal));
    for (const rel of RELS) assert.strictEqual(sha256(path.join(box.from, rel)), hashes.get(rel), rel);
  } finally { rmAll(box.d); }
});

test('S3 ổ đã ghi khác gốc volume, thư mục đích không còn, nguồn còn đủ: không coi là đã xoá thư mục', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    const rels = meta(box, hashes);
    fs.writeFileSync(box.journal, JSON.stringify({
      from: path.resolve(box.from), to: path.resolve(box.to), rels,
      created: rels.map((r) => ({ ...r, kind: 'copy' })), temps: [],
      destVol: { dev: '0', root: '/aivn-s3-unmounted' }, phase: 'moving',
    }));
    const fromBefore = snap(box.from);
    fs.rmSync(box.to, { recursive: true, force: true });
    const raw = fs.readFileSync(box.journal);
    const hits = await countMutations(async () => {
      const rec = await MD.recoverMove(box.journal);
      assertHold(rec, box, 'volume');
    });
    assert.deepStrictEqual(hits, [], hits.join(','));
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    sameSnap(fromBefore, snap(box.from), 'nguồn');
  } finally { rmAll(box.d); }
});

test('S3 nhật ký cũ không có destVol: đích trống giữa commit vẫn giữ nhật ký', async () => {
  const box = fresh();
  try {
    const hashes = handCommit(box);
    const fromBefore = snap(box.from);
    const parked = parkDest(box);
    const parkedBefore = snap(parked);
    const raw = fs.readFileSync(box.journal);
    assert.strictEqual(JSON.parse(raw).destVol, undefined);
    const rec = await MD.recoverMove(box.journal);
    assertHold(rec, box, 'missing');
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    sameSnap(fromBefore, snap(box.from), 'nguồn');
    sameSnap(parkedBefore, snap(parked), 'đích thật');
    restoreDest(box);
    const done = await MD.recoverMove(box.journal);
    assert.strictEqual(done.resumed, true);
    for (const rel of RELS) assert.strictEqual(sha256(path.join(box.to, rel)), hashes.get(rel), rel);
  } finally { rmAll(box.d, box.parked); }
});

test('S3 nhật ký cũ không có created: tệp mất cả hai phía thì không hoàn tác', async () => {
  const box = fresh();
  try {
    const hashes = seed(box.from);
    fs.unlinkSync(path.join(box.from, RELS[0]));
    const rels = RELS.map((rel) => ({ rel, size: hashes.get(rel) ? modelBuf(RELS.indexOf(rel) + 1).length : 0 }));
    rels.forEach((r, i) => { r.size = modelBuf(i + 1).length; });
    fs.writeFileSync(box.journal, JSON.stringify({ from: path.resolve(box.from), to: path.resolve(box.to), rels, phase: 'commit' }));
    const fromBefore = snap(box.from);
    const raw = fs.readFileSync(box.journal);
    const hits = await countMutations(async () => {
      const rec = await MD.recoverMove(box.journal);
      assertHold(rec, box, 'missing');
    });
    assert.deepStrictEqual(hits, [], hits.join(','));
    assert.deepStrictEqual(fs.readFileSync(box.journal), raw);
    sameSnap(fromBefore, snap(box.from), 'nguồn');
    assert.strictEqual(snap(box.to).size, 0);
  } finally { rmAll(box.d); }
});
