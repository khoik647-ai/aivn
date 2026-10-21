'use strict';
// 0.15.3: điều khiển màn hình không bao giờ dựa vào một mô hình chỉ đọc chữ; ô tìm kiếm phải thử đủ cách trước khi nói "không tìm thấy"
const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/recommend');
const U = require('../src/agent/uitree');
const CAT = require('../src/catalog');
const { createAgent, NOT_FOUND_RE, OPEN_WANT_RE, openNudge } = require('../src/agent/agent');
const { createComputerTools } = require('../src/agent/computer-tools');
const GB = 1024 ** 3;
const hf = require('../src/hf');
// vram (byte) → mức chạy thật trên máy có GPU đó (ngữ cảnh 16K của AIVN AGENT); không truyền → coi như mọi mô hình vừa máy
const list = (installed = [], vram = null) => CAT.map(c => ({ ...c, installed: installed.includes(c.id),
  fit: vram == null ? { level: 'fit' } : hf.fitFor(c.size, vram ? { ram: 16 * GB, gpu: 'cuda', vram: { total: vram } } : { ram: 16 * GB }, { id: c.id, params: c.params, mmprojSize: c.mmproj ? c.mmproj.size : 0, ctx: 16384 }) }));
const vision = (id) => { const c = CAT.find(x => x.id === id); return !!(c && c.mmproj); };

