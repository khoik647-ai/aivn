'use strict';
// B193 (#60): ảnh chụp các bước AIVN AGENT ghi nguyên tệp mã kích hoạt đang mở trong Notepad ra thư mục shots.
// Mọi mã/khoá trong tệp này là GIẢ, dựng lúc chạy (không có giá trị thật nào trong mã nguồn).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const SG = require('../src/agent/shot-guard'); const Q = require('../src/qa-runner');
const { say } = require('../src/agent/say');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'b193-'));
const FAKE_CODE = Array.from({ length: 6 }, (_, i) => String.fromCharCode(65 + i).repeat(5)).join('-'); // AAAAA-BBBBB-…: đúng dạng mã AIVN, không phải mã thật
const FAKE_TITLE = 'aivn-activation.txt - Notepad';
const MARK = 'ORIGINAL-SCREEN-PIXELS-' + process.pid + '-';

// ảnh giả cùng giao diện với SG.electronImage(): mỗi ảnh mang theo các byte của nó → kiểm được byte gốc có lọt ra đĩa không
const fakeImage = () => ({
  decode: (u) => ({ data: Buffer.from(String(u).split(',')[1], 'base64'), w: 1920, h: 1080 }),
  crop: (img, r) => ({ data: Buffer.concat([Buffer.from(`CROP${r.x},${r.y},${r.width},${r.height}:`), img.data]), w: r.width, h: r.height }),
  size: (img) => ({ width: img.w, height: img.h }),
  blank: (w, h) => ({ data: Buffer.alloc(Math.min(w * h, 4096), 0x80), w, h }),
  jpeg: (img) => Buffer.concat([Buffer.from('JPG'), img.data]),
});
const capture = async () => ({ dataUrl: 'data:image/jpeg;base64,' + Buffer.from(MARK.repeat(50)).toString('base64'), width: 1920, height: 1080, geo: { id: 1, scale: 1, phys: { x: 0, y: 0, width: 1920, height: 1080 } } });

