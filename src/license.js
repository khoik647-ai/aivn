// Kích hoạt AIVN do chủ sở hữu cấp (không cần máy chủ trả phí).
// Mã kích hoạt = dữ liệu nhị phân nhỏ + chữ ký Ed25519 của chủ sở hữu, mã hoá Base32 (Crockford), gắn với "Mã máy".
// Ứng dụng chỉ chứa KHOÁ CÔNG KHAI để kiểm tra; khoá riêng nằm ở máy chủ sở hữu.
// Lưu ý trung thực: mã nguồn công khai nên người rành kỹ thuật có thể tự build bỏ kiểm tra; cơ chế này để ngăn người dùng phổ thông.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const PUBLIC_KEY_X = 'QMWzpffqj1QHIv0WNPnZqTlSMF7eeoDc_mI55kpas_A'; // Ed25519, JWK "x" (base64url)
const REVOKED_URL = 'https://khoik647-ai.github.io/aivn/revoked.json';
const GRACE_DAYS = 14;
const CHECK_EVERY_MS = 4 * 3600e3;
const OWNER = 'NGUYỄN NGỌC KHÔI SINH VIÊN VLU';

const pubKey = (x = PUBLIC_KEY_X) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });

// --- Base32 Crockford (không dùng I, L, O, U để dễ đọc/gõ) ---
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } val &= 0xff; }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  const s = String(str).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  let bits = 0, val = 0; const out = [];
  for (const ch of s) { const i = B32.indexOf(ch); if (i < 0) throw new Error('Mã chứa ký tự không hợp lệ: ' + ch); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } val &= 0xff; }
  return Buffer.from(out);
}
const group = (s, n = 5) => s.match(new RegExp(`.{1,${n}}`, 'g')).join('-');

// --- Mã máy: băm ổn định của ID máy (không lộ ID gốc) ---
function rawMachineId() {
  try {
    if (process.platform === 'win32') {
      const o = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = o.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i); if (m) return 'win:' + m[1].toLowerCase();
    } else if (process.platform === 'darwin') {
      const o = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
      const m = o.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/); if (m) return 'mac:' + m[1].toLowerCase();
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return 'linux:' + v; } catch {} }
    }
  } catch {}
  return null;
}
function machineCodeFrom(raw) { return b32encode(crypto.createHash('sha256').update('aivn-machine-v1:' + raw).digest()).slice(0, 10); }
const fmtMachine = (mc) => mc.slice(0, 5) + '-' + mc.slice(5, 10);
const normMachine = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

// --- Mã kích hoạt: [ver 1][id 6][máy 10 ký tự → 7 byte][cấp lúc 4: phút từ 2026][hết hạn 4: phút, 0 = vĩnh viễn][len 1][tên UTF-8] + chữ ký 64 ---
const EPOCH = Date.UTC(2026, 0, 1);
const toMin = (ms) => Math.max(0, Math.round((ms - EPOCH) / 60000));
const fromMin = (m) => EPOCH + m * 60000;
function packPayload({ id, name, machineCode, issuedAt, expiresAt }) {
  const nm = Buffer.from(String(name || '').normalize('NFC')).subarray(0, 60);
  const mc = b32decode(normMachine(machineCode).padEnd(10, '0').slice(0, 10) + '000000').subarray(0, 7); // 10 ký tự = 50 bit
  const b = Buffer.alloc(1 + 6 + 7 + 4 + 4 + 1 + nm.length);
  let o = 0; b[o++] = 1;
  Buffer.from(id, 'hex').copy(b, o); o += 6;
  mc.copy(b, o); o += 7;
  b.writeUInt32BE(toMin(issuedAt), o); o += 4;
  b.writeUInt32BE(expiresAt ? toMin(expiresAt) : 0, o); o += 4;
  b[o++] = nm.length; nm.copy(b, o);
  return b;
}
function unpackPayload(b) {
  if (b.length < 23 || b[0] !== 1) throw new Error('Mã kích hoạt không đúng định dạng');
  const id = b.subarray(1, 7).toString('hex');
  const machineCode = b32encode(b.subarray(7, 14)).slice(0, 10);
  const issuedAt = fromMin(b.readUInt32BE(14));
  const e = b.readUInt32BE(18);
  const n = b[22]; if (b.length !== 23 + n) throw new Error('Mã kích hoạt không đúng định dạng');
  return { id, machineCode, issuedAt, expiresAt: e ? fromMin(e) : null, name: b.subarray(23, 23 + n).toString('utf8') };
}
function issueCode(privateKeyPem, { name, machineCode, days = null, now = Date.now(), id = crypto.randomBytes(6).toString('hex') }) {
  const mc = normMachine(machineCode);
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(mc)) throw new Error('Mã máy phải gồm 10 ký tự (vd. AB12C-DE34F)');
  if (!String(name || '').trim()) throw new Error('Thiếu tên người được cấp');
  const payload = packPayload({ id, name: String(name).trim(), machineCode: mc, issuedAt: now, expiresAt: days ? now + days * 864e5 : null });
  const sig = crypto.sign(null, payload, crypto.createPrivateKey(privateKeyPem));
  return { code: group(b32encode(Buffer.concat([payload, sig])), 6), info: unpackPayload(payload) };
}
function parseCode(code, publicX) {
  let raw; try { raw = b32decode(code); } catch (e) { throw new Error('Mã kích hoạt không hợp lệ (' + e.message + ')'); }
  if (raw.length < 23 + 64) throw new Error('Mã kích hoạt quá ngắn hoặc bị thiếu ký tự');
  const payload = raw.subarray(0, raw.length - 64), sig = raw.subarray(raw.length - 64);
  if (!crypto.verify(null, payload, pubKey(publicX), sig)) throw new Error('Mã kích hoạt không đúng (chữ ký không hợp lệ). Hãy sao chép lại đầy đủ mã.');
  return unpackPayload(payload);
}

