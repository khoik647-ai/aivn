'use strict';
// B191 / review #64 vòng 4: chạy THẬT src/desktop-agent.js act() + src/agent/fresh-doc.js trên Notepad GIẢ (cây UIA, bàn phím, chuột, bảng nhớ giả).
// Không cần Electron, Windows hay mô hình. Dựa trên harness của QA (aivn-evidence rv2/pr64r4/probes/harness.js).
const Module = require('module'); const path = require('path');
const ROOT = path.join(__dirname, '../..');
function anyProxy(name) {
  const f = function () { return anyProxy(name + '()'); };
  return new Proxy(f, { get(t, k) {
    if (k === 'then') return undefined; if (k === Symbol.toPrimitive) return () => 0;
    if (k === 'isDestroyed' || k === 'isVisible' || k === 'isMinimized' || k === 'isRegistered') return () => false;
    if (k === 'register') return () => true; if (k === 'once') return (ev, cb) => { setImmediate(cb); }; if (k === 'loadFile' || k === 'loadURL') return async () => {};
    return anyProxy(name + '.' + String(k)); }, construct() { return anyProxy('new ' + name); }, apply() { return anyProxy(name + '()'); } });
}
const clip = { text: '' };
const disp = { id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 }, workArea: { x: 0, y: 0, width: 1280, height: 760 }, size: { width: 1280, height: 800 }, scaleFactor: 1 };
const electron = new Proxy({
  screen: { getPrimaryDisplay: () => disp, getAllDisplays: () => [disp], getCursorScreenPoint: () => ({ x: 0, y: 0 }), on() {}, dipToScreenRect: (w, r) => r },
  globalShortcut: { register: () => true, unregister() {}, isRegistered: () => false, unregisterAll() {} },
  ipcMain: { on() {}, handle() {}, removeHandler() {}, removeListener() {}, removeAllListeners() {}, once() {} },
  clipboard: { writeText(t) { clip.text = String(t); }, readText() { return clip.text; }, clear() { clip.text = ''; }, availableFormats: () => ['text/plain'], readImage: () => anyProxy('img'), write(o) { if (o && o.text != null) clip.text = String(o.text); }, readHTML: () => '', readRTF: () => '' },
  app: { isPackaged: false, getPath: () => require('os').tmpdir() },
}, { get(t, k) { return k in t ? t[k] : anyProxy('electron.' + String(k)); } });
const origLoad = Module._load;
Module._load = function (req) { if (req === 'electron') return electron; return origLoad.apply(this, arguments); };
const SC = require(path.join(ROOT, 'src/screen-control'));
const U = require(path.join(ROOT, 'src/agent/uitree'));
const performed = []; let world = null;
SC.perform = async (a) => { performed.push(JSON.parse(JSON.stringify(a))); if (world && world.onAct) world.onAct(a); return { ok: true }; };
let mpos = { x: 0, y: 0 };
const clickAt = () => { performed.push({ action: 'click', keys: `click@${mpos.x},${mpos.y}` }); if (world && world.onAct) world.onAct({ action: 'click', x: mpos.x, y: mpos.y }); };
const nut = { setMouseDelay() {}, setKeyboardDelay() {}, moveMouse(x, y) { mpos = { x, y }; }, getMousePos: () => mpos, mouseToggle(d) { if (d === 'up') clickAt(); }, mouseClick() { clickAt(); }, scrollMouse() {}, keyToggle() {}, getScreenSize: () => ({ width: 1280, height: 800 }),
  keyTap(key, mods) { const m = [].concat(mods || []).join('+'); const keys = (m ? m + '+' : '') + key; performed.push({ action: 'key', keys }); if (world && world.onAct) world.onAct({ action: 'key', keys, key, mods: [].concat(mods || []), clip: clip.text }); },
  typeString(t) { performed.push({ action: 'typeString', text: t }); if (world && world.onAct) world.onAct({ action: 'typeString', text: t }); } };
SC.libnut = () => nut;
SC.displayInfo = () => ({ text: '1280x800', nutSize: { width: 1280, height: 800 } });
SC.cursorPhys = () => ({ x: 0, y: 0 });
U.tree = async () => { if (world.treeThrow) throw new Error('UIA fail'); return world.tree(); };
U.windows = async () => (world.windows ? world.windows() : []);
U.focus = async () => true; U.setCursor = async (x, y) => { mpos = { x, y }; return true; };
const { createDesktopAgent } = require(path.join(ROOT, 'src/desktop-agent'));
const logs = [];

