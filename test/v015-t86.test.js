// 0.15.0 — hồi quy từ video người dùng t86 (Windows 0.14.4, RTX 3050 Ti 4 GB, Qwen3-VL 8B):
// lặp câu “Bạn có muốn tôi thực hiện các bước này cho bạn không?” mãi đến khi bấm Dừng; nhãn giả “[Máy tính] [Mở Zalo]…”;
// “do giới hạn của công cụ hiện tại, tôi không thể tự động thực hiện” + hướng dẫn tay; câu nối tiếp “tôi muốn hãy làm cho tôi”.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createAgent, fakeActionCheck, stripFake, sanitizeHistory, isActAsk, REPEAT_WARN, GUIDE_NOTE } = require('../src/agent/agent');
const RG = require('../src/agent/repeat'); const SMP = require('../src/agent/sampling'); const REC = require('../src/recommend');
const { createMemoryStore } = require('../src/agent/memory');
const CT = require('../src/agent/computer-tools');

const LOOP = ['Bây giờ, tôi sẽ tìm Trần Quỳnh Anh trong danh sách bạn bè của bạn.', 'Bạn có muốn tôi thực hiện các bước này cho bạn không? Nếu không, hãy cho tôi biết.',
  'Nếu bạn muốn, tôi sẽ thực hiện toàn bộ quá trình.', 'Bạn có muốn tôi thực hiện toàn bộ quá trình này cho bạn không?', 'Nếu bạn muốn, tôi sẽ giúp bạn thực hiện toàn bộ quá trình.',
  'Bạn có muốn tôi thực hiện tất cả các bước này cho bạn không?', 'Nếu bạn muốn, tôi sẽ giúp bạn hoàn thành toàn bộ quá trình.', 'Bạn có muốn tôi thực hiện các bước this for you? If not, please let me know so I can continue.',
  'Nếu bạn muốn, tôi sẽ hỗ trợ bạn hoàn thành toàn bộ quy trình.', 'Bạn có muốn tôi thực hiện toàn bộ quy trình này cho bạn không?'];
const LOOP_TEXT = Array.from({ length: 6 }, () => LOOP).flat().join('\n\n');
const CHIPS = '[Máy tính] [Mở Zalo] [Nhắn tin] [Đọc màn hình] [Nhấp chuột]';
const MANUAL = `${CHIPS}\nDo giới hạn của công cụ hiện tại, tôi không thể tự động thực hiện các bước này. Bạn hãy làm theo các bước sau:\n1. Mở ứng dụng Zalo trên máy tính.\n2. Nhấp vào ô tìm kiếm và nhập "Trần Quỳnh Anh".\n3. Nhập nội dung tin nhắn: "Chúc buổi tối vui vẻ".\n4. **Gửi Tin Nhắn**: nhấp vào nút "Gửi".`;
const NAMES = ['open_app', 'list_apps', 'screen_act', 'screen_look'];

test('bộ phát hiện lặp bắt đúng đoạn trong video, không bắt nhầm danh sách bình thường', () => {
  const r = RG.detectLoop(LOOP_TEXT); assert.ok(r, 'phải phát hiện lặp'); assert.ok(r.cut < 400, 'cắt sớm, giữ phần trước chỗ lặp');
  const ok = ['Kế hoạch tuần:', '1. Thứ Hai: họp nhóm đồ án lúc 9 giờ ở phòng A2.', '2. Thứ Ba: nộp báo cáo môn Cơ sở dữ liệu trước 17 giờ.', '3. Thứ Tư: ôn thi Toán rời rạc chương 3 và 4.',
    '4. Thứ Năm: đi làm thêm ca chiều tại quán cà phê.', '5. Thứ Sáu: gọi điện cho mẹ và mua quà sinh nhật em gái.', '- Bước 1: mở ứng dụng Zalo trên máy tính của bạn.', '- Bước 2: tìm tên người nhận trong ô tìm kiếm.', '- Bước 3: nhập nội dung tin nhắn vào ô soạn tin.'].join('\n');
  assert.strictEqual(RG.detectLoop(ok), null);
  // stream: guard dừng sau vài câu, không phải sau hàng trăm câu
  let fired = null; const g = RG.createRepeatGuard((i) => { fired = i; });
  let n = 0; for (const ch of LOOP_TEXT.match(/.{1,6}/gs)) { if (fired) break; g.push(ch); n += ch.length; }
  assert.ok(fired && n < 900, `dừng sau ${n} ký tự`);
});

