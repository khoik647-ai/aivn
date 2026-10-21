'use strict';
// beta.2.2: --approve-send-to (CHỈ cuộc trò chuyện của chính mình, tiêu đề khung chat xác nhận), --answer (trả lời câu hỏi B75),
// B93: result.json ghi người nhận của thẻ; sau khi bị từ chối, câu cuối nói rõ CHƯA gửi + đúng tên người nhận (QA thấy “Cloud của bạn”)
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const Q = require('../src/qa-runner');
const root = path.join(__dirname, '..'); const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b93-'));
const hasX = fs.existsSync(path.join(root, 'node_modules/.bin/electron')) && spawnSync('which', ['xvfb-run']).status === 0;
const TASK = 'gửi tin "AIVN test beta.2.2 - bỏ qua" cho Cloud của tôi trên Zalo';

test('--approve-send-to: chỉ nhận tên khác của cuộc trò chuyện với chính mình; tên khác → không hợp lệ (thoát 2); chỉ đi kèm --agent-task', () => {
  for (const n of ['Cloud của tôi', 'My Documents', 'my documents', 'My Cloud', '我的文档', 'Cloud cua toi']) assert.ok(Q.validate({ task: TASK, out: 'o.json', approveSendTo: n }).ok, n);
  for (const n of ['Trần Văn Bình', 'Nhóm Lớp K27', 'Cloud', 'My Documents 2', 'Documents', '']) { const v = Q.validate({ task: TASK, out: 'o.json', approveSendTo: n }); assert.ok(!v.ok, n); assert.match(v.error, /--approve-send-to/); }
  const env = { AIVN_QA_MODE: '1' };
  const bad = Q.fromArgv(['x', '--agent-task', TASK, '--out', 'o.json', '--approve-send-to', 'Trần Văn Bình'], env); assert.ok(bad.invalid); assert.match(bad.warn, /TỪ CHỐI “Trần Văn Bình”/);
  assert.ok(Q.fromArgv(['x', '--qa-ui', 's.json', '--out', 'o.json', '--approve-send-to', 'My Documents'], env).invalid);
  assert.ok(Q.fromArgv(['x', '--qa-input-diag', '--out', 'o.json', '--answer', 'Lan'], env).invalid);
  assert.strictEqual(Q.fromArgv(['x', '--agent-task', TASK, '--out', 'o.json', '--approve-send-to', 'My Documents'], {}).enabled, false, 'thiếu AIVN_QA_MODE=1 → không bật');
  const ok = Q.fromArgv(['x', '--agent-task', TASK, '--out', 'o.json', '--approve-send-to=My Documents', '--answer', 'Cloud của tôi'], env); assert.ok(ok.enabled);
  assert.strictEqual(ok.args.approveSendTo, 'My Documents'); assert.strictEqual(ok.args.answer, 'Cloud của tôi');
  assert.ok(!Q.validate({ task: TASK, out: 'o', answer: 'x'.repeat(501) }).ok);
});

// bộ giả: lượt AIVN AGENT gọi thẻ xin phép của lớp phủ (desk) qua setBenchAnswer, như desktop-agent thật
function fakeDeps(script) {
  const desk = { fn: null, setBenchAnswer(f) { this.fn = f; } }; const turns = [];
  return { turns, deps: { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], desk, LOG: { log: () => {}, tap: () => () => {} },
    runAgentTurn: async ({ messages, qa }) => { turns.push(messages); return script({ ask: (req) => desk.fn(req), qa, n: turns.length, messages }); } } };
}
const SEND = (header, recipient = 'Cloud của tôi', text = 'AIVN test beta.2.2 - bỏ qua') => ({ title: '⚠ Bước quan trọng — kiểm tra kỹ', risk: 'gửi', desc: `Gõ “${text}” vào ô đang chọn rồi bấm Enter`, send: true, recipient, sendText: text, shown: { header, composer: null } });
const sentStep = { id: 's', name: 'screen_act', status: 'ok', verify: { sent: true } };

