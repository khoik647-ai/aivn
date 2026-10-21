'use strict';
// 0.16: tự thu gọn lịch sử + ảnh chụp màn hình TRƯỚC MỖI lần gọi mô hình trong AIVN AGENT,
// để lượt dài (nhiều bước điều khiển máy) không bao giờ hỏng vì "context_length_exceeded".
// Thứ tự thu gọn (dừng ngay khi đã vừa):
//   0. luôn làm: chỉ giữ ảnh của tin nhắn có ảnh mới nhất; kết quả quan sát màn hình cũ chỉ giữ ý chính
//   1. rút gọn kết quả công cụ cũ (ngoài các tin gần nhất) còn ~600 ký tự
//   2. rút còn ~160 ký tự
//   3. bỏ dần các bước cũ nhất (cả cặp gọi công cụ + kết quả), ghi lại tóm tắt một dòng cho mỗi bước đã bỏ
//   4. cuối cùng: cắt phần giữa của tin lớn nhất còn lại (trừ lời nhắc hệ thống)
const IMG_NOTE = '[ảnh cũ đã lược bớt để tiết kiệm ngữ cảnh]';
const SCREEN_TOOLS = new Set(['screen_look', 'screen_act', 'read_screen_text', 'screen_read', 'ui_tree']);
const IMG_TOKENS = 1200; // ước lượng token một ảnh chụp màn hình sau khi thu nhỏ

const isImg = (p) => p && p.type === 'image_url';
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (p && p.type === 'text' ? p.text : '')).join('\n') : c == null ? '' : JSON.stringify(c);
function cut(s, n) {
  s = String(s || ''); if (s.length <= n) return s;
  const head = Math.ceil(n * 0.7), tail = Math.max(0, n - head - 1);
  return s.slice(0, head).trimEnd() + ' …(đã rút gọn)… ' + (tail ? s.slice(-tail).trimStart() : '');
}
// nhóm thành "đơn vị": trợ lý gọi công cụ + các kết quả công cụ đi kèm phải bỏ cùng nhau (mẫu chat đòi đủ cặp)
function units(msgs, from, to) {
  const out = []; let i = from;
  while (i < to) {
    const m = msgs[i]; let j = i + 1;
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) while (j < to && msgs[j].role === 'tool') j++;
    else if (m.role === 'tool') while (j < to && msgs[j].role === 'tool') j++;
    out.push([i, j]); i = j;
  }
  return out;
}
function oneLine(msgs, [a, b]) {
  const m = msgs[a];
  if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
    return m.tool_calls.map((c, k) => { const r = msgs[a + 1 + k]; const name = c.function ? c.function.name : c.name; return `- ${name}: ${cut(textOf(r && r.content).replace(/\s+/g, ' '), 90)}`; }).join('\n');
  }
  return `- ${m.role === 'user' ? 'người dùng' : m.role === 'tool' ? 'kết quả công cụ' : 'trợ lý'}: ${cut(textOf(m.content).replace(/\s+/g, ' '), 90)}`;
}

