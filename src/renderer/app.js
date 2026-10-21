'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const A = window.aivn;
const state = { settings: null, models: [], status: { loaded: false }, convos: [], current: null, generating: null, catalog: [], mode: 'chat', lastByMode: {}, agent: null };
const isAgent = () => state.mode === 'agent';

const fmtBytes = (b) => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024))); return (b / 1024 ** i).toFixed(i >= 3 ? 2 : 0).replace('.', ',') + ' ' + u[i]; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let toastTimer;
const toastStack = (() => { const d = document.createElement('div'); d.className = 'toast-stack'; d.setAttribute('role', 'status'); d.setAttribute('aria-live', 'polite'); document.body.appendChild(d); return d; })();
function toast(msg, err = false, { sticky = false } = {}) {
  msg = String(msg ?? ''); if (!msg) return;
  // trùng nội dung: làm mới thay vì chồng thêm
  for (const el of toastStack.children) if (el.dataset.msg === msg) { el.remove(); }
  const el = document.createElement('div'); el.className = 'toast-item' + (err ? ' err' : ''); el.dataset.msg = msg; el.dataset.route = String(err ? '' : 'nav');
  el.innerHTML = `<span class="tx"></span><button type="button" aria-label="Đóng thông báo" title="Đóng">×</button>`; el.querySelector('.tx').textContent = msg;
  const close = () => { clearTimeout(el._t); el.remove(); };
  el.querySelector('button').addEventListener('click', close);
  toastStack.appendChild(el);
  while (toastStack.children.length > 3) toastStack.firstElementChild.remove();
  if (!sticky) el._t = setTimeout(close, err ? 10000 : Math.max(3500, Math.min(8000, msg.length * 45)));
  el.addEventListener('mouseenter', () => clearTimeout(el._t)); el.addEventListener('mouseleave', () => { if (!sticky) el._t = setTimeout(close, 3000); });
}
function clearInfoToasts() { for (const el of [...toastStack.children]) if (el.dataset.route === 'nav') el.remove(); }

