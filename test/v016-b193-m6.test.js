'use strict';
// #89 N1 (red on 5073153): máy không có OCR, mustOcr false, không cửa sổ đang hiện
// → sealShot giữ ảnh. Luật sau #89: mọi ảnh đều phải OCR; không OCR thì che.
// look/observe chạm nhánh này (cây không có cửa sổ rộng → mustOcr false).
// readText truyền mustOcr:false nhưng ocrShot ném lỗi trước nên đã bỏ ảnh.
const test = require('node:test'); const assert = require('node:assert');
const path = require('path'); const Module = require('module');
const R = path.join(__dirname, '..', 'src') + '/';
const W = 32, H = 32, bm = Buffer.alloc(W * H * 4, 255);
const img = { getSize: () => ({ width: W, height: H }), resize: () => img, crop: () => img, toPNG: () => Buffer.from('png'), toBitmap: () => bm, toJPEG: () => Buffer.from('jpg'), isEmpty: () => false };
const electron = {
  app: { isPackaged: false }, desktopCapturer: {}, systemPreferences: {}, clipboard: {},
  screen: { on() {}, getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1 }), getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1, size: { width: 800, height: 600 } }] },
  globalShortcut: { isRegistered: () => false, register() {}, unregister() {} },
  ipcMain: { on() {} },
  nativeImage: { createFromDataURL: () => img, createFromBitmap: () => img },
  BrowserWindow: class { constructor() { this.webContents = { once(ev, fn) { if (ev === 'did-finish-load') fn(); }, send() {} }; } setAlwaysOnTop() {} setIgnoreMouseEvents() {} setContentProtection() {} setVisibleOnAllWorkspaces() {} loadFile() {} on() {} isDestroyed() { return false; } isVisible() { return false; } showInactive() {} hide() {} setFocusable() {} },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { if (req === 'electron') return electron; return origLoad.call(this, req, ...rest); };
const { createDesktopAgent } = require(R + 'desktop-agent');
const U = require(R + 'agent/uitree');
const geo = { id: 1, scale: 1, phys: { x: 0, y: 0, width: 800, height: 600 } };
const MARK = 'ORIGINAL-PIXELS-M6';
const noOcr = { status: () => ({ loaded: true, id: 'm' }) };
const withOcr = { status: () => ({ loaded: true, id: 'm' }), ocrLines: async () => ({ lines: [{ text: 'hello', box: [2, 2, 10, 8], conf: 90 }] }) };

async function lookAt(windows, engine) {
  const prevW = U.windows, prevT = U.tree;
  U.windows = async () => windows;
  U.tree = async () => ({ els: [] });
  let shot = null;
  const agent = createDesktopAgent({
    isTest: true, getSettings: () => ({}), getMainWindow: () => null, log() {}, preload: 'x', engine,
    fakeScreen: async () => (shot = { dataUrl: 'data:image/jpeg;base64,' + Buffer.from(MARK).toString('base64'), width: W, height: H, geo }),
  });
  try {
    const r = await agent.look({}, { userQuery: 'xem man hinh' });
    return { shot, r };
  } finally { try { agent.end(); } catch {} U.windows = prevW; U.tree = prevT; }
}
function dropped(shot, r) {
  assert.ok(shot && shot.dataUrl == null && shot.redacted === true, 'anh chua kiem van con diem anh');
  assert.strictEqual(r.thumb, null);
  assert.ok((r.sensitive || []).includes('text:unreadable'));
  assert.ok(!String(r.forModel || '').includes(MARK));
}

test('M6 #89 N1: no OCR and no visible window drops the shot', async () => {
  const { shot, r } = await lookAt([], noOcr);
  dropped(shot, r);
  // OCR đọc được chữ sạch, không cửa sổ, không có mã → vẫn được giữ (không che quá tay).
  const ok = await lookAt([], withOcr);
  assert.ok(ok.shot && ok.shot.dataUrl && ok.shot.dataUrl.includes(Buffer.from(MARK).toString('base64')), 'OCR sach ma anh bi bo');
  assert.ok(ok.r.thumb, 'OCR sach ma khong co anh nho');
  assert.ok(!(ok.r.sensitive || []).length);
});

test('M6 #89 N1: no OCR and only minimized windows drops the shot', async () => {
  const { shot, r } = await lookAt([{ hwnd: 1, title: 'Untitled - Notepad', proc: 'notepad', min: true }], noOcr);
  dropped(shot, r);
});
