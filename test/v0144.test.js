// 0.14.4: mở ứng dụng luôn qua công cụ, ẩn câu "chưa cài" cũ, nhật ký, lý do dừng bộ máy
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openIntent, sanitizeHistory, fakeActionCheck, createAgent } = require('../src/agent/agent');
const CT = require('../src/agent/computer-tools');
const { createMemoryStore } = require('../src/agent/memory');
const LOG = require('../src/logger');
const { createEngineProxy } = require('../src/engine-proxy');

test('openIntent: nhận "mở X", bỏ lời đệm, bỏ qua địa chỉ web/thư mục/cài đặt hệ thống', () => {
  assert.deepStrictEqual(openIntent('mở zalo'), { name: 'zalo', rest: '' });
  assert.deepStrictEqual(openIntent('Hãy mở Microsoft Word giúp tôi'), { name: 'Microsoft Word', rest: '' });
  assert.deepStrictEqual(openIntent('giúp mình mở "Zalo PC" nhé'), { name: 'Zalo PC', rest: '' });
  assert.strictEqual(openIntent('mở zalo và gửi tin nhắn cho An').name, 'zalo');
  assert.ok(openIntent('mở zalo và gửi tin nhắn cho An').rest);
  assert.strictEqual(openIntent('mở youtube.com'), null);
  assert.strictEqual(openIntent('mở https://zalo.me'), null);
  assert.strictEqual(openIntent('mở thư mục Tài liệu'), null);
  assert.strictEqual(openIntent('bật wifi'), null);
  assert.strictEqual(openIntent('Zalo là gì?'), null);
});

test('sanitizeHistory ẩn câu trả lời cũ "chưa được cài đặt / bản web Zalo"', () => {
  const msgs = [{ role: 'user', content: 'mở zalo' }, { role: 'assistant', content: 'Zalo chưa được cài đặt trên máy. Mở trang web Zalo (chat.zalo.me) nhé?' }, { role: 'assistant', content: 'Đã mở Notepad.' }, { role: 'user', content: 'mở zalo' }];
  const r = sanitizeHistory(msgs);
  assert.strictEqual(r.hidden, 1);
  assert.ok(!/chat\.zalo/.test(r.messages[1].content));
  assert.strictEqual(r.messages[2].content, 'Đã mở Notepad.');
});

test('khẳng định "chưa được cài đặt" mà lượt này không gọi list_apps/open_app → bị bắt', () => {
  assert.strictEqual(fakeActionCheck('Ứng dụng Zalo chưa được cài đặt trên máy của bạn.', [], ['open_app', 'list_apps'], 'zalo có không'), 'claim');
  assert.notStrictEqual(fakeActionCheck('Zalo chưa được cài đặt.', [{ name: 'list_apps', status: 'ok' }], ['open_app', 'list_apps'], 'zalo có không'), 'claim');
});

function mk(replies) {
  let i = 0; const sent = []; const opts = []; const logged = [];
  const engine = { status: () => ({ loaded: true, contextSize: 4096 }), countTokensAsync: async (a) => a.map(() => 10),
    chatStep: async (msgs, o) => { sent.push(JSON.parse(JSON.stringify(msgs))); opts.push(o); const x = replies[Math.min(i++, replies.length - 1)]; return { text: '', toolCalls: [], finishReason: 'stop', usage: {}, ...x }; } };
  const opened = [];
  const computer = { names: () => ['open_app', 'list_apps'], defs: { open_app: CT.DEFS.open_app, list_apps: CT.DEFS.list_apps }, has: n => ['open_app', 'list_apps'].includes(n), CompError: CT.CompError,
    exec: async (n, a) => { opened.push(a.name); return { forModel: 'Đã mở Zalo', summary: 'Đã mở Zalo' }; } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v144-'));
  const agent = createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {}, logTool: (x) => logged.push(x) });
  return { agent, opened, sent, opts, logged };
}
const OLD = [{ role: 'user', content: 'mở zalo' }, { role: 'assistant', content: 'Zalo chưa được cài đặt trên máy bạn. Mở trang web Zalo nhé?' }];

