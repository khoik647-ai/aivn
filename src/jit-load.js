'use strict';
// Nạp theo yêu cầu API (JIT) không huỷ được giữa chừng (loadById chạy đến khi xong).
// Khi client ngắt sau lúc nạp: chỉ gỡ mô hình nếu CHÍNH yêu cầu này bắt đầu nạp
// và không còn người dùng khác — giao diện đã chọn mô hình, hoặc yêu cầu API khác đang giữ.
// Ngược lại để lần nạp chạy hết và giữ mô hình.

function createJitGuard() {
  const holders = new Map(); // id mô hình → số yêu cầu API đang ở trong lần nạp

  function enter(id) {
    holders.set(id, (holders.get(id) || 0) + 1);
  }
  function leave(id) {
    const n = (holders.get(id) || 1) - 1;
    if (n <= 0) holders.delete(id);
    else holders.set(id, n);
  }
  // Gọi khi yêu cầu hiện tại vẫn đang enter(). true → được phép gỡ.
  function shouldUnload(id, { triggered = false, uiSelected = false, busy = false, status = null } = {}) {
    if (!triggered || uiSelected || busy) return false;
    const n = holders.get(id) || 0;
    if (n === 0 || n > 1) return false; // không giữ sổ, hoặc còn yêu cầu API khác
    if (!status || status.loading || !status.loaded) return false;
    const loaded = String(status.id || '');
    const want = String(id);
    if (loaded !== want && !loaded.includes(want)) return false;
    return true;
  }
  return { enter, leave, shouldUnload };
}

module.exports = { createJitGuard };
