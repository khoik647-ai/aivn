// B169: Trò chuyện và AIVN AGENT dùng chung nút Gửi/Dừng, dòng trạng thái và thanh bước.
// Chỉ trang đang tạo câu trả lời được hiện Dừng và dòng “đang…”. Thanh Nghĩ/Xin phép/Làm/Kết quả chỉ thuộc AIVN AGENT.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.planGenChrome = api.planGenChrome; root.composerGate = api.composerGate; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function planGenChrome({ mode, genKind, genPhase, genNote, agentFoot }) {
    const here = mode === 'agent' ? 'agent' : 'chat';
    const live = !!genKind && genKind === here;
    const phase = here === 'agent' && genKind === 'agent' ? (genPhase || null) : null;
    const stats = live ? (genNote || '') : (here === 'agent' && !genKind ? (agentFoot || '') : '');
    return { sendHidden: live, stopHidden: !live, phase, genStats: stats };
  }
  // B176: Enter trên trang đang rảnh. Trò chuyện luôn dùng mô hình trên máy; AIVN AGENT chỉ giữ mô hình đó khi không bật bộ não đám mây.
  function composerGate({ mode, generating, genKind, cloudAgent }) {
    const here = mode === 'agent' ? 'agent' : 'chat';
    if (!generating) return 'send';
    if (!genKind || genKind === here) return 'busy-here';
    const other = genKind === 'chat' || genKind === 'agent' ? genKind : null;
    if (!other) return 'busy-here';
    const usesLocal = (k) => k === 'chat' || (k === 'agent' && !cloudAgent);
    if (usesLocal(other) && usesLocal(here)) return other === 'agent' ? 'wait-agent' : 'wait-chat';
    return 'send';
  }
  return { planGenChrome, composerGate };
});
