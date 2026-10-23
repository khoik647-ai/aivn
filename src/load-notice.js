'use strict';
// B71 (máy thật: gpt-oss-20b 12,1 GB trên 4070 SUPER 12 GB): thông báo cũ “GPU không nạp được mô hình này…” kèm lỗi gốc của
// node-llama-cpp “A context size of 8192 is too large for the available VRAM” trong khi mô hình THỰC RA đã nạp GPU một phần
// (15/25 lớp) với ngữ cảnh 16384 — mâu thuẫn. Thông báo nói đúng trạng thái CUỐI: chế độ, số lớp trên GPU, ngữ cảnh thật.
// B197: câu dựng ở tiến trình chính. Truyền hàm dịch (T) để en/zh không còn hiện tiếng Việt; không truyền thì giữ tiếng Việt.
const MODE_VI = { gpu: 'GPU', 'gpu-partial': 'GPU một phần + CPU', 'gpu-manual': 'GPU (số lớp tự chọn)', cpu: 'CPU', 'cpu-only': 'CPU (không dùng GPU)' };
const LOCALE = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN' };
function formatCount(n, lang) { return Number(n).toLocaleString(LOCALE[lang] || 'vi-VN'); }
// lỗi gốc của từng phương án đã thử → câu dễ hiểu (không lặp con số ngữ cảnh tối thiểu dễ gây hiểu lầm)
function attemptText(a) {
  const s = String(a || ''); const head = s.split(':')[0].trim();
  if (/too large for the available VRAM|out of memory|failed to allocate|cudaMalloc|ErrorOutOfDeviceMemory|not enough (?:V)?RAM/i.test(s)) return `${head}: không đủ VRAM`;
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
}
function loadNotice(st = {}, tr, lang) {
  const t = typeof tr === 'function' ? tr : (s) => s;
  const ctx = st.contextSize ? formatCount(st.contextSize, lang) : null; const mode = MODE_VI[st.mode] || st.mode || '';
  const layers = Number.isInteger(st.gpuLayers) && st.totalLayers ? `${st.gpuLayers}/${st.totalLayers} lớp trên GPU` : null;
  const slow = st.slow || (st.offload && st.offload.slow) || null;
  const shown = (n) => formatCount(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10, lang);
  if (slow && slow.tps > 0 && slow.expected > 0) {
    const tps = shown(slow.tps);
    const exp = shown(slow.expected);
    const cpuish = st.mode === 'cpu' || st.mode === 'cpu-only' || !(Number(st.gpuLayers) > 0);
    if (cpuish && ctx) return t(`GPU chạy quá chậm (${tps} token/giây, mức khoảng ${exp}), AIVN đã chuyển sang ${mode}, ngữ cảnh ${ctx}.`);
    if (layers && ctx) return t(`GPU chạy quá chậm (${tps} token/giây, mức khoảng ${exp}), AIVN đã giảm xuống ${layers}, ngữ cảnh ${ctx}.`);
  }
  if (slow && (slow.reason === 'vram' || !(slow.tps > 0))) {
    const cpuish = st.mode === 'cpu' || st.mode === 'cpu-only' || !(Number(st.gpuLayers) > 0);
    if (cpuish && ctx) return t(`VRAM gần hết sau khi nạp, AIVN đã chuyển sang ${mode}, ngữ cảnh ${ctx}.`);
    if (layers && ctx) return t(`VRAM gần hết sau khi nạp, AIVN đã giảm xuống ${layers}, ngữ cảnh ${ctx}.`);
  }
  const partial = st.mode === 'gpu-partial' || (st.mode === 'gpu-manual' && st.gpuLayers < st.totalLayers);
  // Chế độ có ngoặc trong tên (“GPU (số lớp tự chọn)”) không được nhét vào mẫu “{0} ({1})” — mẫu đó cắt đôi tên và en/zh giữ tiếng Việt.
  if (partial && layers && ctx && mode.includes('(')) return t(`Đã nạp bằng ${mode}, ${layers}, ngữ cảnh ${ctx}. Mô hình không vừa trọn VRAM nên phần còn lại chạy bằng CPU — chậm hơn nhưng vẫn dùng được.`);
  if (partial && layers && ctx) return t(`Đã nạp bằng ${mode} (${layers}), ngữ cảnh ${ctx}. Mô hình không vừa trọn VRAM nên phần còn lại chạy bằng CPU — chậm hơn nhưng vẫn dùng được.`);
  if (partial) return t(`Đã nạp bằng ${mode}${layers ? ` (${layers})` : ''}${ctx ? `, ngữ cảnh ${ctx}` : ''}. Mô hình không vừa trọn VRAM nên phần còn lại chạy bằng CPU — chậm hơn nhưng vẫn dùng được.`);
  if (st.mode === 'gpu' && ctx) return t(`Đã nạp trên GPU, ngữ cảnh ${ctx}.`);
  if (st.mode === 'gpu') return t(`Đã nạp trên GPU${ctx ? `, ngữ cảnh ${ctx}` : ''}.`);
  if (ctx) return t(`GPU không nạp được mô hình này, AIVN đã chuyển sang ${mode}, ngữ cảnh ${ctx} (chậm hơn nhưng vẫn dùng được).`);
  return t(`GPU không nạp được mô hình này, AIVN đã chuyển sang ${mode}${ctx ? `, ngữ cảnh ${ctx}` : ''} (chậm hơn nhưng vẫn dùng được).`);
}
function ctxReducedNote(requested, applied, tr, lang) {
  const t = typeof tr === 'function' ? tr : (s) => s;
  return t(`Đã dùng ngữ cảnh ${formatCount(applied, lang)} thay vì ${formatCount(requested, lang)} vì lần nạp trước mô hình chỉ vừa ở ngữ cảnh đó.`);
}
module.exports = { loadNotice, attemptText, MODE_VI, ctxReducedNote, formatCount };
