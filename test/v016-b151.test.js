// B151: Giới thiệu / Kiểm tra cập nhật — có bản thử nghiệm (prerelease công khai) mới hơn → chỉ hiện một dòng dẫn tới trang web;
// KHÔNG BAO GIỜ tự cập nhật lên bản thử; mất mạng → im lặng.
const test = require('node:test'); const assert = require('node:assert'); const http = require('http'); const fs = require('fs'); const path = require('path'); const Module = require('module');
const root = path.join(__dirname, '..'); const U = require('../src/updater');
const rel = (tag, o = {}) => ({ tag_name: tag, draft: false, prerelease: true, assets: [{ name: `AIVN-Setup-${tag.replace(/^v/, '')}.exe` }], ...o });
const LIST = [rel('v0.16.0-beta.3'), rel('v0.16.0-beta.2.7'), rel('v0.16.0-beta.4', { draft: true }), rel('v0.15.3', { prerelease: false, assets: [{ name: 'AIVN-Setup.exe' }] }),
  rel('v0.16.0-beta.9', { assets: [{ name: 'AIVN-mac-arm64.zip' }] })];

test('pickBeta: prerelease đã đăng, mới nhất, có tệp cài cho máy này, mới hơn bản đang dùng và bản ổn định được mời', () => {
  assert.deepStrictEqual(U.pickBeta(LIST, { current: '0.15.3', platform: 'win32' }), { version: '0.16.0-beta.3' });
  assert.deepStrictEqual(U.pickBeta(LIST, { current: '0.16.0-beta.2.7', platform: 'win32' }), { version: '0.16.0-beta.3' });
  assert.strictEqual(U.pickBeta(LIST, { current: '0.16.0-beta.3', platform: 'win32' }), null, 'đang dùng đúng bản đó');
  assert.strictEqual(U.pickBeta(LIST, { current: '0.16.0', platform: 'win32' }), null, 'bản ổn định 0.16.0 mới hơn mọi beta 0.16.0-…');
  assert.strictEqual(U.pickBeta(LIST, { current: '0.15.3', stable: '0.16.0', platform: 'win32' }), null, 'đã có bản ổn định mới hơn để cập nhật');
  assert.deepStrictEqual(U.pickBeta(LIST, { current: '0.15.3', platform: 'darwin' }), { version: '0.16.0-beta.9' }, 'macOS chỉ thấy bản có tệp mac');
  assert.strictEqual(U.pickBeta([rel('v0.16.0-beta.3')], { current: '0.15.3', platform: 'darwin' }), null, 'beta chỉ có .exe → không mời máy Mac');
  assert.strictEqual(U.pickBeta([rel('v0.17.0', { prerelease: true })], { current: '0.15.3', platform: 'win32' }), null, 'không có hậu tố -… thì không phải bản thử');
  for (const junk of [null, undefined, {}, 'x', [null, 1, { tag_name: 5 }]]) assert.strictEqual(U.pickBeta(junk, { current: '0.15.3', platform: 'win32' }), null);
});

function server(handler) { return new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); }); }
test('fetchReleases: đọc được danh sách; HTTP lỗi, JSON hỏng, cổng đóng, treo quá hạn, fetch ném lỗi → null (không ném, không báo lỗi)', async (t) => {
  const s = await server((q, res) => {
    if (q.url === '/ok') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(LIST)); }
    else if (q.url === '/500') { res.statusCode = 500; res.end('x'); }
    else if (q.url === '/bad') res.end('{not json');
    else if (q.url === '/obj') res.end('{"message":"rate limited"}');
    // /hang: không trả lời
  });
  t.after(() => { s.closeAllConnections && s.closeAllConnections(); s.close(); });
  const base = `http://127.0.0.1:${s.address().port}`;
  assert.strictEqual((await U.fetchReleases(base + '/ok')).length, LIST.length);
  for (const p of ['/500', '/bad', '/obj']) assert.strictEqual(await U.fetchReleases(base + p), null, p);
  const t0 = Date.now(); assert.strictEqual(await U.fetchReleases(base + '/hang', { timeoutMs: 400 }), null); assert.ok(Date.now() - t0 < 3000, 'hết giờ phải dừng');
  const closed = await server(() => {}); const port = closed.address().port; await new Promise(r => closed.close(r));
  assert.strictEqual(await U.fetchReleases(`http://127.0.0.1:${port}/x`), null, 'mất mạng/cổng đóng');
  assert.strictEqual(await U.fetchReleases(base + '/ok', { fetchImpl: () => { throw new Error('ENOTFOUND api.github.com'); } }), null);
  assert.strictEqual(await U.fetchReleases('', {}), null);
});

