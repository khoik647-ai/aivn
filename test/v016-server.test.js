'use strict';
// 0.16 máy chủ API kiểu LM Studio: CORS tắt mặc định, khoá API, LAN, TTL; bảng lượng tử theo độ vừa máy; Mô hình của tôi dạng bảng
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { createApiServer, keyOk } = require('../src/server');

async function withServer(opts, host, fn) {
  const engine = { status: () => ({ loaded: true, id: 'm1' }), countTokens: () => 1 };
  const api = createApiServer({ engine, models: () => [{ id: 'm1', mtime: Date.now() }], ensureModel: async () => {}, log: () => {}, getOpts: () => opts });
  const port = 20000 + Math.floor(Math.random() * 20000);
  await api.start(port, host);
  try { return await fn(`http://127.0.0.1:${port}`, api); } finally { await api.stop(); }
}
test('CORS tắt (mặc định): không có Access-Control-Allow-Origin; bật: có *', async () => {
  await withServer({ cors: false }, '127.0.0.1', async (u) => {
    const r = await fetch(u + '/v1/models', { headers: { origin: 'https://evil.example' } }); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
    const o = await fetch(u + '/v1/models', { method: 'OPTIONS' }); assert.strictEqual(o.headers.get('access-control-allow-origin'), null);
  });
  await withServer({ cors: true }, '127.0.0.1', async (u) => { const r = await fetch(u + '/v1/models'); assert.strictEqual(r.headers.get('access-control-allow-origin'), '*'); });
});
test('khoá API: thiếu/sai → 401; Bearer hoặc x-api-key đúng → 200', async () => {
  await withServer({ apiKey: 'aivn-secret-1' }, '127.0.0.1', async (u) => {
    assert.strictEqual((await fetch(u + '/v1/models')).status, 401);
    const bad = await fetch(u + '/v1/models', { headers: { authorization: 'Bearer nope' } }); assert.strictEqual(bad.status, 401); assert.match((await bad.json()).error.message, /khoá API/);
    assert.strictEqual((await fetch(u + '/v1/models', { headers: { authorization: 'Bearer aivn-secret-1' } })).status, 200);
    assert.strictEqual((await fetch(u + '/v1/models', { headers: { 'x-api-key': 'aivn-secret-1' } })).status, 200);
  });
  assert.ok(!keyOk({ headers: { authorization: 'Bearer aivn-secret-' } }, 'aivn-secret-1'));
});
test('LAN: lắng nghe 0.0.0.0, trạng thái báo đúng địa chỉ', async () => {
  await withServer({ apiKey: 'k' }, '0.0.0.0', async (u, api) => { assert.strictEqual(api.status().host, '0.0.0.0'); assert.strictEqual((await fetch(u + '/v1/models', { headers: { authorization: 'Bearer k' } })).status, 200); });
});
test('main: LAN bắt buộc khoá API; khoá/LAN/CORS/TTL không đổi được qua settings:set; khoá không gửi sang giao diện; TTL chỉ gỡ mô hình API tự nạp', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'src/main.js'), 'utf8');
  assert.match(m, /if \(settings\.data\.apiLan && !settings\.data\.apiKey\) throw new Error\('Mở cho mạng LAN cần có khoá API/);
  assert.match(m, /apiKey: _k, apiLan: _l, apiCors: _c, apiTtlMin: _t, \.\.\.rest \} = patch/);
  assert.match(m, /const \{ hfToken, cloudBrain: _cb, apiKey, \.\.\.rest \} = settings\.data; return \{ \.\.\.rest, hfTokenSet: !!hfToken, apiKeySet: !!apiKey/);
  assert.match(m, /apiLan: false, apiCors: false, apiKey: '', apiTtlMin: 0/);
  assert.match(m, /if \(!apiJit \|\| ttl <= 0\) return;/);
});
test('bảng lượng tử: khuyên bản chất lượng cao nhất còn nằm trọn VRAM, không khuyên dưới Q4 khi còn Q4 chạy được', () => {
  const hf = require('../src/hf');
  const mk = (v) => ({ ram: 16 * 2 ** 30, gpu: 'cuda', vram: { total: v * 2 ** 30, free: v * 2 ** 30 }, devices: [{ name: 'g', vram: v * 2 ** 30 }] });
  const tree = ['Q2_K', 'Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'].map((q, i) => ({ type: 'file', path: 'M-4B-' + q + '.gguf', size: [1.6, 2.5, 2.9, 3.3, 4.3][i] * 2 ** 30 }));
  const pick = (v) => { const hw = mk(v); const g = hf.groupFiles(tree, {}, hw); for (const x of g) x.fit = hf.fitFor(x.size, hw, { params: '4.02B' }); return hf.recommendQuant(g); };
  assert.strictEqual(pick(12).quant, 'Q8_0'); assert.match(pick(12).recWhy, /nằm trọn VRAM/);
  assert.strictEqual(pick(4).quant, 'Q4_K_M');
  const g = hf.groupFiles(tree, {}, mk(12)); for (const x of g) x.fit = hf.fitFor(x.size, mk(12), { params: '4.02B' }); assert.ok(g.every(x => x.fit && x.fit.text && /token\/giây/.test(x.fit.text)), 'mỗi dòng có tốc độ ước tính');
});
test('giao diện Máy chủ + Mô hình của tôi có đủ điều khiển', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/index.html'), 'utf8');
  for (const id of ['srvLan', 'srvCors', 'srvKeyGen', 'srvTtl', 'srvLoaded', 'mmFilter', 'mmKind']) assert.match(html, new RegExp(`id="${id}"`), id);
});
