'use strict';
// beta.2.8 trên laptop thật (Ryzen 7 4800H + RTX 3050 Ti 4 GB, 16 GB RAM) — B164 B165 B166 B167 B168 B170 B171
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const GP = require('../src/gpu-pick'); const G = require('../src/gguf'); const VS = require('../src/vision-server');
const RT = require('../src/agent/retry'); const ST = require('../src/agent/smalltalk'); const RC = require('../src/agent/recipes');
const AG = require('../src/agent/agent'); const CT = require('../src/agent/computer-tools');
const { createMemoryStore } = require('../src/agent/memory');
const GiB = 1024 ** 3;
// danh sách thiết bị giả đúng thứ tự trên laptop: GPU tích hợp AMD TRƯỚC, GPU rời NVIDIA SAU
const LIST = 'Available devices:\n  Vulkan0: AMD Radeon(TM) Graphics (3994 MiB, 3300 MiB free)\n  Vulkan1: NVIDIA GeForce RTX 3050 Ti Laptop GPU (4096 MiB, 3950 MiB free)\n';

test('B168: iGPU listed first → Auto picks the discrete GPU; manual pick by index/id/name; names ordered discrete-first', () => {
  const devs = VS.parseDevices(LIST);
  assert.strictEqual(devs.length, 2);
  const p = GP.pick(devs, null);
  assert.strictEqual(p.id, 'Vulkan1'); assert.match(p.name, /RTX 3050 Ti/); assert.strictEqual(p.integrated, false); assert.strictEqual(p.manual, false);
  assert.strictEqual(GP.pick(devs, 0).id, 'Vulkan0'); assert.strictEqual(GP.pick(devs, 0).manual, true);
  assert.strictEqual(GP.pick(devs, 'Vulkan1').id, 'Vulkan1');
  assert.deepStrictEqual(GP.order(['AMD Radeon(TM) Graphics', 'NVIDIA GeForce RTX 3050 Ti Laptop GPU']), ['NVIDIA GeForce RTX 3050 Ti Laptop GPU', 'AMD Radeon(TM) Graphics']);
  assert.ok(GP.mixed(devs));
  for (const n of ['AMD Radeon(TM) Graphics', 'AMD Radeon 780M Graphics', 'Intel(R) UHD Graphics 620', 'Intel(R) Iris(R) Xe Graphics']) assert.ok(GP.isIntegrated(n), n);
  for (const n of ['AMD Radeon RX 7600', 'Intel(R) Arc(TM) A770 Graphics', 'NVIDIA GeForce RTX 4070 SUPER']) assert.ok(!GP.isIntegrated(n), n);
  // một GPU duy nhất (kể cả tích hợp) vẫn được chọn
  assert.strictEqual(GP.pick([{ id: 'Vulkan0', name: 'AMD Radeon(TM) Graphics' }], null).id, 'Vulkan0');
});

test('B168/B170: llama-server is started with --device <dGPU> and an explicit --fit-target; user layers → -ngl; q8_0 KV → cache-type + FA', async () => {
  const exe = '/tmp/fakesrv/llama-server'; if (!fs.existsSync(exe)) { const d = path.dirname(exe); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(exe, '#!/bin/sh\necho "$@" > "$(dirname "$0")/args.txt"\nexit 1\n'); fs.chmodSync(exe, 0o755); }
  const argsOf = async (o) => {
    try { fs.unlinkSync('/tmp/fakesrv/args.txt'); } catch {}
    const vs = VS.createVisionServer({ log: () => {} });
    const listDevices = async () => ({ ok: true, all: VS.parseDevices(LIST), cuda: [] });
    await vs._startOn(exe, { id: 'qwen3-vl-4b', modelPath: '/tmp/x.gguf', mmprojPath: '/tmp/mm.gguf', contextSize: 8192, gpu: true, multiGpu: true, listDevices, fitTargetMiB: 1024, ...o }, 'vulkan').catch(() => {});
    for (let i = 0; i < 50 && !fs.existsSync('/tmp/fakesrv/args.txt'); i++) await new Promise(r => setTimeout(r, 50));
    return fs.readFileSync('/tmp/fakesrv/args.txt', 'utf8').trim().split(/\s+/);
  };
  let a = await argsOf({});
  assert.strictEqual(a[a.indexOf('--device') + 1], 'Vulkan1', a.join(' '));
  assert.strictEqual(a[a.indexOf('--fit-target') + 1], '1024'); assert.ok(!a.includes('-ngl'));
  a = await argsOf({ devicePref: 0 }); assert.strictEqual(a[a.indexOf('--device') + 1], 'Vulkan0');
  a = await argsOf({ gpuLayers: 20, kvCache: 'q8_0' });
  assert.strictEqual(a[a.indexOf('-ngl') + 1], '20'); assert.ok(!a.includes('--fit-target'));
  assert.strictEqual(a[a.indexOf('--cache-type-k') + 1], 'q8_0'); assert.strictEqual(a[a.indexOf('-fa') + 1], 'on');
  a = await argsOf({ multiGpu: false }); assert.ok(!a.includes('--device'), 'một GPU: không dò, không --device');
});

