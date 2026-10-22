'use strict';
// B10 (a): POST /v1/embeddings qua llama-server --embeddings (tiến trình riêng, giả lập).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApiServer } = require('../src/server');
const { createEmbedServer, listEmbeddingModels, gpuLayersFor, inspectFile, inspectCacheStats, chatIdsExcept, contextLimit, EMBED_IDLE_NGL, MAX_STRING_CHARS, MAX_TOTAL_CHARS, MAX_EMBED_BODY } = require('../src/embed-server');

const FAKE = path.join(__dirname, 'fixtures', 'fake-llama', 'llama-server');
const GB = 1024 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function str(s) { const raw = Buffer.from(String(s)); return Buffer.concat([u64(raw.length), raw]); }
function kvStr(k, v) { return Buffer.concat([str(k), u32(8), str(v)]); }
function kvU32(k, v) { return Buffer.concat([str(k), u32(4), u32(v)]); }
function gguf(kvs) { return Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(kvs.length), ...kvs]); }

function writeModels(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bge-m3-q8_0.gguf'), gguf([
    kvStr('general.architecture', 'bert'), kvU32('bert.pooling_type', 1), kvU32('bert.embedding_length', 8), kvU32('bert.context_length', 512),
  ]));
  fs.writeFileSync(path.join(dir, 'nomic-embed-text-v1.5.gguf'), gguf([
    kvStr('general.architecture', 'nomic-bert'), kvU32('nomic-bert.pooling_type', 2), kvU32('nomic-bert.embedding_length', 8), kvU32('nomic-bert.context_length', 2048),
  ]));
  fs.writeFileSync(path.join(dir, 'qwen-q4.gguf'), gguf([
    kvStr('general.architecture', 'llama'), kvU32('llama.block_count', 4), kvU32('llama.embedding_length', 64),
  ]));
  fs.writeFileSync(path.join(dir, 'mmproj-bert.gguf'), gguf([kvStr('general.architecture', 'bert')]));
  fs.writeFileSync(path.join(dir, 'not-a-model.gguf'), Buffer.from('nope'));
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

test('GGUF: bert và nomic-bert được liệt kê, mô hình trò chuyện và mmproj thì không', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-'));
  writeModels(dir);
  const list = listEmbeddingModels([dir]);
  const ids = list.map((m) => m.id).sort();
  assert.deepStrictEqual(ids, ['bge-m3-q8_0', 'nomic-embed-text-v1.5']);
  const bge = list.find((m) => m.id === 'bge-m3-q8_0');
  assert.equal(bge.arch, 'bert'); assert.equal(bge.pooling, 'mean'); assert.equal(bge.context, 512);
  const nomic = list.find((m) => m.id === 'nomic-embed-text-v1.5');
  assert.equal(nomic.pooling, 'cls');
});

test('GPU: ≤ 4 GB hoặc GPU tích hợp → CPU; chat đang nạp và VRAM chặt → CPU hoặc 4 lớp', () => {
  assert.equal(gpuLayersFor({ vramTotal: 4 * GB, vramFree: 3 * GB }), 0);
  assert.equal(gpuLayersFor({ vramTotal: 3 * GB, vramFree: 2 * GB, chatLoaded: false }), 0);
  assert.equal(gpuLayersFor({ integratedOnly: true, vramTotal: 16 * GB, vramFree: 8 * GB }), 0);
  assert.equal(gpuLayersFor({}), 0);
  assert.equal(gpuLayersFor({ vramTotal: 8 * GB, vramFree: 1 * GB, chatLoaded: true }), 0);
  assert.equal(gpuLayersFor({ vramTotal: 12 * GB, vramFree: 4 * GB, chatLoaded: true }), 4);
  assert.equal(gpuLayersFor({ vramTotal: 12 * GB, vramFree: 1 * GB, chatLoaded: false }), EMBED_IDLE_NGL);
  assert.equal(gpuLayersFor({ vramTotal: 24 * GB, vramFree: 20 * GB, chatLoaded: false }), EMBED_IDLE_NGL);
  assert.equal(gpuLayersFor({ vramTotal: 24 * GB, vramFree: 8 * GB, chatLoaded: true }), null);
  assert.equal(contextLimit(32768), 8192);
  assert.equal(contextLimit(8192), 8192);
  assert.equal(contextLimit(undefined), 512);
  assert.equal(contextLimit(64), 128);
});

