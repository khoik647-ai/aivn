'use strict';
// B191 (QA beta.3, Windows 11): “mở Notepad và gõ một dòng” → Notepad khôi phục THẺ CŨ có nội dung của người dùng và AIVN gõ vào đó.
// Nguyên tắc chung: việc “mở/tạo trình soạn thảo rồi gõ” → mở TÀI LIỆU MỚI (Ctrl+N) và KIỂM là tài liệu chưa đặt tên, trống trước khi gõ;
// không chứng minh được → KHÔNG gõ. Màn hình Notepad GIẢ (thẻ khôi phục, Ctrl+N, hộp thoại) — không cần mô hình hay Windows thật.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const FD = require('../src/agent/fresh-doc');
const { VI } = require('../src/i18n/core');

test('B191: nhận việc “mở/tạo X rồi gõ” (vi/en/zh); không nhận khi người dùng nêu tệp/tài liệu có sẵn', () => {
  for (const q of ['mở Notepad và gõ một dòng', 'Mở notepad rồi viết "xin chào"', 'open Notepad and type a line', 'open Notepad and write hello', '打开记事本并输入一行字',
    'tạo tài liệu Word mới và soạn thư xin nghỉ', 'mở Notepad, gõ "abc" rồi lưu thành ghichu.txt', 'open Notepad, type hi and save as a.txt'])
    assert.strictEqual(FD.freshDocTask(q), true, q);
  for (const q of ['mở notes.txt trong Notepad và thêm dòng', 'mở ghichu.txt và gõ abc', 'mở tệp báo cáo và viết thêm', 'mở Word và đăng nhập', 'mở Notepad',
    'gõ vào tài liệu đang mở', 'open the existing document and type a line', 'mở Notepad và gõ tiếp vào cuối', '在当前文档末尾输入一行', '']) assert.strictEqual(FD.freshDocTask(q), false, q);
});

test('B191: trình soạn thảo + tiêu đề tài liệu mới chưa đặt tên', () => {
  assert.strictEqual(FD.editorOf({ proc: 'Notepad.exe', title: 'x' }).id, 'notepad');
  assert.strictEqual(FD.editorOf({ proc: '', title: 'Không có tiêu đề - Notepad' }).id, 'notepad');
  assert.strictEqual(FD.editorOf({ proc: 'WINWORD.EXE', title: 'Document1 - Word' }).id, 'word');
  assert.strictEqual(FD.editorOf({ proc: 'soffice.bin', title: 'Untitled 1 - LibreOffice Calc' }), null, 'LibreOffice Calc không phải trình soạn văn bản');
  assert.strictEqual(FD.editorOf({ proc: 'Zalo.exe', title: 'Zalo' }), null);
  for (const t of ['Untitled - Notepad', '*Untitled - Notepad', 'Không có tiêu đề - Notepad', '无标题 - 记事本', 'Document1 - Word', 'new 3 - Notepad++', 'Untitled-1 - Visual Studio Code', '● Untitled-2 - Visual Studio Code'])
    assert.strictEqual(FD.untitled(t), true, t);
  for (const t of ['secret.txt - Notepad', '*matkhau.txt - Notepad', 'Báo cáo quý 3.docx - Word', 'notes.md - Visual Studio Code']) assert.strictEqual(FD.untitled(t), false, t);
});

// ---- Notepad GIẢ trên Windows 11: các thẻ, thẻ đang chọn, Ctrl+N mở thẻ mới ----
const NOTEPAD_BOX = [0, 80, 1000, 600];
function fakeNotepad({ tabs, active = 0, ctrlN = 'tab', valueReadable = true, tabItems = false } = {}) {
  const st = { tabs: tabs.map(t => ({ ...t })), active, keys: [], typed: [], looks: [] };
  const win = () => ({ title: `${st.tabs[st.active].dirty ? '*' : ''}${st.tabs[st.active].name} - Notepad`, proc: 'Notepad.exe', pid: 42, hwnd: 7 });
  const look = async ({ ocr }) => {
    st.looks.push(ocr); const t = st.tabs[st.active];
    if (st.dialog) return { win: win(), elements: [], dialog: st.dialog };
    const els = [{ role: 'Document', kind: 'edit', name: 'Text editor', editable: true, value: valueReadable ? t.text : null, b: NOTEPAD_BOX },
      { role: 'Edit', kind: 'edit', name: 'Find', editable: true, value: '', b: [700, 10, 200, 24] }];
    if (tabItems) st.tabs.forEach((x, i) => els.push({ role: 'TabItem', kind: 'tab', name: (x.dirty ? '*' : '') + x.name, b: [10 + 130 * i, 40, 120, 30], ...(tabItems === 'nosel' ? {} : { selected: i === st.active }) }));
    if (!valueReadable && t.text) els.push({ ocr: true, name: t.text.split('\n')[0], b: [10, 90, 300, 20] });
    return { win: win(), elements: els, dialog: null };
  };
  const hotkey = async (k) => { st.keys.push(k);
    if (k === 'cmd+n') { if (ctrlN === 'tab' || ctrlN === 'bg') { st.tabs.push({ name: 'Untitled', text: '' }); if (ctrlN === 'tab') st.active = st.tabs.length - 1; } else if (ctrlN === 'dialog') st.dialog = 'Notepad'; }
    if (k === 'escape') st.dialog = null; };
  const type = (s) => { st.typed.push([st.tabs[st.active].name, s]); st.tabs[st.active].text += s; st.tabs[st.active].dirty = true; };
  return { st, d: { look, hotkey, sleep: async () => {}, log: () => {} }, type };
}
const SECRET = 'mật khẩu ngân hàng: ********';

// ---- review PR #64 (1): sau Ctrl+N “không đọc được giá trị” + OCR không thấy chữ CHƯA đủ — phải có bằng chứng Ctrl+N đã có tác dụng ----
test('B191 review (1): thẻ “Untitled” khôi phục không đọc được nội dung, Ctrl+N không có tác dụng → DỪNG (fail closed), không gõ vào thẻ cũ', async () => {
  // màn hình giả đúng như review: look auto → cmd+n (không tác dụng) → look; vùng soạn không có ValuePattern, OCR cũng không đọc ra chữ
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: '' }], ctrlN: 'nothing', valueReadable: false });
  N.st.tabs[0].hidden = SECRET; // có nội dung thật nhưng không đọc được (không ValuePattern, OCR trượt)
  const r = await FD.ensureFresh(N.d);
  assert.strictEqual(r.ok, false, JSON.stringify(r)); assert.strictEqual(r.why, 'unchanged'); assert.deepStrictEqual(N.st.keys, ['cmd+n']);
  assert.ok(N.st.looks.slice(1).every(o => o === 'force'), 'mọi lần nhìn sau Ctrl+N đều ép OCR: ' + N.st.looks.join(','));
  assert.ok(r.steps.some(s => /KHÔNG gõ/.test(s)));
});
test('B191 review (1): Ctrl+N mở thẻ mới (danh sách thẻ đổi) + OCR ép không thấy chữ → nhận là tài liệu mới', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: '' }], valueReadable: false, tabItems: true });
  const r = await FD.ensureFresh(N.d); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.how, 'new'); assert.strictEqual(N.st.active, 1);
  assert.deepStrictEqual(r.print.tabs, ['Untitled', 'Untitled']);
});
test('B191 review (1): Ctrl+N không có tác dụng — cả khi danh sách thẻ hiện ra nhưng không đổi → DỪNG', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: '' }], ctrlN: 'nothing', valueReadable: false, tabItems: true });
  const r = await FD.ensureFresh(N.d); assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'unchanged');
});

