// 0.14.2: chống "giả vờ làm" + giao thức công cụ văn bản + duyệt trước khi gửi tin nhắn
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createAgent, fakeActionCheck, stripFake, NO_ACTION_WARN } = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');
const CT = require('../src/agent/computer-tools');
const { toolSupport } = require('../src/toolsupport');

const FAKE = `Được rồi, mình sẽ gửi tin nhắn cho Trần Quỳnh Anh.
[screen,look] Màn hình hiển thị cửa sổ Zalo
[screen,act] Gõ nội dung tin nhắn "Chúc buổi tối vui vẻ"
Bạn hãy gõ "tiếp tục" để mình làm bước sau.`;

test('nhận ra bước giả và lời nói đã làm khi chưa có công cụ', () => {
  const names = ['open_app', 'screen_act', 'screen_look'];
  assert.strictEqual(fakeActionCheck(FAKE, [], names), 'pseudo');
  assert.strictEqual(fakeActionCheck('Tôi đã gửi tin nhắn thành công.', [], names), 'claim');
  assert.strictEqual(fakeActionCheck('Mình đã mở Zalo cho bạn.', [], names), 'claim');
  assert.strictEqual(fakeActionCheck('Mình đã mở Zalo cho bạn.', [{ name: 'open_app', status: 'ok' }], names), null);
  assert.strictEqual(fakeActionCheck('Đã mở Zalo, và đã gửi tin nhắn.', [{ name: 'open_app', status: 'ok' }], names), 'claim'); // gửi cần screen_act thành công
  assert.strictEqual(fakeActionCheck('Thủ đô của Việt Nam là Hà Nội.', [], names), null);
  assert.strictEqual(fakeActionCheck('Mình không gửi được tin nhắn vì chưa bật Điều khiển màn hình.', [], names), null);
  assert.ok(!/\[screen/.test(stripFake(FAKE)));
});

function mkAgent(replies, { names = ['open_app', 'screen_act', 'screen_look'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-fake-'));
  const calls = []; const done = [];
  const engine = { status: () => ({ loaded: true, contextSize: 4096 }), chatStep: async (msgs, o) => { calls.push({ toolChoice: o.toolChoice, tools: o.tools.map(t => t.name), last: msgs[msgs.length - 1].content }); const r = replies.shift(); return typeof r === 'function' ? r(o) : r; } };
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { done.push({ n, a }); return { forModel: `Đã mở ứng dụng "${a.name}".`, summary: 'Đã mở ' + a.name }; } };
  const agent = createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, calls, done };
}
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 5 } });

test('bước giả → nhắc lại → buộc chọn công cụ → mô hình nói không làm được → thẻ cảnh báo', async () => {
  const { agent, calls, done } = mkAgent([say(FAKE), say('Tôi đã gửi tin nhắn thành công.'), { text: '', toolCalls: [{ id: 'x', name: 'cannot_do', arguments: { reason: 'cần mô hình nhìn ảnh để thao tác trong Zalo' } }], finishReason: 'tool_calls', usage: {} }]);
  const r = await agent.run({ messages: [{ role: 'user', content: 'gửi tin nhắn cho trần quỳnh anh ghi chúc buổi tối vui vẻ' }], confirm: async () => true });
  assert.strictEqual(r.warning, NO_ACTION_WARN);
  assert.match(r.text, /chưa làm được/); assert.ok(!/thành công/.test(r.text));
  assert.strictEqual(done.length, 0);
  assert.match(calls[1].last, /CHƯA gọi công cụ/);
  assert.strictEqual(calls[2].toolChoice, 'required'); assert.ok(calls[2].tools.includes('cannot_do') && calls[2].tools.includes('open_app'));
});

