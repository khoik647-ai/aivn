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

// tên tài liệu MỚI chưa lưu (tiếng Anh/Việt/Trung; VS Code bản địa: “无标题-1”, “未命名-1”, “Không có tiêu đề-1”) — phần đầu tiêu đề trước “ - Ứng dụng”; bỏ dấu “chưa lưu” (*, ●) ở đầu
const UNTITLED = /^(?:untitled(?:[\s-]?\d+)?|untitled document(?:[\s-]?\d+)?|không có tiêu đề(?:[\s-]?\d+)?|không tiêu đề(?:[\s-]?\d+)?|chưa đặt tên(?:[\s-]?\d+)?|chưa có tên(?:[\s-]?\d+)?|无标题(?:[\s-]?\d+)?|未命名(?:[\s-]?\d+)?|新建文本文档|new \d+|document\s?\d+|tài liệu\s?\d+|文档\s?\d+)$/iu; // QA #64 v3 P64-5: Word ẩn đuôi .docx → “Document - Word” có thể là tệp ĐÃ LƯU; tài liệu mới của Word luôn có số (Document1)
function docName(title) { return String(title || '').split(/\s+[-–—]\s+/)[0].replace(/^[\s*●•]+/u, '').replace(/[\s*●•]+$/u, '').trim(); }
// WordPad: tài liệu mới tên “Document” (không số) và WordPad hiện cả đuôi tệp → “Document - WordPad” là chưa đặt tên; Word thì không (P64-5)
const untitled = (title) => { const n = docName(title); return UNTITLED.test(n) || (/^document$/i.test(n) && /\s[-–—]\sWordPad$/i.test(String(title || ''))); };
// dấu “đã sửa, chưa lưu” (*, ●) ở tên tài liệu = tài liệu ĐANG CÓ nội dung (thẻ khôi phục “*Untitled”) → không phải tài liệu mới trống
const dirty = (title) => /^\s*[*●•]|[*●•]\s*$/u.test(String(title || '').split(/\s+[-–—]\s+/)[0]);
// các thẻ tài liệu (Notepad Win11, Notepad++, VS Code… dùng chung MỘT cửa sổ/hwnd cho mọi thẻ): tên thẻ đã bỏ dấu sửa đổi, theo thứ tự
const tabEls = (obs) => (obs && Array.isArray(obs.elements) ? obs.elements : []).filter(e => e && /^(TabItem|AXTab)$/.test(String(e.role || '')) && !e.ocr);
const tabsOf = (obs) => tabEls(obs).map(e => docName(e.name));
// QA #64 v3 P64-9/P64-3: thẻ nào ĐANG CHỌN (UIA SelectionItem.IsSelected → e.selected) — null khi cây không cho biết (không đoán)
function selOf(els) { if (!els.some(e => typeof e.selected === 'boolean')) return null; const i = els.map(e => e.selected === true); return i.filter(Boolean).length === 1 ? i.indexOf(true) : -1; }
// “dấu vân tay” tài liệu đang hiện: cửa sổ + tiêu đề + danh sách thẻ (+ dấu sửa đổi từng thẻ, thẻ đang chọn) — chứng minh Ctrl+N ĐÃ có tác dụng và kiểm trước mỗi lần gõ
function docPrint(obs) { const w = (obs && obs.win) || {}; const els = tabEls(obs); return { hwnd: w.hwnd != null ? String(w.hwnd) : null, title: String(w.title || ''), tabs: els.map(e => docName(e.name)), dirty: els.map(e => dirty(e.name)), sel: selOf(els) }; }
const samePrint = (a, b) => !!a && !!b && a.hwnd === b.hwnd && a.title === b.title && a.tabs.join('\u0001') === b.tabs.join('\u0001');
const tabKeys = (p) => p.tabs.map((t, i) => (p.dirty && p.dirty[i] ? '*' : '') + t);
// trình soạn thảo có THẺ trong một cửa sổ: cùng hwnd KHÔNG chứng minh cùng tài liệu
const TABBED = new Set(['notepad', 'notepad++', 'vscode', 'linux-editor', 'textedit']);
// bằng chứng Ctrl+N ĐÃ mở một tài liệu MỚI (review #64 (a)): “có gì đó đổi” chưa đủ — thêm thẻ khác/đổi thứ tự/đóng thẻ/hwnd null→có đều KHÔNG tính.
// Chỉ nhận: (1) cùng cửa sổ, danh sách thẻ = các thẻ cũ GIỮ NGUYÊN thứ tự (tên + dấu sửa đổi) + ĐÚNG MỘT thẻ mới Untitled chưa sửa, trùng tài liệu đang hiện;
// hoặc (2) hwnd cũ và mới đều có giá trị và khác nhau (cửa sổ mới), cửa sổ mới không có thẻ hoặc chỉ một thẻ đúng tên tài liệu đang hiện.
// QA #64 v3 P64-9: tiêu đề còn dấu sửa (“*Untitled - Notepad”) = đang ở thẻ CŨ đã có chữ → KHÔNG nhận. Thẻ ĐANG CHỌN phải là thẻ mới:
// biết thẻ đang chọn (UIA) → phải nằm ở chỗ thẻ mới; không biết → chỉ nhận khi tiêu đề trỏ duy nhất một thẻ (không có thẻ cũ cùng tên, cùng trạng thái). Còn lại → không chắc → không gõ.
// → { idx } (vị trí thẻ mới; null khi cửa sổ mới không có thẻ) | null
function newDocAt(a, b) {
  if (!a || !b) return null;
  const name = docName(b.title); if (!untitled(b.title) || dirty(b.title)) return null;
  const bd = b.dirty || [];
  if (a.hwnd != null && b.hwnd != null && a.hwnd !== b.hwnd) {
    if (!b.tabs.length) return { idx: null };
    return b.tabs.length === 1 && b.tabs[0] === name && !bd[0] && (b.sel == null || b.sel === 0) ? { idx: 0 } : null;
  }
  if (a.hwnd !== b.hwnd || !b.tabs.length || b.tabs.length !== a.tabs.length + 1) return null;
  const ak = tabKeys(a).join('\u0001'); const bk = tabKeys(b);
  const pos = bk.map((_, i) => i).filter(i => bk.filter((_, j) => j !== i).join('\u0001') === ak);
  if (!pos.length || !pos.every(i => b.tabs[i] === name && !bd[i])) return null;
  if (b.sel != null) return pos.includes(b.sel) ? { idx: b.sel } : null;
  const cand = bk.map((k, i) => (k === name ? i : -1)).filter(i => i >= 0);
  return cand.length === 1 && pos.includes(cand[0]) ? { idx: cand[0] } : null;
}
const newDocEvidence = (a, b) => !!newDocAt(a, b);

