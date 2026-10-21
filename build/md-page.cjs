#!/usr/bin/env node
'use strict';
// Đổi docs/verified.md thành trang web tĩnh (dist/site/verified.html) để nhãn “✓ Đã kiểm chứng” trong Kho mô hình luôn mở được
// (QA B8: liên kết tới nhánh main bị 404 trước khi phát hành). Markdown tối giản: tiêu đề, đoạn, danh sách, bảng, mã, liên kết, <a id>.
const fs = require('fs');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:[^)\s]+|#[^)\s]+)\)/g, '<a href="$2">$1</a>');
function render(md) {
  const L = md.replace(/\r/g, '').split('\n'); const o = []; let i = 0;
  while (i < L.length) {
    const l = L[i];
    if (/^<a id="[\w-]+"><\/a>\s*$/.test(l)) { o.push(l.trim()); i++; continue; }
    if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; o.push(`<pre><code>${esc(b.join('\n'))}</code></pre>`); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/); if (h) { o.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\|/.test(l)) { const rows = []; while (i < L.length && /^\|/.test(L[i])) rows.push(L[i++]); const cells = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|?[\s:-|]+$/.test(r))); o.push('<table>' + body.map((r, k) => `<tr>${cells(r).map(c => k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</table>'); continue; }
    if (/^\s*[-*]\s+/.test(l)) { const it = []; while (i < L.length && /^\s*[-*]\s+/.test(L[i])) it.push(L[i++].replace(/^\s*[-*]\s+/, '')); o.push('<ul>' + it.map(x => `<li>${inline(x)}</li>`).join('') + '</ul>'); continue; }
    if (!l.trim()) { i++; continue; }
    const p = []; while (i < L.length && L[i].trim() && !/^(#|\||```|\s*[-*]\s|<a id=)/.test(L[i])) p.push(L[i++]); o.push(`<p>${inline(p.join(' '))}</p>`);
  }
  return o.join('\n');
}
function page(src, title = 'AIVN — Kết quả tự kiểm chứng') {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="icon" href="favicon.svg"><style>body{font:15px/1.6 system-ui,"Segoe UI",Roboto,"Noto Sans","Microsoft YaHei","PingFang SC",sans-serif;max-width:920px;margin:0 auto;padding:24px;color:#1c2330}h1,h2,h3{line-height:1.3}h2{margin-top:2em;border-top:1px solid #e3e6ec;padding-top:1em}table{border-collapse:collapse;width:100%;font-size:14px;margin:10px 0}th,td{border:1px solid #d9dde5;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f3f5f9}code{background:#f1f3f7;padding:1px 4px;border-radius:4px}pre{background:#f1f3f7;padding:10px;overflow:auto}a{color:#1d5fd1}</style></head>
<body><p><a href="./">← AIVN</a></p>
${render(fs.readFileSync(src, 'utf8'))}
</body></html>
`;
}
if (require.main === module) { const [src, out, title] = process.argv.slice(2); const html = page(src, title); if (out) fs.writeFileSync(out, html); else process.stdout.write(html); }
module.exports = { render, page };