test('B170: load-dialog estimate for Qwen3-VL 4B on the 4 GB laptop matches llama-server --fit (real: 16/37 @16K, 6/37 @64K), old formula was far off', () => {
  const g = { layers: 36, kvPerToken: 147456, fileSize: 2497281664 }; const mm = 453974304; // Qwen3VL-4B-Instruct-Q4_K_M + mmproj Q8_0
  const vram = { total: 4 * GiB, free: 3.6 * GiB };
  assert.strictEqual(G.serverMarginMiB(mm), 1024);
  const at16 = G.serverFit(g, { ctx: 16384, vram, mmprojBytes: mm }), at64 = G.serverFit(g, { ctx: 65536, vram, mmprojBytes: mm });
  assert.ok(at16 >= 14 && at16 <= 19, 'ước lượng 16K ≈ 16, nhận ' + at16);
  assert.ok(at64 >= 5 && at64 <= 8, 'ước lượng 64K ≈ 6, nhận ' + at64);
  assert.ok(G.gpuFit(g, { ctx: 16384, vram }) >= 22, 'công thức cũ (92 % VRAM, không lề) báo ~23/37');
  const e = G.estimate(g, { ctx: 16384, gpuLayers: 'auto', vram, server: { mmprojBytes: mm } });
  assert.strictEqual(e.gpuLayers, at16);
});

test('B165: context cap from discrete-GPU VRAM (≤16K under 6 GB, ≤32K under 10 GB, none above / CPU / Apple)', () => {
  assert.strictEqual(GP.ctxCapFor({ gpu: 'vulkan', vram: { total: 4 * GiB } }), 16384);
  assert.strictEqual(GP.ctxCapFor({ gpu: 'cuda', vram: { total: 8 * GiB } }), 32768);
  assert.strictEqual(GP.ctxCapFor({ gpu: 'cuda', vram: { total: 12 * GiB } }), Infinity);
  assert.strictEqual(GP.ctxCapFor({ gpu: false }), Infinity);
  assert.strictEqual(GP.ctxCapFor({ gpu: 'metal', vram: { total: 4 * GiB } }), Infinity);
  const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(src, /Math\.min\([^)]*vcap/, 'withCtxGrow lấy min với trần VRAM');
});

test('B165: small talk classified without a tool loop; tasks are never small talk', () => {
  for (const q of ['xin chào', 'chào bạn', 'hello', 'cảm ơn nhé', 'ok', 'tạm biệt']) assert.ok(ST.classify(q), q);
  for (const q of ['Mở Chrome tìm giá vàng SJC hôm nay và cho mình biết giá mua, giá bán', 'gửi tin chào cho Lan', 'chào, mở Zalo giúp mình', 'tăng âm lượng lên 50']) assert.strictEqual(ST.classify(q), null, q);
});

