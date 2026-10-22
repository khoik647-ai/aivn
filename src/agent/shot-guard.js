'use strict';
// B193 (QA beta.3, máy bàn): ảnh chụp các bước AIVN AGENT chụp cả tệp mã kích hoạt đang mở trong Notepad rồi ghi nguyên ảnh ra thư mục shots.
// Ở đây: nhận biết nội dung nhạy cảm (tiêu đề / tiến trình / chữ trên cửa sổ), che chuỗi trông như khoá trong chữ hiển thị,
// chỉ chụp cửa sổ đích, ảnh nhạy cảm thì CHỈ ghi ảnh đã che (không còn điểm ảnh nào của ảnh gốc), và dọn ảnh cũ an toàn.
// KHÔNG BAO GIỜ ghi/đưa ra giá trị của khoá: kết quả quét chỉ có TÊN loại (vd. 'text:aivn-code'), không có chữ đã thấy.
const fs = require('fs');
const path = require('path');

const MASK = '[đã che]';
const WARN = 'đã ẩn ảnh chụp: màn hình có thể chứa mã kích hoạt, mật khẩu hoặc khoá';
// tiêu đề / tên tiến trình: từ khoá (có dấu, để “khoa học” không bị tính)
const TITLE_RE = [
  ['key', /khoá|khóa|\bkey(?:s|file|store|chain)?\b|\.pem\b|\.key\b|\.p12\b|\.pfx\b|id_rsa|id_ed25519|密钥|钥匙/i],
  ['activation', /kích hoạt|activat|licen[cs]e|serial|product key|激活|许可证|授权/i],
  ['password', /mật khẩu|password|passwd|\bpwd\b|keepass|bitwarden|1password|密码/i],
  ['env', /(?:^|[\s\\/"“])\.env\b|\.env\.|credential|secret|bí mật|凭据|机密/i],
  ['token', /token|mã truy cập|令牌/i],
];
// chữ hiện trên cửa sổ: chuỗi trông như khoá + cụm từ rõ nghĩa
const SECRET_RE = [
  ['aivn-code', /\b(?:[0-9A-Z]{5}-){5,}[0-9A-Z]{1,5}\b/g], // mã kích hoạt AIVN: base32 nhóm 5 ký tự (src/license.js)
  ['sk', /\bsk-[A-Za-z0-9_-]{16,}/g],
  ['github', /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['hex', /\b[0-9a-fA-F]{32,}\b/g],
  ['base64', /(?<![A-Za-z0-9+/=_-])(?=[A-Za-z0-9+_-]*[0-9])(?=[A-Za-z0-9+_-]*[a-z])(?=[A-Za-z0-9+_-]*[A-Z])[A-Za-z0-9+_-]{40,}={0,2}(?![A-Za-z0-9+/=_-])/g], // không có '/': đường dẫn tệp không bị tính
];
const TEXT_RE = [
  ['activation', /mã kích hoạt|activation code|license key|licence key|product key|激活码|许可证密钥/i],
  ['password', /mật khẩu\s*[:=]|password\s*[:=]|passwd\s*[:=]|密码\s*[:：]/i],
  ['env', /^\s*[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=/m],
];
// quét: trả về danh sách TÊN loại (không có giá trị). Trống = không thấy gì.
function scan({ title = '', proc = '', text = '' } = {}) {
  const out = new Set(); const t = String(title || '') + ' ' + String(proc || ''); const x = String(text || '');
  for (const [k, re] of TITLE_RE) if (re.test(t)) out.add('title:' + k);
  for (const [k, re] of SECRET_RE) { re.lastIndex = 0; if (re.test(t)) out.add('title:' + k); re.lastIndex = 0; if (re.test(x)) out.add('text:' + k); re.lastIndex = 0; }
  for (const [k, re] of TEXT_RE) if (re.test(x)) out.add('text:' + k);
  return [...out];
}
// che chuỗi trông như khoá (giữ phần chữ còn lại để vẫn đọc được bước đã làm gì)
function redactSecrets(s) {
  if (typeof s !== 'string' || !s) return s;
  let o = s; for (const [, re] of SECRET_RE) { re.lastIndex = 0; o = o.replace(re, MASK); }
  return o;
}
// log: che tiêu đề cửa sổ (“…” / "…" ngay sau “cửa sổ”, “Quan sát:”, “window”, “tiêu đề”) và mọi chuỗi trông như khoá
const TITLE_CTX = /((?:cửa sổ|Cửa sổ|Quan sát:|window|Window|tiêu đề|title)\s*)(“[^”\n]*”|"[^"\n]*")/g;
function redactTitles(s, titles = []) {
  if (typeof s !== 'string' || !s) return s;
  let o = s.replace(TITLE_CTX, (_, a, q) => a + (q[0] === '“' ? '“' + MASK + '”' : '"' + MASK + '"'));
  for (const t of titles) if (t && String(t).length >= 3) o = o.split(String(t)).join(MASK);
  return redactSecrets(o);
}
// thẻ bước trong app (agent.js): bước có chữ/cửa sổ nhạy cảm → bỏ ảnh nhỏ (khỏi lưu vào cuộc trò chuyện), cảnh báo trên thanh bước,
// che chuỗi trông như khoá trong phần “Kết quả” hiển thị (mô hình vẫn nhận nguyên kết quả qua forModel)
function guardStep(step, out, { warn = () => WARN } = {}) {
  if (!step || !out) return step;
  const w = out.window && typeof out.window === 'object' ? out.window : null;
  if (w && (w.hwnd != null || w.title)) step.win = { hwnd: w.hwnd ?? null, pid: w.pid ?? null, proc: w.proc || null, title: w.title || '', b: Array.isArray(w.b) ? w.b : undefined };
  const hits = scan({ title: w ? w.title : '', proc: w ? w.proc : '', text: [out.forModel, out.summary, out.detail].filter(x => typeof x === 'string').join('\n') });
  if (hits.length) {
    step.sensitive = hits; step.thumb = undefined;
    step.summary = (step.summary ? String(step.summary) + ' · ' : '') + '⚠ ' + warn();
  }
  if (typeof step.detail === 'string') step.detail = redactSecrets(step.detail);
  if (typeof step.summary === 'string') step.summary = redactSecrets(step.summary);
  return step;
}
// vùng cửa sổ (toạ độ vật lý [x,y,w,h]) → khung trong ảnh chụp (ảnh đã thu về ≤ maxW)
function rectInShot(b, c) {
  if (!Array.isArray(b) || b.length < 4 || !(b[2] > 20 && b[3] > 20) || !c || !c.geo || !c.geo.phys || !(c.width > 0)) return null;
  const P = c.geo.phys; const k = c.width / Math.max(1, P.width); const H = c.height || Math.round(P.height * k);
  const x0 = Math.max(0, Math.round((b[0] - P.x) * k)), y0 = Math.max(0, Math.round((b[1] - P.y) * k));
  const x1 = Math.min(c.width, Math.round((b[0] + b[2] - P.x) * k)), y1 = Math.min(H, Math.round((b[1] + b[3] - P.y) * k));
  return x1 - x0 > 8 && y1 - y0 > 8 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
// ảnh: Electron nativeImage (tiến trình chính); kiểm thử truyền bộ giả cùng giao diện
function electronImage() {
  let N = null; try { const e = require('electron'); N = e && typeof e === 'object' ? e.nativeImage : null; } catch {}
  if (!N) return null;
  return {
    decode: (dataUrl) => N.createFromDataURL(dataUrl),
    crop: (img, r) => img.crop(r),
    size: (img) => img.getSize(),
    // ảnh che: tạo MỚI từ điểm ảnh xám, không lấy gì từ ảnh gốc
    blank: (w, h) => N.createFromBitmap(Buffer.alloc(Math.max(1, w) * Math.max(1, h) * 4, 0x80), { width: Math.max(1, w), height: Math.max(1, h) }),
    jpeg: (img) => img.toJPEG(80),
  };
}
// chụp một bước: trả { buf | null, scope, rect, redacted, reasons, skipped }
async function shot({ capture, target = null, reasons = [], image = undefined, maxW = 1920 }) {
  const I = image === undefined ? electronImage() : image;
  const c = await capture({ maxW });
  const rect = target && target.b ? rectInShot(target.b, c) : null;
  const meta = { scope: rect ? 'window' : 'screen', rect: rect || null, redacted: false, reasons: [...reasons] };
  if (!I) { // không xử lý ảnh được: ảnh nhạy cảm thì KHÔNG ghi gì; còn lại ghi ảnh toàn màn hình như trước
    if (reasons.length) return { ...meta, buf: null, skipped: 'sensitive-no-image' };
    return { ...meta, scope: 'screen', rect: null, buf: Buffer.from(String(c.dataUrl).split(',')[1] || '', 'base64') };
  }
  let img = I.decode(c.dataUrl); if (rect) img = I.crop(img, rect);
  const z = I.size(img);
  if (reasons.length) { img = null; return { ...meta, redacted: true, buf: I.jpeg(I.blank(z.width, z.height)) }; }
  return { ...meta, buf: I.jpeg(img) };
}
// dọn ảnh cũ: chỉ tệp step-*.jpg ngay trong thư mục shots (realpath), bỏ qua symlink / thư mục / tên có '..', không bao giờ xoá thư mục
const SHOT_NAME = /^step-\d{2,}-[\w-]+\.jpg$/;
function isRootish(p) { const r = path.parse(p).root; let home = ''; try { home = fs.realpathSync(require('os').homedir()); } catch {} return p === r || p === home || p.split(path.sep).filter(Boolean).length < 2; }
function prune(dir, { maxAgeMs = 24 * 3600e3, maxBytes = 200 * 1024 * 1024, now = Date.now(), log = null } = {}) {
  const res = { removed: 0, kept: 0, skipped: 0 };
  let real; try { real = fs.realpathSync(dir); } catch { return res; }
  if (isRootish(real)) { res.refused = true; return res; }
  let names = []; try { names = fs.readdirSync(real); } catch { return res; }
  const files = [];
  for (const n of names) {
    if (!SHOT_NAME.test(n) || n.includes('..') || n.includes('/') || n.includes('\\')) { res.skipped++; continue; }
    const p = path.join(real, n); let st; try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink() || !st.isFile()) { res.skipped++; continue; }
    let rp; try { rp = fs.realpathSync(p); } catch { continue; }
    if (path.dirname(rp) !== real) { res.skipped++; continue; }
    files.push({ p: rp, t: st.mtimeMs, size: st.size });
  }
  const del = (f) => { try { fs.unlinkSync(f.p); res.removed++; return true; } catch (e) { log && log(`B193: không xoá được ảnh cũ ${path.basename(f.p)}: ${e.code || e.message}`); return false; } };
  const left = [];
  for (const f of files) { if (now - f.t > maxAgeMs) del(f); else left.push(f); }
  left.sort((a, b) => a.t - b.t); let total = left.reduce((s, f) => s + f.size, 0);
  while (left.length && total > maxBytes) { const f = left.shift(); if (del(f)) total -= f.size; }
  res.kept = left.length; return res;
}
module.exports = { scan, redactSecrets, redactTitles, guardStep, rectInShot, shot, prune, electronImage, WARN, MASK, SHOT_NAME };
