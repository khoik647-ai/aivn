'use strict';
// 0.16 — tệp âm thanh/video đính kèm: bộ nghe Whisper (transformers.js, WebGPU/WASM) trong cửa sổ ẩn, khung hình + chữ trên hình (OCR)
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const M = require('../src/media');
const ROOT = path.join(__dirname, '..');

test('bản chép lời: tiêu đề, mốc thời gian gộp đoạn, video không tiếng, chữ trên hình, cắt 2 giờ', () => {
  const r = { kind: 'audio', duration: 75.4, segments: [{ start: 0, end: 3, text: 'Xin chào cả lớp.' }, { start: 4, end: 8, text: 'Hôm nay học chương 2.' }, { start: 31, end: 35, text: 'Bài tập về nhà.' }] };
  const t = M.transcriptText('bai.mp3', r);
  assert.match(t, /^\[Bản chép lời âm thanh "bai\.mp3" · dài 1:15 · AIVN tự chép lời trên máy/);
  assert.match(t, /\[0:00\] Xin chào cả lớp\. Hôm nay học chương 2\.\n\[0:31\] Bài tập về nhà\./);
  assert.match(M.transcriptText('v.webm', { kind: 'video', segments: [], noAudio: true }), /\[Video không có tiếng\]/);
  assert.match(M.transcriptText('n.mp3', { kind: 'audio', segments: [] }), /Không nghe thấy lời nói nào/);
  assert.match(M.transcriptText('d.mp3', { ...r, truncated: true }), /chỉ chép lời 2 giờ đầu/);
  const v = M.transcriptText('v.mp4', { kind: 'video', duration: 3725, segments: [{ start: 3600, end: 3605, text: 'Hết giờ.' }] }, { ocr: [{ at: 12, text: 'KẾ HOẠCH HỌC KỲ 2' }] });
  assert.match(v, /dài 1:02:05/); assert.match(v, /\[1:00:00\] Hết giờ\./); assert.match(v, /\[Chữ trên hình ở 0:12\]\nKẾ HOẠCH HỌC KỲ 2/);
});
test('chữ trên hình: bỏ trùng giữa các khung hình (slide đứng yên), bỏ mẩu quá ngắn', () => {
  const d = M.dedupeOcr([{ at: 1, text: 'Chương 2: Mạng nơ-ron' }, { at: 5, text: 'Chương 2:  Mạng nơ-ron ' }, { at: 9, text: 'ab' }, { at: 12, text: 'Chương 3: Học sâu' }]);
  assert.deepStrictEqual(d.map(x => x.at), [1, 12]);
});
test('loại tệp, mô hình ghim theo commit (đủ 7 tệp, kích thước), URL tải không dùng "main"', () => {
  assert.strictEqual(M.avKind('/a/b.MP3'), 'audio'); assert.strictEqual(M.avKind('x.mov'), 'video'); assert.strictEqual(M.avKind('x.pdf'), null);
  assert.strictEqual(M.ASR.files.length, 7); assert.ok(M.ASR.files.every(f => f.size > 0)); assert.ok(M.ASR.size > 700e6 && M.ASR.size < 800e6);
  assert.match(M.ASR.rev, /^[0-9a-f]{40}$/);
  const u = M.resolveAsrUrl(M.ASR.repo, 'onnx/encoder_model_q4.onnx'); assert.ok(u.includes('/resolve/' + M.ASR.rev + '/onnx/encoder_model_q4.onnx')); assert.ok(!u.includes('/resolve/main/'));
  // tên tệp trên đĩa = cách downloader đặt tên (bỏ thư mục con onnx/)
  const names = M.ASR.files.map(f => f.path.split('/').pop()); assert.strictEqual(new Set(names).size, 7);
});
test('đóng gói: bộ nghe tạo bằng build/media-bundle.cjs (không đưa .wasm lên git), release.sh chạy bước này, phiên bản onnxruntime-web khớp transformers', () => {
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^src\/media\/vendor\/$/m);
  assert.match(fs.readFileSync(path.join(ROOT, 'release.sh'), 'utf8'), /node build\/media-bundle\.cjs/);
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.includes('src/**/*'));
  assert.strictEqual(pkg.devDependencies['onnxruntime-web'], JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@huggingface/transformers/package.json'), 'utf8')).dependencies['onnxruntime-web']);
  assert.ok(!pkg.dependencies['onnxruntime-node'] && !pkg.dependencies['@huggingface/transformers'], 'không kéo onnxruntime-node/sharp (hàng trăm MB) vào bản cài');
  const html = fs.readFileSync(path.join(ROOT, 'src/media/worker.html'), 'utf8');
  assert.match(html, /Content-Security-Policy/); assert.doesNotMatch(html, /https?:/, 'bộ nghe không tải gì từ mạng');
  const w = fs.readFileSync(path.join(ROOT, 'src/media/worker.mjs'), 'utf8'); assert.match(w, /allowRemoteModels = false/);
});

