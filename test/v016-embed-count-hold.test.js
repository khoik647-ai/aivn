'use strict';
// #69 ghi chú 4: count() phải chờ hết hold như embed(), không chạy khi đang nạp mô hình trò chuyện.
const test = require('node:test'); const assert = require('node:assert');
const { createEmbedServer } = require('../src/embed-server');

test('count() chờ release() khi đang hold', async () => {
  const srv = createEmbedServer({ findExe: () => null, idleMs: 0, log: () => {}, holdMs: 5000 });
  srv.hold();
  let done = false;
  const p = srv.count(['abcdef']).then((n) => { done = true; return n; });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(done, false, 'count() không được chạy khi đang hold');
  srv.release();
  assert.equal(await p, 2);
});