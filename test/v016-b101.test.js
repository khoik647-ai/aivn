'use strict';
// B101–B106 (QA beta.2.4, máy thật): AIVN tự gửi sau khi gõ (qua thẻ xin phép), giữ chốt người nhận khi chữ gợi ý ô soạn biến mất,
// chống lặp chu kỳ dài (≤ 8 bước), dọn chữ đã gõ khi thất bại + luôn có finalAnswer, i18n chữ Việt không dấu, commit ở mọi result.json.
// Phần chạy thật trên Zalo giả (Electron) ở test/v016-b101-electron.test.js.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const SV = require('../src/agent/send-verify');
const CY = require('../src/agent/cycle');
const VD = require('../src/i18n/vi-detect');
const QR = require('../src/qa-runner');

// toạ độ theo ảnh chụp thật (Zalo 3 cột, 1024×576) — như test/v016-b85
const base = [
  { name: 'Cloud của tôi', b: [55, 22, 95, 12], ocr: true }, { name: 'My Documents', b: [70, 87, 56, 11], ocr: true },
  { name: 'Q My Documents', b: [243, 18, 70, 12], ocr: true }, { name: 'Lưu và đồng bộ dữ liệu giữa các thiết bị', b: [243, 33, 125, 9], ocr: true }, { name: '2158', b: [330, 18, 20, 8], ocr: true },
  { name: 'Thông tin hội thoại', b: [886, 22, 92, 12], ocr: true }, { name: 'bỏ dòng zalo', b: [745, 400, 60, 10], ocr: true }];
const W = { title: 'Zalo', proc: 'Zalo.exe', b: [0, 0, 1024, 576] };
const withPlaceholder = { win: W, elements: [...base, { name: 'Nhập @, tin nhắn tới My Documents', b: [211, 558, 125, 10], ocr: true }] };
const afterTyping = { win: W, elements: [...base, { name: 'AIVN test beta.2.5 - bỏ qua', b: [211, 558, 110, 10], ocr: true }] };

test('B102: gõ xong (chữ gợi ý ô soạn biến mất) vẫn nhận tiêu đề khung giữa — nhớ mép khung chat của cùng cửa sổ', () => {
  const r1 = SV.regionsOf(withPlaceholder); assert.ok(r1.header.some(h => /My Documents/.test(h)), JSON.stringify(r1));
  const r2 = SV.regionsOf(afterTyping); assert.ok(r2.header.some(h => /My Documents/.test(h)), 'mất tiêu đề sau khi gõ: ' + JSON.stringify(r2));
  assert.ok(!r2.list.some(h => /^Q My Documents$/.test(h)));
  // cửa sổ khác (khung khác) không dùng lại mép đã nhớ
  const other = { win: { title: 'Zalo', proc: 'Zalo.exe', b: [0, 0, 1280, 720] }, elements: afterTyping.elements };
  const r3 = SV.regionsOf(other); assert.ok(r3.list.length >= 1);
});
test('B102: chatGate sau khi gõ (không còn chữ gợi ý, chốt bị bỏ do bấm chỗ khác) → chốt lại theo tiêu đề đã làm sạch', () => {
  SV.regionsOf(withPlaceholder);
  const R = SV.regionsOf(afterTyping); const state = { chatOpen: null, aliases: [] };
  const why = SV.chatGate({ query: 'Nhắn tin cho My Documents trên Zalo: "AIVN test beta.2.5 - bỏ qua"', text: 'AIVN test beta.2.5 - bỏ qua', submit: true, proc: 'Zalo.exe', title: 'Zalo', state, header: R.header, composer: R.composer });
  assert.strictEqual(why, null, String(why)); assert.strictEqual(state.chatOpen, SV.nameKey ? SV.nameKey('My Documents') : state.chatOpen);
  // tiêu đề là người KHÁC → vẫn chặn
  const st2 = { chatOpen: null };
  const why2 = SV.chatGate({ query: 'Nhắn tin cho My Documents trên Zalo: "x y z"', text: 'x y z', submit: true, proc: 'Zalo.exe', title: 'Zalo', state: st2, header: ['Q Trần Văn Bình', '21:58'], composer: [] });
  assert.ok(why2, 'người khác phải bị chặn');
});

