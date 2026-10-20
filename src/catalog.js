// Danh mục "Gợi ý" do AIVN tự tuyển chọn. Mọi URL đã được kiểm tra bằng HEAD (200) và kích thước khớp API Hugging Face (20/10/2026).
// Không repo nào yêu cầu đăng nhập (gated). Mỗi mô hình tuân theo giấy phép riêng của nhà phát hành.
// Mô hình "Nhìn được ảnh" có thêm tệp mmproj (bộ chiếu thị giác), được tải cùng mô hình.
const CATALOG = [
 {
  "id": "qwen2.5-0.5b-instruct-q4_k_m",
  "name": "Qwen2.5 0.5B Instruct",
  "family": "Qwen",
  "params": "0.5B",
  "quant": "Q4_K_M",
  "repo": "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
  "file": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  "size": 491400032,
  "ram": "≥ 2 GB RAM",
  "url": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
  "license": "Apache 2.0",
  "arch": "qwen2",
  "vision": false,
  "desc": "Siêu nhỏ, chạy được trên hầu hết mọi máy. Phù hợp để thử nghiệm nhanh.",
  "tags": [
   "Siêu nhẹ",
   "Đa ngôn ngữ"
  ]
 },
 {
  "id": "qwen2.5-1.5b-instruct-q4_k_m",
  "name": "Qwen2.5 1.5B Instruct",
  "family": "Qwen",
  "params": "1.5B",
  "quant": "Q4_K_M",
  "repo": "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
  "file": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  "size": 1117320736,
  "ram": "≥ 2 GB RAM",
  "url": "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  "license": "Apache 2.0",
  "arch": "qwen2",
  "vision": false,
  "desc": "Cân bằng tốt giữa tốc độ và chất lượng, trả lời tiếng Việt khá ổn.",
  "tags": [
   "Khuyên dùng",
   "Đa ngôn ngữ"
  ]
 },
 {
  "id": "qwen2.5-3b-instruct-q4_k_m",
  "name": "Qwen2.5 3B Instruct",
  "family": "Qwen",
  "params": "3B",
  "quant": "Q4_K_M",
  "repo": "Qwen/Qwen2.5-3B-Instruct-GGUF",
  "file": "qwen2.5-3b-instruct-q4_k_m.gguf",
  "size": 2104932768,
  "ram": "≥ 3 GB RAM",
  "url": "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
  "license": "Qwen Research (phi thương mại)",
  "arch": "qwen2",
  "vision": false,
  "desc": "Thông minh hơn rõ rệt, tốt cho tóm tắt, viết lách và lập trình cơ bản.",
  "tags": [
   "Đa ngôn ngữ"
  ]
 },
 {
  "id": "qwen2.5-7b-instruct-q4_k_m",
  "name": "Qwen2.5 7B Instruct",
  "family": "Qwen",
  "params": "7B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Qwen2.5-7B-Instruct-GGUF",
  "file": "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
  "size": 4683074240,
  "ram": "≥ 6 GB RAM",
  "url": "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
  "license": "Apache 2.0",
  "arch": "qwen2",
  "vision": false,
  "desc": "Mạnh, đa năng, tiếng Việt tốt. Cần máy có từ 8 GB RAM trở lên.",
  "tags": [
   "Đa ngôn ngữ",
   "Mạnh"
  ]
 },
 {
  "id": "qwen_qwen3-0.6b-q4_k_m",
  "name": "Qwen3 0.6B",
  "family": "Qwen",
  "params": "0.6B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Qwen_Qwen3-0.6B-GGUF",
  "file": "Qwen_Qwen3-0.6B-Q4_K_M.gguf",
  "size": 484220320,
  "ram": "≥ 2 GB RAM",
  "url": "https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf",
  "license": "Apache 2.0",
  "arch": "qwen3",
  "vision": false,
  "desc": "Thế hệ Qwen3 siêu nhỏ, có chế độ suy nghĩ (thinking) trước khi trả lời.",
  "tags": [
   "Siêu nhẹ",
   "Suy luận"
  ]
 },
 {
  "id": "qwen_qwen3-1.7b-q4_k_m",
  "name": "Qwen3 1.7B",
  "family": "Qwen",
  "params": "1.7B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Qwen_Qwen3-1.7B-GGUF",
  "file": "Qwen_Qwen3-1.7B-Q4_K_M.gguf",
  "size": 1282439584,
  "ram": "≥ 3 GB RAM",
  "url": "https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf",
  "license": "Apache 2.0",
  "arch": "qwen3",
  "vision": false,
  "desc": "Nhỏ gọn nhưng suy luận tốt, hợp với laptop phổ thông.",
  "tags": [
   "Suy luận"
  ]
 },
 {
  "id": "qwen3-4b-instruct-2507-q4_k_m",
  "name": "Qwen3 4B Instruct 2507",
  "family": "Qwen",
  "params": "4B",
  "quant": "Q4_K_M",
  "repo": "unsloth/Qwen3-4B-Instruct-2507-GGUF",
  "file": "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  "size": 2497281120,
  "ram": "≥ 4 GB RAM",
  "url": "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  "license": "Apache 2.0",
  "arch": "qwen3",
  "vision": false,
  "desc": "Bản Qwen3 4B trả lời trực tiếp (không thinking), nhanh và chất lượng cao.",
  "tags": [
   "Khuyên dùng",
   "Đa ngôn ngữ"
  ]
 },
 {
  "id": "qwen_qwen3-8b-q4_k_m",
  "name": "Qwen3 8B",
  "family": "Qwen",
  "params": "8B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Qwen_Qwen3-8B-GGUF",
  "file": "Qwen_Qwen3-8B-Q4_K_M.gguf",
  "size": 5027784224,
  "ram": "≥ 8 GB RAM",
  "url": "https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q4_K_M.gguf",
  "license": "Apache 2.0",
  "arch": "qwen3",
  "vision": false,
  "desc": "Qwen3 cỡ vừa, suy luận và lập trình mạnh. Cần từ 8 GB RAM.",
  "tags": [
   "Suy luận",
   "Lập trình"
  ]
 },
 {
  "id": "qwen2.5-coder-7b-instruct-q4_k_m",
  "name": "Qwen2.5 Coder 7B Instruct",
  "family": "Qwen",
  "params": "7B",
  "quant": "Q4_K_M",
  "repo": "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
  "file": "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
  "size": 4683073536,
  "ram": "≥ 6 GB RAM",
  "url": "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
  "license": "Apache 2.0",
  "arch": "qwen2",
  "vision": false,
  "desc": "Chuyên viết, giải thích và sửa mã nguồn.",
  "tags": [
   "Lập trình"
  ]
 },
 {
  "id": "llama-3.2-1b-instruct-q4_k_m",
  "name": "Llama 3.2 1B Instruct",
  "family": "Llama",
  "params": "1B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Llama-3.2-1B-Instruct-GGUF",
  "file": "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
  "size": 807694464,
  "ram": "≥ 2 GB RAM",
  "url": "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
  "license": "Llama 3.2 Community",
  "arch": "llama",
  "vision": false,
  "desc": "Nhỏ gọn, phản hồi nhanh. Mạnh nhất với tiếng Anh.",
  "tags": [
   "Nhanh"
  ]
 },
 {
  "id": "llama-3.2-3b-instruct-q4_k_m",
  "name": "Llama 3.2 3B Instruct",
  "family": "Llama",
  "params": "3B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Llama-3.2-3B-Instruct-GGUF",
  "file": "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  "size": 2019377696,
  "ram": "≥ 3 GB RAM",
  "url": "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  "license": "Llama 3.2 Community",
  "arch": "llama",
  "vision": false,
  "desc": "Đa năng, ngữ cảnh dài, phù hợp làm trợ lý hằng ngày.",
  "tags": [
   "Đa năng"
  ]
 },
 {
  "id": "meta-llama-3.1-8b-instruct-q4_k_m",
  "name": "Llama 3.1 8B Instruct",
  "family": "Llama",
  "params": "8B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
  "file": "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
  "size": 4920739232,
  "ram": "≥ 8 GB RAM",
  "url": "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
  "license": "Llama 3.1 Community",
  "arch": "llama",
  "vision": false,
  "desc": "Mô hình 8B phổ biến, cân bằng giữa chất lượng và tốc độ.",
  "tags": [
   "Đa năng"
  ]
 },
 {
  "id": "gemma-2-2b-it-q4_k_m",
  "name": "Gemma 2 2B it",
  "family": "Gemma",
  "params": "2B",
  "quant": "Q4_K_M",
  "repo": "bartowski/gemma-2-2b-it-GGUF",
  "file": "gemma-2-2b-it-Q4_K_M.gguf",
  "size": 1708582752,
  "ram": "≥ 3 GB RAM",
  "url": "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf",
  "license": "Gemma",
  "arch": "gemma2",
  "vision": false,
  "desc": "Văn phong tự nhiên, gọn nhẹ, chạy tốt trên laptop không có card rời.",
  "tags": [
   "Gọn nhẹ"
  ]
 },
 {
  "id": "google_gemma-3-1b-it-q4_k_m",
  "name": "Gemma 3 1B it",
  "family": "Gemma",
  "params": "1B",
  "quant": "Q4_K_M",
  "repo": "bartowski/google_gemma-3-1b-it-GGUF",
  "file": "google_gemma-3-1b-it-Q4_K_M.gguf",
  "size": 806058496,
  "ram": "≥ 2 GB RAM",
  "url": "https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/google_gemma-3-1b-it-Q4_K_M.gguf",
  "license": "Gemma",
  "arch": "gemma3",
  "vision": false,
  "desc": "Gemma thế hệ 3 bản siêu nhẹ, nhanh trên mọi máy.",
  "tags": [
   "Siêu nhẹ"
  ]
 },
 {
  "id": "gemma-3-4b-it-q4_k_m",
  "name": "Gemma 3 4B it (nhìn ảnh)",
  "family": "Gemma",
  "params": "4B",
  "quant": "Q4_K_M",
  "repo": "ggml-org/gemma-3-4b-it-GGUF",
  "file": "gemma-3-4b-it-Q4_K_M.gguf",
  "size": 2489757856,
  "mmproj": {
   "file": "mmproj-model-f16.gguf",
   "size": 851251104,
   "url": "https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/mmproj-model-f16.gguf"
  },
  "ram": "≥ 6 GB RAM",
  "license": "Gemma",
  "arch": "gemma3",
  "desc": "Đa ngôn ngữ tốt, đọc và mô tả ảnh. Bản chính thức của ggml-org kèm tệp thị giác (mmproj).",
  "tags": [
   "Nhìn được ảnh",
   "Đa ngôn ngữ"
  ],
  "url": "https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf",
  "vision": true
 },
 {
  "id": "qwen2.5-vl-3b-instruct-q4_k_m",
  "name": "Qwen2.5-VL 3B Instruct",
  "family": "Qwen",
  "params": "3B",
  "quant": "Q4_K_M",
  "repo": "ggml-org/Qwen2.5-VL-3B-Instruct-GGUF",
  "file": "Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
  "size": 1929901056,
  "mmproj": {
   "file": "mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf",
   "size": 844757728,
   "url": "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf"
  },
  "ram": "≥ 5 GB RAM",
  "license": "Qwen Research (phi thương mại)",
  "arch": "qwen2vl",
  "desc": "Hiểu ảnh, đọc chữ trong ảnh và tài liệu chụp tốt, trả lời tiếng Việt khá.",
  "tags": [
   "Nhìn được ảnh",
   "Đọc tài liệu"
  ],
  "url": "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
  "vision": true
 },
 {
  "id": "qwen3-vl-2b-instruct-q8_0",
  "name": "Qwen3-VL 2B Instruct",
  "family": "Qwen",
  "params": "2B",
  "quant": "Q8_0",
  "repo": "ggml-org/Qwen3-VL-2B-Instruct-GGUF",
  "file": "Qwen3-VL-2B-Instruct-Q8_0.gguf",
  "size": 1834427296,
  "mmproj": {
   "file": "mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf",
   "size": 445053056,
   "url": "https://huggingface.co/ggml-org/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf"
  },
  "ram": "≥ 4 GB RAM",
  "license": "Apache 2.0",
  "arch": "qwen3vl",
  "desc": "Mô hình nhìn ảnh thế hệ Qwen3, nhỏ gọn, mô tả ảnh bằng tiếng Việt tốt.",
  "tags": [
   "Nhìn được ảnh",
   "Khuyên dùng"
  ],
  "url": "https://huggingface.co/ggml-org/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3-VL-2B-Instruct-Q8_0.gguf",
  "vision": true
 },
 {
  "id": "smolvlm-500m-instruct-q8_0",
  "name": "SmolVLM 500M Instruct",
  "family": "SmolLM",
  "params": "0.5B",
  "quant": "Q8_0",
  "repo": "ggml-org/SmolVLM-500M-Instruct-GGUF",
  "file": "SmolVLM-500M-Instruct-Q8_0.gguf",
  "size": 436806912,
  "mmproj": {
   "file": "mmproj-SmolVLM-500M-Instruct-Q8_0.gguf",
   "size": 108783360,
   "url": "https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"
  },
  "ram": "≥ 2 GB RAM",
  "license": "Apache 2.0",
  "arch": "llama",
  "desc": "Siêu nhẹ, mô tả ảnh nhanh, chủ yếu bằng tiếng Anh.",
  "tags": [
   "Nhìn được ảnh",
   "Siêu nhẹ"
  ],
  "url": "https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf",
  "vision": true
 },
 {
  "id": "google_gemma-3-12b-it-q4_k_m",
  "name": "Gemma 3 12B it",
  "family": "Gemma",
  "params": "12B",
  "quant": "Q4_K_M",
  "repo": "bartowski/google_gemma-3-12b-it-GGUF",
  "file": "google_gemma-3-12b-it-Q4_K_M.gguf",
  "size": 7300575264,
  "ram": "≥ 12 GB RAM",
  "url": "https://huggingface.co/bartowski/google_gemma-3-12b-it-GGUF/resolve/main/google_gemma-3-12b-it-Q4_K_M.gguf",
  "license": "Gemma",
  "arch": "gemma3",
  "vision": false,
  "desc": "Chất lượng cao, cần máy mạnh (từ 16 GB RAM). Chưa hỗ trợ đầu vào ảnh.",
  "tags": [
   "Mạnh"
  ],
  "visionNote": "Mô hình gốc nhìn được ảnh, nhưng bản này không kèm mmproj trong danh mục: AIVN dùng phần văn bản."
 },
 {
  "id": "mistral-7b-instruct-v0.3-q4_k_m",
  "name": "Mistral 7B Instruct v0.3",
  "family": "Mistral",
  "params": "7B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Mistral-7B-Instruct-v0.3-GGUF",
  "file": "Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
  "size": 4372812000,
  "ram": "≥ 6 GB RAM",
  "url": "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
  "license": "Apache 2.0",
  "arch": "llama",
  "vision": false,
  "desc": "Mô hình 7B kinh điển của Mistral AI, mạnh với tiếng Anh và châu Âu.",
  "tags": [
   "Đa năng"
  ]
 },
 {
  "id": "mistral-nemo-instruct-2407-q4_k_m",
  "name": "Mistral Nemo Instruct 12B",
  "family": "Mistral",
  "params": "12B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Mistral-Nemo-Instruct-2407-GGUF",
  "file": "Mistral-Nemo-Instruct-2407-Q4_K_M.gguf",
  "size": 7477208192,
  "ram": "≥ 12 GB RAM",
  "url": "https://huggingface.co/bartowski/Mistral-Nemo-Instruct-2407-GGUF/resolve/main/Mistral-Nemo-Instruct-2407-Q4_K_M.gguf",
  "license": "Apache 2.0",
  "arch": "llama",
  "vision": false,
  "desc": "12B đa ngôn ngữ, ngữ cảnh 128K. Cần từ 16 GB RAM.",
  "tags": [
   "Mạnh",
   "Đa ngôn ngữ"
  ]
 },
 {
  "id": "phi-3.5-mini-instruct-q4_k_m",
  "name": "Phi-3.5 mini Instruct",
  "family": "Phi",
  "params": "3.8B",
  "quant": "Q4_K_M",
  "repo": "bartowski/Phi-3.5-mini-instruct-GGUF",
  "file": "Phi-3.5-mini-instruct-Q4_K_M.gguf",
  "size": 2393232672,
  "ram": "≥ 4 GB RAM",
  "url": "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
  "license": "MIT",
  "arch": "phi3",
  "vision": false,
  "desc": "Mô hình nhỏ của Microsoft, giỏi suy luận và toán.",
  "tags": [
   "Suy luận"
  ]
 },
 {
  "id": "microsoft_phi-4-mini-instruct-q4_k_m",
  "name": "Phi-4 mini Instruct",
  "family": "Phi",
  "params": "3.8B",
  "quant": "Q4_K_M",
  "repo": "bartowski/microsoft_Phi-4-mini-instruct-GGUF",
  "file": "microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
  "size": 2491874688,
  "ram": "≥ 4 GB RAM",
  "url": "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
  "license": "MIT",
  "arch": "phi3",
  "vision": false,
  "desc": "Phi thế hệ 4 bản nhỏ, đa ngôn ngữ tốt hơn Phi-3.5.",
  "tags": [
   "Suy luận"
  ]
 },
 {
  "id": "phi-4-q4_k_m",
  "name": "Phi-4 14B",
  "family": "Phi",
  "params": "14B",
  "quant": "Q4_K_M",
  "repo": "bartowski/phi-4-GGUF",
  "file": "phi-4-Q4_K_M.gguf",
  "size": 9053114816,
  "ram": "≥ 12 GB RAM",
  "url": "https://huggingface.co/bartowski/phi-4-GGUF/resolve/main/phi-4-Q4_K_M.gguf",
  "license": "MIT",
  "arch": "phi3",
  "vision": false,
  "desc": "Phi-4 đầy đủ 14B, suy luận và toán rất mạnh. Cần từ 16 GB RAM.",
  "tags": [
   "Mạnh",
   "Suy luận"
  ]
 },
 {
  "id": "deepseek-r1-distill-qwen-1.5b-q4_k_m",
  "name": "DeepSeek R1 Distill Qwen 1.5B",
  "family": "DeepSeek",
  "params": "1.5B",
  "quant": "Q4_K_M",
  "repo": "bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF",
  "file": "DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
  "size": 1117320800,
  "ram": "≥ 2 GB RAM",
  "url": "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
  "license": "MIT",
  "arch": "qwen2",
  "vision": false,
  "desc": "Học từ DeepSeek-R1: suy nghĩ từng bước trước khi trả lời.",
  "tags": [
   "Suy luận"
  ]
 },
 {
  "id": "deepseek-r1-distill-qwen-7b-q4_k_m",
  "name": "DeepSeek R1 Distill Qwen 7B",
  "family": "DeepSeek",
  "params": "7B",
  "quant": "Q4_K_M",
  "repo": "bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF",
  "file": "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
  "size": 4683073504,
  "ram": "≥ 6 GB RAM",
  "url": "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
  "license": "MIT",
  "arch": "qwen2",
  "vision": false,
  "desc": "Suy luận nhiều bước mạnh hơn, hợp cho toán và lập trình.",
  "tags": [
   "Suy luận",
   "Lập trình"
  ]
 },
 {
  "id": "smollm2-1.7b-instruct-q4_k_m",
  "name": "SmolLM2 1.7B Instruct",
  "family": "SmolLM",
  "params": "1.7B",
  "quant": "Q4_K_M",
  "repo": "bartowski/SmolLM2-1.7B-Instruct-GGUF",
  "file": "SmolLM2-1.7B-Instruct-Q4_K_M.gguf",
  "size": 1055609824,
  "ram": "≥ 2 GB RAM",
  "url": "https://huggingface.co/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf",
  "license": "Apache 2.0",
  "arch": "llama",
  "vision": false,
  "desc": "Mô hình nhỏ của Hugging Face, nhanh, chủ yếu tiếng Anh.",
  "tags": [
   "Nhanh"
  ]
 },
 {
  "id": "arcee-vylinh.q4_k_m",
  "name": "Arcee VyLinh 3B (tiếng Việt)",
  "family": "VyLinh",
  "params": "3B",
  "quant": "Q4_K_M",
  "repo": "mradermacher/Arcee-VyLinh-GGUF",
  "file": "Arcee-VyLinh.Q4_K_M.gguf",
  "size": 2104933824,
  "ram": "≥ 3 GB RAM",
  "url": "https://huggingface.co/mradermacher/Arcee-VyLinh-GGUF/resolve/main/Arcee-VyLinh.Q4_K_M.gguf",
  "license": "Apache 2.0",
  "arch": "qwen2",
  "vision": false,
  "desc": "Mô hình 3B tinh chỉnh riêng cho tiếng Việt (Arcee AI, nền Qwen2.5).",
  "tags": [
   "Tiếng Việt"
  ]
 },
 {
  "id": "gpt-oss-20b-mxfp4",
  "name": "gpt-oss 20B",
  "family": "GPT-OSS",
  "params": "20B (MoE)",
  "quant": "MXFP4",
  "repo": "ggml-org/gpt-oss-20b-GGUF",
  "file": "gpt-oss-20b-MXFP4.gguf",
  "size": 12109566624,
  "ram": "≥ 16 GB RAM",
  "url": "https://huggingface.co/ggml-org/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-MXFP4.gguf",
  "license": "Apache 2.0",
  "arch": "gpt-oss",
  "vision": false,
  "desc": "Mô hình mở của OpenAI (MoE), suy luận mạnh. Cần từ 16 GB RAM.",
  "tags": [
   "Mạnh",
   "Suy luận"
  ]
 }
];

// Mô hình nhúng cho hỏi đáp tài liệu (RAG): tải khi dùng lần đầu
const EMBEDDING = {
 "id": "bge-m3-q8_0",
 "name": "BGE-M3 (tìm kiếm ngữ nghĩa)",
 "repo": "ggml-org/bge-m3-Q8_0-GGUF",
 "file": "bge-m3-q8_0.gguf",
 "size": 634553760,
 "url": "https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF/resolve/main/bge-m3-q8_0.gguf",
 "license": "MIT",
 "dims": 1024,
 "prefix": null
};

module.exports = CATALOG;
module.exports.CATALOG = CATALOG;
module.exports.EMBEDDING = EMBEDDING;