// Markdown tối giản: khối code, code inline, in đậm, nghiêng, xuống dòng
function md(src) {
  const parts = src.split(/```/);
  return parts.map((p, i) => {
    if (i % 2) { const nl = p.indexOf('\n'); const code = nl >= 0 ? p.slice(nl + 1) : p; return `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`; }
    return esc(p).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/\n/g, '<br>');
  }).join('');
}

// ---------- Điều hướng ----------
function show(view, opts = {}) {
  const rt = document.querySelector('.rail-tip'); if (rt) rt.hidden = true;
  if (view === 'security') { opts = { ...opts, tab: 'security' }; view = 'settings'; }
  clearInfoToasts();
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const target = view === 'agent' ? 'chat' : view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + target));
  if (view === 'chat' || view === 'agent') setMode(view);
  if (view === 'schedule') refreshSched();
  if (view === 'memory') refreshMem();
  if (view === 'discover' && !$('#sugArea').hidden) renderCatalog();
  if (view === 'models') refreshModels();
  if (view === 'crm') renderCrm();
  if (view === 'server') refreshServer();
  if (view === 'settings') setTab(opts.tab || setTab.cur || 'general');
  document.title = 'AIVN · ' + (VIEW_TITLES[view] || 'Trò chuyện');
}
const VIEW_TITLES = { chat: 'Trò chuyện', agent: 'AIVN AGENT', server: 'Nhà phát triển', models: 'Mô hình của tôi', discover: 'Khám phá', schedule: 'Lịch tự động', memory: 'Ghi nhớ', settings: 'Cài đặt', crm: 'Khách hàng' };
$$('.nav-item').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });
// Trò chuyện thường và AIVN AGENT dùng chung khung chat; mỗi chế độ có danh sách cuộc trò chuyện riêng
function setMode(mode) {
  if (state.mode !== mode) {
    if (state.current) state.lastByMode[state.mode] = state.current.id;
    state.mode = mode;
    state.current = state.convos.find(c => c.id === state.lastByMode[mode] && convoMode(c) === mode) || null;
    pending = []; renderChips();
  }
  $('#view-chat').classList.toggle('agent-mode', mode === 'agent');
  $('#input').placeholder = mode === 'agent' ? 'Giao việc cho AIVN AGENT… (vd. đọc tệp bao-cao.csv, tính tổng rồi ghi tóm tắt vào tom-tat.md)' : 'Nhập tin nhắn… (Enter để gửi, Shift+Enter xuống dòng, kéo thả tệp hoặc dán ảnh bằng Ctrl+V)';
  $('#attachBtn').hidden = false;
  $('#newChat').textContent = mode === 'agent' ? '＋ Việc mới cho AIVN AGENT' : '＋ Cuộc trò chuyện mới';
  renderConvos(); renderMessages();
  if (state.models) $('#modelSelect').innerHTML = modelOptionsHtml(state.models, state.status.loaded ? state.status.id : '', mode === 'agent');
  if (mode === 'agent') refreshAgent();
}
const convoMode = (c) => c.mode === 'agent' ? 'agent' : 'chat';

// Tên hiển thị của mô hình (QA B12): tên trong Khám phá thay cho id tệp thô
function modelLabel(id) {
  const m = (state.models || []).find(x => x.id === id || x.file === id || (x.catalog && x.catalog.id === id));
  if (m) return m.catalog ? m.catalog.name : m.file.replace(/\.gguf$/i, '');
  const c = (state.catalog || []).find(x => x.id === id); return c ? c.name : String(id).replace(/\.gguf$/i, '');
}
// Hộp cảnh báo dưới câu trả lời: tiêu đề theo đúng loại cảnh báo (QA B5: không ghi “Chưa có việc nào được làm” khi công cụ đã chạy xong)
function warnBox(w) {
  const none = /^Mô hình này chưa thực sự thao tác gì/.test(w); const model = /mô hình/i.test(w);
  return `<div class="no-action" role="alert"><b>⚠ ${none ? 'Chưa có việc nào được làm' : 'Lưu ý'}</b><span>${esc(w)}</span>${model ? '<button type="button" class="btn sm" data-rec-go="1">Mở Khám phá</button>' : ''}</div>`;
}
// ---------- Mô hình ----------
// Bộ chọn mô hình: xếp theo mức chạy trên máy này (Chạy mượt → Chạy chậm → Không chạy được, mạnh trước).
// Chế độ AIVN AGENT: chỉ chọn được mô hình làm được việc agent; mô hình khác bị khoá kèm lý do ngắn.
function modelOptionsHtml(models, cur, agentMode) {
  const name = (m) => (m.vision ? '👁 ' : '') + (m.catalog ? m.catalog.name : m.file);
  const fitOf = (m) => agentMode ? (m.agentFit || m.fit) : m.fit;
  const opt = (m, dis, why) => `<option value="${esc(m.id)}" class="${fitGroupOf(fitOf(m)) === 'no' ? 'opt-no' : ''}" ${m.id === cur ? 'selected' : ''} ${dis ? 'disabled' : ''} title="${esc(why || (fitOf(m) ? fitOf(m).hint : ''))}">${esc(name(m))}${fitOf(m) && fitOf(m).text ? ' · ' + esc(fitOf(m).text) : ' · ' + fmtBytes(m.size)}${why ? ' — ' + esc(why) : ''}</option>`;
  const head = `<option value="">${models.length ? (agentMode ? '— Chọn mô hình cho AIVN AGENT —' : '— Chọn mô hình để nạp —') : '— Chưa có mô hình, hãy vào mục Khám phá —'}</option>`;
  const ok = agentMode ? models.filter(m => m.agent && m.agent.ok) : models;
  const bad = agentMode ? models.filter(m => !(m.agent && m.agent.ok)) : [];
  const groups = FIT_GROUPS.map(([k, label]) => { const items = sortFit(ok, fitOf).filter(m => fitGroupOf(fitOf(m)) === k); return items.length ? `<optgroup label="${esc(label)}">${items.map(m => opt(m, k === 'no' && agentMode, k === 'no' && agentMode ? 'Quá nặng cho máy' : '')).join('')}</optgroup>` : ''; }).join('');
  const blocked = bad.length ? `<optgroup label="Không dùng được cho AIVN AGENT">${sortFit(bad, fitOf).map(m => opt(m, true, (m.agent && m.agent.reason) || 'Chưa được AIVN kiểm chứng')).join('')}</optgroup>` : '';
  return head + groups + blocked;
}
async function refreshModels() {
  state.models = await A.models();
  const sel = $('#modelSelect');
  const cur = state.status.loaded ? state.status.id : '';
  sel.innerHTML = modelOptionsHtml(state.models, cur, isAgent());
  const t = $('#modelTable');
  if (!state.models.length) { t.innerHTML = `<div class="tr"><span class="muted">Chưa có mô hình nào. Hãy tải ở mục Khám phá hoặc nhập tệp GGUF có sẵn.</span></div>`; return; }
  t.innerHTML = `<div class="tr head"><span>Tên</span><span>Dung lượng</span><span>Nguồn</span><span>Đường dẫn</span><span>Thao tác</span></div>` +
    state.models.map(m => `<div class="tr" data-id="${esc(m.id)}">
      <span><b>${esc(m.catalog ? m.catalog.name : m.file)}</b>${m.loaded ? '<span class="badge">Đang nạp</span>' : ''}${m.vision ? '<span class="badge vis" title="Có tệp thị giác (mmproj) cạnh mô hình">👁 Nhìn được ảnh</span>' : ''}<div class="muted" style="font-size:11.5px">${esc(m.id)}</div></span>
      <span>${fmtBytes(m.size)}</span><span>${m.source === 'imported' ? 'Đã nhập' : 'Đã tải'}</span>
      <span class="path" title="${esc(m.path)}">${esc(m.path)}</span>
      <span class="acts">${m.loaded ? '<button class="btn sm" data-act="unload">Gỡ khỏi bộ nhớ</button>' : '<button class="btn sm primary" data-act="load">Nạp</button>'}
        <button class="btn sm" data-act="params" title="Tham số nạp cho mô hình này" aria-label="Tham số nạp">⚙</button><button class="btn sm" data-act="reveal" title="Hiện trong thư mục">📁</button><button class="btn sm danger" data-act="delete" title="Xoá">🗑</button></span></div>`).join('');
}
$('#modelTable').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.tr').dataset.id; const m = state.models.find(x => x.id === id);
  try {
    if (b.dataset.act === 'load') await loadModel(id);
    if (b.dataset.act === 'unload') await A.unloadModel();
    if (b.dataset.act === 'params') return openLoader(id);
    if (b.dataset.act === 'reveal') await A.reveal(m.path);
    if (b.dataset.act === 'delete') await A.deleteModel(id);
  } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  refreshModels();
});
async function loadModel(id, extra = {}) {
  if (!id) return false;
  let ok = false;
  let r = await A.loadModel(id, extra).catch(err => ({ ok: false, error: cleanErr(err.message) }));
  if (r && r.code === 'LOW_MEM') {
    const go = await modalAsk({ icon: '🧠', title: 'Có thể không đủ bộ nhớ', message: r.error, okLabel: 'Vẫn nạp', noLabel: 'Chọn bản nhỏ hơn' });
    if (!go) { show('discover'); return false; }
    r = await A.loadModel(id, { ...extra, force: true }).catch(err => ({ ok: false, error: cleanErr(err.message) }));
  }
  if (r && r.ok) { ok = true; toast(r.status && r.status.notice ? '⚠ ' + r.status.notice : 'Đã nạp mô hình ✓', !!(r.status && r.status.notice)); }
  else if (r && r.code === 'BAD_FILE') {
    const again = await modalAsk({ icon: '⚠️', title: 'Tệp mô hình bị lỗi', message: r.error, okLabel: r.catalogId ? 'Xoá và tải lại' : 'Xoá tệp', noLabel: 'Để sau' });
    if (again) { await A.deleteModel(r.modelId); if (r.catalogId) { show('discover'); try { paintJob(await A.dlStart({ catalogId: r.catalogId })); toast('Đang tải lại mô hình, xem tiến độ ở mục Đang tải'); } catch (e) { toast(cleanErr(e.message), true); } } }
  } else toast((r && r.error) || 'Không nạp được mô hình', true);
  refreshModels();
  return ok;
}
// Gửi tin khi chưa nạp mô hình: tự nạp mô hình đang chọn / dùng lần trước; nếu chưa có mô hình nào thì chỉ đường tới Khám phá
async function ensureLoaded() {
  if (state.status.loaded) return true;
  if (state.status.loading) { toast('Mô hình đang được nạp, chờ một chút rồi gửi lại', true); return false; }
  if (!state.models || !state.models.length) await refreshModels();
  const list = state.models || [];
  // AIVN AGENT: chỉ tự nạp mô hình dùng được cho agent (mạnh nhất chạy mượt)
  const agentList = sortFit(list.filter(m => m.agent && m.agent.ok), (m) => m.agentFit || m.fit);
  if (isAgent() && !agentList.length && list.length) { await refreshAgent(); toast('Chưa có mô hình nào trên máy dùng được cho AIVN AGENT — xem gợi ý ở biểu ngữ phía trên', true); return false; }
  const pool = isAgent() ? agentList : list;
  const pick = pool.find(m => m.id === $('#modelSelect').value) || pool.find(m => state.settings && m.id === state.settings.lastModel) || pool[0];
  if (!pick) {
    const go = await modalAsk({ icon: '📦', title: 'Chưa có mô hình nào', message: 'Bạn cần tải một mô hình trước khi trò chuyện. Mở Khám phá để tải (gợi ý: Qwen3 4B Instruct 2507, hoặc Qwen3 8B nếu máy mạnh)?', okLabel: 'Mở Khám phá', noLabel: 'Để sau' });
    if (go) show('discover'); return false;
  }
  toast(`Đang nạp ${pick.catalog ? pick.catalog.name : pick.file}…`);
  return loadModel(pick.id);
}
$('#modelSelect').addEventListener('change', e => e.target.value && loadModel(e.target.value));
$('#ejectBtn').addEventListener('click', async () => { await A.unloadModel(); refreshModels(); });
const doImport = async () => { state.models = await A.importModel(); refreshModels(); if (!$('#sugArea').hidden) renderCatalog(); };
$('#importBtn').addEventListener('click', doImport); $('#importBtn2').addEventListener('click', doImport);
$('#openDir').addEventListener('click', () => A.reveal());

// ---------- Hộp nạp mô hình (0.16, bố cục kiểu LM Studio): danh sách bên trái, tham số nạp theo từng mô hình bên phải ----------
const ld = { sel: null, metas: new Map(), form: null, est: null, estSeq: 0 };
const mName = (m) => m ? (m.catalog ? m.catalog.name : (m.file || m.id).replace(/\.gguf$/i, '').replace(/-0000\d-of-0000\d$/i, '')) : '';
const fmtTok = (n) => Number(n || 0).toLocaleString('vi-VN');
function paintPill(st) {
  const m = (state.models || []).find(x => x.id === st.id);
  $('#ldDot').className = 'dot' + (st.loading ? ' busy' : st.loaded ? '' : ' off');
  $('#ldPill').classList.toggle('on', !!st.loaded); $('#ldPill').classList.toggle('busy', !!st.loading); if (!st.loading) $('#ldPill').style.setProperty('--ldp', '0%');
  $('#ldName').textContent = st.loading ? `Đang nạp ${mName(m) || st.id || ''}…` : st.loaded ? (mName(m) || st.id) : 'Chọn mô hình để nạp';
  $('#ldMeta').textContent = st.loaded ? [`ngữ cảnh ${fmtTok(st.contextSize)}`, st.gpu ? (st.totalLayers ? `GPU ${st.gpuLayers}/${st.totalLayers}` : 'GPU') : 'CPU'].join(' · ') : '';
  $('#loaderBtn').title = (st.loaded ? `${$('#ldName').textContent} · ${$('#ldMeta').textContent}\n` : '') + 'Chọn mô hình để nạp (Ctrl+L)';
}
$('#loaderBtn').addEventListener('click', () => openLoader());
A.onModelProgress((p) => { if (!state.status.loading) return; const m = (state.models || []).find(x => x.id === p.id);
  $('#ldPill').style.setProperty('--ldp', p.pct + '%'); $('#ldName').textContent = `Đang nạp ${mName(m) || p.id || ''}…`; $('#ldMeta').textContent = p.pct + '%' + (({ 'gpu-partial': ' · GPU một phần', 'gpu-manual': ' · GPU (đặt tay)', cpu: ' · CPU', 'cpu-only': ' · CPU' })[p.mode] || ''); });
const CTX_STEPS = [4096, 8192, 12288, 16384, 24576, 32768, 49152, 65536, 98304, 131072, 196608, 262144];
function ctxSteps(max) { const a = CTX_STEPS.filter(x => x <= max); if (!a.length || a[a.length - 1] !== max) a.push(max); return a; }
async function openLoader(id) {
  if (!state.models) await refreshModels();
  $('#loader').hidden = false; $('#ldQ').value = '';
  const list = ldSorted();
  ld.sel = id || (state.status.loaded && state.status.id) || (state.settings && list.some(m => m.id === state.settings.lastModel) ? state.settings.lastModel : null) || (list[0] && list[0].id) || null;
  renderLdList(); const p = selectLd(ld.sel); $('#ldQ').focus();
  (async () => { for (const m of list) { if (!ld.metas.has(m.id)) { await ldMeta(m.id); if (!$('#loader').hidden) renderLdList(); } } })();
  await p;
}
function closeLoader() { $('#loader').hidden = true; $('#loaderBtn').focus(); }
function ldSorted() {
  const q = $('#ldQ').value.trim().toLowerCase(); const last = state.settings && state.settings.lastModel;
  return (state.models || []).filter(m => !q || (mName(m) + ' ' + m.file).toLowerCase().includes(q))
    .sort((a, b) => (b.loaded - a.loaded) || ((b.id === last) - (a.id === last)) || mName(a).localeCompare(mName(b), 'vi'));
}
function renderLdList() {
  const list = ldSorted(), el = $('#ldList'), all = (state.models || []).length;
  $('#ldCount').textContent = all ? (list.length === all ? `${all} mô hình` : `${list.length}/${all} mô hình`) : '';
  if (!all) { el.innerHTML = ''; $('#ldPane').innerHTML = `<div class="ld-empty"><div class="ld-empty-ic">📦</div><h4>Chưa có mô hình nào trên máy</h4><p class="muted">Tải một mô hình ở mục Khám phá (gợi ý: Qwen3 4B Instruct 2507), hoặc nhập tệp GGUF bạn đã có.</p><div class="row"><button class="btn primary" data-ld="discover">Mở Khám phá</button><button class="btn" data-ld="import">Nhập tệp GGUF…</button></div></div>`; ldFoot(); return; }
  if (!list.length) { el.innerHTML = `<div class="ld-none muted small">Không có mô hình nào khớp “${esc($('#ldQ').value.trim())}”.</div>`; return; }
  const loadingId = state.status.loading ? state.status.id : null;
  el.innerHTML = list.map(m => { const g = ld.metas.get(m.id); const saved = state.settings && state.settings.modelLoad && state.settings.modelLoad[m.id];
    return `<div class="ld-item${m.id === ld.sel ? ' sel' : ''}" role="option" aria-selected="${m.id === ld.sel}" data-id="${esc(m.id)}" tabindex="-1">
      <div class="ld-i-main"><b>${esc(mName(m))}</b>${m.loaded ? '<span class="ld-tag on">Đang dùng</span>' : ''}${m.id === loadingId ? '<span class="ld-tag busy">Đang nạp…</span>' : ''}</div>
      <div class="ld-i-sub small muted">${[g && g.arch, g && g.sizeLabel, g && g.quant || (m.file.match(/(I?Q\d[_A-Z0-9]*|F16|BF16)/i) || [])[1], fmtBytes(m.size)].filter(Boolean).map(esc).join(' · ')}${m.vision ? ' · 👁' : ''}${saved ? ' · <span title="Đã lưu tham số nạp riêng">⚙ riêng</span>' : ''}</div></div>`; }).join('');
  const s = el.querySelector('.ld-item.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
}
async function ldMeta(id) {
  if (!ld.metas.has(id)) { const g = await A.modelMeta(id).catch(() => null); ld.metas.set(id, g); }
  return ld.metas.get(id);
}
function defaultForm(g) {
  const sv = (g && g.saved) || {}; const max = Math.max(4096, (g && g.trainCtx) || 32768);
  const ctx = Math.min(max, Math.max(4096, sv.contextSize || (g && g.global && g.global.contextSize) || 8192));
  const gl = sv.gpuLayers != null ? sv.gpuLayers : (g && g.global && g.global.gpuLayers != null ? g.global.gpuLayers : 'auto');
  return { contextSize: ctx, gpuLayers: gl, flashAttention: sv.flashAttention == null ? 'auto' : sv.flashAttention ? 'on' : 'off', kvCache: sv.kvCache || 'auto', threads: sv.threads || 0, batchSize: sv.batchSize || 0, mmap: sv.mmap !== false, mlock: !!sv.mlock };
}
function formToLoad(f) {
  const o = { contextSize: f.contextSize };
  if (f.gpuLayers !== 'auto') o.gpuLayers = f.gpuLayers;
  if (f.flashAttention !== 'auto') o.flashAttention = f.flashAttention === 'on';
  if (f.kvCache !== 'auto') o.kvCache = f.kvCache;
  if (f.threads) o.threads = f.threads; if (f.batchSize) o.batchSize = f.batchSize;
  if (!f.mmap) o.mmap = false; if (f.mlock) o.mlock = true;
  return o;
}
async function selectLd(id) {
  ld.sel = id; renderLdList();
  const m = (state.models || []).find(x => x.id === id); const pane = $('#ldPane');
  if (!m) { ldFoot(); return; }
  pane.innerHTML = `<div class="ld-skel"><div></div><div></div><div></div></div>`;
  const g = await ldMeta(id); if (ld.sel !== id) return;
  ld.form = defaultForm(g); renderLdPane(m, g); ldFoot(); ldEstimate();
}
function renderLdPane(m, g) {
  const f = ld.form; const bad = !g || g.error;
  const max = Math.max(4096, (g && g.trainCtx) || 32768); const steps = ctxSteps(max); const L = g && g.layers ? g.layers + 1 : null;
  const si = steps.reduce((bi, v, i) => Math.abs(v - f.contextSize) < Math.abs(steps[bi] - f.contextSize) ? i : bi, 0);
  const st = state.status; const cur = m.loaded && st.loaded ? `<div class="ld-cur small">Đang chạy với ngữ cảnh <b>${fmtTok(st.contextSize)}</b> · ${st.gpu ? `GPU <b>${st.gpuLayers ?? '?'}/${st.totalLayers ?? '?'}</b> lớp` : '<b>chỉ CPU</b>'}${st.perf && st.perf.kv ? ` · bộ đệm K/V ${esc(st.perf.kv)}` : ''}</div>` : '';
  $('#ldPane').innerHTML = `
    <div class="ld-title"><h4 title="${esc(m.file)}">${esc(mName(m))}</h4>
      <div class="ld-chips">${[g && g.arch, g && g.sizeLabel && g.sizeLabel + ' tham số', g && g.quant, fmtBytes(m.size), g && g.trainCtx && 'tối đa ' + fmtTok(g.trainCtx) + ' token', m.vision && '👁 nhìn ảnh', g && g.templateTools && 'gọi công cụ'].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</div>
      <div class="small muted ld-file" title="${esc(m.path)}">${esc(m.file)}</div>${cur}</div>
    ${bad ? `<div class="ld-warn" role="alert">⚠ Không đọc được thông tin tệp mô hình (${esc((g && g.error) || 'không tìm thấy tệp hoặc tệp bị hỏng')}). AIVN vẫn có thể thử nạp với tham số tự động.</div>` : ''}
    <section class="ld-sec"><div class="ld-row"><label for="ldCtx">Độ dài ngữ cảnh</label><span class="ld-val"><input type="number" id="ldCtxN" min="4096" max="${max}" step="1024" value="${f.contextSize}" aria-label="Độ dài ngữ cảnh (token)"> token</span></div>
      <input type="range" id="ldCtx" min="0" max="${steps.length - 1}" step="1" value="${si}" aria-label="Độ dài ngữ cảnh" aria-valuetext="${fmtTok(f.contextSize)} token">
      <div class="ld-ticks small muted"><span>${fmtTok(steps[0])}</span><span>${fmtTok(max)}</span></div>
      <p class="hint">Số token mô hình nhớ được trong một cuộc trò chuyện. Trò chuyện cần ít nhất 4.096; AIVN AGENT cần ít nhất 8.192. Ngữ cảnh lớn tốn thêm bộ nhớ.</p></section>
    <section class="ld-sec" id="ldGpuSec"${L ? '' : ' hidden'}><div class="ld-row"><label for="ldGpu">Tăng tốc GPU</label><span class="ld-val"><label class="ld-auto"><input type="checkbox" id="ldGpuAuto" ${f.gpuLayers === 'auto' ? 'checked' : ''}> Tự động</label><input type="number" id="ldGpuN" min="0" max="${L || 999}" value="${f.gpuLayers === 'auto' ? '' : f.gpuLayers}" ${f.gpuLayers === 'auto' ? 'disabled' : ''} aria-label="Số lớp đưa lên GPU"> ${L ? '/ ' + L + ' lớp' : 'lớp'}</span></div>
      <input type="range" id="ldGpu" min="0" max="${L || 99}" step="1" value="${f.gpuLayers === 'auto' ? (L || 0) : f.gpuLayers}" ${f.gpuLayers === 'auto' ? 'disabled' : ''} aria-label="Số lớp đưa lên GPU">
      <p class="hint" id="ldGpuHint">Đưa càng nhiều lớp lên GPU càng nhanh. Nếu không đủ VRAM, giảm số lớp — phần còn lại chạy bằng CPU và RAM.</p></section>
    <section class="ld-sec ld-mem" id="ldMem" aria-live="polite"${bad ? ' hidden' : ''}><div class="ld-row"><span class="lbl">Ước lượng bộ nhớ</span><span class="ld-verdict" id="ldVerdict">…</span></div><div id="ldBars"></div></section>
    <details class="ld-adv" id="ldAdv"><summary>Nâng cao</summary><div class="ld-grid">
      <label>Flash Attention<select id="ldFa"><option value="auto">Tự động</option><option value="on">Bật</option><option value="off">Tắt</option></select></label>
      <label>Bộ đệm K/V<select id="ldKv"><option value="auto">Tự động</option><option value="f16">F16 (chuẩn)</option><option value="q8_0">Q8_0 (tiết kiệm ~½)</option></select></label>
      <label>Số luồng CPU<input type="number" id="ldThr" min="0" max="256" value="${f.threads || ''}" placeholder="Tự động"></label>
      <label>Kích thước lô<input type="number" id="ldBatch" min="32" max="8192" step="32" value="${f.batchSize || ''}" placeholder="Tự động"></label>
      <label class="ck"><input type="checkbox" id="ldMmap" ${f.mmap ? 'checked' : ''}> Ánh xạ tệp vào bộ nhớ (mmap)</label>
      <label class="ck"><input type="checkbox" id="ldMlock" ${f.mlock ? 'checked' : ''}> Giữ mô hình trong RAM (không cho đẩy ra ổ đĩa)</label>
    </div><button class="linkbtn small" id="ldReset">Khôi phục mặc định</button></details>`;
  $('#ldFa').value = f.flashAttention; $('#ldKv').value = f.kvCache;
  if (localStorage.getItem('aivn.ldAdv') === '1') $('#ldAdv').open = true;
}
function ldRead() {
  const f = ld.form; if (!f) return;
  const g = ld.metas.get(ld.sel); const max = Math.max(4096, (g && g.trainCtx) || 32768);
  const n = Math.round(Number($('#ldCtxN').value)); if (Number.isFinite(n)) f.contextSize = Math.max(4096, Math.min(max, n));
  f.gpuLayers = $('#ldGpuAuto').checked ? 'auto' : Math.max(0, Math.round(Number($('#ldGpuN').value) || 0));
  f.flashAttention = $('#ldFa').value; f.kvCache = $('#ldKv').value;
  f.threads = Math.max(0, Math.round(Number($('#ldThr').value) || 0)); f.batchSize = Math.round(Number($('#ldBatch').value) || 0);
  f.mmap = $('#ldMmap').checked; f.mlock = $('#ldMlock').checked;
}
async function ldEstimate() {
  const f = ld.form, id = ld.sel; if (!f || !id) return; const seq = ++ld.estSeq; const gm = ld.metas.get(id); if (!gm || gm.error) return;
  const e = await A.modelEstimate(id, { ctx: f.contextSize, gpuLayers: f.gpuLayers, kvType: f.kvCache === 'q8_0' ? 'q8_0' : 'f16' }).catch(() => null);
  if (seq !== ld.estSeq || $('#loader').hidden || !$('#ldBars')) return; ld.est = e;
  if (!e) { $('#ldVerdict').textContent = 'Không ước lượng được'; $('#ldVerdict').className = 'ld-verdict'; $('#ldBars').innerHTML = ''; return; }
  const h = e.hw || {}; const gb = (b) => (b / 1024 ** 3).toFixed(1).replace('.', ',') + ' GB';
  const lvl = (p) => p < 0.85 ? 'ok' : p < 1 ? 'warn' : 'bad';
  const bar = (label, used, total, note) => { const p = total ? used / total : 0; return `<div class="ld-bar ${lvl(p)}"><div class="ld-bar-h small"><span>${label}</span><span><b>${gb(used)}</b>${total ? ' / ' + gb(total) : ''}${note ? ' · ' + note : ''}</span></div><div class="ld-track"><div style="width:${Math.min(100, p * 100).toFixed(1)}%"></div></div></div>`; };
  const vt = h.vram && h.vram.total || 0; let html = '', worst = 0;
  if (h.unified) { const tot = h.ram || 0; const used = e.vram + e.ram; worst = tot ? used / tot / 0.75 : 0; html = bar('Bộ nhớ hợp nhất (GPU + RAM)', used, tot, 'Apple Metal'); }
  else { if (h.gpu && vt) { const p = e.vram / vt * 0.9; worst = Math.max(worst, p); html += bar('VRAM' + (h.devices && h.devices[0] ? ' · ' + esc(h.devices[0]) : ''), e.vram, vt, e.gpuLayers + '/' + e.totalLayers + ' lớp'); }
    const rt = h.ram || 0; if (rt) { const p = e.ram / (rt * 0.8); worst = Math.max(worst, p); html += bar('RAM', e.ram, rt, ''); } }
  html += `<div class="small muted ld-kvline">Bộ đệm K/V cho ${fmtTok(f.contextSize)} token: ${gb(e.kv)}${f.kvCache === 'q8_0' ? ' (đã nén Q8_0)' : ''}</div>`;
  $('#ldBars').innerHTML = html;
  const v = $('#ldVerdict'); const l = lvl(worst);
  v.className = 'ld-verdict ' + l; v.textContent = l === 'ok' ? '✓ Vừa với máy của bạn' : l === 'warn' ? '⚠ Sát giới hạn — có thể chậm' : '✕ Có thể không đủ bộ nhớ';
  if (f.gpuLayers === 'auto') { $('#ldGpu').value = e.gpuLayers; $('#ldGpuN').placeholder = String(e.gpuLayers); }
  const hint = $('#ldGpuHint'); if (hint) hint.textContent = !h.gpu ? 'Không thấy GPU dùng được — mô hình sẽ chạy bằng CPU và RAM.' : f.gpuLayers === 'auto' ? `Tự động: AIVN ước lượng đưa ${e.gpuLayers}/${e.totalLayers} lớp lên GPU (${esc(String(h.gpu).toUpperCase())}) và vẫn giữ đủ ngữ cảnh.` : 'Đưa càng nhiều lớp lên GPU càng nhanh. Nếu không đủ VRAM, giảm số lớp — phần còn lại chạy bằng CPU và RAM.';
  if (!h.gpu) { for (const x of ['#ldGpu', '#ldGpuN', '#ldGpuAuto']) $(x).disabled = true; $('#ldGpuSec').classList.add('off'); }
}
function ldFoot() {
  const m = (state.models || []).find(x => x.id === ld.sel); const st = state.status; const go = $('#ldGo');
  $('#ldUnload').hidden = !(m && m.loaded);
  go.disabled = !m || !!st.loading; go.classList.toggle('busy', !!st.loading);
  go.textContent = st.loading ? 'Đang nạp…' : m && m.loaded ? 'Nạp lại với cài đặt này' : 'Nạp mô hình';
  $('#ldRemember').disabled = !m;
}
let ldTimer = null;
$('#ldPane').addEventListener('input', (e) => {
  const t = e.target; const g = ld.metas.get(ld.sel); if (!ld.form) return;
  if (t.id === 'ldCtx') { const steps = ctxSteps(Math.max(4096, (g && g.trainCtx) || 32768)); $('#ldCtxN').value = steps[+t.value]; t.setAttribute('aria-valuetext', fmtTok(steps[+t.value]) + ' token'); }
  if (t.id === 'ldGpu') $('#ldGpuN').value = t.value;
  if (t.id === 'ldGpuN') $('#ldGpu').value = t.value;
  ldRead(); clearTimeout(ldTimer); ldTimer = setTimeout(ldEstimate, 60);
});
$('#ldPane').addEventListener('change', (e) => {
  const t = e.target; if (!ld.form) return;
  if (t.id === 'ldGpuAuto') { const on = t.checked; $('#ldGpu').disabled = on; $('#ldGpuN').disabled = on; if (!on) { $('#ldGpuN').value = $('#ldGpu').value; } }
  if (t.id === 'ldCtxN') { ldRead(); t.value = ld.form.contextSize; const g = ld.metas.get(ld.sel); const steps = ctxSteps(Math.max(4096, (g && g.trainCtx) || 32768)); $('#ldCtx').value = steps.reduce((bi, v, i) => Math.abs(v - ld.form.contextSize) < Math.abs(steps[bi] - ld.form.contextSize) ? i : bi, 0); }
  ldRead(); ldEstimate();
});
$('#ldPane').addEventListener('toggle', (e) => { if (e.target.id === 'ldAdv') localStorage.setItem('aivn.ldAdv', e.target.open ? '1' : '0'); }, true);
$('#ldPane').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'ldReset') { const g = ld.metas.get(ld.sel); await A.saveModelLoad(ld.sel, null); if (g) g.saved = {}; state.settings = await A.getSettings().catch(() => state.settings); ld.form = defaultForm(g); renderLdPane((state.models || []).find(x => x.id === ld.sel), g); ldEstimate(); renderLdList(); toast('Đã khôi phục tham số nạp mặc định'); }
  if (b.dataset.ld === 'discover') { closeLoader(); show('discover'); }
  if (b.dataset.ld === 'import') { closeLoader(); doImport(); }
});
$('#ldList').addEventListener('click', (e) => { const it = e.target.closest('.ld-item'); if (it) selectLd(it.dataset.id); });
$('#ldList').addEventListener('dblclick', (e) => { const it = e.target.closest('.ld-item'); if (it) ldLoad(); });
$('#ldQ').addEventListener('input', () => { const list = ldSorted(); if (list.length && !list.some(m => m.id === ld.sel)) selectLd(list[0].id); else renderLdList(); });
$('#loader').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeLoader(); return; }
  const inList = document.activeElement === $('#ldQ') || $('#ldList').contains(document.activeElement);
  if (inList && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const list = ldSorted(); if (!list.length) return; let i = list.findIndex(m => m.id === ld.sel); i = Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); selectLd(list[i].id); }
  else if (e.key === 'Enter' && (inList || (e.ctrlKey || e.metaKey))) { e.preventDefault(); if (!$('#ldGo').disabled) ldLoad(); }
});
$('#loader').addEventListener('mousedown', (e) => { if (e.target.id === 'loader') closeLoader(); });
$('#ldCancel').addEventListener('click', closeLoader);
$('#ldUnload').addEventListener('click', async () => { await A.unloadModel(); await refreshModels(); renderLdList(); ldFoot(); selectLd(ld.sel); });
async function ldLoad() {
  if (!ld.sel || state.status.loading) return; if ($('#ldPane input')) ldRead();
  const id = ld.sel, load = ld.form ? formToLoad(ld.form) : null, remember = $('#ldRemember').checked;
  closeLoader();
  const ok = await loadModel(id, load ? { load, remember } : {});
  if (remember) { state.settings = await A.getSettings().catch(() => state.settings); ld.metas.delete(id); }
  return ok;
}
$('#ldGo').addEventListener('click', ldLoad);

function setStatus(st) {
  state.status = st;
  const el = $('#modelState');
  if (st.loading) el.innerHTML = `<span class="dot busy"></span>Đang nạp ${esc(st.id || '')}…`;
  else if (st.loaded) el.innerHTML = `<span class="dot"></span>${esc(st.id)}${st.vision ? ' · <b class="vis-pill" title="Mô hình nhìn được ảnh: ảnh bạn dán được gửi thẳng cho mô hình">👁 nhìn ảnh</b>' : ''} · ngữ cảnh ${st.contextSize} · ${st.gpu ? 'GPU ' + esc(String(st.gpu)) : 'CPU'}`;
  else el.innerHTML = `<span class="dot off"></span>Chưa nạp mô hình`;
  el.title = el.textContent;
  $('#ejectBtn').disabled = !st.loaded;
  $('#modelSelect').disabled = !!st.loading;
  paintSbModel(st); paintPill(st);
  if (!$('#loader').hidden) { renderLdList(); ldFoot(); }
}
A.onModelStatus(st => { setStatus(st); if (!st.loading) { refreshModels(); refreshChatDefaults(); } if (!st.loading && isAgent()) refreshAgent(); });

// ---------- Khám phá ----------

const jobs = new Map(); // id -> snapshot
const disc = { fam: 'all', results: null, repo: null, lastQuery: null };
const fmtNum = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' Tr' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.', ',') + ' N' : String(n || 0);
const fmtEta = (s) => s == null ? '' : s < 60 ? Math.ceil(s) + ' giây' : s < 3600 ? Math.ceil(s / 60) + ' phút' : Math.floor(s / 3600) + ' giờ ' + Math.round((s % 3600) / 60) + ' phút';
const fmtAgo = (iso) => { if (!iso) return ''; const d = (Date.now() - new Date(iso)) / 864e5; return d < 1 ? 'hôm nay' : d < 30 ? Math.floor(d) + ' ngày trước' : d < 365 ? Math.floor(d / 30) + ' tháng trước' : Math.floor(d / 365) + ' năm trước'; };
const fmtParams = (n) => !n ? '' : n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace('.', ',') + 'B tham số' : Math.round(n / 1e6) + 'M tham số';
const cleanErr = (m) => String(m).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
// Mức chạy trên máy này (src/fit.js): Chạy mượt (trọn trong VRAM) · Chạy chậm (tràn sang RAM) · Không chạy được — kèm tốc độ và bộ nhớ ước tính
const fitBadge = (f) => f ? `<span class="fit ${f.level}" title="${esc(f.hint + (f.ctx ? ` · tính với ngữ cảnh ${Number(f.ctx).toLocaleString('vi-VN')} token` : '') + ' · số liệu ước tính')}">${esc(f.label)}${f.text ? ` <small>· ${esc(f.text)}</small>` : ''}</span>` : '';
const FIT_GROUPS = [['smooth', 'Chạy mượt', 'nằm trọn trong VRAM, mạnh trước'], ['slow', 'Chạy chậm', 'tràn sang RAM, mạnh trước'], ['no', 'Không chạy được', 'lớn hơn VRAM + RAM của máy này']];
const fitGroupOf = (f) => (f && (f.group || ({ fit: 'smooth', slow: 'slow', big: 'no' })[f.level])) || 'slow';
// xếp: Chạy mượt → Chạy chậm → Không chạy được, trong mỗi nhóm mạnh trước
function sortFit(list, fitOf = (c) => c.fit) {
  const o = { smooth: 0, slow: 1, no: 2 };
  return [...list].sort((a, b) => o[fitGroupOf(fitOf(a))] - o[fitGroupOf(fitOf(b))] || (b.strength || 0) - (a.strength || 0) || (a.size || 0) - (b.size || 0));
}
function fitSections(list, card, fitOf = (c) => c.fit) {
  const sorted = sortFit(list, fitOf);
  return FIT_GROUPS.map(([k, label, sub]) => { const items = sorted.filter(c => fitGroupOf(fitOf(c)) === k); return items.length ? `<div class="fit-group fit-group-${k}"><h4 class="fit-head">${esc(label)} <span class="muted small">· ${esc(sub)} · ${items.length}</span></h4><div class="cards">${items.map(card).join('')}</div></div>` : ''; }).join('');
}
const jobIdFor = (repo, file) => `${repo}::${file}`;

function progressHtml(j) {
  const pct = j.total ? j.received / j.total * 100 : 0;
  const active = j.status === 'downloading' || j.status === 'queued';
  const info = j.status === 'queued' ? 'Đang chờ trong hàng đợi…'
    : j.status === 'paused' ? `Đã tạm dừng · ${fmtBytes(j.received)} / ${fmtBytes(j.total)}`
    : j.status === 'error' ? esc(j.error || 'Lỗi tải')
    : `${pct.toFixed(1).replace('.', ',')}% · ${fmtBytes(j.received)} / ${fmtBytes(j.total)}${j.speed ? ' · ' + fmtBytes(j.speed) + '/s' : ''}${j.eta ? ' · còn ' + fmtEta(j.eta) : ''}${j.parts > 1 ? ` · phần ${j.part || 1}/${j.parts}` : ''}`;
  return `<div class="dl-wrap"><div class="dl-row"><div class="progress${j.status === 'error' ? ' bad' : ''}"><div style="width:${pct.toFixed(1)}%"></div></div>
    ${active ? `<button class="btn sm" data-act="pause" data-jid="${esc(j.id)}" title="Tạm dừng">⏸</button>` : `<button class="btn sm primary" data-act="resume" data-jid="${esc(j.id)}">Tiếp tục</button>`}
    <button class="btn sm danger" data-act="remove" data-jid="${esc(j.id)}" title="Huỷ và xoá phần đã tải">Huỷ</button></div>
    <span class="${j.status === 'error' ? 'err' : ''}">${info}</span></div>`;
}
// item: { installed, partial, size, job } ; startAttrs: thuộc tính cho nút Tải
function footHtml(item, startAttrs, file) {
  const j = item.job && jobs.get(item.job.id) || item.job;
  if (j && j.status !== 'done') return progressHtml(j);
  if (item.installed || (j && j.status === 'done')) return `<span class="ok">✓ Có trên máy</span><button class="btn sm primary" data-act="use" data-file="${esc(file)}">Nạp & trò chuyện</button>`;
  if (item.partial > 0) return `<span>Đã tải ${fmtBytes(item.partial)} / ${fmtBytes(item.size)}</span><button class="btn sm primary" ${startAttrs}>⬇ Tải tiếp</button>`;
  return `<span>${fmtBytes(item.size)}</span><button class="btn sm primary" ${startAttrs}>⬇ Tải về</button>`;
}

async function renderCatalog() {
  state.catalog = await A.catalog();
  const fams = ['all', ...new Set(state.catalog.map(c => c.family))];
  $('#famFilter').innerHTML = fams.map(f => `<button class="chip-btn ${disc.fam === f ? 'on' : ''}" data-fam="${esc(f)}">${f === 'all' ? 'Tất cả' : esc(f)}</button>`).join('');
  const list = state.catalog.filter(c => disc.fam === 'all' || c.family === disc.fam);
  // Điều khiển máy tính: chỉ mô hình AIVN AGENT dùng được (nhìn màn hình + gọi công cụ đã kiểm chứng + định vị đạt), xếp theo mức chạy với ngữ cảnh agent
  const comp = list.filter(c => c.agentCheck && c.agentCheck.code !== 'text' && c.agentCheck.code !== 'tools' && c.agentCheck.code !== 'ground' && c.agentCheck.code !== 'unknown');
  $('#screenArea').hidden = !comp.length;
  $('#screenCards').innerHTML = fitSections(comp, (c) => catCard(c, true), (c) => c.agentFit || c.fit);
  const ctxNote = comp.find(c => c.agentCtx) ? comp.find(c => c.agentCtx).agentCtx : 0; const pn = $('#screenCtxNote'); if (pn) pn.textContent = ctxNote && ctxNote < 16384 ? `Mức chạy ở mục này tính với ngữ cảnh AIVN AGENT ${ctxNote.toLocaleString('vi-VN')} token: máy này không có mô hình AIVN AGENT nào nằm trọn VRAM ở 16K, nên AIVN dùng 12K (lịch sử và ảnh màn hình được tự thu gọn).` : (ctxNote ? `Mức chạy ở mục này tính với ngữ cảnh AIVN AGENT ${ctxNote.toLocaleString('vi-VN')} token.` : '');
  $('#catalog').innerHTML = fitSections(list.filter(c => !comp.includes(c)), catCard);
}
const roleTag = (c) => c.role === 'planner' ? '<span class="tag" title="Mô hình này chỉ đọc chữ, không nhìn được màn hình nên không dùng được cho AIVN AGENT. Dùng tốt trong Trò chuyện.">Chỉ dùng cho Trò chuyện</span>': c.role === 'grounder' ? '<span class="tag comp" title="Nhìn được ảnh chụp màn hình: đọc màn hình và chỉ ra toạ độ cần bấm, kể cả với Zalo/ứng dụng Electron không cho đọc nút/ô.">🎯 Nhìn màn hình</span>' : '';
function benchTag(c) {
  const b = c.bench; if (!c.role && !b) return '';
  const out = [];
  if (b && b.done === 10) out.push(`<span class="tag bench ${b.score >= 7 ? 'good' : 'low'}" title="${esc(`Đo trên ${b.where}${b.date ? ' ngày ' + new Date(b.date).toLocaleDateString('vi-VN') : ''}: 10 việc có kịch bản (mở ứng dụng, bấm nút có tên, gõ tiếng Việt, đọc chữ, nhấp đúp…). An toàn (hỏi trước khi gửi): ${b.safety === null ? 'chưa đo' : b.safety ? 'đạt' : 'KHÔNG đạt'}. ${b.seconds ? 'Tổng ' + Math.round(b.seconds / 60) + ' phút.' : ''}`)}">Điểm tác vụ: ${b.score}/10</span>`);
  if (b && b.grounding) out.push(`<span class="tag bench ${b.grounding.score >= 7 ? 'good' : 'low'}" title="${esc(`Bài đo định vị: chỉ đúng ${b.grounding.score}/10 nút trên ảnh chụp cửa sổ AIVN Bench (đo trên ${b.where}).`)}">Điểm định vị: ${b.grounding.score}/10</span>`);
  else if (c.role === 'grounder') out.push('<span class="tag bench" title="Chưa đo trên máy nào; chưa được gắn nhãn Gợi ý.">Điểm định vị: chưa đo</span>');
  return out.join('');
}
// Nhãn khả năng có nguồn (src/catalog-claims.js): ✓ AIVN đã tự kiểm chứng · ⓘ theo lời nhà phát triển · ⚠ AIVN thử chưa đạt
const CLAIM_MARK = { v: '✓', d: 'ⓘ', x: '⚠' };
const srcHost = (u) => { try { const h = new URL(u).hostname.replace(/^www\./, ''); return /verified\.(md|html)/.test(u) ? 'trang kiểm chứng của AIVN' : h; } catch { return u; } };
function claimTitle(cl) {
  const body = cl.k === 'd' ? `Nhà phát triển ghi: “${cl.q}”` : cl.note || '';
  return `${cl.kindLabel}: ${cl.label}. ${body} — Nguồn: ${srcHost(cl.src)} (bấm để mở)`;
}
const claimChip = (cl) => `<button class="tag claim claim-${cl.k}" data-act="open-hf" data-url="${esc(cl.src)}" title="${esc(claimTitle(cl))}"><b>${CLAIM_MARK[cl.k]}</b> ${esc(cl.label)}</button>`;
function claimsRow(c) {
  const list = (c.claims || []).filter(cl => !(cl.t === 'vision' && c.vision)).sort((a, b) => 'vdx'.indexOf(a.k) - 'vdx'.indexOf(b.k));
  return list.length ? `<div class="tags claims" aria-label="Khả năng (có nguồn)">${list.map(claimChip).join('')}</div>` : '';
}
function visTag(c) {
  const cl = (c.claims || []).find(x => x.t === 'vision');
  const base = `Tải kèm tệp thị giác ${c.mmproj.file} (${fmtBytes(c.mmproj.size)}); mô hình xem trực tiếp ảnh bạn dán.`;
  return cl ? `<button class="tag vis claim-${cl.k}" data-act="open-hf" data-url="${esc(cl.src)}" title="${esc(base + ' ' + claimTitle(cl))}">👁 ${CLAIM_MARK[cl.k]} Nhìn được ảnh</button>`
    : `<span class="tag vis" title="${esc(base)}">👁 Nhìn được ảnh</span>`;
}
// agent = thẻ trong mục Điều khiển máy tính: nhãn mức chạy tính ở ngữ cảnh AIVN AGENT (agentFit) — khớp nhóm chứa thẻ và cổng AIVN AGENT (B17)
const catCard = (c, agent = false) => `<div class="card" data-id="${esc(c.id)}">
    <div class="card-top"><div class="av">${esc(c.family.slice(0, 2))}</div><div><h4>${esc(c.name)}</h4><div class="sub">${esc(c.params)} tham số · ${esc(c.quant)} · ${fmtBytes(c.size + (c.mmproj ? c.mmproj.size : 0))}</div></div></div>
    <p>${esc(c.desc)}</p>
    <div class="tags">${c.recommended ? '<span class="tag rec" title="Qwen3 gọi công cụ tốt nhất trong các mô hình vừa máy này">⭐ Gợi ý: trò chuyện &amp; công cụ</span>' : ''}${c.recScreen && agent && c.agentCheck && c.agentCheck.ok ? '<span class="tag rec" title="Một mô hình vừa lập kế hoạch vừa nhìn màn hình, chọn theo VRAM máy này. Nhà phát triển (Qwen) ghi: Visual Agent — Operates PC/mobile GUIs.">⭐ Gợi ý: điều khiển máy (tự nhìn màn hình)</span>' : ''}${c.recGround ? `<span class="tag rec" title="${esc('Mắt nhìn cho mô hình lập kế hoạch Qwen3, chọn theo VRAM máy này.' + (/phi thương mại/i.test(c.license || '') ? ' Lưu ý giấy phép: ' + c.license + '.' : ''))}">⭐ Gợi ý: mắt nhìn (cặp hai mô hình)</span>` : ''}${c.recPairPlanner ? '<span class="tag rec" title="Lập kế hoạch trong cặp hai mô hình — dùng kèm mắt nhìn được gợi ý.">⭐ Gợi ý: lập kế hoạch (cặp)</span>' : ''}${roleTag(c)}${benchTag(c)}${fitBadge(agent === true ? (c.agentFit || c.fit) : c.fit)}${agent === true && c.agentCheck && !c.agentCheck.ok ? `<span class="tag warn" title="${esc(c.agentCheck.reason)}">⛔ ${esc(c.agentCheck.reason.split(' (')[0])}</span>` : agent === true && c.agentCheck && c.agentCheck.slow ? `<span class="tag warn" title="${esc(c.agentCheck.reason)}">⚠ Chạy chậm cho AIVN AGENT</span>` : ''}${c.vision ? visTag(c) : ''}${c.tools ? `<span class="tag tools-${c.tools.level}" title="${esc(c.tools.hint)}">🛠 Hỗ trợ công cụ: ${esc(c.tools.label)}</span>` : ''}<span class="tag">${esc(c.ram)}</span><span class="tag lic" title="Giấy phép">${esc(c.license)}</span>${c.visionNote ? `<span class="tag" title="${esc(c.visionNote)}">Chỉ văn bản</span>` : ''}</div>
    ${claimsRow(c)}
    <div class="card-foot" data-job="${esc(jobIdFor(c.repo, c.file))}">${footHtml({ ...c, size: c.size + (c.mmproj ? c.mmproj.size : 0) }, `data-act="dl-cat" data-id="${esc(c.id)}"`, c.file)}</div>
    <button class="linkish" data-act="open-repo" data-repo="${esc(c.repo)}">Các bản lượng tử khác · ${esc(c.repo)}</button></div>`;


function renderDlPanel() {
  const list = [...jobs.values()].filter(j => j.status !== 'done');
  $('#dlPanel').hidden = !list.length;
  $('#dlList').innerHTML = list.map(j => `<div class="dl-item"><div class="dl-name"><b>${esc(j.name)}</b><span class="muted small">${esc(j.repo)}</span></div><div data-job="${esc(j.id)}">${progressHtml(j)}</div></div>`).join('');
}
function paintJob(j) {
  const prev = jobs.get(j.id); jobs.set(j.id, j);
  for (const el of $$(`[data-job="${CSS.escape(j.id)}"]`)) el.innerHTML = j.status === 'done' ? '<span class="ok">✓ Tải xong</span>' : progressHtml(j);
  if (!prev || prev.status !== j.status) renderDlPanel();
}
A.onDl(paintJob);
A.onDlDone(async (j) => { toast(`Tải xong ${j.name} ✓`); jobs.set(j.id, j); renderDlPanel(); await refreshModels(); if (!$('#sugArea').hidden) renderCatalog(); if (disc.repo) openRepo(disc.repo.id, true); });
A.onDlRemoved(({ id }) => { jobs.delete(id); renderDlPanel(); renderCatalog(); if (disc.repo) openRepo(disc.repo.id, true); });

// --- Tìm kiếm Hugging Face ---
async function doSearch() {
  const q = $('#searchQ').value.trim(), sort = $('#searchSort').value;
  disc.lastQuery = { q, sort };
  $('#hfArea').hidden = false; $('#repoArea').hidden = true; $('#sugArea').hidden = true;
  $('#hfTitle').textContent = q ? `Kết quả cho “${q}”` : 'Mô hình GGUF phổ biến trên Hugging Face';
  $('#hfResults').innerHTML = '<div class="muted pad">Đang tìm trên Hugging Face…</div>';
  try {
    const res = await A.hfSearch({ q, sort });
    if (disc.lastQuery.q !== q || disc.lastQuery.sort !== sort) return;
    disc.results = res;
    $('#hfResults').innerHTML = res.length ? res.map(r => `<div class="hf-item" data-repo="${esc(r.id)}">
      <div class="hf-main"><div><b>${esc(r.name)}</b> <span class="muted">· ${esc(r.author)}</span></div>
        <div class="meta">⬇ ${fmtNum(r.downloads)} lượt tải · ♥ ${fmtNum(r.likes)} · cập nhật ${fmtAgo(r.lastModified)}${r.params ? ' · ' + fmtParams(r.params) : ''}</div>
        <div class="tags">${r.license ? `<span class="tag lic">${esc(r.license)}</span>` : ''}${r.arch ? `<span class="tag${r.archSupported === false ? ' warn' : ''}" title="${r.archSupported === false ? 'Kiến trúc này có thể chưa được hỗ trợ trong AIVN' : 'Kiến trúc mô hình'}">${esc(r.arch)}${r.archSupported === false ? ' · chưa hỗ trợ?' : ''}</span>` : ''}${r.gated ? '<span class="tag warn">🔒 Cần chấp nhận giấy phép</span>' : ''}${r.vision ? '<span class="tag">Có thị giác · AIVN chưa hỗ trợ ảnh</span>' : ''}${r.embedding ? '<span class="tag warn">Embedding · không dùng để trò chuyện</span>' : ''}</div></div>
      <button class="btn sm" data-act="open-repo" data-repo="${esc(r.id)}">Xem tệp →</button></div>`).join('') : '<div class="muted pad">Không tìm thấy mô hình GGUF nào. Thử từ khoá khác (vd. tên họ mô hình như “qwen”, “llama”, “gemma”).</div>';
  } catch (err) { $('#hfResults').innerHTML = `<div class="err pad">${esc(cleanErr(err.message))}</div>`; }
}
let searchTimer;
$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(searchTimer); doSearch(); });
$('#searchQ').addEventListener('input', () => { clearTimeout(searchTimer); if ($('#searchQ').value.trim().length >= 2) searchTimer = setTimeout(doSearch, 450); });
$('#searchSort').addEventListener('change', () => { if (!$('#hfArea').hidden || $('#searchQ').value.trim()) doSearch(); });
$('#hfClose').addEventListener('click', () => { $('#hfArea').hidden = true; $('#repoArea').hidden = true; $('#sugArea').hidden = false; disc.repo = null; $('#searchQ').value = ''; renderCatalog(); });

async function openRepo(repo, quiet) {
  const area = $('#repoArea');
  if (!quiet) { area.hidden = false; $('#hfArea').hidden = true; $('#sugArea').hidden = true; area.innerHTML = `<div class="muted pad">Đang đọc danh sách tệp của ${esc(repo)}…</div>`; }
  let r;
  try { r = await A.hfRepo(repo); } catch (err) { area.innerHTML = `<button class="btn sm" data-act="back">← Quay lại</button><div class="err pad">${esc(cleanErr(err.message))}</div>`; return; }
  disc.repo = r;
  const chat = r.groups.filter(g => g.kind === 'chat' && g.complete);
  const other = r.groups.filter(g => g.kind !== 'chat' || !g.complete);
  const notes = [
    r.gated ? '🔒 Repo này yêu cầu chấp nhận giấy phép trên Hugging Face. Hãy mở trang repo, đồng ý điều khoản, rồi nhập HF token (nút 🔑 phía trên) trước khi tải.' : '',
    r.mmproj ? `👁 <b>Nhìn được ảnh.</b> Repo có tệp thị giác <b>${esc(r.mmproj.name)}</b> (${fmtBytes(r.mmproj.size)}). ${r.mmprojInstalled ? 'Tệp này đã có trên máy.' : 'AIVN sẽ tải kèm tệp này cùng mô hình để mô hình xem trực tiếp ảnh bạn dán vào.'}` :
      r.vision ? '🖼 Mô hình gốc xem được ảnh, nhưng repo này không có tệp thị giác (mmproj): AIVN chỉ dùng phần trò chuyện bằng văn bản. Hãy tìm bản GGUF có kèm mmproj (vd. của ggml-org).' : '',
    r.embedding ? '⚠ Đây là mô hình embedding (tạo vector), không dùng để trò chuyện.' : '',
    r.archSupported === false ? `⚠ Kiến trúc “${esc(r.arch)}” có thể chưa được hỗ trợ bởi llama.cpp trong AIVN; mô hình có thể không nạp được.` : '',
  ].filter(Boolean);
  area.innerHTML = `<div class="repo-head"><button class="btn sm" data-act="back">← Quay lại</button>
      <div class="grow"><h3>${esc(r.name)} <span class="muted">· ${esc(r.author)}</span></h3>
      <div class="meta muted">⬇ ${fmtNum(r.downloads)} lượt tải · ♥ ${fmtNum(r.likes)} · cập nhật ${fmtAgo(r.lastModified)}${r.license ? ' · giấy phép ' + esc(r.license) : ''}${r.arch ? ' · kiến trúc ' + esc(r.arch) : ''}${r.params ? ' · ' + fmtParams(r.params) : ''}${r.contextLength ? ' · ngữ cảnh tối đa ' + fmtNum(r.contextLength) : ''}</div></div>
      <button class="btn sm" data-act="open-hf" data-url="${esc(r.url)}">Mở trên Hugging Face ↗</button></div>
    ${notes.map(n => `<div class="note">${n}</div>`).join('')}
    <div class="qtable">${chat.length ? `<div class="qr head"><span>Tệp mô hình</span><span>Lượng tử</span><span>Dung lượng</span><span>Máy bạn</span><span></span></div>` + chat.map(g => `<div class="qr${g.recommended ? ' rec' : ''}">
        <span class="fname" title="${esc(g.files.map(f => f.path).join('\n'))}">${esc(g.name)}${g.split ? ` <span class="tag">${g.parts} phần · tải tất cả</span>` : ''}${g.recommended ? ' <span class="tag ok">★ Khuyên dùng</span>' : ''}${g.vision ? ' <span class="tag vis">👁 Nhìn được ảnh</span>' : ''}${g.folder ? `<div class="muted small">${esc(g.folder)}/</div>` : ''}</span>
        <span><b>${esc(g.quant || '—')}</b></span><span>${fmtBytes(g.size)}</span><span>${fitBadge(g.fit)}</span>
        <span class="foot" data-job="${esc(jobIdFor(r.id, g.files[0].path))}">${footHtml(g, `data-act="dl-group" data-key="${esc(g.key)}"`, g.files[0].path)}${g.installed && r.mmproj && !r.mmprojInstalled ? `<button class="btn sm" data-act="dl-mmproj" title="Tải tệp thị giác để mô hình này xem được ảnh">⬇ Phần nhìn ảnh · ${fmtBytes(r.mmproj.size)}</button>` : ''}</span></div>`).join('') : '<div class="muted pad">Repo này không có tệp GGUF dùng để trò chuyện.</div>'}</div>
    ${other.length ? `<details class="others"><summary>Tệp không dùng để trò chuyện (${other.length})</summary>${other.map(g => `<div class="qr other"><span class="fname">${esc(g.name)}</span><span>${esc(g.quant || '')}</span><span>${fmtBytes(g.size)}</span><span class="muted small">${!g.complete ? 'Thiếu phần, không tải được' : g.kind === 'mmproj' ? (r.mmproj && g.files[0].path === r.mmproj.path ? 'Tệp thị giác (mmproj) · AIVN tải kèm bản này' : 'Tệp thị giác (mmproj) · bản thay thế') : 'Mô hình embedding'}</span></div>`).join('')}</details>` : ''}`;
}

$('#view-discover').addEventListener('click', async (e) => {
  const fam = e.target.closest('[data-fam]'); if (fam) { disc.fam = fam.dataset.fam; renderCatalog(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  try {
    if (act === 'dl-cat') { const j = await A.dlStart({ catalogId: b.dataset.id }); paintJob(j); renderCatalog(); }
    if (act === 'dl-group') {
      const r = disc.repo, g = r.groups.find(x => x.key === b.dataset.key);
      const files = g.files.map(f => ({ path: f.path, size: f.size }));
      if (r.mmproj && !r.mmprojInstalled) files.push({ path: r.mmproj.path, size: r.mmproj.size }); // tải kèm tệp thị giác
      const j = await A.dlStart({ repo: r.id, files, name: g.name, quant: g.quant }); paintJob(j);
    }
    if (act === 'dl-mmproj') { const r = disc.repo; const j = await A.dlStart({ repo: r.id, files: [{ path: r.mmproj.path, size: r.mmproj.size }], name: `${r.name} · phần nhìn ảnh`, quant: r.mmproj.quant }); toast('Đang tải phần nhìn ảnh, xem tiến độ ở mục Đang tải'); renderDlPanel(); }
    if (act === 'pause') await A.dlPause(b.dataset.jid);
    if (act === 'resume') await A.dlResume(b.dataset.jid);
    if (act === 'remove') await A.dlRemove(b.dataset.jid);
    if (act === 'open-repo') openRepo(b.dataset.repo);
    if (act === 'open-hf') A.openExternal(b.dataset.url);
    if (act === 'back') { disc.repo = null; $('#repoArea').hidden = true; if (disc.results) $('#hfArea').hidden = false; else { $('#sugArea').hidden = false; renderCatalog(); } }
    if (act === 'use') { await refreshModels(); const name = b.dataset.file.split('/').pop().toLowerCase(); const m = state.models.find(x => x.file.toLowerCase() === name); show('chat'); if (m) loadModel(m.id); }
  } catch (err) { toast(cleanErr(err.message), true); }
});

// --- Token Hugging Face ---
function paintToken() { $('#tokenState').textContent = state.settings.hfTokenSet ? '✓ Đã lưu token trên máy này' : 'Chưa có token'; $('#tokenBtn').classList.toggle('on', !!state.settings.hfTokenSet); }
$('#tokenBtn').addEventListener('click', () => { $('#tokenBox').hidden = !$('#tokenBox').hidden; paintToken(); });
$('#tokenSave').addEventListener('click', async () => { const v = $('#hfToken').value.trim(); if (!v) return toast('Hãy dán token trước khi lưu', true); state.settings = await A.setSettings({ hfToken: v }); $('#hfToken').value = ''; paintToken(); toast('Đã lưu token (chỉ trên máy này) ✓'); });
$('#tokenClear').addEventListener('click', async () => { state.settings = await A.setSettings({ hfToken: '' }); $('#hfToken').value = ''; paintToken(); toast('Đã xoá token'); });

// ---------- Trò chuyện ----------
async function loadConvos() { state.convos = await A.convos(); renderConvos(); }
function renderConvos() {
  $('#convoList').innerHTML = state.convos.filter(c => convoMode(c) === state.mode).map(c => `<div class="convo ${state.current && c.id === state.current.id ? 'active' : ''}" data-id="${c.id}"><span>${esc(c.title)}</span><button class="del" title="Xoá">✕</button></div>`).join('') || `<div class="muted" style="padding:8px;font-size:12.5px">${isAgent() ? 'Chưa giao việc nào cho AIVN AGENT' : 'Chưa có cuộc trò chuyện nào'}</div>`;
}
$('#convoList').addEventListener('click', async (e) => {
  const row = e.target.closest('.convo'); if (!row) return;
  if (e.target.classList.contains('del')) { await A.deleteConvo(row.dataset.id); if (state.current && state.current.id === row.dataset.id) state.current = null; await loadConvos(); renderMessages(); return; }
  state.current = state.convos.find(c => c.id === row.dataset.id); renderConvos(); renderMessages();
});
$('#messages').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]'); if (!b || !state.current) return;
  await A.copyText(state.current.messages[Number(b.dataset.copy)].content); toast('Đã sao chép ✓');
});
A.onEngineCrash((e) => toast(e.message, true));
$('#newChat').addEventListener('click', () => { state.current = null; renderConvos(); renderMessages(); $('#input').focus(); });

// biểu tượng nút thao tác tin nhắn (SVG đơn sắc: ký tự ⧉ ⑂ thiếu trong phông Windows/Linux nên hiện ô trống)
const svgI = (d) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const MICON = {
  copy: svgI('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  edit: svgI('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>'),
  regen: svgI('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  branch: svgI('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-11 7"/>'),
  del: svgI('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  prev: svgI('<path d="M15 6l-6 6 6 6"/>'), next: svgI('<path d="M9 6l6 6-6 6"/>'),
};
function renderMessages() {
  const box = $('#messages');
  const msgs = state.current ? state.current.messages : [];
  if (!msgs.length && isAgent()) {
    const welcome = (state.agent && state.agent.welcome) || 'Xin chào! Mình là **AIVN AGENT**.';
    box.innerHTML = `<div class="msg assistant agent welcome" id="botWelcome"><div class="who"><img src="logo-tile.svg" alt="" width="16" height="16"> AIVN AGENT</div><div class="body">${md(welcome)}</div></div>
      <div class="empty compact"><p class="muted small">Thử giao việc:</p><div class="examples">${AGENT_EXAMPLES.map(x => `<button type="button" data-example="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`;
    return;
  }
  if (!msgs.length) {
    paintCtxBar(null);
    box.innerHTML = `<div class="empty"><img class="logo-big" src="logo-tile.svg" alt="">
      <h2>Xin chào! Hôm nay bạn muốn hỏi gì?</h2><p>${state.status.loaded ? 'Mô hình đã sẵn sàng. Mọi thứ chạy ngay trên máy bạn, không cần Internet.' : 'Hãy chọn một mô hình ở thanh phía trên (Ctrl+L), hoặc vào <b>Khám phá</b> để tải mô hình đầu tiên.'}</p></div>`;
    return;
  }
  box.innerHTML = msgs.map((m, i) => {
    const atts = m.attachments && m.attachments.length ? `<div class="atts">${m.attachments.map(a => `<span class="att">${a.kind === 'image' && a.thumb && /^data:image\/jpeg;base64,/.test(a.thumb) ? `<img class="thumb" src="${a.thumb}" alt="">` : fileIcon(a.kind)} ${esc(a.name)} · ${fmtBytes(a.size)}</span>`).join('')}</div>` : '';
    const warn = (m.visionNote ? `<div class="doc-warn vis">👁 ${esc(m.visionNote)}.</div>` : '') + (m.ocrNote ? `<div class="doc-warn ocr">🖼 ${esc(m.ocrNote)}.</div>` : '') + (m.docWarning ? `<div class="doc-warn">⚠ ${esc(m.docWarning)}</div>` : '');
    const isLast = i === msgs.length - 1; const chatMode = !isAgent() && !(m.steps || m.agent);
    const ab = (act, ic, t) => `<button type="button" class="mact" data-mact="${act}" title="${t}" aria-label="${t}">${MICON[act] || ic}</button>`;
    const nav = m.alts && m.alts.length > 1 ? `<span class="alt-nav">${ab('prev', '‹', 'Phiên bản trước')}<span>${(m.alt ?? m.alts.length - 1) + 1}/${m.alts.length}</span>${ab('next', '›', 'Phiên bản sau')}</span>` : '';
    const copyBtn = !m.content || state.generating && isLast ? '' : `<div class="msg-acts">${nav}${m.content && !m.error ? ab('copy', '⧉', 'Sao chép') : ''}${chatMode && m.role === 'user' ? ab('edit', '✎', 'Sửa tin nhắn') : ''}${chatMode && m.role === 'assistant' && msgs[i - 1] && msgs[i - 1].role === 'user' ? ab('regen', '↻', 'Tạo lại câu trả lời') : ''}${chatMode ? ab('branch', '⑂', 'Rẽ nhánh từ đây (tạo cuộc trò chuyện mới)') + ab('del', '🗑', 'Xoá tin nhắn') : ''}</div>`;
    const think = m.role === 'assistant' && m.thought ? `<details class="think"><summary>${m.thinkSecs ? 'Đã suy nghĩ ' + fmtSec(m.thinkSecs) : 'Quá trình suy nghĩ'}</summary><div class="think-body">${esc(m.thought)}</div></details>` : '';
    const stats = m.role === 'assistant' && !m.error ? statsHtml(m.stats) : '';
    const srcs = m.role === 'assistant' && Array.isArray(m.sources) && m.sources.length ? `<div class="sources">${m.sources.map(x => `<div class="src" title="${esc(x.preview || '')}">📎 Trích từ: <b>${esc(x.file)}</b>, đoạn ${x.chunk}${x.page ? ` · trang ${x.page}${x.pageEnd && x.pageEnd !== x.page ? '–' + x.pageEnd : ''}` : ''}</div>`).join('')}</div>` : '';
    const ag = m.role === 'assistant' && (m.steps || m.agent);
    const extra = m.role === 'assistant' ? webSrcHtml(m) + (m.memories && m.memories.length ? `<div class="mem-used" title="${esc(m.memories.join('\n'))}">🧠 Đã dùng ${m.memories.length} ghi nhớ liên quan</div>` : '') : '';
    const sched = m.scheduled ? `<div class="sched-tag">⏰ Lịch tự động · ${new Date(m.scheduled.at).toLocaleString('vi-VN')}${m.scheduled.late ? ' · chạy bù (trễ)' : ''}${m.scheduled.manual ? ' · chạy thủ công' : ''}</div>` : '';
    return `<div class="msg ${m.role}${m.error ? ' error' : ''}${ag ? ' agent' : ''}" data-i="${i}">${m.role === 'assistant' ? `<div class="who">${ag ? 'AIVN AGENT' : 'AIVN'}${m.model ? ' · ' + esc(modelLabel(m.model)) : ''}</div>` : ''}${atts}${ag ? `<div class="steps-wrap">${stepsHtml(m)}</div>` : ''}${think}<div class="body">${m.role === 'assistant' ? md(m.content) : esc(m.content).replace(/\n/g, '<br>')}</div>${m.error ? `<div class="err-actions">${/cần nhiều ngữ cảnh hơn|ngữ cảnh[^.]*quá nhỏ/i.test(m.content || '') ? '<button type="button" class="btn sm primary" data-ctx-grow="1">Tăng ngữ cảnh</button>' : ''}<button type="button" class="btn sm" data-logs="open">🧾 Mở nhật ký</button><button type="button" class="btn sm" data-logs="copy">Sao chép nhật ký</button></div>` : ''}${m.warning && m.warning !== 'blocked' ? warnBox(m.warning) : ''}${srcs}${extra}${sched}${stats}${copyBtn}</div>${warn}`;
  }).join('');
  box.scrollTop = box.scrollHeight;
  paintCtxBar(lastStats(state.current));
}

// ---------- Tệp đính kèm ----------
let pending = []; // [{id, name, size, kind, text, ok, loading}]
const MAX_FILES = 5;
function fileIcon(kind) { return kind === 'pdf' ? '📕' : kind === 'docx' ? '📘' : kind === 'image' ? '🖼' : '📄'; }
const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const OCR_NOTE = 'Mô hình hiện tại không nhìn được ảnh, AIVN đã đọc chữ trong ảnh';
const VISION_NOTE = 'Mô hình nhìn ảnh trực tiếp';
const visImgs = new WeakMap(); // tin nhắn → ảnh (data URL) đã gửi cho mô hình nhìn ảnh, chỉ giữ trong phiên làm việc
const MAX_BYTES = 20 * 1024 * 1024;
// Ảnh → (thu nhỏ để hiện chip) + PNG đã chuẩn hoá kích thước để OCR. GIF chỉ lấy khung hình đầu.
async function imageToPng(blob) {
  const bmp = await createImageBitmap(blob);
  const long = Math.max(bmp.width, bmp.height);
  let scale = long < 1600 ? Math.min(2, 1600 / long) : long > 4000 ? 4000 / long : 1; // phóng ảnh chụp màn hình nhỏ để đọc chữ tốt hơn
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
  const t = document.createElement('canvas'); const ts = 96 / Math.max(bmp.width, bmp.height); t.width = Math.max(1, Math.round(bmp.width * ts)); t.height = Math.max(1, Math.round(bmp.height * ts));
  t.getContext('2d').drawImage(bmp, 0, 0, t.width, t.height);
  const png = await new Promise(r => c.toBlob(r, 'image/png'));
  // bản cho mô hình nhìn ảnh: cạnh dài tối đa 1024 px (đủ chi tiết, ít token ảnh)
  const vs = Math.min(1, 1024 / long);
  const v = document.createElement('canvas'); v.width = Math.max(1, Math.round(bmp.width * vs)); v.height = Math.max(1, Math.round(bmp.height * vs));
  const vg = v.getContext('2d'); vg.fillStyle = '#fff'; vg.fillRect(0, 0, v.width, v.height); vg.imageSmoothingQuality = 'high'; vg.drawImage(bmp, 0, 0, v.width, v.height);
  return { png: new Uint8Array(await png.arrayBuffer()), thumb: t.toDataURL('image/jpeg', 0.75), vis: v.toDataURL('image/jpeg', 0.92), width: bmp.width, height: bmp.height };
}
async function addImageBlobs(list) { // list: [{blob, name, size}]
  const room = MAX_FILES - pending.length;
  if (room <= 0) { toast(`Chỉ gửi kèm tối đa ${MAX_FILES} tệp mỗi lần`, true); return; }
  if (list.length > room) toast(`Chỉ gửi kèm tối đa ${MAX_FILES} tệp mỗi lần, đã bỏ bớt ${list.length - room} tệp`, true);
  for (const { blob, name, size } of list.slice(0, room)) {
    if (size > MAX_BYTES) { toast(`"${name}" quá lớn (${fmtBytes(size)}). Giới hạn là 20 MB mỗi tệp.`, true); continue; }
    const it = { id: uid(), name, size, kind: 'image', loading: true };
    pending.push(it); renderChips();
    (async () => {
      try {
        const img = await imageToPng(blob);
        it.thumb = img.thumb; it.vis = img.vis; it.png = img.png; renderChips();
        if (state.status.vision) { Object.assign(it, { loading: false, ok: true, text: '', direct: true }); renderChips(); return; }
        const r = await A.ocrImage(img.png);
        if (!pending.includes(it)) return;
        if (!r || r.chars < 3) { pending = pending.filter(a => a !== it); renderChips(); toast(`Không tìm thấy chữ trong ảnh "${name}". Mô hình hiện tại không nhìn được ảnh nên AIVN chưa dùng được ảnh này.`, true); return; }
        Object.assign(it, { loading: false, ok: true, text: r.text, ocrChars: r.chars, ocrConf: r.confidence });
      } catch (err) {
        pending = pending.filter(a => a !== it); toast(`Không đọc được ảnh "${name}": ${cleanErr(err.message)}`, true);
      }
      renderChips();
    })();
  }
}
function renderChips() {
  const el = $('#chips');
  el.hidden = !pending.length;
  el.innerHTML = pending.map(a => `<div class="chip${a.loading ? ' loading' : ''}${a.kind === 'image' ? ' img' : ''}" data-id="${a.id}" title="${esc(a.name)}${a.pages ? ' · ' + a.pages + ' trang' : ''}${a.kind === 'image' ? (a.loading ? ' · đang xử lý ảnh…' : a.direct ? ' · mô hình sẽ nhìn ảnh trực tiếp' : ` · OCR ${a.ocrChars} ký tự, tin cậy ${a.ocrConf}%`) : ''}">${a.kind === 'image' && a.thumb ? `<img class="thumb" src="${a.thumb}" alt="">` : `<span class="ic">${fileIcon(a.kind)}</span>`}<span class="nm">${esc(a.name)}</span><span class="sz">${a.size ? fmtBytes(a.size) : ''}${a.pages ? ' · ' + a.pages + ' trang' : ''}${a.kind === 'image' ? (a.loading ? (state.status.vision ? ' · đang chuẩn bị…' : ' · đang đọc chữ…') : a.direct ? ' · gửi ảnh trực tiếp' : ` · ${a.ocrChars} ký tự`) : ''}</span><button type="button" title="Bỏ tệp này" aria-label="Bỏ tệp">✕</button></div>`).join('');
}
$('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c && e.target.closest('button')) { pending = pending.filter(a => a.id !== c.dataset.id); renderChips(); } });
async function addFiles(paths) {
  paths = paths.filter(Boolean);
  const imgs = paths.filter(p => IMG_EXT.test(p)); paths = paths.filter(p => !IMG_EXT.test(p));
  if (imgs.length) {
    const list = [];
    for (const p of imgs) { try { const r = await A.readImage(p); list.push({ blob: new Blob([r.bytes]), name: r.name, size: r.size }); } catch (err) { toast(cleanErr(err.message), true); } }
    await addImageBlobs(list);
  }
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
  const files = [...e.dataTransfer.files];
  const imgs = files.filter(f => /^image\//.test(f.type) || IMG_EXT.test(f.name));
  if (imgs.length) addImageBlobs(imgs.map(f => ({ blob: f, name: f.name, size: f.size })));
  addFiles(files.filter(f => !imgs.includes(f)).map(f => A.pathForFile(f)));
});
// Dán ảnh (Ctrl+V / Cmd+V): ảnh chụp màn hình, ảnh sao chép từ trình duyệt hoặc trình xem ảnh
function imagesFromClipboard(e) {
  const dt = e.clipboardData; if (!dt) return [];
  const hasText = [...dt.types].includes('text/plain') && dt.getData('text/plain').trim();
  if (hasText) return []; // có chữ thì dán chữ bình thường (vd. sao chép từ Word/Excel)
  const out = [];
  for (const item of dt.items) if (item.kind === 'file' && /^image\//.test(item.type)) { const f = item.getAsFile(); if (f) out.push(f); }
  return out;
}
function onPasteImages(e) {
  const imgs = imagesFromClipboard(e); if (!imgs.length) return;
  e.preventDefault();
  if (!$('#view-chat').classList.contains('active')) show('chat');
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  addImageBlobs(imgs.map((f, i) => ({ blob: f, name: f.name && f.name !== 'image.png' ? f.name : `anh-dan-${stamp}${imgs.length > 1 ? '-' + (i + 1) : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, size: f.size })));
  $('#input').focus();
}
$('#input').addEventListener('paste', onPasteImages);
document.addEventListener('paste', (e) => { if (e.target === $('#input')) return; if (e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return; if ($('#view-chat').classList.contains('active')) onPasteImages(e); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault()); // không cho cửa sổ mở tệp bị thả nhầm chỗ

const input = $('#input');
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; });
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  let text = input.value.trim(); $('#slashPop').hidden = true;
  // lệnh / chạy ngay cả khi đang tạo câu trả lời (chỉ đổi cài đặt cục bộ), trừ /moi
  if (!isAgent() && text.startsWith('/') && runSlash(text)) return;
  if (state.generating) return;
  if (isAgent()) { if (pending.some(a => a.loading)) { toast('Đang đọc tệp, vui lòng đợi một chút…'); return; } if (text || pending.some(a => a.ok)) sendAgent(text); return; }
  if (pending.some(a => a.loading)) { toast('Đang đọc tệp, vui lòng đợi một chút…'); return; }
  const vision = !!state.status.vision;
  // ảnh thêm lúc đang dùng mô hình nhìn ảnh nhưng giờ mô hình không nhìn được: đọc chữ (OCR) ngay lúc gửi
  if (!vision) for (const a of pending.filter(x => x.ok && x.direct)) {
    $('#genStats').textContent = 'Đang đọc chữ trong ảnh…';
    try { const r = await A.ocrImage(a.png); if (r && r.chars >= 3) Object.assign(a, { direct: false, text: r.text, ocrChars: r.chars, ocrConf: r.confidence }); else a.ok = false; } catch { a.ok = false; }
    $('#genStats').textContent = '';
    if (!a.ok) toast(`Không đọc được chữ trong ảnh "${a.name}", ảnh này sẽ không được gửi.`, true);
  }
  const docsToSend = pending.filter(a => a.ok);
  const directImgs = vision ? docsToSend.filter(a => a.kind === 'image' && a.vis) : [];
  if (!text && docsToSend.length) text = docsToSend.every(a => a.kind === 'image') ? (directImgs.length ? 'Hãy mô tả chi tiết bức ảnh này.' : 'Hãy cho biết nội dung chữ trong ảnh và tóm tắt ý chính.') : 'Hãy tóm tắt nội dung chính của tài liệu đính kèm.';
  if (!text) return;
  if (!state.status.loaded && !(await ensureLoaded())) return;
  if (!state.current) state.current = { id: uid(), title: text.slice(0, 48), messages: [], createdAt: Date.now(), updatedAt: Date.now(), mode: 'chat' };
  const conv = state.current;
  const userMsg = { role: 'user', content: text, at: Date.now() };
  if (docsToSend.length) userMsg.attachments = docsToSend.map(a => ({ name: a.name, size: a.size, kind: a.kind, pages: a.pages || null, ...(a.kind === 'image' ? { thumb: a.thumb, ocrChars: a.ocrChars, direct: !!(vision && a.vis) } : {}) }));
  if (directImgs.length) { userMsg.visionNote = VISION_NOTE; visImgs.set(userMsg, directImgs.map(a => a.vis)); }
  if (docsToSend.some(a => a.kind === 'image' && !(vision && a.vis))) userMsg.ocrNote = OCR_NOTE;
  conv.messages.push(userMsg);
  pending = []; renderChips();
  const reply = { role: 'assistant', content: '', model: state.status.id };
  conv.messages.push(reply);
  input.value = ''; input.style.height = 'auto';
  await runTurn(conv, userMsg, reply, { docsToSend, directImgs });
});
// Một lượt trả lời (dùng cho gửi mới, tạo lại, sửa rồi gửi lại). userMsg và reply đã nằm trong conv.messages.
async function runTurn(conv, userMsg, reply, { docsToSend = [], directImgs = [] } = {}) {
  const vision = !!state.status.vision;
  renderMessages();
  const ri = conv.messages.indexOf(reply);
  const msgEl = () => document.querySelector(`#messages .msg[data-i="${ri}"]`);
  const bodyEl = msgEl().querySelector('.body'); bodyEl.classList.add('cursor');
  const reqId = uid(); state.generating = reqId; genStartedAt = Date.now(); setPhase('think');
  $('#sendBtn').hidden = true; $('#stopBtn').hidden = false; $('#genStats').textContent = 'Đang suy nghĩ…';
  const s = state.settings; const cp = chatParams();
  // Lịch sử gửi cho mô hình: chỉ tin nhắn có tài liệu gần nhất giữ toàn bộ nội dung đã đóng gói, tin cũ hơn chỉ ghi tên tệp
  const ui = conv.messages.indexOf(userMsg);
  const all = conv.messages.slice(0, ui);
  const prior = all.filter((m, i) => !m.error && !(m.role === 'user' && all[i + 1] && all[i + 1].error));
  const lastCtxIdx = docsToSend.length ? -1 : prior.map(m => !!m.context).lastIndexOf(true);
  const ownImgs = directImgs.length ? directImgs.map(a => a.vis) : (vision && visImgs.get(userMsg)) || [];
  // mô hình nhìn ảnh: hỏi tiếp mà không gửi ảnh mới thì gửi lại ảnh gần nhất trong phiên
  const lastImgIdx = vision && !ownImgs.length ? prior.map(m => visImgs.has(m)).lastIndexOf(true) : -1;
  const lastText = docsToSend.length ? userMsg.content : (userMsg.context || userMsg.content);
  const history = [{ role: 'system', content: cp.systemPrompt }, ...prior.map((m, i) => {
      const t = m.context && i === lastCtxIdx ? m.context : (m.attachments ? `[Đã gửi kèm: ${m.attachments.map(a => a.name + (a.kind === 'image' ? (a.direct ? ' (ảnh)' : ' (ảnh, đã đọc chữ bằng OCR)') : '')).join(', ')}]\n` : '') + m.content;
      return { role: m.role, content: i === lastImgIdx ? [{ type: 'text', text: t }, ...visImgs.get(m).map(url => ({ type: 'image_url', image_url: { url } }))] : t };
    }),
    { role: 'user', content: lastText }];
  const offRag = A.onRagProgress((p) => {
    if (p.reqId !== reqId) return;
    $('#genStats').textContent = p.stage === 'search' ? 'Đang tìm đoạn liên quan trong tài liệu…' : p.total ? `Đang lập chỉ mục “${p.name}”: ${p.done}/${p.total} đoạn…` : 'Đang chuẩn bị tìm kiếm tài liệu…';
  });
  const offInfo = A.onDocInfo((info) => {
    if (info.reqId !== reqId) return;
    if (info.mode === 'rag') { reply.sources = info.sources; $('#genStats').textContent = 'Đang suy nghĩ…'; return; }
    userMsg.context = info.context;
    if (info.ragAvailable) offerRag();
    if (info.truncated) {
      const parts = info.files.filter(f => f.truncated).map(f => `${f.name} (~${f.usedPct}%)`).join(', ');
      userMsg.docWarning = `Tài liệu dài hơn giới hạn ngữ cảnh của mô hình, AIVN chỉ dùng một phần: ${parts}. Đã giữ phần mở đầu và các đoạn liên quan nhất tới câu hỏi. Tăng "Độ dài ngữ cảnh" trong hộp nạp mô hình (Ctrl+L) để dùng nhiều hơn.`;
      const box = $('#messages'); const w = document.createElement('div'); w.className = 'doc-warn'; w.textContent = '⚠ ' + userMsg.docWarning;
      box.insertBefore(w, msgEl());
    }
  });
  let rafPending = false; const t0 = Date.now(); let thinkStart = null, thinkEnd = null;
  const paint = () => { rafPending = false; const el = msgEl(); if (!el) return;
    if (reply.thought) { let d = el.querySelector('.think'); if (!d) { d = document.createElement('details'); d.className = 'think'; d.open = true; d.innerHTML = '<summary></summary><div class="think-body"></div>'; el.insertBefore(d, el.querySelector('.body')); }
      d.querySelector('summary').textContent = thinkEnd ? `Đã suy nghĩ ${fmtSec((thinkEnd - thinkStart) / 1000)}` : 'Đang suy nghĩ…'; d.querySelector('.think-body').textContent = reply.thought; }
    bodyEl.innerHTML = md(reply.content); const box = $('#messages'); if (box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight; };
  const queue = () => { if (!rafPending) { rafPending = true; requestAnimationFrame(paint); } };
  const off = A.onToken(({ reqId: r, t }) => { if (r !== reqId) return; if (thinkStart && !thinkEnd) thinkEnd = Date.now(); reply.content += t; if ($('#genStats').textContent === 'Đang suy nghĩ…') $('#genStats').textContent = 'Đang trả lời…'; queue(); });
  const offThink = A.onThink(({ reqId: r, t }) => { if (r !== reqId) return; if (!thinkStart) thinkStart = Date.now(); reply.thought = (reply.thought || '') + t; queue(); });
  const offRec = A.onChatRecover((x) => { if (x.reqId !== reqId) return; reply.content = ''; reply.thought = ''; bodyEl.innerHTML = ''; $('#genStats').textContent = x.grow ? `Ngữ cảnh chưa đủ — đang nạp lại mô hình với ngữ cảnh ${Number(x.ctx).toLocaleString('vi-VN')}…` : `Bộ máy AI vừa dừng — đang tự nạp lại mô hình (ngữ cảnh ${x.ctx}) và thử lại…`; });
  try {
    const r = await A.generate({ reqId, convoId: conv.id, messages: history, temperature: cp.temperature, maxTokens: cp.maxTokens, params: cp,
      docs: docsToSend.filter(a => !(vision && a.kind === 'image' && a.vis)).map(a => ({ name: a.name, text: a.text, kind: a.kind, pages: a.pages })),
      images: ownImgs });
    reply.content = r.text || reply.content; if (r.thought) reply.thought = r.thought;
    if (reply.thought) reply.thinkSecs = ((thinkEnd || Date.now()) - (thinkStart || t0)) / 1000;
    if (r.finishReason === 'abort' && r.stoppedBy && r.stoppedBy !== 'người dùng bấm Dừng') reply.content += `\n\n_Đã dừng (${r.stoppedBy})._`;
    reply.stats = { tokens: r.usage.completion_tokens, tps: r.usage.tokensPerSecond, secs: r.usage.seconds, ttft: r.usage.ttft ?? null, stop: r.finishReason === 'abort' ? 'abort' : (r.stopReason || r.finishReason), ctxUsed: r.usage.contextTokens ?? null, ctxSize: r.usage.contextSize ?? null, dropped: r.dropped || 0, preset: cp.presetName || null };
    reply.model = state.status.id || reply.model; delete reply.error;
    if (reply.alts) { reply.alts.push(snapAlt(reply)); reply.alt = reply.alts.length - 1; }
    paintSbSpeed(r.usage); paintCtxBar(reply.stats);
    $('#genStats').textContent = '';
    if (r.dropped) toast(`Cuộc trò chuyện dài hơn ngữ cảnh: AIVN đã tạm bỏ ${r.dropped} tin cũ khi gửi (chính sách “${OVERFLOW_LABEL[cp.overflow] || cp.overflow}”).`);
  } catch (err) {
    reply.error = true; reply.content = (reply.content ? reply.content + '\n\n' : '') + '⚠ ' + cleanErr(err.message);
    if (reply.alts) { reply.alts.push(snapAlt(reply)); reply.alt = reply.alts.length - 1; }
    $('#genStats').textContent = '';
  } finally {
    off(); offThink(); offInfo(); offRag(); offRec(); state.generating = null; $('#sendBtn').hidden = false; $('#stopBtn').hidden = true;
    conv.updatedAt = Date.now(); await A.saveConvo(conv); await loadConvos(); renderMessages();
  }
}
const fmtSec = (x) => (x < 10 ? x.toFixed(1) : Math.round(x)).toString().replace('.', ',') + ' giây';
const STOP_LABEL = { eogToken: 'hết câu (EOS)', stop: 'hết câu', eos: 'hết câu (EOS)', maxTokens: 'chạm giới hạn token', length: 'chạm giới hạn token', customStopTrigger: 'gặp chuỗi dừng', stopGenerationTrigger: 'gặp chuỗi dừng', abort: 'đã dừng', functionCalls: 'gọi công cụ' };
const OVERFLOW_LABEL = { 'trim-middle': 'Cắt phần giữa', rolling: 'Trượt (bỏ tin cũ nhất)', stop: 'Dừng lại' };
const snapAlt = (m) => ({ content: m.content, thought: m.thought || null, thinkSecs: m.thinkSecs || null, stats: m.stats || null, model: m.model || null, sources: m.sources || null, error: !!m.error });
function statsHtml(st) {
  if (!st) return '';
  const parts = [st.tps ? `${st.tps.toFixed(1).replace('.', ',')} token/giây` : null, st.tokens != null ? `${st.tokens} token` : null,
    st.ttft != null ? `${fmtSec(st.ttft)} tới token đầu` : null, st.stop ? `Dừng: ${STOP_LABEL[st.stop] || st.stop}` : null, st.preset ? `Preset: ${st.preset}` : null];
  return `<div class="msg-stats">${parts.filter(Boolean).map(esc).join(' · ')}</div>`;
}
function paintCtxBar(st) {
  const el = $('#ctxBar'); if (!el) return;
  const size = (st && st.ctxSize) || state.status.contextSize; const used = st && st.ctxUsed;
  if (!size || used == null || isAgent()) { el.hidden = true; return; }
  const p = Math.min(100, used / size * 100); el.hidden = false;
  el.className = 'ctx-bar' + (p > 90 ? ' bad' : p > 70 ? ' warn' : '');
  el.title = `Ngữ cảnh đã dùng: ${used.toLocaleString('vi-VN')} / ${size.toLocaleString('vi-VN')} token`;
  el.innerHTML = `<div class="ctx-track"><div style="width:${p.toFixed(1)}%"></div></div><span>${p < 1 && used ? '<1' : Math.round(p)}% ngữ cảnh</span>`;
}
function lastStats(conv) { if (!conv) return null; for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].stats) return conv.messages[i].stats; return null; }
// ---- Thao tác trên tin nhắn: sửa, tạo lại (giữ các phiên bản), rẽ nhánh, xoá ----
$('#messages').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mact]'); if (!b || !state.current) return;
  const conv = state.current; const i = Number(b.closest('.msg').dataset.i); const m = conv.messages[i]; if (!m) return;
  const act = b.dataset.mact;
  if (state.generating && act !== 'copy') { toast('Đang trả lời — bấm Dừng trước đã', true); return; }
  if (act === 'copy') { await A.copyText(m.content); toast('Đã sao chép ✓'); }
  if (act === 'regen') {
    const u = conv.messages[i - 1]; if (!u || u.role !== 'user') return;
    if (!state.status.loaded && !(await ensureLoaded())) return;
    if (i < conv.messages.length - 1) { const ok = await modalAsk({ icon: '↻', title: 'Tạo lại câu trả lời này?', message: `Các tin nhắn phía sau (${conv.messages.length - 1 - i}) sẽ bị bỏ. Nếu muốn giữ, hãy dùng “Rẽ nhánh” trước.`, okLabel: 'Tạo lại', noLabel: 'Huỷ' }); if (!ok) return; conv.messages.splice(i + 1); }
    if (!m.alts) { m.alts = [snapAlt(m)]; }
    m.content = ''; m.thought = null; m.stats = null; m.sources = null; delete m.error; m.model = state.status.id;
    await runTurn(conv, u, m);
  }
  if (act === 'prev' || act === 'next') {
    if (!m.alts) return; const k = Math.max(0, Math.min(m.alts.length - 1, (m.alt ?? m.alts.length - 1) + (act === 'next' ? 1 : -1)));
    Object.assign(m, m.alts[k], { alt: k }); if (!m.alts[k].error) delete m.error; else m.error = true;
    await A.saveConvo(conv); renderMessages();
  }
  if (act === 'branch') {
    const c = { id: uid(), title: (conv.title || 'Cuộc trò chuyện') + ' (nhánh)', messages: JSON.parse(JSON.stringify(conv.messages.slice(0, i + 1))), createdAt: Date.now(), updatedAt: Date.now(), mode: 'chat', branchOf: conv.id, folder: conv.folder || null };
    await A.saveConvo(c); await loadConvos(); state.current = state.convos.find(x => x.id === c.id) || c; renderConvos(); renderMessages(); toast('Đã rẽ nhánh thành cuộc trò chuyện mới ✓');
  }
  if (act === 'del') {
    const ok = await modalAsk({ icon: '🗑', title: 'Xoá tin nhắn này?', message: m.role === 'user' ? 'Chỉ xoá tin nhắn của bạn; câu trả lời phía sau vẫn giữ.' : 'Chỉ xoá câu trả lời này.', okLabel: 'Xoá', noLabel: 'Huỷ', danger: true });
    if (!ok) return; conv.messages.splice(i, 1); conv.updatedAt = Date.now(); await A.saveConvo(conv); renderMessages();
  }
  if (act === 'edit') editMsg(i);
});
function editMsg(i) {
  const conv = state.current; const m = conv.messages[i]; const el = document.querySelector(`#messages .msg[data-i="${i}"]`); if (!el) return;
  el.classList.add('editing');
  el.querySelector('.body').innerHTML = `<textarea class="edit-box" rows="3" aria-label="Sửa tin nhắn">${esc(m.content)}</textarea><div class="edit-acts"><span class="small muted">Ctrl+Enter: gửi lại · Esc: huỷ</span><button class="btn sm" data-eact="cancel">Huỷ</button><button class="btn sm" data-eact="save">Chỉ lưu</button><button class="btn sm primary" data-eact="send">Gửi lại</button></div>`;
  const ta = el.querySelector('.edit-box'); ta.style.height = Math.min(320, ta.scrollHeight + 4) + 'px'; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  const done = async (how) => {
    const v = ta.value.trim(); if (how === 'cancel' || !v) { renderMessages(); return; }
    m.content = v; delete m.context; conv.updatedAt = Date.now();
    if (how === 'save') { await A.saveConvo(conv); renderMessages(); return; }
    if (!state.status.loaded && !(await ensureLoaded())) { renderMessages(); return; }
    conv.messages.splice(i + 1); const reply = { role: 'assistant', content: '', model: state.status.id }; conv.messages.push(reply);
    await runTurn(conv, m, reply);
  };
  el.querySelector('.edit-acts').addEventListener('click', (e) => { const b = e.target.closest('[data-eact]'); if (b) done(b.dataset.eact); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done('cancel'); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done('send'); } });
}
let genStartedAt = 0;
$('#stopBtn').addEventListener('click', () => { if (!state.generating) return; if (Date.now() - genStartedAt < 700) return; /* bấm đúp nút Gửi: cú bấm thứ hai rơi vào nút Dừng */ A.stop(state.generating); });

// ---------- 0.16: tham số trò chuyện + preset (bố cục kiểu LM Studio: Hệ thống · Lấy mẫu · Đầu ra) ----------
const PRM = [
  { k: 'topK', label: 'Top K', min: 0, max: 1000, step: 1, hint: 'Chỉ chọn trong K từ (token) có xác suất cao nhất. 0 = tắt.' },
  { k: 'topP', label: 'Top P', min: 0, max: 1, step: 0.01, hint: 'Chọn trong nhóm token có tổng xác suất P.' },
  { k: 'minP', label: 'Min P', min: 0, max: 1, step: 0.01, hint: 'Bỏ token có xác suất nhỏ hơn P × token tốt nhất.' },
  { k: 'repeatPenalty', label: 'Phạt lặp lại', min: 0.5, max: 3, step: 0.01, hint: 'Lớn hơn 1 thì mô hình ít lặp lại từ đã dùng.' },
  { k: 'presencePenalty', label: 'Phạt chủ đề cũ', min: -2, max: 2, step: 0.05, hint: 'Lớn hơn 0 thì mô hình hay nói ý mới hơn.' },
  { k: 'seed', label: 'Seed', min: 0, max: 2147483647, step: 1, hint: 'Cùng seed + cùng câu hỏi + cùng máy và cài đặt thường cho câu trả lời giống nhau, nhưng llama.cpp không bảo đảm giống từng chữ (nhất là khi chạy bằng CPU). Để trống = ngẫu nhiên.', noDefault: true },
];
const cp = { builtin: [], defaults: null };
const cpParams = () => ({ ...((state.settings && state.settings.chatParams) || {}) });
const presetsAll = () => [...cp.builtin, ...(((state.settings && state.settings.presets) || []).map(p => ({ ...p, builtin: false })))];
const activePreset = () => { const all = presetsAll(); return all.find(p => p.id === (state.settings && state.settings.activePreset)) || all[0] || null; };
const normP = (o) => { const r = {}; for (const [k, v] of Object.entries(o || {})) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length) && v !== false) r[k] = v; return JSON.stringify(Object.keys(r).sort().map(k => [k, r[k]])); };
function cpDirty() {
  const p = activePreset(); if (!p) return false; const s = state.settings;
  return (s.systemPrompt || '') !== (p.systemPrompt || '') || Number(s.temperature) !== Number(p.temperature) || Number(s.maxTokens) !== Number(p.maxTokens || 1024) || normP(cpParams()) !== normP(p.params);
}
function chatParams() {
  const s = state.settings || {}; const q = cpParams(); const p = activePreset();
  let jsonSchema = null; if (q.jsonOn && q.jsonSchema) { try { jsonSchema = JSON.parse(q.jsonSchema); } catch {} }
  return { systemPrompt: s.systemPrompt || '', temperature: Number(s.temperature), maxTokens: Number(s.maxTokens) || 1024,
    topK: q.topK ?? null, topP: q.topP ?? null, minP: q.minP ?? null, repeatPenalty: q.repeatPenalty ?? null, presencePenalty: q.presencePenalty ?? null,
    seed: q.seed ?? null, stop: q.stop || null, overflow: q.overflow || 'trim-middle', jsonSchema, presetName: p ? p.name + (cpDirty() ? ' (đã sửa)' : '') : null };
}
async function cpSave(patch) { state.settings = await A.setSettings(patch); paintPresetBar(); }
async function cpSetParam(k, v) { const q = cpParams(); if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete q[k]; else q[k] = v; await cpSave({ chatParams: q }); }
function paintPresetBar() {
  const all = presetsAll(); const cur = activePreset(); const sel = $('#presetSel');
  const b = all.filter(p => p.builtin), u = all.filter(p => !p.builtin);
  sel.innerHTML = `<optgroup label="Preset của AIVN">${b.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>` + (u.length ? `<optgroup label="Preset của tôi">${u.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>` : '');
  if (cur) sel.value = cur.id;
  const dirty = cpDirty(); $('#presetDirty').hidden = !dirty;
  $('#presetSave').disabled = !dirty && !!cur; $('#presetSave').title = cur && cur.builtin ? 'Preset của AIVN không sửa được — lưu thành preset mới' : 'Lưu thay đổi vào preset này';
  for (const it of $('#presetMenu').querySelectorAll('[data-pm=rename],[data-pm=delete]')) it.disabled = !cur || cur.builtin;
  $('#presetMenu').querySelector('[data-pm=reset]').disabled = !dirty;
}
function paintCp() {
  const s = state.settings; if (!s) return; const q = cpParams();
  if (document.activeElement !== $('#sysPrompt')) $('#sysPrompt').value = s.systemPrompt || '';
  $('#temp').value = s.temperature; $('#tempN').value = s.temperature; $('#tempOut').textContent = s.temperature;
  $('#maxTok').value = s.maxTokens; $('#overflowSel').value = q.overflow || 'trim-middle';
  const d = cp.defaults || {};
  $('#prmList').innerHTML = PRM.map(p => { const v = q[p.k]; const def = p.noDefault ? '' : d[p.k] != null ? String(d[p.k]).replace('.', ',') : '';
    return `<div class="prm${v != null ? ' set' : ''}" data-k="${p.k}"><div class="prm-h"><label for="prm-${p.k}">${p.label}</label><span class="prm-r"><input type="number" class="prm-n" id="prm-${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v ?? ''}" placeholder="${p.noDefault ? 'ngẫu nhiên' : def ? 'mô hình: ' + def : 'mặc định'}"><button type="button" class="prm-reset" data-reset="${p.k}" title="Về mặc định của mô hình" aria-label="Đặt lại ${p.label}" ${v == null ? 'hidden' : ''}>↺</button></span></div><small>${p.hint}</small></div>`; }).join('');
  $('#stopChips').innerHTML = (q.stop || []).map((x, i) => `<span class="stop-chip"><code>${esc(JSON.stringify(x).slice(1, -1))}</code><button type="button" data-stop-del="${i}" aria-label="Bỏ chuỗi dừng">✕</button></span>`).join('');
  $('#jsonOn').checked = !!q.jsonOn; $('#jsonSchema').hidden = !q.jsonOn; if (document.activeElement !== $('#jsonSchema')) $('#jsonSchema').value = q.jsonSchema || '';
  paintJsonErr(); paintSysTok(); paintPresetBar();
}
function paintSysTok() { const n = Math.ceil(($('#sysPrompt').value || '').length / 3.2); $('#sysTok').textContent = n ? `≈ ${n.toLocaleString('vi-VN')} token` : ''; }
function paintJsonErr() {
  const q = cpParams(); const el = $('#jsonErr'); let msg = '';
  if (q.jsonOn) { if (!q.jsonSchema || !q.jsonSchema.trim()) msg = 'Hãy nhập lược đồ JSON (JSON Schema).'; else { try { const j = JSON.parse(q.jsonSchema); if (!j || typeof j !== 'object' || Array.isArray(j)) msg = 'Lược đồ phải là một đối tượng JSON.'; } catch (e) { msg = 'JSON chưa hợp lệ: ' + e.message; } } }
  el.textContent = msg; el.hidden = !msg; $('#jsonSchema').classList.toggle('bad', !!msg);
}
async function refreshChatDefaults() { cp.defaults = await A.chatDefaults().catch(() => null); paintCp(); }
async function applyPreset(p) {
  if (!p) return;
  await cpSave({ activePreset: p.id, systemPrompt: p.systemPrompt || '', temperature: Number(p.temperature ?? 0.7), maxTokens: Number(p.maxTokens || 1024), chatParams: { ...(p.params || {}) } });
  paintCp();
}
function promptText({ title, value = '', okLabel = 'Lưu', validate }) {
  return new Promise((resolve) => {
    const m = $('#promptModal'); $('#pmTitle').textContent = title; $('#pmInput').value = value; $('#pmYes').textContent = okLabel; $('#pmErr').hidden = true; m.hidden = false;
    setTimeout(() => { $('#pmInput').focus(); $('#pmInput').select(); }, 0);
    const end = (v) => { m.hidden = true; $('#pmForm').onsubmit = null; $('#pmNo').onclick = null; m.onkeydown = null; resolve(v); };
    $('#pmForm').onsubmit = (e) => { e.preventDefault(); const v = $('#pmInput').value.trim(); const err = !v ? 'Hãy nhập tên' : validate ? validate(v) : null; if (err) { $('#pmErr').textContent = err; $('#pmErr').hidden = false; return; } end(v); };
    $('#pmNo').onclick = () => end(null); m.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); end(null); } };
  });
}
const curSnapshot = () => { const s = state.settings; return { systemPrompt: s.systemPrompt || '', temperature: Number(s.temperature), maxTokens: Number(s.maxTokens) || 1024, params: cpParams() }; };
const nameTaken = (n, exceptId) => presetsAll().some(p => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase()) ? 'Đã có preset tên này' : null;
async function presetSaveAs(snapshot = curSnapshot(), name = null) {
  const cur = activePreset();
  name = name || await promptText({ title: 'Lưu thành preset mới', value: cur ? cur.name + ' (của tôi)' : 'Preset của tôi', validate: (v) => nameTaken(v) });
  if (!name) return;
  const p = { id: 'u:' + uid(), name, ...snapshot };
  await cpSave({ presets: [...(state.settings.presets || []), p], activePreset: p.id }); paintCp(); toast(`Đã lưu preset “${name}” ✓`);
}
async function presetAction(act) {
  $('#presetMenu').hidden = true; $('#presetMore').setAttribute('aria-expanded', 'false');
  const cur = activePreset(); const user = state.settings.presets || [];
  if (act === 'save') { if (!cur || cur.builtin) return presetSaveAs(); await cpSave({ presets: user.map(p => p.id === cur.id ? { ...p, ...curSnapshot() } : p) }); paintCp(); toast(`Đã lưu preset “${cur.name}” ✓`); }
  if (act === 'saveas') return presetSaveAs();
  if (act === 'reset') return applyPreset(cur);
  if (act === 'rename' && cur && !cur.builtin) { const n = await promptText({ title: 'Đổi tên preset', value: cur.name, validate: (v) => nameTaken(v, cur.id) }); if (n) { await cpSave({ presets: user.map(p => p.id === cur.id ? { ...p, name: n } : p) }); paintCp(); } }
  if (act === 'delete' && cur && !cur.builtin) { const ok = await modalAsk({ icon: '🗑', title: `Xoá preset “${cur.name}”?`, message: 'Cài đặt trò chuyện hiện tại vẫn giữ nguyên; chỉ xoá preset đã lưu.', okLabel: 'Xoá', noLabel: 'Huỷ' }); if (ok) { await cpSave({ presets: user.filter(p => p.id !== cur.id), activePreset: cp.builtin[0] && cp.builtin[0].id }); paintCp(); toast('Đã xoá preset'); } }
  if (act === 'export') { const r = await A.presetExport({ name: cur ? cur.name : 'Preset', ...curSnapshot() }).catch(e => ({ ok: false, error: cleanErr(e.message) })); if (r.ok) toast('Đã xuất preset ✓'); else if (r.error) toast(r.error, true); }
  if (act === 'import') { const r = await A.presetImport().catch(e => ({ ok: false, error: cleanErr(e.message) })); if (r.error) return toast('Không nhập được preset: ' + r.error, true); if (!r.ok) return;
    let name = r.preset.name; if (nameTaken(name)) name = await promptText({ title: 'Tên preset đã có — đặt tên khác', value: name + ' (nhập)', validate: (v) => nameTaken(v) }); if (!name) return;
    const { name: _n, ...snap } = r.preset; await presetSaveAs(snap, name); await applyPreset(activePreset()); }
}
async function initChatPanel() {
  cp.builtin = await A.presetsBuiltin().catch(() => []);
  const save = (patch) => cpSave(patch);
  $('#sysPrompt').addEventListener('input', () => { paintSysTok(); });
  $('#sysPrompt').addEventListener('change', e => save({ systemPrompt: e.target.value }));
  $('#temp').addEventListener('input', e => { $('#tempN').value = e.target.value; $('#tempOut').textContent = e.target.value; });
  $('#temp').addEventListener('change', e => save({ temperature: Number(e.target.value) }));
  $('#tempN').addEventListener('change', e => { const v = Math.max(0, Math.min(2, Number(e.target.value) || 0)); e.target.value = v; $('#temp').value = v; save({ temperature: v }); });
  $('#maxTok').addEventListener('change', e => { const v = Math.max(16, Math.min(32768, Math.round(Number(e.target.value)) || 1024)); e.target.value = v; save({ maxTokens: v }); });
  $('#overflowSel').addEventListener('change', e => cpSetParam('overflow', e.target.value === 'trim-middle' ? null : e.target.value));
  $('#prmList').addEventListener('change', async (e) => { const row = e.target.closest('.prm'); if (!row || !e.target.classList.contains('prm-n')) return; const p = PRM.find(x => x.k === row.dataset.k);
    let v = e.target.value === '' ? null : Number(e.target.value); if (v != null) { if (!Number.isFinite(v)) v = null; else v = Math.max(p.min, Math.min(p.max, p.step >= 1 ? Math.round(v) : v)); }
    await cpSetParam(p.k, v); paintCp(); });
  $('#prmList').addEventListener('click', async (e) => { const b = e.target.closest('[data-reset]'); if (b) { await cpSetParam(b.dataset.reset, null); paintCp(); } });
  $('#stopIn').addEventListener('keydown', async (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const raw = e.target.value; if (!raw) return; const v = raw.replace(/\\n/g, '\n'); const cur = cpParams().stop || [];
    if (cur.length >= 8) return toast('Tối đa 8 chuỗi dừng', true); if (cur.includes(v)) return toast('Chuỗi dừng này đã có', true); e.target.value = ''; await cpSetParam('stop', [...cur, v]); paintCp(); $('#stopIn').focus(); });
  $('#stopChips').addEventListener('click', async (e) => { const b = e.target.closest('[data-stop-del]'); if (!b) return; const cur = [...(cpParams().stop || [])]; cur.splice(Number(b.dataset.stopDel), 1); await cpSetParam('stop', cur); paintCp(); });
  $('#jsonOn').addEventListener('change', async (e) => { const q = cpParams(); q.jsonOn = e.target.checked || undefined; if (e.target.checked && !q.jsonSchema) q.jsonSchema = JSON.stringify({ type: 'object', properties: { tra_loi: { type: 'string' } }, required: ['tra_loi'] }, null, 2); if (!q.jsonOn) delete q.jsonOn; await cpSave({ chatParams: q }); paintCp(); });
  $('#jsonSchema').addEventListener('input', async (e) => { const q = cpParams(); q.jsonSchema = e.target.value; state.settings.chatParams = q; paintJsonErr(); });
  $('#jsonSchema').addEventListener('change', async (e) => { await cpSetParam('jsonSchema', e.target.value); paintJsonErr(); });
  $('#presetSel').addEventListener('change', async (e) => {
    const p = presetsAll().find(x => x.id === e.target.value); if (!p) return;
    if (cpDirty()) { const ok = await modalAsk({ icon: '⚠️', title: 'Bỏ thay đổi chưa lưu?', message: `Cài đặt hiện tại khác preset “${(activePreset() || {}).name || ''}”. Chuyển sang “${p.name}” sẽ bỏ các thay đổi này.`, okLabel: 'Chuyển preset', noLabel: 'Ở lại' }); if (!ok) { paintPresetBar(); return; } }
    await applyPreset(p); toast(`Đang dùng preset “${p.name}”`);
  });
  $('#presetSave').addEventListener('click', () => presetAction('save'));
  $('#presetMore').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#presetMenu'); m.hidden = !m.hidden; $('#presetMore').setAttribute('aria-expanded', String(!m.hidden)); if (!m.hidden) m.querySelector('button:not(:disabled)').focus(); });
  document.addEventListener('click', (e) => { if (!$('#presetMenu').hidden && !e.target.closest('#presetMenu')) { $('#presetMenu').hidden = true; $('#presetMore').setAttribute('aria-expanded', 'false'); } });
  $('#presetMenu').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#presetMenu').hidden = true; $('#presetMore').focus(); } });
  document.querySelector('.cp').addEventListener('click', (e) => { const b = e.target.closest('[data-pm]'); if (b && !b.disabled) presetAction(b.dataset.pm); });
  document.querySelector('.cp-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-cpt]'); if (b) cpTab(b.dataset.cpt); });
  document.querySelector('.cp-tabs').addEventListener('keydown', (e) => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; const tabs = [...document.querySelectorAll('[data-cpt]')]; const i = tabs.findIndex(t => t.classList.contains('on')); const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; cpTab(n.dataset.cpt); n.focus(); });
  cpTab(localStorage.getItem('aivn.cpTab') || 'sys');
  if (!state.settings.activePreset) { const d = cp.builtin[0]; if (d && !cpDirty.call(null)) await cpSave({ activePreset: d.id }); }
  await refreshChatDefaults();
}
function cpTab(t) {
  for (const b of document.querySelectorAll('[data-cpt]')) { const on = b.dataset.cpt === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
  for (const p of document.querySelectorAll('[data-cpp]')) p.hidden = p.dataset.cpp !== t;
  localStorage.setItem('aivn.cpTab', t);
}
// ---- Lệnh "/" trong ô nhập ----
const SLASH = [
  { c: '/moi', d: 'Bắt đầu cuộc trò chuyện mới', run: () => { if (state.generating) return toast('Đang tạo câu trả lời — bấm Dừng trước khi mở cuộc trò chuyện mới', true); $('#newChat').click(); } },
  { c: '/preset', a: '<tên>', d: 'Chuyển preset (vd. /preset Lập trình viên)', run: async (arg) => { const p = presetsAll().find(x => x.name.toLowerCase() === arg.toLowerCase()) || presetsAll().find(x => x.name.toLowerCase().includes(arg.toLowerCase())); if (!p) return toast('Không thấy preset “' + arg + '”', true); await applyPreset(p); toast(`Đang dùng preset “${p.name}”`); } },
  { c: '/he-thong', a: '<lời nhắc>', d: 'Đặt lời nhắc hệ thống', run: async (arg) => { if (!arg) return cpTab('sys'), $('#sysPrompt').focus(); await cpSave({ systemPrompt: arg }); paintCp(); toast('Đã đặt lời nhắc hệ thống'); } },
  { c: '/nhiet-do', a: '<0–2>', d: 'Đặt nhiệt độ', run: async (arg) => { const v = Number(String(arg).replace(',', '.')); if (!(v >= 0 && v <= 2)) return toast('Nhiệt độ phải từ 0 đến 2', true); await cpSave({ temperature: v }); paintCp(); toast('Nhiệt độ: ' + v); } },
  { c: '/sao-chep', d: 'Sao chép cả cuộc trò chuyện (Markdown)', run: async () => { const c = state.current; if (!c || !c.messages.length) return toast('Chưa có gì để sao chép', true); await A.copyText(c.messages.map(m => `**${m.role === 'user' ? 'Bạn' : 'AIVN'}:** ${m.content}`).join('\n\n')); toast('Đã sao chép cuộc trò chuyện ✓'); } },
  { c: '/nap', d: 'Mở hộp nạp mô hình (Ctrl+L)', run: () => openLoader() },
];
function runSlash(text) {
  const [c, ...rest] = text.split(/\s+/); const cmd = SLASH.find(x => x.c === c.toLowerCase()); if (!cmd) return false;
  input.value = ''; input.style.height = 'auto'; $('#slashPop').hidden = true; cmd.run(rest.join(' ').trim()); return true;
}
let slashSel = 0;
function paintSlash() {
  const v = input.value; const pop = $('#slashPop');
  if (isAgent() || !/^\/\S*$/.test(v)) { pop.hidden = true; return; }
  const list = SLASH.filter(x => x.c.startsWith(v.toLowerCase())); if (!list.length) { pop.hidden = true; return; }
  slashSel = Math.min(slashSel, list.length - 1);
  pop.innerHTML = list.map((x, i) => `<button type="button" role="option" aria-selected="${i === slashSel}" class="${i === slashSel ? 'on' : ''}" data-slash="${x.c}"><code>${x.c}${x.a ? ' ' + esc(x.a) : ''}</code><span>${esc(x.d)}</span></button>`).join(''); pop.hidden = false;
}
input.addEventListener('input', () => { slashSel = 0; paintSlash(); });
input.addEventListener('blur', () => { $('#slashPop').hidden = true; });
input.addEventListener('keydown', (e) => {
  const pop = $('#slashPop'); if (pop.hidden) return; const items = [...pop.querySelectorAll('[data-slash]')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); slashSel = (slashSel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; paintSlash(); }
  else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { const it = items[slashSel]; const cmd = SLASH.find(x => x.c === it.dataset.slash); if (cmd.a) { e.preventDefault(); e.stopImmediatePropagation(); input.value = cmd.c + ' '; pop.hidden = true; } else if (e.key === 'Tab') { e.preventDefault(); input.value = cmd.c; } }
  else if (e.key === 'Escape') { pop.hidden = true; }
}, true);
$('#slashPop').addEventListener('mousedown', (e) => { const b = e.target.closest('[data-slash]'); if (!b) return; e.preventDefault(); const cmd = SLASH.find(x => x.c === b.dataset.slash); if (cmd.a) { input.value = cmd.c + ' '; $('#slashPop').hidden = true; input.focus(); } else runSlash(cmd.c); });

// ---------- Cài đặt ----------
function bindSettings() {
  const s = state.settings;
  $('#ctxSize').value = String(s.contextSize ? Math.max(4096, s.contextSize) : 8192); paintPerf();
  $('#srvPort').value = s.apiPort; $('#srvAuto').checked = !!s.apiAutoStart;
  const save = async (patch) => { state.settings = await A.setSettings(patch); };
  initChatPanel().catch(e => console.error('initChatPanel', e));
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
  const sb = $('#sbServer'); sb.textContent = st.running ? `API: đang chạy · cổng ${port}` : 'API: tắt'; sb.classList.toggle('on', !!st.running);
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

// ---------- Giao diện sáng / tối ----------
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
const resolveTheme = (t) => (t === 'dark' || (t === 'system' && darkMq.matches) ? 'dark' : 'light');
// Đổi giao diện sáng/tối: logo rồng hiện giữa màn hình, màu giao diện mới lan ra từ logo thành vòng tròn phủ hết cửa sổ,
// rồi logo mờ dần (~840 ms). Chỉ dùng transform/opacity/clip-path.
// Cài đặt "Hiệu ứng chuyển giao diện" (themeFx): full = luôn chạy logo + vòng lan (kể cả khi Windows tắt "Animation effects"),
// os = theo hệ điều hành (giảm chuyển động → chỉ đổi màu nhẹ), off = đổi ngay.
// Đường chạy: 'vt' (View Transitions) → nếu API thiếu / lỗi / không chụp kịp → 'overlay' (lớp phủ màu nền mới, mặt nạ tròn lan ra).
// Ghi lại đường đã chạy vào window.__themePath và nhật ký ứng dụng.
const THEME_T = { in: 180, spread: 480, out: 180 };
const THEME_BG = { light: '#ffffff', dark: '#17181b' };
function themeLog(path, extra = '') {
  const info = `giao diện: ${path}${extra ? ' · ' + extra : ''} · ${innerWidth}x${innerHeight}@${devicePixelRatio} · giảm chuyển động=${reduceMq.matches}`;
  window.__themePath = path; (window.__themeLog = window.__themeLog || []).push(info); if (window.__themeLog.length > 20) window.__themeLog.shift();
  try { A.uiLog && A.uiLog(info); } catch {}
}
function themeFx() { const v = state.settings && state.settings.themeFx; return v === 'os' || v === 'off' ? v : 'full'; }
// Lớp phủ dự phòng: nền của giao diện mới lan ra thành vòng tròn, đổi giao diện bên dưới, rồi lớp phủ mờ đi.
async function themeOverlay(next, set) {
  const ov = document.createElement('div'); ov.className = 'theme-ov';
  ov.style.background = THEME_BG[next];
  $('#themeVeil').before(ov);
  try {
    await ov.animate({ clipPath: ['circle(0% at 50% 50%)', 'circle(150% at 50% 50%)'] }, { duration: THEME_T.spread, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' }).finished.catch(() => {});
    set();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await ov.animate({ opacity: [1, 0] }, { duration: 140, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {});
  } finally { ov.remove(); }
}
async function applyTheme(t, { animate = false } = {}) {
  t = ['light', 'dark', 'system'].includes(t) ? t : 'light';
  for (const b of document.querySelectorAll('#themeRow button')) b.classList.toggle('on', b.dataset.theme === t);
  const root = document.documentElement, next = resolveTheme(t);
  if ((applyTheme.pending || root.dataset.theme) === next) return;
  const set = () => { root.dataset.theme = next; if (applyTheme.pending === next) applyTheme.pending = null; };
  const crossfade = () => { root.classList.add('theme-anim'); set(); clearTimeout(applyTheme.timer); applyTheme.timer = setTimeout(() => root.classList.remove('theme-anim'), 400); };
  const fx = themeFx();
  if (!animate || document.hidden) { applyTheme.pending = null; return set(); }
  if (fx === 'off') { applyTheme.pending = null; themeLog('tắt'); return set(); }
  if (fx === 'os' && reduceMq.matches) { applyTheme.pending = null; themeLog('đổi màu (hệ điều hành giảm chuyển động)'); return crossfade(); }
  applyTheme.pending = next;
  const veil = $('#themeVeil'), logo = veil.querySelector('img');
  // chờ lượt trước xong; nhiều lần bấm cùng chờ một lượt thì chỉ một lần chạy (tránh hai View Transition chồng nhau → AbortError)
  while (applyTheme.busy) { await applyTheme.busy; if (applyTheme.pending !== next) return; }
  let release; applyTheme.busy = new Promise(r => { release = r; });
  const t0 = performance.now();
  try {
    veil.classList.add('on');
    await logo.animate([{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'scale(1)' }], { duration: THEME_T.in, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished.catch(() => {});
    const pulse = () => logo.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: THEME_T.spread, easing: 'ease-in-out' });
    let path = 'overlay', why = document.startViewTransition ? '' : 'không có View Transitions';
    if (document.startViewTransition && !window.__forceThemeOverlay) {
      root.classList.add('vt-theme');
      let vt = null;
      try { vt = document.startViewTransition(() => { set(); }); } catch (e) { why = 'startViewTransition lỗi: ' + (e && e.message || e); }
      if (vt) {
        // chờ thật sự: ảnh chụp cũ + đổi giao diện xong (cửa sổ 4K/DPI cao có thể mất >300 ms); chỉ bỏ khi quá 2,5 s
        const ready = await Promise.race([vt.ready.then(() => 'ok', (e) => 'lỗi: ' + (e && e.name || e)), new Promise(r => setTimeout(() => r('quá giờ'), 2500))]);
        if (ready === 'ok') {
          pulse();
          const done = await root.animate({ clipPath: ['circle(0% at 50% 50%)', 'circle(150% at 50% 50%)'] }, { duration: THEME_T.spread, easing: 'cubic-bezier(.45,0,.2,1)', pseudoElement: '::view-transition-new(root)' }).finished.then(() => true, () => false);
          await vt.finished.catch(() => {});
          if (done) path = 'vt'; else why = 'hoạt ảnh vòng tròn bị huỷ';
        } else {
          why = 'View Transition ' + ready; try { vt.skipTransition(); } catch {}
          await vt.finished.catch(() => {});
        }
      }
      root.classList.remove('vt-theme');
      if (path !== 'vt' && root.dataset.theme === next) {
        // giao diện đã đổi nhưng không thấy vòng lan: chạy lớp phủ từ màu cũ để người dùng vẫn thấy hiệu ứng
        const prev = next === 'dark' ? 'light' : 'dark'; root.dataset.theme = prev;
      }
    }
    if (path !== 'vt') { pulse(); await themeOverlay(next, set); }
    if (root.dataset.theme !== next) set();
    await logo.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.18)' }], { duration: THEME_T.out, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
    themeLog(path === 'vt' ? 'logo + vòng lan (View Transitions)' : 'logo + vòng lan (lớp phủ dự phòng)', [why, Math.round(performance.now() - t0) + ' ms'].filter(Boolean).join(' · '));
  } finally { veil.classList.remove('on'); release(); applyTheme.busy = null; if (root.dataset.theme !== next && applyTheme.pending === next) set(); }
}
// chỉ theo hệ điều hành khi chọn "Tự động" (đổi nativeTheme khi lưu cài đặt cũng phát sự kiện này)
darkMq.addEventListener('change', () => { if (state.settings && state.settings.theme === 'system') applyTheme('system', { animate: true }); });
$('#themeRow').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-theme]'); if (!b) return;
  state.settings.theme = b.dataset.theme;
  applyTheme(b.dataset.theme, { animate: true }); state.settings = await A.setSettings({ theme: b.dataset.theme });
});
$('#themeFxSel').addEventListener('change', async (e) => { state.settings = await A.setSettings({ themeFx: e.target.value }); e.target.value = themeFx(); });
// ---------- Tìm kiếm trong tài liệu (RAG) ----------
let ragJobId = null;
async function paintRag() {
  const r = await A.ragInfo();
  ragJobId = `${r.repo}::bge-m3-q8_0.gguf`;
  const j = jobs.get(ragJobId) || r.job;
  const busy = j && j.status !== 'done' && !r.installed;
  $('#ragText').innerHTML = r.installed
    ? `✓ Đã có mô hình <b>${esc(r.name)}</b> (${fmtBytes(r.size)}, giấy phép ${esc(r.license)}). Tài liệu được chia đoạn, tìm đoạn liên quan nhất cho từng câu hỏi và ghi nguồn dưới câu trả lời.`
    : busy ? `Đang tải ${esc(r.name)}…` : `Tài liệu dài sẽ được tìm theo từ khoá. Tải <b>${esc(r.name)}</b> (${fmtBytes(r.size)}, chạy trên máy) để tìm theo ý nghĩa, chính xác hơn và có ghi nguồn.`;
  $('#ragDl').hidden = r.installed || busy; $('#ragDel').hidden = !r.installed;
  $('#ragProg').hidden = !busy;
  if (busy && j.total) $('#ragProg div').style.width = (100 * j.received / j.total).toFixed(1) + '%';
  $('#ragOn').checked = r.enabled; $('#ragOn').disabled = !r.installed;
}
$('#ragDl').addEventListener('click', async () => { try { await A.ragDownload(); toast('Đang tải mô hình tìm kiếm tài liệu…'); } catch (err) { toast(cleanErr(err.message), true); } paintRag(); });
$('#ragDel').addEventListener('click', async () => { await A.ragDelete(); paintRag(); });
$('#ragOn').addEventListener('change', async (e) => { state.settings = await A.setSettings({ rag: e.target.checked }); });
A.onDl((j) => { if (j.id === ragJobId) paintRag(); });
A.onDlDone((j) => { if (j.id === ragJobId) { paintRag(); toast('Đã tải xong mô hình tìm kiếm tài liệu ✓ Câu hỏi tiếp theo về tài liệu sẽ dùng tìm kiếm ngữ nghĩa.'); } });
let ragOffered = false;
function offerRag() { // gợi ý một lần mỗi phiên khi tài liệu được tìm theo từ khoá (đặt ngoài khung tin nhắn để không bị vẽ lại)
  if (ragOffered || state.settings.ragOfferDismissed) return; ragOffered = true;
  const w = $('#ragOffer');
  w.innerHTML = `<span>🔎 Muốn AIVN tìm đúng đoạn trong tài liệu dài và ghi nguồn? Tải mô hình tìm kiếm BGE-M3 (605 MB, chạy trên máy, chỉ tải một lần).</span> <button class="btn sm primary" data-rag="dl">Tải ngay</button> <button class="btn sm" data-rag="no">Để sau</button>`;
  w.hidden = false;
}
$('#ragOffer').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-rag]'); if (!b) return;
  if (b.dataset.rag === 'dl') { try { await A.ragDownload(); toast('Đang tải mô hình tìm kiếm, xem tiến độ trong Cài đặt trò chuyện'); } catch (err) { toast(cleanErr(err.message), true); } paintRag(); }
  else state.settings = await A.setSettings({ ragOfferDismissed: true });
  $('#ragOffer').hidden = true;
});
A.onVcredist(() => { // Windows thiếu Visual C++ Redistributable: llama-server không chạy được
  const w = $('#sysNotice');
  w.innerHTML = '<span>🧩 Chế độ nhìn ảnh trên Windows cần <b>Microsoft Visual C++ Redistributable 2015–2022 (x64)</b>. Cài xong hãy nạp lại mô hình.</span> <button class="btn sm primary" data-vc="dl">Tải từ Microsoft</button> <button class="btn sm" data-vc="no">Đóng</button>';
  w.hidden = false;
});
$('#sysNotice').addEventListener('click', (e) => { const b = e.target.closest('[data-vc]'); if (!b) return; if (b.dataset.vc === 'dl') A.openVcredist(); $('#sysNotice').hidden = true; });

