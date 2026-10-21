'use strict';
// B86 (máy thật, beta.3-pre, Zalo): bộ chặn chu kỳ B66b coi “bấm ô tìm → gõ → bấm kết quả → gõ tin” là chu kỳ 2 bước
// (chữ ký bỏ phần tử đã bấm — e4/e138 đều thành e# — và dùng chữ mô hình đưa thay vì chữ thật đã gõ) → dừng nhầm ngay khi sắp gửi được
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const C = require('../src/agent/cycle');
const ok = (summary, sig) => ({ summary, sig });
test('B86: chuỗi thật trên Zalo (bấm Tìm kiếm → gõ tên → bấm kết quả → gõ tin) KHÔNG phải chu kỳ', () => {
  const g = C.createCycleGuard();
  g.push('open_app', { name: 'Zalo' }, ok('Dùng cửa sổ đang mở “Zalo”'));
  g.push('screen_look', { window: 'Zalo' }, ok('“Zalo” · 93 phần tử'));
  g.push('screen_act', { action: 'click', element: 'e4' }, ok('bấm chữ (OCR) “Q Tìm kiếm” · OCR', { target: 'ocr:Q Tìm kiếm', typed: null, screen: 'a1' }));
  g.push('screen_act', { action: 'type_text', text: 'AIVN test - thử beta.3-pre' }, ok('gõ “Cloud của tôi” vào ô đang chọn', { target: '', typed: 'Cloud của tôi', screen: 'b2' }));
  g.push('screen_act', { action: 'click', element: 'e138' }, ok('bấm chữ (OCR) “Tên cũ: Cloud của tôi” · OCR', { target: 'ocr:Tên cũ: Cloud của tôi', typed: null, screen: 'c3' }));
  g.push('screen_act', { action: 'type_text', text: 'AIVN test - thử beta.3-pre' }, { error: 'chưa mở đúng người nhận', summary: 'chưa mở đúng người nhận', sig: { target: '', typed: null, screen: 'c3' } });
  assert.strictEqual(g.stuck(), null);
});
test('B86: vòng lặp THẬT (cùng phần tử, cùng chữ, màn hình lặp lại) vẫn bị bắt', () => {
  const g = C.createCycleGuard();
  for (let i = 0; i < 2; i++) {
    g.push('screen_act', { action: 'click', element: 'e' + (4 + i * 10) }, ok('bấm “Cài đặt”', { target: 'button:Cài đặt', screen: 'x1' }));
    g.push('screen_act', { action: 'hotkey', keys: 'win+d' }, ok('bấm phím win+d', { target: '', screen: 'x2' }));
  }
  assert.strictEqual(g.stuck() && g.stuck().kind, 'cycle');
  // không có sig (công cụ khác) → như cũ
  const h = C.createCycleGuard(); for (let i = 0; i < 2; i++) { h.push('open_app', { name: 'Cài đặt' }, ok('mở')); h.push('screen_look', {}, ok('xem')); }
  assert.strictEqual(h.stuck().kind, 'cycle');
});
test('B86: chữ ký dùng phần tử thật + chữ thật; desktop-agent báo sig cho mỗi thao tác; agent truyền sig vào bộ chặn', () => {
  assert.notStrictEqual(C.stepSig('screen_act', { action: 'click', element: 'e4' }, { target: 'ocr:Tìm kiếm' }), C.stepSig('screen_act', { action: 'click', element: 'e138' }, { target: 'ocr:Tên cũ: Cloud của tôi' }));
  assert.match(C.stepSig('screen_act', { action: 'type_text', text: 'tin' }, { typed: 'Cloud của tôi' }), /text=cloud cua toi/);
  const da = fs.readFileSync(path.join(__dirname, '../src/desktop-agent.js'), 'utf8'); assert.match(da, /r\.sig = \{ target:/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/agent/agent.js'), 'utf8'), /sig: out\.sig/);
});