test('bước giả → buộc chọn công cụ → mô hình gọi open_app thật → công cụ chạy', async () => {
  const { agent, done } = mkAgent([say(FAKE), say(FAKE), { text: '', toolCalls: [{ id: 'y', name: 'open_app', arguments: { name: 'Zalo' } }], finishReason: 'tool_calls', usage: {} }, say('Mình đã mở Zalo. Phần gõ và gửi tin bạn cần tự làm vì chưa bật Điều khiển màn hình.')]);
  const r = await agent.run({ messages: [{ role: 'user', content: 'mở zalo nhắn cho Quỳnh Anh' }], confirm: async () => true });
  assert.deepStrictEqual(done, [{ n: 'open_app', a: { name: 'Zalo' } }]);
  assert.strictEqual(r.warning, null); assert.strictEqual(r.steps[0].status, 'ok');
});

test('trả lời bình thường không bị chặn', async () => {
  const { agent, calls } = mkAgent([say('Xin chào! Mình là AIVN AGENT.')]);
  const r = await agent.run({ messages: [{ role: 'user', content: 'chào bạn' }], confirm: async () => true });
  assert.strictEqual(calls.length, 1); assert.strictEqual(r.warning, null);
});

test('bấm Gửi / Enter luôn hỏi duyệt riêng; từ chối thì không thao tác', async () => {
  assert.ok(CT.isSendAction({ action: 'click', target: 'nút Gửi' }));
  assert.ok(CT.isSendAction({ action: 'key', keys: 'enter' }));
  assert.ok(CT.isSendAction({ action: 'type', text: 'Chúc buổi tối vui vẻ\n' }));
  assert.ok(!CT.isSendAction({ action: 'click', target: 'ô tìm kiếm' }));
  assert.ok(!CT.isSendAction({ action: 'type', text: 'Chúc buổi tối vui vẻ' }));
  const acted = []; const asked = [];
  const tools = CT.createComputerTools({ getSettings: () => ({ agentComputer: true, agentScreen: true }), visionReady: () => true, screen: { act: async (a) => { acted.push(a); return { forModel: 'ok', summary: 'ok' }; } } });
  const no = await tools.exec('screen_act', { action: 'click', target: 'nút Gửi' }, { confirm: async (req) => { asked.push(req); return false; } });
  assert.strictEqual(no.refused, true); assert.strictEqual(acted.length, 0); assert.strictEqual(asked[0].kind, 'send-message');
  await tools.exec('screen_act', { action: 'click', target: 'nút Gửi' }, { confirm: async () => true });
  assert.strictEqual(acted.length, 1);
  await tools.exec('screen_act', { action: 'click', target: 'ô chat Trần Quỳnh Anh' }, { confirm: async () => { throw new Error('không được hỏi'); } });
  assert.strictEqual(acted.length, 2);
});

test('nhãn hỗ trợ công cụ', () => {
  assert.strictEqual(toolSupport({ id: 'qwen3-4b-instruct-2507-q4_k_m' }).label, 'Tốt');
  assert.strictEqual(toolSupport({ file: 'gemma-2-9b-it-Q4_K_M.gguf' }).label, 'Hạn chế');
  assert.strictEqual(toolSupport({ id: 'gemma-3-4b-it-q4_k_m' }).label, 'Hạn chế');
  assert.strictEqual(toolSupport({ id: 'qwen2.5-0.5b-instruct-q4_k_m' }).label, 'Không');
  assert.strictEqual(toolSupport({ id: 'gpt-oss-20b-mxfp4' }).label, 'Tốt');
});

test('yêu cầu thao tác bị lờ đi cũng bị bắt', () => {
  const names = ['open_app'];
  assert.strictEqual(fakeActionCheck('Xin chào! Mình là AIVN AGENT. Bạn muốn mình làm gì?', [], names, 'gửi tin nhắn cho trần quỳnh anh'), 'ignored');
  assert.strictEqual(fakeActionCheck('Mình không thể gửi tin nhắn vì chưa bật Điều khiển màn hình.', [], names, 'gửi tin nhắn cho trần quỳnh anh'), null);
  assert.strictEqual(fakeActionCheck('Hà Nội.', [], names, 'thủ đô Việt Nam?'), null);
});