function serverOf(emb, opts = {}) {
  return createApiServer({
    engine: { status: () => ({ loaded: false }) }, models: () => opts.chat || [], ensureModel: async () => {}, log: opts.log || (() => {}),
    getOpts: () => ({ apiKey: opts.apiKey || null, cors: false }),
    embeddings: emb,
  });
}
async function listen(api) {
  const port = 20000 + Math.floor(Math.random() * 10000);
  await api.start(port, '127.0.0.1');
  return port;
}
const post = (port, body, headers = {}) => fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('llama-server giả: chưa chạy trước yêu cầu đầu, một spawn khi hai client cùng lúc, -ngl 0, tắt khi rảnh', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-'));
  const logf = path.join(dir, 'spawns.log');
  writeModels(dir);
  const prevLog = process.env.AIVN_FAKE_SPAWN_LOG; const prevDelay = process.env.AIVN_FAKE_HEALTH_MS;
  process.env.AIVN_FAKE_SPAWN_LOG = logf; process.env.AIVN_FAKE_HEALTH_MS = '350';
  const embedLogs = [];
  const srv = createEmbedServer({ findExe: () => FAKE, idleMs: 400, gpuLayers: () => 0, log: (m) => embedLogs.push(m) });
  const logs = [];
  const api = serverOf({
    info: () => ({ installed: true, id: 'bge-m3-q8_0' }),
    list: () => srv.list([dir]),
    ensure: async (model) => {
      const target = srv.resolve(model, {
        models: srv.list([dir]), fallbackId: 'bge-m3-q8_0', chatIds: ['qwen-q4'],
        chatMessage: (m) => `"${m}" là mô hình trò chuyện, không tạo embeddings được. Dùng "bge-m3-q8_0" (hoặc bỏ trường "model").`,
      });
      return srv.open(target);
    },
    embed: (texts) => srv.embed(texts),
    count: (texts) => srv.count(texts),
  }, { log: (m) => logs.push(m), apiKey: 'khoa-bi-mat' });
  let port = 0;
  try {
    assert.equal(srv.stats().spawns, 0); assert.equal(fs.existsSync(logf), false);
    port = await listen(api);
    assert.equal((await post(port, { input: 'x' })).status, 401);
    assert.equal((await post(port, { input: 'x' }, { 'x-api-key': 'sai' })).status, 401);
    assert.equal(srv.stats().spawns, 0, 'từ chối khoá không được khởi động llama-server');
    const auth = { authorization: 'Bearer khoa-bi-mat' };
    const [a, b] = await Promise.all([
      post(port, { model: 'text-embedding-3-small', input: 'Xin chào' }, auth),
      post(port, { model: 'bge-m3-q8_0', input: ['Hà Nội', 'Đà Nẵng'], encoding_format: 'base64', dimensions: 4 }, auth),
    ]);
    assert.equal(a.status, 200, await a.clone().text());
    const ja = await a.json();
    assert.equal(ja.object, 'list'); assert.equal(ja.model, 'bge-m3-q8_0');
    assert.equal(ja.data.length, 1); assert.equal(ja.data[0].object, 'embedding'); assert.equal(ja.data[0].index, 0);
    assert.equal(ja.data[0].embedding.length, 8); assert.ok(ja.usage.prompt_tokens >= 1); assert.equal(ja.usage.total_tokens, ja.usage.prompt_tokens);
    assert.ok(logs.some((l) => /text-embedding-3-small” → dùng bge-m3-q8_0/.test(l)));
    const jb = await b.json();
    assert.equal(jb.data.length, 2); assert.equal(jb.data[1].index, 1);
    assert.equal(Buffer.from(jb.data[0].embedding, 'base64').length, 4 * 4);
    assert.equal(srv.stats().spawns, 1, 'hai client phải chung một tiến trình');
    const lines = fs.readFileSync(logf, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1); assert.ok(lines[0].argv.includes('--embeddings')); assert.ok(lines[0].argv.includes('--pooling'));
    const ngl = lines[0].argv.indexOf('-ngl'); assert.equal(lines[0].argv[ngl + 1], '0');
    const cArg = lines[0].argv[lines[0].argv.indexOf('-c') + 1];
    assert.equal(cArg, '512');
    assert.equal(lines[0].argv[lines[0].argv.indexOf('-b') + 1], cArg);
    assert.equal(lines[0].argv[lines[0].argv.indexOf('-ub') + 1], cArg);
    const models = await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: auth })).json();
    assert.ok(models.data.some((m) => m.id === 'bge-m3-q8_0' && m.type === 'embedding'));
    assert.ok(models.data.some((m) => m.id === 'nomic-embed-text-v1.5' && m.type === 'embedding'));
    assert.equal((await post(port, { input: [] }, auth)).status, 400);
    assert.equal((await post(port, { input: [1, 2] }, auth)).status, 400);
    assert.equal((await post(port, { input: 'x', encoding_format: 'hex' }, auth)).status, 400);
    const chat = await post(port, { model: 'qwen-q4', input: 'x' }, auth);
    assert.equal(chat.status, 400); assert.match((await chat.json()).error.message, /là mô hình trò chuyện, không tạo embeddings được/);
    const pid = lines[0].pid;
    for (let i = 0; i < 30 && (srv.stats().running || alive(pid)); i++) await sleep(100);
    assert.equal(srv.stats().running, false); assert.equal(alive(pid), false);
    const again = await post(port, { model: 'nomic-embed-text-v1.5', input: 'một câu' }, auth);
    assert.equal(again.status, 200); assert.equal((await again.json()).model, 'nomic-embed-text-v1.5');
    assert.equal(srv.stats().spawns, 2);
    assert.equal(srv.stats().lastArgs[srv.stats().lastArgs.indexOf('--pooling') + 1], 'cls');
    assert.equal(srv.stats().lastArgs[srv.stats().lastArgs.indexOf('-ngl') + 1], '0');
    assert.equal(srv.stats().lastArgs[srv.stats().lastArgs.indexOf('-c') + 1], '2048');
    assert.equal(srv.stats().lastArgs[srv.stats().lastArgs.indexOf('-b') + 1], '2048');
    assert.equal(srv.stats().lastArgs[srv.stats().lastArgs.indexOf('-ub') + 1], '2048');
    assert.ok(embedLogs.some((l) => /đổi mô hình bge-m3-q8_0 → nomic-embed-text-v1\.5/.test(l)), embedLogs.join('\n'));
    const wide = createEmbedServer({ findExe: () => FAKE, idleMs: 0, gpuLayers: () => null, log: () => {} });
    try {
      await wide.open(wide.list([dir]).find((m) => m.id === 'bge-m3-q8_0'));
      assert.equal(wide.stats().lastArgs.includes('-ngl'), false, 'VRAM rộng thì không ép -ngl');
      assert.ok(wide.stats().lastArgs.includes('--embeddings'));
    } finally { await wide.stop(); }
  } finally {
    await srv.stop(); await api.stop();
    if (prevLog == null) delete process.env.AIVN_FAKE_SPAWN_LOG; else process.env.AIVN_FAKE_SPAWN_LOG = prevLog;
    if (prevDelay == null) delete process.env.AIVN_FAKE_HEALTH_MS; else process.env.AIVN_FAKE_HEALTH_MS = prevDelay;
  }
});

