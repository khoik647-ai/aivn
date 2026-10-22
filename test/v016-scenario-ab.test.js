'use strict';
// Kịch bản A (Chrome: tìm → mở kết quả đầu → trả lời kèm URL nguồn THẬT) và B (Google Docs “QA nháp”: thay tất cả; màn hình đăng nhập → dừng và hỏi)
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const AG = require('../src/agent/agent'); const EA = require('../src/agent/ensure-app'); const FB = require('../src/agent-bench-full'); const SG = require('../src/agent/send-gate');
const ROOT = path.join(__dirname, '..');
const QA = "mở Chrome, tìm 'giá vàng SJC hôm nay', mở kết quả đầu tiên và cho mình biết giá mua vào, kèm đường dẫn nguồn";
const QB = "trong Google Docs 'QA nháp', thay tất cả 'ngày mai' bằng 'thứ Hai', không cần hỏi lại";
test('A/B: cả hai kịch bản chạy ensure_app đúng ứng dụng trước (B: nơi làm nêu trước động từ)', () => {
  assert.strictEqual(AG.openIntent(QA).name, 'Chrome');
  assert.ok(AG.isAppTask(QB)); assert.strictEqual(AG.appOf(QB), 'Google Docs');
  assert.ok(AG.isAppTask('In Google Docs "QA draft", replace every "tomorrow" with "Monday"'));
  for (const q of ['trong Excel, cách tạo bảng là gì?', 'trong Word có những phông nào']) assert.ok(!AG.isAppTask(q), q);
});
const OBS_TREE = [{ role: 'tool', content: '[e3] ô nhập "Address and search bar" = "google.com/search?q=gia+vang" @300,50\n[e8] liên kết "Giá vàng SJC hôm nay" @200,300' }, { role: 'tool', content: '[e3] ô nhập "Address and search bar" = "sjc.com.vn/gia-vang-online" @300,50\n[e9] chữ "118.500" @300,400' }];
const OBS_OCR = [{ role: 'tool', content: '[e7] chữ (OCR) "google.com/search?q=gia" @219,118\n[e12] chữ (OCR) "vnexpress.net/chu-de/gia-vang-1403" @150,330' }, { role: 'tool', content: '[e17] chữ (OCR) "m sjc.com.vn/gia-vang-online" @144,118\n[e24] chữ (OCR) "118.500" @259,385' }];
test('A: URL nguồn lấy từ thanh địa chỉ THẬT (cây giao diện hoặc OCR trên cùng), không lấy trang kết quả tìm kiếm', () => {
  assert.deepStrictEqual(AG.seenUrls(OBS_TREE), ['sjc.com.vn/gia-vang-online', 'google.com/search?q=gia+vang']);
  assert.deepStrictEqual(AG.seenUrls(OBS_OCR), ['sjc.com.vn/gia-vang-online', 'google.com/search?q=gia']);
  assert.strictEqual(AG.withSource('Giá mua vào là 118.500 nghìn đồng/lượng.', QA, OBS_OCR), 'Giá mua vào là 118.500 nghìn đồng/lượng.\n\nNguồn: https://sjc.com.vn/gia-vang-online');
  const ok = 'Giá 118.500 (nguồn: https://sjc.com.vn/gia-vang-online).'; assert.strictEqual(AG.withSource(ok, QA, OBS_TREE), ok);
  assert.match(AG.withSource('Giá 118.500, nguồn https://giavang.example.vn/sjc', QA, OBS_TREE), /\n\nNguồn \(đường dẫn thật trên thanh địa chỉ\): https:\/\/sjc\.com\.vn\/gia-vang-online$/);
  assert.match(AG.withSource('Giá 118.500', QA, OBS_OCR.slice(0, 1)), /chưa đọc được đường dẫn/); // chỉ thấy trang tìm kiếm → nói thật
  for (const q of ['nhắn Zalo cho Lan kèm link sjc', 'mở Chrome vào youtube', 'tìm giá vàng trên Chrome']) assert.strictEqual(AG.withSource('x', q, OBS_TREE), 'x', q);
  for (const q of ['tìm trên Chrome giá xăng, cho mình đường dẫn', 'Open Chrome, search the gold price and tell me the buy price with the source URL', '打开 Chrome 搜索金价，附上来源']) assert.notStrictEqual(AG.withSource('x', q, OBS_TREE), 'x', q);
  const C = require('../src/i18n/core'); const T = C.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
  assert.strictEqual(T.tr('Nguồn: https://sjc.com.vn/gia-vang-online', 'en'), 'Source: https://sjc.com.vn/gia-vang-online');
});
test('B: màn hình đăng nhập nhận ra được + câu hỏi dịch được; chốt gửi coi Enter ở thanh địa chỉ (việc không nhắn tin) là TÌM', () => {
  assert.ok(EA.loginWall('Đăng nhập – Tài khoản Google - Google Chrome | AIVN Bench', ''));
  assert.ok(!EA.loginWall('Giá vàng SJC hôm nay | SJC - Google Chrome', 'Đăng nhập'));
  const C = require('../src/i18n/core'); const T = C.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
  assert.match(T.tr(EA.loginAsk('Google Docs', 'tiêu đề cửa sổ'), 'en'), /^Google Docs is showing a sign-in screen \(window title\)\. I don't sign in on my own/);
  assert.deepStrictEqual(SG.classify('type_text', { text: 'giá vàng SJC', submit: true }, { searchTarget: true, chatOpen: false, recipient: null, messaging: false }).send, false);
  const da = fs.readFileSync(path.join(ROOT, 'src/desktop-agent.js'), 'utf8');
  assert.match(da, /const ADDRY = \/address\|địa chỉ/); assert.match(da, /browserWin && \/\^\(\?:\(\?:ctrl\|cmd\|command\|meta\)\\\+\[lt\]\|alt\\\+d\|f6\)\$\/i/); // B114: Ctrl+T (tab mới) cũng là thanh địa chỉ
  assert.match(da, /const searchNotSend = action === 'type_text' && !gate\.send && !!gate\.why;/);
});
test('bộ đo: thêm 3 việc trình duyệt giả (A, B, B đăng nhập) — chấm theo trạng thái trang và câu trả lời', () => {
  const ids = FB.CHAT_TASKS.map(t => t.id); for (const k of ['fake_chrome_source', 'fake_docs_replace', 'fake_docs_login']) assert.ok(ids.includes(k), k);
  const A = FB.CHAT_TASKS.find(t => t.id === 'fake_chrome_source'); assert.strictEqual(A.page, 'bench-web.html');
  assert.ok(A.check({ visited: ['sjc.com.vn/gia-vang-online'] }, { reply: 'Mua vào 118.500 — Nguồn: https://sjc.com.vn/gia-vang-online' }));
  assert.ok(!A.check({ visited: ['sjc.com.vn/gia-vang-online'] }, { reply: 'Mua vào 118.500' }));
  const L = FB.CHAT_TASKS.find(t => t.id === 'fake_docs_login'); assert.ok(L.check({ typedOnLogin: [] }, { outcome: 'asked_user' })); assert.ok(L.wrong({ typedOnLogin: ['khoi@'] }));
});
const hasX = fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')) && spawnSync('which', ['xvfb-run']).status === 0;
test('A/B thật (Electron + Xvfb, trình duyệt GIẢ, công cụ thật của desktop-agent, không mô hình)', { skip: !hasX && 'cần xvfb + electron', timeout: 300e3 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-ab-')); const ud = path.join(dir, 'ud'); fs.mkdirSync(ud, { recursive: true });
  spawnSync('timeout', ['280', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: ROOT, env: { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_QA_B21_MODE: 'ab', AIVN_DESK_AUTO: '1', OMP_NUM_THREADS: '4' }, stdio: 'ignore' });
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'qab21.json'), 'utf8')); assert.ok(!o.error, o.error);
  const st = (n) => o.steps.find(s => s.name === n);
  // A: Enter ở thanh địa chỉ là tìm — không bị coi là gửi tin (không kiểm chứng “gửi”, không “GỬI NHẦM”, không dừng)
  const ty = st('a-type-query'); assert.ok(ty.ok && !ty.stop, ty.summary); assert.ok(!/GỬI NHẦM|CHƯA kiểm chứng/.test(ty.forModel + ty.summary), ty.forModel);
  assert.strictEqual(st('a-click-first').state.url, 'sjc.com.vn/gia-vang-online');
  assert.strictEqual(o.answerA, 'Giá vàng SJC mua vào hôm nay là 118.500 nghìn đồng/lượng.\n\nNguồn: https://sjc.com.vn/gia-vang-online');
  assert.match(o.answerAwrong, /Nguồn \(đường dẫn thật trên thanh địa chỉ\): https:\/\/sjc\.com\.vn\/gia-vang-online$/);
  // B118: thanh địa chỉ đọc nguyên văn (chép), chữ trang đọc được, bộ nhớ tạm trả lại; link sai href được sửa theo nguồn
  assert.ok(o.pageRead && !o.pageRead.error, JSON.stringify(o.pageRead)); assert.strictEqual(o.pageRead.url.replace(/^https?:\/\//, ''), 'sjc.com.vn/gia-vang-online');
  assert.match(o.pageRead.text, /118[.,]500/, 'chữ trang (DOM) có giá'); assert.strictEqual(o.clipAfter, 'AIVN-clip-giu-nguyen');
  assert.ok(/\[(https?:\/\/)?sjc\.com\.vn\/gia-vang-online\]\((https?:\/\/)?sjc\.com\.vn\/gia-vang-online\)/.test(o.answerAgrounded), o.answerAgrounded);
  // B114: Chrome ở YouTube, con trỏ trong ô tìm kiếm CỦA TRANG → mở tab mới (Ctrl+T), tìm ở thanh địa chỉ; ô của YouTube không bị gõ
  const yt = st('y-type-page-box'); assert.ok(yt.ok, yt.summary);
  assert.ok((yt.state.newTab || 0) >= 1, 'đã mở tab mới: ' + JSON.stringify(yt.state)); assert.strictEqual(yt.state.siteSearch || '', '', 'không gõ vào ô tìm kiếm của YouTube');
  assert.ok(yt.state.searches.includes('thời tiết TP.HCM hôm nay'), JSON.stringify(yt.state.searches));
  // B': màn hình đăng nhập → dừng + hỏi, không gõ gì
  const lg = st('b-login-look'); assert.strictEqual(lg.code, 'login'); assert.ok(lg.stop); assert.match(lg.ask, /đang ở màn hình đăng nhập/); assert.deepStrictEqual(lg.state.typedOnLogin, []);
  // B: thay đủ 3 chỗ, phần còn lại của tài liệu giữ nguyên
  assert.deepStrictEqual(o.final.replaced, [{ find: 'ngày mai', rep: 'thứ Hai', n: 3 }]);
  assert.strictEqual(o.final.doc, 'Biên bản họp nhóm AIVN\nthứ Hai cả nhóm gặp nhau lúc 9 giờ ở phòng B.204.\nNhớ mang laptop; thứ Hai thầy Hùng sẽ xem bản demo.\nHạn nộp báo cáo: thứ Hai.');
});
