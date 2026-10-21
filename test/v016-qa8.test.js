'use strict';
// Máy thật beta.2 (4070S, Qwen3-VL 8B, 2560×1440 @125%, Zalo thật): B61 câu lệnh KHÔNG có người nhận → hỏi “Gửi cho ai?” trước mọi thao tác;
// B62 toạ độ OCR → chuột ở 125%/150% (ảnh chụp theo px vật lý, chuột theo px logic và ngược lại) + nhật ký từng cú bấm.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const SV = require('../src/agent/send-verify');

test('B61: “giúp/hộ/cho mình” là người dùng, không phải người nhận (vi/en/zh)', () => {
  for (const q of ['nhắn giúp mình là mai 8h họp nhé', 'nhắn hộ mình là mai 8h họp nhé', 'nhắn tin giúp tôi rằng mai nghỉ', 'nhắn mình là mai họp',
    'gửi email nhắc lịch họp', 'gửi mail giúp mình nhé', 'gửi thư cho thầy',
    'send a message for me saying meeting at 8', 'send a message saying hi', 'text for me: hi',
    '帮我发消息说明天8点开会', '帮我发个消息：明天开会', '发个微信说我晚点到']) {
    assert.strictEqual(SV.recipientOf(q), null, q); assert.ok(SV.missingRecipient(q), q);
  }
  // có người nhận / không phải việc gửi tin → không hỏi
  for (const [q, r] of [['nhắn giúp mình cho Trần Quỳnh Anh là mai họp', 'Trần Quỳnh Anh'], ['nhắn giúp Quỳnh Anh là mai họp', 'Quỳnh Anh'], ['gửi thư cho thầy Hùng', 'thầy Hùng'],
    ['gửi email cho cô Mai nhắc lịch họp', 'cô Mai'], ['send a message to Quynh Anh saying hi', 'Quynh Anh'], ['给王老师发消息', '王老师'], ['send Mr. Le Van Hung an email', 'Le Van Hung']]) {
    assert.strictEqual(SV.recipientOf(q), r, q); assert.ok(!SV.missingRecipient(q), q);
  }
  for (const q of ['nhắn vào cuộc trò chuyện hiện tại là ok', 'mở Zalo', 'trả lời câu hỏi này giúp mình', 'gửi tệp báo cáo vào thư mục Documents', 'chat với mình chút đi', 'tóm tắt email này']) assert.ok(!SV.missingRecipient(q), q);
});

function mkAgent(lang) {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qa8-')); const calls = { model: 0, exec: [] };
  const engine = { status: () => ({ loaded: true, contextSize: 8192 }), chatStep: async () => { calls.model++; return { text: 'Đã gửi cho Võ Khánh Lam Chính.', toolCalls: [{ id: '1', name: 'screen_act', arguments: { action: 'click', element: 'Võ Khánh Lam Chính' } }], finishReason: 'tool_calls', usage: {} }; } };
  const names = ['open_app', 'screen_look', 'screen_act'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { calls.exec.push([n, a]); return { forModel: 'ok', summary: 'ok' }; } };
  const mem = createMemoryStore(path.join(r0, 'm.json'));
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: true, uiLang: lang }), memory: mem, scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, calls };
}
test('B61: không có người nhận → hỏi “Gửi cho ai?” NGAY, mô hình không được chạy, không thao tác màn hình, không bịa người nhận (vi/en/zh)', async () => {
  for (const [lang, q, re] of [['vi', 'nhắn giúp mình là mai 8h họp nhé', /^Gửi cho ai\?/], ['en', 'send a message for me saying the meeting is at 8 tomorrow', /^Who should I send it to\?/], ['zh', '帮我发消息说明天8点开会', /^发给谁？/]]) {
    const { agent, calls } = mkAgent(lang);
    const r = await agent.run({ messages: [{ role: 'user', content: q }], confirm: async () => true });
    assert.match(r.text, re, `${lang}: ${r.text}`); assert.strictEqual(calls.model, 0, 'mô hình không được tự chọn người nhận'); assert.deepStrictEqual(calls.exec, []);
    assert.ok(!/Võ Khánh Lam Chính/.test(r.text));
    assert.ok(SV.ASKED_WHO.test(r.text));
  }
});
test('B61: trả lời câu hỏi bằng tên → làm lại việc trước với đúng người đó', () => {
  const nq = SV.answerWho('nhắn giúp mình là mai 8h họp nhé', 'Trần Quỳnh Anh');
  assert.strictEqual(SV.recipientOf(nq), 'Trần Quỳnh Anh'); assert.ok(!SV.missingRecipient(nq));
  assert.ok(!SV.missingRecipient(SV.answerWho('nhắn giúp mình là mai 8h họp nhé', 'đúng')), '“đúng” = chat đang mở (cổng vẫn đòi đọc chắc tiêu đề)');
});

