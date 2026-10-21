'use strict';
// Kiểm chứng “đã gửi” trên màn hình (B2 + B15, QA 21/10). Chỉ coi là ĐÃ GỬI khi đủ cả ba:
//   1) tên ĐẦY ĐỦ của người nhận nằm ở TIÊU ĐỀ cuộc trò chuyện đang mở (tiêu đề cửa sổ / đầu khung chat / mắt nhìn đọc tiêu đề),
//      không tính danh sách hội thoại bên trái; tên gần giống (“Lê Quỳnh Anh” ≠ “Trần Quỳnh Anh”) không khớp;
//   2) ô soạn tin đã TRỐNG (tin không còn nằm trong ô nhập);
//   3) thấy bong bóng tin vừa gửi trong khung tin nhắn (không tính ô soạn, tiêu đề, danh sách bên trái).
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const HONOR = /^(ban|anh|chi|em|co|chu|bac|ong|ba|me|bo|ma|thay|di|cau|mo|duong|thim|sep|giao su|ts|ths|pgs|mr|mrs|ms|mx|miss|dr|prof)$/;
const STOP = String.raw`(?:trên|ở|qua|bằng|là|rằng|nội dung|với nội dung|tiêu đề|chủ đề|nói|bảo|hỏi|nhắc|chúc|mời|không cần|khỏi|đừng|và|rồi|nhé|nha|giúp|hộ|ngay|lúc|vào|on|via|in|saying|that|about|with|an email|an e-mail|a message|a text|a note)`;
const NOT_NAME = /^(tôi|mình|em|tao|tớ|me|ai|mọi người|tin|tin nhắn|lời|câu|một|email|thư|mail|cho|tới|đến|với|họ|nó|anh ấy|chị ấy|bạn ấy)$/iu;

