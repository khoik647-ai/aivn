'use strict';
const { say, sys } = require('./say');
// 0.16: lập kế hoạch → làm → chụp lại để kiểm tra → chưa được thì đổi cách → chỉ báo những gì đã kiểm chứng.
// desktop-agent đã chụp lại sau mỗi thao tác và ghi "Kiểm tra: …". Mô-đun này đọc kết quả đó:
//   • bước không có tác dụng (không thấy phần tử / màn hình không đổi / chưa thấy chữ vừa gõ / chưa kiểm chứng gửi) → đánh dấu
//   • cùng một cách đã hỏng 2 lần → KHÔNG làm lần 3, bắt mô hình đổi cách (gợi ý cách khác theo loại thao tác)
//   • câu trả lời cuối nói "xong" mà bước cuối chưa kiểm chứng → cảnh báo, không để báo thành công giả
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();

const BAD = [
  [/không thấy phần tử/i, 'không thấy phần tử'],
  [/Màn hình không thay đổi rõ ràng/i, 'màn hình không thay đổi'],
  [/CHƯA thấy chữ vừa gõ/i, 'chưa thấy chữ vừa gõ'],
  [/vào NHẦM ô/i, 'chữ vào nhầm ô (không phải ô soạn tin)'],
  [/CHƯA kiểm chứng được là đã gửi/i, 'chưa kiểm chứng được là đã gửi'],
  [/Hộp thoại “[^”]*” VẪN đang mở/i, 'hộp thoại vẫn đang mở'],
  [/CHƯA thấy kết quả khớp/i, 'chưa thấy kết quả tìm kiếm'],
];
// out: kết quả của screen_act → null nếu đã có tác dụng, hoặc lý do ngắn
function outcome(out) {
  if (!out) return 'không có kết quả';
  if (out.refused) return null; // người dùng từ chối: không phải lỗi của cách làm
  if (out.verify && out.verify.sent === false) return 'chưa kiểm chứng được là đã gửi';
  const t = `${out.error || ''} ${out.forModel || ''}`;
  for (const [re, why] of BAD) if (re.test(t)) return why;
  if (out.error) return String(out.error).slice(0, 60);
  return null;
}
// khoá "cùng một cách": thao tác + mục tiêu (+ chữ gõ); B95: + ngữ cảnh (phần tử đang chọn + dấu màn hình) — bấm sang ô khác / màn hình đổi thì tính lại từ đầu
function key(a = {}) {
  const tgt = a.element || a.target || (a.x != null && a.y != null ? `${Math.round(a.x / 25)},${Math.round(a.y / 25)}` : '') || '';
  return [String(a.action || '').toLowerCase(), fold(tgt), a.action === 'type_text' ? fold(a.text).slice(0, 40) : '', a.keys ? fold(a.keys) : ''].join('|');
}
function alternatives(a = {}) {
  const act = String(a.action || '').toLowerCase();
  if (/click/.test(act)) return ['screen_look với query là tên phần tử để lấy id MỚI', 'bấm theo toạ độ x,y nhìn thấy trên ảnh chụp', 'dùng bàn phím: Tab/mũi tên rồi Enter, hoặc phím tắt của ứng dụng', 'cuộn (scroll) nếu phần tử nằm ngoài màn hình', 'focus_window nếu đang ở nhầm cửa sổ'];
  if (act === 'type_text') return ['bấm vào đúng ô trước (click element) rồi type_text không kèm element', 'hotkey "ctrl+a" rồi gõ lại (replace: true) nếu ô đã có chữ', 'screen_look để kiểm tra con trỏ đang ở ô nào'];
  if (act === 'hotkey') return ['bấm nút tương ứng trên giao diện thay cho phím tắt', 'focus_window đúng ứng dụng rồi bấm lại phím'];
  return ['screen_look để xem lại màn hình rồi chọn cách khác'];
}
// B166 (máy thật beta.2.8): phím tắt đã biết là không có tác dụng (màn hình không đổi) thì bấm lại y hệt trên cùng màn hình cũng vô ích
// (agent bấm ctrl+t hai lần) → chặn ngay lần thứ 2. Bấm/gõ vẫn được thử lại một lần (phần tử có thể vừa hiện ra).
const limitOf = (a = {}) => /^(?:hotkey|key|press)$/i.test(String(a.action || '')) ? 1 : 2;
function createRetryTracker() {
  const tries = new Map(); const log = []; const blocked = new Map(); let blockedTotal = 0, badStreak = 0;
  return {
    // trước khi làm: cách này đã hỏng 2 lần → trả kết quả thay thế (không làm lại)
    before(a, c = '') { const k = key(a) + '@' + c; const t = tries.get(k); const lim = limitOf(a); if (t && t.fails >= lim) { blocked.set(k, (blocked.get(k) || 0) + 1); blockedTotal++; } if (t && t.fails >= lim) return { error: t.fails < 2 ? 'phím này vừa bấm không có tác dụng' : 'cách này đã thử 2 lần không có tác dụng', forModel: `(Kiểm tra tự động của AIVN) KHÔNG làm lại: ${describe(a)} đã thử ${t.fails} lần và đều chưa có tác dụng (${t.why}). Hãy đổi cách: ${alternatives(a).join('; ')}. Nếu đã thử hết mà vẫn không được thì dừng và báo người dùng rõ là CHƯA làm được bước này.`, summary: t.fails < 2 ? 'bỏ qua — phím này vừa bấm không có tác dụng, cần đổi cách' : 'bỏ qua — cách này đã hỏng 2 lần, cần đổi cách' }; return null; },
    // sau khi làm: ghi nhận; hỏng lần đầu → thêm gợi ý đổi cách vào kết quả
    after(a, out, c = '') {
      const why = outcome(out); const k = key(a) + '@' + c; const t = tries.get(k) || { fails: 0, why: '' };
      if (!why) { t.fails = 0; badStreak = 0; tries.set(k, t); log.push({ a, ok: true }); return { bad: null }; }
      badStreak++; t.fails++; t.why = why; tries.set(k, t); log.push({ a, ok: false, why });
      const hint = t.fails === 1 ? `\n(Kiểm tra tự động của AIVN) Bước này CHƯA có tác dụng (${why}). Chụp lại/xem kết quả kiểm tra ở trên; nếu thử lại thì đổi cách: ${alternatives(a).slice(0, 3).join('; ')}.` : `\n(Kiểm tra tự động của AIVN) Đã hỏng ${t.fails} lần với cùng cách này (${why}) — BẮT BUỘC đổi cách: ${alternatives(a).join('; ')}.`;
      return { bad: why, hint };
    },
    // B39: mô hình cứ quay lại cách đã bị chặn (cùng một ý 2 lần, hoặc 3 lần bị chặn bất kỳ), hoặc 10 bước liền không có tác dụng → DỪNG SỚM
    giveUp() {
      const same = [...blocked.values()].some(n => n >= 2);
      if (same || blockedTotal >= 3) return { why: same ? 'lặp lại cách đã hỏng' : 'nhiều cách đã hỏng bị thử lại', blockedTotal };
      if (badStreak >= 10) return { why: `${badStreak} bước liền chưa có tác dụng`, blockedTotal };
      return null;
    },
    failures() { const m = new Map(); for (const l of log) if (!l.ok) { const k = describe(l.a); const x = m.get(k) || { what: k, n: 0, why: l.why }; x.n++; x.why = l.why; m.set(k, x); } return [...m.values()]; },
    lastBad() { const l = log[log.length - 1]; return l && !l.ok ? l : null; },
    stats() { return { tries: log.length, bad: log.filter(x => !x.ok).length }; },
  };
}
function describe(a = {}) { const act = String(a.action || ''); const tgt = a.element || a.target || (a.x != null ? `(${a.x}, ${a.y})` : ''); return `${act}${tgt ? ' ' + JSON.stringify(String(tgt)) : ''}${act === 'type_text' && a.text ? ' “' + String(a.text).slice(0, 30) + '”' : ''}${a.keys ? ' ' + a.keys : ''}`; }
// câu trả lời cuối khẳng định đã xong trong khi bước màn hình cuối cùng chưa có tác dụng
const DONE_RE = /(đã\s+(xong|hoàn thành|làm xong|mở|bấm|nhấn|gõ|nhập|chọn|lưu|gửi|chuyển)|hoàn tất|thành công)/iu;
function finalCheck(text, tracker, lang = 'vi') {
  const l = tracker && tracker.lastBad(); if (!l) return null;
  if (!DONE_RE.test(String(text || ''))) return null;
  return say(lang, 'AIVN chưa kiểm chứng được bước cuối trên màn hình ({0}: {1}). Hãy xem lại màn hình trước khi tin là đã xong.', describe(l.a), sys(lang, l.why));
}
// B39: câu trả lời cuối là LỜI HỨA ở thì tương lai (“Tôi sẽ thử bấm…”) — lượt đã kết thúc nên sẽ không có gì được làm tiếp
const PROMISE_RE = /(?:^|[.!?\n:]\s*)(?:(?:bây giờ|tiếp theo|tiếp đến|sau đó|giờ|ok|được rồi|vâng)[, ]+)?(?:tôi|mình|em|aivn(?: agent)?)\s+(?:sẽ|xin phép|đang chuẩn bị|chuẩn bị|tiếp tục)\s+(?:thử|thực hiện|tiếp tục|bấm|nhấn|nhấp|gõ|nhập|mở|tìm|làm|gửi|chọn|chuyển|kiểm tra|quay lại|di chuyển|cuộn|dùng|sử dụng)|\b(?:i'll|i will|let me|i am going to|i'm going to|next,? i)\s+(?:now\s+)?(?:try|click|open|type|search|proceed|perform|do|send|select|use|check)|我(?:将|会|现在|接下来)(?:尝试|点击|打开|输入|执行|搜索|发送|选择)/iu;
function promiseEnding(text) {
  const t = String(text || '').trim(); if (!t) return false;
  const tail = t.split(/\n+/).filter(Boolean).slice(-2).join('\n').slice(-320); // chỉ xét phần cuối câu trả lời
  return PROMISE_RE.test(tail);
}
// B39: báo trung thực khi dừng sớm / khi mô hình kết thúc bằng lời hứa
// B182: lang = ngôn ngữ trả lời (en/zh/vi) — câu do AIVN ghép được dịch theo mẫu {0}; lý do/kết quả bước là chữ hệ thống nên dịch khi có bản dịch trọn
function honestStatus({ query = '', tracker = null, steps = [], reason = '', recipient = null, app = '', lang = 'vi' } = {}) {
  const fails = tracker ? tracker.failures() : [];
  const okN = steps.filter(x => x.status === 'ok' && !x.check).length;
  const lines = [reason ? say(lang, 'Mình chưa làm xong việc này ({0}), nên dừng lại thay vì thử mãi một cách đã hỏng.', sys(lang, reason)) : say(lang, 'Mình chưa làm xong việc này, nên dừng lại thay vì thử mãi một cách đã hỏng.')];
  if (fails.length) lines.push(say(lang, 'Đã thử:') + '\n' + fails.slice(-6).map(f => say(lang, '- {0}: {1} lần, {2}', f.what, f.n, sys(lang, f.why))).join('\n'));
  else if (okN) lines.push(say(lang, 'Đã làm {0} bước nhưng chưa kiểm chứng được là xong.', okN));
  lines.push(recipient
    ? (app ? say(lang, 'Bạn giúp mình mở sẵn cuộc trò chuyện “{0}” trong {1} rồi giao lại việc (hoặc tự gửi tin) nhé.', recipient, app) : say(lang, 'Bạn giúp mình mở sẵn cuộc trò chuyện “{0}” rồi giao lại việc (hoặc tự gửi tin) nhé.', recipient))
    : say(lang, 'Bạn có thể mở sẵn đúng cửa sổ/màn hình cần dùng rồi giao lại việc, hoặc tự làm bước này.'));
  return lines.join('\n\n');
}
// B95 (máy thật beta.2.2): câu cuối đổ lỗi cho ứng dụng (“Zalo có thể đang gặp sự cố / giao diện bị lỗi”) trong khi chính các bước của AIVN chưa có tác dụng
const BLAME_RE = /(?:gặp|bị|có)\s+(?:sự cố|trục trặc|lỗi)|giao diện\s+(?:bị|có|đang)\s+(?:lỗi|vấn đề)|(?:ứng dụng|app|phần mềm)\s+(?:\S+\s+){0,3}(?:không hoạt động|bị treo|đang lỗi)|\b(?:is|may be|might be|seems to be)\s+(?:having (?:issues|problems)|broken|malfunctioning|not working)|\b(?:app|application|interface)\s+(?:error|issue|problem)s?\b|(?:出现|遇到)(?:了)?(?:问题|故障)|界面(?:出错|有问题)/iu;
function blamesApp(text) { return BLAME_RE.test(String(text || '')); }
// B192 (QA beta.3, Notepad): gõ “chưa thấy chữ” 2 lần, bấm menu (bước “ok”) rồi câu cuối hỏi lại → vẫn outcome “done”.
// Việc chỉ XONG khi thao tác quyết định đã có tác dụng ĐÃ KIỂM trên màn hình (step.check = kiểm tra tự động thấy chưa có tác dụng):
//   (a) việc cần GÕ chữ vào ứng dụng mà không có bước nào được kiểm là đã có chữ (gõ / dán / ghi tệp rồi mở) → 'typed'
//   (b) bước màn hình cuối cùng (bỏ qua phím lưu/đóng/Enter) báo lỗi hoặc có dấu hiệu CHẮC CHẮN chưa có tác dụng → 'last'
// review #68 (15c7090): zh “在…里写” chỉ khi phần 在…里 có tên trình soạn thảo (记事本/Notepad/Word/文档…) — không bắt “在家里写作业”, “在公司里写代码”
// review #68: chỉ coi là việc GÕ khi động từ ở đầu mệnh đề (mệnh lệnh: “…và gõ”, “then type”) hoặc có tân ngữ/chuỗi trích dẫn đi kèm;
// không tính “bài viết”, “nhập khẩu”, “what type”, “input settings”, “写字楼”, “输入法”…
const TYPE_NOT = /bài\s+viết|người\s+viết|nhà\s+văn|nhập\s+(?:khẩu|cảnh|học|viện|ngũ|môn|tâm|vai|gia)|đăng\s+nhập|(?:what|which|this|that|file|data|any|the)\s+type\b|type\s+(?:of|is|was)\b|\binput\s+(?:settings?|methods?|devices?|sources?|languages?|lag)\b|写字楼|输入法|输入设置|描写|写真/giu;
const TYPE_VI = /(?:^|[,.;:!?\n]\s*|(?:^|[^\p{L}])(?:và|rồi|sau đó|xong|hãy|giúp|cho|để|thì|vào|lên|mình|tôi|em|bạn)\s+)(?:gõ|viết|nhập|điền|soạn)(?![\p{L}])|(?:^|[^\p{L}])(?:gõ|viết|nhập|điền|soạn)(?:\s+(?:vào|lên|thêm|lại|một|1|hai|vài|mấy|các|những))*\s+(?:["“'«]|(?:chữ|câu|dòng|nội dung|văn bản|đoạn|thư|tin|lời|số|tên|địa chỉ|ghi chú|tiêu đề|từ|thơ|bài thơ|bài văn|bài luận|email|e-mail|mail|đoạn văn)(?![\p{L}]))|(?:^|[^\p{L}])(?:notepad|word|wordpad|sổ tay|ghi chú|notes|textedit|gedit|google docs|docs)\s+(?:(?:và|rồi|để|lên|ra|vào)\s+)?(?:gõ|viết|nhập|soạn|điền)(?![\p{L}])/iu;
const TYPE_EN = /(?:^|[,.;:!?\n]\s*|\b(?:and|then|please|to|also|now)\s+)(?:type|write|enter|input|jot)\b|\b(?:notepad|word|wordpad|textedit|gedit|docs|notes)\s+(?:and\s+|then\s+|to\s+)?(?:type|typing|write|writing)\b|\b(?:type|typing|write|writing|enter|input|jot)\s+(?:(?:in|into|down|out)\s+)?(?:["“']|(?:a|an|the|some|this|my)\s+(?:line|sentence|text|note|message|word|paragraph|letter|list|poem)\b|(?:hello|hi)\b)/iu;
const TYPE_ZH = /输入|键入|写(?:一|下|上|入|几|段|句|行|个|封|首|篇|点)|填写|写\s*["“'「『]|在[^。，,.!?！？\n]{0,8}?(?:记事本|notepad|word|wps|文档|备忘录|写字板|编辑器|便签|文本框|输入框)[^。，,.!?！？\n]{0,4}?(?:里|中|上)(?:面)?写|(?:记事本|文档|备忘录|写字板|notepad|word)[^。，,.!?！？\n]{0,3}?写/iu;
function typeTask(q) { const t = String(q || '').replace(TYPE_NOT, ' '); return TYPE_VI.test(t) || TYPE_EN.test(t) || TYPE_ZH.test(t); }
const TYPE_TASK = { test: typeTask }; // giữ tên cũ (.test) cho chỗ gọi cũ
const actOf = (x) => String((x && x.args && x.args.action) || '').toLowerCase();
const chainActs = (x) => [actOf(x), ...((x && x.args && Array.isArray(x.args.then)) ? x.args.then.map(t => String((t && t.action) || '').toLowerCase()) : [])];
const keysOf = (x) => String((x && x.args && x.args.keys) || '').toLowerCase().replace(/\s+/g, '');
const PASTE = /^(?:ctrl|cmd|command|meta|control)\+v$/;
// phím lưu/đóng/xác nhận sau khi gõ: thường gần như không đổi màn hình → không dùng làm “bước cuối” để chấm
const SAVE_KEYS = /^(?:(?:ctrl|cmd|command|meta|control)\+(?:shift\+)?(?:s|w)|alt\+f4|enter|return|escape|esc|tab)$/;
// “màn hình không thay đổi rõ ràng” chỉ là đo điểm ảnh (cú bấm làm đổi rất nhỏ cũng ra câu này) → không đủ chắc để đánh hỏng việc
const WEAK_CHECK = new Set(['màn hình không thay đổi']);
function effectOf(steps = [], query = '') {
  const all = (steps || []).filter(Boolean);
  const acts = all.filter(x => x.name === 'screen_act' && x.status !== 'refused' && !['screen_look', 'look', 'wait', 'ensure_app'].includes(actOf(x)));
  if (!acts.length) return { ok: true };
  const okStep = (x) => x.status === 'ok' && !x.check;
  const typed = acts.filter(x => chainActs(x).includes('type_text'));
  // re-review #68 (5): dán ctrl+v KHÔNG có kiểm chứng chữ (bước hotkey không đọc lại chữ) → không tính là đã gõ; chỉ tính khi bước có dấu đã thấy chữ
  const SEEN_TXT = /Đã thấy chữ vừa gõ/;
  const pasted = acts.some(x => actOf(x) === 'hotkey' && PASTE.test(keysOf(x)) && okStep(x) && ((x.verify && x.verify.typed) || SEEN_TXT.test(String(x.detail || '') + ' ' + String(x.summary || ''))));
  // re-review #68 (2): ghi tệp rồi MỞ ĐÚNG tệp đó (open_path đường dẫn đã ghi, hoặc open_app có tên tệp làm đối số) mới tính; mở ứng dụng trống thì không
  const norm = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/').toLowerCase();
  const baseOf = (v) => norm(v).split('/').filter(Boolean).pop() || '';
  let fileOpened = false;
  all.forEach((w, i) => {
    if (fileOpened || w.name !== 'write_file' || w.status !== 'ok') return;
    const base = baseOf(w.args && w.args.path);
    if (!base) return;
    fileOpened = all.slice(i + 1).some(x => x.status === 'ok' && ((x.name === 'open_path' && baseOf(x.args && x.args.path) === base) || (x.name === 'open_app' && norm(x.args && x.args.name).split(/[\s/"']+/).includes(base))));
  });
  const typedOk = typed.some(okStep) || pasted || fileOpened || all.some(x => x.draftIn || (x.verify && x.verify.sent));
  if (typeTask(query) && !typedOk) return { ok: false, why: 'typed', n: typed.length };
  let k = acts.length - 1;
  while (k > 0 && actOf(acts[k]) === 'hotkey' && SAVE_KEYS.test(keysOf(acts[k])) && acts[k].status !== 'error' && (!acts[k].check || WEAK_CHECK.has(acts[k].check))) k--; // re-review #68 (1): phím có check CHẮC CHẮN (vd. chưa kiểm chứng gửi) không được bỏ qua
  const last = acts[k];
  if (last.status === 'error') return { ok: false, why: 'last', step: last };
  if (last.status === 'ok' && last.check && !WEAK_CHECK.has(last.check)) return { ok: false, why: 'last', step: last };
  return { ok: true };
}
module.exports = { BLAME_RE, blamesApp, PROMISE_RE, promiseEnding, honestStatus, createRetryTracker, outcome, key, alternatives, finalCheck, describe, DONE_RE, TYPE_TASK, typeTask, effectOf };
