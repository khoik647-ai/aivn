'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const M = require('../src/mcp');

test('mcp.json: kiểm tra cấu trúc, tên công cụ, npx dùng Node đi kèm khi máy không có', () => {
  assert.throws(() => M.validate({}), /mcpServers/);
  assert.throws(() => M.validate({ mcpServers: { a: { args: [] } } }), /command/);
  assert.throws(() => M.validate({ mcpServers: { a: { url: 'ftp://x' } } }), /http/);
  assert.ok(M.validate({ mcpServers: { a: { command: 'npx', args: ['-y', 'x'] }, b: { url: 'https://h/mcp' } } }));
  assert.equal(M.toolName('Hệ thống tệp', 'read_file'), 'mcp__he-thong-tep__read_file');
  const r = M.resolveCommand('npx', ['-y', 'pkg'], { execPath: '/app/aivn', hasCmd: () => false, npmDir: '/app/npm' });
  assert.equal(r.command, '/app/aivn'); assert.equal(r.env.ELECTRON_RUN_AS_NODE, '1'); assert.deepEqual(r.args, ['/app/npm/bin/npx-cli.js', '-y', 'pkg']);
  assert.equal(M.resolveCommand('npx', [], { hasCmd: () => true }).bundled, false);
});

test('kết nối máy chủ MCP stdio thật, liệt kê và gọi công cụ, nhật ký, tắt/bật', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-mcp-'));
  const m = M.createMcpManager({ dir });
  await m.saveText(JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [path.join(__dirname, 'fixtures', 'mcp-echo.js')] } } }));
  const st = await m.start('echo');
  assert.equal(st.state, 'on', st.error); assert.deepEqual(st.tools.map(t => t.name).sort(), ['add', 'echo']);
  assert.ok(m.names().includes('mcp__echo__echo'));
  assert.match(m.defs()['mcp__echo__add'].description, /MCP · echo/);
  const r = await m.exec('mcp__echo__echo', { text: 'xin chào' });
  assert.equal(r.forModel, 'echo: xin chào');
  assert.ok(m.status('echo').logs.some(l => /sẵn sàng/.test(l)));
  await m.setEnabled('echo', false); assert.equal(m.names().length, 0); assert.equal(m.config().mcpServers.echo.disabled, true);
  await m.stopAll();
});

test('máy chủ lỗi: báo lỗi rõ, không làm treo', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-mcp-'));
  const m = M.createMcpManager({ dir });
  await m.saveText(JSON.stringify({ mcpServers: { hong: { command: process.execPath, args: ['-e', 'process.exit(3)'] } } }));
  const st = await m.start('hong');
  assert.equal(st.state, 'error'); assert.ok(st.error);
});
