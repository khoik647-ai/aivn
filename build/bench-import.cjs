#!/usr/bin/env node
'use strict';
// Nhập tệp kết quả Bộ đo AIVN AGENT (AIVN-bench-*.json mà Khôi gửi lại) → bảng cho docs/verified.md và điểm trong src/bench-results.json.
//   node build/bench-import.cjs <tệp.json> [tệp2.json …]          in bảng (không ghi gì)
//   node build/bench-import.cjs <tệp.json> … --write               thêm bảng vào docs/verified.md + gộp điểm vào src/bench-results.json
// Ngưỡng cho bộ chọn mô hình AIVN AGENT nằm ở src/agent-bench-full.js (THRESH) và src/agent-eligibility.js.
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2); const write = args.includes('--write'); const files = args.filter(a => !a.startsWith('--'));
if (!files.length) { console.error('Cách dùng: node build/bench-import.cjs <AIVN-bench-….json> [--write]'); process.exit(2); }
const idOf = (file) => path.basename(String(file || '')).replace(/\.gguf$/i, '').toLowerCase();
const f = (x, t) => (x == null ? '—' : t != null ? `${x}/${t}` : String(x));
const GB = 1024 ** 3;
function machineLine(m) {
  const d = (m.displays || []).map(x => `${x.px} @${Math.round(x.scale * 100)}%`).join(', ');
  return [m.platform === 'win32' ? `Windows ${m.os || ''}`.trim() : m.platform, m.cpu, m.gpu && m.gpu !== 'none' ? `${m.gpu}${m.vram ? ` ${Math.round(m.vram / GB)} GB` : ''}` : 'không GPU', m.ram ? `RAM ${Math.round(m.ram / GB)} GB` : '', d].filter(Boolean).join(' · ');
}
function rows(R) {
  const out = [];
  out.push('| Mô hình | Nạp | Gọi công cụ (thô) | — trừ câu AIVN tự làm | Định vị | Điểm tác vụ | An toàn | Ứng dụng giả | Gửi nhầm | Vi phạm hộp cát | Thời gian | Kết luận |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of R.models) {
    const t = r.tools || {}; const it = t.items || []; const nd = it.filter(x => !x.direct);
    const load = r.load ? (r.load.error ? `lỗi: ${r.load.error}` : `${r.load.mode || ''} · ${r.load.ctx || ''} tok · ${r.load.gpuLayers != null ? r.load.gpuLayers + ' lớp GPU' : ''}${r.load.vram ? ` · VRAM ${(r.load.vram.bytes / GB).toFixed(1)} GB` : ''}`) : '—';
    out.push(`| ${r.model.size} ${r.model.quant} | ${load} | ${f(t.score, t.total)}${t.rate != null ? ` (${Math.round(t.rate * 100)}%)` : ''} | ${nd.length ? `${nd.filter(x => x.pass).length}/${nd.length}` : '—'} | ${f(r.grounding && r.grounding.score, r.grounding && r.grounding.total)} | ${f(r.tasks && r.tasks.score, 10)}${r.tasks && r.tasks.done < 10 ? ` (làm ${r.tasks.done})` : ''} | ${r.tasks ? (r.tasks.safety === null ? '—' : r.tasks.safety ? 'đạt' : '**KHÔNG**') : '—'} | ${f(r.apps && r.apps.score, r.apps && r.apps.total)} | ${r.apps ? (r.apps.wrongRecipient ? `**${r.apps.wrongRecipient}**` : '0') : '—'} | ${r.sandbox ? r.sandbox.violations.length : '—'} | ${r.seconds != null ? Math.round(r.seconds / 60) + ' phút' : '—'} | ${r.verdict ? (r.verdict.agentOk ? '✓ đạt' : '✘ chưa đạt') : '—'} |`);
  }
  const fails = [];
  for (const r of R.models) {
    for (const x of ((r.tools || {}).items || []).filter(x => !x.pass)) fails.push(`- ${r.model.size} gọi công cụ \`${x.id}\` (lần ${x.seed + 1}): ${x.call ? `${x.call.name} ${JSON.stringify(x.call.arguments)}` : x.error ? 'lỗi ' + x.error : 'không gọi công cụ' + (x.text ? ` — “${x.text.slice(0, 80)}”` : '')}`);
    for (const x of ((r.apps || {}).items || []).filter(x => !x.pass)) fails.push(`- ${r.model.size} ứng dụng giả \`${x.id}\`: ${x.skipped || (x.timeout ? 'hết giờ' : x.error || (x.state ? `đã gửi ${JSON.stringify(x.state.sent)}${x.state.mailSent && x.state.mailSent.length ? ', ĐÃ BẤM GỬI THƯ' : ''}` : x.reply.slice(0, 100)))}`);
    for (const x of ((r.tasks || {}).items || []).filter(x => !x.pass)) fails.push(`- ${r.model.size} Điểm tác vụ \`${x.id}\`: ${x.skipped || (x.timeout ? 'hết giờ' : (x.reply || '').slice(0, 100))}`);
  }
  return { table: out.join('\n'), fails };
}
const results = files.map(p => { const R = JSON.parse(fs.readFileSync(p, 'utf8')); if (R.kind !== 'aivn-agent-bench') throw new Error(`${p}: không phải tệp kết quả Bộ đo AIVN AGENT`); return R; });
let md = '';
for (const R of results) {
  const { table, fails } = rows(R);
  md += `\n### Bộ đo AIVN AGENT ${R.app} — ${machineLine(R.machine)} (${R.started.slice(0, 10)})\n\n${R.stopped ? '_Đã dừng giữa chừng — số liệu chưa đủ._\n\n' : ''}${table}\n\nNgưỡng: gọi công cụ ≥ ${Math.round(R.thresholds.tools * 100)}%, Điểm tác vụ ≥ ${R.thresholds.tasks}/10 + an toàn, ứng dụng giả không gửi nhầm người. “Trừ câu AIVN tự làm”: bỏ các câu âm lượng mà AIVN AGENT thật làm thẳng (sys-intent.js), không qua mô hình.\n${fails.length ? `\nCác lần trượt:\n${fails.join('\n')}\n` : ''}`;
}
process.stdout.write(md + '\n');
if (write) {
  const doc = path.join(root, 'docs/verified.md'); let d = fs.readFileSync(doc, 'utf8');
  if (!/## 0\.16 beta\.2 — Bộ đo AIVN AGENT trên máy thật/.test(d)) d += '\n## 0.16 beta.2 — Bộ đo AIVN AGENT trên máy thật\n';
  fs.writeFileSync(doc, d.trimEnd() + '\n' + md);
  const bp = path.join(root, 'src/bench-results.json'); const B = JSON.parse(fs.readFileSync(bp, 'utf8')); B.models = B.models || {};
  for (const R of results) for (const r of R.models) {
    if (!r.verdict) continue; const id = idOf(r.model.file); const cur = B.models[id] || {};
    B.models[id] = { ...cur,
      ...(r.grounding && r.grounding.total === 10 && (!cur.grounding || cur.grounding.score <= r.grounding.score) ? { grounding: { score: r.grounding.score, total: 10, seconds: r.grounding.seconds, date: r.started } } : {}),
      real: [...(cur.real || []).filter(x => x.machine !== machineLine(R.machine)), { machine: machineLine(R.machine), app: R.app, date: r.started, tools: r.tools && r.tools.rate, tasks: r.tasks && r.tasks.score, safety: r.tasks && r.tasks.safety, apps: r.apps && r.apps.score, appsTotal: r.apps && r.apps.total, wrongRecipient: r.apps && r.apps.wrongRecipient, agentOk: r.verdict.agentOk, ctx: r.load && r.load.ctx, gpuLayers: r.load && r.load.gpuLayers }] };
  }
  fs.writeFileSync(bp, JSON.stringify(B, null, 1) + '\n');
  console.error('Đã ghi docs/verified.md và src/bench-results.json');
}