test('scan: tiêu đề / chữ nhạy cảm → chỉ TÊN loại, không có giá trị; chữ thường → trống', () => {
  const r = SG.scan({ title: FAKE_TITLE, text: 'Mã kích hoạt: ' + FAKE_CODE });
  assert.ok(r.includes('title:activation') && r.includes('text:aivn-code') && r.includes('text:activation'), r.join());
  assert.ok(!JSON.stringify(r).includes(FAKE_CODE));
  const sk = 'sk-' + 'x'.repeat(24), gh = 'ghp_' + 'A1b2'.repeat(6), hex = 'ab'.repeat(20);
  assert.ok(SG.scan({ text: sk }).includes('text:sk')); assert.ok(SG.scan({ text: gh }).includes('text:github')); assert.ok(SG.scan({ text: hex }).includes('text:hex'));
  assert.ok(SG.scan({ title: '.env - Notepad' }).includes('title:env')); assert.ok(SG.scan({ title: 'Đăng nhập — mật khẩu' }).includes('title:password'));
  assert.ok(SG.scan({ text: 'API_TOKEN=abc' }).includes('text:env'));
  assert.deepStrictEqual(SG.scan({ title: 'Untitled - Notepad', proc: 'notepad', text: 'Xin chào, khoa học máy tính. C:\\Users\\a\\Documents\\Bao-cao-cuoi-ky-2026-ban-chinh-thuc-v12345.docx' }), []);
  assert.deepStrictEqual(SG.scan({ title: 'Calculator', text: '12 + 30 = 42' }), []);
  // mã thật (src/license.js issueCode) là nhóm 6, không phải nhóm 5 — và cả dạng không gạch
  const fake6 = Array.from({ length: 10 }, (_, i) => 'A1B2C' + String.fromCharCode(68 + (i % 10))).join('-');
  const bare = ('ZM' + 'A1B2C3D4').repeat(8);
  assert.ok(SG.scan({ title: 'Untitled - Notepad', text: 'code: ' + fake6 }).includes('text:aivn-code'), fake6);
  assert.ok(SG.scan({ text: bare }).includes('text:aivn-code'));
  assert.ok(!JSON.stringify(SG.scan({ text: fake6 })).includes(fake6));
  assert.ok(SG.scan({ title: 'license.json - Notepad' }).includes('title:activation'));
  assert.deepStrictEqual(SG.scan({ title: 'LICENSE - Notepad' }), [], 'tệp LICENSE nguồn mở không phải mã kích hoạt');
  assert.ok(SG.scan({ title: 'aivn-admin-key.json - Notepad' }).includes('title:key'));
  assert.deepStrictEqual(SG.screenSecrets({ title: 'Calculator', windows: [{ title: FAKE_TITLE, proc: 'notepad', min: true }] }).reasons, []);
  const bg = SG.screenSecrets({ title: 'Calculator', text: '12 + 30 = 42', windows: [{ title: 'license.json - Notepad', proc: 'notepad' }] });
  assert.ok(bg.reasons.includes('title:activation')); assert.ok(!JSON.stringify(bg.reasons).includes('license'));
});
test('redactSecrets / redactTitles: che mã + tiêu đề, giữ phần còn lại', () => {
  const s = SG.redactSecrets('mã ' + FAKE_CODE + ' xong'); assert.ok(!s.includes(FAKE_CODE)); assert.match(s, /^mã \[đã che\] xong$/);
  const t = SG.redactTitles(`Notepad: đưa cửa sổ “${FAKE_TITLE}” lên trước; window "${FAKE_TITLE}"`, []);
  assert.ok(!t.includes('activation'), t); assert.match(t, /cửa sổ “\[đã che\]”/);
  assert.strictEqual(SG.redactTitles('mở tệp ' + FAKE_TITLE + ' rồi', [FAKE_TITLE]), 'mở tệp [đã che] rồi');
  assert.strictEqual(SG.redactTitles(null), null);
});
test('guardStep (thẻ bước trong app): bỏ ảnh nhỏ, cảnh báo vi/en/zh, che mã + tiêu đề; bước thường không đổi', () => {
  const W = 'đã ẩn ảnh chụp: màn hình có thể chứa mã kích hoạt, mật khẩu hoặc khoá';
  for (const [lang, re] of [['vi', /đã ẩn ảnh chụp/], ['en', /screenshot hidden/], ['zh', /已隐藏截图/]]) {
    const step = { summary: `Notepad: cửa sổ “${FAKE_TITLE}”`, detail: 'thấy ' + FAKE_CODE, thumb: 'data:image/jpeg;base64,AAAA' };
    SG.guardStep(step, { window: { hwnd: 42, pid: 7, proc: 'notepad', title: FAKE_TITLE }, forModel: 'chữ: ' + FAKE_CODE }, { warn: () => say(lang, W) });
    assert.strictEqual(step.thumb, undefined); assert.match(step.summary, re); assert.ok(step.sensitive.includes('title:activation'));
    assert.ok(!JSON.stringify(step).includes(FAKE_CODE)); assert.ok(!step.summary.includes(FAKE_TITLE) && !step.detail.includes(FAKE_CODE));
    assert.strictEqual(step.win.hwnd, 42); assert.strictEqual(step.win.title, FAKE_TITLE, 'tiêu đề gốc chỉ giữ trong bộ nhớ để chụp đúng cửa sổ');
    if (lang !== 'vi') assert.ok(!/đã ẩn/.test(step.summary), 'không lọt tiếng Việt: ' + step.summary);
  }
  const ok = { summary: 'Calculator: đã ở trước', thumb: 'x' }; SG.guardStep(ok, { window: { hwnd: 9, title: 'Calculator' }, forModel: '42' });
  assert.strictEqual(ok.thumb, 'x'); assert.strictEqual(ok.summary, 'Calculator: đã ở trước'); assert.strictEqual(ok.sensitive, undefined);
});
test('agent.js gọi guardStep đúng chỗ (trước logTool / onStep) với khoá dịch có trong en/zh', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/agent.js'), 'utf8');
  assert.match(src, /SG\.guardStep\(step, out, \{ warn: \(\) => say\(LG, 'đã ẩn ảnh chụp[^']*'\)[^}]*\}\);[^\n]*\n\s*logTool\(step\);/);
  assert.match(src, /await onStep\(\{ \.\.\.step \}\)/);
  for (const f of ['en', 'zh']) assert.ok(require('../src/i18n/' + f)['đã ẩn ảnh chụp: màn hình có thể chứa mã kích hoạt, mật khẩu hoặc khoá'], f);
});
test('shot: có cửa sổ đích → chỉ cắt cửa sổ; nhạy cảm → ảnh xám mới, không còn byte gốc; không xử lý ảnh được + nhạy cảm → không ghi gì', async () => {
  const I = fakeImage();
  const w = await SG.shot({ capture, target: { b: [100, 50, 800, 600] }, reasons: [], image: I });
  assert.strictEqual(w.scope, 'window'); assert.deepStrictEqual(w.rect, { x: 100, y: 50, width: 800, height: 600 }); assert.match(w.buf.toString(), /^JPGCROP100,50,800,600:/);
  const sc = await SG.shot({ capture, target: null, reasons: [], image: I }); assert.strictEqual(sc.scope, 'screen'); assert.strictEqual(sc.rect, null);
  const z = await SG.shot({ capture, target: { b: [100, 50, 800, 600] }, reasons: ['title:activation'], image: I });
  assert.ok(z.redacted && z.buf.length > 0); assert.ok(!z.buf.toString('latin1').includes('ORIGINAL'), 'không còn byte nào của ảnh gốc');
  const n = await SG.shot({ capture, target: null, reasons: ['text:aivn-code'], image: null }); assert.strictEqual(n.buf, null); assert.strictEqual(n.skipped, 'sensitive-no-image');
  const raw = await SG.shot({ capture, reasons: [], image: null }); assert.ok(raw.buf.toString().startsWith(MARK));
  assert.strictEqual(SG.rectInShot([0, 0, 10, 10], await capture()), null, 'khung quá nhỏ → chụp cả màn hình');
  assert.deepStrictEqual(SG.rectInShot([1000, 600, 3000, 3000], { width: 960, height: 540, geo: { phys: { x: 0, y: 0, width: 1920, height: 1080 } } }), { x: 500, y: 300, width: 460, height: 240 }, 'thu nhỏ + kẹp trong ảnh');
});
test('prune: chỉ xoá step-*.jpg cũ/vượt dung lượng trong đúng thư mục; bỏ qua symlink, “..”, tệp khác; không xoá thư mục gốc', () => {
  const d = tmp(); const shots = path.join(d, 'shots'); fs.mkdirSync(shots); const outside = path.join(d, 'outside.jpg'); fs.writeFileSync(outside, 'keep');
  const now = Date.now(); const mk = (n, ageH, size = 10) => { const f = path.join(shots, n); fs.writeFileSync(f, Buffer.alloc(size, 1)); const t = (now - ageH * 3600e3) / 1000; fs.utimesSync(f, t, t); return f; };
  const old = mk('step-01-ensure_app.jpg', 30), fresh = mk('step-02-click.jpg', 1), other = mk('notes.txt', 30), dots = mk('step-03-..jpg', 30);
  fs.symlinkSync(outside, path.join(shots, 'step-04-link.jpg')); const t = (now - 40 * 3600e3) / 1000; fs.lutimesSync && fs.lutimesSync(path.join(shots, 'step-04-link.jpg'), t, t);
  fs.mkdirSync(path.join(shots, 'step-05-dir.jpg'));
  const r = SG.prune(shots, { now }); assert.strictEqual(r.removed, 1);
  assert.ok(!fs.existsSync(old)); for (const f of [fresh, other, dots, outside, path.join(shots, 'step-05-dir.jpg')]) assert.ok(fs.existsSync(f), f);
  assert.ok(fs.lstatSync(path.join(shots, 'step-04-link.jpg')).isSymbolicLink()); assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'keep');
  // dung lượng: cũ nhất xoá trước
  const a = mk('step-06-a.jpg', 3, 100), b = mk('step-07-b.jpg', 2, 100); const r2 = SG.prune(shots, { now, maxBytes: 150 });
  assert.ok(!fs.existsSync(a) && fs.existsSync(b), JSON.stringify(r2)); assert.ok(fs.existsSync(shots));
  // thư mục shots là symlink → realpath; '..' trong đường dẫn vẫn về đúng thư mục thật
  const ln = path.join(d, 'shots-link'); fs.symlinkSync(shots, ln); mk('step-08-c.jpg', 50); SG.prune(path.join(ln, '..', 'shots-link'), { now });
  assert.ok(!fs.existsSync(path.join(shots, 'step-08-c.jpg'))); assert.ok(fs.existsSync(outside) && fs.existsSync(ln));
  // không bao giờ làm việc ở gốc / thư mục nhà
  assert.ok(SG.prune('/', { now }).refused); assert.ok(SG.prune(os.homedir(), { now }).refused); assert.ok(SG.prune(path.join(shots, '..', '..', '..', '..', '..', '..', '..'), { now }).refused);
  assert.deepStrictEqual(SG.prune(path.join(d, 'không-có'), { now }), { removed: 0, kept: 0, skipped: 0 });
});

// chạy QA thật (runAgentTurn giả): Notepad đang mở tệp mã kích hoạt GIẢ
async function qaRun({ title, text, windowInfo, image = fakeImage(), steps = null, windows = undefined, ocr = undefined }) {
  const d = tmp(); const shots = path.join(d, 'shots'); const logs = []; let tapFn = null;
  const LOG = { log: (tag, m) => { const l = `[${tag}] ${m}`; logs.push(l); tapFn && tapFn(l); }, tap: (f) => { tapFn = f; return () => { tapFn = null; }; } };
  const win = { hwnd: 42, pid: 7, proc: 'notepad', title };
  const deps = { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], LOG, capture, image, deadlineGraceMs: 500,
    windows: typeof (windows === undefined ? [] : windows) === 'function' ? windows : async () => (windows === undefined ? [] : windows),
    ...(ocr !== undefined ? { ocr } : {}),
    windowInfo: windowInfo === undefined ? async (w) => (w.hwnd === 42 ? { b: [100, 50, 800, 600], title, proc: 'notepad', text } : null) : windowInfo,
    runAgentTurn: async ({ qa }) => {
      for (const st of steps || [{ id: 1, name: 'ensure_app', out: { window: win, summary: `Notepad: cửa sổ “${title}” đã ở trước`, forModel: text } }, { id: 2, name: 'screenshot', out: { summary: 'đã chụp màn hình' } }]) {
        await qa.onStep({ id: st.id, name: st.name, status: 'running' });
        const step = { id: st.id, name: st.name, status: 'ok', summary: st.out.summary }; SG.guardStep(step, st.out);
        LOG.log('agent', `tool ${st.name}: ${step.summary} (cửa sổ “${title}”)`); await qa.onStep({ ...step });
      }
      return { text: 'Xong', outcome: 'done' };
    } };
  const res = await Q.run({ task: 'mở Notepad', out: path.join(d, 'r.json'), timeout: 20, shots }, deps);
  const files = fs.existsSync(shots) ? fs.readdirSync(shots).map(n => path.join(shots, n)) : [];
  return { d, res, files, json: fs.readFileSync(path.join(d, 'r.json'), 'latin1') };
}
test('QA: Notepad mở tệp mã kích hoạt GIẢ → không byte ảnh gốc nào ra đĩa; chỉ ảnh đã che; tiêu đề + mã che trong log/kết quả', async () => {
  const { res, files, json } = await qaRun({ title: FAKE_TITLE, text: 'Mã kích hoạt AIVN\n' + FAKE_CODE });
  assert.strictEqual(res.steps.length, 2); assert.strictEqual(files.length, 2);
  for (const f of files) { const b = fs.readFileSync(f, 'latin1'); assert.ok(!b.includes('ORIGINAL') && !b.includes(MARK.slice(0, 12)), f); }
  for (const s of res.steps) { assert.ok(s.shotRedacted, s.tool); assert.ok(s.shotWarn.includes('title:activation')); assert.strictEqual(s.shotScope.scope, 'window'); assert.ok(s.shotScope.window); }
  assert.ok(res.steps[1].shotWarn.length, 'bước sau trên cùng cửa sổ vẫn bị coi là nhạy cảm');
  assert.ok(!json.includes(FAKE_CODE), 'mã không có trong r.json'); assert.ok(!json.includes(FAKE_TITLE), 'tiêu đề không có trong r.json');
  assert.ok(!json.includes('ORIGINAL'));
  assert.ok(res.log.some(l => /B193: bước 1/.test(l))); assert.ok(res.log.some(l => /\[đã che\]/.test(l)));
});
test('QA: không đọc được khung/chữ cửa sổ nhưng tiêu đề nhạy cảm → vẫn che; không có bộ xử lý ảnh → không ghi ảnh nào', async () => {
  const a = await qaRun({ title: FAKE_TITLE, text: '', windowInfo: null });
  for (const f of a.files) assert.ok(!fs.readFileSync(f, 'latin1').includes('ORIGINAL'), f);
  assert.ok(a.res.steps.every(s => s.shotRedacted && s.shotScope.scope === 'screen'));
  const b = await qaRun({ title: FAKE_TITLE, text: FAKE_CODE, image: null });
  assert.strictEqual(b.files.length, 0, 'không ghi ảnh khi không che được'); assert.ok(b.res.steps.every(s => s.shot === null && /B193/.test(s.shotError)));
  // chữ trên cửa sổ có mã (tiêu đề vô hại) → vẫn che
  const c = await qaRun({ title: 'Untitled - Notepad', text: 'ghi chú\n' + FAKE_CODE });
  assert.ok(c.res.steps.every(s => s.shotRedacted && s.shotWarn.includes('text:aivn-code'))); assert.ok(!c.json.includes(FAKE_CODE));
});
test('dropShotPixels: ảnh đã chụp mất data URL ngay tại chỗ, không còn mã', () => {
  const fake6 = Array.from({ length: 10 }, (_, i) => 'A1B2C' + String.fromCharCode(68 + (i % 10))).join('-');
  const shot = { dataUrl: 'data:image/jpeg;base64,' + Buffer.from(MARK + fake6).toString('base64'), width: 20, height: 10, thumb: MARK };
  SG.dropShotPixels(shot);
  assert.strictEqual(shot.dataUrl, null); assert.strictEqual(shot.thumb, null); assert.ok(shot.redacted);
  assert.ok(!JSON.stringify(shot).includes(fake6) && !JSON.stringify(shot).includes('ORIGINAL'));
});
test('guardStep: cửa sổ mã kích hoạt đang mở (kể cả không phải đích) → bỏ ảnh, không chép giá trị vào lý do', () => {
  const fake6 = Array.from({ length: 10 }, (_, i) => 'A1B2C' + String.fromCharCode(68 + (i % 10))).join('-');
  const out = { summary: 'Calculator: đã ở trước', forModel: '12 + 30 = 42', thumb: IMG, sensitive: ['title:activation', fake6] };
  const step = { summary: 'Calculator: đã ở trước', thumb: IMG };
  SG.guardStep(step, out, { warn: () => 'đã ẩn ảnh chụp' });
  assert.ok(!('thumb' in step)); assert.strictEqual(out.thumb, null); assert.match(step.summary, /đã ẩn ảnh chụp/);
  assert.deepStrictEqual(step.sensitive, ['title:activation']);
  assert.ok(!JSON.stringify(step).includes(fake6) && !JSON.stringify(step).includes('ORIGINAL'));
});
test('QA: tệp mã kích hoạt đang mở ở cửa sổ khác → ảnh bước không chứa điểm ảnh gốc', async () => {
  const { res, files, json } = await qaRun({ title: 'Calculator', text: '12 + 30 = 42', windows: [{ title: 'license.json - Notepad', proc: 'notepad' }, { title: 'Calculator', proc: 'calc' }] });
  assert.ok(files.length >= 1);
  for (const f of files) { const b = fs.readFileSync(f, 'latin1'); assert.ok(!b.includes('ORIGINAL') && !b.includes(MARK.slice(0, 12)), f); }
  assert.ok(res.steps.every(s => s.shotRedacted && s.shotWarn.includes('title:activation')));
  assert.ok(!json.includes('license.json') && !json.includes('ORIGINAL'));
});
test('QA: ảnh đã ghi trong lượt này bị xoá khi sau đó mới thấy tệp mã kích hoạt', async () => {
  // Mỗi bước đọc cửa sổ hai lần (trước và sau khi chụp). Bước 1 không có cửa sổ đang hiện;
  // OCR sạch thì ảnh gốc mới được ghi, rồi bước 2 thấy mã và xoá ảnh đó.
  let n = 0; const windows = async () => (++n <= 2 ? [] : [{ title: FAKE_TITLE, proc: 'notepad' }]);
  const { res, files, json } = await qaRun({ title: 'Calculator', text: '12 + 30 = 42', windows, ocr: async () => '12 + 30 = 42', steps: [{ id: 1, name: 'screenshot', out: { summary: 'đã chụp màn hình' } }, { id: 2, name: 'screenshot', out: { summary: 'đã chụp màn hình' } }] });
  assert.strictEqual(res.steps[0].shot, null); assert.ok(res.steps[0].shotPurged);
  assert.ok(res.steps[1].shotRedacted);
  for (const f of files) assert.ok(!fs.readFileSync(f, 'latin1').includes('ORIGINAL'), f);
  assert.ok(!json.includes(FAKE_TITLE) && !json.includes(FAKE_CODE) && !json.includes('ORIGINAL'));
});
test('QA: tệp mã kích hoạt đang thu nhỏ (không nằm trên màn hình) → ảnh cửa sổ thường vẫn giữ', async () => {
  // Không còn cửa sổ đang hiện vẫn phải OCR. Ảnh chỉ được giữ khi OCR trả chữ sạch.
  const { res, files } = await qaRun({ title: 'Calculator', text: '12 + 30 = 42', windows: [{ title: FAKE_TITLE, proc: 'notepad', min: true }], ocr: async () => '12 + 30 = 42' });
  assert.ok(res.steps.every(s => !s.shotRedacted && s.shotScope.scope === 'window'));
  assert.match(fs.readFileSync(files[0], 'latin1'), /^JPGCROP100,50,800,600:/);
});
test('forgetShots: không đi theo symlink ra ngoài thư mục shots, không đụng thư mục gốc', () => {
  const d = tmp(); const shots = path.join(d, 'shots'); fs.mkdirSync(shots);
  const outside = path.join(d, 'secret.jpg'); fs.writeFileSync(outside, MARK + FAKE_CODE);
  fs.symlinkSync(outside, path.join(shots, 'step-01-link.jpg'));
  const linkStep = { shot: path.join(shots, 'step-01-link.jpg') };
  assert.strictEqual(SG.forgetShots([linkStep], shots).removed, 0);
  assert.strictEqual(fs.readFileSync(outside, 'utf8'), MARK + FAKE_CODE);
  assert.ok(fs.lstatSync(path.join(shots, 'step-01-link.jpg')).isSymbolicLink());
  const kept = path.join(shots, 'step-02-click.jpg'); fs.writeFileSync(kept, 'ok');
  assert.ok(SG.forgetShots([{ shot: kept }], '/').refused);
  assert.strictEqual(fs.readFileSync(kept, 'utf8'), 'ok');
  const dot = path.join(shots, 'step-03-..jpg'); fs.writeFileSync(dot, 'x');
  assert.strictEqual(SG.forgetShots([{ shot: dot }], shots).removed, 0); assert.ok(fs.existsSync(dot));
});
test('desktop-agent: quét và xoá điểm ảnh trước khi gửi cho mắt nhìn hoặc thẻ xin phép', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/desktop-agent.js'), 'utf8');
  const seal = src.indexOf('sealShot('); const desc = src.indexOf('SC.describe');
  assert.ok(seal > 0 && seal < desc, 'phải quét trước khi gửi ảnh cho mô hình nhìn');
  assert.match(src, /dropShotPixels\(shot\)/); assert.match(src, /shotOk/);
  assert.match(src, /const ShotGuard = require\('\.\/agent\/shot-guard'\)/);
  assert.match(src, /const SendGate = require\('\.\/agent\/send-gate'\)/);
  assert.ok(!/const SG = require\('\.\/agent\/send-gate'\)/.test(src), 'SG của send-gate không được che ShotGuard');
});
test('QA: cửa sổ thường → chỉ chụp khung cửa sổ đích (ghi rõ phạm vi), bước không có đích → cả màn hình như trước', async () => {
  // Danh sách cửa sổ rỗng vẫn OCR. Giữ ảnh cắt chỉ khi OCR trả chữ sạch.
  const ocr = async () => '12 + 30 = 42';
  const { res, files } = await qaRun({ title: 'Calculator', text: '12 + 30 = 42', ocr });
  assert.strictEqual(files.length, 2); assert.ok(res.steps.every(s => !s.shotRedacted && s.shotScope.scope === 'window'));
  assert.deepStrictEqual(res.steps[0].shotScope.rect, { x: 100, y: 50, width: 800, height: 600 }); assert.match(fs.readFileSync(files[0], 'latin1'), /^JPGCROP100,50,800,600:/);
  const n = await qaRun({ title: 'x', text: '', ocr, steps: [{ id: 1, name: 'web_search', out: { summary: 'tìm xong' } }] });
  assert.strictEqual(n.res.steps[0].shotScope.scope, 'screen'); assert.strictEqual(n.res.steps[0].shotScope.window, false);
  assert.ok(fs.readFileSync(n.files[0], 'latin1').startsWith('JPG' + MARK));
});
test('reveal: liệt kê cửa sổ quá hạn → failed, không trả “không thấy gì”', async () => {
  const r = await SG.reveal({ title: 'Calculator', text: '42', loadWindows: () => new Promise(() => {}), timeoutMs: 40 });
  assert.strictEqual(r.failed, true); assert.deepStrictEqual(r.reasons, ['text:unreadable']); assert.deepStrictEqual(r.titles, []);
  await assert.rejects(() => SG.fillWindowText([{ title: 'notes.txt - Notepad', proc: 'notepad' }], () => new Promise(() => {}), { timeoutMs: 40 }));
});
test('QA: liệt kê cửa sổ không trả lời trong 8 giây → không ghi ảnh gốc', { timeout: 20000 }, async () => {
  const { files, res } = await qaRun({ title: 'Calculator', text: '12 + 30 = 42', windows: () => new Promise(() => {}), steps: [{ id: 1, name: 'screenshot', out: { summary: 'đã chụp màn hình' } }] });
  for (const f of files) assert.ok(!fs.readFileSync(f, 'latin1').includes('ORIGINAL'), f);
  assert.ok(res.steps.every(s => s.shotRedacted && s.shotWarn.includes('text:unreadable')));
});
test('QA: ảnh cũ hơn 24 giờ trong thư mục shots bị dọn lúc bắt đầu', async () => {
  const d = tmp(); const shots = path.join(d, 'shots'); fs.mkdirSync(shots); const f = path.join(shots, 'step-01-old.jpg'); fs.writeFileSync(f, 'x'); const t = (Date.now() - 48 * 3600e3) / 1000; fs.utimesSync(f, t, t);
  const deps = { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], LOG: { log: () => {}, tap: () => () => {} }, capture, image: fakeImage(), windowInfo: null,
    runAgentTurn: async () => ({ text: 'Xong', outcome: 'done' }) };
  const res = await Q.run({ task: 'x', out: path.join(d, 'r.json'), timeout: 5, shots }, deps);
  assert.strictEqual(res.shotsPruned, 1); assert.ok(!fs.existsSync(f)); assert.ok(fs.existsSync(shots));
});

