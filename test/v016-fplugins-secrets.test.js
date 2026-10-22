'use strict';
// F-PLUGINS mục 15 PR 2: kho bí mật, plugins-meta.json, thẻ xin phép, và không để giá trị bí mật lọt ra ngoài.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../src/mcp');
const PG = require('../src/plugins');
const AP = require('../src/agent/approval');
const CORE = require('../src/i18n/core');
const en = require('../src/i18n/en');
const zh = require('../src/i18n/zh');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-sec-'));
const T = CORE.create({ en, zh });
function fakeSecure() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s) => Buffer.from(Buffer.from(String(s), 'utf8').map(b => b ^ 0x5a)),
    decryptString: (b) => Buffer.from(Buffer.from(b).map(x => x ^ 0x5a)).toString('utf8'),
  };
}
function fakeInsecure(backend) {
  return { isEncryptionAvailable: () => backend !== 'off', getSelectedStorageBackend: () => backend || 'basic_text', encryptString: () => { throw new Error('no'); }, decryptString: () => '' };
}
function mockSdk() {
  const calls = [];
  class Client {
    async connect() { calls.push('connect'); }
    async listTools() { return { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: {} } }] }; }
    async callTool() { calls.push('call'); return { content: [{ type: 'text', text: 'ok' }] }; }
    async close() { calls.push('close'); }
  }
  class Stdio { constructor() { calls.push('stdio'); this.stderr = { on() {} }; } }
  class Http { constructor() { calls.push('http'); } }
  class Sse { constructor() { calls.push('sse'); } }
  return { Client, Stdio, Http, Sse, calls };
}
function world({ secure = true, folders = [], agentEnabled = () => true } = {}) {
  const dir = tmp();
  const logs = [];
  const cards = [];
  const sdk = mockSdk();
  const approve = { fn: async (card) => { cards.push(card); return { ok: true, always: true }; } };
  const secrets = PG.createSecretStore({ dir, safeStorage: secure ? fakeSecure() : fakeInsecure('basic_text') });
  const mcp = M.createMcpManager({ dir, sdk, log: (sc, m) => logs.push(String(sc) + '\n' + String(m)), scrub: (s) => secrets.mask(s), resolveSecret: (id) => secrets.get(id) });
  const gate = PG.createPluginGate({
    dir, mcp, secrets,
    approve: (card) => approve.fn(card),
    log: (sc, m) => logs.push(String(sc) + '\n' + String(m)),
    getAgentFolders: () => folders,
    agentEnabled,
  });
  return { dir, logs, cards, sdk, secrets, mcp, gate, approve };
}

test('kho bí mật: có kho khoá thì ghi bản mã, không ghi chữ; không có thì chỉ ở bộ nhớ', () => {
  const dir = tmp();
  const secure = PG.createSecretStore({ dir, safeStorage: fakeSecure() });
  assert.equal(secure.secure(), true);
  assert.equal(secure.put('mcp:hf:Authorization', 'Bearer siêu-bí-mật-12345678').persisted, true);
  assert.equal(secure.get('mcp:hf:Authorization'), 'Bearer siêu-bí-mật-12345678');
  const disk = fs.readFileSync(secure.file, 'utf8');
  assert.equal(disk.includes('siêu-bí-mật-12345678'), false);
  assert.equal(disk.includes('Bearer'), false);
  assert.equal(fs.statSync(secure.file).mode & 0o777, 0o600);
  assert.equal(secure.sentence(), PG.KEYCHAIN_OK);
  const off = PG.createSecretStore({ dir: tmp(), safeStorage: fakeInsecure('basic_text') });
  assert.equal(off.secure(), false);
  assert.equal(off.put('mcp:a:TOKEN', 'ghp_khongghi123456').persisted, false);
  assert.equal(off.exists(), false);
  assert.equal(off.get('mcp:a:TOKEN'), 'ghp_khongghi123456');
  assert.equal(off.sentence(), PG.KEYCHAIN_NO);
  assert.equal(PG.storageSecure(fakeInsecure('unknown')), false);
  assert.equal(PG.storageSecure(fakeInsecure('off')), false);
});

