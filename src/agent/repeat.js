'use strict';
// Phát hiện vòng lặp khi đang sinh chữ (0.15.0): câu gần giống nhau lặp lại nhiều lần, hoặc cụm 8 từ lặp ≥4 lần.
// Dùng để DỪNG sinh ngay (không đợi người dùng bấm Dừng), giữ lại phần trước chỗ lặp.
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const words = (s) => fold(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
function sentences(text) {
  const out = []; const re = /[^.!?\n]+[.!?]*/g; let m;
  while ((m = re.exec(text))) { const w = words(m[0]); if (w.length) out.push({ start: m.index, end: m.index + m[0].length, w, set: new Set(w) }); }
  return out;
}
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
function detectLoop(text, { minWords = 5, sim = 0.6, cluster = 4, window = 14 } = {}) {
  const t = String(text || '');
  if (t.length < 120) return null;
  const all = sentences(t);
  const ss = all.filter(s => s.w.length >= minWords);
  // quét từ đầu: câu thứ i giống ≥ (cluster-1) câu trong cửa sổ trước nó → lặp; cắt tại lần xuất hiện thứ hai
  for (let i = 1; i < ss.length; i++) {
    const key = ss[i].w.join(' ');
    const prev = ss.slice(Math.max(0, i - window), i);
    const like = prev.filter(s => s.w.join(' ') === key || jaccard(ss[i].set, s.set) >= sim);
    const exact = prev.filter(s => s.w.join(' ') === key).length + 1;
    if (like.length + 1 >= cluster || exact >= 3) {
      const second = like.length >= 2 ? like[1] : ss[i];
      return { kind: 'sentence', sample: t.slice(ss[i].start, ss[i].end).trim().slice(0, 160), count: like.length + 1, cut: second.start };
    }
  }
  // cụm từ lặp (không cần dấu câu): 8 từ liên tiếp xuất hiện ≥4 lần trong 600 từ cuối
  const w = words(t).slice(-600); const seen = new Map();
  for (let i = 0; i + 8 <= w.length; i++) { const k = w.slice(i, i + 8).join(' '); const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n >= 4) return { kind: 'ngram', sample: k, count: n, cut: cutAtSecond(t, k) }; }
  return null;
}
function cutAtSecond(t, key) {
  const first = key.split(' ').slice(0, 3); const toks = []; const re = /[\p{L}\p{N}]+/gu; let m;
  while ((m = re.exec(t))) toks.push({ w: fold(m[0]), i: m.index });
  let hits = 0;
  for (let i = 0; i + 3 <= toks.length; i++) if (toks[i].w === first[0] && toks[i + 1].w === first[1] && toks[i + 2].w === first[2]) { if (++hits === 2) return toks[i].i; }
  return t.length;
}
// Bọc onToken khi stream: gọi onLoop(info) đúng một lần khi phát hiện lặp
function createRepeatGuard(onLoop, opts) {
  let buf = '', since = 0, fired = null;
  return {
    push(tok) { if (fired) return; buf += tok; since += tok.length; if (since < 40 && !/[.!?\n]/.test(tok)) return; since = 0; const r = detectLoop(buf, opts); if (r) { fired = r; try { onLoop(r, buf); } catch {} } },
    get hit() { return fired; }, get text() { return buf; },
  };
}
// Cắt phần lặp trong một câu trả lời hoàn chỉnh (dùng cả khi mô hình tự dừng sau khi đã lặp)
function trimLoop(text) { const r = detectLoop(text); return r ? { text: String(text).slice(0, r.cut).trim(), loop: r } : { text, loop: null }; }
module.exports = { detectLoop, createRepeatGuard, trimLoop, words };
