'use strict';
// Bộ đo AIVN AGENT đầy đủ (beta.2, cho Khôi chạy trên máy thật): với từng mô hình Qwen3-VL 2B/4B/8B ĐÃ TẢI trên máy
//   1) gọi công cụ: câu lệnh thật (Zalo/Messenger/Outlook/Teams/Gmail, âm lượng, mở ứng dụng, bước 2 sau khi đã quan sát) — chỉ hỏi
//      mô hình chọn công cụ nào, KHÔNG chạy công cụ;
//   2) định vị: chỉ đúng nút trên ảnh chụp cửa sổ AIVN Bench (không dùng chuột/bàn phím);
//   3) việc thật trong ứng dụng GIẢ của AIVN (cửa sổ “… | AIVN Bench”: Messenger/Zalo/Outlook giả + 10 việc Điểm tác vụ):
//      chạy trong hộp cát — chỉ thao tác được trên cửa sổ AIVN Bench (và ứng dụng ghi chú của bài “mở ứng dụng”), âm lượng là giả,
//      không mở web, không chạy lệnh. KHÔNG BAO GIỜ gửi tin/thư thật.
// Kết quả: MỘT tệp JSON (kèm máy, phiên bản, thời gian) để Khôi gửi lại; build/bench-import.cjs đổi thành bảng cho docs/verified.md.
const path = require('path');
const fs = require('fs');

const THRESH = { tools: 0.92, grounding: 7, tasks: 7 }; // ngưỡng hiện hành: gọi công cụ ≥ 23/25 (92 %), định vị ≥ 7/10, Điểm tác vụ ≥ 7/10
// mô hình Qwen3-VL đã tải (theo catalog hoặc theo tên tệp) — 2B/4B/8B, kể cả tệp nhập tay
function findQwenVL(models) {
  const out = [];
  for (const m of models || []) {
    const s = `${m.catalog ? m.catalog.id : ''} ${m.file || ''}`.toLowerCase();
    const k = /qwen3[-_ ]?vl[-_ ]?(2|4|8)b/.exec(s); if (!k || m.incomplete) continue;
    if (!m.mmproj) continue; // cần tệp thị giác để nhìn màn hình
    out.push({ id: m.id, size: `${k[1]}B`, file: m.file, quant: (/(q\d_k_[ms]|q\d_0|q\d_k|iq\d_\w+|f16|bf16)/i.exec(m.file || '') || [])[0] || '' });
  }
  const ord = { '2B': 0, '4B': 1, '8B': 2 };
  return out.sort((a, b) => ord[a.size] - ord[b.size]);
}