// ---- review PR #64 (a): “danh sách thẻ/hwnd có đổi” chưa phải bằng chứng đã mở tài liệu mới — phải có ĐÚNG MỘT thẻ Untitled mới (hoặc cửa sổ mới) ----
const P = (tabs, title = 'Untitled - Notepad', hwnd = '7') => ({ hwnd, title, tabs });
test('B191 review (a): newDocEvidence — chỉ nhận thêm đúng một thẻ Untitled mới (giữ thứ tự thẻ cũ) hoặc cửa sổ mới', () => {
  const E = FD.newDocEvidence;
  assert.strictEqual(E(P(['secret.txt']), P(['secret.txt', 'Untitled'])), true, 'thêm thẻ Untitled');
  // QA #64 v3 (INFO): thẻ “Untitled” cũ sạch + thẻ “Untitled” mới — tiêu đề không chỉ ra thẻ nào đang chọn → chỉ nhận khi biết thẻ đang chọn (UIA) là thẻ mới
  assert.strictEqual(E(P(['Untitled', 'notes.txt']), P(['Untitled', 'notes.txt', 'Untitled'])), false, 'thêm thẻ Untitled thứ hai, không biết thẻ đang chọn → không chắc');
  assert.strictEqual(E(P(['Untitled', 'notes.txt']), { ...P(['Untitled', 'notes.txt', 'Untitled']), sel: 2 }), true, 'thêm thẻ Untitled thứ hai, đang chọn thẻ mới');
  assert.strictEqual(E(P(['Untitled', 'notes.txt']), { ...P(['Untitled', 'notes.txt', 'Untitled']), sel: 0 }), false, 'đang chọn thẻ Untitled CŨ');
  assert.strictEqual(E(P(['a.txt', 'b.txt']), P(['a.txt', 'Untitled', 'b.txt'])), true, 'thẻ mới chèn giữa, thẻ cũ giữ thứ tự');
  assert.strictEqual(E(P([], 'x - Notepad', '7'), P([], 'Untitled - Notepad', '8')), true, 'cửa sổ mới (hwnd đều có giá trị, khác nhau)');
  assert.strictEqual(E(P(['a.txt'], 'a.txt - Notepad', '7'), P(['Untitled'], 'Untitled - Notepad', '8')), true, 'cửa sổ mới chỉ một thẻ Untitled');
  // các trường hợp probe của review: đều phải KHÔNG nhận
  assert.strictEqual(E(P(['Untitled']), P(['Untitled', 'notes.txt'])), false, 'thêm thẻ KHÔNG phải Untitled');
  assert.strictEqual(E(P(['Untitled']), P(['Untitled', 'notes.txt'], 'notes.txt - Notepad')), false);
  assert.strictEqual(E(P(['Untitled', 'notes.txt']), P(['notes.txt', 'Untitled'])), false, 'đổi thứ tự thẻ');
  assert.strictEqual(E(P(['Untitled', 'notes.txt']), P(['Untitled'])), false, 'một thẻ bị đóng');
  assert.strictEqual(E(P(['Untitled', 'notes.txt']), P(['Untitled', 'Untitled'])), false, 'đóng một thẻ + mở một thẻ (số thẻ không +1)');
  assert.strictEqual(E(P([], 'Untitled - Notepad', null), P([], 'Untitled - Notepad', '7')), false, 'hwnd null → có giá trị');
  assert.strictEqual(E(P([], 'Untitled - Notepad', '7'), P([], 'Untitled - Notepad', null)), false, 'hwnd có giá trị → null');
  assert.strictEqual(E(P([], '*Untitled - Notepad'), P([], 'Untitled - Notepad')), false, 'không có thẻ, cùng hwnd: chỉ tiêu đề đổi → có thể là chuyển thẻ');
  assert.strictEqual(E(P(['a.txt']), P(['a.txt', 'Untitled', 'Untitled'])), false, 'thêm hai thẻ');
  assert.strictEqual(E(P(['a.txt']), P(['a.txt', 'Untitled 2'], 'Untitled - Notepad')), false, 'thẻ mới không trùng tài liệu đang hiện');
  assert.strictEqual(E(P(['a.txt'], 'a.txt - Notepad', '7'), P(['Untitled', 'b.txt'], 'Untitled - Notepad', '8')), false, 'cửa sổ khác có sẵn nhiều thẻ');
  assert.strictEqual(E(P(['a.txt']), P(['a.txt', 'Untitled'], 'b.txt - Notepad')), false, 'tài liệu đang hiện không phải Untitled');
  assert.strictEqual(E(null, P(['Untitled'])), false);
});
test('B191 review (a): ensureFresh — sau Ctrl+N danh sách thẻ đổi nhưng KHÔNG có thẻ Untitled mới (đang ở thẻ “Untitled” cũ không đọc được) → DỪNG, không gõ', async () => {
  const mk = (after) => { const looks = [P(['Untitled', 'notes.txt']), after]; const keys = []; let i = 0;
    const toObs = (p) => ({ win: { proc: 'Notepad.exe', title: p.title, hwnd: p.hwnd, pid: 1 }, elements: [{ role: 'Document', editable: true, value: null, b: NOTEPAD_BOX }, ...p.tabs.map(n => ({ role: 'TabItem', name: n, b: [0, 40, 100, 30] }))] });
    return { keys, d: { look: async () => toObs(looks[Math.min(i++, 1)]), hotkey: async (k) => keys.push(k), sleep: async () => {}, log: () => {} } }; };
  for (const [label, after] of [['thêm thẻ không phải Untitled', P(['Untitled', 'notes.txt', 'todo.txt'])], ['đổi thứ tự', P(['notes.txt', 'Untitled'])],
    ['đóng thẻ', P(['Untitled'])], ['hwnd null→có', P(['Untitled', 'notes.txt'], 'Untitled - Notepad', '9')]]) {
    const M = mk(after); if (label.startsWith('hwnd')) M.d.look = (() => { let j = 0; const o = [{ ...P(['Untitled', 'notes.txt']), hwnd: null }, after]; return async () => { const p = o[Math.min(j++, 1)]; return { win: { proc: 'Notepad.exe', title: p.title, hwnd: p.hwnd, pid: 1 }, elements: [{ role: 'Document', editable: true, value: null, b: NOTEPAD_BOX }, ...p.tabs.map(n => ({ role: 'TabItem', name: n, b: [0, 40, 100, 30] }))] }; }; })();
    const r = await FD.ensureFresh(M.d);
    assert.strictEqual(r.ok, false, label + ': ' + JSON.stringify(r)); assert.strictEqual(r.why, 'not-new', label); assert.deepStrictEqual(M.keys, ['cmd+n'], label);
    assert.ok(r.steps.some(s => /KHÔNG gõ/.test(s)), label);
  }
});

// ---- review PR #64 (2): dấu “đã sửa” (*, ●) = tài liệu có nội dung, không phải tài liệu mới ----
test('B191 review (2): “*Untitled - Notepad” (thẻ đã sửa) không phải tài liệu mới trống; Ctrl+N mở thẻ mới rồi mới gõ', async () => {
  assert.strictEqual(FD.dirty('*Untitled - Notepad'), true); assert.strictEqual(FD.dirty('● Untitled-2 - Visual Studio Code'), true); assert.strictEqual(FD.dirty('Untitled - Notepad'), false);
  assert.deepStrictEqual(FD.blankState({ win: { title: '*Untitled - Notepad', proc: 'Notepad.exe' }, elements: [] }), { blank: false, why: 'dirty', title: '*Untitled - Notepad' });
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: '', dirty: true }], valueReadable: false, tabItems: true });
  const r = await FD.ensureFresh(N.d); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.how, 'new'); assert.deepStrictEqual(N.st.keys, ['cmd+n']); assert.strictEqual(N.st.active, 1);
  const N2 = fakeNotepad({ tabs: [{ name: 'Untitled', text: '', dirty: true }], ctrlN: 'nothing', valueReadable: false });
  const r2 = await FD.ensureFresh(N2.d); assert.strictEqual(r2.ok, false); assert.strictEqual(r2.why, 'dirty');
});

