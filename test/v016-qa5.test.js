// QA lượt 5 (21/10/2026): B32 câu tiếng Trung “không cần hỏi / hỏi trước”, B33 chữ tiếng Việt còn sót ở giao diện en/zh và bước của AIVN AGENT,
// B34 gõ vào ô Tìm kiếm Messenger bằng id cũ + câu chặn rõ ràng, “告诉 X 明天…” không có dấu câu
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'); const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SV = require('../src/agent/send-verify');
const AU = require('../src/agent/autonomy');
const CORE = require('../src/i18n/core');
const T = CORE.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });

test('B32: tiếng Trung “无需再问/不用问我/直接发” = tự làm; “发送前询问/先问再发/只写草稿不要发” = hỏi trước; “不要问我关于…” không phải lệnh', () => {
  for (const q of ['给 Trần Quỳnh Anh 发消息：明天开会，无需再问', '不用问我了，直接发吧', '告诉 Lê Văn Hùng 交作业，不必确认', '直接发送就行']) assert.ok(AU.standing(q), q);
  for (const q of ['给 Trần Quỳnh Anh 发消息，发送前询问我', '先问再发', '只写草稿，不要发', '别发，先给我看']) assert.ok(AU.askBeforeSend(q), q);
  assert.ok(!AU.standing('不要问我关于天气的问题'));
  for (const q of ['Message Anh about the meeting, ask me first', 'check with me before sending']) assert.ok(AU.askBeforeSend(q), q);
});

test('“告诉 X 明天…” không dấu câu: tên Latinh/tiếng Việt kết thúc ở chữ Hán đầu tiên', () => {
  assert.strictEqual(SV.recipientOf('告诉 Trần Quỳnh Anh 明天8点开会'), 'Trần Quỳnh Anh');
  assert.strictEqual(SV.recipientOf('提醒 Lê Văn Hùng 交作业'), 'Lê Văn Hùng');
  assert.strictEqual(SV.recipientOf('在 Messenger 上告诉 Nguyễn An 明天不上课'), 'Nguyễn An');
});

test('B33: mọi chữ động của AIVN AGENT (nhãn bước, tóm tắt, cảnh báo, thẻ duyệt, mẫu ghép câu) có bản en/zh và dịch trọn', () => {
  const keys = require('../src/i18n/strings-agent.json'); assert.ok(keys.length > 200);
  const cases = [
    ['bấm nút “Gửi”', 'click button “Send”', '点击按钮“发送”'],
    ['gõ “hi” vào ô đang chọn rồi bấm Enter', 'type “hi” into the focused field and press Enter', '在当前选中的输入框中输入“hi”并按 Enter'],
    ['cuộn xuống 5 nấc tại mục danh sách “Chats”', 'scroll down 5 notches at list item “Chats”', '在列表项“Chats”处向下滚动 5 格'],
    ['[e12] không phải ô Tìm kiếm — bấm ô Tìm kiếm rồi gõ', '[e12] is not the Search box — click the Search box, then type', null],
  ];
  for (const [vi, e, z] of cases) { assert.strictEqual(T.tr(vi, 'en'), e); if (z) assert.strictEqual(T.tr(vi, 'zh'), z); }
  // câu trả lời do code viết: dịch trọn, kể cả phần {0} có khoảng trắng đầu
  const AG = require('../src/agent/agent');
  for (const l of ['en', 'zh']) assert.ok(!CORE.VI.test(T.tr(AG.EMPTY_ANSWER(30), l)), l);
  assert.match(T.tr(AG.EMPTY_ANSWER(30), 'en'), /empty reply after 30 s/);
  // câu do mô hình viết bằng tiếng Việt không bị dịch nửa vời
  const src = rd('src/agent/agent.js'); assert.match(src, /then\(\(r\) => finishLang\(r, args\)\)/); assert.match(src, /r\.text = localizeText\(r\.text, lang\)/); // B57: dịch theo ngôn ngữ của người dùng (finishLang)
  // tiêu đề cột: mũi tên sắp xếp tách khỏi nhãn (để nhãn dịch được); ví dụ curl theo ngôn ngữ
  const app = rd('src/renderer/app.js'); assert.match(app, /<span>\$\{esc\(label\)\}<\/span>/); assert.match(app, /en: 'Hello!', zh: '你好！'/);
});

test('B33: thống kê cuối câu trả lời ghép bằng “ · ” từ các đoạn có bản dịch', () => {
  for (const s of ['3 bước dùng công cụ · 120 token · 4,5 giây', '1 bước dùng công cụ · 50 token · 2 giây · đã dừng']) for (const l of ['en', 'zh']) assert.ok(!CORE.VI.test(T.tr(s, l)), l + ': ' + T.tr(s, l));
});

const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
test('B34 thật (Messenger giả): bấm “Tìm kiếm trên Messenger” → gõ bằng id CŨ của “Nhóm Lớp K27” → chữ vào ô tìm kiếm (không vào nhóm) → bấm kết quả → gửi đúng “Trần Quỳnh Anh”', { skip: !hasX && 'cần xvfb-run + electron' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b34-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b34-ud-'));
  const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: '1', AIVN_QA_B21_MODE: 'k1' });
  const r = spawnSync('timeout', ['300', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: root, encoding: 'utf8', env });
  const f = path.join(dir, 'qab21.json'); assert.ok(fs.existsSync(f), 'QA B34 không chạy xong: ' + (r.stderr || '').slice(-800));
  const d = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!d.error, d.error);
  const by = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.ok(!by['k1-type-stale'].blocked, by['k1-type-stale'].forModel);
  assert.match(by['k1-type-stale'].forModel, /Đã bỏ id/);
  assert.ok(!by['k1-send'].blocked, by['k1-send'].forModel);
  assert.deepStrictEqual(d.final.sent, [{ to: 'Trần Quỳnh Anh', text: 'Mai 8h họp nhóm nhé' }]);
});

test('B34: câu chặn nói rõ phần tử không phải ô Tìm kiếm; bấm vào ô nhập = “Đã đặt con trỏ”, không bị tính là bước hỏng', () => {
  const s = rd('src/desktop-agent.js');
  assert.match(s, /KHÔNG phải ô Tìm kiếm/); assert.match(s, /không phải ô Tìm kiếm — bấm ô Tìm kiếm rồi gõ/); assert.match(s, /Đã đặt con trỏ vào ô/);
});