test('tách bí mật: env và Authorization thành tham chiếu; NODE_ENV=production giữ nguyên', () => {
  const dir = tmp();
  const store = PG.createSecretStore({ dir, safeStorage: fakeSecure() });
  const secret = 'hf_day-la-khoa-bi-mat-duy-nhat';
  const { cfg, count } = PG.extractSecrets({ mcpServers: { hf: { url: 'https://huggingface.co/mcp', headers: { Authorization: 'Bearer ' + secret }, env: { TOKEN: secret, NODE_ENV: 'production' } } } }, store);
  assert.equal(count, 2);
  assert.equal(cfg.mcpServers.hf.headers.Authorization, '${secret:mcp:hf:Authorization}');
  assert.equal(cfg.mcpServers.hf.env.TOKEN, '${secret:mcp:hf:TOKEN}');
  assert.equal(cfg.mcpServers.hf.env.NODE_ENV, 'production');
  assert.equal(JSON.stringify(cfg).includes(secret), false);
  assert.equal(store.get('mcp:hf:TOKEN'), secret);
});

test('thẻ kết nối: alwaysLabel chỉ cho Nâng cao, Lệnh nằm trong details, danger cho http nội bộ và lệnh không ghim', () => {
  const dir = tmp();
  const secrets = PG.createSecretStore({ dir, safeStorage: fakeSecure() });
  const lan = PG.cardMcpConnect('nội bộ', { url: 'http://192.168.1.5/mcp' }, secrets);
  assert.equal(lan.tool, 'mcp_connect');
  assert.equal(lan.alwaysLabel, 'Luôn chạy sẵn');
  assert.equal(lan.allowAlways, true);
  assert.equal(lan.danger, true);
  assert.ok(JSON.stringify(lan.fields).includes('Địa chỉ http này nằm trong mạng nội bộ của bạn.'));
  assert.ok(JSON.stringify(lan.fields).includes('Dữ liệu gửi tới máy chủ này rời khỏi máy bạn.'));
  assert.equal(PG.commandInDetails(lan), true);
  assert.equal(lan.details.some(([k]) => k === 'Lệnh'), true);
  assert.equal(lan.details.some(([, v]) => v === 'http://192.168.1.5/mcp'), true);
  const loop = PG.cardMcpConnect('vòng', { url: 'http://127.0.0.1:9/mcp' }, secrets);
  assert.equal(loop.danger, false);
  assert.equal(JSON.stringify(loop.fields).includes('rời khỏi máy'), false);
  const pinned = PG.cardMcpConnect('filesystem', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2.0.0', '/DuAn'] }, secrets);
  assert.equal(pinned.danger, false);
  assert.equal(PG.unpinned(pinned && { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2.0.0'] }), false);
  const loose = PG.cardMcpConnect('fetch', { command: 'npx', args: ['-y', 'mcp-fetch-server'] }, secrets);
  assert.equal(loose.danger, true);
  assert.ok(JSON.stringify(loose.fields).includes('không ghim phiên bản'));
  const remote = PG.cardMcpConnect('lạ', { url: 'https://evil.example/mcp' }, secrets);
  assert.equal(remote.danger, true);
  const hf = PG.cardMcpConnect('huggingface', { url: 'https://huggingface.co/mcp' }, secrets);
  assert.equal(hf.danger, false);
  const biz = PG.cardConnector('biz');
  assert.equal(biz.tool, 'connector_connect');
  assert.equal(biz.allowAlways, false);
  assert.equal(biz.alwaysLabel, undefined);
  assert.deepEqual(biz.details, []);
  assert.equal(biz.danger, false);
  assert.equal(biz.note, 'Kết nối được giữ khi bạn mở lại AIVN.');
  const excel = PG.cardConnector('excel', { folders: ['/DuAn/BaoCao'] });
  assert.equal(excel.details.length, 0);
  assert.equal(excel.fields.some((row) => row[1] === 'BaoCao' && row[2] === '/DuAn/BaoCao'), true);
  const only = PG.cardAutostart('filesystem');
  assert.equal(only.allowAlways, false);
  assert.equal(only.alwaysLabel, undefined);
  assert.equal(only.title, 'Cho phép máy chủ này tự chạy mỗi khi mở AIVN.');
  assert.equal(PG.checkboxLabel(lan), 'Luôn chạy sẵn');
  assert.equal(PG.checkboxLabel({ allowAlways: true }), 'Luôn cho phép công cụ này');
  assert.equal(PG.checkboxLabel(biz), null);
  const imp = PG.cardImport([{ name: 'a', kind: 'stdio', commandRedacted: 'npx ••••', danger: true }], { secretCount: 2, secretsSecure: true });
  assert.equal(imp.tool, 'mcp_import');
  assert.equal(imp.danger, true);
  assert.ok(imp.fields.some(([, v]) => String(v).includes('Đã tách 2 khoá bí mật')));
  assert.equal(PG.commandInDetails(imp), true);
  const off = PG.cardImport([{ name: 'a', kind: 'http', commandRedacted: 'https://x' }], { secretCount: 1, secretsSecure: false });
  assert.ok(JSON.stringify(off.fields).includes(PG.KEYCHAIN_NO));
  const rep = PG.cardReplace('a', { command: 'old' }, { command: 'new' }, secrets);
  assert.equal(rep.danger, true);
  assert.equal(rep.allowAlways, false);
  assert.deepEqual(rep.fields, []);
  assert.deepEqual(rep.details.map(r => r[0]), ['Lệnh cũ', 'Lệnh mới']);
});

test('chữ trên thẻ có bản en và zh', () => {
  for (const s of PG.CARD_STRINGS) {
    const a = T.tr(s, 'en'); const b = T.tr(s, 'zh');
    assert.notEqual(a, s, 'en thiếu: ' + s);
    assert.notEqual(b, s, 'zh thiếu: ' + s);
    assert.equal((String(s).match(/\{\d+\}/g) || []).join(','), (String(a).match(/\{\d+\}/g) || []).join(','), s);
    assert.equal((String(s).match(/\{\d+\}/g) || []).join(','), (String(b).match(/\{\d+\}/g) || []).join(','), s);
  }
  assert.equal(T.tr('Cho phép kết nối “Excel”?', 'en'), 'Allow “Excel” to connect?');
  assert.equal(T.tr('Cho phép kết nối “Excel”?', 'zh'), '允许连接“Excel”？');
  assert.equal(T.tr('Nhập 2 máy chủ từ mcp.json?', 'en'), 'Import 2 servers from mcp.json?');
  assert.equal(T.tr('Nhập 2 máy chủ từ mcp.json?', 'zh'), '从 mcp.json 导入 2 个服务器？');
  assert.equal(T.tr('Thay thế máy chủ “fetch”?', 'en'), 'Replace server “fetch”?');
  assert.equal(T.tr('không có', 'en'), 'none');
  assert.equal(T.tr('Luôn cho phép công cụ này', 'zh'), '始终允许此工具');
  assert.equal(T.tr('Cho AIVN AGENT dùng các ứng dụng đã kết nối', 'en'), 'Let AIVN AGENT use connected apps');
  assert.equal(T.tr('Cho AIVN AGENT dùng các ứng dụng đã kết nối', 'zh'), '允许 AIVN AGENT 使用已连接的应用');
  assert.equal(T.tr('Luôn chạy sẵn', 'en'), 'Always ready');
  assert.equal(T.tr('Luôn chạy sẵn', 'zh'), '始终就绪');
});

test('mọi lần gọi Kinh doanh đi qua thẻ; lần ghi đầu sau khi mở vẫn hỏi dù đã luôn cho phép', () => {
  for (const fn of [...PG.BIZ_READ, ...PG.BIZ_WRITE, ...PG.BIZ_DANGER]) assert.equal(AP.needsApproval('biz_' + fn), true, fn);
  assert.equal(AP.needsApproval('excel_read_sheet'), false);
  assert.equal(AP.needsApproval('excel_write_to_sheet'), true);
  assert.equal(AP.policy('biz_deleteInvoice').allowAlways, false);
  assert.equal(AP.policy('biz_deleteInvoice').danger, true);
  assert.equal(AP.policy('biz_createReceipt').allowAlways, true);
  assert.equal(AP.shouldAsk('biz_listStock', ['biz_listStock']), false);
  assert.equal(AP.shouldAsk('biz_createReceipt', ['biz_createReceipt']), true);
  AP.noteApprovedWrite('biz_createReceipt');
  assert.equal(AP.shouldAsk('biz_createReceipt', ['biz_createReceipt']), false);
  assert.equal(AP.shouldAsk('biz_registerPayment', ['biz_registerPayment']), true);
  const card = AP.buildCard('biz_saveInvoice', { TOKEN: 'siêu-bí-mật-12345678', note: 'giữ' }, { label: 'Lưu hoá đơn' });
  assert.equal(card.fields.find(r => r[0] === 'TOKEN')[1], '••••');
  assert.equal(card.fields.find(r => r[0] === 'note')[1], 'giữ');
  assert.equal(JSON.stringify(card).includes('siêu-bí-mật-12345678'), false);
});

test('nâng cấp meta một lần; cửa hàng không tự chạy; đổi lệnh thì mất duyệt, đổi timeout thì không', async () => {
  const { dir, mcp, gate, logs, sdk } = world();
  await mcp.saveText(JSON.stringify({ mcpServers: {
    cũ: { command: 'node', args: ['a.js'] },
    tắt: { command: 'node', args: ['b.js'], disabled: true },
    excel: { command: 'npx', args: ['-y', '@negokaz/excel-mcp-server@0.12.0'] },
  } }));
  const names = gate.upgradeOnce();
  assert.deepEqual(names, ['cũ']);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'plugins-meta.json'), 'utf8'));
  assert.equal(meta.servers['cũ'].autoStart, false);
  assert.ok(meta.servers['cũ'].approvedAt);
  assert.equal(meta.servers['tắt'], undefined);
  assert.equal(meta.servers.excel, undefined);
  assert.deepEqual(meta.connectors, {});
  assert.ok(logs.some(l => /Nâng cấp một lần: 1 máy chủ/.test(l)));
  meta.servers['cũ'].approvedAt = null;
  fs.writeFileSync(path.join(dir, 'plugins-meta.json'), JSON.stringify(meta));
  gate.meta.load();
  assert.deepEqual(gate.upgradeOnce(), []);
  assert.equal(gate.meta.server('cũ').approvedAt, null);
  const folders = ['/DuAn/BaoCao'];
  const w = world({ folders });
  let started = 0; const realStart = w.mcp.start.bind(w.mcp); w.mcp.start = async (...a) => { started++; return realStart(...a); };
  const biz = await w.gate.connectConnector('biz');
  assert.equal(biz.ok, true);
  assert.equal(started, 0);
  const row = w.gate.meta.data.connectors.biz;
  assert.equal(row.enabled, true);
  assert.equal('autoStart' in row, false);
  assert.equal(w.mcp.config().mcpServers.excel, undefined);
  const ex = await w.gate.connectConnector('excel');
  assert.equal(ex.ok, true);
  assert.deepEqual(w.gate.meta.data.connectors.excel.folders, folders);
  w.gate.getAgentFolders = () => ['/khac'];
  await w.gate.connectConnector('excel');
  assert.deepEqual(w.gate.meta.data.connectors.excel.folders, folders);
  assert.equal(w.gate.connectorView().excel.state, 'waiting');
  w.gate.meta.setNotify('gmail', true);
  w.gate.meta.setNotify('filesystem', true);
  assert.deepEqual(w.gate.meta.data.notify, { gmail: true });
  const saved = await gate.saveJson(JSON.stringify({ mcpServers: { cũ: { command: 'node', args: ['a.js'], timeout: 5000 } } }));
  assert.equal(saved.ok, true);
  assert.equal(gate.meta.server('cũ').approvedAt, null);
  await gate.startServer('cũ');
  assert.ok(gate.meta.server('cũ').approvedAt);
  const again = await gate.saveJson(JSON.stringify({ mcpServers: { cũ: { command: 'node', args: ['a.js'], timeout: 9000 } } }));
  assert.equal(again.ok, true);
  assert.ok(gate.meta.server('cũ').approvedAt);
  await gate.saveJson(JSON.stringify({ mcpServers: { cũ: { command: 'node', args: ['doi.js'], timeout: 9000 } } }));
  assert.equal(gate.meta.server('cũ').approvedAt, null);
  assert.equal(sdk.calls.filter(c => c === 'connect').length >= 1, true);
});

test('Luôn chạy sẵn mặc định tắt; công tắc chủ tắt cả cửa hàng; lần dùng đầu mới chạy', async () => {
  let on = true;
  const { mcp, gate } = world({ agentEnabled: () => on });
  await mcp.saveText(JSON.stringify({ mcpServers: { cũ: { command: 'node', args: ['a.js'] }, excel: { command: 'npx', args: ['-y', '@negokaz/excel-mcp-server@0.12.0'] } } }));
  gate.upgradeOnce();
  assert.equal(gate.meta.server('cũ').autoStart, false);
  const started = [];
  const realStart = mcp.start.bind(mcp);
  mcp.start = async (name) => { started.push(name); return realStart(name); };
  assert.deepEqual(await gate.startAuto(), []);
  assert.deepEqual(started, []);
  const biz = await gate.connectConnector('biz');
  assert.equal(biz.ok, true);
  assert.equal(gate.connectorView().biz.pausedByMaster, false);
  assert.equal(gate.connectorsForAgent().biz.enabled, true);
  assert.deepEqual(await gate.ensureLazy(), ['cũ']);
  assert.deepEqual(started, ['cũ']);
  on = false;
  assert.equal(gate.connectorView().biz.pausedByMaster, true);
  assert.equal(gate.connectorView().biz.enabled, true);
  assert.deepEqual(gate.connectorsForAgent(), {});
  assert.deepEqual(await gate.ensureLazy(), []);
  assert.deepEqual(await gate.startAuto(), []);
  assert.equal(gate.meta.server('cũ').approvedAt != null, true);
  on = true;
  assert.equal(gate.connectorsForAgent().biz.enabled, true);
  assert.equal(gate.meta.server('cũ').approvedAt != null, true);
});

test('từ chối thẻ thì không chạy; mẫu không ghi tệp khi từ chối', async () => {
  const { mcp, gate, sdk, approve } = world();
  approve.fn = async () => ({ ok: false });
  await mcp.saveText(JSON.stringify({ mcpServers: { a: { command: 'node', args: ['a.js'] } } }));
  const before = mcp.readText();
  const denied = await gate.startServer('a');
  assert.equal(denied.ok, false);
  assert.equal(denied.canceled, true);
  assert.equal(sdk.calls.includes('connect'), false);
  const preset = await gate.addPreset('memory');
  assert.equal(preset.ok, false);
  assert.equal(mcp.readText(), before);
  const auth = await gate.startServer('a');
  void auth;
  await mcp.saveText(JSON.stringify({ mcpServers: { oauth: { url: 'https://example.com/mcp', auth: { x: 1 } } } }));
  const no = await gate.startServer('oauth');
  assert.match(no.error, /OAuth/);
  assert.equal(sdk.calls.includes('http'), false);
});

test('thẻ và #approveCard: details đóng, alwaysLabel, không có open sẵn', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app.js'), 'utf8');
  const block = html.slice(html.indexOf('id="approveCard"'), html.indexOf('id="slashPop"'));
  assert.match(html, /Cho AIVN AGENT dùng các ứng dụng đã kết nối/);
  assert.doesNotMatch(html, /Cho AIVN AGENT dùng công cụ MCP/);
  assert.match(block, /data-testid="approve-details"/);
  assert.doesNotMatch(block, /<details[^>]*\sopen[\s>]/);
  assert.match(app, /det\.open = false/);
  assert.match(app, /c\.alwaysLabel/);
  assert.match(app, /c\.details/);
  assert.match(app, /c\.sub/);
  assert.match(app, /c\.note/);
  const order = html.indexOf('error-view.js') < html.indexOf('drafts.js') && html.indexOf('drafts.js') < html.indexOf('gen-chrome.js') && html.indexOf('gen-chrome.js') < html.indexOf('app.js');
  assert.equal(order, true);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/mcp.js'), 'utf8');
  assert.match(src, /async function startEnabled\(\) \{ for \(const \[n, d\] of Object\.entries\(config\(\)\.mcpServers\)\) if \(!d\.disabled\) start\(n\)\.catch\(\(\) => \{\}\); \}/);
});

