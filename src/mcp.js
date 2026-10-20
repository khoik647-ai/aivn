'use strict';
// Máy khách MCP (Model Context Protocol): đọc mcp.json kiểu { mcpServers: { tên: { command, args, env } | { url, type } } },
// khởi chạy máy chủ (stdio hoặc http/SSE), lấy danh sách công cụ, gọi công cụ cho AIVN AGENT (tên công cụ: mcp__<máy chủ>__<công cụ>).
// LƯU Ý AN TOÀN: máy chủ MCP stdio là chương trình chạy trên máy người dùng.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT = { mcpServers: {} };
const safeName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'may-chu';
const toolName = (server, tool) => `mcp__${safeName(server)}__${String(tool).replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);

function validate(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('mcp.json phải là một đối tượng JSON.');
  const s = cfg.mcpServers; if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Thiếu "mcpServers": { tên: { command, args, env } }.');
  for (const [n, v] of Object.entries(s)) {
    if (!v || typeof v !== 'object') throw new Error(`Máy chủ "${n}" không hợp lệ.`);
    if (!v.command && !v.url) throw new Error(`Máy chủ "${n}" cần "command" (stdio) hoặc "url" (http/SSE).`);
    if (v.args != null && !Array.isArray(v.args)) throw new Error(`"args" của "${n}" phải là mảng.`);
    if (v.env != null && (typeof v.env !== 'object' || Array.isArray(v.env))) throw new Error(`"env" của "${n}" phải là đối tượng.`);
    if (v.url && !/^https?:\/\//i.test(v.url)) throw new Error(`"url" của "${n}" phải bắt đầu bằng http:// hoặc https://`);
  }
  return cfg;
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

