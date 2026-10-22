'use strict';
// B97–B99 (máy thật beta.2.3): --approve-send-to đọc tiêu đề CÙNG cách với cổng người nhận (B90) + dùng lại kết quả cổng; B98 huỷ qua --answer = cancelled (thoát 4);
// B99 bị từ chối → result.json ghi đúng lý do, không cảnh báo “mô hình yếu”
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const Q = require('../src/qa-runner'); const SV = require('../src/agent/send-verify');
const ROOT = path.join(__dirname, '..'); const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b97-'));
const TASK = 'gửi tin "AIVN test beta.2.3 – bỏ qua" cho Cloud của tôi trên Zalo';
// mảng tiêu đề THẬT trong result.json của QA (self-send/, self-send2/, deny/)
const QA_RUN1 = ['Q My Documents', 'Lưu và đồng bộ dữ liệu giữa các thiết bị', '2158'];
const QA_RUN2 = ['2158'];
const GATE = { chatOpen: SV.nameKey('Cloud của tôi'), placeholder: 'My Documents', openedBy: 'composer' };
const card = (shown, recipient = 'Cloud của tôi') => ({ title: '⚠ Bước quan trọng — kiểm tra kỹ', risk: 'gửi', desc: 'Gõ rồi bấm Enter', send: true, recipient, sendText: 'AIVN test beta.2.3 – bỏ qua', shown });

test('cleanHeader: bỏ ký tự lẻ do OCR biểu tượng, dòng phụ, giờ — dùng chung cho cổng người nhận và --approve-send-to', () => {
  assert.deepStrictEqual(SV.cleanHeader(QA_RUN1), ['My Documents']);
  assert.deepStrictEqual(SV.cleanHeader(QA_RUN2), []);
  assert.deepStrictEqual(SV.cleanHeader(['21:58', '9:05 PM', 'Hôm qua', '| Trần Quỳnh Anh', 'Vừa truy cập', 'Active now', 'My Documents 21:58', '在线']), ['Trần Quỳnh Anh', 'My Documents']);
  assert.deepStrictEqual(SV.cleanHeader(['Nhóm Lớp K27']), ['Nhóm Lớp K27'], 'tên thật giữ nguyên');
  // cổng người nhận (B90) đọc qua cùng hàm: tiêu đề “Q My Documents” = đã mở sẵn; ghi lại chữ gợi ý ô soạn đã khớp
  const st = {}; const g = SV.chatGate({ query: TASK, text: 'AIVN test beta.2.3 – bỏ qua', proc: 'Zalo', title: 'Zalo', state: st, header: QA_RUN1, ocrHeader: QA_RUN1, composer: ['Nhập @, tin nhắn tới My Documents'] });
  assert.strictEqual(g, null); assert.strictEqual(st.chatOpen, SV.nameKey('Cloud của tôi')); assert.strictEqual(st.placeholderSeen.name, 'My Documents');
  // tiêu đề người khác (đã làm sạch) vẫn bị cổng chặn
  assert.ok(SV.chatGate({ query: TASK, text: 'x', proc: 'Zalo', title: 'Zalo', state: {}, header: ['Q Nhóm Lớp K27', '2158'], ocrHeader: [], composer: ['Nhập @, tin nhắn tới Nhóm Lớp K27'] }));
});

