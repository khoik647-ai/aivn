// AIVN AGENT điều khiển máy tính như một "desktop agent":
//   quan sát (ảnh màn hình thu nhỏ + cây giao diện UIA/AX + chữ OCR) → mô hình chọn thao tác theo id phần tử → (xin phép) → làm → quan sát lại để kiểm tra → lặp.
// Mô hình KHÔNG nhìn ảnh (Qwen3 4B/8B) thao tác theo id/tên phần tử; mô hình nhìn ảnh (Qwen3-VL, UI-TARS, Holo) dùng để định vị khi cây giao diện không có phần tử.
// An toàn: lớp phủ báo "AIVN AGENT đang điều khiển" + khung đỏ ở mục tiêu kế tiếp, Esc / Ctrl+Alt+Q để dừng, hỏi trước bước quan trọng, không bao giờ gõ mật khẩu.
const path = require('path');
const SV = require('./agent/send-verify');
const TB = require('./agent/taskbar');
// B109 (máy thật beta.2.5): OCR đọc ô tìm kiếm Zalo là “Q Tim kiếm” (mất dấu ở “Tìm”, còn dấu ở “kiếm”) → /tìm|tim kiem/ không khớp → bấm vào đó
// không tính là vào ô tìm kiếm → cổng B90 chặn gõ tên người nhận. So cả bản không dấu và bỏ nhiễu đầu dòng.
const SEARCHY_ANY = { test: (x) => { const t = String(x || ''); return /tìm|tim kiem|search|find|查找|搜索|搜尋/iu.test(t) || /(?:^|\s)tim kiem(?:\s|$)|search|find/.test(SV.fold(t)) || (SV.placeholderLike(t) && !/^(?:nhập|nhap|enter|type|aa\b|message|tin nhắn)/iu.test(t.replace(/^[^\p{L}\p{N}]+/u, '').trim()) && !SV.isComposerEl({ name: t })); } }; // chữ gợi ý Ô SOẠN (“Nhập @, tin nhắn tới…”) KHÔNG phải ô tìm kiếm
// B114: cửa sổ trình duyệt; việc “tìm trên web” trong trình duyệt (không nêu trang riêng như YouTube/Shopee… để tìm trong đó)
const isBrowserWin = (W0) => !!W0 && (/^(chrome|msedge|firefox|brave|opera|browser|coccoc|vivaldi)(\.exe)?$/i.test(String(W0.proc || '')) || /(Google Chrome|Microsoft Edge|Mozilla Firefox|Cốc Cốc|Brave|Opera)(\s|$)/i.test(String(W0.title || '')));
const SITE_SEARCH = /(youtube|facebook|shopee|lazada|tiki|tiktok|wikipedia|zalo|messenger|github|gmail|google docs|google drive|google maps|bản đồ)/iu;
function webSearchTask(q) { const t = String(q || ''); return /(?:^|[\s,.:])(?:tìm|tìm kiếm|tra cứu|tra|search|look up|google)(?![\p{L}])|搜索|查一下|查找/iu.test(t) && /(chrome|trình duyệt|edge|firefox|cốc cốc|coc coc|browser|google|web|trên mạng|internet|浏览器)/iu.test(t) && !SITE_SEARCH.test(t); }
const { BrowserWindow, screen, globalShortcut, nativeImage, ipcMain } = require('electron');
const SC = require('./screen-control');
const D = require('./agent/dpi');
const PD = require('./agent/pixdiff');
const SMALL_RE = /(?:^|[^0-9.])(?:0\.\d|[1-4](?:\.\d)?)\s*b(?:[^a-z]|$)/i; // mô hình ≤ 4B
const U = require('./agent/uitree');
const BP = require('./agent/browser-profile');
const OB = require('./agent/ocr-boost');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const { riskOf, RISKY_NAME, ACT_LABEL, ALIASES } = require('./agent/desk-policy');
const AU = require('./agent/autonomy');

const DRAFT_SEND = SV.DRAFT_ONLY; // lệnh chỉ soạn (một nguồn: send-verify)
// B94/B101: chữ vừa gõ nằm ở đâu — 'composer' (ô soạn tin), 'wrong' (ô khác, vd. ô tìm kiếm) hoặc null (không đọc được)
function landedOf(before, obs, text, composerBox) {
  const SVl = require('./agent/send-verify'); const Ul = require('./agent/uitree');
  const typed = Ul.fold(String(text || '').split('\n')[0]).slice(0, 40); if (!obs || !typed) return { landed: null, wrongEl: null };
  const W = obs.win && Array.isArray(obs.win.b) && obs.win.b[3] > 50 ? obs.win.b : null;
  const cb = composerBox || (SVl.findComposer(obs) || {}).b || null;
  const hasTyped = (e) => (e.value && Ul.fold(e.value).includes(typed)) || (e.name && Ul.fold(e.name).includes(typed)) || (e.ocr && e.name && Ul.fuzzyHas(Ul.fold(e.name), typed.slice(0, 24)));
  const preEls = (before && before.elements) || [];
  const existed = (e) => preEls.some(p => p.b && e.b && hasTyped(p) && Math.abs(p.b[0] - e.b[0]) <= 16 && Math.abs(p.b[1] - e.b[1]) <= 16);
  const inComp = (e) => (e.focused || e.editable) && SVl.isComposerEl(e, obs.win) || (cb && e.b && Math.abs((e.b[1] + e.b[3] / 2) - (cb[1] + cb[3] / 2)) <= Math.max(24, cb[3]) && e.b[0] + e.b[2] > cb[0] - 10) || (W && e.b && (e.b[1] + e.b[3] / 2 - W[1]) / W[3] > 0.82 && !/tìm|tim kiem|search|find/iu.test(`${e.name || ''} ${e.placeholder || ''}`));
  const hits = (obs.elements || []).filter(e => hasTyped(e) && !existed(e));
  // không biết khung cửa sổ lẫn ô soạn (OCR cả màn hình, chữ gợi ý không nêu tên) → chỉ coi là NHẦM ô khi có bằng chứng (ô tìm kiếm / con trỏ UIA ở ô khác);
  // còn lại là “chưa đọc được” → bấm Enter rồi kiểm chứng sau khi gửi (b21: Messenger giả, ô soạn “Nhập tin nhắn...”)
  const sure = (e) => !!(W || cb) || /tìm|tim kiem|search|find|搜索/iu.test(`${e.name || ''} ${e.placeholder || ''}`) || !!(e.focused && !e.ocr);
  const good = hits.filter(inComp); const bad = hits.filter(e => !inComp(e) && sure(e));
  // ô tìm kiếm hẹp: OCR có thể không đọc được chữ vừa gõ nhưng hàng ô tìm kiếm ĐỔI trong khi ô soạn không có chữ mới → cũng là gõ nhầm ô
  const rowB = Ul.fold(SVl.searchRowText(before)), rowA = Ul.fold(SVl.searchRowText(obs));
  if (!good.length && !bad.length && rowA !== rowB) { const R0 = (obs.elements || []).filter(e => Array.isArray(e.b) && W && (e.b[1] + e.b[3] / 2 - W[1]) / W[3] < 0.16 && (e.b[0] - W[0]) / W[2] < 0.35); bad.push(R0.sort((x, y) => x.b[0] - y.b[0])[0] || { name: 'ô tìm kiếm', b: null }); }
  return { landed: good.length ? 'composer' : bad.length ? 'wrong' : null, wrongEl: !good.length && bad.length ? bad[0] : null, good: good[0] || null };
}

