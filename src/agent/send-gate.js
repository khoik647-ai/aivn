'use strict';
// B69 (máy thật, beta.2: tin đã được GỬI tới một người thật trên Zalo mà KHÔNG có thẻ xin phép): MỘT chốt duy nhất quyết định
// thao tác nào là GỬI. Mọi đường có thể gửi đều qua đây — type_text kèm submit/xuống dòng (kể cả gõ vào ô đang chọn, chuỗi then[],
// lời gọi công cụ mô hình in ra chữ), phím Enter / Ctrl+Enter / ⌘+Enter / Alt+S sau khi gõ, bấm nút Gửi (có tên hoặc nút biểu tượng
// cạnh ô soạn khi đang mở cuộc trò chuyện). Lỗi cũ: “gõ vào ô tìm kiếm” được đoán theo thời gian (vừa gõ tìm < 60 giây) nên tin nhắn
// gõ ngay sau khi Enter ở ô tìm kiếm mở cuộc trò chuyện bị coi là “tìm kiếm” → không hỏi.
// Quy tắc: đang mở một cuộc trò chuyện (đã kiểm chứng) → mọi chữ kèm Enter là GỬI; chỉ là TÌM khi chữ đúng là tên người nhận (hoặc
// một phần tên), hay không phải việc nhắn tin và ô đích đã xác nhận là ô tìm kiếm.
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
// B220: nhãn gửi ngoài vi/en/zh (送信, Envoyer, Enviar, Senden…) cũng là nút Gửi — không chỉ là thẻ rủi ro.
const SEND_WORD = 'gửi|gui|senden|envoyer|enviar|invia|kirim|verzenden|отправить|send|sent|送信|보내기|发送|發送|传送|傳送|送出|submit tin';
const SEND_NAME = new RegExp(String.raw`(^|[\s“"'(\[])(?:${SEND_WORD})(?=$|[\s”"')\].,:!])|nút gửi|send button|send message|gửi tin|➤|➢|✈|paper ?plane`, 'iu');
const ENTERISH = /(^|\+)(enter|return|numpad_enter|kp_enter)$/i;
const Keys = require('./keys');
// Ctrl+Enter, Ctrl+Shift+Enter, Ctrl+Numpad Enter và Alt+S đều gửi thư. Tên phím đi qua keys.parse
// (option/altgr/ralt, ctl/strg/rctrl) chứ không so chuỗi thô.
function parsedCombo(k) { try { return Keys.parse(k); } catch { return null; } }
function isSendCombo(k) {
  const p = parsedCombo(k); if (!p) return false;
  if (/^(?:alt|right_alt)\+s$/.test(p.combo)) return true;
  if (/^(?:control|right_control|cmd|meta)(?:\+(?:shift|right_shift))?\+(?:enter|numpad_enter)$/.test(p.combo)) return true;
  return false;
}
const SEND_COMBO = { test: (k) => isSendCombo(k) };
const normKeys = (k) => String(k || '').toLowerCase().replace(/\s*\+\s*/g, '+').trim();
function focusedSendKind(st) {
  if (!st || st.focusedName == null) return '';
  const nm = String(st.focusedName);
  if (SEND_NAME.test(nm) || SEND_NAME.test(visibleName(nm))) return 'named';
  if (st.sendApp && isUnnamed(nm)) return 'unnamed';
  return '';
}
// id “e12” không phải tên nút. Glyph một ký tự (biểu tượng Fluent) cũng là không tên.
function visibleName(targetName) {
  return String(targetName || '').split(/\s+/).filter(p => p && !/^e\d+$/i.test(p)).join(' ').trim();
}
function isUnnamed(targetName) {
  const t = visibleName(targetName);
  if (!t) return true;
  if (/^[\uE000-\uF8FF]$/u.test(t)) return true;
  if (/^[\W_]{1,4}$/u.test(t)) return true;
  return false;
}
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
    const inApp = !!st.sendApp;
    if (isSendCombo(a.keys) && (st.lastTyped || st.chatOpen || st.messaging || inApp)) return { send: true, kind: 'hotkey', text: st.lastTyped || '', why: `phím ${a.keys} gửi thư/tin` };
    // Alt rồi S ở hai bước: Alt một mình trong cửa sổ thư/tin là khởi đầu của Alt+S. Không tự cho phép.
    if (inApp && k === 'alt') return { send: true, kind: 'hotkey', failClosed: 'alt', text: st.lastTyped || '', why: 'phím Alt trong cửa sổ thư/tin (có thể là Alt rồi S để gửi)' };
    if (inApp && st.altArmed && k === 's') return { send: true, kind: 'hotkey', failClosed: 'alt-s', text: st.lastTyped || '', why: 'phím S ngay sau Alt = Alt+S gửi thư' };
    // Enter hoặc Space khi con trỏ đang ở nút Gửi (có tên, hoặc không tên trong ứng dụng thư/tin) — kể cả chưa gõ gì trong lượt này.
    const bare = parsedCombo(a.keys);
    const onBtn = bare && bare.mods.length === 0 && (bare.key === 'enter' || bare.key === 'space' || bare.key === 'numpad_enter') ? focusedSendKind(st) : '';
    if (onBtn === 'named') return { send: true, kind: 'hotkey', text: st.lastTyped || '', why: `phím ${a.keys} trên nút Gửi` };
    if (onBtn === 'unnamed') return { send: true, kind: 'hotkey', failClosed: 'unnamed', text: st.lastTyped || '', why: `phím ${a.keys} trên nút gửi không tên` };
    if (ENTERISH.test(k) && (st.lastTyped || st.chatOpen)) return { send: true, kind: 'hotkey', text: st.lastTyped || '', why: 'bấm Enter sau khi gõ chữ có thể GỬI tin' };
    // Enter trong ô soạn, hoặc khi không đọc được ô soạn / To: coi là gửi. Enter ở danh sách thư (ô soạn trống, đọc được) thì không.
    if (ENTERISH.test(k) && inApp && !st.searchTarget && (st.inCompose || st.composeUnreadable)) return { send: true, kind: 'hotkey', text: st.lastTyped || '', why: 'bấm Enter trong ô soạn thư/tin' };
    return { send: false };
  }
  if (action === 'click' || action === 'double_click') {
    const nm = String(st.targetName || '');
    if (SEND_NAME.test(nm) || SEND_NAME.test(visibleName(nm))) return { send: true, kind: 'click', text: st.lastTyped || '', why: `bấm “${visibleName(nm).slice(0, 40) || nm.trim().slice(0, 40)}”` };
    // nút biểu tượng không tên (Zalo/Messenger: mũi tên giấy) ở hàng ô soạn khi đã gõ tin — đường cũ, vẫn là gửi thường
    if (st.chatOpen && st.lastTyped && st.inComposerRow && isUnnamed(nm)) return { send: true, kind: 'click', text: st.lastTyped, why: 'bấm nút biểu tượng cạnh ô soạn tin' };
    // B220: trong cửa sổ nhắn tin / thư, thà hỏi thừa. Không tên, bấm toạ độ, hoặc ô soạn/To đang có chữ (kể cả không đọc được) đều là GỬI.
    if (st.sendApp && st.coordinate) return { send: true, kind: 'click', failClosed: 'coordinate', text: st.lastTyped || '', why: 'bấm theo toạ độ trong cửa sổ nhắn tin/thư' };
    if (st.sendApp && isUnnamed(nm)) return { send: true, kind: 'click', failClosed: 'unnamed', text: st.lastTyped || '', why: 'bấm phần tử không tên trong cửa sổ nhắn tin/thư' };
    if (st.sendApp && (st.composeHot || st.composeUnreadable)) return { send: true, kind: 'click', failClosed: 'compose', text: st.lastTyped || '', why: 'bấm khi ô soạn hoặc To/Cc/Bcc đang có nội dung (hoặc không đọc được)' };
    return { send: false };
  }
  return { send: false };
}
// B220: true khi bước này là gửi theo chốt trên (để B219 / chốt cuối chặn đúng các đường không tên). type_text để đường cũ xử lý.
function unasked(action, a = {}, st = {}) {
  const g = classify(action, a, st);
  if ((action === 'click' || action === 'double_click' || action === 'hotkey') && g.send) return true;
  return false;
}
// B70: đã bấm gửi (người nhận, nội dung) một lần trong việc này → không bao giờ tự gửi lại
const sendKey = (recipient, text) => `${fold(recipient) || '?'}|${fold(text)}`;
module.exports = { classify, unasked, isUnnamed, visibleName, looksLikeRecipient, sendKey, SEND_NAME, SEND_COMBO, isSendCombo, normKeys, fold };
