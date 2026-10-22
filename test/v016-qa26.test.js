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

// ---------- B121: thanh tác vụ tự ẩn (máy QA: StuckRects3=3, 125 %, 2560×1440) ----------
test('B121: phát hiện ABM_GETSTATE → StuckRects3; toạ độ vật lý; bấm cao hơn trong khung ô soạn; luôn ghi quyết định', async () => {
  const T = require('../src/agent/taskbar');
  assert.match(T.PS, /SHAppBarMessage\(4, ref d\)/); assert.match(T.PS, /StuckRects3/); assert.match(T.PS, /\$v\[8\]/);
  assert.deepStrictEqual(T.parseState('ABM=1;STUCK=3;ERR='), { abm: 1, stuck: 3, autoHide: true, via: 'ABM_GETSTATE', err: '' });
  assert.strictEqual(T.parseState('ABM=-1;STUCK=3;ERR=Add-Type lỗi').via, 'StuckRects3'); assert.strictEqual(T.parseState('ABM=-1;STUCK=3;ERR=x').autoHide, true);
  assert.strictEqual(T.parseState('ABM=0;STUCK=3;ERR=').autoHide, true, 'một trong hai nguồn báo tự ẩn → coi là tự ẩn (dời điểm bấm vô hại)');
  assert.strictEqual(T.parseState('ABM=0;STUCK=2;ERR=').autoHide, false); assert.strictEqual(T.parseState('ABM=-1;STUCK=-1;ERR=x').autoHide, false);
  T._reset(); const d = await T.detect({ run: () => 'ABM=-1;STUCK=3;ERR=' }); assert.strictEqual(d.autoHide, true);
  assert.match(T.describe(d), /thanh tác vụ tự ẩn: CÓ \(theo StuckRects3; ABM_GETSTATE=-1, StuckRects3=3\)/);
  T._reset(); assert.strictEqual((await T.detect({ platform: 'linux' })).via, 'không phải Windows'); T._reset();
  // đúng số đo QA: màn hình vật lý 2560×1440 (125 %), ô soạn OCR 1394–1419, beta.2.6 bấm y=1409/1407
  const P = { x: 0, y: 0, width: 2560, height: 1440 };
  for (const y of [1409, 1407]) { const ny = T.safeY(y, P, [400, 1394, 1400, 25]); assert.ok(ny < y && ny >= 1394 && ny <= 1396, `${y} → ${ny}`); }
  // lỗi cũ: so điểm vật lý với khung DIP (1152 cao) → “phần tử nằm trọn trong dải” → không dời. Nay dùng khung vật lý
  const s = src('src/desktop-agent.js');
  assert.match(s, /function physBoundsAt\(x, y\) \{ try \{ const G = SC\.geos\(\); const g = D\.displayForRect\(G, \[Math\.round\(x\), Math\.round\(y\), 1, 1\]\); return g && g\.phys/);
  assert.match(s, /deps\.log\('desk', `B121: \$\{TB\.describe\(d\)\}`\)/, 'quyết định phát hiện luôn được ghi (một lần mỗi phiên)');
  assert.match(s, /trong dải đáy \$\{band\} px của màn hình \$\{b\.width\}×\$\{b\.height\} nhưng thanh tác vụ không tự ẩn/);
  assert.ok(!/displayBoundsAt\(x, y\); const ny = TB\.safeY/.test(s), 'không còn dùng khung DIP cho điểm bấm vật lý');
});

// ---------- B122: open_chat xong phải xoá ô tìm kiếm và kiểm đã trống ----------
test('B122 (mã): open_chat gọi clearChatSearch sau khi đã mở đúng chat; kiểm lại ô tìm kiếm + tiêu đề; ghi log B122', () => {
  const s = src('src/desktop-agent.js');
  assert.match(s, /async function clearChatSearch\(rcp, note, ctx\)/);
  assert.match(s, /const sc = await clearChatSearch\(rcp, note, ctx\);/);
  assert.match(s, /SV\.searchLeftover\(s\.obs\) \|\| SV\.searchClose\(s\.obs\)/);
  assert.match(s, /B122: sau open_chat/);
});
const { spawnSync } = require('child_process'); const os = require('os');
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(__dirname, '..', 'node_modules/.bin/electron'));
test('B122 (Electron, chat giả giữ chữ tìm như Zalo): sau open_chat ô tìm kiếm TRỐNG, nút Đóng ẩn, vẫn đúng chat, màn hình trả về là màn hình mới', { skip: !hasX && 'cần xvfb-run + electron', timeout: 300000 }, () => {
  const root = path.join(__dirname, '..'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b122-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b122-ud-'));
  const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: '1', AIVN_QA_B21_MODE: 'b122' });
  const r = spawnSync('timeout', ['280', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--user-data-dir=' + ud], { cwd: root, encoding: 'utf8', env });
  const f = path.join(dir, 'qab21.json'); assert.ok(fs.existsSync(f), 'không chạy xong: ' + (r.stderr || '').slice(-800));
  const d = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!d.error, d.error);
  const st = d.steps[0]; assert.match(st.forModel, /Đã mở cuộc trò chuyện với “Trần Quỳnh Anh”/);
  assert.strictEqual(d.domQ, '', 'ô tìm kiếm phải trống'); assert.strictEqual(d.closeHidden, true); assert.strictEqual(d.searchCleared, true);
  assert.strictEqual(d.final.cur, 'Trần Quỳnh Anh'); assert.deepStrictEqual(d.final.sent, []);
  assert.match(st.forModel, /đã kiểm: ô tìm kiếm trống/);
  assert.doesNotMatch(st.forModel.split('Màn hình bây giờ')[1] || '', /Đóng/, 'màn hình trả cho mô hình phải là màn hình SAU khi xoá');
  assert.match(fs.readFileSync(path.join(ud, 'logs', 'aivn.log'), 'utf8'), /B122: sau open_chat “Trần Quỳnh Anh”: ô tìm kiếm đã trống/);
});

// ---------- B123: nhãn runtime ----------
test('B123a: [load] ghi bộ máy THẬT (llama-server CUDA/Vulkan/Metal/CPU), không phải GPU của node-llama-cpp', () => {
  const E = require('../src/engine');
  const plat = process.platform === 'win32' ? 'vulkan' : process.platform === 'darwin' ? 'metal' : 'cpu';
  assert.strictEqual(E.serverBackend({ runtime: 'cuda', gpuLayers: 37 }), 'cuda');
  assert.strictEqual(E.serverBackend({ runtime: 'bundled', gpuLayers: 37 }), plat);
  assert.strictEqual(E.serverBackend({ runtime: 'cuda', gpuLayers: 0 }), 'cpu');
  assert.strictEqual(E.serverBackend(null), null);
  assert.match(src('src/engine.js'), /vision: true, gpu: llama && llama\.gpu, backend: serverBackend\(v\)/);
  assert.match(src('src/main.js'), /gpu: st\.backend \|\| st\.gpu, runtime: st\.vision \? \(st\.runtime \|\| 'bundled'\) : 'node-llama-cpp'/);
});
test('B123b/c: runtime-active luôn có chữ; lời giới thiệu không còn nói CUDA “thường nhanh hơn” (vi/en/zh); số đo vẫn hiện', () => {
  assert.match(src('src/renderer/app.js'), /Chưa nạp mô hình nhìn ảnh — lần nạp tới sẽ dùng: \$\{prefRt\}/);
  const html = src('src/renderer/index.html');
  assert.doesNotMatch(html, /thường nhanh hơn Vulkan/); assert.match(html, /trên một số GPU có thể nhanh hơn Vulkan \(xem số đo bên dưới\)/);
  assert.match(html, /data-testid="runtime-cuda-note">Tuỳ chọn\. Đo trên RTX 4070 SUPER/);
  const en = src('src/i18n/en.js'), zh = src('src/i18n/zh.js');
  assert.doesNotMatch(en, /usually faster than Vulkan/); assert.match(en, /faster than Vulkan on some GPUs \(see the measurement below\)/);
  assert.doesNotMatch(zh, /通常比 Vulkan 更快/); assert.match(zh, /在部分 GPU 上可能比 Vulkan 更快/);
  for (const k of ['Chưa nạp mô hình nhìn ảnh — lần nạp tới sẽ dùng: {0}']) { assert.ok(en.includes(JSON.stringify(k)), 'en ' + k); assert.ok(zh.includes(JSON.stringify(k)), 'zh ' + k); }
});

// ---------- B124: tốc độ ----------
const EA = require('../src/agent/ensure-app'); const SV = require('../src/agent/send-verify');
function fakeWin(o) {
  let t = 0; const calls = { look: 0, launch: 0, focus: 0 }; const w = { hwnd: 7, title: 'Zalo', proc: 'Zalo', vis: true, min: false, hung: false, active: true, covered: 0, b: [0, 0, 1200, 800], ...o };
  return { calls, d: { now: () => t, sleep: async (ms) => { t += ms; }, log: () => {}, webApp: () => null,
    state: async () => { t += 300; return { windows: [{ ...w }], procs: [{ pid: 1, proc: 'Zalo', path: 'C:\\Zalo.exe' }] }; },
    focus: async () => { calls.focus++; w.active = true; w.min = false; return { ok: true, how: 'set' }; },
    launch: async () => { calls.launch++; return { ok: false }; },
    look: async () => { calls.look++; t += 8000; return { sig: 'same', text: 'Zalo' }; } }, clock: () => t };
}
test('B124: ensure_app khi cửa sổ ĐÃ ở trước, hiện, không thu nhỏ, không treo → sẵn sàng ngay: 0 lần nhìn, không khởi động, < 2 giây', async () => {
  const F = fakeWin({}); const r = await EA.ensureApp('Zalo', F.d);
  assert.ok(r.ok && r.how === 'already' && r.fast, JSON.stringify(r)); assert.strictEqual(F.calls.look, 0); assert.strictEqual(F.calls.launch, 0); assert.strictEqual(F.calls.focus, 0);
  assert.ok(r.ms < 2000, 'ms=' + r.ms); assert.ok(r.steps.some(x => /sẵn sàng ngay \(bỏ bước nhìn chờ\)/.test(x)));
  // trước B124: 2 lần nhìn (máy thật 22–41 giây) — vẫn giữ được bằng slowReady
  const F2 = fakeWin({}); const r2 = await EA.ensureApp('Zalo', F2.d, { slowReady: true }); assert.strictEqual(F2.calls.look, 2); assert.ok(r2.ms >= 16000, 'đường cũ ' + r2.ms);
});
test('B124: thu nhỏ / bị che / treo / ẩn → KHÔNG đi đường nhanh (vẫn khôi phục + chờ sẵn sàng)', async () => {
  for (const o of [{ min: true, active: false }, { active: false, covered: 0.8 }]) { const F = fakeWin(o); const r = await EA.ensureApp('Zalo', F.d); assert.ok(r.ok && !r.fast && F.calls.look >= 2, JSON.stringify(o) + JSON.stringify(r)); }
  const F = fakeWin({ hung: true }); const r = await EA.ensureApp('Zalo', F.d, { timeoutMs: 3000 }); assert.ok(!r.fast);
  // màn hình đăng nhập theo tiêu đề vẫn bị bắt ở đường nhanh
  const L = fakeWin({ title: 'Zalo - Đăng nhập' }); const rl = await EA.ensureApp('Zalo', L.d); assert.ok(!rl.ok && rl.code === 'login', JSON.stringify(rl));
});
test('B124 (mã): open_chat chạy chế độ nhanh (không mô tả ảnh ở bước tự động, OCR thấy kết quả thì khỏi chờ/hỏi thêm); ensure nhìn chỉ OCR; đo thời gian + số lần nhìn', () => {
  const s = src('src/desktop-agent.js');
  assert.match(s, /if \(s\.quick && vision === 'auto' && !question\) vision = 'off';/);
  assert.match(s, /s0\.quick = true;[\s\S]{0,200}B124: open_chat xong sau \$\{Date\.now\(\) - t0\} ms, \$\{s0\.obsN\} lần quan sát[\s\S]{0,80}finally \{ s0\.quick = false; \}/);
  assert.match(s, /const early = s\.quick && o2 && o2\.obs && judge\(o2\) === 'yes';/);
  assert.match(s, /if \(s\.quick && qv\) \{ o2 = await observe\(ctx, \{\}\); verdict = judge\(o2\); if \(verdict !== 'yes'\) \{ o2 = await observe\(ctx, \{ question: qv \}\);/);
  assert.match(s, /const o = await observe\(ctx, \{ thumb: false, vision: 'off' \}\); s\.ensureObsText/);
  assert.match(s, /if \(e\.fast\) s\.obs = null;/, 'đường nhanh không nhìn → open_chat phải nhìn mới, không dùng màn hình cũ');
});
test('B124: chữ còn trong ô tìm kiếm / danh sách kết quả (OCR chỉ thấy cột trái) KHÔNG được coi là tiêu đề khung chat', () => {
  // đúng dữ liệu box (Zalo giả, ô tìm “My Documents” còn chữ, đang mở “Nhóm Lớp K27”)
  const obs = { win: { title: 'Zalo', proc: 'electron', b: [45, 69, 1000, 600] }, elements: [{ name: 'Đóng', ocr: true, b: [54, 118, 47, 19] }, { name: 'My Documents', ocr: true, b: [53, 154, 145, 20] }] };
  const R = SV.regionsOf(obs); assert.deepStrictEqual(R.header, []); assert.ok(R.list.includes('My Documents'));
  // không có nút Đóng (ô tìm đã đóng) → giữ cách cũ
  const R2 = SV.regionsOf({ ...obs, elements: [{ name: 'My Documents', ocr: true, b: [400, 80, 145, 20] }, { name: 'xin chào', ocr: true, b: [420, 300, 100, 20] }] }); assert.deepStrictEqual(R2.header, ['My Documents']);
  // lần tìm gần nhất KHÔNG thấy người nhận → “đầu khung” trùng chữ vừa tìm không chứng minh đã mở chat
  const st = { searches: [{ text: 'My Documents', found: false }] };
  const g = SV.chatGate({ query: 'Nhắn Zalo cho My Documents: "AIVN ensure test". Không cần hỏi lại.', text: 'AIVN ensure test', searchField: false, submit: true, proc: 'Zalo', title: 'Zalo', state: st, header: ['My Documents'], ocrHeader: ['My Documents'], composer: [] });
  assert.ok(g && !st.chatOpen, 'phải chặn: ' + g);
  const st2 = { searches: [{ text: 'My Documents', found: true }], lastSearch: { q: 'My Documents' } };
  const g2 = SV.chatGate({ query: 'Nhắn Zalo cho My Documents: "AIVN ensure test". Không cần hỏi lại.', text: 'AIVN ensure test', searchField: false, submit: true, proc: 'Zalo', title: 'Zalo', state: st2, header: ['My Documents'], ocrHeader: ['My Documents'], composer: [] });
  assert.strictEqual(g2, null, 'tìm thấy + đầu khung đúng tên → cho gõ như cũ');
});
test('B124: UIA thử RawView khi ControlView gần như rỗng + trả chẩn đoán (lớp gốc, framework, con cấp 1); script PowerShell hợp lệ', () => {
  const s = src('src/agent/uitree.js');
  assert.match(s, /\$out = Walk \(\[System\.Windows\.Automation\.TreeWalker\]::ControlViewWalker\) 10;/);
  assert.match(s, /if \(\$named -lt 3\) \{\n  try \{ \$o2 = Walk \(\[System\.Windows\.Automation\.TreeWalker\]::RawViewWalker\) 6;/);
  assert.match(s, /els = \$out; seen = \$seen; via = \$via; diag = \$diag;/);
  assert.match(src('src/desktop-agent.js'), /B124: UIA “\$\{pk\}”: duyệt/);
  const pw = ['/tmp/pwsh/pwsh', '/usr/bin/pwsh'].find(f => fs.existsSync(f));
  if (pw) { const m = s.match(/const PS_TREE = PS_PRELUDE \+ String\.raw`([\s\S]*?)`;/); const f = path.join(require('os').tmpdir(), 'aivn-pstree-' + process.pid + '.ps1'); fs.writeFileSync(f, m[1]);
    const r = require('child_process').spawnSync(pw, ['-NoProfile', '-c', `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${f}',[ref]$t,[ref]$e);$e.Count`], { encoding: 'utf8' }); fs.unlinkSync(f);
    assert.strictEqual(r.stdout.trim(), '0', 'lỗi cú pháp PowerShell: ' + r.stdout + r.stderr); }
});
