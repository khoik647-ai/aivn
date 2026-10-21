Bản sửa lỗi 0.15.3. Ai dùng **Điều khiển màn hình** (AIVN AGENT) nên cập nhật.

Điều khiển màn hình luôn có “mắt nhìn”:
- AIVN **không còn gợi ý một mô hình chỉ có chữ để điều khiển màn hình**. Gợi ý mới theo VRAM của máy:
  - Một mô hình nhìn ảnh vừa lập kế hoạch vừa nhìn màn hình: **Qwen3-VL 8B** (máy 8–12 GB VRAM), **Qwen3-VL 4B** hoặc **2B** (máy 4 GB).
  - Hoặc bộ đôi tự nạp: mô hình lập kế hoạch (Qwen3 8B / Qwen3 4B) + mô hình nhìn màn hình (UI-TARS 1.5 7B trên máy 12 GB, Holo1.5 3B hoặc Qwen3-VL 2B trên máy 4 GB).
- Đang dùng mô hình chỉ có chữ mà bật Điều khiển màn hình, AIVN hiện thẻ cảnh báo với nút **Nạp thêm mắt nhìn**: dùng ngay mô hình nhìn ảnh đã có trên máy, hoặc tải mô hình phù hợp rồi tự đặt làm “mắt nhìn” cho mọi bước chụp màn hình.
- Nếu máy đã có mô hình nhìn ảnh, AIVN tự dùng nó làm mắt nhìn, không cần chỉnh gì.
- Ứng dụng có cây giao diện nghèo nàn (Zalo, các ứng dụng Electron/Chromium như Slack, Discord, Teams, VS Code…) được tự nhận ra: AIVN chụp màn hình và để mô hình nhìn ảnh mô tả ở mọi bước.

Tìm kiếm trong ứng dụng (ví dụ tìm liên hệ trên Zalo) chắc chắn hơn:
- Sau khi gõ vào ô tìm kiếm, AIVN chờ kết quả hiện ra và kiểm tra lại bằng cây giao diện hoặc ảnh chụp màn hình.
- AIVN bấm vào ô tìm kiếm trước khi gõ, kể cả khi ô đó chỉ nhận ra được qua ảnh chụp (như ô “Tìm kiếm” của Zalo).
- Không thấy kết quả thì AIVN AGENT thử lại lần lượt từng cách: không dấu (“Tran Quynh Anh”), một phần tên có dấu và không dấu (“Quỳnh Anh”, “Quynh Anh”), rồi tên (“Anh”). Chỉ báo “không tìm thấy” khi đã thử hết.
- Thấy kết quả khớp thì AIVN AGENT bấm mở luôn, không dừng lại hỏi. Mở một cuộc trò chuyện không cần xác nhận; gửi tin nhắn vẫn cần bạn cho phép.

Hiệu ứng đổi giao diện:
- Cài đặt mới **Hiệu ứng chuyển giao diện: Đầy đủ (mặc định) / Theo hệ điều hành / Tắt**. “Đầy đủ” luôn chạy logo và hiệu ứng lan tròn, kể cả khi Windows tắt Animation effects.
- Sửa lỗi màn hình lớn (2K/4K) chỉ thấy mờ dần; có lớp phủ dự phòng và ghi nhật ký cách hiệu ứng đã chạy.

Khác:
- Trang web AIVN có thêm tiếng Anh và tiếng Trung (giản thể), chọn ở góc trên; trang tự chọn theo ngôn ngữ trình duyệt và nhớ lựa chọn của bạn.
- AIVN AGENT gõ sai một vài ký tự tên tệp (ví dụ “chii-tieu…”) thì được gợi ý tên đúng để đọc lại, thay vì báo không tìm thấy.
- Sửa một số lỗi chính tả trong giao diện (thống nhất cách đặt dấu: xoá, khoá, tuỳ…).

Tải về:
- Windows 10/11: AIVN-Setup.exe
- macOS Apple Silicon: AIVN-mac-arm64.zip · macOS Intel: AIVN-mac-x64.zip
- Bản cài chưa có chữ ký số. Windows SmartScreen: chọn More info → Run anyway. macOS: nhấp phải → Mở.
