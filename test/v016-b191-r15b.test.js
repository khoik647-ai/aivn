'use strict';
// r15b: N2 bidi in a file/target clause must not pin; N1 invisible selectors,
// braille blank, and gap punctuation (plus a negation-only line joined onto 再)
// must not split a negated clause. Red on f3d5b29, green on head.
// N3: no behavior change.
const test = require('node:test'); const assert = require('node:assert');
const path = require('path');
const FD = require(path.join(__dirname, '..', 'src/agent/fresh-doc'));

function noPin(q) {
  assert.strictEqual(FD.freshDocTask(q), true, JSON.stringify(q));
  assert.strictEqual(FD.namedTarget(q), null, JSON.stringify(q));
}
function pins(q, file) {
  assert.strictEqual(FD.freshDocTask(q), false, JSON.stringify(q));
  assert.strictEqual(FD.namedTarget(q), file, JSON.stringify(q));
}

const BIDI = [0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069];
for (const cp of BIDI) {
  const hex = cp.toString(16).toUpperCase();
  test(`R15 N2 U+${hex} in the file clause does not pin any file`, () => {
    const q = `在 other${String.fromCodePoint(cp)}.txt 里输入你好`;
    const before = q;
    noPin(q);
    assert.strictEqual(q, before);
  });
}

test('R15 N2 bidi after the file name but in the same clause does not pin', () => {
  noPin('在 other.txt 里输入\u202E你好');
});

test('R15 N1 U+E0100 between 不要 and 再在 does not pin notes.txt', () => {
  noPin(`不要${String.fromCodePoint(0xE0100)}再在 notes.txt 里输入你好`);
});
test('R15 N1 U+E01EF between 不要 and 再在 does not pin notes.txt', () => {
  noPin(`不要${String.fromCodePoint(0xE01EF)}再在 notes.txt 里输入你好`);
});
test('R15 N1 U+2800 between 不要 and 再在 does not pin notes.txt', () => {
  noPin('不要\u2800再在 notes.txt 里输入你好');
});

test('R15 N1 U+2015 horizontal bar between 不要 and 再在 does not pin', () => {
  noPin('不要\u2015再在 notes.txt 里输入你好');
});
test('R15 N1 hyphen-minus between 不要 and 再在 does not pin', () => {
  noPin('不要-再在 notes.txt 里输入你好');
});
test('R15 N1 fullwidth tilde between 不要 and 再在 does not pin', () => {
  noPin('不要\uFF5E再在 notes.txt 里输入你好');
});
test('R15 N1 middle dot between 不要 and 再在 does not pin', () => {
  noPin('不要\u00B7再在 notes.txt 里输入你好');
});
test('R15 N1 newline between 不要 and 再在 does not pin', () => {
  noPin('不要\n再在 notes.txt 里输入你好');
});

test('R15 keep 先保存，再在 and a leading 再在 pin notes.txt', () => {
  pins('先保存，再在 notes.txt 里输入你好', 'notes.txt');
  pins('再在 notes.txt 里输入你好', 'notes.txt');
});
test('R15 keep 再见 and 再次 are not clause boundaries', () => {
  assert.strictEqual(FD.commandPart('打开记事本输入再见'), '打开记事本输入再见');
  pins('在 notes.txt 里输入再见', 'notes.txt');
  assert.strictEqual(FD.commandPart('打开记事本输入再次你好'), '打开记事本输入再次你好');
});
test('R15 keep emoji ZWJ still pins notes.txt and is not a bidi block', () => {
  pins('在 notes\u200D.txt 里输入你好', 'notes.txt');
  pins('在 notes.txt 里输入\u{1F468}\u200D\u{1F469}', 'notes.txt');
});
