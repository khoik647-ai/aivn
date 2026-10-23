'use strict';
// B192 (#59): bước gõ chỉ được tính là xong khi chữ vừa gõ thật sự có trên màn hình.
// Bằng chứng: cây UIA/AX (giá trị/tên phần tử, không phải chữ OCR) hoặc ảnh (OCR / mô hình nhìn).
// Ảnh bị che vì bí mật (B193) không phải bằng chứng; chữ trên cây UIA/AX vẫn tính, để không báo sai là thất bại.
// Chuẩn hoá: Unicode NFC, gom khoảng trắng và xuống dòng, bỏ dấu tiếng Việt khi so (OCR hay mất dấu).
// Chữ dài chỉ hiện một phần: thấy đầu hoặc đuôi là đủ.

const { fuzzyHas } = require('./uitree');

const HEAD = 32;
const TAIL = 32;
const LONG = 80;
const LOOKS = 3; // số lần nhìn tối đa (lần đầu + nhìn lại) trước khi bước gõ trả về thất bại
// Câu hỏi cho mô hình nhìn ảnh: KHÔNG nhét chữ vừa gõ vào đây (mô hình chép lại câu hỏi thì bị tính nhầm là đã thấy chữ).
const LOOK_Q = 'Liệt kê đúng chữ đang hiện trong vùng soạn thảo hoặc ô đang chọn. Nếu trống thì nói trống.';

const nfc = (s) => String(s == null ? '' : s).normalize('NFC');
// xuống dòng (kể cả U+2028/U+2029) và khoảng trắng gom thành một dấu cách; NFC trước khi so
const squash = (s) => nfc(s).replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => squash(s).toLowerCase();
const fold = (s) => norm(s).normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

function partsOf(typed) {
  const n = norm(typed);
  const f = fold(typed);
  if (!n) return [];
  if (n.length <= LONG) return [{ n, f, part: 'all' }];
  return [
    { n: n.slice(0, HEAD), f: f.slice(0, HEAD), part: 'head' },
    { n: n.slice(-TAIL), f: f.slice(-TAIL), part: 'tail' },
  ];
}

const linesOf = (src) => (Array.isArray(src) ? src : [src]).flat().filter(x => x != null && String(x).trim()).map(x => String(x));

function hay(src) {
  const raw = linesOf(src).join('\n');
  return { n: norm(raw), f: fold(raw) };
}