test('chạy thử rồi tắt; quá giờ thì câu dễ hiểu không chứa bí mật; đổi tên hiển thị giữ tên gốc', async () => {
  const SECRET = 'AIVNLEAK_PROBE_' + crypto.randomBytes(8).toString('hex');
  const dir = tmp();
  const logs = [];
  const secrets = PG.createSecretStore({ dir, safeStorage: fakeSecure() });
  class Client { async connect() { await new Promise(() => {}); } async listTools() { return { tools: [] }; } async close() {} }
  class Stdio { constructor() { this.stderr = { on() {} }; } }
  class Http { constructor() {} }
  class Sse { constructor() {} }
  const mcp = M.createMcpManager({ dir, sdk: { Client, Stdio, Http, Sse }, log: (_sc, m) => logs.push(String(m)), scrub: (s) => secrets.mask(s), resolveSecret: (id) => secrets.get(id) });
  const gate = PG.createPluginGate({ dir, mcp, secrets, probeMs: 80, approve: async () => ({ ok: true, always: false }), log: (_sc, m) => logs.push(String(m)) });
  const saved = await gate.saveJson(JSON.stringify({ mcpServers: { treo: { command: 'node', args: [SECRET], env: { TOKEN: SECRET } } } }));
  assert.equal(saved.ok, true, saved.error);
  const slow = await gate.startServer('treo');
  assert.equal(slow.ok, false);
  assert.equal(slow.error, 'Chạy thử quá 15 giây nên đã tắt. Hãy kiểm tra lệnh trong Chi tiết, rồi chạy thử lại.');
  assert.equal(JSON.stringify(slow).includes(SECRET), false);
  assert.equal(logs.join('\n').includes(SECRET), false);
  assert.equal((mcp.status('treo') || {}).state, 'off');
  assert.equal(gate.setDisplayName('treo', 'Sổ của tôi').displayName, 'Sổ của tôi');
  const card = PG.cardMcpConnect('treo', { command: 'node', args: ['a.js'] }, secrets, { displayName: 'Sổ của tôi' });
  assert.equal(card.title, 'Cho phép kết nối “Sổ của tôi”?');
  assert.deepEqual(card.details[0], ['Tên gốc', 'treo']);
  assert.match(card.note, /15 giây/);
  assert.equal(gate.setDisplayName('treo', '').ok, false);
  assert.equal(gate.setDisplayName('treo', null).displayName, null);
  const moved = await gate.changeExcelFolders(['/DuAn/Moi']);
  assert.equal(moved.ok, true);
  assert.deepEqual(gate.meta.data.connectors.excel.folders, ['/DuAn/Moi']);
  assert.equal(PG.qaDenies({ tool: 'excel_folders' }), true);
});