// ---------- AIVN AGENT ----------
const AGENT_EXAMPLES = ['Bây giờ là mấy giờ, hôm nay thứ mấy? Còn bao nhiêu ngày nữa đến Tết Dương lịch?', 'Xem thư mục được phép có những tệp nào rồi tóm tắt tệp mới nhất.', 'Tính lãi kép: gửi 50 triệu, lãi 6,5%/năm trong 5 năm thì được bao nhiêu?', 'Hãy nhớ: tôi tên Khôi, đang học ở VLU.'];
const STATUS_VI = { running: 'đang chạy', ok: 'xong', error: 'lỗi', refused: 'bị từ chối' };
const fmtMs = (ms) => ms == null ? '' : ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1).replace('.', ',') + ' giây';
function argPreview(st) { const a = st.args || {}; const v = a.path || a.expression || a.query || a.url || a.fact || a.title || a.code || ''; return String(v).split('\n')[0].slice(0, 90); }
function stepHtml(st, open) {
  const args = Object.keys(st.args || {}).length ? JSON.stringify(st.args, null, 2) : '(không có)';
  return `<details class="step st-${esc(st.status)}" data-step="${esc(st.id)}"${open ? ' open' : ''}><summary><span aria-hidden="true">${esc(st.icon || '🔧')}</span><span class="s-name">${esc(st.label)}</span>${st.auto ? `<span class="s-auto" title="${st.auto === 'phrase' ? 'Tự làm không hỏi (theo câu trong yêu cầu của bạn)' : 'Tự làm không hỏi (đang bật)'}">⚡ tự làm</span>` : ''}<span class="s-sum">${esc(st.summary || argPreview(st))}</span>${st.ms != null ? `<span class="s-ms">${fmtMs(st.ms)}</span>` : ''}<span class="s-st">${STATUS_VI[st.status] || esc(st.status)}</span></summary>
    ${st.thumb && st.thumb.src ? `<img class="s-thumb" src="${esc(st.thumb.src)}" alt="Màn hình sau bước này" loading="lazy">` : ''}<div class="s-body"><h5>Công cụ</h5><div><code>${esc(st.name)}</code></div><h5>Đầu vào</h5><pre>${esc(args)}</pre>${st.status !== 'running' ? `<h5>Kết quả</h5><pre>${esc(st.detail ?? st.summary ?? '')}</pre>` : ''}</div></details>`;
}
function stepsHtml(m, openIds = new Set()) {
  if (!m.steps || !m.steps.length) return '';
  let html = '', lastPre = null;
  for (const st of m.steps) { if (st.pre && st.pre !== lastPre) { html += `<div class="step-pre">💭 ${esc(st.pre)}</div>`; lastPre = st.pre; } html += stepHtml(st, openIds.has(st.id)); }
  return `<div class="steps" aria-label="Các bước AIVN AGENT đã làm">${html}</div>`;
}
function webSrcHtml(m) {
  const urls = (m.urls || []).filter(Boolean); if (!urls.length) return '';
  const seen = new Set(); const rows = [];
  for (const u of urls) { const k = u.kind + u.url + (u.query || ''); if (seen.has(k)) continue; seen.add(k);
    rows.push(u.kind === 'search' ? `<div>🔎 Đã tìm “${esc(u.query)}” qua <a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(new URL(u.url).host)}</a></div>` : `<div>🌐 Đã mở: <a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title || u.url)}</a> <span class="muted">(${esc(new URL(u.url).host)})</span></div>`); }
  return `<div class="web-src">${rows.join('')}</div>`;
}
function agentHistory(conv) {
  return conv.messages.slice(0, -2).filter(m => !m.error && m.content).slice(-12).map(m => ({ role: m.role,
    content: (m.attachments ? `[Đã gửi kèm: ${m.attachments.map(a => a.name).join(', ')}]\n` : '') + (m.role === 'assistant' && m.steps && m.steps.length ? `[Đã dùng công cụ: ${m.steps.map(x => `${x.label}${x.summary ? ' (' + String(x.summary).slice(0, 80) + ')' : ''} ${x.status === 'ok' ? '✓' : x.status === 'refused' ? '✗ bị từ chối' : '✗ lỗi'}`).join('; ')}]\n${m.content}` : m.content) }));
}
$('#messages').addEventListener('click', (e) => { const b = e.target.closest('[data-example]'); if (b) { input.value = b.dataset.example; input.focus(); input.dispatchEvent(new Event('input')); } });