test('chưa cài mô hình nhúng → 400; không có llama-server → 503', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-empty-'));
  const none = createEmbedServer({ findExe: () => null, idleMs: 0, log: () => {} });
  const api = serverOf({
    list: () => none.list([empty]),
    ensure: async (model) => none.open(none.resolve(model, { models: none.list([empty]), fallbackId: 'bge-m3-q8_0' })),
    embed: (t) => none.embed(t), count: async () => 0,
  });
  const port = await listen(api);
  try {
    const r = await post(port, { input: 'xin chào' });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error.message, /nomic-embed-text hoặc bge-small/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-miss-'));
    writeModels(dir);
    const miss = createEmbedServer({ findExe: () => path.join(dir, 'khong-co-llama-server'), idleMs: 0, log: () => {} });
    await assert.rejects(() => miss.open(miss.list([dir])[0]), (e) => e.status === 503 && /llama-server/.test(e.message));
    const boom = path.join(dir, 'boom.js');
    fs.writeFileSync(boom, '#!/usr/bin/env node\nprocess.exit(1)\n'); fs.chmodSync(boom, 0o755);
    const dead = createEmbedServer({ findExe: () => boom, idleMs: 0, healthMs: 3000, log: () => {} });
    await assert.rejects(() => dead.open(dead.list([dir])[0]), (e) => e.status === 503);
  } finally { await none.stop(); await api.stop(); }
});

