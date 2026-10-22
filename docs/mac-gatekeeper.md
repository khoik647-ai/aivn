# Mở AIVN lần đầu trên Mac · Opening AIVN on a Mac for the first time · 在 Mac 上首次打开 AIVN

Bản AIVN cho Mac được ký ad-hoc (không có chứng chỉ Apple Developer ID) và **chưa được Apple công chứng (notarize)**. Vì vậy Gatekeeper chặn lần mở đầu tiên. Chỉ cần cho phép một lần.
The Mac build of AIVN is ad-hoc signed (no Apple Developer ID certificate) and **not notarized by Apple**, so Gatekeeper blocks the first launch. You only need to allow it once.
AIVN 的 Mac 版本仅做了临时（ad-hoc）签名（没有 Apple Developer ID 证书），**未经 Apple 公证**，因此 Gatekeeper 会阻止第一次打开。只需允许一次。

## Tiếng Việt
1. Mở tệp .zip vừa tải (Safari thường tự giải nén), rồi kéo **AIVN** vào thư mục **Ứng dụng**.
2. Mở AIVN. Nếu macOS báo không thể xác minh AIVN, bấm **Xong** (đừng bấm Chuyển vào Thùng rác).
3. Mở **Cài đặt hệ thống › Quyền riêng tư & Bảo mật**, kéo xuống phần **Bảo mật**, bấm **Vẫn mở** cạnh dòng nói về AIVN, nhập mật khẩu máy Mac rồi bấm **Vẫn mở** lần nữa.
4. Trên macOS 13 và 14 cũng có thể làm nhanh: trong thư mục Ứng dụng, nhấp phải (hoặc giữ Control và bấm) vào AIVN, chọn **Mở**, rồi bấm **Mở**. Từ macOS 15, cách này không còn tác dụng, hãy dùng bước 3.

Nếu macOS báo “AIVN bị hỏng”, mở Terminal, chạy `xattr -dr com.apple.quarantine /Applications/AIVN.app` rồi mở lại AIVN.

## English
1. Open the downloaded .zip (Safari usually unzips it for you), then drag **AIVN** into your **Applications** folder.
2. Open AIVN. If macOS says it can’t verify AIVN, click **Done** (not Move to Trash).
3. Open **System Settings › Privacy & Security**, scroll down to **Security**, click **Open Anyway** next to the message about AIVN, enter your Mac password, then click **Open Anyway** again.
4. On macOS 13 and 14 there is a shortcut: in Applications, right-click (or Control-click) AIVN, choose **Open**, then click **Open**. From macOS 15 this no longer works, so use step 3.

If macOS says “AIVN is damaged”, open Terminal, run `xattr -dr com.apple.quarantine /Applications/AIVN.app`, then open AIVN again.

## 中文
1. 打开下载的 .zip 文件（Safari 通常会自动解压），然后把 **AIVN** 拖到“**应用程序**”文件夹。
2. 打开 AIVN。如果 macOS 提示无法验证 AIVN，请点按“**完成**”（不要点“移到废纸篓”）。
3. 打开“**系统设置 › 隐私与安全性**”，向下滚动到“**安全性**”，点按关于 AIVN 的提示旁边的“**仍要打开**”，输入 Mac 登录密码，然后再次点按“**仍要打开**”。
4. 在 macOS 13 和 14 上也可以更快：在“应用程序”中按住 Control 键点按（或右键点按）AIVN，选择“**打开**”，再点按“**打开**”。从 macOS 15 起此方法已失效，请使用第 3 步。

如果 macOS 提示“AIVN 已损坏”，请打开“终端”，运行 `xattr -dr com.apple.quarantine /Applications/AIVN.app`，然后重新打开 AIVN。

---
Ghi chú cho người phát hành: muốn bỏ hẳn các bước này cần tài khoản Apple Developer Program (99 USD/năm) để ký bằng Developer ID và công chứng (notarize) — `rcodesign` trên Linux làm được cả hai khi có chứng chỉ và khoá App Store Connect API.
