'use strict';
// #27 vòng 3 (máy thật, head 1d92b19): ABM_GETSTATE=0 là thanh KHÔNG tự ẩn.
// StuckRects3=3 chỉ là byte registry chưa được Explorer áp — không được kéo điểm bấm.
// Đỏ trên 1d92b19 (autoHide: a || st, (600,15) → (600,62)), xanh trên head.
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/agent/taskbar');

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 };
// Khung chạm cả dải mép lẫn phía trong, nên khi bị coi là tự ẩn thì place() kéo điểm ra khỏi dải
// (đỉnh: y=15 → 62 với độ dày 60). Thanh đang hiện thì điểm phải giữ nguyên.
const TOP_BOX = [400, 0, 400, 80];
const BOTTOM_BOX = [400, 1000, 400, 80];

function placeAt(raw, x, y, box) {
  const d = T.parseState(raw);
  const p = T.place(x, y, SCREEN, box, { autoHide: d.autoHide, edge: d.edge, thick: 60 });
  return { d, p };
}

test('ABM_GETSTATE=0 và StuckRects3=3, cạnh đỉnh: không tự ẩn, điểm (600,15) giữ nguyên', () => {
  const { d, p } = placeAt('ABM=0;STUCK=3;ERR=;EDGE=1;SM=1920,1080;WORK=0,48,1920,1080', 600, 15, TOP_BOX);
  assert.strictEqual(p.x, 600);
  assert.strictEqual(p.y, 15, `y=${p.y} bị dời (1d92b19 kéo lên 62 vì tin StuckRects3)`);
  assert.strictEqual(p.moved, false);
  assert.strictEqual(d.autoHide, false);
  assert.strictEqual(d.via, 'ABM_GETSTATE');
  assert.match(T.describe(d), /KHÔNG \(theo ABM_GETSTATE/);
});

test('ABM_GETSTATE=0 và StuckRects3=3, cạnh đáy: không tự ẩn, điểm bấm giữ nguyên', () => {
  const { d, p } = placeAt('ABM=0;STUCK=3;ERR=;EDGE=3;SM=1920,1080;WORK=0,0,1920,1032', 600, 1065, BOTTOM_BOX);
  assert.strictEqual(p.x, 600);
  assert.strictEqual(p.y, 1065, `y=${p.y} bị dời dù ABM_GETSTATE=0`);
  assert.strictEqual(p.moved, false);
  assert.strictEqual(d.autoHide, false);
  assert.strictEqual(d.via, 'ABM_GETSTATE');
});

test('ABM_GETSTATE không đọc được, StuckRects3=3, khung làm việc bị trừ độ dày: không tự ẩn', () => {
  const d = T.parseState('ABM=-1;STUCK=3;ERR=không gọi được;EDGE=1;SM=1920,1080;WORK=0,60,1920,1080');
  const p = T.place(600, 15, SCREEN, TOP_BOX, { autoHide: d.autoHide, edge: d.edge, thick: 60 });
  assert.strictEqual(p.y, 15, `y=${p.y} bị dời dù khung làm việc bắt đầu ở y=60`);
  assert.strictEqual(p.moved, false);
  assert.strictEqual(d.autoHide, false, 'khung làm việc bắt đầu ở y=60 — thanh đỉnh đang hiện');
  assert.strictEqual(d.via, 'khung làm việc');
  assert.match(T.describe(d), /KHÔNG \(theo khung làm việc/);
});

test('ABM_GETSTATE không đọc được, StuckRects3=3, khung làm việc không bị trừ: vẫn tự ẩn', () => {
  const d = T.parseState('ABM=-1;STUCK=3;ERR=Add-Type lỗi;EDGE=1;SM=1920,1080;WORK=0,0,1920,1080');
  assert.strictEqual(d.autoHide, true);
  assert.strictEqual(d.via, 'StuckRects3');
  const p = T.place(600, 15, SCREEN, TOP_BOX, { autoHide: d.autoHide, edge: d.edge, thick: 60 });
  assert.notStrictEqual(p.y, 15, 'fallback tự ẩn vẫn phải đưa điểm ra khỏi dải đỉnh');
});

test('ABM_GETSTATE=1: tự ẩn, kể cả khi byte StuckRects3 nói khác', () => {
  const on = T.parseState('ABM=1;STUCK=2;ERR=');
  assert.strictEqual(on.autoHide, true);
  assert.strictEqual(on.via, 'ABM_GETSTATE');
  const shownWork = T.parseState('ABM=1;STUCK=3;ERR=;EDGE=1;SM=1920,1080;WORK=0,60,1920,1080');
  assert.strictEqual(shownWork.autoHide, true, 'ABM đọc được thì khung làm việc không phủ quyết');
  assert.strictEqual(shownWork.via, 'ABM_GETSTATE');
});
