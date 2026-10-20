// "Lịch tự động": nhắc việc và việc định kỳ (một lần / hằng ngày / hằng tuần) chạy khi AIVN đang mở (kể cả khi thu xuống khay).
// Lưu ở userData/schedules.json. Lần chạy bị lỡ (máy tắt/ngủ) trong vòng 6 giờ sẽ được chạy bù, đánh dấu "trễ".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LATE_MS = 6 * 3600e3;
const DAY_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const pad = (n) => String(n).padStart(2, '0');
const parseTime = (t) => { const m = String(t || '').match(/^(\d{1,2})[:hg](\d{2})?$/i); if (!m) return null; const h = +m[1], mi = +(m[2] || 0); return h < 24 && mi < 60 ? [h, mi] : null; };

function nextRunOf(t, from = Date.now()) {
  if (!t.enabled) return null;
  if (t.repeat === 'once') return t.at && (!t.lastRun || t.lastRun < t.at) ? t.at : null;
  const hm = parseTime(t.time); if (!hm) return null;
  const days = t.repeat === 'weekly' ? (Array.isArray(t.days) && t.days.length ? t.days : [new Date(t.createdAt || from).getDay()]) : [0, 1, 2, 3, 4, 5, 6];
  const d = new Date(from);
  for (let i = 0; i < 8; i++) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, hm[0], hm[1], 0, 0);
    if (c.getTime() > from && days.includes(c.getDay())) return c.getTime();
  }
  return null;
}
function describe(t) {
  if (t.repeat === 'once') { const d = new Date(t.at); return `Một lần · ${pad(d.getHours())}:${pad(d.getMinutes())} ngày ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; }
  if (t.repeat === 'daily') return `Hằng ngày · ${t.time}`;
  return `Hằng tuần · ${(t.days || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(x => DAY_VI[x]).join(', ')} · ${t.time}`;
}

function validate(spec, old = {}) {
  const t = { ...old };
  t.title = String(spec.title ?? old.title ?? '').trim().slice(0, 120);
  if (!t.title) throw new Error('Hãy đặt tên cho việc cần nhắc');
  t.kind = spec.kind === 'agent' ? 'agent' : 'reminder';
  t.message = String(spec.message ?? old.message ?? '').trim().slice(0, 1000);
  t.prompt = String(spec.prompt ?? old.prompt ?? '').trim().slice(0, 4000);
  if (t.kind === 'agent' && !t.prompt) throw new Error('Việc tự động cần có yêu cầu cho Trợ lý');
  t.repeat = ['once', 'daily', 'weekly'].includes(spec.repeat) ? spec.repeat : 'once';
  if (t.repeat === 'once') {
    const at = typeof spec.at === 'number' ? spec.at : Date.parse(spec.at);
    if (!Number.isFinite(at)) throw new Error('Thời điểm nhắc không hợp lệ');
    if (at < Date.now() - 60e3 && !old.id) throw new Error('Thời điểm nhắc đã qua');
    t.at = at; t.time = `${pad(new Date(at).getHours())}:${pad(new Date(at).getMinutes())}`;
  } else {
    if (!parseTime(spec.time)) throw new Error('Giờ phải có dạng HH:MM (vd. 07:30)');
    const hm = parseTime(spec.time); t.time = `${pad(hm[0])}:${pad(hm[1])}`;
    t.days = t.repeat === 'weekly' ? [...new Set((spec.days || []).map(Number).filter(x => x >= 0 && x <= 6))] : undefined;
    if (t.repeat === 'weekly' && !t.days.length) throw new Error('Hãy chọn ít nhất một ngày trong tuần');
    delete t.at;
  }
  t.enabled = spec.enabled !== false;
  t.notify = spec.notify !== false;
  return t;
}

function createScheduler({ file, onFire, log = () => {} }) {
  let data = { tasks: [] };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j.tasks)) data = j; } catch {}
  let timer = null, running = new Set();
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1)); fs.renameSync(tmp, file); };
  const pub = (t) => ({ ...t, nextRun: nextRunOf(t), schedule: describe(t), running: running.has(t.id) });

  function list() { return data.tasks.map(pub).sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity)); }
  function create(spec) { const t = validate(spec); t.id = 'job_' + crypto.randomBytes(6).toString('hex'); t.createdAt = Date.now(); t.runs = []; data.tasks.push(t); save(); arm(); return pub(t); }
  function update(id, spec) { const i = data.tasks.findIndex(x => x.id === id); if (i < 0) throw new Error('Không tìm thấy lịch'); const t = validate({ ...data.tasks[i], ...spec }, data.tasks[i]); if (spec.at || spec.time || spec.repeat) t.lastRun = t.repeat === 'once' ? null : t.lastRun; data.tasks[i] = t; save(); arm(); return pub(t); }
  function remove(id) { const n = data.tasks.length; data.tasks = data.tasks.filter(x => x.id !== id); save(); arm(); return n !== data.tasks.length; }
  function get(id) { const t = data.tasks.find(x => x.id === id); return t ? pub(t) : null; }

  async function fire(t, { late = false, manual = false } = {}) {
    if (running.has(t.id)) return;
    running.add(t.id);
    const at = Date.now();
    if (!manual) { t.lastRun = at; if (t.repeat === 'once') t.enabled = false; save(); }
    log(`[lịch] chạy "${t.title}"${late ? ' (trễ)' : ''}`);
    let rec = { at, late, manual, ok: true };
    try { const r = await onFire(pub(t), { late, manual }); rec = { ...rec, ...(r || {}) }; }
    catch (e) { rec = { ...rec, ok: false, error: String(e && e.message || e).slice(0, 300) }; }
    finally {
      running.delete(t.id);
      const cur = data.tasks.find(x => x.id === t.id);
      if (cur) { cur.runs = [rec, ...(cur.runs || [])].slice(0, 10); if (manual) cur.lastManual = at; save(); }
      arm();
    }
    return rec;
  }
  function tick() {
    const now = Date.now();
    for (const t of data.tasks) {
      if (!t.enabled || running.has(t.id)) continue;
      const due = t.repeat === 'once' ? t.at : t.pendingAt;
      if (due && due <= now) {
        if (now - due > LATE_MS) { if (t.repeat === 'once') { t.enabled = false; t.missed = due; } t.pendingAt = nextRunOf(t, now); save(); continue; }
        if (t.repeat !== 'once') t.pendingAt = nextRunOf(t, now + 1000);
        fire(t, { late: now - due > 90e3 });
      } else if (t.repeat !== 'once' && !t.pendingAt) { t.pendingAt = nextRunOf(t, now); save(); }
    }
  }
  function arm() {
    clearTimeout(timer);
    const now = Date.now();
    const nexts = data.tasks.filter(t => t.enabled).map(t => t.repeat === 'once' ? t.at : (t.pendingAt || nextRunOf(t, now))).filter(Boolean);
    const wait = nexts.length ? Math.max(200, Math.min(60e3, Math.min(...nexts) - now)) : 60e3; // xem lại tối đa mỗi phút (đổi giờ hệ thống, máy ngủ dậy)
    timer = setTimeout(() => { tick(); arm(); }, wait);
    timer.unref?.();
  }
  function start() {
    // lịch định kỳ: lần chạy dự kiến được ghi lại để phát hiện lần bị lỡ khi mở lại ứng dụng
    for (const t of data.tasks) if (t.repeat !== 'once' && t.enabled && !t.pendingAt) t.pendingAt = nextRunOf(t);
    save(); tick(); arm();
  }
  const runNow = (id) => { const t = data.tasks.find(x => x.id === id); if (!t) throw new Error('Không tìm thấy lịch'); return fire(t, { manual: true }); };
  return { list, create, update, remove, get, start, stop: () => clearTimeout(timer), runNow, describe };
}

module.exports = { createScheduler, nextRunOf, describe, parseTime, DAY_VI };
