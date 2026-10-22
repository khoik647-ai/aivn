'use strict';
// Máy thật beta.2.7 (laptop RTX 3050 Ti 4 GB, Qwen3-VL 4B, 16/37 lớp trên GPU): kịch bản A “Mở Chrome tìm giá vàng SJC” thất bại.
// B153 hồ sơ Chrome · B154 mở địa chỉ trong đúng trình duyệt · B155 AIVN tự đọc trang · B156 JavaScript không có DOM · B157 thao tác hệ thống lạc đề · B158 GPU < 6 GB → 2B.
// Mô hình được giả bằng kịch bản kiểu 2B/4B (nói không có fetch_url, gọi run_javascript/document, mở Cài đặt).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const BP = require('../src/agent/browser-profile');
const WR = require('../src/agent/web-read');
const EA = require('../src/agent/ensure-app');
const CT = require('../src/agent/computer-tools');
const { createAgent } = require('../src/agent/agent');

const Q = 'Mở Chrome, tìm giá vàng SJC hôm nay rồi cho tôi biết giá mua vào và bán ra';
const SJC = 'https://sjc.com.vn/';
const SJC_TEXT = 'Công ty Vàng bạc Đá quý Sài Gòn - SJC\nGiá vàng SJC hôm nay\nLoại vàng | Mua vào | Bán ra\nVàng SJC 1L, 10L, 1KG | 139.300.000 | 142.300.000\nVàng nhẫn SJC 99,99 | 136.500.000 | 139.500.000\nLiên hệ: 1800 xxxx\nGiới thiệu · Tuyển dụng';
const GOOGLE = 'https://www.google.com/search?q=gi%C3%A1+v%C3%A0ng+SJC+h%C3%B4m+nay';
const GOOGLE_TEXT = 'Giá vàng SJC hôm nay\nCông ty Vàng bạc Đá quý Sài Gòn - SJC\nhttps://sjc.com.vn › gia-vang\nGiá vàng hôm nay - Giavang.net\ngiavang.net › gia-vang-sjc\nVnExpress\nvnexpress.net › kinh-doanh';

// ---------- B153 ----------
test('B153: hồ sơ đang dùng từ Local State, tham số --profile-directory, nhận ra màn hình chọn hồ sơ', () => {
  const ls = { profile: { last_used: 'Profile 1', info_cache: { Default: { name: 'Cá nhân 1' }, 'Profile 1': { name: 'Khoi Khoi', gaia_name: 'Khôi Nguyễn' } } } };
  assert.deepStrictEqual(BP.lastProfile(JSON.stringify(ls)), { dir: 'Profile 1', name: 'Khoi Khoi', names: ['Khoi Khoi', 'Khôi Nguyễn'] });
  assert.strictEqual(BP.lastProfile('{}').dir, 'Default'); assert.strictEqual(BP.lastProfile('hỏng').dir, 'Default');
  assert.strictEqual(BP.lastProfile({ profile: { last_used: '..\\..\\x' } }).dir, 'Default', 'không nhận đường dẫn lạ');
  const C = BP.byId('chrome');
  assert.deepStrictEqual(BP.launchArgs(C, { dir: 'Profile 1' }), ['--profile-directory=Profile 1']);
  assert.deepStrictEqual(BP.launchArgs(C, { dir: 'Default' }, 'https://sjc.com.vn'), ['--profile-directory=Default', SJC]);
  assert.throws(() => BP.launchArgs(C, { dir: 'Default' }, 'file:///C:/x'));
  // đọc Local State thật trên đĩa (giả %LOCALAPPDATA%)
  const la = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b153-')); const ud = path.win32.join(la, 'Google', 'Chrome', 'User Data');
  const files = { [path.win32.join(ud, 'Local State')]: JSON.stringify(ls) };
  const p = BP.readProfile(C, { env: { LOCALAPPDATA: la }, fs: { readFileSync: (f) => { if (!(f in files)) throw new Error('ENOENT'); return files[f]; } } });
  assert.strictEqual(p.dir, 'Profile 1'); assert.strictEqual(p.userData, ud);
  assert.strictEqual(BP.readProfile(C, { env: { LOCALAPPDATA: la }, fs: { readFileSync: () => { throw new Error('ENOENT'); } } }).dir, 'Default');
  // màn hình chọn hồ sơ (ảnh chụp máy thật: “Ai sẽ sử dụng Chrome?”)
  const pickText = 'Ai sẽ sử dụng Chrome? · Khoi Khoi · Cá nhân 1 · Thêm · Chế độ khách · Hiển thị khi khởi động';
  assert.ok(BP.pickerShown(C, 'Google Chrome', pickText)); assert.ok(BP.pickerShown(C, 'Google Chrome', "Who's using Chrome? · Person 1 · Add"));
  assert.ok(!BP.pickerShown(C, 'Thẻ mới - Google Chrome', pickText), 'cửa sổ có thẻ không phải màn hình chọn hồ sơ');
  assert.ok(BP.blankShown(C, 'Google Chrome', ''));
  const els = [{ name: 'Ai sẽ sử dụng Chrome?', b: [0, 0, 400, 40] }, { name: 'Thêm', b: [500, 300, 100, 100] }, { name: 'Khoi Khoi', b: [100, 300, 120, 140] }];
  assert.strictEqual(BP.profileTarget(els, { names: ['Khoi Khoi'] }).el.name, 'Khoi Khoi');
  assert.strictEqual(BP.profileTarget([{ name: 'Cá nhân 1', b: [1, 1, 1, 1] }, { name: 'Thêm', b: [1, 1, 1, 1] }], { names: ['Ai đó'] }).el.name, 'Cá nhân 1');
  assert.strictEqual(BP.profileTarget([{ name: 'Thêm', b: [1, 1, 1, 1] }], null), null, 'không bấm “Thêm hồ sơ”');
});

