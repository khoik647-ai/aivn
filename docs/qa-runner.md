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
* Mỗi lần chạy là **một phiên**. Mã thoát: `0` = done · `2` = failed/blocked · `3` = asked_user.

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

## `--agent-task`

```powershell
$env:AIVN_QA_MODE = "1"
& "$env:LOCALAPPDATA\Programs\AIVN\AIVN.exe" --agent-task "mở Notepad và gõ: xin chào" `
    --model 4b --out C:\qa\r1\result.json --shots C:\qa\r1\shots --timeout 300 --lang vi --profile C:\qa\profile
$LASTEXITCODE   # 0 done · 2 failed/blocked · 3 asked_user
Get-Content -Encoding UTF8 C:\qa\r1\result.json | ConvertFrom-Json
```

* `--model`: id trong *Mô hình của tôi*, tên tệp `.gguf`, hoặc viết tắt `2b` / `4b` / `8b` (Qwen3-VL Instruct đã có trên máy).
* **An toàn**: mọi thẻ xin phép (gửi, xoá, mua/thanh toán, khoá máy, âm lượng, ghi đè tệp…) đều **tự TỪ CHỐI**. Không có cách nào để tự cho phép.
  Nếu lệnh có câu “chỉ soạn / đừng gửi / draft only / 只起草”, lời từ chối kèm lý do “Chỉ soạn sẵn, đừng gửi” để AIVN AGENT dừng đúng trước bước gửi.
  Thẻ bị từ chối khi lệnh **không** có câu đó → `status: "blocked"`.
* `--agent-task` điều khiển **màn hình thật** (chuột, bàn phím, cửa sổ) nên **có** giành tiêu điểm. Đừng chạy khi người dùng đang làm việc trên máy.

`result.json`:

```jsonc
{
  "schema": 1, "runId": "…", "version": "0.16.0-beta.3", "commit": "abc1234",
  "task": "…", "lang": "vi",
  "model": { "id": "…", "file": "….gguf", "mode": "gpu", "contextSize": 16384, "gpuLayers": 37, "totalLayers": 37 },
  "screen": { "platform": "win32", "displays": [{ "bounds": {…}, "scaleFactor": 1.25, "dpi": 120, "size": {…}, "primary": true }] },
  "status": "done | failed | blocked | asked_user",
  "reason": "…", "question": "Gửi cho ai?",
  "finalAnswer": "…", "warning": null,
  "approvals": [{ "kind": "desk|approve|confirm|screen", "title": "…", "tool": "…", "recipient": "…", "answer": "denied" }],
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

# B) Google Docs (tài liệu nháp Khôi tạo sẵn) — sửa cần xin phép → ở chế độ QA sẽ "blocked"; thêm câu "không cần hỏi lại" để chạy hết
AIVN.exe --agent-task "trong Google Docs 'QA nháp', thay tất cả 'ngày mai' bằng 'thứ Hai', không cần hỏi lại" --model 8b --out C:\qa\docs\result.json --shots C:\qa\docs\shots

# C) Soạn tin nhưng không gửi (lời từ chối mang lý do "chỉ soạn")
AIVN.exe --agent-task "mở Zalo, soạn tin cho Lan: mai họp lúc 9 giờ, chỉ soạn đừng gửi" --model 8b --out C:\qa\zalo\result.json
```

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
