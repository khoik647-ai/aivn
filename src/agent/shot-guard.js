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
  ['key', /khoá|khóa|\bkey(?:s|file|store|chain)?\b|\.pem\b|\.key\b|\.p12\b|\.pfx\b|id_rsa|id_ed25519|aivn-admin-key|admin-issued|密钥|钥匙/i],
  // “LICENSE” một mình (tệp giấy phép nguồn mở) không phải mã kích hoạt; license.json / license key thì có
  ['activation', /kích[\s_-]*hoạt|kich[\s_-]*hoat|activat|licen[cs]e\.(?:json|txt|key|lic)|(?:license|licence)\s*(?:key|code)|serial|product key|激活|许可证|授权/i],
  ['password', /mật khẩu|password|passwd|\bpwd\b|keepass|bitwarden|1password|密码/i],
  ['env', /(?:^|[\s\\/"“])\.env\b|\.env\.|credential|secret|bí mật|凭据|机密/i],
  ['token', /token|mã truy cập|令牌/i],
];
// chữ hiện trên cửa sổ: chuỗi trông như khoá + cụm từ rõ nghĩa
// chuỗi nhiều đoạn ngắn nối bằng - / _ (vd. Bao-cao-cuoi-ky-2026) là tên tệp/slug, không phải khoá
const wordy = (m) => { const p = m.split(/[-_]+/).filter(Boolean); return p.length >= 3 && p.every(x => x.length <= 12); };
const SECRET_RE = [
  ['sk', /\bsk-[A-Za-z0-9_-]{16,}/g],
  ['github', /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  // (?<![A-Za-z0-9_-]) thay cho \b: "eyJ-" lặp lại không còn là điểm bắt đầu mới (tránh quay lui bậc hai). Mỗi đoạn có trần.
  ['jwt', /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,2000}/g],
  // "commit <sha>" là mã git, không phải khoá. Chuỗi hex trần ≥32 ký tự vẫn tính.
  ['hex', /(?<!commit )\b[0-9a-fA-F]{32,}\b/g],
  ['base64', /(?<![A-Za-z0-9+/=_-])(?=[A-Za-z0-9+_-]*[0-9])(?=[A-Za-z0-9+_-]*[a-z])(?=[A-Za-z0-9+_-]*[A-Z])[A-Za-z0-9+_-]{40,}={0,2}(?![A-Za-z0-9+/=_-])/g, wordy], // không có '/': đường dẫn tệp không bị tính; tên tệp kiểu chữ-nối-gạch cũng không
];
const TEXT_RE = [
  ['activation', /mã kích hoạt|activation code|license key|licence key|product key|激活码|许可证密钥/i],
  ['password', /mật khẩu\s*[:=]|password\s*[:=]|passwd\s*[:=]|密码\s*[:：]/i],
  ['env', /^\s*[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=/m],
];
// quét: trả về danh sách TÊN loại (không có giá trị). Trống = không thấy gì.
const REASON_OK = /^(?:title|text|window):[a-z0-9-]{1,40}$/;
const reasonList = (xs) => (Array.isArray(xs) ? xs : []).filter(x => typeof x === 'string' && REASON_OK.test(x));
const hit = (re, s, skip) => { re.lastIndex = 0; let m; while ((m = re.exec(s))) { if (!skip || !skip(m[0])) { re.lastIndex = 0; return true; } if (!m[0]) re.lastIndex++; } re.lastIndex = 0; return false; };
// cửa sổ thu nhỏ / ẩn không nằm trên ảnh chụp
const onScreen = (w) => !!w && w.min !== true && w.minimized !== true && w.visible !== false;
// Mã kích hoạt (license.issueCode): Crockford base32, nhóm 6. Trước khi khớp: NFKC (chữ/số/gạch toàn chiều rộng),
// bỏ ký tự định dạng (\p{Cf}, gồm ZWSP/ZWJ) và soft hyphen, chữ Kirin trông giống Latin → Latin, O/0 I/1 L/1.
// Một dấu câu bất kỳ là dấu phân cách nhóm. Khoảng trắng chỉ nối khi có chữ số (mã thật) hoặc đoạn rất dài —
// menu tiếng Anh mỗi mục một dòng không bị ghép thành mã. Khớp ≥5 nhóm (5–6) hoặc ≥70 ký tự.
const CYR_LAT = new Map([
  [0x0410, 65], [0x0430, 65], [0x0412, 66], [0x0432, 66], [0x0415, 69], [0x0435, 69], [0x041A, 75], [0x043A, 75], [0x041C, 77], [0x043C, 77], [0x041D, 72], [0x043D, 72], [0x0420, 80], [0x0440, 80], [0x0421, 67], [0x0441, 67], [0x0422, 84], [0x0442, 84], [0x0425, 88], [0x0445, 88],
  // Hy Lạp trông như Latin (hoa + thường): Αα Ββ Εε Ζζ Ηη Κκ Μμ Νν Ρρ Ττ Χχ
  [0x0391, 65], [0x03B1, 65], [0x0392, 66], [0x03B2, 66], [0x0395, 69], [0x03B5, 69], [0x0396, 90], [0x03B6, 90], [0x0397, 72], [0x03B7, 72], [0x039A, 75], [0x03BA, 75], [0x039C, 77], [0x03BC, 77], [0x039D, 78], [0x03BD, 78], [0x03A1, 80], [0x03C1, 80], [0x03A4, 84], [0x03C4, 84], [0x03A7, 88], [0x03C7, 88],
]);
const ASCII_P = new Uint8Array(128);
for (const c of '!"#%&\'()*,-./:;?@[\\]_{}') ASCII_P[c.charCodeAt(0)] = 1;
function isFormatCp(cp) {
  if (cp < 0x7F) return false;
  if (cp === 0x00AD || cp === 0xFEFF) return true;
  if (cp >= 0x200B && cp <= 0x200F) return true;
  if (cp >= 0x202A && cp <= 0x202E) return true;
  if (cp >= 0x2060 && cp <= 0x2064) return true;
  if (cp >= 0x2066 && cp <= 0x206F) return true;
  if ((cp >= 0x00C0 && cp <= 0x024F) || (cp >= 0x1E00 && cp <= 0x1EFF) || (cp >= 0x0400 && cp <= 0x04FF)) return false;
  return /^\p{Cf}$/u.test(String.fromCodePoint(cp));
}
function isWsCp(cp) {
  return cp === 9 || cp === 10 || cp === 11 || cp === 12 || cp === 13 || cp === 32 || cp === 0xA0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200A) || cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F || cp === 0x3000;
}
function isPunctCp(cp) {
  if (cp < 128) return ASCII_P[cp] === 1;
  if ((cp >= 0x00C0 && cp <= 0x024F) || (cp >= 0x1E00 && cp <= 0x1EFF) || (cp >= 0x0400 && cp <= 0x04FF)) return false;
  return /^\p{P}$/u.test(String.fromCodePoint(cp));
}
function isCrockCp(cp) {
  return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 72) || cp === 74 || cp === 75 || cp === 77 || cp === 78 || (cp >= 80 && cp <= 84) || (cp >= 86 && cp <= 90);
}
// một ký tự đã gấp (NFKC / Kirin / hoa / O,I,L) → loại để duyệt
function classifyCp(cp, depth) {
  let f = cp;
  if (f >= 0xFF01 && f <= 0xFF5E) f -= 0xFEE0;
  const cyr = CYR_LAT.get(f); if (cyr) f = cyr;
  if (f >= 97 && f <= 122) f -= 32;
  const oil = f === 79 || f === 73 || f === 76;
  if (f === 79) f = 48; else if (f === 73 || f === 76) f = 49;
  if (isCrockCp(f)) {
    // O/I/L đếm là chữ: từ menu (“Insert”, “Format”) không được coi là có chữ số rồi nối qua xuống dòng.
    const realDigit = !oil && !cyr && f >= 48 && f <= 57;
    return { kind: 'crock', digit: realDigit, letter: !realDigit };
  }
  if (isWsCp(cp) || isWsCp(f)) return { kind: 'ws' };
  if (isPunctCp(cp) || isPunctCp(f)) return { kind: 'punct' };
  if (!depth && cp > 0x7F && !(cp >= 0x0400 && cp <= 0x04FF) && !((cp >= 0x00C0 && cp <= 0x024F) || (cp >= 0x1E00 && cp <= 0x1EFF))) {
    const n = String.fromCodePoint(cp).normalize('NFKC');
    if (n !== String.fromCodePoint(cp)) {
      let all = true, digit = false, letter = false;
      for (const ch of n) { const c = classifyCp(ch.codePointAt(0), 1); if (c.kind !== 'crock') { all = false; break; } if (c.digit) digit = true; if (c.letter) letter = true; }
      if (all && n.length) return { kind: 'crock', digit, letter };
    }
  }
  return { kind: 'break' };
}
// các đoạn [start, end) trong chuỗi gốc trông như mã kích hoạt (đã gồm dấu phân cách và chỗ ngắt dòng)
function codeSpans(s) {
  if (typeof s !== 'string' || !s) return [];
  const spans = []; const n = s.length;
  const unit = (p) => {
    while (p < n) {
      const cp = s.codePointAt(p); const w = cp > 0xFFFF ? 2 : 1;
      if (isFormatCp(cp)) { p += w; continue; }
      return { p, w, ...classifyCp(cp, 0) };
    }
    return null;
  };
  let i = 0;
  while (i < n) {
    const u0 = unit(i);
    if (!u0) break;
    if (u0.kind !== 'crock') { i = u0.p + u0.w; continue; }
    const start = u0.p; let chars = 0; let letters = 0; let digits = 0; const pieces = []; let cur = 0;
    let p = u0.p;
    while (p < n) {
      const u = unit(p); if (!u || u.kind !== 'crock') break;
      cur++; chars++; if (u.letter) letters++; if (u.digit) digits++;
      p = u.p + u.w;
    }
    let end = p;
    while (p < n) {
      let q = p; let punct = false; let ws = false; let saw = false;
      while (q < n) {
        const u = unit(q); if (!u) break;
        if (u.kind === 'ws') { ws = true; saw = true; q = u.p + u.w; continue; }
        if (u.kind === 'punct') { punct = true; saw = true; q = u.p + u.w; continue; }
        break;
      }
      if (!saw) break;
      const nxt = unit(q);
      if (!nxt || nxt.kind !== 'crock') break;
      let t = nxt.p; let nextLen = 0; let nextDigit = false;
      while (t < n) {
        const u = unit(t); if (!u || u.kind !== 'crock') break;
        nextLen++; if (u.digit) nextDigit = true; t = u.p + u.w;
      }
      const incomplete = !punct && cur > 0 && cur < 5 && nextLen > 0 && nextLen < 5 && cur + nextLen <= 6;
      const digitish = digits > 0 || nextDigit;
      const codeSoFar = digits > 0 && chars >= 12;
      // Dấu câu nối nhóm mã. Đoạn ngắn phía trước (“hoạt:”) không được kéo cả mã vào một span rồi làm hỏng luật nhóm.
      const bridgePunct = punct && (cur >= 5 || nextLen < 5 || codeSoFar);
      const bridgeWs = ws && nextLen >= 5 && (digitish || cur >= 20 || nextLen >= 20) && (cur >= 5 || codeSoFar);
      const bridge = bridgePunct || incomplete || bridgeWs;
      if (!bridge) break;
      if (!incomplete) { pieces.push(cur); cur = 0; }
      p = nxt.p;
      while (p < n) {
        const u = unit(p); if (!u || u.kind !== 'crock') break;
        cur++; chars++; if (u.letter) letters++; if (u.digit) digits++;
        p = u.p + u.w;
      }
      end = p;
    }
    if (cur) pieces.push(cur);
    const grouped = pieces.length >= 5 && pieces.every(g => g >= 5 && g <= 6);
    if ((chars >= 70 && letters >= 8) || grouped) spans.push([start, end]);
    i = end > start ? end : start + 1;
  }
  return spans;
}
function hasCode(s) { return typeof s === 'string' && s && codeSpans(s).length > 0; }
function redactCodes(s) {
  const spans = codeSpans(s); if (!spans.length) return s;
  let o = s; for (let i = spans.length - 1; i >= 0; i--) o = o.slice(0, spans[i][0]) + MASK + o.slice(spans[i][1]);
  return o;
}
function scan({ title = '', proc = '', text = '' } = {}) {
  const out = new Set(); const t = String(title || '') + ' ' + String(proc || ''); const x = String(text || '');
  for (const [k, re] of TITLE_RE) if (re.test(t)) out.add('title:' + k);
  if (hasCode(t)) out.add('title:aivn-code'); if (hasCode(x)) out.add('text:aivn-code');
  for (const [k, re, skip] of SECRET_RE) { if (hit(re, t, skip)) out.add('title:' + k); if (hit(re, x, skip)) out.add('text:' + k); }
  for (const [k, re] of TEXT_RE) if (re.test(x)) out.add('text:' + k);
  return [...out];
}
// Cả màn hình: chữ/tiêu đề cửa sổ đích, chữ OCR của cả ảnh, và NỘI DUNG (không chỉ tiêu đề) của mọi cửa sổ đang hiện.
// titles chỉ để che log; không đưa vào tệp kết quả.
function screenSecrets({ title = '', proc = '', text = '', windows = [] } = {}) {
  const reasons = new Set(scan({ title, proc })); const titles = []; const chunks = []; const unread = [];
  if (text) chunks.push(String(text));
  for (const w of Array.isArray(windows) ? windows : []) {
    if (!onScreen(w)) continue;
    if (w.unread) unread.push(w);
    const wt = String(w.title || ''); const wp = String(w.proc || '');
    const ownTitle = wt || wp ? scan({ title: wt, proc: wp }) : [];
    for (const x of ownTitle) reasons.add(x);
    const body = [w.text, w.body, w.ocr].filter(x => typeof x === 'string' && x).join('\n');
    if ((ownTitle.length || (body && scan({ text: body }).length)) && wt) titles.push(wt);
    if (body) chunks.push(body);
  }
  // Nối chữ mọi cửa sổ: mã bị chia (4 nhóm + 4 nhóm) vẫn thành một chuỗi. Mỗi cửa sổ một mình thì 4 nhóm chưa đủ.
  const joined = chunks.filter(Boolean).join('\n');
  if (joined) for (const x of scan({ text: joined })) if (String(x).startsWith('text:')) reasons.add(x);
  return { reasons: [...reasons], titles, failed: false, unread };
}
// Đọc chữ từng cửa sổ đang hiện (UIA). Lỗi hoặc quá hạn của BẤT KỲ cửa sổ nào → ném lỗi (người gọi coi ảnh là không an toàn).
async function fillWindowText(wins, read, { timeoutMs = 8000 } = {}) {
  const out = [];
  for (const w of Array.isArray(wins) ? wins : []) {
    if (!onScreen(w) || typeof w.text === 'string' || typeof read !== 'function') { out.push(w); continue; }
    let timer;
    const job = Promise.resolve().then(() => read(w)).then(v => ({ ok: true, v }), () => ({ ok: false }));
    const textR = await Promise.race([
      job,
      new Promise(res => { timer = setTimeout(() => res({ ok: false }), timeoutMs); }),
    ]);
    if (timer) clearTimeout(timer);
    if (!textR || !textR.ok) throw new Error('window-text');
    const got = uiaRead(textR.v);
    if (got && typeof got === 'object' && got.unread) { out.push({ ...w, unread: true }); continue; }
    out.push({ ...w, text: String(got) });
  }
  return out;
}
// Nút, mục menu, thanh tiêu đề và khung cửa sổ không phải nội dung đã đọc.
const SKIP_ROLE = /^(window|pane|titlebar|menubar|menu|menuitem|button|splitbutton|scrollbar|thumb|separator|grip|tooltip|toolbar|statusbar|group|custom|image|menubaritem|axbutton|axmenuitem|axmenubaritem|axmenubutton|aximage|axgroup|axtoolbar)$/i;
// Ô chữ: v null (không phải ô mật khẩu) nghĩa là Value/TextPattern không đọc được.
const VALUE_ROLE = /^(edit|document|combobox|axtextfield|axtextarea|axcombobox|axsearchfield)$/i;
// Phần tử mang chữ thật (tên hoặc giá trị). Nút/menu không nằm ở đây.
const TEXT_NAME_ROLE = /^(text|hyperlink|listitem|dataitem|treeitem|header|headeritem|tabitem|axstatictext|axlink|axrow|axcell)$/i;
function roleOf(e) { return String((e && (e.r || e.role)) || ''); }
function nameOf(e) { return String((e && (e.n != null ? e.n : e.name)) || '').trim(); }
function valueOf(e) { if (!e || typeof e !== 'object') return undefined; if (e.v !== undefined) return e.v; if (e.value !== undefined) return e.value; return undefined; }
function isPassword(e) { return !!(e && (e.p === true || e.password === true || /secure/i.test(roleOf(e)))); }
// Có phần tử mang chữ (giá trị khác rỗng, hoặc vai trò chữ có tên). Nút/menu/khung không tính.
function uiaHasContent(els) {
  if (!Array.isArray(els) || !els.length) return false;
  for (const e of els) {
    if (!e || typeof e !== 'object' || isPassword(e)) continue;
    const role = roleOf(e);
    if (SKIP_ROLE.test(role)) continue;
    const v = valueOf(e);
    if (v != null && String(v).trim()) return true;
    if (TEXT_NAME_ROLE.test(role) && nameOf(e)) return true;
  }
  return false;
}
// Edit/Document/ComboBox không phải ô mật khẩu mà v null → mới đọc được một phần.
function uiaValueMissing(els) {
  for (const e of els) {
    if (!e || typeof e !== 'object' || isPassword(e)) continue;
    if (VALUE_ROLE.test(roleOf(e)) && valueOf(e) == null) return true;
  }
  return false;
}
// Kết quả UIA → chuỗi chữ, hoặc { unread: true } khi đọc rỗng, đọc một phần, cây bị cắt, hoặc lỗi.
function uiaRead(raw) {
  if (raw == null) return { unread: true };
  if (typeof raw === 'string') return raw.trim() ? raw : { unread: true };
  if (typeof raw !== 'object') return { unread: true };
  if (raw.unread || raw.error || raw.noTree || raw.truncated || raw.timedOut) return { unread: true };
  const els = Array.isArray(raw.els) ? raw.els : (Array.isArray(raw) ? raw : null);
  if (!els || uiaValueMissing(els) || !uiaHasContent(els)) return { unread: true };
  const text = els.map(e => {
    if (!e || typeof e !== 'object' || isPassword(e)) return '';
    const role = roleOf(e);
    if (SKIP_ROLE.test(role)) return '';
    const v = valueOf(e);
    const parts = [];
    if (TEXT_NAME_ROLE.test(role) && nameOf(e)) parts.push(nameOf(e));
    if (v != null && String(v).trim()) parts.push(String(v).trim());
    return parts.join(' ');
  }).filter(Boolean).join('\n');
  return text.trim() ? text : { unread: true };
}
// Danh sách cửa sổ + chữ, đã đọc xong. Lỗi hoặc quá hạn → ok:false (không được coi là “không có cửa sổ”).
async function readWindows({ windows = null, loadWindows = null, loadText = null, timeoutMs = 8000 } = {}) {
  try {
    let wins = windows;
    if (typeof loadWindows === 'function') {
      let timer;
      const job = Promise.resolve().then(() => loadWindows()).then(v => ({ ok: true, v }), () => ({ ok: false }));
      const got = await Promise.race([
        job,
        new Promise(res => { timer = setTimeout(() => res({ ok: false }), timeoutMs); }),
      ]);
      if (timer) clearTimeout(timer);
      if (!got || !got.ok) throw new Error('windows');
      wins = got.v;
    }
    if (wins != null && !Array.isArray(wins)) throw new Error('windows');
    if (typeof loadText === 'function') wins = await fillWindowText(wins || [], loadText, { timeoutMs });
    return { ok: true, wins: wins || [], info: null };
  } catch {
    return { ok: false, wins: [], info: null };
  }
}
// Khoá ổn định của một ảnh chụp cửa sổ: tập cửa sổ đang hiện + chữ/hash. Thứ tự cửa sổ không tính.
function snapKey(wins, info) {
  const rows = (Array.isArray(wins) ? wins : []).filter(onScreen).map(w => [
    w && w.hwnd != null ? String(w.hwnd) : '', w && w.pid != null ? String(w.pid) : '',
    String(w && w.title || ''), String(w && w.proc || ''), w && w.unread ? '1' : '0',
    String(w && w.text || ''), String(w && w.body || ''), String(w && w.ocr || ''),
  ].join('\u0001')).sort();
  const inf = info && typeof info === 'object' ? [String(info.title || ''), String(info.proc || ''), String(info.text || '')].join('\u0001') : '';
  return inf + '\u0002' + rows.join('\u0002');
}
// Hai lần đọc (trước và sau khi chụp) khác nhau → điểm ảnh có thể không khớp lần đọc nào.
function snapshotsDiffer(a, b) {
  if (!a || !b || !a.ok || !b.ok) return true;
  return snapKey(a.wins, a.info) !== snapKey(b.wins, b.info);
}
// Quét, và nếu liệt kê cửa sổ / đọc chữ lỗi hoặc quá hạn thì KHÔNG trả “không thấy gì” — trả failed để người gọi xoá ảnh.
async function reveal({ title = '', proc = '', text = '', windows = null, loadWindows = null, loadText = null, timeoutMs = 8000 } = {}) {
  const snap = await readWindows({ windows, loadWindows, loadText, timeoutMs });
  if (!snap.ok) return { reasons: ['text:unreadable'], titles: [], failed: true, unread: [] };
  return screenSecrets({ title, proc, text, windows: snap.wins });
}
// che chuỗi trông như khoá (giữ phần chữ còn lại để vẫn đọc được bước đã làm gì)
function redactSecrets(s) {
  if (typeof s !== 'string' || !s) return s;
  let o = redactCodes(s); for (const [, re, skip] of SECRET_RE) { re.lastIndex = 0; o = o.replace(re, (m) => (skip && skip(m) ? m : MASK)); }
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
// che chuỗi trông như khoá trong phần “Kết quả”. agent.js cũng che forModel trước khi gửi cho mô hình.
const IMAGE_KEY = /^(thumb|image|img|shot|screenshot|png|jpeg|jpg)$/i;
function stripImages(step) {
  if (!step || typeof step !== 'object') return false;
  let had = false;
  for (const k of Object.keys(step)) if (IMAGE_KEY.test(k) || (typeof step[k] === 'string' && /^data:image\//.test(step[k]))) { if (step[k] != null) had = true; delete step[k]; }
  return had;
}
function guardStep(step, out, { warn = () => WARN, steps = null, republish = null } = {}) {
  if (!step || !out) return step;
  const w = out.window && typeof out.window === 'object' ? out.window : null;
  if (w && (w.hwnd != null || w.title)) step.win = { hwnd: w.hwnd ?? null, pid: w.pid ?? null, proc: w.proc || null, title: w.title || '', b: Array.isArray(w.b) ? w.b : undefined };
  const hits = [...new Set([...reasonList(out.sensitive), ...scan({ title: w ? w.title : '', proc: w ? w.proc : '', text: [out.forModel, out.summary, out.detail].filter(x => typeof x === 'string').join('\n') })])];
  if (hits.length) {
    step.sensitive = hits;
    out.thumb = null; if (typeof out.image === 'string') out.image = null; // đừng giữ ảnh gốc trong kết quả công cụ (bộ nhớ seen)
    stripImages(step);
    const ts = w && w.title ? [w.title] : []; // tiêu đề cửa sổ nhạy cảm (vd. tên tệp mã kích hoạt) → che trong thẻ bước + nhật ký (logTool)
    if (typeof step.summary === 'string') step.summary = redactTitles(step.summary, ts);
    if (typeof step.detail === 'string') step.detail = redactTitles(step.detail, ts);
    step.summary = (step.summary ? String(step.summary) + ' · ' : '') + '⚠ ' + warn();
    if (Array.isArray(steps)) for (const prev of steps) {
      if (!prev || prev === step) continue;
      if (stripImages(prev) && typeof republish === 'function') { try { republish({ ...prev, revise: true }); } catch {} }
    }
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
async function shot({ capture, captured = null, target = null, reasons = [], image = undefined, maxW = 1920 } = {}) {
  const I = image === undefined ? electronImage() : image;
  const c = captured || await capture({ maxW });
  const rect = target && target.b ? rectInShot(target.b, c) : null;
  const meta = { scope: rect ? 'window' : 'screen', rect: rect || null, redacted: false, reasons: [...reasons] };
  if (!I) { // không xử lý ảnh được: ảnh nhạy cảm thì KHÔNG ghi gì; còn lại ghi ảnh toàn màn hình như trước
    if (reasons.length) { if (c && typeof c === 'object') c.dataUrl = null; return { ...meta, buf: null, skipped: 'sensitive-no-image' }; }
    return { ...meta, scope: 'screen', rect: null, buf: Buffer.from(String(c.dataUrl).split(',')[1] || '', 'base64') };
  }
  let img = I.decode(c.dataUrl); if (rect) img = I.crop(img, rect);
  const z = I.size(img);
  if (reasons.length) { img = null; if (c && typeof c === 'object') c.dataUrl = null; return { ...meta, redacted: true, buf: I.jpeg(I.blank(z.width, z.height)) }; }
  return { ...meta, buf: I.jpeg(img) };
}
// Xoá điểm ảnh đang giữ trong bộ nhớ (data URL). Gọi TRƯỚC khi đưa ảnh cho thẻ bước, thẻ xin phép, hoặc mô hình nhìn ảnh.
function dropShotPixels(shot) {
  if (!shot || typeof shot !== 'object') return shot;
  shot.dataUrl = null; shot.redacted = true;
  for (const k of ['thumb', 'png', 'jpeg', 'jpg', 'image', 'bitmap']) if (k in shot) shot[k] = null;
  return shot;
}
// Ảnh đã ghi trong lượt này (chưa che) — xoá khi sau đó mới biết màn hình có mã.
// sweep: cả thư mục shots (ảnh gốc của lượt QA trước), vẫn bỏ symlink / tên lạ / đường dẫn ra ngoài. Ảnh đã che của lượt này được giữ.
function forgetShots(steps, dir, opt) {
  const sweep = !!(opt && opt.sweep);
  const res = { removed: 0 };
  let real; try { real = fs.realpathSync(dir); } catch { return res; }
  if (isRootish(real)) { res.refused = true; return res; }
  const list = Array.isArray(steps) ? steps : [];
  const dropFile = (rp) => { try { fs.unlinkSync(rp); res.removed++; return true; } catch { return false; } };
  const realFile = (p) => {
    let st; try { st = fs.lstatSync(p); } catch { return null; }
    if (st.isSymbolicLink() || !st.isFile()) return null;
    let rp; try { rp = fs.realpathSync(p); } catch { return null; }
    if (path.dirname(rp) !== real || !SHOT_NAME.test(path.basename(rp))) return null;
    return rp;
  };
  for (const s of list) {
    if (!s || !s.shot || s.shotRedacted) continue;
    const rp = realFile(s.shot);
    if (rp && dropFile(rp)) { s.shot = null; s.shotRedacted = true; s.shotPurged = true; }
  }
  if (!sweep) return res;
  const keep = new Set();
  for (const s of list) { if (!s || !s.shot || !s.shotRedacted) continue; const rp = realFile(s.shot); if (rp) keep.add(rp); }
  let names = []; try { names = fs.readdirSync(real); } catch { return res; }
  for (const n of names) {
    if (!SHOT_NAME.test(n) || n.includes('..') || n.includes('/') || n.includes('\\')) continue;
    const rp = realFile(path.join(real, n));
    if (!rp || keep.has(rp)) continue;
    dropFile(rp);
  }
  return res;
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
module.exports = { scan, screenSecrets, reveal, readWindows, snapshotsDiffer, fillWindowText, uiaRead, uiaHasContent, codeSpans, reasonList, redactSecrets, redactTitles, guardStep, rectInShot, shot, dropShotPixels, forgetShots, prune, electronImage, WARN, MASK, SHOT_NAME, onScreen };
