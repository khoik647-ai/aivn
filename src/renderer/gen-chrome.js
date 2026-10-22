// B169: Trò chuyện và AIVN AGENT dùng chung nút Gửi/Dừng, dòng trạng thái và thanh bước.
// Chỉ trang đang tạo câu trả lời được hiện Dừng và dòng “đang…”. Thanh Nghĩ/Xin phép/Làm/Kết quả chỉ thuộc AIVN AGENT.
// B184: việc trống (chưa chạy, chưa có bước) không hiện Dừng hay thanh bước. Dòng “N bước · … giây” chỉ của việc đang xem.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.planGenChrome = api.planGenChrome; root.composerGate = api.composerGate; root.holdCopy = api.holdCopy; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function planGenChrome({ mode, genKind, genPhase, genNote, agentFoot, viewingRun, hasSteps, showFoot } = {}) {
    const here = mode === 'agent' ? 'agent' : 'chat';
    const live = !!genKind && genKind === here;
    // viewingRun === false: lượt đang chạy nhưng người dùng đang xem việc khác / việc trống. Bỏ qua thì coi như đang xem đúng lượt.
    const onRun = viewingRun === false ? false : live;
    let phase = null;
    if (here === 'agent' && onRun) phase = genPhase || null;
    else if (here === 'agent' && hasSteps) phase = 'done';
    const foot = showFoot === false ? '' : (agentFoot || '');
    const stats = onRun ? (genNote || '') : (here === 'agent' && !genKind ? foot : '');
    return { sendHidden: onRun, stopHidden: !onRun, phase, genStats: stats };
  }
  // B176: Enter trên trang đang rảnh. Trò chuyện luôn dùng mô hình trên máy; AIVN AGENT chỉ giữ mô hình đó khi không bật bộ não đám mây.
  function composerGate({ mode, generating, genKind, cloudAgent, viewingRun } = {}) {
    const here = mode === 'agent' ? 'agent' : 'chat';
    if (!generating) return 'send';
    // B184: cùng trang nhưng đang xem việc trống / việc khác — nút Dừng không nằm dưới ô nhập.
    if (viewingRun === false && genKind === here) return 'busy-other';
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
    if (gate === 'busy-other') return 'Việc đang chạy ở danh sách bên trái — mở việc đó rồi bấm Dừng';
    if (gate === 'busy-here' || (gate === 'wait-agent' && here === 'agent') || (gate === 'wait-chat' && here === 'chat')) {
      return here === 'agent' ? 'AGENT đang chạy — bấm Dừng ở dưới' : 'Trò chuyện đang chạy — bấm Dừng ở dưới';
    }
    if (gate === 'wait-agent') return 'AGENT đang chạy — đợi xong hoặc sang AGENT bấm Dừng';
    if (gate === 'wait-chat') return 'Trò chuyện đang chạy — đợi xong hoặc sang Trò chuyện bấm Dừng';
    return '';
  }
  return { planGenChrome, composerGate, holdCopy };
});
