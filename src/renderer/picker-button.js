'use strict';
// Nút chọn thư mục/tệp: là <button type="button"> focus được. Enter và Space gọi
// đúng một lần click (Enter ngay, Space khi nhả — giống nút gốc). preventDefault
// để trình duyệt không kích hoạt thêm một click nữa.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AIVNPicker = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function isSpace(e) { return e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space'; }
  function isActivate(e) { return e.key === 'Enter' || isSpace(e); }
  function bindPickerButton(el) {
    if (!el || (el.dataset && el.dataset.aivnPicker === '1')) return el;
    if (el.dataset) el.dataset.aivnPicker = '1';
    if (el.tagName === 'BUTTON' && !el.getAttribute('type')) el.setAttribute('type', 'button');
    if (!(el.tabIndex >= 0)) el.tabIndex = 0;
    if (el.classList) el.classList.add('picker-hit');
    el.addEventListener('keydown', (e) => {
      if (!isActivate(e) || e.repeat || e.altKey || e.ctrlKey || e.metaKey || el.disabled) return;
      e.preventDefault();
      if (isSpace(e)) { if (el.dataset) el.dataset.aivnPickerSpace = '1'; return; }
      el.click();
    });
    el.addEventListener('keyup', (e) => {
      if (!el.dataset || el.dataset.aivnPickerSpace !== '1' || !isSpace(e)) return;
      delete el.dataset.aivnPickerSpace;
      e.preventDefault();
      if (!el.disabled) el.click();
    });
    el.addEventListener('blur', () => { if (el.dataset) delete el.dataset.aivnPickerSpace; });
    return el;
  }
  return { bindPickerButton };
});
