// AIVN AGENT điều khiển máy tính như một "desktop agent":
//   quan sát (ảnh màn hình thu nhỏ + cây giao diện UIA/AX + chữ OCR) → mô hình chọn thao tác theo id phần tử → (xin phép) → làm → quan sát lại để kiểm tra → lặp.
// Mô hình KHÔNG nhìn ảnh (Qwen3 4B/8B) thao tác theo id/tên phần tử; mô hình nhìn ảnh (Qwen3-VL, UI-TARS, Holo) dùng để định vị khi cây giao diện không có phần tử.
// An toàn: lớp phủ báo "AIVN AGENT đang điều khiển" + khung đỏ ở mục tiêu kế tiếp, Esc / Ctrl+Alt+Q để dừng, hỏi trước bước quan trọng, không bao giờ gõ mật khẩu.
const path = require('path');
const { BrowserWindow, screen, globalShortcut, nativeImage, ipcMain } = require('electron');
const SC = require('./screen-control');
const U = require('./agent/uitree');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const { riskOf, RISKY_NAME, ACT_LABEL, ALIASES } = require('./agent/desk-policy');

function createDesktopAgent(deps) {
  // deps: { engine, getSettings, setSettings, log, getMainWindow, preload, isTest, fakeScreen }
  const S = () => deps.getSettings();
  let overlay = null, overlayReady = null, session = null, askSeq = 0; const asks = new Map();
  const display = () => screen.getPrimaryDisplay();

  // ---------- toạ độ: gốc (native) ↔ chuẩn hoá 0..1 của màn hình chính ----------
  function nativeToNorm(x, y) {
    const d = display(); const b = d.bounds; let p = { x, y };
    if (process.platform === 'win32' && screen.screenToDipPoint) p = screen.screenToDipPoint({ x, y });
    else if (process.platform === 'linux') p = { x: x / d.scaleFactor, y: y / d.scaleFactor };
    return { nx: (p.x - b.x) / b.width, ny: (p.y - b.y) / b.height };
  }
  const normToNative = (nx, ny) => SC.toNut(nx, ny, display());
  const to1000 = (x, y) => { const n = nativeToNorm(x, y); return { x: Math.round(n.nx * 1000), y: Math.round(n.ny * 1000) }; };
  const rectNorm = (b) => { const a = nativeToNorm(b[0], b[1]), c = nativeToNorm(b[0] + b[2], b[1] + b[3]); return { x1: a.nx, y1: a.ny, x2: c.nx, y2: c.ny }; };

  // ---------- lớp phủ ----------
  function ensureOverlay() {
    if (overlay && !overlay.isDestroyed()) return overlayReady;
    const b = display().bounds;
    overlay = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, frame: false, transparent: true, resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
      focusable: false, show: false, hasShadow: false, fullscreenable: false, backgroundColor: '#00000000',
      webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    overlay.setAlwaysOnTop(true, 'screen-saver'); overlay.setIgnoreMouseEvents(true, { forward: true }); overlay.setContentProtection(true); // Windows/macOS: không lọt vào ảnh chụp
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
  ipcMain.on('overlay:mouse', (_e, inside) => { if (overlay && !overlay.isDestroyed() && !(session && session.asking)) overlay.setIgnoreMouseEvents(!inside, { forward: true }); });
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
    return session;
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
    return withOverlayHidden(() => SC.capture({ maxW: 1920 }));
  }
  const imgOf = (shot) => nativeImage.createFromDataURL(shot.dataUrl);
  function thumbOf(shot, box) {
    let img = imgOf(shot); img = img.resize({ width: 360, quality: 'good' });
    const t = 'data:image/jpeg;base64,' + img.toJPEG(60).toString('base64');
    return box ? { src: t, box } : { src: t };
  }
  // OCR theo dải ngang, phóng to ~2 lần: chữ giao diện nhỏ (9-12 px) và vùng trống lớn làm OCR cả màn hình bỏ sót gần hết
  async function ocrShot(shot, region) {
    const img = imgOf(shot); const W = shot.width, H = shot.height;
    const R = region ? { x: Math.max(0, Math.floor(region.x1 * W)), y: Math.max(0, Math.floor(region.y1 * H)), x2: Math.min(W, Math.ceil(region.x2 * W)), y2: Math.min(H, Math.ceil(region.y2 * H)) } : { x: 0, y: 0, x2: W, y2: H };
    const bandH = 180, overlap = 36, scale = (R.x2 - R.x) < 1000 ? 3 : 2; const out = []; // hộp thoại nhỏ (chữ nhỏ): phóng to hơn
    for (let y = R.y; y < R.y2; y += bandH - overlap) {
      const h = Math.min(bandH, R.y2 - y); if (h < 12) break;
      const crop = img.crop({ x: R.x, y, width: R.x2 - R.x, height: h }).resize({ width: Math.round((R.x2 - R.x) * scale), quality: 'best' });
      const r = await deps.engine.ocrLines(crop.toPNG());
      for (const l of r.lines) {
        const x1 = R.x + l.box[0] / scale, y1 = y + l.box[1] / scale, x2 = x1 + l.box[2] / scale, y2 = y1 + l.box[3] / scale;
        if ((y1 - y < 4 && y > R.y) || (y + h - y2 < 4 && y + h < R.y2)) continue; // dòng bị cắt ở mép dải: dải kế tiếp đọc trọn
        if (out.some(o => o.text === l.text && Math.abs(o.cy - (y1 + y2) / 2) < 14)) continue;
        out.push({ text: l.text, conf: l.conf, cy: (y1 + y2) / 2, nb: { x1: x1 / W, y1: y1 / H, x2: x2 / W, y2: y2 / H } });
      }
    }
    return out.filter(l => l.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 3 || l.conf >= 85);
  }
  async function observe(ctx, { query = '', ocr = 'auto', thumb = true } = {}) {
    const s = await begin(ctx); status('Đang quan sát màn hình…');
    const t0 = Date.now();
    // hộp thoại của chính ứng dụng (Lưu thành…, Mở…) đang ở trước: quan sát hộp thoại đó thay vì cửa sổ chính
    let hw = s.target && s.target.hwnd ? s.target.hwnd : 0; s.dialog = null;
    if (hw && process.platform !== 'darwin') { try { const d = U.activeDialogOf(await U.windows(), s.target); if (d) { hw = d.hwnd; s.dialog = d.title || 'hộp thoại'; deps.log && deps.log('desk', `Đang có hộp thoại “${d.title}” của cùng ứng dụng — quan sát hộp thoại`); } } catch {} }
    const [shot, raw] = await Promise.all([capture(), U.tree({ hwnd: hw, app: s.target && s.target.proc ? s.target.proc : '' }).catch(e => ({ error: e.message, els: [] }))]);
    if (raw && raw.win && raw.win.hwnd && !s.target) s.target = { hwnd: raw.win.hwnd, pid: raw.win.pid, proc: raw.win.proc, title: raw.win.title };
    const named = (Array.isArray(raw.els) ? raw.els : []).filter(x => x && x.n && U.INTERACTIVE.has(x.r)).length;
    let ocrLines = [];
    const wantOcr = ocr === 'force' || (ocr !== 'off' && (raw.noTree || raw.error || named < 8));
    if (wantOcr && deps.engine.ocrLines) {
      try {
        const wb = raw.win && Array.isArray(raw.win.b) && raw.win.b[2] > 100 ? raw.win.b : null;
        const r = await ocrShot(shot, wb ? rectNorm(wb) : null);
        ocrLines = r.map(l => { const a = normToNative(l.nb.x1, l.nb.y1), c = normToNative(l.nb.x2, l.nb.y2); return { text: l.text, b: [a.x, a.y, c.x - a.x, c.y - a.y] }; });
        s.ocrUsed = true;
      } catch (e) { deps.log && deps.log('desk', 'OCR lỗi: ' + e.message); }
    }
    const obs = U.normalize(raw, { ocr: ocrLines, max: 160 });
    s.obs = obs; s.shot = shot;
    let list = obs.elements;
    if (query) { const fq = U.fold(query); const hit = list.filter(e => U.fold(e.name).includes(fq) || (e.value && U.fold(e.value).includes(fq))); list = hit.length ? [...hit, ...list.filter(e => !hit.includes(e))] : list; }
    const text = U.formatForModel({ win: obs.win, elements: list }, { toNorm: to1000, limit: query ? 60 : 110 });
    const src = [raw.noTree ? null : raw.error ? 'cây giao diện lỗi: ' + raw.error.slice(0, 120) : `cây giao diện ${named} phần tử có tên`, ocrLines.length ? `OCR ${ocrLines.length} cụm chữ` : null].filter(Boolean).join(' · ');
    deps.log && deps.log('desk', `Quan sát: "${obs.win ? obs.win.title : '?'}" · ${obs.elements.length} phần tử (${src}) · ${Date.now() - t0} ms`);
    status(`Đã quan sát: ${obs.elements.length} phần tử`);
    return { obs, text, src, shot, thumb: thumb ? thumbOf(shot) : null };
  }

  // ---------- xin phép (thẻ trên lớp phủ) ----------
  let benchAnswer = null; // bài đo Điểm tác vụ: trả lời thẻ xin phép tự động (từ chối mọi bước quan trọng)
  async function ask(req) {
    const s = session; if (!s) return { ok: false };
    const id = 'a' + (++askSeq);
    s.asking = true; registerEsc(false);
    if (overlay && !overlay.isDestroyed()) { overlay.setIgnoreMouseEvents(false); overlay.setFocusable(true); overlay.showInactive(); overlay.focus(); }
    const r = await new Promise((resolve) => {
      const t = setTimeout(() => { asks.delete(id); resolve({ ok: false, reason: 'hết thời gian chờ (3 phút)' }); }, 3 * 60e3);
      asks.set(id, (x) => { clearTimeout(t); asks.delete(id); resolve(x || { ok: false }); });
      ov('ask', { id, ...req });
      if (benchAnswer) { const fn = benchAnswer; setTimeout(() => { const f = asks.get(id); if (f) f(fn(req)); }, 300); }
      else if (deps.autoTest && deps.autoAnswer) setTimeout(() => { const f = asks.get(id); if (f) f(deps.autoAnswer(req)); }, 300);
    });
    if (session) { session.asking = false; registerEsc(true); }
    if (overlay && !overlay.isDestroyed()) { overlay.setFocusable(false); overlay.setIgnoreMouseEvents(true, { forward: true }); }
    ov('asked', { id });
    return r;
  }

  // ---------- thao tác ----------
  function resolveTarget(a) {
    const s = session; const q = String(a.element || a.target || '').trim();
    if (q && s && s.obs) { const el = U.findElement(s.obs.elements, q); if (el) return { el, x: el.b[0] + el.b[2] / 2, y: el.b[1] + el.b[3] / 2, via: el.ocr ? 'OCR' : 'cây giao diện' }; }
    if (Number.isFinite(Number(a.x)) && Number.isFinite(Number(a.y)) && a.x !== '' && a.y !== '' && a.x != null && a.y != null && !(Number(a.x) === 0 && Number(a.y) === 0)) { const p = normToNative(Math.min(1, Math.max(0, a.x / 1000)), Math.min(1, Math.max(0, a.y / 1000))); return { el: null, x: p.x, y: p.y, via: 'toạ độ' }; }
    return q ? { el: null, query: q } : null;
  }
  // Định vị bằng mô hình nhìn ảnh: ưu tiên mô hình định vị riêng (chế độ hai mô hình: Holo / UI-TARS / Qwen-VL), không có thì dùng chính mô hình đang chat nếu nhìn được ảnh
  async function groundWithVision(query, ctx) {
    let g = null; try { g = deps.grounder ? await deps.grounder() : null; } catch (e) { deps.log && deps.log('desk', 'Không nạp được mô hình định vị: ' + e.message); }
    const st = deps.engine.status();
    if (!g && !(st && st.vision)) return null;
    const modelId = g ? g.id : (st.path || st.id || ''); const eng = g ? g.engine : deps.engine;
    status(`Đang tìm “${query}” bằng ${g ? 'mô hình định vị' : 'mô hình nhìn ảnh'}…`);
    const fi = SC.familyInfo(modelId);
    const shot = await withOverlayHidden(() => deps.fakeScreen ? deps.fakeScreen() : SC.capture({ maxW: 1280, align: fi.align }));
    const r = await SC.locate(eng, shot, query, { signal: ctx.signal, modelId });
    deps.log && deps.log('desk', `Định vị "${query}" bằng ${g ? 'mô hình định vị ' : ''}${modelId.split(/[\\/]/).pop()}: ${r.box && r.box.found ? 'thấy' : 'không thấy'} · ${String(r.raw || '').slice(0, 120)}`);
    if (!r.box || !r.box.found) return null;
    const p = normToNative((r.box.x1 + r.box.x2) / 2, (r.box.y1 + r.box.y2) / 2);
    return { el: null, x: p.x, y: p.y, via: g ? 'mô hình định vị' : 'mô hình nhìn ảnh', box: r.box };
  }
  async function performAt(action, x, y, a) {
    const n = SC.libnut();
    if (x != null) { n.moveMouse(Math.round(x), Math.round(y)); await sleep(140); }
    if (action === 'click') n.mouseClick('left', false);
    if (action === 'double_click') n.mouseClick('left', true);
    if (action === 'right_click') n.mouseClick('right', false);
    if (action === 'type_text') {
      if (x != null) { n.mouseClick('left', false); await sleep(250); }
      if (a.__replace) { n.keyTap('a', process.platform === 'darwin' ? 'command' : 'control'); await sleep(120); }
      const t = String(a.text || '');
      if (process.platform === 'linux') { // X11: dán qua bộ nhớ tạm không ổn định với mọi ứng dụng → xdotool type (Unicode)
        try { await new Promise((res, rej) => require('child_process').execFile('xdotool', ['type', '--delay', '12', '--', t], { timeout: 60000 }, (e) => e ? rej(e) : res())); return; } catch {}
      }
      const { clipboard } = require('electron');
      const prev = await Promise.resolve(clipboard.readText()).catch(() => '');
      await Promise.resolve(clipboard.writeText(t)); await sleep(60);
      n.keyTap('v', process.platform === 'darwin' ? 'command' : 'control'); await sleep(350);
      setTimeout(async () => { try { if (await Promise.resolve(clipboard.readText()) === t) await Promise.resolve(clipboard.writeText(prev || '')); } catch {} }, 1500);
    }
    if (action === 'hotkey') { const k = SC.parseKeys(a.keys); const esc = k.key === 'escape'; if (esc) registerEsc(false); try { if (k.mods.length) n.keyTap(k.key, k.mods); else n.keyTap(k.key); } finally { if (esc) setTimeout(() => session && !session.asking && registerEsc(true), 300); } }
    if (action === 'scroll') { const amt = Math.max(-20, Math.min(20, Math.round(Number(a.amount) || -5))); n.scrollMouse(0, process.platform === 'win32' ? amt * 120 : amt); }
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
    if (action === 'type_text') return `gõ “${String(a.text).slice(0, 200)}”${who ? ' vào ' + who : ' vào ô đang chọn'}`;
    if (action === 'hotkey') return `bấm phím ${a.keys}`;
    if (action === 'scroll') return `cuộn ${Number(a.amount) > 0 ? 'lên' : 'xuống'} ${Math.abs(Number(a.amount) || 5)} nấc${who ? ' tại ' + who : ''}`;
    return `${(ACT_LABEL[action] || action).toLowerCase()} ${who}`.trim();
  }

  async function act(a, ctx) {
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
    if (action === 'hotkey') SC.parseKeys(a.keys); // chặn tổ hợp hệ thống trước khi hỏi
    if (action === 'type_text' && !String(a.text || '')) throw new Error('Thiếu text cần gõ.');

    if (!s.obs) await observe(ctx, { thumb: false });
    let needPoint = ['click', 'double_click', 'right_click'].includes(action) || ((action === 'type_text' || action === 'scroll') && (a.element || a.target || (a.x != null && a.y != null && !(Number(a.x) === 0 && Number(a.y) === 0))));
    let t = needPoint ? resolveTarget(a) : null;
    // gõ vào một nhãn chữ/nút (không phải ô nhập) là sai: gõ vào ô đang được chọn, không bấm vào nhãn
    if (action === 'type_text' && t && t.el && !t.el.editable) { t = null; needPoint = false; }
    if (needPoint && (!t || t.x == null)) {
      const q = t && t.query ? t.query : '';
      if (q && !/^\[?e\d+\]?$/i.test(q)) t = await groundWithVision(q, ctx) || t;
      if (!t || t.x == null) {
        const near = q ? s.obs.elements.filter(e => U.fold(e.name).split(' ').some(w => w.length > 2 && U.fold(q).includes(w))).slice(0, 8) : [];
        return { error: 'không thấy phần tử', forModel: `Không thấy phần tử "${q || '(trống)'}" trong lần quan sát mới nhất${/^\[?e\d+\]?$/i.test(q) ? ' (id cũ? hãy dùng id từ danh sách MỚI NHẤT)' : ''}. ${near.length ? 'Phần tử gần giống: ' + near.map(e => `[${e.id}] ${e.kind} "${e.name}"`).join('; ') + '.' : ''} Hãy gọi screen_look (có thể kèm query) để xem lại, hoặc cuộn (scroll) nếu phần tử nằm ngoài màn hình.`, summary: 'không thấy ' + (q || 'phần tử') };
      }
    }
    // mô hình nhỏ hay chép sai chữ hoa/dấu của đoạn người dùng đưa trong ngoặc kép: dùng đúng nguyên văn của người dùng
    if (action === 'type_text' && a.text && ctx && ctx.userQuery) a.text = U.restoreQuoted(String(a.text), ctx.userQuery);
    // mật khẩu: không bao giờ gõ
    const focusedEl = s.obs && s.obs.elements.find(e => e.focused);
    const pwEl = action === 'type_text' ? (t && t.el ? t.el : focusedEl) : null;
    if (action === 'type_text' && ((pwEl && pwEl.password) || (t && t.query && U.PASSWORD_NAME.test(t.query)))) {
      return { refused: true, forModel: 'AIVN AGENT KHÔNG BAO GIỜ gõ mật khẩu/mã PIN/OTP. Dừng lại và nhờ người dùng tự gõ vào ô này, rồi tiếp tục khi họ báo xong.', summary: 'không gõ mật khẩu' };
    }
    const desc = describeAct(action, a, t);
    const risk = riskOf(action, { el: t && t.el, query: t && t.query, text: a.text, keys: a.keys, lastAction: s.lastAction });
    const mode = S().agentScreenMode === 'important' ? 'important' : 'each';
    const box = t && t.x != null ? (t.el ? rectNorm(t.el.b) : t.box || (() => { const n = nativeToNorm(t.x, t.y); return { x1: n.nx - 0.012, y1: n.ny - 0.012, x2: n.nx + 0.012, y2: n.ny + 0.012 }; })()) : null;
    if (box) ov('target', { box, label: desc });
    if (mode === 'each' || risk) {
      status(risk ? 'Cần bạn cho phép bước quan trọng' : 'Chờ bạn cho phép');
      const crop = s.shot ? thumbOf(s.shot).src : null;
      const r = await ask({ action, title: risk ? '⚠ Bước quan trọng — kiểm tra kỹ' : 'AIVN AGENT muốn làm bước này', desc: desc.charAt(0).toUpperCase() + desc.slice(1), risk, text: action === 'type_text' ? String(a.text) : null,
        window: s.obs && s.obs.win ? s.obs.win.title : '', image: s.shot ? s.shot.dataUrl : crop, box, via: t ? t.via : null, mode });
      if (!r.ok) {
        ov('target', { box: null });
        const reason = String(r.reason || '').trim();
        s.lastAction = null;
        return { refused: true, forModel: `Người dùng KHÔNG cho phép: ${desc}.${reason ? ` Lý do của người dùng: "${reason.slice(0, 300)}". Hãy làm theo góp ý này.` : ' Dừng thao tác này và hỏi người dùng muốn làm gì.'}`, summary: 'bị từ chối' + (reason ? ': ' + reason.slice(0, 60) : '') };
      }
      if (r.mode === 'important' && mode !== 'important' && deps.setSettings) deps.setSettings({ agentScreenMode: 'important' });
      await refocus();
    } else { await sleep(450); } // để người dùng kịp thấy khung đỏ
    if (ctx.signal && ctx.signal.aborted) throw new Error('Đã dừng.');
    status(desc.charAt(0).toUpperCase() + desc.slice(1) + '…');
    const before = s.obs; const beforeDialog = s.dialog || null;
    // trong hộp thoại Lưu/Mở, "ctrl+s"/"ctrl+o" không có nghĩa: hiểu là xác nhận hộp thoại (Enter)
    if (action === 'hotkey' && s.dialog && /^(ctrl|cmd|command|meta)\+(shift\+)?[so]$/i.test(String(a.keys || '').replace(/\s/g, ''))) { deps.log && deps.log('desk', `Đang ở hộp thoại “${s.dialog}”: đổi ${a.keys} → enter (xác nhận)`); a = { ...a, keys: 'enter' }; }
    if (action === 'type_text') {
      // thay nội dung cũ (chọn hết rồi gõ) chỉ với ô một dòng (tên tệp, tìm kiếm…), không bao giờ với vùng soạn thảo tài liệu
      const el = t && t.el ? t.el : focusedEl;
      const single = el && el.editable && !/document|tài liệu|soạn thảo|multi/i.test(`${el.role || ''} ${el.kind || ''}`);
      const afterSave = s.lastAction && s.lastAction.action === 'hotkey' && /^(ctrl|cmd|command|meta)\+(shift\+)?[so]$/i.test(String(s.lastAction.keys || '').replace(/\s/g, '')) && Date.now() - s.lastAction.at < 120000;
      a = { ...a, __replace: (a.replace === true && single) || (afterSave && !(el && /document|tài liệu/i.test(`${el.role || ''} ${el.kind || ''}`))) };
    }
    await performAt(action, t && t.x != null ? t.x : null, t && t.x != null ? t.y : null, a);
    s.lastAction = { action, el: t && t.el, keys: a.keys, at: Date.now() };
    deps.log && deps.log('desk', `Thao tác: ${desc}${t && t.via ? ' (định vị bằng ' + t.via + ')' : ''}`);
    ov('target', { box: null });
    await sleep(action === 'type_text' ? 500 : 700);
    // kiểm tra lại
    const o = await observe(ctx, { ocr: s.ocrUsed ? 'auto' : 'auto' });
    const checks = [];
    if (before && before.win && o.obs.win && before.win.title !== o.obs.win.title) checks.push(`Cửa sổ đổi thành "${o.obs.win.title}".`);
    if (action === 'type_text') {
      const typed = U.fold(String(a.text).split('\n')[0]).slice(0, 40);
      const seen = o.obs.elements.some(e => (e.value && U.fold(e.value).includes(typed)) || (e.name && U.fold(e.name).includes(typed)));
      checks.push(seen ? 'Đã thấy chữ vừa gõ trên màn hình.' : 'CHƯA thấy chữ vừa gõ trong danh sách phần tử (có thể ô không hiện giá trị) — hãy kiểm tra trước khi làm tiếp.');
    }
    if (beforeDialog && s.dialog === beforeDialog) checks.push(`Hộp thoại “${beforeDialog}” VẪN đang mở — việc trong hộp thoại CHƯA xong. Xác nhận bằng nút của hộp thoại (Save/Lưu/OK/Mở) hoặc hotkey "enter"; đừng báo đã xong.`);
    else if (beforeDialog && !s.dialog) checks.push(`Hộp thoại “${beforeDialog}” đã đóng.`);
    const foc = o.obs.elements.find(e => e.focused); if (foc) checks.push(`Đang chọn: [${foc.id}] ${foc.kind} "${foc.name}".`);
    if (before && o.obs.elements.length && Math.abs(o.obs.elements.length - before.elements.length) > 3) checks.push(`Số phần tử: ${before.elements.length} → ${o.obs.elements.length}.`);
    if (!checks.length) checks.push('Màn hình không thay đổi rõ ràng — nếu cần, thử cách khác.');
    return { forModel: `Đã ${desc}.\nKiểm tra: ${checks.join(' ')}\nMàn hình bây giờ (id mới, dùng các id này cho bước tiếp):\n${o.text}`, summary: desc + (t && t.via ? ` · ${t.via}` : ''), thumb: o.thumb, detail: checks.join(' ') };
  }

  async function look(a, ctx) {
    if (a && a.window) { const w = U.matchWindow(await U.windows(), String(a.window)); if (w) { await begin(ctx); await U.focus(w).catch((e) => deps.log && deps.log("desk", "Không chuyển được tới cửa sổ (có thể đang mở hộp thoại): " + e.message)); session.target = { hwnd: w.hwnd, pid: w.pid, proc: w.proc, title: w.title }; await sleep(400); } }
    const o = await observe(ctx, { query: a && a.query, ocr: a && a.ocr ? 'force' : 'auto' });
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
  return { pending, look, act, readText, end, adoptApp, setBenchAnswer: (fn) => { benchAnswer = fn || null; }, active: () => !!session, riskOf, nativeToNorm };
}

module.exports = { createDesktopAgent };
