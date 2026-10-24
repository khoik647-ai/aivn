'use strict';
// B220 vòng 2 (review #112, đỏ trên dcde1c3): soạn/tìm trong Outlook không bị chặn, cửa sổ chính không thành thẻ gửi,
// phím gửi đi qua keys.parse, Enter/Space trên nút Gửi, host outlook.cloud.microsoft, lớp rctrl_renwnd32 còn sau normalize.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SG = require('../src/agent/send-gate');
const SV = require('../src/agent/send-verify');

const root = path.join(__dirname, '..');
const Q = 'Soạn thư Outlook gửi Lan';

function outlookType(extra = {}) {
  return SV.chatGate({
    query: extra.query || Q,
    text: extra.text || '',
    searchField: !!extra.searchField,
    submit: !!extra.submit,
    proc: extra.proc || 'OUTLOOK.EXE',
    title: extra.title || 'Inbox - Lan - Outlook',
    className: extra.className || 'rctrl_renwnd32',
    mail: extra.mail || { to: [], cc: [], bcc: [], unreadable: false },
    mailField: extra.mailField || '',
    state: extra.state || {},
  });
}

function mainWindow() {
  return {
    win: { proc: 'OUTLOOK.EXE', title: 'Inbox - Lan - Outlook', className: 'rctrl_renwnd32' },
    elements: [
      { name: 'Inbox', role: 'TreeItem' },
      { name: 'New mail', role: 'Button' },
      { name: 'Reply', role: 'Button' },
      { name: 'Search', role: 'Edit', editable: true, value: 'bao cao' },
      { name: 'Archive', role: 'Button' },
      { name: 'Notes', role: 'Edit', editable: true, value: 'scratch from another box' },
      { name: 'Message', role: 'Document', editable: true, value: 'Hello from the reading pane. This mail was already received.' },
    ],
  };
}

function clickMain(name) {
  const env = mainWindow();
  const f = SV.gateFields({ ...env, target: { el: { name, role: 'Button' } } });
  const g = SG.classify('click', {}, { targetName: name, lastTyped: '', ...f });
  return { f, g };
}

function focusPress(focusedEl, keys) {
  const env = mainWindow();
  env.elements = [...env.elements, focusedEl];
  const f = SV.gateFields({ ...env, focusedEl });
  const g = SG.classify('hotkey', { keys }, { ...f, lastTyped: '', chatOpen: false, messaging: false, searchTarget: false, inCompose: false });
  return { f, g };
}

// ---------- M1: soạn và tìm không phải bước gửi; tên người nhận không nuốt cả câu ----------
test('B220 r2: recipientOf peels “Outlook gửi Lan” out of a compose sentence', () => {
  assert.strictEqual(SV.recipientOf('Soạn thư Outlook gửi Lan'), 'Lan');
  assert.strictEqual(SV.recipientOf('Soạn thư Outlook gửi Trần Quỳnh Anh'), 'Trần Quỳnh Anh');
  assert.strictEqual(SV.recipientOf('Hãy soạn thư trên Outlook gửi Lan nội dung chào'), 'Lan');
});
test('B220 r2: typing in the Outlook Search box is not blocked', () => {
  assert.strictEqual(outlookType({ text: 'báo cáo', searchField: true, submit: false }), null);
});
test('B220 r2: typing the Subject before To is not blocked', () => {
  assert.strictEqual(outlookType({ text: 'Báo cáo tuần', mailField: 'subject', submit: false }), null);
});
test('B220 r2: typing the body when To is Lan is not blocked', () => {
  assert.strictEqual(outlookType({
    text: 'Chào Lan, tuần này họp nhé',
    submit: false,
    mail: { to: ['Lan'], cc: [], bcc: [], unreadable: false },
  }), null);
});
test('B220 r2: a real send still accepts To=Lan after peeling the Outlook sentence', () => {
  assert.strictEqual(outlookType({
    text: 'Chào Lan',
    submit: true,
    mail: { to: ['Lan'], cc: [], bcc: [], unreadable: false },
  }), null);
});

// ---------- M2: khung đọc / cửa sổ chính không phải ô soạn ----------
for (const name of ['Inbox', 'New mail', 'Reply', 'Search', 'Archive']) {
  test(`B220 r2: clicking ${name} in the main Outlook window is not a send card`, () => {
    const { f, g } = clickMain(name);
    assert.strictEqual(f.composeHot, false, name);
    assert.strictEqual(f.composeUnreadable, false, name);
    assert.strictEqual(g.send, false, name);
  });
}
test('B220 r2: a click in a compose window with To filled is still a send', () => {
  const elements = [
    { name: 'To', value: 'Lan', editable: true },
    { name: 'Cc', value: '', editable: true },
    { name: 'Subject', value: 'Báo cáo', editable: true },
    { name: 'Message', value: 'Nội dung thư', editable: true, role: 'Document' },
    { name: 'Send', role: 'Button' },
  ];
  const f = SV.gateFields({ win: { proc: 'OUTLOOK.EXE' }, elements, target: { el: { name: 'Bold', role: 'Button' } } });
  assert.strictEqual(f.composeHot, true);
  const g = SG.classify('click', {}, { targetName: 'Bold', ...f });
  assert.strictEqual(g.send, true);
  assert.strictEqual(g.failClosed, 'compose');
});

