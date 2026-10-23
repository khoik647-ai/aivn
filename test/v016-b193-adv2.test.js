'use strict';
// Rà soát #89 vòng 2 — ca đối kháng. Đường dẫn trỏ vào src của repo.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const R = path.join(__dirname, '..', 'src') + '/';
const SG = require(R + 'agent/shot-guard'); const L = require(R + 'license'); const Q = require(R + 'qa-runner');
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const CODE = L.issueCode(PEM, { name: 'Nguyễn Văn A', machineCode: 'AB12C-DE34F' }).code;
const SHORT = L.issueCode(PEM, { name: 'A', machineCode: 'AB12C-DE34F' }).code;
const FLAT = CODE.replace(/-/g, ''); const G = CODE.split('-');
const det = (text) => SG.scan({ text }).length > 0;
const detW = (windows, o = {}) => SG.screenSecrets({ title: 'Calculator', text: '42', ...o, windows }).reasons.length > 0;
test('info: độ dài mã', () => { console.log('CODE len', CODE.length, 'groups', G.length, 'SHORT len', SHORT.length); });

// ---- biến thể ký tự ----
const homo = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', P: 'Р', C: 'С', T: 'Т', X: 'Х' };
const fw = (s) => s.replace(/[0-9A-Za-z]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
const cases = {
  'chữ Kirin trông giống Latin (OCR đa ngữ)': CODE.replace(/[ABEKMHPCTX]/g, c => homo[c]),
  'zero-width space giữa mọi ký tự': [...CODE].join('\u200b'),
  'zero-width joiner trong mỗi nhóm': G.map(g => g.slice(0, 3) + '\u200d' + g.slice(3)).join('-'),
  'soft hyphen làm dấu phân cách': G.join('\u00ad'),
  'chữ/số toàn chiều rộng (IME/OCR tiếng Trung)': fw(CODE),
  'gạch toàn chiều rộng －': G.join('\uff0d'),
  'dấu chấm giữa (·) làm phân cách': G.join('·'),
  'dấu gạch dưới': G.join('_'),
  'dấu chấm': G.join('.'),
  'nhóm 4 (định dạng khác)': FLAT.match(/.{1,4}/g).join('-'),
  'tab giữa các nhóm': G.join('\t'),
  'mã ngắn (tên 1 ký tự)': SHORT,
  'mã trong ngoặc kép JSON có \\n escaped': JSON.stringify(CODE.match(/.{1,40}/g).join('\n')),
};
for (const [k, v] of Object.entries(cases)) test('PHÁT HIỆN: ' + k, () => assert.ok(det(v), 'không phát hiện: ' + JSON.stringify(v.slice(0, 30))));

// ---- hai cửa sổ / tiêu đề / dài ----
test('mã chia đôi ở hai cửa sổ', () => {
  const h = Math.floor(G.length / 2);
  assert.ok(detW([{ title: 'a.txt - Notepad', text: G.slice(0, h).join('-') }, { title: 'b.txt - Notepad', text: G.slice(h).join('-') }]));
});
test('mã chia đôi, mỗi nửa chỉ 4 nhóm hiện (khung hẹp)', () => {
  assert.ok(detW([{ title: 'a', text: G.slice(0, 4).join('-') }, { title: 'b', text: G.slice(4, 8).join('-') }]));
});
test('mã nằm trong TIÊU ĐỀ cửa sổ khác', () => assert.ok(detW([{ title: CODE + ' - Notepad', text: '' }])));
test('mã nằm trong TIÊU ĐỀ cửa sổ đích', () => assert.ok(SG.screenSecrets({ title: SHORT + '.txt - Notepad', text: '' }).reasons.length));
test('mã trong thân cửa sổ khác, tiêu đề vô hại', () => assert.ok(detW([{ title: 'ghi-chu.txt - Notepad', text: 'Ghi chú hôm nay\n' + CODE }])));
test('văn bản dài: mã sau 200 ký tự đầu, cắt 200 như PS_TREE (Value.Substring(0,200))', () => {
  // Đoạn dẫn gốc dài 188 ký tự nên indexOf(CODE) không thể > 200, và 200 ký tự đầu không chứa mã.
  // Lặp đoạn dẫn cho mã bắt đầu sau ký tự 200. Bản bị cắt 200 không được “thấy” mã; bản đọc đủ thì phải thấy.
  const pad = 'Ghi chú cuộc họp với khách hàng, danh sách việc cần làm trong tuần, số điện thoại liên hệ, địa chỉ giao hàng và vài dòng linh tinh khác để lấp đầy phần đầu của tệp văn bản này cho đủ dài.\n';
  let doc = pad; while (doc.length <= 200) doc += pad; doc += CODE;
  assert.ok(doc.indexOf(CODE) > 200);
  assert.ok(det(doc), 'chữ đầy đủ phải bắt được');
  assert.ok(!detW([{ title: 'ghi-chu.txt - Notepad', text: doc.slice(0, 200) }]), '200 ký tự đầu chỉ là lời dẫn, không có mã');
  assert.ok(detW([{ title: 'ghi-chu.txt - Notepad', text: doc }]), 'đọc đủ giá trị (không cắt 200) thì phải thấy mã');
});
test('PS_TREE vẫn cắt Value ở 200 ký tự và readWindowText dùng U.tree không tham số đọc đủ', () => {
  const u = fs.readFileSync(R + 'agent/uitree.js', 'utf8'); const d = fs.readFileSync(R + 'desktop-agent.js', 'utf8');
  const trunc = /\$v\.Length -gt 200\) \{ \$v = \$v\.Substring\(0, 200\)/.test(u);
  const rw = d.slice(d.indexOf('async function readWindowText'), d.indexOf('async function sealShot'));
  assert.ok(!(trunc && !/vmax|full|maxValue|AIVN_VMAX/i.test(rw)), 'bộ quét đọc chữ cửa sổ khác bị cắt 200 ký tự');
});
test('macOS: JXA_WINDOWS không có hwnd → readWindowText trả rỗng → chỉ xét tiêu đề', () => {
  const u = fs.readFileSync(R + 'agent/uitree.js', 'utf8');
  const jw = u.slice(u.indexOf('const JXA_WINDOWS'), u.indexOf('// ---------- Linux'));
  const d = fs.readFileSync(R + 'desktop-agent.js', 'utf8');
  const rw = d.slice(d.indexOf('async function readWindowText'), d.indexOf('async function sealShot'));
  assert.ok(/hwnd/.test(jw) || !/w\.hwnd == null/.test(rw), 'mac: nội dung cửa sổ khác không được quét');
});
test('Windows: PS_WINDOWS chỉ liệt kê MainWindowHandle (1 cửa sổ/tiến trình)', () => {
  const u = fs.readFileSync(R + 'agent/uitree.js', 'utf8');
  const pw = u.slice(u.indexOf('const PS_WINDOWS'), u.indexOf('const PS_FOCUS'));
  assert.ok(!/MainWindowHandle/.test(pw) || /EnumWindows/.test(pw), 'cửa sổ Notepad thứ hai của cùng tiến trình không được liệt kê');
});

// ---- bộ quét lỗi / quá hạn ----
test('fillWindowText: đọc treo → ném sau timeout, không treo mãi', async () => {
  const t0 = Date.now();
  await assert.rejects(SG.fillWindowText([{ hwnd: 1, title: 'x' }], () => new Promise(() => {}), { timeoutMs: 200 }));
  assert.ok(Date.now() - t0 < 1500);
});
test('reveal: loadWindows treo → failed + text:unreadable', async () => {
  const r = await SG.reveal({ loadWindows: () => new Promise(() => {}), timeoutMs: 200 });
  assert.strictEqual(r.failed, true); assert.ok(r.reasons.includes('text:unreadable'));
});
test('reveal: loadText ném ở cửa sổ thứ 2 → failed', async () => {
  let k = 0; const r = await SG.reveal({ windows: [{ hwnd: 1, title: 'a' }, { hwnd: 2, title: 'b' }], loadText: async () => { if (++k === 2) throw new Error('x'); return 'ok'; }, timeoutMs: 200 });
  assert.strictEqual(r.failed, true);
});
test('reveal: loadWindows trả không phải mảng → failed', async () => {
  const r = await SG.reveal({ loadWindows: async () => ({ hwnd: 1 }) }); assert.strictEqual(r.failed, true);
});
test('reveal: lần đọc trễ (sau timeout) trả mã → không ảnh hưởng kết quả đã fail-closed, không ném unhandled', async () => {
  let late; const p = new Promise(res => { late = res; });
  const r = await SG.reveal({ windows: [{ hwnd: 1, title: 'a' }], loadText: () => p, timeoutMs: 100 });
  late(CODE); await new Promise(r2 => setTimeout(r2, 50));
  assert.strictEqual(r.failed, true);
});
test('fillWindowText: cửa sổ đã có w.text (vd. cắt 200) thì KHÔNG đọc lại', async () => {
  let called = 0; const out = await SG.fillWindowText([{ hwnd: 1, title: 'a', text: 'abc' }], async () => { called++; return CODE; });
  assert.strictEqual(called, 0); console.log('note: w.text sẵn có được tin, không đọc lại');
});
test('cửa sổ thu nhỏ bị bỏ qua (đúng), cửa sổ visible:undefined vẫn quét', () => {
  assert.ok(!detW([{ title: 'a', min: true, text: CODE }])); assert.ok(detW([{ title: 'a', text: CODE }]));
});
test('QA runner: bộ đọc chữ cửa sổ treo → ảnh không được ghi bản gốc (fail-closed qua fillWindowText 8s)', { timeout: 30000 }, async () => {
  const MARK = 'ORIGINAL-PIXELS-';
  const capture = async () => ({ dataUrl: 'data:image/jpeg;base64,' + Buffer.from(MARK.repeat(20)).toString('base64'), width: 1920, height: 1080, geo: { id: 1, scale: 1, phys: { x: 0, y: 0, width: 1920, height: 1080 } } });
  const fakeImage = { decode: (u) => ({ data: Buffer.from(String(u).split(',')[1], 'base64'), w: 1920, h: 1080 }), crop: (i, r) => ({ data: i.data, w: r.width, h: r.height }), size: (i) => ({ width: i.w, height: i.h }), blank: (w, h) => ({ data: Buffer.alloc(64, 0x80), w, h }), jpeg: (i) => Buffer.concat([Buffer.from('JPG'), i.data]) };
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b193r2-')); const shots = path.join(d, 'shots');
  const deps = { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], LOG: { log: () => {}, tap: () => () => {} }, capture, image: fakeImage, deadlineGraceMs: 2000, windowInfo: null,
    windows: async () => [{ hwnd: 7, title: 'notes.txt - Notepad', proc: 'notepad' }], windowText: () => new Promise(() => {}),
    runAgentTurn: async ({ qa }) => { await qa.onStep({ id: 1, name: 'screenshot', status: 'running' }); await qa.onStep({ id: 1, name: 'screenshot', status: 'ok', summary: 'a' }); return { text: 'Xong', outcome: 'done', steps: [] }; } };
  await Q.run({ task: 'x', out: path.join(d, 'r.json'), timeout: 25, shots }, deps);
  const files = fs.existsSync(shots) ? fs.readdirSync(shots) : [];
  for (const f of files) assert.ok(!fs.readFileSync(path.join(shots, f), 'latin1').includes(MARK), 'ảnh gốc: ' + f);
});

