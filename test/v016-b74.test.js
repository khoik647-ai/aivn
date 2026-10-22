'use strict';
// B74 (pass 8): dòng trạng thái thao tác trên thanh AGENT (desc viết HOA chữ đầu + “…”) không được dịch ở en/zh — khoá viết thường, không có “…”
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const CORE = require('../src/i18n/core'); const T = CORE.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
const PATS = require('../build/i18n-agent-patterns.json');
const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const SAMPLE = { 0: 'nút', 1: 'Nộp bài', 2: 'Tìm kiếm' };
test('B74: mọi mẫu mô tả bước (viết HOA chữ đầu + “…”, đúng như thanh AGENT) được dịch en/zh, không còn chữ Việt ngoài phần trong ngoặc', () => {
  const bad = [];
  const ACT = /^(?:bấm|gõ|cuộn|kéo|di chuột|nhấn|giữ|thả|chọn|dán|đợi|chờ)(?=\s|$)/iu; // mô tả bước (describeAct) — đúng thứ hiện trên thanh AGENT
  const acts = PATS.filter(x => /\{\d\}/.test(x) && ACT.test(x) && !/[….]$/.test(x)); assert.ok(acts.length >= 15, String(acts.length));
  for (const p of acts) {
    const v = p.replace(/\{(\d)\}/g, (_, n) => /“\{\d\}”/.test(p) && p.includes(`“{${n}}”`) ? SAMPLE[n] || 'X' : n === '0' && /\{0\} “/.test(p) ? 'nút' : '12');
    const line = v[0].toUpperCase() + v.slice(1) + '…';
    for (const l of ['en', 'zh']) { const o = T.tr(line, l); const outside = o.replace(/“[^”]*”/g, '').replace(/\([^)]*\)/g, ''); if (o === line || VI.test(outside)) bad.push(`${l}: ${line} → ${o}`); }
  }
  assert.deepStrictEqual(bad, []);
});
test('B74: ví dụ trong báo cáo QA', () => {
  assert.strictEqual(T.tr('Bấm nút “Nộp bài”…', 'en'), 'Click button “Nộp bài”…'); assert.strictEqual(T.tr('Bấm nút “Nộp bài”…', 'zh'), '点击按钮“Nộp bài”…');
  assert.strictEqual(T.tr('Cuộn xuống 5 nấc…', 'en'), 'Scroll down 5 notches…');
  const da = fs.readFileSync(path.join(__dirname, '..', 'src/desktop-agent.js'), 'utf8'); assert.match(da, /status\(desc\.charAt\(0\)\.toUpperCase\(\) \+ desc\.slice\(1\) \+ '…'\)/);
});
