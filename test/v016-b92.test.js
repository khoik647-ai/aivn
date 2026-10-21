'use strict';
// B92 (máy thật beta.2.1, --qa-ui): thẻ Khám phá / Mô hình của tôi ở en/zh còn số kiểu Việt “9,2 GB VRAM”, “~6,4 tokens/s”; Bảo mật “Activated · cấp cho <tên>”
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const CORE = require('../src/i18n/core'); const T = CORE.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
const { i18nIssues } = require('../src/qa-ui'); const F = require('../src/fit');
const KEYS = [...require('../src/i18n/strings.json'), ...require('../src/i18n/strings-main.json'), ...require('../src/i18n/strings-data.json'), ...require('../src/i18n/strings-agent.json')];
const G = 1024 ** 3;
test('B92: thẻ mô hình (fmtFit/fitDetail) ở en/zh dùng dấu chấm thập phân; tiếng Việt giữ dấu phẩy', () => {
  const fits = [{ tps: 63, vram: 9.2 * G }, { tps: 6.4, vram: 11.2 * G, ram: 6.4 * G }, { tps: 37, vram: 11.2 * G, ram: 8.9 * G }, { group: 'no', need: 20.5 * G }];
  for (const f of fits) { const v = F.fmtFit(f); assert.match(v, /\d,\d/); for (const l of ['en', 'zh']) for (const x of [v, '· ' + v]) { const o = T.tr(x, l); assert.ok(!/\d,\d/.test(o), `${l}: ${o}`); assert.deepStrictEqual(i18nIssues([o], l), [], o); } }
  assert.strictEqual(T.tr(F.fmtFit(fits[1]), 'en'), '~6.4 tokens/s · 11.2 GB VRAM + 6.4 GB RAM');
  const det = F.fitDetail({ ctx: 8192, need: 9.2 * G, parts: { weights: 5.1 * G, mmproj: 1.2 * G, kv: 2.3 * G, compute: 0.6 * G } });
  for (const l of ['en', 'zh']) assert.ok(!/\d,\d/.test(T.tr(det, l)), T.tr(det, l));
  assert.strictEqual(T.tr('Ổ C còn trống 1,000 GB', 'en').includes('1,000 GB'), true, 'không đụng dấu phẩy nghìn (3 chữ số)');
});
test('B92: quét mọi khoá có chỗ thay thế đứng trước đơn vị (GB/%/token…) — điền “9,2” rồi dịch: không còn số kiểu Việt ở en/zh', () => {
  const unit = /\{\d+\}\s?(?:[KMGT]i?B\b|%|tokens?\/|token\/|GHz|MHz)/; const keys = KEYS.filter(k => unit.test(k)); assert.ok(keys.length >= 5, String(keys.length));
  const bad = [];
  for (const k of keys) { const v = k.replace(/\{\d+\}/g, '9,2'); for (const l of ['en', 'zh']) { const o = T.tr(v, l); if (o !== v && /\d,\d{1,2}\s?(?:[KMGT]i?B\b|%|tokens?\/|token\/)/.test(o)) bad.push(`${l}: ${o}`); } }
  assert.deepStrictEqual(bad, []);
});
test('B92: Bảo mật — “cấp cho” được dịch, tên người được cấp nằm riêng (data-noi18n), bộ kiểm i18n bỏ qua phần data-noi18n', () => {
  assert.strictEqual(T.tr('Đã kích hoạt · cấp cho ', 'en'), 'Activated · issued to '); assert.ok(!/cấp cho/.test(T.tr('Đã kích hoạt · cấp cho ', 'zh')));
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8'); assert.match(app, /· cấp cho <span data-noi18n>\$\{esc\(l\.name\)\}<\/span>/);
  const qa = fs.readFileSync(path.join(root, 'src/qa-ui.js'), 'utf8'); assert.match(qa, /\[data-noi18n\], \.msg \.body/);
});
test('B92: bộ kiểm i18n bắt số kiểu Việt trước tokens/s, token/秒, GB VRAM; không bắt dấu phẩy nghìn', () => {
  for (const [t, l] of [['· ~63 tokens/s · 9,2 GB VRAM', 'en'], ['~6,4 tokens/s', 'en'], ['· ~6,4 token/秒', 'zh'], ['RAM 2,2 / 15,6 GB', 'en'], ['37,5%', 'zh']]) assert.ok(i18nIssues([t], l).some(x => /^vi-number-in-/.test(x.kind)), t);
  for (const [t, l] of [['1,000 GB', 'en'], ['9.2 GB VRAM', 'en'], ['~6.4 tokens/s', 'en']]) assert.ok(!i18nIssues([t], l).some(x => /^vi-number-in-/.test(x.kind)), t);
});
