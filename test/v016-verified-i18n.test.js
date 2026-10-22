'use strict';
// Trang kiểm chứng ba thứ tiếng (vi/en/zh) như trang chủ: bản dịch phải khớp bản gốc về mỏ neo, bảng, mã và số liệu.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const { render, page } = require('../build/md-page.cjs');
const DOCS = { vi: R('docs/verified.md'), en: R('docs/verified.en.md'), zh: R('docs/verified.zh.md') };
const anchors = (md) => [...md.matchAll(/<a id="([\w-]+)"><\/a>/g)].map(m => m[1]);
// chia theo mỏ neo: phần đầu + từng mục
const sections = (md) => md.split(/<a id="[\w-]+"><\/a>/);
const codes = (s) => [...s.matchAll(/`([^`]+)`/g)].map(m => m[1]).sort();
const nums = (s) => (s.replace(/`[^`]*`/g, ' ').replace(/(\d),(\d)/g, '$1.$2').match(/\d+(?:\.\d+)*/g) || []).sort();
const rows = (s) => s.split('\n').filter(l => /^\|/.test(l)).length;
const items = (s) => s.split('\n').filter(l => /^\s*(?:[-*]|\d+\.)\s+/.test(l)).length;

test('bản dịch en/zh có đúng các mỏ neo của bản tiếng Việt, cùng thứ tự', () => {
  const vi = anchors(DOCS.vi); assert.ok(vi.length >= 5);
  for (const l of ['en', 'zh']) assert.deepStrictEqual(anchors(DOCS[l]), vi, l);
});

test('mỗi mục: cùng số hàng bảng, số mục liệt kê, đoạn mã và số liệu như bản tiếng Việt', () => {
  const V = sections(DOCS.vi);
  for (const l of ['en', 'zh']) {
    const S = sections(DOCS[l]); assert.strictEqual(S.length, V.length, l);
    S.forEach((s, k) => {
      const where = `${l} mục ${k} (${anchors(DOCS.vi)[k - 1] || 'mở đầu'})`;
      assert.strictEqual(rows(s), rows(V[k]), where + ': số hàng bảng');
      assert.strictEqual(items(s), items(V[k]), where + ': số mục liệt kê');
      assert.deepStrictEqual(codes(s), codes(V[k]), where + ': đoạn mã');
      assert.deepStrictEqual(nums(s), nums(V[k]), where + ': số liệu');
    });
  }
});

test('nhãn trong bản dịch dùng đúng chữ của giao diện ứng dụng', () => {
  const en = require('../src/i18n/en.js'), zh = require('../src/i18n/zh.js');
  const E = en.dict || en.default || en, Z = zh.dict || zh.default || zh;
  for (const k of ['Đã kiểm chứng', 'AIVN thử chưa đạt', 'Theo nhà phát triển', 'Khám phá', 'Chạy chậm']) {
    assert.ok(E[k] && DOCS.en.includes(E[k]), `en thiếu “${E[k]}” (${k})`);
    assert.ok(Z[k] && DOCS.zh.includes(Z[k]), `zh thiếu “${Z[k]}” (${k})`);
  }
});

test('verified.html: ba khối ngôn ngữ, nút đổi ngôn ngữ như trang chủ, không trùng id, chạy được khi tắt JS', () => {
  const h = page(path.join(__dirname, '..', 'docs', 'verified.md'));
  for (const [l, hl] of [['vi', 'vi'], ['en', 'en'], ['zh', 'zh-CN']]) {
    assert.match(h, new RegExp(`<main data-lang-block="${l}" lang="${hl}"`));
    assert.match(h, new RegExp(`<button type="button" data-lang="${l}"`));
  }
  assert.match(h, /<main data-lang-block="en" lang="en" hidden>/); assert.match(h, /<main data-lang-block="zh" lang="zh-CN" hidden>/);
  const ids = [...h.matchAll(/\sid="([\w-]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(ids, anchors(DOCS.vi), 'chỉ khối tiếng Việt có id tĩnh (không JS vẫn nhảy đúng mục)');
  for (const id of anchors(DOCS.vi)) assert.strictEqual(h.split(`data-aid="${id}"`).length - 1, 2, id);
  // cùng khoá lưu lựa chọn và tham số ?lang= với trang chủ
  const site = R('site/index.html');
  assert.match(site, /KEY='aivn-lang'/); assert.match(h, /KEY='aivn-lang'/);
  assert.ok(h.includes('[?&]lang=(vi|en|zh)(?![a-z])') && site.includes('[?&]lang=(vi|en|zh)(?![a-z])'));
  assert.match(h, /"en":"AIVN — Self-verification results"/); assert.match(h, /"zh":"AIVN — 自行验证结果"/);
});

test('md-page: bỏ hàng phân cách bảng, danh sách đánh số, dấu \\* đầu chú thích', () => {
  const h = render('| a | b |\n|---|---|\n| 1 | 2 |\n\n1. x\n2. y\n\n\\* ghi chú');
  assert.ok(!h.includes('---'), h); assert.match(h, /<table><tr><th>a<\/th><th>b<\/th><\/tr><tr><td>1<\/td><td>2<\/td><\/tr><\/table>/);
  assert.match(h, /<ol><li>x<\/li><li>y<\/li><\/ol>/); assert.match(h, /<p>\* ghi chú<\/p>/);
  assert.strictEqual(render('<a id="x"></a>', { aid: true }), '<a data-aid="x"></a>');
});

test('release.sh kiểm đủ bản dịch và mỏ neo của trang kiểm chứng', () => {
  const rel = R('release.sh');
  assert.match(rel, /node build\/md-page\.cjs docs\/verified\.md "\$SITE\/verified\.html"/);
  assert.match(rel, /docs\/verified\.\$L\.md/); assert.match(rel, /data-lang-block=\\"\$L\\"/); assert.match(rel, /bản dịch thiếu mỏ neo/);
});
