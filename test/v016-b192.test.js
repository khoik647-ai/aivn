'use strict';
// B192 (QA beta.3, Windows 11 Notepad, 8B): type_text hai lần “CHƯA thấy chữ vừa gõ”, bấm menu (bước “ok”), câu cuối hỏi lại người dùng
// → vẫn outcome “done” / mã thoát 0. Việc chỉ XONG khi thao tác quyết định có tác dụng ĐÃ KIỂM trên màn hình; không thì báo trung thực (vi/en/zh).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const A = require('../src/agent/agent');
const RT = require('../src/agent/retry');
const QA = require('../src/qa-runner');
const CT = require('../src/agent/computer-tools');
const { createMemoryStore } = require('../src/agent/memory');
const { VI } = require('../src/i18n/core');
const NAMES = ['open_app', 'screen_act', 'screen_look'];

function mkAgent(replies, lang, act) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b192-'));
  const engine = { status: () => ({ loaded: true, contextSize: 8192, id: 'qwen3vl-8b-instruct-q4_k_m', vision: true }), chatStep: async () => replies.shift() || say('') };
  const defs = Object.fromEntries(NAMES.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => NAMES, defs, has: (n) => n in defs, CompError: CT.CompError,
    exec: async (n, a) => n === 'screen_act' ? act(a) : { forModel: `Đã mở ứng dụng "${a.name}".`, summary: 'Đã mở ' + a.name } };
  return A.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: false, agentComputer: true, agentScreen: true, uiLang: lang }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
}
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 20 } });
const call = (name, args) => ({ text: '', toolCalls: [{ id: 'c' + Math.random(), name, arguments: args }], finishReason: 'tool_calls', usage: { completion_tokens: 10 } });
const run = (agent, q) => agent.run({ messages: [{ role: 'user', content: q }], confirm: async () => true });
// màn hình giả: gõ không ra chữ (Notepad đang ở thẻ khác / ô không nhận phím); bấm menu thì màn hình đổi
const NOT_SEEN = (a) => a.action === 'type_text'
  ? { forModel: `Đã gõ "${a.text}".\nKiểm tra: CHƯA thấy chữ vừa gõ trong danh sách phần tử (có thể ô không hiện giá trị) — hãy kiểm tra trước khi làm tiếp.`, summary: `gõ “${a.text}”` }
  : { forModel: `Đã bấm "${a.element}".\nKiểm tra: Màn hình đã thay đổi sau thao tác (12% điểm ảnh) — xem danh sách mới bên dưới.`, summary: `bấm “${a.element}”` };
const SEEN = (a) => ({ forModel: `Đã gõ "${a.text}".\nKiểm tra: Đã thấy chữ vừa gõ trên màn hình.`, summary: `gõ “${a.text}”` });
const notepadRun = (text, final) => [call('screen_act', { action: 'type_text', text }), call('screen_act', { action: 'type_text', text, element: 'Text editor' }), call('screen_act', { action: 'click', element: 'Edit' }), say(final)];

