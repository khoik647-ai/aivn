'use strict';
// #27 vòng 2 (review e5cb135, CHƯA ĐẠT): M1 cú bấm phải nằm trong khung; M2 fgWin giữ proc/class;
// N2 bấm lại không lặp tác dụng khi cú bấm đã tới cửa sổ đích.
// Đỏ trên e5cb135, xanh trên head. Không sửa N1/N3/N4/N5.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');
const T = require('../src/agent/taskbar');

const PRIMARY = { x: 0, y: 0, width: 2560, height: 1440 };
const SECONDARY = { x: 2560, y: 0, width: 1920, height: 1080 };
// Khung nằm trọn trong dải đáy 3 % của màn 1440 (dải từ y=1397). e5cb135 đẩy y ra 1396, ngoài khung.
const BOX = [600, 1425, 300, 14];
const CLICK_Y = 1428;

test('M1: khung nằm trọn trong dải đáy của màn có thanh tác vụ — điểm bấm vẫn nằm trong khung', () => {
  const p = T.place(750, CLICK_Y, PRIMARY, BOX, { autoHide: true, edge: 'bottom', owns: true });
  assert.ok(p.y >= BOX[1] && p.y < BOX[1] + BOX[3], `y=${p.y} ngoài khung [${BOX[1]}, ${BOX[1] + BOX[3]})`);
  assert.ok(p.x >= BOX[0] && p.x < BOX[0] + BOX[2], `x=${p.x} ngoài khung`);
  assert.strictEqual(p.y, CLICK_Y);
  assert.notStrictEqual(p.y, 1396);
});

test('M1: màn phụ không có thanh tác vụ — điểm bấm giữ nguyên', () => {
  const box = [3000, 1060, 200, 14];
  const det = {
    autoHide: true, edge: 'bottom', abm: 1, stuck: 3,
    tray: { l: 0, t: 1400, r: 2560, b: 1440 }, tray2: null,
    sm: { w: 2560, h: 1440 },
  };
  const p = T.place(3100, 1067, SECONDARY, box, { autoHide: true, edge: 'bottom', det, primaryH: 1440 });
  assert.strictEqual(p.x, 3100);
  assert.strictEqual(p.y, 1067);
  assert.strictEqual(p.moved, false);
});

// --- Hành vi qua desktop-agent (fgWin thật + cú bấm thật trên libnut giả) ---
const displays = [
  { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, size: { width: 2560, height: 1440 }, scaleFactor: 1, workArea: { x: 0, y: 0, width: 2560, height: 1440 } },
  { id: 2, bounds: { x: 2560, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1, workArea: { x: 2560, y: 0, width: 1920, height: 1080 } },
];
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

const DET = {
  autoHide: true, edge: 'bottom', via: 'test', abm: 1, stuck: 3,
  tray: { l: 0, t: 1400, r: 2560, b: 1440 }, tray2: null, abmPos: null,
  sm: { w: 2560, h: 1440 },
};
// Cửa sổ trước đúng dạng U.windows() của thanh tác vụ: Shell_TrayWnd / explorer / tiêu đề rỗng.
const TASKBAR_WIN = {
  hwnd: 99, title: '', pid: 4, proc: 'explorer', class: 'Shell_TrayWnd',
  active: true, min: false, b: [0, 1392, 2560, 48],
};

function installEnv() {
  const clicks = [];
  let mpos = { x: 0, y: 0 };
  const prev = {
    detect: T.detect, capture: SC.capture, libnut: SC.libnut, cursorPhys: SC.cursorPhys,
    windows: U.windows, tree: U.tree, focus: U.focus, windowAt: U.windowAt, setCursor: U.setCursor,
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
    geo: { id: 1, scale: 1, primary: true, dip: { ...PRIMARY }, phys: { ...PRIMARY } },
  });
  T.detect = async () => DET;
  T._reset();
  const focusCalls = [];
  U.focus = async (w) => { focusCalls.push(w); return true; };
  U.setCursor = async (x, y) => { mpos = { x, y }; return true; };
  U.windowAt = async () => null;
  return {
    clicks, focusCalls,
    restore() {
      T.detect = prev.detect; T._reset();
      SC.capture = prev.capture; SC.libnut = prev.libnut; SC.cursorPhys = prev.cursorPhys;
      U.windows = prev.windows; U.tree = prev.tree; U.focus = prev.focus; U.windowAt = prev.windowAt; U.setCursor = prev.setCursor;
    },
  };
}

