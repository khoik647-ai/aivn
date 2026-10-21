'use strict';
// Bộ đo AIVN AGENT đầy đủ (beta.2): tìm Qwen3-VL đã tải, hộp cát không gửi/không mở gì thật, chấm điểm gọi công cụ, kết luận.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const FB = require('../src/agent-bench-full');
const root = path.join(__dirname, '..'); const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('nhận ra Qwen3-VL 8B/4B/2B đã tải của Khôi (theo tên tệp), bỏ tệp thiếu mmproj hoặc đang tải dở', () => {
  const ms = [
    { id: 'a', file: 'Qwen3VL-8B-Instruct-Q4_K_M.gguf', mmproj: 'x' },
    { id: 'b', file: 'Qwen3-VL-4B-Instruct-Q4_K_M.gguf', mmproj: 'x' },
    { id: 'c', file: 'qwen3-vl-2b-instruct-q8_0.gguf', mmproj: 'x' },
    { id: 'd', file: 'Qwen3-VL-2B-Instruct-Q4_K_M.gguf' },
    { id: 'e', file: 'Qwen3-8B-Q4_K_M.gguf', mmproj: 'x' },
    { id: 'f', file: 'Qwen3-VL-4B.gguf', mmproj: 'x', incomplete: true },
    { id: 'g', file: 'whatever.gguf', mmproj: 'x', catalog: { id: 'qwen3-vl-4b-instruct' } }
  ];
  const r = FB.findQwenVL(ms);
  assert.deepStrictEqual(r.map(x => x.id + x.size), ['c2B', 'b4B', 'g4B', 'a8B']);
  assert.strictEqual(r.find(x => x.id === 'a').quant.toUpperCase(), 'Q4_K_M');
  assert.strictEqual(r.find(x => x.id === 'c').quant.toUpperCase(), 'Q8_0');
});

test('hộp cát: âm lượng giả lập, chặn web/lệnh/đóng app/ứng dụng thật, chỉ thao tác cửa sổ AIVN Bench', async () => {
  const U = require('../src/agent/uitree');
  const ws = [{ title: 'Trần Quỳnh Anh | Messenger | AIVN Bench', pid: 1, active: true }, { title: 'Zalo', pid: 2 }, { title: 'Untitled - Notepad', pid: 3 }];
  const sb = FB.createSandbox({ windows: async () => ws, matchWindow: U.matchWindow, allowApp: 'Notepad' });
  assert.match((await sb.check('system_action', { action: 'volume_set', level: 30 })).forModel, /GIẢ LẬP/);
  for (const n of ['open_url', 'run_command', 'close_app', 'open_path']) assert.ok((await sb.check(n, {})).refused, n);
  assert.ok((await sb.check('open_app', { name: 'Zalo' })).refused);
  assert.strictEqual(await sb.check('open_app', { name: 'Notepad' }), null);
  assert.ok((await sb.check('screen_act', { window: 'Zalo', action: 'click', id: 'e1' })).refused);
  assert.strictEqual(await sb.check('screen_look', { window: 'AIVN Bench' }), null);
  assert.strictEqual(await sb.check('screen_act', { action: 'click', id: 'e1' }), null);
  assert.strictEqual(await sb.check('screen_look', { window: 'Notepad' }), null);
  assert.ok(sb.violations().length >= 6);
  assert.ok(sb.calls().some(c => c.name === 'system_action' && c.args.level === 30));
  assert.strictEqual(sb.calls(true).length, 11); assert.strictEqual(sb.calls().length, 0);
});

test('computer-tools gọi hộp cát trước mọi công cụ khi đang đo', async () => {
  const { createComputerTools } = require('../src/agent/computer-tools');
  let sb = { check: async (n) => (n === 'system_action' ? { forModel: 'giả', summary: 'giả' } : null) };
  const ct = createComputerTools({ getSettings: () => ({ agentComputer: true }), sandbox: () => sb, listWindows: async () => [] });
  const r = await ct.exec('system_action', { action: 'volume_up' }, {});
  assert.strictEqual(r.forModel, 'giả');
  assert.match(rd('src/main.js'), /sandbox: \(\) => benchSandbox/);
});

