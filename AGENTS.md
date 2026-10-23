# Quy tắc làm việc cho bot AIVN

Dành cho bot trên kho `khoik647-ai/aivn`. Thuật ngữ trong room: [`docs/GLOSSARY.md`](docs/GLOSSARY.md).

## Nhánh

Làm việc trên `wip-0.16`. `main` chỉ chứa bản release. Mỗi bot làm trên nhánh riêng tách từ `wip-0.16`, rồi mở PR vào `wip-0.16`.

## Merge và release

Chỉ Khôi hoặc Quản Lý được merge và release. Bot khác không merge, không release. Bot Kiểm Tra AIVN Trưởng duyệt PR.

## Cập nhật nhánh

Chỉ merge thường và push thường. Không rebase PR đã đẩy. Không force-push. Không amend commit đã đẩy.

## Test

Mỗi PR chỉ chạy test của chính PR đó. Không chạy test nặng (full suite, Electron) cùng lúc với bot khác.

## Bảo mật

Không chạy `admin.cjs publish`. Không ký lại `revoked.json`, kể cả bằng khoá mới. Không in, log, chụp màn hình hay commit secret, admin key, hoặc mã kích hoạt (ví dụ tệp `activation.txt` trên laptop test). Muốn kích hoạt bản cài mới: gửi Mã máy cho Quản Lý. Không tự tạo key. Không vượt màn hình kích hoạt.

## Phân vùng sở hữu

Bot không sửa vùng của bot khác. Cần sửa ở vùng đó thì chuyển cho bot sở hữu.

- **AIVN Kinh doanh** — module bán hàng, kho, hoá đơn, báo cáo, đối chiếu Odoo. Vùng: `src/crm/` (`biz.js`, `crm.js`, `db.js`, `sheet.js`, `text.js`), `src/renderer/biz.js`, `test/v016-biz.test.js`. Cùng vùng: `test/v016-receivable-51.test.js`, `test/v016-render-race-74.test.js`, `test/v016-adv90-acct.test.js`, `test/v016-adv90-race.test.js`, `test/v016-adv90-harness.js`.
- **AIVN Agent** — AGENT điều khiển máy: bước, gõ vào tài liệu và ô soạn, giao diện việc, ảnh chụp bước. Vùng: `src/desktop-agent.js`, `src/agent/` (gồm `send-verify.js`), `src/screen-control.js`, `src/qa-runner.js` (cờ `--shots` ghi ảnh từng bước).
- **AIVN Lõi App** — lõi app. Vùng: tiến trình chính `src/main.js`; bộ máy và nạp mô hình `src/engine.js`, `src/engine-host.js`, `src/engine-proxy.js`, `src/model-launch.js`, `src/gguf.js`; `llama-server` ở `src/vision-server.js` và `src/embed-server.js`; máy chủ API `src/server.js`; kích hoạt và cập nhật `src/license.js`, `src/gate.js`, `src/admin.js`, `src/updater.js`. `site/revoked.json` đóng băng: không sửa, không ký lại.
- **AIVN Web và Thiết kế** — trang web: nguồn `site/`, nhánh `gh-pages`, `tools/publish-beta-site.sh`. Spec UI/UX: `docs/design/` (ví dụ `docs/design/F-PLUGINS.md`). Prototype nằm ở repo `khoik647-ai/aivn-prototype`.
- **Bot Kiểm Tra AIVN Trưởng** — duyệt code và test của PR.
- **Bot AIVN Kiểm Tra Phụ** — test giao diện trên laptop Windows thật.
- **Quản Lý** — điều phối, bảng Notion Tasks, và merge.

## Quy trình task

Nhận task từ bảng Notion Tasks hoặc từ Quản Lý. Claim: Bot = mình, Status = In progress. Đặt Done chỉ sau khi duyệt đạt. Vướng thì Status = Blocked và ghi câu hỏi ở Note. Kiểm tra trên máy mình hoặc cloud agent trước. Chỉ ghi `CHỜ LAPTOP` khi cần phần cứng thật.

## Bốn luật (Khôi duyệt, áp dụng ngay)

1. **TEST ĐỎ TRƯỚC.** Mỗi bản sửa lỗi có test tái hiện đúng lỗi: test đỏ trên code cũ, rồi mới sửa cho xanh. Mô tả PR ghi tên test và kết quả đỏ (base) / xanh (head). Trưởng trả về PR thiếu phần này.
2. **HỎI KỸ TRƯỚC KHI LÀM.** Trước khi code việc mới hoặc tính năng, gửi Quản Lý một loạt câu hỏi làm rõ (phạm vi, việc không làm, cách kiểm tra), gộp một lần. Sửa theo review thì không cần hỏi lại.
3. **THUẬT NGỮ CHUNG** trong room, xem `docs/GLOSSARY.md`. Tin ngắn. Không nhắc lại nội dung cũ.
4. **HỌC ĐỐI THỦ.** Khi làm tính năng mới, sau khi Khôi cho phép: mổ xẻ cách LM Studio, Ollama, Jan và sản phẩm cùng loại làm, từ tài liệu và code công khai, rồi ghi nguồn làm bằng chứng. Chỉ học ý tưởng. Không chép code. Tôn trọng license.
