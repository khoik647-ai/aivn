// 0.14.2: mẫu chat bắt buộc xen kẽ (Gemma 3…) + giao thức công cụ dạng văn bản
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const TP = require('../src/agent/textproto');
const GEMMA = fs.readFileSync(path.join(__dirname, 'fixtures', 'gemma3.jinja'), 'utf8');
const tools = [{ name: 'open_app', description: 'Mở ứng dụng theo tên', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }];
const hist = [{ role: 'system', content: 'Bạn là AIVN BOT.' }, { role: 'system', content: 'Ghi nhớ: tên người dùng là Khôi' }, { role: 'user', content: 'chào' }, { role: 'user', content: 'mở zalo' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'open_app', arguments: '{"name":"Zalo"}' } }] }, { role: 'tool', tool_call_id: 'c1', content: 'Đã mở ứng dụng "Zalo".' }];

test('nhận ra mẫu chat Gemma 3 bắt buộc xen kẽ, không có tools', () => {
  assert.deepStrictEqual(TP.analyzeTemplate(GEMMA), { strict: true, nativeTools: false, known: true });
  const qwen = "{%- if tools %}{{- '<tools>' }}{%- for tool in tools %}{{ tool | tojson }}{%- endfor %}{%- endif %}{%- if message.role == \"tool\" %}<tool_response>{%- endif %}{%- for tool_call in message.tool_calls %}{%- endfor %}";
  assert.deepStrictEqual(TP.analyzeTemplate(qwen), { strict: false, nativeTools: true, known: true });
  assert.strictEqual(TP.analyzeTemplate('').known, false);
});

test('chuẩn hoá: bắt đầu bằng user, xen kẽ, system gộp vào lượt đầu, tool thành văn bản', () => {
  const m = TP.normalizeMessages(hist, { tools });
  assert.deepStrictEqual(m.map(x => x.role), ['user', 'assistant', 'user']);
  assert.match(m[0].content, /Bạn là AIVN BOT\.[\s\S]*Ghi nhớ[\s\S]*# Công cụ[\s\S]*open_app[\s\S]*chào\n\nmở zalo$/);
  assert.match(m[1].content, /<tool_call>\{"name":"open_app","arguments":\{"name":"Zalo"\}\}<\/tool_call>/);
  assert.match(m[2].content, /<tool_result name="open_app">\nĐã mở ứng dụng "Zalo"\.\n<\/tool_result>/);
  for (let i = 0; i < m.length; i++) assert.strictEqual(m[i].role, i % 2 ? 'assistant' : 'user');
  // bắt đầu bằng assistant → chèn lượt user; ảnh giữ nguyên khi gộp
  const img = { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } };
  const m2 = TP.normalizeMessages([{ role: 'assistant', content: 'Xin chào' }, { role: 'user', content: [{ type: 'text', text: 'xem ảnh' }, img] }, { role: 'user', content: 'tiếp' }]);
  assert.deepStrictEqual(m2.map(x => x.role), ['user', 'assistant', 'user']);
  assert.ok(Array.isArray(m2[2].content) && m2[2].content.includes(img) && m2[2].content.some(p => p.text === 'tiếp'));
});

test('tách <tool_call> và các biến thể; bỏ công cụ không có trong danh sách', () => {
  let r = TP.parseToolCalls('Mình mở nhé.\n<tool_call>{"name": "open_app", "arguments": {"name": "Zalo"}}</tool_call>', ['open_app']);
  assert.strictEqual(r.toolCalls.length, 1); assert.deepStrictEqual(r.toolCalls[0].arguments, { name: 'Zalo' }); assert.strictEqual(r.text, 'Mình mở nhé.');
  r = TP.parseToolCalls('```json\n{"name":"open_app","arguments":"{\\"name\\":\\"Zalo\\"}"}\n```', ['open_app']); assert.deepStrictEqual(r.toolCalls[0].arguments, { name: 'Zalo' });
  r = TP.parseToolCalls('<tool_call>{"name":"format_disk","arguments":{}}</tool_call>', ['open_app']); assert.strictEqual(r.toolCalls.length, 0);
  r = TP.parseToolCalls('<tool_call>{"name":"open_app","arguments":{"name":"Zalo"}}', ['open_app']); assert.strictEqual(r.toolCalls.length, 1); // thiếu thẻ đóng
  assert.strictEqual(TP.parseToolCalls('Chào bạn!', ['open_app']).toolCalls.length, 0);
});

test('luồng chữ không lộ khối <tool_call>', () => {
  let shown = ''; const f = TP.streamFilter(t => { shown += t; });
  for (const p of ['Mình ', 'mở ngay.', '\n<tool', '_call>{"name":"open_app"', '}</tool_call>']) f.push(p); f.end();
  assert.strictEqual(shown, 'Mình mở ngay.\n');
  assert.ok(TP.isTemplateError('Unable to generate parser for this template. Automatic parser generation failed'));
});

// Chạy thật với llama-server (b11751) + mẫu Gemma 3 nếu có sẵn trên máy kiểm thử
const SERVER = path.join(__dirname, '..', 'build', 'llama', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
const MODEL = process.env.AIVN_TINY_GGUF || '/tmp/q05.gguf';
test('llama-server + mẫu Gemma 3: AIVN BOT gọi được công cụ ("mở zalo")', { skip: !(fs.existsSync(SERVER) && fs.existsSync(MODEL)) && 'thiếu llama-server hoặc mô hình nhỏ', timeout: 120000 }, async () => {
  process.env.AIVN_TEST_CHAT_TEMPLATE = path.join(__dirname, 'fixtures', 'gemma3.jinja');
  const logs = []; const vs = require('../src/vision-server').createVisionServer({ log: (m) => logs.push(m) });
  try {
    const info = await vs.start({ id: 'g', modelPath: MODEL, mmprojPath: null, contextSize: 2048, gpu: false });
    assert.strictEqual(info.textTools, true);
    let streamed = '';
    const r = await vs.chatStep(hist.slice(0, 4), { tools, temperature: 0, maxTokens: 60, onToken: (t) => { streamed += t; } });
    assert.ok(!/<tool_call/.test(streamed));
    assert.ok(['tool_calls', 'stop', 'length'].includes(r.finishReason));
    // lượt sau khi có kết quả công cụ: không lỗi "roles must alternate"
    const r2 = await vs.chatStep(hist, { tools, toolChoice: 'none', temperature: 0, maxTokens: 30 });
    assert.ok(typeof r2.text === 'string');
    // máy chủ có --jinja nhưng gửi thẳng tools thì lỗi; chatStep tự chuyển chế độ văn bản (giả lập: tắt cờ đã dò)
    info.textTools = false; info.template = { strict: false, nativeTools: true, known: true };
    const r3 = await vs.chatStep(hist, { tools, temperature: 0, maxTokens: 30 });
    assert.strictEqual(vs.status().textTools, true); assert.ok(typeof r3.text === 'string');
  } finally { delete process.env.AIVN_TEST_CHAT_TEMPLATE; await vs.stop(); }
});
