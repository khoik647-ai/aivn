'use strict';
// B193 vòng 4: UIA đọc rỗng phải chuyển sang OCR, và tranh chấp cửa sổ không được giữ ảnh gốc.
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193m1-')); const shots = path.join(d, 'shots');
  const res = await Q.run({ task: 'x', out: path.join(d, 'r.json'), timeout: 30, shots }, deps({
    runAgentTurn: async ({ qa }) => { await qa.onStep({ id: 1, name: 'screenshot', status: 'running' }); await qa.onStep({ id: 1, name: 'screenshot', status: 'ok', summary: 'da chup' }); return { text: 'Xong', outcome: 'done', steps: [] }; },
    ...extra,
  }));
  const files = fs.existsSync(shots) ? fs.readdirSync(shots) : [];
  const raw = files.filter(f => { const b = fs.readFileSync(path.join(shots, f), 'latin1'); return b.includes(MARK) || b.includes(CODE.slice(0, 24)); });
  return { res, raw };
}
function keptRaw(r) { assert.deepStrictEqual(r.raw, [], 'anh goc con ma gia'); assert.ok(r.res.steps[0].shotRedacted); }

test('M1: UIA trả 0 phần tử (chữ rỗng) khi ảnh có mã giả → phải che, không giữ ảnh gốc', async () => {
  keptRaw(await run({ windowText: async () => '' }));
});
test('M1: UIA lỗi FromHandle (0 phần tử) khi ảnh có mã giả → phải che, không giữ ảnh gốc', async () => {
  keptRaw(await run({ windowText: async () => ({ error: 'FromHandle Unrecognized error', els: [] }) }));
});
test('M1: UIA rỗng và OCR cũng rỗng → vẫn che ảnh', async () => {
  keptRaw(await run({ windowText: async () => '', ocr: async () => '' }));
});
test('M1: UIA rỗng, OCR đọc được mã giả → che ảnh', async () => {
  keptRaw(await run({ windowText: async () => ({ els: [] }), ocr: async () => CODE }));
});
test('M2: tranh chấp cửa sổ giữa lúc kiểm và lúc chụp → phải che, không giữ ảnh gốc', async () => {
  let n = 0;
  const windows = async () => (++n % 2
    ? [{ hwnd: 1, title: 'Untitled - Notepad', proc: 'notepad', text: 'ghi chu' }]
    : [{ hwnd: 2, title: 'Untitled - Paint', proc: 'mspaint', text: 've' }]);
  keptRaw(await run({ windows, windowText: async () => 'khong doi', ocr: async () => 'man hinh sach' }));
});