// Notepad Win11 GIẢ: các thẻ (TabItem + selected), vùng soạn thảo (value đọc được hay không), Ctrl+N, Ctrl+V dán bảng nhớ vào thẻ đang chọn.
function notepad(opts = {}) {
  const st = { tabs: (opts.tabs || [{ name: 'secret.txt', text: 'KHOI-SECRET' }]).map(t => ({ ...t })), active: opts.active || 0, app: opts.app || 'Notepad',
    valueReadable: opts.valueReadable !== false, ctrlN: opts.ctrlN || 'tab', captureFails: 0, treeCalls: 0 };
  const title = () => `${st.tabs[st.active].dirty ? '*' : ''}${st.tabs[st.active].name} - ${st.app}`;
  const w = {
    st,
    tree: () => {
      st.treeCalls++; if (w.onTree) w.onTree(st);
      const els = st.tabs.map((t, i) => ({ r: 'TabItem', n: (t.dirty ? '*' : '') + t.name, b: [10 + i * 130, 30, 120, 24], e: true, sl: i === st.active }));
      els.push({ r: 'Document', n: 'Text editor', b: [0, 60, 1280, 700], e: true, v: st.valueReadable ? st.tabs[st.active].text : null });
      return { win: { title: title(), proc: 'Notepad.exe', pid: 77, hwnd: 7, b: [0, 0, 1280, 800] }, els };
    },
    ocr: () => (opts.ocr ? opts.ocr(st) : []),
    captureThrow: () => { if (st.captureFails > 0) { st.captureFails--; return true; } return false; },
    onAct: (a) => {
      if (a.action === 'click') { st.tabs.forEach((t, i) => { const bx = 10 + i * 130; if (a.x >= bx && a.x <= bx + 120 && a.y >= 30 && a.y <= 54) st.active = i; }); return; }
      if (a.action !== 'key') return;
      if (a.key === 'n' && a.mods.length && st.ctrlN === 'tab') { st.tabs.push({ name: opts.newName || 'Untitled', text: '' }); st.active = st.tabs.length - 1; }
      if (a.key === 'v' && a.mods.length) { const t = st.tabs[st.active]; t.text += a.clip; t.dirty = true; }
      if (a.key === 'insert' && a.mods.length) { const t = st.tabs[st.active]; t.text += a.clip; t.dirty = true; }
      if (a.key === 'a' && a.mods.length) st.selAll = st.active;
      if (a.key === 'delete' || a.key === 'backspace') { if (st.selAll === st.active) st.tabs[st.active].text = ''; }
    },
  };
  w.orig = w.st.tabs.map(t => t.text);
  w.oldTouched = (n = w.orig.length) => w.st.tabs.slice(0, n).some((t, i) => t.text !== (w.orig[i] || ''));
  return w;
}
function make(w, settings = {}, answer = null) {
  world = w; performed.length = 0; logs.length = 0;
  const shot = { dataUrl: 'data:image/png;base64,', width: 1280, height: 800, full: { width: 1280, height: 800 }, geo: null };
  const agent = createDesktopAgent({ engine: { status: () => ({ loaded: true, id: 'fake' }), ocrLines: async () => { if (w.ocrThrow) throw new Error('ocr fail'); return { lines: w.ocr ? w.ocr() : [] }; } },
    getSettings: () => ({ agentScreen: true, agentComputer: true, uiLang: 'vi', agentAutonomy: 'auto', ...settings }), setSettings() {}, log: (...a) => logs.push(a.join(' ')), getMainWindow: () => null, isTest: true,
    fakeScreen: async () => { if (w.captureThrow && w.captureThrow()) throw new Error('capture fail'); return shot; }, fgWin: async () => null });
  agent.setBenchAnswer((req) => (answer ? answer(req, w) : { ok: true })); // thẻ xin phép: trả lời tự động sau ~300 ms
  return agent;
}
async function run(agent, q, steps) {
  const ctx = { userQuery: q, confirm: async () => true }; const out = [];
  for (const s of steps) { if (typeof s === 'function') { await s(world, agent); continue; } try { out.push(await agent.act(s, ctx)); } catch (e) { out.push({ thrown: String(e.message || e) }); } }
  return out;
}
const pastes = () => performed.filter(p => p.action === 'key' && /\+(?:v|insert)$/.test(p.keys)).length;
module.exports = { make, run, notepad, performed, logs, pastes, clip };
