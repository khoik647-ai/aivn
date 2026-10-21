'use strict';
// B81 (pass 8): chữ Việt còn sót ở en/zh — Khám phá (“2 năm trước”, “630M tham số”, “307,0 N downloads”), Mô hình (“3 phút trước”),
// nhật ký máy chủ (“Created khoá API mới”, “Đã xoá khoá API”, “[lịch] chạy …”), ngày zh theo dd/mm/yyyy (main.js ép --lang=vi)
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const C = require('../src/i18n/core'); const T = C.create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const root = path.join(__dirname, '..'); const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
// lấy các hàm định dạng thật từ app.js
const grab = (name) => { const i = app.indexOf(`const ${name} = `); return app.slice(i, app.indexOf('\n', i)); };
const ctx = { LOC: () => 'vi-VN', Date }; vm.createContext(ctx);
vm.runInContext(['fmtNum', 'fmtAgo', 'fmtParams', 'fmtUsedAgo'].map(grab).join('\n') + '\nthis.F = { fmtNum, fmtAgo, fmtParams, fmtUsedAgo };', ctx);
const F = ctx.F;
test('B81: định dạng luôn viết dạng Việt chuẩn (không phụ thuộc ngôn ngữ lúc vẽ)', () => {
  assert.strictEqual(F.fmtNum(307000), '307,0 N'); assert.strictEqual(F.fmtNum(1234567), '1,2 Tr'); assert.strictEqual(F.fmtParams(630e6), '630M tham số'); assert.strictEqual(F.fmtParams(7.6e9), '7,6B tham số');
  assert.strictEqual(F.fmtAgo(new Date(Date.now() - 800 * 864e5).toISOString()), '2 năm trước'); assert.strictEqual(F.fmtUsedAgo(Date.now() - 180e3), '3 phút trước');
});
const line = `⬇ ${F.fmtNum(307000)} lượt tải · ♥ ${F.fmtNum(1234567)} · cập nhật ${F.fmtAgo(new Date(Date.now() - 800 * 864e5).toISOString())} · giấy phép apache-2.0 · kiến trúc qwen3 · ${F.fmtParams(630e6)} · ngữ cảnh tối đa ${F.fmtNum(262144)}`;
test('B81: dòng thẻ Khám phá dịch trọn ở en/zh (số gọn K/M, “năm trước”, “tham số”)', () => {
  assert.strictEqual(T.tr(line, 'en'), '⬇ 307.0K downloads · ♥ 1.2M · updated 2 years ago · license apache-2.0 · architecture qwen3 · 630M params · max context 262.1K');
  const zh = T.tr(line, 'zh'); assert.ok(!VI.test(zh) && !/ N\b| Tr\b/.test(zh), zh); assert.match(zh, /2 年前/);
  for (const [s, en, zh2] of [['3 phút trước', '3 minutes ago', '3 分钟前'], ['1 giờ trước', '1 hour ago', '1 小时前'], ['♥ 1,2 Tr', '♥ 1.2M', '♥ 1.2M'], ['Qwen3 · 4B tham số · Q4_K_M', 'Qwen3 · 4B params · Q4_K_M', 'Qwen3 · 4B 参数 · Q4_K_M']]) { assert.strictEqual(T.tr(s, 'en'), en); assert.strictEqual(T.tr(s, 'zh'), zh2); }
  assert.strictEqual(T.tr('307,0 N', 'vi'), '307,0 N'); // tiếng Việt giữ nguyên
});
test('B81: nhật ký máy chủ (khoá API, lịch) có bản dịch', () => {
  assert.strictEqual(T.tr('Đã tạo khoá API mới', 'en'), 'Created a new API key'); assert.strictEqual(T.tr('Đã xoá khoá API', 'en'), 'Deleted the API key');
  assert.strictEqual(T.tr('[lịch] chạy "Backup"', 'en'), '[schedule] running "Backup"'); assert.strictEqual(T.tr('[lịch] chạy "Backup" (trễ)', 'zh'), '[日程] 运行“Backup”（延迟）');
});
test('B81: Chromium --lang theo ngôn ngữ giao diện đã lưu (ô ngày zh/en không còn dd/mm/yyyy ép theo vi)', () => {
  const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.ok(!/appendSwitch\('lang', 'vi'\)/.test(m)); assert.match(m, /CHROMIUM_LANG = \{ vi: 'vi', en: 'en-US', zh: 'zh-CN' \}/); assert.match(m, /appendSwitch\('lang', CHROMIUM_LANG\[startLang\]\)/);
  assert.ok(m.indexOf("appendSwitch('lang'") > m.indexOf('const QA_PROFILE'), 'đặt sau khi xác định thư mục hồ sơ (QA/AIVN_USER_DATA)');
});
