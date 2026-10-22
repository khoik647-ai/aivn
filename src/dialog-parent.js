'use strict';
// Hộp thoại tệp/thư mục của hệ điều hành phải gắn cửa sổ cha. Nếu cửa sổ đó chưa
// được chọn, Windows mở hộp thoại phía sau và cửa sổ AIVN trông như không hoạt động
// — phím Enter không tới nút. QA (--qa-ui) thay win.focus bằng hàm rỗng; gọi focus
// vẫn an toàn, hộp thoại vẫn nhận đúng cửa sổ cha.
function focusDialogParent(win) {
  if (!win || typeof win !== 'object') return win;
  let dead = false;
  try { dead = typeof win.isDestroyed === 'function' && win.isDestroyed(); } catch { return win; }
  if (dead) return win;
  let focused = false;
  try { focused = typeof win.isFocused === 'function' && win.isFocused(); } catch { focused = false; }
  if (!focused && typeof win.focus === 'function') { try { win.focus(); } catch { /* phiên QA không giành tiêu điểm */ } }
  return win;
}
module.exports = { focusDialogParent };
