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
  let host = m[2].toLowerCase().replace(/^www\./, ''), rest = m[3] || '';
  // B160: youtu.be/ID ≡ youtube.com/watch?v=ID (cả m.youtube.com) — cùng một trang
  if (host === 'm.youtube.com') host = 'youtube.com';
  if (host === 'youtu.be') { const y = /^\/([\w-]{6,})\/?(?:\?([^#]*))?(#.*)?$/.exec(rest); if (y) { host = 'youtube.com'; rest = '/watch?v=' + y[1] + (y[2] ? '&' + y[2] : '') + (y[3] || ''); } }
  return { scheme: (m[1] || '').toLowerCase(), host, rest };
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
    // video YouTube khác mã là trang khác, không phải gõ sai
    const vid = (x) => (/^youtube\.com\/watch\?v=([\w-]+)/.exec(x) || [])[1]; if ((vid(k) || vid(ks)) && vid(k) !== vid(ks)) continue;
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
const LEADIN = '(?:xem(?:[ \t]+(?:thêm|tại|ở))?|link|liên kết|nguồn|đường dẫn|trang|url|source|sources|see|more|链接|来源|网址)';
const TRACK = /^(?:utm_[a-z]+|fbclid|gclid|gbraid|wbraid|mc_[a-z]+|ref|ref_src|igshid|si|zarsrc|_ga)$/i;
function urlVariants(u) {
  const out = [u]; const add = (x) => { if (x && !out.includes(x)) out.push(x); };
  try { const g = /^(?:https?:\/\/)?(?:www\.)?google\.[a-z.]+\/url\?(.*)$/i.exec(u); if (g) { const q = new URLSearchParams(g[1]); const tgt = q.get('q') || q.get('url'); if (tgt && /^https?:\/\//i.test(tgt)) add(tgt); } } catch {}
  for (const x of out.slice()) { const i = x.indexOf('?'); if (i < 0) continue; const base = x.slice(0, i); const keep = x.slice(i + 1).split('&').filter(kv => kv && !TRACK.test(kv.split('=')[0]));
    add(keep.length ? base + '?' + keep.join('&') : base); add(base); }
  return out;
}
// sửa URL trong câu trả lời theo nguồn. Trả { text, urls: [{ said, url|null, how }], dropped, replaced }
function fixUrls(text, sources) {
  const src = (sources || []).filter(s => s && s.url && !SEARCH_PAGE_RE.test(s.url));
  const found = []; const hold = [];
  // B126: thử cả dạng đã gỡ chuyển hướng Google (/url?q=…), bỏ tham số theo dõi (utm_*, fbclid…), bỏ cả phần ?… — khớp nguồn thì THAY tại chỗ
  const resolve = (u) => { for (const c of urlVariants(u)) { const n = nearestSource(c, src); if (n && (n.exact || c === u)) return { url: full(n.src.url), how: n.exact && c === u ? 'exact' : 'nearest' }; }
    const n = nearestSource(u, src); return n ? { url: full(n.src.url), how: n.exact ? 'exact' : 'nearest' } : null; };
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
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[Number(i)] === '' ? '\u0001' : hold[Number(i)]);
  // B126: URL bị bỏ → bỏ luôn lời dẫn trơ trọi (“Xem:”, “Link:”, “Nguồn:”…) và không để dòng trống
  const LEAD_RE = new RegExp('(?:' + LEADIN + ')[ \\t]*[:：]?[ \\t]*<?\\u0001>?[ \\t]*[.,;。]?', 'giu');
  t = t.split('\n').map(line => {
    if (!line.includes('\u0001')) return line;
    // B160: mọi lời dẫn ngắn “…:” ngay trước URL bị bỏ (“More info:”, “Bạn xem chi tiết tại đây:”, “Video:”), tính từ đầu dòng/đầu câu, ≤ 7 từ, không chứa số;
    // dài hơn hoặc có số (dữ kiện) thì giữ chữ, chỉ bỏ dấu “:”
    const x = line.replace(LEAD_RE, '').replace(/(^|[.!?。！？]\s*)([^.!?。！？:：\n]*?)[ \t]*[:：][ \t]*<?\u0001>?[ \t]*[.,;。]?/gu,
      (all, pre, lead) => (!/\d/.test(lead) && lead.trim().split(/\s+/).filter(Boolean).length <= 7) ? pre : pre + lead).replace(/<?\u0001>?/g, '');
    return /^[\s\-*•:：]*$/u.test(x) ? null : x;
  }).filter(l => l !== null).join('\n');
  t = t.replace(/[ \t]+(\n|$)/g, '$1').replace(/\(\s*\)/g, '').replace(/<\s*>/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\s*\n/, '');
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
// B125: hệ số theo chữ đứng ngay sau số (139,3 triệu · 139.300 nghìn · 5k · 2,5 tỷ · 3 million · 13万 · 1.2亿); chữ Hán không cần ranh giới từ
const SCALE_WORDS = [[/^\s*(?:nghìn|ngàn|nghin|ngan|thousand|thousands|k|K)(?![\p{L}\d])/u, 1e3], [/^\s*(?:triệu|trieu|tr\.?|million|millions|mn|M)(?![\p{L}\d])/u, 1e6],
  [/^\s*(?:tỷ|tỉ|ty|billion|billions|bn|B)(?![\p{L}\d])/u, 1e9], [/^\s*百万/u, 1e6], [/^\s*十亿/u, 1e9], [/^\s*千/u, 1e3], [/^\s*万/u, 1e4], [/^\s*亿/u, 1e8]];
function scaleAfter(rest) { for (const [re, k] of SCALE_WORDS) if (re.test(rest)) return k; return 1; }
function numbersWithScale(text) { const t = String(text || '').replace(URL_RE, ' '); const out = []; for (const m of t.matchAll(NUM_RE)) out.push({ tok: m[0].trim(), scale: scaleAfter(t.slice(m.index + m[0].length, m.index + m[0].length + 12)) }); return out; }
// đơn vị cả bảng (“(nghìn đồng/lượng)”, “Đơn vị: triệu đồng”, “(thousand VND)”, “单位：千元”) → hệ số cho các số trần trên trang
function pageScale(text) {
  const t = String(text || '');
  const m = /(?:\(|đơn vị\s*:?\s*|unit\s*:?\s*|单位\s*[:：]?\s*)\s*(nghìn|ngàn|triệu|tỷ|tỉ|thousand|million|billion|千|万|百万|亿)\s*(?:đồng|vnd|vnđ|đ|元|dong)/iu.exec(t);
  if (!m) return 1; const w = m[1].toLowerCase(); return { 'nghìn': 1e3, 'ngàn': 1e3, 'thousand': 1e3, '千': 1e3, 'triệu': 1e6, 'million': 1e6, '百万': 1e6, 'tỷ': 1e9, 'tỉ': 1e9, 'billion': 1e9, '万': 1e4, '亿': 1e8 }[w] || 1;
}
const vkey = (v) => Math.round(v * 1e3) / 1e3;
// B159 (QA box beta.2.8): “139.300 triệu” và “139.300 đồng” từng “khớp” trang “139,300 nghìn đồng” vì 139.300 được hiểu cả là 139,3 (thập phân kiểu Anh).
// Số viết theo nhóm 3 chữ số (139.300 · 1,200 · 139.300.000) đi kèm hệ số hoặc đơn vị tiền → chỉ hiểu là số nguyên có dấu phân cách nghìn
// (không ai viết “139.300 triệu” để nói 139,3 triệu); 139,3 triệu · 1.2B · 3,5 tỷ (không đủ nhóm 3) vẫn là thập phân.
const GROUPED = /^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*$/;
// chỉ áp cho chữ hệ số TIẾNG VIỆT và đơn vị tiền Việt (ở đó “.” là dấu nghìn); 1.393亿 · 139.3 million vẫn đọc thập phân như cũ
const VI_SCALE = /^\s*(?:nghìn|ngàn|nghin|ngan|triệu|trieu|tr\.?|tỷ|tỉ|ty)(?![\p{L}\d])/u;
const VI_CUR = /^\s*(?:đồng|dong|vnđ|vnd|đ|₫)(?![\p{L}\d])/iu;
const scaledValues = (tok, vi = true) => vi && GROUPED.test(tok) ? [Number(tok.replace(/[.,]/g, ''))] : numValues(tok);
// đơn vị tiền ngay sau số (không có chữ hệ số): câu trả lời “139.300 đồng” phải khớp GIÁ TRỊ THẬT trên trang, không chỉ dãy chữ số
const CUR_AFTER = /^\s*(?:đồng|dong|vnđ|vnd|đ|₫|元|yuan)(?![\p{L}\d])/iu;
function numbersWithUnit(text) { const t = String(text || '').replace(URL_RE, ' '); const out = []; for (const m of t.matchAll(NUM_RE)) { const rest = t.slice(m.index + m[0].length, m.index + m[0].length + 12); out.push({ tok: m[0].trim(), scale: scaleAfter(rest), cur: CUR_AFTER.test(rest), vi: VI_SCALE.test(rest) || VI_CUR.test(rest) }); } return out; }
// raw: mọi cách đọc dãy chữ số (B119: số trần trong câu trả lời khớp chữ trên trang); real: giá trị thật sau hệ số của chính số đó hoặc đơn vị cả bảng
function valueSets(text) {
  const raw = new Set(), real = new Set(); const ps = pageScale(text);
  const vps = /(?:nghìn|ngàn|triệu|tỷ|tỉ)\s*(?:đồng|vnd|vnđ|đ|dong)/iu.test(String(text || '')); // đơn vị cả bảng là tiếng Việt
  for (const { tok, scale, cur, vi } of numbersWithUnit(text)) {
    for (const v of numValues(tok)) raw.add(vkey(v));
    if (scale !== 1) for (const v of scaledValues(tok, vi)) real.add(vkey(v * scale));
    else if (ps !== 1 && !cur) { for (const v of scaledValues(tok, vps)) real.add(vkey(v * ps)); }
    else for (const v of (cur ? scaledValues(tok, vi) : numValues(tok))) real.add(vkey(v));
  }
  return { raw, real };
}
function valueSet(text) { const { raw, real } = valueSets(text); return new Set([...raw, ...real]); }
// số trong câu trả lời không thấy trong chữ trang/yêu cầu (bỏ qua số ngày/tháng/năm trong ngày hiện tại)
function ungroundedNumbers(answer, pageText, { query = '', now = new Date() } = {}) {
  const { raw, real } = valueSets(`${pageText || ''}\n${query || ''}`);
  const today = new Set([now.getDate(), now.getMonth() + 1, now.getFullYear()]);
  const bad = [];
  for (const { tok, scale, cur, vi } of numbersWithUnit(answer)) {
    const vs = numValues(tok); if (!vs.length) continue;
    // có chữ hệ số (“139,3 triệu”) → so GIÁ TRỊ THẬT; có đơn vị tiền (“139.300 đồng”) → so giá trị thật; số trần → so cả dãy chữ số (B119)
    const ok = scale !== 1 ? scaledValues(tok, vi).some(v => real.has(vkey(v * scale)))
      : cur ? scaledValues(tok, vi).some(v => real.has(vkey(v)))
      : vs.some(v => raw.has(vkey(v)) || real.has(vkey(v)));
    if (ok) continue;
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

module.exports = { pageScale, numbersWithScale, numbersWithUnit, valueSet, valueSets, scaledValues, URL_RE, splitUrl, urlKey, nearestSource, sourcesFromMsgs, fixUrls, lev, numValues, numbersIn, ungroundedNumbers, stripStrayCurrency, unsupportedClaims, unitOf, SEARCH_PAGE_RE };
