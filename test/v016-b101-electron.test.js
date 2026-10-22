'use strict';
// B101–B104 trên Zalo GIẢ (Electron + Xvfb, công cụ thật của desktop-agent, vòng lặp AIVN AGENT thật với mô hình KỊCH BẢN):
// (1) mô hình chỉ gõ nội dung (không submit, như máy QA beta.2.4) → AIVN tự bấm Enter QUA THẺ GỬI, kiểm chữ trước Enter (log B94), thấy bong bóng + ô soạn trống → việc XONG, mô hình không được gọi tiếp;
// (2) giữ chốt người nhận: soạn sẵn → bấm bong bóng tin (bỏ chốt) → chữ gợi ý ô soạn đã mất → gửi vẫn qua (theo tiêu đề), xoá chữ cũ, gửi MỘT lần đúng chữ;
// (3) chữ vào NHẦM ô → không bấm Enter, xoá, không gửi; (4) B104 dọn chữ đã gõ (clear) / người dùng dừng → báo còn đó, không thao tác.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const hasX = (() => { try { return spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')); } catch { return false; } })();

test('Zalo giả: tự gửi qua thẻ + kiểm chứng + xong việc; giữ chốt khi chữ gợi ý mất; chữ vào nhầm ô không gửi; dọn chữ đã gõ', { skip: !hasX && 'cần xvfb + electron', timeout: 480e3 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b101e-')); const ud = path.join(d, 'ud'); const dir = path.join(d, 'out'); fs.mkdirSync(ud); fs.mkdirSync(dir);
  spawnSync('timeout', ['450', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--user-data-dir=' + ud], { cwd: ROOT, env: { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_QA_B21_MODE: 'b101', AIVN_DESK_AUTO: '1', OMP_NUM_THREADS: '4' }, stdio: 'ignore' });
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'qab21.json'), 'utf8')); const by = Object.fromEntries(o.steps.map(s => [s.name, s]));
  // (1) luồng đầy đủ
  const f = o.full; assert.ok(f, 'thiếu kết quả luồng đầy đủ');
  assert.strictEqual(f.outcome, 'done', f.text); assert.match(f.text, /^Đã gửi tin “AIVN b101 một” tới “Cloud của tôi” và đã kiểm chứng trên màn hình/);
  assert.strictEqual(f.modelCalls, 2, 'gửi xong + kiểm chứng → không gọi mô hình tiếp (không bấm lung tung)');
  assert.deepStrictEqual(f.state.sent, [{ to: 'My Documents', text: 'AIVN b101 một' }]); assert.strictEqual(f.state.comp, '');
  const cards = f.asks.filter(a => a.send); assert.strictEqual(cards.length, 1, 'đúng MỘT thẻ GỬI'); assert.strictEqual(cards[0].recipient, 'Cloud của tôi');
  assert.ok(f.steps.some(s => s.name === 'screen_act' && s.args.action === 'type_text' && !s.args.submit && s.sent), 'mô hình KHÔNG submit, AIVN tự gửi');
  const lg = f.log.join('\n'); assert.match(lg, /B101: việc gửi tin, người nhận đã chốt/); assert.match(lg, /B94: kiểm chữ sau khi gõ “AIVN b101 một”: CÓ trong ô soạn tin → bấm Enter/);
  assert.ok(lg.indexOf('Xin phép (đã hỏi) — bước GỬI') < lg.indexOf('B94: kiểm chữ sau khi gõ “AIVN b101 một”'), 'thẻ GỬI phải trước khi gõ/bấm Enter');
  assert.match(lg, /B101: gửi xong và đã kiểm chứng → kết thúc việc/);
  // (2) giữ chốt + xoá chữ cũ
  assert.ok(!by['b102-draft-type'].blocked); assert.strictEqual(by['b102-draft-type'].state.comp, 'AIVN b101 hai'); assert.deepStrictEqual(by['b102-draft-type'].state.sent, [], 'soạn sẵn: KHÔNG tự gửi');
  const s2 = by['b102-send-after-lock-lost']; assert.ok(!s2.blocked, 'mất chữ gợi ý + bấm chỗ khác không được làm mất chốt khi tiêu đề vẫn đúng: ' + s2.summary);
  assert.deepStrictEqual(s2.state.sent, [{ to: 'My Documents', text: 'AIVN b101 hai' }], 'gửi MỘT lần, đúng chữ (không lặp chữ cũ)'); assert.ok(s2.asks.some(a => a.send));
  const L = (o.log101 || []).join('\n'); assert.match(L, /B104: xoá chữ AIVN gõ trước đó còn trong ô soạn \(“AIVN b101 hai”\) trước khi gõ lại/);
  // (3) chữ vào nhầm ô
  const s3 = by['b101-wrong-field']; assert.ok(s3.blocked); assert.match(s3.summary, /chữ vào nhầm ô — chưa gửi, đã xoá/); assert.deepStrictEqual(s3.state.sent, []); assert.strictEqual(s3.state.q, '', 'đã xoá chữ gõ nhầm');
  assert.match(L, /vào NHẦM ô .*KHÔNG bấm Enter/);
  // (4) dọn chữ
  assert.strictEqual(by['b104-keep'].cleaned.kept, true); assert.strictEqual(by['b104-keep'].cleaned.cleared, false); assert.strictEqual(by['b104-keep'].state.comp, 'AIVN b101 bốn', 'việc chỉ soạn: bản nháp được giữ');
  assert.strictEqual(by['b104-cleanup'].cleaned.cleared, true); assert.strictEqual(by['b104-cleanup'].state.comp, '');
  assert.deepStrictEqual({ cleared: by['b104-stopped'].cleaned.cleared, left: by['b104-stopped'].cleaned.left }, { cleared: false, left: true }); assert.strictEqual(by['b104-stopped'].state.comp, 'AIVN b101 năm', 'người dùng dừng → không thao tác');
  assert.deepStrictEqual(o.final.sent, []);
});
