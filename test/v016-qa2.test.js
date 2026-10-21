'use strict';
// Hồi quy cho QA lượt 2 (/workspace/qa-review/pass-2-20261021-0856.md): B13–B19 và phần còn dở của B1, B2, B11.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const SV = require('../src/agent/send-verify');

// ---------- B15: kiểm chứng “đã gửi” ----------
const W = { b: [0, 0, 1000, 800] };
const el = (name, x, y, o = {}) => ({ name, b: [x, y, 200, 20], ...o });
test('B15: đang mở chat sai (tên người nhận chỉ có ở danh sách bên trái) → CHƯA gửi', () => {
  const obs = { win: { title: 'Zalo - Mẹ', ...W }, elements: [el('Trần Quỳnh Anh', 10, 200), el('Mẹ', 400, 30), el('Chúc ngủ ngon nhé', 600, 500)] };
  const v = SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', regions: SV.regionsOf(obs), winTitle: obs.win.title });
  assert.strictEqual(v.sent, false); assert.strictEqual(v.recipientSeen, false); assert.match(v.why, /Mẹ/);
  // tiêu đề cửa sổ chỉ là “Zalo”: danh sách bên trái vẫn không được tính
  const obs2 = { ...obs, win: { title: 'Zalo', ...W } };
  assert.strictEqual(SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', regions: SV.regionsOf(obs2), winTitle: 'Zalo' }).sent, false);
  assert.deepStrictEqual(SV.regionsOf(obs2).list, ['Trần Quỳnh Anh']);
});
test('B15: tin còn nằm trong ô soạn → CHƯA gửi', () => {
  const obs = { win: { title: 'Zalo', ...W }, elements: [el('Trần Quỳnh Anh', 400, 30), el('', 400, 760, { editable: true, value: 'Chúc ngủ ngon nhé' })] };
  const v = SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', regions: SV.regionsOf(obs), winTitle: 'Zalo' });
  assert.strictEqual(v.sent, false); assert.strictEqual(v.composerEmpty, false); assert.match(v.why, /ô soạn/);
  // dạng chữ của QA: “[ô nhập] Chúc ngủ ngon nhé”
  const v2 = SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', screenText: 'Trần Quỳnh Anh\n[ô nhập] Chúc ngủ ngon nhé', winTitle: 'Zalo - Trần Quỳnh Anh' });
  assert.strictEqual(v2.sent, false);
  // mắt nhìn báo ô soạn còn chữ
  assert.strictEqual(SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'Trần Quỳnh Anh', seen: 'TÊN: Trần Quỳnh Anh\nÔ SOẠN: Chúc ngủ ngon nhé\nTIN: Chúc ngủ ngon nhé' }).sent, false);
});
test('B15: người tên gần giống (Lê Quỳnh Anh ≠ Trần Quỳnh Anh) → CHƯA gửi', () => {
  const v = SV.verifySend({ msg: 'hi', recipient: 'Trần Quỳnh Anh', seen: 'TÊN: Lê Quỳnh Anh\nÔ SOẠN: TRỐNG\nTIN: hi', winTitle: 'Zalo - Lê Quỳnh Anh' });
  assert.strictEqual(v.sent, false); assert.match(v.why, /Lê Quỳnh Anh/);
  assert.strictEqual(SV.headerMatches('Trần Quỳnh Anh', 'Lê Quỳnh Anh'), false);
  assert.strictEqual(SV.headerMatches('Quỳnh Anh', 'Quỳnh Anhh'), false, 'phải khớp theo ranh giới từ');
  assert.strictEqual(SV.headerMatches('thầy Lê Văn Hùng', 'Lê Văn Hùng'), true, 'bỏ danh xưng');
});
test('B15: đủ ba điều kiện (tiêu đề đúng tên, ô soạn trống, thấy bong bóng tin) → đã gửi', () => {
  const obs = { win: { title: 'Zalo', ...W }, elements: [el('Trần Quỳnh Anh', 10, 200), el('Trần Quỳnh Anh', 400, 30), el('Chúc ngủ ngon nhé', 600, 600), el('', 400, 760, { editable: true, value: '' })] };
  const v = SV.verifySend({ msg: 'Chúc ngủ ngon nhé', recipient: 'trần quỳnh anh', regions: SV.regionsOf(obs), winTitle: 'Zalo' });
  assert.strictEqual(v.sent, true, v.why);
  assert.strictEqual(SV.verifySend({ msg: 'hi bạn', recipient: 'Quỳnh Anh', seen: 'TÊN: Trần Quỳnh Anh\nÔ SOẠN: TRỐNG\nTIN: hi bạn', winTitle: 'Messenger' }).sent, true);
});
test('B15: nhận ra người nhận ở mọi cách viết', () => {
  const cases = {
    'nhắn Trần Quỳnh Anh là mai họp lúc 8h': 'Trần Quỳnh Anh',
    'gửi email cho thầy Lê Văn Hùng tiêu đề Nộp bài': 'thầy Lê Văn Hùng',
    'Messenger: nhắn Quỳnh Anh "tối gọi nhé"': 'Quỳnh Anh',
    'text Tran Quynh Anh on Messenger: hi': 'Tran Quynh Anh',
    'gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại': 'trần quỳnh anh',
    'nhắn Lan là mai đi cho kịp': 'Lan',
    'Nhắn tin cho Trần Quỳnh Anh trên Messenger nội dung "Mai 8h họp nhóm nhé". Không cần hỏi lại.': 'Trần Quỳnh Anh',
    'nhắn cho em Hoa là ok': 'em Hoa',
  };
  for (const [q, want] of Object.entries(cases)) assert.strictEqual(SV.recipientOf(q), want, q);
  for (const q of ['gửi cho tôi file', 'mở zalo', 'nhắn tin']) assert.strictEqual(SV.recipientOf(q), null, q);
});
test('B15: agent chỉ được báo “đã gửi” khi lần gửi CUỐI CÙNG đã kiểm chứng', () => {
  const A = require('../src/agent/agent');
  const steps = [{ name: 'screen_act', status: 'ok', verify: { sent: true } }, { name: 'screen_act', status: 'ok', verify: { sent: false, why: 'tiêu đề cuộc trò chuyện đang mở không phải “Lan”' } }];
  assert.ok(A.sendClaimCheck('Đã gửi tin nhắn cho Lan.', steps));
  assert.strictEqual(A.sendClaimCheck('Đã gửi tin nhắn cho Lan.', steps.slice(0, 1)), null);
});

