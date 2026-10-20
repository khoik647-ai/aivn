// Truy cập mạng cho Trợ lý (chỉ khi người dùng bật "Cho phép truy cập mạng").
// Tìm kiếm: DuckDuckGo bản HTML (không cần khoá), dự phòng Wikipedia API. Đọc trang: chỉ http/https công khai,
// chặn địa chỉ nội bộ (localhost, mạng LAN…) ở mọi bước chuyển hướng, giới hạn dung lượng và thời gian.
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 AIVN-TroLy';
const MAX_BYTES = 3 * 1024 * 1024;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bull: '•', middot: '·', deg: '°', times: '×', divide: '÷', euro: '€' };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
  return ENT[e.toLowerCase()] ?? m;
});
const strip = (s) => decode(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function htmlToText(html) {
  let h = String(html);
  const title = strip((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  h = h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form)[\s\S]*?<\/\1>/gi, ' ');
  const main = h.match(/<(main|article)[\s\S]*?<\/\1>/i); if (main && main[0].length > 1500) h = main[0];
  h = h.replace(/<(br|hr)\s*\/?>/gi, '\n').replace(/<\/(p|div|section|article|li|tr|h[1-6]|ul|ol|table|blockquote|pre|dd|dt)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<(td|th)[^>]*>/gi, ' | ');
  const text = decode(h.replace(/<[^>]+>/g, ' ')).replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text };
}

// ---- Chặn địa chỉ nội bộ ----
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}
async function assertPublic(u) {
  let url;
  try { url = new URL(u); } catch { throw new Error('Địa chỉ web không hợp lệ'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Chỉ mở được địa chỉ http/https');
  if (url.username || url.password) throw new Error('Không mở địa chỉ có kèm tài khoản/mật khẩu');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.localhost|.*\.internal)$/i.test(host)) throw new Error('Không được mở địa chỉ nội bộ');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error(`Không tìm thấy máy chủ "${host}"`); });
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Error('Không được mở địa chỉ nội bộ (localhost/mạng LAN)');
  return url;
}

async function getText(u, { signal, accept = 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5', method = 'GET', body = null, timeoutMs = 15000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort(); signal?.addEventListener('abort', onAbort);
  try {
    let url = await assertPublic(u);
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(url, { method, body, redirect: 'manual', signal: ac.signal,
        headers: { 'user-agent': UA, accept, 'accept-language': 'vi-VN,vi;q=0.9,en;q=0.7', ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = await assertPublic(new URL(res.headers.get('location'), url).href); method = 'GET'; body = null; continue; }
      if (!res.ok) throw new Error(`Trang trả về lỗi HTTP ${res.status}`);
      const type = res.headers.get('content-type') || '';
      if (!/text\/|json|xml|javascript/i.test(type)) throw new Error(`Không đọc được loại nội dung "${type.split(';')[0] || 'không rõ'}" (chỉ đọc trang chữ/HTML)`);
      const chunks = []; let size = 0;
      for await (const c of res.body) { size += c.length; if (size > MAX_BYTES) break; chunks.push(c); }
      const buf = Buffer.concat(chunks);
      const cs = (type.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
      let text; try { text = new TextDecoder(cs).decode(buf); } catch { text = buf.toString('utf8'); }
      return { url: url.href, type, text, truncatedBytes: size > MAX_BYTES };
    }
    throw new Error('Trang chuyển hướng quá nhiều lần');
  } catch (e) {
    if (signal?.aborted) throw new Error('Đã dừng theo yêu cầu');
    if (e.name === 'AbortError') throw new Error(`Trang phản hồi quá chậm (quá ${timeoutMs / 1000} giây)`);
    throw e;
  } finally { clearTimeout(t); signal?.removeEventListener('abort', onAbort); }
}

function parseDdg(html, limit) {
  const out = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b/).slice(1);
  for (const b of blocks) {
    if (/result--ad/.test(b.slice(0, 200))) continue;
    const a = b.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let href = decode(a[1]);
    const ud = href.match(/[?&]uddg=([^&]+)/); if (ud) href = decodeURIComponent(ud[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    const sn = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(a|div|td)>/);
    out.push({ title: strip(a[2]), url: href, snippet: sn ? strip(sn[1]).slice(0, 400) : '' });
    if (out.length >= limit) break;
  }
  return out;
}

async function wikipedia(query, lang, limit, signal) {
  const api = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
  const r = await getText(api, { signal, accept: 'application/json' });
  const j = JSON.parse(r.text);
  return (j.query?.search || []).map(x => ({ title: x.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`, snippet: strip(x.snippet).slice(0, 400) }));
}

async function search(query, { limit = 5, signal } = {}) {
  query = String(query || '').trim().slice(0, 300);
  if (!query) throw new Error('Thiếu nội dung cần tìm');
  const opened = [];
  let results = [], source = 'DuckDuckGo', note = null;
  try {
    const u = 'https://html.duckduckgo.com/html/';
    opened.push(u);
    const r = await getText(u, { signal, method: 'POST', body: new URLSearchParams({ q: query, kl: 'vn-vi' }).toString() });
    results = parseDdg(r.text, limit);
    if (!results.length) note = 'DuckDuckGo không trả kết quả';
  } catch (e) { if (signal?.aborted) throw e; note = 'DuckDuckGo lỗi: ' + e.message; }
  if (!results.length) {
    source = 'Wikipedia';
    for (const lang of ['vi', 'en']) {
      opened.push(`https://${lang}.wikipedia.org/w/api.php`);
      try { results = await wikipedia(query, lang, limit, signal); } catch (e) { if (signal?.aborted) throw e; }
      if (results.length) break;
    }
  }
  return { source, query, results, note, opened };
}

async function fetchPage(url, { maxChars = 6000, signal } = {}) {
  const r = await getText(url, { signal });
  let title = '', text = r.text;
  if (/html|xml/i.test(r.type)) ({ title, text } = htmlToText(r.text));
  const total = text.length;
  return { url: r.url, title, text: text.slice(0, maxChars), chars: total, truncated: total > maxChars || r.truncatedBytes };
}

module.exports = { search, fetchPage, htmlToText, privateIp, assertPublic };
