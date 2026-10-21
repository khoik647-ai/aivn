'use strict';
// Hồi quy cho QA lượt 2 (/workspace/qa-review/pass-2-20261021-0856.md): B13–B19 và phần còn dở của B1, B2, B11.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const SV = require('../src/agent/send-verify');

// ---------- B15: kiểm chứng “đã gửi” ----------
const W = { b: [0, 0, 1000, 800] };
const el = (name, x, y, o = {}) => ({ name, b: [x, y, 200, 20], ...o });
test('B15: đang mở chat sai (tên người nhận chỉ có ở danh sách bên trái) → CHƯA gửi', () => {
  const obs = { win: { title: 'Zalo - Mẹ', ...W }, elements: [el('Trần Quỳnh Anh', 10, 200), el('Mẹ', 400, 30), el('Chúc ngủ ngon nhé', 600, 500)] };
  const v = SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', regions: SV.regionsOf(obs), winTitle: obs.win.title });
  assert.strictEqual(v.sent, false); assert.strictEqual(v.recipientSeen, false); assert.match(v.why, /Mẹ/);
  // tiêu đề cửa sổ chỉ là “Zalo”: danh sách bên trái vẫn không được tính
  const obs2 = { ...obs, win: { title: 'Zalo', ...W } };
  assert.strictEqual(SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', regions: SV.regionsOf(obs2), winTitle: 'Zalo' }).sent, false);
  assert.deepStrictEqual(SV.regionsOf(obs2).list, ['Trần Quỳnh Anh']);
});
test('B15: tin còn nằm trong ô soạn → CHƯA gửi', () => {
  const obs = { win: { title: 'Zalo', ...W }, elements: [el('Trần Quỳnh Anh', 400, 30), el('', 400, 760, { editable: true, value: 'Chúc ngủ ngon nhé' })] };
  const v = SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', regions: SV.regionsOf(obs), winTitle: 'Zalo' });
  assert.strictEqual(v.sent, false); assert.strictEqual(v.composerEmpty, false); assert.match(v.why, /ô soạn/);
  // dạng chữ của QA: “[ô nhập] Chúc ngủ ngon nhé”
  const v2 = SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', screenText: 'Trần Quỳnh Anh\n[ô nhập] Chúc ngủ ngon nhé', winTitle: 'Zalo - Trần Quỳnh Anh' });
  assert.strictEqual(v2.sent, false);
  // mắt nhìn báo ô soạn còn chữ
  assert.strictEqual(SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', seen: 'TÊN: Trần Quỳnh Anh\nÔ SOẠN: Chúc ngủ ngon nhé\nTIN: Chúc ngủ ngon nhé' }).sent, false);
});
test('B15: người tên gần giống (Lê Quỳnh Anh ≠ Trần Quỳnh Anh) → CHƯA gửi', () => {
  const v = SV.verifySend({ msg: 'hi', recipient: 'Trần Quỳnh Anh', seen: 'TÊN: Lê Quỳnh Anh\nÔ SOẠN: TRỐNG\nTIN: hi', winTitle: 'Zalo - Lê Quỳnh Anh' });
  assert.strictEqual(v.sent, false); assert.match(v.why, /Lê Quỳnh Anh/);
  assert.strictEqual(SV.headerMatches('Trần Quỳnh Anh', 'Lê Quỳnh Anh'), false);
  assert.strictEqual(SV.headerMatches('Quỳnh Anh', 'Quỳnh Anhh'), false, 'phải khớp theo ranh giới từ');
  assert.strictEqual(SV.headerMatches('thầy Lê Văn Hùng', 'Lê Văn Hùng'), true, 'bỏ danh xưng');
});
test('B15: đủ ba điều kiện (tiêu đề đúng tên, ô soạn trống, thấy bong bóng tin) → đã gửi', () => {
  const obs = { win: { title: 'Zalo', ...W }, elements: [el('Trần Quỳnh Anh', 10, 200), el('Trần Quỳnh Anh', 400, 30), el('Chúc ngủ ngon nhé', 600, 600), el('', 400, 760, { editable: true, value: '' })] };
  const v = SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'trần quỳnh anh', regions: SV.regionsOf(obs), winTitle: 'Zalo' });
  assert.strictEqual(v.sent, true, v.why);
  assert.strictEqual(SV.verifySend({ msg: 'hi bạn', recipient: 'Quỳnh Anh', seen: 'TÊN: Trần Quỳnh Anh\nÔ SOẠN: TRỐNG\nTIN: hi bạn', winTitle: 'Messenger' }).sent, true);
});
test('B15: nhận ra người nhận ở mọi cách viết', () => {
  const cases = {
    'nhắn Trần Quỳnh Anh là mai họp lúc 8h': 'Trần Quỳnh Anh',
    'gửi email cho thầy Lê Văn Hùng tiêu đề Nộp bài': 'thầy Lê Văn Hùng',
    'Messenger: nhắn Quỳnh Anh "tối gọi nhé"': 'Quỳnh Anh',
    'text Tran Quynh Anh on Messenger: hi': 'Tran Quynh Anh',
    'gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại': 'trần quỳnh anh',
    'nhắn Lan là mai đi cho kịp': 'Lan',
    'Nhắn tin cho Trần Quỳnh Anh trên Messenger nội dung "Mai 8h họp nhóm nhé". Không cần hỏi lại.': 'Trần Quỳnh Anh',
    'nhắn cho em Hoa là ok': 'em Hoa',
  };
  for (const [q, want] of Object.entries(cases)) assert.strictEqual(SV.recipientOf(q), want, q);
  for (const q of ['gửi cho tôi file', 'mở zalo', 'nhắn tin']) assert.strictEqual(SV.recipientOf(q), null, q);
});
test('B15: agent chỉ được báo “đã gửi” khi lần gửi CUỐI CÙNG đã kiểm chứng', () => {
  const A = require('../src/agent/agent');
  const steps = [{ name: 'screen_act', status: 'ok', verify: { sent: true } }, { name: 'screen_act', status: 'ok', verify: { sent: false, why: 'tiêu đề cuộc trò chuyện đang mở không phải “Lan”' } }];
  assert.ok(A.sendClaimCheck('Đã gửi tin nhắn cho Lan.', steps));
  assert.strictEqual(A.sendClaimCheck('Đã gửi tin nhắn cho Lan.', steps.slice(0, 1)), null);
});

