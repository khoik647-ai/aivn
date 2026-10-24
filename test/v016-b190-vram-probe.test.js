'use strict';
// B190: VRAM trống thật, đo tốc độ sau khi nạp, câu lỗi đếm đúng số lần thử, và #102 (ngữ cảnh huấn luyện, logits, nhãn tràn, regex phi).
const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/vram-query');
const G = require('../src/gguf');
const F = require('../src/fit');
const S = require('../src/gpu-speed');
const LF = require('../src/load-fail');
const L = require('../src/load-notice');
const CORE = require('../src/i18n/core');
const en = require('../src/i18n/en');
const zh = require('../src/i18n/zh');
const T = CORE.create({ en, zh });
const catalog = require('../src/catalog');

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const byId = (id) => catalog.find((c) => c.id === id);

test('nvidia-smi: đường dẫn đầy đủ, PATH chỉ khi các đường đã biết lỗi', async () => {
  const linux = V.nvidiaSmiCandidates('linux', {});
  assert.strictEqual(linux[0], '/usr/bin/nvidia-smi');
  assert.strictEqual(linux[linux.length - 1], 'nvidia-smi');
  const win = V.nvidiaSmiCandidates('win32', { SystemRoot: 'D:\\Windows' });
  assert.strictEqual(win[0], 'D:\\Windows\\System32\\nvidia-smi.exe');
  assert.strictEqual(win[1], 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe');
  assert.strictEqual(win[win.length - 1], 'nvidia-smi');
  const cmds = [];
  const rows = await V.queryNvidiaSmi({
    timeoutMs: 200,
    candidates: ['/usr/bin/nvidia-smi', 'nvidia-smi'],
    execFile: (cmd, args, opts, cb) => {
      cmds.push(cmd);
      if (cmd === '/usr/bin/nvidia-smi') cb(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      else cb(null, '1000, 4096\n');
    },
  });
  assert.deepStrictEqual(cmds, ['/usr/bin/nvidia-smi', 'nvidia-smi']);
  assert.strictEqual(rows[0].freeBytes, 1000 * MiB);
  const first = [];
  await V.queryNvidiaSmi({
    timeoutMs: 200,
    execFile: (cmd, _a, _o, cb) => { first.push(cmd); cb(null, '2048, 4096\n'); },
  });
  assert.notStrictEqual(first[0], 'nvidia-smi', 'vẫn gọi nvidia-smi qua PATH trước');
  if (process.platform === 'linux') assert.strictEqual(first[0], '/usr/bin/nvidia-smi');
  if (process.platform === 'win32') assert.match(first[0], /nvidia-smi\.exe$/i);
});

test('nvidia-smi: đọc memory.free và chọn đúng GPU theo tổng VRAM', () => {
  const rows = V.parseNvidiaSmi(' 3320, 4096\n512, 512\n');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].freeBytes, 3320 * MiB);
  const row = V.pickNvidiaRow(rows, 4096 * MiB);
  assert.strictEqual(row.freeBytes, 3320 * MiB);
  assert.strictEqual(V.pickNvidiaRow(V.parseNvidiaSmi('nope'), 4096 * MiB), null);
});

