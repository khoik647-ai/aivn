'use strict';
// Khớp tên mô hình do client gửi. Không dùng includes(): "3b" không được trúng "qwen2.5-3b-…".
// Thứ tự: đúng id, đúng một tên tệp bỏ .gguf, rồi tiền tố duy nhất cắt ở dấu - _ hoặc .
// Hai tệp cùng tên gốc, hoặc hai id cùng một tiền tố: không khớp.

function normId(id) {
  return String(id || '').toLowerCase().replace(/\.gguf$/i, '');
}

function basenameOf(m) {
  const file = m && (m.file || m.path || m.id) || '';
  const base = String(file).split(/[/\\]/).pop();
  return normId(base);
}

function isPrefix(id, req) {
  if (!id.startsWith(req) || id.length === req.length) return false;
  const next = id[req.length];
  return next === '-' || next === '_' || next === '.';
}

// Tiền tố chỉ xét id trong thư mục mô hình. Đường dẫn tệp không được khớp theo tiền tố.
function looksLikePath(s) {
  const t = String(s || '');
  return /[\\/]/.test(t) || /^[a-z]:/i.test(t);
}

function prefixHits(list, requested) {
  const req = normId(requested);
  if (!req || looksLikePath(requested)) return [];
  return (list || []).filter((m) => m && m.id != null && !looksLikePath(m.id) && isPrefix(normId(m.id), req));
}

function resolveModel(list, requested) {
  const req = normId(requested);
  if (!req || !Array.isArray(list)) return null;
  const rows = list.filter(Boolean);
  const exact = rows.find((m) => normId(m.id) === req);
  if (exact) return exact;
  const bases = rows.filter((m) => basenameOf(m) === req && normId(m.id) !== req);
  if (bases.length > 1) return null;
  if (bases.length === 1) return bases[0];
  const prefixed = prefixHits(rows, requested);
  if (prefixed.length === 1) return prefixed[0];
  return null;
}

// Đúng một tiền tố thì resolveModel trả mô hình đó. Nhiều hơn một: không chọn, người gọi trả 409.
function ambiguousPrefix(list, requested) {
  const req = normId(requested);
  if (!req || !Array.isArray(list) || looksLikePath(requested)) return false;
  const rows = list.filter(Boolean);
  if (rows.some((m) => normId(m.id) === req)) return false;
  const bases = rows.filter((m) => basenameOf(m) === req && normId(m.id) !== req);
  if (bases.length === 1) return false;
  return prefixHits(rows, requested).length > 1;
}

function sameModel(a, b) {
  const x = normId(a);
  const y = normId(b);
  return x !== '' && x === y;
}

// 409 chỉ khi (a) tên trùng một mô hình có trên đĩa nhưng mô hình đang nạp là mô hình khác,
// hoặc (b) id đang nạp đổi trong lúc xử lý so với một mô hình ĐÃ nạp trước ensureModel.
// Tên lạ (gpt-4o-mini, claude-3-5-sonnet-latest, …) giữ mô hình đang nạp.
// Chưa nạp gì rồi lần nạp đang chạy xong: đó là mô hình để trả lời, không phải đổi mô hình.
function modelChanged(list, requested, before, after) {
  if (requested == null || requested === '') return null;
  const afterId = after && after.loaded && after.id ? String(after.id) : '';
  const beforeId = before && before.loaded && before.id ? String(before.id) : '';
  const hit = resolveModel(list || [], requested);
  if (hit) {
    if (!sameModel(afterId, hit.id)) {
      const have = afterId || 'chưa có mô hình';
      return `Mô hình đã đổi trong lúc nạp (${have}). Yêu cầu này không trả lời bằng mô hình khác. Hãy gửi lại.`;
    }
    return null;
  }
  if (!beforeId && afterId) return null;
  if (normId(beforeId) !== normId(afterId)) {
    const have = afterId || 'chưa có mô hình';
    return `Mô hình đã đổi trong lúc nạp (${have}). Yêu cầu này không trả lời bằng mô hình khác. Hãy gửi lại.`;
  }
  return null;
}

module.exports = { normId, resolveModel, sameModel, modelChanged, ambiguousPrefix };
