// 0.16 beta.3 — QA máy thật lượt 9: B66 (ứng dụng web, vòng lặp chu kỳ, cờ phím Windows, Win+D), B67 (không báo “Xong” giả),
// B69 (một chốt GỬI duy nhất + nhật ký xin phép), B70 (không bao giờ tự gửi lại; ảnh kiểm chứng không chụp cửa sổ AIVN)
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const K = require('../src/agent/keys'); const SG = require('../src/agent/send-gate'); const CY = require('../src/agent/cycle'); const C = require('../src/agent/computer');
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));

// ---------- B66c: cờ phím ----------
// tên phím/cờ thật có trong bảng của libnut cho từng hệ điều hành (đọc thẳng từ tệp .node đã cài)
function nutNames(pf) {
  const f = path.join(root, `node_modules/@nut-tree-fork/libnut-${pf}/build/Release/libnut.node`); if (!fs.existsSync(f)) return null;
  const buf = fs.readFileSync(f); const out = new Set(); let cur = '';
  for (const b of buf) { if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b); else { if (cur.length >= 1 && cur.length <= 20) out.add(cur); cur = ''; } }
  return out;
}
const COMBOS = ['win+d', 'win + s', ' Win + E ', 'WIN+R', 'meta+l', 'super+a', 'ctrl+f', 'Ctrl + Shift + T', 'cmd+f', 'command+v', 'alt+tab', 'alt + f4', 'shift+tab', 'ctrl+enter', 'alt+s',
  'enter', 'esc', 'tab', 'space', 'backspace', 'delete', 'up', 'down', 'pageup', 'pagedown', 'home', 'end', 'f5', 'f11', 'ctrl+a', 'ctrl+-', 'ctrl++', 'ctrl+plus', 'ctrl+=', 'printscreen', 'ctrl+alt+del', 'ctrl+alt+delete', 'ctrl+shift+esc', 'win'];
