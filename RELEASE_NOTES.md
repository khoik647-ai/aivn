Mới ở 0.15.0 — AIVN AGENT điều khiển máy tính thật, thẻ xin phép mới, Kết nối (MCP), Kinh doanh → Khách hàng

AIVN AGENT điều khiển máy tính (thử nghiệm):
- Vòng lặp quan sát → làm → kiểm tra: đọc cây giao diện (Windows UIA, macOS Accessibility; Linux dùng OCR), từng thao tác có khung đỏ đánh dấu, nhấn Esc hoặc Ctrl+Alt+Q để dừng ngay, không bao giờ gõ mật khẩu, dòng thời gian có ảnh thu nhỏ.
- Nhận biết hộp thoại (Lưu thành…): dùng Enter trong hộp thoại, không bấm lại Ctrl+S; kiểm tra hộp thoại đã đóng rồi mới báo xong.
- Đã thử trên máy Linux: mở LibreOffice Writer, gõ tiếng Việt có dấu, lưu thành tệp thu-aivn trong Documents (Qwen3 4B Instruct 2507, chỉ dùng CPU).

Sửa lỗi người dùng gặp trên Windows (RTX 3050 Ti 4 GB, Qwen3-VL 8B):
- Không còn lặp câu mãi (“Bạn có muốn tôi thực hiện các bước này cho bạn không?”): tham số lấy mẫu theo từng họ mô hình (phạt lặp, DRY, không còn nhiệt độ 0.2), bộ phát hiện lặp tự dừng sinh chữ và thử lại một lần bằng lời gọi công cụ có ràng buộc, mỗi lượt có giới hạn token.
- Không còn “nhãn giả” kiểu [Mở Zalo] [Nhắn tin] hay câu “do giới hạn của công cụ… không thể tự động thực hiện” kèm hướng dẫn tay khi công cụ máy tính đang bật: AIVN AGENT buộc gọi công cụ thật (vd. open_app “Zalo”).
- Câu nối tiếp như “tôi muốn hãy làm cho tôi” làm luôn việc bạn đã nhờ trước đó. Các câu trả lời cũ chỉ hướng dẫn/hỏi lại được ẩn khỏi ngữ cảnh để mô hình không bắt chước.
- GPU ít VRAM: không nạp hai mô hình lớn cùng lúc lên GPU. Mô hình định vị chuyển sang CPU và AIVN gợi ý cặp nhỏ hơn: Qwen3 4B Instruct 2507 + Qwen3-VL 2B.
- Việc nhiều tệp không còn dừng giữa chừng: 20 vòng mỗi lượt thay vì 8. Nếu hết vòng, AIVN tự tóm tắt các việc đã làm.

Thẻ xin phép mới:
- Thẻ hiện đầy đủ tham số, xem trước nội dung và phần thay đổi (diff) khi ghi đè.
- Nút: Cho phép (Ctrl+Enter), Từ chối (Esc), Từ chối kèm lý do. Lý do được gửi cho mô hình.
- “Luôn cho phép công cụ này” có cảnh báo và không bao giờ bật sẵn. Có dải giai đoạn Nghĩ → Xin phép → Làm → Kết quả.

Kết nối (MCP):
- Bảng quản lý máy chủ MCP qua mcp.json, hỗ trợ stdio, HTTP và SSE. Có công tắc bật/tắt, huy hiệu trạng thái và nhật ký.
- Công cụ MCP mang tên kèm máy chủ và luôn qua thẻ xin phép.
- Có sẵn Node đi kèm nên npx chạy được mà không cần cài Node.
- Mẫu có sẵn: filesystem, fetch, memory, kèm cảnh báo bảo mật.
- Công cụ tệp mới: read_multiple_files, list_allowed_directories. Thông báo “Access denied” rõ ràng khi truy cập ngoài thư mục được phép.

Gợi ý mô hình trung thực:
- Một bộ gợi ý thống nhất: Qwen3 4B 2507 / 8B cho trò chuyện và công cụ; mô hình nhìn ảnh nhỏ làm mô hình định vị.
- Nhãn “Gợi ý” chỉ hiện khi mô hình qua bài đo tác vụ tự động. Bạn có thể tự đo “Điểm tác vụ” trên máy mình.

Giao diện:
- Hướng dẫn lần đầu, bảng lệnh Ctrl+K, bảng phím tắt (Ctrl+/), thu gọn bảng cài đặt (Ctrl+.).
- Thông báo không còn che ô nhập, có trạng thái trống, thanh trạng thái không xuống dòng ở cửa sổ hẹp.
- Bảng hiệu năng có đo tốc độ.

Kinh doanh → Khách hàng (mới):
- Tổng quan doanh số, danh sách liên hệ, cơ hội dạng bảng kéo thả theo giai đoạn, việc cần làm.
- Nhập từ CSV/Excel, xuất CSV. Dữ liệu chỉ lưu trên máy bạn.

Tải về:
- Windows 10/11: AIVN-Setup.exe
- macOS Apple Silicon: AIVN-mac-arm64.zip · macOS Intel: AIVN-mac-x64.zip
- Bản cài chưa có chữ ký số. Windows SmartScreen: chọn More info → Run anyway. macOS: nhấp phải → Mở.
