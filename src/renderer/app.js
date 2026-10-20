'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const A = window.aivn;
const state = { settings: null, models: [], status: { loaded: false }, convos: [], current: null, generating: null, catalog: [] };

const fmtBytes = (b) => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024))); return (b / 1024 ** i).toFixed(i >= 3 ? 2 : 0).replace('.', ',') + ' ' + u[i]; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  if (view === 'discover' && !$('#sugArea').hidden) renderCatalog();
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
const doImport = async () => { state.models = await A.importModel(); refreshModels(); if (!$('#sugArea').hidden) renderCatalog(); };
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

const jobs = new Map(); // id -> snapshot
const disc = { fam: 'all', results: null, repo: null, lastQuery: null };
const fmtNum = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' Tr' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.', ',') + ' N' : String(n || 0);
const fmtEta = (s) => s == null ? '' : s < 60 ? Math.ceil(s) + ' giây' : s < 3600 ? Math.ceil(s / 60) + ' phút' : Math.floor(s / 3600) + ' giờ ' + Math.round((s % 3600) / 60) + ' phút';
const fmtAgo = (iso) => { if (!iso) return ''; const d = (Date.now() - new Date(iso)) / 864e5; return d < 1 ? 'hôm nay' : d < 30 ? Math.floor(d) + ' ngày trước' : d < 365 ? Math.floor(d / 30) + ' tháng trước' : Math.floor(d / 365) + ' năm trước'; };
const fmtParams = (n) => !n ? '' : n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace('.', ',') + 'B tham số' : Math.round(n / 1e6) + 'M tham số';
const cleanErr = (m) => String(m).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const fitBadge = (f) => f ? `<span class="fit ${f.level}" title="${esc(f.hint)}">${esc(f.label)}</span>` : '';
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
  $('#catalog').innerHTML = list.map(c => `<div class="card" data-id="${esc(c.id)}">
    <div class="card-top"><div class="av">${esc(c.family.slice(0, 2))}</div><div><h4>${esc(c.name)}</h4><div class="sub">${esc(c.params)} tham số · ${esc(c.quant)} · ${fmtBytes(c.size)}</div></div></div>
    <p>${esc(c.desc)}</p>
    <div class="tags">${fitBadge(c.fit)}${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}<span class="tag">${esc(c.ram)}</span><span class="tag lic" title="Giấy phép">${esc(c.license)}</span>${c.vision ? '<span class="tag" title="Mô hình có khả năng xem ảnh, AIVN hiện chỉ dùng phần văn bản">Chưa hỗ trợ ảnh</span>' : ''}</div>
    <div class="card-foot" data-job="${esc(jobIdFor(c.repo, c.file))}">${footHtml(c, `data-act="dl-cat" data-id="${esc(c.id)}"`, c.file)}</div>
    <button class="linkish" data-act="open-repo" data-repo="${esc(c.repo)}">Các bản lượng tử khác · ${esc(c.repo)}</button></div>`).join('');
}

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
    r.vision ? '🖼 Mô hình có khả năng xem ảnh. AIVN hiện chỉ dùng phần trò chuyện bằng văn bản, chưa hỗ trợ đầu vào ảnh (tệp mmproj không cần tải).' : '',
    r.embedding ? '⚠ Đây là mô hình embedding (tạo vector), không dùng để trò chuyện.' : '',
    r.archSupported === false ? `⚠ Kiến trúc “${esc(r.arch)}” có thể chưa được hỗ trợ bởi llama.cpp trong AIVN; mô hình có thể không nạp được.` : '',
  ].filter(Boolean);
  area.innerHTML = `<div class="repo-head"><button class="btn sm" data-act="back">← Quay lại</button>
      <div class="grow"><h3>${esc(r.name)} <span class="muted">· ${esc(r.author)}</span></h3>
      <div class="meta muted">⬇ ${fmtNum(r.downloads)} lượt tải · ♥ ${fmtNum(r.likes)} · cập nhật ${fmtAgo(r.lastModified)}${r.license ? ' · giấy phép ' + esc(r.license) : ''}${r.arch ? ' · kiến trúc ' + esc(r.arch) : ''}${r.params ? ' · ' + fmtParams(r.params) : ''}${r.contextLength ? ' · ngữ cảnh tối đa ' + fmtNum(r.contextLength) : ''}</div></div>
      <button class="btn sm" data-act="open-hf" data-url="${esc(r.url)}">Mở trên Hugging Face ↗</button></div>
    ${notes.map(n => `<div class="note">${n}</div>`).join('')}
    <div class="qtable">${chat.length ? `<div class="qr head"><span>Tệp mô hình</span><span>Lượng tử</span><span>Dung lượng</span><span>Máy bạn</span><span></span></div>` + chat.map(g => `<div class="qr${g.recommended ? ' rec' : ''}">
        <span class="fname" title="${esc(g.files.map(f => f.path).join('\n'))}">${esc(g.name)}${g.split ? ` <span class="tag">${g.parts} phần · tải tất cả</span>` : ''}${g.recommended ? ' <span class="tag ok">★ Khuyên dùng</span>' : ''}${g.folder ? `<div class="muted small">${esc(g.folder)}/</div>` : ''}</span>
        <span><b>${esc(g.quant || '—')}</b></span><span>${fmtBytes(g.size)}</span><span>${fitBadge(g.fit)}</span>
        <span class="foot" data-job="${esc(jobIdFor(r.id, g.files[0].path))}">${footHtml(g, `data-act="dl-group" data-key="${esc(g.key)}"`, g.files[0].path)}</span></div>`).join('') : '<div class="muted pad">Repo này không có tệp GGUF dùng để trò chuyện.</div>'}</div>
    ${other.length ? `<details class="others"><summary>Tệp không dùng để trò chuyện (${other.length})</summary>${other.map(g => `<div class="qr other"><span class="fname">${esc(g.name)}</span><span>${esc(g.quant || '')}</span><span>${fmtBytes(g.size)}</span><span class="muted small">${!g.complete ? 'Thiếu phần, không tải được' : g.kind === 'mmproj' ? 'Tệp thị giác (mmproj) · AIVN chưa hỗ trợ ảnh' : 'Mô hình embedding'}</span></div>`).join('')}</details>` : ''}`;
}

