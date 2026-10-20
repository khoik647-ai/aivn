// 0.15.0: cây giao diện (UIA/AX) → phần tử có id để mô hình không nhìn ảnh thao tác được
const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/agent/uitree');
const raw = require('./fixtures/uia-zalo.json');

test('chuẩn hoá cây UIA: bỏ khung không tên, gộp trùng, thứ tự đọc, id e1..', () => {
  const o = U.normalize(raw);
  assert.strictEqual(o.win.title, 'Zalo');
  assert.ok(!o.elements.some(e => e.role === 'Pane'));
  assert.strictEqual(o.elements.filter(e => e.name === 'Gửi').length, 1, 'nút Gửi trùng bị gộp');
  assert.deepStrictEqual(o.elements.map(e => e.id), o.elements.map((_, i) => 'e' + (i + 1)));
  const pw = o.elements.find(e => e.name === 'Mật khẩu');
  assert.ok(pw.password); assert.strictEqual(pw.value, null, 'không bao giờ lộ giá trị ô mật khẩu');
  const ys = o.elements.map(e => e.b[1]); for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1] - 8);
});
test('danh sách cho mô hình: tiếng Việt, có id, vị trí 0-1000, đánh dấu đang chọn / mật khẩu', () => {
  const o = U.normalize(raw);
  const t = U.formatForModel(o, { toNorm: (x, y) => ({ x: Math.round(x / 1.92), y: Math.round(y / 1.04) }) });
  assert.match(t, /Cửa sổ đang dùng: "Zalo"/);
  assert.match(t, /\[e\d+\] ô nhập "Tìm kiếm" @\d+,\d+/);
  assert.match(t, /mục danh sách "Trần Quỳnh Anh"/);
  assert.match(t, /\(đang chọn\)/);
  assert.match(t, /Ô MẬT KHẨU – không gõ/);
  assert.ok(!/secret/.test(t));
});
test('tìm phần tử theo id, tên, mô tả kiểu "ô tin nhắn"', () => {
  const o = U.normalize(raw); const E = o.elements;
  const send = E.find(e => e.name === 'Gửi');
  assert.strictEqual(U.findElement(E, send.id), send);
  assert.strictEqual(U.findElement(E, `[${send.id}]`), send);
  assert.strictEqual(U.findElement(E, 'nút Gửi').name, 'Gửi');
  assert.strictEqual(U.findElement(E, 'tran quynh anh').role, 'ListItem', 'không dấu vẫn tìm được, ưu tiên phần tử bấm được');
  assert.strictEqual(U.findElement(E, 'ô tin nhắn').name, 'Nhập @, tin nhắn tới Trần Quỳnh Anh');
  assert.strictEqual(U.findElement(E, 'ô tìm kiếm').name, 'Tìm kiếm');
  assert.strictEqual(U.findElement(E, 'e999'), null);
  assert.strictEqual(U.findElement(E, 'Facebook'), null);
});
test('chữ OCR được thêm làm phần tử; chữ trùng phần tử đã có thì bỏ', () => {
  const o = U.normalize(raw, { ocr: [{ text: 'Trần Quỳnh Anh', b: [135, 141, 170, 18] }, { text: 'Hôm nay 20:15', b: [500, 300, 120, 18] }] });
  assert.ok(o.elements.some(e => e.ocr && e.name === 'Hôm nay 20:15'));
  assert.ok(!o.elements.some(e => e.ocr && e.name === 'Trần Quỳnh Anh'));
});
test('macOS AX: vai trò AX* và ô mật khẩu AXSecureTextField', () => {
  const o = U.normalize({ win: { title: 'Ghi chú', proc: 'Notes' }, els: [{ r: 'AXButton', n: 'Tạo ghi chú', b: [10, 10, 30, 30], e: true }, { r: 'AXTextArea', n: '', b: [200, 100, 600, 500], e: true, f: true, v: 'abc' }, { r: 'AXSecureTextField', s: 'AXSecureTextField', n: 'Password', b: [1, 1, 50, 20], p: true }] });
  assert.strictEqual(o.elements.find(e => e.role === 'AXButton').kind, 'nút');
  assert.strictEqual(o.elements.find(e => e.role === 'AXTextArea').value, 'abc');
  assert.strictEqual(U.findElement(o.elements, 'vùng soạn thảo').role, 'AXTextArea');
});
test('khớp cửa sổ theo tên ứng dụng / tiêu đề', () => {
  const list = [{ title: 'Zalo', proc: 'Zalo' }, { title: 'Tài liệu - Notepad', proc: 'notepad' }, { title: 'Untitled 1 - LibreOffice Writer', proc: 'soffice.bin' }];
  assert.strictEqual(U.matchWindow(list, 'zalo').title, 'Zalo');
  assert.strictEqual(U.matchWindow(list, 'Notepad').proc, 'notepad');
  assert.strictEqual(U.matchWindow(list, 'LibreOffice Writer').proc, 'soffice.bin');
  assert.strictEqual(U.matchWindow(list, 'Telegram'), null);
});
test('kịch bản PowerShell UIA/JXA có các phần cần thiết', () => {
  assert.match(U.PS_TREE, /UIAutomationClient/); assert.match(U.PS_TREE, /IsPassword/); assert.match(U.PS_TREE, /SetProcessDpiAwarenessContext/);
  assert.match(U.PS_FOCUS, /SetForegroundWindow/);
  assert.match(U.JXA_TREE, /AXSecureTextField/);
});
