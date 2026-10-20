// Kiểm thử v0.13: máy tính, hộp cát JavaScript/Python, JSON Schema → ngữ pháp, lịch, ghi nhớ, giới hạn thư mục, SSRF, csvStats
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluate, fmtVi } = require('../src/agent/calc');
const { runJavaScript, runPython, findPython, fixTrailingObject } = require('../src/agent/sandbox');
const { toGbnfSchema, dropNullOptionals, normalizeTools } = require('../src/schema');
const { createScheduler, nextRunOf, describe: describeTask, parseTime } = require('../src/agent/scheduler');
const { createMemoryStore } = require('../src/agent/memory');
const { createAgent, csvStats } = require('../src/agent/agent');
const { privateIp, assertPublic, htmlToText } = require('../src/agent/web');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-test-'));

test('máy tính: phép toán, phần trăm, dấu phẩy thập phân, hàm; từ chối mã', () => {
  assert.strictEqual(evaluate('2 + 3 * 4'), 14);
  assert.strictEqual(evaluate('2^10'), 1024);
  assert.strictEqual(evaluate('15% * 2400000'), 360000);
  assert.strictEqual(evaluate('10 % 3'), 1);
  assert.strictEqual(evaluate('1,5 * 2'), 3);
  assert.ok(Math.abs(evaluate('sqrt(16) + round(3.14159, 2)') - 7.14) < 1e-9);
  assert.strictEqual(evaluate('5!'), 120);
  assert.strictEqual(evaluate('avg(1, 2, 3, 4)'), 2.5);
  assert.strictEqual(fmtVi(1766000), '1.766.000');
  assert.throws(() => evaluate('process.exit(1)'));
  assert.throws(() => evaluate('constructor'));
  assert.throws(() => evaluate('1 +'));
});

test('hộp cát JavaScript: chạy được, chặn require/process/fs, có giới hạn thời gian', async () => {
  const ok = await runJavaScript('const a = [1,2,3]; a.reduce((s, x) => s + x, 0)');
  assert.strictEqual(ok.ok, true); assert.match(ok.result, /6/);
  const inp = await runJavaScript('INPUT.split("\\n").length', { input: 'a\nb\nc' });
  assert.match(inp.result, /3/);
  for (const bad of ['require("fs")', 'process.env', 'this.constructor.constructor("return process")()', 'fetch("http://example.com")']) {
    const r = await runJavaScript(bad); assert.strictEqual(r.ok, false, bad);
  }
  const t = await runJavaScript('while (true) {}', { timeoutMs: 400 });
  assert.strictEqual(t.ok, false); assert.match(t.error, /giây|thời gian|quá/i);
  assert.strictEqual(fixTrailingObject('const a=1, b=2;\n{a, b}'), 'const a=1, b=2;\n({a, b})');
});

test('Python (nếu có): chạy được, chặn mạng và tiến trình con', { skip: !findPython() }, async () => {
  const ok = await runPython('print(sum(range(10)))'); assert.strictEqual(ok.ok, true); assert.match(ok.logs.join('\n'), /45/);
  const net = await runPython('import socket; socket.create_connection(("1.1.1.1", 80))'); assert.strictEqual(net.ok, false);
  const sub = await runPython('import subprocess; subprocess.run(["ls"])'); assert.strictEqual(sub.ok, false);
  const rd = await runPython('open("/etc/passwd").read()'); assert.strictEqual(rd.ok, false);
});

