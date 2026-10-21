'use strict';
// Kiểm chứng “đã gửi” trên màn hình (B2, QA 21/10): chỉ khi THẤY tin vừa gửi trong khung chat và THẤY tên người nhận
// (nếu người dùng nêu tên) thì mới được coi là đã gửi. Dùng cho desktop-agent (sau thao tác gửi) và agent.js (chặn câu báo giả).
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();

// “gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại” → “trần quỳnh anh”
function recipientOf(query) {
  const q = String(query || '').replace(/\s+/g, ' ');
  if (!/(gửi|nhắn|chat|trò chuyện|send|message)/iu.test(q)) return null;
  const m = q.match(/(?:^|\s)(?:cho|tới|đến|với|to)\s+(.+?)(?=\s+(?:trên|ở|qua|bằng|là|rằng|nội dung|nói|với nội dung|không cần|đừng|và|rồi|nhé|nha|giúp|hộ|ngay|lúc)(?=[\s,.!?:]|$)|[,.!?:;"“]|$)/iu);
  if (!m) return null;
  const n = m[1].trim();
  if (/^(tôi|mình|em|tao|tớ|me|ai|mọi người)$/iu.test(n)) return null;
  if (n.split(' ').length > 5) return null;
  return n;
}
// có thấy tên người nhận không: cả tên, hoặc ≥ 2 chữ cuối của tên (Zalo hay hiện “Quỳnh Anh”), có dấu hoặc không dấu
function nameSeen(name, text) {
  const t = fold(text); const parts = fold(name).split(' ').filter(Boolean);
  if (parts.length >= 2 && /^(ban|anh|chi|em|co|chu|bac|ong|ba|me|bo|ma|thay)$/.test(parts[0])) parts.shift(); // “chị Hoa” → “hoa”
  if (!parts.length) return true;
  if (t.includes(parts.join(' '))) return true;
  return parts.length >= 3 && t.includes(parts.slice(-2).join(' '));
}
// thao tác “gửi”: Enter sau khi gõ chữ vào ô soạn tin, bấm nút Gửi/Send, hoặc gõ chữ kết thúc bằng xuống dòng
function isSendAction(action, a = {}, target = '', lastTyped = null) {
  if (action === 'hotkey' && /^(enter|return)$/i.test(String(a.keys || '').trim()) && lastTyped) return true;
  if ((action === 'click' || action === 'double_click') && /(^|\s)(gửi|gui|send)(\s|$)|nút gửi|send button/iu.test(String(target || ''))) return true;
  if (action === 'type_text' && /\n\s*$/.test(String(a.text || '')) && String(a.text).trim()) return true;
  return false;
}
function verifySend({ msg, recipient, screenText = '', seen = '', winTitle = '' }) {
  const all = `${winTitle}\n${screenText}\n${seen}`;
  const m = fold(String(msg || '').split('\n')[0]).slice(0, 30);
  const msgSeen = !!m && fold(all).includes(m);
  const recipientSeen = !recipient || nameSeen(recipient, all);
  const why = !msg ? 'không biết nội dung vừa gửi' : !msgSeen ? `không thấy “${String(msg).split('\n')[0].slice(0, 40)}” trong khung trò chuyện sau khi gửi` : !recipientSeen ? `không thấy tên người nhận “${recipient}” trên màn hình — có thể đang ở sai cuộc trò chuyện` : '';
  return { sent: msgSeen && recipientSeen, msgSeen, recipientSeen, recipient: recipient || null, why };
}
module.exports = { recipientOf, nameSeen, isSendAction, verifySend, fold };
