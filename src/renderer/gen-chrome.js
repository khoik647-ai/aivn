// B169: Trò chuyện và AIVN AGENT dùng chung nút Gửi/Dừng, dòng trạng thái và thanh bước.
// Chỉ trang đang tạo câu trả lời được hiện Dừng và dòng “đang…”. Thanh Nghĩ/Xin phép/Làm/Kết quả chỉ thuộc AIVN AGENT.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.planGenChrome = api.planGenChrome; root.composerGate = api.composerGate; root.holdCopy = api.holdCopy; }
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
// Câu nhắc khi không gửi được. Đang đứng trên trang bận thì bảo bấm Dừng ngay dưới ô nhập.
// “Sang trang kia” chỉ khi trang kia mới là trang đang giữ mô hình.
function holdCopy(gate, mode) {
  const here = mode === 'agent' ? 'agent' : 'chat';
  if (gate === 'busy-here' || (gate === 'wait-agent' && here === 'agent') || (gate === 'wait-chat' && here === 'chat')) {
    return here === 'agent' ? 'AGENT đang chạy — bấm Dừng ở dưới' : 'Trò chuyện đang chạy — bấm Dừng ở dưới';
  }
  if (gate === 'wait-agent') return 'AGENT đang chạy — đợi xong hoặc sang AGENT bấm Dừng';
  if (gate === 'wait-chat') return 'Trò chuyện đang chạy — đợi xong hoặc sang Trò chuyện bấm Dừng';
  return '';
}
return { planGenChrome, composerGate, holdCopy };
});
