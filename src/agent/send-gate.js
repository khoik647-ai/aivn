'use strict';
// B69 (máy thật, beta.2: tin đã được GỬI tới một người thật trên Zalo mà KHÔNG có thẻ xin phép): MỘT chốt duy nhất quyết định
// thao tác nào là GỬI. Mọi đường có thể gửi đều qua đây — type_text kèm submit/xuống dòng (kể cả gõ vào ô đang chọn, chuỗi then[],
// lời gọi công cụ mô hình in ra chữ), phím Enter / Ctrl+Enter / ⌘+Enter / Alt+S sau khi gõ, bấm nút Gửi (có tên hoặc nút biểu tượng
// cạnh ô soạn khi đang mở cuộc trò chuyện). Lỗi cũ: “gõ vào ô tìm kiếm” được đoán theo thời gian (vừa gõ tìm < 60 giây) nên tin nhắn
// gõ ngay sau khi Enter ở ô tìm kiếm mở cuộc trò chuyện bị coi là “tìm kiếm” → không hỏi.
// Quy tắc: đang mở một cuộc trò chuyện (đã kiểm chứng) → mọi chữ kèm Enter là GỬI; chỉ là TÌM khi chữ đúng là tên người nhận (hoặc
// một phần tên), hay không phải việc nhắn tin và ô đích đã xác nhận là ô tìm kiếm.
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const SEND_NAME = /(^|[\s“"'(\[])(gửi|gui|send|sent|发送|發送|传送|傳送|送出|submit tin)(?=$|[\s”"')\].,:!])|nút gửi|send button|send message|gửi tin|➤|➢|✈|paper ?plane/iu;
const ENTERISH = /(^|\+)(enter|return|numpad_enter|kp_enter)$/i;
const SEND_COMBO = /^(?:(?:control|ctrl|cmd|command|meta)\+(?:enter|return)|alt\+s)$/i; // Gmail/Outlook/Teams: Ctrl+Enter, Outlook: Alt+S
const normKeys = (k) => String(k || '').toLowerCase().replace(/\s*\+\s*/g, '+').trim();
// tên người nhận (hoặc một phần, không dấu) — chữ gõ vào ô tìm kiếm khi mở cuộc trò chuyện
function looksLikeRecipient(text, recipient) {
  const t = fold(text); const r = fold(recipient); if (!t || !r) return false;
  return t === r || (t.length >= 2 && r.includes(t)) || (r.length >= 2 && t.startsWith(r) && t.length - r.length <= 2);
}
// state: { chatOpen, recipient, searchTarget (ô đích đã xác nhận là ô tìm kiếm), lastTyped (chữ đã gõ chưa gửi), targetName, inComposerRow }
function classify(action, a = {}, st = {}) {
  const text = String(a.text || '');
  if (action === 'type_text') {
    const enter = !!(a.submit || a.__submit) || /\n\s*$/.test(text);
    if (!enter || !text.trim()) return { send: false };
    if (st.searchTarget && st.recipient && looksLikeRecipient(text, st.recipient) && !/\n./.test(text)) return { send: false, why: 'gõ tên người nhận vào ô tìm kiếm' };
    if (st.searchTarget && !st.chatOpen && !st.recipient && !st.messaging && text.length <= 80 && !/\n./.test(text)) return { send: false, why: 'tìm kiếm (không phải việc nhắn tin)' };
    return { send: true, kind: 'type_enter', text: text.replace(/\n+\s*$/, ''), why: st.chatOpen ? 'gõ chữ rồi Enter trong cuộc trò chuyện đang mở' : 'gõ chữ rồi Enter có thể gửi tin/nộp biểu mẫu' };
  }
  if (action === 'hotkey') {
    const k = normKeys(a.keys);
    if (SEND_COMBO.test(k) && (st.lastTyped || st.chatOpen || st.messaging)) return { send: true, kind: 'hotkey', text: st.lastTyped || '', why: `phím ${a.keys} gửi thư/tin` };
    if (ENTERISH.test(k) && (st.lastTyped || st.chatOpen)) return { send: true, kind: 'hotkey', text: st.lastTyped || '', why: 'bấm Enter sau khi gõ chữ có thể GỬI tin' };
    return { send: false };
  }
  if (action === 'click' || action === 'double_click') {
    const nm = String(st.targetName || '');
    if (SEND_NAME.test(nm)) return { send: true, kind: 'click', text: st.lastTyped || '', why: `bấm “${nm.trim().slice(0, 40)}”` };
    // nút biểu tượng không tên (Zalo/Messenger: mũi tên giấy) ở hàng ô soạn khi đã gõ tin
    if (st.chatOpen && st.lastTyped && st.inComposerRow && (!nm.trim() || /^[\W_]{1,3}$/u.test(nm.trim()))) return { send: true, kind: 'click', text: st.lastTyped, why: 'bấm nút biểu tượng cạnh ô soạn tin' };
    return { send: false };
  }
  return { send: false };
}
// B70: đã bấm gửi (người nhận, nội dung) một lần trong việc này → không bao giờ tự gửi lại
const sendKey = (recipient, text) => `${fold(recipient) || '?'}|${fold(text)}`;
module.exports = { classify, looksLikeRecipient, sendKey, SEND_NAME, SEND_COMBO, normKeys, fold };
