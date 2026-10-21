'use strict';
// QA lượt 6 (21/10, pass-6-20261021-1243): B36 người nhận với “nói với/bảo/tell/let … know/告诉”, B47 “nhắn giúp/hộ”, B48 danh xưng sau tên,
// B55 id phần tử ổn định giữa các lần quan sát + không gõ vào nút, B49 dừng thật khi công cụ yêu cầu dừng.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const SV = require('../src/agent/send-verify');
const U = require('../src/agent/uitree');
const root = path.join(__dirname, '..'); const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('B36: đọc được người nhận với “nói với / bảo / dặn / tell / let … know / ask / 告诉”', () => {
  const cases = {
    'nói với Lê Văn Hùng là mai em nghỉ': 'Lê Văn Hùng',
    'bảo Lê Văn Hùng là mai em nghỉ': 'Lê Văn Hùng',
    'Trên Messenger đang mở, nói với Trần Quỳnh Anh là mai 8h họp nhóm nhé. Không cần hỏi lại.': 'Trần Quỳnh Anh',
    'dặn Trần Quỳnh Anh là nhớ mang laptop': 'Trần Quỳnh Anh',
    'Tell Le Van Hung I will be late': 'Le Van Hung',
    'Let Le Van Hung know I will be late': 'Le Van Hung',
    'tell Tran Quynh Anh that the meeting moved': 'Tran Quynh Anh',
    'Ask Tran Quynh Anh to send slides': 'Tran Quynh Anh',
    '在 Zalo 上告诉 Trần Quỳnh Anh 明天8点开会': 'Trần Quỳnh Anh',
  };
  for (const [q, want] of Object.entries(cases)) assert.strictEqual(SV.recipientOf(q), want, q);
  assert.strictEqual(SV.recipientOf('Tell me a joke'), null);
});

test('B47/B48: “nhắn giúp/hộ/giùm X” bỏ giúp/hộ; danh xưng sau tên (老师/先生/teacher/sir) không thuộc tên', () => {
  for (const v of ['giúp', 'hộ', 'giùm']) assert.strictEqual(SV.recipientOf(`nhắn ${v} Lê Văn Hùng là mai em nghỉ`), 'Lê Văn Hùng', v);
  assert.strictEqual(SV.recipientOf('nhắn tin giúp mình cho Lê Văn Hùng là mai em nghỉ'), 'Lê Văn Hùng');
  assert.strictEqual(SV.recipientOf('在已打开的 Microsoft Teams 上给 Lê Văn Hùng 老师发消息：明天请假'), 'Lê Văn Hùng');
  assert.strictEqual(SV.nameKey('Lê Văn Hùng 老师'), 'le van hung');
  assert.strictEqual(SV.nameKey('Le Van Hung teacher'), 'le van hung');
  assert.strictEqual(SV.nameKey('王老师'), '王老师'); // QA lượt 7 (B59): chỉ còn họ → giữ danh xưng (“王” sẽ khớp mọi người họ Vương)
});

test('B36: ứng dụng chat — chưa có người nhận đã kiểm chứng thì KHÔNG gõ + Enter vào ô soạn, bất kể động từ', () => {
  const base = { title: 'Messenger - Nhóm Lớp K27', proc: 'messenger', state: {}, header: ['Nhóm Lớp K27'] };
  // tái hiện QA: nói với X là… trong khi Nhóm Lớp K27 đang mở
  assert.match(SV.chatGate({ ...base, query: 'nói với Lê Văn Hùng là mai em nghỉ', text: 'mai em nghỉ', submit: true }) || '', /TÌM và MỞ/);
  // không đọc được người nhận → hỏi người dùng (kể cả không có chữ “nhắn/gửi”)
  assert.match(SV.chatGate({ ...base, query: 'Trên Messenger, chúc mọi người ngủ ngon', text: 'ngủ ngon', submit: true }) || '', /HỎI người dùng/);
  // gõ vào ô tìm kiếm đã xác nhận: cho qua
  assert.strictEqual(SV.chatGate({ ...base, query: 'nói với Lê Văn Hùng là mai em nghỉ', text: 'Lê Văn Hùng', searchField: true, submit: true }), null);
  // đúng người trong tiêu đề cửa sổ: cho gõ
  assert.strictEqual(SV.chatGate({ ...base, title: 'Messenger - Lê Văn Hùng', header: ['Lê Văn Hùng'], query: 'nói với Lê Văn Hùng là mai em nghỉ', text: 'mai em nghỉ', submit: true }), null);
});

