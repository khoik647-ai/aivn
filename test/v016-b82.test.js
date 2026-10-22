'use strict';
// B82 (pass 8, so với LM Studio): Trò chuyện không tìm được trong lịch sử, không xuất ra tệp (.md/.json/.txt) — chỉ có /sao-chep; Ghi nhớ không có ô tìm
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const E = require('../src/chat-export'); const root = path.join(__dirname, '..');
const C = { id: 'c1', title: 'Hỏi: lịch học?', mode: 'chat', createdAt: 1, updatedAt: 2, messages: [
  { role: 'user', content: 'Tuần này có lịch thi cà phê không?', at: 1761100000000, attachments: [{ name: 'lich.pdf', kind: 'doc', size: 10, thumb: 'data:image/jpeg;base64,AAAA' }] },
  { role: 'assistant', content: 'Có, thứ **Sáu**.', model: 'qwen3-4b', steps: [{ label: 'Mở ứng dụng', summary: 'Zalo', status: 'ok', raw: { secret: 1 } }, { label: 'Gửi tin', status: 'refused' }] }] };
test('B82: xuất Markdown / văn bản / JSON (bỏ ảnh thu nhỏ base64 và dữ liệu nội bộ của bước)', () => {
  const md = E.render(C, 'md', { now: 0, version: '0.16.0' });
  assert.match(md, /^# Hỏi: lịch học\?\n\n_Xuất từ AIVN 0\.16\.0 · /); assert.match(md, /### 🧑 Bạn · /); assert.match(md, /> 📎 Đính kèm: lich\.pdf/);
  assert.match(md, /### 🤖 AIVN \(qwen3-4b\)\n\n> 🛠 Công cụ đã dùng: Mở ứng dụng \(Zalo\) ✓; Gửi tin ✗ bị từ chối\n\nCó, thứ \*\*Sáu\*\*\.\n$/);
  const txt = E.render(C, 'txt', { now: 0 }); assert.match(txt, /^Hỏi: lịch học\?\nXuất từ AIVN · /); assert.match(txt, /\nAIVN \(qwen3-4b\):\n\[Công cụ đã dùng: /); assert.ok(!/[#>*]{2}|###/.test(txt.replace(/\*\*Sáu\*\*/, '')));
  const j = JSON.parse(E.render(C, 'json', { now: 0, version: '0.16.0' }));
  assert.strictEqual(j.app, 'AIVN'); assert.strictEqual(j.version, '0.16.0'); assert.strictEqual(j.exportedAt, '1970-01-01T00:00:00.000Z');
  assert.strictEqual(j.conversation.messages.length, 2); assert.deepStrictEqual(j.conversation.messages[0].attachments, [{ name: 'lich.pdf', kind: 'doc', size: 10 }]);
  assert.ok(!JSON.stringify(j).includes('base64') && !JSON.stringify(j).includes('secret'));
  const L = { you: 'You', exported: 'Exported from AIVN', attachments: 'Attachments', tools: 'Tools used', refused: 'declined' };
  assert.match(E.render(C, 'md', { labels: L, locale: 'en-US' }), /### 🧑 You · .*\n\n> 📎 Attachments: lich\.pdf[\s\S]*Tools used: .*✗ declined/);
});
test('B82: định dạng theo đuôi tệp đã chọn, tên tệp an toàn trên Windows', () => {
  assert.deepStrictEqual(['a.md', 'b.TXT', 'c.json', 'd.markdown', 'e'].map(E.fmtOf), ['md', 'txt', 'json', 'md', 'md']);
  assert.strictEqual(E.fileName(C, 'json'), 'Hỏi- lịch học-.json'); assert.strictEqual(E.fileName({ title: '' }, 'txt'), 'aivn-chat.txt'); assert.strictEqual(E.fileName({ title: 'x'.repeat(200) }).length, 83);
});
const hasX = fs.existsSync(path.join(root, 'node_modules/.bin/electron')) && spawnSync('which', ['xvfb-run']).status === 0;
test('B82 thật (Xvfb, uiLang=en): tìm lịch sử theo nội dung không dấu, xuất qua IPC thật ra tệp tiếng Anh, ô tìm Ghi nhớ', { skip: !hasX && 'cần xvfb + electron', timeout: 200e3 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b82-')); const ud = path.join(d, 'ud'); fs.mkdirSync(ud, { recursive: true }); const shots = path.join(d, 'shots'); const out = path.join(d, 'out.md');
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ uiLang: 'en' }));
  const C2 = { id: 'c2', title: 'Pizza recipe', mode: 'chat', createdAt: 3, updatedAt: 3, messages: [{ role: 'user', content: 'How to bake pizza', at: 3 }, { role: 'assistant', content: 'Preheat the oven.' }] };
  fs.writeFileSync(path.join(ud, 'conversations.json'), JSON.stringify({ list: [{ ...C, updatedAt: 4 }, C2] }));
  const now = Date.now(); fs.writeFileSync(path.join(ud, 'memory.json'), JSON.stringify({ items: [{ id: 'm1', text: 'Tôi thích cà phê sữa đá', createdAt: now, updatedAt: now, source: 'user' }, { id: 'm2', text: 'Tôi học ở VLU', createdAt: now, updatedAt: now - 1, source: 'user' }], vecs: {} }));
  const js = (body) => `(async () => { const $ = (s) => document.querySelector(s); const sleep = (t) => new Promise(r => setTimeout(r, t)); const typ = async (s, v) => { $(s).value = v; $(s).dispatchEvent(new Event('input', { bubbles: true })); await sleep(400); }; ${body} })()`;
  const list = [
    { name: 'search', save: true, js: js(`const all = document.querySelectorAll('#convoList .convo').length; await typ('#convoQ', 'ca phe'); const rows = [...document.querySelectorAll('#convoList .convo')]; const hit = { all, n: rows.length, id: rows[0] && rows[0].dataset.id, snip: (rows[0] && rows[0].querySelector('.convo-snip') || {}).textContent, exp: !!(rows[0] && rows[0].querySelector('.exp')), ph: $('#convoQ').placeholder }; await typ('#convoQ', 'zzzz'); hit.none = $('#convoList').textContent.trim(); await typ('#convoQ', ''); hit.back = document.querySelectorAll('#convoList .convo').length; return hit;`) },
    { name: 'export', save: true, js: js(`return await window.aivn.exportConvo('c1', 'md');`) },
    { name: 'mem', save: true, js: js(`document.querySelector('[data-view="memory"]') ? document.querySelector('[data-view="memory"]').click() : null; await sleep(600); await typ('#memQ', 'CA PHE'); await sleep(400); return { n: document.querySelectorAll('#memList .mem').length, txt: $('#memList').textContent, cnt: $('#memQn').textContent, ph: $('#memQ').placeholder };`) },
  ];
  fs.writeFileSync(path.join(d, 'list.json'), JSON.stringify(list));
  const env = { ...process.env, AIVN_USER_DATA: ud, AIVN_SKIP_ACTIVATION: '1', AIVN_SHOTSET: shots, AIVN_SHOTSET_LIST: path.join(d, 'list.json'), AIVN_QA_SAVE_PATH: out };
  spawnSync('timeout', ['150', 'nice', '-n', '19', 'xvfb-run', '-a', '-s', '-screen 0 1280x800x24', path.join(root, 'node_modules/.bin/electron'), '.', '--no-sandbox'], { cwd: root, env, stdio: 'ignore' });
  const rd = (n) => JSON.parse(fs.readFileSync(path.join(shots, n + '.json'), 'utf8'));
  const s = rd('search'); assert.strictEqual(s.all, 2); assert.strictEqual(s.n, 1); assert.strictEqual(s.id, 'c1'); assert.match(s.snip, /cà phê/); assert.ok(s.exp); assert.strictEqual(s.ph, 'Search history…');
  assert.strictEqual(s.none, 'No conversations match “zzzz”'); assert.strictEqual(s.back, 2);
  const x = rd('export'); assert.ok(x && x.ok, JSON.stringify(x)); assert.strictEqual(x.format, 'md');
  const md = fs.readFileSync(out, 'utf8'); assert.match(md, /^# Hỏi: lịch học\?\n\n_Exported from AIVN /); assert.match(md, /### 🧑 You · /); assert.match(md, /> 📎 Attachments: lich\.pdf/); assert.match(md, /Tools used: Open app \(Zalo\) ✓/);
  const m = rd('mem'); assert.strictEqual(m.n, 1, m.txt); assert.match(m.txt, /cà phê sữa đá/); assert.strictEqual(m.cnt, '1/2'); assert.strictEqual(m.ph, 'Search memories…');
});
test('B82: lệnh /xuat và nút ⤓ trên từng cuộc trò chuyện', () => {
  const a = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  assert.match(a, /\{ c: '\/xuat', d: 'Xuất cuộc trò chuyện ra tệp \(\.md\/\.txt\/\.json\)'/); assert.match(a, /if \(e\.target\.closest\('\.exp'\)\) \{ await exportConvo\(row\.dataset\.id\); return; \}/);
  const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'); assert.match(m, /!app\.isPackaged && process\.env\.AIVN_QA_SAVE_PATH \?/);
});