test('VRAM trống: nvidia-smi thắng Vulkan trên máy lẫn GPU; không đo được thì dùng tổng', async () => {
  const mixed = V.resolveVram({ total: 4 * GiB, reportedFree: 3.55 * GiB, mixed: true }, { freeBytes: 0.7 * GiB });
  assert.strictEqual(mixed.freeKnown, true);
  assert.strictEqual(mixed.freeSource, 'nvidia-smi');
  assert.ok(Math.abs(mixed.free - 0.7 * GiB) < 1);
  const unknown = V.resolveVram({ total: 4 * GiB, reportedFree: 3.55 * GiB, mixed: true }, null);
  assert.strictEqual(unknown.freeKnown, false);
  assert.strictEqual(unknown.freeSource, 'total');
  assert.strictEqual(unknown.free, 4 * GiB);
  const discrete = V.resolveVram({ total: 8 * GiB, reportedFree: 6 * GiB, mixed: false }, null);
  assert.strictEqual(discrete.freeKnown, true);
  assert.strictEqual(discrete.freeSource, 'vulkan');
  assert.strictEqual(discrete.free, 6 * GiB);
  assert.match(V.UNKNOWN_FREE_LOG, /tạm tính theo tổng VRAM/);
  const prev = process.env.AIVN_VRAM_LIMIT;
  process.env.AIVN_VRAM_LIMIT = String(4 * GiB);
  const logs = [];
  const orig = console.log;
  console.log = (...a) => { logs.push(a.map(String).join(' ')); };
  try {
    const E = require('../src/engine');
    const info = await E.vramInfo({
      gpu: 'vulkan',
      getVramState: async () => ({ total: 12 * GiB, free: 10 * GiB, unifiedSize: 8 * GiB }),
    });
    assert.strictEqual(info.freeKnown, false);
    assert.strictEqual(info.freeSource, 'total');
    assert.strictEqual(info.free, 4 * GiB);
    assert.ok(logs.some((l) => l.includes('tạm tính theo tổng VRAM')), logs.join('\n') || '(không có nhật ký)');
  } finally {
    console.log = orig;
    if (prev == null) delete process.env.AIVN_VRAM_LIMIT;
    else process.env.AIVN_VRAM_LIMIT = prev;
  }
});

test('3B trên 4 GB mà chỉ còn 0,7 GB trống thì không còn 37/37 lớp', () => {
  const model = { fileSize: 1.88 * GiB, layers: 28, kvPerToken: 28 * 8 * 128 * 2 * 2 };
  const tight = G.chooseOffload(model, { ctx: 4096, vram: { total: 4 * GiB, free: 0.7 * GiB, freeKnown: true } });
  assert.ok(tight.gpuLayers < 29, 'nhận ' + tight.gpuLayers);
  const unknown = G.chooseOffload(model, { ctx: 4096, vram: { total: 4 * GiB, free: 0.7 * GiB, freeKnown: false } });
  const totalOnly = G.chooseOffload(model, { ctx: 4096, vram: { total: 4 * GiB } });
  assert.strictEqual(unknown.gpuLayers, totalOnly.gpuLayers);
  assert.strictEqual(unknown.gpuLayers, 29);
});

test('đo tốc độ: 22 token/giây trên 3B là tràn, 72 thì không; tốc độ tốt thì không bước vì VRAM kẹt', () => {
  const exp = S.expectedTps({ bytes: 2e9, gpuFrac: 1, gpuBw: 192 });
  assert.ok(exp > 55 && exp < 70, String(exp));
  assert.strictEqual(S.shouldStepDown({ tps: 22, expected: exp, tokens: 24 }).step, true);
  assert.strictEqual(S.shouldStepDown({ tps: 26, expected: exp, tokens: 24 }).step, true);
  assert.strictEqual(S.shouldStepDown({ tps: 72, expected: exp, tokens: 24 }).step, false);
  assert.strictEqual(S.shouldStepDown({ tps: 10, expected: exp, tokens: 3 }).reason, 'inconclusive');
  assert.strictEqual(S.shouldStepDown({ tps: 72, expected: exp, tokens: 24, freeBytes: 10 * MiB }).step, false);
  assert.strictEqual(S.shouldStepDown({ tps: 72, expected: exp, tokens: 24, freeBytes: 10 * MiB }).reason, 'ok');
  assert.strictEqual(S.shouldStepDown({ tps: 10, expected: exp, tokens: 3, freeBytes: 10 * MiB }).reason, 'vram');
  assert.strictEqual(S.probeWindow(0), S.PROBE_EACH_MS);
  assert.ok(S.probeWindow(S.PROBE_EACH_MS) < S.PROBE_EACH_MS);
  assert.strictEqual(S.probeWindow(S.PROBE_TOTAL_MS), 0);
  assert.ok(S.PROBE_TOTAL_MS < S.PROBE_EACH_MS * 3);
});

