'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const A = window.aivn;
const state = { settings: null, models: [], status: { loaded: false }, convos: [], current: null, generating: null, catalog: [] };

const fmtBytes = (b) => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024))); return (b / 1024 ** i).toFixed(i >= 3 ? 2 : 0).replace('.', ',') + ' ' + u[i]; };
const esc = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let toastTimer;
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = 'toast', 3500); }

// Markdown tối giản: khối code, code inline, in đậm, nghiêng, xuống dòng
function md(src) {
  const parts = src.split(/```/);
  return parts.map((p, i) => {
    if (i % 2) { const nl = p.indexOf('\n'); const code = nl >= 0 ? p.slice(nl + 1) : p; return `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`; }
    return esc(p).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/\n/g, '<br>');
  }).join('');
}

// ---------- Điều hướng ----------
function show(view) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'discover') renderCatalog();
  if (view === 'models') refreshModels();
  if (view === 'server') refreshServer();
}
$$('.nav-item').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

// ---------- Mô hình ----------
async function refreshModels() {
  state.models = await A.models();
  const sel = $('#modelSelect');
  const cur = state.status.loaded ? state.status.id : '';
  sel.innerHTML = `<option value="">${state.models.length ? '— Chọn mô hình để nạp —' : '— Chưa có mô hình, hãy vào Khám phá —'}</option>` +
    state.models.map(m => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.catalog ? m.catalog.name : m.file)} · ${fmtBytes(m.size)}</option>`).join('');
  const t = $('#modelTable');
  if (!state.models.length) { t.innerHTML = `<div class="tr"><span class="muted">Chưa có mô hình nào. Hãy tải ở mục Khám phá hoặc nhập tệp GGUF có sẵn.</span></div>`; return; }
  t.innerHTML = `<div class="tr head"><span>Tên</span><span>Dung lượng</span><span>Nguồn</span><span>Đường dẫn</span><span>Thao tác</span></div>` +
    state.models.map(m => `<div class="tr" data-id="${esc(m.id)}">
      <span><b>${esc(m.catalog ? m.catalog.name : m.file)}</b>${m.loaded ? '<span class="badge">Đang nạp</span>' : ''}<div class="muted" style="font-size:11.5px">${esc(m.id)}</div></span>
      <span>${fmtBytes(m.size)}</span><span>${m.source === 'imported' ? 'Đã nhập' : 'Đã tải'}</span>
      <span class="path" title="${esc(m.path)}">${esc(m.path)}</span>
      <span class="acts">${m.loaded ? '<button class="btn sm" data-act="unload">Gỡ khỏi bộ nhớ</button>' : '<button class="btn sm primary" data-act="load">Nạp</button>'}
        <button class="btn sm" data-act="reveal" title="Hiện trong thư mục">📁</button><button class="btn sm danger" data-act="delete" title="Xoá">🗑</button></span></div>`).join('');
}
$('#modelTable').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.tr').dataset.id; const m = state.models.find(x => x.id === id);
  try {
    if (b.dataset.act === 'load') await loadModel(id);
    if (b.dataset.act === 'unload') await A.unloadModel();
    if (b.dataset.act === 'reveal') await A.reveal(m.path);
    if (b.dataset.act === 'delete') await A.deleteModel(id);
  } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  refreshModels();
});
async function loadModel(id) {
  if (!id) return;
  try { await A.loadModel(id); toast('Đã nạp mô hình ✓'); }
  catch (err) { toast('Không nạp được: ' + err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  refreshModels();
}
$('#modelSelect').addEventListener('change', e => e.target.value && loadModel(e.target.value));
$('#ejectBtn').addEventListener('click', async () => { await A.unloadModel(); refreshModels(); });
const doImport = async () => { state.models = await A.importModel(); refreshModels(); renderCatalog(); };
$('#importBtn').addEventListener('click', doImport); $('#importBtn2').addEventListener('click', doImport);
$('#openDir').addEventListener('click', () => A.reveal());

function setStatus(st) {
  state.status = st;
  const el = $('#modelState');
  if (st.loading) el.innerHTML = `<span class="dot busy"></span>Đang nạp ${esc(st.id || '')}…`;
  else if (st.loaded) el.innerHTML = `<span class="dot"></span>${esc(st.id)} · ngữ cảnh ${st.contextSize} · ${st.gpu ? 'GPU ' + esc(String(st.gpu)) : 'CPU'}`;
  else el.innerHTML = `<span class="dot off"></span>Chưa nạp mô hình`;
  $('#ejectBtn').disabled = !st.loaded;
  $('#modelSelect').disabled = !!st.loading;
}
A.onModelStatus(st => { setStatus(st); if (!st.loading) refreshModels(); });

// ---------- Khám phá ----------
const COLORS = { Qwen: '#2ee6a6', Llama: '#7cc7ff', Gemma: '#ffb547' };
async function renderCatalog() {
  state.catalog = await A.catalog();
  $('#catalog').innerHTML = state.catalog.map(c => `<div class="card" data-id="${c.id}">
    <div class="card-top"><div class="av" style="background:${COLORS[c.family] || '#b69cff'}">${c.family.slice(0, 2)}</div><div><h4>${esc(c.name)}</h4><div class="sub">${c.params} tham số · ${c.quant} · ${fmtBytes(c.size)}</div></div></div>
    <p>${esc(c.desc)}</p>
    <div class="tags">${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}<span class="tag">${esc(c.ram)}</span>${c.installed ? '<span class="tag ok">✓ Đã tải</span>' : ''}</div>
    <div class="card-foot">${footFor(c)}</div></div>`).join('');
}
function footFor(c) {
  if (c.downloading) return dlBar(c.downloading.received, c.downloading.total);
  if (c.installed) return `<span>Có trên máy</span><button class="btn sm primary" data-act="use">Nạp & trò chuyện</button>`;
  return `<span>Hugging Face</span><button class="btn sm primary" data-act="dl">⬇ Tải về</button>`;
}
function dlBar(rec, total, speed) {
  const pct = total ? (rec / total * 100) : 0;
  return `<div class="dl-wrap"><div class="dl-row"><div class="progress"><div style="width:${pct.toFixed(1)}%"></div></div><button class="btn sm danger" data-act="cancel">Huỷ</button></div>
    <span>${pct.toFixed(1).replace('.', ',')}% · ${fmtBytes(rec)} / ${fmtBytes(total)}${speed ? ' · ' + fmtBytes(speed) + '/s' : ''}</span></div>`;
}
$('#catalog').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.card').dataset.id; const c = state.catalog.find(x => x.id === id);
  if (b.dataset.act === 'dl') { await A.download(id); b.closest('.card-foot').innerHTML = dlBar(0, c.size); }
  if (b.dataset.act === 'cancel') await A.cancelDownload(id);
  if (b.dataset.act === 'use') { await refreshModels(); const m = state.models.find(x => x.file.toLowerCase() === c.file.toLowerCase()); show('chat'); if (m) loadModel(m.id); }
});
A.onDownloadProgress(p => { const f = $(`.card[data-id="${p.id}"] .card-foot`); if (f) f.innerHTML = dlBar(p.received, p.total, p.speed); });
A.onDownloadDone(p => { toast('Tải xong ✓'); renderCatalog(); refreshModels(); });
A.onDownloadError(p => { toast('Lỗi tải: ' + p.message, true); renderCatalog(); });
A.onDownloadCancelled(() => { toast('Đã huỷ tải (có thể tiếp tục sau)'); renderCatalog(); });

