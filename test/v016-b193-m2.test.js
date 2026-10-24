'use strict';
// B193 vòng 5: UIA chỉ đọc một phần (khung, menu, ribbon, cây bị cắt) không được giữ ảnh gốc.
// Chỉ mã kích hoạt giả (issueCode với khoá tạm). Dựa trên PoC của Trưởng.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const Module = require('module');
const R = path.join(__dirname, '..', 'src') + '/';
const L = require(R + 'license'); const Q = require(R + 'qa-runner');
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const CODE = L.issueCode(PEM, { name: 'Nguyễn Văn A', machineCode: 'AB12C-DE34F' }).code;
const MARK = 'ORIGINAL-PIXELS-';
const geo = { id: 1, scale: 1, phys: { x: 0, y: 0, width: 1920, height: 1080 } };
const fakeImage = { decode: (u) => ({ data: Buffer.from(String(u).split(',')[1], 'base64'), w: 1920, h: 1080 }), crop: (i, r) => ({ data: i.data, w: r.width, h: r.height }), size: (i) => ({ width: i.w, height: i.h }), blank: (w, h) => ({ data: Buffer.alloc(64, 0x80), w, h }), jpeg: (i) => Buffer.concat([Buffer.from('JPG'), i.data]) };
const capture = async () => ({ dataUrl: 'data:image/jpeg;base64,' + Buffer.from((MARK + CODE).repeat(4)).toString('base64'), width: 1920, height: 1080, geo });
const win = [{ hwnd: 1, title: 'Untitled - Notepad', proc: 'notepad' }];
function deps(extra) {
  return { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], LOG: { log: () => {}, tap: () => () => {} }, capture, image: fakeImage, deadlineGraceMs: 2000, windowInfo: null, windows: async () => win, ...extra };
}
async function run(extra) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193m2-')); const shots = path.join(d, 'shots');
  const res = await Q.run({ task: 'x', out: path.join(d, 'r.json'), timeout: 30, shots }, deps({
    runAgentTurn: async ({ qa }) => { await qa.onStep({ id: 1, name: 'screenshot', status: 'running' }); await qa.onStep({ id: 1, name: 'screenshot', status: 'ok', summary: 'da chup' }); return { text: 'Xong', outcome: 'done', steps: [] }; },
    ...extra,
  }));
  const files = fs.existsSync(shots) ? fs.readdirSync(shots) : [];
  const raw = files.filter(f => { const b = fs.readFileSync(path.join(shots, f), 'latin1'); return b.includes(MARK) || b.includes(CODE.slice(0, 24)); });
  return { res, raw };
}
function keptRaw(r) { assert.deepStrictEqual(r.raw, [], 'anh goc con ma gia'); assert.ok(r.res.steps[0].shotRedacted); }

const np = { els: [
  { r: 'TitleBar', n: 'Untitled - Notepad' }, { r: 'Button', n: 'Minimize' }, { r: 'Button', n: 'Maximize' }, { r: 'Button', n: 'Close' },
  { r: 'MenuItem', n: 'File' }, { r: 'MenuItem', n: 'Edit' }, { r: 'MenuItem', n: 'View' },
  { r: 'Document', n: 'Text editor', v: null } ] };
test('POC-a: Notepad UIA only chrome+menu, Document value null (Value/TextPattern failed) → must mask', async () => {
  keptRaw(await run({ windowText: async () => np, ocr: async () => CODE }));
});
test('POC-b: Paint ribbon buttons only (code is pixels on canvas) → must mask', async () => {
  keptRaw(await run({ windowText: async () => ({ els: [{ r: 'Button', n: 'Brushes' }, { r: 'Button', n: 'Text' }, { r: 'Pane', n: 'Canvas' }] }), ocr: async () => CODE }));
});
test('POC-c: tree truncated at max (400 els, all buttons, document not reached) → must mask', async () => {
  const els = Array.from({ length: 400 }, (_, i) => ({ r: 'Button', n: 'b' + i }));
  keptRaw(await run({ windowText: async () => ({ els, truncated: true }), ocr: async () => CODE }));
});
test('POC-d: only caption buttons Minimize/Maximize/Close → must mask', async () => {
  keptRaw(await run({ windowText: async () => ({ els: [{ r: 'Button', n: 'Minimize' }, { r: 'Button', n: 'Maximize' }, { r: 'Button', n: 'Close' }] }), ocr: async () => CODE }));
});

// N1: nhánh che ảnh khi cửa sổ/chữ đổi giữa lúc kiểm và lúc chụp (desktop-agent sealShot).
test('N1: cửa sổ hoặc chữ đổi giữa lúc kiểm và lúc chụp → sealShot che hoặc bỏ ảnh', async () => {
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
  const prev = U.windows;
  let calls = 0; let shot = null;
  U.windows = async () => {
    calls++;
    return calls === 1
      ? [{ hwnd: 1, title: 'Untitled - Notepad', proc: 'notepad', text: 'ghi chu' }]
      : [{ hwnd: 1, title: 'Untitled - Notepad', proc: 'notepad', text: 'noi dung khac' }];
  };
  try {
    const agent = createDesktopAgent({
      isTest: true, getSettings: () => ({}), getMainWindow: () => null, log() {}, preload: 'x',
      engine: { status: () => ({ loaded: true, id: 'm' }), ocrLines: async () => ({ lines: [{ text: 'man hinh sach', box: [2, 2, 10, 8], conf: 90 }] }) },
      fakeScreen: async () => (shot = { dataUrl: 'data:image/jpeg;base64,' + Buffer.from((MARK + CODE).repeat(2)).toString('base64'), width: W, height: H, geo }),
    });
    const r = await agent.readText({}, { userQuery: 'doc man hinh' });
    assert.ok(calls >= 2, 'chua toi lan doc sau khi chup');
    assert.ok(shot && shot.dataUrl == null && shot.redacted, 'anh goc con diem anh');
    assert.strictEqual(r.thumb, null);
    assert.ok((r.sensitive || []).includes('text:unreadable'));
    assert.ok(!String(r.forModel || '').includes(CODE.slice(0, 12)) && !String(r.forModel || '').includes(MARK));
    agent.end();
  } finally { U.windows = prev; Module._load = origLoad; }
});
