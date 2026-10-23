'use strict';
// Nạp theo yêu cầu API (JIT) không huỷ được giữa chừng (loadById chạy đến khi xong).
// Khi client ngắt sau lúc nạp: chỉ gỡ mô hình nếu lần nạp do API bắt đầu, mọi yêu cầu
// đang giữ đều đã ngắt, và không còn người dùng khác (giao diện vừa chọn, hoặc đang sinh câu trả lời).
// Khớp đúng id đang nạp — không so theo chuỗi con.

function createJitGuard() {
  const holders = new Map(); // id mô hình → số yêu cầu API đang ở trong lần nạp
  const meta = new Map(); // id → { aborted, apiStarted, survived }

  function slot(id) {
    let m = meta.get(id);
    if (!m) { m = { aborted: 0, apiStarted: false, survived: false }; meta.set(id, m); }
    return m;
  }
  function enter(id, opts = {}) {
    holders.set(id, (holders.get(id) || 0) + 1);
    if (opts && opts.triggered) slot(id).apiStarted = true;
    else slot(id);
  }
  function noteAbort(id) { slot(id).aborted += 1; }
  function leave(id, opts = {}) {
    const n = (holders.get(id) || 1) - 1;
    const m = meta.get(id);
    if (m) {
      if (opts && opts.aborted) m.aborted = Math.max(0, m.aborted - 1);
      else m.survived = true;
    }
    if (n <= 0) { holders.delete(id); meta.delete(id); }
    else holders.set(id, n);
  }
  function state(id) {
    const m = meta.get(id) || { aborted: 0, apiStarted: false, survived: false };
    return { n: holders.get(id) || 0, aborted: m.aborted, apiStarted: m.apiStarted, survived: m.survived };
  }
  // Gọi khi yêu cầu hiện tại vẫn đang enter(). true → được phép gỡ.
  function shouldUnload(id, { triggered = false, uiSelected = false, busy = false, status = null, allAborted = true, uiActive = false } = {}) {
    if (!triggered || uiSelected || busy || uiActive) return false;
    if (allAborted === false) return false;
    const n = holders.get(id) || 0;
    if (n === 0 || n > 1) return false; // không giữ sổ, hoặc còn yêu cầu API khác
    if (!status || status.loading || !status.loaded) return false;
    if (String(status.id || '') !== String(id)) return false;
    return true;
  }
  return { enter, leave, shouldUnload, noteAbort, state };
}

module.exports = { createJitGuard };
