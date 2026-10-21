'use strict';
// 0.16: “Bộ não đám mây” (tuỳ chọn) cho AIVN AGENT — máy chủ tương thích OpenAI (/v1/chat/completions) với khoá API của chính người dùng.
// • Chỉ thay phần LẬP KẾ HOẠCH + gọi công cụ. Mắt nhìn màn hình vẫn là mô hình nhìn ảnh trên máy: ẢNH CHỤP MÀN HÌNH KHÔNG gửi lên mạng.
//   Phần chữ (yêu cầu, kết quả công cụ, chữ đọc được trên màn hình, nội dung tệp đã đọc) CÓ gửi tới máy chủ đã chọn.
// • Khoá API: mã hoá bằng safeStorage của hệ điều hành (Windows DPAPI, macOS Keychain, Linux libsecret/kwallet); không bao giờ
//   gửi sang giao diện, không ghi nhật ký. Hệ điều hành không có kho khoá an toàn → chỉ giữ trong bộ nhớ đến khi thoát AIVN.
// • Chỉ nhận https:// (hoặc http:// tới chính máy này: localhost/127.0.0.1/::1, ví dụ LM Studio, Ollama).

const MAX_CTX = 1048576;

function normalizeBase(url) {
  let u; try { u = new URL(String(url || '').trim()); } catch { throw new Error('Địa chỉ máy chủ không hợp lệ. Ví dụ: https://api.openai.com/v1'); }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Chỉ nhận địa chỉ https:// (hoặc http:// tới chính máy này như localhost) để khoá API không bị lộ trên đường truyền.');
  if (u.username || u.password) throw new Error('Không ghi khoá hay mật khẩu vào địa chỉ; hãy dán khoá vào ô Khoá API.');
  u.hash = ''; u.search = '';
  let p = u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return u.origin + p;
}

