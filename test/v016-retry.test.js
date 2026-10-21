'use strict';
// 0.16: làm → chụp lại kiểm tra → chưa được thì ĐỔI CÁCH (không lặp cùng một cách quá 2 lần) → chỉ báo điều đã kiểm chứng.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const RT = require('../src/agent/retry');
const { createAgent } = require('../src/agent/agent');
const { createMemoryStore } = require('../src/agent/memory');
const CT = require('../src/agent/computer-tools');

test('outcome: nhận ra bước chưa có tác dụng từ phần "Kiểm tra" của desktop-agent', () => {
  assert.strictEqual(RT.outcome({ forModel: 'Đã bấm nút “Gửi”.\nKiểm tra: Màn hình không thay đổi rõ ràng — nếu cần, thử cách khác.' }), 'màn hình không thay đổi');
  assert.strictEqual(RT.outcome({ error: 'không thấy phần tử', forModel: 'Không thấy phần tử "Gửi"' }), 'không thấy phần tử');
  assert.strictEqual(RT.outcome({ forModel: 'Đã gõ…', verify: { sent: false } }), 'chưa kiểm chứng được là đã gửi');
  assert.strictEqual(RT.outcome({ forModel: 'Đã bấm. Kiểm tra: Cửa sổ đổi thành "Zalo - Lan".' }), null);
  assert.strictEqual(RT.outcome({ refused: true, forModel: 'Người dùng KHÔNG cho phép' }), null);
});
test('tracker: hỏng lần 1 → gợi ý đổi cách; lần 2 → bắt buộc đổi cách; lần 3 cùng cách → không làm', () => {
  const t = RT.createRetryTracker(); const a = { action: 'click', element: 'e5' }; const bad = { forModel: 'Kiểm tra: Màn hình không thay đổi rõ ràng' };
  assert.strictEqual(t.before(a), null); let r = t.after(a, bad); assert.match(r.hint, /CHƯA có tác dụng/); assert.match(r.hint, /screen_look với query/);
  assert.strictEqual(t.before(a), null); r = t.after(a, bad); assert.match(r.hint, /BẮT BUỘC đổi cách/);
  const blocked = t.before({ action: 'click', element: 'E5 ' }); assert.ok(blocked && /KHÔNG làm lại/.test(blocked.forModel) && /Tab\/mũi tên rồi Enter/.test(blocked.forModel));
  assert.strictEqual(t.before({ action: 'click', element: 'e7' }), null, 'cách khác thì được làm');
  // thành công thì xoá bộ đếm
  const t2 = RT.createRetryTracker(); t2.after(a, bad); t2.after(a, { forModel: 'Cửa sổ đổi thành "Zalo"' }); assert.strictEqual(t2.before(a), null); t2.after(a, bad); assert.strictEqual(t2.before(a), null);
});

function mk(script) {
  const execs = []; let i = 0;
  const engine = { status: () => ({ loaded: true, id: 'qwen3-vl-8b-instruct-q4_k_m', contextSize: 16384, vision: true }), countTokens: (x) => Math.ceil(String(x).length / 3),
    chatStep: async (msgs) => { const s = script[Math.min(i, script.length - 1)]; i++; return typeof s === 'function' ? s(msgs) : s; } };
  const names = ['screen_look', 'screen_act'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError,
    exec: async (n, a) => { execs.push(a); if (n === 'screen_act' && a.element === 'e5') return { forModel: 'Đã bấm nút “Mở”.\nKiểm tra: Màn hình không thay đổi rõ ràng — nếu cần, thử cách khác.', summary: 'bấm nút “Mở”' };
      return { forModel: `Đã ${a.action}.\nKiểm tra: Cửa sổ đổi thành "Tài liệu".`, summary: a.action + ' ok' }; } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v16r-'));
  const logs = [];
  const agent = createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false, agentComputer: true, agentScreen: true }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: (x) => logs.push(x) });
  return { agent, execs, logs };
}
const call = (id, args) => ({ text: '', toolCalls: [{ id, name: 'screen_act', arguments: args }], finishReason: 'tool_calls', usage: {} });
test('mô hình lặp cùng một cú bấm không tác dụng: lần 3 bị chặn, có gợi ý đổi cách; đổi sang phím Enter thì làm tiếp, không cảnh báo giả', async () => {
  let sawBlock = false;
  const { agent, execs } = mk([call('a', { action: 'click', element: 'e5' }), call('b', { action: 'click', element: 'e5' }),
    (msgs) => call('c', { action: 'click', element: 'e5' }),
    (msgs) => { sawBlock = /KHÔNG làm lại/.test(msgs.at(-1).content); return call('d', { action: 'hotkey', keys: 'enter' }); },
    { text: 'Đã mở tài liệu.', toolCalls: [], finishReason: 'stop', usage: {} }]);
  const r = await agent.run({ messages: [{ role: 'user', content: 'mở tài liệu báo cáo trong ứng dụng đang mở' }], confirm: async () => true });
  assert.strictEqual(execs.filter(a => a.element === 'e5').length, 2, 'lần bấm thứ 3 giống hệt không được thực hiện');
  assert.ok(sawBlock, 'mô hình nhận được thông báo phải đổi cách');
  const st = r.steps.filter(s => s.name === 'screen_act');
  assert.strictEqual(st[0].check, 'màn hình không thay đổi'); assert.match(st[0].summary, /chưa có tác dụng/);
  assert.match(st[2].summary, /cần đổi cách/);
  assert.strictEqual(r.warning, null, 'bước cuối đã có tác dụng → không cảnh báo');
});
test('báo "đã xong" khi bước cuối chưa có tác dụng → cảnh báo chưa kiểm chứng', async () => {
  const { agent } = mk([call('a', { action: 'click', element: 'e5' }), { text: 'Đã bấm nút Mở xong rồi nhé.', toolCalls: [], finishReason: 'stop', usage: {} }]);
  const r = await agent.run({ messages: [{ role: 'user', content: 'bấm nút Mở trong cửa sổ đang mở' }], confirm: async () => true });
  assert.match(r.warning || '', /chưa kiểm chứng được bước cuối trên màn hình/);
});
