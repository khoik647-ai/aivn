// Trang web 3 ngôn ngữ: mọi chuỗi có bản en/zh, khối liên hệ và tên tác giả giữ nguyên, phiên bản khớp package.json
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..'); const html = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
const D = JSON.parse(html.split('/*I18N*/')[1].split('/*END*/')[0]);
const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]);
const akeys = [...html.matchAll(/data-i18n-(?:title|aria-label|placeholder)="([^"]+)"/g)].map(m => m[1]);
const NAME = 'NGUYỄN NGỌC KHÔI SINH VIÊN VLU';
test('mọi khoá có bản tiếng Anh và tiếng Trung, không thừa khoá', () => {
  assert.ok(keys.length > 150);
  for (const l of ['en', 'zh']) {
    const miss = [...keys, ...akeys].filter(k => !D[l][k] || !String(D[l][k]).trim()); assert.deepStrictEqual(miss, [], `${l} thiếu`);
    const extra = Object.keys(D[l]).filter(k => !keys.includes(k) && !akeys.includes(k)); assert.deepStrictEqual(extra, [], `${l} thừa`);
  }
  assert.strictEqual(new Set(keys).size, keys.length, 'khoá trùng');
});
test('cấu trúc thẻ HTML của bản dịch giống bản gốc', () => {
  const tags = (s) => (s.match(/<\/?\w+/g) || []).join(',');
  const inner = (i) => { // nội dung của phần tử mở ở vị trí i (đếm lồng nhau cùng tên thẻ)
    const open = html.slice(i).match(/^<(\w+)[^>]*>/); const name = open[1]; let depth = 1, j = i + open[0].length; const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g'); re.lastIndex = j; let m;
    while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (!depth) return html.slice(j, m.index); } };
  for (const m of html.matchAll(/<\w+[^>]*\sdata-i18n="([^"]+)"[^>]*>/g)) { const orig = inner(m.index);
    for (const l of ['en', 'zh']) assert.strictEqual(tags(D[l][m[1]]), tags(orig), `${l} ${m[1]}`); }
});
test('bản en/zh không còn chữ tiếng Việt (trừ tên riêng)', () => {
  const VI = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  for (const l of ['en', 'zh']) for (const [k, v] of Object.entries(D[l])) {
    const t = String(v).replace(new RegExp(NAME, 'g'), '').replace(/Đà Nẵng/g, '');
    assert.ok(!VI.test(t), `${l} ${k}: ${t.slice(0, 80)}`);
  }
});
test('tên tác giả và khối liên hệ giữ nguyên ở mọi ngôn ngữ', () => {
  const contact = (html.match(/<ul[^>]*class="foot-contact"[\s\S]*?<\/ul>/) || [''])[0];
  assert.ok(/khoik647@gmail\.com/.test(contact) && /0896 403 538/.test(contact), 'thiếu khối liên hệ'); assert.ok(!/data-i18n/.test(contact), 'khối liên hệ không được dịch');
  for (const l of ['en', 'zh']) for (const k of keys) {
    const m = html.match(new RegExp(`data-i18n="${k.replace('.', '\\.')}"[^>]*>([\\s\\S]*?)<\\/`)); if (m && m[1].includes(NAME)) assert.ok(D[l][k].includes(NAME), `${l} ${k} mất tên tác giả`);
  }
});
test('phiên bản trên trang khớp package.json ở cả 3 ngôn ngữ', () => {
  const v = require(path.join(root, 'package.json')).version.replace(/-.*/, '');
  const vi = html.match(/data-i18n="hero\.1"[^>]*>([\s\S]*?)<\/span>\s*\n?/); assert.ok(html.includes(`Phiên bản ${v} `), 'vi'); 
  assert.ok(D.en['hero.1'].includes(`Version ${v} `), 'en'); assert.ok(D.zh['hero.1'].includes(`${v} 版`), 'zh');
});
test('có nút chọn ngôn ngữ, đặt <html lang>, nhớ lựa chọn, tự chọn theo trình duyệt', () => {
  for (const l of ['vi', 'en', 'zh']) assert.ok(html.includes(`data-lang="${l}"`));
  assert.ok(html.includes("localStorage.setItem(KEY") && html.includes('navigator.languages') && html.includes("documentElement.lang=l==='zh'?'zh-CN':l"));
  assert.ok(/Microsoft YaHei/.test(html) && /PingFang SC/.test(html), 'thiếu phông tiếng Trung cho Windows/Mac');
});
test('bản dịch trong site/i18n/*.json đã được ghép vào index.html', () => {
  const r = require('child_process').spawnSync('python3', [path.join(root, 'tools/site_i18n_build.py'), '--check']); assert.strictEqual(r.status, 0, String(r.stderr));
});
