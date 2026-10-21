'use strict';
// Nhãn khả năng trong Khám phá — mỗi nhãn đều có nguồn.
//   k: 'v' = Đã kiểm chứng: AIVN tự chạy thử, kết quả ghi ở docs/verified.md (đường dẫn trong src)
//   k: 'd' = Theo nhà phát triển: trích từ thẻ mô hình / tài liệu chính thức (src), q = câu gốc
//   k: 'x' = AIVN đã thử nhưng CHƯA đạt (hiện như cảnh báo, để không ai hiểu nhầm lời nhà phát triển là đã kiểm chứng)
// Quy tắc (có kiểm thử): nhãn điều khiển màn hình ('screen', 'gui') chỉ được gắn cho mô hình nhìn được ảnh.
const HF = 'https://huggingface.co/';
// trang tĩnh trên GitHub Pages, release.sh tạo từ docs/verified.md mỗi lần phát hành (liên kết tới nhánh main bị 404 trước khi phát hành — QA B8)
const VER = 'https://khoik647-ai.github.io/aivn/verified.html';
const TAGS = {
  vision: 'Nhìn được ảnh', tools: 'Gọi công cụ', reasoning: 'Suy luận', code: 'Lập trình', multilingual: 'Đa ngôn ngữ',
  vi: 'Tiếng Việt', gui: 'Định vị giao diện', screen: 'Điều khiển máy tính', long: 'Ngữ cảnh dài', moe: 'MoE (nhanh so với cỡ)',
};
const SCREEN_TAGS = ['gui', 'screen'];
const KIND = { v: 'Đã kiểm chứng', d: 'Theo nhà phát triển', x: 'AIVN thử chưa đạt' };

// nguồn dùng chung
const S = {
  qwen3blog: 'https://qwenlm.github.io/blog/qwen3/',
  qwen3_8: HF + 'Qwen/Qwen3-8B', qwen3_4i: HF + 'Qwen/Qwen3-4B-Instruct-2507', qwen3_4t: HF + 'Qwen/Qwen3-4B-Thinking-2507',
  qwen3_14: HF + 'Qwen/Qwen3-14B', qwen3_30: HF + 'Qwen/Qwen3-30B-A3B-Instruct-2507', qwen3_06: HF + 'Qwen/Qwen3-0.6B', qwen3_17: HF + 'Qwen/Qwen3-1.7B',
  qwen25: HF + 'Qwen/Qwen2.5-7B-Instruct', qwen25c: HF + 'Qwen/Qwen2.5-Coder-7B-Instruct',
  qvl3_2: HF + 'Qwen/Qwen3-VL-2B-Instruct', qvl3_4: HF + 'Qwen/Qwen3-VL-4B-Instruct', qvl3_8: HF + 'Qwen/Qwen3-VL-8B-Instruct',
  qvl25_3: HF + 'Qwen/Qwen2.5-VL-3B-Instruct', qvl25_7: HF + 'Qwen/Qwen2.5-VL-7B-Instruct',
  llama31: 'https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/MODEL_CARD.md',
  llama32: 'https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/MODEL_CARD.md',
  gemma3: 'https://ai.google.dev/gemma/docs/core/model_card_3', gemma3n: 'https://ai.google.dev/gemma/docs/gemma-3n/model_card',
  mistral7: HF + 'mistralai/Mistral-7B-Instruct-v0.3', nemo: HF + 'mistralai/Mistral-Nemo-Instruct-2407', msmall: HF + 'mistralai/Mistral-Small-3.2-24B-Instruct-2506',
  phi35: HF + 'microsoft/Phi-3.5-mini-instruct', phi4m: HF + 'microsoft/Phi-4-mini-instruct', phi4: HF + 'microsoft/phi-4',
  r1: HF + 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', smol2: HF + 'HuggingFaceTB/SmolLM2-1.7B-Instruct', smol3: HF + 'HuggingFaceTB/SmolLM3-3B',
  smolvlm: HF + 'HuggingFaceTB/SmolVLM-500M-Instruct', vylinh: HF + 'arcee-ai/Arcee-VyLinh', gptoss: HF + 'openai/gpt-oss-20b',
  glm4: HF + 'zai-org/GLM-4-9B-0414', granite: HF + 'ibm-granite/granite-4.0-h-tiny', graniteM: HF + 'ibm-granite/granite-4.0-h-micro', lfm2: HF + 'LiquidAI/LFM2-1.2B',
  ivl3_2: HF + 'OpenGVLab/InternVL3-2B', ivl3_8: HF + 'OpenGVLab/InternVL3-8B',
  holo3: HF + 'Hcompany/Holo1.5-3B', holo7: HF + 'Hcompany/Holo1.5-7B', venus: HF + 'inclusionAI/UI-Venus-Ground-7B', uitars: HF + 'ByteDance-Seed/UI-TARS-1.5-7B',
};
const v = (t, anchor, note) => ({ t, k: 'v', src: `${VER}#${anchor}`, note });
const x = (t, anchor, note) => ({ t, k: 'x', src: `${VER}#${anchor}`, note });
const d = (t, src, q) => ({ t, k: 'd', src, q });
const QWEN3_LANG = (src) => [d('multilingual', src, 'Support of 100+ languages and dialects'), d('vi', S.qwen3blog, '119 languages and dialects … Vietnamese')];
const QWEN25_LANG = [d('multilingual', S.qwen25, 'Multilingual support for over 29 languages'), d('vi', S.qwen25, 'including Chinese, English, … Vietnamese, Thai, Arabic, and more')];

