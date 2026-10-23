// B185 (#45): tiếng Anh ở 768–900 px (iPad dọc) nút “Download free” ở đầu trang không còn đẩy trang cuộn ngang.
// CSS chỉ ở hàng menu. Hàng nút tải bản ổn định (việc #49) không đụng tới.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path'); const http = require('http');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
let playwright = null;
try { playwright = require('playwright'); } catch { /* thiếu playwright thì bỏ phần trình duyệt */ }
const CTA = { vi: 'Tải miễn phí', en: 'Download free', zh: '免费下载' };
const WIDTHS = [];
for (let w = 768; w <= 900; w += 2) WIDTHS.push(w);

test('B185: CSS đầu trang chỉ co trong dải 761–900 px', () => {
  const i = html.indexOf('@media (max-width:900px) and (min-width:761px)');
  const j = html.indexOf('@media (max-width:760px)');
  assert.ok(i > 0 && j > i, 'khối 900 px phải đứng trước khối điện thoại');
  const block = html.slice(i, j);
  assert.match(block, /header \.wrap\{padding-left:14px;padding-right:14px\}/);
  assert.match(block, /\.nav ul\{gap:8px\}/);
  assert.match(block, /\.nav-cta\{gap:8px;flex-shrink:0\}/);
  assert.match(block, /\.nav-cta \.btn-sm\{padding:8px 11px;white-space:nowrap\}/);
  const check = fs.readFileSync(path.join(root, 'tools/site_check.py'), 'utf8');
  assert.match(check, /BAND = list\(range\(768, 901, 2\)\)/);
  for (const w of [768, 780, 800, 810, 820, 834, 850, 880, 900]) assert.ok(WIDTHS.includes(w), 'thiếu ' + w);
});

test('B185: Playwright 768–900 px vi/en/zh không cuộn ngang, nút tải vẫn bấm được', { skip: !playwright && 'cần playwright + Chrome', timeout: 180000 }, async () => {
  const { chromium } = playwright;
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const measure = () => {
    const d = document.documentElement, cw = d.clientWidth;
    const a = document.querySelector('header .nav-cta a.btn');
    const rc = a.getBoundingClientRect(), cs = getComputedStyle(a);
    const vis = !!(rc.width && cs.display !== 'none');
    const x = Math.min(cw - 2, rc.left + rc.width / 2);
    const hit = vis ? document.elementFromPoint(x, rc.top + rc.height / 2) : null;
    const ul = getComputedStyle(document.querySelector('.nav ul'));
    const wrap = getComputedStyle(document.querySelector('header .wrap'));
    return {
      sw: d.scrollWidth, cw, vis, left: rc.left, right: rc.right, h: rc.height,
      text: (a.innerText || '').replace(/\s+/g, ' ').trim(),
      hit: !!(hit && (hit === a || a.contains(hit))),
      gap: ul.gap, pad: wrap.paddingLeft, nowrap: cs.whiteSpace,
      burger: getComputedStyle(document.querySelector('.burger')).display,
    };
  };
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    const hits = [];
    page.on('request', (r) => { if (/\.(zip|exe)(\?|$)/i.test(r.url())) hits.push(r.url()); });
    page.on('download', (d) => hits.push('DOWNLOAD ' + d.url()));
    for (const lang of ['vi', 'en', 'zh']) {
      await page.goto(base + '?lang=' + lang, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: 1000 });
        const r = await page.evaluate(measure);
        assert.ok(r.sw <= r.cw, lang + ' ' + w + ' tràn ' + r.sw + '>' + r.cw);
        assert.ok(r.vis && r.hit && r.text === CTA[lang], lang + ' ' + w + ' ' + JSON.stringify(r));
        assert.ok(r.left >= -0.5 && r.right <= r.cw + 0.5, lang + ' ' + w + ' nút ' + r.left + '..' + r.right);
        assert.ok(r.h >= 32 && r.h <= 48, lang + ' ' + w + ' cao ' + r.h);
        assert.strictEqual(r.gap, '8px', lang + ' ' + w);
        assert.strictEqual(r.pad, '14px', lang + ' ' + w);
        assert.strictEqual(r.nowrap, 'nowrap', lang + ' ' + w);
      }
      await page.setViewportSize({ width: 820, height: 1000 });
      await page.locator('header .nav-cta a.btn').click();
      const reached = await page.evaluate(() => {
        const e = document.getElementById('tai-ve');
        if (!e) return false;
        const b = e.getBoundingClientRect();
        return b.top < innerHeight && b.bottom > 0;
      });
      assert.ok(reached, lang + ' bấm không tới #tai-ve');
      await page.setViewportSize({ width: 980, height: 800 });
      const desk = await page.evaluate(measure);
      assert.ok(desk.sw <= desk.cw && desk.vis && desk.text === CTA[lang], lang + ' 980 ' + JSON.stringify(desk));
      assert.strictEqual(desk.gap, '30px', 'máy tính không bị co menu');
      assert.strictEqual(desk.pad, '24px');
      assert.notStrictEqual(desk.nowrap, 'nowrap');
      await page.setViewportSize({ width: 760, height: 800 });
      const phone = await page.evaluate(measure);
      assert.ok(phone.sw <= phone.cw, lang + ' 760 tràn ' + phone.sw + '>' + phone.cw);
      assert.strictEqual(phone.vis, false, 'điện thoại vẫn hiện nút trên thanh');
      assert.ok(phone.burger === 'flex' || phone.burger === 'inline-flex', lang + ' ' + phone.burger);
    }
    assert.deepStrictEqual(hits, [], 'bấm nút đầu trang mà tải exe/zip');
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => srv.close(resolve));
  }
});
