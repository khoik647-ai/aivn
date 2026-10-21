'use strict';
// QA runner không giao diện (beta.3) — chỉ để bot QA chạy thử trên máy thật từ PowerShell:
//   AIVN.exe --agent-task "<lệnh>" --model <id | 2b | 4b | 8b> --out <result.json> [--shots <thư mục>] [--timeout <giây>] [--lang vi|en|zh]
// Chỉ bật khi biến môi trường AIVN_QA_MODE=1 VÀ có cờ --agent-task; thiếu một trong hai → bỏ qua cờ, ghi cảnh báo.
// KHÔNG có cổng mạng/HTTP (chỉ dòng lệnh). Chạy đúng vòng AIVN AGENT bình thường, MỌI cổng an toàn giữ nguyên;
// bước cần xin phép (gửi/xoá/mua/khoá/âm lượng…) luôn bị TỪ CHỐI tự động — không bao giờ tự cho phép.
// Mã thoát: 0 = done · 2 = failed/blocked · 3 = asked_user.
const fs = require('fs'); const path = require('path');

const FLAGS = { '--agent-task': 'task', '--qa-ui': 'script', '--profile': 'profile', '--model': 'model', '--out': 'out', '--shots': 'shots', '--timeout': 'timeout', '--lang': 'lang', '--qa-input-diag': 'inputDiag' };
const BOOL = new Set(['--qa-input-diag']); // cờ không nhận giá trị
const LANGS = ['vi', 'en', 'zh'];
// lệnh nói rõ “chỉ soạn, đừng gửi”: lời từ chối mang lý do đó để AIVN AGENT dừng trước bước gửi (vẫn KHÔNG cho phép)
const DRAFT_RE = /(chỉ soạn|soạn sẵn|không gửi|đừng gửi|chưa gửi|don't send|do not send|draft only|只起草|不要发送|别发送|先不要发)/iu;
// thẻ xin phép của bước quan trọng — kể cả khi thiếu cờ risk, chữ trên thẻ nói tới các việc này cũng bị từ chối
const RISK_RE = /(gửi|send|发送|xo[áa]|delete|删除|mua|thanh to[áa]n|purchase|buy|pay|购买|支付|kho[áa] m[áa]y|lock|锁|âm lượng|volume|音量|tắt máy|shutdown|restart|khởi động lại)/iu;

function parseArgs(argv = []) {
  const a = {}; let seen = false;
  for (let i = 0; i < argv.length; i++) {
    let k = String(argv[i]); let v;
    const eq = k.indexOf('='); if (k.startsWith('--') && eq > 0) { v = k.slice(eq + 1); k = k.slice(0, eq); }
    if (!(k in FLAGS)) continue; seen = true;
    if (v === undefined && BOOL.has(k)) v = '1';
    if (v === undefined) { v = argv[i + 1]; if (v === undefined || String(v).startsWith('--')) v = ''; else i++; }
    a[FLAGS[k]] = String(v);
  }
  return seen ? a : null;
}
// kiểm tra & chuẩn hoá; trả { ok, args, error }
function validate(a, { cwd = process.cwd() } = {}) {
  if (!a) return { ok: false, error: 'không có cờ QA' };
  const task = String(a.task || '').trim(); if (!task) return { ok: false, error: 'thiếu --agent-task "<lệnh>"' };
  if (task.length > 4000) return { ok: false, error: '--agent-task quá dài (tối đa 4000 ký tự)' };
  if (!a.out) return { ok: false, error: 'thiếu --out <result.json>' };
  const out = path.resolve(cwd, a.out); const shots = a.shots ? path.resolve(cwd, a.shots) : null;
  let timeout = a.timeout ? Number(a.timeout) : 600; if (!(timeout > 0)) return { ok: false, error: '--timeout phải là số giây > 0' }; timeout = Math.min(timeout, 3600);
  const lang = a.lang ? String(a.lang).toLowerCase() : null; if (lang && !LANGS.includes(lang)) return { ok: false, error: '--lang chỉ nhận vi, en hoặc zh' };
  return { ok: true, args: { task, model: a.model ? String(a.model).trim() : null, out, shots, timeout, lang, profile: a.profile ? path.resolve(cwd, a.profile) : null } };
}
// cổng bật: AIVN_QA_MODE=1 VÀ có cờ. Trả { enabled, args, warn }
function fromArgv(argv, env = process.env, opts) {
  const raw = parseArgs(argv); if (!raw) return { enabled: false, args: null, warn: null };
  if (String(env.AIVN_QA_MODE || '') !== '1') return { enabled: false, args: null, warn: 'Có cờ QA (--agent-task / --qa-ui / --qa-input-diag) nhưng thiếu biến môi trường AIVN_QA_MODE=1 → bỏ qua cờ QA, mở AIVN bình thường.' };
  const kinds = [raw.task != null && 'agent-task', raw.script != null && 'qa-ui', raw.inputDiag != null && 'input-diag'].filter(Boolean);
  if (kinds.length > 1) return { enabled: false, args: null, invalid: true, warn: 'Cờ QA không hợp lệ: chỉ dùng một trong --agent-task, --qa-ui hoặc --qa-input-diag mỗi lần chạy' };
  const kind = kinds[0] || 'agent-task';
  const v = validateKind(kind, raw, opts); if (!v.ok) return { enabled: false, args: null, invalid: true, warn: `Cờ QA không hợp lệ: ${v.error}` };
  return { enabled: true, kind, args: v.args, warn: null };
}
function validateKind(kind, raw, opts) { return kind === 'qa-ui' ? require('./qa-ui').validate(raw, opts) : kind === 'input-diag' ? require('./qa-input-diag').validate(raw, opts) : validate(raw, opts); }
// 2b/4b/8b → Qwen3-VL Instruct đã có trên máy; còn lại: đúng id / tên tệp
function resolveModel(want, models = []) {
  if (!want) return null; const w = String(want).toLowerCase();
  const alias = /^(2|4|8)b$/.exec(w);
  if (alias) { const re = new RegExp(`qwen3-vl-${alias[1]}b-instruct`, 'i'); return models.find(m => re.test(m.id) || re.test(m.file || '')) || null; }
  return models.find(m => String(m.id).toLowerCase() === w) || models.find(m => String(m.file || '').toLowerCase() === w || String(m.file || '').toLowerCase() === w + '.gguf')
    || models.find(m => m.catalog && String(m.catalog.id).toLowerCase() === w) || null;
}
const isRiskyAsk = (req = {}) => !!req.risk || RISK_RE.test([req.title, req.desc, req.text, req.label, req.tool, req.message].filter(Boolean).join(' '));
// thẻ xin phép bất kỳ trong chế độ QA → luôn từ chối bước quan trọng; bước thường (không rủi ro) của lớp phủ màn hình được làm như bài đo
function answerFor(req, { draft }) {
  if (isRiskyAsk(req)) return { ok: false, reason: draft ? 'Chỉ soạn sẵn, đừng gửi (chế độ QA: tự từ chối bước cần xin phép)' : 'Chế độ QA: tự từ chối bước cần xin phép' };
  return { ok: true, reason: '' };
}
// trạng thái trung thực từ kết quả AIVN AGENT
function statusOf(r, { denied = 0, draft = false, error = null, timedOut = false } = {}) {
  if (timedOut) return { status: 'failed', reason: 'hết thời gian (--timeout)' };
  if (error) return { status: error.code === 'AGENT_GATE' || error.code === 'NOT_ACTIVATED' || error.code === 'NO_MODEL' ? 'blocked' : 'failed', reason: String(error.message || error) };
  if (!r) return { status: 'failed', reason: 'không có kết quả' };
  if (r.outcome === 'asked_user' || r.asked) return { status: 'asked_user', question: String(r.text || ''), reason: r.asked ? String(r.asked) : 'hỏi lại người dùng' };
  if (r.finishReason === 'abort') return { status: 'failed', reason: 'bị dừng' };
  if (denied > 0 && !draft) return { status: 'blocked', reason: `${denied} bước cần xin phép đã bị tự từ chối (chế độ QA không bao giờ tự cho phép)` };
  if (r.outcome === 'blocked') return { status: 'blocked', reason: String(r.warning || r.text || '').slice(0, 300) };
  if (r.outcome === 'failed') return { status: 'failed', reason: String(r.text || '').slice(0, 300) };
  return { status: 'done' };
}
const exitCodeOf = (status) => status === 'done' ? 0 : status === 'asked_user' ? 3 : 2;
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp-' + process.pid; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8'); fs.renameSync(tmp, file); }
// dòng nhật ký có toạ độ bấm / mã phím (B62/B66c) → gắn vào bước
const DEBUG_LINE = /(toạ độ|tọa độ|\bVK\b|scan|flags|bấm tại|click|nhấn phím|phím|DPI|scale|→ \(\d+|\(\d+,\s*\d+\))/i;

// deps: { version, commit, engine, listModels, loadById, runAgentTurn, desk, displays, capture, activated, setLang, LOG }
async function run(args, deps, { runId = String(Date.now()) } = {}) {
  const t0 = Date.now(); const draft = DRAFT_RE.test(args.task);
  const res = { schema: 1, runId, version: deps.version || null, commit: deps.commit || null, task: args.task, lang: args.lang, model: null, screen: null,
    status: null, reason: null, question: null, finalAnswer: null, warning: null, approvals: [], steps: [], timings: { startedAt: new Date(t0).toISOString() }, log: [] };
  try { res.screen = deps.displays ? deps.displays() : null; } catch (e) { res.screen = { error: e.message }; }
  const lines = []; const untap = deps.LOG && deps.LOG.tap ? deps.LOG.tap((l) => { if (lines.length < 4000) lines.push(l.replace(/\n$/, '')); }) : () => {};
  const open = new Map(); let denied = 0, r = null, error = null, timedOut = false; let restoreLang = null;
  const ac = new AbortController(); const timer = setTimeout(() => { timedOut = true; ac.abort(); }, args.timeout * 1000);
  // ghi lại + trả lời một thẻ xin phép (đồng bộ). Thẻ ngoài lớp phủ màn hình (confirm/approve/screen) luôn coi là bước quan trọng → TỪ CHỐI
  const ask = (kind, req = {}) => { const risk = kind !== 'desk' || isRiskyAsk(req); const a = risk ? answerFor({ ...req, risk: true }, { draft }) : { ok: true, reason: '' }; if (!a.ok) denied++;
    res.approvals.push({ kind, at: Date.now() - t0, title: req.title || req.label || req.kind || null, tool: req.tool || null, risk, recipient: req.recipient || null, desc: String(req.desc || req.message || req.text || '').slice(0, 300), answer: a.ok ? 'allowed (không rủi ro)' : 'denied' });
    deps.LOG && deps.LOG.log('qa', `QA tự trả lời thẻ ${kind}: ${a.ok ? 'làm (không rủi ro)' : 'TỪ CHỐI'} — ${req.title || req.desc || req.kind || ''}`); return a; };
  try {
    if (deps.activated && !deps.activated()) { const e = new Error('Máy chưa kích hoạt AIVN'); e.code = 'NOT_ACTIVATED'; throw e; }
    if (args.lang && deps.setLang) restoreLang = deps.setLang(args.lang);
    const tl = Date.now();
    if (args.model) {
      const m = resolveModel(args.model, deps.listModels()); if (!m) { const e = new Error(`Không tìm thấy mô hình “${args.model}” trên máy`); e.code = 'NO_MODEL'; throw e; }
      const st0 = deps.engine.status(); if (!(st0.loaded && st0.path === m.path)) await deps.loadById(m.id, { reason: 'qa-runner' });
    }
    const st = deps.engine.status(); if (!st.loaded) { const e = new Error('Chưa nạp mô hình nào (dùng --model)'); e.code = 'NO_MODEL'; throw e; }
    res.model = { id: st.id, file: st.path ? path.basename(st.path) : null, mode: st.mode || null, contextSize: st.contextSize || null, gpuLayers: st.gpuLayers ?? null, totalLayers: st.totalLayers ?? null, gpu: st.gpu || null };
    res.timings.modelLoadMs = Date.now() - tl;
    if (args.shots) fs.mkdirSync(args.shots, { recursive: true });
    if (deps.desk && deps.desk.setBenchAnswer) deps.desk.setBenchAnswer((req) => ask('desk', req));
    const tr = Date.now(); let n = 0;
    r = await deps.runAgentTurn({ reqId: null, convoId: 'qa-' + runId, messages: [{ role: 'user', content: args.task }], headless: false, signal: ac.signal,
      qa: { confirm: async (req) => { ask('confirm', req); return false; }, confirmScreen: async (req) => { ask('screen', req); return { ok: false }; },
        approve: async (card) => { const x = ask('approve', card); return { ok: false, reason: x.reason }; },
        onStep: async (s) => {
          if (s.status === 'running' || s.status === 'pending') { open.set(s.id, { i0: lines.length, t: Date.now() }); return; }
          const o = open.get(s.id) || { i0: lines.length, t: Date.now() }; open.delete(s.id); n++;
          const step = { n, tool: s.name, args: s.args || null, status: s.status, summary: s.summary || null, verification: s.verify || s.check || null, durationMs: s.ms ?? (Date.now() - o.t), debug: lines.slice(o.i0).filter(l => DEBUG_LINE.test(l)).slice(0, 40), shot: null };
          if (args.shots && deps.capture) { try { const c = await deps.capture({ maxW: 1920 }); const f = path.join(args.shots, `step-${String(n).padStart(2, '0')}-${String(s.name || 'step').replace(/[^\w-]/g, '_')}.jpg`); fs.writeFileSync(f, Buffer.from(c.dataUrl.split(',')[1], 'base64')); step.shot = f; } catch (e) { step.shot = null; step.shotError = String(e.message || e).slice(0, 200); } }
          res.steps.push(step);
        } } });
    res.timings.agentMs = Date.now() - tr;
  } catch (e) { error = e; }
  finally { clearTimeout(timer); untap(); if (deps.desk && deps.desk.setBenchAnswer) deps.desk.setBenchAnswer(null); if (restoreLang) { try { restoreLang(); } catch {} } }
  const s = statusOf(r, { denied, draft, error: timedOut ? null : error, timedOut });
  Object.assign(res, { status: s.status, reason: s.reason || null, question: s.question || null, finalAnswer: r ? r.text || '' : null, warning: r ? r.warning || null : null, draftOnly: draft, deniedApprovals: denied, exitCode: exitCodeOf(s.status) });
  res.timings.totalMs = Date.now() - t0; res.timings.finishedAt = new Date().toISOString();
  res.log = lines.slice(-600);
  try { writeJson(args.out, res); } catch (e) { deps.LOG && deps.LOG.log('qa', 'Không ghi được result.json: ' + e.message); }
  deps.LOG && deps.LOG.log('qa', `QA runner xong: ${s.status} (thoát ${res.exitCode}) sau ${res.timings.totalMs} ms → ${args.out}`);
  return res;
}
// bản mở thứ hai (đã có AIVN đang chạy): chờ result.json đúng runId do bản đang chạy ghi
async function waitResult(out, runId, ms, sleep = (t) => new Promise(r => setTimeout(r, t))) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const j = JSON.parse(fs.readFileSync(out, 'utf8')); if (j && j.runId === runId) return j; } catch {} await sleep(500); }
  return null;
}
module.exports = { parseArgs, validate, validateKind, fromArgv, resolveModel, isRiskyAsk, answerFor, statusOf, exitCodeOf, run, waitResult, writeJson, DRAFT_RE };
