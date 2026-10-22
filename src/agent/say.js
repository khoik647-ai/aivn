'use strict';
// B182: câu do MÃ ghép cho người dùng (câu cuối, cảnh báo của AIVN AGENT) theo ngôn ngữ trả lời (en/zh/vi).
// Khoá = câu tiếng Việt có {0}…; tra từ điển dùng chung src/i18n rồi MỚI chèn phần thay đổi, nên lý do do mô hình viết giữ nguyên văn.
const C = require('../i18n/core');
let D = null, I = null;
const dict = (l) => { if (!D) D = { en: require('../i18n/en'), zh: require('../i18n/zh') }; return D[l]; };
const langOf = (l) => (l === 'en' || l === 'zh') ? l : 'vi';
function say(lang, key, ...args) {
  if (key == null) return key;
  const l = langOf(lang); let t = String(key);
  if (l !== 'vi') { const d = dict(l); const v = d && (d[t] != null ? d[t] : d[C.norm(t)]); if (typeof v === 'string' && v) t = v; }
  const plural = l === 'en' && t.includes('{s}');
  t = t.replace(/\{(\d+)\}/g, (_, n) => args[+n] == null ? '' : String(args[+n]));
  if (plural) t = t.replace(/(\d+)(\s+[A-Za-z]+)\{s\}/g, (_, n, w) => n + w + (Number(n) === 1 ? '' : 's')).replace(/\{s\}/g, 's');
  return t;
}
// câu hệ thống đã ghép sẵn bằng tiếng Việt (tóm tắt bước lỗi, lý do dừng): dịch khi từ điển dịch được trọn, không thì giữ nguyên
function sys(lang, text) {
  const l = langOf(lang); if (l === 'vi' || text == null || !C.VI.test(String(text))) return text;
  if (!I) I = C.create({ en: dict('en'), zh: dict('zh') });
  const ok = (o) => typeof o === 'string' && o && !C.VI.test(o.replace(/“[^”]*”|"[^"]*"/g, ''));
  const t = String(text); let out = null; try { out = I.tr(t, l); } catch {}
  if (ok(out)) return out;
  if (!/[.。!?]\s*$/.test(t)) { try { out = I.tr(t + '.', l); } catch {} if (ok(out)) return out.replace(/\s*[.。]\s*$/u, ''); } // lý do đã bỏ dấu chấm cuối (khoá có dấu chấm)
  return text;
}
module.exports = { say, sys, langOf };
