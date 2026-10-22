#!/usr/bin/env node
'use strict';
// Đổi docs/verified.md (+ verified.en.md, verified.zh.md) thành trang web tĩnh (dist/site/verified.html) để nhãn “✓ Đã kiểm chứng” trong Khám phá luôn mở được
// (QA B8: liên kết tới nhánh main bị 404 trước khi phát hành). Markdown tối giản: tiêu đề, đoạn, danh sách, bảng, mã, liên kết, <a id>.
const fs = require('fs');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:[^)\s]+|#[^)\s]+)\)/g, '<a href="$2">$1</a>');
function render(md, opt = {}) {
  // opt.aid: mỏ neo của khối ngôn ngữ phụ ghi data-aid (không ghi id) để trang không trùng id; script chuyển id sang khối đang hiện
  const anchor = (id) => opt.aid ? `<a data-aid="${id}"></a>` : `<a id="${id}"></a>`;
  const L = md.replace(/\r/g, '').split('\n'); const o = []; let i = 0;
  while (i < L.length) {
    const l = L[i];
    const a = l.match(/^<a id="([\w-]+)"><\/a>\s*$/); if (a) { o.push(anchor(a[1])); i++; continue; }
    if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; o.push(`<pre><code>${esc(b.join('\n'))}</code></pre>`); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/); if (h) { o.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\|/.test(l)) { const rows = []; while (i < L.length && /^\|/.test(L[i])) rows.push(L[i++]); const cells = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|?[\s:|-]+$/.test(r))); o.push('<table>' + body.map((r, k) => `<tr>${cells(r).map(c => k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</table>'); continue; }
    if (/^\s*[-*]\s+/.test(l)) { const it = []; while (i < L.length && /^\s*[-*]\s+/.test(L[i])) it.push(L[i++].replace(/^\s*[-*]\s+/, '')); o.push('<ul>' + it.map(x => `<li>${inline(x)}</li>`).join('') + '</ul>'); continue; }
    if (/^\d+\.\s+/.test(l)) { const it = []; while (i < L.length && /^\d+\.\s+/.test(L[i])) it.push(L[i++].replace(/^\d+\.\s+/, '')); o.push('<ol>' + it.map(x => `<li>${inline(x)}</li>`).join('') + '</ol>'); continue; }
    if (!l.trim()) { i++; continue; }
    const p = []; while (i < L.length && L[i].trim() && !/^(#|\||```|\s*[-*]\s|\d+\.\s|<a id=)/.test(L[i])) p.push(L[i++]); o.push(`<p>${inline(p.join(' ').replace(/^\\\*/, '*'))}</p>`);
  }
  return o.join('\n');
}
// Trang ba thứ tiếng như trang chủ: nút VI/EN/中文, khoá localStorage 'aivn-lang' dùng chung với trang chủ, ?lang=vi|en|zh, mặc định theo ngôn ngữ trình duyệt.
// Bản dịch nằm cạnh tệp nguồn: verified.md → verified.en.md, verified.zh.md (cùng mỏ neo). Thiếu bản dịch thì trang chỉ có tiếng Việt.
const LANGS = [
  { code: 'vi', html: 'vi', label: 'VI', name: 'Tiếng Việt', title: 'AIVN — Kết quả tự kiểm chứng' },
  { code: 'en', html: 'en', label: 'EN', name: 'English', title: 'AIVN — Self-verification results' },
  { code: 'zh', html: 'zh-CN', label: '中文', name: '简体中文', title: 'AIVN — 自行验证结果' },
];
function sources(src) { return LANGS.map(l => ({ ...l, file: l.code === 'vi' ? src : src.replace(/\.md$/, `.${l.code}.md`) })).filter(l => l.code === 'vi' || fs.existsSync(l.file)); }
const CSS = 'body{font:15px/1.6 system-ui,"Segoe UI",Roboto,"Noto Sans","Microsoft YaHei","PingFang SC",sans-serif;max-width:920px;margin:0 auto;padding:24px;color:#1c2330}h1,h2,h3{line-height:1.3}h2{margin-top:2em;border-top:1px solid #e3e6ec;padding-top:1em}table{border-collapse:collapse;width:100%;font-size:14px;margin:10px 0}th,td{border:1px solid #d9dde5;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f3f5f9}code{background:#f1f3f7;padding:1px 4px;border-radius:4px}pre{background:#f1f3f7;padding:10px;overflow:auto}a{color:#1d5fd1}'
  + '.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}'
  + '.lang{display:inline-flex;border:1px solid #d6c9cb;border-radius:999px;padding:2px;gap:2px;background:#fff}'
  + '.lang button{font:inherit;font-size:.78rem;font-weight:600;line-height:1;border:0;background:transparent;color:#5c6370;padding:6px 9px;border-radius:999px;cursor:pointer;min-width:34px}'
  + '.lang button:hover{color:#1f2328}.lang button[aria-pressed="true"]{background:#D7263D;color:#fff}.lang button:focus-visible{outline:2px solid #D7263D;outline-offset:2px}'
  + 'td,th{overflow-wrap:anywhere}td code{word-break:break-word}[hidden]{display:none!important}@media (max-width:520px){body{padding:16px}table{font-size:13px}th,td{padding:5px 6px}}';
