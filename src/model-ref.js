'use strict';
// Khớp tên mô hình do client gửi. Không dùng includes(): "3b" không được trúng "qwen2.5-3b-…".
// Thứ tự: đúng id, đúng tên tệp bỏ .gguf, rồi tiền tố duy nhất cắt ở dấu - _ hoặc .

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

function resolveModel(list, requested) {
  const req = normId(requested);
  if (!req || !Array.isArray(list)) return null;
  const rows = list.filter(Boolean);
  const exact = rows.find((m) => normId(m.id) === req);
  if (exact) return exact;
  const base = rows.find((m) => basenameOf(m) === req && normId(m.id) !== req);
  if (base) return base;
  const prefixed = rows.filter((m) => isPrefix(normId(m.id), req));
  if (prefixed.length === 1) return prefixed[0];
  return null;
}

function sameModel(a, b) {
  const x = normId(a);
  const y = normId(b);
  return x !== '' && x === y;
}

// 409 chỉ khi (a) tên trùng một mô hình có trên đĩa nhưng mô hình đang nạp là mô hình khác,
// hoặc (b) id đang nạp đổi trong lúc xử lý so với trước ensureModel.
// Tên lạ (gpt-4o-mini, claude-3-5-sonnet-latest, …) giữ mô hình đang nạp.
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
  if (normId(beforeId) !== normId(afterId)) {
    const have = afterId || 'chưa có mô hình';
    return `Mô hình đã đổi trong lúc nạp (${have}). Yêu cầu này không trả lời bằng mô hình khác. Hãy gửi lại.`;
  }
  return null;
}

module.exports = { normId, resolveModel, sameModel, modelChanged };
