'use strict';
// B118 / B119 (máy thật beta.2.6): câu trả lời của việc làm trên trình duyệt phải BÁM vào dữ liệu AIVN đã đọc thật.
//  - Đường dẫn: lấy NGUYÊN VĂN từ kết quả công cụ (thanh địa chỉ, trang đã đọc, URL cuối của fetch_url) → nguồn có cấu trúc { url, kind };
//    mọi URL trong câu trả lời phải KHỚP CHÍNH XÁC một nguồn (sai một chữ/dấu “-”/hoa thường ở đường dẫn → thay bằng nguồn gần nhất, hoặc bỏ),
//    link markdown luôn được viết lại thành [nguồn](nguồn) (chữ hiển thị === href).
//  - Con số: mọi số/giá trong câu trả lời phải có trong chữ trang (DOM/chép trang, cây giao diện, OCR) đã đọc; ký hiệu tiền lạ (₽…) bị bỏ.

// ---------- URL ----------
const URL_RE = /\bhttps?:\/\/[^\s<>"'“”)\]]+|\b(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|vn|net|org|info|io|gov|edu|me|app|dev|ai)(?:\.[a-z]{2})?(?:\/[^\s<>"'“”)\]]*)?/giu;
const TRAIL = /[.,;:!?…]+$/u;
const SEARCH_PAGE_RE = /^(?:https?:\/\/)?(?:www\.)?(?:google\.[a-z.]+\/search|bing\.com\/search|coccoc\.com\/search|duckduckgo\.com\/\?|search\.yahoo\.com)/i;
function splitUrl(u) {
  const s = String(u || '').trim().replace(TRAIL, '');
  const m = /^(?:(https?):\/\/)?([^/?#\s]+)(.*)$/i.exec(s); if (!m) return null;
  return { scheme: (m[1] || '').toLowerCase(), host: m[2].toLowerCase().replace(/^www\./, ''), rest: m[3] || '' };
}
// khoá so sánh “chính xác”: bỏ http(s)://, www., dấu / cuối; tên miền không phân biệt hoa thường; ĐƯỜNG DẪN giữ nguyên (hoa thường, dấu “-” đều tính)
function urlKey(u) { const p = splitUrl(u); if (!p) return ''; return p.host + p.rest.replace(/\/+$/, ''); }
const full = (u) => /^https?:\/\//i.test(u) ? u : 'https://' + u;
function lev(a, b) {
  a = String(a); b = String(b); if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
// nguồn gần nhất: cùng tên miền (bỏ www., không phân biệt hoa thường) và khác ít (≤ 25 % độ dài, tối thiểu 3 ký tự)
function nearestSource(u, sources) {
  const k = urlKey(u); if (!k) return null; const p = splitUrl(u);
  let best = null;
  for (const s of sources) {
    const ks = urlKey(s.url); const ps = splitUrl(s.url); if (!ks || !ps) continue;
    if (ks === k) return { src: s, exact: true, d: 0 };
    const hd = lev(p.host, ps.host); if (hd > 2) continue;
    const d = lev(k.toLowerCase(), ks.toLowerCase()) + (k === ks ? 0 : (k.toLowerCase() === ks.toLowerCase() ? 1 : 0));
    if (d <= Math.max(3, Math.round(ks.length * 0.25)) && (!best || d < best.d)) best = { src: s, exact: false, d };
  }
  return best;
}
// thu nguồn từ kết quả công cụ: dòng “"…địa chỉ/address…" = "…"” (cây giao diện), URL cuối của fetch_url/open_url, URL đọc từ thanh địa chỉ (chép)
function sourcesFromMsgs(msgs) {
  const out = [];
  const add = (url, kind) => { const u = String(url || '').trim().replace(TRAIL, ''); if (!u || !splitUrl(u) || !/\./.test(splitUrl(u).host)) return; if (!out.some(x => urlKey(x.url) === urlKey(u))) out.push({ url: u, kind }); };
  for (const m of msgs || []) {
    if (!m || m.role !== 'tool') continue; const c = String(m.content || '');
    for (const line of c.split('\n')) {
      let v;
      if ((v = /"[^"\n]*(?:address|địa chỉ|omnibox|search bar|地址)[^"\n]*"\s*=\s*"([^"\n]+)"/iu.exec(line))) add(v[1], 'address');
      else if ((v = /^(?:URL cuối|Final URL|URL|Địa chỉ trang|Trang)\s*[:：]\s*(https?:\/\/\S+)/iu.exec(line.trim()))) add(v[1], 'fetch');
      else if ((v = /^Thanh địa chỉ \(chép\)\s*[:：]\s*(\S+)/iu.exec(line.trim()))) add(v[1], 'address');
    }
  }
  return out;
}
// sửa URL trong câu trả lời theo nguồn. Trả { text, urls: [{ said, url|null, how }], dropped, replaced }
function fixUrls(text, sources) {
  const src = (sources || []).filter(s => s && s.url && !SEARCH_PAGE_RE.test(s.url));
  const found = []; const hold = [];
  const resolve = (u) => { const n = nearestSource(u, src); return n ? { url: full(n.src.url), how: n.exact ? 'exact' : 'nearest' } : null; };
  let t = String(text || '');
  // 1) link markdown [chữ](href): lấy nguồn khớp với href hoặc chữ hiển thị; viết lại thành [nguồn](nguồn)
  t = t.replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,500})\)/g, (all, label, href) => {
    const lu = (label.match(URL_RE) || [])[0] || null;
    const cands = [href, lu].filter(Boolean);
    let r = null; for (const c of cands) { const x = resolve(c); if (x && x.how === 'exact') { r = x; break; } }
    if (!r) for (const c of cands) { const x = resolve(c); if (x) { r = x; break; } }
    found.push({ said: href, label, url: r ? r.url : null, how: r ? r.how : 'dropped' });
    hold.push(r ? `[${r.url}](${r.url})` : (lu ? '' : label)); return `\u0000${hold.length - 1}\u0000`;
  });
  // 2) URL trần
  t = t.replace(URL_RE, (u0) => {
    const tail = (u0.match(TRAIL) || [''])[0]; const u = u0.slice(0, u0.length - tail.length);
    if (!/[/.]/.test(u) || !/\.[a-z]{2,}/i.test(u)) return u0;
    const r = resolve(u); found.push({ said: u, url: r ? r.url : null, how: r ? r.how : 'dropped' });
    hold.push(r ? r.url : ''); return `\u0000${hold.length - 1}\u0000${tail}`;
  });
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[Number(i)]).replace(/[ \t]+(\n|$)/g, '$1').replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ');
  return { text: t, urls: found, dropped: found.filter(x => !x.url).length, replaced: found.filter(x => x.url && x.how === 'nearest').length };
}

