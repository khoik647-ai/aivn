'use strict';
// B179: công cụ không lộ và không gọi được khi công tắc chính tắt.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const M = require('../src/mcp');

const ECHO = path.join(__dirname, 'fixtures', 'mcp-echo.js');
const SLOW = path.join(__dirname, 'fixtures', 'b179', 'slow-echo.js');
const SLOW_TOOL = path.join(__dirname, 'fixtures', 'b179', 'slow-tool.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ps = (tag) => String(spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).stdout)
  .split('\n')
  .filter(l => l.includes(tag) && !l.includes('ps -eo')).length;
const turnOn = (m) => M.syncMasterFlag(m, { prevOn: false, nextOn: true, wait: true, start: (o) => m.startEnabled(o) });

function mk(master, servers) {
  const tag = 'adv4tag-' + Math.random().toString(36).slice(2);
  for (const v of Object.values(servers)) v.args = [...v.args, tag];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv93-'));
  const m = M.createMcpManager({ dir, masterOn: () => master.on });
  return { m, tag, save: () => m.saveText(JSON.stringify({ mcpServers: servers })) };
}

test('A9 bấm Kết nối lại 2 lần rồi TẮT công tắc chính: không còn công cụ, không gọi được, không còn tiến trình', { timeout: 30000 }, async () => {
  const master = { on: true };
  const { m, tag, save } = mk(master, { e: { command: process.execPath, args: [SLOW] } });
  await save();
  const a = m.start('e');
  await sleep(200);
  const b = m.start('e');
  await sleep(400);
  master.on = false;
  await M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  await Promise.all([a, b]);
  await sleep(800);
  const st = m.status('e');
  const names = m.names();
  const has = m.has('mcp__e__echo');
  let execOut = null;
  try { execOut = await m.exec('mcp__e__echo', { text: 'x' }); }
  catch (e) { execOut = 'ERR ' + e.message; }
  await m.stopAll();
  await sleep(300);
  spawnSync('pkill', ['-f', tag]);
  assert.equal(st.state, 'off');
  assert.deepEqual(names, []);
  assert.equal(has, false);
  assert.ok(/^ERR/.test(String(execOut)), String(execOut));
  assert.equal(ps(tag), 0);
});

test('A10 lệnh gọi công cụ đang chạy (3 s) khi TẮT công tắc chính: bị huỷ nhanh, không trả kết quả', { timeout: 30000 }, async () => {
  const master = { on: true };
  const { m, tag, save } = mk(master, { s: { command: process.execPath, args: [SLOW_TOOL] } });
  await save();
  const st = await m.start('s');
  assert.equal(st.state, 'on', st.error);
  const t0 = Date.now();
  const call = m.exec('mcp__s__sleep', { ms: 3000 }).then(r => ({ ok: r }), e => ({ err: e.message }));
  await sleep(300);
  master.on = false;
  await M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  const r = await call;
  const dt = Date.now() - t0;
  await sleep(300);
  assert.ok(r.err, 'lệnh gọi phải lỗi');
  assert.ok(dt < 2500, 'phải huỷ ngay, mất ' + dt);
  assert.equal(ps(tag), 0);
});

test('A11 TẮT công tắc chính rồi model gọi lại công cụ cũ: exec từ chối', { timeout: 30000 }, async () => {
  const master = { on: true };
  const { m, tag, save } = mk(master, { e: { command: process.execPath, args: [ECHO] } });
  await save();
  await m.start('e');
  master.on = false;
  await M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  let out;
  try { out = await m.exec('mcp__e__echo', { text: 'x' }); }
  catch (e) { out = 'ERR ' + e.message; }
  assert.ok(/^ERR/.test(String(out)), String(out));
  assert.equal(m.has('mcp__e__echo'), false);
  assert.equal(Object.keys(m.defs()).length, 0);
  assert.equal(ps(tag), 0);
});

test('A12 công tắc chính tắt: start/startEnabled/setEnabled(on) không spawn', { timeout: 30000 }, async () => {
  const master = { on: false };
  const { m, tag, save } = mk(master, {
    a: { command: process.execPath, args: [ECHO] },
    b: { command: process.execPath, args: [ECHO], disabled: true },
  });
  await save();
  const r1 = await m.startEnabled({ wait: true });
  const r2 = await m.start('a');
  const r3 = await m.setEnabled('b', true);
  await sleep(500);
  assert.deepEqual(r1, []);
  assert.equal(r2.paused, true);
  assert.equal(r3.paused, true);
  assert.equal(ps(tag), 0);
  master.on = true;
  const started = (await turnOn(m)).started;
  assert.deepEqual(started.sort(), ['a', 'b']);
  await m.stopAll();
  await sleep(300);
  assert.equal(ps(tag), 0);
});

test('A13 bật công tắc chính: máy đã tắt riêng (disabled) không chạy', { timeout: 30000 }, async () => {
  const master = { on: false };
  const { m, tag, save } = mk(master, {
    a: { command: process.execPath, args: [ECHO] },
    d: { command: process.execPath, args: [ECHO], disabled: true },
  });
  await save();
  master.on = true;
  const { started } = await turnOn(m);
  assert.deepEqual(started, ['a']);
  assert.equal(m.status('d').state, 'off');
  assert.equal(ps(tag), 1);
  await m.stopAll();
  await sleep(300);
  assert.equal(ps(tag), 0);
});
