'use strict';
// B172: chữ chưa gửi ở AIVN AGENT mất khi sang Ghi nhớ rồi quay lại.
// Trò chuyện và AIVN AGENT dùng chung một ô nhập; đo chiều cao lúc khung chat đang ẩn ghi height:0px.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../src/renderer/drafts.js');

test('B172: Trò chuyện và AIVN AGENT giữ bản nháp và tệp riêng', () => {
  const d = D.createDrafts();
  d.stash('agent', { input: 'việc chưa gửi' }, [{ id: 'a1' }]);
  d.stash('chat', { input: 'tin nhắn' }, []);
  const agent = d.take('agent');
  const chat = d.take('chat');
  assert.strictEqual(agent.apply.input, 'việc chưa gửi');
  assert.deepStrictEqual(agent.files, [{ id: 'a1' }]);
  assert.strictEqual(chat.apply.input, 'tin nhắn');
  assert.deepStrictEqual(chat.files, []);
  agent.files.push({ id: 'x' });
  assert.strictEqual(d.take('agent').files.length, 1);
  d.stash('chat', { input: '   ' });
  assert.strictEqual(d.take('chat').apply.input, '   ');
  assert.deepStrictEqual(d.take('chat').files, []);
});

test('B172: AGENT → Ghi nhớ → AGENT trả lại chữ dù ô nhập đã bị xoá', () => {
  const d = D.createDrafts();
  d.note('agent', 'input', 'bản nháp agent chưa gửi');
  d.stash('agent', { input: 'bản nháp agent chưa gửi' }, [{ id: 'f1', name: 'a.txt' }]);
  d.stash('memory', { memNew: 'điều cần nhớ' });
  assert.strictEqual(d.take('memory').apply.memNew, 'điều cần nhớ');
  assert.strictEqual(d.take('memory').files, null);
  const back = d.take('agent');
  assert.strictEqual(back.apply.input, 'bản nháp agent chưa gửi');
  assert.deepStrictEqual(back.files.map(f => f.id), ['f1']);
  assert.strictEqual(d.take('chat').apply.input, '');
  assert.strictEqual(d.take('chat').files, null);
});

test('B172: cất một phần lịch không xoá ô khác; clear xoá cả chữ lẫn tệp', () => {
  const d = D.createDrafts();
  d.stash('schedule', { sfTitle: 'tiêu đề', sfMsg: 'nhắc', sfPrompt: 'prompt' });
  d.stash('schedule', { sfTitle: 'tiêu đề mới' });
  const s = d.take('schedule');
  assert.strictEqual(s.apply.sfTitle, 'tiêu đề mới');
  assert.strictEqual(s.apply.sfMsg, 'nhắc');
  assert.strictEqual(s.apply.sfPrompt, 'prompt');
  d.stash('schedule', { sfMsg: 'm' }, [{ id: 'nope' }]);
  assert.strictEqual(d.take('schedule').files, null);
  assert.strictEqual(d.take('schedule').apply.sfPrompt, 'prompt');
  d.clear('schedule');
  const c = d.take('schedule');
  assert.strictEqual(c.apply.sfTitle, '');
  assert.strictEqual(c.apply.sfMsg, '');
  assert.strictEqual(c.apply.sfPrompt, '');
  assert.strictEqual(c.files, null);
  assert.strictEqual(d.get('schedule', 'sfTitle'), undefined);
});

test('B172: mảng tệp rỗng là đã cất; không truyền fileList thì giữ nguyên; null không được coi là đã cất', () => {
  const d = D.createDrafts();
  assert.strictEqual(d.take('chat').files, null);
  d.stash('chat', { input: 'x' }, []);
  assert.deepStrictEqual(d.take('chat').files, []);
  d.stash('chat', { input: 'y' }, null);
  assert.deepStrictEqual(d.take('chat').files, []);
  assert.strictEqual(d.take('chat').apply.input, 'y');
  d.stash('chat', { input: 'z' }, undefined);
  assert.strictEqual(d.take('chat').apply.input, 'z');
  assert.deepStrictEqual(d.take('chat').files, []);
});

test('B172: sửa một dòng Ghi nhớ nằm cạnh ô thêm mới', () => {
  const d = D.createDrafts();
  d.note('memory', 'editId', 'm1');
  d.note('memory', 'editText', 'đang sửa');
  d.stash('memory', { memNew: 'mới' });
  assert.strictEqual(d.get('memory', 'editId'), 'm1');
  assert.strictEqual(d.get('memory', 'editText'), 'đang sửa');
  assert.strictEqual(d.take('memory').apply.memNew, 'mới');
  assert.strictEqual(d.take('memory').apply.editId, undefined);
  assert.strictEqual(d.get('memory', 'missing'), undefined);
  d.note('memory', 'memNew', '');
  assert.strictEqual(d.get('memory', 'memNew'), '');
  assert.strictEqual(d.get('memory', 'editId'), 'm1');
});

test('B172: nextHeight không đo ô nhập khi khung chat đang ẩn hoặc scrollHeight bằng 0', () => {
  assert.strictEqual(D.nextHeight(false, 81), null);
  assert.strictEqual(D.nextHeight(true, 0), null);
  assert.strictEqual(D.nextHeight(true, -1), null);
  assert.strictEqual(D.nextHeight(false, 0), null);
  assert.strictEqual(D.nextHeight(true, 400), 180);
  assert.strictEqual(D.nextHeight(true, 40), 40);
  assert.strictEqual(D.nextHeight(true, 200, 100), 100);
});

test('B172: app.js cất/lấy bản nháp theo trang và không đo chiều cao khi ẩn', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const di = html.indexOf('<script src="drafts.js"></script>');
  const ai = html.indexOf('<script src="app.js"></script>');
  assert.ok(di > 0 && di < ai, 'drafts.js phải chạy trước app.js');
  assert.match(app, /function show\(view, opts = \{\}\) \{[\s\S]*?drafts\.stash\(/);
  assert.match(app, /function setMode\(mode\) \{[\s\S]*?drafts\.stash\(/);
  assert.match(app, /drafts\.take\(/);
  assert.match(app, /revealComposer\(view\)/);
  assert.match(app, /show\.cur = 'chat'/);
  const setModeBody = app.slice(app.indexOf('function setMode'), app.indexOf('const convoMode'));
  assert.ok(!/pending = \[\]/.test(setModeBody));
  assert.match(app, /function resizeInput\(\) \{[\s\S]*?nextHeight\([\s\S]*?return;/);
  assert.match(app, /\$\('#input'\)\.placeholder = mode === 'agent' \? 'Giao việc cho AIVN AGENT…' : 'Nhập tin nhắn…';/);
  const i = app.indexOf('async function sendAgent');
  const body = app.slice(i, i + 600);
  assert.ok(body.indexOf('agentGateOk') >= 0 && body.indexOf('agentGateOk') < body.indexOf('pending = []'));
  assert.match(app, /drafts\.clear\('schedule'\)/);
  assert.match(app, /drafts\.note\('memory', 'memNew', ''\)/);
  assert.ok(!/pending = \[\]/.test(app.slice(app.indexOf('function setMode'), app.indexOf('const convoMode'))));
});
