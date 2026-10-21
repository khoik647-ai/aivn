'use strict';
// Kiểm chứng “đã gửi” trên màn hình (B2 + B15, QA 21/10). Chỉ coi là ĐÃ GỬI khi đủ cả ba:
//   1) tên ĐẦY ĐỦ của người nhận nằm ở TIÊU ĐỀ cuộc trò chuyện đang mở (tiêu đề cửa sổ / đầu khung chat / mắt nhìn đọc tiêu đề),
//      không tính danh sách hội thoại bên trái; tên gần giống (“Lê Quỳnh Anh” ≠ “Trần Quỳnh Anh”) không khớp;
//   2) ô soạn tin đã TRỐNG (tin không còn nằm trong ô nhập);
//   3) thấy bong bóng tin vừa gửi trong khung tin nhắn (không tính ô soạn, tiêu đề, danh sách bên trái).
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const HONOR = /^(ban|anh|chi|em|co|chu|bac|ong|ba|me|bo|ma|thay|di|cau|mo|duong|thim|sep|giao su|ts|ths|pgs|mr|mrs|ms|miss)$/;
const STOP = String.raw`(?:trên|ở|qua|bằng|là|rằng|nội dung|với nội dung|tiêu đề|chủ đề|nói|bảo|hỏi|không cần|khỏi|đừng|và|rồi|nhé|nha|giúp|hộ|ngay|lúc|vào|on|via|in|saying|that|about|with)`;
const NOT_NAME = /^(tôi|mình|em|tao|tớ|me|ai|mọi người|tin|tin nhắn|lời|câu|một|email|thư|mail|cho|tới|đến|với|họ|nó|anh ấy|chị ấy|bạn ấy)$/iu;

