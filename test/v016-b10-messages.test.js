'use strict';
// B10 (b): POST /v1/messages chuẩn Anthropic, dịch sang engine.generate / engine.chatStep.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { createApiServer } = require('../src/server');
const { createJitGuard } = require('../src/jit-load');

function parseSse(text) {
  const events = [];
  for (const block of String(text).split(/\n\n/)) {
    if (!block.trim()) continue;
    let event = ''; const data = [];
    for (const line of block.split(/\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    events.push({ event, data: JSON.parse(data.join('')) });
  }
  return events;
}

async function withServer(fn, { engineExtra = {}, ensureModel = async () => {}, apiKey = null, text = 'Xin chào', finishReason = 'stop' } = {}) {
  const calls = []; let disconnectSaw = null;
  const engine = {
    status: () => ({ loaded: true, id: 'm1' }),
    countTokens: (t) => String(t).length,
    async generate(messages, o = {}) {
      calls.push({ fn: 'generate', messages, o });
      if (engineExtra.hold) {
        if (o.onToken) o.onToken('Xin');
        await new Promise((resolve) => {
          if (o.signal && o.signal.aborted) return resolve();
          const t = setTimeout(resolve, 2000);
          o.signal && o.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
        disconnectSaw = !!(o.signal && o.signal.aborted);
        return { text: 'Xin', finishReason: disconnectSaw ? 'abort' : 'stop', usage: { completion_tokens: 1 } };
      }
      const out = text;
      if (o.onToken) {
        for (const ch of out.match(/.{1,4}/gs) || []) {
          if (o.signal && o.signal.aborted) return { text: out, finishReason: 'abort', usage: { completion_tokens: 1 } };
          o.onToken(ch);
        }
      }
      return { text: out, finishReason, toolCalls: [], usage: { completion_tokens: 7 } };
    },
    async chatStep(messages, o = {}) {
      calls.push({ fn: 'chatStep', messages, o });
      if (o.onToken && engineExtra.toolText) o.onToken(engineExtra.toolText);
      return engineExtra.chatResult || { text: 'xong', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 2 } };
    },
  };
  const logs = [];
  const api = createApiServer({ engine, models: () => [{ id: 'm1', mtime: Date.now() }], ensureModel, log: (m) => logs.push(m), getOpts: () => ({ apiKey }) });
  const port = 21000 + Math.floor(Math.random() * 10000);
  await api.start(port, '127.0.0.1');
  try { return await fn({ url: `http://127.0.0.1:${port}`, port, calls, logs, disconnect: () => disconnectSaw }); }
  finally { await api.stop(); }
}

const post = (url, body, headers = {}, signal) => fetch(url + '/v1/messages', {
  method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  signal: signal || AbortSignal.timeout(15000),
});

test('POST /v1/messages không stream: system, khối text, usage, tham số lấy mẫu', async () => {
  await withServer(async ({ url, calls }) => {
    const r = await post(url, {
      model: 'aivn-local', max_tokens: 32, temperature: 0.2, top_p: 0.8, top_k: 20,
      metadata: { user_id: 'u-1' },
      system: [{ type: 'text', text: 'Bạn là trợ lý.' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Xin chào' }] }],
    });
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.match(j.id, /^msg_/); assert.strictEqual(j.type, 'message'); assert.strictEqual(j.role, 'assistant');
    assert.strictEqual(j.model, 'aivn-local');
    assert.deepStrictEqual(j.content, [{ type: 'text', text: 'Xin chào' }]);
    assert.strictEqual(j.stop_reason, 'end_turn'); assert.strictEqual(j.stop_sequence, null);
    assert.strictEqual(j.usage.output_tokens, 7);
    assert.strictEqual(j.usage.input_tokens, 'Bạn là trợ lý.'.length + 'Xin chào'.length + 8);
    assert.strictEqual(calls[0].fn, 'generate');
    assert.deepStrictEqual(calls[0].messages.map((m) => m.role), ['system', 'user']);
    assert.strictEqual(calls[0].messages[1].content, 'Xin chào');
    assert.strictEqual(calls[0].o.maxTokens, 32);
    assert.strictEqual(calls[0].o.temperature, 0.2);
    assert.strictEqual(calls[0].o.topP, 0.8);
    assert.strictEqual(calls[0].o.sampling.topK, 20);
  });
});

test('POST /v1/messages stream: đúng thứ tự sự kiện Anthropic', async () => {
  await withServer(async ({ url }) => {
    const r = await post(url, { model: 'aivn-local', max_tokens: 16, stream: true, messages: [{ role: 'user', content: 'Xin chào' }] });
    assert.strictEqual(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    assert.strictEqual(r.headers.get('connection'), 'keep-alive');
    const ev = parseSse(await r.text());
    const names = ev.map((e) => e.event);
    const deltas = ev.filter((e) => e.event === 'content_block_delta');
    assert.deepStrictEqual(names.filter((n) => n !== 'content_block_delta'), ['message_start', 'content_block_start', 'ping', 'content_block_stop', 'message_delta', 'message_stop']);
    assert.ok(deltas.length >= 1);
    assert.ok(names.indexOf('content_block_start') < names.indexOf('ping'));
    assert.ok(names.indexOf('ping') < names.indexOf('content_block_delta'));
    assert.ok(deltas.every((d) => d.data.delta.type === 'text_delta'));
    assert.strictEqual(deltas.map((d) => d.data.delta.text).join(''), 'Xin chào');
    assert.strictEqual(ev[0].data.message.usage.output_tokens, 0);
    assert.strictEqual(ev.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'end_turn');
    assert.strictEqual(ev.find((e) => e.event === 'message_delta').data.usage.output_tokens, 7);
    assert.strictEqual(ev[ev.length - 1].data.type, 'message_stop');
  });
});

test('stop_sequences cắt câu trả lời và max_tokens thành stop_reason', async () => {
  await withServer(async ({ url, calls }) => {
    const r = await post(url, { model: 'm1', max_tokens: 20, stop_sequences: ['STOP'], messages: [{ role: 'user', content: 'x' }] });
    const j = await r.json();
    assert.strictEqual(j.stop_reason, 'stop_sequence'); assert.strictEqual(j.stop_sequence, 'STOP');
    assert.strictEqual(j.content[0].text, 'Xin chào ');
    assert.deepStrictEqual(calls[0].o.stop, ['STOP']);
  }, { text: 'Xin chào STOP phần sau' });
  await withServer(async ({ url, calls }) => {
    const r = await post(url, { model: 'm1', max_tokens: 4, messages: [{ role: 'user', content: 'x' }] });
    const j = await r.json();
    assert.strictEqual(j.stop_reason, 'max_tokens'); assert.strictEqual(j.stop_sequence, null);
    assert.strictEqual(calls[0].o.maxTokens, 4);
  }, { finishReason: 'length' });
});

test('thiếu max_tokens hoặc content sai → 400; chưa nạp mô hình giống đường OpenAI', async () => {
  await withServer(async ({ url }) => {
    const a = await post(url, { model: 'm1', messages: [{ role: 'user', content: 'x' }] });
    assert.strictEqual(a.status, 400);
    const ja = await a.json();
    assert.strictEqual(ja.type, 'error'); assert.strictEqual(ja.error.type, 'invalid_request_error');
    assert.match(ja.error.message, /max_tokens/);
    const b = await post(url, { max_tokens: 8, messages: [{ role: 'user', content: 1 }] });
    assert.strictEqual(b.status, 400); assert.strictEqual((await b.json()).error.type, 'invalid_request_error');
    const c = await post(url, '{', { 'content-type': 'application/json' });
    assert.strictEqual(c.status, 400);
  });
  const msg = 'Chưa nạp mô hình nào. Hãy nạp mô hình trong AIVN hoặc chỉ định "model".';
  await withServer(async ({ url }) => {
    const r = await post(url, { model: 'khong-co', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] });
    assert.strictEqual(r.status, 400);
    const j = await r.json();
    assert.strictEqual(j.error.type, 'invalid_request_error'); assert.strictEqual(j.error.message, msg);
  }, { ensureModel: async () => { throw new Error(msg); } });
});

test('khoá API: 401 dạng Anthropic; Bearer hoặc x-api-key thì 200', async () => {
  await withServer(async ({ url }) => {
    const bare = await post(url, { model: 'm1', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }, { 'anthropic-version': '2023-06-01' });
    assert.strictEqual(bare.status, 401);
    const j = await bare.json();
    assert.strictEqual(j.type, 'error'); assert.strictEqual(j.error.type, 'authentication_error');
    assert.strictEqual(j.error.code, undefined);
    const bad = await post(url, { model: 'm1', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }, { 'x-api-key': 'sai' });
    assert.strictEqual(bad.status, 401);
    const okB = await post(url, { model: 'm1', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }, { authorization: 'Bearer test-key' });
    assert.strictEqual(okB.status, 200);
    const okX = await post(url, { model: 'm1', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }, { 'x-api-key': 'test-key' });
    assert.strictEqual(okX.status, 200);
  }, { apiKey: 'test-key' });
});

test('body lớn hơn 20MB trả 413, không phải 400', async () => {
  await withServer(async ({ port }) => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/messages', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end(Buffer.alloc(20e6 + 1, 0x61));
    });
    assert.strictEqual(status, 413);
  });
});

test('HTTP/1.0 stream không gắn Connection: keep-alive', async () => {
  await withServer(async ({ port }) => {
    const raw = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: 'm1', max_tokens: 8, stream: true, messages: [{ role: 'user', content: 'x' }] });
      const s = net.connect(port, '127.0.0.1', () => {
        s.write(`POST /v1/messages HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      });
      const chunks = [];
      const t = setTimeout(() => { s.destroy(); resolve(Buffer.concat(chunks).toString('utf8')); }, 2000);
      s.on('data', (d) => chunks.push(d));
      s.on('end', () => { clearTimeout(t); resolve(Buffer.concat(chunks).toString('utf8')); });
      s.on('error', (e) => { clearTimeout(t); reject(e); });
    });
    assert.match(raw, /^HTTP\/1\.[01] 200/);
    assert.match(raw, /text\/event-stream/);
    assert.doesNotMatch(raw, /keep-alive/i);
  });
});

test('ngắt kết nối thì huỷ lượt sinh', async () => {
  await withServer(async ({ port, disconnect, logs }) => {
    await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/messages', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' } }, (res) => {
        res.on('data', () => req.destroy());
        res.on('error', () => resolve());
        res.on('close', () => resolve());
      });
      req.on('error', () => resolve());
      req.write(JSON.stringify({ model: 'm1', max_tokens: 8, stream: true, messages: [{ role: 'user', content: 'x' }] }));
      req.end();
      setTimeout(() => reject(new Error('treo')), 4000);
    });
    for (let i = 0; i < 30 && disconnect() == null; i++) await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(disconnect(), true);
    for (let i = 0; i < 30 && !logs.some((l) => l.includes('client disconnected')); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(logs.some((l) => l.includes('client disconnected')));
    assert.ok(!logs.some((l) => /200 message/.test(l) && /end_turn/.test(l)));
  }, { engineExtra: { hold: true } });
});

test('tool_use / tool_result đi qua chatStep; stream có input_json_delta', async () => {
  const chatResult = { text: '', toolCalls: [{ id: 'toolu_1', name: 'get_weather', arguments: { city: 'Huế' } }], finishReason: 'tool_calls', usage: { completion_tokens: 3 } };
  const body = {
    model: 'm1', max_tokens: 40,
    tools: [{ name: 'get_weather', description: 'Thời tiết', input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }],
    messages: [
      { role: 'user', content: 'Thời tiết?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Huế' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'nắng' }, { type: 'text', text: 'trả lời ngắn' }] },
    ],
  };
  await withServer(async ({ url, calls }) => {
    const r = await post(url, body);
    assert.strictEqual(r.status, 200, await r.clone().text());
    const j = await r.json();
    assert.strictEqual(j.stop_reason, 'tool_use');
    assert.deepStrictEqual(j.content, [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Huế' } }]);
    assert.strictEqual(calls[0].fn, 'chatStep');
    assert.strictEqual(calls[0].o.tools[0].name, 'get_weather');
    assert.strictEqual(calls[0].o.tools[0].parameters.properties.city.type, 'string');
    const roles = calls[0].messages.map((m) => m.role);
    assert.ok(roles.includes('tool'));
    const tool = calls[0].messages.find((m) => m.role === 'tool');
    assert.strictEqual(tool.tool_call_id, 'toolu_1'); assert.strictEqual(tool.content, 'nắng');
    const asst = calls[0].messages.find((m) => m.tool_calls);
    assert.strictEqual(asst.tool_calls[0].function.name, 'get_weather');
  }, { engineExtra: { chatResult } });
  await withServer(async ({ url }) => {
    const r = await post(url, { ...body, stream: true, messages: [{ role: 'user', content: 'Thời tiết?' }] });
    const ev = parseSse(await r.text());
    const delta = ev.find((e) => e.data.delta && e.data.delta.type === 'input_json_delta');
    assert.ok(delta, ev.map((e) => e.event).join(','));
    assert.deepStrictEqual(JSON.parse(delta.data.delta.partial_json), { city: 'Huế' });
    assert.strictEqual(ev.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'tool_use');
    const start = ev.find((e) => e.event === 'content_block_start');
    assert.strictEqual(start.data.content_block.type, 'tool_use');
    assert.ok(ev.findIndex((e) => e.event === 'ping') > ev.findIndex((e) => e.event === 'content_block_start'));
  }, { engineExtra: { chatResult } });
});

test('khối thinking và redacted_thinking trong lịch sử assistant bị bỏ qua', async () => {
  await withServer(async ({ url, calls }) => {
    const r = await post(url, {
      model: 'm1', max_tokens: 8,
      messages: [
        { role: 'user', content: 'câu hỏi' },
        { role: 'assistant', content: [
          { type: 'thinking', thinking: 'suy nghĩ nội bộ' },
          { type: 'redacted_thinking', data: 'bí mật' },
          { type: 'text', text: 'Xin' },
          { type: 'text', text: 'chào' },
        ] },
        { role: 'user', content: 'tiếp' },
      ],
    });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const assistant = calls[0].messages.find((m) => m.role === 'assistant');
    assert.strictEqual(assistant.content, 'Xin\nchào');
    assert.doesNotMatch(JSON.stringify(calls[0].messages), /suy nghĩ nội bộ|bí mật/);
  });
});

test('khối text nối bằng xuống dòng, kể cả trong tool_result', async () => {
  await withServer(async ({ url, calls }) => {
    const r = await post(url, {
      model: 'm1', max_tokens: 8,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Xin' }, { type: 'text', text: 'chào' }] }],
    });
    assert.strictEqual(r.status, 200, await r.clone().text());
    assert.strictEqual(calls[0].messages[0].content, 'Xin\nchào');
  });
  await withServer(async ({ url, calls }) => {
    const r = await post(url, {
      model: 'm1', max_tokens: 8,
      messages: [
        { role: 'user', content: 'Thời tiết?' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'nắng' }, { type: 'text', text: '34 độ' }] }] },
      ],
    });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const tool = calls[0].messages.find((m) => m.role === 'tool');
    assert.strictEqual(tool.content, 'nắng\n34 độ');
  });
});

test('tool_result is_error thêm tiền tố Lỗi', async () => {
  await withServer(async ({ url, calls }) => {
    const r = await post(url, {
      model: 'm1', max_tokens: 8,
      messages: [
        { role: 'user', content: 'Thời tiết?' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'hết thời gian' }] },
      ],
    });
    assert.strictEqual(r.status, 200, await r.clone().text());
    const tool = calls[0].messages.find((m) => m.role === 'tool');
    assert.strictEqual(tool.content, 'Lỗi: hết thời gian');
  });
});

test('usage có cache_creation_input_tokens và cache_read_input_tokens bằng 0', async () => {
  await withServer(async ({ url }) => {
    const r = await post(url, { model: 'm1', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] });
    const j = await r.json();
    assert.strictEqual(j.usage.cache_creation_input_tokens, 0);
    assert.strictEqual(j.usage.cache_read_input_tokens, 0);
    const s = await post(url, { model: 'm1', max_tokens: 8, stream: true, messages: [{ role: 'user', content: 'x' }] });
    const ev = parseSse(await s.text());
    const start = ev.find((e) => e.event === 'message_start').data.message.usage;
    const delta = ev.find((e) => e.event === 'message_delta').data.usage;
    assert.strictEqual(start.cache_creation_input_tokens, 0);
    assert.strictEqual(start.cache_read_input_tokens, 0);
    assert.strictEqual(delta.cache_creation_input_tokens, 0);
    assert.strictEqual(delta.cache_read_input_tokens, 0);
  });
});

test('client ngắt trong lúc ensureModel thì không nạp và không giữ mô hình', async () => {
  let held = false;
  let entered = false;
  await withServer(async ({ port, calls }) => {
    await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/messages', headers: { 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('close', () => resolve());
      });
      req.on('error', () => resolve());
      req.on('close', () => resolve());
      req.end(JSON.stringify({ model: 'm-slow', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }));
      const wait = setInterval(() => {
        if (!entered) return;
        clearInterval(wait);
        req.destroy();
      }, 10);
      setTimeout(() => { clearInterval(wait); reject(new Error('ensureModel không chạy')); }, 4000);
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(held, false);
    assert.ok(!calls.some((c) => c.fn === 'generate' || c.fn === 'chatStep'));
  }, {
    ensureModel: (_model, opts) => new Promise((resolve) => {
      const signal = opts && opts.signal;
      if (!signal) { held = true; entered = true; return resolve(); }
      entered = true;
      const t = setTimeout(() => { if (!signal.aborted) held = true; resolve(); }, 1500);
      signal.addEventListener('abort', () => { clearTimeout(t); held = false; resolve(); }, { once: true });
    }),
  });
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const start = main.indexOf('async function ensureModel');
  const slice = main.slice(start, main.indexOf('function apiHost', start));
  const stopAt = slice.indexOf('if (stopped()) return;');
  const loadAt = slice.includes('await shareLoad(m.id') ? slice.indexOf('await shareLoad(m.id') : slice.indexOf('await loadById(m.id)');
  const dropAt = slice.indexOf('jitGuard.shouldUnload(');
  const jitAt = slice.indexOf('apiJit = {');
  assert.ok(stopAt > 0 && loadAt > stopAt, 'đã ngắt trước khi nạp thì không gọi load');
  assert.ok(dropAt > loadAt && jitAt > dropAt, 'nạp xong mới xét gỡ; apiJit chỉ khi còn giữ mô hình');
  assert.doesNotMatch(slice, /if \(stopped\(\)\) \{\s*try \{\s*await engine\.unloadModel\(\)/);
  assert.match(main, /signal: extra && extra\.signal/);
});

test('POST /v1/messages bình thường có phản hồi, không treo (không stream và stream)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'anthropic-api.js'), 'utf8');
  assert.doesNotMatch(src, /req\.destroyed/);
  assert.match(src, /res\.on\('close'/);
  await withServer(async ({ url }) => {
    const r = await post(url, { model: 'm1', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }, {}, AbortSignal.timeout(4000));
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.strictEqual(j.type, 'message');
    assert.strictEqual(j.role, 'assistant');
    assert.strictEqual(j.content[0].text, 'Xin chào');
    const s = await post(url, { model: 'm1', max_tokens: 8, stream: true, messages: [{ role: 'user', content: 'x' }] }, {}, AbortSignal.timeout(4000));
    assert.strictEqual(s.status, 200);
    assert.match(s.headers.get('content-type'), /text\/event-stream/);
    const ev = parseSse(await s.text());
    assert.ok(ev.some((e) => e.event === 'message_stop'));
    assert.strictEqual(ev.filter((e) => e.event === 'content_block_delta').map((e) => e.data.delta.text).join(''), 'Xin chào');
  });
});

const loaded = (id) => ({ loaded: true, loading: false, id });

test('ngắt khi chính yêu cầu này nạp và không còn ai dùng thì gỡ mô hình', () => {
  const g = createJitGuard();
  g.enter('m1');
  assert.strictEqual(g.shouldUnload('m1', { triggered: true, uiSelected: false, busy: false, status: loaded('m1') }), true);
  g.leave('m1');
  const both = createJitGuard();
  both.enter('m1');
  both.enter('m1');
  assert.strictEqual(both.shouldUnload('m1', { triggered: true, uiSelected: false, busy: false, status: loaded('m1') }), false);
  both.leave('m1');
  assert.strictEqual(both.shouldUnload('m1', { triggered: true, uiSelected: false, busy: false, status: loaded('m1') }), true);
});

test('ngắt khi giao diện đã chọn hoặc còn yêu cầu khác thì giữ mô hình', () => {
  const ui = createJitGuard();
  ui.enter('m1');
  assert.strictEqual(ui.shouldUnload('m1', { triggered: true, uiSelected: true, busy: false, status: loaded('m1') }), false);
  const peer = createJitGuard();
  peer.enter('m1');
  peer.enter('m1');
  assert.strictEqual(peer.shouldUnload('m1', { triggered: true, uiSelected: false, busy: false, status: loaded('m1') }), false);
  const joined = createJitGuard();
  joined.enter('m1');
  assert.strictEqual(joined.shouldUnload('m1', { triggered: false, uiSelected: false, busy: false, status: loaded('m1') }), false);
  assert.strictEqual(joined.shouldUnload('m1', { triggered: true, uiSelected: false, busy: true, status: loaded('m1') }), false);
  assert.strictEqual(joined.shouldUnload('m1', { triggered: true, uiSelected: false, busy: false, status: { loaded: true, loading: true, id: 'm1' } }), false);
  assert.strictEqual(joined.shouldUnload('m1', { triggered: true, uiSelected: false, busy: false, status: loaded('m-khac') }), false);
  assert.strictEqual(joined.shouldUnload('m1', { triggered: true, uiSelected: false, busy: false, status: loaded('m1-extra') }), false);
});

test('đường không có và mô hình không có trả 404 kiểu Anthropic', async () => {
  await withServer(async ({ url }) => {
    const g = await fetch(url + '/v1/messages');
    assert.strictEqual(g.status, 404);
    const j = await g.json();
    assert.strictEqual(j.type, 'error');
    assert.strictEqual(j.error.type, 'not_found_error');
    assert.match(j.error.message, /GET \/v1\/messages/);
    const other = await fetch(url + '/v1/audio/speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual(other.status, 404);
    const jo = await other.json();
    assert.notStrictEqual(jo.type, 'error');
    assert.notStrictEqual(jo.error.type, 'not_found_error');
  });
  await withServer(async ({ url }) => {
    const r = await post(url, { model: 'khong-co', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] });
    assert.strictEqual(r.status, 404);
    const j = await r.json();
    assert.strictEqual(j.type, 'error');
    assert.strictEqual(j.error.type, 'not_found_error');
    assert.match(j.error.message, /chưa có trên máy/);
  }, { ensureModel: async (model) => { throw new Error(`Mô hình "${model}" chưa có trên máy`); } });
});
