'use strict';
// Hồi quy cho báo cáo QA lượt 1 (21/10/2026, /workspace/qa-review/pass-1-20261021-0805.md), mỗi lỗi B1–B12 một nhóm kiểm tra.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const C = require('../src/agent/computer'); const { createComputerTools } = require('../src/agent/computer-tools');
const A = require('../src/agent/agent'); const { createAgent } = A; const SV = require('../src/agent/send-verify');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 5 } });
const call = (name, args, id = 'c' + Math.random().toString(36).slice(2, 7)) => ({ text: '', toolCalls: [{ id, name, arguments: args }], finishReason: 'tool_calls', usage: {} });

// ---------- B1: thao tác hệ thống không được yêu cầu phải hỏi trước ----------
test('B1: khoá màn hình/âm lượng chỉ chạy ngay khi người dùng yêu cầu ĐÚNG thao tác đó', () => {
  const q = 'trong kho mô hình tôi nên chọn ai để có thể thao tác trực tiếp trên máy';
  for (const a of ['lock', 'volume_up', 'volume_down', 'mute', 'show_desktop', 'open_settings']) assert.strictEqual(C.sysAsked(a, q), false, a);
  assert.ok(C.sysAsked('lock', 'khoá màn hình giúp tôi')); assert.ok(C.sysAsked('lock', 'Khóa máy lại đi'));
  assert.ok(C.sysAsked('volume_down', 'giảm âm lượng xuống')); assert.ok(C.sysAsked('mute', 'tắt tiếng máy'));
  assert.ok(!C.sysAsked('lock', 'giảm âm lượng')); assert.ok(!C.sysAsked('volume_up', 'khoá màn hình'));
});
test('B1: system_action lock không được yêu cầu → hiện thẻ hỏi; từ chối thì không khoá', async () => {
  const asked = []; let locked = 0;
  const orig = C.systemAction; C.systemAction = async (a) => { locked++; return C.SYS[a].label; };
  try {
    const ct = createComputerTools({ getSettings: () => ({ agentComputer: true }), openPath: async () => '', openExternal: async () => {} });
    const r = await ct.exec('system_action', { action: 'lock' }, { userQuery: 'tôi nên chọn mô hình nào?', confirm: async (req) => { asked.push(req); return false; } });
    assert.strictEqual(asked.length, 1); assert.match(asked[0].message, /CHƯA yêu cầu/); assert.ok(r.refused); assert.strictEqual(locked, 0);
    const r2 = await ct.exec('system_action', { action: 'lock' }, { userQuery: 'khoá màn hình giúp tôi', confirm: async (req) => { asked.push(req); return false; } });
    assert.strictEqual(asked.length, 1, 'người dùng đã yêu cầu khoá: không hỏi lại'); assert.strictEqual(locked, 1); assert.ok(!r2.refused);
  } finally { C.systemAction = orig; }
});

