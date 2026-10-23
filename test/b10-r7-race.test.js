'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { world, sleep } = require('./b10-race-harness');
const within = (p, ms) => Promise.race([p, sleep(ms).then(() => 'HANG')]);
test('R1 UI load of B fails while API A waits: API not hung, A loads', async () => {
  const W = world(); W.fail = 'boom'; const ac = new AbortController();
  const ui = W.ui('b').then(() => 'ok', (e) => 'ERR ' + e.message); await sleep(5);
  const r = await within(W.api('a', ac), 3000); const ru = await ui;
  console.log('R1', r, ru, W.loaded, W.ctx.inflight(), W.ev.join('|'));
  assert.strictEqual(r, 'ok'); assert.strictEqual(W.loaded, 'a'); assert.strictEqual(W.ctx.inflight(), 0);
});
test('R2 API A aborts while waiting on UI B: returns promptly, no A load', async () => {
  const W = world(); const ac = new AbortController();
  const ui = W.ui('b'); await sleep(5); const pa = W.api('a', ac); await sleep(40); ac.abort();
  const r = await within(pa, 200); await ui; await sleep(10);
  console.log('R2', r, W.ev.join('|'));
  assert.notStrictEqual(r, 'HANG'); assert.ok(!W.ev.includes('load-start a')); assert.strictEqual(W.loaded, 'b');
});
test('R3 A loaded, UI picks B, API asks A in pre-phase: returns at once on A, UI B still finishes', async () => {
  const W = world(); await W.ui('a'); const ac = new AbortController();
  const ui = W.ui('b'); await sleep(5); let t0 = Date.now();
  const r = await W.api('a', ac); const dt = Date.now() - t0; const loadedAtReturn = W.loaded; await ui;
  console.log('R3', r, 'returned after', dt, 'ms, loaded at return', loadedAtReturn, 'final', W.loaded);
  assert.strictEqual(r, 'ok');
  assert.ok(dt < 150, 'already-loaded A must not wait out the UI load, took ' + dt + 'ms');
  assert.strictEqual(loadedAtReturn, 'a');
  assert.strictEqual(W.loaded, 'b');
  assert.deepStrictEqual(W.opts.map((o) => o.id), ['a', 'b']);
});
test('R4 UI B,C,B,C,B fast + API B joins: final B, single inflight cleanup, not JIT', async () => {
  const W = world(); const ac = new AbortController(); const ps = [];
  for (const id of ['b', 'c', 'b', 'c', 'b']) { ps.push(W.ui(id).catch(() => {})); await sleep(3); }
  const pa = W.api('b', ac); await Promise.all(ps); const r = await within(pa, 5000); await sleep(10);
  const j = W.ctx.getApiJit();
  console.log('R4', r, W.loaded, j && j.id, W.ctx.inflight(), W.ev.join('|'));
  assert.strictEqual(r, 'ok'); assert.strictEqual(W.loaded, 'b'); assert.strictEqual(j, null); assert.strictEqual(W.ctx.inflight(), 0);
});
