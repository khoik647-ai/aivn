'use strict';
// POST /v1/messages — lớp dịch chuẩn Anthropic sang đúng đường /v1/chat/completions (engine.generate / engine.chatStep).
// Không nạp mô hình riêng. metadata bị bỏ qua. anthropic-version chỉ cần có mặt, không bị từ chối.
const crypto = require('crypto');
const { normalizeTools } = require('./schema');

class AnthropicError extends Error {
  constructor(message, status = 400, type = 'invalid_request_error') { super(message); this.status = status; this.type = type; }
}

function anthropicError(res, status, type, message, headers) {
  const body = JSON.stringify({ type: 'error', error: { type, message: String(message || '') } });
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...(headers || {}) });
  res.end(body);
}

function sse(res, event, data) {
  if (res.writableEnded || res.destroyed) return false;
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); return true; }
  catch { return false; }
}

function asText(block) {
  if (typeof block === 'string') return block;
  if (block && block.type === 'text' && typeof block.text === 'string') return block.text;
  return null;
}

function toolResultText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const bits = content.map(asText);
    if (bits.some((x) => x == null)) throw new AnthropicError('tool_result.content chỉ nhận chuỗi hoặc khối text');
    return bits.join('\n');
  }
  throw new AnthropicError('tool_result.content chỉ nhận chuỗi hoặc khối text');
}

function partsOf(content, role) {
  if (typeof content === 'string') return [{ kind: 'text', text: content }];
  if (!Array.isArray(content) || !content.length) throw new AnthropicError(`Tin nhắn "${role}" thiếu content (chuỗi hoặc mảng khối text)`);
  const out = [];
  for (const b of content) {
    if (typeof b === 'string') { out.push({ kind: 'text', text: b }); continue; }
    if (!b || typeof b !== 'object' || typeof b.type !== 'string') throw new AnthropicError('Mỗi khối content phải có "type"');
    if (b.type === 'text') {
      if (typeof b.text !== 'string') throw new AnthropicError('Khối text thiếu "text"');
      out.push({ kind: 'text', text: b.text });
    } else if (b.type === 'tool_use') {
      if (role !== 'assistant') throw new AnthropicError('tool_use chỉ nằm trong tin nhắn assistant');
      if (typeof b.name !== 'string' || !b.name) throw new AnthropicError('tool_use thiếu "name"');
      if (b.id == null || b.id === '') throw new AnthropicError('tool_use thiếu "id"');
      const input = b.input == null ? {} : b.input;
      if (typeof input !== 'object' || Array.isArray(input)) throw new AnthropicError('tool_use.input phải là một đối tượng');
      out.push({ kind: 'tool_use', id: String(b.id), name: b.name, input });
    } else if (b.type === 'tool_result') {
      if (role !== 'user') throw new AnthropicError('tool_result chỉ nằm trong tin nhắn user');
      if (b.tool_use_id == null || b.tool_use_id === '') throw new AnthropicError('tool_result thiếu "tool_use_id"');
      let text = toolResultText(b.content);
      if (b.is_error === true) text = 'Lỗi: ' + text;
      out.push({ kind: 'tool_result', id: String(b.tool_use_id), text });
    } else if ((b.type === 'thinking' || b.type === 'redacted_thinking') && role === 'assistant') {
      // Claude Code gửi lại khối suy luận ở lượt sau. Bỏ qua, không trả 400.
    } else throw new AnthropicError(`Khối "${b.type}" chưa được hỗ trợ. AIVN nhận text, tool_use và tool_result.`);
  }
  return out;
}

function systemText(system) {
  if (system == null) return '';
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) throw new AnthropicError('"system" phải là chuỗi hoặc mảng khối text');
  const bits = system.map((b) => { const t = asText(b); if (t == null) throw new AnthropicError('"system" chỉ nhận khối text'); return t; });
  return bits.join('\n\n');
}

function mapTools(tools) {
  if (tools == null) return [];
  if (!Array.isArray(tools)) throw new AnthropicError('"tools" phải là một mảng');
  let normalized;
  try {
    normalized = normalizeTools(tools.map((t) => {
      if (!t || typeof t !== 'object') throw new AnthropicError('Mỗi công cụ phải là một đối tượng');
      return { name: t.name, description: typeof t.description === 'string' ? t.description : '', parameters: t.input_schema && typeof t.input_schema === 'object' ? t.input_schema : { type: 'object', properties: {} } };
    }));
  } catch (e) {
    if (e instanceof AnthropicError) throw e;
    throw new AnthropicError(e.message);
  }
  return normalized;
}

