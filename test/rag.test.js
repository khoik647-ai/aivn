// Kiểm thử hỏi đáp tài liệu (RAG), API embeddings và nhận diện mô hình nhìn ảnh: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chunkDocument, createRagStore, buildRagContent } = require('../src/rag');
const { extractFile } = require('../src/docs');
const { createApiServer } = require('../src/server');
const hf = require('../src/hf');
const catalog = require('../src/catalog');

// Bộ nhúng giả: túi từ băm vào 256 chiều, chuẩn hoá L2 (đủ để kiểm thử truy xuất mà không cần mô hình)
function fakeEmbed(texts) {
  return Promise.resolve(texts.map(t => {
    const v = new Float32Array(256);
    for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) { let h = 0; for (const c of w) h = (h * 31 + c.codePointAt(0)) >>> 0; v[h % 256] += 1; }
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map(x => x / n);
  }));
}

test('Chia đoạn ~500 token, có gối đầu, giữ số và trang', () => {
  let t = '';
  for (let p = 1; p <= 6; p++) { t += `[Trang ${p}]\n`; for (let i = 0; i < 25; i++) t += `Câu ${i} trang ${p}: doanh thu đạt 2.750 tấn, tỷ lệ 63,8%. `; t += '\n\n'; }
  const c = chunkDocument(t);
  assert.ok(c.length >= 4);
  for (const x of c) assert.ok(x.tokens <= 520, 'đoạn quá dài: ' + x.tokens);
  assert.ok(c.every(x => /2\.750 tấn/.test(x.text)), 'số 2.750 bị cắt');
  // gối đầu: câu cuối của đoạn trước xuất hiện ở đầu đoạn sau
  const lastSent = c[0].text.split(/(?<=\.)\s+/).pop();
  assert.ok(c[1].text.includes(lastSent));
  assert.equal(c[0].page, 1);
  assert.ok(c[c.length - 1].pageEnd === 6);
});

test('RAG trên PDF 34 trang: lấy đúng dữ kiện ở giữa tài liệu, lưu và nạp lại chỉ mục', async () => {
  const d = await extractFile(path.join(__dirname, 'fixtures', 'bao-cao-sao-mai-2025.pdf'));
  assert.equal(d.pages, 34);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-rag-'));
  const s1 = createRagStore(dir);
  const add = await s1.addDocuments('c1', [{ name: 'bao-cao.pdf', text: d.text, kind: 'pdf', pages: 34 }], { embed: fakeEmbed, model: 'fake' });
  assert.ok(add[0].chunks > 30);
  const s2 = createRagStore(dir); // như khi mở lại ứng dụng
  const r = await s2.retrieve('c1', 'Mã dự án SM-4471-LOTUS có ngân sách bao nhiêu?', { embed: fakeEmbed, model: 'fake', k: 3, budget: 2000 });
  assert.match(r.block, /38,6 tỷ đồng/);
  assert.ok(r.sources.some(x => x.page === 17 || x.pageEnd === 17));
  assert.match(r.block, /TRÍCH ĐOẠN \[bao-cao\.pdf, đoạn \d+, trang/);
  assert.match(buildRagContent('q', r.block), /Câu hỏi: q$/);
  // trùng nội dung → dùng lại chỉ mục, không nhúng lại
  let calls = 0; const counting = (t) => { calls++; return fakeEmbed(t); };
  const again = await s2.addDocuments('c1', [{ name: 'ban-sao.pdf', text: d.text }], { embed: counting, model: 'fake' });
  assert.equal(again[0].reused, true); assert.equal(calls, 0);
  // đổi mô hình nhúng → chỉ mục cũ không dùng
  assert.equal(await createRagStore(dir).retrieve('c1', 'x', { embed: fakeEmbed, model: 'khac' }), null);
  s2.remove('c1'); assert.equal(s2.has('c1'), false);
  assert.throws(() => s2.file('../x'), /không hợp lệ/);
});

function req(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }));
    });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
test('POST /v1/embeddings tương thích OpenAI', async () => {
  let installed = true;
  const api = createApiServer({ engine: { status: () => ({ loaded: false }) }, models: () => [], ensureModel: async () => {}, log: () => {},
    embeddings: { info: () => ({ id: 'bge-m3-q8_0', installed }), ensure: async (m) => { if (!installed) { const e = new Error('Chưa tải'); e.status = 400; throw e; } return { id: 'bge-m3-q8_0' }; },
      embed: fakeEmbed, count: async (t) => t.length * 5 } });
  const port = 18000 + Math.floor(Math.random() * 1000);
  await api.start(port);
  try {
    let r = await req(port, 'POST', '/v1/embeddings', { model: 'bge-m3-q8_0', input: 'Xin chào' });
    assert.equal(r.status, 200); assert.equal(r.json.object, 'list'); assert.equal(r.json.data.length, 1);
    assert.equal(r.json.data[0].object, 'embedding'); assert.equal(r.json.data[0].embedding.length, 256); assert.equal(r.json.usage.prompt_tokens, 5);
    r = await req(port, 'POST', '/v1/embeddings', { input: ['a', 'b c'], encoding_format: 'base64', dimensions: 64 });
    assert.equal(r.json.data.length, 2); assert.equal(Buffer.from(r.json.data[1].embedding, 'base64').length, 64 * 4);
    assert.equal((await req(port, 'POST', '/v1/embeddings', { input: [] })).status, 400);
    assert.equal((await req(port, 'POST', '/v1/embeddings', { input: [1, 2] })).status, 400);
    const m = await req(port, 'GET', '/v1/models');
    assert.ok(m.json.data.some(x => x.id === 'bge-m3-q8_0' && x.type === 'embedding'));
    installed = false;
    assert.equal((await req(port, 'POST', '/v1/embeddings', { input: 'x' })).status, 400);
  } finally { await api.stop(); }
});

test('Nhận diện tệp thị giác (mmproj) và danh mục mô hình nhìn ảnh', () => {
  const tree = [
    { type: 'file', path: 'Qwen3-VL-2B-Instruct-Q8_0.gguf', size: 1834427296 },
    { type: 'file', path: 'mmproj-Qwen3-VL-2B-Instruct-F16.gguf', size: 800 },
    { type: 'file', path: 'mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf', size: 445053056 },
  ];
  const groups = hf.groupFiles(tree, {}, null);
  const mm = hf.pickMmproj(groups);
  assert.equal(mm.path, 'mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf');
  assert.equal(groups.filter(g => g.kind === 'chat').length, 1);
  assert.equal(hf.pickMmprojFile(['model.gguf', 'mmproj-model-f16.gguf']), 'mmproj-model-f16.gguf');
  assert.equal(hf.pickMmprojFile(['model.gguf']), null);
  const vis = catalog.filter(c => c.vision);
  assert.ok(vis.length >= 3);
  for (const c of vis) { assert.ok(c.mmproj && c.mmproj.size > 1e7 && /mmproj/i.test(c.mmproj.file)); assert.ok(c.mmproj.url.startsWith('https://huggingface.co/' + c.repo + '/resolve/main/')); }
  assert.equal(catalog.EMBEDDING.file, 'bge-m3-q8_0.gguf');
});
