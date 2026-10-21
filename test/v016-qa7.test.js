'use strict';
// QA lượt 7 (pass-7-20261021-1445): B60 id ≥ e10 bị đọc nhầm (e10 → e1 + “0”), B58 danh xưng có dấu chấm, B59 cổng an toàn quá chặt.
const test = require('node:test'); const assert = require('node:assert');
const U = require('../src/agent/uitree');

test('B60: id phần tử ≥ e10 không bị quay lui thành e1/e2 + nhãn', () => {
  assert.deepStrictEqual(U.parseIdRef('e10'), { id: 'e10', label: null });
  assert.deepStrictEqual(U.parseIdRef('e22'), { id: 'e22', label: null });
  assert.deepStrictEqual(U.parseIdRef('[e12]'), { id: 'e12', label: null });
  assert.deepStrictEqual(U.parseIdRef('E7'), { id: 'e7', label: null });
  assert.deepStrictEqual(U.parseIdRef('e10 Trần Quỳnh Anh'), { id: 'e10', label: 'Trần Quỳnh Anh' });
  assert.deepStrictEqual(U.parseIdRef('e3: "Send"'), { id: 'e3', label: 'Send' });
  assert.deepStrictEqual(U.parseIdRef('[e11] (Tiêu đề)'), { id: 'e11', label: 'Tiêu đề' });
  assert.deepStrictEqual(U.parseIdRef('e4 – “Lưu nháp”'), { id: 'e4', label: 'Lưu nháp' });
  assert.strictEqual(U.parseIdRef('Trần Quỳnh Anh'), null);
  assert.strictEqual(U.parseIdRef('email'), null);
  assert.ok(U.isIdRef('e10') && U.isIdRef('[e12]') && !U.isIdRef('e10 Trần Quỳnh Anh') && !U.isIdRef('Gửi'));
});

test('B60: bấm e10 / e22 / [e12] chọn đúng phần tử, không phải e1/e2 (kể cả khi nhãn e2 có chữ “2”)', () => {
  const els = [
    { id: 'e1', kind: 'nút', name: 'Đoạn chat', b: [0, 0, 10, 10] },
    { id: 'e2', kind: 'mục danh sách', name: 'Nhóm Lớp K27 2', b: [0, 20, 10, 10] },
    { id: 'e10', kind: 'mục danh sách', name: 'Trần Quỳnh Anh', b: [0, 40, 10, 10] },
    { id: 'e12', kind: 'ô nhập', name: 'Aa', b: [0, 60, 10, 10] },
    { id: 'e22', kind: 'nút', name: 'Gửi', b: [0, 80, 10, 10] },
    { id: 'e3', kind: 'nút', name: 'Send', b: [0, 100, 10, 10] },
  ];
  assert.strictEqual(U.resolveIdRef(els, 'e10').el.id, 'e10');
  assert.strictEqual(U.resolveIdRef(els, 'e22').el.id, 'e22');
  assert.strictEqual(U.resolveIdRef(els, '[e12]').el.id, 'e12');
  assert.strictEqual(U.resolveIdRef(els, 'e10 Trần Quỳnh Anh').el.id, 'e10');
  assert.strictEqual(U.resolveIdRef(els, 'e3: "Send"').el.id, 'e3');
  // nhãn không khớp → từ chối (B55 vẫn giữ)
  const ch = U.resolveIdRef(els, 'e10 Lê Quỳnh Anh'); assert.ok(ch.labelChanged && ch.labelChanged.id === 'e10');
  // id không còn: có thông tin cũ → goneId; không có → null (để báo “không thấy phần tử”)
  const info = new Map([['e30', { kind: 'nút', name: 'Cũ' }]]);
  assert.ok(U.resolveIdRef(els, 'e30', info).goneId);
  assert.strictEqual(U.resolveIdRef(els, 'e31', info), null);
  assert.strictEqual(U.resolveIdRef(els, 'Trần Quỳnh Anh'), null);
});

test('B60: desktop-agent dùng U.resolveIdRef / U.isIdRef, không còn regex id quay lui', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  assert.match(src, /U\.resolveIdRef\(s\.obs\.elements, q/);
  assert.ok(!/\(e\\d\+\)\\\]\?\\s\*/.test(src), 'regex cũ còn sót');
  assert.ok(!/\/\^\\\[\?e\\d\+\\\]\?\$\/i/.test(src));
});