// ---------- Trò chuyện ----------
async function loadConvos() { state.convos = await A.convos(); renderConvos(); }
function renderConvos() {
  $('#convoList').innerHTML = state.convos.map(c => `<div class="convo ${state.current && c.id === state.current.id ? 'active' : ''}" data-id="${c.id}"><span>${esc(c.title)}</span><button class="del" title="Xoá">✕</button></div>`).join('') || '<div class="muted" style="padding:8px;font-size:12.5px">Chưa có cuộc trò chuyện nào</div>';
}
$('#convoList').addEventListener('click', async (e) => {
  const row = e.target.closest('.convo'); if (!row) return;
  if (e.target.classList.contains('del')) { await A.deleteConvo(row.dataset.id); if (state.current && state.current.id === row.dataset.id) state.current = null; await loadConvos(); renderMessages(); return; }
  state.current = state.convos.find(c => c.id === row.dataset.id); renderConvos(); renderMessages();
});
$('#newChat').addEventListener('click', () => { state.current = null; renderConvos(); renderMessages(); $('#input').focus(); });

function renderMessages() {
  const box = $('#messages');
  const msgs = state.current ? state.current.messages : [];
  if (!msgs.length) {
    box.innerHTML = `<div class="empty"><svg class="logo-big" viewBox="0 0 40 40"><rect x="2" y="2" width="36" height="36" rx="11" fill="url(#lg)"/><path d="M11 28 L18 12 L22 12 L29 28 H25 L23.4 24 H16.6 L15 28 Z M17.8 21 H22.2 L20 15.4 Z" fill="#06150f"/><circle cx="31" cy="10" r="3" fill="#ffb547" stroke="#06150f" stroke-width="1.5"/></svg>
      <h2>Xin chào! Hôm nay bạn muốn hỏi gì?</h2><p>${state.status.loaded ? 'Mô hình đã sẵn sàng. Mọi thứ chạy ngay trên máy bạn, không cần Internet.' : 'Hãy chọn một mô hình ở thanh phía trên, hoặc vào <b>Khám phá</b> để tải mô hình đầu tiên.'}</p></div>`;
    return;
  }
  box.innerHTML = msgs.map((m, i) => {
    const atts = m.attachments && m.attachments.length ? `<div class="atts">${m.attachments.map(a => `<span class="att">${fileIcon(a.kind)} ${esc(a.name)} · ${fmtBytes(a.size)}</span>`).join('')}</div>` : '';
    const warn = m.docWarning ? `<div class="doc-warn">⚠ ${esc(m.docWarning)}</div>` : '';
    return `<div class="msg ${m.role}${m.error ? ' error' : ''}" data-i="${i}">${m.role === 'assistant' ? `<div class="who">AIVN${m.model ? ' · ' + esc(m.model) : ''}</div>` : ''}${atts}<div class="body">${m.role === 'assistant' ? md(m.content) : esc(m.content).replace(/\n/g, '<br>')}</div></div>${warn}`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

// ---------- Tệp đính kèm ----------
let pending = []; // [{id, name, size, kind, text, ok, loading}]
const MAX_FILES = 5;
function fileIcon(kind) { return kind === 'pdf' ? '📕' : kind === 'docx' ? '📘' : '📄'; }
function renderChips() {
  const el = $('#chips');
  el.hidden = !pending.length;
  el.innerHTML = pending.map(a => `<div class="chip${a.loading ? ' loading' : ''}" data-id="${a.id}" title="${esc(a.name)}${a.pages ? ' · ' + a.pages + ' trang' : ''}"><span class="ic">${fileIcon(a.kind)}</span><span class="nm">${esc(a.name)}</span><span class="sz">${a.size ? fmtBytes(a.size) : ''}${a.pages ? ' · ' + a.pages + ' trang' : ''}</span><button type="button" title="Bỏ tệp này" aria-label="Bỏ tệp">✕</button></div>`).join('');
}
$('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c && e.target.closest('button')) { pending = pending.filter(a => a.id !== c.dataset.id); renderChips(); } });
async function addFiles(paths) {
  paths = paths.filter(Boolean);
  if (!paths.length) return;
  const room = MAX_FILES - pending.length;
  if (room <= 0) { toast(`Chỉ gửi kèm tối đa ${MAX_FILES} tệp mỗi lần`, true); return; }
  if (paths.length > room) toast(`Chỉ gửi kèm tối đa ${MAX_FILES} tệp mỗi lần, đã bỏ bớt ${paths.length - room} tệp`, true);
  const items = paths.slice(0, room).map(p => ({ id: uid(), name: p.split(/[\\/]/).pop(), loading: true, path: p }));
  pending.push(...items); renderChips();
  const res = await A.extractFiles(items.map(i => i.path));
  res.forEach((r, k) => {
    const it = items[k];
    if (r.ok) Object.assign(it, { loading: false, ok: true, size: r.size, kind: r.kind, pages: r.pages, text: r.text });
    else { pending = pending.filter(a => a !== it); toast(r.error, true); }
  });
  renderChips();
}
$('#attachBtn').addEventListener('click', async () => addFiles(await A.pickFiles()));
const chatPane = $('#chatPane'), dz = $('#dropzone'); let dragDepth = 0;
chatPane.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dragDepth++; dz.classList.add('on'); } });
chatPane.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
chatPane.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dz.classList.remove('on'); } });
chatPane.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; dz.classList.remove('on');
  addFiles([...e.dataTransfer.files].map(f => A.pathForFile(f)));
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault()); // không cho cửa sổ mở tệp bị thả nhầm chỗ