// ---------- phím: keys.parse, Ctrl+Shift+Enter, Enter/Space trên nút Gửi ----------
for (const keys of ['option+s', 'altgr+s', 'ralt+s', 'ctl+enter', 'strg+enter', 'rctrl+enter', 'ctrl+shift+enter']) {
  test(`B220 r2: ${keys} is a send in Outlook with nothing typed this run`, () => {
    const g = SG.classify('hotkey', { keys }, { sendApp: 'outlook', lastTyped: '', chatOpen: false, messaging: false });
    assert.strictEqual(g.send, true, keys);
    assert.strictEqual(SG.unasked('hotkey', { keys }, { sendApp: 'outlook', lastTyped: '' }), true, keys);
  });
}
test('B220 r2: Enter on a focused Send button is a send with nothing typed', () => {
  const { f, g } = focusPress({ name: 'Send', role: 'Button', focused: true }, 'enter');
  assert.strictEqual(f.focusedName, 'Send');
  assert.strictEqual(f.composeUnreadable, false);
  assert.strictEqual(g.send, true);
  assert.ok(!g.failClosed);
});
test('B220 r2: Space on a focused Send button is a send with nothing typed', () => {
  const { g } = focusPress({ name: 'Send', role: 'Button', focused: true }, 'space');
  assert.strictEqual(g.send, true);
  assert.ok(!g.failClosed);
});
test('B220 r2: Enter on a focused Gửi button is a send with nothing typed', () => {
  const { g } = focusPress({ name: 'Gửi', role: 'Button', focused: true }, 'Enter');
  assert.strictEqual(g.send, true);
  assert.ok(!g.failClosed);
});
test('B220 r2: Enter on an unnamed focused button in Outlook is a send with nothing typed', () => {
  const { f, g } = focusPress({ name: '', role: 'Button', focused: true }, 'enter');
  assert.strictEqual(f.focusedName, '');
  assert.strictEqual(g.send, true);
  assert.strictEqual(g.failClosed, 'unnamed');
});
test('B220 r2: Space on an unnamed focused button in Outlook is a send with nothing typed', () => {
  const { g } = focusPress({ name: '', role: 'Button', focused: true }, 'Space');
  assert.strictEqual(g.send, true);
  assert.strictEqual(g.failClosed, 'unnamed');
});
test('B220 r2: Space on a focused Inbox button is not a send', () => {
  const { g } = focusPress({ name: 'Inbox', role: 'TreeItem', focused: true }, 'space');
  assert.strictEqual(g.send, false);
});

// ---------- host + lớp cửa sổ ----------
test('B220 r2: outlook.cloud.microsoft is Outlook on the web', () => {
  assert.strictEqual(SV.sendAppKind({ proc: 'chrome.exe', title: 'Inbox', url: 'https://outlook.cloud.microsoft/mail/0/' }), 'outlook-web');
  assert.strictEqual(SV.sendAppKind({ proc: 'msedge.exe', title: 'New tab', host: 'outlook.cloud.microsoft' }), 'outlook-web');
});
test('B220 r2: classic Outlook class is carried from diag after normalize drops it', () => {
  assert.strictEqual(typeof SV.attachTreeMeta, 'function');
  const raw = { win: { proc: '', title: 'Inbox - Outlook' }, diag: { cls: 'rctrl_renwnd32', fw: 'Win32' } };
  const obs = {
    win: { proc: '', title: 'Inbox - Outlook' },
    elements: mainWindow().elements.map(e => ({ ...e })),
  };
  SV.attachTreeMeta(obs, raw);
  assert.strictEqual(obs.win.cls, 'rctrl_renwnd32');
  assert.strictEqual(obs.diag && obs.diag.cls, 'rctrl_renwnd32');
  const f = SV.gateFields({ obs, target: { el: { name: 'Inbox', role: 'TreeItem' } } });
  assert.strictEqual(f.sendApp, 'outlook');
  assert.strictEqual(f.composeHot, false);
  assert.match(fs.readFileSync(path.join(root, 'src/desktop-agent.js'), 'utf8'), /attachTreeMeta\(/);
});
test('B220 r2: a partial tree flag on the raw UIA result still fail-closes after normalize', () => {
  assert.strictEqual(typeof SV.attachTreeMeta, 'function');
  const raw = { win: { proc: 'OUTLOOK.EXE', title: 'Inbox' }, diag: { cls: 'rctrl_renwnd32' }, partial: true };
  const obs = { win: { proc: 'OUTLOOK.EXE', title: 'Inbox' }, elements: mainWindow().elements.map(e => ({ ...e, value: e.name === 'Message' ? '' : e.value })) };
  SV.attachTreeMeta(obs, raw);
  const f = SV.gateFields({ obs, target: { el: { name: 'Inbox' } } });
  assert.strictEqual(obs.partial, true);
  assert.strictEqual(f.composeUnreadable, true);
  assert.strictEqual(f.composeHot, true);
});
