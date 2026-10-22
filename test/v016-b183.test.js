// B183: iPhone/iPad (kể cả iPadOS báo Macintosh + cảm ứng) không còn link zip Mac — chỉ dòng 📱. Máy Mac vẫn thấy zip.
// B145: khối beta tiếng Anh không nói “beta” lần nữa sau số phiên bản (vi “bản thử nghiệm”, zh “测试版” cũng không).
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const V = '0.16.0-beta.2.8', DL = 'https://github.com/khoik647-ai/aivn/releases/download/v' + V + '/';
const A = (name, size, ch) => ({ name, size, digest: 'sha256:' + ch.repeat(64), url: DL + name });
let playwright = null;
try { playwright = require('playwright'); } catch { /* máy không cài playwright thì bỏ phần trình duyệt */ }

function build() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b183-')); const f = path.join(d, 'index.html');
  fs.copyFileSync(path.join(__dirname, 'fixtures/site-live-0.15.3.html'), f);
  const assets = [A(`AIVN-Setup-${V}.exe`, 245012768, 'a'), A(`AIVN-${V}-arm64-mac.zip`, 267701414, 'b'), A(`AIVN-${V}-x64-mac.zip`, 280600852, 'c')];
  fs.writeFileSync(path.join(d, 'beta.json'), JSON.stringify({ assets }));
  execFileSync('python3', [path.join(root, 'tools/site_beta.py'), '--html', f, '--version', V, '--assets', path.join(d, 'beta.json')]);
  const h = fs.readFileSync(f, 'utf8');
  const dict = JSON.parse(h.split('/*I18N*/')[1].split('/*END*/')[0]);
  const T = { vi: h.match(/data-i18n="beta\.1"[^>]*>([\s\S]*?)<\/div><script>/)[1], en: dict.en['beta.1'], zh: dict.zh['beta.1'] };
  return { f, T };
}
const noExtraBeta = (t) => !/beta\s+<span class="nw">0\.16\.0-beta|<\/span>\s+beta\b/i.test(t);

test('B145: khối beta en không lặp “beta” sau số phiên bản; vi/zh không thêm chữ beta', () => {
  const { T } = build();
  assert.match(T.en, /Download test version <span class="nw">0\.16\.0-beta\.2\.8<\/span> for Windows/);
  assert.match(T.en, /Download test version <span class="nw">0\.16\.0-beta\.2\.8<\/span> for Mac with Apple silicon \(M1, M2, M3, M4… chips\)/);
  assert.match(T.en, /Download test version <span class="nw">0\.16\.0-beta\.2\.8<\/span> for Intel Mac/);
  assert.match(T.vi, /Tải bản thử nghiệm <span class="nw">0\.16\.0-beta\.2\.8<\/span> cho Windows/);
  assert.match(T.vi, /Tải bản thử nghiệm <span class="nw">0\.16\.0-beta\.2\.8<\/span> cho Mac Apple Silicon/);
  assert.match(T.zh, /下载 <span class="nw">0\.16\.0-beta\.2\.8<\/span> 测试版（Windows）/);
  assert.match(T.zh, /下载 <span class="nw">0\.16\.0-beta\.2\.8<\/span> 测试版（Intel 芯片 Mac）/);
  for (const [l, t] of Object.entries(T)) assert.ok(noExtraBeta(t), l + ': lặp “beta”');
});

test('B183: Playwright iPhone 13 và iPad ẩn link Mac, chỉ còn dòng 📱; máy Mac vẫn thấy zip', { skip: !playwright && 'cần playwright + Chrome', timeout: 120000 }, async () => {
  const { chromium, devices } = playwright;
  for (const name of ['iPhone 13', 'iPad (gen 7)']) assert.ok(devices[name], 'thiếu hồ sơ ' + name);
  const { f } = build();
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f)); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + srv.address().port + '/';
  const nav = (platform, touch) => `Object.defineProperty(Navigator.prototype,'platform',{get:function(){return ${JSON.stringify(platform)}}});Object.defineProperty(Navigator.prototype,'maxTouchPoints',{get:function(){return ${touch}}});Object.defineProperty(Navigator.prototype,'userAgentData',{get:function(){return undefined}});`;
  const ctxOpts = (device) => { const { defaultBrowserType, ...rest } = device; return rest; };
  const ipad = devices['iPad (gen 7)'];
  const macUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const cases = [
    ['iPhone 13', ctxOpts(devices['iPhone 13']), nav('iPhone', 5), false],
    ['iPad (gen 7)', ctxOpts(ipad), nav('iPad', 5), false],
    // iPadOS 13+ tự xưng Macintosh; cảm ứng (maxTouchPoints>1) vẫn là iOS, không phải máy Mac
    ['iPadOS Macintosh+touch', { ...ctxOpts(ipad), userAgent: macUa, isMobile: true, hasTouch: true }, nav('MacIntel', 5), false],
    ['desktop Mac', { viewport: { width: 1280, height: 800 }, userAgent: macUa, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }, nav('MacIntel', 0), true],
  ];
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const [name, opts, init, macZip] of cases) {
      const context = await browser.newContext(opts);
      await context.addInitScript(init);
      const page = await context.newPage();
      const hits = [];
      page.on('request', (r) => { if (/\.(zip|exe)(\?|$)/i.test(r.url())) hits.push(r.url()); });
      page.on('download', (d) => hits.push('DOWNLOAD ' + d.url()));
      await page.goto(url, { waitUntil: 'load' });
      const cls = await page.evaluate(() => document.documentElement.className);
      const links = page.locator('.beta-dl .beta-link');
      const n = await links.count();
      const visible = [];
      for (let i = 0; i < n; i++) if (await links.nth(i).isVisible()) visible.push(await links.nth(i).getAttribute('href'));
      const mnote = page.locator('.beta-dl .beta-mnote');
      if (macZip) {
        assert.match(cls, /beta-os-mac/, name + ' ' + cls);
        assert.ok(!/is-mobile|beta-os-ios/.test(cls), name + ' ' + cls);
        assert.strictEqual(await mnote.isVisible(), false, name);
        assert.deepStrictEqual(visible.map((h) => h.split('/').pop()).sort(), [`AIVN-${V}-arm64-mac.zip`, `AIVN-${V}-x64-mac.zip`], name);
      } else {
        assert.match(cls, /beta-os-ios/, name + ' ' + cls);
        assert.match(cls, /is-mobile/, name + ' ' + cls);
        assert.ok(!cls.includes('beta-os-mac'), name + ' ' + cls);
        assert.deepStrictEqual(visible, [], name + ': còn link tải ' + visible.join(' '));
        assert.strictEqual(await page.locator('.beta-dl .beta-mac').isVisible(), false, name);
        assert.strictEqual(await mnote.isVisible(), true, name);
        assert.match(await mnote.innerText(), /📱/, name);
        const tapped = await page.evaluate(() => {
          const el = document.querySelector('.beta-mnote'); const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + 4, r.top + 4);
          const a = hit && hit.closest && hit.closest('a');
          return a ? a.getAttribute('href') : '';
        });
        assert.strictEqual(tapped, '', name + ': bấm dòng 📱 lại trúng link ' + tapped);
      }
      assert.deepStrictEqual(hits, [], name + ': trình duyệt đã tải tệp');
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => srv.close(resolve));
  }
});
