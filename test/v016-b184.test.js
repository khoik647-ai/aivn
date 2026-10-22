'use strict';
// B184: việc AGENT trống không hiện Dừng/thanh bước; danh sách có dấu đang chạy;
// dòng “N bước · … giây” không dính việc trước; /moi không bị chặn; gen-chrome.js thẳng lề.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { planGenChrome, composerGate, holdCopy } = require('../src/renderer/gen-chrome');
const CS = require('../src/renderer/chat-stream');
const T = require('../src/i18n/core').create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const chrome = fs.readFileSync(path.join(root, 'src/renderer/gen-chrome.js'), 'utf8');
const FOOT = '1 bước dùng công cụ · 9,3 giây';
const NOTE = 'Đang suy nghĩ…';
const OTHER = 'Việc đang chạy ở danh sách bên trái — mở việc đó rồi bấm Dừng';

test('B184: việc trống, chưa chạy, không có bước — không Dừng, không thanh bước, không dòng thời gian', () => {
  const empty = planGenChrome({ mode: 'agent', genKind: null, genPhase: null, genNote: '', agentFoot: FOOT, hasSteps: false, showFoot: false });
  assert.strictEqual(empty.stopHidden, true);
  assert.strictEqual(empty.sendHidden, false);
  assert.strictEqual(empty.phase, null);
  assert.strictEqual(empty.genStats, '');
  const fresh = planGenChrome({ mode: 'agent', genKind: null, genPhase: 'done', genNote: '', agentFoot: FOOT, viewingRun: false, hasSteps: false, showFoot: false });
  assert.strictEqual(fresh.stopHidden, true);
  assert.strictEqual(fresh.phase, null);
  assert.strictEqual(fresh.genStats, '');
});

test('B184: đang chạy đúng việc thì hiện Dừng và thanh bước; việc khác thì không', () => {
  const live = planGenChrome({ mode: 'agent', genKind: 'agent', genPhase: 'think', genNote: NOTE, agentFoot: FOOT, viewingRun: true, hasSteps: false, showFoot: false });
  assert.strictEqual(live.stopHidden, false);
  assert.strictEqual(live.sendHidden, true);
  assert.strictEqual(live.phase, 'think');
  assert.strictEqual(live.genStats, NOTE);
  const elsewhere = planGenChrome({ mode: 'agent', genKind: 'agent', genPhase: 'act', genNote: NOTE, agentFoot: FOOT, viewingRun: false, hasSteps: false, showFoot: false });
  assert.strictEqual(elsewhere.stopHidden, true, 'việc trống không hiện Dừng dù lượt khác còn chạy');
  assert.strictEqual(elsewhere.sendHidden, false);
  assert.strictEqual(elsewhere.phase, null);
  assert.strictEqual(elsewhere.genStats, '');
  const withSteps = planGenChrome({ mode: 'agent', genKind: null, genPhase: null, genNote: '', agentFoot: FOOT, hasSteps: true, showFoot: true });
  assert.strictEqual(withSteps.stopHidden, true);
  assert.strictEqual(withSteps.phase, 'done');
  assert.strictEqual(withSteps.genStats, FOOT);
});

test('B184: dòng tóm tắt mất khi việc mới, việc không có bước, hoặc đã xoá', () => {
  const started = planGenChrome({ mode: 'agent', genKind: 'agent', genPhase: null, genNote: 'Đang chuẩn bị (công cụ, ghi nhớ)…', agentFoot: '', viewingRun: true, hasSteps: false, showFoot: false });
  assert.strictEqual(started.genStats, 'Đang chuẩn bị (công cụ, ghi nhớ)…');
  assert.ok(!started.genStats.includes('9,3'));
  const other = planGenChrome({ mode: 'agent', genKind: null, genPhase: null, genNote: '', agentFoot: FOOT, hasSteps: false, showFoot: false });
  assert.strictEqual(other.genStats, '');
  const cleared = planGenChrome({ mode: 'agent', genKind: null, genPhase: 'done', genNote: '', agentFoot: FOOT, hasSteps: false, showFoot: false });
  assert.strictEqual(cleared.genStats, '');
  const chat = planGenChrome({ mode: 'chat', genKind: null, genPhase: null, genNote: '', agentFoot: FOOT, hasSteps: true, showFoot: false });
  assert.strictEqual(chat.phase, null);
  assert.strictEqual(chat.genStats, '');
  assert.strictEqual(chat.stopHidden, true);
});