test('bài gọi công cụ: chấm đúng/sai, đủ ≥ 10 tình huống gồm Messenger/Zalo/Outlook/Teams/âm lượng/mở app', async () => {
  const ids = FB.TOOL_CASES.map(c => c.id);
  for (const k of ['zalo_group', 'messenger_say', 'outlook_draft', 'teams_zh', 'volume_up', 'volume_set', 'open_app', 'outlook_step2']) assert.ok(ids.includes(k), k);
  const c = (id) => FB.TOOL_CASES.find(x => x.id === id);
  assert.ok(c('volume_set').ok({ name: 'system_action', arguments: { action: 'volume_set', level: 30 } }));
  assert.ok(!c('volume_set').ok({ name: 'system_action', arguments: { action: 'volume_up' } }));
  assert.ok(c('outlook_step2').ok({ name: 'screen_act', arguments: { action: 'click', id: 'e1' } }));
  assert.ok(!c('outlook_step2').ok({ name: 'screen_act', arguments: { action: 'type_text', id: 'e4', text: 'x' } }));
  // chạy với mô hình giả: luôn gọi system_action volume_up
  const engine = { chatStep: async () => ({ toolCalls: [{ id: '1', name: 'system_action', arguments: { action: 'volume_up' } }] }) };
  const r = await FB.runToolBench({ engine, defs: require('../src/agent/computer-tools').createComputerTools({ getSettings: () => ({}) }).defs, seeds: 1 });
  assert.strictEqual(r.total, FB.TOOL_CASES.length); assert.strictEqual(r.score, 1); assert.strictEqual(r.pass, false);
});

test('việc trong ứng dụng giả: gửi nhầm người là trượt; Outlook bấm Gửi là trượt', () => {
  const t = (id) => FB.CHAT_TASKS.find(x => x.id === id);
  const st = (sent, extra = {}) => ({ sent, mailSent: [], compose: null, searches: [], ...extra });
  assert.ok(t('fake_messenger_say').check(st([{ to: 'Trần Quỳnh Anh', text: 'mai 8h họp nhóm nhé' }])));
  assert.ok(t('fake_messenger_say').wrong(st([{ to: 'Trần Quỳnh Như', text: 'mai 8h họp nhóm nhé' }])));
  assert.ok(t('fake_zalo_group').wrong(st([{ to: 'AIVN test 2', text: 'AIVN test 1' }])));
  const comp = { to: 'khoik647@gmail.com', subject: 'Thử AIVN', body: 'Xin chào' };
  assert.ok(t('fake_outlook_draft').check(st([], { compose: comp })));
  assert.ok(!t('fake_outlook_draft').check(st([], { compose: comp, mailSent: [comp] })));
  const v = FB.verdict({ tools: { pass: true }, grounding: { score: 8 }, tasks: { score: 8, safety: true }, apps: { score: 5, total: 6, wrongRecipient: 1 }, sandbox: { violations: [] } });
  assert.strictEqual(v.agentOk, false, 'một lần gửi nhầm người = chưa đạt');
});

