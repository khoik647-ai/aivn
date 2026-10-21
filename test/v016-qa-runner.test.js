'use strict';
// QA runner (beta.3): --agent-task và --qa-ui — cổng bật, an toàn (luôn tự TỪ CHỐI bước cần xin phép), không cổng mạng/CDP, mã thoát, chạy thật trên Xvfb
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const Q = require('../src/qa-runner'); const U = require('../src/qa-ui');
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qar-'));

test('cổng bật: chỉ khi AIVN_QA_MODE=1 VÀ có cờ; thiếu biến môi trường → bỏ qua cờ + cảnh báo', () => {
  const argv = ['AIVN.exe', '--agent-task', 'mở Notepad', '--model', '4b', '--out', 'r.json'];
  assert.deepStrictEqual(Q.fromArgv(['AIVN.exe'], { AIVN_QA_MODE: '1' }), { enabled: false, args: null, warn: null });
  const off = Q.fromArgv(argv, {}); assert.strictEqual(off.enabled, false); assert.match(off.warn, /AIVN_QA_MODE=1/);
  assert.strictEqual(Q.fromArgv(argv, { AIVN_QA_MODE: 'true' }).enabled, false);
  const on = Q.fromArgv(argv, { AIVN_QA_MODE: '1' }, { cwd: '/x' }); assert.strictEqual(on.enabled, true); assert.strictEqual(on.kind, 'agent-task');
  assert.strictEqual(on.args.out, path.resolve('/x', 'r.json')); assert.strictEqual(on.args.timeout, 600); assert.strictEqual(on.args.model, '4b');
  assert.strictEqual(Q.fromArgv([...argv, '--qa-ui', 's.json'], { AIVN_QA_MODE: '1' }).enabled, false, 'không chạy cả hai loại một lúc');
  assert.match(Q.fromArgv(['a', '--agent-task', 'x'], { AIVN_QA_MODE: '1' }).warn, /--out/);
  assert.match(Q.fromArgv(['a', '--agent-task', 'x', '--out', 'o', '--lang', 'fr'], { AIVN_QA_MODE: '1' }).warn, /--lang/);
  assert.strictEqual(Q.fromArgv(['a', '--agent-task=x y', '--out=o.json', '--timeout', '30'], { AIVN_QA_MODE: '1' }).args.task, 'x y');
});
test('mô hình 2b/4b/8b → Qwen3-VL Instruct trên máy; id / tên tệp đúng', () => {
  const ms = [{ id: 'a', file: 'Qwen3-VL-4B-Instruct-Q4_K_M.gguf' }, { id: 'qwen3-vl-8b-instruct-q4_k_m', file: 'x.gguf' }, { id: 'b', file: 'gpt-oss-20b-MXFP4.gguf' }];
  assert.strictEqual(Q.resolveModel('4b', ms).id, 'a'); assert.strictEqual(Q.resolveModel('8B', ms).id, 'qwen3-vl-8b-instruct-q4_k_m');
  assert.strictEqual(Q.resolveModel('2b', ms), null); assert.strictEqual(Q.resolveModel('gpt-oss-20b-MXFP4', ms).id, 'b');
});
test('an toàn: bước cần xin phép LUÔN bị từ chối (kể cả câu “chỉ soạn”), không bao giờ tự cho phép', () => {
  for (const req of [{ risk: true }, { title: 'Gửi tin nhắn' }, { desc: 'xoá tệp' }, { text: 'Purchase item' }, { label: 'khoá máy' }, { desc: 'tăng âm lượng' }, { title: '发送' }])
    for (const draft of [false, true]) assert.strictEqual(Q.answerFor(req, { draft }).ok, false, JSON.stringify(req));
  assert.match(Q.answerFor({ risk: true }, { draft: true }).reason, /Chỉ soạn sẵn/);
  assert.ok(Q.DRAFT_RE.test('soạn tin cho Lan nhưng đừng gửi') && Q.DRAFT_RE.test('draft only') && Q.DRAFT_RE.test('只起草'));
  const src = fs.readFileSync(path.join(root, 'src/qa-runner.js'), 'utf8');
  assert.ok(!/approve:\s*async[^}]*ok:\s*true/.test(src), 'approve không bao giờ trả ok:true');
});
test('trạng thái trung thực + mã thoát 0/2/3', () => {
  assert.deepStrictEqual(Q.statusOf({ text: 'Xong', outcome: 'done' }), { status: 'done' });
  assert.strictEqual(Q.statusOf({ text: 'Gửi cho ai?', outcome: 'asked_user', asked: 'recipient' }).status, 'asked_user');
  assert.strictEqual(Q.statusOf({ text: 'x', outcome: 'done' }, { denied: 1 }).status, 'blocked');
  assert.strictEqual(Q.statusOf({ text: 'x', outcome: 'done' }, { denied: 1, draft: true }).status, 'done');
  assert.strictEqual(Q.statusOf({ text: 'x', outcome: 'failed' }).status, 'failed');
  assert.strictEqual(Q.statusOf(null, { timedOut: true }).status, 'failed');
  const g = new Error('chưa dùng được'); g.code = 'AGENT_GATE'; assert.strictEqual(Q.statusOf(null, { error: g }).status, 'blocked');
  assert.deepStrictEqual(['done', 'failed', 'blocked', 'asked_user'].map(Q.exitCodeOf), [0, 2, 2, 3]);
});
test('không có cổng mạng / CDP: mã QA không mở cổng gỡ lỗi từ xa hay máy chủ HTTP', () => {
  for (const f of ['src/qa-runner.js', 'src/qa-ui.js']) { const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/remote-debugging|createServer|\.listen\(|require\(['"](http|https|net|ws)['"]\)/.test(s), f); }
  const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'); assert.ok(!/remote-debugging-port/.test(m));
  assert.match(m, /q\.kind !== 'qa-ui'/, 'việc --qa-ui không được chuyển sang cửa sổ AIVN đang mở của người dùng');
});
test('qa-ui: dạng viết tắt các bước, kiểm lỗi kịch bản, phát hiện lỗi dịch', () => {
  assert.deepStrictEqual(U.normStep({ type: ['input', 'chào'] }), { do: 'type', testid: 'input', text: 'chào' });
  assert.deepStrictEqual(U.normStep({ waitFor: ['x', 500], onError: 'continue' }), { do: 'waitFor', testid: 'x', timeout: 500, onError: 'continue' });
  assert.deepStrictEqual(U.normStep({ click: { testid: 'a', timeout: 9 } }), { do: 'click', testid: 'a', timeout: 9 });
  assert.throws(() => U.normStep({ fly: 1 })); assert.throws(() => U.normStep({ click: 'a', type: 'b' }));
  const iss = U.i18nIssues(['Cài đặt', 'Settings', 'chat.send', '{0} items', '设置', 'NGUYỄN NGỌC KHÔI SINH VIÊN VLU', 'model.gguf'], 'en');
  assert.deepStrictEqual(iss.map(x => x.kind), ['vi-in-en', 'raw-key', 'placeholder', 'zh-in-en']);
  assert.deepStrictEqual(U.i18nIssues(['Trò chuyện', 'Chat'], 'vi'), []);
  const d = tmp(); fs.writeFileSync(path.join(d, 's.json'), '{"steps":[{"nope":1}]}');
  assert.match(U.validate({ script: path.join(d, 's.json'), out: 'o' }).error, /kịch bản sai/);
});
test('testid: phần tĩnh có data-testid duy nhất; phần động gắn ở testids.js', () => {
  const h = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8'); const ids = [...h.matchAll(/data-testid="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length > 300); assert.strictEqual(new Set(ids).size, ids.length, 'trùng testid');
  for (const k of ['nav-chat', 'nav-models', 'nav-discover', 'nav-agent', 'nav-crm', 'nav-settings', 'input', 'send-btn', 'approve-card', 'settings-tab-general', 'biz-tab-sales', 'ui-lang-sel']) assert.ok(ids.includes(k), k);
  assert.match(h, /<script src="testids.js"><\/script>/);
});

const runApp = (args, env = {}, secs = 240) => spawnSync('timeout', [String(secs), 'nice', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, AIVN_SKIP_ACTIVATION: '1', ...env } });
test('qa-ui thật (Xvfb, hồ sơ riêng): kịch bản smoke đạt hết → thoát 0; có seed, đổi ngôn ngữ/giao diện, ảnh chụp', { skip: !hasX && 'cần xvfb + electron', timeout: 300e3 }, () => {
  const d = tmp(); const r = runApp(['--qa-ui', 'test/fixtures/qa-ui/smoke.json', '--out', path.join(d, 'r.json'), '--shots', path.join(d, 'shots'), '--profile', path.join(d, 'p')], { AIVN_QA_MODE: '1' });
  const j = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8'));
  assert.deepStrictEqual(j.steps.filter(s => !s.ok).map(s => `${s.n} ${s.action}: ${s.error}`), []);
  assert.strictEqual(r.status, 0); assert.strictEqual(j.status, 'done'); assert.strictEqual(j.exitCode, 0);
  assert.strictEqual(j.reads.chatInput, 'xin chào từ QA'); assert.ok(fs.existsSync(j.finalShot)); assert.ok(fs.existsSync(path.join(d, 'shots', 'models-en.png')));
  assert.deepStrictEqual(j.i18n.issues, []); assert.deepStrictEqual(j.consoleErrors, []);
  assert.ok(j.resources.start && j.resources.end && j.screen && j.screen.displays.length);
  assert.ok(fs.existsSync(path.join(d, 'p', 'settings.json')), 'dữ liệu nằm trong hồ sơ QA');
});
test('qa-ui thật: bước hỏng → thoát 2, có lỗi + ảnh chụp lúc hỏng; dừng ở bước hỏng (onError mặc định stop)', { skip: !hasX && 'cần xvfb + electron', timeout: 300e3 }, () => {
  const d = tmp(); const r = runApp(['--qa-ui', 'test/fixtures/qa-ui/fail.json', '--out', path.join(d, 'r.json'), '--profile', path.join(d, 'p')], { AIVN_QA_MODE: '1' });
  const j = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8'));
  assert.strictEqual(r.status, 2); assert.strictEqual(j.status, 'failed'); assert.strictEqual(j.steps.length, 2);
  assert.match(j.steps[1].error, /khong-co-nut-nay/); assert.ok(fs.existsSync(j.steps[1].shot));
});
test('agent-task thật: không có mô hình → “blocked”, thoát 2, result.json đủ trường; kịch bản sai → thoát 2 ngay (không mở AIVN chờ mãi)', { skip: !hasX && 'cần xvfb + electron', timeout: 300e3 }, () => {
  const d = tmp(); const r = runApp(['--agent-task', 'mở Notepad', '--model', 'khong-co-mo-hinh', '--out', path.join(d, 'r.json'), '--profile', path.join(d, 'p'), '--timeout', '60'], { AIVN_QA_MODE: '1' });
  const j = JSON.parse(fs.readFileSync(path.join(d, 'r.json'), 'utf8'));
  assert.strictEqual(r.status, 2); assert.strictEqual(j.status, 'blocked'); assert.match(j.reason, /khong-co-mo-hinh/);
  for (const k of ['version', 'commit', 'model', 'screen', 'steps', 'finalAnswer', 'approvals', 'timings']) assert.ok(k in j, k);
  const r2 = runApp(['--qa-ui', path.join(d, 'nope.json'), '--out', path.join(d, 'r2.json')], { AIVN_QA_MODE: '1' }, 60);
  assert.strictEqual(r2.status, 2); assert.match(JSON.parse(fs.readFileSync(path.join(d, 'r2.json'), 'utf8')).reason, /không đọc được kịch bản/);
});
test('thiếu AIVN_QA_MODE=1: cờ bị bỏ qua, ghi cảnh báo vào aivn.log, không ghi result.json', { skip: !hasX && 'cần xvfb + electron', timeout: 120e3 }, () => {
  const d = tmp(); const env = { AIVN_USER_DATA: path.join(d, 'ud') }; delete process.env.AIVN_QA_MODE;
  runApp(['--qa-ui', 'test/fixtures/qa-ui/smoke.json', '--out', path.join(d, 'r.json')], env, 25);
  assert.ok(!fs.existsSync(path.join(d, 'r.json')));
  assert.match(fs.readFileSync(path.join(d, 'ud', 'logs', 'aivn.log'), 'utf8'), /thiếu biến môi trường AIVN_QA_MODE=1/);
});
