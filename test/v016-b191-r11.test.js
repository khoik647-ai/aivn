'use strict';
// r11: fail-closed. to/gửi/cho/给/on + tài liệu không phải đích của write/draft/compose/soạn/viết/写.
// to chỉ tắt bảo vệ với động từ chèn (append/add/insert/paste/thêm/chèn/dán/添加/加到) khi đích là tài liệu đang mở hoặc đúng tên tệp của thẻ đang mở.
const test = require('node:test'); const assert = require('node:assert');
const path = require('path'); const ROOT = process.env.ROOT || process.cwd();
const FD = require(path.join(ROOT, 'src/agent/fresh-doc'));
const DK = require(path.join(ROOT, 'test/fixtures/b191-desk'));
const KEEP = [
  'Open Notepad and draft a letter to this document',
  'Open Notepad and write a message to report.docx',
  'Open Notepad and draft a memo to the current document',
  'Open Notepad and write a limerick to this file',
  'Open Notepad and compose an ode to the open document',
  'Open Notepad and write a cover letter to report.docx',
  'Open Notepad and draft a blurb on this document',
  'Mở Notepad và soạn một bức thư gửi tài liệu này',
  '打开记事本给当前文档写一封信',
];
const OFF = ['Type hello into the current document', 'Write hello in this document', 'Gõ hello vào tài liệu đang mở', '在当前文档中输入你好', 'Append hello to this document', 'Add a line to the current document'];
for (const q of KEEP) test('R11 keep protection: ' + q, () => assert.strictEqual(FD.freshDocTask(q), true));
for (const q of OFF) test('R11 explicit target turns protection off: ' + q, () => assert.strictEqual(FD.freshDocTask(q), false));

test('R11: Append hello to report.docx chỉ tắt bảo vệ khi thẻ đang mở đúng là report.docx', async () => {
  assert.strictEqual(FD.freshDocTask('Append hello to report.docx'), false);
  assert.strictEqual(FD.namedTarget('Append hello to report.docx'), 'report.docx');
  const wrong = DK.notepad({ tabs: [{ name: 'notes.txt', text: 'KHOI-SECRET', dirty: true }] });
  const ag = DK.make(wrong);
  await DK.run(ag, 'Append hello to report.docx', [{ action: 'type_text', text: ' hello' }]);
  assert.strictEqual(wrong.oldTouched(), false, 'thẻ notes.txt chưa lưu không được gõ');
  assert.strictEqual(wrong.st.tabs[0].text, 'KHOI-SECRET');
  assert.strictEqual(wrong.st.tabs.length, 2);
  assert.strictEqual(wrong.st.tabs[1].text, ' hello');
  const ok = DK.notepad({ tabs: [{ name: 'report.docx', text: 'a' }] });
  const ag2 = DK.make(ok);
  await DK.run(ag2, 'Append hello to report.docx', [{ action: 'type_text', text: ' hello' }]);
  assert.strictEqual(ok.st.tabs.length, 1);
  assert.strictEqual(ok.st.tabs[0].text, 'a hello');
});
