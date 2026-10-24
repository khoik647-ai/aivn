// #112 r3 probe: truncated/partial relaxation, multi-recipient, right_shift. node probe-r3.js <worktree>
const root = process.argv[2];
const U = require(root + '/src/agent/uitree');
const SV = require(root + '/src/agent/send-verify');
const SG = require(root + '/src/agent/send-gate');
const el = (r, n, v, x, y, extra = {}) => ({ r, n, a: '', b: [x, y, 120, 24], e: true, p: false, f: false, v: v == null ? null : v, sl: null, d: 3, ...extra });
const raw = (proc, cls, els, flags = {}) => ({ win: { title: 'w', pid: 1, proc, hwnd: 1, b: [0, 0, 1400, 900] }, els, seen: els.length, via: 'control', diag: { via: 'control', cls, named: els.length }, truncated: false, timedOut: false, partial: false, ...flags });
function obsOf(r) { const o = U.normalize(JSON.parse(JSON.stringify(r)), { ocr: [], max: 400 }); if (SV.attachTreeMeta) SV.attachTreeMeta(o, r); return o; }
const gfOf = (obs, target, focusedEl = null) => SV.gateFields ? SV.gateFields({ obs, win: obs.win, elements: obs.elements, target, focusedEl }) : {};
const short = (s) => s == null ? 'null' : JSON.stringify(String(s).slice(0, 60));
function sendStep(obs, gf, q, text = '') {
  return SV.chatGate({ query: q, text, submit: true, proc: obs.win.proc, className: obs.win.cls || '', elements: obs.elements, mail: gf.mail, mailField: gf.mailField, state: {} });
}
const chrome = [el('Button', 'New mail', null, 10, 60), el('TreeItem', 'Inbox', null, 10, 120), el('TreeItem', 'Sent Items', null, 10, 150), el('Edit', 'Search', '', 400, 10), el('Button', 'Reply', null, 800, 60), el('Button', 'Archive', null, 900, 60)];
const list = Array.from({ length: 280 }, (_, i) => el('ListItem', `Người ${i}, Thư ${i}, 10:${String(i % 60).padStart(2, '0')}`, null, 300, 120 + i));
const qSend = 'Trả lời thư Outlook gửi Lan: "Em nhận được rồi"';
console.log('== A. main window truncated, inline-reply compose beyond cut (To/Send not in tree)');
{
  const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', [...chrome, ...list], { truncated: true }));
  const acts = [
    ['click OCR "Send"', 'click', {}, { el: { name: 'Send' }, x: 700, y: 60, via: 'ocr' }, 'Send'],
    ['click OCR "Gửi"', 'click', {}, { el: { name: 'Gửi' }, x: 700, y: 60, via: 'ocr' }, 'Gửi'],
    ['click OCR "Kirim"', 'click', {}, { el: { name: 'Kirim' }, x: 700, y: 60, via: 'ocr' }, 'Kirim'],
    ['click OCR "Отправить"', 'click', {}, { el: { name: 'Отправить' }, x: 700, y: 60, via: 'ocr' }, 'Отправить'],
    ['click OCR "Verzenden"', 'click', {}, { el: { name: 'Verzenden' }, x: 700, y: 60, via: 'ocr' }, 'Verzenden'],
    ['click coordinate', 'click', {}, { x: 700, y: 60, via: 'toạ độ' }, ''],
    ['click glyph \uE724', 'click', {}, { el: { name: '\uE724' } }, '\uE724'],
    ['ctrl+enter', 'hotkey', { keys: 'ctrl+enter' }, null, ''],
    ['alt+s', 'hotkey', { keys: 'alt+s' }, null, ''],
    ['enter (focus body)', 'hotkey', { keys: 'enter' }, null, '', { name: 'Message', role: 'Document', editable: true }],
    ['enter (focus Send)', 'hotkey', { keys: 'enter' }, null, '', { name: 'Send' }],
  ];
  for (const [label, action, a, target, name, focusedEl] of acts) {
    const gf = gfOf(obs, target, focusedEl || null);
    const g = SG.classify(action, a, { lastTyped: '', targetName: name, ...gf });
    const gm = g.send && SV.chatGate ? sendStep(obs, gf, qSend, 'Em nhận được rồi') : null;
    console.log(' ', label.padEnd(24), `hot=${gf.composeHot} unread=${gf.composeUnreadable} send=${g.send}${g.failClosed ? '/' + g.failClosed : ''}`, g.send ? `sendStep=${gm ? 'REFUSE ' + short(gm) : 'ALLOW'}` : '(no card, no recipient check)');
  }
}
console.log('== B. main window truncated, inline reply To=Lan visible, Cc/Bcc beyond cut (real Cc=evil@x)');
{
  const els = [...chrome, ...list.slice(0, 270), el('Button', 'Send', null, 700, 600), el('Edit', 'To', 'Lan', 760, 620)];
  const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', els, { truncated: true }));
  const send = obs.elements.find(x => x.name === 'Send');
  const gf = gfOf(obs, { el: send });
  const g = SG.classify('click', {}, { targetName: 'Send', ...gf });
  console.log('  click Send: send=' + g.send, 'mail=' + JSON.stringify(gf.mail), 'sendStep=' + (sendStep(obs, gf, qSend, 'Em nhận được rồi') ? 'REFUSE' : 'ALLOW (Cc/Bcc never seen)'));
  const obs2 = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', els, {}));
  const gf2 = gfOf(obs2, { el: send });
  console.log('  same tree not truncated: sendStep=' + (sendStep(obs2, gf2, qSend, 'x') ? 'REFUSE' : 'ALLOW'));
}
console.log('== C. partial To (value cut at 200 chars)');
{
  const cases = [
    ['To "Lan <lan@" + long addr + "; evil@x" (cut inside addr)', 'Lan <lan@' + 'a'.repeat(185) + '.vn>; evil@x.com'],
    ['To "Lan" + 200 spaces + "; evil"', 'Lan' + ' '.repeat(200) + '; evil@x.com'],
    ['To display name "Lan" + long title, then evil', 'Lan (Phòng Kế toán – Chi nhánh Hà Nội – ' + 'x'.repeat(170) + ') <lan@x.vn>; evil@x.com'],
    ['To many recipients cut (Lan first)', ['Lan <lan@x.vn>', ...Array.from({ length: 20 }, (_, i) => `u${i} <u${i}@x.vn>`)].join('; ')],
  ];
  for (const [label, v] of cases) {
    const cut = v.length >= 200 ? v.slice(0, 200) : v;
    const els = [el('Button', 'Send', null, 700, 60), el('Edit', 'To', cut, 760, 100), el('Edit', 'Cc', '', 760, 130), el('Edit', 'Subject', 'RE: Báo cáo', 760, 160), el('Document', 'Message', 'ngắn', 760, 220)];
    const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', els, { partial: v.length >= 200 }));
    const send = obs.elements.find(x => x.name === 'Send');
    const gf = gfOf(obs, { el: send });
    const gm = sendStep(obs, gf, qSend, 'x');
    console.log(' ', label.padEnd(58), `to=${JSON.stringify((gf.mail && gf.mail.to || []).map(s => s.slice(0, 24)))} unread=${gf.mail && gf.mail.unreadable}`, 'sendStep=' + (gm ? 'REFUSE ' + short(gm) : 'ALLOW'));
  }
}
console.log('== D. popout compose, ribbon fills cap, To/Cc beyond cut; attacker quoted body has a link named "Reply"/"Inbox"');
{
  const ribbon = Array.from({ length: 295 }, (_, i) => el('Button', `Ribbon ${i}`, null, 10 + i, 30));
  for (const extra of [[], [el('Hyperlink', 'Reply', null, 400, 500)], [el('Hyperlink', 'Inbox', null, 400, 500)], [el('Text', 'Sent', null, 400, 500)]]) {
    const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', [el('Button', 'Send', null, 10, 100), ...ribbon, ...extra], { truncated: true }));
    for (const [nm, t] of [['Send', { el: { name: 'Send' } }], ['Kirim', { el: { name: 'Kirim' } }], ['Discard', { el: { name: 'Discard' } }]]) {
      const gf = gfOf(obs, t);
      const g = SG.classify('click', {}, { targetName: nm, ...gf });
      const gm = g.send ? sendStep(obs, gf, qSend, 'x') : null;
      process.stdout.write(`  [${extra.map(e => e.n).join(',') || 'no link'}] ${nm}: hot=${gf.composeHot} send=${g.send}${g.send ? ' step=' + (gm ? 'REFUSE' : 'ALLOW') : ''};`);
    }
    console.log();
  }
}
console.log('== E. multi-recipient');
{
  const qs = ['gửi Lan và Minh', 'Gửi thư Outlook cho Lan và Minh: "Họp lúc 3h"', 'gửi thư cho Lan, Minh: "Họp"', 'gửi thư cho Lan với Minh: "Họp"', 'gửi thư cho Lan và cả Minh: "Họp"',
    'gửi thư cho chị Hoa và anh Minh: "Họp"', 'gửi thư cho Lan và cc sếp: "Họp"', 'gửi thư cho Lan và đính kèm báo cáo', 'gửi Lan và nhắc họp lúc 3h', 'gửi thư cho Lan và Minh nhưng đừng gửi Hoa',
    'nhắn Zalo cho Lan và Minh: "Họp"', 'gửi thư cho Lan và Minh và Hoa: "Họp"', 'gửi thư cho Lan và Minh rồi lưu nháp', 'gửi email cho Lan and Minh: "Hop"', 'gửi thư cho Lan và: "Họp"', 'gửi thư cho Lan và Minh Anh Tuấn Hùng Dũng: "x"'];
  for (const q of qs) console.log(' ', q.padEnd(52), '→', short(SV.recipientOf(q)));
  const mk = (to, cc = '', bcc = '') => [el('Button', 'Send', null, 700, 60), el('Edit', 'To', to, 760, 100), el('Edit', 'Cc', cc, 760, 130), el('Edit', 'Bcc', bcc, 760, 145), el('Edit', 'Subject', 'Họp', 760, 160), el('Document', 'Message', 'Họp lúc 3h', 760, 220)];
  const q = 'Gửi thư Outlook cho Lan và Minh: "Họp lúc 3h"';
  for (const [label, els] of [['To=Lan;Minh', mk('Lan; Minh')], ['To=Lan', mk('Lan')], ['To=Minh', mk('Minh')], ['To=Lan Cc=Minh', mk('Lan', 'Minh')], ['To=Lan;Minh Cc=evil', mk('Lan; Minh', 'evil@x.com')], ['To=Lan;Minh;evil', mk('Lan; Minh; evil@x.com')], ['To="Lan và Minh" (one entry)', mk('Lan và Minh')]]) {
    const obs = obsOf(raw('OUTLOOK', 'rctrl_renwnd32', els));
    const gf = gfOf(obs, { el: obs.elements.find(x => x.name === 'Send') });
    const gm = sendStep(obs, gf, q, 'Họp lúc 3h');
    console.log('  [Lan và Minh]', label.padEnd(30), gm ? 'REFUSE ' + short(gm) : 'ALLOW');
  }
  const qZ = 'nhắn Zalo cho Lan và Minh: "Họp"';
  for (const hdr of ['Lan', 'Minh', 'Lan và Minh', 'Nhóm Lan và Minh']) {
    const st = {};
    const g = SV.chatGate({ query: qZ, text: 'Họp\n', submit: true, proc: 'Zalo', title: 'Zalo', header: [hdr], state: st });
    console.log('  [Zalo Lan và Minh] header', short(hdr).padEnd(20), g ? 'REFUSE ' + short(g) : 'ALLOW');
  }
}
console.log('== F. combos');
{
  const combos = ['ctrl+right_shift+enter', 'right_ctrl+right_shift+enter', 'rctrl+rshift+enter', 'ctrl+rshift+numpad_enter', 'cmd+right_shift+return', 'meta+right_shift+enter', 'right_shift+ctrl+enter',
    'alt+right_shift+s', 'right_alt+shift+s', 'alt+shift+s', 'ctrl+alt+enter', 'ctrl+right_alt+enter',
    'right_shift+enter', 'shift+enter', 'ctrl+right_shift+e', 'ctrl+shift+s', 'ctrl+right_shift+s', 'right_shift+s', 'ctrl+s', 'ctrl+right_shift+tab', 'right_shift+tab', 'ctrl+right_shift+space', 'alt+right_shift', 'right_shift'];
  for (const k of combos) {
    let p = null; try { p = require(root + '/src/agent/keys').parse(k).combo; } catch (e) { p = 'ERR'; }
    const g = SG.classify('hotkey', { keys: k }, { sendApp: 'outlook', lastTyped: '', chatOpen: false, messaging: false });
    console.log(' ', k.padEnd(30), String(p).padEnd(34), 'send=' + g.send + (g.failClosed ? '/' + g.failClosed : ''));
  }
}
