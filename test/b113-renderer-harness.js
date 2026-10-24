'use strict';
// Nạp app.js thật trong một DOM nhỏ, và loadById thật với engine-proxy thật.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createEngineProxy } = require('../src/engine-proxy');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function classListFor(node) {
  const read = () => String(node.className || '').split(/\s+/).filter(Boolean);
  const write = (xs) => { node.className = xs.join(' '); };
  return {
    add(...cs) { const s = new Set(read()); for (const c of cs) if (c) s.add(c); write([...s]); },
    remove(...cs) { const drop = new Set(cs); write(read().filter((c) => !drop.has(c))); },
    toggle(c, force) { const on = force === undefined ? !read().includes(c) : !!force; if (on) this.add(c); else this.remove(c); return on; },
    contains(c) { return read().includes(c); },
  };
}

function applyAttrs(node, raw) {
  const re = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m;
  while ((m = re.exec(raw || ''))) {
    const k = m[1];
    const v = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '';
    node.setAttribute(k, v);
  }
}

function makeDocument() {
  const byId = new Map();
  function walk(node, fn) {
    for (const ch of node.childNodes || []) { fn(ch); if (ch.childNodes) walk(ch, fn); }
  }
  function match(el, part) {
    if (!el || !el.tagName) return false;
    let rest = part;
    if (/^[a-zA-Z]/.test(rest)) {
      const tag = /^[a-zA-Z0-9-]+/.exec(rest)[0];
      if (String(el.tagName).toLowerCase() !== tag.toLowerCase()) return false;
      rest = rest.slice(tag.length);
    }
    if (rest.startsWith('#')) {
      const id = rest.slice(1).split(/[.[#\s]/)[0];
      if (el.id !== id) return false;
      rest = rest.slice(1 + id.length);
    }
    while (rest.startsWith('.')) {
      const cls = rest.slice(1).split(/[.[#\s]/)[0];
      if (!el.classList.contains(cls)) return false;
      rest = rest.slice(1 + cls.length);
    }
    while (rest.startsWith('[')) {
      const end = rest.indexOf(']');
      if (end < 0) return false;
      const body = rest.slice(1, end);
      const eq = body.indexOf('=');
      if (eq < 0) { if (el.getAttribute(body) == null) return false; }
      else {
        const k = body.slice(0, eq);
        const v = body.slice(eq + 1).replace(/^["']|["']$/g, '');
        if (el.getAttribute(k) !== v) return false;
      }
      rest = rest.slice(end + 1);
    }
    return rest.length === 0;
  }
  function queryAll(rootNode, sel) {
    const parts = String(sel || '').trim().split(/\s+/).filter(Boolean);
    let cur = [rootNode];
    for (const part of parts) {
      const next = [];
      for (const n of cur) walk(n, (el) => { if (match(el, part)) next.push(el); });
      cur = next;
    }
    return cur;
  }
  function el(tag, id) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(),
      id: id || '',
      className: '',
      hidden: false,
      value: '',
      textContent: '',
      innerHTML: '',
      disabled: false,
      checked: false,
      open: false,
      title: '',
      placeholder: '',
      dataset: {},
      childNodes: [],
      style: { setProperty() {}, removeProperty() {} },
      _on: {},
      parentNode: null,
      ownerDocument: null,
    };
    node.classList = classListFor(node);
    node.setAttribute = (k, v) => {
      node._attr = node._attr || {};
      node._attr[k] = String(v);
      if (k === 'id') { node.id = String(v); byId.set(node.id, node); }
      if (k === 'class') node.className = String(v);
      if (k === 'value') node.value = String(v);
      if (k === 'hidden') node.hidden = true;
      if (k === 'disabled') node.disabled = true;
      if (k.startsWith('data-')) node.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    };
    node.getAttribute = (k) => {
      if (k === 'id') return node.id || null;
      if (k === 'class') return node.className || null;
      if (node._attr && Object.prototype.hasOwnProperty.call(node._attr, k)) return node._attr[k];
      if (k.startsWith('data-')) {
        const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return node.dataset[key] != null ? node.dataset[key] : null;
      }
      return null;
    };
    node.addEventListener = (type, fn) => { (node._on[type] || (node._on[type] = [])).push(fn); };
    node.removeEventListener = (type, fn) => { node._on[type] = (node._on[type] || []).filter((f) => f !== fn); };
    node.appendChild = (ch) => { ch.parentNode = node; node.childNodes.push(ch); return ch; };
    node.remove = () => {
      const p = node.parentNode;
      if (!p) return;
      p.childNodes = p.childNodes.filter((c) => c !== node);
    };
    node.focus = () => {};
    node.click = () => {};
    node.select = () => {};
    node.setSelectionRange = () => {};
    node.scrollIntoView = () => {};
    node.scrollHeight = 0;
    node.scrollTop = 0;
    node.clientHeight = 400;
    node.tabIndex = 0;
    node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 });
    node.matches = (sel) => match(node, String(sel).split(/\s+/).pop());
    node.insertBefore = (ch, before) => {
      const i = node.childNodes.indexOf(before);
      ch.parentNode = node;
      if (i < 0) node.childNodes.push(ch);
      else node.childNodes.splice(i, 0, ch);
      return ch;
    };
    node.dispatchEvent = (ev) => { for (const fn of (node._on[ev && ev.type] || []).slice()) fn(ev); return true; };
    node.requestSubmit = () => { const ev = { preventDefault() {}, target: node }; for (const fn of (node._on.submit || []).slice()) fn(ev); };
    node.animate = () => ({ finished: Promise.resolve(), cancel() {} });
    node.removeAttribute = (k) => { if (node._attr) delete node._attr[k]; if (k === 'class') node.className = ''; };
    node.replaceChildren = (...xs) => { node.childNodes = []; for (const x of xs) if (x && x.tagName) node.appendChild(x); else node.appendChild(Object.assign(el('span'), { textContent: String(x && x.textContent != null ? x.textContent : x) })); };
    Object.defineProperty(node, 'children', { get() { return (node.childNodes || []).filter((c) => c && c.tagName); } });
    Object.defineProperty(node, 'firstElementChild', { get() { return node.children[0] || null; } });
    Object.defineProperty(node, 'options', { get() { return node.tagName === 'SELECT' ? node.childNodes.filter((c) => c.tagName === 'OPTION') : []; } });
    node.closest = (sel) => { let n = node; while (n) { if (n.tagName && match(n, sel)) return n; n = n.parentNode; } return null; };
    node.contains = (other) => { let n = other; while (n) { if (n === node) return true; n = n.parentNode; } return false; };
    node.querySelector = (sel) => queryAll(node, sel)[0] || null;
    node.querySelectorAll = (sel) => queryAll(node, sel);
    Object.defineProperty(node, 'innerHTML', {
      get() { return node._html || ''; },
      set(html) {
        node._html = String(html ?? '');
        node.childNodes = parseFragment(node._html, node);
      },
    });
    if (id) byId.set(id, node);
    return node;
  }
  function parseFragment(html, parent) {
    const rootNodes = [];
    const stack = [{ childNodes: rootNodes, append(n) { n.parentNode = parent; rootNodes.push(n); } }];
    const re = /<\/([a-zA-Z0-9-]+)>|<([a-zA-Z0-9-]+)([^>]*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      if (m[5]) {
        const top = stack[stack.length - 1].node;
        if (top && top.tagName === 'TEXTAREA' && !top.value) top.value = m[5];
        continue;
      }
      const node = el(m[2]);
      applyAttrs(node, m[3]);
      const cur = stack[stack.length - 1];
      if (cur.node) cur.node.appendChild(node);
      else { node.parentNode = parent; rootNodes.push(node); }
      const voidTag = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i.test(m[2]);
      if (!m[4] && !voidTag) stack.push({ node, childNodes: node.childNodes });
    }
    return rootNodes;
  }
  const doc = el('document');
  doc.body = el('body');
  doc.documentElement = el('html');
  doc.documentElement.dataset = {};
  doc.createElement = (tag) => el(tag);
  doc.createTextNode = (t) => ({ textContent: String(t), parentNode: null });
  doc.getElementById = (id) => byId.get(id) || null;
  doc.querySelector = (sel) => {
    const id = /^#([\w-]+)$/.exec(sel);
    if (id) return byId.get(id[1]) || (byId.set(id[1], el('div', id[1])), byId.get(id[1]));
    return queryAll(doc.body, sel)[0] || queryAll(doc, sel)[0] || null;
  };
  doc.querySelectorAll = (sel) => {
    if (sel.startsWith('#') && !sel.includes(' ')) {
      const n = doc.querySelector(sel);
      return n ? [n] : [];
    }
    return queryAll(doc.body, sel);
  };
  doc.addEventListener = (type, fn) => doc.body.addEventListener(type, fn);
  doc.removeEventListener = () => {};
  doc.hidden = false;
  doc.title = 'AIVN';
  doc.activeElement = null;
  doc.querySelector = (sel) => {
    const id = /^#([\w-]+)$/.exec(sel);
    if (id) {
      let n = byId.get(id[1]);
      if (!n) { n = el('div', id[1]); doc.body.appendChild(n); }
      return n;
    }
    return queryAll(doc.body, sel)[0] || null;
  };
  return { doc, el, byId };
}

function proxyHost({ failLoad = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b113-proxy-'));
  const host = path.join(dir, 'host.js');
  fs.writeFileSync(host, [
    "process.send({ type: 'ready', pid: process.pid, node: process.version });",
    'process.on("message", (m) => {',
    '  if (!m || m.type === "abort" || m.id == null) return;',
    failLoad
      ? '  if (m.method === "loadModel") { process.send({ id: m.id, error: "hết VRAM", code: "LOAD_FAILED" }); return; }'
      : '  if (m.method === "loadModel") { process.send({ id: m.id, result: { loaded: true, id: m.args[0], contextSize: 4096, gpu: false, gpuLayers: 0, totalLayers: 32, mode: "cpu" } }); return; }',
    '  if (m.method === "hardwareInfo") { process.send({ id: m.id, result: { gpu: false, vram: { total: 0, free: 0 } } }); return; }',
    '  if (m.method === "generate") { process.send({ id: m.id, error: "Chưa nạp mô hình nào." }); return; }',
    '  process.send({ id: m.id, result: null });',
    '});',
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  return host;
}

function makeProxy(opts) {
  return createEngineProxy({ nodePath: process.execPath, hostScript: proxyHost(opts), log: () => {}, loadWaitMs: 180000 });
}

async function bootRenderer({ modelStatus, budgetMs = 0 } = {}) {
  const { doc } = makeDocument();
  const pageHtml = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/i, '');
  const bodyHtml = (pageHtml.split(/<body[^>]*>/i)[1] || '').split(/<\/body>/i)[0];
  doc.body.innerHTML = bodyHtml;
  const calls = [];
  const generates = [];
  const agentRuns = [];
  const loadCalls = [];
  const subs = {};
  let statusFn = modelStatus || (() => ({ loaded: false, loading: false }));
  const settings = {
    uiLang: 'vi', theme: 'system', gpu: true, contextSize: 8192, apiPort: 1234, apiAutoStart: false,
    temperature: 0.7, maxTokens: 1024, systemPrompt: '', chatParams: {}, modelLoad: {},
    cloudBrain: { on: false }, lastModel: 'm', gpuDevice: null, gpuLayers: null, vramLimitGB: 0,
    perfMode: 'auto', themeFx: 'off',
  };
  const store = new Map();
  const on = (name) => (fn) => { (subs[name] || (subs[name] = [])).push(fn); return () => {}; };
  const A = new Proxy({}, {
    get(_t, p) {
      if (typeof p !== 'string') return undefined;
      if (p.startsWith('on')) return on(p);
      return async (...args) => {
        calls.push(p);
        if (p === 'modelStatus') return statusFn();
        if (p === 'generate') {
          const st = statusFn();
          if (!st || !st.loaded) throw new Error('Chưa nạp mô hình nào.');
          generates.push(args[0]);
          return { text: 'xin chào', thought: null, finishReason: 'stop', stopReason: 'stop', usage: { completion_tokens: 1, tokensPerSecond: 1, seconds: 0.2, ttft: 0.1, contextTokens: 2, contextSize: 4096 } };
        }
        if (p === 'agentRun') {
          const st = statusFn();
          if (!st || !st.loaded) throw new Error('Chưa nạp mô hình nào.');
          agentRuns.push(args[0]);
          return { text: 'xong', steps: [], usage: { completion_tokens: 1, seconds: 0.2 }, finishReason: 'stop', urls: [], memories: [] };
        }
        if (p === 'agentInfo') return {
          gate: { ok: true }, advice: null, welcome: 'Xin chào', folders: [], tools: [], toolsOff: [], web: false, alwaysAllow: [],
          memory: { count: 0, enabled: false, semantic: false },
          python: { enabled: false, available: false, version: '' },
          computer: { enabled: false, autonomy: false, autoReadOnly: true, screen: false, grounders: [], grounder: '', verySlow: false, screenMode: 'each', screenBudget: 40, stopKey: 'Ctrl+Alt+Q', platform: 'linux', perms: {} },
        };
        if (p === 'getSettings') return settings;
        if (p === 'setSettings') return Object.assign(settings, args[0] || {});
        if (p === 'models') return [{ id: 'm', file: 'm.gguf', size: 20, agent: { ok: true } }, { id: 'other', file: 'other.gguf', size: 20, agent: { ok: true } }];
        if (p === 'convos') return page.convos;
        if (p === 'serverStatus') return { running: false, port: 1234, log: [], lan: false, cors: false, ttlMin: 0, lanUrls: [], keySet: false, loaded: [] };
        if (p === 'dlList') return [];
        if (p === 'info') return { version: '0.16', hardware: { cpu: 'c', cpus: 2, ram: 1, freeRam: 1 }, paths: { models: '/m' } };
        if (p === 'updateState') return { state: 'idle' };
        if (p === 'modelsDirInfo') return null;
        if (p === 'saveConvo') return true;
        if (p === 'perfInfo') return { profile: { tierLabel: 'x', why: 'y', effectiveLabel: 'z', mode: 'auto', threads: 1, ctx: 4096, batchSize: 512, tips: [] } };
        if (p === 'perfRuns') return [];
        if (p === 'hwInfo') return { gpu: false, cpu: 'c', cpus: 2, ram: 8e9, freeRam: 4e9, vram: {} };
        if (p === 'loadModel') { loadCalls.push(args); return { ok: false, error: 'không được tự nạp lần nữa' }; }
        if (p === 'chatDefaults') return {};
        if (p === 'presets') return [];
        if (p === 'schedules' || p === 'schedList') return [];
        if (p === 'memories' || p === 'memList') return [];
        if (p === 'ragInfo') return { installed: false };
        if (p === 'sysStats') return { ramTotal: 8e9, ramFree: 4e9, cpu: 1, cpus: 2, gpu: null, vram: null };
        if (p === 'updateState') return { status: 'idle', state: 'idle' };
        if (p === 'presetsBuiltin') return [];
        return {};
      };
    },
  });
  const sandbox = {
    console,
    setTimeout: (fn, ms, ...a) => (ms > 400 ? 0 : setTimeout(fn, ms, ...a)),
    clearTimeout, setInterval: () => 0, clearInterval() {}, Promise, Date, Math, JSON, Number, String, Object, Array, Map, Set, RegExp, Error, parseInt, parseFloat, isNaN, isFinite, queueMicrotask,
    AbortController, URL, TextEncoder, TextDecoder, Intl, encodeURIComponent, decodeURIComponent,
    navigator: { webdriver: true, language: 'vi' },
    Event: class Event { constructor(type) { this.type = type; } preventDefault() {} stopPropagation() {} },
    performance: { now: () => Date.now() },
    addEventListener(type, fn) { (this._winOn[type] || (this._winOn[type] = [])).push(fn); },
    removeEventListener(type, fn) { this._winOn[type] = (this._winOn[type] || []).filter((f) => f !== fn); },
    _winOn: {},
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    CSS: { escape: (s) => String(s) },
    innerWidth: 1400,
    innerHeight: 900,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    location: { href: 'app://aivn/' },
    I18N: { lang: 'vi', LANGS: ['vi', 'en', 'zh'], setLang(l) { this.lang = l; return l; }, is: (a, b) => a === b, tr: (s) => s },
    ApproveGate: { approveOperable: () => false },
    ChatStream: {
      streamBody() { const n = doc.createElement('div'); n.className = 'body'; return n; },
      listForMode: () => [],
      convoForMode: () => null,
      generatingFor: () => null,
      selectAfterRun: () => ({ selected: false, current: null }),
    },
    AIVN_LOAD_WAIT_MS: budgetMs,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = doc;
  sandbox.aivn = A;
  sandbox.window.aivn = A;
  sandbox.window.I18N = sandbox.I18N;
  sandbox.window.AIVN_DRAFTS = require(path.join(root, 'src/renderer/drafts.js'));
  sandbox.window.ChatStream = sandbox.ChatStream;
  sandbox.window.ApproveGate = sandbox.ApproveGate;
  const chrome = require(path.join(root, 'src/renderer/gen-chrome.js'));
  sandbox.planGenChrome = chrome.planGenChrome;
  sandbox.composerGate = chrome.composerGate;
  sandbox.holdCopy = chrome.holdCopy;
  sandbox.window.planGenChrome = chrome.planGenChrome;
  vm.createContext(sandbox);
  const appSrc = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  vm.runInContext(appSrc + '\n;globalThis.__ui = { state, get pending(){ return pending; }, set pending(v){ pending = v; } };', sandbox, { filename: 'app.js' });
  const page = {
    calls, generates, agentRuns, loadCalls, subs, sandbox, doc,
    convos: [],
    get state() { return sandbox.__ui.state; },
    get pending() { return sandbox.__ui.pending; },
    set pending(v) { sandbox.__ui.pending = v; },
    set modelStatus(fn) { statusFn = fn; },
    inputValue() { return doc.querySelector('#input').value; },
    setInput(v) { doc.querySelector('#input').value = v; },
    toasts() {
      const out = [];
      const stack = doc.body.childNodes.find((n) => n.className === 'toast-stack') || doc.body;
      const walk = (n) => { if (n && n.dataset && n.dataset.msg) out.push(n.dataset.msg); for (const c of n.childNodes || []) walk(c); };
      walk(stack);
      return out;
    },
    genText() { return (doc.querySelector('#genStats').textContent || ''); },
    sendDisabled() { return !!doc.querySelector('#sendBtn').disabled; },
    async submit(text, files) {
      const locked = !!(sandbox.__ui && sandbox.__ui.state && sandbox.__ui.state.awaitingLoad);
      if (!locked) {
        if (text != null) doc.querySelector('#input').value = text;
        if (files) sandbox.__ui.pending = files;
      }
      const form = doc.querySelector('#composer');
      const ev = { preventDefault() {}, target: form };
      const fns = (form._on.submit || []).slice();
      for (const fn of fns) await fn(ev);
    },
    fire(sel, type, target) {
      const node = typeof sel === 'string' ? doc.querySelector(sel) : sel;
      const ev = { type, target: target || node, preventDefault() {}, stopPropagation() {}, key: target && target.key };
      for (const fn of (node._on[type] || []).slice()) fn(ev);
    },
    pushStatus(st) { for (const fn of subs.onModelStatus || []) fn(st); },
  };
  const bootErr = [];
  const onRej = (e) => bootErr.push(e);
  process.on('unhandledRejection', onRej);
  try {
    for (let i = 0; i < 100 && !(sandbox.__ui && sandbox.__ui.state && sandbox.__ui.state.settings); i++) await sleep(10);
  } finally { process.off('unhandledRejection', onRej); }
  page.bootErr = bootErr;
  if (!sandbox.__aivnBoot) throw new Error('app.js không chạy hết: ' + bootErr.map((e) => e && e.stack || e).join('\n'));
  return page;
}

function loadByIdFactory(engine, { verify, perfDelay = 0, sends } = {}) {
  const src = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const i = src.indexOf('async function loadById(');
  const j = src.indexOf('\nconst { createJitGuard }', i);
  if (i < 0 || j < 0) throw new Error('không cắt được loadById');
  let perfOnce = null;
  const ctx = {
    console, require, process, Buffer, setTimeout, clearTimeout, Date, Math, Number, String, Object, Error, JSON, Promise,
    engine,
    holdEngineLoading(id) { return engine.holdLoading ? engine.holdLoading(id) : () => {}; },
    listModels: () => [{ id: 'm', file: 'm.gguf', path: '/models/m.gguf', size: 1024, mtime: 1 }],
    modelLoadFor: () => ({}),
    cleanLoad: () => ({}),
    verifyGguf: verify || (() => {}),
    send: (ch, payload) => { if (sends) sends.push({ ch, payload }); },
    engineLog() {},
    hw: async () => ({ gpu: false, vram: null }),
    pendingEngineRestart: null,
    settings: { data: { gpuLayers: null, contextSize: 4096, vision: false, modelUsage: {}, modelLoad: {}, gpu: true }, save() {} },
    perfProfile: async () => { if (perfDelay) { perfOnce = perfOnce || sleep(perfDelay); await perfOnce; } return { ctx: 4096, threads: 2, batchSize: 512 }; },
    MIN_CTX_CHAT: 4096, MIN_CTX_AGENT: 8192,
    ctxCapFor: () => 8192,
    rememberedOffload: () => ({}),
    T: (s) => s, uiLang: () => 'vi',
    SC: { groundingFamily: () => '' }, NAMES: { isGeneric: () => false },
    serverExeFor: async () => null,
    LOG: { log() {} },
    embeddingProc: () => ({ hold() {}, release() {} }),
    embedProc: null, HOLD_MS: 1, idleVramUsed: null, lastCtx: null, engineDied: false, lastUse: 0,
    loadingGpu: null, hwCache: null, log() {}, engineEnv: () => ({}), hf: { llamaCpp: 'test' }, VCREDIST_URL: 'https://example.invalid',
    noteRuntime() {}, noteLayers() {}, noteUsage() {}, measureVram: async () => {}, noteOffload: async () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(i, j) + '\n;globalThis.loadById = loadById;', ctx, { filename: 'loadById.js' });
  return (id, opts) => ctx.loadById(id, opts || {});
}

module.exports = { bootRenderer, loadByIdFactory, makeProxy, sleep };
