'use strict';
// r11: lần nạp đang chạy bị lỗi thì không được báo "chưa có trên máy".
// Trên 65b2f4d chat 400 và messages 404 với đúng câu đó.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { world, sleep } = require('./b10-race-harness');
const { createApiServer } = require(path.join(__dirname, '..', 'src', 'server'));

const LIST = [{ id: 'qwen2.5-3b-instruct-q4_k_m' }];

function engineOf(W) {
  return {
    status: () => W.ctx.engine.status(),
    countTokens: (t) => String(t).length,
    async generate(m, o = {}) {
      if (o.onToken) o.onToken('hi');
      return { text: 'hi', finishReason: 'stop', toolCalls: [], usage: { completion_tokens: 1 } };
    },
    async chatStep() { return { text: 'hi', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 1 } }; },
  };
}

async function listen(W) {
  const api = createApiServer({
    engine: engineOf(W),
    models: () => LIST,
    ensureModel: (m, x = {}) => W.ctx.ensureModel(m, { api: true, ...x }),
    log: () => {},
    getOpts: () => ({}),
  });
  const port = 55000 + Math.floor(Math.random() * 8000);
  await api.start(port, '127.0.0.1');
  return { api, port };
}

async function post(port, route, model) {
  const isMsg = route === '/v1/messages';
  const body = isMsg
    ? { model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }
    : { model, messages: [{ role: 'user', content: 'hi' }] };
  const r = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

test('failed in-flight load is a load failure, not model-not-found', async () => {
  const W = world();
  W.ctx.listModels = () => LIST;
  W.fail = 'boom';
  const ui = W.ui('qwen2.5-3b-instruct-q4_k_m').catch((e) => e);
  const { api, port } = await listen(W);
  try {
    await sleep(80);
    assert.ok(W.loading, 'UI load must be in flight');
    const [chat, messages] = await Promise.all([
      post(port, '/v1/chat/completions', 'gpt-4o-mini'),
      post(port, '/v1/messages', 'claude-3-5-sonnet-latest'),
    ]);
    await ui;
    console.log('# r11', JSON.stringify({ chat: chat.status, messages: messages.status, chatBody: chat.json, msgBody: messages.json, loaded: W.loaded }));
    assert.strictEqual(chat.status, 503, JSON.stringify(chat.json));
    assert.strictEqual(messages.status, 503, JSON.stringify(messages.json));
    assert.match(chat.json.error.message, /không thành công/);
    assert.doesNotMatch(chat.json.error.message, /chưa có trên máy/);
    assert.notStrictEqual(chat.json.error.type, 'model_not_found');
    assert.strictEqual(messages.json.type, 'error');
    assert.match(messages.json.error.message, /không thành công/);
    assert.doesNotMatch(messages.json.error.message, /chưa có trên máy/);
    assert.notStrictEqual(messages.json.error.type, 'not_found_error');
    assert.strictEqual(W.loaded, null);
  } finally { await api.stop(); }
});

test('unknown name with nothing loading is still model-not-found', async () => {
  const W = world();
  W.ctx.listModels = () => LIST;
  const { api, port } = await listen(W);
  try {
    const [chat, messages] = await Promise.all([
      post(port, '/v1/chat/completions', 'gpt-4o-mini'),
      post(port, '/v1/messages', 'claude-3-5-sonnet-latest'),
    ]);
    assert.strictEqual(chat.status, 400);
    assert.strictEqual(messages.status, 404);
    assert.match(chat.json.error.message, /chưa có trên máy/);
    assert.strictEqual(chat.json.error.type, 'model_not_found');
    assert.match(messages.json.error.message, /chưa có trên máy/);
    assert.strictEqual(messages.json.error.type, 'not_found_error');
  } finally { await api.stop(); }
});
