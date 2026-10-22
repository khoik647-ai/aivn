# QA runner (từ 0.16.0-beta.3)

Hai chế độ chạy không người để bot QA kiểm thử AIVN trên máy thật từ PowerShell:

| Chế độ | Làm gì | Điều khiển |
|---|---|---|
| `--agent-task` | Giao một việc cho **AIVN AGENT** (đúng vòng lặp thật, mọi cổng an toàn giữ nguyên) | Màn hình / bàn phím **thật** của máy |
| `--qa-ui` | Chạy kịch bản bấm/gõ/kiểm tra **bên trong giao diện AIVN** | Chỉ cửa sổ AIVN (không giành tiêu điểm) |

## Cổng bật (cả hai chế độ)

* Chỉ chạy khi có **cả hai**: biến môi trường `AIVN_QA_MODE=1` **và** cờ `--agent-task` / `--qa-ui`.
  Thiếu một trong hai → cờ bị bỏ qua, AIVN mở bình thường và ghi cảnh báo vào `aivn.log`.
* Có `AIVN_QA_MODE=1` mà tham số sai (thiếu `--out`, kịch bản hỏng…) → **không** mở AIVN; ghi `result.json` với `status: "failed"` và lý do, thoát mã 2.
* **Không có cổng mạng nào**: không HTTP, không WebSocket, không cổng gỡ lỗi từ xa (CDP / `--remote-debugging-port`).
  Lý do: CDP không có xác thực, tiến trình nào trên máy cũng chiếm được AIVN và đọc được trò chuyện / giấy phép.
  `--qa-ui` điều khiển giao diện bằng `webContents.executeJavaScript` / `sendInputEvent` ngay trong tiến trình AIVN.
* Mỗi lần chạy là **một phiên**. Mã thoát: `0` = done · `2` = failed/blocked · `3` = asked_user · `4` = cancelled (người dùng huỷ qua `--answer`).

## Hồ sơ riêng: `--profile <thư mục>`

```powershell
--profile "$env:TEMP\aivn-qa-profile"
```

* Đặt thư mục dữ liệu (userData) **trước** khoá một-phiên-bản → là một bản AIVN **riêng**, chạy song song mà không đụng tới AIVN Khôi đang mở,
  cũng như trò chuyện, Kinh doanh, ghi nhớ và Lịch tự động thật của anh ấy.
* Dùng chung **thư mục mô hình** của hồ sơ thật (không tải lại). Hồ sơ QA **không xoá** được mô hình.
* `license.json` được **chép** từ hồ sơ thật sang (chỉ đọc, không ghi ngược) → bản QA đã kích hoạt sẵn.
* Các bước `seed`, `reset`, `setTime` **chỉ** chạy khi có `--profile` (không bao giờ ghi/xoá dữ liệu thật).
* `--qa-ui` khi AIVN của người dùng đang mở mà **không** có `--profile` → từ chối (thoát 2), không bao giờ điều khiển cửa sổ thật.
* `--agent-task` không kèm `--profile` khi AIVN đang mở → chuyển việc sang bản đang chạy rồi chờ `result.json` của đúng lượt đó.
* Hồ sơ mới dùng cài đặt **mặc định** (điều khiển màn hình *tắt*). Thêm `--agent-settings-from main` để **chép** mọi cài đặt AIVN AGENT (`agent*`:
  điều khiển máy, điều khiển màn hình, thư mục được phép, mô hình định vị…) từ hồ sơ thật sang hồ sơ QA. Hồ sơ thật chỉ được **đọc**, không ghi ngược.
  Chỉ dùng được kèm `--profile`.
* `--agent-task` mà điều khiển màn hình đang **tắt** → dừng ngay, `status: "blocked"`, lý do nêu rõ cài đặt nào đang tắt và cách bật (không chạy “què” rồi báo done).

## `--agent-task`

```powershell
$env:AIVN_QA_MODE = "1"
& "$env:LOCALAPPDATA\Programs\AIVN\AIVN.exe" --agent-task "mở Notepad và gõ: xin chào" `
    --model 4b --out C:\qa\r1\result.json --shots C:\qa\r1\shots --timeout 300 --lang vi --profile C:\qa\profile
