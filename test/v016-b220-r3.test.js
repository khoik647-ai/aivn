'use strict';
// B220 vòng 3 (review #112, đỏ trên e853768): cờ partial/truncated của cây UIA thật không được biến cửa sổ chính thành bước gửi.
// Chạy cùng kịch bản với test/fixtures/probe-meta.js và probe-91.js.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');
const SG = require('../src/agent/send-gate');
const SV = require('../src/agent/send-verify');

const root = path.join(__dirname, '..');
function probe(name) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'fixtures', name), root], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim().split('\n');
}
const meta = () => probe('probe-meta.js');
const p91 = () => probe('probe-91.js');
function line(rows, prefix) {
  const hit = rows.find(l => l.startsWith(prefix));
  assert.ok(hit, 'thiếu dòng ' + prefix + '\n' + rows.join('\n'));
  return hit;
}

test('B220 r3: Outlook main window with a ≥200-char reading pane (partial) is not a send', () => {
  const hit = line(meta(), 'Outlook main, reading pane');
  assert.match(hit, /hot=false/);
  assert.match(hit, /unread=false/);
  assert.doesNotMatch(hit, /SEND/);
  assert.match(hit, /Enter:ok/);
});
test('B220 r3: Outlook main window truncated at the element cap is not a send', () => {
  const hit = line(meta(), 'Outlook main, list >300');
  assert.match(hit, /hot=false/);
  assert.match(hit, /unread=false/);
  assert.doesNotMatch(hit, /SEND/);
  assert.match(hit, /Enter:ok/);
});
test('B220 r3: Outlook main window with no cut flags is not a send', () => {
  const hit = line(meta(), 'Outlook main, no flags');
  assert.doesNotMatch(hit, /SEND/);
  assert.match(hit, /Enter:ok/);
});
test('B220 r3: new Outlook main window with partial is not a send', () => {
  const hit = line(meta(), 'new Outlook main partial');
  assert.match(hit, /sendApp=outlook-new/);
  assert.match(hit, /hot=false/);
  assert.doesNotMatch(hit, /SEND/);
  assert.match(hit, /Enter:ok/);
});
test('B220 r3: Zalo click on a contact with a ≥200-char history (partial) is not a send', () => {
  const hit = line(meta(), 'Zalo, chat history');
  assert.match(hit, /sendApp=zalo/);
  assert.match(hit, /hot=false/);
  assert.doesNotMatch(hit, /SEND/);
});
test('B220 r3: Zalo click with no cut flags is not a send', () => {
  const hit = line(meta(), 'Zalo, no flags');
  assert.doesNotMatch(hit, /SEND/);
});
test('B220 r3: reply To=Lan with a ≥200-char quoted body passes the recipient gate', () => {
  const hit = line(meta(), 'reply To=Lan click Send (body≥200, partial)');
  assert.match(hit, /send=true/);
  assert.match(hit, /fc=-/);
  assert.match(hit, /recipientOf=Lan\b/);
  assert.match(hit, /gate=null/);
});
test('B220 r3: reply To=Lan with a short body passes the recipient gate', () => {
  const hit = line(meta(), 'reply To=Lan click Send (short body)');
  assert.match(hit, /send=true/);
  assert.match(hit, /fc=-/);
  assert.match(hit, /gate=null/);
});
test('B220 r3: look-only Zalo click on Lan is not blocked when the history is partial', () => {
  const hit = line(p91(), 'partial=true');
  assert.match(hit, /lookOnly=true/);
  assert.match(hit, /allowsSend=false/);
  assert.match(hit, /unasked\(B219 blocks\)=false/);
});
test('B220 r3: look-only Zalo click on Lan is not blocked when the tree has no cut flag', () => {
  const hit = line(p91(), 'partial=false');
  assert.match(hit, /unasked\(B219 blocks\)=false/);
});
test('B220 r3: a real send whose To field cannot be read still fails closed', () => {
  const U = require('../src/agent/uitree');
  const long = 'Chào anh, em gửi lại báo cáo tháng 9 kèm theo đây. '.repeat(6).slice(0, 200);
  const el = (r, n, v, x, y) => ({ r, n, a: '', b: [x, y, 120, 24], e: true, p: false, f: false, v, sl: null, d: 3 });
  const r = {
    win: { title: 'w', pid: 1, proc: 'OUTLOOK', hwnd: 1, b: [0, 0, 1400, 900] },
    els: [el('Button', 'Send', null, 700, 60), el('Edit', 'To', 'Lan', 760, 100), el('Edit', 'Cc', '', 760, 130), el('Edit', 'Subject', 'RE: Báo cáo', 760, 160), el('Document', 'Message', long, 760, 220)],
    diag: { cls: 'rctrl_renwnd32' }, truncated: true, timedOut: false, partial: true,
  };
  const obs = U.normalize(JSON.parse(JSON.stringify(r)), { ocr: [], max: 160 });
  SV.attachTreeMeta(obs, r);
  const to = obs.elements.find(e => e.name === 'To');
  to.valueError = true;
  const gf = SV.gateFields({ obs, win: obs.win, elements: obs.elements, target: { el: obs.elements.find(e => e.name === 'Bold') || { name: 'Discard' } }, focusedEl: null });
  assert.strictEqual(gf.mail && gf.mail.unreadable, true);
  assert.strictEqual(gf.composeUnreadable, true);
  const gm = SV.chatGate({ query: 'Trả lời thư Outlook gửi Lan', text: 'Em nhận được rồi', submit: true, proc: 'OUTLOOK', className: obs.win.cls || '', elements: obs.elements, mail: gf.mail, state: {} });
  assert.match(String(gm || ''), /không đọc được ô To\/Cc\/Bcc/);
});
test('B220 r3: ctrl+right_shift+enter is a send in Outlook', () => {
  const g = SG.classify('hotkey', { keys: 'ctrl+right_shift+enter' }, { sendApp: 'outlook', lastTyped: '', chatOpen: false, messaging: false });
  assert.strictEqual(g.send, true);
});
test('B220 r3: recipientOf gửi Lan và Minh returns both names', () => {
  assert.strictEqual(SV.recipientOf('gửi Lan và Minh'), 'Lan và Minh');
});
