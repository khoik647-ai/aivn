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
function fakeNotepad({ tabs, active = 0, ctrlN = 'tab', valueReadable = true } = {}) {
  const st = { tabs: tabs.map(t => ({ ...t })), active, keys: [], typed: [], looks: [] };
  const win = () => ({ title: `${st.tabs[st.active].name} - Notepad`, proc: 'Notepad.exe', pid: 42, hwnd: 7 });
  const look = async ({ ocr }) => {
    st.looks.push(ocr); const t = st.tabs[st.active];
    if (st.dialog) return { win: win(), elements: [], dialog: st.dialog };
    const els = [{ role: 'Document', kind: 'edit', name: 'Text editor', editable: true, value: valueReadable ? t.text : null, b: NOTEPAD_BOX },
      { role: 'Edit', kind: 'edit', name: 'Find', editable: true, value: '', b: [700, 10, 200, 24] }];
    if (!valueReadable && t.text) els.push({ ocr: true, name: t.text.split('\n')[0], b: [10, 90, 300, 20] });
    return { win: win(), elements: els, dialog: null };
  };
  const hotkey = async (k) => { st.keys.push(k);
    if (k === 'cmd+n') { if (ctrlN === 'tab') { st.tabs.push({ name: 'Untitled', text: '' }); st.active = st.tabs.length - 1; } else if (ctrlN === 'dialog') st.dialog = 'Notepad'; }
    if (k === 'escape') st.dialog = null; };
  const type = (s) => { st.typed.push([st.tabs[st.active].name, s]); st.tabs[st.active].text += s; };
  return { st, d: { look, hotkey, sleep: async () => {}, log: () => {} }, type };
}
const SECRET = 'mật khẩu ngân hàng: ********';

test('B191: Notepad khôi phục thẻ cũ có nội dung → Ctrl+N → kiểm tài liệu mới trống → chỉ gõ vào thẻ mới; thẻ cũ giữ nguyên', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'Untitled', text: SECRET }] }); // thẻ chưa lưu được khôi phục: TIÊU ĐỀ vẫn “Untitled” nhưng có nội dung
  const r = await FD.ensureFresh(N.d);
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.how, 'new'); assert.deepStrictEqual(N.st.keys, ['cmd+n']);
  assert.strictEqual(N.st.active, 1); N.type('một dòng mới');
  assert.strictEqual(N.st.tabs[0].text, SECRET, 'thẻ cũ của người dùng không bị gõ vào'); assert.strictEqual(N.st.tabs[1].text, 'một dòng mới');
});

test('B191: thẻ cũ là tệp có tên (secret.txt) → Ctrl+N; tài liệu mới đọc không được giá trị nhưng không thấy chữ → nhận là mới', async () => {
  const N = fakeNotepad({ tabs: [{ name: 'secret.txt', text: SECRET }], valueReadable: false });
  const r = await FD.ensureFresh(N.d); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.title, 'Untitled - Notepad'); assert.deepStrictEqual(N.st.keys, ['cmd+n']);
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
  const gate = inner.indexOf("if (action === 'type_text' && freshDocWanted(ctx, s.obs && s.obs.win))");
  assert.ok(gate > 0 && gate < inner.indexOf('let needPoint ='), 'cổng B191 phải chạy trước khi chọn chỗ gõ');
  assert.match(inner.slice(gate, gate + 2500), /return \{ refused: true, stop: true, error: FRESH_DOC_MSG/);
  assert.match(inner.slice(gate, gate + 2500), /!FD\.untitled\(W\.title\)/);
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