test('B66c: “Invalid key flag specified.” — cờ “command” không có trên Windows/Linux; mọi tổ hợp chỉ dùng tên có thật trong libnut của hệ điều hành đó', () => {
  for (const pf of ['win32', 'linux', 'darwin']) {
    const names = nutNames(pf); // tệp .node của Linux xếp bảng tên khác (không tách được) → Linux kiểm bằng bộ dò thật bên dưới
    for (const c of COMBOS) {
      let k; try { k = K.parse(c, pf); } catch (e) { assert.match(e.message, /không bấm tổ hợp phím hệ thống/, `${pf} ${c}: ${e.message}`); continue; }
      assert.ok(!k.mods.includes('command'), `${pf} ${c}: còn cờ “command”`);
      if (pf !== 'darwin') assert.ok(!k.mods.includes('cmd') && k.key !== 'cmd', `${pf} ${c}: “cmd” chỉ có trên macOS`);
      if (names && names.has('control') && names.has('alt')) for (const n of [...k.mods, k.key]) assert.ok(n.length === 1 || names.has(n), `${pf} ${c}: libnut-${pf} không có tên “${n}”`);
    }
  }
  assert.deepStrictEqual(K.parse('win + s', 'win32'), { key: 's', mods: ['meta'], combo: 'meta+s', hidesAll: false, media: false });
  assert.deepStrictEqual(K.parse(' WIN+D ', 'win32').mods, ['meta']); assert.ok(K.parse('win+d', 'win32').hidesAll); assert.ok(K.parse('Win + M', 'win32').hidesAll);
  assert.deepStrictEqual(K.parse('cmd+f', 'win32').mods, ['control'], 'Cmd+F trên Windows = Ctrl+F');
  assert.deepStrictEqual(K.parse('cmd+v', 'darwin').mods, ['cmd']); assert.deepStrictEqual(K.parse('win+space', 'darwin').mods, ['cmd']);
  assert.strictEqual(K.primaryOf('darwin'), 'cmd'); assert.strictEqual(K.primaryOf('win32'), 'control');
  for (const c of ['ctrl+alt+del', 'ctrl+alt+delete', 'Ctrl + Alt + Delete', 'alt+f4', 'ctrl+shift+esc', 'win+l']) assert.throws(() => K.parse(c, 'win32'), /không bấm tổ hợp phím hệ thống/, c);
  assert.throws(() => K.parse('ctrl+banana', 'win32'), /không biết “banana”/);
});
test('B66c: nhật ký mỗi lần bấm phím có tên, mã VK, mã quét, cờ EXTENDEDKEY và cờ libnut', () => {
  const d = K.diag(K.parse('win + s', 'win32'), 'win32');
  assert.match(d, /meta VK 0x5B quét 0x5B \+EXTENDEDKEY/); assert.match(d, /s VK 0x53 quét 0x1F/); assert.match(d, /cờ libnut \[meta\]/);
  assert.match(K.diag(K.parse('up', 'win32'), 'win32'), /up VK 0x26 quét 0x48 \+EXTENDEDKEY · cờ libnut không/);
  assert.match(K.diag(K.parse('ctrl+enter', 'win32'), 'win32'), /control VK 0x11 quét 0x1D · enter VK 0x0D quét 0x1C/);
  const src = fs.readFileSync(path.join(root, 'src/desktop-agent.js'), 'utf8');
  assert.match(src, /deps\.log\('desk', KY\.diag\(k\)\)/); assert.match(src, /Bộ gửi phím không bấm được/);
  assert.doesNotMatch(src + fs.readFileSync(path.join(root, 'src/screen-control.js'), 'utf8'), /'darwin' \? 'command'/, 'không còn cờ “command”');
});
test('B66d: Win+D / Win+M (thu nhỏ mọi cửa sổ) và system_action show_desktop chỉ khi người dùng xin', async () => {
  assert.ok(!C.sysAsked('show_desktop', 'soạn email mới trong Gmail gửi cho thầy'));
  assert.ok(C.sysAsked('show_desktop', 'hiện màn hình chính giúp mình'));
  const src = fs.readFileSync(path.join(root, 'src/desktop-agent.js'), 'utf8'); assert.match(src, /k\.hidesAll && !require\('\.\/agent\/computer'\)\.sysAsked\('show_desktop'/);
  const CT = require('../src/agent/computer-tools');
  const tools = CT.createComputerTools({ platform: 'win32', getSettings: () => ({ agentComputer: true }), openPath: async () => '', openExternal: async () => {} });
  await assert.rejects(() => tools.exec('system_action', { action: 'show_desktop' }, { userQuery: 'soạn email trong Gmail', confirm: async () => true }), /Không hiện màn hình chính: người dùng không yêu cầu/);
});

test('B61 (lượt 9): “soạn thư/email cho/gửi X” có người nhận — không hỏi “Gửi cho ai?” nhầm; người nhận không dính chữ “gửi”', () => {
  const SV = require('../src/agent/send-verify');
  for (const [q, n] of [['Mở Gmail và soạn thư mới cho thầy Nam', 'thầy Nam'], ['soạn email gửi thầy Nam', 'thầy Nam'], ['viết email cho Trần Quỳnh Anh nội dung: hẹn mai', 'Trần Quỳnh Anh'], ['gửi email cho thầy Nam', 'thầy Nam']]) { assert.strictEqual(SV.recipientOf(q), n, q); assert.ok(!SV.missingRecipient(q), q); }
  for (const q of ['soạn email nhé', 'nhắn giúp mình là mai 8h họp nhé']) assert.ok(SV.missingRecipient(q), q);
});
test('B66c: bộ gửi phím Linux thật (Xvfb): cờ meta/control/alt/shift nhận, “command”/“cmd” báo đúng lỗi cũ', { skip: (spawnSync('which', ['Xvfb']).status !== 0) && 'cần Xvfb' }, () => {
  const disp = ':' + (90 + Math.floor(Math.random() * 9)); const x = require('child_process').spawn('Xvfb', [disp, '-screen', '0', '640x480x24'], { stdio: 'ignore' });
  try { spawnSync('sleep', ['1']);
    const probe = (flag) => spawnSync(process.execPath, ['-e', `const n=require('@nut-tree-fork/libnut-linux');try{n.keyTap('a',${JSON.stringify(flag)});console.log('ok')}catch(e){console.log('ERR '+e.message)}`], { cwd: root, env: { ...process.env, DISPLAY: disp }, encoding: 'utf8' }).stdout.trim();
    assert.strictEqual(probe('command'), 'ERR Invalid key flag specified.'); assert.strictEqual(probe('cmd'), 'ERR Invalid key flag specified.');
    for (const c of ['win + s', 'ctrl+shift+t', 'alt+tab', 'cmd+f']) { const k = K.parse(c, 'linux'); assert.strictEqual(probe(k.mods.length === 1 ? k.mods[0] : k.mods), 'ok', c); }
  } finally { x.kill(); }
});

// ---------- B66a: ứng dụng web ----------
test('B66a: Gmail/YouTube/Google Docs… là ứng dụng web; Messenger/Telegram/Outlook thường có bản cài', () => {
  assert.deepStrictEqual(C.webApp('Gmail'), { name: 'Gmail', url: 'https://mail.google.com/', webOnly: true });
  assert.strictEqual(C.webApp('gmail web').webOnly, true); assert.strictEqual(C.webApp('YouTube').url, 'https://www.youtube.com/'); assert.strictEqual(C.webApp('Google Docs').name, 'Google Docs');
  assert.strictEqual(C.webApp('trang Facebook').name, 'Facebook'); assert.strictEqual(C.webApp('Outlook web').webOnly, true);
  assert.strictEqual(C.webApp('Messenger').webOnly, false); assert.strictEqual(C.webApp('Outlook').webOnly, false);
  assert.strictEqual(C.webApp('Zalo'), null); assert.strictEqual(C.webApp('Word'), null); assert.strictEqual(C.webApp('Notepad'), null);
});
function webTools({ windows = [], deep = [], agentWeb = true } = {}) {
  const CT = require('../src/agent/computer-tools'); const opened = []; const focused = []; const launched = [];
  const tools = CT.createComputerTools({ platform: 'win32', getSettings: () => ({ agentComputer: true, agentWeb }), visionReady: () => false, openPath: async () => '', openExternal: async (u) => { opened.push(u); }, log: () => {},
    deepApps: async () => Object.assign(deep.slice(), { diag: { sources: {}, errors: [] } }), psRun: async () => 'fail', openAppOverride: async (c) => { launched.push(c.path); },
    windows: async () => windows, listWindows: async () => windows, focusWindow: async (w) => { focused.push(w.title); }, sleep: async () => {} });
  return { tools, opened, focused, launched };
}
test('B66a: open_app("Gmail") → thẻ Gmail đang mở thì chuyển tới; không có thì mở https://mail.google.com/ (không tìm như ứng dụng cài)', async () => {
  { const { tools, opened, focused, launched } = webTools({ windows: [{ hwnd: 1, pid: 5, proc: 'chrome', title: 'Hộp thư đến (3) - khoi@gmail.com - Gmail - Google Chrome' }] });
    const r = await tools.exec('open_app', { name: 'Gmail' }, { userQuery: 'soạn email mới trong Gmail' });
    assert.match(r.forModel, /ĐÃ có cửa sổ/); assert.deepStrictEqual(focused, ['Hộp thư đến (3) - khoi@gmail.com - Gmail - Google Chrome']); assert.deepStrictEqual(opened, []); assert.deepStrictEqual(launched, []); }
  { const { tools, opened, launched } = webTools({ deep: [{ name: 'Gmail Notifier Pro', path: 'C:\\SM\\gnp.lnk', source: 'startmenu' }] });
    const r = await tools.exec('open_app', { name: 'Gmail' }, { userQuery: 'soạn email mới trong Gmail' });
    assert.deepStrictEqual(opened, ['https://mail.google.com/']); assert.deepStrictEqual(launched, [], 'không mở ứng dụng gần giống'); assert.match(r.forModel, /là ứng dụng web/); }
  { const { tools, opened } = webTools({ agentWeb: false });
    const r = await tools.exec('open_app', { name: 'YouTube' }, { userQuery: 'mở YouTube' });
    assert.ok(r.refused, 'tắt truy cập mạng → không mở trang'); assert.deepStrictEqual(opened, []); }
});

// ---------- B66b / B67: vòng lặp chu kỳ, “Xong” giả ----------
test('B66b: phát hiện chuỗi lặp chu kỳ 2–6 thao tác và nhiều bước không tiến triển; chuỗi bình thường không bị chặn', () => {
  const g = CY.createCycleGuard();
  const cyc = [['screen_act', { action: 'hotkey', keys: 'win+d' }, 'bấm phím win+d'], ['screen_look', {}, '“Program Manager” · 3 phần tử'], ['screen_act', { action: 'click', element: 'e4' }, 'Lỗi'], ['open_app', { name: 'Cài đặt' }, 'Đã mở Cài đặt']];
  let stuck = null; let n = 0;
  for (let r = 0; r < 10 && !stuck; r++) for (const [nm, a, sum] of cyc) { n++; g.push(nm, a, { summary: sum, error: sum === 'Lỗi' ? 'x' : undefined }); stuck = g.stuck(); if (stuck) break; }
  assert.ok(stuck, 'phải dừng'); assert.strictEqual(stuck.kind, 'cycle'); assert.strictEqual(stuck.period, 4); assert.strictEqual(n, 8, 'dừng ngay sau 2 vòng (8 bước), không phải 44');
  const g2 = CY.createCycleGuard();
  for (const [nm, a, sum] of [['open_app', { name: 'Zalo' }, 'Đã mở Zalo'], ['screen_act', { action: 'click', element: 'e3' }, 'bấm “Tìm kiếm”'], ['screen_act', { action: 'type_text', text: 'An' }, 'gõ “An”'], ['screen_act', { action: 'click', element: 'e9' }, 'bấm “An”'], ['screen_act', { action: 'type_text', text: 'chào', submit: true }, 'gõ “chào” rồi Enter']]) { g2.push(nm, a, { summary: sum }); assert.strictEqual(g2.stuck(), null); }
  const g3 = CY.createCycleGuard({ window: 6 }); for (let i = 0; i < 7; i++) g3.push('screen_look', {}, { summary: 'giống nhau' });
  assert.strictEqual(g3.stuck().kind, 'noprogress');
});
test('B66b + B67: mô hình quay vòng 4 thao tác → AIVN dừng sớm, câu trả lời nói thật (không “Xong: (lặp lại) …”)', async () => {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qa9-'));
  const cyc = [{ name: 'screen_act', arguments: { action: 'hotkey', keys: 'win+d' } }, { name: 'screen_look', arguments: {} }, { name: 'screen_act', arguments: { action: 'click', element: 'e4' } }, { name: 'open_app', arguments: { name: 'Cài đặt' } }];
  let i = 0; const execs = [];
  const engine = { status: () => ({ loaded: true, contextSize: 16384 }), chatStep: async () => { const c = cyc[i % 4]; i++; return { text: '', toolCalls: [{ id: 'c' + i, ...c }], finishReason: 'tool_calls', usage: {} }; } };
  const names = ['open_app', 'screen_look', 'screen_act']; const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { execs.push(n); if (n === 'screen_act' && a.action === 'click') throw new CT.CompError('Không thấy phần tử e4'); return n === 'screen_look' ? { forModel: '“Program Manager” · 3 phần tử', summary: '“Program Manager” · 3 phần tử' } : { forModel: 'ok', summary: n === 'open_app' ? 'Mở Cài đặt hệ thống' : 'bấm phím win+d' }; } };
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: true, uiLang: 'vi', agentMaxRounds: 30 }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  const r = await agent.run({ messages: [{ role: 'user', content: 'Mở Gmail và soạn thư mới cho thầy Nam' }], confirm: async () => true });
  assert.ok(execs.length <= 10, `dừng sớm (đã làm ${execs.length} bước)`);
  assert.doesNotMatch(r.text, /^Xong/); assert.doesNotMatch(r.text, /\(lặp lại\)/); assert.match(r.text, /chưa làm xong/);
});
test('B67: “Xong: …” chỉ khi đã kiểm chứng — nguồn: doneText thay cho “Xong: ” + bước cuối', () => {
  const src = fs.readFileSync(path.join(root, 'src/agent/agent.js'), 'utf8');
  assert.doesNotMatch(src, /'Xong: ' \+ lastOk\.summary/); assert.match(src, /const doneText = \(\) =>/); assert.match(src, /chưa kiểm chứng được trên màn hình là việc đã xong/);
});

