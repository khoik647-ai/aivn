// M9 (redesign): the closed phone menu must not stay in the Tab order (6 invisible links at 390 px).
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'site/index.html'), 'utf8');
test('M9: closed mobile menu is visibility:hidden and inert, toggled with the burger', () => {
  assert.match(html, /\.mobile-menu:not\(\.open\)\{visibility:hidden/);
  assert.match(html, /\.mobile-menu\.open\{visibility:visible\}/);
  assert.match(html, /menu\.inert=true;\s*burger\.addEventListener\('click',function\(\)\{var o=menu\.classList\.toggle\('open'\);burger\.setAttribute\('aria-expanded',o\);menu\.inert=!o;\}\);/);
  assert.match(html, /menu\.classList\.remove\('open'\);burger\.setAttribute\('aria-expanded',false\);menu\.inert=true;/);
});
test('M4: header nav, footer links and language buttons have a >= 24px hit area', () => {
  assert.match(html, /\.nav ul a\{display:inline-flex;align-items:center;min-height:32px;padding:0 6px\}/);
  assert.match(html, /footer li a\{display:inline-flex;align-items:center;min-height:32px\}/);
  assert.match(html, /\.lang button\{min-height:28px;display:inline-flex;align-items:center;justify-content:center\}/);
});
