'use strict';
// B220 vòng 4 (review #112, đỏ trên 6e201f2). Cây tự chứa: không cần fixture ngoài.
const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/agent/uitree');
const SV = require('../src/agent/send-verify');
const SG = require('../src/agent/send-gate');

const el = (r, n, v, x, y) => ({ r, n, a: '', b: [x, y, 120, 24], e: true, p: false, f: false, v: v == null ? null : v, sl: null, d: 3 });
function raw(proc, cls, els, flags = {}) {
  return { win: { title: 'w', pid: 1, proc, hwnd: 1, b: [0, 0, 1400, 900] }, els, diag: { cls }, truncated: false, timedOut: false, partial: false, ...flags };
}
function obsOf(r) {
  const o = U.normalize(JSON.parse(JSON.stringify(r)), { ocr: [], max: 400 });
  SV.attachTreeMeta(o, r);
  return o;
}
function gate(obs, target, focusedEl = null) {
  return SV.gateFields({ obs, win: obs.win, elements: obs.elements, target, focusedEl });
}
function step(obs, gf, q, text) {
  return SV.chatGate({ query: q, text, submit: true, proc: obs.win.proc, className: obs.win.cls || '', elements: obs.elements, mail: gf.mail, mailField: gf.mailField, state: {} });
}
const qLan = 'Trả lời thư Outlook gửi Lan: "Em nhận được rồi"';
const chrome = [el('Button', 'New mail', null, 10, 60), el('TreeItem', 'Inbox', null, 10, 120), el('TreeItem', 'Sent Items', null, 10, 150), el('Edit', 'Search', '', 400, 10), el('Button', 'Reply', null, 800, 60), el('Button', 'Archive', null, 900, 60)];

function cutTo(label, value) {
  const cut = value.length >= 200 ? value.slice(0, 200) : value;
  const els = [el('Button', 'Send', null, 700, 60), el('Edit', 'To', cut, 760, 100), el('Edit', 'Cc', '', 760, 130), el('Edit', 'Subject', 'RE', 760, 160), el('Document', 'Message', 'ngắn', 760, 220)];
  const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', els, { partial: value.length >= 200 }));
  const gf = gate(obs, { el: obs.elements.find(e => e.name === 'Send') });
  const gm = step(obs, gf, qLan, 'x');
  assert.strictEqual(gf.mail && gf.mail.unreadable, true, label);
  assert.ok(gm, label + ' must refuse, got allow');
  assert.match(String(gm), /không đọc được ô To\/Cc\/Bcc/);
}

test('B220 r4 M1: To cut inside a long address is unreadable', () => {
  cutTo('addr', 'Lan <lan@' + 'a'.repeat(185) + '.vn>; evil@x.com');
});
test('B220 r4 M1: To padded with 200 spaces then another recipient is unreadable', () => {
  cutTo('spaces', 'Lan' + ' '.repeat(200) + '; evil@x.com');
});
test('B220 r4 M1: a long display name cut before the hidden recipient is unreadable', () => {
  cutTo('title', 'Lan (Phòng Kế toán – Chi nhánh Hà Nội – ' + 'x'.repeat(170) + ') <lan@x.vn>; evil@x.com');
});
test('B220 r4 M1: a To list cut at 200 characters is unreadable', () => {
  cutTo('many', ['Lan <lan@x.vn>', ...Array.from({ length: 20 }, (_, i) => `u${i} <u${i}@x.vn>`)].join('; '));
});
test('B220 r4 M2: truncated tree with To visible still fails the recipient check; the same tree without the flag may send', () => {
  const list = Array.from({ length: 20 }, (_, i) => el('ListItem', `Người ${i}`, null, 300, 120 + i));
  const els = [...chrome, ...list, el('Button', 'Send', null, 700, 600), el('Edit', 'To', 'Lan', 760, 620)];
  const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', els, { truncated: true }));
  const send = obs.elements.find(e => e.name === 'Send');
  const gf = gate(obs, { el: send });
  assert.strictEqual(gf.composeHot, true);
  assert.strictEqual(gf.mail && gf.mail.unreadable, true);
  assert.ok(step(obs, gf, qLan, 'Em nhận được rồi'));
  const obs2 = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', els, {}));
  const gf2 = gate(obs2, { el: obs2.elements.find(e => e.name === 'Send') });
  assert.strictEqual(gf2.mail && gf2.mail.unreadable, false);
  assert.strictEqual(step(obs2, gf2, qLan, 'x'), null);
});
test('B220 r4 M4 holds: a truncated main window click on Inbox is not a send', () => {
  const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', chrome, { truncated: true }));
  const inbox = obs.elements.find(e => e.name === 'Inbox');
  const gf = gate(obs, { el: inbox, x: 1, y: 1, via: 'cây giao diện' });
  assert.strictEqual(gf.composeHot, false);
  assert.strictEqual(gf.composeUnreadable, false);
  assert.strictEqual(SG.classify('click', {}, { targetName: 'Inbox', lastTyped: '', ...gf }).send, false);
  const ge = SG.classify('hotkey', { keys: 'enter' }, { lastTyped: '', ...gf, focusedName: null });
  assert.strictEqual(ge.send, false);
});
test('B220 r4 N1: a Reply/Inbox/Sent link or text in a truncated compose is not the main window', () => {
  const ribbon = Array.from({ length: 8 }, (_, i) => el('Button', `Ribbon ${i}`, null, 10 + i, 30));
  for (const extra of [[], [el('Hyperlink', 'Reply', null, 400, 500)], [el('Hyperlink', 'Inbox', null, 400, 500)], [el('Text', 'Sent', null, 400, 500)]]) {
    const label = extra.map(e => e.n).join(',') || 'no link';
    const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', [el('Button', 'Send', null, 10, 100), ...ribbon, ...extra], { truncated: true }));
    for (const nm of ['Send', 'Kirim', 'Discard']) {
      const gf = gate(obs, { el: { name: nm } });
      const g = SG.classify('click', {}, { targetName: nm, lastTyped: '', ...gf });
      const gm = g.send ? step(obs, gf, qLan, 'x') : null;
      assert.strictEqual(g.send, true, label + ' ' + nm);
      assert.ok(g.failClosed || gm, label + ' ' + nm + ' must refuse or fail closed');
      if (nm === 'Send') assert.ok(gm, label + ' Send must refuse');
    }
  }
});
test('B220 r4 N5: Kirim, Отправить, and Verzenden in a truncated main window are refused', () => {
  const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', chrome, { truncated: true }));
  for (const nm of ['Kirim', 'Отправить', 'Verzenden']) {
    const gf = gate(obs, { el: { name: nm }, via: 'ocr' });
    const g = SG.classify('click', {}, { targetName: nm, lastTyped: '', ...gf });
    const gm = g.send ? step(obs, gf, qLan, 'x') : null;
    assert.strictEqual(g.send, true, nm);
    assert.ok(g.failClosed || gm, nm);
  }
});

