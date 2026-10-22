'use strict';
// QA box/web beta.2.8: B159 (số sai hệ số 1000), B160 (lời dẫn “…:” trơ trọi, youtu.be ≡ youtube.com/watch), B161 (B157 so chủ đề theo từ),
// B145 (link đầu trang không lặp “beta”), B162 (không tràn ngang ở 280 px), B153 phụ (Local State có BOM).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync, spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const G = require('../src/agent/grounding'); const AG = require('../src/agent/agent'); const SI = require('../src/agent/sys-intent'); const BP = require('../src/agent/browser-profile');
const now = new Date('2026-10-22T10:00:00+07:00');

test('B159: số sai hệ số 1000 bị đánh dấu khi câu trả lời ghi đơn vị/hệ số khác trang; số trần vẫn nhận (B119)', () => {
  const P = 'Giá vàng SJC\nMua 139,300 nghìn đồng/lượng\nBán 141,300 nghìn đồng/lượng';
  const T = 'BẢNG GIÁ (NGHÌN ĐỒNG/LƯỢNG)\nSJC 1L | 139,300 | 141,300';
  const U = (a, p) => G.ungroundedNumbers(a, p, { now });
  // đúng ví dụ QA
  assert.deepStrictEqual(U('Giá 139.300 triệu đồng', 'Giá 139,300 nghìn đồng'), ['139.300']);
  assert.deepStrictEqual(U('Giá 139.300 đồng', 'Giá 139,300 nghìn đồng'), ['139.300']);
  for (const p of [P, T]) {
    assert.deepStrictEqual(U('Giá 139.300 triệu đồng/lượng', p), ['139.300'], p);
    assert.deepStrictEqual(U('Giá mua 139.300 đồng', p), ['139.300'], p);
    assert.deepStrictEqual(U('Giá mua 139.300 ₫', p), ['139.300'], p);
    assert.deepStrictEqual(U('Giá mua 139.300.000 đồng/lượng', p), [], p);
    assert.deepStrictEqual(U('mua 139.300, bán 141.300', p), [], p);           // số trần (B119)
    assert.deepStrictEqual(U('139,3 triệu đồng', p), [], p); assert.deepStrictEqual(U('139.3M', p), [], p);
  }
  // không dương tính giả (các ca QA đã xác nhận ở B125)
  for (const [a, p] of [['1,2 tỷ', 'Giá 1.200 triệu'], ['1.200 triệu', 'Giá 1,2 tỷ'], ['1.200 triệu', 'Giá 1.2B'], ['3.500 triệu đồng', 'Giá 3,5 tỷ đồng'],
    ['50.000 đồng', 'Giá 50.000 đồng'], ['50 nghìn đồng', 'Giá 50.000 đồng'], ['1.393亿', '139,300,000'], ['139.3 million', 'Giá 139,300 nghìn đồng'], ['13万', 'Giá 13万元']]) assert.deepStrictEqual(U(a, p), [], `${a} | ${p}`);
  assert.deepStrictEqual(U('50.000 nghìn đồng', 'Giá 50.000 đồng'), ['50.000']); assert.deepStrictEqual(U('5 triệu', '5 sản phẩm'), ['5']);
});

test('B160: bỏ mọi lời dẫn ngắn “…:” trước URL bị bỏ; giữ chữ khi lời dẫn dài/có số', () => {
  const S = [{ url: 'https://sjc.com.vn/bieu-do-gia-vang', kind: 'address' }];
  const W = (a) => AG.withSource(a, 'giá vàng', [], { sources: S, out: {} });
  const noLead = (t) => !t.split('\n').some(l => /[:：]\s*$/.test(l.trim()) && !/^Nguồn/.test(l));
  for (const a of ['Price 139,300.\nMore info: https://giavang.net/sjc\nThanks.', 'Bạn xem chi tiết tại đây: https://giavang.net/sjc', 'Video: https://giavang.net/v/1',
    'Giá 139,300 nghìn đồng. Chi tiết: https://giavang.net/sjc', 'Thông tin thêm tại: <https://giavang.net/sjc>']) { const t = W(a); assert.ok(noLead(t), JSON.stringify(t)); assert.ok(!/giavang/.test(t), t); }
  assert.match(W('Price 139,300.\nMore info: https://giavang.net/sjc\nThanks.'), /^Price 139,300\.\nThanks\./);
  // lời dẫn có số liệu → giữ chữ, chỉ bỏ dấu “:”
  assert.match(W('Giá mua 139,300 nghìn đồng/lượng: https://giavang.net/sjc'), /^Giá mua 139,300 nghìn đồng\/lượng\n/);
});

