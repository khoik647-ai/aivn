# AIVN – Ứng dụng chạy mô hình AI cục bộ

Phát triển bởi **NGUYỄN NGỌC KHÔI SINH VIÊN VLU** · © 2026 AIVN

Electron + node-llama-cpp (llama.cpp, MIT) + llama-server chính thức của llama.cpp (MIT, cho mô hình nhìn ảnh). Giao diện tiếng Việt.

## Chức năng
- **Giao diện**: logo rồng AIVN; chủ đề sáng đỏ–trắng mặc định, có chế độ Tối và Tự động (theo hệ điều hành) ở góc dưới thanh bên. Màu chữ/nút đạt tương phản WCAG AA. Đổi chế độ mượt: hiệu ứng vòng tròn lan ra từ nút bấm (View Transitions API), nếu không hỗ trợ thì chuyển màu 350 ms chỉ trong lúc đổi; bật "giảm chuyển động" trong hệ điều hành thì đổi ngay. Giao diện đã lưu được áp dụng trước lần vẽ đầu tiên (`theme-init.js` + `additionalArguments`), không nháy màu khi mở.
- **Trò chuyện**: trả lời theo luồng (streaming), nút Dừng, lịch sử lưu cục bộ, lời nhắc hệ thống, nhiệt độ, số token tối đa, độ dài ngữ cảnh.
- **Gửi kèm tài liệu** (nút ghim hoặc kéo thả vào khung chat): PDF có lớp chữ (pdfjs-dist), DOCX (mammoth), TXT/MD/CSV/JSON và tệp mã nguồn. Tối đa 20 MB/tệp, 5 tệp/lần. PDF scan chưa hỗ trợ. Mọi thứ xử lý cục bộ.
- **Hỏi đáp tài liệu dài (RAG)** (`src/rag.js`): khi đã tải mô hình nhúng **BGE-M3** (`ggml-org/bge-m3-Q8_0-GGUF`, 605 MB, MIT; nút trong *Cài đặt trò chuyện → Tìm kiếm trong tài liệu*, hoặc lời mời khi gửi tài liệu lần đầu), tài liệu được chia đoạn ~500 token (gối đầu ~80 token, cắt theo câu/đoạn văn, nhớ số trang PDF), nhúng trên máy (CPU) và lưu chỉ mục vector riêng cho từng cuộc trò chuyện tại `userData/rag/<id>.json` (tài liệu trùng nội dung được dùng lại). Mỗi câu hỏi lấy các đoạn gần nhất (cosine + một chút điểm từ khoá cho tên riêng/con số, tối đa 6 đoạn vừa ngân sách ngữ cảnh) và hiện **Trích từ: tệp, đoạn n · trang p** dưới câu trả lời; hỏi tiếp không cần gửi lại tệp. Chưa có BGE-M3 hoặc tắt tuỳ chọn thì dùng cách cũ: đưa tài liệu vào lời nhắc giữa `<<<TÀI LIỆU: tên>>>` … `<<<HẾT TÀI LIỆU>>>`, dài quá thì giữ phần mở đầu + đoạn khớp từ khoá và cảnh báo. Xoá cuộc trò chuyện thì xoá luôn chỉ mục.
- **Ảnh và nhìn ảnh**: dán ảnh bằng Ctrl+V / Cmd+V hoặc kéo thả PNG/JPG/WEBP/GIF/BMP. Nếu mô hình đang nạp **nhìn được ảnh** (có tệp `mmproj*.gguf` cạnh tệp mô hình), ảnh (thu về cạnh dài ≤ 1024 px) được gửi thẳng cho mô hình qua llama-server chính thức của llama.cpp (bản b11751, đi kèm trong `resources/llama`, tải bằng `node build/fetch-llama.cjs`, kiểm SHA-256) và ghi chú "Mô hình nhìn ảnh trực tiếp"; ảnh gần nhất được gửi lại khi hỏi tiếp trong phiên. Nếu mô hình chỉ có chữ, AIVN đọc chữ trong ảnh bằng OCR cục bộ (tesseract.js, tiếng Việt + tiếng Anh) và ghi chú "Mô hình hiện tại không nhìn được ảnh, AIVN đã đọc chữ trong ảnh". Windows: llama-server cần Microsoft Visual C++ Redistributable 2015–2022 (x64); AIVN không đóng gói thư viện của Microsoft mà báo lỗi rõ và mở trang tải chính thức `https://aka.ms/vs/17/release/vc_redist.x64.exe`.
- **Trợ lý** (`src/agent/`, viết riêng cho AIVN, chạy hoàn toàn bằng mô hình đang nạp): vòng lặp gọi công cụ của node-llama-cpp (function calling, ràng buộc JSON bằng ngữ pháp; đã thử với Qwen3 4B Instruct 2507), tối đa 8 vòng / 16 lần gọi mỗi lượt, nhiệt độ 0,2. Công cụ:
  - Máy tính (`calc.js`, tự phân tích biểu thức, không dùng `eval`: + − × ÷ %, luỹ thừa, giai thừa, căn, làm tròn, trung bình, tổng, log, π, e; nhận dấu phẩy thập phân kiểu Việt) và ngày giờ.
  - Tệp: liệt kê, đọc (PDF/DOCX qua bộ trích xuất sẵn có; CSV/TSV kèm thống kê chính xác: tổng, trung bình, tổng theo nhóm), ghi/tạo/nối thêm (chỉ tệp văn bản), xoá. **Chỉ trong các thư mục bạn thêm** ở *Cài đặt Trợ lý* (kiểm tra bằng realpath, chặn `..`, đường dẫn tuyệt đối và liên kết tượng trưng trỏ ra ngoài). **Xoá và ghi đè luôn hỏi** bằng hộp thoại tiếng Việt (không trả lời trong 5 phút = từ chối); xoá là chuyển vào Thùng rác, không xoá vĩnh viễn.
  - Web (chỉ khi bật **Cho phép truy cập mạng**, mặc định tắt): tìm qua trang HTML công khai của DuckDuckGo, dự phòng API Wikipedia (vi/en); đọc chữ của trang (tối đa 3 MB, 15 giây). Chặn localhost/LAN/link-local ở mọi lần chuyển hướng. Mọi địa chỉ đã mở hiện dưới câu trả lời.
  - JavaScript trong hộp cát (`sandbox.js`: Worker + `vm`, không `require`/`process`/mạng/tệp, cấm sinh mã từ chuỗi, 64 MB, 3 giây; có thể nạp nội dung một tệp được phép vào biến `INPUT`). Python (tuỳ chọn, chỉ khi máy có Python 3): chạy `-I` trong thư mục tạm, hook kiểm toán chặn socket/tiến trình con/ctypes và tệp ngoài thư mục tạm, 10 giây (hạn chế ở mức hợp lý, không cách ly tuyệt đối như JavaScript).
  - Ghi nhớ và tạo lời nhắc (xem dưới).
  Mỗi bước hiện thành thẻ thu gọn (công cụ, đầu vào, kết quả, thời gian); có nút Dừng. Nếu mô hình nói "đã ghi/đã xoá" mà công cụ chưa chạy, AIVN nhắc mô hình kiểm tra lại một lần. Mô hình dưới ~3,5 tỉ tham số bị cảnh báo là quá nhỏ (gợi ý Qwen3 4B/8B, Gemma 3 4B trở lên; 9 mô hình trong Kho có nhãn **Hợp cho Trợ lý**).
