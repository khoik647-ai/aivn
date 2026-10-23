'use strict';
// Kiểm chứng “đã gửi” trên màn hình (B2 + B15, QA 21/10). Chỉ coi là ĐÃ GỬI khi đủ cả ba:
//   1) tên ĐẦY ĐỦ của người nhận nằm ở TIÊU ĐỀ cuộc trò chuyện đang mở (tiêu đề cửa sổ / đầu khung chat / mắt nhìn đọc tiêu đề),
//      không tính danh sách hội thoại bên trái; tên gần giống (“Lê Quỳnh Anh” ≠ “Trần Quỳnh Anh”) không khớp;
//   2) ô soạn tin đã TRỐNG (tin không còn nằm trong ô nhập);
//   3) thấy bong bóng tin vừa gửi trong khung tin nhắn (không tính ô soạn, tiêu đề, danh sách bên trái).
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const HONOR = /^(ban|anh|chi|em|co|chu|bac|ong|ba|me|bo|ma|thay|di|cau|mo|duong|thim|sep|giao su|ts|ths|pgs|mr|mrs|ms|mx|miss|dr|prof)$/;
const STOP = String.raw`(?:nhưng|but|and don't|and do not|mà đừng|trên|ở|qua|bằng|là|rằng|nội dung|với nội dung|tiêu đề|chủ đề|nói|bảo|hỏi|nhắc|chúc|mời|không cần|khỏi|đừng|và|rồi|nhé|nha|giúp|hộ|ngay|lúc|vào|on|via|in|saying|that|about|with|an email|an e-mail|a message|a text|a note)`;
const NOT_NAME = /^(tôi|mình|em|tao|tớ|me|ai|mọi người|tin|tin nhắn|lời|câu|một|email|thư|mail|cho|tới|đến|với|họ|nó|anh ấy|chị ấy|bạn ấy)$/iu;