const input = $('#input');
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; });
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  let text = input.value.trim();
  if (state.generating) return;
  if (pending.some(a => a.loading)) { toast('Đang đọc tệp, vui lòng đợi một chút…'); return; }
  const docsToSend = pending.filter(a => a.ok);
  if (!text && docsToSend.length) text = 'Hãy tóm tắt nội dung chính của tài liệu đính kèm.';
  if (!text) return;
  if (!state.status.loaded) { toast('Hãy nạp một mô hình trước khi trò chuyện', true); return; }
  if (!state.current) state.current = { id: uid(), title: text.slice(0, 48), messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  const conv = state.current;
  const userMsg = { role: 'user', content: text };
  if (docsToSend.length) userMsg.attachments = docsToSend.map(a => ({ name: a.name, size: a.size, kind: a.kind, pages: a.pages || null }));
  conv.messages.push(userMsg);
  pending = []; renderChips();
  const reply = { role: 'assistant', content: '', model: state.status.id };
  conv.messages.push(reply);
  input.value = ''; input.style.height = 'auto';
  renderMessages();
  const bodyEl = $('#messages .msg:last-child .body'); bodyEl.classList.add('cursor');
  const reqId = uid(); state.generating = reqId;
  $('#sendBtn').hidden = true; $('#stopBtn').hidden = false; $('#genStats').textContent = 'Đang suy nghĩ…';
  const s = state.settings;
  // Lịch sử gửi cho mô hình: chỉ tin nhắn có tài liệu gần nhất giữ toàn bộ nội dung đã đóng gói, tin cũ hơn chỉ ghi tên tệp
  const prior = conv.messages.slice(0, -2).filter(m => !m.error);
  const lastCtxIdx = docsToSend.length ? -1 : prior.map(m => !!m.context).lastIndexOf(true);
  const history = [{ role: 'system', content: s.systemPrompt }, ...prior.map((m, i) => ({ role: m.role,
      content: m.context && i === lastCtxIdx ? m.context : (m.attachments ? `[Đã gửi kèm: ${m.attachments.map(a => a.name).join(', ')}]\n` : '') + m.content })),
    { role: 'user', content: text }];
  const offInfo = A.onDocInfo((info) => {
    if (info.reqId !== reqId) return;
    userMsg.context = info.context;
    if (info.truncated) {
      const parts = info.files.filter(f => f.truncated).map(f => `${f.name} (~${f.usedPct}%)`).join(', ');
      userMsg.docWarning = `Tài liệu dài hơn giới hạn ngữ cảnh của mô hình, AIVN chỉ dùng một phần: ${parts}. Đã giữ phần mở đầu và các đoạn liên quan nhất tới câu hỏi. Tăng "Độ dài ngữ cảnh" trong cài đặt để dùng nhiều hơn.`;
      const box = $('#messages'); const w = document.createElement('div'); w.className = 'doc-warn'; w.textContent = '⚠ ' + userMsg.docWarning;
      box.insertBefore(w, box.lastElementChild);
    }
  });
  let rafPending = false;
  const off = A.onToken(({ reqId: r, t }) => {
    if (r !== reqId) return; reply.content += t;
    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; bodyEl.innerHTML = md(reply.content); const box = $('#messages'); box.scrollTop = box.scrollHeight; }); }
  });
  try {
    const r = await A.generate({ reqId, messages: history, temperature: s.temperature, maxTokens: s.maxTokens, docs: docsToSend.map(a => ({ name: a.name, text: a.text, kind: a.kind, pages: a.pages })) });
    reply.content = r.text || reply.content;
    $('#genStats').textContent = `${r.usage.completion_tokens} token · ${r.usage.tokensPerSecond.toFixed(1)} token/giây · ${r.usage.seconds.toFixed(1)} giây${r.finishReason === 'abort' ? ' · đã dừng' : r.finishReason === 'length' ? ' · chạm giới hạn token' : ''}`;
  } catch (err) {
    reply.error = true; reply.content = (reply.content ? reply.content + '\n\n' : '') + '⚠ ' + err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    $('#genStats').textContent = '';
  } finally {
    off(); offInfo(); state.generating = null; $('#sendBtn').hidden = false; $('#stopBtn').hidden = true;
    conv.updatedAt = Date.now(); await A.saveConvo(conv); await loadConvos(); renderMessages();
  }
});
$('#stopBtn').addEventListener('click', () => state.generating && A.stop(state.generating));

