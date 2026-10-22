'use strict';
// #39 (C7, C8): Cài đặt › Công ty + chứng từ PDF A4 — báo giá, đơn bán, hoá đơn, phiếu giao/nhập, RFQ/đơn mua × vi/en/zh.
// Kiểm: logo, MST, bằng chữ, chữ ký, số trang, không sót tiếng Việt khi in en/zh, các mục Odoo có (ngày đặt hàng, điều khoản
// thanh toán + người phụ trách trên hoá đơn, phiếu chờ phần còn lại), và PDF thật (A4, ≤ 3 s/chứng từ, chữ trích ra được).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const P = require('../src/crm/print');

const F = require('./fixtures/pdf-docs'); const { COMPANY, LOGO } = F;
const fixture = () => F.make(ROOT, { many: 0 });
// chữ chỉ tiếng Việt có (không có trong tiếng Anh/Pháp thông dụng)
const VI = /[ăâđêôơưĂÂĐÊÔƠƯạ-ỹẠ-Ỹàáảãèéẻẽìíỉĩòóỏõùúủũỳýỷỹ]/;
const USER = ['Công ty TNHH Giải pháp AIVN', COMPANY.address, COMPANY.bank_branch, COMPANY.signer, COMPANY.accountant, COMPANY.doc_footer, 'Nguyễn Thị Hương', 'Công ty Cổ phần Thương mại Sen Vàng', '45 Trần Hưng Đạo, Hoàn Kiếm, Hà Nội',
  'Công ty Gỗ Bình Dương', 'KCN Sóng Thần, Dĩ An, Bình Dương', 'Bàn làm việc gỗ sồi', 'Ghế xoay lưới', 'Phần mềm kế toán', 'Giá đã gồm vận chuyển.', 'NĐ-CP'];
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<title>[\s\S]*?<\/title>/, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const leftovers = (html) => { let s = visible(html); for (const u of USER.sort((a, b) => b.length - a.length)) { s = s.split(u).join(' '); s = s.split(u.toUpperCase()).join(' '); } return s.split(/\s{2,}|\n/).map(x => x.trim()).filter(x => VI.test(x)); };

test('Cài đặt › Công ty: lưu tên, MST, địa chỉ, logo, tài khoản ngân hàng; từ chối dữ liệu sai', async () => {
  const { biz } = await fixture();
  const c = biz.getCompany();
  for (const k of ['name', 'tax_id', 'address', 'bank_bin', 'bank_account', 'bank_holder', 'signer']) assert.strictEqual(c[k], COMPANY[k], k);
  assert.strictEqual(c.logo, LOGO);
  assert.throws(() => biz.saveCompany({ ...COMPANY, name: '' }), /tên công ty/);
  assert.throws(() => biz.saveCompany({ ...COMPANY, tax_id: '12345' }), /Mã số thuế/);
  assert.throws(() => biz.saveCompany({ ...COMPANY, logo: 'data:image/svg+xml;base64,PHN2Zz4=' }), /PNG, JPEG hoặc WebP/);
  assert.throws(() => biz.saveCompany({ ...COMPANY, logo: 'data:image/png;base64,' + 'A'.repeat(600 * 1024) }), /logo quá lớn/);
  assert.throws(() => biz.saveCompany({ ...COMPANY, bank_account: '12' }), /Số tài khoản/);
  assert.throws(() => biz.saveCompany({ ...COMPANY, bank_bin: '' }), /chọn ngân hàng/);
  assert.strictEqual(biz.getCompany().tax_id, '0312345678', 'lưu lỗi không ghi đè dữ liệu cũ');
  biz.saveCompany({ ...COMPANY, logo: '', tax_id: '0312345678-001' }); assert.ok(!biz.getCompany().logo); assert.strictEqual(biz.getCompany().tax_id, '0312345678-001');
});