- **Ghi nhớ** (`memory.js`, `userData/memory.json`): Trợ lý lưu điều bạn muốn nó nhớ (từ chối lưu mật khẩu, số thẻ…); trang *Ghi nhớ* để xem, thêm, sửa, xoá, tắt. Mỗi lượt, điều liên quan được đưa vào lời nhắc hệ thống: theo ý nghĩa bằng BGE-M3 nếu đã tải, nếu không thì theo từ khoá (≤ 8 điều thì đưa tất cả).
- **Lịch tự động** (`scheduler.js`, `userData/schedules.json`): lời nhắc hoặc việc cho Trợ lý, một lần / hằng ngày / hằng tuần (chọn thứ). Chạy khi AIVN đang mở; tuỳ chọn *thu xuống khay khi đóng cửa sổ* và *mở cùng máy tính* (Windows/macOS: login item; Linux: `~/.config/autostart/aivn.desktop`, chỉ bản đóng gói). Lần bị lỡ trong 6 giờ được chạy bù. Kết quả hiện bằng thông báo của hệ điều hành và lưu thành cuộc trò chuyện trong Trợ lý; việc chạy theo lịch không được xoá/ghi đè tệp (không có ai để hỏi).
- **Tự động cập nhật** (electron-updater, GitHub Releases `OWNER/aivn`): kiểm tra khi mở và bằng nút *Kiểm tra cập nhật* trong mục Giới thiệu. Windows: Tải về → Khởi động lại để cập nhật (bản chưa ký, `verifyUpdateCodeSignature: false`). macOS: chỉ báo có bản mới và mở trang Releases (Squirrel.Mac cần chữ ký Apple Developer ID).
- **Khám phá** (như mục Discover của LM Studio): tìm mọi kho GGUF công khai trên Hugging Face (API công khai; sắp xếp theo lượt tải / mới nhất / lượt thích), xem danh sách tệp .gguf kèm dung lượng, gộp tệp chia nhỏ `-0000k-of-0000N`, nhãn RAM (Vừa máy / Có thể chậm / Quá lớn), gợi ý Q4_K_M, nhãn **Nhìn được ảnh** khi repo có tệp mmproj (tải kèm bản Q8_0/F16 phù hợp nhất cùng mô hình; mô hình đã tải trước đó có nút tải bổ sung), đánh dấu embedding và kiến trúc chưa hỗ trợ. 29 gợi ý đã kiểm tra, trong đó 4 mô hình nhìn ảnh: Qwen3-VL 2B, Qwen2.5-VL 3B, Gemma 3 4B (ggml-org), SmolVLM 500M (Qwen2.5/Qwen3, Gemma 2/3, Llama 3.x, Phi-3.5/4, Mistral, DeepSeek R1 Distill, SmolLM2, VyLinh, gpt-oss). Tải có hàng đợi (2 tệp cùng lúc), tạm dừng/tải tiếp (HTTP Range), tốc độ và thời gian còn lại; mã truy cập Hugging Face (tuỳ chọn) chỉ lưu trên máy, không ghi log. Nhập tệp GGUF có sẵn.
- **Sao chép/dán**: menu Sửa (bắt buộc trên macOS để Cmd+C/Cmd+V hoạt động), menu chuột phải Cắt/Sao chép/Dán/Chọn tất cả, nút Sao chép câu trả lời.
- **Bộ máy suy luận**: node-llama-cpp chạy trong tiến trình Node.js thuần đi kèm (`resources/node`, tải bằng `node build/fetch-node.cjs`), vì bộ cấp phát của Electron làm sập tiến trình khi cấp phát > 2 GB (mô hình 7B chạy CPU). Mô hình nhìn ảnh chạy bằng `llama-server` (tiến trình con, chỉ nghe 127.0.0.1, khoá API ngẫu nhiên mỗi lần nạp, tắt cùng ứng dụng); mô hình nhúng BGE-M3 chạy CPU trong cùng tiến trình engine.
- **Mô hình của tôi**: nạp / gỡ khỏi bộ nhớ / xoá / mở thư mục.
- **Máy chủ API**: tương thích OpenAI tại http://localhost:1234 (`GET /v1/models`, `POST /v1/chat/completions` có `stream: true` và ảnh `image_url` cho mô hình nhìn ảnh, `POST /v1/embeddings` với `input` chuỗi/mảng, `encoding_format` float/base64, `dimensions`). `/v1/chat/completions` nhận `tools` + `tool_choice` (`auto`, `none`, `required`, hoặc tên hàm) và trả `tool_calls` / `finish_reason: "tool_calls"` (cả khi stream), nhận tin nhắn `role: "tool"`; `response_format` `json_schema` hoặc `json_object` ràng buộc đầu ra bằng ngữ pháp (hỗ trợ tập con JSON Schema: object, array, string/number/integer/boolean, enum, const, anyOf/oneOf). Nếu gửi `model` là một mô hình chưa nạp nhưng có trên máy, ứng dụng sẽ tự nạp.

