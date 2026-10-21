'use strict';
// 0.16 vòng AIVN AGENT: nhiều thao tác trong MỘT bước (screen_act then) — mỗi thao tác vẫn qua desktop agent (kiểm tra + xin phép riêng), dừng ở thao tác đầu tiên chưa có tác dụng.
const test = require('node:test'); const assert = require('node:assert');
const CT = require('../src/agent/computer-tools');
const mk = (res) => { const acted = []; const tools = CT.createComputerTools({ getSettings: () => ({ agentComputer: true, agentScreen: true }), visionReady: () => false, screen: { act: async (a) => { acted.push(a); return res(a, acted.length); } } }); return { tools, acted }; };

test('then: chạy lần lượt mọi thao tác, gộp tóm tắt; tham số then không lọt vào thao tác đơn', async () => {
  const { tools, acted } = mk((a) => ({ forModel: `Đã ${a.action}.\nKiểm tra: ok`, summary: a.action }));
  const out = await tools.exec('screen_act', { action: 'click', element: 'e4', then: [{ action: 'type_text', text: 'xin chào', submit: true }, { action: 'hotkey', keys: 'ctrl+s' }] }, {});
  assert.deepStrictEqual(acted.map(a => a.action), ['click', 'type_text', 'hotkey']);
  assert.ok(acted.every(a => !('then' in a)));
  assert.strictEqual(out.summary, 'click → type_text → hotkey'); assert.match(out.forModel, /Đã làm lần lượt 3 thao tác/);
});
test('then: dừng ngay ở thao tác chưa có tác dụng / bị từ chối; các bước sau không làm', async () => {
  let r = mk((a, n) => n === 2 ? { error: 'không thấy phần tử', forModel: 'Không thấy phần tử "nút Gửi"' } : { forModel: 'Đã làm.', summary: a.action });
  let out = await r.tools.exec('screen_act', { action: 'click', element: 'Tìm kiếm', then: [{ action: 'click', element: 'nút Gửi' }, { action: 'type_text', text: 'x' }] }, {});
  assert.strictEqual(r.acted.length, 2); assert.match(out.forModel, /Dừng chuỗi thao tác ở bước 2\/3/);
  r = mk((a, n) => n === 1 ? { refused: true, forModel: 'Người dùng KHÔNG cho phép' } : { forModel: 'ok', summary: 'ok' });
  out = await r.tools.exec('screen_act', { action: 'click', element: 'nút Gửi', then: [{ action: 'type_text', text: 'x' }] }, {});
  assert.strictEqual(r.acted.length, 1); assert.ok(out.refused);
  r = mk(() => ({ forModel: 'Đã bấm.\nKiểm tra: Màn hình không thay đổi rõ ràng — nếu cần, thử cách khác.', summary: 'bấm' }));
  await r.tools.exec('screen_act', { action: 'click', element: 'X', then: [{ action: 'type_text', text: 'y' }] }, {});
  assert.strictEqual(r.acted.length, 1);
});
test('then: không cho dùng id [eN] ở thao tác sau (id đổi sau mỗi lần chụp); nhận mảng dạng chuỗi JSON; tối đa 4 thao tác nối', async () => {
  let r = mk(() => ({ forModel: 'ok', summary: 'ok' }));
  await assert.rejects(r.tools.exec('screen_act', { action: 'click', element: 'e2', then: [{ action: 'click', element: 'e7' }] }, {}), /không dùng id \[eN\]/);
  assert.strictEqual(r.acted.length, 0, 'không làm gì khi chuỗi sai');
  await r.tools.exec('screen_act', { action: 'click', element: 'e2', then: JSON.stringify([{ action: 'type_text', text: 'a' }]) }, {});
  assert.strictEqual(r.acted.length, 2);
  r = mk(() => ({ forModel: 'ok', summary: 'ok' }));
  await r.tools.exec('screen_act', { action: 'wait', then: Array.from({ length: 9 }, () => ({ action: 'wait' })) }, {});
  assert.strictEqual(r.acted.length, 5);
  assert.ok(CT.DEFS.screen_act.parameters.properties.then, 'mô tả công cụ có then');
});
