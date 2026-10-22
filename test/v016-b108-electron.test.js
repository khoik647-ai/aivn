'use strict';
// B108/B111 (máy thật beta.2.5) trên Zalo GIẢ (Electron + Xvfb, công cụ thật của desktop-agent, vòng lặp AIVN AGENT thật, mô hình KỊCH BẢN):
// (1) “mở Zalo và mở chat Cloud của tôi” — open_chat kiểm tiêu đề (“My Documents” = tên mới), mô hình định gõ “@My Documents” rồi GỬI “Chào bạn!” → đều bị chặn, KHÔNG thẻ gửi, ô soạn trống;
// (2) không có bước kiểm tiêu đề → B111 không báo xong; (3) B101/B97 GIỮ NGUYÊN: gửi tin có nội dung trong yêu cầu → MỘT thẻ, gửi, kiểm chứng, xong;
// (4) việc gửi mà mô hình gõ chữ khác yêu cầu → không gõ, không thẻ, hỏi người dùng nội dung chính xác.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const hasX = (() => { try { return spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')); } catch { return false; } })();

test('Zalo giả: mở chat không gửi gì; không gửi tin tự bịa; B101 vẫn gửi đúng tin', { skip: !hasX && 'cần xvfb + electron', timeout: 400e3 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b108e-')); const ud = path.join(d, 'ud'); const dir = path.join(d, 'out'); fs.mkdirSync(ud); fs.mkdirSync(dir);
  spawnSync('timeout', ['380', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--user-data-dir=' + ud], { cwd: ROOT, env: { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_QA_B21_MODE: 'b108', AIVN_DESK_AUTO: '1', OMP_NUM_THREADS: '4' }, stdio: 'ignore' });
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'qab21.json'), 'utf8'));
  const sendCards = (r) => r.asks.filter(a => a.send).length;
  // (1)
  const a = o.openOnly; assert.ok(a, 'thiếu openOnly');
  assert.strictEqual(a.outcome, 'done', a.text); assert.match(a.steps[0].summary, /đang mở sẵn|đã mở/);
  assert.deepStrictEqual(a.steps.slice(1).map(s => s.status), ['refused', 'refused']);
  assert.strictEqual(sendCards(a), 0, 'không thẻ GỬI'); assert.deepStrictEqual(a.state.sent, []); assert.strictEqual(a.state.comp, '', 'không gõ gì vào ô soạn'); assert.strictEqual(a.state.q, '');
  assert.match(a.log.join('\n'), /Chặn gõ \(B108\): “@My Documents”/);
  // (2)
  const b = o.noVerify; assert.notStrictEqual(b.outcome, 'done', 'B111: chưa kiểm tiêu đề thì không xong'); assert.strictEqual(sendCards(b), 0); assert.deepStrictEqual(b.state.sent, []); assert.strictEqual(b.state.comp, '');
  // (3) B101/B97
  const c = o.realSend; assert.strictEqual(c.outcome, 'done', c.text); assert.match(c.text, /^Đã gửi tin “AIVN b108 thật” tới “Cloud của tôi” và đã kiểm chứng/);
  assert.strictEqual(sendCards(c), 1, 'đúng MỘT thẻ GỬI'); assert.deepStrictEqual(c.state.sent, [{ to: 'My Documents', text: 'AIVN b108 thật' }]); assert.strictEqual(c.state.comp, '');
  // (4)
  const e = o.paraphrase; assert.strictEqual(e.outcome, 'asked_user'); assert.match(e.text, /Bạn muốn gửi chính xác nội dung gì cho “Cloud của tôi”/);
  assert.strictEqual(sendCards(e), 0); assert.deepStrictEqual(e.state.sent, []); assert.strictEqual(e.state.comp, '');
});
