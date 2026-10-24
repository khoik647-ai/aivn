'use strict';
// r9 (head c3f0ed8): unknown verb + content mentioning existing doc → protection off. run: ROOT=<repo> node --test this
const test = require('node:test'); const assert = require('node:assert');
const path = require('path'); const ROOT = process.env.ROOT || process.cwd();
const FD = require(path.join(ROOT, 'src/agent/fresh-doc'));
const DK = require(path.join(ROOT, 'test/fixtures/b191-desk'));
const restored = (o = {}) => DK.notepad({ tabs: [{ name: 'Untitled', text: 'KHOI-SECRET', dirty: true }], valueReadable: false, ...o });
const CASES = [
  ['U1', 'Open Notepad and draft a summary of this document', 'Summary'],
  ['U2', 'Open Notepad and compose a note about this file', 'Note'],
  ['U3', 'Mở Notepad và chép lại nội dung tài liệu này', 'nội dung'],
  ['U4', 'Mở Notepad rồi chép tóm tắt tệp hiện có', 'tóm tắt'],
  ['U5', '打开记事本记录当前文档的摘要', '摘要'],
  ['U6', 'Open Notepad and append a summary of report.docx', 'summary'],
  ['U7', 'Open Notepad and append see this file later', 'see this file later'],
];
for (const [id, q, text] of CASES) test(`R9 ${id} content after unknown verb must not disable protection — ${q}`, async () => {
  const w = restored(); const ag = DK.make(w); await DK.run(ag, q, [{ action: 'type_text', text }]);
  assert.strictEqual(w.oldTouched(), false, `old tab written (freshDocTask=${FD.freshDocTask(q)})`);
});

test('R9: cụm trong nội dung không tắt bảo vệ; đích nói rõ vẫn tắt', async () => {
  for (const [, q] of CASES) assert.strictEqual(FD.freshDocTask(q), true, q);
  for (const [q, text] of [['Type hello into the current document', 'hello'], ['Gõ hello vào tài liệu đang mở', 'hello']]) {
    assert.strictEqual(FD.freshDocTask(q), false, q);
    const w = DK.notepad({ tabs: [{ name: 'Untitled', text: 'a' }] }); const ag = DK.make(w);
    await DK.run(ag, q, [{ action: 'type_text', text }]);
    assert.strictEqual(w.st.tabs.length, 1, q); assert.strictEqual(w.st.tabs[0].text, 'a' + text, q);
  }
  assert.strictEqual(FD.freshDocTask('Append hello to report.docx'), false);
  assert.strictEqual(FD.namedTarget('Append hello to report.docx'), 'report.docx');
  const w = DK.notepad({ tabs: [{ name: 'report.docx', text: 'a' }] }); const ag = DK.make(w);
  await DK.run(ag, 'Append hello to report.docx', [{ action: 'type_text', text: ' hello' }]);
  assert.strictEqual(w.st.tabs.length, 1); assert.strictEqual(w.st.tabs[0].text, 'a hello');
  const old = restored(); const ag2 = DK.make(old);
  await DK.run(ag2, 'Append hello to report.docx', [{ action: 'type_text', text: ' hello' }]);
  assert.strictEqual(old.oldTouched(), false, 'report.docx không phải thẻ đang mở → không gõ vào thẻ cũ');
});
