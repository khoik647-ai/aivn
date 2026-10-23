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
function hashFileSync(p) {
  const h = crypto.createHash('sha256'); const fd = fs.openSync(p, 'r');
  try { const buf = Buffer.alloc(1 << 20); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function hashFile(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256'); const s = fs.createReadStream(p);
    s.on('error', reject); s.on('data', (c) => h.update(c)); s.on('end', () => resolve(h.digest('hex')));
  });
}
// Đúng tệp lần chuyển này ghi: cùng kích thước VÀ cùng sha256. Thiếu hash thì không xoá — cùng kích thước chưa đủ (tệp đã có sẵn có thể khác nội dung).
function writtenMatch(p, meta) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || !meta || !meta.sha256 || st.size !== meta.size) return false;
    return hashFileSync(p) === meta.sha256;
  } catch { return false; }
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
function rollbackJournal(j) {
  const items = Array.isArray(j.created) ? j.created.slice().reverse() : [];
  for (const m of items) {
    const src = path.join(j.from, m.rel), dst = path.join(j.to, m.rel);
    if (!writtenMatch(dst, m)) continue;
    // Nguồn đã mất (đổi tên, hoặc đã xoá ở pha commit) → đưa bản đích về lại, không xoá.
    if (!fs.existsSync(src)) {
      try {
        fs.mkdirSync(path.dirname(src), { recursive: true });
        try { fs.renameSync(dst, src); }
        catch { fs.copyFileSync(dst, src); if (writtenMatch(src, m)) fs.rmSync(dst, { force: true }); }
      } catch {}
    } else { try { fs.rmSync(dst, { force: true }); } catch {} }
  }
  cleanTemps(j);
}
function recoverMoveLegacy(j, file) {
  const destOk = (f) => { try { return fs.statSync(path.join(j.to, f.rel)).size === f.size; } catch { return false; } };
  const srcOk = (f) => { try { return fs.statSync(path.join(j.from, f.rel)).size === f.size; } catch { return false; } };
  if (j.rels.length && j.rels.every(destOk)) {
    for (const f of j.rels) { try { fs.rmSync(path.join(j.from, f.rel), { force: true }); } catch {} }
    pruneEmpty(j.from); journalClear(file); return { resumed: true, dir: path.resolve(j.to) };
  }
  for (const f of j.rels) {
    const src = path.join(j.from, f.rel), dst = path.join(j.to, f.rel);
    if (srcOk(f)) { try { fs.rmSync(dst, { force: true }); } catch {} }
    else if (!fs.existsSync(src) && destOk(f)) { try { fs.mkdirSync(path.dirname(src), { recursive: true }); fs.renameSync(dst, src); } catch { try { fs.copyFileSync(dst, src); if (fs.statSync(src).size === f.size) fs.rmSync(dst, { force: true }); } catch {} } }
    else { try { if (fs.existsSync(dst)) fs.rmSync(dst, { force: true }); } catch {} }
  }
  pruneEmpty(j.to); journalClear(file); return { rolledBack: true, dir: path.resolve(j.from) };
}
// Bản chuyển dở (sập giữa chừng). Nhật ký mới (có created): chỉ đụng tệp lần chuyển này tạo ra.
// Đủ sha256 ở đích → xoá nguồn. Thiếu → hoàn tác. phase quit (thoát khi đang treo) luôn hoàn tác.
function recoverMove(file) {
  let j; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!j || !j.from || !j.to || !Array.isArray(j.rels)) { journalClear(file); return null; }
  if (!Array.isArray(j.created)) return recoverMoveLegacy(j, file);
  const verified = j.rels.length > 0 && j.rels.every((f) => writtenMatch(path.join(j.to, f.rel), f));
  if (j.phase !== 'quit' && (j.phase === 'commit' || verified) && verified) {
    for (const f of j.rels) { if (writtenMatch(path.join(j.to, f.rel), f)) { try { fs.rmSync(path.join(j.from, f.rel), { force: true }); } catch {} } }
    cleanTemps(j); pruneEmpty(j.from); journalClear(file); return { resumed: true, dir: path.resolve(j.to) };
  }
  rollbackJournal(j); pruneEmpty(j.to); journalClear(file); return { rolledBack: true, dir: path.resolve(j.from) };
}
function openExcl(tmp) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NONBLOCK || 0);
  return fs.promises.open(tmp, flags, 0o644);
}
// link rồi xoá nguồn: rename không bao giờ ghi đè tệp đã có. false = phải chép (khác ổ / không link được).
async function renameExclusive(src, dst) {
  try { await fs.promises.link(src, dst); }
  catch (e) {
    if (e.code === 'EEXIST') { const err = new Error('Đích đã có tệp cùng tên.'); err.code = 'ECONFLICT'; throw err; }
    if (e.code === 'EXDEV' || e.code === 'EPERM' || e.code === 'ENOTSUP' || e.code === 'ENOSYS' || e.code === 'EOPNOTSUPP') return false;
    if (fs.existsSync(dst)) { const err = new Error('Đích đã có tệp cùng tên.'); err.code = 'ECONFLICT'; throw err; }
    await fs.promises.rename(src, dst); return true;
  }
  await fs.promises.unlink(src); return true;
}
async function placeNew(tmp, dst) {
  try { await fs.promises.link(tmp, dst); }
  catch (e) {
    if (e.code === 'EEXIST' || fs.existsSync(dst)) { const err = new Error('Đích đã có tệp cùng tên.'); err.code = 'ECONFLICT'; throw err; }
    await fs.promises.rename(tmp, dst); return;
  }
  await fs.promises.unlink(tmp);
}
async function copyOne(src, tmp, { signal, onBytes, copyFile, expectHash, onCreated }) {
  if (copyFile) {
    const fh0 = await openExcl(tmp); await fh0.close();
    if (onCreated) onCreated();
    await copyFile(src, tmp, { signal, onBytes }); return hashFile(tmp);
  }
  const fh = await openExcl(tmp);
  if (onCreated) onCreated();
  const hash = crypto.createHash('sha256'); let n = 0;
  const count = new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); n += chunk.length; try { if (onBytes) onBytes(n); } catch {} cb(null, chunk); } });
  await pipeline(fs.createReadStream(src, { highWaterMark: 64 * 1024 }), count, fh.createWriteStream(), { signal });
  const sha = hash.digest('hex');
  if (expectHash && sha !== expectHash) throw new Error(`Chép không khớp nội dung nguồn`);
  if (await hashFile(tmp) !== sha) throw new Error(`Bản vừa chép không khớp khi đọc lại`);
  return sha;
}
// process.exit() / app.exit() nối threadpool trước khi tắt. open() kẹt trên FIFO hoặc ổ mạng thì lời gọi đó không bao giờ trở lại,
// và timer trên luồng chính cũng không chạy nữa. Tiến trình rời này đã được spawn từ trước nên vẫn gửi được SIGKILL.
function armHardExit(waitMs) {
  const { spawn } = require('child_process');
  const ms = Math.max(0, waitMs | 0);
  const script = `setTimeout(function(){try{process.kill(${process.pid},'SIGKILL')}catch(e){}},${ms})`;
  try { const k = spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' }); k.unref(); } catch {}
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
async function moveModels(from, to, { onProgress = () => {}, signal = null, statfs, copy = false, stallMs = 60000, journal = null, copyFile = null, afterEach = null, killAt = null } = {}) {
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
  let snap = null;
  // Chưa ghi nhật ký (từ chối vì trùng tên) thì không xoá nhật ký của lần chuyển khác.
  const rollback = () => { if (!snap) return; rollbackJournal(snap); journalClear(journal); };
  arm();
  try {
    moveActive = { journal, snap: null, stalled: false };
    for (const f of files) f.sha256 = await race(hashFile(path.join(from, f.rel)));
    const conflicts = [];
    for (const f of files) {
      const dst = path.join(to, f.rel); let st = null;
      try { st = await race(fs.promises.stat(dst)); } catch (e) { if (e && (e.code === 'ESTALL' || e.code === 'ABORT')) throw e; st = null; }
      if (!st) continue;
      if (!st.isFile()) { conflicts.push(f.rel); continue; }
      if (st.size === f.size) { const h = await race(hashFile(dst)); if (h === f.sha256) f.identical = true; else conflicts.push(f.rel); }
      else conflicts.push(f.rel);
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
        const renamed = await race(renameExclusive(src, dst));
        if (renamed) {
          if (!writtenMatch(dst, meta)) throw new Error(`Đổi tên “${f.rel}” không khớp nội dung`);
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
        const sha = await race(copyOne(src, tmp, { signal: stallAc.signal, copyFile, expectHash: f.sha256, onCreated: ownTemp, onBytes: (n) => tell({ done, total: files.length, file: f.rel, bytesDone: bytesDone + Math.min(n, f.size), bytesTotal }, false) }));
        if (sha !== f.sha256) throw new Error(`Chép “${f.rel}” không khớp nội dung nguồn`);
        const st = await fs.promises.stat(tmp);
        if (st.size !== f.size) throw new Error(`Chép “${f.rel}” không đủ dữ liệu`);
        await placeNew(tmp, dst);
        ownedTmp = null;
        if (!writtenMatch(dst, meta)) throw new Error(`Đích “${f.rel}” không khớp sau khi đọc lại`);
      } catch (e) { if (ownedTmp) { try { fs.rmSync(ownedTmp, { force: true }); } catch {} } throw fail(e); }
      bytesDone += f.size; done++; moved.push(f.rel); tell({ done, total: files.length, file: f.rel, bytesDone, bytesTotal }, true);
      journalWrite(journal, snap); hit('after:' + done);
      if (afterEach) await race(Promise.resolve().then(() => afterEach({ rel: f.rel, index: done })));
    }
    snap.phase = 'commit'; journalWrite(journal, snap);
    for (const f of files) {
      if (!writtenMatch(path.join(to, f.rel), f)) throw new Error(`Chưa xác minh được “${f.rel}” ở đích, không xoá bản gốc`);
    }
    for (let i = 0; i < files.length; i++) {
      hit('commit:' + i);
      const f = files[i];
      if (!writtenMatch(path.join(to, f.rel), f)) throw new Error(`Chưa xác minh được “${f.rel}” ở đích, không xoá bản gốc`);
      try { fs.rmSync(path.join(from, f.rel), { force: true }); } catch {}
    }
    cleanTemps(snap); pruneEmpty(from);
    return { moved: moved.length, skipped: skipped.length, files: files.length, bytes: bytesTotal, sameDrive: same };
  } catch (e) { rollback(); throw (e && (e.code === 'ESTALL' || e.code === 'ABORT' || e.code === 'ECONFLICT')) ? e : fail(e); }
  finally { clearTimeout(timer); if (!moveActive || !moveActive.stalled) moveActive = null; if (signal) try { signal.removeEventListener('abort', onUserAbort); } catch {} }
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
module.exports = { deleteModelFiles, freeBytes, checkSpace, spaceError, validateTarget, listFiles, moveModels, driveOf, MARGIN, recoverMove, journalClear, dirProgressGate, STALL_MSG, ABORT_MSG, conflictMessage, beforeQuitMove };
