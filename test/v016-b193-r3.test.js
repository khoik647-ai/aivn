'use strict';
// Rà soát #89 vòng 3 — ca đối kháng (TOCTOU ngược, chữ Hy Lạp, dọn ảnh lượt trước).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const R = path.join(__dirname, '..', 'src') + '/';
const SG = require(R + 'agent/shot-guard'); const L = require(R + 'license'); const Q = require(R + 'qa-runner');
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const CODE = L.issueCode(PEM, { name: 'Nguyễn Văn A', machineCode: 'AB12C-DE34F' }).code;
const G = CODE.split('-'); const FLAT = G.join('');
const det = (text) => SG.scan({ text }).length > 0;
const detW = (windows) => SG.screenSecrets({ title: 'Calculator', text: '42', windows }).reasons.length > 0;

// ---------- QA runner harness ----------
const MARK = 'ORIGINAL-PIXELS-';
const geo = { id: 1, scale: 1, phys: { x: 0, y: 0, width: 1920, height: 1080 } };
const mkCapture = (tag = MARK) => async () => ({ dataUrl: 'data:image/jpeg;base64,' + Buffer.from(tag.repeat(20)).toString('base64'), width: 1920, height: 1080, geo });
const fakeImage = { decode: (u) => ({ data: Buffer.from(String(u).split(',')[1], 'base64'), w: 1920, h: 1080 }), crop: (i, r) => ({ data: i.data, w: r.width, h: r.height }), size: (i) => ({ width: i.w, height: i.h }), blank: (w, h) => ({ data: Buffer.alloc(64, 0x80), w, h }), jpeg: (i) => Buffer.concat([Buffer.from('JPG'), i.data]) };
function baseDeps(extra) {
  return { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], LOG: { log: () => {}, tap: () => () => {} }, capture: mkCapture(), image: fakeImage, deadlineGraceMs: 2000, windowInfo: null, windows: async () => [], windowText: async () => '', ...extra };
}
const steps2 = (names = ['a']) => async ({ qa }) => { for (const [i, n] of names.entries()) { await qa.onStep({ id: i + 1, name: n, status: 'running' }); await qa.onStep({ id: i + 1, name: n, status: 'ok', summary: n }); } return { text: 'Xong', outcome: 'done', steps: [] }; };
async function runQA(deps, { timeout = 60 } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193r3-')); const shots = path.join(d, 'shots');
  const res = await Q.run({ task: 'x', out: path.join(d, 'r.json'), timeout, shots }, deps);
  const all = fs.existsSync(shots) ? fs.readdirSync(shots) : [];
  const raw = all.filter(f => fs.readFileSync(path.join(shots, f), 'latin1').includes(MARK));
  const tmp = fs.readdirSync(d).concat(all).filter(f => /tmp|\.part|~$/.test(f));
  return { res, all, raw, tmp, dir: d, shots };
}
const unreadWin = [{ hwnd: 9, title: 'notes.txt - Notepad', proc: 'notepad' }];