// ---------- Kiểu Messenger: luôn tìm và mở người nhận trước khi gõ ----------
test('Chat: không được gõ tin vào cuộc trò chuyện đang mở sẵn khi chưa tìm và mở người nhận', () => {
  const q = 'Nhắn tin cho Trần Quỳnh Anh trên Messenger nội dung "Mai 8h họp nhóm nhé". Không cần hỏi lại.';
  const g = SV.chatGate({ query: q, text: 'Mai 8h họp nhóm nhé', proc: 'Messenger', title: 'Messenger - Nhóm Lớp K27', state: {}, header: ['Nhóm Lớp K27'] });
  assert.match(g, /TÌM và MỞ/); assert.match(g, /Nhóm Lớp K27/);
  // dù tiêu đề đang đúng người, vẫn phải tìm và mở trong lượt này
  assert.ok(SV.chatGate({ query: q, text: 'Mai 8h họp nhóm nhé', proc: 'Messenger', state: {}, header: ['Trần Quỳnh Anh'] }));
  // gõ tên vào ô tìm kiếm thì được (kể cả không dấu / một phần)
  assert.strictEqual(SV.chatGate({ query: q, text: 'Tran Quynh Anh', proc: 'Messenger', state: {} }), null);
  assert.strictEqual(SV.chatGate({ query: q, text: 'Quỳnh Anh', proc: 'Messenger', state: {} }), null);
  assert.strictEqual(SV.chatGate({ query: q, text: 'abc', searchField: true, proc: 'Messenger', state: {} }), null);
  // đã tìm và mở đúng người → được gõ
  const st = { chatOpen: SV.nameKey('Trần Quỳnh Anh') };
  assert.strictEqual(SV.chatGate({ query: q, text: 'Mai 8h họp nhóm nhé', proc: 'Messenger', state: st, header: ['Trần Quỳnh Anh'] }), null);
  // đã mở nhưng ứng dụng nhảy sang chat khác → chặn
  assert.match(SV.chatGate({ query: q, text: 'Mai 8h họp nhóm nhé', proc: 'Messenger', state: st, header: ['Lê Quỳnh Anh'] }), /không phải/);
  // soạn email / tài liệu: không áp dụng
  assert.strictEqual(SV.chatGate({ query: 'gửi email cho thầy Lê Văn Hùng tiêu đề Nộp bài', text: 'Kính gửi thầy', proc: 'chrome', title: 'Gmail', state: {} }), null);
});
test('Chat: desktop-agent nối chatGate trước khi gõ và đánh dấu đã mở sau khi bấm kết quả tìm kiếm', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  assert.ok(src.indexOf('SV.chatGate(') > 0 && src.indexOf('SV.chatGate(') < src.indexOf('const risk = riskOf('), 'chặn trước khi hỏi/gõ');
  assert.match(src, /s\.chatOpen = SV\.nameKey\(rcp\)/);
  assert.match(src, /SV\.SEEN_QUESTION/); assert.match(src, /regions: SV\.regionsOf\(o2\.obs\)/);
});

