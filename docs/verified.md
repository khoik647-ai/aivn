# Kết quả AIVN tự kiểm chứng

Trang này là nguồn cho mọi nhãn **✓ Đã kiểm chứng** và **⚠ AIVN thử chưa đạt** trong Kho mô hình. Nhãn **ⓘ Theo nhà phát triển** thì dẫn thẳng tới thẻ mô hình hoặc tài liệu chính thức, kèm câu trích nguyên văn.

Quy ước:

- Chỉ ghi điều AIVN đã tự chạy thử. Kết quả là của một lần thử trên một máy cụ thể, với đúng tệp lượng tử hoá ghi trong Kho, không phải lời bảo đảm cho mọi máy.
- Máy thử: Linux x64, 8 luồng CPU Intel Xeon, 15 GB RAM, **không có GPU** (llama.cpp chạy CPU). Máy có GPU sẽ nhanh hơn nhiều; thời gian ở đây chỉ để so sánh giữa các mô hình.
- Mô hình chưa có mục nào ở đây thì chưa được AIVN kiểm chứng; nhãn của nó (nếu có) chỉ là lời nhà phát triển.
- Bài thử “chưa đạt” vẫn được ghi lại để không ai hiểu nhầm lời nhà phát triển là đã kiểm chứng.

<a id="v0143-cong-cu"></a>
## 0.14.3 — Gọi công cụ với mô hình nhỏ (chỉ đọc chữ)

Lệnh: “Mở ứng dụng Máy tính”, một lần thử cho mỗi mô hình, AIVN AGENT bật công cụ máy tính/ứng dụng.

| Mô hình | Công cụ được gọi | Kết quả |
|---|---|---|
| Qwen2.5 0.5B Instruct Q4_K_M | `open_app {"name":"Máy tính"}` | ✓ Mở được, trả lời đúng |
| Gemma 2 2B Q4_K_M | `open_app {"name":"Calculator"}` (giao thức công cụ dạng văn bản) | ✓ Mở được |
| Gemma 3 1B Q4_K_M | `open_app {"name":"Calculator"}` | ✓ Gọi đúng công cụ, nhưng câu trả lời sau đó lạc đề |
| Qwen3 0.6B Q4_K_M | `list_apps {"query":"máy tính"}` | Chỉ liệt kê, không mở — không gắn nhãn |
| Qwen2.5 Coder 7B Q4_K_M | (không gọi) | ⚠ Từ chối: “Không có quyền truy cập vào các ứng dụng…” |

<a id="v0143-nhin-anh"></a>
## 0.14.3 — Nhìn ảnh, định vị nút, gọi công cụ (mô hình nhìn được ảnh)

Ba bài thử cho mỗi mô hình (tệp Q4_K_M, tệp thị giác Q8_0 hoặc F16):

1. **Nhìn ảnh:** ảnh có chữ HELLO và một hình tròn đỏ. Hỏi: “Chữ gì, hình tròn màu gì?”
2. **Định vị giao diện:** ảnh chụp cửa sổ Zalo. Hỏi vị trí “nút Gửi (Send) màu xanh ở góc dưới bên phải”. Đạt khi tâm hộp trả về nằm trong nút Gửi thật.
3. **Gọi công cụ:** “Mở Zalo”. Đạt khi mô hình gọi `open_app {"name":"Zalo"}`.

| Mô hình | Nhìn ảnh | Định vị nút Gửi | Gọi công cụ |
|---|---|---|---|
| Qwen3-VL 4B | ✓ | ✓ | ✓ |
| Qwen3-VL 8B | ✓ | ✓ | ✓ |
| Qwen3-VL 2B (Q8_0)* | ✓ | — | ✓ (mở Máy tính) |
| Qwen2.5-VL 3B | ✓ | ✓ | ✓ |
| Qwen2.5-VL 7B | ✓ | ✓ | ⚠ không gọi công cụ |
| UI-TARS 1.5 7B | ✓ | ✓ | ⚠ không gọi công cụ |
| Holo1.5 3B | ✓ | ⚠ trả lời sai định dạng, AIVN 0.14.3 không đọc được toạ độ | ✓ |
| Gemma 3 4B | ✓ | ⚠ chỉ sai vị trí | ✓ |
| InternVL3 2B | ✓ | ⚠ chỉ sai vị trí | ✓ |
| InternVL3 8B | ✓ | ⚠ chỉ sai vị trí | ✓ |

\* Bản Qwen3-VL 2B **Q4_K_M** (không có trong Kho) chỉ sai vị trí nút Gửi và không mở được Zalo; Kho chỉ phát hành bản Q8_0. Kết quả định vị của bản Q8_0 xem ở mục 0.16 bên dưới.

<a id="v0153-agent"></a>
## 0.15.3 — AIVN AGENT làm việc nhiều bước

Mô hình chính **Qwen3 4B Instruct 2507** (Q4_K_M), máy không GPU, ngữ cảnh 8192.

- **Tệp nhiều bước:** đọc `chi-tieu-thang-9.csv`, tính tổng, trung bình và nhóm chi nhiều nhất, rồi ghi `bao-cao-chi-tieu.md` (4 bước công cụ, số liệu đúng).
- **Xoá tệp:** khi không xoá được vào Thùng rác, AIVN AGENT dừng lại hỏi người dùng thay vì tự xoá hẳn.
- **Ghi nhớ:** lưu “Sinh viên VLU tên Khôi, thích môn học Trí tuệ nhân tạo.” và dùng lại ở cuộc trò chuyện sau.
- **Lịch nhắc:** tạo lời nhắc uống nước và lời nhắc chạy đúng giờ.
- **Máy chủ API:** trả `tool_calls` đúng chuẩn OpenAI cho công cụ `get_weather`.
- **Điều khiển màn hình (kèm mắt nhìn Qwen3-VL 2B Q8_0):** việc “Trong cửa sổ Zalo đang mở, tìm liên hệ Trần Quỳnh Anh và mở cuộc trò chuyện với người đó.” trên Zalo giả lập. AIVN AGENT nhìn màn hình, gõ tên vào ô Tìm kiếm, gõ lại không dấu khi không thấy kết quả, rồi bấm đúng “Tran Quynh Anh” (4 bước, 289 giây).
- Mọi câu trả lời và báo cáo đều bằng tiếng Việt.