// ---------- Số liệu ----------
const NUM_RE = /(?<![\p{L}\d])\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?(?![\d])|(?<![\p{L}\d.,])\d+(?:[.,]\d+)?(?![\d])/gu;
// các cách hiểu một số: kiểu Việt (. nghìn, , thập phân), kiểu Anh (, nghìn, . thập phân), khoảng trắng nghìn
function numValues(tok) {
  const s = String(tok).replace(/\s/g, ' ').trim(); const out = new Set();
  const grouped = (str, sep) => { const g = str.split(sep); return g.length > 1 && g.slice(1).every(x => x.length === 3) && g[0].length >= 1 && g[0].length <= 3; };
  const tryOne = (thou, dec) => {
    let a = s; let fr = '';
    const di = dec ? a.lastIndexOf(dec) : -1;
    if (di >= 0 && (!thou || a.indexOf(thou) < di || !a.includes(thou))) { fr = a.slice(di + 1); a = a.slice(0, di); if (!/^\d+$/.test(fr)) return; }
    if (thou && a.includes(thou)) { if (!grouped(a, thou)) return; a = a.split(thou).join(''); }
    if (!/^\d+$/.test(a)) return; out.add(Number(a + (fr ? '.' + fr : '')));
  };
  if (/^\d+$/.test(s)) out.add(Number(s));
  tryOne('.', ','); tryOne(',', '.'); tryOne(null, ','); tryOne(null, '.');
  return [...out].filter(Number.isFinite);
}
function numbersIn(text) { const t = String(text || '').replace(URL_RE, ' '); const out = []; for (const m of t.matchAll(NUM_RE)) out.push(m[0].trim()); return out; }
function valueSet(text) { const set = new Set(); for (const tok of numbersIn(text)) for (const v of numValues(tok)) set.add(Math.round(v * 1e6) / 1e6); return set; }
// số trong câu trả lời không thấy trong chữ trang/yêu cầu (bỏ qua số ngày/tháng/năm trong ngày hiện tại)
function ungroundedNumbers(answer, pageText, { query = '', now = new Date() } = {}) {
  const pool = valueSet(`${pageText || ''}\n${query || ''}`);
  const today = new Set([now.getDate(), now.getMonth() + 1, now.getFullYear()]);
  const bad = [];
  for (const tok of numbersIn(answer)) {
    const vs = numValues(tok); if (!vs.length) continue;
    if (vs.some(v => pool.has(Math.round(v * 1e6) / 1e6))) continue;
    if (vs.every(v => today.has(v))) continue;
    if (!bad.includes(tok)) bad.push(tok);
  }
  return bad;
}
// ký hiệu tiền không có trong trang (₽ € £ ¥ ₩ $ …) → bỏ; “₫/đ” chỉ giữ khi trang có
const CUR = /[₽€£¥₩₹₺₴₱฿$]|₫/gu;
function stripStrayCurrency(answer, pageText) {
  const page = String(pageText || ''); const removed = [];
  const t = String(answer || '').replace(/\s?([₽€£¥₩₹₺₴₱฿$₫])/gu, (all, c) => { if (page.includes(c)) return all; removed.push(c); return ''; });
  return { text: t, removed };
}
// nhận định so sánh/nguyên nhân không có trong trang (“thấp hơn do điều kiện địa phương”)
const CLAIM_RE = /(?:cao hơn|thấp hơn|rẻ hơn|đắt hơn|nhiều hơn|ít hơn|tăng|giảm|do điều kiện|vì điều kiện|nguyên nhân|higher|lower|cheaper|because of|due to|更高|更低|因为)/iu;
function unsupportedClaims(answer, pageText) {
  const page = String(pageText || '').toLowerCase(); const out = [];
  for (const sent of String(answer || '').split(/(?<=[.!?。])\s+|\n+/u)) {
    const m = CLAIM_RE.exec(sent); if (!m) continue;
    if (!page.includes(m[0].toLowerCase())) out.push(sent.trim());
  }
  return out.filter(Boolean);
}
// đơn vị của bảng (“LOẠI (NGHÌN ĐỒNG/LƯỢNG)”) để nhắc trong câu trả lời
function unitOf(pageText) { const m = /\(\s*((?:nghìn|ngàn|triệu)\s+đồng\s*\/\s*(?:lượng|chỉ|kg|gram|g))\s*\)/iu.exec(String(pageText || '')) || /((?:nghìn|ngàn|triệu)\s+đồng\s*\/\s*(?:lượng|chỉ))/iu.exec(String(pageText || '')); return m ? m[1].toLowerCase().replace(/\s*\/\s*/, '/') : null; }

module.exports = { URL_RE, splitUrl, urlKey, nearestSource, sourcesFromMsgs, fixUrls, lev, numValues, numbersIn, ungroundedNumbers, stripStrayCurrency, unsupportedClaims, unitOf, SEARCH_PAGE_RE };
