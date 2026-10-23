// B186: trên điện thoại/máy tính bảng, nút bản ổn định không còn là đích bấm tải exe/zip; có dòng 📱 như khối beta.
// Dùng lớp html.is-mobile mà bộ nhận hệ điều hành sẵn có (#43 / B143) đã gắn — không thêm bộ nhận thứ hai.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path'); const http = require('http');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
let playwright = null;
try { playwright = require('playwright'); } catch { /* thiếu playwright thì bỏ phần trình duyệt */ }
const NOTE = {
  vi: '📱 Hãy mở trang này trên máy tính để tải.',
  en: '📱 Open this page on a computer to download it.',
  zh: '📱 请在电脑上打开本页下载。',
};

test('B186: CSS hàng nút ổn định bám lớp is-mobile sẵn có', () => {
  assert.match(html, /html\.is-mobile \.dl-mnote\{display:block\}/);
  assert.match(html, /html\.is-mobile \.dl-row>\.dl-btn,html\.is-mobile \.dl-row>\.mac-wrap\{display:none\}/);
  assert.strictEqual((html.match(/maxTouchPoints/g) || []).length, 2, 'thêm một bộ nhận hệ điều hành nữa');
  const D = JSON.parse(html.split('/*I18N*/')[1].split('/*END*/')[0]);
  assert.strictEqual(D.en['dl.1'], NOTE.en); assert.strictEqual(D.en['cta.6'], NOTE.en);
  assert.strictEqual(D.zh['dl.1'], NOTE.zh); assert.strictEqual(D.zh['cta.6'], NOTE.zh);
  for (const k of ['dl.1', 'cta.6']) assert.ok(html.includes(`data-i18n="${k}">${NOTE.vi}`), k);
});

