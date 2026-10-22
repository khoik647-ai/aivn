'use strict';
// QA runner không giao diện (beta.3) — chỉ để bot QA chạy thử trên máy thật từ PowerShell:
//   AIVN.exe --agent-task "<lệnh>" --model <id | 2b | 4b | 8b> --out <result.json> [--shots <thư mục>] [--timeout <giây>] [--lang vi|en|zh]
// Chỉ bật khi biến môi trường AIVN_QA_MODE=1 VÀ có cờ --agent-task; thiếu một trong hai → bỏ qua cờ, ghi cảnh báo.
// KHÔNG có cổng mạng/HTTP (chỉ dòng lệnh). Chạy đúng vòng AIVN AGENT bình thường, MỌI cổng an toàn giữ nguyên;
// bước cần xin phép (gửi/xoá/mua/khoá/âm lượng…) luôn bị TỪ CHỐI tự động — không bao giờ tự cho phép.
// Mã thoát: 0 = done · 2 = failed/blocked · 3 = asked_user.
// beta.2.2 (chỉ dùng kèm AIVN_QA_MODE=1 + --agent-task):
//   --approve-send-to "<tên>"  tự CHO PHÉP đúng MỘT bước gửi — CHỈ tới cuộc trò chuyện của chính người dùng (Cloud của tôi / My Documents / My Cloud…),
//                              và chỉ khi tiêu đề khung chat giữa trên màn hình đúng là cuộc trò chuyện đó. Tên khác → từ chối chạy, thoát mã 2.
//   --answer "<câu trả lời>"   AIVN AGENT hỏi lại (asked_user) → trả lời MỘT lần bằng câu này rồi cho AIVN AGENT làm tiếp.
const fs = require('fs'); const path = require('path');

