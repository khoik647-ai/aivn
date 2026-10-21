'use strict';
// QA lượt 8: B76 (Outlook o10) nội dung thư bị gõ vào ô Tiêu đề 3 lần — id đổi theo chữ (e12→e15→e16) nên chống lặp theo id không bắt được;
// + ghi chú B66 lượt 8: lỗi NÉM RA ở screen_act (vd. “Invalid key flag specified.”) không đi qua retry.after → không bao giờ bị chặn lần 3
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const U = require('../src/agent/uitree');
const ROOT = path.join(__dirname, '..');

test('B76: fuzzyHas chịu OCR sai dấu, không nhận bừa', () => {
  assert.ok(U.fuzzyHas(U.fold('Lich hop nhém'), U.fold('Lịch họp nhóm')));
  assert.ok(U.fuzzyHas(U.fold('xx Nhom minh hop luc 8h sang thu Nam nhe yy'), U.fold('Nhóm mình họp lúc 8h')));
  assert.ok(!U.fuzzyHas('tran quynh anh', 'le van hung')); assert.ok(!U.fuzzyHas('abc', 'abcdefgh'));
});

test('B66 (lượt 8): lỗi ném ra ở screen_act cũng tính vào chống lặp — lần 3 cùng phím bị chặn, không bấm', async () => {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b76-')); let model = 0; const exec = [];
  const engine = { status: () => ({ loaded: true, vision: true, contextSize: 8192 }), chatStep: async () => { model++; if (model > 6) return { text: 'Chưa làm được.', toolCalls: [], finishReason: 'stop', usage: {} }; return { text: '', toolCalls: [{ id: String(model), name: 'screen_act', arguments: { action: 'hotkey', keys: 'win+d' } }], finishReason: 'tool_calls', usage: {} }; } };
  const names = ['open_app', 'screen_look', 'screen_act']; const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a) => { exec.push([n, a]); throw new Error('Invalid key flag specified.'); } };
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: true, agentComputer: true, uiLang: 'vi' }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
  const r = await agent.run({ messages: [{ role: 'user', content: 'thu nhỏ hết cửa sổ giúp mình' }], confirm: async () => true });
  assert.ok(exec.length <= 2, `phím hỏng chỉ được bấm tối đa 2 lần, đã bấm ${exec.length}`);
  assert.ok(r && typeof r.text === 'string');
});

test('B76 thật (Electron + Xvfb, trang “Thư mới - Outlook” giả): không gõ nội dung vào chữ đã có ở Tiêu đề, không gõ trùng; thân thư vẫn gõ được', { skip: !fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron')) && 'không có electron', timeout: 300000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b76e-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b76u-'));
  spawnSync('timeout', ['280', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: ROOT, env: { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_B21: dir, AIVN_DESK_AUTO: '1', AIVN_QA_B21_MODE: 'b76' }, stdio: 'ignore' });
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'qab21.json'), 'utf8')); const st = Object.fromEntries(d.steps.map(s => [s.name, s]));
  assert.ok(!d.error, String(d.error)); assert.ok(d.subjId, 'OCR phải thấy chữ trong ô Tiêu đề');
  assert.strictEqual(st['b76-type-subject'].state.subj, 'Lịch họp nhóm');
  assert.ok(st['b76-type-body-into-subject'].blocked, st['b76-type-body-into-subject'].summary); assert.match(st['b76-type-body-into-subject'].forModel, /chèn vào GIỮA/);
  assert.ok(st['b76-type-subject-again'].blocked, st['b76-type-subject-again'].summary);
  assert.deepStrictEqual(d.final, { to: '', subj: 'Lịch họp nhóm', body: 'Nhóm mình họp lúc 8h sáng thứ Năm nhé.' });
});