$LASTEXITCODE   # 0 done · 2 failed/blocked · 3 asked_user · 4 cancelled
Get-Content -Encoding UTF8 C:\qa\r1\result.json | ConvertFrom-Json
```

* `--model`: id trong *Mô hình của tôi*, id danh mục, tên tệp `.gguf`, hoặc viết tắt `2b` / `4b` / `8b` (Qwen3-VL Instruct đã có trên máy).
  Tên được so sau khi chuẩn hoá (bỏ gạch nối/gạch dưới/chấm, không phân biệt hoa thường): `Qwen3VL-8B-Instruct-Q4_K_M` = `qwen3-vl-8b-instruct-q4_k_m`.
* **An toàn**: mọi thẻ xin phép (gửi, xoá, mua/thanh toán, ghi đè tệp, thao tác hệ thống do AIVN AGENT **tự** đề xuất…) đều **tự TỪ CHỐI**. Ngoại lệ duy nhất là `--approve-send-to` bên dưới (chỉ gửi vào chính mình).
* **Bước GỬI tin luôn qua thẻ** (từ beta.2.2): câu “không cần hỏi lại” trong lệnh vẫn bỏ thẻ cho các bước khác (sửa tài liệu…), nhưng **không** cho bước gửi tin;
  công tắc “Tự làm không hỏi” của hồ sơ không áp dụng trong QA.
* **Bước gửi bị từ chối** (B93): AIVN AGENT dừng lượt; `finalAnswer` nói rõ *“Mình CHƯA gửi tin “…” cho “<đúng tên trong lệnh>”: bước gửi đã bị từ chối…”*
  (không diễn đạt lại tên, không hỏi lại). `approvals[]` của thẻ gửi có `send: true`, `recipient` (tên trong lệnh), `shownChat` (tiêu đề khung chat giữa + tên trong chữ gợi ý ô soạn) và `text`.

### `--approve-send-to "<tên>"` — chỉ để thử gửi THẬT vào cuộc trò chuyện của chính mình (beta.2.2)

* Chỉ dùng kèm `AIVN_QA_MODE=1` **và** `--agent-task` (kèm `--qa-ui` / `--qa-input-diag` → cờ sai, thoát 2).
* **Chỉ** nhận tên của cuộc trò chuyện với chính mình: `Cloud của tôi` = `My Documents` = `My Cloud` = `我的文档`… (khớp cả cụm, không phân biệt hoa thường/dấu).
  Tên khác (người, nhóm, “Cloud”, “My Documents 2”…) → **từ chối chạy**: ghi lý do vào stderr, `aivn.log` và `result.json`, **thoát mã 2**.
* Tự cho phép **đúng một** bước gửi, và chỉ khi: thẻ là bước GỬI của lớp phủ màn hình, người nhận trong lệnh là cuộc trò chuyện của chính mình, lệnh không có
  “chỉ soạn / đừng gửi”, và màn hình cho thấy đúng cuộc trò chuyện đó (B97 — cùng cách đọc + làm sạch tiêu đề với cổng người nhận B90):
  * **tiêu đề khung chat giữa** (đã bỏ ký tự lẻ đầu dòng do OCR biểu tượng như “Q My Documents”, dòng phụ “Lưu và đồng bộ…”, giờ “2158”/“21:58”) là cuộc trò chuyện của chính mình; **hoặc**
  * trong **cùng lượt**, cổng người nhận đã chốt đúng người nhận này **và** chữ gợi ý ô soạn (“Nhập @, tin nhắn tới My Documents”) đã khớp tên của chính mình,
    đồng thời màn hình lúc đó không cho thấy cuộc trò chuyện khác (ô soạn ghi người khác, hoặc tiêu đề đọc được mà không phải mình → từ chối).
  * Tiêu đề chỉ đọc được giờ (`["2158"]`) **không bao giờ** tự nó cho qua.

  Mọi thẻ khác (gửi lần hai, xoá, thẻ ngoài lớp phủ…) vẫn bị từ chối. Khi bị từ chối, `result.json` → `reason` ghi đúng lý do của kiểm tra này (B99).
  Mỗi quyết định có một dòng `--approve-send-to: CHO PHÉP …` / `KHÔNG cho phép — <lý do>` trong nhật ký. `result.json` có `approvedSends`, `approveSendTo`.

```powershell
$env:AIVN_QA_MODE = "1"
& "$env:LOCALAPPDATA\Programs\AIVN\AIVN.exe" --agent-task 'gửi tin "AIVN test beta.2.2 - bỏ qua" cho Cloud của tôi trên Zalo' `
    --approve-send-to "My Documents" --model 8b --profile D:\AIVN-QA\beta2.2\profile --agent-settings-from main `
    --out D:\AIVN-QA\beta2.2\self-send\result.json --shots D:\AIVN-QA\beta2.2\self-send\shots --timeout 300 --lang vi
