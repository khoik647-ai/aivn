// B33b/B45: chữ động lúc chạy của AIVN AGENT (nhãn bước, tóm tắt, chi tiết, cảnh báo, nhật ký Developer) — giao diện en/zh không còn chữ tiếng Việt
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CORE = require('../src/i18n/core.js'); const en = require('../src/i18n/en.js'); const zh = require('../src/i18n/zh.js');
const CT = require('../src/agent/computer-tools'); const AG = require('../src/agent/agent'); const { createMemoryStore } = require('../src/agent/memory');
const T = CORE.create({ en, zh });
const VI_DIA = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;
// tên riêng/nội dung người dùng được phép giữ nguyên
const ALLOW = /Nguyễn Ngọc Khôi|NGUYỄN NGỌC KHÔI|SINH VIÊN VLU|“[^”]*”|"[^"]*"/g;
const show = (s, lang) => { const p = String(s).match(/^(\[[^\]]{1,40}\]\s*)([\s\S]*)$/); const body = p ? p[2] : String(s); return T.tr(body, lang); };

async function fakeTurn() {
  const r0 = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-i18nrt-'));
  const replies = [
    { text: '', toolCalls: [{ id: 'a', name: 'list_apps', arguments: { query: '' } }], finishReason: 'tool_calls', usage: { completion_tokens: 5 } },
    { text: '', toolCalls: [{ id: 'b', name: 'open_app', arguments: { name: 'notepad' } }], finishReason: 'tool_calls', usage: { completion_tokens: 5 } },
    { text: 'Done.', toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 2 } }];
  const engine = { status: () => ({ loaded: true, contextSize: 8192 }), chatStep: async () => replies.shift() || { text: 'Done.', toolCalls: [], finishReason: 'stop', usage: {} } };
  const apps = [{ name: 'Notepad', source: 'apppath', target: 'C:\\Windows\\notepad.exe' }, { name: 'Zalo', source: 'startmenu', target: 'zalo.lnk' }];
  const ct = CT.createComputerTools({ getSettings: () => ({ agentComputer: true }), listWindows: async () => [], focusWindow: async () => {}, openExternal: async () => {}, log: () => {},
    listApps: async () => apps, launchApp: async (a) => ({ ok: true }), windows: () => [] });
  const names = ['open_app', 'list_apps'];
  const defs = Object.fromEntries(names.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => names, defs, has: (n) => n in defs, CompError: CT.CompError, relevantWindows: ct.relevantWindows, exec: (n, a, c) => ct.exec(n, a, c) };
  const logs = []; const steps = [];
  const agent = AG.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: false, uiLang: 'en' }), memory: createMemoryStore(path.join(r0, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: (x) => logs.push(x) });
  const r = await agent.run({ messages: [{ role: 'user', content: 'open notepad' }], confirm: async () => true, onStep: (s) => steps.push(s) });
  return { r, logs, steps };
}

test('fake agent turn en/zh: step labels, summaries, statuses and Developer log lines translate with no Vietnamese diacritics left', async () => {
  const { logs, steps } = await fakeTurn();
  assert.ok(steps.length >= 2, 'có bước');
  const texts = [];
  for (const s of steps) { texts.push(s.label, s.summary); }
  texts.push(...logs.filter(l => /^\[aivn agent\]/i.test(l)));
  // dòng nhật ký/chi tiết thường gặp (ảnh chụp QA t8-en-log/t8-en-agent)
  texts.push('[AIVN AGENT] dừng khẩn cấp (phím Esc), đã huỷ 1 lượt', 'Đã mở notepad · đã thấy cửa sổ (App Paths (sổ đăng ký))', '2 bước dùng công cụ', 'Đang chạy công cụ: Mở ứng dụng…', '3,9 giây');
  const bad = [];
  for (const lang of ['en', 'zh']) for (const t of texts.filter(Boolean)) { const o = show(t, lang); if (VI_DIA.test(String(o).replace(ALLOW, ''))) bad.push(`${lang}: ${t} → ${o}`); }
  assert.deepStrictEqual(bad, []);
});
test('B45: số nhiều tiếng Anh “1 turn” / “2 turns”; zh không có {s}', () => {
  assert.strictEqual(show('[AIVN AGENT] dừng khẩn cấp (phím Esc), đã huỷ 1 lượt', 'en'), 'emergency stop (Esc key), cancelled 1 turn');
  assert.strictEqual(show('dừng khẩn cấp (phím Esc), đã huỷ 2 lượt', 'en'), 'emergency stop (Esc key), cancelled 2 turns');
  assert.ok(!/\{s\}/.test(show('dừng khẩn cấp (phím Esc), đã huỷ 2 lượt', 'zh')));
  assert.ok(!Object.values(zh).some(v => v.includes('{s}')), 'zh không dùng {s}');
});
test('renderer: nhãn [..] của dòng nhật ký tách riêng (dịch phần chữ), thanh trạng thái dịch tên công cụ và từng phần tóm tắt', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app.js'), 'utf8');
  assert.match(a, /<span data-noi18n>\$\{esc\(pm\[1\]\)\}<\/span>/);
  assert.match(a, /Đang chạy công cụ: \$\{UIL\(\) === 'vi' \? step\.label : I18N\.tr\(step\.label, UIL\(\)\)\}/);
  assert.match(a, /map\(x => UIL\(\) === 'vi' \? x : \(I18N\.tr\(x, UIL\(\)\) \|\| x\)\)\.join\(' · '\)/);
});