// chữ ngắn phải khớp cả từ, kẻo "ok" dính vào "token"
function exactHit(h, part) {
  if (!part.n) return false;
  if (part.n.length <= 2) {
    const esc = part.f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^| )${esc}(?: |$)`).test(h.f);
  }
  return h.n.includes(part.n) || h.f.includes(part.f);
}

function noisyHit(src, part) {
  const needle = part.f.slice(0, 40);
  if (needle.length < 5) return false;
  for (const line of linesOf(src)) {
    const f = fold(line);
    const n = norm(line);
    if (n.includes(part.n) || f.includes(part.f)) return true;
    if (fuzzyHas(f, needle)) return true;
  }
  return false;
}

function sources(evidence) {
  const e = evidence || {};
  const blank = !!e.shotBlanked;
  return [
    ['uia', e.uia, false],
    ['ocr', blank ? '' : e.ocr, true],
    ['vision', blank ? '' : e.vision, true],
  ];
}

// khớp một nguồn: trả part ('all' | 'head' | 'tail' | 'both') hoặc null
function matchSource(parts, src, noisy) {
  const h = hay(src);
  if (!h.n && !noisy) return null;
  if (parts.length === 1) return (exactHit(h, parts[0]) || (noisy && noisyHit(src, parts[0]))) ? 'all' : null;
  const head = exactHit(h, parts[0]) || (noisy && noisyHit(src, parts[0]));
  const tail = exactHit(h, parts[1]) || (noisy && noisyHit(src, parts[1]));
  if (head && tail) return 'both';
  if (head) return 'head';
  if (tail) return 'tail';
  return null;
}

function match(typed, evidence) {
  const parts = partsOf(typed);
  if (!parts.length) return { ok: false, via: null, part: null, why: 'empty' };
  for (const [via, src, noisy] of sources(evidence)) {
    const part = matchSource(parts, src, noisy);
    if (part) return { ok: true, via, part, why: '' };
  }
  return { ok: false, via: null, part: null, why: evidence && evidence.shotBlanked ? 'shot-blanked' : 'not-seen' };
}

function countPart(src, part, noisy) {
  if (!part) return 0;
  if (exactHit(hay(src), part)) {
    const h = hay(src);
    const needle = h.n.includes(part.n) ? part.n : part.f;
    const bag = needle === part.n ? h.n : h.f;
    let n = 0; let i = 0;
    while (i <= bag.length) {
      const j = bag.indexOf(needle, i);
      if (j < 0) break;
      n++; i = j + Math.max(1, needle.length);
    }
    return n;
  }
  return noisy && noisyHit(src, part) ? 1 : 0;
}

// before: bằng chứng TRƯỚC khi gõ. Chữ đã có sẵn (nút, tiêu đề) mà không thêm lần nào thì chưa phải vừa gõ.
function textOnScreen(typed, evidence = {}, before = null) {
  const now = match(typed, evidence);
  if (!now.ok || !before) return now;
  const prev = match(typed, before);
  if (!prev.ok) return now;
  const parts = partsOf(typed);
  const part = now.part === 'tail' ? parts[1] : parts[0];
  const noisy = now.via !== 'uia';
  const srcNow = now.via === 'uia' ? evidence.uia : now.via === 'ocr' ? evidence.ocr : evidence.vision;
  const srcPrev = prev.via === 'uia' ? before.uia : prev.via === 'ocr' ? before.ocr : before.vision;
  // so cùng nguồn vừa khớp; nguồn trước khác (chỉ có nút) không che OCR mới
  if (now.via !== prev.via) return now;
  if (countPart(srcNow, part, noisy) > countPart(srcPrev, part, noisy)) return now;
  return { ok: false, via: null, part: null, why: 'already-there' };
}

function collect(obs, { seen = '', shotBlanked = false } = {}) {
  const uia = [];
  const ocr = [];
  for (const e of (obs && obs.elements) || []) {
    const bits = [e && e.value, e && e.name].filter(x => x != null && String(x).trim());
    if (e && e.ocr) ocr.push(...bits);
    else uia.push(...bits);
  }
  return { uia, ocr, vision: shotBlanked ? '' : (seen || ''), shotBlanked: !!shotBlanked };
}

// Nhìn lại có hạn. read(i) trả bằng chứng lần i (i = 0 là lần vừa chụp). Thiếu chữ sau lần cuối → ok: false.
async function confirmTyped(typed, read, { looks = LOOKS, signal, before = null } = {}) {
  let last = { ok: false, via: null, part: null, why: 'not-seen', looks: 0 };
  const n = Math.max(1, Number(looks) || 1);
  for (let i = 0; i < n; i++) {
    if (signal && signal.aborted) return { ...last, ok: false, why: 'aborted', looks: i };
    let ev = null;
    try { ev = await read(i); } catch { return { ...last, ok: false, why: 'read', looks: i + 1 }; }
    if (!ev) return { ...last, ok: false, why: 'aborted', looks: i };
    const hit = textOnScreen(typed, ev, before);
    last = { ...hit, looks: i + 1 };
    if (hit.ok) return last;
  }
  return { ...last, ok: false };
}

function thenList(a) {
  const t = a && a.then;
  if (Array.isArray(t)) return t;
  if (typeof t === 'string') { try { const p = JSON.parse(t); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function isWriteStep(step) {
  if (!step || step.name !== 'screen_act' || step.status === 'refused') return false;
  const a = step.args || {};
  if (a.action === 'type_text' && String(a.text || '').trim()) return true;
  return thenList(a).some(x => x && x.action === 'type_text' && String(x.text || '').trim());
}

function writeText(step) {
  const a = (step && step.args) || {};
  if (a.action === 'type_text' && a.text) return fold(a.text);
  const sub = [...thenList(a)].reverse().find(x => x && x.action === 'type_text' && x.text);
  return sub ? fold(sub.text) : '';
}

// true = đã thấy chữ, false = đã kiểm mà không thấy, null = bước không mang bằng chứng (bản giả cũ / không phải gõ)
function evidenceOf(step) {
  if (!step) return null;
  if (step.typedSeen && step.typedSeen.ok === true) return true;
  if (step.typedSeen && step.typedSeen.ok === false) return false;
  if (step.draftIn && step.draftIn.text) return true;
  if (step.verify && step.verify.sent === true) return true;
  if (step.check === 'chưa thấy chữ vừa gõ') return false;
  const t = `${step.detail || ''} ${step.summary || ''}`;
  if (/CHƯA thấy chữ vừa gõ/i.test(t)) return false;
  if (/Đã thấy chữ vừa gõ/i.test(t)) return true;
  return null;
}

// Việc không được 'done' khi còn bước gõ đã kiểm mà không thấy chữ.
// Lần gõ sau của CÙNG chữ mà thấy chữ thì lần trước là thử lại, không giữ việc ở trạng thái thất bại.
function taskWritesOk(steps) {
  const writes = (steps || []).filter(isWriteStep);
  for (let i = 0; i < writes.length; i++) {
    if (evidenceOf(writes[i]) !== false) continue;
    const key = writeText(writes[i]);
    const later = writes.slice(i + 1).some(w => evidenceOf(w) === true && (!key || writeText(w) === key));
    if (!later) return { ok: false, why: 'chưa thấy chữ vừa gõ' };
  }
  return { ok: true, why: '' };
}

module.exports = {
  HEAD, TAIL, LONG, LOOKS, LOOK_Q,
  nfc, squash, norm, fold, partsOf,
  textOnScreen, collect, confirmTyped,
  isWriteStep, evidenceOf, taskWritesOk, writeText,
};
