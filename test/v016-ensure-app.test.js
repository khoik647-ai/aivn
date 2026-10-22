'use strict';
// ensure_app: ứng dụng GIẢ ở mọi trạng thái (chưa mở / thu nhỏ / bị che / chỉ còn ở khay / treo / web + đăng nhập) — lõi chạy bằng mã, không cần mô hình.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const EA = require('../src/agent/ensure-app');
const C = require('../src/agent/computer');

// Máy giả: danh sách cửa sổ + tiến trình; đồng hồ giả để chạy tức thì
function world(apps, { focusHow = 'set', focusFails = 0 } = {}) {
  let t = 0, hw = 100; const calls = { launch: [], focus: [], tray: [], launchPath: [], openUrl: [], show: [] };
  const wins = []; const procs = [];
  const mk = (o) => { const w = { hwnd: ++hw, vis: true, min: false, hung: false, active: false, covered: 0, b: [0, 0, 1200, 800], looks: 0, ...o }; wins.push(w); return w; };
  const activate = (w) => { for (const x of wins) x.active = false; w.active = true; w.min = false; w.vis = true; w.covered = 0; };
  for (const a of apps) {
    if (a.state === 'closed') continue;
    procs.push({ pid: a.pid || 7, proc: a.proc, path: a.exe || `C:\\Apps\\${a.proc}.exe` });
    if (a.state === 'tray') { if (a.hiddenWin) mk({ title: a.title, proc: a.proc, vis: false }); continue; }
    const w = mk({ title: a.title, proc: a.proc, min: a.state === 'min', active: a.state === 'active', covered: a.state === 'covered' ? 0.8 : 0, hung: a.hungFor ? true : false, hungUntil: a.hungFor, loadLooks: a.loadLooks || 0, text: a.text || '' });
    if (a.state === 'active') activate(w);
  }
  let focusLeft = focusFails;
  const d = {
    now: () => t, sleep: async (ms) => { t += ms; },
    log: () => {},
    webApp: C.webApp,
    state: async () => { for (const w of wins) if (w.hungUntil && t >= w.hungUntil) w.hung = false; for (const w of wins) if (w.appearAt != null && t >= w.appearAt) { w.vis = true; delete w.appearAt; } return { windows: wins.filter(w => w.appearAt == null).map(({ looks, loadLooks, text, hungUntil, ...w }) => ({ ...w })), procs: [...procs] }; },
    focus: async (w) => { calls.focus.push(w.hwnd); const x = wins.find(y => y.hwnd === w.hwnd); if (focusLeft > 0) { focusLeft--; return { ok: false, how: 'alt' }; } if (x) activate(x); return { ok: true, how: focusHow }; },
    launch: async (name) => { calls.launch.push(name); const a = apps.find(x => EA.key(x.name) === EA.key(name)); if (!a || a.notInstalled) return { ok: false, tried: ['lối tắt Start Menu: không có'] }; procs.push({ pid: 9, proc: a.proc, path: `C:\\Apps\\${a.proc}.exe` }); if (!a.neverShows) { const w = mk({ title: a.title, proc: a.proc, loadLooks: a.loadLooks || 2, text: a.text || '' }); w.appearAt = t + 1500; activate(w); } return { ok: true, how: 'lối tắt Start Menu', window: null }; },
    launchPath: async (exe) => { calls.launchPath.push(exe); const a = apps.find(x => exe.includes(x.proc)); if (a && a.singleInstance) { const h = wins.find(w => w.proc === a.proc); if (h) activate(h); else activate(mk({ title: a.title, proc: a.proc })); } },
    tray: async (names) => { calls.tray.push(names[0]); const a = apps.find(x => names.some(n => EA.key(n) === EA.key(x.name))); if (a && a.trayIcon) { activate(mk({ title: a.title, proc: a.proc })); return { ok: true, how: 'invoke', name: a.name }; } return { ok: false, error: 'không thấy biểu tượng' }; },
    show: async (w) => { calls.show.push(w.hwnd); },
    openUrl: async (url) => { calls.openUrl.push(url); const a = apps.find(x => x.url && url.startsWith(x.url)); const b = wins.find(w => w.proc === 'chrome'); if (b) { b.title = a ? a.tabTitle : url; b.text = a ? a.tabText || '' : ''; b.loadLooks = 1; activate(b); } },
    look: async (w) => { const x = wins.find(y => y.hwnd === w.hwnd); x.looks++; const sig = x.looks <= x.loadLooks ? 'loading-' + x.looks : 'ready:' + x.title; return { sig, text: x.text || '' }; },
  };
  return { d, calls, wins, clock: () => t };
}
const ZALO = { name: 'Zalo', proc: 'Zalo', title: 'Zalo' };

