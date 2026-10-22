'use strict';
// B94/B95/B96 (máy thật beta.2.2, self-send): tin gõ vào ô TÌM KIẾM (còn chữ “Cloud”), bấm mở tệp Excel ở danh sách File,
// rồi bấm đúng ô soạn mà type_text vẫn bị chặn “đã hỏng 2 lần”, câu cuối đổ lỗi cho Zalo.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const RT = require('../src/agent/retry'); const SV = require('../src/agent/send-verify');
const ROOT = path.join(__dirname, '..');
const MSG = 'AIVN test beta.2.2 - bỏ qua';
const typeA = { action: 'type_text', text: MSG };
const notSeen = { forModel: 'Kiểm tra: CHƯA thấy chữ vừa gõ trong danh sách phần tử' };

test('B95: guard keys on action + text + focus + screen — the real self-send steps 3/7/9', () => {
  const r = RT.createRetryTracker();
  // bước 3: con trỏ ở ô tìm kiếm (không đọc được) — màn hình A
  assert.strictEqual(r.before(typeA, '-#aaaa'), null); r.after(typeA, notSeen, '-#aaaa');
  // bước 7: sau khi bấm nhầm tệp — chỗ bấm khác, màn hình B
  assert.strictEqual(r.before(typeA, 'c:marketing cleaned data xlsx#bbbb'), null); r.after(typeA, notSeen, 'c:marketing cleaned data xlsx#bbbb');
  // bước 9: vừa bấm ô soạn “Nhập @, tin nhắn tới My Documents” → ngữ cảnh mới, KHÔNG bị chặn (trước: “đã hỏng 2 lần”)
  assert.strictEqual(r.before(typeA, 'c:nhap @, tin nhan toi my documents#cccc'), null);
  // cùng ngữ cảnh hỏng 2 lần thật → vẫn chặn
  r.after(typeA, notSeen, 'c:x#dddd'); r.after(typeA, notSeen, 'c:x#dddd');
  const pre = r.before(typeA, 'c:x#dddd'); assert.ok(pre && /đã hỏng 2 lần/.test(pre.summary));
  // bấm sang phần tử khác (focus đổi) cùng màn hình → tính lại
  assert.strictEqual(r.before(typeA, 'c:y#dddd'), null);
  // màn hình đổi (dấu khác) → tính lại
  assert.strictEqual(r.before(typeA, 'c:x#eeee'), null);
  // NHẦM ô là một kiểu “chưa có tác dụng”
  assert.strictEqual(RT.outcome({ forModel: 'Chữ vừa gõ đã vào NHẦM ô (“Cloud”)' }), 'chữ vào nhầm ô (không phải ô soạn tin)');
});

test('B95: the final answer must not blame Zalo', () => {
  const real = 'Đã thử nhiều cách nhưng chưa thể gửi tin "AIVN test beta.2.2 - bỏ qua" thành công trên Zalo. Có thể do ứng dụng Zalo đang gặp sự cố hoặc giao diện bị lỗi.';
  assert.ok(RT.blamesApp(real)); assert.ok(RT.blamesApp('Zalo may be having issues right now.')); assert.ok(RT.blamesApp('Zalo 可能出现问题'));
  for (const ok of ['Đã gửi tin cho My Documents.', 'Mình chưa gửi được: không thấy ô soạn tin.', 'Tin nhắn có nội dung “lỗi chính tả” đã gửi.']) assert.ok(!RT.blamesApp(ok), ok);
  const src = fs.readFileSync(path.join(ROOT, 'src/agent/agent.js'), 'utf8');
  assert.match(src, /RT\.blamesApp\(text\)/); assert.match(src, /retry\.before\(args, rctx\)/); assert.strictEqual((src.match(/retry\.after\(args, out, rctx\)/g) || []).length, 2);
  assert.match(fs.readFileSync(path.join(ROOT, 'src/agent/computer-tools.js'), 'utf8'), /actContext:/);
});

