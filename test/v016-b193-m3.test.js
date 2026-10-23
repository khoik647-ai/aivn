'use strict';
// B193 vòng 6: Text/TabItem không phải nội dung đã đọc; TextPattern lỗi không phải tệp rỗng; macOS phải đọc đúng hwnd.
// Chỉ mã kích hoạt giả (issueCode với khoá tạm). Dựa trên PoC của Trưởng.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193m3-')); const shots = path.join(d, 'shots');
  const res = await Q.run({ task: 'x', out: path.join(d, 'r.json'), timeout: 30, shots }, deps({
    runAgentTurn: async ({ qa }) => { await qa.onStep({ id: 1, name: 'screenshot', status: 'running' }); await qa.onStep({ id: 1, name: 'screenshot', status: 'ok', summary: 'da chup' }); return { text: 'Xong', outcome: 'done', steps: [] }; },
    ...extra,
  }));
  const files = fs.existsSync(shots) ? fs.readdirSync(shots) : [];
  const raw = files.filter(f => { const b = fs.readFileSync(path.join(shots, f), 'latin1'); return b.includes(MARK) || b.includes(CODE.slice(0, 24)); });
  return { res, raw };
}
function keptRaw(r) { assert.deepStrictEqual(r.raw, [], 'anh goc con ma gia'); assert.ok(r.res.steps[0].shotRedacted); }

const T = (n) => ({ r: 'Text', n });
const chrome = [{ r: 'TitleBar', n: 'Untitled - Notepad' }, { r: 'Button', n: 'Close' }, { r: 'MenuItem', n: 'File' }];
test('A Notepad: Document missing from tree, status-bar Text + TabItem only', async () => {
  keptRaw(await run({ windowText: async () => ({ els: [...chrome, { r: 'TabItem', n: 'Untitled' }, T('Ln 1, Col 1'), T('100%'), T('UTF-8')] }), ocr: async () => CODE }));
});
test('B Document v="" (ValuePattern "" and TextPattern threw) + status Text', async () => {
  keptRaw(await run({ windowText: async () => ({ els: [...chrome, { r: 'Document', n: 'Text editor', v: '' }, T('Ln 1, Col 1')] }), ocr: async () => CODE }));
});
test('J Text = window title only, no doc', async () => {
  keptRaw(await run({ windowText: async () => ({ els: [...chrome, T('Untitled - Notepad')] }), ocr: async () => CODE }));
});
test('N1: Document bị cắt ở vmax (partial) → phải che', async () => {
  keptRaw(await run({ windowText: async () => ({ partial: true, els: [{ r: 'Document', n: 'Text editor', v: 'ghi chu' }] }), ocr: async () => CODE }));
});

function axEl(opt) {
  const o = opt || {};
  const kids = o.kids || [];
  return {
    id: () => o.id,
    name: () => o.name || '',
    title: () => o.name || '',
    description: () => '',
    role: () => o.role || 'AXWindow',
    subrole: () => o.sub || '',
    value: () => (o.value == null ? null : o.value),
    position: () => [10, 10],
    size: () => [400, 300],
    enabled: () => true,
    focused: () => false,
    uiElements: () => kids,
  };
}
function macTree(hwnd) {
  const U = require(R + 'agent/uitree');
  const clean = axEl({ id: 111, name: 'Clean', kids: [axEl({ role: 'AXTextArea', value: 'hello note' })] });
  const secret = axEl({ id: 222, name: 'Secret', kids: [axEl({ role: 'AXTextArea', value: CODE })] });
  function Application() {
    return { applicationProcesses: { whose() { return [{ name() { return 'Notes'; }, unixId() { return 9; }, windows: [clean, secret] }]; } } };
  }
  const json = new Function('Application', 'argv', U.JXA_TREE + '\nreturn run(argv);')(Application, ['200', 'Notes', '500000', String(hwnd)]);
  return JSON.parse(json);
}
test('M3: macOS JXA bỏ hwnd, cửa sổ thứ hai chứa mã không được đọc → phải che', async () => {
  const raw = macTree(222);
  const r = await run({ windowText: async () => raw, ocr: async () => CODE });
  keptRaw(r);
  assert.ok(JSON.stringify(raw).includes(CODE.slice(0, 16)), 'khong doc dung cua so hwnd');
});
test('M3: macOS hwnd không khớp cửa sổ nào → chưa đọc, phải che', async () => {
  const raw = macTree(999);
  const r = await run({ windowText: async () => raw, ocr: async () => CODE });
  keptRaw(r);
  assert.ok(raw.unread || raw.partial, 'hwnd le phai la chua doc');
});
