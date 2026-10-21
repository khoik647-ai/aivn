// Giao thức công cụ dạng văn bản của AIVN + chuẩn hoá hội thoại cho các mẫu chat "khó tính"
// (Gemma, Mistral cũ…: bắt buộc user/assistant xen kẽ, không có vai system/tool, không hỗ trợ tools).
// Phát triển bởi NGUYỄN NGỌC KHÔI SINH VIÊN VLU
'use strict';

// Đọc mẫu chat (Jinja) trong GGUF / llama-server: có cần chế độ văn bản không?
function analyzeTemplate(tpl) {
  const t = String(tpl || '');
  if (!t) return { strict: false, nativeTools: false, known: false };
  const strict = /raise_exception\([^)]*(alternate|alternating)/i.test(t) || /roles must alternate/i.test(t);
  const nativeTools = /\btools\b/.test(t) && /tool_calls|tool_call|"tool"|'tool'|role\s*==\s*["']tool["']|ipython/.test(t);
  return { strict, nativeTools, known: true };
}

const contentText = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p && p.type === 'text').map(p => p.text).join('\n') : c == null ? '' : String(c);
const toParts = (c) => Array.isArray(c) ? c.filter(Boolean) : [{ type: 'text', text: contentText(c) }];
const hasImage = (c) => Array.isArray(c) && c.some(p => p && p.type === 'image_url');

function toolPrompt(tools) {
  const specs = tools.map(t => JSON.stringify({ name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } })).join('\n');
  return [
    '# Công cụ',
    'Bạn có thể gọi các công cụ sau (JSON Schema):',
    specs,
    '',
    'Muốn gọi công cụ, trả lời CHỈ bằng một hoặc vài khối đúng dạng sau rồi dừng, không viết gì thêm:',
    '<tool_call>{"name": "tên_công_cụ", "arguments": {…}}</tool_call>',
    'Kết quả sẽ được gửi lại trong khối <tool_result name="…">…</tool_result>. Khi đã đủ thông tin, trả lời người dùng bình thường bằng tiếng Việt, không dùng khối <tool_call>.',
    'Không bao giờ bịa kết quả công cụ; không nói đã làm khi chưa nhận được <tool_result>. Không viết bước giả kiểu "[screen,act] …" hay "[open_app] …": muốn làm gì thì phải xuất khối <tool_call>.',
    ...examples(tools.map(t => t.name)),
  ].join('\n');
}

function examples(names) {
  const ex = [];
  if (names.includes('open_app')) ex.push('Người dùng: mở máy tính giúp tôi', 'Bạn: <tool_call>{"name": "open_app", "arguments": {"name": "Calculator"}}</tool_call>');
  if (names.includes('calculator')) ex.push('Người dùng: 15% của 2.350.000 là bao nhiêu?', 'Bạn: <tool_call>{"name": "calculator", "arguments": {"expression": "15% * 2350000"}}</tool_call>');
  if (names.includes('screen_act')) ex.push('Người dùng: bấm nút Gửi', 'Bạn: <tool_call>{"name": "screen_act", "arguments": {"action": "click", "target": "nút Gửi"}}</tool_call>');
  if (!ex.length && names.length) ex.push('Người dùng: (một yêu cầu cần công cụ)', `Bạn: <tool_call>{"name": "${names[0]}", "arguments": {}}</tool_call>`);
  return ex.length ? ['', 'Ví dụ:', ...ex, 'Sau khi nhận <tool_result>, trả lời người dùng dựa trên kết quả đó.'] : [];
}

const callText = (c) => `<tool_call>${JSON.stringify({ name: c.function ? c.function.name : c.name, arguments: (() => { const a = c.function ? c.function.arguments : c.arguments; if (typeof a === 'string') { try { return JSON.parse(a); } catch { return a; } } return a ?? {}; })() })}</tool_call>`;

