'use strict';
// r14 (red on 5073153): #64 N1 false negations, #64 N2 再 inside 再见/再次.
// N1: 不要忘记 / 别忘了 mean "don't forget (do it)"; 特别 = especially; 别人 = other people.
// A named file or 当前文档 in those clauses must not force a fresh doc.
// N2: 再 is a clause break only as a sequencer (after space/punctuation, or 然后再 / 再把 / 再在), not inside 再见/再次.
const test = require('node:test'); const assert = require('node:assert');
const path = require('path');
const FD = require(path.join(__dirname, '..', 'src/agent/fresh-doc'));

test('R14 N1 不要忘记 is affirmative and pins notes.txt', () => {
  const q = '不要忘记在 notes.txt 里输入你好';
  assert.strictEqual(FD.freshDocTask(q), false, q);
  assert.strictEqual(FD.namedTarget(q), 'notes.txt', q);
  assert.strictEqual(FD.freshDocTask('不要在 notes.txt 里输入你好'), true);
  assert.strictEqual(FD.namedTarget('不要在 notes.txt 里输入你好'), null);
});

test('R14 N1 别忘了 is affirmative and pins notes.txt', () => {
  const q = '别忘了在 notes.txt 里写你好';
  assert.strictEqual(FD.freshDocTask(q), false, q);
  assert.strictEqual(FD.namedTarget(q), 'notes.txt', q);
  assert.strictEqual(FD.freshDocTask('别在 x.txt 里写'), true);
  assert.strictEqual(FD.namedTarget('别在 x.txt 里写'), null);
});

test('R14 N1 特别 is not a negation', () => {
  const file = '特别在 notes.txt 里输入你好';
  assert.strictEqual(FD.freshDocTask(file), false, file);
  assert.strictEqual(FD.namedTarget(file), 'notes.txt', file);
  const cur = '打开记事本特别在当前文档里写你好';
  assert.strictEqual(FD.freshDocTask(cur), false, cur);
  assert.strictEqual(FD.namedTarget(cur), null, cur);
});

test('R14 N1 别人 is not a negation', () => {
  const q = '在别人的 notes.txt 里输入你好';
  assert.strictEqual(FD.freshDocTask(q), false, q);
  assert.strictEqual(FD.namedTarget(q), 'notes.txt', q);
  const cur = '打开记事本在别人的当前文档里输入你好';
  assert.strictEqual(FD.freshDocTask(cur), false, cur);
  assert.strictEqual(FD.namedTarget(cur), null, cur);
});

test('R14 N1 不要忘记 and 别忘了 with 当前文档 do not force a fresh doc', () => {
  for (const q of ['不要忘记打开记事本在当前文档中输入你好', '别忘了在当前文档里输入你好']) {
    assert.strictEqual(FD.freshDocTask(q), false, q);
    assert.strictEqual(FD.namedTarget(q), null, q);
  }
});

test('R14 N1 a real negated clause still never pins its file', () => {
  const q = '不要在 notes.txt 里输入，不要忘记在 report.txt 里写你好';
  assert.strictEqual(FD.freshDocTask(q), false, q);
  assert.strictEqual(FD.namedTarget(q), 'report.txt', q);
  for (const n of ['勿在 x.txt 中输入', '不准在 x.txt 里输入', '不用在 x.txt 里写', '不能在 x.txt 中输入', '禁止在 x.txt 里输入']) {
    assert.strictEqual(FD.freshDocTask(n), true, n);
    assert.strictEqual(FD.namedTarget(n), null, n);
  }
});

test('R14 N2 再见 is not a clause boundary', () => {
  assert.strictEqual(FD.commandPart('打开记事本输入再见'), '打开记事本输入再见');
  const q = '在 notes.txt 里输入再见';
  assert.strictEqual(FD.commandPart(q), q);
  assert.strictEqual(FD.namedTarget(q), 'notes.txt');
  assert.strictEqual(FD.freshDocTask(q), false);
  // Sequencer still splits: 然后再 is one break; ，再在 pins the file in the next clause.
  assert.strictEqual(FD.commandPart('不要在 notes.txt 里输入然后再打开记事本输入你好'), '打开记事本输入你好');
  assert.strictEqual(FD.namedTarget('打开记事本，再在 notes.txt 里输入你好'), 'notes.txt');
  assert.strictEqual(FD.freshDocTask('打开记事本，再在 notes.txt 里输入你好'), false);
  assert.strictEqual(FD.freshDocTask('不要在 notes.txt 里输入再打开记事本输入你好'), true);
  assert.strictEqual(FD.namedTarget('不要在 notes.txt 里输入再打开记事本输入你好'), null);
});

test('R14 N2 再次 is not a clause boundary', () => {
  assert.strictEqual(FD.commandPart('打开记事本输入再次你好'), '打开记事本输入再次你好');
  assert.strictEqual(FD.commandPart('打开记事本 再把 notes.txt 打开输入你好').includes('notes.txt'), true);
  assert.strictEqual(FD.freshDocTask('不要在 x.txt 里写再把 notes.txt 打开输入你好'), false);
});

test('R14 M1 再 right after a negation does not pin the file', () => {
  for (const q of ['不要再在 notes.txt 里输入你好', '别再在 notes.txt 里写你好', '打开记事本，不要再在 notes.txt 里输入你好']) {
    assert.strictEqual(FD.freshDocTask(q), true, q);
    assert.strictEqual(FD.namedTarget(q), null, q);
  }
});
