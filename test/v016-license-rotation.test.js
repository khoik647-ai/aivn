// Xoay khoá Ed25519: khoá riêng cũ đã mất. Mã và revoked.json ký bằng khoá cũ vẫn hợp lệ;
// khoá thử được tạo lúc chạy, không nhúng khoá riêng vào repo.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/license');
const { createAdmin } = require('../src/admin');
const { createLicenseState } = require('../src/gate');

const OLD_X = 'QMWzpffqj1QHIv0WNPnZqTlSMF7eeoDc_mI55kpas_A';
const NEW_X = 'cyvZ7yP6hn1Uj--cJ-j5m4mryExZEikTuPd0SqD31Eg';
function key() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { x: publicKey.export({ format: 'jwk' }).x, pem: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-rot-'));
const NOW = Date.UTC(2026, 9, 23);

test('LEGACY_PUBLIC_KEYS đúng một khoá cũ; mã ký bằng khoá tạm coi là legacy vẫn hợp lệ', () => {
  assert.deepStrictEqual(L.LEGACY_PUBLIC_KEYS, [OLD_X]);
  assert.strictEqual(L.PUBLIC_KEY_X, NEW_X);
  assert.deepStrictEqual(L.TRUSTED_KEYS, [NEW_X, OLD_X]);
  const legacy = key();
  const mc = L.machineCodeFrom('win:may-cu');
  const { code, info } = L.issueCode(legacy.pem, { name: 'Máy cũ', machineCode: mc, days: null, now: NOW });
  const trusted = [L.PUBLIC_KEY_X, legacy.x];
  assert.strictEqual(L.parseCode(code, trusted).id, info.id);
  assert.strictEqual(L.evaluate({ code, activatedAt: NOW, lastCheckOk: NOW }, { machineCode: mc, now: NOW, publicX: trusted }).ok, true);
  assert.throws(() => L.parseCode(code), /chữ ký không hợp lệ/);
  assert.throws(() => L.parseCode(code, L.PUBLIC_KEY_X), /chữ ký không hợp lệ/);
});

test('mã ký bằng khoá trùng khoá chính thì hợp lệ', () => {
  const primary = key();
  const mc = L.machineCodeFrom('win:may-moi');
  const { code } = L.issueCode(primary.pem, { name: 'Máy mới', machineCode: mc, days: 30, now: NOW });
  assert.strictEqual(L.parseCode(code, primary.x).name, 'Máy mới');
  assert.strictEqual(L.parseCode(code, [primary.x, OLD_X]).name, 'Máy mới');
  assert.strictEqual(L.evaluate({ code, activatedAt: NOW, lastCheckOk: NOW }, { machineCode: mc, now: NOW, publicX: primary.x }).ok, true);
});

test('mã giả (chữ ký ngẫu nhiên, khoá lạ, sửa payload) bị từ chối', () => {
  const primary = key();
  const mc = L.machineCodeFrom('win:may-that');
  const { code } = L.issueCode(primary.pem, { name: 'Thật', machineCode: mc, days: null, now: NOW });
  const raw = Buffer.from(L.b32decode(code));
  const flipped = Buffer.from(raw); flipped[5] ^= 0x01;
  assert.throws(() => L.parseCode(L.b32encode(flipped), primary.x));
  const forged = Buffer.from(raw); crypto.randomBytes(64).copy(forged, forged.length - 64);
  assert.throws(() => L.parseCode(L.b32encode(forged), primary.x));
  const foreign = L.issueCode(key().pem, { name: 'Lạ', machineCode: mc, days: null, now: NOW }).code;
  assert.throws(() => L.parseCode(foreign, [primary.x, OLD_X]));
  assert.throws(() => L.parseCode(foreign));
  assert.throws(() => L.parseCode(code, key().x));
});

test('revoked.json ký bằng khoá legacy hoặc khoá chính thì nhận, khoá lạ thì từ chối', () => {
  const legacy = key(); const primary = key(); const keys = [primary.x, legacy.x];
  assert.deepStrictEqual(L.verifyRevoked(L.signRevoked(legacy.pem, ['aaaaaaaaaaaa'], NOW), keys).revoked, ['aaaaaaaaaaaa']);
  assert.deepStrictEqual(L.verifyRevoked(L.signRevoked(primary.pem, ['bbbbbbbbbbbb'], NOW), keys).revoked, ['bbbbbbbbbbbb']);
  assert.throws(() => L.verifyRevoked(L.signRevoked(key().pem, ['cccccccccccc'], NOW), keys));
  assert.throws(() => L.verifyRevoked(L.signRevoked(key().pem, [], NOW)));
  const st = L.applyRevoked({ activatedAt: NOW }, L.signRevoked(legacy.pem, ['aaaaaaaaaaaa'], NOW), { now: NOW, publicX: keys });
  assert.deepStrictEqual(st.revokedIds, ['aaaaaaaaaaaa']);
});

test('bản cũ: revoked.json ký bằng khoá mới không gia hạn, hết GRACE_DAYS thì offline', () => {
  const oldK = key(); const newK = key();
  const mc = L.machineCodeFrom('win:ban-cu');
  const { code } = L.issueCode(oldK.pem, { name: 'Cũ', machineCode: mc, days: null, now: NOW });
  const st = { code, activatedAt: NOW, lastCheckOk: NOW };
  const doc = L.signRevoked(newK.pem, [], NOW + 1000);
  assert.throws(() => L.verifyRevoked(doc, oldK.x), /không hợp lệ/);
  assert.throws(() => L.applyRevoked(st, doc, { now: NOW + 1000, publicX: oldK.x }));
  assert.strictEqual(L.evaluate(st, { machineCode: mc, now: NOW + (L.GRACE_DAYS - 1) * 864e5, publicX: oldK.x }).ok, true);
  const late = L.evaluate(st, { machineCode: mc, now: NOW + (L.GRACE_DAYS + 1) * 864e5, publicX: oldK.x });
  assert.strictEqual(late.reason, 'offline');
  assert.strictEqual(late.needOnline, true);
});

test('admin.importKey từ chối khoá không phải khoá chính, nhận khoá trùng', async () => {
  const other = key();
  const a = createAdmin({ dir: tmp(), publicX: L.PUBLIC_KEY_X, fetchJson: async () => { throw new Error('offline'); }, fetchRaw: async () => { throw new Error('không được gọi'); } });
  await assert.rejects(a.importKey(JSON.stringify({ type: 'aivn-admin-key', publicKey: OLD_X, privateKey: other.pem }), 'cum-mat-khau-dai'), /không khớp với bản AIVN này/);
  await assert.rejects(a.importKey(JSON.stringify({ type: 'aivn-admin-key', publicKey: other.x, privateKey: other.pem }), 'cum-mat-khau-dai'), /bản AIVN mới hơn/);
  const primary = key();
  const ok = createAdmin({ dir: tmp(), publicX: primary.x, fetchJson: async () => { throw new Error('offline'); }, fetchRaw: async () => { throw new Error('không được gọi'); } });
  const st = await ok.importKey(JSON.stringify({ type: 'aivn-admin-key', publicKey: primary.x, privateKey: primary.pem }), 'cum-mat-khau-dai');
  assert.strictEqual(st.imported, true);
  assert.strictEqual(st.revokedUrl, L.REVOKED_URL_NEXT);
});

test('bản mới đăng revoked-v2.json và gộp id từ cả hai URL; v2 lỗi thì gia hạn bằng danh sách cũ', async () => {
  const k = key(); const dir = tmp();
  const seen = [];
  let putUrl = '';
  const a = createAdmin({
    dir, publicX: k.x, now: () => NOW,
    fetchJson: async (url) => {
      seen.push(url);
      if (String(url).includes('revoked-v2.json')) return L.signRevoked(k.pem, ['bbbbbbbbbbbb'], NOW - 10);
      return L.signRevoked(k.pem, ['aaaaaaaaaaaa'], NOW - 20);
    },
    fetchRaw: async (url, o) => {
      if (o && o.method === 'PUT') { putUrl = url; return { ok: true, json: async () => ({}) }; }
      return { ok: false, json: async () => ({ message: 'missing' }) };
    },
  });
  await a.importKey(JSON.stringify({ type: 'aivn-admin-key', publicKey: k.x, privateKey: k.pem }), 'cum-mat-khau-dai');
  a.setToken('github_pat_' + 'a'.repeat(24));
  const r = await a.revoke('cccccccccccc');
  assert.match(putUrl, /\/contents\/revoked-v2\.json$/);
  assert.doesNotMatch(putUrl, /\/contents\/revoked\.json$/);
  const ids = L.verifyRevoked(r.doc, k.x).revoked;
  assert.deepStrictEqual(ids, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc']);
  assert.ok(seen.some(u => u.includes('/revoked.json')) && seen.some(u => u.includes('revoked-v2.json')));

  const file = path.join(dir, 'license.json');
  const mc = L.machineCodeFrom('win:may-moi');
  process.env.AIVN_TEST_PUBKEY = k.x;
  process.env.AIVN_FAKE_MACHINE = mc;
  process.env.AIVN_FAKE_NOW = String(NOW);
  try {
    const calls = [];
    const g = createLicenseState({
      file, isPackaged: false,
      fetchJson: async (url) => {
        calls.push(url);
        if (String(url).includes('revoked-v2.json')) throw new Error('HTTP 404');
        return L.signRevoked(k.pem, [], NOW);
      },
    });
    const mine = L.issueCode(k.pem, { name: 'Mới', machineCode: g.machineCode(), days: null, now: NOW });
    assert.strictEqual(g.activate(mine.code).ok, true);
    const chk = await g.checkOnline();
    assert.strictEqual(chk.ok, true);
    assert.ok(g.state.lastCheckOk);
    assert.ok(calls.some(u => u.includes('revoked-v2.json')));
    assert.ok(calls.some(u => /\/revoked\.json\?/.test(u)));
    const calls2 = [];
    const g2 = createLicenseState({
      file, isPackaged: false,
      fetchJson: async (url) => {
        calls2.push(url);
        if (String(url).includes('revoked-v2.json')) return L.signRevoked(k.pem, [mine.info.id], NOW + 864e5);
        throw new Error('không cần URL cũ khi v2 hợp lệ');
      },
    });
    const chk2 = await g2.checkOnline();
    assert.strictEqual(chk2.status.reason, 'revoked');
    assert.ok(calls2.every(u => u.includes('revoked-v2.json')));
  } finally {
    delete process.env.AIVN_TEST_PUBKEY; delete process.env.AIVN_FAKE_MACHINE; delete process.env.AIVN_FAKE_NOW;
  }
});

test('unlock từ chối admin.json niêm bằng khoá không phải khoá chính, nhận đúng khoá chính', async () => {
  const primary = key(); const other = key(); const pass = 'cum-mat-khau-dai';
  const offline = { fetchJson: async () => { throw new Error('offline'); }, fetchRaw: async () => { throw new Error('không được gọi'); } };
  const dir = tmp();
  const a = createAdmin({ dir, publicX: primary.x, ...offline });
  await a.importKey(JSON.stringify({ type: 'aivn-admin-key', publicKey: primary.x, privateKey: primary.pem }), pass);
  a.lock();
  await assert.rejects(a.unlock('sai-mat-khau'), /không đúng/);
  assert.strictEqual(a.state().unlocked, false);
  const opened = await a.unlock(pass);
  assert.strictEqual(opened.unlocked, true);
  assert.strictEqual(L.parseCode(a.issue({ name: 'Đúng khoá', machineCode: 'AAAAABBBBB', days: 1 }).code, primary.x).name, 'Đúng khoá');

  const b = createAdmin({ dir, publicX: other.x, ...offline });
  await assert.rejects(b.unlock(pass), /không khớp với bản AIVN này/);
  assert.strictEqual(b.state().unlocked, false);
  assert.throws(() => b.issue({ name: 'X', machineCode: 'AAAAABBBBB' }), /khoá/);

  const dirP = tmp(); const dirO = tmp(); const dirM = tmp();
  await createAdmin({ dir: dirP, publicX: primary.x, ...offline }).importKey(JSON.stringify({ type: 'aivn-admin-key', publicKey: primary.x, privateKey: primary.pem }), pass);
  await createAdmin({ dir: dirO, publicX: other.x, ...offline }).importKey(JSON.stringify({ type: 'aivn-admin-key', publicKey: other.x, privateKey: other.pem }), pass);
  const sealedP = JSON.parse(fs.readFileSync(path.join(dirP, 'admin.json'), 'utf8'));
  const sealedO = JSON.parse(fs.readFileSync(path.join(dirO, 'admin.json'), 'utf8'));
  fs.writeFileSync(path.join(dirM, 'admin.json'), JSON.stringify({ ...sealedP, publicKey: primary.x, salt: sealedO.salt, sealed: sealedO.sealed }));
  const mixed = createAdmin({ dir: dirM, publicX: primary.x, ...offline });
  await assert.rejects(mixed.unlock(pass), /không khớp với bản AIVN này/);
  assert.strictEqual(mixed.state().unlocked, false);
});

const { spawnSync } = require('child_process');
const { mergeV2, copyV1 } = require('../build/merge-revoked.cjs');
const root = path.join(__dirname, '..');
function rawDoc(pem, ids, issuedAt) {
  return Buffer.from(JSON.stringify(L.signRevoked(pem, ids, issuedAt)) + '\n');
}

test('merge revoked: v2 giữ bản mới nhất còn chữ ký; bản cũ hoặc sai bị bỏ; v1 không đụng tới', () => {
  const primary = key(); const legacy = key(); const foreign = key();
  const trust = [primary.x, legacy.x];
  const dir = tmp();
  const older = rawDoc(legacy.pem, ['aaaaaaaaaaaa'], NOW);
  const newer = rawDoc(primary.pem, ['bbbbbbbbbbbb'], NOW + 864e5);
  const bad = Buffer.from(newer.toString('utf8').replace(/"sig":"[^"]+"/, '"sig":"' + Buffer.from('x'.repeat(64)).toString('base64') + '"'));
  const v1 = fs.readFileSync(path.join(root, 'site/revoked.json'));
  const v1copy = path.join(dir, 'revoked.json');
  fs.writeFileSync(v1copy, v1);

  const live = path.join(dir, 'live.json'); const local = path.join(dir, 'local.json'); const out = path.join(dir, 'revoked-v2.json');
  fs.writeFileSync(live, newer); fs.writeFileSync(local, older);
  assert.strictEqual(mergeV2({ out, paths: [local, live], publicX: trust }), 0);
  assert.deepStrictEqual(fs.readFileSync(out), newer);
  assert.deepStrictEqual(fs.readFileSync(v1copy), v1);

  fs.writeFileSync(local, newer); fs.writeFileSync(live, older); fs.rmSync(out);
  assert.strictEqual(mergeV2({ out, paths: [local, live], publicX: trust }), 0);
  assert.deepStrictEqual(fs.readFileSync(out), newer);

  const kept = fs.readFileSync(out);
  fs.writeFileSync(local, older);
  assert.strictEqual(mergeV2({ out, paths: [local], publicX: trust }), 0);
  assert.deepStrictEqual(fs.readFileSync(out), kept);

  fs.writeFileSync(local, bad);
  assert.strictEqual(mergeV2({ out, paths: [local], publicX: trust }), 0);
  assert.deepStrictEqual(fs.readFileSync(out), kept);

  const onlyBad = path.join(dir, 'only-bad'); fs.mkdirSync(onlyBad);
  fs.writeFileSync(path.join(dir, 'foreign.json'), rawDoc(foreign.pem, ['cccccccccccc'], NOW + 9 * 864e5));
  assert.strictEqual(mergeV2({ out: path.join(onlyBad, 'revoked-v2.json'), paths: [path.join(dir, 'foreign.json'), local], publicX: trust }), 0);
  assert.ok(!fs.existsSync(path.join(onlyBad, 'revoked-v2.json')));
  assert.deepStrictEqual(fs.readFileSync(v1copy), v1);

  const frozenOut = path.join(dir, 'nested', 'revoked.json');
  fs.mkdirSync(path.dirname(frozenOut));
  fs.writeFileSync(frozenOut, v1);
  assert.strictEqual(mergeV2({ out: frozenOut, paths: [live], publicX: trust }), 1);
  assert.deepStrictEqual(fs.readFileSync(frozenOut), v1);

  const cliOut = path.join(dir, 'cli-v1.json');
  const cli = spawnSync(process.execPath, [path.join(root, 'build/merge-revoked.cjs'), v1copy, cliOut], { encoding: 'utf8' });
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.deepStrictEqual(fs.readFileSync(cliOut), v1);
  assert.deepStrictEqual(fs.readFileSync(v1copy), v1);
  const signedNew = path.join(dir, 'signed-new.json');
  fs.writeFileSync(signedNew, rawDoc(primary.pem, [], NOW));
  const before = fs.readFileSync(signedNew);
  const rejected = path.join(dir, 'rejected.json');
  const badCli = spawnSync(process.execPath, [path.join(root, 'build/merge-revoked.cjs'), signedNew, rejected], { encoding: 'utf8' });
  assert.strictEqual(badCli.status, 1);
  assert.match(badCli.stderr, /không ký lại|revoked-v2\.json/);
  assert.deepStrictEqual(fs.readFileSync(signedNew), before);
  assert.ok(!fs.existsSync(rejected));
  assert.strictEqual(copyV1(v1copy, path.join(dir, 'copy-v1.json')), 0);
  assert.deepStrictEqual(fs.readFileSync(path.join(dir, 'copy-v1.json')), v1);
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'site/revoked.json')), v1);
});

