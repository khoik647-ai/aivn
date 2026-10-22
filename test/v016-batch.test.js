'use strict';
// 0.16: bước nhanh — bấm ô + dán chữ + Enter trong MỘT lần gọi screen_act (submit), dán cả đoạn một lần trên mọi hệ điều hành,
// mô tả công cụ ngắn gọn. Kiểm thử thật bằng Electron: AIVN_QA_DESK016 (src/main.js qaDesk016) — gõ tiếng Việt có dấu, Enter, kiểm chứng gửi.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const CT = require('../src/agent/computer-tools'); const TP = require('../src/agent/textproto'); const { riskOf } = require('../src/agent/desk-policy'); const SV = require('../src/agent/send-verify');

test('screen_act có tham số submit; mô tả (đầy đủ và gọn) nói rõ gộp bấm ô + gõ + Enter vào MỘT lần gọi', () => {
  const d = CT.DEFS.screen_act; assert.strictEqual(d.parameters.properties.submit.type, 'boolean');
  assert.match(d.description, /MỘT lần gọi/); assert.match(d.description, /dán cả đoạn một lần/);
  const lean = TP.leanTools([{ name: 'screen_act', ...d }])[0]; assert.match(lean.description, /submit: true/); assert.ok(lean.parameters.properties.submit);
  assert.ok(d.description.length < 700, 'mô tả screen_act ngắn: ' + d.description.length);
});
test('submit = bước gửi: luôn hỏi người dùng (rủi ro) và được kiểm chứng gửi như Enter', () => {
  assert.match(riskOf('type_text', { text: 'xin chào\n' }), /gửi tin nhắn/);
  assert.strictEqual(riskOf('type_text', { text: 'xin chào' }), null);
  assert.ok(SV.isSendAction('type_text', { text: 'xin chào\n' }));
  const src = rd('src/desktop-agent.js');
  assert.match(src, /text: action === 'type_text' && a\.submit \? a\.text \+ '\\n' : a\.text/, 'riskOf nhận chữ + Enter khi submit');
  assert.match(src, /const sendA = action === 'type_text' && a\.submit \? \{ \.\.\.a, text: a\.text \+ '\\n' \} : a;/);
  assert.match(src, /if \(action === 'type_text' && a\.__submit\) \{ if \(!a\.__beforeSubmit \|\| await a\.__beforeSubmit\(\)\) \{ await sleep\(150\); n\.keyTap\('enter'\); \} else a\.__submitSkipped = true; \}/ /* B101: kiểm chữ trong ô soạn trước Enter */);
  // chữ có xuống dòng cuối → bỏ "\n", bấm Enter thật (dán "\n" không gửi được ở nhiều ứng dụng chat)
  assert.match(src, /submit: a\.submit === true \|\| a\.submit === 'true' \|\| tail/);
});
test('Linux cũng dán cả đoạn (xdotool type làm rơi chữ có dấu: “xin chào” → “xin cho”) — chỉ dùng xdotool khi đặt AIVN_TYPE_XDOTOOL=1', () => {
  const src = rd('src/desktop-agent.js');
  assert.match(src, /process\.platform === 'linux' && process\.env\.AIVN_TYPE_XDOTOOL === '1'/);
});
test('lời nhắc hệ thống hướng dẫn nhắn tin bằng MỘT lần gọi type_text + submit', () => {
  const a = rd('src/agent/agent.js'); assert.match(a, /element = ô soạn tin và submit: true \(một lần gọi/);
});
test('kết quả kiểm thử thật gần nhất (nếu có): gửi đúng chữ có dấu, hỏi trước khi gửi, gõ thường không gửi', { skip: !fs.existsSync('/workspace/qa-0.16/desk/qadesk016.json') }, () => {
  const d = JSON.parse(fs.readFileSync('/workspace/qa-0.16/desk/qadesk016.json', 'utf8'));
  assert.strictEqual(d.submit.log, 'SENT:xin chào Lan\n'); assert.ok(d.submit.asks[0].risk); assert.ok(d.submit.verify.sent);
  assert.match(d.newline.log, /SENT:hẹn gặp lúc 7 giờ\n$/);
  assert.strictEqual(d.plain.value, 'chưa gửi'); assert.strictEqual(d.plain.asks[0].risk, null);
  assert.ok(d.long.exact);
});
