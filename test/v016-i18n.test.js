'use strict';
// 0.16 mục 4: giao diện vi/en/zh — từ điển đủ và khớp chỗ thay thế, trích chuỗi luôn mới, đổi ngôn ngữ trực tiếp (Electron quét mọi màn hình en/zh không sót tiếng Việt).
const test = require('node:test'); const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'); const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const CORE = require('../src/i18n/core'); const en = require('../src/i18n/en'); const zh = require('../src/i18n/zh');
const X = require('../build/i18n-extract.cjs');
const KEYS = [...require('../src/i18n/strings.json'), ...require('../src/i18n/strings-main.json'), ...require('../src/i18n/strings-data.json'), ...require('../src/i18n/strings-agent.json')];
const T = CORE.create({ en, zh });
const ph = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join(',');
const hasX = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0 && fs.existsSync(path.join(root, 'node_modules/.bin/electron'));

test('danh sách khoá luôn mới: trích lại từ mã nguồn khớp strings*.json (thêm chữ giao diện → chạy build/i18n-extract.cjs)', () => {
  const ui = X.extract(X.UI_FILES); assert.deepStrictEqual(ui, require('../src/i18n/strings.json'));
  const main = X.extractMain().filter(k => !ui.includes(k)); assert.deepStrictEqual(main, require('../src/i18n/strings-main.json'));
  const data = X.extract(X.DATA_FILES).filter(k => !ui.includes(k) && !main.includes(k)); assert.deepStrictEqual(data, require('../src/i18n/strings-data.json'));
  const extra = require('../build/i18n-agent-patterns.json');
  const ag = X.agentKeys(extra).filter(k => !ui.includes(k) && !main.includes(k) && !data.includes(k)); assert.deepStrictEqual(ag, require('../src/i18n/strings-agent.json'));
  assert.ok(KEYS.length > 1800, 'số khoá ' + KEYS.length);
});
test('từ điển en và zh đủ mọi khoá, không rỗng, cùng chỗ thay thế {n}', () => {
  for (const [name, D] of [['en', en], ['zh', zh]]) {
    const miss = KEYS.filter(k => typeof D[k] !== 'string' || !D[k].trim()); assert.deepStrictEqual(miss, [], name + ' thiếu');
    const bad = KEYS.filter(k => ph(k) !== ph(D[k])); assert.deepStrictEqual(bad, [], name + ' lệch {n}');
  }
});
test('quy ước: tên riêng giữ nguyên; zh dùng dấu câu toàn khổ, có khoảng trắng giữa chữ Hán và chữ Latinh/số; thuật ngữ theo docs/glossary.md', () => {
  for (const D of [en, zh]) { assert.strictEqual(D['© 2026 AIVN · NGUYỄN NGỌC KHÔI SINH VIÊN VLU'], '© 2026 AIVN · NGUYỄN NGỌC KHÔI SINH VIÊN VLU'); }
  const bad = []; for (const k of KEYS) { const v = zh[k];
    if (/[\u4e00-\u9fff][,:;?!](?:\s|$)/.test(v)) bad.push('dấu nửa khổ: ' + v);
    if (/[\u4e00-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fff]/.test(v.replace(/\{\d+\}/g, '').replace(/[“"][^”"]*[”"]/g, ''))) bad.push('thiếu khoảng trắng: ' + v); }
  assert.ok(bad.length <= 3, bad.slice(0, 10).join('\n'));
  assert.strictEqual(en['Khám phá'], 'Discover'); assert.strictEqual(zh['Khám phá'], '发现'); assert.strictEqual(zh['Trò chuyện'], '对话');
  assert.strictEqual(en['Lịch tự động'], 'Schedules'); assert.strictEqual(zh['⏰ Lịch tự động'], '⏰ 定时任务'); assert.strictEqual(zh['Chạy chậm trên máy này'] || zh['chạy chậm trên máy này'], '在本机运行较慢');
});
test('lõi dịch: khớp mẫu {n} (dịch lồng), chuỗi ghép theo đoạn, nhãn “X: giá trị”, biểu tượng đầu dòng, giữ xuống dòng', () => {
  assert.strictEqual(T.tr('Đã lưu cấu hình mẫu “Học tập” ✓', 'en'), 'Preset “Học tập” saved ✓');
  assert.strictEqual(T.tr('AIVN · Trò chuyện', 'zh'), 'AIVN · 对话');
  assert.strictEqual(T.tr('Tính biểu thức chính xác: cộng trừ nhân chia, phần trăm, luỹ thừa, căn.\nBấm để tắt.', 'en'), 'Evaluates expressions exactly: add, subtract, multiply, divide, percentages, powers, roots.\nClick to turn off.');
  assert.strictEqual(T.tr('🕒 Ngày giờ', 'zh'), '🕒 日期时间'); assert.strictEqual(T.tr('Bộ xử lý:', 'zh'), '处理器：'); assert.strictEqual(T.tr('Máy tính: đang bật', 'en'), 'Calculator: on');
  assert.strictEqual(T.tr('Quá nặng cho máy (chạy bằng CPU, khá chậm)', 'zh'), '对本机来说太大（使用 CPU 运行，较慢）');
  assert.match(T.tr('Tải kèm tệp thị giác a.gguf (433 MB); mô hình xem trực tiếp ảnh bạn dán. Đã kiểm chứng: Nhìn được ảnh. — Nguồn: trang kiểm chứng của AIVN (bấm để mở)', 'en'), /^Also downloads the vision projector a\.gguf \(433 MB\); the model sees images you paste directly\. Verified: Sees images\. — Source: AIVN's verification page \(click to open\)$/);
  assert.strictEqual(T.tr('  Lưu  ', 'en'), '  Save  ', 'giữ khoảng trắng đầu/cuối');
  assert.strictEqual(T.tr('Chữ người dùng gõ không có trong từ điển', 'en'), 'Chữ người dùng gõ không có trong từ điển', 'không có bản dịch → giữ nguyên');
  assert.strictEqual(T.tr('Lưu', 'vi'), 'Lưu');
  const m = T.trOpts([{ label: 'Sửa', submenu: [{ role: 'undo', label: 'Hoàn tác' }] }, { type: 'separator' }], 'zh');
  assert.strictEqual(m[0].label, '编辑'); assert.strictEqual(m[0].submenu[0].label, '撤消'); assert.strictEqual(m[0].submenu[0].role, 'undo');
  const d = T.trOpts({ title: 'Xoá mô hình', buttons: ['Huỷ', 'Xoá'], message: 'Xoá vĩnh viễn "qwen.gguf" khỏi máy?', filters: [{ name: 'Mô hình GGUF', extensions: ['gguf'] }] }, 'en');
  assert.deepStrictEqual([d.title, d.buttons, d.message, d.filters[0].name], ['Delete model', ['Cancel', 'Delete'], 'Permanently delete "qwen.gguf" from this computer?', 'GGUF model']);
});
test('nối dây: script i18n trong mọi trang, cài đặt uiLang hợp lệ, menu/hộp thoại/khay dịch ở tiến trình chính, mô hình trả lời theo ngôn ngữ giao diện', () => {
  for (const f of ['index.html', 'gate.html', 'overlay.html', 'stop.html']) { const h = rd('src/renderer/' + f); for (const s of ['../i18n/core.js', '../i18n/en.js', '../i18n/zh.js', 'i18n-dom.js']) assert.ok(h.includes(`<script src="${s}"></script>`), f + ' thiếu ' + s); assert.ok(h.indexOf('i18n-dom.js') < h.search(/<script src="(app|gate|overlay|stop)\.js">/), f + ': i18n trước mã trang'); }
  const html = rd('src/renderer/index.html'); assert.match(html, /<select id="uiLangSel"[^>]*><option value="vi" data-noi18n>Tiếng Việt<\/option><option value="en" data-noi18n>English<\/option><option value="zh" data-noi18n>中文（简体）<\/option>/);
  const m = rd('src/main.js');
  assert.match(m, /uiLang: 'vi', theme:/); assert.match(m, /if \('uiLang' in rest\) \{ settings\.data\.uiLang = I18N_CORE\.LANGS\.includes\(rest\.uiLang\) \? rest\.uiLang : 'vi'; try \{ buildMenus\(\); paintTray\(\); \}/);
  assert.match(m, /dialog\[k\] = \(a, b\) => \(b === undefined \? f\(TO\(a\)\) : f\(a, TO\(b\)\)\)/); assert.match(m, /Menu\.buildFromTemplate = \(tpl\) => bft\(TO\(tpl\)\)/);
  assert.match(m, /const dir = I18N_CORE\.replyDirective\(uiLang\(\)\)/); assert.match(m, /welcomeFor\(\{ lang: uiLang\(\),/);
  assert.strictEqual(CORE.replyDirective('vi'), ''); assert.match(CORE.replyDirective('zh'), /简体中文/);
  const { welcomeFor, WELCOME } = require('../src/agent/agent');
  assert.strictEqual(WELCOME, welcomeFor({ lang: 'vi' })); assert.match(welcomeFor({ lang: 'en' }), /^Hi! I'm \*\*AIVN AGENT\*\*/); assert.match(welcomeFor({ lang: 'zh' }), /Nguyễn Ngọc Khôi/); assert.match(welcomeFor({ lang: 'en', loaded: false }), /Choose a model in the top bar/);
  const a = rd('src/renderer/app.js'); assert.doesNotMatch(a, /textContent === 'Đang suy nghĩ…'/); assert.match(a, /I18N\.is\(\$\('#genStats'\)\.textContent, 'Đang suy nghĩ…'\)/); assert.strictEqual((a.match(/'vi-VN'/g) || []).length, 1, 'chỉ LOC() được ghi cứng vi-VN');
});
test('agent: giao diện en/zh → lời nhắc hệ thống yêu cầu trả lời bằng ngôn ngữ đó, vẫn vừa ngữ cảnh 4096', async () => {
  const { createAgent } = require('../src/agent/agent'); const { createComputerTools } = require('../src/agent/computer-tools');
  for (const [lang, re] of [['en', /Luôn trả lời bằng tiếng Anh \(English\), kể cả khi báo lỗi;/ /* B57: ngôn ngữ của người dùng */], ['vi', /Luôn trả lời bằng tiếng Việt, thân thiện/]]) {
    let sys = null; const ct = createComputerTools({ getSettings: () => ({ agentComputer: true }), openPath: async () => '', openExternal: async () => {}, visionReady: () => false, screen: {} });
    const engine = { status: () => ({ loaded: true, contextSize: 4096 }), chatStep: async (msgs) => { sys = msgs[0].content; return { text: 'ok', toolCalls: [], finishReason: 'stop', usage: {} }; } };
    const ag = createAgent({ engine, getSettings: () => ({ agentComputer: true, uiLang: lang }), memory: { count: () => 0 }, scheduler: {}, extractFile: async () => ({}), embedForMemory: async () => ({}), computer: ct });
    await ag.run({ messages: [{ role: 'user', content: lang === 'vi' ? 'thư mục được phép có những tệp gì?' : 'what is in my allowed folder?' }], confirm: async () => false }); assert.match(sys, re, lang); // 'hi' = lời chào → đường nhanh B165, không lời nhắc đầy đủ
  }
});

let R = null;
function run() {
  if (R) return R;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-i18n-')); const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-i18n-ud-'));
  const r = spawnSync('timeout', ['200', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'],
    { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_QAUI: dir, AIVN_QAUI_I18N: '1' }) });
  const f = path.join(dir, 'qai18n.json'); assert.ok(fs.existsSync(f), 'quét giao diện không chạy xong: ' + (r.stderr || '').slice(-800));
  R = JSON.parse(fs.readFileSync(f, 'utf8')); return R;
}
// tên riêng, dòng ghi công và cụm tiếng Việt cố ý (trong ngoặc kép: nhãn nút của bài đo, câu người dùng gõ) không tính là sót
const ALLOW = [/NGUYỄN NGỌC KHÔI SINH VIÊN VLU/g, /Nguyễn Ngọc Khôi/g, /Khôi/g, /Nguyễn Văn An/g, /Trần Quỳnh Anh/g, /Văn Lang/g, /café|clichés/g, /XOÁ/g, /“[^”]*”|"[^"]*"/g, /Tiếng Việt/g];
const leftover = (t) => { let s = t; for (const re of ALLOW) s = s.replace(re, ''); return X.VI.test(s); };
test('Electron en/zh: mọi màn hình, thẻ cài đặt, bảng lệnh và phím tắt không còn chữ tiếng Việt; menu và tiêu đề dịch; đổi về vi khôi phục y nguyên', { skip: !hasX && 'cần xvfb-run + electron', timeout: 260000 }, () => {
  const d = run();
  for (const [l, menu, disc, chat] of [['en', ['File', 'Edit', 'View', 'Window'], 'Discover', 'AIVN · Chat'], ['zh', ['文件', '编辑', '视图', '窗口'], '发现', 'AIVN · 对话']]) {
    const r = d.langs[l]; const left = [...new Set(r.hits.filter(h => leftover(h.t)).map(h => `${h.at}: ${h.t}`))];
    assert.deepStrictEqual(left, [], l + ' còn sót'); assert.deepStrictEqual(r.menu, menu); assert.strictEqual(r.liveSample[0], disc); assert.strictEqual(r.title, chat); assert.strictEqual(r.htmlLang, l === 'zh' ? 'zh-CN' : 'en');
  }
  assert.ok(d.viRestored.same, 'đổi về tiếng Việt phải khôi phục y nguyên: ' + d.viRestored.before + ' ≠ ' + d.viRestored.after);
  assert.strictEqual(d.viRestored.discover, 'Khám phá'); assert.deepStrictEqual(d.viRestored.menu, ['Tệp', 'Sửa', 'Xem', 'Cửa sổ']);
});
