// B66b (máy thật, soạn Gmail, 8B): mô hình quay vòng 4 thao tác xen kẽ (hiện màn hình chính → quan sát “Program Manager” →
// thao tác lỗi → mở Cài đặt) ~10 vòng, 44 bước, 224 giây — bộ chặn lặp cũ chỉ bắt CÙNG một lời gọi lặp lại.
// Ở đây: (1) chuỗi lời gọi lặp lại theo chu kỳ 2–6 bước (ít nhất 2 lượt liền), (2) N bước liền không có tiến triển mới.
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
// chữ ký một bước: tên công cụ + tham số chính (bỏ id phần tử eN, toạ độ, số đếm) — hai lần “cùng việc” cho cùng chữ ký
function stepSig(name, args = {}) {
  const a = args || {}; const keep = ['action', 'name', 'window', 'keys', 'url', 'path', 'app', 'query', 'element', 'text'];
  const parts = keep.filter(k => a[k] != null && a[k] !== '').map(k => `${k}=${fold(a[k]).replace(/\be\d+\b/g, 'e#').replace(/\d+/g, '#').slice(0, 60)}`);
  return `${name}(${parts.join(',')})`;
}
// kết quả: bỏ số, id, giờ → hai kết quả giống nhau = không có gì mới
const outSig = (summary) => fold(summary).replace(/^\(lap lai\)\s*/, '').replace(/\[e\d+\]|\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 160);
function findCycle(seq, { minP = 2, maxP = 6, reps = 2 } = {}) {
  for (let p = minP; p <= maxP; p++) {
    const need = p * reps; if (seq.length < need) break;
    const tail = seq.slice(-need); const block = tail.slice(0, p);
    if (new Set(block).size < 2) continue; // chu kỳ 1 (cùng một lời gọi) do bộ chặn cũ lo
    if (tail.every((x, i) => x === block[i % p])) return { period: p, block };
  }
  return null;
}
function createCycleGuard({ window = 12 } = {}) {
  const seq = []; const seenOut = new Set(); let sinceProgress = 0; let progressN = 0;
  return {
    // progress: bước làm được (không lỗi, không bị chặn) cho kết quả CHƯA từng thấy, hoặc đã kiểm chứng gửi
    push(name, args, out = {}) {
      const sig = stepSig(name, args); seq.push(sig);
      const ok = out && !out.error && !out.refused && !out.bad;
      const os = sig + ' → ' + outSig(out && out.summary);
      const fresh = ok && !seenOut.has(os) && !/^\(lap lai\)/.test(fold(out && out.summary));
      seenOut.add(os);
      if ((out && out.verified) || fresh) { sinceProgress = 0; progressN++; } else sinceProgress++;
    },
    stuck() {
      const c = findCycle(seq);
      if (c) return { kind: 'cycle', period: c.period, why: `lặp lại cùng một chuỗi ${c.period} thao tác (${c.block.map(b => b.replace(/\(.*$/, '')).join(' → ')}) mà không tiến triển` };
      if (sinceProgress >= window) return { kind: 'noprogress', why: `${sinceProgress} bước liền không có tiến triển mới` };
      return null;
    },
    get length() { return seq.length; }, get sinceProgress() { return sinceProgress; }, get progress() { return progressN; },
  };
}
module.exports = { stepSig, outSig, findCycle, createCycleGuard };