// ---------- 1. OCR timeout / lỗi fail-closed ----------
test('OCR treo (cửa sổ không đọc được chữ) → sau 28s không ghi ảnh gốc', { timeout: 60000 }, async () => {
  const t0 = Date.now();
  const r = await runQA(baseDeps({ windows: async () => unreadWin, windowText: async () => ({ unread: true }), ocr: () => new Promise(() => {}), runAgentTurn: steps2() }));
  console.log('ocr-hang elapsed', Date.now() - t0, 'files', r.all);
  assert.deepStrictEqual(r.raw, []); assert.ok(r.res.steps[0].shotRedacted);
});
test('OCR chậm 35s rồi trả "" (sạch) → vẫn fail-closed (đã quá 28s)', { timeout: 60000 }, async () => {
  const r = await runQA(baseDeps({ windows: async () => unreadWin, windowText: async () => ({ unread: true }), ocr: () => new Promise(res => setTimeout(() => res(''), 35000)), runAgentTurn: steps2() }));
  assert.deepStrictEqual(r.raw, []);
});
for (const [k, ocr] of Object.entries({
  'OCR ném lỗi': () => { throw new Error('boom'); },
  'OCR reject': async () => { throw new Error('boom'); },
  'OCR trả mã': async () => 'Mã kích hoạt\n' + CODE,
  'OCR trả lines có mã': async () => ({ lines: [{ text: G.slice(0, 4).join('-') }, { text: G.slice(4).join('-') }] }),
  'không có bộ OCR': undefined,
})) test('fail-closed: ' + k, async () => {
  const r = await runQA(baseDeps({ windows: async () => unreadWin, windowText: async () => ({ unread: true }), ocr, runAgentTurn: steps2() }));
  assert.deepStrictEqual(r.raw, [], k);
});
test('OCR trả rỗng (không có nội dung) → che ảnh', async () => {
  const r = await runQA(baseDeps({ windows: async () => unreadWin, windowText: async () => ({ unread: true }), ocr: async () => '', runAgentTurn: steps2() }));
  assert.deepStrictEqual(r.raw, []); assert.ok(r.res.steps[0].shotRedacted);
});
for (const [k, extra] of Object.entries({
  'windows() ném': { windows: async () => { throw new Error('x'); } },
  'windows() trả object': { windows: async () => ({ hwnd: 1 }) },
  'windowText ném': { windows: async () => unreadWin, windowText: async () => { throw new Error('x'); } },
  'windowInfo ném (có tgt)': { windowInfo: async () => { throw new Error('x'); } },
  'image.jpeg ném': { image: { ...fakeImage, jpeg: () => { throw new Error('enc'); } } },
  'image.decode ném': { image: { ...fakeImage, decode: () => { throw new Error('dec'); } } },
  'image.blank ném khi bẩn': { windows: async () => [{ hwnd: 1, title: 'k', text: CODE }], image: { ...fakeImage, blank: () => { throw new Error('b'); } } },
  'image = null (không xử lý ảnh) khi bẩn': { windows: async () => [{ hwnd: 1, title: 'k', text: CODE }], image: null },
})) test('lỗi/reject fail-closed: ' + k, async () => {
  const deps = baseDeps({ ...extra, runAgentTurn: async ({ qa }) => { await qa.onStep({ id: 1, name: 'ensure_app', status: 'running' }); await qa.onStep({ id: 1, name: 'ensure_app', status: 'ok', summary: 'a', win: { hwnd: 5, title: 'x', proc: 'p', b: [0, 0, 800, 600] } }); return { text: 'Xong', outcome: 'done', steps: [] }; } });
  const r = await runQA(deps);
  if (k === 'image.jpeg ném' || k === 'image.decode ném') { assert.deepStrictEqual(r.raw, []); return; }
  assert.deepStrictEqual(r.raw, [], k);
});