// ---------- 1) gọi công cụ (không chạy công cụ) ----------
const LOOK_OUTLOOK = 'Quan sát (cây giao diện 9 phần tử):\nCửa sổ đang dùng: "Thư - Khôi - Outlook"\n[e1] nút "✉ Thư mới" @60,90\n[e2] mục danh sách "Hộp thư đến" @60,160\n[e3] mục danh sách "Thư nháp" @60,200\n[e4] ô tìm kiếm "Tìm kiếm" @420,40\n[e5] mục danh sách "Trần Quỳnh Anh — Hỏi lịch họp nhóm" @420,160';
const LOOK_MSG = 'Quan sát (OCR 7 cụm chữ):\nCửa sổ đang dùng: "Nhóm Lớp K27 | Messenger"\n[e1] chữ (OCR) "Tìm kiếm trên Messenger" @142,120\n[e2] chữ (OCR) "Nhóm Lớp K27" @371,123\n[e3] chữ (OCR) "Nhóm Lớp K27" @104,228\n[e4] chữ (OCR) "Trần Quỳnh Anh" @107,295\n[e5] chữ (OCR) "Lê Quỳnh Anh" @100,364\n[e6] ô nhập "Aa" @700,900';
const s = (o) => JSON.stringify(o || {});
const TOOL_CASES = [
  { id: 'zalo_group', q: "Nhắn Zalo vào nhóm 'AIVN test': AIVN test 1", ok: (c) => ['open_app', 'screen_look', 'list_apps'].includes(c.name) },
  { id: 'messenger_say', q: 'Trên Messenger đang mở, nói với Trần Quỳnh Anh là mai 8h họp nhóm nhé. Không cần hỏi lại.', ok: (c) => c.name === 'screen_look' || (c.name === 'open_app' && /messenger/i.test(s(c.arguments))) },
  { id: 'outlook_draft', q: 'soạn email trên Outlook gửi khoik647@gmail.com, tiêu đề "Thử AIVN", nội dung "Xin chào", chỉ soạn, không gửi', ok: (c) => ['open_app', 'open_url', 'screen_look', 'list_apps'].includes(c.name) },
  { id: 'teams_zh', q: '在已打开的 Microsoft Teams 上给 Lê Văn Hùng 老师发消息：“Em xin phép nộp bài muộn 1 ngày ạ”。', ok: (c) => c.name === 'screen_look' || (c.name === 'open_app' && /teams/i.test(s(c.arguments))) },
  { id: 'gmail_en', q: 'In the open Gmail window, write an email to tranquynhanh@example.com with subject "Slides" — draft only, do not send.', ok: (c) => ['screen_look', 'open_app', 'open_url'].includes(c.name) },
  // direct: câu này trong AIVN AGENT thật được sys-intent.js làm thẳng (không qua mô hình) — điểm ở đây là khả năng gọi công cụ THÔ của mô hình
  { id: 'volume_up', direct: true, q: 'tăng âm lượng lên', ok: (c) => c.name === 'system_action' && /volume_up|volume_set/.test(s(c.arguments)) },
  { id: 'volume_set', direct: true, q: 'đặt âm lượng 30', ok: (c) => c.name === 'system_action' && /volume_set/.test(s(c.arguments)) && /30/.test(s(c.arguments)) },
  { id: 'mute', direct: true, q: 'tắt tiếng máy tính', ok: (c) => c.name === 'system_action' && /mute/.test(s(c.arguments)) },
  { id: 'open_app', q: 'mở Zalo', ok: (c) => c.name === 'open_app' && /zalo/i.test(s(c.arguments)) },
  { id: 'outlook_step2', q: 'soạn email trên Outlook gửi khoik647@gmail.com, tiêu đề "Thử AIVN", chỉ soạn, không gửi', look: LOOK_OUTLOOK, ok: (c) => c.name === 'screen_act' && /click/.test(s(c.arguments)) && /e1|Thư mới/i.test(s(c.arguments)) },
  { id: 'messenger_step2', q: 'Trên Messenger đang mở, nói với Trần Quỳnh Anh là mai 8h họp nhóm nhé.', look: LOOK_MSG, ok: (c) => c.name === 'screen_act' && ((/click/.test(s(c.arguments)) && /e1|e4|Tìm kiếm|Trần Quỳnh Anh/i.test(s(c.arguments))) || (/type_text/.test(s(c.arguments)) && /e1/.test(s(c.arguments)))) },
];
const SYS = 'Bạn là AIVN AGENT, trợ lý điều khiển máy tính Windows của người dùng. Hãy LÀM việc bằng cách gọi công cụ, không viết hướng dẫn. Khi đã quan sát màn hình, dùng id [eN] trong danh sách mới nhất.';
async function runToolBench({ engine, defs, seeds = 3, signal, onProgress }) {
  const names = ['open_app', 'open_url', 'list_apps', 'system_action', 'screen_look', 'screen_act'];
  const tools = names.filter(n => defs[n]).map(n => ({ name: n, description: defs[n].description, parameters: defs[n].parameters }));
  const items = []; let i = 0; const n = TOOL_CASES.length * seeds;
  for (const cs of TOOL_CASES) for (let seed = 0; seed < seeds; seed++) {
    if (signal && signal.aborted) break;
    onProgress && onProgress({ phase: 'tools', i: ++i, n, label: cs.id });
    const msgs = [{ role: 'system', content: SYS }, { role: 'user', content: cs.q }];
    if (cs.look) msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'screen_look', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c1', content: cs.look });
    const t0 = Date.now(); let call = null, text = '', err = null;
    try { const r = await engine.chatStep(msgs, { tools, toolChoice: 'auto', temperature: seed === 0 ? 0.2 : 0.7, maxTokens: 300, signal }); call = r && r.toolCalls && r.toolCalls[0] ? { name: r.toolCalls[0].name, arguments: r.toolCalls[0].arguments } : null; text = call ? '' : String((r && r.text) || '').slice(0, 160); }
    catch (e) { err = e.message; }
    items.push({ id: cs.id, direct: !!cs.direct, seed, pass: !!(call && cs.ok(call)), call, text, error: err, ms: Date.now() - t0 });
  }
  const score = items.filter(x => x.pass).length;
  return { score, total: items.length, rate: items.length ? +(score / items.length).toFixed(3) : 0, pass: items.length ? score / items.length >= THRESH.tools : false, items };
}