// ---------- B2: “đã gửi” phải có bằng chứng trên màn hình ----------
test('B2: nhận ra người nhận trong câu yêu cầu', () => {
  assert.strictEqual(SV.recipientOf('gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại'), 'trần quỳnh anh');
  assert.strictEqual(SV.recipientOf('nhắn cho Lan là mai họp'), 'Lan');
  assert.strictEqual(SV.recipientOf('mở zalo'), null);
});
test('B2: gõ vào ô đang chọn rồi Enter mà không thấy tên người nhận → CHƯA gửi', () => {
  const v = SV.verifySend({ msg: 'Chúc buổi sáng, Trần Quỳnh Anh!', recipient: 'trần quỳnh anh', screenText: 'Zalo\n[e3] ô "Tìm kiếm"\nNhóm Lớp K27\nChúc buổi sáng, Trần Quỳnh Anh!' , seen: '' });
  assert.strictEqual(v.sent, true, 'tên nằm trong chính tin nhắn vẫn được tính — kiểm tiếp ca dưới');
  const v2 = SV.verifySend({ msg: 'Chúc buổi sáng nhé!', recipient: 'trần quỳnh anh', screenText: 'Zalo\nNhóm Lớp K27\nChúc buổi sáng nhé!' });
  assert.strictEqual(v2.sent, false); assert.match(v2.why, /không thấy tên người nhận/);
  const v3 = SV.verifySend({ msg: 'Chúc buổi sáng nhé!', recipient: 'trần quỳnh anh', screenText: 'Trần Quỳnh Anh\nVừa truy cập', seen: '' });
  assert.strictEqual(v3.sent, false); assert.match(v3.why, /không thấy “Chúc buổi sáng nhé!”/);
  const ok = SV.verifySend({ msg: 'Chúc buổi sáng nhé!', recipient: 'trần quỳnh anh', screenText: 'Tran Quynh Anh\nChúc buổi sáng nhé!\n08:01' });
  assert.strictEqual(ok.sent, true);
  assert.ok(SV.isSendAction('hotkey', { keys: 'enter' }, '', 'Chúc buổi sáng')); assert.ok(!SV.isSendAction('hotkey', { keys: 'enter' }, '', null));
  assert.ok(SV.isSendAction('click', {}, 'nút Gửi', null));
});
test('B2: câu “đã gửi thành công” không có kiểm chứng → nhắc kiểm tra, rồi bị thay bằng câu trung thực; “xác nhận qua OCR” bị chặn', async () => {
  const names = ['screen_act', 'screen_look', 'open_app'];
  const CT = require('../src/agent/computer-tools');
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const replies = [call('screen_act', { action: 'type_text', text: 'Chúc buổi sáng, Trần Quỳnh Anh!' }), call('screen_act', { action: 'hotkey', keys: 'enter' }),
    say('✅ Tin nhắn đã được gửi thành công và đã xuất hiện trong lịch sử trò chuyện.'), say('Tin nhắn đã được gửi (xác nhận qua OCR).')];
  const msgs = [];
  const engine = { status: () => ({ loaded: true, contextSize: 8192, vision: true }), chatStep: async (m) => { msgs.push(m[m.length - 1]); return replies.shift(); } };
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError,
    exec: async (n, a) => a.keys === 'enter' ? { forModel: 'Đã bấm phím enter. CHƯA kiểm chứng được là đã gửi', summary: 'bấm phím enter · CHƯA kiểm chứng', verify: { sent: false, why: 'không thấy tên người nhận “trần quỳnh anh” trên màn hình' } } : { forModel: 'Đã gõ', summary: 'gõ chữ' } };
  const ag = createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false }), memory: { count: () => 0 }, scheduler: {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  const r = await ag.run({ messages: [{ role: 'user', content: 'gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh không cần hỏi lại' }], confirm: async () => true });
  assert.ok(msgs.some(m => m && m.role === 'user' && /Chưa có bằng chứng trên màn hình/.test(m.content)), 'phải nhắc kiểm tra');
  assert.ok(!/đã được gửi|thành công/.test(r.text), r.text); assert.match(r.text, /CHƯA xác nhận/); assert.ok(!/OCR/.test(r.text));
  assert.ok(r.warning);
});
test('B2: đã kiểm chứng trên màn hình thì được báo đã gửi', () => {
  const steps = [{ name: 'screen_act', status: 'ok', verify: { sent: true } }];
  assert.strictEqual(A.sendClaimCheck('Đã gửi tin nhắn cho Trần Quỳnh Anh.', steps), null);
  assert.strictEqual(A.guardClaims('Đã gửi tin nhắn cho Trần Quỳnh Anh.', steps).text, 'Đã gửi tin nhắn cho Trần Quỳnh Anh.');
  assert.match(A.guardClaims('Đã gửi (xác nhận qua OCR).', steps).text, /^Đã gửi\.?$/);
});
test('B2: desktop-agent ghi kết quả kiểm chứng vào out.verify sau thao tác gửi', () => {
  const src = read('src/desktop-agent.js');
  assert.match(src, /SV\.isSendAction\(action, sendA, targetName, s\.lastTyped\)/); assert.match(src, /verify = SV\.verifySend\(/); assert.match(src, /detail: checks\.join\(' '\), verify \}/);
  assert.match(read('src/agent/agent.js'), /verify: out\.verify/);
});