test('B37 (lượt 7): tệp thứ 2 cùng tên vẫn là chữ MỚI (không báo “chưa có tác dụng” → không đính trùng); có nhắc đã thêm tệp', () => {
  const b = [{ name: 'Bài tập của bạn' }, { name: 'bai.docx' }, { name: '+ Thêm hoặc tạo' }];
  assert.deepStrictEqual(U.newTexts(b, [...b, { name: 'bai.docx' }]), ['bai.docx']);
  assert.deepStrictEqual(U.newTexts(b, b), []);
  assert.deepStrictEqual(U.newTexts([{ name: 'Tìm kiếm' }], [{ name: 'Tìm kiếm' }, { name: 'Tìm kiếm' }]), [], 'OCR đọc trùng chữ thường không phải chữ mới (DPI @150%: vẫn tự dùng Ctrl+F)');
  assert.deepStrictEqual(U.newTexts([], [{ name: 'ab' }, { name: 'Nộp bài' }]), ['Nộp bài']);
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  assert.match(src, /U\.newTexts\(before\.elements, o\.obs\.elements\)/); assert.match(src, /đã thêm tệp .* rồi — nếu người dùng chỉ cần MỘT tệp/);
});

test('B33 (lượt 7): dòng trạng thái “Đang nhìn màn hình bằng…” và “Đã đặt con trỏ vào ô …” có bản en/zh', () => {
  const CORE = require('../src/i18n/core'); const T = CORE.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
  const TV = ' — ô nhập thường không đổi hình khi được chọn, đây là ĐÃ có tác dụng. Bước tiếp: type_text KHÔNG kèm element để gõ vào ô này.';
  for (const vi of ['Đang nhìn màn hình bằng mô hình chính…', 'Đang nhìn màn hình bằng mắt nhìn…', 'Đã đặt con trỏ vào ô “Search” (e10)' + TV, 'Đã đặt con trỏ vào ô “Aa”' + TV, 'Đã đặt con trỏ vào ô nhập e4' + TV, 'Đang tìm “Send” bằng mô hình định vị…', 'Đã quan sát: 12 phần tử'])
    for (const l of ['en', 'zh']) assert.ok(!CORE.VI.test(T.tr(vi, l)), `${l}: ${T.tr(vi, l)}`);
  assert.strictEqual(T.tr('Đã đặt con trỏ vào ô “Tìm kiếm” (e10)' + TV, 'en').slice(0, 45), 'Placed the cursor in field “Tìm kiếm” (e10) —');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  assert.ok(!/status\('Đang nhìn màn hình bằng ' \+/.test(src));
});

const SV = require('../src/agent/send-verify');
test('B58: “Mr./Dr.” không cắt tên người nhận', () => {
  assert.strictEqual(SV.recipientOf('Message Mr. Le Van Hung on Teams: em nộp bài muộn'), 'Le Van Hung');
  assert.strictEqual(SV.recipientOf('Send Dr. Tran Minh an email'), 'Tran Minh');
  assert.strictEqual(SV.recipientOf('Tell Mr. Smith that the report is ready'), 'Smith');
  assert.ok(SV.chatShown('Le Van Hung', 'Microsoft Teams - Le Van Hung'));
  assert.ok(SV.headerMatches('Smith', 'Mr. Smith'));
});

test('B59: đọc được người nhận không cần “là”; 王老师 giữ danh xưng', () => {
  const cases = [['dặn Quỳnh Anh mai mang laptop', 'Quỳnh Anh'], ['nói Quỳnh Anh mai 8h họp nhé', 'Quỳnh Anh'], ['trả lời Quỳnh Anh là ok', 'Quỳnh Anh'],
    ['hỏi Trần Quỳnh Anh xem mai mấy giờ họp', 'Trần Quỳnh Anh'], ['chúc mừng sinh nhật Trần Quỳnh Anh giúp mình', 'Trần Quỳnh Anh'], ['给王老师发消息：明天见', '王老师'],
    ['nói với Trần Quỳnh Anh là mai 8h họp nhóm nhé', 'Trần Quỳnh Anh'], ['Dặn thầy Lê Văn Hùng mai em nghỉ', 'thầy Lê Văn Hùng']];
  for (const [q, want] of cases) assert.strictEqual(SV.recipientOf(q), want, q);
  assert.ok(SV.chatShown('王老师', 'Teams - 王老师')); assert.ok(!SV.chatShown('王老师', 'Teams - 王小明'));
  assert.strictEqual(SV.recipientOf('hỏi Google xem mai trời mưa không'), null);
});

test('B59 (Khôi): người nhận chưa chắc → HỎI “Gửi cho ai?”, không từ chối im lặng, không gửi vào chat đang mở', () => {
  const st = {};
  const g = SV.chatGate({ query: 'tell quynh anh meeting at 8', text: 'meeting at 8', submit: true, proc: 'Messenger', title: 'Messenger', header: ['Nhóm Lớp K27'], state: st });
  assert.ok(g); assert.match(st.askWho, /^Gửi cho ai\?/);
  assert.ok(!/Nhóm Lớp K27/.test(st.askWho), 'không gợi ý gửi vào chat đang mở khi người dùng không nói “cuộc trò chuyện hiện tại”');
  // câu ra lệnh không phải gửi tin → không hỏi
  const st2 = {}; assert.strictEqual(SV.chatGate({ query: 'mở Zalo xem tin mới', text: 'abc', proc: 'Zalo', title: 'Zalo', header: [], state: st2 }), null); assert.ok(!st2.askWho);
  // desktop-agent dừng lượt và đưa câu hỏi; agent.js dùng nguyên câu hỏi làm câu trả lời
  const da = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  assert.match(da, /if \(g && s\.askWho\) \{[^}]*stop: true, ask: q/);
  const ag = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/agent/agent.js'), 'utf8');
  assert.match(ag, /hardStop = out\.ask \? \{ why: String\(out\.error \|\| ''\), ask: String\(out\.ask\) \}/); assert.match(ag, /text = hardStop\.ask \? hardStop\.ask :/);
  // bản dịch
  const CORE = require('../src/i18n/core'); const T = CORE.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
  assert.strictEqual(T.tr(SV.askWho(), 'en').slice(0, 24), 'Who should I send it to?'); assert.strictEqual(T.tr(SV.askWho(), 'zh').slice(0, 4), '发给谁？');
  assert.ok(SV.ASKED_WHO.test(T.tr(SV.askWho(), 'en')) && SV.ASKED_WHO.test(T.tr(SV.askWho(), 'zh')) && SV.ASKED_WHO.test(SV.askWho('X')));
});

test('B59: trả lời câu hỏi “Gửi cho ai?” → làm lại việc trước với người nhận đó', () => {
  const prev = 'tell quynh anh meeting at 8 on Messenger';
  assert.strictEqual(SV.recipientOf(SV.answerWho(prev, 'Trần Quỳnh Anh')), 'Trần Quỳnh Anh');
  assert.strictEqual(SV.recipientOf(SV.answerWho(prev, 'cho Lê Quỳnh Anh')), 'Lê Quỳnh Anh');
  assert.ok(SV.CURRENT_CHAT.test(SV.answerWho(prev, 'đúng'))); assert.ok(SV.CURRENT_CHAT.test(SV.answerWho(prev, 'yes'))); assert.ok(SV.CURRENT_CHAT.test(SV.answerWho(prev, '对')));
  const ag = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/agent/agent.js'), 'utf8');
  assert.match(ag, /SVq\.ASKED_WHO\.test\(prevA_t\.trim\(\)\)/);
});

test('B59: “cuộc trò chuyện hiện tại / this chat / 当前聊天” chỉ khi đọc CHẮC tên cuộc trò chuyện; không chắc → hỏi', () => {
  for (const q of ['nhắn "test" vào cuộc trò chuyện hiện tại', 'send "hi" in this chat', '在当前聊天里发"test"', 'gửi "ok" vào đoạn chat đang mở']) assert.ok(SV.CURRENT_CHAT.test(q), q);
  // tiêu đề cửa sổ có tên cuộc trò chuyện → chắc → cho gõ
  const a = {}; assert.strictEqual(SV.chatGate({ query: 'nhắn "test" vào cuộc trò chuyện hiện tại', text: 'test', submit: true, proc: 'Messenger', title: 'Nhóm Lớp K27 | Messenger', header: [], state: a }), null);
  assert.strictEqual(a.currentChat, 'Nhóm Lớp K27');
  // chỉ OCR đọc đầu khung (Zalo tiêu đề “Zalo”) → chưa chắc → hỏi
  const b = {}; assert.ok(SV.chatGate({ query: 'Trên Zalo, nhắn "test" vào cuộc trò chuyện hiện tại', text: 'test', submit: true, proc: 'Zalo', title: 'Zalo', header: ['Cloud của tôi'], ocrHeader: ['Cloud của tôi'], seenHeader: null, state: b }));
  assert.match(b.askWho, /^Gửi cho ai\?/);
  // OCR + mắt nhìn cùng đọc ra → chắc → cho gõ; sau đó chat đổi → chặn
  const c = {}; assert.strictEqual(SV.chatGate({ query: 'Trên Zalo, nhắn "test" vào cuộc trò chuyện hiện tại', text: 'test', submit: true, proc: 'Zalo', title: 'Zalo', header: ['Cloud của tôi'], ocrHeader: ['Cloud của tôi'], seenHeader: 'Cloud của tôi', state: c }), null);
  assert.match(SV.chatGate({ query: 'Trên Zalo, nhắn "test" vào cuộc trò chuyện hiện tại', text: 'test', submit: true, proc: 'Zalo', title: 'Zalo', header: ['Nhóm Lớp K27'], ocrHeader: ['Nhóm Lớp K27'], seenHeader: 'Nhóm Lớp K27', state: c }), /đã đổi/);
});
