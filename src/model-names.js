// Mục 5 (mô hình agent mới): repo GGUF chính thức của H Company (Holo4-27B, Holo4-35B-A3B, Holo-3.1-35B-A3B…) đặt tên tệp CHUNG
// “q4_k_m.gguf” / “mmproj.f16.gguf”. Hai mô hình như vậy trước đây ra cùng id “q4_k_m” (mô hình thứ hai bị bỏ khỏi danh sách)
// và khớp danh mục theo tên tệp thì nhận nhầm. Ở đây: tên tệp chung → lưu với tiền tố tên repo; id + khớp danh mục theo tên lưu trên máy.
const path = require('path');
const GENERIC_RE = /^(?:(?:ggml-)?model[\w.-]*|(?:i?q\d[\w]*|f16|bf16|f32|fp16|ud-[\w]+)(?:[.-][\w]+)?|mmproj(?:[.-](?:model[.-])?(?:f16|bf16|f32|q8_0|q4_k_m|fp16))?)\.gguf$/i;
const safe = (s) => String(s || '').replace(/[^\w.\-]+/g, '_');
const isGeneric = (file) => GENERIC_RE.test(path.basename(String(file || '')));
// tên tệp lưu trên máy cho tệp `file` của repo `repo` (localName của danh mục thắng)
function localNameFor(repo, file, localName) {
  if (localName) return safe(path.basename(localName));
  const base = safe(String(file || '').split('/').pop());
  if (!isGeneric(base)) return base;
  const name = String(repo || '').split('/').pop().replace(/-GGUF$/i, '');
  return name ? `${safe(name)}-${base}` : base;
}
const catLocal = (c) => localNameFor(c.repo, c.file, c.localName);
const catMmLocal = (c) => (c && c.mmproj ? localNameFor(c.repo, c.mmproj.file, c.mmproj.localName) : null);
// mô hình trên máy ↔ mục danh mục: theo tên lưu trên máy; tệp cũ đã tải trước khi có tiền tố (tên chung) chỉ khớp khi CÙNG repo
function catalogFor(m, catalog) {
  const f = String(m.file || '').toLowerCase(); const repo = String(m.repo || '').toLowerCase();
  const byLocal = catalog.find(c => catLocal(c).toLowerCase() === f);
  if (byLocal) return byLocal;
  const repoKey = (r) => String(r || '').split('/').map(safe).join('/').toLowerCase();
  if (isGeneric(f)) return catalog.find(c => String(c.file).toLowerCase() === f && repo && repoKey(c.repo) === repoKey(repo)) || null;
  return catalog.find(c => String(c.file).toLowerCase() === f) || null;
}
// id ổn định: tên tệp (bỏ .gguf, bỏ phần chia -0000x-of-…); tên chung → thêm tên thư mục chứa
function idFor(fullPath, splitRe) {
  const b = path.basename(fullPath); const m = splitRe ? b.match(splitRe) : null;
  const base = (m ? m[1] : b.replace(/\.gguf$/i, '')).toLowerCase();
  if (!isGeneric(b)) return base;
  const dir = path.basename(path.dirname(fullPath)).replace(/-GGUF$/i, '').toLowerCase();
  return dir && dir !== '.' && dir !== 'models' ? `${dir}-${base}` : base;
}
module.exports = { GENERIC_RE, isGeneric, localNameFor, catLocal, catMmLocal, catalogFor, idFor };
