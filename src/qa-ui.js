'use strict';
// QA giao diện không người (beta.3): AIVN.exe --qa-ui <script.json> --out <result.json> [--shots <thư mục>] [--profile <thư mục>] [--timeout <giây>]
// Cùng cổng bật với --agent-task (AIVN_QA_MODE=1 VÀ có cờ). Chạy các bước NGAY TRONG trình hiển thị của AIVN qua
// webContents.executeJavaScript / sendInputEvent — KHÔNG mở cổng gỡ lỗi từ xa (CDP) hay bất kỳ cổng mạng nào.
// Một lần chạy = một phiên. Mã thoát: 0 mọi bước đạt · 2 có bước hỏng.
const fs = require('fs'); const path = require('path');
const { writeJson } = require('./qa-runner');

const PAGES = { chat: 'chat', agent: 'agent', models: 'models', discover: 'discover', settings: 'settings', schedule: 'schedule', memory: 'memory', server: 'server', developer: 'server', biz: 'crm', crm: 'crm' };
// tên tham số theo vị trí cho dạng viết tắt { "click": "chat-send" } / { "type": ["chat-input", "xin chào"] }
const ACTIONS = {
  goto: ['page'], click: ['testid'], dblclick: ['testid'], rightclick: ['testid'], hover: ['testid'], type: ['testid', 'text'], press: ['key'], select: ['testid', 'value'],
  scroll: ['target'], drag: ['from', 'to'], setFiles: ['testid', 'paths'], dialog: ['answer'], wait: ['target'], waitFor: ['testid', 'timeout'], waitIdle: ['timeout'],
  expect: ['testid', 'is'], expectText: ['testid', 'text'], expectCount: ['testid', 'count'], expectVisible: ['testid'], expectHidden: ['testid'],
  readText: ['testid', 'as'], readValue: ['testid', 'as'], screenshot: ['name'], setLang: ['lang'], setTheme: ['theme'], resize: ['w', 'h'],
  seed: ['fixture'], reset: [], download: ['testid', 'as'], clipboard: ['as'], setNetwork: ['mode'], setTime: ['time'], loadModel: ['id'], unloadModel: [], onError: ['mode'],
};
function normStep(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('bước phải là đối tượng JSON');
  if (raw.do) { if (!ACTIONS[raw.do]) throw new Error(`không có bước “${raw.do}”`); return { ...raw }; }
  let keys = Object.keys(raw).filter(k => ACTIONS[k]); if (keys.length > 1) keys = keys.filter(k => k !== 'onError'); /* “onError” bên cạnh một hành động = tuỳ chọn của bước đó */ if (keys.length !== 1) throw new Error(`bước cần đúng một hành động (${Object.keys(ACTIONS).join(', ')})`);
  const act = keys[0]; const v = raw[act]; const names = ACTIONS[act]; const st = { ...raw, do: act }; delete st[act];
  if (Array.isArray(v) && names.length > 1) names.forEach((n, i) => { if (v[i] !== undefined) st[n] = v[i]; });
  else if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(st, v);
  else if (names.length) st[names[0]] = v;
  return st;
}
function validate(a, { cwd = process.cwd() } = {}) {
  if (!a || a.script == null) return { ok: false, error: 'không có cờ --qa-ui' };
  if (!a.script) return { ok: false, error: 'thiếu --qa-ui <script.json>' };
  if (!a.out) return { ok: false, error: 'thiếu --out <result.json>' };
  const script = path.resolve(cwd, a.script); let j;
  try { j = JSON.parse(fs.readFileSync(script, 'utf8').replace(/^\ufeff/, '')); } catch (e) { return { ok: false, error: `không đọc được kịch bản ${script}: ${e.message}` }; }
  const steps = Array.isArray(j) ? j : j && j.steps; if (!Array.isArray(steps) || !steps.length) return { ok: false, error: 'kịch bản cần mảng "steps"' };
  try { steps.forEach(normStep); } catch (e) { return { ok: false, error: 'kịch bản sai: ' + e.message }; }
  const out = path.resolve(cwd, a.out);
  let timeout = a.timeout ? Number(a.timeout) : 900; if (!(timeout > 0)) return { ok: false, error: '--timeout phải là số giây > 0' };
  return { ok: true, args: { script, out, shots: a.shots ? path.resolve(cwd, a.shots) : path.join(path.dirname(out), 'shots'), timeout: Math.min(timeout, 7200), profile: a.profile ? path.resolve(cwd, a.profile) : null, lang: a.lang || null } };
}