test('main.js nối embed-server và giữ câu từ chối mô hình trò chuyện', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(m, /createEmbedServer/);
  assert.match(m, /là mô hình trò chuyện, không tạo embeddings được/);
  assert.match(m, /embed-server/);
  assert.match(m, /inspectFile/);
  assert.match(m, /isEmbedGguf/);
  assert.match(m, /chatIdsExcept/);
  const stopAt = m.indexOf('embedProc.stop()');
  const vramAt = m.indexOf('idleVramUsed = h0.vram.total');
  const loadAt = m.indexOf('engine.loadModel(m.id');
  assert.ok(stopAt > 0 && vramAt > stopAt && loadAt > vramAt, 'dừng máy nhúng trước khi đo VRAM và trước engine.loadModel');
});

function harness(dir, srv) {
  return serverOf({
    info: () => ({ installed: true, id: 'bge-m3-q8_0' }),
    list: () => srv.list([dir]),
    ensure: async (model) => {
      const models = srv.list([dir]);
      const target = srv.resolve(model, {
        models, fallbackId: 'bge-m3-q8_0', chatIds: chatIdsExcept(['qwen-q4', 'all-minilm-l6-v2-q8_0'], models),
        chatMessage: (m) => `"${m}" là mô hình trò chuyện, không tạo embeddings được. Dùng "bge-m3-q8_0" (hoặc bỏ trường "model").`,
      });
      return srv.open(target);
    },
    embed: (texts) => srv.embed(texts),
    count: (texts) => srv.count(texts),
  });
}

test('input dài hơn -ub bị llama-server giả từ chối; AIVN cắt còn ngữ cảnh − 4 token', async () => {
  const { spawn } = require('child_process');
  const net = require('net');
  const take = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const fp = await take();
  const child = spawn(process.execPath, [FAKE, '--port', String(fp), '-ub', '4', '--embeddings'], { stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch(`http://127.0.0.1:${fp}/health`)).ok; } catch { await sleep(40); }
    }
    assert.equal(up, true);
    const too = await fetch(`http://127.0.0.1:${fp}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'một hai ba bốn năm' }) });
    assert.equal(too.status, 400);
    assert.match(await too.text(), /input is too large to process\. increase the physical batch size/);
    const ok = await fetch(`http://127.0.0.1:${fp}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'một hai ba bốn' }) });
    assert.equal(ok.status, 200);
  } finally { try { child.kill('SIGKILL'); } catch {} }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-long-'));
  writeModels(dir);
  const srv = createEmbedServer({ findExe: () => FAKE, idleMs: 0, gpuLayers: () => 0, log: () => {} });
  const api = harness(dir, srv);
  const port = await listen(api);
  try {
    const words = Array.from({ length: 600 }, (_, i) => 'w' + i);
    const full = words.join(' ');
    const kept = words.slice(0, 512 - 4).join(' ');
    const before = srv.stats().truncated;
    const r = await post(port, { model: 'bge-m3-q8_0', input: full });
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok(srv.stats().truncated > before);
    const short = await post(port, { model: 'bge-m3-q8_0', input: kept });
    assert.equal(short.status, 200);
    assert.deepStrictEqual((await r.json()).data[0].embedding, (await short.json()).data[0].embedding);
    assert.equal(srv.stats().lastArgs[srv.stats().lastArgs.indexOf('-ub') + 1], '512');
  } finally { await srv.stop(); await api.stop(); }
});

