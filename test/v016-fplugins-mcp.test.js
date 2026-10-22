'use strict';
// F-PLUGINS PR 1: mcp.json chặt hơn, đầu mục, timeout, tham chiếu bí mật, và chặn đường dẫn Excel.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const M = require('../src/mcp');

const dirOf = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-mcp-'));
function write(dir, obj) { fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify(obj, null, 2)); }

test('http nội bộ được phép và được đánh dấu; http công cộng và tên máy bị từ chối', () => {
  const ok = (u) => M.validate({ mcpServers: { a: { url: u } } });
  ok('http://127.0.0.1/mcp'); ok('http://127.255.255.255/mcp'); ok('http://localhost/mcp'); ok('http://[::1]/mcp');
  ok('https://huggingface.co/mcp');
  for (const u of ['http://10.1.2.3/mcp', 'http://172.16.0.1/mcp', 'http://172.31.255.255/mcp', 'http://192.168.1.2/mcp']) {
    ok(u); assert.equal(M.classifyUrl(u).lan, true, u);
  }
  assert.equal(M.classifyUrl('http://127.0.0.1/mcp').lan, false);
  assert.equal(M.classifyUrl('https://example.com/mcp').lan, false);
  for (const u of ['http://172.15.0.1/mcp', 'http://172.32.0.1/mcp', 'http://8.8.8.8/mcp', 'http://nas.local/mcp']) {
    assert.throws(() => ok(u), /mạng nội bộ/, u);
  }
});

test('validate: command và url, tên, args, type, timeout, safeName', () => {
  assert.throws(() => M.validate({ mcpServers: { a: { command: 'npx', url: 'https://x/mcp' } } }), /chỉ được có command hoặc url/);
  assert.throws(() => M.validate({ mcpServers: { ['a'.repeat(65)]: { command: 'npx' } } }), /1 đến 64/);
  assert.throws(() => M.validate({ mcpServers: { a: { command: 'npx', args: ['ok', 1] } } }), /chỉ được chứa chuỗi/);
  assert.throws(() => M.validate({ mcpServers: { a: { url: 'https://x/mcp', type: 'http' } } }), /sse/);
  assert.throws(() => M.validate({ mcpServers: { a: { url: 'https://x/mcp', timeout: 999 } } }), /timeout/);
  assert.throws(() => M.validate({ mcpServers: { a: { url: 'https://x/mcp', timeout: 600001 } } }), /timeout/);
  M.validate({ mcpServers: { a: { url: 'https://x/mcp', timeout: 1000, headers: { Authorization: { $aivnSecret: 'mcp:a:Authorization' } } } } });
  M.validate({ mcpServers: { a: { url: 'https://x/mcp', timeout: 600000 } } });
  assert.throws(() => M.validate({ mcpServers: { 'Hệ thống': { command: 'npx' }, 'he thong': { command: 'node' } } }), /chuẩn hoá/);
  assert.throws(() => M.validate({ servers: { a: { command: 'npx' } } }), /servers/);
  assert.throws(() => M.validate(JSON.parse('{"mcpServers":')), /JSON/);
});