const Q = { vi: 'mở Notepad và gõ "hello world"', en: 'open Notepad and type "hello world"', zh: '打开 Notepad 并输入 "hello world"' };
const FINAL = { vi: 'Chữ không xuất hiện trong Notepad. Bạn muốn mình làm gì tiếp theo?', en: 'I typed it into Notepad. What would you like me to do next?', zh: '我已经在记事本中输入了。接下来要做什么？' };
for (const lang of ['vi', 'en', 'zh']) {
  test(`B192 [${lang}]: Notepad — gõ hai lần không thấy chữ, bấm menu “ok”, câu cuối hỏi lại → outcome failed + câu trung thực theo ngôn ngữ`, async () => {
    const r = await run(mkAgent(notepadRun('hello world', FINAL[lang]), lang, NOT_SEEN), Q[lang]);
    assert.strictEqual(r.outcome, 'failed', r.text);
    assert.ok(r.steps.some(s => s.name === 'screen_act' && s.status === 'ok' && !s.check), 'có bước “ok” (bấm menu) — trước đây đủ để báo done');
    const st = QA.statusOf(r, { task: Q[lang] }); assert.strictEqual(st.status, 'failed'); assert.strictEqual(QA.exitCodeOf(st.status), 2);
    if (lang === 'vi') assert.match(r.text, /^Mình chưa làm xong việc này \(chưa thấy chữ nào được gõ vào ứng dụng trên màn hình\)/);
    else { assert.ok(!VI.test(r.text), r.text); assert.match(r.text, lang === 'en' ? /no typed text appeared in the app on screen/ : /屏幕上的应用中没有出现任何输入的文字/); }
    assert.doesNotMatch(r.text, /What would you like|接下来要做什么|I typed it/, 'câu báo giả của mô hình không còn');
  });
}

test('B192: gõ có chữ đã kiểm trên màn hình → vẫn done (không báo sai là thất bại)', async () => {
  const r = await run(mkAgent([call('screen_act', { action: 'type_text', text: 'hello world' }), say('Đã gõ “hello world” vào Notepad.')], 'vi', SEEN), Q.vi);
  assert.strictEqual(r.outcome, 'done', r.text); assert.strictEqual(QA.statusOf(r, { task: Q.vi }).status, 'done');
});

test('B192: lần gõ đầu không thấy chữ, lần sau thấy → done', async () => {
  let n = 0; const act = (a) => (n++ === 0 ? NOT_SEEN : SEEN)(a);
  const r = await run(mkAgent([call('screen_act', { action: 'type_text', text: 'hello world' }), call('screen_act', { action: 'type_text', text: 'hello world', element: 'Text editor' }), say('Đã gõ xong.')], 'vi', act), Q.vi);
  assert.strictEqual(r.outcome, 'done', r.text);
});

test('B192: việc cần gõ mà mô hình chỉ bấm menu, không gõ chữ nào → failed', async () => {
  const r = await run(mkAgent([call('screen_act', { action: 'click', element: 'File' }), say('Đã xong.')], 'vi', NOT_SEEN), Q.vi);
  assert.strictEqual(r.outcome, 'failed', r.text);
});

test('B192 review #68: việc không cần gõ — bước cuối chỉ “màn hình không thay đổi rõ ràng” (đo điểm ảnh, đổi rất nhỏ) → KHÔNG đánh hỏng; dấu hiệu chắc chắn (không thấy phần tử) → failed', async () => {
  const NOCHANGE = (a) => ({ forModel: `Đã bấm "${a.element}".\nKiểm tra: Màn hình không thay đổi rõ ràng — nếu cần, thử cách khác.`, summary: `bấm “${a.element}”` });
  let r = await run(mkAgent([call('screen_act', { action: 'click', element: 'Bật' }), say('Đã bấm nút Bật xong rồi nhé.')], 'vi', NOCHANGE), 'mở Cài đặt và bấm nút Bật Bluetooth');
  assert.strictEqual(r.outcome, 'done', r.text);
  assert.match(r.warning || '', /chưa kiểm chứng được bước cuối trên màn hình/, 'cảnh báo cũ (v016-retry) vẫn giữ');
  const NOTFOUND = (a) => ({ forModel: `Kiểm tra: không thấy phần tử "${a.element}" trên màn hình.`, summary: `bấm “${a.element}”` });
  r = await run(mkAgent([call('screen_act', { action: 'click', element: 'Bật' }), say('Đã bấm nút Bật xong rồi nhé.')], 'vi', NOTFOUND), 'mở Cài đặt và bấm nút Bật Bluetooth');
  assert.strictEqual(r.outcome, 'failed', r.text); assert.match(r.text, /bước cuối chưa có tác dụng trên màn hình/);
  r = await run(mkAgent([call('screen_act', { action: 'click', element: 'Bật' }), say('Đã bật xong.')], 'vi', NOT_SEEN), 'mở Cài đặt và bấm nút Bật Bluetooth');
  assert.strictEqual(r.outcome, 'done', r.text);
});