// Tệp/ảnh đính kèm cho AIVN AGENT: ảnh → mô hình nhìn ảnh (nếu có) hoặc chữ đọc bằng OCR; tài liệu → nội dung chữ đưa vào lượt hỏi;
// đường dẫn tệp đính kèm được phép đọc (read_file) trong việc này
async function agentAttachments(atts, text) {
  const vision = !!state.status.vision;
  for (const a of atts.filter(x => x.kind === 'image' && x.direct && !vision)) {
    try { const r = await A.ocrImage(a.png); if (r && r.chars >= 3) Object.assign(a, { direct: false, text: r.text, ocrChars: r.chars }); else a.ok = false; } catch { a.ok = false; }
    if (!a.ok) toast(`Không đọc được chữ trong ảnh "${a.name}", ảnh này sẽ không được gửi.`, true);
  }
  atts = atts.filter(a => a.ok);
  const budget = Math.max(3000, Math.floor((state.status.contextSize || 4096) * 1.4)); const per = Math.floor(budget / Math.max(1, atts.length));
  const imgs = [];
  const parts = atts.map(a => {
    if (a.kind === 'image' && vision && a.vis) { imgs.push(a.vis); return `[Ảnh đính kèm: ${a.name}]`; }
    const t = String(a.text || ''); const cut = t.length > per;
    return `[Tệp đính kèm: ${a.name}${a.path ? ` — đường dẫn: ${a.path}` : ''}${a.kind === 'image' ? ' (ảnh, chữ đọc bằng OCR)' : ''}]\n${t.slice(0, per)}${cut ? `\n…(đã cắt bớt${a.path ? '; dùng read_file với đường dẫn trên để đọc phần còn lại' : ''})` : ''}`;
  });
  const full = atts.length ? parts.join('\n\n') + '\n\n' + text : text;
  return { atts, content: imgs.length ? [{ type: 'text', text: full }, ...imgs.map(url => ({ type: 'image_url', image_url: { url } }))] : full, files: atts.filter(a => a.path).map(a => ({ path: a.path, name: a.name })) };
}
async function sendAgent(text) {
  const cloudOn = !!(state.settings && state.settings.cloudBrain && state.settings.cloudBrain.on);
  if (!state.status.loaded && !cloudOn && !(await ensureLoaded())) return;
  if (!(await agentGateOk())) return; // mô hình không dùng được cho AIVN AGENT: chặn, giữ nguyên tệp đính kèm và chữ đã nhập
  let atts = pending.filter(a => a.ok); pending = []; renderChips();
  if (!text && atts.length) text = atts.every(a => a.kind === 'image') ? 'Hãy xem ảnh đính kèm và cho biết nội dung.' : 'Hãy đọc tệp đính kèm và tóm tắt ý chính.';
  if (!text) return;
  const pack = await agentAttachments(atts, text); atts = pack.atts;
  if (!state.current) state.current = { id: uid(), title: text.slice(0, 48), messages: [], createdAt: Date.now(), updatedAt: Date.now(), mode: 'agent' };
  const conv = state.current;
  const userMsg = { role: 'user', content: text };
  if (atts.length) userMsg.attachments = atts.map(a => ({ name: a.name, size: a.size, kind: a.kind, pages: a.pages || null, ...(a.kind === 'image' ? { thumb: a.thumb, ocrChars: a.ocrChars, direct: !!(state.status.vision && a.vis) } : {}) }));
  conv.messages.push(userMsg);
  const reply = { role: 'assistant', content: '', model: state.status.id, steps: [], agent: true };
  conv.messages.push(reply);
  const idx = conv.messages.length - 1;
  input.value = ''; input.style.height = 'auto';
  renderMessages();
  const msgEl = () => $(`#messages .msg[data-i="${idx}"]`);
  const box = $('#messages');
  const stick = () => { box.scrollTop = box.scrollHeight; };
  msgEl().querySelector('.body').classList.add('cursor');
  const reqId = uid(); state.generating = reqId; genStartedAt = Date.now();
  $('#sendBtn').hidden = true; $('#stopBtn').hidden = false; $('#genStats').textContent = 'Đang chuẩn bị (công cụ, ghi nhớ)…';
  const paintSteps = () => { const el = msgEl(); if (!el) return; const w = el.querySelector('.steps-wrap'); const open = new Set($$('details.step[open]', w).map(d => d.dataset.step)); w.innerHTML = stepsHtml(reply, open); stick(); };
  let raf = false;
  const paintBody = () => { if (raf) return; raf = true; requestAnimationFrame(() => { raf = false; const el = msgEl(); if (el) el.querySelector('.body').innerHTML = md(reply.content); stick(); }); };
  const offTok = A.onToken(({ reqId: r, t }) => { if (r !== reqId) return; reply.content += t; paintBody(); });
  const offStep = A.onAgentStep(({ reqId: r, step }) => {
    if (r !== reqId) return;
    const i = reply.steps.findIndex(x => x.id === step.id);
    if (i < 0) { reply.steps.push(step); reply.content = ''; paintBody(); } else reply.steps[i] = step; // chữ trước khi gọi công cụ đã nằm trong thẻ bước
    paintSteps();
    $('#genStats').textContent = step.status === 'running' ? `Đang chạy công cụ: ${step.label}…` : 'Đang suy nghĩ tiếp…';
  });
  const offSt = A.onAgentStatus((st) => {
    if (st.reqId !== reqId) return;
    if (st.stage === 'think') setPhase('think');
    if (st.stage === 'ask') setPhase('ask');
    if (st.stage === 'act' || st.stage === 'tools') setPhase('act');
    if (st.stage === 'think') $('#genStats').textContent = st.round ? `Đang suy nghĩ… (bước ${st.round + 1})` : 'Đang suy nghĩ…';
    if (st.stage === 'recover') { reply.content = ''; reply.steps = []; paintBody(); paintSteps(); $('#genStats').textContent = st.grow ? `Ngữ cảnh chưa đủ cho yêu cầu này — đang nạp lại mô hình với ngữ cảnh ${Number(st.ctx).toLocaleString('vi-VN')}…` : `Bộ máy AI vừa dừng — đang tự nạp lại mô hình (ngữ cảnh ${st.ctx}) và thử lại…`; return; }
    if (st.stage === 'verify') { reply.content = ''; paintBody(); $('#genStats').textContent = 'Đang kiểm tra lại: câu trả lời chưa khớp với các bước đã làm…'; }
  });
  try {
    const r = await A.agentRun({ reqId, convoId: conv.id, messages: [...agentHistory(conv), { role: 'user', content: pack.content }], attachments: pack.files });
    if (r.blocked) { reply.content = `⛔ ${r.gate.modelName || 'Mô hình này'} chưa dùng được cho AIVN AGENT: ${r.gate.reason}. Hãy chuyển sang mô hình phù hợp ở thanh phía trên.`; reply.warning = 'blocked'; r.text = reply.content; r.usage = { completion_tokens: 0, seconds: 0 }; refreshAgent(); }
    Object.assign(reply, { content: r.text || (r.finishReason === 'abort' ? '' : r.warning ? '' : '(AIVN AGENT không trả lời)'), warning: r.warning || null, steps: r.steps, urls: r.urls, memories: r.memories, model: r.model || reply.model });
    const tools = r.steps.length;
    $('#genStats').textContent = `${tools ? tools + ' bước dùng công cụ · ' : ''}${r.usage.completion_tokens} token · ${r.usage.seconds.toFixed(1)} giây${r.finishReason === 'abort' ? ' · đã dừng' : r.finishReason === 'length' ? ' · chạm giới hạn token' : ''}`;
    if (r.finishReason === 'abort') reply.content = (reply.content ? reply.content + '\n\n' : '') + `_Đã dừng${r.stoppedBy ? ' (' + r.stoppedBy + ')' : ''}._`;
  } catch (err) {
    reply.error = true; reply.content = (reply.content ? reply.content + '\n\n' : '') + '⚠ ' + cleanErr(err.message);
    $('#genStats').textContent = '';
  } finally {
    setPhase('done'); setTimeout(() => { if (!state.generating) setPhase(null); }, 4000);
    offTok(); offStep(); offSt(); state.generating = null; $('#sendBtn').hidden = false; $('#stopBtn').hidden = true;
    conv.updatedAt = Date.now(); await A.saveConvo(conv); await loadConvos(); renderMessages();
    if (reply.steps.some(x => x.name === 'save_memory' && x.status === 'ok')) refreshMemCount();
    if (reply.steps.some(x => x.name === 'create_reminder' && x.status === 'ok')) refreshSchedCount();
  }
}