test('đọc tệp: một máy chủ hỏng không xoá máy chủ kia và không xoá đĩa', async () => {
  const dir = dirOf();
  const body = { mcpServers: { tot: { command: 'node', args: ['echo.js'] }, xau: { url: 'http://8.8.8.8/mcp' } }, ghiChu: 'giữ' };
  write(dir, body);
  const m = M.createMcpManager({ dir });
  const cfg = m.config();
  assert.ok(cfg.mcpServers.tot); assert.ok(cfg.mcpServers.xau); assert.equal(cfg.ghiChu, 'giữ');
  assert.equal(m.status('xau').state, 'error'); assert.match(m.status('xau').error, /mạng nội bộ/);
  assert.equal(m.status('tot').state, 'off');
  await assert.rejects(() => m.saveText(JSON.stringify({ mcpServers: { tot: { url: 'http://1.2.3.4/mcp' } } })), /mạng nội bộ/);
  assert.match(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'), /8\.8\.8\.8/);
  fs.writeFileSync(path.join(dir, 'mcp.json'), '{');
  assert.match(m.fileError(), /không phải JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'), '{');
});

function fakeSdk() {
  const seen = { clients: 0, http: null, sse: null, stdio: null, calls: [] };
  class Client {
    constructor() { seen.clients++; }
    async connect() {}
    async listTools() { return { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: {} } }] }; }
    async callTool(_a, _b, opts) { seen.calls.push(opts); return { content: [{ type: 'text', text: 'xong' }] }; }
    async close() {}
  }
  class Http { constructor(url, opts) { seen.http = { url: String(url), opts }; } }
  class Sse { constructor(url, opts) { seen.sse = { url: String(url), opts }; } }
  class Stdio { constructor(opts) { seen.stdio = opts; this.stderr = null; } }
  return { sdk: { Client, Http, Sse, Stdio }, seen };
}

test('auth được giữ, start không mở vận chuyển', async () => {
  const dir = dirOf(); const { sdk, seen } = fakeSdk();
  write(dir, { mcpServers: { remote: { url: 'https://example.com/mcp', auth: { CLIENT_ID: 'abc' } } } });
  const m = M.createMcpManager({ dir, sdk });
  assert.deepEqual(m.config().mcpServers.remote.auth, { CLIENT_ID: 'abc' });
  const st = await m.start('remote');
  assert.equal(st.state, 'error'); assert.match(st.error, /OAuth/);
  assert.equal(seen.clients, 0); assert.equal(seen.http, null);
});

test('headers và bí mật đưa vào vận chuyển, không lọt nhật ký', async () => {
  const dir = dirOf(); const { sdk, seen } = fakeSdk();
  const secret = 'Bearer super-secret-value';
  write(dir, { mcpServers: {
    remote: { url: 'https://example.com/mcp', headers: { Authorization: { $aivnSecret: 'mcp:remote:Authorization' } }, timeout: 5000 },
    stream: { url: 'https://example.com/sse', type: 'sse', headers: { Authorization: 'Bearer plain' } }
  } });
  const m = M.createMcpManager({ dir, sdk, resolveSecret: (id) => id === 'mcp:remote:Authorization' ? secret : '' });
  const st = await m.start('remote');
  assert.equal(st.state, 'on', st.error);
  assert.equal(seen.http.opts.requestInit.headers.Authorization, secret);
  assert.equal(m.config().mcpServers.remote.headers.Authorization.$aivnSecret, 'mcp:remote:Authorization');
  const blob = JSON.stringify(m.status('remote'));
  assert.equal(blob.includes(secret), false);
  await m.start('stream');
  assert.equal(seen.sse.opts.requestInit.headers.Authorization, 'Bearer plain');
  const hit = await m.exec('mcp__remote__echo', { q: 'a' });
  assert.equal(hit.forModel, 'xong');
  assert.equal(seen.calls.at(-1).timeout, 5000);
});

test('bí mật không giải được thì không chạy', async () => {
  const dir = dirOf(); const { sdk, seen } = fakeSdk();
  write(dir, { mcpServers: { local: { command: 'node', args: ['x'], env: { TOKEN: { $aivnSecret: 'mcp:local:TOKEN' } } } } });
  const m = M.createMcpManager({ dir, sdk, resolveSecret: () => '' });
  const st = await m.start('local');
  assert.equal(st.state, 'error'); assert.match(st.error, /khoá bí mật/);
  assert.equal(seen.stdio, null);
  assert.equal(JSON.stringify(m.status('local')).includes('super-secret-value'), false);
});

