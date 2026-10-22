'use strict';
// B165 (máy thật beta.2.8, laptop 4 GB): AIVN AGENT trả lời “xin chào” mất 18,2 s cho 10 token — câu chào cũng chạy cả vòng
// Nghĩ → Xin phép → Làm → Kết quả (lời nhắc hệ thống + mô tả công cụ hàng nghìn token). Câu chào/cảm ơn/hỏi thăm KHÔNG cần công cụ:
//   • chỉ là lời chào / cảm ơn / tạm biệt → câu trả lời có sẵn (0 token, tức thì)
//   • hỏi thăm ngắn (bạn khoẻ không, bạn là ai…) → MỘT lần gọi mô hình không công cụ, lời nhắc hệ thống ngắn
// Câu có việc cần làm (mở/gửi/tìm/tính/nhắc/đọc tệp, tên ứng dụng, đường dẫn, số liệu…) không bao giờ vào đường này.
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
const ADDR = '(?:\\s+(?:ban|bot|aivn(?: agent)?|agent|em|anh|chi|nhe|nha|a|nhieu|lam|ban nhe|ban nha|ban oi|oi|there|buddy))*';
const GREET = new RegExp(`^(?:xin chao|chao|chao ban|hello|hi|hey|alo|halo|yo|good (?:morning|afternoon|evening)|chao buoi (?:sang|trua|chieu|toi))${ADDR}$`);
const THANKS = new RegExp(`^(?:cam on|cam on ban|cảm ơn|thanks?|thank you|tks|thx|ok cam on|oke cam on)${ADDR}$`);
const BYE = new RegExp(`^(?:tam biet|bye|goodbye|see you|hen gap lai|chao tam biet)${ADDR}$`);
const ACK = /^(?:ok|oke|okay|okie|uh|u|um|vang|da|duoc|tot|hay qua|tuyet|good|great|nice|cool)(?:\s+(?:roi|nhe|nha|ban|qua))*$/;
const CHAT = /^(?:ban (?:khoe|co khoe|the nao|dang lam gi|ten (?:la )?gi|la ai|bao nhieu tuoi)|ban co khoe khong|ban khoe khong|how are you|what'?s your name|who are you|ai tao ra ban|ban do ai (?:tao|lam)(?: ra)?)(?:\s+(?:the|vay|khong|ko|a|nhi|nhe|ban))*$/;
const ZH = /^(?:你好|您好|嗨|哈喽|谢谢|多谢|再见|拜拜|你好吗|你是谁)[！!。.？?~～\s]*$/u;
// việc thật: động từ hành động, tên ứng dụng, đường dẫn/URL, số, yêu cầu thông tin
const TASK = /\b(?:mo|gui|nhan|tim|tra|xem|tinh|doc|viet|soan|tao|xoa|dong|tat|bat|chup|nhac|hen|dat|tai|cai|mua|search|open|send|find|read|write|create|delete|close|play|calc|remind|chrome|zalo|edge|word|excel|docs|youtube|facebook|messenger|gia|thoi tiet|lich|file|tep|thu muc)\b|https?:|[\\/]|\d/;
function classify(query) {
  const raw = String(query || '').trim(); if (!raw || raw.length > 60) return null;
  if (ZH.test(raw)) return /谢/.test(raw) ? 'thanks' : /再见|拜拜/.test(raw) ? 'bye' : /你好吗|你是谁/.test(raw) ? 'chat' : 'greet';
  const q = fold(raw).replace(/[!.?~,…:;'"()😊🙂👋❤️]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  if (GREET.test(q)) return 'greet';
  if (THANKS.test(q) || THANKS.test(fold(raw))) return 'thanks';
  if (BYE.test(q)) return 'bye';
  if (ACK.test(q)) return 'ack';
  if (TASK.test(q)) return null;
  if (CHAT.test(q)) return 'chat';
  return null;
}
const CANNED = {
  vi: { greet: 'Chào bạn! Bạn cần mình giúp gì?', thanks: 'Không có gì! Bạn cần gì thêm cứ nói mình nhé.', bye: 'Tạm biệt bạn! Khi cần cứ gọi mình nhé.', ack: 'Vâng. Bạn cần mình làm gì tiếp không?' },
  en: { greet: 'Hi! What can I do for you?', thanks: "You're welcome! Let me know if you need anything else.", bye: 'Goodbye! Call me whenever you need help.', ack: 'Okay. Is there anything else you want me to do?' },
  zh: { greet: '你好！需要我帮你做什么？', thanks: '不客气！还需要什么尽管告诉我。', bye: '再见！需要时随时叫我。', ack: '好的。还需要我做什么吗？' },
};
const canned = (kind, lang = 'vi') => ((CANNED[lang] || CANNED.vi)[kind]) || null;
const SYS = {
  vi: 'Bạn là AIVN AGENT, trợ lý chạy ngay trên máy tính của người dùng. Trả lời thân thiện, NGẮN GỌN (1–2 câu), bằng tiếng Việt. Không gọi công cụ, không bịa việc đã làm.',
  en: "You are AIVN AGENT, an assistant that runs on the user's computer. Reply in a friendly, SHORT way (1–2 sentences), in English. Do not call tools and never claim you did something.",
  zh: '你是 AIVN AGENT，运行在用户电脑上的助手。请用中文友好、简短地回答（1–2 句）。不要调用工具，不要声称做过任何事。',
};
module.exports = { classify, canned, SYS, fold };
