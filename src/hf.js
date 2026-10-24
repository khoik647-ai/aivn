// Tìm kiếm mô hình GGUF trên Hugging Face (API công khai) và phân tích danh sách tệp của một repo.
// Không phụ thuộc Electron để có thể kiểm thử bằng node.
const ARCHS = require('./llama-archs.json');

const HF = 'https://huggingface.co';
const UA = 'AIVN-desktop';
const SORTS = { downloads: 'downloads', newest: 'lastModified', likes: 'likes' };
const QUANT_PREF = ['Q4_K_M', 'Q4_K_S', 'IQ4_XS', 'Q4_K_XL', 'Q4_0', 'IQ4_NL', 'Q5_K_M', 'Q5_K_S', 'Q6_K', 'MXFP4', 'Q8_0', 'Q3_K_L', 'Q3_K_M', 'Q3_K_XL', 'IQ3_M', 'Q3_K_S', 'Q2_K', 'IQ2_M'];
const SPLIT_RE = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;

function authHeaders(url, token) {
  const h = { 'User-Agent': UA, Accept: 'application/json' };
  try { if (token && new URL(url).hostname === 'huggingface.co') h.Authorization = 'Bearer ' + token; } catch {}
  return h;
}

class HfError extends Error { constructor(msg, status) { super(msg); this.status = status; this.userMessage = msg; } }