// hệ điều hành giả cho ensure-app: Chrome mở ra màn hình chọn hồ sơ
function fakeOs({ picker = true, target = 'Khoi Khoi', blank = false } = {}) {
  let t = 0; const ev = []; let wins = []; let picked = false;
  const pickWin = { hwnd: 1, pid: 9, proc: 'chrome', title: 'Google Chrome', vis: true, active: true, b: [0, 0, 900, 700] };
  const realWin = { hwnd: 2, pid: 9, proc: 'chrome', title: 'Thẻ mới - Google Chrome', vis: true, active: true, b: [0, 0, 1200, 800] };
  const d = {
    now: () => t, sleep: async (ms) => { t += ms; },
    state: async () => ({ windows: wins.slice(), procs: wins.length ? [{ proc: 'chrome' }] : [] }),
    focus: async () => ({ ok: true, how: 'set' }),
    launch: async (app) => { ev.push('launch ' + app); wins = [picker || blank ? pickWin : realWin]; return { ok: true, how: 'lối tắt' }; },
    launchBrowser: async (b) => { ev.push('launchBrowser ' + b.id); wins = [picker || blank ? pickWin : realWin]; return { ok: true, how: `${b.exe} --profile-directory=Profile 1` }; },
    profile: () => ({ dir: 'Profile 1', name: target, names: [target] }),
    look: async (w) => w.hwnd === 1 && !picked
      ? (blank ? { sig: 'b', text: '', elements: [] } : { sig: 'p', text: 'Ai sẽ sử dụng Chrome? · Khoi Khoi · Cá nhân 2 · Thêm', elements: [{ name: 'Ai sẽ sử dụng Chrome?', b: [0, 0, 500, 40] }, { name: 'Khoi Khoi', b: [100, 300, 120, 140] }, { name: 'Cá nhân 2', b: [300, 300, 120, 140] }, { name: 'Thêm', b: [500, 300, 120, 140] }] })
      : { sig: 'r', text: 'Thẻ mới · Thanh địa chỉ', elements: [] },
    clickEl: async (el) => { ev.push('click ' + el.name); if (el.name === 'Khoi Khoi') { picked = true; wins = [realWin]; } },
  };
  return { d, ev };
}
test('B153: ensure_app Chrome → chạy với hồ sơ đang dùng; màn hình chọn hồ sơ → bấm hồ sơ đó, chỉ báo sẵn sàng ở cửa sổ có thẻ', async () => {
  const { d, ev } = fakeOs();
  const r = await EA.ensureApp('Chrome', d, { timeoutMs: 30000 });
  assert.ok(r.ok, r.error); assert.strictEqual(r.window.title, 'Thẻ mới - Google Chrome');
  assert.deepStrictEqual(ev, ['launchBrowser chrome', 'click Khoi Khoi']);
  assert.ok(r.steps.some(s => /--profile-directory=Profile 1/.test(s)), r.steps.join(' | '));
  assert.ok(r.steps.some(s => /màn hình CHỌN HỒ SƠ/.test(s)));
});
test('B153: không tìm thấy hồ sơ để bấm / cửa sổ trống mãi → KHÔNG báo xong, hỏi người dùng', async () => {
  const a = fakeOs({ target: 'Người khác' }); const ra = await EA.ensureApp('Chrome', a.d, { timeoutMs: 30000 });
  assert.strictEqual(ra.ok, false); assert.strictEqual(ra.code, 'profile-picker'); assert.ok(ra.stop); assert.strictEqual(ra.ask, EA.pickerAsk('Chrome'));
  const b = fakeOs({ picker: false, blank: true }); const rb = await EA.ensureApp('Chrome', b.d, { timeoutMs: 20000 });
  assert.strictEqual(rb.ok, false); assert.strictEqual(rb.code, 'blank', rb.error); assert.ok(b.ev.filter(x => /^launchBrowser/.test(x)).length === 2, 'mở lại một lần bằng hồ sơ đang dùng: ' + b.ev);
  const c = fakeOs({ picker: false }); const rc = await EA.ensureApp('Chrome', c.d, { timeoutMs: 20000 }); assert.ok(rc.ok); assert.deepStrictEqual(c.ev, ['launchBrowser chrome']);
  // cửa sổ “Google Chrome” trơn đang ở trước → không đi đường “sẵn sàng ngay”
  const e = fakeOs(); await e.d.launch('x'); e.ev.length = 0; const re = await EA.ensureApp('Chrome', e.d, { timeoutMs: 20000 });
  assert.ok(re.ok); assert.ok(!re.fast); assert.deepStrictEqual(e.ev, ['click Khoi Khoi']);
});

