// Ước lượng khả năng gọi công cụ của một mô hình (cho chế độ AIVN BOT): good / limited / none
// Phát triển bởi NGUYỄN NGỌC KHÔI SINH VIÊN VLU
'use strict';
const LABEL = { good: 'Tốt', limited: 'Hạn chế', none: 'Không' };
const HINT = {
  good: 'Mô hình được huấn luyện để gọi công cụ: AIVN BOT mở ứng dụng, đọc tệp… đáng tin cậy.',
  limited: 'Mẫu chat không có gọi công cụ gốc hoặc mô hình nhỏ: AIVN dùng giao thức công cụ dạng văn bản, có thể bỏ bước hoặc gọi sai. Nên dùng Qwen3 4B/8B cho AIVN BOT.',
  none: 'Mô hình quá nhỏ/không hợp để gọi công cụ: AIVN BOT gần như không thao tác được. Chỉ nên dùng để trò chuyện.',
};
function paramsOf(name, params) {
  if (params) { const p = parseFloat(String(params).replace(',', '.')); if (p) return /m\b/i.test(String(params)) && p > 20 ? p / 1000 : p; }
  const m = String(name || '').toLowerCase().match(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)\s*([bm])(?![a-z])/);
  if (!m) return null; const v = parseFloat(m[1]); return m[2] === 'm' ? v / 1000 : v;
}
function toolSupport({ id = '', name = '', file = '', params = null } = {}) {
  const s = `${id} ${name} ${file}`.toLowerCase().replace(/_/g, '-');
  const p = paramsOf(`${id} ${file} ${name}`, params);
  let level;
  if (/smol|tinyllama|-1b-|deepseek-r1-distill-qwen-1\.5b|phi-3/.test(s) || (p != null && p < 1.2)) level = 'none';
  else if (/gpt-oss|mistral-nemo|mistral-small|ministral|functionary|hermes-3|command-r/.test(s)) level = 'good';
  else if (/qwen-?3(?!-vl)/.test(s) && (p == null || p >= 4)) level = 'good';
  else if (/qwen2\.5(?!-vl)/.test(s) && p != null && p >= 7) level = 'good';
  else if (/llama-?3\.[13]/.test(s) && p != null && p >= 8) level = 'good';
  else if (/\bphi-4(?![- ]?mini)/.test(s)) level = 'good';
  else level = 'limited'; // Gemma 2/3, Mistral 7B, Llama 3.2 3B, Qwen 1.5–3B, mô hình nhìn ảnh nhỏ, mô hình lạ
  return { level, label: LABEL[level], hint: HINT[level] };
}
module.exports = { toolSupport, paramsOf, LABEL };