// ---- review PR #64 (3): Notepad Win11 chung hwnd cho mọi thẻ → trước mỗi lần gõ kiểm danh tính tài liệu (thẻ + trống), không chắc → không gõ ----
test('B191 review (3): sameDoc — chuyển sang thẻ khác / thẻ “Untitled” khôi phục có nội dung (cùng hwnd) → không gõ', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: SECRET, dirty: true }, { name: 'notes.txt', text: 'x' }], tabItems: true });
  const r = await FD.ensureFresh(N.d); assert.ok(r.ok); const rec = { hwnd: '7', title: r.title, print: r.print, typed: false };
  assert.strictEqual(N.st.active, 2);
  assert.deepStrictEqual(FD.sameDoc(rec, await N.d.look({})), { ok: true }, 'đúng thẻ mới AIVN mở');
  N.type('dòng 1'); rec.typed = true;
  assert.deepStrictEqual(FD.sameDoc(rec, await N.d.look({})), { ok: true }, 'sau khi AIVN gõ: dấu * là của AIVN, vẫn đúng tài liệu');
  N.st.active = 0; // chuyển về thẻ “*Untitled” cũ của người dùng — cùng hwnd, cùng danh sách thẻ
  assert.strictEqual(FD.sameDoc({ ...rec, typed: false }, await N.d.look({})).ok, false, 'chưa gõ: thẻ đã sửa không phải tài liệu mới');
  assert.deepStrictEqual(FD.sameDoc({ ...rec, texts: ['dòng 1'] }, await N.d.look({})), { ok: false, why: 'focus' }, 'đã gõ: thẻ đang chọn (UIA) không phải thẻ mới → thẻ khác');
  assert.deepStrictEqual(FD.sameDoc({ ...rec, print: { ...rec.print, newIdx: null }, texts: ['dòng 1'] }, await N.d.look({})), { ok: false, why: 'content' }, 'không biết vị trí thẻ mới: nội dung thẻ không chứa chữ AIVN đã gõ → thẻ khác');
  N.st.active = 2; assert.deepStrictEqual(FD.sameDoc({ ...rec, texts: ['dòng 1'] }, await N.d.look({})), { ok: true });
  N.st.tabs.push({ name: 'Untitled', text: '' }); N.st.active = 3; // người dùng mở thêm thẻ → danh sách thẻ đổi → không chắc → không gõ
  assert.deepStrictEqual(FD.sameDoc(rec, await N.d.look({})), { ok: false, why: 'tabs' });
  N.st.tabs.pop(); N.st.active = 1; assert.deepStrictEqual(FD.sameDoc(rec, await N.d.look({})), { ok: false, why: 'named' });
  assert.deepStrictEqual(FD.sameDoc(null, await N.d.look({})), { ok: false, why: 'unknown' });
  assert.deepStrictEqual(FD.sameDoc({ ...rec, print: { ...rec.print, hwnd: '9' } }, await N.d.look({})).ok, false);
});

test('B191: Notepad khôi phục thẻ cũ có nội dung → Ctrl+N → kiểm tài liệu mới trống → chỉ gõ vào thẻ mới; thẻ cũ giữ nguyên', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: SECRET }] }); // thẻ chưa lưu được khôi phục: TIÊU ĐỀ vẫn “Untitled” nhưng có nội dung
  const r = await FD.ensureFresh(N.d);
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.how, 'new'); assert.deepStrictEqual(N.st.keys, ['cmd+n']);
  assert.strictEqual(N.st.active, 1); N.type('một dòng mới');
  assert.strictEqual(N.st.tabs[0].text, SECRET, 'thẻ cũ của người dùng không bị gõ vào'); assert.strictEqual(N.st.tabs[1].text, 'một dòng mới');
});

test('B191: thẻ cũ là tệp có tên (secret.txt) → Ctrl+N; tài liệu mới đọc không được giá trị nhưng không thấy chữ → nhận là mới', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'secret.txt', text: SECRET }], valueReadable: false, tabItems: true });
  const r = await FD.ensureFresh(N.d); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.title, 'Untitled - Notepad'); assert.deepStrictEqual(N.st.keys, ['cmd+n']);
  // không thấy danh sách thẻ, cùng hwnd: tiêu đề đổi sang “Untitled” có thể chỉ là chuyển sang một thẻ khác của người dùng → không đủ bằng chứng → dừng
  const N2 = fakeNotepad({ tabs: [{ name: 'secret.txt', text: SECRET }], valueReadable: false });
  const r2 = await FD.ensureFresh(N2.d); assert.strictEqual(r2.ok, false, JSON.stringify(r2)); assert.strictEqual(r2.why, 'not-new');
});

test('B191: đã là tài liệu mới trống → không bấm gì thêm', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: '' }] });
  const r = await FD.ensureFresh(N.d); assert.ok(r.ok); assert.strictEqual(r.how, 'blank'); assert.deepStrictEqual(N.st.keys, []);
});

test('B191: Ctrl+N không mở được tài liệu mới (vẫn ở secret.txt) → thất bại, KHÔNG gõ; OCR được ép ở lần nhìn sau', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'secret.txt', text: SECRET }], ctrlN: 'nothing' });
  const r = await FD.ensureFresh(N.d); assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'named');
  assert.deepStrictEqual(N.st.keys, ['cmd+n'], 'chỉ bấm Ctrl+N một lần'); assert.ok(N.st.looks.includes('force'));
  assert.ok(r.steps.some(s => /KHÔNG gõ/.test(s)), JSON.stringify(r.steps)); assert.strictEqual(N.st.tabs[0].text, SECRET);
});

test('B191: thẻ “Untitled” mà vẫn còn nội dung (OCR thấy chữ trong vùng soạn thảo) → không coi là trống', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: SECRET }], ctrlN: 'nothing', valueReadable: false });
  const r = await FD.ensureFresh(N.d); assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'content');
});

test('B191: hộp thoại hiện ra sau Ctrl+N → bấm Esc, thất bại, không gõ', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'secret.txt', text: SECRET }], ctrlN: 'dialog' });
  const r = await FD.ensureFresh(N.d); assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'dialog'); assert.deepStrictEqual(N.st.keys, ['cmd+n', 'escape']);
});

test('B191: không phải trình soạn thảo (Zalo) → bỏ qua, không bấm phím', async () => {
  const d = { look: async () => ({ win: { title: 'Zalo', proc: 'Zalo.exe' }, elements: [] }), hotkey: async () => { throw new Error('không được bấm'); }, sleep: async () => {} };
  const r = await FD.ensureFresh(d); assert.strictEqual(r.ok, false); assert.strictEqual(r.skip, true);
});

