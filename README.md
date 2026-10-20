# AIVN – Ứng dụng chạy mô hình AI cục bộ

Phát triển bởi **NGUYỄN NGỌC KHÔI SINH VIÊN VLU** · © 2026 AIVN

Electron + node-llama-cpp (llama.cpp, MIT). Giao diện tiếng Việt.

## Chức năng
- **Giao diện**: logo rồng AIVN; chủ đề sáng đỏ–trắng mặc định, có chế độ Tối và Tự động (theo hệ điều hành) ở góc dưới thanh bên. Màu chữ/nút đạt tương phản WCAG AA.
- **Trò chuyện**: trả lời theo luồng (streaming), nút Dừng, lịch sử lưu cục bộ, lời nhắc hệ thống, nhiệt độ, số token tối đa, độ dài ngữ cảnh.
- **Gửi kèm tài liệu** (nút ghim hoặc kéo thả vào khung chat): PDF có lớp chữ (pdfjs-dist), DOCX (mammoth), TXT/MD/CSV/JSON và tệp mã nguồn. Tối đa 20 MB/tệp, 5 tệp/lần. Ảnh PNG/JPG/WEBP/GIF/BMP: dán bằng Ctrl+V / Cmd+V hoặc kéo thả, hiện ảnh thu nhỏ; AIVN đọc chữ trong ảnh bằng OCR cục bộ (tesseract.js, dữ liệu tiếng Việt + tiếng Anh đi kèm, không cần mạng) và ghi chú "Mô hình hiện tại không nhìn được ảnh, AIVN đã đọc chữ trong ảnh" (node-llama-cpp chưa hỗ trợ mmproj/thị giác). PDF scan chưa hỗ trợ. Nội dung được đưa vào lời nhắc giữa `<<<TÀI LIỆU: tên>>>` … `<<<HẾT TÀI LIỆU>>>`; nếu dài hơn ngữ cảnh thì giữ phần mở đầu + các đoạn khớp từ khoá câu hỏi và hiện cảnh báo. Chỉ tên tệp được lưu trong lịch sử; tài liệu của tin nhắn gần nhất được giữ để hỏi tiếp. Mọi thứ xử lý cục bộ.
- **Tự động cập nhật** (electron-updater, GitHub Releases `OWNER/aivn`): kiểm tra khi mở và bằng nút *Kiểm tra cập nhật* trong mục Giới thiệu. Windows: Tải về → Khởi động lại để cập nhật (bản chưa ký, `verifyUpdateCodeSignature: false`). macOS: chỉ báo có bản mới và mở trang Releases (Squirrel.Mac cần chữ ký Apple Developer ID).
- **Khám phá**: tìm mọi kho GGUF công khai trên Hugging Face (API công khai; sắp xếp theo lượt tải / mới nhất / lượt thích), xem danh sách tệp .gguf kèm dung lượng, gộp tệp chia nhỏ `-0000k-of-0000N`, nhãn RAM (Vừa máy / Có thể chậm / Quá lớn), gợi ý Q4_K_M, đánh dấu mmproj/embedding và kiến trúc chưa hỗ trợ. 26 gợi ý đã kiểm tra (Qwen2.5/Qwen3, Gemma 2/3, Llama 3.x, Phi-3.5/4, Mistral, DeepSeek R1 Distill, SmolLM2, VyLinh, gpt-oss). Tải có hàng đợi (2 tệp cùng lúc), tạm dừng/tải tiếp (HTTP Range), tốc độ và thời gian còn lại; mã truy cập Hugging Face (tuỳ chọn) chỉ lưu trên máy, không ghi log. Nhập tệp GGUF có sẵn.
- **Sao chép/dán**: menu Sửa (bắt buộc trên macOS để Cmd+C/Cmd+V hoạt động), menu chuột phải Cắt/Sao chép/Dán/Chọn tất cả, nút Sao chép câu trả lời.
- **Bộ máy suy luận**: node-llama-cpp chạy trong tiến trình Node.js thuần đi kèm (`resources/node`, tải bằng `node build/fetch-node.cjs`), vì bộ cấp phát của Electron làm sập tiến trình khi cấp phát > 2 GB (mô hình 7B chạy CPU).
- **Mô hình của tôi**: nạp / gỡ khỏi bộ nhớ / xoá / mở thư mục.
- **Máy chủ API**: tương thích OpenAI tại http://localhost:1234 (`GET /v1/models`, `POST /v1/chat/completions`, có `stream: true`). Nếu gửi `model` là một mô hình chưa nạp nhưng có trên máy, ứng dụng sẽ tự nạp.

Dữ liệu được lưu trong thư mục userData (Windows: `%APPDATA%\AIVN`): `models\`, `settings.json`, `conversations.json`.

## Phát triển
```bash
npm install --force          # --force để cài cả gói prebuilt @node-llama-cpp/win-x64* trên Linux
node node_modules/electron/install.js   # nếu npm chặn script cài đặt của electron
npm start
npm run dist:win     # NSIS + portable (cần wine để ghi icon/metadata vào exe)
npm run dist:linux   # AppImage
npm run dist:mac     # macOS arm64 + x64 (.zip, chạy được trên Linux)
node --test test/    # kiểm thử trích xuất PDF/DOCX/TXT
```

## Phát hành (GitHub)
```bash
gh auth login
./release.sh <github-owner>          # đặt owner, build Windows NSIS + macOS arm64/x64, tạo repo <owner>/aivn (public),
                                     # release v<version> (+ latest.yml, latest-mac.yml, blockmap) và GitHub Pages
DRY_RUN=1 ./release.sh <owner>       # chỉ build + chuẩn bị dist/release và dist/site, không gọi GitHub
```
Nút tải trên trang web trỏ tới `https://github.com/<owner>/aivn/releases/latest/download/AIVN-Setup.exe`, `AIVN-mac-arm64.zip`, `AIVN-mac-x64.zip`. Mã nguồn trang web: `site/index.html`.

Biến môi trường dùng khi kiểm thử: `AIVN_USER_DATA`, `AIVN_API=1` (bật API khi mở), `AIVN_LOAD=<id mô hình>`, `AIVN_SHOT=<file.png>` (chụp cửa sổ), `AIVN_TEST=1`, `AIVN_SELFTEST_DOC=<tệp>` + `AIVN_SELFTEST_Q=<câu hỏi>` + `AIVN_SELFTEST_OUT=<json>` (tự hỏi đáp tài liệu rồi thoát), `AIVN_SELFTEST_UPDATE=1`, `AIVN_UPDATE_CHECK=1`, `AIVN_UPDATE_URL=<feed generic>`, `AIVN_UPDATE_DELAY=<ms>`.
