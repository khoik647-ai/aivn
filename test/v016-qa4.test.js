// QA lượt 4 (21/10/2026): B27 chatGate theo màn hình, B28 cửa sổ đang mở, B29 open_app/open_url tự làm nhưng không lan man, B30 câu trả lời trống
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'); const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SV = require('../src/agent/send-verify');
const CT = require('../src/agent/computer-tools');
const AG = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');

test('B27: màn hình cho thấy ĐÚNG người nhận (tiêu đề “Telegram - Tên”, đầu khung chat) → mở khoá; tên gần giống / chú thích lạ / tiêu đề nêu chat khác → vẫn chặn', () => {
  assert.ok(SV.chatShown('Trần Quỳnh Anh', 'Telegram - Trần Quỳnh Anh', []));
  assert.ok(SV.chatShown('thầy Lê Văn Hùng', 'Microsoft Teams', ['Lê Văn Hùng · Đang hoạt động']));
  assert.ok(!SV.chatShown('Trần Quỳnh Anh', 'Telegram - Trần Quỳnh Như', ['Trần Quỳnh Anh']), 'tiêu đề nêu chat khác thắng chữ OCR');
  assert.ok(!SV.chatShown('thầy Lê Văn Hùng', 'Teams', ['Lê Văn Hùng (SV K26)']), 'B20: chú thích lạ = người khác');
  assert.ok(!SV.chatShown('Trần Quỳnh Anh', 'Telegram', ['Nhóm Trần Quỳnh Anh và bạn bè']), 'nhóm có chứa tên ≠ chat riêng');
  assert.ok(!SV.chatShown('Trần Quỳnh Anh', 'Telegram', []));
  const q = 'Nhắn tin cho Trần Quỳnh Anh trên Telegram: "Gửi mình file slide nhé"';
  const st = {}; // không có cờ nội bộ chatOpen
  assert.strictEqual(SV.chatGate({ query: q, text: 'Gửi mình file slide nhé', title: 'Telegram - Trần Quỳnh Anh', state: st, header: ['Tệp', 'Sửa Xem Cửa số'] }), null, 'thanh menu không phải tiêu đề chat');
  assert.strictEqual(st.chatOpen, SV.nameKey('Trần Quỳnh Anh'));
  assert.match(SV.chatGate({ query: q, text: 'Gửi mình file slide nhé', title: 'Telegram - Trần Quỳnh Như', state: {}, header: [] }), /CHƯA gõ tin/);
  // B21 vẫn giữ: gõ TÊN vào ô chưa xác nhận là ô tìm kiếm luôn bị chặn, kể cả khi chat đúng đang mở
  assert.match(SV.chatGate({ query: q, text: 'Trần Quỳnh Anh', title: 'Telegram - Trần Quỳnh Như', state: {}, header: [] }), /KHÔNG gõ/);
  const regions = SV.regionsOf({ win: { b: [0, 0, 1000, 600] }, elements: [{ name: 'Tệp', ocr: true, b: [10, 5, 30, 20] }, { name: 'Sửa Xem Cửa số', ocr: true, b: [60, 5, 200, 20] }, { name: 'Trần Quỳnh Anh', ocr: true, b: [500, 40, 200, 30] }] });
  assert.deepStrictEqual(regions.header, ['Trần Quỳnh Anh']);
});
test('B27: desktop-agent — bấm kết quả sau khi gõ tìm + Enter (kể cả có thao tác khác xen giữa) vẫn tính là mở; kiểm lại bằng màn hình; không lặp vô tận', () => {
  const d = rd('src/desktop-agent.js');
  assert.match(d, /s\.lastSearch = \{ q, at: Date\.now\(\) \}/);
  assert.match(d, /recentSearch && SV\.relates\(recentSearch\.q, rcp\)/);
  assert.match(d, /SV\.chatShown\(rcp, o\.obs\.win \? o\.obs\.win\.title : '', R \? R\.header : \[\]\)/);
  assert.match(d, /s\.gateBlocks >= 3/); assert.match(d, /DỪNG, không thử lại nữa/);
  assert.match(d, /else if \(strongOpen && \(v\.recipientSeen \|\| !readable\)\)/, 'không đọc được tiêu đề: chỉ tin cú bấm vào đúng kết quả đã ghi nhận');
});