test('B36: tin rời ô soạn khi không rõ người nhận → báo ĐÃ gửi vào cuộc trò chuyện đang mở (không phải “chưa có tác dụng”)', () => {
  const v = SV.verifySend({ msg: 'mai 8h họp nhóm nhé.', recipient: null, regions: { header: ['Nhóm Lớp K27'], messages: ['mai 8h họp nhóm nhé.'], composer: [] }, winTitle: 'Messenger - Nhóm Lớp K27' });
  assert.strictEqual(v.sent, false); assert.strictEqual(v.wrongChat, true); assert.strictEqual(v.wrongTo, 'Nhóm Lớp K27'); assert.match(v.why, /ĐÃ được gửi vào cuộc trò chuyện đang mở “Nhóm Lớp K27”/);
  const w = SV.verifySend({ msg: 'mai em nghỉ', recipient: 'Lê Văn Hùng', regions: { header: ['Nhóm Lớp K27'], messages: ['mai em nghỉ'], composer: [] }, winTitle: 'Messenger - Nhóm Lớp K27' });
  assert.strictEqual(w.wrongChat, true); assert.match(w.why, /KHÔNG phải “Lê Văn Hùng”/);
});

test('B49: kết quả công cụ có stop / gửi nhầm → vòng lặp dừng thật, trả lời trung thực', () => {
  const s = rd('src/agent/agent.js');
  assert.match(s, /out\.stop \|\| \(out\.verify && out\.verify\.wrongChat\)/);
  assert.match(s, /if \(hardStop\)/);
});

const el = (role, name, x, y, w = 80, h = 24, extra = {}) => ({ r: role, n: name, b: [x, y, w, h], ...extra });
test('B55: id eN giữ nguyên giữa các lần quan sát (khoá vai trò + nhãn + vị trí); phần tử mới nhận id mới, không lấy lại id cũ', () => {
  const reg = {};
  const o1 = U.normalize({ win: null, els: [el('Edit', 'Đến', 100, 100), el('Edit', 'Tiêu đề', 100, 140), el('Button', 'Gửi', 100, 400)] });
  U.stabilizeIds(o1.elements, reg);
  const id = (o, n) => o.elements.find(e => e.name === n).id;
  const tieuDe = id(o1, 'Tiêu đề'), gui = id(o1, 'Gửi');
  // lần 2: thêm nút “Gửi | Huỷ thư” ở trên cùng (trước đây làm mọi id bị đánh số lại)
  const o2 = U.normalize({ win: null, els: [el('SplitButton', 'Gửi | Huỷ thư', 100, 20), el('Edit', 'Đến', 100, 100), el('Edit', 'Tiêu đề', 102, 141), el('Button', 'Gửi', 100, 400)] });
  U.stabilizeIds(o2.elements, reg);
  assert.strictEqual(id(o2, 'Tiêu đề'), tieuDe); assert.strictEqual(id(o2, 'Gửi'), gui);
  const nu = id(o2, 'Gửi | Huỷ thư'); assert.ok(![tieuDe, gui, id(o1, 'Đến')].includes(nu), nu);
  assert.strictEqual(new Set(o2.elements.map(e => e.id)).size, o2.elements.length, 'không trùng id');
  assert.ok(U.isButtonish(o2.elements.find(e => e.name === 'Gửi | Huỷ thư')));
  assert.ok(!U.isButtonish(o2.elements.find(e => e.name === 'Tiêu đề')));
});

