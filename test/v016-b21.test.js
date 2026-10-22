'use strict';
// QA lượt 3 (21/10): B21 gửi tên người nhận vào chat SAI; B20 trùng tên kèm chú thích; B22 dung lượng tải; B23 “mạng tắt” ≠ cấm cửa sổ web;
// B24 chế độ chỉ soạn vẫn được tìm người nhận; B25 báo gửi nhầm, hết thời gian ≠ từ chối; B26 số luồng cho llama-server.
const test = require('node:test'); const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'); const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SV = require('../src/agent/send-verify');
const hasX = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
const Q = 'Nhắn tin cho Trần Quỳnh Anh trên Messenger: "Mai 8h họp nhóm nhé". Không cần hỏi lại.';

test('B21: tên người nhận chỉ được gõ vào ô tìm kiếm ĐÃ XÁC NHẬN — không bao giờ vào ô soạn tin của chat đang mở', () => {
  for (const text of ['Trần Quỳnh Anh', 'Tran Quynh Anh', 'Quỳnh Anh', 'trần quỳnh anh']) {
    assert.match(SV.chatGate({ query: Q, text, proc: 'Messenger', state: {}, header: ['Nhóm Lớp K27'] }), /CHƯA được xác nhận là ô Tìm kiếm/, text);
    assert.strictEqual(SV.chatGate({ query: Q, text, searchField: true, proc: 'Messenger', state: {} }), null, text);
  }
  // kể cả khi ĐÃ mở đúng người: gõ riêng cái tên vào ô soạn rồi Enter = gửi tên thành tin nhắn → chặn
  assert.match(SV.chatGate({ query: Q, text: 'Trần Quỳnh Anh', proc: 'Messenger', state: { chatOpen: SV.nameKey('Trần Quỳnh Anh') }, header: ['Trần Quỳnh Anh'] }), /KHÔNG gõ/);
  // tin nhắn thật có nhắc tên vẫn gõ được khi đã mở đúng người
  assert.strictEqual(SV.chatGate({ query: Q, text: 'Trần Quỳnh Anh ơi, mai 8h họp nhóm nhé', proc: 'Messenger', state: { chatOpen: SV.nameKey('Trần Quỳnh Anh') }, header: ['Trần Quỳnh Anh'] }), null);
});
test('B21: desktop-agent bấm vào cụm chữ OCR trước khi gõ (không gõ mù vào ô đang chọn); ô tìm kiếm chỉ “xác nhận” theo tên/gợi ý của chính ô hoặc thao tác ngay trước', () => {
  const src = rd('src/desktop-agent.js');
  assert.match(src, /!U\.inputLike\(t\.el\) && !t\.el\.ocr && !U\.isButtonish\(t\.el\)\) \{ t = null; needPoint = false; \}/);
  assert.match(src, /function searchConfirmed\(t, focusedEl, a\)/);
  assert.match(src, /if \(t && t\.el\) return named\(t\.el\);/);
  assert.match(src, /const searchField = searchConfirmed\(t, focusedEl, a\);/);
  assert.doesNotMatch(SV.chatGate.toString(), /typingName\(text, recipient\)\) return null/);
});
test('B20: chú thích trong ngoặc (SV K26)/(Cựu SV) = người khác trùng tên; danh xưng có trong tiêu đề thì khớp', () => {
  assert.strictEqual(SV.verifySend({ msg: 'Nộp bài', recipient: 'thầy Lê Văn Hùng', winTitle: 'Trò chuyện | Lê Văn Hùng (SV K26) | Microsoft Teams', regions: { header: [], messages: ['Nộp bài'], composer: [] } }).sent, false);
  assert.strictEqual(SV.verifySend({ msg: 'Chào', recipient: 'Trần Quỳnh Anh', winTitle: 'Thư - Trần Quỳnh Anh (Cựu SV) - Outlook', regions: { header: [], messages: ['Chào'], composer: [] } }).sent, false);
  assert.strictEqual(SV.headerMatches('thầy Lê Văn Hùng', 'Lê Văn Hùng (SV K26)'), false);
  assert.strictEqual(SV.headerMatches('thầy Lê Văn Hùng', 'Thầy Lê Văn Hùng (Khoa CNTT)'), true);
  assert.strictEqual(SV.headerMatches('Lê Văn Hùng (SV K26)', 'Lê Văn Hùng (SV K26)'), true, 'người dùng nêu đúng chú thích');
  assert.strictEqual(SV.headerMatches('Trần Quỳnh Anh', 'Trần Quỳnh Anh'), true);
  assert.strictEqual(SV.headerMatches('Trần Quỳnh Anh', 'Lê Quỳnh Anh'), false);
});
test('B20 / quyết định 1: hai người cùng họ tên → hỏi người dùng (danh sách ứng viên), dòng tin có nhắc tên không tính', () => {
  assert.deepStrictEqual(SV.sameNameCandidates('Lê Văn Hùng', ['Lê Văn Hùng', 'Lê Văn Hùng (SV K26)', 'Lê Văn Hùng: mai họp nhé', 'Lê Văn Hưng']), ['Lê Văn Hùng', 'Lê Văn Hùng (SV K26)']);
  assert.match(rd('src/desktop-agent.js'), /có NHIỀU người cùng tên “\$\{rcpQ\}”.*HỎI người dùng muốn nhắn cho người nào/);
});
test('B25: tin đã rời ô soạn và hiện ở chat khác → báo GỬI NHẦM (không phải “chưa có tác dụng”); agent luôn báo người dùng', () => {
  const v = SV.verifySend({ msg: 'Trần Quỳnh Anh', recipient: 'Trần Quỳnh Anh', winTitle: 'Nhóm Lớp K27 | Messenger', regions: { header: ['Nhóm Lớp K27'], messages: ['Trần Quỳnh Anh'], composer: [''] } });
  assert.strictEqual(v.sent, false); assert.strictEqual(v.wrongChat, true); assert.strictEqual(v.wrongTo, 'Nhóm Lớp K27'); assert.match(v.why, /ĐÃ được gửi vào cuộc trò chuyện “Nhóm Lớp K27”/);
  const still = SV.verifySend({ msg: 'Mai họp', recipient: 'Trần Quỳnh Anh', winTitle: 'Nhóm Lớp K27 | Messenger', regions: { header: ['Nhóm Lớp K27'], messages: [], composer: ['Mai họp'] } });
  assert.strictEqual(still.wrongChat, false, 'tin còn trong ô soạn → chưa gửi đi đâu');
  const a = rd('src/agent/agent.js'); assert.match(a, /Tin nhắn đã bị GỬI NHẦM/); assert.match(rd('src/desktop-agent.js'), /⚠ GỬI NHẦM: \$\{verify\.why\}/);
});
test('B25: hết thời gian chờ thẻ duyệt ≠ người dùng từ chối (màn hình, thẻ công cụ, hộp xác nhận xoá/ghi đè)', () => {
  const d = rd('src/desktop-agent.js'); assert.match(d, /resolve\(\{ ok: false, timeout: true, reason: '' \}\)/); assert.match(d, /Người dùng KHÔNG từ chối/);
  const a = rd('src/agent/agent.js'); assert.match(a, /if \(ans && ans\.timeout\) refusedOut/); assert.match(a, /if \(ok === null\) return \{ refused: true, timeout: true/);
  const m = rd('src/main.js'); assert.match(m, /resolve\(\{ ok: false, reason: '', timeout: true \}\)/); assert.match(m, /resolve\(null\); \}, 5 \* 60e3\)/);
});
test('B23: “truy cập mạng tắt” chỉ áp dụng web_search/fetch_url; vẫn thao tác cửa sổ Gmail/Docs đang mở; ưu tiên cửa sổ đang mở thay vì outlook.live.com', async () => {
  const a = rd('src/agent/agent.js');
  assert.doesNotMatch(a, /Bạn không tìm kiếm hay mở trang web được/);
  assert.match(a, /ĐANG TẮT \(CHỈ ba công cụ này\)\. Bạn VẪN thao tác các cửa sổ đang mở \(Gmail, Docs, Outlook/); assert.match(a, /đừng mở outlook\.live\.com khi đã có cửa sổ Outlook/);
  const { createComputerTools } = require('../src/agent/computer-tools');
  let opened = null, focused = null;
  const ct = createComputerTools({ getSettings: () => ({ agentComputer: true }), openExternal: async (u) => { opened = u; }, listWindows: async () => [{ hwnd: 7, title: 'Thư - Hộp thư đến - Outlook', proc: 'chrome' }, { hwnd: 8, title: 'AIVN', proc: 'aivn' }], focusWindow: async (w) => { focused = w.hwnd; }, log: () => {} });
  const r = await ct.exec('open_url', { url: 'https://outlook.live.com/mail/' }, {});
  assert.strictEqual(opened, null, 'không mở trang mới'); assert.strictEqual(focused, 7); assert.match(r.forModel, /ĐÃ có cửa sổ đang mở/);
  const r2 = await ct.exec('open_app', { name: 'Outlook' }, {}); assert.match(r2.forModel, /ĐÃ có cửa sổ đang mở: “Thư - Hộp thư đến - Outlook”/);
  // B29 (QA lượt 4, quyết định của Khôi): truy cập mạng TẮT → open_url bị chặn, báo rõ; BẬT → mở bình thường
  const r3 = await ct.exec('open_url', { url: 'https://vanlanguni.edu.vn' }, {}); assert.strictEqual(opened, null, 'mạng tắt: không mở trang'); assert.ok(r3.refused); assert.match(r3.forModel, /Cho phép truy cập mạng” đang TẮT/);
  const ct2 = createComputerTools({ getSettings: () => ({ agentComputer: true, agentWeb: true }), openExternal: async (u) => { opened = u; }, listWindows: async () => [], log: () => {} });
  await ct2.exec('open_url', { url: 'https://vanlanguni.edu.vn' }, {}); assert.strictEqual(opened, 'https://vanlanguni.edu.vn/', 'mạng bật: trang khác vẫn mở bình thường');
});
test('B22: dung lượng tải ở cổng AIVN AGENT gồm cả tệp thị giác (khớp thẻ Khám phá)', () => {
  const m = rd('src/main.js'); assert.match(m, /dlSize: \(c\.size \|\| 0\) \+ \(c\.mmproj && c\.mmproj\.size \|\| 0\)/); assert.match(m, /size: x\.dlSize \|\| x\.size/);
});
test('B26: số luồng / lô của từng mô hình truyền cho llama-server (mô hình nhìn ảnh và mắt nhìn)', () => {
  assert.match(rd('src/vision-server.js'), /args\.push\('-t', String\(Math\.round\(threads\)\), '-tb'/);
  assert.match(rd('src/engine.js'), /gpu: !!\(l && l\.gpu\), \.\.\.vx, \.\.\.extra \}/); assert.match(rd('src/engine.js'), /gpu: false, \.\.\.vx/);
  assert.match(rd('src/engine-host.js'), /threads: gopts\.threads, batchSize: gopts\.batchSize/);
  assert.match(rd('src/main.js'), /const gth = gml\.threads \|\| gpf\.threads/);
});

// ---- Hành vi thật: Messenger giả (Electron + xvfb), chat SAI đang mở sẵn, ô soạn đang chọn ----
function runQa(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b21-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b21-ud-'));
  const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: mode === 'draft' ? 'safe' : '1', AIVN_QA_B21_MODE: mode });
  const r = spawnSync('timeout', ['300', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: root, encoding: 'utf8', env });
  const f = path.join(dir, 'qab21.json'); assert.ok(fs.existsSync(f), 'QA B21 không chạy xong: ' + (r.stderr || '').slice(-800));
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
test('B21 thật (tự làm không hỏi): lời gọi sai của lượt h1 không gửi gì vào “Nhóm Lớp K27”; cách đúng gửi đúng người', { skip: !hasX && 'cần xvfb-run + electron', timeout: 360000 }, () => {
  const d = runQa('auto'); assert.ok(!d.error, d.error);
  const by = Object.fromEntries(d.steps.map(s => [s.name, s]));
  for (const n of ['h1-element-name', 'h1-element-name-2', 'focused-composer-name', 'message-before-open']) { assert.ok(by[n].blocked, n + ' phải bị chặn'); assert.deepStrictEqual(by[n].state.sent, [], n); }
  assert.deepStrictEqual(d.afterBad.sent, [], 'không có tin nào bị gửi vào chat sai');
  assert.deepStrictEqual(by['type-search'].state.searches, ['Trần Quỳnh Anh'], 'tên được gõ vào ô TÌM KIẾM');
  assert.strictEqual(by['click-result'].state.cur, 'Trần Quỳnh Anh');
  assert.deepStrictEqual(d.final.sent, [{ to: 'Trần Quỳnh Anh', text: 'Mai 8h họp nhóm nhé' }]);
});
test('B24 thật (chỉ soạn, đừng gửi): gõ tên + Enter ở ô tìm kiếm KHÔNG là bước rủi ro và được làm; tin thật vẫn bị chặn gửi', { skip: !hasX && 'cần xvfb-run + electron', timeout: 360000 }, () => {
  const d = runQa('draft'); assert.ok(!d.error, d.error);
  const by = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.ok(by['type-search'].asks.every(a => a.risk === null), 'tìm người nhận không phải bước gửi'); assert.deepStrictEqual(by['type-search'].state.searches, ['Trần Quỳnh Anh']);
  assert.strictEqual(by['click-result'].state.cur, 'Trần Quỳnh Anh');
  assert.ok(by['send-message'].asks.some(a => a.risk), 'gửi tin thật vẫn là bước rủi ro'); assert.deepStrictEqual(d.final.sent, [], 'chế độ chỉ soạn: không gửi gì');
});
