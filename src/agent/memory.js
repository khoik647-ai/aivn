// Bộ nhớ dài hạn của AIVN BOT ("Ghi nhớ"): các điều ngắn gọn về người dùng/công việc, lưu cục bộ trong userData/memory.json.
// Truy xuất: có BGE-M3 thì tìm theo ý nghĩa (vector lưu kèm, tính lại khi đổi nội dung), không có thì theo từ khoá.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { keywords, scoreChunk } = require('../docs');

const MAX_ITEMS = 500, MAX_LEN = 500;
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const key = (t) => norm(t).toLowerCase().normalize('NFC').replace(/[.!。]+$/, '');
const hash = (t) => crypto.createHash('sha256').update(norm(t)).digest('hex').slice(0, 16);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const toB64 = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
const fromB64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };

function createMemoryStore(file) {
  let data = { items: [], vecs: {} };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j.items)) data = { items: j.items, vecs: j.vecs || {} }; } catch {}
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); };
  const pub = (m) => ({ id: m.id, text: m.text, createdAt: m.createdAt, updatedAt: m.updatedAt, source: m.source, uses: m.uses || 0 });

  function list() { return data.items.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(pub); }
  function add(text, { source = 'assistant', convoId = null } = {}) {
    text = norm(text).slice(0, MAX_LEN);
    if (text.length < 2) throw new Error('Nội dung ghi nhớ trống');
    const k = key(text);
    const dup = data.items.find(m => key(m.text) === k);
    if (dup) { dup.updatedAt = Date.now(); save(); return { ...pub(dup), duplicate: true }; }
    if (data.items.length >= MAX_ITEMS) throw new Error(`Đã đủ ${MAX_ITEMS} ghi nhớ. Hãy xoá bớt trong mục Ghi nhớ.`);
    const m = { id: 'mem_' + crypto.randomBytes(6).toString('hex'), text, createdAt: Date.now(), updatedAt: Date.now(), source, convoId };
    data.items.push(m); save(); return pub(m);
  }
  function update(id, text) {
    const m = data.items.find(x => x.id === id); if (!m) throw new Error('Không tìm thấy ghi nhớ');
    text = norm(text).slice(0, MAX_LEN); if (text.length < 2) throw new Error('Nội dung ghi nhớ trống');
    m.text = text; m.updatedAt = Date.now(); delete data.vecs[id]; save(); return pub(m);
  }
  function remove(id) { const n = data.items.length; data.items = data.items.filter(x => x.id !== id); delete data.vecs[id]; if (data.items.length !== n) save(); return n !== data.items.length; }
  function clear() { data = { items: [], vecs: {} }; save(); }

  // embed(texts, kind) → Float32Array[] (chuẩn hoá); model: tên mô hình nhúng (đổi mô hình thì tính lại)
  async function retrieve(query, { embed = null, model = null, k = 6, minScore = 0.42 } = {}) {
    const items = data.items;
    if (!items.length) return { items: [], mode: 'none' };
    let scored = null, mode = 'keyword';
    if (embed) {
      try {
        const need = items.filter(m => { const v = data.vecs[m.id]; return !v || v.h !== hash(m.text) || v.model !== model; });
        if (need.length) {
          const vs = await embed(need.map(m => m.text), 'passage');
          need.forEach((m, i) => { data.vecs[m.id] = { h: hash(m.text), model, v: toB64(vs[i]) }; });
          save();
        }
        const [q] = await embed([query], 'query');
        scored = items.map(m => ({ m, s: dot(q, fromB64(data.vecs[m.id].v)) }));
        mode = 'semantic';
      } catch { scored = null; }
    }
    if (!scored) {
      const kws = keywords(query);
      scored = items.map(m => ({ m, s: kws.length ? scoreChunk(m.text, kws) : 0 }));
      minScore = 0.9;
    }
    scored.sort((a, b) => b.s - a.s || b.m.updatedAt - a.m.updatedAt);
    let picked = scored.filter(x => x.s >= minScore).slice(0, k);
    // ít ghi nhớ: đưa luôn vài điều gần đây nhất (rẻ, giúp mô hình nhỏ)
    if (items.length <= 8) { const ids = new Set(picked.map(x => x.m.id)); for (const x of scored) if (!ids.has(x.m.id) && picked.length < Math.min(k, 8)) picked.push(x); }
    for (const x of picked) x.m.uses = (x.m.uses || 0) + 1;
    return { items: picked.map(x => ({ ...pub(x.m), score: +x.s.toFixed(3) })), mode };
  }
  return { list, add, update, remove, clear, retrieve, count: () => data.items.length, file };
}

module.exports = { createMemoryStore };
