'use strict';
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
// khoá "cùng một cách": thao tác + mục tiêu (+ chữ gõ)
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
function createRetryTracker() {
  const tries = new Map(); const log = [];
  return {
    // trước khi làm: cách này đã hỏng 2 lần → trả kết quả thay thế (không làm lại)
    before(a) { const k = key(a); const t = tries.get(k); if (t && t.fails >= 2) return { error: 'cách này đã thử 2 lần không có tác dụng', forModel: `(Kiểm tra tự động của AIVN) KHÔNG làm lại: ${describe(a)} đã thử ${t.fails} lần và đều chưa có tác dụng (${t.why}). Hãy đổi cách: ${alternatives(a).join('; ')}. Nếu đã thử hết mà vẫn không được thì dừng và báo người dùng rõ là CHƯA làm được bước này.`, summary: 'bỏ qua — cách này đã hỏng 2 lần, cần đổi cách' }; return null; },
    // sau khi làm: ghi nhận; hỏng lần đầu → thêm gợi ý đổi cách vào kết quả
    after(a, out) {
      const why = outcome(out); const k = key(a); const t = tries.get(k) || { fails: 0, why: '' };
      if (!why) { t.fails = 0; tries.set(k, t); log.push({ a, ok: true }); return { bad: null }; }
      t.fails++; t.why = why; tries.set(k, t); log.push({ a, ok: false, why });
      const hint = t.fails === 1 ? `\n(Kiểm tra tự động của AIVN) Bước này CHƯA có tác dụng (${why}). Chụp lại/xem kết quả kiểm tra ở trên; nếu thử lại thì đổi cách: ${alternatives(a).slice(0, 3).join('; ')}.` : `\n(Kiểm tra tự động của AIVN) Đã hỏng ${t.fails} lần với cùng cách này (${why}) — BẮT BUỘC đổi cách: ${alternatives(a).join('; ')}.`;
      return { bad: why, hint };
    },
    lastBad() { const l = log[log.length - 1]; return l && !l.ok ? l : null; },
    stats() { return { tries: log.length, bad: log.filter(x => !x.ok).length }; },
  };
}
function describe(a = {}) { const act = String(a.action || ''); const tgt = a.element || a.target || (a.x != null ? `(${a.x}, ${a.y})` : ''); return `${act}${tgt ? ' ' + JSON.stringify(String(tgt)) : ''}${act === 'type_text' && a.text ? ' “' + String(a.text).slice(0, 30) + '”' : ''}${a.keys ? ' ' + a.keys : ''}`; }
// câu trả lời cuối khẳng định đã xong trong khi bước màn hình cuối cùng chưa có tác dụng
const DONE_RE = /(đã\s+(xong|hoàn thành|làm xong|mở|bấm|nhấn|gõ|nhập|chọn|lưu|gửi|chuyển)|hoàn tất|thành công)/iu;
function finalCheck(text, tracker) {
  const l = tracker && tracker.lastBad(); if (!l) return null;
  if (!DONE_RE.test(String(text || ''))) return null;
  return `AIVN chưa kiểm chứng được bước cuối trên màn hình (${describe(l.a)}: ${l.why}). Hãy xem lại màn hình trước khi tin là đã xong.`;
}
module.exports = { createRetryTracker, outcome, key, alternatives, finalCheck, describe, DONE_RE };
