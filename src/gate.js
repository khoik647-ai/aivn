// Cổng vào AIVN: kích hoạt do chủ sở hữu cấp (bắt buộc) + khoá ứng dụng cá nhân (tuỳ chọn).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./license');

function createLicenseState({ file, isPackaged, log = () => {}, fetchJson }) {
  // Biến môi trường chỉ để kiểm thử, KHÔNG có hiệu lực trong bản đóng gói
  const dev = !isPackaged;
  const publicX = dev && process.env.AIVN_TEST_PUBKEY ? process.env.AIVN_TEST_PUBKEY : L.PUBLIC_KEY_X;
  const url = dev && process.env.AIVN_REVOKED_URL ? process.env.AIVN_REVOKED_URL : L.REVOKED_URL;
  const now = () => dev && process.env.AIVN_FAKE_NOW ? Number(process.env.AIVN_FAKE_NOW) + (Date.now() - startedAt) : Date.now();
  const startedAt = Date.now();
  let st = {};
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const save = () => { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(st, null, 2), { mode: 0o600 }); fs.renameSync(t, file); };

  let mc = null;
  function machineCode() {
    if (mc) return mc;
    if (dev && process.env.AIVN_FAKE_MACHINE) return (mc = L.normMachine(process.env.AIVN_FAKE_MACHINE));
    let raw = L.rawMachineId();
    if (!raw) { // không đọc được ID máy: tạo một ID ngẫu nhiên lưu cạnh dữ liệu (mất nếu xoá thư mục dữ liệu)
      if (!st.fallbackId) { st.fallbackId = crypto.randomBytes(16).toString('hex'); save(); }
      raw = 'fallback:' + st.fallbackId;
    }
    return (mc = L.machineCodeFrom(raw));
  }
  const evaluate = () => L.evaluate(st, { machineCode: machineCode(), now: now(), publicX });
  function activate(code) {
    const clean = String(code || '').trim();
    let info; try { info = L.parseCode(clean, publicX); } catch (e) { throw new Error(e.message); }
    if (L.normMachine(info.machineCode) !== machineCode()) throw new Error(`Mã này được cấp cho máy ${L.fmtMachine(info.machineCode)}, không phải máy này (${L.fmtMachine(machineCode())}).`);
    if (info.expiresAt && now() > info.expiresAt) throw new Error('Mã kích hoạt này đã hết hạn.');
    if ((st.revokedIds || []).includes(info.id)) throw new Error('Mã kích hoạt này đã bị thu hồi.');
    st = { ...st, code: clean, activatedAt: now() }; save();
    log(`[kích hoạt] đã kích hoạt mã ${info.id}`);
    return evaluate();
  }
  // Kiểm tra danh sách thu hồi trên mạng; lỗi mạng không làm mất kích hoạt (còn thời gian ân hạn)
  async function checkOnline() {
    try {
      const doc = await fetchJson(url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(now() / 60000));
      st = L.applyRevoked(st, doc, { now: now(), publicX }); save();
      return { ok: true, status: evaluate() };
    } catch (e) {
      log('[kích hoạt] chưa kiểm tra được danh sách thu hồi: ' + e.message);
      return { ok: false, error: e.message, status: evaluate() };
    }
  }
  function publicInfo() {
    const s = evaluate();
    return { machineCode: L.fmtMachine(machineCode()), owner: L.OWNER, status: s.ok ? 'ok' : s.reason, message: s.ok ? null : (s.message || L.REASON_VI[s.reason]),
      name: s.info ? s.info.name : null, id: s.info ? s.info.id : null, expiresAt: s.info ? s.info.expiresAt : null, issuedAt: s.info ? s.info.issuedAt : null,
      lastCheckOk: st.lastCheckOk || null, graceDays: L.GRACE_DAYS, graceLeftMs: s.graceLeftMs ?? null, needOnline: !!s.needOnline };
  }
  return { machineCode, evaluate, activate, checkOnline, publicInfo, get state() { return st; } };
}

module.exports = { createLicenseState };
