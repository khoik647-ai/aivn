'use strict';
// B219 (#85): câu chỉ NHÌN màn hình mà nhắc tới ô soạn tin (“ô soạn tin”, “message box”, “消息输入框”)
// không phải lệnh gửi. Không hỏi “Gửi cho ai?” trước mọi bước; QA chấm theo câu trả lời, không đòi bằng chứng đã gửi.
// Việc gửi thật (vi/en/zh) vẫn là gửi và vẫn đòi bước đã kiểm chứng gửi.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const SV = require('../src/agent/send-verify');
const Q = require('../src/qa-runner');

const LOOKS = [
  ['vi', 'Nhìn ô soạn tin đang có chữ gì (nếu trống thì nói “ô soạn trống”)? Chỉ nhìn, đừng gửi.', 'Ô soạn trống.'],
  ['en', 'Look at the message box and tell me if it is empty (don\'t send).', 'The message box is empty.'],
  ['zh', '看看消息输入框里有什么？只看，不要发送。', '输入框是空的。'],
  ['zh', '看一下输入框是不是空的', '输入框是空的。'],
  ['vi', 'trả lời giúp mình ô soạn tin có trống không', 'Ô soạn trống.'],
  ['en', 'What\'s in the compose box?', 'It is empty.'],
  ['zh', '检查一下消息框里有没有字？', '消息框是空的。'],
];

test('B219: câu chỉ nhìn ô soạn không phải gửi, không hỏi người nhận (vi/en/zh)', () => {
  for (const [, q] of LOOKS) {
    assert.strictEqual(SV.lookOnly(q), true, q);
    assert.strictEqual(SV.msgSend(q), false, q);
    assert.strictEqual(SV.missingRecipient(q), false, q);
  }
  // chú thích trong ngoặc (chữ mẫu, “đừng gửi”) không phải nội dung cần gõ
  const vi = LOOKS[0][1];
  assert.strictEqual(SV.textFromRequest(vi, 'ô soạn trống'), false);
  assert.strictEqual(SV.textFromRequest(vi, 'mai 8h họp nhé'), false);
  assert.deepStrictEqual(SV.quotedIn('Nhìn ô soạn tin (nói “ô soạn trống”)?'), []);
  // gửi thật: chữ trong ngoặc vẫn là nội dung tin
  assert.strictEqual(SV.textFromRequest('gửi tin cho An (mai 8h họp nhé)', 'mai 8h họp nhé'), true);
});

test('B219: cổng chat không hỏi “Gửi cho ai?” khi câu chỉ yêu cầu nhìn', () => {
  const q = LOOKS[0][1];
  const st = {};
  assert.strictEqual(SV.chatGate({ query: q, text: 'ô soạn trống', proc: 'Zalo', title: 'Zalo', state: st, header: ['Lan'] }), null);
  assert.strictEqual(st.askWho, undefined);
  const search = {};
  assert.strictEqual(SV.chatGate({ query: q, text: 'Lan', searchField: true, proc: 'Zalo', title: 'Zalo', state: search, header: [] }), null);
  assert.strictEqual(search.askWho, undefined);
  const sub = {};
  const g = SV.chatGate({ query: q, text: 'ô soạn trống', submit: true, proc: 'Zalo', title: 'Zalo', state: sub, header: ['Lan'] });
  assert.match(g, /KHÔNG gửi/);
  assert.strictEqual(sub.askWho, undefined, 'không biến câu nhìn thành câu hỏi người nhận');
});

test('B219: QA chấm câu chỉ nhìn theo câu trả lời, không đòi bằng chứng đã gửi/đã soạn', () => {
  for (const [, q, ans] of LOOKS) {
    const draft = SV.DRAFT_ONLY.test(q); // “đừng gửi / don't send / 不要发送” vẫn là cờ nháp, nhưng không phải việc soạn
    const ok = Q.statusOf({ outcome: 'done', text: ans, steps: [{ name: 'screen_look', status: 'ok' }] }, { task: q, draft });
    assert.strictEqual(ok.status, 'done', q + ' ' + (ok.reason || ''));
    const bare = Q.statusOf({ outcome: 'done', text: ans, steps: [{ name: 'screen_look', status: 'ok' }] }, { task: q, draft: true });
    assert.strictEqual(bare.status, 'done', 'kể cả khi người gọi gắn cờ nháp: ' + q);
    const fail = Q.statusOf({ outcome: 'done', text: 'Mình không thể nhìn màn hình.', steps: [{ name: 'screen_look', status: 'ok' }] }, { task: q, draft });
    assert.strictEqual(fail.status, 'failed', q);
  }
});