test('giá trị bí mật đã gieo không xuất hiện ở nhật ký, addLog, IPC, DOM hay câu lỗi', async () => {
  const SECRET = 'AIVNLEAK_' + crypto.randomBytes(24).toString('hex');
  const dir = tmp();
  const logs = [];
  const cards = [];
  const ipc = [];
  const errors = [];
  const secrets = PG.createSecretStore({ dir, safeStorage: fakeSecure() });
  const sdk = leakSdk(SECRET);
  const mcp = M.createMcpManager({
    dir, sdk,
    log: (sc, m) => logs.push(String(sc) + '\n' + String(m)),
    scrub: (s) => secrets.mask(s),
    resolveSecret: (id) => secrets.get(id),
  });
  const gate = PG.createPluginGate({
    dir, mcp, secrets,
    approve: async (card) => { cards.push(card); ipc.push(card); return { ok: true, always: false }; },
    log: (sc, m) => logs.push(String(sc) + '\n' + String(m)),
  });
  const saved = await gate.saveJson(JSON.stringify({ mcpServers: {
    ok: { command: 'node', args: ['srv.js', SECRET], env: { TOKEN: SECRET, NODE_ENV: 'production' } },
    bad: { command: 'fail', args: [SECRET], env: { API_KEY: SECRET } },
    web: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ' + SECRET } },
  } }));
  ipc.push(saved);
  assert.equal(saved.ok, true, saved.error);
  const file = JSON.parse(fs.readFileSync(mcp.file, 'utf8'));
  assert.equal(JSON.stringify(file.mcpServers.ok.env).includes(SECRET), false);
  assert.equal(JSON.stringify(file.mcpServers.web.headers).includes(SECRET), false);
  assert.equal(file.mcpServers.ok.env.NODE_ENV, 'production');
  const bad = await gate.startServer('bad');
  errors.push(bad.error);
  ipc.push(bad);
  const ok = await gate.startServer('ok');
  ipc.push(ok);
  const web = await gate.startServer('web');
  ipc.push(web);
  await gate.ensureLazy();
  const called = await mcp.exec('mcp__ok__echo', { text: 'xin chào ' + SECRET });
  ipc.push(called);
  try { await mcp.exec('mcp__ok__echo', { text: 'lần hai' }); } catch (e) { errors.push(e && e.message, e && e.stack); }
  ipc.push(gate.publicPayload());
  ipc.push(mcp.status());
  const dom = cards.map(PG.cardVisibleText).join('\n');
  const blob = [logs.join('\n'), dom, JSON.stringify(ipc), errors.join('\n'), fs.readFileSync(secrets.file, 'utf8'), fs.readFileSync(path.join(dir, 'plugins-meta.json'), 'utf8')].join('\n');
  const at = blob.indexOf(SECRET);
  assert.equal(at, -1, at < 0 ? '' : 'lọt ở ' + at + ' sau: ' + blob.slice(Math.max(0, at - 40), at).replace(SECRET, ''));
  assert.equal(secrets.get('mcp:ok:TOKEN'), SECRET);
  assert.ok(cards.length >= 1);
  assert.equal(cards.every(c => PG.cardVisibleText(c).includes(SECRET) === false), true);
});

