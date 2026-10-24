'use strict';
// Câu lỗi nạp phải đếm đúng số lần llama.cpp thực sự load mô hình, và liệt kê đúng từng lần đó.
// Lần thử flash-attention / KV (không load lại mô hình) không tính. “Failed to load model” không phải hết VRAM.

function wayLabel(mode) {
  const head = String(mode || '').split('(')[0].trim();
  if (head === 'cpu' || head === 'cpu-only' || head.startsWith('cpu')) return 'CPU';
  if (head === 'gpu-partial' || head.startsWith('gpu-partial')) return 'GPU một phần';
  return 'GPU';
}

function isMemoryError(msg) {
  return /too large for the available VRAM|out of memory|out of device memory|failed to allocate|cudaMalloc|ErrorOutOfDeviceMemory|not enough (?:V)?RAM|VK_ERROR_OUT_OF_DEVICE_MEMORY|không đủ VRAM|không đủ bộ nhớ/i.test(String(msg || ''));
}

function modelAttempts(attempts) {
  return (attempts || []).filter((a) => a && !a.context);
}

function waysOf(attempts) {
  return modelAttempts(attempts).map((a) => wayLabel(a.mode || a));
}

function failureText(name, attempts, message) {
  const ways = waysOf(attempts);
  const n = ways.length;
  const err = `Lỗi: ${message}. Chi tiết đã ghi vào nhật ký (Mô hình của tôi → Mở thư mục nhật ký).`;
  if (!n) return `Không nạp được ${name}. ${err}`;
  return `Không nạp được ${name} (đã thử ${n} cách: ${ways.join(', ')}). ${err}`;
}

// Mọi lần thử GPU chỉ bị coi là chậm (không OOM, không lỗi nạp) thì không tắt GPU vĩnh viễn.
function slowOnlyFailure(attempts) {
  const rows = modelAttempts(attempts);
  return rows.length > 0 && rows.every((a) => a && a.slow);
}

// Lỗi backend/driver lúc tạo ngữ cảnh (DeviceLost, thiết bị không hợp lệ). Hết VRAM không thuộc nhóm này.
function isDriverError(msg) {
  return /DeviceLost|device lost|VK_ERROR_DEVICE_LOST|invalid device/i.test(String(msg || ''));
}

// Chỉ ghi settings.gpu = false khi đường CPU nạp được và GPU thật sự lỗi (LOAD_FAILED từ backend, thiết bị không hợp lệ, DeviceLost).
// Mọi đường đều lỗi, chỉ chậm, hoặc không có lần GPU nào thất bại (0 lớp vừa vì VRAM trống thấp) thì không ghi tắt.
// Lần thử tạo ngữ cảnh bị DeviceLost vẫn là lỗi driver. Hết bộ nhớ / VRAM thì không ghi, kể cả khi lỗi nằm ở bước tạo ngữ cảnh.
function shouldPersistGpuOff({ cpuLoaded, attempts } = {}) {
  if (!cpuLoaded) return false;
  const rows = Array.isArray(attempts) ? attempts.filter((a) => a && !a.slow) : null;
  if (rows && rows.some((a) => isDriverError(a.message) && !isMemoryError(a.message))) return true;
  if (slowOnlyFailure(attempts)) return false;
  if (Array.isArray(attempts) && modelAttempts(attempts).length === 0) return false;
  return true;
}

// Hết VRAM thì thang CPU (ngữ cảnh đầy rồi nhỏ hơn) vẫn có ích. Lỗi tệp / kiến trúc thì một lần CPU là đủ.
function wantsCpuLadder(attempts, { memory = false } = {}) {
  if (memory) return true;
  const rows = modelAttempts(attempts).filter((a) => !a.slow);
  return rows.length > 0 && rows.every((a) => isMemoryError(a.message));
}

module.exports = { wayLabel, isMemoryError, waysOf, failureText, shouldPersistGpuOff, slowOnlyFailure, wantsCpuLadder, modelAttempts };
