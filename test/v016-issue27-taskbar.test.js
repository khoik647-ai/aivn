'use strict';
// #27 / B121 (QA beta.3, d1b150d): thanh tác vụ tự ẩn, khung OCR ô soạn nằm trọn trong dải đáy 43 px.
// Màn hình QA: 2560×1440 vật lý @125 % (DIP 2048×1152). Điểm bấm y=1408 bị dời lên y=1401 — vẫn trong dải (>1396).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const T = require('../src/agent/taskbar');
const P = { x: 0, y: 0, width: 2560, height: 1440 };
const OCR = [400, 1398, 1400, 20]; // QA: khung chữ 1398–1418
const LIMIT = 1440 - Math.round(1440 * 0.03) - 1; // 1396, pixel cuối phía trên dải 43 px
const GEO = { scale: 1.25, dip: { x: 0, y: 0, width: 2048, height: 1152 }, phys: { x: 0, y: 0, width: 2560, height: 1440 } };

test('#27: khung OCR nằm trọn trong dải đáy → bấm ngay phía trên dải, không bấm dòng trên của khung, không nhảy theo chiều cao DIP', () => {
  assert.strictEqual(LIMIT, 1396);
  const p = T.place(1100, 1408, P, OCR, { autoHide: true, edge: 'bottom' });
  assert.strictEqual(p.y, 1396, 'beta.3 dừng ở y=1401');
  assert.strictEqual(p.x, 1100, 'không lệch theo trục ngang');
  assert.strictEqual(p.why, 'out-of-strip');
  assert.ok(p.y <= LIMIT, 'không còn nằm trong dải đáy');
  assert.ok(p.y > 1300, 'không trừ cả chiều cao DIP (1152 → khoảng 1116)');
  assert.strictEqual(T.safeY(1408, P, OCR), 1396);
  assert.notStrictEqual(p.y, 1401);
  const dipLimit = 1152 - Math.round(1152 * 0.03) - 1;
  assert.notStrictEqual(p.y, dipLimit);
});

test('#27: khung làm việc trùng màn hình (tự ẩn) không tắt việc dời điểm; lệch DIP và lệch 2 px không bị cộng vào toạ độ', () => {
  const same = T.workToPhys(GEO, GEO.dip);
  assert.deepStrictEqual(same, GEO.phys, 'tự ẩn: khung làm việc vật lý = khung màn hình, gốc không lệch');
  const dipWork = { x: 0, y: 0, width: 2048, height: 1152 };
  assert.strictEqual(T.thickFrom({ edge: 'bottom', sm: { w: 2048, h: 1152 } }, P, dipWork, 1440), 0, 'lệch 288 px là lệch đơn vị, không phải độ dày');
  assert.strictEqual(T.thickFrom({ edge: 'bottom' }, P, { x: 0, y: 0, width: 2560, height: 1438 }, 1440), 0, 'viền 2 px của thanh tác vụ đang ẩn');
  const p = T.place(1100, 1408, P, OCR, { autoHide: true, edge: 'bottom', thick: T.thickFrom({ edge: 'bottom' }, P, dipWork, 1440) });
  assert.strictEqual(p.x, 1100); assert.strictEqual(p.y, 1396);
  assert.notStrictEqual(p.y, 1408 - (1440 - 1152));
  assert.notStrictEqual(p.y, 1408 - 2);
  // thanh tác vụ luôn hiện (khung làm việc đã trừ sẵn): không dời, không trừ thêm
  const reserved = { x: 0, y: 0, width: 2560, height: 1380 };
  assert.strictEqual(T.thickFrom({ edge: 'bottom' }, P, reserved, 1440), 60);
  const shown = T.place(1100, 1408, P, OCR, { autoHide: false, edge: 'bottom', thick: 60 });
  assert.strictEqual(shown.y, 1408); assert.strictEqual(shown.why, 'shown');
});

test('#27: 125 % — độ dày thanh tác vụ đo ở toạ độ logic được nhân về vật lý; thanh của màn hình kia không tính', () => {
  const det = T.parseState('ABM=1;STUCK=3;ERR=;EDGE=3;SM=2048,1152;TRAY=0,1104,2048,1152;TRAY2=;ABMPOS=3,0,1150,2048,1152;WORK=0,0,2048,1152');
  assert.strictEqual(det.autoHide, true); assert.strictEqual(det.edge, 'bottom'); assert.strictEqual(det.via, 'ABM_GETSTATE');
  assert.deepStrictEqual(det.sm, { w: 2048, h: 1152 });
  assert.match(T.describe(det), /cạnh đáy/);
  const work = T.workToPhys(GEO, { x: 0, y: 0, width: 2048, height: 1152 });
  assert.strictEqual(T.thickFrom(det, P, work, 1440), 60, '48 px logic × 1,25 = 60 px vật lý; viền ABM 2 px bị bỏ');
  // dòng OCR mỏng: KHÔNG nhảy lên quá cả thanh 60 px (sẽ trượt khỏi ô). Ẩn thanh trước, bấm ngay trên dải 3 %.
  assert.strictEqual(T.place(1100, 1408, P, OCR, { autoHide: true, edge: 'bottom', thick: 60 }).y, 1396);
  const side = { x: 2560, y: 0, width: 1920, height: 1080 };
  assert.strictEqual(T.thickFrom(det, side, null, 1440), 0, 'thanh màn hình chính không áp vào màn hình bên');
});