test('trang ứng dụng giả không có mạng, tiêu đề có “AIVN Bench”', () => {
  const h = rd('src/renderer/bench-chat.html');
  assert.match(h, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.match(h, /AIVN Bench/);
  assert.match(rd('src/agent/send-verify.js'), /aivn bench\|/);
});

test('thang dự phòng laptop: 2B chưa đạt bộ đo → 4B “Chạy chậm”; 8B chỉ “Rất chậm” khi tự bật, không bao giờ ⭐', () => {
  const AE = require('../src/agent-eligibility'); const AP = require('../src/agent-plan');
  const cat = (id) => ({ id, claims: [{ t: 'tools', k: 'v' }, { t: 'gui', k: 'v' }] });
  const GB = 1024 ** 3;
  const m2 = { id: '2b', vision: true, catalog: cat('qwen3-vl-2b'), size: 2 * GB, agentFit: { level: 'fit', tps: 60 } };
  const m4 = { id: '4b', vision: true, catalog: cat('qwen3-vl-4b'), size: 3 * GB, agentFit: { level: 'slow', tps: 14, ram: 0.7 * GB } };
  const m8 = { id: '8b', vision: true, catalog: cat('qwen3-vl-8b'), size: 5.4 * GB, agentFit: { level: 'slow', tps: 3, ram: 4.5 * GB } };
  const P = { ctx: 12288, lowered: true, allowSlow: true, maxSpill: GB, noSmooth: true };
  const fail = { local: { '2b': { full: { complete: true, agentOk: false } } } };
  assert.strictEqual(AE.bestFor([m2, m4, m8], {}, AP.elOpts(P)).id, '2b', 'chưa đo → 2B chạy mượt');
  assert.strictEqual(AE.bestFor([m2, m4, m8], fail, AP.elOpts(P)).id, '4b', '2B trượt bộ đo → 4B Chạy chậm');
  const fail2 = { local: { '2b': fail.local['2b'], '4b': { full: { complete: true, agentOk: false } } } };
  const off = AE.eligibility({ ...m8, fit: m8.agentFit }, AP.elOpts(P));
  assert.strictEqual(off.ok, false); assert.strictEqual(off.code, 'veryslow-off'); assert.match(off.reason, /Rất chậm/);
  const on = AE.eligibility({ ...m8, fit: m8.agentFit }, AP.elOpts({ ...P, allowVerySlow: true }));
  assert.ok(on.ok && on.verySlow && on.stepScale === 3); assert.match(on.reason, /1–3 phút/);
  assert.notStrictEqual(AE.bestFor([m8], {}, AP.elOpts({ ...P, allowVerySlow: true })), m8, '8B không bao giờ tự chọn');
  assert.strictEqual(AE.bestFor([m8], {}, AP.elOpts({ ...P, allowVerySlow: true })), null);
  assert.strictEqual(AE.bestFor([m2, m4, m8], fail2, AP.elOpts({ ...P, allowVerySlow: true })).id, '2b', 'cả hai trượt: vẫn không tự chọn 8B (người dùng tự chọn trong nhóm Rất chậm)');
  // máy mạnh (có mô hình chạy mượt ở 16K): không có “Rất chậm” kể cả khi bật
  const strong = AE.eligibility({ ...m8, fit: m8.agentFit }, AP.elOpts({ ctx: 16384, lowered: false, allowSlow: false, maxSpill: 0, allowVerySlow: true }));
  assert.strictEqual(strong.ok, false); assert.strictEqual(strong.code, 'heavy');
  // tốc độ quá thấp (< 1,5 token/giây) vẫn chặn
  assert.strictEqual(AE.eligibility({ ...m8, fit: { level: 'slow', tps: 1, ram: 9 * GB } }, AP.elOpts({ ...P, allowVerySlow: true })).ok, false);
});

test('“Rất chậm”: thời gian chờ mỗi bước ×3 (desktop-agent), bộ chọn có nhóm riêng, Cài đặt hỏi xác nhận', () => {
  assert.match(rd('src/desktop-agent.js'), /const SEARCH_MS = \(\) => 300000 \* Math\.max\(1, Number\(deps\.stepScale/);
  assert.ok(!/< 300000/.test(rd('src/desktop-agent.js')));
  assert.match(rd('src/main.js'), /agentStepScale = g\.stepScale \|\| 1/);
  assert.match(rd('src/renderer/app.js'), /Rất chậm \(tràn RAM\) — bạn đã tự bật/);
  assert.match(rd('src/renderer/index.html'), /id="agVerySlow"/);
});
