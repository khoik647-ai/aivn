'use strict';
// B178: việc AIVN AGENT mới chưa lưu — AGENT → Trò chuyện → AGENT giữa lượt thì trang chào trống
// (“Chưa giao việc nào”) dù còn nút Dừng và thanh bước; xong lượt cũng không được chọn lại.
// generatingConv chỉ theo dõi Trò chuyện. Mỗi trang phải giữ object đang chạy của chính nó.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CS = require('../src/renderer/chat-stream');
const { planGenChrome } = require('../src/renderer/gen-chrome');

function task(steps) {
  return {
    id: 'a-new', mode: 'agent', title: 'QA B178 việc mới',
    messages: [
      { role: 'user', content: 'đọc báo cáo' },
      { role: 'assistant', content: '', agent: true, steps: steps.slice() },
    ],
  };
}

test('B178: quay lại AGENT giữa lượt lấy việc đang chạy (bước đã có), không phải trang chào trống', () => {
  const live = task([{ id: 's1', label: 'Đọc tệp', status: 'running' }]);
  const chat = { id: 'c1', mode: 'chat', messages: [{ role: 'user', content: 'hi' }] };
  const byMode = { chat: null, agent: live };
  const last = { agent: live.id, chat: chat.id };
  // Lỗi cũ: chỉ có generatingConv của chat (hoặc null) → việc mới không nằm trong danh sách.
  assert.strictEqual(CS.convoForMode({ mode: 'agent', id: last.agent, convos: [chat], generating: null }), null);
  assert.strictEqual(CS.convoForMode({ mode: 'agent', id: last.agent, convos: [chat], generating: chat }), null);
  const back = CS.convoForMode({ mode: 'agent', id: last.agent, convos: [chat], generating: null, generatingByMode: byMode });
  assert.strictEqual(back, live);
  assert.strictEqual(back.messages.length, 2);
  assert.strictEqual(back.messages[1].steps[0].label, 'Đọc tệp');
  back.messages[1].steps[0] = { id: 's1', label: 'Đọc tệp', status: 'ok' };
  back.messages[1].steps.push({ id: 's2', label: 'Ghi tóm tắt', status: 'running' });
  assert.strictEqual(live.messages[1].steps.length, 2, 'bước mới ghi vào đúng object đang chạy');
  assert.strictEqual(CS.generatingFor('agent', null, byMode), live);
  assert.strictEqual(CS.generatingFor('chat', null, byMode), null);
  const chatBack = CS.convoForMode({ mode: 'chat', id: last.chat, convos: [chat], generatingByMode: byMode });
  assert.strictEqual(chatBack, chat);
  const chrome = planGenChrome({ mode: 'agent', genKind: 'agent', genPhase: 'think', genNote: 'Đang suy nghĩ… (bước 2)', agentFoot: '' });
  assert.strictEqual(chrome.stopHidden, false);
  assert.strictEqual(chrome.sendHidden, true);
  assert.strictEqual(chrome.phase, 'think');
  assert.strictEqual(chrome.genStats, 'Đang suy nghĩ… (bước 2)');
  const onChat = planGenChrome({ mode: 'chat', genKind: 'agent', genPhase: 'think', genNote: 'Đang suy nghĩ… (bước 2)', agentFoot: '' });
  assert.strictEqual(onChat.stopHidden, true);
  assert.strictEqual(onChat.phase, null);
});

test('B178: hết lượt thì lưu và chọn lại việc; đang ở Trò chuyện hoặc đã mở việc khác thì không kéo về', () => {
  const live = task([]);
  live.messages[1].content = 'Đã xong.';
  const saved = { id: live.id, mode: 'agent', title: live.title, messages: live.messages.map(m => ({ ...m, steps: (m.steps || []).slice() })) };
  const lost = CS.selectAfterRun({ visibleMode: 'agent', current: null, conv: live, convos: [saved] });
  assert.strictEqual(lost.selected, true);
  assert.strictEqual(lost.current, saved);
  assert.strictEqual(lost.current.messages[1].content, 'Đã xong.');
  const stay = CS.selectAfterRun({ visibleMode: 'agent', current: live, conv: live, convos: [saved] });
  assert.strictEqual(stay.selected, true);
  assert.strictEqual(stay.current, saved);
  const other = { id: 'a-old', mode: 'agent', messages: [{ role: 'user', content: 'việc cũ' }] };
  const keep = CS.selectAfterRun({ visibleMode: 'agent', current: other, conv: live, convos: [saved, other] });
  assert.strictEqual(keep.selected, false);
  assert.strictEqual(keep.current, other);
  const chat = { id: 'c1', mode: 'chat', messages: [] };
  const away = CS.selectAfterRun({ visibleMode: 'chat', current: chat, conv: live, convos: [saved] });
  assert.strictEqual(away.selected, false);
  assert.strictEqual(away.current, chat);
  const fresh = CS.selectAfterRun({ visibleMode: 'agent', current: null, conv: live, convos: [saved], explicitNew: true });
  assert.strictEqual(fresh.selected, false);
  assert.strictEqual(fresh.current, null);
  assert.strictEqual(fresh.saved, saved);
  const mid = CS.listForMode({ mode: 'agent', convos: [], generatingByMode: { chat: null, agent: live } });
  assert.strictEqual(mid.length, 1);
  assert.strictEqual(mid[0], live);
  assert.ok(mid[0].title, 'thanh bên vẫn có việc đang chạy, không phải “Chưa giao việc nào”');
  const both = { chat, agent: live };
  assert.strictEqual(CS.convoForMode({ mode: 'chat', id: 'c1', convos: [], generatingByMode: both }), chat);
  assert.strictEqual(CS.convoForMode({ mode: 'agent', id: 'a-new', convos: [], generatingByMode: both }), live);
  assert.strictEqual(CS.convoForMode({ mode: 'agent', id: 'a-old', convos: [other], generatingByMode: both }), other);
});

test('B178: app.js theo dõi cuộc đang chạy của từng trang và chọn lại việc AGENT khi lưu xong', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const setMode = app.slice(app.indexOf('function setMode(mode)'), app.indexOf('const convoMode'));
  assert.match(setMode, /generatingByMode: state\.generatingByMode/);
  const turn = app.slice(app.indexOf('async function runTurn'), app.indexOf('\nconst fmtSec'));
  assert.match(turn, /state\.generatingByMode\.chat = conv/);
  assert.match(turn, /state\.generatingByMode\.chat = null/);
  assert.match(turn, /state\.generatingConv = conv/);
  const send = app.slice(app.indexOf('async function sendAgent'), app.indexOf('// --- Hộp thoại xác nhận'));
  assert.match(send, /state\.generatingByMode\.agent = conv/);
  assert.match(send, /state\.lastByMode\.agent = conv\.id/);
  assert.match(send, /state\.generatingByMode\.agent = null/);
  assert.match(send, /ChatStream\.selectAfterRun/);
  assert.match(send, /explicitNew: state\.agentExplicitNew/);
  assert.match(send, /renderConvos\(\)/);
  assert.match(send, /state\.lastByMode\.agent = picked\.current\.id/);
  const neu = app.slice(app.indexOf("$('#newChat').addEventListener('click', () => {"), app.indexOf('// biểu tượng nút thao tác'));
  assert.match(neu, /state\.agentExplicitNew = true/);
  assert.match(neu, /delete state\.lastByMode\.agent/);
  assert.match(app, /ChatStream\.listForMode\(/);
  assert.match(app, /ChatStream\.generatingFor\(state\.mode/);
  assert.match(app, /generatingByMode: \{ chat: null, agent: null \}/);
});