// ---------- Cài đặt ----------
function bindSettings() {
  const s = state.settings;
  $('#sysPrompt').value = s.systemPrompt; $('#temp').value = s.temperature; $('#tempOut').textContent = s.temperature;
  $('#maxTok').value = s.maxTokens; $('#ctxSize').value = String(s.contextSize);
  $('#srvPort').value = s.apiPort; $('#srvAuto').checked = !!s.apiAutoStart;
  const save = async (patch) => { state.settings = await A.setSettings(patch); };
  $('#sysPrompt').addEventListener('change', e => save({ systemPrompt: e.target.value }));
  $('#temp').addEventListener('input', e => { $('#tempOut').textContent = e.target.value; });
  $('#temp').addEventListener('change', e => save({ temperature: Number(e.target.value) }));
  $('#maxTok').addEventListener('change', e => save({ maxTokens: Math.max(16, Number(e.target.value) || 1024) }));
  $('#ctxSize').addEventListener('change', e => { save({ contextSize: Number(e.target.value) }); toast('Độ dài ngữ cảnh mới sẽ áp dụng khi nạp lại mô hình'); });
  $('#srvAuto').addEventListener('change', e => save({ apiAutoStart: e.target.checked }));
}

// ---------- Máy chủ ----------
function curlExample(port) {
  return `curl http://localhost:${port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${state.status.loaded ? state.status.id : 'qwen2.5-0.5b-instruct-q4_k_m'}",
    "messages": [{"role": "user", "content": "Xin chào!"}],
    "stream": false
  }'`;
}
function logLine(e) { const d = document.createElement('div'); d.innerHTML = `<span>${new Date(e.t).toLocaleTimeString('vi-VN')}</span>${esc(e.msg)}`; const l = $('#srvLog'); l.appendChild(d); l.scrollTop = l.scrollHeight; }
function paintServer(st) {
  $('#srvToggle').checked = st.running; $('#srvDot').classList.toggle('on', st.running);
  const port = st.port || $('#srvPort').value;
  $('#srvState').textContent = st.running ? 'Đang chạy' : 'Đang tắt';
  $('#srvUrl').textContent = `http://localhost:${port}/v1`;
  $('#srvPort').disabled = st.running; $('#curlEx').textContent = curlExample(port);
}
async function refreshServer() { const st = await A.serverStatus(); $('#srvLog').innerHTML = ''; st.log.forEach(logLine); paintServer(st); }
$('#srvToggle').addEventListener('change', async (e) => {
  try { paintServer(e.target.checked ? await A.startServer(Number($('#srvPort').value)) : await A.stopServer()); }
  catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); paintServer(await A.serverStatus()); }
});
$('#srvPort').addEventListener('input', () => { $('#curlEx').textContent = curlExample($('#srvPort').value); $('#srvUrl').textContent = `http://localhost:${$('#srvPort').value}/v1`; });
A.onServerLog(e => { logLine(e); A.serverStatus().then(paintServer); });

