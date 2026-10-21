'use strict';
// Đổi thư mục mô hình (beta.3; máy thật: C: còn 11,8 GB, D: 325,8 GB): chọn thư mục → kiểm tra ghi được + dung lượng trống →
// chuyển mô hình hiện có sang (có tiến độ; cùng ổ thì đổi tên tức thì, khác ổ thì chép rồi kiểm kích thước rồi mới xoá bản cũ)
// hoặc chỉ trỏ sang thư mục mới (thư mục cũ vẫn được quét để mô hình cũ còn hiện).
const fs = require('fs'); const path = require('path');
const GB = 1024 ** 3; const MARGIN = 512 * 1024 ** 2; // chừa 512 MB cho hệ điều hành / tệp tạm
const gb = (n) => (n / GB).toFixed(1).replace('.', ',');
// ổ đĩa / gốc gắn kết để hiện cho người dùng (“ổ D:”)
const driveOf = (p) => { const w = /^([A-Za-z]):/.exec(String(p)); if (w) return w[1].toUpperCase() + ':'; const r = path.parse(path.resolve(p)).root; return /^[A-Za-z]:\\?$/.test(r) ? r.slice(0, 2).toUpperCase() : r; }; // “D:” hoặc “/” (chữ “ổ” nằm trong câu để dịch được)
function existingAncestor(p) { let d = path.resolve(p); while (!fs.existsSync(d)) { const up = path.dirname(d); if (up === d) break; d = up; } return d; }
function freeBytes(p, statfs = fs.statfsSync) { try { const s = statfs(existingAncestor(p)); return Number(s.bavail) * Number(s.bsize); } catch { return null; } }
// lỗi rõ ràng khi không đủ chỗ (dùng cho tải mô hình và chuyển thư mục)
function spaceError(need, free, dir) {
  const e = new Error(`Không đủ dung lượng trống: cần ${gb(need)} GB, ổ ${driveOf(dir)} chỉ còn ${gb(Math.max(0, free))} GB. Hãy giải phóng ổ đĩa hoặc đổi thư mục mô hình sang ổ khác (Cài đặt → Chung → Thư mục mô hình, hoặc nút “Đổi thư mục” ở Mô hình của tôi).`);
  e.code = 'ENOSPC_AIVN'; e.need = need; e.free = free; return e;
}
function checkSpace(dir, need, statfs) { const free = freeBytes(dir, statfs); if (free != null && free < need + MARGIN) throw spaceError(need + MARGIN, free, dir); return free; }
function validateTarget(dir, { from = null } = {}) {
  if (!dir || !path.isAbsolute(dir)) return { ok: false, error: 'Hãy chọn một thư mục (đường dẫn đầy đủ).' };
  const t = path.resolve(dir);
  if (from) { const f = path.resolve(from); if (t === f) return { ok: false, error: 'Đây đã là thư mục mô hình hiện tại.' }; if (t.startsWith(f + path.sep)) return { ok: false, error: 'Không chọn thư mục nằm BÊN TRONG thư mục mô hình hiện tại.' }; if (f.startsWith(t + path.sep)) return { ok: false, error: 'Không chọn thư mục CHỨA thư mục mô hình hiện tại.' }; }
  try { fs.mkdirSync(t, { recursive: true }); const probe = path.join(t, `.aivn-write-test-${process.pid}`); fs.writeFileSync(probe, 'ok'); fs.rmSync(probe, { force: true }); }
  catch (e) { return { ok: false, error: `Không ghi được vào thư mục này (${e.code || e.message}). Hãy chọn thư mục khác.` }; }
  return { ok: true, dir: t, free: freeBytes(t) };
}
// liệt kê mọi tệp trong thư mục mô hình (kể cả .part đang tải dở) — đường dẫn tương đối
function listFiles(root) {
  const out = []; const walk = (d, rel) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name), r = path.join(rel, e.name); if (e.isDirectory()) walk(p, r); else if (e.isFile()) { let size = 0; try { size = fs.statSync(p).size; } catch {} out.push({ rel: r, size }); } } };
  walk(root, ''); return out;
}
const sameDevice = (a, b) => { try { return fs.statSync(existingAncestor(a)).dev === fs.statSync(existingAncestor(b)).dev; } catch { return false; } };
// chuyển mô hình: onProgress({ done, total, file, bytesDone, bytesTotal }); signal để huỷ (tệp đang chép dở bị xoá, bản gốc giữ nguyên)
async function moveModels(from, to, { onProgress = () => {}, signal = null, statfs, copy = false } = {}) {
  const files = listFiles(from); const bytesTotal = files.reduce((s, f) => s + f.size, 0);
  const same = !copy && sameDevice(from, to); // copy: buộc chép (kiểm thử đường khác ổ)
  if (!same) checkSpace(to, bytesTotal, statfs);
  let bytesDone = 0, done = 0; const moved = [], skipped = [];
  for (const f of files) {
    if (signal && signal.aborted) throw Object.assign(new Error('Đã huỷ chuyển mô hình.'), { code: 'ABORT' });
    const src = path.join(from, f.rel), dst = path.join(to, f.rel); fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(dst) && fs.statSync(dst).size === f.size) { fs.rmSync(src, { force: true }); skipped.push(f.rel); bytesDone += f.size; done++; onProgress({ done, total: files.length, file: f.rel, bytesDone, bytesTotal }); continue; }
    let renamed = false; if (same) { try { fs.renameSync(src, dst); renamed = true; } catch {} }
    if (!renamed) {
      const tmp = dst + '.aivn-moving';
      try {
        await new Promise((resolve, reject) => { const rs = fs.createReadStream(src, { highWaterMark: 4 << 20 }), ws = fs.createWriteStream(tmp); let base = bytesDone;
          const ab = () => { rs.destroy(); ws.destroy(); reject(Object.assign(new Error('Đã huỷ chuyển mô hình.'), { code: 'ABORT' })); }; if (signal) signal.addEventListener('abort', ab, { once: true });
          rs.on('data', (c) => { base += c.length; onProgress({ done, total: files.length, file: f.rel, bytesDone: base, bytesTotal }); });
          rs.on('error', reject); ws.on('error', reject); ws.on('finish', () => { if (signal) signal.removeEventListener('abort', ab); resolve(); }); rs.pipe(ws); });
        if (fs.statSync(tmp).size !== f.size) throw new Error(`Chép “${f.rel}” không đủ dữ liệu`);
        fs.renameSync(tmp, dst); fs.rmSync(src, { force: true });
      } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
    }
    bytesDone += f.size; done++; moved.push(f.rel); onProgress({ done, total: files.length, file: f.rel, bytesDone, bytesTotal });
  }
  // dọn thư mục rỗng còn lại ở chỗ cũ (không xoá thư mục gốc)
  const prune = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) if (e.isDirectory()) { prune(path.join(d, e.name)); try { fs.rmdirSync(path.join(d, e.name)); } catch {} } };
  prune(from);
  return { moved: moved.length, skipped: skipped.length, files: files.length, bytes: bytesTotal, sameDrive: same };
}
// B79 (QA lượt 8): xoá mô hình đã tải — tệp mô hình (mọi phần nếu tách), tệp thị giác mmproj nếu KHÔNG mô hình nào khác dùng chung, rồi dọn thư mục trống.
// Không bao giờ xoá gì ngoài thư mục mô hình. Trả về danh sách tệp đã xoá.
const SPLIT = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;
function deleteModelFiles(m, all, root) {
  const inRoot = (f) => { const r = path.resolve(root) + path.sep; return path.resolve(f).startsWith(r); };
  const gone = []; const rm = (f) => { if (!f || !inRoot(f)) return; try { if (fs.existsSync(f)) { fs.rmSync(f, { force: true }); gone.push(f); } } catch {} };
  const sm = path.basename(m.path).match(SPLIT);
  if (sm) for (let i = 1; i <= Number(sm[3]); i++) rm(path.join(path.dirname(m.path), `${sm[1]}-${String(i).padStart(5, '0')}-of-${sm[3]}.gguf`)); else rm(m.path);
  if (m.mmproj && !(all || []).some(o => o !== m && o.id !== m.id && o.mmproj && path.resolve(o.mmproj) === path.resolve(m.mmproj))) rm(m.mmproj);
  for (let d = path.dirname(m.path); inRoot(d) && path.resolve(d) !== path.resolve(root); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch { break; } }
  return gone;
}
module.exports = { deleteModelFiles, freeBytes, checkSpace, spaceError, validateTarget, listFiles, moveModels, driveOf, MARGIN };
