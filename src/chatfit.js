'use strict';
// 0.16: tham số trò chuyện + chính sách tràn ngữ cảnh (hàm thuần, kiểm thử được)
// 0.16: tham số trò chuyện kiểu LM Studio (null = mặc định của mô hình)
function cleanChatParams(p) {
  const r = { overflow: 'trim-middle' }; if (!p || typeof p !== 'object') return r;
  const num = (v, lo, hi) => { if (v === null || v === undefined || v === '') return undefined; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined; };
  r.topK = num(p.topK, 0, 1000); r.topP = num(p.topP, 0, 1); r.minP = num(p.minP, 0, 1); r.repeatPenalty = num(p.repeatPenalty, 0.5, 3); r.presencePenalty = num(p.presencePenalty, -2, 2);
  const sd = num(p.seed, 0, 2 ** 31 - 1); r.seed = sd != null ? Math.floor(sd) : null;
  r.stop = Array.isArray(p.stop) ? p.stop.filter(x => typeof x === 'string' && x.length && x.length <= 100).slice(0, 8) : null;
  if (['trim-middle', 'rolling', 'stop'].includes(p.overflow)) r.overflow = p.overflow;
  if (p.jsonSchema && typeof p.jsonSchema === 'object') r.jsonSchema = p.jsonSchema;
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
}
// Chính sách tràn ngữ cảnh: 'trim-middle' giữ lời nhắc hệ thống + lượt đầu + phần gần nhất; 'rolling' bỏ dần tin cũ nhất; 'stop' báo lỗi rõ ràng
function fitOverflow(messages, policy = 'trim-middle', maxTokens = 1024, ctx = 0, countTokens = (t) => Math.ceil(String(t).length / 3)) {
  if (!ctx) return { messages, dropped: 0 };
  const tok = (m) => { const c = m.content; const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.type === 'text' ? x.text : '').join(' ') + ' '.repeat(Array.isArray(c) ? c.filter(x => x.type === 'image_url').length * 2400 : 0) : ''; return countTokens(t) + 8; };
  const budget = ctx - Math.min(maxTokens || 1024, Math.floor(ctx / 2)) - 64;
  const sizes = messages.map(tok); let total = sizes.reduce((a, b) => a + b, 0);
  if (total <= budget) return { messages, dropped: 0 };
  if (policy === 'stop') { const e = new Error(`Cuộc trò chuyện đã dài hơn độ dài ngữ cảnh của mô hình (khoảng ${total.toLocaleString('vi-VN')} / ${ctx.toLocaleString('vi-VN')} token) — cần nhiều ngữ cảnh hơn. Hãy bấm "Tăng ngữ cảnh", mở cuộc trò chuyện mới, hoặc đổi "Khi vượt ngữ cảnh" thành "Cắt phần giữa".`); e.code = 'CTX_FULL'; throw e; }
  const keep = messages.map(() => true); const sysN = messages.findIndex(m => m.role !== 'system'); const first = sysN < 0 ? messages.length : sysN;
  const last = messages.length - 1; // tin của người dùng đang gửi luôn giữ
  const protectHead = policy === 'trim-middle' ? Math.min(last, first + 2) : first; // lượt hỏi-đáp đầu tiên
  let dropped = 0;
  for (let i = protectHead; i < last && total > budget; i++) { keep[i] = false; total -= sizes[i]; dropped++; }
  if (total > budget && policy === 'trim-middle') for (let i = first; i < protectHead && total > budget; i++) { keep[i] = false; total -= sizes[i]; dropped++; }
  let out = messages.filter((_, i) => keep[i]);
  // không bắt đầu phần hội thoại bằng câu trả lời của trợ lý (một số mẫu chat yêu cầu user trước)
  while (out.length > 1 && out[first] && out[first].role === 'assistant' && first < out.length - 1) { out.splice(first, 1); dropped++; }
  return { messages: out, dropped };
}
// Kiểm tra nhẹ JSON Schema trước khi dựng ngữ pháp (bộ dựng ngữ pháp bỏ qua kiểu lạ một cách im lặng)
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
function schemaError(s, path = 'gốc', depth = 0) {
  if (depth > 20) return 'lược đồ lồng quá sâu';
  if (!s || typeof s !== 'object' || Array.isArray(s)) return `${path}: phải là một đối tượng`;
  const ts = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  for (const t of ts) if (!TYPES.has(t)) return `${path}: kiểu "${t}" không hợp lệ (dùng object, array, string, number, integer, boolean, null)`;
  if (!ts.length && !s.enum && s.const === undefined && !s.anyOf && !s.oneOf && !s.allOf && !s.$ref && !s.properties && !s.items) return `${path}: thiếu "type"`;
  if (s.properties) { if (typeof s.properties !== 'object') return `${path}.properties: phải là đối tượng`; for (const [k, v] of Object.entries(s.properties)) { const e = schemaError(v, path + '.' + k, depth + 1); if (e) return e; } }
  if (s.items && !Array.isArray(s.items)) { const e = schemaError(s.items, path + '[]', depth + 1); if (e) return e; }
  for (const k of ['anyOf', 'oneOf', 'allOf']) if (s[k]) { if (!Array.isArray(s[k])) return `${path}.${k}: phải là mảng`; for (const v of s[k]) { const e = schemaError(v, path, depth + 1); if (e) return e; } }
  if (s.required && !Array.isArray(s.required)) return `${path}.required: phải là mảng tên trường`;
  return null;
}
module.exports = { cleanChatParams, fitOverflow, schemaError };
