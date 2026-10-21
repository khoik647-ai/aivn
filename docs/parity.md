# AIVN ↔ LM Studio: đặc tả tương đương và danh sách thiếu sót (v1, 20/10/2026)

Mục tiêu: AIVN có **cấu trúc, luồng thao tác và độ hoàn thiện** ngang LM Studio (0.3.x). Thiết kế, mã nguồn, biểu tượng và câu chữ đều tự viết. Giữ thương hiệu AIVN (đỏ/trắng, logo rồng, dòng ghi công NGUYỄN NGỌC KHÔI SINH VIÊN VLU) và giao diện tiếng Việt.

**Nguồn tham khảo:** tài liệu chính thức lmstudio.ai/docs:
- app (basics, download-model, presets, per-model defaults, prompt template, MCP, color themes, user/developer mode);
- developer (server, server settings, serve on network, idle TTL/auto-evict, REST/OpenAI endpoints).

Phần mô tả bố cục là quan sát cấu trúc giao diện công khai, không sao chép tài sản nào.

**Tiêu chí "xong" cho mỗi màn hình:**
- Các trạng thái: trống / đang tải / lỗi / chữ dài / cửa sổ 1280×720 / sáng & tối / chỉ bàn phím.
- Ảnh trước–sau trong `/workspace/qa-<phiên bản>/parity/`.
- Không có chữ tiếng Anh lọt vào (trừ tên kỹ thuật như GGUF, Q4_K_M, API).

---

## 0. Khung ứng dụng

| LM Studio | AIVN hiện tại | Thiếu / cần làm |
|---|---|---|
| Thanh trái dạng biểu tượng: Chat · Developer · My Models · Discover. Phím tắt Ctrl+1..4. | Thanh trái dạng chữ, 8+ mục: Trò chuyện, AIVN AGENT (+ Lịch tự động, Ghi nhớ), Kho mô hình, Mô hình của tôi, Máy chủ API, Bảo mật & Quản trị, (Khách hàng). | Gom về 4 mục chính: **Trò chuyện · Nhà phát triển · Mô hình của tôi · Khám phá**, cộng nhóm phụ "AIVN AGENT" (Agent, Lịch tự động, Ghi nhớ). Bảo mật & Quản trị chuyển vào Cài đặt. Thêm Ctrl+1..4. Có chế độ thu gọn chỉ còn biểu tượng (có chú thích khi rê chuột). |
| Thanh nạp mô hình ở giữa trên cùng ("chọn mô hình để nạp", Ctrl+L). Mở hộp chọn có ô tìm và danh sách mô hình đã tải (tên, kiến trúc, lượng tử, dung lượng). Hiện mô hình đang nạp kèm nút Eject. | `<select>` gốc + nút Gỡ. Trạng thái là chữ bên phải. | **Hộp nạp mô hình (Ctrl+L)** thay `<select>`: ô tìm, danh sách có huy hiệu (kiến trúc, tham số, lượng tử, dung lượng, nhìn ảnh, công cụ, mức "vừa máy"), phím ↑↓/Enter. Hiện mô hình đang nạp dạng "viên": tên · ngữ cảnh · GPU/CPU · RAM dùng, nút ⏏. |
| Cài đặt nạp trước khi nạp ("chọn thủ công tham số nạp"): độ dài ngữ cảnh, **GPU offload (số lớp x/N)**, luồng CPU, batch, RoPE, offload KV lên GPU, giữ mô hình trong bộ nhớ, mmap, seed, **Flash Attention**, lượng tử hoá bộ đệm K/V. Có ước tính bộ nhớ và "nhớ cài đặt cho mô hình này". | Ngữ cảnh và số lớp GPU nằm ở bảng phải, chung cho mọi mô hình. Có bảng hiệu năng. | Bảng **Tham số nạp** trong hộp nạp: thanh trượt ngữ cảnh (theo giới hạn của mô hình), thanh trượt GPU offload theo **số lớp thật** của tệp GGUF, luồng CPU, batch, Flash Attention, KV cache q8/q4, mmap, giữ trong bộ nhớ. **Ước tính RAM/VRAM trực tiếp** khi kéo thanh. Ô **"Nhớ cho mô hình này"** (mặc định riêng từng mô hình). |
| Thanh trạng thái dưới: RAM/CPU đang dùng, phiên bản, chuyển User / Power User / Developer. | Góc trái dưới: RAM, tăng tốc, phiên bản, chủ đề. | Thanh trạng thái mỏng toàn chiều ngang: RAM/VRAM thật đang dùng, tốc độ token/giây gần nhất, trạng thái máy chủ API, phiên bản. Công tắc **Cơ bản / Nâng cao** để ẩn các tham số kỹ thuật với người mới. |
| Bảng lệnh/tìm kiếm, cài đặt ứng dụng (Ctrl+,). | Đã có Ctrl+K, phím tắt Ctrl+/. | Thêm trang **Cài đặt** riêng: chung, giao diện, phần cứng, runtime, bảo mật, cập nhật, nhật ký. |