function mapToolChoice(tc, tools) {
  if (tc == null) return tools.length ? 'auto' : 'none';
  if (typeof tc !== 'object') throw new AnthropicError('"tool_choice" phải là một đối tượng');
  if (tc.type === 'auto') return 'auto';
  if (tc.type === 'any') return 'required';
  if (tc.type === 'none') return 'none';
  if (tc.type === 'tool') {
    if (typeof tc.name !== 'string' || !tools.some((t) => t.name === tc.name)) throw new AnthropicError(`tool_choice chỉ tới công cụ "${tc.name}" không có trong "tools"`);
    return { name: tc.name };
  }
  throw new AnthropicError('"tool_choice.type" phải là "auto", "any", "tool" hoặc "none"');
}

function num(name, v, { min, max, integer = false }) {
  if (typeof v !== 'number' || !Number.isFinite(v) || (integer && !Number.isInteger(v)) || v < min || v > max) {
    throw new AnthropicError(`"${name}" phải là ${integer ? 'số nguyên' : 'số'} từ ${min} đến ${max}`);
  }
  return v;
}

// body Anthropic → lời gọi giống /v1/chat/completions
function translateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AnthropicError('JSON phải là một đối tượng');
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) throw new AnthropicError('Thiếu "max_tokens" (số nguyên ≥ 1)');
  if (body.max_tokens > 200000) throw new AnthropicError('"max_tokens" quá lớn');
  if (!Array.isArray(body.messages) || !body.messages.length) throw new AnthropicError('Thiếu trường "messages"');
  if (body.model != null && typeof body.model !== 'string') throw new AnthropicError('"model" phải là chuỗi');
  if (body.stream != null && typeof body.stream !== 'boolean') throw new AnthropicError('"stream" phải là true hoặc false');
  const system = systemText(body.system);
  const temperature = body.temperature == null ? 0.7 : num('temperature', body.temperature, { min: 0, max: 2 });
  const topP = body.top_p == null ? null : num('top_p', body.top_p, { min: 0, max: 1 });
  const topK = body.top_k == null ? null : num('top_k', body.top_k, { min: 0, max: 100000, integer: true });
  let stops = [];
  if (body.stop_sequences != null) {
    if (!Array.isArray(body.stop_sequences) || body.stop_sequences.some((s) => typeof s !== 'string' || !s)) throw new AnthropicError('"stop_sequences" phải là mảng chuỗi khác rỗng');
    if (body.stop_sequences.length > 8) throw new AnthropicError('Tối đa 8 stop_sequences');
    stops = body.stop_sequences.slice();
  }
  const tools = mapTools(body.tools);
  const toolChoice = mapToolChoice(body.tool_choice, tools);
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  let sawUser = false;
  for (const m of body.messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new AnthropicError('Mỗi tin nhắn phải có role "user" hoặc "assistant"');
    const parts = partsOf(m.content, m.role);
    if (m.role === 'user') {
      sawUser = true;
      const texts = [];
      const flush = () => { const joined = texts.join('\n'); texts.length = 0; if (joined) messages.push({ role: 'user', content: joined }); };
      for (const p of parts) {
        if (p.kind === 'tool_result') { flush(); messages.push({ role: 'tool', tool_call_id: p.id, content: p.text }); }
        else texts.push(p.text);
      }
      flush();
    } else {
      const text = parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n');
      const calls = parts.filter((p) => p.kind === 'tool_use');
      const msg = { role: 'assistant', content: text };
      if (calls.length) msg.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } }));
      messages.push(msg);
    }
  }
  if (!sawUser) throw new AnthropicError('Cần ít nhất một tin nhắn của người dùng');
  const usesTools = tools.length > 0 || messages.some((m) => m.role === 'tool' || (m.tool_calls && m.tool_calls.length));
  return {
    model: body.model || '',
    messages,
    temperature, topP, topK, stops, tools, toolChoice, usesTools,
    stream: body.stream === true,
    maxTokens: body.max_tokens,
  };
}

