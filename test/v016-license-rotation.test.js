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
