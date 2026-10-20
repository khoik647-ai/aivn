'use strict';
// Tham số lấy mẫu hợp lý theo họ mô hình (0.15.0). Mô hình nhỏ ở nhiệt độ rất thấp (0.2) + không phạt lặp dễ rơi vào vòng lặp câu
// (“Bạn có muốn tôi thực hiện các bước này cho bạn không?” lặp mãi) — đã thấy trên Qwen3-VL 8B, Windows, RTX 3050 Ti.
const BASE = { temperature: 0.6, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.1, presencePenalty: 0.3, frequencyPenalty: 0, repeatLastN: 256, dry: { strength: 0.8, base: 1.75, allowedLength: 2 } };
const FAMILY = [
  // Qwen khuyên dùng: chế độ không suy nghĩ temp 0.7, top_p 0.8, top_k 20, min_p 0; có thể thêm presence_penalty khi bị lặp
  [/qwen3|qwen-3/i, { temperature: 0.7, topP: 0.8, topK: 20, minP: 0, presencePenalty: 0.5 }],
  [/qwen2\.5|qwen2_5|qwen-2\.5|qwen2-vl|qwen2vl/i, { temperature: 0.7, topP: 0.8, topK: 20, repeatPenalty: 1.1, presencePenalty: 0.3 }],
  [/gemma/i, { temperature: 0.7, topP: 0.95, topK: 64, minP: 0 }],
  [/llama|mistral|phi/i, { temperature: 0.6, topP: 0.9 }],
];
// mode: 'chat' | 'agent' (bước có công cụ) | 'json' (sinh có ràng buộc ngữ pháp: tắt phạt lặp để không làm hỏng JSON)
function samplingFor(modelId = '', mode = 'chat', { temperature = null } = {}) {
  if (mode === 'json') return { temperature: 0, topP: 1, topK: 0, minP: 0, repeatPenalty: 1, presencePenalty: 0, frequencyPenalty: 0, repeatLastN: 0, dry: null };
  const f = FAMILY.find(([re]) => re.test(String(modelId)));
  const s = { ...BASE, ...(f ? f[1] : {}) };
  if (mode === 'agent') s.temperature = Math.min(s.temperature, 0.6); // gọi công cụ cần ổn định hơn một chút, nhưng không “tham lam” (dễ lặp)
  if (typeof temperature === 'number' && isFinite(temperature)) s.temperature = Math.max(0, Math.min(2, temperature));
  return s;
}
// tham số cho llama-server (/v1/chat/completions)
function toServer(s) {
  if (!s) return {};
  const o = { top_k: s.topK, min_p: s.minP, top_p: s.topP, repeat_penalty: s.repeatPenalty, repeat_last_n: s.repeatLastN, presence_penalty: s.presencePenalty, frequency_penalty: s.frequencyPenalty };
  if (s.dry) Object.assign(o, { dry_multiplier: s.dry.strength, dry_base: s.dry.base, dry_allowed_length: s.dry.allowedLength });
  else o.dry_multiplier = 0;
  return o;
}
// tham số cho node-llama-cpp (LlamaChat.generateResponse)
function toLlamaCpp(s) {
  if (!s) return {};
  const o = { topK: s.topK || undefined, minP: s.minP || undefined, topP: s.topP };
  if (s.repeatPenalty > 1 || s.presencePenalty || s.frequencyPenalty) o.repeatPenalty = { penalty: s.repeatPenalty, presencePenalty: s.presencePenalty || undefined, frequencyPenalty: s.frequencyPenalty || undefined, lastTokens: s.repeatLastN || 64 };
  if (s.dry && s.dry.strength) o.dryRepeatPenalty = { strength: s.dry.strength, base: s.dry.base, allowedLength: s.dry.allowedLength };
  return o;
}
module.exports = { samplingFor, toServer, toLlamaCpp };
