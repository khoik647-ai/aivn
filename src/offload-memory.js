'use strict';
// Nhớ cấu hình offload đã chạy được. Không ghim CPU vì một lần hết VRAM tạm (thẻ đang bận).
// Chỉ xoá khi nạp trọn lớp, không phải bước xuống, và chưa từng sập native.
const MB = 1024 * 1024;
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const FREE_ROSE = 512 * MB;
const STEP_AFTER = 3;
const STEP = 4;

function identity(x = {}) {
  return {
    file: String(x.file || ''),
    size: Number(x.size) || 0,
    mtime: Number(x.mtime) || 0,
    backend: String(x.backend || ''),
    gpuName: String(x.gpuName || ''),
    vramTotal: Number(x.vramTotal) || 0,
    driver: String(x.driver || ''),
    settings: String(x.settings ?? ''),
  };
}
function same(rec, id, now) {
  if (!rec || !id) return false;
  for (const k of ['file', 'size', 'mtime', 'backend', 'gpuName', 'vramTotal', 'driver', 'settings']) if (rec[k] !== id[k]) return false;
  if (!(rec.at > 0) || (now || Date.now()) - rec.at > EXPIRY_MS) return false;
  return true;
}
function blank(id, now) { return { ...identity(id), at: now }; }

// event: { gpu, totalLayers, ctx, requestedCtx, oom, freeAt }
// Trả null = xoá bản ghi (chỉ khi nạp trọn lớp, không oom, chưa sập).
function note(prev, event = {}, id, now = Date.now()) {
  const known = same(prev, id, now) ? { ...prev } : blank(id, now);
  known.at = now;
  // Số lớp đã hết VRAM. Bước +4 sau này không được chạm lại đúng mức đó.
  if (event.oomGpu > 0) known.oomGpu = known.oomGpu > 0 ? Math.min(known.oomGpu, event.oomGpu) : event.oomGpu;
  if (event.freeAt > 0) known.freeAt = event.freeAt;
  if (event.totalLayers > 0) known.totalLayers = event.totalLayers;
  if (!(event.gpu > 0)) {
    if (!event.oom) return same(prev, id, now) ? { ...prev, at: now } : null;
    known.cpuFail = true;
    known.oom = true;
    known.ctx = event.ctx || known.ctx || null;
    known.requestedCtx = event.requestedCtx || event.ctx || known.requestedCtx || null;
    if (!(known.gpu > 0)) delete known.gpu;
    return known;
  }
  const full = event.totalLayers > 0 && event.gpu >= event.totalLayers && !event.oom;
  if (full && !known.crash) return null;
  if (full && known.crash) {
    known.gpu = event.gpu; known.ctx = event.ctx || null; known.oom = false; known.safe = true; known.clean = 0;
    return known;
  }
  if (!event.oom && known.gpu === event.gpu) known.clean = (known.clean || 0) + 1;
  else known.clean = event.oom ? 0 : 1;
  known.gpu = event.gpu;
  known.ctx = event.ctx || null;
  known.requestedCtx = event.requestedCtx || event.ctx || null;
  known.oom = true;
  known.cpuFail = false;
  return known;
}
function noteCrash(prev, id, { ctx, gpu } = {}, now = Date.now()) {
  const known = same(prev, id, now) ? { ...prev } : blank(id, now);
  known.at = now; known.crash = true; known.safe = true;
  if (gpu > 0) known.crashedGpu = gpu;
  known.ctx = ctx || known.ctx || null;
  if (known.gpu === 0) delete known.gpu;
  return known;
}
function recall(rec, { ctx, free, identity: id, now = Date.now() } = {}) {
  if (!same(rec, id, now)) return {};
  const out = {};
  if (rec.safe || rec.crash) out.safe = true;
  const rose = rec.freeAt > 0 && free > rec.freeAt + FREE_ROSE;
  if (rose && !rec.crash) return out.safe ? { safe: true } : {};
  if (!(rec.gpu > 0)) return out;
  let cap = rec.gpu;
  if (rec.oom && (rec.clean || 0) >= STEP_AFTER && !rec.crash) {
    let up = cap + STEP;
    if (rec.totalLayers > 0 && up > rec.totalLayers) up = rec.totalLayers;
    const underCrash = !(rec.crashedGpu > 0) || up < rec.crashedGpu;
    // Chỉ bước lên khi còn dưới số lớp đã OOM. VRAM trống tăng ≥ FREE_ROSE thì nhánh rose ở trên đã bỏ trần để dò lại.
    const underOom = !(rec.oomGpu > 0) || up < rec.oomGpu || rose;
    if (underCrash && underOom) cap = up;
  }
  if (rec.oom && cap > 0) out.capLayers = cap;
  const rememberedCtx = rec.ctx;
  if (rememberedCtx && ctx && rememberedCtx < ctx) { out.ctx = rememberedCtx; out.reducedCtx = true; }
  return out;
}
module.exports = { identity, note, noteCrash, recall, EXPIRY_MS, FREE_ROSE, STEP_AFTER };
