'use strict';
// r10: chờ một lần nạp đang chạy phải có hạn và phải dừng khi client ngắt.
// Trên 65b2f4d vòng chờ không có hạn, và chat/completions không đưa AbortSignal vào ensureModel.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { world, sleep } = require('./b10-race-harness');
const { createApiServer } = require(path.join(__dirname, '..', 'src', 'server'));

const LIST = [{ id: 'qwen2.5-3b-instruct-q4_k_m' }];

function engineOf(W, calls) {
  return {
    status: () => W.ctx.engine.status(),
    countTokens: (t) => String(t).length,
    async generate(m, o = {}) {
      calls.push('generate');
      if (o.onToken) o.onToken('hi');
      return { text: 'hi', finishReason: 'stop', toolCalls: [], usage: { completion_tokens: 1 } };
    },
    async chatStep() {
      calls.push('chatStep');
      return { text: 'hi', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 1 } };
    },
  };
}

function hangLoad(W) {
  let release;
  const gate = new Promise((r) => { release = r; });
  W.release = () => release();
  W.ctx.loadById = async (id, opts = {}) => {
    W.opts.push({ id, api: !!opts.api });
    W.loading = id;
    W.ev.push('load-start ' + id);
    await gate;
    W.loading = null;
    W.loaded = id;
    W.ev.push('loaded ' + id);
    return W.ctx.engine.status();
  };
}

async function listen(W, calls, seen) {
  const api = createApiServer({
    engine: engineOf(W, calls),
    models: () => LIST,
    ensureModel: (m, x = {}) => {
      const row = { model: m, signal: !!(x && x.signal), done: false };
      seen.push(row);
      return W.ctx.ensureModel(m, { api: true, ...(x || {}) }).finally(() => { row.done = true; });
    },
    log: () => {},
    getOpts: () => ({}),
  });
  const port = 54000 + Math.floor(Math.random() * 8000);
  await api.start(port, '127.0.0.1');
  return { api, port };
}

async function post(port, route, model, extra = {}) {
  const isMsg = route === '/v1/messages';
  const isCmp = route === '/v1/completions';
  const body = isMsg
    ? { model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }
    : isCmp
      ? { model, prompt: 'hi' }
      : { model, messages: [{ role: 'user', content: 'hi' }] };
  try {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: extra.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  } catch (e) {
    return { status: 0, err: e.name, json: null, text: '' };
  }
}

test('in-flight wait times out with 504 instead of hanging chat and messages', async () => {
  const W = world();
  W.ctx.listModels = () => LIST;
  W.settings.data.apiLoadWaitMs = 80;
  hangLoad(W);
  const calls = [];
  const seen = [];
  const ui = W.ui('qwen2.5-3b-instruct-q4_k_m');
  const { api, port } = await listen(W, calls, seen);
  const killer = new AbortController();
  const timer = setTimeout(() => killer.abort(), 1000);
  try {
    await sleep(20);
    assert.ok(W.loading, 'load must still be in flight');
    const t0 = Date.now();
    const [chat, messages] = await Promise.all([
      post(port, '/v1/chat/completions', 'gpt-4o-mini', { signal: killer.signal }),
      post(port, '/v1/messages', 'claude-3-5-sonnet-latest', { signal: killer.signal }),
    ]);
    const dt = Date.now() - t0;
    console.log('# r10-timeout', JSON.stringify({ dt, chat: chat.status, messages: messages.status, chatBody: chat.json, msgBody: messages.json, err: chat.err || messages.err }));
    assert.ok(dt < 700, 'waited ' + dt + 'ms; a hung load must not hold the request');
    assert.strictEqual(chat.status, 504, JSON.stringify(chat));
    assert.strictEqual(messages.status, 504, JSON.stringify(messages));
    assert.strictEqual(chat.json.error.type, 'timeout');
    assert.strictEqual(chat.json.error.code, 504);
    assert.match(chat.json.error.message, /Hết thời gian chờ/);
    assert.strictEqual(messages.json.type, 'error');
    assert.strictEqual(messages.json.error.type, 'timeout');
    assert.match(messages.json.error.message, /Hết thời gian chờ/);
    assert.doesNotMatch(chat.json.error.message, /chưa có trên máy/);
    assert.doesNotMatch(messages.json.error.message, /chưa có trên máy/);
    assert.deepStrictEqual(calls, []);
    assert.ok(W.loading, 'timeout must not cancel the UI load');
  } finally {
    clearTimeout(timer);
    W.release();
    await ui.catch(() => {});
    await api.stop();
  }
});

test('client disconnect aborts the chat and completions wait', async () => {
  const W = world();
  W.ctx.listModels = () => LIST;
  W.settings.data.apiLoadWaitMs = 60000;
  hangLoad(W);
  const calls = [];
  const seen = [];
  const ui = W.ui('qwen2.5-3b-instruct-q4_k_m');
  const { api, port } = await listen(W, calls, seen);
  const acChat = new AbortController();
  const acCmp = new AbortController();
  try {
    await sleep(20);
    const chatP = post(port, '/v1/chat/completions', 'gpt-4o-mini', { signal: acChat.signal });
    const cmpP = post(port, '/v1/completions', 'gpt-3.5-turbo', { signal: acCmp.signal });
    const tEnter = Date.now();
    while (seen.length < 2 && Date.now() - tEnter < 1000) await sleep(10);
    assert.strictEqual(seen.length, 2, 'both handlers must be inside ensureModel');
    assert.ok(seen.every((s) => s.signal), 'chat and completions must pass an AbortSignal');
    acChat.abort();
    acCmp.abort();
    await sleep(200);
    const settled = seen.filter((s) => s.done);
    console.log('# r10-abort', JSON.stringify({ seen, calls }));
    assert.strictEqual(settled.length, 2, 'disconnect must stop the wait, not leave it on the hung load');
    assert.deepStrictEqual(calls, []);
    assert.ok(W.loading);
    await Promise.all([chatP, cmpP]);
  } finally {
    W.release();
    await ui.catch(() => {});
    await api.stop();
  }
});
