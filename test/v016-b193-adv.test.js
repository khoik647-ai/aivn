'use strict';
// B193 (#60) / PR #89: bộ kiểm thử đối kháng của lần rà soát bảo mật. Mã kích hoạt sinh bằng license.issueCode với khoá Ed25519 tạm thời (không có mã thật).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const R = path.join(__dirname, '..', 'src') + path.sep;
const SG = require(R + 'agent/shot-guard'); const L = require(R + 'license'); const Q = require(R + 'qa-runner');
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const CODE = L.issueCode(privateKey.export({ type: 'pkcs8', format: 'pem' }), { name: 'Nguyễn Văn A', machineCode: 'AB12C-DE34F' }).code;
const FLAT = CODE.replace(/-/g, ''); const G = CODE.split('-');
const det = (text) => SG.scan({ text }).length > 0;

test('mã thật (issueCode) dạng chuẩn được bắt', () => { assert.ok(det(CODE)); assert.ok(det(FLAT)); assert.ok(det(JSON.stringify({ code: CODE }))); });
for (const [k, v] of Object.entries({
  'chữ thường (parseCode vẫn nhận)': CODE.toLowerCase(),
  'phân cách bằng dấu cách (parseCode vẫn nhận)': CODE.replace(/-/g, ' '),
  'OCR đọc gạch thành en-dash': CODE.replace(/-/g, '–'),
  'OCR thêm cách quanh gạch': CODE.replace(/-/g, ' - '),
  'không gạch, OCR đọc 0→O': FLAT.replace(/0/g, 'O'),
  'không gạch, OCR đọc 1→I': FLAT.replace(/1/g, 'I'),
  'không gạch, xuống dòng mỗi 60 ký tự': FLAT.match(/.{1,60}/g).join('\n'),
  'chỉ thấy 5 nhóm đầu (cuộn ngang/khung hẹp)': G.slice(0, 5).join('-'),
  'không gạch, chỉ thấy 70 ký tự': FLAT.slice(0, 70),
})) test('ĐỐI KHÁNG phát hiện: ' + k, () => assert.ok(det(v), 'không phát hiện: ' + v.slice(0, 40)));

test('ĐỐI KHÁNG che: mã có gạch bị ngắt dòng → không còn mảnh mã nào sau khi che', () => {
  const wrapped = CODE.match(/.{1,50}/g).join('\n');
  const red = SG.redactSecrets(wrapped);
  const left = (red.replace(/\[đã che\]/g, '').match(/[0-9A-Z]{4,}/g) || []);
  assert.deepStrictEqual(left, [], 'mảnh còn lộ: ' + left.join(' '));
});

test('ĐỐI KHÁNG cửa sổ khác: Notepad “notes.txt” đang hiện mã (không phải cửa sổ đích) → phải coi là nhạy cảm', () => {
  // screenSecrets nhận cả nội dung cửa sổ khác, không chỉ tiêu đề
  const r = SG.screenSecrets({ title: 'Calculator', text: '42', windows: [{ title: 'notes.txt - Notepad', proc: 'notepad', text: CODE }] });
  assert.ok(r.reasons.length, 'cửa sổ khác chỉ được xét theo tiêu đề');
});