$('#view-discover').addEventListener('click', async (e) => {
  const fam = e.target.closest('[data-fam]'); if (fam) { disc.fam = fam.dataset.fam; renderCatalog(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  try {
    if (act === 'dl-cat') { const j = await A.dlStart({ catalogId: b.dataset.id }); paintJob(j); renderCatalog(); }
    if (act === 'dl-group') { const g = disc.repo.groups.find(x => x.key === b.dataset.key); const j = await A.dlStart({ repo: disc.repo.id, files: g.files.map(f => ({ path: f.path, size: f.size })), name: g.name, quant: g.quant }); paintJob(j); }
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
  $('#convoList').innerHTML = state.convos.map(c => `<div class="convo ${state.current && c.id === state.current.id ? 'active' : ''}" data-id="${c.id}"><span>${esc(c.title)}</span><button class="del" title="Xoá">✕</button></div>`).join('') || '<div class="muted" style="padding:8px;font-size:12.5px">Chưa có cuộc trò chuyện nào</div>';
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

function renderMessages() {
  const box = $('#messages');
  const msgs = state.current ? state.current.messages : [];
  if (!msgs.length) {
    box.innerHTML = `<div class="empty"><img class="logo-big" src="logo-tile.svg" alt="">
      <h2>Xin chào! Hôm nay bạn muốn hỏi gì?</h2><p>${state.status.loaded ? 'Mô hình đã sẵn sàng. Mọi thứ chạy ngay trên máy bạn, không cần Internet.' : 'Hãy chọn một mô hình ở thanh phía trên, hoặc vào <b>Khám phá</b> để tải mô hình đầu tiên.'}</p></div>`;
    return;
  }
  box.innerHTML = msgs.map((m, i) => {
    const atts = m.attachments && m.attachments.length ? `<div class="atts">${m.attachments.map(a => `<span class="att">${a.kind === 'image' && a.thumb && /^data:image\/jpeg;base64,/.test(a.thumb) ? `<img class="thumb" src="${a.thumb}" alt="">` : fileIcon(a.kind)} ${esc(a.name)} · ${fmtBytes(a.size)}</span>`).join('')}</div>` : '';
    const warn = (m.ocrNote ? `<div class="doc-warn ocr">🖼 ${esc(m.ocrNote)}.</div>` : '') + (m.docWarning ? `<div class="doc-warn">⚠ ${esc(m.docWarning)}</div>` : '');
    const copyBtn = m.role === 'assistant' && m.content && !m.error ? `<button class="copy-btn" data-copy="${i}" title="Sao chép câu trả lời">⧉ Sao chép</button>` : '';
    return `<div class="msg ${m.role}${m.error ? ' error' : ''}" data-i="${i}">${m.role === 'assistant' ? `<div class="who">AIVN${m.model ? ' · ' + esc(m.model) : ''}</div>` : ''}${atts}<div class="body">${m.role === 'assistant' ? md(m.content) : esc(m.content).replace(/\n/g, '<br>')}</div>${copyBtn}</div>${warn}`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

// ---------- Tệp đính kèm ----------
let pending = []; // [{id, name, size, kind, text, ok, loading}]
const MAX_FILES = 5;
function fileIcon(kind) { return kind === 'pdf' ? '📕' : kind === 'docx' ? '📘' : kind === 'image' ? '🖼' : '📄'; }
const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const OCR_NOTE = 'Mô hình hiện tại không nhìn được ảnh, AIVN đã đọc chữ trong ảnh';
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
  return { png: new Uint8Array(await png.arrayBuffer()), thumb: t.toDataURL('image/jpeg', 0.75), width: bmp.width, height: bmp.height };
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
        it.thumb = img.thumb; renderChips();
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
  el.innerHTML = pending.map(a => `<div class="chip${a.loading ? ' loading' : ''}${a.kind === 'image' ? ' img' : ''}" data-id="${a.id}" title="${esc(a.name)}${a.pages ? ' · ' + a.pages + ' trang' : ''}${a.kind === 'image' ? (a.loading ? ' · đang đọc chữ trong ảnh…' : ` · OCR ${a.ocrChars} ký tự, tin cậy ${a.ocrConf}%`) : ''}">${a.kind === 'image' && a.thumb ? `<img class="thumb" src="${a.thumb}" alt="">` : `<span class="ic">${fileIcon(a.kind)}</span>`}<span class="nm">${esc(a.name)}</span><span class="sz">${a.size ? fmtBytes(a.size) : ''}${a.pages ? ' · ' + a.pages + ' trang' : ''}${a.kind === 'image' ? (a.loading ? ' · đang đọc chữ…' : ` · ${a.ocrChars} ký tự`) : ''}</span><button type="button" title="Bỏ tệp này" aria-label="Bỏ tệp">✕</button></div>`).join('');
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
  let text = input.value.trim();
  if (state.generating) return;
  if (pending.some(a => a.loading)) { toast('Đang đọc tệp, vui lòng đợi một chút…'); return; }
  const docsToSend = pending.filter(a => a.ok);
  if (!text && docsToSend.length) text = docsToSend.every(a => a.kind === 'image') ? 'Hãy cho biết nội dung chữ trong ảnh và tóm tắt ý chính.' : 'Hãy tóm tắt nội dung chính của tài liệu đính kèm.';
  if (!text) return;
  if (!state.status.loaded) { toast('Hãy nạp một mô hình trước khi trò chuyện', true); return; }
  if (!state.current) state.current = { id: uid(), title: text.slice(0, 48), messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  const conv = state.current;
  const userMsg = { role: 'user', content: text };
  if (docsToSend.length) userMsg.attachments = docsToSend.map(a => ({ name: a.name, size: a.size, kind: a.kind, pages: a.pages || null, ...(a.kind === 'image' ? { thumb: a.thumb, ocrChars: a.ocrChars } : {}) }));
  if (docsToSend.some(a => a.kind === 'image')) userMsg.ocrNote = OCR_NOTE;
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
      content: m.context && i === lastCtxIdx ? m.context : (m.attachments ? `[Đã gửi kèm: ${m.attachments.map(a => a.name + (a.kind === 'image' ? ' (ảnh, đã đọc chữ bằng OCR)' : '')).join(', ')}]\n` : '') + m.content })),
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

// ---------- Giao diện sáng / tối ----------
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(t) {
  t = ['light', 'dark', 'system'].includes(t) ? t : 'light';
  const dark = t === 'dark' || (t === 'system' && darkMq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  for (const b of document.querySelectorAll('#themeRow button')) b.classList.toggle('on', b.dataset.theme === t);
}
darkMq.addEventListener('change', () => applyTheme(state.settings && state.settings.theme));
$('#themeRow').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-theme]'); if (!b) return;
  applyTheme(b.dataset.theme); state.settings = await A.setSettings({ theme: b.dataset.theme });
});
// ---------- Khởi động ----------
(async () => {
  state.settings = await A.getSettings();
  applyTheme(state.settings.theme);
  bindSettings();
  for (const j of await A.dlList()) jobs.set(j.id, j);
  renderDlPanel();
  setStatus(await A.modelStatus());
  await Promise.all([refreshModels(), loadConvos(), refreshServer()]);
  renderMessages();
  const info = await A.info();
  const h = info.hardware || {};
  $('#hwInfo').innerHTML = `RAM: ${fmtBytes(h.ram)} · ${h.cpus || '?'} luồng CPU<br>Tăng tốc: ${h.gpu ? '<b style="color:var(--accent-ink)">GPU ' + esc(String(h.gpu)) + '</b>' : 'CPU'}${h.vram && h.vram.total ? ' · VRAM ' + fmtBytes(h.vram.total) : ''}<br>Phiên bản ${info.version}`;
  $('#aboutVer').textContent = 'phiên bản ' + info.version;
  paintUpdate(await A.updateState());
  $('#modelsDir').textContent = 'Thư mục lưu: ' + info.paths.models;
})();
