# Bảng thuật ngữ AIVN (vi · en · zh-CN)

Dùng cho giao diện ứng dụng, trang web, ghi chú phát hành và lời AIVN AGENT nói với người dùng. Khi thêm chuỗi mới, dùng đúng thuật ngữ ở đây; muốn đổi thuật ngữ thì sửa bảng này trước.

## Quy ước chính tả tiếng Việt

- **Đặt dấu thanh kiểu truyền thống** (khớp từ điển hunspell vi_VN và phần lớn chuỗi hiện có): *xoá, hoá, khoá, tuỳ, hoạ, thuỷ, hoà, uỷ*. Không viết *xóa, hóa, khóa, tùy, họa*.
- Chữ hoa đầu câu và đầu tên mục; tên mục giữ nguyên chữ hoa như trên thanh bên (ví dụ “Khám phá”, “Máy chủ API”).
- Số thập phân dùng dấu phẩy (0,8 GB), hàng nghìn dùng dấu chấm (1.766.000 đ). Đơn vị cách số một khoảng trắng (4 GB, 20 MB).
- Dấu ngoặc kép “…” cho tên nút/tuỳ chọn được trích; không dùng "…" thẳng trong văn bản hiển thị.
- Tên riêng giữ nguyên: **AIVN**, **AIVN AGENT**, **NGUYỄN NGỌC KHÔI SINH VIÊN VLU** (không dịch, không đổi chữ hoa).

## Quy ước tiếng Anh và tiếng Trung

- EN: American English, sentence case cho nút và tiêu đề nhỏ, Title Case chỉ cho tên mục chính (Discover, API Server). Văn phong ngắn, chủ động, không dịch từng chữ.
- ZH: Tiếng Trung giản thể (zh-CN), dấu câu toàn khổ (，。：“”), khoảng trắng giữa chữ Hán và chữ Latinh/số (“4 GB 内存”, “AIVN 会…”).

## Thuật ngữ

| Tiếng Việt | English | 中文 | Ghi chú |
|---|---|---|---|
| mô hình | model | 模型 | Không dùng “model” trong tiếng Việt |
| mô hình ngôn ngữ | language model | 语言模型 | |
| mô hình nhìn ảnh / nhìn được ảnh | vision model / sees images | 视觉模型 / 可识图 | Nhãn trong Kho: “Nhìn được ảnh” |
| mô hình chỉ có chữ | text-only model | 纯文本模型 | |
| mắt nhìn (cho Điều khiển màn hình) | eyes (grounder) | 眼睛（视觉定位模型） | Mô hình nhìn ảnh dùng để xem ảnh chụp màn hình |
| mô hình lập kế hoạch | planner model | 规划模型 | |
| mô hình định vị màn hình | grounding model | 屏幕定位模型 | |
| bộ đôi điều khiển máy | computer-control pair | 电脑控制组合 | planner + grounder |
| ngữ cảnh / độ dài ngữ cảnh | context / context length | 上下文 / 上下文长度 | Không dùng “bối cảnh” |
| nạp (mô hình) / gỡ | load / unload | 加载 / 卸载 | “Nạp” chỉ dùng cho mô hình; tệp thì “mở” |
| tải về / tải | download | 下载 | “Tải lên” = upload |
| bản lượng tử | quantization (quant) | 量化版本 | Q4_K_M giữ nguyên |
| tham số | parameters (params) | 参数 | 4B tham số |
| tệp thị giác (mmproj) | vision projector (mmproj) | 视觉投影文件（mmproj） | |
| bộ máy AI | AI engine | AI 引擎 | llama.cpp |
| tăng tốc GPU | GPU acceleration | GPU 加速 | |
| VRAM / RAM | VRAM / RAM | 显存 / 内存 | |
| Khám phá | Discover | 发现 | Tên mục (như mục Discover của LM Studio); không dùng “Kho mô hình” |
| Trò chuyện | Chat | 对话 | Tên mục |
| AIVN AGENT | AIVN AGENT | AIVN AGENT | Không dịch |
| Điều khiển màn hình | Screen control | 屏幕控制 | Tên tuỳ chọn |
| Điều khiển máy tính | Computer control | 电脑控制 | Nhãn khả năng của mô hình |
| công cụ / gọi công cụ | tool / tool calling | 工具 / 工具调用 | |
| Ghi nhớ | Memory | 记忆 | Tên mục |
| Lịch tự động | Schedules | 定时任务 | Tên mục |
| Máy chủ API | API Server | API 服务器 | Tên mục |
| lời nhắc hệ thống | system prompt | 系统提示词 | |
| nhiệt độ | temperature | 温度 | |
| suy luận | reasoning | 推理 | |
| lập trình | coding | 编程 | |
| tệp / thư mục | file / folder | 文件 / 文件夹 | Không dùng “file” trong tiếng Việt |
| thư mục được phép | allowed folder | 允许的文件夹 | |
| xoá / ghi đè | delete / overwrite | 删除 / 覆盖 | Luôn hỏi người dùng |
| Thùng rác | Trash (Recycle Bin trên Windows) | 废纸篓（Windows：回收站） | |
| đọc chữ trong ảnh (OCR) | OCR / text from images | 图片文字识别（OCR） | |
| tìm kiếm ngữ nghĩa | semantic search | 语义检索 | BGE-M3 |
| Trích từ: tệp, đoạn n | Source: file, chunk n | 出处：文件，第 n 段 | |
| cập nhật / Khởi động lại để cập nhật | update / Restart to update | 更新 / 重新启动以更新 | |
| kích hoạt / mã kích hoạt | activate / activation code | 激活 / 激活码 | |
| Hiệu ứng chuyển giao diện: Đầy đủ / Theo hệ điều hành / Tắt | Theme transition: Full / Follow system / Off | 主题切换动画：完整 / 跟随系统 / 关闭 | |
| Giao diện Sáng / Tối / Tự động | Light / Dark / Auto theme | 浅色 / 深色 / 自动 | |
| Nạp thêm mắt nhìn | Add eyes (load a vision model) | 添加“眼睛”（加载视觉模型） | Nút trên thẻ cảnh báo |
| Chạy tốt / Chạy chậm / Không đủ bộ nhớ | Runs well / Runs slowly / Not enough memory | 运行流畅 / 运行较慢 / 内存不足 | Nhãn vừa máy |

## Kiểm tra chính tả

- Tiếng Việt: `hunspell -d vi_VN`; tiếng Anh: `hunspell -d en_US`; tiếng Trung: soát thủ công (dấu câu toàn khổ, giản thể).
- Từ đúng mà từ điển không biết (tên riêng, thuật ngữ kỹ thuật) ghi vào `docs/spelling-allow.txt`, mỗi dòng một từ. Mọi lỗi còn lại phải sửa trước khi phát hành.
