'use strict';
// Máy thật beta.2 (4070S, Qwen3-VL 8B, 2560×1440 @125%, Zalo thật): B61 câu lệnh KHÔNG có người nhận → hỏi “Gửi cho ai?” trước mọi thao tác;
// B62 toạ độ OCR → chuột ở 125%/150% (ảnh chụp theo px vật lý, chuột theo px logic và ngược lại) + nhật ký từng cú bấm.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const SV = require('../src/agent/send-verify');

test('B61: “giúp/hộ/cho mình” là người dùng, không phải người nhận (vi/en/zh)', () => {
  for (const q of ['nhắn giúp mình là mai 8h họp nhé', 'nhắn hộ mình là mai 8h họp nhé', 'nhắn tin giúp tôi rằng mai nghỉ', 'nhắn mình là mai họp',
    'gửi email nhắc lịch họp', 'gửi mail giúp mình nhé', 'gửi thư cho thầy',
    'send a message for me saying meeting at 8', 'send a message saying hi', 'text for me: hi',
    '帮我发消息说明天8点开会', '帮我发个消息：明天开会', '发个微信说我晚点到']) {
    assert.strictEqual(SV.recipientOf(q), null, q); assert.ok(SV.missingRecipient(q), q);
  }
  // có người nhận / không phải việc gửi tin → không hỏi
  for (const [q, r] of [['nhắn giúp mình cho Trần Quỳnh Anh là mai họp', 'Trần Quỳnh Anh'], ['nhắn giúp Quỳnh Anh là mai họp', 'Quỳnh Anh'], ['gửi thư cho thầy Hùng', 'thầy Hùng'],
    ['gửi email cho cô Mai nhắc lịch họp', 'cô Mai'], ['send a message to Quynh Anh saying hi', 'Quynh Anh'], ['给王老师发消息', '王老师'], ['send Mr. Le Van Hung an email', 'Le Van Hung']]) {
    assert.strictEqual(SV.recipientOf(q), r, q); assert.ok(!SV.missingRecipient(q), q);
  }
  for (const q of ['nhắn vào cuộc trò chuyện hiện tại là ok', 'mở Zalo', 'trả lời câu hỏi này giúp mình', 'gửi tệp báo cáo vào thư mục Documents', 'chat với mình chút đi', 'tóm tắt email này']) assert.ok(!SV.missingRecipient(q), q);
});

function mkAgent(lang) {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qa8-')); const calls = { model: 0, exec: [] };
  const engine = { status: () => ({ loaded: true, contextSize: 8192 }), chatStep: async () => { calls.model++; return { text: 'Đã gửi cho Võ Khánh Lam Chính.', toolCalls: [{ id: '1', name: 'screen_act', arguments: { action: 'click', element: 'Võ Khánh Lam Chính' } }], finishReason: 'tool_calls', usage: {} }; } };
  const names = ['open_app', 'screen_look', 'screen_act'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { calls.exec.push([n, a]); return { forModel: 'ok', summary: 'ok' }; } };
  const mem = createMemoryStore(path.join(r0, 'm.json'));
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: true, uiLang: lang }), memory: mem, scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, calls };
}
test('B61: không có người nhận → hỏi “Gửi cho ai?” NGAY, mô hình không được chạy, không thao tác màn hình, không bịa người nhận (vi/en/zh)', async () => {
  for (const [lang, q, re] of [['vi', 'nhắn giúp mình là mai 8h họp nhé', /^Gửi cho ai\?/], ['en', 'send a message for me saying the meeting is at 8 tomorrow', /^Who should I send it to\?/], ['zh', '帮我发消息说明天8点开会', /^发给谁？/]]) {
    const { agent, calls } = mkAgent(lang);
    const r = await agent.run({ messages: [{ role: 'user', content: q }], confirm: async () => true });
    assert.match(r.text, re, `${lang}: ${r.text}`); assert.strictEqual(calls.model, 0, 'mô hình không được tự chọn người nhận'); assert.deepStrictEqual(calls.exec, []);
    assert.ok(!/Võ Khánh Lam Chính/.test(r.text));
    assert.ok(SV.ASKED_WHO.test(r.text));
  }
});
test('B61: trả lời câu hỏi bằng tên → làm lại việc trước với đúng người đó', () => {
  const nq = SV.answerWho('nhắn giúp mình là mai 8h họp nhé', 'Trần Quỳnh Anh');
  assert.strictEqual(SV.recipientOf(nq), 'Trần Quỳnh Anh'); assert.ok(!SV.missingRecipient(nq));
  assert.ok(!SV.missingRecipient(SV.answerWho('nhắn giúp mình là mai 8h họp nhé', 'đúng')), '“đúng” = chat đang mở (cổng vẫn đòi đọc chắc tiêu đề)');
});
