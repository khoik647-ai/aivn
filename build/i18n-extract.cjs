'use strict';
// Trích các đoạn chữ tiếng Việt hiện trên giao diện → src/i18n/strings.json (khoá dịch).
// Đoạn = chữ nằm giữa các thẻ HTML; ${...} trong chuỗi mẫu thành {0},{1}…; thuộc tính title/placeholder/aria-label/data-tip/alt cũng là đoạn.
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const VD = require('../src/i18n/vi-detect');
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const ATTR = /\b(?:title|placeholder|aria-label|data-tip|alt|label|data-empty)\s*=\s*"([^"]*)"/g;
// chữ Việt không dấu (regex VI không bắt được) mà giao diện có hiện
const ASCII_VI = new Set(['Chung', 'Kinh doanh', 'Thua', 'Xem', 'xong', 'hay', 'Kho', 'SL', 'CK', 'CK %', '🖨 In']);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
// bỏ thực thể HTML phổ biến
const ent = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, '\u00a0').replace(/&middot;/g, '·').replace(/&rarr;/g, '→').replace(/&hellip;/g, '…');

function fromHtml(html, out) {
  // html có thể chứa {n}; tách thuộc tính rồi tách chữ giữa thẻ
  html.replace(ATTR, (_, v) => { add(v, out); return ''; });
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').split(/<[^>]*>/);
  for (const t of text) add(t, out);
}
let HTML_LOOSE = false;
function add(t, out) {
  t = norm(ent(t)); if (!t || (!VI.test(t) && !ASCII_VI.has(t) && !(HTML_LOOSE && VD.looksUnaccentedVi(t)))) return; // B105: chữ Việt không dấu trong HTML (“CUDA 12.4 cho GPU NVIDIA”); tệp dữ liệu/JS chỉ xét chữ có dấu (bí danh cột “nhan vien”… không phải chữ giao diện)
  // đánh số lại {n} cho đoạn
  let i = 0; const k = t.replace(/\{\d+\}/g, () => `{${i++}}`);
  if (k.replace(/\{\d+\}/g, '').trim().length === 0) return;
  out.add(k);
}
// đọc chuỗi JS: '...', "...", `...${...}...` (lồng nhau)
function jsStrings(src, out) {
  let i = 0; const n = src.length;
  const readTemplate = () => { // src[i] === '`'
    i++; let s = ''; let ph = 0; const inner = [];
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { const c = src[i + 1]; s += c === 'n' ? '\n' : c === 'u' ? String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)) : c; i += c === 'u' ? 6 : 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; const st = i; let d = 1; scanCode(() => { d++; }, () => --d === 0); inner.push(src.slice(st, i - 1)); s += `{${ph++}}`; continue; }
      s += src[i++];
    }
    i++; fromHtml(s, out); for (const c of inner) jsStrings(c, out);
  };
  const readQuoted = (q) => { i++; let s = ''; while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') { const c = src[i + 1]; s += c === 'n' ? '\n' : c === 'u' ? String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)) : c; i += c === 'u' ? 6 : 2; continue; } s += src[i++]; } i++; fromHtml(s, out); };
  // quét mã tới khi stop() trả true ở dấu }
  function scanCode(open, close) {
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
      if (c === '`') { readTemplate(); continue; }
      if (c === '"' || c === "'") { readQuoted(c); continue; }
      if (c === '/' && /[=(,:;!&|?{}\[\n+]\s*$/.test(src.slice(Math.max(0, i - 20), i)) ) { // regex literal
        i++; let cls = false; while (i < n && (cls || src[i] !== '/') && src[i] !== '\n') { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; } i++; continue; }
      if (c === '{' && open) open();
      if (c === '}' && close && close()) { i++; return; }
      i++;
    }
  }
  scanCode(null, null);
}
function extract(files) {
  const out = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (f.endsWith('.html')) { HTML_LOOSE = true; fromHtml(src.replace(/<script[\s\S]*?<\/script>/g, ''), out); const m = src.match(/<title>([^<]*)<\/title>/); if (m) add(m[1], out); HTML_LOOSE = false; }
    else jsStrings(src, out);
  }
  return [...out].sort();
}
const UI_FILES = ['src/renderer/index.html', 'src/renderer/app.js', 'src/renderer/error-view.js', 'src/renderer/biz.js', 'src/renderer/gate.html', 'src/renderer/gate.js', 'src/renderer/overlay.html', 'src/renderer/overlay.js', 'src/renderer/stop.html', 'src/renderer/stop.js'];
// Tiến trình chính: chỉ chuỗi người dùng thấy trong menu, hộp thoại, khay, thông báo (khoá label/title/buttonLabel/message/detail/name/body/checkboxLabel, buttons: […])
// và chuỗi bọc trong T('…'). Bỏ phần kiểm thử QA (từ “async function qaBench” trở đi).
const MAIN_FILES = ['src/main.js'];
function extractMain(files = MAIN_FILES) {
  const out = new Set();
  for (const f of files) {
    let src = fs.readFileSync(path.join(ROOT, f), 'utf8'); const cut = src.indexOf('async function qaBench'); if (cut > 0) src = src.slice(0, cut);
    const re = /\b(?:label|title|buttonLabel|message|detail|name|body|checkboxLabel|buttons)\s*:\s*|\bT\(\s*/g; let m;
    while ((m = re.exec(src))) {
      // biểu thức tới dấu phẩy/ngoặc đóng ở cùng cấp
      let i = m.index + m[0].length, d = 0, st = i;
      for (; i < src.length; i++) { const c = src[i];
        if (c === '`' || c === '"' || c === "'") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; else if (q === '`' && src[i] === '$' && src[i + 1] === '{') { let k = 1; i += 2; while (i < src.length && k) { if (src[i] === '{') k++; else if (src[i] === '}') k--; i++; } i--; } i++; } continue; }
        if (c === '(' || c === '[' || c === '{') d++; else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; } else if (c === ',' && d === 0) break; }
      jsStrings(src.slice(st, i), out);
    }
  }
  return [...out].sort();
}
// mô-đun dữ liệu mà giao diện hiển thị nguyên văn (danh mục mô hình, cấu hình mẫu, mức máy, giấy phép, mức vừa máy, hỗ trợ công cụ…)
const DATA_FILES = ['src/catalog.js', 'src/runtimes.js', 'src/catalog-claims.js', 'src/presets.js', 'src/perf.js', 'src/license.js', 'src/fit.js', 'src/toolsupport.js', 'src/agent-eligibility.js', 'src/recommend.js', 'src/agent-bench.js', 'src/hf.js', 'src/applock.js', 'src/updater.js', 'src/gate.js', 'src/media.js', 'src/crm/crm.js', 'src/crm/biz.js', 'src/models-dir.js', 'src/load-notice.js', 'src/downloader.js'];
// 0.16 (QA lượt 5, B33): chữ động của AIVN AGENT mà người dùng THẤY (nhãn công cụ, tóm tắt bước, cảnh báo, thẻ duyệt, câu trả lời do mã tạo) —
// không lấy forModel (lời dành cho mô hình). Khoá: label/summary/warning/title/desc/okLabel/noLabel/short/message/check/why/text và hằng *_WARN / *_NOTE.
const AGENT_FILES = ['src/agent/agent.js', 'src/agent/ensure-app.js', 'src/agent/approval.js', 'src/agent/computer-tools.js', 'src/agent/computer.js', 'src/desktop-agent.js', 'src/agent/retry.js', 'src/agent/repeat.js', 'src/agent/desk-policy.js', 'src/agent/autonomy.js', 'src/agent/send-verify.js', 'src/screen-control.js', 'src/agent/compact.js', 'src/agent/scheduler.js', 'src/agent/memory.js', 'src/agent-plan.js', 'src/cloud-brain.js'];
function extractAgent(files = AGENT_FILES) {
  const out = new Set();
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const re = /\b(?:label|summary|warning|title|desc|okLabel|noLabel|short|message|why|reason|hint)\s*[:=]\s*|\b(?:const|let)\s+[A-Z][A-Z0-9_]*(?:WARN|NOTE|LABEL|ANSWER|MSG)\s*=\s*|\bsummary:\s*|\btext\s*=\s*(?=['`"])|\bACT_LABEL\s*=\s*|\bKIND\w*\s*=\s*/g; let m;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length, d = 0, st = i;
      for (; i < src.length; i++) { const c = src[i];
        if (c === '`' || c === '"' || c === "'") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; else if (q === '`' && src[i] === '$' && src[i + 1] === '{') { let k = 1; i += 2; while (i < src.length && k) { if (src[i] === '{') k++; else if (src[i] === '}') k--; i++; } i--; } i++; } continue; }
        if (c === '(' || c === '[' || c === '{') d++; else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; } else if ((c === ',' || c === ';' || c === '\n') && d === 0) break; }
      jsStrings(src.slice(st, i), out);
    }
  }
  return [...out].sort();
}
// mẫu có chỗ thay thế dính chữ (“ứng dụng{1}”) hoặc hai chỗ liền nhau (“{0}{1}”) khớp quá rộng → bỏ; chuỗi đó dịch theo từng đoạn “ · ”, câu, “(…)”
const agentKeys = (extra = []) => [...new Set([...extractAgent(), ...extra])].sort().filter(k => !/\p{L}\{\d+\}|\{\d+\}\{\d+\}/u.test(k));
module.exports = { agentKeys, extractAgent, AGENT_FILES, extract, extractMain, UI_FILES, MAIN_FILES, DATA_FILES, VI, ASCII_VI };
if (require.main === module) {
  const list = extract(UI_FILES);
  fs.writeFileSync(path.join(ROOT, 'src/i18n/strings.json'), JSON.stringify(list, null, 1) + '\n');
  console.log(list.length, 'đoạn', list.reduce((a, b) => a + b.length, 0), 'ký tự');
  const main = extractMain().filter(k => !list.includes(k));
  fs.writeFileSync(path.join(ROOT, 'src/i18n/strings-main.json'), JSON.stringify(main, null, 1) + '\n');
  console.log(main.length, 'đoạn của tiến trình chính (menu, hộp thoại)');
  const data = extract(DATA_FILES).filter(k => !list.includes(k) && !main.includes(k));
  fs.writeFileSync(path.join(ROOT, 'src/i18n/strings-data.json'), JSON.stringify(data, null, 1) + '\n');
  console.log(data.length, 'đoạn dữ liệu (danh mục mô hình, cấu hình mẫu…)');
  const extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-agent-patterns.json'), 'utf8')); // mẫu ghép câu của bước màn hình (desktop-agent describeAct, loại phần tử)
  const ag = agentKeys(extra).filter(k => !list.includes(k) && !main.includes(k) && !data.includes(k));
  fs.writeFileSync(path.join(ROOT, 'src/i18n/strings-agent.json'), JSON.stringify(ag, null, 1) + '\n');
  console.log(ag.length, 'đoạn chữ động của AIVN AGENT (nhãn, tóm tắt bước, cảnh báo, thẻ duyệt)');
}
