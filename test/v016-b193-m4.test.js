'use strict';
// B193 vòng 7: Edit/ComboBox có chữ (font, địa chỉ, ô tìm, spin) không được thay OCR.
// Chỉ mã kích hoạt giả (issueCode với khoá tạm).
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193r6-')); const shots = path.join(d, 'shots');
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
const chrome = [{ r: 'TitleBar', n: 'key.txt' }, { r: 'Button', n: 'Close' }, { r: 'MenuItem', n: 'File' }];
const cases = {
  'P1 WordPad: font ComboBox "Calibri" + size "11", Document absent (editor exposed as Pane)': { els: [...chrome, { r: 'ComboBox', n: 'Font', v: 'Calibri' }, { r: 'ComboBox', n: 'Size', v: '11' }, { r: 'Pane', n: 'Rich Text Window' }] },
  'P2 Explorer-like: address Edit non-empty, content pane has no Document': { els: [...chrome, { r: 'Edit', n: 'Address', v: 'C:\\Users\\khoi\\Desktop' }, { r: 'Pane', n: 'Items View' }] },
  'P3 Notepad++: find Edit "abc", Scintilla is Custom/Pane': { els: [...chrome, { r: 'Edit', n: 'Find what', v: 'abc' }, { r: 'Custom', n: 'Scintilla' }, { r: 'Text', n: 'Ln : 1 Col : 1' }] },
  'P4 Browser: Document value is the URL, not the page text': { els: [...chrome, { r: 'Edit', n: 'Address and search bar', v: 'file:///C:/Users/khoi/key.txt' }, { r: 'Document', n: 'key.txt', v: 'file:///C:/Users/khoi/key.txt' }] },
  'P5 search Edit "x" + Document v null (control: must mask)': { els: [...chrome, { r: 'Edit', n: 'Search', v: 'x' }, { r: 'Document', n: 'Text editor', v: null }] },
  'P6 single-char Edit "1" (spin box), nothing else': { els: [...chrome, { r: 'Edit', n: 'Zoom', v: '1' }] },
};
for (const [k, raw] of Object.entries(cases)) test(k, async () => { keptRaw(await run({ windowText: async () => raw, ocr: async () => CODE })); });