test('selfChatShown: mảng tiêu đề thật của QA — run1 qua nhờ tiêu đề; ["2158"] CHỈ qua khi cổng + chữ gợi ý ô soạn đã khớp trong lượt, không bao giờ tự nó', () => {
  assert.ok(Q.selfChatShown(card({ header: QA_RUN1, composer: 'My Documents' })).ok, 'run1');
  assert.ok(Q.selfChatShown(card({ header: QA_RUN1, composer: null })).ok, 'run1, chữ gợi ý đã mất');
  const only = Q.selfChatShown(card({ header: QA_RUN2, composer: null })); assert.ok(!only.ok, '["2158"] một mình KHÔNG được qua'); assert.match(only.why, /2158/);
  assert.ok(Q.selfChatShown(card({ header: QA_RUN2, composer: null, gate: GATE })).ok, '["2158"] + cổng + chữ gợi ý → qua');
  assert.ok(!Q.selfChatShown(card({ header: QA_RUN2, composer: null, gate: { ...GATE, placeholder: null } })).ok, 'cổng chốt nhưng chưa thấy chữ gợi ý');
  assert.ok(!Q.selfChatShown(card({ header: QA_RUN2, composer: null, gate: { ...GATE, chatOpen: null } })).ok, 'chữ gợi ý nhưng cổng chưa chốt');
  assert.ok(!Q.selfChatShown(card({ header: QA_RUN2, composer: null, gate: { ...GATE, chatOpen: SV.nameKey('Trần Văn Bình') } })).ok, 'cổng chốt người khác');
  assert.ok(!Q.selfChatShown(card({ header: QA_RUN2, composer: null, gate: { ...GATE, placeholder: 'Nhóm Lớp K27' } })).ok, 'chữ gợi ý người khác');
  assert.ok(!Q.selfChatShown(card({ header: ['Q Nhóm Lớp K27', '2158'], composer: null, gate: GATE })).ok, 'tiêu đề là người khác → từ chối dù cổng đã chốt');
  assert.ok(!Q.selfChatShown(card({ header: QA_RUN2, composer: 'Trần Văn Bình', gate: GATE })).ok, 'ô soạn ghi người khác → từ chối');
  assert.ok(!Q.selfChatShown(card({ header: ['Q', '2158'], composer: null })).ok);
});

function fakeDeps(script) {
  const desk = { fn: null, setBenchAnswer(f) { this.fn = f; } };
  return { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], desk, LOG: { log: () => {}, tap: () => () => {} },
    runAgentTurn: async ({ messages }) => script({ ask: (req) => desk.fn(req), messages }) };
}
const sent = { id: 's', name: 'screen_act', status: 'ok', verify: { sent: true } };
const WEAK = '⚠ AIVN AGENT CHƯA thao tác gì trên Zalo trong lượt này (không có bước nào được làm) — nội dung ở trên chỉ là chữ trong khung chat, chưa được soạn/gửi trong Zalo. Bạn giao lại việc hoặc chọn mô hình mạnh hơn nhé.';

test('run: QA run1 / run2 (+cổng) được cho phép đúng MỘT lần; ["2158"] không có cổng → từ chối, reason ghi đúng lý do (B99), không cảnh báo mô hình yếu', async () => {
  for (const shown of [{ header: QA_RUN1, composer: null }, { header: QA_RUN2, composer: null, gate: GATE }]) {
    const d = tmp(); const res = await Q.run({ task: TASK, out: path.join(d, 'r.json'), timeout: 30, approveSendTo: 'Cloud của tôi' },
      fakeDeps(({ ask }) => { const a = ask(card(shown)); const b = ask(card(shown)); return { outcome: a.ok ? 'done' : 'blocked', text: 'Đã gửi.', steps: a.ok ? [sent] : [], b }; }));
    assert.strictEqual(res.approvals[0].answer.startsWith('allowed (--approve-send-to'), true, JSON.stringify(shown)); assert.strictEqual(res.approvals[1].answer, 'denied'); assert.strictEqual(res.approvedSends, 1);
  }
  const d = tmp(); const res = await Q.run({ task: TASK, out: path.join(d, 'r.json'), timeout: 30, approveSendTo: 'Cloud của tôi' },
    fakeDeps(({ ask }) => { ask(card({ header: QA_RUN2, composer: null })); return { outcome: 'blocked', text: 'Mình CHƯA gửi tin…', steps: [], warning: WEAK }; }));
  assert.strictEqual(res.approvals[0].answer, 'denied'); assert.strictEqual(res.status, 'blocked'); assert.strictEqual(res.exitCode, 2);
  assert.match(res.reason, /--approve-send-to không cho phép — chưa chắc là cuộc trò chuyện của chính bạn — tiêu đề khung chat \["2158"\]/);
  assert.strictEqual(res.warning, null, 'không cảnh báo “chọn mô hình mạnh hơn” khi dừng vì thẻ bị từ chối');
  const j = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8')); assert.strictEqual(j.reason, res.reason);
  // không có cờ --approve-send-to: lý do nói rõ bước GỬI bị từ chối
  const d2 = tmp(); const r2 = await Q.run({ task: TASK, out: path.join(d2, 'r.json'), timeout: 30 }, fakeDeps(({ ask }) => { ask(card({ header: QA_RUN1 })); return { outcome: 'blocked', text: '', steps: [], warning: WEAK }; }));
  assert.match(r2.reason, /bước GỬI bị tự TỪ CHỐI/); assert.strictEqual(r2.warning, null);
});