// ---------- Kiểu Messenger: luôn tìm và mở người nhận trước khi gõ ----------
test('Chat: không được gõ tin vào cuộc trò chuyện đang mở sẵn khi chưa tìm và mở người nhận', () => {
  const q = 'Nhắn tin cho Trần Quỳnh Anh trên Messenger nội dung "Mai 8h họp nhóm nhé". Không cần hỏi lại.';
  const g = SV.chatGate({ query: q, text: 'Mai 8h họp nhóm nhé', proc: 'Messenger', title: 'Messenger - Nhóm Lớp K27', state: {}, header: ['Nhóm Lớp K27'] });
  assert.match(g, /TÌM và MỞ/); assert.match(g, /Nhóm Lớp K27/);
  // dù tiêu đề đang đúng người, vẫn phải tìm và mở trong lượt này
  assert.ok(SV.chatGate({ query: q, text: 'Mai 8h họp nhóm nhé', proc: 'Messenger', state: {}, header: ['Trần Quỳnh Anh'] }));
  // gõ tên vào ô tìm kiếm ĐÃ XÁC NHẬN thì được (kể cả không dấu / một phần)
  assert.strictEqual(SV.chatGate({ query: q, text: 'Tran Quynh Anh', searchField: true, proc: 'Messenger', state: {} }), null);
  assert.strictEqual(SV.chatGate({ query: q, text: 'Quỳnh Anh', searchField: true, proc: 'Messenger', state: {} }), null);
  // B21 (QA lượt 3): ô chưa xác nhận là ô tìm kiếm → KHÔNG được gõ tên người nhận (đã gửi nhầm tên vào Nhóm Lớp K27)
  assert.match(SV.chatGate({ query: q, text: 'Tran Quynh Anh', proc: 'Messenger', state: {}, header: ['Nhóm Lớp K27'] }), /CHƯA được xác nhận là ô Tìm kiếm/);
  assert.strictEqual(SV.chatGate({ query: q, text: 'abc', searchField: true, proc: 'Messenger', state: {} }), null);
  // đã tìm và mở đúng người → được gõ
  const st = { chatOpen: SV.nameKey('Trần Quỳnh Anh') };
  assert.strictEqual(SV.chatGate({ query: q, text: 'Mai 8h họp nhóm nhé', proc: 'Messenger', state: st, header: ['Trần Quỳnh Anh'] }), null);
  // đã mở nhưng ứng dụng nhảy sang chat khác → chặn
  assert.match(SV.chatGate({ query: q, text: 'Mai 8h họp nhóm nhé', proc: 'Messenger', state: st, header: ['Lê Quỳnh Anh'] }), /không phải/);
  // soạn email / tài liệu: không áp dụng
  assert.strictEqual(SV.chatGate({ query: 'gửi email cho thầy Lê Văn Hùng tiêu đề Nộp bài', text: 'Kính gửi thầy', proc: 'chrome', title: 'Gmail', state: {} }), null);
});
test('Chat: desktop-agent nối chatGate trước khi gõ và đánh dấu đã mở sau khi bấm kết quả tìm kiếm', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  assert.ok(src.indexOf('SV.chatGate(') > 0 && src.indexOf('SV.chatGate(') < src.indexOf('const risk = searchTyping ? null : riskOf('), 'chặn trước khi hỏi/gõ');
  assert.match(src, /s\.chatOpen = SV\.nameKey\(rcp\)/);
  assert.match(src, /SV\.SEEN_QUESTION/); assert.match(src, /regions: SV\.regionsOf\(o2\.obs\)/);
});