$LASTEXITCODE   # 0 = đã gửi và kiểm chứng trên màn hình
```

### `--answer "<câu trả lời>"` — trả lời câu hỏi của AIVN AGENT (B75)

Khi lượt đầu kết thúc bằng một câu hỏi (`asked_user`, vd. “Gửi cho ai?”), bộ chạy trả lời **một lần** bằng câu này (cùng cuộc trò chuyện) rồi để AIVN AGENT làm tiếp
với **cùng luật xin phép**. `result.json` có `firstTurn` (câu hỏi), `answer`, và kết quả của lượt sau. Lượt đầu không hỏi → cờ không được dùng.

Trả lời huỷ (“không”, “thôi, huỷ đi”, “no”, “cancel”, “取消”, “đừng gửi”…) → AIVN AGENT không làm gì; `result.json` có `status: "cancelled"` và **mã thoát 4** (B98).

```powershell
AIVN.exe --agent-task "nhắn giúp mình là mai 8h họp nhé" --answer "Cloud của tôi" --model 8b --out C:\qa\b75\result.json --profile C:\qa\profile --agent-settings-from main
```
* **Lệnh hệ thống người dùng nêu rõ** (quyết định sản phẩm B1/B44): câu chỉ là một lệnh rõ ràng như “tăng âm lượng thêm 10%”, “đặt âm lượng 30%”,
  “khoá màn hình” → làm **ngay, không có thẻ**, không qua mô hình (đường tắt). Chỉ khi AIVN AGENT **tự** muốn đổi âm lượng/khoá máy (người dùng không yêu cầu)
  thì mới có thẻ (và trong QA bị tự từ chối). Đường tắt vẫn ghi bước vào `steps[]` (`tool: "system_action"`, `auto: true`, ảnh chụp nếu có `--shots`).
  “thêm/bớt N%”, “by N%” = **đổi tương đối** (đọc mức hiện tại rồi đặt đúng mức mới qua Core Audio, kết quả “Âm lượng 40% → 50% (+10%)”);
  “lên/về/thành/mức N”, “to N” = **đặt mức** N.
  Nếu lệnh có câu “chỉ soạn / đừng gửi / draft only / 只起草”, lời từ chối kèm lý do “Chỉ soạn sẵn, đừng gửi” để AIVN AGENT dừng đúng trước bước gửi.
  Thẻ bị từ chối khi lệnh **không** có câu đó → `status: "blocked"`.
* `--agent-task` điều khiển **màn hình thật** (chuột, bàn phím, cửa sổ) nên **có** giành tiêu điểm. Đừng chạy khi người dùng đang làm việc trên máy.
* **`status` không bao giờ mặc định là `done`**: chỉ `done` khi AIVN AGENT báo xong, câu trả lời cuối **không** nói “chưa làm được / không thể / cannot / 无法…”,
  và với việc **gửi tin** (không phải “chỉ soạn”) thì phải có ít nhất một bước đã **kiểm chứng gửi** trên màn hình (`verification.sent`). Còn lại → `failed` kèm lý do.

`result.json`:

```jsonc
{
  "schema": 1, "runId": "…", "version": "0.16.0-beta.3", "commit": "abc1234",
  "task": "…", "lang": "vi",
  "model": { "id": "…", "file": "….gguf", "mode": "gpu", "contextSize": 16384, "gpuLayers": 37, "totalLayers": 37 },
  "screen": { "platform": "win32", "displays": [{ "bounds": {…}, "scaleFactor": 1.25, "dpi": 120, "size": {…}, "primary": true }] },
  "status": "done | failed | blocked | asked_user | cancelled",
  "reason": "…", "question": "Gửi cho ai?",
  "finalAnswer": "…", "warning": null,
  "approvals": [{ "kind": "desk|approve|confirm|screen", "title": "…", "tool": "…", "send": true, "recipient": "Cloud của tôi", "shownChat": { "header": ["My Documents"], "composer": "My Documents" }, "text": "…", "answer": "denied | allowed (--approve-send-to “My Documents”)" }],
  "approvedSends": 0, "approveSendTo": null, "firstTurn": null, "answer": null,
  "steps": [{
    "n": 1, "tool": "screen_act", "args": {…}, "status": "ok", "summary": "…",
    "verification": {…}, "durationMs": 812,
    "debug": ["… bấm tại (812,440) …", "… VK 0x5B scan … flags …"],
    "shot": "C:\\qa\\r1\\shots\\step-01-screen_act.jpg"
  }],
  "timings": { "startedAt": "…", "modelLoadMs": 0, "agentMs": 41000, "totalMs": 42000 },
  "log": ["… các dòng aivn.log trong lúc chạy …"],
  "exitCode": 0
}
```

### Ví dụ: kịch bản chuẩn

```powershell
# A) Tra cứu trên Chrome — trả lời kèm URL nguồn
AIVN.exe --agent-task "mở Chrome, tìm 'giá vàng SJC hôm nay', mở kết quả đầu tiên và cho mình biết giá mua vào, kèm đường dẫn nguồn" --model 8b --out C:\qa\chrome\result.json --shots C:\qa\chrome\shots

