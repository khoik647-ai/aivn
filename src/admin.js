// Trang "Quản trị" của chủ sở hữu: nhập khoá riêng Ed25519 (mã hoá trên máy bằng cụm mật khẩu quản trị),
// cấp mã kích hoạt theo Mã máy, thu hồi, ký và đăng revoked.json. Khoá riêng KHÔNG bao giờ rời tiến trình chính.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const L = require('./license');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const kdf = (pass, salt) => new Promise((res, rej) => crypto.scrypt(String(pass).normalize('NFC'), salt, 32, SCRYPT, (e, k) => e ? rej(e) : res(k)));
function seal(key, text) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]); return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }; }
function open_(key, o) { const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64')); d.setAuthTag(Buffer.from(o.tag, 'base64')); return Buffer.concat([d.update(Buffer.from(o.ct, 'base64')), d.final()]).toString('utf8'); }

function createAdmin({ dir, fetchJson, fetchRaw, publicX = L.PUBLIC_KEY_X, log = () => {}, repo = 'khoik647-ai/aivn', now = () => Date.now() }) {
  const FILE = path.join(dir, 'admin.json'), ISSUED = path.join(dir, 'admin-issued.json');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const write = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2), { mode: 0o600 }); fs.renameSync(t, f); };
  let session = null; // { key: Buffer(kdf), pem, token, at }
  const IDLE_MS = 15 * 60e3;
  const issued = () => read(ISSUED, { codes: [], revoked: [] });
  const alive = () => { if (session && now() - session.at > IDLE_MS) session = null; if (session) session.at = now(); return !!session; };
  const need = () => { if (!alive()) throw new Error('Trang Quản trị đang khoá. Nhập cụm mật khẩu quản trị để mở.'); return session; };

  function state() {
    const st = read(FILE, null); const iss = issued();
    return { imported: !!st, unlocked: alive(), hasToken: !!(st && st.token), repo, revokedUrl: L.REVOKED_URL,
      codes: alive() ? iss.codes.map(c => ({ ...c, revoked: iss.revoked.includes(c.id) })).reverse() : [], revokedCount: iss.revoked.length, lastPublish: st ? st.lastPublish || null : null };
  }
  async function importKey(json, pass) {
    if (typeof pass !== 'string' || [...pass].length < 8) throw new Error('Cụm mật khẩu quản trị cần ít nhất 8 ký tự');
    let k; try { k = typeof json === 'string' ? JSON.parse(json) : json; } catch { throw new Error('Tệp khoá không phải JSON hợp lệ'); }
    if (!k || k.type !== 'aivn-admin-key' || typeof k.privateKey !== 'string') throw new Error('Đây không phải tệp khoá quản trị AIVN (aivn-admin-key.json)');
    if (k.publicKey !== publicX) throw new Error('Khoá này không khớp với khoá công khai trong ứng dụng AIVN');
    let priv; try { priv = crypto.createPrivateKey(k.privateKey); } catch { throw new Error('Khoá riêng bị hỏng'); }
    const probe = Buffer.from('aivn-probe'); if (!crypto.verify(null, probe, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicX }, format: 'jwk' }), crypto.sign(null, probe, priv))) throw new Error('Khoá riêng không khớp khoá công khai');
    const salt = crypto.randomBytes(16); const key = await kdf(pass, salt);
    write(FILE, { v: 1, salt: salt.toString('base64'), publicKey: publicX, sealed: seal(key, k.privateKey), importedAt: now() });
    session = { key, pem: k.privateKey, token: null, at: now() };
    log('[quản trị] đã nhập khoá quản trị (đã mã hoá bằng cụm mật khẩu)');
    return state();
  }
  async function unlock(pass) {
    const st = read(FILE, null); if (!st) throw new Error('Chưa nhập khoá quản trị trên máy này');
    const key = await kdf(pass, Buffer.from(st.salt, 'base64'));
    let pem; try { pem = open_(key, st.sealed); } catch { throw new Error('Cụm mật khẩu quản trị không đúng'); }
    let token = null; if (st.token) { try { token = open_(key, st.token); } catch {} }
    session = { key, pem, token, at: now() };
    return state();
  }
  function lock() { session = null; return state(); }
  function forget() { session = null; try { fs.rmSync(FILE, { force: true }); } catch {} return state(); }
  function setToken(token) {
    const s = need(); const st = read(FILE, null);
    const t = String(token || '').trim();
    if (t && !/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(t)) throw new Error('Token GitHub không đúng dạng (bắt đầu bằng github_pat_ hoặc ghp_)');
    if (t) st.token = seal(s.key, t); else delete st.token;
    write(FILE, st); s.token = t || null; return state();
  }
  function issue({ name, machineCode, days }) {
    const s = need();
    const d = days ? Number(days) : null; if (d !== null && !(d > 0 && d <= 3650)) throw new Error('Số ngày phải từ 1 đến 3650 (để trống = vĩnh viễn)');
    const r = L.issueCode(s.pem, { name, machineCode, days: d, now: now() });
    const iss = issued(); iss.codes.push({ ...r.info, code: r.code, by: 'app' }); write(ISSUED, iss);
    log(`[quản trị] đã cấp mã ${r.info.id} cho máy ${L.fmtMachine(r.info.machineCode)}`);
    return { code: r.code, info: r.info, state: state() };
  }
  // Danh sách thu hồi hiện hành = bản đang công khai (đã kiểm chữ ký) ∪ bản trên máy này
  async function currentRevoked() {
    const ids = new Set(issued().revoked);
    try { const doc = await fetchJson(L.REVOKED_URL + '?t=' + now()); L.verifyRevoked(doc, publicX).revoked.forEach(i => ids.add(i)); } catch (e) { log('[quản trị] không tải được revoked.json đang công khai: ' + e.message); }
    return [...ids];
  }
  async function publishDoc(doc) {
    const s = need(); if (!s.token) return { published: false, doc };
    const api = `https://api.github.com/repos/${repo}/contents/revoked.json`;
    const h = { Authorization: 'Bearer ' + s.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AIVN' };
    let sha; try { const r = await fetchRaw(api + '?ref=gh-pages', { headers: h }); if (r.ok) sha = (await r.json()).sha; } catch {}
    const body = { message: `Cập nhật danh sách thu hồi (${JSON.parse(Buffer.from(doc.payload, 'base64')).revoked.length})`, branch: 'gh-pages', content: Buffer.from(JSON.stringify(doc, null, 2) + '\n').toString('base64'), ...(sha ? { sha } : {}) };
    const r = await fetchRaw(api, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch {} throw new Error(`GitHub từ chối (HTTP ${r.status}${m ? ': ' + m : ''}). Kiểm tra token có quyền Contents: Read and write với kho ${repo}.`); }
    const st = read(FILE, {}); st.lastPublish = now(); write(FILE, st);
    return { published: true, doc };
  }
  async function revoke(id) {
    const s = need(); id = String(id || '').toLowerCase();
    if (!/^[0-9a-f]{12}$/.test(id)) throw new Error('ID mã không hợp lệ');
    const iss = issued(); if (!iss.revoked.includes(id)) iss.revoked.push(id); write(ISSUED, iss);
    const ids = await currentRevoked(); if (!ids.includes(id)) ids.push(id);
    const doc = L.signRevoked(s.pem, ids, now());
    const r = await publishDoc(doc);
    log(`[quản trị] đã thu hồi ${id}${r.published ? ' và đăng revoked.json' : ' (chưa đăng: chưa có token GitHub)'}`);
    return { ...r, state: state() };
  }
  async function publish() { const s = need(); const doc = L.signRevoked(s.pem, await currentRevoked(), now()); return { ...(await publishDoc(doc)), state: state() }; }
  return { state, importKey, unlock, lock, forget, setToken, issue, revoke, publish, alive };
}
module.exports = { createAdmin };
