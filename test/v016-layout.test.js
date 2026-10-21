// B46: bố cục co giãn (chia đôi màn hình ~1024 px, 800, 640) — mọi màn hình chính vi/en/zh: không tràn ngang, ô nhập ≥ 60% khung chat,
// gợi ý ô nhập một dòng, thanh bên thu gọn dưới 1200 px, danh sách trò chuyện thành ngăn kéo dưới 1000 px
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'); const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const hasX = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));

test('CSS/HTML: one consolidated grid (no stray third column), drawers, short placeholder + full hint in tooltip, window min width 640', () => {
  const css = rd('src/renderer/styles.css'); const html = rd('src/renderer/index.html'); const app = rd('src/renderer/app.js');
  assert.match(css, /@media \(max-width:1150px\)\{\s*#view-chat\.active,#view-chat\.active\.no-panel\{grid-template-columns:200px minmax\(0,1fr\)\}/);
  assert.match(css, /@media \(max-width:999px\)\{\s*#view-chat\.active,#view-chat\.active\.no-panel\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.ok(css.lastIndexOf('max-width:1150px){\n  #view-chat.active') > css.lastIndexOf('@media (max-width: 1320px)'), 'quy tắc hẹp phải viết sau quy tắc 1320 px');
  assert.match(html, /id="convosBtn"/); assert.match(html, /<textarea id="input" rows="1" placeholder="Nhập tin nhắn…" title="Nhập tin nhắn… \(Enter gửi/);
  assert.match(app, /\$\('#input'\)\.placeholder = mode === 'agent' \? 'Giao việc cho AIVN AGENT…' : 'Nhập tin nhắn…';/);
  assert.match(app, /matchMedia\('\(max-width:1199px\)'\)/); assert.match(app, /<span data-noi18n title="\$\{esc\(c\.title\)\}">/);
  assert.match(rd('src/main.js'), /minWidth: 640,/);
});

test('Electron: 7 screens × 1280/1024/800/640 px × vi/en/zh — no horizontal overflow, composer ≥ 60% of the chat area, one-line placeholder, rail/drawer behaviour', { skip: !hasX && 'cần xvfb-run + electron', timeout: 700000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-layout-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-layout-ud-'));
  const r = spawnSync('timeout', ['640', 'xvfb-run', '-a', '-s', '-screen 0 1400x900x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'],
    { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QAUI: dir, AIVN_QAUI_LAYOUT: '1' }) });
  const f = path.join(dir, 'qalayout.json'); assert.ok(fs.existsSync(f), 'đo bố cục không chạy xong: ' + (r.stderr || '').slice(-800));
  const res = JSON.parse(fs.readFileSync(f, 'utf8')); const bad = [];
  const screens = res.filter(x => !x.view.startsWith('chat-drawer'));
  assert.strictEqual(screens.length, 7 * 4 * 3);
  for (const x of screens) {
    const at = `${x.lang} ${x.w}px ${x.view}`;
    if (Math.abs(x.W - x.w) > 2) bad.push(`${at}: cửa sổ ${x.W}px`);
    if (x.page.doc > 0 || x.page.body > 0 || x.page.shell > 0) bad.push(`${at}: trang tràn ngang ${JSON.stringify(x.page)}`);
    if (x.over.length) bad.push(`${at}: phần tử tràn ra ngoài ${x.over.join(', ')}`);
    if (x.xscroll.length) bad.push(`${at}: thanh cuộn ngang ${x.xscroll.join(', ')}`);
    if (x.w < 1200 && x.rail > 80) bad.push(`${at}: thanh bên chưa thu gọn (${x.rail}px)`);
    if (x.chat) {
      if (x.chat.ratio < 0.6) bad.push(`${at}: ô nhập ${x.chat.input}px = ${x.chat.ratio} khung chat`);
      if (!x.chat.phOneLine) bad.push(`${at}: gợi ý ô nhập xuống dòng`);
      if (x.w <= 1024 && x.chat.paneOfWin < 0.7) bad.push(`${at}: khung chat chỉ ${x.chat.paneOfWin} cửa sổ`);
    }
  }
  for (const x of res.filter(x => x.view === 'chat-drawer')) if (!(x.drawer.open && x.drawer.btn !== 'none' && x.drawer.items >= 3 && x.drawer.w >= 200)) bad.push(`${x.lang} ${x.w}px: ngăn kéo danh sách ${JSON.stringify(x.drawer)}`);
  for (const x of res.filter(x => x.view === 'chat-drawer-esc')) if (!x.closed) bad.push(`${x.lang} ${x.w}px: Esc không đóng ngăn kéo`);
  assert.deepStrictEqual(bad, []);
});