test('B192 review #68: “mở bài viết mới nhất trên Facebook” không phải việc gõ → bấm có tác dụng vẫn done (không báo sai là thất bại)', async () => {
  const r = await run(mkAgent([call('screen_act', { action: 'click', element: 'Bài viết mới nhất' }), say('Đã mở bài viết mới nhất.')], 'vi', NOT_SEEN), 'mở bài viết mới nhất trên Facebook');
  assert.strictEqual(r.outcome, 'done', r.text);
});

test('B192 review #68: gõ có chữ rồi ctrl+s (màn hình gần như không đổi) → vẫn done', async () => {
  const act = (a) => a.action === 'type_text' ? SEEN(a) : { forModel: `Đã bấm phím ${a.keys}.\nKiểm tra: Màn hình không thay đổi rõ ràng — nếu cần, thử cách khác.`, summary: `phím ${a.keys}` };
  const r = await run(mkAgent([call('screen_act', { action: 'type_text', text: 'hello world' }), call('screen_act', { action: 'hotkey', keys: 'ctrl+s' }), say('Đã gõ và lưu.')], 'vi', act), Q.vi);
  assert.strictEqual(r.outcome, 'done', r.text);
});

test('B192: effectOf (thuần)', () => {
  const st = (action, check = null, status = 'ok', extra = {}) => ({ name: 'screen_act', args: { action, ...extra }, status, check });
  assert.deepStrictEqual(RT.effectOf([], 'mở Notepad và gõ abc'), { ok: true }, 'không có bước màn hình: để các luật khác xử lý');
  assert.strictEqual(RT.effectOf([st('type_text', 'chưa thấy chữ vừa gõ'), st('click')], 'gõ abc vào Notepad').why, 'typed');
  assert.strictEqual(RT.effectOf([st('type_text', 'chưa thấy chữ vừa gõ'), { name: 'screen_act', args: { action: 'type_text' }, status: 'ok', draftIn: { text: 'abc' } }], 'gõ abc').ok, true);
  // review #68: 'last' — chỉ dấu hiệu chắc chắn; bỏ qua phím lưu/đóng; bước cuối lỗi → hỏng
  assert.strictEqual(RT.effectOf([st('click', 'màn hình không thay đổi')], 'mở Cài đặt').ok, true, 'đổi rất nhỏ / đo điểm ảnh: không đủ chắc');
  assert.strictEqual(RT.effectOf([st('click', 'không thấy phần tử')], 'mở Cài đặt').why, 'last');
  assert.strictEqual(RT.effectOf([st('click', 'hộp thoại vẫn đang mở')], 'mở Cài đặt').why, 'last');
  assert.strictEqual(RT.effectOf([st('click'), st('click', null, 'error')], 'mở Cài đặt').why, 'last', 'bước cuối status error → không ok');
  assert.strictEqual(RT.effectOf([st('click', 'không thấy phần tử'), st('click')], 'mở Cài đặt').ok, true);
  assert.strictEqual(RT.effectOf([st('type_text'), st('hotkey', 'màn hình không thay đổi', 'ok', { keys: 'ctrl+s' })], 'gõ abc').ok, true, 'ctrl+s sau khi gõ');
  assert.strictEqual(RT.effectOf([st('click', 'không thấy phần tử'), st('hotkey', null, 'ok', { keys: 'Enter' })], 'mở Cài đặt').why, 'last', 'Enter không che bước hỏng trước nó');
  assert.strictEqual(RT.effectOf([st('click'), { name: 'screen_act', args: { action: 'click' }, status: 'refused' }], 'mở Cài đặt').ok, true, 'người dùng từ chối: không phải lỗi cách làm');
  // review #68: chữ vào ô không qua type_text
  assert.strictEqual(RT.effectOf([st('click'), { ...st('hotkey', null, 'ok', { keys: 'ctrl+v' }), detail: 'Đã thấy chữ vừa gõ trên màn hình.' }], 'mở Notepad và gõ abc').ok, true, 'dán bằng ctrl+v CÓ kiểm chứng chữ');
  assert.strictEqual(RT.effectOf([st('click'), st('hotkey', 'màn hình không thay đổi', 'ok', { keys: 'ctrl+v' })], 'mở Notepad và gõ abc').why, 'typed', 'dán mà chưa có tác dụng');
  assert.strictEqual(RT.effectOf([{ name: 'write_file', args: { path: 'tho.txt' }, status: 'ok' }, { name: 'open_path', args: { path: 'C:\\Users\\A\\Documents\\tho.txt' }, status: 'ok' }, st('click')], 'mở Notepad và gõ abc').ok, true, 'write_file rồi mở tệp');
  assert.strictEqual(RT.effectOf([{ name: 'write_file', status: 'ok' }, st('click')], 'mở Notepad và gõ abc').why, 'typed', 'ghi tệp mà không mở');
  assert.strictEqual(RT.effectOf([st('click', null, 'ok', { then: [{ action: 'type_text', text: 'abc' }] })], 'mở Notepad và gõ abc').ok, true, 'type_text trong chuỗi then');
  // review #68: TYPE_TASK chỉ khi thật sự là việc gõ
  for (const q of ['mở bài viết mới nhất trên Facebook', 'what type it is', 'open input settings', 'tra cứu thuế nhập khẩu', '找一个写字楼', 'mở Zalo và đăng nhập', '打开输入法设置'])
    assert.strictEqual(RT.TYPE_TASK.test(q), false, q);
  for (const q of [Q.vi, Q.en, Q.zh, '打开记事本并输入一行字', 'mở Word rồi viết thư xin nghỉ', 'gõ abc vào Notepad', 'open Notepad, type hi and save', 'write a note in Notepad', 'nhập số 5 vào ô', '打开记事本写一句话'])
    assert.strictEqual(RT.TYPE_TASK.test(q), true, q);
  assert.strictEqual(RT.effectOf([st('click')], 'mở bài viết mới nhất trên Facebook').ok, true);
});