// messages kiểu OpenAI → chỉ user/assistant, bắt đầu bằng user, xen kẽ; system gộp vào lượt user đầu; tool → văn bản
function normalizeMessages(messages, { tools = [] } = {}) {
  const sys = []; const turns = [];
  const names = new Map(); // tool_call_id → tên
  for (const m of messages || []) {
    if (!m) continue;
    if (m.role === 'system' || m.role === 'developer') { const t = contentText(m.content).trim(); if (t) sys.push(t); continue; }
    if (m.role === 'assistant') {
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      for (const c of calls) if (c && c.id) names.set(c.id, c.function ? c.function.name : c.name);
      const text = [contentText(m.content).trim(), ...calls.map(callText)].filter(Boolean).join('\n');
      turns.push({ role: 'assistant', content: text || '…' });
      continue;
    }
    if (m.role === 'tool' || m.role === 'function' || m.role === 'ipython') {
      const name = m.name || names.get(m.tool_call_id) || 'công cụ';
      turns.push({ role: 'user', content: `<tool_result name="${name}">\n${contentText(m.content)}\n</tool_result>` });
      continue;
    }
    turns.push({ role: 'user', content: m.content == null ? '' : m.content });
  }
  if (tools.length) sys.push(toolPrompt(tools));
  // gộp các lượt liền nhau cùng vai
  const out = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) {
      if (hasImage(last.content) || hasImage(t.content)) last.content = [...toParts(last.content), { type: 'text', text: '\n\n' }, ...toParts(t.content)];
      else last.content = contentText(last.content) + '\n\n' + contentText(t.content);
    } else out.push({ ...t });
  }
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: '(Bắt đầu cuộc trò chuyện)' });
  if (sys.length) {
    const head = sys.join('\n\n') + '\n\n---\n\n';
    const f = out[0];
    f.content = Array.isArray(f.content) ? [{ type: 'text', text: head }, ...f.content] : head + contentText(f.content);
  }
  return out;
}

