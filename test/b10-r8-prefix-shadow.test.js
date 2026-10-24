'use strict';
// r8: real ensureModel (main.js via harness) + real server. Loaded id is a longer name whose prefix is another on-disk exact id.
const test = require('node:test'); const assert = require('node:assert'); const path = require('path');
const { world } = require('./b10-race-harness');
const { createApiServer } = require(path.join(__dirname, '..', 'src', 'server'));
const LIST = [{ id: 'llama-3.2-3b-instruct-q4_k_m' }, { id: 'llama-3.2-3b-instruct-q4_k_m-abliterated' }];
async function run(loaded, model) {
  const W = world(); W.ctx.listModels = () => LIST; W.loaded = loaded;
  const engine = { status: () => W.ctx.engine.status(), countTokens: (t) => String(t).length,
    async generate(m, o = {}) { if (o.onToken) o.onToken('hi'); return { text: 'hi', finishReason: 'stop', toolCalls: [], usage: { completion_tokens: 1 } }; },
    async chatStep() { return { text: 'hi', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 1 } }; } };
  const api = createApiServer({ engine, models: () => LIST, ensureModel: (m, x = {}) => W.ctx.ensureModel(m, { api: true, ...x }), log: () => {}, getOpts: () => ({}) });
  const port = 51000 + Math.floor(Math.random() * 9000); await api.start(port, '127.0.0.1');
  try {
    const out = [];
    for (const p of ['/v1/chat/completions', '/v1/messages']) {
      const body = p === '/v1/messages' ? { model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] } : { model, messages: [{ role: 'user', content: 'hi' }] };
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
      out.push(r.status);
    }
    return { out, loads: W.opts.map((o) => o.id), now: W.loaded };
  } finally { await api.stop(); }
}
test('exact on-disk id shadowed by loaded longer id: should load it (200), not permanent 409', async () => {
  const r = await run('llama-3.2-3b-instruct-q4_k_m-abliterated', 'llama-3.2-3b-instruct-q4_k_m');
  console.log('# result', JSON.stringify(r));
  assert.deepStrictEqual(r.out, [200, 200], JSON.stringify(r));
});
test('control: reverse direction loads and answers 200', async () => {
  const r = await run('llama-3.2-3b-instruct-q4_k_m', 'llama-3.2-3b-instruct-q4_k_m-abliterated');
  console.log('# control', JSON.stringify(r));
  assert.deepStrictEqual(r.out, [200, 200]);
});