test('câu lỗi: số cách, danh sách và số lần nạp là một', () => {
  const attempts = [
    { mode: 'gpu (29 lớp GPU, ngữ cảnh 8192)', message: 'Failed to load model' },
    { mode: 'cpu-only (0 lớp GPU, ngữ cảnh 8192)', message: 'Failed to load model' },
  ];
  const s = LF.failureText('broken.gguf', attempts, 'Failed to load model');
  assert.match(s, /đã thử 2 cách: GPU, CPU/);
  assert.doesNotMatch(s, /GPU một phần/);
  assert.strictEqual(LF.isMemoryError('Failed to load model'), false);
  assert.strictEqual(LF.isMemoryError('ErrorOutOfDeviceMemory'), true);
  assert.strictEqual(LF.wantsCpuLadder(attempts), false);
  assert.strictEqual(LF.wantsCpuLadder([{ mode: 'gpu (37 lớp GPU, ngữ cảnh 4096)', message: 'out of memory' }]), true);
  const ctxRetry = [{ mode: 'gpu FA auto', message: 'out of memory', context: true }, { mode: 'gpu (29 lớp GPU, ngữ cảnh 8192)', message: 'Failed to load model' }];
  assert.deepStrictEqual(LF.waysOf(ctxRetry), ['GPU']);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: false }), false);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true }), true);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: [{ mode: 'gpu (29 lớp GPU, ngữ cảnh 4096)', message: 'chậm: 16 token/giây', slow: true }] }), false);
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: false, attempts }), false, 'mọi cách đều lỗi thì không ghi tắt GPU');
  assert.doesNotMatch(s, /GPU, GPU một phần, CPU/);
});

test('thông báo chậm có bản en/zh, không sót tiếng Việt', () => {
  const cpu = { mode: 'cpu-only', contextSize: 4096, slow: { tps: 22, expected: 61 } };
  const partial = { mode: 'gpu-partial', gpuLayers: 21, totalLayers: 29, contextSize: 4096, slow: { tps: 22, expected: 61 } };
  assert.match(L.loadNotice(cpu), /GPU chạy quá chậm \(22 token\/giây, mức khoảng 61\), AIVN đã chuyển sang CPU \(không dùng GPU\), ngữ cảnh 4\.096/);
  const enCpu = L.loadNotice(cpu, (s) => T.tr(s, 'en'), 'en');
  const zhCpu = L.loadNotice(cpu, (s) => T.tr(s, 'zh'), 'zh');
  assert.doesNotMatch(enCpu, VI, enCpu);
  assert.doesNotMatch(zhCpu, VI, zhCpu);
  assert.match(enCpu, /22/);
  assert.match(enCpu, /CPU \(no GPU\)/);
  const enPart = L.loadNotice(partial, (s) => T.tr(s, 'en'), 'en');
  assert.doesNotMatch(enPart, VI, enPart);
  assert.match(enPart, /21\/29 layers on GPU/);
  const pinch = { mode: 'gpu-partial', gpuLayers: 21, totalLayers: 29, contextSize: 4096, slow: { reason: 'vram' } };
  const enPinch = L.loadNotice(pinch, (s) => T.tr(s, 'en'), 'en');
  assert.doesNotMatch(enPinch, VI, enPinch);
});

test('#102: không gắn phi vào delphi, sophia, dolphin; vẫn nhận phi-3 và phi-4', () => {
  for (const id of ['delphi', 'sophia-7b', 'dolphin-2.9']) {
    const g = F.resolveGeo({ id, params: '7B', size: 4e9 });
    assert.strictEqual(g.layers, 0, id);
    assert.notStrictEqual(g.vocab, 32064, id);
  }
  assert.strictEqual(F.resolveGeo({ id: 'phi-3.5-mini', params: '4B', size: 2e9 }).kvHeads, 32);
  assert.strictEqual(F.resolveGeo({ id: 'phi-4-mini-instruct', params: '4B', size: 2e9 }).vocab, 200064);
  assert.strictEqual(F.resolveGeo({ id: 'microsoft_phi-4', params: '14B', size: 9e9 }).layers, 40);
  assert.ok(F.resolveGeo({ arch: 'phi3', params: '4B', size: 2e9 }).layers > 0);
});