// msgs: [system, ...]. Trả { messages, tokens, budget, fits, actions: [] } — không sửa mảng gốc.
function compact(msgs, { contextSize = 0, count, toolTok = 0, reserve = 1024, keepRecent = 4 } = {}) {
  const tc = count || ((s) => Math.ceil(String(s).length / 3));
  const cache = new Map();
  const mt = (m) => { const t = textOf(m.content) + (m.tool_calls ? JSON.stringify(m.tool_calls) : ''); const k = m.role + '\u0000' + t; let n = cache.get(k); if (n == null) { n = tc(t) + 8; cache.set(k, n); } return n + (Array.isArray(m.content) ? m.content.filter(isImg).length * IMG_TOKENS : 0); };
  let out = msgs.map(m => ({ ...m, content: Array.isArray(m.content) ? m.content.slice() : m.content }));
  const actions = [];
  const total = () => out.reduce((n, m) => n + mt(m), 0);
  const budget = contextSize ? Math.max(256, contextSize - toolTok - reserve) : Infinity;
  // 0a. ảnh: chỉ giữ ảnh của tin có ảnh mới nhất
  let lastImg = -1; out.forEach((m, i) => { if (Array.isArray(m.content) && m.content.some(isImg)) lastImg = i; });
  let imgs = 0;
  out.forEach((m, i) => { if (i !== lastImg && Array.isArray(m.content) && m.content.some(isImg)) { imgs += m.content.filter(isImg).length; const t = textOf(m.content); m.content = (t ? t + '\n' : '') + IMG_NOTE; } });
  if (imgs) actions.push(`lược ${imgs} ảnh cũ`);
  // 0b. kết quả quan sát màn hình cũ (ngoài 2 lần gần nhất) chỉ giữ ý chính
  const nameOfTool = new Map(); out.forEach(m => (m.tool_calls || []).forEach(c => nameOfTool.set(c.id, c.function ? c.function.name : c.name)));
  const screenIdx = out.map((m, i) => (m.role === 'tool' && SCREEN_TOOLS.has(nameOfTool.get(m.tool_call_id)) ? i : -1)).filter(i => i >= 0);
  let shrunk = 0; for (const i of screenIdx.slice(0, -2)) { const t = textOf(out[i].content); if (t.length > 400) { out[i].content = cut(t, 400); shrunk++; } }
  if (shrunk) actions.push(`rút gọn ${shrunk} lần quan sát màn hình cũ`);
  const done = () => ({ messages: out, tokens: total(), budget, fits: total() <= budget, actions });
  if (total() <= budget) return done();
  // vùng được giữ nguyên: lời nhắc hệ thống + keepRecent tin cuối (cắt sao cho không tách cặp công cụ)
  const protStart = () => { let p = Math.max(1, out.length - keepRecent); while (p > 1 && out[p].role === 'tool') p--; return p; };
  // 1–2. rút gọn kết quả công cụ / trả lời dài ở phần cũ
  for (const lim of [600, 160]) {
    const p = protStart(); let n = 0;
    for (let i = 1; i < p; i++) { const m = out[i]; if (m.role === 'user' && i === lastUserIdx(out)) continue; const t = textOf(m.content); if ((m.role === 'tool' || m.role === 'assistant') && t.length > lim) { m.content = cut(t, lim); n++; } }
    if (n) actions.push(`rút gọn ${n} tin cũ còn ~${lim} ký tự`);
    if (total() <= budget) return done();
  }
  // 3. bỏ các bước cũ nhất; giữ yêu cầu mới nhất của người dùng
  const notes = [];
  let guard = 0;
  while (total() > budget && guard++ < 500) {
    const lu = lastUserIdx(out); const p = protStart();
    // ưu tiên bỏ phần TRƯỚC yêu cầu hiện tại, sau đó mới tới các bước cũ trong lượt này
    const before = units(out, 1, Math.max(1, lu)); const after = units(out, lu + 1, p);
    const u = before[0] || after[0]; if (!u) break;
    notes.push(oneLine(out, u)); out.splice(u[0], u[1] - u[0]);
  }
  // sau khi bỏ: tin đầu tiên (sau hệ thống) phải là của người dùng
  while (out.length > 2 && out[1].role !== 'user' && lastUserIdx(out) > 1) { notes.push(oneLine(out, [1, 2])); out.splice(1, 1); }
  if (notes.length) {
    actions.push(`bỏ ${notes.length} bước cũ`);
    const lines = notes.slice(-12); const more = notes.length - lines.length;
    out[0] = { ...out[0], content: textOf(out[0].content) + `\n\n(Các bước cũ đã được lược bớt cho vừa ngữ cảnh — tóm tắt${more ? `, ${more} bước đầu không ghi` : ''}:\n${lines.join('\n')})` };
    // tóm tắt cũng tốn token: nếu làm tràn lại, thu ngắn
    if (total() > budget) out[0] = { ...out[0], content: textOf(out[0].content).replace(/\n\n\(Các bước cũ đã được lược bớt[\s\S]*$/, `\n\n(Đã lược bớt ${notes.length} bước cũ cho vừa ngữ cảnh.)`) };
  }
  if (total() <= budget) return done();
  // 4. cắt phần giữa của tin dài nhất (trừ hệ thống) cho tới khi vừa
  for (let k = 0; k < 8 && total() > budget; k++) {
    let bi = -1, bl = 0; for (let i = 1; i < out.length; i++) { const l = textOf(out[i].content).length; if (l > bl) { bl = l; bi = i; } }
    if (bi < 0 || bl < 200) break;
    const over = total() - budget; const keep = Math.max(160, Math.floor(bl - over * 3.2 - 50));
    const m = out[bi]; const imgsKept = Array.isArray(m.content) ? m.content.filter(isImg) : [];
    m.content = imgsKept.length ? [{ type: 'text', text: cut(textOf(m.content), keep) }, ...imgsKept] : cut(textOf(m.content), keep);
    actions.push('cắt bớt một tin dài');
  }
  return done();
}
function lastUserIdx(out) { for (let i = out.length - 1; i > 0; i--) if (out[i].role === 'user') return i; return 1; }

module.exports = { compact, cut, IMG_NOTE, IMG_TOKENS, textOf };