test('chuỗi quá dài, tổng quá dài, và thân yêu cầu quá lớn trả 400 rõ', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-cap-'));
  writeModels(dir);
  const srv = createEmbedServer({ findExe: () => FAKE, idleMs: 0, gpuLayers: () => 0, log: () => {} });
  const api = harness(dir, srv);
  const port = await listen(api);
  try {
    const one = await post(port, { input: 'à'.repeat(MAX_STRING_CHARS + 1) });
    assert.equal(one.status, 400);
    const oneMsg = (await one.json()).error.message;
    assert.match(oneMsg, /100000 ký tự cho một chuỗi embeddings/);
    assert.doesNotMatch(oneMsg, /JSON không hợp lệ/);
    const many = await post(port, { input: Array.from({ length: 11 }, () => 'y'.repeat(MAX_STRING_CHARS)) });
    assert.equal(many.status, 400);
    assert.match((await many.json()).error.message, new RegExp(`${MAX_TOTAL_CHARS} ký tự cho một yêu cầu embeddings`));
    const raw = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'z'.repeat(MAX_EMBED_BODY + 80) });
    assert.equal(raw.status, 400);
    const rawMsg = await raw.text();
    assert.match(rawMsg, /Nội dung yêu cầu embeddings quá lớn/);
    assert.doesNotMatch(rawMsg, /JSON không hợp lệ/);
    assert.equal(srv.stats().spawns, 0, 'từ chối trước khi khởi động llama-server');
  } finally { await srv.stop(); await api.stop(); }
});

test('all-MiniLM (bert, pooling mean) không bị coi là mô hình trò chuyện và chỉ hiện một lần', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-mini-'));
  writeModels(dir);
  fs.writeFileSync(path.join(dir, 'all-MiniLM-L6-v2-Q8_0.gguf'), gguf([
    kvStr('general.architecture', 'bert'), kvU32('bert.pooling_type', 1), kvU32('bert.embedding_length', 8), kvU32('bert.context_length', 512),
  ]));
  const list = listEmbeddingModels([dir]);
  const mini = list.find((m) => m.id === 'all-minilm-l6-v2-q8_0');
  assert.ok(mini, list.map((m) => m.id).join(','));
  assert.equal(mini.arch, 'bert');
  assert.equal(mini.pooling, 'mean');
  assert.deepStrictEqual(chatIdsExcept(['all-minilm-l6-v2-q8_0', 'Qwen-Q4'], list), ['Qwen-Q4']);
  const srv = createEmbedServer({ findExe: () => FAKE, idleMs: 0, log: () => {} });
  const hit = srv.resolve('all-minilm-l6-v2-q8_0', { models: list, fallbackId: 'bge-m3-q8_0', chatIds: ['all-minilm-l6-v2-q8_0', 'qwen-q4'] });
  assert.equal(hit.id, 'all-minilm-l6-v2-q8_0');
  assert.throws(() => srv.resolve('qwen-q4', { models: list, fallbackId: 'bge-m3-q8_0', chatIds: ['all-minilm-l6-v2-q8_0', 'qwen-q4'] }), (e) => e.code === 'CHAT_MODEL');
  const api = serverOf({
    list: () => list,
    ensure: async () => ({ id: 'bge-m3-q8_0' }),
    embed: async () => [new Float32Array(8)],
    count: async () => 1,
  }, { chat: [{ id: 'qwen-q4', mtime: Date.now() }, { id: 'all-minilm-l6-v2-q8_0', mtime: Date.now() }] });
  const port = await listen(api);
  try {
    const models = await (await fetch(`http://127.0.0.1:${port}/v1/models`)).json();
    const rows = models.data.filter((m) => m.id === 'all-minilm-l6-v2-q8_0');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'embedding');
    assert.ok(models.data.some((m) => m.id === 'qwen-q4' && m.type == null));
  } finally { await api.stop(); }
});

