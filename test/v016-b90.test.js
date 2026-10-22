'use strict';
// B90 (máy thật beta.2.1, agent-send1): Zalo đã mở sẵn đúng “My Documents” (tên mới của “Cloud của tôi”) — chốt người nhận vẫn chặn vì lượt này chưa TÌM,
// mô hình bấm ô soạn 4 lần rồi bỏ cuộc. Nay: tiêu đề khung giữa HOẶC chữ gợi ý ô soạn (“Nhập @, tin nhắn tới X”, en/zh) khớp chặt người nhận/tên khác → cho gõ.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const SV = require('../src/agent/send-verify');
const ROOT = path.join(__dirname, '..');
const Q = 'gửi tin "AIVN test beta.2.1 - bỏ qua" cho Cloud của tôi trên Zalo'; // đúng câu lệnh QA (cmd.txt)
const zalo = (cur, comp = `Nhập @, tin nhắn tới ${cur}`) => ({ win: { title: 'Zalo', b: [0, 0, 1024, 576] }, elements: [
  { name: 'Tìm kiếm', b: [40, 22, 120, 12], ocr: true }, { name: 'My Documents', b: [70, 87, 56, 11], ocr: true }, { name: 'Nhóm Lớp K27', b: [70, 120, 60, 11], ocr: true },
  { name: cur, b: [243, 18, 64, 12], ocr: true }, { name: 'Thông tin hội thoại', b: [886, 22, 92, 12], ocr: true }, { name: cur, b: [906, 94, 66, 11], ocr: true },
  { name: 'Hôm qua', b: [513, 82, 30, 8], ocr: true }, ...(comp ? [{ name: comp, b: [211, 558, 125, 10], ocr: true }] : [])] });
const gate = (obs, extra = {}) => { const R = SV.regionsOf(obs); const st = { ...extra };
  const g = SV.chatGate({ query: Q, text: 'AIVN test beta.2.1 - bỏ qua', submit: true, title: 'Zalo', proc: 'Zalo.exe', state: st, header: R.header, ocrHeader: R.header, composer: [...R.composer, ...obs.elements.map(e => e.name)] });
  return { g, st }; };
