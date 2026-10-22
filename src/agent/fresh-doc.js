'use strict';
// B191 (QA beta.3, Windows 11): “mở Notepad và gõ một dòng” → Notepad khôi phục THẺ CŨ của người dùng (tệp có nội dung nhạy cảm)
// và AIVN gõ thẳng vào thẻ đó. Nguyên tắc chung cho mọi trình soạn thảo: việc “mở/tạo X rồi gõ/viết” cần một TÀI LIỆU MỚI TRỐNG —
// AIVN tự mở tài liệu mới (Ctrl+N / ⌘N), KIỂM tiêu đề (Untitled/Không có tiêu đề/无标题…) và nội dung trống rồi mới gõ;
// không chứng minh được → KHÔNG gõ (không bao giờ gõ đè/chèn vào nội dung đã có của người dùng).
// Mô-đun thuần (không Electron): desktop-agent nối look/hotkey/sleep thật; kiểm thử dùng màn hình giả.

// trình soạn thảo tài liệu (tiến trình; tiêu đề cửa sổ khi không đọc được tên tiến trình)
const EDITORS = [
  { id: 'notepad', proc: /^notepad(\.exe)?$/i, title: /\s[-–—]\s(Notepad|Sổ tay|记事本)$/iu },
  { id: 'notepad++', proc: /^notepad\+\+(\.exe)?$/i, title: /\s[-–—]\sNotepad\+\+$/i },
  { id: 'wordpad', proc: /^wordpad(\.exe)?$/i, title: /\s[-–—]\sWordPad$/i },
  { id: 'word', proc: /^winword(\.exe)?$|^Microsoft Word$/i, title: /\s[-–—]\s(Microsoft\s)?Word$/i },
  { id: 'writer', proc: /^swriter(\.exe)?$/i, title: /\s[-–—]\sLibreOffice Writer$/i, soffice: true },
  { id: 'textedit', proc: /^TextEdit$/i, title: null },
  { id: 'linux-editor', proc: /^(gedit|gnome-text-editor|mousepad|xed|pluma|kate|kwrite|leafpad|featherpad|l3afpad)$/i, title: null },
  { id: 'vscode', proc: /^code(\.exe)?$|^Code - OSS$/i, title: /\s[-–—]\sVisual Studio Code$/i },
];
// LibreOffice chạy mọi ứng dụng trong soffice(.bin) → chỉ tính khi tiêu đề là Writer
const SOFFICE = /^soffice(\.bin|\.exe)?$/i;
function editorOf(win) {
  if (!win) return null; const p = String(win.proc || '').trim(); const t = String(win.title || '');
  if (SOFFICE.test(p)) return /LibreOffice Writer/i.test(t) ? EDITORS.find(e => e.id === 'writer') : null;
  return EDITORS.find(e => (p && e.proc.test(p)) || (e.title && e.title.test(t))) || null;
}

// tên tài liệu MỚI chưa lưu (tiếng Anh/Việt/Trung) — phần đầu tiêu đề trước “ - Ứng dụng”; bỏ dấu “chưa lưu” (*, ●) ở đầu
const UNTITLED = /^(?:untitled(?:[\s-]?\d+)?|untitled document(?:\s?\d+)?|không có tiêu đề(?:\s?\d+)?|không tiêu đề(?:\s?\d+)?|chưa đặt tên(?:\s?\d+)?|chưa có tên(?:\s?\d+)?|无标题(?:\s?\d+)?|未命名(?:\s?\d+)?|新建文本文档|new \d+|document\s?\d*|tài liệu\s?\d*|文档\s?\d*)$/iu;
function docName(title) { return String(title || '').split(/\s+[-–—]\s+/)[0].replace(/^[\s*●•]+/u, '').replace(/[\s*●•]+$/u, '').trim(); }
const untitled = (title) => UNTITLED.test(docName(title));

// việc “mở/tạo [trình soạn thảo] rồi gõ/viết …” (vi/en/zh) — KHÔNG tính khi người dùng nêu một tệp có sẵn / tài liệu đang mở
const OPEN = /(?:^|[^\p{L}])(?:mở|bật|khởi động|chạy|tạo|open|launch|start|run|create|new)(?![\p{L}])|打开|新建|启动|开启/iu;
const TYPE = /(?:^|[^\p{L}])(?:gõ|viết|(?<!đăng\s)nhập|ghi|soạn|điền|type|write|jot|input)(?![\p{L}])|输入|键入|写/iu;
const EXISTING = /(?:^|[^\p{L}])(?:đang mở|hiện tại|hiện có|có sẵn|sẵn có|cũ|tiếp vào|vào cuối|nối vào|current|existing|already open|same (?:file|document)|append|end of)(?![\p{L}])|当前|已打开|现有|末尾|追加|原来的/iu;
const OPEN_FILE = /(?:^|[^\p{L}])(?:mở|open|打开)\s+(?:(?:cái|the|a)\s+)?(?:tệp|tập tin|file|文件)(?![\p{L}])/iu;
const FILE_RE = /[\p{L}\d_\-]+\.(?:txt|md|docx?|rtf|odt|log|csv|json|ini|xml|html?|js|ts|py)(?![\p{L}\d])/giu;
// tên tệp đi sau “lưu (thành)/save as/保存为” là nơi LƯU tài liệu mới, không phải tệp có sẵn
const SAVE_BEFORE = /(?:lưu|save|保存|另存)[^.,;!?\n]{0,24}$/iu;
function namesExistingFile(t) {
  if (OPEN_FILE.test(t)) return true;
  for (const m of t.matchAll(FILE_RE)) if (!SAVE_BEFORE.test(t.slice(0, m.index))) return true;
  return false;
}
function freshDocTask(q) {
  const t = String(q || ''); if (!t.trim()) return false;
  return OPEN.test(t) && TYPE.test(t) && !EXISTING.test(t) && !namesExistingFile(t);
}