# B) Google Docs (tài liệu nháp Khôi tạo sẵn) — sửa cần xin phép → ở chế độ QA sẽ "blocked"; thêm câu "không cần hỏi lại" để chạy hết (không áp dụng cho bước gửi tin)
AIVN.exe --agent-task "trong Google Docs 'QA nháp', thay tất cả 'ngày mai' bằng 'thứ Hai', không cần hỏi lại" --model 8b --out C:\qa\docs\result.json --shots C:\qa\docs\shots

# C) Soạn tin nhưng không gửi (lời từ chối mang lý do "chỉ soạn")
AIVN.exe --agent-task "mở Zalo, soạn tin cho Lan: mai họp lúc 9 giờ, chỉ soạn đừng gửi" --model 8b --out C:\qa\zalo\result.json
```

### `ensure_app` — bước chuẩn bị ứng dụng (chạy bằng mã, trước mô hình)

Khôi **không cần mở sẵn gì**. Khi câu lệnh nhắc tới một ứng dụng (“nhắn Zalo cho …”, “mở Chrome, …”, “trong Google Docs …”, “soạn thư trên Gmail …”)
và điều khiển màn hình đang bật, AIVN chạy bước `ensure_app` **trước khi mô hình làm gì** (và trước mỗi `open_chat`), rồi ghi bước đó vào
`result.json` (`tool: "ensure_app"`, `auto: true`). Thứ tự xử lý:

| Trạng thái ứng dụng | AIVN làm | `how` |
|---|---|---|
| Đã ở trước | không bấm gì, chỉ chờ sẵn sàng | `already` |
| Thu nhỏ | `ShowWindow(SW_RESTORE)` + `SetForegroundWindow` (Windows chặn thì `AttachThreadInput`, rồi mẹo phím Alt) | `restored` |
| Bị cửa sổ khác che | đưa lên trước như trên, nhật ký ghi % bị che | `raised` |
| Chỉ còn biểu tượng ở khay | chạy lại `.exe` của tiến trình (ứng dụng một-phiên-bản tự hiện cửa sổ) → không được thì bấm biểu tượng khay qua UI Automation (cả “Hiện biểu tượng ẩn”) → cuối cùng `ShowWindow` cửa sổ ẩn | `tray` |
| Chưa mở | mở bằng chuỗi tìm của `open_app` (lối tắt Start Menu, `shell:AppsFolder`/AUMID, App Paths, thư mục cài, Desktop); **nhớ cách mở thành công** theo từng ứng dụng (`%APPDATA%\AIVN\app-launch-cache.json`) | `launched` |
| Ứng dụng web (Gmail, Google Docs/Sheets/Drive…) | thẻ đã mở → đưa lên; chưa có → bảo đảm Chrome rồi mở địa chỉ | `web` |

**Sẵn sàng** = cửa sổ chính hiện, không “Not Responding” (`IsHungAppWindow`), cây giao diện/OCR **giống nhau 2 lần nhìn liên tiếp**. Hết hạn (45 giây)
→ dừng với lỗi rõ (`code`: `timeout` / `hung` / `tray` / `not-found`), `status: "failed"`. **Màn hình đăng nhập** (Google “Sign in/Đăng nhập”, “Chọn tài khoản”,
Zalo “Quét mã QR”…) → **dừng và hỏi** người dùng (`outcome: "asked_user"`, `asked: "login"`), không bao giờ tự gõ tài khoản/mật khẩu.
`not-found` không dừng hẳn: mô hình được thử cách khác (bấm Start rồi gõ tên…).

```powershell
# Đóng hẳn Zalo (hoặc thu nhỏ / để Zalo nằm ở khay / che bằng cửa sổ khác) rồi chạy:
AIVN.exe --agent-task "nhắn Zalo cho Cloud của tôi: test ensure_app, không cần hỏi lại" --model 4b --profile C:\qa\profile --agent-settings-from main --out C:\qa\ensure\result.json --shots C:\qa\ensure\shots
(Get-Content C:\qa\ensure\result.json -Raw | ConvertFrom-Json).steps | Where-Object tool -eq 'ensure_app' | Format-List summary, status, ms
# Chrome đóng, Gmail chưa đăng nhập → mong đợi asked_user (hỏi đăng nhập), không gõ gì
AIVN.exe --agent-task "soạn thư trên Gmail gửi lan@example.com: báo cáo tuần, chỉ soạn đừng gửi" --model 4b --out C:\qa\gmail\result.json
```
Nhật ký: các dòng `ensure_app <ứng dụng>: …` trong `%APPDATA%\AIVN\logs\aivn.log` (từng bước + thời gian).

## `--qa-ui`

```powershell
$env:AIVN_QA_MODE = "1"
AIVN.exe --qa-ui C:\qa\ui\models.json --out C:\qa\ui\result.json --shots C:\qa\ui\shots --profile C:\qa\profile
```

* Cửa sổ mở bằng `showInactive` và không lệnh nào trong phiên giành được tiêu điểm (`show`/`focus` bị vô hiệu): Khôi vẫn làm việc bình thường.
* Hộp thoại hệ điều hành **không bao giờ hiện**: mở tệp lấy đường dẫn từ `setFiles`, lưu tệp → `shots/downloads/`, hộp thông báo theo `dialog`.
  `alert` / `confirm` / `prompt` của trang cũng theo `dialog` (mặc định: dismiss).

### Kịch bản

```jsonc
{ "name": "…", "size": [1280, 820], "onError": "stop", "steps": [ { "goto": "chat" }, { "click": "send-btn" } ] }
```

Mỗi bước có **một** hành động. Dạng viết tắt: `{ "type": ["input", "xin chào"] }`, `{ "click": { "testid": "x", "timeout": 3000, "force": true } }`,
hoặc dạng đầy đủ `{ "do": "type", "testid": "input", "text": "xin chào" }`. Thêm `"onError": "continue"` vào một bước để chạy tiếp khi bước đó hỏng (vẫn tính là hỏng); `"optional": true` = bước tuỳ chọn, hỏng thì bỏ qua và **không** tính là hỏng (ví dụ đóng màn hình chào lần đầu).
Đường dẫn trong `seed` / `setFiles` tính theo thư mục chứa kịch bản.

| Bước | Tham số | Ghi chú |
|---|---|---|
| `goto` | `page` | `chat`, `agent`, `models`, `discover`, `settings[/<tab>]`, `biz/<phân hệ>` (`dash`, `contacts`, `leads`, `acts`, `sales`, `stock`, `invoices`, `reports`), `schedule`, `memory`, `server` |
| `click` / `dblclick` / `rightclick` / `hover` | `testid` | Bấm thật (`sendInputEvent`) vào giữa phần tử; **hỏng** nếu phần tử bị che (ghi tên phần tử che), bị tắt hoặc không hiện. `force: true` bỏ qua kiểm tra bị che |
| `type` | `testid`, `text`, `clear` | Đưa con trỏ vào ô, chọn hết chữ cũ (trừ khi `clear: false`), gõ |
| `press` | `key` | `Enter`, `Escape`, `Ctrl+K`, `Ctrl+Shift+P`… |
| `select` | `testid`, `value` | Theo value hoặc chữ hiện của lựa chọn |
| `scroll` | `target` | testid hoặc số điểm ảnh `y` |
| `drag` | `from`, `to` | Kéo thả HTML5 nếu phần tử `draggable`, nếu không thì kéo bằng chuột |
| `setFiles` | `testid`, `paths` | `<input type=file>`: gán tệp trực tiếp; nút khác: lần hộp thoại mở tệp kế tiếp nhận các tệp này rồi bấm nút |
| `dialog` | `answer` | `accept` / `dismiss` cho hộp thoại kế tiếp (hệ điều hành hoặc trang) |
| `wait` | `target` | số ms, hoặc testid (chờ hiện) |
| `waitFor` | `testid`, `timeout` | Chờ hiện (mặc định 10 giây) |
| `waitIdle` | `timeout` | Chờ hết tạo câu trả lời (Chat/AGENT), mặc định 120 giây |
| `expect` | `testid`, `is: { text, visible, count }` | `text` là chuỗi con, hoặc `/biểu thức/cờ` (cờ `gimsuy`; đường dẫn như `/tmp/a` vẫn là chuỗi con) |
| `expectText` / `expectCount` / `expectVisible` / `expectHidden` | `testid` (+ `text` / `count`) | Tự thử lại tới `timeout` |
| `readText` / `readValue` | `testid`, `as` | Ghi vào `reads` trong kết quả |
| `screenshot` | `name` | PNG trong `--shots`; kiểm luôn lỗi dịch của màn hình lúc đó |
| `setLang` | `lang` | `vi` / `en` / `zh` |
| `setTheme` | `theme` | `light` / `dark` / `system` |
| `resize` | `w`, `h` | Kích thước vùng nội dung cửa sổ |
| `seed` | `fixture` | JSON: `settings`, `convos`, `memories`, `schedules`, `biz` (`[{ "fn": "addContact", "args": [{…}] }]`). Chỉ với `--profile` |
| `reset` | – | Xoá trò chuyện, ghi nhớ, Lịch tự động của hồ sơ QA. Muốn Kinh doanh sạch hẳn: dùng thư mục `--profile` mới |
| `download` | `testid`, `as` | Bấm nút xuất (PDF/CSV/XLSX…), chờ tệp được lưu, trả `{ path, size, type }` |
| `clipboard` | `as` | Đọc khay nhớ tạm |
| `setNetwork` | `mode` | `offline` / `online`. Chỉ tác động phần giao diện; tải mô hình chạy ở tiến trình chính, không bị ảnh hưởng |
| `setTime` | `time` | Đồng hồ giả (ISO 8601) cho giao diện **và** tiến trình chính (Lịch tự động, nhắc việc). Chỉ với `--profile` |
| `loadModel` / `unloadModel` | `id` | Như `--model`; trả `loadMs`, chế độ, ngữ cảnh, số lớp GPU và **tok/s** đo bằng một câu ngắn |
| `onError` | `mode` | `stop` (mặc định) / `continue` cho các bước sau |

### data-testid

* Phần tĩnh (index.html) dùng `id` dạng gạch nối: `sendBtn` → `send-btn`, `uiLangSel` → `ui-lang-sel`, `approveCard` → `approve-card`.
* Điều hướng: `nav-chat`, `nav-server`, `nav-models`, `nav-discover`, `nav-agent`, `nav-schedule`, `nav-memory`, `nav-crm`, `nav-settings`.
* Thẻ cài đặt: `settings-tab-<tab>`, khung `settings-pane-<tab>`. Kinh doanh: `biz-tab-<phân hệ>`, `biz-sub-<mục>`, `biz-row-<id>`, `biz-field-<name>`, `biz-<hành động>`.
* Phần động (`src/renderer/testids.js`): `card-<id>` (Khám phá) cùng `card-<id>-<hành động>`, `model-<id>` / `model-<id>-<hành động>`,
  `convo-<id>` / `convo-<id>-delete`, `msg-<n>` / `msg-<n>-step-<k>`, `sched-<id>`, `mem-<id>`, `toast` / `toast-err`, `dialog-<id>`.
* Kết thúc bằng `*` để khớp tiền tố: `{ "expectCount": ["nav-*", 9] }`. Bắt buộc dùng CSS thì viết `css=#id .lop`.

