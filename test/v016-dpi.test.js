'use strict';
// T1a (máy thật của Khôi: 2560×1440, 125%): toạ độ theo từng màn hình, hiệu chỉnh chuột, so ảnh trước/sau, Zalo Ctrl+F, B39
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const D = require('../src/agent/dpi'); const PD = require('../src/agent/pixdiff'); const RT = require('../src/agent/retry');
const U = require('../src/agent/uitree'); const SV = require('../src/agent/send-verify');
const root = path.join(__dirname, '..');
const win = (spec) => { const f = D.fakeWinDisplays(spec); return D.geometry(f.displays, { platform: 'win32', dipToScreenRect: f.dipToScreenRect }); };

test('125% ở 2560×1440: logic 2048×1152, ảnh chụp/chuẩn hoá → điểm ảnh vật lý', () => {
  const [g] = win([{ phys: [0, 0, 2560, 1440], scale: 1.25 }]);
  assert.deepStrictEqual(g.dip, { x: 0, y: 0, width: 2048, height: 1152 }); assert.deepStrictEqual(g.phys, { x: 0, y: 0, width: 2560, height: 1440 });
  assert.deepStrictEqual(D.normToPhys(g, 0.5, 0.5), { x: 1280, y: 720 });
  // ảnh chụp thu về 1920×1080: điểm (960,540) của ảnh → (1280,720) vật lý; KHÔNG phải (960,540) hay (1024,576)
  const p = D.shotToPhys({ width: 1920, height: 1080, geo: g }, 960, 540); assert.ok(Math.abs(p.x - 1280) <= 1 && Math.abs(p.y - 720) <= 1, JSON.stringify(p));
  assert.ok(/2560×1440 @125%/.test(D.describe([g])));
});
test('150% ở 1920×1080: logic 1280×720', () => {
  const [g] = win([{ phys: [0, 0, 1920, 1080], scale: 1.5 }]);
  assert.strictEqual(g.dip.width, 1280); assert.strictEqual(g.dip.height, 720);
  assert.deepStrictEqual(D.dipToPhys([g], 640, 360), { x: 960, y: 540 });
  const q = D.physToDip([g], 960, 540); assert.deepStrictEqual(q, { x: 640, y: 360 });
});
test('mọi tỉ lệ 100/125/150/175/200%: chuẩn hoá → vật lý → chuẩn hoá lệch < 1 điểm ảnh', () => {
  for (const s of [1, 1.25, 1.5, 1.75, 2]) {
    const [g] = win([{ phys: [0, 0, 3840, 2160], scale: s }]);
    for (const [nx, ny] of [[0, 0], [0.33, 0.71], [1, 1]]) { const p = D.normToPhys(g, nx, ny); const n = D.physToNorm(g, p.x, p.y); assert.ok(Math.abs(n.nx - nx) * 3839 < 1 && Math.abs(n.ny - ny) * 2159 < 1, `${s} ${nx},${ny}`); }
  }
});
test('nhiều màn hình, toạ độ âm, tỉ lệ khác nhau: chọn đúng màn hình của cửa sổ và quy đổi theo màn hình đó', () => {
  const G = win([{ phys: [0, 0, 2560, 1440], scale: 1.25 }, { phys: [-1920, 200, 1920, 1080], scale: 1 }, { phys: [2560, 0, 3840, 2160], scale: 2 }]);
  const left = D.displayForRect(G, [-1500, 400, 800, 600]); assert.strictEqual(left.phys.x, -1920);
  assert.deepStrictEqual(D.normToPhys(left, 0, 0), { x: -1920, y: 200 });
  const right = D.displayForRect(G, [3000, 100, 1200, 900]); assert.strictEqual(right.scale, 2);
  assert.deepStrictEqual(D.normToPhys(right, 0.5, 0.5), { x: 2560 + 1920, y: 1080 });
  assert.strictEqual(D.displayAtPhys(G, -10, 500).phys.x, -1920);
  assert.ok(D.primaryOf(G).primary && D.primaryOf(G).scale === 1.25);
});
test('hiệu chỉnh chuột: luồng gửi chuột không nhận DPI (×1,25 hoặc ×0,8) → đo hệ số, lần sau tới đúng chỗ', () => {
  for (const k of [1.25, 0.8, 1.5]) {
    const want = { x: 1280, y: 720 }; const actual = { x: want.x * k, y: want.y * k };
    const cal = D.calibrate(want, actual); assert.ok(cal && Math.abs(cal.kx - k) < 1e-9);
    const sent = D.applyCal(cal, { x: 300, y: 1000 }); assert.ok(D.near({ x: sent.x * k, y: sent.y * k }, { x: 300, y: 1000 }, 1));
  }
  assert.strictEqual(D.calibrate({ x: 5, y: 5 }, { x: 9, y: 9 }), null); // quá gần gốc: không đủ thông tin
});
test('UIA trong PowerShell không nhận DPI (thấy màn hình 2048 rộng) → nhân khung ×1,25', () => {
  const [g] = win([{ phys: [0, 0, 2560, 1440], scale: 1.25 }]);
  const raw = { dpi: { cx: 2048, cy: 1152 }, win: { b: [100, 100, 800, 600] }, els: [{ b: [200, 120, 80, 40] }] };
  const k = U.uiaScale(raw, g); assert.strictEqual(k, 1.25); U.rescaleTree(raw, k);
  assert.deepStrictEqual(raw.win.b, [125, 125, 1000, 750]); assert.deepStrictEqual(raw.els[0].b, [250, 150, 100, 50]);
  assert.strictEqual(U.uiaScale({ dpi: { cx: 2560 } }, g), 1);
});
test('so ảnh trước/sau: viền tiêu điểm/nháy con trỏ không tính; đổi quanh chỗ bấm hoặc đổi nhiều trong cửa sổ thì tính', () => {
  const w = 100, h = 60; const a = Buffer.alloc(w * h * 4, 255);
  const paint = (buf, x1, y1, x2, y2) => { const b = Buffer.from(buf); for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) { const i = (y * w + x) * 4; b[i] = b[i + 1] = b[i + 2] = 0; } return b; };
  const caret = paint(a, 50, 30, 51, 34); assert.strictEqual(PD.changed(PD.diffBitmaps(a, caret, w, h, PD.around({ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }))), false);
  const near = paint(a, 10, 6, 20, 12); assert.strictEqual(PD.changed(PD.diffBitmaps(a, near, w, h, { x1: 0.05, y1: 0.05, x2: 0.25, y2: 0.25 })), true);
  const pane = paint(a, 40, 0, 100, 30); assert.strictEqual(PD.changed(PD.diffBitmaps(a, pane, w, h, { x1: 0, y1: 0.8, x2: 0.1, y2: 1 })), true);
  // thay đổi ngoài cửa sổ đích (đồng hồ khay hệ thống…) không tính
  const out = paint(a, 0, 0, 30, 60); assert.strictEqual(PD.changed(PD.diffBitmaps(a, out, w, h, null, 32, { x1: 0.5, y1: 0, x2: 1, y2: 1 })), false);
});
test('Zalo: phím tắt tìm kiếm Ctrl+F (theo tiến trình hoặc cửa sổ tên đúng “Zalo”); tab trình duyệt không tính', () => {
  assert.strictEqual(U.appKeys('Zalo.exe').search, process.platform === 'darwin' ? 'cmd+f' : 'ctrl+f');
  assert.ok(U.appKeys('electron', 'Zalo')); assert.strictEqual(U.appKeys('chrome', 'Zalo - Google Chrome').search, undefined);
  assert.ok(/k$/.test(U.appKeys('slack').search));
});
test('T1a: “gửi \'AIVN test 1\' vào nhóm \'AIVN test\'” → người nhận là nhóm “AIVN test” (không phải nội dung tin)', () => {
  assert.strictEqual(SV.recipientOf("gửi 'AIVN test 1' vào nhóm 'AIVN test'"), 'AIVN test');
  assert.strictEqual(SV.recipientOf('Gửi "AIVN test 1" vào nhóm Zalo "AIVN test". Không cần hỏi lại.'), 'AIVN test');
  assert.ok(SV.chatShown('nhóm AIVN test', 'Zalo', ['AIVN test']));
  // đã mở đúng nhóm: tin có chứa tên nhóm vẫn gõ được; chưa mở → vẫn chặn
  const q = 'Gửi "AIVN test 1" vào nhóm Zalo "AIVN test"';
  assert.strictEqual(SV.chatGate({ query: q, text: 'AIVN test 1', proc: 'Zalo', title: 'Zalo', state: { chatOpen: 'aivn test' }, header: ['AIVN test'] }), null);
  assert.ok(SV.chatGate({ query: q, text: 'AIVN test 1', proc: 'Zalo', title: 'Zalo', state: {}, header: ['Nguyễn Ngọc Khôi'] }));
});
test('B39: cùng một cách bị chặn 2 lần → dừng sớm; câu kết thúc bằng lời hứa bị phát hiện; báo trung thực', () => {
  const r = RT.createRetryTracker(); const a = { action: 'click', element: 'AIVN test' }; const bad = { forModel: 'Kiểm tra: Màn hình không thay đổi rõ ràng' };
  r.after(a, bad); r.after(a, bad); assert.strictEqual(r.giveUp(), null);
  assert.ok(r.before(a)); assert.strictEqual(r.giveUp(), null); assert.ok(r.before(a)); assert.ok(r.giveUp());
  const txt = RT.honestStatus({ tracker: r, steps: [], recipient: 'AIVN test', app: 'Zalo' });
  assert.ok(/chưa làm xong/.test(txt) && /click "AIVN test": 2 lần/.test(txt) && /mở sẵn cuộc trò chuyện “AIVN test” trong Zalo/.test(txt), txt);
  assert.ok(RT.promiseEnding('Màn hình chưa đổi.\nTôi sẽ thử bấm vào ô tìm kiếm.'));
  assert.ok(RT.promiseEnding("I'll try clicking the search box."));
  assert.ok(!RT.promiseEnding('Đã gửi “AIVN test 1” vào nhóm AIVN test.')); assert.ok(!RT.promiseEnding('Bạn sẽ thấy tin trong nhóm.'));
  const r2 = RT.createRetryTracker(); for (let i = 0; i < 10; i++) r2.after({ action: 'click', element: 'x' + i }, bad); assert.ok(r2.giveUp());
});

