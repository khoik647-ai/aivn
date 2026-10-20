'use strict';
// 0.15.0: thẻ xin phép chung — xem trước nội dung, so sánh khi ghi đè, từ chối kèm lý do, "Luôn cho phép" không bao giờ bật sẵn
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const AP = require('../src/agent/approval');
const { createAgent } = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');

test('thẻ ghi tệp: tạo mới có xem trước; ghi đè có so sánh từng dòng; xoá không cho "Luôn cho phép"', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-ap-'));
  const f = path.join(d, 'a.md');
  const c1 = AP.buildCard('write_file', { path: f, content: '# Tiêu đề\n- ý 1' }, { label: 'Ghi tệp' });
  assert.equal(c1.title, 'Tạo tệp mới?'); assert.ok(c1.preview.includes('ý 1')); assert.equal(c1.diff, null); assert.equal(c1.allowAlways, true);
  fs.writeFileSync(f, 'dòng 1\ndòng 2\ndòng 3\n');
  const c2 = AP.buildCard('write_file', { path: f, content: 'dòng 1\ndòng HAI\ndòng 3\n' }, { label: 'Ghi tệp' });
  assert.equal(c2.title, 'Ghi đè tệp?'); assert.ok(c2.danger); assert.match(c2.diff.text, /- dòng 2\n\+ dòng HAI/); assert.equal(c2.diff.added, 1); assert.equal(c2.diff.removed, 1);
  const c3 = AP.buildCard('delete_file', { path: f }, { label: 'Xoá tệp' });
  assert.equal(c3.allowAlways, false);
  assert.ok(AP.needsApproval('mcp__filesystem__write_file')); assert.ok(!AP.needsApproval('read_file')); assert.ok(!AP.needsApproval('screen_act'));
  assert.match(AP.refusalText(c1, 'đặt tên là tom-tat.md'), /lý do: "đặt tên là tom-tat.md"/);
});

function mk(replies, settings) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-ap2-'));
  const msgs = [];
  const engine = { status: () => ({ loaded: true, contextSize: 4096 }), chatStep: async (m) => { msgs.push(m[m.length - 1]); return replies.shift(); } };
  const always = [];
  const agent = createAgent({ engine, getSettings: () => ({ agentFolders: [root], agentMemory: false, ...settings }), allowAlways: (n) => always.push(n), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, root, msgs, always };
}
const call = (name, args) => ({ text: '', toolCalls: [{ id: 'c' + Math.random(), name, arguments: args }], finishReason: 'tool_calls', usage: { completion_tokens: 3 } });
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 3 } });

test('từ chối kèm lý do: tệp không được ghi, lý do được gửi lại cho mô hình', async () => {
  const { agent, root, msgs } = mk([]);
  const f = path.join(root, 'x.md');
  const r0 = [call('write_file', { path: f, content: 'abc' }), say('Ok, mình sẽ đổi tên.')];
  const ag = mk(r0, {}); // dùng thư mục của ag
  const f2 = path.join(ag.root, 'x.md');
  ag.agent; r0[0].toolCalls[0].arguments.path = f2;
  const cards = [];
  const r = await ag.agent.run({ messages: [{ role: 'user', content: 'ghi tệp x.md' }], approve: async (c) => { cards.push(c); return { ok: false, reason: 'đặt tên là y.md' }; } });
  assert.equal(cards.length, 1); assert.equal(cards[0].tool, 'write_file'); assert.ok(cards[0].preview.includes('abc'));
  assert.ok(!fs.existsSync(f2));
  assert.equal(r.steps[0].status, 'refused');
  assert.match(String(ag.msgs[1].content), /đặt tên là y\.md/);
  void agent; void root; void msgs; void f;
});

test('cho phép + "Luôn cho phép": ghi tệp, lưu lựa chọn; lần sau không hỏi', async () => {
  const ag = mk([], {});
  const f = path.join(ag.root, 'ok.md');
  ag.msgs.length = 0;
  const replies = [call('write_file', { path: f, content: 'xin chào' }), say('Đã ghi.')];
  const ag2 = mk(replies, {}); replies[0].toolCalls[0].arguments.path = path.join(ag2.root, 'ok.md');
  let asked = 0;
  await ag2.agent.run({ messages: [{ role: 'user', content: 'ghi tệp' }], approve: async () => { asked++; return { ok: true, always: true }; } });
  assert.equal(asked, 1); assert.equal(fs.readFileSync(path.join(ag2.root, 'ok.md'), 'utf8'), 'xin chào'); assert.deepEqual(ag2.always, ['write_file']);
  const replies3 = [call('write_file', { path: 'PLACEHOLDER', content: 'lần 2' }), say('Xong.')];
  const ag3 = mk(replies3, { agentAlwaysAllow: ['write_file'] }); replies3[0].toolCalls[0].arguments.path = path.join(ag3.root, 'b.md');
  let asked3 = 0;
  await ag3.agent.run({ messages: [{ role: 'user', content: 'ghi tệp' }], approve: async () => { asked3++; return { ok: true }; } });
  assert.equal(asked3, 0); assert.equal(fs.readFileSync(path.join(ag3.root, 'b.md'), 'utf8'), 'lần 2');
});
test('"Luôn cho phép" không có tác dụng với xoá tệp', async () => {
  const replies = [call('delete_file', { path: 'P' }), say('Xong.')];
  const ag = mk(replies, { agentAlwaysAllow: ['delete_file'] });
  const f = path.join(ag.root, 'del.txt'); fs.writeFileSync(f, 'x'); replies[0].toolCalls[0].arguments.path = f;
  let asked = 0;
  await ag.agent.run({ messages: [{ role: 'user', content: 'xoá del.txt' }], approve: async () => { asked++; return { ok: false }; } });
  assert.equal(asked, 1); assert.ok(fs.existsSync(f));
});
