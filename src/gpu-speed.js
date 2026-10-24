'use strict';
// Sau khi nạp, một lớp GPU “đủ” vẫn có thể chạy chậm vì driver tràn trọng số sang RAM hệ thống
// (RTX 3050 Ti 4 GB: 37/37 lớp, oom: false, ~22 token/giây thay vì ~70). So với tốc độ ước tính của đúng mức offload đó.
const GB = 1e9;
const EFF_GPU = 0.75, EFF_CPU = 0.7, TOK_OVH_GPU = 0.0025;
const SLOW_FRAC = 0.45;
const PINCH = 96 * 1024 * 1024;
const MIN_TOKENS = 8;
// Mỗi lần đo tối đa 12 s. Ba bậc GPU không được cộng thành ~36 s: ngân sách cả lần nạp là 18 s.
const PROBE_EACH_MS = 12000;
const PROBE_TOTAL_MS = 18000;

function expectedTps({ bytes, gpuFrac = 1, gpuBw, cpuBw = 60 } = {}) {
  const b = Math.max(0, Number(bytes) || 0);
  const f = Math.max(0, Math.min(1, Number.isFinite(Number(gpuFrac)) ? Number(gpuFrac) : 1));
  const gpu = Number(gpuBw);
  const cpu = Number(cpuBw) > 0 ? Number(cpuBw) : 60;
  if (!(b > 0) || !(gpu > 0)) return null;
  const t = b * f / (gpu * EFF_GPU * GB) + b * (1 - f) / (cpu * EFF_CPU * GB) + TOK_OVH_GPU;
  return t > 0 ? 1 / t : null;
}

// step: true → bỏ cấu hình này, xuống thang lớp rồi CPU.
// Đo không ra (null, hoặc dưới MIN_TOKENS) thì không kết luận chậm.
// VRAM trống sau khi nạp gần 0 thì bước xuống, trừ khi tốc độ đo được vẫn tốt — kẹt VRAM mà vẫn nhanh thì giữ cấu hình.
function shouldStepDown({ tps, expected, freeBytes, tokens } = {}) {
  const enough = !(tokens != null && !(Number(tokens) >= MIN_TOKENS));
  const haveSpeed = enough && Number(tps) > 0 && Number(expected) > 0;
  if (haveSpeed && !(Number(tps) < SLOW_FRAC * Number(expected))) return { step: false, reason: 'ok' };
  if (Number.isFinite(Number(freeBytes)) && Number(freeBytes) < PINCH) return { step: true, reason: 'vram' };
  if (!haveSpeed) return { step: false, reason: 'inconclusive' };
  return { step: true, reason: 'slow' };
}

// Thời gian còn lại cho lần đo kế. 0 → bỏ qua, không kết luận chậm.
function probeWindow(elapsedMs) {
  const left = PROBE_TOTAL_MS - Math.max(0, Number(elapsedMs) || 0);
  if (!(left >= 250)) return 0;
  return Math.min(PROBE_EACH_MS, Math.floor(left));
}

module.exports = { expectedTps, shouldStepDown, probeWindow, SLOW_FRAC, PINCH, MIN_TOKENS, EFF_GPU, TOK_OVH_GPU, PROBE_EACH_MS, PROBE_TOTAL_MS };
