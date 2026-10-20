# AIVN – Ứng dụng chạy mô hình AI cục bộ

Phát triển bởi **NGUYỄN NGỌC KHÔI SINH VIÊN VLU** · © 2026 AIVN

Electron + node-llama-cpp (llama.cpp, MIT) + llama-server chính thức của llama.cpp (MIT, cho mô hình nhìn ảnh). Giao diện tiếng Việt.

## Chức năng
- **Giao diện**: logo rồng AIVN; chủ đề sáng đỏ–trắng mặc định, có chế độ Tối và Tự động (theo hệ điều hành) ở góc dưới thanh bên. Màu chữ/nút đạt tương phản WCAG AA. Đổi chế độ mượt: hiệu ứng vòng tròn lan ra từ nút bấm (View Transitions API), nếu không hỗ trợ thì chuyển màu 350 ms chỉ trong lúc đổi; bật "giảm chuyển động" trong hệ điều hành thì đổi ngay. Giao diện đã lưu được áp dụng trước lần vẽ đầu tiên (`theme-init.js` + `additionalArguments`), không nháy màu khi mở.
- **Trò chuyện**: trả lời theo luồng (streaming), nút Dừng, lịch sử lưu cục bộ, lời nhắc hệ thống, nhiệt độ, số token tối đa, độ dài ngữ cảnh.
- **Gửi kèm tài liệu** (nút ghim hoặc kéo thả vào khung chat): PDF có lớp chữ (pdfjs-dist), DOCX (mammoth), TXT/MD/CSV/JSON và tệp mã nguồn. Tối đa 20 MB/tệp, 5 tệp/lần. PDF scan chưa hỗ trợ. Mọi thứ xử lý cục bộ.
- **Hỏi đáp tài liệu dài (RAG)** (`src/rag.js`): khi đã tải mô hình nhúng **BGE-M3** (`ggml-org/bge-m3-Q8_0-GGUF`, 605 MB, MIT; nút trong *Cài đặt trò chuyện → Tìm kiếm trong tài liệu*, hoặc lời mời khi gửi tài liệu lần đầu), tài liệu được chia đoạn ~500 token (gối đầu ~80 token, cắt theo câu/đoạn văn, nhớ số trang PDF), nhúng trên máy (CPU) và lưu chỉ mục vector riêng cho từng cuộc trò chuyện tại `userData/rag/<id>.json` (tài liệu trùng nội dung được dùng lại). Mỗi câu hỏi lấy các đoạn gần nhất (cosine + một chút điểm từ khoá cho tên riêng/con số, tối đa 6 đoạn vừa ngân sách ngữ cảnh) và hiện **Trích từ: tệp, đoạn n · trang p** dưới câu trả lời; hỏi tiếp không cần gửi lại tệp. Chưa có BGE-M3 hoặc tắt tuỳ chọn thì dùng cách cũ: đưa tài liệu vào lời nhắc giữa `<<<TÀI LIỆU: tên>>>` … `<<<HẾT TÀI LIỆU>>>`, dài quá thì giữ phần mở đầu + đoạn khớp từ khoá và cảnh báo. Xoá cuộc trò chuyện thì xoá luôn chỉ mục.
- **Ảnh và nhìn ảnh**: dán ảnh bằng Ctrl+V / Cmd+V hoặc kéo thả PNG/JPG/WEBP/GIF/BMP. Nếu mô hình đang nạp **nhìn được ảnh** (có tệp `mmproj*.gguf` cạnh tệp mô hình), ảnh (thu về cạnh dài ≤ 1024 px) được gửi thẳng cho mô hình qua llama-server chính thức của llama.cpp (bản b11751, đi kèm trong `resources/llama`, tải bằng `node build/fetch-llama.cjs`, kiểm SHA-256) và ghi chú "Mô hình nhìn ảnh trực tiếp"; ảnh gần nhất được gửi lại khi hỏi tiếp trong phiên. Nếu mô hình chỉ có chữ, AIVN đọc chữ trong ảnh bằng OCR cục bộ (tesseract.js, tiếng Việt + tiếng Anh) và ghi chú "Mô hình hiện tại không nhìn được ảnh, AIVN đã đọc chữ trong ảnh". Windows: llama-server cần Microsoft Visual C++ Redistributable 2015–2022 (x64); AIVN không đóng gói thư viện của Microsoft mà báo lỗi rõ và mở trang tải chính thức `https://aka.ms/vs/17/release/vc_redist.x64.exe`.
- **Tự động cập nhật** (electron-updater, GitHub Releases `OWNER/aivn`): kiểm tra khi mở và bằng nút *Kiểm tra cập nhật* trong mục Giới thiệu. Windows: Tải về → Khởi động lại để cập nhật (bản chưa ký, `verifyUpdateCodeSignature: false`). macOS: chỉ báo có bản mới và mở trang Releases (Squirrel.Mac cần chữ ký Apple Developer ID).
- **Kho mô hình**: tìm mọi kho GGUF công khai trên Hugging Face (API công khai; sắp xếp theo lượt tải / mới nhất / lượt thích), xem danh sách tệp .gguf kèm dung lượng, gộp tệp chia nhỏ `-0000k-of-0000N`, nhãn RAM (Vừa máy / Có thể chậm / Quá lớn), gợi ý Q4_K_M, nhãn **Nhìn được ảnh** khi repo có tệp mmproj (tải kèm bản Q8_0/F16 phù hợp nhất cùng mô hình; mô hình đã tải trước đó có nút tải bổ sung), đánh dấu embedding và kiến trúc chưa hỗ trợ. 29 gợi ý đã kiểm tra, trong đó 4 mô hình nhìn ảnh: Qwen3-VL 2B, Qwen2.5-VL 3B, Gemma 3 4B (ggml-org), SmolVLM 500M (Qwen2.5/Qwen3, Gemma 2/3, Llama 3.x, Phi-3.5/4, Mistral, DeepSeek R1 Distill, SmolLM2, VyLinh, gpt-oss). Tải có hàng đợi (2 tệp cùng lúc), tạm dừng/tải tiếp (HTTP Range), tốc độ và thời gian còn lại; mã truy cập Hugging Face (tuỳ chọn) chỉ lưu trên máy, không ghi log. Nhập tệp GGUF có sẵn.
- **Sao chép/dán**: menu Sửa (bắt buộc trên macOS để Cmd+C/Cmd+V hoạt động), menu chuột phải Cắt/Sao chép/Dán/Chọn tất cả, nút Sao chép câu trả lời.
- **Bộ máy suy luận**: node-llama-cpp chạy trong tiến trình Node.js thuần đi kèm (`resources/node`, tải bằng `node build/fetch-node.cjs`), vì bộ cấp phát của Electron làm sập tiến trình khi cấp phát > 2 GB (mô hình 7B chạy CPU). Mô hình nhìn ảnh chạy bằng `llama-server` (tiến trình con, chỉ nghe 127.0.0.1, khoá API ngẫu nhiên mỗi lần nạp, tắt cùng ứng dụng); mô hình nhúng BGE-M3 chạy CPU trong cùng tiến trình engine.
- **Mô hình của tôi**: nạp / gỡ khỏi bộ nhớ / xoá / mở thư mục.
- **Máy chủ API**: tương thích OpenAI tại http://localhost:1234 (`GET /v1/models`, `POST /v1/chat/completions` có `stream: true` và ảnh `image_url` cho mô hình nhìn ảnh, `POST /v1/embeddings` với `input` chuỗi/mảng, `encoding_format` float/base64, `dimensions`). Nếu gửi `model` là một mô hình chưa nạp nhưng có trên máy, ứng dụng sẽ tự nạp.