// --- Hộp thoại xác nhận (xoá / ghi đè tệp, xoá lịch) ---
const modalQueue = []; let modalOpen = null;
function modalAsk(o) { return new Promise((resolve) => { modalQueue.push({ ...o, resolve }); nextModal(); }); }
function nextModal() {
  if (modalOpen || !modalQueue.length) return;
  const o = modalOpen = modalQueue.shift();
  $('#cfIcon').textContent = o.icon || (o.kind === 'delete' ? '🗑' : o.kind === 'overwrite' ? '✍️' : '❓');
  $('#cfTitle').textContent = o.title; $('#cfMsg').textContent = o.message;
  $('#cfPath').textContent = o.path || ''; $('#cfPath').hidden = !o.path;
  $('#cfPreview').textContent = o.preview || ''; $('#cfPreview').hidden = !o.preview;
  $('#cfYes').textContent = o.okLabel || 'Đồng ý'; $('#cfNo').textContent = o.noLabel || (o.path ? 'Không, giữ nguyên tệp' : 'Huỷ');
  $('#confirmModal').querySelector('.from-agent').hidden = !o.fromAgent;
  $('#confirmModal').hidden = false; $('#cfNo').focus();
}
function closeModal(ok) { const o = modalOpen; if (!o) return; modalOpen = null; $('#confirmModal').hidden = true; o.resolve(ok); nextModal(); }
$('#cfYes').addEventListener('click', () => closeModal(true));
$('#cfNo').addEventListener('click', () => closeModal(false));
$('#confirmModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeModal(false); } });
$('#confirmModal').addEventListener('click', (e) => { if (e.target.id === 'confirmModal') closeModal(false); });
A.onAgentConfirm(async (req) => { const ok = await modalAsk({ ...req, fromAgent: true }); A.agentConfirmReply({ id: req.id, ok }); });
A.onAgentConfirmCancel(({ id }) => { if (modalOpen && modalOpen.id === id) closeModal(false); const i = modalQueue.findIndex(x => x.id === id); if (i >= 0) modalQueue.splice(i, 1)[0].resolve(false); });

// --- Thẻ xin phép chung (0.15.0): Cho phép (Ctrl+Enter) / Từ chối (Esc) / Từ chối kèm lý do / Luôn cho phép ---
const apQueue = []; let apOpen = null;
function setPhase(ph) {
  const el = $('#phaseStrip'); if (!el) return;
  if (!ph || !isAgent()) { el.hidden = true; return; }
  el.hidden = false; const order = ['think', 'ask', 'act', 'done']; const k = order.indexOf(ph);
  el.querySelectorAll('span').forEach(sp => { const i = order.indexOf(sp.dataset.ph); sp.classList.toggle('on', i === k); sp.classList.toggle('done', ph === 'done' ? i < k : false); });
}
function apShow() {
  if (apOpen || !apQueue.length) return;
  const c = apOpen = apQueue.shift();
  const card = $('#approveCard'); card.classList.toggle('danger', !!c.danger);
  $('#apIcon').textContent = c.icon || '🔧'; $('#apTitle').textContent = c.title || 'AIVN AGENT xin phép';
  $('#apSub').textContent = `Công cụ: ${c.label || c.tool}${c.path ? ' · ' + c.path : ''}`;
  $('#apFields').innerHTML = (c.fields || []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  $('#apPreview').hidden = !c.preview; $('#apPreview').textContent = c.preview || '';
  $('#apDiff').hidden = !c.diff;
  $('#apDiff').innerHTML = c.diff ? c.diff.text.split('\n').map(l => { const k = l.startsWith('+ ') ? 'add' : l.startsWith('- ') ? 'del' : 'ctx'; return `<span class="${k}"><i class="g" aria-label="${k === 'add' ? 'thêm' : k === 'del' ? 'bỏ' : ''}">${k === 'add' ? '+' : k === 'del' ? '−' : ' '}</i>${esc(k === 'ctx' ? l.replace(/^ {2}/, '') : l.slice(2)) || ' '}</span>`; }).join('') : '';
  $('#apReasonBox').hidden = true; $('#apReason').value = '';
  $('#apAlwaysRow').hidden = !c.allowAlways; $('#apAlways').checked = false; $('#apWarn').hidden = true; // không bao giờ bật sẵn
  card.hidden = false; setPhase('ask');
  $('#apDeny').focus({ preventScroll: true }); card.scrollTop = 0;
  card.scrollIntoView({ block: 'nearest' });
}
function apAnswer(ok, withReason = false) {
  const c = apOpen; if (!c) return;
  const reason = withReason ? $('#apReason').value.trim() : '';
  const always = ok && c.allowAlways && $('#apAlways').checked;
  apOpen = null; $('#approveCard').hidden = true; setPhase(ok ? 'act' : 'think');
  A.agentApproveReply({ id: c.id, ok, reason, always });
  if (always) toast(`Đã chọn “Luôn cho phép” cho ${c.label || c.tool}. Bỏ trong Cài đặt AIVN AGENT.`);
  apShow();
}
$('#apAllow').addEventListener('click', () => apAnswer(true));
$('#apDeny').addEventListener('click', () => { if (!$('#apReasonBox').hidden && $('#apReason').value.trim()) apAnswer(false, true); else apAnswer(false); });
$('#apDenyReason').addEventListener('click', () => {
  if ($('#apReasonBox').hidden) { $('#apReasonBox').hidden = false; $('#apReason').focus(); $('#apDenyReason').textContent = 'Gửi lý do & từ chối'; return; }
  apAnswer(false, true); $('#apDenyReason').textContent = 'Từ chối kèm lý do';
});
$('#apAlways').addEventListener('change', (e) => { const c = apOpen; $('#apWarn').hidden = !e.target.checked; $('#apWarn').textContent = '⚠ ' + ((c && c.warn) || 'AIVN AGENT sẽ dùng công cụ này mà không hỏi lại.') + ' Bạn có thể bỏ trong Cài đặt AIVN AGENT.'; });
document.addEventListener('keydown', (e) => {
  if (!apOpen) return;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apAnswer(true); }
  else if (e.key === 'Escape') { e.preventDefault(); if (!$('#apReasonBox').hidden && document.activeElement === $('#apReason') && $('#apReason').value.trim()) apAnswer(false, true); else apAnswer(false); }
}, true);
A.onAgentApprove((c) => { apQueue.push(c); apShow(); });
A.onAgentApproveCancel(({ id }) => { if (apOpen && apOpen.id === id) { apOpen = null; $('#approveCard').hidden = true; apShow(); } const i = apQueue.findIndex(x => x.id === id); if (i >= 0) apQueue.splice(i, 1); });

if (A.onNotice) A.onNotice((n) => toast((n.kind === 'warn' ? '⚠ ' : '') + n.text, n.kind === 'warn'));

// --- Kinh doanh → Khách hàng (CRM) --- 0.15.1: ẩn cho tới khi bộ Kinh doanh hoàn chỉnh ra mắt ở 0.16.0 (bật xem trước: localStorage aivn.crmPreview=1)
const CRM_ON = localStorage.getItem('aivn.crmPreview') === '1' || !!(A.qaMode && A.qaCrm);
$$('[data-crm-nav]').forEach(el => { el.hidden = !CRM_ON; });
const crm = { tab: 'dash', contacts: [] };
const vnd = (n) => (Number(n) || 0).toLocaleString('vi-VN') + ' đ';
async function C(fn, ...a) { const r = await A.crm(fn, ...a); if (!r.ok) throw new Error(r.error); return r.data; }
async function renderCrm() {
  $$('.crm-tabs button').forEach(b => b.classList.toggle('on', b.dataset.crm === crm.tab));
  const q = $('#crmQ').value.trim(); const body = $('#crmBody');
  $('#crmAdd').textContent = crm.tab === 'leads' ? '＋ Cơ hội' : crm.tab === 'acts' ? '＋ Việc' : '＋ Liên hệ';
  try {
    if (crm.tab === 'dash') {
      const d = await C('dashboard');
      body.innerHTML = `<div class="kpis"><div class="kpi">Cơ hội đang mở<b>${d.open.n}</b><span class="small muted">${vnd(d.open.sum)} · dự kiến ${vnd(d.open.weighted)}</span></div><div class="kpi">Thắng trong tháng<b>${d.wonMonth.n}</b><span class="small muted">${vnd(d.wonMonth.sum)}</span></div><div class="kpi">Tỉ lệ thắng<b>${d.winRate == null ? '—' : Math.round(d.winRate) + '%'}</b><span class="small muted">90 ngày: ${d.winRate90 == null ? '—' : Math.round(d.winRate90) + '%'}</span></div><div class="kpi">Việc cần làm<b>${d.activities.open}</b><span class="small muted">${d.activities.overdue} quá hạn · ${d.activities.today} hôm nay</span></div></div>
        <h3>Theo giai đoạn</h3><table class="crm-table"><tr><th>Giai đoạn</th><th>Số cơ hội</th><th>Giá trị</th></tr>${d.byStage.map(x => `<tr><td>${esc(x.name)}</td><td>${x.n}</td><td>${vnd(x.sum)}</td></tr>`).join('')}</table>
        <h3>Sắp tới</h3>${(d.upcoming || []).length ? `<table class="crm-table">${d.upcoming.map(a => `<tr><td>${esc(a.type_vi || '')}</td><td>${esc(a.title)}</td><td>${esc(a.contact_name || '')}</td><td>${a.due_at ? new Date(a.due_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : 'chưa hẹn giờ'}</td></tr>`).join('')}</table>` : '<div class="empty-state"><div class="big">📅</div>Chưa có việc nào sắp tới.</div>'}`;
    } else if (crm.tab === 'contacts') {
      const r = await C('listContacts', { q }); crm.contacts = r.rows;
      body.innerHTML = r.rows.length ? `<table class="crm-table"><tr><th>Tên</th><th>Loại</th><th>Điện thoại</th><th>Email</th><th>Thẻ</th><th>Phụ trách</th><th></th></tr>${r.rows.map(c => `<tr><td><b>${esc(c.name)}</b>${c.job_title ? `<div class="small muted">${esc(c.job_title)}</div>` : ''}</td><td>${esc(c.kind_vi)}</td><td>${esc(c.phone_fmt || c.phone || '')}</td><td>${esc(c.email || '')}</td><td>${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</td><td>${esc(c.owner || '')}</td><td><button class="btn sm" data-crm-edit="${esc(c.id)}">Sửa</button> <button class="btn sm ghost" data-crm-del="${esc(c.id)}" title="Xoá liên hệ">🗑</button></td></tr>`).join('')}</table><p class="small muted">${r.total} liên hệ</p>`
        : `<div class="empty-state"><div class="big">👥</div>${q ? 'Không tìm thấy liên hệ phù hợp.' : 'Chưa có khách hàng nào. Bấm “＋ Liên hệ” hoặc “⬆ Nhập” từ tệp Excel/CSV.'}</div>`;
    } else if (crm.tab === 'leads') {
      const r = await C('listLeads', { q }); const rows = Array.isArray(r) ? r : r.rows || [];
      const ST = [['new', 'Mới'], ['contacted', 'Đã liên hệ'], ['quoted', 'Báo giá'], ['negotiation', 'Đàm phán'], ['won', 'Thắng'], ['lost', 'Thua']];
      body.innerHTML = `<div class="kanban">${ST.map(([id, n]) => { const col = rows.filter(l => l.stage === id); return `<div class="kcol" data-stage="${id}"><h4>${n}<span class="muted">${col.length}</span></h4>${col.map(l => `<div class="kcard" draggable="true" data-lead="${esc(l.id)}"><b>${esc(l.title)}</b><div class="small muted">${esc(l.contact_name || '')}</div><div class="small">${vnd(l.expected_revenue)} · ${l.probability}%</div></div>`).join('') || '<div class="small muted">Kéo thẻ vào đây</div>'}</div>`; }).join('')}</div>`;
    } else {
      const r = await C('listActivities', { status: 'open' });
      body.innerHTML = r.length ? `<table class="crm-table"><tr><th></th><th>Việc</th><th>Loại</th><th>Khách hàng</th><th>Hạn</th></tr>${r.map(a => `<tr><td><input type="checkbox" data-crm-done="${esc(a.id)}" aria-label="Đánh dấu xong"></td><td>${esc(a.title)}${a.overdue ? ' <span class="tag" style="color:#82071e">quá hạn</span>' : ''}</td><td>${esc(a.type_vi)}</td><td>${esc(a.contact_name || '')}</td><td>${a.due_at ? new Date(a.due_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td></tr>`).join('')}</table>` : '<div class="empty-state"><div class="big">✅</div>Không còn việc nào cần làm.</div>';
    }
  } catch (e) { body.innerHTML = `<div class="empty-state">⚠ ${esc(e.message)}</div>`; }
}
function crmForm(kind, data = {}) {
  const F = {
    contact: [['name', 'Họ tên / tên công ty *'], ['kind', 'Loại', [['person', 'Cá nhân'], ['company', 'Công ty']]], ['phone', 'Điện thoại'], ['email', 'Email'], ['job_title', 'Chức vụ'], ['address', 'Địa chỉ'], ['tax_id', 'Mã số thuế'], ['tags', 'Thẻ (cách nhau bởi dấu phẩy)'], ['notes', 'Ghi chú', 'area']],
    lead: [['title', 'Tên cơ hội *'], ['contact_id', 'Khách hàng', [['', '—'], ...crm.contacts.map(c => [c.id, c.name])]], ['expected_revenue', 'Giá trị dự kiến (đ)'], ['stage', 'Giai đoạn', [['new', 'Mới'], ['contacted', 'Đã liên hệ'], ['quoted', 'Báo giá'], ['negotiation', 'Đàm phán'], ['won', 'Thắng'], ['lost', 'Thua']]], ['close_date', 'Ngày dự kiến chốt (YYYY-MM-DD)'], ['notes', 'Ghi chú', 'area']],
    act: [['title', 'Việc cần làm *'], ['type', 'Loại', [['call', 'Gọi điện'], ['meeting', 'Cuộc hẹn'], ['email', 'Email'], ['todo', 'Việc cần làm']]], ['contact_id', 'Khách hàng', [['', '—'], ...crm.contacts.map(c => [c.id, c.name])]], ['due_at', 'Hạn', 'datetime'], ['notes', 'Ghi chú', 'area']]
  }[kind];
  $('#crmFormTitle').textContent = (data.id ? 'Sửa ' : 'Thêm ') + ({ contact: 'liên hệ', lead: 'cơ hội', act: 'việc cần làm' })[kind];
  $('#crmFields').innerHTML = F.map(([k, l, t]) => `<label>${esc(l)}${Array.isArray(t) ? `<select name="${k}">${t.map(([v, n]) => `<option value="${esc(v)}" ${String(data[k] ?? '') === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : t === 'area' ? `<textarea name="${k}" rows="3">${esc(data[k] || '')}</textarea>` : `<input name="${k}" type="${t === 'datetime' ? 'datetime-local' : 'text'}" value="${esc(Array.isArray(data[k]) ? data[k].join(', ') : data[k] ?? '')}">`}</label>`).join('');
  $('#crmErr').textContent = ''; $('#crmModal').hidden = false; $('#crmForm').dataset.kind = kind; $('#crmForm').dataset.id = data.id || '';
  $('#crmFields').querySelector('input,select').focus();
}
$('#crmForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target; const o = Object.fromEntries(new FormData(f).entries()); if (f.dataset.id) o.id = f.dataset.id;
  try { await C({ contact: 'saveContact', lead: 'saveLead', act: 'saveActivity' }[f.dataset.kind], o); $('#crmModal').hidden = true; toast('Đã lưu ✓'); renderCrm(); }
  catch (err) { $('#crmErr').textContent = err.message; }
});
$('#crmCancel').addEventListener('click', () => { $('#crmModal').hidden = true; });
$('#crmModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#crmModal').hidden = true; });
$$('.crm-tabs button').forEach(b => b.addEventListener('click', () => { crm.tab = b.dataset.crm; renderCrm(); }));
let crmT = null; $('#crmQ').addEventListener('input', () => { clearTimeout(crmT); crmT = setTimeout(() => { if (crm.tab === 'dash') crm.tab = 'contacts'; renderCrm(); }, 220); });
$('#crmAdd').addEventListener('click', async () => { if (!crm.contacts.length) crm.contacts = (await C('listContacts', {}).catch(() => ({ rows: [] }))).rows; crmForm(crm.tab === 'leads' ? 'lead' : crm.tab === 'acts' ? 'act' : 'contact'); });
$('#crmExport').addEventListener('click', async () => { const r = await A.crmExport(); if (r.ok) toast('Đã xuất ' + r.file); else if (!r.canceled) toast('⚠ ' + r.error, true); });
$('#crmImport').addEventListener('click', async () => { const r = await A.crmImport(); if (r.ok) { toast(`Đã nhập: ${r.result.created} mới, ${r.result.merged} gộp, ${r.result.skipped} bỏ qua${r.result.errors.length ? `, ${r.result.errors.length} lỗi` : ''}`); crm.tab = 'contacts'; renderCrm(); } else if (!r.canceled) toast('⚠ ' + r.error, true); });
$('#crmBody').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-crm-edit]'); const del = e.target.closest('[data-crm-del]'); const lead = e.target.closest('[data-lead]');
  if (ed) crmForm('contact', crm.contacts.find(c => c.id === ed.dataset.crmEdit) || {});
  if (del && await modalAsk({ icon: '🗑', title: 'Xoá liên hệ?', message: 'Liên hệ và lịch sử liên quan sẽ bị xoá khỏi máy này.', okLabel: 'Xoá', noLabel: 'Giữ lại' })) { await C('deleteContact', del.dataset.crmDel).catch(err => toast(err.message, true)); renderCrm(); }
  if (lead && !e.defaultPrevented) { const rows = await C('listLeads', {}); const all = Array.isArray(rows) ? rows : rows.rows; if (!crm.contacts.length) crm.contacts = (await C('listContacts', {})).rows; crmForm('lead', all.find(l => l.id === lead.dataset.lead) || {}); }
});
$('#crmBody').addEventListener('change', async (e) => { const d = e.target.closest('[data-crm-done]'); if (d) { await C('completeActivity', d.dataset.crmDone).catch(err => toast(err.message, true)); toast('Đã xong ✓'); renderCrm(); } });
$('#crmBody').addEventListener('dragstart', (e) => { const c = e.target.closest('[data-lead]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.lead); c.classList.add('drag'); } });
$('#crmBody').addEventListener('dragover', (e) => { const col = e.target.closest('.kcol'); if (col) { e.preventDefault(); $$('.kcol').forEach(k => k.classList.toggle('over', k === col)); } });
$('#crmBody').addEventListener('drop', async (e) => { const col = e.target.closest('.kcol'); if (!col) return; e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); await C('moveLead', id, col.dataset.stage).catch(err => toast(err.message, true)); renderCrm(); });

// --- UX 0.15.0: bảng lệnh Ctrl+K, ẩn/hiện bảng phải, phím tắt, giới thiệu nhanh ---
// Bảng cài đặt bên phải: người dùng bấm thì nhớ lựa chọn; chưa bấm lần nào thì tự ẩn khi cửa sổ hẹp (< 1100 px) như LM Studio
function togglePanel(force, save = true) {
  const v = $('#view-chat'); const off = typeof force === 'boolean' ? force : !v.classList.contains('no-panel');
  v.classList.toggle('no-panel', off); if (save) localStorage.setItem('aivn.noPanel', off ? '1' : '0');
  $('#panelToggle').textContent = off ? '⇤ Hiện bảng cài đặt' : '⇥ Ẩn bảng cài đặt';
}
const autoPanel = () => { const p = localStorage.getItem('aivn.noPanel'); togglePanel(p === null ? innerWidth < 1100 : p === '1', false); };
autoPanel(); window.addEventListener('resize', () => { if (localStorage.getItem('aivn.noPanel') === null) autoPanel(); });
$('#panelToggle').addEventListener('click', () => togglePanel());
const openKeys = () => { $('#keysModal').hidden = false; $('#keysClose').focus(); };
$('#helpKeys').addEventListener('click', openKeys);
$('#keysClose').addEventListener('click', () => { $('#keysModal').hidden = true; });
$('#keysModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#keysModal').hidden = true; });
function paletteCommands() {
  const cmds = [
    { i: '💬', t: 'Trò chuyện thường', k: 'Ctrl+1', run: () => show('chat') },
    { i: '🤖', t: 'AIVN AGENT', run: () => show('agent') },
    { i: '＋', t: 'Cuộc trò chuyện mới', k: 'Ctrl+N', run: () => $('#newChat').click() },
    { i: '🔎', t: 'Khám phá (tìm và tải mô hình)', k: 'Ctrl+4', run: () => show('discover') },
    ...(CRM_ON ? [{ i: '👥', t: 'Kinh doanh → Khách hàng', run: () => show('crm') }] : []),
    { i: '📦', t: 'Mô hình của tôi', k: 'Ctrl+3', run: () => show('models') },
    { i: '⏰', t: 'Lịch tự động', run: () => show('schedule') },
    { i: '🧠', t: 'Ghi nhớ', run: () => show('memory') },
    { i: '⚡', t: 'Nhà phát triển (máy chủ API)', k: 'Ctrl+2', run: () => show('server') },
    { i: '⚙', t: 'Cài đặt', k: 'Ctrl+,', run: () => show('settings') },
    { i: '🔐', t: 'Bảo mật & Quản trị', run: () => show('settings', { tab: 'security' }) },
    { i: '🖥', t: 'Phần cứng & bộ máy', run: () => show('settings', { tab: 'hardware' }) },
    { i: '⇤', t: 'Thu gọn / mở rộng thanh bên', k: 'Ctrl+B', run: () => toggleRail() },
    { i: '⏏', t: 'Chọn mô hình để nạp (tham số nạp)', k: 'Ctrl+L', run: () => openLoader() },
    { i: '🔌', t: 'Kết nối (MCP)', run: () => { show('agent'); togglePanel(false); $('#mcpBlock').open = true; refreshMcp(true); $('#mcpBlock').scrollIntoView({ block: 'start' }); } },
    { i: '⏱', t: 'Đo tốc độ mô hình đang nạp', run: () => { $('#perfSpeedBtn').scrollIntoView({ block: 'center' }); $('#perfSpeedBtn').click(); } },
    { i: '📏', t: 'Đo Điểm tác vụ (điều khiển máy)', run: () => { show('agent'); togglePanel(false); $('#benchBox').scrollIntoView({ block: 'center' }); } },
    { i: '⇥', t: 'Ẩn/hiện bảng cài đặt', k: 'Ctrl+.', run: () => togglePanel() },
    { i: '📋', t: 'Sao chép nhật ký', run: () => document.querySelector('[data-logs="copy"]').click() },
    { i: '⌨', t: 'Phím tắt', k: 'Ctrl+/', run: openKeys },
    { i: '🎓', t: 'Xem lại giới thiệu nhanh', run: () => startOnboard(true) }
  ];
  for (const m of (state.models || []).slice(0, 12)) cmds.push({ i: '▶', t: `Nạp mô hình: ${m.name || m.id}`, run: () => { $('#modelSelect').value = m.id; $('#modelSelect').dispatchEvent(new Event('change')); } });
  return cmds;
}
let palSel = 0, palItems = [];
const foldVi = (x) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
function paintPalette() {
  const q = foldVi($('#palQ').value.trim());
  palItems = paletteCommands().filter(c => !q || q.split(/\s+/).every(w => foldVi(c.t).includes(w)));
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  $('#palList').innerHTML = palItems.map((c, i) => `<div class="pal-item ${i === palSel ? 'sel' : ''}" role="option" data-pal="${i}"><span>${c.i}</span><span>${esc(c.t)}</span>${c.k ? `<span class="k">${c.k}</span>` : ''}</div>`).join('') || '<div class="pal-item">Không có lệnh phù hợp</div>';
}
function openPalette() { $('#palette').hidden = false; $('#palQ').value = ''; palSel = 0; paintPalette(); $('#palQ').focus(); }
function runPal(i) { const c = palItems[i]; $('#palette').hidden = true; if (c) c.run(); }
$('#paletteBtn').addEventListener('click', openPalette);
$('#palQ').addEventListener('input', () => { palSel = 0; paintPalette(); });
$('#palQ').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { palSel = Math.min(palItems.length - 1, palSel + 1); paintPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); paintPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') { runPal(palSel); e.preventDefault(); }
  else if (e.key === 'Escape') { $('#palette').hidden = true; }
});
$('#palList').addEventListener('click', (e) => { const it = e.target.closest('[data-pal]'); if (it) runPal(Number(it.dataset.pal)); });
$('#palette').addEventListener('click', (e) => { if (e.target.id === 'palette') $('#palette').hidden = true; });
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); $('#palette').hidden ? openPalette() : ($('#palette').hidden = true); }
  else if (mod && e.key === '.') { e.preventDefault(); togglePanel(); }
  else if (mod && e.key === '/') { e.preventDefault(); openKeys(); }
  else if (mod && (e.key === 'n' || e.key === 'N') && !e.shiftKey) { e.preventDefault(); $('#newChat').click(); }
  else if (mod && !e.shiftKey && !e.altKey && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); show({ 1: 'chat', 2: 'server', 3: 'models', 4: 'discover' }[e.key]); }
  else if (mod && e.key === ',') { e.preventDefault(); show('settings'); }
  else if (mod && (e.key === 'l' || e.key === 'L') && !e.shiftKey && !e.altKey) { e.preventDefault(); $('#loader').hidden ? openLoader() : closeLoader(); }
  else if (mod && (e.key === 'b' || e.key === 'B') && !e.shiftKey) { e.preventDefault(); toggleRail(); }
});
// Giới thiệu nhanh lần đầu (4 bước)
const OB = [
  { big: '🐉', h: 'Chào mừng đến với AIVN', p: 'Trợ lý AI chạy hoàn toàn trên máy bạn — không gửi dữ liệu ra ngoài. Làm quen trong 30 giây nhé.' },
  { big: '🗃', h: 'Bước 1: Tải một mô hình', p: 'Vào mục Khám phá. Gợi ý cho trò chuyện và công cụ: Qwen3 4B Instruct 2507 (hoặc Qwen3 8B nếu máy mạnh). Mô hình có nhãn ⭐ là lựa chọn AIVN đã kiểm chứng cho máy bạn.' },
  { big: '🤖', h: 'Bước 2: Dùng AIVN AGENT', p: 'AIVN AGENT đọc/ghi tệp trong thư mục bạn cho phép, mở ứng dụng, và (thử nghiệm) điều khiển chuột/bàn phím. Mỗi bước có tác động đều hiện thẻ xin phép: Ctrl+Enter để cho phép, Esc để từ chối.' },
  { big: '⌘', h: 'Bước 3: Phím tắt', p: 'Ctrl+K mở bảng lệnh để làm mọi thứ nhanh; Ctrl+. ẩn/hiện bảng cài đặt; Ctrl+/ xem tất cả phím tắt.' }
];
let obI = 0;
function paintOb() { const s = OB[obI]; $('#obStep').innerHTML = `<div class="big">${s.big}</div><h3 id="obTitle">${esc(s.h)}</h3><p>${esc(s.p)}</p>`; $('#obDots').innerHTML = OB.map((_, i) => `<span class="${i === obI ? 'on' : ''}"></span>`).join(''); $('#obNext').textContent = obI === OB.length - 1 ? 'Bắt đầu' : 'Tiếp'; }
function startOnboard(force) { if (!force && localStorage.getItem('aivn.onboarded')) return; obI = 0; paintOb(); $('#onboard').hidden = false; $('#obNext').focus(); }
const endOb = () => { $('#onboard').hidden = true; localStorage.setItem('aivn.onboarded', '1'); };
$('#obNext').addEventListener('click', () => { if (obI < OB.length - 1) { obI++; paintOb(); } else { endOb(); if (!(state.models || []).length) show('discover'); } });
$('#obSkip').addEventListener('click', endOb);
$('#onboard').addEventListener('keydown', (e) => { if (e.key === 'Escape') endOb(); });
setTimeout(() => { if (!navigator.webdriver && !A.qaMode) startOnboard(false); }, 1200);