// vùng soạn thảo chính: phần tử soạn được lớn nhất (không phải OCR, không phải ô mật khẩu/hộp chọn)
function docEl(obs) {
  const els = (obs && Array.isArray(obs.elements) ? obs.elements : []).filter(e => e && e.editable && !e.ocr && !e.password && Array.isArray(e.b) && !/ComboBox/.test(String(e.role || '')));
  return els.sort((a, b) => b.b[2] * b.b[3] - a.b[2] * a.b[3])[0] || null;
}
const inside = (e, B) => Array.isArray(e.b) && Array.isArray(B) && e.b[0] + e.b[2] / 2 >= B[0] && e.b[0] + e.b[2] / 2 <= B[0] + B[2] && e.b[1] + e.b[3] / 2 >= B[1] && e.b[1] + e.b[3] / 2 <= B[1] + B[3];
// tài liệu đang hiện có phải tài liệu MỚI TRỐNG không: blank true (đã chứng minh) / false (có tên tệp hoặc có nội dung) / null (chưa đọc được nội dung)
function blankState(obs) {
  const win = obs && obs.win; const title = String(win && win.title || '');
  if (!editorOf(win)) return { blank: false, why: 'not-editor', title };
  if (!untitled(title)) return { blank: false, why: 'named', title };
  const el = docEl(obs);
  if (el && el.value != null) return String(el.value).trim() ? { blank: false, why: 'content', title } : { blank: true, why: 'empty', title };
  // không đọc được giá trị (ValuePattern): chữ (OCR/Text) nằm trong vùng soạn thảo = có nội dung
  const box = el ? el.b : null;
  const txt = box ? (obs.elements || []).filter(e => e !== el && (e.ocr || /^(Text|AXStaticText)$/.test(String(e.role || ''))) && String(e.name || '').trim() && inside(e, box)) : [];
  if (txt.length) return { blank: false, why: 'content', title };
  return { blank: null, why: 'unread', title };
}

// đảm bảo đang ở một tài liệu mới trống: d = { look({ ocr }) → { win, elements, dialog }, hotkey(keys), sleep(ms), log(msg) }
// → { ok, how: 'blank' | 'new', title, steps } | { ok: false, why, title, steps }
async function ensureFresh(d, { tries = 3 } = {}) {
  const steps = []; const log = (m) => { steps.push(m); try { d.log && d.log(m); } catch {} };
  let obs = await d.look({ ocr: 'auto' });
  if (!editorOf(obs && obs.win)) return { ok: false, skip: true, why: 'not-editor', title: obs && obs.win ? obs.win.title || '' : '', steps };
  const st0 = blankState(obs);
  if (st0.blank === true) { log(`“${st0.title}” là tài liệu mới trống`); return { ok: true, how: 'blank', title: st0.title, steps }; }
  log(`“${st0.title}” ${st0.why === 'named' ? 'là tệp có sẵn' : st0.why === 'content' ? 'đã có nội dung' : 'chưa đọc được nội dung'} → mở tài liệu mới (Ctrl+N)`);
  await d.hotkey('cmd+n');
  let st = null;
  for (let i = 0; i < tries; i++) {
    await d.sleep(600 + 400 * i);
    obs = await d.look({ ocr: i > 0 ? 'force' : 'auto' });
    if (obs && obs.dialog) { log(`hộp thoại “${obs.dialog}” hiện ra sau Ctrl+N → bấm Esc (Huỷ), không gõ`); await d.hotkey('escape'); st = { blank: false, why: 'dialog', title: String(obs.dialog) }; break; }
    st = blankState(obs);
    // vừa tự mở tài liệu mới: tiêu đề là tài liệu chưa đặt tên và KHÔNG thấy nội dung → tài liệu mới; thấy nội dung / tên tệp → chưa phải
    if (st.blank === true || (st.blank === null && st.why === 'unread')) { log(`đã mở tài liệu mới trống “${st.title}”${st.blank === true ? ' (đã kiểm: trống)' : ' (tiêu đề tài liệu mới, không thấy chữ)'}`); return { ok: true, how: 'new', title: st.title, steps }; }
  }
  log(`sau Ctrl+N vẫn chưa thấy tài liệu mới trống (${st ? st.why : '?'}: “${st ? st.title : ''}”) → KHÔNG gõ`);
  return { ok: false, why: st ? st.why : 'unknown', title: st ? st.title : '', steps };
}
module.exports = { EDITORS, editorOf, untitled, docName, freshDocTask, docEl, blankState, ensureFresh };