```bash
curl http://localhost:1234/v1/embeddings -H "Content-Type: application/json" \
  -d '{"model": "bge-m3-q8_0", "input": ["Xin chào", "Hà Nội"]}'

curl http://localhost:1234/v1/chat/completions -H "Content-Type: application/json" -d '{
  "messages": [{"role": "user", "content": "Thời tiết ở Đà Nẵng thế nào?"}],
  "tools": [{"type": "function", "function": {"name": "get_weather", "description": "Thời tiết hiện tại",
    "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}]}'
# → finish_reason "tool_calls", get_weather {"city":"Đà Nẵng"}; gửi lại kết quả bằng {"role":"tool","tool_call_id":…,"content":…}
```

Dữ liệu được lưu trong thư mục userData (Windows: `%APPDATA%\AIVN`): `models\`, `rag\` (chỉ mục tài liệu), `settings.json`, `conversations.json`, `memory.json` (Ghi nhớ), `schedules.json` (Lịch tự động).

## Phát triển
```bash
npm install --force          # --force để cài cả gói prebuilt @node-llama-cpp/win-x64* trên Linux
node node_modules/electron/install.js   # nếu npm chặn script cài đặt của electron
npm start
npm run dist:win     # NSIS + portable (cần wine để ghi icon/metadata vào exe)
npm run dist:linux   # AppImage
npm run dist:mac     # macOS arm64 + x64 (.zip, chạy được trên Linux)
node --test test/    # kiểm thử trích xuất PDF/DOCX/TXT, OCR, Hugging Face, RAG, /v1/embeddings, Trợ lý (máy tính, hộp cát, thư mục được phép, lịch, ghi nhớ, SSRF)
```

## Phát hành (GitHub)
```bash
gh auth login
./release.sh <github-owner>          # đặt owner, build Windows NSIS + macOS arm64/x64, tạo repo <owner>/aivn (public),
                                     # release v<version> (+ latest.yml, latest-mac.yml, blockmap) và GitHub Pages
