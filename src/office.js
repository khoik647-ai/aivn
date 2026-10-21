'use strict';
// Đọc tệp Office/OpenDocument (XLSX, PPTX, ODT, ODS, ODP) và tệp nén ZIP — hoàn toàn cục bộ, không cần Office.
// Phát triển bởi NGUYỄN NGỌC KHÔI SINH VIÊN VLU
const { unzipSync } = require('fflate');

const LIMITS = { entryBytes: 60 * 1048576, totalBytes: 150 * 1048576, entries: 4000, ratio: 200, chars: 400000, rows: 5000 };
class OfficeError extends Error { constructor(msg) { super(msg); this.userMessage = msg; } }

// Giải nén có giới hạn (chống "bom nén"): đọc khai báo kích thước trong thư mục trung tâm trước khi bung
function centralDir(buf) {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.length); let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new OfficeError('Tệp nén bị hỏng hoặc không phải ZIP.');
  let n = b.readUInt16LE(eocd + 10), off = b.readUInt32LE(eocd + 16); const out = [];
  if (n === 0xffff || off === 0xffffffff) throw new OfficeError('Tệp nén ZIP64 (rất lớn) chưa được hỗ trợ.');
  for (let k = 0; k < n && off + 46 <= b.length; k++) {
    if (b.readUInt32LE(off) !== 0x02014b50) break;
    const flags = b.readUInt16LE(off + 8), csize = b.readUInt32LE(off + 20), usize = b.readUInt32LE(off + 24), nl = b.readUInt16LE(off + 28), xl = b.readUInt16LE(off + 30), cl = b.readUInt16LE(off + 32);
    const name = b.slice(off + 46, off + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1');
    out.push({ name, csize, usize, encrypted: !!(flags & 1) }); off += 46 + nl + xl + cl;
  }
  return out;
}
function unzip(buf, want = () => true) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dir = centralDir(u8);
  if (dir.length > LIMITS.entries) throw new OfficeError(`Tệp nén có quá nhiều mục (${dir.length}).`);
  const pick = dir.filter(e => !e.name.endsWith('/') && want(e.name));
  let total = 0;
  for (const e of pick) {
    if (e.encrypted) throw new OfficeError('Tệp có mật khẩu: hãy bỏ mật khẩu rồi gửi lại.');
    if (e.usize > LIMITS.entryBytes || (e.csize > 0 && e.usize / e.csize > LIMITS.ratio && e.usize > 1048576)) throw new OfficeError(`Mục "${e.name}" trong tệp nén quá lớn khi giải nén.`);
    total += e.usize;
  }
  if (total > LIMITS.totalBytes) throw new OfficeError('Nội dung tệp nén quá lớn khi giải nén (giới hạn 150 MB).');
  const names = new Set(pick.map(e => e.name));
  let files; try { files = unzipSync(u8, { filter: (f) => names.has(f.name) }); } catch (e) { throw new OfficeError('Không giải nén được tệp (' + e.message + ').'); }
  return { dir, files };
}
const td = new TextDecoder('utf-8');
const str = (u8) => (u8 ? td.decode(u8) : '');
function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
    const cp = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch { return m; }
  });
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name.replace(/[:.]/g, '\\$&')}="([^"]*)"`)); return m ? decodeXml(m[1]) : null; };
function rels(files, p) { // "xl/_rels/workbook.xml.rels" → { rId: đường dẫn tuyệt đối trong gói }
  const out = {}; const x = str(files[p]); const base = p.replace(/_rels\/[^/]+\.rels$/, '');
  for (const m of x.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), t = attr(m[0], 'Target'); if (!id || !t) continue;
    out[id] = t.startsWith('/') ? t.slice(1) : normPath(base + t);
  }
  return out;
}
function normPath(p) { const out = []; for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); } return out.join('/'); }