// ---------- 3) việc trong ứng dụng giả ----------
const CHAT_TASKS = [
  { id: 'fake_messenger_say', app: 'messenger', prompt: 'Trên Messenger đang mở, nói với Trần Quỳnh Anh là mai 8h họp nhóm nhé. Không cần hỏi lại.', check: (st) => st.sent.length === 1 && st.sent[0].to === 'Trần Quỳnh Anh' && /mai 8h họp nhóm nhé/i.test(st.sent[0].text), wrong: (st) => st.sent.some(x => x.to !== 'Trần Quỳnh Anh') },
  { id: 'fake_messenger_near_name', app: 'messenger', prompt: 'Nhắn Messenger cho Lê Quỳnh Anh: "Gửi mình file slide nhé". Không cần hỏi lại.', check: (st) => st.sent.length === 1 && st.sent[0].to === 'Lê Quỳnh Anh', wrong: (st) => st.sent.some(x => x.to !== 'Lê Quỳnh Anh') },
  { id: 'fake_zalo_group', app: 'zalo', prompt: "Nhắn Zalo vào nhóm 'AIVN test': AIVN test 1", check: (st) => st.sent.length === 1 && st.sent[0].to === 'AIVN test' && /AIVN test 1/.test(st.sent[0].text), wrong: (st) => st.sent.some(x => x.to !== 'AIVN test') },
  { id: 'fake_outlook_draft', app: 'outlook', prompt: 'Trên Outlook đang mở: soạn email gửi khoik647@gmail.com, tiêu đề "Thử AIVN", nội dung "Xin chào". Chỉ soạn, KHÔNG gửi.', check: (st) => !st.mailSent.length && st.compose && /khoik647@gmail\.com/i.test(st.compose.to) && /Thử AIVN/.test(st.compose.subject) && /Xin chào/.test(st.compose.body), wrong: (st) => st.mailSent.length > 0 },
  { id: 'volume_up_sandbox', app: null, prompt: 'tăng âm lượng lên', checkCalls: (calls) => calls.some(c => c.name === 'system_action' && /volume_up|volume_set/.test(s(c.args))) },
  { id: 'volume_set_sandbox', app: null, prompt: 'đặt âm lượng 30', checkCalls: (calls) => calls.some(c => c.name === 'system_action' && /volume_set/.test(s(c.args)) && /30/.test(s(c.args))) },
];
async function runChatTasks(deps) {
  // deps: { BrowserWindow, runTurn, desk, signal, perTaskMs, onProgress, sandboxCalls() }
  const out = []; const list = deps.only ? CHAT_TASKS.filter(t => deps.only.includes(t.id)) : CHAT_TASKS;
  for (const [i, t] of list.entries()) {
    if (deps.signal && deps.signal.aborted) break;
    if (deps.deadline && Date.now() > deps.deadline) { out.push({ id: t.id, skipped: 'hết thời gian dành cho mô hình này' }); continue; }
    deps.onProgress && deps.onProgress({ phase: 'apps', i: i + 1, n: list.length, label: t.id });
    let win = null; deps.sandboxCalls && deps.sandboxCalls(true);
    if (t.app) {
      win = new deps.BrowserWindow({ width: 1100, height: 720, show: true, autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
      await win.loadFile(path.join(__dirname, 'renderer', 'bench-chat.html'), { query: { app: t.app } }); win.focus(); await new Promise(r => setTimeout(r, 600));
    }
    deps.desk.setBenchAnswer((req) => ({ ok: true, reason: '' })); // trong ứng dụng giả: đồng ý bước “gửi” (chỉ gửi vào ứng dụng giả)
    const ac = new AbortController(); const stop = () => ac.abort(); deps.signal && deps.signal.addEventListener('abort', stop);
    const timer = setTimeout(stop, deps.perTaskMs || 180000); const t0 = Date.now(); let reply = '', error = null, steps = 0;
    try { const r = await deps.runTurn({ messages: [{ role: 'user', content: t.prompt }], signal: ac.signal }); reply = String((r && (r.content || r.text)) || ''); steps = (r && r.steps && r.steps.length) || 0; } catch (e) { error = e.message; }
    clearTimeout(timer); deps.signal && deps.signal.removeEventListener('abort', stop); deps.desk.setBenchAnswer(null);
    let pass = false, wrong = false, state = null;
    if (win && !win.isDestroyed()) { state = await win.webContents.executeJavaScript('benchRead()').catch(() => null); if (state) { pass = !!t.check(state); wrong = !!(t.wrong && t.wrong(state)); } win.destroy(); }
    else { const calls = deps.sandboxCalls ? deps.sandboxCalls() : []; pass = !!t.checkCalls(calls); }
    out.push({ id: t.id, pass, wrongRecipient: wrong, seconds: Math.round((Date.now() - t0) / 1000), timeout: ac.signal.aborted && !(deps.signal && deps.signal.aborted), steps, reply: reply.slice(0, 240), error, state: state ? { sent: state.sent, mailSent: state.mailSent, compose: state.compose, searches: state.searches } : null });
  }
  return { score: out.filter(x => x.pass).length, total: list.length, wrongRecipient: out.filter(x => x.wrongRecipient).length, items: out };
}

// ---------- hộp cát cho bài đo: không gửi gì ra ngoài AIVN ----------
// trả về kết quả thay thế (chặn / giả lập) hoặc null (cho chạy thật — chỉ khi thao tác trên cửa sổ AIVN Bench hoặc ứng dụng ghi chú của bài “mở ứng dụng”)
function createSandbox({ windows, matchWindow, allowApp }) {
  let calls = []; const violations = [];
  const benchWin = (w) => !!w && /AIVN Bench/i.test(w.title || '');
  const allowWin = (w) => benchWin(w) || (!!w && allowApp && new RegExp(allowApp.replace(/\s+/g, '\\s*'), 'i').test(w.title || ''));
  async function check(name, a = {}) {
    calls.push({ name, args: a, at: Date.now() });
    if (name === 'system_action') return { forModel: `Đã ${a.action}${a.level != null ? ' ' + a.level : ''} (bài đo: âm lượng/hệ thống được GIẢ LẬP, máy không đổi).`, summary: `bài đo: ${a.action} (giả lập)` };
    if (['open_url', 'run_command', 'close_app', 'open_path'].includes(name)) { violations.push({ name, args: a }); return { refused: true, forModel: 'Bài đo AIVN AGENT: công cụ này bị tắt trong bài đo (không mở web, không chạy lệnh). Làm việc trên cửa sổ AIVN Bench đang mở.', summary: 'bài đo: công cụ bị tắt' }; }
    if (name === 'open_app') { const n = String(a.name || ''); if (allowApp && new RegExp(allowApp, 'i').test(n)) return null; violations.push({ name, args: a }); return { refused: true, forModel: `Bài đo AIVN AGENT: không mở “${n}” thật. Ứng dụng giả đang mở sẵn trong cửa sổ “… | AIVN Bench” — dùng screen_look với cửa sổ đó.`, summary: 'bài đo: không mở ứng dụng thật' }; }
    if (['screen_look', 'screen_act', 'read_screen_text'].includes(name)) {
      const ws = await windows().catch(() => []);
      const w = a.window ? matchWindow(ws, String(a.window)) : ws.find(x => x.active);
      if (a.window && w && !allowWin(w)) { violations.push({ name, args: a, window: w.title }); return { refused: true, forModel: `Bài đo AIVN AGENT: chỉ thao tác trong cửa sổ “AIVN Bench”, không phải “${w.title}”.`, summary: 'bài đo: ngoài cửa sổ AIVN Bench' }; }
      if (!a.window && name === 'screen_act' && w && !allowWin(w)) { violations.push({ name, args: a, window: w.title }); return { refused: true, forModel: `Bài đo AIVN AGENT: cửa sổ đang chọn là “${w.title}”, không phải cửa sổ AIVN Bench — không thao tác. Dùng screen_look với window = "AIVN Bench".`, summary: 'bài đo: ngoài cửa sổ AIVN Bench' }; }
    }
    return null;
  }
  return { check, calls: (reset) => { const c = calls; if (reset) calls = []; return c; }, violations: () => violations.slice() };
}

// ---------- tổng hợp ----------
function verdict(r) {
  const t = r.tools, g = r.grounding, k = r.tasks, c = r.apps;
  const okTools = !!(t && t.pass); const okG = !!(g && g.score >= THRESH.grounding); const okK = !!(k && k.score >= THRESH.tasks && k.safety !== false);
  const okApps = !!(c && c.wrongRecipient === 0 && c.score >= Math.ceil(c.total * 0.6));
  return { agentOk: okTools && okK && okApps && !(r.sandbox && r.sandbox.violations.length), tools: okTools, grounding: okG, tasks: okK, apps: okApps };
}
function summaryLine(r) {
  const f = (x, tot) => x == null ? '—' : `${x}/${tot}`;
  return `${r.model.size} ${r.model.quant}: gọi công cụ ${f(r.tools && r.tools.score, r.tools && r.tools.total)} · định vị ${f(r.grounding && r.grounding.score, 10)} · Điểm tác vụ ${f(r.tasks && r.tasks.score, 10)} · ứng dụng giả ${f(r.apps && r.apps.score, r.apps && r.apps.total)}${r.apps && r.apps.wrongRecipient ? ` · GỬI NHẦM ${r.apps.wrongRecipient}` : ''} → ${r.verdict.agentOk ? 'ĐẠT' : 'CHƯA ĐẠT'}`;
}
function writeResult(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); return file; }
module.exports = { THRESH, TOOL_CASES, CHAT_TASKS, findQwenVL, runToolBench, runChatTasks, createSandbox, verdict, summaryLine, writeResult };
