'use strict';
// QA lượt 8: B71b người nhận là đại từ/rác + “báo/trả lời/reply” phải hỏi “Gửi cho ai?”; B75 trả lời huỷ cho “Gửi cho ai?” = HUỶ, không phải tên
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const SV = require('../src/agent/send-verify');

test('B71b: đại từ / cụm không phải tên → chưa có người nhận → hỏi trước (vi/en/zh)', () => {
  for (const q of ['text her that I am late', 'message him: ok', 'text them: see you', 'gửi email nói mai nghỉ', 'nhắn anh ấy là mai họp', 'nhắn chị ấy giúp mình là ok', 'nhắn nó là mai nghỉ',
    '告诉她明天开会', 'báo giúp mình là mai nghỉ', 'trả lời là ok nhé', 'reply ok', 'reply to her: ok', 'Messenger: reply ok']) {
    assert.strictEqual(SV.recipientOf(q), null, q); assert.ok(SV.missingRecipient(q), q);
  }
  for (const [q, r] of [['text Tran Quynh Anh on Messenger: hi', 'Tran Quynh Anh'], ['báo cho Lan là mai nghỉ', 'Lan'], ['trả lời Lan là ok', 'Lan'], ['reply to Lan: ok', 'Lan'],
    ['gửi email cho thầy Lê Văn Hùng nói mai nghỉ', 'thầy Lê Văn Hùng'], ['tell Lan I am late', 'Lan'], ['nhắn Trần Quỳnh Anh là mai họp', 'Trần Quỳnh Anh'], ['告诉王老师明天开会', '王老师'], ['回复李先生：好的', '李先生']]) {
    assert.strictEqual(SV.recipientOf(q), r, q); assert.ok(!SV.missingRecipient(q), q);
  }
  // không phải việc gửi tin
  for (const q of ['báo cáo doanh thu tháng này', 'trả lời câu hỏi này giúp mình', 'đặt báo thức 6h', 'gửi tệp báo cáo vào thư mục Documents']) assert.ok(!SV.missingRecipient(q), q);
});
test('B75: “không / thôi, huỷ đi / no / 取消 / đúng rồi nhưng thôi đừng gửi” = huỷ; câu không giống tên → hỏi lại; tên thật vẫn nhận', () => {
  for (const r of ['không', 'thôi, huỷ đi', 'thôi', 'hủy', 'no', 'nope', 'cancel', 'never mind', '取消', '算了', '不要了', 'đúng rồi nhưng thôi đừng gửi', "don't send it"]) assert.ok(SV.cancelWho(r), r);
  for (const r of ['Lan', 'Trần Quỳnh Anh', 'cho chị Lan', 'đúng', 'yes', '王老师']) { assert.ok(!SV.cancelWho(r), r); assert.ok(!SV.unclearWho(r), r); }
  for (const r of ['her', 'him', 'gửi cho Lan nhưng nhắn là mai nghỉ nhé', 'thì bạn cứ chọn ai cũng được miễn là trong lớp']) assert.ok(SV.unclearWho(r), r);
});
function mkAgent(lang, calls) {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qa10-'));
  const engine = { status: () => ({ loaded: true, contextSize: 8192 }), chatStep: async () => { calls.model++; return { text: 'ok', toolCalls: [{ id: '1', name: 'screen_act', arguments: { action: 'click', element: 'không' } }], finishReason: 'tool_calls', usage: {} }; } };
  const names = ['open_app', 'screen_look', 'screen_act']; const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { calls.exec.push([n, a]); return { forModel: 'ok', summary: 'ok' }; } };
  return AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: true, uiLang: lang }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
}
test('B75 thật (agent.run): trả lời huỷ → “Đã huỷ”, mô hình không chạy, không thao tác màn hình; trả lời mập mờ → hỏi lại', async () => {
  for (const [lang, task, ask, reply, re] of [['vi', 'nhắn giúp mình là mai 8h họp nhé', 'Gửi cho ai? Cho mình tên đầy đủ của người nhận (đúng như trong ứng dụng).', 'thôi, huỷ đi', /^Đã huỷ/],
    ['en', 'text her that I am late', 'Who should I send it to? Give me the recipient’s full name (exactly as shown in the app).', 'no', /^Cancelled/], ['zh', '帮我发消息说明天8点开会', '发给谁？', '取消', /^已取消/]]) {
    const calls = { model: 0, exec: [] }; const agent = mkAgent(lang, calls);
    const r = await agent.run({ messages: [{ role: 'user', content: task }, { role: 'assistant', content: ask }, { role: 'user', content: reply }], confirm: async () => true });
    assert.match(r.text, re, `${lang}: ${r.text}`); assert.strictEqual(r.cancelled, true); assert.strictEqual(calls.model, 0); assert.deepStrictEqual(calls.exec, []);
  }
  const calls = { model: 0, exec: [] }; const agent = mkAgent('vi', calls);
  const r = await agent.run({ messages: [{ role: 'user', content: 'nhắn giúp mình là mai 8h họp nhé' }, { role: 'assistant', content: 'Gửi cho ai? Cho mình tên đầy đủ của người nhận (đúng như trong ứng dụng).' }, { role: 'user', content: 'her' }], confirm: async () => true });
  assert.ok(SV.ASKED_WHO.test(r.text), r.text); assert.strictEqual(r.outcome, 'asked_user'); assert.strictEqual(calls.model, 0); assert.deepStrictEqual(calls.exec, []);
});