// ---------- B62: đường toạ độ ảnh chụp → OCR → điểm bấm → chuột ----------
const D = require('../src/agent/dpi');
const winG = (spec) => { const f = D.fakeWinDisplays(spec); return D.geometry(f.displays, { platform: 'win32', dipToScreenRect: f.dipToScreenRect }); };
test('B62: 125% và 150% — ảnh chụp theo px vật lý / logic / đã thu nhỏ đều cho đúng điểm bấm vật lý', () => {
  for (const [W, H, sc] of [[2560, 1440, 1.25], [1920, 1080, 1.25], [1920, 1080, 1.5], [2560, 1440, 1.5]]) {
    const [g] = winG([{ phys: [0, 0, W, H], scale: sc }]);
    assert.deepStrictEqual(g.phys, { x: 0, y: 0, width: W, height: H }); assert.strictEqual(g.scale, sc);
    const want = { x: Math.round(W * 0.37), y: Math.round(H * 0.21) }; // tâm nút “Tìm kiếm” (px vật lý)
    for (const [sw, sh] of [[W, H], [Math.round(W / sc), Math.round(H / sc)], [1280, Math.round(1280 * H / W)], [1920, Math.round(1920 * H / W)]]) {
      // OCR trả khung theo px của ẢNH CHỤP → chuẩn hoá theo kích thước ảnh → điểm vật lý của màn hình
      const sx = want.x / (W - 1) * (sw - 1), sy = want.y / (H - 1) * (sh - 1);
      const p = D.shotToPhys({ width: sw, height: sh, geo: g }, sx, sy);
      assert.ok(Math.abs(p.x - want.x) <= 1 && Math.abs(p.y - want.y) <= 1, `${W}×${H}@${sc} ảnh ${sw}×${sh} → ${JSON.stringify(p)} cần ${JSON.stringify(want)}`);
    }
  }
});
test('B62: chuột nhận toạ độ LOGIC (tiến trình không nhận DPI) hoặc con trỏ đọc lại theo logic → đo hệ số và sửa; ngược lại cũng vậy', () => {
  for (const sc of [1.25, 1.5]) {
    const [g] = winG([{ phys: [0, 0, 2560, 1440], scale: sc }]);
    const want = { x: 1500, y: 900 };
    // (a) chuột hiểu toạ độ gửi đi là logic: vị trí thật = gửi × tỉ lệ
    const drvLogic = (p) => ({ x: Math.round(p.x * sc), y: Math.round(p.y * sc) });
    let got = drvLogic(want); assert.ok(!D.near(got, want, 3));
    const cal = D.calibrate(want, got); assert.ok(cal && Math.abs(cal.kx - sc) < 0.01 && Math.abs(cal.ky - sc) < 0.01, JSON.stringify(cal));
    got = drvLogic(D.applyCal(cal, want)); assert.ok(D.near(got, want, 2), JSON.stringify(got));
    // (b) ngược lại: ảnh chụp/OCR theo logic nhưng chuột theo vật lý — điểm bấm luôn quy về vật lý qua toạ độ chuẩn hoá, không phụ thuộc kích thước ảnh
    const ls = { width: g.dip.width, height: g.dip.height, geo: g }; const p = D.shotToPhys(ls, want.x / sc, want.y / sc);
    assert.ok(Math.abs(p.x - want.x) <= 2 && Math.abs(p.y - want.y) <= 2, JSON.stringify(p));
    // (c) con trỏ đọc lại theo logic (getCursorScreenPoint) phải đổi về vật lý trước khi so
    const back = D.dipToPhys([g], want.x / sc, want.y / sc); assert.ok(D.near(back, want, 1), JSON.stringify(back));
    assert.ok(D.near(D.physToDip([g], want.x, want.y), { x: want.x / sc, y: want.y / sc }, 1));
  }
});
test('B62: mỗi cú bấm ghi một dòng nhật ký: id đích, khung OCR trên ảnh, điểm vật lý + logic, tỉ lệ, màn hình, API, con trỏ, cửa sổ ở trước trước/sau, lớp phủ', () => {
  const [g] = winG([{ phys: [0, 0, 2560, 1440], scale: 1.25 }]);
  const line = D.clickDiag({ el: { id: 'e7', name: 'Tìm kiếm', ocr: true, b: [100, 200, 160, 40] }, shot: { width: 1920, height: 1080, full: { width: 2560, height: 1440 }, geo: g }, pt: { x: 180, y: 220 }, geos: [g], api: 'libnut moveMouse', got: { x: 180, y: 220 }, fg0: { title: 'Zalo', pid: 42 }, fg1: { title: 'Zalo', pid: 42 }, overlayIgnore: true, phase: 'sau' });
  for (const re of [/đích e7 “Tìm kiếm” \[OCR\]/, /khung ảnh chụp \[75,150,120,30\] px trên ảnh 1920×1080 \(gốc 2560×1440\)/, /khung vật lý \[100,200,160,40\]/, /điểm vật lý \(180,220\) = logic \(144,176\)/, /tỉ lệ 125%/, /vật lý 0,0 2560×1440 \/ logic 0,0 2048×1152/, /API libnut moveMouse/, /con trỏ đọc lại \(180,220\)/, /cửa sổ trước: “Zalo” pid 42 → sau: “Zalo” pid 42/, /lớp phủ xuyên chuột/]) assert.match(line, re);
  assert.match(D.clickDiag({ pt: { x: 1, y: 1 }, geos: [g], overlayIgnore: false }), /ĐANG NHẬN CHUỘT/);
  const src = fs.readFileSync(path.join(__dirname, '../src/desktop-agent.js'), 'utf8');
  assert.match(src, /deps\.log\('desk', D\.clickDiag\(info\)\)/); assert.match(src, /if \(!\(session && session\.asking\) && !ovIgnore\)/);
  assert.match(src, /fg0\.pid === process\.pid && session && session\.target/); assert.match(src, /under && under\.pid === process\.pid/); assert.match(src, /n\.mouseToggle\('down', btn\); await sleep\(55\); n\.mouseToggle\('up', btn\)/); assert.match(require('../src/agent/uitree').PS_WINAT, /WindowFromPoint/);
});