test('B99 trong agent: dừng vì bước GỬI bị từ chối thì không gắn cảnh báo “mô hình mạnh hơn”', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/agent/agent.js'), 'utf8');
  assert.match(src, /isAppTask\(query\) && !\(hardStop && hardStop\.sendRefused\) && !steps\.some/);
});

test('B98: huỷ qua --answer (“không”/“no”) → status cancelled, mã thoát 4; tài liệu ghi rõ', async () => {
  assert.deepStrictEqual(Q.statusOf({ outcome: 'done', cancelled: true, text: 'Đã huỷ — mình không gửi gì cả.', steps: [] }, { task: 'nhắn giúp mình là mai 8h họp nhé' }).status, 'cancelled');
  assert.strictEqual(Q.exitCodeOf('cancelled'), 4); assert.strictEqual(Q.exitCodeOf('done'), 0); assert.strictEqual(Q.exitCodeOf('asked_user'), 3); assert.strictEqual(Q.exitCodeOf('failed'), 2);
  for (const ans of ['không', 'no']) {
    const d = tmp(); let n = 0;
    const res = await Q.run({ task: 'nhắn giúp mình là mai 8h họp nhé', out: path.join(d, 'r.json'), timeout: 30, answer: ans },
      fakeDeps(() => (++n === 1 ? { outcome: 'asked_user', asked: 'recipient', text: 'Gửi cho ai?', steps: [] } : { outcome: 'done', cancelled: true, text: 'Đã huỷ — mình không gửi gì cả.', steps: [] })));
    assert.strictEqual(res.status, 'cancelled', ans); assert.strictEqual(res.exitCode, 4); assert.strictEqual(res.firstTurn.question, 'Gửi cho ai?');
  }
  const doc = fs.readFileSync(path.join(ROOT, 'docs/qa-runner.md'), 'utf8');
  assert.match(doc, /`4` = cancelled/); assert.match(doc, /status: "cancelled"` và \*\*mã thoát 4\*\*/); assert.match(doc, /\["2158"\]`\) \*\*không bao giờ\*\* tự nó cho qua/);
});

test('B97 thật (Electron + Xvfb, Zalo giả): tiêu đề “Q My Documents / Lưu và đồng bộ… / 21:58” và chỉ “21:58” — thẻ GỬI mang tiêu đề đã làm sạch + kết quả cổng, kiểm tra --approve-send-to cho qua', { skip: !fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')) || spawnSync('which', ['xvfb-run']).status !== 0, timeout: 360000 }, () => {
  const dir = tmp(); const ud = tmp();
  spawnSync('timeout', ['330', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: ROOT, env: { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_QA_B21_MODE: 'b97', AIVN_DESK_AUTO: '1', OMP_NUM_THREADS: '4' }, stdio: 'ignore' });
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'qab21.json'), 'utf8')); const by = Object.fromEntries(o.steps.map(s => [s.name, s]));
  const c1 = by['b97-noisy-header'].asks.find(a => a.send); assert.ok(c1, 'bước gõ + Enter phải qua thẻ GỬI');
  assert.ok(c1.shown.headerRaw.some(h => /^Q My Documents$/.test(h)), 'tái hiện tiêu đề OCR “Q My Documents”: ' + JSON.stringify(c1.shown.headerRaw));
  assert.deepStrictEqual(c1.shown.header, ['My Documents']); assert.ok(Q.selfChatShown(c1).ok, JSON.stringify(Q.selfChatShown(c1)));
  const c2 = by['b97-time-only-enter'].asks.find(a => a.send); assert.ok(c2, 'Enter riêng phải qua thẻ GỬI');
  assert.deepStrictEqual(c2.shown.header, [], 'chỉ còn giờ → không còn tên: ' + JSON.stringify(c2.shown.headerRaw));
  assert.strictEqual(c2.shown.gate.chatOpen, SV.nameKey('Cloud của tôi')); assert.strictEqual(c2.shown.gate.placeholder, 'My Documents');
  assert.ok(Q.selfChatShown(c2).ok, 'cổng + chữ gợi ý trong lượt → qua'); assert.ok(!Q.selfChatShown({ ...c2, shown: { ...c2.shown, gate: null } }).ok, 'bỏ kết quả cổng → không qua');
  assert.deepStrictEqual(o.final.sent.map(x => x.text), ['AIVN b97 một', 'AIVN b97 hai']); assert.ok(o.final.sent.every(x => x.to === 'My Documents'));
});
