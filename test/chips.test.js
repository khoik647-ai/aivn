const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createAgent, TOOL_GROUPS } = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');

function mk(settings) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-chips-'));
  const sent = [];
  const engine = { status: () => ({ loaded: true, contextSize: 4096 }), chatStep: async (msgs, o) => { sent.push(o.tools.map(t => t.name)); return { text: 'Xong.', toolCalls: [], finishReason: 'stop' }; } };
  const s = { agentFolders: [root], agentWeb: false, agentMemory: true, ...settings };
  const agent = createAgent({ engine, getSettings: () => s, memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({ kind: 'text', text: '' }), log: () => {} });
  return { agent, sent, s };
}

test('nút tắt công cụ: công cụ bị tắt không có trong danh sách', () => {
  const { agent, s } = mk({});
  for (const g of Object.keys(TOOL_GROUPS)) for (const n of TOOL_GROUPS[g]) assert.ok(agent.activeTools().includes(n), n);
  s.agentToolsOff = ['calc', 'files', 'reminder'];
  const t = agent.activeTools();
  for (const n of [...TOOL_GROUPS.calc, ...TOOL_GROUPS.files, ...TOOL_GROUPS.reminder]) assert.ok(!t.includes(n), n);
  assert.ok(t.includes('get_datetime') && t.includes('run_javascript') && t.includes('save_memory'));
  s.agentMemory = false; assert.ok(!agent.activeTools().includes('save_memory'));
});

test('công cụ bị tắt KHÔNG được gửi cho mô hình', async () => {
  const { agent, sent } = mk({ agentToolsOff: ['js', 'datetime'] });
  await agent.run({ messages: [{ role: 'user', content: 'Mấy giờ rồi?' }], confirm: async () => false });
  assert.ok(sent.length >= 1);
  for (const names of sent) { assert.ok(!names.includes('run_javascript')); assert.ok(!names.includes('get_datetime')); assert.ok(names.includes('calculator')); }
});