function leakSdk(secret) {
  class Client {
    constructor() { this.n = 0; }
    async connect(transport) {
      if (transport && transport._fn) transport._fn('stderr ' + secret);
      if (transport && transport.fail) {
        const e = new Error('connect ' + secret);
        e.stack = 'Error: connect ' + secret + '\n    at Client.connect (' + secret + ')';
        throw e;
      }
    }
    async listTools() { return { tools: [{ name: 'echo', description: 'mô tả ' + secret, inputSchema: { type: 'object', properties: { token: { default: secret } } } }] }; }
    async callTool() {
      this.n++;
      if (this.n > 1) {
        const e = new Error('call ' + secret);
        e.stack = 'Error: call ' + secret + '\n    at callTool (' + secret + ')';
        throw e;
      }
      return { content: [{ type: 'text', text: 'kết quả ' + secret }] };
    }
    async close() {}
  }
  class Stdio {
    constructor(opts) {
      this.fail = !!(opts && opts.command === 'fail');
      const self = this;
      this.stderr = { on(ev, fn) { if (ev === 'data') self._fn = fn; } };
    }
  }
  class Http { constructor() { this.fail = false; } }
  class Sse { constructor() {} }
  return { Client, Stdio, Http, Sse };
}

test('khoá người dùng lưu, đổi hoặc xoá không qua thẻ; mcp.json chỉ giữ ${secret:id}; dạng $aivnSecret vẫn đọc được', async () => {
  const { dir, mcp, gate, cards, sdk, secrets } = world();
  const legacy = { mcpServers: { hf: { url: 'https://huggingface.co/mcp', headers: { Authorization: { $aivnSecret: 'mcp:hf:Authorization' } } } } };
  const moved = PG.extractSecrets(legacy, secrets);
  assert.equal(moved.cfg.mcpServers.hf.headers.Authorization, '${secret:mcp:hf:Authorization}');
  assert.equal(moved.count, 0);
  secrets.put('mcp:hf:Authorization', 'hf_khoa-cu-12345678');
  const seen = { headers: null };
  const custom = mockSdk();
  custom.Http = class { constructor(_u, opts) { seen.headers = opts && opts.requestInit && opts.requestInit.headers; } };
  const m2 = M.createMcpManager({ dir: tmp(), sdk: custom, resolveSecret: (id) => id === 'mcp:hf:Authorization' ? 'hf_khoa-cu-12345678' : '' });
  fs.writeFileSync(m2.file, JSON.stringify({ mcpServers: { hf: { url: 'https://huggingface.co/mcp', headers: { Authorization: '${secret:mcp:hf:Authorization}' } } } }));
  const st = await m2.start('hf');
  assert.equal(st.state, 'on', st.error);
  assert.equal(seen.headers.Authorization, 'hf_khoa-cu-12345678');
  assert.equal(JSON.stringify(m2.status('hf')).includes('hf_khoa-cu-12345678'), false);
  fs.writeFileSync(m2.file, JSON.stringify(legacy));
  const old = await m2.start('hf');
  assert.equal(old.state, 'on', old.error);
  assert.equal(seen.headers.Authorization, 'hf_khoa-cu-12345678');
  const before = cards.length;
  await gate.saveJson(JSON.stringify({ mcpServers: { s: { command: 'node', args: ['a.js'] } } }));
  await gate.startServer('s');
  const saved = await gate.setUserSecret('s', 'TOKEN', 'hf_nguoi-dung-tu-luu-1234');
  assert.equal(saved.ok, true);
  assert.equal(cards.length, before + 1);
  const disk = JSON.parse(fs.readFileSync(mcp.file, 'utf8'));
  assert.equal(disk.mcpServers.s.env.TOKEN, '${secret:mcp:s:TOKEN}');
  assert.equal(JSON.stringify(disk).includes('hf_nguoi-dung-tu-luu-1234'), false);
  assert.equal(secrets.get('mcp:s:TOKEN'), 'hf_nguoi-dung-tu-luu-1234');
  const changed = await gate.setUserSecret('s', 'TOKEN', 'hf_doi-khoa-khac-123456');
  assert.equal(changed.ok, true);
  assert.equal(cards.length, before + 1);
  const removed = await gate.setUserSecret('s', 'TOKEN', '');
  assert.equal(removed.removed, true);
  assert.equal(cards.length, before + 1);
  assert.equal(JSON.parse(fs.readFileSync(mcp.file, 'utf8')).mcpServers.s.env.TOKEN, undefined);
  assert.equal(sdk.calls.includes('connect'), true);
  void dir;
});

