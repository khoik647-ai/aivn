// AIVN i18n — lõi dịch dùng chung cho giao diện (renderer) và tiến trình chính.
// Khoá dịch = chính câu tiếng Việt (đã gom khoảng trắng). Câu có phần thay đổi viết {0},{1}… (vd. "Đã lưu “{0}” ✓").
// Không có bản dịch → giữ nguyên tiếng Việt (không bao giờ hiện khoá rỗng).
(function (root) {
  'use strict';
  const LANGS = ['vi', 'en', 'zh'];
  const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function compile(dict) {
    const exact = new Map(); const pats = [];
    for (const [k, v] of Object.entries(dict || {})) {
      if (typeof v !== 'string' || !v) continue;
      const key = norm(k);
      if (!/\{\d+\}/.test(key)) { exact.set(key, v); continue; }
      const order = []; const src = key.split(/(\{\d+\})/).map(p => { const m = /^\{(\d+)\}$/.exec(p); if (m) { order.push(Number(m[1])); return '([\\s\\S]*?)'; } return reEsc(p); }).join('');
      pats.push({ re: new RegExp('^' + src + '$'), order, val: v, weight: key.replace(/\{\d+\}/g, '').length });
    }
    pats.sort((a, b) => b.weight - a.weight); // câu cụ thể hơn thắng
    return { exact, pats, cache: new Map() };
  }
  function create(dicts) {
    const C = {}; for (const l of LANGS) if (l !== 'vi') C[l] = compile(dicts && dicts[l]);
    // dịch MỘT đoạn; null = không có bản dịch
    function trCore(text, lang, depth) {
      const c = C[lang]; if (!c) return null;
      const key = norm(text); if (!key) return null;
      if (c.exact.has(key)) return c.exact.get(key);
      if (!VI.test(key)) return null;
      if (c.cache.has(key)) return c.cache.get(key);
      let out = null;
      for (const p of c.pats) {
        const m = p.re.exec(key); if (!m) continue;
        out = p.val.replace(/\{(\d+)\}/g, (_, n) => { const i = p.order.indexOf(Number(n)); const g = i < 0 ? '' : m[i + 1]; if (!(depth < 2 && VI.test(g))) return g; const w = /^(\s*)([\s\S]*?)(\s*)$/.exec(g); const x = trCore(w[2], lang, depth + 1) ?? (depth < 1 ? trSeg(w[2], lang) : null); return x == null ? g : w[1] + x + w[3]; });
        break;
      }
      if (c.cache.size > 4000) c.cache.clear();
      c.cache.set(key, out); return out;
    }
    // chuỗi ghép (“AIVN · Trò chuyện”, “mô tả\nBấm để tắt.”, “mô hình: 40”): không có khoá cả câu → dịch từng đoạn giữa dấu ngắt dòng / “ · ”,
    // đoạn “Nhãn: giá trị” dịch phần nhãn (có dấu :) và phần giá trị riêng
    function trPiece(p, lang, depth) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p); if (!m[2]) return null;
      let t = trCore(m[2], lang, 0);
      if (t == null) { const lo = m[2][0].toUpperCase() + m[2].slice(1); if (lo !== m[2]) { const x = trCore(lo, lang, 0); if (x != null) t = lang === 'zh' ? x : x[0].toLowerCase() + x.slice(1); } } // “(chạy bằng CPU, khá chậm)” viết thường
      if (t == null) { const x = trCore('· ' + m[2], lang, 0); if (x != null) t = x.replace(/^·\s*/, ''); } // khoá có “· ” đứng đầu
      if (t == null && depth < 2) { const c = /^([\s\S]*?[^.。])([.。])$/.exec(m[2]); if (c) { const x = trPiece(c[1], lang, depth + 1); if (x != null) t = x.trim() + (lang === 'zh' ? '。' : '.'); } } // dấu chấm cuối
      if (t == null && depth < 2) { const c = /^\(([\s\S]+)\)$/.exec(m[2]); if (c) { const x = trPiece(c[1], lang, depth + 1); if (x != null) t = lang === 'zh' ? '（' + x.trim() + '）' : '(' + x.trim() + ')'; } } // “(tự chọn)”
      if (t == null && depth < 2) { const c = /^([\s\S]*?\S)\s*[:：]$/.exec(m[2]); if (c) { const x = trCore(c[1], lang, 0); if (x != null) t = x + (lang === 'zh' ? '：' : ':'); } } // “Bộ xử lý:”
      if (t == null && depth < 2) { const e = /^([^\p{L}\p{N}]+)(\p{L}[\s\S]*)$/u.exec(m[2]); if (e) { const x = trPiece(e[2], lang, depth + 1); if (x != null) t = e[1] + x; } } // “🕒 Ngày giờ”
      if (t == null && depth < 2) { const i = m[2].indexOf(': '); if (i > 0) { const L0 = m[2].slice(0, i); const a0 = trCore(L0, lang, 0); const a = trCore(L0 + ':', lang, 0) ?? (a0 != null ? a0 + (lang === 'zh' ? '：' : ':') : null); const b = trPiece(m[2].slice(i + 2), lang, depth + 1); if (a != null || b != null) { const L = a ?? m[2].slice(0, i + 1); t = L + (/[：:]$/.test(L) && L.endsWith('：') ? '' : ' ') + (b ?? m[2].slice(i + 2)); } } }
      return t == null ? null : m[1] + t + m[3];
    }
    // tách thành đoạn: xuống dòng, “ · ”, “ — ”, “; ”, ranh giới câu, “ (…)” ở cuối; ghép lại đoạn dài nhất có khoá (khoá có thể chứa “;”/“.”)
    const SPLIT = /(\n+|\s·\s|\s—\s|;\s|(?<=[.!?…])\s+(?=[A-ZÀ-ỸĐ“"(])|\s(?=\([^()]*\)$))/u;
    const HAN = /[\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]/;
    function trSeg(s, lang) {
      if (!VI.test(s)) return null;
      const tk = s.split(SPLIT);
      if (tk.length < 3) return trPiece(s, lang, 0);
      const out = []; let hit = false;
      for (let i = 0; i < tk.length; i += 2) {
        let j = -1, t = null;
        for (let k = tk.length - 1; k > i && t == null; k -= 2) { // đoạn ghép dài nhất trước (không ghép qua xuống dòng)
          if (tk.slice(i + 1, k).some((x, n) => n % 2 === 0 && /\n/.test(x))) continue;
          const x = trCore(tk.slice(i, k + 1).join(''), lang, 0); if (x != null) { t = x; j = k; }
        }
        if (t == null) { t = trPiece(tk[i], lang, 0); j = i; }
        if (t != null) hit = true; else t = tk[i];
        out.push(t); if (j + 1 < tk.length) out.push(tk[j + 1]); i = j;
      }
      if (!hit) return null;
      let r = out.join('');
      if (lang === 'zh') r = r.replace(/([\u3000-\u303f\uff00-\uffef])[ \t]+/g, '$1').replace(/[ \t]+(?=[\u3000-\u303f\uff00-\uffef])/g, ''); // không để khoảng trắng sát dấu câu toàn khổ
      return r;
    }
    // giữ khoảng trắng đầu/cuối của nút chữ
    function tr(text, lang) {
      if (!lang || lang === 'vi' || text == null) return text;
      const s = String(text); const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
      let t = /\n/.test(m[2]) ? null : trCore(m[2], lang, 0); // nhiều dòng → giữ ngắt dòng, dịch từng dòng
      if (t == null && /\n/.test(m[2])) { const c = C[lang]; const k = norm(m[2]); if (c && c.exact.has(k)) t = c.exact.get(k); } // nhiều dòng: chỉ nhận khoá trọn vẹn, không để mẫu {n} nuốt cả đoạn
      if (t == null) t = trSeg(m[2], lang);
      return t == null ? s : m[1] + t + m[3];
    }
    // dịch đối tượng tuỳ chọn (menu, hộp thoại, thông báo): label/title/buttonLabel/message/detail/name/buttons/submenu
    function trOpts(o, lang) {
      if (!lang || lang === 'vi' || o == null) return o;
      if (Array.isArray(o)) return o.map(x => trOpts(x, lang));
      if (typeof o !== 'object') return o;
      const r = { ...o };
      for (const k of ['label', 'title', 'buttonLabel', 'message', 'detail', 'name', 'body', 'checkboxLabel', 'nameFieldLabel']) if (typeof r[k] === 'string') r[k] = tr(r[k], lang);
      if (Array.isArray(r.buttons)) r.buttons = r.buttons.map(b => typeof b === 'string' ? tr(b, lang) : b);
      if (Array.isArray(r.submenu)) r.submenu = trOpts(r.submenu, lang);
      if (Array.isArray(r.filters)) r.filters = r.filters.map(f => ({ ...f, name: tr(f.name, lang) }));
      return r;
    }
    return { tr, trOpts, has: (text, lang) => trCore(text, lang, 0) != null || trSeg(String(text), lang) != null };
  }
  // ngôn ngữ mô hình nên trả lời theo ngôn ngữ giao diện (lời nhắc vẫn viết tiếng Việt)
  const REPLY_IN = { vi: 'tiếng Việt', en: 'tiếng Anh (English)', zh: 'tiếng Trung giản thể (简体中文)' };
  const replyDirective = (l) => (l && l !== 'vi' && REPLY_IN[l] ? `Giao diện AIVN của người dùng đang là ${REPLY_IN[l]}: hãy trả lời bằng ${REPLY_IN[l]}, trừ khi người dùng viết bằng ngôn ngữ khác.` : '');
  const api = { create, LANGS, VI, norm, REPLY_IN, replyDirective, LANG_NAMES: { vi: 'Tiếng Việt', en: 'English', zh: '中文（简体）' } };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AIVN_I18N_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