// ---------- B69: một chốt GỬI ----------
test('B69: chốt GỬI — mọi đường có thể gửi đều là “gửi”; gõ tên người nhận vào ô tìm kiếm thì không', () => {
  const chat = { chatOpen: true, recipient: 'Trần Quỳnh Anh', messaging: true, searchTarget: false, lastTyped: '' };
  // gõ vào ô đang chọn + Enter sau khi đã mở chat (đúng lỗi máy thật)
  assert.ok(SG.classify('type_text', { text: 'Chúc ngủ ngon nhé!', submit: true }, chat).send);
  // kể cả khi bộ đoán “ô tìm kiếm” (theo thời gian) nói là ô tìm kiếm — nội dung tin không phải tên người nhận
  assert.ok(SG.classify('type_text', { text: 'Chúc ngủ ngon nhé!', submit: true }, { ...chat, searchTarget: true }).send);
  assert.ok(SG.classify('type_text', { text: 'Mai 8h họp nhé\n' }, { ...chat, chatOpen: false }).send, 'xuống dòng = Enter');
  // ô tìm kiếm + tên người nhận (kể cả không dấu / một phần) → tìm, không phải gửi
  for (const nm of ['Trần Quỳnh Anh', 'tran quynh anh', 'Quỳnh Anh']) assert.ok(!SG.classify('type_text', { text: nm, submit: true }, { ...chat, chatOpen: false, searchTarget: true }).send, nm);
  assert.ok(!SG.classify('type_text', { text: 'Trần Quỳnh Anh', submit: true }, { ...chat, searchTarget: true }).send, 'tìm lại người nhận khi chat đang mở');
  assert.ok(!SG.classify('type_text', { text: 'bao cao.docx', submit: true }, { searchTarget: true }).send, 'việc không phải nhắn tin: ô tìm kiếm đã xác nhận');
  assert.ok(!SG.classify('type_text', { text: 'chào' }, chat).send, 'chỉ gõ, chưa Enter');
  // phím: Enter / Ctrl+Enter (Gmail) / Alt+S (Outlook) sau khi gõ
  for (const k of ['enter', 'Enter', ' return ', 'ctrl+enter', 'Ctrl + Enter', 'cmd+enter', 'alt+s']) assert.ok(SG.classify('hotkey', { keys: k }, { lastTyped: 'chào thầy', messaging: true }).send, k);
  assert.ok(!SG.classify('hotkey', { keys: 'enter' }, {}).send, 'Enter khi chưa gõ gì, chưa mở chat');
  assert.ok(!SG.classify('hotkey', { keys: 'ctrl+f' }, chat).send);
  // bấm nút Gửi (vi/en/zh, biểu tượng) — và nút biểu tượng không tên ở hàng ô soạn sau khi đã gõ
  for (const nm of ['Gửi', 'nút Gửi', 'Send', 'Send message', '发送', '➤']) assert.ok(SG.classify('click', {}, { targetName: nm }).send, nm);
  assert.ok(SG.classify('click', {}, { ...chat, lastTyped: 'chào', targetName: '', inComposerRow: true }).send, 'nút mũi tên không tên cạnh ô soạn');
  assert.ok(!SG.classify('click', {}, { ...chat, lastTyped: 'chào', targetName: 'Trần Quỳnh Anh' }).send);
  assert.ok(!SG.classify('click', {}, { targetName: 'Gửi lời mời kết bạn' }).send === false, 'nút có chữ Gửi luôn hỏi');
});
test('B69: chốt nằm trong mã (act + performAt), áp cho chuỗi then[], lời gọi in ra chữ, open_chat; nhật ký ghi xin phép/cho phép/từ chối + người nhận', () => {
  const src = fs.readFileSync(path.join(root, 'src/desktop-agent.js'), 'utf8');
  assert.match(src, /const gate = SendGate\.classify\(action, a, gateState\(\)\)/);
  assert.match(src, /const searchTyping = !gate\.send && /, 'gõ “tìm kiếm” không còn bỏ qua chốt gửi');
  assert.match(src, /const isSend = gate\.send;/);
  assert.match(src, /CHẶN \(B69\): thao tác có thể gửi chưa qua chốt duyệt/); assert.match(src, /if \(a && !a\.__sendOk && !a\.__notSend\)/);
  assert.match(src, /Xin phép \(đã hỏi\)/); assert.match(src, /Xin phép: người dùng \$\{r\.ok \? 'CHO PHÉP'/); assert.match(src, /người nhận “\$\{gateRcp\}”/);
  const ct = fs.readFileSync(path.join(root, 'src/agent/computer-tools.js'), 'utf8');
  assert.match(ct, /out = await deps\.screen\.act\(x, ctx\);/, 'then[]: mỗi thao tác đi qua act() (qua chốt)');
  assert.match(ct, /if \(out\.refused \|\| out\.stop \|\| why\)/, 'then[] dừng khi bị chặn/dừng');
  const ag = fs.readFileSync(path.join(root, 'src/agent/agent.js'), 'utf8');
  assert.match(ag, /xin phép \(đã hỏi\): \$\{call\.name\}/); assert.match(ag, /out = await exec\(call\.name, args, ctxRun\)/, 'lời gọi tách từ chữ chạy cùng đường exec');
});
test('B70: khoá gửi (người nhận, nội dung) — so không dấu, không phân biệt hoa thường', () => {
  assert.strictEqual(SG.sendKey('Trần Quỳnh Anh', 'Gửi mình file slide nhé'), SG.sendKey('tran quynh anh', 'gửi mình FILE slide nhé!'));
  assert.notStrictEqual(SG.sendKey('Trần Quỳnh Anh', 'a'), SG.sendKey('Trần Quỳnh Anh', 'b'));
  const src = fs.readFileSync(path.join(root, 'src/desktop-agent.js'), 'utf8');
  assert.match(src, /Chặn gửi lại \(B70\)/); assert.match(src, /Gửi chưa kiểm chứng → dừng, không gửi lại \(B70\)/);
  assert.match(src, /fgv && fgv\.pid === process\.pid/, 'ảnh kiểm chứng: đưa cửa sổ đích lên trước nếu AIVN đang ở trước');
});
test('B69/B70 (Telegram giả, KHÔNG có câu “không cần hỏi lại”): bước gửi PHẢI hỏi; gửi đúng MỘT lần; gõ lại / Enter / bấm Gửi sau đó đều bị chặn, không hỏi lại', { skip: !hasX && 'cần xvfb-run + electron', timeout: 360000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b69-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b69-ud-'));
  const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: '1', AIVN_QA_B21_MODE: 'b69' });
  const r = spawnSync('timeout', ['300', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: root, encoding: 'utf8', env });
  const f = path.join(dir, 'qab21.json'); assert.ok(fs.existsSync(f), 'không chạy xong: ' + (r.stderr || '').slice(-800));
  const d = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!d.error, d.error);
  const by = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.match(by['b69-open'].forModel, /Đã mở cuộc trò chuyện với “Trần Quỳnh Anh”/);
  assert.ok(by['b69-send'].asks.some(x => x.risk && /GỬI/.test(x.risk)), 'bước gửi phải hỏi: ' + JSON.stringify(by['b69-send'].asks));
  for (const n of ['b70-resend', 'b70-enter', 'b70-click-send']) { assert.ok(by[n].blocked, `${n}: ${by[n].summary}`); assert.deepStrictEqual(by[n].asks, [], `${n}: không hỏi lại`); }
  assert.match(by['b70-resend'].forModel, /không gửi lại/);
  assert.deepStrictEqual(d.final.sent, [{ to: 'Trần Quỳnh Anh', text: 'Gửi mình file slide nhé' }], 'gửi đúng MỘT lần');
  const log = fs.readFileSync(path.join(ud, 'logs', 'aivn.log'), 'utf8');
  assert.match(log, /Xin phép \(đã hỏi\) — bước GỬI: screen_act type_text .*người nhận “Trần Quỳnh Anh”/); assert.match(log, /Xin phép: người dùng CHO PHÉP/);
});
test('Nhật ký aivn.log/engine.log: UTF-8 CÓ BOM nhất quán (PowerShell 5.1 đọc đúng tiếng Việt), BOM đúng một lần, cả sau xoay vòng', () => {
  const L = require('../src/logger'); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-log-'));
  L.init(d); L.log('app', 'Khởi động AIVN — tiếng Việt có dấu: ừ, ặ, Đ'); L.log('load', 'nạp mô hình');
  for (const f of ['aivn.log', 'engine.log']) { const b = fs.readFileSync(path.join(d, f)); assert.deepStrictEqual([...b.slice(0, 3)], [0xef, 0xbb, 0xbf], f); assert.strictEqual(b.toString('utf8').split('\ufeff').length, 2, f + ': BOM một lần'); }
  assert.match(fs.readFileSync(path.join(d, 'aivn.log'), 'utf8'), /tiếng Việt có dấu: ừ, ặ, Đ/);
  assert.ok(!L.tail(5).startsWith('\ufeff'));
  L.init(d); L.log('app', 'lần chạy thứ hai'); assert.strictEqual(fs.readFileSync(path.join(d, 'aivn.log'), 'utf8').split('\ufeff').length, 2, 'mở lại không thêm BOM');
  fs.writeFileSync(path.join(d, 'aivn.log'), '\ufeff' + 'x'.repeat(5 * 1024 * 1024 + 10)); L.log('app', 'sau xoay vòng');
  assert.deepStrictEqual([...fs.readFileSync(path.join(d, 'aivn.log')).slice(0, 3)], [0xef, 0xbb, 0xbf], 'tệp mới sau xoay vòng có BOM');
});