function mkAgent(replies, exec, extra = {}) {
  const names = ['open_app', 'open_url', 'screen_look', 'screen_act', 'system_action', 'ensure_app'].filter(n => CT.DEFS[n]);
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b164-')); const seen = []; const calls = []; const logs = []; const statuses = [];
  const engine = { status: () => ({ loaded: true, vision: true, contextSize: 16384, gpuLayers: 37, totalLayers: 37 }), chatStep: async (msgs, o) => { seen.push({ msgs: msgs.map(m => ({ ...m })), tools: (o.tools || []).map(t => t.name || (t.function && t.function.name)), toolChoice: o.toolChoice }); return replies.shift() || { text: 'Xong.', toolCalls: [], finishReason: 'stop', usage: {} }; } };
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, exec: async (n, a, c) => { calls.push({ n, a }); return exec ? exec(n, a, c) : { forModel: 'ok', summary: 'ok' }; }, ...extra.computer };
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: false, agentComputer: true, agentScreen: true, agentNet: true, ...(extra.settings || {}) }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: (x) => logs.push(x), recipes: extra.recipes });
  return { agent, seen, calls, logs, statuses };
}
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: {} });
const call = (name, args) => ({ text: '', toolCalls: [{ id: 'c' + Math.random().toString(36).slice(2, 7), name, arguments: args }], finishReason: 'tool_calls', usage: {} });

test('B165: "xin chào" in AIVN AGENT → direct reply, no tools, no model tool loop', async () => {
  const { agent, seen, calls } = mkAgent([]);
  const t0 = Date.now(); const r = await agent.run({ messages: [{ role: 'user', content: 'xin chào' }], confirm: async () => true });
  assert.strictEqual(r.fast, 'smalltalk'); assert.ok(r.text.length > 3); assert.strictEqual(calls.length, 0);
  assert.ok(seen.every(s => !s.tools.length), 'không đưa công cụ cho lời chào'); assert.ok(Date.now() - t0 < 2000);
});

const SJC = { ok: true, url: 'https://sjc.com.vn/gia-vang-online', title: 'Giá vàng SJC', browser: 'Chrome', via: 'dom', text: 'Giá vàng SJC hôm nay 22/10/2026. Vàng SJC 1L, 10L, 1KG: Mua vào 147.500.000 — Bán ra 149.500.000 đồng/lượng.', trail: [] };
const QA = 'Mở Chrome tìm giá vàng SJC hôm nay và cho mình biết giá mua, giá bán';

test('B164/B167: scenario A — AIVN reads the page right away (before the model loops on hotkeys) and the answer round has no tools; answer carries prices + sjc.com.vn', async () => {
  let reads = 0;
  const { agent, seen } = mkAgent([say('Giá vàng SJC hôm nay: mua vào 147.500.000 đồng/lượng, bán ra 149.500.000 đồng/lượng. Nguồn: https://sjc.com.vn/gia-vang-online')], null, { computer: { browserRead: async () => { reads++; return SJC; } } });
  const r = await agent.run({ messages: [{ role: 'user', content: QA }], confirm: async () => true });
  assert.strictEqual(reads, 1);
  assert.ok(r.steps.some(s => s.autoRead && s.status === 'ok'), JSON.stringify(r.steps.map(s => [s.name, s.status])));
  const ans = seen.at(-1); assert.ok(!ans.tools.length || ans.toolChoice === 'none', 'lượt trả lời không có công cụ');
  assert.match(r.text, /147\.500\.000/); assert.match(r.text, /149\.500\.000/); assert.match(r.text + JSON.stringify(r.sources || []), /sjc\.com\.vn/);
});

test('B164: first read fails → after the model types + Enter, AIVN reads the page (2 s settle) and the next round answers from it', async () => {
  let reads = 0; const opts = [];
  const { agent, seen } = mkAgent([call('screen_act', { action: 'type_text', text: 'giá vàng SJC hôm nay', submit: true }), say('Mua vào 147.500.000, bán ra 149.500.000 đồng/lượng (https://sjc.com.vn/gia-vang-online).')],
    () => ({ forModel: 'đã gõ', summary: 'gõ “giá vàng SJC hôm nay” rồi bấm Enter' }),
    { computer: { browserRead: async (o) => { reads++; opts.push(o); return reads === 1 ? { ok: false, error: 'chưa có cửa sổ trình duyệt', trail: [] } : SJC; } } });
  const r = await agent.run({ messages: [{ role: 'user', content: QA }], confirm: async () => true });
  assert.strictEqual(reads, 2, 'đọc lại sau khi gõ + Enter'); assert.strictEqual(opts[1].settleMs, 2000);
  assert.ok(seen.at(-1).toolChoice === 'none' || !seen.at(-1).tools.length);
  assert.match(r.text, /149\.500\.000/);
});