function treeFor(box, bounds) {
  return {
    win: { title: 'Zalo', proc: 'Zalo', pid: 77, hwnd: 7, b: [bounds.x, bounds.y, bounds.width, bounds.height] },
    els: [{ r: 'Edit', n: 'ô soạn', b: box, e: true }],
  };
}

async function clickBox(box, bounds, { windows, fgWin, windowAt } = {}) {
  const env = installEnv();
  const logs = [];
  U.tree = async () => treeFor(box, bounds);
  U.windows = async () => (windows ? windows() : [{ hwnd: 7, title: 'Zalo', pid: 77, proc: 'Zalo', active: true, min: false, b: [bounds.x, bounds.y, bounds.width, bounds.height] }]);
  const deps = {
    isTest: true, getMainWindow: () => null, preload: path.join(__dirname, '../src/preload.js'),
    getSettings: () => ({ agentScreen: true, agentScreenMode: 'important', uiLang: 'vi' }),
    setSettings() {}, log: (...a) => logs.push(a.join(' ')),
    engine: { status: () => ({ loaded: true, id: 'm' }) },
  };
  if (fgWin) deps.fgWin = fgWin;
  if (windowAt) deps.windowAt = windowAt;
  const agent = createDesktopAgent(deps);
  agent.setBenchAnswer(() => ({ ok: true }));
  try {
    const r = await agent.act({ action: 'click', element: 'e1' }, { userQuery: 'bấm vào ô soạn' });
    try { agent.end(); } catch {}
    return { clicks: env.clicks, logs, focusCalls: env.focusCalls, result: r };
  } finally { env.restore(); }
}

test('M1: bấm khung nằm trọn trong dải của màn chính — toạ độ chuột nằm trong khung', { timeout: 20000 }, async () => {
  const { clicks, result } = await clickBox(BOX, PRIMARY);
  assert.ok(!result || !result.thrown, result && (result.error || result.forModel || result.thrown));
  assert.ok(clicks.length >= 1, 'không có cú bấm');
  const c = clicks[0];
  assert.ok(c.y >= BOX[1] && c.y < BOX[1] + BOX[3], `click y=${c.y} ngoài khung (e5cb135 ra 1396)`);
  assert.ok(c.x >= BOX[0] && c.x < BOX[0] + BOX[2], `click x=${c.x} ngoài khung`);
});

test('M1: bấm trên màn phụ không có thanh tác vụ — chuột không bị dời', { timeout: 20000 }, async () => {
  const box = [3000, 1060, 200, 14];
  const { clicks } = await clickBox(box, SECONDARY);
  assert.ok(clicks.length >= 1, 'không có cú bấm');
  assert.strictEqual(clicks[0].x, 3100);
  assert.strictEqual(clicks[0].y, 1067);
});

test('M2: fgWin Shell_TrayWnd/explorer tiêu đề rỗng kích hoạt bấm lại', { timeout: 20000 }, async () => {
  const { logs, focusCalls } = await clickBox(BOX, PRIMARY, {
    windows: () => [TASKBAR_WIN],
  });
  const hit = logs.some(l => /rồi bấm lại/.test(l));
  assert.ok(hit, 'không vào nhánh bấm lại.\n' + logs.filter(l => /B121|tiêu điểm|fgWin|thanh tác vụ/.test(l)).join('\n'));
  assert.ok(focusCalls.some(w => w && w.hwnd === 7), 'không đưa lại cửa sổ đích');
});

test('N2: cú bấm đã tới cửa sổ đích thì bấm lại không lặp tác dụng', { timeout: 20000 }, async () => {
  const { clicks, logs } = await clickBox(BOX, PRIMARY, {
    fgWin: async () => ({ ...TASKBAR_WIN }),
    windowAt: async () => ({ hwnd: 7, pid: 77, title: 'Zalo' }),
  });
  assert.strictEqual(clicks.length, 1, `bấm ${clicks.length} lần ${JSON.stringify(clicks)} — tác dụng bị lặp`);
  assert.ok(logs.some(l => /không bấm lại/.test(l)), 'không ghi nhận cú bấm đã tới nơi');
});

test.after(() => { Module._load = origLoad; });