function mkTools(wins, settings = {}) {
  const log = { opened: [], focused: [] };
  const ct = CT.createComputerTools({ getSettings: () => ({ agentComputer: true, ...settings }), openExternal: async (u) => { log.opened.push(u); }, listWindows: async () => wins, focusWindow: async (w) => { log.focused.push(w.hwnd); }, log: () => {} });
  return { ct, log };
}
const WINS = [{ hwnd: 1, title: 'Trò chuyện | Nhóm Lớp K27 | Microsoft Teams', proc: 'teams' }, { hwnd: 2, title: 'Hộp thư đến (3) - qa@gmail.com - Gmail', proc: 'chrome' }, { hwnd: 3, title: 'AIVN', proc: 'aivn' }];
test('B28: cửa sổ đang mở được nhận ra trên MỌI hệ điều hành, trước list_apps / open_app', async () => {
  const { ct, log } = mkTools(WINS);
  assert.deepStrictEqual((await ct.relevantWindows('Trên Teams, nhắn nhóm Lớp K27')).map(w => w.hwnd), [1]);
  assert.deepStrictEqual((await ct.relevantWindows('Trong Gmail đang mở, soạn thư cho thầy')).map(w => w.hwnd), [2]);
  assert.deepStrictEqual(await ct.relevantWindows('Viết bài thơ về mùa thu'), []);
  const la = await ct.exec('list_apps', { query: 'Teams' }, { userQuery: 'Trên Teams nhắn' });
  assert.match(la.forModel, /ĐANG MỞ trên máy: “Trò chuyện \| Nhóm Lớp K27 \| Microsoft Teams”/); assert.match(la.forModel, /Đừng nói ứng dụng chưa cài/);
  const oa = await ct.exec('open_app', { name: 'Teams' }, { userQuery: 'Trên Teams nhắn' });
  assert.match(oa.forModel, /ĐÃ có cửa sổ đang mở/); assert.deepStrictEqual(log.focused, [1]);
  assert.match(rd('src/agent/agent.js'), /Cửa sổ ĐANG MỞ liên quan: /);
});
test('B28: AIVN AGENT không bao giờ nói “chưa cài” khi cửa sổ ứng dụng đang mở (nhắc lại một lần, rồi sửa câu trả lời)', async () => {
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qa4-'));
  const replies = [{ text: '', toolCalls: [{ id: 'a', name: 'list_apps', arguments: { query: 'Teams' } }], finishReason: 'tool_calls', usage: {} }, { text: 'Ứng dụng Teams không được tìm thấy trên máy.', toolCalls: [], finishReason: 'stop', usage: {} }, { text: 'Ứng dụng Teams chưa được cài trên máy.', toolCalls: [], finishReason: 'stop', usage: {} }];
  const calls = [];
  const engine = { status: () => ({ loaded: true, contextSize: 8192 }), chatStep: async (msgs, o) => { calls.push(msgs[msgs.length - 1].content); const r = replies.shift(); return r || { text: 'Ứng dụng Teams chưa được cài trên máy.', toolCalls: [], finishReason: 'stop', usage: {} }; } };
  const { ct } = mkTools(WINS);
  const names = ['open_app', 'list_apps', 'screen_look', 'screen_act'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, relevantWindows: ct.relevantWindows, exec: (n, a, c) => ct.exec(n, a, c) };
  const agent = AG.createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  const r = await agent.run({ messages: [{ role: 'user', content: 'Trên Teams đang mở, nhắn nhóm Lớp K27: "Mai nghỉ học"' }], confirm: async () => true });
  assert.ok(calls.some(c => /ĐANG MỞ trên máy — cửa sổ/.test(String(c))), 'nhắc mô hình là cửa sổ đang mở');
  assert.ok(!/chưa được cài|không được tìm thấy/.test(r.text), r.text); assert.match(r.text, /ĐANG MỞ trên máy/);
});
test('B29: open_app/open_url không cần thẻ duyệt, nhưng không nhảy sang ứng dụng/trang không liên quan; mạng tắt → open_url bị chặn rõ ràng', async () => {
  const { ct, log } = mkTools(WINS);
  const ctx = { userQuery: 'Trong Gmail đang mở, soạn và gửi email cho thầy Hùng' };
  const m = await ct.exec('open_app', { name: 'Máy tính' }, ctx); assert.ok(m.refused); assert.match(m.forModel, /KHÔNG mở “Máy tính”/);
  const z = await ct.exec('open_app', { name: 'Zalo' }, ctx); assert.ok(z.refused);
  const g = await ct.exec('open_url', { url: 'https://mail.google.com' }, ctx); assert.match(g.forModel, /ĐÃ có cửa sổ đang mở/); assert.deepStrictEqual(log.opened, []);
  const u = await ct.exec('open_url', { url: 'https://example.com' }, { userQuery: 'mở example.com' }); assert.ok(u.refused); assert.match(u.forModel, /truy cập mạng” đang TẮT/); assert.deepStrictEqual(log.opened, []);
  // mở thất bại → không chuyển sang ứng dụng khác người dùng không nhắc tới
  const { ct: ct2 } = mkTools([], { agentWeb: true });
  const c2 = { userQuery: 'mở Outlook rồi soạn thư' }; c2.openFails = ['Outlook'];
  const b = await ct2.exec('open_app', { name: 'trình duyệt' }, c2); assert.ok(b.refused); assert.match(b.forModel, /chưa mở được “Outlook”/);
  // lời chào: không hứa thẻ duyệt cho việc mở; thẻ duyệt vẫn cho gửi/xoá/mua/khoá máy/âm lượng
  const W = AG.welcomeFor({ lang: 'vi' }); assert.ok(!/Mở ứng dụng, tệp, trang web và chạy lệnh trên máy, nhưng chỉ khi bạn đồng ý/.test(W)); assert.match(W, /Tự mở ứng dụng, tệp và trang web/); assert.match(W, /gửi tin, xoá, mua hàng, khoá máy hay chỉnh âm lượng thì hỏi bạn trên thẻ duyệt/);
  assert.match(AG.welcomeFor({ lang: 'en' }), /approval card first/); assert.match(AG.welcomeFor({ lang: 'zh' }), /批准卡片/);
  assert.match(rd('src/agent/agent.js'), /web_search\/fetch_url\/open_url: ĐANG TẮT/);
});
test('B30: trả lời trống, không gọi công cụ → buộc gọi công cụ một lần, rồi báo rõ “mô hình không trả lời”; mô hình đã qua cổng thì không khuyên đổi mô hình', async () => {
  assert.strictEqual(AG.noActionWarn([], true), AG.NO_ACTION_OK_WARN); assert.strictEqual(AG.noActionWarn([], false), AG.NO_ACTION_WARN);
  assert.ok(!/chọn một mô hình/.test(AG.NO_ACTION_OK_WARN));
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qa4-'));
  const opts = [];
  const engine = { status: () => ({ loaded: true, contextSize: 8192 }), chatStep: async (msgs, o) => { opts.push(o.toolChoice); return { text: '', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 1 } }; } };
  const names = ['open_app', 'screen_look', 'screen_act'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async () => ({ forModel: 'ok', summary: 'ok' }) };
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: false }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  const r = await agent.run({ messages: [{ role: 'user', content: 'Trong Outlook đang mở, soạn thư gửi thầy Hùng' }], confirm: async () => true });
  assert.ok(opts.includes('required'), 'đã buộc gọi công cụ'); assert.match(r.text, /Mô hình không trả lời/); assert.ok(r.warning !== AG.NO_ACTION_WARN, 'không khuyên đổi mô hình');
  assert.match(rd('src/main.js'), /gateOk: \(\) => lastGateOk/);
});
test('Màn hình Máy chủ API: không còn chữ tiếng Anh trong giao diện tiếng Việt (base URL, LAN, CORS, TTL, JIT, Preset)', () => {
  const h = rd('src/renderer/index.html'); const i = h.indexOf('<h2>Máy chủ API cục bộ</h2>'); const seg = h.slice(i, h.indexOf('class="grid2"', i)).replace(/<code>[^<]*<\/code>|<[^>]+>|http:\/\/\S+/g, ' ');
  for (const w of ['base URL', 'LAN', 'CORS', 'TTL', 'JIT']) assert.ok(!new RegExp(`\\b${w}\\b`).test(seg), w);
  assert.ok(!/`Preset: /.test(rd('src/renderer/app.js'))); assert.ok(!/'Mở cho LAN'/.test(rd('src/renderer/app.js')));
});
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
test('B27 thật (Telegram giả, “Trần Quỳnh Như” mở sẵn): tìm + Enter → thao tác khác → bấm kết quả → gõ tin = gửi đúng “Trần Quỳnh Anh”; bấm nhầm người → vẫn chặn', { skip: !hasX && 'cần xvfb-run + electron', timeout: 360000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b27-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b27-ud-'));
  const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: '1', AIVN_QA_B21_MODE: 'telegram' });
  const r = spawnSync('timeout', ['300', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: root, encoding: 'utf8', env });
  const f = path.join(dir, 'qab21.json'); assert.ok(fs.existsSync(f), 'QA B27 không chạy xong: ' + (r.stderr || '').slice(-800));
  const d = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!d.error, d.error);
  const by = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.ok(by['tg-before-open'].blocked); assert.ok(by['tg-send-trap'].blocked, 'chat sai vẫn bị chặn'); assert.deepStrictEqual(d.afterBad.sent, []);
  assert.deepStrictEqual(by['tg-type-search'].state.searches, ['Trần Quỳnh Anh']);
  // chữ vừa gõ trong ô (ngay dưới nhãn “Tìm kiếm”) không bị đếm là người thứ hai cùng tên, và bấm theo tên trúng dòng kết quả
  assert.match(by['tg-type-search-2'].forModel, /THẤY kết quả khớp/); assert.ok(!/NHIỀU người cùng tên/.test(by['tg-type-search-2'].forModel));
  assert.strictEqual(by['tg-click-result'].state.cur, 'Trần Quỳnh Anh'); assert.match(by['tg-click-result'].forModel, /Đã mở cuộc trò chuyện với “Trần Quỳnh Anh”/);
  assert.ok(!by['tg-send'].blocked, by['tg-send'].forModel);
  assert.deepStrictEqual(d.final.sent, [{ to: 'Trần Quỳnh Anh', text: 'Gửi mình file slide nhé' }]);
});
test('Bản thử 0.16.0-beta.x: tự cập nhật không bao giờ hạ cấp (về 0.15.3), không tìm kênh beta; lên được 0.16.0 ổn định', () => {
  const U = require('../src/updater');
  assert.ok(!U.isNewer('0.15.3', '0.16.0-beta.1')); assert.ok(U.isNewer('0.16.0', '0.16.0-beta.1')); assert.ok(U.isNewer('0.16.0-beta.2', '0.16.0-beta.1'));
  assert.ok(!U.isNewer('0.16.0-beta.1', '0.16.0-beta.1')); assert.ok(U.isNewer('0.16.0-beta.10', '0.16.0-beta.9')); assert.ok(U.isNewer('0.16.0', '0.15.3'));
  const s = rd('src/updater.js');
  assert.match(s, /autoUpdater\.allowDowngrade = false; autoUpdater\.allowPrerelease = false;/);
  assert.match(s, /!isNewer\(info\.version, app\.getVersion\(\)\) \? set\(\{ status: 'latest'/);
  assert.ok(!/\.channel\s*=/.test(s), 'đặt channel sẽ tự bật allowDowngrade trong electron-updater');
});
test('B31: câu tiếng Trung vẫn có người nhận; việc gửi tin mà không đọc được người nhận → chặn và hỏi (không cho qua)', () => {
  assert.strictEqual(SV.recipientOf('在 Messenger 上给 Trần Quỳnh Anh 发消息：明天8点开会'), 'Trần Quỳnh Anh');
  assert.strictEqual(SV.recipientOf('发消息给 Trần Quỳnh Anh：明天8点开会'), 'Trần Quỳnh Anh');
  assert.strictEqual(SV.recipientOf('给 Trần Quỳnh Anh 发一条消息：你好'), 'Trần Quỳnh Anh');
  const q = '在 Messenger 上给 Trần Quỳnh Anh 发消息：明天8点开会';
  assert.match(SV.chatGate({ query: q, text: '明天8点开会', title: 'Messenger - Nhóm Lớp K27', proc: 'messenger', state: {}, header: ['Nhóm Lớp K27'] }), /TÌM và MỞ/);
  const v = SV.verifySend({ msg: '明天8点开会', recipient: SV.recipientOf(q), regions: { header: ['Nhóm Lớp K27'], messages: ['明天8点开会'], composer: [] }, winTitle: 'Messenger - Nhóm Lớp K27' });
  assert.ok(!v.sent && v.wrongChat);
  assert.match(SV.chatGate({ query: '在 Zalo 上告诉 Trần Quỳnh Anh 明天8点开会', text: '明天8点开会', title: 'Zalo', proc: 'zalo', state: {}, header: ['Nhóm Lớp K27'] }) || '', /không xác định được NGƯỜI NHẬN|TÌM và MỞ/);
  assert.strictEqual(SV.chatGate({ query: 'mở Zalo xem tin mới', text: 'abc', title: 'Zalo', proc: 'zalo', state: {}, header: [] }), null, 'không phải gửi tin: không chặn');
});
