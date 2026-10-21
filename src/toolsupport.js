// Ước lượng khả năng gọi công cụ của một mô hình (cho chế độ AIVN AGENT): good / limited / none
// Phát triển bởi NGUYỄN NGỌC KHÔI SINH VIÊN VLU
'use strict';
const LABEL = { good: 'Tốt', limited: 'Hạn chế', none: 'Không' };
const HINT = {
  good: 'Mô hình được huấn luyện để gọi công cụ: AIVN AGENT mở ứng dụng, đọc tệp… đáng tin cậy.',
  limited: 'Mẫu chat không có gọi công cụ gốc hoặc mô hình nhỏ: AIVN dùng giao thức công cụ dạng văn bản, có thể bỏ bước hoặc gọi sai. Nên dùng mô hình có nhãn ✓ Gọi công cụ cho AIVN AGENT.',
  none: 'Mô hình quá nhỏ/không hợp để gọi công cụ: AIVN AGENT gần như không thao tác được. Chỉ nên dùng để trò chuyện.',
};
function paramsOf(name, params) {
  if (params) { const p = parseFloat(String(params).replace(',', '.')); if (p) return /m\b/i.test(String(params)) && p > 20 ? p / 1000 : p; }
  const m = String(name || '').toLowerCase().match(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)\s*([bm])(?![a-z])/);
  if (!m) return null; const v = parseFloat(m[1]); return m[2] === 'm' ? v / 1000 : v;
}
// meta (khi mô hình đã nạp): { name, arch, sizeLabel, toolTemplate } đọc từ GGUF; toolMode/wrapper từ bộ máy
function toolSupport({ id = '', name = '', file = '', params = null, meta = null, toolMode = null, wrapper = null, size = 0, toolLevel = null, claims = null, mmproj = null } = {}) {
  // B19 (QA lượt 2): kết quả AIVN tự thử (nhãn ✓/⚠ “Gọi công cụ”, docs/verified.md) là nguồn DUY NHẤT khi có — nhãn 🛠 không được mâu thuẫn với nó
  const tc = Array.isArray(claims) ? claims.filter(c => c.t === 'tools') : [];
  if (tc.some(c => c.k === 'x')) return { level: 'limited', label: LABEL.limited, hint: 'AIVN đã thử: mô hình không gọi công cụ trong bài thử (docs/verified.md). ' + HINT.limited, verified: true };
  if (tc.some(c => c.k === 'v')) {
    const tiny = paramsOf(`${id} ${file} ${name}`, params); // mô hình rất nhỏ: thử gọi được nhưng dễ sai ở việc nhiều bước
    if (tiny != null && tiny < 1.2) return { level: 'limited', label: 'Gọi được, chưa ổn định', hint: 'AIVN đã thử gọi được công cụ (docs/verified.md), nhưng mô hình rất nhỏ nên dễ gọi sai ở việc nhiều bước.', verified: true };
    const est = toolSupport({ id, name, file, params, meta, toolMode, wrapper, size, toolLevel }).level;
    // mô hình chữ mà ước lượng chỉ “Hạn chế” (vd. Gemma 2 2B qua giao thức dạng văn bản): mới thử gọi được một lần, chưa gọi là “Tốt”
    if (est !== 'good' && !mmproj) return { level: 'limited', label: 'Gọi được (AIVN thử 1 lần)', hint: 'AIVN đã thử: mô hình gọi đúng công cụ trong bài thử (docs/verified.md), nhưng mới thử một lần; việc nhiều bước có thể bỏ bước hoặc gọi sai.', verified: true };
    return { level: 'good', label: LABEL.good, hint: 'AIVN đã tự thử: gọi đúng công cụ (docs/verified.md).', verified: true };
  }
  if (LABEL[toolLevel]) return { level: toolLevel, label: LABEL[toolLevel], hint: HINT[toolLevel] }; // đã kiểm tra thật trong Kho (mục Điều khiển máy tính)
  const s = `${id} ${name} ${file} ${meta && meta.name || ''} ${meta && meta.arch || ''}`.toLowerCase().replace(/_/g, '-');
  let p = paramsOf(`${id} ${file} ${name} ${meta && meta.sizeLabel || ''} ${meta && meta.name || ''}`, params);
  if (p == null && size > 0) p = Math.round(size / 0.62e9 * 10) / 10; // ~Q4_K_M: 0,62 GB / tỉ tham số
  let level;
  if (/smollm2|smolvlm|tinyllama|-1b-|deepseek-r1-distill-qwen-1\.5b|phi-3/.test(s) || (p != null && p < 1.2)) level = 'none';
  else if (/gpt-oss|mistral-nemo|mistral-small|ministral|functionary|hermes-3|command-r/.test(s)) level = 'good';
  else if (/qwen-?3(?!-vl)/.test(s) && (p == null || p >= 4)) level = 'good';
  else if (/qwen2\.5(?!-vl)/.test(s) && !/coder/.test(s) && p != null && p >= 7) level = 'good'; // Coder 7B: AIVN thử, từ chối gọi công cụ
  else if (/llama-?3\.[13]/.test(s) && p != null && p >= 8) level = 'good';
  else if (/\bphi-4(?![- ]?mini)/.test(s)) level = 'good';
  else if (/qwen-?3-?vl|qwen2\.5-?vl/.test(s) && (p == null || p >= 3.5)) level = 'good'; // Qwen-VL: gọi công cụ gốc <tool_call>
  else if (/qwen-?3|qwen3/.test(s) && /\b(qwen3|qwen3moe)\b/.test(s) && p == null) level = 'good';
  else level = 'limited'; // Gemma 2/3, Mistral 7B, Llama 3.2 3B, Qwen 1.5–3B, mô hình nhìn ảnh nhỏ, mô hình lạ
  // mẫu chat của chính tệp GGUF có gọi công cụ gốc (hoặc bộ máy đã nhận ra định dạng gốc) → không hạ xuống "Hạn chế" chỉ vì tên lạ
  if (level === 'limited' && (meta && meta.toolTemplate || toolMode === 'native') && (p == null || p >= 3.5)) level = 'good';
  return { level, label: LABEL[level], hint: HINT[level] };
}
module.exports = { toolSupport, paramsOf, LABEL };