const MARK = 'ORIGINAL-PIXELS-';
const capture = async () => ({ dataUrl: 'data:image/jpeg;base64,' + Buffer.from(MARK.repeat(20)).toString('base64'), width: 1920, height: 1080, geo: { id: 1, scale: 1, phys: { x: 0, y: 0, width: 1920, height: 1080 } } });
const fakeImage = () => ({ decode: (u) => ({ data: Buffer.from(String(u).split(',')[1], 'base64'), w: 1920, h: 1080 }), crop: (img, r) => ({ data: img.data, w: r.width, h: r.height }), size: (i) => ({ width: i.w, height: i.h }), blank: (w, h) => ({ data: Buffer.alloc(64, 0x80), w, h }), jpeg: (i) => Buffer.concat([Buffer.from('JPG'), i.data]) });
async function run(deps0, emit) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193adv-')); const shots = path.join(d, 'shots');
  const deps = { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], LOG: { log: () => {}, tap: () => () => {} }, capture, image: fakeImage(), deadlineGraceMs: 2000, windowInfo: null, ...deps0,
    runAgentTurn: async ({ qa }) => { await emit(qa); return { text: 'Xong', outcome: 'done', steps: [] }; } };
  const res = await Q.run({ task: 'x', out: path.join(d, 'r.json'), timeout: 20, shots }, deps);
  const files = fs.existsSync(shots) ? fs.readdirSync(shots).map(f => path.join(shots, f)) : [];
  return { res, files };
}
test('ĐỐI KHÁNG fail-closed: liệt kê cửa sổ lỗi khi tệp license.json đang mở → không được ghi ảnh gốc', async () => {
  const { files } = await run({ windows: async () => { throw new Error('PowerShell UIA timeout'); } }, async (qa) => {
    await qa.onStep({ id: 1, name: 'screenshot', status: 'running' }); await qa.onStep({ id: 1, name: 'screenshot', status: 'ok', summary: 'đã chụp' });
  });
  for (const f of files) assert.ok(!fs.readFileSync(f, 'latin1').includes(MARK), 'ảnh gốc đã ghi ra đĩa khi bộ quét lỗi: ' + path.basename(f));
});
test('ĐỐI KHÁNG race: hai bước báo liền nhau (onStep không await như agent.js) → ảnh bước 1 không được sống sót khi bước 2 thấy tệp khoá', async () => {
  let n = 0;
  const windows = async () => { const k = ++n; if (k === 1) { await new Promise(r => setTimeout(r, 300)); return []; } return [{ title: 'license.json - Notepad', proc: 'notepad' }]; };
  const { res, files } = await run({ windows }, async (qa) => {
    const ps = [];
    qa.onStep({ id: 1, name: 'screenshot', status: 'running' }); ps.push(qa.onStep({ id: 1, name: 'screenshot', status: 'ok', summary: 'a' }));
    qa.onStep({ id: 2, name: 'screenshot', status: 'running' }); ps.push(qa.onStep({ id: 2, name: 'screenshot', status: 'ok', summary: 'b' }));
    await Promise.all(ps);
  });
  const orig = files.filter(f => fs.readFileSync(f, 'latin1').includes(MARK)).map(f => path.basename(f));
  assert.deepStrictEqual(orig, [], 'ảnh gốc còn trên đĩa: ' + orig.join(', ') + ' · steps=' + JSON.stringify(res.steps.map(s => ({ n: s.n, shot: !!s.shot, red: !!s.shotRedacted, purged: !!s.shotPurged }))));
});
test('ĐỐI KHÁNG tĩnh: groundWithVision gửi ảnh chụp mới cho mô hình định vị mà không qua shot-guard', () => {
  const src = fs.readFileSync(R + 'desktop-agent.js', 'utf8');
  const a = src.indexOf('async function groundWithVision'); const b = src.indexOf('\n  }\n', a); const body = src.slice(a, b);
  assert.ok(/SC\.locate\(eng, shot/.test(body)); assert.ok(/SG\.|sensitive|screenSecrets/.test(body), 'không có kiểm tra B193 trước SC.locate');
});
test('ĐỐI KHÁNG tĩnh: observe nuốt lỗi của bộ quét (catch {}) → mặc định là “không nhạy cảm”', () => {
  const src = fs.readFileSync(R + 'desktop-agent.js', 'utf8');
  assert.ok(!/try \{ sec = SG\.screenSecrets\([^\n]*\} catch \{\}/.test(src), 'catch {} để sec rỗng → giữ ảnh, gọi mắt nhìn, tạo thumb');
});