test('"mở Zalo" trong hội thoại cũ: gọi open_app thật, không hỏi mô hình, ghi nhật ký công cụ', async () => {
  const { agent, opened, sent, logged } = mk([{ text: 'Zalo chưa được cài đặt.' }]);
  const r = await agent.run({ messages: [...OLD, { role: 'user', content: 'Mở Zalo' }], confirm: async () => true });
  assert.deepStrictEqual(opened, ['Zalo']);
  assert.strictEqual(sent.length, 0);
  assert.match(r.text, /Đã mở/);
  assert.strictEqual(r.steps[0].name, 'open_app');
  assert.strictEqual(logged[0].name, 'open_app');
});

test('"mở Zalo rồi nhắn…": mở trước, mô hình thấy kết quả công cụ, câu cũ đã bị ẩn', async () => {
  const { agent, opened, sent } = mk([{ text: 'Đã mở Zalo. Bạn muốn nhắn gì cho An?' }]);
  const r = await agent.run({ messages: [...OLD, { role: 'user', content: 'mở zalo rồi nhắn cho An' }], confirm: async () => true });
  assert.strictEqual(opened[0], 'zalo');
  const flat = JSON.stringify(sent[0]);
  assert.ok(!/trang web Zalo/.test(flat), 'câu "chưa cài" cũ không còn trong lịch sử');
  assert.ok(sent[0].some(m => m.role === 'tool'), 'có kết quả open_app');
  assert.ok(r.text.length > 0);
});

test('yêu cầu thao tác (không phải "mở X"): vòng đầu ép gọi công cụ', async () => {
  const { agent, opts } = mk([{ text: 'Xong.' }]);
  await agent.run({ messages: [{ role: 'user', content: 'gửi tin nhắn Zalo cho An' }], confirm: async () => true });
  assert.strictEqual(opts[0].toolChoice, 'required');
});

test('logger: ghi đồng bộ, che bí mật, xoay vòng ~5 MB, tail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v144log-'));
  LOG.init(dir);
  LOG.log('tool', 'run_command ok', { args: { cmd: 'echo', apiKey: 'abc123', token: 'hf_ABCDEFGHIJKLMNOPQRSTUVWXYZ' } });
  const t = fs.readFileSync(path.join(dir, 'aivn.log'), 'utf8');
  assert.match(t, /run_command ok/); assert.ok(!/abc123|hf_ABCDEF/.test(t), t);
  LOG.block('engine', 'tiến trình kết thúc', ['code=null signal=SIGTERM']);
  assert.match(fs.readFileSync(path.join(dir, 'engine.log'), 'utf8'), /SIGTERM/);
  const big = 'x'.repeat(1000);
  for (let i = 0; i < 5600; i++) LOG.log('app', big);
  assert.ok(fs.existsSync(path.join(dir, 'aivn.log.1')));
  assert.ok(fs.statSync(path.join(dir, 'aivn.log')).size < 5.5 * 1024 * 1024);
  assert.strictEqual(LOG.tail(200).split('\n').filter(Boolean).length <= 200, true);
});

test('engine-proxy: AIVN tự dừng → nêu lý do; sập thật → mã thoát, không có lý do', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v144p-'));
  const host = path.join(dir, 'host.js');
  fs.writeFileSync(host, "process.send({type:'ready',pid:process.pid,node:process.version});process.on('message',m=>{if(m.method==='hardwareInfo')process.exit(3)});setInterval(()=>{},1000);");
  const logs = []; const p = createEngineProxy({ nodePath: process.execPath, hostScript: host, log: (s) => logs.push(s) });
  const g = p.generate([], {}).catch(e => e);
  await new Promise(r => setTimeout(r, 400));
  assert.strictEqual(p.busy(), true);
  await p.restart({}, 'đổi cài đặt GPU');
  const e1 = await g;
  assert.strictEqual(e1.code, 'ENGINE_EXIT'); assert.strictEqual(e1.killReason, 'đổi cài đặt GPU'); assert.match(e1.message, /khởi động lại/);
  const e2 = await p.hardwareInfo().catch(e => e);
  assert.strictEqual(e2.code, 'ENGINE_EXIT'); assert.strictEqual(e2.exitCode, 3); assert.strictEqual(e2.killReason, null); assert.match(e2.message, /đột ngột \(mã 3\)/);
  assert.ok(logs.some(l => /do AIVN: đổi cài đặt GPU · đang chạy: generate/.test(l)), logs.join('\n'));
  assert.ok(logs.some(l => /code=3 signal=null · đang chạy: hardwareInfo/.test(l)), logs.join('\n'));
  await p.stop('test xong');
});