// ---------- 2. đồng thời / TOCTOU ----------
test('onStep KHÔNG được await bởi người gọi (fire-and-forget) — bước 2 bẩn vẫn xoá ảnh bước 1', async () => {
  let k = 0;
  const deps = baseDeps({ windows: async () => (++k >= 2 ? [{ hwnd: 1, title: 'x', text: CODE }] : []),
    runAgentTurn: async ({ qa }) => { const ps = []; for (const i of [1, 2]) { ps.push(qa.onStep({ id: i, name: 's' + i, status: 'running' })); ps.push(qa.onStep({ id: i, name: 's' + i, status: 'ok', summary: 's' })); } await Promise.all(ps); return { text: 'Xong', outcome: 'done', steps: [] }; } });
  const r = await runQA(deps); assert.deepStrictEqual(r.raw, []);
});
test('bước 1 quét chậm, bước 2 bẩn đến trước → hàng đợi giữ thứ tự, không còn ảnh gốc', async () => {
  let k = 0;
  const deps = baseDeps({ windows: async () => { const me = ++k; if (me === 1) { await new Promise(r => setTimeout(r, 300)); return []; } return [{ hwnd: 1, title: 'x', text: CODE }]; },
    runAgentTurn: async ({ qa }) => { const a = qa.onStep({ id: 1, name: 'a', status: 'ok', summary: 'a' }); const b = qa.onStep({ id: 2, name: 'b', status: 'ok', summary: 'b' }); await Promise.all([a, b]); return { text: 'Xong', outcome: 'done', steps: [] }; } });
  const r = await runQA(deps); assert.deepStrictEqual(r.raw, []);
});
test('TOCTOU ngược: cửa sổ có mã hiện LÚC CHỤP, đóng trước khi liệt kê → ảnh gốc có mã bị ghi?', async () => {
  let open = true; // cửa sổ mã kích hoạt đang mở khi chụp
  const capture = async () => { const c = await mkCapture()(); open = false; return c; }; // người dùng đóng ngay sau khi chụp
  const deps = baseDeps({ capture, windows: async () => (open ? [{ hwnd: 1, title: 'aivn-license.txt - Notepad', text: CODE }] : []), runAgentTurn: steps2() });
  const r = await runQA(deps);
  console.log('TOCTOU-reverse raw files written:', r.raw.length);
  assert.deepStrictEqual(r.raw, [], 'ảnh chụp lúc cửa sổ mã còn mở bị ghi nguyên vì liệt kê cửa sổ chạy SAU capture');
});
test('TOCTOU ngược (nội dung): chữ đổi giữa chụp và đọc UIA → ảnh gốc có mã', async () => {
  let txt = CODE;
  const capture = async () => { const c = await mkCapture()(); txt = 'đã xoá'; return c; };
  const deps = baseDeps({ capture, windows: async () => [{ hwnd: 1, title: 'ghi-chu.txt - Notepad' }], windowText: async () => txt, runAgentTurn: steps2() });
  const r = await runQA(deps);
  assert.deepStrictEqual(r.raw, [], 'chữ đọc sau khi chụp');
});

// ---------- 3. purge ----------
test('purge: 3 ảnh sạch rồi bước 4 bẩn → xoá hết 3 ảnh gốc, step.shot null, không còn tệp tạm', async () => {
  let k = 0;
  // Mỗi bước đọc cửa sổ hai lần (trước và sau khi chụp): 3 bước sạch = 6 lần đọc, từ lần 7 thấy mã.
  const deps = baseDeps({ windows: async () => (++k >= 7 ? [{ hwnd: 1, title: 'x', text: CODE }] : []), runAgentTurn: steps2(['a', 'b', 'c', 'd']) });
  const r = await runQA(deps);
  assert.deepStrictEqual(r.raw, []); assert.deepStrictEqual(r.tmp, []);
  for (const s of r.res.steps.slice(0, 3)) assert.strictEqual(s.shot, null);
});
test('purge: ảnh gốc từ lượt QA TRƯỚC (cùng thư mục, < 24h) không bị xoá khi lượt này thấy mã', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193r3p-')); const shots = path.join(d, 'shots'); fs.mkdirSync(shots);
  fs.writeFileSync(path.join(shots, 'step-01-old.jpg'), 'JPG' + MARK.repeat(5));
  const deps = baseDeps({ windows: async () => [{ hwnd: 1, title: 'x', text: CODE }], runAgentTurn: steps2() });
  await Q.run({ task: 'x', out: path.join(d, 'r.json'), timeout: 30, shots }, deps);
  const left = fs.existsSync(path.join(shots, 'step-01-old.jpg'));
  console.log('note: ảnh lượt trước còn lại =', left, '(lượt sau ghi đè cùng tên step-01-*.jpg?)', fs.readdirSync(shots));
});
test('purge: symlink step-01-x.jpg trỏ ra ngoài → không xoá đích', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193r3s-')); const s = path.join(d, 'shots'); fs.mkdirSync(s);
  const outside = path.join(d, 'keep.jpg'); fs.writeFileSync(outside, 'x'); fs.symlinkSync(outside, path.join(s, 'step-01-x.jpg'));
  SG.forgetShots([{ shot: path.join(s, 'step-01-x.jpg') }], s); assert.ok(fs.existsSync(outside));
});
test('purge: step.shot trỏ ra ngoài thư mục shots → không xoá', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193r3o-')); const s = path.join(d, 'shots'); fs.mkdirSync(s);
  const outside = path.join(d, 'step-01-a.jpg'); fs.writeFileSync(outside, 'x');
  SG.forgetShots([{ shot: outside }], s); assert.ok(fs.existsSync(outside));
});

