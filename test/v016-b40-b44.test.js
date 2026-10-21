// beta.2: B40 vòng quan sát, B41 ẩn JS cho việc trên web/ứng dụng, B43 tên ứng dụng + động từ = làm trên ứng dụng, B44 cứu lời gọi công cụ in ra chữ,
// việc mới → ngữ cảnh sạch, bộ chọn mô hình chọn mô hình mạnh nhất chạy mượt
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const TP = require('../src/agent/textproto'); const SI = require('../src/agent/sys-intent');
const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const EL = require('../src/agent-eligibility');
const { createMemoryStore } = require('../src/agent/memory');

function mkAgent(replies, execImpl, names = ['open_app', 'open_url', 'screen_look', 'screen_act', 'system_action']) {
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b44-'));
  const seen = []; const logs = [];
  const engine = { status: () => ({ loaded: true, contextSize: 8192 }), chatStep: async (msgs, o) => { seen.push({ msgs: msgs.map(m => ({ ...m })), tools: (o.tools || []).map(t => t.name || (t.function && t.function.name)), toolChoice: o.toolChoice }); return replies.shift() || { text: 'Xong.', toolCalls: [], finishReason: 'stop', usage: {} }; } };
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const calls = [];
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a, c) => { calls.push({ n, a }); return execImpl ? execImpl(n, a, c) : { forModel: 'ok', summary: 'ok' }; } };
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: false, agentComputer: true, agentScreen: true }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: (x) => logs.push(x) });
  return { agent, seen, calls, logs };
}
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: {} });
const call = (name, args, id = 'c' + Math.random().toString(36).slice(2, 7)) => ({ text: '', toolCalls: [{ id, name, arguments: args }], finishReason: 'tool_calls', usage: {} });

