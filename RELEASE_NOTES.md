Bản sửa lỗi 0.15.1 — chỉ gồm sửa lỗi và tăng độ ổn định. Ai đang dùng 0.15.0 nên cập nhật ngay.

Lỗi nghiêm trọng đã sửa:
- **0.15.0 trên Windows và macOS không nạp được mô hình nào** (kể cả mô hình nhỏ). Thông báo lỗi là “Bộ máy AI đã đóng đột ngột (mã 1)”, kèm “Lỗi kết nối tới AIVN API: fetch failed”.
- Nguyên nhân: tệp mới src/agent/sampling.js (thiết lập chống lặp câu) không được đóng gói ra ngoài app.asar. Bộ máy AI chạy bằng Node.js riêng nên không đọc được tệp đó và thoát ngay khi khởi động (Cannot find module './agent/sampling').
- Đã sửa cách đóng gói và thêm hai lớp kiểm tra để lỗi này không lặp lại: một bài kiểm thử tự động rà mọi mô-đun mà bộ máy AI cần, và bước phát hành chạy thử bộ máy AI trong bản đã đóng gói (Windows và macOS) trước khi đăng.

Ổn định hơn:
- Khi bộ máy AI không khởi động được, thông báo nêu đúng dòng lỗi thật (không còn đoán “thiếu bộ nhớ”). Chi tiết được ghi vào nhật ký.
- AIVN tự kiểm tra bộ máy ngay khi mở ứng dụng.
- Nếu bộ máy sập khi đang nạp mô hình, AIVN tự thử lại một lần ở chế độ an toàn (chỉ CPU, ngữ cảnh 4096) rồi mới báo lỗi.
- Khi bộ máy AI bị dừng đột ngột, AIVN dọn luôn llama-server (mô hình nhìn ảnh) còn sót lại, không để nó chiếm vài GB RAM/VRAM.

Giao diện:
- Thông báo xếp gọn ở góc phải, tối đa 3 cái, tự ẩn (lỗi giữ 10 giây), có nút ×. Thông báo thường tự xoá khi chuyển màn hình.
- Ô nhập chữ trong mọi biểu mẫu có viền và nền rõ ràng (trước đây là “ô vô hình”).
- Hộp chọn tệp/thư mục có nút tiếng Việt (Lưu / Mở / Chọn thư mục).
- Dải “Nghĩ → Xin phép → Làm → Kết quả” chỉ hiện trong AIVN AGENT, không hiện ở trò chuyện thường.
- Mục Kinh doanh → Khách hàng tạm ẩn. Bộ Kinh doanh sẽ được làm lại đầy đủ và chỉ ra mắt khi hoàn chỉnh.

Tải về:
- Windows 10/11: AIVN-Setup.exe
- macOS Apple Silicon: AIVN-mac-arm64.zip · macOS Intel: AIVN-mac-x64.zip
- Bản cài chưa có chữ ký số. Windows SmartScreen: chọn More info → Run anyway. macOS: nhấp phải → Mở.
