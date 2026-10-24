'use strict';
// B190 sau PR #63: generate chờ lần nạp đang chạy, whenReady theo mô hình cuối,
// trần nhớ không đo lại, biến môi trường GPU sống qua lần tự khởi động lại,
// và hết VRAM tạm không ghi tắt GPU.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { S, E, LF, loadErr, prep, unload, lock, FILE } = require('./b190-adv-run');
const { createEngineProxy } = require('../src/engine-proxy');

const opts = { contextSize: 4096, fileSize: FILE };

async function waitProbe() {
  for (let i = 0; i < 400 && !S.log.some((x) => x.startsWith('gen-start probe')); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!S.log.some((x) => x.startsWith('gen-start probe'))) throw new Error('chưa đo tốc độ: ' + S.log.join(' | '));
}

test('N1: đổi mô hình A sang B, generate trong lúc nạp trả lời từ B', async () => {
  await lock(async () => {
    prep({ msFor: () => 4, probeMsPerTok: 20, probeTokens: 8, userMsPerTok: 1, userTokens: 4 });
    await unload();
    const loadA = E.loadModel('A', '/fake/A.gguf', opts);
    await waitProbe();
    const loadB = E.loadModel('B', '/fake/B.gguf', opts);
    const gen = await E.generate([{ role: 'user', content: 'hello there' }], { maxTokens: 8 }).catch((e) => e);
    const stB = await loadB.catch((e) => e);
    await loadA.catch(() => {});
    assert.ok(!(gen instanceof Error), gen && gen.message);
    assert.ok(gen.text && gen.text.length > 0, JSON.stringify(gen));
    assert.strictEqual(stB && stB.id, 'B', stB && stB.message);
    assert.ok(S.log.some((x) => x === 'gen-path user /fake/B.gguf'), S.log.join(' | '));
    assert.ok(!S.log.some((x) => x === 'gen-path user /fake/A.gguf'), S.log.join(' | '));
    assert.ok(!S.log.some((x) => x.startsWith('USE-AFTER-DISPOSE')), S.log.join(' | '));
  });
});

test('N1: AbortSignal dừng generate đang chờ nạp, không treo', async () => {
  await lock(async () => {
    prep({ loadDelayMs: 2000, msFor: () => 4, probeMsPerTok: 1, probeTokens: 2 });
    await unload();
    const lp = E.loadModel('hang', '/fake/hang.gguf', opts);
    for (let i = 0; i < 200 && !E.status().loading; i++) await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(E.status().loading, true);
    const ac = new AbortController();
    const t0 = Date.now();
    const timer = setTimeout(() => ac.abort(), 40);
    const gen = await E.generate([{ role: 'user', content: 'hello there' }], { maxTokens: 8, signal: ac.signal }).catch((e) => e);
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const st = await lp.catch((e) => e);
    assert.ok(ms < 500, 'generate không dừng theo AbortSignal, mất ' + ms + ' ms');
    assert.ok(!(gen instanceof Error), gen && gen.message);
    assert.strictEqual(gen.finishReason, 'abort');
    assert.strictEqual(st && st.loaded, true, st && st.message);
  });
});

test('N3: whenReady chờ lần nạp nối đuôi và trả về mô hình B', async () => {
  await lock(async () => {
    prep({ msFor: () => 4, probeMsPerTok: 20, probeTokens: 8 });
    await unload();
    const loadA = E.loadModel('A', '/fake/A.gguf', opts);
    await waitProbe();
    const ready = E.whenReady();
    const loadB = E.loadModel('B', '/fake/B.gguf', opts);
    const st = await ready;
    const stB = await loadB;
    await loadA;
    assert.strictEqual(st && st.loaded, true, JSON.stringify(st));
    assert.strictEqual(st.id, 'B');
    assert.strictEqual(st.gpuLayers, stB.gpuLayers);
  });
});

test('N4: lần nạp sau với trần nhớ không đo tốc độ lại', async () => {
  await lock(async () => {
    prep({ msFor: () => 4, probeMsPerTok: 2, probeTokens: 4 });
    await unload();
    const first = await E.loadModel('m', '/fake/m.gguf', opts);
    assert.strictEqual(first.loaded, true);
    assert.ok(S.log.some((x) => x.startsWith('gen-start probe')), 'lần đầu (chưa nhớ) phải đo: ' + S.log.join(' | '));
    const cap = first.gpuLayers;
    assert.ok(cap > 0, String(cap));
    prep({ msFor: () => 4, probeMsPerTok: 2, probeTokens: 4 });
    await unload();
    const second = await E.loadModel('m', '/fake/m.gguf', { ...opts, capLayers: cap });
    assert.strictEqual(second.loaded, true);
    assert.strictEqual(second.gpuLayers, cap, S.log.join(' | '));
    assert.ok(!S.log.some((x) => x.startsWith('gen-start probe')), 'vẫn đo dù đã nhớ trần ' + cap + ': ' + S.log.join(' | '));
  });
});