function cutStop(text, stops) {
  let at = -1; let which = null;
  for (const s of stops || []) {
    const i = String(text).indexOf(s);
    if (i >= 0 && (at < 0 || i < at)) { at = i; which = s; }
  }
  return at < 0 ? { text: String(text || ''), stopSequence: null } : { text: String(text).slice(0, at), stopSequence: which };
}

function holdPartial(text, stops) {
  let hide = 0;
  for (const s of stops || []) {
    const max = Math.min(s.length - 1, text.length);
    for (let k = max; k >= 1; k--) if (text.endsWith(s.slice(0, k))) { hide = Math.max(hide, k); break; }
  }
  return text.slice(0, text.length - hide);
}

function countInput(engine, messages) {
  try {
    if (!engine.countTokens) return 0;
    const txt = messages.map((m) => (typeof m.content === 'string' ? m.content : ''));
    return txt.reduce((a, t) => a + (Number(engine.countTokens(t)) || 0), 0) + messages.length * 4;
  } catch { return 0; }
}

function countOutput(engine, text, toolCalls) {
  try {
    if (engine.countTokens) {
      const extra = (toolCalls || []).map((c) => c.name + JSON.stringify(c.arguments || {})).join('');
      return Number(engine.countTokens(String(text || '') + extra)) || 0;
    }
  } catch {}
  return 0;
}

function stopReasonOf(finishReason, stopSequence, toolCalls) {
  if (stopSequence) return 'stop_sequence';
  if (toolCalls && toolCalls.length) return 'tool_use';
  if (finishReason === 'length') return 'max_tokens';
  return 'end_turn';
}

function withCache(usage) {
  return { ...usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

function missingModel(e) {
  if (!e) return false;
  if (e.status === 404 || e.type === 'not_found_error') return true;
  return /chưa có trên máy/.test(String(e.message || ''));
}

function messageBody({ id, model, text, toolCalls, stopReason, stopSequence, inputTokens, outputTokens }) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const c of toolCalls || []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments && typeof c.arguments === 'object' ? c.arguments : {} });
  if (!content.length) content.push({ type: 'text', text: text || '' });
  return {
    id, type: 'message', role: 'assistant', model, content,
    stop_reason: stopReason, stop_sequence: stopSequence,
    usage: withCache({ input_tokens: inputTokens, output_tokens: outputTokens }),
  };
}

async function runEngine(engine, req, signal, onToken) {
  const sampling = req.topK == null ? null : { topK: req.topK };
  const opts = { temperature: req.temperature, topP: req.topP, maxTokens: req.maxTokens, signal, sampling, onToken };
  if (req.usesTools) return engine.chatStep(req.messages, { ...opts, tools: req.tools, toolChoice: req.toolChoice });
  return engine.generate(req.messages, { ...opts, stop: req.stops });
}

// IncomingMessage bật autoDestroy: đọc hết body thì cờ destroyed của req thành true dù client còn chờ phản hồi.
// Ngắt thật: sự kiện close của res khi chưa ghi xong, res.writableEnded, hoặc socket đã chết.
function clientGone(req, res) {
  if (res.writableEnded || res.destroyed || res.closed) return true;
  const socket = res.socket || (req && req.socket);
  return !!(socket && socket.destroyed);
}

