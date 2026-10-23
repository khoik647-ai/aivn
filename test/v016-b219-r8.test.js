'use strict';
// R8 (head dd101e1): elision apostrophes and no-diacritic negators must not hide a negation; nested quotes stay linear.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const SV = require('../src/agent/send-verify.js');
const ELISION = ["Send An: 'kay, see you — don't send 'til I confirm", "Text An 'kay see you, don't send it 'til I say so", "Send An 'hi — never mind, don't send 'cause I'll call", "Gửi cho An 'ok nha, đừng gửi 'nhé"];
const NODIAC = ['Send An hi, dont send', 'Send An hi. dont send it', 'Gui cho An, dung gui', 'Gui cho An hen mai, khong gui'];
for (const q of ELISION) test('R8-1 elision apostrophe refuses: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), false));
for (const q of NODIAC) test('R8-2 no-diacritic negator refuses: ' + q, () => assert.strictEqual(!!SV.allowsSend(q), false));
test('R8-3 nested quotes linear', () => {
  const t = (n) => { const q = 'Gửi cho An ' + '“'.repeat(n) + 'x' + '”'.repeat(n); const s = process.hrtime.bigint(); SV.allowsSend(q); return Number(process.hrtime.bigint() - s) / 1e6; };
  t(2000); const a = t(8000), b = t(32000);
  assert.ok(b < a * 6, `8k→32k: ${a.toFixed(0)}ms → ${b.toFixed(0)}ms`);
});
// (1a) một từ cấm phải chi phối động từ gửi, không phải hỏi/xác nhận.
test('R8-4 không cần hỏi lại vẫn là lệnh gửi', () => {
  assert.strictEqual(SV.allowsSend('Không cần hỏi lại, gửi cho An: hẹn mai'), true);
  assert.strictEqual(SV.allowsSend('gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại'), true);
  assert.strictEqual(SV.allowsSend('No need to ask again, send it to An'), true);
  assert.strictEqual(SV.allowsSend('不用再问，发给An：明天见'), true);
  assert.strictEqual(SV.allowsSend('Không cần gửi, xem thôi'), false);
  assert.strictEqual(SV.allowsSend('Read it, no need to send'), false);
  assert.strictEqual(SV.allowsSend('不用发给An，看看就行'), false);
});
// (1b) cổng B219 không chặn Enter ở ô tìm kiếm và không chặn bước chỉ gõ.
test('R8-5 cổng chỉ chặn bước gửi tin, không chặn ô tìm kiếm hay bước chỉ gõ', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  assert.doesNotMatch(src, /const SG = require\('\.\/agent\/send-gate'\)/);
  assert.match(src, /const SendGate = require\('\.\/agent\/send-gate'\)/);
  const fn = src.slice(src.indexOf('function blocksUnaskedSend'), src.indexOf('function searchConfirmed'));
  assert.match(fn, /searchConfirmed\(t, focusedEl, ax\)/);
  assert.match(fn, /if \(!\(enter \|\| typeSubmit\)\) return false/);
  assert.match(fn, /!SV\.allowsSend\(/);
});
// (5) ký tự rộng bằng không bị gỡ trước khi phân loại.
test('R8-6 zero-width stripped before classification', () => {
  assert.strictEqual(SV.allowsSend('Gửi cho An, đừ\u200bng gửi'), false);
  assert.strictEqual(SV.allowsSend('Send An hi, don\u200bt send'), false);
  assert.strictEqual(SV.allowsSend('Gui cho An, khong\u200b gui'), false);
  assert.strictEqual(SV.allowsSend('Không\u200bcần hỏi lại, gửi cho An: hẹn mai'), true);
  assert.strictEqual(SV.allowsSend('Gửi\u200b cho An: hẹn mai'), true);
  assert.strictEqual(SV.allowsSend('Gửi cho An: đừ\u200bng quên họp'), true);
});
