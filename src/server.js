// Máy chủ API cục bộ tương thích OpenAI
const http = require('http');
const crypto = require('crypto');
const { normalizeTools, dropNullOptionals } = require('./schema');

// tool_choice kiểu OpenAI → 'auto' | 'none' | 'required' | { name }
function parseToolChoice(tc, tools) {
  if (tc == null) return tools.length ? 'auto' : 'none';
  if (tc === 'auto' || tc === 'none' || tc === 'required') return tc;
  if (typeof tc === 'object' && tc.type === 'function' && tc.function && typeof tc.function.name === 'string') {
    if (!tools.some(t => t.name === tc.function.name)) throw new Error(`tool_choice chỉ tới công cụ "${tc.function.name}" không có trong "tools"`);
    return { name: tc.function.name };
  }
  throw new Error('"tool_choice" phải là "auto", "none", "required" hoặc {"type":"function","function":{"name":…}}');
}
function parseResponseFormat(rf) {
  if (rf == null || rf.type === 'text') return null;
  if (rf.type === 'json_object') return { type: 'json_object' };
  if (rf.type === 'json_schema') {
    const js = rf.json_schema || {};
    if (!js.schema || typeof js.schema !== 'object') throw new Error('response_format.json_schema.schema phải là một JSON Schema');
    return { type: 'json_schema', schema: js.schema, name: js.name || 'output' };
  }
  throw new Error('"response_format.type" phải là "text", "json_object" hoặc "json_schema"');
}