const { spawnSync } = require('child_process'); const root = path.join(__dirname, '..');
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
test('B65: open_chat bằng mã (Telegram giả, “Trần Quỳnh Như” mở sẵn): mô hình đưa NỘI DUNG làm tên → AIVN vẫn tìm, mở và kiểm đúng “Trần Quỳnh Anh”; rồi chỉ gõ nội dung', { skip: !hasX && 'cần xvfb-run + electron', timeout: 360000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-oc-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-oc-ud-'));
  const env = Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: '1', AIVN_QA_B21_MODE: 'openchat' });
  const r = spawnSync('timeout', ['300', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: root, encoding: 'utf8', env });
  const f = path.join(dir, 'qab21.json'); assert.ok(fs.existsSync(f), 'không chạy xong: ' + (r.stderr || '').slice(-800));
  const d = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!d.error, d.error);
  const by = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.deepStrictEqual(by['oc-open'].state.searches.length <= 1 ? by['oc-open'].state.cur : null, 'Trần Quỳnh Anh', by['oc-open'].forModel);
  assert.match(by['oc-open'].forModel, /Đã mở cuộc trò chuyện với “Trần Quỳnh Anh”/);
  assert.ok(!by['oc-send'].blocked, by['oc-send'].forModel);
  assert.deepStrictEqual(d.final.sent, [{ to: 'Trần Quỳnh Anh', text: 'Gửi mình file slide nhé' }]);
});
