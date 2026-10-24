'use strict';
// r7: client sends its own model name (OpenAI/Anthropic SDK default). Real ensureModel falls back to the loaded model
// (main.js "if (st.loaded) return; // dùng mô hình đang nạp nếu tên không khớp"). Must answer 200, not 409.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const root = path.join(__dirname, '..');
const { createApiServer } = require(path.join(root, 'src/server'));
async function withServer(fn) {
  const engine = { status: () => ({ loaded: true, id: 'qwen2.5-7b-instruct-q4_k_m' }), countTokens: (t) => String(t).length,
    async generate(m, o = {}) { if (o.onToken) o.onToken('hi'); return { text: 'hi', finishReason: 'stop', toolCalls: [], usage: { completion_tokens: 1 } }; },
    async chatStep() { return { text: 'hi', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 1 } }; } };
  const api = createApiServer({ engine, models: () => [{ id: 'qwen2.5-7b-instruct-q4_k_m', mtime: Date.now() }], ensureModel: async () => {}, log: () => {}, getOpts: () => ({}) });
  const port = 31000 + Math.floor(Math.random() * 9000); await api.start(port, '127.0.0.1');
  try { await fn(`http://127.0.0.1:${port}`); } finally { await api.stop(); }
}
const P = (u, p, b, h = {}) => fetch(u + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
test('chat/completions model=gpt-4o-mini falls back to loaded model', () => withServer(async (u) => {
  const r = await P(u, '/v1/chat/completions', { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }); assert.strictEqual(r.status, 200, await r.text()); }));
test('completions model=gpt-3.5-turbo-instruct falls back', () => withServer(async (u) => {
  const r = await P(u, '/v1/completions', { model: 'gpt-3.5-turbo-instruct', prompt: 'hi' }); assert.strictEqual(r.status, 200, await r.text()); }));
test('messages model=claude-3-5-sonnet-latest falls back', () => withServer(async (u) => {
  const r = await P(u, '/v1/messages', { model: 'claude-3-5-sonnet-latest', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }, { 'anthropic-version': '2023-06-01' }); assert.strictEqual(r.status, 200, await r.text()); }));