// ---- Zalo GIẢ thật (Electron + xvfb ở đúng độ phân giải/tỉ lệ), chat khác đang mở, tiêu đề cửa sổ luôn là “Zalo” ----
const hasX = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
function runZalo(screenSize, scale, fakeInput) {
  const dir = fs.mkdtempSync('/tmp/aivn-zalo-dpi-'); const ud = fs.mkdtempSync('/tmp/aivn-zalo-ud-');
  const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_ZALO_DPI: dir, AIVN_DESK_AUTO: '1', AIVN_FAKE_INPUT_SCALE: String(fakeInput || '') });
  spawnSync('timeout', ['300', 'xvfb-run', '-a', '-s', `-screen 0 ${screenSize}x24`, path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox', `--force-device-scale-factor=${scale}`], { cwd: root, encoding: 'utf8', env });
  return JSON.parse(fs.readFileSync(path.join(dir, 'zalo-dpi.json'), 'utf8'));
}
function checkRun(o, pctLabel) {
  assert.ok(o.display.text.includes(pctLabel), o.display.text);
  const st = (n) => o.steps.find(s => s.name === n);
  // bấm TRÚNG phần tử (toạ độ trong trang nằm trong khung phần tử)
  const inside = (c, r) => c.x >= r[0] && c.x <= r[0] + r[2] && c.y >= r[1] && c.y <= r[1] + r[3];
  const c1 = st('click-search-text').newClicks[0]; assert.ok(c1 && inside(c1, st('click-search-text').rects.fakesearch), JSON.stringify(c1));
  assert.deepStrictEqual(st('click-search-text').state.keys, ['ctrl+f'], 'bấm chữ “Tìm kiếm” không tác dụng → phải tự dùng Ctrl+F');
  const c3 = st('click-result').newClicks[0]; assert.ok(c3 && c3.text === 'AIVN test', JSON.stringify(c3));
  assert.ok(/Đã mở cuộc trò chuyện với “AIVN test”/.test(st('click-result').check), st('click-result').check);
  assert.deepStrictEqual(o.final.sent, [{ to: 'AIVN test', text: 'AIVN test 1' }]);
  assert.ok(!o.steps.some(s => /không thay đổi rõ ràng/.test(s.check)), 'không được báo “chưa có tác dụng” sai');
}
test('Zalo giả ở 2560×1440 @125% + luồng chuột lệch ×1,25 (như máy Windows không nhận DPI): tự hiệu chỉnh, gửi đúng nhóm', { skip: !hasX && 'cần xvfb-run + electron', timeout: 360000 }, () => {
  const o = runZalo('2560x1440', 1.25, 1.25); checkRun(o, '2560×1440 @125%');
  assert.ok(o.diag.calib.cal && Math.abs(o.diag.calib.cal.kx - 1.25) < 0.02, JSON.stringify(o.diag));
});
test('Zalo giả ở 1920×1080 @125% (laptop ROG G513 của Khôi, logic 1536×864) + chuột lệch ×1,25: tự hiệu chỉnh, gửi đúng nhóm', { skip: !hasX && 'cần xvfb-run + electron', timeout: 360000 }, () => {
  const o = runZalo('1920x1080', 1.25, 1.25); checkRun(o, '1920×1080 @125%');
  assert.ok(o.diag.calib.cal && Math.abs(o.diag.calib.cal.kx - 1.25) < 0.02, JSON.stringify(o.diag));
});
test('Zalo giả ở 1920×1080 @125% (laptop ROG G513), chuột đúng: không cần hiệu chỉnh', { skip: !hasX && 'cần xvfb-run + electron', timeout: 360000 }, () => {
  const o = runZalo('1920x1080', 1.25, 0); checkRun(o, '1920×1080 @125%');
  assert.strictEqual(o.diag.calib.cal, null); assert.strictEqual(o.diag.calib.misses, 0);
});
test('Zalo giả ở 1920×1080 @150%: toạ độ đúng ngay, không cần hiệu chỉnh', { skip: !hasX && 'cần xvfb-run + electron', timeout: 360000 }, () => {
  const o = runZalo('1920x1080', 1.5, 0); checkRun(o, '1920×1080 @150%');
  assert.strictEqual(o.diag.calib.cal, null); assert.strictEqual(o.diag.calib.misses, 0);
});

// beta.2 (Khôi xác nhận 21/10): laptop ROG G513 1920×1080 @125% (Windows 11, logic 1536×864) và PC 2560×1440 @125%
for (const [name, W, H, LW, LH] of [['laptop ROG G513', 1920, 1080, 1536, 864], ['PC', 2560, 1440, 2048, 1152]]) {
  test(`máy của Khôi — ${name}: ${W}×${H} @125% (logic ${LW}×${LH}): ảnh chụp, UIA, chuột, mép màn hình`, () => {
    const [g] = win([{ phys: [0, 0, W, H], scale: 1.25 }]);
    assert.deepStrictEqual(g.dip, { x: 0, y: 0, width: LW, height: LH });
    assert.deepStrictEqual(g.phys, { x: 0, y: 0, width: W, height: H });
    assert.ok(new RegExp(`${W}×${H} @125%`).test(D.describe([g])));
    assert.deepStrictEqual(D.dipToPhys([g], LW / 2, LH / 2), { x: W / 2, y: H / 2 });
    assert.deepStrictEqual(D.physToDip([g], W / 2, H / 2), { x: LW / 2, y: LH / 2 });
    for (const [sw, sh] of [[LW, LH], [W, H], [1280, 720]]) {
      const p = D.shotToPhys({ width: sw, height: sh, geo: g }, (sw - 1) / 2, (sh - 1) / 2);
      assert.ok(Math.abs(p.x - (W - 1) / 2) <= 1 && Math.abs(p.y - (H - 1) / 2) <= 1, `${sw}×${sh} → ${JSON.stringify(p)}`);
    }
    const e = D.normToPhys(g, 1, 1); assert.ok(e.x === W - 1 && e.y === H - 1, JSON.stringify(e));
    const ed = D.dipToPhys([g], LW - 1, LH - 1); assert.ok(ed.x <= W - 1 && ed.y <= H - 1 && ed.x >= W - 3 && ed.y >= H - 3, JSON.stringify(ed));
    const raw = { dpi: { cx: LW, cy: LH }, win: { b: [80, 40, 800, 600] }, els: [{ b: [400, 300, 120, 32] }] };
    assert.strictEqual(U.uiaScale(raw, g), 1.25); U.rescaleTree(raw, 1.25);
    assert.deepStrictEqual(raw.els[0].b, [500, 375, 150, 40]);
    assert.strictEqual(U.uiaScale({ dpi: { cx: W } }, g), 1);
    const want = { x: Math.round(W * 0.7), y: Math.round(H * 0.6) }; const got = { x: want.x / 1.25, y: want.y / 1.25 };
    const cal = D.calibrate(want, got); assert.ok(cal && Math.abs(cal.kx - 0.8) < 1e-9 && Math.abs(cal.ky - 0.8) < 1e-9);
    const sent = D.applyCal(cal, { x: 300, y: H - 50 }); assert.ok(D.near({ x: sent.x * 0.8, y: sent.y * 0.8 }, { x: 300, y: H - 50 }, 1));
    for (const [nx, ny] of [[0, 0], [0.125, 0.875], [0.5, 0.5], [0.999, 0.001]]) { const p = D.normToPhys(g, nx, ny); const n = D.physToNorm(g, p.x, p.y); assert.ok(Math.abs(n.nx - nx) * (W - 1) < 1 && Math.abs(n.ny - ny) * (H - 1) < 1); }
  });
}
test('laptop ROG G513 + màn hình ngoài 2560×1440 (cả hai 125%): cửa sổ trên màn hình nào thì quy đổi theo màn hình đó', () => {
  const G = win([{ phys: [0, 0, 1920, 1080], scale: 1.25 }, { phys: [1920, 0, 2560, 1440], scale: 1.25 }]);
  const right = D.displayForRect(G, [2200, 200, 1200, 800]); assert.strictEqual(right.phys.width, 2560);
  assert.deepStrictEqual(D.normToPhys(right, 0, 0), { x: 1920, y: 0 });
  assert.strictEqual(D.displayAtPhys(G, 100, 100).phys.width, 1920);
});
