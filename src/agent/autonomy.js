'use strict';
// 0.16: "Tự làm không hỏi" — người dùng cho phép AIVN AGENT làm tiếp mà không hỏi lại từng bước.
// Bật bằng: công tắc “Tự làm không hỏi” (giữ qua các lượt) hoặc câu trong yêu cầu ("không cần hỏi lại", "cứ làm luôn"…, chỉ trong lượt đó).
// Khi bật:
//   • bước thường trên màn hình (bấm, gõ, cuộn…)                      → không hỏi
//   • GỬI tin nhắn                                                     → không hỏi CHỈ KHI nội dung gửi đúng là tin người dùng đã nêu trong yêu cầu
//   • xoá / thanh toán / nộp / chuyển tiền / bấm nút nguy hiểm khác    → vẫn hỏi, trừ khi người dùng nêu đích danh thứ cần xoá
//   • thao tác hệ thống người dùng KHÔNG yêu cầu (QA B1)               → LUÔN hỏi
//   • chạy lệnh terminal, mở tệp chạy được                             → LUÔN hỏi (an toàn)
//   • người dùng nói "hỏi trước khi gửi"                               → luôn hỏi khi gửi
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();

// câu cho phép làm không hỏi (so trên chữ đã bỏ dấu)
const END = String.raw`(?=\s*(?:$|[,.!;:)\n]|nhe\b|nha\b|nhen\b|luon\b|di\b|cu\b|va\b|ma\b|roi\b|nua\b|het\b|gi\b|ca\b|minh\b|toi\b|em\b|anh\b|chi\b))`;
const END2 = String.raw`(?=\s*(?:$|[,.!;:)\n]|nhe\b|nha\b|nhen\b|luon\b|di\b|nua\b|het\b|ca\b))`; // "đừng hỏi tôi về…" không phải cho phép
const STAND_RE = new RegExp([
  String.raw`\b(?:khong|ko|k|chang) (?:can|phai) (?:hoi|xac nhan|duyet|cho phep)(?: lai| truoc| y kien)?` + END,
  String.raw`\b(?:khong|ko) hoi lai` + END,
  String.raw`\b(?:khoi|dung|chang can) hoi(?: lai)?` + END2,
  String.raw`\bcu (?:lam|gui|nhan|bam) (?:luon|di|thang|ngay)\b`,
  String.raw`\btu (?:lam|gui|xu ly) (?:luon|het|di)\b`,
  String.raw`\b(?:lam|gui) (?:luon|thang|ngay) (?:khong|ko|dung) (?:can )?(?:hoi|xac nhan)\b`,
  String.raw`\b(?:don'?t|do not|no need to) (?:ask|confirm)\b`, String.raw`\bwithout (?:asking|confirm(?:ation)?)\b`,
].join('|'));
// câu bắt buộc hỏi trước khi gửi (thắng mọi thứ)
const ASK_SEND_RE = /\bhoi (truoc|lai|y kien)? ?(truoc )?khi (gui|nhan)\b|\b(cho|de) (toi|minh|em) (xem|duyet|kiem tra) (truoc|lai) (khi|roi) (gui|nhan)\b|\bdung gui (voi|ngay|luon)?\b|\bchi soan( san)?\b|\bask (me )?before sending\b/;
// chữ trong ngoặc kép người dùng đã nêu
function quoted(query) { const out = []; const re = /["“”«»'‘’]([^"“”«»'‘’]{1,500})["“”«»'‘’]/g; let m; while ((m = re.exec(String(query || '')))) if (m[1].trim()) out.push(m[1].trim()); return out; }

function standing(query) { return STAND_RE.test(fold(query)); }
function askBeforeSend(query) { return ASK_SEND_RE.test(fold(query)); }
// nội dung sắp gửi có đúng là tin người dùng đã nêu trong yêu cầu không (nguyên văn trong ngoặc, hoặc nằm nguyên trong câu yêu cầu)
function namedMessage(query, text) {
  const t = fold(text).replace(/[.!?…]+$/, ''); if (t.length < 2) return false;
  if (quoted(query).some(q => fold(q).replace(/[.!?…]+$/, '') === t)) return true;
  const q = fold(query); return t.length >= 4 && q.includes(t);
}
// tên thứ cần xoá/đóng có được nêu đích danh trong yêu cầu không
function namedTarget(query, target) {
  const q = fold(query); const base = fold(String(target || '').split(/[\\/]/).pop()); const full = fold(target);
  if (!base) return false;
  return q.includes(base) || (full.length > 3 && q.includes(full)) || quoted(query).some(x => fold(x) === base || fold(x) === full);
}
// trạng thái cho một lượt
function forTurn({ setting = false, query = '' } = {}) {
  const phrase = standing(query); const ask = askBeforeSend(query);
  return { on: !!setting || phrase, why: phrase ? 'phrase' : setting ? 'toggle' : null, askBeforeSend: ask, query: String(query || '') };
}
// quyết định: true = bỏ qua hỏi (tự làm), false = vẫn hỏi
//   kind: 'desk-step' | 'desk-send' | 'desk-risk' | 'system' | 'tool' | 'close-app' | 'open-exec' | 'command'
function skipAsk(auto, kind, info = {}) {
  if (!auto || !auto.on) return false;
  switch (kind) {
    case 'desk-step': return true;
    case 'desk-send': return !auto.askBeforeSend && namedMessage(auto.query, info.text);
    case 'desk-risk': return !!info.named && /xo[aá]|delete|remove|thung rac|trash/i.test(fold(info.what || '')) && namedTarget(auto.query, info.named);
    case 'system': return !!info.asked; // B1: thao tác hệ thống không được yêu cầu → luôn hỏi
    case 'close-app': return namedTarget(auto.query, info.name);
    case 'tool':
      if (info.tool === 'delete_file') return namedTarget(auto.query, info.path);
      if (info.tool === 'run_command' || info.tool === 'run_python' || info.tool === 'run_javascript') return false;
      if (/^mcp__/.test(info.tool || '')) return false;
      return info.tool === 'write_file';
    case 'open-exec': case 'command': default: return false;
  }
}
module.exports = { forTurn, skipAsk, standing, askBeforeSend, namedMessage, namedTarget, quoted, STAND_RE, fold };
