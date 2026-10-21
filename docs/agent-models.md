# Mô hình agent mới cho AIVN AGENT (0.16 beta.3)

Nguồn nghiên cứu: danh sách ứng viên mạnh hơn Qwen3-VL 8B (thẻ mô hình, tệp GGUF đã kiểm kích thước, llama.cpp b11751).
Mọi ước tính VRAM/tốc độ trong đó **chưa đo trên máy thật**; mô hình mới hiện ở trạng thái **“Chờ đo”**.

## Sáu mục đã sửa trong AIVN trước khi đưa mô hình mới vào danh mục
| # | Vấn đề | Đã làm |
|---|---|---|
| 1 | Holo2/Holo3.1/Holo4 trả x,y thang **0–1000** (tài liệu H Company), AIVN lại đọc như Holo1.5 (điểm ảnh) | họ định vị `holo3` = `{coords:'norm1000', align:32}`, cùng câu lệnh + lược đồ JSON `{x,y}`; Holo1.5 giữ `holo` (điểm ảnh) |
| 2 | UI-Venus-2 (Qwen3.5) bị coi như UI-Venus-Ground (Qwen2.5-VL, điểm ảnh) | họ `venus2`, tự nhận thang (0–1000 hay điểm ảnh) cho tới khi đo |
| 3 | Qwen3.5/3.6/3.8, Fara1.5, Gemma 4 rơi vào `generic` | họ riêng `qwen35` (hỏi thang 0–1000, tự nhận), `fara` (điểm ảnh, ô 32), `gemma4`; Qwen3 chỉ đọc chữ không bị nhận nhầm |
| 4 | Qwen3.5 và các bản tinh chỉnh bật suy nghĩ mặc định (llama.cpp #20837: lời gọi công cụ nằm trong khối suy nghĩ) | llama-server chạy với `--reasoning off` cho các họ đó (`src/model-launch.js`), người dùng đổi được |
| 5 | Repo GGUF chính thức của H Company đặt tên tệp chung `q4_k_m.gguf` / `mmproj.f16.gguf` → hai mô hình trùng id, khớp nhầm danh mục | tên tệp chung lưu kèm tên repo (`Holo4-35B-A3B-q4_k_m.gguf`), id và khớp danh mục theo tên lưu trên máy (`src/model-names.js`); tệp cũ vẫn nhận, không tải lại |
| 6 | Mô hình MoE (35B-A3B) trên GPU 12 GB cần để một phần chuyên gia trên CPU | llama-server b11751 mặc định `--fit on` (tự chia, phần nhìn ảnh vẫn ở GPU); thêm ô **Lớp MoE chạy trên CPU** (`--n-cpu-moe N`) trong cài đặt nạp từng mô hình. Tham số từ danh mục/cài đặt chỉ qua danh sách cho phép |

## Danh mục: 6 mô hình “Chờ đo”
Qwen3.5 2B · Holo3.1 4B (IQ4_XS) · Qwen3.5 4B · Qwen3.5 9B · Holo3.1 9B · Holo4 35B-A3B (MoE). Nhãn chỉ ở mức “Theo nhà phát triển”
(trích thẻ mô hình). Chưa được dùng cho AIVN AGENT cho tới khi **đạt Bộ đo AIVN AGENT đầy đủ trên chính máy đó** (Nhà phát triển › Bộ đo,
bộ đo nay nhận cả các mô hình này). Chưa đưa vào: UI-Venus-2 (chưa có giấy phép), Holo4-27B (CC-BY-NC), Fara1.5 (chỉ trình duyệt).

## Thang dự phòng (laptop GPU 4 GB và mọi máy)
Bộ chọn AIVN AGENT xếp: **đạt Bộ đo trên máy này** → đã kiểm chứng sẵn (Qwen3-VL) → chưa đạt bộ đo; trong mỗi bậc chạy mượt trước chạy chậm,
“Rất chậm” chỉ khi tự bật (như beta.2). Ứng viên cho laptop 4 GB theo thứ tự: Qwen3.5 2B → Holo3.1 4B → Qwen3.5 4B → Qwen3-VL 4B (Chạy chậm) → Qwen3-VL 8B (Rất chậm, tự bật).

## Số đo đầu tiên (máy thử AIVN, CPU 4 luồng, không GPU, 2026-10-22)
Bài đo định vị AIVN Bench (10 phần tử, ảnh cửa sổ thật):
| Mô hình | Họ | Điểm định vị | Thời gian | Ghi chú |
|---|---|---|---|---|
| Qwen3.5 2B Q4_K_M + mmproj F16 | `qwen35` | **1/10** | 186 s | hộp lệch ở cả hai cách đọc thang → chưa kết luận được thang toạ độ; quá yếu để định vị ở cỡ 2B |
| Holo3.1 4B IQ4_XS + mmproj Q8_0 | `holo3` | **4/10** | 203 s | cùng câu trả lời, đọc theo cách cũ (điểm ảnh, họ `holo`) chỉ **1/10** → xác nhận mục 1; các lần trượt lệch ~10 px |

Cả hai chưa đạt ngưỡng 6/10 trên CPU; trên GPU thật của Khôi (Vulkan/CUDA, lượng tử cao hơn) phải đo lại bằng Bộ đo AIVN AGENT.
Bộ chọn chỉ dùng chúng khi đạt bộ đo trên chính máy đó, nên kết quả này không làm thay đổi mô hình đang dùng.