test('hai công cụ trùng tên sau khi cắt thì máy chủ lỗi, không đưa công cụ ra', async () => {
  const dir = dirOf();
  const a = 'a'.repeat(80), b = 'a'.repeat(80) + 'b';
  assert.equal(M.toolName('s', a), M.toolName('s', b));
  const sdk = fakeSdk().sdk;
  sdk.Client = class {
    async connect() {}
    async listTools() { return { tools: [{ name: a, description: '', inputSchema: { type: 'object' } }, { name: b, description: '', inputSchema: { type: 'object' } }] }; }
    async close() {}
  };
  write(dir, { mcpServers: { s: { command: 'node', args: ['x'] } } });
  const m = M.createMcpManager({ dir, sdk });
  const st = await m.start('s');
  assert.equal(st.state, 'error'); assert.match(st.error, /rút gọn/);
  assert.equal(m.names().length, 0);
});

test('Excel: realpath chặn liên kết ra ngoài thư mục được phép, trước khi gọi', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-xl-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-xl-out-'));
  fs.writeFileSync(path.join(root, 'ok.xlsx'), 'trong');
  fs.writeFileSync(path.join(outside, 'secret.xlsx'), 'ngoai');
  fs.symlinkSync(path.join(outside, 'secret.xlsx'), path.join(root, 'link.xlsx'));
  fs.symlinkSync(outside, path.join(root, 'via'));
  const ok = path.join(root, 'ok.xlsx');
  const link = path.join(root, 'link.xlsx');
  const escaped = path.resolve(root, '..', path.basename(outside), 'secret.xlsx');
  const viaNew = path.join(root, 'via', 'moi.xlsx');
  assert.equal(M.excelCallError({ fileAbsolutePath: ok }, [root]), null);
  assert.equal(M.excelCallError({ fileAbsolutePath: path.join(root, 'moi.xlsx') }, [root]), null);
  assert.match(M.excelCallError({ fileAbsolutePath: link }, [root]), /ngoài thư mục được phép/);
  assert.match(M.excelCallError({ fileAbsolutePath: escaped }, [root]), /ngoài thư mục được phép/);
  assert.match(M.excelCallError({ fileAbsolutePath: viaNew }, [root]), /ngoài thư mục được phép/);
  assert.match(M.excelCallError({ fileAbsolutePath: link }, [root]), new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(M.excelCallError({ fileAbsolutePath: link }, [root]).includes(path.join(outside, 'secret.xlsx')), false);
  assert.match(M.excelCallError({}, [root]), /Hãy chỉ tệp Excel/);
  assert.match(M.excelCallError({ fileAbsolutePath: ok }, []), /Chưa có thư mục nào được phép cho Excel/);
  const agentOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-xl-agent-'));
  fs.writeFileSync(path.join(agentOnly, 'agent.xlsx'), 'agent');
  assert.match(M.excelCallError({ fileAbsolutePath: path.join(agentOnly, 'agent.xlsx') }, [root]), /ngoài thư mục được phép/);
  assert.equal(M.excelCallError({ fileAbsolutePath: ok }, [root]), null);

  const dir = dirOf(); const seen = { calls: 0 };
  const sdk = {
    Client: class {
      async connect() {}
      async listTools() { return { tools: [{ name: 'excel_read_sheet', description: 'đọc', inputSchema: { type: 'object', properties: {} } }] }; }
      async callTool() { seen.calls++; return { content: [{ type: 'text', text: 'không được gọi' }] }; }
      async close() {}
    },
    Stdio: class { constructor() { this.stderr = null; } },
    Http: class {}, Sse: class {}
  };
  write(dir, { mcpServers: { excel: { command: 'node', args: ['@negokaz/excel-mcp-server@0.12.0'] } } });
  const excelFolders = [root];
  const m = M.createMcpManager({ dir, sdk, getExcelFolders: () => excelFolders });
  const st = await m.start('excel');
  assert.equal(st.state, 'on', st.error);
  const denied = await m.exec('mcp__excel__excel_read_sheet', { fileAbsolutePath: link, sheetName: 'Sheet1' });
  assert.match(denied.error, /ngoài thư mục được phép/);
  assert.equal(seen.calls, 0);
  assert.equal(JSON.stringify(m.status('excel')).includes(path.join(outside, 'secret.xlsx')), false);
  const allowed = await m.exec('mcp__excel__excel_read_sheet', { fileAbsolutePath: ok });
  assert.equal(allowed.forModel, 'không được gọi');
  assert.equal(seen.calls, 1);
});

