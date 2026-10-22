// B177: thẻ xin phép chỉ hiện và chỉ bấm được trên trang AIVN AGENT.
// Trò chuyện không được Cho phép/Từ chối, kể cả bằng Ctrl+Enter hoặc Esc.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApproveGate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function cardVisible(agentMode, cardHidden) {
    return !!agentMode && !cardHidden;
  }
  function hintVisible(agentMode, waiting) {
    return !agentMode && !!waiting;
  }
  // Phím tắt và nút trên thẻ chỉ có tác dụng khi đang ở AIVN AGENT và thẻ đang hiện hoặc đang được trỏ vào.
  function approveOperable({ viewActive, agentMode, cardHidden, focused } = {}) {
    if (!viewActive || !agentMode) return false;
    if (cardHidden && !focused) return false;
    return true;
  }
  return { cardVisible, hintVisible, approveOperable };
});
