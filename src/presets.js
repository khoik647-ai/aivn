// 0.16: preset trò chuyện (lời nhắc hệ thống + tham số lấy mẫu/đầu ra). Định dạng tệp AIVN + đọc được preset xuất từ LM Studio.
'use strict';
const DEFAULT_PROMPT = 'Bạn là AIVN, một trợ lý AI thân thiện. Hãy trả lời bằng tiếng Việt, rõ ràng và chính xác.';
const PARAM_KEYS = ['topK', 'topP', 'minP', 'repeatPenalty', 'presencePenalty', 'seed', 'stop', 'overflow', 'jsonOn', 'jsonSchema'];
const BUILTIN = [
  { id: 'b:mac-dinh', name: 'Mặc định', builtin: true, systemPrompt: DEFAULT_PROMPT, temperature: 0.7, maxTokens: 1024, params: {} },
  { id: 'b:chinh-xac', name: 'Chính xác, ngắn gọn', builtin: true, temperature: 0.2, maxTokens: 1024, params: { topP: 0.9 },
    systemPrompt: 'Bạn là AIVN. Trả lời bằng tiếng Việt, ngắn gọn và đúng trọng tâm. Dùng gạch đầu dòng khi liệt kê. Nếu không chắc chắn, hãy nói rõ là không chắc thay vì đoán.' },
  { id: 'b:sang-tao', name: 'Viết sáng tạo', builtin: true, temperature: 1.0, maxTokens: 2048, params: { topP: 0.95, presencePenalty: 0.6 },
    systemPrompt: 'Bạn là một cây bút tiếng Việt giàu hình ảnh. Viết tự nhiên, giàu cảm xúc, tránh sáo rỗng; giữ đúng giọng văn và độ dài người dùng yêu cầu.' },
  { id: 'b:lap-trinh', name: 'Lập trình viên', builtin: true, temperature: 0.3, maxTokens: 2048, params: {},
    systemPrompt: 'Bạn là kỹ sư phần mềm giàu kinh nghiệm. Giải thích bằng tiếng Việt, mã nguồn đặt trong khối ``` có ghi tên ngôn ngữ. Ưu tiên lời giải đơn giản, chạy được, có xử lý lỗi; nêu giả định nếu đề bài chưa rõ.' },
  { id: 'b:dich', name: 'Dịch Anh ↔ Việt', builtin: true, temperature: 0.2, maxTokens: 2048, params: {},
    systemPrompt: 'Bạn là biên dịch viên. Nếu văn bản là tiếng Việt, dịch sang tiếng Anh; nếu là ngôn ngữ khác, dịch sang tiếng Việt. Chỉ trả về bản dịch, giữ nguyên định dạng, tên riêng và thuật ngữ chuyên ngành.' },
  { id: 'b:json', name: 'Trả lời JSON', builtin: true, temperature: 0, maxTokens: 1024, params: { jsonOn: true, jsonSchema: JSON.stringify({ type: 'object', properties: { tra_loi: { type: 'string' }, do_tin_cay: { type: 'number' } }, required: ['tra_loi'] }, null, 2) },
    systemPrompt: 'Bạn là AIVN. Luôn trả lời bằng một đối tượng JSON đúng lược đồ được yêu cầu, nội dung bằng tiếng Việt.' },
];
const num = (v, lo, hi) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
function cleanPreset(p) {
  if (!p || typeof p !== 'object') throw new Error('Preset không hợp lệ');
  const name = String(p.name || '').trim().slice(0, 60); if (!name) throw new Error('Preset cần có tên');
  const q = p.params || {}; const params = {};
  for (const [k, lo, hi] of [['topK', 0, 1000], ['topP', 0, 1], ['minP', 0, 1], ['repeatPenalty', 0.5, 3], ['presencePenalty', -2, 2], ['seed', 0, 2 ** 31 - 1]]) { const v = num(q[k], lo, hi); if (v != null) params[k] = v; }
  if (Array.isArray(q.stop)) { const st = q.stop.filter(x => typeof x === 'string' && x.length && x.length <= 100).slice(0, 8); if (st.length) params.stop = st; }
  if (['trim-middle', 'rolling', 'stop'].includes(q.overflow)) params.overflow = q.overflow;
  if (q.jsonOn) params.jsonOn = true;
  if (typeof q.jsonSchema === 'string' && q.jsonSchema.length < 20000) params.jsonSchema = q.jsonSchema;
  return { name, systemPrompt: typeof p.systemPrompt === 'string' ? p.systemPrompt.slice(0, 20000) : '', temperature: num(p.temperature, 0, 2) ?? 0.7, maxTokens: Math.round(num(p.maxTokens, 16, 32768) ?? 1024), params };
}
// Tệp preset LM Studio: { name, operation: { fields: [{ key: 'llm.prediction.temperature', value: 0.7 }, …] } }
function fromLmStudio(j) {
  const f = {}; for (const x of (j.operation && j.operation.fields) || []) if (x && x.key) f[x.key] = x.value;
  const v = (k) => { const x = f['llm.prediction.' + k]; return x && typeof x === 'object' && 'checked' in x ? (x.checked ? x.value : null) : x; };
  const ov = { truncateMiddle: 'trim-middle', rollingWindow: 'rolling', stopAtLimit: 'stop' }[v('contextOverflowPolicy')];
  const st = v('structured'); const mt = v('maxPredictedTokens');
  const rp = v('repeatPenalty');
  return { name: j.name || j.identifier || 'Preset LM Studio', systemPrompt: v('systemPrompt') || '', temperature: v('temperature'), maxTokens: typeof mt === 'number' ? mt : null,
    params: { topK: v('topKSampling'), topP: v('topPSampling'), minP: v('minPSampling'), repeatPenalty: typeof rp === 'number' ? rp : null, stop: v('stopStrings'), overflow: ov,
      ...(st && st.type === 'json' && st.jsonSchema ? { jsonOn: true, jsonSchema: JSON.stringify(st.jsonSchema, null, 2) } : {}) } };
}
function parseImport(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error('Tệp không phải JSON hợp lệ'); }
  if (j && j.operation && Array.isArray(j.operation.fields)) return cleanPreset(fromLmStudio(j));
  if (j && j.aivnPreset) return cleanPreset(j);
  if (j && (j.systemPrompt != null || j.params)) return cleanPreset(j);
  throw new Error('Không nhận ra định dạng preset (cần tệp xuất từ AIVN hoặc LM Studio)');
}
const toExport = (p) => JSON.stringify({ aivnPreset: 1, ...cleanPreset(p) }, null, 2);
module.exports = { BUILTIN, DEFAULT_PROMPT, PARAM_KEYS, cleanPreset, parseImport, fromLmStudio, toExport };