### Kết quả `--qa-ui`

`status` (`done` / `failed`), `steps[]` (`n`, `action`, `args`, `ok`, `error`, `ms`, `result`, `shot` khi hỏng), `reads`, `downloads`, `dialogs`,
`consoleErrors` (lỗi console của giao diện), `mainErrors` (lỗi tiến trình chính / giao diện bị sập),
`i18n.issues` (khoá dịch thô, `{0}` chưa thay, chữ tiếng Việt khi đang tiếng Anh/Trung, chữ Hán khi đang tiếng Việt/Anh),
`resources.start` / `resources.end` (bộ nhớ ứng dụng, VRAM, mô hình đang nạp), `screen`, `finalShot`, `timings`.

### Ví dụ theo từng khu vực

**Chat**
```json
{ "name": "chat", "steps": [
  { "goto": "chat" }, { "loadModel": "4b" },
  { "type": ["input", "1 + 1 bằng mấy? Trả lời một số."] }, { "press": "Enter" },
  { "waitIdle": 120000 }, { "expectText": ["msg-1", "2"] }, { "screenshot": "chat" } ] }
```

**Mô hình của tôi**
```json
{ "name": "models", "steps": [
  { "goto": "models" }, { "expectVisible": "model-table" },
  { "type": ["mm-filter", "qwen"] }, { "expectCount": ["model-*", 3] }, { "screenshot": "models" } ] }
```

