'use strict';
// B193: không có cửa sổ đang hiện vẫn phải OCR. Ảnh gốc không được giữ khi OCR thấy mã.
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
const clean = { els: [{ r: 'Document', n: 'd', v: 'hello note' }] };
function deps(extra) {
  return { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], LOG: { log: () => {}, tap: () => () => {} }, capture, image: fakeImage, deadlineGraceMs: 2000, windowInfo: null, windows: async () => [{ hwnd: 1, title: 'Untitled - Notepad', proc: 'notepad' }], ...extra };
}
async function run(extra) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193m5-')); const shots = path.join(d, 'shots');
  const res = await Q.run({ task: 'x', out: path.join(d, 'r.json'), timeout: 30, shots }, deps({
    runAgentTurn: async ({ qa }) => { await qa.onStep({ id: 1, name: 'screenshot', status: 'running' }); await qa.onStep({ id: 1, name: 'screenshot', status: 'ok', summary: 'da chup' }); return { text: 'Xong', outcome: 'done', steps: [] }; },
    ...extra,
  }));
  const files = fs.existsSync(shots) ? fs.readdirSync(shots) : [];
  const raw = files.filter(f => { const b = fs.readFileSync(path.join(shots, f), 'latin1'); return b.includes(MARK) || b.includes(CODE.slice(0, 24)); });
  return { res, raw };
}
function keptRaw(r) { assert.deepStrictEqual(r.raw, [], 'anh goc con ma gia'); assert.ok(r.res.steps[0].shotRedacted); }

test('Q1 window list empty, code in pixels, OCR returns code', async () => keptRaw(await run({ windows: async () => [], windowText: async () => clean, ocr: async () => CODE })));
test('Q2 all windows min:true, OCR returns code', async () => keptRaw(await run({ windows: async () => [{ hwnd: 1, title: 'a', min: true }], windowText: async () => clean, ocr: async () => CODE })));
test('Q3 deps.windows null (no enumerator), OCR returns code', async () => keptRaw(await run({ windows: null, windowText: async () => clean, ocr: async () => CODE })));