## 1. Trò chuyện

| LM Studio | AIVN | Thiếu |
|---|---|---|
| Danh sách cuộc trò chuyện có **thư mục**, đổi tên, nhân bản, xoá, sắp xếp. | Danh sách phẳng, xoá được. | Thư mục, đổi tên tại chỗ, nhân bản, ghim, tìm trong lịch sử. |
| Thanh bên phải: chọn **Preset**, System Prompt, tab Thiết lập (Temperature, giới hạn độ dài trả lời, chính sách tràn ngữ cảnh, chuỗi dừng, Top K, Repeat Penalty, Top P, Min P, đầu ra có cấu trúc JSON schema, giải mã suy đoán), tab Chương trình (công cụ/MCP). | System prompt, nhiệt độ, độ dài, ngữ cảnh, GPU, hiệu năng (một cột dài). | **Preset**: lưu / lưu thành / đặt lại / nhập-xuất JSON, kèm vài preset mẫu tiếng Việt. Chia thanh bên thành **Hệ thống · Lấy mẫu · Đầu ra · Công cụ**, với: Top K, Top P, Min P, Repeat penalty, Presence penalty, DRY (nâng cao), seed, chuỗi dừng, chính sách tràn ngữ cảnh (cắt giữa / trượt / dừng), đầu ra JSON schema. Hiện "giá trị mặc định của mô hình" và nút đặt lại từng tham số. |
| Tin nhắn: sửa, **tạo lại**, **rẽ nhánh**, sao chép, xoá. Khối suy nghĩ thu gọn. Thống kê: tok/s, thời gian ra token đầu, số token, lý do dừng. | Sao chép, Dừng; thống kê token · tok/s · giây. | Sửa tin nhắn người dùng rồi gửi lại, tạo lại câu trả lời (lưu các phiên bản ‹1/3›), rẽ nhánh thành cuộc mới, xoá tin. **TTFT** và lý do dừng. Khối "đang suy nghĩ" thu gọn cho Qwen3. Tỉ lệ ngữ cảnh đã dùng (thanh % gần ô nhập). |
| Đính kèm tài liệu (RAG), ảnh cho mô hình nhìn ảnh. | Đã có (PDF/DOCX/ảnh, RAG BGE-M3). | Huy hiệu rõ "đọc toàn văn" hay "trích đoạn (RAG)", xem trước đoạn được trích. |
| Ô nhập: Enter gửi, Shift+Enter xuống dòng, kéo-thả tệp, dán ảnh. | Đã có. | Gợi ý lệnh "/" (chèn preset, xoá ngữ cảnh). |

## 2. Khám phá (Discover)