// ---------- B154 / B157: công cụ máy tính với hệ điều hành giả ----------
function tools({ web = true } = {}) {
  const ev = [];
  const T = CT.createComputerTools({ getSettings: () => ({ agentWeb: web, agentAutoReadOnly: false }), openExternal: async (u) => { ev.push('default ' + u); }, keyTap: () => {}, log: () => {},
    screen: { openInBrowser: async (b, u) => { ev.push(`${b.id} ${u}`); return { ok: true, profile: { dir: 'Profile 1' } }; } } });
  const ctx = (q) => ({ userQuery: q, confirm: async (c) => { ev.push('card ' + c.kind); return true; }, signal: null });
  return { T, ev, ctx };
}
test('B154: việc nêu tên Chrome → open_url và lệnh “start <url>” mở trong Chrome (hồ sơ đang dùng), không bao giờ trình duyệt mặc định', async () => {
  const { T, ev, ctx } = tools();
  const o1 = await T.exec('open_url', { url: 'https://sjc.com.vn' }, ctx(Q));
  assert.deepStrictEqual(ev, ['chrome ' + SJC]); assert.match(o1.forModel, /trong Chrome \(hồ sơ Profile 1\)/);
  ev.length = 0; const o2 = await T.exec('run_command', { command: 'start https://www.google.com/search?q=gia+vang+sjc' }, ctx(Q));
  assert.deepStrictEqual(ev, ['chrome https://www.google.com/search?q=gia+vang+sjc'], 'không chạy lệnh, không thẻ hỏi, không trình duyệt mặc định'); assert.ok(!o2.refused); assert.match(o2.forModel, /không chạy lệnh mở trang/);
  ev.length = 0; await T.exec('run_command', { command: 'Start-Process "https://sjc.com.vn"' }, ctx('Mở Microsoft Edge xem giá vàng SJC'));
  assert.deepStrictEqual(ev, ['edge ' + SJC]);
  // không nêu tên trình duyệt → như cũ (trình duyệt mặc định)
  ev.length = 0; await T.exec('open_url', { url: 'https://sjc.com.vn' }, ctx('mở trang sjc.com.vn')); assert.deepStrictEqual(ev, ['default ' + SJC]);
  // tắt truy cập mạng → không mở
  const t2 = tools({ web: false }); const o3 = await t2.T.exec('run_command', { command: 'start https://x.vn' }, t2.ctx(Q)); assert.ok(o3.refused); assert.deepStrictEqual(t2.ev, []);
  assert.strictEqual(BP.urlOpenOf('echo https://x.vn'), null); assert.strictEqual(BP.urlOpenOf('curl https://x.vn'), null);
});
test('B157: system_action không liên quan tới việc (mở Cài đặt khi tìm giá vàng) → chặn ngay, không thẻ hỏi; liên quan → như cũ', async () => {
  const { T, ev, ctx } = tools();
  const r = await T.exec('system_action', { action: 'open_settings' }, ctx(Q));
  assert.ok(r.refused); assert.match(r.forModel, /KHÔNG liên quan/); assert.deepStrictEqual(ev, [], 'không hiện thẻ (thẻ có thể bị “Tự làm không hỏi” tự đồng ý)');
  const S = require('../src/agent/sys-intent');
  assert.strictEqual(S.sysRelated('open_settings', 'bật wifi giúp mình'), true);
  assert.strictEqual(S.sysRelated('volume_up', Q), false);
  assert.strictEqual(S.sysRelated('mute', 'mở youtube trên chrome rồi tắt tiếng'), true);
  assert.strictEqual(S.sysRelated('open_settings', 'mở cài đặt'), true);
});

