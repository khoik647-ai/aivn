'use strict';
// B179: công tắc chính “Cho AIVN AGENT dùng công cụ MCP” tắt thì không được spawn/listen máy chủ MCP.
// Mở ứng dụng, tắt lúc đang chạy, đường gián tiếp (plugin, nạp lại cài đặt, API cổng 1234, công tắc từng máy), rồi bật lại.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const M = require('../src/mcp');

const dirOf = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b179-'));
const echoArgs = () => [path.join(__dirname, 'fixtures', 'mcp-echo.js')];
const cfgText = (extra = {}) => JSON.stringify({
  mcpServers: {
    echo: { command: process.execPath, args: echoArgs() },
    web: { url: 'https://example.com/mcp' },
    live: { url: 'https://example.com/sse', type: 'sse' },
    ...extra,
  },
});

function trackSdk() {
  const events = [];
  let pending = null;
  class Client {
    constructor() { events.push('client'); }
    connect() {
      events.push('connect');
      return new Promise((resolve, reject) => { pending = { resolve, reject }; this._reject = reject; });
    }
    async listTools() {
      events.push('list');
      return { tools: [{ name: 'echo', description: 'e', inputSchema: { type: 'object', properties: {} } }] };
    }
    async close() { events.push('close'); if (this._reject) this._reject(new Error('closed')); }
  }
  class Stdio { constructor() { events.push('stdio'); this.stderr = null; } }
  class Http { constructor() { events.push('http'); } }
  class Sse { constructor() { events.push('sse'); } }
  return {
    sdk: { Client, Stdio, Http, Sse },
    events,
    release() { if (pending) pending.resolve(); },
  };
}

function echoPids() {
  const r = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
  return String(r.stdout || '').split('\n').filter(l => l.includes('mcp-echo.js') && l.includes('fixtures'));
}

async function until(fn, n = 50) {
  for (let i = 0; i < n; i++) { if (fn()) return; await new Promise(r => setImmediate(r)); }
  throw new Error('hết lượt chờ');
}

function manager(master, sdk) {
  const dir = dirOf();
  const m = M.createMcpManager({ dir, sdk, masterOn: () => master.on });
  return { dir, m };
}

test('B179: mở ứng dụng khi công tắc chính tắt thì startEnabled không spawn stdio/http/SSE', async () => {
  const master = { on: false };
  const t = trackSdk();
  const { m } = manager(master, t.sdk);
  await m.saveText(cfgText());
  const names = await m.startEnabled({ wait: true });
  assert.deepEqual(names, []);
  assert.deepEqual(t.events, []);
  for (const n of ['echo', 'web', 'live']) {
    const st = m.status(n);
    assert.notEqual(st.state, 'on', n);
    assert.equal(st.tools.length, 0, n);
  }
  await m.stopAll();
});

test('B179: bật rồi tắt lúc chạy thì dừng ngay, kể cả connect đang dở', async () => {
  const master = { on: true };
  const t = trackSdk();
  const { m } = manager(master, t.sdk);
  await m.saveText(JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: ['x'] } } }));
  const flight = m.start('echo');
  await until(() => t.events.includes('connect'));
  assert.ok(t.events.includes('stdio'));
  master.on = false;
  const t0 = Date.now();
  const sync = await M.syncMasterFlag(m, { prevOn: true, nextOn: false });
  assert.ok(Date.now() - t0 < 2000, 'dừng mất ' + (Date.now() - t0) + ' ms');
  assert.deepEqual(sync, { changed: true, started: [] });
  const st = await flight;
  assert.equal(st.paused, true);
  assert.equal(st.state, 'off');
  assert.equal(m.status('echo').state, 'off');
  assert.equal(m.names().length, 0);
  assert.ok(t.events.includes('close'));
  assert.equal(t.events.includes('list'), false);
  await m.stopAll();
});

test('B179: khi tắt, plugin / nạp lại cài đặt / API cổng 1234 / công tắc từng máy / Lưu / Kết nối lại không spawn', async () => {
  const master = { on: false };
  const t = trackSdk();
  const { m } = manager(master, t.sdk);
  await m.saveText(cfgText());
  const before = echoPids();

  // plugin load: gọi start cho từng máy chủ đã cấu hình
  for (const name of Object.keys(m.config().mcpServers)) {
    const st = await m.start(name);
    assert.equal(st.paused, true, name);
    assert.equal(st.state, 'off', name);
  }
  // nạp lại cài đặt khi công tắc vẫn tắt
  const reload = await M.syncMasterFlag(m, { prevOn: false, nextOn: false });
  assert.deepEqual(reload, { changed: false, started: [] });
  assert.deepEqual(await m.startEnabled({ wait: true }), []);
  // Lưu chỉ ghi tệp
  await m.saveText(cfgText());
  assert.equal(m.config().mcpServers.echo.command, process.execPath);
  // công tắc từng máy: ghi enabled, không chạy
  const one = await m.setEnabled('echo', true);
  assert.equal(one.paused, true);
  assert.equal(one.enabled, true);
  assert.equal(m.config().mcpServers.echo.disabled, undefined);
  assert.equal(m.status('echo').state, 'off');
  // kết nối lại
  const again = await m.start('echo');
  assert.equal(again.paused, true);

  const { createApiServer } = require('../src/server');
  const api = createApiServer({
    engine: { status: () => ({ loaded: false }) },
    models: () => [],
    ensureModel: async () => {},
    log: () => {},
  });
  try {
    try { await api.start(1234, '127.0.0.1'); }
    catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
      await api.start(0, '127.0.0.1');
    }
    assert.equal(api.status().running, true);
  } finally { await api.stop(); }

  assert.deepEqual(t.events, [], 'không được dựng client/stdio/http/sse');
  assert.deepEqual(echoPids(), before);
  assert.equal(m.names().length, 0);
  await m.stopAll();
});