test('B94/B96 helpers: composer (vi/en/zh), never the search box; leftover search text; file targets', () => {
  for (const n of ['Nhập @, tin nhắn tới My Documents', '|Nhập @, tin nhắn tới My Documents', 'Type @ to mention, message to Lan', 'Message Lan', '输入 @，发送消息给 我的文档', 'Type a message']) assert.ok(SV.isComposerEl({ name: n }), n);
  for (const n of ['Tìm kiếm', 'Search', 'My Documents', 'marketing cleaned data.xlsx']) assert.ok(!SV.isComposerEl({ name: n, editable: true }), n);
  assert.ok(SV.isComposerEl({ name: '', editable: true, b: [300, 560, 400, 30] }, { b: [0, 0, 1000, 600] }), 'editable box at the bottom = composer with text');
  // không có khung cửa sổ: chữ gợi ý chung chung (có thể của cửa sổ khác, vd. AIVN) không được nhận là ô soạn; có khung: chỉ phần tử trong khung
  assert.strictEqual(SV.findComposer({ elements: [{ name: 'Nhập tin nhắn...', b: [400, 890, 200, 20], ocr: true }] }), null);
  assert.ok(SV.findComposer({ elements: [{ name: 'Nhập @, tin nhắn tới My Documents', b: [300, 590, 300, 20], ocr: true }] }));
  assert.strictEqual(SV.findComposer({ win: { b: [40, 40, 1000, 600] }, elements: [{ name: 'Nhập tin nhắn...', b: [400, 890, 200, 20], ocr: true }] }), null);
  assert.ok(SV.findComposer({ win: { b: [40, 40, 1000, 600] }, elements: [{ name: 'Aa', b: [400, 590, 200, 20], ocr: true }] }));
  assert.ok(!SV.nameLikeText(MSG, 'Cloud của tôi')); assert.ok(SV.nameLikeText('Cloud của tôi', 'Cloud của tôi')); assert.ok(SV.nameLikeText('cloud', 'Cloud của tôi'));
  const zalo = { win: { b: [0, 0, 1000, 600] }, elements: [{ name: 'Cloud', b: [20, 20, 60, 14], ocr: true }, { name: 'Đóng', b: [150, 20, 40, 14], ocr: true }, { name: 'My Documents', b: [250, 20, 90, 14], ocr: true }] };
  assert.strictEqual(SV.searchLeftover(zalo).name, 'Cloud');
  zalo.elements[0].name = 'Tìm kiếm'; assert.strictEqual(SV.searchLeftover(zalo), null, 'placeholder only = nothing to clear');
  // OCR thật gộp chữ trong ô với nút “Đóng”: “| Q AivN:estbera22-böqus Ø| Đóng” (bước 4 máy thật) và “I Đóng | My Documents”
  const W = { b: [40, 40, 1000, 600] };
  assert.match(SV.searchLeftover({ win: W, elements: [{ name: '| Q AivN:estbera22-böqus Ø| Đóng', b: [45, 110, 200, 16], ocr: true }] }).name, /AivN/);
  assert.strictEqual(SV.searchLeftover({ win: W, elements: [{ name: '| Cloud', b: [45, 110, 40, 16], ocr: true }, { name: 'I Đóng | My Documents', b: [190, 110, 120, 16], ocr: true }] }).name, '| Cloud');
  // tên tệp xuống dòng
  assert.ok(SV.fileAt({ name: 'marketing cleaned', b: [794, 240, 153, 17] }, { elements: [{ name: 'data.xlsx', b: [800, 262, 90, 17] }] }));
  assert.ok(!SV.fileAt({ name: 'My Documents', b: [794, 140, 153, 17] }, { elements: [{ name: 'data.xlsx', b: [800, 262, 90, 17] }] }));
  for (const f of ['marketing cleaned data.xlsx', 'bao cao.PDF', 'File', 'Ảnh/Video', '文件']) assert.ok(SV.isFileTarget(f), f);
  for (const f of ['My Documents', 'Gửi', 'Nhập @, tin nhắn tới My Documents']) assert.ok(!SV.isFileTarget(f), f);
  assert.ok(!SV.wantsFiles('gửi tin "AIVN test beta.2.2 - bỏ qua" cho Cloud của tôi trên Zalo'));
  assert.ok(!SV.wantsFiles('gửi tin "nhớ gửi file nhé" cho Lan'), 'file mentioned only inside the message text');
  assert.ok(SV.wantsFiles('gửi file báo cáo cho Lan trên Zalo')); assert.ok(SV.wantsFiles('mở tệp đính kèm Lan gửi'));
});