// ---- nối tiếp onStep ----
test('agent.js: chuỗi onStep — bước lỗi không làm kẹt bước sau, thứ tự giữ nguyên', async () => {
  const seen = []; let chain = Promise.resolve();
  const raw = async (st) => { if (st === 2) throw new Error('x'); await new Promise(r => setTimeout(r, 5 * (5 - st))); seen.push(st); };
  const onStep = (st) => { const p = chain.then(() => raw(st)); chain = p.then(() => {}, () => {}); return p; };
  const ps = [1, 2, 3, 4].map(i => onStep(i).catch(() => 'err'));
  await Promise.all(ps); assert.deepStrictEqual(seen, [1, 3, 4]);
});

// ---- hiệu năng / backtracking ----
const big = {
  'A×1MB': 'A'.repeat(1 << 20), 'A-×512K': 'A-'.repeat(1 << 19), 'AAAAA␠×': 'AAAAA '.repeat(174762), 'AAAAAA\\n×': 'AAAAAA\n'.repeat(149796),
  'eyJ-× (64KB; 1MB ≈ 10 phút — xem perf.js)': 'eyJ-'.repeat(1 << 14), 'eyJ.aaaaaaaaaaaa×': ('eyJ' + 'a'.repeat(12) + '.').repeat(65536), 'aA×(no digit)': 'aA'.repeat(1 << 19), 'hex+g': 'a'.repeat(1 << 20) + 'g',
  'sk-×': 'sk-'.repeat(349525), '-----BEGIN PRIVATE KEY-----×': '-----BEGIN RSA PRIVATE KEY-----'.repeat(33825), 'Ab1 ×': 'Ab1-'.repeat(1 << 18),
  'tiếng Việt': 'Cộng hoà xã hội chủ nghĩa Việt Nam '.repeat(30000),
};
for (const [k, s] of Object.entries(big)) test('1MB không treo: ' + k, () => {
  const t0 = Date.now(); SG.scan({ title: s.slice(0, 4096), text: s }); const t1 = Date.now(); SG.redactSecrets(s); SG.redactTitles(s, ['abc']); const t2 = Date.now();
  console.log(`perf ${k}: scan ${t1 - t0}ms redact ${t2 - t1}ms`);
  assert.ok(t2 - t0 < 3000, k + ' chậm ' + (t2 - t0) + 'ms');
});