function outlookPair(to, cc, bcc) {
  const els = [el('Button', 'Send', null, 700, 60), el('Edit', 'To', to, 760, 100), el('Edit', 'Cc', cc, 760, 130), el('Edit', 'Bcc', bcc, 760, 145), el('Edit', 'Subject', 'Họp', 760, 160), el('Document', 'Message', 'Họp lúc 3h', 760, 220)];
  const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', els));
  const gf = gate(obs, { el: obs.elements.find(e => e.name === 'Send') });
  return step(obs, gf, 'Gửi thư Outlook cho Lan và Minh: "Họp lúc 3h"', 'Họp lúc 3h');
}
test('B220 r4 N2: Lan và Minh matches To=Lan;Minh and To=Lan Cc=Minh only', () => {
  assert.strictEqual(outlookPair('Lan; Minh', '', ''), null);
  assert.strictEqual(outlookPair('Lan', 'Minh', ''), null);
  assert.ok(outlookPair('Lan', '', ''));
  assert.ok(outlookPair('Minh', '', ''));
  assert.ok(outlookPair('Lan; Minh', 'evil@x.com', ''));
  assert.ok(outlookPair('Lan; Minh; evil@x.com', '', ''));
  assert.ok(outlookPair('Lan và Minh', '', ''));
});
test('B220 r4 N2: Zalo still matches the header, not the Outlook recipient set', () => {
  const q = 'nhắn Zalo cho Lan và Minh: "Họp"';
  const one = SV.chatGate({ query: q, text: 'Họp\n', submit: true, proc: 'Zalo', title: 'Zalo', header: ['Lan'], state: {} });
  const both = SV.chatGate({ query: q, text: 'Họp\n', submit: true, proc: 'Zalo', title: 'Zalo', header: ['Lan và Minh'], state: {} });
  assert.ok(one, 'header Lan alone is not the conversation “Lan và Minh”');
  assert.strictEqual(both, null);
});
test('B220 r4 N3: và joins only a following capitalised name', () => {
  assert.strictEqual(SV.recipientOf('gửi Lan và Minh'), 'Lan và Minh');
  assert.strictEqual(SV.recipientOf('gửi thư cho Lan và cc sếp: "Họp"'), 'Lan');
  assert.strictEqual(SV.recipientOf('gửi thư cho Lan và đính kèm báo cáo'), 'Lan');
  assert.strictEqual(SV.recipientOf('gửi Lan và nhắc họp lúc 3h'), 'Lan');
  assert.strictEqual(SV.recipientOf('gửi thư cho Lan và Minh nhưng đừng gửi Hoa'), 'Lan và Minh');
  assert.strictEqual(SV.recipientOf('gửi thư cho Lan và cả Minh: "Họp"'), 'Lan và Minh');
});
test('B220 r4 N4: recipientOf stays under 200 ms at 16K characters', () => {
  const n = 16000;
  const cases = [
    'gửi thư cho Lan ' + 'và Minh '.repeat(n / 8),
    'gửi thư cho Lan và ' + 'a'.repeat(n),
    'gửi thư cho Lan và Minh' + ' '.repeat(n) + 'x',
    'gửi thư cho Lan và ' + 'ab '.repeat(n / 3) + '!',
    'gửi thư cho Lan và ' + "a'".repeat(n / 2) + '!',
  ];
  for (const q of cases) {
    const s = Date.now();
    SV.recipientOf(q);
    const dt = Date.now() - s;
    assert.ok(dt < 200, `len=${q.length} took ${dt}ms`);
  }
});