test('B103: chu kỳ 7 bước (máy thật beta.2.4) bị bắt sau 2 lượt, kể cả khi dấu màn hình khác nhau mỗi vòng', () => {
  const g = CY.createCycleGuard();
  const cyc7 = [['screen_act', { action: 'click', element: 'e12' }, { refused: true, summary: 'không còn trên màn hình', sig: { target: 'text:Đồng' } }],
    ['screen_look', {}, { summary: 'Zalo 70 phần tử' }], ['screen_act', { action: 'click', element: 'e3' }, { summary: 'bấm Q Tìm kiếm', sig: { target: 'text:Q Tìm kiếm' } }],
    ['screen_act', { action: 'type_text', text: 'AIVN test' }, { refused: true, summary: 'chưa thấy ô soạn tin', sig: { typed: 'AIVN test' } }],
    ['screen_look', {}, { summary: 'Zalo 69 phần tử' }], ['screen_act', { action: 'click', element: 'e40' }, { summary: 'bấm chữ', sig: { target: 'text:AIVN test' } }],
    ['screen_act', { action: 'hotkey', keys: 'escape' }, { summary: 'esc' }]];
  let caught = null; let n = 0;
  for (let rep = 0; rep < 3 && !caught; rep++) for (const [nm, a, o] of cyc7) { n++; g.push(nm, a, { ...o, sig: { ...(o.sig || {}), screen: 'h' + n } }); const s = g.stuck(); if (s && !caught) { caught = { ...s, n }; break; } }
  assert.ok(caught, 'không bắt được chu kỳ 7 bước'); assert.strictEqual(caught.kind, 'cycle'); assert.strictEqual(caught.period, 7); assert.ok(caught.n <= 14, 'bắt muộn: ' + caught.n);
  assert.match(caught.why, /chuỗi 7 thao tác/);
  // 8 bước cũng bắt
  assert.strictEqual(CY.findCycle(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).period, 8);
  // chu kỳ ngắn (2 bước) vẫn cần CÙNG màn hình (B86: tìm → gõ → bấm kết quả → gõ không phải lặp)
  assert.strictEqual(CY.findCycle(['click(x)@1', 'type(y)@2', 'click(x)@3', 'type(y)@4']), null);
  assert.ok(CY.findCycle(['click(x)@1', 'type(y)@2', 'click(x)@1', 'type(y)@2']));
});

test('B104: finalAnswer luôn có — hết giờ không có câu trả lời, kèm trạng thái chữ còn trong ô soạn', () => {
  const st = QR.statusOf(null, { timedOut: true });
  const a1 = QR.finalAnswerOf(null, st, { timedOut: true, timeout: 300 }); assert.match(a1, /hết thời gian \(--timeout 300 giây\)/);
  const a2 = QR.finalAnswerOf({ text: '' , outcome: 'failed' }, st, { timedOut: true, timeout: 300, draft: { text: 'AIVN test beta.2.5 - bỏ qua', cleared: true, left: false } });
  assert.match(a2, /hết thời gian/); assert.match(a2, /đã được xoá/);
  const a3 = QR.finalAnswerOf(null, { status: 'failed', reason: 'không có kết quả' }, { draft: { text: 'abc', cleared: false, left: true, why: 'lượt bị dừng — AIVN không thao tác thêm' } });
  assert.match(a3, /VẪN CÒN trong ô soạn tin/);
  assert.strictEqual(QR.finalAnswerOf({ text: 'Đã gửi.' }, { status: 'done' }), 'Đã gửi.');
  const run = fs.readFileSync(path.join(ROOT, 'src/qa-runner.js'), 'utf8'); assert.match(run, /ac\.abort\('timeout'\)/);
  const ag = fs.readFileSync(path.join(ROOT, 'src/agent/agent.js'), 'utf8'); assert.match(ag, /cleanupDraft\(\{ clear: !\(signal\?\.aborted && signal\.reason !== 'timeout'\) \}\)/);
  const mn = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8'); assert.match(mn, /desk\.hasDraft && desk\.hasDraft\(\)\) \{ try \{ await desk\.cleanupDraft/);
});