test('B166/B171: a hotkey with no effect is "noeffect" (not green done) and the identical hotkey is blocked on the 2nd try (root cause of the repeated red loop-guard lines)', () => {
  const t = RT.createRetryTracker();
  const a = { action: 'hotkey', keys: 'ctrl+t' };
  assert.strictEqual(t.before(a, 'S1'), null);
  t.after(a, { error: 'màn hình không thay đổi' }, 'S1');
  const b = t.before(a, 'S1'); assert.ok(b && b.error, 'chặn ngay lần thứ 2'); assert.match(b.summary, /phím này vừa bấm không có tác dụng/);
  const c = { action: 'click', element: 'Tìm' };
  t.after(c, { error: 'không thấy' }, 'S1'); assert.strictEqual(t.before(c, 'S1'), null, 'bấm chuột vẫn được thử lại một lần');
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/agent.js'), 'utf8');
  assert.match(fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8'), /st\.status === 'ok' && st\.check \? 'noeffect'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8'), /noeffect: 'không có tác dụng'/);
});

test('B167: a successful screen run is stored and replayed as a plan next time (same gates: still goes through screen_act); a failed replay drops it', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b167-')), 'r.json'); const store = RC.createRecipeStore(file);
  const q = 'mở Notepad rồi gõ chào buổi sáng';
  const mk = () => mkAgent([call('screen_act', { action: 'hotkey', keys: 'win+r' }), call('screen_act', { action: 'type_text', text: 'notepad', submit: true }), say('Đã mở Notepad và gõ xong.')], () => ({ forModel: 'ok', summary: 'ok' }), { recipes: store });
  const one = mk(); const r1 = await one.agent.run({ messages: [{ role: 'user', content: q }], confirm: async () => true });
  assert.strictEqual(r1.outcome, 'done', JSON.stringify(r1).slice(0, 300));
  const rec = store.get(q + '.'); assert.ok(rec && rec.steps.length >= 2, 'đã lưu công thức'); assert.strictEqual(RC.createRecipeStore(file).get(q).ok, 1, 'lưu xuống đĩa');
  const two = mk(); const r2 = await two.agent.run({ messages: [{ role: 'user', content: q }], confirm: async () => true });
  assert.ok(r2.replayed >= 2); assert.match(two.seen[0].msgs[0].content, /ĐÃ LÀM THÀNH CÔNG TRƯỚC ĐÂY/);
  assert.ok(two.calls.filter(c => c.n === 'screen_act').length >= 2, 'vẫn thao tác qua screen_act (cổng xin phép/khoá người nhận nguyên vẹn)');
  assert.strictEqual(store.get(q).ok, 2);
  assert.ok(store.drop(q)); assert.strictEqual(store.get(q), null);
  assert.deepStrictEqual(RC.compact([{ name: 'screen_act', status: 'error', args: { action: 'click' } }, { name: 'screen_look', status: 'ok', args: {} }]), []);
});

test('B165: agent turn time cap ends honestly and status carries elapsed/cap for the progress line', async () => {
  const st = [];
  const replies = Array.from({ length: 10 }, (_, i) => call('screen_act', { action: 'click', element: 'Nút ' + i }));
  const { agent } = mkAgent(replies, async () => { await new Promise(r => setTimeout(r, 400)); return { forModel: 'ok', summary: 'ok' }; }, { settings: { agentTurnMaxSec: 1 } });
  const r = await agent.run({ messages: [{ role: 'user', content: 'mở Paint rồi vẽ hình tròn' }], confirm: async () => true, onStatus: (s) => st.push(s) });
  assert.ok(st.some(s => s.elapsedMs != null && s.capMs === 1000), JSON.stringify(st.slice(0, 4)));
  assert.strictEqual(r.outcome, 'failed'); assert.match(r.text, /1 giây|chưa/i);
});