// --- Hiệu năng (0.15.0) ---
async function paintPerf(pf) {
  try {
    const info = pf ? { profile: pf } : await A.perfInfo(); const p = info.profile;
    $('#perfTier').innerHTML = `Máy này: <b>${esc(p.tierLabel)}</b> (${esc(p.why)}). Đang dùng chế độ <b>${esc(p.effectiveLabel)}</b>${p.mode === 'auto' ? ' (tự chọn)' : ''}.`;
    $('#perfMode').value = p.mode || 'auto';
    $('#perfCfg').innerHTML = `<span title="Số luồng CPU dùng để suy luận">🧵 ${p.threads} luồng</span> · <span title="Độ dài ngữ cảnh mặc định khi nạp">📏 ngữ cảnh ${p.ctx}</span> · <span title="Số token xử lý mỗi lượt khi đọc câu hỏi">📦 lô ${p.batchSize}</span>${p.kvQuant ? ' · <span title="Nén bộ nhớ đệm ngữ cảnh q8_0">🗜 KV q8_0</span>' : ''}${p.idleUnloadMin ? ` · <span title="Tự gỡ mô hình khi không dùng">💤 gỡ sau ${p.idleUnloadMin} phút</span>` : ''}${p.uiLite ? ' · <span title="Tắt hiệu ứng, gộp cập nhật chữ">🪶 giao diện nhẹ</span>' : ''}`;
    $('#perfTips').innerHTML = (p.tips || []).map(t => `<li>${esc(t)}</li>`).join('');
    const runs = await A.perfRuns();
    $('#perfRuns').innerHTML = runs.length ? '<tr><th>Lúc</th><th>Mô hình</th><th>Chế độ</th><th>Chữ đầu</th><th>Tốc độ</th></tr>' + runs.slice(-6).reverse().map(r => `<tr><td>${new Date(r.at).toLocaleTimeString('vi-VN')}</td><td>${esc(String(r.model).slice(0, 28))}</td><td>${esc(r.modeLabel)}</td><td>${(r.ttftMs / 1000).toFixed(1)} giây</td><td><b>${r.tokPerSec}</b> token/giây</td></tr>`).join('') : '';
  } catch {}
}
$('#perfMode').addEventListener('change', async (e) => { state.settings = await A.setSettings({ perfMode: e.target.value }); toast('Chế độ hiệu năng mới áp dụng đầy đủ khi nạp lại mô hình.'); setTimeout(() => paintPerf(), 300); });
A.onPerfChanged((p) => paintPerf(p));
$('#perfSpeedBtn').addEventListener('click', async () => {
  const b = $('#perfSpeedBtn'); b.disabled = true; $('#perfSpeedMsg').textContent = 'Đang đo…';
  const r = await A.perfSpeed(); b.disabled = false;
  $('#perfSpeedMsg').textContent = r.ok ? `${r.tokPerSec} token/giây · chữ đầu sau ${(r.ttftMs / 1000).toFixed(1)} giây` : '⚠ ' + r.error;
  paintPerf();
});

// --- Kết nối (MCP) ---
let mcpState = { servers: [] };
function paintMcp(st) {
  if (st) mcpState = { ...mcpState, ...st };
  const list = mcpState.servers || [];
  const on = list.filter(x => x.state === 'on');
  $('#mcpSum').textContent = list.length ? `${on.length}/${list.length} máy chủ đang kết nối · ${on.reduce((a, x) => a + x.tools.length, 0)} công cụ` : 'chưa có máy chủ nào';
  if (typeof mcpState.enabled === 'boolean') $('#mcpMaster').checked = mcpState.enabled;
  const stLbl = { on: 'đang kết nối', off: 'đã tắt', starting: 'đang khởi động…', error: 'lỗi' };
  $('#mcpList').innerHTML = list.map(x => `<div class="mcp-srv"><div class="hd"><label class="check"><input type="checkbox" data-mcp-toggle="${esc(x.name)}" ${x.enabled ? 'checked' : ''}> <b>${esc(x.name)}</b></label><span class="st ${x.state}">${stLbl[x.state] || x.state}</span><span class="muted small">${esc(x.kind)} · ${esc(x.command).slice(0, 90)}</span><button type="button" class="btn sm" data-mcp-restart="${esc(x.name)}">Kết nối lại</button></div>
    ${x.error ? `<div class="small" style="color:#82071e">${esc(x.error)}</div>` : ''}
    ${x.tools.length ? `<div class="small muted">Công cụ: ${x.tools.map(t => `<code title="${esc(t.description)}">${esc(t.name)}</code>`).join(' ')}</div>` : ''}
    <details><summary class="small">Nhật ký máy chủ</summary><pre>${esc(x.logs.join('\n') || '(trống)')}</pre></details></div>`).join('') || '<div class="small muted">Chưa có máy chủ. Thêm nhanh bằng các nút ở trên hoặc sửa mcp.json.</div>';
  const b = $('#mcpBadges'); const shown = list.filter(x => x.enabled && (x.state === 'on' || x.state === 'error'));
  b.hidden = !(isAgent() && mcpState.enabled !== false && shown.length);
  b.innerHTML = shown.map(x => `<span class="${x.state === 'error' ? 'error' : ''}" title="${esc(x.state === 'error' ? x.error || '' : x.tools.map(t => t.name).join(', '))}">🔌 ${esc(x.name)}${x.state === 'on' ? ' · ' + x.tools.length : ' · lỗi'}</span>`).join('');
}
async function refreshMcp(withText = false) {
  const st = await A.mcpStatus(); mcpState = { servers: st.servers, enabled: st.enabled };
  if (withText || !$('#mcpJson').value) $('#mcpJson').value = st.text; $('#mcpFile').textContent = st.file;
  paintMcp();
}
A.onMcpChanged((servers) => { paintMcp({ servers }); });
$('#mcpBlock').addEventListener('toggle', () => { if ($('#mcpBlock').open) refreshMcp(true); });
$('#mcpMaster').addEventListener('change', async (e) => { await A.mcpMaster(e.target.checked); mcpState.enabled = e.target.checked; paintMcp(); refreshAgent(); });
$('#mcpSaveBtn').addEventListener('click', async () => {
  const r = await A.mcpSave($('#mcpJson').value);
  $('#mcpMsg').textContent = r.ok ? '✓ Đã lưu' : '⚠ ' + r.error; $('#mcpMsg').style.color = r.ok ? '' : '#82071e';
  if (r.ok) { for (const x of r.servers) if (x.enabled) A.mcpRestart(x.name); refreshMcp(true); }
});
$('#mcpBlock').addEventListener('click', async (e) => {
  const p = e.target.closest('[data-mcp-preset]'); const rs = e.target.closest('[data-mcp-restart]');
  if (p) { const r = await A.mcpPreset(p.dataset.mcpPreset); if (r.ok) { toast(`Đã thêm máy chủ “${r.name}” — đang kết nối (lần đầu có thể mất 30–60 giây để tải gói).`); refreshMcp(true); } else if (!r.canceled) toast('⚠ ' + r.error); }
  if (rs) { A.mcpRestart(rs.dataset.mcpRestart); }
});
$('#mcpBlock').addEventListener('change', async (e) => { const t = e.target.closest('[data-mcp-toggle]'); if (!t) return; await A.mcpToggle({ name: t.dataset.mcpToggle, on: t.checked }); refreshMcp(true); refreshAgent(); });

// --- Cài đặt AIVN AGENT ---
async function refreshAgent() {
  const info = state.agent = await A.agentInfo();
  $('#folderList').innerHTML = info.folders.length ? info.folders.map(f => `<div class="folder${f.exists ? '' : ' missing'}" title="${esc(f.path)}"><span>📁 ${esc(f.path)}</span>${f.exists ? '' : '<b class="small">không thấy</b>'}<button data-fopen="${esc(f.path)}" title="Mở thư mục">↗</button><button data-fdel="${esc(f.path)}" title="Bỏ quyền với thư mục này" aria-label="Bỏ thư mục">✕</button></div>`).join('')
    : '<div class="folder-empty">Chưa cho phép thư mục nào. AIVN AGENT sẽ không đọc hay ghi tệp.</div>';
  $('#agWeb').checked = info.web;
  $('#agPy').checked = info.python.enabled && info.python.available; $('#agPy').disabled = !info.python.available;
  $('#agPyNote').textContent = info.python.available ? `Python ${info.python.version} có trên máy. Chạy trong thư mục tạm, chặn mạng và tệp ngoài thư mục tạm, tối đa 10 giây (hạn chế, không cách ly tuyệt đối như JavaScript).` : 'Máy chưa có Python 3, nên chỉ chạy được JavaScript.';
  $('#agMem').checked = info.memory.enabled;
  $('#agMemNote').textContent = `Đang có ${info.memory.count} ghi nhớ · tìm ${info.memory.semantic ? 'theo ý nghĩa (BGE-M3)' : 'theo từ khoá (tải BGE-M3 để tìm theo ý nghĩa)'}.`;
  renderToolChips(info);
  paintAgentWarn(info.advice);
  paintComputer(info.computer);
  refreshMcp().catch(() => {});
  const al = info.alwaysAllow || []; $('#alwaysBox').hidden = !al.length;
  $('#alwaysList').innerHTML = al.map(t => `<span class="chip">${esc(t.label)}<button type="button" data-revoke="${esc(t.name)}" title="Bỏ Luôn cho phép" aria-label="Bỏ Luôn cho phép ${esc(t.label)}">×</button></span>`).join('');
  if (isAgent() && (!state.current || !state.current.messages.length) && !state.generating) renderMessages();
}
async function agentGateOk() {
  state.agent = await A.agentInfo(); const g = state.agent.gate;
  if (!g || g.ok || g.cloud) return true;
  if (g.code === 'none' && !g.best && !(g.recommended || []).length) return true; // để luồng nạp mô hình cũ chỉ đường
  paintAgentWarn(state.agent.advice); toast(g.code === 'none' ? 'Hãy chọn một mô hình dùng được cho AIVN AGENT' : `${g.modelName || 'Mô hình này'} chưa dùng được cho AIVN AGENT: ${g.reason}`, true);
  return false;
}
// Mô hình đang nạp không dùng được cho AIVN AGENT → chặn chạy, đưa nút chuyển một chạm sang mô hình tốt nhất
function agentGateHtml(g) {
  const sw = g.best ? `<button class="btn sm primary" data-switch="${esc(g.best.id)}">⇄ Chuyển sang ${esc(g.best.name)}</button>` : '';
  const recs = g.best ? '' : (g.recommended || []).map(r => `<button class="btn sm primary" data-rec="${esc(r.id)}" data-installed="${r.installed ? 1 : 0}">${r.installed ? 'Nạp' : '⬇ Tải'} ${esc(r.name)}${r.installed ? '' : ' (' + fmtBytes(r.size) + ')'}${r.slow ? ' · chạy chậm' : ''}</button>`).join(' ');
  const what = g.code === 'none' ? '🤖 Chưa nạp mô hình cho AIVN AGENT.' : `⛔ <b>${esc(g.modelName || 'Mô hình này')}</b> chưa dùng được cho AIVN AGENT: <b>${esc(g.reason)}</b>.`;
  return `<span class="agent-gate">${what} AIVN AGENT cần mô hình nhìn được màn hình, gọi công cụ ổn định và vừa máy. ${g.best ? 'Mô hình phù hợp nhất đã có trên máy:' : (g.recommended || []).length ? 'Gợi ý cho máy này:' : 'Chưa có mô hình nào làm được việc này mà vừa máy này — bạn vẫn dùng Trò chuyện bình thường.'}</span> ${sw}${recs}`;
}
// 0.16: mô hình dùng được nhưng chậm trên máy này (máy yếu, cho phép "Chạy chậm") hoặc đang tràn khỏi VRAM → cảnh báo, không chặn
function agentSlowHtml(g) {
  const b = g.spill && g.spill.better;
  const btn = b ? (b.installed ? `<button class="btn sm primary" data-switch="${esc(b.id)}">⇄ Chuyển sang ${esc(b.name)}</button>` : `<button class="btn sm primary" data-rec="${esc(b.id)}" data-installed="0">⬇ Tải ${esc(b.name)}</button>`) : '';
  const spill = g.spill ? `<b>${esc(g.modelName || 'Mô hình')}</b> đang tràn khỏi VRAM: chỉ ${g.spill.gpuLayers}/${g.spill.totalLayers} lớp chạy trên GPU, phần còn lại chạy bằng CPU nên mỗi bước sẽ chậm. ${b ? `Mô hình nhìn màn hình vừa trọn VRAM máy này: <b>${esc(b.name)}</b>.` : 'Đóng bớt ứng dụng dùng GPU (trò chơi, trình duyệt nhiều tab) rồi nạp lại có thể giúp.'}` : '';
  const slow = g.slow ? `<b>${esc(g.modelName || 'Mô hình')}</b>: ${esc(g.slowReason || 'chạy chậm trên máy này')} ${g.planNote ? ' ' + esc(g.planNote) : ''}${g.best && !g.best.slow ? ` Mô hình chạy mượt hơn trên máy này: <b>${esc(g.best.name)}</b>.` : ''}` : '';
  const btn2 = !btn && g.slow && g.best && !g.best.slow ? `<button class="btn sm primary" data-switch="${esc(g.best.id)}">⇄ Chuyển sang ${esc(g.best.name)}</button>` : !btn && g.slow && !g.best ? ((g.recommended || []).filter(r => !r.slow).slice(0, 1).map(r => `<button class="btn sm" data-rec="${esc(r.id)}" data-installed="${r.installed ? 1 : 0}">${r.installed ? 'Nạp' : '⬇ Tải'} ${esc(r.name)}${r.installed ? '' : ' (' + fmtBytes(r.size) + ')'}</button>`).join('')) : '';
  return `<span class="agent-slow">🐢 ${spill || slow}</span> ${btn}${btn2}`;
}
function paintAgentWarn(adv) {
  const w = $('#agentWarn');
  const rec = (adv && adv.recommended) || [];
  const recBtns = rec.map(r => `<button class="btn sm" data-rec="${esc(r.id)}" data-installed="${r.installed ? 1 : 0}">${r.installed ? 'Nạp' : 'Tải'} ${esc(r.name)}</button>`).join(' ');
  const g = state.agent && state.agent.gate;
  if (g && !g.cloud && !g.ok) { w.innerHTML = agentGateHtml(g); w.hidden = false; return; }
  if (g && g.cloud && g.cloudInfo) { const c = g.cloudInfo; w.innerHTML = `<span>☁️ AIVN AGENT đang dùng bộ não đám mây <b>${esc(c.model)}</b> (${esc(c.host)}). Yêu cầu, kết quả công cụ và chữ đọc được trên màn hình được gửi tới máy chủ này; ảnh chụp màn hình thì không. ${c.eyes ? 'Mắt nhìn màn hình: mô hình trên máy.' : 'Chưa nạp mô hình nhìn ảnh trên máy nên AIVN AGENT chưa điều khiển màn hình được.'}</span>`; w.hidden = false; return; }
  if (!state.status.loaded) { const r0 = g && (g.best || (g.recommended || [])[0]); w.innerHTML = `<span>🤖 Hãy nạp một mô hình ở thanh phía trên. AIVN AGENT cần mô hình nhìn được màn hình và gọi công cụ ổn định${r0 ? `, gợi ý cho máy này: <b>${esc(r0.name)}</b>` : ''}.</span>`; w.hidden = false; return; }
  if (g && g.ok && !g.cloud && (g.slow || g.spill)) { w.innerHTML = agentSlowHtml(g); w.hidden = false; return; }
  if (g && g.ok) { w.hidden = true; return; } // mô hình đã qua kiểm tra AIVN AGENT: không cần các cảnh báo cũ
  if (adv && adv.tools && adv.tools.level !== 'good') { w.innerHTML = `<span>🛠 <b>${esc(adv.model)}</b>: hỗ trợ công cụ <b>${esc(adv.tools.label)}</b>. ${adv.tools.level === 'none' ? 'AIVN AGENT gần như không thao tác được với mô hình này.' : 'AIVN dùng giao thức công cụ dạng văn bản; mô hình có thể bỏ bước hoặc không gọi công cụ.'} Để AIVN AGENT làm việc đáng tin cậy, hãy chọn mô hình được đánh dấu dùng được cho AIVN AGENT trong bộ chọn mô hình.</span> ${recBtns}`; w.hidden = false; return; }
  if (adv && adv.small) { w.innerHTML = `<span>⚠ <b>${esc(adv.model)}</b>${adv.params ? ` (khoảng ${String(adv.params).replace('.', ',')} tỉ tham số)` : ''} khá nhỏ cho AIVN AGENT: có thể gọi sai công cụ, bỏ bước hoặc nói đã làm khi chưa làm. Nên chọn mô hình mạnh hơn được đánh dấu dùng được cho AIVN AGENT.</span> ${recBtns}`; w.hidden = false; return; }
  if (adv && adv.eyes && adv.eyes.needed) {
    const r = adv.eyes.rec; const busy = adv.eyes.pending && jobs && [...jobs.values()].some(j => j.catalogId === adv.eyes.pending && j.status !== 'done');
    w.innerHTML = `<span>👁 <b>Điều khiển màn hình cần mắt nhìn.</b> <b>${esc(adv.model)}</b> chỉ đọc chữ, không nhìn được màn hình — Zalo và các ứng dụng Electron gần như không cho đọc nút/ô, nên AIVN AGENT sẽ bấm nhầm hoặc báo “không tìm thấy”. ${r ? `Nạp thêm <b>${esc(r.name)}</b> (${fmtBytes(r.size)}): AIVN tự dùng nó để nhìn ảnh chụp mỗi bước.` : ''}</span> ${r ? `<button class="btn sm primary" data-eyes="${esc(r.id)}" ${busy ? 'disabled' : ''}>${busy ? 'Đang tải mắt nhìn…' : r.installed ? '👁 Nạp thêm mắt nhìn' : '👁 Tải & nạp thêm mắt nhìn'}</button>` : ''}`;
    w.hidden = false; return;
  }
  w.hidden = true;
}
$('#agentWarn').addEventListener('click', async (e) => {
  const sw = e.target.closest('[data-switch]');
  if (sw) { sw.disabled = true; sw.textContent = 'Đang chuyển…'; if (state.status.loaded) await A.unloadModel(); await loadModel(sw.dataset.switch); await refreshAgent(); return; }
  const ey = e.target.closest('[data-eyes]');
  if (ey) { ey.disabled = true; try { const r = await A.agentEyes(ey.dataset.eyes); if (r.installed) toast(`Đã bật mắt nhìn: ${r.name} ✓`); else { if (r.job) paintJob(r.job); toast(`Đang tải ${r.name}. Tải xong AIVN tự dùng làm mắt nhìn.`); } } catch (err) { toast(cleanErr(err.message), true); ey.disabled = false; } refreshAgent(); return; }
  const b = e.target.closest('[data-rec]'); if (!b) return;
  if (b.dataset.installed === '1') { const c = state.catalog.find(x => x.id === b.dataset.rec) || (await A.catalog()).find(x => x.id === b.dataset.rec); await refreshModels(); const m = state.models.find(x => c && x.file.toLowerCase() === c.file.toLowerCase()); if (m) loadModel(m.id); }
  else { show('discover'); try { const j = await A.dlStart({ catalogId: b.dataset.rec }); paintJob(j); toast('Đang tải mô hình cho AIVN AGENT, xem tiến độ ở mục Đang tải'); } catch (err) { toast(cleanErr(err.message), true); } }
});
$('#addFolder').addEventListener('click', async () => { state.agent = await A.agentAddFolder(); refreshAgent(); });
$('#folderList').addEventListener('click', async (e) => {
  const d = e.target.closest('[data-fdel]'); if (d) { await A.agentRemoveFolder(d.dataset.fdel); refreshAgent(); return; }
  const o = e.target.closest('[data-fopen]'); if (o) A.agentOpenFolder(o.dataset.fopen);
});
const saveAgentSetting = async (patch) => { state.settings = await A.setSettings(patch); refreshAgent(); };
$('#agWeb').addEventListener('change', (e) => saveAgentSetting({ agentWeb: e.target.checked }));
$('#agPy').addEventListener('change', (e) => saveAgentSetting({ agentPython: e.target.checked }));
$('#agMem').addEventListener('change', (e) => saveAgentSetting({ agentMemory: e.target.checked }));

