// B169: Trò chuyện và AIVN AGENT dùng chung nút Gửi/Dừng, dòng trạng thái và thanh bước.
// Chỉ trang đang tạo câu trả lời được hiện Dừng và dòng “đang…”. Thanh Nghĩ/Xin phép/Làm/Kết quả chỉ thuộc AIVN AGENT.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.planGenChrome = api.planGenChrome;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function planGenChrome({ mode, genKind, genPhase, genNote, agentFoot }) {
    const here = mode === 'agent' ? 'agent' : 'chat';
    const live = !!genKind && genKind === here;
    const phase = here === 'agent' && genKind === 'agent' ? (genPhase || null) : null;
    const stats = live ? (genNote || '') : (here === 'agent' && !genKind ? (agentFoot || '') : '');
    return { sendHidden: live, stopHidden: !live, phase, genStats: stats };
  }
  return { planGenChrome };
});