test('7 chứng từ × vi/en/zh: logo, MST, bằng chữ, chữ ký, không sót tiếng Việt chưa dịch', async () => {
  const { crm, biz, docs } = await fixture();
  const words = { vi: 'Số tiền viết bằng chữ', en: 'Amount in words', zh: '大写' }; const mst = { vi: 'MST', en: 'Tax ID', zh: '税号' };
  const hint = { vi: 'Ký, ghi rõ họ tên', en: 'Signature and full name', zh: '签字' };
  for (const lang of ['vi', 'en', 'zh']) for (const [type, id, n] of docs) {
    const r = P.renderDoc(biz, crm, type, id, lang); const h = r.html; const at = `${lang}/${n}`;
    assert.ok(h.includes(`src="${LOGO}"`), at + ': thiếu logo');
    assert.ok(h.includes(mst[lang]) && h.includes('0312345678'), at + ': thiếu MST công ty');
    assert.ok(h.includes('0011001234567'), at + ': thiếu tài khoản ngân hàng');
    if (type !== 'picking') assert.ok(h.includes(words[lang]), at + ': thiếu số tiền bằng chữ');
    assert.ok(h.includes(hint[lang]) || (lang === 'zh' && /签/.test(h)), at + ': thiếu vùng chữ ký');
    assert.ok(/class="sign"/.test(h) && (h.match(/class="role"/g) || []).length >= 2, at + ': vùng chữ ký phải có ≥ 2 người ký');
    assert.match(r.name, /\.pdf$/);
    if (lang !== 'vi') assert.deepStrictEqual(leftovers(h), [], at + ': còn tiếng Việt chưa dịch');
  }
});

test('Odoo: đơn bán in «Ngày đặt hàng» (bỏ hạn hiệu lực); hoá đơn có điều khoản thanh toán + người phụ trách; phiếu ghi phiếu chờ phần còn lại', async () => {
  const { crm, biz, q, so, inv, rc } = await fixture();
  const qh = P.renderDoc(biz, crm, 'quote', q.id, 'vi').html; assert.ok(qh.includes('Ngày báo giá') && qh.includes('Hiệu lực đến') && qh.includes('20/11/2026'));
  const sh = P.renderDoc(biz, crm, 'quote', so.id, 'vi').html; assert.ok(sh.includes('ĐƠN BÁN HÀNG') || sh.includes('Đơn bán hàng')); assert.ok(sh.includes('Ngày đặt hàng')); assert.ok(!sh.includes('Hiệu lực đến'));
  assert.ok(P.renderDoc(biz, crm, 'quote', so.id, 'en').html.includes('Order date'));
  const ih = P.renderDoc(biz, crm, 'invoice', inv.id, 'vi').html; assert.ok(ih.includes('Điều khoản thanh toán') && ih.includes('15 ngày') && ih.includes('Nguyễn Thị Hương'));
  const ie = P.renderDoc(biz, crm, 'invoice', inv.id, 'en').html; assert.ok(ie.includes('Payment terms') && ie.includes('15 days') && ie.includes('Salesperson'));
  const iz = P.renderDoc(biz, crm, 'invoice', inv.id, 'zh').html; assert.ok(iz.includes('付款条款') && iz.includes('销售员'));
  const back = biz.getPicking(rc.id).backorders[0]; assert.ok(back && back.number);
  assert.ok(P.renderDoc(biz, crm, 'picking', rc.id, 'vi').html.includes('Phiếu chờ phần còn lại'));
  const pe = P.renderDoc(biz, crm, 'picking', rc.id, 'en').html; assert.ok(pe.includes('Backorders') && pe.includes(back.number));
  // hoá đơn tự lập (không từ đơn) không in điều khoản giả
  const free = biz.saveInvoice({ partner_id: biz.getInvoice(inv.id).partner_id, lines: [{ name: 'Dịch vụ', qty: 1, price: 100000 }] });
  assert.ok(!P.renderDoc(biz, crm, 'invoice', free.id, 'vi').html.includes('Điều khoản thanh toán'));
});