// agent.js: bước nhạy cảm trả về (r.steps / onStep) KHÔNG còn trường ảnh nào → main.js slimStep không có gì để lưu vào cuộc trò chuyện
function mkAgent(ensureOut, lookOut) {
  const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools'); const { createMemoryStore } = require('../src/agent/memory');
  const r0 = tmp(); let model = 0;
  const engine = { status: () => ({ loaded: true, vision: true, contextSize: 8192 }), chatStep: async () => (++model === 1 ? { text: '', toolCalls: [{ id: 'c1', name: 'screen_look', arguments: {} }], finishReason: 'tool_calls', usage: {} } : { text: 'Xong.', toolCalls: [], finishReason: 'stop', usage: {} }) };
  const names = ['open_app', 'screen_look', 'screen_act']; const defs = Object.fromEntries([...names, 'ensure_app'].map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n) => (n === 'ensure_app' ? ensureOut : n === 'screen_look' ? lookOut : { forModel: 'ok', summary: 'ok' }) };
  return AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: true, agentComputer: true, agentScreen: true, uiLang: 'vi' }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
}
const IMG = 'data:image/jpeg;base64,' + Buffer.from(MARK.repeat(20)).toString('base64');
const imageFields = (st) => Object.entries(st).filter(([k, v]) => /thumb|image|img|shot|png|jpe?g/i.test(k) && v != null || (typeof v === 'string' && (/^data:image\//.test(v) || v.includes(IMG.slice(23, 60)))));
test('agent: bước ensure_app tự chạy + bước screen_look trên cửa sổ mã kích hoạt → không trường ảnh nào, không mã, có cảnh báo', async () => {
  const win = { hwnd: 42, pid: 7, proc: 'notepad', title: FAKE_TITLE };
  const agent = mkAgent({ forModel: 'Google Docs sẵn sàng. Chữ thấy: ' + FAKE_CODE, summary: `Google Docs: cửa sổ “${FAKE_TITLE}”`, window: win, thumb: IMG },
    { forModel: 'Màn hình: Mã kích hoạt ' + FAKE_CODE, summary: 'đã nhìn màn hình', thumb: IMG, window: win });
  const seen = []; const r = await agent.run({ messages: [{ role: 'user', content: 'viết đoạn giới thiệu trên Google Docs' }], confirm: async () => false, onStep: (s) => seen.push(s) });
  const ens = r.steps.find(s => s.name === 'ensure_app'); const look = r.steps.find(s => s.name === 'screen_look');
  assert.ok(ens && ens.auto && look, JSON.stringify(r.steps.map(s => s.name)));
  for (const st of [ens, look, ...seen.filter(s => s.status !== 'running')]) {
    assert.deepStrictEqual(imageFields(st), [], st.name + ': không được còn trường ảnh'); assert.ok(!('thumb' in st), st.name + ': không có cả khoá thumb');
    assert.ok(st.sensitive && st.sensitive.length, st.name); assert.match(st.summary, /đã ẩn ảnh chụp/);
    assert.ok(!JSON.stringify(st).includes(FAKE_CODE), st.name + ': không lộ mã'); assert.ok(!String(st.summary).includes(FAKE_TITLE), st.name + ': tiêu đề đã che');
  }
  // bước thường vẫn giữ ảnh nhỏ như trước
  const ok = mkAgent({ forModel: 'Google Docs sẵn sàng', summary: 'Google Docs: đã ở trước', window: { hwnd: 9, title: 'Tài liệu không có tiêu đề - Google Docs' } }, { forModel: 'Màn hình: trang trắng', summary: 'đã nhìn màn hình', thumb: IMG });
  const r2 = await ok.run({ messages: [{ role: 'user', content: 'viết đoạn giới thiệu trên Google Docs' }], confirm: async () => false });
  assert.strictEqual(r2.steps.find(s => s.name === 'screen_look').thumb, IMG);
});
