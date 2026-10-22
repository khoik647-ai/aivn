// B173: chữ đang stream ở Trò chuyện bị đơ sau khi sang AIVN AGENT rồi quay lại.
// Đổi trang gọi renderMessages() — nút .body lấy lúc bắt đầu lượt bị gỡ khỏi tài liệu,
// token vẫn cộng vào nội dung nhưng paint ghi vào nút cũ nên màn hình chỉ nhảy một lần khi lượt kết thúc.
// B178: việc AGENT mới chưa lưu cũng mất khi AGENT → Trò chuyện → AGENT, vì generatingConv chỉ giữ cuộc chat.
// Các hàm này thuần (không DOM sẵn): chọn cuộc đang chạy của đúng trang, và chỉ trả nút .body còn gắn trên khung đang xem.
(function (root) {
  'use strict';
  function modeOf(c) { return c && c.mode === 'agent' ? 'agent' : 'chat'; }
  function modeKey(mode) { return mode === 'agent' ? 'agent' : 'chat'; }
  // generatingByMode = { chat, agent }: mỗi trang một object đang chạy (chưa lưu, hoặc mới hơn bản trên đĩa).
  // Không có map thì dùng generating (một object) — đường B173.
  function generatingFor(mode, generating, generatingByMode) {
    const m = modeKey(mode);
    if (generatingByMode && typeof generatingByMode === 'object' && Object.prototype.hasOwnProperty.call(generatingByMode, m)) {
      const g = generatingByMode[m];
      return g && modeOf(g) === m ? g : null;
    }
    return generating && modeOf(generating) === m ? generating : null;
  }
  // generating = object cuộc đang ghi token (có thể chưa lưu, hoặc khác bản vừa đọc từ đĩa).
  function convoForMode({ mode, id, convos, generating, generatingByMode } = {}) {
    const list = Array.isArray(convos) ? convos : [];
    const m = modeKey(mode);
    const live = generatingFor(m, generating, generatingByMode);
    if (live && id != null && live.id === id) return live;
    return list.find(c => c && c.id === id && modeOf(c) === m) || null;
  }
  // Danh sách thanh bên của một trang, kể cả việc đang chạy chưa lưu.
  function listForMode({ mode, convos, generating, generatingByMode } = {}) {
    const m = modeKey(mode);
    const list = Array.isArray(convos) ? convos : [];
    let mine = list.filter(c => c && modeOf(c) === m);
    const gen = generatingFor(m, generating, generatingByMode);
    if (gen && !mine.some(c => c.id === gen.id)) mine = [gen, ...mine];
    return mine;
  }
  // Hết lượt: lưu xong thì chọn lại đúng việc nếu đang ở trang đó và chưa mở việc khác.
  // Đang xem trang kia, hoặc đã chọn một cuộc khác, thì giữ nguyên.
  // explicitNew: người dùng bấm “＋ Việc mới” trong lúc lượt đang chạy — không kéo về việc đó.
  function selectAfterRun({ visibleMode, current, conv, convos, explicitNew } = {}) {
    const list = Array.isArray(convos) ? convos : [];
    const saved = (conv && list.find(c => c && c.id === conv.id)) || conv || null;
    if (!conv || modeOf(conv) !== modeKey(visibleMode)) return { current: current || null, saved, selected: false };
    const viewing = !!(current && (current === conv || current.id === conv.id));
    if (explicitNew && !viewing) return { current: current || null, saved, selected: false };
    if (viewing || !current) return { current: saved, saved, selected: true };
    return { current, saved, selected: false };
  }
  // query(index) → phần tử .msg đang gắn tài liệu, hoặc null. Không bao giờ trả nút đã gỡ, không đụng tin của chế độ kia.
  function streamBody({ query, conv, visible, visibleMode, index } = {}) {
    if (!conv || visible !== conv) return null;
    if (modeOf(conv) !== (visibleMode === 'agent' ? 'agent' : 'chat')) return null;
    if (!Number.isInteger(index) || index < 0) return null;
    if (typeof query !== 'function') return null;
    const el = query(index);
    if (!el || el.isConnected === false) return null;
    const body = typeof el.querySelector === 'function' ? el.querySelector('.body') : null;
    if (!body || body.isConnected === false) return null;
    return body;
  }
  // B184: dấu đang chạy trên thanh bên — đúng cuộc đang stream, hết khi map được xoá (xong / dừng / lỗi).
  function isRunning(c, generatingByMode) {
    if (!c || c.id == null || !generatingByMode) return false;
    return ['chat', 'agent'].some((k) => generatingByMode[k] && generatingByMode[k].id === c.id);
  }
  function runBadge(on) {
    return on ? '<span class="convo-run" role="status" title="Đang chạy" aria-label="Đang chạy"></span>' : '';
  }
  const api = { modeOf, generatingFor, convoForMode, listForMode, selectAfterRun, streamBody, isRunning, runBadge };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ChatStream = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