test('JSON Schema → tập con ngữ pháp: enum, trường tuỳ chọn thành null, loại bỏ null khi trả về', () => {
  const sch = { type: 'object', properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['c', 'f'] }, n: { type: ['integer', 'null'] } }, required: ['city'] };
  const g = toGbnfSchema(sch);
  assert.strictEqual(g.type, 'object');
  assert.ok(g.properties.unit.oneOf, 'trường không bắt buộc phải cho phép null');
  assert.deepStrictEqual(dropNullOptionals({ city: 'Huế', unit: null, n: null }, sch), { city: 'Huế' });
  assert.deepStrictEqual(normalizeTools([{ type: 'function', function: { name: 'get_weather', parameters: sch } }]).map(t => t.name), ['get_weather']);
  assert.throws(() => normalizeTools([{ type: 'function', function: { name: 'bad name!' } }]));
  assert.throws(() => normalizeTools([{ function: { name: 'a' } }, { function: { name: 'a' } }]));
});

test('lịch: tính lần chạy tới (một lần / hằng ngày / hằng tuần) và mô tả tiếng Việt', () => {
  assert.deepStrictEqual(parseTime('7:05'), [7, 5]); assert.deepStrictEqual(parseTime('19h'), [19, 0]); assert.strictEqual(parseTime('25:00'), null);
  const from = new Date(2026, 9, 20, 10, 0).getTime(); // Thứ Ba
  assert.strictEqual(nextRunOf({ enabled: true, repeat: 'daily', time: '09:00' }, from), new Date(2026, 9, 21, 9, 0).getTime());
  assert.strictEqual(nextRunOf({ enabled: true, repeat: 'daily', time: '11:30' }, from), new Date(2026, 9, 20, 11, 30).getTime());
  assert.strictEqual(nextRunOf({ enabled: true, repeat: 'weekly', time: '08:00', days: [1] }, from), new Date(2026, 9, 26, 8, 0).getTime());
  assert.strictEqual(nextRunOf({ enabled: false, repeat: 'daily', time: '09:00' }, from), null);
  assert.match(describeTask({ repeat: 'weekly', time: '19:30', days: [1, 3, 5] }), /Thứ Hai, Thứ Tư, Thứ Sáu · 19:30/);
});

test('lịch: lời nhắc một lần được chạy đúng giờ và tự tắt', async () => {
  const dir = tmp(); const fired = [];
  const s = createScheduler({ file: path.join(dir, 's.json'), onFire: async (t) => { fired.push(t.title); return { summary: 'ok' }; }, log: () => {} });
  s.start();
  const t = s.create({ title: 'Uống nước', kind: 'reminder', message: 'Uống nước nhé', repeat: 'once', at: Date.now() + 300 });
  await new Promise(r => setTimeout(r, 1800));
  s.stop();
  assert.deepStrictEqual(fired, ['Uống nước']);
  const after = s.get(t.id); assert.strictEqual(after.enabled, false); assert.strictEqual(after.runs.length, 1); assert.strictEqual(after.runs[0].ok, true);
  assert.throws(() => s.create({ title: 'x', kind: 'reminder', repeat: 'daily', time: 'abc' }));
});

test('ghi nhớ: thêm, chống trùng, sửa, xoá, tìm theo từ khoá', async () => {
  const dir = tmp(); const m = createMemoryStore(path.join(dir, 'mem.json'));
  const a = m.add('Người dùng tên Khôi, sinh viên VLU');
  assert.strictEqual(m.add('Người dùng tên Khôi, sinh viên VLU').duplicate, true);
  for (let i = 0; i < 9; i++) m.add(`Ghi chú số ${i} về chuyện khác`);
  m.add('Môn học yêu thích là Trí tuệ nhân tạo');
  const r = await m.retrieve('môn học yêu thích của tôi', { k: 3 });
  assert.ok(r.items.some(x => /Trí tuệ nhân tạo/.test(x.text)));
  m.update(a.id, 'Người dùng tên Khôi');
  assert.ok(m.list().some(x => x.text === 'Người dùng tên Khôi'));
  m.remove(a.id); assert.ok(!m.list().some(x => x.id === a.id));
  m.clear(); assert.strictEqual(m.count(), 0);
  assert.ok(createMemoryStore(path.join(dir, 'mem.json')).count() === 0, 'lưu ra đĩa');
});