test('B186: Playwright iPhone 13, iPad, iPadOS, Pixel, máy Windows và Mac', { skip: !playwright && 'cần playwright + Chrome', timeout: 180000 }, async () => {
  const { chromium, devices } = playwright;
  for (const name of ['iPhone 13', 'iPad (gen 7)', 'Pixel 5']) assert.ok(devices[name], 'thiếu hồ sơ ' + name);
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const nav = (platform, touch) => `Object.defineProperty(Navigator.prototype,'platform',{get:function(){return ${JSON.stringify(platform)}}});Object.defineProperty(Navigator.prototype,'maxTouchPoints',{get:function(){return ${touch}}});Object.defineProperty(Navigator.prototype,'userAgentData',{get:function(){return undefined}});`;
  const ctxOpts = (device) => { const { defaultBrowserType, ...rest } = device; return rest; };
  const ipad = devices['iPad (gen 7)'];
  const macUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const winUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
  const cases = [
    ['iPhone 13', ctxOpts(devices['iPhone 13']), nav('iPhone', 5), 'ios'],
    ['iPad (gen 7)', ctxOpts(ipad), nav('iPad', 5), 'ios'],
    ['iPadOS Macintosh+touch', { ...ctxOpts(ipad), userAgent: macUa, isMobile: true, hasTouch: true }, nav('MacIntel', 5), 'ios'],
    ['Pixel 5', ctxOpts(devices['Pixel 5']), nav('Linux armv8l', 5), 'android'],
    ['desktop Windows', { viewport: { width: 1280, height: 800 }, userAgent: winUa, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }, nav('Win32', 0), 'win'],
    ['desktop Mac', { viewport: { width: 1280, height: 800 }, userAgent: macUa, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }, nav('MacIntel', 0), 'mac'],
  ];
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const [name, opts, init, kind] of cases) {
      const context = await browser.newContext(opts);
      await context.addInitScript(init);
      const page = await context.newPage();
      const hits = [];
      page.on('request', (r) => { if (/\.(zip|exe)(\?|$)/i.test(r.url())) hits.push(r.url()); });
      page.on('download', (d) => hits.push('DOWNLOAD ' + d.url()));
      for (const lang of ['vi', 'en', 'zh']) {
        await page.goto(base + '?lang=' + lang, { waitUntil: 'load' });
        const cls = await page.evaluate(() => document.documentElement.className);
        const notes = page.locator('.dl-mnote');
        assert.strictEqual(await notes.count(), 2, name);
        const wins = page.locator('.dl-row .dl-btn[data-os=windows]');
        const macs = page.locator('.dl-row > .mac-wrap');
        if (kind === 'win' || kind === 'mac') {
          assert.match(cls, kind === 'win' ? /beta-os-win/ : /beta-os-mac/, name + ' ' + cls);
          assert.ok(!cls.includes('is-mobile'), name + ' ' + cls);
          for (let i = 0; i < 2; i++) {
            assert.strictEqual(await notes.nth(i).isVisible(), false, name + ' ' + lang);
            assert.strictEqual(await wins.nth(i).isVisible(), true, name);
            assert.strictEqual(await macs.nth(i).isVisible(), true, name);
          }
        } else {
          assert.match(cls, /is-mobile/, name + ' ' + cls);
          assert.match(cls, kind === 'ios' ? /beta-os-ios/ : /beta-os-android/, name + ' ' + cls);
          for (let i = 0; i < 2; i++) {
            assert.strictEqual(await notes.nth(i).isVisible(), true, name + ' ' + lang);
            assert.strictEqual(await notes.nth(i).innerText(), NOTE[lang], name + ' ' + lang);
            assert.strictEqual(await wins.nth(i).isVisible(), false, name);
            assert.strictEqual(await macs.nth(i).isVisible(), false, name);
          }
          const tapped = await page.evaluate(() => {
            const el = document.querySelector('.dl-mnote'); const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + 8, r.top + Math.min(8, r.height / 2));
            const a = hit && hit.closest && hit.closest('a[download],a[href$=".exe"],a[href$=".zip"]');
            return a ? a.getAttribute('href') : '';
          });
          assert.strictEqual(tapped, '', name + ' ' + lang + ': bấm dòng nhắc trúng ' + tapped);
        }
        assert.deepStrictEqual(hits, [], name + ' ' + lang + ': đã tải tệp');
      }
      if (kind === 'mac') {
        await page.goto(base + '?lang=en', { waitUntil: 'load' });
        await page.locator('#tai-ve .mac-toggle').click();
        const zips = page.locator('#tai-ve .mac-menu a[download]');
        assert.strictEqual(await zips.count(), 2, name);
        for (let i = 0; i < 2; i++) {
          assert.strictEqual(await zips.nth(i).isVisible(), true, name);
          assert.match(await zips.nth(i).getAttribute('href'), /AIVN-mac-(arm64|x64)\.zip$/, name);
        }
      }
      await context.close();
    }
    // B185 (#45) là nút “Download free” ở đầu trang. Thay đổi này không được làm khối tải lòi ở 820 px, tiếng Anh.
    const context = await browser.newContext({ ...ctxOpts(ipad), viewport: { width: 820, height: 1180 }, userAgent: macUa, isMobile: true, hasTouch: true });
    await context.addInitScript(nav('MacIntel', 5));
    const page = await context.newPage();
    await page.goto(base + '?lang=en', { waitUntil: 'load' });
    const over = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth; const bad = [];
      document.querySelectorAll('.dl-row, .dl-mnote, .dl-row *').forEach((e) => {
        const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
        if (s.display === 'none' || !r.width) return;
        if (r.right > cw + 0.5 || r.left < -0.5) bad.push((e.tagName + '.' + e.className).slice(0, 50) + ':' + Math.round(r.left) + '..' + Math.round(r.right));
      });
      return { cw, sw: document.documentElement.scrollWidth, bad };
    });
    assert.deepStrictEqual(over.bad, [], 'EN 820 px: khối tải lòi ' + JSON.stringify(over));
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => srv.close(resolve));
  }
});