const CLAIMS = {
  'qwen2.5-0.5b-instruct-q4_k_m': [v('tools', 'v0143-cong-cu', 'Mở được ứng dụng Máy tính (1 lần thử).'), ...QWEN25_LANG],
  'qwen2.5-1.5b-instruct-q4_k_m': [...QWEN25_LANG],
  'qwen2.5-3b-instruct-q4_k_m': [...QWEN25_LANG],
  'qwen2.5-7b-instruct-q4_k_m': [...QWEN25_LANG, d('code', S.qwen25, 'greatly improved capabilities in coding and mathematics')],
  'qwen_qwen3-0.6b-q4_k_m': [d('reasoning', S.qwen3_06, 'thinking mode (for complex logical reasoning, math, and coding)'), ...QWEN3_LANG(S.qwen3_06)],
  'qwen_qwen3-1.7b-q4_k_m': [d('reasoning', S.qwen3_17, 'thinking mode (for complex logical reasoning, math, and coding)'), d('tools', S.qwen3_17, 'tool calling capabilities'), ...QWEN3_LANG(S.qwen3_17)],
  'qwen3-4b-instruct-2507-q4_k_m': [v('tools', 'v0153-agent', 'Đọc/ghi tệp nhiều bước, ghi nhớ, lịch nhắc; tìm và mở đúng liên hệ trên Zalo giả lập (kèm mắt nhìn Qwen3-VL 2B).'),
    v('vi', 'v0153-agent', 'Trả lời và báo cáo bằng tiếng Việt trong mọi bài thử.'), d('multilingual', S.qwen3_4i, 'Substantial gains in long-tail knowledge coverage across multiple languages'), d('long', S.qwen3_4i, 'Context Length: 262,144 natively')],
  'qwen_qwen3-8b-q4_k_m': [d('tools', S.qwen3_8, 'Expertise in agent capabilities, enabling precise integration with external tools'), d('reasoning', S.qwen3_8, 'thinking mode (for complex logical reasoning, math, and coding)'), d('code', S.qwen3_8, 'mathematics, code generation, and commonsense logical reasoning'), ...QWEN3_LANG(S.qwen3_8)],
  'qwen2.5-coder-7b-instruct-q4_k_m': [d('code', S.qwen25c, 'Significantly improvements in code generation, code reasoning and code fixing'), d('long', S.qwen25c, 'Long-context Support up to 128K tokens'), x('tools', 'v0143-cong-cu', 'Không gọi công cụ mở ứng dụng trong bài thử.')],
  'llama-3.2-1b-instruct-q4_k_m': [d('multilingual', S.llama32, 'English, German, French, Italian, Portuguese, Hindi, Spanish, and Thai are officially supported')],
  'llama-3.2-3b-instruct-q4_k_m': [d('multilingual', S.llama32, 'English, German, French, Italian, Portuguese, Hindi, Spanish, and Thai are officially supported'), d('tools', S.llama32, 'Tool Use … BFCL V2')],
  'meta-llama-3.1-8b-instruct-q4_k_m': [d('multilingual', S.llama31, 'English, German, French, Italian, Portuguese, Hindi, Spanish, and Thai'), d('tools', S.llama31, 'Tool Use API-Bank … BFCL'), d('long', S.llama31, 'Multilingual Text and code 128k')],
  'gemma-2-2b-it-q4_k_m': [v('tools', 'v0143-cong-cu', 'Mở được ứng dụng Máy tính qua giao thức công cụ dạng văn bản (1 lần thử).')],
  'google_gemma-3-1b-it-q4_k_m': [v('tools', 'v0143-cong-cu', 'Gọi đúng công cụ mở ứng dụng, nhưng câu trả lời sau đó lạc đề.')],
  'gemma-3-4b-it-q4_k_m': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('tools', 'v0143-nhin-anh', 'Mở được Zalo bằng công cụ; kiểm thử llama-server + mẫu Gemma 3 gọi được công cụ.'),
    x('gui', 'v0143-nhin-anh', 'Chỉ sai vị trí nút Gửi trên ảnh chụp Zalo.'), d('multilingual', S.gemma3, 'multilingual support in over 140 languages'), d('long', S.gemma3, '128K context window')],
  'qwen3-vl-4b-instruct-q4_k_m': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('gui', 'v0143-nhin-anh', 'Chỉ đúng nút Gửi trên ảnh chụp Zalo.'), v('tools', 'v0143-nhin-anh', 'Mở được Zalo bằng công cụ.'),
    d('screen', S.qvl3_4, 'Visual Agent: Operates PC/mobile GUIs—recognizes elements, understands functions, invokes tools, completes tasks')],
  'qwen3-vl-8b-instruct-q4_k_m': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('gui', 'v0143-nhin-anh', 'Chỉ đúng nút Gửi trên ảnh chụp Zalo.'), v('tools', 'v0143-nhin-anh', 'Mở được Zalo bằng công cụ.'),
    d('screen', S.qvl3_8, 'Visual Agent: Operates PC/mobile GUIs—recognizes elements, understands functions, invokes tools, completes tasks')],
  'qwen2.5-vl-3b-instruct-q4_k_m': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('gui', 'v0143-nhin-anh', 'Chỉ đúng nút Gửi trên ảnh chụp Zalo.'), v('tools', 'v0143-nhin-anh', 'Mở được Zalo bằng công cụ.'),
    d('screen', S.qvl25_3, 'capable of computer use and phone use')],
  'holo1.5-3b-q4_k_m': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('tools', 'v0143-nhin-anh', 'Mở được Zalo bằng công cụ.'), d('gui', S.holo3, 'Holo1.5 models excel at user interface (UI) localization')],
  'qwen2.5-vl-7b-instruct-q4_k_m': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('gui', 'v0143-nhin-anh', 'Chỉ đúng nút Gửi trên ảnh chụp Zalo.'), x('tools', 'v0143-nhin-anh', 'Từ chối gọi công cụ mở ứng dụng.'),
    d('screen', S.qvl25_7, 'capable of computer use and phone use')],
  'ui-tars-1.5-7b-q4_k_m': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('gui', 'v0143-nhin-anh', 'Chỉ đúng nút Gửi trên ảnh chụp Zalo.'), x('tools', 'v0143-nhin-anh', 'Không gọi được công cụ mở ứng dụng.'),
    d('screen', S.uitars, 'Computer Use … OSworld')],
  'qwen3-vl-2b-instruct-q8_0': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('tools', 'v0143-nhin-anh', 'Mở được ứng dụng Máy tính bằng công cụ.'),
    v('vi', 'v0153-agent', 'Làm “mắt nhìn” mô tả màn hình Zalo giả lập bằng tiếng Việt trong bài thử tìm và mở liên hệ.'), d('gui', S.qvl3_2, 'Visual Agent: Operates PC/mobile GUIs—recognizes elements')],
  'smolvlm-500m-instruct-q8_0': [d('vision', S.smolvlm, 'image-text-to-text')],
  'google_gemma-3-12b-it-q4_k_m': [d('multilingual', S.gemma3, 'multilingual support in over 140 languages'), d('long', S.gemma3, '128K context window')],
  'mistral-7b-instruct-v0.3-q4_k_m': [d('tools', S.mistral7, 'Supports function calling')],
  'mistral-nemo-instruct-2407-q4_k_m': [d('tools', S.nemo, 'Function calling'), d('multilingual', S.nemo, 'Trained on a large proportion of multilingual and code data'), d('long', S.nemo, '128k context window')],
  'phi-3.5-mini-instruct-q4_k_m': [d('reasoning', S.phi35, 'reasoning dense data'), d('multilingual', S.phi35, 'multilingual'), d('long', S.phi35, '128K token context length')],
  'microsoft_phi-4-mini-instruct-q4_k_m': [d('reasoning', S.phi4m, 'focus on high-quality, reasoning dense data'), d('tools', S.phi4m, 'function calling'), d('multilingual', S.phi4m, 'multilingual')],
  'phi-4-q4_k_m': [d('reasoning', S.phi4, 'data focused on high quality and advanced reasoning'), d('code', S.phi4, 'Code Generation | HumanEval | 82.6')],
  'deepseek-r1-distill-qwen-1.5b-q4_k_m': [d('reasoning', S.r1, 'distilled from DeepSeek-R1 … reasoning')],
  'deepseek-r1-distill-qwen-7b-q4_k_m': [d('reasoning', S.r1, 'distilled from DeepSeek-R1 … reasoning')],
  'smollm2-1.7b-instruct-q4_k_m': [d('tools', S.smol2, 'supports … function calling')],
  'arcee-vylinh.q4_k_m': [d('vi', S.vylinh, 'Vietnamese language understanding and generation')],
  'gpt-oss-20b-mxfp4': [d('tools', S.gptoss, 'Function calling with defined schemas'), d('reasoning', S.gptoss, 'powerful reasoning, agentic tasks'), d('moe', S.gptoss, '21B parameters with 3.6B active parameters')],
  // mới ở 0.16
  'qwen3-4b-thinking-2507-q4_k_m': [d('reasoning', S.qwen3_4t, 'Significantly improved performance on reasoning tasks'), d('tools', S.qwen3_4t, 'tool calling capabilities'), d('long', S.qwen3_4t, 'Context Length: 262,144 natively')],
  'qwen3-14b-q4_k_m': [d('tools', S.qwen3_14, 'Expertise in agent capabilities, enabling precise integration with external tools'), d('reasoning', S.qwen3_14, 'thinking mode (for complex logical reasoning, math, and coding)'), d('code', S.qwen3_14, 'code generation'), ...QWEN3_LANG(S.qwen3_14)],
  'qwen3-30b-a3b-instruct-2507-q4_k_m': [d('tools', S.qwen3_30, 'tool calling capabilities'), d('moe', S.qwen3_30, '30.5B in total and 3.3B activated'), d('long', S.qwen3_30, 'Context Length: 262,144 natively'), d('multilingual', S.qwen3_30, 'long-tail knowledge coverage across multiple languages')],
  'gemma-3n-e2b-it-q4_k_m': [d('multilingual', S.gemma3n, 'trained with data in over 140 spoken languages')],
  'gemma-3n-e4b-it-q4_k_m': [d('multilingual', S.gemma3n, 'trained with data in over 140 spoken languages')],
  'glm-4-9b-0414-q4_k_m': [d('tools', S.glm4, 'function calling'), d('code', S.glm4, 'code generation')],
  'granite-4.0-h-micro-q4_k_m': [d('tools', S.graniteM, 'Granite-4.0-H-Micro comes with enhanced tool calling capabilities'), d('multilingual', S.graniteM, 'English, German, Spanish, French, Japanese, Portuguese, Arabic, Czech, Italian, Korean, Dutch, and Chinese')],
  'granite-4.0-h-tiny-q4_k_m': [d('tools', S.granite, 'Granite-4.0-H-Tiny comes with enhanced tool calling capabilities'), d('multilingual', S.granite, 'English, German, Spanish, French, Japanese, Portuguese, Arabic, Czech, Italian, Korean, Dutch, and Chinese'), d('moe', S.granite, '# Parameters 3B 3B 7B 32B # Active parameters 3B 3B 1B 9B')],
  'smollm3-3b-q4_k_m': [d('tools', S.smol3, 'SmolLM3 supports tool calling'), d('reasoning', S.smol3, 'It supports dual mode reasoning'), d('long', S.smol3, 'long context … up to 128k tokens')],
  'lfm2-1.2b-q4_k_m': [d('tools', S.lfm2, 'Function call: LFM2 writes Pythonic function calls')],
  'mistral-small-3.2-24b-instruct-2506-q4_k_m': [d('vision', S.msmall, 'Vision … MMMU'), d('tools', S.msmall, "Small-3.2's function calling template is more robust")],
  'internvl3-2b-instruct-q4_k_m': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('tools', 'v0143-nhin-anh', 'Mở được Zalo bằng công cụ.'), x('gui', 'v0143-nhin-anh', 'Chỉ sai vị trí nút Gửi trên ảnh chụp Zalo.')],
  'internvl3-8b-instruct-q4_k_m': [v('vision', 'v0143-nhin-anh', 'Đọc đúng chữ và màu trên ảnh thử.'), v('tools', 'v0143-nhin-anh', 'Mở được Zalo bằng công cụ.'), x('gui', 'v0143-nhin-anh', 'Chỉ sai vị trí nút Gửi trên ảnh chụp Zalo.')],
  'holo1.5-7b-q4_k_m': [d('vision', S.holo7, 'image-text-to-text'), d('gui', S.holo7, 'Holo1.5 models excel at user interface (UI) localization')],
  'ui-venus-ground-7b-q4_k_m': [d('vision', S.venus, 'image-text-to-text'), d('gui', S.venus, 'precise GUI element grounding … using only screenshots as input')],
};

// B19 (QA lượt 2): “Đa ngôn ngữ” không được khiến người dùng hiểu là có tiếng Việt khi nhà phát triển không nêu tiếng Việt
function langLabel(c, all) {
  if (c.t !== 'multilingual' || all.some(x => x.t === 'vi' && x.k !== 'x') || /vietnam/i.test(c.q || '')) return TAGS[c.t];
  return (String(c.q || '').match(/,/g) || []).length >= 2 ? 'Đa ngôn ngữ (danh sách chính thức không có tiếng Việt)' : 'Đa ngôn ngữ (không nêu riêng tiếng Việt)';
}
function claimsFor(id) { const all = CLAIMS[id] || []; return all.map(c => ({ ...c, label: langLabel(c, all) || TAGS[c.t] || c.t, kindLabel: KIND[c.k] })); }
module.exports = { CLAIMS, TAGS, KIND, SCREEN_TAGS, claimsFor, VER };