test('inspectFile chỉ đọc GGUF lại khi mtime đổi', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-cache-'));
  writeModels(dir);
  const file = path.join(dir, 'bge-m3-q8_0.gguf');
  const before = inspectCacheStats().reads;
  const a = inspectFile(file);
  const mid = inspectCacheStats().reads;
  assert.equal(mid, before + 1);
  assert.equal(inspectFile(file), a);
  assert.equal(inspectCacheStats().reads, mid);
  const later = (Date.now() + 10000) / 1000;
  fs.utimesSync(file, later, later);
  const c = inspectFile(file);
  assert.notEqual(c, a);
  assert.equal(c.context, a.context);
  assert.equal(inspectCacheStats().reads, mid + 1);
});

test('trung bình các hàng token của /embedding được chuẩn hoá L2', async () => {
  const prev404 = process.env.AIVN_FAKE_EMBED_404;
  const prevRows = process.env.AIVN_FAKE_TOKEN_ROWS;
  process.env.AIVN_FAKE_EMBED_404 = '1';
  process.env.AIVN_FAKE_TOKEN_ROWS = '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-l2-'));
  writeModels(dir);
  const srv = createEmbedServer({ findExe: () => FAKE, idleMs: 0, gpuLayers: () => 0, log: () => {} });
  const api = harness(dir, srv);
  const port = await listen(api);
  try {
    const r = await post(port, { input: 'xin chào' });
    assert.equal(r.status, 200, await r.clone().text());
    const emb = (await r.json()).data[0].embedding;
    assert.ok(Math.abs(emb[0] - 0.6) < 1e-6, String(emb[0]));
    assert.ok(Math.abs(emb[1] - 0.8) < 1e-6, String(emb[1]));
    let n = 0; for (const x of emb) n += x * x;
    assert.ok(Math.abs(n - 1) < 1e-6);
  } finally {
    await srv.stop(); await api.stop();
    if (prev404 == null) delete process.env.AIVN_FAKE_EMBED_404; else process.env.AIVN_FAKE_EMBED_404 = prev404;
    if (prevRows == null) delete process.env.AIVN_FAKE_TOKEN_ROWS; else process.env.AIVN_FAKE_TOKEN_ROWS = prevRows;
  }
});

test('cổng bị chiếm một lần thì thử cổng khác và vẫn trả embeddings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b10-port-'));
  writeModels(dir);
  const mark = path.join(dir, 'fail-once');
  const prev = process.env.AIVN_FAKE_FAIL_ONCE;
  process.env.AIVN_FAKE_FAIL_ONCE = mark;
  const logs = [];
  const srv = createEmbedServer({ findExe: () => FAKE, idleMs: 0, gpuLayers: () => 0, log: (m) => logs.push(m) });
  const api = harness(dir, srv);
  const port = await listen(api);
  try {
    const r = await post(port, { input: 'xin chào' });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(srv.stats().spawns, 2);
    assert.equal(fs.existsSync(mark), true);
    assert.ok(logs.some((l) => /thử cổng khác/.test(l)), logs.join('\n'));
  } finally {
    await srv.stop(); await api.stop();
    if (prev == null) delete process.env.AIVN_FAKE_FAIL_ONCE; else process.env.AIVN_FAKE_FAIL_ONCE = prev;
  }
});