test('B90 agent-send1: “My Documents” mở sẵn, CHƯA tìm trong lượt → cho gõ (tiêu đề khung giữa + ô soạn)', () => {
  const { g, st } = gate(zalo('My Documents')); assert.strictEqual(g, null, g); assert.ok(st.chatOpen); assert.match(st.gateNote, /My Documents.*Cloud của tôi/);
});
test('B90: chỉ một trong hai bằng chứng cũng đủ — chỉ ô soạn (OCR không đọc được tiêu đề), chỉ tiêu đề (không có chữ gợi ý); en/zh; “|” con trỏ', () => {
  const noHdr = zalo('My Documents'); noHdr.elements = noHdr.elements.filter(e => !(e.name === 'My Documents' && e.b[0] === 243));
  assert.strictEqual(gate(noHdr).g, null); assert.strictEqual(gate(noHdr).st.openedBy, 'composer');
  assert.strictEqual(gate(zalo('My Documents', 'Nhập tin nhắn')).g, null); assert.strictEqual(gate(zalo('My Documents', 'Nhập tin nhắn')).st.openedBy, 'header'); // ô soạn chỉ ghi chung chung (không nêu tên)
  for (const c of ['|Nhập @, tin nhắn tới My Documents', 'Type @ to mention, message to My Documents', '输入 @，发送消息给 我的文档', 'Message My Cloud']) {
    const o = zalo('My Documents', c); o.elements = o.elements.filter(e => !(e.b[0] === 243)); assert.strictEqual(gate(o).g, null, c);
  }
});
test('B90: chat KHÁC đang mở → vẫn chặn; gợi ý bảo TÌM, KHÔNG bảo bấm ô soạn; khớp lỏng (“My Documents 2”) không được nhận', () => {
  const { g } = gate(zalo('Nhóm Lớp K27')); assert.ok(g); assert.match(g, /ô Tìm kiếm/); assert.match(g, /ĐỪNG bấm vào ô soạn/); assert.match(g, /Nhóm Lớp K27/);
  assert.ok(gate(zalo('My Documents 2')).g); assert.ok(gate(zalo('Lan', null)).g);
  // ô soạn ghi người khác dù tiêu đề OCR lẫn chữ “My Documents” → mâu thuẫn → chặn
  const mix = zalo('My Documents', 'Nhập @, tin nhắn tới Nhóm Lớp K27'); assert.ok(gate(mix).g);
  // gợi ý mặc định (không đọc được gì) cũng dặn đừng bấm ô soạn
  const blank = { win: { title: 'Zalo', b: [0, 0, 1024, 576] }, elements: [{ name: 'Tìm kiếm', b: [40, 22, 120, 12], ocr: true }, { name: 'Hôm qua', b: [513, 300, 30, 8], ocr: true }] };
  const gb = gate(blank).g; assert.ok(gb); assert.match(gb, /KHÔNG đổi được người nhận/);
});
test('B90: tin nhắn trong khung có chữ giống gợi ý không bị coi là ô soạn; composerTarget', () => {
  assert.strictEqual(SV.composerTarget(['Nhập tin nhắn']), null); assert.strictEqual(SV.composerTarget(['Lan: Nhập @, tin nhắn tới My Documents nhé']), null);
  assert.strictEqual(SV.composerTarget(['Nhập @, tin nhắn tới My Documents']), 'My Documents');
});
test('B90 thật (Electron + Xvfb, Zalo giả 3 cột): “My Documents” mở sẵn → gửi ngay, không tìm; đổi sang chat khác → chặn', { skip: !fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')) || spawnSync('which', ['xvfb-run']).status !== 0, timeout: 300000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b90-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b90u-'));
  spawnSync('timeout', ['280', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: ROOT, env: { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_QA_B21_MODE: 'b90', AIVN_DESK_AUTO: '1', OMP_NUM_THREADS: '4' }, stdio: 'ignore' });
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'qab21.json'), 'utf8')); const st = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.ok(!d.error, String(d.error));
  assert.ok(!st['b90-open-send'].blocked, st['b90-open-send'].forModel + st['b90-open-send'].summary);
  assert.ok(st['b90-wrong-open'].blocked); assert.match(st['b90-wrong-open'].forModel, /ô Tìm kiếm/);
  // beta.2.2: bộ chạy QA thật — --approve-send-to cho phép đúng bước gửi tới chính mình (tiêu đề khung “My Documents”); không có cờ → từ chối, dừng, ghi người nhận
  const ap = d.qaApprove; assert.strictEqual(ap.approvals.length, 1); assert.match(ap.approvals[0].answer, /--approve-send-to/);
  assert.strictEqual(ap.approvals[0].recipient, 'Cloud của tôi'); assert.ok(ap.approvals[0].shownChat.header.includes('My Documents'), JSON.stringify(ap.approvals[0].shownChat));
  assert.strictEqual(ap.approvals[0].text, 'AIVN self 1'); assert.strictEqual(ap.status, 'done', ap.reason); assert.strictEqual(ap.exitCode, 0);
  const dn = d.qaDeny; assert.strictEqual(dn.approvals[0].answer, 'denied'); assert.strictEqual(dn.approvals[0].recipient, 'Cloud của tôi'); assert.strictEqual(dn.status, 'blocked');
  const act2 = d.qaActs.find(x => x.text === 'AIVN self 2'); assert.ok(act2.stop && act2.sendRefused, JSON.stringify(act2)); assert.strictEqual(act2.sendRefused.recipient, 'Cloud của tôi');
  assert.deepStrictEqual(d.final.sent, [{ to: 'My Documents', text: 'AIVN test beta.2.2 - bỏ qua' }, { to: 'My Documents', text: 'AIVN self 1' }]);
  assert.match(fs.readFileSync(path.join(ud, 'logs', 'aivn.log'), 'utf8'), /Chốt người nhận \(B90\)/);
});