// tên người nhận trong yêu cầu: “nhắn Trần Quỳnh Anh là…”, “gửi email cho thầy Lê Văn Hùng tiêu đề…”, “Messenger: nhắn Quỳnh Anh "…"”,
// “text Tran Quynh Anh on Messenger: hi”, “gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại”
// B58 (QA lượt 7): “Mr./Dr.” — dấu chấm của danh xưng không phải dấu hết câu; danh xưng tiếng Anh bỏ khỏi tên để tìm (“Mr. Le Van Hung” → “Le Van Hung”)
const EN_HONOR_DOT = /\b(Mr|Mrs|Ms|Mx|Dr|Prof|Miss)\.(?=\s)/gi;
const EN_HONOR_LEAD = /^(?:mr|mrs|ms|mx|dr|prof|miss)\.?\s+(?=\S)/iu;
// B61 (máy thật, “nhắn giúp mình là mai 8h họp nhé”): “giúp/hộ/cho mình” là NGƯỜI DÙNG, không phải người nhận; cụm bắt đầu bằng từ mở đầu nội dung
// (là/rằng/nội dung/saying/that…) hay “a message for me” không phải tên → không có người nhận → hỏi “Gửi cho ai?”
const NOT_RECIPIENT = /^(?:(?:là|rằng|nội dung|với nội dung|tiêu đề|saying|that|about)(?:\s|$)|(?:a|an|the|my)\s+(?:message|email|e-mail|mail|text|note|dm)\b|(?:for|to)\s+(?:me|myself|us)\b|(?:giúp|hộ|giùm|dùm|cho)\s+(?:mình|tôi|em|tớ|tao)(?:\s|$)|(?:mình|tôi|tớ|tao|me|myself)(?:\s|$)|(?:nhắc|chúc|hỏi|báo|mời|xin|về|thông báo|lịch|nhờ)\s|(?:nhé|nha|nhá|đi|ngay|luôn|giúp|hộ|giùm|với|thầy|cô|anh|chị|em|bạn|sếp|mr|mrs|ms|dr)$)/iu;
function recipientOf(query) {
  const r = recipientOf0(String(query || '').replace(EN_HONOR_DOT, '$1')); if (!r) return r;
  if (NOT_RECIPIENT.test(String(r).trim())) return null;
  const x = stripHonorAfter(r) || r; const y = x.replace(EN_HONOR_LEAD, '').trim(); return y || x;
}
// B36/B47: “nói với X là…”, “bảo X là…”, “dặn/báo X là…”, “nhắn giúp/hộ/giùm X…”, “tell X (that) …”, “let X know …”, “inform/ask X to …”
const CAP = String.raw`[A-ZÀ-ỸĐ][\p{L}'’.-]*`;
const APP_NAME = /^(?:zalo|messenger|facebook|telegram|teams|microsoft teams|discord|gmail|outlook|google|chatgpt|gemini|copilot|siri|aivn|aivn agent|slack|whatsapp|viber|skype)$/i;
const ci = (w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`;
const VI_SAY = `(?:${['chúc mừng sinh nhật', 'chúc mừng', 'cảm ơn', 'xin lỗi', 'trả lời', 'hồi âm', 'nói với', 'nói', 'bảo', 'dặn', 'nhắc', 'hỏi', 'chúc', 'báo cho', 'mời'].map(ci).join('|')})`;
function sayTo(q) {
  let m = /(?:^|[\s:,.(])(?:nói|bảo|dặn|báo|nhắc|hỏi|trả lời|hồi âm)\s+(?:với\s+|cho\s+|lại\s+(?:với\s+|cho\s+)?)?(.+?)\s+(?:là|rằng|về việc|chuyện)(?=[\s,.:!?]|$)/iu.exec(q);
  if (m && !APP_NAME.test(m[1].trim())) return m[1];
  // B59 (QA lượt 7): không có “là”: “dặn Quỳnh Anh mai mang laptop”, “nói Quỳnh Anh mai 8h…”, “hỏi Trần Quỳnh Anh xem…”, “chúc mừng sinh nhật Trần Quỳnh Anh giúp mình”
  // — tên = cụm chữ VIẾT HOA liền sau động từ (giữ danh xưng thầy/cô/anh/chị…); tên viết thường thì không đoán (hỏi lại người dùng)
  m = new RegExp(String.raw`(?:^|[\s:,.(])${VI_SAY}\s+(?:(?:với|cho|lại|giùm|giúp|hộ)\s+)?((?:(?:thầy|cô|anh|chị|em|bạn|bác|chú|ông|bà)\s+)?${CAP}(?:\s+${CAP}){0,4})(?=[\s,.:!?;]|$)`, 'u').exec(q);
  if (m && !APP_NAME.test(m[1].trim())) return m[1];
  m = /(?:^|[\s:,.(])(?:nhắn|gửi)\s+(?:tin\s+(?:nhắn\s+)?)?(?:giúp|hộ|giùm|dùm)\s+(?:mình\s+|tôi\s+|em\s+)?(?:cho\s+|tới\s+|đến\s+|với\s+)?(.+?)(?=\s+(?:là|rằng|nội dung|trên|qua|ở|bằng)(?=[\s,.:!?]|$)|[:"“”«»,.!?]|$)/iu.exec(q);
  if (m) return m[1];
  m = new RegExp(String.raw`(?:^|[\s:,.(])[Ll]et\s+(${CAP}(?:\s+${CAP}){0,5})\s+know\b`, 'u').exec(q);
  if (m) return m[1];
  m = new RegExp(String.raw`(?:^|[\s:,.(])(?:[Tt]ell|[Ii]nform|[Aa]sk|[Rr]emind|[Pp]ing|[Nn]otify)\s+(${CAP}(?:\s+${CAP}){0,5})(?=\s|[,.:!?]|$)`, 'u').exec(q);
  if (m) { const n = m[1].replace(/(?:\s+(?:I|We|You|He|She|They|It|That|Tomorrow|Today))+$/u, ''); if (n && !/^(?:me|him|her|them|us|everyone|I)$/i.test(n)) return n; }
  m = /(?:^|[\s:,.(])(?:tell|inform|remind|ask|let)\s+((?:mr|mrs|ms|dr|teacher)\.?\s+\S+(?:\s+\S+){0,3}?)(?=\s+(?:that|know|to|i|we|about)\b|[,.:!?]|$)/iu.exec(q);
  if (m) return m[1];
  return null;
}
function recipientOf0(query) {
  let q = String(query || '').replace(/\s+/g, ' ').trim();
  { const mk = /\(người nhận: ([^()]{1,80})\)\s*$/u.exec(q); if (mk) return mk[1].trim(); } // câu trả lời của người dùng cho “Gửi cho ai?”
  // B31 (QA lượt 5): câu tiếng Trung — 给 X 发消息/发信息/发微信 · 发(消息/信息)给 X · 告诉 X · 跟/和 X 说 · 私信 X
  const zh = /(?:给|向)\s*([^\s，。、：:"“”给向][^，。、：:"“”]{0,40}?)\s*(?:发|发送|傳|传)(?:一[条條]|个)?\s*(?:消息|信息|短信|讯息|訊息|微信|邮件|郵件|私信)/u.exec(q)
    || /(?:发|发送)(?:一[条條])?\s*(?:消息|信息|短信|邮件|私信)?\s*给\s*([^，。、：:"“”]{1,40}?)(?=\s*(?:[，。、：:"“”]|说|，|$))/u.exec(q)
    || /(?:告诉|跟|和|私信)\s*([^，。、：:"“”]{1,40}?)\s*(?:说|讲|：|:|，)/u.exec(q);
  // “告诉 Trần Quỳnh Anh 明天…” (không có dấu câu): tên Latinh/tiếng Việt kết thúc ở chữ Hán đầu tiên
  const zhLatin = !zh && /(?:告诉|跟|和|私信|给|发给|通知|提醒)\s*((?:[A-Za-zÀ-ỹĐđ][A-Za-zÀ-ỹĐđ'’.-]*)(?:\s+[A-Za-zÀ-ỹĐđ][A-Za-zÀ-ỹĐđ'’.-]*){0,5})\s*(?=[\u3400-\u9fff，。：:！!？?]|$)/u.exec(q);
  if (zhLatin && !/^(?:messenger|zalo|telegram|teams|facebook|discord|gmail|outlook|email)$/i.test(zhLatin[1].trim())) return zhLatin[1].trim();
  if (zh) { const n = zh[1].replace(/^(?:在\s*\S+\s*上\s*)/u, '').replace(/\s*(?:在|用|通过)\s*\S+\s*上?$/u, '').trim(); if (n && n.split(' ').length <= 6) return n; }
  // T1a: “gửi 'AIVN test 1' vào nhóm 'AIVN test'” / “… vào nhóm Zalo "X"” / “send 'x' to the group 'Y'” — tên nhóm sau “vào/tới/cho nhóm”
  const grpQ = /(?:vào|tới|đến|cho|lên|trong|to|in|into)\s+(?:the\s+)?(?:nhóm|group|kênh|channel|cuộc trò chuyện|đoạn chat|chat)\s+(?:(?:zalo|messenger|telegram|teams|discord|slack|whatsapp|viber)\s+)?["“'‘«]([^"”'’»]{1,60})["”'’»]/iu.exec(q);
  if (grpQ && grpQ[1].trim()) return grpQ[1].trim();
  const grp = /(?:vào|tới|đến|lên|trong|to|into)\s+(?:the\s+)?((?:nhóm|group)\s+[^,.!?:;"“”'‘’«»]{1,50}?)(?=\s+(?:trên|qua|bằng|ở|với nội dung|nội dung|là|rằng|on|via|saying)(?=[\s,.:!?]|$)|[,.!?:;"“”«»]|$)/iu.exec(q);
  if (grp && grp[1].trim().split(' ').length <= 7) return grp[1].trim().replace(/\s+(?:zalo|messenger|telegram)$/i, '');
  { const st = sayTo(q); if (st) { const n = String(st).replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, '').replace(/\s+(?:trên|qua|ở|bằng|on|via|in)\s+(?:zalo|messenger|telegram|teams|microsoft teams|facebook|discord|slack|whatsapp|viber)$/iu, ''); if (n && !NOT_NAME.test(n) && n.split(' ').length <= 6 && !/^(?:tôi|mình|em|tao|tớ|me|i|họ|nó|mọi người|everyone)$/iu.test(n)) return n; } }
  const verb = /(?:^|[\s:,.(])(nhắn tin|nhắn|gửi tin nhắn|gửi tin|gửi email|gửi mail|gửi thư|gửi|chat với|chat|trò chuyện với|text|message|msg|send|email|dm)(?=\s)/iu.exec(q);
  if (!verb) return null;
  // phần đầu câu: từ động từ tới chỗ bắt đầu nội dung (là/rằng/:/ngoặc kép/tiêu đề…)
  let head = q.slice(verb.index + verb[0].length).replace(/^\s+(?:giúp|hộ|giùm|dùm)(?:\s+(?:mình|tôi|em))?(?=\s)/iu, '');
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
// T1a: “nhóm AIVN test” / “group AIVN test” — chữ “nhóm/group” là loại cuộc trò chuyện, không phải tên (tiêu đề Zalo chỉ hiện “AIVN test”)
const GROUP_WORD = /^(?:nhom|group|kenh|channel)$/;
// B48: danh xưng đứng SAU tên (王老师, “Lê Văn Hùng 老师”, “Hung teacher”, “Smith sir”) — không phải một phần của tên
const HONOR_AFTER = /(?:\s*(?:老师|老師|先生|女士|小姐|同学|同學|教授|博士|经理|經理|总|總)|\s+(?:teacher|sir|madam|ma'am|thầy|cô))$/iu;
// QA lượt 7 (B59): “王老师” — chỉ còn họ (1–2 chữ Hán) thì GIỮ danh xưng: tên hiển thị là “王老师”, bỏ đi thành “王” sẽ khớp nhầm mọi người họ Vương
const stripHonorAfter = (n) => { let x = String(n || '').trim(); for (let i = 0; i < 2; i++) { const y = x.replace(HONOR_AFTER, '').trim(); if (!y || y === x) break; if (/^[\u3400-\u9fff]{1,2}$/u.test(y)) break; x = y; } return x; };
function nameKey(name) { const p = fold(stripHonorAfter(name)).split(' ').filter(Boolean); while (p.length > 1 && (HONOR.test(p[0]) || GROUP_WORD.test(p[0]))) p.shift(); return p.join(' '); }
// tên nằm nguyên vẹn (theo ranh giới từ) trong một dòng tiêu đề
const hasWords = (hay, needle) => !!needle && new RegExp(`(?:^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(fold(hay));
// B20 (QA lượt 3): chú thích trong ngoặc ở tiêu đề (“Lê Văn Hùng (SV K26)”, “Trần Quỳnh Anh (Cựu SV)”) là dấu hiệu một NGƯỜI KHÁC
// trùng tên → không khớp, trừ khi người dùng nêu đúng chú thích đó. Danh xưng người dùng nêu (“thầy”) mà tiêu đề có danh xưng KHÁC → không khớp.
const parenNotes = (s) => (String(s || '').match(/[(（\[]([^)）\]]{1,40})[)）\]]/g) || []).map(x => fold(x)).filter(Boolean);
const titleOf = (name) => { const p = fold(name).split(' ').filter(Boolean); const out = []; while (p.length > 1 && HONOR.test(p[0])) out.push(p.shift()); return out.join(' '); };
// tiêu đề có đúng người nhận không: tên đầy đủ có trong tiêu đề (theo ranh giới từ), không có chú thích trong ngoặc mà người dùng không nêu
function headerMatches(name, header) {
  const k = nameKey(name); if (!k) return true;
  const raw = String(header || ''); const h = fold(raw); if (!h) return false;
  if (!hasWords(h, k)) return false;
  // chú thích trong ngoặc NGAY SAU tên (cùng một đoạn tiêu đề) mà người dùng không nêu → người khác trùng tên
  const userNotes = parenNotes(name); const seg = raw.split(/\s+[-–|·]\s+|\s*\|\s*/).find(x => hasWords(fold(x), k)) || raw;
  const notes = parenNotes(seg).filter(n => !/^\d+$/.test(n) && !userNotes.includes(n));
  const utl = titleOf(name); const titled = utl && hasWords(fold(seg), `${utl} ${k}`); // “thầy Lê Văn Hùng” có cả danh xưng trong tiêu đề → đúng người
  if (notes.length && !titled) return false;
  // danh xưng: người dùng nói “thầy Lê Văn Hùng” mà tiêu đề ghi danh xưng khác ngay trước tên (“cô Lê Văn Hùng”) → không khớp
  const ut = titleOf(name); if (ut) { const before = fold(seg).split(k)[0].trim().split(' ').pop() || ''; if (before && HONOR.test(before) && before !== ut.split(' ').pop()) return false; }
  return true;
}
// B20: nhiều người cùng họ tên trong danh sách/kết quả → phải hỏi người dùng chọn ai (trả về các tên khớp khác nhau)
function sameNameCandidates(name, lines) {
  const k = nameKey(name); if (!k) return [];
  const seen = new Map();
  for (const l of lines || []) {
    const bare = nameKey(String(l).replace(/[(（\[][^)）\]]*[)）\]]/g, ' ')); // dòng phải CHỈ là tên (± danh xưng, ± chú thích trong ngoặc), không phải đoạn tin có nhắc tên
    if (bare !== k) continue; const key = fold(l); if (!seen.has(key)) seen.set(key, String(l).trim());
  }
  return [...seen.values()];
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
const APP_TITLE = /^(aivn bench|zalo|messenger|facebook|telegram|microsoft teams|teams|discord|gmail|signal|whatsapp|skype|line|viber|google chrome|chrome|microsoft edge|firefox|mozilla firefox|outlook|microsoft outlook|trò chuyện|tro chuyen|chat|thư|thu|mail|inbox|hộp thư đến|hop thu den|tin nhắn|messages?)$/i;
// B27 (QA lượt 4): màn hình (tiêu đề cửa sổ / đầu khung chat) cho thấy ĐÚNG cuộc trò chuyện với người nhận — đúng tên đầy đủ, không chú thích lạ,
// và tiêu đề cửa sổ không nêu cuộc trò chuyện khác. Dùng để mở khoá chatGate theo màn hình thay vì chỉ theo cờ nội bộ.
function chatShown(recipient, title = '', header = []) {
  const k = nameKey(recipient); if (!k) return false;
  const parts = String(title || '').split(/\s+[-–|·]\s+/).map(x => x.trim()).filter(Boolean);
  const chatParts = parts.length > 1 ? parts.filter(x => !APP_TITLE.test(x)) : [];
  if (chatParts.length && !chatParts.some(x => headerMatches(recipient, x))) return false;
  const exact = (x) => { const n = nameKey(x); return (n === k || fold(x) === fold(recipient)) && headerMatches(recipient, x); };
  const lines = header.filter(Boolean).flatMap(h => String(h).split(/\s+[-–|·•]\s+|\n/)).map(x => x.trim()).filter(Boolean);
  return chatParts.some(exact) || lines.some(exact);
}
function verifySend({ msg, recipient, regions = null, seen = '', winTitle = '', screenText = '' }) {
  const m = fold(String(msg || '').split('\n')[0]).slice(0, 40);
  const S = parseSeen(seen); const R = regions || {};
  const headerLines = [winTitle, S.header, ...(R.header || [])].filter(Boolean);
  const composerLines = [...(S.composer != null ? [S.composer] : []), ...(R.composer || [])];
  const msgLines = [...S.messages, ...(R.messages || [])];
  // 1) người nhận ở tiêu đề
  // tiêu đề cửa sổ dạng “Ứng dụng - Tên” là nguồn chắc nhất: nếu nó nêu một cuộc trò chuyện khác thì chắc chắn sai người
  const titleChat = String(winTitle || '').split(/\s+[-–|·]\s+/).map(x => x.trim()).filter(x => x && !APP_TITLE.test(x) && !/^\(?\d+\)?$/.test(x));
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
  // B25: tin ĐÃ rời ô soạn và hiện thành bong bóng, nhưng ở cuộc trò chuyện KHÁC → đã gửi nhầm chỗ (phải báo người dùng, không phải “chưa có tác dụng”)
  const wrongChat = !!(msg && recipient && msgSeen && !composerHas && !recipientSeen);
  // B36: không xác định được người nhận mà tin đã rời ô soạn và hiện trong khung chat → đã gửi vào cuộc trò chuyện đang mở; không được báo “đã gửi đúng người”
  if (msg && !recipient && msgSeen && !composerHas) {
    const where = (titleChat[0] || headerLines.find(h => fold(h) && !APP_TITLE.test(String(h).trim())) || '(không rõ)');
    return { sent: false, wrongChat: true, unknownRecipient: true, wrongTo: String(where).slice(0, 60), msgSeen, recipientSeen: false, composerEmpty: true, recipient: null, why: `tin “${String(msg).split('\n')[0].slice(0, 40)}” ĐÃ được gửi vào cuộc trò chuyện đang mở “${String(where).slice(0, 40)}” trong khi yêu cầu không nêu rõ người nhận — có thể đã gửi nhầm chỗ` };
  }
  const why = !msg ? 'không biết nội dung vừa gửi'
    : composerHas ? `tin “${String(msg).split('\n')[0].slice(0, 40)}” vẫn còn trong ô soạn — CHƯA gửi`
    : !recipientSeen ? `tiêu đề cuộc trò chuyện đang mở không phải “${recipient}”${otherHeader ? ` (đang là “${String(otherHeader).slice(0, 40)}”)` : ''} — có thể đang ở sai cuộc trò chuyện`
    : !msgSeen ? `không thấy bong bóng tin “${String(msg).split('\n')[0].slice(0, 40)}” trong khung tin nhắn sau khi gửi` : '';
  return { sent, wrongChat, wrongTo: wrongChat ? String(otherHeader || '').slice(0, 60) : null, msgSeen, recipientSeen, composerEmpty: !composerHas, recipient: recipient || null, why: wrongChat ? `tin “${String(msg).split('\n')[0].slice(0, 40)}” ĐÃ được gửi vào cuộc trò chuyện “${String(otherHeader || '(không rõ)').slice(0, 40)}”, KHÔNG phải “${recipient}”` : why };
}
// tách chữ trên cửa sổ chat theo vị trí: danh sách bên trái (≈30 % chiều rộng), tiêu đề (≈16 % trên cùng của khung phải),
// ô soạn (phần tử nhập liệu, hoặc ≈10 % dưới cùng), còn lại là khung tin nhắn. obs = { win: {b}, elements: [{name,value,b,editable,focused}] }
// B27: thanh menu của cửa sổ (Tệp / Sửa / Xem / Cửa sổ / Trợ giúp…) không phải đầu khung trò chuyện (OCR hay đọc “Cửa sổ” thành “Cửa số”)
const MENU_WORDS = new Set(['tep', 'sua', 'xem', 'cua', 'so', 'tro', 'giup', 'chinh', 'chen', 'dinh', 'dang', 'cong', 'cu', 'file', 'edit', 'view', 'window', 'help', 'tools', 'insert', 'format', 'history', 'bookmarks', 'go']);
const MENU_BAR = (t) => { const w = fold(t).split(' ').filter(Boolean); return w.length > 0 && w.length <= 10 && w.every(x => MENU_WORDS.has(x)); };
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
    if (ry < 0.16) { if (!MENU_BAR(txt)) out.header.push(txt); }
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
// chữ gõ vào CHỈ là tên người nhận (hoặc một phần tên) — không phải một tin nhắn có nhắc tên
function onlyName(text, recipient) {
  const t = fold(text); const k = nameKey(recipient); if (!t || !k) return false;
  return t === k || (k.includes(t) && t.length >= 2) || fold(recipient) === t;
}
const relates = (q, recipient) => { const a = fold(q), k = nameKey(recipient); return !!a && !!k && (k.includes(a) || a.includes(k)); };
// trả về lời nhắc (chặn) hoặc null (cho gõ). st = { chatOpen, searchTyping }
// searchField = ô nhận chữ ĐÃ ĐƯỢC XÁC NHẬN là ô tìm kiếm (B21: không còn cho qua chỉ vì chữ gõ là tên người nhận)
const SEND_INTENT = /(?:^|[^\p{L}])(nhắn|gửi|send|message|text|dm|reply|trả lời)(?![\p{L}])|发|告诉|私信|回复|傳|传/iu;
const SAY_INTENT = /(?:^|[^\p{L}])(nói với|nói cho|bảo|dặn|báo cho|báo|nhắc|tell|let\s+\S+(?:\s+\S+){0,5}\s+know|inform|notify|remind|ask)(?![\p{L}])|告诉|通知|提醒|跟.{1,12}说|和.{1,12}说/iu;
// B59 (QA lượt 7): “nhắn … vào cuộc trò chuyện hiện tại / đang mở / this chat / 当前聊天” = người nhận là cuộc trò chuyện ĐANG MỞ lúc bắt đầu
const CURRENT_CHAT = /(?:cuộc trò chuyện|đoạn chat|khung chat|cuộc hội thoại|nhóm chat|chat|nhóm)\s+(?:hiện tại|đang mở|này|hiện giờ|đang xem)(?![\p{L}])|\b(?:this|the current|the open|the opened|current|the same)\s+(?:chat|conversation|thread|group chat)\b|(?:当前|这个|目前|打开的)(?:聊天|对话|會話|会话|群聊)/iu;
// tên cuộc trò chuyện đang mở: phần tiêu đề cửa sổ không phải tên ứng dụng, không có thì dòng đầu khung chat
// tên cuộc trò chuyện đang mở, chỉ khi đọc CHẮC: phần tiêu đề cửa sổ (hệ điều hành báo) không phải tên ứng dụng; hoặc chữ đầu khung chat
// mà HAI nguồn (OCR vùng đầu khung + mắt nhìn) cùng đọc ra. Không chắc → null (hỏi người dùng)
function currentChatName(title = '', header = [], seenHeader = null) {
  const parts = String(title || '').split(/\s+[-–|·]\s+/).map(x => x.trim()).filter(Boolean);
  const chat = parts.length > 1 ? parts.find(x => !APP_TITLE.test(x) && !/AIVN Bench/i.test(x)) : null;
  if (chat) return chat;
  const ok = (x) => x && String(x).trim().length >= 2 && !MENU_BAR(x) && !APP_TITLE.test(String(x).trim());
  const h = (header || []).filter(ok).map(x => String(x).trim());
  if (seenHeader && ok(seenHeader)) { const hit = h.find(x => fold(x) === fold(seenHeader) || headerMatches(x, seenHeader) && headerMatches(seenHeader, x)); if (hit) return hit; }
  return null;
}
// B59 (Khôi quyết định): người nhận chưa chắc → HỎI người dùng đúng MỘT câu “Gửi cho ai?” — không im lặng từ chối, không gửi vào chat đang mở
const ASK_WHO = 'Gửi cho ai?';
function askWho(current = '') {
  return current ? `Gửi cho ai? Cuộc trò chuyện đang mở là “${String(current).slice(0, 60)}” — trả lời “đúng” nếu gửi vào đó, hoặc cho mình tên đầy đủ của người nhận.` : 'Gửi cho ai? Cho mình tên đầy đủ của người nhận (đúng như trong ứng dụng).';
}
// B61: việc GỬI TIN/THƯ mà câu lệnh không nêu người nhận → hỏi “Gửi cho ai?” TRƯỚC mọi thao tác màn hình (không để mô hình tự chọn
// người trong danh sách chat/bộ nhớ). Không áp dụng: đã nêu người nhận, “cuộc trò chuyện hiện tại”, việc không phải gửi tin (gửi tệp vào thư mục, trả lời câu hỏi…)
const MSG_SEND = /(?:^|[^\p{L}])(?:nhắn(?:\s+tin)?|gửi\s+(?:tin(?:\s+nhắn)?|lời nhắn|email|e-mail|mail|thư)|soạn\s+(?:tin(?:\s+nhắn)?|email|mail|thư))(?![\p{L}])|(?:^|[^\p{L}])(?:send|write|draft)\s+(?:a\s+|an\s+)?(?:message|text|email|e-mail|mail|dm)\b|^\s*(?:please\s+)?(?:text|message|dm|email)\b|发(?:一[条條]|个|個)?\s*(?:消息|信息|短信|讯息|訊息|微信|邮件|郵件|私信)|傳(?:訊息|消息)|私信/iu;
function missingRecipient(query) {
  const q = String(query || ''); if (!MSG_SEND.test(q)) return false;
  if (CURRENT_CHAT.test(q)) return false;
  return !recipientOf(q);
}
const ASKED_WHO = /^(?:⚠\s*)?(?:Gửi cho ai\?|Who should I send it to\?|发给谁？)/u;
// câu trả lời cho “Gửi cho ai?”: “đúng/yes/对/cuộc trò chuyện đang mở” = chat đang mở; còn lại là tên người nhận
const YES_CURRENT = /^\s*(?:đúng|đúng rồi|ừ|ok|okay|vâng|dạ|phải|yes|yep|right|correct|对|是|是的|好)\s*[.!]*\s*$/iu;
function answerWho(prevTask, reply) {
  const r = String(reply || '').trim().replace(/^[“"']|[”"']$/g, '');
  if (YES_CURRENT.test(r) || CURRENT_CHAT.test(r)) return `${prevTask}\n(gửi vào cuộc trò chuyện hiện tại)`;
  return `${prevTask}\n(người nhận: ${r.replace(/^(?:cho|gửi cho|to|send to|给)\s+/iu, '').slice(0, 80)})`;
}
function chatGate({ query, text, searchField = false, submit = false, proc = '', title = '', state = {}, header = [], ocrHeader = null, seenHeader = null }) {
  if (!isChatContext(query, proc, title)) return null;
  if (CURRENT_CHAT.test(String(query || ''))) {
    if (searchField) return null;
    const cur = state.currentChat || currentChatName(title, ocrHeader || header, seenHeader);
    if (!cur) { state.askWho = askWho(); return `CHƯA gõ tin: yêu cầu là gửi vào cuộc trò chuyện ĐANG MỞ nhưng không đọc chắc được tên cuộc trò chuyện đó. Hỏi người dùng: ${state.askWho}`; }
    if (!state.currentChat) state.currentChat = cur;
    const now = currentChatName(title, ocrHeader || header, seenHeader) || cur;
    if (fold(now) !== fold(state.currentChat) && !headerMatches(state.currentChat, now)) return `CHƯA gõ tin: cuộc trò chuyện đang mở đã đổi từ “${String(state.currentChat).slice(0, 40)}” sang “${String(now).slice(0, 40)}”. Mở lại “${String(state.currentChat).slice(0, 40)}” rồi mới gõ.`;
    return null;
  }
  const recipient = recipientOf(query);
  if (!recipient) {
    // B31: việc GỬI TIN mà không đọc được tên người nhận (câu tiếng Trung lạ, viết tắt…) → không được cho qua; hỏi người dùng
    // B36 (QA lượt 6, đã gửi nhầm vào nhóm): trong ứng dụng chat, KHÔNG BAO GIỜ gõ vào ô soạn khi chưa xác định được người nhận — bất kể động từ (“nói với/bảo/tell/let … know”…)
    if (searchField) return null;
    if (!submit && !/\n\s*$/.test(String(text || '')) && !SEND_INTENT.test(String(query || '')) && !SAY_INTENT.test(String(query || ''))) return null; // gõ chữ không kèm Enter, câu lệnh không phải gửi/nói với ai → không phải gửi tin
    state.askWho = askWho(); // B59: hỏi người dùng “Gửi cho ai?” (desktop-agent dừng lượt và đưa câu hỏi này cho người dùng)
    return `CHƯA gõ tin: không xác định được NGƯỜI NHẬN trong yêu cầu, nên không kiểm chứng được cuộc trò chuyện đang mở${header.filter(Boolean).length ? ` (“${String(header.filter(Boolean)[0]).slice(0, 40)}”)` : ''} là đúng người. Dừng lại và HỎI người dùng tên đầy đủ của người nhận; khi họ trả lời thì tìm và mở đúng cuộc trò chuyện đó rồi mới gõ tin.`;
  }
  if (searchField) return null; // gõ vào ô tìm kiếm đã xác nhận (tên, một phần tên, không dấu…) — đây là TÌM, không phải gửi
  // B21 (QA lượt 3): KHÔNG BAO GIỜ gõ tên người nhận vào ô soạn tin / ô chưa xác nhận là ô tìm kiếm (đã gửi nhầm “Trần Quỳnh Anh” vào Nhóm Lớp K27)
  // T1a: tin “AIVN test 1” gửi nhóm “AIVN test” chứa tên nhóm nhưng KHÔNG chỉ là tên — khi đã mở đúng cuộc trò chuyện thì cho gõ
  const nameOnly = onlyName(text, recipient) || (typingName(text, recipient) && fold(text).length <= fold(recipient).length + 4);
  const nearName = !onlyName(text, recipient) && nameOnly; // gần giống tên (thêm vài ký tự): chỉ chặn khi CHƯA mở đúng cuộc trò chuyện
  if (onlyName(text, recipient)) return `KHÔNG gõ “${String(text).slice(0, 40)}”: ô đang nhận chữ CHƯA được xác nhận là ô Tìm kiếm (có thể là ô soạn tin của cuộc trò chuyện đang mở${header.filter(Boolean).length ? ` “${String(header.filter(Boolean)[0]).slice(0, 40)}”` : ''} — gõ tên + Enter ở đó sẽ GỬI tên thành tin nhắn). Làm lần lượt: 1) screen_act click vào ô/chữ “Tìm kiếm” của ứng dụng; 2) type_text "${recipient}" với element là CHÍNH ô tìm kiếm đó; 3) bấm vào kết quả đúng tên “${recipient}”. Nếu tên “${recipient}” đã hiện sẵn trong danh sách bên trái, bấm thẳng vào tên đó thay vì gõ.`;
  const k = nameKey(recipient);
  const hdr = header.filter(Boolean).filter(h => !MENU_BAR(h));
  // B27: màn hình (tiêu đề cửa sổ “Ứng dụng - Tên”, hoặc đầu khung chat đúng tên) cho thấy ĐÚNG người nhận → cho gõ, không dựa vào cờ nội bộ
  // tiêu đề cửa sổ (do hệ điều hành báo) là bằng chứng chắc; chữ OCR ở đầu khung chỉ được tin khi lượt này ĐÃ tìm người nhận (có thể là chữ khác lọt vào vùng đầu khung)
  if (chatShown(recipient, title, []) || (state.lastSearch && chatShown(recipient, title, hdr))) { state.chatOpen = k; return null; }
  if (state.chatOpen === k) {
    // đã mở đúng người, nhưng nếu tiêu đề đọc được mà lại là người khác (vd. ứng dụng tự nhảy cuộc trò chuyện) thì vẫn chặn
    if (hdr.length && !hdr.some(h => headerMatches(recipient, h))) return `Tiêu đề cuộc trò chuyện hiện là “${String(hdr[0]).slice(0, 40)}”, không phải “${recipient}”. Tìm lại “${recipient}” trong ô tìm kiếm của ứng dụng, bấm vào đúng kết quả rồi mới gõ tin.`;
    return null;
  }
  if (nearName) { return `KHÔNG gõ “${String(text).slice(0, 40)}”: ô đang nhận chữ CHƯA được xác nhận là ô Tìm kiếm (có thể là ô soạn tin của cuộc trò chuyện đang mở${header.filter(Boolean).length ? ` “${String(header.filter(Boolean)[0]).slice(0, 40)}”` : ''} — gõ tên + Enter ở đó sẽ GỬI tên thành tin nhắn). Làm lần lượt: 1) screen_act click vào ô/chữ “Tìm kiếm” của ứng dụng; 2) type_text "${recipient}" với element là CHÍNH ô tìm kiếm đó; 3) bấm vào kết quả đúng tên “${recipient}”. Nếu tên “${recipient}” đã hiện sẵn trong danh sách bên trái, bấm thẳng vào tên đó thay vì gõ.`; }
  return `CHƯA gõ tin: AIVN AGENT phải TÌM và MỞ cuộc trò chuyện với “${recipient}” trước, không gõ vào cuộc trò chuyện đang mở sẵn${hdr.length ? ` (đang mở: “${String(hdr[0]).slice(0, 40)}”)` : ''}. Làm lần lượt: 1) screen_act click vào ô Tìm kiếm của ứng dụng; 2) type_text "${recipient}"; 3) click vào kết quả đúng tên “${recipient}”; 4) rồi mới gõ tin nhắn.`;
}
const SEEN_QUESTION = 'Trả lời đúng định dạng, chép đúng chữ trên màn hình:\nTÊN: <tên người/nhóm ở đầu khung trò chuyện đang mở>\nÔ SOẠN: <chữ còn trong ô soạn tin, hoặc TRỐNG>\nTIN: <tin nhắn cuối cùng trong khung trò chuyện>\nTIN: <tin nhắn trước đó>';
module.exports = { missingRecipient, MSG_SEND, CURRENT_CHAT, currentChatName, askWho, ASK_WHO, ASKED_WHO, answerWho, chatShown, APP_TITLE, sameNameCandidates, onlyName, parenNotes, chatGate, typingName, relates, isChatContext, regionsOf, recipientOf, nameSeen, nameKey, headerMatches, isSendAction, verifySend, parseSeen, SEEN_QUESTION, fold };