test('B191: desktop-agent nối tài liệu mới vào ensure_app và chặn type_text vào tài liệu khác (mã nguồn)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/desktop-agent.js'), 'utf8');
  assert.match(src, /const FD = require\('\.\/agent\/fresh-doc'\)/);
  const ens = src.slice(src.indexOf('async function ensureApp(a, ctx)'), src.indexOf('async function ensureApp(a, ctx)') + 6000);
  assert.match(ens, /if \(freshDocWanted\(ctx, w\)\) \{\s*fd = await freshDoc\(ctx\);\s*if \(!fd\.ok && !fd\.skip\) return \{ error: FRESH_DOC_MSG, code: 'fresh-doc', stop: true/);
  const inner = src.slice(src.indexOf('async function actInner(a, ctx)'));
  const gate = inner.indexOf("if ((action === 'type_text' || gatedKey) && freshDocWanted(ctx, s.obs && s.obs.win))");
  assert.ok(gate > 0 && gate < inner.indexOf('let needPoint ='), 'cổng B191 phải chạy trước khi chọn chỗ gõ');
  assert.match(inner.slice(gate, gate + 3500), /return \{ refused: true, stop: true, error: FRESH_DOC_MSG/);
  // (3) Notepad Win11 chung hwnd cho mọi thẻ: nhìn lại màn hình và kiểm danh tính tài liệu (cửa sổ + tên + thẻ + thẻ đang chọn + trống) trước MỖI lần gõ — tên chưa đặt nằm trong sameDoc (P64-4)
  assert.match(inner.slice(gate, gate + 3500), /const g = !seen \? \{ ok: false, why: 'observe' \} : !W2 \? \{ ok: false, why: 'no-window' \} : FD\.sameDoc\(fd, s\.obs\);\s*if \(!g\.ok\)/);
  assert.match(inner.slice(gate, gate + 5000), /if \(action === 'type_text' && s\.freshDoc\) \{ s\.freshDoc\.typed = true; \(s\.freshDoc\.texts = s\.freshDoc\.texts \|\| \[\]\)\.push\(String\(a\.text \|\| ''\)\); \}/);
  assert.match(src, /s\.freshDoc = \{ hwnd: [^\n]*print: r\.print \|\| FD\.docPrint\(s\.obs\), typed: false/);
  assert.match(src, /hotkey: async \(keys\) => \{ const h = await act\(\{ action: 'hotkey', keys \}, ctx\)/);
});

// ---- agent.js: ensure_app thất bại vì không mở được tài liệu mới → dừng, không để mô hình gõ; câu cuối theo ngôn ngữ (B182) ----
function mkAgent(ensureOut, lang) {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b191-')); const exec = []; let model = 0;
  const engine = { status: () => ({ loaded: true, vision: true, contextSize: 8192 }), chatStep: async () => { model++; return { text: 'Đã gõ xong.', toolCalls: [], finishReason: 'stop', usage: {} }; } };
  const names = ['open_app', 'screen_look', 'screen_act']; const defs = Object.fromEntries([...names, 'ensure_app'].map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { exec.push([n, a]); if (n === 'ensure_app') return ensureOut; return { forModel: 'ok', summary: 'ok' }; } };
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: false, agentComputer: true, agentScreen: true, uiLang: lang }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, exec, model: () => model };
}
const MSG = 'chưa mở được tài liệu mới trống — AIVN không gõ vào tài liệu đang có của bạn';
const FAIL = { error: MSG, code: 'fresh-doc', stop: true, forModel: MSG, summary: 'Notepad: chưa mở được tài liệu mới trống — không gõ' };
// câu tiếng Việt + giao diện en/zh → trả lời theo giao diện (replyLang). (Câu en/zh không qua ensure_app tự động thì cổng type_text của desktop-agent chặn.)
const Q = 'mở Notepad và gõ một dòng';
for (const lang of ['vi', 'en', 'zh']) {
  test(`B191 [${lang}]: ensure_app không mở được tài liệu mới → dừng trước mô hình, câu cuối theo ngôn ngữ`, async () => {
    const M = mkAgent(FAIL, lang);
    const r = await M.agent.run({ messages: [{ role: 'user', content: Q }], confirm: async () => false });
    assert.deepStrictEqual(M.exec.map(x => x[0]), ['ensure_app']); assert.strictEqual(M.model(), 0, 'mô hình không được chạy (không gõ)');
    assert.strictEqual(r.outcome, 'failed');
    if (lang === 'vi') assert.strictEqual(r.text, `Mình chưa làm được việc này: ${MSG}.`);
    else { assert.ok(!VI.test(r.text), r.text); assert.match(r.text, lang === 'en' ? /^I couldn't do this yet: could not open a new blank document — AIVN does not type into your existing documents/ : /^我还没能完成这件事：未能打开新的空白文档/); }
  });
}

test('B191: chuỗi người dùng thấy có bản en/zh', () => {
  const en = require('../src/i18n/en.js'); const zh = require('../src/i18n/zh.js');
  const keys = [MSG, 'chưa mở được tài liệu mới trống — không gõ', 'không phải tài liệu mới AIVN đã mở — không gõ', '{0}: chưa mở được tài liệu mới trống — không gõ', '{0}: đã mở tài liệu mới trống'];
  const flat = fs.readFileSync(path.join(__dirname, '../src/i18n/strings-agent.json'), 'utf8');
  for (const k of keys) { assert.ok(flat.includes(JSON.stringify(k).slice(1, -1)), 'strings-agent.json thiếu ' + k);
    for (const [n, d] of [['en', en], ['zh', zh]]) assert.ok(typeof d[k] === 'string' && d[k] && !VI.test(d[k]), `${n} thiếu ${k}`); }
});

// ================= QA PR #64 v3 (REPORT.md): P64-2, 3a, 3b, 4, 5, 7, 8, 9 =================
// màn hình giả dựng tay: Notepad Win11 (một hwnd cho mọi thẻ); sel = thẻ đang chọn theo UIA (undefined = UIA không cho biết)
function npObs(tabs, active, { sel = true, value = null, title } = {}) {
  const t = tabs[active];
  const els = [{ role: 'Document', kind: 'edit', name: 'Text editor', editable: true, value, b: NOTEPAD_BOX }];
  tabs.forEach((x, i) => els.push({ role: 'TabItem', kind: 'tab', name: (x.dirty ? '*' : '') + x.name, b: [10 + 130 * i, 40, 120, 30], ...(sel ? { selected: i === active } : {}) }));
  return { win: { title: title || `${t.dirty ? '*' : ''}${t.name} - Notepad`, proc: 'Notepad.exe', pid: 42, hwnd: 7 }, elements: els, dialog: null };
}

test('QA #64 v3 P64-2: nhận việc gõ trong trình soạn thảo cả khi không có “mở”, có chữ “hiện tại/current/cũ/end of/node.js/enter/paste/dán”, không dấu, chữ phồn thể', () => {
  for (const q of ['viết vào Notepad dòng xin chào', 'type hello in Notepad', '在记事本里输入你好', 'mở Notepad và gõ ngày giờ hiện tại', 'open Notepad and type the current date',
    'mở Notepad và gõ lời chúc cho bạn cũ', 'open Notepad and write an end of day summary', 'mở Notepad và viết hướng dẫn cài node.js', 'open Notepad and enter the text hello',
    'open Notepad and paste this: hello', 'mở Notepad và dán đoạn này: xin chào', 'mo notepad va go xin chao', '打開記事本並輸入一行字', 'gõ "xin chào"', 'type hello world'])
    assert.strictEqual(FD.freshDocTask(q), true, q);
  // vẫn KHÔNG nhận khi người dùng nói rõ tài liệu/tệp có sẵn hoặc không có việc gõ
  for (const q of ['mở Notepad', 'mở Word và đăng nhập', 'gõ vào tài liệu đang mở', 'gõ tiếp vào tài liệu hiện tại', 'type into the current document', 'append a line to the existing file',
    'continue typing in Notepad', '在当前文档末尾输入一行', '在現有文件末尾輸入一行', 'mở ghichu.txt và gõ abc', '在D:\\AIVN-QA\\pr64\\named.txt里输入X', 'open D:\\src\\app.js and type a comment',
    'what type of file is this', 'press enter', 'mo ghichu.txt va go abc']) assert.strictEqual(FD.freshDocTask(q), false, q);
});

test('QA #64 v3 P64-3a: chưa gõ, không đọc được nội dung, thẻ đang chọn đã đổi sang thẻ “Untitled” CŨ → không gõ (focus / unsure)', () => {
  const tabs = [{ name: 'Untitled', text: SECRET }, { name: 'Untitled', text: '' }];
  const rec = { hwnd: '7', title: 'Untitled - Notepad', print: { ...FD.docPrint(npObs(tabs, 1)), newIdx: 1 }, typed: false };
  assert.strictEqual(rec.print.sel, 1);
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 1)), { ok: true }, 'đúng thẻ mới (UIA chọn thẻ 1)');
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 0)), { ok: false, why: 'focus' }, 'UIA: đang chọn thẻ cũ');
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 0, { sel: false })), { ok: false, why: 'unsure' }, 'UIA không cho biết thẻ đang chọn + không đọc được nội dung → không chắc → không gõ');
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 0, { sel: false, value: '' })), { ok: true }, 'đọc được: trống thật thì gõ được');
});

