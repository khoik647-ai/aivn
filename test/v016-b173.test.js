'use strict';
// B173: đang stream ở Trò chuyện, sang AIVN AGENT rồi quay lại — chữ phải hiện đủ phần đã có và tiếp tục chạy,
// không ghi vào nút .body đã bị renderMessages() gỡ (chữ chỉ hiện một lần khi lượt kết thúc).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CS = require('../src/renderer/chat-stream');

function msg(html) {
  const body = {
    innerHTML: html, isConnected: true, className: 'body',
    classList: { add(c) { if (!body.className.split(' ').includes(c)) body.className += ' ' + c; } },
    closest(sel) { return sel === '.msg' ? el : null; },
  };
  const el = {
    isConnected: true,
    querySelector(sel) {
      if (sel === '.body') return body;
      if (sel === '.think') return el.think || null;
      if (sel === '.think-body') return el.think ? el.think.body : null;
      return null;
    },
    closest() { return el; },
  };
  return el;
}
function viewOf(n) {
  const nodes = Array.from({ length: n }, () => msg(''));
  return {
    nodes,
    query(i) { const el = nodes[i]; return el && el.isConnected ? el : null; },
    detach() { for (const el of nodes) { el.isConnected = false; el.querySelector('.body').isConnected = false; } },
    text(i) { return nodes[i].querySelector('.body').innerHTML; },
  };
}

test('B173: quay lại Trò chuyện lấy cuộc đang stream (chưa lưu hoặc bản đĩa cũ), không phải cuộc AGENT', () => {
  const live = { id: 'c-live', mode: 'chat', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Xin chào bạn' }] };
  const stale = { id: 'c-live', mode: 'chat', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: '' }] };
  const agent = { id: 'a1', mode: 'agent', messages: [{ role: 'assistant', content: 'đang làm' }] };
  assert.strictEqual(CS.convoForMode({ mode: 'agent', id: 'a1', convos: [stale, agent], generating: live }), agent);
  const back = CS.convoForMode({ mode: 'chat', id: 'c-live', convos: [stale, agent], generating: live });
  assert.strictEqual(back, live);
  assert.strictEqual(back.messages[1].content, 'Xin chào bạn');
  const fresh = { id: 'c-new', mode: 'chat', messages: [{ role: 'assistant', content: 'đang viết' }] };
  assert.strictEqual(CS.convoForMode({ mode: 'chat', id: 'c-new', convos: [agent], generating: fresh }), fresh);
  const other = { id: 'c-other', mode: 'chat', messages: [{ role: 'user', content: 'khác' }] };
  assert.strictEqual(CS.convoForMode({ mode: 'chat', id: 'c-other', convos: [other, stale], generating: live }), other);
  assert.strictEqual(CS.convoForMode({ mode: 'chat', id: 'c-live', convos: [stale], generating: null }), stale);
  assert.strictEqual(CS.convoForMode({ mode: 'chat', id: 'x', convos: [{ id: 'x', messages: [] }], generating: null }).id, 'x');
});

test('B173: token sau khi quay lại ghi vào khung mới; lúc đang ở AGENT không đè tin cùng chỉ số', () => {
  const conv = { id: 'c1', mode: 'chat', messages: [{ role: 'user', content: 'Hỏi' }, { role: 'assistant', content: '' }] };
  const reply = conv.messages[1];
  const agent = { id: 'a1', mode: 'agent', messages: [{ role: 'user', content: 'việc' }, { role: 'assistant', content: 'bước agent' }] };
  let visible = conv, mode = 'chat', view = viewOf(2);
  const paint = () => {
    const body = CS.streamBody({ query: view.query, conv, visible, visibleMode: mode, index: 1 });
    if (!body) return false;
    body.innerHTML = reply.content;
    body.classList.add('cursor');
    return true;
  };
  reply.content = 'Xin';
  assert.strictEqual(paint(), true);
  assert.strictEqual(view.text(1), 'Xin');
  const held = view.nodes[1].querySelector('.body'); // nút app.js cũ giữ suốt lượt — lỗi B173
  view.detach();
  visible = agent; mode = 'agent'; view = viewOf(2);
  view.nodes[1].querySelector('.body').innerHTML = 'bước agent';
  reply.content = 'Xin chào';
  assert.strictEqual(paint(), false, 'đang xem AGENT thì không vẽ');
  assert.strictEqual(view.text(1), 'bước agent');
  held.innerHTML = 'Xin chào'; // ghi vào nút đã gỡ không đổi khung đang hiện
  assert.strictEqual(view.text(1), 'bước agent');
  visible = CS.convoForMode({ mode: 'chat', id: conv.id, convos: [], generating: conv });
  assert.strictEqual(visible, conv);
  mode = 'chat';
  view = viewOf(2);
  view.nodes[1].querySelector('.body').innerHTML = reply.content; // renderMessages vẽ phần đã stream
  assert.strictEqual(view.text(1), 'Xin chào');
  assert.strictEqual(paint(), true);
  assert.match(view.nodes[1].querySelector('.body').className, /\bcursor\b/);
  reply.content += ' bạn';
  assert.strictEqual(paint(), true);
  assert.strictEqual(view.text(1), 'Xin chào bạn');
  assert.strictEqual(held.innerHTML, 'Xin chào');
  assert.strictEqual(held.isConnected, false);
  assert.strictEqual(CS.streamBody({ query: view.query, conv, visible: conv, visibleMode: 'chat', index: -1 }), null);
  assert.strictEqual(CS.streamBody({ query: view.query, conv, visible: conv, visibleMode: 'agent', index: 1 }), null);
});

test('B173: app.js hỏi lại nút đang hiện và chọn cuộc đang stream khi đổi trang', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const i = app.indexOf('async function runTurn');
  const j = app.indexOf('\nconst fmtSec');
  const turn = app.slice(i, j);
  assert.ok(i >= 0 && j > i);
  assert.doesNotMatch(turn, /const bodyEl =/);
  assert.match(turn, /ChatStream\.streamBody/);
  assert.match(turn, /state\.generatingConv = conv/);
  assert.match(turn, /state\.generatingConv = null/);
  assert.match(turn, /state\.streamFlush = null/);
  assert.match(turn, /delete reply\.streaming/);
  assert.match(app, /ChatStream\.convoForMode/);
  assert.match(app, /m\.streaming \? ' cursor'/);
  assert.ok(html.indexOf('<script src="chat-stream.js"></script>') < html.indexOf('<script src="app.js"></script>'));
  assert.strictEqual(CS.modeOf({ mode: 'agent' }), 'agent');
  assert.strictEqual(CS.modeOf({}), 'chat');
});
