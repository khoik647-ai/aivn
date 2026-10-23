'use strict';
// Một nút “Tải AIVN bản mới nhất” (site/index.html, window.AIVNDL): chọn release qua API GitHub theo cờ INCLUDE_PRERELEASE,
// bỏ bản nháp, nhãn Beta cho prerelease, lùi về bản cũ hơn khi thiếu tệp cho máy này, và giữ link tĩnh khi API lỗi/bị giới hạn.
// Dữ liệu: test/fixtures/site-releases-api.json = API thật ngày 23/10/2026 (lấy khi đã đăng nhập nên có cả bản nháp).
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const { spawnSync, execFileSync } = require('child_process'); const os = require('os');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
const API = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/site-releases-api.json'), 'utf8'));
const LIB = html.match(/<script>\/\*AIVN-DL-LATEST\*\/([\s\S]*?)<\/script>/)[1];
const D = JSON.parse(html.split('/*I18N*/')[1].split('/*END*/')[0]);
function lib(flag, extra = {}) {
  const src = flag === undefined ? LIB : LIB.replace(/var INCLUDE_PRERELEASE=(true|false);/, `var INCLUDE_PRERELEASE=${flag};`);
  const mem = {}; const ctx = { window: {}, Date, JSON, Promise, setTimeout, clearTimeout, AbortController,
    ...extra };
  ctx.window.sessionStorage = extra.sessionStorage || { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  vm.createContext(ctx); vm.runInContext(src, ctx); return ctx.window.AIVNDL;
}
const ok = (body) => async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });
const names = (p) => p && [p.rel.tag_name, p.asset.name];

