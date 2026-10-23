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

// Chỉ ghi settings.gpu = false khi đường CPU nạp được. Mọi đường đều lỗi thì GPU không phải nguyên nhân.
function shouldPersistGpuOff({ cpuLoaded } = {}) {
  return !!cpuLoaded;
}

// Hết VRAM thì thang CPU (ngữ cảnh đầy rồi nhỏ hơn) vẫn có ích. Lỗi tệp / kiến trúc thì một lần CPU là đủ.
function wantsCpuLadder(attempts, { memory = false } = {}) {
  if (memory) return true;
  const rows = modelAttempts(attempts).filter((a) => !a.slow);
  return rows.length > 0 && rows.every((a) => isMemoryError(a.message));
}

module.exports = { wayLabel, isMemoryError, waysOf, failureText, shouldPersistGpuOff, wantsCpuLadder, modelAttempts };
