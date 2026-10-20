// 0.14.3: QA — ngữ cảnh nhỏ, lời gọi công cụ dạng văn bản ở chế độ gốc, nội dung kết quả công cụ luôn là chuỗi
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const TP = require('../src/agent/textproto');
const { createAgent, fakeActionCheck } = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');
const CT = require('../src/agent/computer-tools'); const C = require('../src/agent/computer');

test('compactTools bỏ mô tả tham số, giữ một câu', () => {
  const t = TP.compactTools([{ name: 'a', description: 'Mở ứng dụng. Rất dài nữa.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'tên' } }, required: ['name'] } }]);
  assert.strictEqual(t[0].description, 'Mở ứng dụng.');
  assert.strictEqual(t[0].parameters.properties.name.description, undefined);
  assert.deepStrictEqual(t[0].parameters.required, ['name']);
});
test('trimHistory giữ hệ thống + lượt cuối, không cắt rời kết quả công cụ', () => {
  const m = [{ role: 'system', content: 'x'.repeat(4000) }];
  for (let i = 0; i < 6; i++) m.push({ role: 'user', content: 'u' + i }, { role: 'assistant', content: '', tool_calls: [{ id: 'c' + i }] }, { role: 'tool', tool_call_id: 'c' + i, content: 'r' });
  const r = TP.trimHistory(m);
  assert.strictEqual(r[0].role, 'system'); assert.ok(r[0].content.length < 2600);
  assert.notStrictEqual(r[1].role, 'tool');
  assert.ok(r.length <= 9);
});
test('CTX_RE nhận cả lỗi node-llama-cpp lẫn llama-server', () => {
  assert.ok(TP.CTX_RE.test('The default context shift strategy did not return a history that fits the context size'));
  assert.ok(TP.CTX_RE.test('request (4254 tokens) exceeds the available context size (4096 tokens)'));
  assert.strictEqual(TP.ctxSmallError(2048).code, 'CTX_SMALL');
});
test('từ chối khi công cụ có sẵn → vẫn thử ép gọi (cannot_do là lối ra)', () => {
  assert.strictEqual(fakeActionCheck('Xin lỗi, tôi không thể mở máy tính.', [], ['open_app'], 'mở máy tính'), 'ignored');
  assert.strictEqual(fakeActionCheck('Cần bật "Điều khiển máy tính" trước.', [], ['open_app'], 'mở Zalo'), null);
});

function mk(replies) {
  let i = 0; const sent = [];
  const engine = { status: () => ({ loaded: true, contextSize: 4096 }), countTokensAsync: async (a) => a.map(() => 10),
    chatStep: async (msgs, o) => { sent.push(JSON.parse(JSON.stringify(msgs))); const x = replies[Math.min(i++, replies.length - 1)]; return { text: '', toolCalls: [], finishReason: 'stop', usage: {}, ...x }; } };
  const opened = [];
  const computer = { names: () => ['open_app', 'list_apps'], defs: { open_app: CT.DEFS.open_app, list_apps: CT.DEFS.list_apps }, has: n => ['open_app', 'list_apps'].includes(n), CompError: CT.CompError,
    exec: async (n, a) => { opened.push(a.name); return n === 'open_app' ? { ok: true } : { forModel: 'Calculator', summary: '1' }; } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v143-'));
  const agent = createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, opened, sent };
}
test('lời gọi <tool_call> trong văn bản (chế độ gốc) được thực thi; lặp lại thì dừng gọn, không cảnh báo', async () => {
  const tc = '<tool_call>{"name":"open_app","arguments":{"name":"Calculator"}}</tool_call>';
  const { agent, opened, sent } = mk([{ text: tc }, { text: tc }]);
  const r = await agent.run({ messages: [{ role: 'user', content: 'Cho mình dùng Calculator' }], confirm: async () => true });
  assert.deepStrictEqual(opened, ['Calculator']);
  assert.ok(!r.warning, 'không cảnh báo khi đã thật sự mở');
  assert.ok(!/<tool_call>/.test(r.text) && r.text.length > 0, r.text);
  const toolMsg = sent[1].find(m => m.role === 'tool');
  assert.strictEqual(typeof toolMsg.content, 'string'); assert.ok(toolMsg.content.length > 0);
});

test('chuỗi dự phòng (0.15.2): đủ lớp → ¾ → ½ → ¼ lớp → CPU, ngữ cảnh không giảm; cuối cùng CPU 4096', () => {
  const { loadPlans } = require('../src/engine');
  const p = loadPlans({ gpu: 'vulkan', vram: { total: 8e9, free: 8e9 }, fileSize: 400e6, geo: { layers: 28, kvPerToken: 1000 }, ctx: 8192 });
  assert.deepStrictEqual(p.map(x => x.gpuLayers + '@' + x.ctx), ['29@8192', '21@8192', '14@8192', '7@8192', '0@8192', '0@4096']);
});

// ---- Zalo trên máy thật: Desktop nằm trong OneDrive, tên người dùng tiếng Việt ----
function makeLnk(target) { // MS-SHLLINK tối giản: header + LinkInfo có LocalBasePathUnicode
  const h = Buffer.alloc(0x4c); h.writeUInt32LE(0x4c, 0); h.writeUInt32LE(0x2, 0x14); // HasLinkInfo
  const uni = Buffer.from(target + '\0', 'utf16le'); const ansi = Buffer.from('\0', 'latin1'); const suf = Buffer.from('\0\0', 'latin1');
  const hs = 0x24; const vol = Buffer.alloc(0x10); vol.writeUInt32LE(0x10, 0);
  const li = Buffer.alloc(hs); const offVol = hs, offAnsi = offVol + vol.length, offSuf = offAnsi + ansi.length, offUni = offSuf + 1, offUsuf = offUni + uni.length;
  const size = offUsuf + 2;
  li.writeUInt32LE(size, 0); li.writeUInt32LE(hs, 4); li.writeUInt32LE(1, 8); li.writeUInt32LE(offVol, 12); li.writeUInt32LE(offAnsi, 16); li.writeUInt32LE(0, 20); li.writeUInt32LE(offSuf, 24); li.writeUInt32LE(offUni, 28); li.writeUInt32LE(offUsuf, 32);
  return Buffer.concat([h, li, vol, ansi, suf.subarray(0, 1), uni, Buffer.from('\0\0', 'latin1')]);
}
test('Windows thật: Zalo.lnk trên Desktop OneDrive ("OneDrive - Văn Lang"), tên người dùng tiếng Việt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v143-win-')); const prof = path.join(root, 'Users', 'Nguyễn Ngọc Khôi');
  const desk = path.join(prof, 'OneDrive - Trường Đại học Văn Lang', 'Desktop'); fs.mkdirSync(desk, { recursive: true });
  const exe = path.join(prof, 'AppData', 'Local', 'Zalo', 'Zalo.exe'); // không nằm trong ...\Programs → chỉ thấy qua lối tắt
  fs.writeFileSync(path.join(desk, 'Zalo.lnk'), makeLnk(exe)); fs.writeFileSync(path.join(desk, 'Ghi chú.txt'), 'x');
  const diag = { sources: {}, errors: [] };
  const apps = C.listApps({ platform: 'win32', home: prof, env: { USERPROFILE: prof, APPDATA: path.join(prof, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(prof, 'AppData', 'Local'), ProgramData: path.join(root, 'PD'), PUBLIC: path.join(root, 'Users', 'Public') }, diag });
  const z = C.findApp('zalo', apps); assert.ok(z, 'thấy Zalo'); assert.strictEqual(z.source, 'desktop'); assert.strictEqual(z.target, exe);
  assert.ok(diag.dirs.desktop.some(d => d.includes('OneDrive - Trường Đại học Văn Lang')));
  assert.strictEqual(diag.sources.desktop, 1);
  // Desktop chuyển hướng tới thư mục lạ: lấy từ [Environment]::GetFolderPath qua PowerShell
  const odd = path.join(root, 'D', 'Màn hình'); fs.mkdirSync(odd, { recursive: true }); fs.writeFileSync(path.join(odd, 'Zalo.lnk'), makeLnk(exe));
  const deep = await C.deepApps({ platform: 'win32', run: async () => '\uFEFF' + JSON.stringify([{ s: 'dir', n: 'Desktop', i: odd }]) });
  const apps2 = C.listApps({ platform: 'win32', home: path.join(root, 'none'), env: { USERPROFILE: path.join(root, 'none') }, extraDirs: deep.dirs });
  assert.ok(C.findApp('Zalo', apps2));
});
test('PowerShell lỗi/quá giờ: công cụ ghi rõ nguồn lỗi, không được nói "chưa cài"; thử mở theo tên (Get-StartApps/Start-Process)', async () => {
  const logs = []; let scan = null; const ps = [];
  const tools = CT.createComputerTools({ getSettings: () => ({ agentComputer: true }), visionReady: () => false, openPath: async () => '', log: (m) => logs.push(m), logScan: (d) => { scan = d; },
    deepApps: async () => Object.assign([], { diag: { sources: {}, errors: ['PowerShell quá thời gian 25 giây'] } }),
    psRun: async (script) => { ps.push(script); return /UngDungLa/.test(script) ? 'fail' : 'ok:Zalo'; } });
  const r = await tools.exec('open_app', { name: 'Zalo' }, {});
  assert.match(r.forModel, /Đã mở ứng dụng "Zalo"/); assert.match(ps[0], /Get-StartApps[\s\S]*App Paths/);
  await assert.rejects(tools.exec('open_app', { name: 'UngDungLa' }, {}), (e) => /KHÔNG được nói với người dùng là ứng dụng chưa cài/.test(e.message) && /quá thời gian/.test(e.message) && /đừng khẳng định/.test(e.message));
  assert.ok(scan && scan.errors.length === 1); assert.ok(logs.some(l => /quét:.*LỖI/.test(l)));
});

test('định vị theo họ mô hình: Qwen2.5-VL điểm ảnh, Qwen3-VL 0-1000, UI-TARS click(start_box)', () => {
  const SC = require('../src/screen-control');
  assert.strictEqual(SC.groundingFamily('ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf'), 'qwen25vl');
  assert.strictEqual(SC.groundingFamily('Qwen3-VL-4B-Instruct-Q4_K_M.gguf'), 'qwen3vl');
  assert.strictEqual(SC.groundingFamily('UI-TARS-1.5-7B.Q4_K_M.gguf'), 'uitars');
  // điểm ảnh nhỏ (< 1000) vẫn đúng là điểm ảnh khi biết họ mô hình
  const a = SC.parseBox('{"bbox_2d": [100, 50, 200, 90], "label": "Gửi"}', 1288, 728, { coords: 'pixel' });
  assert.ok(Math.abs(a.x1 - 100 / 1288) < 1e-9 && Math.abs(a.y2 - 90 / 728) < 1e-9 && a.label === 'Gửi');
  const b = SC.parseBox('```json\n[{"bbox_2d": [500, 500, 600, 550], "label": "OK"}]\n```', 1280, 704, { coords: 'norm1000' });
  assert.ok(Math.abs(b.x1 - 0.5) < 1e-9 && Math.abs(b.y2 - 0.55) < 1e-9);
  const c = SC.parseBox("Thought: ...\nAction: click(start_box='(644,360)')", 1288, 720, { coords: 'pixel' });
  assert.ok(Math.abs((c.x1 + c.x2) / 2 - 644 / 1288) < 1e-9 && Math.abs((c.y1 + c.y2) / 2 - 0.5) < 1e-9);
  assert.strictEqual(SC.parseBox('not_found', 10, 10).found, false);
  const d = SC.parseBox('<|box_start|>(10,20),(30,40)<|box_end|>', 100, 100, { coords: 'pixel' }); assert.ok(Math.abs(d.x2 - 0.3) < 1e-9);
  // tự đoán (họ lạ): > 1000 → điểm ảnh
  assert.ok(SC.parseBox('{"x1":640,"y1":400,"x2":1280,"y2":800}', 1280, 800).x2 === 1);
});
