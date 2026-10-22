// Màn hình cổng: kích hoạt / mở khoá. Không có dữ liệu trò chuyện nào được nạp ở đây.
const G = window.aivn;
const $ = (s) => document.querySelector(s);
const show = (el, on = true) => { el.hidden = !on; };
const err = (el, msg) => { el.textContent = msg || ''; el.hidden = !msg; };
let waitTimer = null;

// B77: ngôn ngữ theo cài đặt (uiLang) — trước đây chỉ đọc localStorage nên người dùng en/zh mới cài thấy toàn tiếng Việt
async function syncLang(l) { if (window.I18N && I18N.LANGS.includes(l) && l !== I18N.lang) I18N.setLang(l); const sel = $('#gLang'); if (sel && window.I18N) sel.value = I18N.lang; }
async function render() {
  const s = await G.gateState();
  await syncLang(s.lang);
  show($('#gActivate'), s.mode === 'activate'); show($('#gLock'), s.mode === 'lock');
  if (s.mode === 'activate') {
    const l = s.license;
    $('#gaMachine').textContent = l.machineCode; $('#gaOwner').textContent = l.owner;
    const reasons = { revoked: 'Mã kích hoạt trước đây đã bị chủ sở hữu thu hồi.', expired: 'Mã kích hoạt trước đây đã hết hạn.', machine: 'Mã kích hoạt đã lưu thuộc về máy khác.', invalid: 'Mã kích hoạt đã lưu không hợp lệ.', offline: l.message, clock: l.message };
    $('#gaTitle').textContent = l.status === 'none' ? 'Kích hoạt AIVN' : l.needOnline ? 'Cần kết nối Internet' : 'Cần kích hoạt lại';
    $('#gaWhy').textContent = reasons[l.status] ? reasons[l.status] + ' Hãy xin mã mới.' : 'AIVN chỉ dùng được khi chủ sở hữu cấp quyền cho máy này.';
    if (l.needOnline) $('#gaWhy').textContent = l.message;
    show($('#gaRetry'), !!l.needOnline || l.status === 'revoked');
    $('#gaCode').focus();
  }
  if (s.mode === 'lock') { tickWait(s.lock.waitMs); $('#glPw').focus(); }
  if (!s.mode) G.gateEnter();
}
function tickWait(ms) {
  clearInterval(waitTimer);
  const until = Date.now() + ms;
  const upd = () => { const left = until - Date.now(); if (left <= 0) { clearInterval(waitTimer); $('#glGo').disabled = false; $('#glGo').textContent = 'Mở khoá'; return; } $('#glGo').disabled = true; $('#glGo').textContent = `Chờ ${Math.ceil(left / 1000)} giây`; };
  if (ms > 0) { upd(); waitTimer = setInterval(upd, 500); } else upd();
}
$('#gaCopy').addEventListener('click', async () => { const t = $('#gaMachine').textContent; try { await navigator.clipboard.writeText(t); } catch { await G.gateCopy(t); } $('#gaCopy').textContent = 'Đã chép ✓'; setTimeout(() => { $('#gaCopy').textContent = 'Sao chép'; }, 1600); });
$('#gaForm').addEventListener('submit', async (e) => {
  e.preventDefault(); err($('#gaErr'));
  $('#gaGo').disabled = true; $('#gaGo').textContent = 'Đang kiểm tra…';
  try { await G.gateActivate($('#gaCode').value); await render(); }
  catch (x) { err($('#gaErr'), clean(x.message)); }
  finally { $('#gaGo').disabled = false; $('#gaGo').textContent = 'Kích hoạt'; }
});
$('#gaRetry').addEventListener('click', async () => { err($('#gaErr')); $('#gaRetry').disabled = true; const r = await G.gateRetry(); $('#gaRetry').disabled = false; if (!r.ok) err($('#gaErr'), 'Chưa kết nối được: ' + clean(r.error || '')); await render(); });
$('#glForm').addEventListener('submit', async (e) => {
  e.preventDefault(); err($('#glErr'));
  const pw = $('#glPw').value; $('#glPw').value = '';
  const r = await G.gateUnlock(pw);
  if (r.ok) return render();
  err($('#glErr'), r.message); tickWait(r.waitMs || 0); $('#glPw').focus();
});
$('#glForgot').addEventListener('click', () => { show($('#glForgotBox')); $('#glWord').focus(); });
$('#glForgotNo').addEventListener('click', () => { show($('#glForgotBox'), false); $('#glWord').value = ''; });
$('#glReset').addEventListener('click', async () => { err($('#glErr')); try { await G.gateReset($('#glWord').value); } catch (x) { err($('#glErr'), clean(x.message)); } });
$('#gQuit').addEventListener('click', () => G.gateQuit());
$('#goGo').addEventListener('click', async () => {
  err($('#goErr')); const b = $('#goGo'); b.disabled = true;
  try {
    const st = await G.adminState();
    if (!st.unlocked) {
      if (st.imported) await G.adminUnlock($('#goPass').value);
      else { const r = await G.adminImport({ pass: $('#goPass').value }); if (r.canceled) return; }
    }
    await G.adminSelf({ name: $('#goName').value });
    await render();
  } catch (x) { err($('#goErr'), clean(x.message)); }
  finally { b.disabled = false; }
});
(async () => { try { const st = await G.adminState(); if (st.imported) $('#goGo').textContent = 'Mở khoá quản trị và kích hoạt máy này'; } catch {} })();
G.onGateChanged(() => render());
const clean = (m) => String(m || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
render();
// ô chọn ngôn ngữ trên màn cổng: đổi ngay + lưu vào cài đặt (giao diện chính dùng cùng ngôn ngữ)
{ const sel = $('#gLang'); if (sel && window.I18N) { for (const l of I18N.LANGS) { const o = document.createElement('option'); o.value = l; o.textContent = I18N.names[l]; sel.appendChild(o); } sel.value = I18N.lang;
  sel.addEventListener('change', async () => { const l = I18N.LANGS.includes(sel.value) ? sel.value : 'vi'; I18N.setLang(l); try { await syncLang(await G.gateLang(l)); } catch {} }); } }
