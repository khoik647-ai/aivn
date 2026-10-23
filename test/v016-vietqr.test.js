'use strict';
// #40 (bảng chấm C6): VietQR trên hoá đơn — kiểm chuỗi theo đặc tả NAPAS/EMVCo bằng bộ đọc TLV + CRC viết riêng (không dùng src/crm/vietqr.js),
// số tiền = số còn phải thu, nội dung = số hoá đơn, hoá đơn đã trả đủ / nháp / huỷ / giấy báo có / hoá đơn NCC không có QR,
// giải mã ẢNH mã QR (SVG trên màn hình, PDF thật) bằng bộ đọc độc lập: zbarimg (zbar-tools) và/hoặc jsQR (AIVN_JSQR=đường dẫn gói jsqr).
// AIVN_VIETQR_SAMPLES=thư mục → chép PDF/PNG mẫu ra đó cho Khôi quét bằng app ngân hàng thật.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); const F = require('./fixtures/pdf-docs');
const V = require('../src/crm/vietqr'); const P = require('../src/crm/print');

// ---- bộ đọc độc lập theo EMVCo QRCPS-MPM v1.1 + NAPAS (QR_Format_T&C_v1.0_VN)
const CRC_T = Array.from({ length: 256 }, (_, i) => { let c = i << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1; return c & 0xffff; });
const crc = (s) => { let c = 0xffff; for (const b of Buffer.from(s, 'latin1')) c = ((c << 8) ^ CRC_T[((c >> 8) ^ b) & 0xff]) & 0xffff; return c.toString(16).toUpperCase().padStart(4, '0'); };
function tlv(s, where) {
  const out = []; let i = 0;
  while (i < s.length) {
    assert.ok(i + 4 <= s.length, `${where}: thiếu ID/độ dài ở vị trí ${i}`);
    const id = s.slice(i, i + 2), len = s.slice(i + 2, i + 4); assert.match(id, /^\d\d$/, `${where}: ID “${id}”`); assert.match(len, /^\d\d$/, `${where}: độ dài “${len}”`);
    const v = s.slice(i + 4, i + 4 + Number(len)); assert.strictEqual(v.length, Number(len), `${where}: trường ${id} bị cụt`); assert.ok(Number(len) >= 1, `${where}: trường ${id} rỗng`);
    out.push([id, v]); i += 4 + Number(len);
  }
  const ids = out.map(x => x[0]); assert.strictEqual(new Set(ids).size, ids.length, `${where}: trùng ID ${ids}`);
  return out;
}
function napas(payload) {
  assert.match(payload, /^[\x20-\x7e]+$/, 'chỉ ký tự ASCII in được'); assert.ok(payload.length <= 512, 'EMVCo: tối đa 512 ký tự');
  const top = tlv(payload, 'gốc'); const ids = top.map(x => x[0]); const o = Object.fromEntries(top);
  assert.strictEqual(ids[0], '00', '00 phải đứng đầu'); assert.strictEqual(o['00'], '01', 'Payload Format Indicator = 01');
  assert.strictEqual(ids.at(-1), '63', '63 (CRC) phải đứng cuối'); assert.strictEqual(o['63'].length, 4);
  assert.strictEqual(crc(payload.slice(0, -4)), o['63'], 'CRC-16/CCITT-FALSE tính trên cả “6304”');
  assert.deepStrictEqual([...ids].sort(), ids, 'ID cấp 1 tăng dần');
  for (const id of ['00', '01', '38', '53', '58', '63']) assert.ok(id in o, 'thiếu trường bắt buộc ' + id);
  for (const id of ids) assert.ok(['00', '01', '38', '52', '53', '54', '58', '59', '60', '62', '63'].includes(id), 'trường lạ ' + id);
  assert.ok(['11', '12'].includes(o['01']), 'Point of Initiation 11 (tĩnh) / 12 (động)');
  const m = Object.fromEntries(tlv(o['38'], '38')); assert.strictEqual(m['00'], 'A000000727', 'GUID NAPAS');
  assert.ok(['QRIBFTTA', 'QRIBFTTC'].includes(m['02']), 'dịch vụ chuyển nhanh đến tài khoản/thẻ'); assert.strictEqual(m['02'], 'QRIBFTTA');
  const ben = Object.fromEntries(tlv(m['01'], '38-01')); assert.match(ben['00'], /^\d{6}$/, 'BIN 6 chữ số'); assert.match(ben['01'], /^[0-9A-Za-z]{1,19}$/, 'số tài khoản ≤ 19 ký tự');
  assert.strictEqual(o['53'], '704', 'VND'); assert.strictEqual(o['58'], 'VN');
  if (o['01'] === '12') assert.match(o['54'] || '', /^[1-9]\d{0,12}$/, 'mã động: số tiền nguyên dương, VND không có phần lẻ'); else assert.ok(!('54' in o), 'mã tĩnh không có số tiền');
  let memo = '';
  if (o['62']) { const a = Object.fromEntries(tlv(o['62'], '62')); memo = a['08'] || ''; assert.ok(memo.length <= 25, 'nội dung ≤ 25 ký tự'); assert.match(memo, /^[A-Za-z0-9 _.-]*$/, 'nội dung chỉ chữ, số, “ _.-” (như Odoo l10n_vn)'); }
  return { dynamic: o['01'] === '12', bin: ben['00'], account: ben['01'], amount: o['54'] ? Number(o['54']) : null, memo };
}