test('#102: logits của Llama 3 và Gemma 3 nằm trong bộ đệm; ngữ cảnh không vượt trainCtx', () => {
  const llama = F.resolveGeo(F.metaOf({ catalog: byId('llama-3.2-3b-instruct-q4_k_m') }));
  assert.strictEqual(llama.vocab, 128256);
  assert.strictEqual(llama.trainCtx, 131072);
  const llamaLogits = F.computeBuf(8192, llama.layers, llama.vocab) - F.computeBuf(8192, llama.layers, 0);
  assert.ok(llamaLogits > 190 * MiB, (llamaLogits / MiB).toFixed(1));
  const gemma = F.resolveGeo(F.metaOf({ catalog: byId('gemma-3-4b-it-q4_k_m') }));
  assert.strictEqual(gemma.vocab, 262144);
  assert.strictEqual(gemma.trainCtx, 131072);
  assert.strictEqual(F.computeBuf(8192, gemma.layers, gemma.vocab) - F.computeBuf(8192, gemma.layers, 0), 512 * 262144 * 4);
  const bare = F.resolveGeo({ id: 'llama-3-8b', params: '8B', size: 4e9 });
  assert.strictEqual(bare.trainCtx, 8192);
  const cap = F.machineFit({ id: 'llama-3-8b', params: '8B', size: 4.5e9 }, { gpu: 'cuda', ram: 32 * GiB, vram: { total: 24 * GiB, free: 22 * GiB }, devices: ['NVIDIA GeForce RTX 4090'] }, { ctx: 16384 });
  assert.strictEqual(cap.ctx, 8192);
  const mistral = F.resolveGeo({ id: 'mistral-7b-instruct', params: '7B', size: 4e9 });
  assert.strictEqual(mistral.vocab, 32768);
  assert.ok(F.computeBuf(8192, mistral.layers, mistral.vocab) > F.computeBuf(8192, mistral.layers, 0));
});

test('#102: tràn làm tròn 0,0 GB không còn nhãn tràn, mô hình vừa thì không ghi Tràn', () => {
  const hw = { gpu: 'cuda', ram: 64 * GiB, vram: { total: 8 * GiB, free: 8 * GiB, freeKnown: true }, devices: ['NVIDIA GeForce RTX 4060'] };
  const arch = { id: 'qwen3-8b', params: '8B', arch: 'qwen3' };
  const base = F.machineFit({ ...arch, size: 5 * GiB }, hw, { ctx: 8192 });
  assert.ok(!/Tràn/.test(base.hint), base.hint);
  const overhead = base.need - 5 * GiB;
  const budget = F.vramBudgetOf(hw.vram).budget;
  const size = budget - overhead + 20 * MiB;
  const r = F.machineFit({ ...arch, size }, hw, { ctx: 8192 });
  assert.strictEqual(r.group, 'smooth', `${r.hint} ram ${r.ram}`);
  assert.ok(!/Tràn/.test(r.hint + ' ' + r.text), r.hint + ' | ' + r.text);
  assert.ok(!/0,0 GB/.test(r.hint + ' ' + r.text), r.text);
  const unknown = F.machineFit({ id: 'qwen3-0.6b', params: '0.6B', arch: 'qwen3', size: 0.4e9 }, { gpu: 'cuda', ram: 16 * GiB, vram: { total: 4 * GiB }, devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU'] }, { ctx: 4096 });
  assert.strictEqual(unknown.freeUnknown, true);
  const held = F.machineFit({ id: 'llama-3.2-3b', params: '3B', size: 1.88 * GiB }, { gpu: 'cuda', ram: 16 * GiB, vram: { total: 4 * GiB, free: 0.7 * GiB, freeKnown: true }, devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU'] }, { ctx: 4096 });
  assert.notStrictEqual(held.group, 'smooth', held.hint);
});