// Tách các khối <tool_call>{…}</tool_call> (và vài biến thể hay gặp) khỏi câu trả lời
function parseToolCalls(text, allowed = null, schemas = null) {
  const calls = []; let rest = String(text || '');
  const take = (raw) => {
    let j; try { j = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); if (!m) return false; try { j = JSON.parse(m[0]); } catch { return false; } }
    const name = j && (j.name || (j.function && j.function.name) || j.tool);
    if (!name || (allowed && !allowed.includes(name))) return false;
    let args = j.arguments ?? j.parameters ?? j.args ?? (j.function && j.function.arguments) ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { _raw: args }; } }
    calls.push({ id: 'call_' + Math.random().toString(36).slice(2, 12), name, arguments: args || {} });
    return true;
  };
  rest = rest.replace(/<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g, (all, raw) => take(raw) ? '' : all);
  if (!calls.length) rest = rest.replace(/```(?:json|tool_call|tool)?\s*(\{[\s\S]*?"(?:name|tool)"[\s\S]*?\})\s*```/g, (all, raw) => take(raw) ? '' : all);
  if (!calls.length) { const t = rest.trim(); if (/^\{[\s\S]*"name"[\s\S]*\}$/.test(t) && take(t)) rest = ''; }
  if (!calls.length && allowed && allowed.length) rest = salvage(rest, allowed, schemas, calls);
  return { text: rest.replace(/<\/?tool_call>/g, '').trim(), toolCalls: calls };
}
// B44: mô hình nhỏ IN lời gọi công cụ ra chữ thay vì gọi: `system_action action="volume_up" amount=100`, system_action(action="volume_up"),
// screen_act({"action":"click"}), <system_action><action>volume_up</action></system_action>, <function=open_app>{"name":"Zalo"}</function>.
// Chỉ nhận khi đúng tên công cụ đang bật và tham số khớp lược đồ (tên tham số có thật, giá trị enum hợp lệ); tham số lạ bị bỏ.
function coerceArgs(raw, schema) {
  const props = schema && schema.properties ? schema.properties : null; const out = {};
  for (const [k, v0] of Object.entries(raw || {})) {
    if (props && !props[k]) continue; let v = v0; const t = props && props[k] && props[k].type;
    if ((t === 'integer' || t === 'number') && typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v)) v = Number(v);
    if (t === 'boolean' && typeof v === 'string') v = /^(true|1|yes)$/i.test(v);
    if (props && props[k] && Array.isArray(props[k].enum) && !props[k].enum.includes(v)) return null;
    out[k] = v;
  }
  const req = schema && Array.isArray(schema.required) ? schema.required : [];
  if (req.some(k => out[k] == null || out[k] === '')) return null;
  return out;
}
function kvArgs(str) {
  const o = {}; const re = /([A-Za-z_][\w]*)\s*[=:]\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|“([^”]*)”|([^\s,)]+))/g; let m, n = 0;
  while ((m = re.exec(str))) { o[m[1]] = m[2] ?? m[3] ?? m[4] ?? m[5]; n++; }
  return n ? o : null;
}
function salvage(text, allowed, schemas, calls) {
  const names = allowed.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'); if (!names) return text;
  const push = (name, args) => { const sc = schemas && schemas[name]; const a = coerceArgs(args || {}, sc); if (!a) return false; calls.push({ id: 'call_' + Math.random().toString(36).slice(2, 12), name, arguments: a, salvaged: true }); return true; };
  let rest = text;
  // XML-ish
  rest = rest.replace(new RegExp(`<function=(${names})>\\s*(\\{[\\s\\S]*?\\})\\s*</function>`, 'g'), (all, n, j) => { try { return push(n, JSON.parse(j)) ? '' : all; } catch { return all; } });
  rest = rest.replace(new RegExp(`<(${names})>([\\s\\S]*?)</\\1>`, 'g'), (all, n, body) => { const o = {}; body.replace(/<(\w+)>([\s\S]*?)<\/\1>/g, (_, k, v) => { o[k] = v.trim(); return ''; }); return Object.keys(o).length && push(n, o) ? '' : all; });
  // name({json}) / name(k=v, …) / name k=v … (trong ``` ``` hoặc ` ` hoặc đứng riêng một dòng)
  rest = rest.replace(new RegExp(`(\`{1,3}[a-z]*\\s*)?\\b(${names})\\s*(?:\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)|\\(([^)\\n]*)\\)|((?:[ \\t]+[A-Za-z_]\\w*\\s*[=:]\\s*(?:"[^"\\n]*"|'[^'\\n]*'|“[^”\\n]*”|[^\\s,)\`]+))+))\\s*(\`{1,3})?`, 'g'), (all, open, n, json, inner, kv) => {
    let args = null;
    if (json) { try { args = JSON.parse(json); } catch { args = null; } }
    else if (inner != null) args = kvArgs(inner) || (inner.trim() ? null : {});
    else if (kv) args = kvArgs(kv);
    if (!args) return all;
    return push(n, args) ? '' : all;
  });
  return rest.replace(/```\s*```/g, '').replace(/`\s*`/g, '');
}

// Lọc luồng chữ: không hiện khối <tool_call> đang được sinh ra cho người dùng
function streamFilter(onToken) {
  let buf = '', hidden = false;
  return {
    push(piece) {
      if (hidden || !onToken) return;
      buf += piece;
      const i = buf.indexOf('<tool_call'); if (i >= 0) { if (i > 0) onToken(buf.slice(0, i)); hidden = true; buf = ''; return; }
      const keep = Math.min(buf.length, 10); const emit = buf.slice(0, buf.length - keep);
      if (emit) { onToken(emit); buf = buf.slice(emit.length); }
    },
    end() { if (!hidden && buf && onToken) onToken(buf); buf = ''; },
  };
}

const isTemplateError = (msg) => /parser|template|raise_exception|alternate|jinja|chat format|CallExpression/i.test(String(msg || ''));