// ---- giải mã ảnh
const has = (c) => spawnSync('which', [c]).status === 0;
const ZBAR = has('zbarimg'); const JSQR = (() => { try { return require(process.env.AIVN_JSQR || 'jsqr'); } catch { return null; } })();
const sharp = (() => { try { return require('sharp'); } catch { return null; } })();
function zbar(png) { const r = spawnSync('zbarimg', ['--raw', '-q', '-Sdisable', '-Sqrcode.enable', png], { encoding: 'utf8' }); return r.stdout.split('\n').filter(Boolean); }
async function jsqr(png) { const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const r = JSQR(new Uint8ClampedArray(data), info.width, info.height); return r ? [r.data] : []; }
async function decodeAll(png) { const out = {}; if (ZBAR) out.zbar = zbar(png); if (JSQR && sharp) out.jsqr = await jsqr(png); return out; }
const DECODER = (ZBAR || JSQR) && sharp;

test('VietQR: chuỗi đạt đặc tả NAPAS/EMVCo (bộ đọc TLV + CRC độc lập), mọi ngân hàng trong danh sách; từ chối dữ liệu sai', () => {
  assert.strictEqual(crc('123456789'), '29B1'); // giá trị kiểm chuẩn của CRC-16/CCITT-FALSE
  for (const b of V.BANKS) {
    const p = napas(V.build({ bin: b.bin, account: '0011001234567', amount: 1234567, memo: 'INV/2026/00001' }));
    assert.deepStrictEqual(p, { dynamic: true, bin: b.bin, account: '0011001234567', amount: 1234567, memo: 'INV-2026-00001' }, b.name);
  }
  assert.deepStrictEqual(napas(V.build({ bin: '970415', account: 'ABC123456789' })), { dynamic: false, bin: '970415', account: 'ABC123456789', amount: null, memo: '' });
  assert.strictEqual(napas(V.build({ bin: '970436', account: '0011001234567', amount: 1, memo: 'Hoá đơn #12 & quà/Tết — Đặng Thị Ánh Tuyết ✓' })).memo, 'Hoa don 12 qua-Tet Dang T');
  assert.strictEqual(napas(V.build({ bin: '970436', account: '0011001234567', amount: 9999999999999 })).amount, 9999999999999);
  assert.strictEqual(napas(V.build({ bin: '970436', account: '0011 0012 34' })).account, '0011001234', 'dấu cách nhập tay trong số tài khoản được bỏ');
  assert.strictEqual(napas(V.build({ bin: '970436', account: '0011001234567', amount: 150000.4 })).amount, 150000, 'VND làm tròn đồng');
  for (const bad of [{ bin: '97043', account: '0011001234567' }, { bin: '970436', account: '12345' }, { bin: '970436', account: '1'.repeat(20) }, { bin: '970436', account: '0011-0012/9' },
    { bin: '970436', account: '0011001234567', amount: 0 }, { bin: '970436', account: '0011001234567', amount: -5 }, { bin: '970436', account: '0011001234567', amount: 1e13 }]) assert.throws(() => V.build(bad), JSON.stringify(bad));
  // BIN trong danh sách: duy nhất, 6 chữ số; các ngân hàng lớn có đúng BIN NAPAS công bố
  const bins = V.BANKS.map(b => b.bin); assert.strictEqual(new Set(bins).size, bins.length); for (const b of bins) assert.match(b, /^\d{6}$/);
  assert.deepStrictEqual(['970436', '970415', '970418', '970405', '970407', '970422', '970416', '970432', '970423', '970403'].map(b => V.bankOf(b).code), ['VCB', 'ICB', 'BIDV', 'VBA', 'TCB', 'MB', 'ACB', 'VPB', 'TPB', 'STB']);
});

