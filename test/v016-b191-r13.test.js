'use strict';
// r13 (red on 187f222): negation in zh/vi/en with notes.txt open+active must not write notes.txt or the old tab.
// 别/勿 variants: the named file is the active tab, so a wrong pin would change it.
const test = require('node:test'); const assert = require('node:assert');
const path = require('path'); const ROOT = process.env.ROOT || path.join(__dirname, '..');
const FD = require(path.join(ROOT, 'src/agent/fresh-doc'));
const DK = require(path.join(ROOT, 'test/fixtures/b191-desk'));
const CASES = [
  ['N2en', 'Open Notepad and do not type into notes.txt, type hello', 'hello', 'notes.txt'],
  ['N2vi', 'Không gõ vào notes.txt, mở Notepad gõ xin chào', 'xin chào', 'notes.txt'],
  ['N2zh', '不要在 notes.txt 里输入，打开记事本输入你好', '你好', 'notes.txt'],
  ['N2zh-bie', '别在 x.txt 里写', '你好', 'x.txt'],
  ['N2zh-wu', '勿在 x.txt 中输入', '你好', 'x.txt'],
];
for (const [id, q, text, file] of CASES) test(`R13 ${id} ${q}`, async () => {
  const w = DK.notepad({ tabs: [{ name: file, text: 'NOTES-KEEP' }, { name: 'Untitled', text: 'KHOI-SECRET', dirty: true }], active: 0, valueReadable: false });
  const ag = DK.make(w); await DK.run(ag, q, [{ action: 'type_text', text }]);
  assert.strictEqual(w.oldTouched(), false, 'existing tab written: ' + JSON.stringify(w.st.tabs));
});

test('R13 negated clause never pins; the positive clause decides', () => {
  const on = (q) => { assert.strictEqual(FD.freshDocTask(q), true, q); assert.strictEqual(FD.namedTarget(q), null, q); };
  on('不要在 notes.txt 里输入，打开记事本输入你好');
  on('不要在 notes.txt 里输入然后打开记事本输入你好');
  on('不要在 notes.txt 里输入再打开记事本输入你好');
  on('别在 x.txt 里写');
  on('勿在 x.txt 中输入');
  on('不准在 x.txt 里输入');
  on('不用在 x.txt 里写');
  on('不能在 x.txt 中输入');
  on('禁止在 x.txt 里输入');
  assert.strictEqual(FD.freshDocTask('不要在 notes.txt 里输入，在当前文档中输入你好'), false);
  assert.strictEqual(FD.namedTarget('不要在 notes.txt 里输入，在当前文档中输入你好'), null);
  assert.strictEqual(FD.freshDocTask('不要在 notes.txt 里输入，在 report.txt 里输入你好'), false);
  assert.strictEqual(FD.namedTarget('不要在 notes.txt 里输入，在 report.txt 里输入你好'), 'report.txt');
  assert.strictEqual(FD.namedTarget('打开记事本在 notes.txt 中输入你好'), 'notes.txt');
  assert.strictEqual(FD.freshDocTask('打开记事本在 notes.txt 中输入你好'), false);
  assert.strictEqual(FD.namedTarget('open C:\\notes\\a.txt, type hi'), null);
  assert.strictEqual(FD.freshDocTask('open C:\\notes\\a.txt, type hi'), false);
  assert.strictEqual(FD.namedTarget('mở notes.txt, gõ abc'), null);
  assert.strictEqual(FD.freshDocTask('mở notes.txt, gõ abc'), false);
  assert.strictEqual(FD.freshDocTask('type X into readme.md in a new Notepad window'), true);
  assert.strictEqual(FD.namedTarget('type X into readme.md in a new Notepad window'), null);
});
