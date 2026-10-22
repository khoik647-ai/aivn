'use strict';
// B168: máy hai GPU (Ryzen/Intel có GPU tích hợp + GPU rời NVIDIA/AMD): Vulkan liệt kê GPU tích hợp TRƯỚC
// (laptop Khôi: "AMD Radeon(TM) Graphics" là thiết bị 0, RTX 3050 Ti là thiết bị 1). AIVN luôn ưu tiên GPU rời
// cho cả llama-server (--device VulkanN) lẫn nhãn/ước lượng VRAM; người dùng chọn tay được (Cài đặt › Nâng cao, hộp nạp, tab Runtime).
// Tên GPU tích hợp phổ biến (Vulkan/llama.cpp in đúng tên này):
//   AMD APU: "AMD Radeon(TM) Graphics", "AMD Radeon(TM) Vega 8 Graphics", "AMD Radeon 780M", "Radeon 680M"
//   Intel: "Intel(R) UHD Graphics 620", "Intel(R) Iris(R) Xe Graphics", "Intel(R) HD Graphics", "Intel(R) Graphics", "Intel(R) Arc(TM) Graphics" (Meteor Lake, tích hợp)
// GPU rời: "NVIDIA GeForce …", "AMD Radeon RX …", "Radeon Pro …", "Intel(R) Arc(TM) A770 Graphics"
const INTEGRATED = [
  /\bradeon\s*(?:\(tm\))?\s*(?:vega\s*\d*\s*)?graphics\b/i,
  /\bradeon\s*(?:\(tm\))?\s*\d{3,4}m\b/i,
  /\bintel\b.*\b(?:uhd|iris|hd graphics)\b/i,
  /^intel\s*(?:\(r\))?\s*graphics\b/i,
  /\bintel\b.*\barc\s*(?:\(tm\))?\s*graphics\b/i,
  /\b(?:adreno|mali|llvmpipe|swiftshader|lavapipe)\b/i,
];
const DISCRETE = [/\bnvidia\b|\bgeforce\b|\bquadro\b|\brtx\b|\bgtx\b|\btesla\b/i, /\bradeon\s*(?:\(tm\))?\s*(?:rx|pro)\b/i, /\barc\s*(?:\(tm\))?\s*[ab]\d{3}/i, /\bfirepro\b|\binstinct\b/i];
function isIntegrated(name) { const n = String(name || ''); if (DISCRETE.some(r => r.test(n))) return false; return INTEGRATED.some(r => r.test(n)); }
function isDiscrete(name) { const n = String(name || ''); return DISCRETE.some(r => r.test(n)) || (!!n && !isIntegrated(n) && !/^cpu/i.test(n)); }
// devs: [{ id: 'Vulkan0', name, totalMiB, freeMiB }] (llama-server --list-devices) hoặc chuỗi tên (node-llama-cpp)
// pref: null/'' = tự động (GPU rời lớn nhất), số = chỉ số trong danh sách, chuỗi = id ("Vulkan1") hoặc tên.
function pick(devs, pref = null) {
  const list = (devs || []).map((d, i) => typeof d === 'string' ? { id: null, name: d, index: i } : { ...d, index: i }).filter(d => !/^cpu/i.test(String(d.id || '')));
  if (!list.length) return null;
  if (pref != null && pref !== '') {
    const byIdx = Number.isInteger(pref) ? list.find(d => d.index === pref) : null;
    const hit = byIdx || list.find(d => d.id && String(d.id).toLowerCase() === String(pref).toLowerCase()) || list.find(d => d.name === pref);
    if (hit) return { ...hit, integrated: isIntegrated(hit.name), manual: true };
  }
  const dis = list.filter(d => !isIntegrated(d.name));
  const pool = dis.length ? dis : list;
  const best = pool.slice().sort((a, b) => (b.totalMiB || 0) - (a.totalMiB || 0) || a.index - b.index)[0];
  return { ...best, integrated: isIntegrated(best.name), manual: false };
}
// tên theo thứ tự hiển thị: GPU rời trước
const order = (names) => (names || []).slice().sort((a, b) => Number(isIntegrated(a)) - Number(isIntegrated(b)));
// nhiều GPU và có cả tích hợp lẫn rời → cần chọn rõ thiết bị (không để llama.cpp/Vulkan tự quyết)
const mixed = (devs) => { const n = (devs || []).map(d => typeof d === 'string' ? d : d.name).filter(Boolean); return n.length > 1 && n.some(isIntegrated) && n.some(x => !isIntegrated(x)); };
// B165: trần ngữ cảnh theo VRAM GPU rời (KV f16 của 4B ≈ 144 KB/token: 16K ≈ 2,3 GB, 64K ≈ 9 GB)
function ctxCapFor(h) {
  const vt = h && h.gpu && h.gpu !== 'metal' && h.vram && !h.vram.integratedOnly ? h.vram.total : 0;
  if (!(vt > 0)) return Infinity;
  return vt < 6 * 1024 ** 3 ? 16384 : vt < 10 * 1024 ** 3 ? 32768 : Infinity;
}
module.exports = { isIntegrated, isDiscrete, pick, order, mixed, ctxCapFor };