test('lấy mẫu: có phạt lặp + DRY, không “tham lam” 0.2; JSON có ràng buộc thì tắt phạt', () => {
  const a = SMP.samplingFor('qwen3vl-8b-instruct-q4_k_m', 'agent', { temperature: null });
  assert.ok(a.temperature >= 0.5 && a.temperature <= 0.7); assert.ok(a.repeatPenalty >= 1.05 && a.presencePenalty > 0 && a.dry.strength > 0);
  const srv = SMP.toServer(a); assert.ok(srv.repeat_penalty > 1 && srv.presence_penalty > 0 && srv.dry_multiplier > 0);
  const lc = SMP.toLlamaCpp(SMP.samplingFor('qwen2.5-7b-instruct-q4_k_m', 'chat')); assert.ok(lc.repeatPenalty.penalty > 1 && lc.dryRepeatPenalty.strength > 0);
  assert.strictEqual(SMP.samplingFor('x', 'json').repeatPenalty, 1);
});

test('chặn “nhãn giả”, từ chối và hướng dẫn tay khi công cụ máy tính đang bật và người dùng nhờ làm', () => {
  assert.ok(isActAsk('tôi muốn hãy làm cho tôi')); assert.ok(isActAsk('ok làm đi')); assert.ok(isActAsk('mở Zalo, tìm Trần Quỳnh Anh')); assert.ok(!isActAsk('bạn có thể làm gì'));
  assert.ok(fakeActionCheck(CHIPS + '\nMình sẽ làm ngay.', [], NAMES, 'mở zalo')); assert.strictEqual(fakeActionCheck(CHIPS + '\nMình sẽ làm ngay.', [], NAMES, 'zalo là gì'), 'pseudo');
  assert.strictEqual(fakeActionCheck('Do giới hạn của công cụ hiện tại, tôi không thể tự động thực hiện. Bạn hãy làm theo các bước sau: …', [], NAMES, 'tôi muốn hãy làm cho tôi'), 'refuse');
  assert.ok(fakeActionCheck('1. Mở ứng dụng Zalo.\n2. Nhấp vào ô tìm kiếm.\n3. Gõ tin nhắn.', [], NAMES, 'gửi tin nhắn cho Quỳnh Anh')); assert.strictEqual(fakeActionCheck('1. Mở ứng dụng Zalo.\n2. Nhấp vào ô tìm kiếm.\n3. Gõ tin nhắn.', [{ name: 'list_apps', status: 'error' }], NAMES, 'ok làm đi'), 'refuse');
  assert.strictEqual(fakeActionCheck('Bạn có muốn tôi thực hiện các bước này cho bạn không?', [], NAMES, 'làm giúp tôi đi'), 'refuse');
  assert.strictEqual(fakeActionCheck('Mình có thể mở ứng dụng, đọc tệp, nhắn tin Zalo…', [], NAMES, 'bạn có thể làm gì'), null); // câu hỏi khả năng: trả lời bình thường
  assert.ok(!/\[Máy tính\]/.test(stripFake(MANUAL)));
});

test('lịch sử cũ: câu trả lời chỉ hướng dẫn/lặp bị ẩn khi người dùng nhờ làm lại', () => {
  const h = [{ role: 'user', content: 'mở Zalo, tìm Trần Quỳnh Anh, gõ "chúc buổi tối vui vẻ", hỏi trước khi gửi' }, { role: 'assistant', content: MANUAL }, { role: 'user', content: 'bạn có thể làm gì' }, { role: 'assistant', content: LOOP_TEXT }, { role: 'user', content: 'tôi muốn hãy làm cho tôi' }];
  const s = sanitizeHistory(h, { act: true });
  assert.strictEqual(s.messages[1].content, GUIDE_NOTE); assert.strictEqual(s.messages[3].content, GUIDE_NOTE); assert.strictEqual(s.guides, 2);
  const s2 = sanitizeHistory(h, { act: false }); assert.ok(s2.messages[3].content.length < 600, 'không phải lượt làm: vẫn cắt phần lặp');
});

