// B143–B150 (QA web beta.2.7): khối beta + sửa chung trang web, chạy trên bản sao trang mẫu và bản sao trang đang chạy (0.15.3 + khối beta cũ)
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'); const NAME = 'NGUYỄN NGỌC KHÔI SINH VIÊN VLU';
const SHA = '421af85e5766e99b6cdf7e163981646087ff794c88b9d44f7dff8b572bac3b98';
const URL = 'https://github.com/khoik647-ai/aivn/releases/download/v0.16.0-beta.2.7/AIVN-Setup-0.16.0-beta.2.7.exe';
const beta = (f, extra = []) => execFileSync('python3', [path.join(root, 'tools/site_beta.py'), '--html', f, '--version', '0.16.0-beta.2.7', '--url', URL, '--sha256', SHA, '--size', '244978025', ...extra]);
const fixes = (f, extra = []) => execFileSync('python3', [path.join(root, 'tools/site_fixes.py'), '--html', f, ...extra]);
const dict = (h) => JSON.parse(h.split('/*I18N*/')[1].split('/*END*/')[0]);
function live() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'site-b140-')); const f = path.join(d, 'index.html');
  fs.copyFileSync(path.join(__dirname, 'fixtures/site-live-0.15.3.html'), f); return f;
}
function tmpl() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'site-b140t-')); fs.mkdirSync(path.join(d, 'i18n'));
  for (const l of ['vi', 'en', 'zh']) fs.copyFileSync(path.join(root, 'site/i18n', l + '.json'), path.join(d, 'i18n', l + '.json'));
  const f = path.join(d, 'index.html'); fs.copyFileSync(path.join(root, 'site/index.html'), f); return { f, i18n: path.join(d, 'i18n') };
}
test('B144/B145/B146/B148/B143: lời khối beta vi/en/zh, SHA-256 không ngắt, vùng bấm ≥ 44 px, dòng “chỉ cho Windows” trên điện thoại', () => {
  const f = live(); fixes(f, ['--sizes', '240075606,259835253,272736118']); beta(f); const h = fs.readFileSync(f, 'utf8'); const D = dict(h);
  const vi = h.match(/data-i18n="beta\.1"[^>]*>([\s\S]*?)<\/div><script>/)[1]; const T = { vi, en: D.en['beta.1'], zh: D.zh['beta.1'] };
  assert.match(T.vi, /Tải bản thử nghiệm <span class="nw">0\.16\.0-beta\.2\.7<\/span> cho Windows/); assert.match(T.vi, /Nếu dùng hằng ngày/);
  assert.match(T.en, /Download test version <span class="nw">0\.16\.0-beta\.2\.7<\/span> for Windows/);
  assert.ok(!/<\/span>\s+beta\b/i.test(T.en), 'en: lặp “beta” sau số phiên bản');
  assert.match(T.zh, /下载 <span class="nw">0\.16\.0-beta\.2\.7<\/span> 测试版（Windows）/); assert.ok(!/试用版/.test(T.zh)); assert.match(T.zh, /测试版可能仍有错误，也不会自动更新/);
  for (const [l, t] of Object.entries(T)) {
    assert.ok(!/beta <span class="nw">0\.16\.0-beta|beta 0\.16\.0-beta/i.test(t), l + ': lặp “beta”');
    assert.match(t, /<span class="nw">SHA-256[:：]<\/span>/, l); assert.ok(t.includes(SHA), l); assert.match(t, /class="beta-mnote">📱 [^<]*Windows/, l);
    assert.match(t, /<a class="beta-link" href="[^"]+"[^>]*>🧪 [\s\S]*<span class="beta-size">· (~|约 )245 MB<\/span><\/a>/, l);
  }
  assert.match(h, /\.beta-dl \.beta-link\{display:block;min-height:44px/); assert.match(h, /\.beta-dl \.nw\{white-space:nowrap\}/);
  assert.match(h, /html\.is-mobile \.beta-dl \.beta-mnote\{display:block\}/); assert.match(h, /e\.preventDefault\(\)/);
  assert.strictEqual((h.match(/<!--AIVN-BETA-->/g) || []).length, 1);
});
test('B143: iPhone/iPad/Android không bị nhận là mac/linux; iPadOS (MacIntel + cảm ứng) là điện thoại/máy tính bảng', () => {
  for (const f of [live(), tmpl().f]) {
    fixes(f, f.includes('b140t') ? [] : ['--sizes', '240075606,259835253,272736118']); const h = fs.readFileSync(f, 'utf8');
    const line = h.split('\n').find(l => l.includes('var os=')); assert.ok(line);
    assert.ok(!/mac\|iphone\|ipad/.test(line), 'còn coi iPhone/iPad là mac');
    const run = (ua, platform, touch) => { const cls = { add() {}, toggle(_, v) { cls.on = v; } };
      const g = { navigator: { userAgent: ua, platform, maxTouchPoints: touch }, document: { documentElement: { classList: cls } } };
      const src = line.trim() + '; return {os, phone};'; const r = new Function('navigator', 'document', 'ua', src)(g.navigator, g.document, platform.toLowerCase()); return r; };
    assert.deepStrictEqual(run('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5), { os: null, phone: true });
    assert.deepStrictEqual(run('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 'MacIntel', 5), { os: null, phone: true });
    assert.deepStrictEqual(run('Mozilla/5.0 (Linux; Android 14; Pixel 5) Mobile', 'Linux armv8l', 5), { os: null, phone: true });
    assert.deepStrictEqual(run('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0), { os: 'mac', phone: false });
    assert.deepStrictEqual(run('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0), { os: 'windows', phone: false });
  }
});
test('B147: dung lượng thật ở mọi nút/mục tải và title, đủ 3 ngôn ngữ (trang đang chạy); trang mẫu giữ chỗ cho release.sh', () => {
  const f = live(); fixes(f, ['--sizes', '240075606,259835253,272736118']); const h = fs.readFileSync(f, 'utf8'); const D = dict(h);
  assert.ok(!/(~|约 )(233|251|264) MB/.test(h), 'còn dung lượng cũ');
  assert.match(h, /title="Tải bộ cài AIVN cho Windows 10\/11 \(64-bit, ~240 MB\)"/); assert.match(h, /title="Tải AIVN cho macOS 13 trở lên \(Apple Silicon ~260 MB, Intel ~273 MB\)"/);
  assert.match(h, /Chip M1, M2, M3, M4… · ~260 MB/); assert.match(h, /Mac dùng bộ xử lý Intel · ~273 MB/);
  for (const k of ['hero.arm', 'cta.arm']) { assert.match(D.en[k], /chips · ~260 MB/); assert.match(D.zh[k], /芯片 · 约 260 MB/); }
  assert.match(D.en['@title.4'], /~240 MB/); assert.match(D.zh['@title.4'], /约 240 MB/); assert.match(D.en['@title.5'], /~260 MB.*~273 MB/); assert.match(D.zh['@title.5'], /约 260 MB.*约 273 MB/);
  assert.match(D.en['hero.6'], /~273 MB/); assert.match(D.zh['cta.3'], /约 273 MB/);
  const t = tmpl(); fixes(t.f, ['--i18n-dir', t.i18n]); const ht = fs.readFileSync(t.f, 'utf8');
  assert.ok(!/(~|约 )\d+ MB\)?"? *(title|<\/small>)/.test(ht.replace(/~(806|605) MB/g, '')), 'trang mẫu không được ghi cứng dung lượng'); assert.match(ht, /Chip M1, M2, M3, M4… · ~__MB_ARM__ MB/); assert.match(ht, /Mac dùng bộ xử lý Intel · ~__MB_X64__ MB/); // site/: chỉ còn menu Mac ở cuối trang (đầu trang là một nút tải)
  assert.ok(!('hero.arm' in dict(ht).en) && !('@title.5' in dict(ht).en), 'site_fixes thêm lại khoá của hàng nút đầu trang đã gỡ');
});
test('B149: chân trang en/zh dịch nhãn và có phụ đề; dòng ghi công giữ nguyên văn ở mọi nơi', () => {
  for (const f of [live(), tmpl()]) {
    const file = f.f || f; fixes(file, f.f ? ['--i18n-dir', f.i18n] : ['--sizes', '240075606,259835253,272736118']); const h = fs.readFileSync(file, 'utf8'); const D = dict(h);
    assert.match(h, /<span data-i18n="foot\.phone">Điện thoại:<\/span>/); assert.match(h, /<small class="credit-sub" data-i18n="footer\.sub"><\/small>/);
    assert.strictEqual(D.en['foot.phone'], 'Phone:'); assert.strictEqual(D.zh['foot.phone'], '电话：');
    assert.strictEqual(D.en['footer.sub'], '(student at Van Lang University)'); assert.strictEqual(D.zh['footer.sub'], '（文郎大学学生）');
    for (const l of ['en', 'zh']) for (const k of ['footer.2', 'footer.12']) assert.ok(D[l][k].includes(NAME), `${l} ${k}`);
    assert.match(h, /<p data-i18n="footer\.2">Phát triển bởi <b style="color:var\(--accent\)">NGUYỄN NGỌC KHÔI SINH VIÊN VLU<\/b><\/p>/);
    assert.match(h, /\.credit-sub:empty\{display:none\}/);
  }
});
test('B150 + chạy lại không đổi gì: CSS màn ≤ 380 px có một lần; site_fixes/site_beta chạy hai lần cho cùng kết quả', () => {
  const f = live(); const run = () => { fixes(f, ['--sizes', '240075606,259835253,272736118']); beta(f); return fs.readFileSync(f, 'utf8'); };
  const a = run(); const b = run(); assert.strictEqual(a, b);
  assert.strictEqual((a.match(/\/\*AIVN-FIX-320\*\//g) || []).length, 1); assert.match(a, /\.dev-grid>\*,\.privacy>\*\{min-width:0\}/);
});
test('B152/B145: link “Hoặc thử bản thử nghiệm …” (không lặp “beta”) ngay dưới hàng nút tải + câu nhắc trong huy hiệu phiên bản, vi/en/zh; --clear gỡ sạch', () => {
  const f = live(); fixes(f, ['--sizes', '240075606,259835253,272736118']); beta(f); const h = fs.readFileSync(f, 'utf8'); const D = dict(h);
  const iRow = h.indexOf('id="tai-ve"'), iHero = h.indexOf('data-i18n="beta.2"'), iNote = h.indexOf('data-i18n="hero.9"'), iBlock = h.indexOf('id="tai-beta"');
  assert.ok(iRow < iHero && iHero < iNote && iNote < iBlock, 'thứ tự: hàng nút → link beta → ghi chú → khối beta');
  // B174: hai câu theo hệ điều hành — Windows/chưa rõ máy thấy “Hoặc thử …”, máy chưa có tệp của bản beta thấy “… chỉ có cho Windows”
  assert.match(h, /<p class="beta-hero" data-i18n="beta\.2"><a href="#tai-beta"><span class="bh-any">🧪 Hoặc thử bản thử nghiệm <span class="nw">0\.16\.0-beta\.2\.7<\/span> →<\/span><span class="bh-nowin">🧪 Bản thử nghiệm <span class="nw">0\.16\.0-beta\.2\.7<\/span> hiện chỉ có cho Windows →<\/span><\/a><\/p>/);
  assert.match(D.en['beta.2'], /^<a href="#tai-beta"><span class="bh-any">🧪 Or try the test version <span class="nw">0\.16\.0-beta\.2\.7<\/span> →<\/span><span class="bh-nowin">🧪 Test version <span class="nw">0\.16\.0-beta\.2\.7<\/span> is for Windows only →<\/span><\/a>$/);
  assert.match(D.zh['beta.2'], /^<a href="#tai-beta"><span class="bh-any">🧪 或者试试测试版 <span class="nw">0\.16\.0-beta\.2\.7<\/span> →<\/span><span class="bh-nowin">🧪 测试版 <span class="nw">0\.16\.0-beta\.2\.7<\/span> 目前仅支持 Windows →<\/span><\/a>$/);
  assert.match(h, /data-i18n="hero\.1">[^\n]*Phiên bản 0\.15\.3[^\n]*<!--AIVN-BETA-BADGE--> · Có bản thử nghiệm <span class="nw">0\.16\.0-beta\.2\.7<\/span><!--\/AIVN-BETA-BADGE--><\/span>/);
  assert.match(D.en['hero.1'], /Version 0\.15\.3 .*<!--AIVN-BETA-BADGE--> · <span class="nw">0\.16\.0-beta\.2\.7<\/span> beta available<!--\/AIVN-BETA-BADGE-->$/);
  assert.match(D.zh['hero.1'], /0\.15\.3 版 .*<!--AIVN-BETA-BADGE--> · 已推出 <span class="nw">0\.16\.0-beta\.2\.7<\/span> 测试版<!--\/AIVN-BETA-BADGE-->$/);
  assert.match(h, /\.beta-hero a\{display:inline-block;min-height:44px/); assert.match(h, /#tai-beta\{scroll-margin-top/);
  execFileSync('python3', [path.join(root, 'tools/site_beta.py'), '--html', f, '--clear']); const c = fs.readFileSync(f, 'utf8'); const DC = dict(c);
  assert.ok(!/AIVN-BETA|beta\.2|tai-beta|beta-hero/.test(c), 'gỡ chưa sạch'); assert.ok(!('beta.2' in DC.en) && !/BETA/.test(DC.en['hero.1'] + DC.zh['hero.1']));
  assert.match(c, /data-i18n="hero\.1"><span class="dot"><\/span>Phiên bản 0\.15\.3 · [^<]*<\/span>/);
});
