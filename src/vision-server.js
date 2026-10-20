const TP = require('./agent/textproto');
// Chế độ "nhìn ảnh": chạy llama-server chính thức của llama.cpp (MIT) với --mmproj cho mô hình thị giác.
// Chỉ dùng cho mô hình có tệp mmproj; mô hình chữ thường vẫn chạy bằng node-llama-cpp.
// Máy chủ chỉ nghe 127.0.0.1, cổng ngẫu nhiên, có khoá API ngẫu nhiên theo phiên.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
// Windows: STATUS_DLL_NOT_FOUND khi thiếu Microsoft Visual C++ Redistributable
const DLL_NOT_FOUND = [3221225781, -1073741515];

function findServer() {
  const plat = process.platform === 'win32' ? 'win' : process.platform;
  const cands = [process.env.AIVN_LLAMA_SERVER,
    process.env.AIVN_RESOURCES && path.join(process.env.AIVN_RESOURCES, 'llama', EXE),
    path.join(__dirname, '..', 'build', 'llama', `${plat}-${process.arch}`, EXE)].filter(Boolean);
  return cands.find(p => fs.existsSync(p)) || null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

class VisionError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

function createVisionServer({ log = () => {} } = {}) {
  let proc = null, port = 0, key = '', info = null, tail = [];

  async function start({ id, modelPath, mmprojPath, contextSize = 4096, gpu = true, threads }) {
    await stop();
    const exe = findServer();
    if (!exe) throw new VisionError('Bản AIVN này thiếu bộ máy nhìn ảnh (llama-server). Hãy cài lại AIVN.', 'NO_SERVER');
    port = await freePort(); key = crypto.randomBytes(18).toString('hex'); tail = [];
    const args = ['-m', modelPath, ...(mmprojPath ? ['--mmproj', mmprojPath] : []), ...(process.env.AIVN_TEST_CHAT_TEMPLATE ? ['--chat-template-file', process.env.AIVN_TEST_CHAT_TEMPLATE] : []), '--host', '127.0.0.1', '--port', String(port), '--api-key', key,
      '-c', String(contextSize), '-np', '1', '--no-webui', '--offline', '--jinja'];
    if (!gpu) args.push('-ngl', '0', ...(mmprojPath ? ['--no-mmproj-offload'] : []));
    if (threads) args.push('-t', String(threads));
    const t0 = Date.now();
    proc = spawn(exe, args, { cwd: path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, LLAMA_ARG_HOST: '127.0.0.1' } });
    const onData = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { tail.push(l); if (tail.length > 40) tail.shift(); } };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    const exited = new Promise((resolve) => proc.once('exit', (code, signal) => resolve({ code, signal })));
    proc.once('exit', (code, signal) => { log(`[vision] llama-server kết thúc code=${code} signal=${signal}`); proc = null; info = null; });
    // Chờ /health trả 200 (mô hình + mmproj đã nạp) hoặc tiến trình thoát
    while (true) {
      const r = await Promise.race([exited.then(x => ({ exit: x })), new Promise(r => setTimeout(r, 400, null))]);
      if (r && r.exit) {
        const { code } = r.exit;
        if (process.platform === 'win32' && DLL_NOT_FOUND.includes(code)) throw new VisionError('Máy thiếu Microsoft Visual C++ Redistributable (x64), cần cho chế độ nhìn ảnh.', 'VCREDIST');
        const last = tail.filter(l => /error|failed|unknown|unsupported/i.test(l)).slice(-2).join(' · ');
        throw new VisionError('Không nạp được mô hình nhìn ảnh' + (last ? ': ' + last.slice(0, 300) : ` (mã ${code})`), 'START_FAILED');
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: 'Bearer ' + key } });
        if (res.ok) break;
      } catch {}
      if (Date.now() - t0 > 10 * 60 * 1000) { await stop(); throw new VisionError('Nạp mô hình nhìn ảnh quá lâu.', 'TIMEOUT'); }
    }
    let ctx = contextSize, template = TP.analyzeTemplate('');
    try { const p = await (await fetch(`http://127.0.0.1:${port}/props`, { headers: { authorization: 'Bearer ' + key } })).json(); ctx = p?.default_generation_settings?.n_ctx || ctx; template = TP.analyzeTemplate(p?.chat_template); } catch {}
    info = { id, path: modelPath, mmproj: mmprojPath, contextSize: ctx, vision: true, loadedAt: Date.now(), template, textTools: template.strict || (template.known && !template.nativeTools) };
    if (info.textTools) log(`[vision] mẫu chat ${template.strict ? 'bắt buộc xen kẽ user/assistant' : 'không hỗ trợ tools'}: dùng giao thức công cụ dạng văn bản của AIVN`);
    log(`[vision] llama-server sẵn sàng (cổng ${port}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    return info;
  }

  async function stop() {
    if (!proc) return;
    const p = proc; proc = null; info = null;
    await new Promise((resolve) => { const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 3000); p.once('exit', () => { clearTimeout(t); resolve(); }); try { p.kill(); } catch { resolve(); } });
  }

  // messages kiểu OpenAI; phần ảnh: {type:'image_url', image_url:{url:'data:image/png;base64,…'}}
  async function stream(extra, messages, { temperature = 0.7, maxTokens = 1024, topP, signal, onToken } = {}) {
    if (!info) throw new Error('Chưa nạp mô hình nhìn ảnh.');
    const t0 = Date.now();
    // chống lặp: DRY (bắt chuỗi lặp dài) + phạt lặp nhẹ; mô hình nhìn ảnh nhỏ dễ lặp câu khi mô tả
    const body = { messages, temperature, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true }, top_k: 40, min_p: 0.05,
      repeat_penalty: 1.05, repeat_last_n: 256, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, ...(topP != null ? { top_p: topP } : { top_p: 0.9 }), ...extra };
    let res;
    const empty = () => ({ text: '', toolCalls: [], finishReason: 'abort', usage: { completion_tokens: 0, tokensPerSecond: 0, seconds: 0 } });
    try {
      res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
    } catch (e) { if (signal?.aborted) return empty(); throw e; }
    if (!res.ok) { const t = await res.text().catch(() => ''); let m = t; try { m = JSON.parse(t).error.message; } catch {} throw new Error('Mô hình nhìn ảnh báo lỗi: ' + String(m).slice(0, 300)); }
    let text = '', finishReason = 'stop', usage = null, buf = '';
    const calls = []; // gom tool_calls theo index
    const dec = new TextDecoder();
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim(); if (data === '[DONE]') continue;
          let j; try { j = JSON.parse(data); } catch { continue; }
          const c = j.choices && j.choices[0];
          const piece = c?.delta?.content;
          if (piece) { text += piece; if (!extra.response_format) onToken && onToken(piece); }
          for (const tc of c?.delta?.tool_calls || []) {
            const k = tc.index ?? calls.length;
            calls[k] ||= { id: tc.id || '', name: '', args: '' };
            if (tc.id) calls[k].id = tc.id;
            if (tc.function?.name) calls[k].name += tc.function.name;
            if (tc.function?.arguments) calls[k].args += tc.function.arguments;
          }
          if (c?.finish_reason) finishReason = c.finish_reason;
          if (j.usage) usage = j.usage;
        }
      }
    } catch (e) { if (!signal?.aborted) throw e; finishReason = 'abort'; }
    if (signal?.aborted) finishReason = 'abort';
    const secs = (Date.now() - t0) / 1000;
    const ct = usage?.completion_tokens ?? Math.ceil(text.length / 3.5);
    const toolCalls = calls.filter(Boolean).filter(c => c.name).map(c => { let a = {}; try { a = JSON.parse(c.args || '{}'); } catch { a = { _raw: c.args }; } return { id: c.id || 'call_' + crypto.randomBytes(9).toString('hex'), name: c.name, arguments: a }; });
    if (toolCalls.length && finishReason !== 'abort') finishReason = 'tool_calls';
    return { text: text.replace(/^\s+/, ''), toolCalls, finishReason, usage: { prompt_tokens: usage?.prompt_tokens, completion_tokens: ct, tokensPerSecond: secs > 0 ? ct / secs : 0, seconds: secs } };
  }
  const generate = (messages, opts = {}) => stream({}, info && info.template && info.template.strict ? TP.normalizeMessages(messages) : messages, opts);
  // Chế độ văn bản: không gửi "tools" cho llama-server (tránh bộ sinh parser --jinja), mô tả công cụ trong lời nhắc và tự tách <tool_call>
  async function textStep(messages, { tools = [], toolChoice = 'auto', responseFormat = null, ...opts }) {
    const offer = toolChoice === 'none' ? [] : tools;
    const extra = {};
    const forced = offer.length && toolChoice && toolChoice !== 'auto' ? (typeof toolChoice === 'object' ? offer.filter(t => t.name === toolChoice.name) : offer) : null;
    if (forced && forced.length) {
      // buộc gọi công cụ: ràng buộc đầu ra JSON {"name","arguments"} bằng json_schema của llama-server
      const schema = { oneOf: forced.map(t => ({ type: 'object', properties: { name: { const: t.name }, arguments: t.parameters && t.parameters.properties && Object.keys(t.parameters.properties).length ? t.parameters : { type: 'object' } }, required: ['name', 'arguments'] })) };
      const note = { role: 'user', content: 'Chỉ trả lời bằng MỘT đối tượng JSON {"name": "<tên công cụ>", "arguments": {…}} để gọi một công cụ trong danh sách.' };
      const r = await stream({ response_format: { type: 'json_schema', json_schema: { name: 'call', schema } } }, TP.normalizeMessages([...messages, note], { tools: forced }), { ...opts, onToken: null });
      let j = null; try { j = JSON.parse(r.text); } catch {}
      if (j && typeof j.name === 'string') return { ...r, text: '', toolCalls: [{ id: 'call_' + crypto.randomBytes(9).toString('hex'), name: j.name, arguments: j.arguments || {} }], finishReason: 'tool_calls' };
      return r;
    }
    if (responseFormat) extra.response_format = responseFormat.type === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'output', schema: responseFormat.schema || {} } } : { type: 'json_object' };
    const f = TP.streamFilter(opts.onToken);
    const r = await stream(extra, TP.normalizeMessages(messages, { tools: offer }), { ...opts, onToken: (t) => f.push(t) });
    f.end();
    if (!offer.length || r.finishReason === 'abort') return r;
    const p = TP.parseToolCalls(r.text, offer.map(t => t.name));
    return { ...r, text: p.text, toolCalls: p.toolCalls, finishReason: p.toolCalls.length ? 'tool_calls' : r.finishReason };
  }
  // Có công cụ / đầu ra JSON: llama-server tự áp mẫu hội thoại (--jinja) và ngữ pháp cho tool_calls / json_schema
  async function chatStep(messages, { tools = [], toolChoice = 'auto', responseFormat = null, ...opts } = {}) {
    if (info && (info.textTools || (info.template && info.template.strict))) return textStep(messages, { tools, toolChoice, responseFormat, ...opts });
    try { return await nativeStep(messages, { tools, toolChoice, responseFormat, ...opts }); }
    catch (e) {
      if (!TP.isTemplateError(e.message) || !info) throw e;
      // llama-server không dựng được parser cho mẫu chat này (vd. Gemma 3): chuyển hẳn sang giao thức văn bản cho mô hình này
      log('[vision] mẫu chat lỗi với --jinja/tools, chuyển sang giao thức công cụ văn bản: ' + String(e.message).slice(0, 200));
      info.textTools = true; info.template = { ...(info.template || {}), strict: true };
      return textStep(messages, { tools, toolChoice, responseFormat, ...opts });
    }
  }
  function nativeStep(messages, { tools = [], toolChoice = 'auto', responseFormat = null, ...opts } = {}) {
    const extra = {};
    if (tools.length) {
      extra.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } } }));
      extra.tool_choice = typeof toolChoice === 'object' && toolChoice ? { type: 'function', function: { name: toolChoice.name } } : toolChoice || 'auto';
      extra.parallel_tool_calls = true;
    }
    if (responseFormat) extra.response_format = responseFormat.type === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'output', schema: responseFormat.schema || {} } } : { type: 'json_object' };
    return stream(extra, messages, opts);
  }

  async function countTokens(texts) {
    if (!info) return null;
    try {
      return await Promise.all(texts.map(async (t) => (await (await fetch(`http://127.0.0.1:${port}/tokenize`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ content: t }) })).json()).tokens.length));
    } catch { return null; }
  }

  return { start, stop, generate, chatStep, countTokens, status: () => info, available: () => !!findServer() };
}

module.exports = { createVisionServer, findServer, VisionError };