**Khám phá**
```json
{ "name": "discover", "steps": [
  { "goto": "discover" }, { "type": ["search-q", "gpt-oss"] },
  { "expectVisible": "card-gpt-oss-20b-mxfp4" }, { "readText": ["card-gpt-oss-20b-mxfp4", "fit"] }, { "screenshot": "discover" } ] }
```

**AIVN AGENT** (giao diện; việc thật trên màn hình thì dùng `--agent-task`)
```json
{ "name": "agent", "steps": [
  { "goto": "agent" }, { "type": ["input", "hôm nay là thứ mấy?"] }, { "press": "Enter" },
  { "waitIdle": 180000 }, { "expectVisible": "msg-1" }, { "screenshot": "agent" } ] }
```

**Kinh doanh**
```json
{ "name": "biz", "steps": [
  { "seed": "biz-fixture.json" }, { "goto": "biz/sales" }, { "expectVisible": "biz-tab-sales" },
  { "click": "crm-add" }, { "screenshot": "biz-sales-new" }, { "press": "Escape" },
  { "goto": "biz/reports" }, { "download": ["crm-export", "reportFile"] } ] }
```

**Cài đặt**
```json
{ "name": "settings", "steps": [
  { "goto": "settings" }, { "select": ["ui-lang-sel", "en"] }, { "screenshot": "settings-en" },
  { "click": "theme-dark" }, { "click": "settings-tab-about" }, { "expectVisible": "settings-pane-about" },
  { "select": ["ui-lang-sel", "vi"] } ] }
```