test('QA #64 v3 P64-3b: đã gõ, không đọc được nội dung, thẻ đang chọn không chứng minh được → không gõ tiếp', () => {
  const tabs = [{ name: 'Untitled', text: SECRET }, { name: 'Untitled', text: 'dòng 1', dirty: true }];
  const rec = { hwnd: '7', title: 'Untitled - Notepad', print: { hwnd: '7', title: 'Untitled - Notepad', tabs: ['Untitled', 'Untitled'], newIdx: 1 }, typed: true, texts: ['dòng 1'] };
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 1)), { ok: true }, 'UIA chọn đúng thẻ mới');
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 0)), { ok: false, why: 'focus' });
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 0, { sel: false })), { ok: false, why: 'unsure' }, 'trước đây: unread → OK (sai)');
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 1, { sel: false })), { ok: false, why: 'unsure' }, 'cả khi đúng thẻ nhưng không chứng minh được → dừng (fail closed)');
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 1, { sel: false, value: 'dòng 1' })), { ok: false, why: 'unsure' }, 'review #64 vòng 5 M2: có chứa chữ đã gõ nhưng không biết thẻ đang chọn → không chắc → dừng');
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 1, { value: 'dòng 1' })), { ok: true }, 'biết thẻ đang chọn + chứa chữ đã gõ → gõ tiếp');
  assert.deepStrictEqual(FD.sameDoc(rec, npObs(tabs, 1, { value: 'khác' })), { ok: false, why: 'content' }, 'nội dung không khớp → dừng');
  // Word: mỗi tài liệu một cửa sổ → cùng hwnd là bằng chứng đủ
  const wobs = (title, hwnd) => ({ win: { title, proc: 'WINWORD.EXE', pid: 9, hwnd }, elements: [{ role: 'Document', kind: 'edit', name: 'Page 1', editable: true, value: null, b: NOTEPAD_BOX }], dialog: null });
  const wrec = { hwnd: '30', title: 'Document1 - Word', print: { ...FD.docPrint(wobs('Document1 - Word', 30)), newIdx: null }, typed: true, texts: ['x'] };
  assert.deepStrictEqual(FD.sameDoc(wrec, wobs('Document1 - Word', 30)), { ok: true });
  assert.deepStrictEqual(FD.sameDoc(wrec, wobs('Document2 - Word', 31)), { ok: false, why: 'window' });
});

test('QA #64 v3 P64-4: VS Code đổi tên tài liệu chưa lưu theo dòng đầu AIVN đã gõ → vẫn là tài liệu của AIVN; tên tệp thật → dừng', () => {
  const vs = (title, tab, value) => ({ win: { title, proc: 'Code.exe', pid: 5, hwnd: 50 }, elements: [{ role: 'Edit', kind: 'edit', name: 'editor', editable: true, value, b: NOTEPAD_BOX }, { role: 'TabItem', kind: 'tab', name: tab, b: [0, 30, 100, 20], selected: true }], dialog: null });
  const rec = { hwnd: '50', title: 'Untitled-1 - Visual Studio Code', print: { ...FD.docPrint(vs('Untitled-1 - Visual Studio Code', 'Untitled-1', '')), newIdx: 0 }, typed: true, texts: ['xin chào\n'] };
  const now = vs('● xin chào - Visual Studio Code', 'xin chào', 'xin chào\n');
  assert.strictEqual(FD.ownTitle(rec, now.win), true);
  assert.deepStrictEqual(FD.sameDoc(rec, now), { ok: true }, 'trước đây: “named” → từ chối nhầm');
  assert.deepStrictEqual(FD.sameDoc({ ...rec, typed: false }, now), { ok: false, why: 'named' }, 'chưa gõ thì không có tên “của AIVN”');
  assert.deepStrictEqual(FD.sameDoc(rec, vs('notes.md - Visual Studio Code', 'notes.md', 'xin chào\n')), { ok: false, why: 'named' }, 'tệp có tên khác dòng đã gõ');
  assert.strictEqual(FD.ownTitle(rec, { title: 'xin chào - Notepad', proc: 'Notepad.exe' }), false, 'chỉ VS Code tự đặt tên theo dòng đầu');
  assert.strictEqual(FD.untitled('xin chào - Visual Studio Code'), false, 'tên không tự coi là chưa đặt — chỉ khớp theo chữ AIVN đã gõ');
});

test('QA #64 v3 P64-5: Word “Document - Word” (không số) có thể là tệp Document.docx → không coi là chưa đặt tên', () => {
  for (const t of ['Document - Word', 'Tài liệu - Word', '文档 - Word', 'Document.docx - Word', 'Document - Notepad']) assert.strictEqual(FD.untitled(t), false, t);
  assert.strictEqual(FD.untitled('Document - WordPad'), true, 'WordPad hiện cả đuôi tệp: “Document” là tài liệu mới');
  for (const t of ['Document1 - Word', 'Document 3 - Word', 'Tài liệu1 - Word', '文档1 - Word']) assert.strictEqual(FD.untitled(t), true, t);
});

test('QA #64 v3 P64-9: tiêu đề còn dấu sửa (*Untitled / ● Untitled) không bao giờ là tài liệu mới trống — cả khi có thêm thẻ', async () => {
  const E = FD.newDocEvidence;
  assert.strictEqual(E(P(['notes.txt']), P(['notes.txt', 'Untitled'], '*Untitled - Notepad')), false);
  assert.strictEqual(E(P(['notes.txt']), { ...P(['notes.txt', 'Untitled'], '● Untitled-1 - Visual Studio Code'), sel: 1 }), false);
  assert.strictEqual(E(P(['notes.txt']), P(['notes.txt', 'Untitled'])), true, 'đối chứng: tiêu đề sạch, một thẻ mới đúng tên');
  // Ctrl+N mở thẻ mới ở NỀN, đang chọn vẫn là thẻ “*Untitled” cũ của người dùng → DỪNG, không gõ
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: SECRET, dirty: true }], ctrlN: 'bg', valueReadable: false, tabItems: true });
  const r = await FD.ensureFresh(N.d); assert.strictEqual(r.ok, false, JSON.stringify(r)); assert.strictEqual(N.st.tabs.length, 2); assert.strictEqual(N.st.active, 0);
});

// ---- review #64 vòng 4: chạy THẬT act() của desktop-agent trên Notepad GIẢ (test/fixtures/b191-desk.js) — kiểm HÀNH VI, không đọc mã nguồn ----
const DK = require('./fixtures/b191-desk');
const FRESH_GATE = 'không phải tài liệu mới AIVN đã mở — không gõ';
const T = (text, extra = {}) => ({ action: 'type_text', text, ...extra });
const HK = (keys) => ({ action: 'hotkey', keys });
const stopped = (r, msg = FRESH_GATE) => { assert.ok(r && r.refused === true && r.stop === true, JSON.stringify(r).slice(0, 300)); assert.strictEqual(r.error, msg); };

test('QA #64 v3 P64-7 (hành vi): nhìn lại màn hình LỖI ở cổng trước khi gõ → DỪNG, không dán, thẻ cũ nguyên vẹn', async () => {
  for (const fail of ['capture', 'tree']) {
    const w = DK.notepad(); const ag = DK.make(w);
    const out = await DK.run(ag, 'gõ hello vào Notepad', [T('hello'), (w) => { if (fail === 'capture') w.st.captureFails = 5; else w.treeThrow = true; }, T('PWNED')]);
    assert.ok(!out[0].refused, JSON.stringify(out[0]).slice(0, 200)); stopped(out[1]);
    assert.strictEqual(DK.pastes(), 1, `${fail}: chỉ dán lần đầu`); assert.ok(!w.oldTouched(), fail); assert.strictEqual(w.st.tabs[1].text, 'hello', fail);
  }
});