test('quy tắc: điều khiển máy KHÔNG BAO GIỜ gợi ý một mô hình chỉ đọc chữ đứng một mình (mọi mức VRAM)', () => {
  for (const g of [0, 2, 3.9, 4, 6, 8, 11.93, 12, 16, 24, 48]) {
    const s = R.screenSetup(list(), g * GB);
    assert.ok(s.solo && vision(s.solo), `${g} GB: solo ${s.solo} phải nhìn được ảnh`);
    if (s.pair) { assert.ok(vision(s.pair.grounder), `${g} GB: mắt nhìn ${s.pair.grounder} phải nhìn được ảnh`); assert.ok(R.PLANNERS.includes(s.pair.planner)); }
    const { list: an } = R.annotate(list(), {}, g * GB);
    for (const c of an.filter(c => c.recScreen)) assert.ok(vision(c.id), `${g} GB: nhãn Gợi ý điều khiển máy trên mô hình chữ ${c.id}`);
    for (const c of an.filter(c => c.recGround)) assert.ok(vision(c.id));
    assert.ok(!an.some(c => c.recScreen && R.PLANNERS.includes(c.id)), 'Qwen3 8B/4B (chỉ chữ) không bao giờ mang nhãn điều khiển máy');
    const e = R.eyesFor(list(), g * GB); assert.ok(e && vision(e.id));
  }
});
test('điều khiển màn hình (quy tắc 0.16): luôn một mô hình nhìn ảnh, không gợi ý cặp có mô hình chỉ đọc chữ', () => {
  const S = (v) => R.screenSetup(list([], v * GB), v * GB, { shipped: require('../src/bench-results.json').models });
  assert.deepStrictEqual(S(11.93).solo, 'qwen3-vl-8b-instruct-q4_k_m');
  assert.strictEqual(S(11.93).pair, null);
  assert.deepStrictEqual(S(4).solo, 'qwen3-vl-4b-instruct-q4_k_m'); // beta.2: 2B không đạt bài gọi công cụ (13/25, docs/verified.md#v016-goi-cong-cu) → 4 GB dùng 4B (Chạy chậm)
  assert.strictEqual(S(4).pair, null);
  assert.deepStrictEqual(S(0).solo, 'qwen3-vl-4b-instruct-q4_k_m'); // không GPU, 16 GB RAM: 4B vẫn ≥ 10 token/giây ước tính trên CPU
});
test('mắt nhìn: ưu tiên mô hình nhìn ảnh đã cài', () => {
  assert.equal(R.eyesFor(list(['qwen3-vl-4b-instruct-q4_k_m']), 12 * GB).id, 'qwen3-vl-4b-instruct-q4_k_m');
  assert.equal(R.eyesFor(list(), 12 * GB).id, 'qwen3-vl-8b-instruct-q4_k_m');
  assert.ok(!R.isVision({ id: 'qwen_qwen3-8b-q4_k_m' })); assert.ok(R.isVision({ id: 'x', mmproj: { file: 'm.gguf' } }));
});
test('Zalo/Electron: cây giao diện nghèo → dùng ảnh chụp + mô hình nhìn ảnh', () => {
  for (const p of ['Zalo.exe', 'Zalo', 'Slack.exe', 'Code.exe', 'Teams', 'ms-teams.exe', 'WhatsApp.exe', 'Discord.exe']) assert.ok(U.poorTreeApp(p), p);
  for (const p of ['notepad.exe', 'EXCEL.EXE', 'explorer.exe', 'soffice.bin', '']) assert.ok(!U.poorTreeApp(p), p);
});
test('ô tìm kiếm: các cách thử lần lượt (nguyên văn → không dấu → tên gọi có/không dấu → tên có/không dấu)', () => {
  assert.deepStrictEqual(U.searchVariants('Trần Quỳnh Anh'), ['Trần Quỳnh Anh', 'Tran Quynh Anh', 'Quỳnh Anh', 'Quynh Anh', 'Anh']);
  assert.deepStrictEqual(U.searchVariants('Đặng Văn Đức'), ['Đặng Văn Đức', 'Dang Van Duc', 'Văn Đức', 'Van Duc', 'Đức', 'Duc']);
  assert.deepStrictEqual(U.searchVariants('Lê Hoa'), ['Lê Hoa', 'Le Hoa', 'Hoa']);
  assert.deepStrictEqual(U.searchVariants('Lan'), ['Lan']);
  assert.ok(NOT_FOUND_RE.test('Mình không tìm thấy liên hệ Trần Quỳnh Anh trong Zalo.'));
  assert.ok(NOT_FOUND_RE.test('Không có kết quả nào khớp.'));
  assert.ok(!NOT_FOUND_RE.test('Đã mở cuộc trò chuyện với Trần Quỳnh Anh.'));
});
test('vòng lặp AIVN AGENT: chưa thử không dấu/một phần tên thì không được kết luận "không tìm thấy"', async () => {
  const typed = []; let todo = () => { const rest = U.searchVariants('Trần Quỳnh Anh').filter(v => !typed.includes(v)); return typed.length && rest.length ? rest : null; };
  const screen = { look: async () => ({ forModel: 'Quan sát: ô tìm kiếm' }), act: async (a) => { if (a.action === 'type_text') typed.push(a.text); return { forModel: `Đã gõ ${a.text}`, summary: 'gõ' }; }, pending: async () => null, searchTodo: () => todo() };
  const ct = createComputerTools({ getSettings: () => ({ agentComputer: true, agentScreen: true }), openPath: async () => '', openExternal: async () => {}, visionReady: () => true, screen });
  const seen = []; let round = 0;
  const engine = { status: () => ({ loaded: true, contextSize: 8192, vision: true }), chatStep: async (msgs) => {
    seen.push(msgs[msgs.length - 1]); round++;
    if (round === 1) return { text: '', toolCalls: [{ id: 'c1', name: 'screen_act', arguments: { action: 'type_text', element: 'ô Tìm kiếm', text: 'Trần Quỳnh Anh' } }], finishReason: 'tool_calls', usage: {} };
    if (round === 2) return { text: 'Mình không tìm thấy Trần Quỳnh Anh trong Zalo.', toolCalls: [], finishReason: 'stop', usage: {} };
    if (round === 3) return { text: '', toolCalls: [{ id: 'c2', name: 'screen_act', arguments: { action: 'type_text', element: 'ô Tìm kiếm', text: 'Tran Quynh Anh', replace: true } }], finishReason: 'tool_calls', usage: {} };
    return { text: 'Đã tìm thấy Trần Quỳnh Anh khi gõ không dấu.', toolCalls: [], finishReason: 'stop', usage: {} };
  } };
  const ag = createAgent({ engine, getSettings: () => ({ agentComputer: true, agentScreen: true, agentMemory: false }), memory: { count: () => 0 }, scheduler: {}, extractFile: async () => ({}), embedForMemory: async () => ({}), computer: ct });
  const r = await ag.run({ messages: [{ role: 'user', content: 'Mở Zalo và tìm Trần Quỳnh Anh' }], confirm: async () => true });
  const nudge = seen.find(m => m && m.role === 'user' && /Chưa được kết luận "không tìm thấy"/.test(m.content));
  assert.ok(nudge, 'phải nhắc thử thêm'); assert.match(nudge.content, /Tran Quynh Anh/); assert.match(nudge.content, /Quỳnh Anh/);
  assert.deepStrictEqual(typed, ['Trần Quỳnh Anh', 'Tran Quynh Anh']);
  assert.match(r.text, /Đã tìm thấy/);
});

test('chữ gợi ý ô nhập chỉ thấy qua OCR (Zalo "Tìm kiếm") được coi là ô nhập để bấm rồi gõ', () => {
  const U = require('../src/agent/uitree.js');
  for (const n of ['Tìm kiếm', 'Tim kiem', 'Search', 'Nhập tin nhắn tới Mẹ', 'Type a message']) assert.ok(U.inputLike({ name: n, ocr: true }), n);
  for (const n of ['Trần Quỳnh Anh', 'Nhóm Lớp K27', 'Cloud của tôi', 'Gửi']) assert.ok(!U.inputLike({ name: n, ocr: true }), n);
  assert.ok(!U.inputLike({ name: 'Tìm kiếm' }), 'phần tử cây giao diện không phải OCR: giữ quy tắc cũ');
  assert.ok(!U.inputLike({ name: 'Tìm kiếm', ocr: true, editable: true }), 'ô nhập thật đã được xử lý riêng');
});

