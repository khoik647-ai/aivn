'use strict';
// PR #91 review vòng 2 (head b23ed89). Chép vào test/ của repo rồi chạy: node --test test/v016-b219-r2.test.js
// Hoặc: AIVN_DIR=/path/to/repo node --test v016-b219-r2.test.js
const test = require('node:test'); const assert = require('node:assert'); const path = require('path');
const DIR = process.env.AIVN_DIR || path.join(__dirname, '..');
const SV = require(DIR + '/src/agent/send-verify'); const SG = require(DIR + '/src/agent/send-gate');
const { riskOf } = require(DIR + '/src/agent/desk-policy'); const Q = require(DIR + '/src/qa-runner');
// giống desktop-agent.js act(): gateState (l.884-888) → classify → riskOf (l.953) → performAt sendLike (l.417-422)
function pressGated(q, keys) {
  const st = { chatOpen: false, recipient: SV.recipientOf(q), messaging: !!SV.msgSend(q), searchTarget: false, lastTyped: '', targetName: ' ', inComposerRow: false };
  if (SG.classify('hotkey', { keys }, st).send) return true;
  return !!riskOf('hotkey', { keys, lastAction: { action: 'screen_look' } });
}
const qa = (q, steps) => Q.statusOf({ outcome: 'done', text: 'Done.', steps }, { task: q, draft: SV.DRAFT_ONLY.test(q) }).status;

test('R2-A: câu chỉ nhìn ô soạn (đã có bản nháp sẵn) — Ctrl+Enter / Alt+S / Enter không được bấm im lặng', () => {
  for (const q of ['Nhìn ô soạn tin đang có chữ gì? Chỉ nhìn, đừng gửi.', 'Look at the message box and tell me if it is empty (don\'t send).', '看看消息输入框里有什么？只看，不要发送。', 'Đừng gửi gì cả, chỉ xem ô soạn tin thôi'])
    for (const k of ['ctrl+enter', 'alt+s', 'enter']) assert.ok(pressGated(q, k), `${k} lọt cổng: ${q}`);
});
test('R2-B: lệnh gửi thật không được thành câu chỉ nhìn (vi/en/zh, không dấu)', () => {
  // “có … không + động từ gửi” và “chẳng lẽ không gửi” không còn là lệnh gửi: từ “không/chẳng” ở bất kỳ đâu cũng cấm gửi.
  const refused = ['Xem ô soạn tin có chữ gì không gửi tin cho An luôn', 'Xem ô soạn tin có gì không nhắn An luôn',
    'Kiểm tra ô soạn tin có trống không gửi tin cho Lan', 'Xem ô soạn tin, chẳng lẽ không gửi tin cho An?'];
  for (const q of refused) { assert.strictEqual(SV.allowsSend(q), false, q); assert.strictEqual(SV.lookOnly(q), true, q); }
  const sends = ['Đừng chỉ xem ô soạn tin, gửi luôn cho An', 'Xem ô soạn tin rồi gửi luôn cho An', 'Xem ô soạn tin rồi gửi giúp mình cho An', 'Nhìn ô soạn tin rồi gửi An nhé',
    'Xem ô soạn tin rồi gui cho An', 'Đọc ô soạn tin rồi bấm nút gửi', 'Xem ô soạn tin. Gửi.', 'Xem ô soạn tin (rồi gửi luôn nhé)', 'Đừng gửi cho Lan, xem ô soạn tin rồi gửi An',
    'Check the message box then press Ctrl+Enter', 'Look at the message box then press alt+s', 'Check the message box and reply "ok"',
    'Look at the message box then text An "hi"', 'Check the message box and forward it to An', 'Check the message box and submit it', 'Look at the message box and post it to An',
    'xem message box roi gui cho An', '看看消息输入框，然后发出去', '看看消息输入框里有什么，然后回复An', '看看输入框然后按回车', '看一下消息框，有字就发'];
  const bad = sends.filter(q => SV.lookOnly(q));
  assert.deepStrictEqual(bad, [], 'gửi thật bị coi là chỉ nhìn');
  for (const q of sends) assert.strictEqual(qa(q, [{ name: 'screen_look', status: 'ok' }]), 'failed', 'QA cho “xong” dù không có bằng chứng đã gửi: ' + q);
});
test('R2-C: quotedIn/textFromRequest tuyến tính theo độ dài câu (không gọi lại sourceQuery mỗi vòng)', () => {
  const s = 'Nhìn ô soạn tin có chữ "hi" (x) không? '.repeat(500);
  const t0 = Date.now(); SV.textFromRequest(s, 'zz'); assert.ok(Date.now() - t0 < 100, `${Date.now() - t0} ms cho ${s.length} ký tự`);
});
test('R2-D: câu chỉ nhìn gốc của #85 vẫn là chỉ nhìn (vi/en/zh)', () => {
  for (const q of ['Nhìn ô soạn tin đang có chữ gì? Chỉ nhìn, đừng gửi.', 'Look at the message box and tell me if it is empty (don\'t send).', '看看消息输入框里有什么？只看，不要发送。',
    'Is "hi" in the message box?', 'Nhìn ô soạn tin có chữ "hi" không?', '看看消息输入框里有没有"你好"', "Don't send anything, just look at the message box", '不要发消息，只看一下消息输入框']) {
    assert.strictEqual(SV.lookOnly(q), true, q); assert.strictEqual(SV.missingRecipient(q), false, q);
  }
});
