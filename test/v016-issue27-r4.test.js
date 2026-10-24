'use strict';
// #27 N1–N3 (follow-up sau 821a9b7). Đỏ trên 821a9b7, xanh trên head.
// N1: Add-Type lỗi → WORK/SM rỗng, via StuckRects3. Khung làm việc Electron bị trừ đúng cạnh thì không dời điểm; không bị trừ thì vẫn dời.
// N2: byte 0x7A/0x7B (122/123) — bit thấp là tự ẩn, không chỉ đúng số 3.
// N3: không biết cạnh thì appbar khác không được bác.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');
const T = require('../src/agent/taskbar');

test('N2: StuckRects3 0x7B là tự ẩn, 0x7A thì không (bit thấp, không chỉ đúng số 3)', () => {
  const on = T.parseState('ABM=-1;STUCK=123;ERR=Add-Type lỗi'); // 0x7B
  assert.strictEqual(on.autoHide, true, '0x7B phải là tự ẩn');
  assert.strictEqual(on.via, 'StuckRects3');
  const off = T.parseState('ABM=-1;STUCK=122;ERR=Add-Type lỗi'); // 0x7A, bit thấp tắt
  assert.strictEqual(off.autoHide, false, '0x7A không có bit tự ẩn');
  assert.strictEqual(T.parseState('ABM=-1;STUCK=3;ERR=').autoHide, true);
  assert.strictEqual(T.parseState('ABM=-1;STUCK=2;ERR=').autoHide, false);
});

test('N3: không biết cạnh — appbar khác làm lệch khung làm việc không được bác tự ẩn', () => {
  // WORK lệch trái 60 px, không có EDGE. 821a9b7 quét mọi cạnh và bác.
  const d = T.parseState('ABM=-1;STUCK=3;ERR=;SM=1920,1080;WORK=60,0,1920,1080');
  assert.strictEqual(d.edge, null);
  assert.strictEqual(d.autoHide, true, `bị bác (via ${d.via}) dù không biết cạnh thanh`);
  assert.strictEqual(d.via, 'StuckRects3');
  const known = T.parseState('ABM=-1;STUCK=3;ERR=;EDGE=1;SM=1920,1080;WORK=0,60,1920,1080');
  assert.strictEqual(known.edge, 'top');
  assert.strictEqual(known.autoHide, false, 'cạnh đã biết và đúng cạnh bị trừ thì vẫn bác');
});

// --- N1 qua desktop-agent: detect giả Add-Type lỗi, khung làm việc lấy từ Electron ---
const BOUNDS = { x: 0, y: 0, width: 2560, height: 1440 };
const workArea = { x: 0, y: 0, width: 2560, height: 1440 };
const displays = [{
  id: 1, bounds: { ...BOUNDS }, size: { width: 2560, height: 1440 }, scaleFactor: 1, workArea,
}];
const img = {
  getSize: () => ({ width: 32, height: 32 }), resize: () => img, crop: () => img,
  toPNG: () => Buffer.from('png'), toBitmap: () => Buffer.alloc(32 * 32 * 4, 255), toJPEG: () => Buffer.from('jpg'), isEmpty: () => false,
};
const electron = {
  app: { isPackaged: false, getPath: () => require('os').tmpdir() },
  desktopCapturer: {}, systemPreferences: {},
  clipboard: { readText: async () => '', writeText: async () => {}, availableFormats: () => [], readImage: () => img, writeImage: async () => {} },
  screen: {
    on() {}, getPrimaryDisplay: () => displays[0], getAllDisplays: () => displays,
    getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => displays[0],
  },
  globalShortcut: { isRegistered: () => false, register: () => true, unregister() {} },
  ipcMain: { on() {}, handle() {}, removeHandler() {} },
  nativeImage: { createFromDataURL: () => img, createFromBitmap: () => img },
  BrowserWindow: class {
    constructor() { this.webContents = { once(ev, fn) { if (ev === 'did-finish-load') setImmediate(fn); }, send() {} }; }
    setAlwaysOnTop() {} setIgnoreMouseEvents() {} setContentProtection() {} setVisibleOnAllWorkspaces() {}
    loadFile() {} on() {} isDestroyed() { return false; } isVisible() { return false; } showInactive() {} hide() {} setFocusable() {}
  },
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return electron;
  return origLoad.call(this, req, parent, isMain);
};
const SC = require('../src/screen-control');
const U = require('../src/agent/uitree');
const { createDesktopAgent } = require('../src/desktop-agent');

// Add-Type thất bại: ABM không đọc được, StuckRects3=3, không có WORK/SM/cạnh đo được từ PowerShell.
const ADD_TYPE_FAIL = {
  autoHide: true, via: 'StuckRects3', edge: 'top', abm: -1, stuck: 3, err: 'Add-Type lỗi',
  tray: null, tray2: null, abmPos: null, sm: null, work: null,
};

