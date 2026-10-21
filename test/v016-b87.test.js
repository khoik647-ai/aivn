// B87: bản dịch sót (dòng thư mục mô hình, “lần cuối”, “drive C::”, “170,42 GB” trong en/zh) + bộ kiểm tra i18n phải bắt được.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const QU = require('../src/qa-ui');
const CORE = require('../src/i18n/core.js');
const en = require('../src/i18n/en.js'), zh = require('../src/i18n/zh.js');
const T = CORE.create({ en: en.default || en, zh: zh.default || zh });
const R = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', f), 'utf8');

test('B87: bộ kiểm tra i18n bắt dòng có đường dẫn …\\AIVN\\…, số kiểu vi và “::”', () => {
  const k = (t, lang = 'en') => QU.i18nIssues([t], lang).map((x) => x.kind);
  assert.ok(k('C:\\Users\\k\\AppData\\Roaming\\AIVN\\models · ổ C: còn trống 170,42 GB').includes('vi-in-en'), 'tên riêng AIVN không được che cả dòng');
  assert.ok(k('Used 170,42 GB').includes('vi-number-in-en'));
  assert.ok(k('已用 170,42 GB', 'zh').includes('vi-number-in-zh'));
  assert.ok(k('drive C:: 1 GB free').includes('double-colon'));
  assert.deepStrictEqual(k('NGUYỄN NGỌC KHÔI SINH VIÊN VLU'), []);
  assert.deepStrictEqual(k('Dùng 170,42 GB', 'vi'), []);
  assert.deepStrictEqual(k('170.42 GB free · AIVN AGENT'), []);
});

test('B87: dòng thư mục mô hình/“lần cuối” dịch đúng, không “drive C::”', () => {
  const s = 'C:\\M\\AIVN\\models · ổ C còn trống 170.42 GB · mô hình đang chiếm 31.2 GB';
  const e = T.tr(s, 'en'), z = T.tr(s, 'zh');
  assert.match(e, /drive C: 170\.42 GB free · models use 31\.2 GB$/); assert.doesNotMatch(e, /::/);
  assert.match(z, /C 盘剩余 170\.42 GB/);
  assert.match(T.tr('lần cuối 10/22/2026, 2:00 AM', 'en'), /^last 10\/22\/2026/);
  assert.match(T.tr('lần cuối 2026/10/22 02:00', 'zh'), /^上次 /);
  assert.match(T.tr('3/9 tệp · 1.5 GB / 4 GB', 'en'), /^3\/9 files/);
});

test('B87: mã nguồn — không data-noi18n trên khối có chữ Việt, ổ bỏ “:”, đổi ngôn ngữ thì vẽ lại', () => {
  const html = R('index.html'), app = R('app.js');
  assert.doesNotMatch(html, /id="mdirInfo"[^>]*data-noi18n/); assert.doesNotMatch(html, /id="mdirProgTxt"[^>]*data-noi18n/);
  // mọi phần tử tĩnh data-noi18n có id: app.js không được ghi chữ Việt vào đó
  for (const m of html.matchAll(/id="([^"]+)"[^>]*data-noi18n/g)) {
    const re = new RegExp(`#${m[1]}'\\)\\.textContent = \`([^\`]*)\``, 'g');
    for (const a of app.matchAll(re)) assert.doesNotMatch(a[1].replace(/\$\{[^}]*\}/g, ''), /[À-ỹ]/, `#${m[1]} nhận chữ Việt nhưng có data-noi18n`);
  }
  assert.doesNotMatch(app, /'lần cuối ' \+/);
  assert.match(app, /drive: String\(d0\.drive \|\| ''\)\.replace\(\/:\$\/, ''\)/);
  assert.match(app, /aivn-lang[\s\S]{0,120}mdirRefresh/);
});