// ---------- phát hiện lỗi dịch trong chữ đang hiện ----------
const VI_CH = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
const CJK = /[\u3400-\u9fff]/;
const KEEP = /NGUYỄN NGỌC KHÔI|SINH VIÊN VLU|Tiếng Việt|AIVN|Khôi/i; // tên riêng / tên ngôn ngữ trong ô chọn ngôn ngữ
function i18nIssues(texts, lang) {
  const out = [];
  for (const t0 of texts) { const t = String(t0).trim(); if (!t || KEEP.test(t)) continue;
    if (/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+){1,4}$/.test(t) && !/\.(gguf|json|csv|pdf|xlsx|png|jpg|exe|dmg|md|txt|com|vn|io|org|net|ai)$/i.test(t)) out.push({ kind: 'raw-key', text: t });
    else if (/\{\d+\}|\$\{|\bundefined\b|\bNaN\b|\[object Object\]/.test(t)) out.push({ kind: 'placeholder', text: t.slice(0, 160) });
    else if (lang !== 'vi' && VI_CH.test(t)) out.push({ kind: 'vi-in-' + lang, text: t.slice(0, 160) });
    else if (lang !== 'zh' && CJK.test(t)) out.push({ kind: 'zh-in-' + lang, text: t.slice(0, 160) });
    if (out.length >= 60) break; }
  return out;
}

// ---------- trình điều khiển trong trang (chèn vào thế giới chính của renderer) ----------
const DRIVER = String.raw`(() => { if (window.__qa) return true;
  const sel = (id) => id.startsWith('css=') ? id.slice(4) : id.endsWith('*') ? '[data-testid^="' + CSS.escape(id.slice(0, -1)) + '"]' : '[data-testid="' + CSS.escape(id) + '"]';
  const vis = (el) => { if (!el || !el.isConnected) return false; if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const all = (id) => { const m = /^(.*):nth\((\d+)\)$/.exec(id); const list = [...document.querySelectorAll(sel(m ? m[1] : id))]; return m ? list.slice(+m[2], +m[2] + 1) : list; };
  const pick = (id) => { const l = all(id); return l.find(vis) || l[0] || null; };
  const txt = (el) => (el ? (el.matches('input,textarea,select') ? el.value : (el.innerText || el.textContent || '')).replace(/\s+/g, ' ').trim() : '');
  const dlgQ = []; const dlgLog = [];
  const nextDlg = (kind, msg) => { const a = dlgQ.length ? dlgQ.shift() : 'dismiss'; dlgLog.push({ kind, msg: String(msg || '').slice(0, 200), answer: a }); return a; };
  window.alert = (m) => { nextDlg('alert', m); };
  window.confirm = (m) => nextDlg('confirm', m) === 'accept';
  window.prompt = (m, d) => { const a = nextDlg('prompt', m); return a === 'dismiss' ? null : (a === 'accept' ? (d ?? '') : a); };
  let off = 0; const RD = Date;
  window.__qa = {
    info(id) { const l = all(id); const el = l.find(vis) || l[0] || null; if (!el) return { count: 0, visible: 0 };
      if (vis(el)) el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const top = document.elementFromPoint(cx, cy);
      return { count: l.length, visible: l.filter(vis).length, isVisible: vis(el), rect: { x: r.left, y: r.top, w: r.width, h: r.height }, cx, cy, covered: !!(top && top !== el && !el.contains(top) && !top.contains(el)), coveredBy: top && top !== el && !el.contains(top) ? (top.getAttribute('data-testid') || top.id || top.className || top.tagName).toString().slice(0, 80) : null,
        text: txt(el), value: 'value' in el ? String(el.value) : null, tag: el.tagName.toLowerCase(), type: el.type || null, disabled: !!el.disabled, draggable: el.draggable === true }; },
    focus(id) { const el = pick(id); if (!el) return false; el.focus(); if (el.select && el.matches('input,textarea')) el.select(); else if (el.isContentEditable) { const s = getSelection(); s.selectAllChildren(el); } return document.activeElement === el || el.contains(document.activeElement); },
    setValue(id, v) { const el = pick(id); if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value === String(v); },
    selectOption(id, v) { const el = pick(id); if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'không phải ô chọn' }; const o = [...el.options].find(o => o.value === String(v)) || [...el.options].find(o => o.textContent.trim() === String(v)); if (!o) return { ok: false, error: 'không có lựa chọn “' + v + '” (có: ' + [...el.options].map(o => o.value).join(', ') + ')' }; el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, value: o.value }; },
    scroll(t) { if (typeof t === 'number') { const s = document.querySelector('.view.active .scroll, .view.active') || document.scrollingElement; (s || document.scrollingElement).scrollTo({ top: t }); return true; } const el = pick(t); if (!el) return false; el.scrollIntoView({ block: 'center' }); return true; },
    dnd(a, b) { const s = pick(a), t = pick(b); if (!s || !t) return false; const dt = new DataTransfer(); const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); ev(s, 'dragstart'); ev(t, 'dragenter'); ev(t, 'dragover'); ev(t, 'drop'); ev(s, 'dragend'); return true; },
    dialogs(a) { if (a) dlgQ.push(a); return dlgLog.slice(); },
    idle() { const st = typeof state !== 'undefined' ? state : null; const stop = document.querySelector('#stopBtn'); return !(st && st.generating) && !(stop && vis(stop)); },
    texts() { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => { const p = n.parentElement; if (!p || !n.nodeValue.trim()) return 2; if (p.closest('[data-qa-i18n-skip], .msg .body, .bubble, .md, textarea, input, select option, script, style, code, pre, .convo-title, .model-name')) return 2; return vis(p) ? 1 : 2; } }); let n; while ((n = w.nextNode()) && out.length < 4000) out.push(n.nodeValue); for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) { if (!vis(el)) continue; for (const k of ['placeholder', 'aria-label']) { const v = el.getAttribute(k); if (v) out.push(v); } } return out; },
    setClock(ms) { off = ms; if (window.Date === RD && ms) { const D = class extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + off); } static now() { return RD.now() + off; } }; window.Date = D; } return true; },
  };
  return true; })()`;

