'use strict';
// r11: every invisible/format char (\p{Cf}, Default_Ignorable) must be treated like ZWJ/U+2060 (both readings), inside or between words.
const test = require('node:test'); const assert = require('node:assert');
const path = require('path'); const ROOT = process.env.ROOT || process.cwd();
const SV = require(path.join(ROOT, 'src/agent/send-verify'));
const Z = ['\u200b','\u200c','\u200d','\u2060','\ufeff','\u00ad','\u180e','\u034f','\u2061','\u2062','\u2063','\u2064','\u206a','\u3164','\u115f','\ufe0f','\u{e0020}'];
const BASES = [['Gửi cho An hi, đừng gửi','đừng',2],['Gửi cho An hi, không gửi','không',3],["Send An hi, don't send","don't",2],['Gửi cho An: hẹn mai, chưa gửi','chưa',2],['Send An hi, do not send','not',1],['Gửi cho An: hẹn mai. Khoan gửi','Khoan',2],['Gửi cho An: hẹn mai. Không cần gửi','cần',1]];
for (const [q, w, k] of BASES) for (const z of Z) {
  const i = q.lastIndexOf(w) + k; const inside = q.slice(0, i) + z + q.slice(i); const joined = q.replace(w + ' ', w + z);
  const cp = 'U+' + z.codePointAt(0).toString(16).toUpperCase();
  test(`R11 ${cp} inside: ${q}`, () => assert.strictEqual(!!SV.allowsSend(inside), false));
  test(`R11 ${cp} joined: ${q}`, () => assert.strictEqual(!!SV.allowsSend(joined), false));
}
for (const q of ['Gửi cho An: hẹn mai', 'Send An: see you tomorrow', 'Gửi cho An: hẹn mai, cho gui nhe']) for (const z of ['\u00ad', '\u180e', '\u200d']) {
  test('R11 still sends with ' + z.codePointAt(0).toString(16) + ': ' + q, () => assert.strictEqual(!!SV.allowsSend(q.replace('An', 'A' + z + 'n')), true));
}
