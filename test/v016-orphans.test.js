'use strict';
// B13 (QA lượt 2): llama-server không được sót lại khi tiến trình chính của AIVN mất đột ngột.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const O = require('../src/orphans');
const FAKE = path.join(__dirname, 'fixtures', 'fake-llama');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function startParent(pidf) {
  const p = spawn(process.execPath, [path.join(FAKE, 'parent.js'), pidf], { env: { ...process.env, AIVN_LLAMA_SERVER: path.join(FAKE, 'llama-server') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => out += d);
  for (let i = 0; i < 100 && !/READY|ERR/.test(out); i++) await sleep(100);
  const m = out.match(/READY (.*)/); assert.ok(m, 'engine-host không mở được llama-server giả: ' + out);
  return { p, llama: JSON.parse(m[1])[0].pid };
}
const hostOf = (parentPid) => { try { return fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).map(Number).find(pid => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1] === String(parentPid); } catch { return false; } }); } catch { return null; } };

test('B13: tiến trình chính bị kill -9 → engine-host tự giết llama-server và thoát trong vài giây', { skip: process.platform === 'win32' }, async () => {
  const pidf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b13-')), 'pids.json');
  const { p, llama } = await startParent(pidf);
  assert.ok(alive(llama)); assert.deepStrictEqual(O.createPidFile(pidf).list().map(x => x.pid), [llama], 'pid được ghi vào tệp');
  const host = hostOf(p.pid);
  process.kill(p.pid, 'SIGKILL');
  for (let i = 0; i < 50 && alive(llama); i++) await sleep(100);
  assert.ok(!alive(llama), 'llama-server phải dừng khi tiến trình chính mất');
  for (let i = 0; i < 50 && host && alive(host); i++) await sleep(100);
  if (host) assert.ok(!alive(host), 'engine-host phải thoát');
});
test('B13: cả tiến trình chính và engine-host bị kill -9 → lần mở sau dọn llama-server còn sót (đúng pid, đúng là llama-server)', { skip: process.platform === 'win32' }, async () => {
  const pidf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b13-')), 'pids.json');
  const { p, llama } = await startParent(pidf);
  const host = hostOf(p.pid); assert.ok(host, 'tìm thấy engine-host');
  process.kill(host, 'SIGKILL'); process.kill(p.pid, 'SIGKILL'); await sleep(400);
  assert.ok(alive(llama), 'tái hiện: llama-server mồ côi');
  const killed = O.createPidFile(pidf).cleanup();
  assert.deepStrictEqual(killed, [llama]);
  for (let i = 0; i < 30 && alive(llama); i++) await sleep(100);
  assert.ok(!alive(llama)); assert.deepStrictEqual(O.createPidFile(pidf).list(), []);
});
test('B13: dọn dẹp không giết tiến trình khác đã dùng lại pid', () => {
  const pidf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b13-')), 'pids.json');
  const pf = O.createPidFile(pidf); pf.add(4242); pf.add(4343); pf.add(4444);
  const killed = []; const cmds = { 4242: '/opt/aivn/llama-server -m x.gguf', 4343: '/usr/bin/firefox', 4444: '' };
  const r = pf.cleanup({ isAlive: (pid) => pid !== 4444, cmd: (pid) => cmds[pid], kill: (pid) => killed.push(pid) });
  assert.deepStrictEqual(r, [4242]); assert.deepStrictEqual(killed, [4242]);
  assert.ok(O.isLlama('"llama-server.exe","1234","Console"')); assert.ok(!O.isLlama('node server.js'));
});
test('B13: watchParent báo khi tiến trình cha mất hoặc ppid đổi', async () => {
  let gone = 0; let up = true;
  const w = O.watchParent(1234, () => gone++, { ms: 20, isAlive: () => up, ppid: () => 1234 });
  await sleep(60); assert.strictEqual(gone, 0); up = false; await sleep(60); assert.strictEqual(gone, 1); w.stop();
  let g2 = 0; O.watchParent(1234, () => g2++, { ms: 20, isAlive: () => true, ppid: () => 1 }); await sleep(60); assert.strictEqual(g2, 1);
});
