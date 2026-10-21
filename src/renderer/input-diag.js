'use strict';
// Ghi lại MỌI sự kiện chuột/phím/nhập chữ mà cửa sổ kiểm tra thật sự nhận được (QA: AIVN.exe --qa-input-diag)
window.__diag = [];
const rec = (e) => { const o = { t: Math.round(performance.now()), type: e.type, target: (e.target && (e.target.id || e.target.tagName)) || null };
  if ('clientX' in e) Object.assign(o, { clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, button: e.button, detail: e.detail });
  if ('key' in e) Object.assign(o, { key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, repeat: e.repeat, location: e.location });
  if (e.type === 'input' || e.type === 'compositionend') Object.assign(o, { data: e.data ?? null, inputType: e.inputType || null, value: e.target.value });
  window.__diag.push(o); if (window.__diag.length > 5000) window.__diag.splice(0, 1000); };
for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'input', 'compositionend', 'paste', 'focus', 'blur']) window.addEventListener(t, rec, true);
// phím tắt trong cửa sổ kiểm tra: chỉ ghi nhận, không làm gì (Ctrl+L/T/F/H/W…)
// (trừ phím sửa chữ Ctrl/Cmd + V/C/X/A/Z/Y để dán được)
window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey || e.altKey) && !(!e.altKey && /^[vcxazy]$/i.test(e.key))) e.preventDefault(); }, true);
document.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') e.target.classList.add('hit'); });
window.addEventListener('blur', () => { document.getElementById('st').textContent = 'mất tiêu điểm ' + new Date().toISOString(); });
window.addEventListener('focus', () => { document.getElementById('st').textContent = 'có tiêu điểm ' + new Date().toISOString(); });
