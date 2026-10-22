'use strict';
// B163 (QA, laptop thật RTX 3050 Ti 4 GB / 16 GB RAM, beta.2.8): báo Qwen3-VL 2B/4B không có trong Khám phá.
// Kiểm thử đầu-cuối ĐÚNG đường danh mục của bản đóng gói: IPC catalog:list (danh mục tĩnh src/catalog.js → fit/agentFit →
// recommend.annotate → agentCheck) → renderCatalog (mục Điều khiển máy tính + Các mô hình khác) → bộ chọn mô hình (Ctrl+L)
// → ô tìm Hugging Face. Chạy app thật qua --qa-ui với phần cứng giả (AIVN_QA_FAKEHW) và Qwen3-VL 4B "đã tải" (tệp thưa đúng kích thước).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const catalog = require('../src/catalog');
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));
const G = 1024 ** 3, M = 1024 ** 2;
const LAPTOP = { // khớp ảnh Cài đặt trên laptop của Khôi: VRAM 3,9 GB, RAM 15,4 GB
  clean: { gpu: 'vulkan', vram: { total: 4 * G, free: 3 * G + 700 * M, shared: 0, mixed: false, integratedOnly: false }, devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU'], ram: 15 * G + 400 * M, freeRam: 9 * G, cpus: 16, platform: 'win32' },
  // Ryzen + RTX: node-llama-cpp cộng bộ nhớ dùng chung của GPU tích hợp (vd. báo 11,8 GB) → engine.vramInfo tách ra
  // ĐÚNG máy của Khôi (ảnh b163-kham-pha.png): Ryzen 7 4800H — Vulkan liệt kê iGPU AMD TRƯỚC, RTX 3050 Ti 4 GB sau; VRAM hiện 3,9 GB, RAM 15,4 GB
  laptop: { gpu: 'vulkan', vram: { total: 3.9 * G, free: 3.6 * G, shared: 7 * G + 800 * M, reportedTotal: 11 * G + 700 * M, mixed: true, integratedOnly: false }, devices: ['AMD Radeon(TM) Graphics', 'NVIDIA GeForce RTX 3050 Ti Laptop GPU'], ram: 15 * G + 400 * M, freeRam: 7 * G, cpu: { cores: 8, threads: 16, model: 'AMD Ryzen 7 4800H with Radeon Graphics' } },
  hybrid: { gpu: 'vulkan', vram: { total: 4 * G, free: 3 * G + 900 * M, shared: 7 * G + 800 * M, reportedTotal: 11 * G + 800 * M, mixed: true, integratedOnly: false }, devices: ['NVIDIA GeForce RTX 3050 Ti Laptop GPU', 'AMD Radeon(TM) Graphics'], ram: 15 * G + 400 * M, freeRam: 8 * G, cpus: 16, cpu: 'AMD Ryzen 7 5800H with Radeon Graphics', platform: 'win32' },
};
const vl4 = catalog.find(c => c.id === 'qwen3-vl-4b-instruct-q4_k_m'); const vl2 = catalog.find(c => c.id === 'qwen3-vl-2b-instruct-q8_0');

function run(hw) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b163-')); const prof = path.join(d, 'profile'); const models = path.join(d, 'models', 'Qwen3-VL-4B-Instruct-GGUF');
  fs.mkdirSync(prof, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  for (const f of [{ file: vl4.file, size: vl4.size }, vl4.mmproj]) { const fd = fs.openSync(path.join(models, f.file), 'w'); fs.ftruncateSync(fd, f.size); fs.closeSync(fd); }
  // hồ sơ QA riêng: thư mục mô hình chính là của hồ sơ thật → đặt 4B vào thư mục mô hình phụ (modelDirsExtra), không đụng dữ liệu thật
  fs.writeFileSync(path.join(prof, 'settings.json'), JSON.stringify({ modelDirsExtra: [path.join(d, 'models')], uiLang: 'vi' }));
  const out = path.join(d, 'r.json');
  const r = spawnSync('timeout', ['200', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox',
    '--qa-ui', 'test/fixtures/qa-ui/b163-discover.json', '--out', out, '--shots', path.join(d, 'shots'), '--profile', prof],
  { cwd: root, encoding: 'utf8', env: { ...process.env, AIVN_SKIP_ACTIVATION: '1', AIVN_QA_MODE: '1', OMP_NUM_THREADS: '4', AIVN_QA_FAKEHW: JSON.stringify(hw) } });
  assert.ok(fs.existsSync(out), 'không có result.json: ' + String(r.stderr || '').slice(-600));
  const res = JSON.parse(fs.readFileSync(out, 'utf8')); fs.rmSync(d, { recursive: true, force: true }); return res;
}

for (const [name, hw] of Object.entries(LAPTOP)) {
  test(`B163 (${name}): 4 GB VRAM / 16 GB RAM, Qwen3-VL 4B đã tải → Khám phá có đủ mọi thẻ danh mục, có Qwen3-VL 2B + 4B, Ctrl+L có 4B, tìm “qwen3-vl” ra kết quả`, { skip: !hasX }, (t) => {
    const r = run(hw); const R = r.reads || {};
    assert.strictEqual(r.status, 'done', JSON.stringify(r.failedSteps || r.steps.filter(s => !s.ok)));
    assert.deepStrictEqual(r.mainErrors || [], []); assert.deepStrictEqual((r.consoleErrors || []).filter(e => !/net::|Failed to load resource/i.test(String(e.message || e))), []);
    const agent = R.screen || '', other = R.other || '', all = agent + '\n' + other;
    const missing = catalog.filter(c => !all.includes(c.name)).map(c => c.name);
    assert.deepStrictEqual(missing, [], 'thẻ danh mục bị rơi khỏi Khám phá');
    assert.ok(all.includes(vl2.name), 'thiếu Qwen3-VL 2B');
    // B163 (máy thật): GPU 4 GB → nhóm đầu của mục Điều khiển máy tính là “Chạy mượt”, thẻ đầu tiên là Qwen3-VL 2B có ⭐
    const g1 = agent.search(/CHẠY MƯỢT/i); assert.ok(g1 >= 0, 'không có nhóm Chạy mượt: ' + agent.slice(0, 600));
    assert.ok(!/CHẠY CHẬM/i.test(agent.slice(0, g1)), 'nhóm Chạy chậm đứng trước Chạy mượt: ' + agent.slice(0, 400));
    const firstCard = agent.slice(g1, g1 + 900); assert.ok(firstCard.indexOf(vl2.name) >= 0 && firstCard.indexOf(vl2.name) < 200, 'thẻ đầu nhóm Chạy mượt phải là 2B: ' + firstCard.slice(0, 300));
    assert.match(firstCard.slice(0, firstCard.indexOf(vl2.repo) > 0 ? firstCard.indexOf(vl2.repo) : 900), /⭐ Gợi ý: điều khiển máy/, '2B phải có ⭐'); assert.ok(agent.includes(vl4.name), 'Qwen3-VL 4B phải ở mục Điều khiển máy tính');
    const card4 = agent.slice(agent.indexOf(vl4.name), agent.indexOf(vl4.repo) + vl4.repo.length);
    assert.match(card4, /Có trên máy/, '4B đã tải phải hiện “Có trên máy”'); assert.doesNotMatch(card4, /⭐ Gợi ý: điều khiển máy/, 'máy 4 GB: ⭐ AIVN AGENT là Qwen3-VL 2B, không phải 4B (B163)');
    assert.ok(!/Llama 3\.1 8B Instruct[^⭐]{0,400}⭐ Gợi ý: điều khiển máy/.test(all), 'mô hình chỉ đọc chữ không bao giờ được ⭐ AIVN AGENT');
    assert.match(R.loader || '', /Qwen3-VL 4B Instruct/, 'bộ chọn mô hình (Ctrl+L) phải liệt kê 4B đã tải');
    // B163: tìm “qwen3-vl” luôn ra thẻ danh mục AIVN (2B + 4B) ngay đầu kết quả, kể cả khi không có mạng tới Hugging Face
    assert.match(R.hfcat || '', /Trong danh mục AIVN/i); assert.ok((R.hfcat || '').includes(vl4.name) && (R.hfcat || '').includes(vl2.name), 'tìm qwen3-vl phải ra 2B + 4B: ' + String(R.hfcat || '').slice(0, 200));
    const hf = R.hf || '';
    if (/Qwen3-VL-\w/.test(hf)) { assert.match(hf, /Qwen3-VL-4B-Instruct-GGUF/); assert.match(hf, /Qwen3-VL-2B-Instruct-GGUF/); }
    else t.diagnostic('không có mạng tới huggingface.co: bỏ qua kiểm tra kết quả tìm “qwen3-vl” — ' + hf.slice(0, 160));
  });
}
