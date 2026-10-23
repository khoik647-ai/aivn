# Thuật ngữ room và dự án

Bảng ngắn cho tin trong room. Thuật ngữ giao diện (vi / en / zh) nằm ở [`docs/glossary.md`](glossary.md).

## Trong room

| Thuật ngữ | Nghĩa |
|---|---|
| `ĐẠT <PR> <sha>` | PR đạt ở đúng commit đó. |
| `CHƯA ĐẠT <PR> <sha>` | PR chưa đạt ở đúng commit đó. |
| `M1`, `M2`, … | Lỗi phải sửa trước khi merge. |
| `N1`, `N2`, … | Góp ý, không bắt buộc trước khi merge. |
| `HEAD MỚI <PR> <sha>` | PR có HEAD mới; sha là commit đầu đó. |
| `CHỜ LAPTOP` | Cần test trên laptop Windows thật. |
| `CHẶN: <lý do>` | Đang bị chặn; lý do ghi ngay sau dấu hai chấm. |
| `ĐÃ MERGE <PR> -> <sha>` | PR đã merge; sha là commit trên nhánh đích. |

## Trong dự án

| Thuật ngữ | Nghĩa |
|---|---|
| `wip-0.16` | Nhánh làm việc của bản 0.16; PR của bot mở vào nhánh này. |
| `main` | Nhánh chỉ chứa bản release đã phát hành. |
| Mã máy | Machine ID, 10 ký tự (ví dụ `AB12C-DE34F`): băm ổn định của ID máy, dùng để tạo mã kích hoạt (`src/license.js`). |
| mã kích hoạt / activation key | Chuỗi Base32 có chữ ký Ed25519, gắn với một Mã máy (`src/license.js`). |
| `revoked.json` | Danh sách mã kích hoạt đã thu hồi, có chữ ký Ed25519 của khoá cũ; tệp đóng băng, không ký lại (`site/revoked.json`, `src/license.js`). |
| `revoked-v2.json` | Danh sách thu hồi bản mới mà app mới đọc và đăng; không ghi đè `revoked.json` (`src/gate.js`, `src/admin.js`). |
| `admin.cjs publish` | Lệnh bot không được chạy. Repo không có tệp `admin.cjs`; đăng danh sách là `publish()` trong `src/admin.js`, ghi `revoked-v2.json` lên `gh-pages`. |
| JIT | Mô hình nạp tạm khi API gọi một mô hình chưa nạp (`ensureModel` trong `src/main.js`). |
| TTL | Số phút (`apiTtlMin`) rồi mô hình JIT tự gỡ khi không còn lượt dùng (`src/main.js`). |
| GGUF | Định dạng tệp mô hình; AIVN chỉ đọc siêu dữ liệu ở đầu tệp (`src/gguf.js`). |
| llama.cpp / llama-server | Bộ máy suy luận: chữ qua node-llama-cpp (`src/engine.js`); nhìn ảnh và embeddings qua tiến trình `llama-server` (`src/vision-server.js`, `src/embed-server.js`). |
| ngl | Cờ `-ngl` của llama-server: số lớp mô hình đưa lên GPU (`src/embed-server.js`, `src/vision-server.js`). |
| VRAM | Bộ nhớ GPU; AIVN đo phần trống để chọn `-ngl` và ước lượng vừa máy. |
| Kinh doanh | Module bán hàng, kho, hoá đơn và báo cáo, đối chiếu Odoo (`src/crm/`, `src/renderer/biz.js`). |
| AGENT | AIVN AGENT điều khiển máy: xem màn hình, bấm, gõ, kiểm tra đã gửi (`src/desktop-agent.js`, `src/agent/`). |
| B-number | Mã lỗi hoặc việc QA dạng `B219`, ghi trong chú thích và tên test (ví dụ `test/v016-b219.test.js`). |
| full suite | Cả bộ `node --test test/` (`release.sh` gọi `node --test --test-concurrency=1 test/*.test.js`); không chạy cùng lúc với bot khác. |
| Electron/Xvfb test | Test giao diện thật bằng Electron trên Xvfb; tự bỏ qua nếu thiếu electron hoặc xvfb (ví dụ `test/v016-biz.test.js`, `test/v016-b97.test.js`). |
| `gh-pages` | Nhánh GitHub Pages; nguồn trang trong `site/`; `revoked.json` công khai cũng nằm trên nhánh này. |