function createApiServer({ engine, models, ensureModel, log, embeddings = null, isBlocked = null }) {
  let server = null;
  let port = null;

  const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...cors() });
    res.end(JSON.stringify(obj));
  };
  const cors = () => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  const err = (res, code, message, type = 'invalid_request_error') => send(res, code, { error: { message, type, code } });

  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20e6) { reject(new Error('Body quá lớn')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  // số token lời nhắc (OpenAI usage.prompt_tokens): lấy từ máy chạy nếu có, không thì đếm bằng bộ tách từ của mô hình
  const promptTokens = async (r, messages) => {
    if (r && r.usage && Number.isFinite(r.usage.prompt_tokens) && r.usage.prompt_tokens > 0) return r.usage.prompt_tokens;
    try {
      const txt = messages.map(m => { const c = m && m.content; return typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x && x.text || '').join(' ') : ''; });
      const n = engine.countTokens ? txt.reduce((a, t) => a + (Number(engine.countTokens(t)) || 0), 0) : 0;
      return n + messages.length * 4;
    } catch { return 0; }
  };
  const usageOf = async (r, messages) => { const pt = await promptTokens(r, messages); const ct = r.usage.completion_tokens || 0; return { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct }; };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.replace(/\/+$/, '');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
    const blocked = isBlocked && isBlocked();
    if (blocked) return err(res, 423, blocked, 'locked');
    log(`${req.method} ${p}`);

    if (req.method === 'GET' && (p === '/v1/models' || p === '/models')) {
      const st = engine.status();
      const data = models().map(m => ({ id: m.id, object: 'model', created: Math.floor(m.mtime / 1000), owned_by: 'aivn', loaded: st.loaded && st.id === m.id, ...(m.vision ? { vision: true } : {}) }));
      const em = embeddings && embeddings.info();
      if (em && em.installed) data.push({ id: em.id, object: 'model', created: Math.floor((em.mtime || Date.now()) / 1000), owned_by: 'aivn', type: 'embedding' });
      return send(res, 200, { object: 'list', data });
    }
    if (req.method === 'GET' && (p === '' || p === '/' || p === '/health')) return send(res, 200, { status: 'ok', app: 'AIVN', model: engine.status() });

    if (req.method === 'POST' && (p === '/v1/chat/completions' || p === '/chat/completions')) {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch { return err(res, 400, 'JSON không hợp lệ'); }
      if (!Array.isArray(body.messages) || !body.messages.length) return err(res, 400, 'Thiếu trường "messages"');
      try { await ensureModel(body.model); } catch (e) { return err(res, 400, e.message, 'model_not_found'); }

      const st = engine.status();
      const id = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
      const created = Math.floor(Date.now() / 1000);
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      const opts = { temperature: body.temperature ?? 0.7, topP: body.top_p, maxTokens: body.max_tokens ?? body.max_completion_tokens ?? 1024, signal: ac.signal };
      // Gọi công cụ (tools/tool_choice) và đầu ra JSON (response_format): công cụ do ứng dụng gọi API tự chạy, AIVN chỉ trả tool_calls
      let tools, toolChoice, responseFormat;
      try { tools = normalizeTools(body.tools); toolChoice = parseToolChoice(body.tool_choice, tools); responseFormat = parseResponseFormat(body.response_format); }
      catch (e) { return err(res, 400, e.message); }
      const usesTools = tools.length || responseFormat || body.messages.some(m => m && (m.role === 'tool' || Array.isArray(m.tool_calls)));
      if (usesTools) {
        const byName = new Map(tools.map(t => [t.name, t]));
        const toOpenAi = (calls) => calls.map((c, index) => ({ index, id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(dropNullOptionals(c.arguments ?? {}, byName.get(c.name)?.parameters)) } }));
        const stepOpts = { ...opts, tools, toolChoice, responseFormat };
        if (body.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors() });
          const chunk = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model: st.id, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
          chunk({ role: 'assistant', content: '' });
          try {
            const r = await engine.chatStep(body.messages, { ...stepOpts, onToken: t => chunk({ content: t }) });
            if (responseFormat && r.text) chunk({ content: r.text }); // đầu ra JSON được gửi trọn một lần khi xong
            if (r.toolCalls.length) chunk({ tool_calls: toOpenAi(r.toolCalls) });
            chunk({}, r.toolCalls.length ? 'tool_calls' : r.finishReason === 'length' ? 'length' : 'stop');
            res.write('data: [DONE]\n\n');
          } catch (e) { res.write('data: ' + JSON.stringify({ error: { message: e.message } }) + '\n\n'); }
          return res.end();
        }
        try {
          const r = await engine.chatStep(body.messages, stepOpts);
          const message = { role: 'assistant', content: r.toolCalls.length && !r.text ? null : r.text };
          if (r.toolCalls.length) message.tool_calls = toOpenAi(r.toolCalls).map(({ index, ...c }) => c);
          log(`  → ${r.toolCalls.length ? 'tool_calls: ' + r.toolCalls.map(c => c.name).join(', ') : responseFormat ? 'JSON theo lược đồ' : 'văn bản'}`);
          return send(res, 200, {
            id, object: 'chat.completion', created, model: st.id,
            choices: [{ index: 0, message, finish_reason: r.toolCalls.length ? 'tool_calls' : r.finishReason === 'length' ? 'length' : 'stop' }],
            usage: await usageOf(r, body.messages),
          });
        } catch (e) { return err(res, 500, e.message, 'server_error'); }
      }

      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors() });
        const chunk = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model: st.id, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
        chunk({ role: 'assistant', content: '' });
        try {
          const r = await engine.generate(body.messages, { ...opts, onToken: t => chunk({ content: t }) });
          chunk({}, r.finishReason === 'length' ? 'length' : 'stop');
          res.write('data: [DONE]\n\n');
        } catch (e) {
          res.write('data: ' + JSON.stringify({ error: { message: e.message } }) + '\n\n');
        }
        return res.end();
      }
      try {
        const r = await engine.generate(body.messages, opts);
        return send(res, 200, {
          id, object: 'chat.completion', created, model: st.id,
          choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: r.finishReason === 'length' ? 'length' : 'stop' }],
          usage: await usageOf(r, body.messages),
        });
      } catch (e) { return err(res, 500, e.message, 'server_error'); }
    }
    if (req.method === 'POST' && (p === '/v1/embeddings' || p === '/embeddings')) {
      if (!embeddings) return err(res, 501, 'Máy chủ này không hỗ trợ embeddings');
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch { return err(res, 400, 'JSON không hợp lệ'); }
      let input = body.input;
      if (typeof input === 'string') input = [input];
      if (!Array.isArray(input) || !input.length) return err(res, 400, 'Thiếu trường "input" (chuỗi hoặc mảng chuỗi)');
      if (input.some(x => typeof x !== 'string')) return err(res, 400, 'AIVN chỉ nhận "input" dạng chuỗi (chưa hỗ trợ mảng token)');
      if (input.length > 256) return err(res, 400, 'Tối đa 256 chuỗi mỗi yêu cầu');
      const fmt = body.encoding_format || 'float';
      if (!['float', 'base64'].includes(fmt)) return err(res, 400, '"encoding_format" phải là "float" hoặc "base64"');
      let info;
      try { info = await embeddings.ensure(body.model); } catch (e) { return err(res, e.status || 400, e.message, 'model_not_found'); }
      try {
        const vecs = await embeddings.embed(input);
        const dims = Number(body.dimensions) > 0 ? Math.min(Number(body.dimensions), vecs[0].length) : null;
        const fit = (v) => { if (!dims) return v; const u = v.slice(0, dims); let n = 0; for (const x of u) n += x * x; n = Math.sqrt(n) || 1; return u.map(x => x / n); };
        const tokens = await embeddings.count(input).catch(() => input.reduce((s, t) => s + Math.ceil(t.length / 3), 0));
        return send(res, 200, {
          object: 'list', model: info.id,
          data: vecs.map((v, index) => { const f = fit(v); return { object: 'embedding', index, embedding: fmt === 'base64' ? Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64') : Array.from(f) }; }),
          usage: { prompt_tokens: tokens, total_tokens: tokens },
        });
      } catch (e) { return err(res, 500, e.message, 'server_error'); }
    }
    return err(res, 404, `Không tìm thấy ${req.method} ${p}`);
  }

  return {
    start(p = 1234, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        if (server) return resolve(port);
        const s = http.createServer((req, res) => handle(req, res).catch(e => { try { err(res, 500, e.message, 'server_error'); } catch {} }));
        s.once('error', reject);
        s.listen(p, host, () => { server = s; port = p; log(`Máy chủ đang chạy tại http://${host}:${p}`); resolve(p); });
      });
    },
    stop() {
      return new Promise(resolve => { if (!server) return resolve(); server.close(() => resolve()); server.closeAllConnections?.(); server = null; port = null; log('Đã dừng máy chủ'); });
    },
    status() { return { running: !!server, port }; },
  };
}
module.exports = { createApiServer };
