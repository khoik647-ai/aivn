Bản sửa lỗi 0.15.2. Ai dùng laptop có GPU 4 GB (RTX 3050/3050 Ti, GTX 1650…) nên cập nhật ngay.

Lỗi đã sửa:
- **AIVN AGENT lỗi ở mọi tin nhắn** với thông báo tiếng Anh “Failed to compress chat history for context shift…”. Trên thanh trên cùng, độ dài ngữ cảnh chỉ còn khoảng 1437.
- Nguyên nhân: khi VRAM không đủ chỗ, AIVN để bộ máy tự thu nhỏ ngữ cảnh, xuống thấp nhất tới 512 token. Lời nhắc hệ thống cộng mô tả công cụ của AIVN AGENT đã cần khoảng 5.000 token, nên mọi lượt đều tràn.
- Bây giờ AIVN **không bao giờ nạp mô hình với ngữ cảnh dưới 8192** (4096 nếu bạn tự chọn 4096 cho trò chuyện thường). Thiếu VRAM thì AIVN đưa ít lớp lên GPU hơn, phần còn lại chạy trên RAM, chứ không cắt ngữ cảnh. Qwen3 4B Q4 với ngữ cảnh 8192 chạy tốt trên máy 16 GB RAM + 4 GB VRAM.

Ổn định hơn:
- AIVN AGENT kiểm tra trước khi gửi: lời nhắc không vừa ngữ cảnh thì AIVN tự nạp lại mô hình với ngữ cảnh lớn hơn rồi chạy tiếp. Lịch sử quá dài thì AIVN bỏ bớt tin cũ nhất, luôn giữ tin cuối của bạn.
- Không còn lỗi tiếng Anh: khi vẫn không đủ ngữ cảnh, AIVN báo bằng tiếng Việt và có nút **Tăng ngữ cảnh** để nạp lại mô hình với ngữ cảnh gấp đôi.
- Nếu đã có thao tác thật trong lượt (ví dụ đã mở ứng dụng), AIVN không tự chạy lại cả lượt, để không gửi tin nhắn hai lần.
- Mô tả công cụ gửi cho mô hình gọn hơn khi ngữ cảnh dưới 16k. Chỉ các công cụ đang bật mới được gửi.
- Chế độ an toàn (khi bộ máy sập lúc nạp) và tự phục hồi giữa lượt không còn hạ ngữ cảnh xuống 2048.

Về “Tăng tốc: GPU vulkan” trên card NVIDIA: đây là chủ ý, không phải lỗi. Bản cài AIVN dùng Vulkan (chạy được trên NVIDIA, AMD và Intel) để bộ cài nhỏ gọn. Bộ máy CUDA riêng nặng thêm khoảng 550 MB. AIVN sẽ cho tải CUDA tuỳ chọn ở bản sau.

Tải về:
- Windows 10/11: AIVN-Setup.exe
- macOS Apple Silicon: AIVN-mac-arm64.zip · macOS Intel: AIVN-mac-x64.zip
- Bản cài chưa có chữ ký số. Windows SmartScreen: chọn More info → Run anyway. macOS: nhấp phải → Mở.
