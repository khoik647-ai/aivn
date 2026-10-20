const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const hf = require('../src/hf');
const { createDownloader } = require('../src/downloader');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const GB = 1024 ** 3;

test('gom tệp chia phần -0000N-of-0000M thành một mô hình', () => {
  const groups = hf.groupFiles(fx('hf-tree-coder7b.json'), {}, { ram: 16 * GB });
  const split = groups.find(g => g.name === 'qwen2.5-coder-7b-instruct-q4_k_m' && g.split);
  assert.ok(split, 'có nhóm Q4_K_M chia phần');
  assert.strictEqual(split.parts, 2); assert.strictEqual(split.files.length, 2); assert.ok(split.complete);
  assert.strictEqual(split.size, 3993201376 + 689872288);
  assert.deepStrictEqual(split.files.map(f => f.part), [1, 2]);
  const fp16 = groups.find(g => g.quant === 'F16' && g.split);
  assert.strictEqual(fp16.parts, 4);
  // không có tệp phần nào bị hiện riêng lẻ
  assert.ok(!groups.some(g => /-0000[2-9]-of-/.test(g.name)));
  const rec = groups.filter(g => g.recommended);
  assert.strictEqual(rec.length, 1); assert.strictEqual(rec[0].quant, 'Q4_K_M'); assert.strictEqual(rec[0].split, false);
});

test('nhận diện mmproj là tệp không dùng để trò chuyện', () => {
  const groups = hf.groupFiles(fx('hf-tree-gemma3-4b.json'), { vision: true }, { ram: 8 * GB });
  const mm = groups.filter(g => g.kind === 'mmproj');
  assert.ok(mm.length >= 1);
  assert.ok(groups.find(g => g.recommended).quant === 'Q4_K_M');
  assert.ok(mm.every(g => !g.recommended && g.fit === null));
});

test('nhận lượng tử từ tên tệp', () => {
  const cases = { 'Qwen_Qwen3-0.6B-Q4_K_M.gguf': 'Q4_K_M', 'gpt-oss-20b-MXFP4.gguf': 'MXFP4', 'Arcee-VyLinh.Q4_K_M.gguf': 'Q4_K_M',
    'UD-Q4_K_XL/Qwen3-30B-A3B-UD-Q4_K_XL-00001-of-00002.gguf': 'Q4_K_XL', 'x-IQ4_XS.gguf': 'IQ4_XS', 'model-bf16.gguf': 'BF16', 'readme.gguf': null };
  for (const [f, q] of Object.entries(cases)) assert.strictEqual(hf.parseQuant(f), q, f);
});

test('ước lượng mức vừa máy', () => {
  assert.strictEqual(hf.fitFor(0.5 * GB, { ram: 8 * GB }).level, 'fit');
  assert.strictEqual(hf.fitFor(5 * GB, { ram: 8 * GB }).level, 'slow');
  assert.strictEqual(hf.fitFor(12 * GB, { ram: 8 * GB }).level, 'big');
  assert.strictEqual(hf.fitFor(7 * GB, { ram: 8 * GB, gpu: 'cuda', vram: { total: 12 * GB } }).level, 'fit');
});

test('kiến trúc llama.cpp đi kèm hỗ trợ Qwen3, Gemma 3, gpt-oss', () => {
  for (const a of ['qwen2', 'qwen3', 'qwen3moe', 'gemma3', 'llama', 'phi3', 'gpt-oss']) assert.strictEqual(hf.archSupported(a), true, a);
  assert.strictEqual(hf.archSupported('kien-truc-khong-co'), false);
});