test('B160: youtu.be/ID ≡ youtube.com/watch?v=ID (thay tại chỗ, không bỏ); khác mã video thì không coi là gõ sai', () => {
  const Y = [{ url: 'https://www.youtube.com/watch?v=abc123', kind: 'address' }];
  assert.strictEqual(AG.withSource('Video: https://youtu.be/abc123?si=XYZ', 'video', [], { sources: Y, out: {} }), 'Video: https://www.youtube.com/watch?v=abc123');
  assert.strictEqual(G.urlKey('https://youtu.be/abc123'), G.urlKey('https://www.youtube.com/watch?v=abc123'));
  assert.strictEqual(G.urlKey('https://m.youtube.com/watch?v=abc123'), G.urlKey('youtube.com/watch?v=abc123'));
  assert.strictEqual(AG.withSource('Xem https://www.youtube.com/watch?v=abc123', 'video', [], { sources: [{ url: 'https://youtu.be/abc123', kind: 'address' }], out: {} }), 'Xem https://youtu.be/abc123');
  const other = AG.withSource('Video: https://youtu.be/zzz999', 'video', [], { sources: Y, out: {} });
  assert.ok(!/zzz999/.test(other) && !/^Video:/m.test(other), other);
});

test('B161: 10 câu lạc đề của QA không còn “liên quan”; câu hỏi thật vẫn qua', () => {
  const F = [['volume_up', 'Tìm giá các loại vàng hôm nay trên Chrome'], ['volume_up', 'Dịch đoạn này sang tiếng Anh trong Google Docs'],
    ['volume_up', 'Nhắc mình lịch học ngày mai trong Google Calendar'], ['volume_up', 'Tìm giá loa JBL trên Shopee'],
    ['lock', 'Tìm khoá học Python miễn phí trên Chrome'], ['lock', 'Mở Chrome tìm cách block quảng cáo YouTube'], ['lock', 'Search the world clock for Tokyo in Chrome'],
    ['open_settings', 'Gửi thông báo nghỉ học cho nhóm AIVN test trên Zalo'], ['open_settings', 'Tìm tài liệu ngôn ngữ lập trình Python trên Chrome'],
    ['show_desktop', 'Tìm hình nền desktop đẹp trên Chrome'],
    // thêm: việc của kịch bản A, “ngôn ngữ” không phải “ngủ”, tên thiết bị khi mua sắm
    ['open_settings', 'Mở Chrome, tìm giá vàng SJC hôm nay rồi cho tôi biết'], ['volume_up', 'Mở Chrome, tìm giá vàng SJC hôm nay rồi cho tôi biết'],
    ['sleep', 'Tìm tài liệu ngôn ngữ lập trình Python trên Chrome'], ['open_settings', 'Tìm giá bàn phím cơ trên Shopee'], ['volume_up', 'Đổi sang tiếng Anh']];
  for (const [a, q] of F) assert.strictEqual(SI.sysRelated(a, q), false, `${a}: ${q}`);
  const T = [['volume_up', 'tăng âm lượng thêm 10%'], ['volume_set', 'set volume to 40'], ['open_settings', 'mở cài đặt wifi'], ['lock', 'khoá máy giúp mình'],
    ['volume_up', 'bật nhạc to lên'], ['volume_down', 'loa to quá, nhỏ lại đi'], ['mute', 'tắt tiếng đi'], ['open_settings', 'tắt thông báo Zalo'],
    ['open_settings', 'đổi ngôn ngữ sang tiếng Anh'], ['show_desktop', 'hiện desktop'], ['show_desktop', 'về màn hình chính'], ['volume_up', 'tiếng nhỏ quá'],
    ['open_settings', 'bật bluetooth'], ['lock', 'lock the screen'], ['sleep', 'cho máy ngủ'], ['volume_up', 'turn the music up'], ['open_settings', 'mở Settings']];
  for (const [a, q] of T) assert.strictEqual(SI.sysRelated(a, q), true, `${a}: ${q}`);
});

test('B153: Local State có BOM vẫn đọc được hồ sơ last_used', () => {
  const ls = '\uFEFF' + JSON.stringify({ profile: { last_used: 'Profile 3', info_cache: { 'Profile 3': { name: 'Khôi' } } } });
  assert.strictEqual(BP.lastProfile(ls).dir, 'Profile 3');
});

