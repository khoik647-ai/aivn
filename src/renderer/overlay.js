// Lớp phủ khi AIVN AGENT điều khiển máy: viền đỏ, thanh Dừng, trạng thái, khung đỏ ở mục tiêu kế tiếp, thẻ xin phép
const A = window.aivn; const $ = (id) => document.getElementById(id);
let cur = null; let reasonMode = false;
// chuột: chỉ nhận chuột khi ở trên thanh Dừng hoặc thẻ; còn lại xuyên qua để không cản thao tác
for (const el of [$('bar'), $('card')]) { el.addEventListener('mouseenter', () => A.overlayMouse(true)); el.addEventListener('mouseleave', () => A.overlayMouse(false)); }
$('stop').addEventListener('click', () => A.overlayStop());
// B42: thanh nằm ở góc dưới (không che hàng thẻ của trình duyệt), thu gọn được; né chỗ AIVN sắp bấm (sang góc kia)
$('fold').addEventListener('click', () => { const c = $('bar').classList.toggle('collapsed'); $('fold').textContent = c ? '+' : '–'; });
function avoid(p) {
  if (!p) return; const r = $('bar').getBoundingClientRect(); const x = p.x * innerWidth, y = p.y * innerHeight; const m = 40;
  if (x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m) { $('bar').classList.toggle('left'); $('status').style.right = $('bar').classList.contains('left') ? 'auto' : '16px'; $('status').style.left = $('bar').classList.contains('left') ? '16px' : 'auto'; }
}
function place(box) {
  const t = $('target');
  if (!box) { t.style.display = 'none'; return; }
  const W = innerWidth, H = innerHeight; const pad = 4;
  Object.assign(t.style, { display: 'block', left: (box.x1 * W - pad) + 'px', top: (box.y1 * H - pad) + 'px', width: Math.max(14, (box.x2 - box.x1) * W + pad * 2) + 'px', height: Math.max(14, (box.y2 - box.y1) * H + pad * 2) + 'px' });
}
function drawShot(src, box) {
  const c = $('cCanvas'); const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  if (!src) { $('cShot').hidden = true; return; } $('cShot').hidden = false;
  const img = new Image(); img.onload = () => {
    // cắt quanh mục tiêu (phóng to) để thấy rõ; không có mục tiêu thì hiện cả màn hình
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (box) { const cx = (box.x1 + box.x2) / 2 * img.width, cy = (box.y1 + box.y2) / 2 * img.height; sw = Math.min(img.width, Math.max(520, (box.x2 - box.x1) * img.width * 3)); sh = sw * c.height / c.width; sx = Math.max(0, Math.min(img.width - sw, cx - sw / 2)); sy = Math.max(0, Math.min(img.height - sh, cy - sh / 2)); }
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    if (box) { const k = c.width / sw; g.strokeStyle = '#ff1f2e'; g.lineWidth = 4; g.strokeRect((box.x1 * img.width - sx) * k - 4, (box.y1 * img.height - sy) * k - 4, (box.x2 - box.x1) * img.width * k + 8, (box.y2 - box.y1) * img.height * k + 8); }
  };
  img.src = src;
}
function answer(ok) {
  if (!cur) return;
  const r = { id: cur.id, ok, reason: !ok ? $('cReason').value.trim() : '', mode: ok && $('cMode').checked ? 'important' : undefined };
  cur = null; $('card').style.display = 'none'; A.overlayMouse(false); A.overlayAnswer(r);
}
$('cOk').addEventListener('click', () => answer(true));
$('cNo').addEventListener('click', () => answer(false));
$('cWhy').addEventListener('click', () => { if (!reasonMode) { reasonMode = true; $('cReason').style.display = 'block'; $('cReason').focus(); $('cWhy').textContent = 'Gửi lý do và từ chối'; } else answer(false); });
addEventListener('keydown', (e) => {
  if (!cur) return;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); answer(true); }
  else if (e.key === 'Escape') { e.preventDefault(); answer(false); }
});
A.overlayOn((m) => {
  if (m.type === 'start') { $('hk').textContent = ` · Esc hoặc ${m.stopKey} để dừng`; $('status').hidden = true; }
  if (m.type === 'status') { $('status').hidden = !m.text; $('status').textContent = m.text || ''; }
  if (m.type === 'avoid') avoid(m.p);
  if (m.type === 'target') { place(m.box); if (m.box) avoid({ x: (m.box.x1 + m.box.x2) / 2, y: (m.box.y1 + m.box.y2) / 2 }); if (m.label) $('target').querySelector('span').textContent = m.label; }
  if (m.type === 'end') { place(null); $('card').style.display = 'none'; cur = null; }
  if (m.type === 'asked' && cur && cur.id === m.id) { $('card').style.display = 'none'; cur = null; }
  if (m.type === 'ask') {
    cur = m; reasonMode = false;
    $('card').className = m.risk ? 'risk' : '';
    $('cTitle').textContent = m.title; $('cDesc').textContent = m.desc;
    $('cMeta').textContent = [m.window && `Cửa sổ: ${m.window}`, m.via && `định vị bằng ${m.via}`].filter(Boolean).join(' · ');
    $('cRisk').hidden = !m.risk; $('cRisk').textContent = m.risk ? '⚠ ' + m.risk + '. Hãy kiểm tra đúng người nhận / đúng nội dung.' : '';
    $('cText').hidden = !m.text; $('cText').textContent = m.text || '';
    $('cReason').value = ''; $('cReason').style.display = 'none'; $('cWhy').textContent = 'Từ chối kèm lý do';
    $('cMode').checked = false; $('cModeL').hidden = m.mode === 'important' || !!m.risk;
    $('cOk').textContent = m.risk ? 'Cho phép bước này' : 'Cho phép'; const k = document.createElement('kbd'); k.textContent = 'Ctrl+Enter'; $('cOk').appendChild(k);
    drawShot(m.image, m.box); place(m.box);
    $('card').style.display = 'block'; setTimeout(() => $('cNo').focus(), 50);
  }
});
