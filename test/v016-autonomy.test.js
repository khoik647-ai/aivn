'use strict';
// 0.16 “Tự làm không hỏi”: công tắc + câu trong yêu cầu, nối vào vòng AIVN AGENT (thẻ xin phép công cụ) và điều khiển màn hình
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const AU = require('../src/agent/autonomy');
const { createAgent } = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');

function mk(replies, settings) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-au-'));
  const engine = { status: () => ({ loaded: true, contextSize: 4096 }), chatStep: async () => replies.shift() };
  const trashed = [];
  const agent = createAgent({ engine, getSettings: () => ({ agentFolders: [root], agentMemory: false, ...settings }), allowAlways: () => {}, memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async (p) => { trashed.push(p); fs.rmSync(p); }, extractFile: async () => ({}), embedForMemory: async () => ({}) });
  return { agent, root, trashed };
}
const call = (name, args) => ({ text: '', toolCalls: [{ id: 'c' + Math.random(), name, arguments: args }], finishReason: 'tool_calls', usage: { completion_tokens: 3 } });
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 3 } });

test('công tắc tắt: ghi tệp vẫn hiện thẻ xin phép', async () => {
  const r = [null, say('xong')]; const ag = mk(r, { agentAutonomy: false }); const f = path.join(ag.root, 'a.md'); r[0] = call('write_file', { path: f, content: 'x' });
  const cards = []; await ag.agent.run({ messages: [{ role: 'user', content: 'ghi tệp a.md' }], approve: async (c) => { cards.push(c); return { ok: true }; } });
  assert.equal(cards.length, 1);
});
test('công tắc bật: ghi tệp không hỏi, bước ghi dấu ⚡; xoá tệp KHÔNG nêu tên vẫn hỏi', async () => {
  const r = [null, null, say('xong')]; const ag = mk(r, { agentAutonomy: true });
  const f = path.join(ag.root, 'a.md'); const g = path.join(ag.root, 'bi-mat.txt'); fs.writeFileSync(g, 'z');
  r[0] = call('write_file', { path: f, content: 'x' }); r[1] = call('delete_file', { path: g });
  const cards = []; const res = await ag.agent.run({ messages: [{ role: 'user', content: 'ghi tệp a.md rồi dọn thư mục' }], approve: async (c) => { cards.push(c.tool); return { ok: false }; } });
  assert.ok(fs.existsSync(f)); assert.equal(res.steps[0].auto, 'toggle');
  assert.deepStrictEqual(cards, ['delete_file']); assert.ok(fs.existsSync(g), 'xoá tệp không được nêu tên phải hỏi');
});
test('câu “không cần hỏi lại” bật cho riêng lượt đó; xoá đúng tệp người dùng nêu tên thì không hỏi', async () => {
  const r = [null, say('xong')]; const ag = mk(r, { agentAutonomy: false }); const g = path.join(ag.root, 'nhap.txt'); fs.writeFileSync(g, 'z');
  r[0] = call('delete_file', { path: g });
  const cards = []; const res = await ag.agent.run({ messages: [{ role: 'user', content: 'Xoá tệp nhap.txt, không cần hỏi lại' }], approve: async (c) => { cards.push(c); return { ok: false }; } });
  assert.equal(cards.length, 0); assert.equal(res.steps[0].auto, 'phrase'); assert.deepStrictEqual(ag.trashed, [g]);
});
test('chạy lệnh / Python / MCP luôn hỏi kể cả khi bật', () => {
  const auto = AU.forTurn({ setting: true, query: 'cứ làm luôn' });
  for (const tool of ['run_command', 'run_python', 'run_javascript', 'mcp__fs__write_file', 'biz_deleteInvoice', 'biz_registerPayment', 'biz_listStock', 'excel_write_to_sheet']) assert.equal(AU.skipAsk(auto, 'tool', { tool }), false, tool);
  assert.equal(AU.skipAsk(auto, 'open-exec'), false); assert.equal(AU.skipAsk(auto, 'system', { asked: false }), false);
});
test('gửi tin: chỉ không hỏi khi nội dung đúng là tin người dùng nêu; “hỏi trước khi gửi” thắng', () => {
  const q = 'Nhắn Trần Quỳnh Anh "Mai 8h họp nhóm nhé", không cần hỏi lại';
  const a = AU.forTurn({ setting: false, query: q });
  assert.ok(AU.skipAsk(a, 'desk-send', { text: 'Mai 8h họp nhóm nhé' })); assert.ok(!AU.skipAsk(a, 'desk-send', { text: 'Mai 9h họp nhé' }));
  const b = AU.forTurn({ setting: true, query: 'Nhắn Hoa "ok", hỏi trước khi gửi' }); assert.ok(!AU.skipAsk(b, 'desk-send', { text: 'ok' }));
  assert.ok(AU.skipAsk(AU.forTurn({ setting: true }), 'desk-step'));
  assert.ok(!AU.skipAsk(AU.forTurn({ setting: false, query: 'đừng hỏi tôi về chuyện đó' }), 'desk-step'));
});
test('lịch tự động (headless) không bao giờ tự làm dù công tắc bật', async () => {
  const r = [null, say('xong')]; const ag = mk(r, { agentAutonomy: true }); const f = path.join(ag.root, 'a.md'); r[0] = call('write_file', { path: f, content: 'x' });
  const res = await ag.agent.run({ messages: [{ role: 'user', content: 'ghi tệp a.md' }], headless: true });
  assert.ok(!res.steps.some(s => s.auto));
});
test('giao diện: công tắc Cài đặt + nút trên thanh AIVN AGENT, cài đặt lưu dạng boolean', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/index.html'), 'utf8');
  assert.match(html, /id="agAuto"/); assert.match(html, /id="autoPill"/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src/main.js'), 'utf8');
  assert.match(main, /settings\.data\.agentAutonomy = rest\.agentAutonomy === true/); assert.match(main, /agentAutonomy: false/);
});
test('kiểm thử thật gần nhất (cửa sổ chat thử, xvfb): gõ thường và gửi đúng tin không hỏi; gửi chữ khác vẫn hỏi', { skip: !fs.existsSync('/workspace/qa-0.16/desk-auto/qadesk016.json') }, () => {
  const d = JSON.parse(fs.readFileSync('/workspace/qa-0.16/desk-auto/qadesk016.json', 'utf8'));
  assert.deepStrictEqual(d.autoPlain, { asks: 0, auto: 'phrase' });
  assert.strictEqual(d.autoSendNamed.asks, 0); assert.match(d.autoSendNamed.log, /SENT:xin chào Lan\n$/);
  assert.strictEqual(d.autoSendOther.asks, 1); assert.ok(d.autoSendOther.risk);
});
