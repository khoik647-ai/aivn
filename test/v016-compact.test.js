// 0.16: tự thu gọn lịch sử + ảnh trước MỖI lần gọi mô hình — lượt AIVN AGENT dài không bao giờ hỏng vì hết ngữ cảnh.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CP = require('../src/agent/compact');
const { createAgent } = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');
const CT = require('../src/agent/computer-tools');
const tok = (s) => Math.ceil(String(s).length / 3);
const IMG = { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } };

function checkShape(m) {
  assert.strictEqual(m[0].role, 'system'); assert.strictEqual(m[1].role, 'user', 'tin đầu sau hệ thống là của người dùng');
  const ids = new Set();
  for (const x of m) {
    if (x.role === 'assistant' && x.tool_calls) x.tool_calls.forEach(c => ids.add(c.id));
    if (x.role === 'tool') assert.ok(ids.has(x.tool_call_id), 'kết quả công cụ luôn đi cùng lời gọi của nó');
  }
}
function session(n, big = 2500) {
  const m = [{ role: 'system', content: 'Bạn là AIVN AGENT.' }, { role: 'user', content: 'mở Zalo và nhắn "chào" cho Lan' }];
  for (let i = 0; i < n; i++) {
    m.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, type: 'function', function: { name: i % 2 ? 'screen_act' : 'screen_look', arguments: '{}' } }] });
    m.push({ role: 'tool', tool_call_id: 'c' + i, content: `Bước ${i}: ` + 'màn hình có nút Gửi, ô tìm kiếm, danh sách hội thoại. '.repeat(Math.ceil(big / 55)) });
  }
  return m;
}

test('chỉ giữ ảnh của tin có ảnh mới nhất (ảnh cũ thay bằng ghi chú), kể cả khi ngữ cảnh còn dư', () => {
  const m = [{ role: 'system', content: 's' }, { role: 'user', content: [{ type: 'text', text: 'ảnh 1' }, IMG] }, { role: 'assistant', content: 'ok' }, { role: 'user', content: [{ type: 'text', text: 'ảnh 2' }, IMG, IMG] }];
  const r = CP.compact(m, { contextSize: 100000, count: tok });
  assert.ok(typeof r.messages[1].content === 'string' && r.messages[1].content.includes(CP.IMG_NOTE) && r.messages[1].content.includes('ảnh 1'));
  assert.strictEqual(r.messages[3].content.filter(p => p.type === 'image_url').length, 2);
  assert.ok(Array.isArray(m[1].content), 'không sửa mảng gốc');
});
test('kết quả quan sát màn hình cũ được rút gọn, 2 lần gần nhất giữ nguyên', () => {
  const m = session(6, 1200); const r = CP.compact(m, { contextSize: 100000, count: tok });
  const tools = r.messages.filter(x => x.role === 'tool');
  assert.ok(tools.slice(0, -2).every(x => x.content.length <= 420)); assert.ok(tools.slice(-2).every(x => x.content.length > 1000));
});
test('40 bước điều khiển màn hình ở ngữ cảnh 8192: vừa ngân sách, giữ yêu cầu người dùng + bước mới nhất, cặp công cụ không bị tách', () => {
  const m = session(40); const before = m.reduce((n, x) => n + tok(CP.textOf(x.content)), 0);
  assert.ok(before > 8192 * 3, 'đầu vào vượt xa ngữ cảnh');
  const r = CP.compact(m, { contextSize: 8192, count: tok, toolTok: 2500, reserve: 1200 });
  assert.ok(r.fits, JSON.stringify(r.actions)); assert.ok(r.tokens <= r.budget);
  checkShape(r.messages);
  assert.ok(r.messages[1].content.includes('nhắn "chào" cho Lan'));
  assert.ok(r.messages.at(-1).content.startsWith('Bước 39'), 'bước mới nhất còn nguyên');
  assert.ok(/Các bước cũ đã được lược bớt|Đã lược bớt \d+ bước cũ/.test(r.messages[0].content), 'có tóm tắt các bước đã bỏ');
});
test('lịch sử nhiều lượt trước: bỏ phần TRƯỚC yêu cầu hiện tại trước, tin đầu sau hệ thống vẫn là người dùng', () => {
  const m = [{ role: 'system', content: 's' }];
  for (let i = 0; i < 30; i++) m.push({ role: 'user', content: 'cũ ' + i + 'x'.repeat(1500) }, { role: 'assistant', content: 'y'.repeat(1500) });
  m.push({ role: 'user', content: 'việc mới' });
  const r = CP.compact(m, { contextSize: 4096, count: tok, reserve: 800 });
  assert.ok(r.fits); checkShape(r.messages); assert.strictEqual(r.messages.at(-1).content, 'việc mới');
});
test('một tin quá lớn (dán cả tệp) vẫn được cắt giữa cho vừa thay vì báo lỗi', () => {
  const m = [{ role: 'system', content: 's' }, { role: 'user', content: 'tóm tắt: ' + 'z'.repeat(60000) }];
  const r = CP.compact(m, { contextSize: 8192, count: tok, reserve: 1000 });
  assert.ok(r.fits, r.tokens + '/' + r.budget); assert.ok(r.messages[1].content.includes('(đã rút gọn)'));
});