// ---------- B155: AIVN tự đọc trang ----------
test('B155: lõi tự đọc — trang kết quả Google → đi tới trang nguồn sjc.com.vn; chữ ít → tải lại địa chỉ cuối; chưa có trang → tìm', async () => {
  assert.ok(WR.webInfoTask(Q)); assert.strictEqual(WR.searchTerms(Q), 'giá vàng SJC hôm nay');
  assert.ok(!WR.webInfoTask('Mở Chrome gửi email cho Lan')); assert.ok(!WR.webInfoTask('tìm tệp báo cáo trong thư mục'));
  assert.strictEqual(WR.pickSource({ query: 'giá vàng SJC hôm nay', pageText: GOOGLE_TEXT }).host, 'sjc.com.vn');
  const nav = []; let page = { url: GOOGLE, text: GOOGLE_TEXT };
  const io = { sleep: async () => {}, ensure: async () => ({ ok: true }), read: async () => page,
    navigate: async (u) => { nav.push(u); page = u.startsWith(SJC) ? { url: SJC, text: 'SJC' } : { url: GOOGLE, text: GOOGLE_TEXT }; },
    fetch: async (u) => ({ url: u, title: 'Giá vàng SJC', text: SJC_TEXT }), ocr: async () => 'ocr' };
  const r = await WR.autoRead({ query: Q }, io);
  assert.ok(r.ok); assert.strictEqual(r.url, SJC); assert.strictEqual(r.via, 'fetch'); assert.strictEqual(r.searchUrl, GOOGLE); assert.match(r.text, /142\.300\.000/);
  assert.ok(nav[0].startsWith('https://sjc.com.vn'), nav.join());
  page = { url: 'chrome://newtab/', text: '' }; nav.length = 0;
  const r2 = await WR.autoRead({ query: Q }, io); assert.ok(nav[0].startsWith('https://www.google.com/search?q='), 'chưa có trang → tìm trước'); assert.strictEqual(r2.url, SJC);
  // không truy cập mạng: không điều hướng/không tải — đọc trang đang mở, ít chữ thì OCR
  page = { url: SJC, text: '' }; const r3 = await WR.autoRead({ query: Q }, { ...io, navigate: null, fetch: null, search: null, ocr: async () => SJC_TEXT });
  assert.strictEqual(r3.via, 'ocr'); assert.match(r3.text, /139\.300\.000/);
  assert.ok(WR.NO_TOOL_RE.test('Xin lỗi, tôi không có công cụ fetch_url hay công cụ đọc màn hình nên không thể xem trang web.'));
  assert.ok(!WR.NO_TOOL_RE.test('Giá vàng SJC hôm nay: mua vào 139.300.000, bán ra 142.300.000 đồng/lượng.'));
});

