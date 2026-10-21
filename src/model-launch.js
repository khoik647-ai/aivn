// Tham số riêng cho llama-server theo từng mô hình (mục 4 + 6 của danh sách mô hình agent mới).
//  - mục 4: Qwen3.5/3.6/3.8, Holo3.x/Holo4, UI-Venus-2, Fara1.5, Gemma 4 bật suy nghĩ mặc định → --reasoning off
//    (llama.cpp #20837: Qwen3.5 suy nghĩ thì in lời gọi công cụ trong khối suy nghĩ rồi dừng; #28827: Gemma 4 thêm rác cuối).
//  - mục 6: mô hình MoE (35B-A3B…) trên GPU 12 GB: llama-server b11751 mặc định --fit on (tự đẩy chuyên gia MoE sang CPU cho vừa VRAM,
//    phần nhìn ảnh vẫn ở GPU vì AIVN không đặt --no-mmproj-offload khi có GPU). Người dùng/danh mục có thể đặt số lớp cố định --n-cpu-moe N.
// Chỉ nhận cờ trong danh sách cho phép, giá trị số hoặc on/off — không bao giờ ghép chuỗi tuỳ ý từ danh mục/cài đặt vào dòng lệnh.
const THINKS = new Set(['holo3', 'venus2', 'fara', 'qwen35', 'gemma4']);
const ALLOW = {
  '--reasoning': /^(?:on|off|auto)$/,
  '--n-cpu-moe': /^\d{1,3}$/,
  '--moe-cache-mib': /^\d{1,6}$/,
  '--image-max-tokens': /^\d{2,5}$/,
  '--cache-type-k': /^(?:f16|q8_0|q4_0)$/,
  '--cache-type-v': /^(?:f16|q8_0|q4_0)$/,
};
const isMoe = (id, c) => /(?:^|[-_.])a\d+(?:\.\d+)?b(?:[-_.]|$)|moe/i.test(String(id || '')) || /moe/i.test(String((c && c.arch) || ''));
function sanitize(list) {
  const out = []; const a = Array.isArray(list) ? list.map(String) : [];
  for (let i = 0; i < a.length; i++) {
    const re = ALLOW[a[i]]; if (!re) continue;
    const v = a[i + 1]; if (v == null || !re.test(v)) { i++; continue; }
    const k = out.indexOf(a[i]); if (k >= 0) out.splice(k, 2);
    out.push(a[i], v); i++;
  }
  return out;
}
// { id, family, catalog, load: { cpuMoe, reasoning } } → mảng tham số thêm cho llama-server
function launchArgs({ id = '', family = '', catalog = null, load = {} } = {}) {
  const base = [];
  if (THINKS.has(family)) base.push('--reasoning', 'off');
  const fromCat = sanitize(catalog && catalog.launch);
  const user = [];
  if (load && Number.isInteger(load.cpuMoe) && load.cpuMoe >= 0 && load.cpuMoe <= 999) user.push('--n-cpu-moe', String(load.cpuMoe));
  if (load && /^(?:on|off|auto)$/.test(String(load.reasoning || ''))) user.push('--reasoning', String(load.reasoning));
  return sanitize([...base, ...fromCat, ...user]);
}
module.exports = { launchArgs, sanitize, isMoe, THINKS, ALLOW };
