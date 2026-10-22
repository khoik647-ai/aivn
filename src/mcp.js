'use strict';
// Máy khách MCP (Model Context Protocol): đọc mcp.json kiểu { mcpServers: { tên: { command, args, env } | { url, type } } },
// khởi chạy máy chủ (stdio hoặc http/SSE), lấy danh sách công cụ, gọi công cụ cho AIVN AGENT (tên công cụ: mcp__<máy chủ>__<công cụ>).
// LƯU Ý AN TOÀN: máy chủ MCP stdio là chương trình chạy trên máy người dùng.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT = { mcpServers: {} };
const PROBE_TIMEOUT_RAW = 'Quá thời gian chạy thử.';
const PROBE_SLOW_RAW = 'Quá 60 giây chưa kết nối được (lần đầu npx có thể phải tải gói).';
const PROBE_EXIT_RAW = 'Máy chủ thoát ngay khi khởi động — xem nhật ký máy chủ bên dưới.';
const PROBE_STOPPED_RAW = 'Máy chủ đã dừng.';
const EXCEL_PKG = '@negokaz/excel-mcp-server';
const safeName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'may-chu';
const toolName = (server, tool) => `mcp__${safeName(server)}__${String(tool).replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);
const SECRET_TOKEN = /^\$\{secret:([^}]+)\}$/;
// Dạng chuẩn trong mcp.json là chuỗi "${secret:id}". { "$aivnSecret": id } là dạng cũ, vẫn đọc được.
function secretIdOf(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.$aivnSecret === 'string' && Object.keys(v).length === 1) return v.$aivnSecret;
  if (typeof v === 'string') { const m = SECRET_TOKEN.exec(v); if (m && m[1]) return m[1]; }
  return null;
}
function secretPlaceholder(id) { return `\${secret:${id}}`; }
const secretRef = (v) => secretIdOf(v) != null && typeof v === 'object';

// http: chỉ vòng lặp cục bộ hoặc đúng ba dải nội bộ. Không phân giải DNS.
function classifyUrl(url) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, lan: false }; }
  if (u.protocol === 'https:') return { ok: true, lan: false };
  if (u.protocol !== 'http:') return { ok: false, lan: false };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return { ok: true, lan: false };
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return { ok: false, lan: false };
  const p = m.slice(1).map(Number);
  if (p.some(x => x > 255)) return { ok: false, lan: false };
  if (p[0] === 127) return { ok: true, lan: false };
  if (p[0] === 10) return { ok: true, lan: true };
  if (p[0] === 192 && p[1] === 168) return { ok: true, lan: true };
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return { ok: true, lan: true };
  return { ok: false, lan: false };
}
function isExcelServer(def) {
  const args = def && Array.isArray(def.args) ? def.args : [];
  return args.some(a => { const s = String(a); return s === EXCEL_PKG || s.startsWith(EXCEL_PKG + '@'); });
}
function caseFold() { return process.platform === 'win32' || process.platform === 'darwin'; }
function realOrNull(p) { try { return fs.realpathSync.native(p); } catch { return null; } }
function realForNew(p) {
  let dir = path.dirname(p), tail = [path.basename(p)];
  for (let i = 0; i < 30; i++) {
    const r = realOrNull(dir);
    if (r) return path.join(r, ...tail);
    tail.unshift(path.basename(dir));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
function inside(root, p) {
  const fold = caseFold();
  const rel = path.relative(fold ? root.toLowerCase() : root, fold ? p.toLowerCase() : p);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}
function resolveExcelPath(input) {
  let p = String(input ?? '').trim();
  if (!p || p.length > 400 || /[\0\n\r]/.test(p)) return { real: null, missing: true };
  if (!path.isAbsolute(p)) p = path.resolve(p);
  const direct = realOrNull(p);
  if (direct) return { real: direct, missing: false };
  const made = realForNew(p);
  return { real: made, missing: true };
}
// Chặn đường dẫn Excel trước khi gọi gói. realpath đi theo liên kết tượng trưng. Gói có tự kiểm cũng không thay việc này.
function excelCallError(args, folders) {
  const paths = [];
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v.fileAbsolutePath === 'string') paths.push(v.fileAbsolutePath);
    for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x);
  };
  walk(args || {});
  if (!paths.length) return 'Hãy chỉ tệp Excel trong thư mục được phép.';
  const roots = (Array.isArray(folders) ? folders : []).map(f => { try { return fs.statSync(f).isDirectory() ? realOrNull(f) : null; } catch { return null; } }).filter(Boolean);
  if (!roots.length) return 'Chưa có thư mục nào được phép cho Excel. Hãy chọn thư mục trong Chi tiết.';
  for (const asked of paths) {
    const got = resolveExcelPath(asked);
    if (!got.real) return `Không tìm thấy tệp “${asked}” trong thư mục được phép.`;
    if (!roots.some(r => inside(r, got.real))) return `Tệp “${asked}” nằm ngoài thư mục được phép.`;
  }
  return null;
}
function mapValuesOk(obj) {
  return Object.values(obj).every(v => typeof v === 'string' || secretRef(v));
}
function serverProblem(name, v) {
  const trimmed = String(name).trim();
  if (trimmed.length < 1 || trimmed.length > 64) return 'Tên máy chủ phải từ 1 đến 64 ký tự.';
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `Máy chủ "${name}" không hợp lệ.`;
  const hasC = v.command != null && v.command !== '', hasU = v.url != null && v.url !== '';
  if (hasC && hasU) return `Máy chủ "${name}" chỉ được có command hoặc url.`;
  if (!hasC && !hasU) return `Máy chủ "${name}" cần "command" (stdio) hoặc "url" (http/SSE).`;
  if (hasC && typeof v.command !== 'string') return `Máy chủ "${name}" không hợp lệ.`;
  if (v.args != null && !Array.isArray(v.args)) return `"args" của "${name}" phải là mảng.`;
  if (Array.isArray(v.args) && v.args.some(a => typeof a !== 'string')) return `"args" của "${name}" chỉ được chứa chuỗi.`;
  if (v.env != null && (typeof v.env !== 'object' || Array.isArray(v.env))) return `"env" của "${name}" phải là đối tượng.`;
  if (v.env && typeof v.env === 'object' && !mapValuesOk(v.env)) return `"env" của "${name}" phải là đối tượng.`;
  if (v.headers != null && (typeof v.headers !== 'object' || Array.isArray(v.headers))) return `"headers" của "${name}" phải là đối tượng.`;
  if (v.headers && typeof v.headers === 'object' && !mapValuesOk(v.headers)) return `"headers" của "${name}" phải là đối tượng.`;
  if (v.url) {
    if (typeof v.url !== 'string' || !/^https?:\/\//i.test(v.url)) return `"url" của "${name}" phải bắt đầu bằng http:// hoặc https://`;
    if (!classifyUrl(v.url).ok) return `"url" của "${name}" dùng http ra ngoài mạng nội bộ. Hãy dùng https, hoặc một địa chỉ trong mạng nội bộ.`;
  }
  if (v.type != null && v.type !== 'sse') return `"type" của "${name}" chỉ được là "sse".`;
  if (v.timeout != null && (!Number.isInteger(v.timeout) || v.timeout < 1000 || v.timeout > 600000)) return `"timeout" của "${name}" phải là số nguyên từ 1000 đến 600000.`;
  if (v.cwd != null && typeof v.cwd !== 'string') return `"cwd" của "${name}" phải là thư mục có sẵn.`;
  return null;
}
function readConfigObject(text) {
  const empty = (fileError) => ({ mcpServers: {}, fileError, problems: {}, lan: {} });
  let raw;
  try { raw = JSON.parse(text); } catch { return empty('mcp.json không phải JSON hợp lệ.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty('mcp.json phải là một đối tượng JSON.');
  const s = raw.mcpServers;
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    return empty(raw.servers && !raw.mcpServers
      ? 'Thiếu "mcpServers". Nếu tệp dùng khoá "servers", hãy đổi thành "mcpServers".'
      : 'Thiếu "mcpServers": { tên: { command, args, env } }.');
  }
  const mcpServers = {};
  const problems = {};
  const lan = {};
  const seen = new Map();
  for (const [n, v] of Object.entries(s)) {
    mcpServers[n] = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const err = serverProblem(n, v);
    if (err) { problems[n] = err; continue; }
    const sn = safeName(n);
    if (seen.has(sn)) { problems[n] = `Tên "${seen.get(sn)}" và "${n}" trùng nhau sau khi chuẩn hoá.`; continue; }
    seen.set(sn, n);
    if (v.url && classifyUrl(v.url).lan) lan[n] = true;
  }
  return { mcpServers, fileError: null, problems, lan };
}
function validate(cfg) {
  const r = readConfigObject(JSON.stringify(cfg ?? null));
  if (r.fileError) throw new Error(r.fileError);
  const bad = Object.entries(r.problems)[0];
  if (bad) throw new Error(bad[1]);
  return cfg;
}
function materializeValue(slot, v, resolveSecret) {
  const id = secretIdOf(v);
  if (!id) {
    if (typeof v === 'string') return v;
    throw new Error(`Không giải được khoá bí mật “${slot}”.`);
  }
  let got;
  try { got = typeof resolveSecret === 'function' ? resolveSecret(id) : undefined; } catch { got = undefined; }
  if (typeof got !== 'string' || got === '') throw new Error(`Không giải được khoá bí mật “${slot}”.`);
  return got;
}
function materializeMap(obj, resolveSecret) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = materializeValue(k, v, resolveSecret);
  return out;
}
function callTimeout(def) {
  const t = def && def.timeout;
  return Number.isInteger(t) && t >= 1000 && t <= 600000 ? t : 120000;
}
function onPath(cmd) {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore', timeout: 4000, windowsHide: true }); return true; } catch { return false; }
}
// npx/node: dùng bản trên máy nếu có, không thì Node đi kèm AIVN (Electron chạy như Node + npm đóng gói sẵn)
function resolveCommand(command, args, { execPath = process.execPath, hasCmd = onPath, npmDir = null } = {}) {
  const c = String(command); const base = c.toLowerCase().replace(/\.(cmd|exe)$/, '');
  if (['npx', 'node', 'npm'].includes(base) && !hasCmd(c)) {
    const dir = npmDir || path.join(__dirname, '..', 'node_modules', 'npm').replace('app.asar', 'app.asar.unpacked');
    const cli = base === 'node' ? null : path.join(dir, 'bin', base === 'npx' ? 'npx-cli.js' : 'npm-cli.js');
    return { command: execPath, args: cli ? [cli, ...args] : args, env: { ELECTRON_RUN_AS_NODE: '1' }, bundled: true };
  }
  if (process.platform === 'win32' && ['npx', 'npm'].includes(base) && !/\.cmd$/i.test(c)) return { command: c + '.cmd', args, env: {}, bundled: false };
  return { command: c, args, env: {}, bundled: false };
}
function resultText(r) {
  if (!r) return '(không có kết quả)';
  const parts = (r.content || []).map(x => x.type === 'text' ? x.text : x.type === 'resource' ? (x.resource && (x.resource.text || x.resource.uri)) : x.type === 'image' ? `[ảnh ${x.mimeType || ''}]` : JSON.stringify(x));
  if (r.structuredContent && !parts.length) parts.push(JSON.stringify(r.structuredContent));
  return parts.join('\n').slice(0, 20000) || '(trống)';
}