test('#27: có khung ô nhập thật (UIA) cao hơn dòng OCR → bấm trong ô, phía trên cả thanh tác vụ đang mở', () => {
  const uia = [380, 1360, 1500, 80];
  const els = [
    { ocr: true, b: OCR, name: 'Nhập @, tin nhắn tới An' },
    { ocr: false, editable: true, b: [380, 1390, 1500, 22] },
    { ocr: false, editable: true, b: uia },
  ];
  assert.deepStrictEqual(T.preferBox(OCR, { ocr: true, b: OCR }, els), uia);
  const p = T.place(1100, 1408, P, uia, { autoHide: true, edge: 'bottom', thick: 60, win: [0, 0, 2560, 1440] });
  assert.strictEqual(p.y, 1377, 'trên dải 60 px và vẫn trong ô 1360–1440');
  assert.ok(p.y >= 1360 && p.y <= 1377); assert.strictEqual(p.why, 'in-box'); assert.strictEqual(p.x, 1100);
  // khung đã nhô lên khỏi dải 3 % (B121 cũ): vẫn bấm trong khung, không xuống đáy
  const ny = T.safeY(1408, P, [400, 1394, 1400, 25]);
  assert.ok(ny <= 1396 && ny >= 1394, String(ny));
});

test('#27: thanh tác vụ ở đỉnh / bên trái — dời đúng trục; điểm đã ở ngoài dải thì giữ nguyên', () => {
  const top = T.place(100, 8, P, [80, 2, 400, 16], { autoHide: true, edge: 'top' });
  assert.strictEqual(top.y, 43); assert.strictEqual(top.x, 100); assert.strictEqual(top.why, 'out-of-strip');
  const left = T.place(4, 700, P, [1, 680, 12, 30], { autoHide: true, edge: 'left' });
  assert.strictEqual(left.x, Math.max(6, Math.round(2560 * 0.03))); assert.strictEqual(left.y, 700);
  const mid = T.place(400, 700, P, null, { autoHide: true, edge: 'bottom' });
  assert.strictEqual(mid.y, 700); assert.strictEqual(mid.why, 'outside');
  assert.strictEqual(T.safeY(1000, { x: 0, y: 1440, width: 1920, height: 1080 }, null), 1000);
});

test('#27: cửa sổ trước là thanh tác vụ thì nhận ra; cửa sổ Explorer có tiêu đề thì không', () => {
  assert.strictEqual(T.isTaskbarFg({ proc: 'explorer', title: '' }), true);
  assert.strictEqual(T.isTaskbarFg({ proc: 'explorer.exe', title: '   ' }), true);
  assert.strictEqual(T.isTaskbarFg({ cls: 'Shell_SecondaryTrayWnd', proc: 'explorer', title: 'Taskbar' }), true);
  assert.strictEqual(T.isTaskbarFg({ proc: 'explorer', title: 'Tài liệu' }), false);
  assert.strictEqual(T.isTaskbarFg({ proc: 'Zalo', title: 'Zalo' }), false);
  assert.strictEqual(T.isTaskbarFg(null), false);
});

test('#27: chuỗi phát hiện giữ ABM_GETSTATE và có thêm cạnh, độ dày, DPI', () => {
  assert.match(T.PS, /SHAppBarMessage\(4, ref d\)/); assert.match(T.PS, /SHAppBarMessage\(5, ref d\)/);
  assert.match(T.PS, /StuckRects3/); assert.match(T.PS, /\$v\[8\]/);
  assert.match(T.PS, /Shell_TrayWnd/); assert.match(T.PS, /SetProcessDpiAwarenessContext/);
  assert.match(T.PS, /SystemParametersInfo\(48/);
  assert.deepStrictEqual(T.parseState('ABM=1;STUCK=3;ERR='), { abm: 1, stuck: 3, autoHide: true, via: 'ABM_GETSTATE', err: '' });
  assert.strictEqual(T.parseState('ABM=0;STUCK=2;ERR=').autoHide, false);
});

test('#27 (mã): trước khi bấm trong dải thì đưa chuột ra giữa cửa sổ; ưu tiên khung ô nhập; mất tiêu điểm thì bấm lại', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/desktop-agent.js'), 'utf8');
  const i = s.indexOf('async function taskbarSafe'); const j = s.indexOf('async function awayFromTaskbar');
  assert.ok(i > 0 && j > i); const body = s.slice(i, j);
  assert.match(body, /TB\.preferBox\(raw/); assert.match(body, /TB\.place\(x, y, b, box/);
  assert.match(s, /TB\.workToPhys\(g, d\.workArea\)/); assert.match(body, /TB\.thickFrom\(d, b, work, primaryPhysH\(\)\)/);
  assert.ok(body.indexOf('await awayFromTaskbar') < body.lastIndexOf('return { x: p.x, y: p.y }'), 'ẩn thanh tác vụ trước khi trả điểm đã dời');
  assert.match(s, /TB\.isTaskbarFg\(fgTb\)/); assert.match(s, /đưa lại cửa sổ đích rồi bấm lại/);
  assert.match(s, /function physBoundsAt\(x, y\)/);
  assert.ok(!/workArea\.height/.test(s), 'không so điểm bấm với chiều cao DIP của khung làm việc');
  assert.ok(!/displayBoundsAt\(x, y\); const ny = TB\.safeY/.test(s));
});