| LM Studio | AIVN | Thiếu |
|---|---|---|
| Tìm theo từ khoá, `user/model` hoặc URL Hugging Face. Mục chọn sẵn của đội ngũ. Sắp xếp (khớp nhất, thích, tải, mới). Lọc GGUF/MLX. | Có ô tìm HF, sắp xếp tải/mới/thích, danh sách gợi ý của AIVN có thẻ. | Nhận URL/`user/model`. Bộ lọc: kích thước tham số, khả năng (nhìn ảnh, công cụ, suy luận, nhúng), ngôn ngữ (có tiếng Việt), giấy phép, **"vừa máy tôi"**. |
| Bố cục 2 cột: kết quả bên trái, chi tiết bên phải (README, thông số). **Danh sách tuỳ chọn tải theo lượng tử** (Q3…Q8, F16), mỗi tuỳ chọn có dung lượng và huy hiệu "chạy toàn GPU / một phần GPU / có thể quá lớn". | Danh sách thẻ + "Xem tệp". | Bố cục **2 cột** có README hiển thị đẹp (markdown, đoạn đầu có thể dịch). Bảng lượng tử có **huy hiệu vừa máy** tính từ VRAM/RAM thật (toàn GPU / một phần / chỉ CPU / quá lớn). Gợi ý lượng tử tốt nhất cho máy. |
| **Trình quản lý tải** (góc dưới): tiến độ, tốc độ, còn lại, tạm dừng / tiếp tục / huỷ, tải nhiều tệp (kèm mmproj). | Có tải và tiến độ trong thẻ. | **Bảng Tải xuống** chung: hàng đợi, tạm dừng/tiếp tục (HTTP Range), huỷ, thử lại, kiểm SHA-256, tự tải kèm mmproj, thông báo khi xong ("Nạp ngay"). |
| Tab Runtime (phiên bản llama.cpp, CUDA/Vulkan/CPU), Phần cứng (GPU, VRAM, chọn GPU). | Có thông tin phần cứng rải rác. | Trang **Runtime & Phần cứng**: bộ máy đang dùng (CPU/Vulkan/CUDA/Metal), phiên bản, tự kiểm tra, chọn GPU, nút "chạy thử nhanh". |

## 3. Mô hình của tôi

| LM Studio | AIVN | Thiếu |
|---|---|---|
| Bảng: kiến trúc, tham số, nhà phát hành, tên, lượng tử, dung lượng, ngày. Sắp xếp. Đổi thư mục mô hình. Bánh răng = **mặc định riêng từng mô hình** (tham số nạp + mẫu lời nhắc). Mở thư mục, xoá. | Danh sách thẻ, mở thư mục, nhập GGUF. | **Bảng có sắp xếp/tìm/nhóm theo nhà phát hành**, tổng dung lượng. Đổi thư mục mô hình (có di chuyển). Hộp **mặc định riêng từng mô hình**: ngữ cảnh, GPU, Flash Attention, preset mặc định, ghi đè mẫu lời nhắc Jinja. Nạp / ⏏ ngay trên hàng. Xoá có xác nhận (vào Thùng rác). Cảnh báo tệp hỏng hoặc thiếu mmproj. |

## 4. Nhà phát triển (máy chủ API)

| LM Studio | AIVN | Thiếu |
|---|---|---|
| Công tắc Bật máy chủ, cổng, CORS, **phục vụ trong mạng LAN**, JIT nạp mô hình theo yêu cầu, **tự gỡ khi nhàn rỗi (TTL)**, xác thực token. | Bật/tắt, cổng, tự bật, danh sách endpoint, ví dụ. | Công tắc lớn kèm trạng thái và địa chỉ (sao chép một chạm). Các tuỳ chọn: CORS, mạng LAN (cảnh báo bảo mật, hiện IP), **khoá API**, JIT nạp, TTL tự gỡ, số yêu cầu song song. |
| Danh sách mô hình đang nạp với định danh API. **Nhật ký máy chủ trực tiếp** (mức chi tiết, xoá, tìm). Ví dụ curl/Python/JS theo endpoint. | Ví dụ tĩnh. | **Nhật ký trực tiếp** (yêu cầu/đáp, thời gian, token, lỗi) có lọc và tìm. Ví dụ cụ thể curl / Python (openai) / JS điền sẵn tên mô hình đang nạp, kèm nút "Chạy thử" gửi một yêu cầu thật và hiện kết quả. |