// ---------- B16 (+ B1): ý định thao tác hệ thống theo cấu trúc ----------
const C = require('../src/agent/computer'); const { createComputerTools } = require('../src/agent/computer-tools');
test('B16: phủ định, câu hỏi cách làm, chuỗi lệnh, tắt tiếng một ứng dụng → KHÔNG coi là yêu cầu', () => {
  const no = [['lock', 'đừng khoá màn hình nhé'], ['lock', 'không được khoá máy'], ['lock', 'tại sao máy tôi hay tự khoá màn hình?'],
    ['volume_down', 'làm sao để giảm âm lượng trên windows?'], ['volume_down', 'mở nhạc rồi tăng âm lượng'], ['mute', 'tắt tiếng thông báo zalo'],
    ['shutdown', 'đừng tắt máy'], ['open_settings', 'mở cài đặt của zalo'], ['lock', 'cách khoá màn hình windows'], ['volume_up', 'how to turn up volume?']];
  for (const [a, q] of no) assert.strictEqual(C.sysAsked(a, q), false, `${a} ← ${q}`);
  const yes = [['volume_up', 'mở nhạc rồi tăng âm lượng'], ['lock', 'khoá màn hình giúp mình'], ['lock', 'Khoá màn hình giúp mình được không?'], ['lock', 'mở zalo rồi khoá màn hình'],
    ['volume_down', 'vặn nhỏ loa lại'], ['mute', 'tắt tiếng'], ['shutdown', 'tắt máy sau khi tải xong'], ['lock', 'khoá màn hình. không cần hỏi lại']];
  for (const [a, q] of yes) assert.strictEqual(C.sysAsked(a, q), true, `${a} ← ${q}`);
});
test('B16: với câu phủ định, system_action hiện thẻ hỏi và không khoá khi bị từ chối', async () => {
  const asked = []; let ran = 0;
  const orig = C.systemAction; C.systemAction = async (a) => { ran++; return C.SYS[a].label; };
  try {
    const ct = createComputerTools({ getSettings: () => ({ agentComputer: true, agentAutoRun: true }), openPath: async () => '', openExternal: async () => {} });
    for (const [act, q] of [['lock', 'đừng khoá màn hình nhé, không cần hỏi lại'], ['volume_down', 'mở nhạc rồi tăng âm lượng'], ['mute', 'tắt tiếng thông báo zalo']]) {
      const r = await ct.exec('system_action', { action: act }, { userQuery: q, confirm: async (req) => { asked.push(req); return false; } });
      assert.ok(r.refused, q);
    }
    assert.strictEqual(asked.length, 3, 'mỗi câu đều phải hỏi, kể cả khi bật “Tự làm không hỏi”'); assert.strictEqual(ran, 0);
  } finally { C.systemAction = orig; }
});

