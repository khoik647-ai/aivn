'use strict';
// Đổi thư mục mô hình (beta.3; máy thật: C: còn 11,8 GB, D: 325,8 GB): chọn thư mục → kiểm tra ghi được + dung lượng trống →
// chuyển mô hình hiện có sang (có tiến độ; cùng ổ thì đổi tên tức thì, khác ổ thì chép rồi kiểm kích thước rồi mới xoá bản cũ)
// hoặc chỉ trỏ sang thư mục mới (thư mục cũ vẫn được quét để mô hình cũ còn hiện).
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
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
// Thư mục đích trùng thư mục nguồn sau khi giải liên kết / alias / bind mount / khác hoa thường.
const ALIAS_MSG = 'Thư mục này trỏ tới chính thư mục mô hình hiện tại (đường tắt, liên kết, hoặc cùng một thư mục với tên khác). Hãy chọn thư mục khác.';
const caseFold = process.platform === 'win32' || process.platform === 'darwin';
const fold = (p) => (caseFold ? p.toLowerCase() : p);
function resolveDir(p) {
  const abs = path.resolve(p);
  try { if (fs.existsSync(abs) || fs.lstatSync(abs)) return fs.realpathSync.native(abs); } catch { /* đường dẫn chưa có */ }
  return abs;
}
function dirNest(fromDir, toDir) {
  const f = resolveDir(fromDir), t = resolveDir(toDir);
  if (fold(f) === fold(t)) return 'same';
  const sep = path.sep;
  if (fold(t).startsWith(fold(f) + sep)) return 'inside';
  if (fold(f).startsWith(fold(t) + sep)) return 'contains';
  try {
    const a = fs.statSync(f), b = fs.statSync(t);
    if (a.isDirectory() && b.isDirectory() && a.dev === b.dev && a.ino === b.ino) return 'same';
  } catch { /* một trong hai chưa tồn tại */ }
  return null;
}
function aliasError(kind) {
  if (kind === 'same') return ALIAS_MSG;
  if (kind === 'inside') return 'Không chọn thư mục nằm BÊN TRONG thư mục mô hình hiện tại.';
  if (kind === 'contains') return 'Không chọn thư mục CHỨA thư mục mô hình hiện tại.';
  return null;
}
function validateTarget(dir, { from = null } = {}) {
  if (!dir || !path.isAbsolute(dir)) return { ok: false, error: 'Hãy chọn một thư mục (đường dẫn đầy đủ).' };
  let t = path.resolve(dir);
  if (from) { const err = aliasError(dirNest(from, t)); if (err) return { ok: false, error: err }; }
  try { if (fs.existsSync(t) || fs.lstatSync(t)) t = fs.realpathSync.native(t); } catch { /* giữ đường dẫn sẽ tạo */ }
  if (from) { const err = aliasError(dirNest(from, t)); if (err) return { ok: false, error: err }; }
  try { fs.mkdirSync(t, { recursive: true }); const probe = path.join(t, `.aivn-write-test-${process.pid}`); fs.writeFileSync(probe, 'ok'); fs.rmSync(probe, { force: true }); }
  catch (e) { return { ok: false, error: `Không ghi được vào thư mục này (${e.code || e.message}). Hãy chọn thư mục khác.` }; }
  try { t = fs.realpathSync.native(t); } catch { /* vừa tạo, không phải liên kết */ }
  if (from) { const err = aliasError(dirNest(from, t)); if (err) return { ok: false, error: err }; }
  return { ok: true, dir: t, free: freeBytes(t) };
}
// liệt kê mọi tệp trong thư mục mô hình (kể cả .part đang tải dở) — đường dẫn tương đối
function listFiles(root) {
  const out = []; const walk = (d, rel) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name), r = path.join(rel, e.name); if (e.isDirectory()) walk(p, r); else if (e.isFile()) { let size = 0; try { size = fs.statSync(p).size; } catch {} out.push({ rel: r, size }); } } };
  walk(root, ''); return out;
}
const sameDevice = (a, b) => { try { return fs.statSync(existingAncestor(a)).dev === fs.statSync(existingAncestor(b)).dev; } catch { return false; } };
const STALL_MSG = 'Chuyển thư mục mô hình bị dừng vì quá lâu không thấy tiến triển. Mô hình vẫn nằm ở thư mục cũ, không mất tệp. Hãy bấm Thử lại.';
const ABORT_MSG = 'Đã huỷ chuyển mô hình.';
// B198: từ chối CẢ lượt trước khi đụng tệp nào. {0} là danh sách tệp xung đột.
const conflictMessage = (rels) => `Không chuyển được vì thư mục đích đã có tệp cùng tên nhưng không giống hệt. Mọi tệp vẫn ở thư mục cũ và cài đặt chưa đổi. Hãy đổi tên hoặc dời các tệp này rồi thử lại: ${rels.join(', ')}`;
let moveActive = null; // { journal, snap, stalled } — before-quit khi watchdog đã cắt một lần mở đích bị treo
function pruneEmpty(d) {
  let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) if (e.isDirectory()) { const p = path.join(d, e.name); pruneEmpty(p); try { fs.rmdirSync(p); } catch {} }
}
function journalWrite(file, obj) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, file);
}
function journalClear(file) { if (!file) return; try { fs.rmSync(file, { force: true }); } catch {} try { fs.rmSync(file + '.tmp', { force: true }); } catch {} }
// Sự kiện tiến độ đến SAU khi lượt chuyển đã xong không được bật lại thanh (IPC send và lời invoke có thể đảo thứ tự khi máy nặng).
function dirProgressGate(job, p) {
  if (!job || !job.moving) return { moving: false, show: false };
  if (!p || p.finished) return { moving: false, show: false, hide: true, error: (p && p.error) || null, code: (p && p.code) || null };
  return { moving: true, show: true };
}
// Hash luồng, không chặn luồng chính. onBytes mỗi khối để watchdog được lên dây cót lại.
// release() chạy đồng bộ khi huỷ, kể cả khi luồng đọc chưa kịp kết thúc.
function hashFile(p, { onBytes, signal, release } = {}) {
  let released = false;
  const rel = () => { if (!released) { released = true; try { if (release) release(); } catch {} } };
  const fail = (e) => { rel(); throw e; };
  return fs.promises.lstat(p).then((st) => {
    if (!st.isFile() || st.isSymbolicLink()) return fail(Object.assign(new Error('symlink'), { code: 'EINVAL' }));
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const s = fs.createReadStream(p, { highWaterMark: 64 * 1024 });
      let settled = false;
      const finish = (err, hex) => {
        if (settled) return; settled = true; rel();
        if (signal) signal.removeEventListener('abort', onAbort);
        if (err) { try { s.destroy(); } catch {} reject(err); } else resolve(hex);
      };
      const onAbort = () => finish(Object.assign(new Error('aborted'), { code: 'ABORT', name: 'AbortError' }));
      if (signal) { if (signal.aborted) { onAbort(); return; } signal.addEventListener('abort', onAbort); }
      s.on('error', (e) => finish(e));
      s.on('data', (c) => { h.update(c); try { if (onBytes) onBytes(c.length); } catch {} });
      s.on('end', () => finish(null, h.digest('hex')));
    });
  }, (e) => fail(e));
}
// Đúng tệp lần chuyển này ghi: lstat (không đi theo liên kết), cùng kích thước VÀ cùng sha256.
function writtenMatch(p, meta, hashOpts) {
  return fs.promises.lstat(p).then(async (st) => {
    if (!st.isFile() || st.isSymbolicLink() || !meta || !meta.sha256 || st.size !== meta.size) return false;
    return (await hashFile(p, hashOpts)) === meta.sha256;
  }).catch(() => false);
}
function lstatOrNull(p) { try { return fs.lstatSync(p); } catch { return null; } }
// true khi bất kỳ đoạn nào của root/rel là symlink (kể cả tệp cuối). Không đi theo liên kết.
async function symlinkBetween(root, rel) {
  const parts = String(rel).split(/[\\/]/).filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st; try { st = await fs.promises.lstat(cur); } catch (e) { if (e && e.code === 'ENOENT') return false; throw e; }
    if (st.isSymbolicLink()) return true;
  }
  return false;
}
// Liên kết trong thư mục nguồn: không đi vào, không hash đích của nó.
function findSymlink(root) {
  const walk = (d, rel) => {
    let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
    for (const e of es) {
      const r = path.join(rel, e.name);
      if (e.isSymbolicLink()) return r;
      if (e.isDirectory()) { const hit = walk(path.join(d, e.name), r); if (hit) return hit; }
    }
    return null;
  };
  return walk(root, '');
}
// Chỉ dọn tệp tạm ghi trong nhật ký (tên riêng của lần chuyển này). Không đụng .aivn-moving* đã có sẵn.
function cleanTemps(j) {
  for (const rel of (j && j.temps) || []) {
    if (typeof rel !== 'string' || !rel.includes('.aivn-moving-')) continue;
    try { fs.rmSync(path.join(j.to, rel), { force: true }); } catch {}
  }
}
function journalTemp(snap, journal, rel) {
  if (!snap.temps) snap.temps = [];
  if (!snap.temps.includes(rel)) snap.temps.push(rel);
  journalWrite(journal, snap);
}
// Chỉ xoá / đưa về những tệp trong journal.created, và chỉ khi nội dung vẫn là bản lần chuyển này ghi.
// Không đi theo symlink, không xoá nguồn khi đích chỉ là tên khác của cùng inode.
async function rollbackJournal(j) {
  const items = Array.isArray(j.created) ? j.created.slice().reverse() : [];
  for (const m of items) {
    const src = path.join(j.from, m.rel), dst = path.join(j.to, m.rel);
    if (await symlinkBetween(j.to, m.rel)) continue;
    if (!(await writtenMatch(dst, m))) continue;
    const srcSt = lstatOrNull(src);
    if (!srcSt) {
      try {
        fs.mkdirSync(path.dirname(src), { recursive: true });
        try { fs.renameSync(dst, src); }
        catch { fs.copyFileSync(dst, src); if (await writtenMatch(src, m)) { try { fs.unlinkSync(dst); } catch {} } }
      } catch {}
    } else { try { fs.unlinkSync(dst); } catch {} }
  }
  cleanTemps(j);
}
// Nhật ký cũ không có created (chỉ có ở commit chưa phát hành). Chỉ hoàn tác.
// Không bao giờ xoá nguồn còn tồn tại — cùng kích thước không chứng minh cùng nội dung.
function recoverMoveLegacy(j, file) {
  const destFile = (f) => { const st = lstatOrNull(path.join(j.to, f.rel)); return !!(st && st.isFile() && !st.isSymbolicLink() && st.size === f.size); };
  const sourceThere = (f) => !!lstatOrNull(path.join(j.from, f.rel));
  if (j.phase === 'commit' && j.rels.length && j.rels.every(destFile) && j.rels.every((f) => !sourceThere(f))) {
    journalClear(file); return { resumed: true, dir: path.resolve(j.to) };
  }
  for (const f of j.rels) {
    const src = path.join(j.from, f.rel), dst = path.join(j.to, f.rel);
    if (sourceThere(f) || !destFile(f)) continue;
    try {
      fs.mkdirSync(path.dirname(src), { recursive: true });
      try { fs.renameSync(dst, src); }
      catch { fs.copyFileSync(dst, src); const back = lstatOrNull(src); if (back && back.isFile() && !back.isSymbolicLink() && back.size === f.size) { try { fs.unlinkSync(dst); } catch {} } }
    } catch {}
  }
  pruneEmpty(j.to); journalClear(file); return { rolledBack: true, dir: path.resolve(j.from) };
}
// B218: ổ / thư mục đích chưa truy cập được thì KHÔNG xoá nhật ký, KHÔNG xoá hay dời tệp.
const DEST_BLOCK = new Set(['ENOENT', 'EACCES', 'EIO', 'ENODEV', 'EPERM']);
const heavyRecover = new Map(); // nhật ký đã băm trong lần chạy này → không băm lại
function isDestBlock(e) { return !!(e && DEST_BLOCK.has(e.code)); }
function destRootBlocked(dir) {
  let st = null;
  try { st = fs.lstatSync(dir); }
  catch (e) { return isDestBlock(e) ? e : null; }
  if (st.isSymbolicLink() || st.isDirectory()) {
    try { fs.readdirSync(dir); return null; }
    catch (e) { return isDestBlock(e) ? e : null; }
  }
  return null;
}
async function destChildBlocked(j) {
  const rels = new Set();
  for (const f of j.rels) if (f && typeof f.rel === 'string') rels.add(f.rel);
  if (Array.isArray(j.created)) for (const c of j.created) if (c && typeof c.rel === 'string') rels.add(c.rel);
  if (Array.isArray(j.temps)) for (const t of j.temps) if (typeof t === 'string') rels.add(t);
  for (const rel of rels) {
    try { await fs.promises.lstat(path.join(j.to, rel)); }
    catch (e) { if (e && e.code === 'ENOENT') continue; if (isDestBlock(e)) return e; }
  }
  return null;
}
function pendingOf(j, err) {
  const to = path.resolve(j.to), from = path.resolve(j.from), drive = driveOf(to), base = path.basename(to);
  return {
    pending: true, state: 'pending', reason: 'destination missing', code: 'EDEST', dir: from, to, drive,
    fsCode: (err && err.code) || 'ENOENT',
    log: `Chuyển mô hình đang chờ ổ đích. Chưa xoá hay dời tệp nào. Sẽ thử lại khi thư mục này truy cập được: ${to}`,
    notice: `Chuyển mô hình đang chờ ổ đích ${drive}, thư mục “${base}”. Chưa xoá hay dời tệp nào. Sẽ thử lại khi ổ này có lại.`,
  };
}
// Bản chuyển dở (sập giữa chừng). Nhật ký mới (có created): chỉ đụng tệp lần chuyển này tạo ra.
// Đủ sha256 ở đích → xoá nguồn (trừ symlink và cùng inode). Thiếu → hoàn tác. phase quit luôn hoàn tác.
// Đích chưa truy cập được → pending, giữ nhật ký, không đụng tệp. Băm nặng tối đa một lần mỗi nhật ký trong một lần chạy.
async function recoverMove(file) {
  if (moveActive && moveActive.journal && path.resolve(String(moveActive.journal)) === path.resolve(file)) return null;
  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  let j; try { j = JSON.parse(raw); } catch { return null; }
  if (!j || !j.from || !j.to || !Array.isArray(j.rels)) { journalClear(file); return null; }
  const rootErr = destRootBlocked(j.to);
  if (rootErr) return pendingOf(j, rootErr);
  const childErr = await destChildBlocked(j);
  if (childErr) return pendingOf(j, childErr);
  const id = path.resolve(file), stamp = crypto.createHash('sha256').update(raw).digest('hex');
  if (heavyRecover.get(id) === stamp) return pendingOf(j, { code: 'EIO' });
  let didHash = false;
  const match = async (p, meta) => {
    try {
      const st = await fs.promises.lstat(p);
      if (!st.isFile() || st.isSymbolicLink() || !meta || !meta.sha256 || st.size !== meta.size) return false;
      didHash = true; heavyRecover.set(id, stamp);
      return (await hashFile(p)) === meta.sha256;
    } catch (e) {
      if (e && e.code !== 'ENOENT' && isDestBlock(e)) { if (didHash) heavyRecover.set(id, stamp); e.aivnDestBlock = true; throw e; }
      return false;
    }
  };
  const finish = (result) => { try { if (!fs.existsSync(file)) heavyRecover.delete(id); } catch {} return result; };
  try {
    if (!Array.isArray(j.created)) return finish(recoverMoveLegacy(j, file));
    let verified = j.rels.length > 0;
    if (verified) {
      for (const f of j.rels) {
        if (await symlinkBetween(j.to, f.rel) || !(await match(path.join(j.to, f.rel), f))) { verified = false; break; }
      }
    }
    const gone = destRootBlocked(j.to);
    if (gone) return pendingOf(j, gone);
    if (j.phase !== 'quit' && (j.phase === 'commit' || verified) && verified) {
      for (const f of j.rels) {
        const src = path.join(j.from, f.rel), dst = path.join(j.to, f.rel);
        if (await symlinkBetween(j.to, f.rel) || !(await match(dst, f))) continue;
        const dstSt = lstatOrNull(dst), srcSt = lstatOrNull(src);
        if (!dstSt || dstSt.isSymbolicLink() || !dstSt.isFile() || !srcSt || srcSt.isSymbolicLink()) continue;
        if (srcSt.dev === dstSt.dev && srcSt.ino === dstSt.ino) continue;
        try { fs.unlinkSync(src); } catch {}
      }
      cleanTemps(j);
      const still = destRootBlocked(j.to);
      if (still) return pendingOf(j, still);
      pruneEmpty(j.from); journalClear(file); return finish({ resumed: true, dir: path.resolve(j.to) });
    }
    await rollbackJournal(j);
    const after = destRootBlocked(j.to);
    if (after) return pendingOf(j, after);
    pruneEmpty(j.to); journalClear(file); return finish({ rolledBack: true, dir: path.resolve(j.from) });
  } catch (e) {
    if (e && (e.aivnDestBlock || (isDestBlock(e) && e.code !== 'ENOENT'))) return pendingOf(j, e);
    heavyRecover.delete(id); throw e;
  }
}
function openExcl(tmp) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NONBLOCK || 0);
  return fs.promises.open(tmp, flags, 0o644);
}
async function nameExists(p) { try { await fs.promises.lstat(p); return true; } catch { return false; } }
// link rồi xoá nguồn: rename không bao giờ ghi đè tệp đã có. false = phải chép (khác ổ / không link được).
// link() thành công thì so dev+ino trước khi xoá tên nguồn — không hash lại, không đi theo symlink.
async function renameExclusive(src, dst) {
  try { await fs.promises.link(src, dst); }
  catch (e) {
    if (e.code === 'EEXIST') { const err = new Error('Đích đã có tệp cùng tên.'); err.code = 'ECONFLICT'; throw err; }
    if (e.code === 'EXDEV' || e.code === 'EPERM' || e.code === 'ENOTSUP' || e.code === 'ENOSYS' || e.code === 'EOPNOTSUPP') return false;
    if (await nameExists(dst)) { const err = new Error('Đích đã có tệp cùng tên.'); err.code = 'ECONFLICT'; throw err; }
    await fs.promises.rename(src, dst); return true;
  }
  const sa = await fs.promises.lstat(src), sb = await fs.promises.lstat(dst);
  if (!(sa.isFile() && sb.isFile() && !sa.isSymbolicLink() && !sb.isSymbolicLink() && sa.dev === sb.dev && sa.ino === sb.ino)) {
    try { await fs.promises.unlink(dst); } catch {}
    const err = new Error('link-inode'); err.code = 'EINODE'; throw err;
  }
  await fs.promises.unlink(src); return true;
}
async function placeNew(tmp, dst) {
  try { await fs.promises.link(tmp, dst); }
  catch (e) {
    if (e.code === 'EEXIST' || await nameExists(dst)) { const err = new Error('Đích đã có tệp cùng tên.'); err.code = 'ECONFLICT'; throw err; }
    await fs.promises.rename(tmp, dst); return;
  }
  await fs.promises.unlink(tmp);
}
async function copyOne(src, tmp, { signal, onBytes, copyFile, expectHash, onCreated, release }) {
  const drop = () => { if (release) { const r = release; release = null; try { r(); } catch {} } };
  try {
    if (copyFile) {
      const fh0 = await openExcl(tmp); await fh0.close();
      if (onCreated) onCreated();
      await copyFile(src, tmp, { signal, onBytes });
      let n = 0;
      return await hashFile(tmp, { signal, release: drop, onBytes: (c) => { n += c; try { if (onBytes) onBytes(n); } catch {} } });
    }
    const fh = await openExcl(tmp);
    if (onCreated) onCreated();
    const hash = crypto.createHash('sha256'); let n = 0;
    const count = new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); n += chunk.length; try { if (onBytes) onBytes(n); } catch {} cb(null, chunk); } });
    await pipeline(fs.createReadStream(src, { highWaterMark: 64 * 1024 }), count, fh.createWriteStream(), { signal });
    const sha = hash.digest('hex');
    if (expectHash && sha !== expectHash) throw new Error(`Chép không khớp nội dung nguồn`);
    let n2 = 0;
    const again = await hashFile(tmp, { signal, release: drop, onBytes: (c) => { n2 += c; try { if (onBytes) onBytes(Math.max(n, n2)); } catch {} } });
    if (again !== sha) throw new Error(`Bản vừa chép không khớp khi đọc lại`);
    return sha;
  } finally { drop(); }
}
// process.exit() / app.exit() nối threadpool trước khi tắt. open() kẹt trên FIFO hoặc ổ mạng thì lời gọi đó không bao giờ trở lại.
// Không spawn lại chính Electron (Electron 44 coi -e là phiên thứ hai). sleep + kill -9 / taskkill chạy ngoài binary.
function armHardExit(waitMs) {
  const { spawn } = require('child_process');
  const ms = Math.max(0, waitMs | 0);
  try {
    if (process.platform === 'win32') {
      const sec = Math.max(1, Math.ceil(ms / 1000));
      const k = spawn('cmd.exe', ['/c', `ping -n ${sec + 1} 127.0.0.1 >nul & taskkill /F /PID ${process.pid}`], { detached: true, stdio: 'ignore', windowsHide: true });
      k.unref();
    } else {
      const sec = (ms / 1000).toFixed(3);
      const k = spawn('/bin/sh', ['-c', `sleep ${sec}; kill -9 ${process.pid}`], { detached: true, stdio: 'ignore' });
      k.unref();
    }
  } catch {}
}
// Thoát ứng dụng khi watchdog đã cắt mà một luồng libuv vẫn kẹt trong open() (FIFO / ổ mạng treo).
function beforeQuitMove({ exit = (c) => process.exit(c || 0), graceMs = 400 } = {}) {
  if (!moveActive || !moveActive.stalled) return false;
  try {
    if (moveActive.journal && moveActive.snap && fs.existsSync(moveActive.journal)) {
      if (moveActive.snap.phase !== 'commit') moveActive.snap.phase = 'quit';
      journalWrite(moveActive.journal, moveActive.snap);
    }
  } catch {}
  const wait = Math.max(0, graceMs | 0);
  armHardExit(wait + 250);
  setTimeout(() => { try { exit(0); } catch { try { process.exit(0); } catch {} } }, wait);
  return true;
}
// chuyển mô hình: onProgress({ done, total, file, bytesDone, bytesTotal }); signal để huỷ.
// Không ghi đè tệp đã có ở đích. Chỉ xoá nguồn sau khi đích do CHÍNH lần chuyển này ghi ra đã khớp kích thước + sha256.
async function unlinkSourceIfSafe(src, dst, rel) {
  const srcSt = lstatOrNull(src);
  if (!srcSt) return;
  const dstSt = lstatOrNull(dst);
  if (!dstSt || dstSt.isSymbolicLink() || !dstSt.isFile()) throw new Error(`Chưa xác minh được “${rel}” ở đích, không xoá bản gốc`);
  if (srcSt.isSymbolicLink()) { await fs.promises.unlink(src); return; }
  if (srcSt.dev === dstSt.dev && srcSt.ino === dstSt.ino) return;
  await fs.promises.unlink(src);
}
async function moveModels(from, to, { onProgress = () => {}, signal = null, statfs, copy = false, stallMs = 60000, journal = null, copyFile = null, afterEach = null, killAt = null } = {}) {
  const nestErr = aliasError(dirNest(from, to));
  if (nestErr) { const e = new Error(nestErr); e.code = nestErr === ALIAS_MSG ? 'EALIAS' : 'EINVAL'; throw e; }
  const linkRel = findSymlink(from);
  if (linkRel) {
    const e = new Error(`Không chuyển liên kết “${linkRel}”. Đây là đường tắt, không phải tệp mô hình. Liên kết và tệp mà nó trỏ tới vẫn còn nguyên. Hãy thay bằng tệp thật hoặc dời liên kết đi rồi thử lại.`);
    e.code = 'ECONFLICT'; e.conflicts = [linkRel]; throw e;
  }
  const files = listFiles(from).filter(f => !String(f.rel).includes('.aivn-moving')).sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  const bytesTotal = files.reduce((s, f) => s + f.size, 0);
  const same = !copy && sameDevice(from, to);
  if (!same) checkSpace(to, bytesTotal, statfs);
  const kill = killAt || '';
  const hit = (point) => { if (kill && kill === point) { process.kill(process.pid, 'SIGKILL'); } };
  const stallAc = new AbortController(); let timer = null; let lastTell = 0;
  const arm = () => { if (!(stallMs > 0)) return; clearTimeout(timer); timer = setTimeout(() => { if (moveActive) moveActive.stalled = true; try { stallAc.abort('stall'); } catch {} }, stallMs); };
  const onUserAbort = () => { try { stallAc.abort('user'); } catch {} };
  if (signal) { if (signal.aborted) onUserAbort(); else signal.addEventListener('abort', onUserAbort, { once: true }); }
  const asStall = () => Object.assign(new Error(STALL_MSG), { code: 'ESTALL' });
  const asAbort = () => Object.assign(new Error(ABORT_MSG), { code: 'ABORT' });
  const fail = (e) => {
    const reason = stallAc.signal.aborted ? stallAc.signal.reason : null;
    if (reason === 'stall' || (e && e.code === 'ESTALL')) return asStall();
    if (reason === 'user' || (signal && signal.aborted) || (e && (e.code === 'ABORT' || e.name === 'AbortError'))) return asAbort();
    return e instanceof Error ? e : new Error(String(e || 'Không đổi được thư mục mô hình'));
  };
  const race = (p) => new Promise((resolve, reject) => {
    if (stallAc.signal.aborted) { reject(fail(new Error('aborted'))); return; }
    const onAb = () => reject(fail(new Error('aborted')));
    stallAc.signal.addEventListener('abort', onAb, { once: true });
    Promise.resolve(p).then(v => { stallAc.signal.removeEventListener('abort', onAb); resolve(v); }, e => { stallAc.signal.removeEventListener('abort', onAb); reject(fail(e)); });
  });
  const tell = (p, force) => {
    const now = Date.now(); if (!force && now - lastTell < 200) { arm(); return; } lastTell = now; arm();
    try { onProgress(p); } catch {}
  };
  let snap = null; let live = 0;
  const trackStart = () => { live++; let ended = false; return () => { if (!ended) { ended = true; live--; } }; };
  // Chưa ghi nhật ký (từ chối vì trùng tên) thì không xoá nhật ký của lần chuyển khác.
  const rollback = async () => { if (!snap) return; await rollbackJournal(snap); journalClear(journal); };
  const checkBytes = (file, bytesDone) => (n) => { bytesDone.n += n; tell({ phase: 'check', done: bytesDone.done, total: files.length, file, bytesDone: Math.min(bytesDone.n, bytesTotal), bytesTotal }, false); };
  arm();
  try {
    moveActive = { journal, snap: null, stalled: false };
    const pre = { n: 0, done: 0 };
    for (const f of files) {
      const release = trackStart();
      try {
        f.sha256 = await race(hashFile(path.join(from, f.rel), { signal: stallAc.signal, release, onBytes: checkBytes(f.rel, pre) }));
      } finally { release(); }
    }
    const conflicts = [];
    for (const f of files) {
      const dst = path.join(to, f.rel);
      if (await symlinkBetween(to, f.rel)) { conflicts.push(f.rel); continue; }
      let st = null;
      try { st = await race(fs.promises.lstat(dst)); } catch (e) { if (e && (e.code === 'ESTALL' || e.code === 'ABORT')) throw e; st = null; }
      if (!st) continue;
      if (st.isSymbolicLink() || !st.isFile()) { conflicts.push(f.rel); continue; }
      const srcSt = lstatOrNull(path.join(from, f.rel));
      if (srcSt && !srcSt.isSymbolicLink() && srcSt.dev === st.dev && srcSt.ino === st.ino) { conflicts.push(f.rel); continue; }
      if (st.size === f.size) {
        const release = trackStart();
        try {
          const h = await race(hashFile(dst, { signal: stallAc.signal, release, onBytes: checkBytes(f.rel, pre) }));
          if (h === f.sha256) f.identical = true; else conflicts.push(f.rel);
        } finally { release(); }
      } else conflicts.push(f.rel);
    }
    if (conflicts.length) { const e = new Error(conflictMessage(conflicts)); e.code = 'ECONFLICT'; e.conflicts = conflicts; throw e; }
    const rels = files.map(f => ({ rel: f.rel, size: f.size, sha256: f.sha256 }));
    const moveId = crypto.randomBytes(8).toString('hex');
    snap = { from: path.resolve(from), to: path.resolve(to), rels, created: [], temps: [], moveId, phase: 'moving' };
    journalWrite(journal, snap);
    moveActive.snap = snap;
    let bytesDone = 0, done = 0; const moved = [], skipped = [];
    for (const f of files) {
      if (stallAc.signal.aborted || (signal && signal.aborted)) throw fail(new Error('aborted'));
      const src = path.join(from, f.rel), dst = path.join(to, f.rel);
      const idx = done + 1;
      if (f.identical) {
        skipped.push(f.rel); bytesDone += f.size; done++; tell({ done, total: files.length, file: f.rel, bytesDone, bytesTotal }, true);
        journalWrite(journal, snap);
        hit('after:' + done);
        if (afterEach) await race(Promise.resolve().then(() => afterEach({ rel: f.rel, index: done })));
        continue;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      const meta = { rel: f.rel, size: f.size, sha256: f.sha256, kind: 'copy' };
      const mid = kill === 'mid:' + idx || (kill === 'midstream' && idx === 1);
      if (same && !copyFile && !mid) {
        snap.created.push({ ...meta, kind: 'rename' }); journalWrite(journal, snap);
        let renamed = false;
        try { renamed = await race(renameExclusive(src, dst)); }
        catch (e) { if (e && e.code === 'EINODE') throw new Error(`Đổi tên “${f.rel}” không khớp nội dung`); throw e; }
        if (renamed) {
          f.linkedByUs = true;
          bytesDone += f.size; done++; moved.push(f.rel); tell({ done, total: files.length, file: f.rel, bytesDone, bytesTotal }, true);
          journalWrite(journal, snap); hit('after:' + done);
          if (afterEach) await race(Promise.resolve().then(() => afterEach({ rel: f.rel, index: done })));
          continue;
        }
        snap.created.pop(); journalWrite(journal, snap);
      }
      const tmpRel = f.rel + '.aivn-moving-' + moveId;
      const tmp = path.join(to, tmpRel);
      snap.created.push(meta); journalWrite(journal, snap);
      let ownedTmp = null;
      const ownTemp = () => { journalTemp(snap, journal, tmpRel); ownedTmp = tmp; };
      try {
        if (mid && !copyFile) {
          const fh = await openExcl(tmp);
          ownTemp();
          const n = Math.max(1, Math.floor(f.size / 2)); const buf = Buffer.alloc(n);
          const rs = await fs.promises.open(src, 'r');
          try { await rs.read(buf, 0, n, 0); } finally { await rs.close(); }
          await fh.write(buf); await fh.sync(); await fh.close();
          hit(kill);
        }
        const copyRelease = trackStart();
        const sha = await race(copyOne(src, tmp, { signal: stallAc.signal, copyFile, expectHash: f.sha256, onCreated: ownTemp, release: copyRelease, onBytes: (n) => tell({ done, total: files.length, file: f.rel, bytesDone: bytesDone + Math.min(n, f.size), bytesTotal }, false) }));
        if (sha !== f.sha256) throw new Error(`Chép “${f.rel}” không khớp nội dung nguồn`);
        const st = await fs.promises.lstat(tmp);
        if (!st.isFile() || st.isSymbolicLink() || st.size !== f.size) throw new Error(`Chép “${f.rel}” không đủ dữ liệu`);
        await placeNew(tmp, dst);
        ownedTmp = null;
      } catch (e) { if (ownedTmp) { try { fs.rmSync(ownedTmp, { force: true }); } catch {} } throw fail(e); }
      bytesDone += f.size; done++; moved.push(f.rel); tell({ done, total: files.length, file: f.rel, bytesDone, bytesTotal }, true);
      journalWrite(journal, snap); hit('after:' + done);
      if (afterEach) await race(Promise.resolve().then(() => afterEach({ rel: f.rel, index: done })));
    }
    snap.phase = 'commit'; journalWrite(journal, snap);
    for (let i = 0; i < files.length; i++) {
      hit('commit:' + i);
      const f = files[i];
      const src = path.join(from, f.rel), dst = path.join(to, f.rel);
      if (await symlinkBetween(to, f.rel)) throw new Error(`Chưa xác minh được “${f.rel}” ở đích, không xoá bản gốc`);
      const seen = { n: bytesDone, done };
      const release = trackStart();
      let ok = false;
      try { ok = await race(writtenMatch(dst, f, { signal: stallAc.signal, release, onBytes: checkBytes(f.rel, seen) })); }
      finally { release(); }
      if (!ok) throw new Error(`Chưa xác minh được “${f.rel}” ở đích, không xoá bản gốc`);
      await unlinkSourceIfSafe(src, dst, f.rel);
    }
    cleanTemps(snap); pruneEmpty(from);
    return { moved: moved.length, skipped: skipped.length, files: files.length, bytes: bytesTotal, sameDrive: same };
  } catch (e) { await rollback(); throw (e && (e.code === 'ESTALL' || e.code === 'ABORT' || e.code === 'ECONFLICT')) ? e : fail(e); }
  finally { clearTimeout(timer); if (!(moveActive && moveActive.stalled && live > 0)) moveActive = null; if (signal) try { signal.removeEventListener('abort', onUserAbort); } catch {} }
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
module.exports = { deleteModelFiles, freeBytes, checkSpace, spaceError, validateTarget, listFiles, moveModels, driveOf, MARGIN, recoverMove, journalClear, dirProgressGate, STALL_MSG, ABORT_MSG, conflictMessage, beforeQuitMove, armHardExit, ALIAS_MSG };