test('N5: tự khởi động lại giữ AIVN_VRAM_LIMIT và GGML_VK_VISIBLE_DEVICES', async () => {
  const prevL = process.env.AIVN_VRAM_LIMIT;
  const prevD = process.env.GGML_VK_VISIBLE_DEVICES;
  const prevG = process.env.AIVN_GPU;
  process.env.AIVN_VRAM_LIMIT = '123456789';
  process.env.GGML_VK_VISIBLE_DEVICES = '2';
  delete process.env.AIVN_GPU;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b190-env-'));
  const host = path.join(dir, 'host.js');
  fs.writeFileSync(host, [
    "process.send({ type: 'ready', pid: process.pid, node: process.version });",
    "process.on('message', (m) => {",
    "  if (!m || m.method !== 'hardwareInfo') return;",
    "  process.send({ id: m.id, result: {",
    "    vram: process.env.AIVN_VRAM_LIMIT || '',",
    "    dev: process.env.GGML_VK_VISIBLE_DEVICES || '',",
    "    gpu: process.env.AIVN_GPU || '',",
    "  } });",
    '});',
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  const p = createEngineProxy({ nodePath: process.execPath, hostScript: host, log: () => {} });
  try {
    const before = await p.hardwareInfo();
    assert.strictEqual(before.vram, '123456789');
    assert.strictEqual(before.dev, '2');
    await p.restart({ AIVN_GPU: 'off', GGML_VK_VISIBLE_DEVICES: '', AIVN_VRAM_LIMIT: '' }, 'GPU không nạp được mô hình, chuyển sang chỉ CPU');
    const cpu = await p.hardwareInfo();
    assert.strictEqual(cpu.gpu, 'off');
    assert.strictEqual(cpu.vram, '123456789', 'AIVN_VRAM_LIMIT bị xoá sau tự khởi động lại');
    assert.strictEqual(cpu.dev, '2', 'GGML_VK_VISIBLE_DEVICES bị xoá sau tự khởi động lại');
    await p.restart({ AIVN_GPU: '', GGML_VK_VISIBLE_DEVICES: '', AIVN_VRAM_LIMIT: '' }, 'mọi cách nạp đều lỗi, giữ cài đặt GPU');
    const back = await p.hardwareInfo();
    assert.strictEqual(back.gpu, '');
    assert.strictEqual(back.vram, '123456789');
    assert.strictEqual(back.dev, '2');
    await p.restart({ AIVN_GPU: '', GGML_VK_VISIBLE_DEVICES: '0', AIVN_VRAM_LIMIT: '4096' }, 'đổi cài đặt GPU');
    const set = await p.hardwareInfo();
    assert.strictEqual(set.vram, '4096');
    assert.strictEqual(set.dev, '0');
  } finally {
    await p.stop('test xong').catch(() => {});
    if (prevL == null) delete process.env.AIVN_VRAM_LIMIT;
    else process.env.AIVN_VRAM_LIMIT = prevL;
    if (prevD == null) delete process.env.GGML_VK_VISIBLE_DEVICES;
    else process.env.GGML_VK_VISIBLE_DEVICES = prevD;
    if (prevG == null) delete process.env.AIVN_GPU;
    else process.env.AIVN_GPU = prevG;
  }
});

test('N6: 0 lớp vì VRAM trống thấp không ghi gpu=false; lỗi GPU thật thì vẫn ghi', async () => {
  const tight = await loadErr({ free: 0.02, msFor: () => 4 }, 'tight0');
  assert.strictEqual(tight && tight.code, 'LOAD_FAILED', tight && tight.message);
  assert.strictEqual(tight.gpu, true);
  assert.strictEqual(tight.memory, true);
  assert.ok(!tight.attempts || tight.attempts.length === 0, JSON.stringify(tight.attempts));
  assert.match(String(tight.message), /Không đủ VRAM/);
  assert.strictEqual(LF.wantsCpuLadder(tight.attempts, { memory: tight.memory }), true, 'lần này phải rơi về CPU');
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: tight.attempts }), false, 'hết VRAM tạm vẫn ghi gpu=false');
  const bad = await loadErr({ loadFail: 'invalid device' }, 'baddev');
  assert.strictEqual(bad && bad.code, 'LOAD_FAILED', bad && bad.message);
  assert.ok(bad.attempts && bad.attempts.some((a) => /invalid device/.test(a.message)), JSON.stringify(bad.attempts));
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: true, attempts: bad.attempts }), true, 'lỗi GPU thật không được ghi gpu=false');
  assert.strictEqual(LF.shouldPersistGpuOff({ cpuLoaded: false, attempts: bad.attempts }), false);
});