// Máy chủ giả lập HF: /resolve chuyển hướng 302 sang "CDN" (host khác), CDN hỗ trợ Range
function fakeHf(body, { failAt } = {}) {
  const seen = [];
  let cut = failAt;
  const srv = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, auth: req.headers.authorization || null, range: req.headers.range || null });
    if (req.url.startsWith('/repo/resolve/')) { res.writeHead(302, { Location: `http://localhost:${srv.address().port}/cdn/file` }); return res.end(); }
    if (req.url === '/cdn/file') {
      const m = /bytes=(\d+)-/.exec(req.headers.range || ''); const start = m ? Number(m[1]) : 0;
      const chunk = body.subarray(start);
      res.writeHead(m ? 206 : 200, { 'Content-Length': chunk.length, 'Accept-Ranges': 'bytes' });
      if (cut != null && !m) { res.write(chunk.subarray(0, cut)); cut = null; return setTimeout(() => res.destroy(), 300); } // rớt mạng giữa chừng
      return res.end(chunk);
    }
    res.writeHead(404); res.end();
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` })));
}
const waitDone = (dl, id) => new Promise((resolve, reject) => { const iv = setInterval(() => { const j = dl.get(id); if (j && j.status === 'done') { clearInterval(iv); resolve(j); } if (j && j.status === 'error') { clearInterval(iv); reject(new Error(j.error)); } }, 50); });

test('tải: theo chuyển hướng sang CDN, không gửi token ra ngoài, tự tải tiếp khi rớt mạng', async () => {
  const body = Buffer.alloc(3 * 1024 * 1024, 7); for (let i = 0; i < body.length; i += 4096) body[i] = i % 251;
  const { srv, seen, base } = await fakeHf(body, { failAt: 1024 * 1024 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-dl-'));
  // "huggingface.co" được trỏ về máy chủ giả qua 127.0.0.1, CDN là "localhost" (host khác)
  const fetchImpl = (u, o) => fetch(u.replace('https://huggingface.co', base), o);
  const dl = createDownloader({ dir, getToken: () => 'hf_BIMAT', fetchImpl });
  const job = dl.enqueue({ repo: 'tac-gia/repo', files: [{ path: 'm-Q4_K_M.gguf', size: body.length }], urlFor: () => 'https://huggingface.co/repo/resolve/main/m-Q4_K_M.gguf' });
  const j = await waitDone(dl, job.id);
  const out = fs.readFileSync(j.dest);
  assert.ok(out.equals(body), 'nội dung khớp');
  assert.strictEqual(seen.find(s => s.url.startsWith('/repo/')).auth, 'Bearer hf_BIMAT', 'token gửi tới huggingface.co');
  assert.ok(seen.filter(s => s.url === '/cdn/file').every(s => s.auth === null), 'không gửi token tới CDN');
  assert.ok(seen.some(s => s.url === '/cdn/file' && /^bytes=\d+-$/.test(s.range || '')), 'đã tải tiếp bằng Range');
  srv.close();
});

test('tải: tạm dừng rồi tiếp tục từ phần đã có (.part)', async () => {
  const body = Buffer.alloc(8 * 1024 * 1024, 3);
  const { srv, seen, base } = await fakeHf(body);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-dl-'));
  const slow = async (u, o) => { const r = await fetch(u.replace('https://huggingface.co', base), o); if (!r.body) return r;
    const reader = r.body.getReader(); const s = new ReadableStream({ async pull(c) { try { await new Promise(x => setTimeout(x, 5)); const { done, value } = await reader.read(); if (done) c.close(); else c.enqueue(value); } catch (e) { c.error(e); } }, cancel() { reader.cancel().catch(() => {}); } });
    return new Response(s, { status: r.status, headers: r.headers }); };
  const dl = createDownloader({ dir, fetchImpl: slow });
  const job = dl.enqueue({ repo: 'a/b', files: [{ path: 'x.gguf', size: body.length }], urlFor: () => 'https://huggingface.co/repo/resolve/main/x.gguf' });
  await new Promise(r => setTimeout(r, 150));
  dl.pause(job.id);
  await new Promise(r => setTimeout(r, 200));
  assert.strictEqual(dl.get(job.id).status, 'paused');
  const part = fs.statSync(dl.destFor('a/b', 'x.gguf') + '.part').size;
  assert.ok(part > 0 && part < body.length, 'có tệp .part dở dang');
  dl.resume(job.id);
  const j = await waitDone(dl, job.id);
  assert.ok(fs.readFileSync(j.dest).equals(body));
  assert.ok(seen.some(s => s.range === `bytes=${part}-` || (s.range && Number(s.range.slice(6, -1)) >= part)), 'tiếp tục từ byte đã có');
  srv.close();
});

test('tải: hàng đợi chạy tối đa 2 mô hình cùng lúc', async () => {
  const body = Buffer.alloc(512 * 1024, 1);
  const { srv, base } = await fakeHf(body);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-dl-'));
  const dl = createDownloader({ dir, fetchImpl: (u, o) => fetch(u.replace('https://huggingface.co', base), o), maxConcurrent: 2 });
  const ids = [1, 2, 3].map(i => dl.enqueue({ repo: 'a/b', files: [{ path: `m${i}.gguf`, size: body.length }], urlFor: () => 'https://huggingface.co/repo/resolve/main/x' }).id);
  assert.deepStrictEqual(dl.list().map(j => j.status).sort(), ['downloading', 'downloading', 'queued']);
  for (const id of ids) await waitDone(dl, id);
  srv.close();
});

test('tìm kiếm thật trên Hugging Face (cần mạng; AIVN_LIVE=1)', { skip: process.env.AIVN_LIVE !== '1' }, async () => {
  const r = await hf.search({ q: 'qwen3 0.6b', sort: 'downloads' });
  assert.ok(r.length > 0); assert.ok(r[0].downloads >= r[r.length - 1].downloads);
  const repo = await hf.repoFiles('Qwen/Qwen2.5-Coder-7B-Instruct-GGUF', { hw: { ram: 16 * GB } });
  assert.ok(repo.groups.some(g => g.split && g.parts === 2 && g.quant === 'Q4_K_M'));
});
