// B173: chữ đang stream ở Trò chuyện bị đơ sau khi sang AIVN AGENT rồi quay lại.
// Đổi trang gọi renderMessages() — nút .body lấy lúc bắt đầu lượt bị gỡ khỏi tài liệu,
// token vẫn cộng vào nội dung nhưng paint ghi vào nút cũ nên màn hình chỉ nhảy một lần khi lượt kết thúc.
// Hai hàm này thuần (không DOM sẵn): chọn lại đúng cuộc đang stream, và chỉ trả nút .body còn gắn trên khung đang xem.
(function (root) {
  'use strict';
  function modeOf(c) { return c && c.mode === 'agent' ? 'agent' : 'chat'; }
  // generating = object cuộc trò chuyện mà lượt chat đang ghi token vào (có thể chưa lưu, hoặc khác bản vừa đọc từ đĩa).
  function convoForMode({ mode, id, convos, generating } = {}) {
    const list = Array.isArray(convos) ? convos : [];
    if (generating && id != null && generating.id === id && modeOf(generating) === mode) return generating;
    return list.find(c => c && c.id === id && modeOf(c) === mode) || null;
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
  const api = { modeOf, convoForMode, streamBody };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ChatStream = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