```bash
curl http://localhost:1234/v1/embeddings -H "Content-Type: application/json" \
  -d '{"model": "bge-m3-q8_0", "input": ["Xin chào", "Hà Nội"]}'
```

Dữ liệu được lưu trong thư mục userData (Windows: `%APPDATA%\AIVN`): `models\`, `rag\` (chỉ mục tài liệu), `settings.json`, `conversations.json`.

## Phát triển
```bash
npm install --force          # --force để cài cả gói prebuilt @node-llama-cpp/win-x64* trên Linux
node node_modules/electron/install.js   # nếu npm chặn script cài đặt của electron
npm start
npm run dist:win     # NSIS + portable (cần wine để ghi icon/metadata vào exe)
npm run dist:linux   # AppImage
npm run dist:mac     # macOS arm64 + x64 (.zip, chạy được trên Linux)
node --test test/    # kiểm thử trích xuất PDF/DOCX/TXT, OCR, Hugging Face, RAG, /v1/embeddings
```

## Phát hành (GitHub)
```bash
gh auth login
./release.sh <github-owner>          # đặt owner, build Windows NSIS + macOS arm64/x64, tạo repo <owner>/aivn (public),
                                     # release v<version> (+ latest.yml, latest-mac.yml, blockmap) và GitHub Pages
DRY_RUN=1 ./release.sh <owner>       # chỉ build + chuẩn bị dist/release và dist/site, không gọi GitHub
```
Nút tải trên trang web trỏ tới `https://github.com/<owner>/aivn/releases/latest/download/AIVN-Setup.exe`, `AIVN-mac-arm64.zip`, `AIVN-mac-x64.zip`. Mã nguồn trang web: `site/index.html`.

Biến môi trường dùng khi kiểm thử: `AIVN_USER_DATA`, `AIVN_API=1` (bật API khi mở), `AIVN_LOAD=<id mô hình>`, `AIVN_SHOT=<file.png>` (chụp cửa sổ), `AIVN_TEST=1`, `AIVN_SELFTEST_DOC=<tệp>` + `AIVN_SELFTEST_Q=<câu hỏi>` + `AIVN_SELFTEST_OUT=<json>` (tự hỏi đáp tài liệu rồi thoát), `AIVN_SELFTEST_V12=1` + `AIVN_VISION_MODEL` / `AIVN_TEXT_MODEL` / `AIVN_TEST_IMAGE` / `AIVN_TEST_DOC` / `AIVN_API_TEST=1` / `AIVN_SHOTS=<thư mục>` (tự kiểm thử nhìn ảnh, RAG, /v1/embeddings, Kho mô hình, đổi giao diện), `AIVN_LLAMA_SERVER=<đường dẫn llama-server>`, `AIVN_SELFTEST_UPDATE=1`, `AIVN_UPDATE_CHECK=1`, `AIVN_UPDATE_URL=<feed generic>`, `AIVN_UPDATE_DELAY=<ms>`.

## Giấy phép bên thứ ba
- llama.cpp / llama-server (MIT): `resources/llama/LICENSE-llama.cpp.txt` trong bản cài.
- node-llama-cpp (MIT), Electron (MIT), Node.js (MIT, `resources/node/LICENSE`), tesseract.js (Apache 2.0), pdfjs-dist (Apache 2.0), mammoth (BSD-2).
- Mô hình không đi kèm ứng dụng; mỗi mô hình tải từ Hugging Face tuân theo giấy phép riêng (BGE-M3: MIT).