test('Trợ lý: chỉ làm việc trong thư mục được phép, xoá/ghi đè luôn hỏi', async () => {
  const root = tmp(); const allowed = path.join(root, 'Tài liệu'); const outside = path.join(root, 'bi-mat');
  fs.mkdirSync(allowed); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'mật khẩu');
  fs.writeFileSync(path.join(allowed, 'a.txt'), 'xin chào');
  try { fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(allowed, 'lien-ket.txt')); } catch {}
  const trashed = [];
  const agent = createAgent({ engine: {}, getSettings: () => ({ agentFolders: [allowed], agentWeb: false }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async (f) => { trashed.push(f); fs.unlinkSync(f); }, extractFile: async (f) => ({ kind: 'text', text: fs.readFileSync(f, 'utf8') }), log: () => {} });
  assert.strictEqual(agent.resolvePath('a.txt').full, fs.realpathSync(path.join(allowed, 'a.txt')));
  assert.strictEqual(agent.resolvePath('Tài liệu/a.txt').full, fs.realpathSync(path.join(allowed, 'a.txt')));
  for (const bad of ['../bi-mat/secret.txt', path.join(outside, 'secret.txt'), '/etc/passwd', 'lien-ket.txt']) assert.throws(() => agent.resolvePath(bad), bad);
  const no = async () => false, yes = async () => true;
  const del = await agent.exec('delete_file', { path: 'a.txt' }, { confirm: no });
  assert.strictEqual(del.refused, true); assert.ok(fs.existsSync(path.join(allowed, 'a.txt'))); assert.strictEqual(trashed.length, 0);
  const ow = await agent.exec('write_file', { path: 'a.txt', content: 'mới', mode: 'overwrite' }, { confirm: no });
  assert.strictEqual(ow.refused, true); assert.strictEqual(fs.readFileSync(path.join(allowed, 'a.txt'), 'utf8'), 'xin chào');
  await agent.exec('write_file', { path: 'tom-tat.md', content: '# Tóm tắt' }, { confirm: no });
  assert.strictEqual(fs.readFileSync(path.join(allowed, 'tom-tat.md'), 'utf8'), '# Tóm tắt');
  await assert.rejects(agent.exec('write_file', { path: 'x.exe', content: 'MZ' }, { confirm: yes }));
  await assert.rejects(agent.exec('web_search', { query: 'abc' }, { confirm: yes }), /mạng đang tắt/);
  assert.ok(!agent.activeTools().includes('web_search'));
  await agent.exec('delete_file', { path: 'a.txt' }, { confirm: yes });
  assert.strictEqual(trashed.length, 1); assert.ok(!fs.existsSync(path.join(allowed, 'a.txt')));
  assert.ok(fs.existsSync(path.join(outside, 'secret.txt')));
});

test('csvStats: tổng, trung bình, tổng theo nhóm chính xác', () => {
  const csv = 'ngay,hang_muc,so_tien\n1,Ăn uống,185000\n2,Đi lại,62000\n3,Ăn uống,215000\n4,Sách vở,240000';
  const s = csvStats(csv);
  assert.match(s, /702[.,]?000/); assert.match(s, /175[.,]?500/); assert.match(s, /Ăn uống[^\n]*400[.,]?000/);
});

test('web: chặn địa chỉ nội bộ (SSRF), chuyển HTML thành chữ', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1']) assert.strictEqual(privateIp(ip), true, ip);
  assert.strictEqual(privateIp('1.1.1.1'), false);
  await assert.rejects(assertPublic('http://localhost:1234/v1/models'));
  await assert.rejects(assertPublic('file:///etc/passwd'));
  await assert.rejects(assertPublic('http://169.254.169.254/latest/meta-data'));
  assert.match(htmlToText('<html><script>x()</script><h1>Xin chào</h1><p>Việt&nbsp;Nam</p></html>').text, /Xin chào[\s\S]*Việt Nam/);
});