test('QA #64 v3 P64-8 (hành vi) + review vòng 4 (2): cổng chặn = refused + stop + câu FRESH_GATE; phím chèn chữ phải qua cổng, chỉ phím trong DANH SÁCH CHO PHÉP được bỏ qua', async () => {
  // E21: chưa mở tài liệu mới → mọi phím ngoài danh sách cho phép bị chặn, không phím nào tới bàn phím
  const gated = ['ctrl+v', 'Ctrl + V', 'cmd+v', 'shift+insert', 'enter', 'tab', 'ctrl+h', 'ctrl+shift+v', 'ctrl+a', 'Control + A', 'delete', 'backspace', 'ctrl+z', 'x', 'ctrl+enter'];
  for (const k of gated) {
    const w = DK.notepad(); const ag = DK.make(w);
    const [r] = await DK.run(ag, 'gõ hello vào Notepad', [HK(k)]);
    stopped(r); assert.strictEqual(DK.performed.filter(p => p.action === 'key').length, 0, k); assert.ok(!w.oldTouched(), k);
  }
  // danh sách cho phép: không qua cổng (bấm thật)
  for (const k of ['escape', 'esc', 'ctrl+n', 'cmd+n', 'ctrl+s', 'cmd+s', 'down', 'left', 'alt+tab']) {
    const w = DK.notepad(); const ag = DK.make(w);
    const [r] = await DK.run(ag, 'gõ hello vào Notepad', [HK(k)]);
    assert.ok(!(r && r.refused), `${k}: ${JSON.stringify(r).slice(0, 200)}`); assert.ok(DK.performed.some(p => p.action === 'key'), k);
  }
});

test('review #64 vòng 4 E20: sau khi gõ vào tài liệu mới, tiêu điểm về thẻ cũ → Ctrl+V / Shift+Insert / Enter bị chặn, thẻ cũ nguyên vẹn', async () => {
  for (const k of ['ctrl+v', 'shift+insert', 'enter']) {
    const w = DK.notepad(); const ag = DK.make(w);
    const out = await DK.run(ag, 'gõ hello vào Notepad', [T('hello'), (w) => { w.st.active = 0; }, HK(k)]);
    stopped(out[1]); assert.strictEqual(DK.pastes(), 1, k); assert.ok(!w.oldTouched(), k);
  }
});

test('review #64 vòng 4 E18: type_text kèm x,y / element trỏ vào THẺ CŨ → không bấm thẻ cũ, chỉ gõ vào tài liệu mới', async () => {
  for (const extra of [{ x: 70, y: 42 }, { element: 'secret.txt' }, { target: 'secret.txt' }]) {
    const w = DK.notepad(); const ag = DK.make(w);
    const out = await DK.run(ag, 'gõ hello vào Notepad', [T('hello'), T('PWNED', extra)]);
    assert.ok(!w.oldTouched(), JSON.stringify(extra)); assert.strictEqual(w.st.active, 1, 'không chuyển sang thẻ cũ');
    assert.ok(!DK.performed.some(p => p.action === 'click'), 'không có cú bấm chuột'); assert.ok(!out[1].refused, JSON.stringify(out[1]).slice(0, 200));
    assert.strictEqual(w.st.tabs[1].text, 'helloPWNED');
  }
  // E18c: lần gõ ĐẦU (chưa có tài liệu mới) kèm toạ độ thẻ cũ
  const w = DK.notepad(); const ag = DK.make(w);
  await DK.run(ag, 'gõ hello vào Notepad', [T('PWNED', { x: 70, y: 42 })]);
  assert.ok(!w.oldTouched()); assert.strictEqual(w.st.tabs[1].text, 'PWNED');
});

test('review #64 vòng 4 E18 (kiểm lại): thẻ xin phép mở lâu, người dùng bấm sang thẻ cũ → kiểm lại NGAY TRƯỚC khi dán → DỪNG', async () => {
  let arm = false; const now0 = Date.now;
  const w = DK.notepad(); const ag = DK.make(w, {}, (req, w) => { if (arm) { Date.now = () => now0() + 2500; w.st.active = 0; } return { ok: true }; });
  try {
    const out = await DK.run(ag, 'gõ hello vào Notepad', [T('hello'), () => { arm = true; }, T('PWNED')]);
    stopped(out[1]); assert.strictEqual(DK.pastes(), 1); assert.ok(!w.oldTouched()); assert.strictEqual(w.st.tabs[1].text, 'hello');
    assert.ok(DK.logs.some(l => /B191: chặn ngay trước khi dán/.test(l)), DK.logs.join('\n'));
  } finally { Date.now = now0; }
});

test('review #64 vòng 4 E24/E25: NỘI DUNG cần gõ không tắt bảo vệ (“gõ: Đừng xoá tệp này”, “type: see readme.txt”)', async () => {
  for (const q of ['mở Notepad và gõ: Đừng xoá tệp này nhé', 'open Notepad and type: see readme.txt for details', 'mở Notepad và gõ "báo cáo.docx đã gửi"', 'open Notepad and write "append the logs at the end of the day"',
    'mở Notepad và gõ：tệp này quan trọng', '打开记事本并输入：请看 readme.txt', 'open Notepad and type “existing file notes.txt”'])
    assert.strictEqual(FD.freshDocTask(q), true, q);
  for (const q of ['mở notes.txt và gõ abc', 'open C:\\notes\\a.txt and type hi', 'open the existing document and type: hi', "mở tệp báo cáo và viết: xong", 'mở Notepad và gõ tiếp vào cuối: abc'])
    assert.strictEqual(FD.freshDocTask(q), false, q);
  assert.strictEqual(FD.commandPart("open Notepad and type don't stop"), "open Notepad and type don't stop", 'dấu nháy trong từ không phải ngoặc');
  for (const [q, text] of [['mở Notepad và gõ: Đừng xoá tệp này nhé', 'Đừng xoá tệp này nhé'], ['open Notepad and type: see readme.txt for details', 'see readme.txt for details']]) {
    const w = DK.notepad({ tabs: [{ name: 'Untitled', text: 'KHOI-SECRET', dirty: true }], valueReadable: false }); const ag = DK.make(w);
    await DK.run(ag, q, [T(text)]);
    assert.ok(!w.oldTouched(), q); assert.strictEqual(w.st.tabs.length, 2, q); assert.strictEqual(w.st.tabs[1].text, text, q);
  }
});

