// 0.14.2: tìm ứng dụng cài theo người dùng (Zalo…) + tệp đính kèm trong AIVN BOT
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const C = require('../src/agent/computer');
const CT = require('../src/agent/computer-tools');
const { createAgent } = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-apps-'));

test('Windows: thấy Zalo cài trong %LOCALAPPDATA%\\Programs và lối tắt Desktop', () => {
  const root = tmp(); const local = path.join(root, 'Local'); const prof = path.join(root, 'User');
  fs.mkdirSync(path.join(local, 'Programs', 'Zalo'), { recursive: true });
  fs.writeFileSync(path.join(local, 'Programs', 'Zalo', 'Zalo.exe'), 'x'); fs.writeFileSync(path.join(local, 'Programs', 'Zalo', 'Uninstall Zalo.exe'), 'x');
  fs.mkdirSync(path.join(prof, 'Desktop'), { recursive: true }); fs.writeFileSync(path.join(prof, 'Desktop', 'Cốc Cốc.lnk'), 'x');
  const apps = C.listApps({ platform: 'win32', home: prof, env: { LOCALAPPDATA: local, USERPROFILE: prof, APPDATA: path.join(root, 'Roaming'), ProgramData: path.join(root, 'PD') } });
  const z = apps.find(a => a.name === 'Zalo'); assert.ok(z); assert.match(z.path, /Zalo\.exe$/);
  assert.ok(apps.some(a => a.name === 'Cốc Cốc'));
  for (const q of ['Zalo', 'zalo', 'ZALO', 'Zalo PC', 'zalo pc', 'ứng dụng zalo']) assert.strictEqual((C.findApp(q, apps) || {}).name, 'Zalo', q);
  assert.strictEqual((C.findApp('coc coc', apps) || {}).name, 'Cốc Cốc');
});

test('Windows: đọc sổ đăng ký Uninstall/App Paths và Get-StartApps (Store)', async () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'Zalo.exe'), 'x');
  const json = JSON.stringify([
    { s: 'uninstall', n: 'Zalo 24.10.1', i: `"${path.join(dir, 'Zalo.exe')}",0`, l: dir },
    { s: 'uninstall', n: 'Microsoft Visual C++ 2015-2022 Redistributable', i: null, l: null },
    { s: 'apppath', n: 'chrome.exe', i: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { s: 'start', n: 'WhatsApp', a: '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App' },
  ]);
  const list = await C.deepApps({ platform: 'win32', run: async (cmd, args) => { assert.strictEqual(cmd, 'powershell.exe'); const enc = args[args.indexOf('-EncodedCommand') + 1]; assert.ok(args.includes('-NoProfile') && args.includes('Bypass')); assert.match(Buffer.from(enc, 'base64').toString('utf16le'), /OutputEncoding[\s\S]*Uninstall[\s\S]*App Paths[\s\S]*Get-StartApps[\s\S]*GetFolderPath/); return json; } });
  const zalo = C.findApp('zalo', list); assert.strictEqual(zalo.path, path.join(dir, 'Zalo.exe'));
  assert.strictEqual(C.findApp('whatsapp', list).appId, '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App');
  assert.ok(C.findApp('chrome', list).path.endsWith('chrome.exe'));
  const merged = C.mergeApps([{ name: 'Zalo', path: null }], list.map(a => a.name === 'Zalo 24.10.1' ? { ...a, name: 'Zalo' } : a));
  assert.ok(merged.find(a => a.name === 'Zalo').path);
  assert.deepStrictEqual(C.parseWinApps(''), []);
});

test('macOS: Spotlight tìm ứng dụng ngoài /Applications', async () => {
  const r = await C.macSpotlight('Zalo', { run: async (cmd, args) => { assert.strictEqual(cmd, 'mdfind'); assert.match(args[0], /\*Zalo\*/); return '/Users/khoi/Applications/Zalo.app\n/Volumes/x/readme.txt\n'; } });
  assert.deepStrictEqual(r.map(a => a.name), ['Zalo']);
});

test('open_app dùng nguồn tìm sâu; không có thì nói rõ đã kiểm tra những nguồn nào', async () => {
  const dir = tmp(); const exe = path.join(dir, 'Zalo.lnk'); fs.writeFileSync(exe, 'x');
  const opened = [];
  const tools = CT.createComputerTools({ getSettings: () => ({ agentComputer: true }), visionReady: () => false, openPath: async (p) => { opened.push(p); return ''; }, deepApps: async () => [{ name: 'Zalo', path: exe, source: 'uninstall' }] });
  const r = await tools.exec('open_app', { name: 'zalo pc' }, { confirm: async () => true });
  assert.match(r.forModel, /Đã mở ứng dụng "Zalo"/); assert.deepStrictEqual(opened, [exe]);
  await assert.rejects(tools.exec('open_app', { name: 'UngDungKhongCo123' }, {}), /sau khi đã kiểm tra/);
  const l = await tools.exec('list_apps', { query: 'UngDungKhongCo123' }, {});
  assert.match(l.forModel, /Đừng kết luận là chưa cài/);
});

test('AIVN BOT: tệp đính kèm đọc được bằng read_file dù chưa thêm thư mục; tệp khác vẫn bị chặn', async () => {
  const dir = tmp(); const f = path.join(dir, 'bao-cao.txt'); fs.writeFileSync(f, 'Doanh thu quý 3: 120 triệu');
  const other = path.join(dir, 'bi-mat.txt'); fs.writeFileSync(other, 'mật khẩu');
  const seen = [];
  const replies = [
    (o) => { seen.push(o.tools.map(t => t.name)); return { text: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: { path: f } }], finishReason: 'tool_calls', usage: {} }; },
    () => ({ text: '', toolCalls: [{ id: 'b', name: 'read_file', arguments: { path: other } }], finishReason: 'tool_calls', usage: {} }),
    () => ({ text: 'Doanh thu quý 3 là 120 triệu.', toolCalls: [], finishReason: 'stop', usage: {} }),
  ];
  const engine = { status: () => ({ loaded: true, contextSize: 4096 }), chatStep: async (m, o) => replies.shift()(o) };
  const agent = createAgent({ engine, getSettings: () => ({ agentFolders: [], agentMemory: false }), memory: createMemoryStore(path.join(dir, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async (p) => ({ kind: 'text', text: fs.readFileSync(p, 'utf8') }), embedForMemory: async () => ({}), log: () => {} });
  const r = await agent.run({ messages: [{ role: 'user', content: '[Tệp đính kèm: bao-cao.txt]\nDoanh thu…\n\nTóm tắt' }], attachments: [{ path: f, name: 'bao-cao.txt' }], confirm: async () => true });
  assert.ok(seen[0].includes('read_file'));
  assert.strictEqual(r.steps[0].status, 'ok'); assert.match(r.steps[0].detail, /120 triệu/);
  assert.strictEqual(r.steps[1].status, 'error'); // không được đọc tệp ngoài
  assert.ok(!agent.activeTools().includes('read_file')); // hết lượt: không còn quyền
});