// PDF thật: Electron in ẩn (printToPDF) như ứng dụng → A4, số trang “n/N”, ≤ 3 s, chữ có dấu + chữ Hán trích ra được
const hasX = spawnSync('which', ['xvfb-run']).status === 0 && spawnSync('which', ['pdftotext']).status === 0 && fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron'));
test('PDF thật (Electron): 7 chứng từ × vi/en/zh — A4, số trang, ≤ 3 s, chữ trích ra đúng; chứng từ dài lặp tiêu đề bảng', { skip: !hasX && 'cần xvfb-run + electron + pdftotext' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-pdfx-'));
  const script = path.join(dir, 'gen.js');
  fs.writeFileSync(script, `
const { app, BrowserWindow } = require('electron'); const fs = require('fs'); const path = require('path');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const R = ${JSON.stringify(ROOT)}; const OUT = ${JSON.stringify(dir)};
    const { toPdf } = require(R + '/src/biz-pdf').registerBizPdf({ ipcMain: { handle() {} }, BrowserWindow, dialog: {}, shell: {}, getWin: () => null, getCrm: async () => null, T: s => s, uiLang: () => 'vi', log: () => {} });
    const F = require(${JSON.stringify(path.join(__dirname, 'fixtures', 'pdf-docs.js'))}); const { crm, biz, docs, many } = await F.make(R);
    const P = require(R + '/src/crm/print'); const times = [];
    for (const L of ['vi', 'en', 'zh']) for (const [t, id, n] of docs.concat([['quote', many.id, 'dai']])) {
      const t0 = Date.now(); const d = P.renderDoc(biz, crm, t, id, L); const buf = await toPdf(d.html, { title: d.title, number: d.number, lang: L });
      fs.writeFileSync(path.join(OUT, L + '-' + n + '.pdf'), buf); times.push({ L, n, ms: Date.now() - t0 });
    }
    fs.writeFileSync(path.join(OUT, 'times.json'), JSON.stringify(times));
  } catch (e) { fs.writeFileSync(${JSON.stringify(path.join(dir, 'error.txt'))}, String(e && e.stack || e)); }
  app.exit(0);
});`);
  const r = spawnSync('timeout', ['180', 'xvfb-run', '-a', path.join(ROOT, 'node_modules/.bin/electron'), script, '--no-sandbox'], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(!fs.existsSync(path.join(dir, 'error.txt')), fs.existsSync(path.join(dir, 'error.txt')) ? fs.readFileSync(path.join(dir, 'error.txt'), 'utf8') : '');
  assert.ok(fs.existsSync(path.join(dir, 'times.json')), 'Electron không xuất xong: ' + (r.stderr || '').slice(-600));
  const times = JSON.parse(fs.readFileSync(path.join(dir, 'times.json'), 'utf8')); assert.strictEqual(times.length, 24);
  for (const t of times) assert.ok(t.ms <= 3000, `${t.L}-${t.n}: ${t.ms} ms > 3 s`);
  const info = (f) => spawnSync('pdfinfo', [f], { encoding: 'utf8' }).stdout; const text = (f) => spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout;
  for (const t of times) {
    const f = path.join(dir, `${t.L}-${t.n}.pdf`); assert.strictEqual(fs.readFileSync(f).subarray(0, 5).toString(), '%PDF-');
    const i = info(f); if (i) assert.match(i, /Page size:\s+59[45](\.\d+)? x 84[12](\.\d+)? pts \(A4\)/, f);
    const pages = Number((i.match(/Pages:\s+(\d+)/) || [])[1] || 1); const s = text(f);
    assert.match(s, new RegExp(`1\\s*/\\s*${pages}`), f + ': thiếu số trang');
    assert.match(s, /Bàn làm việc gỗ sồi|Ghế xoay lưới/, f + ': chữ có dấu không trích ra được');
    if (t.L === 'zh') assert.match(s, /编号/);
    if (t.L === 'vi' && t.n === 'hoa-don') { assert.match(s, /HOÁ ĐƠN BÁN HÀNG/); assert.match(s, /Số tiền viết bằng chữ/); }
  }
  const longInfo = info(path.join(dir, 'vi-dai.pdf')); const longPages = Number((longInfo.match(/Pages:\s+(\d+)/) || [])[1] || 0);
  assert.ok(longPages >= 2, 'báo giá 60 dòng phải nhiều trang');
  const longText = spawnSync('pdftotext', [path.join(dir, 'vi-dai.pdf'), '-'], { encoding: 'utf8' }).stdout;
  assert.strictEqual((longText.match(/Tên hàng hoá, dịch vụ/g) || []).length, longPages, 'tiêu đề bảng lặp lại mỗi trang');
  assert.match(longText, new RegExp(`${longPages}\\s*/\\s*${longPages}`));
});

