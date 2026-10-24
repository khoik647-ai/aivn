'use strict';
// #27 N1 tiếp (sau ec6954f): thanh đang hiện (veto khung làm việc) thì awayFromTaskbar không đưa chuột
// ra giữa và không chờ, và dòng B121 nói KHÔNG. Tự ẩn thật thì vẫn đưa chuột ra giữa.
// Đỏ trên ec6954f (log vẫn CÓ), xanh trên head.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');
const T = require('../src/agent/taskbar');

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

const ADD_TYPE_FAIL = {
  autoHide: true, via: 'StuckRects3', edge: 'top', abm: -1, stuck: 3, err: 'Add-Type lỗi',
  tray: null, tray2: null, abmPos: null, sm: null, work: null,
};
// Giữa cửa sổ, 40 % chiều cao — chỗ awayFromTaskbar đưa chuột tới rồi chờ 900 ms.
const PARK = { x: 1280, y: 576 };
const TOP_BOX = [400, 0, 400, 80];

function nearPark(m) { return Math.abs(m.x - PARK.x) < 40 && Math.abs(m.y - PARK.y) < 40; }

function installEnv() {
  const clicks = [];
  const moves = [];
  let mpos = { x: 0, y: 0 };
  const prev = {
    detect: T.detect, capture: SC.capture, libnut: SC.libnut, cursorPhys: SC.cursorPhys,
    tree: U.tree, focus: U.focus, windowAt: U.windowAt, setCursor: U.setCursor, windows: U.windows,
  };
  const nut = {
    setMouseDelay() {}, setKeyboardDelay() {},
    moveMouse(x, y) { mpos = { x, y }; moves.push({ x, y, at: Date.now() }); },
    getMousePos: () => ({ ...mpos }),
    mouseToggle(d) { if (d === 'up') clicks.push({ ...mpos, at: Date.now() }); },
    mouseClick() { clicks.push({ ...mpos, at: Date.now() }); },
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
  U.setCursor = async (x, y) => { mpos = { x, y }; moves.push({ x, y, at: Date.now() }); return true; };
  U.windowAt = async () => null;
  U.windows = async () => [{ hwnd: 7, title: 'Zalo', pid: 77, proc: 'Zalo', active: true, min: false, b: [0, 0, 2560, 1440] }];
  return {
    clicks, moves,
    restore() {
      T.detect = prev.detect; T._reset();
      SC.capture = prev.capture; SC.libnut = prev.libnut; SC.cursorPhys = prev.cursorPhys;
      U.tree = prev.tree; U.focus = prev.focus; U.windowAt = prev.windowAt; U.setCursor = prev.setCursor; U.windows = prev.windows;
    },
  };
}

async function clickTop(box) {
  const env = installEnv();
  const logs = [];
  U.tree = async () => ({
    win: { title: 'Zalo', proc: 'Zalo', pid: 77, hwnd: 7, b: [0, 0, 2560, 1440] },
    els: [{ r: 'Edit', n: 'ô soạn', b: box, e: true }],
  });
  const agent = createDesktopAgent({
    isTest: true, getMainWindow: () => null, preload: path.join(__dirname, '../src/preload.js'),
    getSettings: () => ({ agentScreen: true, agentScreenMode: 'important', uiLang: 'vi' }),
    setSettings() {}, log: (...a) => logs.push(a.join(' ')),
    engine: { status: () => ({ loaded: true, id: 'm' }) },
  });
  agent.setBenchAnswer(() => ({ ok: true }));
  const t0 = Date.now();
  try {
    await agent.act({ action: 'click', element: 'e1' }, { userQuery: 'bấm vào ô soạn' });
    try { agent.end(); } catch {}
    return { clicks: env.clicks, moves: env.moves, logs, ms: Date.now() - t0 };
  } finally { env.restore(); }
}

test('veto: thanh đang hiện — không đưa chuột ra giữa, không chờ, B121 nói KHÔNG', { timeout: 20000 }, async () => {
  Object.assign(workArea, { x: 0, y: 48, width: 2560, height: 1392 });
  const { clicks, moves, logs, ms } = await clickTop(TOP_BOX);
  assert.ok(clicks.length >= 1, 'không có cú bấm');
  assert.strictEqual(clicks[0].y, 40, `điểm bấm y=${clicks[0].y} bị dời`);
  const decision = logs.filter(l => /thanh tác vụ tự ẩn:/.test(l));
  assert.ok(decision.some(l => /thanh tác vụ tự ẩn:\s*KHÔNG/.test(l)), 'B121 vẫn báo tự ẩn.\n' + decision.join('\n'));
  assert.ok(!moves.some(nearPark), `đã đưa chuột ra giữa ${JSON.stringify(moves.filter(nearPark))}`);
  const parkWait = moves.some((m, i) => i > 0 && nearPark(moves[i - 1]) && m.at - moves[i - 1].at >= 800);
  assert.strictEqual(parkWait, false, `vẫn chờ sau khi đưa chuột ra giữa (${ms} ms)`);
});

test('tự ẩn thật: vẫn đưa chuột ra giữa cửa sổ trước khi bấm', { timeout: 20000 }, async () => {
  Object.assign(workArea, { x: 0, y: 0, width: 2560, height: 1440 });
  const { moves, logs } = await clickTop(TOP_BOX);
  assert.ok(logs.some(l => /thanh tác vụ tự ẩn:\s*CÓ/.test(l)), logs.filter(l => /B121|tự ẩn/.test(l)).join('\n'));
  assert.ok(moves.some(nearPark), `không đưa chuột ra giữa ${JSON.stringify(moves.map(m => ({ x: m.x, y: m.y })))}`);
});

test.after(() => { Module._load = origLoad; });
