'use strict';
// B179: đua bật/tắt và tiến trình còn sống sau khi công tắc chính tắt.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const M = require('../src/mcp');

const ECHO = path.join(__dirname, 'fixtures', 'mcp-echo.js');
const SLOW = path.join(__dirname, 'fixtures', 'b179', 'slow-echo.js');
const STUBBORN = path.join(__dirname, 'fixtures', 'b179', 'stubborn.js');
const WRAPPER = path.join(__dirname, 'fixtures', 'b179', 'wrapper.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ps = (tag) => String(spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).stdout)
  .split('\n')
  .filter(l => l.includes(tag) && !l.includes('node --test') && !l.includes('ps -eo'));
const turnOn = (m, extra = {}) => M.syncMasterFlag(m, { prevOn: false, nextOn: true, wait: true, start: (o) => m.startEnabled(o), ...extra });

function mk(master, servers) {
  const tag = 'adv93tag-' + Math.random().toString(36).slice(2);
  for (const v of Object.values(servers)) v.args = [...v.args, tag];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv93-'));
  const m = M.createMcpManager({ dir, masterOn: () => master.on });
  return { m, tag, save: () => m.saveText(JSON.stringify({ mcpServers: servers })) };
}

test('A1 tắt công tắc khi connect đang dở (slow 1.5s) - không còn tiến trình, không chờ 60s', { timeout: 30000 }, async () => {
  const master = { on: true };
  const { m, tag, save } = mk(master, { s: { command: process.execPath, args: [SLOW] } });
  await save();
  const fl = m.start('s');
  await sleep(300);
  assert.ok(ps(tag).length >= 1, 'đã spawn');
  master.on = false;
  const t0 = Date.now();
  await M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  const dt = Date.now() - t0;
  const st = await fl;
  const total = Date.now() - t0;
  await sleep(300);
  assert.equal(st.state, 'off');
  assert.equal(m.status('s').state, 'off');
  assert.deepEqual(ps(tag), []);
  assert.ok(total < 10000, 'flight ' + total + ' stop ' + dt);
});

test('A2 bật/tắt/bật nhanh (master) - đúng 1 tiến trình, trạng thái on', { timeout: 30000 }, async () => {
  const master = { on: true };
  const { m, tag, save } = mk(master, { e: { command: process.execPath, args: [ECHO] } });
  await save();
  const p1 = m.startEnabled({ wait: true });
  master.on = false;
  const p2 = M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  master.on = true;
  const p3 = turnOn(m);
  await Promise.all([p1, p2, p3]);
  await sleep(500);
  const st = m.status('e');
  assert.equal(st.state, 'on');
  assert.equal(ps(tag).length, 1);
  await m.stopAll();
  await sleep(300);
  assert.deepEqual(ps(tag), []);
});

test('A3 tắt/bật/tắt nhanh - không còn tiến trình nào', { timeout: 30000 }, async () => {
  const master = { on: true };
  const { m, tag, save } = mk(master, {
    e: { command: process.execPath, args: [ECHO] },
    s: { command: process.execPath, args: [SLOW] },
  });
  await save();
  await m.start('e');
  master.on = false;
  const a = M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  master.on = true;
  const b = turnOn(m, { wait: false });
  master.on = false;
  const c = M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  await Promise.all([a, b, c]);
  await sleep(4000);
  assert.deepEqual(ps(tag), []);
  assert.equal(m.names().length, 0);
  await m.stopAll();
});

test('A4 Kết nối lại 2 lần liên tiếp khi connect A còn dở (slow) - trạng thái của lần B không bị ghi off', { timeout: 30000 }, async () => {
  const master = { on: true };
  const { m, tag, save } = mk(master, { s: { command: process.execPath, args: [SLOW] } });
  await save();
  const states = [];
  const a = m.start('s');
  await sleep(200);
  const b = m.start('s');
  const iv = setInterval(() => states.push(m.status('s').state), 50);
  await Promise.all([a, b]);
  clearInterval(iv);
  await sleep(300);
  assert.equal(m.status('s').state, 'on');
  assert.equal(ps(tag).length, 1);
  const firstOffAfterStart = states.indexOf('off');
  await m.stopAll();
  await sleep(300);
  assert.deepEqual(ps(tag), []);
  assert.equal(firstOffAfterStart, -1, 'trạng thái nhảy về off khi B đang starting: ' + states.join(','));
});

test('A5 A dở, B start, rồi stop ngay - B không bị bỏ sót', { timeout: 70000 }, async () => {
  const master = { on: true };
  const { m, tag, save } = mk(master, { s: { command: process.execPath, args: [SLOW] } });
  await save();
  const a = m.start('s');
  await sleep(200);
  const b = m.start('s');
  await sleep(400);
  await m.stop('s');
  await sleep(300);
  const n2 = ps(tag).length;
  await Promise.all([a, b]);
  await sleep(300);
  assert.equal(n2, 0, 'tiến trình B còn sống sau stop()');
  assert.deepEqual(ps(tag), []);
  assert.equal(m.status('s').state, 'off');
});

test('A6 stopAll với 3 máy chủ cứng đầu (bỏ qua SIGTERM) chạy song song', { timeout: 60000 }, async () => {
  const master = { on: true };
  const sv = {};
  for (const k of ['x', 'y', 'z']) sv[k] = { command: process.execPath, args: [STUBBORN] };
  const { m, tag, save } = mk(master, sv);
  await save();
  await m.startEnabled({ wait: true });
  assert.equal(ps(tag).length, 3);
  master.on = false;
  const t0 = Date.now();
  await M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  const dt = Date.now() - t0;
  await sleep(300);
  assert.deepEqual(ps(tag), [], 'stopAll ' + dt + ' ms');
  assert.ok(dt < 9000, 'stopAll tuần tự khoảng 12s, song song phải xong sớm hơn: ' + dt);
});

test('A7 máy chủ kiểu npx (cha sinh con) - con không mồ côi khi tắt', { timeout: 30000 }, async () => {
  const master = { on: true };
  const { m, tag, save } = mk(master, { w: { command: process.execPath, args: [WRAPPER] } });
  await save();
  const st = await m.start('w');
  assert.equal(st.state, 'on', st.error);
  master.on = false;
  await M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  await sleep(1500);
  assert.deepEqual(ps(tag), []);
});

test('A8 setEnabled(on) khi master tắt rồi bật master - máy chủ đó chạy', { timeout: 30000 }, async () => {
  const master = { on: false };
  const { m, tag, save } = mk(master, { e: { command: process.execPath, args: [ECHO], disabled: true } });
  await save();
  const r = await m.setEnabled('e', true);
  assert.equal(r.paused, true);
  assert.deepEqual(ps(tag), []);
  master.on = true;
  await turnOn(m);
  assert.equal(m.status('e').state, 'on');
  await m.stopAll();
  await sleep(300);
  assert.deepEqual(ps(tag), []);
});
