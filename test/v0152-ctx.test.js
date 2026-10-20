// 0.15.2: ngữ cảnh 1437 trên RTX 3050 Ti 4 GB → AIVN AGENT lỗi "Failed to compress chat history…" (tiếng Anh).
// Kiểm: không bao giờ nạp dưới 4096/8192, nhận ra lỗi tiếng Anh, kiểm tra lời nhắc trước khi gửi, bỏ tin cũ, và tái hiện bằng mô hình thật.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const TP = require('../src/agent/textproto');
const { loadPlans } = require('../src/engine');
const { createAgent } = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');
const CT = require('../src/agent/computer-tools');
const GB = 1024 ** 3;
const USER_ERR = 'Failed to compress chat history for context shift due to a too long prompt or system message that cannot be compressed without affecting the generation quality. Consider increasing the context size or shortening the long prompt or system message.';

test('máy người dùng (Vulkan, VRAM 3,87 GB, Qwen3 4B Q4): mọi phương án nạp giữ ngữ cảnh ≥ 8192, chỉ bớt lớp GPU', () => {
  const p = loadPlans({ gpu: 'vulkan', vram: { total: 3.87 * GB, free: 3.5 * GB }, fileSize: 2.5 * GB, geo: { layers: 36, kvPerToken: 147456, trainCtx: 262144 }, ctx: 8192 });
  const main = p.slice(0, -1);
  assert.ok(main.every(x => x.ctx === 8192 && x.minCtx === 8192), JSON.stringify(p));
  assert.ok(main[1].gpuLayers < main[0].gpuLayers, 'phương án sau bớt lớp GPU');
  assert.deepStrictEqual(p[p.length - 1], { mode: 'cpu', gpuLayers: 0, ctx: 4096, minCtx: 4096 });
  assert.ok(p.every(x => x.minCtx >= 4096), 'không bao giờ cho node-llama-cpp tự chọn ngữ cảnh < 4096 (lỗi cũ: min 512 → 1437)');
});
test('ngữ cảnh không vượt quá ngữ cảnh huấn luyện của mô hình', () => {
  const p = loadPlans({ gpu: false, vram: null, fileSize: 1e9, geo: { layers: 24, trainCtx: 4096 }, ctx: 16384 });
  assert.ok(p.every(x => x.ctx <= 4096 && x.minCtx <= x.ctx), JSON.stringify(p));
});
test('lỗi tiếng Anh của node-llama-cpp 3.22 được nhận ra là "thiếu ngữ cảnh"', () => {
  assert.ok(TP.CTX_RE.test(USER_ERR));
});
test('leanTools giữ đủ tên/tham số bắt buộc, mô tả screen_act gọn hơn mà vẫn đủ thao tác', () => {
  const full = [{ name: 'screen_act', ...CT.DEFS.screen_act }];
  const lean = TP.leanTools(full);
  assert.ok(JSON.stringify(lean).length < JSON.stringify(full).length);
  assert.deepStrictEqual(lean[0].parameters.required, full[0].parameters.required);
  for (const a of ['click', 'type_text', 'hotkey', 'scroll', 'wait', 'focus_window']) assert.ok(lean[0].description.includes(a), a);
});