**0.16 đã làm:** CORS (mặc định **tắt**, trước đây luôn `*`), phục vụ mạng LAN (hộp xác nhận, hiện địa chỉ IP, **bắt buộc khoá API**), khoá API (`Authorization: Bearer` hoặc `x-api-key`, so sánh thời gian hằng, tạo/hiện & sao chép/xoá; không xoá được khi LAN đang mở; không trả về giao diện qua cài đặt), TTL tự gỡ (5/15/60/240 phút, chỉ gỡ mô hình do API tự nạp, không gỡ khi đang trả lời), danh sách mô hình đang nạp có nút gỡ, ví dụ curl tự thêm dòng khoá. Mô hình của tôi: bảng sắp xếp/lọc (tên, lượng tử, dung lượng, độ vừa máy, tốc độ đo thật, lần dùng cuối). Khám phá: ★ Khuyên dùng = bản lượng tử chất lượng cao nhất (≥ Q4) còn nằm trọn VRAM; máy chỉ có CPU giữ Q4_K_M.
Còn thiếu: nhật ký mức chi tiết/tìm, số yêu cầu song song, ví dụ Python/JS.

## 5. Hiệu năng & cảm giác mượt

- Chuyển màn hình < 100 ms, không nháy trang khác (lỗi t94: bấm Khách hàng thấy thoáng Lịch tự động).
- Danh sách dài phải ảo hoá (lịch sử chat, kết quả HF).
- Stream token không giật: gom theo khung hình.
- Không có thông báo che ô nhập. Thông báo xếp chồng, tự ẩn (0.15.1 đã sửa).
- Mọi thao tác dài (nạp, tải, tìm) đều có tiến độ và nút huỷ.
- Toàn bộ biểu mẫu dùng chung thành phần ô nhập/chọn/nút. Đã có lỗi "ô vô hình" ở 0.15.0, 0.15.1 đã sửa toàn cục.

## 6. Thứ tự làm (mỗi bước: làm → kiểm đủ trạng thái → ảnh trước/sau → commit)

1. **0.15.1 (ổn định)**: lỗi nạp mô hình trên Windows/macOS, thông báo, biểu mẫu, Việt hoá hộp thoại tệp, dọn llama-server mồ côi, tự kiểm tra bộ máy. Tạm ẩn Kinh doanh.
2. Khung ứng dụng mới (4 mục + thanh trạng thái + Cài đặt).
3. Hộp nạp mô hình + tham số nạp + mặc định riêng từng mô hình.
4. Trò chuyện: preset, thanh tham số theo tab, sửa/tạo lại/rẽ nhánh, TTFT, thư mục.
5. Khám phá 2 cột + bảng lượng tử có huy hiệu vừa máy + trình quản lý tải.
6. Mô hình của tôi dạng bảng.
7. Nhà phát triển: nhật ký trực tiếp, LAN, khoá API, TTL, ví dụ chạy thử.
8. Hồi quy đầy đủ (bản Windows đóng gói, nạp nhiều cỡ GGUF, công cụ, agent, kích hoạt, cập nhật, API), rồi mới phát hành.
9. Giai đoạn sau: Kinh doanh theo mô hình Odoo (CRM, Bán hàng, Hoá đơn, Kho, Liên hệ). Đặc tả riêng ở `docs/kinh-doanh.md`.

## Ảnh hiện trạng (trước)
- `/workspace/qa-0.15.0/ui/*.png` (1280×720): trò chuyện/agent, thẻ xin phép, MCP, hiệu năng, Kho mô hình, Mô hình của tôi, bảng lệnh, phím tắt.
- Ảnh "sau" của từng bước sẽ nằm trong `/workspace/qa-<phiên bản>/parity/`.
