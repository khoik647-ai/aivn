// 0.16: mở ứng dụng trên Windows — thử lần lượt Start Menu → Desktop → thanh tác vụ → AppData → shell:AppsFolder,
// mỗi cách đều kiểm tra cửa sổ đã hiện; không báo "đã mở" khi chưa thấy cửa sổ.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const C = require('../src/agent/computer'); const CT = require('../src/agent/computer-tools');

function mk({ deep = [], windowsSeq = [], ps = 'fail' } = {}) {
  const launched = []; let w = 0; const focused = []; const logs = [];
  const tools = CT.createComputerTools({ platform: 'win32', getSettings: () => ({ agentComputer: true }), visionReady: () => false, openPath: async () => '', openExternal: async () => {}, log: (m) => logs.push(m),
    deepApps: async () => Object.assign(deep.slice(), { diag: { sources: {}, errors: [] } }),
    psRun: async (script) => { launched.push('ps:' + (script.match(/\$q='([^']*)'/) || [])[1]); return typeof ps === 'function' ? ps() : ps; },
    openAppOverride: async (c) => { launched.push(c.source + ':' + (c.path || c.appId)); if (c.broken) throw new Error('lối tắt hỏng'); },
    windows: async () => { const l = windowsSeq[Math.min(w, windowsSeq.length - 1)] || []; w++; return typeof l === 'function' ? l(launched) : l; },
    focusWindow: async (x) => { focused.push(x.title); }, sleep: async () => {} });
  return { tools, launched, focused, logs };
}
const ZWIN = { hwnd: 77, proc: 'Zalo', title: 'Zalo', pid: 9 };
const winsAfter = (src) => (launched) => (launched.some(l => l.startsWith(src)) ? [ZWIN] : []);

test('Start Menu chạy nhưng không có cửa sổ → thử AppData → thấy cửa sổ Zalo: báo đúng cách đã mở và các cách đã thử', async () => {
  const { tools, launched, focused } = mk({ deep: [{ name: 'Zalo', path: 'C:\\SM\\Zalo.lnk', source: 'startmenu' }, { name: 'Zalo', path: 'C:\\Users\\k\\AppData\\Local\\Programs\\Zalo\\Zalo.exe', source: 'localappdata' }],
    windowsSeq: [winsAfter('localappdata')] });
  const r = await tools.exec('open_app', { name: 'Zalo' }, {});
  assert.deepStrictEqual(launched.slice(0, 2), ['startmenu:C:\\SM\\Zalo.lnk', 'localappdata:C:\\Users\\k\\AppData\\Local\\Programs\\Zalo\\Zalo.exe']);
  assert.match(r.forModel, /Đã mở ứng dụng "Zalo" \(tệp chạy trong %LOCALAPPDATA%\\Programs; đã thấy cửa sổ “Zalo”\)/);
  assert.match(r.forModel, /lối tắt Start Menu: đã chạy nhưng chưa thấy cửa sổ/);
  assert.match(r.summary, /đã thấy cửa sổ/); assert.deepStrictEqual(focused, ['Zalo']);
});
test('lối tắt hỏng → thử lối tắt thanh tác vụ, rồi shell:AppsFolder', async () => {
  const { tools, launched } = mk({ deep: [{ name: 'Zalo', path: 'C:\\SM\\Zalo.lnk', source: 'startmenu', broken: true }, { name: 'Zalo', path: 'C:\\TB\\Zalo.lnk', source: 'taskbar', broken: true }],
    ps: 'ok:Zalo', windowsSeq: [(l) => (l.some(x => x.startsWith('ps:')) ? [ZWIN] : [])] });
  const r = await tools.exec('open_app', { name: 'Zalo' }, {});
  assert.deepStrictEqual(launched, ['startmenu:C:\\SM\\Zalo.lnk', 'taskbar:C:\\TB\\Zalo.lnk', 'ps:Zalo']);
  assert.match(r.forModel, /shell:AppsFolder/); assert.match(r.forModel, /lối tắt Start Menu: lối tắt hỏng; lối tắt ghim trên thanh tác vụ: lối tắt hỏng/);
});
test('Zalo đang mở sẵn → chỉ đưa cửa sổ lên trước, không chạy thêm bản nữa', async () => {
  const { tools, launched, focused } = mk({ deep: [{ name: 'Zalo', path: 'C:\\SM\\Zalo.lnk', source: 'startmenu' }], windowsSeq: [[ZWIN]] });
  const r = await tools.exec('open_app', { name: 'zalo' }, {});
  assert.deepStrictEqual(launched, []); assert.deepStrictEqual(focused, ['Zalo']); assert.match(r.forModel, /đang mở sẵn/);
});
test('tab trình duyệt "Zalo Web" có sẵn KHÔNG bị nhận là ứng dụng Zalo đã mở', async () => {
  const tab = { hwnd: 5, proc: 'chrome', title: 'Zalo Web - Google Chrome' };
  const { tools, launched } = mk({ deep: [{ name: 'Zalo', path: 'C:\\SM\\Zalo.lnk', source: 'startmenu' }], windowsSeq: [(l) => (l.length ? [tab, ZWIN] : [tab])] });
  const r = await tools.exec('open_app', { name: 'Zalo' }, {});
  assert.strictEqual(launched.length, 1); assert.match(r.forModel, /đã thấy cửa sổ “Zalo”/);
});
test('mọi cách đều không ra cửa sổ → báo CHƯA mở được, liệt kê các cách đã thử, gợi ý mở bằng nút Start', async () => {
  const { tools } = mk({ deep: [{ name: 'Zalo', path: 'C:\\SM\\Zalo.lnk', source: 'startmenu' }, { name: 'Zalo', path: 'C:\\D\\Zalo.lnk', source: 'desktop' }], windowsSeq: [[]] });
  await assert.rejects(tools.exec('open_app', { name: 'Zalo' }, {}), (e) => /Chưa mở được "Zalo"/.test(e.message) && /lối tắt Start Menu: đã chạy nhưng chưa thấy cửa sổ; lối tắt Desktop: đã chạy nhưng chưa thấy cửa sổ; shell:AppsFolder \(Get-StartApps\): không có/.test(e.message) && /nút Start/.test(e.message) && /đừng khẳng định/.test(e.message));
});
test('không đọc được danh sách cửa sổ → giữ cách cũ (mở được là báo đã mở, không chặn)', async () => {
  const launched = [];
  const tools = CT.createComputerTools({ platform: 'win32', getSettings: () => ({ agentComputer: true }), openPath: async () => '', deepApps: async () => Object.assign([{ name: 'Zalo', path: 'C:\\SM\\Zalo.lnk', source: 'startmenu' }], { diag: { sources: {}, errors: [] } }), openAppOverride: async (c) => launched.push(c.path), windows: async () => { throw new Error('x'); }, sleep: async () => {} });
  const r = await tools.exec('open_app', { name: 'Zalo' }, {});
  assert.strictEqual(launched.length, 1); assert.match(r.forModel, /Đã mở ứng dụng "Zalo" \(lối tắt Start Menu\)/);
});
test('quét ứng dụng Windows có thêm lối tắt thanh tác vụ và tệp chạy trong AppData (Telegram Desktop)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v16a-'));
  const appData = path.join(root, 'AppData', 'Roaming'), local = path.join(root, 'AppData', 'Local');
  const tb = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'); fs.mkdirSync(tb, { recursive: true }); fs.writeFileSync(path.join(tb, 'Zalo.lnk'), 'x');
  fs.mkdirSync(path.join(appData, 'Telegram Desktop'), { recursive: true }); fs.writeFileSync(path.join(appData, 'Telegram Desktop', 'Telegram.exe'), 'x'); fs.writeFileSync(path.join(appData, 'Telegram Desktop', 'Updater.exe'), 'x');
  fs.mkdirSync(path.join(local, 'Microsoft'), { recursive: true }); fs.writeFileSync(path.join(local, 'Microsoft', 'Microsoft.exe'), 'x');
  const diag = { sources: {}, errors: [] };
  const apps = C.listApps({ platform: 'win32', home: root, env: { USERPROFILE: root, APPDATA: appData, LOCALAPPDATA: local, ProgramData: path.join(root, 'PD') }, diag });
  assert.strictEqual(diag.sources.taskbar, 1); assert.strictEqual(diag.sources.appdata, 1);
  const tg = C.findApp('Telegram', apps); assert.ok(tg && /Telegram\.exe$/.test(tg.path) && tg.source === 'appdata');
  assert.ok(!apps.some(a => a.name === 'Microsoft'), 'bỏ qua thư mục hệ thống trong AppData');
  assert.ok(C.findApp('Zalo', apps).source === 'taskbar');
});