test('B219: gửi thật vẫn là gửi và vẫn đòi kiểm chứng đã gửi (vi/en/zh)', () => {
  const withWho = [
    ['gửi tin cho An', 'An'],
    ['send a message to An', 'An'],
    ['给An发消息', 'An'],
  ];
  for (const [q, who] of withWho) {
    assert.strictEqual(SV.lookOnly(q), false, q);
    assert.strictEqual(SV.msgSend(q), true, q);
    assert.strictEqual(SV.recipientOf(q), who, q);
    assert.strictEqual(SV.missingRecipient(q), false, q);
    assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Đã gửi.', steps: [] }, { task: q }).status, 'failed', q);
    assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Đã gửi.', steps: [{ verify: { sent: true } }] }, { task: q }).status, 'done', q);
  }
  // “发送消息…” không khớp msgSend (chữ 送 chen giữa) nhưng QA vẫn đòi bằng chứng đã gửi
  const fa = '发送消息给王老师';
  assert.strictEqual(SV.recipientOf(fa), '王老师');
  assert.strictEqual(SV.missingRecipient(fa), false);
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: '已发送。', steps: [] }, { task: fa }).status, 'failed');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: '已发送。', steps: [{ verify: { sent: true } }] }, { task: fa }).status, 'done');
  // không người nhận → vẫn hỏi trước
  for (const q of ['nhắn giúp mình là mai 8h họp nhé', 'send a message for me saying the meeting is at 8 tomorrow', '帮我发消息说明天8点开会', 'reply ok', 'text her that I am late']) {
    assert.strictEqual(SV.msgSend(q), true, q);
    assert.strictEqual(SV.missingRecipient(q), true, q);
  }
  // nhắc ô soạn kèm lệnh gửi thật vẫn là gửi
  for (const q of ['gửi tin cho An, xem ô soạn tin có trống không', 'Look at the message box and send a message to An', '看看消息输入框，然后给An发消息']) {
    assert.strictEqual(SV.lookOnly(q), false, q);
    assert.strictEqual(SV.msgSend(q), true, q);
    assert.strictEqual(SV.missingRecipient(q), false, q);
  }
  // việc chỉ soạn: “soạn tin … đừng gửi” không bị SEND_TASK đòi draftIn; “soạn sẵn tin nhắn” thì có
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Đã soạn.' }, { task: 'soạn tin cho Lan, chỉ soạn đừng gửi', draft: true }).status, 'done');
  const draftTask = 'soạn sẵn tin nhắn cho Cloud của tôi trên Zalo: "AIVN nháp", chỉ soạn đừng gửi';
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Đã soạn, chưa gửi đi.', steps: [{}] }, { task: draftTask, draft: true }).status, 'failed');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Đã soạn, chưa gửi đi.', steps: [{ draftIn: { text: 'x' } }] }, { task: draftTask, draft: true }).status, 'done');
});

function mkAgent(lang, replies) {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b219-')); const calls = { model: 0, exec: [] };
  const engine = { status: () => ({ loaded: true, contextSize: 8192, vision: true }), chatStep: async () => {
    calls.model++;
    const r = replies[Math.min(calls.model, replies.length) - 1];
    return r || { text: replies[replies.length - 1].text || 'x', toolCalls: [], finishReason: 'stop', usage: {} };
  } };
  const names = ['open_app', 'screen_look', 'screen_act'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { calls.exec.push([n, a]); return { forModel: 'Ô soạn: TRỐNG', summary: 'trống' }; } };
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: true, uiLang: lang }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, calls };
}
const lookReply = (ans) => [
  { text: '', toolCalls: [{ id: '1', name: 'screen_look', arguments: {} }], finishReason: 'tool_calls', usage: {} },
  { text: ans, toolCalls: [], finishReason: 'stop', usage: {} },
];

test('B219: agent.run câu chỉ nhìn thì chạy bước nhìn, không hỏi người nhận; gửi không người nhận vẫn hỏi ngay (vi/en/zh)', async () => {
  for (const [lang, q, ans] of LOOKS.slice(0, 3)) {
    const { agent, calls } = mkAgent(lang, lookReply(ans));
    const r = await agent.run({ messages: [{ role: 'user', content: q }], confirm: async () => true });
    assert.notStrictEqual(r.outcome, 'asked_user', `${lang}: ${r.text}`);
    assert.ok(!SV.ASKED_WHO.test(r.text), `${lang}: ${r.text}`);
    assert.ok(calls.model >= 1, lang);
    assert.ok(r.steps.some(s => s.name === 'screen_look' && s.status === 'ok'), `${lang}: ${JSON.stringify(r.steps.map(s => s.name))}`);
    assert.match(r.text, new RegExp(ans.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const [lang, q, re] of [['vi', 'nhắn giúp mình là mai 8h họp nhé', /^Gửi cho ai\?/], ['en', 'send a message for me saying the meeting is at 8 tomorrow', /^Who should I send it to\?/], ['zh', '帮我发消息说明天8点开会', /^发给谁？/]]) {
    const { agent, calls } = mkAgent(lang, lookReply('không được chạy'));
    const r = await agent.run({ messages: [{ role: 'user', content: q }], confirm: async () => true });
    assert.strictEqual(r.outcome, 'asked_user', lang);
    assert.match(r.text, re, `${lang}: ${r.text}`);
    assert.strictEqual(calls.model, 0, lang);
    assert.deepStrictEqual(calls.exec, [], lang);
    assert.strictEqual(r.steps.length, 0, lang);
  }
  const { agent, calls } = mkAgent('vi', lookReply('Chưa gửi.'));
  const r = await agent.run({ messages: [{ role: 'user', content: 'gửi tin cho An' }], confirm: async () => true });
  assert.notStrictEqual(r.outcome, 'asked_user', r.text);
  assert.ok(calls.model >= 1);
  assert.ok(!/^Gửi cho ai\?/.test(r.text), r.text);
});
