'use strict';
// Thẻ xin phép chung cho công cụ có tác động (ghi/xoá tệp, chạy mã/lệnh, đóng ứng dụng, công cụ MCP…)
const fs = require('fs');

// allowAlways: có cho phép bật "Luôn cho phép công cụ này" không (xoá tệp: không bao giờ)
const APPROVE = {
  write_file: { allowAlways: true, warn: 'AIVN AGENT sẽ tạo/ghi đè tệp trong các thư mục được phép mà KHÔNG hỏi lại.' },
  delete_file: { allowAlways: false },
  run_python: { allowAlways: true, warn: 'Mã Python do mô hình viết sẽ chạy ngay mà không hỏi lại (vẫn trong thư mục tạm, chặn mạng).' },
  run_command: { allowAlways: true, warn: 'Lệnh hệ thống do mô hình chọn sẽ chạy ngay mà không hỏi lại.' },
  close_app: { allowAlways: true, warn: 'AIVN AGENT sẽ đóng ứng dụng mà không hỏi lại — dữ liệu chưa lưu có thể mất.' },
  system_action: { allowAlways: true, warn: 'Các thao tác hệ thống (khoá máy, âm lượng…) sẽ chạy ngay mà không hỏi lại.' }
};
const isMcp = (name) => /^mcp__/.test(name);
function needsApproval(name) { return !!APPROVE[name] || isMcp(name); }
function policy(name) { return APPROVE[name] || (isMcp(name) ? { allowAlways: true, warn: 'Công cụ này của máy chủ MCP sẽ chạy mà không hỏi lại. Máy chủ MCP chạy mã trên máy bạn.' } : { allowAlways: false }); }

// so sánh từng dòng (LCS), gọn: giữ 2 dòng ngữ cảnh quanh chỗ đổi
function lineDiff(a, b, { maxLines = 400, context = 2 } = {}) {
  const A = String(a).split('\n').slice(0, maxLines), B = String(b).split('\n').slice(0, maxLines);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { ops.push([' ', A[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', A[i++]]); else ops.push(['+', B[j++]]); }
  while (i < n) ops.push(['-', A[i++]]); while (j < m) ops.push(['+', B[j++]]);
  const keep = ops.map((o, k) => o[0] !== ' ' || ops.slice(Math.max(0, k - context), k + context + 1).some(x => x[0] !== ' '));
  const out = []; let skipped = 0;
  ops.forEach((o, k) => { if (keep[k]) { if (skipped) { out.push(`  … ${skipped} dòng không đổi`); skipped = 0; } out.push(o[0] + ' ' + o[1]); } else skipped++; });
  if (skipped) out.push(`  … ${skipped} dòng không đổi`);
  const added = ops.filter(o => o[0] === '+').length, removed = ops.filter(o => o[0] === '-').length;
  return { text: out.join('\n'), added, removed, truncated: String(a).split('\n').length > maxLines || String(b).split('\n').length > maxLines };
}

// dựng thẻ: { tool, title, fields:[[nhãn, giá trị]], preview, diff, path, allowAlways, warn, danger }
function buildCard(name, args, { label, icon, resolvePath = null } = {}) {
  const a = args || {}; const p = policy(name);
  const card = { tool: name, label: label || name, icon: icon || '🔧', title: `AIVN AGENT muốn dùng “${label || name}”`, fields: [], preview: null, diff: null, path: null, allowAlways: p.allowAlways, warn: p.warn || '', danger: false };
  const trunc = (s, n = 6000) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + `\n… (còn ${(s.length - n).toLocaleString('vi-VN')} ký tự)` : s; };
  if (name === 'write_file') {
    let full = null; try { full = resolvePath ? resolvePath(a.path, { allowMissing: true }).full : a.path; } catch (e) { full = String(a.path || ''); }
    card.path = full; const content = String(a.content ?? '');
    const exists = !!(full && fs.existsSync(full) && fs.statSync(full).isFile());
    const mode = a.mode === 'append' ? 'append' : exists ? 'overwrite' : 'create';
    card.title = mode === 'create' ? 'Tạo tệp mới?' : mode === 'append' ? 'Thêm vào cuối tệp?' : 'Ghi đè tệp?';
    card.fields.push(['Tệp', full || String(a.path || '')], ['Cách ghi', mode === 'create' ? 'tạo mới' : mode === 'append' ? 'thêm vào cuối' : 'ghi đè (thay toàn bộ nội dung)'], ['Kích thước', `${Buffer.byteLength(content).toLocaleString('vi-VN')} byte · ${content.split('\n').length} dòng`]);
    if (mode === 'overwrite') { let old = ''; try { old = fs.readFileSync(full, 'utf8'); } catch {} const d = lineDiff(old, content); card.diff = d; card.danger = true; card.fields.push(['Thay đổi', `+${d.added} dòng / −${d.removed} dòng`]); }
    else card.preview = trunc(content);
  } else if (name === 'delete_file') {
    let full = a.path; try { full = resolvePath ? resolvePath(a.path).full : a.path; } catch {}
    card.title = 'Xoá tệp?'; card.path = full; card.danger = true; card.fields.push(['Tệp', String(full || '')], ['Kết quả', 'Chuyển vào Thùng rác (khôi phục được)']);
  } else if (name === 'run_python' || name === 'run_javascript') {
    card.title = 'Chạy đoạn mã này?'; card.preview = trunc(a.code || '', 8000);
  } else if (name === 'run_command') {
    card.title = 'Chạy lệnh này?'; card.danger = true; card.preview = trunc([a.command, ...(Array.isArray(a.args) ? a.args : [])].filter(Boolean).join(' '), 2000);
    for (const [k, v] of Object.entries(a)) if (!['command', 'args'].includes(k)) card.fields.push([k, typeof v === 'string' ? v : JSON.stringify(v)]);
  } else {
    if (isMcp(name)) { const [, server, tool] = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/) || []; card.title = `Dùng công cụ MCP “${tool || name}”${server ? ` (máy chủ ${server})` : ''}?`; }
    for (const [k, v] of Object.entries(a)) card.fields.push([k, typeof v === 'string' ? trunc(v, 1200) : trunc(JSON.stringify(v, null, 1), 1200)]);
  }
  return card;
}
// câu trả về cho mô hình khi người dùng từ chối
function refusalText(card, reason) {
  const r = String(reason || '').trim().slice(0, 500);
  return r ? `Người dùng TỪ CHỐI bước "${card.label}" với lý do: "${r}". KHÔNG làm bước này như cũ; làm theo góp ý đó (có thể gọi lại công cụ với tham số đã sửa) hoặc hỏi lại người dùng.`
    : `Người dùng TỪ CHỐI bước "${card.label}". Không làm bước này và không thử lại bằng cách khác; hỏi người dùng muốn làm gì tiếp.`;
}
module.exports = { APPROVE, needsApproval, policy, buildCard, lineDiff, refusalText, isMcp };
