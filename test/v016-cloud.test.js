'use strict';
// 0.16: bộ não đám mây tuỳ chọn — máy chủ tương thích OpenAI giả trên máy; khoá chỉ đi trong tiêu đề, không lộ; ảnh không gửi đi
const test = require('node:test'); const assert = require('node:assert');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CB = require('../src/cloud-brain');

function fakeServer(handler) {
  return new Promise((res) => { const seen = []; const srv = http.createServer((req, rs) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { const j = b ? JSON.parse(b) : null; seen.push({ url: req.url, auth: req.headers.authorization, body: j }); const out = handler(j, req); rs.writeHead(out.status || 200, { 'content-type': 'application/json' }); rs.end(JSON.stringify(out.body)); }); }); srv.listen(0, '127.0.0.1', () => res({ srv, seen, url: `http://127.0.0.1:${srv.address().port}/v1` })); });
}

test('địa chỉ: chỉ https hoặc http tới chính máy; bỏ /chat/completions; không nhận khoá trong địa chỉ', () => {
  assert.strictEqual(CB.normalizeBase('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.strictEqual(CB.normalizeBase('https://openrouter.ai/api/v1/chat/completions'), 'https://openrouter.ai/api/v1');
  assert.strictEqual(CB.normalizeBase('http://localhost:1234/v1'), 'http://localhost:1234/v1');
  assert.throws(() => CB.normalizeBase('http://example.com/v1'), /https/);
  assert.throws(() => CB.normalizeBase('https://u:sk-abc@example.com/v1'), /Không ghi khoá/);
});
test('gọi công cụ qua máy chủ giả: đúng định dạng OpenAI, khoá trong tiêu đề Authorization, ảnh bị bỏ', async () => {
  const { srv, seen, url } = await fakeServer(() => ({ body: { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'screen_look', arguments: '{"question":"có gì?"}' } }] } }], usage: { prompt_tokens: 50, completion_tokens: 7 } } }));
  try {
    const cb = CB.createCloudBrain({ getConfig: () => ({ baseUrl: url, model: 'm1' }), getKey: () => 'sk-test-123' });
    const r = await cb.chatStep([{ role: 'system', content: 's' }, { role: 'user', content: [{ type: 'text', text: 'xem màn hình' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'get_datetime', arguments: {} } }] }, { role: 'tool', tool_call_id: 'x', content: 'Thứ Tư' }],
      { tools: [{ name: 'screen_look', description: 'nhìn', parameters: { type: 'object', properties: { question: { type: 'string' } } } }] });
    assert.deepStrictEqual(r.toolCalls, [{ id: 'c1', name: 'screen_look', arguments: { question: 'có gì?' } }]); assert.strictEqual(r.finishReason, 'tool_calls');
    const q = seen[0]; assert.strictEqual(q.url, '/v1/chat/completions'); assert.strictEqual(q.auth, 'Bearer sk-test-123'); assert.strictEqual(q.body.model, 'm1');
    assert.strictEqual(q.body.tools[0].type, 'function'); assert.ok(!JSON.stringify(q.body).includes('base64'), 'ảnh không được gửi');
    assert.strictEqual(q.body.messages[2].tool_calls[0].function.arguments, '{}'); assert.strictEqual(q.body.messages[3].tool_call_id, 'x');
  } finally { srv.close(); }
});
test('lỗi 401 báo rõ, không lộ khoá', async () => {
  const { srv, url } = await fakeServer(() => ({ status: 401, body: { error: { message: 'Incorrect API key provided: sk-test-SECRET' } } }));
  try {
    const cb = CB.createCloudBrain({ getConfig: () => ({ baseUrl: url, model: 'm' }), getKey: () => 'sk-test-SECRET' });
    await assert.rejects(cb.chatStep([{ role: 'user', content: 'hi' }]), (e) => /401/.test(e.message) && /Khoá API sai/.test(e.message) && !e.message.includes('sk-test-SECRET'));
  } finally { srv.close(); }
});
test('kho khoá: có kho an toàn → lưu bản mã hoá; không có (basic_text) → chỉ trong bộ nhớ, không ghi ra settings', () => {
  let stored = null;
  const fakeSafe = (backend) => ({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend, encryptString: (s) => Buffer.from('ENC:' + s.split('').reverse().join('')), decryptString: (b) => b.toString().slice(4).split('').reverse().join('') });
  const k1 = CB.createKeyStore({ safeStorage: fakeSafe('gnome_libsecret'), get: () => stored, set: (v) => { stored = v; } });
  assert.deepStrictEqual(k1.save('sk-abc'), { persisted: true }); assert.ok(stored && !Buffer.from(stored, 'base64').toString().includes('sk-abc')); assert.strictEqual(k1.get(), 'sk-abc');
  stored = null; const k2 = CB.createKeyStore({ safeStorage: fakeSafe('basic_text'), get: () => stored, set: (v) => { stored = v; } });
  assert.deepStrictEqual(k2.save('sk-xyz'), { persisted: false }); assert.strictEqual(stored, null); assert.strictEqual(k2.get(), 'sk-xyz');
  k2.clear(); assert.strictEqual(k2.get(), null); assert.throws(() => k2.save('a b'), /không hợp lệ/);
});
test('AIVN AGENT chạy trọn một lượt với bộ não đám mây (máy chủ giả): gọi công cụ rồi trả lời', async () => {
  let n = 0;
  const { srv, url } = await fakeServer(() => (++n === 1 ? { body: { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'a', type: 'function', function: { name: 'calculator', arguments: '{"expression":"6*7"}' } }] } }] } } : { body: { choices: [{ finish_reason: 'stop', message: { content: 'Kết quả là 42.' } }] } }));
  try {
    const cb = CB.createCloudBrain({ getConfig: () => ({ baseUrl: url, model: 'm' }), getKey: () => 'k' });
    const { createAgent } = require('../src/agent/agent');
    const engine = { status: () => ({ loaded: true, contextSize: 32768, cloud: true }), chatStep: (m, o) => cb.chatStep(m, o) };
    const ag = createAgent({ engine, getSettings: () => ({ agentMemory: false, agentFolders: [] }), memory: { count: () => 0 }, scheduler: {}, extractFile: async () => ({}), embedForMemory: async () => ({}) });
    const r = await ag.run({ messages: [{ role: 'user', content: 'tính 6*7' }] });
    assert.match(r.text || r.content || '', /42/); assert.strictEqual(r.steps[0].name, 'calculator');
  } finally { srv.close(); }
});
test('main: khoá không đi qua settings:set, không trả về giao diện; thiếu khoá thì không bật được', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'src/main.js'), 'utf8');
  assert.match(m, /const \{ hfToken, hfTokenSet, cloudBrain: _cloudIgnored, [^}]*\.\.\.rest \} = patch/);
  assert.match(m, /const \{ hfToken, cloudBrain: _cb, [^}]*\.\.\.rest \} = settings\.data; return \{ \.\.\.rest, hfTokenSet: !!hfToken, [^}]*cloudBrain: cloudPublic\(\) \}/);
  assert.ok(!/keyEnc/.test(m.match(/const cloudPublic = [^\n]+/)[0]));
});
test('lời chào khi bật bộ não đám mây không còn nói “không gửi dữ liệu đi đâu cả”', () => {
  const { welcomeFor } = require('../src/agent/agent');
  const w = welcomeFor({ cloud: { model: 'gpt-x', host: 'api.x.com' } }); assert.ok(!/không gửi dữ liệu/.test(w)); assert.match(w, /gửi tới api\.x\.com/);
  assert.match(welcomeFor(), /không gửi dữ liệu đi đâu cả/);
});
