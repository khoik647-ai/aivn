// "Khóa ứng dụng": mật khẩu cục bộ để mở AIVN. Chỉ lưu muối + băm scrypt (không bao giờ lưu/ghi log mật khẩu).
// Đây là khoá ứng dụng, KHÔNG mã hoá tệp trò chuyện trên ổ đĩa.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const DELAYS = [30e3, 60e3, 300e3]; // sau lần sai thứ 5, 6, ≥7
const FREE_TRIES = 5;
const IDLE_CHOICES = [0, 5, 15, 30, 60];

const hashPw = (pw, salt) => new Promise((res, rej) => crypto.scrypt(String(pw).normalize('NFC'), salt, 32, SCRYPT, (e, k) => e ? rej(e) : res(k)));

function createAppLock(file, { now = () => Date.now() } = {}) {
  let data = { enabled: false, salt: null, hash: null, failures: 0, blockedUntil: 0, idleMinutes: 0, lockOnSleep: true };
  try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(t, file); };
  const validate = (pw) => { if (typeof pw !== 'string' || [...pw].length < 4) throw new Error('Mật khẩu cần ít nhất 4 ký tự'); if (pw.length > 256) throw new Error('Mật khẩu quá dài'); };
  async function check(pw) {
    if (!data.hash) return false;
    const k = await hashPw(pw, Buffer.from(data.salt, 'base64'));
    return crypto.timingSafeEqual(k, Buffer.from(data.hash, 'base64'));
  }
  const waitMs = () => Math.max(0, (data.blockedUntil || 0) - now());
  // Thử mở khoá: trả { ok } hoặc { ok:false, waitMs, failures, message }
  async function unlock(pw) {
    const w = waitMs();
    if (w > 0) return { ok: false, waitMs: w, failures: data.failures, message: `Nhập sai quá nhiều lần. Thử lại sau ${fmtWait(w)}.` };
    if (await check(pw)) { data.failures = 0; data.blockedUntil = 0; save(); return { ok: true }; }
    data.failures = (data.failures || 0) + 1;
    let msg = 'Mật khẩu không đúng.';
    if (data.failures >= FREE_TRIES) { const d = DELAYS[Math.min(DELAYS.length - 1, data.failures - FREE_TRIES)]; data.blockedUntil = now() + d; msg += ` Đã sai ${data.failures} lần, hãy chờ ${fmtWait(d)}.`; }
    else msg += ` Còn ${FREE_TRIES - data.failures} lần thử trước khi phải chờ.`;
    save();
    return { ok: false, waitMs: waitMs(), failures: data.failures, message: msg };
  }
  async function requireCurrent(current) {
    const w = waitMs(); if (w > 0) throw new Error(`Nhập sai quá nhiều lần. Thử lại sau ${fmtWait(w)}.`);
    const r = await unlock(current); if (!r.ok) throw new Error(r.message.replace('Mật khẩu không đúng', 'Mật khẩu hiện tại không đúng'));
  }
  async function setPassword(pw, confirm, current) {
    if (data.enabled) await requireCurrent(current);
    validate(pw); if (pw !== confirm) throw new Error('Hai lần nhập mật khẩu không khớp');
    const salt = crypto.randomBytes(16);
    data.salt = salt.toString('base64'); data.hash = (await hashPw(pw, salt)).toString('base64');
    data.enabled = true; data.failures = 0; data.blockedUntil = 0; save();
  }
  async function disable(current) { if (!data.enabled) return; await requireCurrent(current); data.enabled = false; data.salt = data.hash = null; save(); }
  function setOptions({ idleMinutes, lockOnSleep } = {}) {
    if (idleMinutes !== undefined) { const n = Number(idleMinutes); if (!IDLE_CHOICES.includes(n)) throw new Error('Thời gian tự khoá không hợp lệ'); data.idleMinutes = n; }
    if (lockOnSleep !== undefined) data.lockOnSleep = !!lockOnSleep;
    save();
  }
  const info = () => ({ enabled: !!data.enabled, idleMinutes: data.idleMinutes, lockOnSleep: !!data.lockOnSleep, failures: data.failures || 0, waitMs: waitMs() });
  return { info, unlock, setPassword, disable, setOptions, isEnabled: () => !!data.enabled, waitMs };
}
function fmtWait(ms) { const s = Math.ceil(ms / 1000); return s < 60 ? `${s} giây` : s % 60 ? `${Math.floor(s / 60)} phút ${s % 60} giây` : `${s / 60} phút`; }

// "Quên mật khẩu?": xoá dữ liệu AIVN trên máy này, GIỮ mô hình đã tải và kích hoạt (gắn với máy, không phải dữ liệu cá nhân)
const RESET_WORD = 'XOA';
const normWord = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').trim().toUpperCase();
function resetData(userData, word) {
  if (normWord(word) !== RESET_WORD) throw new Error('Hãy gõ đúng chữ XOÁ để xác nhận');
  const keep = new Set(['models', 'license.json', 'admin.json', 'admin-issued.json']); // admin.json đã được mã hoá bằng cụm mật khẩu quản trị riêng
  const removed = [];
  for (const name of fs.readdirSync(userData)) {
    if (keep.has(name)) continue;
    if (!/^(conversations\.json|memory\.json|schedules\.json|settings\.json|applock\.json|actions\.json|rag|.*\.tmp)$/.test(name)) continue; // chỉ xoá dữ liệu của AIVN, không đụng thư mục hệ thống của Chromium khi đang chạy
    fs.rmSync(path.join(userData, name), { recursive: true, force: true }); removed.push(name);
  }
  return removed;
}

module.exports = { createAppLock, resetData, fmtWait, RESET_WORD, IDLE_CHOICES, DELAYS, FREE_TRIES };