async function world() {
  const w = await F.make(ROOT, { many: 0 }); const { biz, cus, ven, inv } = w;
  const line = [{ name: 'Tư vấn triển khai', qty: 1, price: 5000000, vat_pct: 10 }];
  const fresh = biz.postInvoice(biz.saveInvoice({ partner_id: cus.id, lines: line }).id);
  const paid = biz.postInvoice(biz.saveInvoice({ partner_id: cus.id, lines: line }).id); biz.registerPayment(paid.id, {});
  const draft = biz.saveInvoice({ partner_id: cus.id, lines: line });
  const cancel = biz.cancelInvoice(biz.saveInvoice({ partner_id: cus.id, lines: line }).id);
  const reversed = biz.postInvoice(biz.saveInvoice({ partner_id: cus.id, lines: line }).id); const refund = biz.postInvoice(biz.creditNote(reversed.id).id);
  const bill = biz.postInvoice(biz.saveInvoice({ kind: 'in_invoice', partner_id: ven.id, lines: line }).id);
  return { ...w, partial: biz.getInvoice(inv.id), fresh, paid: biz.getInvoice(paid.id), draft, cancel, reversed: biz.getInvoice(reversed.id), refund, bill };
}

test('Hoá đơn: số tiền = số còn phải thu, nội dung = số hoá đơn, tài khoản lấy ở Cài đặt › Công ty; trả đủ / nháp / huỷ / báo có / NCC thì không có QR', async () => {
  const w = await world(); const { biz, crm } = w;
  const due = (inv) => { const q = biz.invoiceQr(inv.id); assert.strictEqual(q.ok, true, inv.number); const p = napas(q.payload);
    assert.strictEqual(p.dynamic, true); assert.strictEqual(p.bin, F.COMPANY.bank_bin); assert.strictEqual(p.account, F.COMPANY.bank_account);
    assert.strictEqual(p.amount, inv.residual); assert.strictEqual(p.memo, inv.number.replace(/\//g, '-')); assert.strictEqual(q.memo, p.memo); assert.strictEqual(q.amount, inv.residual);
    assert.strictEqual(q.bank, 'Vietcombank'); assert.strictEqual(q.holder, F.COMPANY.bank_holder); return q; };
  assert.ok(w.partial.residual > 0 && w.partial.residual < w.partial.amount_total, 'hoá đơn đã trả một phần'); due(w.partial);
  assert.strictEqual(w.fresh.residual, 5500000); due(w.fresh);
  // trả thêm một phần → mã đổi theo số còn lại; trả hết → hết mã
  biz.registerPayment(w.fresh.id, { amount: 2000000 }); const f2 = biz.getInvoice(w.fresh.id); assert.strictEqual(due(f2).amount, 3500000);
  for (const [k, inv] of [['đã trả đủ', w.paid], ['nháp', w.draft], ['đã huỷ', w.cancel], ['đã báo có toàn bộ', w.reversed], ['giấy báo có', w.refund], ['hoá đơn NCC', w.bill]]) {
    assert.strictEqual(biz.invoiceQr(inv.id).ok, false, k);
    for (const L of ['vi', 'en', 'zh']) { const h = P.renderDoc(biz, crm, 'invoice', inv.id, L).html; assert.ok(!/class="qr"/.test(h) && !/VietQR/.test(h), `${k} (${L}): PDF không có QR`); }
  }
  // hoá đơn trả đủ: PDF đóng dấu “đã thanh toán” ở cả 3 ngôn ngữ
  const stamp = { vi: 'Đã thanh toán', en: 'Paid', zh: '已付款' };
  for (const L of ['vi', 'en', 'zh']) assert.match(P.renderDoc(biz, crm, 'invoice', w.paid.id, L).html, new RegExp(stamp[L], 'i'), L);
  // PDF còn phải thu: khung VietQR với nhãn đã dịch, số tiền và nội dung khớp mã
  const lbl = { vi: ['Quét mã VietQR để chuyển khoản', 'Số tài khoản', 'Nội dung'], en: ['Scan the VietQR code to pay by bank transfer', 'Account number', 'Memo'], zh: ['扫描 VietQR 码转账付款', '账号', '备注'] };
  for (const L of ['vi', 'en', 'zh']) {
    const h = P.renderDoc(biz, crm, 'invoice', w.partial.id, L).html; assert.match(h, /<section class="qr"><div class="qr-img"><svg/, L);
    assert.ok(h.includes(w.partial.number.replace(/\//g, '-')) && h.includes(F.COMPANY.bank_account), L);
    for (const s of lbl[L]) assert.ok(h.includes(s), `${L}: thiếu “${s}”`);
  }
  // chưa nhập ngân hàng → không có QR (màn hình gợi ý vào Cài đặt › Công ty); ngân hàng ngoài danh sách bị từ chối khi lưu
  biz.saveCompany({ ...F.COMPANY, bank_bin: '', bank_account: '' }); assert.deepStrictEqual(biz.invoiceQr(w.partial.id), { ok: false, reason: 'no_bank' });
  assert.ok(!/class="qr"/.test(P.renderDoc(biz, crm, 'invoice', w.partial.id, 'vi').html));
  assert.throws(() => biz.saveCompany({ ...F.COMPANY, bank_bin: '123456' }), /VietQR|ngân hàng/i);
  // đổi tài khoản ở Cài đặt › Công ty → mã dùng tài khoản mới
  biz.saveCompany({ ...F.COMPANY, bank_bin: '970418', bank_account: '2150 1234 5678' }); const p = napas(biz.invoiceQr(w.partial.id).payload);
  assert.deepStrictEqual([p.bin, p.account], ['970418', '215012345678']);
});

test('Ảnh mã QR (SVG như trên màn hình) giải mã bằng zbar/jsQR ra đúng chuỗi — cả cỡ in 34 mm ở 150 dpi', { skip: !DECODER && 'cần sharp + zbarimg hoặc jsQR' }, async () => {
  const w = await world(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-vqr-'));
  for (const inv of [w.partial, w.fresh]) {
    const q = w.biz.invoiceQr(inv.id);
    for (const px of [600, 200]) {
      const f = path.join(dir, `${inv.id}-${px}.png`); await sharp(Buffer.from(q.svg), { density: 300 }).resize(px, px).flatten({ background: '#fff' }).png().toFile(f);
      const got = await decodeAll(f); assert.ok(Object.keys(got).length, 'không có bộ giải mã');
      for (const [k, v] of Object.entries(got)) assert.deepStrictEqual(v, [q.payload], `${k} @${px}px`);
    }
  }
});

// PDF thật (Electron printToPDF như ứng dụng) → ảnh 150 dpi → giải mã: đúng chuỗi ở vi/en/zh; hoá đơn trả đủ không có mã nào
const hasX = has('xvfb-run') && has('pdftoppm') && fs.existsSync(path.join(ROOT, 'node_modules/.bin/electron'));
test('PDF thật: mã VietQR trên hoá đơn vi/en/zh giải mã đúng (số còn phải thu, số hoá đơn); hoá đơn đã trả không có mã', { skip: !(hasX && DECODER) && 'cần xvfb-run + electron + pdftoppm + bộ giải mã' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-vqrpdf-')); const script = path.join(dir, 'gen.js');
  fs.writeFileSync(script, `
const { app, BrowserWindow } = require('electron'); const fs = require('fs'); const path = require('path');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const R = ${JSON.stringify(ROOT)}; const OUT = ${JSON.stringify(dir)};
    const { toPdf } = require(R + '/src/biz-pdf').registerBizPdf({ ipcMain: { handle() {} }, BrowserWindow, dialog: {}, shell: {}, getWin: () => null, getCrm: async () => null, T: s => s, uiLang: () => 'vi', log: () => {} });
    const F = require(${JSON.stringify(path.join(__dirname, 'fixtures', 'pdf-docs.js'))}); const { crm, biz, cus, inv } = await F.make(R, { many: 0 });
    const paid = biz.postInvoice(biz.saveInvoice({ partner_id: cus.id, lines: [{ name: 'Tư vấn', qty: 1, price: 5000000, vat_pct: 10 }] }).id); biz.registerPayment(paid.id, {});
    const P = require(R + '/src/crm/print'); const meta = { payload: biz.invoiceQr(inv.id).payload, residual: biz.getInvoice(inv.id).residual, number: biz.getInvoice(inv.id).number, times: [] };
    for (const L of ['vi', 'en', 'zh']) for (const [id, n] of [[inv.id, 'con-phai-thu'], [paid.id, 'da-tra']]) {
      const t0 = Date.now(); const d = P.renderDoc(biz, crm, 'invoice', id, L); fs.writeFileSync(path.join(OUT, L + '-' + n + '.pdf'), await toPdf(d.html, { title: d.title, number: d.number, lang: L })); meta.times.push(Date.now() - t0);
    }
    fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
  } catch (e) { fs.writeFileSync(path.join(${JSON.stringify(dir)}, 'error.txt'), String(e && e.stack || e)); }
  app.exit(0);
});`);
  const r = spawnSync('timeout', ['180', 'xvfb-run', '-a', path.join(ROOT, 'node_modules/.bin/electron'), script, '--no-sandbox'], { cwd: ROOT, encoding: 'utf8' });
  const err = path.join(dir, 'error.txt'); assert.ok(!fs.existsSync(err), fs.existsSync(err) ? fs.readFileSync(err, 'utf8') : '');
  assert.ok(fs.existsSync(path.join(dir, 'meta.json')), 'Electron không xuất xong: ' + (r.stderr || '').slice(-600));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); for (const ms of meta.times) assert.ok(ms <= 3000, ms + ' ms');
  const p = napas(meta.payload); assert.strictEqual(p.amount, meta.residual); assert.strictEqual(p.memo, meta.number.replace(/\//g, '-'));
  const SAMPLES = process.env.AIVN_VIETQR_SAMPLES; if (SAMPLES) fs.mkdirSync(SAMPLES, { recursive: true });
  for (const L of ['vi', 'en', 'zh']) for (const n of ['con-phai-thu', 'da-tra']) {
    const pdf = path.join(dir, `${L}-${n}.pdf`); const base = path.join(dir, `${L}-${n}`);
    assert.strictEqual(spawnSync('pdftoppm', ['-r', '150', '-png', '-singlefile', pdf, base]).status, 0); const png = base + '.png';
    const got = await decodeAll(png);
    for (const [k, v] of Object.entries(got)) assert.deepStrictEqual(v, n === 'da-tra' ? [] : [meta.payload], `${L}-${n} (${k})`);
    if (SAMPLES) { fs.copyFileSync(pdf, path.join(SAMPLES, `hoa-don-${n}-${L}.pdf`)); fs.copyFileSync(png, path.join(SAMPLES, `hoa-don-${n}-${L}.png`)); }
  }
  if (SAMPLES) fs.writeFileSync(path.join(SAMPLES, 'payload.txt'), meta.payload + '\n');
});