test('cờ INCLUDE_PRERELEASE mặc định là true, nằm đầu script, API /releases, link dự phòng là trang releases (không phải /latest)', () => {
  assert.match(LIB, /^\s*window\.AIVNDL=\(function\(\)\{[\s\S]{0,400}var INCLUDE_PRERELEASE=true;/);
  const L = lib(); assert.strictEqual(L.INCLUDE_PRERELEASE, true);
  assert.match(L.API, /^https:\/\/api\.github\.com\/repos\/khoik647-ai\/aivn\/releases\?/);
  assert.strictEqual(L.FALLBACK, 'https://github.com/khoik647-ai/aivn/releases');
});

test('cờ bật: chọn bản thử nghiệm mới nhất (v0.16.0-beta.3) và đúng tệp có số phiên bản cho Windows / Mac Apple Silicon / Mac Intel', async () => {
  const L = lib(true); await L.resolve(ok(API));
  assert.strictEqual(L.state.state, 'ok'); assert.strictEqual(L.newest().tag_name, 'v0.16.0-beta.3'); assert.strictEqual(L.newest().prerelease, true);
  assert.deepStrictEqual(names(L.target('windows', null)), ['v0.16.0-beta.3', 'AIVN-Setup-0.16.0-beta.3.exe']);
  assert.deepStrictEqual(names(L.target('mac', 'arm64')), ['v0.16.0-beta.3', 'AIVN-0.16.0-beta.3-arm64-mac.zip']);
  assert.deepStrictEqual(names(L.target('mac', 'x64')), ['v0.16.0-beta.3', 'AIVN-0.16.0-beta.3-x64-mac.zip']);
  assert.deepStrictEqual(names(L.target('mac', null)), ['v0.16.0-beta.3', 'AIVN-0.16.0-beta.3-arm64-mac.zip'], 'không rõ chip → mặc định Apple Silicon');
  assert.match(L.target('windows').asset.url, /^https:\/\/github\.com\/khoik647-ai\/aivn\/releases\/download\/v0\.16\.0-beta\.3\/AIVN-Setup-0\.16\.0-beta\.3\.exe$/);
});

test('cờ tắt: chọn bản “Latest” của GitHub (v0.15.3, không phải prerelease) và tệp có số phiên bản, không lấy .blockmap/.yml', async () => {
  const L = lib(false); await L.resolve(ok(API));
  assert.strictEqual(L.newest().tag_name, 'v0.15.3'); assert.strictEqual(L.newest().prerelease, false);
  assert.deepStrictEqual(names(L.target('windows')), ['v0.15.3', 'AIVN-Setup-0.15.3.exe']);
  assert.deepStrictEqual(names(L.target('mac', 'arm64')), ['v0.15.3', 'AIVN-0.15.3-arm64-mac.zip']);
  assert.deepStrictEqual(names(L.target('mac', 'x64')), ['v0.15.3', 'AIVN-0.15.3-x64-mac.zip']);
});

test('bỏ bản nháp: bản nháp mới hơn (kể cả bản nháp không phải prerelease) không bao giờ được chọn', async () => {
  const drafts = API.filter((r) => r.draft); assert.ok(drafts.length >= 1 && drafts.some((r) => !r.prerelease), 'dữ liệu mẫu cần có bản nháp');
  const fresh = { ...API[API.length - 1], tag_name: 'v9.9.9', draft: true, prerelease: false, published_at: '2030-01-01T00:00:00Z',
    assets: [{ name: 'AIVN-Setup-9.9.9.exe', size: 1, browser_download_url: 'https://github.com/khoik647-ai/aivn/releases/download/v9.9.9/AIVN-Setup-9.9.9.exe' }] };
  for (const flag of [true, false]) {
    const L = lib(flag); await L.resolve(ok([fresh, ...API]));
    assert.ok(!L.candidates([fresh, ...API], flag).some((r) => r.draft), 'còn bản nháp');
    assert.strictEqual(L.newest().tag_name, flag ? 'v0.16.0-beta.3' : 'v0.15.3');
    assert.notStrictEqual(L.target('windows').rel.tag_name, 'v9.9.9');
  }
  assert.strictEqual(lib(true).pickRelease(drafts, true), null);
});

test('bản mới nhất thiếu tệp cho máy này → lùi về bản cũ hơn (không nháp) có tệp, và hiện số phiên bản của bản đó', async () => {
  // Như v0.16.0-beta.2.7 (chỉ có .exe): bản mới nhất không có tệp Mac
  const noMac = API.filter((r) => r.tag_name !== 'v0.16.0-beta.3' && r.tag_name !== 'v0.16.0-beta.2.8');
  const L = lib(true); await L.resolve(ok(noMac));
  assert.strictEqual(L.newest().tag_name, 'v0.16.0-beta.2.7');
  assert.deepStrictEqual(names(L.target('windows')), ['v0.16.0-beta.2.7', 'AIVN-Setup-0.16.0-beta.2.7.exe']);
  assert.deepStrictEqual(names(L.target('mac', 'arm64')), ['v0.15.3', 'AIVN-0.15.3-arm64-mac.zip']);
  assert.strictEqual(L.urlFor('x64'), 'https://github.com/khoik647-ai/aivn/releases/download/v0.15.3/AIVN-0.15.3-x64-mac.zip');
  // link tải phải là tệp của đúng kho trên github.com
  const evil = [{ tag_name: 'v1.0.0', draft: false, prerelease: false, published_at: '2030-01-01T00:00:00Z', assets: [{ name: 'AIVN-Setup-1.0.0.exe', browser_download_url: 'https://evil.example/AIVN-Setup-1.0.0.exe' }] }, ...API];
  const E = lib(false); await E.resolve(ok(evil)); assert.strictEqual(E.target('windows').rel.tag_name, 'v0.15.3');
  // linux / điện thoại / chưa rõ máy: không có tệp nào
  assert.strictEqual(L.target('linux'), null); assert.strictEqual(L.target(null), null);
});

test('nhãn Beta cho prerelease: có chữ “Beta” ở cả vi/en/zh, chỉ hiện khi data-pre="1"', () => {
  const vi = html.match(/<span class="dl-beta" data-i18n="dl\.5">([^<]*)<\/span>/)[1];
  assert.strictEqual(vi, 'Beta · bản thử nghiệm'); assert.strictEqual(D.en['dl.5'], 'Beta · pre-release'); assert.strictEqual(D.zh['dl.5'], 'Beta · 测试版');
  for (const t of [vi, D.en['dl.5'], D.zh['dl.5']]) assert.match(t, /Beta/);
  assert.match(html, /\.dl-beta\{display:none;/); assert.match(html, /\.dl\[data-pre="1"\] \.dl-beta\{display:inline-block\}/);
  assert.match(html, /row\.setAttribute\('data-pre',rel&&rel\.prerelease\?'1':'0'\)/);
  const keys = Object.keys(D.en); assert.deepStrictEqual(keys.slice(keys.indexOf('dl.2'), keys.indexOf('dl.2') + 20), Array.from({ length: 20 }, (_, i) => 'dl.' + (i + 2)), 'khoá mới thêm ở cuối, theo thứ tự');
});

test('dự phòng: API lỗi / bị giới hạn (403) / hết giờ / trả rác → trạng thái fail, giữ link tĩnh trong trang, có link tới trang releases', async () => {
  const cases = [async () => { throw new TypeError('Failed to fetch'); }, async () => ({ ok: false, status: 403, json: async () => ({ message: 'API rate limit exceeded' }) }),
    ok({ message: 'Not Found' }), ok([]), ok(API.filter((r) => r.draft))];
  for (const f of cases) { const L = lib(true); await L.resolve(f); assert.strictEqual(L.state.state, 'fail'); assert.strictEqual(L.target('windows'), null); assert.strictEqual(L.newest(), null); }
  const T = lib(true, {}); const t0 = Date.now(); const L = T; const never = () => new Promise(() => {});
  const r = await L.resolve(never); assert.strictEqual(r.state, 'fail'); assert.ok(Date.now() - t0 < L.TIMEOUT_MS + 1500 && L.TIMEOUT_MS <= 4000, 'hết giờ ~3,5 s');
  // link tĩnh: nút chính là bộ cài (release.sh đổi thành releases/latest/download), các bản khác là zip ổn định, dòng lỗi có link releases
  assert.match(html, /<a aria-describedby="dl-sub" class="dl-main" href="AIVN-Setup\.exe">/);
  assert.match(html, /class="o-arm" data-k="arm64" href="AIVN-mac-arm64\.zip"/); assert.match(html, /class="o-x64" data-k="x64" href="AIVN-mac-x64\.zip"/);
  for (const t of [html.match(/data-i18n="dl\.6">([\s\S]*?)<\/span>/)[1], D.en['dl.6'], D.zh['dl.6']]) assert.ok(t.includes('href="https://github.com/khoik647-ai/aivn/releases"'), t);
  assert.match(html, /else if\(p\)main\.href=p\.asset\.url;/, 'chỉ nâng cấp link khi API OK');
});

test('nhớ kết quả trong sessionStorage: lần sau trong phiên không gọi API nữa (giới hạn 60 lần/giờ)', async () => {
  const mem = {}; const ss = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  let calls = 0; const f = async (...a) => { calls++; return ok(API)(...a); };
  await lib(true, { sessionStorage: ss }).resolve(f); assert.strictEqual(calls, 1);
  const L2 = lib(true, { sessionStorage: ss }); await L2.resolve(f); assert.strictEqual(calls, 1); assert.strictEqual(L2.newest().tag_name, 'v0.16.0-beta.3');
  const L3 = lib(true, { sessionStorage: ss }); await L3.resolve(f, Date.now() + 60 * 60 * 1000); assert.strictEqual(calls, 2, 'hết hạn thì gọi lại');
  const bad = lib(true, { sessionStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  await bad.resolve(ok(API)); assert.strictEqual(bad.state.state, 'ok');
});

test('một đường tải duy nhất: không còn khối beta riêng; nút đầu trang chỉ là neo #tai-ve; dòng ghi công giữ nguyên', () => {
  assert.ok(!/AIVN-BETA|beta-dl|tai-beta/.test(html), 'còn khối beta');
  assert.strictEqual((html.match(/class="dl-main"/g) || []).length, 1);
  assert.ok(!/data-dl-direct|function directUrl/.test(html), 'nút đầu trang vẫn tải thẳng tệp');
  assert.strictEqual((html.match(/maxTouchPoints/g) || []).length, 1, 'chỉ một bộ nhận diện máy');
  assert.ok(html.includes('NGUYỄN NGỌC KHÔI SINH VIÊN VLU'));
  const gk = html.match(/<details class="dl-gk" data-i18n="dl\.20">([\s\S]*?)<\/details>/)[1];
  assert.strictEqual((gk.match(/<li>/g) || []).length, 4); assert.match(gk, /Vẫn mở/); assert.match(D.en['dl.20'], /Open Anyway/);
});

test('Linux / máy tính không rõ hệ điều hành: nút chính không bao giờ là .exe mà trỏ trang Releases, có ghi chú “chưa có bản Linux”, giữ link nhỏ Windows/Mac, không còn link Linux chết href="#"', async () => {
  assert.match(html, /else if\(kind==='linux'\|\|kind==='other'\)main\.href=DLX\.FALLBACK;/);
  assert.ok(!html.includes("main.href='#tai-ve-khac'"), 'nút chính Linux không còn chỉ cuộn trong trang');
  const L = lib(); assert.strictEqual(L.FALLBACK, 'https://github.com/khoik647-ai/aivn/releases');
  await L.resolve(ok(API)); assert.strictEqual(L.state.state, 'ok');
  assert.strictEqual(L.target('linux', null), null, 'Linux không bao giờ nhận tệp cài'); assert.strictEqual(L.target(null, null), null);
  assert.strictEqual(L.target('windows', null).asset.name, 'AIVN-Setup-0.16.0-beta.3.exe');
  // nhãn nút chính và ghi chú, đủ vi/en/zh
  assert.match(html, /<span class="dl-l-choose" data-i18n="dl\.4">Xem các bản AIVN trên GitHub<\/span>/);
  assert.strictEqual(D.en['dl.4'], 'See AIVN releases on GitHub'); assert.strictEqual(D.zh['dl.4'], '在 GitHub 查看 AIVN 各版本');
  assert.match(html, /<p class="dl-lnx" data-i18n="dl\.14">AIVN chưa có bản Linux\./); assert.match(D.en['dl.14'], /not available for Linux/); assert.match(D.zh['dl.14'], /Linux/);
  assert.match(html, /\.dl\[data-os=other\] \.dl-l-latest\{display:none\}\.dl\[data-os=other\] \.dl-l-choose\{display:inline\}/);
  assert.match(html, /\.dl\[data-os=linux\] \.dl-lnx,\.dl\[data-os=other\]\.is-linux \.dl-lnx\{display:block;/);
  // link nhỏ Windows/Mac vẫn còn (link tĩnh release.sh viết lại); link “bản Intel” chỉ hiện cho Mac không rõ chip
  const other = html.match(/<p class="dl-other" id="tai-ve-khac">([\s\S]*?)<\/p>/)[1];
  for (const h of ['AIVN-Setup.exe', 'AIVN-mac-arm64.zip', 'AIVN-mac-x64.zip']) assert.ok(other.includes(`href="${h}"`), h);
  assert.match(html, /\.dl-other a\.o-intelq\{display:none\}\n\.dl\[data-os=mac\]\[data-arch=unknown\] \.o-intelq\{display:inline-flex\}/);
  // hàng nút cuối trang: Linux là chữ “sắp ra mắt”, không phải link chết
  assert.match(html, /<span aria-disabled="true" class="btn dl-btn soon" data-i18n="cta\.5"[^>]*data-os="linux"/);
  assert.ok(!/<a[^>]*data-os="linux"[^>]*>/.test(html) && !/<a[^>]*href="#"[^>]*data-os="linux"/.test(html), 'còn link Linux href="#"');
});

function spec(sel) {
  let a = 0, b = 0, c = 0, i = 0;
  while (i < sel.length) {
    if (sel[i] === '#') { a++; i++; while (/[\w-]/.test(sel[i] || '')) i++; }
    else if (sel[i] === '.') { b++; i++; while (/[\w-]/.test(sel[i] || '')) i++; }
    else if (sel[i] === '[') { b++; i = sel.indexOf(']', i) + 1; }
    else if (sel[i] === ':' && sel[i + 1] !== ':') { b++; i++; while (/[\w()-]/.test(sel[i] || '')) i++; }
    else if (/[a-z*]/i.test(sel[i])) { c++; i++; while (/[\w-]/.test(sel[i] || '')) i++; }
    else i++;
  }
  return [a, b, c];
}
const cmpSpec = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

test('Gatekeeper: .dl-other a không được hiện .dl-gklink trên Windows/Linux; Mac vẫn thắng', () => {
  assert.match(html, /\.dl-other a\.dl-gklink\{display:none\}/);
  assert.match(html, /\.dl\[data-os=mac\] \.dl-gklink\{display:inline-flex\}/);
  assert.ok(html.indexOf('.dl-other a.dl-gklink{display:none}') < html.indexOf('.dl[data-os=mac] .dl-gklink{display:inline-flex}'));
  const broad = spec('.dl-other a'), hide = spec('.dl-other a.dl-gklink'), mac = spec('.dl[data-os=mac] .dl-gklink');
  assert.ok(cmpSpec(hide, broad) > 0, `ẩn ${hide} phải hơn ${broad}`);
  assert.ok(cmpSpec(mac, hide) > 0, `Mac ${mac} phải hơn ${hide} để vẫn hiện`);
  assert.match(html, /<p class="dl-other"><a class="dl-gklink" href="#mo-tren-mac">/);
  assert.ok(!/DLX\.newest\(\)/.test(html), 'dòng phiên bản không lấy newest() khi p null');
});

test('không có tệp cho máy này: không lấy phiên bản từ newest(); nút, href và dòng phụ cùng một bản', async () => {
  const strip = (list) => list.map((r) => ({ ...r, assets: [] }));
  const L = lib(true); await L.resolve(ok(strip(API)));
  assert.strictEqual(L.newest().tag_name, 'v0.16.0-beta.3', 'newest() vẫn là beta — không được đưa lên dòng phụ');
  assert.strictEqual(L.target('windows'), null);
  for (const href of ['AIVN-Setup.exe', 'https://github.com/khoik647-ai/aivn/releases/latest/download/AIVN-Setup.exe']) {
    const v = L.viewFor('windows', null, href);
    assert.strictEqual(v.state, 'ok'); assert.strictEqual(v.fallback, true); assert.strictEqual(v.asset, null);
    assert.strictEqual(v.rel.tag_name, 'v0.15.3'); assert.strictEqual(v.rel.prerelease, false);
  }
  const mac = L.viewFor('mac', 'x64', 'AIVN-mac-x64.zip');
  assert.strictEqual(mac.rel.tag_name, 'v0.15.3'); assert.strictEqual(mac.fallback, true);
  const named = L.viewFor('windows', null, 'https://github.com/khoik647-ai/aivn/releases/download/v0.15.2/AIVN-Setup-0.15.2.exe');
  assert.strictEqual(named.rel.tag_name, 'v0.15.2'); assert.strictEqual(named.rel.prerelease, false);
  const betas = API.filter((r) => r.prerelease && !r.draft).map((r) => ({ ...r, assets: [] }));
  const B = lib(true); await B.resolve(ok(betas));
  assert.strictEqual(B.newest().tag_name, 'v0.16.0-beta.3');
  const fail = B.viewFor('windows', null, 'AIVN-Setup.exe');
  assert.strictEqual(fail.state, 'fail'); assert.strictEqual(fail.rel, null); assert.strictEqual(fail.fallback, true);
  const evil = L.viewFor('windows', null, 'https://evil.example/AIVN-Setup.exe');
  assert.strictEqual(evil.state, 'fail'); assert.strictEqual(evil.rel, null);
  const lin = L.viewFor('linux', null, null);
  assert.strictEqual(lin.state, 'ok'); assert.strictEqual(lin.rel, null, 'Linux không hiện newest()');
  const has = lib(true); await has.resolve(ok(API));
  const okWin = has.viewFor('windows', null, 'AIVN-Setup.exe');
  assert.strictEqual(okWin.fallback, false); assert.strictEqual(okWin.rel.tag_name, 'v0.16.0-beta.3');
  assert.match(okWin.asset.name, /AIVN-Setup-0\.16\.0-beta\.3\.exe/);
  const vi = html.match(/data-i18n="dl\.21">([^<]*)</)[1];
  assert.strictEqual(vi, 'Tải AIVN bản ổn định'); assert.ok(!/\blink\b/i.test(vi), 'tiếng Việt không dùng chữ link');
  assert.strictEqual(D.en['dl.21'], 'Download the stable AIVN'); assert.strictEqual(D.zh['dl.21'], '下载稳定版 AIVN');
  assert.match(html, /\.dl\[data-fb="1"\] \.dl-l-latest\{display:none\}\.dl\[data-fb="1"\] \.dl-l-stable\{display:inline\}/);
  assert.match(html, /DLX\.viewFor\(mobile\?null:os,macArch,staticHref\)/);
});

test('INCLUDE_PRERELEASE=true: publish-beta chỉ --clear, không chèn khối beta và không thêm link tải thứ hai', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'nobin-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ghp-'));
  const fixture = path.join(work, 'fixture');
  const cleared = path.join(work, 'cleared.html');
  const gitLog = path.join(work, 'git.log');
  const ghLog = path.join(work, 'gh.log');
  const curlLog = path.join(work, 'curl.log');
  fs.mkdirSync(fixture);
  fs.copyFileSync(path.join(root, 'site/index.html'), path.join(fixture, 'index.html'));
  execFileSync('python3', [path.join(root, 'tools/site_beta.py'), '--html', path.join(fixture, 'index.html'), '--version', '0.16.0-beta.9', '--url', 'https://github.com/khoik647-ai/aivn/releases/download/v0.16.0-beta.9/AIVN-Setup-0.16.0-beta.9.exe', '--sha256', 'ab'.repeat(32), '--size', '1000']);
  assert.match(fs.readFileSync(path.join(fixture, 'index.html'), 'utf8'), /AIVN-BETA/);
  execFileSync('git', ['init', '-q', '-b', 'gh-pages'], { cwd: fixture });
  execFileSync('git', ['-c', 'user.name=AIVN test', '-c', 'user.email=test@aivn.local', 'add', 'index.html'], { cwd: fixture });
  execFileSync('git', ['-c', 'user.name=AIVN test', '-c', 'user.email=test@aivn.local', 'commit', '-q', '-m', 'fixture'], { cwd: fixture });
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(gitLog)}
if [ "$1" = clone ]; then
  dest="\${!#}"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -a ${JSON.stringify(fixture)}/. "$dest"/
  exit 0
fi
if [ "$1" = push ]; then
  cp -f index.html ${JSON.stringify(cleared)}
  echo pushed >> ${JSON.stringify(gitLog)}
  exit 0
fi
exec /usr/bin/git "$@"
`);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(ghLog)}
if [ "$1" = api ]; then echo v0.15.3; exit 0; fi
if [ "$1" = auth ]; then exit 0; fi
if [ "$1" = release ]; then
  case "$*" in
    *v0.16.0-beta.99*) echo "gh bị hỏi bản thử nghiệm" >&2; exit 99;;
  esac
  printf '%s\\n' '{"tagName":"v0.15.3","isDraft":false,"isPrerelease":false,"assets":[{"name":"AIVN-Setup.exe","size":1000000},{"name":"AIVN-mac-arm64.zip","size":2000000},{"name":"AIVN-mac-x64.zip","size":3000000}]}'
  exit 0
fi
echo "gh lạ: $*" >&2
exit 99
`);
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(curlLog)}
case "$*" in
  *releases/download*) echo "curl tải tài sản" >&2; exit 99;;
esac
echo '<html>trang da go khoi beta</html>'
exit 0
`);
  for (const cmd of ['git', 'gh', 'curl']) fs.chmodSync(path.join(bin, cmd), 0o755);
  const before = fs.readFileSync(path.join(root, 'site/index.html'));
  const r = spawnSync('bash', [path.join(root, 'tools/publish-beta-site.sh'), 'khoik647-ai', 'v0.16.0-beta.99'], {
    encoding: 'utf8', cwd: root, timeout: 20000,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, GIT_TERMINAL_PROMPT: '0', SITE_CHECK_PY: '' },
  });
  assert.strictEqual(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  assert.match(r.stdout, /BỎ QUA chèn beta:/); assert.match(r.stdout, /INCLUDE_PRERELEASE=true/);
  assert.match(r.stdout, /--clear/); assert.match(r.stdout, /đã gỡ khối beta/);
  assert.ok(!/releases\/download/.test(fs.readFileSync(curlLog, 'utf8')), 'không tải tài sản bản thử nghiệm');
  assert.ok(!/v0\.16\.0-beta\.99/.test(fs.readFileSync(ghLog, 'utf8')), 'không hỏi GitHub về bản thử nghiệm');
  assert.match(fs.readFileSync(gitLog, 'utf8'), /pushed/);
  const gone = fs.readFileSync(cleared, 'utf8');
  assert.ok(!/AIVN-BETA|beta-link|data-beta-version|tai-beta|AIVN-Setup-0\.16\.0-beta/.test(gone), 'khối beta cũ còn sau --clear');
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'site/index.html')), before);
  const rel = fs.readFileSync(path.join(root, 'release.sh'), 'utf8');
  const iFlag = rel.indexOf("grep -qE 'var INCLUDE_PRERELEASE=true;'");
  const iCall = rel.indexOf('tools/publish-beta-site.sh "$OWNER" "$TAG"');
  const iClear = rel.indexOf('tools/publish-beta-site.sh "$OWNER" --clear');
  assert.ok(iFlag > 0 && iClear > iFlag && iCall > iFlag, 'release.sh phải xét cờ, gọi --clear, và vẫn giữ lời gọi khi cờ tắt');
  // Luồng phát hành: release.sh chỉ đổi href tĩnh; publish-beta không chèn link beta.N.
  const base = 'https://github.com/khoik647-ai/aivn/releases/latest/download';
  const page = before.toString()
    .replaceAll('href="AIVN-Setup.exe"', `href="${base}/AIVN-Setup.exe"`)
    .replaceAll('href="AIVN-mac-arm64.zip"', `href="${base}/AIVN-mac-arm64.zip"`)
    .replaceAll('href="AIVN-mac-x64.zip"', `href="${base}/AIVN-mac-x64.zip"`);
  assert.ok(!/AIVN-BETA|beta-link|data-beta-version|tai-beta|id="tai-beta"/.test(page));
  assert.match(page, /data-os="windows" href="#tai-ve"/);
  assert.match(page, /data-os="mac" href="#tai-ve"/);
  assert.match(page, /title="Xem bản tải cho Windows"/);
  assert.ok(!/\.cta \.dl-btn\[data-os="windows"\]/.test(page), 'nút Windows cuối trang không được tự đổi href thành bộ cài');
  assert.ok(!/\.cta \.mac-menu a\[href\]/.test(page), 'menu macOS cuối trang không được tự đổi href thành zip');
  assert.ok(!/\.cta \.mac-wrap \.mac-menu\{position:static/.test(page));
  assert.ok(!/mac-wrap|mac-toggle|mac-menu/.test(page), 'không còn menu macOS cũ');
  const outside = page.replace(/id="tai-ve"[\s\S]*?<!--\/AIVN-DL-LATEST-->/, '');
  assert.ok(!/href="[^"]*AIVN-Setup[^"]*\.exe"/.test(outside), 'ngoài nút tự động không còn href bộ cài Windows');
  assert.ok(!/href="[^"]*\.zip"/.test(outside), 'ngoài nút tự động không còn href zip');
  const exe = [...page.matchAll(/href="([^"]*AIVN-Setup[^"]*\.exe)"/g)].map((m) => m[1]);
  assert.ok(exe.length >= 1); assert.ok(exe.every((h) => h === `${base}/AIVN-Setup.exe`), exe.join('\n'));
  assert.ok(!exe.some((h) => /-beta/.test(h)), 'không chèn link beta.N');
  const block = page.match(/id="tai-ve"[\s\S]*?<!--\/AIVN-DL-LATEST-->/)[0];
  const shownOnWindows = [...block.matchAll(/<a\b([^>]*)>/g)].map((m) => m[1]).filter((a) => /AIVN-Setup[^"]*\.exe"/.test(a) && !/\bo-win\b/.test(a));
  assert.strictEqual(shownOnWindows.length, 1, 'trên Windows chỉ nút chính trong khối tải trỏ tới bộ cài (bản khác bị ẩn)');
  assert.match(page, /\.dl\[data-t=win\] \.o-win\{display:none\}|\.dl\[data-t=win\] \.o-win,/);
  // site_beta.py vẫn chèn link Windows thứ hai nếu bị gọi — luồng publish không gọi nó khi cờ bật.
  const inj = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'beta-inj-')), 'index.html');
  fs.writeFileSync(inj, page);
  execFileSync('python3', [path.join(root, 'tools/site_beta.py'), '--html', inj, '--version', '0.16.0-beta.9', '--url', 'https://github.com/khoik647-ai/aivn/releases/download/v0.16.0-beta.9/AIVN-Setup-0.16.0-beta.9.exe', '--sha256', 'ab'.repeat(32), '--size', '1000']);
  const injected = [...fs.readFileSync(inj, 'utf8').matchAll(/href="([^"]*AIVN-Setup[^"]*\.exe)"/g)].map((m) => m[1]);
  assert.ok(injected.some((h) => h.includes('AIVN-Setup-0.16.0-beta.9.exe')));
  assert.ok(injected.filter((h) => h.endsWith('/AIVN-Setup.exe')).length === exe.length);
  assert.ok(injected.length > exe.length, 'khối beta thêm link tải — publish-beta khi cờ bật không được làm vậy');
});

test('href tệp tải, sau new URL, phải thuộc https://github.com/khoik647-ai/aivn/releases/', () => {
  const src = fs.readFileSync(path.join(root, 'tools/site_check.py'), 'utf8');
  const start = src.indexOf('/*AIVN-DL-FN*/');
  const end = src.indexOf('/*END-AIVN-DL-FN*/');
  assert.ok(start > 0 && end > start, 'thiếu hàm aivnDl trong site_check');
  const aivnDl = new Function(`${src.slice(start, end)}\nreturn aivnDl;`)();
  const base = 'http://127.0.0.1:8765/index.html';
  const other = 'https://github.com/other-user/not-aivn/releases/download/v1/Other.zip';
  const trav = 'https://github.com/khoik647-ai/aivn/releases/../../../evil/x.zip';
  assert.deepStrictEqual(aivnDl(other, base), { looks: true, ok: false }, 'zip tài khoản khác');
  assert.deepStrictEqual(aivnDl(trav, base), { looks: true, ok: false }, 'href ../ thoát khỏi kho');
  assert.strictEqual(new URL(trav).pathname, '/evil/x.zip');
  const own = 'https://github.com/khoik647-ai/aivn/releases/download/v0.16.0-beta.3/AIVN-Setup-0.16.0-beta.3.exe';
  assert.strictEqual(aivnDl(own, base).ok, true);
  for (const leaf of ['AIVN-Setup.exe', 'AIVN-mac-arm64.zip', 'AIVN-mac-x64.zip']) assert.strictEqual(aivnDl(leaf, base).ok, true, leaf);
  assert.strictEqual(aivnDl('https://github.com/khoik647-ai/aivn/releases', base).looks, false);
});
