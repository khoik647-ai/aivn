'use strict';
// B198: ma trận sập + tệp đã có sẵn ở đích. Không được mất tệp, không ghi đè, không xoá nhầm.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { spawnSync } = require('child_process');
const MD = require('../src/models-dir');
const root = path.join(__dirname, '..');

function sha256(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  try {
    const buf = Buffer.alloc(1 << 16); let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function tree(dir) {
  const m = new Map();
  if (!fs.existsSync(dir)) return m;
  for (const f of MD.listFiles(dir)) m.set(f.rel, sha256(path.join(dir, f.rel)));
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
function audit(srcBefore, dstBefore, from, to, { allowBoth = new Set(), allowReplaced = new Set(), allowKeep = new Set() } = {}) {
  const afterS = tree(from), afterD = tree(to);
  const lost = [], both = [], split = [], preLost = [], junk = [];
  for (const [rel, hash] of srcBefore) {
    const inS = afterS.get(rel) === hash, inD = afterD.get(rel) === hash;
    // allowKeep: cùng tên ở cả hai nơi vì từ chối xung đột — mỗi bên vẫn là tệp nguyên, không phải một tệp bị xé.
    const kept = allowKeep.has(rel) && inS && afterD.get(rel) === dstBefore.get(rel);
    if (!inS && !inD) lost.push(rel);
    if (afterS.has(rel) && afterD.has(rel)) {
      if (!kept && (afterS.get(rel) !== hash || afterD.get(rel) !== hash)) split.push(rel);
      if (!allowBoth.has(rel) && !kept) both.push(rel);
    }
  }
  for (const [rel, hash] of dstBefore) {
    const now = afterD.get(rel);
    if (allowReplaced.has(rel)) {
      const srcHash = srcBefore.get(rel);
      if (now === hash || (srcHash && now === srcHash)) continue;
      preLost.push(rel); continue;
    }
    if (now !== hash) preLost.push(rel);
  }
  for (const rel of new Set([...afterS.keys(), ...afterD.keys()])) {
    if (String(rel).includes('.aivn-moving') && !srcBefore.has(rel) && !dstBefore.has(rel)) junk.push(rel);
  }
  return { lost, both, split, preLost, junk, afterS, afterD };
}
function expectSafe(srcBefore, dstBefore, from, to, opts) {
  const r = audit(srcBefore, dstBefore, from, to, opts);
  assert.deepStrictEqual(r.lost, [], 'lost ' + JSON.stringify(r));
  assert.deepStrictEqual(r.preLost, [], 'preExistingDstFilesLost ' + JSON.stringify([...dstBefore.keys()]));
  assert.deepStrictEqual(r.both, [], 'both ' + JSON.stringify(r.both));
  assert.deepStrictEqual(r.split, [], 'split ' + JSON.stringify(r.split));
  assert.deepStrictEqual(r.junk, [], 'aivn-moving ' + JSON.stringify(r.junk));
  return r;
}
function rmAll(...ps) { for (const p of ps) { try { if (p) fs.rmSync(p, { recursive: true, force: true }); } catch {} } }

async function childMain() {
  const cfg = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--child') + 1], 'utf8'));
  try {
    if (cfg.quitFifo) {
      await MD.moveModels(cfg.from, cfg.to, {
        copy: true, stallMs: cfg.stallMs || 250, journal: cfg.journal,
        copyFile: () => new Promise((resolve, reject) => { fs.open(cfg.fifo, 'w', (err) => { if (err) reject(err); else resolve(); }); }),
      });
      process.exit(2);
    }
    await MD.moveModels(cfg.from, cfg.to, { copy: !!cfg.copy, killAt: cfg.killAt || null, journal: cfg.journal, stallMs: cfg.stallMs == null ? 0 : cfg.stallMs });
    process.exit(cfg.killAt ? 2 : 0);
  } catch (e) {
    if (cfg.expectCode && e.code === cfg.expectCode) process.exit(0);
    if (cfg.quitFifo) {
      if (e.code !== 'ESTALL') { console.error(e); process.exit(1); }
      const armed = MD.beforeQuitMove({ exit: (c) => process.exit(c || 0), graceMs: 150 });
      if (!armed) process.exit(3);
      return;
    }
    console.error(e && e.stack || e);
    process.exit(1);
  }
}

if (process.argv.includes('--child')) {
  childMain().catch((e) => { console.error(e); process.exit(1); });
} else {
  const POINTS = [];
  for (let i = 1; i <= 5; i++) POINTS.push('after:' + i);
  for (let i = 0; i <= 4; i++) POINTS.push('commit:' + i);
  POINTS.push('mid:1', 'mid:3', 'mid:5', 'midstream');
  const MODES = [
    { name: 'cùng ổ đổi tên', copy: false, cross: false },
    { name: 'ép chép', copy: true, cross: false },
    { name: 'khác ổ /dev/shm', copy: false, cross: true },
  ];

  function crashCase(mode, point) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-mx-'));
    let crossParent = null;
    const from = path.join(d, 'from');
    const to = mode.cross ? path.join(crossParent = fs.mkdtempSync(path.join(SHM, 'aivn-mx-')), 'to') : path.join(d, 'to');
    fs.mkdirSync(from, { recursive: true }); fs.mkdirSync(to, { recursive: true });
    const srcBefore = seed(from);
    const journal = path.join(d, 'move.json');
    const cfg = path.join(d, 'cfg.json');
    fs.writeFileSync(cfg, JSON.stringify({ from, to, journal, copy: mode.copy, killAt: point, stallMs: 0 }));
    const r = spawnSync(process.execPath, [__filename, '--child', cfg], { encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(r.signal, 'SIGKILL', `${mode.name} ${point}: signal=${r.signal} status=${r.status} stderr=${(r.stderr || '').slice(-500)}`);
    assert.ok(fs.existsSync(journal), 'nhật ký còn sau SIGKILL');
    const j = JSON.parse(fs.readFileSync(journal, 'utf8'));
    assert.ok(Array.isArray(j.created), 'nhật ký ghi danh sách tệp đã tạo');
    if (point.startsWith('commit:')) { assert.strictEqual(j.phase, 'commit'); assert.strictEqual(j.created.length, 5); }
    if (point.startsWith('after:') && !mode.cross && !mode.copy) assert.ok(j.created.every((c) => c.kind === 'rename'));
    if (point.startsWith('after:') && (mode.copy || mode.cross)) assert.ok(j.created.length >= 1 && j.created.every((c) => c.kind === 'copy'));
    const rec = MD.recoverMove(journal);
    assert.ok(rec && (rec.rolledBack || rec.resumed), 'recoverMove');
    const done = point === 'after:5' || point.startsWith('commit:');
    assert.strictEqual(!!rec.resumed, done, point + ' resumed=' + !!rec.resumed);
    expectSafe(srcBefore, new Map(), from, to);
    if (done) { assert.strictEqual(tree(from).size, 0); assert.strictEqual(tree(to).size, 5); }
    else { assert.strictEqual(tree(from).size, 5); assert.strictEqual(tree(to).size, 0); }
    rmAll(d, crossParent);
  }

  for (const mode of MODES) {
    for (const point of POINTS) {
      test(`B198 sập ${mode.name} ${point}: không mất, không nằm hai nơi, không tệp tạm`, { timeout: 30000, skip: mode.cross && !SHM && 'không có /dev/shm khác ổ' }, () => {
        crashCase(mode, point);
      });
    }
  }

  function fresh() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-pre-'));
    const from = path.join(d, 'from'), to = path.join(d, 'to');
    fs.mkdirSync(from, { recursive: true }); fs.mkdirSync(to, { recursive: true });
    return { d, from, to, journal: path.join(d, 'move.json') };
  }

  for (const copy of [false, true]) {
    test(`B198 đích cùng kích thước khác nội dung (copy=${copy}): từ chối, không đụng tệp`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        const buf = fs.readFileSync(path.join(from, RELS[1]));
        const other = Buffer.from(buf); other[0] ^= 0xff;
        put(to, RELS[1], other);
        const dstBefore = tree(to);
        const settings = path.join(d, 'settings.json'); fs.writeFileSync(settings, '{"modelsDir":"OLD"}');
        await assert.rejects(MD.moveModels(from, to, { copy, journal, stallMs: 0 }), (e) => e.code === 'ECONFLICT' && e.conflicts.includes(RELS[1]) && e.message.includes(RELS[1]));
        expectSafe(srcBefore, dstBefore, from, to, { allowKeep: new Set([RELS[1]]) });
        assert.strictEqual(tree(from).size, 5, 'mọi tệp còn ở thư mục cũ');
        assert.ok(!fs.existsSync(journal));
        assert.strictEqual(fs.readFileSync(settings, 'utf8'), '{"modelsDir":"OLD"}');
        assert.strictEqual(sha256(path.join(to, RELS[1])), dstBefore.get(RELS[1]));
      } finally { rmAll(d); }
    });

    test(`B198 đích nhỏ hơn nhưng không phải tiền tố (copy=${copy}): từ chối`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        put(to, RELS[0], Buffer.alloc(100, 9));
        const dstBefore = tree(to);
        await assert.rejects(MD.moveModels(from, to, { copy, journal, stallMs: 0 }), (e) => e.code === 'ECONFLICT' && e.conflicts.includes(RELS[0]));
        expectSafe(srcBefore, dstBefore, from, to, { allowKeep: new Set([RELS[0]]) });
        assert.ok(!fs.existsSync(journal));
      } finally { rmAll(d); }
    });

    test(`B198 đích 0 byte (copy=${copy}): không coi là bản dở`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        put(to, RELS[2], Buffer.alloc(0));
        const dstBefore = tree(to);
        await assert.rejects(MD.moveModels(from, to, { copy, journal, stallMs: 0 }), (e) => e.code === 'ECONFLICT' && e.conflicts.includes(RELS[2]));
        expectSafe(srcBefore, dstBefore, from, to, { allowKeep: new Set([RELS[2]]) });
      } finally { rmAll(d); }
    });

    test(`B198 đích khác kích thước (copy=${copy}): không ghi đè`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        put(to, RELS[3], modelBuf(99, 1200));
        const dstBefore = tree(to);
        await assert.rejects(MD.moveModels(from, to, { copy, journal, stallMs: 0 }), (e) => e.code === 'ECONFLICT' && e.conflicts.includes(RELS[3]) && /thư mục cũ/.test(e.message));
        expectSafe(srcBefore, dstBefore, from, to, { allowKeep: new Set([RELS[3]]) });
        assert.strictEqual(tree(from).get(RELS[0]), srcBefore.get(RELS[0]));
        assert.ok(!tree(to).has(RELS[0]), 'chưa chuyển tệp không xung đột');
      } finally { rmAll(d); }
    });

    test(`B198 một tệp trùng tên chặn cả lượt (copy=${copy})`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        put(to, RELS[1], modelBuf(50, 100));
        put(to, RELS[4], Buffer.from(modelBuf(5, 4096 + 4 * 257))); // sẽ bị ghi đè byte bên dưới
        const bad = fs.readFileSync(path.join(to, RELS[4])); bad[10] ^= 0x5a; fs.writeFileSync(path.join(to, RELS[4]), bad);
        const dstBefore = tree(to);
        await assert.rejects(MD.moveModels(from, to, { copy, journal, stallMs: 0 }), (e) => e.code === 'ECONFLICT' && e.conflicts.includes(RELS[1]) && e.conflicts.includes(RELS[4]));
        expectSafe(srcBefore, dstBefore, from, to, { allowKeep: new Set([RELS[1], RELS[4]]) });
        assert.deepStrictEqual(tree(to), dstBefore);
      } finally { rmAll(d); }
    });

    test(`B198 đích là tiền tố nhỏ hơn của cùng tệp (copy=${copy}): từ chối, không ghi đè`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        const full = fs.readFileSync(path.join(from, RELS[0]));
        put(to, RELS[0], full.subarray(0, 500));
        const dstBefore = tree(to);
        await assert.rejects(MD.moveModels(from, to, { copy, journal, stallMs: 0 }), (e) => e.code === 'ECONFLICT' && e.conflicts.includes(RELS[0]));
        expectSafe(srcBefore, dstBefore, from, to, { allowKeep: new Set([RELS[0]]) });
        assert.strictEqual(tree(from).size, 5, 'mọi tệp còn ở thư mục cũ');
        assert.strictEqual(tree(to).get(RELS[0]), dstBefore.get(RELS[0]));
        assert.ok(!fs.existsSync(journal));
      } finally { rmAll(d); }
    });

    test(`B198 tệp giống hệt (cùng sha256) thì bỏ nguồn (copy=${copy})`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        put(to, RELS[2], fs.readFileSync(path.join(from, RELS[2])));
        const dstBefore = tree(to);
        const r = await MD.moveModels(from, to, { copy, journal, stallMs: 0 });
        assert.ok(r.skipped >= 1);
        expectSafe(srcBefore, dstBefore, from, to);
        assert.strictEqual(tree(from).size, 0);
        assert.strictEqual(tree(to).get(RELS[2]), dstBefore.get(RELS[2]));
        const j = JSON.parse(fs.readFileSync(journal, 'utf8'));
        assert.ok(!j.created.some((c) => c.rel === RELS[2]), 'không ghi tệp đã có sẵn vào created');
        assert.strictEqual(j.phase, 'commit');
      } finally { rmAll(d); }
    });

    test(`B198 tệp lạ ở đích được giữ (copy=${copy})`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        put(to, 'notes.txt', Buffer.from('giữ nguyên nội dung'));
        put(to, 'extra/readme.md', Buffer.from('unrelated'));
        const dstBefore = tree(to);
        await MD.moveModels(from, to, { copy, journal, stallMs: 0 });
        expectSafe(srcBefore, dstBefore, from, to);
        assert.strictEqual(tree(to).get('notes.txt'), dstBefore.get('notes.txt'));
        assert.strictEqual(tree(to).get('extra/readme.md'), dstBefore.get('extra/readme.md'));
      } finally { rmAll(d); }
    });

    test(`B198 tệp tạm .aivn-moving cũ được giữ nguyên byte và lần chuyển vẫn xong (copy=${copy})`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        put(to, RELS[0] + '.aivn-moving', Buffer.alloc(1000, 4));
        put(to, 'keep.gguf.aivn-moving', Buffer.from('leave-unrelated-temp'));
        const dstBefore = tree(to);
        const r = await MD.moveModels(from, to, { copy, journal, stallMs: 0 });
        assert.strictEqual(r.moved, 5);
        const after = tree(to);
        assert.strictEqual(after.get(RELS[0] + '.aivn-moving'), dstBefore.get(RELS[0] + '.aivn-moving'));
        assert.strictEqual(after.get('keep.gguf.aivn-moving'), dstBefore.get('keep.gguf.aivn-moving'));
        assert.strictEqual(after.get(RELS[0]), srcBefore.get(RELS[0]));
        assert.strictEqual(tree(from).size, 0);
        expectSafe(srcBefore, dstBefore, from, to);
        const j = JSON.parse(fs.readFileSync(journal, 'utf8'));
        assert.ok(Array.isArray(j.temps));
        assert.ok(!j.temps.some((t) => String(t).endsWith('.aivn-moving') && !String(t).includes('.aivn-moving-')));
      } finally { rmAll(d); }
    });

    test(`B198 thư mục trùng tên không bị xoá (copy=${copy})`, async () => {
      const { d, from, to, journal } = fresh();
      try {
        const srcBefore = seed(from);
        fs.mkdirSync(path.join(to, RELS[0]), { recursive: true });
        fs.writeFileSync(path.join(to, RELS[0], 'inside.txt'), 'x');
        await assert.rejects(MD.moveModels(from, to, { copy, journal, stallMs: 0 }), (e) => e.code === 'ECONFLICT');
        assert.strictEqual(fs.readFileSync(path.join(to, RELS[0], 'inside.txt'), 'utf8'), 'x');
        assert.strictEqual(tree(from).get(RELS[0]), srcBefore.get(RELS[0]));
      } finally { rmAll(d); }
    });

    for (const point of ['after:2', 'mid:2']) {
      test(`B198 đã có bản giống hệt + SIGKILL ${point} (copy=${copy})`, { timeout: 30000 }, () => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-id-'));
        try {
          const from = path.join(d, 'from'), to = path.join(d, 'to');
          fs.mkdirSync(from, { recursive: true }); fs.mkdirSync(to, { recursive: true });
          const srcBefore = seed(from);
          put(to, RELS[4], fs.readFileSync(path.join(from, RELS[4])));
          const dstBefore = tree(to);
          const journal = path.join(d, 'move.json');
          const cfg = path.join(d, 'cfg.json');
          fs.writeFileSync(cfg, JSON.stringify({ from, to, journal, copy, killAt: point, stallMs: 0 }));
          const r = spawnSync(process.execPath, [__filename, '--child', cfg], { encoding: 'utf8', timeout: 20000 });
          assert.strictEqual(r.signal, 'SIGKILL', (r.stderr || '').slice(-400));
          const rec = MD.recoverMove(journal);
          assert.ok(rec && rec.rolledBack, point);
          expectSafe(srcBefore, dstBefore, from, to, { allowBoth: new Set([RELS[4]]) });
          assert.strictEqual(tree(to).get(RELS[4]), dstBefore.get(RELS[4]));
        } finally { rmAll(d); }
      });
    }

    for (const point of ['after:2', 'mid:2']) {
      test(`B198 mô hình khác cùng tên + ${point} (copy=${copy}): từ chối trước khi chuyển`, { timeout: 30000 }, () => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-cf-'));
        try {
          const from = path.join(d, 'from'), to = path.join(d, 'to');
          fs.mkdirSync(from, { recursive: true }); fs.mkdirSync(to, { recursive: true });
          const srcBefore = seed(from);
          put(to, RELS[1], modelBuf(77, 2222));
          const dstBefore = tree(to);
          const journal = path.join(d, 'move.json');
          const cfg = path.join(d, 'cfg.json');
          fs.writeFileSync(cfg, JSON.stringify({ from, to, journal, copy, killAt: point, stallMs: 0, expectCode: 'ECONFLICT' }));
          const r = spawnSync(process.execPath, [__filename, '--child', cfg], { encoding: 'utf8', timeout: 20000 });
          assert.strictEqual(r.status, 0, `phải thoát vì ECONFLICT, không SIGKILL; signal=${r.signal} stderr=${(r.stderr || '').slice(-400)}`);
          assert.notStrictEqual(r.signal, 'SIGKILL');
          assert.ok(!fs.existsSync(journal), 'chưa ghi nhật ký');
          expectSafe(srcBefore, dstBefore, from, to, { allowKeep: new Set([RELS[1]]) });
          assert.strictEqual(tree(from).size, 5);
        } finally { rmAll(d); }
      });
    }

    for (const code of ['ENOSPC', 'EIO']) {
      test(`B198 ${code} ở tệp thứ 3 hoàn tác hết (copy=${copy})`, async () => {
        const { d, from, to } = fresh();
        try {
          const srcBefore = seed(from);
          const seen = [];
          await assert.rejects(MD.moveModels(from, to, {
            copy, stallMs: 0,
            afterEach: ({ index, rel }) => { seen.push(rel); if (index === 3) { const e = new Error(code); e.code = code; throw e; } },
          }), (e) => e.code === code);
          assert.deepStrictEqual(seen, RELS.slice(0, 3));
          expectSafe(srcBefore, new Map(), from, to);
          assert.strictEqual(tree(from).size, 5);
          assert.strictEqual(tree(to).size, 0);
        } finally { rmAll(d); }
      });
    }

    test(`B198 huỷ giữa chừng giữ nguyên hash (copy=${copy})`, async () => {
      const { d, from, to } = fresh();
      try {
        const srcBefore = seed(from);
        const ac = new AbortController();
        await assert.rejects(MD.moveModels(from, to, { copy, stallMs: 0, signal: ac.signal, onProgress: () => ac.abort() }), (e) => e.code === 'ABORT');
        expectSafe(srcBefore, new Map(), from, to);
        assert.strictEqual(tree(from).size, 5);
        assert.strictEqual(tree(to).size, 0);
      } finally { rmAll(d); }
    });
  }

  test('B198 treo khi chép: hoàn tác, tệp cũ còn đủ hash', async () => {
    const { d, from, to } = fresh();
    try {
      const srcBefore = seed(from);
      const t0 = Date.now();
      await assert.rejects(MD.moveModels(from, to, { copy: true, stallMs: 200, copyFile: () => new Promise(() => {}) }), (e) => e.code === 'ESTALL' && e.message === MD.STALL_MSG);
      assert.ok(Date.now() - t0 < 5000);
      expectSafe(srcBefore, new Map(), from, to);
      assert.strictEqual(tree(to).size, 0);
    } finally { rmAll(d); }
  });

  test('B198 đích là FIFO: từ chối ngay, không kẹt open', async () => {
    const { d, from, to, journal } = fresh();
    try {
      const srcBefore = seed(from);
      const fifo = path.join(to, RELS[0]);
      fs.mkdirSync(path.dirname(fifo), { recursive: true });
      const mk = spawnSync('mkfifo', [fifo]);
      assert.strictEqual(mk.status, 0, mk.stderr && mk.stderr.toString());
      const t0 = Date.now();
      await assert.rejects(MD.moveModels(from, to, { copy: true, stallMs: 5000, journal }), (e) => e.code === 'ECONFLICT');
      assert.ok(Date.now() - t0 < 1500, 'không chờ watchdog');
      assert.ok(fs.existsSync(fifo));
      assert.strictEqual(tree(from).get(RELS[0]), srcBefore.get(RELS[0]));
      assert.strictEqual(tree(from).size, 5);
    } finally { rmAll(d); }
  });

  test('B198 watchdog cắt lúc open FIFO bị chặn thì tiến trình vẫn thoát được', { timeout: 20000 }, () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-fifo-'));
    try {
      const from = path.join(d, 'from'), to = path.join(d, 'to'), fifo = path.join(d, 'block.fifo');
      fs.mkdirSync(from, { recursive: true }); fs.mkdirSync(to, { recursive: true });
      const srcBefore = seed(from);
      assert.strictEqual(spawnSync('mkfifo', [fifo]).status, 0);
      const cfg = path.join(d, 'cfg.json');
      fs.writeFileSync(cfg, JSON.stringify({ quitFifo: true, from, to, fifo, journal: path.join(d, 'move.json'), stallMs: 250 }));
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [__filename, '--child', cfg], { encoding: 'utf8', timeout: 8000 });
      assert.ok(Date.now() - t0 < 7000, 'thoát sau grace, không kẹt luồng libuv');
      // process.exit() treo khi open() chiếm threadpool; SIGKILL từ tiến trình rời là lối thoát còn lại.
      assert.ok(r.status === 0 || r.signal === 'SIGKILL', `signal=${r.signal} status=${r.status} stderr=${(r.stderr || '').slice(-500)}`);
      expectSafe(srcBefore, new Map(), from, to);
    } finally { rmAll(d); }
  });

  test('B198 recover không xoá tệp đích khác nội dung dù cùng kích thước', () => {
    const { d, from, to, journal } = fresh();
    try {
      const srcBefore = seed(from);
      const same = fs.readFileSync(path.join(from, RELS[1]));
      const diff = Buffer.from(same); diff[3] ^= 0xff;
      put(to, RELS[1], diff);
      put(to, 'notes.txt', Buffer.from('giữ'));
      put(to, RELS[0], fs.readFileSync(path.join(from, RELS[0])));
      const dstBefore = new Map([[RELS[1], sha256(path.join(to, RELS[1]))], ['notes.txt', sha256(path.join(to, 'notes.txt'))]]);
      const rels = RELS.map((rel) => ({ rel, size: fs.statSync(path.join(from, rel)).size, sha256: srcBefore.get(rel) }));
      const created = [{ rel: RELS[0], size: rels[0].size, sha256: rels[0].sha256, kind: 'copy' }];
      fs.writeFileSync(journal, JSON.stringify({ from: path.resolve(from), to: path.resolve(to), rels, created, phase: 'moving' }));
      const rec = MD.recoverMove(journal);
      assert.strictEqual(rec.rolledBack, true);
      expectSafe(srcBefore, dstBefore, from, to, { allowKeep: new Set([RELS[1]]) });
      assert.strictEqual(sha256(path.join(to, RELS[1])), dstBefore.get(RELS[1]));
      assert.ok(!fs.existsSync(path.join(to, RELS[0])), 'chỉ xoá bản do lần chuyển này ghi');
      assert.strictEqual(fs.readFileSync(path.join(to, 'notes.txt'), 'utf8'), 'giữ');
    } finally { rmAll(d); }
  });

  test('B198 pha commit không xoá nguồn nếu đích không khớp sha256', () => {
    const { d, from, to, journal } = fresh();
    try {
      const srcBefore = seed(from);
      const diff = Buffer.from(fs.readFileSync(path.join(from, RELS[2]))); diff[1] ^= 0xaa;
      put(to, RELS[2], diff);
      for (const rel of RELS) if (rel !== RELS[2]) put(to, rel, fs.readFileSync(path.join(from, rel)));
      const dstBefore = new Map([[RELS[2], sha256(path.join(to, RELS[2]))]]);
      const rels = RELS.map((rel) => ({ rel, size: fs.statSync(path.join(from, rel)).size, sha256: srcBefore.get(rel) }));
      const created = rels.filter((r) => r.rel !== RELS[2]).map((r) => ({ ...r, kind: 'copy' }));
      fs.writeFileSync(journal, JSON.stringify({ from: path.resolve(from), to: path.resolve(to), rels, created, phase: 'commit' }));
      const rec = MD.recoverMove(journal);
      assert.strictEqual(rec.rolledBack, true, 'không resume khi một đích lệch hash');
      assert.strictEqual(tree(from).get(RELS[2]), srcBefore.get(RELS[2]), 'không xoá nguồn chưa xác minh');
      assert.strictEqual(sha256(path.join(to, RELS[2])), dstBefore.get(RELS[2]));
      expectSafe(srcBefore, dstBefore, from, to, { allowKeep: new Set([RELS[2]]) });
    } finally { rmAll(d); }
  });

  test('B198 recover tiếp tục chỉ khi mọi đích khớp sha256', () => {
    const { d, from, to, journal } = fresh();
    try {
      const srcBefore = seed(from);
      for (const rel of RELS) put(to, rel, fs.readFileSync(path.join(from, rel)));
      const rels = RELS.map((rel) => ({ rel, size: fs.statSync(path.join(from, rel)).size, sha256: srcBefore.get(rel) }));
      const created = rels.map((r) => ({ ...r, kind: 'copy' }));
      fs.writeFileSync(journal, JSON.stringify({ from: path.resolve(from), to: path.resolve(to), rels, created, phase: 'commit' }));
      const rec = MD.recoverMove(journal);
      assert.strictEqual(rec.resumed, true);
      expectSafe(srcBefore, new Map(), from, to);
      assert.strictEqual(tree(from).size, 0);
      assert.strictEqual(tree(to).size, 5);
    } finally { rmAll(d); }
  });

  test('B198 phase quit luôn hoàn tác dù đích đã khớp', () => {
    const { d, from, to, journal } = fresh();
    try {
      const srcBefore = seed(from);
      for (const rel of RELS) put(to, rel, fs.readFileSync(path.join(from, rel)));
      const rels = RELS.map((rel) => ({ rel, size: fs.statSync(path.join(from, rel)).size, sha256: srcBefore.get(rel) }));
      const created = rels.map((r) => ({ ...r, kind: 'copy' }));
      fs.writeFileSync(journal, JSON.stringify({ from: path.resolve(from), to: path.resolve(to), rels, created, phase: 'quit' }));
      const rec = MD.recoverMove(journal);
      assert.strictEqual(rec.rolledBack, true);
      expectSafe(srcBefore, new Map(), from, to);
      assert.strictEqual(tree(to).size, 0);
      assert.strictEqual(tree(from).size, 5);
    } finally { rmAll(d); }
  });

  test('B198 before-quit của ứng dụng gọi beforeQuitMove', () => {
    const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
    assert.match(m, /before-quit/);
    assert.match(m, /beforeQuitMove/);
    assert.match(m, /app\.exit/);
    const i = m.indexOf("if (mode === 'move')");
    const slice = m.slice(i, i + 1800);
    assert.ok(slice.indexOf('await MD.moveModels') >= 0 && slice.indexOf('settings.save()') > slice.indexOf('await MD.moveModels'));
  });
}