test('B184: dấu đang chạy trên đúng cuộc, hết khi xong / dừng / lỗi', () => {
  const chat = { id: 'c1', mode: 'chat', title: 'xin chào' };
  const task = { id: 'a1', mode: 'agent', title: 'đọc notepad' };
  const running = { chat, agent: task };
  assert.strictEqual(CS.isRunning(chat, running), true);
  assert.strictEqual(CS.isRunning(task, running), true);
  assert.strictEqual(CS.isRunning({ id: 'a2', mode: 'agent' }, running), false);
  assert.strictEqual(CS.isRunning(null, running), false);
  const badge = CS.runBadge(true);
  assert.match(badge, /class="convo-run"/);
  assert.match(badge, /aria-label="Đang chạy"/);
  assert.match(badge, /title="Đang chạy"/);
  assert.strictEqual(CS.runBadge(false), '');
  assert.strictEqual(T.tr('Đang chạy', 'en'), 'Running');
  assert.strictEqual(T.tr('Đang chạy', 'zh'), '运行中');
  const done = { chat: null, agent: null };
  assert.strictEqual(CS.isRunning(chat, done), false);
  assert.strictEqual(CS.isRunning(task, done), false);
  const stopped = { chat: null, agent: null };
  assert.strictEqual(CS.isRunning(task, stopped), false);
  const errored = { chat: null, agent: null };
  assert.strictEqual(CS.isRunning(chat, errored), false);
});

test('B184: /moi không bị chặn khi đang chạy; cùng lối nút việc mới', () => {
  const moi = app.slice(app.indexOf("{ c: '/moi'"), app.indexOf("{ c: '/preset'"));
  assert.match(moi, /\$\('#newChat'\)\.click\(\)/);
  assert.doesNotMatch(moi, /state\.generating/);
  assert.doesNotMatch(moi, /bấm Dừng trước khi mở cuộc trò chuyện mới/);
  const submit = app.slice(app.indexOf("$('#composer').addEventListener('submit'"), app.indexOf('async function runTurn'));
  const iMoi = submit.search(/\\\/moi/);
  const iHold = submit.search(/holdSharedModel\(\)/);
  assert.ok(iMoi >= 0 && iHold > iMoi, '/moi chạy trước cổng đang bận');
  assert.match(submit, /runSlash\(text\); return;/);
  const slash = app.slice(app.indexOf('function paintSlash'), app.indexOf("input.addEventListener('input', () => { slashSel"));
  assert.match(slash, /x\.c === '\/moi'/);
  assert.doesNotMatch(slash, /if \(isAgent\(\) \|\|/);
});

test('B184: đang xem việc khác thì không bảo bấm Dừng ở dưới', () => {
  assert.strictEqual(composerGate({ mode: 'agent', generating: 'r1', genKind: 'agent', cloudAgent: false, viewingRun: false }), 'busy-other');
  assert.strictEqual(composerGate({ mode: 'chat', generating: 'r1', genKind: 'chat', cloudAgent: false, viewingRun: false }), 'busy-other');
  assert.strictEqual(composerGate({ mode: 'agent', generating: 'r1', genKind: 'agent', cloudAgent: false, viewingRun: true }), 'busy-here');
  assert.strictEqual(composerGate({ mode: 'chat', generating: 'r1', genKind: 'agent', cloudAgent: false }), 'wait-agent');
  assert.strictEqual(holdCopy('busy-other', 'agent'), OTHER);
  assert.strictEqual(holdCopy('busy-other', 'chat'), OTHER);
  assert.strictEqual(T.tr(OTHER, 'en'), 'The running task is in the list on the left — open it, then click Stop');
  assert.strictEqual(T.tr(OTHER, 'zh'), '正在运行的任务在左侧列表 — 请打开它，然后点击停止');
  assert.match(app, /viewingRun: state\.generating && state\.genKind === here \? viewingThisRun\(\)/);
  assert.match(app, /state\.agentFoot = ''; state\.agentFootId = conv\.id/);
  assert.match(app, /state\.agentFoot = summary; state\.agentFootId = conv\.id/);
  assert.match(app, /ChatStream\.isRunning\(c, state\.generatingByMode\)/);
  assert.match(app, /ChatStream\.runBadge\(running\)/);
  assert.match(app, /data-running="1"/);
  const neu = app.slice(app.indexOf("$('#newChat').addEventListener('click'"), app.indexOf('// biểu tượng nút thao tác'));
  assert.match(neu, /paintGenChrome\(\)/);
});

test('B184: gen-chrome.js thẳng lề trong composerGate và holdCopy', () => {
  function body(name, until) {
    const start = chrome.indexOf('function ' + name);
    const end = chrome.indexOf(until, start);
    return chrome.slice(start, end).split('\n').slice(1);
  }
  for (const [name, until] of [['composerGate', '\n  // Câu nhắc'], ['holdCopy', '\n  return {']]) {
    for (const line of body(name, until)) {
      if (!line.trim()) continue;
      assert.ok(/^(?:    |\t)/.test(line) || line === '  }', name + ' lệch lề: ' + JSON.stringify(line));
    }
  }
  assert.doesNotMatch(chrome, /\n(?:if |return |function )/ );
});