// tên người nhận trong yêu cầu: “nhắn Trần Quỳnh Anh là…”, “gửi email cho thầy Lê Văn Hùng tiêu đề…”, “Messenger: nhắn Quỳnh Anh "…"”,
// “text Tran Quynh Anh on Messenger: hi”, “gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại”
// B58 (QA lượt 7): “Mr./Dr.” — dấu chấm của danh xưng không phải dấu hết câu; danh xưng tiếng Anh bỏ khỏi tên để tìm (“Mr. Le Van Hung” → “Le Van Hung”)
const EN_HONOR_DOT = /\b(Mr|Mrs|Ms|Mx|Dr|Prof|Miss)\.(?=\s)/gi;
const EN_HONOR_LEAD = /^(?:mr|mrs|ms|mx|dr|prof|miss)\.?\s+(?=\S)/iu;
// B61 (máy thật, “nhắn giúp mình là mai 8h họp nhé”): “giúp/hộ/cho mình” là NGƯỜI DÙNG, không phải người nhận; cụm bắt đầu bằng từ mở đầu nội dung
// (là/rằng/nội dung/saying/that…) hay “a message for me” không phải tên → không có người nhận → hỏi “Gửi cho ai?”
const NOT_RECIPIENT = /^(?:(?:là|rằng|nội dung|với nội dung|tiêu đề|saying|that|about)(?:\s|$)|(?:a|an|the|my)\s+(?:message|email|e-mail|mail|text|note|dm)\b|(?:for|to)\s+(?:me|myself|us)\b|(?:giúp|hộ|giùm|dùm|cho)\s+(?:mình|tôi|em|tớ|tao)(?:\s|$)|(?:mình|tôi|tớ|tao|me|myself)(?:\s|$)|(?:nhắc|chúc|hỏi|báo|mời|xin|về|thông báo|lịch|nhờ)\s|(?:nhé|nha|nhá|đi|ngay|luôn|giúp|hộ|giùm|với|thầy|cô|anh|chị|em|bạn|sếp|mr|mrs|ms|dr)$)/iu;
// B71b (QA lượt 8): đại từ (“text her…”, “message him: ok”, “nhắn anh ấy…”, “告诉她…”) và cụm bắt đầu bằng động từ nói/báo (“gửi email nói mai nghỉ”)
// không phải tên → chưa có người nhận → hỏi “Gửi cho ai?”
const PRONOUN = /^(?:ok|okay|yes|no|thanks|thank you|sure|đồng ý|được|her|him|them|he|she|they|it|us|you|everyone|everybody|someone|somebody|that person|this person|anh ấy|anh ta|chị ấy|chị ta|em ấy|bạn ấy|cô ấy|thầy ấy|ông ấy|bà ấy|cậu ấy|nó|họ|người đó|người ấy|người kia|ai đó|mọi người|tất cả|他|她|它|他们|她们|他們|她們|大家|对方|對方)$/iu;
const SAY_LEAD = /^(?:nói|bảo|dặn|kể|báo|trả lời|hồi âm|xin|nhờ|rằng|là|say|says|saying|tell|telling|reply|replying|answer|that)(?:\s|$)/iu;
function notAName(r) { const x = String(r || '').trim().replace(/[\s,.;:!?]+$/u, ''); return !x || PRONOUN.test(x) || SAY_LEAD.test(x) || /^(?:her|him|them)\b/iu.test(x); }
// B110 (máy thật beta.2.5): “mở chat Cloud của tôi, không gửi gì” → AIVN gõ “gì” vào ô tìm kiếm Zalo. Từ hỏi/phủ định/đại từ chung
// (gì, ai, nào, đâu, cả, hết, nothing, anyone, 什么…) KHÔNG BAO GIỜ là tên người nhận; mệnh đề “không/đừng gửi (gì)” bỏ trước khi tìm tên.
const RCP_STOP = new Set(['gì', 'gi', 'cái gì', 'gì cả', 'gì hết', 'ai', 'ai cả', 'ai hết', 'nào', 'đâu', 'cả', 'hết', 'đi', 'luôn', 'không', 'chưa', 'tin', 'tin nhắn', 'gì đó', 'ai đó', 'nothing', 'anything', 'something', 'anyone', 'anybody', 'no one', 'nobody', 'none', 'what', 'who', 'whom', 'it', 'yet', 'now', '什么', '谁', '任何人', '什么都', '东西']);
const NEG_SEND = /(?:^|[\s,;.])(?:(?:và|nhưng|mà|and|but)\s+)?(?:không|đừng|chưa|khỏi|ko|khoan|không cần|don't|do not|never|not)\s+(?:(?:cần|được|vội)\s+)?(?:gửi|nhắn|bấm gửi|send|text|message)(?:\s+(?:gì|gì cả|gì hết|cả|hết|ai|đi|tin|tin nhắn|nhé|nha|anything|it|yet|a message|now))*(?=[\s,.;!?]|$)|(?:不要|别|別|不)(?:发送|发|發送|發)(?:任何)?(?:消息|信息)?/giu;
const rcpStop = (r) => { const f = String(r || '').trim().toLowerCase().replace(/[\s,.;:!?]+$/u, ''); const w = f.split(/\s+/); return RCP_STOP.has(f) || w.every(x => RCP_STOP.has(x)) || /^(?:gì|cái gì|what|什么|哪)$/u.test(w[0]); };
function recipientOf(query) {
  const r = recipientOf0(String(query || '').replace(EN_HONOR_DOT, '$1').replace(NEG_SEND, ' ')); if (!r) return r;
  if (NOT_RECIPIENT.test(String(r).trim()) || notAName(r) || rcpStop(r) || /^(?:hiện tại|đang mở|này|hiện giờ|current|this)$/iu.test(String(r).trim())) return null;
  { const z = String(r).replace(/\s*的\s*(?:聊天|对话|對話|会话|會話|聊天窗口)$/u, '').trim(); if (z !== String(r).trim()) return z || null; }
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
    || /(?:告诉|跟|和|私信)\s*([^，。、：:"“”]{1,40}?)\s*(?:说|讲|：|:|，)/u.exec(q)
    || /给\s*([^\s，。、：:"“”给的][^，。、：:"“”给]{0,40}?)\s*的\s*(?:消息|信息|短信|讯息|訊息|邮件|郵件|私信|微信)/u.exec(q); // “起草一条给王老师的消息” (B: soạn sẵn)
  // “告诉 Trần Quỳnh Anh 明天…” (không có dấu câu): tên Latinh/tiếng Việt kết thúc ở chữ Hán đầu tiên
  const zhLatin = !zh && /(?:告诉|跟|和|私信|给|发给|通知|提醒)\s*((?:[A-Za-zÀ-ỹĐđ][A-Za-zÀ-ỹĐđ'’.-]*)(?:\s+[A-Za-zÀ-ỹĐđ][A-Za-zÀ-ỹĐđ'’.-]*){0,5})\s*(?=[\u3400-\u9fff，。：:！!？?]|$)/u.exec(q);
  if (zhLatin && !/^(?:messenger|zalo|telegram|teams|facebook|discord|gmail|outlook|email)$/i.test(zhLatin[1].trim())) return zhLatin[1].trim();
  { const zt = /(?:告诉|告訴|通知|提醒|回复|回覆)\s*([\u3400-\u9fff]{1,3}(?:老师|老師|先生|女士|小姐|同学|同學|教授|博士|经理|經理|总|總|姐|哥))/u.exec(q); if (zt && !zh) return zt[1]; }
  if (zh) { const n = zh[1].replace(/^(?:在\s*\S+\s*上\s*)/u, '').replace(/\s*(?:在|用|通过)\s*\S+\s*上?$/u, '').trim(); if (n && n.split(' ').length <= 6) return n; }
  // T1a: “gửi 'AIVN test 1' vào nhóm 'AIVN test'” / “… vào nhóm Zalo "X"” / “send 'x' to the group 'Y'” — tên nhóm sau “vào/tới/cho nhóm”
  const grpQ = /(?:vào|tới|đến|cho|lên|trong|to|in|into)\s+(?:the\s+)?(?:nhóm|group|kênh|channel|cuộc trò chuyện|đoạn chat|chat)\s+(?:(?:zalo|messenger|telegram|teams|discord|slack|whatsapp|viber)\s+)?["“'‘«]([^"”'’»]{1,60})["”'’»]/iu.exec(q);
  if (grpQ && grpQ[1].trim()) return grpQ[1].trim();
  const grp = /(?:vào|tới|đến|lên|trong|to|into)\s+(?:the\s+)?((?:nhóm|group)\s+[^,.!?:;"“”'‘’«»]{1,50}?)(?=\s+(?:trên|qua|bằng|ở|với nội dung|nội dung|là|rằng|on|via|saying)(?=[\s,.:!?]|$)|[,.!?:;"“”«»]|$)/iu.exec(q);
  if (grp && grp[1].trim().split(' ').length <= 7) return grp[1].trim().replace(/\s+(?:zalo|messenger|telegram)$/i, '');
  { const st = sayTo(q); if (st) { const n = String(st).replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, '').replace(/\s+(?:trên|qua|ở|bằng|on|via|in)\s+(?:zalo|messenger|telegram|teams|microsoft teams|facebook|discord|slack|whatsapp|viber)$/iu, ''); if (n && !NOT_NAME.test(n) && n.split(' ').length <= 6 && !/^(?:tôi|mình|em|tao|tớ|me|i|họ|nó|mọi người|everyone)$/iu.test(n)) return n; } }
  const clean = (n) => { n = String(n || '').replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, ''); if (!n || NOT_NAME.test(n) || /^(tôi|mình|tao|tớ|me|ai|họ|nó|mọi|tin|email|thư|mail|file|tệp)$/iu.test(n.split(' ')[0]) || n.split(' ').length > 6) return null; return n; };
  const stopRe = new RegExp(String.raw`\s+${STOP}(?=[\s,.!?:]|$)|[,.!?;]`, 'iu');
  const take = (s) => { const i = s.search(stopRe); return clean(i >= 0 ? s.slice(0, i) : s); };
  // B85: “gửi tin "AIVN test" cho Cloud của tôi” / “send "hi" to Lan” — nội dung trong ngoặc kép ĐỨNG TRƯỚC người nhận
  // (cả việc chỉ soạn: “soạn sẵn tin "X" cho Y”, “draft a message "X" to Y”)
  { const qm = /(?:^|[\s:,.(])(?:gửi|nhắn|send|text|message|(?:soạn|viết|thảo)(?:\s+(?:sẵn|nháp|trước|giúp|hộ|giùm)){0,2}|draft|compose|write|prepare)(?:\s+(?:một\s+|a\s+)?(?:(?:tin nhắn|tin|lời nhắn|email|mail|thư|message|text)|draft(?:\s+(?:message|email|text))?))?\s*[:：]?\s*["“«]([^"”»]{1,400})["”»]\s+(?:cho|tới|đến|to|for)\s+(.+)$/iu.exec(q);
    if (qm) { const n = take(qm[2].replace(/\s+(?:trên|qua|bằng|on|via|in)\s+(?:zalo|messenger|telegram|teams|microsoft teams|facebook|discord|slack|whatsapp|viber)(?=[\s,.!?]|$).*$/iu, '')); if (n) return n; } }
  // B110/B109: việc MỞ cuộc trò chuyện: “mở (cuộc) trò chuyện/chat X”, “open the chat with X”, “打开和X的聊天”
  { const oc = /(?:^|[\s:,.(])(?:mở|vào|tìm và mở|chuyển sang|open|go to|switch to)\s+(?:(?:lại|sẵn)\s+)?(?:(?:the|a)\s+)?(?:(?:cuộc|đoạn|khung)\s+)?(?:trò chuyện|chat|hội thoại|nhóm chat|conversation|dm)(?:\s+(?:với|cùng|của|with|of))?\s+(.+)$/iu.exec(q);
    if (oc && !CURRENT_CHAT.test(oc[0])) { const n = take(oc[1].replace(/\s+(?:trên|qua|bằng|on|via|in)\s+(?:zalo|messenger|telegram|teams|microsoft teams|facebook|discord|slack|whatsapp|viber)(?=[\s,.!?]|$).*$/iu, '')); if (n) return n; }
    const zo = /(?:打开|打開|进入|進入|切换到)\s*(?:(?:和|与|與|跟)\s*)?([^\s，。、：:"“”的][^，。、：:"“”]{0,40}?)\s*的\s*(?:聊天|对话|對話|会话|會話|聊天窗口)/u.exec(q);
    if (zo && !/^(?:zalo|messenger|telegram)$/i.test(zo[1].trim())) return zo[1].trim(); }
  const verb = /(?:^|[\s:,.(])((?:soạn|viết|thảo)(?:\s+(?:sẵn|nháp|trước|giúp|hộ|giùm)){0,2}\s+(?:một\s+)?(?:email|e-mail|mail|thư điện tử|thư|tin nhắn|tin)(?:\s+mới)?|nhắn tin|nhắn|gửi tin nhắn|gửi tin|gửi email|gửi mail|gửi thư|gửi|chat với|chat|trò chuyện với|text|message|msg|send|email|dm|reply|respond)(?=\s)/iu.exec(q);
  if (!verb) return null;
  // phần đầu câu: từ động từ tới chỗ bắt đầu nội dung (là/rằng/:/ngoặc kép/tiêu đề…)
  let head = q.slice(verb.index + verb[0].length).replace(/^\s+(?:giúp|hộ|giùm|dùm)(?:\s+(?:mình|tôi|em))?(?=\s)/iu, '').replace(/^\s+(?:mới\s+)?gửi(?=\s+\S)/iu, ''); // “soạn email gửi thầy Nam” → “thầy Nam”
  // “gửi nội dung trong ô soạn tin cho An” — “nội dung trong ô…” là tên ô, người nhận đứng sau “cho”
  head = head.replace(/^\s*nội dung\s+(?:trong|ở|của)\s+(?:ô|khung|hộp|vùng|chỗ)\s+soạn(?:\s+tin(?:\s+nhắn)?)?/iu, ' ');
  const cut = head.search(/\s(?:là|rằng|nội dung|với nội dung|tiêu đề|chủ đề|saying|that)(?=[\s,.:!?]|$)|[:"“”«»]/iu);
  if (cut >= 0) head = head.slice(0, cut);
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
// B85 (máy thật, Zalo): “Cloud của tôi” nay hiện là “My Documents” (kết quả tìm ghi “Tên cũ: Cloud của tôi”) — tên khác của CÙNG cuộc trò chuyện
// ALIASES: nhóm tên cố định do ứng dụng đặt (không phải người); aliases thêm: tên hiện tại đọc từ dòng “Tên cũ: …/Former name: …” của kết quả vừa bấm
const ALIASES = [['Cloud của tôi', 'My Documents', '我的文档', '我的文件', 'My Cloud', 'Cloud của bạn', 'Tài liệu của tôi']];
const FORMER = /^\s*(?:tên cũ|ten cu|tên trước đây|former name|formerly|old name|previous name|曾用名|旧名|原名|舊名)\s*[:：]\s*(.+?)\s*$/iu;
function namesFor(recipient, aliases = []) {
  const k = nameKey(recipient); if (!k) return [recipient];
  const fixed = ALIASES.find(g => g.some(x => nameKey(x) === k)) || [];
  return [...new Set([recipient, ...fixed, ...(aliases || []).filter(Boolean)])];
}
function chatShown(recipient, title = '', header = [], aliases = []) { const h = [...(header || []), ...cleanHeader((header || []).filter(Boolean))]; return namesFor(recipient, aliases).some(n => chatShown1(n, title, h)); } // B111: dòng tiêu đề làm sạch (“Q My Documents” → “My Documents”)
function chatShown1(recipient, title = '', header = []) {
  const k = nameKey(recipient); if (!k) return false;
  const parts = String(title || '').split(/\s+[-–|·]\s+/).map(x => x.trim()).filter(Boolean);
  const chatParts = parts.length > 1 ? parts.filter(x => !APP_TITLE.test(x)) : [];
  if (chatParts.length && !chatParts.some(x => headerMatches(recipient, x))) return false;
  const exact = (x) => { const n = nameKey(x); return (n === k || fold(x) === fold(recipient)) && headerMatches(recipient, x); };
  const lines = header.filter(Boolean).flatMap(h => String(h).split(/\s+[-–|·•]\s+|\n/)).map(x => x.trim()).filter(Boolean);
  return chatParts.some(exact) || lines.some(exact);
}
function verifySend({ msg, recipient, regions = null, seen = '', winTitle = '', screenText = '', aliases = [] }) {
  const NAMES = recipient ? namesFor(recipient, aliases) : []; const hm = (h) => NAMES.some(n => headerMatches(n, h));
  const m = fold(String(msg || '').split('\n')[0]).slice(0, 40);
  const S = parseSeen(seen); const R = regions || {};
  const headerLines = [winTitle, S.header, ...(R.header || [])].filter(Boolean);
  const composerLines = [...(S.composer != null ? [S.composer] : []), ...(R.composer || [])];
  const msgLines = [...S.messages, ...(R.messages || [])];
  // 1) người nhận ở tiêu đề
  // tiêu đề cửa sổ dạng “Ứng dụng - Tên” là nguồn chắc nhất: nếu nó nêu một cuộc trò chuyện khác thì chắc chắn sai người
  const titleChat = String(winTitle || '').split(/\s+[-–|·]\s+/).map(x => x.trim()).filter(x => x && !APP_TITLE.test(x) && !/^\(?\d+\)?$/.test(x));
  const titleWrong = !!(recipient && titleChat.length && !titleChat.some(hm) && String(winTitle).split(/\s+[-–|·]\s+/).length > 1);
  const recipientSeen = !recipient || (!titleWrong && headerLines.some(hm));
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
const INFO_PANEL = /^(?:thông tin hội thoại|thong tin hoi thoai|thông tin nhóm|thông tin cuộc trò chuyện|conversation info|chat info|group info|details|会话信息|聊天信息|群信息|對話資訊|会话资料)$/iu;
const COMPOSER_HINT = /^(?:nhập|nhap|soạn tin|aa$|type a message|write a message|send a message|message\s|输入消息|发送消息|輸入訊息)/iu;
const CUT_MEMO = new Map(); // B102: mép trái khung chat theo cửa sổ
function regionsOf(obs) {
  const els = (obs && obs.elements || []).filter(e => Array.isArray(e.b) && e.b.length >= 4);
  if (!els.length) return null;
  let W = obs.win && Array.isArray(obs.win.b) && obs.win.b[2] > 50 && obs.win.b[3] > 50 ? obs.win.b : null;
  if (!W) { const x0 = Math.min(...els.map(e => e.b[0])), y0 = Math.min(...els.map(e => e.b[1])), x1 = Math.max(...els.map(e => e.b[0] + e.b[2])), y1 = Math.max(...els.map(e => e.b[1] + e.b[3])); W = [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)]; }
  const rel = (e) => ({ rx: (e.b[0] + e.b[2] / 2 - W[0]) / W[2], ry: (e.b[1] + e.b[3] / 2 - W[1]) / W[3], left: (e.b[0] - W[0]) / W[2] });
  const searchy = (e) => /tìm|tim kiem|search|find/iu.test(`${e.name || ''} ${e.autoId || ''}`);
  const hasRight = els.some(e => rel(e).left >= 0.3);
  const out = { header: [], composer: [], messages: [], list: [], side: [] }; const hdr = [];
  // B85 (Zalo thật, 3 cột): danh sách trái chỉ rộng ≈20 % → tiêu đề “My Documents” ở x≈0,24 bị coi là danh sách, còn “đầu khung” lại là bảng
  // “Thông tin hội thoại” bên phải. Mép trái khung chat = mép trái ô soạn (“Nhập @, tin nhắn tới …”); bảng thông tin bên phải bị loại khỏi tiêu đề
  const nm = (e) => String(e.name || e.value || '').trim();
  const comp = els.filter(e => rel(e).ry > 0.8 && rel(e).left > 0.08 && rel(e).left < 0.33 && (e.editable || COMPOSER_HINT.test(nm(e)) || /tin nhắn|message|消息|訊息/iu.test(String(e.placeholder || '')))).sort((a, b) => a.b[0] - b.b[0])[0];
  // B102 (máy thật beta.2.4): gõ nội dung xong thì chữ gợi ý “Nhập @, tin nhắn tới …” biến mất → mất mép khung chat → tiêu đề “My Documents”
  // lại bị coi là danh sách → chốt người nhận (B90) mất. Nhớ mép đã thấy cho cùng cửa sổ (cùng ứng dụng + cùng khung) và dùng lại.
  const wkey = `${String((obs.win && (obs.win.proc || obs.win.pid)) || '')}|${W.map(v => Math.round(v / 8)).join(',')}`;
  let cut = comp ? Math.min(0.3, rel(comp).left - 0.03) : null;
  if (cut != null) { CUT_MEMO.delete(wkey); CUT_MEMO.set(wkey, cut); if (CUT_MEMO.size > 32) CUT_MEMO.delete(CUT_MEMO.keys().next().value); }
  else cut = CUT_MEMO.has(wkey) ? CUT_MEMO.get(wkey) : 0.3;
  const ip = els.find(e => rel(e).ry < 0.16 && rel(e).left > 0.55 && INFO_PANEL.test(nm(e)));
  const panelL = ip ? Math.max(0.5, (2 * (ip.b[0] + ip.b[2] / 2) - (W[0] + W[2]) - W[0]) / W[2] - 0.02) : 2;
  // B124/B122 (ô tìm kiếm còn chữ “My Documents” sau lần tìm hụt, OCR chỉ thấy cột trái): chữ trong HÀNG Ô TÌM KIẾM (cạnh nút “Đóng”) không phải tiêu đề khung chat
  const sClose = searchClose(obs); const sLeft = searchLeftover(obs);
  const inSearchRow = (e) => (sLeft && e === sLeft) || (sClose && rel(e).left < 0.35 && Math.abs(e.b[1] + e.b[3] / 2 - sClose.y) <= Math.max(14, e.b[3]) && e.b[0] <= sClose.x + 5);
  for (const e of els) {
    const { ry, left, rx } = rel(e); const txt = [e.name, e.value].filter(Boolean).join(' ').trim();
    if (!txt) continue;
    if (inSearchRow(e)) { out.list.push(txt); continue; }
    if (sClose && !hasRight && left < 0.35) { out.list.push(txt); continue; } // ô tìm kiếm đang mở, OCR chỉ thấy cột trái → đó là danh sách kết quả, không phải tiêu đề
    if (rx >= panelL && !(e.editable || e.focused)) { out.side.push(txt); continue; }
    if (e.editable || e.focused) { if (!searchy(e)) out.composer.push(e.value != null ? e.value : (e.ocr ? e.name : '')); continue; }
    if (hasRight && left < cut) { out.list.push(txt); continue; }
    if (ry < 0.16) { if (!MENU_BAR(txt)) hdr.push({ e, txt }); }
    else if (ry > 0.9 && e.ocr) out.composer.push(txt);
    else out.messages.push(txt);
  }
  // B116 (máy thật beta.2.5): dải 16 % đầu còn chứa bong bóng tin/khung xem trước đường dẫn ngay dưới tiêu đề (“https://…”, “AIVN - Chạy AI…”)
  // → chỉ giữ CỤM dòng trên cùng (tên + dòng phụ); gặp khoảng trống dọc rõ rệt thì phần dưới là nội dung khung chat
  hdr.sort((a, b) => a.e.b[1] - b.e.b[1]);
  const gap = Math.max(18, W[3] * 0.025); let bottom = null, cutHdr = false;
  for (const h of hdr) {
    if (!cutHdr && bottom != null && h.e.b[1] > bottom + gap) cutHdr = true;
    if (cutHdr || !headerLike(h.txt)) { out.messages.push(h.txt); continue; }
    out.header.push(h.txt); bottom = Math.max(bottom == null ? -Infinity : bottom, h.e.b[1] + h.e.b[3]);
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
const MSG_SEND = /(?:^|[^\p{L}])(?:nhắn(?:\s+tin)?|gửi\s+(?:tin(?:\s+nhắn)?|lời nhắn|email|e-mail|mail|thư)|soạn\s+(?:tin(?:\s+nhắn)?|email|mail|thư))(?![\p{L}])|(?:^|[^\p{L}])(?:send|write|draft)\s+(?:a\s+|an\s+)?(?:message|text|email|e-mail|mail|dm)\b|^\s*(?:please\s+)?(?:text|message|dm|email)\b|(?:^|[^\p{L}])báo(?:\s+(?:giúp|hộ|giùm|dùm|cho|với|lại|tin))(?![\p{L}])|(?:^|[^\p{L}])trả lời(?:\s+(?:tin(?:\s+nhắn)?|email|mail|thư|lại|giúp|hộ|giùm|cho|với|là|rằng|ok|okay|được|đồng ý)|\s*[:"“])(?![\p{L}])|(?:^|[^\p{L}])(?:reply|respond)(?:\s+(?:to|with|back|saying|that|ok|okay|yes|no)\b|\s*[:"“]|\s*$)|回复|回覆|告诉|告訴|发(?:一[条條]|个|個)?\s*(?:消息|信息|短信|讯息|訊息|微信|邮件|郵件|私信)|发出|就发|傳(?:訊息|消息)|私信/iu;
// “… rồi báo (lại) cho mình (biết) / báo lại nhé / report back to me / 告诉我” = báo KẾT QUẢ cho chính người dùng (trả lời trong AIVN), không phải gửi tin cho ai
const SELF_REPORT = /(?:^|[^\p{L}])báo(?:\s+(?:lại|giúp|hộ|giùm|dùm))?(?:\s+(?:cho|với))?(?:\s+(?:mình|tôi|tớ|em|me))?(?:\s+(?:biết|nhé|nha|nhá|với|ạ|luôn|ngay))*(?=\s*[.!?…]*\s*$)|(?:^|[^\p{L}])(?:report|tell me|let me know)(?:\s+back)?(?:\s+to\s+me)?\s*[.!?]*\s*$|告诉我[。！!]*\s*$/iu;
// B113 (máy thật beta.2.5, kịch bản A): “…rồi báo cho mình giá và đường dẫn trang” — “báo cho mình/tôi”, “cho mình biết”, “tell me”, “report back”,
// “告诉我” ở BẤT KỲ đâu trong câu là trả lời người dùng NGAY TRONG AIVN, không phải gửi tin. Chỉ là gửi tin khi ngay sau đó nêu ứng dụng nhắn tin
// (“báo cho mình qua Zalo”, “tell me on Telegram”).
const MSG_APPS = String.raw`(?:zalo|messenger|facebook|telegram|teams|microsoft teams|discord|slack|whatsapp|viber|skype|gmail|outlook|email|e-mail|mail|thư|sms|tin nhắn|微信|邮件|短信|消息)`;
const SELF_ANY = /(?:^|[^\p{L}])(?:báo(?:\s+(?:lại|giúp|hộ|giùm|dùm))?\s+(?:cho|với)\s+(?:mình|tôi|tớ|em|tao)(?:\s+biết)?|(?:nói|kể)\s+(?:cho|với)\s+(?:mình|tôi|tớ|em)(?:\s+(?:biết|nghe))?|cho\s+(?:mình|tôi|tớ|em)\s+biết|tell\s+me|let\s+me\s+know|report(?:\s+(?:it|them|that|this|the\s+\w+))?\s+back(?:\s+to\s+me)?|report\s+to\s+me|get\s+back\s+to\s+me)(?![\p{L}])|告诉我|告訴我|跟我说|跟我說|让我知道|讓我知道|回报给我|报告给我/giu;
const VIA_APP = new RegExp(String.raw`^\s*(?:[^.!?;。！？]{0,40}?\s)?(?:qua|trên|bằng|on|via|by|through|in|用|通过|在)\s*${MSG_APPS}(?![\p{L}])`, 'iu');
const selfReport = (q) => {
  let r = String(q || '').replace(SELF_REPORT, ' ');
  r = r.replace(SELF_ANY, (m, off, all) => VIA_APP.test(all.slice(off + m.length)) ? m : ' ');
  return r;
};
// B219: “ô soạn tin / the message box / 消息输入框” là TÊN của ô trên màn hình, không phải lệnh soạn hay gửi.
// Đoạn trong ngoặc đơn là chú thích (ví dụ chữ mẫu, “chỉ nhìn”, “đừng gửi”) — không phải văn bản cần gõ —
// trừ khi chính ngoặc là lệnh gửi hoặc nêu người nhận (“gửi tin…”, “cho An”, “to An”, “给安”).
// Tiếng Việt/Anh cần ranh giới từ (“message” trong “message box”, không phải “send a message”).
// Tiếng Trung viết liền: “看看消息输入框里” — “输入框/消息框” là tên ô, không có khoảng trắng hai bên.
const COMPOSE_BOX = /(?:^|[^\p{L}\p{N}])(?:(?:ô|khung|hộp|vùng|chỗ)\s+(?:soạn\s+tin(?:\s+nhắn)?|nhập\s+tin(?:\s+nhắn)?)|ô\s+chat|o\s+soan\s+tin(?:\s+nhan)?|khung\s+chat|khung\s+soạn\s+thảo|(?:the\s+|a\s+|this\s+)?(?:message|compose|composer|text|input|chat)\s+(?:box|field|area)|(?:the\s+|a\s+|this\s+)?(?:chat|message|text)\s+input|(?:the\s+|a\s+)?textbox)(?![\p{L}\p{N}])|(?:消息|信息|短信|讯息|訊息|聊天)?输入框|消息框|信息框|聊天框|撰写框/iu;
const PAREN_ASIDE = /[(（][^()（）]{0,240}[)）]/u;
const QUOTE_ASIDE = /["“«]([^"”»]{0,400})["”»]/u;
const KEEP_ASIDE = /(?:^|[^\p{L}])(?:cho|tới|đến|với|to|for|给)\s+\p{L}/iu;
// Động từ GỬI thật, xét SAU khi đã bỏ tên ô. “trả lời giúp / báo cho mình” không nằm ở đây: đó có thể là trả lời người dùng.
// “gửi” + bất kỳ từ nào, “Gửi.” đứng một mình, “gui/nhan” không dấu, “bấm nút gửi”,
// reply/text/forward/submit/post, Ctrl+Enter/Alt+S/Enter, “发出/就发/回复/转发/回车” vẫn là gửi.
// soạn/write/draft chỉ để loại câu chỉ nhìn — không đủ để QA đòi bằng chứng đã gửi (việc chỉ soạn).
const SEND_VI = String.raw`(?:^|[^\p{L}])(?:nhắn(?:\s+tin)?|nhan(?:\s+tin)?|gửi|gui|(?:bấm|nhấn|ấn)\s+(?:nút\s+)?(?:gửi|gui|enter)|trả lời\s+(?:tin(?:\s+nhắn)?|email|mail|thư))(?![\p{L}])`;
const SEND_EN = String.raw`(?:^|[^\p{L}])(?:send|write|draft)\s+(?:a\s+|an\s+)?(?:message|text|email|e-mail|mail|dm)\b|(?:^|[^\p{L}])send\s+(?:it|this|that)\b|(?:^|[^\p{L}])(?:hit|press)\s+(?:(?:ctrl|control|alt)\s*\+\s*(?:enter|s)|send|enter)\b|(?:^|[^\p{L}])(?:ctrl|control)\s*\+\s*enter\b|(?:^|[^\p{L}])alt\s*\+\s*s\b|(?:^|[^\p{L}])send(?:ing)?(?![\p{L}])|(?:^|[^\p{L}])(?:reply|forward|submit|post)(?![\p{L}])|(?:^|[^\p{L}])text(?!\s+(?:box|field|area|input)\b)(?![\p{L}])|^\s*(?:please\s+)?(?:text|message|dm|email)\b|(?:^|[^\p{L}])(?:reply|respond)\s+to\b`;
const SEND_ZH = String.raw`发(?:一[条條]|个|個)?\s*(?:消息|信息|短信|讯息|訊息|微信|邮件|郵件|私信)|发送|发给|發送|發給|发出|就发|回复|回覆|转发|轉發|回车|回車|傳(?:訊息|消息)|私信`;
const SOAN_ONLY = String.raw`(?:^|[^\p{L}])soạn\s+(?:tin(?:\s+nhắn)?|email|mail|thư)(?![\p{L}])`;
const PROOF_SEND = new RegExp(`${SEND_VI}|${SEND_EN}|${SEND_ZH}`, 'iu');
const REAL_SEND = new RegExp(`${SEND_VI}|${SOAN_ONLY}|${SEND_EN}|${SEND_ZH}`, 'iu');
const LOOK_ASK = /(?:^|[^\p{L}])(?:nhìn|nhin|ngó|ngo|xem|đọc|doc|quan sát|kiểm tra|cho\s+(?:mình|tôi|em|tớ)\s+biết|chỉ\s+(?:nhìn|nhin|xem|đọc)|look(?:\s+at)?|see\s+if|read|check|what(?:'s|\s+is|\s+does)?|is\s+(?:the|it|there)|tell\s+me|just\s+look|only\s+look)(?![\p{L}])|(?:^|[^\p{L}])is\s+["“']|(?:có|còn)\s+(?:chữ|gì|nội dung)|co\s+chu|trống\s+không|\bempty\b|看看|看一下|看一看|瞧一下|读一下|讀一下|告诉我|告訴我|有没有|有沒有|是不是|什么|什麼|只看|只读|只讀|检查|檢查/iu;
// Động từ gửi bị phủ định khi từ phủ định chi phối trực tiếp nó (có thể chen “được/bấm/có/press”).
// “không/ko” đứng ngay trước động từ là cấm gửi, kể cả “có chữ gì không gửi tin cho An luôn”
// và “chẳng lẽ không gửi … cho An” (từ chối nhầm được, gửi nhầm thì không).
// Chữ Hán viết liền, không có khoảng trắng: “不要发送”, “先别发出去”, “别按发送”.
const NEG_GOVERN = /(?:đừng|chớ|không(?:\s+được)?|chưa|ko|khoan|khỏi|khong(?:\s+duoc)?|don't|dont|do\s+not|never|without|hold\s+off(?:\s+on)?)\s+(?:(?:được|bấm|nhấn|ấn|nút|có|press|hit|on|the|a|an)\s+){0,3}$|(?:不要|先别|先別|别|別|勿|不)(?:\s*(?:按|点|点击|按下))*\s*$/iu;
const HAY_CONT = /(?:đừng|chớ|không|ko|chưa|khỏi|don't|dont|do\s+not|never|不要|别|別|勿)\s+(?:\p{L}+\s+){0,6}(?:hay|hoặc|or|或者)\s+$/iu;
function negatedBefore(s, index) {
  const pre = String(s || '').slice(Math.max(0, index - 48), index);
  if (NEG_GOVERN.test(pre) || HAY_CONT.test(pre)) return true;
  return /(?:^|[^\p{L}])dung\s*$/iu.test(pre);
}
// Cấm gửi khi BẤT KỲ từ phủ định hoặc cụm “chỉ nhìn” nằm trong câu lệnh.
// Không tính chữ trong ngoặc kép, và không tính nội dung tin không có ngoặc đứng sau dấu hai chấm
// (“Gửi tin cho An: đừng quên họp”). Phần sau ngoặc kép (“…: "nháp", đừng gửi”) vẫn tính.
// Riêng trong nội dung sau dấu hai chấm: lời rút lại (“À thôi, đừng gửi”, “never mind, don't send”, “算了别发”) vẫn cấm.
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\u00a0' || c === '\u3000';
const isColon = (c) => c === ':' || c === '\uff1a' || c === '\ufe55' || c === '\ufe13';
// Bỏ ký tự rộng bằng không trước khi phân loại, kẻo “đừ\u200bng gửi” không còn là “đừng gửi”.
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;
function stripZw(s) { return String(s || '').replace(ZERO_WIDTH, ''); }
const SEND_CAP = 16384;
// Gấp chữ để so từ cấm không dấu: bỏ dấu, đ→d, thường, ngoặc đơn cong → thẳng. Giữ nguyên ranh giới từ.
function foldNeg(s) {
  return stripZw(s).replace(/[\u2018\u2019\u201b]/g, "'").normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
// Chỉ cặp ngoặc ĐÓNG cùng họ mới là lời trích: "" “” 「」 『』 «». Dấu ' và ’ là dấu lược (’til, don’t), không phải ngoặc.
// Ngoặc không đóng không phải ngoặc. Quét một lần bằng ngăn xếp, tô vùng bằng mảng hiệu — tuyến tính.
const QUOTE_OPEN = { '"': '"', '\u201c': '\u201d', '\u300c': '\u300d', '\u300e': '\u300f', '\u00ab': '\u00bb' };
function quoteSkip(s) {
  const n = s.length;
  const skip = new Uint8Array(n);
  if (!n) return skip;
  const diff = new Int32Array(n + 1);
  const stack = [];
  for (let i = 0; i < n; i++) {
    const ch = s[i];
    const top = stack.length ? stack[stack.length - 1] : null;
    if (top && ch === top.close) {
      stack.pop();
      diff[top.start]++;
      diff[i + 1]--;
      continue;
    }
    const close = QUOTE_OPEN[ch];
    if (close) stack.push({ close, start: i });
  }
  let d = 0;
  for (let i = 0; i < n; i++) { d += diff[i]; if (d > 0) skip[i] = 1; }
  return skip;
}
function commandSurface(q, skip) {
  const s = String(q || '');
  if (!skip) skip = quoteSkip(s);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (skip[i]) { if (out.charAt(out.length - 1) !== ' ') out += ' '; continue; }
    if (isColon(s[i])) {
      let j = i + 1; while (j < s.length && isSpace(s[j])) j++;
      if (skip[j]) { out += ' '; continue; }
      break;
    }
    out += s[i];
  }
  return out;
}
// Phần tin không ngoặc sau dấu hai chấm đầu tiên. Dấu hai chấm mở ngoặc ĐÃ ĐÓNG thì đó là tin trong ngoặc.
function messageTail(q, skip) {
  const s = String(q || '');
  if (!skip) skip = quoteSkip(s);
  for (let i = 0; i < s.length; i++) {
    if (skip[i] || !isColon(s[i])) continue;
    let j = i + 1; while (j < s.length && isSpace(s[j])) j++;
    if (skip[j]) continue;
    let out = '';
    for (let k = j; k < s.length; k++) { if (skip[k]) { if (out.charAt(out.length - 1) !== ' ') out += ' '; } else out += s[k]; }
    return out;
  }
  return '';
}
// “không cần hỏi lại / no need to ask again / 不用再问” cấm HỎI, không cấm GỬI. Gỡ trước khi soi từ cấm.
function dropAsk(s) {
  return String(s || '')
    .replace(/(?:không|chẳng|chưa|đừng|chớ|ko|khỏi|khoan|cấm)\s+(?:cần\s+|phải\s+)?(?:hỏi(?:\s+lại)?|xác\s*nhận(?:\s+lại)?)/giu, ' ')
    .replace(/(?:don['’]t|do\s+not)\s+ask(?:\s+again)?/giu, ' ')
    .replace(/no\s+need\s+to\s+(?:ask|confirm)(?:\s+again)?/giu, ' ')
    .replace(/不用再问|无需再问|不必再问|不用确认|不必确认|不用再确认|无需确认|别再问|不要再问|不必再确认/gu, ' ');
}
function dropAskFold(s) {
  return String(s || '')
    .replace(/(?:khong|chang|chua|dung|ko|khoi|khoan|cam)\s+(?:can\s+|phai\s+)?(?:hoi(?:\s+lai)?|xac\s*nhan(?:\s+lai)?)/giu, ' ')
    .replace(/(?:don't|dont|do\s+not)\s+ask(?:\s+again)?/giu, ' ')
    .replace(/no\s+need\s+to\s+(?:ask|confirm)(?:\s+again)?/giu, ' ');
}
// Từ cấm trên câu lệnh (đã gỡ cụm “hỏi lại”). Bản gấp phủ hết NEG_GOVERN khi không dấu: dung/khong/chua/ko/khoi/khoan/thoi/dont…
const BLOCK_SEND = /(?:^|[^\p{L}])(?:tuyệt\s+nhiên|không|chẳng|chưa|đừng|chớ|ko|khoan|khỏi|cấm|thôi|don['’]t|dont|do\s+not|never|without|refrain|hold\s+off|no\s+need|not|no)(?![\p{L}])|(?:^|[^\p{L}])(?:xem\s+thôi|chỉ\s+xem|chỉ\s+nhìn|just\s+look|only\s+look)(?![\p{L}])|不要|不用|禁止|先别|先別|别|別|勿|不|看看就行|只看/iu;
const BLOCK_FOLD = /(?:^|[^\p{L}])(?:tuyet\s+nhien|khong|chang|chua|dung|ko|khoan|khoi|cam|thoi|don't|dont|do\s+not|never|without|refrain|hold\s+off|no\s+need|not|no)(?![\p{L}])|(?:^|[^\p{L}])(?:xem\s+thoi|chi\s+xem|chi\s+nhin|just\s+look|only\s+look)(?![\p{L}])/iu;
// Lời rút lại trong nội dung tin: từ cấm chi phối đúng động từ gửi, hoặc một mệnh đề huỷ (“never mind”, “算了”, “À thôi,”).
// “đừng quên họp” / “别忘了开会” / “chỉ xem thôi nhé” không có động từ gửi bị cấm → vẫn là nội dung tin.
const TAIL_SEND = /(?:^|[^\p{L}])(?:gửi|gui|nhắn|nhan|send(?:ing)?)(?![\p{L}])|发送|发给|发出|發送|發給|发(?!现|展|生|票)|發(?!現|展|生)/giu;
const TAIL_GOVERN = /(?:(?:^|[^\p{L}])(?:never\s+mind|do\s+not|don['’]t|thôi|đừng|khỏi|không|ko|wait|cancel)|算了|取消|不要|别|別)\s*(?:(?:được|bấm|nhấn|ấn|nút|có|mà|please|just|press|hit|on|the|a|an)\s+){0,3}$/iu;
const CANCEL_CLAUSE = /(?:^|[^\p{L}])never\s+mind(?![\p{L}])|算了|(?:^|[.!?。！？,，—–])\s*(?:à\s+)?thôi\s*[,，.!?。！？]/iu;
// Mệnh đề CUỐI của nội dung sau dấu hai chấm, nếu chỉ là lời huỷ (“Mà thôi”, “Cancel.”, “khỏi”, “不了”).
// “ăn thôi”, “xong rồi thôi về”, “không sao đâu”, “不去了” không phải lời huỷ.
const FINAL_CANCEL = /^(?:(?:mà|à)\s+)?(?:thôi(?:\s+khỏi)?|khỏi|huỷ|hủy|cancel|never\s+mind|forget\s+it)$/iu;
const FINAL_CANCEL_F = /^(?:(?:ma|a)\s+)?(?:thoi(?:\s+khoi)?|khoi|huy|cancel|never\s+mind|forget\s+it)$/iu;
const TAIL_GOVERN_F = /(?:(?:^|[^\p{L}])(?:never\s+mind|do\s+not|don't|dont|thoi|dung|khoi|khong|ko|wait|cancel)|算了|取消|不要|别|別)\s*(?:(?:duoc|bam|nhan|an|nut|co|ma|please|just|press|hit|on|the|a|an)\s+){0,3}$/iu;
function finalClauseCancels(tail) {
  const parts = String(tail || '').split(/[.!?。！？,，;；]+/u);
  let last = '';
  for (const p of parts) { const t = p.trim(); if (t) last = t; }
  return FINAL_CANCEL.test(last) || /^(?:算了|不了|取消)$/u.test(last) || FINAL_CANCEL_F.test(foldNeg(last));
}
function governedRetract(tail, govern) {
  const re = new RegExp(TAIL_SEND.source, 'giu');
  let m;
  while ((m = re.exec(tail))) {
    const at = m.index + (/^[^\p{L}]/u.test(m[0]) ? 1 : 0);
    if (govern.test(tail.slice(Math.max(0, at - 48), at))) return true;
    if (!m[0]) re.lastIndex++;
  }
  return false;
}
function tailRetracts(tail) {
  if (!tail) return false;
  if (CANCEL_CLAUSE.test(tail) || finalClauseCancels(tail)) return true;
  if (governedRetract(tail, TAIL_GOVERN)) return true;
  return governedRetract(foldNeg(tail), TAIL_GOVERN_F);
}
function blocksSend(q) {
  const s = stripZw(q);
  const skip = quoteSkip(s);
  const surface = dropAsk(commandSurface(s, skip));
  return BLOCK_SEND.test(surface) || BLOCK_FOLD.test(dropAskFold(foldNeg(surface))) || tailRetracts(messageTail(s, skip));
}
function keepAside(inner) { return REAL_SEND.test(inner) || KEEP_ASIDE.test(inner); }
function intentText(q) {
  let s = String(q || '');
  const drop = (re) => s.replace(re, (m) => {
    const inner = m.slice(1, -1);
    return keepAside(inner) ? ` ${inner} ` : ' ';
  });
  s = drop(new RegExp(PAREN_ASIDE.source, 'gu'));
  s = drop(new RegExp(QUOTE_ASIDE.source, 'gu'));
  return s.replace(new RegExp(COMPOSE_BOX.source, 'giu'), ' ');
}
// Có động từ gửi còn lại sau khi bỏ tên ô và chú thích. “tin nhắn” (danh từ) không tính. Động từ bị phủ định ngay trước cũng không tính.
function scanSend(s, reSrc) {
  const re = new RegExp(reSrc, 'giu');
  let pos = false; let neg = false; let m;
  while ((m = re.exec(s))) {
    // Mẫu có ranh giới từ đứng TRƯỚC động từ (“ nhắn”), nên “tin ” nằm ngay trước chữ, không phải trước chỗ khớp.
    const at = m.index + (/^[^\p{L}]/u.test(m[0]) ? 1 : 0);
    const noun = /(?:^|[^\p{L}])tin\s+$/iu.test(s.slice(Math.max(0, at - 8), at));
    if (!noun) { if (negatedBefore(s, at)) neg = true; else pos = true; }
    if (!m[0]) re.lastIndex++;
  }
  return { pos, neg };
}
function activeSend(q) { const s = stripZw(q); return scanSend(selfReport(intentText(s)), REAL_SEND.source).pos; }
// Động từ gửi thật (không tính “soạn/write/draft”) — QA đòi bằng chứng đã gửi, cổng phím coi là việc nhắn.
function hasSendVerb(q) { const s = stripZw(q); return scanSend(selfReport(intentText(s)), PROOF_SEND.source).pos; }
function lookOnly(q) {
  const raw = stripZw(q);
  const st = scanSend(selfReport(intentText(raw)), REAL_SEND.source);
  if (st.pos) return false; // còn động từ gửi không bị phủ định → không phải câu chỉ nhìn
  // Động từ gửi bị phủ định chỉ thành “chỉ nhìn” khi câu cũng xin nhìn hoặc nêu ô soạn.
  // “soạn sẵn … đừng gửi” không phải câu chỉ nhìn — QA vẫn đòi thấy chữ trong ô soạn.
  if (st.neg && (LOOK_ASK.test(raw) || COMPOSE_BOX.test(raw))) return true;
  if (!COMPOSE_BOX.test(raw)) return false;
  if (!LOOK_ASK.test(raw)) return false; // dấu ? một mình không đủ (“…send it to An?” vẫn là gửi)
  return true;
}
// Chỉ cho gửi khi có động từ gửi không bị phủ định, và phần lệnh không có từ cấm.
// Nội dung tin sau dấu hai chấm được bỏ qua, trừ lời rút lại việc gửi.
function allowsSend(q) {
  const raw = String(q || '');
  if (raw.length > SEND_CAP) return false; // câu quá dài: từ chối gửi, không quét ngoặc
  const s = stripZw(raw);
  if (blocksSend(s) || lookOnly(s)) return false;
  if (hasSendVerb(s)) return true;
  if (!msgSend(s)) return false;
  const proof = scanSend(selfReport(intentText(s)), PROOF_SEND.source);
  return !(proof.neg && !proof.pos);
}
// Việc nhắn/gửi tin thật. MSG_SEND xét trên câu GỐC (như trước B219): gỡ “ô soạn tin” cũng gỡ mất động từ “soạn tin”,
// cổng Ctrl+Enter hết biết đây là gửi. intentText chỉ dùng trong lookOnly. Câu chỉ nhìn thì không phải lệnh gửi.
const msgSend = (q) => { const s = stripZw(q); return lookOnly(s) ? false : MSG_SEND.test(selfReport(s)); };
function missingRecipient(query) {
  if (!msgSend(query)) return false;
  const q = selfReport(query); if (CURRENT_CHAT.test(q)) return false;
  return !recipientOf(q);
}
// câu chỉ nhìn: chữ nằm mỗi trong ngoặc đơn không phải nội dung tin cần gõ
function sourceQuery(query) {
  const q = String(query || '');
  return lookOnly(q) ? q.replace(new RegExp(PAREN_ASIDE.source, 'gu'), ' ') : q;
}
const ASKED_WHO = /^(?:⚠\s*)?(?:Gửi cho ai\?|Who should I send it to\?|发给谁？)/u;
// câu trả lời cho “Gửi cho ai?”: “đúng/yes/对/cuộc trò chuyện đang mở” = chat đang mở; còn lại là tên người nhận
const YES_CURRENT = /^\s*(?:đúng|đúng rồi|ừ|ok|okay|vâng|dạ|phải|yes|yep|right|correct|对|是|是的|好)\s*[.!]*\s*$/iu;
// B75 (QA lượt 8): trả lời “không / thôi, huỷ đi / no / 取消 / đúng rồi nhưng thôi đừng gửi” = HUỶ việc, không phải tên người nhận
const CANCEL_WHO = /^\s*(?:không|ko|khong|thôi|thoi|huỷ|hủy|huy|khỏi|no|nope|nah|cancel|stop|never ?mind|forget it)(?![\p{L}])|(?:^|[^\p{L}])(?:đừng gửi|không gửi|ko gửi|khỏi gửi|thôi khỏi|thôi đừng|huỷ đi|hủy đi|huỷ việc|hủy việc|don't send|do not send|cancel it|cancel that|never ?mind)(?![\p{L}])|^\s*(?:算了|取消|不要|不用|别|別|不发|不發|不了)|算了|取消|不要发|不要發|别发|別發/iu;
function cancelWho(reply) { return CANCEL_WHO.test(String(reply || '').trim()); }
// câu trả lời không giống một cái tên (dài, có động từ gửi/nhắn) → hỏi lại, không đoán
function unclearWho(reply) { const r = String(reply || '').trim(); if (!r) return true; if (YES_CURRENT.test(r) || CURRENT_CHAT.test(r)) return false;
  const words = r.split(/\s+/).length; return words > 6 || /(?:^|[^\p{L}])(?:gửi|nhắn|soạn|send|text|message|email|发送|发消息)(?![\p{L}])/iu.test(r) || notAName(r.replace(/^(?:cho|gửi cho|to|send to|给)\s+/iu, '')); }
const CANCEL_WHO_MSG = 'Đã huỷ — mình không gửi gì cả.';
function answerWho(prevTask, reply) {
  const r = String(reply || '').trim().replace(/^[“"']|[”"']$/g, '');
  if (YES_CURRENT.test(r) || CURRENT_CHAT.test(r)) return `${prevTask}\n(gửi vào cuộc trò chuyện hiện tại)`;
  return `${prevTask}\n(người nhận: ${r.replace(/^(?:cho|gửi cho|to|send to|给)\s+/iu, '').slice(0, 80)})`;
}
// B90: chữ gợi ý của ô soạn nêu tên cuộc trò chuyện đang mở: Zalo “Nhập @, tin nhắn tới X”, en “Type @ to mention, message to X” / “Message X”, zh “输入 @，发送消息给 X”
const COMPOSER_TO = [
  /^[|\s]*(?:nhập|nhap)\s*@?\s*[,，]?\s*(?:để nhắc tên\s*[,，]?\s*)?tin nhắn (?:tới|đến|gửi tới|cho)\s+(.+?)[\s.…]*$/iu,
  /^[|\s]*(?:type|enter|write|send)\b[^,]{0,30}[,，]?\s*(?:a\s+)?message (?:to|for)\s+(.+?)[\s.…]*$/iu,
  /^[|\s]*message\s+@?(.+?)[\s.…]*$/iu,
  /^[|\s]*(?:输入\s*@?\s*[^，,]{0,8}[，,]\s*)?(?:发送)?消息(?:发送)?(?:给|至|到)\s*(.+?)[\s。…]*$/u,
  /^[|\s]*(?:发消息给|发送给|发给)\s*(.+?)[\s。…]*$/u,
];
function composerTarget(texts = []) { for (const t of texts) { const x = String(t || '').trim(); if (!x || x.length > 120) continue; for (const re of COMPOSER_TO) { const m = re.exec(x); if (m && m[1] && m[1].length <= 60) return m[1].trim(); } } return null; }
// tên khớp CHẶT (cả cụm, không chỉ chứa từ) — dùng khi lượt này CHƯA tìm người nhận
// B97 (máy thật beta.2.3): dòng đầu khung chat đọc bằng OCR có rác — biểu tượng ảnh đại diện thành một ký tự lẻ (“Q My Documents”, “| Lan”),
// dòng phụ dưới tên (“Lưu và đồng bộ dữ liệu…”, “Vừa truy cập”, “Active now”), giờ (“2158”, “21:58”). Cổng người nhận (B90) và
// kiểm tra --approve-send-to dùng CHUNG cách làm sạch này.
const HEADER_SUB = /^(?:lưu và đồng bộ|luu va dong bo|vừa truy cập|vua truy cap|truy cập|truy cap|đang hoạt động|dang hoat dong|hoạt động|hoat dong|đang nhập|dang nhap|ngoại tuyến|trực tuyến|active|online|offline|last seen|seen|typing|sync|saved messages|在线|离线|刚刚|最近|上次|正在输入)/iu;
const HEADER_TIME = /^(?:\d{1,2}\s?[:h.]\s?\d{2}(?:\s?(?:am|pm|sa|ch))?|\d{3,4}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|hôm (?:nay|qua)|today|yesterday|今天|昨天)$/iu;
// B116: dòng tiêu đề khung chat không bao giờ là đường dẫn hay một câu dài (đó là bong bóng tin / khung xem trước liên kết)
const URLISH = /(?:https?:\/\/|www\.)\S|\b[\w-]+\.(?:com|net|org|io|vn|me|app|dev|ai|edu)(?:\.[a-z]{2})?\/\S*/iu;
function headerLike(x) { const t = String(x == null ? '' : x).trim(); return !!t && !URLISH.test(t) && t.length <= 64 && t.split(/\s+/).length <= 9; }
function cleanHeaderLine(x) {
  let t = String(x == null ? '' : x).normalize('NFC').replace(/\s+/g, ' ').trim();
  // ký tự lẻ đứng đầu (biểu tượng/ảnh đại diện OCR thành “Q”, “|”, “©”…) + phần sau còn ít nhất 2 chữ cái
  const m = /^(\S)\s+(.+)$/u.exec(t); if (m && [...m[1]].length === 1 && !/\d/.test(m[1]) && /\p{L}.*\p{L}/u.test(m[2])) t = m[2].trim();
  t = t.replace(/^[|•·©®@#*>»›\-–—:]+\s*/u, '').replace(/\s*[|•·]+$/u, '').trim();
  // giờ dính ở cuối dòng tiêu đề (“My Documents 21:58”)
  t = t.replace(/\s+\d{1,2}[:h.]\d{2}$/u, '').trim();
  return t;
}
function cleanHeader(lines = []) {
  const out = [];
  for (const x of [].concat(lines || [])) {
    const t = cleanHeaderLine(x); const f = fold(t);
    if (!t || f.replace(/\s/g, '').length <= 1 || HEADER_TIME.test(t) || HEADER_SUB.test(t) || HEADER_SUB.test(f) || !headerLike(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
const exactName = (names, x) => { const kx = nameKey(x); return !!kx && names.some(n => nameKey(n) === kx); };
function chatGate({ query, text, searchField = false, submit = false, proc = '', title = '', state = {}, header = [], ocrHeader = null, seenHeader = null, composer = [] }) {
  if (!isChatContext(query, proc, title)) return null;
  // B219: câu chỉ nhìn ô soạn — không hỏi “Gửi cho ai?”. Mọi lần gõ vào ô chưa xác nhận là ô tìm kiếm đều bị chặn
  // (kể cả chữ nằm trong ngoặc kép của câu hỏi, ví dụ Is "hi" in the message box?): gõ rồi Enter sẽ lọt cổng B108.
  if (lookOnly(query)) {
    if (searchField) return null;
    return LOOK_REFUSE;
  }
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
    if (!submit && !/\n\s*$/.test(String(text || '')) && !SEND_INTENT.test(selfReport(query)) && !SAY_INTENT.test(selfReport(query))) return null; // gõ chữ không kèm Enter, câu lệnh không phải gửi/nói với ai → không phải gửi tin
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
  const hdr0 = cleanHeader(header.filter(Boolean)).filter(h => !MENU_BAR(h)); // B97: cùng cách làm sạch với kiểm tra --approve-send-to
  // B124: lần tìm gần nhất KHÔNG thấy người nhận → chữ “đầu khung” trùng đúng chữ vừa gõ tìm là chữ còn trong Ô TÌM KIẾM, không phải tiêu đề (chỉ chặt hơn, không bao giờ nới)
  const lastS = Array.isArray(state.searches) && state.searches.length ? state.searches[state.searches.length - 1] : null;
  const hdr = lastS && lastS.found === false ? hdr0.filter(h => fold(h).trim() !== fold(lastS.text).trim()) : hdr0;
  // B27: màn hình (tiêu đề cửa sổ “Ứng dụng - Tên”, hoặc đầu khung chat đúng tên) cho thấy ĐÚNG người nhận → cho gõ, không dựa vào cờ nội bộ
  // tiêu đề cửa sổ (do hệ điều hành báo) là bằng chứng chắc; chữ OCR ở đầu khung chỉ được tin khi lượt này ĐÃ tìm người nhận (có thể là chữ khác lọt vào vùng đầu khung)
  const al = state.aliases || [];
  // B97: ghi lại chữ gợi ý ô soạn (“Nhập @, tin nhắn tới X”) KHỚP CHẶT người nhận trong lượt này — sau khi gõ nội dung, chữ gợi ý biến mất
  { const ct0 = composerTarget(composer); if (ct0 && exactName(namesFor(recipient, al), ct0)) state.placeholderSeen = { key: k, name: ct0 }; }
  if (chatShown(recipient, title, [], al) || (state.lastSearch && chatShown(recipient, title, hdr, al))) { state.chatOpen = k; return null; }
  // B90 (máy thật beta.2.1): đúng cuộc trò chuyện ĐÃ mở sẵn (không tìm trong lượt này) — tiêu đề khung giữa hoặc chữ gợi ý ô soạn
  // trùng KHỚP CHẶT với người nhận / tên khác (Cloud của tôi = My Documents = My Cloud…) → cho gõ
  const names = namesFor(recipient, al); const ct = composerTarget(composer);
  if (!ct || exactName(names, ct)) {
    const hit = hdr.find(h => exactName(names, h)) || (ct && exactName(names, ct) ? ct : null);
    if (hit) { state.chatOpen = k; state.openedBy = hdr.includes(hit) ? 'header' : 'composer'; state.gateNote = `cuộc trò chuyện “${hit}” đã mở sẵn (${state.openedBy === 'header' ? 'tiêu đề khung giữa' : 'chữ gợi ý ô soạn'}) = “${recipient}”`; return null; }
  }
  // ô soạn ghi rõ đang nhắn cho NGƯỜI KHÁC → nói thẳng, bảo TÌM (bấm ô soạn không đổi được người nhận)
  if (ct && !exactName(names, ct) && !nearName) return `CHƯA gõ tin: ô soạn đang ghi “tin nhắn tới ${String(ct).slice(0, 40)}” — cuộc trò chuyện đang mở là “${String(ct).slice(0, 40)}”, KHÔNG phải “${recipient}”. ĐỪNG bấm vào ô soạn (bấm ô soạn không đổi người nhận). Làm lần lượt: 1) screen_act click vào ô Tìm kiếm của ứng dụng; 2) type_text "${recipient}"; 3) click vào kết quả đúng tên “${recipient}”; 4) rồi mới gõ tin.`;
  if (state.chatOpen === k) {
    // đã mở đúng người, nhưng nếu tiêu đề đọc được mà lại là người khác (vd. ứng dụng tự nhảy cuộc trò chuyện) thì vẫn chặn
    if (hdr.length && !hdr.some(h => namesFor(recipient, al).some(n => headerMatches(n, h)))) return `Tiêu đề cuộc trò chuyện hiện là “${String(hdr[0]).slice(0, 40)}”, không phải “${recipient}”. Tìm lại “${recipient}” trong ô tìm kiếm của ứng dụng, bấm vào đúng kết quả rồi mới gõ tin.`;
    return null;
  }
  if (nearName) { return `KHÔNG gõ “${String(text).slice(0, 40)}”: ô đang nhận chữ CHƯA được xác nhận là ô Tìm kiếm (có thể là ô soạn tin của cuộc trò chuyện đang mở${header.filter(Boolean).length ? ` “${String(header.filter(Boolean)[0]).slice(0, 40)}”` : ''} — gõ tên + Enter ở đó sẽ GỬI tên thành tin nhắn). Làm lần lượt: 1) screen_act click vào ô/chữ “Tìm kiếm” của ứng dụng; 2) type_text "${recipient}" với element là CHÍNH ô tìm kiếm đó; 3) bấm vào kết quả đúng tên “${recipient}”. Nếu tên “${recipient}” đã hiện sẵn trong danh sách bên trái, bấm thẳng vào tên đó thay vì gõ.`; }
  return `CHƯA gõ tin: AIVN AGENT phải TÌM và MỞ cuộc trò chuyện với “${recipient}” trước (bấm vào ô soạn tin KHÔNG đổi được người nhận — đừng bấm ô soạn), không gõ vào cuộc trò chuyện đang mở sẵn${hdr.length ? ` (đang mở: “${String(hdr[0]).slice(0, 40)}”)` : ''}. Làm lần lượt: 1) screen_act click vào ô Tìm kiếm của ứng dụng; 2) type_text "${recipient}"; 3) click vào kết quả đúng tên “${recipient}”; 4) rồi mới gõ tin nhắn.`;
}
const SEEN_QUESTION = 'Trả lời đúng định dạng, chép đúng chữ trên màn hình:\nTÊN: <tên người/nhóm ở đầu khung trò chuyện đang mở>\nÔ SOẠN: <chữ còn trong ô soạn tin, hoặc TRỐNG>\nTIN: <tin nhắn cuối cùng trong khung trò chuyện>\nTIN: <tin nhắn trước đó>';
// B94 (máy thật beta.2.2): ô SOẠN TIN — chữ gợi ý “Nhập @, tin nhắn tới X” / “Type a message” / “Message X” / “输入消息”, hoặc ô nhập ở đáy khung chat; không bao giờ là ô tìm kiếm
const SEARCHY_EL = /tìm|tim kiem|search|find|搜索|查找/iu;
function isComposerEl(e, win) {
  if (!e) return false;
  if (SEARCHY_EL.test(`${e.name || ''} ${e.autoId || ''} ${e.placeholder || ''}`)) return false;
  const ts = [e.placeholder, e.name].filter(Boolean).map(x => String(x).trim());
  if (ts.some(x => composerTarget([x]) || COMPOSER_HINT.test(x))) return true;
  // ô nhập (không phải OCR) nằm ở đáy cửa sổ, bên phải danh sách hội thoại: ô soạn tin đã có chữ (chữ gợi ý không còn)
  const W = win && Array.isArray(win.b) && win.b[3] > 50 ? win.b : null;
  return !!(W && e.editable && !e.ocr && Array.isArray(e.b) && (e.b[1] + e.b[3] / 2 - W[1]) / W[3] > 0.8 && (e.b[0] - W[0]) / W[2] > 0.08);
}
function findComposer(obs) {
  // chỉ trong cửa sổ đích: có khung cửa sổ → tâm phần tử phải nằm trong khung; không có khung (OCR cả màn hình) → chữ OCR phải nêu tên cuộc trò chuyện (“… tới X”),
  // không nhận chữ gợi ý chung chung (“Nhập tin nhắn...” có thể là ô của cửa sổ khác, vd. chính AIVN)
  const W = obs && obs.win && Array.isArray(obs.win.b) && obs.win.b[2] > 50 && obs.win.b[3] > 50 ? obs.win.b : null;
  const inWin = (e) => W ? (e.b[0] + e.b[2] / 2 >= W[0] && e.b[0] + e.b[2] / 2 <= W[0] + W[2] && e.b[1] + e.b[3] / 2 >= W[1] && e.b[1] + e.b[3] / 2 <= W[1] + W[3]) : (!e.ocr || !!composerTarget([e.placeholder, e.name]));
  const els = ((obs && obs.elements) || []).filter(e => Array.isArray(e.b) && inWin(e) && isComposerEl(e, obs.win));
  return els.sort((a, b) => (b.editable ? 1 : 0) - (a.editable ? 1 : 0) || (composerTarget([b.placeholder, b.name]) ? 1 : 0) - (composerTarget([a.placeholder, a.name]) ? 1 : 0) || b.b[1] - a.b[1])[0] || null;
}
// B94: ô tìm kiếm còn chữ sót (Zalo: khi đang tìm, cạnh ô hiện nút “Đóng”) — trả phần tử chữ trong ô để bấm vào rồi xoá
const CLOSE_TOK = /(?:^|[\s|│])(?:đóng|dong|close|关闭)(?=$|[\s|│])/iu;
function searchRowOf(obs) {
  let W = obs && obs.win && Array.isArray(obs.win.b) && obs.win.b[3] > 50 ? obs.win.b : null;
  if (!W) { const els = ((obs && obs.elements) || []).filter(e => Array.isArray(e.b) && e.b.length >= 4); if (els.length < 3) return null; // giống regionsOf: khung theo các phần tử
    const x0 = Math.min(...els.map(e => e.b[0])), y0 = Math.min(...els.map(e => e.b[1])), x1 = Math.max(...els.map(e => e.b[0] + e.b[2])), y1 = Math.max(...els.map(e => e.b[1] + e.b[3])); W = [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)]; }
  const top = (e) => Array.isArray(e.b) && (e.b[1] + e.b[3] / 2 - W[1]) / W[3] < 0.16 && (e.b[0] - W[0]) / W[2] < 0.35;
  return { W, top, els: ((obs && obs.elements) || []).filter(top) };
}
// chữ trong hàng ô tìm kiếm (để so trước/sau khi gõ)
function searchRowText(obs) { const r = searchRowOf(obs); return r ? r.els.slice().sort((a, b) => a.b[0] - b.b[0]).map(e => String(e.name || e.value || '')).join(' ') : ''; }
function searchLeftover(obs) {
  const els = ((obs && obs.elements) || []).filter(e => Array.isArray(e.b));
  const f = els.find(e => e.focused && !e.ocr && SEARCHY_EL.test(`${e.name || ''} ${e.autoId || ''} ${e.placeholder || ''}`));
  if (f && String(f.value || '').trim()) return f;
  const R = searchRowOf(obs); if (!R) return null;
  const nf = (x) => String(x || '').normalize('NFC');
  const close = R.els.find(e => CLOSE_TOK.test(nf(e.name)));
  if (!close) return null;
  const meaningful = (x) => String(x || '').replace(/(?:^|\s)[QqØø](?=\s|$)/g, ' ').replace(/[^\p{L}\p{N}]/gu, '').length >= 2;
  // OCR gộp chữ trong ô với nút “Đóng” (“| Q AivN… Ø| Đóng”): phần đứng trước “Đóng”
  const pre = nf(close.name).split(CLOSE_TOK)[0];
  if (meaningful(pre) && !/^[|\s]*(?:tìm kiếm|tim kiem|search|搜索)[|\s…]*$/iu.test(pre)) return { ...close, name: pre.trim(), b: [close.b[0], close.b[1], Math.max(20, Math.round(close.b[2] * pre.length / Math.max(1, String(close.name).length))), close.b[3]] };
  const cy = close.b[1] + close.b[3] / 2;
  return R.els.filter(e => e !== close && Math.abs(e.b[1] + e.b[3] / 2 - cy) <= Math.max(14, close.b[3]) && e.b[0] < close.b[0] && !/^[|\s]*(?:tìm kiếm|tim kiem|search|搜索)[|\s…]*$/iu.test(String(e.name || '')) && meaningful(e.name))
    .sort((a, b) => b.b[2] - a.b[2])[0] || null;
}
// B94: nút “Đóng” của ô tìm kiếm đang mở (Zalo) — bấm vào để thoát tìm kiếm + xoá chữ khi OCR không đọc được chữ trong ô. Trả điểm bấm (ước theo vị trí chữ trong cụm OCR)
function searchClose(obs) {
  const R = searchRowOf(obs); if (!R) return null;
  for (const e of R.els) {
    const n = String(e.name || '').normalize('NFC'); const m = /(^|[\s|│])(đóng|dong|close|关闭)(?=$|[\s|│])/iu.exec(n); if (!m) continue;
    const i0 = m.index + m[1].length, i1 = i0 + m[2].length, L = Math.max(1, n.length);
    return { x: Math.round(e.b[0] + e.b[2] * ((i0 + i1) / 2) / L), y: Math.round(e.b[1] + e.b[3] / 2), el: e };
  }
  return null;
}
// chữ gõ có phải TÊN người nhận (gõ vào ô tìm kiếm) hay là NỘI DUNG tin
function nameLikeText(text, recipient) {
  if (!recipient) return false;
  const norm = (x) => fold(String(x || '')).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const ty = norm(text), nf = norm(recipient), nk = norm(nameKey(recipient));
  return !!ty && (ty === nf || ty === nk || (ty.length >= 2 && (nf.includes(ty) || nk.includes(ty))) || namesFor(recipient).some(n => norm(n) === ty));
}
// B108 (máy thật beta.2.5, AN TOÀN): “mở Zalo và mở chat Cloud của tôi” (không có nội dung tin) → mô hình gõ “@My Documents” rồi xin GỬI “Chào bạn!” tự bịa.
// Nội dung một bước GỬI (hoặc chữ gõ vào ô soạn tin) phải lấy từ YÊU CẦU của người dùng: trong ngoặc kép, hoặc nêu rõ (“nhắn Lan là mai 8h họp”).
// Đo: các từ NỘI DUNG của chữ (bỏ lời chào/đại từ/từ đệm) phải có trong câu lệnh (không dấu) — ít nhất 1 từ và ≥ 70%.
const FILLER = new Set(['chao', 'ban', 'nhe', 'nha', 'nhe', 'a', 'oi', 'hi', 'hello', 'hey', 'minh', 'toi', 'em', 'anh', 'chi', 'to', 'cau', 'nhá', 'ha', 'the', 'and', 'i', 'you', 'ok', 'okay', 'thanks', 'cam', 'on', 'vang', 'da', 'u', 'uh', 'nhi', 'nhe', '你好', '您好']);
function quotedIn(query) { const out = []; const s = sourceQuery(query); const re = /["“«]([^"”»]{1,400})["”»]/gu; let m; while ((m = re.exec(s))) out.push(m[1]); return out; }
function textFromRequest(query, text) {
  const q = sourceQuery(query); const tx = String(text || '').replace(/\n\s*$/, '').trim(); if (!tx) return false;
  const norm = (x) => fold(x).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const nt = norm(tx), nq = norm(q); if (!nt) return false;
  if (quotedIn(q).some(z => norm(z) === nt) || (` ${nq} `).includes(` ${nt} `)) return true;
  const qset = new Set(nq.split(' ')); const words = nt.split(' ').filter(w => !FILLER.has(w));
  // chữ Hán: so theo ký tự
  if (/[\u3400-\u9fff]/u.test(tx)) { const cs = [...tx.replace(/[^\u3400-\u9fff]/gu, '')]; const hit = cs.filter(c => q.includes(c)).length; return cs.length > 0 && hit / cs.length >= 0.7; }
  if (!words.length) return false;
  const hit = words.filter(w => qset.has(w)).length; return hit >= 1 && hit / words.length >= 0.7;
}
// B96: phần tử là tệp / tệp đính kèm / ô xem trước (danh sách File, ảnh, video…) — bấm vào sẽ MỞ tệp bằng ứng dụng khác
const FILE_NAME = /\.(xlsx?|xlsm|csv|docx?|rtf|odt|pptx?|pdf|zip|rar|7z|txt|png|jpe?g|gif|webp|heic|bmp|mp4|mov|avi|mkv|mp3|wav|m4a|exe|msi|apk|psd)\b/i;
const FILE_UI = /^(?:ảnh\s*\/\s*video|ảnh|video|file|tệp|tệp tin|tệp đính kèm|photos?(?:\s*\/\s*videos?)?|files?|attachments?|media|图片|视频|文件|附件|图片\/视频)$/iu;
function isFileTarget(name, el) {
  const n = String(name || '').trim();
  return FILE_NAME.test(n) || FILE_UI.test(n) || !!(el && /image|thumbnail|hình|ảnh/iu.test(String(el.kind || el.role || '')) && !/button|nút/iu.test(String(el.kind || '')));
}
// tên tệp OCR bị xuống dòng (“marketing cleaned” + dòng dưới “data.xlsx”): xét cả dòng ngay trên/dưới cùng cột
function fileAt(el, obs) {
  if (!el) return false; if (isFileTarget(el.name, el)) return true;
  if (!Array.isArray(el.b)) return false; const E = el.b;
  return ((obs && obs.elements) || []).some(e => e !== el && Array.isArray(e.b) && FILE_NAME.test(String(e.name || '')) && Math.abs((e.b[1] + e.b[3] / 2) - (E[1] + E[3] / 2)) <= Math.max(E[3], e.b[3]) * 1.9 + 4 && e.b[0] < E[0] + E[2] && e.b[0] + e.b[2] > E[0]);
}
// việc có nhắc tới tệp/đính kèm (bỏ phần nội dung tin trong ngoặc kép)
const WANTS_FILE = /tệp|tep|file|đính kèm|dinh kem|attach|tài liệu|ảnh|hình|photo|picture|video|mở\s+(?:tệp|file)|文件|附件|图片|照片/iu;
function wantsFiles(query) { return WANTS_FILE.test(String(query || '').replace(/[“"«][^”"»]*[”"»]/g, ' ')); }
// Lệnh CHỈ SOẠN (không gửi) — một nguồn cho desktop-agent (B101 không tự bấm Enter), agent.js, qa-runner.
// Gồm cả cách nói “soạn nháp / bản nháp / write a draft / draft a message / compose … / 起草 / 草拟 / 写一封 … 的消息”.
const DRAFT_ONLY = /(chỉ soạn|soạn sẵn|soạn nháp|viết sẵn|viết nháp|bản nháp|không gửi|đừng gửi|chưa gửi|khoan gửi|don't send|do not send|without sending|not send|draft only|a draft|draft (?:a |an |the )?(?:message|email|mail|text|reply)|compose (?:a |an )?(?:message|email|draft)|只起草|起草|草拟|草稿|写一[封条]|不要发送|别发送|先不要发|不发送)/iu;
// b64 (lỗi chập chờn): OCR đọc chữ gợi ý ô tìm kiếm kèm nhiễu viền/biểu tượng (“[Tim kiếm trên Messenger”, “Q Tìm kiếm”, “| Search”) và có khi mất dấu
// → không nhận ra là chữ gợi ý → chữ vừa gõ ở đúng chỗ đó bị coi là KẾT QUẢ thứ hai → báo nhầm “nhiều người cùng tên”. Bỏ nhiễu đầu dòng, so cả không dấu.
function placeholderLike(name) {
  const t = String(name || '').replace(/^(?:[^\p{L}\p{N}]+|[QqO]\s+)+/u, '').trim();
  return /^(?:tìm|search|find|nhập|enter|type|搜索|查找)/iu.test(t) || /^(?:tim kiem|nhap)\b/.test(fold(t));
}
const LOOK_REFUSE = 'KHÔNG gõ và KHÔNG gửi: câu này chỉ yêu cầu nhìn màn hình và trả lời, không soạn và không gửi.';
const SEND_BLOCK = 'KHÔNG gửi: câu này không phải lệnh gửi rõ ràng, nên không bấm Enter, Ctrl+Enter, Alt+S hay nút gửi.';
module.exports = { headerLike, textFromRequest, quotedIn, selfReport, msgSend, lookOnly, allowsSend, hasSendVerb, intentText, placeholderLike, DRAFT_ONLY, LOOK_REFUSE, SEND_BLOCK, cleanHeader, cleanHeaderLine, searchClose, searchRowText, fileAt, searchLeftover, isComposerEl, findComposer, nameLikeText, isFileTarget, wantsFiles, FILE_NAME, composerTarget, COMPOSER_TO, namesFor, ALIASES, FORMER, cancelWho, unclearWho, CANCELLED_WHO: CANCEL_WHO_MSG, notAName, missingRecipient, MSG_SEND, CURRENT_CHAT, currentChatName, askWho, ASK_WHO, ASKED_WHO, answerWho, chatShown, APP_TITLE, sameNameCandidates, onlyName, parenNotes, chatGate, typingName, relates, isChatContext, regionsOf, recipientOf, nameSeen, nameKey, headerMatches, isSendAction, verifySend, parseSeen, SEEN_QUESTION, fold };
