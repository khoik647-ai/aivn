// AIVN – Hỏi đáp tài liệu bằng tìm kiếm ngữ nghĩa (RAG)
// Chia tài liệu thành đoạn ~500 token có phần gối đầu, nhúng (embedding) trên máy,
// lưu chỉ mục vector riêng cho từng cuộc trò chuyện, rồi lấy các đoạn liên quan nhất cho mỗi câu hỏi.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { keywords, scoreChunk } = require('./docs');

const INDEX_VERSION = 1;
const CHUNK_TOKENS = 500;
const OVERLAP_TOKENS = 80;
const CHARS_PER_TOKEN = 3.4; // ước lượng cho tiếng Việt/Anh với bộ tách từ của bge-m3
const PAGE_RE = /\[Trang (\d+)\]/g;

const hashText = (t) => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 32);

// Tách văn bản thành các "câu" nhỏ, giữ ranh giới đoạn văn, để cắt đoạn không làm vỡ câu
function units(text) {
  const out = [];
  for (const para of String(text).replace(/\r\n?/g, '\n').split(/\n{2,}|\n(?=\[Trang \d+\])/)) {
    const p = para.trim(); if (!p) continue;
    // chỉ cắt câu tại dấu câu theo sau là khoảng trắng (giữ nguyên số như 2.750 hay 63,8%)
    const sents = p.split(/(?<=[.!?…。]["”’)\]]*)\s+|\n/);
    sents.forEach((s, i) => { const t = s.trim(); if (t) out.push({ text: t, paraStart: i === 0 }); });
  }
  return out;
}

// Chia đoạn: mỗi đoạn ≈ chunkTokens, đoạn sau lặp lại ≈ overlapTokens cuối của đoạn trước.
// Trả [{ i, text, page, pageEnd }]; số trang lấy từ dấu [Trang N] do bộ đọc PDF chèn vào.
function chunkDocument(text, { chunkTokens = CHUNK_TOKENS, overlapTokens = OVERLAP_TOKENS, countTokens } = {}) {
  const est = countTokens || ((t) => Math.ceil(t.length / CHARS_PER_TOKEN));
  const us = units(text);
  // gán số trang cho từng câu
  let page = null;
  for (const u of us) {
    let m; PAGE_RE.lastIndex = 0;
    const first = u.text.match(/^\[Trang (\d+)\]/);
    if (first) page = Number(first[1]);
    u.page = page;
    while ((m = PAGE_RE.exec(u.text))) page = Number(m[1]);
    u.pageEnd = page;
    u.tok = est(u.text);
  }
  // câu quá dài (bảng, mã…): cắt cứng theo ký tự
  const maxChars = Math.floor(chunkTokens * CHARS_PER_TOKEN);
  const flat = [];
  for (const u of us) {
    if (u.tok <= chunkTokens) { flat.push(u); continue; }
    for (let i = 0; i < u.text.length; i += maxChars) { const t = u.text.slice(i, i + maxChars); flat.push({ ...u, text: t, tok: est(t), paraStart: i === 0 && u.paraStart }); }
  }
  const chunks = [];
  let start = 0;
  while (start < flat.length) {
    let end = start, tok = 0;
    while (end < flat.length && (tok + flat[end].tok <= chunkTokens || end === start)) { tok += flat[end].tok; end++; }
    const seg = flat.slice(start, end);
    const body = seg.map((u, k) => (k && u.paraStart ? '\n\n' : k ? ' ' : '') + u.text).join('');
    const pages = seg.map(u => u.page).filter(p => p != null);
    chunks.push({ i: chunks.length, text: body, page: pages.length ? pages[0] : null, pageEnd: seg[seg.length - 1].pageEnd ?? null, tokens: tok });
    if (end >= flat.length) break;
    // lùi lại để gối đầu nhưng luôn tiến lên ít nhất một câu
    let back = end, ov = 0;
    while (back - 1 > start && ov + flat[back - 1].tok <= overlapTokens) { back--; ov += flat[back].tok; }
    start = Math.max(start + 1, back);
  }
  return chunks;
}

const encodeVecs = (vecs) => Buffer.concat(vecs.map(v => Buffer.from(v.buffer, v.byteOffset, v.byteLength))).toString('base64');
function decodeVecs(b64, dims) {
  const u = Uint8Array.from(Buffer.from(b64, 'base64'));
  const all = new Float32Array(u.buffer);
  const out = [];
  for (let i = 0; i + dims <= all.length; i += dims) out.push(all.subarray(i, i + dims));
  return out;
}
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// Chỉ mục vector của một cuộc trò chuyện: <dir>/<convoId>.json
function createRagStore(dir) {
  const safeId = (id) => { const s = String(id || ''); if (!/^[\w-]{1,64}$/.test(s)) throw new Error('Mã cuộc trò chuyện không hợp lệ'); return s; };
  const file = (id) => path.join(dir, safeId(id) + '.json');
  const cache = new Map();
  function load(id, model) {
    const key = safeId(id);
    let idx = cache.get(key);
    if (!idx) {
      try { idx = JSON.parse(fs.readFileSync(file(key), 'utf8')); } catch { idx = null; }
      if (idx) idx.docs = (idx.docs || []).map(d => ({ ...d, _v: decodeVecs(d.vecs, idx.dims) }));
    }
    if (!idx || idx.version !== INDEX_VERSION || (model && idx.model !== model)) idx = { version: INDEX_VERSION, model: model || null, dims: 0, docs: [] };
    cache.set(key, idx);
    return idx;
  }
  function save(id, idx) {
    fs.mkdirSync(dir, { recursive: true });
    const data = { version: idx.version, model: idx.model, dims: idx.dims, updatedAt: Date.now(), docs: idx.docs.map(({ _v, ...d }) => d) };
    const f = file(id), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, f);
  }
  function has(id) { try { return fs.existsSync(file(id)); } catch { return false; } }
  function remove(id) { try { const k = safeId(id); cache.delete(k); fs.rmSync(file(k), { force: true }); } catch {} }
  function summary(id) {
    if (!has(id)) return null;
    const idx = load(id);
    return { docs: idx.docs.map(d => ({ name: d.name, chunks: d.chunks.length, pages: d.pages || null })), model: idx.model };
  }

  // Thêm tài liệu (bỏ qua nếu đã có cùng nội dung). embed(texts, kind) -> Float32Array[]
  async function addDocuments(id, docsIn, { embed, model, onProgress } = {}) {
    const idx = load(id, model);
    const added = [];
    for (const d of docsIn) {
      const hash = hashText(d.text);
      const old = idx.docs.find(x => x.hash === hash);
      if (old) { if (old.name !== d.name) old.name = d.name; added.push({ name: d.name, chunks: old.chunks.length, reused: true }); continue; }
      const chunks = chunkDocument(d.text);
      const vecs = [];
      for (let i = 0; i < chunks.length; i += 8) {
        const part = await embed(chunks.slice(i, i + 8).map(c => c.text), 'passage');
        vecs.push(...part);
        if (onProgress) onProgress({ name: d.name, done: Math.min(i + 8, chunks.length), total: chunks.length });
      }
      if (vecs.length && !idx.dims) idx.dims = vecs[0].length;
      idx.docs.push({ hash, name: d.name, kind: d.kind || 'text', pages: d.pages || null, addedAt: Date.now(), chunks, vecs: encodeVecs(vecs), _v: vecs });
      added.push({ name: d.name, chunks: chunks.length, reused: false });
    }
    save(id, idx);
    return added;
  }

  // Lấy top-k đoạn liên quan nhất, vừa với ngân sách token. Điểm = cosine + một chút điểm từ khoá (giúp tên riêng, con số).
  async function retrieve(id, question, { embed, model, k = 6, budget = 3000, countTokens, margin = 0.08 } = {}) {
    const idx = load(id, model);
    if (!idx.docs.length) return null;
    const est = countTokens || ((t) => Math.ceil(t.length / CHARS_PER_TOKEN));
    const [q] = await embed([question], 'query');
    const kws = keywords(question);
    const cands = [];
    for (const d of idx.docs) d.chunks.forEach((c, j) => { const v = d._v[j]; if (v) cands.push({ doc: d, c, cos: dot(q, v), kw: scoreChunk(c.text, kws) }); });
    const maxKw = Math.max(1, ...cands.map(x => x.kw));
    for (const x of cands) x.score = x.cos + 0.12 * (x.kw / maxKw);
    cands.sort((a, b) => b.score - a.score);
    // chỉ giữ đoạn gần với đoạn tốt nhất (tránh kéo theo đoạn không liên quan), tối thiểu 2 đoạn
    const top = cands.length ? cands[0].score : 0;
    const picked = []; let used = 0;
    for (const x of cands) {
      if (picked.length >= k) break;
      if (picked.length >= 2 && x.score < top - margin) break;
      const t = est(x.c.text) + 24;
      if (used + t > budget && picked.length) continue;
      if (used + t > budget) { x.cut = true; }
      picked.push(x); used += t;
    }
    const byScore = picked.slice();
    // trình bày theo thứ tự tài liệu để mô hình đọc mạch lạc; nguồn hiển thị theo mức liên quan
    picked.sort((a, b) => idx.docs.indexOf(a.doc) - idx.docs.indexOf(b.doc) || a.c.i - b.c.i);
    const label = (x) => `${x.doc.name}, đoạn ${x.c.i + 1}${x.c.page ? `, trang ${x.c.page}${x.c.pageEnd && x.c.pageEnd !== x.c.page ? '–' + x.c.pageEnd : ''}` : ''}`;
    const block = picked.map(x => {
      let text = x.c.text;
      if (x.cut) text = text.slice(0, Math.max(200, Math.floor((budget - 40) * CHARS_PER_TOKEN)));
      return `<<<TRÍCH ĐOẠN [${label(x)}]>>>\n${text}\n<<<HẾT TRÍCH ĐOẠN>>>`;
    }).join('\n\n');
    const sources = byScore.map(x => ({ file: x.doc.name, chunk: x.c.i + 1, page: x.c.page, pageEnd: x.c.pageEnd, score: Math.round(x.cos * 1000) / 1000, preview: x.c.text.replace(/\[Trang \d+\]\s*/g, '').slice(0, 220) }));
    return { block, sources, totalChunks: cands.length, tokens: used };
  }
  return { load, save, has, remove, summary, addDocuments, retrieve, file };
}

function buildRagContent(question, block) {
  return `Dưới đây là các trích đoạn liên quan nhất trong tài liệu người dùng gửi kèm (AIVN tìm bằng tìm kiếm ngữ nghĩa). Hãy dựa vào các trích đoạn để trả lời; nếu không có thông tin, hãy nói rõ là tài liệu không đề cập.\n\n${block}\n\nCâu hỏi: ${question}`;
}

module.exports = { chunkDocument, createRagStore, buildRagContent, hashText, CHUNK_TOKENS, OVERLAP_TOKENS, INDEX_VERSION };