test('đã thấy kết quả tìm kiếm mà dừng lại hỏi: nhắc một lần bấm mở luôn (mở không cần hỏi, gửi tin mới cần)', async () => {
  const acts = []; let hit = null;
  const screen = { look: async () => ({ forModel: 'Quan sát: ô tìm kiếm' }), act: async (a) => { acts.push(a); if (a.action === 'type_text') hit = { id: 'e7', name: 'Tran Quynh Anh', query: a.text }; else hit = null; return { forModel: `Đã ${a.action}`, summary: a.action }; }, pending: async () => null, searchTodo: () => null, searchFound: () => hit, active: () => true, end: async () => {} };
  const ct = createComputerTools({ getSettings: () => ({ agentComputer: true, agentScreen: true }), openPath: async () => '', openExternal: async () => {}, visionReady: () => true, screen });
  const seen = []; let round = 0;
  const engine = { status: () => ({ loaded: true, contextSize: 8192, vision: true }), chatStep: async (msgs) => {
    seen.push(msgs[msgs.length - 1]); round++;
    if (round === 1) return { text: '', toolCalls: [{ id: 'c1', name: 'screen_act', arguments: { action: 'type_text', element: 'ô Tìm kiếm', text: 'Tran Quynh Anh' } }], finishReason: 'tool_calls', usage: {} };
    if (round === 2) return { text: 'Đã thấy Tran Quynh Anh. Bạn có muốn mình mở cuộc trò chuyện không?', toolCalls: [], finishReason: 'stop', usage: {} };
    if (round === 3) return { text: '', toolCalls: [{ id: 'c2', name: 'screen_act', arguments: { action: 'click', element: 'e7' } }], finishReason: 'tool_calls', usage: {} };
    return { text: 'Đã mở cuộc trò chuyện với Tran Quynh Anh.', toolCalls: [], finishReason: 'stop', usage: {} };
  } };
  const ag = createAgent({ engine, getSettings: () => ({ agentComputer: true, agentScreen: true, agentMemory: false }), memory: { count: () => 0 }, scheduler: {}, extractFile: async () => ({}), embedForMemory: async () => ({}), computer: ct });
  const r = await ag.run({ messages: [{ role: 'user', content: 'Trong Zalo, tìm Trần Quỳnh Anh và mở cuộc trò chuyện' }], confirm: async () => true });
  const n = seen.find(m => m && m.role === 'user' && /CHƯA bấm vào/.test(m.content));
  assert.ok(n, 'phải nhắc bấm mở'); assert.match(n.content, /element "e7"/); assert.match(n.content, /không cần hỏi lại/);
  assert.deepStrictEqual(acts.map(a => a.action), ['type_text', 'click']);
  assert.match(r.text, /Đã mở/);
  assert.ok(OPEN_WANT_RE.test('nhắn cho Lan')); assert.ok(!OPEN_WANT_RE.test('đếm số dòng trong tệp'));
  assert.match(openNudge({ name: 'X' }), /screen_act click\)/);
});

test('read_file gõ sai một vài ký tự tên tệp: lỗi gợi ý tên gần đúng để mô hình gọi lại', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const { editDist } = require('../src/agent/agent');
  const { createMemoryStore } = require('../src/agent/memory');
  assert.equal(editDist('chii-tieu-thang-9.csv', 'chi-tieu-thang-9.csv'), 1); assert.equal(editDist('abc', 'abc'), 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-near-')); const sub = path.join(dir, 'agdir'); fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'chi-tieu-thang-9.csv'), 'ngay,so tien\n1/9,50000\n'); fs.writeFileSync(path.join(sub, 'ghi-chu.txt'), 'x');
  const replies = [
    () => ({ text: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: { path: 'agdir/chii-tieu-thang-9.csv' } }], finishReason: 'tool_calls', usage: {} }),
    () => ({ text: '', toolCalls: [{ id: 'b', name: 'read_file', arguments: { path: 'agdir/hoa-don-xyz.csv' } }], finishReason: 'tool_calls', usage: {} }),
    () => ({ text: 'Xong.', toolCalls: [], finishReason: 'stop', usage: {} }),
  ];
  const engine = { status: () => ({ loaded: true, contextSize: 8192 }), chatStep: async () => replies.shift()() };
  const agent = createAgent({ engine, getSettings: () => ({ agentFolders: [sub], agentMemory: false }), memory: createMemoryStore(path.join(dir, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async (p) => ({ kind: 'text', text: fs.readFileSync(p, 'utf8') }), embedForMemory: async () => ({}) });
  const r = await agent.run({ messages: [{ role: 'user', content: 'Đọc tệp chi-tieu-thang-9.csv' }], confirm: async () => true });
  assert.equal(r.steps[0].status, 'error'); assert.match(r.steps[0].summary + ' ' + (r.steps[0].detail || ''), /gần giống: "agdir\/chi-tieu-thang-9\.csv"/);
  assert.equal(r.steps[1].status, 'error'); assert.doesNotMatch(r.steps[1].summary + ' ' + (r.steps[1].detail || ''), /gần giống/, 'tên khác hẳn thì không gợi ý bừa');
});