// ---------- B17: một cách tính cho gợi ý ⭐, nhãn thẻ, nhóm, bộ chọn và cổng AIVN AGENT ----------
const hf = require('../src/hf'); const catalog = require('../src/catalog'); const AE = require('../src/agent-eligibility');
const AP = require('../src/agent-plan'); const R = require('../src/recommend'); const FIT = require('../src/fit');
const shipped = require('../src/bench-results.json').models; const sc = { shipped, local: {} };
const G = 1024 ** 3;
const MACHINES = {
  PC: { ram: 32 * G, gpu: 'cuda', vram: { total: 12 * G, free: 11.4 * G }, devices: ['NVIDIA GeForce RTX 4070 SUPER'], cpus: 12 },
  LAPTOP: { ram: 16 * G, gpu: 'vulkan', vram: { total: 4 * G }, devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU'] }, // hồ sơ QA (Ryzen 7 4800H)
  GPU2: { ram: 16 * G, gpu: 'cuda', vram: { total: 2 * G }, devices: ['NVIDIA GeForce MX450'], cpus: 8 },
  TINY: { ram: 4 * G, gpu: false, vram: { total: 0 }, cpus: 4 },
};
const fitAt = (c, h, ctx) => hf.fitFor(c.size, h, { id: c.id, params: c.params, mmprojSize: c.mmproj ? c.mmproj.size : 0, ctx });
// mô phỏng đúng catalogList() + agentModelGate() của main.js
function discover(h) {
  const P = AP.plan(catalog.map(c => ({ id: c.id, vision: !!c.mmproj, catalog: c, size: c.size })), (e, ctx) => fitAt(e.catalog, h, ctx), sc);
  const list = catalog.map(c => ({ ...c, fit: fitAt(c, h, 0), agentFit: fitAt(c, h, P.ctx) }));
  const ann = R.annotate(list, sc, h.vram.total, AP.elOpts(P)).list.map(c => ({ ...c, agentCheck: AE.eligibility({ vision: !!c.mmproj, catalog: c, fit: c.agentFit }, { shipped: shipped[c.id], ...AP.elOpts(P) }) }));
  const gateBest = AE.bestFor(catalog.map(c => ({ id: c.id, vision: !!c.mmproj, catalog: c, size: c.size, agentFit: fitAt(c, h, P.ctx) })), sc, AP.elOpts(P));
  return { P, ann, gateBest };
}
const grp = (f) => FIT.groupOf ? FIT.groupOf(f) : (f && (f.group || ({ fit: 'smooth', slow: 'slow', big: 'no' })[f.level]));
test('B17 (beta.2): laptop RTX 3050 Ti 4 GB — AIVN AGENT dùng 12K, ⭐ = Qwen3-VL 4B “Chạy chậm” (2B bị bỏ: gọi công cụ 13/25) và qua cổng', () => {
  const { P, ann, gateBest } = discover(MACHINES.LAPTOP);
  assert.strictEqual(P.ctx, 12288); assert.strictEqual(P.lowered, true);
  const star = ann.filter(c => c.recScreen); assert.strictEqual(star.length, 1); assert.strictEqual(star[0].id, 'qwen3-vl-4b-instruct-q4_k_m');
  assert.strictEqual(star[0].agentFit.level, 'slow', 'không có mô hình đạt nào chạy mượt → ⭐ là Chạy chậm');
  assert.strictEqual(star[0].agentCheck.ok, true); assert.strictEqual(star[0].agentCheck.code, 'slow');
  assert.strictEqual(ann.find(c => c.id === 'qwen3-vl-2b-instruct-q8_0').agentCheck.code, 'tools');
  assert.strictEqual(gateBest.id, star[0].id, 'gợi ý ⭐ và cổng AIVN AGENT chọn cùng một mô hình');
  // tràn ít (≤ 1 GB): vẫn chọn được, nhóm Chạy chậm + cảnh báo; tràn nhiều: Quá nặng
  const four = ann.find(c => c.id === 'qwen3-vl-4b-instruct-q4_k_m'); assert.strictEqual(four.agentFit.level, 'slow'); assert.ok(four.agentCheck.ok && four.agentCheck.slow, JSON.stringify(four.agentCheck));
  const eight = ann.find(c => c.id === 'qwen3-vl-8b-instruct-q4_k_m'); assert.strictEqual(eight.agentCheck.ok, false); assert.strictEqual(eight.agentCheck.code, 'veryslow-off', 'beta.2: 8B chỉ dùng được khi tự bật “Rất chậm”'); assert.match(eight.agentCheck.reason, /Rất chậm/);
  assert.match(AP.note(P), /12K/);
});
test('B17: PC RTX 4070 Super — giữ 16K, chỉ nhận mô hình chạy mượt, ⭐ = Qwen3-VL 8B', () => {
  const { P, ann, gateBest } = discover(MACHINES.PC);
  assert.deepStrictEqual([P.ctx, P.allowSlow], [16384, false]);
  const star = ann.filter(c => c.recScreen); assert.strictEqual(star.length, 1); assert.strictEqual(star[0].id, 'qwen3-vl-8b-instruct-q4_k_m'); assert.strictEqual(gateBest.id, star[0].id);
  for (const c of ann.filter(x => x.agentCheck.ok)) assert.strictEqual(c.agentFit.level, 'fit', c.id);
});
test('B17: mọi máy — thẻ có ⭐ điều khiển máy luôn qua cổng, và nhóm của thẻ trùng nhãn mức chạy', () => {
  for (const [n, h] of Object.entries(MACHINES)) {
    const { ann, gateBest } = discover(h);
    const star = ann.find(c => c.recScreen);
    if (star) { assert.ok(star.agentCheck.ok, `${n}: ${star.id} có ⭐ nhưng cổng chặn: ${star.agentCheck.reason}`); assert.strictEqual(gateBest && gateBest.id, star.id, n); }
    else assert.strictEqual(gateBest, null, `${n}: cổng có mô hình nhưng không gắn ⭐`);
    for (const c of ann) if (c.agentCheck.ok) assert.notStrictEqual(c.agentFit.level, 'big', `${n}: ${c.id}`);
  }
});
test('B17: máy không chạy nổi mô hình AIVN AGENT nào → không gắn ⭐ điều khiển máy', () => {
  const { ann, gateBest } = discover(MACHINES.TINY);
  if (!gateBest) assert.ok(!ann.some(c => c.recScreen));
});
test('B17: lời chào không hứa nhìn ảnh/điều khiển màn hình khi mô hình chỉ đọc chữ', () => {
  const A = require('../src/agent/agent');
  const t = A.welcomeFor({ loaded: true, vision: false });
  assert.ok(!/Đọc ảnh|Điều khiển màn hình/.test(t), t); assert.match(t, /chưa nhìn được ảnh hay màn hình/);
  const v = A.welcomeFor({ loaded: true, vision: true, agentOk: true }); assert.match(v, /Đọc ảnh/); assert.match(v, /Điều khiển màn hình/);
  assert.ok(!/Điều khiển màn hình \(thử/.test(A.welcomeFor({ loaded: true, vision: true, agentOk: false })));
});
test('B17: cổng chặn mô hình không dùng được thì có nút chuyển hoặc tải (giao diện)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app.js'), 'utf8');
  const html = new Function('esc', 'fmtBytes', src.match(/function agentGateHtml\(g\) \{[\s\S]*?\n\}/)[0] + '; return agentGateHtml;')((x) => String(x), (b) => b + ' B');
  assert.match(html({ ok: false, code: 'text', reason: 'Chỉ đọc chữ', modelName: 'Qwen2.5 0.5B', best: null, recommended: [{ id: 'qwen3-vl-2b-instruct-q8_0', name: 'Qwen3-VL 2B', size: 3, installed: false }] }), /data-rec="qwen3-vl-2b-instruct-q8_0"/);
  assert.match(html({ ok: false, code: 'text', reason: 'Chỉ đọc chữ', modelName: 'Qwen2.5 0.5B', best: { id: 'x', name: 'Qwen3-VL 4B' } }), /data-switch="x"/);
});

