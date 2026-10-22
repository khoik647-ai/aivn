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
  assert.ok(/khoik647@gmail\.com/.test(contact) && /0896 403 538/.test(contact), 'thiếu khối liên hệ');
  // QA B9: nhãn “Điện thoại” và aria-label được dịch; en/zh hiện số quốc tế +84 896 403 538; liên kết gọi có +84 để gọi được từ nước ngoài
  assert.match(contact, /href="tel:\+84896403538"/); assert.match(contact, /data-i18n-aria-label="@aria-label\.contact"/);
  for (const l of ['en', 'zh']) { assert.strictEqual(D[l]['foot.phonenum'], '+84 896 403 538', l); assert.ok(D[l]['foot.phone'] && D[l]['@aria-label.contact'], l); }
  assert.strictEqual(D.en['foot.phone'], 'Phone:'); assert.strictEqual(D.zh['foot.phone'], '电话：');
  assert.ok(!/data-i18n="[^"]*"[^>]*>[^<]*khoik647/.test(contact), 'địa chỉ email không được dịch');
  for (const l of ['en', 'zh']) for (const k of keys) {
    const m = html.match(new RegExp(`data-i18n="${k.replace('.', '\\.')}"[^>]*>([\\s\\S]*?)<\\/`)); if (m && m[1].includes(NAME)) assert.ok(D[l][k].includes(NAME), `${l} ${k} mất tên tác giả`);
  }
});
// Huy hiệu hero ghi bản ỔN ĐỊNH đang phát hành trên trang (QA box beta.2.8): khi package.json là bản thử nghiệm (0.16.0-beta.x) thì đó là
// tag ổn định mới nhất (v0.15.3), không phải số của package; đến lúc phát hành bản ổn định (package không có “-”) thì phải khớp package.json.
const cmpV = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
function stableOnSite() {
  const pv = require(path.join(root, 'package.json')).version;
  if (!pv.includes('-')) return { v: pv, how: 'package.json (bản ổn định)' };
  try {
    const tags = require('child_process').execFileSync('git', ['tag', '-l', 'v*'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(t => t.trim()).filter(t => /^v\d+\.\d+\.\d+$/.test(t)).map(t => t.slice(1)).sort(cmpV);
    if (tags.length) return { v: tags[tags.length - 1], how: 'tag ổn định mới nhất' };
  } catch {}
  return { v: null, how: 'không có .git (bản git archive)' };
}
test('phiên bản trên trang là bản ổn định đang phát hành, khớp ở cả 3 ngôn ngữ', () => {
  const vi = (html.match(/Phiên bản (\d+\.\d+\.\d+) /) || [])[1]; assert.ok(vi, 'vi: không thấy “Phiên bản x.y.z”');
  assert.ok(D.en['hero.1'].includes(`Version ${vi} `), 'en'); assert.ok(D.zh['hero.1'].includes(`${vi} 版`), 'zh');
  const pv = require(path.join(root, 'package.json')).version.replace(/-.*/, '');
  assert.ok(cmpV(vi, pv) <= 0, `trang ghi ${vi} mới hơn package ${pv}`);
  const { v, how } = stableOnSite(); if (v) assert.strictEqual(vi, v, how);
});
test('có nút chọn ngôn ngữ, đặt <html lang>, nhớ lựa chọn, tự chọn theo trình duyệt', () => {
  for (const l of ['vi', 'en', 'zh']) assert.ok(html.includes(`data-lang="${l}"`));
  assert.ok(html.includes("localStorage.setItem(KEY") && html.includes('navigator.languages') && html.includes("documentElement.lang=l==='zh'?'zh-CN':l"));
  assert.ok(/Microsoft YaHei/.test(html) && /PingFang SC/.test(html), 'thiếu phông tiếng Trung cho Windows/Mac');
});
test('bản dịch trong site/i18n/*.json đã được ghép vào index.html', () => {
  const r = require('child_process').spawnSync('python3', [path.join(root, 'tools/site_i18n_build.py'), '--check']); assert.strictEqual(r.status, 0, String(r.stderr));
});

test('QA B10: dung lượng tải trên trang do release.sh điền từ tệp thật của bản phát hành', () => {
  assert.ok(!/~(233|251|264) MB/.test(html), 'còn dung lượng viết cứng cũ');
  for (const t of ['__MB_WIN__', '__MB_ARM__', '__MB_X64__']) assert.ok(html.includes(t), t);
  const rel = fs.readFileSync(path.join(root, 'release.sh'), 'utf8');
  assert.match(rel, /MB_WIN="\$\(mb "\$OUT\/AIVN-Setup\.exe"\)"/); assert.match(rel, /grep -q "__MB_" "\$SITE\/index\.html" && die/);
});
test('QA B11: trang web gọi mục tải mô hình là “Khám phá” (Discover / 发现), không còn “Kho mô hình”', () => {
  assert.ok(!/Kho mô hình/.test(html)); assert.ok(!Object.values(D.en).some(v => /Model Hub/.test(v))); assert.ok(!Object.values(D.zh).some(v => /模型库/.test(v)));
});
