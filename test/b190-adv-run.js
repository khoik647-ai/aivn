'use strict';
// Nạp engine với node-llama-cpp giả. Mỗi hàm chạy lần lượt (engine là singleton).
const { register } = require('node:module');
const path = require('path');
const { pathToFileURL } = require('url');

register(pathToFileURL(path.join(__dirname, 'b190-nlc-hooks.mjs')).href, pathToFileURL(__filename));
process.env.AIVN_VRAM_LIMIT = String(4 * 2 ** 30);

const S = globalThis.__NLC || (globalThis.__NLC = { log: [] });
const E = require('../src/engine');
const LF = require('../src/load-fail');
const FILE = 1.9e9;
let chain = Promise.resolve();

function lock(fn) {
  const prev = chain;
  let release;
  chain = new Promise((r) => { release = r; });
  return prev.then(fn, fn).finally(release);
}

function prep(extra) {
  S.log = [];
  S.vramCalls = 0;
  S.free = 3.5;
  S.freeAfter = null;
  S.loadFail = null;
  S.msFor = null;
  S.probeMsPerTok = 5;
  S.probeTokens = 8;
  S.userMsPerTok = 1;
  S.userTokens = 8;
  if (extra) Object.assign(S, extra);
}

async function unload() { try { await E.unloadModel(); } catch { /* chưa nạp */ } }

function loadOpts(id) {
  return { contextSize: 4096, fileSize: FILE };
}

async function loadWith(extra, id = 'm') {
  return lock(async () => {
    prep(extra);
    await unload();
    return E.loadModel(id, '/fake/' + id + '.gguf', loadOpts(id));
  });
}

async function loadErr(extra, id = 'm') {
  return lock(async () => {
    prep(extra);
    await unload();
    return E.loadModel(id, '/fake/' + id + '.gguf', loadOpts(id)).then(() => null, (e) => e);
  });
}

// M1: yêu cầu sinh câu trong lúc đo tốc độ phải đợi mô hình cuối, không đụng bản nháp bị huỷ.
async function raceDuringProbe() {
  return lock(async () => {
    prep({ msFor: (n) => (n >= 29 ? 60 : 4) });
    await unload();
    let seen = null;
    let userRes = null;
    const lp = E.loadModel('race', '/fake/race.gguf', loadOpts('race')).catch((e) => e);
    for (let i = 0; i < 400 && !seen; i++) {
      await new Promise((r) => setTimeout(r, 5));
      if (S.log.some((x) => x.startsWith('gen-start probe'))) seen = E.status();
    }
    if (!seen) throw new Error('probe không chạy: ' + S.log.join(' | '));
    const ready = typeof E.whenReady === 'function' ? E.whenReady() : null;
    userRes = await E.generate([{ role: 'user', content: 'hello there' }], { maxTokens: 16 }).catch((e) => e);
    const loadRes = await lp;
    const finalReady = ready ? await ready : new Error('engine.whenReady không có');
    return { seen, userRes, loadRes, finalReady, log: S.log.slice() };
  });
}

module.exports = { S, E, LF, loadWith, loadErr, raceDuringProbe, prep };
