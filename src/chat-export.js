'use strict';
// B82: xuất một cuộc trò chuyện ra tệp — Markdown (.md), văn bản (.txt) hoặc JSON (.json). Hàm thuần, không đụng tệp/IPC (main.js lưu).
// L = nhãn đã dịch theo ngôn ngữ giao diện (main.js truyền vào): { you, assistant, exported, attachments, tools, refused, failed, untitled }
const DEF = { you: 'Bạn', assistant: 'AIVN', exported: 'Xuất từ AIVN', attachments: 'Đính kèm', tools: 'Công cụ đã dùng', refused: 'bị từ chối', failed: 'lỗi', untitled: 'Cuộc trò chuyện' };
const FORMATS = ['md', 'txt', 'json'];
const fmtOf = (file) => { const m = /\.(md|markdown|txt|json)$/i.exec(String(file || '')); return m ? ({ markdown: 'md' })[m[1].toLowerCase()] || m[1].toLowerCase() : 'md'; };
const when = (t, loc) => { if (!t) return ''; try { return new Date(t).toLocaleString(loc || 'vi-VN'); } catch { return new Date(t).toISOString(); } };
const stepText = (s, L) => `${s.label || s.tool || '?'}${s.summary ? ` (${String(s.summary).slice(0, 120)})` : ''} ${s.status === 'ok' ? '✓' : s.status === 'refused' ? `✗ ${L.refused}` : s.status ? `✗ ${L.failed}` : ''}`.trim();
// bản sạch để lưu: bỏ ảnh thu nhỏ base64, ngữ cảnh nội bộ và trường lạ (giữ nội dung người dùng cần)
function clean(c) {
  return {
    id: c.id, title: c.title || '', mode: c.mode === 'agent' ? 'agent' : 'chat', createdAt: c.createdAt || null, updatedAt: c.updatedAt || null,
    messages: (c.messages || []).map(m => {
      const o = { role: m.role, content: String(m.content || '') };
      if (m.at) o.at = m.at; if (m.model) o.model = m.model;
      if (m.attachments && m.attachments.length) o.attachments = m.attachments.map(a => ({ name: a.name, kind: a.kind || null, size: a.size || null, ...(a.pages ? { pages: a.pages } : {}) }));
      if (m.steps && m.steps.length) o.steps = m.steps.map(s => ({ label: s.label || s.tool || '', ...(s.summary ? { summary: String(s.summary) } : {}), status: s.status || null }));
      return o;
    }),
  };
}
function render(convo, fmt = 'md', o = {}) {
  const L = { ...DEF, ...(o.labels || {}) }; const c = clean(convo || {}); const now = o.now ?? Date.now();
  const title = c.title || L.untitled; const who = (m) => m.role === 'user' ? L.you : L.assistant + (m.model ? ` (${m.model})` : '');
  if (fmt === 'json') return JSON.stringify({ app: 'AIVN', version: o.version || null, exportedAt: new Date(now).toISOString(), conversation: c }, null, 2) + '\n';
  const head = `${L.exported}${o.version ? ' ' + o.version : ''} · ${when(now, o.locale)}`;
  const parts = [];
  if (fmt === 'txt') {
    parts.push(title, head, '');
    for (const m of c.messages) {
      parts.push(`${who(m)}${m.at ? ' · ' + when(m.at, o.locale) : ''}:`);
      if (m.attachments) parts.push(`[${L.attachments}: ${m.attachments.map(a => a.name).join(', ')}]`);
      if (m.steps) parts.push(`[${L.tools}: ${m.steps.map(s => stepText(s, L)).join('; ')}]`);
      parts.push(m.content, '');
    }
    return parts.join('\n').replace(/\n+$/, '') + '\n';
  }
  parts.push(`# ${title.replace(/\n/g, ' ')}`, '', `_${head}_`, '');
  for (const m of c.messages) {
    parts.push(`### ${m.role === 'user' ? '🧑' : '🤖'} ${who(m)}${m.at ? ` · ${when(m.at, o.locale)}` : ''}`, '');
    if (m.attachments) parts.push(`> 📎 ${L.attachments}: ${m.attachments.map(a => a.name).join(', ')}`, '');
    if (m.steps) parts.push(`> 🛠 ${L.tools}: ${m.steps.map(s => stepText(s, L)).join('; ')}`, '');
    parts.push(m.content, '');
  }
  return parts.join('\n').replace(/\n+$/, '') + '\n';
}
// tên tệp gợi ý: tiêu đề bỏ ký tự cấm trên Windows, tối đa 80 ký tự
const fileName = (c, fmt = 'md') => `${String((c && c.title) || 'aivn-chat').replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'aivn-chat'}.${FORMATS.includes(fmt) ? fmt : 'md'}`;
module.exports = { render, clean, fileName, fmtOf, FORMATS };
