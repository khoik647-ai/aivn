// B174 (QA, Mac + Safari): trang web đưa tệp .exe của bản beta cho máy Mac → Safari “không thể mở tệp”.
// Khối beta + link đầu trang theo hệ điều hành, dựng từ danh sách tài sản THẬT của release; bản beta từ nay luôn có tệp Mac; hướng dẫn Gatekeeper vi/en/zh.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const vm = require('vm');
const { execFileSync, spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const V = '0.16.0-beta.2.8', TAG = 'v' + V, DL = 'https://github.com/khoik647-ai/aivn/releases/download/';
const A = (name, size, ch, tag = TAG) => ({ name, size, digest: 'sha256:' + ch.repeat(64), url: DL + tag + '/' + name });
const EXE = A(`AIVN-Setup-${V}.exe`, 245012768, 'a'), ARM = A(`AIVN-${V}-arm64-mac.zip`, 267701414, 'b'), X64 = A(`AIVN-${V}-x64-mac.zip`, 280600852, 'c');
const STABLE = { version: '0.15.3', assets: [A('AIVN-0.15.3-arm64-mac.zip', 259835253, 'd', 'v0.15.3'), A('AIVN-0.15.3-x64-mac.zip', 272736118, 'e', 'v0.15.3'), A('AIVN-mac-arm64.zip', 259835253, 'd', 'v0.15.3'), A('AIVN-Setup.exe', 240075606, 'f', 'v0.15.3')] };
const dict = (h) => JSON.parse(h.split('/*I18N*/')[1].split('/*END*/')[0]);
function build(assets, { stable = STABLE } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b174-')); const f = path.join(d, 'index.html');
  fs.copyFileSync(path.join(__dirname, 'fixtures/site-live-0.15.3.html'), f);
  fs.writeFileSync(path.join(d, 'beta.json'), JSON.stringify({ assets })); fs.writeFileSync(path.join(d, 'stable.json'), JSON.stringify(stable));
  const args = [path.join(root, 'tools/site_beta.py'), '--html', f, '--version', V, '--assets', path.join(d, 'beta.json')];
  if (stable) args.push('--stable', path.join(d, 'stable.json'));
  const r = spawnSync('python3', args, { encoding: 'utf8' });
  const h = r.status === 0 ? fs.readFileSync(f, 'utf8') : null;
  return { r, h, T: h && { vi: h.match(/data-i18n="beta\.1"[^>]*>([\s\S]*?)<\/div><script>/)[1], en: dict(h).en['beta.1'], zh: dict(h).zh['beta.1'] } };
}
const hrefs = (t, cls) => [...t.matchAll(new RegExp(`<a class="beta-link${cls}"[^>]*href="([^"]+)"`, 'g'))].map(m => m[1]);

test('B174: beta chỉ có .exe → máy Mac thấy “chỉ có cho Windows” + tệp Mac của bản ổn định 0.15.3 (arm64/x64, tên có phiên bản), không thấy .exe; đủ vi/en/zh', () => {
  const { r, h, T } = build([EXE]); assert.strictEqual(r.status, 0, r.stderr);
  assert.match(h, /data-beta-mac="0"/);
  const ONLY = { vi: 'ℹ️ Bản thử nghiệm hiện chỉ có cho Windows.', en: 'ℹ️ The beta is currently available for Windows only.', zh: 'ℹ️ 测试版目前仅提供 Windows 版本。' };
  for (const l of ['vi', 'en', 'zh']) {
    const t = T[l]; assert.ok(t.includes(`<span class="beta-onlywin">${ONLY[l]}</span>`), l);
    assert.deepStrictEqual(hrefs(t, ' beta-mac-link'), [DL + 'v0.15.3/AIVN-0.15.3-arm64-mac.zip', DL + 'v0.15.3/AIVN-0.15.3-x64-mac.zip'], l);
    assert.match(t, /<div class="beta-sec beta-win"><a class="beta-link" href="[^"]+\.exe"/, l);   // .exe chỉ nằm trong phần Windows
    assert.ok(!/beta-mac[^]*\.exe/.test(t.split('beta-sec beta-mac')[1].split('beta-mnote')[0]), l + ': phần Mac có .exe');
    assert.match(t, /0\.15\.3/); assert.match(t, l === 'zh' ? /约 260 MB/ : /~260 MB/);
  }
  assert.match(T.vi, /Trên Mac, bạn hãy dùng bản ổn định 0\.15\.3:/); assert.match(T.en, /On a Mac, please use the stable version 0\.15\.3:/); assert.match(T.zh, /在 Mac 上请使用稳定版 0\.15\.3：/);
  // CSS: Mac/điện thoại/Linux không bao giờ thấy phần .exe; Windows không thấy phần Mac; Chrome biết chip → chỉ một tệp Mac
  for (const sel of ['html.beta-os-mac .beta-dl .beta-win', 'html.is-mobile .beta-dl .beta-win', 'html.beta-os-linux .beta-dl .beta-win']) assert.ok(h.includes(sel), sel);
  assert.match(h, /html\.beta-os-win \.beta-dl \.beta-mac,html\.beta-os-linux \.beta-dl \.beta-mac,html\.beta-os-android \.beta-dl \.beta-mac,html\.beta-os-ios \.beta-dl \.beta-mac\{display:none\}/);
  assert.match(h, /html\.beta-arch-arm64 \.beta-dl \.beta-mac-link\[data-arch=x64\]/);
  // link đầu trang: câu “chỉ có cho Windows” cho Mac (chưa có tệp Mac), điện thoại, Linux
  assert.match(h, /"mac":1,"ios":1,"android":1,"linux":1/);
  assert.match(dict(h).en['beta.2'], /<span class="bh-nowin">🧪 Test version <span class="nw">0\.16\.0-beta\.2\.8<\/span> is for Windows only →<\/span>/);
});
test('B174: beta có đủ tệp Mac → link Mac trỏ đúng tệp beta theo chip, đủ SHA-256 ba tệp, không còn câu “chỉ có cho Windows” cho Mac', () => {
  const { r, h, T } = build([EXE, ARM, X64, A(`AIVN-${V}-arm64-mac.zip.blockmap`, 1, '9')]); assert.strictEqual(r.status, 0, r.stderr);
  assert.match(h, /data-beta-mac="1"/); assert.match(h, /"mac":0,"ios":1/);
  for (const l of ['vi', 'en', 'zh']) {
    const t = T[l]; assert.deepStrictEqual(hrefs(t, ' beta-mac-link'), [ARM.url, X64.url], l); assert.ok(!t.includes('beta-onlywin'), l);
    for (const c of ['a', 'b', 'c']) assert.ok(t.includes(c.repeat(64)), `${l}: thiếu SHA-256 ${c}`);
    assert.match(t, l === 'zh' ? /约 268 MB/ : /~268 MB/); assert.match(t, l === 'zh' ? /约 281 MB/ : /~281 MB/);
  }
  assert.match(T.vi, /Tải bản thử nghiệm <span class="nw">0\.16\.0-beta\.2\.8<\/span> cho Mac Apple Silicon/); assert.match(T.en, /Download test version <span class="nw">0\.16\.0-beta\.2\.8<\/span> for Intel Mac/); assert.match(T.zh, /（Intel 芯片 Mac）/);
  for (const l of ['vi', 'en', 'zh']) assert.ok(!/<\/span>\s+beta\b/i.test(T[l]), l + ': lặp “beta” sau số phiên bản');
});
test('B174: chỉ có MỘT tệp Mac, thiếu .exe, hay bản ổn định thiếu tệp Mac → từ chối (không đăng nửa vời)', () => {
  assert.notStrictEqual(build([EXE, ARM]).r.status, 0);
  assert.notStrictEqual(build([ARM, X64]).r.status, 0);
  assert.notStrictEqual(build([EXE], { stable: { version: '0.15.3', assets: [STABLE.assets[0]] } }).r.status, 0);
});
test('B174: hướng dẫn Gatekeeper vi/en/zh cạnh tệp Mac (Xong → Quyền riêng tư & Bảo mật → Vẫn mở; macOS 13–14 nhấp phải → Mở), và trong docs/mac-gatekeeper.md', () => {
  const { T } = build([EXE]); const doc = fs.readFileSync(path.join(root, 'docs/mac-gatekeeper.md'), 'utf8');
  const K = { vi: ['Cài đặt hệ thống › Quyền riêng tư &amp; Bảo mật', '<b>Vẫn mở</b>', '<b>Xong</b>', 'nhấp phải', 'macOS 15'], en: ['System Settings › Privacy &amp; Security', '<b>Open Anyway</b>', '<b>Done</b>', 'right-click', 'macOS 15'], zh: ['系统设置 › 隐私与安全性', '<b>仍要打开</b>', '<b>完成</b>', '右键点按', 'macOS 15'] };
  for (const l of ['vi', 'en', 'zh']) {
    const gk = T[l].split('<details class="beta-gk">')[1]; assert.ok(gk, l); assert.strictEqual((gk.match(/<li>/g) || []).length, 4, l);
    for (const k of K[l]) { assert.ok(gk.includes(k), `${l}: ${k}`); assert.ok(doc.includes(k.replace(/&amp;/g, '&').replace(/<\/?b>/g, '**')), `doc ${l}: ${k}`); }
    assert.ok(gk.includes('xattr -dr com.apple.quarantine /Applications/AIVN.app'), l);
  }
});
test('B174: nhận hệ điều hành — Safari trên Mac (M… hay Intel đều báo MacIntel), iPhone, iPad, Android, Linux, Windows', () => {
  const { h } = build([EXE]); const js = h.split('<!--AIVN-BETA-->')[1].split('<!--/AIVN-BETA-->')[0].match(/<script>([\s\S]*?)<\/script>/)[1];
  const run = (ua, platform, touch = 0, uad) => { const cls = new Set();
    const ctx = { navigator: { userAgent: ua, platform, maxTouchPoints: touch, userAgentData: uad }, document: { documentElement: { classList: { add: (c) => cls.add(c) } }, addEventListener() {} } };
    vm.runInNewContext(js, ctx); return [...cls].sort().join(' '); };
  const SAF = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  assert.strictEqual(run(SAF, 'MacIntel'), 'beta-nowin beta-os-mac');
  assert.strictEqual(run('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1', 'iPhone', 5), 'beta-nowin beta-os-ios is-mobile');
  assert.strictEqual(run(SAF, 'MacIntel', 5), 'beta-nowin beta-os-ios is-mobile', 'iPad báo MacIntel + cảm ứng');
  assert.strictEqual(run('Mozilla/5.0 (Linux; Android 14; Pixel 5) Mobile', 'Linux armv8l', 5), 'beta-nowin beta-os-android is-mobile');
  assert.strictEqual(run('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64'), 'beta-nowin beta-os-linux');
  assert.strictEqual(run('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32'), 'beta-os-win');
});
test('B174: publish-beta-site.sh dựng khối từ tài sản thật (beta + Latest), kiểm SHA-256 từng tệp; site_check có Mac Safari arm64/Intel, iPhone, Windows', () => {
  const p = fs.readFileSync(path.join(root, 'tools/publish-beta-site.sh'), 'utf8');
  assert.match(p, /site_beta\.py" --html "\$W\/ghp\/index\.html" --version "\$VER" --assets "\$W\/beta\.json" --stable "\$W\/stable\.json"/);
  assert.match(p, /for N in "\$\{CHECK\[@\]\}"/); assert.match(p, /grep -q 'beta-gk'/); assert.match(p, /latest\.\*\\\\\.yml/);
  const c = fs.readFileSync(path.join(root, 'tools/site_check.py'), 'utf8');
  for (const n of ["'mac-safari-arm64-1280'", "'mac-safari-intel-1280'", "'mac-chrome-arm64-1280'", "'iphone-375'", "'desktop-1280'", "'linux-1280'", "'ipad-810'", "'ipados-mac-820'"]) assert.ok(c.includes(n), n);
  assert.match(c, /vẫn được mời tải \.exe/);
  assert.match(c, /kind in \('mac', 'mac-arm64'\)/); assert.ok(!/kind in \('mac', 'mac-arm64', 'ios'\)/.test(c), 'site_check vẫn đòi iPhone hiện link Mac');
});
test('B174: release.sh — bản beta luôn build + đính tệp Mac, từ chối khi thiếu, không bao giờ đính latest*.yml, đăng prerelease không Latest', () => {
  const s = fs.readFileSync(path.join(root, 'release.sh'), 'utf8');
  assert.match(s, /BNEED=\( "dist\/AIVN-Setup-\$VERSION\.exe" "dist\/AIVN-\$VERSION-arm64-mac\.zip" "dist\/AIVN-\$VERSION-x64-mac\.zip" \)/);
  assert.match(s, /die "bản beta thiếu \$f/); assert.match(s, /die "bản beta không được có latest\*\.yml"/);
  assert.match(s, /\[\[ "\$BETA" == 1 \]\] \|\| node build\/gen-latest-mac\.cjs/);
  assert.match(s, /--prerelease --latest=false/); assert.match(s, /Latest đã đổi khỏi/); assert.match(s, /tools\/publish-beta-site\.sh "\$OWNER" "\$TAG"/);
  assert.match(s, /-c\.extraMetadata\.version=\$AIVN_VERSION/); assert.match(s, /AIVN_VERSION="\$VERSION" node build\/mac-build\.cjs/);
  assert.match(fs.readFileSync(path.join(root, 'build/mac-build.cjs'), 'utf8'), /extraMetadata: \{ \.\.\.\(base\.extraMetadata \|\| \{\}\), version: VERSION \}/);
  // khối beta nằm TRƯỚC phần bản ổn định (latest.yml, --latest, ghi đè gh-pages)
  assert.ok(s.indexOf('if [[ "$BETA" == 1 ]]; then\n  step "Bản beta') < s.indexOf('"dist/latest.yml"'));
});