// ---------- B16 (+ B1): ý định thao tác hệ thống theo cấu trúc ----------
const C = require('../src/agent/computer'); const { createComputerTools } = require('../src/agent/computer-tools');
test('B16: phủ định, câu hỏi cách làm, chuỗi lệnh, tắt tiếng một ứng dụng → KHÔNG coi là yêu cầu', () => {
  const no = [['lock', 'đừng khoá màn hình nhé'], ['lock', 'không được khoá máy'], ['lock', 'tại sao máy tôi hay tự khoá màn hình?'],
    ['volume_down', 'làm sao để giảm âm lượng trên windows?'], ['volume_down', 'mở nhạc rồi tăng âm lượng'], ['mute', 'tắt tiếng thông báo zalo'],
    ['shutdown', 'đừng tắt máy'], ['open_settings', 'mở cài đặt của zalo'], ['lock', 'cách khoá màn hình windows'], ['volume_up', 'how to turn up volume?']];
  for (const [a, q] of no) assert.strictEqual(C.sysAsked(a, q), false, `${a} ← ${q}`);
  const yes = [['volume_up', 'mở nhạc rồi tăng âm lượng'], ['lock', 'khoá màn hình giúp mình'], ['lock', 'Khoá màn hình giúp mình được không?'], ['lock', 'mở zalo rồi khoá màn hình'],
    ['volume_down', 'vặn nhỏ loa lại'], ['mute', 'tắt tiếng'], ['shutdown', 'tắt máy sau khi tải xong'], ['lock', 'khoá màn hình. không cần hỏi lại']];
  for (const [a, q] of yes) assert.strictEqual(C.sysAsked(a, q), true, `${a} ← ${q}`);
});
test('B16: với câu phủ định, system_action hiện thẻ hỏi và không khoá khi bị từ chối', async () => {
  const asked = []; let ran = 0;
  const orig = C.systemAction; C.systemAction = async (a) => { ran++; return C.SYS[a].label; };
  try {
    const ct = createComputerTools({ getSettings: () => ({ agentComputer: true, agentAutoRun: true }), openPath: async () => '', openExternal: async () => {} });
    for (const [act, q] of [['lock', 'đừng khoá màn hình nhé, không cần hỏi lại'], ['volume_down', 'mở nhạc rồi tăng âm lượng'], ['mute', 'tắt tiếng thông báo zalo']]) {
      const r = await ct.exec('system_action', { action: act }, { userQuery: q, confirm: async (req) => { asked.push(req); return false; } });
      assert.ok(r.refused, q);
    }
    assert.strictEqual(asked.length, 3, 'mỗi câu đều phải hỏi, kể cả khi bật “Tự làm không hỏi”'); assert.strictEqual(ran, 0);
  } finally { C.systemAction = orig; }
});