function packageNameOf(spec) {
  const s = String(spec || '').trim();
  if (!s || s.startsWith('-')) return null;
  if (!/^@[^\s/]+\/[^\s/@]+/.test(s) && /[\\/]/.test(s)) return null;
  let name = s;
  if (name.startsWith('@')) { const cut = name.indexOf('@', 1); if (cut !== -1) name = name.slice(0, cut); }
  else { const cut = name.indexOf('@'); if (cut !== -1) name = name.slice(0, cut); }
  return /^(@[^\s/]+\/)?[^\s@]+$/.test(name) ? name : null;
}
function normCatalogUrl(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  let pathname = u.pathname || '';
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  if (pathname === '/') pathname = '';
  return `${u.protocol}//${u.host}${pathname}${u.search || ''}`;
}
// Nhập chỉ nhận id Nâng cao khi gói (bỏ @phiên bản) hoặc URL đã chuẩn hoá khớp. Trùng tên khoá không đủ.
const ADVANCED_CATALOG = [
  { id: 'filesystem', packages: ['@modelcontextprotocol/server-filesystem'] },
  { id: 'fetch', packages: ['mcp-fetch-server'] },
  { id: 'huggingface', urls: ['https://huggingface.co/mcp'] },
  { id: 'memory', packages: ['@modelcontextprotocol/server-memory'] },
  { id: 'thinking', packages: ['@modelcontextprotocol/server-sequential-thinking'] },
];
function claimCatalogId(def, { catalog = ADVANCED_CATALOG, taken = [] } = {}) {
  const used = new Set(taken);
  const pkgs = new Set();
  for (const a of [def && def.command, ...(def && Array.isArray(def.args) ? def.args : [])]) {
    const n = packageNameOf(a); if (n) pkgs.add(n);
  }
  const url = def && def.url ? normCatalogUrl(def.url) : '';
  for (const row of catalog) {
    if (!row || used.has(row.id)) continue;
    if (row.packages && row.packages.some(p => pkgs.has(p))) return row.id;
    if (url && row.urls && row.urls.some(u => normCatalogUrl(u) === url)) return row.id;
  }
  return null;
}
function createMcpManager({ dir, log = () => {}, onChange = () => {}, sdk = null, resolveSecret = null, getExcelFolders = null, scrub = null }) {
  const file = path.join(dir, 'mcp.json');
  const servers = new Map(); // tên → { state, client, transport, tools, error, logs[] }
  let lastRead = { mcpServers: {}, fileError: null, problems: {}, lan: {} };
  let lastRaw = { mcpServers: {} };
  const S = () => sdk || {
    Client: require('@modelcontextprotocol/sdk/client/index.js').Client,
    Stdio: require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport,
    Http: require('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport,
    Sse: require('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransport
  };
  function readText() { try { return fs.readFileSync(file, 'utf8'); } catch { return JSON.stringify(DEFAULT, null, 2); } }
  function load() {
    const text = readText();
    lastRead = readConfigObject(text);
    let raw; try { raw = JSON.parse(text); } catch { raw = null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.mcpServers || typeof raw.mcpServers !== 'object' || Array.isArray(raw.mcpServers)) raw = { mcpServers: {} };
    else raw.mcpServers = lastRead.mcpServers;
    lastRaw = raw;
    return lastRead;
  }
  function config() { load(); return lastRaw; }
  function fileError() { load(); return lastRead.fileError; }
  const clean = (s) => { const raw = s == null ? '' : String(s); try { return typeof scrub === 'function' ? String(scrub(raw)) : raw; } catch { return '••••'; } };
  const entry = (n) => { if (!servers.has(n)) servers.set(n, { state: 'off', tools: [], error: null, logs: [] }); return servers.get(n); };
  const addLog = (n, line) => { const e = entry(n); for (const l of clean(line).split(/\r?\n/)) if (l.trim()) e.logs.push(`${new Date().toLocaleTimeString('vi-VN')} ${l.slice(0, 400)}`); if (e.logs.length > 200) e.logs.splice(0, e.logs.length - 200); };
  function fail(name, message) {
    const msg = clean(message);
    const e = entry(name); e.state = 'error'; e.error = msg; e.client = null; e.transport = null; e.tools = [];
    addLog(name, 'LỖI: ' + msg); log('mcp', clean(`${name}: lỗi ${msg}`)); onChange(); return status(name);
  }

  async function start(name, opts = {}) {
    const limit = Number(opts && opts.connectTimeout) > 0 ? Number(opts.connectTimeout) : 60000;
    const timeoutMsg = limit === 60000 ? PROBE_SLOW_RAW : PROBE_TIMEOUT_RAW;
    const deadline = Date.now() + limit;
    const failTimer = (rej) => setTimeout(() => rej(new Error(timeoutMsg)), Math.max(1, deadline - Date.now()));
    const loaded = load();
    const def = loaded.mcpServers[name];
    if (!def) throw new Error(`Không có máy chủ "${name}" trong mcp.json.`);
    await stop(name, { quiet: true });
    const e = entry(name); e.state = 'starting'; e.error = null; e.tools = []; onChange();
    if (loaded.fileError) return fail(name, loaded.fileError);
    if (loaded.problems[name]) return fail(name, loaded.problems[name]);
    if (def.auth != null) return fail(name, `AIVN chưa hỗ trợ đăng nhập OAuth (trường auth) của máy chủ "${name}".`);
    const { Client, Stdio, Http, Sse } = S();
    let client = null;
    try {
      if (def.cwd) {
        let st = null; try { st = fs.statSync(def.cwd); } catch { st = null; }
        if (!st || !st.isDirectory()) throw new Error(`"cwd" của "${name}" phải là thư mục có sẵn.`);
      }
      let env = {}; let headers = null;
      if (!def.url) env = materializeMap(def.env, resolveSecret);
      else if (def.headers) headers = materializeMap(def.headers, resolveSecret);
      let transport;
      if (def.url) {
        const u = new URL(def.url);
        const opts = headers ? { requestInit: { headers } } : undefined;
        transport = def.type === 'sse' || /\/sse\/?$/.test(u.pathname) ? new Sse(u, opts) : new Http(u, opts);
        addLog(name, clean(`Kết nối ${def.type === 'sse' ? 'SSE' : 'HTTP'} ${u.origin}${u.pathname}`));
      } else {
        const args = (def.args || []).map((a, i) => materializeValue(`arg${i}`, a, resolveSecret));
        const r = resolveCommand(def.command, args);
        addLog(name, clean(`Chạy: ${def.command} ${(def.args || []).join(' ')}${r.bundled ? ' (dùng Node đi kèm AIVN)' : ''}`));
        transport = new Stdio({ command: r.command, args: r.args, env: { ...process.env, ...r.env, ...env }, stderr: 'pipe', cwd: def.cwd || undefined });
        transport.stderr && transport.stderr.on('data', (d) => addLog(name, clean(String(d))));
      }
      client = new Client({ name: 'AIVN', version: '0.15.0' }, { capabilities: {} });
      let earlyClose; const closed = new Promise((_, rej) => { earlyClose = () => rej(new Error(PROBE_EXIT_RAW)); });
      transport.onclose = () => { if (e.state === 'starting') earlyClose(); const x = servers.get(name); if (x && x.client === client && x.state === 'on') { x.state = 'error'; x.error = PROBE_STOPPED_RAW; addLog(name, 'Máy chủ đã dừng'); onChange(); } };
      let tmo; closed.catch(() => {});
      await Promise.race([client.connect(transport), closed, new Promise((_, rej) => { tmo = failTimer(rej); })]).finally(() => clearTimeout(tmo));
      let tmoList; const lt = await Promise.race([client.listTools(), new Promise((_, rej) => { tmoList = failTimer(rej); })]).finally(() => clearTimeout(tmoList));
      const tools = (lt.tools || []).map(t => { const tool = clean(t.name); return { name: tool, full: toolName(name, tool), description: clean(t.description || ''), inputSchema: t.inputSchema || { type: 'object', properties: {} } }; });
      const seen = new Map();
      for (const t of tools) {
        if (seen.has(t.full)) {
          try { await client.close(); } catch { /* đóng tiến trình trước khi báo lỗi */ }
          client = null;
          throw new Error(`Hai công cụ “${seen.get(t.full)}” và “${t.name}” trùng tên sau khi rút gọn.`);
        }
        seen.set(t.full, t.name);
      }
      Object.assign(e, { client, transport, state: 'on', tools });
      addLog(name, clean(`Đã kết nối · ${e.tools.length} công cụ: ${e.tools.map(t => t.name).join(', ')}`));
      log('mcp', clean(`${name}: đã kết nối, ${e.tools.length} công cụ`));
    } catch (err) {
      if (client) { try { await client.close(); } catch { /* đã lỗi */ } }
      const message = clean(err && err.message);
      const stack = clean(err && err.stack);
      e.state = 'error'; e.error = message; e.client = null; e.transport = null; e.tools = [];
      addLog(name, 'LỖI: ' + message); log('mcp', clean(`${name}: lỗi ${message}\n${stack}`));
    }
    onChange(); return status(name);
  }
  async function stop(name, { quiet = false } = {}) {
    const e = servers.get(name); if (!e) return;
    const c = e.client; Object.assign(e, { client: null, transport: null, state: 'off', tools: [] });
    if (c) { try { await c.close(); } catch { /* đóng */ } if (!quiet) addLog(name, 'Đã tắt'); }
    if (!quiet) onChange();
  }
  async function startEnabled() { for (const [n, d] of Object.entries(config().mcpServers)) if (!d.disabled) start(n).catch(() => {}); }
  function status(only) {
    const loaded = load();
    const cfg = loaded.mcpServers || {};
    const list = Object.keys(cfg).map(n => {
      const e = entry(n);
      const problem = loaded.problems[n];
      return {
        name: n, enabled: !cfg[n].disabled, lan: !!loaded.lan[n],
        kind: cfg[n].url ? (cfg[n].type === 'sse' ? 'sse' : 'http') : 'stdio',
        command: clean(cfg[n].url || [cfg[n].command, ...(cfg[n].args || [])].join(' ')),
        state: problem ? 'error' : e.state, error: clean(problem || e.error || ''),
        tools: (problem ? [] : e.tools).map(t => ({ name: t.name, full: t.full, description: clean(t.description).slice(0, 200) })),
        logs: e.logs.slice(-60).map(clean)
      };
    });
    return only ? list.find(x => x.name === only) : list;
  }
  async function saveText(text) {
    const cfg = validate(JSON.parse(text));
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    load();
    for (const n of [...servers.keys()]) if (!cfg.mcpServers[n]) { await stop(n, { quiet: true }); servers.delete(n); }
    onChange(); return cfg;
  }
  async function setEnabled(name, on) {
    const cfg = config(); if (!cfg.mcpServers[name]) throw new Error('Không có máy chủ này.');
    if (on) delete cfg.mcpServers[name].disabled; else cfg.mcpServers[name].disabled = true;
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    if (on) await start(name); else await stop(name);
    return status(name);
  }
  // ---- cho AIVN AGENT ----
  const live = () => [...servers.entries()].filter(([n, e]) => e.state === 'on' && !(config().mcpServers[n] || {}).disabled && !lastRead.problems[n]);
  function names() { return live().flatMap(([, e]) => e.tools.map(t => t.full)); }
  function defsMap() {
    const out = {};
    for (const [n, e] of live()) for (const t of e.tools) out[t.full] = { label: `${t.name} (${n})`, icon: '🔌', server: n, description: `[MCP · ${n}] ${t.description}`.slice(0, 1000), parameters: t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} } };
    return out;
  }
  async function exec(full, args, ctx = {}) {
    const hit = live().map(([n, e]) => ({ n, e, t: e.tools.find(t => t.full === full) })).find(x => x.t);
    if (!hit) throw new Error(`Công cụ MCP "${full}" không còn kết nối.`);
    const def = (load().mcpServers || {})[hit.n] || {};
    if (isExcelServer(def)) {
      const folders = typeof getExcelFolders === 'function' ? getExcelFolders() : [];
      const denied = excelCallError(args, folders);
      if (denied) {
        const msg = clean(denied);
        addLog(hit.n, `Từ chối ${hit.t.name}: ${msg}`);
        return { error: msg, forModel: msg, summary: msg.slice(0, 160) };
      }
    }
    addLog(hit.n, clean(`Gọi ${hit.t.name} ${JSON.stringify(args).slice(0, 500)}`));
    let r;
    try { r = await hit.e.client.callTool({ name: hit.t.name, arguments: args || {} }, undefined, { signal: ctx.signal, timeout: callTimeout(def) }); }
    catch (err) {
      const message = clean(err && err.message);
      const stack = clean(err && err.stack);
      addLog(hit.n, `Lỗi: ${message}`); log('mcp', clean(`Gọi ${hit.t.name} lỗi ${message}\n${stack}`));
      const e = new Error(message); e.stack = stack; throw e;
    }
    const text = clean(resultText(r));
    if (r.isError) { addLog(hit.n, `Lỗi: ${text.slice(0, 200)}`); return { error: text, forModel: clean(`Lỗi từ máy chủ MCP ${hit.n}: ${text}`), summary: text.slice(0, 160) }; }
    return { forModel: text, summary: clean(`${hit.t.name} · ${text.split('\n')[0].slice(0, 120)}`), detail: text.slice(0, 3000) };
  }
  async function stopAll() { for (const n of [...servers.keys()]) await stop(n, { quiet: true }); }
  return { file, readText, config, fileError, status, start, stop, startEnabled, saveText, setEnabled, names, defs: defsMap, has: (n) => /^mcp__/.test(n) && names().includes(n), exec, stopAll };
}
// Mẫu dựng sẵn
function presets({ folder = null } = {}) {
  return {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', folder || '<chọn thư mục>'] },
    fetch: { command: 'npx', args: ['-y', 'mcp-fetch-server'] },
    memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }
  };
}
module.exports = { createMcpManager, validate, resolveCommand, toolName, safeName, resultText, presets, classifyUrl, excelCallError, isExcelServer, claimCatalogId, normCatalogUrl, ADVANCED_CATALOG, secretIdOf, secretPlaceholder, PROBE_TIMEOUT_RAW, PROBE_SLOW_RAW, PROBE_EXIT_RAW, PROBE_STOPPED_RAW };
