'use strict';
// QA box beta.2.7 → B125 (đổi hệ số nghìn/triệu/tỷ khi đối chiếu số), B126 (thay URL tại chỗ, không để lời dẫn trơ trọi)
const test = require('node:test'); const assert = require('node:assert');
const G = require('../src/agent/grounding'); const AG = require('../src/agent/agent');
const now = { now: new Date('2026-10-22T13:00:00+07:00') };
// đúng trang của QA (probe.js)
const PAGE = 'BIỂU ĐỒ GIÁ VÀNG\nLOẠI (NGHÌN ĐỒNG/LƯỢNG)\tMUA\tBÁN\nHồ Chí Minh\t139,300\t142,300\nHuế\t139,300\t142,300\nCập nhật lúc 08:30 22/10/2026';

test('B125: “139,300 nghìn đồng/lượng” (hoặc 139.300) đối chiếu được “139.300.000 đồng/lượng” và “139,3 triệu” — cả hai chiều', () => {
  for (const page of ['Giá SJC 139,300 nghìn đồng/lượng', 'Giá SJC 139.300 nghìn đồng/lượng', PAGE]) {
    for (const a of ['139.300.000 đồng/lượng', '139,3 triệu', '139.300 nghìn đồng/lượng', '139,3 triệu đồng/lượng', '139.3 million VND', '0,1393 tỷ'])
      assert.deepStrictEqual(G.ungroundedNumbers(a, page, now), [], `${a} | ${page}`);
  }
  // chiều ngược: trang ghi đồng đầy đủ / triệu → câu trả lời ghi nghìn / triệu
  for (const page of ['Giá 139.300.000 đồng/lượng', 'Giá 139,3 triệu đồng/lượng'])
    for (const a of ['139.300 nghìn đồng/lượng', '139,3 triệu', '139.300.000 đồng']) assert.deepStrictEqual(G.ungroundedNumbers(a, page, now), [], `${a} | ${page}`);
  // QA đúng câu: B125
  assert.deepStrictEqual(G.ungroundedNumbers('Giá mua 139.300.000 đồng/lượng, bán 142.300.000 đồng/lượng', 'SJC Hồ Chí Minh 139,300 142,300 (nghìn đồng/lượng)', now), []);
});
test('B125: k, M, tỷ, en/zh (thousand, million, billion, 千, 万, 百万, 亿); số sai vẫn bị bắt', () => {
  const ok = (a, p) => assert.deepStrictEqual(G.ungroundedNumbers(a, p, now), [], `${a} | ${p}`);
  const bad = (a, p, tok) => assert.deepStrictEqual(G.ungroundedNumbers(a, p, now), [tok], `${a} | ${p}`);
  ok('giá 250k', 'Giá: 250.000 đ'); ok('250.000 đồng', 'Giá 250k'); ok('2,5 tỷ đồng', 'Giá nhà 2.500.000.000 đồng'); ok('2.500 triệu', 'Giá nhà 2,5 tỷ');
  ok('3 million', 'revenue 3,000,000'); ok('3M users', '3,000,000 users'); ok('1.2 billion', '1,200 million');
  ok('13930万元', '单位：千元 SJC 139,300'); bad('1393万元', '单位：千元 SJC 139,300', '1393'); ok('13930万', '139.300.000 đồng'); ok('1.393亿', '139,300,000'); ok('139.3百万', '139,300,000'); ok('5千', '5000');
  ok('139.300', PAGE); ok('142.300.000 đồng', PAGE);
  bad('139,4 triệu', PAGE, '139,4'); bad('139.400.000 đồng/lượng', PAGE, '139.400.000'); bad('250k', 'Giá 25.000 đ', '250');
  // chữ cái liền sau không phải hệ số: 8 MB, 5 kg, 3 Mbps
  assert.strictEqual(G.numbersWithScale('8 MB 5 kg 3 Mbps 4 trẻ').every(x => x.scale === 1), true);
  assert.strictEqual(G.pageScale(PAGE), 1e3); assert.strictEqual(G.pageScale('Đơn vị: triệu đồng'), 1e6); assert.strictEqual(G.pageScale('không có đơn vị'), 1);
});

const q = 'mở Chrome tìm "giá vàng SJC hôm nay", mở kết quả đầu tiên rồi báo cho mình giá và đường dẫn trang';
const S = [{ url: 'https://sjc.com.vn/bieu-do-gia-vang', kind: 'address' }];
const ws = (a) => AG.withSource(a, q, [], { sources: S, out: {} });
test('B126 (đúng chuỗi QA): URL lệch chỉ ở ?utm_… / chuyển hướng Google → THAY TẠI CHỖ bằng URL nguồn, không bỏ, không “Xem: ⏎⏎”', () => {
  assert.strictEqual(ws('Xem: https://sjc.com.vn/bieu-do-gia-vang?utm_source=google'), 'Xem: https://sjc.com.vn/bieu-do-gia-vang');
  assert.strictEqual(ws('Nguồn: https://www.google.com/url?q=https://sjc.com.vn/bieu-do-gia-vang&sa=U'), 'Nguồn: https://sjc.com.vn/bieu-do-gia-vang');
  const t = ws('Giá SJC: mua 139.300, bán 142.300.\nXem: [https://sjc.com.vn/bieu-do-gia-vang?utm_source=google&fbclid=x](https://sjc.com.vn/bieu-do-gia-vang?utm_source=google&fbclid=x)');
  assert.strictEqual(t, 'Giá SJC: mua 139.300, bán 142.300.\nXem: [https://sjc.com.vn/bieu-do-gia-vang](https://sjc.com.vn/bieu-do-gia-vang)');
  // tham số thật (không phải theo dõi) mà nguồn không có → không tự gán sai: nguồn khác đường dẫn thì vẫn thay theo nguồn gần nhất cùng trang
  assert.doesNotMatch(ws('Xem: https://sjc.com.vn/bieu-do-gia-vang?utm_source=google'), /utm_source|\n/);
});
test('B126: URL bị BỎ → bỏ luôn lời dẫn (“Xem:”, “Link:”, “Nguồn:”), không dòng trống; cảnh báo + URL nguồn ở cuối', () => {
  const FIX = 'Nguồn (đường dẫn thật trên thanh địa chỉ): https://sjc.com.vn/bieu-do-gia-vang';
  assert.strictEqual(ws('Nguồn: https://giavang.net/sjc'), FIX);
  assert.strictEqual(ws('Giá SJC: mua 139.300, bán 142.300.\nXem: https://giavang.net/sjc\nCảm ơn.'), 'Giá SJC: mua 139.300, bán 142.300.\nCảm ơn.\n\n' + FIX);
  assert.strictEqual(ws('Giá mua 139.300. Link: <https://giavang.net/sjc>. Hẹn gặp lại.'), 'Giá mua 139.300. Hẹn gặp lại.\n\n' + FIX);
  assert.strictEqual(ws('Giá mua 139.300.\n\nXem thêm: https://giavang.net/sjc\n\nChúc bạn một ngày tốt lành.'), 'Giá mua 139.300.\n\nChúc bạn một ngày tốt lành.\n\n' + FIX);
  for (const a of ['Source: https://giavang.net/sjc', 'See: https://giavang.net/sjc', '来源：https://giavang.net/sjc', '- Link: https://giavang.net/sjc']) {
    const t = ws(a); assert.ok(!/^\s*(?:-\s*)?(?:Source|See|来源|Link)\s*[:：]?\s*$/mu.test(t) && !/\n{3,}/.test(t) && !t.startsWith('\n'), JSON.stringify(t));
  }
});
