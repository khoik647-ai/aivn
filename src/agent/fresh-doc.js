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
// dấu “đã sửa, chưa lưu” (*, ●) ở tên tài liệu = tài liệu ĐANG CÓ nội dung (thẻ khôi phục “*Untitled”) → không phải tài liệu mới trống
const dirty = (title) => /^\s*[*●•]|[*●•]\s*$/u.test(String(title || '').split(/\s+[-–—]\s+/)[0]);
// các thẻ tài liệu (Notepad Win11, Notepad++, VS Code… dùng chung MỘT cửa sổ/hwnd cho mọi thẻ): tên thẻ đã bỏ dấu sửa đổi, theo thứ tự
const tabsOf = (obs) => (obs && Array.isArray(obs.elements) ? obs.elements : []).filter(e => e && /^(TabItem|AXTab)$/.test(String(e.role || '')) && !e.ocr).map(e => docName(e.name));
// “dấu vân tay” tài liệu đang hiện: cửa sổ + tiêu đề + danh sách thẻ — dùng để chứng minh Ctrl+N ĐÃ có tác dụng và trước mỗi lần gõ
function docPrint(obs) { const w = (obs && obs.win) || {}; return { hwnd: w.hwnd != null ? String(w.hwnd) : null, title: String(w.title || ''), tabs: tabsOf(obs) }; }
const samePrint = (a, b) => !!a && !!b && a.hwnd === b.hwnd && a.title === b.title && a.tabs.join('\u0001') === b.tabs.join('\u0001');
// bằng chứng Ctrl+N ĐÃ mở một tài liệu MỚI (review #64 (a)): “có gì đó đổi” chưa đủ — thêm thẻ khác/đổi thứ tự/đóng thẻ/hwnd null→có đều KHÔNG tính.
// Chỉ nhận: (1) cùng cửa sổ, danh sách thẻ = các thẻ cũ GIỮ NGUYÊN thứ tự + ĐÚNG MỘT thẻ mới, thẻ mới là Untitled và trùng tên tài liệu đang hiện;
// hoặc (2) hwnd cũ và mới đều có giá trị và khác nhau (cửa sổ mới), cửa sổ mới không có thẻ hoặc chỉ một thẻ đúng tên tài liệu đang hiện. Còn lại → không chắc → không gõ.
function newDocEvidence(a, b) {
  if (!a || !b) return false;
  const name = docName(b.title); if (!UNTITLED.test(name)) return false;
  if (a.hwnd != null && b.hwnd != null && a.hwnd !== b.hwnd) return b.tabs.length === 0 || (b.tabs.length === 1 && b.tabs[0] === name);
  if (a.hwnd !== b.hwnd || !b.tabs.length || b.tabs.length !== a.tabs.length + 1) return false;
  // a.tabs phải là dãy con giữ thứ tự của b.tabs; phần dư đúng một thẻ
  let i = 0; let extra = null;
  for (const t of b.tabs) { if (i < a.tabs.length && t === a.tabs[i]) i++; else if (extra === null) extra = t; else return false; }
  return i === a.tabs.length && extra !== null && UNTITLED.test(extra) && extra === name;
}

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
  if (dirty(title)) return { blank: false, why: 'dirty', title };
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
  const st0 = blankState(obs); const p0 = docPrint(obs);
  if (st0.blank === true) { log(`“${st0.title}” là tài liệu mới trống`); return { ok: true, how: 'blank', title: st0.title, print: p0, steps }; }
  log(`“${st0.title}” ${st0.why === 'named' ? 'là tệp có sẵn' : st0.why === 'content' ? 'đã có nội dung' : st0.why === 'dirty' ? 'đã sửa, chưa lưu' : 'chưa đọc được nội dung'} → mở tài liệu mới (Ctrl+N)`);
  await d.hotkey('cmd+n');
  let st = null;
  for (let i = 0; i < tries; i++) {
    await d.sleep(600 + 400 * i);
    obs = await d.look({ ocr: 'force' }); // luôn ép OCR: “không thấy chữ” chỉ có nghĩa khi đã thật sự đọc màn hình
    if (obs && obs.dialog) { log(`hộp thoại “${obs.dialog}” hiện ra sau Ctrl+N → bấm Esc (Huỷ), không gõ`); await d.hotkey('escape'); st = { blank: false, why: 'dialog', title: String(obs.dialog) }; break; }
    st = blankState(obs);
    // trống ĐÃ KIỂM (đọc được giá trị = rỗng) → tài liệu mới. Chỉ “không đọc được giá trị, OCR ép không thấy chữ” thì CHƯA đủ:
    // phải có bằng chứng Ctrl+N đã có tác dụng (cửa sổ/tiêu đề/danh sách thẻ đổi so với trước) — không thì có thể vẫn là thẻ cũ → dừng (fail closed)
    if (st.blank === true) { log(`đã mở tài liệu mới trống “${st.title}” (đã kiểm: trống)`); return { ok: true, how: 'new', title: st.title, print: docPrint(obs), steps }; }
    if (st.blank === null && st.why === 'unread') {
      if (newDocEvidence(p0, docPrint(obs))) { log(`đã mở tài liệu mới trống “${st.title}” (Ctrl+N đã mở thẻ/cửa sổ mới, OCR không thấy chữ)`); return { ok: true, how: 'new', title: st.title, print: docPrint(obs), steps }; }
      st = { blank: false, why: samePrint(p0, docPrint(obs)) ? 'unchanged' : 'not-new', title: st.title };
    }
  }
  log(`sau Ctrl+N vẫn chưa thấy tài liệu mới trống (${st ? st.why : '?'}: “${st ? st.title : ''}”) → KHÔNG gõ`);
  return { ok: false, why: st ? st.why : 'unknown', title: st ? st.title : '', steps };
}
// trước MỖI lần gõ: tài liệu đang hiện có còn đúng là tài liệu mới AIVN đã mở (rec = { hwnd, title, print, typed, texts }) không.
// Notepad Win11 dùng chung hwnd cho mọi thẻ → kiểm cả danh sách thẻ; chưa gõ gì thì tài liệu còn phải trống (không dấu sửa, không nội dung). Không chắc → không gõ.
function sameDoc(rec, obs) {
  const w = (obs && obs.win) || {}; const now = docPrint(obs);
  if (!rec || !rec.print) return { ok: false, why: 'unknown' };
  if (rec.print.hwnd && now.hwnd && rec.print.hwnd !== now.hwnd) return { ok: false, why: 'window' };
  if (!untitled(w.title)) return { ok: false, why: 'named' };
  if (rec.print.tabs.join('\u0001') !== now.tabs.join('\u0001')) return { ok: false, why: 'tabs' };
  if (!rec.typed) { const st = blankState(obs); if (st.blank === false) return { ok: false, why: st.why }; return { ok: true }; }
  // đã gõ: đọc được nội dung thì nó phải chứa đúng các đoạn AIVN đã gõ (thẻ “*Untitled” cũ của người dùng cũng có dấu * — phân biệt bằng nội dung)
  const el = docEl(obs); const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  if (el && el.value != null && (rec.texts || []).some(t => norm(t) && !norm(el.value).includes(norm(t)))) return { ok: false, why: 'content' };
  return { ok: true };
}
module.exports = { EDITORS, editorOf, untitled, dirty, docName, tabsOf, docPrint, newDocEvidence, freshDocTask, docEl, blankState, ensureFresh, sameDoc };
