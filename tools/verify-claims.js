// Kiểm tra trực tuyến: mọi nhãn 'Theo nhà phát triển' phải có câu trích (q) xuất hiện nguyên văn trong nguồn (src).
// Chạy: node tools/verify-claims.js  (cần mạng; release.sh không bắt buộc)
const C = require('../src/catalog-claims');
const cache = new Map();
async function text(u) {
  if (cache.has(u)) return cache.get(u);
  let raw = u;
  if (u.startsWith('https://huggingface.co/')) raw = u + '/raw/main/README.md';
  else if (u.startsWith('https://github.com/') && u.includes('/blob/')) raw = u.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/blob/', '/');
  const r = await fetch(raw); let t = r.ok ? await r.text() : '';
  t = t.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\*\*|\\/g, '').replace(/\s+/g, ' ').toLowerCase();
  cache.set(u, { ok: r.ok, t }); return cache.get(u);
}
(async () => {
  let bad = 0;
  for (const [id, list] of Object.entries(C.CLAIMS)) for (const c of list) {
    if (c.k !== 'd') continue;
    const { ok, t } = await text(c.src);
    const parts = c.q.toLowerCase().replace(/\*\*/g, '').split('…').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const miss = parts.filter(p => !t.includes(p));
    if (!ok || miss.length) { bad++; console.log(`✘ ${id} [${c.t}] ${ok ? '' : 'HTTP!'} missing: ${JSON.stringify(miss)}  (${c.src})`); }
  }
  console.log('bad', bad); if (bad) process.exitCode = 1;
})();