test('release.sh trộn revoked-v2 trước khi đẩy gh-pages và không bảo ký lại revoked.json', () => {
  const rel = fs.readFileSync(path.join(root, 'release.sh'), 'utf8');
  const push = rel.indexOf('git push -q -f origin gh-pages');
  const fn = rel.indexOf('merge_revoked_into_site() {');
  const v1 = rel.indexOf('node build/merge-revoked.cjs site/revoked.json "$SITE/revoked.json"');
  const v2 = rel.indexOf('node build/merge-revoked.cjs --next --out "$SITE/revoked-v2.json" site/revoked-v2.json');
  const v2live = rel.indexOf('node build/merge-revoked.cjs --next --no-fetch --out "$SITE/revoked-v2.json"');
  const call = rel.indexOf('\nmerge_revoked_into_site\n');
  const clone = rel.indexOf('git clone -q --branch gh-pages');
  const callLive = rel.indexOf('merge_revoked_into_site "$LIVE"');
  const drift = rel.indexOf('python3 tools/site_drift.py --rendered "$SITE" --live');
  const endFn = rel.indexOf('\n}\nmerge_revoked_into_site\n');
  assert.ok(fn > 0 && v1 > fn && v2live > fn && v2 > fn && endFn > v1 && endFn > v2 && endFn > v2live, 'cả hai lệnh trộn nằm trong một hàm');
  assert.ok(call > endFn && call < clone && clone < callLive && callLive < drift && drift < push);
  assert.doesNotMatch(rel, /admin\.cjs/);
  assert.match(rel, /for f in preview-desktop\.png preview-mobile\.png favicon\.svg favicon\.ico apple-touch-icon\.png; do \[\[ -f "site\/\$f" \]\] && cp "site\/\$f" "\$SITE\/"; done\n/);
  assert.match(fs.readFileSync(path.join(root, 'tools/site_drift.py'), 'utf8'), /'revoked-v2\.json'/);
});