Kịch bản mẫu chạy thật trong CI trên box: `test/fixtures/qa-ui/smoke.json` (`test/v016-qa-runner.test.js`).

### Ghi chú PowerShell

* `result.json` và `aivn.log` là UTF-8; `aivn.log` có BOM nên PowerShell 5.1 đọc đúng tiếng Việt.
  Đọc `result.json` bằng `Get-Content -Encoding UTF8`.
* Trước khi in chữ ra console, đặt `[Console]::OutputEncoding = [Text.Encoding]::UTF8` để tiếng Việt không thành `?`.

## `--qa-input-diag` — kiểm tra chuột/phím trên Windows thật (B62/B66)

```powershell
$env:AIVN_QA_MODE = "1"
& "$env:LOCALAPPDATA\Programs\AIVN\AIVN.exe" --qa-input-diag --out C:\qa\diag.json
echo $LASTEXITCODE   # 0 = mọi bước đạt · 2 = có bước hỏng (xem summary)
```

- **B91 (beta.2.2)**: cửa sổ kiểm tra luôn ở trên cùng trong lúc chạy; **trước mỗi lần bấm** hỏi WindowFromPoint — nếu điểm bấm không thuộc cửa sổ AIVN
  (vd. Zalo che) thì đưa cửa sổ kiểm tra lên trước và thử lại (tối đa 3 lần), vẫn không được thì **bỏ qua** lần bấm đó (`skipped: true`, không bao giờ bấm vào ứng dụng khác).
  `guard` ghi số lần thử lại và các lần bỏ qua; có lần bỏ qua → `status: "failed"` kèm `reason`.