test('B179: tắt rồi bật lại thì máy chủ được phép chạy trở lại', async () => {
  const master = { on: false };
  const t = trackSdk();
  const { m } = manager(master, t.sdk);
  await m.saveText(JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: ['x'] }, off: { command: 'node', args: ['y'], disabled: true } } }));
  await m.startEnabled({ wait: true });
  assert.deepEqual(t.events, []);
  master.on = true;
  const startedP = M.syncMasterFlag(m, { prevOn: false, nextOn: true, wait: true });
  await until(() => t.events.includes('connect'));
  t.release();
  const started = await startedP;
  assert.deepEqual(started.started, ['echo']);
  assert.equal(started.changed, true);
  assert.equal(m.status('echo').state, 'on');
  assert.equal(m.status('off').state, 'off');
  assert.ok(t.events.includes('stdio'));
  assert.ok(t.events.includes('list'));
  assert.ok(m.names().includes('mcp__echo__echo'));
  await m.stopAll();
  assert.equal(m.status('echo').state, 'off');
});

test('B179: tiến trình echo thật dừng khi tắt và chạy lại khi bật', { timeout: 60000 }, async () => {
  const master = { on: true };
  const dir = dirOf();
  const m = M.createMcpManager({ dir, masterOn: () => master.on });
  try {
    await m.saveText(JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: echoArgs() } } }));
    const before = echoPids();
    const st = await m.start('echo');
    assert.equal(st.state, 'on', st.error);
    assert.ok(echoPids().length > before.length);
    master.on = false;
    const t0 = Date.now();
    await M.syncMasterFlag(m, { prevOn: true, nextOn: false });
    assert.ok(Date.now() - t0 < 3000);
    assert.equal(m.status('echo').state, 'off');
    assert.equal(m.names().length, 0);
    assert.deepEqual(echoPids(), before);
    const refused = await m.start('echo');
    assert.equal(refused.paused, true);
    assert.deepEqual(echoPids(), before);
    master.on = true;
    await m.startEnabled({ wait: true });
    assert.equal(m.status('echo').state, 'on');
    assert.ok(echoPids().length > before.length);
    const hit = await m.exec('mcp__echo__echo', { text: 'b179' });
    assert.equal(hit.forModel, 'echo: b179');
    await m.stopAll();
    assert.deepEqual(echoPids(), before);
  } finally { await m.stopAll(); }
});

test('B179: dây trong main và renderer không mở MCP khi công tắc tắt, API cổng 1234 không đụng MCP', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const between = (src, a, b) => {
    const i = src.indexOf(a); const j = src.indexOf(b, i + a.length);
    assert.ok(i >= 0 && j > i, a);
    return src.slice(i, j);
  };
  assert.match(main, /masterOn: \(\) => settings\.data\.agentMcp !== false/);
  assert.match(main, /setTimeout\(\(\) => \{ if \(settings\.data\.agentMcp === false\) return; mcp\.startEnabled\(\)\.catch\(\(\) => \{\}\); \}, 4000\)/);
  const save = between(main, "ipcMain.handle('mcp:save'", "ipcMain.handle('mcp:toggle'");
  assert.doesNotMatch(save, /mcp\.start\(/);
  const restart = between(main, "ipcMain.handle('mcp:restart'", "ipcMain.handle('mcp:preset'");
  assert.match(restart, /mcpMasterOff\(\)/);
  const preset = between(main, "ipcMain.handle('mcp:preset'", "ipcMain.handle('mcp:master'");
  assert.match(preset, /mcpMasterOff\(\)/);
  assert.equal((main.match(/syncMasterFlag\(mcp/g) || []).length, 2);
  const api = between(main, 'async function startApi', 'function lanUrls');
  assert.doesNotMatch(api, /mcp/);
  const srv = between(main, "ipcMain.handle('server:start'", "ipcMain.handle('server:stop'");
  assert.doesNotMatch(srv, /mcp/);
  assert.ok(app.includes("r.ok && !r.paused && $('#mcpMaster').checked"));
  assert.ok(app.includes("if (!$('#mcpMaster').checked)"));
});