test('B44: salvage parser — code block, name key=value, JSON, XML-ish; schema check rejects unknown enum; prose is not a call', () => {
  const sch = { system_action: CT.DEFS.system_action.parameters, open_app: CT.DEFS.open_app.parameters };
  const P = (t) => (TP.parseToolCalls(t, ['system_action', 'open_app'], sch).toolCalls || []).map(c => [c.name, c.arguments]);
  assert.deepStrictEqual(P('system_action action="volume_up"'), [['system_action', { action: 'volume_up' }]]);
  assert.deepStrictEqual(P('```\nsystem_action(action="volume_set", level=50)\n```'), [['system_action', { action: 'volume_set', level: 50 }]]);
  assert.deepStrictEqual(P('{"name":"open_app","arguments":{"name":"Zalo"}}'), [['open_app', { name: 'Zalo' }]]);
  assert.deepStrictEqual(P('<tool_call>{"name":"open_app","arguments":{"name":"Zalo"}}</tool_call>'), [['open_app', { name: 'Zalo' }]]);
  assert.deepStrictEqual(P('system_action action="explode"'), []);
  assert.deepStrictEqual(P('Tôi sẽ tăng âm lượng cho bạn.'), []);
});
test('B44: set-volume-to-N and clear short system commands run directly; mixed tasks do not', () => {
  assert.strictEqual(SI.volumeLevel('tăng âm lượng lên 100'), 100); assert.strictEqual(SI.volumeLevel('chỉnh âm lượng 30%'), 30); assert.strictEqual(SI.volumeLevel('set volume to 40'), 40);
  assert.deepStrictEqual(SI.directSys('tăng âm lượng lên 100'), { action: 'volume_set', level: 100 });
  assert.deepStrictEqual(SI.directSys('tăng âm lượng lên'), { action: 'volume_up' });
  assert.strictEqual(SI.directSys('tăng âm lượng rồi mở Zalo nhắn tin cho Khôi'), null);
  assert.ok(CT.DEFS.system_action.parameters.properties.level, 'schema có level');
});
test('B44: model prints the tool call as text → executed through the normal path, no internal names in the answer', async () => {
  const { agent, calls } = mkAgent([say('system_action action="mute"'), say('Đã tắt tiếng bằng system_action.')]);
  const r = await agent.run({ messages: [{ role: 'user', content: 'tắt tiếng máy giúp mình rồi mở Spotify' }], confirm: async () => true });
  assert.ok(calls.some(c => c.n === 'system_action' && c.a.action === 'mute'), JSON.stringify(calls));
  assert.ok(!/system_action/.test(r.text), r.text);
  assert.strictEqual(AG.scrubToolNames('Tôi đã gọi system_action và `open_app`.', ['system_action', 'open_app'], n => CT.DEFS[n]), 'Tôi đã gọi thao tác hệ thống và mở ứng dụng.');
});
test('B43: app name + action verb = operate the app (draft-only still counts); first turn forced to call a tool; honest notice if nothing done', async () => {
  const q = 'soạn email trên Outlook web gửi khoik647@gmail.com, tiêu đề "Thử AIVN", chỉ soạn, không gửi';
  assert.ok(AG.isAppTask(q)); assert.strictEqual(AG.appOf(q), 'Outlook web'); assert.ok(!AG.isAppTask('Outlook là gì?'));
  const { agent, seen } = mkAgent([say('Tiêu đề: Thử AIVN\nNội dung: Xin chào'), say('Tiêu đề: Thử AIVN\nNội dung: Xin chào')]);
  const r = await agent.run({ messages: [{ role: 'user', content: q }], confirm: async () => true });
  assert.strictEqual(seen[0].toolChoice, 'required', 'lượt đầu buộc gọi công cụ');
  assert.ok(String(r.warning || r.text).includes('CHƯA thao tác gì trên Outlook web'), JSON.stringify(r).slice(0, 300));
});
test('B41: JavaScript tool hidden for web/app tasks and its description says there is no DOM', async () => {
  assert.match(AG.TOOL_DEFS ? JSON.stringify(AG.TOOL_DEFS.run_javascript || '') : fs.readFileSync(path.join(__dirname, '../src/agent/agent.js'), 'utf8'), /DOM/);
  const { agent, seen } = mkAgent([call('open_url', { url: 'https://outlook.live.com' }), say('Đã mở.')], null, ['open_app', 'open_url', 'screen_look', 'screen_act', 'run_javascript']);
  await agent.run({ messages: [{ role: 'user', content: 'mở Outlook web và bấm Thư mới' }], confirm: async () => true });
  assert.ok(seen.length && seen.every(s => !s.tools.includes('run_javascript')), JSON.stringify(seen.map(s => s.tools)));
});
test('B40: screen_look on an unchanged screen is blocked after 2 identical observations, then the turn stops honestly', async () => {
  const replies = []; for (let i = 0; i < 12; i++) replies.push(call('screen_look', {}));
  const exec = (n) => n === 'screen_look' ? { forModel: 'Quan sát: [e1] nút "Thư mới"; [e2] ô Tìm kiếm', summary: '2 phần tử' } : { forModel: 'ok', summary: 'ok' };
  const { agent, calls } = mkAgent(replies, exec);
  const r = await agent.run({ messages: [{ role: 'user', content: 'mở Outlook web rồi bấm Thư mới' }], confirm: async () => true });
  assert.ok(calls.filter(c => c.n === 'screen_look').length <= 3, `quan sát ${calls.filter(c => c.n === 'screen_look').length} lần`);
  assert.ok(r.text && r.text.length, 'có câu trả lời trung thực');
});
test('fresh context: a new task drops the previous task; a follow-up keeps it', async () => {
  const hist = [{ role: 'user', content: 'Nhắn Zalo cho Khôi: chào' }, { role: 'assistant', content: 'Đã nhắn.' }];
  const a = mkAgent([say('Xong.')]);
  await a.agent.run({ messages: [...hist, { role: 'user', content: 'mở Outlook web rồi bấm Thư mới' }], confirm: async () => true });
  assert.ok(!a.seen[0].msgs.some(m => /Nhắn Zalo cho Khôi/.test(String(m.content))), 'việc mới không mang việc cũ');
  const b = mkAgent([say('Xong.')]);
  await b.agent.run({ messages: [...hist, { role: 'user', content: 'nhắn lại tin đó lần nữa' }], confirm: async () => true });
  assert.ok(b.seen[0].msgs.some(m => /Nhắn Zalo cho Khôi/.test(String(m.content))), 'câu nối tiếp giữ ngữ cảnh');
});
test('picker: among smooth models the strongest (largest) wins even when a smaller one is installed', () => {
  const fit = { level: 'fit', tps: 60 };
  const mk = (id, size, installed) => ({ id, size, installed, vision: true, fit, agentFit: fit, catalog: { id, claims: [{ t: 'tools', k: 'v' }, { t: 'gui', k: 'v' }] } });
  const list = [mk('qwen3-vl-2b', 2e9, true), mk('qwen3-vl-4b', 3e9, false), mk('qwen3-vl-8b', 6e9, false)];
  const best = EL.bestFor(list, { shipped: { 'qwen3-vl-2b': { grounding: { score: 7 } }, 'qwen3-vl-4b': { grounding: { score: 8 } }, 'qwen3-vl-8b': { grounding: { score: 9 } } } });
  assert.ok(best, 'có mô hình'); assert.strictEqual(best.id, 'qwen3-vl-8b');
});
