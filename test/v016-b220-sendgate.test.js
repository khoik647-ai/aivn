'use strict';
// B220: cổng gửi fail-closed. Mỗi ca "leak" phải ĐỎ trên f3d5b29 (khẳng định thật) và XANH trên head.
// Ca "regression" phải xanh trên cả hai.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SG = require('../src/agent/send-gate');
const SV = require('../src/agent/send-verify');
const { riskOf } = require('../src/agent/desk-policy');
const QA = require('../src/qa-runner');

const root = path.join(__dirname, '..');
const desk = () => fs.readFileSync(path.join(root, 'src/desktop-agent.js'), 'utf8');
const kindOf = (info) => (typeof SV.sendAppKind === 'function' ? SV.sendAppKind(info) : 'MISSING');
const fieldsOf = (env) => (typeof SV.gateFields === 'function' ? SV.gateFields(env) : {});
const unasked = (action, a, st) => (typeof SG.unasked === 'function' ? SG.unasked(action, a, st) : false);

const NAMED = [
  { name: 'To', value: '', editable: true },
  { name: 'Cc', value: '', editable: true },
  { name: 'Subject', value: '', editable: true },
  { name: 'Message', value: '', editable: true, role: 'Document' },
  { name: 'Send', role: 'Button' },
];
const healthy = (proc, extra = {}) => ({ win: { proc, title: extra.title || 'Untitled', className: extra.className || '', url: extra.url || '', host: extra.host || '' }, elements: extra.elements || NAMED.map(e => ({ ...e })) });

function pressGated(q, keys) {
  const st = { chatOpen: false, recipient: SV.recipientOf(q), messaging: !!SV.msgSend(q), searchTarget: false, lastTyped: '', targetName: ' ', inComposerRow: false };
  if (SG.classify('hotkey', { keys }, st).send) return true;
  return !!riskOf('hotkey', { keys, lastAction: { action: 'screen_look' } });
}

// ---------- leaks: identity (process / class / host, never title) ----------
test('B220 leak: OUTLOOK.EXE is outlook even when the title says Notepad', () => {
  assert.strictEqual(kindOf({ proc: 'OUTLOOK.EXE', title: 'Untitled - Notepad', className: 'rctrl_renwnd32' }), 'outlook');
});
test('B220 leak: olk.exe is new Outlook even with a Notepad title', () => {
  assert.strictEqual(kindOf({ proc: 'olk.exe', title: 'Untitled - Notepad' }), 'outlook-new');
});
test('B220 leak: window class rctrl_renwnd32 is classic Outlook without trusting the title', () => {
  assert.strictEqual(kindOf({ proc: '', className: 'rctrl_renwnd32', title: 'Notepad' }), 'outlook');
});
test('B220 leak: Zalo.exe is zalo even when the title is Notepad', () => {
  assert.strictEqual(kindOf({ proc: 'Zalo.exe', title: 'Untitled - Notepad' }), 'zalo');
});
test('B220 leak: ms-teams.exe is teams even when the title is Notepad', () => {
  assert.strictEqual(kindOf({ proc: 'ms-teams.exe', title: 'Untitled - Notepad' }), 'teams');
});
test('B220 leak: Outlook on the web (outlook.office.com) from the browser host, not the title', () => {
  assert.strictEqual(kindOf({ proc: 'chrome.exe', title: 'Inbox - Google', url: 'https://outlook.office.com/mail/0/' }), 'outlook-web');
});
test('B220 leak: outlook.live.com is Outlook on the web', () => {
  assert.strictEqual(kindOf({ proc: 'msedge.exe', title: 'New tab', url: 'https://outlook.live.com/mail/0/' }), 'outlook-web');
});
test('B220 leak: outlook.office365.com is Outlook on the web', () => {
  assert.strictEqual(kindOf({ proc: 'firefox.exe', title: 'Mozilla Firefox', host: 'outlook.office365.com' }), 'outlook-web');
});
test('B220 leak: address-bar host counts when the window title is unrelated', () => {
  assert.strictEqual(kindOf({
    proc: 'chrome.exe', title: 'Google',
    elements: [{ name: 'Address and search bar', value: 'https://outlook.office.com/mail/', editable: true, autoId: 'omnibox' }],
  }), 'outlook-web');
});
test('B220 leak: a spoofed title does not make Notepad into Outlook', () => {
  assert.strictEqual(kindOf({ proc: 'notepad.exe', title: 'Mail - outlook.office.com - Outlook', className: 'Notepad' }), null);
});
test('B220 leak: a spoofed title does not make Chrome on example.com into Outlook web', () => {
  assert.strictEqual(kindOf({
    proc: 'chrome.exe', title: 'https://outlook.office.com/mail/ - Outlook',
    elements: [{ name: 'Address and search bar', value: 'https://example.com', editable: true }],
  }), null);
});
test('B220 leak: a page that merely mentions the host is not Outlook web', () => {
  assert.strictEqual(kindOf({
    proc: 'chrome.exe', title: 'example',
    elements: [{ name: 'outlook.office.com', value: '' }, { name: 'body', value: 'see outlook.live.com' }, { name: 'h1', value: 'hi' }],
  }), null);
});