// ---------- Cập nhật ----------
function paintUpdate(st) {
  const t = $('#updateText'), act = $('#updAction'), prog = $('#updateProg'), chk = $('#updCheck');
  act.hidden = true; prog.hidden = true; chk.disabled = false; t.className = 'muted';
  switch (st.status) {
    case 'checking': t.textContent = 'Đang kiểm tra cập nhật…'; chk.disabled = true; break;
    case 'latest': t.className = 'ok'; t.textContent = `Bạn đang dùng bản mới nhất (${st.current || ''}).`.replace(' ()', ''); break;
    case 'available':
      t.className = 'ok'; t.textContent = `Có bản mới ${st.version}`;
      act.hidden = false; act.textContent = st.canInstallInPlace ? 'Tải về' : 'Mở trang tải về'; act.dataset.do = st.canInstallInPlace ? 'download' : 'open';
      if (st.silent && !paintUpdate.notified) { paintUpdate.notified = true; toast(`Có bản AIVN mới ${st.version}. Xem trong Cài đặt → Giới thiệu.`); }
      break;
    case 'downloading':
      chk.disabled = true; prog.hidden = false; prog.firstElementChild.style.width = (st.percent || 0).toFixed(1) + '%';
      t.textContent = `Đang tải bản mới… ${(st.percent || 0).toFixed(0)}%${st.total ? ' · ' + fmtBytes(st.transferred) + ' / ' + fmtBytes(st.total) : ''}`; break;
    case 'downloaded': t.className = 'ok'; t.textContent = `Đã tải xong bản ${st.version}.`; act.hidden = false; act.textContent = 'Khởi động lại để cập nhật'; act.dataset.do = 'install'; break;
    case 'error': t.className = st.silent ? 'muted' : 'err'; t.textContent = st.error || 'Không kiểm tra được cập nhật.'; break;
    default: t.textContent = 'Bấm “Kiểm tra cập nhật” để xem có bản mới không.';
  }
}
$('#updCheck').addEventListener('click', async () => paintUpdate({ ...(await A.checkUpdate()), silent: false }));
$('#updAction').addEventListener('click', async (e) => {
  const d = e.currentTarget.dataset.do;
  if (d === 'download') paintUpdate(await A.downloadUpdate());
  else if (d === 'install') A.installUpdate();
  else A.openReleases();
});
A.onUpdate((st) => A.updateState().then(full => paintUpdate({ ...full, ...st })));

// ---------- Khởi động ----------
(async () => {
  state.settings = await A.getSettings();
  bindSettings();
  setStatus(await A.modelStatus());
  await Promise.all([refreshModels(), loadConvos(), refreshServer()]);
  renderMessages();
  const info = await A.info();
  const h = info.hardware || {};
  $('#hwInfo').innerHTML = `RAM: ${fmtBytes(h.ram)} · ${h.cpus || '?'} luồng CPU<br>Tăng tốc: ${h.gpu ? '<b style="color:var(--accent)">GPU ' + esc(String(h.gpu)) + '</b>' : 'CPU'}${h.vram && h.vram.total ? ' · VRAM ' + fmtBytes(h.vram.total) : ''}<br>Phiên bản ${info.version}`;
  $('#aboutVer').textContent = 'phiên bản ' + info.version;
  paintUpdate(await A.updateState());
  $('#modelsDir').textContent = 'Thư mục lưu: ' + info.paths.models;
})();
