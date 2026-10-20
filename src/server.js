// Máy chủ API cục bộ tương thích OpenAI
const http = require('http');
const crypto = require('crypto');

function createApiServer({ engine, models, ensureModel, log }) {
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

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.replace(/\/+$/, '');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
    log(`${req.method} ${p}`);

    if (req.method === 'GET' && (p === '/v1/models' || p === '/models')) {
      const st = engine.status();
      return send(res, 200, { object: 'list', data: models().map(m => ({ id: m.id, object: 'model', created: Math.floor(m.mtime / 1000), owned_by: 'aivn', loaded: st.loaded && st.id === m.id })) });
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
          usage: { prompt_tokens: 0, completion_tokens: r.usage.completion_tokens, total_tokens: r.usage.completion_tokens },
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