// chạy createUpdater thật với electron/electron-updater giả
function withFakes(ver, behaviour) {
  const calls = { open: [], download: 0, feeds: [] }; const listeners = {};
  const autoUpdater = { on: (e, f) => { listeners[e] = f; }, setFeedURL: (c) => calls.feeds.push(c), allowPrerelease: false,
    async checkForUpdates() { if (behaviour === 'offline') throw new Error('net::ERR_INTERNET_DISCONNECTED'); listeners['update-not-available'](); return {}; },
    async downloadUpdate() { calls.download++; }, quitAndInstall() { calls.download++; } };
  const fakes = { electron: { app: { getVersion: () => ver, isPackaged: false }, shell: { openExternal: (u) => calls.open.push(u) } }, 'electron-updater': { autoUpdater } };
  const orig = Module._load; Module._load = function (req, ...rest) { return Object.prototype.hasOwnProperty.call(fakes, req) ? fakes[req] : orig.call(this, req, ...rest); };
  const id = require.resolve('../src/updater'); delete require.cache[id];
  // electron-updater được nạp lúc check() → giữ móc tới khi bài kiểm xong (restore)
  const M = require('../src/updater'); const sent = []; const up = M.createUpdater({ send: (c, st) => sent.push(st), log: () => {} });
  const restore = () => { Module._load = orig; delete require.cache[id]; };
  return { up, calls, autoUpdater, sent, restore };
}
test('check(): báo bản thử nghiệm mới hơn kèm trang web #tai-beta; không đổi kênh, không tải, không cài; openBeta chỉ mở trang web', async (t) => {
  const s = await server((q, res) => res.end(JSON.stringify(LIST))); t.after(() => s.close());
  process.env.AIVN_BETA_FEED_URL = `http://127.0.0.1:${s.address().port}/releases`; t.after(() => { delete process.env.AIVN_BETA_FEED_URL; });
  const plat = Object.getOwnPropertyDescriptor(process, 'platform'); Object.defineProperty(process, 'platform', { value: 'win32' }); t.after(() => Object.defineProperty(process, 'platform', plat));
  const { up, calls, autoUpdater, restore } = withFakes('0.15.3'); t.after(restore);
  const st = await up.check();
  assert.strictEqual(st.status, 'latest'); assert.deepStrictEqual(st.beta, { version: '0.16.0-beta.3', page: 'https://khoik647-ai.github.io/aivn/#tai-beta' });
  assert.strictEqual(autoUpdater.allowPrerelease, false); assert.ok(calls.feeds.every(f => !/beta|prerelease/i.test(JSON.stringify(f))), 'nguồn cập nhật không đổi sang kênh thử');
  await up.download(); assert.strictEqual(calls.download, 0, 'không bao giờ tải bản thử'); up.install(); assert.strictEqual(calls.download, 0);
  assert.strictEqual(up.openBeta(), true); assert.deepStrictEqual(calls.open, ['https://khoik647-ai.github.io/aivn/#tai-beta']);
  assert.strictEqual(up.state().version, undefined, 'bản thử không thành “bản mới” của bộ cập nhật');
});
test('check() khi mất mạng: không có dòng bản thử, không thêm lỗi nào từ phần bản thử; openBeta không mở gì', async (t) => {
  const closed = await server(() => {}); const port = closed.address().port; await new Promise(r => closed.close(r));
  process.env.AIVN_BETA_FEED_URL = `http://127.0.0.1:${port}/releases`; t.after(() => { delete process.env.AIVN_BETA_FEED_URL; });
  const { up, calls, restore } = withFakes('0.15.3', 'offline'); t.after(restore);
  const st = await up.check({ silent: true });
  assert.strictEqual(st.beta, null); assert.strictEqual(st.status, 'error'); assert.match(st.error, /không có kết nối mạng/); assert.strictEqual(st.silent, true);
  assert.strictEqual(up.openBeta(), false); assert.deepStrictEqual(calls.open, []);
});
test('giao diện: một dòng nhỏ dẫn tới trang web (vi/en/zh), không có nút tải/cài cho bản thử', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8'); const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  assert.match(html, /<div id="updateBeta" class="muted beta-note" hidden data-testid="update-beta">🧪 <a href="#" id="updBetaLink" data-testid="upd-beta-link"><\/a><\/div>/);
  assert.match(app, /\$\('#updBetaLink'\)\.textContent = `Có bản thử nghiệm \$\{bv\}, tải ở trang web`/);
  assert.match(app, /\$\('#updBetaLink'\)\.addEventListener\('click', \(e\) => \{ e\.preventDefault\(\); A\.openBeta\(\); \}\)/);
  const seg = app.slice(app.indexOf('// B151'), app.indexOf("$('#updBetaLink').addEventListener")); assert.ok(!/downloadUpdate|installUpdate|act\.|dataset\.do/.test(seg), 'dòng bản thử không gắn hành động tải/cài');
  assert.match(fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8'), /openBeta: inv\('update:openbeta'\)/);
  assert.match(fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'), /ipcMain\.handle\('update:openbeta', \(\) => updater\.openBeta\(\)\)/);
  const { create } = require('../src/i18n/core.js'); const en = require('../src/i18n/en.js'); const zh = require('../src/i18n/zh.js');
  const T = create({ en: en.dict || en, zh: zh.dict || zh });
  const tr = T.tr || T.translate || T.t; if (tr) {
    assert.strictEqual(tr('Có bản thử nghiệm 0.16.0-beta.3, tải ở trang web', 'en'), 'There is a beta version 0.16.0-beta.3, download it from the website');
    assert.strictEqual(tr('Có bản thử nghiệm 0.16.0-beta.3, tải ở trang web', 'zh'), '有测试版 0.16.0-beta.3，请在网站下载');
  } else assert.fail('không tìm thấy hàm dịch');
});
const { spawn } = require('child_process'); const os = require('os');
test('Electron: Giới thiệu → Kiểm tra cập nhật hiện dòng bản thử nghiệm (vi/en/zh), không có nút tải cho nó', { skip: !fs.existsSync(path.join(root, 'node_modules/.bin/electron')) }, async (t) => {
  const v = require('../package.json').version; const beta = v.replace(/-.*$/, '') + '-beta.99';
  const s = await server((q, res) => {
    if (q.url.startsWith('/releases')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify([rel('v' + beta, { assets: [{ name: `AIVN-Setup-${beta}.exe` }, { name: `AIVN-${beta}.AppImage` }, { name: `AIVN-mac-arm64.zip` }] })])); }
    if (/latest.*\.yml$/.test(q.url)) return res.end(`version: 0.0.1\nfiles:\n  - url: x.exe\n    sha512: x\n    size: 1\npath: x.exe\nsha512: x\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`);
    res.statusCode = 404; res.end();
  });
  t.after(() => s.close());
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b151-')); const base = `http://127.0.0.1:${s.address().port}`;
  await new Promise((resolve) => {
    const p = spawn('timeout', ['150', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--qa-ui', 'test/fixtures/qa-ui/update-beta.json',
      '--out', path.join(d, 'r.json'), '--shots', path.join(d, 'shots'), '--profile', path.join(d, 'profile')],
      { cwd: root, env: { ...process.env, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_MODE: '1', OMP_NUM_THREADS: '4', AIVN_UPDATE_URL: base + '/', AIVN_BETA_FEED_URL: base + '/releases' }, stdio: 'ignore' });
    p.on('exit', resolve);
  });
  const r = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8'));
  assert.deepStrictEqual(r.steps.filter(x => !x.ok && !x.optional).map(x => `${x.n} ${x.action}: ${x.error}`), []); assert.deepStrictEqual(r.consoleErrors, []);
  assert.strictEqual(r.reads.vi.trim(), `🧪 Có bản thử nghiệm ${beta}, tải ở trang web`);
  assert.strictEqual(r.reads.en.trim(), `🧪 There is a beta version ${beta}, download it from the website`);
  assert.strictEqual(r.reads.zh.trim(), `🧪 有测试版 ${beta}，请在网站下载`);
  assert.ok(!r.reads.status.includes(beta), 'dòng trạng thái cập nhật không coi bản thử là “bản mới”');
  console.log('B151 ảnh: ' + path.join(d, 'shots'));
});