// ---------- XLSX ----------
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function colIndex(ref) { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function serialToDate(v, date1904) {
  const ms = Math.round((v - (date1904 ? -1462 : 0) - 25569) * 86400000); const d = new Date(ms); if (isNaN(d)) return String(v);
  const p = (n) => String(n).padStart(2, '0'); const dd = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const hasTime = Math.abs(v % 1) > 1e-9; return hasTime ? `${dd} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : dd;
}
function xlsx(buf) {
  const { files } = unzip(buf, n => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const wb = str(files['xl/workbook.xml']); if (!wb) throw new OfficeError('Tệp XLSX không có bảng tính.');
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const r = rels(files, 'xl/_rels/workbook.xml.rels');
  const shared = []; for (const m of str(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(decodeXml([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  // kiểu ô ngày tháng (numFmtId dựng sẵn hoặc định dạng riêng có d/m/y)
  const st = str(files['xl/styles.xml']); const custom = {};
  for (const m of st.matchAll(/<numFmt\b[^>]*>/g)) { const id = +attr(m[0], 'numFmtId'); const code = (attr(m[0], 'formatCode') || '').replace(/"[^"]*"|\[[^\]]*\]/g, ''); if (/[dmy]/i.test(code) && !/^[#0.,%\s]*$/.test(code)) custom[id] = true; }
  const xfs = []; const cx = st.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/); if (cx) for (const m of cx[1].matchAll(/<xf\b[^>]*>/g)) { const id = +attr(m[0], 'numFmtId'); xfs.push(BUILTIN_DATE.has(id) || !!custom[id]); }
  const out = []; let chars = 0, cut = false;
  for (const s of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(s[0], 'name') || 'Trang tính'; const state = attr(s[0], 'state'); const target = r[attr(s[0], 'r:id')];
    const x = str(files[target]); if (!x) continue;
    const rows = []; let n = 0;
    for (const row of x.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (++n > LIMITS.rows) { cut = true; break; }
      const cells = [];
      for (const c of (row[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = '<c' + c[1] + '>'; const t = attr(tag, 't'); const sIdx = +(attr(tag, 's') || 0); const inner = c[2] || '';
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; let val = '';
        if (t === 's') val = shared[+v] ?? '';
        else if (t === 'inlineStr') val = decodeXml([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null) { val = decodeXml(v); if ((t == null || t === 'n') && xfs[sIdx] && isFinite(+val)) val = serialToDate(+val, date1904); }
        const i = colIndex(attr(tag, 'r')); const k = i >= 0 ? i : cells.length; if (k > 200) continue;
        cells[k] = val.replace(/[\t\r\n]+/g, ' ').trim();
      }
      if (cells.some(Boolean)) rows.push([...cells].map(v => v || '').join('\t').replace(/\t+$/, ''));
    }
    const body = `[Trang tính: ${name}${state === 'hidden' ? ' (ẩn)' : ''}]\n${rows.join('\n')}`;
    chars += body.length; out.push(body); if (chars > LIMITS.chars) { cut = true; break; }
  }
  return { text: out.join('\n\n') + (cut ? '\n\n[Bảng tính dài: AIVN chỉ đọc phần đầu]' : ''), pages: out.length, unit: 'trang tính' };
}

// ---------- PPTX ----------
const paras = (x) => [...x.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(m => decodeXml([...(m[1] || m[2] || '').replace(/<a:br\/>/g, '<a:t>\n</a:t>').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(t => t[1]).join(''))).filter(s => s.trim());
function pptx(buf) {
  const { files } = unzip(buf, n => /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/[^/]+\.xml|slides\/_rels\/[^/]+\.rels|notesSlides\/[^/]+\.xml)$/.test(n));
  const pres = str(files['ppt/presentation.xml']); if (!pres) throw new OfficeError('Tệp PPTX không có trang chiếu.');
  const r = rels(files, 'ppt/_rels/presentation.xml.rels'); const out = [];
  const ids = [...pres.matchAll(/<p:sldId\b[^>]*>/g)].map(m => r[attr(m[0], 'r:id')]).filter(Boolean);
  ids.forEach((p, i) => {
    const x = str(files[p]); if (!x) return;
    const hidden = /<p:sld\b[^>]*\sshow="0"/.test(x);
    const text = paras(x);
    const sr = rels(files, p.replace(/([^/]+)$/, '_rels/$1.rels')); const notesP = Object.values(sr).find(t => /notesSlides\//.test(t));
    const notes = notesP ? paras(str(files[notesP]).replace(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?type="sldNum"[\s\S]*?<\/p:sp>/g, '')) : [];
    out.push(`[Trang chiếu ${i + 1}${hidden ? ' (ẩn)' : ''}]\n${text.join('\n')}${notes.length ? '\nGhi chú: ' + notes.join(' ') : ''}`);
  });
  return { text: out.join('\n\n'), pages: ids.length, unit: 'trang chiếu' };
}

// ---------- OpenDocument (ODT/ODS/ODP) ----------
function odfText(x) { // một đoạn: giữ khoảng trắng/tab/xuống dòng theo thẻ của ODF
  return decodeXml(x.replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_m, c) => ' '.repeat(+c || 1)).replace(/<text:tab\s*\/>/g, '\t').replace(/<text:line-break\s*\/>/g, '\n').replace(/<text:note\b[\s\S]*?<\/text:note>/g, '').replace(/<[^>]+>/g, ''));
}
function odf(buf, ext) {
  const { files } = unzip(buf, n => n === 'content.xml' || n === 'mimetype');
  const x = str(files['content.xml']); if (!x) throw new OfficeError('Tệp OpenDocument không có nội dung.');
  const body = (x.match(/<office:body>([\s\S]*)<\/office:body>/) || [])[1] || x;
  if (ext === 'ods') {
    const out = [];
    for (const t of body.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
      const rows = [];
      for (const row of t[2].matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
        const cells = [];
        for (const c of (row[2] || '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
          const rep = Math.min(+(attr('<c' + c[1] + '>', 'table:number-columns-repeated') || 1), 50);
          const v = [...(c[2] || '').matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>|<text:p\b[^>]*\/>/g)].map(p => odfText(p[1] || '')).join(' ').trim();
          for (let k = 0; k < rep; k++) cells.push(v);
        }
        const line = cells.join('\t').replace(/\t+$/, ''); const rr = Math.min(+(attr('<r' + row[1] + '>', 'table:number-rows-repeated') || 1), 3);
        if (line.trim()) for (let k = 0; k < rr; k++) rows.push(line);
        if (rows.length > LIMITS.rows) break;
      }
      out.push(`[Trang tính: ${attr('<t' + t[1] + '>', 'table:name') || ''}]\n${rows.join('\n')}`);
    }
    return { text: out.join('\n\n'), pages: out.length, unit: 'trang tính' };
  }
  if (ext === 'odp') {
    const out = []; let i = 0;
    for (const pg of body.matchAll(/<draw:page\b([^>]*)>([\s\S]*?)<\/draw:page>/g)) {
      i++; const main = pg[2].replace(/<presentation:notes\b[\s\S]*?<\/presentation:notes>/g, '');
      const notes = (pg[2].match(/<presentation:notes\b[\s\S]*?<\/presentation:notes>/) || [''])[0];
      const ps = (s) => [...s.matchAll(/<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/g)].map(m => odfText(m[1])).filter(t => t.trim());
      const n = ps(notes); out.push(`[Trang chiếu ${i}]\n${ps(main).join('\n')}${n.length ? '\nGhi chú: ' + n.join(' ') : ''}`);
    }
    return { text: out.join('\n\n'), pages: i, unit: 'trang chiếu' };
  }
  const out = [];
  for (const m of body.matchAll(/<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>|<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)) {
    if (m[4] != null) { out.push([...m[4].matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g)].map(c => odfText(c[1]).trim()).join('\t')); continue; }
    if (/<table:table-cell/.test(m[3])) continue;
    const t = odfText(m[3]); if (t.trim()) out.push(m[1] === 'h' ? '# ' + t.trim() : t);
  }
  return { text: out.join('\n'), pages: null };
}

// ---------- ZIP: liệt kê + đọc các tệp bên trong mà AIVN hiểu ----------
// readInner(name, ext, bytes) → Promise<{text}> (do docs.js cung cấp, để dùng chung mọi bộ đọc)
async function zip(buf, readInner, { maxFiles = 40 } = {}) {
  const { dir } = { dir: centralDir(buf instanceof Uint8Array ? buf : new Uint8Array(buf)) };
  const entries = dir.filter(e => !e.name.endsWith('/') && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(e.name));
  const listing = entries.slice(0, 300).map(e => `- ${e.name} (${fmtSize(e.usize)})`).join('\n') + (entries.length > 300 ? `\n… và ${entries.length - 300} mục khác` : '');
  const { files } = unzip(buf, (n) => entries.some(e => e.name === n) && readInner.supports(n));
  const parts = []; const skipped = []; let chars = 0, read = 0;
  for (const e of entries) {
    if (!files[e.name]) { skipped.push(e.name); continue; }
    if (read >= maxFiles || chars > LIMITS.chars) { skipped.push(e.name); continue; }
    try { const r = await readInner(e.name, files[e.name]); if (r && r.text && r.text.trim()) { parts.push(`=== ${e.name} ===\n${r.text.trim()}`); chars += r.text.length; read++; } }
    catch (err) { parts.push(`=== ${e.name} ===\n[Không đọc được: ${err.userMessage || err.message}]`); }
  }
  const text = `[Nội dung tệp nén: ${entries.length} tệp]\n${listing}\n\n${parts.join('\n\n')}${skipped.length && parts.length ? `\n\n[${skipped.length} tệp không phải văn bản/tài liệu hoặc vượt giới hạn, chỉ liệt kê tên]` : ''}`;
  return { text, pages: null, files: entries.length, read };
}
const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';

module.exports = { xlsx, pptx, odf, zip, unzip, centralDir, decodeXml, OfficeError, LIMITS, serialToDate };