// tên người nhận trong yêu cầu: “nhắn Trần Quỳnh Anh là…”, “gửi email cho thầy Lê Văn Hùng tiêu đề…”, “Messenger: nhắn Quỳnh Anh "…"”,
// “text Tran Quynh Anh on Messenger: hi”, “gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại”
function recipientOf(query) {
  let q = String(query || '').replace(/\s+/g, ' ').trim();
  const verb = /(?:^|[\s:,.(])(nhắn tin|nhắn|gửi tin nhắn|gửi tin|gửi email|gửi mail|gửi thư|gửi|chat với|chat|trò chuyện với|text|message|msg|send|email|dm)(?=\s)/iu.exec(q);
  if (!verb) return null;
  // phần đầu câu: từ động từ tới chỗ bắt đầu nội dung (là/rằng/:/ngoặc kép/tiêu đề…)
  let head = q.slice(verb.index + verb[0].length);
  const cut = head.search(/\s(?:là|rằng|nội dung|với nội dung|tiêu đề|chủ đề|saying|that)(?=[\s,.:!?]|$)|[:"“”«»]/iu);
  if (cut >= 0) head = head.slice(0, cut);
  const clean = (n) => { n = String(n || '').replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, ''); if (!n || NOT_NAME.test(n) || /^(tôi|mình|tao|tớ|me|ai|họ|nó|mọi|tin|email|thư|mail|file|tệp)$/iu.test(n.split(' ')[0]) || n.split(' ').length > 6) return null; return n; };
  const stopRe = new RegExp(String.raw`\s+${STOP}(?=[\s,.!?:]|$)|[,.!?;]`, 'iu');
  const take = (s) => { const i = s.search(stopRe); return clean(i >= 0 ? s.slice(0, i) : s); };
  // “… cho/tới/đến/với/to <tên>”
  const m = /(?:^|\s)(?:cho|tới|đến|với|to)\s+(.+)$/iu.exec(head);
  if (m) { const n = take(m[1]); if (n) return n; }
  // “nhắn <tên> …” (không có “cho”)
  const rest = head.replace(/^\s*(?:tin(?: nhắn)?\s+)?/iu, '');
  if (/^(?:cho|tới|đến|với|to)\s/iu.test(rest)) return null;
  return take(rest);
}
// bỏ danh xưng: “thầy Lê Văn Hùng” → “le van hung”
function nameKey(name) { const p = fold(name).split(' ').filter(Boolean); while (p.length > 1 && HONOR.test(p[0])) p.shift(); return p.join(' '); }
// tên nằm nguyên vẹn (theo ranh giới từ) trong một dòng tiêu đề
const hasWords = (hay, needle) => !!needle && new RegExp(`(?:^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(fold(hay));
// tiêu đề có đúng người nhận không: tên đầy đủ có trong tiêu đề, và tiêu đề không phải tên người khác dài hơn (“Lê Quỳnh Anh”)
function headerMatches(name, header) {
  const k = nameKey(name); if (!k) return true;
  const h = fold(header); if (!h) return false;
  if (!hasWords(h, k)) return false;
  // người dùng nêu đủ họ tên (≥ 3 chữ) thì tiêu đề phải chứa đủ; nêu tên ngắn (“Quỳnh Anh”) thì chấp nhận tiêu đề dài hơn
  return true;
}
// tương thích cũ: có thấy tên ở đâu đó (CHỈ dùng làm gợi ý, không dùng để kết luận đã gửi)
function nameSeen(name, text) { return hasWords(text, nameKey(name)); }
// thao tác “gửi”: Enter sau khi gõ chữ vào ô soạn tin, bấm nút Gửi/Send, hoặc gõ chữ kết thúc bằng xuống dòng
function isSendAction(action, a = {}, target = '', lastTyped = null) {
  if (action === 'hotkey' && /^(enter|return)$/i.test(String(a.keys || '').trim()) && lastTyped) return true;
  if ((action === 'click' || action === 'double_click') && /(^|\s)(gửi|gui|send)(\s|$)|nút gửi|send button/iu.test(String(target || ''))) return true;
  if (action === 'type_text' && /\n\s*$/.test(String(a.text || '')) && String(a.text).trim()) return true;
  return false;
}
// câu trả lời có cấu trúc của mắt nhìn: “TÊN: …”, “Ô SOẠN: …|TRỐNG”, “TIN: …”
function parseSeen(seen) {
  const out = { header: '', composer: null, messages: [] };
  for (const raw of String(seen || '').split(/\r?\n/)) {
    const l = raw.replace(/^[\s\-*•\d.)]+/, '');
    let m;
    if ((m = /^(?:tên|ten|tiêu đề|header|name)\s*[:：]\s*(.*)$/iu.exec(l))) out.header = m[1].trim();
    else if ((m = /^(?:ô soạn|o soan|ô nhập|composer|input)\s*[:：]\s*(.*)$/iu.exec(l))) out.composer = /^(trống|trong|empty|\(trống\)|không có|-)?$/iu.test(m[1].trim()) ? '' : m[1].trim();
    else if ((m = /^(?:tin|tin nhắn|message|msg)\s*[:：]\s*(.*)$/iu.exec(l))) out.messages.push(m[1].trim());
  }
  return out;
}
// regions: { header: [chữ ở đầu khung chat], composer: [chữ trong ô soạn], messages: [chữ trong khung tin], list: [danh sách trái] }
// (desktop-agent tách theo vị trí trên màn hình); seen: câu trả lời có cấu trúc của mắt nhìn; winTitle: tiêu đề cửa sổ
function verifySend({ msg, recipient, regions = null, seen = '', winTitle = '', screenText = '' }) {
  const m = fold(String(msg || '').split('\n')[0]).slice(0, 40);
  const S = parseSeen(seen); const R = regions || {};
  const headerLines = [winTitle, S.header, ...(R.header || [])].filter(Boolean);
  const composerLines = [...(S.composer != null ? [S.composer] : []), ...(R.composer || [])];
  const msgLines = [...S.messages, ...(R.messages || [])];
  // 1) người nhận ở tiêu đề
  // tiêu đề cửa sổ dạng “Ứng dụng - Tên” là nguồn chắc nhất: nếu nó nêu một cuộc trò chuyện khác thì chắc chắn sai người
  const titleChat = String(winTitle || '').split(/\s+[-–|·]\s+/).map(x => x.trim()).filter(x => x && !/^(zalo|messenger|facebook|telegram|microsoft teams|teams|discord|gmail|signal|whatsapp|skype|line|viber|google chrome|chrome|microsoft edge|firefox|mozilla firefox)$/i.test(x) && !/^\(?\d+\)?$/.test(x));
  const titleWrong = !!(recipient && titleChat.length && !titleChat.some(x => headerMatches(recipient, x)) && String(winTitle).split(/\s+[-–|·]\s+/).length > 1);
  const recipientSeen = !recipient || (!titleWrong && headerLines.some(h => headerMatches(recipient, h)));
  const otherHeader = titleWrong ? titleChat[0] : (headerLines.find(h => fold(h) && !/^(messenger|zalo|telegram|teams|discord|gmail)$/.test(fold(h))) || '');
  // 2) ô soạn trống
  const plainComposer = !regions ? String(screenText || '').split('\n').filter(l => /\[(?:ô nhập|ô soạn|ô văn bản|edit|textbox|composer)\]|\bô (?:nhập|soạn)\b/iu.test(l)) : [];
  const composerHas = !!m && [...composerLines, ...plainComposer].some(c => fold(c).includes(m));
  // 3) bong bóng tin
  let msgSeen = !!m && msgLines.some(x => fold(x).includes(m));
  if (!msgSeen && !regions && !S.messages.length && m) {
    // không tách được vùng: chỉ chấp nhận khi chữ xuất hiện ngoài ô soạn (đếm số lần xuất hiện)
    const all = fold(`${screenText}`); const n = all.split(m).length - 1; msgSeen = n > (composerHas ? 1 : 0);
  }
  const sent = !!msg && recipientSeen && msgSeen && !composerHas;
  const why = !msg ? 'không biết nội dung vừa gửi'
    : composerHas ? `tin “${String(msg).split('\n')[0].slice(0, 40)}” vẫn còn trong ô soạn — CHƯA gửi`
    : !recipientSeen ? `tiêu đề cuộc trò chuyện đang mở không phải “${recipient}”${otherHeader ? ` (đang là “${String(otherHeader).slice(0, 40)}”)` : ''} — có thể đang ở sai cuộc trò chuyện`
    : !msgSeen ? `không thấy bong bóng tin “${String(msg).split('\n')[0].slice(0, 40)}” trong khung tin nhắn sau khi gửi` : '';
  return { sent, msgSeen, recipientSeen, composerEmpty: !composerHas, recipient: recipient || null, why };
}
// tách chữ trên cửa sổ chat theo vị trí: danh sách bên trái (≈30 % chiều rộng), tiêu đề (≈16 % trên cùng của khung phải),
// ô soạn (phần tử nhập liệu, hoặc ≈10 % dưới cùng), còn lại là khung tin nhắn. obs = { win: {b}, elements: [{name,value,b,editable,focused}] }
function regionsOf(obs) {
  const els = (obs && obs.elements || []).filter(e => Array.isArray(e.b) && e.b.length >= 4);
  if (!els.length) return null;
  let W = obs.win && Array.isArray(obs.win.b) && obs.win.b[2] > 50 && obs.win.b[3] > 50 ? obs.win.b : null;
  if (!W) { const x0 = Math.min(...els.map(e => e.b[0])), y0 = Math.min(...els.map(e => e.b[1])), x1 = Math.max(...els.map(e => e.b[0] + e.b[2])), y1 = Math.max(...els.map(e => e.b[1] + e.b[3])); W = [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)]; }
  const rel = (e) => ({ rx: (e.b[0] + e.b[2] / 2 - W[0]) / W[2], ry: (e.b[1] + e.b[3] / 2 - W[1]) / W[3], left: (e.b[0] - W[0]) / W[2] });
  const searchy = (e) => /tìm|tim kiem|search|find/iu.test(`${e.name || ''} ${e.autoId || ''}`);
  const hasRight = els.some(e => rel(e).left >= 0.3);
  const out = { header: [], composer: [], messages: [], list: [] };
  for (const e of els) {
    const { ry, left } = rel(e); const txt = [e.name, e.value].filter(Boolean).join(' ').trim();
    if (!txt) continue;
    if (e.editable || e.focused) { if (!searchy(e)) out.composer.push(e.value != null ? e.value : (e.ocr ? e.name : '')); continue; }
    if (hasRight && left < 0.3) { out.list.push(txt); continue; }
    if (ry < 0.16) out.header.push(txt);
    else if (ry > 0.9 && e.ocr) out.composer.push(txt);
    else out.messages.push(txt);
  }
  out.composer = out.composer.filter(x => x != null);
  return out;
}
// ---- Messenger-style: luôn TÌM và MỞ đúng người nhận trước khi gõ tin (QA lượt 2, f1) ----
const CHAT_APP = /zalo|messenger|facebook|telegram|teams|discord|whatsapp|signal|skype|\bline\b|viber|slack|instagram|wechat|kakao/i;
const isChatContext = (query, proc, title) => CHAT_APP.test(`${proc || ''} ${title || ''}`) || (CHAT_APP.test(String(query || '')) && !/\b(email|e-mail|gmail|outlook|thư)\b/iu.test(String(query || '')));
// chữ gõ vào có phải là tìm người nhận không (gõ tên / một phần tên / không dấu)
function typingName(text, recipient) {
  const t = fold(text); const k = nameKey(recipient); if (!t || !k) return false;
  return t.length <= 60 && (k.includes(t) || t.includes(k));
}
const relates = (q, recipient) => { const a = fold(q), k = nameKey(recipient); return !!a && !!k && (k.includes(a) || a.includes(k)); };
// trả về lời nhắc (chặn) hoặc null (cho gõ). st = { chatOpen, searchTyping }
function chatGate({ query, text, searchField = false, proc = '', title = '', state = {}, header = [] }) {
  const recipient = recipientOf(query);
  if (!recipient || !isChatContext(query, proc, title)) return null;
  if (searchField || typingName(text, recipient)) return null; // đang gõ tên vào ô tìm kiếm
  const k = nameKey(recipient);
  const hdr = header.filter(Boolean);
  if (state.chatOpen === k) {
    // đã mở đúng người, nhưng nếu tiêu đề đọc được mà lại là người khác (vd. ứng dụng tự nhảy cuộc trò chuyện) thì vẫn chặn
    if (hdr.length && !hdr.some(h => headerMatches(recipient, h))) return `Tiêu đề cuộc trò chuyện hiện là “${String(hdr[0]).slice(0, 40)}”, không phải “${recipient}”. Tìm lại “${recipient}” trong ô tìm kiếm của ứng dụng, bấm vào đúng kết quả rồi mới gõ tin.`;
    return null;
  }
  return `CHƯA gõ tin: AIVN AGENT phải TÌM và MỞ cuộc trò chuyện với “${recipient}” trước, không gõ vào cuộc trò chuyện đang mở sẵn${hdr.length ? ` (đang mở: “${String(hdr[0]).slice(0, 40)}”)` : ''}. Làm lần lượt: 1) screen_act click vào ô Tìm kiếm của ứng dụng; 2) type_text "${recipient}"; 3) click vào kết quả đúng tên “${recipient}”; 4) rồi mới gõ tin nhắn.`;
}
const SEEN_QUESTION = 'Trả lời đúng định dạng, chép đúng chữ trên màn hình:\nTÊN: <tên người/nhóm ở đầu khung trò chuyện đang mở>\nÔ SOẠN: <chữ còn trong ô soạn tin, hoặc TRỐNG>\nTIN: <tin nhắn cuối cùng trong khung trò chuyện>\nTIN: <tin nhắn trước đó>';
module.exports = { chatGate, typingName, relates, isChatContext, regionsOf, recipientOf, nameSeen, nameKey, headerMatches, isSendAction, verifySend, parseSeen, SEEN_QUESTION, fold };
