// Realistic raw UIA (uitree.js PowerShell shape) -> normalize -> attachTreeMeta (if present) -> gateFields -> classify / chatGate
const root = process.argv[2];
const U = require(root + '/src/agent/uitree');
const SV = require(root + '/src/agent/send-verify');
const SG = require(root + '/src/agent/send-gate');
const long = 'Chào anh, em gửi lại báo cáo tháng 9 kèm theo đây. '.repeat(6).slice(0, 200);
const el = (r, n, v, x, y, extra = {}) => ({ r, n, a: '', b: [x, y, 120, 24], e: true, p: false, f: false, v: v == null ? null : v, sl: null, d: 3, ...extra });
function raw(proc, cls, els, flags) {
  return { win: { title: 'w', pid: 1, proc, hwnd: 1, b: [0, 0, 1400, 900] }, els, seen: els.length, via: 'control', diag: { via: 'control', cls, named: els.length }, truncated: false, timedOut: false, partial: false, ...flags };
}
const olMain = [el('Button', 'New mail', null, 10, 60), el('TreeItem', 'Inbox', null, 10, 120), el('TreeItem', 'Sent Items', null, 10, 150), el('Edit', 'Search', '', 400, 10),
  el('ListItem', 'Lan, Báo cáo tháng 9, 10:02', null, 300, 120), el('ListItem', 'Minh, Họp, 09:00', null, 300, 150),
  el('Button', 'Reply', null, 800, 60), el('Button', 'Archive', null, 900, 60), el('Document', 'Message', long, 800, 200)];
const olReply = [el('Button', 'Send', null, 700, 60), el('Edit', 'To', 'Lan', 760, 100), el('Edit', 'Cc', '', 760, 130), el('Edit', 'Subject', 'RE: Báo cáo', 760, 160), el('Document', 'Message', long, 760, 220), el('Button', 'Discard', null, 800, 60)];
const zalo = [el('Edit', 'Tìm kiếm', '', 20, 20), el('ListItem', 'Lan', null, 20, 100), el('ListItem', 'Minh', null, 20, 130), el('Text', 'Lan', null, 400, 20), el('Document', 'Zalo', long, 400, 60), el('Edit', 'Nhập @, tin nhắn tới Lan', '', 400, 850)];
const cases = [
  ['Outlook main, reading pane ≥200 chars (partial)', raw('OUTLOOK', 'rctrl_renwnd32', olMain, { partial: true }), ['Inbox', 'New mail', 'Reply', 'Search', 'Archive']],
  ['Outlook main, list >300 (truncated)', raw('OUTLOOK', 'rctrl_renwnd32', olMain.map(e => ({ ...e, v: e.r === 'Document' ? 'ngắn' : e.v })), { truncated: true }), ['Inbox', 'Reply']],
  ['Outlook main, no flags', raw('OUTLOOK', 'rctrl_renwnd32', olMain.map(e => ({ ...e, v: e.r === 'Document' ? 'ngắn' : e.v })), {}), ['Inbox', 'Reply']],
  ['new Outlook main partial', raw('olk', '', olMain, { partial: true }), ['Inbox', 'Search']],
  ['Zalo, chat history ≥200 (partial)', raw('Zalo', 'Chrome_WidgetWin_1', zalo, { partial: true }), ['Lan', 'Minh', 'Tìm kiếm']],
  ['Zalo, no flags', raw('Zalo', 'Chrome_WidgetWin_1', zalo.map(e => ({ ...e, v: e.r === 'Document' ? 'ngắn' : e.v })), {}), ['Lan', 'Tìm kiếm']],
];
for (const [label, r, clicks] of cases) {
  const obs = U.normalize(JSON.parse(JSON.stringify(r)), { ocr: [], max: 160 });
  if (SV.attachTreeMeta) SV.attachTreeMeta(obs, r);
  const out = [];
  for (const name of clicks) {
    const e = obs.elements.find(x => x.name === name);
    const t = { el: e, x: 1, y: 1, via: 'cây giao diện', query: name };
    const gf = SV.gateFields({ obs, win: obs.win, elements: obs.elements, target: t, focusedEl: null });
    const g = SG.classify('click', {}, { chatOpen: false, recipient: null, searchTarget: false, lastTyped: '', targetName: name, ...gf });
    out.push(`${name}:${g.send ? 'SEND/' + (g.failClosed || '-') : 'ok'}`);
  }
  const gf = SV.gateFields({ obs, win: obs.win, elements: obs.elements, target: null, focusedEl: null });
  const ge = SG.classify('hotkey', { keys: 'enter' }, { lastTyped: '', ...gf });
  console.log(label.padEnd(48), `sendApp=${gf.sendApp} hot=${gf.composeHot} unread=${gf.composeUnreadable} |`, out.join(' '), `| Enter:${ge.send ? 'SEND' : 'ok'}`);
}
for (const flags of [{ partial: true }, {}]) {
  const r = raw('OUTLOOK', 'rctrl_renwnd32', flags.partial ? olReply : olReply.map(e => ({ ...e, v: e.r === 'Document' ? 'ngắn' : e.v })), flags);
  const obs = U.normalize(JSON.parse(JSON.stringify(r)), { ocr: [], max: 160 });
  if (SV.attachTreeMeta) SV.attachTreeMeta(obs, r);
  const send = obs.elements.find(x => x.name === 'Send');
  const gf = SV.gateFields({ obs, win: obs.win, elements: obs.elements, target: { el: send, x: 1, y: 1 }, focusedEl: null });
  const g = SG.classify('click', {}, { targetName: 'Send', ...gf });
  const q = 'Trả lời thư Outlook gửi Lan: "Em nhận được rồi"';
  const gm = SV.chatGate({ query: q, text: 'Em nhận được rồi', submit: true, proc: 'OUTLOOK', className: obs.win.cls || '', elements: obs.elements, mail: gf.mail, mailField: gf.mailField, state: {} });
  console.log(`reply To=Lan click Send ${flags.partial ? '(body≥200, partial)' : '(short body)'}`.padEnd(48), `send=${g.send} fc=${g.failClosed || '-'} recipientOf=${SV.recipientOf(q)} gate=${gm ? JSON.stringify(String(gm).slice(0, 70)) : 'null (cho gửi sau thẻ)'}`);
}
