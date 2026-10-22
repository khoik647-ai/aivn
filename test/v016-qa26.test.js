'use strict';
// QA máy thật beta.2.6 → B118–B124
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const G = require('../src/agent/grounding'); const AG = require('../src/agent/agent');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---------- B118: đường dẫn nguyên văn từ nguồn, href === chữ ----------
const SJC_ANS = 'Giá vàng SJC hôm nay (ngày 22/10/2026) được cập nhật trên trang web của SJC:\n\n- **Huế**: Mua 139.300 ₫ - Bán 142.300 ₽\n- **Cà Mau**: Mua 141.000 ₫ - B bán 139.30\n\nBạn có thể xem chi tiết tại: [https://sjc.com.vn/bieu-do-gia-vang](https://sjc.com.vn/bieu-do-giavang)\n\n*(Lưu ý: Một số khu vực như Miền Tây có giá thấp hơn do điều kiện địa phương)*';
const WX_ANS = 'Nhiệt độ tại TP.HCM hôm nay là **33°C**, độ ẩm 68%, gió hướng Tây Nam tốc độ 1m/s.\nĐường dẫn trang web: [https://nchmf.gov.vn/kttvsite/vi-VN/1/sai-gon-tp-ho-chi-minh-w15.html](https://nchmf.gov.vn/kttvside/vi-VN/1/Sai-Gon-TP-Ho-Chi-Minh-W15.html)';
const SJC_URL = 'https://sjc.com.vn/bieu-do-gia-vang'; const WX_URL = 'https://nchmf.gov.vn/kttvsite/vi-VN/1/sai-gon-tp-ho-chi-minh-w15.html';
const links = (t) => [...t.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(m => [m[1], m[2]]);
test('B118: QA đúng chuỗi — link viết lại thành [nguồn](nguồn), không cảnh báo khi đã đối chiếu được', () => {
  const qa = 'mở Chrome tìm "giá vàng SJC hôm nay", mở kết quả đầu tiên rồi báo cho mình giá và đường dẫn trang';
  const qw = 'mở Chrome tìm "thời tiết TP.HCM hôm nay", mở kết quả đầu tiên rồi báo cho mình nhiệt độ và đường dẫn trang';
  for (const [ans, url, q] of [[SJC_ANS, SJC_URL, qa], [WX_ANS, WX_URL, qw]]) {
    const out = {}; const t = AG.withSource(ans, q, [], { sources: [{ url, kind: 'address' }], out });
    const L = links(t); assert.strictEqual(L.length, 1, t); assert.deepStrictEqual(L[0], [url, url], 'href === chữ hiển thị === nguồn');
    assert.ok(!t.includes(AG.SOURCE_UNSEEN_MSG), 'đã đối chiếu → không cảnh báo'); assert.deepStrictEqual(out.sources, [{ url, kind: 'address' }]);
    assert.ok(!/bieu-do-giavang|kttvside|Sai-Gon-TP/.test(t), t);
  }
  // nguồn chỉ có chữ OCR của thanh địa chỉ → vẫn sửa href, nhưng cảnh báo “chưa đối chiếu” LUÔN có (nhất quán)
  const msgs = [{ role: 'tool', content: 'e1 chữ (OCR) "nchmf.gov.vn/kttvsite/vi-VN/1/sai-gon-tp-ho-chi-minh-w15.html" @300,40' }];
  const t2 = AG.withSource(WX_ANS, qw, msgs); assert.ok(t2.includes(AG.SOURCE_UNSEEN_MSG), t2); assert.deepStrictEqual(links(t2)[0], ['https://nchmf.gov.vn/kttvsite/vi-VN/1/sai-gon-tp-ho-chi-minh-w15.html', 'https://nchmf.gov.vn/kttvsite/vi-VN/1/sai-gon-tp-ho-chi-minh-w15.html']);
  // không có nguồn nào → không tạo link (href có thể sai), giữ chữ hiển thị + cảnh báo
  const t3 = AG.withSource(WX_ANS, qw, []); assert.strictEqual(links(t3).length, 0, t3); assert.ok(t3.includes(WX_URL) && !t3.includes('kttvside')); assert.ok(t3.includes(AG.SOURCE_UNSEEN_MSG));
});
test('B118: so khớp chính xác (đường dẫn phân biệt hoa thường, dấu “-”), gần đúng → nguồn gần nhất, khác trang → bỏ', () => {
  const S = [{ url: SJC_URL, kind: 'address' }];
  assert.strictEqual(G.nearestSource('https://sjc.com.vn/bieu-do-giavang', S).exact, false);
  assert.strictEqual(G.nearestSource('sjc.com.vn/bieu-do-gia-vang/', S).exact, true);
  assert.strictEqual(G.nearestSource('https://www.SJC.com.vn/bieu-do-gia-vang', S).exact, true, 'tên miền không phân biệt hoa thường');
  assert.strictEqual(G.nearestSource('https://sjc.com.vn/Bieu-Do-Gia-Vang', S).exact, false, 'đường dẫn phân biệt hoa thường');
  const f = G.fixUrls('Xem https://sjc.com.vn/bieu-do-giavang. Hoặc https://khac.vn/abc', S);
  assert.strictEqual(f.text, 'Xem https://sjc.com.vn/bieu-do-gia-vang. Hoặc'); assert.strictEqual(f.replaced, 1); assert.strictEqual(f.dropped, 1);
  const w = AG.withSource('Giá mua vào 118.500, nguồn: https://giavang.example.vn/sjc', 'tìm giá vàng trên Chrome, kèm đường dẫn nguồn', [], { sources: [{ url: 'https://sjc.com.vn/gia-vang-online', kind: 'address' }] });
  assert.match(w, /Nguồn \(đường dẫn thật trên thanh địa chỉ\): https:\/\/sjc\.com\.vn\/gia-vang-online$/); assert.ok(!w.includes('giavang.example'));
  const ft = G.sourcesFromMsgs([{ role: 'tool', content: 'URL cuối: https://thoitiet.vn/ho-chi-minh\nĐã tải 12 KB' }]); assert.deepStrictEqual(ft, [{ url: 'https://thoitiet.vn/ho-chi-minh', kind: 'fetch' }]);
});
test('B118: giao diện chỉ tạo link khi chữ === href; agent đọc thanh địa chỉ nguyên văn qua bộ nhớ tạm', () => {
  const a = src('src/renderer/app.js'); const i = a.indexOf('function mdLinks'); const j = a.indexOf('\n}\n', i) + 2;
  const mdLinks = new Function(a.slice(i, j) + '; return mdLinks;')();
  assert.strictEqual(mdLinks(`[${SJC_URL}](${SJC_URL})`), `<a href="${SJC_URL}" target="_blank" rel="noopener">${SJC_URL}</a>`);
  assert.ok(!mdLinks('[https://sjc.com.vn/bieu-do-gia-vang](https://sjc.com.vn/bieu-do-giavang)').includes('<a '), 'chữ khác href → không bao giờ thành link');
  assert.match(mdLinks('xem https://a.vn/x.'), /<a href="https:\/\/a\.vn\/x" [^>]*>https:\/\/a\.vn\/x<\/a>\./);
  const d = src('src/desktop-agent.js'); assert.match(d, /async function readBrowserPage/); assert.match(d, /\['l', mod, 250\], \['c', mod, 300\]/); assert.match(d, /clip\.writeText\(prev\.text/);
  assert.match(src('src/qa-runner.js'), /sources: r && Array\.isArray\(r\.sources\)/);
});

// ---------- B119: số liệu bám trang ----------
const PAGE = 'BIỂU ĐỒ GIÁ VÀNG\nLOẠI (NGHÌN ĐỒNG/LƯỢNG)\tMUA\tBÁN\nHồ Chí Minh\t139,300\t142,300\nHà Nội\t139,300\t142,300\nHuế\t139,300\t142,300\nCà Mau\t139,300\t142,300\nCập nhật lúc 08:30 22/10/2026';
test('B119: nhận ra số sai, ký hiệu tiền lạ, nhận định không có trên trang (đúng câu trả lời QA)', () => {
  assert.deepStrictEqual(G.ungroundedNumbers(SJC_ANS, PAGE, { now: new Date('2026-10-22T10:00:00+07:00') }), ['141.000']);
  assert.deepStrictEqual(G.stripStrayCurrency(SJC_ANS, PAGE).removed.sort(), ['₫', '₫', '₽'].sort());
  assert.strictEqual(G.unsupportedClaims(SJC_ANS, PAGE).length, 1); assert.strictEqual(G.unitOf(PAGE), 'nghìn đồng/lượng');
  // định dạng số Việt/Anh, đơn vị
  for (const ok of ['Mua 139.300, bán 142.300 nghìn đồng/lượng', 'Mua 139,300 bán 142,300', 'mua 139,3 triệu, bán 142,3 triệu đồng/lượng']) assert.deepStrictEqual(G.ungroundedNumbers(ok, PAGE), [], ok);
  assert.deepStrictEqual(G.ungroundedNumbers('Nhiệt độ 33°C, độ ẩm 68%, gió 1m/s', 'Hôm nay: 33 °C · Độ ẩm 68 % · Gió Tây Nam 1 m/s · Hiện tại 30'), []);
  assert.deepStrictEqual(G.ungroundedNumbers('Nhiệt độ 35°C', 'Hôm nay: 33 °C'), ['35']);
  assert.deepStrictEqual(G.numValues('1.234.567,5').includes(1234567.5), true); assert.deepStrictEqual(G.numValues('139.30'), [139.3]);
});
test('B119: thiếu số → viết lại MỘT lần theo trích đoạn trang; vẫn thiếu → nói rõ chưa chắc; không còn ₽ / nhận định bịa', async () => {
  const calls = [];
  const engine = { chatStep: async (m) => { calls.push(m); return { text: 'Giá vàng SJC hôm nay (22/10/2026): mua 139,300, bán 142,300 nghìn đồng/lượng (Huế, Cà Mau và các nơi khác như nhau).\n\nXem: https://sjc.com.vn/bieu-do-gia-vang' }; } };
  const g = await AG.groundAnswer(SJC_ANS, { query: 'giá vàng SJC hôm nay', pageText: PAGE, engine });
  assert.strictEqual(calls.length, 1); assert.match(calls[0][0].content, /nghìn đồng\/lượng/); assert.match(calls[0][1].content, /TRÍCH ĐOẠN TRANG:[\s\S]*139,300/);
  assert.ok(g.info.repaired); assert.ok(!/[₽₫]/.test(g.text)); assert.ok(!g.text.includes('141.000')); assert.ok(!g.text.includes(AG.UNGROUNDED_MSG.slice(0, 20)));
  // mô hình viết lại vẫn sai → giữ, bỏ ₽ và câu nhận định, nói rõ số chưa đối chiếu
  const bad = { chatStep: async () => ({ text: 'Mua 141.000 ₽, bán 142.300. Miền Tây thấp hơn do điều kiện địa phương.' }) };
  const g2 = await AG.groundAnswer(SJC_ANS, { query: 'giá vàng SJC', pageText: PAGE, engine: bad });
  assert.ok(!g2.text.includes('₽')); assert.ok(!/thấp hơn do điều kiện/.test(g2.text), g2.text); assert.ok(g2.text.includes('⚠ Mình chưa thấy các số sau trên trang đã đọc') && g2.text.includes('141.000'), g2.text);
  // đúng hết → không gọi mô hình
  let n = 0; const g3 = await AG.groundAnswer('Mua 139.300, bán 142.300 nghìn đồng/lượng.', { query: 'x', pageText: PAGE, engine: { chatStep: async () => { n++; return { text: '' }; } } });
  assert.strictEqual(n, 0); assert.strictEqual(g3.text, 'Mua 139.300, bán 142.300 nghìn đồng/lượng.');
  // chữ mô hình nhìn ảnh tự mô tả không tính là dữ liệu trang
  assert.ok(!AG.readTextOf([{ role: 'tool', content: 'e1 chữ (OCR) "139,300" @1,1\nMô tả màn hình (mô hình chính nhìn ảnh chụp, có thể chưa chính xác):\nGiá 141.000' }]).includes('141.000'));
});

// ---------- B120: tìm trên web → thẳng Ctrl+T / thanh địa chỉ ----------
test('B120: bấm ô tìm kiếm của trang khi chưa tìm → Ctrl+T thay cho cú bấm; mô hình được nhắc đi thẳng thanh địa chỉ', () => {
  const d = src('src/desktop-agent.js');
  const i = d.indexOf('// B120 (máy thật beta.2.6)'); const j = d.indexOf('let t = needPoint ? resolveTarget(a) : null;');
  assert.ok(i > j && j > 0, 'B120 nằm ngay sau khi tìm đích, trước mọi cú bấm');
  assert.match(d, /!s\.webSearched && isBrowserWin\(s\.obs && s\.obs\.win\) && webSearchTask\(ctx\.userQuery\)/);
  assert.match(d, /SEARCHY_ANY\.test\(nm\) && !ADDR0\.test\(nm\)/); assert.match(d, /s\.webSearched = true;/);
  assert.match(d, /if \(!a\.submit\) a = \{ \.\.\.a, submit: true \}; \/\/ thanh địa chỉ/);
  const { SEARCHY_ANY, webSearchTask } = require('../src/desktop-agent');
  assert.ok(SEARCHY_ANY.test('Tìm kiếm')); assert.ok(SEARCHY_ANY.test('Search')); assert.ok(!SEARCHY_ANY.test('Nhập @, tin nhắn tới My Documents'));
  assert.ok(webSearchTask('mở Chrome tìm "giá vàng SJC hôm nay", mở kết quả đầu tiên rồi báo cho mình giá và đường dẫn trang'));
  assert.match(src('src/agent/agent.js'), /TÌM TRÊN WEB TRONG TRÌNH DUYỆT: bước đầu là screen_act hotkey "ctrl\+t"/);
});
