'use strict';
// r12: tên tệp đứng trước động từ ghi phải được ghim; câu phủ định không phải đích.
const test = require('node:test'); const assert = require('node:assert');
const path = require('path'); const ROOT = path.join(__dirname, '..');
const FD = require(path.join(ROOT, 'src/agent/fresh-doc'));
const DK = require(path.join(ROOT, 'test/fixtures/b191-desk'));
const restored = (o = {}) => DK.notepad({ tabs: [{ name: 'Untitled', text: 'KHOI-SECRET', dirty: true }], valueReadable: false, ...o });
const CASES = [
  ['Z1', '打开记事本在 notes.txt 中输入你好', '你好'],
  ['Z2', 'Open Notepad and do not type into notes.txt, type hello', 'hello'],
  ['Z4', 'Open Notepad and in notes.txt type hello', 'hello'],
  ['Z5', 'Mở Notepad, trong tệp notes.txt gõ xin chào', 'xin chào'],
  ['Z6', '打开记事本，在当前文档的 notes.txt 里输入你好', '你好'],
  ['Z7', 'Open Notepad and type hello into notes.txt', 'hello'],
  ['Z3', 'Open Notepad and type hello. Do not type into the current file', 'hello'],
];
for (const [id, q, text] of CASES) test(`R12 ${id} ${q}`, async () => {
  const w = restored(); const ag = DK.make(w); await DK.run(ag, q, [{ action: 'type_text', text }]);
  assert.strictEqual(w.oldTouched(), false, `old tab written (fresh=${FD.freshDocTask(q)} file=${FD.namedTarget(q)})`);
});
