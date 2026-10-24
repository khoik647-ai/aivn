'use strict';
// r9: tên client không có trên đĩa (gpt-4o-mini, claude-3-5-sonnet-latest) trong lúc giao diện đang nạp
// và chưa có mô hình nào nạp xong. Phải chờ lần nạp đó, rồi trả 200 bằng mô hình vừa nạp.
// Trên e5bd7dc: chat 400 và messages 404 "chưa có trên máy".
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { world, sleep } = require('./b10-race-harness');
const { createApiServer } = require(path.join(__dirname, '..', 'src', 'server'));

const A = 'qwen2.5-1.5b-instruct-q4_k_m';
const B = 'qwen2.5-3b-instruct-q4_k_m';
const LIST = [{ id: A }, { id: B }];

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
  const port = 53000 + Math.floor(Math.random() * 8000);
  await api.start(port, '127.0.0.1');
  return { api, port };
}

async function post(port, route, model, extra = {}) {
  const isMsg = route === '/v1/messages';
  const body = isMsg
    ? { model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }], ...extra }
    : { model, messages: [{ role: 'user', content: 'hi' }], ...extra };
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

function sseModel(text) {
  for (const block of String(text).split(/\n\n/)) {
    if (!block.includes('message_start')) continue;
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    return JSON.parse(data).message.model;
  }
  return null;
}

test('unknown name during in-flight UI load waits and answers 200 with the model that finishes', async () => {
  const W = world();
  W.dropOnOverlap = true;
  W.ctx.listModels = () => LIST;
  await W.ui(A);
  const ui = W.ui(B);
  await sleep(80);
  assert.strictEqual(W.loaded, null, 'previous model must already be unloaded');
  assert.ok(W.loading, 'UI load must still be in flight');
  const { api, port } = await listen(W);
  try {
    assert.ok(W.loading, 'load finished before the request; red/green would be meaningless');
    const [chat, messages] = await Promise.all([
      post(port, '/v1/chat/completions', 'gpt-4o-mini'),
      post(port, '/v1/messages', 'claude-3-5-sonnet-latest'),
    ]);
    await ui;
    const loads = W.opts.map((o) => o.id);
    console.log('# r9', JSON.stringify({
      chat: chat.status, messages: messages.status,
      chatModel: chat.json && chat.json.model,
      msgModel: messages.json && messages.json.model,
      chatErr: chat.json && chat.json.error,
      msgErr: messages.json && messages.json.error,
      loads, now: W.loaded,
    }));
    assert.deepStrictEqual([chat.status, messages.status], [200, 200], JSON.stringify({ chat: chat.json, messages: messages.json }));
    assert.strictEqual(chat.json.model, B);
    assert.strictEqual(messages.json.model, B);
    assert.ok(chat.json.choices[0].message.content);
    assert.ok(messages.json.content[0].text);
    assert.deepStrictEqual(loads, [A, B]);
    assert.strictEqual(W.loaded, B);
    assert.strictEqual(W.ctx.getApiJit(), null);
  } finally { await api.stop(); }
});

test('messages model field is the loaded id; chat already returns the loaded id', async () => {
  const W = world();
  W.ctx.listModels = () => LIST;
  await W.ui(B);
  const { api, port } = await listen(W);
  try {
    const messages = await post(port, '/v1/messages', 'claude-3-5-sonnet-latest');
    const chat = await post(port, '/v1/chat/completions', 'gpt-4o-mini');
    const stream = await post(port, '/v1/messages', 'claude-3-5-sonnet-latest', { stream: true });
    console.log('# r9-model', JSON.stringify({
      msg: messages.status, msgModel: messages.json && messages.json.model,
      chat: chat.status, chatModel: chat.json && chat.json.model,
      stream: stream.status, streamModel: sseModel(stream.text),
    }));
    assert.strictEqual(messages.status, 200);
    assert.strictEqual(chat.status, 200);
    assert.strictEqual(stream.status, 200);
    assert.strictEqual(messages.json.model, B);
    assert.strictEqual(chat.json.model, B);
    assert.strictEqual(sseModel(stream.text), B);
    assert.deepStrictEqual(W.opts.map((o) => o.id), [B]);
  } finally { await api.stop(); }
});

test('unknown name with nothing loaded and nothing loading is still an error', async () => {
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
    assert.match(messages.json.error.message, /chưa có trên máy/);
    assert.deepStrictEqual(W.opts, []);
  } finally { await api.stop(); }
});
