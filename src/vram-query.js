'use strict';
// VRAM trống thật của GPU rời. Ngân sách DXGI/Vulkan trên máy lẫn GPU tích hợp vẫn đếm bộ nhớ dùng chung,
// nên một tiến trình khác giữ ~3 GB trên RTX 3050 Ti vẫn bị báo “còn ~3,5 GB”. nvidia-smi memory.free là số trống của chính GPU đó.
const { execFile } = require('child_process');

const MiB = 1024 * 1024;
const UNKNOWN_FREE_LOG = 'Không đo được VRAM trống (nvidia-smi hoặc ngân sách DXGI/Vulkan), tạm tính theo tổng VRAM.';

function parseNvidiaSmi(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 2) continue;
    const freeMiB = Number(parts[0]);
    const totalMiB = Number(parts[1]);
    if (!Number.isFinite(freeMiB) || !Number.isFinite(totalMiB) || totalMiB <= 0) continue;
    rows.push({ freeBytes: Math.round(freeMiB * MiB), totalBytes: Math.round(totalMiB * MiB) });
  }
  return rows;
}

function pickNvidiaRow(rows, total) {
  if (!rows || !rows.length) return null;
  if (!(total > 0)) return rows.slice().sort((a, b) => b.totalBytes - a.totalBytes)[0];
  let best = null;
  let bestDelta = Infinity;
  for (const r of rows) {
    const d = Math.abs(r.totalBytes - total);
    if (d < bestDelta) { best = r; bestDelta = d; }
  }
  if (best && bestDelta > Math.max(256 * MiB, total * 0.25)) return null;
  return best;
}

function queryNvidiaSmi({ execFile: run = execFile, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs + 400);
    try {
      run('nvidia-smi', ['--query-gpu=memory.free,memory.total', '--format=csv,noheader,nounits'], { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
        clearTimeout(timer);
        if (err) return finish(null);
        finish(parseNvidiaSmi(stdout));
      });
    } catch { clearTimeout(timer); finish(null); }
  });
}

// measured: { freeBytes } từ nvidia-smi đã chọn đúng GPU, hoặc null khi không đo được.
// reportedFree: ngân sách DXGI/Vulkan đã quy về VRAM riêng. mixed: máy có cả GPU rời và GPU tích hợp — số Vulkan không đáng tin.
function resolveVram({ total = 0, reportedFree = null, mixed = false, integratedOnly = false } = {}, measured = null) {
  const tot = Number(total) || 0;
  if (!(tot > 0)) return { total: 0, free: 0, freeKnown: false, freeSource: 'none' };
  if (measured && Number.isFinite(Number(measured.freeBytes))) {
    return { total: tot, free: Math.max(0, Math.min(tot, Number(measured.freeBytes))), freeKnown: true, freeSource: 'nvidia-smi' };
  }
  const rep = Number(reportedFree);
  if (!mixed && Number.isFinite(rep)) {
    return { total: tot, free: Math.max(0, Math.min(tot, rep)), freeKnown: true, freeSource: integratedOnly ? 'vulkan' : 'vulkan' };
  }
  return { total: tot, free: tot, freeKnown: false, freeSource: 'total' };
}

module.exports = { parseNvidiaSmi, pickNvidiaRow, queryNvidiaSmi, resolveVram, UNKNOWN_FREE_LOG, MiB };
