// Máy chủ API cục bộ tương thích OpenAI
const http = require('http');
const crypto = require('crypto');
const { normalizeTools, dropNullOptionals } = require('./schema');
const { handleMessages, anthropicError } = require('./anthropic-api');

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

// 0.16 (như LM Studio): getOpts() → { cors: bool, apiKey: string|null, loaded: () => [...] }
//   cors tắt (mặc định): không gửi Access-Control-Allow-Origin → trang web lạ mở trong trình duyệt KHÔNG gọi được API của bạn
//   apiKey: mọi yêu cầu phải có "Authorization: Bearer <khoá>" (hoặc x-api-key); bắt buộc khi mở cho mạng LAN
function keyOk(req, key) {
  const h = String(req.headers.authorization || ''); const got = /^Bearer\s+(.+)$/i.exec(h) ? /^Bearer\s+(.+)$/i.exec(h)[1].trim() : String(req.headers['x-api-key'] || '').trim();
  const a = Buffer.from(got); const b = Buffer.from(String(key));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function createApiServer({ engine, models, ensureModel, log, embeddings = null, isBlocked = null, getOpts = () => ({}) }) {
  let server = null;
  let port = null; let host = null;

  const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...cors() });
    res.end(JSON.stringify(obj));
  };
  const cors = () => (getOpts().cors ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, anthropic-version', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } : {});
  // B80: mọi phản hồi lỗi đều vào nhật ký kèm mã (trước đây 404 chỉ thấy “POST /v1/completions”, không thấy mã)
  const err = (res, code, message, type = 'invalid_request_error') => { if (code !== 401) log(`  → ${code} ${String(message).slice(0, 200)}`); return send(res, code, { error: { message, type, code } }); };

  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let settled = false;
    const dump = () => { req.removeAllListeners('data'); req.on('data', () => {}); req.resume(); };
    req.on('data', c => {
      if (settled) return;
      size += c.length;
      if (size > 20e6) {
        settled = true;
        const e = new Error('Body quá lớn'); e.status = 413;
        dump(); reject(e);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!settled) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', (e) => { if (!settled) reject(e); });
  });
  const tooBig = (e) => !!(e && e.status === 413);
  const sseHeaders = (req) => {
    const h = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...cors() };
    if (!req || req.httpVersion !== '1.0') h.Connection = 'keep-alive';
    return h;
  };

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
    const isAnthropic = p === '/v1/messages' || p === '/messages';
    const blocked = isBlocked && isBlocked();
    if (blocked) return isAnthropic ? anthropicError(res, 423, 'api_error', blocked, cors()) : err(res, 423, blocked, 'locked');
    const key = getOpts().apiKey;
    if (key && !keyOk(req, key)) {
      log(`${req.method} ${p} → 401 (thiếu hoặc sai khoá API) từ ${req.socket.remoteAddress || '?'}`);
      const msg = 'Thiếu hoặc sai khoá API. Gửi tiêu đề "Authorization: Bearer <khoá>" (khoá ở mục Máy chủ API của AIVN).';
      return isAnthropic ? anthropicError(res, 401, 'authentication_error', msg, cors()) : err(res, 401, msg, 'invalid_api_key');
    }
    log(`${req.method} ${p}${host === '0.0.0.0' ? ` từ ${req.socket.remoteAddress || '?'}` : ''}`);

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
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { if (tooBig(e)) return err(res, 413, 'Body quá lớn', 'payload_too_large'); return err(res, 400, 'JSON không hợp lệ'); }
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
          res.writeHead(200, sseHeaders(req));
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
        res.writeHead(200, sseHeaders(req));
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
    // B80: /v1/completions (kiểu cũ, theo “prompt”) — như LM Studio. Bộ máy chỉ chạy theo mẫu trò chuyện của mô hình nên
    // mỗi prompt được gửi như MỘT tin của người dùng; phản hồi đúng dạng OpenAI text_completion (cả stream, n prompt, echo, stop).
    if (req.method === 'POST' && (p === '/v1/completions' || p === '/completions')) {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { if (tooBig(e)) return err(res, 413, 'Body quá lớn', 'payload_too_large'); return err(res, 400, 'JSON không hợp lệ'); }
      let prompts = body.prompt;
      if (typeof prompts === 'string') prompts = [prompts];
      if (!Array.isArray(prompts) || !prompts.length || prompts.some(x => typeof x !== 'string')) return err(res, 400, 'Thiếu trường "prompt" (chuỗi hoặc mảng chuỗi; chưa hỗ trợ mảng token)');
      if (prompts.length > 16) return err(res, 400, 'Tối đa 16 prompt mỗi yêu cầu');
      if (body.stream && prompts.length > 1) return err(res, 400, '"stream" chỉ dùng với một prompt');
      try { await ensureModel(body.model); } catch (e) { return err(res, 400, e.message, 'model_not_found'); }
      const st = engine.status();
      const id = 'cmpl-' + crypto.randomBytes(12).toString('hex');
      const created = Math.floor(Date.now() / 1000);
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      const opts = { temperature: body.temperature ?? 0.7, topP: body.top_p, maxTokens: body.max_tokens ?? 256, signal: ac.signal };
      const stops = (Array.isArray(body.stop) ? body.stop : body.stop ? [body.stop] : []).filter(x => typeof x === 'string' && x).slice(0, 4);
      const cut = (t) => { let at = -1; for (const x of stops) { const i = t.indexOf(x); if (i >= 0 && (at < 0 || i < at)) at = i; } return at < 0 ? { text: t, stopped: false } : { text: t.slice(0, at), stopped: true }; };
      const msgs = (pr) => [{ role: 'user', content: pr }];
      if (body.stream) {
        res.writeHead(200, sseHeaders(req));
        const chunk = (text, finish = null) => res.write('data: ' + JSON.stringify({ id, object: 'text_completion', created, model: st.id, choices: [{ index: 0, text, logprobs: null, finish_reason: finish }] }) + '\n\n');
        if (body.echo) chunk(prompts[0]);
        let acc = '', sent = 0, stopped = false;
        try {
          const r = await engine.generate(msgs(prompts[0]), { ...opts, onToken: (t) => { if (stopped) return; acc += t; const c = cut(acc); if (c.stopped) { stopped = true; if (c.text.length > sent) chunk(c.text.slice(sent)); sent = c.text.length; ac.abort(); return; } const safe = acc.length - Math.max(0, ...stops.map(x => x.length - 1)); if (safe > sent) { chunk(acc.slice(sent, safe)); sent = safe; } } }).catch((e) => { if (stopped) return { finishReason: 'stop' }; throw e; });
          if (!stopped && acc.length > sent) chunk(acc.slice(sent));
          chunk('', stopped ? 'stop' : r && r.finishReason === 'length' ? 'length' : 'stop');
          res.write('data: [DONE]\n\n');
        } catch (e) { res.write('data: ' + JSON.stringify({ error: { message: e.message } }) + '\n\n'); }
        return res.end();
      }
      try {
        const choices = []; let pt = 0, ct = 0;
        for (const [index, pr] of prompts.entries()) {
          const r = await engine.generate(msgs(pr), opts); const c = cut(r.text || '');
          choices.push({ index, text: (body.echo ? pr : '') + c.text, logprobs: null, finish_reason: c.stopped ? 'stop' : r.finishReason === 'length' ? 'length' : 'stop' });
          const u = await usageOf(r, msgs(pr)); pt += u.prompt_tokens; ct += u.completion_tokens;
        }
        log(`  → 200 text_completion × ${choices.length}`);
        return send(res, 200, { id, object: 'text_completion', created, model: st.id, choices, usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct } });
      } catch (e) { return err(res, 500, e.message, 'server_error'); }
    }
    if (req.method === 'POST' && (p === '/v1/embeddings' || p === '/embeddings')) {
      if (!embeddings) return err(res, 501, 'Máy chủ này không hỗ trợ embeddings');
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { if (tooBig(e)) return err(res, 413, 'Body quá lớn', 'payload_too_large'); return err(res, 400, 'JSON không hợp lệ'); }
      let input = body.input;
      if (typeof input === 'string') input = [input];
      if (!Array.isArray(input) || !input.length) return err(res, 400, 'Thiếu trường "input" (chuỗi hoặc mảng chuỗi)');
      if (input.some(x => typeof x !== 'string')) return err(res, 400, 'AIVN chỉ nhận "input" dạng chuỗi (chưa hỗ trợ mảng token)');
      if (input.length > 256) return err(res, 400, 'Tối đa 256 chuỗi mỗi yêu cầu');
      const fmt = body.encoding_format || 'float';
      if (!['float', 'base64'].includes(fmt)) return err(res, 400, '"encoding_format" phải là "float" hoặc "base64"');
      let info;
      try { info = await embeddings.ensure(body.model); if (body.model && info && info.id !== body.model) log(`  (mô hình nhúng “${String(body.model).slice(0, 60)}” → dùng ${info.id})`); } catch (e) { return err(res, e.status || 400, e.message, 'model_not_found'); }
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
    if (isAnthropic) {
      if (req.method !== 'POST') {
        const message = `Không tìm thấy ${req.method} ${p}`;
        log(`  → 404 ${message}`);
        return anthropicError(res, 404, 'not_found_error', message, cors());
      }
      return handleMessages({ req, res, engine, ensureModel, log, cors, readBody });
    }
    return err(res, 404, `Không tìm thấy ${req.method} ${p}`);
  }

  return {
    start(p = 1234, h = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        if (server) return resolve(port);
        const s = http.createServer((req, res) => handle(req, res).catch(e => { try { err(res, 500, e.message, 'server_error'); } catch {} }));
        s.once('error', reject);
        s.listen(p, h, () => { server = s; port = p; host = h; log(`Máy chủ đang chạy tại http://${h}:${p}${h === '0.0.0.0' ? ' (mọi thiết bị trong mạng nội bộ)' : ''}`); resolve(p); });
      });
    },
    stop() {
      return new Promise(resolve => { if (!server) return resolve(); server.close(() => resolve()); server.closeAllConnections?.(); server = null; port = null; host = null; log('Đã dừng máy chủ'); });
    },
    status() { return { running: !!server, port, host }; },
  };
}
module.exports = { createApiServer, keyOk };