// ---------- B18: việc theo lịch qua cùng cổng mô hình ----------
test('B18: runAgentTurn (dùng cho cả Gửi và Lịch tự động) kiểm tra cổng AIVN AGENT; chỉ bài đo được bỏ qua', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src/main.js'), 'utf8');
  const body = main.slice(main.indexOf('async function runAgentTurn('), main.indexOf('async function runAgentTurn(') + 1500);
  assert.match(body, /gate = true/); assert.match(body, /if \(gate\) \{\s*const g = await agentModelGate\(\);( agentStepScale = g\.stepScale \|\| 1;)?\s*if \(!g\.ok\)/);
  const sched = main.slice(main.indexOf('async function onScheduleFire('), main.indexOf('async function onScheduleFire(') + 2500);
  assert.match(sched, /runAgentTurn\(\{ convoId, headless: true, signal: ac\.signal, messages/); assert.ok(!/gate: false/.test(sched));
  assert.strictEqual((main.match(/runAgentTurn\([^)]*gate: false/g) || []).length, 1, 'chỉ bài đo Điểm tác vụ bỏ qua cổng');
});

// ---------- B19: nhãn công cụ và ngôn ngữ nhất quán ----------
test('B19: nhãn 🛠 Hỗ trợ công cụ không mâu thuẫn với ✓/⚠ Gọi công cụ; mô hình qua cổng AIVN AGENT luôn “Tốt”', () => {
  const { toolSupport } = require('../src/toolsupport');
  for (const c of catalog) {
    const t = toolSupport(c); const tc = (c.claims || []).filter(x => x.t === 'tools');
    if (tc.some(x => x.k === 'x')) assert.notStrictEqual(t.level, 'good', c.id);
    if (tc.some(x => x.k === 'v')) assert.notStrictEqual(t.level, 'none', c.id);
    if (AE.eligibility({ vision: !!c.mmproj, catalog: c, fit: null }, { shipped: shipped[c.id] }).ok) assert.strictEqual(t.level, 'good', `${c.id}: ${t.label}`);
  }
  assert.strictEqual(toolSupport(catalog.find(c => c.id === 'qwen3-vl-2b-instruct-q8_0')).label, 'Hạn chế'); // beta.2: 13/25 với câu lệnh thật
});
test('B19: “Đa ngôn ngữ” ghi rõ khi nhà phát triển không nêu tiếng Việt; mô tả không tự nhận tiếng Việt/độ vừa máy', () => {
  const llama = catalog.find(c => c.id === 'llama-3.2-3b-instruct-q4_k_m').claims.find(x => x.t === 'multilingual');
  assert.match(llama.label, /không có tiếng Việt/);
  for (const c of catalog) {
    const vi = (c.claims || []).some(x => x.t === 'vi');
    for (const x of (c.claims || []).filter(y => y.t === 'multilingual')) if (!vi) assert.match(x.label, /tiếng Việt/, c.id);
    if (!vi) assert.ok(!/tiếng Việt (tốt|khá)/i.test(c.desc), c.id);
    assert.ok(!/Hợp laptop GPU|Cho máy GPU \d+ GB|chạy mượt với GPU/i.test(c.desc), `${c.id}: mức chạy trên máy do nhãn tính, không ghi cứng trong mô tả`);
  }
});

// ---------- B14: chữ hướng dẫn đính kèm khớp với loại tệp đọc được thật ----------
test('B14: vùng thả tệp, nút 📎, bộ chọn tệp, read_file và thông báo lỗi khớp đúng loại tệp đọc được (0.16: có âm thanh/video — chép lời)', async () => {
  const D = require('../src/docs'); const html = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/index.html'), 'utf8');
  assert.ok(html.includes(`<span>${D.SUPPORTED_TEXT}</span>`), 'vùng thả tệp'); assert.ok(html.includes(`title="Đính kèm tệp: ${D.SUPPORTED_TEXT}"`), 'nút 📎');
  for (const e of ['xlsx', 'pptx', 'odt', 'ods', 'odp', 'zip', 'pdf', 'docx', 'png', 'txt']) assert.ok(D.PICKER_EXT.includes(e), e);
  for (const e of ['mp3', 'wav', 'mp4', 'mov']) assert.ok(D.PICKER_EXT.includes(e), 'bộ chọn cho chọn ' + e);
  assert.match(D.SUPPORTED_TEXT, /âm thanh\/video .*chép lời/); assert.match(D.SUPPORTED_SENTENCE, /âm thanh\/video \(chép lời trên máy\)/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src/main.js'), 'utf8'); assert.match(main, /extensions: require\('\.\/docs'\)\.PICKER_EXT/);
  const A = require('../src/agent/agent'); assert.match(A.DEFS.read_file.description, /XLSX/); assert.match(A.DEFS.read_file.description, /âm thanh\/video .*bản chép lời/);
  // mỗi loại trong danh sách đọc được thật (hành vi); âm thanh không đi qua bộ đọc tài liệu mà qua bộ nghe (src/media.js)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b14-'));
  fs.writeFileSync(path.join(tmp, 'a.wav'), Buffer.alloc(64)); fs.writeFileSync(path.join(tmp, 'a.xyz'), 'x');
  await assert.rejects(D.extractFile(path.join(tmp, 'a.wav')), /bộ nghe/);
  await assert.rejects(D.extractFile(path.join(tmp, 'a.xyz')), (e) => e.message.includes(D.SUPPORTED_SENTENCE));
  fs.writeFileSync(path.join(tmp, 'n.md'), '# Ghi chú\nxin chào'); assert.match((await D.extractFile(path.join(tmp, 'n.md'))).text, /xin chào/);
});