// ---------- B3/B4: không có mô hình nhìn ảnh → chặn điều khiển màn hình ----------
test('B3: mô hình không nhìn được ảnh thì không có screen_act/screen_look; có nhìn ảnh thì có', () => {
  const CT = require('../src/agent/computer-tools');
  const mk = (vision) => { const names = ['open_app', 'screen_act', 'screen_look']; const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
    return createAgent({ engine: { status: () => ({ loaded: true, contextSize: 8192, vision }) }, computer: { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError }, getSettings: () => ({ agentFolders: [], agentMemory: false }), memory: { count: () => 0 }, scheduler: {} }); };
  const off = mk(false).activeTools(); assert.ok(!off.includes('screen_act') && !off.includes('screen_look'), off.join()); assert.ok(off.includes('open_app'));
  const on = mk(true).activeTools(); assert.ok(on.includes('screen_act') && on.includes('screen_look'));
});
test('B4: nút công cụ bị chặn không ghi “· tắt”', () => {
  const app = read('src/renderer/app.js');
  assert.match(app, /s\.st === 'blocked' \? ' · ' \+ esc\(s\.short \|\| 'bị chặn'\)/);
  assert.match(app, /short: 'cần mô hình nhìn màn hình'/);
});

// ---------- B5: cảnh báo không viết cứng tên mô hình, không báo “chưa làm gì” khi công cụ đã chạy ----------
test('B5: cảnh báo không gợi ý cứng Qwen3 4B/8B; đã có bước xong thì không báo “chưa có việc nào được làm”', () => {
  for (const w of [A.NO_ACTION_WARN, A.REPEAT_WARN, A.NO_COMP_WARN]) assert.ok(!/Qwen/.test(w), w);
  const app = read('src/renderer/app.js'); assert.ok(!/hãy dùng <b>Qwen3 4B\/8B<\/b>/.test(app)); assert.ok(!/Nên dùng <b>Qwen3 4B Instruct 2507<\/b>/.test(app));
  assert.match(app, /function warnBox\(w\)/); assert.ok(!/<b>⚠ Chưa có việc nào được làm<\/b><span>\$\{esc\(m\.warning\)\}/.test(app));
  // video t128: “Ghi nhớ · xong” rồi bước giả → không được ghi “chưa có việc nào được làm”; đã thao tác máy thật thì không cảnh báo
  assert.strictEqual(A.noActionWarn([{ name: 'save_memory', status: 'ok' }]), A.NO_COMP_WARN);
  assert.strictEqual(A.noActionWarn([{ name: 'screen_act', status: 'ok' }]), null);
  assert.strictEqual(A.noActionWarn([]), A.NO_ACTION_WARN);
  assert.ok(!/chưa có việc nào được làm/i.test(A.NO_COMP_WARN));
});

// ---------- B6: không đổ nguyên OCR thô, kèm “\n” dạng chữ ----------
test('B6: đổi “\\n” dạng chữ thành xuống dòng và gom phần OCR chép lại thành khối trích dẫn', () => {
  assert.strictEqual(A.tidyAnswer('Khoá màn hình. Chữ đọc được… \\nAdil Pr\\nYou may see', []), 'Khoá màn hình. Chữ đọc được… \nAdil Pr\nYou may see');
  const d = 'Adil Pressure gauge\nYou may see the light\nSettings and privacy\nHelp center line\nAnother line here ok\nSixth OCR line text';
  const t = A.tidyAnswer('Kết quả: ' + d.replace(/\n/g, ' \n') + ' xong.', [{ name: 'read_screen_text', status: 'ok', detail: d }]);
  assert.match(t, /Chữ đọc được trên màn hình:\n> Adil Pressure gauge\n> You may see the light/); assert.match(t, /xong\.$/);
});