// ---------- leaks: clicks and hotkeys inside a messaging/mail context ----------
function assertSend(action, args, st, label) {
  const g = SG.classify(action, args, st);
  assert.strictEqual(g.send, true, label || action);
  return g;
}
test('B220 leak: Outlook unnamed icon-only Send button is a send step', () => {
  const g = assertSend('click', {}, { sendApp: 'outlook', targetName: ' ', lastTyped: 'test', chatOpen: false, inComposerRow: false });
  assert.strictEqual(g.failClosed, 'unnamed');
});
test('B220 leak: Outlook tooltip-only button (empty name) is a send step', () => {
  assertSend('click', {}, { sendApp: 'outlook-new', targetName: '', lastTyped: '' });
});
test('B220 leak: Outlook icon-font glyph is a send step', () => {
  assertSend('click', {}, { sendApp: 'outlook', targetName: '\uE724', lastTyped: 'test' });
});
test('B220 leak: Japanese 送信 is a send step', () => {
  assertSend('click', {}, { targetName: '送信', sendApp: 'outlook' });
});
test('B220 leak: French Envoyer is a send step', () => {
  assertSend('click', {}, { targetName: 'Envoyer', sendApp: 'outlook' });
});
test('B220 leak: Spanish Enviar is a send step', () => {
  assertSend('click', {}, { targetName: 'Enviar', sendApp: 'outlook-web' });
});
test('B220 leak: Outlook click by coordinates is a send step', () => {
  const g = assertSend('click', { x: 330, y: 134 }, { sendApp: 'outlook', coordinate: true, targetName: '', lastTyped: 'test' });
  assert.strictEqual(g.failClosed, 'coordinate');
});
test('B220 leak: click by element id on an unnamed button is a send step', () => {
  assertSend('click', { element: 'e12' }, { sendApp: 'outlook', targetName: ' e12', lastTyped: '' });
});
test('B220 leak: ctrl+numpad_enter is a send step in Outlook with nothing typed this run', () => {
  assertSend('hotkey', { keys: 'ctrl+numpad_enter' }, { sendApp: 'outlook', lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: ctrl+numpad_enter is a send step when the query is a send but the combo was not listed', () => {
  assertSend('hotkey', { keys: 'ctrl+numpad_enter' }, { messaging: true, lastTyped: '', chatOpen: false });
});
test('B220 leak: Alt then S — the Alt step is a send step in Outlook', () => {
  const g = assertSend('hotkey', { keys: 'alt' }, { sendApp: 'outlook', lastTyped: 'test', messaging: true });
  assert.strictEqual(g.failClosed, 'alt');
});
test('B220 leak: Alt then S — S after Alt is a send step across steps', () => {
  const g = assertSend('hotkey', { keys: 's' }, { sendApp: 'outlook-new', altArmed: true, lastTyped: '' });
  assert.strictEqual(g.failClosed, 'alt-s');
});
test('B220 leak: Enter in the Outlook compose box is a send step (classic)', () => {
  assertSend('hotkey', { keys: 'enter' }, { sendApp: 'outlook', inCompose: true, lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: Enter in compose, new Outlook', () => {
  assertSend('hotkey', { keys: 'Enter' }, { sendApp: 'outlook-new', inCompose: true, lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: Enter in compose, Outlook on the web', () => {
  assertSend('hotkey', { keys: 'enter' }, { sendApp: 'outlook-web', inCompose: true, lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: Ctrl+Enter in classic Outlook with nothing typed and chat closed', () => {
  assertSend('hotkey', { keys: 'ctrl+enter' }, { sendApp: 'outlook', lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: Ctrl+Enter in new Outlook with nothing typed', () => {
  assertSend('hotkey', { keys: 'Ctrl + Enter' }, { sendApp: 'outlook-new', lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: Ctrl+Enter in Outlook on the web with nothing typed', () => {
  assertSend('hotkey', { keys: 'ctrl+enter' }, { sendApp: 'outlook-web', lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: Alt+S in classic Outlook with nothing typed and chat closed', () => {
  assertSend('hotkey', { keys: 'alt+s' }, { sendApp: 'outlook', lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: Alt+S in new Outlook with nothing typed', () => {
  assertSend('hotkey', { keys: 'alt+s' }, { sendApp: 'outlook-new', lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: Alt+S in Outlook on the web with nothing typed', () => {
  assertSend('hotkey', { keys: 'Alt + S' }, { sendApp: 'outlook-web', lastTyped: '', chatOpen: false, messaging: false });
});
test('B220 leak: chat unnamed icon when the draft was typed by hand (lastTyped empty)', () => {
  const g = assertSend('click', {}, { sendApp: 'zalo', chatOpen: 'cloud cua toi', lastTyped: '', targetName: ' ', inComposerRow: true });
  assert.strictEqual(g.failClosed, 'unnamed');
});
test('B220 leak: chat coordinate click on the send arrow', () => {
  assertSend('click', { x: 1, y: 1 }, { sendApp: 'zalo', coordinate: true, lastTyped: 'AIVN', targetName: ' ', inComposerRow: false, chatOpen: 'cloud cua toi' });
});
test('B220 leak: chat unnamed icon outside the bottom 20%', () => {
  assertSend('click', {}, { sendApp: 'teams', lastTyped: 'AIVN', targetName: '', inComposerRow: false, chatOpen: 'lan' });
});
test('B220 leak: any click while To/Cc/Bcc or the compose box has content', () => {
  const g = assertSend('click', {}, { sendApp: 'outlook', composeHot: true, targetName: 'Bold' });
  assert.strictEqual(g.failClosed, 'compose');
});
test('B220 leak: unreadable compose is treated as having content', () => {
  const g = assertSend('click', {}, { sendApp: 'outlook', composeUnreadable: true, targetName: 'Save' });
  assert.strictEqual(g.failClosed, 'compose');
});
test('B220 leak: Enter when the compose tree cannot be read is a send step', () => {
  assertSend('hotkey', { keys: 'enter' }, { sendApp: 'outlook-web', composeUnreadable: true, inCompose: false, lastTyped: '', chatOpen: false, messaging: false });
});

// ---------- leaks: gateFields from a real window, not a hand-set flag ----------
test('B220 leak: gateFields marks an unnamed olk.exe button as a send', () => {
  const obs = healthy('olk.exe');
  const f = fieldsOf({ obs, target: { el: { name: '', role: 'Button', autoId: '4256' } } });
  assert.ok(f.sendApp, 'sendApp');
  assertSend('click', {}, { targetName: ' ', ...f });
});
test('B220 leak: gateFields marks a coordinate click in classic Outlook as a send', () => {
  const obs = healthy('OUTLOOK.EXE', { title: 'Untitled - Notepad' });
  const f = fieldsOf({ obs, target: { x: 330, y: 134, via: 'toạ độ' } });
  assert.strictEqual(f.sendApp, 'outlook');
  assert.strictEqual(f.coordinate, true);
  assertSend('click', { x: 330, y: 134 }, { targetName: '', ...f });
});
test('B220 leak: a partial UIA tree is unreadable and arms compose', () => {
  const f = fieldsOf({ obs: { win: { proc: 'OUTLOOK.EXE', title: 'Notepad' }, partial: true, elements: [] }, target: { el: { name: 'Save' } } });
  assert.strictEqual(f.composeUnreadable, true);
  assert.strictEqual(f.composeHot, true);
  assertSend('click', {}, { targetName: 'Save', ...f });
});
test('B220 leak: an abnormally empty tree (fewer than 3 named elements) is unreadable', () => {
  const f = fieldsOf({
    win: { proc: 'olk.exe', title: 'Mail' },
    elements: [{ name: 'Send' }, { name: '' }],
    target: { el: { name: 'File' } },
  });
  assert.strictEqual(f.composeUnreadable, true);
  assertSend('click', {}, { targetName: 'File', ...f });
});
test('B220 leak: To field content makes a named non-send click into a send step', () => {
  const elements = NAMED.map(e => ({ ...e }));
  elements[0] = { ...elements[0], value: 'Lan' };
  const f = fieldsOf({ win: { proc: 'OUTLOOK.EXE' }, elements, target: { el: { name: 'Bold', role: 'Button' } } });
  assert.strictEqual(f.composeHot, true);
  const g = assertSend('click', {}, { targetName: 'Bold', ...f });
  assert.strictEqual(g.failClosed, 'compose');
});
test('B220 leak: Cc content arms compose', () => {
  const elements = NAMED.map(e => ({ ...e, value: e.name === 'Cc' ? 'minh@example.com' : '' }));
  const f = fieldsOf({ win: { proc: 'olk.exe' }, elements, target: { el: { name: 'Bold' } } });
  assert.strictEqual(f.composeHot, true);
});
test('B220 leak: Bcc content arms compose', () => {
  const elements = [...NAMED.map(e => ({ ...e })), { name: 'Bcc', value: 'secret@example.com', editable: true }];
  const f = fieldsOf({ win: { proc: 'chrome.exe', url: 'https://outlook.office.com/mail/' }, elements, target: { el: { name: 'Attach' } } });
  assert.strictEqual(f.sendApp, 'outlook-web');
  assert.strictEqual(f.composeHot, true);
});
test('B220 leak: a UIA value error on To is unreadable', () => {
  const elements = NAMED.map(e => ({ ...e }));
  elements[0] = { ...elements[0], valueError: true };
  const f = fieldsOf({ win: { proc: 'OUTLOOK.EXE' }, elements, target: { el: { name: 'Bold' } } });
  assert.strictEqual(f.composeUnreadable, true);
  assert.strictEqual(f.mail && f.mail.unreadable, true);
});

// ---------- leaks: Outlook chatGate on To/Cc/Bcc ----------
function mailGate(mail, extra = {}) {
  return SV.chatGate({
    query: extra.query || 'Send an Outlook email to Lan saying "hello"',
    text: extra.text || 'hello',
    submit: extra.submit !== false,
    proc: extra.proc || 'OUTLOOK.EXE',
    title: extra.title || 'Untitled - Notepad',
    className: extra.className || '',
    url: extra.url || '',
    host: extra.host || '',
    mail,
    mailField: extra.mailField || '',
    state: extra.state || {},
  });
}
test('B220 leak: Outlook chatGate blocks an empty To/Cc/Bcc', () => {
  assert.match(String(mailGate({ to: [], cc: [], bcc: [] }) || ''), /To\/Cc\/Bcc|trống|người nhận/i);
});
test('B220 leak: Outlook chatGate blocks an unreadable recipient tree', () => {
  assert.match(String(mailGate({ unreadable: true, to: [], cc: [], bcc: [] }) || ''), /không đọc|To\/Cc\/Bcc/i);
});
test('B220 leak: Outlook chatGate blocks an extra Cc recipient', () => {
  assert.match(String(mailGate({ to: ['Lan'], cc: ['Minh'], bcc: [] }) || ''), /To\/Cc\/Bcc|thừa|không khớp|nhiều/i);
});
test('B220 leak: Outlook chatGate blocks a different recipient', () => {
  assert.match(String(mailGate({ to: ['Minh'], cc: [], bcc: [] }) || ''), /không khớp|Minh|To\/Cc\/Bcc/i);
});
test('B220 leak: Outlook chatGate blocks extra Bcc even when To matches', () => {
  assert.match(String(mailGate({ to: ['Lan'], cc: [], bcc: ['other@example.com'] }) || ''), /To\/Cc\/Bcc|thừa|nhiều/i);
});
test('B220 leak: Outlook on the web uses the same recipient gate (spoofed non-outlook title)', () => {
  const g = mailGate({ to: [], cc: [], bcc: [] }, { proc: 'chrome.exe', title: 'Notepad', url: 'https://outlook.live.com/mail/0/' });
  assert.match(String(g || ''), /To\/Cc\/Bcc|trống|người nhận/i);
});
test('B220 leak: new Outlook (olk.exe) uses the recipient gate', () => {
  assert.match(String(mailGate({ to: ['Minh'], cc: [], bcc: [] }, { proc: 'olk.exe', title: 'Word' }) || ''), /không khớp|Minh/i);
});
test('B220 leak: classic Outlook with a Notepad title still gates recipients (title cannot bypass)', () => {
  assert.match(String(mailGate({ to: [], cc: [], bcc: [] }, { proc: 'OUTLOOK.EXE', title: '*Untitled - Notepad' }) || ''), /trống|To\/Cc\/Bcc/i);
});
test('B220 leak: a Notepad window titled Outlook is not identified as Outlook', () => {
  assert.strictEqual(kindOf({ proc: 'notepad.exe', title: 'Mail - Outlook', className: 'Notepad' }), null);
  const g = SV.chatGate({
    query: 'gõ "xin chào" vào Notepad', text: 'xin chào', submit: false,
    proc: 'notepad.exe', title: 'Mail - Outlook', className: 'Notepad',
    mail: { to: [], cc: [], bcc: [], unreadable: true }, state: {},
  });
  assert.strictEqual(g, null);
});

// ---------- leaks: B219 + last-step see the same steps ----------
test('B220 leak: B219 blocks an unnamed Outlook click on a look-only ask', () => {
  assert.strictEqual(unasked('click', {}, { sendApp: 'outlook', targetName: '', lastTyped: '' }), true);
});
test('B220 leak: B219 blocks a coordinate click on a look-only ask', () => {
  assert.strictEqual(unasked('click', { x: 1, y: 1 }, { sendApp: 'outlook', coordinate: true, targetName: 'Save' }), true);
});
test('B220 leak: B219 blocks ctrl+numpad_enter in Outlook when sending was not asked', () => {
  assert.strictEqual(unasked('hotkey', { keys: 'ctrl+numpad_enter' }, { sendApp: 'outlook', lastTyped: '' }), true);
});
test('B220 leak: B219 blocks Alt then S in Outlook when sending was not asked', () => {
  assert.strictEqual(unasked('hotkey', { keys: 'alt' }, { sendApp: 'olk', lastTyped: '' }), true);
  assert.strictEqual(unasked('hotkey', { keys: 's' }, { sendApp: 'outlook', altArmed: true }), true);
});
test('B220 leak: desktop-agent feeds gateFields into classify, B219, and the last-step guard', () => {
  const src = desk();
  assert.match(src, /gateFields\(/);
  assert.match(src, /__sendState/);
  const fn = src.slice(src.indexOf('function blocksUnaskedSend'), src.indexOf('function composeSendContext'));
  assert.match(fn, /unasked\(/);
  const at = src.indexOf('if (a && !a.__sendOk && !a.__notSend)');
  const guard = src.slice(at, src.indexOf('const n = SC.libnut()', at));
  assert.match(guard, /classify\(/);
});

// ---------- leaks: QA denies these cards ----------
test('B220 leak: QA denies an unnamed-click card with no risk flag', () => {
  assert.strictEqual(QA.answerFor({ title: 'AIVN AGENT muốn làm bước này', desc: 'Bấm nút “”', unnamed: true }, { draft: false }).ok, false);
});
test('B220 leak: QA denies a coordinate-click card with no risk flag', () => {
  assert.strictEqual(QA.answerFor({ title: 'AIVN AGENT muốn làm bước này', desc: 'Bấm vị trí (330, 134)', coordinate: true }, { draft: false }).ok, false);
});
test('B220 leak: QA denies a compose-has-content card with no risk flag', () => {
  assert.strictEqual(QA.answerFor({ desc: 'Bấm Bold', composeHot: true }, { draft: false }).ok, false);
});
test('B220 leak: QA denies a send card that forgot the risk sentence', () => {
  assert.strictEqual(QA.answerFor({ desc: 'bấm nút', send: true }, { draft: false }).ok, false);
});
test('B220 leak: QA denies an unreadable-compose card', () => {
  assert.strictEqual(QA.answerFor({ desc: 'Bấm Save', composeUnreadable: true }, { draft: true }).ok, false);
});
test('B220 leak: fail-closed cards are not the Cloud-của-tôi auto-approve path', () => {
  const blocked = typeof QA.autoSendBlocked === 'function' ? QA.autoSendBlocked({ send: true, coordinate: true, recipient: 'Cloud của tôi' }) : false;
  assert.strictEqual(blocked, true);
  assert.match(fs.readFileSync(path.join(root, 'src/qa-runner.js'), 'utf8'), /autoSendBlocked\(req\)/);
});
test('B220 leak: ctrl+numpad_enter after a look is a risky key', () => {
  assert.ok(riskOf('hotkey', { keys: 'ctrl+numpad_enter', lastAction: { action: 'screen_look' } }));
});

// ---------- regressions: must pass on f3d5b29 and on head ----------
test('B220 regression: a named Send button is still a send step', () => {
  for (const nm of ['Send', 'Gửi', '发送', 'Send message', 'nút Gửi']) {
    const g = SG.classify('click', {}, { targetName: nm });
    assert.strictEqual(g.send, true, nm);
    assert.ok(!g.failClosed, nm);
  }
});
test('B220 regression: unnamed icon in the composer row after typing this run stays a normal send', () => {
  const g = SG.classify('click', {}, { chatOpen: true, lastTyped: 'chào', targetName: '', inComposerRow: true });
  assert.strictEqual(g.send, true);
  assert.ok(!g.failClosed);
});
test('B220 regression: Enter with nothing typed and no mail context is not a send', () => {
  assert.strictEqual(SG.classify('hotkey', { keys: 'enter' }, {}).send, false);
});
test('B220 regression: Ctrl+F in a mail window is not a send', () => {
  assert.strictEqual(SG.classify('hotkey', { keys: 'ctrl+f' }, { sendApp: 'outlook', lastTyped: 'hi' }).send, false);
});
test('B220 regression: Notepad clicks do not become send steps (spoofed Outlook title)', () => {
  const f = fieldsOf({
    win: { proc: 'notepad.exe', title: 'Mail - Outlook', className: 'Notepad' },
    elements: [{ name: 'File' }, { name: 'Edit' }, { name: 'Format' }, { name: 'View' }, { name: '', role: 'Button' }],
    target: { el: { name: '' }, x: 10, y: 10 },
  });
  assert.ok(!f.sendApp);
  assert.ok(!f.composeHot);
  assert.strictEqual(SG.classify('click', {}, { targetName: ' ', coordinate: true, ...f }).send, false);
  assert.strictEqual(SG.classify('click', {}, { targetName: 'File' }).send, false);
});
test('B220 regression: Word typing clicks do not become send steps', () => {
  const f = fieldsOf({
    win: { proc: 'WINWORD.EXE', title: 'Outlook draft - Word' },
    elements: [{ name: 'Bold' }, { name: 'Italic' }, { name: 'Document' }, { name: '', role: 'Button' }],
    target: { el: { name: 'Bold' } },
  });
  assert.ok(!f.sendApp);
  assert.strictEqual(SG.classify('click', {}, { targetName: 'Bold', ...f }).send, false);
  assert.strictEqual(SG.classify('type_text', { text: 'xin chào' }, { sendApp: null }).send, false);
});
test('B220 regression: Zalo Cloud của tôi current-chat gate still allows the approved path', () => {
  const st = {};
  assert.strictEqual(SV.chatGate({
    query: 'Trên Zalo, nhắn "test" vào cuộc trò chuyện hiện tại',
    text: 'test', submit: true, proc: 'Zalo', title: 'Zalo',
    header: ['Cloud của tôi'], ocrHeader: ['Cloud của tôi'], seenHeader: 'Cloud của tôi', state: st,
  }), null);
});
test('B220 regression: Outlook To that matches the requested recipient is allowed', () => {
  assert.strictEqual(mailGate({ to: ['Lan'], cc: [], bcc: [] }), null);
});
test('B220 regression: typing the recipient into To is not blocked before the field is filled', () => {
  assert.strictEqual(mailGate({ to: [], cc: [], bcc: [] }, { text: 'Lan', submit: false, mailField: 'to' }), null);
});
test('B220 regression: B219 still blocks Enter, Ctrl+Enter, and Alt+S on a look-only ask', () => {
  for (const q of ['Nhìn ô soạn tin đang có chữ gì? Chỉ nhìn, đừng gửi.', "Look at the message box and tell me if it is empty (don't send).", '看看消息输入框里有什么？只看，不要发送。']) {
    assert.strictEqual(SV.lookOnly(q), true, q);
    assert.strictEqual(SV.allowsSend(q), false, q);
    for (const k of ['enter', 'ctrl+enter', 'alt+s']) assert.ok(pressGated(q, k), `${k} ${q}`);
  }
});
test('B220 regression: a plain Notepad card is still auto-allowed by QA', () => {
  assert.strictEqual(QA.answerFor({ title: 'AIVN AGENT muốn làm bước này', desc: 'Bấm File' }, { draft: false }).ok, true);
});
test('B220 regression: Enter in the Outlook message list (not compose, tree readable, empty) is not a send', () => {
  assert.strictEqual(SG.classify('hotkey', { keys: 'enter' }, { sendApp: 'outlook', inCompose: false, composeHot: false, composeUnreadable: false, lastTyped: '', chatOpen: false, messaging: false, searchTarget: false }).send, false);
});
test('B220 regression: named Send stays approvable (not fail-closed) even when compose has content', () => {
  const g = SG.classify('click', {}, { targetName: 'Send', sendApp: 'outlook', composeHot: true });
  assert.strictEqual(g.send, true);
  assert.ok(!g.failClosed);
});