test('B55: desktop-agent từ chối id đổi nhãn / id đã biến mất / gõ chữ vào nút; bấm vào ô nhập = “Đã đặt con trỏ”', () => {
  const s = rd('src/desktop-agent.js');
  assert.match(s, /U\.stabilizeIds\(obs\.elements, s\.idReg\)/);
  assert.match(s, /giờ là \$\{L\.now\.kind/); assert.match(s, /không còn trên màn hình/); assert.match(s, /không gõ chữ vào nút\/nhóm nút/);
  assert.match(s, /Đã đặt con trỏ vào ô nhập/); assert.match(s, /đây là ĐÃ có tác dụng/);
});

test('B57: AGENT trả lời theo ngôn ngữ câu lệnh / giao diện; câu trả lời tiếng Việt được dịch khi người dùng dùng zh/en', async () => {
  const { createAgent } = require('../src/agent/agent');
  let ui = 'zh'; const calls = [];
  const engine = { status: () => ({ loaded: true, id: 'x', contextSize: 16384 }), countTokens: (x) => Math.ceil(String(x).length / 3),
    chatStep: async (msgs, o) => { calls.push({ msgs, o }); if (/Dịch văn bản/.test(msgs[0].content)) return { text: '我还没有完成：添加文件的步骤没有生效。', toolCalls: [] }; return { text: 'Mình chưa làm được việc này: bước “Thêm tệp” chưa có tác dụng. Mình sẽ thử lại sau.', toolCalls: [] }; } };
  const ag = createAgent({ engine, getSettings: () => ({ uiLang: ui, agentComputer: false, agentScreen: false, agentMemory: false }), memory: { count: () => 0 }, scheduler: {}, extractFile: async () => ({}), embedForMemory: async () => ({}) });
  assert.strictEqual(ag.replyLang('在已打开的 Google Classroom 中打开作业', 'vi'), 'zh');
  assert.strictEqual(ag.replyLang('Tell Le Van Hung I will be late', 'vi'), 'en');
  assert.strictEqual(ag.replyLang('nói với Lê Văn Hùng là mai em nghỉ', 'vi'), 'vi');
  assert.strictEqual(ag.replyLang('mở Zalo', 'zh'), 'zh');
  const r = await ag.run({ messages: [{ role: 'user', content: '你好，今天几号？' }] });
  assert.match(r.text, /[\u4e00-\u9fff]/); assert.strictEqual(r.lang, 'zh');
  assert.match(calls[0].msgs[0].content, /Luôn trả lời bằng/);
});

test('B56: chữ trắng trên nút màu (“✉ Thư mới”, “Gửi”) đọc được bằng lượt OCR khối màu đảo màu', { skip: process.platform !== 'linux' ? 'cần xvfb' : false, timeout: 120000 }, () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync('xvfb-run', ['-a', path.join(root, 'node_modules/.bin/electron'), path.join(root, 'test/fixtures/b56-ocr.js'), '--no-sandbox'], { cwd: root, encoding: 'utf8', timeout: 110000 });
  const m = /B56RESULT (.*)/.exec(r.stdout || ''); assert.ok(m, (r.stderr || '').slice(-500));
  const d = JSON.parse(m[1]); const all = d.boosted.join(' | ');
  assert.match(all, /Thư mới/); assert.match(all, /Gửi/);
  assert.ok(!d.plain.some(x => /Thư mới/.test(x)), 'OCR thường vốn bỏ sót (nếu không còn bỏ sót thì vẫn tốt, nhưng bài này để chứng minh)');
});

test('B56: truy vấn khớp đa ngôn ngữ (New mail ≈ Thư mới ≈ 新邮件, Subject ≈ Tiêu đề)', () => {
  const els = U.normalize({ els: [{ r: 'Button', n: 'Thư mới', b: [1, 1, 50, 20] }, { r: 'Edit', n: 'Tiêu đề', b: [1, 40, 50, 20] }] }).elements;
  assert.strictEqual(U.findElementAny(els, 'New mail').name, 'Thư mới');
  assert.strictEqual(U.findElementAny(els, '新邮件').name, 'Thư mới');
  assert.strictEqual(U.findElementAny(els, 'Subject').name, 'Tiêu đề');
  assert.strictEqual(U.findElementAny(els, 'Reply'), null);
});