// --- Lịch tự động ---
const DAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const sf = { kind: 'reminder', repeat: 'once', days: new Set([1]), editing: null };
const p2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const fmtWhen = (ts) => { if (!ts) return '—'; const d = new Date(ts), now = new Date(); const t = `${p2(d.getHours())}:${p2(d.getMinutes())}`; const dd = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5); return dd === 0 ? `${t} hôm nay` : dd === 1 ? `${t} ngày mai` : dd === -1 ? `${t} hôm qua` : `${t} ${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; };
function paintForm() {
  $$('#sfKind button').forEach(b => b.classList.toggle('on', b.dataset.kind === sf.kind));
  $$('#sfRepeat button').forEach(b => b.classList.toggle('on', b.dataset.rep === sf.repeat));
  $$('#sfDays button').forEach(b => b.classList.toggle('on', sf.days.has(Number(b.dataset.d))));
  $('#sfMsgWrap').hidden = sf.kind !== 'reminder'; $('#sfPromptWrap').hidden = sf.kind !== 'agent';
  $('#sfDateWrap').hidden = sf.repeat !== 'once'; $('#sfDays').hidden = sf.repeat !== 'weekly';
  $('#schedFormTitle').textContent = sf.editing ? 'Sửa lịch' : 'Tạo lịch mới'; $('#sfCancel').hidden = !sf.editing;
}
function resetForm() {
  sf.editing = null; sf.kind = 'reminder'; sf.repeat = 'once'; sf.days = new Set([new Date().getDay()]);
  const d = new Date(Date.now() + 10 * 60e3); $('#sfTitle').value = ''; $('#sfMsg').value = ''; $('#sfPrompt').value = '';
  $('#sfDate').value = dateStr(d); $('#sfTime').value = `${p2(d.getHours())}:${p2(d.getMinutes())}`; paintForm();
}
$('#sfKind').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) { sf.kind = b.dataset.kind; paintForm(); } });
$('#sfRepeat').addEventListener('click', (e) => { const b = e.target.closest('[data-rep]'); if (b) { sf.repeat = b.dataset.rep; paintForm(); } });
$('#sfDays').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; const d = Number(b.dataset.d); sf.days.has(d) ? sf.days.delete(d) : sf.days.add(d); paintForm(); });
$('#sfCancel').addEventListener('click', resetForm);
$('#schedForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const spec = { title: $('#sfTitle').value, kind: sf.kind, message: $('#sfMsg').value, prompt: $('#sfPrompt').value, repeat: sf.repeat, time: $('#sfTime').value, days: [...sf.days] };
  if (sf.repeat === 'once') { const [y, m, d] = ($('#sfDate').value || '').split('-').map(Number); const [h, mi] = ($('#sfTime').value || '').split(':').map(Number); spec.at = new Date(y, m - 1, d, h, mi, 0, 0).getTime(); }
  try { sf.editing ? await A.schedUpdate({ id: sf.editing, ...spec }) : await A.schedCreate(spec); toast(sf.editing ? 'Đã lưu thay đổi ✓' : 'Đã tạo lịch ✓'); resetForm(); refreshSched(); }
  catch (err) { toast(cleanErr(err.message), true); }
});
async function refreshSched() {
  const list = await A.schedList();
  $('#schedNow').textContent = 'Bây giờ: ' + new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long', day: '2-digit', month: '2-digit' });
  $('#schedList').innerHTML = list.length ? list.map(t => { const last = (t.runs || [])[0];
    return `<div class="sched-item${t.enabled ? '' : ' off'}" data-id="${esc(t.id)}"><div class="ic">${t.kind === 'agent' ? '🤖' : '🔔'}</div>
      <div><h4>${esc(t.title)}</h4><div class="meta">${esc(t.schedule)}${t.enabled && t.nextRun ? ` · lần tới <b>${fmtWhen(t.nextRun)}</b>` : t.enabled ? '' : t.repeat === 'once' && t.lastRun ? ' · đã chạy xong' : ' · đang tắt'}${t.running ? ' · <b>đang chạy…</b>' : ''}</div>
      ${t.kind === 'agent' ? `<div class="meta">“${esc(t.prompt.slice(0, 110))}${t.prompt.length > 110 ? '…' : ''}”</div>` : t.message ? `<div class="meta">${esc(t.message.slice(0, 120))}</div>` : ''}
      ${last ? `<div class="last${last.ok ? '' : ' err'}">Lần chạy gần nhất: ${fmtWhen(last.at)}${last.late ? ' (chạy bù)' : ''} · ${last.ok ? 'thành công' : 'lỗi: ' + esc(last.error || '')}</div>` : ''}</div>
      <div class="acts">${last && last.convoId ? `<button class="btn sm" data-sact="open" data-cid="${esc(last.convoId)}">Xem kết quả</button>` : ''}<button class="btn sm" data-sact="run">▶ Chạy ngay</button><button class="btn sm" data-sact="toggle">${t.enabled ? 'Tắt' : 'Bật'}</button><button class="btn sm" data-sact="edit">Sửa</button><button class="btn sm danger" data-sact="del" title="Xoá lịch">🗑</button></div></div>`; }).join('')
    : '<div class="sched-empty">Chưa có lịch nào. Tạo lời nhắc ở khung bên trái, hoặc nhờ AIVN AGENT: “nhắc tôi 9 giờ sáng mai nộp bài”.</div>';
  refreshSchedCount(list);
  $('#bgTray').checked = !!state.settings.keepInTray; $('#bgLogin').checked = !!state.settings.openAtLogin;
}
async function refreshSchedCount(list) { list ||= await A.schedList(); const n = list.filter(t => t.enabled).length; $('#schedCount').hidden = !n; $('#schedCount').textContent = n; }
$('#schedList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sact]'); if (!b) return;
  const id = b.closest('.sched-item').dataset.id; const list = await A.schedList(); const t = list.find(x => x.id === id); if (!t) return;
  try {
    if (b.dataset.sact === 'run') { b.disabled = true; toast(`Đang chạy “${t.title}”…`); const r = await A.schedRun(id); toast(r && r.ok ? `Đã chạy “${t.title}” ✓ Kết quả lưu trong AIVN AGENT.` : `Lỗi: ${r && r.error}`, !(r && r.ok)); }
    if (b.dataset.sact === 'toggle') await A.schedUpdate({ id, enabled: !t.enabled, ...(t.repeat === 'once' && !t.enabled && t.at < Date.now() ? { at: Date.now() + 5 * 60e3 } : {}) });
    if (b.dataset.sact === 'del') { if (await modalAsk({ title: 'Xoá lịch?', message: `Xoá “${t.title}” khỏi Lịch tự động? Kết quả đã lưu trong AIVN AGENT vẫn được giữ.`, okLabel: 'Xoá lịch', icon: '⏰' })) await A.schedDelete(id); }
    if (b.dataset.sact === 'edit') {
      sf.editing = id; sf.kind = t.kind; sf.repeat = t.repeat; sf.days = new Set(t.days || []);
      $('#sfTitle').value = t.title; $('#sfMsg').value = t.message || ''; $('#sfPrompt').value = t.prompt || ''; $('#sfTime').value = t.time;
      if (t.at) $('#sfDate').value = dateStr(new Date(t.at)); paintForm(); $('#sfTitle').focus();
    }
    if (b.dataset.sact === 'open') openConvo(b.dataset.cid);
  } catch (err) { toast(cleanErr(err.message), true); }
  refreshSched();
});
$('#bgTray').addEventListener('change', async (e) => { state.settings = await A.setSettings({ keepInTray: e.target.checked }); toast(e.target.checked ? 'Đóng cửa sổ sẽ thu AIVN xuống khay, lịch vẫn chạy' : 'Đóng cửa sổ sẽ thoát AIVN'); });
$('#bgLogin').addEventListener('change', async (e) => { state.settings = await A.setSettings({ openAtLogin: e.target.checked }); });
$('#notifyTest').addEventListener('click', async () => { const r = await A.notifyTest(); if (r && !r.supported) toast('Hệ điều hành này chưa hỗ trợ thông báo cho AIVN', true); });
A.onSchedChanged(() => { if ($('#view-schedule').classList.contains('active')) refreshSched(); else refreshSchedCount(); });
async function openConvo(id) { await loadConvos(); const c = state.convos.find(x => x.id === id); if (!c) return; show(convoMode(c) === 'agent' ? 'agent' : 'chat'); state.current = c; renderConvos(); renderMessages(); }
A.onConvosChanged(async ({ id }) => { const was = state.current && state.current.id; await loadConvos(); if (was === id && !state.generating) { state.current = state.convos.find(c => c.id === id) || state.current; renderMessages(); } });
A.onConvosOpen(({ id }) => openConvo(id));

// --- Ghi nhớ ---
async function refreshMem() {
  const [list, info] = await Promise.all([A.memList(), A.agentInfo()]);
  $('#memOn').checked = info.memory.enabled;
  $('#memMode').textContent = `Những điều AIVN AGENT đã ghi nhớ về bạn (${list.length}). Chỉ lưu trên máy này. Điều liên quan tới câu hỏi được đưa vào lời nhắc của AIVN AGENT, tìm ${info.memory.semantic ? 'theo ý nghĩa bằng BGE-M3' : 'theo từ khoá (tải BGE-M3 trong Cài đặt trò chuyện để tìm theo ý nghĩa)'}.`;
  $('#memList').innerHTML = list.length ? list.map(m => `<div class="mem" data-id="${esc(m.id)}"><div class="txt">${esc(m.text)}<div class="meta">${m.source === 'user' ? 'Bạn thêm' : 'AIVN AGENT ghi nhớ'} · ${new Date(m.updatedAt).toLocaleString('vi-VN')}${m.uses ? ` · đã dùng ${m.uses} lần` : ''}</div></div><div class="acts"><button class="btn sm" data-mact="edit">Sửa</button><button class="btn sm danger" data-mact="del" title="Xoá ghi nhớ này">🗑</button></div></div>`).join('')
    : '<div class="sched-empty">Chưa có ghi nhớ nào. Hãy nói với AIVN AGENT, ví dụ: “Hãy nhớ: tôi thích uống cà phê sữa đá”.</div>';
  refreshMemCount(list);
}
async function refreshMemCount(list) { list ||= await A.memList(); $('#memCount').hidden = !list.length; $('#memCount').textContent = list.length; }
$('#memForm').addEventListener('submit', async (e) => { e.preventDefault(); const v = $('#memNew').value.trim(); if (!v) return; try { await A.memAdd(v); $('#memNew').value = ''; refreshMem(); } catch (err) { toast(cleanErr(err.message), true); } });
$('#memList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mact]'); if (!b) return;
  const row = b.closest('.mem'); const id = row.dataset.id;
  if (b.dataset.mact === 'del') { await A.memDelete(id); refreshMem(); return; }
  if (b.dataset.mact === 'edit') { const txt = row.querySelector('.txt').firstChild.textContent; row.innerHTML = `<textarea maxlength="500">${esc(txt)}</textarea><div class="acts"><button class="btn sm primary" data-mact="save">Lưu</button><button class="btn sm" data-mact="cancel">Huỷ</button></div>`; row.querySelector('textarea').focus(); return; }
  if (b.dataset.mact === 'save') { try { await A.memUpdate({ id, text: row.querySelector('textarea').value }); toast('Đã lưu ✓'); } catch (err) { toast(cleanErr(err.message), true); } refreshMem(); return; }
  if (b.dataset.mact === 'cancel') refreshMem();
});
$('#memClear').addEventListener('click', async () => { await A.memClear(); refreshMem(); });
$('#memOn').addEventListener('change', async (e) => { state.settings = await A.setSettings({ agentMemory: e.target.checked }); refreshMem(); });

// ---------- Truy cập máy tính (Cài đặt AIVN AGENT) ----------
function paintComputer(c) {
  if (!c) return;
  paintAuto(!!c.autonomy); A.cloudGet().then(paintCloud).catch(() => {});
  $('#agComp').checked = c.enabled; $('#agAutoRO').checked = c.autoReadOnly; $('#agAutoRO').disabled = !c.enabled;
  $('#agScreen').checked = c.screen;
  $('#agScreenNote').innerHTML = `AIVN AGENT tự mở ứng dụng và thao tác như bạn: đọc danh sách nút/ô của cửa sổ (Trợ năng của hệ điều hành) và chữ trên màn hình, bấm/gõ từng bước rồi kiểm tra lại. Cần <b>nhìn được màn hình</b>: dùng mô hình nhìn ảnh (Qwen3-VL) làm mô hình chính, hoặc mô hình chữ + mắt nhìn (AIVN tự nạp mô hình nhìn ảnh đã cài). Luôn hỏi trước khi gửi tin nhắn, thanh toán, xoá, nộp biểu mẫu; không bao giờ gõ mật khẩu. Dừng: <b>Esc</b>, <b>${esc(c.stopKey)}</b> hoặc nút “Dừng ngay”.`;
  $('#agGrounder').innerHTML = '<option value="">Không dùng — chỉ cây giao diện + đọc chữ</option>' + (c.grounders || []).map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join(''); $('#agGrounder').value = c.grounder || '';
  $('#agScreenOpts').hidden = !c.screen; $('#agScreenMode').value = c.screenMode || 'each'; $('#agScreenBudget').value = String(c.screenBudget || 40);
  paintBench();
  const g = $('#permGuide');
  if (c.platform === 'darwin' && c.screen) {
    const okS = c.perms.screen === 'granted', okA = c.perms.accessibility;
    g.innerHTML = `<b>Hướng dẫn cấp quyền macOS</b>
      <ol><li>Mở <b>Cài đặt hệ thống → Quyền riêng tư &amp; Bảo mật → Ghi màn hình</b>, bật <b>AIVN</b>. ${okS ? '✅' : '❌'} <button class="btn sm" data-perm="screen">Mở mục Ghi màn hình</button></li>
      <li>Vào <b>Trợ năng</b> (Accessibility), bật <b>AIVN</b> (bấm ＋ để thêm nếu chưa có). ${okA ? '✅' : '❌'} <button class="btn sm" data-perm="accessibility">Mở mục Trợ năng</button></li>
      <li>Thoát hẳn AIVN (⌘Q) rồi mở lại. Sau mỗi lần cập nhật AIVN, macOS có thể yêu cầu cấp lại.</li></ol>
      <button class="btn sm" data-perm="test">Kiểm tra lại</button>`;
    g.hidden = false;
  } else g.hidden = true;
}
async function paintBench() {
  const ms = (state.models || []).filter(m => !m.embedding && !/bge|embed/i.test(m.id));
  const cur = state.status && state.status.id;
  if (!$('#benchModel').dataset.busy) $('#benchModel').innerHTML = ms.map(m => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.name || m.id)}</option>`).join('') || '<option value="">(chưa có mô hình)</option>';
  const sc = await A.benchScores().catch(() => null); if (!sc) return;
  const rows = Object.entries(sc.local || {}).map(([id, b]) => `${(ms.find(m => m.id === id) || {}).name || id}: Điểm tác vụ ${b.score}/10 · an toàn ${b.safety === null ? '—' : b.safety ? 'đạt' : 'KHÔNG đạt'} · ${Math.round((b.seconds || 0) / 60)} phút · ${new Date(b.date).toLocaleDateString('vi-VN')}`);
  if (!$('#benchModel').dataset.busy) $('#benchRes').textContent = rows.length ? 'Kết quả trên máy này:\n' + rows.join('\n') : 'Chưa đo lần nào trên máy này.';
}
$('#benchRun').addEventListener('click', async () => {
  const id = $('#benchModel').value; if (!id) return;
  if (!(await modalAsk({ icon: '📏', title: 'Đo Điểm tác vụ?', message: 'AIVN AGENT sẽ tự điều khiển chuột/bàn phím trong cửa sổ thử “AIVN Bench” (và mở thử một ứng dụng soạn thảo) trong 10–40 phút. Bước quan trọng (gửi) sẽ tự bị từ chối. Đừng dùng máy trong lúc đo; nhấn Esc để dừng.', okLabel: 'Bắt đầu đo', noLabel: 'Để sau' }))) return;
  $('#benchModel').dataset.busy = '1'; $('#benchRun').hidden = true; $('#benchStop').hidden = false; $('#benchRes').textContent = 'Đang chuẩn bị…';
  const r = await A.benchRun({ ids: [id] });
  delete $('#benchModel').dataset.busy; $('#benchRun').hidden = false; $('#benchStop').hidden = true;
  if (!r.ok) { $('#benchRes').textContent = 'Không đo được: ' + r.error; return; }
  const b = r.results[id];
  if (b) { $('#benchRes').textContent = `Điểm tác vụ: ${b.score}/10${b.done < 10 ? ` (mới làm ${b.done}/10 việc — đã dừng)` : ''} · an toàn: ${b.safety === null ? '—' : b.safety ? 'đạt' : 'KHÔNG đạt'}\n` + b.tasks.map(t => `${t.pass ? '✔' : '✘'} ${t.label} · ${t.seconds} giây${t.timeout ? ' (hết giờ)' : ''}`).join('\n'); toast(`Điểm tác vụ: ${b.score}/10`); }
  if (!$('#sugArea').hidden) renderCatalog();
});
$('#benchStop').addEventListener('click', () => A.benchStop());
$('#alwaysList').addEventListener('click', async (e) => { const b = e.target.closest('[data-revoke]'); if (!b) return; await A.agentAlwaysRevoke(b.dataset.revoke); toast('AIVN AGENT sẽ hỏi lại trước khi dùng công cụ này.'); refreshAgent(); });
A.onBenchProgress((p) => { if ($('#benchModel').dataset.busy) $('#benchRes').textContent = `Đang đo ${p.i}/${p.n}: ${p.label}…`; });
$('#agComp').addEventListener('change', (e) => saveAgentSetting({ agentComputer: e.target.checked }));
// 0.16 bộ não đám mây: khoá API chỉ đi một chiều (giao diện → main), không bao giờ hiện lại
function paintCloud(c) {
  if (!c) return;
  if (document.activeElement !== $('#cloudUrl')) $('#cloudUrl').value = c.baseUrl || '';
  if (document.activeElement !== $('#cloudModel')) $('#cloudModel').value = c.model || '';
  $('#cloudCtx').value = String(c.ctx || 32768); $('#cloudOn').checked = !!c.on;
  $('#cloudKey').placeholder = c.keySet ? '•••••••• (đã lưu — dán khoá mới để thay)' : 'Dán khoá API';
  $('#cloudKeyNote').textContent = c.keySecure ? 'Khoá được mã hoá bằng kho khoá của hệ điều hành và không bao giờ hiện lại hay ghi vào nhật ký.' : 'Máy này không có kho khoá an toàn của hệ điều hành: khoá chỉ giữ trong bộ nhớ đến khi thoát AIVN (không ghi ra đĩa).';
  $('#cloudSum').textContent = c.on ? `· đang dùng ${c.model}` : c.keySet ? '· đã có khoá, đang tắt' : '';
}
async function cloudSave(extra = {}) {
  const key = $('#cloudKey').value; $('#cloudKey').value = '';
  const r = await A.cloudSave({ baseUrl: $('#cloudUrl').value, model: $('#cloudModel').value, ctx: Number($('#cloudCtx').value), ...(key ? { key } : {}), ...extra });
  paintCloud(r.cloud); $('#cloudMsg').textContent = r.ok ? (r.keyPersisted === false ? 'Đã lưu (khoá chỉ giữ trong phiên này).' : 'Đã lưu.') : r.error; $('#cloudMsg').className = 'small ' + (r.ok ? 'ok-ink' : 'warn-ink');
  refreshAgent(); return r;
}
$('#cloudSaveBtn').addEventListener('click', () => cloudSave());
$('#cloudOn').addEventListener('change', async (e) => {
  if (e.target.checked && !(await modalAsk({ icon: '☁️', title: 'Dùng bộ não đám mây?', message: `Yêu cầu của bạn, kết quả công cụ, nội dung tệp AIVN AGENT đọc và chữ đọc được trên màn hình sẽ được gửi tới ${$('#cloudUrl').value || 'máy chủ đã nhập'}. Ảnh chụp màn hình không gửi đi. Chi phí (nếu có) tính vào tài khoản của bạn ở nhà cung cấp đó.`, okLabel: 'Dùng', noLabel: 'Huỷ' }))) { e.target.checked = false; return; }
  const r = await cloudSave({ enabled: e.target.checked }); if (!r.ok) e.target.checked = false;
});
$('#cloudTestBtn').addEventListener('click', async () => {
  if ($('#cloudKey').value || $('#cloudUrl').value !== ((state.settings.cloudBrain || {}).baseUrl || '')) { const r0 = await cloudSave(); if (!r0.ok) return; }
  $('#cloudMsg').textContent = 'Đang kiểm tra…'; $('#cloudMsg').className = 'small';
  const r = await A.cloudTest();
  $('#cloudMsg').textContent = r.ok ? `Kết nối được (${(r.ms / 1000).toFixed(1).replace('.', ',')} giây). ${r.tools ? 'Mô hình gọi công cụ được ✓' : 'Mô hình KHÔNG gọi công cụ trong lần thử: AIVN AGENT có thể không làm được việc.'}` : r.error;
  $('#cloudMsg').className = 'small ' + (r.ok && r.tools ? 'ok-ink' : 'warn-ink');
});
$('#cloudClearBtn').addEventListener('click', async () => { paintCloud(await A.cloudClearKey()); $('#cloudMsg').textContent = 'Đã xoá khoá API và tắt bộ não đám mây.'; refreshAgent(); });
// 0.16 “Tự làm không hỏi”: công tắc ở Cài đặt AIVN AGENT + nút trên thanh AIVN AGENT, luôn khớp nhau
function paintAuto(on) { $('#agAuto').checked = on; $('#autoPill').setAttribute('aria-pressed', String(on)); $('#autoPillState').textContent = on ? 'bật' : 'tắt'; }
async function setAuto(on) {
  if (on && !(await modalAsk({ icon: '⚡', title: 'Bật “Tự làm không hỏi”?', message: 'AIVN AGENT sẽ tự bấm, gõ, ghi tệp mà không hỏi từng bước (vẫn hiện khung đỏ trước mỗi thao tác; dừng bằng Esc hoặc Ctrl+Alt+Q).\n\nVẫn LUÔN hỏi khi: gửi tin có nội dung khác lời bạn đã nêu, xoá thứ bạn chưa nêu tên, thanh toán/nộp, chạy lệnh terminal, mở tệp chạy được, thao tác hệ thống bạn không yêu cầu.', okLabel: 'Bật', noLabel: 'Huỷ' }))) { paintAuto(false); return; }
  paintAuto(on); if (state.agent && state.agent.computer) state.agent.computer.autonomy = on;
  await saveAgentSetting({ agentAutonomy: on }); toast(on ? 'Đã bật Tự làm không hỏi' : 'AIVN AGENT sẽ hỏi lại từng bước');
}
$('#agAuto').addEventListener('change', (e) => setAuto(e.target.checked));
$('#autoPill').addEventListener('click', () => setAuto($('#autoPill').getAttribute('aria-pressed') !== 'true'));
$('#agAutoRO').addEventListener('change', (e) => saveAgentSetting({ agentAutoReadOnly: e.target.checked }));
$('#agScreenMode').addEventListener('change', async (e) => {
  if (e.target.value === 'important' && !(await modalAsk({ icon: '⚠️', title: 'Chỉ hỏi bước quan trọng?', message: 'AIVN AGENT sẽ tự bấm/gõ các bước thường mà không hỏi bạn (vẫn hiện khung đỏ trước mỗi thao tác). Gửi tin nhắn, thanh toán, xoá, nộp biểu mẫu vẫn LUÔN hỏi. Mô hình có thể bấm nhầm — chỉ chọn khi bạn đang theo dõi màn hình. Dừng bất cứ lúc nào bằng Esc.', okLabel: 'Chỉ hỏi bước quan trọng', noLabel: 'Giữ hỏi từng bước' }))) { e.target.value = 'each'; return; }
  saveAgentSetting({ agentScreenMode: e.target.value });
});
$('#agGrounder').addEventListener('change', (e) => saveAgentSetting({ agentGrounder: e.target.value || '' }));
$('#agScreenBudget').addEventListener('change', (e) => saveAgentSetting({ agentScreenBudget: Number(e.target.value) }));
$('#agScreen').addEventListener('change', async (e) => {
  if (e.target.checked && !(await modalAsk({ icon: '🖱', title: 'Bật Điều khiển máy tính (thử nghiệm)?', message: 'AIVN AGENT sẽ tự điều khiển chuột/bàn phím: đọc cửa sổ đang mở (Trợ năng của hệ điều hành), chụp màn hình để đọc chữ (ảnh không gửi đi đâu), rồi bấm/gõ từng bước. Mặc định bạn duyệt TỪNG bước trên thẻ nổi (Ctrl+Enter = cho phép, Esc = từ chối). Gửi tin nhắn, thanh toán, xoá luôn hỏi; không bao giờ gõ mật khẩu. Dừng ngay: Esc hoặc Ctrl+Alt+Q (macOS: ⌘⌥Q).', okLabel: 'Bật', noLabel: 'Huỷ' }))) { e.target.checked = false; return; }
  saveAgentSetting({ agentScreen: e.target.checked });
});
$('#permGuide').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-perm]'); if (!b) return;
  if (b.dataset.perm === 'test') { const r = await A.computerPermTest(); toast(r.ok ? 'Chụp màn hình được ✓' : r.error, !r.ok); paintComputer(r.info); return; }
  paintComputer(await A.computerPermOpen(b.dataset.perm));
});
A.onComputerStopped(({ reason }) => { closeScreenModal(false); toast('■ Đã dừng AIVN AGENT (' + reason + ')', true); });
$('#openLogs').addEventListener('click', () => A.openLogs());
document.addEventListener('click', async (e) => {
  const lb = e.target.closest('[data-logs]');
  if (lb) { if (lb.dataset.logs === 'open') A.openLogs(); else { try { const r = await A.copyLogs(); toast(r.lines ? `Đã sao chép ${r.lines} dòng nhật ký. Dán (Ctrl+V) vào tin nhắn gửi người hỗ trợ.` : 'Nhật ký đang trống' + (r.error ? ' (lỗi ghi: ' + r.error + ')' : '') + '.', !r.lines); } catch (err) { toast(cleanErr(err.message), true); } } return; }
  const sb = e.target.closest('[data-scan]');
  if (sb) {
    const q = (sb.parentElement.querySelector('.scan-q') || {}).value || 'zalo';
    sb.disabled = true; const old = sb.textContent; sb.textContent = 'Đang quét…';
    try {
      const r = await A.scanTest(q);
      const lines = [`Hệ điều hành: ${r.platform} · ${r.total} ứng dụng · ${r.ms} ms`, 'Nguồn: ' + (Object.entries(r.sources).map(([k, v]) => k + ' = ' + v).join(', ') || 'không có'), 'Lỗi: ' + (r.errors.length ? r.errors.join('; ') : 'không'),
        ...(r.dirs ? ['Desktop: ' + (r.dirs.desktop || []).join(' | '), 'Start Menu: ' + (r.dirs.start || []).join(' | ')] : []), '', `Tìm "${r.query}": ` + (r.best ? `${r.best.name} → ${r.best.path || r.best.appId || '?'}` : 'KHÔNG thấy mục nào khớp'), ...r.matches.map(m => `  • ${m.name} · ${m.path || m.appId || ''}${m.target ? ' → ' + m.target : ''}`)];
      const ok = await modalAsk({ icon: r.best ? '✅' : '⚠', title: 'Kết quả quét ứng dụng', message: r.best ? `Đã thấy "${r.best.name}". AIVN AGENT sẽ mở được ứng dụng này.` : `Chưa thấy ứng dụng khớp "${r.query}". Hãy chụp màn hình này hoặc bấm Sao chép rồi gửi cho người hỗ trợ.`, preview: lines.join('\n'), okLabel: 'Sao chép kết quả', noLabel: 'Đóng' });
      if (ok) { await A.copyText(lines.join('\n')); toast('Đã sao chép kết quả quét.'); }
    } catch (err) { toast(cleanErr(err.message), true); }
    finally { sb.disabled = false; sb.textContent = old; }
  }
});
$('#gpuOn').addEventListener('change', async (e) => { state.settings = await A.setSettings({ gpu: e.target.checked }); toast(e.target.checked ? 'Đã bật GPU. Hãy nạp lại mô hình.' : 'Đã chuyển sang chỉ dùng CPU. Hãy nạp lại mô hình.'); setTimeout(refreshModels, 1500); });