// ---------- 4. mọi người gọi await onStep ----------
test('agent.js: mọi lời gọi onStep( có await, trừ republish trong guardStep (đi qua cùng hàng đợi)', () => {
  const a = fs.readFileSync(R + 'agent/agent.js', 'utf8').split('\n');
  const bad = a.map((l, i) => [i + 1, l]).filter(([, l]) => /\bonStep\(/.test(l) && !/await onStep\(/.test(l) && !/republish: \(st\) => onStep\(st\)/.test(l) && !/rawStep|onStep = \(st\)|function runInner|onStep = \(\) =>/.test(l));
  assert.deepStrictEqual(bad.map(x => x[0]), [], bad.map(x => x[0] + ': ' + x[1].trim().slice(0, 120)).join('\n'));
});
test('main.js: onStep trả promise của qa.onStep', () => {
  const m = fs.readFileSync(R + 'main.js', 'utf8'); assert.ok(/const p = qa && qa\.onStep \? qa\.onStep\(st\) : undefined;[^\n]*return p;/.test(m));
});
test('qa-runner: chờ pendingSteps trước khi ghi result.json', () => {
  const q = fs.readFileSync(R + 'qa-runner.js', 'utf8'); assert.ok(/await Promise\.all(Settled)?\(pendingSteps/.test(q), 'không thấy await pendingSteps');
});

// ---------- 5. chuẩn hoá ----------
const homoGreek = { A: 'Α', B: 'Β', E: 'Ε', H: 'Η', K: 'Κ', M: 'Μ', N: 'Ν', P: 'Ρ', T: 'Τ', X: 'Χ', Z: 'Ζ' };
const mathBold = (s) => s.replace(/[A-Z]/g, c => String.fromCodePoint(0x1D400 + c.charCodeAt(0) - 65)).replace(/[0-9]/g, c => String.fromCodePoint(0x1D7CE + c.charCodeAt(0) - 48));
const norm = {
  'ZWSP mọi ký tự': [...CODE].join('\u200b'),
  'ZWNJ + WORD JOINER xen kẽ': [...CODE].map((c, i) => c + (i % 2 ? '\u200c' : '\u2060')).join(''),
  'BOM giữa nhóm': G.join('-\ufeff'),
  'BiDi override (RLO…PDF) bọc mã': '\u202e' + CODE + '\u202c',
  'toàn chiều rộng (chữ + gạch)': CODE.replace(/[0-9A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/-/g, '－'),
  'chữ thường': CODE.toLowerCase(),
  'Kirin trộn chữ thường': CODE.toLowerCase().replace(/[aeopcx]/g, c => ({ a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х' })[c]),
  'Hy Lạp trông giống Latin': CODE.replace(/[ABEHKMNPTXZ]/g, c => homoGreek[c]),
  'Mathematical Bold (NFKC)': mathBold(CODE),
  'chữ số khoanh tròn/superscript (NFKC)': CODE.replace(/1/g, '¹').replace(/2/g, '²'),
  'xuống dòng giữa nhóm (\\n)': G.join('-\n'),
  'xuống dòng KHÔNG dấu gạch (mỗi nhóm 1 dòng)': G.join('\n'),
  'CRLF mỗi nhóm': G.join('\r\n'),
  'xuống dòng giữa MỘT nhóm (cuộn chữ)': CODE.slice(0, 15) + '\n' + CODE.slice(15),
  'gói chữ tại 40 cột (mã liền)': FLAT.match(/.{1,40}/g).join('\n'),
  'gói 16 cột (mã liền)': FLAT.match(/.{1,16}/g).join('\n'),
  'NBSP giữa nhóm': G.join('\u00a0'),
  'khoảng trắng giữa nhóm': G.join(' '),
  'en dash / em dash': G.join('–'),
  'dấu gạch Unicode ‐ (U+2010)': G.join('\u2010'),
  'mã trong <<< >>> OCR khung': '<<<\n' + CODE + '\n>>>',
  'mã liền 1 dòng': FLAT,
};
for (const [k, v] of Object.entries(norm)) test('CHUẨN HOÁ phát hiện: ' + k, () => assert.ok(det(v), JSON.stringify(v.slice(0, 40))));
test('redactSecrets che hết mã có ZWSP (không còn nhóm nào lọt)', () => {
  const v = 'Mã: ' + [...CODE].join('\u200b'); const o = SG.redactSecrets(v).replace(/\u200b/g, '');
  for (const g of G) assert.ok(!o.includes(g), 'lọt nhóm ' + g);
});
test('mã ở vị trí 5 000 và 300 000 trong một cửa sổ (văn bản dài) → phát hiện', () => {
  const pad = 'Ghi chú cuộc họp, danh sách việc cần làm trong tuần. ';
  for (const at of [5000, 300000]) { let doc = ''; while (doc.length < at) doc += pad; assert.ok(detW([{ title: 'ghi-chu.txt - Notepad', text: doc + CODE + '\n' + doc }]), 'at ' + at); }
});
test('đường đọc chữ cửa sổ dùng vmax ≥ 100000 ở mọi chỗ gọi U.tree cho bộ quét', () => {
  const q = fs.readFileSync(R + 'qa-runner.js', 'utf8'); const d = fs.readFileSync(R + 'desktop-agent.js', 'utf8');
  const calls = [...q.matchAll(/uitree'\)\.tree\(\{[^}]*\}/g), ...d.slice(d.indexOf('async function readWindowText'), d.indexOf('async function sealShot')).matchAll(/U\.tree\(\{[^}]*\}/g)].map(m => m[0]);
  assert.ok(calls.length >= 3, calls.join('|'));
  for (const c of calls) assert.ok(/vmax: (\d+)/.test(c) && Number(/vmax: (\d+)/.exec(c)[1]) >= 100000, c);
});

// ---------- 6. ReDoS ----------
const jwtInputs = {
  'eyJ-×256K': 'eyJ-'.repeat(1 << 16),
  'eyJ+a×2000 (gần trần) ×200': ('eyJ' + 'a'.repeat(2000) + '.').repeat(200),
  'eyJ a.a (thiếu đoạn 3) ×100K': ('eyJ' + 'a'.repeat(10) + '.' + 'a'.repeat(10)).repeat(10000),
  'eyJ…. dài 1MB không có dấu chấm thứ 2': 'eyJ' + 'a'.repeat(1 << 20),
  'eyJaaaa.eyJaaaa. lặp': ('eyJaaaaaaaaaaaa.').repeat(65536),
  '_-_- quanh eyJ': ('_eyJ' + '-'.repeat(50)).repeat(20000),
};
for (const [k, s] of Object.entries(jwtInputs)) test('ReDoS JWT: ' + k, () => {
  const t0 = Date.now(); SG.scan({ text: s }); SG.redactSecrets(s); const ms = Date.now() - t0;
  console.log('jwt', k, s.length, 'chars', ms, 'ms'); assert.ok(ms < 2000, ms + 'ms');
});
test('JWT thật vẫn bị phát hiện + che', () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ sub: '1234567890', name: 'Khoi' }) + '.' + crypto.randomBytes(32).toString('base64url');
  assert.ok(SG.scan({ text: 'Authorization: Bearer ' + jwt }).includes('text:jwt')); assert.ok(!SG.redactSecrets('x ' + jwt).includes(jwt.split('.')[2]));
});
test('JWT dính sau chữ (abc.eyJ… / x-eyJ…) — lookbehind không bỏ sót', () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ sub: '1234567890' }) + '.' + crypto.randomBytes(32).toString('base64url');
  for (const pre of ['token=', '"', 'Bearer\t', '.', '(']) assert.ok(SG.scan({ text: pre + jwt }).length, pre);
  console.log('note x-eyJ… (gạch nối trước):', SG.scan({ text: 'x-' + jwt }), ' x_eyJ…:', SG.scan({ text: 'x_' + jwt }));
});