async function run(args, deps, { runId = String(Date.now()) } = {}) {
  const t0 = Date.now(); const win = deps.win(); const wc = win.webContents;
  const raw = JSON.parse(fs.readFileSync(args.script, 'utf8').replace(/^\ufeff/, '')); const script = Array.isArray(raw) ? { steps: raw } : raw;
  const res = { schema: 1, runId, kind: 'qa-ui', version: deps.version || null, commit: deps.commit || null, script: args.script, name: script.name || path.basename(args.script), profile: deps.profile ? deps.profile.dir : null,
    status: null, steps: [], reads: {}, downloads: [], dialogs: [], consoleErrors: [], mainErrors: [], i18n: { issues: [] }, resources: {}, screen: null, timings: { startedAt: new Date(t0).toISOString() } };
  fs.mkdirSync(args.shots, { recursive: true }); const dlDir = path.join(args.shots, 'downloads'); fs.mkdirSync(dlDir, { recursive: true });
  try { res.screen = deps.displays ? deps.displays() : null; } catch {}
  const onCon = (e, level, message, line, src) => { const lv = e && e.level != null ? e.level : level; const msg = (e && e.message) || message; if (lv === 3 || lv === 'error') res.consoleErrors.push({ at: Date.now() - t0, msg: String(msg).slice(0, 500), src: String((e && e.sourceId) || src || '').split('/').pop() + ':' + ((e && e.lineNumber) || line) }); };
  wc.on('console-message', onCon);
  const gone = (_e, d) => res.mainErrors.push({ at: Date.now() - t0, msg: 'Trình hiển thị dừng: ' + (d && d.reason) });
  wc.on('render-process-gone', gone);
  const untap = deps.LOG && deps.LOG.tap ? deps.LOG.tap((l, scope) => { if (/^(crash|error)$/.test(scope) || /\b(Error|TypeError|ReferenceError|Lỗi không mong đợi)\b/.test(l)) { if (res.mainErrors.length < 200) res.mainErrors.push({ at: Date.now() - t0, msg: l.trim().slice(0, 500) }); } }) : () => {};
  // hộp thoại hệ điều hành → không bao giờ hiện (sẽ giành tiêu điểm); mở tệp lấy từ setFiles, lưu tệp vào shots/downloads
  const openQ = []; const msgQ = []; let lastSave = null;
  const hooks = deps.hookDialogs ? deps.hookDialogs({
    open: (o) => { const p = openQ.shift(); res.dialogs.push({ kind: 'open', title: o && o.title || null, answer: p ? p : 'canceled' }); return p ? { canceled: false, filePaths: p } : { canceled: true, filePaths: [] }; },
    save: (o) => { const name = path.basename(String((o && o.defaultPath) || 'aivn-export')); const f = path.join(dlDir, name); lastSave = f; res.dialogs.push({ kind: 'save', title: o && o.title || null, answer: f }); return { canceled: false, filePath: f }; },
    message: (o) => { const a = msgQ.length ? msgQ.shift() : 'dismiss'; const btns = (o && o.buttons) || ['OK']; const idx = a === 'accept' ? (o && Number.isInteger(o.defaultId) ? o.defaultId : 0) : (o && Number.isInteger(o.cancelId) ? o.cancelId : btns.length - 1); res.dialogs.push({ kind: 'message', msg: String(o && (o.message || o.title) || '').slice(0, 200), buttons: btns, answer: a }); return { response: idx, checkboxChecked: false }; },
  }) : null;
  const willDl = (_e, item) => { const f = path.join(dlDir, item.getFilename()); item.setSavePath(f); lastSave = f; };
  wc.session.on('will-download', willDl);
  const js = (code) => wc.executeJavaScript(code, true);
  const ensure = async () => { await js(DRIVER); };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const info = async (id) => { await ensure(); return js(`__qa.info(${JSON.stringify(String(id))})`); };
  const need = async (id, { visible = true, timeout = 10000 } = {}) => { const end = Date.now() + timeout; let i; while (true) { i = await info(id); if (i.count && (!visible || i.isVisible)) return i; if (Date.now() > end) break; await sleep(150); } throw new Error(i.count ? `“${id}” có nhưng không hiện (${i.count} phần tử)` : `không thấy phần tử data-testid “${id}”`); };
  const mouse = async (x, y, button = 'left', clickCount = 1) => { x = Math.round(x); y = Math.round(y); wc.sendInputEvent({ type: 'mouseMove', x, y }); wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount }); wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount }); };
  const clickAt = async (st, button = 'left', count = 1) => { const i = await need(st.testid, { timeout: st.timeout || 10000 }); if (i.disabled) throw new Error(`“${st.testid}” đang bị tắt (disabled)`); if (i.covered && !st.force) throw new Error(`“${st.testid}” bị phần tử khác che (${i.coveredBy})`); for (let k = 1; k <= count; k++) await mouse(i.cx, i.cy, button, k); return { x: Math.round(i.cx), y: Math.round(i.cy) }; };
  const MOD = { ctrl: 'control', control: 'control', cmd: 'meta', meta: 'meta', alt: 'alt', shift: 'shift' };
  const press = async (combo) => { const parts = String(combo).split('+').map(s => s.trim()).filter(Boolean); const key = parts.pop() || ''; const mods = parts.map(p => MOD[p.toLowerCase()]).filter(Boolean); const kc = key.length === 1 ? key : ({ enter: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' })[key.toLowerCase()] || key;
    wc.sendInputEvent({ type: 'keyDown', keyCode: kc, modifiers: mods }); if (key.length === 1 && !mods.some(m => m === 'control' || m === 'meta' || m === 'alt')) wc.sendInputEvent({ type: 'char', keyCode: key, modifiers: mods }); else if (kc === 'Enter' && !mods.length) wc.sendInputEvent({ type: 'char', keyCode: '\r' }); wc.sendInputEvent({ type: 'keyUp', keyCode: kc, modifiers: mods }); };
  const shot = async (name) => { const img = await wc.capturePage(); const f = path.join(args.shots, String(name).replace(/[^\w.-]+/g, '_') + (/\.png$/i.test(name) ? '' : '.png')); fs.writeFileSync(f, img.toPNG()); return f; };
  const lang = () => js('(window.I18N && I18N.lang) || "vi"').catch(() => 'vi');
  const scanI18n = async (where) => { try { await ensure(); const l = await lang(); const iss = i18nIssues(await js('__qa.texts()'), l); for (const x of iss) if (!res.i18n.issues.some(y => y.text === x.text)) res.i18n.issues.push({ ...x, where, lang: l }); } catch {} };
  const resources = async () => { const m = deps.metrics ? deps.metrics() : null; let hw = null; try { hw = deps.hw ? await deps.hw() : null; } catch {} return { at: new Date().toISOString(), appMemMB: m ? m.appMemMB : null, mainHeapMB: Math.round(process.memoryUsage().heapUsed / 1048576), vram: hw && hw.vram ? { totalMB: Math.round(hw.vram.total / 1048576), freeMB: Math.round(hw.vram.free / 1048576) } : null, model: deps.engine ? (({ loaded, id, mode, contextSize }) => ({ loaded, id, mode, contextSize }))(deps.engine.status()) : null }; };
  let onError = script.onError === 'continue' ? 'continue' : 'stop'; let failed = 0; let clockOff = 0;
  const deadline = t0 + args.timeout * 1000;
  try {
    await ensure(); res.resources.start = await resources();
    if (script.size) { const [w, h] = script.size; win.setContentSize(+w, +h); }
    const steps = script.steps.map(normStep);
    for (let n = 0; n < steps.length; n++) {
      const st = steps[n]; const s0 = Date.now(); const rec = { n: n + 1, action: st.do, args: Object.fromEntries(Object.entries(st).filter(([k]) => k !== 'do')), ok: false, ms: 0 };
      if (Date.now() > deadline) { rec.error = 'hết thời gian của cả kịch bản (--timeout)'; res.steps.push(rec); failed++; break; }
      try { rec.result = await doStep(st); rec.ok = true; }
      catch (e) { rec.error = String(e && e.message || e); if (st.optional) { rec.optional = true; rec.ok = true; rec.skipped = true; } else failed++; if (!st.optional) try { rec.shot = await shot(`fail-${String(n + 1).padStart(2, '0')}-${st.do}`); } catch {} }
      rec.ms = Date.now() - s0; res.steps.push(rec);
      deps.LOG && deps.LOG.log('qa', `QA giao diện bước ${n + 1} ${st.do}: ${rec.ok ? 'đạt' : 'HỎNG — ' + rec.error} (${rec.ms} ms)`);
      if (!rec.ok && (st.onError || onError) === 'stop') break;
    }
  } catch (e) { res.mainErrors.push({ at: Date.now() - t0, msg: 'QA runner: ' + (e.stack || e.message) }); failed++; }
  try { res.finalShot = await shot('final'); } catch (e) { res.finalShotError = e.message; }
  await scanI18n('final');
  try { res.dialogs.push(...(await js('window.__qa ? __qa.dialogs() : []')).map(d => ({ kind: 'page-' + d.kind, msg: d.msg, answer: d.answer }))); } catch {}
  try { res.resources.end = await resources(); } catch {}
  wc.removeListener('console-message', onCon); wc.removeListener('render-process-gone', gone); wc.session.removeListener('will-download', willDl); untap(); if (hooks) hooks.restore();
  if (clockOff && deps.setMainClock) deps.setMainClock(0);
  try { wc.session.disableNetworkEmulation(); } catch {}
  res.status = failed ? 'failed' : 'done'; res.failedSteps = failed; res.exitCode = failed ? 2 : 0;
  res.timings.totalMs = Date.now() - t0; res.timings.finishedAt = new Date().toISOString();
  writeJson(args.out, res);
  deps.LOG && deps.LOG.log('qa', `QA giao diện xong: ${res.status} (${res.steps.filter(s => s.ok).length}/${res.steps.length} bước đạt) → ${args.out}`);
  return res;

  async function doStep(st) {
    const to = st.timeout || 10000;
    switch (st.do) {
      case 'goto': { const [p, sub] = String(st.page || '').split('/'); const v = PAGES[p]; if (!v) throw new Error(`trang không hợp lệ “${st.page}” (chat, agent, models, discover, settings[/tab], biz/<phân hệ>, schedule, memory, server)`);
        if (v === 'crm') { const ok = await js(`(() => { const b = document.querySelector('.nav-item[data-view="crm"]'); if (!b || b.hidden) return false; ${sub ? `crm.tab = ${JSON.stringify(sub)}; if (window.BIZ) BIZ.reset();` : ''} show('crm'); return true; })()`); if (!ok) throw new Error('mục Kinh doanh đang tắt trên máy này'); }
        else await js(`show(${JSON.stringify(v)}${sub && v === 'settings' ? `, { tab: ${JSON.stringify(sub)} }` : ''})`);
        await sleep(250); return { view: await js('show.cur') }; }
      case 'click': return clickAt(st);
      case 'dblclick': return clickAt(st, 'left', 2);
      case 'rightclick': return clickAt(st, 'right');
      case 'hover': { const i = await need(st.testid, { timeout: to }); wc.sendInputEvent({ type: 'mouseMove', x: Math.round(i.cx), y: Math.round(i.cy) }); await sleep(st.ms || 400); return { x: Math.round(i.cx), y: Math.round(i.cy) }; }
      case 'type': { await need(st.testid, { timeout: to }); if (!(await js(`__qa.focus(${JSON.stringify(st.testid)})`))) throw new Error(`không đưa con trỏ vào “${st.testid}” được`);
        const text = String(st.text ?? ''); if (st.clear !== false) await js(`(() => { const el = document.activeElement; if (el && 'value' in el) { el.select && el.select(); } })()`);
        wc.insertText(text); await sleep(80); const i = await info(st.testid);
        if (i.value != null && !String(i.value).includes(text)) { await js(`__qa.setValue(${JSON.stringify(st.testid)}, ${JSON.stringify(text)})`); }
        return { value: (await info(st.testid)).value }; }
      case 'press': await press(st.key); await sleep(120); return { key: st.key };
      case 'select': { await need(st.testid, { timeout: to }); const r = await js(`__qa.selectOption(${JSON.stringify(st.testid)}, ${JSON.stringify(String(st.value))})`); if (!r.ok) throw new Error(r.error); return r; }
      case 'scroll': { const ok = await js(`__qa.scroll(${JSON.stringify(typeof st.target === 'number' ? st.target : String(st.target))})`); if (!ok) throw new Error(`không cuộn tới “${st.target}” được`); await sleep(150); return true; }
      case 'drag': { const a = await need(st.from, { timeout: to }); const b = await need(st.to, { timeout: to });
        if (a.draggable) { if (!(await js(`__qa.dnd(${JSON.stringify(st.from)}, ${JSON.stringify(st.to)})`))) throw new Error('kéo thả không được'); return { mode: 'html5' }; }
        wc.sendInputEvent({ type: 'mouseDown', x: Math.round(a.cx), y: Math.round(a.cy), button: 'left', clickCount: 1 }); for (let k = 1; k <= 8; k++) { wc.sendInputEvent({ type: 'mouseMove', x: Math.round(a.cx + (b.cx - a.cx) * k / 8), y: Math.round(a.cy + (b.cy - a.cy) * k / 8), modifiers: ['leftButtonDown'] }); await sleep(30); } wc.sendInputEvent({ type: 'mouseUp', x: Math.round(b.cx), y: Math.round(b.cy), button: 'left', clickCount: 1 }); return { mode: 'mouse' }; }
      case 'setFiles': { const ps = (Array.isArray(st.paths) ? st.paths : [st.paths]).map(p => path.resolve(path.dirname(args.script), String(p))); for (const p of ps) if (!fs.existsSync(p)) throw new Error('không có tệp ' + p);
        const i = await need(st.testid, { visible: false, timeout: to });
        if (i.tag === 'input' && i.type === 'file') { const dbg = wc.debugger; let attached = false; try { if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true; } const doc = await dbg.sendCommand('DOM.getDocument', {}); const q = await dbg.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `[data-testid="${st.testid}"]` }); await dbg.sendCommand('DOM.setFileInputFiles', { nodeId: q.nodeId, files: ps }); } finally { if (attached) try { dbg.detach(); } catch {} } return { files: ps, via: 'input' }; }
        openQ.push(ps); await clickAt(st); await sleep(400); return { files: ps, via: 'open-dialog' }; }
      case 'dialog': { const a = String(st.answer || 'accept'); msgQ.push(a); await js(`__qa.dialogs(${JSON.stringify(a)})`); return { queued: a }; }
      case 'wait': { if (typeof st.target === 'number') { await sleep(st.target); return true; } await need(String(st.target), { timeout: to }); return true; }
      case 'waitFor': { await need(st.testid, { timeout: st.timeout || 10000 }); return true; }
      case 'waitIdle': { const end = Date.now() + (st.timeout || 120000); await sleep(300); while (!(await js('__qa.idle()'))) { if (Date.now() > end) throw new Error('vẫn đang tạo câu trả lời sau ' + Math.round((st.timeout || 120000) / 1000) + ' giây'); await sleep(250); } return true; }
      case 'expect': { const is = st.is || {}; return expect(st.testid, { text: st.text ?? is.text, visible: st.visible ?? is.visible, count: st.count ?? is.count, timeout: to }); }
      case 'expectText': return expect(st.testid, { text: st.text, timeout: to });
      case 'expectCount': return expect(st.testid, { count: st.count, timeout: to });
      case 'expectVisible': return expect(st.testid, { visible: true, timeout: to });
      case 'expectHidden': return expect(st.testid, { visible: false, timeout: to });
      case 'readText': case 'readValue': { const i = await need(st.testid, { visible: false, timeout: to }); const v = st.do === 'readValue' ? i.value : i.text; res.reads[st.as || st.testid] = v; return { value: v }; }
      case 'screenshot': { const f = await shot(st.name || `step-${res.steps.length + 1}`); await scanI18n(st.name || 'screenshot'); return { file: f }; }
      case 'setLang': { const l = String(st.lang); if (!['vi', 'en', 'zh'].includes(l)) throw new Error('ngôn ngữ chỉ vi, en, zh'); await js(`(async () => { state.settings = await window.aivn.setSettings({ uiLang: ${JSON.stringify(l)} }); I18N.setLang(${JSON.stringify(l)}); const s = document.querySelector('#uiLangSel'); if (s) s.value = ${JSON.stringify(l)}; return true; })()`); await sleep(300); return { lang: await lang() }; }
      case 'setTheme': { const t = String(st.theme); if (!['light', 'dark', 'system'].includes(t)) throw new Error('giao diện chỉ light, dark, system'); await js(`(async () => { state.settings = await window.aivn.setSettings({ theme: ${JSON.stringify(t)} }); await applyTheme(${JSON.stringify(t)}); return true; })()`); await sleep(500); return { theme: t }; }
      case 'resize': { win.setContentSize(Math.max(320, +st.w), Math.max(320, +st.h)); await sleep(400); const [w, h] = win.getContentSize(); return { w, h }; }
      case 'seed': { if (!deps.profile) throw new Error('seed chỉ chạy với --profile (không bao giờ ghi vào dữ liệu thật)'); const f = path.resolve(path.dirname(args.script), String(st.fixture)); const fx = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\ufeff/, '')); return seed(fx); }
      case 'reset': { if (!deps.profile) throw new Error('reset chỉ chạy với --profile (không bao giờ xoá dữ liệu thật)'); return js(`(async () => { const A = window.aivn; let n = 0; for (const c of (await A.convos()) || []) { await A.deleteConvo(c.id); n++; } await A.memClear(); const sc = (await A.schedList()) || []; for (const s of (Array.isArray(sc) ? sc : sc.items || [])) await A.schedDelete(s.id); return { convos: n, schedules: (Array.isArray(sc) ? sc : sc.items || []).length }; })()`).then(async r => { wc.reload(); await new Promise(ok => wc.once('did-finish-load', ok)); await sleep(1500); return r; }); }
      case 'download': { lastSave = null; const before = Date.now(); await clickAt(st); const end = Date.now() + (st.timeout || 20000); while (Date.now() < end) { if (lastSave && fs.existsSync(lastSave) && fs.statSync(lastSave).size > 0 && fs.statSync(lastSave).mtimeMs >= before - 1000) { await sleep(300); const d = { path: lastSave, size: fs.statSync(lastSave).size, type: path.extname(lastSave).slice(1).toLowerCase() }; res.downloads.push(d); if (st.as) res.reads[st.as] = lastSave; return d; } await sleep(200); } throw new Error('không có tệp nào được lưu sau khi bấm “' + st.testid + '”'); }
      case 'clipboard': { const v = require('electron').clipboard.readText(); res.reads[st.as || 'clipboard'] = v; return { value: v }; }
      case 'setNetwork': { const m = String(st.mode); if (m === 'offline') wc.session.enableNetworkEmulation({ offline: true }); else if (m === 'online') wc.session.disableNetworkEmulation(); else throw new Error('setNetwork chỉ offline/online'); await js(`window.dispatchEvent(new Event(${JSON.stringify(m)}))`); return { mode: m, scope: 'renderer' }; }
      case 'setTime': { if (!deps.profile) throw new Error('setTime chỉ chạy với --profile (đồng hồ giả có thể làm Lịch tự động chạy việc thật)'); const t = Date.parse(String(st.time)); if (!Number.isFinite(t)) throw new Error('thời gian không hợp lệ: ' + st.time); clockOff = t - Date.now(); await js(`__qa.setClock(${clockOff})`); if (deps.setMainClock) deps.setMainClock(clockOff); return { now: new Date(Date.now() + clockOff).toISOString(), offsetMs: clockOff }; }
      case 'loadModel': { if (!deps.loadById) throw new Error('không nạp được mô hình ở đây'); const m = require('./qa-runner').resolveModel(st.id, deps.listModels()); if (!m) throw new Error(`không có mô hình “${st.id}” trên máy`); const tl = Date.now(); await deps.loadById(m.id, { reason: 'qa-ui' }); const loadMs = Date.now() - tl; const s = deps.engine.status();
        let tps = null; try { const r = await deps.engine.generate([{ role: 'user', content: 'Đếm từ 1 đến 30, cách nhau dấu phẩy.' }], { maxTokens: 64, temperature: 0 }); tps = r && r.usage ? Math.round(r.usage.tokensPerSecond * 10) / 10 : null; } catch {}
        return { id: m.id, loadMs, mode: s.mode, contextSize: s.contextSize, gpuLayers: s.gpuLayers, totalLayers: s.totalLayers, tps }; }
      case 'unloadModel': { await deps.engine.unloadModel(); if (deps.notifyModel) deps.notifyModel(); return { loaded: deps.engine.status().loaded }; }
      case 'onError': { onError = st.mode === 'continue' ? 'continue' : 'stop'; return { mode: onError }; }
    }
    throw new Error('bước chưa hỗ trợ: ' + st.do);
  }
  // “/biểu thức/cờ” (cờ hợp lệ gimsuy) = biểu thức chính quy; còn lại (kể cả đường dẫn /tmp/…) = chuỗi con
  function matchText(have, want) { const m = /^\/(.+)\/([gimsuy]*)$/s.exec(String(want)); return m ? new RegExp(m[1], m[2]).test(String(have)) : String(have).includes(String(want)); }
  async function expect(id, { text, visible, count, timeout = 10000 }) {
    const end = Date.now() + timeout; let i, why;
    while (true) {
      i = await info(id); why = null;
      if (count != null && i.count !== Number(count)) why = `cần ${count} phần tử “${id}”, có ${i.count}`;
      else if (visible === true && !i.isVisible) why = i.count ? `“${id}” không hiện` : `không thấy “${id}”`;
      else if (visible === false && i.count && i.isVisible) why = `“${id}” vẫn đang hiện`;
      else if (text != null && !(i.count && matchText(i.text, text))) why = `“${id}” có chữ “${String(i.text || '').slice(0, 160)}”, cần “${text}”`;
      if (!why) return { count: i.count, text: (i.text || '').slice(0, 300) };
      if (Date.now() > end) throw new Error(why); await sleep(150);
    }
  }
  async function seed(fx) {
    const r = await js(`(async (fx) => { const A = window.aivn; const out = {};
      if (fx.settings) { state.settings = await A.setSettings(fx.settings); out.settings = Object.keys(fx.settings).length; }
      if (Array.isArray(fx.convos)) { for (const c of fx.convos) await A.saveConvo({ id: c.id || ('qa' + Math.random().toString(36).slice(2, 9)), title: c.title || 'QA', mode: c.mode || 'chat', createdAt: c.createdAt || Date.now(), updatedAt: Date.now(), messages: c.messages || [] }); out.convos = fx.convos.length; }
      if (Array.isArray(fx.memories)) { for (const m of fx.memories) await A.memAdd(typeof m === 'string' ? m : m.text); out.memories = fx.memories.length; }
      if (Array.isArray(fx.schedules)) { for (const s of fx.schedules) await A.schedCreate(s); out.schedules = fx.schedules.length; }
      if (Array.isArray(fx.biz)) { let n = 0; for (const c of fx.biz) { const x = await A.crm(c.fn, ...(c.args || [])); if (!x || !x.ok) throw new Error('seed biz ' + c.fn + ': ' + (x && x.error)); n++; } out.biz = n; }
      return out; })(${JSON.stringify(fx)})`);
    wc.reload(); await new Promise(ok => wc.once('did-finish-load', ok)); await sleep(1500); return r;
  }
}
// đồng hồ giả của tiến trình chính (Lịch tự động/nhắc việc đọc Date.now()) — chỉ dùng trong hồ sơ QA riêng
const RealDate = Date; let mainOff = 0;
function setMainClock(ms) {
  mainOff = Number(ms) || 0;
  if (!mainOff) { global.Date = RealDate; return; }
  if (global.Date === RealDate) global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + mainOff); } static now() { return RealDate.now() + mainOff; } };
}
// hộp thoại hệ điều hành trong phiên QA giao diện: thay tạm, trả hàm khôi phục
function hookDialogs(dialog, h) {
  const keep = {}; const wrap = (k, fn) => { keep[k] = dialog[k]; dialog[k] = fn; };
  const opt = (a, b) => (b === undefined ? a : b);
  wrap('showOpenDialog', async (a, b) => h.open(opt(a, b))); wrap('showOpenDialogSync', (a, b) => { const r = h.open(opt(a, b)); return r.canceled ? undefined : r.filePaths; });
  wrap('showSaveDialog', async (a, b) => h.save(opt(a, b))); wrap('showSaveDialogSync', (a, b) => h.save(opt(a, b)).filePath);
  wrap('showMessageBox', async (a, b) => h.message(opt(a, b))); wrap('showMessageBoxSync', (a, b) => h.message(opt(a, b)).response);
  wrap('showErrorBox', (t, c) => { h.message({ title: t, message: c, buttons: ['OK'] }); });
  return { restore: () => Object.assign(dialog, keep) };
}
module.exports = { setMainClock, hookDialogs, validate, normStep, run, i18nIssues, ACTIONS, PAGES, DRIVER };