DRY_RUN=1 ./release.sh <owner>       # chỉ build + chuẩn bị dist/release và dist/site, không gọi GitHub
```
Nút tải trên trang web trỏ tới `https://github.com/<owner>/aivn/releases/latest/download/AIVN-Setup.exe`, `AIVN-mac-arm64.zip`, `AIVN-mac-x64.zip`. Mã nguồn trang web: `site/index.html`.

Biến môi trường dùng khi kiểm thử: `AIVN_USER_DATA`, `AIVN_API=1` (bật API khi mở), `AIVN_LOAD=<id mô hình>`, `AIVN_SHOT=<file.png>` (chụp cửa sổ), `AIVN_TEST=1`, `AIVN_SELFTEST_DOC=<tệp>` + `AIVN_SELFTEST_Q=<câu hỏi>` + `AIVN_SELFTEST_OUT=<json>` (tự hỏi đáp tài liệu rồi thoát), `AIVN_SELFTEST_V12=1` + `AIVN_VISION_MODEL` / `AIVN_TEXT_MODEL` / `AIVN_TEST_IMAGE` / `AIVN_TEST_DOC` / `AIVN_API_TEST=1` / `AIVN_SHOTS=<thư mục>` (tự kiểm thử nhìn ảnh, RAG, /v1/embeddings, Khám phá, đổi giao diện), `AIVN_SELFTEST_V13=1` + `AIVN_AGENT_MODEL` / `AIVN_SMALL_MODEL` / `AIVN_AGENT_DIR` / `AIVN_V13_ONLY=<giai đoạn,…>` (tự kiểm thử Trợ lý, Ghi nhớ, Lịch tự động, API công cụ), `AIVN_LLAMA_SERVER=<đường dẫn llama-server>`, `AIVN_SELFTEST_UPDATE=1`, `AIVN_UPDATE_CHECK=1`, `AIVN_UPDATE_URL=<feed generic>`, `AIVN_UPDATE_DELAY=<ms>`.

## Giấy phép bên thứ ba
- llama.cpp / llama-server (MIT): `resources/llama/LICENSE-llama.cpp.txt` trong bản cài.
- node-llama-cpp (MIT), Electron (MIT), Node.js (MIT, `resources/node/LICENSE`), tesseract.js (Apache 2.0), pdfjs-dist (Apache 2.0), mammoth (BSD-2).
- Trợ lý chỉ vào mạng khi được bật: trang HTML công khai của DuckDuckGo (không liên kết với AIVN) và API công khai của Wikipedia (nội dung CC BY-SA). Phần Trợ lý, Ghi nhớ, Lịch tự động không dùng thêm thư viện bên ngoài (chỉ Node.js/Electron).
- Mô hình không đi kèm ứng dụng; mỗi mô hình tải từ Hugging Face tuân theo giấy phép riêng (BGE-M3: MIT).
