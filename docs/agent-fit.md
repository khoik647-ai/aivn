# Mô hình nào chạy được AIVN AGENT trên máy này (0.16, QA lượt 2 – B17)

Một cách tính duy nhất (`src/agent-plan.js` + `src/agent-eligibility.js`) dùng chung cho: gợi ý ⭐ và nhãn của thẻ trong **Khám phá**, nhóm Chạy mượt / Chạy chậm / Không chạy được, bộ chọn mô hình ở chế độ AIVN AGENT, cổng AIVN AGENT (thanh cảnh báo) và việc AIVN AGENT chạy theo **Lịch tự động**. Vì vậy ⭐ không bao giờ trỏ tới mô hình mà cổng lại chặn.

## Điều kiện để một mô hình dùng được cho AIVN AGENT
1. Nhìn được ảnh (có tệp mmproj) – AIVN AGENT phải nhìn màn hình.
2. Gọi công cụ được (theo nhà phát triển hoặc AIVN đã kiểm chứng).
3. Điểm định vị (grounding) ≥ 6/10 trên bộ thử của AIVN.
4. Vừa máy ở **ngữ cảnh của AIVN AGENT** (xem dưới), tốc độ ước tính ≥ 5 token/giây.

## Quyết định cho máy yếu (laptop GPU 4 GB)
| Tình huống | Ngữ cảnh AGENT | Mô hình được chọn |
|---|---|---|
| Có mô hình AGENT nằm trọn VRAM ở 16K (máy mạnh, vd. RTX 4070 Super 12 GB) | 16K | Chỉ mô hình **Chạy mượt** |
| Không có ở 16K nhưng có ở 12K (vd. RTX 3050 Ti 4 GB) | **12K** (lịch sử + ảnh được tự thu gọn) | Chạy mượt, **và** mô hình tràn ít (≤ 1 GB sang RAM, ≥ 5 token/giây) dưới nhãn **Chạy chậm** kèm cảnh báo |
| Không có kể cả ở 12K (vd. GPU 2 GB) | 12K | Mọi mô hình Chạy chậm đủ nhanh (≥ 5 token/giây), kèm cảnh báo |

Lý do chọn hạ ngữ cảnh thay vì chỉ cho tràn: tràn VRAM sang RAM làm mỗi bước điều khiển máy chậm hẳn (10–30 giây), còn 12K vẫn đủ cho việc nhiều bước vì AIVN tự thu gọn lịch sử và ảnh màn hình cũ.

Đã thử với phần cứng giả lập (`AIVN_QA_FAKEHW`):
- RTX 4070 Super 12 GB / 32 GB RAM → 16K, ⭐ Qwen3-VL 8B.
- RTX 3050 Ti 4 GB / 16 GB RAM → 12K, ⭐ Qwen3-VL 2B Q8_0 (Chạy mượt, ~67 token/giây); Qwen3-VL 4B chọn được dưới nhãn Chạy chậm (tràn ~0,7 GB).
- GPU 2 GB → 12K, Qwen3-VL 4B Chạy chậm.

## Khi mô hình đang chọn không đạt
Thanh AIVN AGENT nêu lý do và có nút **Đổi sang** (mô hình đã tải) hoặc **Tải về** (mô hình gợi ý) cho mô hình chạy mượt trên máy này. Lời chào của AIVN AGENT chỉ nhắc tới đọc ảnh và điều khiển màn hình khi mô hình đang nạp nhìn được ảnh.
