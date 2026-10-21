'use strict';
// Mô hình agent mới (Qwen3.5 / Holo3.1 / Holo4) — mục 1–6 trong /workspace/qa-0.16/agent-models-candidates.md + thang dự phòng laptop
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const Module = require('module');
// screen-control cần electron: giả lập tối thiểu để kiểm phần thuần (họ định vị, câu lệnh, đọc toạ độ)
const origLoad = Module._load;
Module._load = function (req, ...rest) { if (req === 'electron') return { desktopCapturer: {}, screen: {}, systemPreferences: {}, clipboard: {}, app: { isPackaged: false } }; return origLoad.call(this, req, ...rest); };
const SC = require('../src/screen-control');
Module._load = origLoad;
const L = require('../src/model-launch');
const N = require('../src/model-names');
const AE = require('../src/agent-eligibility');
const FB = require('../src/agent-bench-full');
const CAT = require('../src/catalog');

test('mục 1: Holo2/Holo3.1/Holo4 dùng họ holo3 (thang 0-1000, ô 32); Holo1.5 giữ điểm ảnh', () => {
  for (const id of ['holo-3.1-4b.iq4_xs', 'holo-3.1-9b.q4_k_m', 'holo4-35b-a3b-q4_k_m', 'Holo4-35B-A3B-q4_k_m.gguf', 'holo2-8b.q4_k_m']) assert.strictEqual(SC.groundingFamily(id), 'holo3', id);
  assert.deepStrictEqual(SC.FAMILY.holo3, { coords: 'norm1000', align: 32 });
  assert.strictEqual(SC.groundingFamily('holo1.5-7b.q4_k_m'), 'holo'); assert.strictEqual(SC.FAMILY.holo.coords, 'pixel');
  // cùng câu lệnh {"x","y"} của H Company; điểm (500, 250) ở thang 1000 → giữa ngang, 1/4 dọc dù ảnh 1280×720
  assert.match(SC.LOCATE_PROMPT('nút Gửi', 1280, 720, 'holo3'), /\{"x": int, "y": int\}/);
  const b = SC.parseBox('{"x": 500, "y": 250}', 1280, 720, { coords: SC.FAMILY.holo3.coords });
  assert.ok(Math.abs((b.x1 + b.x2) / 2 - 0.5) < 0.001 && Math.abs((b.y1 + b.y2) / 2 - 0.25) < 0.001, JSON.stringify(b));
});
test('mục 2–3: UI-Venus-2 tự nhận thang; Qwen3.5/3.6/3.8, Fara1.5, Gemma 4 có họ riêng; Qwen3 chữ không bị nhận nhầm', () => {
  assert.strictEqual(SC.groundingFamily('ui-venus-2-9b-q4_k_m'), 'venus2'); assert.strictEqual(SC.FAMILY.venus2.coords, 'auto');
  assert.strictEqual(SC.groundingFamily('ui-venus-ground-7b'), 'qwen25vl');
  for (const id of ['qwen3.5-2b-q4_k_m', 'qwen3.5-9b-q4_k_m', 'qwen3.6-27b-q4_k_m', 'qwen3.8-27b-ud-q4_k_m']) assert.strictEqual(SC.groundingFamily(id), 'qwen35', id);
  for (const id of ['qwen3-8b-q4_k_m', 'qwen_qwen3-4b', 'qwen3-30b-a3b']) assert.strictEqual(SC.groundingFamily(id), 'generic', id);
  assert.strictEqual(SC.groundingFamily('qwen3vl-8b-instruct-q4_k_m'), 'qwen3vl');
  assert.strictEqual(SC.groundingFamily('fara1.5-9b-q4_k_m'), 'fara'); assert.strictEqual(SC.FAMILY.fara.coords, 'pixel');
  assert.strictEqual(SC.groundingFamily('gemma-4-12b-it-qat-q4_0'), 'gemma4');
  // họ “auto”: số > 1000 → điểm ảnh
  const px = SC.parseBox('{"bbox_2d": [1100, 600, 1200, 650]}', 1280, 720, { coords: SC.FAMILY.qwen35.coords });
  assert.ok(px.x1 > 0.85 && px.x2 <= 1, JSON.stringify(px));
});
test('mục 4: họ suy nghĩ mặc định → --reasoning off; Qwen3-VL/Holo1.5 không thêm gì', () => {
  for (const f of ['qwen35', 'holo3', 'venus2', 'fara', 'gemma4']) { assert.ok(SC.THINKS_BY_DEFAULT.has(f), f); assert.deepStrictEqual(L.launchArgs({ family: f }), ['--reasoning', 'off'], f); }
  for (const f of ['qwen3vl', 'holo', 'qwen25vl', 'generic']) assert.deepStrictEqual(L.launchArgs({ family: f }), [], f);
  // người dùng chọn lại được
  assert.deepStrictEqual(L.launchArgs({ family: 'qwen35', load: { reasoning: 'on' } }), ['--reasoning', 'on']);
});
test('mục 6: --n-cpu-moe theo từng mô hình; tham số từ danh mục/cài đặt chỉ qua danh sách cho phép', () => {
  assert.deepStrictEqual(L.launchArgs({ family: 'holo3', load: { cpuMoe: 30 } }), ['--reasoning', 'off', '--n-cpu-moe', '30']);
  assert.deepStrictEqual(L.sanitize(['--n-cpu-moe', 'TODO đo', '--rm', '-rf', '--api-key', 'x', '--host', '0.0.0.0', '--moe-cache-mib', '2048', '--reasoning', 'off; rm']), ['--moe-cache-mib', '2048']);
  assert.ok(L.isMoe('holo4-35b-a3b-q4_k_m') && L.isMoe('x', { arch: 'qwen35moe' }) && !L.isMoe('qwen3.5-9b-q4_k_m'));
  const vs = fs.readFileSync(path.join(__dirname, '../src/vision-server.js'), 'utf8');
  assert.match(vs, /require\('\.\/model-launch'\)\.sanitize\(extraArgs\)/, 'vision-server lọc lại tham số trước khi chạy');
  const pkg = require('../package.json'); assert.ok(pkg.build.asarUnpack.includes('src/model-launch.js'), 'engine-host (Node thuần) đọc được model-launch.js');
});
test('mục 5: tên tệp chung (q4_k_m.gguf) lưu kèm tên repo, id và khớp danh mục không nhầm giữa hai repo', () => {
  assert.strictEqual(N.localNameFor('Hcompany/Holo4-35B-A3B-GGUF', 'q4_k_m.gguf'), 'Holo4-35B-A3B-q4_k_m.gguf');
  assert.strictEqual(N.localNameFor('Hcompany/Holo-3.1-35B-A3B-GGUF', 'mmproj.f16.gguf'), 'Holo-3.1-35B-A3B-mmproj.f16.gguf');
  assert.strictEqual(N.localNameFor('Qwen/Qwen3-VL-8B-Instruct-GGUF', 'Qwen3VL-8B-Instruct-Q4_K_M.gguf'), 'Qwen3VL-8B-Instruct-Q4_K_M.gguf');
  assert.notStrictEqual(N.idFor('/m/Hcompany/Holo4-35B-A3B-GGUF/q4_k_m.gguf'), N.idFor('/m/Hcompany/Holo-3.1-35B-A3B-GGUF/q4_k_m.gguf'));
  const holo4 = CAT.find(c => c.id === 'holo4-35b-a3b-q4_k_m');
  assert.strictEqual(N.catalogFor({ file: 'Holo4-35B-A3B-q4_k_m.gguf' }, CAT).id, holo4.id);
  // tệp cũ tên chung chỉ khớp khi CÙNG repo
  assert.strictEqual(N.catalogFor({ file: 'q4_k_m.gguf', repo: 'Hcompany/Holo4-35B-A3B-GGUF' }, CAT).id, holo4.id);
  assert.strictEqual(N.catalogFor({ file: 'q4_k_m.gguf', repo: 'someone/Other-GGUF' }, CAT), null);
  // downloader: lưu tên mới; tệp cũ đã có dưới tên chung thì dùng tiếp (không tải lại)
  const { createDownloader } = require('../src/downloader');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-names-'));
  const dl = createDownloader({ dir, send: () => {} });
  const p1 = dl.partialFor('Hcompany/Holo4-35B-A3B-GGUF', [{ path: 'q4_k_m.gguf', size: 4 }]);
  assert.strictEqual(p1.complete, false);
  const legacy = path.join(dir, 'Hcompany', 'Holo4-35B-A3B-GGUF'); fs.mkdirSync(legacy, { recursive: true }); fs.writeFileSync(path.join(legacy, 'q4_k_m.gguf'), 'abcd');
  assert.strictEqual(dl.partialFor('Hcompany/Holo4-35B-A3B-GGUF', [{ path: 'q4_k_m.gguf', size: 4 }]).complete, true, 'tệp cũ vẫn được nhận');
});
test('danh mục: 6 mô hình agent mới đúng dạng, có nguồn, “Chờ đo”; tệp/kích thước khớp nghiên cứu', () => {
  const want = { 'qwen3.5-2b-q4_k_m': 1280835840, 'holo-3.1-4b.iq4_xs': 2866747424, 'qwen3.5-4b-q4_k_m': 2740937888, 'qwen3.5-9b-q4_k_m': 5680522464, 'holo-3.1-9b.q4_k_m': 5629110176, 'holo4-35b-a3b-q4_k_m': 21297870912 };
  for (const [id, size] of Object.entries(want)) {
    const c = CAT.find(x => x.id === id); assert.ok(c, id); assert.strictEqual(c.size, size, id);
    assert.ok(c.agentCandidate && c.vision && c.mmproj && c.mmproj.size > 0, id);
    assert.ok(c.url.endsWith('/' + c.file) && c.mmproj.url.endsWith('/' + c.mmproj.file), id);
    assert.ok(c.claims.length && c.claims.every(x => x.k === 'd'), 'chưa đo thì không có nhãn “Đã kiểm chứng”: ' + id);
    assert.deepStrictEqual(L.sanitize(c.launch), ['--reasoning', 'off'], id);
    assert.strictEqual(SC.groundingFamily(id), c.grounding, id);
  }
});
test('Chờ đo → dùng được sau khi đạt bộ đo trên máy này; thang dự phòng laptop ưu tiên mô hình đã đạt', () => {
  const c2 = CAT.find(c => c.id === 'qwen3.5-2b-q4_k_m');
  const m = { vision: true, catalog: c2, fit: { level: 'fit', tps: 40 } };
  const e0 = AE.eligibility(m, {}); assert.strictEqual(e0.ok, false); assert.strictEqual(e0.code, 'pending'); assert.match(e0.reason, /^Chờ đo/);
  const pass = { full: { complete: true, agentOk: true }, grounding: { score: 8, total: 10 } };
  const e1 = AE.eligibility(m, { local: pass }); assert.ok(e1.ok, JSON.stringify(e1)); assert.ok(e1.benchOk);
  const fail = { full: { complete: true, agentOk: false }, grounding: { score: 4, total: 10 } };
  const e2 = AE.eligibility(m, { local: fail }); assert.strictEqual(e2.ok, false); assert.strictEqual(e2.code, 'bench');
  // đạt nhưng định vị dưới ngưỡng → vẫn chặn
  assert.strictEqual(AE.eligibility(m, { local: { full: { complete: true, agentOk: true }, grounding: { score: 5, total: 10 } } }).code, 'ground');
  // thang: Qwen3-VL 2B (đã kiểm chứng, mượt) vs Qwen3.5 2B (đạt bộ đo trên máy) → chọn mô hình đã đạt; Holo3.1 4B chưa đo không bao giờ được tự chọn
  const vl2 = CAT.find(c => c.id === 'qwen3-vl-4b-instruct-q4_k_m') || CAT.find(c => /qwen3-vl-4b/.test(c.id));
  const list = [
    { id: 'qwen3.5-2b-q4_k_m', size: c2.size, vision: true, catalog: c2, fit: { level: 'fit', tps: 40 } },
    { id: 'holo-3.1-4b.iq4_xs', size: 2.8e9, vision: true, catalog: CAT.find(c => c.id === 'holo-3.1-4b.iq4_xs'), fit: { level: 'fit', tps: 30 } },
    { id: vl2.id, size: vl2.size, vision: true, catalog: vl2, fit: { level: 'fit', tps: 30 } },
  ];
  const scores = { shipped: { [vl2.id]: { grounding: { score: 8, total: 10 } } }, local: { 'qwen3.5-2b-q4_k_m': pass } };
  const best = AE.bestFor(list, scores); assert.ok(best, 'có mô hình'); assert.strictEqual(best.id, 'qwen3.5-2b-q4_k_m');
  const best2 = AE.bestFor(list, { shipped: scores.shipped, local: {} }); assert.ok(!best2 || best2.id !== 'holo-3.1-4b.iq4_xs');
});
test('bộ đo AIVN AGENT nhận mô hình agent mới đã tải (cần tệp thị giác), xếp theo cỡ', () => {
  const r = FB.findQwenVL([
    { id: 'holo-3.1-4b.iq4_xs', file: 'Holo-3.1-4B.IQ4_XS.gguf', mmproj: 'm' },
    { id: 'qwen3.5-2b-q4_k_m', file: 'Qwen3.5-2B-Q4_K_M.gguf', mmproj: 'm' },
    { id: 'qwen3-vl-2b-instruct-q8_0', file: 'Qwen3-VL-2B-Instruct-Q8_0.gguf', mmproj: 'm' },
    { id: 'qwen3.5-9b-q4_k_m', file: 'Qwen3.5-9B-Q4_K_M.gguf', mmproj: null },
    { id: 'qwen_qwen3-8b-q4_k_m', file: 'Qwen_Qwen3-8B-Q4_K_M.gguf', mmproj: 'm' },
  ]);
  assert.deepStrictEqual(r.map(x => x.id), ['qwen3-vl-2b-instruct-q8_0', 'qwen3.5-2b-q4_k_m', 'holo-3.1-4b.iq4_xs']);
  assert.strictEqual(r[0].size, '2B'); assert.strictEqual(r[1].size, 'Qwen3.5 2B'); assert.ok(r[1].candidate);
});
