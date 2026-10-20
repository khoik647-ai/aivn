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
    'Không bao giờ bịa kết quả công cụ; không nói đã làm khi chưa nhận được <tool_result>.',
  ].join('\n');
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
function parseToolCalls(text, allowed = null) {
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
  return { text: rest.replace(/<\/?tool_call>/g, '').trim(), toolCalls: calls };
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

module.exports = { analyzeTemplate, normalizeMessages, parseToolCalls, toolPrompt, streamFilter, isTemplateError, contentText };