function createMcpManager({ dir, log = () => {}, onChange = () => {}, sdk = null }) {
  const file = path.join(dir, 'mcp.json');
  const servers = new Map(); // tên → { state, client, transport, tools, error, logs[] }
  const S = () => sdk || {
    Client: require('@modelcontextprotocol/sdk/client/index.js').Client,
    Stdio: require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport,
    Http: require('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport,
    Sse: require('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransport
  };
  function readText() { try { return fs.readFileSync(file, 'utf8'); } catch { return JSON.stringify(DEFAULT, null, 2); } }
  function config() { try { return validate(JSON.parse(readText())); } catch { return DEFAULT; } }
  const entry = (n) => { if (!servers.has(n)) servers.set(n, { state: 'off', tools: [], error: null, logs: [] }); return servers.get(n); };
  const addLog = (n, line) => { const e = entry(n); for (const l of String(line).split(/\r?\n/)) if (l.trim()) e.logs.push(`${new Date().toLocaleTimeString('vi-VN')} ${l.slice(0, 400)}`); if (e.logs.length > 200) e.logs.splice(0, e.logs.length - 200); };

  async function start(name) {
    const def = config().mcpServers[name]; if (!def) throw new Error(`Không có máy chủ "${name}" trong mcp.json.`);
    await stop(name, { quiet: true });
    const e = entry(name); e.state = 'starting'; e.error = null; e.tools = []; onChange();
    const { Client, Stdio, Http, Sse } = S();
    try {
      let transport;
      if (def.url) {
        const u = new URL(def.url);
        transport = def.type === 'sse' || /\/sse\/?$/.test(u.pathname) ? new Sse(u) : new Http(u);
        addLog(name, `Kết nối ${def.type === 'sse' ? 'SSE' : 'HTTP'} ${u.origin}${u.pathname}`);
      } else {
        const r = resolveCommand(def.command, def.args || []);
        addLog(name, `Chạy: ${def.command} ${(def.args || []).join(' ')}${r.bundled ? ' (dùng Node đi kèm AIVN)' : ''}`);
        transport = new Stdio({ command: r.command, args: r.args, env: { ...process.env, ...r.env, ...(def.env || {}) }, stderr: 'pipe', cwd: def.cwd || undefined });
        transport.stderr && transport.stderr.on('data', (d) => addLog(name, String(d)));
      }
      const client = new Client({ name: 'AIVN', version: '0.15.0' }, { capabilities: {} });
      let earlyClose; const closed = new Promise((_, rej) => { earlyClose = () => rej(new Error('Máy chủ thoát ngay khi khởi động — xem nhật ký máy chủ bên dưới.')); });
      transport.onclose = () => { if (e.state === 'starting') earlyClose(); const x = servers.get(name); if (x && x.client === client && x.state === 'on') { x.state = 'error'; x.error = 'Máy chủ đã dừng.'; addLog(name, 'Máy chủ đã dừng'); onChange(); } };
      let tmo; closed.catch(() => {});
      await Promise.race([client.connect(transport), closed, new Promise((_, rej) => { tmo = setTimeout(() => rej(new Error('Quá 60 giây chưa kết nối được (lần đầu npx có thể phải tải gói).')), 60000); })]).finally(() => clearTimeout(tmo));
      const lt = await client.listTools();
      Object.assign(e, { client, transport, state: 'on', tools: (lt.tools || []).map(t => ({ name: t.name, full: toolName(name, t.name), description: t.description || '', inputSchema: t.inputSchema || { type: 'object', properties: {} } })) });
      addLog(name, `Đã kết nối · ${e.tools.length} công cụ: ${e.tools.map(t => t.name).join(', ')}`);
      log('mcp', `${name}: đã kết nối, ${e.tools.length} công cụ`);
    } catch (err) {
      e.state = 'error'; e.error = err.message; addLog(name, 'LỖI: ' + err.message); log('mcp', `${name}: lỗi ${err.message}`);
    }
    onChange(); return status(name);
  }
  async function stop(name, { quiet = false } = {}) {
    const e = servers.get(name); if (!e) return;
    const c = e.client; Object.assign(e, { client: null, transport: null, state: 'off', tools: [] });
    if (c) { try { await c.close(); } catch {} if (!quiet) addLog(name, 'Đã tắt'); }
    if (!quiet) onChange();
  }
  async function startEnabled() { for (const [n, d] of Object.entries(config().mcpServers)) if (!d.disabled) start(n).catch(() => {}); }
  function status(only) {
    const cfg = config().mcpServers;
    const list = Object.keys(cfg).map(n => { const e = entry(n); return { name: n, enabled: !cfg[n].disabled, kind: cfg[n].url ? (cfg[n].type === 'sse' ? 'sse' : 'http') : 'stdio', command: cfg[n].url || [cfg[n].command, ...(cfg[n].args || [])].join(' '), state: e.state, error: e.error, tools: e.tools.map(t => ({ name: t.name, full: t.full, description: t.description.slice(0, 200) })), logs: e.logs.slice(-60) }; });
    return only ? list.find(x => x.name === only) : list;
  }
  async function saveText(text) {
    const cfg = validate(JSON.parse(text));
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
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
  const live = () => [...servers.entries()].filter(([n, e]) => e.state === 'on' && !(config().mcpServers[n] || {}).disabled);
  function names() { return live().flatMap(([, e]) => e.tools.map(t => t.full)); }
  function defsMap() {
    const out = {};
    for (const [n, e] of live()) for (const t of e.tools) out[t.full] = { label: `${t.name} (${n})`, icon: '🔌', server: n, description: `[MCP · ${n}] ${t.description}`.slice(0, 1000), parameters: t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} } };
    return out;
  }
  async function exec(full, args, ctx = {}) {
    const hit = live().map(([n, e]) => ({ n, e, t: e.tools.find(t => t.full === full) })).find(x => x.t);
    if (!hit) throw new Error(`Công cụ MCP "${full}" không còn kết nối.`);
    addLog(hit.n, `Gọi ${hit.t.name} ${JSON.stringify(args).slice(0, 200)}`);
    const r = await hit.e.client.callTool({ name: hit.t.name, arguments: args || {} }, undefined, { signal: ctx.signal, timeout: 120000 });
    const text = resultText(r);
    if (r.isError) { addLog(hit.n, `Lỗi: ${text.slice(0, 200)}`); return { error: text, forModel: `Lỗi từ máy chủ MCP ${hit.n}: ${text}`, summary: text.slice(0, 160) }; }
    return { forModel: text, summary: `${hit.t.name} · ${text.split('\n')[0].slice(0, 120)}`, detail: text.slice(0, 3000) };
  }
  async function stopAll() { for (const n of [...servers.keys()]) await stop(n, { quiet: true }); }
  return { file, readText, config, status, start, stop, startEnabled, saveText, setEnabled, names, defs: defsMap, has: (n) => /^mcp__/.test(n) && names().includes(n), exec, stopAll };
}
// Mẫu dựng sẵn
function presets({ folder = null } = {}) {
  return {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', folder || '<chọn thư mục>'] },
    fetch: { command: 'npx', args: ['-y', 'mcp-fetch-server'] },
    memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }
  };
}
module.exports = { createMcpManager, validate, resolveCommand, toolName, safeName, resultText, presets };
