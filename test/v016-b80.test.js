'use strict';
// B80: /v1/completions (như LM Studio), /v1/embeddings nhận tên mô hình nhúng kiểu OpenAI, nhật ký ghi mã lỗi (404…).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { createApiServer } = require('../src/server');

async function withServer(fn, extra = {}) {
  const logs = []; const calls = [];
  const engine = { status: () => ({ loaded: true, id: 'm1' }), countTokens: (t) => String(t).length,
    async generate(messages, o = {}) { calls.push({ messages, o }); const text = 'Xin chào. Hết.### đuôi'; if (o.onToken) for (const ch of text.match(/.{1,3}/gs)) { if (o.signal && o.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } o.onToken(ch); } return { text, finishReason: 'stop', usage: { completion_tokens: 5 } }; } };
  const api = createApiServer({ engine, models: () => [{ id: 'm1', mtime: Date.now() }], ensureModel: async () => {}, log: (m) => logs.push(m), getOpts: () => ({}), ...extra });
  const port = 20000 + Math.floor(Math.random() * 20000);
  await api.start(port, '127.0.0.1');
  try { return await fn(`http://127.0.0.1:${port}`, logs, calls); } finally { await api.stop(); }
}
const post = (u, p, b) => fetch(u + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

test('B80: /v1/completions trả text_completion (prompt chuỗi/mảng, echo, stop, usage)', async () => {
  await withServer(async (u, logs, calls) => {
    const r = await post(u, '/v1/completions', { model: 'm1', prompt: 'Chào', max_tokens: 20, stop: '###' });
    assert.strictEqual(r.status, 200); const j = await r.json();
    assert.strictEqual(j.object, 'text_completion'); assert.match(j.id, /^cmpl-/);
    assert.strictEqual(j.choices[0].text, 'Xin chào. Hết.'); assert.strictEqual(j.choices[0].finish_reason, 'stop');
    assert.ok(j.usage.total_tokens > 0); assert.deepStrictEqual(calls[0].messages, [{ role: 'user', content: 'Chào' }]); assert.strictEqual(calls[0].o.maxTokens, 20);
    const r2 = await (await post(u, '/completions', { prompt: ['a', 'b'], echo: true })).json();
    assert.strictEqual(r2.choices.length, 2); assert.ok(r2.choices[1].text.startsWith('b')); assert.strictEqual(r2.choices[1].index, 1);
    assert.strictEqual((await post(u, '/v1/completions', { prompt: [1, 2] })).status, 400);
    assert.ok(logs.some(l => /→ 200 text_completion/.test(l)));
  });
});

test('B80: /v1/completions stream: SSE text_completion, cắt ở stop, kết thúc [DONE]', async () => {
  await withServer(async (u) => {
    const t = await (await post(u, '/v1/completions', { prompt: 'Chào', stream: true, stop: ['###'] })).text();
    const ev = t.split('\n\n').filter(Boolean); assert.strictEqual(ev[ev.length - 1], 'data: [DONE]');
    const js = ev.slice(0, -1).map(e => JSON.parse(e.slice(6)));
    assert.ok(js.every(x => x.object === 'text_completion'));
    assert.strictEqual(js.map(x => x.choices[0].text).join(''), 'Xin chào. Hết.');
    assert.strictEqual(js[js.length - 1].choices[0].finish_reason, 'stop');
  });
});

test('B80: đường dẫn lạ → 404 và nhật ký ghi mã 404', async () => {
  await withServer(async (u, logs) => {
    const r = await post(u, '/v1/audio/speech', {}); assert.strictEqual(r.status, 404);
    assert.ok(logs.some(l => /→ 404 Không tìm thấy POST \/v1\/audio\/speech/.test(l)), logs.join('\n'));
  });
});

test('B80: /v1/embeddings với tên kiểu OpenAI → dùng mô hình nhúng đã cài, ghi nhật ký', async () => {
  const embeddings = { info: () => ({ installed: true, id: 'bge-m3-q8_0' }), ensure: async () => ({ id: 'bge-m3-q8_0' }), embed: async (xs) => xs.map(() => Float32Array.from([0.6, 0.8])), count: async () => 3 };
  await withServer(async (u, logs) => {
    const r = await post(u, '/v1/embeddings', { model: 'text-embedding-3-small', input: 'xin chào' });
    assert.strictEqual(r.status, 200); const j = await r.json(); assert.strictEqual(j.model, 'bge-m3-q8_0'); assert.strictEqual(j.data[0].embedding.length, 2);
    assert.ok(logs.some(l => /text-embedding-3-small” → dùng bge-m3-q8_0/.test(l)));
  }, { embeddings });
  const m = fs.readFileSync(path.join(__dirname, '..', 'src/main.js'), 'utf8');
  assert.doesNotMatch(m, /không có\. AIVN dùng "\$\{EMBED\.id\}"\.`\); e\.status = 404/); assert.match(m, /là mô hình trò chuyện, không tạo embeddings được/);
});