test('review #64 vòng 4 (nên sửa): tên VS Code bản địa, ownTitle ≥ 3 ký tự, OCR lỗi → không chắc (không gõ)', async () => {
  for (const t of ['无标题-1 - Visual Studio Code', '未命名-1 - Visual Studio Code', 'Không có tiêu đề-1 - Visual Studio Code', '● 无标题-2 - Visual Studio Code', 'Untitled-1 - Visual Studio Code'])
    assert.strictEqual(FD.untitled(t), true, t);
  const vsw = (title) => ({ title, proc: 'Code.exe', pid: 5, hwnd: 50 });
  assert.strictEqual(FD.ownTitle({ typed: true, texts: ['ab cd'] }, vsw('ab - Visual Studio Code')), false, 'nhãn 2 ký tự');
  assert.strictEqual(FD.ownTitle({ typed: true, texts: ['a'] }, vsw('a - Visual Studio Code')), false, 'nhãn 1 ký tự');
  assert.strictEqual(FD.ownTitle({ typed: true, texts: ['abc def'] }, vsw('abc - Visual Studio Code')), true, 'đủ 3 ký tự');
  // OCR lỗi: blankState / sameDoc / ensureFresh không coi là “trống”
  const obs = { win: { title: 'Untitled - Notepad', proc: 'Notepad.exe', pid: 1, hwnd: 7 }, elements: [{ role: 'Document', kind: 'edit', name: 'Text editor', editable: true, value: null, b: NOTEPAD_BOX }], dialog: null, ocrFailed: true };
  assert.strictEqual(FD.blankState(obs).why, 'ocr-failed'); assert.strictEqual(FD.blankState(obs).blank, null);
  const rec = { hwnd: '7', title: 'Untitled - Notepad', print: { ...FD.docPrint(obs), newIdx: null }, typed: false, texts: [] };
  assert.deepStrictEqual(FD.sameDoc(rec, obs), { ok: false, why: 'unsure' });
  // e2e: OCR hỏng, không đọc được giá trị → không mở được tài liệu mới chắc chắn → DỪNG, không dán
  const w = DK.notepad({ valueReadable: false }); w.ocrThrow = true; const ag = DK.make(w);
  const [r] = await DK.run(ag, 'gõ hello vào Notepad', [T('hello')]);
  assert.ok(r && r.refused && r.stop, JSON.stringify(r).slice(0, 300)); assert.strictEqual(DK.pastes(), 0); assert.ok(!w.oldTouched());
});
const GATE = FRESH_GATE;
for (const lang of ['vi', 'en', 'zh']) {
  test(`QA #64 v3 P64-8 [${lang}]: screen_act bị cổng chặn (refused + stop) → dừng, kết quả thất bại, câu cuối theo ngôn ngữ`, async () => {
    const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
    const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b191-')); const exec = []; let model = 0;
    const engine = { status: () => ({ loaded: true, vision: true, contextSize: 8192 }), chatStep: async () => { model++; return model === 1 ? { text: '', toolCalls: [{ id: 'c1', name: 'screen_act', arguments: { action: 'type_text', text: 'hello' } }], finishReason: 'tool_calls', usage: {} } : { text: 'Đã gõ xong.', toolCalls: [], finishReason: 'stop', usage: {} }; } };
    const names = ['screen_look', 'screen_act']; const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
    const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { exec.push([n, a]); if (n === 'screen_act') return { refused: true, stop: true, error: GATE, forModel: 'KHÔNG gõ', summary: GATE }; return { forModel: 'ok', summary: 'ok' }; } };
    const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: false, agentComputer: true, agentScreen: true, uiLang: lang }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
    const r = await agent.run({ messages: [{ role: 'user', content: lang === 'zh' ? '在记事本里输入 hello' : lang === 'en' ? 'type hello in Notepad' : 'gõ hello vào Notepad' }], confirm: async () => true });
    assert.strictEqual(exec.filter(x => x[0] === 'screen_act').length, 1, 'không thử gõ lại'); assert.strictEqual(model, 1, 'mô hình không chạy tiếp sau khi bị chặn');
    assert.strictEqual(r.outcome, 'failed');
    if (lang === 'vi') assert.match(r.text, /không phải tài liệu mới AIVN đã mở — không gõ/);
    else { assert.ok(!VI.test(r.text), r.text); assert.match(r.text, lang === 'en' ? /not the new document AIVN opened — nothing typed/ : /不是 AIVN 打开的新文档 — 未输入任何内容/); }
  });
}

// ── review #64 vòng 5 ──
const OLD_DIRTY = () => DK.notepad({ tabs: [{ name: 'Untitled', text: 'KHOI-SECRET', dirty: true }], valueReadable: false });
const LEAKS = [
  ['xuống dòng', 'mở Notepad và gõ\nĐừng xoá tệp này', 'Đừng xoá tệp này'],
  ['xuống dòng en', 'mở Notepad và gõ dòng sau\nappend this file to the report', 'append this file to the report'],
  ["don't trong nháy đơn", "open Notepad and type 'don't delete this file'", "don't delete this file"],
  ["don't không nháy", "type don't delete this file in Notepad", "don't delete this file"],
  ['URL có tên tệp', 'open Notepad and type http://x.com/readme.txt', 'http://x.com/readme.txt'],
  ['URL .md', 'mở Notepad và gõ link https://github.com/a/b/blob/main/README.md', 'https://github.com/a/b/blob/main/README.md'],
  ['đường dẫn', 'mở Notepad và gõ đường dẫn C:\\Users\\khoi\\notes.txt', 'C:\\Users\\khoi\\notes.txt'],
  ['ngoặc ()', 'mở Notepad và gõ (tệp này là của tôi)', '(tệp này là của tôi)'],
  ['backtick', 'open Notepad and type `this file`', '`this file`'],
  ['<<…>>', 'open Notepad and type <<this file is mine>>', '<<this file is mine>>'],
  ['﹕ U+FE55', 'mở Notepad và gõ﹕ Đừng xoá tệp này', 'Đừng xoá tệp này'],
  ['∶ U+2236', 'mở Notepad và gõ∶ Đừng xoá tệp này', 'Đừng xoá tệp này'],
  ['không ngoặc', 'mở Notepad và gõ tệp này là của tôi', 'tệp này là của tôi'],
];
test('review #64 vòng 5 M1: nội dung (xuống dòng, don\'t, URL/đường dẫn, (), `…`, <<…>>, ﹕, ∶) KHÔNG tắt bảo vệ — hành vi: thẻ cũ nguyên, chữ vào thẻ mới', async () => {
  for (const [name, q, text] of LEAKS) {
    assert.strictEqual(FD.freshDocTask(q), true, name);
    const w = OLD_DIRTY(); const ag = DK.make(w);
    await DK.run(ag, q, [T(text)]);
    assert.ok(!w.oldTouched(), name); assert.strictEqual(w.st.tabs.length, 2, name); assert.strictEqual(w.st.tabs[1].text, text, name);
  }
});

test('review #64 vòng 5 M1 (E26): thêm/chèn/add/put/không dấu cũng là việc ghi → bảo vệ bật — hành vi', async () => {
  for (const [q, text] of [['add a line "buy milk" in Notepad', 'buy milk'], ['put hello into Notepad', 'hello'], ['thêm dòng mua sữa vào Notepad', 'mua sữa'],
    ['chèn chữ xin chào vào Notepad', 'xin chào'], ['mo notepad, go hello world', 'hello world'], ['mo notepad va them dong mua sua', 'mua sua'], ['note down my todo in Notepad', 'todo'], ['在记事本里添加一行', '你好']]) {
    assert.strictEqual(FD.freshDocTask(q), true, q);
    const w = OLD_DIRTY(); const ag = DK.make(w);
    await DK.run(ag, q, [T(text)]);
    assert.ok(!w.oldTouched(), q); assert.strictEqual(w.st.tabs[1].text, text, q);
  }
});

test('review #64 vòng 5 M1: ngoại lệ hẹp — chỉ khi phần LỆNH (dòng đầu, trước động từ ghi) nói rõ tệp/tài liệu có sẵn', async () => {
  for (const q of ['mở notes.txt trong Notepad và thêm dòng', 'gõ vào tài liệu đang mở', 'mở Notepad và gõ tiếp vào cuối: abc', 'open C:\\work\\notes.txt and type hello',
    'gõ tiếp vào tài liệu đang mở: xin chào', 'continue typing in Notepad', 'type hi into notes.txt', 'gõ X vào D:\\AIVN-QA\\named.txt', 'type into the current document: hi', '在当前文档末尾输入一行', 'mở Word và đăng nhập', 'mở Notepad'])
    assert.strictEqual(FD.freshDocTask(q), false, q);
  // tên tệp trong ngoặc / URL / sau động từ không tính (fail closed: mở tài liệu mới)
  for (const q of ['open "notes.txt" and type hi', 'open https://x.com/a.txt in Notepad and type hi', 'gõ "x" vào notes.txt', 'gõ abc rồi lưu vào a.txt', 'type the link into http://x.com/a.txt', 'mở Notepad và gõ tiếp theo nội dung: tệp này'])
    assert.strictEqual(FD.freshDocTask(q), true, q);
  // hành vi: ngoại lệ thật → gõ vào tài liệu đang mở (không Ctrl+N)
  const w = DK.notepad({ tabs: [{ name: 'notes.txt', text: 'a' }] }); const ag = DK.make(w);
  await DK.run(ag, 'mở notes.txt trong Notepad và thêm dòng', [T('b')]);
  assert.strictEqual(w.st.tabs.length, 1); assert.strictEqual(w.st.tabs[0].text, 'ab');
});

