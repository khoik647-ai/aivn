'use strict';
// B16 (QA lượt 2): nhận ý định thao tác hệ thống theo CẤU TRÚC, từng mệnh đề một, thay vì dò từ khoá trên cả câu.
// Người dùng chỉ được coi là ĐÃ YÊU CẦU một thao tác hệ thống khi có một mệnh đề:
//   - là câu mệnh lệnh (không phải câu hỏi “làm sao/tại sao/…?”),
//   - không bị phủ định (“đừng/không được/không/chớ/cấm/don't”),
//   - có ĐỘNG TỪ + ĐỐI TƯỢNG đúng của thao tác đó (có ranh giới từ: “nhạc” không chứa “hạ”),
//   - và (với tắt tiếng) đối tượng là âm thanh của cả máy, không phải của một ứng dụng (“tắt tiếng thông báo zalo”).
// Không yêu cầu → công cụ system_action luôn hiện thẻ hỏi.
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// tách câu thành các mệnh đề: dấu câu và từ nối (“rồi”, “sau đó”, “và”, “xong”, “then”, “and”)
function clauses(query) {
  return fold(query).split(/[.;!\n]+|,|\?|\b(?:roi|sau do|xong|va|then|and|nhung|but)\b/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
// câu có dấu hỏi / từ để hỏi → hỏi cách làm hoặc hỏi lý do, không phải ra lệnh
const QUESTION = /\b(lam sao|lam the nao|the nao|bang cach nao|cach (?:nao|de)?|tai sao|vi sao|sao lai|sao may|how|why|what|co nen|nen (?:khong|ko)|la gi|o dau|huong dan)\b/;
// phủ định đứng trước động từ trong cùng mệnh đề
const NEG = /\b(dung|khong duoc|khong can|khong|ko|k|chang|cam|khoi|dung co|don'?t|do not|never|not|no)\b/;
// lời nhờ lịch sự kết thúc bằng “được không/nhé” vẫn là yêu cầu (“khoá máy giúp mình được không”), chỉ khi có “giúp/hộ/cho …”
const POLITE = /\b(giup|ho|di|nhe|nha|voi|please|cho (?:toi|minh|em|tui))\b/;

// mỗi thao tác: động từ (verb) + đối tượng (obj); `forbidAfter`: từ chỉ đối tượng hẹp hơn làm mệnh đề không còn là thao tác toàn máy
const W = (s) => String.raw`(?:^|\s)(?:${s})(?=\s|$)`;
const RULES = {
  lock: [new RegExp(`${W('khoa|lock')}\\s+(?:lai\\s+)?(?:man hinh|may|may tinh|screen|pc|computer|windows)`), new RegExp(`${W('lock')}\\s*$`)],
  sleep: [new RegExp(`${W('cho may|de may|dua may')}\\s+(?:di\\s+)?ngu`), new RegExp(`${W('sleep')}`), new RegExp(`${W('ngu dong')}`)],
  shutdown: [new RegExp(`${W('tat may|tat may tinh|shut ?down|power off')}`)],
  restart: [new RegExp(`${W('khoi dong lai|restart|reboot')}`)],
  volume_up: [new RegExp(`${W('tang|vang to|van to|mo to|cho to|to len|lon len')}\\s+(?:\\S+\\s+){0,2}?(?:am luong|tieng|loa)`), new RegExp(`${W('am luong|tieng|loa')}\\s+(?:\\S+\\s+){0,2}?(?:to|lon)\\s+(?:len|hon)`), new RegExp(`${W('volume up|turn up')}`)],
  volume_down: [new RegExp(`${W('giam|van nho|cho nho|ha|nho lai|bot')}\\s+(?:\\S+\\s+){0,2}?(?:am luong|tieng|loa)`), new RegExp(`${W('am luong|tieng|loa')}\\s+(?:\\S+\\s+){0,2}?nho\\s+(?:lai|xuong|hon|bot)`), new RegExp(`${W('volume down|turn down')}`)],
  mute: [new RegExp(`${W('tat|bat|mo')}\\s+(?:tieng|am thanh|loa)`), new RegExp(`${W('im lang|mute|unmute')}`)],
  open_settings: [new RegExp(`${W('mo|vao|bat|open')}\\s+(?:phan\\s+)?(?:cai dat|settings|thiet lap)(?:\\s+(?:he thong|may|windows|may tinh))?\\s*(?:$|giup|ho|di|nhe|nha|cho)`)],
  show_desktop: [new RegExp(`${W('hien|ve|ra|show|mo')}\\s+(?:man hinh chinh|desktop)`), new RegExp(`${W('thu nho')}\\s+(?:het|tat ca|moi)`)],
  empty_trash: [new RegExp(`${W('don|xoa|lam trong|empty')}\\s+(?:sach\\s+)?(?:thung rac|trash|recycle bin)`)],
};
// tắt tiếng / chỉnh âm lượng của RIÊNG một ứng dụng hay thông báo → không phải thao tác toàn máy
const NARROW = /\b(thong bao|notification|cua (?!may|he thong)|tren |trong |o |zalo|messenger|facebook|youtube|spotify|chrome|tab|video|ung dung|app|nhom|cuoc goi|tin nhan|game)\b/;
const NARROW_OK = new Set(['volume_up', 'volume_down', 'mute']);

function clauseAsks(action, c) {
  const rules = RULES[action]; if (!rules) return false;
  for (const re of rules) {
    const m = re.exec(c); if (!m) continue;
    const before = c.slice(0, m.index);
    if (NEG.test(before.split(/\s+/).slice(-4).join(' '))) return false; // “đừng khoá…”, “không được khoá…”, “máy tôi không tự khoá…”
    if (/\b(tu|hay tu|bi|tu dong)\s*$/.test(before)) return false; // “máy hay tự khoá màn hình” mô tả, không phải lệnh
    if (NARROW_OK.has(action) && NARROW.test(c.slice(m.index + m[0].length))) return false;
    return true;
  }
  return false;
}
// người dùng có yêu cầu đúng thao tác này không (áp lên câu của lượt hiện tại)
function sysAsked(action, query) {
  const raw = String(query || '');
  const all = fold(raw);
  const cl = clauses(raw);
  // câu hỏi: nguyên câu có dấu “?” hay từ để hỏi, trừ lời nhờ lịch sự (“… giúp mình được không?”)
  const isQ = (c, whole) => QUESTION.test(c) || (/\?/.test(whole) && !POLITE.test(c) && !/\b(duoc khong|dc ko|duoc ko|nhe|nha)\b/.test(c));
  // mệnh đề chứa “?”: cần biết mệnh đề nào kết thúc bằng “?”
  const qParts = new Set(); fold(raw).split(/(?<=[?.!;\n])/).forEach(seg => { if (/\?\s*$/.test(seg)) clauses(seg).forEach(c => qParts.add(c)); });
  return cl.some(c => !isQ(c, qParts.has(c) ? '?' : '') && clauseAsks(action, c)) && !!all;
}
// B44: “tăng âm lượng lên 100”, “đặt âm lượng 30%”, “chỉnh âm lượng về 50”, “set volume to 40” → mức âm lượng 0..100
// B89 (máy thật): “tăng âm lượng thêm 10%” / “giảm âm lượng 20%” / “turn the volume up by 10%” là THAY ĐỔI tương đối (±N), không phải đặt mức N;
// “lên/xuống/về/thành/mức/to N”, “âm lượng 30”, “đặt âm lượng 30%” là đặt mức tuyệt đối
const VOL_RE = /(?:^|\s)(?:tang|giam|dat|chinh|de|cho|keo|van|set|change|turn|increase|decrease|raise|lower)?\s*(?:\S+\s+){0,2}?(?:am luong|volume|loa|tieng)\s+(?:\S+\s+){0,2}?(?:len|xuong|thanh|ve|o|muc|bang|to|=|:)?\s*(\d{1,3})\s*(?:%|phan tram|percent)?(?=\s|$)/;
const ABS_BEFORE = new Set(['len', 'xuong', 've', 'thanh', 'muc', 'bang', 'to', '=', ':', 'o', 'at']);
const REL_BEFORE = new Set(['them', 'bot', 'by', 'tang', 'giam', 'up', 'down', 'increase', 'decrease', 'raise', 'lower', 'nua', 'khoang']);
function volumeParse(query) {
  for (const c of clauses(query)) {
    const m = VOL_RE.exec(c); if (!m) continue;
    // phủ định: VOL_RE có thể bắt đầu khớp từ chính chữ “đừng/không” (phần đệm) → xét cả đoạn tới động từ
    const before = c.slice(0, m.index + m[0].search(/am luong|volume|loa|tieng/)); if (NEG.test(before.split(/\s+/).slice(-5).join(' ')) || QUESTION.test(c)) continue;
    const n = Number(m[1]); if (!(n >= 0 && n <= 100)) continue;
    const head = c.slice(0, m.index + m[0].lastIndexOf(m[1])).trim(); const pre = head.split(/\s+/).pop() || '';
    const up = /(?:^|\s)(?:tang|them|to len|lon len|increase|raise|up|turn up)(?=\s|$)/.test(head), down = /(?:^|\s)(?:giam|bot|nho lai|ha|decrease|lower|down|turn down)(?=\s|$)/.test(head);
    const setVerb = /(?:^|\s)(?:dat|chinh|set|de)(?=\s|$)/.test(head);
    const rel = !setVerb && (REL_BEFORE.has(pre) || (!ABS_BEFORE.has(pre) && (up || down)) || ((up || down) && /(?:^|\s)(?:them|bot|by|nua)(?=\s)/.test(head)));
    if (rel && (up || down) && !(up && down)) return { delta: up ? n : -n };
    return { level: n };
  }
  return null;
}
function volumeLevel(query) { const v = volumeParse(query); return v && v.level != null ? v.level : null; }
function volumeDelta(query) { const v = volumeParse(query); return v && v.delta != null ? v.delta : null; }
// B44: câu CHỈ là một lệnh hệ thống rõ ràng, không phải bước của việc khác → làm ngay, không cần mô hình (mô hình nhỏ hay in lệnh ra chữ thay vì gọi)
const DIRECT_OK = ['volume_up', 'volume_down', 'mute', 'lock', 'show_desktop', 'open_settings'];
function directSys(query) {
  const raw = String(query || '').trim(); if (!raw || raw.length > 80) return null;
  const dv = volumeDelta(raw); if (dv != null) return { action: 'volume_change', level: dv };
  const lv = volumeLevel(raw); if (lv != null) return { action: 'volume_set', level: lv };
  const hits = DIRECT_OK.filter(a => sysAsked(a, raw)); if (hits.length !== 1) return null;
  // còn việc khác trong câu (“tăng âm lượng rồi mở YouTube”) → để mô hình làm cả chuỗi
  if (clauses(raw).filter(c => !Object.keys(RULES).some(a => clauseAsks(a, c)) && !/^(?:giup|ho|di|nhe|nha|voi|please|cho (?:toi|minh|em)|ok|nao|len|xuong|ngay|luon)(?:\s|$)/.test(c)).length) return null;
  return { action: hits[0] };
}
// B157 (máy thật beta.2.7: việc “tìm giá vàng trên Chrome” lại mở Cài đặt hệ thống): thao tác hệ thống chỉ được XÉT khi việc có liên quan
// tới nó (chủ đề). Không liên quan → từ chối ngay, không hiện thẻ xin phép (thẻ có thể bị “Tự làm không hỏi” tự đồng ý).
// B161 (QA box beta.2.8): B157 so chủ đề bằng CHUỖI CON nên câu lạc đề vẫn “liên quan” (loại→loa, nhắc→nhac, khoá học, block/clock,
// gửi thông báo, ngôn ngữ lập trình, hình nền desktop, giá loa). Nay: so theo TỪ trên chuỗi đã fold (bỏ dấu câu); từ chủ đề “mạnh” tính một mình,
// từ “yếu” (tiếng, nhạc, thông báo, ngôn ngữ, desktop, loa, tên thiết bị…) chỉ tính khi có ĐỘNG TỪ HỆ THỐNG ngay trước (≤ 2 từ) hoặc từ chỉ mức ngay sau.
const SYS_VERB = 'tang|giam|bat|tat|mo|chinh|doi|dat|cai|vao|hien|ve|ra|ket noi|ngat|turn(?: on| off| up| down)?|switch(?: on| off| to)?|change|set|adjust|increase|decrease|raise|lower|open|enable|disable|show|go to|mute|unmute|connect|disconnect';
const SYS_LEVEL = 'to|nho|lon|be|hon|qua|louder|quieter|lower|higher|up|down';
const topicWords = (s) => fold(s).replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
function topic({ strong, weak, cjk }) {
  const res = [];
  if (strong) res.push(new RegExp(W(strong), 'u'));
  if (weak) res.push(new RegExp(String.raw`(?:^|\s)(?:${SYS_VERB})(?:\s+\S+){0,2}\s+(?:${weak})(?=\s|$)|(?:^|\s)(?:${weak})(?:\s+\S+){0,1}\s+(?:${SYS_LEVEL})(?=\s|$)`, 'u'));
  return { test: (q) => { const t = topicWords(q); return res.some(r => r.test(t)) || (!!cjk && cjk.test(String(q || ''))); } };
}
// “tiếng” + tên ngôn ngữ (tiếng Anh, tiếng Việt…) là ngôn ngữ, không phải âm thanh
const TIENG = String.raw`tieng(?!\s+(?:anh|viet|trung|hoa|nhat|han|phap|duc|nga|y|tay ban nha|bo dao nha|thai|lao|campuchia|khmer|an do|a rap))`;
const VOLUME = topic({ strong: 'am luong|volume|mute|unmute|tat tieng|bat tieng|im lang', weak: `${TIENG}|loa|am thanh|sound|nhac|music|speaker|speakers`, cjk: /音量|静音/ });
const SYS_TOPIC = {
  volume_up: VOLUME, volume_down: VOLUME, volume_set: VOLUME, volume_change: VOLUME, mute: VOLUME,
  open_settings: topic({ strong: 'cai dat|settings|setting|thiet lap|control panel|do sang|brightness|windows update|cap nhat windows|che do toi|dark mode|mui gio|time zone|ngay gio he thong',
    weak: 'wi-?fi|bluetooth|ket noi mang|mang|network|display|ngon ngu|language|chuot|mouse|ban phim|keyboard|may in|printer|am thanh|sound|thong bao|notification|notifications|hinh nen|wallpaper|ngay gio|pin|battery|man hinh', cjk: /设置/ }),
  lock: topic({ strong: String.raw`khoa(?!\s+(?:hoc|luan|bieu|tai khoan|cua|xe|so|kinh|zip))|lock|lock screen|khoa man hinh`, cjk: /锁屏|锁定/ }),
  sleep: topic({ strong: String.raw`(?<!ngon\s)ngu(?!\s+(?:phap|van|canh|ngon|am))|sleep|hibernate`, cjk: /睡眠/ }),
  shutdown: topic({ strong: 'tat may|shut ?down|power off', cjk: /关机/ }),
  restart: topic({ strong: 'khoi dong lai|restart|reboot', cjk: /重启/ }),
  show_desktop: topic({ strong: String.raw`man hinh chinh|show desktop|thu nho (?:het|tat ca|moi)`, weak: 'desktop|man hinh desktop', cjk: /桌面/ }),
  empty_trash: topic({ strong: 'thung rac|trash|recycle bin|recycle', cjk: /回收站/ }),
};
function sysRelated(action, query) { if (sysAsked(action, query)) return true; const t = SYS_TOPIC[action]; return !!t && t.test(query); }
module.exports = { sysRelated, SYS_TOPIC, sysAsked, clauses, clauseAsks, RULES, volumeLevel, volumeDelta, volumeParse, directSys };