const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron'));
const vendor = fs.existsSync(path.join(ROOT, 'src/media/vendor/asr-bundle.mjs'));
const run = (env) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qamedia-'));
  const r = spawnSync('timeout', ['900', 'xvfb-run', '-a', '-s', '-screen 0 1366x860x24', path.join(ROOT, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_MEDIA: dir, ...env } });
  const f = path.join(dir, 'qamedia.json'); assert.ok(fs.existsSync(f), 'QA âm thanh/video không chạy xong: ' + (r.stderr || '').slice(-800));
  const d = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(!d.error, d.error); return d;
};
test('giao diện thật: chưa có bộ nghe → hỏi tải (dung lượng, chạy trên máy), "Để sau" bỏ tệp', { skip: (!hasX && 'cần xvfb-run + electron') || (!vendor && 'chưa chạy build/media-bundle.cjs') }, () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qamedia-ud-'));
  const d = run({ AIVN_USER_DATA: ud, AIVN_QA_MEDIA_NOASR: '1', AIVN_QA_MEDIA_FILES: path.join(__dirname, 'fixtures/media/im-lang.webm') });
  assert.strictEqual(d.installed, false); assert.ok(d.modalShown);
  assert.strictEqual(d.modal.title, 'Tải bộ nghe để chép lời âm thanh/video?'); assert.match(d.modal.msg, /"im-lang\.webm".*Whisper \(72\d\.\d MB, chỉ tải một lần\).*không gửi tệp đi đâu/);
  assert.strictEqual(d.modal.ok, 'Tải bộ nghe'); assert.strictEqual(d.modal.no, 'Để sau'); assert.match(d.modal.chip, /chờ tải bộ nghe/);
  assert.strictEqual(d.chipsAfterNo, 0);
});
// Chép lời thật cần mô hình (~760 MB) và mẫu tiếng nói (VIVOS, LibriSpeech — không đưa vào repo vì giấy phép):
// AIVN_ASR_DIR=<thư mục có 7 tệp mô hình>, AIVN_ASR_SAMPLES=<thư mục có ghi-am.mp3, bai-giang.mp4, en.flac>
const ASR_DIR = process.env.AIVN_ASR_DIR || '/workspace/asr-proto/cache/onnx-community/whisper-large-v3-turbo';
const SAMPLES = process.env.AIVN_ASR_SAMPLES || '/workspace/asr-proto/fixtures';
const haveAsr = fs.existsSync(path.join(ASR_DIR, 'onnx/encoder_model_q4.onnx')) || fs.existsSync(path.join(ASR_DIR, 'encoder_model_q4.onnx'));
const haveSamples = ['ghi-am.mp3', 'bai-giang.mp4', 'en.flac'].every(f => fs.existsSync(path.join(SAMPLES, f)));
test('giao diện thật, mô hình thật: MP3 tiếng Việt, FLAC tiếng Anh (tự nhận ngôn ngữ, không dịch), MP4 có chữ trên hình, WEBM không tiếng; AIVN AGENT đọc cùng đường', { skip: (!hasX && 'cần xvfb-run + electron') || (!vendor && 'chưa chạy build/media-bundle.cjs') || (!haveAsr && 'không có mô hình Whisper (AIVN_ASR_DIR)') || (!haveSamples && 'không có mẫu tiếng nói (AIVN_ASR_SAMPLES)') }, () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qamedia-ud-')); const md = path.join(ud, 'models', 'onnx-community', 'whisper-large-v3-turbo'); fs.mkdirSync(md, { recursive: true });
  for (const f of M.ASR.files) { const src = [path.join(ASR_DIR, f.path), path.join(ASR_DIR, f.path.split('/').pop())].find(p => fs.existsSync(p)); fs.symlinkSync(src, path.join(md, f.path.split('/').pop())); }
  const files = [path.join(SAMPLES, 'ghi-am.mp3'), path.join(SAMPLES, 'en.flac'), path.join(SAMPLES, 'bai-giang.mp4'), path.join(__dirname, 'fixtures/media/im-lang.webm')];
  const d = run({ AIVN_USER_DATA: ud, AIVN_QA_MEDIA_FILES: files.join(path.delimiter) });
  assert.deepStrictEqual(d.errs, []); assert.deepStrictEqual(d.toasts, []);
  const by = Object.fromEntries(d.items.map(i => [i.name, i])); assert.strictEqual(d.items.length, 4); assert.ok(d.items.every(i => i.ok));
  assert.strictEqual(by['ghi-am.mp3'].kind, 'audio'); assert.ok(Math.abs(by['ghi-am.mp3'].duration - 20.6) < 0.5);
  assert.match(by['ghi-am.mp3'].text, /Có nhiều người tôi còn nhớ được cả tên/); assert.match(by['ghi-am.mp3'].text, /mảnh đất màu mỡ cho hoạt động sáng tạo/);
  assert.match(by['en.flac'].text, /Concord returned to its place amidst the tents/i);
  assert.strictEqual(by['bai-giang.mp4'].kind, 'video'); assert.match(by['bai-giang.mp4'].text, /\[Chữ trên hình ở 0:0\d\]\nKẾ HOẠCH HỌC KỲ 2/); assert.match(by['bai-giang.mp4'].text, /Ngân sách 1\.766\.000 đồng/);
  assert.match(by['im-lang.webm'].text, /\[Video không có tiếng\]/); assert.strictEqual(by['im-lang.webm'].duration, 3);
  assert.ok(d.labels.some(l => /chép lời %/.test(l)), 'chip hiện tiến độ chép lời: ' + d.labels.join(' | '));
  assert.strictEqual(d.agentRead.kind, 'audio'); assert.match(d.agentRead.head, /^\[Bản chép lời âm thanh "ghi-am\.mp3"/);
  const v = d.direct.find(x => x.name === 'bai-giang.mp4'); assert.strictEqual(v.frames, 6); assert.strictEqual(v.detected, 'vi'); assert.strictEqual(v.frameError, null);
});