// vòng AIVN AGENT với mô hình kịch bản kiểu 4B và máy giả
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 3 } });
const call = (name, args) => ({ text: '', toolCalls: [{ id: 'c' + Math.random().toString(36).slice(2), name, arguments: args }], finishReason: 'tool_calls', usage: { completion_tokens: 3 } });
function agentWith(replies, { browserRead } = {}) {
  const names = ['ensure_app', 'open_app', 'screen_look', 'screen_act', 'system_action', 'open_url', 'run_command'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const seen = []; const ev = [];
  const engine = { status: () => ({ loaded: true, contextSize: 12288, vision: true, id: 'qwen3-vl-4b' }), chatStep: async (msgs, o) => { seen.push({ msgs: JSON.parse(JSON.stringify(msgs)), tools: ((o && o.tools) || []).map(t => t.name || (t.function && t.function.name)) }); return replies.length ? replies.shift() : say(''); } };
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError,
    exec: async (n, a) => { ev.push(n); if (n === 'ensure_app') return { forModel: 'Chrome sẵn sàng: cửa sổ “Thẻ mới - Google Chrome”.', summary: 'Chrome: đã mở' }; return { forModel: 'ok', summary: 'ok' }; },
    relevantWindows: async () => [], readBrowserPage: async () => ({ url: GOOGLE, text: GOOGLE_TEXT }),
    browserRead: browserRead || (async () => ({ ok: true, url: SJC, title: 'Giá vàng SJC', text: SJC_TEXT, via: 'fetch', browser: 'Chrome', searchUrl: GOOGLE, trail: [] })) };
  const agent = createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false, agentWeb: true, agentComputer: true, agentScreen: true }), memory: { count: () => 0, search: async () => [], list: () => [] }, scheduler: {}, log: () => {} });
  return { agent, seen, ev };
}
test('B155: mô hình kiểu 4B nói “không có fetch_url” → AIVN tự đọc trang sjc.com.vn, đưa cho mô hình; câu trả lời có số và nguồn là trang nguồn (không phải Google)', async () => {
  const replies = [say('Xin lỗi, tôi không có công cụ fetch_url hay công cụ đọc màn hình nên không thể xem nội dung trang web để cho bạn biết giá vàng.'),
    say('Giá vàng SJC hôm nay: mua vào 139.300.000 đồng, bán ra 142.300.000 đồng (vàng SJC 1L). Nguồn: https://sjc.com.vn/')];
  const { agent, seen } = agentWith(replies);
  const r = await agent.run({ messages: [{ role: 'user', content: Q }], approve: async () => ({ ok: false }) });
  const auto = r.steps.find(s => s.autoRead); assert.ok(auto, r.steps.map(s => s.name).join()); assert.strictEqual(auto.status, 'ok'); assert.strictEqual(auto.args.url, SJC);
  const second = seen[1].msgs.map(m => String(m.content || '')).join('\n');
  assert.match(second, /142\.300\.000/); assert.match(second, /AIVN đã TỰ đọc trang/); assert.match(second, /ĐỪNG nói là không có công cụ/);
  assert.match(r.text, /139\.300\.000/); assert.match(r.text, /142\.300\.000/); assert.match(r.text, /sjc\.com\.vn/); assert.ok(!/google\.com\/search/.test(r.text), r.text);
  assert.ok(!/không có công cụ/.test(r.text));
});
test('B155: mô hình vẫn khăng khăng “không có công cụ” → câu trả lời lấy từ các dòng của trang đã đọc (bằng mã), kèm nguồn', async () => {
  const no = 'Tôi không có công cụ để đọc nội dung trang web nên không thể cho bạn biết.';
  const { agent } = agentWith([say(no), say(no), say(no)]);
  const r = await agent.run({ messages: [{ role: 'user', content: Q }], approve: async () => ({ ok: false }) });
  assert.match(r.text, /Mình đã đọc trang https:\/\/sjc\.com\.vn\/ trong Chrome/); assert.match(r.text, /139\.300\.000 \| 142\.300\.000/); assert.match(r.text, /Nguồn: https:\/\/sjc\.com\.vn\//);
  assert.ok(!/không có công cụ/.test(r.text), r.text);
});
test('B155: không đọc được trang → bước báo lỗi rõ, không bịa; tự đọc chỉ một lần mỗi lượt', async () => {
  let n = 0; const { agent } = agentWith([say('Tôi không có công cụ fetch_url.'), say('Tôi không có công cụ fetch_url.')], { browserRead: async () => { n++; return { ok: false, error: 'Chrome đang hỏi chọn hồ sơ', trail: [] }; } });
  const r = await agent.run({ messages: [{ role: 'user', content: Q }], approve: async () => ({ ok: false }) });
  assert.strictEqual(n, 1); const st = r.steps.find(s => s.autoRead); assert.strictEqual(st.status, 'error'); assert.match(st.summary, /Chưa đọc được trang: Chrome đang hỏi chọn hồ sơ/);
});

// ---------- B156 ----------
test('B156: JavaScript chạy trong hộp cát, không có window/document, không điều khiển trình duyệt; việc nêu tên Chrome → ẩn run_javascript; lỗi DOM → gợi ý công cụ đúng', async () => {
  const A = require('../src/agent/agent');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/agent/agent.js'), 'utf8');
  assert.match(src, /KHÔNG có window\/document\/DOM, KHÔNG điều khiển được trình duyệt \(Chrome, Edge…\)/);
  const { agent, seen } = agentWith([say('Giá vàng SJC hôm nay: mua vào 139.300.000, bán ra 142.300.000.')]);
  await agent.run({ messages: [{ role: 'user', content: Q }], approve: async () => ({ ok: false }) });
  assert.ok(seen.length && seen.every(x => !x.tools.includes('run_javascript')), 'việc trên Chrome không có run_javascript');
  // lỗi “document is not defined” trong hộp cát thật → kết quả công cụ mang gợi ý
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b156-'));
  const replies = [call('run_javascript', { code: 'document.querySelector(".gia").innerText' }), say('xong')]; const seen2 = [];
  const ag = createAgent({ engine: { status: () => ({ loaded: true, contextSize: 8192 }), chatStep: async (m) => { seen2.push(JSON.parse(JSON.stringify(m))); return replies.shift() || say(''); } }, getSettings: () => ({ agentFolders: [root], agentMemory: false }), memory: { count: () => 0, search: async () => [], list: () => [] }, scheduler: {}, extractFile: async () => ({}) });
  const r = await ag.run({ messages: [{ role: 'user', content: 'tính tổng 2 + 2 bằng JavaScript' }], approve: async () => ({ ok: true }) });
  const toolMsg = seen2[1].filter(m => m.role === 'tool').map(m => m.content).join('\n');
  assert.match(toolMsg, /document is not defined/); assert.match(toolMsg, /Gợi ý của AIVN: run_javascript chạy trong HỘP CÁT/); assert.match(toolMsg, /screen_look/);
  assert.ok(r.steps.some(s => s.name === 'run_javascript'));
  assert.ok(typeof A.createAgent === 'function');
});

// ---------- B158 ----------
test('B158: GPU dưới 6 GB → gợi ý Qwen3-VL 2B cho AIVN AGENT, 4B “Chạy chậm”; GPU 8 GB như cũ; 2B trượt bộ đo trên máy → 4B', () => {
  const AE = require('../src/agent-eligibility'); const AP = require('../src/agent-plan'); const R = require('../src/recommend');
  const catalog = require('../src/catalog.js'); const L = Array.isArray(catalog) ? catalog : Object.values(catalog).find(Array.isArray);
  const c2 = L.find(c => c.id === 'qwen3-vl-2b-instruct-q8_0'), c4 = L.find(c => c.id === 'qwen3-vl-4b-instruct-q4_k_m'), c8 = L.find(c => c.id === 'qwen3-vl-8b-instruct-q4_k_m');
  const GiB = 1024 ** 3;
  // laptop RTX 3050 Ti 4 GB ở 12K: 2B nằm trọn VRAM (~67 token/giây), 4B tràn 0,7 GB (Chạy chậm ~12 token/giây), 8B tràn vài GB
  const fits = { [c2.id]: { level: 'fit', tps: 67, ram: 0 }, [c4.id]: { level: 'slow', tps: 12, ram: 0.7 * GiB }, [c8.id]: { level: 'slow', tps: 3, ram: 4 * GiB } };
  const E = [c2, c4, c8].map(c => ({ id: c.id, vision: true, catalog: c, size: c.size, installed: true }));
  const fitAt = (e) => fits[e.id];
  const P = AP.plan(E, fitAt, {}, { vramBytes: 4 * GiB }); assert.ok(P.lowVram); const eo = AP.elOpts(P); assert.ok(eo.lowVram);
  const at = E.map(e => ({ ...e, agentFit: fits[e.id] }));
  assert.strictEqual(AE.bestFor(at, {}, eo).id, c2.id, 'GPU 4 GB → ⭐ 2B');
  const e4 = AE.eligibility({ ...at[1], fit: fits[c4.id] }, eo); assert.ok(e4.ok && e4.slow, JSON.stringify(e4)); assert.match(e4.reason, /^Chạy chậm/);
  const e2 = AE.eligibility({ ...at[0], fit: fits[c2.id] }, eo); assert.ok(e2.ok); assert.strictEqual(e2.code, 'lowvram');
  // 2B trượt bộ đo đầy đủ trên CHÍNH máy này → thang dự phòng: 4B
  const fail = { local: { [c2.id]: { full: { complete: true, agentOk: false } } } };
  assert.strictEqual(AE.bestFor(at, fail, AP.elOpts(AP.plan(E, fitAt, fail, { vramBytes: 4 * GiB }))).id, c4.id);
  // GPU 8 GB: 2B vẫn không dùng cho AIVN AGENT (gọi công cụ 13/25), gợi ý mạnh nhất chạy mượt
  const big = { [c2.id]: { level: 'fit', tps: 90 }, [c4.id]: { level: 'fit', tps: 60 }, [c8.id]: { level: 'fit', tps: 35 } };
  const P8 = AP.plan(E, (e) => big[e.id], {}, { vramBytes: 8 * GiB }); assert.ok(!P8.lowVram);
  assert.strictEqual(AE.bestFor(E.map(e => ({ ...e, agentFit: big[e.id] })), {}, AP.elOpts(P8)).id, c8.id);
  assert.strictEqual(AE.eligibility({ ...E[0], fit: big[c2.id] }, AP.elOpts(P8)).code, 'tools');
  // chưa có số liệu độ vừa máy: theo VRAM
  const lite = [c2, c4, c8].map(c => ({ ...c }));
  assert.strictEqual(R.screenSetup(lite, 4 * GiB).solo, c2.id); assert.strictEqual(R.screenSetup(lite, 8 * GiB).solo, c8.id); assert.strictEqual(R.screenSetup(lite, 0).solo, c4.id);
});