// ---- dương tính giả trên chữ bình thường ----
const normal = {
  'menu UIA tiếng Anh (mỗi phần tử một dòng)': ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Table', 'Window', 'Help', 'Minimize', 'Maximize', 'Close', 'Save', 'Print', 'Share', 'Comments', 'Editing', 'Search', 'Paste', 'Bold', 'Italic', 'Styles', 'Design', 'Layout', 'References', 'Mailings', 'Review'].join('\n'),
  'Explorer (mỗi tệp một dòng)': ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Videos', 'Network', 'This PC', 'Home', 'Gallery', 'Recent', 'Name', 'Date modified', 'Type', 'Size', 'Folder', 'Text Document', 'Application', 'Shortcut', 'Details', 'Preview', 'Refresh', 'Delete', 'Rename', 'Properties'].join('\n'),
  'Settings (từ 5–6 chữ cái)': ['Hello', 'World', 'Start', 'Apps', 'Power', 'Display', 'Sound', 'Theme', 'Fonts', 'Privacy', 'Gaming', 'Battery', 'Storage', 'Accounts', 'Time', 'Language', 'Region', 'Speech'].join('\n'),
  'hoá đơn chữ in hoa': 'HOA DON GIA TRI GIA TANG\nMAT HANG: BANH MI THIT\nSO LUONG: 20\nTHANH TIEN: 400000 VND\nNGAY 23 THANG 10 NAM 2026',
  'SHA git dài': 'commit 3d964c9a1b2c3d4e5f60718293a4b5c6d7e8f901 Author: x',
  'đường dẫn Windows': 'C:\\Users\\Khoi\\AppData\\Roaming\\AIVN\\models\\qwen2.5-7b-instruct-q4_k_m.gguf',
  'tên tệp slug dài': 'Bao-cao-tai-chinh-quy-3-nam-2026-phong-ke-toan-ban-cuoi.docx',
  'mã máy (10 ký tự) — không phải mã kích hoạt': 'Mã máy của bạn: AB12C-DE34F',
  'UUID': '550e8400-e29b-41d4-a716-446655440000',
  'văn bản Anh thường': 'The quick brown fox jumps over the lazy dog. Please review the attached report before Friday.',
  'chat Zalo OCR': 'Nguyễn Văn An\nHôm nay họp lúc mấy giờ?\n10:30\nAnh gửi file báo cáo nhé\nĐã xem',
  'bảng số liệu': '2026 2025 2024 2023 2022\n1200 3400 5600 7800 9000\n1111 2222 3333 4444 5555',
};
for (const [k, s] of Object.entries(normal)) test('KHÔNG dương tính giả: ' + k, () => { const r = SG.scan({ text: s }); assert.deepStrictEqual(r, [], k + ' → ' + r.join(',')); });