test('review #64 vòng 5 M2 (probe C1): không biết thẻ đang chọn, thẻ *Untitled cũ cũng chứa "hello", tiêu điểm về đó → dòng 2 DỪNG, thẻ cũ nguyên', async () => {
  const w = DK.notepad({ tabs: [{ name: 'Untitled', text: 'hello', dirty: true }], selMode: 'missing' }); const ag = DK.make(w);
  const out = await DK.run(ag, 'mở Notepad và gõ hello', [T('hello'), (w) => { w.st.active = 0; }, T('line2')]);
  assert.strictEqual(w.st.tabs[1].text, 'hello', 'dòng 1 vào thẻ mới');
  assert.ok(!w.oldTouched(), 'thẻ cũ nguyên: ' + JSON.stringify(w.st.tabs));
  assert.ok(out[1].refused && out[1].stop, JSON.stringify(out[1]).slice(0, 200));
  // đúng thẻ mới nhưng vẫn không chứng minh được → cũng dừng (fail closed)
  const w2 = DK.notepad({ tabs: [{ name: 'Untitled', text: 'hello', dirty: true }], selMode: 'missing' }); const ag2 = DK.make(w2);
  const out2 = await DK.run(ag2, 'mở Notepad và gõ hello', [T('hello'), T('line2')]);
  assert.ok(!w2.oldTouched()); assert.strictEqual(w2.st.tabs[1].text, 'hello'); assert.ok(out2[1].refused && out2[1].stop);
});

// ── review #64 vòng 6 ──
test('review #64 vòng 6 M1′ (X1/X2/X3) + X4: nội dung ở dòng đầu, “tiếp tục” → bảo vệ bật — hành vi: thẻ cũ nguyên, chữ vào thẻ mới', async () => {
  for (const [name, q, text] of [
    ['X1', 'Đừng xoá tệp này\nmở Notepad và gõ dòng trên', 'Đừng xoá tệp này'],
    ['X2', 'Meeting notes from the current file\nopen Notepad and type the above', 'Meeting notes from the current file'],
    ['X3 (nhiều dòng có động từ ghi)', 'Hãy thêm sữa vào notes.txt\n(mở notepad gõ dòng trên)', 'Hãy thêm sữa vào notes.txt'],
    ['X3b', 'Đừng gõ vào tài liệu đang mở\nmở Notepad và gõ dòng trên', 'Đừng gõ vào tài liệu đang mở'],
    ['X4', 'mở Notepad gõ tiếp tục cố gắng', 'tiếp tục cố gắng'],
    ['X4b', 'mở Notepad và gõ tiếp theo là phần kết', 'tiếp theo là phần kết'],
    ['động từ chỉ trong nội dung', 'Meeting notes from the current file: type it', 'Meeting notes from the current file']]) {
    assert.strictEqual(FD.freshDocTask(q), true, name);
    const w = OLD_DIRTY(); const ag = DK.make(w);
    await DK.run(ag, q, [T(text)]);
    assert.ok(!w.oldTouched(), name); assert.strictEqual(w.st.tabs.length, 2, name); assert.strictEqual(w.st.tabs[1].text, text, name);
  }
  // câu lệnh thật vẫn giữ ngoại lệ
  for (const q of ['xin chào\n\ngõ vào tài liệu đang mở', 'gõ tiếp', 'mở Notepad và gõ tiếp vào cuối']) assert.strictEqual(FD.freshDocTask(q), false, q);
});

test('review #64 vòng 6 M1′ cùng dòng: nội dung trước dấu câu/phẩy không tắt bảo vệ — hành vi: thẻ cũ nguyên, chữ vào thẻ mới', async () => {
  for (const [name, q, text] of [
    ['chấm', 'Đừng xoá tệp này. Mở Notepad và gõ dòng trên', 'Đừng xoá tệp này'],
    ['chấm en', 'Meeting notes from the current file. Open Notepad and type the above.', 'Meeting notes from the current file'],
    ['phẩy', 'Đừng xoá tệp này, mở Notepad và gõ dòng trên', 'Đừng xoá tệp này'],
    ['phẩy en', 'Meeting notes from the current file, open Notepad and type the above', 'Meeting notes from the current file'],
    ['chấm phẩy', 'Đừng xoá tệp này; mở Notepad và gõ dòng trên', 'Đừng xoá tệp này'],
    ['chấm than', 'Đừng xoá tệp này! Mở Notepad và gõ', 'Đừng xoá tệp này'],
    ['readme', 'See readme.txt. Open Notepad and type the above.', 'See readme.txt'],
    ['đường dẫn', 'Đường dẫn C:\\Users\\khoi\\notes.txt, mở Notepad và gõ', 'C:\\Users\\khoi\\notes.txt'],
    ['U+2028', 'Đừng xoá tệp này\u2028mở Notepad và gõ dòng trên', 'Đừng xoá tệp này'],
    ['chấm Trung', '当前文件的内容。打开记事本并输入上面的', '当前文件的内容'],
    ['đừng gõ', 'Đừng gõ vào tệp này. Mở Notepad và gõ dòng trên', 'Đừng gõ vào tệp này'],
  ]) {
    assert.strictEqual(FD.freshDocTask(q), true, name);
    assert.strictEqual(FD.namedTarget(q), null, name);
    const w = OLD_DIRTY(); const ag = DK.make(w);
    await DK.run(ag, q, [T(text)]);
    assert.ok(!w.oldTouched(), name); assert.strictEqual(w.st.tabs.length, 2, name); assert.strictEqual(w.st.tabs[1].text, text, name);
  }
  // lệnh mở tệp / tài liệu đang mở vẫn là ngoại lệ (kể cả khi cách động từ bằng phẩy)
  for (const q of ['mở notes.txt, gõ abc', 'open C:\\notes\\a.txt, type hi', 'open the existing document, type hi', 'mở notes.txt và gõ abc', 'gõ vào tài liệu đang mở, rồi viết thêm', 'type 3.14 into notes.txt', 'e.g. type into the current document'])
    assert.strictEqual(FD.freshDocTask(q), false, q);
  assert.strictEqual(FD.namedTarget('type 3.14 into notes.txt'), 'notes.txt');
  assert.strictEqual(FD.namedTarget('open C:\\notes\\a.txt, type hi'), null);
  assert.strictEqual(FD.freshDocTask('mở Notepad, gõ "abc" rồi lưu thành ghichu.txt'), true);
});

test('review #64 vòng 6 X6/X7: “gõ X vào <tệp>” chỉ bỏ bảo vệ khi tài liệu đang hiện ĐÚNG là tệp đó — hành vi', async () => {
  for (const [name, q, text] of [['X7', 'mở Notepad và gõ hello vào Untitled.txt', 'hello'], ['X6', 'open Notepad and type a reminder into notes.txt\nbuy milk', 'buy milk']]) {
    const w = OLD_DIRTY(); const ag = DK.make(w);
    await DK.run(ag, q, [T(text)]);
    assert.ok(!w.oldTouched(), name + ': thẻ *Untitled cũ không bị gõ'); assert.strictEqual(w.st.tabs.length, 2, name); assert.strictEqual(w.st.tabs[1].text, text, name);
  }
  // đúng tệp đã nêu đang mở → gõ vào đó (không Ctrl+N)
  for (const [q, name] of [['open Notepad and type a reminder into notes.txt\nbuy milk', 'notes.txt'], ['mở Notepad và gõ hello vào Untitled.txt', 'Untitled.txt'], ['gõ X vào D:\\AIVN-QA\\Named.TXT', 'named.txt']]) {
    const w = DK.notepad({ tabs: [{ name, text: 'a' }] }); const ag = DK.make(w);
    await DK.run(ag, q, [T('b')]);
    assert.strictEqual(w.st.tabs.length, 1, q); assert.strictEqual(w.st.tabs[0].text, 'ab', q);
  }
  // ngoại lệ 2 chỉ khi dòng lệnh KẾT THÚC bằng vào/into + tên tệp có đuôi văn bản
  for (const q of ['type X into readme.md in a new Notepad window', 'gõ X vào notes.txt trong thẻ mới', 'type hi into Notepad', 'gõ hello vào Notepad', 'gõ hello vào app.exe']) {
    assert.strictEqual(FD.freshDocTask(q), true, q); assert.strictEqual(FD.namedTarget(q), null, q);
  }
  assert.strictEqual(FD.sameFile('notes.txt', '*notes.txt - Notepad'), true);
  assert.strictEqual(FD.sameFile('Untitled.txt', '*Untitled - Notepad'), false);
});