// Rút gọn: mô tả công cụ một câu, bỏ mô tả tham số
function compactTools(tools) {
  const strip = (p) => { if (!p || typeof p !== 'object') return p; const o = { ...p }; delete o.description; if (o.properties) o.properties = Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, strip(v)])); if (o.items) o.items = strip(o.items); return o; };
  return tools.map(t => ({ ...t, description: String(t.description || '').split(/(?<=[.!?])\s/)[0].slice(0, 120), parameters: strip(t.parameters) }));
}
// 0.15.2: bản mô tả công cụ gọn cho ngữ cảnh ≤ 16k: tối đa 2 câu / 300 ký tự cho công cụ, 70 ký tự cho tham số.
// Câu kết thúc bằng . ! ? rồi khoảng trắng + chữ HOA (không cắt nhầm ở "vd.").
const LEAN_DESC = {
  screen_act: 'Làm MỘT thao tác: click / double_click / right_click (element = id [eN] của lần quan sát mới nhất hoặc tên phần tử; hoặc x,y thang 0-1000), type_text (text, dán một lần; element = ô cần gõ; submit: true = gõ xong bấm Enter — bấm ô + gõ + Enter chỉ cần MỘT lần gọi), hotkey (keys, vd. "enter", "ctrl+s"), scroll (amount âm = xuống), wait (seconds), focus_window (window). Kết quả kèm kiểm tra và danh sách phần tử mới. Không bao giờ gõ mật khẩu.',
  screen_look: 'Quan sát cửa sổ đang dùng: danh sách phần tử [eN] (loại, tên, giá trị, vị trí x,y 0-1000) và chữ đọc được. Gọi trước screen_act. window: chuyển tới cửa sổ đó trước; query: lọc phần tử theo chữ.',
  run_javascript: 'Chạy đoạn JavaScript ngắn trong hộp cát (không mạng, không đọc tệp, tối đa 3 giây); in kết quả bằng console.log. input_file: nội dung tệp trong thư mục được phép có sẵn trong biến INPUT.',
};
function leanTools(tools) {
  const cap = (d, n) => { d = String(d || '').trim(); return d.length > n ? d.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : d; };
  const strip = (p) => { if (!p || typeof p !== 'object') return p; const o = { ...p }; if (o.description) o.description = cap(o.description, 70); if (o.properties) o.properties = Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, strip(v)])); if (o.items) o.items = strip(o.items); return o; };
  return tools.map(t => ({ ...t, description: LEAN_DESC[t.name] || t.description, parameters: strip(t.parameters) }));
}
// Giữ lời nhắc hệ thống (cắt bớt) + vài lượt cuối, không cắt rời lời gọi công cụ khỏi kết quả
function trimHistory(messages) {
  const sys = messages.filter(m => m.role === 'system').map(m => ({ ...m, content: typeof m.content === 'string' && m.content.length > 2500 ? m.content.slice(0, 2500) + '\n…' : m.content }));
  const rest = messages.filter(m => m.role !== 'system');
  let start = Math.max(0, rest.length - 6);
  while (start > 0 && rest[start].role === 'tool') start--;
  return [...sys, ...rest.slice(start)];
}
// 0.15.2: thêm "Failed to compress chat history … too long prompt or system message" (node-llama-cpp 3.22) — trước đây lọt ra người dùng bằng tiếng Anh
const CTX_RE = /context shift strategy|fits the context size|context size is too small|too long for the context|exceeds the available context size|compress chat history|too long prompt or system message|increasing the context size/i;
function ctxSmallError(n) {
  const x = new Error(`Độ dài ngữ cảnh${n ? ' ' + n + ' token' : ''} quá nhỏ cho yêu cầu này (lời nhắc hệ thống + mô tả công cụ + lịch sử). Hãy tăng "Độ dài ngữ cảnh" lên 8192 trong Cài đặt trò chuyện rồi nạp lại mô hình, hoặc tắt bớt công cụ trên đầu AIVN AGENT.`);
  x.code = 'CTX_SMALL'; return x;
}

// Mẫu chat có gọi công cụ gốc? (Qwen2.5/3 <tool_call>, Llama 3.1+ <|python_tag|>/ipython, Mistral [TOOL_CALLS], Hermes, gpt-oss…)
function templateHasTools(tpl) {
  const t = String(tpl || ''); if (!t) return null;
  return /<tool_call>|\[TOOL_CALLS\]|\[AVAILABLE_TOOLS\]|<\|python_tag\|>|ipython|tool_calls|<\|tool_call|functions\.|<function=/.test(t) && /\btools\b/.test(t);
}
module.exports = { templateHasTools, compactTools, leanTools, trimHistory, CTX_RE, ctxSmallError, analyzeTemplate, normalizeMessages, parseToolCalls, toolPrompt, streamFilter, isTemplateError, contentText };
