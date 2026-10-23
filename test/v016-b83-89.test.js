'use strict';
// Máy thật beta.3-pre: B83 --model 8b/4b không tìm thấy “Qwen3VL-…”; B84 agent-task báo done/thoát 0 khi câu trả lời nói chưa làm được, --profile mất cài đặt AIVN AGENT;
// B89 “tăng âm lượng thêm 10%” chạy một nấc phím (không đúng 10%), result.json không có bước của đường tắt
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const Q = require('../src/qa-runner'); const SI = require('../src/agent/sys-intent'); const C = require('../src/agent/computer');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
test('B83: --model 2b/4b/8b và tên chuẩn hoá (qwen3-vl == qwen3vl == Qwen3VL), id danh mục', () => {
  const ms = [{ id: 'qwen3vl-8b-instruct-q4_k_m', file: 'Qwen3VL-8B-Instruct-Q4_K_M.gguf' }, { id: 'qwen3vl-4b-thinking-q4_k_m', file: 'Qwen3VL-4B-Thinking-Q4_K_M.gguf' },
    { id: 'qwen3vl-4b-instruct-q8_0', file: 'Qwen3VL-4B-Instruct-Q8_0.gguf' }, { id: 'x', file: 'x.gguf', catalog: { id: 'qwen3-vl-2b' } }, { id: 'qwen3-vl-2b-instruct-q4_k_m', file: 'Qwen3-VL-2B-Instruct-Q4_K_M.gguf' }];
  assert.strictEqual(Q.resolveModel('8b', ms).id, 'qwen3vl-8b-instruct-q4_k_m'); assert.strictEqual(Q.resolveModel('4b', ms).id, 'qwen3vl-4b-instruct-q8_0');
  assert.strictEqual(Q.resolveModel('2b', ms).id, 'qwen3-vl-2b-instruct-q4_k_m');
  assert.strictEqual(Q.resolveModel('Qwen3-VL-8B-Instruct-Q4_K_M', ms).id, 'qwen3vl-8b-instruct-q4_k_m'); assert.strictEqual(Q.resolveModel('qwen3-vl-2b', ms).id, 'x');
  assert.strictEqual(Q.resolveModel('gpt-oss', ms), null);
});
test('B84: status không mặc định done — câu trả lời nói thất bại / gửi tin không kiểm chứng / không có outcome → failed; màn hình tắt → blocked', () => {
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Mình không thể điều khiển màn hình vì chưa được bật.' }).status, 'failed');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: "I can't control the screen." }).status, 'failed');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Đã gửi.', steps: [] }, { task: 'Mở Zalo và gửi tin "hi" cho Lan' }).status, 'failed');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Đã gửi.', steps: [{ verify: { sent: true } }] }, { task: 'Mở Zalo và gửi tin "hi" cho Lan' }).status, 'done');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Đã soạn.' }, { task: 'soạn tin cho Lan, chỉ soạn đừng gửi', draft: true }).status, 'done');
  assert.strictEqual(Q.statusOf({ text: 'x' }).status, 'failed');
  const e = new Error('Điều khiển màn hình đang TẮT'); e.code = 'SCREEN_OFF'; assert.strictEqual(Q.statusOf(null, { error: e }).status, 'blocked');
});
test('B84: --agent-settings-from main chỉ kèm --profile; chép agent* từ hồ sơ thật (chỉ đọc); QA dừng sớm khi màn hình tắt', async () => {
  assert.ok(!Q.validate({ task: 'x', out: 'o', agentFrom: 'main' }).ok); assert.ok(!Q.validate({ task: 'x', out: 'o', agentFrom: 'other', profile: '/tmp/p' }).ok);
  assert.strictEqual(Q.validate({ task: 'x', out: 'o', agentFrom: 'main', profile: '/tmp/p' }).args.agentFrom, 'main');
  assert.strictEqual(Q.parseArgs(['--agent-task', 'x', '--agent-settings-from', 'main']).agentFrom, 'main');
  const m = rd('src/main.js'); assert.match(m, /QA_PROFILE\.agentFrom === 'main'/); assert.match(m, /filter\(k => \/\^agent\/\.test\(k\)\)/); assert.match(m, /screenControl: \(\) =>/);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b84-')), 'r.json'); let ran = false;
  const r = await Q.run({ task: 'Mở Zalo', out, timeout: 30 }, { engine: { status: () => ({ loaded: true }) }, listModels: () => [], screenControl: () => ({ on: false, why: 'agentScreen = tắt' }), runAgentTurn: async () => { ran = true; return { outcome: 'done', text: 'x' }; } }, { runId: 't' });
  assert.strictEqual(r.status, 'blocked'); assert.strictEqual(r.exitCode, 2); assert.match(r.reason, /--agent-settings-from main/); assert.ok(!ran);
});
test('B89: “thêm/bớt N%”, “by N%” = đổi tương đối; “lên/về/to N”, “âm lượng N” = đặt mức; phủ định không làm', () => {
  for (const [q, a, l] of [['Tăng âm lượng thêm 10%', 'volume_change', 10], ['giảm âm lượng 20%', 'volume_change', -20], ['turn the volume up by 10%', 'volume_change', 10], ['lower the volume by 10 percent', 'volume_change', -10],
    ['tăng âm lượng lên 10%', 'volume_set', 10], ['âm lượng 30', 'volume_set', 30], ['set volume to 40', 'volume_set', 40], ['đặt âm lượng 30%', 'volume_set', 30], ['giảm âm lượng xuống 20', 'volume_set', 20]]) {
    assert.deepStrictEqual(SI.directSys(q), { action: a, level: l }, q);
  }
  assert.deepStrictEqual(SI.directSys('tăng âm lượng'), { action: 'volume_up' });
  for (const q of ['đừng tăng âm lượng thêm 10%', 'không chỉnh âm lượng 50']) assert.strictEqual(SI.directSys(q), null, q);
  assert.ok(C.sysAsked('volume_change', 'Tăng âm lượng thêm 10%')); assert.ok(C.SYS.volume_change && C.SYS.volume_change.confirm === false);
  assert.match(C.PS_VOLUME(null, 10), /\$b = \[AivnVol\]::Get\(\); \$a = \[AivnVol\]::Set\(\[Math\]::Max\(0, \[Math\]::Min\(100, \$b \+ \(10\)\)\)\)/);
  assert.match(C.PS_VOLUME(30), /\[AivnVol\]::Set\(30\)/);
});
test('B89: đường tắt ghi bước vào result.json (onStep bất đồng bộ được chờ) và có outcome', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b89-')), 'r.json'); const shots = path.dirname(out) + '/s';
  const res = await Q.run({ task: 'Tăng âm lượng thêm 10%', out, timeout: 30, shots }, { engine: { status: () => ({ loaded: true, id: 'm' }) }, listModels: () => [],
    windows: async () => [], ocr: async () => 'am luong', // không có cửa sổ đang hiện vẫn OCR; chữ sạch thì ảnh bước vẫn được ghi. Ca này kiểm tra onStep được chờ.
    capture: async () => { await new Promise(r => setTimeout(r, 200)); return { dataUrl: 'data:image/jpeg;base64,AA==' }; },
    runAgentTurn: async ({ qa }) => { const st = { id: 'auto_sys_1', name: 'system_action', args: { action: 'volume_change', level: 10 }, status: 'running', auto: true }; qa.onStep({ ...st }); const fin = { ...st, status: 'ok', summary: 'Âm lượng 40% → 50% (+10%)', ms: 200 }; qa.onStep(fin); return { text: 'Đã làm.', steps: [fin], outcome: 'done' }; } }, { runId: 't' });
  assert.strictEqual(res.status, 'done'); assert.strictEqual(res.steps.length, 1); assert.strictEqual(res.steps[0].tool, 'system_action'); assert.ok(res.steps[0].shot); assert.ok(res.steps[0].auto);
  assert.match(rd('src/agent/agent.js'), /outcome: out\.refused \? 'blocked' : out\.error \? 'failed' : 'done', fast: 'system_action'/);
});