function mkAgent(replies) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-t86-'));
  const calls = []; const done = [];
  const engine = { status: () => ({ loaded: true, contextSize: 8192, id: 'qwen3vl-8b-instruct-q4_k_m', vision: true }), chatStep: async (msgs, o) => { calls.push({ toolChoice: o.toolChoice, sampling: o.sampling, msgs: msgs.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })) }); const r = replies.shift(); return typeof r === 'function' ? r(o) : r; } };
  const defs = Object.fromEntries(NAMES.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => NAMES, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { done.push({ n, a }); return { forModel: `Đã mở ứng dụng "${a.name}".`, summary: 'Đã mở ' + a.name }; } };
  const agent = createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false, agentTemperature: 0.2 }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, calls, done };
}
// mô hình giả: phát chữ lặp từng mẩu, tôn trọng tín hiệu dừng như engine thật
const looping = (o) => new Promise((resolve) => { let i = 0, text = ''; const parts = LOOP_TEXT.match(/.{1,8}/gs);
  const tick = () => { if (o.signal && o.signal.aborted) return resolve({ text, toolCalls: [], finishReason: 'abort', usage: { completion_tokens: Math.ceil(text.length / 4) } });
    if (i >= parts.length) return resolve({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 900 } }); text += parts[i]; o.onToken && o.onToken(parts[i++]); setImmediate(tick); }; tick(); });
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 20 } });
const call = (name, args) => ({ text: '', toolCalls: [{ id: 'c' + Math.random(), name, arguments: args }], finishReason: 'tool_calls', usage: { completion_tokens: 10 } });

test('video t86: “tôi muốn hãy làm cho tôi” → lấy việc từ câu trước, tự mở Zalo thật (không hỏi lại, không lặp)', async () => {
  const { agent, calls, done } = mkAgent([looping, call('screen_look', { window: 'Zalo' }), say('Mình đã mở Zalo; cần bước tiếp theo trong Zalo.')]);
  const history = [{ role: 'user', content: 'mở Zalo, tìm Trần Quỳnh Anh, gõ "chúc buổi tối vui vẻ", hỏi trước khi gửi' }, { role: 'assistant', content: MANUAL }, { role: 'user', content: 'tôi muốn hãy làm cho tôi' }];
  const r = await agent.run({ messages: history, confirm: async () => true });
  assert.deepStrictEqual(done[0], { n: 'open_app', a: { name: 'Zalo' } }, 'open_app Zalo thật được gọi trước tiên');
  assert.ok(!calls.some(c => c.msgs.some(m => m.content === MANUAL)), 'câu hướng dẫn cũ không còn trong ngữ cảnh');
  assert.ok(calls[0].sampling && calls[0].sampling.repeatPenalty > 1 && calls[0].sampling.temperature > 0.2, 'không còn dùng nhiệt độ 0.2 cũ');
  assert.ok(!/Bạn có muốn tôi thực hiện các bước này cho bạn không\?[\s\S]*Bạn có muốn tôi thực hiện các bước này cho bạn không\?/.test(r.text));
});

test('lặp khi đang sinh → dừng sớm + thử lại MỘT lần bằng lời gọi công cụ có ràng buộc', async () => {
  const { agent, calls, done } = mkAgent([looping, (o) => { assert.strictEqual(o.toolChoice, 'required'); return call('open_app', { name: 'Zalo' }); }, say('Đã mở Zalo.')]);
  const r = await agent.run({ messages: [{ role: 'user', content: 'gửi tin nhắn Zalo cho Trần Quỳnh Anh: chúc buổi tối vui vẻ' }], confirm: async () => true });
  // lượt đầu đã bị ép gọi công cụ (yêu cầu thao tác) — nếu mô hình vẫn lặp chữ, guard cắt và thử lại có ràng buộc
  assert.ok(done.some(d => d.n === 'open_app'), 'cuối cùng có lời gọi công cụ thật');
  assert.ok(calls.length <= 4);
});

test('lặp ở câu hỏi thường → cắt phần lặp, cảnh báo thân thiện, không chạy mãi', async () => {
  const { agent } = mkAgent([looping, looping]);
  const t0 = Date.now();
  const r = await agent.run({ messages: [{ role: 'user', content: 'bạn có thể làm gì' }], confirm: async () => true });
  assert.strictEqual(r.warning, REPEAT_WARN); assert.ok(r.text.length < 600); assert.ok(Date.now() - t0 < 5000);
});

test('GPU 4 GB + hai mô hình ~5 GB: mô hình định vị chạy CPU và có gợi ý cặp nhỏ', () => {
  const GB = 1024 ** 3;
  const p = REC.pairPlan({ vram: 4 * GB, main: 4.94 * GB, grounder: 4.68 * GB, mainVision: false });
  assert.strictEqual(p.ok, false); assert.strictEqual(p.grounderGpu, false); assert.match(p.message, /Qwen3 4B Instruct 2507/);
  assert.strictEqual(REC.pairPlan({ vram: 12 * GB, main: 2.5 * GB, grounder: 1.8 * GB }).ok, true);
});