const SCRIPT = `(function(){var KEY='aivn-lang',T=__TITLES__;
var B=[].slice.call(document.querySelectorAll('[data-lang-block]'));
B.forEach(function(b){[].forEach.call(b.querySelectorAll('a[id]'),function(a){a.setAttribute('data-aid',a.id);});});
function has(l){return B.some(function(b){return b.getAttribute('data-lang-block')===l;});}
function pick(){
  var q=(location.search.match(/[?&]lang=(vi|en|zh)(?![a-z])/)||[])[1]; if(q){try{localStorage.setItem(KEY,q);}catch(e){}return q;}
  try{var s=localStorage.getItem(KEY);if(has(s))return s;}catch(e){}
  var l=((navigator.languages&&navigator.languages[0])||navigator.language||'vi').toLowerCase();
  return l.indexOf('zh')===0?'zh':l.indexOf('en')===0?'en':'vi';
}
function go(){var h=decodeURIComponent(location.hash.slice(1));var t=h&&document.getElementById(h);if(t)t.scrollIntoView();}
function apply(l){
  if(!has(l))l='vi';
  B.forEach(function(b){var on=b.getAttribute('data-lang-block')===l;b.hidden=!on;
    [].forEach.call(b.querySelectorAll('a[data-aid]'),function(a){if(on)a.id=a.getAttribute('data-aid');else a.removeAttribute('id');});});
  document.documentElement.lang=l==='zh'?'zh-CN':l; document.title=T[l]||T.vi;
  [].forEach.call(document.querySelectorAll('.lang button'),function(b){b.setAttribute('aria-pressed',b.getAttribute('data-lang')===l);});
  window.__lang=l;
}
[].forEach.call(document.querySelectorAll('.lang button'),function(b){b.addEventListener('click',function(){var l=b.getAttribute('data-lang');try{localStorage.setItem(KEY,l);}catch(e){}apply(l);go();});});
window.addEventListener('hashchange',go);
apply(pick()); go();
})();`;
function page(src, title) {
  const ls = sources(src); const multi = ls.length > 1;
  if (title) ls[0].title = title;
  const blocks = ls.map((l, k) => `<main data-lang-block="${l.code}" lang="${l.html}"${k ? ' hidden' : ''}>\n${render(fs.readFileSync(l.file, 'utf8'), { aid: k > 0 })}\n</main>`).join('\n');
  const sw = multi ? `<div class="lang" role="group" aria-label="Ngôn ngữ · Language · 语言">${ls.map(l => `<button type="button" data-lang="${l.code}" lang="${l.html}" title="${l.name}" aria-pressed="${l.code === 'vi'}">${l.label}</button>`).join('')}</div>` : '';
  const titles = JSON.stringify(Object.fromEntries(ls.map(l => [l.code, l.title])));
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ls[0].title)}</title>
<link rel="icon" href="favicon.svg"><style>${CSS}</style></head>
<body><div class="top"><p><a href="./">← AIVN</a></p>${sw}</div>
${blocks}
${multi ? `<script>${SCRIPT.replace('__TITLES__', titles.replace(/</g, '\\u003c'))}</script>\n` : ''}</body></html>
`;
}
if (require.main === module) { const [src, out, title] = process.argv.slice(2); const html = page(src, title); if (out) fs.writeFileSync(out, html); else process.stdout.write(html); }
module.exports = { render, page, sources, LANGS };