test('B105: chữ Việt không dấu trong en/zh bị bắt (cả chữ HOA do CSS), không bắt nhầm tiếng Anh/tên tệp; “CUDA 12.4 cho GPU NVIDIA” đã dịch', () => {
  for (const t of ['CUDA 12.4 CHO GPU NVIDIA', 'Khong tim thay', 'nguoi dung', 'Dang tai xuong']) assert.ok(VD.looksVi(t), t);
  for (const t of ['CUDA 12.4 for NVIDIA GPUs', 'Open the GUI', 'Return on investment (ROI)', 'Choose them', 'May I ban the tin can', 'read bao-cao.csv then write tom-tat.md', 'Tim Cook', 'Hai Phong']) assert.ok(!VD.looksUnaccentedVi(t), t);
  const en = require('../src/i18n/en.js'), zh = require('../src/i18n/zh.js');
  for (const D of [en, zh]) { const fp = Object.values(D).filter(v => VD.looksUnaccentedVi(v)); assert.deepStrictEqual(fp, [], 'từ điển en/zh bị coi là tiếng Việt: ' + fp.join(' | ')); }
  assert.strictEqual(en['CUDA 12.4 cho GPU NVIDIA'], 'CUDA 12.4 for NVIDIA GPUs'); assert.ok(zh['CUDA 12.4 cho GPU NVIDIA'] && !VD.looksVi(zh['CUDA 12.4 cho GPU NVIDIA']));
  assert.ok(require('../src/i18n/strings.json').includes('CUDA 12.4 cho GPU NVIDIA'), 'trích chuỗi phải lấy cả chữ Việt không dấu trong HTML');
  const QU = require('../src/qa-ui'); assert.deepStrictEqual(QU.i18nIssues(['CUDA 12.4 CHO GPU NVIDIA'], 'en').map(x => x.kind), ['vi-in-en']);
  assert.deepStrictEqual(QU.i18nIssues(['CUDA 12.4 for NVIDIA GPUs', 'NGUYỄN NGỌC KHÔI SINH VIÊN VLU'], 'en'), []);
  const mn = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8'); assert.match(mn, /VD\.looksVi\(x\.t\)/);
});

test('B106: mọi đường thoát sớm ghi result.json có version + commit + finalAnswer', () => {
  const mn = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  const writes = mn.match(/QAR\.writeJson\([^;]*/g) || []; assert.ok(writes.length >= 3);
  for (const w of writes) assert.match(w, /qaStamp\(|QAR\.writeJson\(args\.out, r\)/, w.slice(0, 120));
  assert.match(mn, /function qaStamp\(o\) \{ return \{ schema: 1, version: .*commit: qaCommit\(\)/);
});

test('B101: mã nguồn — tự bấm Enter qua bước GỬI, kiểm chữ trước Enter (log B94), xong việc khi đã kiểm chứng', () => {
  const s = fs.readFileSync(path.join(ROOT, 'src/desktop-agent.js'), 'utf8');
  assert.match(s, /bodyTyping && action === 'type_text' && !a\.submit && s\.chatOpen && !DRAFT_SEND\.test/);
  // tự gửi phải đặt submit TRƯỚC khi xếp loại bước gửi (thẻ xin phép / --approve-send-to vẫn áp dụng)
  assert.ok(s.indexOf('__autoSubmit: true') < s.indexOf('SendGate.classify'), 'B101 phải trước SendGate.classify');
  assert.match(s, /a\.__beforeSubmit = async/); assert.match(s, /B94: kiểm chữ sau khi gõ/);
  assert.match(s, /if \(!a\.__beforeSubmit \|\| await a\.__beforeSubmit\(\)\) \{ await sleep\(150\); n\.keyTap\('enter'\); \}/);
  const ag = fs.readFileSync(path.join(ROOT, 'src/agent/agent.js'), 'utf8'); assert.match(ag, /out\.sentDone && out\.verify && out\.verify\.sent/);
});
