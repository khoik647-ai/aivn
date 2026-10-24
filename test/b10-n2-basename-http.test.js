'use strict';
// N2: real ensureModel + real server. Two on-disk rows share a filename. The request must
// keep the loaded model (200), not JIT-load the first row.
const test = require('node:test'); const assert = require('node:assert'); const path = require('path');
const { world } = require('./b10-race-harness');
const { createApiServer } = require(path.join(__dirname, '..', 'src', 'server'));
const LIST = [
  { id: 'alpha-q4', file: 'shared.gguf' },
  { id: 'beta-q8', file: 'shared.gguf' },
  { id: 'loaded-one', file: 'loaded-one.gguf' },
];
async function run(model) {
  const W = world(); W.ctx.listModels = () => LIST; W.loaded = 'loaded-one';
  const engine = { status: () => W.ctx.engine.status(), countTokens: (t) => String(t).length,
    async generate(m, o = {}) { if (o.onToken) o.onToken('hi'); return { text: 'hi', finishReason: 'stop', toolCalls: [], usage: { completion_tokens: 1 } }; },
    async chatStep() { return { text: 'hi', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 1 } }; } };
  const api = createApiServer({ engine, models: () => LIST, ensureModel: (m, x = {}) => W.ctx.ensureModel(m, { api: true, ...x }), log: () => {}, getOpts: () => ({}) });
  const port = 52000 + Math.floor(Math.random() * 8000); await api.start(port, '127.0.0.1');
  try {
    const out = []; let chatModel = null;
    for (const p of ['/v1/chat/completions', '/v1/messages']) {
      const body = p === '/v1/messages' ? { model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] } : { model, messages: [{ role: 'user', content: 'hi' }] };
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
      const json = await r.json().catch(() => ({}));
      if (p === '/v1/chat/completions') chatModel = json.model;
      out.push(r.status);
    }
    return { out, chatModel, loads: W.opts.map((o) => o.id), now: W.loaded };
  } finally { await api.stop(); }
}
test('ambiguous shared filename keeps the loaded model (200), does not load the first row', async () => {
  const r = await run('shared.gguf');
  console.log('# basename', JSON.stringify(r));
  assert.deepStrictEqual(r.out, [200, 200], JSON.stringify(r));
  assert.strictEqual(r.chatModel, 'loaded-one', JSON.stringify(r));
  assert.deepStrictEqual(r.loads, []);
  assert.strictEqual(r.now, 'loaded-one');
});
