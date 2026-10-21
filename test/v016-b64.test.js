'use strict';
// B64 (QA lượt 8, d10/zen; máy thật): máy chậm — kiểm tra lại sau khi bấm “Tìm kiếm” / Ctrl+F mất > 60 giây (27–263 giây trên CPU).
// Trước đây “vừa mở ô tìm kiếm” tính từ LÚC BẮT ĐẦU bấm → gõ tên người nhận ngay sau đó bị chặn “chưa mở đúng người nhận”. Nay: chế độ tìm kiếm
// bật khi bấm trúng phần tử tên Tìm kiếm/Search (kể cả chữ OCR) hoặc Ctrl+F/K/E / phím tìm của ứng dụng, đồng hồ tính từ lúc thao tác XONG.
const test = require('node:test'); const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'); const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const hasX = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));

test('B64 mã: chế độ tìm kiếm tính giờ từ lúc thao tác xong; ô soạn tin đọc được vẫn thắng', () => {
  const d = rd('src/desktop-agent.js');
  assert.match(d, /finally \{ const s = session; if \(s\) \{ const now = Date\.now\(\); if \(s\.lastAction && !s\.lastAction\.doneAt\) s\.lastAction\.doneAt = now; if \(s\.searchMode && !s\.searchMode\.at\) s\.searchMode\.at = now;/);
  const sc = d.slice(d.indexOf('function searchConfirmed'), d.indexOf('function opensSearch'));
  assert.ok(sc.indexOf('!focusedEl.ocr) return named(focusedEl)') < sc.indexOf('if (inSearchMode()) return true'), 'ô đang chọn đọc được (ô soạn) quyết định trước chế độ tìm kiếm');
  assert.match(d, /else if \(!\['type_text', 'wait', 'scroll'\]\.includes\(action\)\) s\.searchMode = null;/, 'bấm chỗ khác → tắt chế độ tìm kiếm');
});
test('B64 thật (Messenger giả, đồng hồ nhảy 90 giây sau mỗi cú bấm/phím tìm): gõ tên ngay sau đó vào ô tìm kiếm, gửi đúng người — cả đường bấm OCR “Tìm kiếm” và Ctrl+F', { skip: !hasX && 'cần xvfb-run + electron', timeout: 400000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b64-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b64-ud-'));
  const env = { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: '1', AIVN_QA_B21_MODE: 'b64slow' };
  const r = spawnSync('timeout', ['360', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: root, encoding: 'utf8', env });
  const f = path.join(dir, 'qab21.json'); assert.ok(fs.existsSync(f), (r.stderr || '').slice(-800));
  const d = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!d.error, d.error); assert.strictEqual(d.skews.length >= 2, true, 'đồng hồ đã nhảy');
  const by = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.ok(!by['b64-type-name'].blocked, by['b64-type-name'].summary); assert.deepStrictEqual(by['b64-type-name'].state.searches, ['Trần Quỳnh Anh']);
  assert.ok(!by['b64k-type-name'].blocked, by['b64k-type-name'].summary); assert.deepStrictEqual(by['b64k-type-name'].state.searches, ['Trần Quỳnh Anh', 'Lê Quỳnh Anh']);
  assert.deepStrictEqual(d.final.sent, [{ to: 'Trần Quỳnh Anh', text: 'Mai 8h họp nhóm nhé' }, { to: 'Lê Quỳnh Anh', text: 'Gửi mình file slide nhé' }],
    d.steps.filter(x => /^b64-/.test(x.name)).map(x => `${x.name} ${x.blocked ? 'BLOCKED' : 'ok'} ${x.summary} ${JSON.stringify(x.state)}\n${String(x.forModel).slice(0, 600)}`).join('\n---\n') + '\nud=' + ud);
});
