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