const tmpCopy = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b145-')); const f = path.join(d, 'index.html'); fs.copyFileSync(path.join(__dirname, 'fixtures/site-live-0.15.3.html'), f); return f; };
const dict = (h) => JSON.parse(h.split('/*I18N*/')[1].split('/*END*/')[0]);
test('B145: link “Hoặc thử bản thử nghiệm …” không lặp “beta” (vi/en/zh), cả trang mẫu site/', () => {
  const f = tmpCopy();
  execFileSync('python3', [path.join(root, 'tools/site_beta.py'), '--html', f, '--version', '0.16.0-beta.2.8', '--url', 'https://github.com/khoik647-ai/aivn/releases/download/v0.16.0-beta.2.8/AIVN-Setup-0.16.0-beta.2.8.exe', '--sha256', 'f'.repeat(64), '--size', '245012768']);
  const h = fs.readFileSync(f, 'utf8'); const D = dict(h);
  const vi = (h.match(/data-i18n="beta\.2">([\s\S]*?)<\/p>/) || [])[1]; const strip = (s) => s.replace(/<[^>]+>/g, '');
  assert.strictEqual(strip(vi), '🧪 Hoặc thử bản thử nghiệm 0.16.0-beta.2.8 →');
  assert.strictEqual(strip(D.en['beta.2']), '🧪 Or try the test version 0.16.0-beta.2.8 →'); assert.strictEqual(strip(D.zh['beta.2']), '🧪 或者试试测试版 0.16.0-beta.2.8 →');
  for (const t of [vi, D.en['beta.2'], D.zh['beta.2']]) assert.strictEqual((strip(t).match(/beta/gi) || []).length, 1, t);
  const S = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8'); const DS = dict(S);
  for (const t of [(S.match(/data-i18n="beta\.2">([\s\S]*?)<\/p>/) || [])[1] || '', DS.en['beta.2'] || '', DS.zh['beta.2'] || '']) assert.ok((strip(t).match(/beta/gi) || []).length <= 1, t);
  assert.match(fs.readFileSync(path.join(root, 'tools/publish-beta-site.sh'), 'utf8'), /grep -q 'Hoặc thử bản thử nghiệm'/);
  assert.match(fs.readFileSync(path.join(root, 'tools/site_check.py'), 'utf8'), /lặp “beta”/);
});

test('B162: site_fixes thêm khối 280 px (sau khối 320, chạy lại không nhân đôi); site_check có máy 280 px; publish chờ dấu FIX-280', () => {
  const f = tmpCopy(); const run = () => execFileSync('python3', [path.join(root, 'tools/site_fixes.py'), '--html', f, '--sizes', '240075606,259835253,272736118']);
  run(); run(); const h = fs.readFileSync(f, 'utf8');
  assert.strictEqual((h.match(/\/\*AIVN-FIX-280\*\//g) || []).length, 1); assert.ok(h.indexOf('AIVN-FIX-280') > h.indexOf('END-FIX-320'));
  assert.match(fs.readFileSync(path.join(root, 'tools/site_check.py'), 'utf8'), /\('fold-280', dict\(viewport=\{'width': 280/);
  assert.match(fs.readFileSync(path.join(root, 'tools/publish-beta-site.sh'), 'utf8'), /grep -q 'AIVN-FIX-280'/);
  assert.strictEqual((fs.readFileSync(path.join(root, 'site/index.html'), 'utf8').match(/\/\*AIVN-FIX-280\*\//g) || []).length, 1);
});

const electron = path.join(root, 'node_modules/.bin/electron');
const canRender = fs.existsSync(electron) && spawnSync('which', ['xvfb-run']).status === 0;
const widths = (file) => {
  const r = spawnSync('timeout', ['150', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', electron, '--no-sandbox', path.join(__dirname, 'fixtures/site-width.cjs'), file, '280,320'], { encoding: 'utf8' });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('RESULT ')); assert.ok(line, (r.stdout || '') + (r.stderr || '').slice(-800)); return JSON.parse(line.slice(7));
};
test('B162: trang mẫu và trang thật sau site_fixes không tràn ngang ở 280/320 px (vi/en/zh, menu đóng/mở)', { skip: !canRender && 'cần electron + xvfb-run', timeout: 300000 }, () => {
  const live = tmpCopy(); execFileSync('python3', [path.join(root, 'tools/site_fixes.py'), '--html', live, '--sizes', '240075606,259835253,272736118']);
  for (const file of [path.join(root, 'site/index.html'), live]) for (const r of widths(file)) {
    assert.strictEqual(r.sw, r.w, `${file} ${r.w}px ${r.lang}: rộng ${r.sw}`); assert.strictEqual(r.swMenu, r.w, `${file} ${r.w}px ${r.lang} (mở menu): rộng ${r.swMenu}`);
  }
});