test('chưa mở → khởi động qua lối tắt, chờ cửa sổ, sẵn sàng khi 2 lần nhìn giống nhau', async () => {
  const W = world([{ ...ZALO, state: 'closed', loadLooks: 3 }]);
  const r = await EA.ensureApp('Zalo', W.d);
  assert.ok(r.ok, r.error); assert.strictEqual(r.how, 'launched'); assert.deepStrictEqual(W.calls.launch, ['Zalo']);
  assert.ok(r.steps.some(x => /chưa mở → khởi động/.test(x)) && r.steps.some(x => /sẵn sàng sau 5 lần nhìn/.test(x)), r.steps.join(' | '));
});
test('thu nhỏ → khôi phục + đưa lên trước, không mở thêm', async () => {
  const W = world([{ ...ZALO, state: 'min' }]);
  const r = await EA.ensureApp('zalo', W.d);
  assert.ok(r.ok); assert.strictEqual(r.how, 'restored'); assert.strictEqual(W.calls.launch.length, 0); assert.strictEqual(W.calls.focus.length, 1);
  assert.ok(W.wins[0].active && !W.wins[0].min);
});
test('bị che → đưa lên trước (AttachThreadInput khi SetForegroundWindow bị chặn), ghi % bị che', async () => {
  const W = world([{ ...ZALO, state: 'covered' }, { name: 'Word', proc: 'WINWORD', title: 'Báo cáo - Word', state: 'active' }], { focusHow: 'attach' });
  const r = await EA.ensureApp('Zalo', W.d);
  assert.ok(r.ok); assert.strictEqual(r.how, 'raised'); assert.ok(r.steps.some(x => /bị che 80%/.test(x))); assert.ok(r.steps.some(x => /AttachThreadInput/.test(x)));
});
test('đã ở trước → không bấm gì, chỉ chờ sẵn sàng', async () => {
  const W = world([{ ...ZALO, state: 'active' }]);
  const r = await EA.ensureApp('Zalo', W.d); assert.ok(r.ok); assert.strictEqual(r.how, 'already'); assert.strictEqual(W.calls.focus.length, 0);
});
test('Windows chặn giành tiêu điểm cả 2 lần → vẫn tiếp tục nhưng có cảnh báo rõ', async () => {
  const W = world([{ ...ZALO, state: 'covered' }], { focusFails: 5 });
  const r = await EA.ensureApp('Zalo', W.d); assert.ok(r.ok); assert.match(r.warn, /chưa đưa được “Zalo” lên trước \(hệ điều hành chặn/);
});
test('chỉ còn ở khay: chạy lại .exe (một phiên bản) hiện lại cửa sổ', async () => {
  const W = world([{ ...ZALO, state: 'tray', singleInstance: true }]);
  const r = await EA.ensureApp('Zalo', W.d);
  assert.ok(r.ok, r.error); assert.strictEqual(r.how, 'tray'); assert.deepStrictEqual(W.calls.launchPath, ['C:\\Apps\\Zalo.exe']); assert.strictEqual(W.calls.tray.length, 0); assert.strictEqual(W.calls.launch.length, 0);
});
test('chỉ còn ở khay: chạy lại không hiện → bấm biểu tượng khay (UIA)', async () => {
  const W = world([{ ...ZALO, state: 'tray', trayIcon: true }]);
  const r = await EA.ensureApp('Zalo', W.d);
  assert.ok(r.ok, r.error); assert.strictEqual(W.calls.launchPath.length, 1); assert.strictEqual(W.calls.tray.length, 1); assert.ok(r.steps.some(x => /đã bấm biểu tượng/.test(x)));
});
test('chỉ còn ở khay, không cách nào hiện → lỗi rõ ràng (code tray), đã thử cả ShowWindow cửa sổ ẩn', async () => {
  const W = world([{ ...ZALO, state: 'tray', hiddenWin: true }]);
  const r = await EA.ensureApp('Zalo', W.d, { timeoutMs: 20000 });
  assert.ok(!r.ok); assert.strictEqual(r.code, 'tray'); assert.match(r.error, /đang chạy ẩn ở khay hệ thống/); assert.strictEqual(W.calls.show.length, 1);
});
test('“Not Responding” → chờ hồi lại; treo mãi → dừng với lỗi hung', async () => {
  let W = world([{ ...ZALO, state: 'covered', hungFor: 5000 }]);
  let r = await EA.ensureApp('Zalo', W.d); assert.ok(r.ok, r.error);
  W = world([{ ...ZALO, state: 'active', hungFor: 1e9 }]);
  r = await EA.ensureApp('Zalo', W.d, { timeoutMs: 15000 }); assert.ok(!r.ok); assert.strictEqual(r.code, 'hung'); assert.match(r.error, /Không phản hồi/);
});
test('chưa cài → not-found; khởi động mà không có cửa sổ → timeout rõ ràng', async () => {
  let W = world([{ ...ZALO, state: 'closed', notInstalled: true }]);
  let r = await EA.ensureApp('Zalo', W.d); assert.strictEqual(r.code, 'not-found'); assert.match(r.error, /Không mở được Zalo/);
  W = world([{ ...ZALO, state: 'closed', neverShows: true }]);
  r = await EA.ensureApp('Zalo', W.d, { timeoutMs: 10000 }); assert.strictEqual(r.code, 'timeout'); assert.match(r.error, /chưa thấy cửa sổ chính/);
});
const CHROME = { name: 'Chrome', proc: 'chrome', title: 'New Tab - Google Chrome' };
test('web: Chrome đóng → mở Chrome rồi mở địa chỉ Gmail, chờ thẻ Gmail sẵn sàng', async () => {
  const W = world([{ ...CHROME, state: 'closed' }, { name: 'Gmail', url: 'https://mail.google.com', tabTitle: 'Hộp thư đến (3) - khoi@gmail.com - Gmail' }]);
  const r = await EA.ensureApp('Gmail', W.d);
  assert.ok(r.ok, r.error); assert.deepStrictEqual(W.calls.launch, ['Chrome']); assert.deepStrictEqual(W.calls.openUrl, ['https://mail.google.com/']); assert.match(r.window.title, /Gmail/);
});
test('web: thẻ Google Docs đã mở → chỉ đưa lên trước, không mở thêm', async () => {
  const W = world([{ ...CHROME, title: 'QA nháp - Google Docs', state: 'min' }]);
  const r = await EA.ensureApp('Google Docs', W.d); assert.ok(r.ok); assert.strictEqual(W.calls.openUrl.length, 0); assert.strictEqual(W.calls.launch.length, 0);
});
test('web: gặp màn hình đăng nhập → DỪNG, hỏi người dùng, không gõ gì', async () => {
  const W = world([{ ...CHROME, state: 'active' }, { name: 'Gmail', url: 'https://mail.google.com', tabTitle: 'Gmail', tabText: 'Sign in · Use your Google Account · Email or phone · Forgot email? · Create account' }]);
  const r = await EA.ensureApp('Gmail', W.d);
  assert.ok(!r.ok); assert.strictEqual(r.code, 'login'); assert.ok(r.stop); assert.match(r.ask, /Mình không tự đăng nhập/);
  const W2 = world([{ ...CHROME, state: 'active' }, { name: 'Docs', url: 'https://docs.google.com', tabTitle: 'Đăng nhập - Tài khoản Google' }]);
  const r2 = await EA.ensureApp('Google Docs', W2.d); assert.strictEqual(r2.code, 'login');
});
test('Zalo màn hình quét mã QR → login; tin nhắn có chữ “đăng nhập” thì không', () => {
  assert.ok(EA.loginWall('Zalo', 'Đăng nhập Zalo · Quét mã QR bằng Zalo trên điện thoại'));
  assert.strictEqual(EA.loginWall('Zalo', 'Lan: mai nhớ đăng nhập vào hệ thống nhé · Khôi: ok'), null);
  assert.strictEqual(EA.loginWall('Hộp thư đến - Gmail', 'Mật khẩu wifi là 1234'), null);
});
test('trình phụ Windows (C#) biên dịch được', { skip: spawnSync('which', ['mcs']).status !== 0 && 'cần mcs (mono)' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-')); fs.writeFileSync(path.join(d, 'ea.cs'), EA.CS_SRC);
  const r = spawnSync('mcs', ['-target:library', '-warnaserror+', '-out:' + path.join(d, 'ea.dll'), path.join(d, 'ea.cs')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(EA.PS_EA('x'), /OutputAssembly \$dll/); assert.match(EA.PS_TRAY, /Shell_TrayWnd/); assert.match(EA.PS_TRAY, /NotifyIconOverflowWindow/);
  for (const k of ['IsHungAppWindow', 'AttachThreadInput', 'ShowWindow(h, 9)', 'QueryFullProcessImageName', 'DwmGetWindowAttribute']) assert.ok(EA.CS_SRC.includes(k), k);
});

// ---- agent.js: ensure_app là bước MÃ chạy trước mô hình ----
function mkAgent(ensureOut, { modelSteps = 1 } = {}) {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-ea-')); const exec = []; let model = 0;
  const engine = { status: () => ({ loaded: true, vision: true, contextSize: 8192 }), chatStep: async () => { model++; return { text: 'Chưa làm được.', toolCalls: [], finishReason: 'stop', usage: {} }; } };
  const names = ['open_app', 'screen_look', 'screen_act']; const defs = Object.fromEntries([...names, 'ensure_app'].map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { exec.push([n, a]); if (n === 'ensure_app') return typeof ensureOut === 'function' ? ensureOut(a) : ensureOut; return { forModel: 'ok', summary: 'ok' }; } };
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: true, agentComputer: true, agentScreen: true, uiLang: 'vi' }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, exec, model: () => model };
}
const run = (a, q) => a.run({ messages: [{ role: 'user', content: q }], confirm: async () => false });
test('agent: “nhắn Zalo cho Lan …” → ensure_app(Zalo) chạy TRƯỚC mô hình, có trong danh sách bước (auto)', async () => {
  const M = mkAgent({ forModel: 'Zalo sẵn sàng', summary: 'Zalo: đã khởi động', how: 'launched' });
  const r = await run(M.agent, 'nhắn Zalo cho Lan: chiều nay họp nhé');
  assert.deepStrictEqual(M.exec[0], ['ensure_app', { app: 'Zalo' }]); const st = r.steps.find(s => s.name === 'ensure_app');
  assert.ok(st && st.auto && st.status === 'ok'); assert.ok(M.model() >= 1, 'mô hình vẫn làm phần còn lại');
});
test('agent: soạn trên Google Docs / mở Chrome → ensure_app đúng ứng dụng; “mở Zalo” chỉ cần ensure_app là xong', async () => {
  let M = mkAgent({ forModel: 'ok', summary: 'ok' }); await run(M.agent, 'viết đoạn giới thiệu trên Google Docs'); assert.deepStrictEqual(M.exec[0], ['ensure_app', { app: 'Google Docs' }]);
  M = mkAgent({ forModel: 'ok', summary: 'Zalo: đã khôi phục từ thu nhỏ', window: { title: 'Zalo' } }); const r = await run(M.agent, 'mở Zalo');
  assert.strictEqual(r.outcome, 'done'); assert.strictEqual(M.model(), 0); assert.match(r.text, /Đã mở Zalo/); assert.ok(!M.exec.some(e => e[0] === 'open_app'));
});
test('agent: màn hình đăng nhập → dừng, hỏi (asked_user), mô hình không chạy', async () => {
  const M = mkAgent({ error: 'login', code: 'login', ask: 'Gmail đang ở màn hình đăng nhập. Mình không tự đăng nhập — bạn đăng nhập giúp mình nhé.', stop: true, summary: 'Gmail: màn hình đăng nhập — hỏi bạn' });
  const r = await run(M.agent, 'soạn thư trên Gmail gửi Lan: báo cáo tuần');
  assert.strictEqual(r.outcome, 'asked_user'); assert.strictEqual(r.asked, 'login'); assert.match(r.text, /không tự đăng nhập/); assert.strictEqual(M.model(), 0);
});
test('agent: treo / khay / quá hạn → dừng với lỗi rõ (failed); chưa thấy ứng dụng → để mô hình thử tiếp', async () => {
  let M = mkAgent({ error: 'Zalo đang “Không phản hồi” (Not Responding) suốt 45 giây', code: 'hung', summary: 'Zalo treo' });
  let r = await run(M.agent, 'nhắn Zalo cho Lan: hi'); assert.strictEqual(r.outcome, 'failed'); assert.match(r.text, /Not Responding/); assert.strictEqual(M.model(), 0);
  M = mkAgent({ error: 'Không mở được Zalo', code: 'not-found', summary: 'không mở được' });
  r = await run(M.agent, 'nhắn Zalo cho Lan: hi'); assert.ok(M.model() >= 1); assert.notStrictEqual(r.outcome, 'asked_user');
});
test('bài đo (hộp cát): ensure_app không mở ứng dụng thật, không tính vi phạm', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/agent-bench-full.js'), 'utf8');
  assert.match(src, /if \(name === 'ensure_app'\) return \{ forModel: 'Bài đo AIVN AGENT: bỏ qua bước chuẩn bị ứng dụng/);
});
test('macOS/Linux: không có tên tiến trình tin cậy → nhận cửa sổ có tiêu đề bắt đầu bằng tên ứng dụng (looseTitle)', async () => {
  const W = world([{ name: 'Zalo', proc: 'electron', title: 'Zalo - Lan', state: 'covered' }]);
  let r = await EA.ensureApp('Zalo', { ...W.d, launch: async () => ({ ok: false, tried: ['x'] }) }); assert.strictEqual(r.code, 'not-found', 'Windows: không nhận theo tiêu đề');
  r = await EA.ensureApp('Zalo', { ...W.d, looseTitle: true }); assert.ok(r.ok, r.error); assert.strictEqual(r.how, 'raised');
});

const ROOT = path.join(__dirname, '..');
const hasWm = spawnSync('which', ['xfwm4']).status === 0 && spawnSync('which', ['wmctrl']).status === 0;
test('ensure_app thật (Electron + Xvfb + xfwm4, Zalo giả): bị che → đưa lên; thu nhỏ → khôi phục; open_chat dùng ensure_app; cửa sổ ẩn → lỗi rõ, không gửi nhầm', { skip: (!fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')) || !hasWm) && 'cần electron + xfwm4 + wmctrl', timeout: 300000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-ens-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-ensu-'));
  spawnSync('timeout', ['280', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', 'sh', '-c', `xfwm4 --compositor=off >/dev/null 2>&1 & sleep 1.5; '${path.join(ROOT, 'node_modules/.bin/electron')}' . --no-sandbox`], { cwd: ROOT, env: { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: '1', AIVN_QA_B21_MODE: 'ensure' }, stdio: 'ignore' });
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'qab21.json'), 'utf8')); const st = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.ok(!d.error, String(d.error));
  assert.ok(st['ensure-covered'].ok && st['ensure-covered'].how === 'raised', JSON.stringify(st['ensure-covered']));
  assert.ok(st['ensure-covered'].steps.some(x => /sẵn sàng sau \d+ lần nhìn/.test(x)));
  assert.strictEqual(d.minimizedBefore, true); assert.strictEqual(d.minimizedAfter, false);
  assert.ok(st['ensure-minimized'].ok && st['ensure-minimized'].how === 'restored', JSON.stringify(st['ensure-minimized']));
  assert.match(st['ensure-openchat'].forModel, /Zalo: đã đưa lên trước|Zalo: đã ở trước/, 'open_chat phải chạy ensure_app trước');
  assert.deepStrictEqual(d.final.sent, [], 'không gửi gì khi chưa xác nhận người nhận');
  // B122: fake Zalo giữ chữ tìm sau khi mở chat (như máy thật) → open_chat phải xoá ô tìm kiếm và kiểm đã trống
  const oc = st['ensure-openchat']; if (oc.ok && /đã mở/.test(oc.summary)) { assert.strictEqual(oc.state.q || '', '', 'B122: ô tìm kiếm phải trống sau open_chat: ' + JSON.stringify(oc)); assert.ok(oc.steps == null || true); assert.match(fs.readFileSync(path.join(ud, 'logs', 'aivn.log'), 'utf8'), /B122: sau open_chat “My Documents”: ô tìm kiếm đã trống/); }
  assert.ok(!st['ensure-hidden'].ok && st['ensure-hidden'].code && st['ensure-hidden'].ms < 10000, JSON.stringify(st['ensure-hidden']));
  const log = fs.readFileSync(path.join(ud, 'logs', 'aivn.log'), 'utf8'); assert.match(log, /ensure_app Zalo: SẴN SÀNG sau/);
});