let lookN = 0; const lookTag = () => { const k = lookN++; return 'abcdefghijklmnopqrstuvwxyz'[k % 26] + 'xyz'[Math.floor(k / 26) % 3]; };
function mkAgent(ctx, { rounds = 30, out = 3000, strict = true, under = 1 } = {}) {
  const sent = []; let i = 0; let overflowErrors = 0;
  const engine = { status: () => ({ loaded: true, id: 'qwen3-vl-8b-instruct-q4_k_m', contextSize: ctx, vision: true }), countTokens: (x) => Math.ceil(tok(x) * under),
    chatStep: async (msgs, o) => {
      const used = msgs.reduce((n, m) => n + tok(CP.textOf(m.content)) + (m.tool_calls ? tok(JSON.stringify(m.tool_calls)) : 0) + 8, 0) + tok(JSON.stringify(o.tools || []));
      if (strict && used + (o.maxTokens || 0) > ctx) { overflowErrors++; const e = new Error('request (' + used + ' tokens) exceeds the available context size, context_length_exceeded'); throw e; }
      sent.push(msgs.length);
      if (i++ < rounds) return { text: '', toolCalls: [{ id: 't' + i, name: 'screen_look', arguments: { question: 'đang thấy gì? ' + i } }], finishReason: 'tool_calls', usage: {} };
      return { text: 'Mình đã xem màn hình 30 lần.', toolCalls: [], finishReason: 'stop', usage: {} };
    } };
  const names = ['screen_look', 'screen_act'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => ({ forModel: `Màn hình (${a.question}): ` + 'cửa sổ Zalo, ô tìm kiếm, nút Gửi. '.repeat(Math.ceil(out / 35)), summary: 'đã nhìn ' + lookTag() }) }; // B66b: mỗi lần nhìn một màn hình KHÁC (không thì bộ chặn “không tiến triển” dừng sớm — đúng hành vi)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v16c-'));
  const logs = [];
  const agent = createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false, maxTokens: 512, agentTurnMaxTokens: 100000 }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: (x) => logs.push(x) });
  return { agent, sent, logs, overflow: () => overflowErrors };
}
test('lượt AIVN AGENT 30 lần nhìn màn hình (mỗi lần ~3000 ký tự) ở ngữ cảnh 8192: chạy hết, KHÔNG lần nào vượt ngữ cảnh', async () => {
  const { agent, sent, logs, overflow } = mkAgent(8192);
  const r = await agent.run({ messages: [{ role: 'user', content: 'xem màn hình 30 lần rồi báo cho mình' }], confirm: async () => true });
  assert.strictEqual(overflow(), 0, 'không lần gọi nào bị bộ máy từ chối vì hết ngữ cảnh');
  assert.ok(sent.length >= 31); assert.match(r.text, /30 lần/);
  assert.ok(r.steps.filter(s => s.name === 'screen_look').length >= 30);
  assert.ok(logs.some(l => /thu gọn/.test(l)));
});
test('ước lượng token lệch (bộ máy vẫn báo hết ngữ cảnh): tự thu gọn mạnh hơn và thử lại, không ném lỗi ra ngoài', async () => {
  const { agent, logs, overflow } = mkAgent(8192, { rounds: 20, under: 0.6 });
  const r = await agent.run({ messages: [{ role: 'user', content: 'xem màn hình 20 lần rồi báo cho mình' }], confirm: async () => true });
  assert.ok(overflow() >= 1, 'đã tái hiện bộ máy từ chối'); assert.match(r.text, /đã xem màn hình/);
  assert.ok(logs.some(l => /bộ máy báo hết ngữ cảnh/.test(l)) && logs.some(l => /thử lại 1/.test(l)));
});
