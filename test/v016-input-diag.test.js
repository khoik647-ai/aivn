'use strict';
// --qa-input-diag (beta.3): bằng chứng chuột/phím trên máy thật cho B62/B66 — cổng bật, chạy thật trên Xvfb, trình phụ Windows biên dịch được
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const Q = require('../src/qa-runner'); const DG = require('../src/qa-input-diag');
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
const hasMcs = spawnSync('which', ['mcs']).status === 0;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-diag-t-'));

test('cổng bật: --qa-input-diag là cờ không giá trị, cần AIVN_QA_MODE=1 + --out; không chạy chung với loại QA khác', () => {
  const on = Q.fromArgv(['AIVN.exe', '--qa-input-diag', '--out', 'diag.json'], { AIVN_QA_MODE: '1' }, { cwd: '/x' });
  assert.strictEqual(on.enabled, true); assert.strictEqual(on.kind, 'input-diag'); assert.strictEqual(on.args.out, path.resolve('/x', 'diag.json'));
  assert.strictEqual(Q.fromArgv(['AIVN.exe', '--out', 'd.json', '--qa-input-diag'], { AIVN_QA_MODE: '1' }).kind, 'input-diag');
  const off = Q.fromArgv(['AIVN.exe', '--qa-input-diag', '--out', 'd.json'], {}); assert.strictEqual(off.enabled, false); assert.match(off.warn, /AIVN_QA_MODE=1/);
  assert.match(Q.fromArgv(['AIVN.exe', '--qa-input-diag'], { AIVN_QA_MODE: '1' }).warn, /--out/);
  assert.strictEqual(Q.fromArgv(['a', '--qa-input-diag', '--agent-task', 'x', '--out', 'o'], { AIVN_QA_MODE: '1' }).invalid, true);
});
test('danh sách kiểm tra đủ yêu cầu: độ trễ bấm, tổ hợp phím (có dấu cách), gõ tiếng Việt + tiếng Trung', () => {
  assert.deepStrictEqual(DG.CLICK_DELAYS, [0, 50, 120, 300]);
  for (const c of ['win+s', 'ctrl+l', 'ctrl+t', 'ctrl+f', 'ctrl+h', 'enter', 'alt+tab']) assert.ok(DG.COMBOS.includes(c), c);
  assert.ok(DG.COMBOS.some(c => / \+ /.test(c)) && DG.COMBOS.some(c => /^\s|\s$/.test(c)), 'tổ hợp có dấu cách');
  assert.deepStrictEqual(DG.TEXTS.map(t => t.lang), ['vi', 'zh']);
  const K = require('../src/agent/keys'); for (const c of DG.COMBOS) for (const pf of ['win32', 'linux']) assert.doesNotThrow(() => K.parse(c, pf), `${c} @${pf}`);
  assert.deepStrictEqual(DG.flagNames(0x91), ['EXTENDED', 'INJECTED', 'UP']);
});
test('an toàn: không cổng mạng/CDP; trình phụ chỉ móc phím trong lúc kiểm tra, chỉ ghi mã phím', () => {
  const s = fs.readFileSync(path.join(root, 'src/qa-input-diag.js'), 'utf8');
  assert.ok(!/remote-debugging|createServer|\.listen\(|require\(['"](http|https|net|ws)['"]\)/.test(s));
  assert.ok(/helper\.stop\(\)/.test(s) && /finally/.test(s), 'luôn tắt trình phụ (gỡ móc phím) kể cả khi lỗi');
  assert.ok(!/ToUnicode|GetKeyNameText/.test(DG.CS), 'không đổi mã phím thành chữ');
});
test('trình phụ Windows (C#) biên dịch được', { skip: !hasMcs && 'cần mcs (mono)' }, () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'diag.cs'), DG.CS);
  const r = spawnSync('mcs', ['-target:library', '-out:' + path.join(d, 'diag.dll'), path.join(d, 'diag.cs')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(DG.PS(path.join(d, 'diag.cs')), /\[AivnDiag\]::Init\(\)[\s\S]*StartHooks/);
});
test('chạy thật (Xvfb): bấm ở mọi độ trễ, mọi tổ hợp phím, dán tiếng Việt/tiếng Trung → đạt, thoát 0; phần Windows ghi rõ “chỉ có trên Windows”', { skip: !hasX && 'cần xvfb + electron', timeout: 300e3 }, () => {
  const d = tmp(); const out = path.join(d, 'diag.json');
  const r = spawnSync('timeout', ['240', 'nice', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--qa-input-diag', '--out', out, '--profile', path.join(d, 'p')],
    { cwd: root, encoding: 'utf8', env: { ...process.env, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_MODE: '1' } });
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepStrictEqual([j.summary.failedClicks, j.summary.failedKeys, j.summary.failedTyping], [[], [], []], JSON.stringify(j.summary));
  assert.strictEqual(r.status, 0); assert.strictEqual(j.status, 'done'); assert.strictEqual(j.kind, 'input-diag');
  assert.strictEqual(j.clicks.length, 9); assert.ok(j.clicks.every(c => c.phys && (c.offsetPx ? Math.abs(c.offsetPx.x) <= 3 && Math.abs(c.offsetPx.y) <= 3 : true)));
  assert.ok(j.keys.find(k => k.combo === 'ctrl+l').received.some(e => e.type === 'keydown' && e.key === 'l' && e.ctrl));
  assert.ok(j.keys.every(k => k.sendInputExpected && /VK 0x/.test(k.sendInputExpected)));
  assert.strictEqual(j.keys.find(k => k.combo === 'win + s').parsed.combo, 'meta+s');
  assert.deepStrictEqual(j.typing.filter(t => t.method === 'paste').map(t => t.got), DG.TEXTS.map(t => t.text));
  assert.strictEqual(j.helper.ok, false); assert.match(j.helper.reason, /Windows/);
  assert.ok(j.displays.length && j.displays[0].scaleFactor && j.window.bounds);
});
// B91 (máy thật beta.2.1): lần bấm đầu tiên rơi vào Zalo — nay hỏi WindowFromPoint trước MỖI lần bấm; không phải AIVN → đưa lên trước + thử lại, 3 lần vẫn không → bỏ qua
test('B91 (Xvfb, WindowFromPoint giả): điểm bấm thuộc cửa sổ khác → thử lại rồi bấm; 3 lần vẫn khác → BỎ QUA (không bấm), báo rõ', { skip: !hasX && 'cần xvfb + electron', timeout: 300e3 }, () => {
  const d = tmp(); const out = path.join(d, 'diag.json');
  spawnSync('timeout', ['240', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox', '--qa-input-diag', '--out', out, '--profile', path.join(d, 'p')],
    { cwd: root, encoding: 'utf8', env: { ...process.env, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_MODE: '1', AIVN_QA_DIAG_FAKEWFP: 'FFF FFO' } });
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  const [c1, c2] = j.clicks;
  assert.strictEqual(c1.target, 'b1'); assert.strictEqual(c1.skipped, true); assert.strictEqual(c1.ok, false); assert.ok(!c1.received, 'không bấm khi điểm bấm không thuộc AIVN');
  assert.strictEqual(c1.windowFromPoint.root.process, 'Zalo');
  assert.strictEqual(c2.target, 'b5'); assert.ok(c2.ok, JSON.stringify(c2)); assert.strictEqual(c2.pointIsOurWindow, true, 'chỉ bấm sau khi xác nhận điểm bấm là AIVN');
  assert.strictEqual(j.guard.retries, 5); assert.strictEqual(j.guard.skipped.length, 1); assert.strictEqual(j.summary.skipped, 1);
  assert.ok(j.clicks.slice(1).every(c => !c.skipped)); assert.strictEqual(j.status, 'failed'); assert.match(j.reason, /BỎ QUA/);
  const src = fs.readFileSync(path.join(root, 'src/qa-input-diag.js'), 'utf8'); assert.match(src, /setAlwaysOnTop\(true/);
  assert.strictEqual((src.match(/mouseClick\(/g) || []).length, 2, 'mọi lần bấm đi qua safeClick/ours (chỉ còn 2 chỗ gọi mouseClick: safeClick và vòng bấm đã kiểm)');
});
