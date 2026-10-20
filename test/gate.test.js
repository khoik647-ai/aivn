// QA 0.14.3: cổng kích hoạt (createLicenseState) — đúng máy, sai máy, thu hồi, ân hạn offline, hết hạn, đồng hồ lùi, danh sách thật trên trang
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const L = require('../src/license');
const { createLicenseState } = require('../src/gate');
function key() { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { x: publicKey.export({ format: 'jwk' }).x, pem: privateKey.export({ format: 'pem', type: 'pkcs8' }) }; }
const DAY = 864e5;

test('cổng kích hoạt: luồng đầy đủ với mạng giả', async () => {
  const k = key(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-gate-')); const file = path.join(dir, 'license.json');
  const T0 = Date.UTC(2026, 9, 20);
  Object.assign(process.env, { AIVN_TEST_PUBKEY: k.x, AIVN_FAKE_MACHINE: L.fmtMachine(L.machineCodeFrom('win:may-cua-khoi')), AIVN_FAKE_NOW: String(T0) });
  let net = { fail: false, doc: L.signRevoked(k.pem, [], T0) };
  const mk = () => createLicenseState({ file, isPackaged: false, fetchJson: async () => { if (net.fail) throw new Error('offline'); return net.doc; } });
  let g = mk();
  assert.strictEqual(g.publicInfo().status, 'none');
  const mine = L.issueCode(k.pem, { name: 'Khôi', machineCode: g.machineCode(), days: 0, now: T0 });
  const other = L.issueCode(k.pem, { name: 'Bạn', machineCode: L.machineCodeFrom('win:may-khac'), days: 0, now: T0 });
  const expired = L.issueCode(k.pem, { name: 'Hết hạn', machineCode: g.machineCode(), days: 1, now: T0 - 5 * DAY });
  assert.throws(() => g.activate(other.code), /cấp cho máy/);
  assert.throws(() => g.activate(expired.code), /hết hạn/);
  assert.throws(() => g.activate('AIVN-SAI-MA'), /./);
  assert.strictEqual(g.activate(mine.code).ok, true);
  // mất mạng: vẫn dùng được trong 14 ngày
  net.fail = true; let r = await g.checkOnline(); assert.strictEqual(r.ok, false); assert.strictEqual(r.status.ok, true);
  process.env.AIVN_FAKE_NOW = String(T0 + 13 * DAY); g = mk(); assert.strictEqual(g.evaluate().ok, true); assert.ok(g.publicInfo().graceLeftMs < 1.1 * DAY);
  process.env.AIVN_FAKE_NOW = String(T0 + 15 * DAY); g = mk(); assert.strictEqual(g.evaluate().reason, 'offline'); assert.strictEqual(g.publicInfo().needOnline, true);
  // có mạng lại: mở lại
  net = { fail: false, doc: L.signRevoked(k.pem, [], T0 + 15 * DAY) }; r = await g.checkOnline(); assert.strictEqual(r.status.ok, true);
  // đồng hồ bị lùi
  process.env.AIVN_FAKE_NOW = String(T0 + 2 * DAY); g = mk(); assert.strictEqual(g.evaluate().reason, 'clock');
  process.env.AIVN_FAKE_NOW = String(T0 + 16 * DAY); g = mk();
  // danh sách giả mạo / quay lui bị bỏ qua, vẫn hoạt động
  net.doc = { ...L.signRevoked(key().pem, [mine.info.id], T0 + 16 * DAY) }; r = await g.checkOnline(); assert.strictEqual(r.ok, false); assert.strictEqual(r.status.ok, true);
  net.doc = L.signRevoked(k.pem, [mine.info.id], T0 + 1 * DAY); r = await g.checkOnline(); assert.strictEqual(r.ok, false); assert.strictEqual(r.status.ok, true);
  // thu hồi thật
  net.doc = L.signRevoked(k.pem, [mine.info.id], T0 + 16 * DAY); r = await g.checkOnline(); assert.strictEqual(r.status.reason, 'revoked');
  assert.match(g.publicInfo().message, /thu hồi/);
  assert.throws(() => g.activate(mine.code), /thu hồi/);
  for (const v of ['AIVN_TEST_PUBKEY', 'AIVN_FAKE_MACHINE', 'AIVN_FAKE_NOW']) delete process.env[v];
});

test('bản đóng gói bỏ qua biến môi trường kiểm thử', () => {
  process.env.AIVN_TEST_PUBKEY = key().x; process.env.AIVN_FAKE_MACHINE = 'AAAA-BBBB';
  const g = createLicenseState({ file: path.join(os.tmpdir(), 'aivn-gate-pkg-' + Date.now() + '.json'), isPackaged: true, fetchJson: async () => ({}) });
  assert.notStrictEqual(g.machineCode(), L.normMachine('AAAA-BBBB'));
  delete process.env.AIVN_TEST_PUBKEY; delete process.env.AIVN_FAKE_MACHINE;
});

test('revoked.json trên trang web có chữ ký hợp lệ với khoá công khai trong app', { skip: process.env.AIVN_OFFLINE && 'offline', timeout: 20000 }, async () => {
  let doc; try { doc = await (await fetch(L.REVOKED_URL + '?t=' + Date.now())).json(); } catch (e) { return; }
  const j = L.verifyRevoked(doc, L.PUBLIC_KEY_X); assert.ok(Array.isArray(j.revoked));
});