async function getJson(url, { token, fetchImpl = fetch, timeout = 20000 } = {}) {
  let res;
  try { res = await fetchImpl(url, { headers: authHeaders(url, token), signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new HfError('Không kết nối được Hugging Face. Hãy kiểm tra Internet.', 0); }
  if (res.status === 401 || res.status === 403) throw new HfError('Repo này yêu cầu đăng nhập Hugging Face. Hãy nhập HF token trong mục Khám phá → Token Hugging Face.', res.status);
  if (res.status === 404) throw new HfError('Không tìm thấy repo trên Hugging Face.', 404);
  if (res.status === 429) throw new HfError('Hugging Face đang giới hạn số lượt truy vấn, vui lòng thử lại sau ít phút.', 429);
  if (!res.ok) throw new HfError(`Hugging Face trả về lỗi ${res.status}.`, res.status);
  return res.json();
}

function archSupported(arch) {
  if (!arch) return null;
  const a = String(arch).toLowerCase();
  // một số tên bị trình biên dịch gộp làm hậu tố của tên dài hơn (vd. "qwen2" nằm trong "rwkv6qwen2")
  return ARCHS.archs.some(x => x === a || (a.length >= 4 && x.endsWith(a)));
}

function licenseOf(m) {
  const t = (m.tags || []).find(x => x.startsWith('license:'));
  return (m.cardData && m.cardData.license) || (t ? t.slice(8) : null);
}

function classifyRepo(m) {
  const tags = m.tags || [];
  const pipe = m.pipeline_tag || '';
  const arch = (m.gguf && m.gguf.architecture) || null;
  const embedding = /sentence-similarity|feature-extraction/.test(pipe) || tags.includes('sentence-transformers') || /bert|embed/i.test(arch || '') || /embed/i.test(m.id);
  const vision = /image-text-to-text|image-to-text|visual-question/.test(pipe) || tags.includes('vision');
  return { embedding, vision, arch };
}

function summarize(m) {
  const { embedding, vision, arch } = classifyRepo(m);
  const [author, ...rest] = m.id.split('/');
  return {
    id: m.id, author: m.author || author, name: rest.join('/'),
    downloads: m.downloads || 0, likes: m.likes || 0, lastModified: m.lastModified || m.createdAt || null,
    license: licenseOf(m), gated: m.gated ? String(m.gated) : false, pipeline: m.pipeline_tag || null,
    arch, archSupported: archSupported(arch), params: (m.gguf && m.gguf.total) || null,
    experts: (m.gguf && m.gguf.expert_count) || null, expertsUsed: (m.gguf && m.gguf.expert_used_count) || null,
    contextLength: (m.gguf && m.gguf.context_length) || null, vision, embedding,
  };
}

async function search({ q = '', sort = 'downloads', limit = 30, token, fetchImpl } = {}) {
  const p = new URLSearchParams({ filter: 'gguf', sort: SORTS[sort] || 'downloads', direction: '-1', limit: String(Math.min(100, limit)) });
  if (q.trim()) p.set('search', q.trim());
  for (const e of ['author', 'downloads', 'likes', 'lastModified', 'gated', 'pipeline_tag', 'tags', 'gguf']) p.append('expand[]', e);
  const list = await getJson(`${HF}/api/models?${p}`, { token, fetchImpl });
  return list.map(summarize);
}

function parseQuant(file) {
  const base = file.split('/').pop().replace(SPLIT_RE, '$1').replace(/\.gguf$/i, '');
  const m = base.match(/(?:^|[-_.])((?:UD-)?(?:I?Q\d(?:_[0-9A-Z]+)*|BF16|F16|F32|FP16|MXFP4(?:_MOE)?|TQ\d_\d))$/i)
    || base.match(/(?:^|[-_.])((?:UD-)?(?:I?Q\d(?:_[0-9A-Z]+)*|BF16|F16|F32|FP16|MXFP4(?:_MOE)?|TQ\d_\d))(?=[-_.])/i);
  return m ? m[1].toUpperCase().replace(/^UD-/, '').replace(/^FP16$/, 'F16') : null;
}

function fileKind(file, repoInfo) {
  const n = file.split('/').pop();
  if (/mmproj/i.test(n)) return 'mmproj';
  if (repoInfo && repoInfo.embedding) return 'embedding';
  if (/embed/i.test(n)) return 'embedding';
  return 'chat';
}

// Ước lượng cho máy này: Chạy tốt / Chạy chậm / Không đủ bộ nhớ.
// hw.vram.total là VRAM RIÊNG của GPU rời (không tính bộ nhớ dùng chung của GPU tích hợp).
const GBy = 1024 ** 3;
// Điều khiển màn hình cần phản hồi nhanh (mỗi bước một ảnh chụp): chỉ gợi ý khi vừa HẲN GPU rời, vừa nửa RAM Mac, hoặc nhỏ nếu chạy CPU
function screenFit(size, hw) {
  if (!size || !hw || !hw.ram) return false;
  const need = size * 1.1 + 0.9 * GBy; // + ảnh chụp màn hình (token ảnh) và ngữ cảnh
  if (hw.gpu === 'metal') return need <= hw.ram * 0.5;
  const vram = hw.gpu && hw.vram && hw.vram.total ? hw.vram.total : 0;
  if (vram) return need <= vram * 0.98;
  return size <= 3.0e9 && need <= hw.ram * 0.5;
}
// Mức chạy được trên máy này: xem fit.js (nhóm Chạy mượt / Chạy chậm / Không chạy được, kèm tốc độ và bộ nhớ ước tính)
function fitFor(size, hw, meta = {}) {
  if (!size || !hw || !hw.ram) return null;
  return require('./fit').machineFit({ size, ...meta }, hw, { ctx: meta.ctx, server: meta.server, kvScale: meta.kvScale });
}

// Gom tệp .gguf: các phần -00001-of-0000N thành một mô hình
function groupFiles(entries, repoInfo = {}, hw = null) {
  const groups = new Map();
  for (const e of entries) {
    if (e.type && e.type !== 'file') continue;
    const p = e.path || e.rfilename;
    if (!p || !/\.gguf$/i.test(p)) continue;
    const size = (e.lfs && e.lfs.size) || e.size || 0;
    const m = p.match(SPLIT_RE);
    const key = m ? `${m[1]}-of-${m[3]}` : p.replace(/\.gguf$/i, '');
    let g = groups.get(key);
    if (!g) { g = { key, files: [], parts: m ? Number(m[3]) : 1, split: !!m }; groups.set(key, g); }
    g.files.push({ path: p, size, part: m ? Number(m[2]) : 1 });
  }
  const out = [];
  for (const g of groups.values()) {
    g.files.sort((a, b) => a.part - b.part);
    const first = g.files[0].path;
    const size = g.files.reduce((s, f) => s + f.size, 0);
    const kind = fileKind(first, repoInfo);
    out.push({
      key: g.key, name: (g.split ? g.key.replace(/-of-\d{5}$/, '') : g.key).split('/').pop(), folder: g.key.includes('/') ? g.key.slice(0, g.key.lastIndexOf('/')) : '',
      quant: parseQuant(first), size, parts: g.parts, split: g.split, files: g.files,
      complete: g.files.length === g.parts && g.files.every((f, i) => f.part === i + 1), kind,
      fit: kind === 'chat' ? fitFor(size, hw) : null,
    });
  }
  out.sort((a, b) => (a.kind === 'chat' ? 0 : 1) - (b.kind === 'chat' ? 0 : 1) || a.size - b.size);
  recommendQuant(out);
  return out;
}
// Khuyên dùng (giống LM Studio): bản lượng tử CHẤT LƯỢNG CAO NHẤT còn nằm trọn VRAM (Chạy mượt) trên máy có GPU;
// không bản nào chạy mượt → Q4_K_M; không có Q4_K_M → bản theo thứ tự ưu tiên còn chạy được
const QUALITY = ['Q8_0', 'Q6_K', 'Q6_K_L', 'Q5_K_M', 'Q5_K_L', 'Q5_K_S', 'Q4_K_M', 'Q4_K_L', 'Q4_K_S', 'IQ4_XS', 'IQ4_NL', 'Q4_0', 'Q3_K_L', 'Q3_K_M', 'IQ3_M', 'IQ3_XS', 'Q3_K_S', 'Q2_K_L', 'Q2_K', 'IQ2_M'];
function recommendQuant(groups) {
  for (const g of groups) { delete g.recommended; delete g.recWhy; }
  const chat = groups.filter(g => g.kind === 'chat' && g.complete);
  const q = (g) => { const i = QUALITY.indexOf(String(g.quant || '').toUpperCase()); return i < 0 ? 99 : i; };
  const rank = (g) => { const i = QUANT_PREF.indexOf(g.quant || ''); return i < 0 ? 99 : i; };
  const Q4 = QUALITY.indexOf('Q4_0'); // dưới Q4 chất lượng giảm rõ: không tự khuyên dùng khi còn bản Q4 chạy được
  // chỉ máy có GPU (nằm trọn VRAM): chạy CPU thì bản nhỏ nhanh hơn rõ → Q4_K_M
  let rec = [...chat].filter(g => q(g) <= Q4 && g.fit && g.fit.level === 'fit' && g.fit.vram > 0 && !g.fit.ram).sort((a, b) => q(a) - q(b) || (a.split ? 1 : 0) - (b.split ? 1 : 0))[0];
  let why = rec ? 'Chất lượng cao nhất còn nằm trọn VRAM trên máy này' : null;
  if (!rec) { rec = chat.find(g => g.quant === 'Q4_K_M' && !g.split && (!g.fit || g.fit.level !== 'big')) || chat.find(g => g.quant === 'Q4_K_M' && (!g.fit || g.fit.level !== 'big')); why = rec ? 'Cân bằng chất lượng và dung lượng (không bản Q4 trở lên nào nằm trọn VRAM)' : null; }
  if (!rec) { rec = [...chat].sort((a, b) => rank(a) - rank(b) || a.size - b.size).find(g => !g.fit || g.fit.level !== 'big') || chat[0]; why = rec ? 'Bản phù hợp nhất còn chạy được trên máy này' : null; }
  if (rec) { rec.recommended = true; rec.recWhy = why; }
  return rec || null;
}

async function repoFiles(repo, { token, hw, fetchImpl } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new HfError('Tên repo không hợp lệ.', 400);
  const p = new URLSearchParams();
  for (const e of ['author', 'downloads', 'likes', 'lastModified', 'gated', 'pipeline_tag', 'tags', 'gguf', 'cardData']) p.append('expand[]', e);
  const [info, tree] = await Promise.all([
    getJson(`${HF}/api/models/${repo}?${p}`, { token, fetchImpl }),
    getJson(`${HF}/api/models/${repo}/tree/main?recursive=true`, { token, fetchImpl }),
  ]);
  const sum = summarize({ ...info, id: info.id || repo });
  const groups = groupFiles(tree, sum, hw);
  const mmproj = pickMmproj(groups);
  if (mmproj) for (const g of groups) if (g.kind === 'chat') g.vision = true;
  // độ vừa máy từng bản lượng tử tính giống thẻ Khám phá: theo số tham số (tốc độ ước tính) + phần nhìn ảnh tải kèm.
  // MoE không có “-A3B” trong tên (gpt-oss-20b) lấy expert_count / expert_used_count từ siêu dữ liệu GGUF.
  const pstr = paramLabel({ name: sum.name || repo, params: sum.params, experts: sum.experts, expertsUsed: sum.expertsUsed });
  if (hw) { for (const g of groups) if (g.kind === 'chat') g.fit = fitFor(g.size, hw, { params: pstr, mmprojSize: mmproj ? mmproj.size : 0 }); recommendQuant(groups); }
  return { ...sum, url: `${HF}/${repo}`, groups, mmproj, vision: sum.vision || !!mmproj };
}

// Chọn tệp thị giác (mmproj) phù hợp nhất trong repo: ưu tiên Q8_0 (nhỏ, chất lượng gần như gốc), rồi F16/BF16/F32
const MMPROJ_PREF = ['Q8_0', 'F16', 'BF16', 'F32'];
function pickMmproj(groups) {
  const mm = groups.filter(g => g.kind === 'mmproj' && g.complete && !g.split);
  if (!mm.length) return null;
  const rank = (g) => { const q = (g.quant || (/f16/i.test(g.name) ? 'F16' : '')).toUpperCase(); const i = MMPROJ_PREF.indexOf(q); return i < 0 ? 9 : i; };
  const best = [...mm].sort((a, b) => rank(a) - rank(b) || a.size - b.size)[0];
  return { path: best.files[0].path, size: best.size, quant: best.quant || null, name: best.name };
}
// Chọn mmproj trong một thư mục (dùng khi quét mô hình trên máy)
function pickMmprojFile(names) {
  const mm = names.filter(n => /mmproj/i.test(n) && /\.gguf$/i.test(n));
  if (!mm.length) return null;
  const rank = (n) => { const q = (parseQuant(n) || (/f16/i.test(n) ? 'F16' : '')).toUpperCase(); const i = MMPROJ_PREF.indexOf(q); return i < 0 ? 9 : i; };
  return [...mm].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0];
}

function resolveUrl(repo, file) { return `${HF}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}`; }
// “20.00B” hoặc “20.00B-A2.5B”. Hậu tố -A…B trong tên thắng; không có thì tính từ expert_count / expert_used_count.
function paramLabel({ name, params, experts, expertsUsed } = {}) {
  if (!(params > 0)) return null;
  const fromName = (/-A\d+(?:\.\d+)?B/i.exec(String(name || '')) || [''])[0];
  let suffix = fromName;
  if (!suffix && experts > 1 && expertsUsed > 0 && expertsUsed < experts) {
    const active = (params / 1e9) * (expertsUsed / experts);
    const a = active >= 10 ? String(Math.round(active)) : String(Math.round(active * 10) / 10);
    suffix = `-A${a}B`;
  }
  return `${(params / 1e9).toFixed(2)}B${suffix}`;
}

module.exports = { recommendQuant, QUALITY, screenFit, search, repoFiles, groupFiles, pickMmproj, pickMmprojFile, parseQuant, fitFor, archSupported, resolveUrl, paramLabel, summarize, HfError, QUANT_PREF, SPLIT_RE, llamaCpp: ARCHS.llamaCpp };