- Cùng cổng bật như trên (biến môi trường **và** cờ). Không mở cổng mạng/CDP. Có thể thêm `--profile <thư mục>` (không bắt buộc — lệnh này không đọc/ghi dữ liệu người dùng).
- AIVN mở **cửa sổ kiểm tra riêng** (6 nút, 1 ô một dòng, 1 ô nhiều dòng) rồi **bấm/gõ thật** bằng đúng đường AIVN AGENT dùng (libnut + quy đổi DPI `toNut`). Lệnh này **có giành tiêu điểm và di chuột thật** (giống `--agent-task`): **đừng dùng chuột/bàn phím trong ~30 giây**. `win+s` sẽ mở ô tìm kiếm của Windows và `alt+tab` sẽ chuyển cửa sổ — AIVN tự bấm Esc / bấm lại vào cửa sổ kiểm tra.
- Các phép thử:
  - **Bấm chuột**: di chuột → chờ 0 / 50 / 120 / 300 ms → bấm, ở 2 vị trí; thêm 1 lần qua `screen-control.perform` (đúng 120 ms như AIVN AGENT). Mỗi lần ghi: toạ độ DIP, chuẩn hoá, vật lý; **WindowFromPoint trước khi bấm** (cửa sổ, cửa sổ gốc, tiêu đề, lớp, PID, tiến trình, có quyền admin không, DPI) — `pointIsOurWindow=false` nghĩa là có cửa sổ khác (lớp phủ…) che điểm bấm; cửa sổ trên cùng trước khi bấm; sự kiện cửa sổ kiểm tra nhận được và lệch bao nhiêu px so với tâm nút; sự kiện chuột ở móc cấp thấp (`injected`).
  - **Tổ hợp phím**: `ctrl+l`, `ctrl+t`, `ctrl+f`, `ctrl+h`, `ctrl + a`, `" Ctrl + Shift + Z "`, `enter`, `up`, `home`, `delete`, `win+s`, `win + s`, `alt+tab`. Mỗi tổ hợp ghi: kết quả phân tích, dòng `sendInputExpected` (VK, mã quét, +EXTENDEDKEY mà AIVN định gửi), lỗi libnut nếu có (vd. “Invalid key flag specified.”), **từng sự kiện ở móc bàn phím cấp thấp** (`vk`, `scan`, `flags` + tên cờ `EXTENDED/INJECTED/UP/ALTDOWN` — đúng như hệ điều hành nhận) và phím cửa sổ kiểm tra nhận được. `win+…`/`alt+tab` do Windows xử lý nên “đạt” khi không lỗi và móc phím thấy VK_LWIN `0x5B` có cờ EXTENDED lúc nhấn **và** lúc nhả.
  - **Gõ chữ**: tiếng Việt có dấu và tiếng Trung, bằng dán (cách AIVN AGENT gõ — tính đạt/hỏng) và `typeString` của libnut (chỉ để so sánh).
- Thông tin máy: mọi màn hình (vùng, tỉ lệ, DPI của Electron và **DPI hiệu dụng/thô của Windows** theo từng màn hình), quyền admin của tiến trình chính và renderer AIVN, cửa sổ trên cùng lúc đầu/lúc cuối (+ quyền admin của nó), `focusChanges` (sau tổ hợp nào tiêu điểm bị mất về đâu).
- Phần chỉ có trên Windows chạy bằng trình phụ PowerShell (mã C# biên dịch lúc chạy, nằm trong thư mục tạm, tự xoá). Trình phụ đặt **DPI theo từng màn hình v2** (`helper.dpiAwareness.perMonitor`) để toạ độ không bị ảo hoá. Móc phím chỉ chạy trong lúc kiểm tra và chỉ ghi **mã phím**, không ghi chữ. Nếu PowerShell bị chặn: `helper.ok=false` + lý do, các phép thử bấm/gõ vẫn chạy.
- Đọc nhanh: `summary` (`clicks`, `keys`, `typing`, `failedClicks`, `failedKeys`, `failedTyping`, `typeStringCompare`).

```powershell
$d = Get-Content C:\qa\diag.json -Raw -Encoding UTF8 | ConvertFrom-Json
$d.summary; $d.clicks | Select target, delayMs, ok, pointIsOurWindow, @{n='wfp';e={$_.windowFromPoint.root.process}}
$d.keys | ? combo -like 'win*' | % { $_.combo; $_.error; $_.hook | ft vk, scan, flags, flagNames }
```
