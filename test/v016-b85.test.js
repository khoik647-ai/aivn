'use strict';
// B85 (máy thật, beta.3-pre, Zalo): “Cloud của tôi” nay hiện “My Documents” (kết quả tìm ghi “Tên cũ: Cloud của tôi”); kiểm tra mở chat đọc tiêu đề cửa sổ “Zalo”
// và đầu bảng “Thông tin hội thoại” bên phải thay vì tiêu đề khung chat ở giữa → chặn gõ dù đã mở đúng cuộc trò chuyện
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const SV = require('../src/agent/send-verify');
const ROOT = path.join(__dirname, '..');
// toạ độ lấy từ ảnh chụp thật agent3/step-05 (1024×576)
const ZALO = { win: { title: 'Zalo', b: [0, 0, 1024, 576] }, elements: [
  { name: 'Cloud của tôi', b: [55, 22, 95, 12], ocr: true }, { name: 'Đóng', b: [170, 22, 22, 12], ocr: true }, { name: 'Tất cả Liên hệ Tin nhắn File', b: [40, 47, 100, 10], ocr: true },
  { name: 'My Documents', b: [70, 87, 56, 11], ocr: true }, { name: 'Tên cũ: Cloud của tôi', b: [70, 99, 66, 10], ocr: true },
  { name: 'My Documents', b: [243, 18, 64, 12], ocr: true }, { name: 'Lưu trữ và đồng bộ dữ liệu giữa các thiết bị', b: [243, 33, 125, 9], ocr: true },
  { name: 'Thông tin hội thoại', b: [886, 22, 92, 12], ocr: true }, { name: 'My Documents', b: [906, 94, 66, 11], ocr: true }, { name: '2158', b: [870, 60, 20, 8], ocr: true },
  { name: 'Hôm qua', b: [513, 82, 30, 8], ocr: true }, { name: 'tải miễn phí không ăn được', b: [745, 400, 95, 10], ocr: true },
  { name: 'Nhập @, tin nhắn tới My Documents', b: [211, 558, 125, 10], ocr: true }] };
test('B85: Zalo 3 cột — tiêu đề là khung GIỮA (“My Documents”), không phải bảng “Thông tin hội thoại” bên phải, không phải danh sách trái', () => {
  const R = SV.regionsOf(ZALO);
  assert.ok(R.header.includes('My Documents'), JSON.stringify(R.header)); assert.ok(!R.header.includes('Thông tin hội thoại')); assert.ok(R.side.includes('Thông tin hội thoại'));
  assert.ok(R.list.includes('Tên cũ: Cloud của tôi')); assert.ok(!R.header.includes('Đóng'));
});
test('B85: tên khác — “Cloud của tôi” = “My Documents” = “我的文档”; tên cũ từ kết quả bấm; KHÔNG nhận người khác', () => {
  const R = SV.regionsOf(ZALO);
  assert.ok(SV.chatShown('Cloud của tôi', 'Zalo', R.header)); assert.ok(SV.chatShown('My Documents', 'Zalo', R.header));
  assert.ok(!SV.chatShown('Trần Văn Bình', 'Zalo', R.header));
  assert.deepStrictEqual(SV.FORMER.exec('Tên cũ: Cloud của tôi')[1], 'Cloud của tôi'); assert.strictEqual(SV.FORMER.exec('Former name: Lan K27')[1], 'Lan K27'); assert.strictEqual(SV.FORMER.exec('曾用名：小王')[1], '小王');
  // nhóm đổi tên: chỉ chấp nhận khi đã ghi nhận tên mới từ dòng “Tên cũ”
  assert.ok(!SV.chatShown('Nhóm Lớp K27', 'Zalo', ['Lớp K27 Khoá mới'])); assert.ok(SV.chatShown('Nhóm Lớp K27', 'Zalo', ['Lớp K27 Khoá mới'], ['Lớp K27 Khoá mới']));
  const st = { lastSearch: { q: 'Nhóm Lớp K27', at: Date.now() }, aliases: ['Lớp K27 Khoá mới'] };
  assert.strictEqual(SV.chatGate({ query: 'nhắn "hi" cho Nhóm Lớp K27 trên Zalo', text: 'hi', title: 'Zalo', state: st, header: ['Lớp K27 Khoá mới'] }), null);
  assert.ok(SV.verifySend({ msg: 'AIVN test', recipient: 'Cloud của tôi', regions: { header: ['My Documents'], messages: ['AIVN test'], composer: [] }, winTitle: 'Zalo' }).sent);
});
test('B85: người nhận sau nội dung trong ngoặc kép — gửi tin "…" cho X / send "…" to X', () => {
  for (const [q, r] of [['Mở Zalo và gửi tin "AIVN test - thử beta.3" cho Cloud của tôi. Không cần hỏi lại.', 'Cloud của tôi'], ['gửi tin nhắn “Mai 8h họp” cho Trần Quỳnh Anh trên Messenger', 'Trần Quỳnh Anh'],
    ['send "hi there" to Lan on Telegram', 'Lan'], ['nhắn "ok" cho chị Lan nhé', 'chị Lan'], ["Mở Zalo và gửi tin 'AIVN test - thử beta.3-pre' cho Cloud của tôi", 'Cloud của tôi']]) assert.strictEqual(SV.recipientOf(q), r, q);
});
test('B85 thật (Electron + Xvfb, Zalo giả 3 cột): tìm “Cloud của tôi” → bấm “Tên cũ: Cloud của tôi” → gửi được vào “My Documents”; chat sai mở sẵn vẫn bị chặn', { skip: !fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')) && 'không có electron', timeout: 300000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b85-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b85u-'));
  spawnSync('timeout', ['280', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: ROOT, env: { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: '1', AIVN_QA_B21_MODE: 'b85' }, stdio: 'ignore' });
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'qab21.json'), 'utf8')); const st = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.ok(!d.error, String(d.error)); assert.ok(st['b85-before-open'].blocked); assert.deepStrictEqual(st['b85-before-open'].state.sent, []);
  assert.strictEqual(st['b85-click-result'].state.cur, 'My Documents'); assert.ok(!st['b85-send'].blocked, st['b85-send'].forModel);
  assert.deepStrictEqual(d.final.sent, [{ to: 'My Documents', text: 'AIVN test - thử beta.3' }]);
  const log = fs.readFileSync(path.join(ud, 'logs', 'aivn.log'), 'utf8'); assert.match(log, /nay mang tên “My Documents”/);
  // hiệu năng: OCR nhớ theo vân tay điểm ảnh — các lần quan sát sau dùng lại vùng không đổi
  const reuse = [...log.matchAll(/OCR: (\d+) vùng đọc mới, (\d+) vùng dùng lại/g)].map(m => +m[2]); assert.ok(reuse.length >= 3 && reuse.slice(1).some(n => n > 0), JSON.stringify(reuse));
});