// thông điệp kiểu AIVN (OpenAI) → giữ nguyên, chỉ làm sạch: ảnh bỏ đi (không gửi ảnh màn hình lên mạng), arguments thành chuỗi
function toWire(messages) {
  return messages.map(m => {
    const o = { role: m.role };
    if (Array.isArray(m.content)) o.content = m.content.map(p => (p && p.type === 'text' ? p.text : p && (p.type === 'image_url' || p.type === 'image') ? '[ảnh: không gửi lên máy chủ đám mây]' : '')).filter(Boolean).join('\n');
    else o.content = m.content == null ? (m.tool_calls ? null : '') : String(m.content);
    if (m.tool_calls) o.tool_calls = m.tool_calls.map(c => ({ id: c.id, type: 'function', function: { name: c.function ? c.function.name : c.name, arguments: typeof (c.function ? c.function.arguments : c.arguments) === 'string' ? (c.function ? c.function.arguments : c.arguments) : JSON.stringify((c.function ? c.function.arguments : c.arguments) ?? {}) } }));
    if (m.role === 'tool') { o.tool_call_id = m.tool_call_id; if (m.name) o.name = m.name; }
    return o;
  });
}
function parseArgs(s) { if (s && typeof s === 'object') return s; try { const v = JSON.parse(String(s || '{}')); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }

function createCloudBrain({ getConfig, getKey, fetchImpl = (...a) => fetch(...a), timeoutMs = 120000 }) {
  async function request(pathname, body, { signal, method = 'POST' } = {}) {
    const c = getConfig(); const key = getKey();
    if (!c || !c.baseUrl || !key) throw new Error('Chưa cài bộ não đám mây (thiếu địa chỉ hoặc khoá API).');
    const base = normalizeBase(c.baseUrl);
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
    const onAbort = () => ac.abort(signal.reason); if (signal) { if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener('abort', onAbort, { once: true }); }
    let res;
    try {
      res = await fetchImpl(base + pathname, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal, redirect: 'error' });
    } catch (e) {
      if (signal && signal.aborted) { const err = new Error('Đã dừng.'); err.aborted = true; throw err; }
      throw new Error(ac.signal.aborted ? `Máy chủ đám mây không trả lời sau ${Math.round(timeoutMs / 1000)} giây.` : `Không kết nối được máy chủ đám mây (${new URL(base).host}): ${(e && e.cause && e.cause.code) || (e && e.message) || e}`);
    } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    if (!res.ok) {
      const msg = (j && j.error && (j.error.message || j.error)) || text.slice(0, 200);
      const hint = res.status === 401 || res.status === 403 ? ' Khoá API sai hoặc không có quyền.' : res.status === 404 ? ' Kiểm tra địa chỉ (thường kết thúc bằng /v1) và tên mô hình.' : res.status === 429 ? ' Vượt hạn mức hoặc hết tiền trong tài khoản.' : '';
      throw new Error(`Máy chủ đám mây báo lỗi ${res.status}: ${String(msg).replace(key, '***').slice(0, 300)}.${hint}`);
    }
    if (!j) throw new Error('Máy chủ đám mây trả về dữ liệu không phải JSON.');
    return j;
  }
  async function chatStep(messages, { tools = [], toolChoice = 'auto', temperature = 0.2, maxTokens = 1024, topP, signal, onToken, responseFormat } = {}) {
    const c = getConfig(); const t0 = Date.now();
    const body = { model: c.model, messages: toWire(messages), temperature, max_tokens: maxTokens, stream: false };
    if (topP != null) body.top_p = topP;
    if (tools.length && toolChoice !== 'none') { body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } } })); body.tool_choice = typeof toolChoice === 'object' ? { type: 'function', function: { name: toolChoice.name } } : toolChoice; }
    if (responseFormat) body.response_format = responseFormat;
    const j = await request('/chat/completions', body, { signal });
    const ch = j.choices && j.choices[0]; const msg = (ch && ch.message) || {};
    const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(p => p.text || '').join('') : '';
    if (text && onToken) onToken(text);
    const toolCalls = (msg.tool_calls || []).filter(x => x && x.function && x.function.name).map((x, i) => ({ id: x.id || 'call_' + i, name: x.function.name, arguments: parseArgs(x.function.arguments) }));
    const secs = (Date.now() - t0) / 1000; const ct = (j.usage && j.usage.completion_tokens) || 0;
    const fr = ch && ch.finish_reason === 'length' ? 'length' : toolCalls.length ? 'tool_calls' : 'stop';
    return { text, toolCalls, finishReason: fr, usage: { completion_tokens: ct, prompt_tokens: (j.usage && j.usage.prompt_tokens) || 0, tokensPerSecond: secs > 0 ? ct / secs : 0, seconds: secs }, cloud: true };
  }
  // kiểm tra: gọi một câu ngắn có công cụ để biết mô hình gọi công cụ được
  async function test() {
    const t0 = Date.now();
    const r = await chatStep([{ role: 'user', content: 'Gọi công cụ get_time với múi giờ "Asia/Ho_Chi_Minh". Không viết gì khác.' }], { tools: [{ name: 'get_time', description: 'Lấy giờ hiện tại', parameters: { type: 'object', properties: { tz: { type: 'string' } }, required: ['tz'] } }], maxTokens: 60, temperature: 0 });
    return { ok: true, ms: Date.now() - t0, tools: r.toolCalls.some(x => x.name === 'get_time'), reply: r.text.slice(0, 120) };
  }
  return { chatStep, test, request };
}

// lưu khoá: safeStorage (khi có kho khoá thật của hệ điều hành) → chuỗi base64 trong settings; không có → chỉ trong bộ nhớ
function createKeyStore({ safeStorage, get, set }) {
  let mem = null;
  const secure = () => { try { if (!safeStorage || !safeStorage.isEncryptionAvailable()) return false; const b = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : null; return b !== 'basic_text' && b !== 'unknown'; } catch { return false; } };
  return {
    secure,
    save(key) {
      key = String(key || '').trim(); if (!key) throw new Error('Khoá API trống.'); if (key.length > 400 || /\s/.test(key)) throw new Error('Khoá API không hợp lệ.');
      if (secure()) { set(safeStorage.encryptString(key).toString('base64')); mem = null; return { persisted: true }; }
      mem = key; set(null); return { persisted: false };
    },
    get() { if (mem) return mem; const enc = get(); if (!enc || !secure()) return null; try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; } },
    has() { return !!this.get(); },
    clear() { mem = null; set(null); },
  };
}

module.exports = { createCloudBrain, createKeyStore, normalizeBase, toWire, MAX_CTX };