const FLAGS = { '--agent-task': 'task', '--qa-ui': 'script', '--profile': 'profile', '--model': 'model', '--out': 'out', '--shots': 'shots', '--timeout': 'timeout', '--lang': 'lang', '--qa-input-diag': 'inputDiag', '--agent-settings-from': 'agentFrom', '--approve-send-to': 'approveSendTo', '--answer': 'answer' };
const BOOL = new Set(['--qa-input-diag']); // cờ không nhận giá trị
const LANGS = ['vi', 'en', 'zh'];
// lệnh nói rõ “chỉ soạn, đừng gửi”: lời từ chối mang lý do đó để AIVN AGENT dừng trước bước gửi (vẫn KHÔNG cho phép)
const DRAFT_RE = require('./agent/send-verify').DRAFT_ONLY; // một nguồn với desktop-agent (B101)
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
// --approve-send-to: chỉ cuộc trò chuyện với CHÍNH MÌNH (nhóm tên khác của “Cloud của tôi”, khớp chặt cả cụm)
const SELF_CHAT = () => require('./agent/send-verify').namesFor('Cloud của tôi');
function isSelfChat(name) { const SV = require('./agent/send-verify'); const k = SV.nameKey(String(name || '')); return !!k && SELF_CHAT().some(n => SV.nameKey(n) === k); }
// B97 (máy thật beta.2.3): kiểm tra màn hình cho --approve-send-to dùng CÙNG cách đọc + làm sạch tiêu đề với cổng người nhận (B90):
// bỏ ký tự lẻ đầu dòng (“Q My Documents”), dòng phụ (“Lưu và đồng bộ…”), giờ (“2158”, “21:58”). Qua khi:
//  (a) tiêu đề khung giữa (đã làm sạch) ĐÚNG là cuộc trò chuyện của chính mình, hoặc
//  (b) trong CÙNG lượt, cổng người nhận đã chốt đúng người nhận này VÀ chữ gợi ý ô soạn (“Nhập @, tin nhắn tới My Documents”) đã khớp tên của chính mình,
//      và màn hình lúc này không cho thấy cuộc trò chuyện nào khác (ô soạn ghi người khác / tiêu đề đọc được mà không phải mình).
// Tiêu đề chỉ có giờ (["2158"]) KHÔNG BAO GIỜ tự nó cho qua.
function selfChatShown(req = {}) {
  const SV = require('./agent/send-verify');
  const sh = req.shown || {}; const raw = (sh.headerRaw || sh.header || []).slice(0, 4);
  const hdr = SV.cleanHeader([...(sh.header || []), ...(sh.headerRaw || [])]);
  const own = SELF_CHAT(); const hit = hdr.find(isSelfChat);
  if (hit) return { ok: true, via: `tiêu đề khung chat “${hit}”` };
  if (sh.composer && !isSelfChat(sh.composer)) return { ok: false, why: `ô soạn đang ghi tin nhắn tới “${String(sh.composer).slice(0, 40)}” — không phải cuộc trò chuyện của chính bạn` };
  const g = sh.gate || {}; const k = SV.nameKey(String(req.recipient || ''));
  const gateOk = !!g.chatOpen && g.chatOpen === k; const phOk = !!(g.placeholder && isSelfChat(g.placeholder)) || !!(sh.composer && isSelfChat(sh.composer));
  if (gateOk && phOk) {
    if (hdr.length && !hdr.some(h => own.some(n => SV.headerMatches(n, h)))) return { ok: false, why: `tiêu đề khung chat đọc được là ${JSON.stringify(hdr.slice(0, 2))} — không phải cuộc trò chuyện của chính bạn` };
    return { ok: true, via: `cổng người nhận đã chốt + chữ gợi ý ô soạn “${g.placeholder || sh.composer}” trong lượt này; tiêu đề đọc được ${JSON.stringify(raw)}` };
  }
  return { ok: false, why: `chưa chắc là cuộc trò chuyện của chính bạn — tiêu đề khung chat ${JSON.stringify(raw)}${hdr.length ? ` (làm sạch: ${JSON.stringify(hdr.slice(0, 2))})` : ' (không còn tên sau khi làm sạch)'}, ${gateOk ? 'cổng người nhận đã chốt' : 'cổng người nhận chưa chốt'}, ${phOk ? 'chữ gợi ý ô soạn đã khớp' : 'chưa thấy chữ gợi ý ô soạn khớp'}` };
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
  // B84: --agent-settings-from main — hồ sơ QA mới (--profile) chép cài đặt AIVN AGENT (agent*) từ hồ sơ thật (CHỈ ĐỌC hồ sơ thật)
  const agentFrom = a.agentFrom != null ? String(a.agentFrom).trim().toLowerCase() : null;
  if (agentFrom != null && agentFrom !== 'main') return { ok: false, error: '--agent-settings-from chỉ nhận "main"' };
  if (agentFrom && !a.profile) return { ok: false, error: '--agent-settings-from main chỉ dùng kèm --profile <thư mục> (không có --profile thì đã dùng cài đặt thật)' };
  let approveSendTo = null;
  if (a.approveSendTo != null) {
    const n = String(a.approveSendTo).trim();
    if (!n) return { ok: false, error: '--approve-send-to cần tên cuộc trò chuyện (chỉ nhận cuộc trò chuyện của chính bạn: ' + SELF_CHAT().slice(0, 3).join(' / ') + ')' };
    if (!isSelfChat(n)) return { ok: false, error: `--approve-send-to TỪ CHỐI “${n.slice(0, 60)}”: chỉ được tự cho phép gửi vào cuộc trò chuyện của chính bạn (${SELF_CHAT().join(' / ')}), không bao giờ cho người khác` };
    approveSendTo = n;
  }
  let answer = null;
  if (a.answer != null) { answer = String(a.answer).trim(); if (!answer) return { ok: false, error: '--answer cần câu trả lời' }; if (answer.length > 500) return { ok: false, error: '--answer quá dài (tối đa 500 ký tự)' }; }
  return { ok: true, args: { task, model: a.model ? String(a.model).trim() : null, out, shots, timeout, lang, profile: a.profile ? path.resolve(cwd, a.profile) : null, agentFrom, approveSendTo, answer } };
}
// cổng bật: AIVN_QA_MODE=1 VÀ có cờ. Trả { enabled, args, warn }
function fromArgv(argv, env = process.env, opts) {
  const raw = parseArgs(argv); if (!raw) return { enabled: false, args: null, warn: null };
  if (String(env.AIVN_QA_MODE || '') !== '1') return { enabled: false, args: null, warn: 'Có cờ QA (--agent-task / --qa-ui / --qa-input-diag) nhưng thiếu biến môi trường AIVN_QA_MODE=1 → bỏ qua cờ QA, mở AIVN bình thường.' };
  const kinds = [raw.task != null && 'agent-task', raw.script != null && 'qa-ui', raw.inputDiag != null && 'input-diag'].filter(Boolean);
  if (kinds.length > 1) return { enabled: false, args: null, invalid: true, warn: 'Cờ QA không hợp lệ: chỉ dùng một trong --agent-task, --qa-ui hoặc --qa-input-diag mỗi lần chạy' };
  const kind = kinds[0] || 'agent-task';
  if (kind !== 'agent-task' && (raw.approveSendTo != null || raw.answer != null)) return { enabled: false, args: null, invalid: true, warn: 'Cờ QA không hợp lệ: --approve-send-to và --answer chỉ dùng kèm --agent-task' };
  const v = validateKind(kind, raw, opts); if (!v.ok) return { enabled: false, args: null, invalid: true, warn: `Cờ QA không hợp lệ: ${v.error}` };
  return { enabled: true, kind, args: v.args, warn: null };
}
function validateKind(kind, raw, opts) { return kind === 'qa-ui' ? require('./qa-ui').validate(raw, opts) : kind === 'input-diag' ? require('./qa-input-diag').validate(raw, opts) : validate(raw, opts); }
// 2b/4b/8b → Qwen3-VL Instruct đã có trên máy; còn lại: đúng id / tên tệp
// B83 (máy thật): tệp chính hãng “Qwen3VL-8B-Instruct-Q4_K_M.gguf” (id qwen3vl-8b-instruct-q4_k_m) không khớp mẫu “qwen3-vl-8b-instruct”
// → so theo tên đã CHUẨN HOÁ (bỏ dấu nối/gạch/chấm, chữ thường: qwen3-vl == qwen3vl == Qwen3VL) và theo id danh mục
const normName = (x) => String(x || '').toLowerCase().replace(/\.gguf$/, '').replace(/[^a-z0-9]/g, '');
function resolveModel(want, models = []) {
  if (!want) return null; const w = String(want).toLowerCase().trim();
  const keys = (m) => [m.id, m.file, m.catalog && m.catalog.id].filter(Boolean).map(normName);
  const alias = /^(2|4|8)b$/.exec(w);
  if (alias) { const k = `qwen3vl${alias[1]}binstruct`; const hits = models.filter(m => keys(m).some(x => x.includes(k)));
    return hits.sort((a, b) => (/q4km/.test(normName(b.file || b.id)) - /q4km/.test(normName(a.file || a.id))))[0] || null; }
  const nw = normName(w);
  return models.find(m => String(m.id).toLowerCase() === w) || models.find(m => String(m.file || '').toLowerCase() === w || String(m.file || '').toLowerCase() === w + '.gguf')
    || models.find(m => m.catalog && String(m.catalog.id).toLowerCase() === w)
    || (nw ? models.find(m => keys(m).some(x => x === nw)) || models.find(m => nw.length >= 6 && keys(m).some(x => x.startsWith(nw))) : null) || null;
}
const isRiskyAsk = (req = {}) => !!req.risk || RISK_RE.test([req.title, req.desc, req.text, req.label, req.tool, req.message].filter(Boolean).join(' '));
// thẻ xin phép bất kỳ trong chế độ QA → luôn từ chối bước quan trọng; bước thường (không rủi ro) của lớp phủ màn hình được làm như bài đo
function answerFor(req, { draft }) {
  if (isRiskyAsk(req)) return { ok: false, reason: draft ? 'Chỉ soạn sẵn, đừng gửi (chế độ QA: tự từ chối bước cần xin phép)' : 'Chế độ QA: tự từ chối bước cần xin phép' };
  return { ok: true, reason: '' };
}
// trạng thái trung thực từ kết quả AIVN AGENT
// B84: câu trả lời cuối NÓI là chưa làm được / không thể → không bao giờ là “done”
const FAIL_CLAIM = /(?:chưa (?:làm (?:được|xong)|gửi (?:được|đi)|mở được|thể)|không (?:thể|làm được|điều khiển được|gửi được|mở được|có quyền điều khiển)|cannot|can['’]t|couldn['’]t|could not|unable to|not able to|failed to|无法|不能|没能|未能|没有办法)/iu;
const SEND_TASK = /(?:^|[^\p{L}])(?:nhắn|gửi (?:tin|email|mail|thư)|send|text|message|reply|trả lời)(?![\p{L}])|发消息|发送|回复/iu;
// B104: luôn có finalAnswer (kể cả hết giờ / lỗi): câu trả lời của AIVN, hoặc câu trung thực dựng từ trạng thái + chữ còn trong ô soạn
function finalAnswerOf(r, st, { timedOut = false, timeout = 0, draft = null } = {}) {
  let t = String((r && r.text) || '').trim();
  const dn = draft && !(t && t.includes(String(draft.text || '').slice(0, 30)) && /ô soạn/.test(t)) ? (draft.cleared ? `Chữ “${String(draft.text).slice(0, 80)}” AIVN đã gõ vào ô soạn tin (chưa gửi) đã được xoá.` : draft.left ? `Chữ “${String(draft.text).slice(0, 80)}” AIVN đã gõ VẪN CÒN trong ô soạn tin (CHƯA gửi)${draft.why ? ` — ${draft.why}` : ''}.` : '') : '';
  if (!t) t = timedOut ? `AIVN AGENT chưa xong việc: hết thời gian (--timeout ${timeout} giây) nên đã dừng giữa chừng.` : st && st.status && st.status !== 'done' ? `AIVN AGENT chưa xong việc: ${st.reason || st.status}.` : '';
  return [t, dn].filter(Boolean).join('\n\n') || null;
}
function statusOf(r, { denied = 0, draft = false, error = null, timedOut = false, task = '' } = {}) {
  if (timedOut) return { status: 'failed', reason: 'hết thời gian (--timeout)' };
  if (error) return { status: ['AGENT_GATE', 'NOT_ACTIVATED', 'NO_MODEL', 'SCREEN_OFF'].includes(error.code) ? 'blocked' : 'failed', reason: String(error.message || error) };
  if (!r) return { status: 'failed', reason: 'không có kết quả' };
  // B98: người dùng (--answer “không/no/取消…”) huỷ việc → “cancelled”, mã thoát 4 (không phải thất bại)
  if (r.cancelled) return { status: 'cancelled', reason: 'người dùng huỷ việc khi được hỏi lại (--answer) — không gửi/không làm gì' };
  if (r.outcome === 'asked_user' || r.asked) return { status: 'asked_user', question: String(r.text || ''), reason: r.asked ? String(r.asked) : 'hỏi lại người dùng' };
  if (r.finishReason === 'abort') return { status: 'failed', reason: 'bị dừng' };
  if (denied > 0 && !draft) return { status: 'blocked', reason: `${denied} bước cần xin phép đã bị tự từ chối (chế độ QA không bao giờ tự cho phép)` };
  if (r.outcome === 'blocked') return { status: 'blocked', reason: String(r.warning || r.text || '').slice(0, 300) };
  if (r.outcome === 'failed') return { status: 'failed', reason: String(r.text || '').slice(0, 300) };
  // B84: KHÔNG mặc định “done” — chỉ khi AIVN AGENT báo done, câu trả lời không nói thất bại, và (việc gửi tin) có bước ĐÃ KIỂM CHỨNG gửi
  if (r.outcome !== 'done') return { status: 'failed', reason: `không rõ kết quả (outcome=${r.outcome == null ? 'không có' : r.outcome})` };
  if (FAIL_CLAIM.test(String(r.text || ''))) return { status: 'failed', reason: 'câu trả lời cuối nói chưa làm được: ' + String(r.text || '').slice(0, 240) };
  const sendTask = !draft && SEND_TASK.test(String(task || '')) && !/(?:âm lượng|volume|音量)/iu.test(String(task || ''));
  if (sendTask && !(r.steps || []).some(x => x && x.verify && x.verify.sent)) return { status: 'failed', reason: 'việc gửi tin nhưng không có bước nào kiểm chứng được là ĐÃ GỬI đúng người' };
  return { status: 'done' };
}
const exitCodeOf = (status) => status === 'done' ? 0 : status === 'asked_user' ? 3 : status === 'cancelled' ? 4 : 2;
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
  const ac = new AbortController(); const timer = setTimeout(() => { timedOut = true; ac.abort('timeout'); }, args.timeout * 1000); // B104: lý do 'timeout' → AIVN được dọn chữ đã gõ trong ô soạn
  // ghi lại + trả lời một thẻ xin phép (đồng bộ). Thẻ ngoài lớp phủ màn hình (confirm/approve/screen) luôn coi là bước quan trọng → TỪ CHỐI
  let sendApproved = 0; let lastDeny = null;
  // --approve-send-to: CHỈ thẻ GỬI của lớp phủ màn hình, người nhận theo lệnh là cuộc trò chuyện của chính mình, tiêu đề khung giữa ĐÚNG là nó, chưa cho phép lần nào
  const selfSend = (kind, req) => {
    if (!args.approveSendTo || kind !== 'desk' || !req.send) return null;
    const v = selfChatShown(req);
    const why = draft ? 'lệnh nói chỉ soạn, đừng gửi' : sendApproved ? 'đã cho phép một lần gửi rồi' : !isSelfChat(req.recipient) ? `người nhận “${req.recipient || '?'}” không phải cuộc trò chuyện của chính bạn`
      : !v.ok ? v.why : null;
    deps.LOG && deps.LOG.log('qa', why ? `--approve-send-to: KHÔNG cho phép — ${why}` : `--approve-send-to: CHO PHÉP gửi tới “${req.recipient}” (${v.via})`);
    if (why) lastDeny = why;
    return why ? null : v.via;
  };
  const ask = (kind, req = {}) => { const risk = kind !== 'desk' || isRiskyAsk(req); const self = risk ? selfSend(kind, req) : null;
    const a = self ? { ok: true, reason: '' } : risk ? { ...answerFor({ ...req, risk: true }, { draft }), final: true } : { ok: true, reason: '' }; if (!a.ok) denied++; if (self) sendApproved++;
    res.approvals.push({ kind, at: Date.now() - t0, title: req.title || req.label || req.kind || null, tool: req.tool || null, risk, send: !!req.send, recipient: req.recipient || null, shownChat: req.shown ? { header: req.shown.header || [], composer: req.shown.composer || null } : null, text: req.sendText != null ? String(req.sendText).slice(0, 300) : null, desc: String(req.desc || req.message || req.text || '').slice(0, 300), answer: self ? `allowed (--approve-send-to “${args.approveSendTo}”)` : a.ok ? 'allowed (không rủi ro)' : 'denied' });
    deps.LOG && deps.LOG.log('qa', `QA tự trả lời thẻ ${kind}: ${self ? 'CHO PHÉP (--approve-send-to)' : a.ok ? 'làm (không rủi ro)' : 'TỪ CHỐI'} — ${req.title || req.desc || req.kind || ''}${req.recipient ? ` · người nhận “${req.recipient}”` : ''}`); return a; };
  let n = 0; const pendingSteps = [];
  async function onStep1(s) {
          if (s.status === 'running' || s.status === 'pending') { open.set(s.id, { i0: lines.length, t: Date.now() }); return; }
          const o = open.get(s.id) || { i0: lines.length, t: Date.now() }; open.delete(s.id); n++;
          const step = { n, id: s.id, auto: !!s.auto, tool: s.name, args: s.args || null, status: s.status, summary: s.summary || null, verification: s.verify || s.check || null, durationMs: s.ms ?? (Date.now() - o.t), debug: lines.slice(o.i0).filter(l => DEBUG_LINE.test(l)).slice(0, 40), shot: null };
          if (args.shots && deps.capture) { try { const c = await deps.capture({ maxW: 1920 }); const f = path.join(args.shots, `step-${String(n).padStart(2, '0')}-${String(s.name || 'step').replace(/[^\w-]/g, '_')}.jpg`); fs.writeFileSync(f, Buffer.from(c.dataUrl.split(',')[1], 'base64')); step.shot = f; } catch (e) { step.shot = null; step.shotError = String(e.message || e).slice(0, 200); } }
          res.steps.push(step);
  }
  try {
    if (deps.activated && !deps.activated()) { const e = new Error('Máy chưa kích hoạt AIVN'); e.code = 'NOT_ACTIVATED'; throw e; }
    if (args.lang && deps.setLang) restoreLang = deps.setLang(args.lang);
    const tl = Date.now();
    if (args.model) {
      const m = resolveModel(args.model, deps.listModels()); if (!m) { const e = new Error(`Không tìm thấy mô hình “${args.model}” trên máy`); e.code = 'NO_MODEL'; throw e; }
      const st0 = deps.engine.status(); if (!(st0.loaded && st0.path === m.path)) await deps.loadById(m.id, { reason: 'qa-runner' });
    }
    const st = deps.engine.status(); if (!st.loaded) { const e = new Error('Chưa nạp mô hình nào (dùng --model)'); e.code = 'NO_MODEL'; throw e; }
    // B84: điều khiển màn hình đang TẮT (thường do --profile mới) → dừng ngay, nói rõ, thay vì chạy “què” rồi báo done
    { const sc = deps.screenControl ? deps.screenControl() : null; if (sc && !sc.on) { const e = new Error(`Điều khiển màn hình đang TẮT trong hồ sơ này (${sc.why}). Bật trong Cài đặt → AIVN AGENT, hoặc chạy kèm --agent-settings-from main để chép cài đặt AIVN AGENT từ hồ sơ thật.`); e.code = 'SCREEN_OFF'; throw e; } }
    res.model = { id: st.id, file: st.path ? path.basename(st.path) : null, mode: st.mode || null, contextSize: st.contextSize || null, gpuLayers: st.gpuLayers ?? null, totalLayers: st.totalLayers ?? null, gpu: st.gpu || null };
    res.timings.modelLoadMs = Date.now() - tl;
    if (args.shots) fs.mkdirSync(args.shots, { recursive: true });
    if (deps.desk && deps.desk.clearLastDraft) deps.desk.clearLastDraft();
    if (deps.desk && deps.desk.setBenchAnswer) deps.desk.setBenchAnswer((req) => ask('desk', req));
    const tr = Date.now();
    const turn = (messages) => deps.runAgentTurn({ reqId: null, convoId: 'qa-' + runId, messages, headless: false, signal: ac.signal,
      qa: { confirm: async (req) => { ask('confirm', req); return false; }, confirmScreen: async (req) => { ask('screen', req); return { ok: false }; },
        approve: async (card) => { const x = ask('approve', card); return { ok: false, reason: x.reason }; },
        onStep: (s) => { const p = onStep1(s); pendingSteps.push(p); return p; } } });
    r = await turn([{ role: 'user', content: args.task }]);
    // --answer: AIVN AGENT hỏi lại → trả lời MỘT lần rồi làm tiếp (cùng cuộc trò chuyện, cùng luật xin phép)
    if (args.answer && r && (r.outcome === 'asked_user' || r.asked) && !ac.signal.aborted) {
      await Promise.allSettled(pendingSteps);
      res.firstTurn = { outcome: r.outcome || null, asked: r.asked || null, question: String(r.text || '').slice(0, 1000) }; res.answer = args.answer;
      deps.LOG && deps.LOG.log('qa', `QA trả lời câu hỏi của AIVN AGENT (--answer): “${args.answer.slice(0, 120)}”`);
      r = await turn([{ role: 'user', content: args.task }, { role: 'assistant', content: String(r.text || '') }, { role: 'user', content: args.answer }]);
    }
    // B89: onStep chụp ảnh (bất đồng bộ) rồi mới ghi bước — đường tắt (lệnh hệ thống) trả kết quả ngay → phải chờ hết trước khi viết result.json
    await Promise.allSettled(pendingSteps);
    if (r && Array.isArray(r.steps)) for (const s of r.steps) if (s && s.status !== 'running' && !res.steps.some(x => x.id === s.id)) res.steps.push({ n: res.steps.length + 1, id: s.id, tool: s.name, args: s.args || null, status: s.status, summary: s.summary || null, verification: s.verify || s.check || null, durationMs: s.ms ?? null, debug: [], shot: null, auto: !!s.auto });
    res.steps.sort((a, b) => a.n - b.n);
    res.timings.agentMs = Date.now() - tr;
  } catch (e) { error = e; }
  finally { clearTimeout(timer); untap(); if (deps.desk && deps.desk.setBenchAnswer) deps.desk.setBenchAnswer(null); if (restoreLang) { try { restoreLang(); } catch {} } }
  const s = statusOf(r, { denied, draft, error: timedOut ? null : error, timedOut, task: args.task });
  // B99: bị từ chối ở kiểm tra --approve-send-to → ghi ĐÚNG lý do (không phải cảnh báo mô hình yếu)
  if (s.status === 'blocked' && denied > 0 && lastDeny) s.reason = `bước GỬI bị tự TỪ CHỐI: --approve-send-to không cho phép — ${lastDeny}`;
  else if (s.status === 'blocked' && denied > 0 && args.approveSendTo == null && res.approvals.some(x => x.send && x.answer === 'denied')) s.reason = 'bước GỬI bị tự TỪ CHỐI (chế độ QA không có --approve-send-to nên mọi bước gửi đều bị từ chối) — tin CHƯA được gửi';
  Object.assign(res, { status: s.status, reason: s.reason || null, question: s.question || null, finalAnswer: finalAnswerOf(r, s, { timedOut, timeout: args.timeout, draft: deps.desk && deps.desk.lastDraft ? deps.desk.lastDraft() : null }), warning: r && r.warning && !(denied > 0 && /mô hình mạnh hơn/.test(r.warning)) ? r.warning : null, draftOnly: draft, deniedApprovals: denied, approvedSends: sendApproved, approveSendTo: args.approveSendTo || null, exitCode: exitCodeOf(s.status) });
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
module.exports = { finalAnswerOf, selfChatShown, isSelfChat, SELF_CHAT, parseArgs, validate, validateKind, fromArgv, resolveModel, isRiskyAsk, answerFor, statusOf, exitCodeOf, run, waitResult, writeJson, DRAFT_RE };