test('B94/B95/B96 thật (Electron + Xvfb, Zalo giả): self-send bước 3, 6, 8–9 + gõ nhầm ô + việc có tệp', { skip: !fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')) || spawnSync('which', ['xvfb-run']).status !== 0, timeout: 360000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b94-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b94u-'));
  spawnSync('timeout', ['330', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: ROOT, env: { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_QA_B21_MODE: 'b94', AIVN_DESK_AUTO: '1', OMP_NUM_THREADS: '4' }, stdio: 'ignore' });
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'qab21.json'), 'utf8')); const st = Object.fromEntries(d.steps.map(s => [s.name, s]));
  const log = fs.readFileSync(path.join(ud, 'logs', 'aivn.log'), 'utf8');
  assert.ok(!d.error, String(d.error)); assert.strictEqual(d.start.q, 'Cloud'); assert.strictEqual(d.start.focus, 'q');
  const M = 'AIVN test beta.2.3 - bỏ qua';
  // bước 3: chữ vào Ô SOẠN, ô tìm kiếm đã được xoá, chưa gửi gì
  const s1 = st['b94-type-body']; assert.ok(!s1.blocked, s1.forModel);
  assert.strictEqual(s1.state.comp, M, JSON.stringify(s1.state)); assert.strictEqual(s1.state.q, '', 'leftover “Cloud” cleared'); assert.deepStrictEqual(s1.state.sent, []);
  assert.match(log, /B94: (?:xoá chữ còn sót trong ô tìm kiếm|ô tìm kiếm đang mở \(thấy nút “Đóng”\))/); assert.match(log, /B94: bấm vào ô soạn tin/);
  // bước 6: không mở tệp
  const s2 = st['b96-click-file']; assert.ok(s2.blocked); assert.match(s2.forModel, /KHÔNG bấm “marketing cleaned[^”]*”: đây là tệp/); assert.deepStrictEqual(s2.state.opened, []);
  // bước 8–9: bấm ô soạn rồi gõ → vào ô soạn
  assert.ok(!st['b94-click-composer'].blocked, st['b94-click-composer'].forModel);
  const s4 = st['b94-type-after-click']; assert.ok(!s4.blocked, s4.forModel); assert.strictEqual(s4.state.comp, M, JSON.stringify(s4.state)); assert.ok(!String(s4.state.q).includes('AIVN'), 'nothing typed into the search box');
  // ô soạn “bẫy” (con trỏ nhảy về ô tìm kiếm): phát hiện chữ vào NHẦM ô, xoá chữ gõ nhầm, báo cho mô hình; tin không ở ô soạn, không gửi
  const s5 = st['b94-wrong-field']; assert.match(s5.forModel, /vào NHẦM ô/, s5.forModel); assert.strictEqual(RT.outcome({ forModel: s5.forModel }), 'chữ vào nhầm ô (không phải ô soạn tin)');
  assert.ok(!String(s5.state.comp).includes('lần hai')); assert.ok(!String(s5.state.q).includes('AIVN'), 'wrong text removed from the search box: ' + s5.state.q); assert.deepStrictEqual(s5.state.sent, []);
  // việc có nhắc tới tệp: phải qua thẻ xin phép (kể cả “không cần hỏi lại”)
  const s6 = st['b96-file-task']; assert.strictEqual(s6.asks.length, 1, JSON.stringify(s6.asks)); assert.match(s6.asks[0].risk || '', /mở tệp/);
  assert.deepStrictEqual(d.final.sent, []);
});