async function handleMessages({ req, res, engine, ensureModel, log, cors, readBody }) {
  const headers = cors();
  const fail = (status, type, message) => { if (status !== 401) log(`  → ${status} ${String(message).slice(0, 200)}`); return anthropicError(res, status, type, message, headers); };
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { return fail(400, 'invalid_request_error', 'JSON không hợp lệ'); }
  let translated;
  try { translated = translateRequest(body); } catch (e) { return fail(e.status || 400, e.type || 'invalid_request_error', e.message); }
  const ac = new AbortController();
  const onClose = () => { if (!res.writableEnded) ac.abort(); };
  res.on('close', onClose);
  if (ac.signal.aborted || clientGone(req, res)) return;
  try { await ensureModel(translated.model, { signal: ac.signal }); }
  catch (e) {
    if (ac.signal.aborted || clientGone(req, res)) return;
    if (missingModel(e)) return fail(404, 'not_found_error', e.message);
    return fail(e.status || 400, 'invalid_request_error', e.message);
  }
  if (ac.signal.aborted || clientGone(req, res)) return;
  const st = engine.status ? engine.status() : {};
  const id = 'msg_' + crypto.randomBytes(12).toString('hex');
  const model = translated.model || (st && st.id) || '';
  const inputTokens = countInput(engine, translated.messages);

  if (!translated.stream) {
    try {
      const r = await runEngine(engine, translated, ac.signal);
      const cut = cutStop(r.text || '', translated.stops);
      const toolCalls = cut.stopSequence ? [] : (r.toolCalls || []);
      const stopReason = stopReasonOf(r.finishReason, cut.stopSequence, toolCalls);
      const outputTokens = r.usage && Number.isFinite(r.usage.completion_tokens) ? r.usage.completion_tokens : countOutput(engine, cut.text, toolCalls);
      const msg = messageBody({ id, model, text: cut.text, toolCalls, stopReason, stopSequence: cut.stopSequence, inputTokens, outputTokens });
      log(`  → 200 message ${stopReason}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(msg));
    } catch (e) {
      if (ac.signal.aborted) return;
      return fail(500, 'api_error', e.message);
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...headers });
  sse(res, 'message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: withCache({ input_tokens: inputTokens, output_tokens: 0 }) } });
  let acc = ''; let emitted = 0; let stopSequence = null; let textOpen = false; let pinged = false; let fromTokens = false;
  const openText = () => {
    if (textOpen || res.writableEnded) return;
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    textOpen = true;
    if (!pinged) { sse(res, 'ping', { type: 'ping' }); pinged = true; }
  };
  const emitDelta = (s) => { if (!s) return; openText(); sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: s } }); };
  const consume = (chunk) => {
    if (stopSequence || !chunk) return;
    acc += chunk;
    const cut = cutStop(acc, translated.stops);
    if (cut.stopSequence) {
      const delta = cut.text.slice(emitted);
      emitted = cut.text.length; acc = cut.text; stopSequence = cut.stopSequence;
      emitDelta(delta);
      try { ac.abort(); } catch {}
      return;
    }
    const safe = holdPartial(acc, translated.stops);
    const delta = safe.slice(emitted);
    emitted = safe.length;
    emitDelta(delta);
  };
  let r = null;
  try {
    r = await runEngine(engine, translated, ac.signal, (t) => { if (stopSequence) return; fromTokens = true; consume(t); });
  } catch (e) {
    if (!(ac.signal.aborted && stopSequence)) {
      if (!ac.signal.aborted && !res.writableEnded) sse(res, 'error', { type: 'error', error: { type: 'api_error', message: e.message } });
      try { if (!res.writableEnded) res.end(); } catch {}
      return;
    }
    r = { text: acc, toolCalls: [], finishReason: 'abort' };
  }
  try {
    if (!fromTokens && r && r.text) consume(r.text);
    if (!stopSequence && acc.length > emitted) emitDelta(acc.slice(emitted));
    const finalCut = stopSequence ? { text: acc, stopSequence } : cutStop((fromTokens ? acc : (r.text || acc)), translated.stops);
    if (!stopSequence) stopSequence = finalCut.stopSequence;
    const toolCalls = stopSequence ? [] : (r.toolCalls || []);
    if (textOpen) sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    else if (!toolCalls.length) { openText(); sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 }); }
    let index = textOpen ? 1 : 0;
    for (const c of toolCalls) {
      const input = c.arguments && typeof c.arguments === 'object' ? c.arguments : {};
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: c.id, name: c.name, input: {} } });
      if (!pinged) { sse(res, 'ping', { type: 'ping' }); pinged = true; }
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
      sse(res, 'content_block_stop', { type: 'content_block_stop', index });
      index += 1;
    }
    const stopReason = stopReasonOf(r.finishReason, stopSequence, toolCalls);
    const outputTokens = r.usage && Number.isFinite(r.usage.completion_tokens) ? r.usage.completion_tokens : countOutput(engine, finalCut.text, toolCalls);
    sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: stopSequence }, usage: withCache({ output_tokens: outputTokens }) });
    sse(res, 'message_stop', { type: 'message_stop' });
    log(`  → 200 message stream ${stopReason}`);
  } catch (e) {
    if (!ac.signal.aborted && !res.writableEnded) sse(res, 'error', { type: 'error', error: { type: 'api_error', message: e.message } });
  }
  try { if (!res.writableEnded) res.end(); } catch {}
}

module.exports = { handleMessages, anthropicError, translateRequest, AnthropicError };