test('--approve-send-to: cho phép ĐÚNG MỘT bước gửi tới chính mình khi tiêu đề khung chat xác nhận; ghi người nhận vào approvals', async () => {
  const d = tmp(); const { deps } = fakeDeps(({ ask }) => { const a = ask(SEND(['My Documents'])); const b = ask(SEND(['My Documents'], 'Cloud của tôi', 'lần hai')); return { outcome: a.ok ? 'done' : 'blocked', text: 'Đã gửi.', steps: a.ok ? [sentStep] : [], second: b }; });
  const res = await Q.run({ task: TASK, out: path.join(d, 'r.json'), timeout: 30, approveSendTo: 'Cloud của tôi' }, deps);
  assert.strictEqual(res.approvals.length, 2);
  assert.match(res.approvals[0].answer, /allowed \(--approve-send-to/); assert.strictEqual(res.approvals[0].recipient, 'Cloud của tôi'); assert.deepStrictEqual(res.approvals[0].shownChat.header, ['My Documents']);
  assert.strictEqual(res.approvals[0].text, 'AIVN test beta.2.2 - bỏ qua'); assert.strictEqual(res.approvals[1].answer, 'denied', 'chỉ một lần gửi');
  assert.strictEqual(res.approvedSends, 1); assert.strictEqual(res.status, 'blocked', 'bước gửi thứ hai bị từ chối → không phải done');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8')).approvals[0].recipient, 'Cloud của tôi');
});
test('--approve-send-to: KHÔNG cho phép khi tiêu đề là người khác / không đọc được tiêu đề / người nhận khác / thẻ không phải gửi / lệnh “chỉ soạn”', async () => {
  const cases = [[SEND(['Nhóm Lớp K27'])], [SEND([])], [SEND(['My Documents'], 'Trần Văn Bình')], [{ title: 'Xoá tệp', risk: 'xoá', desc: 'Xoá tệp a.txt' }], [SEND(['My Documents 2'])]];
  for (const [req] of cases) {
    const d = tmp(); const { deps } = fakeDeps(({ ask }) => { const a = ask(req); return { outcome: 'blocked', text: '', steps: [], a }; });
    const res = await Q.run({ task: TASK, out: path.join(d, 'r.json'), timeout: 30, approveSendTo: 'My Documents' }, deps);
    assert.strictEqual(res.approvals[0].answer, 'denied', JSON.stringify(req.shown || req.title)); assert.strictEqual(res.approvedSends, 0);
  }
  const d = tmp(); const { deps } = fakeDeps(({ ask }) => { ask(SEND(['My Documents'])); return { outcome: 'done', text: 'Đã soạn sẵn.', steps: [] }; });
  const res = await Q.run({ task: 'chỉ soạn, đừng gửi tin "x" cho Cloud của tôi trên Zalo', out: path.join(d, 'r.json'), timeout: 30, approveSendTo: 'My Documents' }, deps);
  assert.strictEqual(res.approvals[0].answer, 'denied');
  // thẻ confirm/approve (ngoài lớp phủ) luôn bị từ chối, kể cả có cờ
  const d2 = tmp(); const f2 = fakeDeps(async ({ qa }) => { const ok = await qa.confirm({ title: 'Gửi tin', recipient: 'Cloud của tôi', send: true, shown: { header: ['My Documents'] } }); return { outcome: 'blocked', text: '', steps: [], ok }; });
  const r2 = await Q.run({ task: TASK, out: path.join(d2, 'r.json'), timeout: 30, approveSendTo: 'My Documents' }, f2.deps); assert.strictEqual(r2.approvals[0].answer, 'denied');
});
test('không có cờ: thẻ GỬI bị từ chối DỨT KHOÁT (final) — desktop-agent dừng lượt; approvals ghi người nhận (B93)', async () => {
  const d = tmp(); let ans = null; const { deps } = fakeDeps(({ ask }) => { ans = ask(SEND(['My Documents'])); return { outcome: 'blocked', text: '', steps: [] }; });
  const res = await Q.run({ task: TASK, out: path.join(d, 'r.json'), timeout: 30 }, deps);
  assert.strictEqual(ans.ok, false); assert.strictEqual(ans.final, true); assert.strictEqual(res.approvals[0].recipient, 'Cloud của tôi'); assert.strictEqual(res.approvals[0].send, true);
});
test('--answer: AIVN AGENT hỏi lại → trả lời một lần, làm tiếp cùng cuộc trò chuyện; câu hỏi + câu trả lời ghi vào result.json', async () => {
  const d = tmp(); const { deps, turns } = fakeDeps(({ n }) => n === 1 ? { outcome: 'asked_user', asked: 'recipient', text: 'Gửi cho ai? Cho mình tên người nhận.', steps: [] } : { outcome: 'asked_user', asked: 'recipient', text: 'Gửi cho ai?', steps: [] });
  const res = await Q.run({ task: 'nhắn giúp mình là mai 8h họp nhé', out: path.join(d, 'r.json'), timeout: 30, answer: 'Cloud của tôi' }, deps);
  assert.strictEqual(turns.length, 2, 'chỉ trả lời MỘT lần'); assert.deepStrictEqual(turns[1].map(m => m.role), ['user', 'assistant', 'user']); assert.strictEqual(turns[1][2].content, 'Cloud của tôi');
  assert.match(res.firstTurn.question, /Gửi cho ai/); assert.strictEqual(res.answer, 'Cloud của tôi'); assert.strictEqual(res.status, 'asked_user');
  const d2 = tmp(); const f2 = fakeDeps(() => ({ outcome: 'done', text: 'Đã mở Zalo.', steps: [] }));
  const r2 = await Q.run({ task: 'mở Zalo', out: path.join(d2, 'r.json'), timeout: 30, answer: 'x' }, f2.deps); assert.strictEqual(f2.turns.length, 1, 'không hỏi thì không dùng --answer'); assert.ok(!r2.firstTurn);
});

function mkAgent(lang, exec) {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = tmp(); const calls = { model: 0, exec: [] };
  const engine = { status: () => ({ loaded: true, contextSize: 8192, vision: true }), chatStep: async () => { calls.model++; return { text: 'Đã chuẩn bị sẵn nội dung để gửi cho Cloud của bạn. Bạn có muốn mình gửi không?', toolCalls: [{ id: String(calls.model), name: 'screen_act', arguments: { action: 'type_text', text: 'AIVN test beta.2.2 - bỏ qua', submit: true } }], finishReason: 'tool_calls', usage: {} }; } };
  const names = ['open_app', 'screen_look', 'screen_act']; const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a, ctx) => { calls.exec.push([n, a, ctx && ctx.auto]); return exec(n, a); } };
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: true, uiLang: lang, agentScreen: true }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  return { agent, calls };
}
const refuseTo = (who) => (n, a) => n === 'screen_act' && a.action === 'type_text' ? { refused: true, stop: true, sendRefused: { recipient: who, text: 'AIVN test beta.2.2 - bỏ qua' }, error: 'bước gửi bị từ chối', forModel: 'từ chối', summary: 'bị từ chối' } : { forModel: 'ok', summary: 'ok' };
const refuse = (n, a) => n === 'screen_act' && a.action === 'type_text' ? { refused: true, stop: true, sendRefused: { recipient: 'Cloud của tôi', text: 'AIVN test beta.2.2 - bỏ qua' }, error: 'bước gửi bị từ chối', forModel: 'Bước GỬI tin tới “Cloud của tôi” đã bị TỪ CHỐI — tin CHƯA được gửi.', summary: 'bị từ chối' } : { forModel: 'ok', summary: 'ok' };
test('B93: bước GỬI bị từ chối → dừng, câu cuối “CHƯA gửi … cho “Cloud của tôi”” (đúng tên, không diễn đạt lại, không hỏi lại); vi/en/zh', async () => {
  // câu lệnh tiếng nào → trả lời tiếng đó (B57); tên người nhận trong ngoặc giữ NGUYÊN
  for (const [lang, task, re, who] of [['vi', TASK, /CHƯA gửi tin “AIVN test beta\.2\.2 - bỏ qua” cho “Cloud của tôi”: bước gửi đã bị từ chối/],
    ['en', 'send the message "AIVN test beta.2.2 - bỏ qua" to My Cloud on Zalo', /NOT sent the message “AIVN test beta\.2\.2 - bỏ qua” to “My Cloud”: the send step was refused/, 'My Cloud'],
    ['zh', '在 Zalo 上把消息"AIVN test beta.2.2 - bỏ qua"发送给 Cloud của tôi', /“AIVN test beta\.2\.2 - bỏ qua”发送给“Cloud của tôi”：发送步骤被拒绝/]]) {
    const { agent } = mkAgent(lang, who ? refuseTo(who) : refuse);
    const r = await agent.run({ messages: [{ role: 'user', content: task }], confirm: async () => false, qa: true });
    assert.match(r.text, re, `${lang}: ${r.text}`); assert.ok(!/Cloud của bạn|có muốn/i.test(r.text), r.text); assert.strictEqual(r.outcome, 'blocked');
    if (lang !== 'vi') assert.ok(!/bước gửi đã bị từ chối/.test(r.text), `${lang} phải được dịch: ${r.text}`);
  }
});
test('QA: lệnh có “không cần hỏi lại” — bước GỬI vẫn phải qua thẻ (askBeforeSend), các bước khác như cũ; ngoài QA không đổi', async () => {
  const AU = require('../src/agent/autonomy');
  const { agent, calls } = mkAgent('vi', refuse);
  await agent.run({ messages: [{ role: 'user', content: TASK + ' Không cần hỏi lại.' }], confirm: async () => false, qa: true });
  const sa = calls.exec.filter(x => x[0] === 'screen_act'); assert.ok(sa.length);
  for (const x of sa) { const au = x[2]; assert.ok(au && au.askBeforeSend === true); assert.strictEqual(AU.skipAsk(au, 'desk-send', { text: 'AIVN test beta.2.2 - bỏ qua' }), false, 'QA không bao giờ tự gửi'); assert.strictEqual(AU.skipAsk(au, 'desk-step'), true, 'bước thường vẫn tự làm'); }
  const b = mkAgent('vi', refuse); await b.agent.run({ messages: [{ role: 'user', content: TASK + ' Không cần hỏi lại.' }], confirm: async () => false });
  const au2 = b.calls.exec.filter(x => x[0] === 'screen_act')[0][2]; assert.ok(au2.on && !au2.askBeforeSend); assert.strictEqual(AU.skipAsk(au2, 'desk-send', { text: 'AIVN test beta.2.2 - bỏ qua' }), true, 'ngoài QA: như trước');
});
test('main.js: cờ sai → ghi nhật ký + thoát 2; lượt QA truyền qa vào agent.run; desktop-agent: thẻ gửi mang recipient/shown, từ chối → sendRefused', () => {
  const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'); assert.match(m, /LOG\.log\('qa', qaReq\.warn \+ ' → thoát mã 2'\)/); assert.match(m, /qa: !!qa,/);
  const s = fs.readFileSync(path.join(root, 'src/desktop-agent.js'), 'utf8'); assert.match(s, /send: true, recipient: gateRcp/); assert.match(s, /sendRefused: \{ recipient: who/);
});
test('thật (Xvfb): --approve-send-to "Trần Văn Bình" → từ chối chạy, thoát 2, có dòng nhật ký + result.json', { skip: !hasX && 'cần xvfb + electron', timeout: 120e3 }, () => {
  const d = tmp(); const ud = path.join(d, 'ud');
  const r = spawnSync('timeout', ['90', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--agent-task', TASK, '--approve-send-to', 'Trần Văn Bình', '--out', path.join(d, 'r.json'), '--profile', path.join(d, 'p')], { cwd: root, encoding: 'utf8', env: { ...process.env, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_MODE: '1', AIVN_USER_DATA: ud } });
  assert.strictEqual(r.status, 2, r.stderr); assert.match(r.stderr, /TỪ CHỐI “Trần Văn Bình”/);
  const j = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8')); assert.strictEqual(j.exitCode, 2); assert.match(j.reason, /chính bạn/);
  const logs = [path.join(ud, 'logs', 'aivn.log'), path.join(d, 'p', 'logs', 'aivn.log')].filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  assert.match(logs, /--approve-send-to TỪ CHỐI “Trần Văn Bình”.*thoát mã 2/);
});
