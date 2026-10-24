const root = process.argv[2];
const U = require(root + '/src/agent/uitree'), SV = require(root + '/src/agent/send-verify'), SG = require(root + '/src/agent/send-gate');
const long = 'Lan: hôm nay họp lúc mấy giờ vậy anh? '.repeat(8).slice(0, 200);
const el = (r, n, v, x, y) => ({ r, n, a: '', b: [x, y, 120, 24], e: true, p: false, f: false, v, sl: null, d: 3 });
const els = [el('Edit', 'Tìm kiếm', '', 20, 20), el('ListItem', 'Lan', null, 20, 100), el('ListItem', 'Minh', null, 20, 130), el('Document', 'Zalo', long, 400, 60), el('Edit', 'Nhập @, tin nhắn tới Lan', '', 400, 850)];
const q = 'Xem tin nhắn mới nhất của Lan trên Zalo, đừng gửi gì';
for (const partial of [false, true]) {
  const r = { win: { title: 'Zalo', proc: 'Zalo', hwnd: 1, b: [0, 0, 1400, 900] }, els, diag: { cls: 'Chrome_WidgetWin_1' }, truncated: false, timedOut: false, partial };
  const obs = U.normalize(JSON.parse(JSON.stringify(r)), { ocr: [], max: 160 }); if (SV.attachTreeMeta) SV.attachTreeMeta(obs, r);
  const e = obs.elements.find(x => x.name === 'Lan');
  const gf = SV.gateFields({ obs, win: obs.win, elements: obs.elements, target: { el: e, x: 1, y: 1 }, focusedEl: null });
  const st = { chatOpen: false, recipient: SV.recipientOf(q), messaging: SV.allowsSend(q), searchTarget: false, lastTyped: '', targetName: 'Lan', ...gf };
  console.log(`partial=${partial} allowsSend=${SV.allowsSend(q)} lookOnly=${SV.lookOnly(q)} click "Lan" unasked(B219 blocks)=${SG.unasked('click', {}, st)}`);
}