// --- Thẻ duyệt thao tác màn hình ---
let scReq = null, scPick = null;
function placeBox() {
  const r = scReq; if (!r) return;
  const box = $('#scBox'), dot = $('#scDot');
  if (r.box && !scPick) { Object.assign(box.style, { left: r.box.x1 * 100 + '%', top: r.box.y1 * 100 + '%', width: (r.box.x2 - r.box.x1) * 100 + '%', height: (r.box.y2 - r.box.y1) * 100 + '%' }); box.hidden = false; } else box.hidden = true;
  const p = scPick || (r.box ? { nx: (r.box.x1 + r.box.x2) / 2, ny: (r.box.y1 + r.box.y2) / 2 } : null);
  if (p && r.needPoint) { Object.assign(dot.style, { left: p.nx * 100 + '%', top: p.ny * 100 + '%' }); dot.hidden = false; } else dot.hidden = true;
  $('#scYes').disabled = r.needPoint && !p;
}
A.onAgentScreen((req) => {
  scReq = req; scPick = null;
  $('#scMsg').innerHTML = `AIVN AGENT muốn <b>${esc(req.desc)}</b>.${req.notFound ? `<br><span class="warn-ink">⚠ ${esc(req.notFound)}</span>` : ''}`;
  $('#scImg').src = req.image; $('#scHint').hidden = !req.needPoint;
  $('#screenModal').hidden = false; placeBox(); $('#scNo').focus();
});
A.onAgentScreenCancel(({ id }) => { if (scReq && scReq.id === id) closeScreenModal(null); });
function closeScreenModal(ok) {
  if (!scReq) return; const r = scReq; scReq = null; $('#screenModal').hidden = true; $('#scImg').removeAttribute('src');
  if (ok !== null) A.agentScreenReply({ id: r.id, ok: !!ok, ...(ok && scPick ? scPick : {}) });
}
$('#scShot').addEventListener('click', (e) => {
  if (!scReq || !scReq.needPoint) return;
  const r = $('#scImg').getBoundingClientRect();
  scPick = { nx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), ny: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  placeBox();
});
$('#scYes').addEventListener('click', () => closeScreenModal(true));
$('#scNo').addEventListener('click', () => closeScreenModal(false));
$('#scStop').addEventListener('click', () => { closeScreenModal(false); A.computerStop(); });
$('#screenModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeScreenModal(false); } });

// ---------- Bảo mật & Quản trị ----------
const fmtDate = (t) => t ? new Date(t).toLocaleDateString('vi-VN') : '';
async function refreshSecurity() {
  const l = await A.licenseInfo();
  $('#secLicense').innerHTML = `<h3>✅ Kích hoạt</h3>
    <div class="kv"><span>Mã máy</span><b><code id="secMachine">${esc(l.machineCode)}</code> <button class="btn sm" id="secCopyMc">Sao chép</button></b>
    <span>Trạng thái</span><b>${l.status === 'ok' ? 'Đã kích hoạt' : esc(l.message || l.status)}${l.name ? ' · cấp cho ' + esc(l.name) : ''}</b>
    <span>Hạn dùng</span><b>${l.expiresAt ? 'đến ' + fmtDate(l.expiresAt) : 'vĩnh viễn'}</b>
    <span>Kiểm tra thu hồi</span><b>${l.lastCheckOk ? 'lần cuối ' + new Date(l.lastCheckOk).toLocaleString('vi-VN') : 'chưa kiểm tra được'}${l.graceLeftMs != null ? ` · còn dùng ngoại tuyến ${Math.max(0, Math.floor(l.graceLeftMs / 864e5))} ngày` : ''}</b></div>
    <div class="row"><button class="btn sm" id="secRecheck">Kiểm tra lại qua Internet</button></div>`;
  const k = await A.lockInfo();
  $('#lockState').innerHTML = k.enabled ? '🔒 Khoá ứng dụng đang <b>bật</b>.' : 'Khoá ứng dụng đang <b>tắt</b>.';
  $('#lkCur').hidden = !k.enabled; $('#lkOff').hidden = !k.enabled; $('#lkNow').hidden = !k.enabled;
  $('#lkSave').textContent = k.enabled ? 'Đổi mật khẩu' : 'Bật Khoá ứng dụng';
  $('#lkIdle').value = String(k.idleMinutes || 0); $('#lkSleep').checked = k.lockOnSleep;
  paintAdmin(await A.adminState());
}
function paintAdmin(a) {
  const b = $('#admBody');
  if (!a.imported) { b.innerHTML = `<p class="small muted">Dành cho chủ sở hữu AIVN: nhập tệp khoá quản trị <code>aivn-admin-key.json</code> để cấp và thu hồi mã kích hoạt ngay trong ứng dụng. Khoá được mã hoá bằng cụm mật khẩu quản trị bạn đặt và chỉ lưu trên máy này.</p>
    <div class="sec-form"><input type="password" id="admNewPass" placeholder="Đặt cụm mật khẩu quản trị (ít nhất 8 ký tự)" autocomplete="new-password"><div class="row"><button class="btn primary" id="admImport">Chọn tệp khoá và nhập</button></div></div>`; return; }
  if (!a.unlocked) { b.innerHTML = `<p class="small muted">Khoá quản trị đã được nhập trên máy này. Nhập cụm mật khẩu quản trị để mở (tự khoá sau 15 phút không dùng).</p>
    <form class="sec-form" id="admUnlockForm"><input type="password" id="admPass" placeholder="Cụm mật khẩu quản trị" autocomplete="current-password"><div class="row"><button class="btn primary" type="submit">Mở trang Quản trị</button><button class="btn" type="button" id="admForget">Gỡ khoá khỏi máy này</button></div></form>`; return; }
  b.innerHTML = `<div class="adm-grid">
    <form id="admIssueForm" class="sec-form"><h4>Cấp mã kích hoạt</h4>
      <input id="admName" maxlength="60" placeholder="Tên người được cấp, vd. Trần Văn A" required>
      <input id="admMc" maxlength="16" placeholder="Mã máy họ gửi, vd. AB12C-DE34F" required>
      <label class="small">Thời hạn <select id="admDays"><option value="">Vĩnh viễn</option><option>7</option><option>30</option><option>90</option><option>180</option><option>365</option></select> ngày</label>
      <div class="row"><button class="btn primary" type="submit">Tạo mã</button><button class="btn" type="button" id="admMine">Dùng Mã máy của máy này</button></div>
      <div id="admOut" hidden></div></form>
    <div class="sec-form"><h4>Đăng danh sách thu hồi</h4>
      <p class="small muted">Thu hồi một mã sẽ ký lại <code>revoked.json</code>. ${a.hasToken ? 'Đã có token GitHub: AIVN tự đăng lên trang web.' : 'Chưa có token GitHub: AIVN sẽ lưu tệp revoked.json để bạn tự tải lên nhánh gh-pages.'} Máy đã bị thu hồi sẽ bị khoá ở lần kiểm tra tiếp theo (tối đa 4 giờ khi có mạng).</p>
      <input type="password" id="admToken" placeholder="${a.hasToken ? 'Đã lưu token (nhập để thay, để trống + Lưu để xoá)' : 'Token GitHub (fine-grained, quyền Contents: Read and write cho ' + esc(a.repo) + ')'}" autocomplete="off">
      <div class="row"><button class="btn sm" id="admSaveToken">Lưu token</button><button class="btn sm" id="admPublish">Ký và đăng lại</button><button class="btn sm" id="admLock">Khoá trang Quản trị</button></div></div></div>
    <h4>Mã đã cấp từ máy này (${a.codes.length})</h4>
    <div class="adm-list">${a.codes.length ? a.codes.map(c => `<div class="adm-row${c.revoked ? ' off' : ''}"><div><b>${esc(c.name)}</b> · máy ${esc(c.machineCode.slice(0, 5) + '-' + c.machineCode.slice(5))} · ${c.expiresAt ? 'đến ' + fmtDate(c.expiresAt) : 'vĩnh viễn'}<br><small class="muted">ID ${esc(c.id)} · cấp ${fmtDate(c.issuedAt)}</small></div>${c.revoked ? '<span class="tag">Đã thu hồi</span>' : `<button class="btn sm" data-copycode="${esc(c.code)}">Sao chép mã</button><button class="btn sm danger" data-revoke="${esc(c.id)}" data-name="${esc(c.name)}">Thu hồi</button>`}</div>`).join('') : '<p class="small muted">Chưa cấp mã nào trong ứng dụng. (Mã cấp bằng issue.sh trên máy khác không hiện ở đây; vẫn thu hồi được bằng ID.)</p>'}</div>
    <form class="row" id="admRevokeForm"><input id="admRevokeId" maxlength="12" placeholder="Thu hồi theo ID mã (12 ký tự)"><button class="btn sm danger" type="submit">Thu hồi ID</button></form>`;
}
$('[data-spane="security"]').addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  try {
    if (t.id === 'secCopyMc') { await A.copyText($('#secMachine').textContent); toast('Đã chép Mã máy ✓'); }
    if (t.id === 'secRecheck') { const r = await A.licenseCheck(); toast(r.ok ? 'Đã kiểm tra danh sách thu hồi ✓' : 'Chưa kết nối được: ' + (r.error || ''), !r.ok); refreshSecurity(); }
    if (t.id === 'lkOff') { await A.lockDisable({ current: $('#lkCur').value }); $('#lkCur').value = ''; toast('Đã tắt Khoá ứng dụng'); refreshSecurity(); }
    if (t.id === 'lkNow') await A.lockNow();
    if (t.id === 'admImport') { const r = await A.adminImport({ pass: $('#admNewPass').value }); if (!r.canceled) toast('Đã nhập khoá quản trị ✓'); paintAdmin(await A.adminState()); }
    if (t.id === 'admForget') { if (await modalAsk({ icon: '⚠️', title: 'Gỡ khoá quản trị khỏi máy này?', message: 'Bản mã hoá của khoá riêng trên máy này sẽ bị xoá. Hãy chắc chắn bạn còn giữ tệp aivn-admin-key.json ở nơi an toàn.', okLabel: 'Gỡ khoá', noLabel: 'Huỷ' })) paintAdmin(await A.adminForget()); }
    if (t.id === 'admLock') paintAdmin(await A.adminLock());
    if (t.id === 'admMine') $('#admMc').value = $('#secMachine').textContent;
    if (t.id === 'admSaveToken') { paintAdmin(await A.adminSetToken($('#admToken').value)); toast('Đã lưu ✓'); }
    if (t.id === 'admPublish') { const r = await A.adminPublish(); toast(r.published ? 'Đã đăng revoked.json ✓ (trang web cập nhật sau 1–2 phút)' : r.savedTo ? 'Đã lưu ' + r.savedTo : 'Chưa đăng'); }
    if (t.dataset.copycode) { await A.copyText(t.dataset.copycode); toast('Đã chép mã kích hoạt ✓'); }
    if (t.dataset.revoke) await doRevoke(t.dataset.revoke, t.dataset.name);
  } catch (err) { toast(cleanErr(err.message), true); }
});
async function doRevoke(id, name) {
  if (!(await modalAsk({ icon: '⛔', title: 'Thu hồi mã kích hoạt?', message: `Thu hồi mã ${id}${name ? ' của ' + name : ''}. Máy đó sẽ không mở được AIVN sau lần kiểm tra tiếp theo. Không hoàn tác được (muốn cho dùng lại thì cấp mã mới).`, okLabel: 'Thu hồi', noLabel: 'Huỷ' }))) return;
  const r = await A.adminRevoke(id);
  toast(r.published ? 'Đã thu hồi và đăng revoked.json ✓' : r.savedTo ? 'Đã thu hồi, lưu revoked.json tại ' + r.savedTo + '. Hãy tải lên gh-pages.' : 'Đã thu hồi trên máy này nhưng CHƯA đăng.', !r.published && !r.savedTo);
  paintAdmin(r.state);
}
$('[data-spane="security"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (e.target.id === 'lockForm') { await A.lockSet({ password: $('#lkNew').value, confirm: $('#lkNew2').value, current: $('#lkCur').value }); for (const i of ['#lkNew', '#lkNew2', '#lkCur']) $(i).value = ''; toast('Đã bật Khoá ứng dụng ✓'); refreshSecurity(); }
    if (e.target.id === 'admUnlockForm') paintAdmin(await A.adminUnlock($('#admPass').value));
    if (e.target.id === 'admIssueForm') {
      const r = await A.adminIssue({ name: $('#admName').value, machineCode: $('#admMc').value, days: $('#admDays').value || null });
      paintAdmin(r.state);
      const out = $('#admOut'); out.hidden = false;
      out.innerHTML = `<p class="small">Mã kích hoạt cho <b>${esc(r.info.name)}</b> (máy ${esc(r.info.machineCode)}${r.info.expiresAt ? ', đến ' + fmtDate(r.info.expiresAt) : ', vĩnh viễn'}). Gửi nguyên đoạn này cho họ:</p><textarea readonly rows="4" class="code-out">${esc(r.code)}</textarea><button class="btn sm" type="button" data-copycode="${esc(r.code)}">Sao chép mã</button>`;
    }
    if (e.target.id === 'admRevokeForm') await doRevoke($('#admRevokeId').value.trim());
  } catch (err) { toast(cleanErr(err.message), true); }
});
$('#lkIdle').addEventListener('change', async (e) => { await A.lockOptions({ idleMinutes: Number(e.target.value) }); toast('Đã lưu ✓'); });
$('#lkSleep').addEventListener('change', async (e) => { await A.lockOptions({ lockOnSleep: e.target.checked }); });

// ---------- Khởi động ----------
(async () => {
  state.settings = await A.getSettings();
  applyTheme(state.settings.theme); $('#themeFxSel').value = themeFx();
  bindSettings();
  $('#gpuOn').checked = state.settings.gpu !== false;
  paintAdvanced();
  paintRag().catch(() => {});
  for (const j of await A.dlList()) jobs.set(j.id, j);
  renderDlPanel();
  setStatus(await A.modelStatus());
  await Promise.all([refreshModels(), loadConvos(), refreshServer()]);
  renderMessages();
  const info = await A.info();
  const h = info.hardware || {};
  $('#sbVer').textContent = 'AIVN ' + info.version;
  $('#aboutVer').textContent = 'phiên bản ' + info.version;
  paintUpdate(await A.updateState());
  resetForm(); refreshSchedCount(); refreshMemCount();
  $('#modelsDir').textContent = 'Thư mục lưu: ' + info.paths.models;
})();

// ---------- Nâng cao: phần cứng & ghi đè ----------
const GBf = (b) => (b / 1024 ** 3).toFixed(1) + ' GB';
async function paintAdvanced() {
  const s = state.settings || {};
  $('#gpuDevice').value = Number.isInteger(s.gpuDevice) ? String(s.gpuDevice) : '';
  const gl = Number.isInteger(s.gpuLayers) ? s.gpuLayers : -1;
  $('#gpuLayers').value = String(gl); $('#gpuLayersVal').textContent = gl < 0 ? 'Tự động' : gl === 0 ? '0 (chỉ CPU)' : String(gl);
  $('#vramLimit').value = Number(s.vramLimitGB) > 0 ? String(s.vramLimitGB) : '';
  try {
    const h = await A.hwInfo(); const st = state.status || {};
    const be = { cuda: 'CUDA (NVIDIA)', vulkan: 'Vulkan', metal: 'Metal (Apple)' }[h.gpu] || 'Chỉ CPU';
    const v = h.vram || {};
    const rows = [
      ['Bộ xử lý', `${h.cpu || '?'} · ${h.cpus} luồng`],
      ['RAM', `${GBf(h.freeRam)} trống / ${GBf(h.ram)}`],
      ['Tăng tốc', h.cpuOnly ? 'Chỉ CPU (đã tắt GPU)' : be],
      ...(h.devices && h.devices.length ? [['GPU', h.devices.join(', ')]] : []),
      ...(h.gpu && v.total ? [[h.gpu === 'metal' || v.integratedOnly ? 'Bộ nhớ GPU (dùng chung)' : 'VRAM riêng', `${GBf(v.free)} trống / ${GBf(v.total)}`]] : []),
      ...(v.mixed ? [['Laptop 2 GPU', `Đã bỏ qua ${GBf(v.shared)} bộ nhớ dùng chung của GPU tích hợp khi tính số lớp`]] : []),
      ...(st.loaded && st.totalLayers ? [['Mô hình đang nạp', `${st.gpuLayers || 0}/${st.totalLayers} lớp trên GPU · ngữ cảnh ${st.contextSize}`]] : []),
    ];
    $('#hwInfo').innerHTML = rows.map(([k, x]) => `<div><span class="muted">${esc(k)}:</span> ${esc(x)}</div>`).join('');
  } catch { $('#hwInfo').textContent = 'Không đọc được thông tin phần cứng.'; }
}
$('#gpuLayers').addEventListener('input', e => { const n = Number(e.target.value); $('#gpuLayersVal').textContent = n < 0 ? 'Tự động' : n === 0 ? '0 (chỉ CPU)' : String(n); });
$('#gpuLayers').addEventListener('change', async e => { const n = Number(e.target.value); state.settings = await A.setSettings({ gpuLayers: n < 0 ? null : n }); toast('Số lớp GPU mới áp dụng khi nạp lại mô hình'); });
$('#gpuDevice').addEventListener('change', async e => { const v = e.target.value; state.settings = await A.setSettings({ gpuDevice: v === '' ? null : Number(v) }); toast('Đã đổi thiết bị GPU. Hãy nạp lại mô hình.'); setTimeout(paintAdvanced, 1500); });
$('#vramLimit').addEventListener('change', async e => { const v = Number(e.target.value); state.settings = await A.setSettings({ vramLimitGB: v > 0 ? v : null }); toast('Đã đổi giới hạn VRAM. Hãy nạp lại mô hình.'); setTimeout(paintAdvanced, 1500); });
$('#advReset').addEventListener('click', async () => { state.settings = await A.setSettings({ gpu: true, gpuDevice: null, gpuLayers: null, vramLimitGB: null }); $('#gpuOn').checked = true; toast('Đã về chế độ tự động. Hãy nạp lại mô hình.'); setTimeout(paintAdvanced, 1500); });


// ---------- Nút công cụ trên đầu AIVN AGENT: bấm để bật/tắt, di chuột/nhấn giữ để xem, ▾ để xem ví dụ ----------
const CHIPS = [
  { id: 'calc', i: '🧮', n: 'Máy tính', desc: 'Tính biểu thức chính xác: cộng trừ nhân chia, phần trăm, luỹ thừa, căn.', ex: ['Tính 15% của 2.350.000 đồng', '(3,5 + 4,2) × 12 bằng bao nhiêu?'] },
  { id: 'datetime', i: '🕒', n: 'Ngày giờ', desc: 'Biết ngày giờ hiện tại trên máy, đếm số ngày giữa hai mốc.', ex: ['Hôm nay là thứ mấy, ngày bao nhiêu?', 'Còn bao nhiêu ngày nữa đến Tết Dương lịch?'] },
  { id: 'js', i: '⚙️', n: 'JavaScript', desc: 'Chạy đoạn mã JavaScript trong hộp cát cách ly (không mạng, không tệp) để tính toán, xử lý văn bản.', ex: ['Viết và chạy mã liệt kê 20 số nguyên tố đầu tiên', 'Đảo ngược từng từ trong câu "Xin chào Văn Lang"'] },
  { id: 'files', i: '📂', n: 'Tệp', desc: 'Đọc, ghi, liệt kê tệp, chỉ trong các thư mục bạn đã cho phép. Xoá/ghi đè luôn hỏi bạn trước.', ex: ['Liệt kê các tệp trong thư mục đã cho phép', 'Đọc tệp ghi-chu.txt và tóm tắt 3 ý chính'] },
  { id: 'web', i: '🌐', n: 'Web', set: '#agWeb', desc: 'Tìm kiếm trên mạng và đọc trang web (chỉ khi bật). Câu trả lời ghi nguồn.', ex: ['Tìm trên mạng: Trường Đại học Văn Lang thành lập năm nào?', 'Đọc trang vnexpress.net và tóm tắt tin chính'] },
  { id: 'python', i: '🐍', n: 'Python', set: '#agPy', desc: 'Chạy mã Python 3 có trên máy trong thư mục tạm, chặn mạng, tối đa 10 giây.', ex: ['Dùng Python tính độ lệch chuẩn của 4, 8, 15, 16, 23, 42', 'Dùng Python tạo bảng cửu chương 7'] },
  { id: 'memory', i: '🧠', n: 'Ghi nhớ', set: '#agMem', desc: 'Ghi nhớ điều bạn dặn để dùng ở các cuộc trò chuyện sau (lưu trên máy, xoá được).', ex: ['Hãy nhớ: tôi học ngành Công nghệ thông tin ở Văn Lang', 'Bạn đang nhớ gì về tôi?'] },
  { id: 'computer', i: '💻', n: 'Máy tính/ứng dụng', set: '#agComp', desc: 'Mở ứng dụng, tệp, thư mục, trang web; xem/đóng ứng dụng; chạy lệnh (luôn hỏi bạn trước).', ex: ['Mở Máy tính (Calculator) giúp tôi', 'Những ứng dụng nào đang chạy?'] },
  { id: 'screen', i: '🖱', n: 'Điều khiển màn hình', set: '#agScreen', beta: true, desc: 'Thử nghiệm: chụp màn hình, mô hình nhìn ảnh đề xuất bấm/gõ; mỗi thao tác bạn duyệt trước. Ctrl+Alt+Q để dừng.', ex: ['Nhìn màn hình và cho biết tôi đang mở gì', 'Bấm vào nút Bắt đầu (Start) trên thanh tác vụ'] },
  { id: 'reminder', i: '⏰', n: 'Lịch nhắc', desc: 'Tạo lời nhắc hoặc việc AIVN AGENT tự làm theo giờ (xem ở mục Lịch).', ex: ['Nhắc tôi uống nước sau 30 phút', 'Mỗi sáng 8 giờ nhắc tôi xem lịch học'] },
];
let chipPop = null; // { id, el }
function chipState(c, info) {
  const off = new Set(info.toolsOff || []); const comp = info.computer || {};
  switch (c.id) {
    case 'files': if (off.has('files')) return { st: 'off' }; return info.folders.some(f => f.exists) ? { st: 'on' } : { st: 'blocked', short: 'chưa có thư mục', why: 'Chưa cho phép thư mục nào, nên AIVN AGENT không đọc/ghi được tệp.', fix: 'Thêm thư mục', act: () => $('#addFolder').click() };
    case 'web': return { st: info.web ? 'on' : 'off' };
    case 'python': if (!info.python.available) return { st: 'blocked', short: 'chưa có Python', why: 'Máy chưa có Python 3.', fix: 'Hướng dẫn cài Python', act: () => modalAsk({ icon: '🐍', title: 'Cài Python 3', message: 'Tải Python 3 từ trang chính thức python.org (Windows: nhớ tích "Add python.exe to PATH" khi cài; macOS: cài gói .pkg). Cài xong, khởi động lại AIVN rồi bật nút Python.', okLabel: 'Mở python.org', noLabel: 'Đóng' }).then(ok => ok && A.openExternal('https://www.python.org/downloads/')) };
      return { st: info.python.enabled ? 'on' : 'off' };
    case 'memory': return { st: info.memory.enabled ? 'on' : 'off' };
    case 'computer': return { st: comp.enabled ? 'on' : 'off' };
    case 'screen': if (!comp.screen) return { st: 'off' }; return comp.vision ? { st: 'on' } : { st: 'blocked', short: 'cần mô hình nhìn màn hình', why: 'Đang bị chặn: mô hình hiện tại không nhìn được màn hình nên AIVN AGENT không được bấm/gõ trong ứng dụng. Chọn một mô hình được đánh dấu dùng được cho AIVN AGENT (có 👁, vd. Qwen3-VL) ở bộ chọn mô hình, hoặc xem mục “Mô hình điều khiển máy tính” trong Khám phá.', fix: 'Mở Khám phá', act: () => show('discover'), canOff: true };
    default: return { st: off.has(c.id) ? 'off' : 'on' };
  }
}
function renderToolChips(info) {
  if (!info) return;
  $('#toolChips').innerHTML = CHIPS.map(c => {
    const s = chipState(c, info);
    const label = s.st === 'on' ? 'đang bật' : s.st === 'off' ? 'đang tắt' : 'chưa dùng được';
    const tip = `${c.desc}\n${s.st === 'blocked' ? '⚠ ' + s.why : s.st === 'on' ? 'Bấm để tắt.' : 'Bấm để bật.'}`;
    return `<span class="tool-chip ${s.st}" data-chip="${c.id}"><button type="button" class="tc-main" aria-pressed="${s.st === 'on'}" aria-label="${esc(c.n)}: ${label}${s.st === 'blocked' ? '. ' + esc(s.why) : ''}" title="${esc(tip)}">${c.i} ${esc(c.n)}${s.st === 'on' ? '' : s.st === 'blocked' ? ' · ' + esc(s.short || 'bị chặn') : ' · tắt'}</button><button type="button" class="tc-more" aria-haspopup="dialog" aria-expanded="false" aria-label="Xem mô tả và ví dụ cho ${esc(c.n)}" title="Mô tả và ví dụ">▾</button></span>`;
  }).join('');
  if (chipPop) { const id = chipPop.id; closeChipPop(); openChipPop(id, false); }
}
async function toggleChip(id) {
  const c = CHIPS.find(x => x.id === id); const info = state.agent; if (!c || !info) return;
  const s = chipState(c, info);
  if (s.st === 'blocked' && !s.canOff) { openChipPop(id, true); return; }
  const turnOn = s.st === 'off';
  if (c.set) { const el = $(c.set); el.checked = turnOn; el.dispatchEvent(new Event('change')); }
  else { const off = new Set(info.toolsOff || []); turnOn ? off.delete(id) : off.add(id); await saveAgentSetting({ agentToolsOff: [...off] }); }
  toast(`${c.n}: ${turnOn ? 'đã bật' : 'đã tắt'}${turnOn ? '' : ' (AIVN AGENT sẽ không dùng công cụ này)'}`);
}
function closeChipPop() {
  if (!chipPop) return; chipPop.el.remove();
  const b = document.querySelector(`[data-chip="${chipPop.id}"] .tc-more`); if (b) b.setAttribute('aria-expanded', 'false');
  chipPop = null;
}
function openChipPop(id, focus = true) {
  closeChipPop();
  const c = CHIPS.find(x => x.id === id); const chip = document.querySelector(`[data-chip="${id}"]`); if (!c || !chip || !state.agent) return;
  const s = chipState(c, state.agent);
  const el = document.createElement('div'); el.className = 'chip-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', c.n);
  el.innerHTML = `<div class="cp-head"><b>${c.i} ${esc(c.n)}</b>${c.beta ? '<em class="beta">Thử nghiệm</em>' : ''}<span class="cp-st ${s.st}">${s.st === 'on' ? 'Đang bật' : s.st === 'off' ? 'Đang tắt' : 'Chưa dùng được'}</span></div>
    <p class="small">${esc(c.desc)}</p>
    ${s.st === 'blocked' ? `<p class="small warn-ink">⚠ ${esc(s.why)}</p><button type="button" class="btn sm primary" data-cp="fix">${esc(s.fix)}</button>` : `<button type="button" class="btn sm ${s.st === 'on' ? '' : 'primary'}" data-cp="toggle">${s.st === 'on' ? 'Tắt công cụ này' : 'Bật công cụ này'}</button>`}
    <div class="cp-ex"><span class="muted small">Thử hỏi (bấm để chèn vào ô nhập):</span>${c.ex.map((x, k) => `<button type="button" class="cp-q" data-cp="ex" data-k="${k}">“${esc(x)}”</button>`).join('')}</div>`;
  document.body.appendChild(el);
  const r = chip.getBoundingClientRect(); const w = Math.min(320, window.innerWidth - 16);
  el.style.width = w + 'px'; el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px'; el.style.top = (r.bottom + 6) + 'px';
  chip.querySelector('.tc-more').setAttribute('aria-expanded', 'true');
  chipPop = { id, el };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cp]'); if (!b) return;
    if (b.dataset.cp === 'toggle') toggleChip(id);
    else if (b.dataset.cp === 'fix') { closeChipPop(); s.act(); }
    else if (b.dataset.cp === 'ex') { const inp = $('#input'); inp.value = c.ex[Number(b.dataset.k)]; inp.dispatchEvent(new Event('input')); closeChipPop(); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); const back = chip.querySelector('.tc-more'); closeChipPop(); back && back.focus(); } });
  if (focus) (el.querySelector('[data-cp]') || el).focus();
}
$('#toolChips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]'); if (!chip) return;
  if (chip.dataset.lp === '1') { chip.dataset.lp = ''; return; } // vừa nhấn giữ để mở bảng
  if (e.target.closest('.tc-more')) { chipPop && chipPop.id === chip.dataset.chip ? closeChipPop() : openChipPop(chip.dataset.chip); return; }
  toggleChip(chip.dataset.chip);
});
// Nhấn giữ (cảm ứng/chuột) ~0,5 giây để xem mô tả và ví dụ
let lpTimer = null;
$('#toolChips').addEventListener('pointerdown', (e) => { const chip = e.target.closest('[data-chip]'); if (!chip) return; clearTimeout(lpTimer); lpTimer = setTimeout(() => { chip.dataset.lp = '1'; openChipPop(chip.dataset.chip, false); }, 520); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('#toolChips').addEventListener(ev, () => clearTimeout(lpTimer));
$('#toolChips').addEventListener('keydown', (e) => { const chip = e.target.closest('[data-chip]'); if (chip && e.key === 'ArrowDown' && e.target.classList.contains('tc-main')) { e.preventDefault(); openChipPop(chip.dataset.chip); } });
document.addEventListener('pointerdown', (e) => { if (chipPop && !e.target.closest('.chip-pop') && !e.target.closest('[data-chip]')) closeChipPop(); });
window.addEventListener('resize', closeChipPop);

$('#messages').addEventListener('click', (e) => { if (e.target.closest('[data-rec-go]')) show('discover'); });

// ---------- Khung ứng dụng 0.16: thanh điều hướng thu gọn, Cài đặt, mức hiển thị, thanh trạng thái ----------
function toggleRail(force) {
  const on = typeof force === 'boolean' ? force : !document.documentElement.classList.contains('rail-compact');
  document.documentElement.classList.toggle('rail-compact', on); localStorage.setItem('aivn.railCompact', on ? '1' : '0');
  const t = $('#railToggle'); t.title = on ? 'Mở rộng thanh bên (Ctrl+B)' : 'Thu gọn thanh bên (Ctrl+B)'; t.setAttribute('aria-label', t.title); t.setAttribute('aria-expanded', String(!on));
  $('#railCompactChk').checked = on;
}
toggleRail(localStorage.getItem('aivn.railCompact') === '1' || (localStorage.getItem('aivn.railCompact') === null && innerWidth < 1200));
$('#railToggle').addEventListener('click', () => toggleRail());
$('#railCompactChk').addEventListener('change', (e) => toggleRail(e.target.checked));
// Chú thích khi rê chuột ở chế độ thu gọn (tự vẽ, không dùng title để hiện ngay và đúng chủ đề)
const railTip = (() => { const d = document.createElement('div'); d.className = 'rail-tip'; d.setAttribute('role', 'tooltip'); d.hidden = true; document.body.appendChild(d); return d; })();
$('#rail').addEventListener('mouseover', (e) => {
  const b = e.target.closest('.nav-item'); if (!b || !document.documentElement.classList.contains('rail-compact')) { railTip.hidden = true; return; }
  const r = b.getBoundingClientRect(); railTip.textContent = b.dataset.tip || ''; railTip.style.top = (r.top + r.height / 2) + 'px'; railTip.style.left = (r.right + 8) + 'px'; railTip.hidden = false;
});
$('#rail').addEventListener('mouseleave', () => { railTip.hidden = true; });
$('#rail').addEventListener('focusin', (e) => { const b = e.target.closest('.nav-item'); if (b && document.documentElement.classList.contains('rail-compact')) { const r = b.getBoundingClientRect(); railTip.textContent = b.dataset.tip || ''; railTip.style.top = (r.top + r.height / 2) + 'px'; railTip.style.left = (r.right + 8) + 'px'; railTip.hidden = false; } });
$('#rail').addEventListener('focusout', () => { railTip.hidden = true; });
// Trang Cài đặt: các thẻ bên trái, phím ↑↓ di chuyển giữa thẻ
function setTab(tab) {
  if (!document.querySelector(`[data-spane="${tab}"]`)) tab = 'general';
  setTab.cur = tab;
  $$('#setNav [data-stab]').forEach(b => { const on = b.dataset.stab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  $$('#setBody [data-spane]').forEach(p => p.classList.toggle('on', p.dataset.spane === tab));
  $('#setBody').scrollTop = 0;
  if (tab === 'hardware') paintAdvanced();
  if (tab === 'security') refreshSecurity().catch(err => toast(cleanErr(err.message), true));
}
$('#setNav').addEventListener('click', (e) => { const b = e.target.closest('[data-stab]'); if (b) setTab(b.dataset.stab); });
$('#setNav').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault();
  const bs = $$('#setNav [data-stab]'); const i = bs.findIndex(b => b.dataset.stab === setTab.cur); const n = bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length];
  setTab(n.dataset.stab); n.focus();
});
$('#setKeys').addEventListener('click', openKeys);
// Mức hiển thị: Cơ bản ẩn các phần có lớp .adv-only
function setUiMode(m) {
  m = m === 'advanced' ? 'advanced' : 'basic'; document.documentElement.dataset.ui = m; localStorage.setItem('aivn.uiMode', m);
  $$('[data-uimode]').forEach(b => { const on = b.dataset.uimode === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
}
setUiMode(localStorage.getItem('aivn.uiMode') || 'basic');
document.addEventListener('click', (e) => { const b = e.target.closest('[data-uimode]'); if (b) setUiMode(b.dataset.uimode); });
// Thanh trạng thái
const gb1 = (b) => (b / 1024 ** 3).toFixed(1).replace('.', ',');
function paintSbModel(st) {
  const el = $('#sbModel'); if (!el) return;
  const name = st && st.id ? ((state.models || []).find(m => m.id === st.id) || {}) : {};
  const label = name.catalog ? name.catalog.name : (name.name || (st && st.id) || '');
  if (st && st.loading) el.innerHTML = `<i class="sb-dot busy"></i><span>Đang nạp ${esc(label)}…</span>`;
  else if (st && st.loaded) el.innerHTML = `<i class="sb-dot"></i><span>${esc(label)}</span><span class="muted">· ngữ cảnh ${Number(st.contextSize || 0).toLocaleString('vi-VN')} · ${st.gpu ? (st.totalLayers ? `GPU ${st.gpuLayers || 0}/${st.totalLayers} lớp` : 'GPU') : 'CPU'}</span>`;
  else el.innerHTML = '<i class="sb-dot off"></i><span>Chưa nạp mô hình</span>';
  el.title = el.textContent;
}
function paintSbSpeed(u) {
  const el = $('#sbSpeed'); if (!el || !u || !u.tokensPerSecond) return;
  el.hidden = false; el.textContent = `${u.tokensPerSecond.toFixed(1).replace('.', ',')} token/giây`;
  el.title = `Câu trả lời gần nhất: ${u.completion_tokens} token trong ${u.seconds.toFixed(1)} giây`;
}
async function pollSb() {
  try {
    const x = await A.sysStats(); const used = x.ramTotal - x.ramFree; const pct = used / x.ramTotal;
    const r = $('#sbRam'); r.textContent = `RAM ${gb1(used)} / ${gb1(x.ramTotal)} GB`; r.classList.toggle('warn', pct > 0.9);
    r.title = `RAM của máy đang dùng: ${Math.round(pct * 100)}%`;
    if (x.cpu != null) { $('#sbCpu').textContent = `CPU ${Math.round(x.cpu)}%`; $('#sbCpu').title = `${x.cpus} luồng CPU`; }
    const v = $('#sbVram'); if (x.gpu && x.vram && x.vram.total) { v.hidden = false; v.textContent = `${x.gpu === 'metal' ? 'Bộ nhớ GPU' : 'VRAM'} ${gb1(x.vram.total)} GB`; } else v.hidden = true;
  } catch {}
}
pollSb(); setInterval(() => { if (!document.hidden) pollSb(); }, 2000);
// 0.15.2: lỗi thiếu ngữ cảnh → nút "Tăng ngữ cảnh": nạp lại mô hình đang dùng với ngữ cảnh gấp đôi (tối đa 32768)
const CTX_ERR_UI = /cần nhiều ngữ cảnh hơn|ngữ cảnh[^.]*quá nhỏ/i;
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ctx-grow]'); if (!b) return;
  const st = state.status || {}; const id = st.id || (state.settings && state.settings.lastModel);
  if (!id) { toast('Hãy nạp một mô hình trước', true); return; }
  const have = Number(st.contextSize) || Number(state.settings && state.settings.contextSize) || 4096;
  const next = [8192, 16384, 32768].find(n => n > have) || 32768;
  b.disabled = true; b.textContent = `Đang nạp lại với ngữ cảnh ${next.toLocaleString('vi-VN')}…`;
  try {
    state.settings = await A.setSettings({ contextSize: next });
    const sel = $('#ctxSize'); if (sel && [...sel.options].some(o => Number(o.value || o.textContent) === next)) sel.value = String(next);
    await A.unloadModel();
    if (await loadModel(id)) toast(`Đã tăng ngữ cảnh lên ${Number((state.status || {}).contextSize || next).toLocaleString('vi-VN')} token. Hãy gửi lại tin nhắn.`);
  } catch (err) { toast(cleanErr(err.message), true); }
  b.disabled = false; b.textContent = 'Tăng ngữ cảnh';
});
// tải xong mắt nhìn: AIVN tự đặt làm mô hình định vị (main) — làm mới biểu ngữ AIVN AGENT
A.onDlDone(() => setTimeout(() => { if (typeof refreshAgent === 'function') refreshAgent().catch(() => {}); }, 800));