test('máy chủ không phải Excel không bị chặn đường dẫn', async () => {
  const dir = dirOf(); const seen = { calls: 0 };
  const sdk = {
    Client: class {
      async connect() {}
      async listTools() { return { tools: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }] }; }
      async callTool() { seen.calls++; return { content: [{ type: 'text', text: 'qua' }] }; }
      async close() {}
    },
    Stdio: class { constructor() { this.stderr = null; } }, Http: class {}, Sse: class {}
  };
  write(dir, { mcpServers: { echo: { command: 'node', args: ['echo.js'] } } });
  const m = M.createMcpManager({ dir, sdk, getExcelFolders: () => [] });
  await m.start('echo');
  const r = await m.exec('mcp__echo__echo', { fileAbsolutePath: '/etc/passwd' });
  assert.equal(r.forModel, 'qua'); assert.equal(seen.calls, 1);
});

test('nhập chỉ nhận id Nâng cao khi gói hoặc URL khớp, không khi trùng tên khoá', () => {
  const fetchPkg = { command: 'npx', args: ['-y', 'mcp-fetch-server@1.1.2'] };
  assert.equal(M.claimCatalogId({ ...fetchPkg }), 'fetch');
  assert.equal(M.claimCatalogId({ name: 'fetch', command: 'node', args: ['echo.js'] }), null);
  assert.equal(M.claimCatalogId({ command: 'npx', args: ['-y', 'mcp-fetch-server@9.9.9'] }, { taken: ['fetch'] }), null);
  assert.equal(M.claimCatalogId({ url: 'https://HuggingFace.CO/mcp/' }), 'huggingface');
  assert.equal(M.claimCatalogId({ url: 'https://huggingface.co/mcp' }), 'huggingface');
  assert.equal(M.claimCatalogId({ url: 'https://example.com/mcp' }), null);
  assert.equal(M.claimCatalogId({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2.0.0'] }), 'filesystem');
  assert.equal(M.claimCatalogId({ command: 'npx', args: ['-y', '@negokaz/excel-mcp-server@0.12.0'] }), null);
  assert.equal(M.claimCatalogId({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search@0.6.2'] }), null);
  assert.equal(M.claimCatalogId({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github@2025.4.8'] }), null);
  assert.equal(M.claimCatalogId({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-time'] }), null);
  assert.deepEqual(M.ADVANCED_CATALOG.map(x => x.id), ['filesystem', 'fetch', 'huggingface', 'memory', 'thinking']);
});

test('câu lỗi mới có bản en và zh', () => {
  const I = require('../src/i18n/core').create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
  const rows = [
    ['mcp.json không phải JSON hợp lệ.', /not valid JSON/, /不是有效的 JSON/],
    ['Không giải được khoá bí mật “HF”.', /secret “HF”/, /密钥“HF”/],
    ['Tệp “/tmp/a.xlsx” nằm ngoài thư mục được phép.', /outside the allowed/, /不在允许的文件夹/],
    ['Chưa có thư mục nào được phép cho Excel. Hãy chọn thư mục trong Chi tiết.', /Choose a folder in Details/, /选择文件夹/],
  ];
  for (const [vi, en, zh] of rows) {
    assert.match(I.tr(vi, 'en'), en, vi);
    assert.match(I.tr(vi, 'zh'), zh, vi);
  }
});

test('http nội bộ có cờ lan trên trạng thái, vòng lặp cục bộ thì không', () => {
  const dir = dirOf();
  write(dir, { mcpServers: { lan: { url: 'http://192.168.1.2/mcp' }, loop: { url: 'http://127.0.0.1/mcp' } } });
  const m = M.createMcpManager({ dir });
  assert.equal(m.status('lan').lan, true);
  assert.equal(m.status('loop').lan, false);
});