function createDesktopAgent(deps) {
  // trạng thái “đang tìm kiếm/vừa gõ” còn hiệu lực 5 phút; mô hình “Rất chậm” (bật tay) → ×3 (deps.stepScale)
  const SEARCH_MS = () => 300000 * Math.max(1, Number(deps.stepScale ? deps.stepScale() : 1) || 1);
  // deps: { engine, getSettings, setSettings, log, getMainWindow, preload, isTest, fakeScreen }
  const S = () => deps.getSettings();
  let overlay = null, overlayReady = null, session = null, askSeq = 0; const asks = new Map();
  const display = () => screen.getPrimaryDisplay();
  // T1a: hiệu chỉnh chuột đo được trên máy này (giữ qua các lượt; đổi màn hình/tỉ lệ → đo lại)
  let calib = { cal: null, mode: 'libnut', checks: 0, fixes: 0, misses: 0, last: null };
  const resetCalib = () => { calib = { cal: null, mode: 'libnut', checks: 0, fixes: 0, misses: 0, last: null }; };
  try { for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, resetCalib); } catch {}

  // ---------- toạ độ: gốc (native = vật lý) ↔ chuẩn hoá 0..1 của ẢNH CHỤP màn hình đang làm việc (theo từng màn hình, xem agent/dpi.js) ----------
  const curGeo = () => (session && session.geo) || D.primaryOf(SC.geos());
  function nativeToNorm(x, y) { return D.physToNorm(curGeo(), x, y); }
  const normToNative = (nx, ny) => D.normToPhys(curGeo(), nx, ny);
  const to1000 = (x, y) => { const n = nativeToNorm(x, y); return { x: Math.round(n.nx * 1000), y: Math.round(n.ny * 1000) }; };
  const rectNorm = (b) => { const a = nativeToNorm(b[0], b[1]), c = nativeToNorm(b[0] + b[2], b[1] + b[3]); return { x1: a.nx, y1: a.ny, x2: c.nx, y2: c.ny }; };

  // ---------- lớp phủ ----------
  function ensureOverlay() {
    if (overlay && !overlay.isDestroyed()) return overlayReady;
    const b = display().bounds;
    overlay = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, frame: false, transparent: true, resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
      focusable: false, show: false, hasShadow: false, fullscreenable: false, backgroundColor: '#00000000',
      webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    overlay.setAlwaysOnTop(true, 'screen-saver'); setOvIgnore(true); overlay.setContentProtection(true); // Windows/macOS: không lọt vào ảnh chụp
    overlay.setVisibleOnAllWorkspaces && overlay.setVisibleOnAllWorkspaces(true);
    overlayReady = new Promise(r => overlay.webContents.once('did-finish-load', r));
    overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
    overlay.on('closed', () => { overlay = null; overlayReady = null; });
    return overlayReady;
  }
  const ov = (type, data = {}) => { try { overlay && !overlay.isDestroyed() && overlay.webContents.send('overlay:state', { type, ...data }); } catch {} };
  async function overlayShow() { await ensureOverlay(); if (overlay && !overlay.isVisible()) overlay.showInactive(); }
  function overlayHide() { if (overlay && !overlay.isDestroyed()) overlay.hide(); }
  // Linux không có chống chụp: ẩn lớp phủ trong lúc chụp
  async function withOverlayHidden(fn) {
    const hide = process.platform === 'linux' && overlay && !overlay.isDestroyed() && overlay.isVisible();
    if (hide) { overlay.hide(); await sleep(120); }
    try { return await fn(); } finally { if (hide && session && overlay && !overlay.isDestroyed()) overlay.showInactive(); }
  }
  // B62: nhớ trạng thái “xuyên chuột” của lớp phủ — lớp phủ trong suốt phủ cả màn hình mà đang NHẬN chuột thì mọi cú bấm rơi vào lớp phủ (ảnh không đổi 0%)
  let ovIgnore = true;
  function setOvIgnore(v) { ovIgnore = !!v; try { if (overlay && !overlay.isDestroyed()) { if (v) overlay.setIgnoreMouseEvents(true, { forward: true }); else overlay.setIgnoreMouseEvents(false); } } catch {} }
  ipcMain.on('overlay:mouse', (_e, inside) => { if (overlay && !overlay.isDestroyed() && !(session && session.asking)) setOvIgnore(!inside); });
  ipcMain.on('overlay:stop', () => deps.onStop && deps.onStop('nút Dừng trên lớp phủ'));
  ipcMain.on('overlay:answer', (_e, r) => { const f = r && asks.get(r.id); if (f) f(r); });

  // ---------- phiên điều khiển (một lượt chat) ----------
  function registerEsc(on) {
    try { if (on) { if (!globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', () => deps.onStop && deps.onStop('phím Esc')); } else if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape'); } catch {}
  }
  async function begin(ctx) {
    if (session && session.ctx === ctx) return session;
    session = { ctx, started: Date.now(), actions: 0, obs: null, shot: null, target: null, lastAction: null, history: [], ocrUsed: false, asking: false };
    ctx.onEnd = ctx.onEnd || [];
    const w = deps.getMainWindow();
    if (w && !w.isDestroyed() && !deps.isTest) { session.mainWasVisible = w.isVisible() && !w.isMinimized(); if (process.platform === 'darwin') w.hide(); else w.minimize(); await sleep(400); }
    await overlayShow(); ov('start', { stopKey: process.platform === 'darwin' ? '⌘⌥Q' : 'Ctrl+Alt+Q' });
    registerEsc(true);
    deps.log && deps.log('desk', 'Bắt đầu điều khiển máy tính');
    try { const di = SC.displayInfo(); session.diag = { displays: di.text, nutSize: di.nutSize, calib: calib.cal }; deps.log && deps.log('desk', `Màn hình (tự nhận tỉ lệ): ${di.text} · bộ điều khiển chuột thấy màn hình chính ${di.nutSize || '?'}${calib.cal ? ` · hiệu chỉnh chuột đã đo: ×${calib.cal.kx.toFixed(3)}/×${calib.cal.ky.toFixed(3)}` : ''}${calib.mode !== 'libnut' ? ' · đặt con trỏ bằng ' + calib.mode : ''}`); } catch (e) { deps.log && deps.log('desk', 'Không đọc được thông tin màn hình: ' + e.message); }
    return session;
  }
  // B104 (máy thật beta.2.4): việc gửi tin thất bại / hết giờ mà ô soạn còn chữ AIVN đã gõ (chưa gửi) → xoá đi (clear) hoặc báo rõ chữ vẫn còn
  let lastDraft = null;
  // B121: khung màn hình VẬT LÝ chứa điểm (x, y) vật lý
  function physBoundsAt(x, y) { try { const G = SC.geos(); const g = D.displayForRect(G, [Math.round(x), Math.round(y), 1, 1]); return g && g.phys ? g.phys : null; } catch { return null; } }
  async function taskbarSafe(a, x, y) {
    const d = await TB.detect(); const s = session;
    if (s && !s.tbLogged) { s.tbLogged = true; deps.log && deps.log('desk', `B121: ${TB.describe(d)}`); }
    const b = physBoundsAt(x, y); if (!b) { deps.log && deps.log('desk', 'B121: không biết khung màn hình (vật lý) của điểm bấm — không kiểm dải đáy'); return y; }
    const band = TB.bandOf(b); const inBand = y > b.y + b.height - band - 1;
    if (!inBand) return y;
    const box = a && a.__el && Array.isArray(a.__el.b) ? a.__el.b : null;
    if (!d.autoHide) { deps.log && deps.log('desk', `B121: điểm bấm y=${Math.round(y)} trong dải đáy ${band} px của màn hình ${b.width}×${b.height} nhưng thanh tác vụ không tự ẩn → bấm như cũ`); return y; }
    const ny = TB.safeY(y, b, box);
    deps.log && deps.log('desk', ny !== y ? `B121: thanh tác vụ tự ẩn — điểm bấm y=${Math.round(y)} nằm trong dải đáy (${band} px, màn hình ${b.width}×${b.height} vật lý) → bấm cao hơn trong khung phần tử: y=${Math.round(ny)}${box ? ` (khung ${box[1]}–${box[1] + box[3]})` : ''}` : `B121: thanh tác vụ tự ẩn — điểm bấm y=${Math.round(y)} trong dải đáy nhưng không dời được (phần tử nằm trọn trong dải)`);
    return ny;
  }
  // B115: thanh tác vụ tự ẩn có thể đang che ô soạn (chuột vừa chạm đáy) → đưa chuột lên giữa cửa sổ đích, chờ thanh tác vụ ẩn rồi mới đọc lại
  async function awayFromTaskbar() {
    try { const dd = await TB.detect(); if (session && !session.tbLogged) { session.tbLogged = true; deps.log && deps.log('desk', `B121: ${TB.describe(dd)}`); } if (!dd.autoHide) return false; const s = session; const W = s && s.obs && s.obs.win && Array.isArray(s.obs.win.b) ? s.obs.win.b : null;
      const b = W ? null : (physBoundsAt(0, 0) || displayBoundsAt(0, 0)); const x = W ? W[0] + W[2] / 2 : b.x + b.width / 2; const y = W ? W[1] + W[3] * 0.4 : b.y + b.height * 0.4;
      await moveTo(x, y); await sleep(900); deps.log && deps.log('desk', 'B115: thanh tác vụ tự ẩn — đưa chuột ra xa đáy màn hình rồi mới đọc lại ô soạn'); return true; } catch { return false; }
  }
  function displayBoundsAt(x, y) { try { const { screen } = require('electron'); return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).bounds; } catch { return null; } }
  async function cleanupDraft({ clear = true } = {}) {
    const s = session; const d = s && s.draftTyped; if (!d) return null;
    const res = { text: String(d.text || ''), cleared: false, left: true, why: '' };
    // việc CHỈ SOẠN: bản nháp là kết quả người dùng muốn → không bao giờ xoá (trước B115, phép kiểm đọc nhầm “không còn” mới che được lỗi này)
    if (clear && s.ctx && DRAFT_SEND.test(String(s.ctx.userQuery || ''))) { res.kept = true; res.cleared = false; res.why = 'việc chỉ soạn — giữ bản nháp như yêu cầu'; lastDraft = res; deps.log && deps.log('desk', `B104: việc chỉ soạn — GIỮ chữ “${res.text.slice(0, 40)}” trong ô soạn (không xoá)`); return res; }
    if (!clear) { res.why = 'lượt bị dừng — AIVN không thao tác thêm'; }
    else {
      try {
        await refocus(); await sleep(250); await awayFromTaskbar();
        await observe(s.ctx, { ocr: 'auto', thumb: false }); // cùng phiên (ctx khác sẽ mở phiên MỚI, mất trạng thái)
        const e = draftEl(s.obs);
        if (!e) { res.left = false; res.why = 'không còn thấy chữ đó trong ô soạn'; }
        else {
          await performAt('click', e.b[0] + Math.min(e.b[2] / 2, 40), e.b[1] + e.b[3] / 2, { __el: e, __q: e.name, __notSend: true }); await sleep(200);
          await clearFocused(); await sleep(300); await awayFromTaskbar();
          await observe(s.ctx, { ocr: 'auto', thumb: false }); // cùng phiên (ctx khác sẽ mở phiên MỚI, mất trạng thái)
          if (draftEl(s.obs)) res.why = 'đã thử xoá nhưng chữ vẫn còn';
          else { res.cleared = true; res.left = false; }
        }
      } catch (er) { res.why = 'không xoá được: ' + er.message; }
    }
    s.draftTyped = null; lastDraft = res;
    deps.log && deps.log('desk', `B104: chữ AIVN đã gõ trong ô soạn (chưa gửi) “${res.text.slice(0, 40)}” → ${res.cleared ? 'ĐÃ XOÁ' : res.left ? 'VẪN CÒN' : 'không còn'}${res.why ? ` (${res.why})` : ''}`);
    return res;
  }
  function end(reason = 'xong lượt') {
    if (!session) return;
    const s = session; session = null;
    registerEsc(false); ov('end'); overlayHide();
    for (const f of [...asks.values()]) f({ ok: false, reason: 'đã dừng' });
    const w = deps.getMainWindow();
    if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); }
    deps.log && deps.log('desk', `Kết thúc điều khiển máy tính (${reason}) sau ${s.actions} thao tác, ${Math.round((Date.now() - s.started) / 1000)} giây`);
  }
  const status = (text) => ov('status', { text });

  // ---------- chụp + quan sát ----------
  async function capture() {
    if (deps.fakeScreen) return deps.fakeScreen();
    const s = session; const shot = await withOverlayHidden(() => SC.capture({ maxW: 1920, geo: s && s.geo }));
    if (s && shot.geo) {
      s.geo = shot.geo;
      if (shot.full && Math.abs(shot.full.width - shot.geo.phys.width) > 2 && !s.sizeWarned) { s.sizeWarned = true; deps.log && deps.log('desk', `Cảnh báo: ảnh chụp ${shot.full.width}×${shot.full.height} khác kích thước vật lý ${shot.geo.phys.width}×${shot.geo.phys.height} của màn hình — toạ độ vẫn quy theo tỉ lệ ảnh`); }
    }
    return shot;
  }
  const imgOf = (shot) => nativeImage.createFromDataURL(shot.dataUrl);
  function shotDiff(a, b, region, scope = null) {
    try {
      if (!a || !b || a === b || a.width !== b.width || a.height !== b.height || (a.geo && b.geo && String(a.geo.id) !== String(b.geo.id))) return null;
      const W = 320; const ia = imgOf(a).resize({ width: W, quality: 'good' }), ib = imgOf(b).resize({ width: W, quality: 'good' });
      const sa = ia.getSize(), sb = ib.getSize(); if (sa.width !== sb.width || sa.height !== sb.height) return null;
      if (process.env.AIVN_QA_DIFF_DUMP) { const fs = require('fs'); const n = Date.now(); fs.writeFileSync(`${process.env.AIVN_QA_DIFF_DUMP}/${n}-a.png`, imgOf(a).toPNG()); fs.writeFileSync(`${process.env.AIVN_QA_DIFF_DUMP}/${n}-b.png`, imgOf(b).toPNG()); }
      return PD.diffBitmaps(ia.toBitmap(), ib.toBitmap(), sa.width, sa.height, region, 32, scope);
    } catch { return null; }
  }
  function thumbOf(shot, box) {
    let img = imgOf(shot); img = img.resize({ width: 360, quality: 'good' });
    const t = 'data:image/jpeg;base64,' + img.toJPEG(60).toString('base64');
    return box ? { src: t, box } : { src: t };
  }
  // OCR theo dải ngang, phóng to ~2 lần: chữ giao diện nhỏ (9-12 px) và vùng trống lớn làm OCR cả màn hình bỏ sót gần hết.
  // B65: dải chồng nhau gần nửa dải — mỗi dòng nằm TRỌN trong ít nhất hai dải (Tesseract hay bỏ sót dòng ngay dưới ô có viền/con trỏ)
  // Hiệu năng (máy thật beta.3-pre: mỗi thao tác 16–28 s vì OCR chạy 2 lần × 11–17 s): nhớ kết quả OCR theo dấu vân tay ĐIỂM ẢNH của từng dải/khối
  // (sha1 ảnh cắt + cỡ phóng). Màn hình không đổi → không đọc lại; đổi một phần → chỉ đọc lại dải đã đổi. Toạ độ dòng là tương đối với ảnh cắt nên dùng lại được.
  const ocrMemo = new Map(); const ocrStat = { hit: 0, miss: 0 };
  async function ocrMemoLines(img, scale, prep) {
    let k = null; try { k = require('crypto').createHash('sha1').update(img.toBitmap()).digest('hex') + `:${img.getSize().width}x${img.getSize().height}@${scale}${prep ? ':' + prep.name : ''}`; } catch {}
    if (k && ocrMemo.has(k)) { ocrStat.hit++; const v = ocrMemo.get(k); ocrMemo.delete(k); ocrMemo.set(k, v); return v; }
    ocrStat.miss++;
    const big = img.resize({ width: Math.round(img.getSize().width * scale), quality: 'best' });
    const r = await deps.engine.ocrLines((prep ? prep(big) : big).toPNG());
    if (k) { ocrMemo.set(k, r); while (ocrMemo.size > 400) ocrMemo.delete(ocrMemo.keys().next().value); }
    return r;
  }
  async function ocrShot(shot, region) {
    const img = imgOf(shot); const W = shot.width, H = shot.height; const st0 = { ...ocrStat }; const tO = Date.now();
    const R = region ? { x: Math.max(0, Math.floor(region.x1 * W)), y: Math.max(0, Math.floor(region.y1 * H)), x2: Math.min(W, Math.ceil(region.x2 * W)), y2: Math.min(H, Math.ceil(region.y2 * H)) } : { x: 0, y: 0, x2: W, y2: H };
    const bandH = 160, overlap = 72, scale = (R.x2 - R.x) < 1000 ? 3 : 2; const out = []; // hộp thoại nhỏ (chữ nhỏ): phóng to hơn
    for (let y = R.y; y < R.y2; y += bandH - overlap) {
      const h = Math.min(bandH, R.y2 - y); if (h < 12) break;
      const r = await ocrMemoLines(img.crop({ x: R.x, y, width: R.x2 - R.x, height: h }), scale);
      for (const l of r.lines) {
        const x1 = R.x + l.box[0] / scale, y1 = y + l.box[1] / scale, x2 = x1 + l.box[2] / scale, y2 = y1 + l.box[3] / scale;
        if ((y1 - y < 4 && y > R.y) || (y + h - y2 < 4 && y + h < R.y2)) continue; // dòng bị cắt ở mép dải: dải kế tiếp đọc trọn
        const cy = (y1 + y2) / 2, nb = { x1: x1 / W, y1: y1 / H, x2: x2 / W, y2: y2 / H };
        // cùng một dòng được hai dải chồng nhau đọc (có khi khác dấu: “Trần” / “Tran”) → giữ MỘT bản, bản tin cậy hơn
        const dup = out.findIndex(o => Math.abs(o.cy - cy) < 10 && (o.text === l.text || Math.min(o.nb.x2, nb.x2) - Math.max(o.nb.x1, nb.x1) > 0.6 * Math.min(o.nb.x2 - o.nb.x1, nb.x2 - nb.x1)));
        if (dup >= 0) { if ((l.conf || 0) > (out[dup].conf || 0) + 3) out[dup] = { text: l.text, conf: l.conf, cy, nb }; continue; }
        out.push({ text: l.text, conf: l.conf, cy, nb });
      }
    }
    // B56 (QA lượt 6): chữ SÁNG trên nền MÀU/TỐI (nút chính “✉ Thư mới”, nút “Gửi” xanh) OCR thường bỏ sót → tìm các khối màu đậm cỡ nút,
    // cắt riêng từng khối, đảo màu + tăng tương phản rồi đọc lại; chỉ thêm dòng chưa có
    try {
      const reg = img.crop({ x: R.x, y: R.y, width: R.x2 - R.x, height: R.y2 - R.y });
      for (const bx of OB.coloredBlocks(reg)) {
        const sc2 = 3; const c = reg.crop(bx); const invert = (big) => OB.invertForOcr(nativeImage, big);
        const r2 = await ocrMemoLines(c, sc2, Object.defineProperty(invert, 'name', { value: 'inv' }));
        for (const l of r2.lines) {
          const x1 = R.x + bx.x + (l.box[0] - 16) / sc2, y1 = R.y + bx.y + (l.box[1] - 16) / sc2, x2 = x1 + l.box[2] / sc2, y2 = y1 + l.box[3] / sc2;
          const nb = { x1: x1 / W, y1: y1 / H, x2: x2 / W, y2: y2 / H };
          if (out.some(o => o.nb.x1 < nb.x2 && nb.x1 < o.nb.x2 && o.nb.y1 < nb.y2 && nb.y1 < o.nb.y2)) continue;
          out.push({ text: l.text, conf: l.conf, cy: (y1 + y2) / 2, nb, inverted: true });
        }
      }
    } catch (e) { deps.log && deps.log('desk', 'OCR đảo màu lỗi: ' + e.message); }
    { const hit = ocrStat.hit - st0.hit, miss = ocrStat.miss - st0.miss; deps.log && deps.log('desk', `OCR: ${miss} vùng đọc mới, ${hit} vùng dùng lại (không đổi) · ${Date.now() - tO} ms`); }
    return out.filter(l => l.text.replace(/[^\p{L}\p{N}]/gu, '').length >= (l.inverted ? 2 : 3) || l.conf >= 85);
  }
  // Mắt nhìn: mô hình chính nếu nhìn được ảnh, không thì mô hình định vị (tự chọn mô hình nhìn ảnh đã cài — xem main.getGrounder)
  async function eyes() {
    const st = deps.engine.status();
    if (st && st.vision) return { eng: deps.engine, id: st.path || st.id || '', kind: 'mô hình chính' };
    let g = null; try { g = deps.grounder ? await deps.grounder() : null; } catch (e) { deps.log && deps.log('desk', 'Không nạp được mắt nhìn: ' + e.message); }
    return g ? { eng: g.engine, id: g.id, kind: 'mắt nhìn' } : null;
  }
  // B102/B104: phần tử ô soạn tin đang chứa chữ AIVN đã gõ (chưa gửi) — gần chỗ đã gõ
  function draftEl(obs) {
    const d = session && session.draftTyped; if (!d || !obs) return null; const key = U.fold(String(d.text).split('\n')[0]).slice(0, 24); if (key.length < 3) return null;
    return (obs.elements || []).find(e => Array.isArray(e.b) && ((e.value && U.fold(e.value).includes(key)) || (e.name && U.fold(e.name).includes(key))) && (!d.box || Math.abs((e.b[1] + e.b[3] / 2) - (d.box[1] + d.box[3] / 2)) <= Math.max(30, d.box[3]))) || null;
  }
  async function observe(ctx, { query = '', ocr = 'auto', thumb = true, vision = 'auto', question = '' } = {}) {
    const s = await begin(ctx); status('Đang quan sát màn hình…');
    const t0 = Date.now();
    if (s.quick && vision === 'auto' && !question) vision = 'off'; // B124: các bước tự động của open_chat chỉ cần OCR/cây (mô tả ảnh ~4–5 giây/lần)
    // hộp thoại của chính ứng dụng (Lưu thành…, Mở…) đang ở trước: quan sát hộp thoại đó thay vì cửa sổ chính
    let hw = s.target && s.target.hwnd ? s.target.hwnd : 0; s.dialog = null;
    if (hw && process.platform !== 'darwin') { try { const d = U.activeDialogOf(await U.windows(), s.target); if (d) { hw = d.hwnd; s.dialog = d.title || 'hộp thoại'; deps.log && deps.log('desk', `Đang có hộp thoại “${d.title}” của cùng ứng dụng — quan sát hộp thoại`); } } catch {} }
    let [shot, raw] = await Promise.all([capture(), U.tree({ hwnd: hw, app: s.target && s.target.proc ? s.target.proc : '' }).catch(e => ({ error: e.message, els: [] }))]);
    if (process.platform === 'win32' && raw && raw.dpi && !deps.fakeScreen) { // UIA trong PowerShell không nhận DPI → khung logic: đổi về vật lý
      const k = U.uiaScale(raw, D.primaryOf(SC.geos())); if (k !== 1) { U.rescaleTree(raw, k); if (!s.uiaWarned) { s.uiaWarned = true; deps.log && deps.log('desk', `Trợ năng (UIA) trả toạ độ logic (màn hình chính ${raw.dpi.cx}×${raw.dpi.cy}) — đã nhân ×${k.toFixed(3)} về điểm ảnh vật lý`); } }
    }
    // cửa sổ đích nằm ở màn hình khác ảnh vừa chụp (nhiều màn hình) → chụp lại đúng màn hình đó
    if (!deps.fakeScreen && raw && raw.win && Array.isArray(raw.win.b) && shot.geo) {
      const G = SC.geos(); if (G.length > 1) { const g = D.displayForRect(G, raw.win.b); if (g && String(g.id) !== String(shot.geo.id)) { s.geo = g; shot = await capture(); deps.log && deps.log('desk', `Cửa sổ “${raw.win.title || ''}” ở màn hình ${g.phys.width}×${g.phys.height} @${Math.round(g.scale * 100)}% — chụp màn hình đó`); } }
    }
    if (raw && raw.win && raw.win.hwnd && !s.target) s.target = { hwnd: raw.win.hwnd, pid: raw.win.pid, proc: raw.win.proc, title: raw.win.title };
    const named = (Array.isArray(raw.els) ? raw.els : []).filter(x => x && x.n && U.INTERACTIVE.has(x.r)).length;
    // B124 (máy thật: cây giao diện 0 phần tử có tên ở MỌI lần nhìn Zalo/Chrome → toàn OCR, chậm): ghi chẩn đoán UIA một lần/ứng dụng/phiên; RawView đã được thử
    if (raw && (raw.diag || raw.via === 'raw')) { const pk = String((raw.win && raw.win.proc) || ''); s.uiaDiag = s.uiaDiag || {}; if (!s.uiaDiag[pk]) { s.uiaDiag[pk] = 1; deps.log && deps.log('desk', `B124: UIA “${pk}”: duyệt ${raw.via === 'raw' ? 'RawView (ControlView gần như rỗng)' : 'ControlView'}${raw.diag ? ` · đã xét ${raw.diag.seenControl}/${raw.diag.seen} nút, ${raw.diag.named} có tên · gốc lớp “${raw.diag.cls}” framework “${raw.diag.fw}” · con cấp 1: ${(raw.diag.kids || []).slice(0, 8).join(' ; ') || '(không có)'}` : ` · ${named} phần tử có tên`}`); } }
    let ocrLines = [];
    const proc = (raw.win && raw.win.proc) || (s.target && s.target.proc) || '';
    const poor = !!(raw.noTree || raw.error || named < 8 || U.poorTreeApp(proc));
    const wantOcr = ocr === 'force' || (ocr !== 'off' && poor);
    if (wantOcr && deps.engine.ocrLines) {
      try {
        const wb = raw.win && Array.isArray(raw.win.b) && raw.win.b[2] > 100 ? raw.win.b : null;
        const r = await ocrShot(shot, wb ? rectNorm(wb) : null);
        ocrLines = r.map(l => { const a = normToNative(l.nb.x1, l.nb.y1), c = normToNative(l.nb.x2, l.nb.y2); return { text: l.text, b: [a.x, a.y, c.x - a.x, c.y - a.y] }; });
        s.ocrUsed = true;
      } catch (e) { deps.log && deps.log('desk', 'OCR lỗi: ' + e.message); }
    }
    const obs = U.normalize(raw, { ocr: ocrLines, max: 160 });
    s.idReg = s.idReg || {}; U.stabilizeIds(obs.elements, s.idReg); // B55: id ổn định giữa các lần quan sát
    s.obs = obs; s.shot = shot;
    let list = obs.elements;
    if (query) { const fqs = U.queryVariants(query); const fq = fqs[0] || U.fold(query); const hit = list.filter(e => fqs.some(v => U.fold(e.name).includes(v) || (e.value && U.fold(e.value).includes(v)))); list = hit.length ? [...hit, ...list.filter(e => !hit.includes(e))] : list; }
    // B40: mô hình nhỏ (≤ 4B) đọc danh sách dài 72+ phần tử rồi quan sát lại mãi: gửi danh sách GỌN, xếp theo mức liên quan tới việc (đích của việc lên đầu)
    const st0 = deps.engine.status() || {}; const small = SMALL_RE.test(String(st0.id || st0.path || '').split(/[\\/]/).pop());
    if (!query && ctx && ctx.userQuery) list = U.rankForTask(list, ctx.userQuery);
    const text = U.formatForModel({ win: obs.win, elements: list }, { toNorm: to1000, limit: small ? 30 : query ? 60 : 110 });
    // cây giao diện nghèo (Zalo, ứng dụng Electron…): tự chuyển sang ảnh chụp + mô hình nhìn ảnh
    let seen = '', eyesKind = null;
    if ((poor || question) && vision !== 'off') {
      const e = await eyes();
      if (e) {
        status(e.kind === 'mắt nhìn' ? 'Đang nhìn màn hình bằng mắt nhìn…' : 'Đang nhìn màn hình bằng mô hình chính…'); // B33: chuỗi trọn để dịch được
        try { seen = await SC.describe(e.eng, shot, question || 'Liệt kê đúng chữ các mục đang hiển thị: danh sách/kết quả tìm kiếm, tên người/cuộc trò chuyện, ô nhập (và chữ trong ô), nút. Nói rõ nếu danh sách trống hoặc đang tải.', { signal: ctx.signal }); eyesKind = e.kind; }
        catch (err) { deps.log && deps.log('desk', 'Mắt nhìn lỗi: ' + err.message); }
      } else if (poor) s.needEyes = true;
    }
    s.lastSeen = seen;
    const src = [raw.noTree ? null : raw.error ? 'cây giao diện lỗi: ' + raw.error.slice(0, 120) : `cây giao diện ${named} phần tử có tên`, ocrLines.length ? `OCR ${ocrLines.length} cụm chữ` : null, eyesKind ? 'ảnh chụp + ' + eyesKind : null].filter(Boolean).join(' · ');
    s.obsN = (s.obsN || 0) + 1;
    deps.log && deps.log('desk', `Quan sát: "${obs.win ? obs.win.title : '?'}" · ${obs.elements.length} phần tử (${src}) · ${Date.now() - t0} ms`);
    status(`Đã quan sát: ${obs.elements.length} phần tử`);
    let text2 = text;
    const ak = U.appKeys(proc, obs.win ? obs.win.title : '');
    if (ak && ak.search && poor) text2 += `\nPhím tắt của ${ak.name}: hotkey "${ak.search}" = mở ô tìm kiếm (chắc chắn hơn bấm chữ “Tìm kiếm” đọc bằng OCR); sau đó type_text KHÔNG kèm element.`;
    if (seen) text2 += `\nMô tả màn hình (${eyesKind} nhìn ảnh chụp, có thể chưa chính xác):\n${seen.slice(0, 2500)}`;
    else if (poor && s.needEyes && vision !== 'off') text2 += `\nLƯU Ý: ứng dụng ${proc || 'này'} gần như không cho đọc nút/ô (chỉ có chữ OCR) và mô hình hiện tại KHÔNG nhìn được ảnh. Đừng kết luận "không có/không tìm thấy" chỉ dựa vào danh sách này; báo người dùng bấm "Nạp thêm mắt nhìn" để AIVN nhìn được màn hình.`;
    return { obs, text: text2, src, shot, thumb: thumb ? thumbOf(shot) : null, poor, seen };
  }

  // ---------- xin phép (thẻ trên lớp phủ) ----------
  let benchAnswer = null; // bài đo Điểm tác vụ: trả lời thẻ xin phép tự động (từ chối mọi bước quan trọng)
  async function ask(req, signal = null) {
    const s = session; if (!s) return { ok: false };
    // B117: lượt đã hết giờ/đã dừng → KHÔNG hiện thẻ mới; thẻ đang chờ thì huỷ ngay khi hết giờ (coi như từ chối)
    if (signal && signal.aborted) return { ok: false, cancelled: true, reason: signal.reason === 'timeout' ? 'hết thời gian' : 'đã dừng' };
    const id = 'a' + (++askSeq);
    s.asking = true; registerEsc(false);
    if (overlay && !overlay.isDestroyed()) { setOvIgnore(false); overlay.setFocusable(true); overlay.showInactive(); overlay.focus(); }
    const r = await new Promise((resolve) => {
      const t = setTimeout(() => { asks.delete(id); resolve({ ok: false, timeout: true, reason: '' }); }, 3 * 60e3);
      const onAbort = () => { const f = asks.get(id); if (f) f({ ok: false, cancelled: true, reason: signal && signal.reason === 'timeout' ? 'hết thời gian' : 'đã dừng' }); };
      asks.set(id, (x) => { clearTimeout(t); asks.delete(id); if (signal) signal.removeEventListener('abort', onAbort); resolve(x || { ok: false }); });
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      ov('ask', { id, ...req });
      if (benchAnswer) { const fn = benchAnswer; setTimeout(() => { const f = asks.get(id); if (f) f(fn(req)); }, 300); }
      else if (deps.autoTest && deps.autoAnswer) setTimeout(() => { const f = asks.get(id); if (f) f(deps.autoAnswer(req)); }, 300);
    });
    if (session) { session.asking = false; registerEsc(true); }
    if (overlay && !overlay.isDestroyed()) { overlay.setFocusable(false); setOvIgnore(true); }
    ov('asked', { id });
    return r;
  }

  // ---------- thao tác ----------
  function resolveTarget(a) {
    const s = session; const q = String(a.element || a.target || '').trim();
    // bấm theo TÊN đúng kết quả tìm kiếm vừa ghi nhận → dùng đúng phần tử kết quả đó (không phải chữ cùng tên trong ô tìm kiếm)
    if (q && s && s.obs && s.foundHit && s.foundHit.id && !U.isIdRef(q) && U.fold(q).trim() === U.fold(s.foundHit.name || '').trim()) { const el = s.obs.elements.find(e => e.id === s.foundHit.id); if (el && el.b) return { el, x: el.b[0] + el.b[2] / 2, y: el.b[1] + el.b[3] / 2, via: el.ocr ? 'OCR' : 'cây giao diện' }; }
    // B55: “e11 Tiêu đề” / “e11 (Tiêu đề)” — id kèm nhãn: nhãn phải khớp phần tử hiện tại, không thì từ chối (không đoán)
    // B60: id đọc bằng U.parseIdRef (không quay lui “e10” → e1 + “0”); nhãn không bắt buộc
    if (s && s.obs) { const R = U.resolveIdRef(s.obs.elements, q, s.idReg && s.idReg.info);
      if (R && R.el) return { el: R.el, x: R.el.b[0] + R.el.b[2] / 2, y: R.el.b[1] + R.el.b[3] / 2, via: R.el.ocr ? 'OCR' : 'cây giao diện' };
      if (R) return { el: null, query: q, ...R }; }
    // B27: bấm theo TÊN ngay sau khi gõ tìm → ưu tiên dòng trong danh sách kết quả, không bấm vào chữ vừa gõ trong ô tìm kiếm
    // chữ trong ô có thể kèm con trỏ nháy (“Trần Quỳnh Anh|”) hoặc không, tuỳ lúc chụp → so sánh bỏ con trỏ/dấu câu (lỗi chập chờn B27)
    const bare = (x) => U.fold(String(x || '')).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (q && s && s.obs && s.searchEcho && Date.now() - s.searchEcho.at < SEARCH_MS() && !U.isIdRef(q) && bare(q) === bare(s.searchEcho.name)) {
      const E = s.searchEcho.b; const inEcho = (e) => e.b && Math.abs((e.b[1] + e.b[3] / 2) - (E[1] + E[3] / 2)) <= Math.max(10, E[3] / 2) && e.b[0] < E[0] + E[2] && e.b[0] + e.b[2] > E[0];
      const el = s.obs.elements.filter(e => e.b && bare(e.name) === bare(q) && !inEcho(e)).sort((x, y) => x.b[1] - y.b[1])[0];
      if (el) return { el, x: el.b[0] + el.b[2] / 2, y: el.b[1] + el.b[3] / 2, via: el.ocr ? 'OCR' : 'cây giao diện' };
    }
    if (q && s && s.obs) { const el = U.findElementAny(s.obs.elements, q); if (el) return { el, x: el.b[0] + el.b[2] / 2, y: el.b[1] + el.b[3] / 2, via: el.ocr ? 'OCR' : 'cây giao diện' }; }
    if (Number.isFinite(Number(a.x)) && Number.isFinite(Number(a.y)) && a.x !== '' && a.y !== '' && a.x != null && a.y != null && !(Number(a.x) === 0 && Number(a.y) === 0)) { const p = normToNative(Math.min(1, Math.max(0, a.x / 1000)), Math.min(1, Math.max(0, a.y / 1000))); return { el: null, x: p.x, y: p.y, via: 'toạ độ' }; }
    return q ? { el: null, query: q } : null;
  }
  // Định vị bằng mô hình nhìn ảnh: ưu tiên mô hình định vị riêng (chế độ hai mô hình: Holo / UI-TARS / Qwen-VL), không có thì dùng chính mô hình đang chat nếu nhìn được ảnh
  async function groundWithVision(query, ctx) {
    let g = null; try { g = deps.grounder ? await deps.grounder() : null; } catch (e) { deps.log && deps.log('desk', 'Không nạp được mô hình định vị: ' + e.message); }
    const st = deps.engine.status();
    if (!g && !(st && st.vision)) return null;
    const modelId = g ? g.id : (st.path || st.id || ''); const eng = g ? g.engine : deps.engine;
    status(g ? `Đang tìm “${query}” bằng mô hình định vị…` : `Đang tìm “${query}” bằng mô hình nhìn ảnh…`);
    const fi = SC.familyInfo(modelId);
    const shot = await withOverlayHidden(() => deps.fakeScreen ? deps.fakeScreen() : SC.capture({ maxW: 1280, align: fi.align, geo: session && session.geo }));
    const r = await SC.locate(eng, shot, query, { signal: ctx.signal, modelId });
    deps.log && deps.log('desk', `Định vị "${query}" bằng ${g ? 'mô hình định vị ' : ''}${modelId.split(/[\\/]/).pop()}: ${r.box && r.box.found ? 'thấy' : 'không thấy'} · ${String(r.raw || '').slice(0, 120)}`);
    if (!r.box || !r.box.found) return null;
    const p = normToNative((r.box.x1 + r.box.x2) / 2, (r.box.y1 + r.box.y2) / 2);
    return { el: null, x: p.x, y: p.y, via: g ? 'mô hình định vị' : 'mô hình nhìn ảnh', box: r.box };
  }
  // T1a: đưa chuột tới (x, y) vật lý rồi ĐỌC LẠI vị trí con trỏ thật. Lệch (DPI/tỉ lệ/nhiều màn hình) → tự đo hệ số và sửa,
  // vẫn lệch → (Windows) đặt con trỏ bằng SetCursorPos. Không bao giờ bấm “mù” ở chỗ khác mà không báo.
  async function moveTo(x, y) {
    const n = SC.libnut(); const want = { x: Math.round(x), y: Math.round(y) };
    const read = deps.cursorPhys || SC.cursorPhys;
    const put = async (p) => { if (calib.mode === 'SetCursorPos') await U.setCursor(p.x, p.y); else n.moveMouse(p.x, p.y); await sleep(60); return read(); };
    const b0 = read();
    let sent = calib.mode === 'SetCursorPos' ? want : D.applyCal(calib.cal, want);
    let got = await put(sent); calib.checks++;
    if (!got || D.near(got, want, 3)) { calib.last = { want, got, ok: true }; return { ok: true, got }; }
    // con trỏ “đứng yên” đúng chỗ cũ: hệ thống không cho đọc vị trí (Wayland…) → không kết luận được, làm như trước
    if (b0 && got.x === b0.x && got.y === b0.y) { await sleep(150); const g2 = read(); if (g2 && g2.x === b0.x && g2.y === b0.y) { calib.last = { want, got, ok: true, unverified: true }; deps.log && deps.log('desk', 'Không đọc lại được vị trí con trỏ (hệ thống không báo) — bỏ qua bước kiểm tra chuột'); return { ok: true, got, unverified: true }; } got = g2; if (D.near(got, want, 3)) return { ok: true, got }; }
    deps.log && deps.log('desk', `Con trỏ lệch: cần (${want.x}, ${want.y}) nhưng đang ở (${got.x}, ${got.y}) — đo lại hệ số`);
    if (calib.mode !== 'SetCursorPos') {
      const c = D.calibrate(sent, got); // hệ số thực = vị trí thật / toạ độ đã gửi (so với toạ độ thô của libnut)
      const total = c && calib.cal ? { kx: c.kx * calib.cal.kx, ky: c.ky * calib.cal.ky } : c;
      if (total) {
        sent = D.applyCal(total, want); got = await put(sent);
        if (got && D.near(got, want, 3)) { calib.cal = total; calib.fixes++; calib.last = { want, got, ok: true }; if (session && session.diag) session.diag.calib = total; deps.log && deps.log('desk', `Đã hiệu chỉnh chuột cho màn hình này: ×${total.kx.toFixed(3)} / ×${total.ky.toFixed(3)} (tỉ lệ màn hình ${Math.round(curGeo().scale * 100)}%)`); return { ok: true, got, calibrated: total }; }
      }
    }
    if (process.platform === 'win32') {
      try { await U.setCursor(want.x, want.y); await sleep(60); got = read(); if (got && D.near(got, want, 3)) { calib.mode = 'SetCursorPos'; calib.fixes++; deps.log && deps.log('desk', 'Bộ điều khiển chuột lệch toạ độ — chuyển sang đặt con trỏ bằng SetCursorPos'); return { ok: true, got }; } } catch (e) { deps.log && deps.log('desk', 'SetCursorPos lỗi: ' + e.message); }
    }
    calib.misses++; calib.last = { want, got, ok: false };
    deps.log && deps.log('desk', `Không đưa được chuột tới đúng chỗ: cần (${want.x}, ${want.y}), con trỏ ở (${got.x}, ${got.y})`);
    return { ok: false, got, want };
  }
  async function fgWin() { if (deps.fakeScreen && !deps.fgWin) return null; try { if (deps.fgWin) return await deps.fgWin(); const w = (await U.windows()).find(x => x.active); return w ? { title: w.title, pid: w.pid, hwnd: w.hwnd } : null; } catch { return null; } }
  // B94: xoá chữ trong ô đang chọn (Ctrl/Cmd+A rồi Delete) — chỉ dùng cho ô tìm kiếm / chữ vừa gõ nhầm, không bao giờ cho tài liệu
  async function clearFocused() { try { const n = SC.libnut(); n.keyTap('a', require('./agent/keys').primaryOf(process.platform)); await sleep(120); n.keyTap('delete'); await sleep(150); } catch (e) { deps.log && deps.log('desk', 'Không xoá được chữ trong ô: ' + e.message); } }
  async function performAt(action, x, y, a) {
    // B69: chốt cuối, không dựa vào lời nhắc — thao tác có thể GỬI mà chưa qua chốt gửi trong act() thì không bao giờ được bấm
    if (a && !a.__sendOk && !a.__notSend) {
      const SG = require('./agent/send-gate'); const k = SG.normKeys(a.keys); const sess = session || {};
      const nm = `${a.__el ? a.__el.name || '' : ''} ${a.__q || ''}`;
      const sendLike = (action === 'type_text' && (a.__submit || a.submit || /\n\s*$/.test(String(a.text || ''))))
        || (action === 'hotkey' && (SG.SEND_COMBO.test(k) || /(^|\+)(enter|return)$/.test(k)) && !!(sess.lastTyped || sess.chatOpen))
        || (['click', 'double_click'].includes(action) && SG.SEND_NAME.test(nm));
      if (sendLike) { deps.log && deps.log('desk', `CHẶN (B69): thao tác có thể gửi chưa qua chốt duyệt: ${action} ${String(a.keys || a.text || nm).slice(0, 60)}`); throw new Error('AIVN chặn: thao tác có thể GỬI tin chưa được duyệt.'); }
    }
    const n = SC.libnut();
    const clicky = x != null && ['click', 'double_click', 'right_click', 'type_text'].includes(action);
    let fg0 = null;
    if (clicky) {
      // B62: lớp phủ phải xuyên chuột lúc bấm (trừ khi đang hỏi người dùng); cửa sổ đích ở trước (cú bấm đầu vào cửa sổ nền có thể chỉ để kích hoạt)
      if (!(session && session.asking) && !ovIgnore) { deps.log && deps.log('desk', 'Lớp phủ đang nhận chuột ngay trước cú bấm — đặt lại xuyên chuột'); setOvIgnore(true); await sleep(60); }
      fg0 = await fgWin();
      // chính AIVN (cửa sổ chat/lớp phủ) đang ở trước → đưa ứng dụng đích lên trước rồi mới bấm; ứng dụng khác (hộp thoại hệ thống…) thì không giành tiêu điểm
      if (fg0 && fg0.pid === process.pid && session && session.target) { deps.log && deps.log('desk', 'AIVN đang ở trước ngay trước cú bấm — đưa ứng dụng đích lên trước'); await refocus(); fg0 = await fgWin(); }
    }
    // B115/B121: thanh tác vụ tự ẩn → không bấm trong dải đáy màn hình (chạm đáy làm thanh tác vụ bật lên che ô soạn). Mọi toạ độ ở đây là VẬT LÝ.
    if (clicky && x != null) { try { await taskbarSafe(a, x, y).then(ny => { y = ny; }); } catch (e) { deps.log && deps.log('desk', 'B121: kiểm thanh tác vụ lỗi: ' + e.message); } }
    if (x != null) { const m = await moveTo(x, y); a.__moved = m; if (!m.ok) { const e = new Error(`Chuột không tới được đúng chỗ cần bấm (cần ${m.want.x},${m.want.y}; con trỏ ở ${m.got.x},${m.got.y}) — AIVN không bấm để tránh bấm nhầm.`); e.code = 'CURSOR_OFF'; throw e; } await sleep(80); }
    // B62: cửa sổ dưới điểm bấm (Windows) — là cửa sổ của chính AIVN (lớp phủ…) thì ẩn lớp phủ trong lúc bấm
    let hidOv = false; a.__under = null;
    if (clicky) {
      const under = deps.windowAt ? await deps.windowAt(x, y) : await U.windowAt(x, y); a.__under = under;
      if (under && under.pid === process.pid) {
        deps.log && deps.log('desk', `LỖI cú bấm: điểm (${Math.round(x)},${Math.round(y)}) đang nằm dưới cửa sổ của chính AIVN “${String(under.title || '').slice(0, 40)}” (pid ${under.pid}${under.transparent ? ', xuyên chuột' : ', KHÔNG xuyên chuột'}) — ẩn lớp phủ trong lúc bấm`);
        if (overlay && !overlay.isDestroyed() && overlay.isVisible()) { overlay.hide(); hidOv = true; await sleep(120); }
      }
    }
    // B62: bấm kiểu người: rê chuột nhẹ (để ứng dụng Electron/Chromium nhận “hover”), nhấn – giữ ~50 ms – nhả
    const press = async (btn, times = 1) => {
      try { if (x != null && calib.mode !== 'SetCursorPos') { const p0 = D.applyCal(calib.cal, { x: Math.round(x), y: Math.round(y) }); const p1 = D.applyCal(calib.cal, { x: Math.round(x) + 2, y: Math.round(y) }); n.moveMouse(p1.x, p1.y); await sleep(30); n.moveMouse(p0.x, p0.y); await sleep(40); } else await sleep(40); } catch {}
      for (let i = 0; i < times; i++) { if (n.mouseToggle) { n.mouseToggle('down', btn); await sleep(55); n.mouseToggle('up', btn); } else n.mouseClick(btn, false); if (i + 1 < times) await sleep(90); }
    };
    try {
      if (action === 'click') await press('left');
      if (action === 'double_click') await press('left', 2);
      if (action === 'right_click') await press('right');
      if (action === 'type_text' && x != null) { await press('left'); await sleep(250); }
    } finally { if (hidOv && overlay && !overlay.isDestroyed() && session) overlay.showInactive(); }
    if (action === 'type_text') {
      if (a.__replace || a.__clear) { n.keyTap('a', require('./agent/keys').primaryOf(process.platform)); await sleep(120); if (a.__clear) { n.keyTap('delete'); await sleep(120); } }
      const t = String(a.text || '');
      // 0.16: mọi hệ điều hành đều DÁN cả đoạn một lần (nhanh, đúng dấu tiếng Việt). Trước đây Linux dùng "xdotool type" —
      // kiểm thử thật cho thấy nó làm rơi chữ có dấu (“xin chào” → “xin cho”), nên chỉ còn là phương án dự phòng (AIVN_TYPE_XDOTOOL=1).
      if (process.platform === 'linux' && process.env.AIVN_TYPE_XDOTOOL === '1') {
        try { await new Promise((res, rej) => require('child_process').execFile('xdotool', ['type', '--delay', '12', '--', t], { timeout: 60000 }, (e) => e ? rej(e) : res())); if (a.__submit && (!a.__beforeSubmit || await a.__beforeSubmit())) { await sleep(150); n.keyTap('enter'); } else if (a.__submit) a.__submitSkipped = true; return; } catch {}
      }
      const { clipboard } = require('electron');
      const prev = await Promise.resolve(clipboard.readText()).catch(() => '');
      await Promise.resolve(clipboard.writeText(t)); await sleep(60);
      n.keyTap('v', require('./agent/keys').primaryOf(process.platform)); await sleep(350);
      setTimeout(async () => { try { if (await Promise.resolve(clipboard.readText()) === t) await Promise.resolve(clipboard.writeText(prev || '')); } catch {} }, 1500);
    }
    // 0.16: gõ xong bấm Enter trong CÙNG một bước (bấm ô + dán chữ + Enter = một lượt của mô hình)
    // B101: trước khi bấm Enter, kiểm chữ đã nằm trong ô soạn tin (hook do act() đặt); không đạt → KHÔNG bấm Enter
    if (action === 'type_text' && a.__submit) { if (!a.__beforeSubmit || await a.__beforeSubmit()) { await sleep(150); n.keyTap('enter'); } else a.__submitSkipped = true; }
    if (action === 'hotkey') {
      const KY = require('./agent/keys'); const k = KY.parse(a.keys); const esc = k.key === 'escape';
      deps.log && deps.log('desk', KY.diag(k));
      if (esc) registerEsc(false);
      try { if (k.mods.length) n.keyTap(k.key, k.mods); else n.keyTap(k.key); }
      catch (e) { throw new Error(`Bộ gửi phím không bấm được “${a.keys}” (${KY.diag(k)}): ${e.message}`); }
      finally { if (esc) setTimeout(() => session && !session.asking && registerEsc(true), 300); } }
    if (action === 'scroll') { const amt = Math.max(-20, Math.min(20, Math.round(Number(a.amount) || -5))); n.scrollMouse(0, process.platform === 'win32' ? amt * 120 : amt); }
    if (clicky && deps.log) {
      await sleep(120); const fg1 = await fgWin(); const sh = session && session.shot;
      const info = { el: a.__el || null, query: a.__q || '', shot: sh ? { width: sh.width, height: sh.height, full: sh.full, geo: sh.geo || curGeo() } : null, pt: { x, y }, geos: SC.geos ? (() => { try { return SC.geos(); } catch { return []; } })() : [], api: calib.mode === 'SetCursorPos' ? 'SetCursorPos' : 'libnut moveMouse', cal: calib.cal, got: a.__moved && a.__moved.got, fg0, fg1, under: a.__under, overlayIgnore: ovIgnore, phase: 'sau' };
      try { deps.log('desk', D.clickDiag(info)); } catch (e) { deps.log('desk', 'Nhật ký cú bấm lỗi: ' + e.message); }
      if (fg0 && fg1 && session && session.target && session.target.pid && fg1.pid !== session.target.pid) deps.log('desk', `Cảnh báo: sau cú bấm, cửa sổ ở trước là “${String(fg1.title || '').slice(0, 50)}” (pid ${fg1.pid}), không phải ứng dụng đích (pid ${session.target.pid})`);
    }
  }
  async function refocus() {
    const s = session; if (!s || !s.target || !s.target.hwnd) return;
    try {
      const list = await U.windows(); const act = list.find(w => w.active);
      if (act && (String(act.hwnd) === String(s.target.hwnd) || (s.target.pid && act.pid === s.target.pid))) return; // đã ở đúng ứng dụng (kể cả hộp thoại của nó): không giành lại tiêu điểm
      await U.focus(s.target); await sleep(200);
    } catch {}
  }
  function describeAct(action, a, t) {
    const who = t && t.el ? `${t.el.kind} “${t.el.name || t.el.id}”` : t && t.query ? `“${t.query}”` : t && t.via === 'toạ độ' ? `vị trí (${a.x}, ${a.y})` : '';
    if (action === 'type_text') return `gõ “${String(a.text).slice(0, 200)}”${who ? ' vào ' + who : ' vào ô đang chọn'}${a.submit ? ' rồi bấm Enter' : ''}`;
    if (action === 'hotkey') return `bấm phím ${a.keys}`;
    if (action === 'scroll') return `cuộn ${Number(a.amount) > 0 ? 'lên' : 'xuống'} ${Math.abs(Number(a.amount) || 5)} nấc${who ? ' tại ' + who : ''}`;
    return `${(ACT_LABEL[action] || action).toLowerCase()} ${who}`.trim();
  }

  // B21: ô sắp nhận chữ có CHẮC là ô tìm kiếm không. Chỉ tin: (1) phần tử đích/đang chọn mang tên/gợi ý “Tìm kiếm/Search”;
  // (2) không đọc được ô đang chọn, nhưng thao tác NGAY TRƯỚC (≤ 60 giây) là bấm vào ô/chữ “Tìm kiếm” hoặc Ctrl+F/K, hoặc đang gõ tìm dở (chưa bấm chỗ khác).
  // Ô đang chọn đọc được mà là ô nhập KHÁC (ô soạn tin) → không phải ô tìm kiếm, dù trước đó có bấm “Tìm kiếm”.
  function searchConfirmed(t, focusedEl, a) {
    const s = session; const SEARCHY = SEARCHY_ANY;
    // kịch bản A: thanh địa chỉ của trình duyệt (“Address and search bar”, “Nhập địa chỉ”, omnibox) — gõ + Enter là TÌM/MỞ TRANG, không phải gửi tin
    const ADDRY = /address|địa chỉ|dia chi|\burl\b|omnibox|地址|网址/iu;
    const named = (el) => !!el && (SEARCHY.test(`${el.name || ''} ${el.autoId || ''} ${el.placeholder || ''}`) || ADDRY.test(`${el.name || ''} ${el.autoId || ''} ${el.placeholder || ''}`));
    const W0 = s && s.obs && s.obs.win; const browserWin = !!W0 && (/^(chrome|msedge|firefox|brave|opera|browser|coccoc|vivaldi)(\.exe)?$/i.test(String(W0.proc || '')) || /(Google Chrome|Microsoft Edge|Mozilla Firefox|Cốc Cốc|Brave|Opera)(\s|$)/i.test(String(W0.title || '')));
    if (t && t.el) return named(t.el);
    if (t && t.x != null) return SEARCHY.test(String(a.element || a.target || '')) && !U.isIdRef(String(a.element || a.target || ''));
    if (focusedEl && (focusedEl.editable || focusedEl.focused) && !focusedEl.ocr) return named(focusedEl);
    // B64 (QA lượt 8): “vừa mở ô tìm kiếm” tính từ lúc thao tác XONG (sau khi kiểm tra lại màn hình — máy chậm mất 27–263 giây), không tính từ lúc bắt đầu bấm
    if (inSearchMode()) return true;
    const la = s && s.lastAction; const recent = la && Date.now() - (la.doneAt || la.at) < 60000;
    if (recent && browserWin && /^(?:(?:ctrl|cmd|command|meta)\+[lt]|alt\+d|f6)$/i.test(String(la.keys || '').replace(/\s/g, ''))) return true; // Ctrl+L/Alt+D/F6: con trỏ đang ở thanh địa chỉ
    if (recent && (/^(ctrl|cmd|command|meta)\+(f|k)$/i.test(String(la.keys || '').replace(/\s/g, '')) || (['click', 'double_click'].includes(la.action) && SEARCHY.test(`${la.query || ''} ${la.el ? la.el.name || '' : ''}`)))) return true;
    return !!(s && s.inSearch && Date.now() - s.inSearch < SEARCH_MS() && la && la.action === 'type_text');
  }
  // B64: chế độ tìm kiếm — bật khi bấm trúng phần tử tên Tìm kiếm/Search/查找 (kể cả chữ OCR) hoặc Ctrl/Cmd+F/K/E / phím tìm của ứng dụng;
  // đồng hồ bắt đầu khi thao tác đó XONG; giữ qua type_text/wait/scroll; mọi thao tác khác tắt nó
  const SEARCH_NAME = SEARCHY_ANY;
  function opensSearch(action, a, t) {
    if (['click', 'double_click'].includes(action)) return SEARCH_NAME.test(`${t && t.el ? `${t.el.name || ''} ${t.el.placeholder || ''} ${t.el.autoId || ''}` : ''} ${t && t.query && !U.isIdRef(t.query) ? t.query : ''}`);
    if (action === 'hotkey') { const k = String(a.keys || '').toLowerCase().replace(/\s/g, ''); if (/^(ctrl|control|cmd|command|meta)\+(f|k|e)$/.test(k)) return true;
      const s = session; const ak = s && U.appKeys((s.obs && s.obs.win && s.obs.win.proc) || (s.target && s.target.proc) || '', s.obs && s.obs.win ? s.obs.win.title : ''); return !!(ak && ak.search && String(ak.search).toLowerCase().replace(/\s/g, '') === k); }
    return false;
  }
  function inSearchMode() { const s = session; return !!(s && s.searchMode && s.searchMode.at && Date.now() - s.searchMode.at < SEARCH_MS()); }
  // ensure_app: đưa ứng dụng về trạng thái sẵn sàng từ mọi trạng thái (chưa mở / thu nhỏ / bị che / chỉ ở khay / web + đăng nhập) — xem agent/ensure-app.js
  const eaCache = new Map();
  function ensureDepsFor(s, ctx) {
    const EA = require('./agent/ensure-app'); const C = require('./agent/computer');
    const lg = (m) => deps.log && deps.log('desk', m);
    const generic = { // macOS/Linux (và Windows khi thiếu trình phụ): danh sách cửa sổ thường, không có thông tin khay/treo
      looseTitle: true,
      state: async () => ({ windows: (await U.windows()).map(w => ({ ...w, vis: true, min: !!w.min, active: !!w.active })), procs: [] }),
      focus: async (w) => ({ ok: await U.focus(w).catch(() => false), how: 'set' }),
    };
    const hasWmctrl = process.platform === 'linux' && (() => { try { return require('child_process').spawnSync('which', ['wmctrl']).status === 0; } catch { return false; } })();
    const plat = process.platform === 'linux' && hasWmctrl ? EA.linuxDeps() : process.platform === 'win32' ? EA.winDeps({ log: lg, click: async (x, y) => { const n = SC.libnut(); n.moveMouse(Math.round(x), Math.round(y)); await sleep(80); n.mouseClick('left', false); } }) : generic;
    return {
      ...plat, webApp: C.webApp, cache: eaCache, log: lg, sleep,
      launch: (q) => (deps.launchApp ? deps.launchApp(q) : Promise.resolve({ ok: false, tried: ['không có bộ mở ứng dụng'] })),
      openUrl: async (url, bw) => {
        if (process.platform === 'win32' && bw && bw.path && /\.exe$/i.test(bw.path)) { const { spawn } = require('child_process'); const b = BP.browserOfApp(bw.proc || ''); const c = spawn(bw.path, b ? BP.launchArgs(b, BP.readProfile(b), url) : [url], { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); return; }
        if (deps.openExternal) return deps.openExternal(url); throw new Error('không mở được địa chỉ web');
      },
      look: async (w) => {
        s.target = { hwnd: w.hwnd, pid: w.pid, proc: w.proc, title: w.title }; s.obs = null;
        const o = await observe(ctx, { thumb: false, vision: 'off' }); s.ensureObsText = o && o.text ? o.text : ''; // B124: chờ sẵn sàng chỉ cần OCR/cây, không mô tả ảnh (~4–5 giây/lần)
        const els = (s.obs && s.obs.elements) || [];
        return { sig: els.length ? screenHash(s.obs) + '|' + U.fold((s.obs.win && s.obs.win.title) || w.title || '') : null, text: els.map(e => e.name || e.value || '').filter(Boolean).join(' · ').slice(0, 4000), elements: els.slice(0, 400).map(e => ({ name: e.name, value: e.value, b: e.b })) };
      },
      // B153: trình duyệt họ Chromium — chạy .exe với hồ sơ đang dùng; đọc hồ sơ; bấm một phần tử (màn hình chọn hồ sơ)
      launchBrowser: async (b) => launchBrowserWith(b, null),
      profile: (b) => (process.platform === 'win32' ? BP.readProfile(b) : null),
      clickEl: async (el) => { const x = el.b[0] + el.b[2] / 2, y = el.b[1] + Math.min(el.b[3] / 2, 60); await performAt('click', x, y, { __el: el, __q: el.name || el.value, __notSend: true }); },
      ...(deps.ensureDeps ? deps.ensureDeps(s, ctx) : {}),
    };
  }
  // B153/B154: chạy trình duyệt người dùng nêu tên, ĐÚNG hồ sơ đang dùng, có thể kèm địa chỉ (không dùng “start <url>”/trình duyệt mặc định)
  async function launchBrowserWith(b, url) {
    if (process.platform !== 'win32') return { ok: false, tried: ['chỉ hỗ trợ chạy trực tiếp trên Windows'] };
    const exe = BP.findExe(b); if (!exe) return { ok: false, tried: [`không thấy ${b.exe} trong thư mục cài`] };
    const prof = BP.readProfile(b); const args = BP.launchArgs(b, prof, url);
    const { spawn } = require('child_process'); const c = spawn(exe, args, { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref();
    deps.log && deps.log('desk', `B153: chạy ${exe} ${args.join(' ')}${prof && prof.missing ? ' (không đọc được Local State → hồ sơ Default)' : ''}`);
    return { ok: true, how: `${b.exe}${prof && prof.dir ? ' --profile-directory=' + prof.dir : ''}${url ? ' ' + url : ''}`, exe, profile: prof };
  }
  async function ensureApp(a, ctx) {
    const app = String(a.app || a.window || a.name || '').trim(); if (!app) throw new Error('Cần tên ứng dụng (app).');
    const s = await begin(ctx); status(`Đang chuẩn bị ${app}…`);
    s.ensureObsText = ''; const tE = Date.now();
    const r = await require('./agent/ensure-app').ensureApp(app, ensureDepsFor(s, ctx), { timeoutMs: Number(a.timeout_ms) > 0 ? Number(a.timeout_ms) : 45000 });
    deps.log && deps.log('desk', `ensure_app ${app}: ${r.ok ? 'SẴN SÀNG' : 'LỖI ' + r.code} sau ${Math.round(r.ms / 100) / 10} giây${r.fast ? ' (B124: đường nhanh, tổng ' + (Date.now() - tE) + ' ms)' : ''} — ${r.steps.join(' → ')}`);
    if (r.ok) {
      const w = r.window; s.target = { hwnd: w.hwnd, pid: w.pid, proc: w.proc, title: w.title }; s.ensured = { app, at: Date.now(), hwnd: w.hwnd, fast: !!r.fast };
      const what = { already: 'đã ở trước', restored: 'đã khôi phục từ thu nhỏ', raised: 'đã đưa lên trước (đang bị che)', launched: 'đã khởi động', tray: 'đã mở lại từ khay hệ thống', web: 'đã mở trên trình duyệt' }[r.how] || r.how;
      const o = s.ensureObsText || '';
      return { fast: !!r.fast, forModel: `${app} sẵn sàng: cửa sổ “${w.title}” (${what}).${r.warn ? ' CẢNH BÁO: ' + r.warn + '.' : ''} Các bước: ${r.steps.join('; ')}.${o ? '\n' + o : ''}`, summary: r.how === 'already' ? `${app}: đã ở trước` : r.how === 'restored' ? `${app}: đã khôi phục từ thu nhỏ` : r.how === 'raised' ? `${app}: đã đưa lên trước (đang bị che)` : r.how === 'launched' ? `${app}: đã khởi động` : r.how === 'tray' ? `${app}: đã mở lại từ khay hệ thống` : r.how === 'web' ? `${app}: đã mở trên trình duyệt` : `${app}: sẵn sàng`, how: r.how, window: w, steps: r.steps };
    }
    return { error: r.error, code: r.code, ask: r.ask || null, stop: !!r.stop, forModel: r.error, summary: r.code === 'login' ? `${app}: màn hình đăng nhập — hỏi bạn` : r.code === 'not-found' ? `${app}: chưa mở được` : r.code === 'timeout' ? `${app}: chưa sẵn sàng (quá hạn)` : r.code === 'hung' ? `${app}: không phản hồi` : r.code === 'tray' ? `${app}: chưa mở được từ khay hệ thống` : `${app}: lỗi`, detail: r.error, steps: r.steps };
  }
  // B65: open_chat(app, người nhận) — mở ô tìm kiếm (phím tắt của ứng dụng hoặc bấm “Tìm kiếm”), xoá ô, gõ ĐÚNG tên người nhận lấy từ câu lệnh
  // của người dùng (không lấy tên mô hình đưa), chọn kết quả trùng tên, kiểm tra tiêu đề. Mô hình chỉ còn gõ nội dung tin.
  // B108: việc chỉ MỞ cuộc trò chuyện (không có nội dung tin trong yêu cầu) → xong, không gõ gì; việc gửi/soạn → gõ ĐÚNG nội dung người dùng nêu
  const ocNext = (q) => !SV.msgSend(q) && !SV.quotedIn(q).length ? 'Việc chỉ là MỞ cuộc trò chuyện: ĐÃ XONG. KHÔNG gõ gì, KHÔNG gửi gì — trả lời người dùng là đã mở.' : `Bước tiếp: type_text ĐÚNG nội dung tin người dùng đã nêu (không kèm element, không tự thêm lời chào)${DRAFT_SEND.test(q) ? ', KHÔNG submit' : ', submit: true'}.`;
  // B108: việc gửi tin mà mô hình định gõ/gửi chữ KHÔNG có trong yêu cầu → hỏi người dùng nội dung chính xác (không tự bịa, không đoán)
  const askText = (q) => { const r = SV.recipientOf(q); return `Bạn muốn gửi chính xác nội dung gì${r ? ` cho “${r}”` : ''}? Mình chỉ gửi đúng chữ bạn đưa (ví dụ: gửi tin "…"${r ? ` cho ${r}` : ''}), không tự viết thêm.`; };
  // B122: xoá chữ còn trong ô tìm kiếm sau khi đã mở đúng cuộc trò chuyện; kiểm lại: không còn nút “Đóng”/chữ sót; tiêu đề vẫn đúng
  async function clearChatSearch(rcp, note, ctx) {
    const s = session; if (!s) return { cleared: false };
    const dirty = () => SV.searchLeftover(s.obs) || SV.searchClose(s.obs); let screen = null;
    try {
      if (!dirty()) { note('ô tìm kiếm đã trống'); return { cleared: true, already: true }; }
      for (let i = 0; i < 2 && dirty(); i++) {
        const close = SV.searchClose(s.obs); const left = SV.searchLeftover(s.obs);
        await refocus();
        if (close && i === 0) { await performAt('click', close.x, close.y, { __el: null, __q: 'Đóng', __notSend: true }); note('bấm “Đóng” cạnh ô tìm kiếm để xoá chữ tìm'); }
        else { if (left && Array.isArray(left.b)) await performAt('click', left.b[0] + Math.min(left.b[2] / 2, 30), left.b[1] + left.b[3] / 2, { __el: left, __q: left.name, __notSend: true }); await clearFocused(); SC.libnut().keyTap('escape'); note('xoá chữ trong ô tìm kiếm (chọn hết + xoá + Esc)'); }
        await sleep(350); const o = await observe(ctx || s.ctx, { ocr: 'auto', thumb: false }); screen = o && o.text ? o.text : screen;
      }
      const left = dirty(); const R = SV.regionsOf(s.obs); const still = SV.chatShown(rcp, s.obs && s.obs.win ? s.obs.win.title : '', R ? R.header : [], s.aliases);
      s.searchMode = null; s.inSearch = null;
      note(left ? `ô tìm kiếm vẫn còn chữ “${String(left.name || left.value || '').slice(0, 30)}”` : `đã kiểm: ô tìm kiếm trống${still ? ', khung chat vẫn là “' + rcp + '”' : ''}`);
      deps.log && deps.log('desk', `B122: sau open_chat “${rcp}”: ô tìm kiếm ${left ? 'VẪN còn chữ' : 'đã trống'}; tiêu đề ${still ? 'vẫn đúng' : 'chưa đọc lại được'}`);
      return { cleared: !left, chatStill: !!still, screen };
    } catch (e) { note('chưa xoá được ô tìm kiếm: ' + String(e.message || e).split('\n')[0]); return { cleared: false }; }
  }
  async function openChat(a, ctx) {
    const s0 = await begin(ctx); const t0 = Date.now(); s0.quick = true; s0.obsN = 0;
    try { const r = await openChatInner(a, ctx); deps.log && deps.log('desk', `B124: open_chat xong sau ${Date.now() - t0} ms, ${s0.obsN} lần quan sát`); return r; }
    finally { s0.quick = false; }
  }
  async function openChatInner(a, ctx) {
    const s = await begin(ctx); const q = ctx && ctx.userQuery ? String(ctx.userQuery) : '';
    const rcp = q ? SV.recipientOf(q) || (SV.CURRENT_CHAT.test(q) ? null : null) : null;
    if (!rcp) { const ask = SV.askWho(); return { error: 'chưa rõ người nhận', stop: true, ask, forModel: ask, summary: 'chưa rõ người nhận — hỏi bạn' }; }
    const asked = String(a.recipient || a.text || a.element || '').trim();
    if (asked && SV.nameKey(asked) !== SV.nameKey(rcp)) deps.log && deps.log('desk', `open_chat: mô hình đưa “${asked.slice(0, 40)}” nhưng người dùng nêu “${rcp}” — dùng tên người dùng nêu`);
    const app = String(a.window || a.app || '').trim();
    const steps = []; const note = (x) => { steps.push(x); deps.log && deps.log('desk', 'open_chat: ' + x); };
    // ensure_app trước: mở/khôi phục/đưa lên trước + chờ sẵn sàng (trừ khi vừa làm cho đúng ứng dụng này trong lượt)
    if (app) {
      const fresh = s.ensured && U.fold(s.ensured.app) === U.fold(app) && Date.now() - s.ensured.at < 120e3;
      if (!fresh) { const e = await ensureApp({ app }, ctx); if (e.fast) s.obs = null; if (e.error) { if (e.ask || e.code !== 'not-found') return { ...e, forModel: `open_chat: ${e.forModel}`, stop: true }; note(`chưa chuẩn bị được “${app}”: ${e.summary}`); try { await look({ window: app }, ctx); } catch {} } else note(`${e.summary}`); }
      else { try { await look({ window: app }, ctx); note(`chuyển tới “${app}”`); } catch (e) { note(`chưa chuyển được tới “${app}”: ${String(e.message).split('\n')[0]}`); } }
    }
    if (!s.obs) await observe(ctx, { thumb: false });
    // đã mở đúng người nhận sẵn → không làm gì thêm
    { const R = SV.regionsOf(s.obs); if (SV.chatShown(rcp, s.obs && s.obs.win ? s.obs.win.title : '', R ? R.header : [], s.aliases)) { return { forModel: `Cuộc trò chuyện với “${rcp}” đang mở sẵn (đã kiểm tiêu đề). ${ocNext(q)}`, summary: `“${rcp}” đang mở sẵn` }; } }
    const ak = U.appKeys((s.obs && s.obs.win && s.obs.win.proc) || (s.target && s.target.proc) || '', s.obs && s.obs.win ? s.obs.win.title : '');
    const searchEl = (s.obs ? s.obs.elements : []).find(e => (/^(?:tìm kiếm|tim kiem|search|find)\b/iu.test(String(e.name || e.placeholder || '').trim()) || (SV.placeholderLike(e.name || e.placeholder) && !/^(?:nhập|enter|type)/iu.test(String(e.name || e.placeholder || '').replace(/^[^\p{L}]+/u, '')))) && e.b);
    let r;
    if (searchEl) { r = await act({ action: 'click', element: searchEl.id }, ctx); note(`bấm ô “${searchEl.name || searchEl.placeholder}”`); }
    if ((!r || /không thay đổi rõ ràng/.test(String(r.forModel || ''))) && !/phím tắt/.test(String(r && r.forModel || ''))) { const keys = (ak && ak.search) || 'ctrl+f'; r = await act({ action: 'hotkey', keys }, ctx); note(`bấm ${keys} để mở ô tìm kiếm`); }
    const beforeT = s.obs; const compT = beforeT ? SV.findComposer(beforeT) : null;
    r = await act({ action: 'type_text', text: rcp, replace: true }, ctx); note(`gõ “${rcp}” vào ô tìm kiếm (đã xoá ô trước)`);
    if (r && (r.error || r.refused || r.stop)) return { ...r, summary: r.summary || 'không gõ được tên người nhận' };
    // B108/B109: phím tắt/bấm không mở được ô tìm kiếm → tên có thể đã vào Ô SOẠN TIN đang chọn → xoá ngay (không Enter), không làm tiếp
    { let L = null; try { L = beforeT && s.obs ? landedOf(beforeT, s.obs, rcp, compT && Array.isArray(compT.b) ? compT.b : null) : null; } catch {}
      if (L && L.landed === 'composer') { await clearFocused(); s.inSearch = null; s.searchMode = null; s.foundHit = null; note(`tên “${rcp}” đã vào Ô SOẠN TIN (ô tìm kiếm chưa mở) — đã xoá, không bấm Enter`);
        return { error: 'chưa mở được ô tìm kiếm', forModel: `open_chat: chưa mở được ô Tìm kiếm của ứng dụng — chữ “${rcp}” đã vào ô soạn tin nên AIVN đã XOÁ (không gửi). Bấm vào ô “Tìm kiếm” (screen_look query "Tìm kiếm" để lấy id) rồi gọi lại open_chat; nếu không thấy, báo người dùng.`, summary: 'chưa mở được ô tìm kiếm (đã xoá chữ gõ nhầm)' }; } }
    if (s.ambiguous && s.ambiguous.length && !s.foundHit) { const ask = `Có nhiều kết quả cho “${rcp}”: ${s.ambiguous.slice(0, 5).map(x => `“${x}”`).join(', ')}. Bạn muốn nhắn cho người nào?`; return { stop: true, ask, error: 'nhiều người cùng tên', forModel: ask, summary: 'nhiều kết quả cùng tên — hỏi bạn' }; }
    if (!s.foundHit) return { forModel: `${r && r.forModel ? r.forModel : ''}\nopen_chat: CHƯA thấy kết quả “${rcp}”. Báo người dùng không tìm thấy (đã thử: ${steps.join('; ')}), KHÔNG gõ nội dung.`, summary: `chưa thấy “${rcp}”` };
    const hit = { ...s.foundHit }; r = await act({ action: 'click', element: hit.id || rcp }, ctx); note(`bấm kết quả “${hit.name || rcp}”`);
    const ok = /Đã mở cuộc trò chuyện với/.test(String(r && r.forModel || ''));
    if (!ok) return { forModel: `${r && r.forModel ? r.forModel : ''}\nopen_chat: đã bấm kết quả nhưng CHƯA xác nhận được tiêu đề là “${rcp}”. KHÔNG gõ nội dung; quan sát lại (screen_look) hoặc báo người dùng.`, summary: `chưa xác nhận mở “${rcp}”` };
    // B122 (máy thật beta.2.6): mở chat xong, ô tìm kiếm vẫn còn “Cloud của tôi” + bảng kết quả → xoá ô tìm kiếm (nút Đóng/X, hoặc chọn hết + xoá + Esc) và KIỂM ô đã trống
    const sc = await clearChatSearch(rcp, note, ctx);
    return { searchCleared: sc.cleared, forModel: `Đã mở cuộc trò chuyện với “${rcp}” (đã kiểm tiêu đề). Các bước: ${steps.join('; ')}. ${ocNext(q)}\n${sc.screen ? 'Màn hình bây giờ (id mới, dùng các id này cho bước tiếp):\n' + sc.screen : String(r.forModel || '').split('\n').slice(2).join('\n')}`, summary: `đã mở “${rcp}”${sc.cleared ? '' : ' (ô tìm kiếm chưa xoá được)'}` };
  }
  // B86 (máy thật): chữ ký bước cho bộ chặn chu kỳ — phần tử THẬT đã nhắm (loại + tên, không phải id), chữ THẬT đã gõ (sau khi thay), và dấu vân tay màn hình sau thao tác
  const screenHash = (obs) => { try { const names = (obs && obs.elements || []).map(e => U.fold(String(e.name || e.value || '')).replace(/\d+/g, '#').trim()).filter(Boolean).sort();
    return require('crypto').createHash('sha1').update(`${obs && obs.win ? U.fold(obs.win.title || '') : ''}|${names.join('|')}`).digest('hex').slice(0, 12); } catch { return ''; } };
  async function act(a, ctx) {
    if (session) { session.curTarget = ''; session.curTyped = null; }
    try { const r = await actInner(a, ctx); const s = session;
      if (r && typeof r === 'object' && s) r.sig = { target: String(s.curTarget || '').slice(0, 80), typed: s.curTyped != null ? String(s.curTyped).slice(0, 80) : null, screen: screenHash(s.obs) };
      return r; }
    finally { const s = session; if (s) { const now = Date.now(); if (s.lastAction && !s.lastAction.doneAt) s.lastAction.doneAt = now; if (s.searchMode && !s.searchMode.at) s.searchMode.at = now; } }
  }
  async function actInner(a, ctx) {
    let action = String(a.action || '').toLowerCase(); action = ALIASES[action] || action;
    if (!ACT_LABEL[action]) throw new Error('action không hợp lệ: ' + a.action + '. Dùng: ' + Object.keys(ACT_LABEL).join(', '));
    const s = await begin(ctx);
    const budget = Number(S().agentScreenBudget) > 0 ? Number(S().agentScreenBudget) : 40;
    if (action !== 'wait' && ++s.actions > budget) return { error: `Đã dùng hết ${budget} thao tác cho lượt này`, forModel: `Đã dùng hết ${budget} thao tác màn hình cho lượt này. Dừng lại và báo người dùng những gì đã làm được.`, summary: 'hết số bước cho phép' };
    if (ctx.signal && ctx.signal.aborted) throw new Error('Đã dừng.');

    if (action === 'wait') { const sec = Math.max(0.2, Math.min(10, Number(a.seconds) || 1)); status(`Chờ ${sec} giây…`); await sleep(sec * 1000); const o = await observe(ctx, { thumb: true }); return { forModel: `Đã chờ ${sec} giây.\n${o.text}`, summary: `chờ ${sec} giây`, thumb: o.thumb }; }
    if (action === 'focus_window') {
      const q = String(a.window || a.element || a.target || '').trim(); if (!q) throw new Error('Cần tên cửa sổ (window).');
      status(`Đang chuyển tới cửa sổ “${q}”…`);
      const list = await U.windows(); const w = U.matchWindow(list, q);
      if (!w) return { error: 'không thấy cửa sổ', forModel: `Không thấy cửa sổ nào khớp "${q}". Các cửa sổ đang mở: ${list.map(x => `"${x.title}"${x.proc ? ' (' + x.proc + ')' : ''}`).slice(0, 15).join(', ') || '(không có)'}. Nếu ứng dụng chưa mở, dùng open_app.`, summary: 'không thấy cửa sổ ' + q };
      await U.focus(w); s.target = { hwnd: w.hwnd, pid: w.pid, proc: w.proc, title: w.title }; await sleep(500);
      const o = await observe(ctx);
      return { forModel: `Đã chuyển tới cửa sổ "${w.title}".\n${o.text}`, summary: `cửa sổ “${w.title}”`, thumb: o.thumb };
    }
    // B65 (Zalo thật: mô hình gõ NỘI DUNG “AIVN test 100%” vào ô tìm kiếm): mở cuộc trò chuyện bằng mã, không để mô hình tự gõ tên người nhận
    if (action === 'open_chat') return openChat(a, ctx);
    if (action === 'ensure_app') return ensureApp(a, ctx);
    if (action === 'hotkey') { // chặn tổ hợp hệ thống trước khi hỏi
      const k = require('./agent/keys').parse(a.keys);
      // B66d: Win+D / Win+M thu nhỏ mọi cửa sổ — chỉ khi người dùng xin “hiện màn hình chính”
      if (k.media) throw new Error(`Không bấm “${a.keys}” bằng phím tắt: âm lượng / phát nhạc cần xin phép — dùng công cụ hệ thống (system_action) để người dùng duyệt.`);
      if (k.hidesAll && !require('./agent/computer').sysAsked('show_desktop', (ctx && ctx.userQuery) || '')) throw new Error(`Không bấm “${a.keys}”: tổ hợp này thu nhỏ MỌI cửa sổ mà người dùng không yêu cầu. Làm trực tiếp trong cửa sổ ứng dụng (focus_window).`);
    }
    if (action === 'type_text' && !String(a.text || '')) throw new Error('Thiếu text cần gõ.');
    // 0.16: chữ kết thúc bằng xuống dòng = gõ rồi bấm Enter (dán "\n" không gửi được ở nhiều ứng dụng chat)
    if (action === 'type_text') { const raw = String(a.text); const tail = /\n\s*$/.test(raw); a = { ...a, text: tail ? raw.replace(/\s*\n\s*$/, '') : raw, submit: a.submit === true || a.submit === 'true' || tail }; if (!a.text.trim()) { if (a.submit) { action = 'hotkey'; a = { action: 'hotkey', keys: 'enter' }; } else throw new Error('Thiếu text cần gõ.'); } }

    if (!s.obs) await observe(ctx, { thumb: false });
    let needPoint = ['click', 'double_click', 'right_click'].includes(action) || ((action === 'type_text' || action === 'scroll') && (a.element || a.target || (a.x != null && a.y != null && !(Number(a.x) === 0 && Number(a.y) === 0))));
    let t = needPoint ? resolveTarget(a) : null;
    // B120 (máy thật beta.2.6): việc tìm trên web trong trình duyệt — mô hình BẤM ô “Tìm kiếm” của trang đang mở (YouTube) trước khi gõ
    // (mở menu gợi ý trong thẻ của người dùng). Không bao giờ bấm ô tìm kiếm của trang khi chưa tìm: mở THẺ MỚI (Ctrl+T) thay cho cú bấm đó.
    if ((action === 'click' || action === 'double_click') && ctx && ctx.userQuery && !s.webSearched && isBrowserWin(s.obs && s.obs.win) && webSearchTask(ctx.userQuery)) {
      const el = t && t.el ? t.el : null; const nm = `${el ? `${el.name || ''} ${el.placeholder || ''} ${el.autoId || ''}` : ''} ${a.element || a.target || ''}`;
      const ADDR0 = /address|địa chỉ|dia chi|\burl\b|omnibox|地址|网址/iu;
      if (SEARCHY_ANY.test(nm) && !ADDR0.test(nm)) {
        deps.log && deps.log('desk', `B120: tìm trên web — KHÔNG bấm ô tìm kiếm của trang (“${String(el ? el.name || '' : a.element || '').slice(0, 40)}”); mở THẺ MỚI (Ctrl+T), con trỏ ở thanh địa chỉ`);
        const hk = await act({ action: 'hotkey', keys: 'ctrl+t' }, ctx); if (hk && (hk.error || hk.refused)) return hk;
        return { ...(hk || {}), summary: 'mở thẻ mới (Ctrl+T) thay vì bấm ô tìm kiếm của trang', forModel: 'AIVN KHÔNG bấm ô tìm kiếm của trang đang mở (đó là thẻ của người dùng). Đã mở THẺ MỚI (Ctrl+T); con trỏ đang ở thanh địa chỉ. Bước tiếp: screen_act type_text với đúng từ khoá cần tìm (AIVN gõ vào thanh địa chỉ rồi bấm Enter).' };
      }
    }
    s.curTarget = t && t.el ? `${t.el.kind || (t.el.ocr ? 'ocr' : '')}:${t.el.name || t.el.value || ''}` : (t && t.query) || String(a.element || a.target || '');
    // gõ vào một nhãn chữ/nút (không phải ô nhập) là sai: gõ vào ô đang được chọn, không bấm vào nhãn
    // trừ chữ gợi ý của ô nhập chỉ thấy qua OCR (Zalo: "Tìm kiếm"): bấm vào đó để chọn ô rồi mới gõ
    // B21 (QA lượt 3): cụm chữ OCR → BẤM vào toạ độ của nó trước rồi mới gõ (không gõ mù vào ô đang chọn — đó có thể là ô soạn tin của chat sai).
    // Nhãn của cây giao diện (có ô nhập đi kèm đang được chọn) giữ cách cũ: gõ vào ô đang chọn.
    if (action === 'type_text' && t && t.el && !t.el.editable && !U.inputLike(t.el) && !t.el.ocr && !U.isButtonish(t.el)) { t = null; needPoint = false; }
    // B55: id kèm nhãn không còn khớp / id đã biến mất / gõ chữ vào NÚT → từ chối, chỉ ra đúng ô nhập
    { const inputs = (s.obs ? s.obs.elements : []).filter(e => e.editable || U.inputLike(e)).slice(0, 6);
      const hint = inputs.length ? ' Ô nhập hiện có: ' + inputs.map(e => `ô “${String(e.name || e.placeholder || '(không tên)').slice(0, 30)}” là ${e.id}`).join(', ') + '.' : '';
      if (t && t.labelChanged) { const L = t.labelChanged; return { refused: true, error: 'id đổi nhãn', forModel: `KHÔNG làm: ${L.id} giờ là ${L.now.kind || 'phần tử'} “${String(L.now.name || '').slice(0, 40)}”, không phải “${String(L.want).slice(0, 40)}”.${hint} Dùng đúng id trong danh sách MỚI NHẤT.`, summary: `${L.id} giờ là “${String(L.now.name || '').slice(0, 30)}” — không làm` }; }
      if (t && t.goneId) { const G = t.goneId; return { refused: true, error: 'id không còn', forModel: `KHÔNG làm: ${G.id} (${G.inf.kind || 'phần tử'} “${String(G.inf.name || '').slice(0, 40)}”) không còn trên màn hình.${hint} Quan sát lại (screen_look) rồi dùng id trong danh sách mới.`, summary: `${G.id} “${String(G.inf.name || '').slice(0, 30)}” không còn trên màn hình` }; }
      if (action === 'type_text' && t && t.el && U.isButtonish(t.el)) return { refused: true, error: 'không gõ vào nút', forModel: `KHÔNG gõ: ${t.el.id} là ${t.el.kind || 'nút'} “${String(t.el.name || '').slice(0, 40)}” — không gõ chữ vào nút/nhóm nút.${hint} Gọi lại type_text với element là id của ô nhập đúng.`, summary: `${t.el.id} là nút “${String(t.el.name || '').slice(0, 30)}” — không gõ vào nút` }; }
    // B34: vừa bấm ô Tìm kiếm (≤ 60 giây) mà type_text lại kèm id CŨ nay trỏ vào chữ/nút khác (không phải ô nhập, không phải “Tìm kiếm”) → bỏ id đó, gõ vào ô vừa chọn
    let staleEl = null;
    { const la = s.lastAction; const justSearch = inSearchMode() || la && Date.now() - (la.doneAt || la.at) < 60000 && ((['click', 'double_click'].includes(la.action) && /tìm|tim kiem|search|find/iu.test(`${la.query || ''} ${la.el ? la.el.name || '' : ''}`))
        || (la.action === 'hotkey' && /^(ctrl|cmd|command|meta)\+(f|k|e)$/i.test(String(la.keys || '').replace(/\s/g, '')))); // B64: vừa mở ô tìm kiếm bằng Ctrl+F/K (Zalo, Telegram, Teams…) → gõ vào ô đang chọn
      if (action === 'type_text' && justSearch && t && t.el && (t.el.ocr || (!t.el.editable && !U.inputLike(t.el))) && !/tìm|tim kiem|search|find/iu.test(`${t.el.name || ''} ${t.el.placeholder || ''}`)) { staleEl = t.el; t = null; needPoint = false; deps.log && deps.log('desk', `Vừa mở ô tìm kiếm (${la.action === 'hotkey' ? la.keys : 'bấm “Tìm kiếm”'}) — bỏ ${staleEl.id || 'phần tử'} “${String(staleEl.name || '').slice(0, 30)}”, gõ vào ô tìm kiếm đang chọn`); } }
    // B76 (QA lượt 8, Outlook o10): (1) chữ OCR là CHỮ ĐÃ GÕ trong một ô khác (Tiêu đề) → gõ vào đó sẽ chèn vào giữa chữ cũ; (2) cùng chữ vào cùng ô lần nữa
    // (id đổi theo chữ trong ô nên chống lặp theo id không bắt được) → khoá theo VỊ TRÍ ô + chữ gõ, không theo id
    if (action === 'type_text' && !(a.replace === true)) {
      const ft = U.fold(String(a.text || '')).trim(); const log = s.typedLog || [];
      const tb = t && t.el && Array.isArray(t.el.b) ? t.el.b : null;
      if (t && t.el && t.el.ocr && !U.inputLike(t.el) && !/tìm|tim kiem|search|find/iu.test(String(t.el.name || ''))) {
        const nm = U.fold(String(t.el.name || ''));
        const hit = log.slice().reverse().find(x => { const p = U.fold(x.text).trim().slice(0, 24); return p.length >= 4 && (nm.includes(p.slice(0, Math.min(8, p.length))) || U.fuzzyHas(nm, p.slice(0, Math.min(16, p.length)))); });
        if (hit) { const same = U.fold(hit.text).trim() === ft;
          deps.log && deps.log('desk', `Chặn gõ (B76): ${t.el.id} “${String(t.el.name || '').slice(0, 30)}” là chữ đã gõ trước đó (“${String(hit.text).slice(0, 30)}”)${same ? ' — gõ trùng' : ' — sẽ chèn vào giữa'}`);
          return { refused: true, error: same ? 'đã gõ chữ này rồi' : 'không gõ vào chữ đã có trong ô khác', forModel: same ? `KHÔNG gõ lại: “${String(hit.text).slice(0, 60)}” ĐÃ được gõ vào ô này rồi (chữ OCR “${String(t.el.name || '').slice(0, 40)}” chính là chữ đó, OCR có thể đọc sai dấu). Gõ lại sẽ bị TRÙNG. Làm bước tiếp theo (ô khác / nút khác).` : `KHÔNG gõ: ${t.el.id} “${String(t.el.name || '').slice(0, 40)}” là CHỮ ĐÃ GÕ trong một ô (lúc trước đã gõ “${String(hit.text).slice(0, 40)}” vào đó) — gõ vào đây sẽ chèn vào GIỮA chữ đó và làm hỏng ô. Bấm vào ĐÚNG ô cần gõ (vd. vùng nội dung/thân thư, ô soạn tin) rồi type_text KHÔNG kèm element.`, summary: same ? 'đã gõ chữ này vào ô này rồi — không gõ trùng' : `“${String(t.el.name || '').slice(0, 30)}” là chữ đã gõ trong ô khác — không gõ vào đó` }; }
      }
      const overlap = (p, q) => p && q && Math.abs((p[1] + p[3] / 2) - (q[1] + q[3] / 2)) <= Math.max(12, Math.min(p[3], q[3]) / 2 + 6) && p[0] < q[0] + q[2] + 40 && q[0] < p[0] + p[2] + 40;
      const dup = ft && log.find(x => U.fold(x.text).trim() === ft && ((tb && x.box && overlap(tb, x.box)) || (!tb && !x.box && s.lastAction && s.lastAction.action === 'type_text' && U.fold(String(s.lastTyped || '')).trim() === ft)));
      if (dup && !(s.inSearch || inSearchMode())) { deps.log && deps.log('desk', `Chặn gõ trùng (B76): “${String(a.text).slice(0, 30)}” đã gõ vào ô này`);
        return { refused: true, error: 'đã gõ chữ này rồi', forModel: `KHÔNG gõ lại: “${String(a.text).slice(0, 60)}” ĐÃ được gõ vào đúng ô này trong việc này (OCR có thể đọc sai dấu nên báo “chưa thấy”). Gõ lại sẽ bị TRÙNG. Nếu thật sự cần thay thì type_text với replace: true; nếu không thì làm bước tiếp theo.`, summary: 'đã gõ chữ này vào ô này rồi — không gõ trùng' }; }
    }
    if (needPoint && (!t || t.x == null)) {
      const q = t && t.query ? t.query : '';
      if (q && !U.isIdRef(q)) t = await groundWithVision(q, ctx) || t;
      if (!t || t.x == null) {
        const near = q ? s.obs.elements.filter(e => U.fold(e.name).split(' ').some(w => w.length > 2 && U.fold(q).includes(w))).slice(0, 8) : [];
        return { error: 'không thấy phần tử', forModel: `Không thấy phần tử "${q || '(trống)'}" trong lần quan sát mới nhất${U.isIdRef(q) ? ' (id cũ? hãy dùng id từ danh sách MỚI NHẤT)' : ''}. ${near.length ? 'Phần tử gần giống: ' + near.map(e => `[${e.id}] ${e.kind} "${e.name}"`).join('; ') + '.' : ''} Hãy gọi screen_look (có thể kèm query) để xem lại, hoặc cuộn (scroll) nếu phần tử nằm ngoài màn hình.`, summary: 'không thấy ' + (q || 'phần tử') };
      }
    }
    // mô hình nhỏ hay chép sai chữ hoa/dấu của đoạn người dùng đưa trong ngoặc kép: dùng đúng nguyên văn của người dùng
    if (action === 'type_text' && a.text && ctx && ctx.userQuery) a.text = U.restoreQuoted(String(a.text), ctx.userQuery);
    // mật khẩu: không bao giờ gõ
    let focusedEl = s.obs && s.obs.elements.find(e => e.focused);
    const pwEl = action === 'type_text' ? (t && t.el ? t.el : focusedEl) : null;
    if (action === 'type_text' && ((pwEl && pwEl.password) || (t && t.query && U.PASSWORD_NAME.test(t.query)))) {
      return { refused: true, forModel: 'AIVN AGENT KHÔNG BAO GIỜ gõ mật khẩu/mã PIN/OTP. Dừng lại và nhờ người dùng tự gõ vào ô này, rồi tiếp tục khi họ báo xong.', summary: 'không gõ mật khẩu' };
    }
    // gửi tin trong ứng dụng chat: bắt buộc đã tìm và mở đúng người nhận trong lượt này (không gõ vào chat đang mở sẵn)
    if (action === 'type_text' && ctx && ctx.userQuery) {
      const searchField = searchConfirmed(t, focusedEl, a);
      const R = SV.regionsOf(s.obs); const P = SV.parseSeen(s.lastSeen || '');
      const g = SV.chatGate({ query: ctx.userQuery, text: a.text, searchField, submit: !!a.submit, proc: s.obs && s.obs.win ? s.obs.win.proc : (s.target && s.target.proc) || '', title: s.obs && s.obs.win ? s.obs.win.title : '', state: s, header: [...(R ? R.header : []), P.header].filter(Boolean), ocrHeader: R ? R.header : [], seenHeader: P.header || null, composer: [...(R ? R.composer : []), ...((s.obs && s.obs.elements) || []).flatMap(e => [e.placeholder, e.name])].filter(Boolean) });
      if (!g && s.gateNote) { deps.log && deps.log('desk', `Chốt người nhận (B90): ${s.gateNote}`); s.gateNote = null; }
      if (g && s.askWho) { const q = s.askWho; s.askWho = null; deps.log && deps.log('desk', 'Chưa rõ người nhận → hỏi người dùng “Gửi cho ai?”'); return { error: 'chưa rõ người nhận', stop: true, ask: q, forModel: g, summary: 'chưa rõ người nhận — hỏi bạn' }; }
      if (g) {
        // B27: không để lặp vô tận — lần chặn thứ 3 trong lượt: dừng và báo người dùng (nêu những gì thấy trên màn hình)
        s.gateBlocks = (s.gateBlocks || 0) + 1; deps.log && deps.log('desk', `Chặn gõ tin: chưa mở đúng người nhận (lần ${s.gateBlocks})`);
        const hdrNow = [s.obs && s.obs.win ? s.obs.win.title : '', ...(R ? R.header : [])].filter(Boolean)[0] || '';
        if (s.gateBlocks >= 3) return { error: 'chưa mở đúng người nhận', stop: true, forModel: `ĐÃ BỊ CHẶN ${s.gateBlocks} lần vì màn hình vẫn chưa cho thấy cuộc trò chuyện với “${SV.recipientOf(ctx.userQuery)}”${hdrNow ? ` (đang thấy: “${String(hdrNow).slice(0, 60)}”)` : ''}. DỪNG, không thử lại nữa. Báo người dùng: chưa gửi được vì không xác nhận được đã mở đúng cuộc trò chuyện; nhờ họ mở cuộc trò chuyện đó rồi giao lại việc.`, summary: 'dừng: không xác nhận được người nhận' };
        const wrongEl = t && t.el && !/tìm|tim kiem|search|find/iu.test(`${t.el.name || ''} ${t.el.placeholder || ''}`) ? ` Phần tử [${t.el.id}] hiện là ${t.el.kind || 'phần tử'} “${String(t.el.name || '').slice(0, 40)}” — KHÔNG phải ô Tìm kiếm (id đổi sau mỗi lần quan sát). Cách đúng: screen_act click vào ô “Tìm kiếm” (lấy id MỚI bằng screen_look query "Tìm kiếm"), rồi type_text KHÔNG kèm element.` : '';
        return { error: 'chưa mở đúng người nhận', forModel: g + wrongEl, summary: wrongEl ? `[${t.el.id}] không phải ô Tìm kiếm — bấm ô Tìm kiếm rồi gõ` : 'chưa mở đúng người nhận — tìm người nhận trước' };
      }
    }
    // B114 (máy thật beta.2.5, kịch bản A): Chrome đang mở YouTube → mô hình gõ từ khoá vào Ô TÌM KIẾM CỦA TRANG, gõ 2 lần không xoá.
    // Việc TÌM TRÊN WEB trong trình duyệt: từ khoá chỉ gõ vào THANH ĐỊA CHỈ của một THẺ MỚI (Ctrl+T — không đụng thẻ người dùng đang xem),
    // chọn hết rồi gõ (thay chữ cũ) + Enter. Không bao giờ gõ vào ô tìm kiếm riêng của trang khác (trừ khi người dùng nêu trang đó).
    if (action === 'type_text' && ctx && ctx.userQuery && !a.__clear && !a.__b114 && isBrowserWin(s.obs && s.obs.win) && webSearchTask(ctx.userQuery) && SV.textFromRequest(ctx.userQuery, a.text)) {
      const la = s.lastAction; const recentKeys = la && Date.now() - (la.doneAt || la.at) < 60000 && /^(?:(?:ctrl|cmd|command|meta)\+[lt]|alt\+d|f6)$/i.test(String(la.keys || '').replace(/\s/g, ''));
      const ADDR = /address|địa chỉ|dia chi|\burl\b|omnibox|地址|网址/iu; const tgt = t && t.el ? t.el : (focusedEl && !focusedEl.ocr ? focusedEl : null);
      const inAddr = recentKeys || !!(tgt && ADDR.test(`${tgt.name || ''} ${tgt.autoId || ''} ${tgt.placeholder || ''}`));
      if (!inAddr) {
        deps.log && deps.log('desk', `B114: tìm trên web — không gõ “${String(a.text).slice(0, 40)}” vào ô của trang đang mở; mở THẺ MỚI (Ctrl+T) rồi gõ vào thanh địa chỉ + Enter`);
        const hk = await act({ action: 'hotkey', keys: 'ctrl+t' }, ctx); if (hk && (hk.error || hk.refused)) return hk;
        await sleep(500);
        const r = await act({ action: 'type_text', text: String(a.text).replace(/\n\s*$/, ''), submit: true, replace: true, __b114: true }, ctx);
        s.webSearched = true;
        if (r && typeof r === 'object' && r.forModel) r.forModel = `AIVN đã mở THẺ MỚI (Ctrl+T) và tìm “${String(a.text).slice(0, 60)}” trên thanh địa chỉ (không gõ vào ô tìm kiếm của trang đang mở).\n${r.forModel}`;
        return r;
      }
      s.webSearched = true; // B120: đã tìm trên thanh địa chỉ — từ đây bấm trong trang kết quả là bình thường
      if (!a.replace) a = { ...a, replace: true }; // thanh địa chỉ: chọn hết rồi gõ (không gõ nối vào chữ cũ)
      if (!a.submit) a = { ...a, submit: true }; // thanh địa chỉ: gõ xong bấm Enter để tìm (B120: sau Ctrl+T mô hình chỉ gõ từ khoá)
    }
    // B108 (máy thật beta.2.5, AN TOÀN): trong ứng dụng chat, chữ gõ vào ô KHÔNG phải ô tìm kiếm đã xác nhận (ô soạn tin, ô đang chọn) phải lấy từ
    // yêu cầu của người dùng — không gõ lời chào tự bịa, không gõ “@tên” (nhắc tên) vào ô đang chọn. Gõ tên người nhận để tìm thì do chatGate xét.
    if (action === 'type_text' && ctx && ctx.userQuery && !a.__clear) {
      const qB = String(ctx.userQuery); const procB = s.obs && s.obs.win ? s.obs.win.proc : (s.target && s.target.proc) || '';
      if (SV.isChatContext(qB, procB, s.obs && s.obs.win ? s.obs.win.title : '')) {
        const fromReq = SV.textFromRequest(qB, a.text); const rcpB = SV.recipientOf(qB) || s.chatOpen || null;
        const atName = /^\s*@/.test(String(a.text || '')) && !fromReq;
        const sField = searchConfirmed(t, focusedEl, a);
        if (atName || (!sField && !fromReq && !SV.nameLikeText(a.text, rcpB) && !SV.typingName(a.text, rcpB || ''))) {
          deps.log && deps.log('desk', `Chặn gõ (B108): “${String(a.text || '').slice(0, 40)}” không có trong yêu cầu của người dùng${atName ? ' (gõ “@tên” vào ô đang chọn)' : ''}`);
          if (SV.msgSend(qB) && !atName) { const ask = askText(qB); return { refused: true, stop: true, ask, error: 'nội dung không có trong yêu cầu', forModel: ask, summary: 'không gõ — nội dung không có trong yêu cầu, hỏi bạn' }; }
          return { refused: true, error: 'nội dung không có trong yêu cầu', forModel: `KHÔNG gõ “${String(a.text || '').slice(0, 40)}”: ${atName ? 'không gõ “@tên” vào ô đang chọn (đó là nhắc tên trong ô soạn tin, không phải tìm). ' : ''}chữ này không có trong yêu cầu của người dùng. AIVN chỉ gõ vào ô soạn tin đúng nội dung người dùng đã nêu (trong ngoặc kép hoặc nói rõ). Yêu cầu không có nội dung tin → KHÔNG gõ, KHÔNG gửi gì. Nếu việc là mở cuộc trò chuyện: tìm tên người nhận trong ô Tìm kiếm của ứng dụng, bấm vào kết quả, rồi trả lời người dùng.`, summary: 'không gõ — nội dung không có trong yêu cầu' };
        }
      }
    }
    // B94 (máy thật beta.2.2: tin bị gõ vào ô TÌM KIẾM còn chữ “Cloud”): việc gửi/nhắn tin, gõ NỘI DUNG tin → chỉ gõ khi con trỏ ở Ô SOẠN TIN.
    // Chưa chắc → AIVN tự bấm vào ô soạn (“Nhập @, tin nhắn tới …”), xoá chữ còn sót trong ô tìm kiếm nếu con trỏ đang ở đó; vẫn không ở ô soạn → từ chối gõ.
    let bodyTyping = false;
    if (action === 'type_text' && ctx && ctx.userQuery && !a.__clear) {
      const rcpB = SV.recipientOf(ctx.userQuery) || s.chatOpen || null;
      const msgTask = !!(SV.msgSend(ctx.userQuery) && (rcpB || s.chatOpen)) && SV.isChatContext(ctx.userQuery, s.obs && s.obs.win ? s.obs.win.proc : '', s.obs && s.obs.win ? s.obs.win.title : ''); // chỉ ứng dụng chat (thư điện tử có ô Tiêu đề/thân thư riêng)
      if (msgTask && !SV.nameLikeText(a.text, rcpB) && !(s.inSearch && Date.now() - s.inSearch < SEARCH_MS() && !s.chatOpen)) {
        bodyTyping = true;
        const win = s.obs && s.obs.win;
        const uiaFocus = focusedEl && !focusedEl.ocr ? focusedEl : null;
        const la = s.lastAction;
        const tIsComp = !!(t && ((t.el && SV.isComposerEl(t.el, win)) || (!t.el && t.query && SV.isComposerEl({ name: t.query }, win))));
        const focusOk = tIsComp || (uiaFocus ? SV.isComposerEl(uiaFocus, win) : !!(s.composerFocus && la && (la.action === 'type_text' || (['click', 'double_click'].includes(la.action) && SV.isComposerEl(la.el || { name: la.query }, win)))));
        if (!focusOk) {
          const comp = SV.findComposer(s.obs) || draftEl(s.obs); // B102: chữ gợi ý ô soạn đã biến mất vì ô còn chữ AIVN gõ trước → nhận ô theo chữ đó
          // không đọc được ô soạn (Messenger “Aa”, OCR bỏ sót) và KHÔNG có dấu hiệu con trỏ ở ô khác → cho gõ, kiểm chữ sau khi gõ (vào nhầm ô → báo + xoá)
          const elsewhere = !!(uiaFocus && !SV.isComposerEl(uiaFocus, win)) || searchConfirmed(null, null, a) || !!SV.searchLeftover(s.obs) || !!SV.searchClose(s.obs);
          if (!comp && !elsewhere) { deps.log && deps.log('desk', 'B94: không đọc được ô soạn tin nhưng không thấy dấu hiệu con trỏ ở ô khác — gõ rồi kiểm chữ có ở ô soạn không'); }
          else if (!comp) {
            deps.log && deps.log('desk', 'Chặn gõ tin (B94): không thấy ô soạn tin, con trỏ có thể đang ở ô khác');
            return { refused: true, error: 'không thấy ô soạn tin', forModel: `KHÔNG gõ nội dung tin: chưa thấy Ô SOẠN TIN (ô “Nhập @, tin nhắn tới …” / “Type a message” ở đáy khung chat) và con trỏ có thể đang ở ô khác (ô tìm kiếm…). Gọi screen_look rồi bấm vào ô soạn tin (screen_act click element = id ô soạn) trước khi gõ.`, summary: 'chưa gõ — chưa thấy ô soạn tin' };
          }
          if (comp) {
            // con trỏ đang ở ô tìm kiếm (đọc được, hoặc vừa tìm) → xoá chữ còn sót trước khi rời ô
            const inSearchBox = (uiaFocus && /tìm|tim kiem|search|find|搜索/iu.test(`${uiaFocus.name || ''} ${uiaFocus.autoId || ''} ${uiaFocus.placeholder || ''}`)) || (!uiaFocus && searchConfirmed(null, null, a));
            const left = SV.searchLeftover(s.obs);
            deps.log && deps.log('desk', `B94: hàng ô tìm kiếm: “${String(SV.searchRowText(s.obs)).slice(0, 80)}” → ${left ? 'còn chữ “' + String(left.name || left.value || '').slice(0, 30) + '”' : 'không thấy chữ sót'}`);
            const closeBtn = !left && !inSearchBox ? SV.searchClose(s.obs) : null;
            if (closeBtn) { await refocus(); await performAt('click', closeBtn.x, closeBtn.y, { __el: null, __q: 'Đóng', __notSend: true }); await sleep(250); deps.log && deps.log('desk', 'B94: ô tìm kiếm đang mở (thấy nút “Đóng”) — bấm “Đóng” để xoá chữ còn sót trước khi chuyển sang ô soạn tin'); }
            if (inSearchBox || left) {
              await refocus();
              if (left && !(uiaFocus && left === uiaFocus)) await performAt('click', left.b[0] + Math.min(left.b[2] / 2, 30), left.b[1] + left.b[3] / 2, { __el: left, __q: left.name, __notSend: true });
              await clearFocused(); deps.log && deps.log('desk', `B94: xoá chữ còn sót trong ô tìm kiếm${left ? ` (“${String(left.name || left.value || '').slice(0, 30)}”)` : ''} trước khi chuyển sang ô soạn tin`);
            }
            await refocus();
            await performAt('click', comp.b[0] + comp.b[2] / 2, comp.b[1] + comp.b[3] / 2, { __el: comp, __q: comp.name, __notSend: true });
            deps.log && deps.log('desk', `B94: bấm vào ô soạn tin “${String(comp.placeholder || comp.name || '').slice(0, 50)}” trước khi gõ nội dung tin`);
            s.searchMode = null; s.inSearch = null; // B112: đã rời ô tìm kiếm
            await sleep(350);
            await observe(ctx, { ocr: 'auto', thumb: false });
            const f2 = s.obs && s.obs.elements.find(e => e.focused && !e.ocr);
            if (f2 && !SV.isComposerEl(f2, s.obs.win)) {
              s.composerFocus = false;
              deps.log && deps.log('desk', `Chặn gõ tin (B94): đã bấm ô soạn tin nhưng con trỏ ở “${String(f2.name || f2.kind || '').slice(0, 40)}”`);
              return { refused: true, error: 'con trỏ không ở ô soạn tin', forModel: `KHÔNG gõ nội dung tin: đã bấm ô soạn tin nhưng con trỏ vẫn ở [${f2.id}] ${f2.kind || ''} “${String(f2.name || '').slice(0, 40)}”, không phải ô soạn tin. Gọi screen_look rồi bấm đúng ô soạn tin.`, summary: 'chưa gõ — con trỏ không ở ô soạn tin' };
            }
            focusedEl = f2 || null;
            const comp2 = SV.findComposer(s.obs) || comp;
            t = { el: comp2, via: 'ô soạn tin (AIVN tự bấm)', query: comp2.placeholder || comp2.name, composerBox: Array.isArray(comp2.b) ? comp2.b.slice() : null };
            s.lastAction = { action: 'click', el: comp2, at: Date.now(), doneAt: Date.now(), query: String(comp2.name || '') }; s.focusProxy = 'c:' + U.fold(String(comp2.name || comp2.placeholder || '')).slice(0, 40);
          }
        } else if (t && t.el && Array.isArray(t.el.b)) t = { ...t, composerBox: t.el.b.slice() };
        s.composerFocus = true;
        // B104: ô soạn còn chữ AIVN gõ trước đó (chưa gửi) → xoá trước khi gõ lại, tránh tin bị lặp chữ
        { const dE = draftEl(s.obs); if (dE) { await clearFocused(); deps.log && deps.log('desk', `B104: xoá chữ AIVN gõ trước đó còn trong ô soạn (“${String(s.draftTyped.text).slice(0, 40)}”) trước khi gõ lại`); s.draftTyped = null; await sleep(250); try { await observe(ctx, { ocr: 'auto', thumb: false }); } catch {} } }
        if (!(t && t.composerBox)) { const c0 = SV.findComposer(s.obs); if (c0 && Array.isArray(c0.b)) t = { ...(t || {}), composerBox: c0.b.slice() }; }
      }
    }
    // B101 (máy thật beta.2.4: gõ đúng vào ô soạn rồi mô hình KHÔNG bấm Enter, đi bấm lung tung tới hết giờ): việc GỬI tin, người nhận đã chốt (B90),
    // gõ NỘI DUNG tin → AIVN tự gửi trong cùng bước: gõ → kiểm chữ nằm trong ô soạn → bấm Enter → kiểm bong bóng tin + ô soạn trống.
    // Bước này là bước GỬI: vẫn qua thẻ xin phép (QA: --approve-send-to). Lệnh “chỉ soạn / đừng gửi” → không tự gửi.
    if (bodyTyping && action === 'type_text' && !a.submit && s.chatOpen && !DRAFT_SEND.test(String(ctx.userQuery || ''))) {
      a = { ...a, submit: true, __autoSubmit: true };
      deps.log && deps.log('desk', `B101: việc gửi tin, người nhận đã chốt — AIVN tự bấm Enter sau khi gõ và kiểm chữ trong ô soạn (bước GỬI, qua thẻ xin phép)`);
    }
    // B24: gõ tên/từ khoá (+ Enter) vào ô tìm kiếm ĐÃ XÁC NHẬN là TÌM, không phải gửi — không coi là bước rủi ro, kể cả chế độ “chỉ soạn, đừng gửi”
    // B69: MỘT chốt quyết định thao tác nào là GỬI (agent/send-gate.js) — gõ + Enter, phím Enter/Ctrl+Enter sau khi gõ, bấm nút Gửi…
    const SG = require('./agent/send-gate');
    const gateState = () => {
      const qG = ctx && ctx.userQuery ? String(ctx.userQuery) : '';
      const tName = `${t && t.el ? t.el.name || '' : ''} ${t && t.query ? t.query : String(a.element || a.target || '')}`;
      const W = s.obs && s.obs.win && Array.isArray(s.obs.win.b) && s.obs.win.b[3] > 50 ? s.obs.win.b : null;
      const inComposerRow = !!(t && t.el && Array.isArray(t.el.b) && W && (t.el.b[1] + t.el.b[3] / 2 - W[1]) / W[3] > 0.8);
      return { chatOpen: !!s.chatOpen, recipient: qG ? SV.recipientOf(qG) : null, messaging: !!(qG && SV.msgSend(qG)), searchTarget: searchConfirmed(t, focusedEl, a), lastTyped: s.lastTyped || '', targetName: tName, inComposerRow };
    };
    const gate = SG.classify(action, a, gateState());
    const gateRcp = (ctx && ctx.userQuery ? SV.recipientOf(ctx.userQuery) : null) || s.chatOpen || s.currentChat || '';
    // B108: bước GỬI (gõ + Enter, phím Enter, nút Gửi, thẻ xin phép gửi) chỉ khi nội dung tin lấy từ yêu cầu của người dùng.
    // Ứng dụng chat: chữ phải có trong yêu cầu. Nơi khác (thư điện tử…): yêu cầu phải là việc gửi/soạn tin.
    if (gate.send) {
      const qS = String((ctx && ctx.userQuery) || ''); const txS = gate.text || s.lastTyped || (action === 'type_text' ? a.text : '') || '';
      const chatS = SV.isChatContext(qS, s.obs && s.obs.win ? s.obs.win.proc : (s.target && s.target.proc) || '', s.obs && s.obs.win ? s.obs.win.title : '');
      const okS = chatS ? SV.textFromRequest(qS, txS) : (SV.msgSend(qS) || SV.textFromRequest(qS, txS));
      if (!okS) {
        deps.log && deps.log('desk', `Chặn bước GỬI (B108): nội dung “${String(txS).slice(0, 40)}” không có trong yêu cầu của người dùng — không xin phép, không gửi`);
        if (SV.msgSend(qS)) { const ask = askText(qS); return { refused: true, stop: true, ask, error: 'không gửi nội dung tự bịa', forModel: ask, summary: 'không gửi — nội dung không có trong yêu cầu, hỏi bạn' }; }
        return { refused: true, error: 'không gửi nội dung tự bịa', forModel: `KHÔNG GỬI: ${txS ? `nội dung “${String(txS).slice(0, 40)}”` : 'tin này'} không có trong yêu cầu của người dùng. AIVN không bao giờ tự bịa tin nhắn để gửi. Nếu việc chỉ là mở cuộc trò chuyện thì dừng ở đó và trả lời người dùng; nếu người dùng muốn gửi tin, hỏi họ nội dung chính xác.`, summary: 'không gửi — nội dung không có trong yêu cầu' };
      }
    }
    if (gate.send) {
      const sendText = gate.text || s.lastTyped || '';
      // B70: đã bấm gửi (người nhận, nội dung) này một lần trong việc → không bao giờ tự gửi lại (tránh gửi TRÙNG cho người thật)
      s.sentKeys = s.sentKeys || new Set();
      if (s.sentKeys.has(SG.sendKey(gateRcp, sendText)) || (gate.kind !== 'type_enter' && s.sentAny && !s.lastTyped)) {
        const msgDup = `Mình đã bấm gửi tin “${String(sendText || s.lastSent || '').slice(0, 60)}”${gateRcp ? ` tới “${gateRcp}”` : ''} một lần rồi. Để tránh gửi TRÙNG, mình không gửi lại — bạn mở cuộc trò chuyện kiểm tra giúp mình nhé.`;
        deps.log && deps.log('desk', `Chặn gửi lại (B70): ${describeAct(action, a, t)} — đã gửi một lần trong việc này`);
        return { refused: true, stop: true, error: 'không gửi lại', ask: msgDup, forModel: msgDup, summary: 'không gửi lại (đã gửi một lần)' };
      }
      // B69: gõ + Enter vào “ô đang chọn” → ô đó phải là ô SOẠN TIN, không phải ô tìm kiếm
      if (action === 'type_text' && !(t && t.x != null)) {
        const SEARCHY = /tìm|tim kiem|search|find/iu; const la = s.lastAction;
        const focusSearch = (focusedEl && SEARCHY.test(`${focusedEl.name || ''} ${focusedEl.autoId || ''} ${focusedEl.placeholder || ''}`))
          || (!focusedEl && la && ((la.action === 'hotkey' && /^(ctrl|cmd|command|meta|control)\+(f|k|e)$/i.test(SG.normKeys(la.keys))) || (['click', 'double_click'].includes(la.action) && SEARCHY.test(`${la.query || ''} ${la.el ? la.el.name || '' : ''}`)) || (la.action === 'type_text' && s.inSearch)));
        if (focusSearch) {
          const comp = (s.obs ? s.obs.elements : []).find(e => /nhập.*tin nhắn|nhap.*tin nhan|tin nhắn tới|type a message|write a message|send a message|^message\b|输入消息|发消息|^aa$/iu.test(String(e.name || e.placeholder || '').trim()));
          if (comp && Array.isArray(comp.b)) { t = { el: comp, x: comp.b[0] + comp.b[2] / 2, y: comp.b[1] + comp.b[3] / 2, via: comp.ocr ? 'OCR' : 'cây giao diện', query: comp.name }; deps.log && deps.log('desk', `Ô đang chọn có thể là ô TÌM KIẾM — bấm vào ô soạn tin “${String(comp.name || '').slice(0, 30)}” trước khi gõ + Enter`); }
          else { deps.log && deps.log('desk', 'Chặn gõ + Enter: ô đang chọn có thể là ô tìm kiếm, không thấy ô soạn tin'); return { refused: true, error: 'ô đang chọn không phải ô soạn tin', forModel: 'KHÔNG gõ + Enter: ô đang chọn có thể là ô TÌM KIẾM, không phải ô soạn tin. Bấm vào ô soạn tin (screen_act click element = id ô soạn) rồi type_text kèm element đó.', summary: 'ô đang chọn có thể là ô tìm kiếm — chưa gõ' }; }
        }
      }
    }
    const searchTyping = !gate.send && action === 'type_text' && !/\n/.test(String(a.text)) && String(a.text).length <= 80 && searchConfirmed(t, focusedEl, a);
    // B63 (Zalo thật): gõ vào ô tìm kiếm → luôn xoá sạch ô trước (Ctrl+A, Delete), không bao giờ gõ chồng lên chữ cũ (“nhóm AIVN testnhóm AIVN tes”);
    // “nhóm/group/群 X” → tìm “X” trước (tiêu đề chấp nhận cả “X” lẫn “nhóm X”), không ra kết quả thì thử lại một lần với nguyên dạng
    if (searchTyping) {
      a = { ...a, __clear: true };
      // B65: việc gửi tin có người nhận → ô tìm kiếm chỉ nhận TÊN người nhận (hoặc một phần/biến thể không dấu của tên), không nhận nội dung tin
      { const rcpS = ctx && ctx.userQuery && SV.isChatContext(ctx.userQuery, s.obs && s.obs.win ? s.obs.win.proc : '', s.obs && s.obs.win ? s.obs.win.title : '') ? SV.recipientOf(ctx.userQuery) : null;
        if (rcpS) { const ty = U.fold(String(a.text)).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim(); const nf = U.fold(rcpS).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim(); const nk = SV.nameKey(rcpS);
          const okText = ty === nf || ty === nk || (ty.length >= 2 && (nf.includes(ty) || nk.includes(ty)));
          if (!okText) { deps.log && deps.log('desk', `Ô tìm kiếm: mô hình định gõ “${String(a.text).slice(0, 40)}” — không phải tên người nhận; gõ “${rcpS}”`); a = { ...a, text: rcpS }; } } }
      const full = String(a.text).trim(); const m = /^(?:nhóm|nhom|group|群组|群組|群)\s*(.{2,})$/iu.exec(full);
      if (m && !(s.searches || []).some(x => x.text === m[1].trim())) { s.searchFull = full; a = { ...a, text: m[1].trim() }; deps.log && deps.log('desk', `Tìm “${a.text}” (bỏ chữ “${full.slice(0, full.length - m[1].length).trim()}” đứng đầu; không ra thì thử nguyên “${full}”)`); }
    }
    // B96 (máy thật beta.2.2: bấm “marketing cleaned data.xlsx” ở danh sách File → Excel mở tệp): việc gửi/nhắn tin không bấm vào tệp / tệp đính kèm / ảnh xem trước.
    // Việc có nhắc tới tệp → vẫn phải xin phép (kể cả “không cần hỏi lại”). Hộp thoại chọn tệp (Mở/Đính kèm) không tính: chọn tệp ở đó không mở tệp.
    let forceAsk = null;
    if (['click', 'double_click'].includes(action) && ctx && ctx.userQuery && !s.dialog) {
      const nmF = String((t && t.el && t.el.name) || (t && t.query && !U.isIdRef(String(t.query)) ? t.query : '') || '').trim();
      const msgTaskF = SV.msgSend(ctx.userQuery) || !!SV.recipientOf(ctx.userQuery);
      if (msgTaskF && nmF && (SV.isFileTarget(nmF, t && t.el) || SV.fileAt(t && t.el, s.obs))) {
        if (!SV.wantsFiles(ctx.userQuery)) {
          deps.log && deps.log('desk', `Chặn bấm tệp (B96): “${nmF.slice(0, 60)}” — việc gửi tin không mở tệp`);
          return { refused: true, error: 'không mở tệp', forModel: `KHÔNG bấm “${nmF.slice(0, 60)}”: đây là tệp / tệp đính kèm, bấm vào sẽ MỞ tệp bằng ứng dụng khác — việc này chỉ là gửi tin, không cần mở tệp. Bấm vào Ô SOẠN TIN (“Nhập @, tin nhắn tới …”) ở đáy khung chat rồi gõ tin.`, summary: 'không mở tệp (không thuộc việc gửi tin)' };
        }
        forceAsk = `mở tệp “${nmF.slice(0, 60)}” — có thể mở bằng ứng dụng khác`;
      }
    }
    const desc = describeAct(action, a, t);
    const risk = forceAsk || (gate.send ? `${gate.why} — tin sẽ được GỬI đi, không hoàn tác được` : searchTyping ? null : riskOf(action, { el: t && t.el, query: t && t.query, text: action === 'type_text' && a.submit ? a.text + '\n' : a.text, keys: a.keys, lastAction: s.lastAction }));
    const mode = S().agentScreenMode === 'important' ? 'important' : 'each';
    const box = t && t.x != null ? (t.el ? rectNorm(t.el.b) : t.box || (() => { const n = nativeToNorm(t.x, t.y); return { x1: n.nx - 0.012, y1: n.ny - 0.012, x2: n.nx + 0.012, y2: n.ny + 0.012 }; })()) : null;
    if (box) ov('target', { box, label: desc });
    // 0.16 “Tự làm không hỏi”: bước thường không hỏi; GỬI chỉ không hỏi khi nội dung đúng là tin người dùng đã nêu; xoá chỉ khi nêu đích danh
    const auto = ctx && ctx.auto;
    let autoGo = false;
    if (auto && auto.on && !forceAsk) {
      if (!risk) autoGo = AU.skipAsk(auto, 'desk-step');
      else {
        const elName = String((t && t.el && t.el.name) || (t && t.query) || '');
        const sendText = action === 'type_text' ? String(a.text || '').replace(/\n+$/, '') : s.lastTyped || '';
        const isSend = gate.send;
        autoGo = isSend ? AU.skipAsk(auto, 'desk-send', { text: sendText }) : AU.skipAsk(auto, 'desk-risk', { what: risk + ' ' + elName, named: elName });
      }
      if (autoGo) deps.log && deps.log('desk', `Tự làm không hỏi (${auto.why}): ${desc}`);
    }
    if (!autoGo && (mode === 'each' || risk)) {
      status(risk ? 'Cần bạn cho phép bước quan trọng' : 'Chờ bạn cho phép');
      const crop = s.shot ? thumbOf(s.shot).src : null;
      const logWho = gate.send && gateRcp ? ` · người nhận “${gateRcp}”` : '';
      deps.log && deps.log('desk', `Xin phép (đã hỏi)${gate.send ? ' — bước GỬI' : risk ? ' — bước quan trọng' : ''}: screen_act ${action} · ${desc}${logWho}`);
      // B93: thẻ GỬI mang đúng tên người nhận (theo lệnh) + tên cuộc trò chuyện đang hiện trên màn hình (tiêu đề khung giữa / chữ gợi ý ô soạn)
      const sendInfo = gate.send ? (() => { const sendText = action === 'type_text' ? String(a.text || '').replace(/\n+$/, '') : s.lastTyped || ''; let shown = null;
        try { const R = SV.regionsOf(s.obs); const P0 = SV.parseSeen(s.lastSeen || '');
          // B97: cùng đầu vào + cùng cách làm sạch với cổng người nhận (B90); kèm kết quả cổng đã chốt trong lượt này (chatOpen + chữ gợi ý ô soạn đã khớp)
          shown = { header: SV.cleanHeader([...(R ? R.header : []), P0.header].filter(Boolean)).slice(0, 4), headerRaw: R ? R.header.slice(0, 4) : [], gate: { chatOpen: s.chatOpen || null, placeholder: s.placeholderSeen && s.placeholderSeen.key === s.chatOpen ? s.placeholderSeen.name : null, openedBy: s.openedBy || null }, composer: SV.composerTarget([...(R ? R.composer : []), ...((s.obs && s.obs.elements) || []).flatMap(e => [e.placeholder, e.name])].filter(Boolean)), title: s.obs && s.obs.win ? s.obs.win.title : '' }; } catch {}
        return { send: true, recipient: gateRcp || null, sendText, shown }; })() : {};
      if (ctx.signal && ctx.signal.aborted) throw new Error('Đã dừng.'); // B117: không hiện thẻ sau hạn chót
      const r = await ask({ action, title: risk ? '⚠ Bước quan trọng — kiểm tra kỹ' : 'AIVN AGENT muốn làm bước này', desc: desc.charAt(0).toUpperCase() + desc.slice(1), risk, text: action === 'type_text' ? String(a.text) : null,
        window: s.obs && s.obs.win ? s.obs.win.title : '', image: s.shot ? s.shot.dataUrl : crop, box, via: t ? t.via : null, mode, ...sendInfo }, ctx.signal);
      deps.log && deps.log('desk', `Xin phép: người dùng ${r.ok ? 'CHO PHÉP' : r.timeout ? 'không trả lời (hết giờ)' : 'TỪ CHỐI'} — screen_act ${action} · ${desc}${logWho}${r.reason ? ` · lý do “${String(r.reason).slice(0, 80)}”` : ''}`);
      if (!r.ok && r.cancelled) { ov('target', { box: null }); s.lastAction = null; deps.log && deps.log('desk', `B117: thẻ xin phép bị huỷ (${r.reason}) — không làm bước: ${desc}`); throw new Error('Đã dừng.'); }
      if (!r.ok && r.timeout) { // B25: không ai trả lời thẻ ≠ người dùng từ chối
        ov('target', { box: null }); s.lastAction = null;
        return { refused: true, timeout: true, forModel: `Không ai trả lời thẻ xin phép trong 3 phút (HẾT THỜI GIAN CHỜ) nên bước “${desc}” CHƯA được làm. Người dùng KHÔNG từ chối — có thể họ đang không ở máy. Dừng lại và báo: bước này chưa làm vì chưa được duyệt kịp; người dùng có thể giao lại việc khi sẵn sàng. Không được nói là người dùng không đồng ý.`, summary: 'hết thời gian chờ duyệt' };
      }
      if (!r.ok) {
        ov('target', { box: null });
        const reason = String(r.reason || '').trim();
        s.lastAction = null;
        // B93 (máy thật beta.2.1): bị từ chối bước GỬI (không kèm góp ý sửa, hoặc lời từ chối dứt khoát của QA) → DỪNG lượt, câu cuối nói rõ CHƯA gửi
        // và dùng ĐÚNG tên người nhận (mô hình từng tự đổi thành “Cloud của bạn” và hỏi lại “bạn có muốn gửi không?”)
        if (gate.send && (!reason || r.final)) {
          const who = sendInfo.recipient || ''; const msg = String(sendInfo.sendText || '').slice(0, 120);
          deps.log && deps.log('desk', `Bước GỬI bị từ chối → dừng lượt, không gửi${who ? ` (người nhận “${who}”)` : ''}`);
          return { refused: true, stop: true, sendRefused: { recipient: who, text: msg }, error: 'bước gửi bị từ chối', forModel: `Bước GỬI tin${who ? ` tới “${who}”` : ''} đã bị TỪ CHỐI — tin CHƯA được gửi.`, summary: 'bị từ chối' + (reason ? ': ' + reason.slice(0, 60) : '') };
        }
        return { refused: true, forModel: `Người dùng KHÔNG cho phép: ${desc}.${reason ? ` Lý do của người dùng: "${reason.slice(0, 300)}". Hãy làm theo góp ý này.` : ' Dừng thao tác này và hỏi người dùng muốn làm gì.'}`, summary: 'bị từ chối' + (reason ? ': ' + reason.slice(0, 60) : '') };
      }
      if (r.mode === 'important' && mode !== 'important' && deps.setSettings) deps.setSettings({ agentScreenMode: 'important' });
      await refocus();
    } else { await sleep(450); } // để người dùng kịp thấy khung đỏ
    if (ctx.signal && ctx.signal.aborted) throw new Error('Đã dừng.');
    status(desc.charAt(0).toUpperCase() + desc.slice(1) + '…');
    const before = s.obs; const beforeDialog = s.dialog || null; const beforeShot = s.shot;
    // trong hộp thoại Lưu/Mở, "ctrl+s"/"ctrl+o" không có nghĩa: hiểu là xác nhận hộp thoại (Enter)
    if (action === 'hotkey' && s.dialog && /^(ctrl|cmd|command|meta)\+(shift\+)?[so]$/i.test(String(a.keys || '').replace(/\s/g, ''))) { deps.log && deps.log('desk', `Đang ở hộp thoại “${s.dialog}”: đổi ${a.keys} → enter (xác nhận)`); a = { ...a, keys: 'enter' }; }
    if (action === 'type_text') {
      // thay nội dung cũ (chọn hết rồi gõ) chỉ với ô một dòng (tên tệp, tìm kiếm…), không bao giờ với vùng soạn thảo tài liệu
      const el = t && t.el ? t.el : focusedEl;
      const single = el && el.editable && !/document|tài liệu|soạn thảo|multi/i.test(`${el.role || ''} ${el.kind || ''}`);
      const afterSave = s.lastAction && s.lastAction.action === 'hotkey' && /^(ctrl|cmd|command|meta)\+(shift\+)?[so]$/i.test(String(s.lastAction.keys || '').replace(/\s/g, '')) && Date.now() - s.lastAction.at < 120000;
      // ô không đọc được qua Trợ năng (Zalo…): vẫn cho thay nội dung khi mô hình yêu cầu, chỉ với chữ một dòng ngắn (ô tìm kiếm), không bao giờ với tài liệu
      const shortLine = !/\n/.test(String(a.text)) && String(a.text).length <= 80 && !(el && /document|tài liệu/i.test(`${el.role || ''} ${el.kind || ''}`));
      a = { ...a, __submit: !!a.submit, __replace: (a.replace === true && (single || (shortLine && !(el && el.editable)))) || (afterSave && !(el && /document|tài liệu/i.test(`${el.role || ''} ${el.kind || ''}`))) };
    }
    if (['hotkey', 'type_text'].includes(action) && !(t && t.x != null)) await refocus(); // phím/dán đi vào cửa sổ đang ở trước: phải đúng ứng dụng
    if (t && t.x != null) { a.__el = t.el || null; a.__q = t.query || String(a.element || ''); }
    // B69: chốt cuối — performAt từ chối mọi thao tác có thể gửi mà chưa qua chốt này (đã duyệt / tự làm theo cài đặt / xác nhận là tìm kiếm)
    if (gate.send) { a.__sendOk = true; deps.log && deps.log('desk', `GỬI (${autoGo ? 'tự làm không hỏi: ' + auto.why : 'người dùng đã cho phép'}): ${desc}`); } else a.__notSend = true;
    // B101: gõ nội dung tin + Enter → kiểm chữ trong ô soạn TRƯỚC khi bấm Enter (log B94); chữ vào nhầm ô → không bấm Enter, xoá chữ gõ nhầm
    let preSend = null;
    if (gate.send && bodyTyping && action === 'type_text') {
      const pre = s.obs; const cbx = (t && t.composerBox) || null;
      a.__beforeSubmit = async () => {
        await sleep(300);
        try { await observe(ctx, { ocr: 'auto', thumb: false }); } catch {}
        const L = landedOf(pre, s.obs, a.text, cbx); preSend = L;
        deps.log && deps.log('desk', `B94: kiểm chữ sau khi gõ “${String(a.text).slice(0, 40)}”: ${L.landed === 'composer' ? 'CÓ trong ô soạn tin → bấm Enter' : L.landed === 'wrong' ? `vào NHẦM ô (“${String((L.wrongEl && L.wrongEl.name) || '').slice(0, 40)}”${L.wrongEl && L.wrongEl.b ? ` @${L.wrongEl.b.join(',')}` : ''}; ô soạn ${cbx ? '@' + cbx.join(',') : 'chưa rõ'}; cửa sổ ${s.obs && s.obs.win && s.obs.win.b ? '@' + s.obs.win.b.join(',') : '?'}) → KHÔNG bấm Enter` : 'chưa đọc được ô soạn tin → vẫn bấm Enter, kiểm sau khi gửi'}`);
        if (L.landed === 'wrong') { await clearFocused(); deps.log && deps.log('desk', 'B94: đã xoá chữ gõ nhầm'); return false; }
        return true;
      };
    }
    await performAt(action, t && t.x != null ? t.x : null, t && t.x != null ? t.y : null, a);
    if (a.__submitSkipped) {
      s.composerFocus = false; s.lastAction = { action, at: Date.now(), doneAt: Date.now(), query: 'ô soạn tin' };
      const w = preSend && preSend.wrongEl;
      return { refused: true, error: 'chữ vào nhầm ô', forModel: `Tin CHƯA được gửi: chữ vừa gõ đã vào NHẦM ô (“${String((w && w.name) || 'ô khác').slice(0, 40)}”), không phải ô soạn tin — AIVN KHÔNG bấm Enter và đã xoá chữ gõ nhầm. Bấm vào ô soạn tin (“Nhập @, tin nhắn tới …”) rồi gõ lại nội dung tin.`, summary: 'chữ vào nhầm ô — chưa gửi, đã xoá' };
    }
    if (gate.send) { s.sentKeys.add(SG.sendKey(gateRcp, gate.text || s.lastTyped || '')); s.sentAny = true; s.lastSent = gate.text || s.lastTyped || ''; }
    const prevAction = s.lastAction;
    // bấm vào kết quả tìm kiếm khớp người nhận → coi như đã mở cuộc trò chuyện (kiểm lại tiêu đề ngay bên dưới)
    const rcp = ctx && ctx.userQuery ? (SV.recipientOf(ctx.userQuery) || (SV.CURRENT_CHAT.test(ctx.userQuery) && s.currentChat ? s.currentChat : null)) : null; // B59: “cuộc trò chuyện hiện tại” = chat đã đọc chắc lúc gõ
    // B27 (QA lượt 4): sau khi gõ tìm (kể cả gõ + Enter, kết quả chưa ghi nhận) mà bấm vào kết quả → cũng là “mở cuộc trò chuyện”; kiểm lại bằng màn hình ngay dưới
    const clickedName = `${t && t.el ? t.el.name || '' : ''} ${t && t.query ? t.query : String(a.element || a.target || '')}`;
    const recentSearch = s.lastSearch && Date.now() - s.lastSearch.at < SEARCH_MS() ? s.lastSearch : null;
    const isClick = !!(rcp && ['click', 'double_click'].includes(action));
    const strongOpen = isClick && !!(s.inSearch && s.foundHit && (SV.relates(s.foundHit.query, rcp) || SV.relates(s.foundHit.name, rcp))); // bấm đúng kết quả đã ghi nhận
    const clickSearchy = /tìm|tim kiem|search|find/iu.test(clickedName);
    const openPending = strongOpen || (isClick && !clickSearchy && !!((recentSearch && SV.relates(recentSearch.q, rcp)) || SV.relates(clickedName, rcp)));
    // B85: bấm kết quả “Tên cũ: Cloud của tôi” → tên HIỆN TẠI của cuộc trò chuyện là dòng ngay trên (“My Documents”) — ghi nhận làm tên khác của người nhận
    if (isClick && t && t.el && Array.isArray(t.el.b)) { const fm = SV.FORMER.exec(String(t.el.name || '')); const E = t.el.b;
      if (fm && SV.relates(fm[1], rcp)) { const src = (before && before.elements) || (s.obs && s.obs.elements) || [];
        const up = src.filter(e => e !== t.el && Array.isArray(e.b) && e.name && !SV.FORMER.test(e.name) && e.b[1] < E[1] && E[1] - e.b[1] <= E[3] * 3 + 14 && Math.abs(e.b[0] - E[0]) <= 48 && String(e.name).trim().length >= 2).sort((x, y) => y.b[1] - x.b[1])[0];
        if (up) { s.aliases = [...new Set([...(s.aliases || []), String(up.name).trim()])]; deps.log && deps.log('desk', `Người nhận “${rcp}” nay mang tên “${String(up.name).trim()}” (kết quả ghi “${String(t.el.name).trim()}”) — chấp nhận tên này ở tiêu đề`); } } }
    if (['click', 'double_click'].includes(action) && rcp && !openPending && s.chatOpen) { s.chatOpen = null; s.placeholderSeen = null; } // bấm chỗ khác: có thể đã đổi cuộc trò chuyện
    if (!['type_text', 'wait', 'scroll'].includes(action)) { s.inSearch = 0; s.foundHit = null; }
    s.lastAction = { action, el: t && t.el, keys: a.keys, at: Date.now(), query: t && t.query ? t.query : String(a.element || a.target || '') };
    if (['click', 'double_click'].includes(action)) s.focusProxy = 'c:' + U.fold(String((t && t.el && t.el.name) || (t && t.query) || '')).slice(0, 40); else if (action === 'hotkey') s.focusProxy = 'k:' + String(a.keys || '').toLowerCase(); // B95
    if ((['click', 'double_click', 'right_click'].includes(action) && !SV.isComposerEl((t && t.el) || { name: t && t.query }, s.obs && s.obs.win)) || (action === 'hotkey' && !/^shift\+(enter|return)$/i.test(String(a.keys || '').replace(/\s/g, ''))) || action === 'focus_window') s.composerFocus = false; // B94
    if (opensSearch(action, a, t)) { s.searchMode = { at: 0, how: action === 'hotkey' ? a.keys : `bấm “${String((t && t.el && t.el.name) || (t && t.query) || '').slice(0, 30)}”` }; deps.log && deps.log('desk', `Chế độ tìm kiếm: bật (${s.searchMode.how}) — tính giờ từ lúc thao tác xong`); }
    else if (!['type_text', 'wait', 'scroll'].includes(action)) s.searchMode = null;
    if (action === 'type_text') { s.lastTyped = String(a.text || '').replace(/\n+$/, ''); s.curTyped = s.lastTyped; }
    deps.log && deps.log('desk', `Thao tác: ${desc}${t && t.via ? ' (định vị bằng ' + t.via + ')' : ''}`);
    ov('target', { box: null });
    await sleep(action === 'type_text' ? 500 : 700);
    // kiểm tra lại
    let o = await observe(ctx, { ocr: s.ocrUsed ? 'auto' : 'auto' });
    const checks = [];
    // T1a: so ảnh trước/sau (quanh chỗ bấm + toàn màn hình); ứng dụng Electron/CEF (Zalo) có hiệu ứng chuyển cảnh → chờ thêm rồi so lại
    const isClickAct = ['click', 'double_click', 'right_click'].includes(action);
    const winScope = () => { const w = (o.obs && o.obs.win && Array.isArray(o.obs.win.b) && o.obs.win.b[2] > 100) ? o.obs.win.b : (before && before.win && Array.isArray(before.win.b) && before.win.b[2] > 100 ? before.win.b : null); return w ? rectNorm(w) : null; };
    let pd = shotDiff(beforeShot, s.shot, PD.around(box), winScope());
    if (pd && !PD.changed(pd) && isClickAct && o.poor && !(ctx.signal && ctx.signal.aborted)) { await sleep(900); o = await observe(ctx, { ocr: 'auto' }); pd = shotDiff(beforeShot, s.shot, PD.around(box), winScope()); }
    if (pd) deps.log && deps.log('desk', `So ảnh trước/sau: ${PD.describe(pd)}${a.__moved && a.__moved.calibrated ? ' · chuột đã hiệu chỉnh' : ''}`);
    // B37 (QA lượt 6, Classroom “+ Thêm tệp”): ảnh quanh chỗ bấm gần như không đổi nhưng trên màn hình có CHỮ MỚI (dòng “Bài làm của bạn: tệp.docx”) → thao tác ĐÃ có tác dụng
    // QA lượt 7: đếm theo SỐ LẦN xuất hiện (tệp thứ 2 cùng tên “bai.docx” cũng là chữ mới), không chỉ theo tập hợp
    const ADDF = /thêm tệp|thêm|tải lên|đính kèm|add file|add or create|attach|upload|添加|上传|附件/iu; const addTarget = `${t && t.el ? t.el.name || '' : ''} ${a.element || ''}`;
    // chỉ tin “chữ mới” khi bấm nút thêm/tải tệp hoặc chữ mới là tên tệp — OCR ở DPI cao hay đọc lệch (“Nhập tin nhắn” lúc có lúc không), không được coi là “đã có tác dụng”
    const newTexts = (before && o.obs ? U.newTexts(before.elements, o.obs.elements) : []).filter(n => ADDF.test(addTarget) || /\.[a-z0-9]{2,5}\b/i.test(n));
    if (isClickAct && ADDF.test(addTarget) && s.addedFiles && s.addedFiles.length) checks.push(`Lưu ý: trong việc này đã thêm tệp ${s.addedFiles.slice(-3).map(n => `“${n.slice(0, 40)}”`).join(', ')} rồi — nếu người dùng chỉ cần MỘT tệp thì KHÔNG thêm nữa (sẽ bị trùng).`);
    if (newTexts.length && isClickAct && /\.[a-z0-9]{2,5}\b/i.test(newTexts.join(' '))) { s.addedFiles = [...(s.addedFiles || []), ...newTexts.filter(n => /\.[a-z0-9]{2,5}\b/i.test(n))].slice(-10); }
    const pixChanged = PD.changed(pd) || !!(newTexts.length && isClickAct);
    if (newTexts.length && isClickAct && !PD.changed(pd)) checks.push(`Màn hình có chữ MỚI sau thao tác: ${newTexts.map(n => `“${n.slice(0, 50)}”`).join(', ')} — thao tác ĐÃ có tác dụng${ADDF.test(addTarget) || /\.[a-z0-9]{2,5}\b/i.test(newTexts.join(' ')) ? '; tệp đã được thêm, KHÔNG bấm lại “thêm tệp” (sẽ gắn trùng)' : ''}.`);
    if (before && before.win && o.obs.win && before.win.title !== o.obs.win.title) checks.push(`Cửa sổ đổi thành "${o.obs.win.title}".`);
    if (openPending) {
      const R = SV.regionsOf(o.obs); const hdr = [o.obs.win ? o.obs.win.title : '', ...(R ? R.header : [])].filter(Boolean);
      const v = SV.verifySend({ msg: 'x', recipient: rcp, regions: { header: R ? R.header : [], messages: ['x'], composer: [] }, winTitle: o.obs.win ? o.obs.win.title : '', aliases: s.aliases });
      const readable = R && R.header.length;
      deps.log && deps.log('desk', `Kiểm tra mở chat: tiêu đề “${o.obs.win ? o.obs.win.title : ''}”, đầu khung: ${JSON.stringify(R ? R.header : [])}`);
      if (SV.chatShown(rcp, o.obs.win ? o.obs.win.title : '', R ? R.header : [], s.aliases)) { s.chatOpen = SV.nameKey(rcp); s.gateBlocks = 0; checks.push(`Đã mở cuộc trò chuyện với “${rcp}” (thấy đúng tên trên màn hình).`); }
      else if (strongOpen && (v.recipientSeen || !readable)) { s.chatOpen = SV.nameKey(rcp); checks.push(v.recipientSeen ? `Đã mở cuộc trò chuyện với “${rcp}” (thấy tên ở tiêu đề).` : `Đã bấm kết quả “${rcp}”; chưa đọc được tiêu đề — kiểm tra lại bằng screen_look nếu cần.`); }
      else if (!readable && !SV.chatShown(rcp, '', hdr, s.aliases)) checks.push(`Đã bấm “${String(clickedName).trim().slice(0, 40)}”; chưa đọc được tiêu đề cuộc trò chuyện — gọi screen_look để xem đã mở đúng “${rcp}” chưa rồi mới gõ tin.`);
      else checks.push(`Đã bấm kết quả nhưng tiêu đề cuộc trò chuyện là “${String(hdr.find(h => !/^(zalo|messenger)$/i.test(h)) || hdr[0] || '').slice(0, 40)}”, KHÔNG phải “${rcp}”. Bấm đúng kết quả tên “${rcp}”.`);
    }
    let o2 = o;
    let searchyDone = false; let draftIn = null;
    if (action === 'type_text') {
      const typed = U.fold(String(a.text).split('\n')[0]).slice(0, 40);
      const seen = o.obs.elements.some(e => (e.value && U.fold(e.value).includes(typed)) || (e.name && U.fold(e.name).includes(typed)) || (e.ocr && e.name && U.fuzzyHas(U.fold(e.name), typed.slice(0, 24)))); // B76: OCR đọc sai dấu (“Lich hop nhém”)
      // B94: nội dung tin → phải nằm trong Ô SOẠN TIN; chữ mới xuất hiện ở ô khác (ô tìm kiếm…) = gõ NHẦM ô → báo + xoá
      let landed = null;
      if (bodyTyping && !a.submit) {
        const L = landedOf(before, o.obs, a.text, (t && t.composerBox) || null); const bad = L.wrongEl ? [L.wrongEl] : []; const good = L.landed === 'composer' ? [1] : [];
        const W = o.obs.win && Array.isArray(o.obs.win.b) && o.obs.win.b[3] > 50 ? o.obs.win.b : null;
        if (good.length) { landed = 'composer'; draftIn = { text: String(a.text || '').slice(0, 200), chat: s.chatOpen || null }; s.draftTyped = { text: String(a.text || ''), box: L.good && Array.isArray(L.good.b) ? L.good.b.slice() : ((t && t.composerBox) || null), chat: s.chatOpen || null, at: Date.now() }; } // B104: nhớ chữ còn nằm trong ô soạn (chưa gửi)
        else if (bad.length) {
          landed = 'wrong'; const w = bad[0]; const searchy = /tìm|tim kiem|search|find|搜索/iu.test(`${w.name || ''} ${w.placeholder || ''}`) || (W && w.b && (w.b[1] - W[1]) / W[3] < 0.2);
          s.composerFocus = false;
          deps.log && deps.log('desk', `B94: chữ vừa gõ vào NHẦM ô (“${String(w.name || '').slice(0, 40)}” @${w.b ? w.b.join(',') : '?'}), không phải ô soạn tin`);
          if (searchy) { await clearFocused(); deps.log && deps.log('desk', 'B94: đã xoá chữ gõ nhầm trong ô đó'); }
          checks.push(`Chữ vừa gõ đã vào NHẦM ô (“${String(w.name || '').slice(0, 40)}”${searchy ? ', có thể là ô tìm kiếm — AIVN đã xoá chữ gõ nhầm' : ''}), KHÔNG phải ô soạn tin. Tin CHƯA được soạn. Bấm vào ô soạn tin (“Nhập @, tin nhắn tới …”) rồi gõ lại.`);
        }
      }
      if (bodyTyping && !a.submit) deps.log && deps.log('desk', `B94: kiểm chữ sau khi gõ “${String(a.text).slice(0, 40)}”: ${landed === 'composer' ? 'CÓ trong ô soạn tin' : landed === 'wrong' ? 'vào NHẦM ô' : 'chưa đọc được ô soạn tin'}`);
      if (!a.submit) checks.push(landed === 'composer' ? 'Đã thấy chữ vừa gõ trong Ô SOẠN TIN.' : landed === 'wrong' ? '' : seen ? 'Đã thấy chữ vừa gõ trên màn hình.' : 'CHƯA thấy chữ vừa gõ trong danh sách phần tử (có thể ô không hiện giá trị) — hãy kiểm tra trước khi làm tiếp.');
      else checks.push('Đã gõ (dán một lần) rồi bấm Enter.');
      // ô tìm kiếm: chờ kết quả tải, nhìn lại, rồi mới kết luận; gợi ý tìm không dấu / một phần tên
      const el = t && t.el ? t.el : focusedEl;
      const prevTxt = prevAction && Date.now() - (prevAction.doneAt || prevAction.at) < 60000 ? `${prevAction.query || ''} ${prevAction.el ? prevAction.el.name || '' : ''}` : '';
      // còn đang ở ô tìm kiếm: lần gõ trước là tìm kiếm và từ đó chưa bấm vào đâu (máy chậm có thể mất vài phút giữa hai lần gõ)
      const stillSearching = s.inSearch && Date.now() - s.inSearch < SEARCH_MS();
      const searchy = (stillSearching || inSearchMode() || /tìm|tim kiem|search|find|kiếm/i.test(`${el ? el.name + ' ' + (el.kind || '') : ''} ${a.element || a.target || ''} ${prevTxt}`) || (prevAction && Date.now() - (prevAction.doneAt || prevAction.at) < 60000 && /^(ctrl|cmd|command|meta)\+(f|k)$/i.test(String(prevAction.keys || '').replace(/\s/g, '')))) && !/\n/.test(String(a.text)) && String(a.text).length <= 80
        && !(bodyTyping && landed !== 'wrong'); // B112: AIVN đã chuyển sang ô soạn tin (B94) → đây là gõ NỘI DUNG tin, không phải tìm kiếm: không kiểm “kết quả tìm kiếm”
      if (searchy && String(a.text).trim()) { searchyDone = true;
        const q = String(a.text).split('\n')[0].trim(); const fq = U.fold(q);
        const ask = `Ô tìm kiếm vừa được gõ "${q}". Danh sách kết quả tìm kiếm đang hiện những tên nào (ghi đúng chữ)? Dòng đầu tiên trả lời CÓ nếu có kết quả khớp hoặc gần khớp "${q}", KHÔNG nếu không có, ĐANG TẢI nếu chưa hiện xong.`;
        // kết quả khớp trong danh sách phần tử (OCR thấy cả chữ trong ô tìm kiếm nên ứng dụng cây nghèo cần ≥ 2 chỗ)
        const matches = (oo) => oo.obs.elements.filter(e => !(e.editable || e.focused) && U.fold(e.name || '').includes(fq));
        const judge = (oo) => { const hits = matches(oo).length; if (hits >= (oo.poor ? 2 : 1)) return 'yes';
          const d = U.fold(oo.seen || ''); if (oo.seen) return /^\W*(co|yes)\b/.test(d) ? 'yes' : /^\W*(dang tai|loading)/.test(d) ? 'loading' : 'no'; return 'no'; };
        let verdict = 'no', waited = 0;
        // B124: open_chat — lần nhìn ngay sau khi gõ đã thấy kết quả khớp (OCR) → khỏi chờ + nhìn thêm (mỗi lần nhìn trên máy thật 6–13 giây)
        const early = s.quick && o2 && o2.obs && judge(o2) === 'yes'; if (early) { verdict = 'yes'; deps.log && deps.log('desk', 'B124: kết quả tìm đã hiện ngay sau khi gõ — bỏ lần chờ/nhìn thêm'); }
        for (let i = 0; !early && i < 3; i++) { // tối đa ~4,5 giây chờ kết quả
          const ms = i === 0 ? 1200 : 1500; await sleep(ms); waited += ms; if (ctx.signal && ctx.signal.aborted) break;
          const qv = o.poor || deps.engine.status().vision ? ask : '';
          if (s.quick && qv) { o2 = await observe(ctx, {}); verdict = judge(o2); if (verdict !== 'yes') { o2 = await observe(ctx, { question: qv }); verdict = judge(o2); } } // B124: OCR thấy kết quả → khỏi hỏi mô hình nhìn ảnh
          else { o2 = await observe(ctx, { question: qv }); verdict = judge(o2); }
          if (verdict !== 'loading') break;
        }
        s.searches = s.searches || []; s.searches.push({ text: q, found: verdict === 'yes' });
        const tried = new Set(s.searches.map(x => x.text));
        const rest = U.searchVariants(s.searches[0].text).filter(v => !tried.has(v)); if (s.searchFull && !tried.has(s.searchFull)) rest.unshift(s.searchFull); // B63: thử lại với nguyên “nhóm X”
        s.inSearch = Date.now(); s.foundHit = null; s.searchEcho = null; s.lastSearch = { q, at: Date.now() }; s.gateBlocks = 0;
        if (verdict === 'yes') {
          // kết quả nằm dưới ô tìm kiếm: chọn phần tử khớp gần ô nhất, tức kết quả đầu tiên (không phải chính chữ trong ô)
          const boxEl = el && el.b ? el : prevAction && prevAction.el && prevAction.el.b && Date.now() - prevAction.at < SEARCH_MS() ? prevAction.el : null; // ô tìm kiếm = ô đang chọn, hoặc chỗ vừa bấm (gợi ý “Tìm kiếm…” chỉ thấy qua OCR)
          let boxY = boxEl ? boxEl.b[1] + Math.max(0, (boxEl.b[3] || 0) - 8) : (t && t.y != null ? t.y : -1);
          // ô tìm kiếm mở bằng phím tắt (Ctrl+F…): không biết chỗ ô → chữ vừa gõ trong ô là dòng khớp NẰM TRÊN CÙNG, kết quả nằm dưới nó
          if (boxY < 0) { const ms = matches(o2).filter(e => e.b && e.ocr).sort((x, y) => x.b[1] - y.b[1]); if (ms.length >= 2 && U.fold(ms[0].name).replace(/[^\p{L}\p{N} ]/gu, '').trim() === fq.replace(/[^\p{L}\p{N} ]/gu, '').trim()) boxY = ms[0].b[1] + Math.max(0, ms[0].b[3] - 8); }
          const preEls = before && before.elements ? before.elements : [];
          // chữ vừa gõ NẰM TRONG ô tìm kiếm (chỗ trước đó là gợi ý “Tìm kiếm…”, OCR có thể kèm con trỏ “|”) — không phải kết quả
          const inBox = (e) => e.b && (/[|│]\s*$|^\s*[|│]/.test(e.name || '') || preEls.some(p => p.b && (p.editable || U.inputLike(p) || /tìm|tim kiem|search|find/iu.test(p.name || '') || SV.placeholderLike(p.name)) && Math.abs((p.b[1] + p.b[3] / 2) - (e.b[1] + e.b[3] / 2)) <= Math.max(10, p.b[3] / 2) && e.b[0] >= p.b[0] - 12 && e.b[0] <= p.b[0] + p.b[2]));
          // B27 (QA, Telegram): ô nhập nằm DƯỚI nhãn “Tìm kiếm” vừa bấm — chữ vừa gõ hiện trong ô, ngay dưới nhãn, ở chỗ TRƯỚC ĐÓ không có chữ nào → là chữ trong ô, không phải kết quả
          const sameRow = (a1, b1) => Math.abs((a1[1] + a1[3] / 2) - (b1[1] + b1[3] / 2)) <= Math.max(10, b1[3] / 2) && a1[0] < b1[0] + b1[2] && a1[0] + a1[2] > b1[0];
          const fqk = U.fold(q).replace(/[^\p{L}\p{N} ]/gu, '').trim();
          const isEcho = (e) => e.b && boxY >= 0 && U.fold(e.name || '').replace(/[^\p{L}\p{N} ]/gu, '').trim() === fqk && e.b[1] >= boxY - 4 && e.b[1] - boxY <= 70
            && !preEls.some(p => p.b && p.name && Math.abs((p.b[1] + p.b[3] / 2) - (e.b[1] + e.b[3] / 2)) <= Math.max(10, e.b[3] / 2) && p.b[0] < e.b[0] + e.b[2] && p.b[0] + p.b[2] > e.b[0] && !(s.lastEchoB && sameRow(p.b, s.lastEchoB)) && !SV.placeholderLike(p.name)); // chữ gợi ý (placeholder “Tìm kiếm…”) của ô ở đúng chỗ đó không tính; chữ cũ ở đúng chỗ chữ-trong-ô lần trước (gõ lại, replace) vẫn là chữ trong ô
          // chỉ khi CÒN kết quả khớp khác bên dưới: một dòng khớp duy nhất thì có thể chính là kết quả (Zalo: Ctrl+F, kết quả ngay dưới chỗ bấm)
          const ms0 = matches(o2).filter(e => e.b).sort((x, y) => x.b[1] - y.b[1]);
          const echo = ms0.length >= 2 && isEcho(ms0[0]) ? ms0[0] : null;
          s.searchEcho = echo ? { b: echo.b.slice(), name: echo.name, at: Date.now() } : null; if (echo) s.lastEchoB = echo.b.slice();
          deps.log && deps.log('desk', `Ô tìm kiếm: dòng khớp ${ms0.map(e => `“${String(e.name).slice(0, 30)}”@${e.b[1]}`).join(', ') || '—'} · ô ở y≈${Math.round(boxY)} · chữ trong ô: ${echo ? `“${echo.name}”@${echo.b[1]}` : 'không'}`);
          const below0 = matches(o2).filter(e => (!e.b || e.b[1] > boxY + 4) && !inBox(e) && e !== echo).sort((x, y) => (x.b ? x.b[1] : 0) - (y.b ? y.b[1] : 0));
          // cùng tên, cùng chỗ như TRƯỚC khi gõ = mục có sẵn ở danh sách hội thoại bên trái (cùng một người), không phải kết quả tìm kiếm mới → không tính là trùng tên
          const fresh = below0.filter(e => !(e.b && preEls.some(p => p.b && U.fold(p.name) === U.fold(e.name) && Math.abs(p.b[0] - e.b[0]) <= 12 && Math.abs(p.b[1] - e.b[1]) <= 12)));
          const below = fresh.length ? fresh : below0; const m = below[0];
          // B20 / quyết định của Khôi: hai người cùng họ tên (hoặc cùng tên kèm chú thích khác nhau) → HỎI người dùng, không tự chọn
          const rcpQ = ctx && ctx.userQuery ? SV.recipientOf(ctx.userQuery) : null; const distinct = rcpQ ? SV.sameNameCandidates(rcpQ, below.map(e => e.name)) : [];
          const exactDup = rcpQ ? below.filter(e => U.fold(e.name).trim() === U.fold(SV.nameKey(rcpQ))).length >= 2 : false;
          // Teams (QA lượt 6, bẫy “Lê Văn Hùng (SV K26)”): kết quả DUY NHẤT có chú thích/khác tên đầy đủ → không tự mở, hỏi người dùng
          const onlyOther = rcpQ && m && m.name && !distinct.some(x => SV.headerMatches(rcpQ, x)) && !SV.headerMatches(rcpQ, m.name);
          if (onlyOther) {
            s.foundHit = null; s.ambiguous = [m.name];
            checks.push(`Ô tìm kiếm: kết quả là “${String(m.name).slice(0, 60)}”, KHÔNG đúng tên “${rcpQ}” (có chú thích/tên khác — có thể là người khác). KHÔNG tự mở. Dừng lại và HỎI người dùng có phải người này không, chưa gõ tin.`);
          } else if (rcpQ && (distinct.length >= 2 || exactDup)) {
            s.foundHit = null; s.ambiguous = distinct.length >= 2 ? distinct : below.map(e => e.name);
            checks.push(`Ô tìm kiếm: có NHIỀU người cùng tên “${rcpQ}”: ${s.ambiguous.slice(0, 5).map(x => `“${x}”`).join(', ')}. KHÔNG tự chọn. Dừng lại và HỎI người dùng muốn nhắn cho người nào (nêu các lựa chọn), chưa gõ tin.`);
          } else {
          s.foundHit = { id: m ? m.id : null, name: m ? m.name : q, query: q };
          checks.push(`Ô tìm kiếm: đã chờ kết quả và THẤY kết quả khớp "${q}"${m ? `: [${m.id}] "${m.name}"` : ''}. Bấm vào kết quả đó${m ? ` (screen_act click element "${m.id}")` : ' (kiểm tra đúng tên)'} để mở; KHÔNG gõ lại và không thử tên khác nữa.`);
          }
        }
        else checks.push(`Ô tìm kiếm: đã chờ ~${Math.round(waited / 100) / 10} giây và CHƯA thấy kết quả khớp "${q}".` + (rest.length ? ` Bước tiếp theo BẮT BUỘC: gõ lại "${rest[0]}" vào ô tìm kiếm (screen_act type_text, replace: true). Chưa được nói "không tìm thấy"${rest.length > 1 ? `; nếu vẫn không ra thì lần lượt thử ${rest.slice(1).map(v => `"${v}"`).join(', ')}` : ''}.` : ' Đã thử nguyên văn, không dấu và một phần tên — có thể báo người dùng là không tìm thấy (nêu các cách đã thử).'));
      }
    }
    if (action === 'type_text' && !searchyDone && !a.submit) { const eb = t && t.el && Array.isArray(t.el.b) ? t.el.b.slice() : (focusedEl && Array.isArray(focusedEl.b) ? focusedEl.b.slice() : null); s.typedLog = [...(s.typedLog || []), { text: String(a.text || ''), box: eb, at: Date.now() }].slice(-12); }
    // gửi tin: kiểm chứng trên màn hình (thấy chữ vừa gửi + thấy tên người nhận); kết quả nằm ở out.verify để agent.js không cho báo giả
    let verify;
    const targetName = `${t && t.el ? t.el.name || '' : ''} ${a.element || a.target || ''}`;
    if (action === 'type_text' && !a.submit && !s.inSearch) s.lastTyped = String(a.text || '');
    const sendA = action === 'type_text' && a.submit ? { ...a, text: a.text + '\n' } : a;
    // kịch bản A: chốt gửi đã xếp là TÌM (thanh địa chỉ / ô tìm kiếm, việc không phải nhắn tin) → không kiểm chứng “gửi tin” (trước: báo “GỬI NHẦM” khi tìm trên Chrome)
    const searchNotSend = action === 'type_text' && !gate.send && !!gate.why;
    if (gate.send || (!searchNotSend && !(action === 'type_text' && a.submit && searchyDone) && SV.isSendAction(action, sendA, targetName, s.lastTyped))) {
      const msg = action === 'type_text' ? String(a.text).replace(/\n\s*$/, '') : (gate.text || s.lastSent || s.lastTyped);
      const recipient = SV.recipientOf(ctx.userQuery);
      await sleep(800);
      // B70: ảnh kiểm chứng phải là cửa sổ đích, không phải cửa sổ AIVN (thẻ duyệt có thể đưa AIVN lên trước)
      try { const fgv = await fgWin(); if (fgv && fgv.pid === process.pid) { deps.log && deps.log('desk', 'Kiểm chứng gửi: AIVN đang ở trước — đưa cửa sổ đích lên rồi mới chụp'); await refocus(); await sleep(500); } } catch {}
      o2 = await observe(ctx, { question: (o.poor || deps.engine.status().vision) ? SV.SEEN_QUESTION : '' });
      verify = SV.verifySend({ msg, recipient, regions: SV.regionsOf(o2.obs), screenText: o2.text, seen: o2.seen, winTitle: o2.obs.win ? o2.obs.win.title : '', aliases: s.aliases });
      verify.ocr = !!(o2.src && /OCR/.test(o2.src));
      if (verify.wrongChat) deps.log && deps.log('desk', `GỬI NHẦM: ${verify.why}`);
      checks.push(verify.wrongChat ? `⚠ GỬI NHẦM: ${verify.why}. KHÔNG được gửi thêm gì. Dừng lại và BÁO NGAY cho người dùng là tin đã bị gửi nhầm vào “${verify.wrongTo || 'cuộc trò chuyện khác'}” để họ thu hồi/xoá tin đó.` : verify.sent ? `ĐÃ KIỂM CHỨNG trên màn hình: tiêu đề cuộc trò chuyện là “${recipient || '(không nêu tên)'}”, ô soạn đã trống, thấy bong bóng tin “${String(msg).slice(0, 40)}”.` : `CHƯA kiểm chứng được là đã gửi: ${verify.why}. Không được báo “đã gửi”; hãy screen_look để kiểm tra rồi làm lại cho đúng.`);
      s.lastTyped = null;
    }
    if (staleEl) checks.unshift(`(Đã bỏ id [${staleEl.id}] vì nó đang là “${String(staleEl.name || '').slice(0, 40)}”, không phải ô nhập; đã gõ vào ô Tìm kiếm vừa bấm.)`);
    if (beforeDialog && s.dialog === beforeDialog) checks.push(`Hộp thoại “${beforeDialog}” VẪN đang mở — việc trong hộp thoại CHƯA xong. Xác nhận bằng nút của hộp thoại (Save/Lưu/OK/Mở) hoặc hotkey "enter"; đừng báo đã xong.`);
    else if (beforeDialog && !s.dialog) checks.push(`Hộp thoại “${beforeDialog}” đã đóng.`);
    const foc = o.obs.elements.find(e => e.focused); if (foc) checks.push(`Đang chọn: [${foc.id}] ${foc.kind} "${foc.name}".`);
    if (before && o.obs.elements.length && Math.abs(o.obs.elements.length - before.elements.length) > 3) checks.push(`Số phần tử: ${before.elements.length} → ${o.obs.elements.length}.`);
    // B34 (QA lượt 5): bấm vào Ô NHẬP (ô tìm kiếm…) thường chỉ đặt con trỏ, màn hình gần như không đổi — đó vẫn là có tác dụng
    const clickedInput = ['click', 'double_click'].includes(action) && ((t && t.el && (t.el.editable || U.inputLike(t.el))) || /tìm|tim kiem|search|find/iu.test(`${t && t.el ? t.el.name || '' : ''} ${t && t.query ? t.query : ''}`));
    // T1a: chữ “Tìm kiếm” (OCR) bấm mà màn hình không đổi + ứng dụng có phím tắt tìm kiếm (Zalo Ctrl+F…) → tự bấm phím tắt
    const ak = U.appKeys((o.obs && o.obs.win && o.obs.win.proc) || (s.target && s.target.proc) || '', o.obs && o.obs.win ? o.obs.win.title : '');
    if (isClickAct && pixChanged === false && ak && ak.search && clickSearchy && !(t && t.el && t.el.editable && !t.el.ocr)) {
      try {
        await refocus(); await performAt('hotkey', null, null, { keys: ak.search }); await sleep(500);
        s.lastAction = { action: 'hotkey', keys: ak.search, at: Date.now(), query: 'Tìm kiếm' }; s.searchMode = { at: 0, how: ak.search };
        o = await observe(ctx, { ocr: 'auto' }); o2 = o;
        deps.log && deps.log('desk', `Bấm “Tìm kiếm” không đổi màn hình → dùng phím tắt ${ak.search} của ${ak.name}`);
        checks.push(`Bấm chữ “Tìm kiếm” không làm màn hình đổi nên AIVN đã bấm phím tắt ${ak.search} của ${ak.name} để mở ô tìm kiếm. Bước tiếp: type_text KHÔNG kèm element (gõ tên cần tìm).`);
      } catch (e) { deps.log && deps.log('desk', 'Phím tắt tìm kiếm lỗi: ' + e.message); }
    }
    if (pixChanged && !checks.some(c => /Cửa sổ đổi|Đã mở cuộc trò chuyện|Ô tìm kiếm|KIỂM CHỨNG|GỬI NHẦM|phím tắt|chữ MỚI/.test(c))) checks.push(`Màn hình đã thay đổi sau thao tác (${PD.describe(pd)}) — xem danh sách mới bên dưới để biết đã mở/chọn gì.`);
    if (clickedInput && !checks.some(c => /Cửa sổ đổi|Đã mở cuộc trò chuyện|KIỂM CHỨNG|GỬI NHẦM|phím tắt|Hộp thoại/.test(c))) { const nm = String((t && t.el && (t.el.name || t.el.placeholder)) || (t && t.query && !U.isIdRef(t.query) ? t.query : '') || '').trim().slice(0, 40); checks.unshift((() => { const id = t && t.el && t.el.id ? t.el.id : ''; const TAIL = ' — ô nhập thường không đổi hình khi được chọn, đây là ĐÃ có tác dụng. Bước tiếp: type_text KHÔNG kèm element để gõ vào ô này.'; // B33: từng câu trọn (dịch được)
      if (nm && id) return `Đã đặt con trỏ vào ô “${nm}” (${id}) — ô nhập thường không đổi hình khi được chọn, đây là ĐÃ có tác dụng. Bước tiếp: type_text KHÔNG kèm element để gõ vào ô này.`;
      if (nm) return `Đã đặt con trỏ vào ô “${nm}” — ô nhập thường không đổi hình khi được chọn, đây là ĐÃ có tác dụng. Bước tiếp: type_text KHÔNG kèm element để gõ vào ô này.`;
      if (id) return `Đã đặt con trỏ vào ô nhập ${id} — ô nhập thường không đổi hình khi được chọn, đây là ĐÃ có tác dụng. Bước tiếp: type_text KHÔNG kèm element để gõ vào ô này.`;
      return 'Đã đặt con trỏ vào ô nhập' + TAIL; })()); }
    if (!checks.length) checks.push(pd ? `Màn hình không thay đổi rõ ràng (so ảnh trước/sau: ${PD.describe(pd)}) — nếu cần, thử cách khác${ak && ak.search ? `; với ${ak.name} có thể dùng phím tắt ${ak.search} để mở ô tìm kiếm` : ''}.` : 'Màn hình không thay đổi rõ ràng — nếu cần, thử cách khác.');
    // B70: đã bấm gửi mà chưa kiểm chứng được → DỪNG, không để mô hình bấm lại/gõ lại (gửi trùng cho người thật); nhờ người dùng kiểm tra
    if (verify && !verify.sent && !verify.wrongChat && (gate.send || s.sentAny)) {
      const rcpV = SV.recipientOf(ctx.userQuery) || s.chatOpen || '';
      const msgV = `Mình đã bấm gửi tin “${String(s.lastSent || '').slice(0, 80)}”${rcpV ? ` tới “${rcpV}”` : ''} MỘT lần, nhưng chưa kiểm chứng được trên màn hình là tin đã đi (${String(verify.why || '').slice(0, 120)}). Để tránh gửi TRÙNG, mình không gửi lại — bạn mở cuộc trò chuyện kiểm tra giúp mình nhé.`;
      deps.log && deps.log('desk', `Gửi chưa kiểm chứng → dừng, không gửi lại (B70): ${verify.why}`);
      return { stop: true, ask: msgV, error: 'đã gửi, chưa kiểm chứng', verify, forModel: msgV, summary: `${desc} · đã bấm gửi, CHƯA kiểm chứng — dừng, không gửi lại` };
    }
    // B101: việc gửi tin đã GỬI + KIỂM CHỨNG (bong bóng tin + ô soạn trống + đúng người nhận) → báo agent.js kết thúc việc là XONG
    const sentDone = verify && verify.sent && gate.send && bodyTyping ? { msg: String(a.text || '').replace(/\n\s*$/, ''), to: SV.recipientOf(ctx.userQuery) || s.chatOpen || '', auto: !!a.__autoSubmit } : null;
    if (sentDone) { s.draftTyped = null; deps.log && deps.log('desk', `B101: đã gửi “${sentDone.msg.slice(0, 60)}” tới “${sentDone.to}” và KIỂM CHỨNG trên màn hình (thấy tin trong khung chat, ô soạn trống) → việc xong`); }
    return { ...(sentDone ? { sentDone } : {}), ...(draftIn ? { draftIn } : {}), ...(autoGo ? { auto: auto.why } : {}), forModel: `Đã ${desc}.\nKiểm tra: ${checks.filter(Boolean).join(' ')}\nMàn hình bây giờ (id mới, dùng các id này cho bước tiếp):\n${o2.text}`, summary: desc + (t && t.via ? ` · ${t.via}` : '') + (verify ? (verify.sent ? ' · đã kiểm chứng trên màn hình' : ' · CHƯA kiểm chứng') : ''), thumb: o2.thumb, detail: checks.join(' '), verify };
  }

  async function look(a, ctx) {
    if (a && a.window) {
      const list = await U.windows(); const w = U.matchWindow(list, String(a.window));
      if (w) {
        await begin(ctx);
        const sameApp = session.target && session.target.pid && w.pid === session.target.pid;
        // cùng ứng dụng (vd. hộp thoại "Save as" của Writer): giữ cửa sổ chính làm mục tiêu, không giành tiêu điểm khỏi hộp thoại
        if (!(sameApp && w.active)) await U.focus(w).catch((e) => deps.log && deps.log('desk', 'Không chuyển được tới cửa sổ (có thể đang mở hộp thoại): ' + e.message));
        if (!sameApp) session.target = { hwnd: w.hwnd, pid: w.pid, proc: w.proc, title: w.title };
        await sleep(400);
      }
    }
    const o = await observe(ctx, { query: a && a.query, ocr: a && a.ocr ? 'force' : 'auto' });
    // kịch bản B: gặp màn hình đăng nhập GIỮA việc (mở tài liệu Google Docs → trang accounts.google.com, phiên hết hạn…) → DỪNG và hỏi,
    // không tự gõ tài khoản/mật khẩu. Trừ khi chính người dùng giao việc đăng nhập
    const wantsLogin = /đăng nhập|sign ?in|log ?in|登录|登入/iu.test(String((ctx && ctx.userQuery) || ''));
    const EAx = require('./agent/ensure-app'); const wall = !wantsLogin && o.obs && EAx.loginWall(o.obs.win && o.obs.win.title, o.text);
    if (wall) {
      const name = (o.obs.win && o.obs.win.title) || 'Ứng dụng';
      const ask = EAx.loginAsk(`“${name}”`, wall);
      return { error: 'màn hình đăng nhập', code: 'login', ask, stop: true, forModel: ask, summary: 'màn hình đăng nhập — hỏi bạn', thumb: o.thumb, detail: o.text };
    }
    let extra = '';
    if (a && a.question && deps.engine.status().vision) { try { extra = '\nMô tả của mô hình nhìn ảnh: ' + await SC.describe(deps.engine, await withOverlayHidden(() => SC.capture({ maxW: 1280 })), a.question, { signal: ctx.signal }); } catch {} }
    let hint = '';
    if (a && a.query) {
      const fq = U.fold(String(a.query)); const hit = o.obs.elements.some(e => fq.split(' ').filter(w => w.length > 2 && !['nut', 'cua', 'cho'].includes(w)).some(w => U.fold(e.name || '').includes(w)));
      let sc = U.shortcutFor(String(a.query));
      if (session && session.dialog && sc && /lưu|mở|save|open/i.test(sc.label)) sc = { keys: 'enter', label: `xác nhận hộp thoại “${session.dialog}” (nút Save/Lưu/OK)` };
      if (!hit) hint = `\nKHÔNG thấy phần tử nào khớp "${a.query}" (biểu tượng không có chữ thì không đọc được).` + (sc ? ` Hãy dùng phím tắt: screen_act hotkey "${sc.keys}" (${sc.label}).` : ' Thử query khác ngắn hơn, cuộn (scroll), hoặc phím tắt.');
      else if (sc) hint = `\nMẹo: ${sc.label} nhanh nhất bằng hotkey "${sc.keys}".`;
      if (session && session.lastLook === fq && !hit) hint += ' Bạn vừa tìm đúng thứ này và không thấy — ĐỪNG tìm lại, hãy làm cách khác.';
      if (session) session.lastLook = fq;
    }
    return { forModel: `Quan sát (${o.src}):\n${o.text}${extra}${hint}\nDùng screen_act với element = id [eN] ở trên.`, summary: `${o.obs.win ? '“' + o.obs.win.title + '” · ' : ''}${o.obs.elements.length} phần tử`, thumb: o.thumb, detail: o.text };
  }
  async function readText(a, ctx) {
    await begin(ctx); status('Đang đọc chữ trên màn hình…');
    const shot = await capture();
    const r = await ocrShot(shot, null);
    const text = r.map(l => l.text).join('\n').slice(0, 6000);
    return { forModel: `Chữ đọc được trên màn hình (OCR, có thể sai chính tả):\n<<<\n${text || '(không đọc được chữ nào)'}\n>>>`, summary: `${r.length} dòng chữ`, thumb: thumbOf(shot), detail: text };
  }
  // open_app vừa mở xong: ghi nhớ cửa sổ mục tiêu để quan sát/thao tác đúng cửa sổ
  async function adoptApp(name, ctx) {
    try {
      for (let i = 0; i < 8; i++) { const w = U.matchWindow(await U.windows(), name); if (w) { await begin(ctx); await U.focus(w).catch(() => {}); session.target = { hwnd: w.hwnd, pid: w.pid, proc: w.proc, title: w.title }; return w; } await sleep(700); }
    } catch {}
    return null;
  }
  // việc còn dang dở trên màn hình (để AIVN AGENT không báo "xong" khi hộp thoại vẫn mở)
  async function pending() {
    const s = session; if (!s || !s.target) return null;
    try { const d = U.activeDialogOf(await U.windows(), s.target); if (d) return `Hộp thoại “${d.title || 'của ứng dụng'}” vẫn đang mở — việc chưa xong (vd. chưa bấm Save/Lưu/OK).`; } catch {}
    return null;
  }
  // ô tìm kiếm chưa ra kết quả mà còn cách tìm chưa thử (không dấu, một phần tên): AIVN AGENT không được kết luận "không tìm thấy"
  function searchTodo() {
    const s = session; if (!s || !s.searches || !s.searches.length || s.searches.some(x => x.found)) return null;
    const tried = new Set(s.searches.map(x => x.text)); const rest = U.searchVariants(s.searches[0].text).filter(v => !tried.has(v));
    return rest.length ? rest : null;
  }
  // kết quả tìm kiếm đã hiện nhưng chưa bấm vào (mô hình nhỏ hay dừng lại hỏi thay vì mở)
  function searchFound() { const s = session; return s && s.inSearch && s.foundHit ? s.foundHit : null; }
  // B95: “ngữ cảnh” của một thao tác cho chống lặp — phần tử đang chọn (Trợ năng, hoặc chỗ vừa bấm / phím vừa bấm khi ứng dụng chỉ đọc được bằng OCR) + dấu của màn hình
  // B118/B119: đọc NGUYÊN VĂN trang đang mở trong trình duyệt qua bộ nhớ tạm — chữ trang (Ctrl+A, Ctrl+C: chữ DOM, tốt hơn OCR cho bảng)
  // và đường dẫn trên thanh địa chỉ (Ctrl+L, Ctrl+C, Esc). Chỉ làm khi cửa sổ trình duyệt đang ở trước; trả lại bộ nhớ tạm như cũ.
  async function readBrowserPage({ page = true } = {}) {
    const s = session; if (!s) return null;
    const W = (s.obs && s.obs.win) || s.target; if (!isBrowserWin(W)) return null;
    let clip; try { clip = require('electron').clipboard; } catch { return null; }
    try { const fg = await fgWin(); if (fg && fg.pid === process.pid) { await refocus(); } const fg2 = await fgWin(); if (fg2 && !(isBrowserWin({ title: fg2.title }) || (s.target && fg2.pid === s.target.pid))) { deps.log && deps.log('desk', `B118: không đọc trang — cửa sổ ở trước không phải trình duyệt (“${String(fg2.title || '').slice(0, 50)}”)`); return null; } } catch {}
    const n = SC.libnut(); const mod = require('./agent/keys').primaryOf(process.platform);
    const P = async (f, d) => { try { const v = await Promise.resolve(f()); return v == null ? d : v; } catch { return d; } }; // bộ nhớ tạm có thể trả Promise
    const fm = await P(() => clip.availableFormats(), []);
    const prev = { text: String(await P(() => clip.readText(), '')), image: (fm || []).some(f => /image/.test(f)) ? await P(() => clip.readImage(), null) : null };
    const grab = async (keys) => { await P(() => clip.writeText(''), null); for (const k of keys) { n.keyTap(k[0], k[1] ? [k[1]] : []); await sleep(k[2] || 150); } return String(await P(() => clip.readText(), '') || ''); };
    let text = '', url = '';
    try {
      if (page) text = await grab([['a', mod, 150], ['c', mod, 400]]);
      url = (await grab([['l', mod, 250], ['c', mod, 300]])).trim();
      n.keyTap('escape'); await sleep(120); n.keyTap('escape'); await sleep(120); // thanh địa chỉ về như cũ
    } catch (e) { deps.log && deps.log('desk', 'B118: không đọc được trang qua bộ nhớ tạm: ' + e.message); }
    finally { await sleep(150); if (prev.image && prev.image.isEmpty && !prev.image.isEmpty()) await P(() => clip.writeImage(prev.image), null); else await P(() => clip.writeText(prev.text || ''), null); }
    if (!/^(?:https?:\/\/)?[^\s/]+\.[^\s/]+/i.test(url) || /\s/.test(url)) url = '';
    deps.log && deps.log('desk', `B118: đọc trang trình duyệt: thanh địa chỉ ${url ? `“${url.slice(0, 120)}”` : 'không đọc được'} · chữ trang ${text.length} ký tự`);
    return { url, text: text.slice(0, 30000), title: W.title || '' };
  }
  // B155: AIVN TỰ đọc trang trong trình duyệt cho việc “tìm X rồi cho biết” (mô hình nhỏ hay nói không có công cụ đọc trang)
  async function navigateBrowser(url) {
    await refocus(); const n = SC.libnut(); const mod = require('./agent/keys').primaryOf(process.platform);
    n.keyTap('l', [mod]); await sleep(300); n.keyTap('a', [mod]); await sleep(80); n.typeString(new URL(url).href); await sleep(150); n.keyTap('enter');
    if (session) { session.obs = null; session.lastAction = { kind: 'navigate', url }; }
  }
  async function browserRead(a, ctx) {
    const W = require('./agent/web-read'); const web = require('./agent/web');
    const st = (deps.getSettings && deps.getSettings()) || {}; const net = st.agentWeb === true;
    const b = (a && a.browser && BP.byId(a.browser)) || BP.browserOf(a && a.query) || BP.byId('chrome');
    const lg = (m) => deps.log && deps.log('desk', m);
    const r = await W.autoRead({ query: a.query, browser: b }, {
      log: lg, waitMs: deps.isTest ? 300 : 3500,
      ensure: async (br) => { const e = await ensureApp({ app: br.name }, ctx); return e && !e.error ? { ok: true } : { ok: false, error: e && e.error }; },
      read: async () => { const s = session; if (s && s.target) { try { await observe(ctx, { thumb: false, vision: 'off' }); } catch {} } return readBrowserPage({ page: true }); },
      navigate: net ? (u) => navigateBrowser(u) : null,
      fetch: net ? (u) => web.fetchPage(u, { maxChars: 12000, signal: ctx && ctx.signal }) : null,
      search: net ? async (t) => { const x = await web.search(t, { signal: ctx && ctx.signal }); return (x && x.results) || []; } : null,
      ocr: async () => { const o = await observe(ctx, { thumb: false, vision: 'off' }); return ((session && session.obs && session.obs.elements) || []).map(e => e.name || e.value || '').filter(Boolean).join('\n') || (o && o.text) || ''; },
    });
    lg(`B155: AIVN tự đọc trang: ${r.ok ? `${r.url} (${r.via}, ${r.text.length} ký tự)` : 'không đọc được — ' + (r.error || '')} · ${r.trail.join(' → ')}`);
    return r;
  }
  async function openInBrowser(b, url) { return launchBrowserWith(b, url); }
  function actKey() {
    const s = session; if (!s || !s.obs) return '';
    const f = (s.obs.elements || []).find(e => e.focused && !e.ocr);
    const focus = f ? `f:${U.fold(String(f.kind || ''))}:${U.fold(String(f.name || f.placeholder || '')).slice(0, 40)}` : (s.focusProxy || '-');
    const names = (s.obs.elements || []).map(e => U.fold(String(e.name || ''))).filter(Boolean).sort().join('|');
    return focus + '#' + require('crypto').createHash('sha1').update(`${s.obs.win ? s.obs.win.title : ''}#${names}`).digest('hex').slice(0, 10);
  }
  return { readBrowserPage, browserRead, openInBrowser, cleanupDraft, lastDraft: () => lastDraft, clearLastDraft: () => { lastDraft = null; }, hasDraft: () => !!(session && session.draftTyped), actKey, likely: (q) => (session && session.obs ? U.likelyTarget(session.obs.elements, q) : null), diag: () => ({ calib: { ...calib }, displays: session && session.diag ? session.diag.displays : SC.displayInfo().text }), searchFound, searchTodo, needEyes: () => !!(session && session.needEyes), pending, look, act, ensureApp, readText, end, adoptApp, setBenchAnswer: (fn) => { benchAnswer = fn || null; }, active: () => !!session, riskOf, nativeToNorm };
}

module.exports = { createDesktopAgent, SEARCHY_ANY, webSearchTask, isBrowserWin };