test('B192: QA runner — câu cuối nói chữ không xuất hiện / không gõ được là câu báo chưa làm được (vi/en/zh)', () => {
  for (const t of ['Chữ không xuất hiện trong Notepad. Bạn muốn mình làm gì tiếp theo?', 'Mình không gõ được vào Notepad.', 'Nội dung vẫn chưa hiện ra trong tài liệu.', 'Chữ “abc” vừa gõ vẫn chưa xuất hiện.',
    'The text did not appear in Notepad.', 'The typed text still does not appear.', "I wasn't able to type into the document.", '文字没有出现在记事本中。', '输入的文字没有显示。'])
    assert.strictEqual(QA.statusOf({ outcome: 'done', text: t, steps: [] }, { task: 'mở Notepad và gõ abc' }).status, 'failed', t);
  for (const t of ['Kết quả của phép tính 12 + 30 là **42**.', 'Đã gõ “abc” vào Notepad và thấy chữ trên màn hình.', 'The result of 12 + 30 is 42.', '12 + 30 的结果是 42。', 'Đã mở Notepad và sẵn sàng.'])
    assert.strictEqual(QA.statusOf({ outcome: 'done', text: t, steps: [] }, { task: 'mở Máy tính, tính 12 + 30' }).status, 'done', t);
});
test('B192 review #68: FAIL_CLAIM không bắt nhầm câu hỏi lịch sự cuối lượt / “không xuất hiện lỗi” / “popup did not show up” (vi/en/zh)', () => {
  for (const t of ['Đã xong. Bạn muốn mình làm gì tiếp theo không?', 'Bạn muốn mình làm gì nữa?', 'Kết quả: không xuất hiện lỗi nào', 'Văn bản phụ đề chưa hiện lên vì video đang tải.', 'Bạn muốn mình xử lý thế nào?',
    'What would you like me to do next?', 'How would you like to proceed with saving?', 'The error message did not appear again.', 'The popup did not show up.',
    '您希望我怎么做下一步？', '您希望我怎么做？', '没有出现错误。', '广告没有显示。'])
    assert.strictEqual(QA.statusOf({ outcome: 'done', text: t, steps: [] }, { task: 'mở Notepad và gõ abc' }).status, 'done', t);
});

