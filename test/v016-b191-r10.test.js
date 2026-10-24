'use strict';
// r10 (head 881f947): content noun + on/to/for + existing doc must keep fresh-doc protection ON (freshDocTask === true).
const test = require('node:test'); const assert = require('node:assert');
const path = require('path'); const ROOT = process.env.ROOT || process.cwd();
const FD = require(path.join(ROOT, 'src/agent/fresh-doc'));
const KEEP = [
  'Open Notepad and jot down notes on this document',
  'Open Notepad and write notes on this document',
  'Open Notepad and draft notes on this document',
  'Open Notepad and draft a reply to this document',
  'Open Notepad and draft a reply to report.docx',
  'Open Notepad and draft feedback on the current file',
  'Open Notepad and write comments on this file',
  'Open Notepad and type my thoughts on the current document',
  'Mở Notepad và viết ghi chú về tài liệu đang mở',
  'Mở Notepad và soạn phản hồi cho tài liệu này',
  '打开记事本写一下对当前文档的评论',
];
const OFF = ['Type hello into the current document', 'Gõ hello vào tài liệu đang mở', 'Write hello in this document', '在当前文档中输入你好'];
for (const q of KEEP) test('R10 keep protection: ' + q, () => assert.strictEqual(FD.freshDocTask(q), true));
for (const q of OFF) test('R10 explicit target turns protection off: ' + q, () => assert.strictEqual(FD.freshDocTask(q), false));
