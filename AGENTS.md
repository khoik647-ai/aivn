# Quy tắc làm việc cho bot AIVN

Dành cho bot trên kho `khoik647-ai/aivn`. Thuật ngữ trong room: [`docs/room-terms.md`](docs/room-terms.md).

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

Mọi PR đụng `src/license.js`, `src/gate.js`, `src/applock.js`, `src/admin.js`, `revoked.json` (kể cả `site/revoked.json`), `release.sh` hoặc `src/agent/send-verify.js` phải được Bot Kiểm Tra AIVN Trưởng duyệt bảo mật trước khi merge. Cùng mức bắt buộc với hàng rào ảnh chụp bước trong `src/desktop-agent.js` (PR #89: không giữ ảnh bước nếu lộ tệp mã kích hoạt). PR đó đặt logic kèm ở `src/agent/shot-guard.js`. PR nào đụng hàng rào này cũng phải được Trưởng duyệt bảo mật trước khi merge.

## Phân vùng sở hữu

Bot không sửa vùng của bot khác. Cần sửa ở vùng đó thì chuyển cho bot sở hữu. Đường dẫn dưới đây là những tệp đang có trong cây.

- **AIVN Kinh doanh** — module bán hàng, kho, hoá đơn, báo cáo, đối chiếu Odoo. Vùng: `src/crm/` (`biz.js`, `crm.js`, `db.js`, `sheet.js`, `text.js`), `src/renderer/biz.js`, `test/v016-biz.test.js`. Cùng vùng: `test/v016-receivable-51.test.js`, `test/v016-render-race-74.test.js`, `test/v016-adv90-acct.test.js`, `test/v016-adv90-race.test.js`, `test/v016-adv90-harness.js`.
- **AIVN Agent** — AGENT điều khiển máy. Vùng: `src/desktop-agent.js`, `src/agent/` (gồm `agent.js`, `send-verify.js`), nhóm chuỗi `src/i18n/strings-agent.json`. `src/main.js` không thuộc Agent. Test AGENT trong mẫu `test/v016-b1*` và `test/v016-b2*` (chỉ tệp của AGENT): `test/v016-b21.test.js`, `test/v016-b101.test.js`, `test/v016-b101-electron.test.js`, `test/v016-b108-electron.test.js`, `test/v016-b153-b158.test.js`, `test/v016-b169.test.js`, `test/v016-b171.test.js`, `test/v016-b172.test.js`, `test/v016-b177.test.js`, `test/v016-b178.test.js`, `test/v016-b182.test.js`, `test/v016-b219*.test.js`. Tệp lẫn: `test/v016-b159-b162.test.js` (phần AGENT là B159–B161 và hồ sơ trình duyệt; phần trang B145/B162 thuộc Web), `test/v016-b164-b171.test.js` (phần hành vi AGENT thuộc Agent; phần GPU, VRAM, llama-server, runtime thuộc Lõi App). Cùng mẫu tên nhưng không thuộc Agent: `test/v016-b10-embeddings.test.js`, `test/v016-b151.test.js`, `test/v016-b163-catalog-e2e.test.js`, `test/v016-b173.test.js`, `test/v016-b174.test.js`, `test/v016-b175.test.js`, `test/v016-b176.test.js`, `test/v016-b183.test.js`, `test/v016-b185.test.js`, `test/v016-b186.test.js`, `test/v016-b216-fit.test.js`, `test/v016-b216-fit-adv.test.js`, `test/v016-b218.test.js`.
- **AIVN Lõi App** — lõi app. `src/agent/`, `src/crm/`, `site/` không thuộc Lõi App. `src/main.js` thuộc Lõi App, trừ IPC của module khác.
  - Bộ máy và llama.cpp: `src/main.js`, `src/engine.js`, `src/engine-host.js`, `src/engine-proxy.js`, `src/runtimes.js`, `src/model-launch.js`.
  - Mô hình và JIT: `src/downloader.js`, `src/hf.js`, `src/catalog.js`, `src/catalog-claims.js`, `src/models-dir.js`, `src/gguf.js`, `src/model-names.js`, `src/presets.js`, `src/recommend.js`.
  - GPU và vừa máy: `src/fit.js`, `src/chatfit.js`, `src/gpu-pick.js`, `src/perf.js`, `src/load-notice.js`. Không có tệp `*vram*` riêng.
  - API cổng 1234: `src/server.js`, `src/embed-server.js`, `src/vision-server.js`.
  - Kích hoạt và cập nhật: `src/license.js`, `src/gate.js`, `src/applock.js`, `src/admin.js`, `src/updater.js`, `build/`. `release.sh` dùng chung, xem dưới.
- **AIVN Web và Thiết kế** — trang `site/` (trừ `site/revoked.json`: không ai sửa tay), script kiểm trang `tools/site_check.py` và `tools/site_drift.py`, nhánh `gh-pages`, repo `khoik647-ai/aivn-prototype`. Bot này viết spec UI cho app; code app do bot sở hữu module đó sửa.
- **`release.sh` dùng chung.** Đoạn chép `site/` lên trang `gh-pages` (khoảng bước «Tạo trang web (GitHub Pages)», gồm lệnh `dirname` khi chép ảnh) thuộc Web và Thiết kế. Phần còn lại thuộc Lõi App. Ai sửa phần của chủ kia phải báo trong room trước.
- **Bot Kiểm Tra AIVN Trưởng** — duyệt code và test của PR; duyệt bảo mật các PR ở mục Bảo mật.
- **Bot AIVN Kiểm Tra Phụ** — test giao diện trên laptop Windows thật.
- **Quản Lý** — điều phối, bảng Notion Tasks, và merge.

## Quy trình task

Nhận task từ bảng Notion Tasks hoặc từ Quản Lý. Claim: Bot = mình, Status = In progress. Đặt Done chỉ sau khi duyệt đạt. Vướng thì Status = Blocked và ghi câu hỏi ở Note. Kiểm tra trên máy mình hoặc cloud agent trước. Chỉ ghi `CHỜ LAPTOP` khi cần phần cứng thật.

## Bốn luật (Khôi duyệt, áp dụng ngay)

1. **TEST ĐỎ TRƯỚC.** Mỗi bản sửa lỗi có test tái hiện đúng lỗi: test đỏ trên code cũ, rồi mới sửa cho xanh. Mô tả PR ghi tên test và kết quả đỏ (base) / xanh (head). Trưởng trả về PR thiếu phần này.
2. **HỎI KỸ TRƯỚC KHI LÀM.** Trước khi code việc mới hoặc tính năng, gửi Quản Lý một loạt câu hỏi làm rõ (phạm vi, việc không làm, cách kiểm tra), gộp một lần. Sửa theo review thì không cần hỏi lại.
3. **THUẬT NGỮ CHUNG** trong room, xem `docs/room-terms.md`. Tin ngắn. Không nhắc lại nội dung cũ.
4. **HỌC ĐỐI THỦ.** Khi làm tính năng mới, sau khi Khôi cho phép: mổ xẻ cách LM Studio, Ollama, Jan và sản phẩm cùng loại làm, từ tài liệu và code công khai, rồi ghi nguồn làm bằng chứng. Chỉ học ý tưởng. Không chép code. Tôn trọng license.