// việc GÕ/VIẾT/DÁN chữ (vi có/không dấu, en, zh giản thể/phồn thể) — desktop-agent chỉ dùng khi cửa sổ đang ở trước là trình soạn thảo.
// QA #64 v3 P64-2: KHÔNG cần động từ “mở” (“type hello in Notepad”, “在记事本里输入你好”, lượt sau “gõ…” khi Notepad đã mở), có “dán/paste/enter”, không dấu, phồn thể;
// “hiện tại/current/cũ/end of” đứng một mình (ngày giờ hiện tại, bạn cũ, end of day) không còn chặn — chỉ khi người dùng NÓI RÕ tài liệu/tệp có sẵn.
const TYPE = /(?:^|[^\p{L}])(?:gõ|viết|(?<!đăng\s)nhập|ghi|soạn|điền|dán|type(?!\s+of\b)|write|jot|input|(?<!press\s)enter|paste)(?![\p{L}])|输入|键入|写|粘贴|贴上|輸入|鍵入|寫|貼上/iu;
const TYPE_ASCII = /(?:^|[\s,;:])(?:va|roi|hay|sau do|xong|de|giup|cho)\s+(?:go|viet|nhap|soan|dien|dan|ghi)(?![\p{L}])|(?:^|[^\p{L}])(?:go|viet|nhap|soan|dien|dan)\s+(?:vao|len|chu|dong|cau|doan|noi dung|van ban|xin chao|loi|thu|bai)(?![\p{L}])/iu;
const EXISTING = /(?:^|[^\p{L}])(?:(?:tài liệu|tệp|tập tin|file|thẻ)\s+(?:đang mở|hiện tại|hiện có|có sẵn|sẵn có|cũ|này|đó)|đang mở sẵn|tiếp vào|vào cuối|nối vào|gõ tiếp|viết tiếp|(?:current|existing|already[- ]open|same|this|that)\s+(?:file|document|doc|tab)|already open|append|at the end of (?:the|this|my)|continue (?:typing|writing))(?![\p{L}])|当前(?:文档|文件|标签)|當前(?:文檔|文件|標籤)|已打开|已打開|现有|現有|末尾|追加|原来的|原來的|继续(?:输入|写)|繼續(?:輸入|寫)/iu;
const OPEN_FILE = /(?:^|[^\p{L}])(?:mở|open|打开|打開)\s+(?:(?:cái|the|a|my)\s+)?(?:tệp|tập tin|file|文件)(?![\p{L}])/iu;
const FILE_RE = /[\p{L}\d_\-]+\.(?:txt|md|docx?|rtf|odt|log|csv|ini)(?![A-Za-z\d])/giu;
// đuôi tệp mã (js/ts/py/json/html…) trùng tên công nghệ (“node.js”) → chỉ tính là tệp khi có đường dẫn hoặc đứng ngay sau “mở/open/vào/into”
const CODE_FILE_RE = /[\p{L}\d_\-]+\.(?:js|ts|py|json|html?|xml|css)(?![A-Za-z\d])/giu;
const CODE_BEFORE = /(?:[\\/:]|(?:^|[^\p{L}])(?:mở|open|edit|sửa|vào|into|打开|打開|在)\s*)$/iu;
// tên tệp đi sau “lưu (thành)/save as/保存为” là nơi LƯU tài liệu mới, không phải tệp có sẵn
const SAVE_BEFORE = /(?:lưu|save|保存|另存)[^.,;!?\n]{0,24}$/iu;
function namesExistingFile(t) {
  if (OPEN_FILE.test(t)) return true;
  for (const m of t.matchAll(FILE_RE)) if (!SAVE_BEFORE.test(t.slice(0, m.index))) return true;
  for (const m of t.matchAll(CODE_FILE_RE)) if (CODE_BEFORE.test(t.slice(0, m.index)) && !SAVE_BEFORE.test(t.slice(0, m.index))) return true;
  return false;
}
// review #64 vòng 4 (3): NỘI DUNG cần gõ (trong ngoặc kép, sau dấu “:” đầu tiên) không được tắt bảo vệ (“gõ: Đừng xoá tệp này”, “type: see readme.txt”)
// → chỉ xét phần LỆNH khi tìm cách nói “tệp/tài liệu có sẵn” và tên tệp. “:” trong đường dẫn (C:\, http://) hay giờ (10:30) không tính.
const QUOTED = /"[^"\n]*"|“[^”\n]*”|„[^“”\n]*[“”]|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|«[^»\n]*»|(?<![\p{L}\d])'[^'\n]*'(?![\p{L}\d])/gu;
function commandPart(q) {
  let t = String(q || '').replace(QUOTED, ' ');
  t = t.replace(/["“„「『‘«][^\n]*$/u, ' '); // ngoặc mở không đóng → phần sau là nội dung
  const i = t.search(/[:：](?![\\/]|\d)/u); if (i >= 0) t = t.slice(0, i);
  return t;
}
function freshDocTask(q) {
  const t = String(q || ''); if (!t.trim()) return false;
  const c = commandPart(t);
  return (TYPE.test(t) || TYPE_ASCII.test(t)) && !EXISTING.test(c) && !namesExistingFile(c);
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
  // review #64 vòng 4: OCR lỗi / không chạy được → KHÔNG phải “không có chữ”: không chắc
  if (obs && obs.ocrFailed) return { blank: null, why: 'ocr-failed', title };
  return { blank: null, why: 'unread', title };
}

// đảm bảo đang ở một tài liệu mới trống: d = { look({ ocr }) → { win, elements, dialog }, hotkey(keys), sleep(ms), log(msg) }
// → { ok, how: 'blank' | 'new', title, steps } | { ok: false, why, title, steps }
async function ensureFresh(d, { tries = 3 } = {}) {
  const steps = []; const log = (m) => { steps.push(m); try { d.log && d.log(m); } catch {} };
  let obs = await d.look({ ocr: 'auto' });
  if (!editorOf(obs && obs.win)) return { ok: false, skip: true, why: 'not-editor', title: obs && obs.win ? obs.win.title || '' : '', steps };
  const st0 = blankState(obs); const p0 = docPrint(obs);
  if (st0.blank === true) { log(`“${st0.title}” là tài liệu mới trống`); return { ok: true, how: 'blank', title: st0.title, print: { ...p0, newIdx: p0.sel != null && p0.sel >= 0 ? p0.sel : null }, steps }; }
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
    const p1 = docPrint(obs); const at = newDocAt(p0, p1);
    if (st.blank === true) { log(`đã mở tài liệu mới trống “${st.title}” (đã kiểm: trống)`); return { ok: true, how: 'new', title: st.title, print: { ...p1, newIdx: at ? at.idx : (p1.sel != null && p1.sel >= 0 ? p1.sel : null) }, steps }; }
    if (st.blank === null && st.why === 'unread') {
      if (at) { log(`đã mở tài liệu mới trống “${st.title}” (Ctrl+N đã mở thẻ/cửa sổ mới, OCR không thấy chữ)`); return { ok: true, how: 'new', title: st.title, print: { ...p1, newIdx: at.idx }, steps }; }
      st = { blank: false, why: samePrint(p0, docPrint(obs)) ? 'unchanged' : 'not-new', title: st.title };
    }
    if (st.blank === null && st.why === 'ocr-failed') st = { blank: false, why: 'unsure', title: st.title }; // OCR lỗi: không chắc → thử lại / dừng
  }
  log(`sau Ctrl+N vẫn chưa thấy tài liệu mới trống (${st ? st.why : '?'}: “${st ? st.title : ''}”) → KHÔNG gõ`);
  return { ok: false, why: st ? st.why : 'unknown', title: st ? st.title : '', steps };
}
// QA #64 v3 P64-4: VS Code đổi tên tài liệu chưa lưu theo DÒNG ĐẦU vừa gõ (“● xin chào - Visual Studio Code”) → vẫn là tài liệu của AIVN khi tên = đầu dòng AIVN đã gõ
function ownTitle(rec, win) {
  const ed = editorOf(win); if (!ed || ed.id !== 'vscode' || !rec || !rec.typed) return false;
  const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const label = norm(docName(win.title).replace(/(?:…|\.\.\.)$/u, '')); const first = norm(String((rec.texts || []).join('\n')).split('\n').find(l => l.trim()) || '');
  return [...label].length >= 3 && !!first && first.startsWith(label); // review #64 vòng 4: nhãn 1–2 ký tự trùng quá dễ → không nhận
}
// trước MỖI lần gõ: tài liệu đang hiện có còn đúng là tài liệu mới AIVN đã mở (rec = { hwnd, title, print, typed, texts }) không.
// Notepad Win11 dùng chung hwnd cho mọi thẻ → kiểm cả danh sách thẻ + THẺ ĐANG CHỌN; chưa gõ gì thì tài liệu còn phải trống. Không chắc → không gõ.
// QA #64 v3 P64-3a/3b: “không đọc được nội dung” (unread) KHÔNG còn là OK — chỉ nhận khi CHỨNG MINH được đang ở đúng tài liệu:
// thẻ đang chọn (UIA) đúng vị trí thẻ mới, hoặc trình soạn thảo mỗi tài liệu một cửa sổ (Word…) và cùng hwnd. Không thì 'unsure' → dừng.
function sameDoc(rec, obs) {
  const w = obs && obs.win;
  if (!rec || !rec.print) return { ok: false, why: 'unknown' };
  if (!w) return { ok: false, why: 'no-window' };
  const now = docPrint(obs); const ed = editorOf(w);
  if (!ed) return { ok: false, why: 'not-editor' };
  if (rec.print.hwnd && (!now.hwnd || rec.print.hwnd !== now.hwnd)) return { ok: false, why: 'window' };
  const own = ownTitle(rec, w);
  if (!untitled(w.title) && !own) return { ok: false, why: 'named' };
  const k = rec.print.newIdx;
  const tabsOk = rec.print.tabs.length === now.tabs.length && rec.print.tabs.every((t, i) => t === now.tabs[i] || (own && i === k && now.tabs[i] === docName(w.title)));
  if (!tabsOk) return { ok: false, why: 'tabs' };
  if (now.sel != null && now.sel >= 0 && k != null && now.sel !== k) return { ok: false, why: 'focus' };
  const proven = (now.sel != null && k != null && now.sel === k) || (!TABBED.has(ed.id) && !now.tabs.length && !!rec.print.hwnd && rec.print.hwnd === now.hwnd);
  if (!rec.typed) { const st = blankState(obs); if (st.blank === false) return { ok: false, why: st.why }; if (st.why === 'ocr-failed') return { ok: false, why: 'unsure' }; if (st.blank === true || proven) return { ok: true }; return { ok: false, why: 'unsure' }; }
  // đã gõ: đọc được nội dung thì nó phải chứa đúng các đoạn AIVN đã gõ (thẻ “*Untitled” cũ của người dùng cũng có dấu * — phân biệt bằng nội dung)
  const el = docEl(obs); const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  if (el && el.value != null) return (rec.texts || []).some(t => norm(t) && !norm(el.value).includes(norm(t))) ? { ok: false, why: 'content' } : { ok: true };
  return proven ? { ok: true } : { ok: false, why: 'unsure' };
}
module.exports = { EDITORS, editorOf, untitled, dirty, docName, tabsOf, docPrint, newDocEvidence, newDocAt, ownTitle, TABBED, freshDocTask, commandPart, docEl, blankState, ensureFresh, sameDoc };