// ===== re-review #68 (ff9a965): các luật miễn không được che lỗi gõ/gửi thật =====
const st2 = (action, check = null, status = 'ok', extra = {}) => ({ name: 'screen_act', args: { action, ...extra }, status, check });
test('B192 re-review #68 (1): phím Enter/Tab/Esc cuối có check CHẮC CHẮN (chưa kiểm chứng gửi, hộp thoại vẫn mở…) → không bị bỏ qua, failed', () => {
  assert.strictEqual(RT.effectOf([st2('type_text'), st2('hotkey', 'chưa kiểm chứng được là đã gửi', 'ok', { keys: 'enter' })], 'gõ xin chào rồi gửi').why, 'last');
  assert.strictEqual(RT.effectOf([st2('type_text'), st2('hotkey', 'hộp thoại vẫn đang mở', 'ok', { keys: 'esc' })], 'gõ abc').why, 'last');
  assert.strictEqual(RT.effectOf([st2('click'), st2('hotkey', 'không thấy phần tử', 'ok', { keys: 'tab' })], 'mở Cài đặt').why, 'last');
  // phím lưu/đóng không check hoặc chỉ check yếu → vẫn bỏ qua như cũ
  assert.strictEqual(RT.effectOf([st2('type_text'), st2('hotkey', 'màn hình không thay đổi', 'ok', { keys: 'enter' })], 'gõ abc').ok, true);
  assert.strictEqual(RT.effectOf([st2('type_text'), st2('hotkey', null, 'ok', { keys: 'ctrl+s' })], 'gõ abc').ok, true);
});
test('B192 re-review #68 (2): write_file rồi open_app mở ứng dụng TRỐNG (không phải tệp vừa ghi) → chưa tính là đã gõ', () => {
  const wf = { name: 'write_file', args: { path: 'xin-chao.txt' }, status: 'ok' };
  assert.strictEqual(RT.effectOf([wf, { name: 'open_app', args: { name: 'Notepad' }, status: 'ok' }, st2('click')], 'mở Notepad và gõ xin chào').why, 'typed');
  assert.strictEqual(RT.effectOf([wf, { name: 'open_path', args: { path: 'khac.txt' }, status: 'ok' }, st2('click')], 'mở Notepad và gõ xin chào').why, 'typed', 'mở tệp khác');
  assert.strictEqual(RT.effectOf([{ name: 'open_path', args: { path: 'xin-chao.txt' }, status: 'ok' }, wf, st2('click')], 'mở Notepad và gõ xin chào').why, 'typed', 'mở TRƯỚC khi ghi');
  assert.strictEqual(RT.effectOf([wf, { name: 'open_path', args: { path: '~/Documents/Xin-Chao.txt' }, status: 'ok' }, st2('click')], 'mở Notepad và gõ xin chào').ok, true, 'open_path đúng tệp');
  assert.strictEqual(RT.effectOf([wf, { name: 'open_app', args: { name: 'notepad "C:\\Users\\A\\xin-chao.txt"' }, status: 'ok' }, st2('click')], 'mở Notepad và gõ xin chào').ok, true, 'open_app với tệp làm đối số');
});
test('B192 re-review #68 (3): typeTask bắt các câu gõ thường gặp; vẫn không bắt nhầm các câu đã loại', () => {
  for (const q of ['mở Word viết bài thơ', 'mở Notepad viết một bài thơ', 'mở notepad gõ xin chào', 'copy this and type it in notepad', 'open notepad typing hello', '在记事本里写"你好"', '在记事本里写你好'])
    assert.strictEqual(RT.typeTask(q), true, q);
  for (const q of ['mở bài viết mới nhất trên Facebook', 'tra giá nhập khẩu', 'đăng nhập Zalo', 'what type of file is this', 'open input settings', '去写字楼', '切换输入法'])
    assert.strictEqual(RT.typeTask(q), false, q);
  // và có tác dụng: việc gõ mà chỉ bấm menu → failed
  assert.strictEqual(RT.effectOf([st2('click')], 'mở Word viết bài thơ').why, 'typed');
  assert.strictEqual(RT.effectOf([st2('click')], '在记事本里写你好').why, 'typed');
});
test('B192 re-review #68 (4): FAIL_CLAIM bắt thêm câu báo chữ chưa hiện / không gõ được (vi/en/zh), không bắt nhầm câu hỏi lịch sự', () => {
  for (const t of ['Chữ chưa hiện trong Notepad. Bạn muốn mình làm gì?', 'Mình không thấy chữ hiện ra', 'Notepad vẫn trống, chưa có chữ nào', 'Gõ không được vì cửa sổ bị khoá', "I don't see the text", 'Nothing was typed', '记事本里没有看到文字'])
    assert.ok(QA.FAIL_CLAIM.test(t), t);
  for (const t of ['Bạn muốn mình làm gì tiếp theo?', 'What would you like me to do next?', '您希望我怎么做？', 'Kết quả: không xuất hiện lỗi nào', 'Mình đã thấy chữ hiện ra.', 'Đã gõ xong, chữ hiện rõ trong Notepad.'])
    assert.ok(!QA.FAIL_CLAIM.test(t), t);
});
test('B192 re-review #68 (5): dán ctrl+v KHÔNG có kiểm chứng chữ → chưa tính là đã gõ', () => {
  assert.strictEqual(RT.effectOf([st2('click'), st2('hotkey', null, 'ok', { keys: 'ctrl+v' })], 'mở Notepad và gõ abc').why, 'typed');
  assert.strictEqual(RT.effectOf([st2('click'), { ...st2('hotkey', null, 'ok', { keys: 'ctrl+v' }), detail: 'Đã thấy chữ vừa gõ trên màn hình.' }], 'mở Notepad và gõ abc').ok, true);
});
test('B192 re-review #68 (1) agent: gõ rồi Enter “CHƯA kiểm chứng được là đã gửi” → outcome failed (không done), vẫn giữ câu trung thực “CHƯA xác nhận…”', async () => {
  const act = (a) => a.keys === 'enter' ? { forModel: 'Đã bấm phím enter. CHƯA kiểm chứng được là đã gửi', summary: 'bấm phím enter · CHƯA kiểm chứng', verify: { sent: false, why: 'không thấy tên người nhận “trần quỳnh anh” trên màn hình' } } : { forModel: `Đã gõ "${a.text}".\nKiểm tra: Đã thấy chữ vừa gõ trên màn hình.`, summary: 'gõ chữ' };
  const r = await run(mkAgent([call('screen_act', { action: 'type_text', text: 'Chào buổi sáng!' }), call('screen_act', { action: 'hotkey', keys: 'enter' }), say('Tin nhắn đã được gửi thành công.'), say('Tin nhắn đã được gửi.')], 'vi', act), 'gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại');
  assert.strictEqual(r.outcome, 'failed', r.text);
  assert.match(r.text, /CHƯA xác nhận/); assert.ok(!/thành công/.test(r.text), r.text);
});