function mkAgent(ctx, { countTokens } = {}) {
  const sent = [];
  const engine = { status: () => ({ loaded: true, id: 'qwen3-4b-instruct-2507-q4_k_m', contextSize: ctx }), countTokens,
    chatStep: async (msgs) => { sent.push(msgs); return { text: 'Xong.', toolCalls: [], finishReason: 'stop', usage: {} }; } };
  const names = ['open_app', 'list_apps', 'screen_act', 'screen_look'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async () => ({ forModel: 'ok', summary: 'ok' }) };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v152-'));
  const logs = [];
  const agent = createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: (x) => logs.push(x) });
  return { agent, sent, logs };
}
test('ngữ cảnh 1437: AIVN AGENT báo CTX_SMALL kèm số token cần (để tự nạp lại), KHÔNG gửi cho bộ máy', async () => {
  const { agent, sent } = mkAgent(1437);
  await assert.rejects(agent.run({ messages: [{ role: 'user', content: 'nhắn tin chào buổi tối cho trần quỳnh anh' }], confirm: async () => true }),
    (e) => e.code === 'CTX_SMALL' && e.need > 1437 && e.need < 8192 && e.stepsDone === 0);
  assert.strictEqual(sent.length, 0);
});
test('ngữ cảnh 8192 + lịch sử rất dài: bỏ tin cũ để vừa, vẫn giữ tin cuối của người dùng', async () => {
  const { agent, sent, logs } = mkAgent(8192);
  const hist = []; for (let i = 0; i < 40; i++) hist.push({ role: 'user', content: 'câu hỏi cũ ' + i + ' ' + 'x'.repeat(900) }, { role: 'assistant', content: 'trả lời ' + 'y'.repeat(900) });
  hist.push({ role: 'user', content: 'Thủ đô Việt Nam là gì?' });
  await agent.run({ messages: hist, confirm: async () => true });
  assert.ok(sent.length >= 1);
  const m = sent[0];
  assert.strictEqual(m[0].role, 'system'); assert.strictEqual(m[1].role, 'user');
  assert.strictEqual(m[m.length - 1].content.includes('Thủ đô Việt Nam'), true);
  assert.ok(m.length < hist.length, 'đã bỏ bớt tin cũ');
  assert.ok(logs.some(l => /bỏ \d+ tin cũ/.test(l)));
});

// Tái hiện bằng mô hình thật (bỏ qua nếu máy không có tệp): ngữ cảnh 1437 → lỗi thiếu ngữ cảnh rõ ràng; nạp mặc định → ≥ 8192 và trả lời được
const GGUF = process.env.AIVN_TEST_GGUF || '/tmp/udcu/models/bartowski/Qwen_Qwen3-0.6B-GGUF/Qwen_Qwen3-0.6B-Q4_K_M.gguf';
test('mô hình thật: ngữ cảnh ~1437 làm hỏng lượt AIVN AGENT; ngữ cảnh tối thiểu mới (8192) gọi công cụ đúng', { skip: !fs.existsSync(GGUF) && 'không có tệp GGUF thử', timeout: 300000 }, async () => {
  process.env.AIVN_GPU = 'off';
  const engine = require('../src/engine');
  const tools = TP.leanTools(['open_app', 'screen_act', 'screen_look'].map(n => ({ name: n, ...CT.DEFS[n] })));
  const sys = 'Bạn là AIVN AGENT, trợ lý chạy trên máy. Trả lời ngắn gọn bằng tiếng Việt. '.repeat(60); // ~1400 token như lời nhắc thật
  const u = '/no_think mở zalo nhắn tin chào buổi tối cho trần quỳnh anh. ' + 'Danh sách phần tử: [e1] nút Gửi, [e2] ô tìm kiếm. '.repeat(100); // + kết quả screen_look
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: u }];
  try {
    await engine.loadModel('q06', GGUF, { contextSize: 1437, minContextSize: 1437 });
    assert.ok(engine.status().contextSize <= 2048, 'ngữ cảnh nhỏ ' + engine.status().contextSize);
    let err = null, r1 = null; try { r1 = await engine.chatStep(msgs, { tools, maxTokens: 200, temperature: 0 }); } catch (e) { err = e; }
    if (err) assert.ok(err.code === 'CTX_SMALL' && !/Failed to compress/.test(err.message), err.message); // lỗi đã dịch tiếng Việt
    else assert.strictEqual(r1.toolCalls.length, 0, 'ngữ cảnh nhỏ: lời nhắc bị cắt, không ra lời gọi công cụ hợp lệ'); // hỏng âm thầm (bộ máy cắt bớt lời nhắc)
    await engine.loadModel('q06', GGUF, { contextSize: 8192 }); // cùng tệp nhưng cần ngữ cảnh lớn hơn → phải nạp lại
    assert.ok(engine.status().contextSize >= 8192, 'ngữ cảnh ' + engine.status().contextSize);
    const r2 = await engine.chatStep(msgs, { tools, maxTokens: 200, temperature: 0 });
    assert.ok(r2.toolCalls.length >= 1, 'ngữ cảnh 8192 phải gọi công cụ: ' + JSON.stringify(r2).slice(0, 200));
  } finally { await engine.unloadModel().catch(() => {}); }
});
