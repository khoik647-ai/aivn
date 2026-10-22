'use strict';
// B175: ảnh kẹt “đang xử lý” sau khi sang AIVN AGENT lúc đang đọc rồi quay lại.
// Kết quả đọc phải ghi theo id vào bản nháp đã cất, không bỏ vì mục không còn trong pending.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../src/renderer/drafts.js');

test('B175: kết quả đọc xong vẫn ghi vào bản nháp sau khi đã cất', () => {
  const d = D.createDrafts();
  const it = { id: 'img1', name: 'anh.png', kind: 'image', loading: true };
  d.stash('chat', { input: 'ảnh đang đọc' }, [it]);
  const live = []; // pending của trang kia, không chứa mục này
  assert.strictEqual(live.includes(it), false);
  assert.strictEqual(d.patchFile('img1', { thumb: 'data:thumb', png: [1] }), 'chat');
  assert.strictEqual(d.patchFile('img1', { loading: false, ok: true, text: 'xin chào', ocrChars: 8, ocrConf: 90 }), 'chat');
  const back = d.take('chat');
  assert.strictEqual(back.apply.input, 'ảnh đang đọc');
  assert.strictEqual(back.files.length, 1);
  assert.strictEqual(back.files[0].loading, false);
  assert.strictEqual(back.files[0].ok, true);
  assert.strictEqual(back.files[0].text, 'xin chào');
  assert.strictEqual(back.files[0].ocrChars, 8);
  d.stash('agent', { input: 'việc' }, [{ id: 'a1', loading: true }]);
  assert.strictEqual(d.patchFile('img1', { text: 'vẫn ở chat' }), 'chat');
  assert.strictEqual(d.take('agent').files[0].loading, true);
  assert.strictEqual(d.patchFile('khong-co', { ok: true }), null);
  assert.strictEqual(d.hasFile('khong-co'), false);
});

test('B175: tệp lỗi bị gỡ khỏi bản nháp, không chỉ khỏi danh sách đang hiện', () => {
  const d = D.createDrafts();
  const bad = { id: 'f1', name: 'hong.pdf', loading: true };
  const ok = { id: 'f2', name: 'ok.txt', ok: true };
  d.stash('chat', { input: 'kèm tệp' }, [bad, ok]);
  const live = [{ id: 'agent-file' }];
  assert.strictEqual(live.includes(bad), false);
  assert.strictEqual(d.removeFile('f1'), 'chat');
  const back = d.take('chat');
  assert.deepStrictEqual(back.files.map(f => f.id), ['f2']);
  assert.strictEqual(back.apply.input, 'kèm tệp');
  assert.strictEqual(d.hasFile('f1'), false);
  assert.strictEqual(d.removeFile('f1'), null);
  assert.strictEqual(d.take('agent').files, null);
});

test('B175: cuộc trò chuyện mới xoá tệp đính kèm của trang đó và giữ chữ', () => {
  const d = D.createDrafts();
  d.stash('chat', { input: 'chưa gửi' }, [{ id: 'img1', name: 'anh.png', loading: true }]);
  d.stash('agent', { input: 'việc chưa gửi' }, [{ id: 'a1', name: 'note.txt' }]);
  assert.strictEqual(d.clearFiles('chat'), true);
  assert.deepStrictEqual(d.take('chat').files, []);
  assert.strictEqual(d.take('chat').apply.input, 'chưa gửi');
  assert.deepStrictEqual(d.take('agent').files.map(f => f.id), ['a1']);
  assert.strictEqual(d.take('agent').apply.input, 'việc chưa gửi');
  assert.strictEqual(d.clearFiles('schedule'), false);
  assert.strictEqual(d.clearFiles('memory'), false);
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const click = app.slice(app.indexOf("$('#newChat').addEventListener('click'"), app.indexOf('const svgI'));
  assert.match(click, /pending = \[\]/);
  assert.match(click, /drafts\.clearFiles\(page\)/);
  assert.match(click, /state\.mode === 'agent' \? 'agent' : 'chat'/);
  const blobs = app.slice(app.indexOf('async function addImageBlobs'), app.indexOf('function renderChips'));
  assert.ok(!blobs.includes('pending.includes'), 'addImageBlobs không được bỏ kết quả vì mục không còn trong pending');
  assert.match(blobs, /settleAttachment\(it\.id, \{ remove: true \}\)/);
  assert.match(blobs, /settleAttachment\(it\.id, \{ patch: \{ loading: false, ok: true/);
  const ex = app.slice(app.indexOf('async function extractInto'), app.indexOf('let asrWaiting'));
  assert.ok(!/a !== it/.test(ex), 'extractInto không được gỡ lỗi chỉ khỏi pending');
  assert.match(ex, /settleAttachment\(it\.id, \{ remove: true \}\)/);
  assert.match(ex, /settleAttachment\(it\.id, \{ patch:/);
  const setMode = app.slice(app.indexOf('function setMode'), app.indexOf('const convoMode'));
  assert.ok(!/pending = \[\]/.test(setMode));
});