// --- Danh sách thu hồi đã ký: { payload: base64(JSON {v, issuedAt, revoked:[id…]}), sig: base64 } ---
function signRevoked(privateKeyPem, ids, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ v: 1, issuedAt: now, revoked: [...new Set(ids)].sort() }));
  return { payload: payload.toString('base64'), sig: crypto.sign(null, payload, crypto.createPrivateKey(privateKeyPem)).toString('base64'), note: 'Danh sách mã kích hoạt AIVN đã thu hồi, ký Ed25519 bởi chủ sở hữu.' };
}
function verifyRevoked(doc, publicX) {
  if (!doc || typeof doc.payload !== 'string' || typeof doc.sig !== 'string') throw new Error('Danh sách thu hồi sai định dạng');
  const payload = Buffer.from(doc.payload, 'base64');
  if (!crypto.verify(null, payload, pubKey(publicX), Buffer.from(doc.sig, 'base64'))) throw new Error('Chữ ký danh sách thu hồi không hợp lệ');
  const j = JSON.parse(payload.toString('utf8'));
  if (j.v !== 1 || !Array.isArray(j.revoked) || !Number.isFinite(j.issuedAt)) throw new Error('Danh sách thu hồi sai định dạng');
  return j;
}

// --- Đánh giá trạng thái (hàm thuần, dễ kiểm thử) ---
// st: { code, lastCheckOk, revokedSeenAt, revokedIds } → { ok, reason, info, needOnline, graceLeftMs }
function evaluate(st, { machineCode, now = Date.now(), publicX } = {}) {
  if (!st || !st.code) return { ok: false, reason: 'none' };
  let info; try { info = parseCode(st.code, publicX); } catch (e) { return { ok: false, reason: 'invalid', message: e.message }; }
  if (normMachine(info.machineCode) !== normMachine(machineCode)) return { ok: false, reason: 'machine', info };
  if (info.expiresAt && now > info.expiresAt) return { ok: false, reason: 'expired', info };
  if ((st.revokedIds || []).includes(info.id)) return { ok: false, reason: 'revoked', info };
  const base = Math.max(st.lastCheckOk || 0, st.activatedAt || 0);
  if (now + 10 * 60e3 < base) return { ok: false, reason: 'clock', info, needOnline: true }; // đồng hồ máy bị lùi
  const graceLeftMs = base + GRACE_DAYS * 864e5 - now;
  if (graceLeftMs <= 0) return { ok: false, reason: 'offline', info, needOnline: true };
  return { ok: true, info, graceLeftMs };
}
// Áp dụng một danh sách thu hồi mới tải về (đã kiểm chữ ký); chống quay lui về danh sách cũ hơn
function applyRevoked(st, doc, { now = Date.now(), publicX } = {}) {
  const j = verifyRevoked(doc, publicX);
  if (st.revokedSeenAt && j.issuedAt < st.revokedSeenAt) throw new Error('Danh sách thu hồi cũ hơn bản đã thấy (bị quay lui)');
  return { ...st, revokedIds: j.revoked, revokedSeenAt: j.issuedAt, lastCheckOk: now };
}

const REASON_VI = {
  none: 'AIVN chưa được kích hoạt trên máy này.',
  invalid: 'Mã kích hoạt không hợp lệ.',
  machine: 'Mã kích hoạt này được cấp cho máy khác, không dùng được trên máy này.',
  expired: 'Mã kích hoạt đã hết hạn.',
  revoked: 'Mã kích hoạt đã bị chủ sở hữu thu hồi.',
  offline: `Đã quá ${GRACE_DAYS} ngày AIVN chưa kiểm tra được giấy phép. Hãy kết nối Internet một lần để tiếp tục.`,
  clock: 'Đồng hồ máy có vẻ bị chỉnh lùi. Hãy chỉnh lại giờ và kết nối Internet một lần.',
};

module.exports = { PUBLIC_KEY_X, REVOKED_URL, GRACE_DAYS, CHECK_EVERY_MS, OWNER, REASON_VI, b32encode, b32decode, group, rawMachineId, machineCodeFrom, fmtMachine, normMachine, issueCode, parseCode, signRevoked, verifyRevoked, evaluate, applyRevoked, packPayload, unpackPayload };