function installEnv() {
  const clicks = [];
  let mpos = { x: 0, y: 0 };
  const prev = {
    detect: T.detect, capture: SC.capture, libnut: SC.libnut, cursorPhys: SC.cursorPhys,
    tree: U.tree, focus: U.focus, windowAt: U.windowAt, setCursor: U.setCursor, windows: U.windows,
  };
  const nut = {
    setMouseDelay() {}, setKeyboardDelay() {},
    moveMouse(x, y) { mpos = { x, y }; },
    getMousePos: () => ({ ...mpos }),
    mouseToggle(d) { if (d === 'up') clicks.push({ ...mpos }); },
    mouseClick() { clicks.push({ ...mpos }); },
    scrollMouse() {}, keyTap() {}, keyToggle() {},
    getScreenSize: () => ({ width: 2560, height: 1440 }),
  };
  SC.libnut = () => nut;
  SC.cursorPhys = () => ({ ...mpos });
  SC.capture = async () => ({
    dataUrl: 'data:image/jpeg;base64,AA==', width: 2560, height: 1440,
    full: { width: 2560, height: 1440 },
    geo: { id: 1, scale: 1, primary: true, dip: { ...BOUNDS }, phys: { ...BOUNDS } },
  });
  T.detect = async () => ADD_TYPE_FAIL;
  T._reset();
  U.focus = async () => true;
  U.setCursor = async (x, y) => { mpos = { x, y }; return true; };
  U.windowAt = async () => null;
  U.windows = async () => [{ hwnd: 7, title: 'Zalo', pid: 77, proc: 'Zalo', active: true, min: false, b: [0, 0, 2560, 1440] }];
  return {
    clicks,
    restore() {
      T.detect = prev.detect; T._reset();
      SC.capture = prev.capture; SC.libnut = prev.libnut; SC.cursorPhys = prev.cursorPhys;
      U.tree = prev.tree; U.focus = prev.focus; U.windowAt = prev.windowAt; U.setCursor = prev.setCursor; U.windows = prev.windows;
    },
  };
}

async function clickTop(box) {
  const env = installEnv();
  U.tree = async () => ({
    win: { title: 'Zalo', proc: 'Zalo', pid: 77, hwnd: 7, b: [0, 0, 2560, 1440] },
    els: [{ r: 'Edit', n: 'ô soạn', b: box, e: true }],
  });
  const agent = createDesktopAgent({
    isTest: true, getMainWindow: () => null, preload: path.join(__dirname, '../src/preload.js'),
    getSettings: () => ({ agentScreen: true, agentScreenMode: 'important', uiLang: 'vi' }),
    setSettings() {}, log() {},
    engine: { status: () => ({ loaded: true, id: 'm' }) },
  });
  agent.setBenchAnswer(() => ({ ok: true }));
  try {
    await agent.act({ action: 'click', element: 'e1' }, { userQuery: 'bấm vào ô soạn' });
    try { agent.end(); } catch {}
    return env.clicks;
  } finally { env.restore(); }
}

// Tâm khung (600, 40) nằm trong dải đỉnh; khung còn nhô ra ngoài dải nên tự ẩn sẽ kéo điểm lên.
const TOP_BOX = [400, 0, 400, 80];

test('N1: Add-Type lỗi, StuckRects3 tự ẩn, khung làm việc Electron bị trừ cạnh đỉnh — không dời điểm', { timeout: 20000 }, async () => {
  Object.assign(workArea, { x: 0, y: 48, width: 2560, height: 1392 });
  const clicks = await clickTop(TOP_BOX);
  assert.ok(clicks.length >= 1, 'không có cú bấm');
  assert.strictEqual(clicks[0].x, 600);
  assert.strictEqual(clicks[0].y, 40, `y=${clicks[0].y} bị dời dù thanh đang hiện (khung làm việc bắt đầu ở y=48)`);
});

test('N1: Add-Type lỗi, StuckRects3 tự ẩn, khung làm việc Electron không bị trừ — vẫn dời điểm', { timeout: 20000 }, async () => {
  Object.assign(workArea, { x: 0, y: 0, width: 2560, height: 1440 });
  const clicks = await clickTop(TOP_BOX);
  assert.ok(clicks.length >= 1, 'không có cú bấm');
  assert.strictEqual(clicks[0].x, 600);
  assert.notStrictEqual(clicks[0].y, 40, 'fallback StuckRects3 phải đưa điểm ra khỏi dải đỉnh');
});

test('N3: không biết cạnh, appbar khác ở Electron — không bác, điểm đáy vẫn được dời', { timeout: 20000 }, async () => {
  Object.assign(workArea, { x: 60, y: 0, width: 2500, height: 1440 });
  const prevEdge = ADD_TYPE_FAIL.edge;
  ADD_TYPE_FAIL.edge = null;
  try {
    const clicks = await clickTop([400, 1360, 400, 80]);
    assert.ok(clicks.length >= 1, 'không có cú bấm');
    assert.notStrictEqual(clicks[0].y, 1400, `y=${clicks[0].y} không bị dời — appbar trái đã bác nhầm khi không biết cạnh`);
  } finally { ADD_TYPE_FAIL.edge = prevEdge; }
});

test.after(() => { Module._load = origLoad; });