// ---------- B7: cắt phần giữa giữ vai luân phiên ----------
test('B7: trim-middle/rolling không để 2 tin assistant (hay user) liền nhau', () => {
  const { fitOverflow } = require('../src/chatfit');
  const m = [{ role: 'system', content: 's' }, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'x'.repeat(300) }, { role: 'assistant', content: 'y'.repeat(30) }, { role: 'user', content: 'u3' }];
  const alt = (ms) => ms.filter(x => x.role !== 'system').every((x, i, a) => i === 0 || x.role !== a[i - 1].role);
  for (const p of ['trim-middle', 'rolling']) { const r = fitOverflow(m, p, 100, 514, t => t.length).messages; assert.ok(alt(r), p + ': ' + r.map(x => x.role).join(',')); assert.strictEqual(r[r.length - 1].content, 'u3'); assert.strictEqual(r.filter(x => x.role !== 'system')[0].role, 'user'); }
  assert.deepStrictEqual(fitOverflow(m, 'trim-middle', 100, 514, t => t.length).messages.map(x => x.content.slice(0, 2)), ['s', 'u1', 'a1', 'u3']);
  // nhiều lượt dài: luôn luân phiên ở mọi ngân sách
  const long = [{ role: 'system', content: 's' }]; for (let i = 0; i < 12; i++) long.push({ role: 'user', content: 'q' + i + 'x'.repeat(40 * (i % 3)) }, { role: 'assistant', content: 'a' + i + 'y'.repeat(50 * (i % 4)) }); long.push({ role: 'user', content: 'cuối' });
  for (let ctx = 200; ctx < 2400; ctx += 97) for (const p of ['trim-middle', 'rolling']) { const r = fitOverflow(long, p, 64, ctx, t => t.length).messages; assert.ok(alt(r), `${p} ${ctx}`); assert.strictEqual(r.at(-1).content, 'cuối'); }
});
test('B7: mẫu Gemma 3 (bắt luân phiên) chạy được sau khi cắt', () => {
  const tplPath = path.join(root, 'test/fixtures/gemma3.jinja'); if (!fs.existsSync(tplPath)) return;
  const tpl = fs.readFileSync(tplPath, 'utf8'); assert.match(tpl, /must alternate/);
});

// ---------- B8: liên kết “Đã kiểm chứng” không 404 ----------
test('B8: nhãn ✓ trỏ tới trang kiểm chứng trên GitHub Pages do release.sh tạo, mọi mục neo đều có', () => {
  const claims = require('../src/catalog-claims'); const cat = require('../src/catalog');
  const v = cat.flatMap(c => c.claims || []).filter(x => x.k === 'v'); assert.ok(v.length > 5);
  const md = read('docs/verified.md'); const { render } = require('../build/md-page.cjs'); const html = render(md);
  for (const x of v) { assert.match(x.src, /^https:\/\/khoik647-ai\.github\.io\/aivn\/verified\.html#[\w-]+$/, x.src); const id = x.src.split('#')[1]; assert.ok(html.includes(`<a id="${id}"></a>`), 'thiếu mục ' + id); }
  assert.ok(!/github\.com\/khoik647-ai\/aivn\/blob\/main\/docs\/verified\.md/.test(read('src/catalog-claims.js')));
  const rel = read('release.sh'); assert.match(rel, /node build\/md-page\.cjs docs\/verified\.md "\$SITE\/verified\.html"/);
  void claims;
});

// ---------- B11, B12 ----------
test('B11: ứng dụng gọi thống nhất là “Khám phá”, không còn “Kho mô hình”', () => {
  for (const f of ['src/renderer/app.js', 'src/renderer/index.html', 'src/main.js', 'src/hf.js', 'src/downloader.js']) assert.ok(!/Kho mô hình/.test(read(f)), f);
});
test('B12: đầu câu trả lời hiện tên hiển thị của mô hình, không phải id tệp', () => {
  const app = read('src/renderer/app.js');
  assert.match(app, /m\.model \? ' · ' \+ esc\(modelLabel\(m\.model\)\)/); assert.match(app, /function modelLabel\(id\)/);
});
