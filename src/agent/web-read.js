'use strict';
// B155 (máy thật beta.2.7, laptop 4 GB VRAM, Qwen3-VL 4B): mô hình nhỏ mở Chrome rồi nói “không có công cụ đọc trang / fetch_url”.
// Việc “tìm X rồi cho tôi biết” trên trình duyệt: AIVN TỰ đọc trang (bằng mã, không nhờ mô hình) rồi đưa chữ trang cho mô hình:
//   bảo đảm trình duyệt → đọc trang đang mở (chữ trang + thanh địa chỉ) → chưa có trang thì tìm → trang kết quả tìm kiếm thì ĐI TỚI TRANG NGUỒN
//   (vd. sjc.com.vn) → chữ trang ít thì tải lại địa chỉ cuối (fetch) → vẫn ít thì OCR màn hình.
// Lõi thuần: mọi thao tác máy/mạng qua `io` để kiểm thử bằng kịch bản.
const BP = require('./browser-profile');
const fold = BP.fold;

const SEARCH_URL_RE = /^(?:https?:\/\/)?(?:www\.)?(?:google\.[a-z.]+\/(?:search|webhp|\?|#|$)|google\.[a-z.]+\/?$|bing\.com\/search|duckduckgo\.com\/(?:\?|html)|search\.yahoo\.com|coccoc\.com\/search|search\.brave\.com)/i;
const BLANK_URL_RE = /^(?:about:blank|chrome:\/\/newtab|edge:\/\/newtab|chrome-search:|about:newtab|coccoc:\/\/newtab)?$/i;
const isSearchUrl = (u) => SEARCH_URL_RE.test(String(u || '').trim());
const isBlankUrl = (u) => BLANK_URL_RE.test(String(u || '').trim()) || /^(?:chrome|edge|about|coccoc|brave):/i.test(String(u || '').trim());

// việc “tìm/xem X trên trình duyệt rồi cho biết” (không phải nhắn tin, tải tệp, mua bán, đăng bài)
const INFO_RE = /(?:^|[\s,.:(])(?:tìm|tìm kiếm|tra|tra cứu|xem|cho (?:tôi|mình|em|tớ|anh|chị) biết|báo (?:tôi|mình|em)|bao nhiêu|là gì|giá|tỷ giá|tỉ giá|thời tiết|tin tức|kết quả|lịch|find|look up|search|tell me|what(?:'s| is)|how much|price|weather|news)(?![\p{L}])|查|多少|告诉我|价格|天气/iu;
const NOT_INFO_RE = /(?:^|[\s,.:(])(?:gửi|nhắn|soạn|đăng(?! nhập)|tải về|tải xuống|download|mua hàng|mua vé|đặt mua|đặt hàng|thanh toán|send|post|buy (?:a|the|it|this)|place an order|checkout|xoá|xóa|delete)(?![\p{L}])|发送|购买|删除/iu;
const BROWSER_RE = /(?:google chrome|chrome|edge|firefox|cốc cốc|coc coc|brave|opera|trình duyệt|browser|浏览器)/iu;
function webInfoTask(query) { const q = String(query || ''); return BROWSER_RE.test(q) && INFO_RE.test(q) && !NOT_INFO_RE.test(q); }

// cụm cần tìm: sau động từ tìm, bỏ phần “rồi cho tôi biết…”; bỏ “mở chrome/trên chrome”
function searchTerms(query) {
  let q = String(query || '').replace(/["“”]/g, ' ');
  const quoted = /["“]([^"”]{2,120})["”]/.exec(String(query || '')); if (quoted) return quoted[1].trim();
  q = q.replace(/(?:^|\s)(?:hãy|giúp (?:tôi|mình|em)|làm ơn|please|bạn)(?=\s)/giu, ' ');
  q = q.replace(/(?:^|[\s,])(?:mở|dùng|trên|bằng|vào|vô|open|use|in|on|with)\s+(?:trình duyệt\s+)?(?:google chrome|chrome|microsoft edge|edge|firefox|cốc cốc|coc coc|brave|opera|trình duyệt|the browser|browser)(?![\p{L}])/giu, ' ');
  const m = /(?:^|[\s,.:])(?:tìm kiếm|tìm|tra cứu|tra|xem|search(?: for)?|look up|find|google|查一下|查找|搜索)\s+(.+)$/iu.exec(q); if (m) q = m[1];
  q = q.split(/(?:[,.;]|\s)(?:rồi|sau đó|xong|và (?:cho|báo|nói)|cho (?:tôi|mình|em|tớ) biết|báo (?:tôi|mình|em|lại)|then|and tell|and let me know|tell me|告诉)(?![\p{L}])/iu)[0];
  q = q.replace(/\s+(?:giúp (?:tôi|mình|em)|nhé|nha|đi|với)\s*$/iu, '').replace(/\s+/g, ' ').trim();
  return q.slice(0, 120) || String(query || '').slice(0, 120);
}
const STOP = new Set(['the', 'and', 'for', 'hom', 'nay', 'cho', 'toi', 'minh', 'biet', 'cua', 'nhung', 'mot', 'cac', 'nao', 'bao', 'nhieu', 'tren', 'trong', 'with', 'what', 'today', 'how', 'much', 'www', 'com', 'http', 'https', 'html']);
function tokensOf(q) { return fold(q).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w)); }
const SKIP_HOST = /(?:^|\.)(?:google\.[a-z.]+|gstatic\.com|googleusercontent\.com|googleapis\.com|youtube\.com|youtu\.be|facebook\.com|fb\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|bing\.com|duckduckgo\.com|schema\.org|w3\.org)$/i;
const HOST_RE = /\b(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:vn|com|net|org|gov|edu|info|io|co|biz|asia|me)(?:\.[a-z]{2})?)((?:\/[^\s"'<>›»|)]*)?)/gi;
// trang nguồn để đọc thay cho trang kết quả tìm kiếm: tên miền xuất hiện trên trang kết quả / trong kết quả tìm, trùng chữ của câu hỏi (vd. “sjc” → sjc.com.vn)
function pickSource({ pageText = '', query = '', results = [] } = {}) {
  const toks = tokensOf(query); const pairs = [];
  const brands = new Set((String(query || '').match(/\b[A-Z][A-Z0-9]{1,}[a-z]*\b|\b[a-z]*[A-Z]{2,}[A-Za-z0-9]*\b/g) || []).map(w => fold(w)).filter(w => w.length >= 2)); // SJC, PNJ, DOJI, VnExpress… for (let i = 0; i + 1 < toks.length; i++) pairs.push(toks[i] + toks[i + 1]);
  const cand = new Map();
  const add = (host, url, base, pos) => {
    host = String(host || '').toLowerCase().replace(/^www\./, ''); if (!host || SKIP_HOST.test(host)) return;
    const hk = host.replace(/[^a-z0-9]/g, ''); let sc = base;
    for (const t of toks) if (hk.includes(t)) sc += t.length >= 4 || /\d/.test(t) ? 4 : 3;
    for (const p of pairs) if (hk.includes(p)) sc += 3;
    for (const br of brands) if (hk.startsWith(br) || host.split('.').includes(br)) sc += 8; // tên riêng viết hoa trong câu hỏi = trang chính chủ
    sc -= Math.min(2, pos / 4000);
    const c = cand.get(host); if (!c || sc > c.score) cand.set(host, { host, url: url || 'https://' + host + '/', score: c ? Math.max(c.score, sc) + 0.5 : sc });
  };
  let m; HOST_RE.lastIndex = 0; const t = String(pageText || '');
  while ((m = HOST_RE.exec(t))) { const path = m[2] && m[2].length > 1 && !/[›»]/.test(m[2]) ? m[2] : '/'; add(m[1], `https://${m[1].toLowerCase()}${path}`, 1, m.index); }
  (results || []).forEach((r, i) => { try { const u = new URL(r.url); add(u.hostname, u.href, 1.5 - i * 0.2, 0); } catch {} });
  const best = [...cand.values()].sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 2 ? best : null;
}
// trích dòng của trang liên quan tới câu hỏi (dòng có số / chữ trùng câu hỏi) — dùng khi mô hình vẫn không trả lời
function excerpt(text, query, max = 8) {
  const toks = new Set(tokensOf(query)); const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length >= 3 && l.length <= 240);
  const sc = (l) => { const f = fold(l).split(/[^a-z0-9]+/); return f.filter(w => toks.has(w)).length * 2 + (/\d[\d.,]{2,}/.test(l) ? 2 : 0); };
  const seen = new Set();
  return lines.map((l, i) => ({ l, i, s: sc(l) })).filter(x => x.s >= 3).sort((a, b) => b.s - a.s || a.i - b.i).filter(x => { const k = fold(x.l); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max).sort((a, b) => a.i - b.i).map(x => x.l);
}
// mô hình nói không có công cụ / không đọc được trang / không truy cập được web
const NO_TOOL_RE = /(?:không|chưa|ko)\s+(?:có|được trang bị|thể dùng|có quyền dùng|hỗ trợ)\s+(?:công cụ|chức năng|khả năng)[^.]{0,60}(?:đọc|truy cập|fetch|tải|duyệt|xem|web|trang|màn hình)|(?:không|chưa)\s+(?:thể|đọc được|xem được|truy cập được)[^.]{0,40}(?:nội dung )?(?:trang|web|màn hình|internet|mạng)|fetch_url|(?:don'?t|do not|cannot|can'?t)\s+(?:have\s+)?(?:access|a tool|tools?|the ability)[^.]{0,60}(?:web|page|browse|screen|internet)|没有(?:工具|权限)|无法(?:访问|读取)/iu;

const googleUrl = (terms) => 'https://www.google.com/search?q=' + encodeURIComponent(terms).replace(/%20/g, '+');

async function autoRead({ query, browser }, io) {
  const log = io.log || (() => {}); const sleep = io.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const b = browser || BP.browserOf(query) || BP.byId('chrome'); const terms = searchTerms(query); const trail = [];
  const e = await io.ensure(b); if (!e || !e.ok) return { ok: false, error: (e && e.error) || `chưa mở được ${b.name}`, trail };
  trail.push(`${b.name} sẵn sàng`);
  let p = await io.read(); trail.push(p && p.url ? `đọc trang đang mở: ${p.url}` : 'chưa đọc được trang đang mở');
  let searchPage = null;
  if (!p || !p.url || isBlankUrl(p.url)) {
    const g = googleUrl(terms); trail.push(`chưa có trang → tìm “${terms}”`); log(`B155: chưa có trang → tìm “${terms}” trong ${b.name}`);
    await io.navigate(g, b); await sleep(io.waitMs || 3500); p = await io.read(); if (!p || !p.url) p = { url: g, text: (p && p.text) || '', title: '' };
  }
  if (isSearchUrl(p.url)) {
    searchPage = p; let results = []; try { results = io.search ? (await io.search(terms)) || [] : []; } catch {}
    const src = pickSource({ pageText: p.text, query: terms, results });
    if (src) {
      trail.push(`trang kết quả tìm kiếm → đi tới trang nguồn ${src.host}`); log(`B155: trang kết quả tìm kiếm → trang nguồn ${src.url}`);
      await io.navigate(src.url, b); await sleep(io.waitMs || 3500); const p2 = await io.read();
      p = p2 && p2.url && !isSearchUrl(p2.url) ? p2 : { url: src.url, text: '', title: '' };
    } else trail.push('không chọn được trang nguồn → đọc trang kết quả');
  }
  let text = String(p.text || ''), url = p.url, title = p.title || '', via = 'page';
  if (text.replace(/\s+/g, '').length < 300 && url && !isSearchUrl(url) && io.fetch) {
    try { const f = await io.fetch(url); if (f && String(f.text || '').length > text.length) { text = f.text; url = f.url || url; title = f.title || title; via = 'fetch'; trail.push(`tải lại địa chỉ cuối ${url}`); } } catch (er) { trail.push('tải lại địa chỉ lỗi: ' + String(er.message || er).slice(0, 60)); }
  }
  if (text.replace(/\s+/g, '').length < 120 && io.ocr) { try { const o = await io.ocr(); if (o && o.length > text.length) { text = o; via = 'ocr'; trail.push('đọc chữ trên màn hình (OCR)'); } } catch {} }
  if (!text.trim() && searchPage && searchPage.text) { text = searchPage.text; url = searchPage.url; via = 'search-page'; }
  return { ok: !!text.trim(), url, title, text: text.slice(0, 20000), via, searchUrl: searchPage ? searchPage.url : null, browser: b.name, terms, trail };
}
module.exports = { autoRead, webInfoTask, searchTerms, pickSource, excerpt, isSearchUrl, isBlankUrl, NO_TOOL_RE, googleUrl, tokensOf };