test('đang chạy thì chỉ khởi động lại khi cấu hình hoặc khoá đổi; chạy thử theo lần thêm, lần lỗi, và lần đầu', async () => {
  const { mcp, gate, sdk, secrets, cards } = world();
  const added = await gate.addPreset('memory');
  assert.equal(added.probed, true, added.error);
  assert.equal((mcp.status('memory') || {}).state, 'off');
  const direct = await gate.startServer('memory');
  assert.equal(direct.direct, true, JSON.stringify(direct));
  assert.equal((mcp.status('memory') || {}).state, 'on');
  const connects = sdk.calls.filter(c => c === 'connect').length;
  const kept = await gate.startServer('memory');
  assert.equal(kept.kept, true);
  assert.equal(sdk.calls.filter(c => c === 'connect').length, connects);
  const asked = cards.length;
  await gate.setUserSecret('memory', 'TOKEN', 'hf_doi-khi-dang-chay-1234');
  assert.equal(cards.length, asked);
  const restarted = await gate.startServer('memory');
  assert.equal(restarted.restarted, true, JSON.stringify(restarted));
  assert.equal(sdk.calls.filter(c => c === 'connect').length, connects + 1);
  secrets.forget('mcp:memory:TOKEN');
  const failed = await gate.startServer('memory');
  assert.equal(failed.ok, false);
  secrets.put('mcp:memory:TOKEN', 'hf_doi-khi-dang-chay-1234');
  const again = await gate.startServer('memory');
  assert.equal(again.probed, true, JSON.stringify(again));
  assert.equal((mcp.status('memory') || {}).state, 'off');
  await gate.saveJson(JSON.stringify({ mcpServers: { nhap: { command: 'node', args: ['n.js'] } } }));
  gate.meta.setServer('nhap', { catalogId: null, approvedAt: new Date().toISOString(), autoStart: false, fp: 'cu' });
  const imported = await gate.probeImported(['nhap']);
  assert.equal(imported[0].probed, true, JSON.stringify(imported[0]));
  assert.equal((mcp.status('nhap') || {}).state, 'off');
  const retry = await gate.startServer('nhap', { probe: true });
  assert.equal(retry.probed, true);
});
