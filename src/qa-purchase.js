// QA 0.16 Kinh doanh P0/P1 (AIVN_QA_PURCHASE=thư mục, chỉ khi phát triển): đi bằng giao diện thật —
// Cài đặt › Công ty (logo, MST, ngân hàng → mã VietQR thử) → yêu cầu báo giá → xác nhận đơn mua → nhận 6/10 (phiếu chờ 4) → hoá đơn NCC → trả một phần
// → báo cáo mua hàng, công nợ phải trả → hoá đơn khách 8% + 10% có VietQR → PDF (hoá đơn, đơn mua, phiếu nhập). Chụp từng màn hình;
// AIVN_QA_BIZ_LANG=en|zh thì liệt kê chữ tiếng Việt còn sót trên màn hình.
'use strict';
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function qaPurchase({ win, app, VI }) {
  if (process.env.AIVN_QA_TAX41) return qaTax41({ win, app, VI });
  const dir = process.env.AIVN_QA_PURCHASE; fs.mkdirSync(dir, { recursive: true });
  process.env.AIVN_QA_PDF_DIR = process.env.AIVN_QA_PDF_DIR || path.join(dir, 'pdf');
  const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  const errs = []; wc.on('console-message', (ev) => { const m = ev && ev.message; if (m && /error|lỗi|uncaught/i.test(m)) errs.push(String(m).slice(0, 300)); });
  const until = async (c, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(150); } return false; };
  const out = { steps: {}, errs }; win.setBounds({ x: 0, y: 0, width: 1366, height: 900 });
  await until('typeof show === "function" && !!state.settings && !!window.BIZ', 60000);
  await js(`localStorage.setItem('aivn.onboarded', '1'); document.querySelector('#onboard') && (document.querySelector('#onboard').hidden = true)`);
  const lang = process.env.AIVN_QA_BIZ_LANG || 'vi';
  if (lang !== 'vi') { await js(`I18N.setLang(${JSON.stringify(lang)})`); await sleep(300); }
  const shot = async (n) => { await sleep(600); fs.writeFileSync(path.join(dir, `${lang}-${n}.png`), (await wc.capturePage()).toPNG()); };
  const look = () => js(`({ crumbs: (document.querySelector('#view-crm.on .biz-crumbs, .biz-crumbs') || {}).innerText || '', status: (document.querySelector('.biz-status .on') || {}).innerText || '', toasts: [...document.querySelectorAll('.toast-stack .toast-item')].map(t => t.innerText.trim()), err: ((document.querySelector('#bizErr') || {}).textContent || '') + ((document.querySelector('#coErr') || {}).textContent || '') })`);
  const left = (root) => js(`(() => { const VI = ${VI}; const hits = new Set(); const w = document.createTreeWalker(document.querySelector(${JSON.stringify(root)}), NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.trim(); if (t && VI.test(t) && n.parentElement.offsetParent && !n.parentElement.closest('.biz-lines td:nth-child(-n+2), select, .biz-title, input, textarea, .biz-list td, .biz-qr .small, .biz-ro div')) hits.add(t.slice(0, 80)); } document.querySelectorAll(${JSON.stringify(root)} + ' button, ' + ${JSON.stringify(root)} + ' th, ' + ${JSON.stringify(root)} + ' label').forEach(e => { if (e.offsetParent && VI.test(e.getAttribute('aria-label') || '')) hits.add('@aria ' + e.getAttribute('aria-label')); }); return [...hits]; })()`);
  const step = async (n, code, wait = 600, root = '#view-crm') => { try { if (code) await js(code); await sleep(wait); await shot(n); out.steps[n] = await look(); if (lang !== 'vi') out.steps[n].leftover = await left(root); } catch (e) { out.steps[n] = { error: e.message }; } };
  const click = (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('không thấy ' + ${JSON.stringify(sel)}); b.click(); })()`;
  const yes = `document.querySelector('#cfYes').click()`;
  const C = (fn, ...a) => js(`(async () => { const r = await A.crm(${JSON.stringify(fn)}, ...${JSON.stringify(a)}); if (!r.ok) throw new Error(${JSON.stringify(fn)} + ': ' + r.error); return r.data; })()`);
  const pick = (row, startsWith) => `(async () => { const s = document.querySelector('tr[data-line="${row}"] [data-lf=product_id]'); s.value = [...s.options].find(o => o.text.startsWith(${JSON.stringify(startsWith)})).value; s.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 350)); })()`;
  const setLine = (row, field, v) => `(async () => { const i = document.querySelector('tr[data-line="${row}"] [data-lf=${field}]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 350)); })()`;
  const W = (ms = 350) => sleep(ms);
  try {
    await C('saveContact', { name: 'Công ty Gỗ Bình Dương', kind: 'company', phone: '02743812345', email: 'banhang@gobinhduong.vn', address: 'KCN Sóng Thần, Dĩ An, Bình Dương', tax_id: '3701234567' });
    await C('saveContact', { name: 'Công ty TNHH Sen Vàng', kind: 'company', phone: '02838123456', email: 'lienhe@senvang.vn', address: '12 Nguyễn Huệ, Q.1, TP.HCM', tax_id: '0312345678' });
    await C('saveProduct', { name: 'Bàn làm việc gỗ sồi', sku: 'BAN-01', price: 2500000, cost: 0, type: 'product', unit: 'cái', category: 'Nội thất', vat_pct: 10 });
    await C('saveProduct', { name: 'Vận chuyển', price: 500000, cost: 500000, type: 'service', unit: 'chuyến', vat_pct: 8 });
    await C('saveProduct', { name: 'Phần mềm kế toán (năm)', price: 12000000, type: 'service', unit: 'gói', vat_pct: 8 });
    // ---- Cài đặt › Công ty (nhập bằng giao diện; logo vẽ bằng canvas rồi đi qua bộ thu nhỏ)
    await js(`show('settings'); setTab('company'); BIZ.renderCompany()`); await W(900);
    await js(`(async () => { const set = (k, v) => { const e = document.querySelector('[data-co="' + k + '"]'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
      set('name', 'Công ty TNHH Giải pháp AIVN'); set('tax_id', '0312345678'); set('address', '12 Lê Lợi, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh'); set('phone', '028 3822 1234'); set('email', 'ketoan@aivn.vn');
      set('bank_bin', '970436'); set('bank_account', '0011001234567'); set('bank_holder', 'CONG TY TNHH GIAI PHAP AIVN'); set('signer', 'Đặng Văn Khôi'); set('accountant', 'Nguyễn Thị Hoa'); set('doc_footer', 'Cảm ơn quý khách đã tin dùng AIVN!');
      const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 400; const g = cv.getContext('2d'); g.fillStyle = '#1f3a5f'; g.fillRect(0, 0, 400, 400); g.fillStyle = '#f4b400'; g.beginPath(); g.arc(200, 200, 120, 0, 7); g.fill(); g.fillStyle = '#1f3a5f'; g.font = 'bold 220px sans-serif'; g.fillText('AIVN', 430, 280);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png')); const f = new File([blob], 'logo.png', { type: 'image/png' }); const inp = document.querySelector('#coLogoFile'); const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await W(1200);
    await step('01-cong-ty', click('#coSave'), 1200, '#view-settings');
    out.company = await C('getCompany'); out.company.logo = out.company.logo ? out.company.logo.length : 0;
    // ---- Yêu cầu báo giá → đơn mua
    await step('02-mua-hang-trong', 'show("crm"); crm.tab = "purchase"; BIZ.reset(); BIZ.state.sub.purchase = "rfq"; renderCrm()', 900);
    await js(click('#crmAdd')); await W(900);
    await js(`(async () => { const c = document.querySelector('[data-f=partner_id]'); c.value = [...c.options].find(o => o.text.includes('Gỗ Bình Dương')).value; c.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 350)); document.querySelector('[data-f=partner_ref]').value = 'BG-778'; document.querySelector('[data-f=payment_days]').value = '30'; })()`);
    await js(click('[data-biz-act=addLine]')); await W(); await js(pick(0, 'Bàn')); await js(setLine(0, 'qty', '10')); await js(setLine(0, 'price', '1.000.000'));
    await js(click('[data-biz-act=addLine]')); await W(); await js(pick(1, 'Vận')); 
    await step('03-rfq-moi', null, 300);
    await step('04-rfq-luu', click('[data-biz-act=savePurchase]'), 1100);
    await step('05-rfq-da-gui', click('[data-biz-act=sendRfq]'), 1000);
    await step('06-don-mua', click('[data-biz-act=confirmPurchase]'), 1200);
    // #42 K1: xác nhận đơn với giá chưa có trong bảng giá NCC → hỏi cập nhật bảng giá NCC (như Odoo) → đồng ý
    await until(`!document.querySelector('#confirmModal').hidden`, 8000);
    out.vendorAsk = await js(`({ open: !document.querySelector('#confirmModal').hidden, title: document.querySelector('#cfTitle').innerText, msg: document.querySelector('#cfMsg').innerText, yes: document.querySelector('#cfYes').innerText, no: document.querySelector('#cfNo').innerText })`);
    await shot('06b-hoi-gia-ncc'); await js(yes); await W(900);
    out.vendorAsk.closed = await js(`document.querySelector('#confirmModal').hidden`);
    out.vendorPrices = (await C('listVendorPrices', {})).map(v => ({ price: v.price, min_qty: v.min_qty, delay: v.delay }));
    out.po = await js(`({ total: document.querySelector('.biz-totals .grand b').innerText, taxes: [...document.querySelectorAll('.biz-totals > div')].map(d => d.innerText.replace(/\\s+/g, ' ')), smart: [...document.querySelectorAll('.biz-smart')].map(b => b.innerText) })`);
    // ---- nhận 6/10 → phiếu chờ 4
    await step('07-phieu-nhap', click('[data-biz-act=receivePurchase]'), 1100);
    await js(`(() => { for (const i of document.querySelectorAll('[data-move]')) i.value = '6'; })()`);
    await js(click('[data-biz-act=validatePicking]')); await W(900); await step('08-hoi-phieu-cho', null, 200);
    await js(yes); await W(1300); await step('09-nhan-mot-phan', null, 300);
    await js(click('[data-biz-act=printPicking]')); await W(2500);
    out.stock = (await C('listStock', {})).rows.map(r => ({ name: r.name, on_hand: r.on_hand, incoming: r.incoming, cost: r.cost }));
    await step('10-don-mua-nhan-6', click('[data-biz-act=openPo]'), 1100);
    out.poAfterReceipt = await js(`({ badges: [...document.querySelectorAll('.biz-ro .biz-badge')].map(b => b.innerText), smart: [...document.querySelectorAll('.biz-smart')].map(b => b.innerText) })`);
    // ---- hoá đơn NCC theo số đã nhận → vào sổ → trả một phần
    await step('11-hoa-don-ncc-nhap', click('[data-biz-act=createBill]'), 1200);
    await js(`(() => { const r = document.querySelector('[data-f=ref]'); r.value = '0001234'; })()`);
    await step('12-hoa-don-ncc-vao-so', click('[data-biz-act=postInvoice]'), 1300);
    await step('13-tra-tien-hop', click('[data-biz-act=payInvoice]'), 800);
    await js(`(() => { const f = document.querySelector('#bizForm'); f.querySelector('[name=amount]').value = '2.000.000'; f.requestSubmit(); })()`); await W(1300);
    await step('14-tra-mot-phan', null, 300);
    out.bill = await js(`({ number: document.querySelector('.biz-title').innerText, ribbon: (document.querySelector('.biz-ribbon') || {}).innerText || '', due: [...document.querySelectorAll('.biz-totals .grand b')].map(b => b.innerText), lines: [...document.querySelectorAll('.biz-lines tbody tr')].map(t => t.innerText.replace(/\\s+/g, ' ')) })`);
    await step('15-pdf-don-mua', `(async () => { await new Promise(r => setTimeout(r, 10)); document.querySelector('[data-biz-act=openPo]').click(); })()`, 1200);
    await js(click('[data-biz-act=printPurchase]')); await W(2500);
    // ---- danh sách + báo cáo
    await step('16-ds-don-mua', 'BIZ.reset(); BIZ.state.sub.purchase = "po"; renderCrm()', 900);
    await step('17-cho-nhan-hang', 'BIZ.state.sub.purchase = "toreceive"; renderCrm()', 900);
    await step('18-ds-hoa-don-ncc', 'crm.tab = "invoices"; BIZ.reset(); BIZ.state.sub.invoices = "bills"; renderCrm()', 900);
    await step('19-bc-mua-hang', 'crm.tab = "reports"; BIZ.reset(); BIZ.state.sub.reports = "purchase"; BIZ.state.rep.groupBy = "product"; renderCrm()', 900);
    await step('20-bc-cong-no-phai-tra', 'BIZ.state.sub.reports = "payable"; renderCrm()', 900);
    out.payable = await C('payablesReport', {});
    // ---- hoá đơn khách: dòng 8% + dòng 10% → thuế tách theo mức, VietQR
    await js('crm.tab = "invoices"; BIZ.reset(); BIZ.state.sub.invoices = "inv"; renderCrm()'); await W(800);
    await js(click('#crmAdd')); await W(900);
    await js(`(async () => { const c = document.querySelector('[data-f=partner_id]'); c.value = [...c.options].find(o => o.text.includes('Sen Vàng')).value; c.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 350)); })()`);
    await js(click('[data-biz-act=addLine]')); await W(); await js(pick(0, 'Phần mềm'));
    await js(click('[data-biz-act=addLine]')); await W(); await js(pick(1, 'Bàn')); await js(setLine(1, 'qty', '2'));
    await step('21-hoa-don-2-muc-thue', null, 300);
    out.invDraft = await js(`[...document.querySelectorAll('.biz-totals > div')].map(d => d.innerText.replace(/\\s+/g, ' '))`);
    await js(click('[data-biz-act=saveInvoice]')); await W(1100);
    await step('22-hoa-don-vietqr', click('[data-biz-act=postInvoice]'), 1500);
    out.inv = await js(`({ number: document.querySelector('.biz-title').innerText, totals: [...document.querySelectorAll('.biz-totals > div')].map(d => d.innerText.replace(/\\s+/g, ' ')), qr: !!document.querySelector('.biz-qr svg'), qrText: (document.querySelector('.biz-qr') || {}).innerText || '' })`);
    await js(click('[data-biz-act=printInvoice]')); await W(2500);
    await step('23-tong-quan', 'crm.tab = "dash"; BIZ.reset(); renderCrm()', 1400);
    out.overview = await C('overview');
    // ---- B73 + đơn vị tính: kiểm kê gõ số theo thói quen từng ngôn ngữ; ô điền sẵn không sửa thì giữ đúng số (kể cả 1,125 mơ hồ)
    const banId = (await C('listStock', {})).rows.find(r => r.name.startsWith('Bàn')).id;
    const countDlg = async (typed) => { await js('crm.tab = "stock"; BIZ.reset(); BIZ.state.sub.stock = "onhand"; renderCrm()'); await W(800); await js(click(`[data-biz-act=count][data-id="${banId}"]`)); await W(500);
      const shown = await js(`document.querySelector('#bizForm [name=counted]').value`); if (typed != null) await js(`document.querySelector('#bizForm [name=counted]').value = ${JSON.stringify(typed)}`);
      await js(`document.querySelector('#bizForm').requestSubmit()`); await W(1000); return { shown, on_hand: (await C('listStock', {})).rows.find(r => r.id === banId).on_hand }; };
    out.b73 = { typed: await countDlg({ vi: '6,5', en: '6.5', zh: '６.５' }[lang]), same: await countDlg(null) };
    await C('adjustStock', banId, 1.125); out.b73.three = await countDlg(null);
    await step('24-kho-don-vi', 'crm.tab = "stock"; BIZ.reset(); BIZ.state.sub.stock = "onhand"; renderCrm()', 900);
    out.units = await js(`[...document.querySelectorAll('.biz-list tbody tr td:nth-child(3)')].map(td => td.innerText.trim())`);
    await C('adjustStock', banId, 6);
    out.pdfs = fs.existsSync(process.env.AIVN_QA_PDF_DIR) ? fs.readdirSync(process.env.AIVN_QA_PDF_DIR) : [];
    out.toasts = await js(`[...document.querySelectorAll('.toast-stack .toast-item')].map(t => t.innerText.trim())`);
  } catch (e) { out.error = e.message; }
  fs.writeFileSync(path.join(dir, `qapurchase-${lang}.json`), JSON.stringify(out, null, 2)); app.exit(0);
}
// #41 (C4): thuế GTGT theo dòng trên MÀN HÌNH thật — AIVN_QA_TAX41=tệp JSON [{ key, doc, lines }] (mẫu Odoo round_per_line).
// Tạo đủ 6 loại chứng từ (báo giá, đơn bán, hoá đơn, giấy báo có, đơn mua, hoá đơn NCC), mở từng biểu mẫu ở vi/en/zh, đọc ô tổng
// (tiền trước thuế, thuế theo từng mức + phần “trên”, tổng cộng) và thành tiền từng dòng; thêm một hoá đơn GÕ TAY trên biểu mẫu nháp
// (giao diện tự tính trước khi lưu) rồi lưu. Ghi ra qatax41.json để test so với số Odoo.
async function qaTax41({ win, app, VI }) {
  const dir = process.env.AIVN_QA_PURCHASE; fs.mkdirSync(dir, { recursive: true });
  const docs = JSON.parse(fs.readFileSync(process.env.AIVN_QA_TAX41, 'utf8'));
  const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  const errs = []; wc.on('console-message', (ev) => { const m = ev && ev.message; if (m && /error|lỗi|uncaught/i.test(m)) errs.push(String(m).slice(0, 300)); });
  const until = async (c, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(c)) return true; } catch {} await sleep(150); } return false; };
  win.setBounds({ x: 0, y: 0, width: 1366, height: 900 });
  const out = { docs: [], screens: {}, typed: {}, errs };
  const C = (fn, ...a) => js(`(async () => { const r = await A.crm(${JSON.stringify(fn)}, ...${JSON.stringify(a)}); if (!r.ok) throw new Error(${JSON.stringify(fn)} + ': ' + r.error); return r.data; })()`);
  const click = (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('không thấy ' + ${JSON.stringify(sel)}); b.click(); })()`;
  // ô tổng + thành tiền từng dòng (ô cuối cùng có “₫” của mỗi dòng)
  const read = () => js(`(() => { const box = document.querySelector('#crmBody .biz-totals'); if (!box) return null;
    const rows = [...box.querySelectorAll(':scope > div')].map(d => ({ label: (d.querySelector('span') || d).innerText.replace(/\\s+/g, ' ').trim(), value: (d.querySelector('b') || {}).innerText || '' }));
    const lines = [...document.querySelectorAll('#crmBody .biz-lines tbody tr')].map(tr => { const c = [...tr.querySelectorAll('td')].filter(td => /₫/.test(td.innerText)); return c.length ? c[c.length - 1].innerText.trim() : ''; });
    const VI = ${VI}; const left = []; const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.trim(); if (t && VI.test(t)) left.push(t); }
    return { rows, lines, left, title: (document.querySelector('.biz-title') || {}).innerText || '' }; })()`);
  try {
    await until('typeof show === "function" && !!state.settings && !!window.BIZ', 60000);
    await js(`localStorage.setItem('aivn.onboarded', '1'); document.querySelector('#onboard') && (document.querySelector('#onboard').hidden = true)`);
    const cus = await C('saveContact', { name: 'Công ty TNHH Sen Vàng', kind: 'company', tax_id: '0312345678' });
    const ven = await C('saveContact', { name: 'Công ty Gỗ Bình Dương', kind: 'company', tax_id: '3701234567' });
    for (const d of docs) {
      const lines = d.lines.map(l => ({ name: l.name, unit: 'cái', qty: l.qty, price: l.price, discount_pct: l.discount_pct, vat_pct: l.vat_pct }));
      let form, app2, id;
      if (d.doc === 'quote' || d.doc === 'sale_order') { const q = await C('saveQuote', { contact_id: cus.id, lines }); id = q.id; if (d.doc === 'sale_order') await C('confirmOrder', id); form = 'order'; app2 = 'sales'; }
      else if (d.doc === 'purchase_order') { const o = await C('savePurchase', { partner_id: ven.id, lines }); id = o.id; await C('confirmPurchase', id); form = 'purchase'; app2 = 'purchase'; }
      else { const inv = await C('saveInvoice', { partner_id: d.doc === 'vendor_bill' ? ven.id : cus.id, kind: d.doc === 'vendor_bill' ? 'in_invoice' : 'out_invoice', lines }); id = inv.id; await C('postInvoice', id);
        if (d.doc === 'credit_note') { const r = await C('creditNote', id, {}); id = r.id; await C('postInvoice', id); } form = 'invoice'; app2 = 'invoices'; }
      out.docs.push({ key: d.key, doc: d.doc, form, app: app2, id });
    }
    for (const lang of ['vi', 'en', 'zh']) {
      await js(`I18N.setLang(${JSON.stringify(lang)}); BIZ.reset(); show('crm')`); await sleep(1200);
      out.screens[lang] = {};
      for (const d of out.docs) {
        // một lần vẽ cho mỗi chứng từ: show('crm') cũng tự vẽ lại (bất đồng bộ) với form cũ → nếu gọi cùng lúc, lần vẽ cũ gán B.edit của chứng từ trước
        await js(`crm.tab = ${JSON.stringify(d.app)}; BIZ.reset(); document.querySelector('#crmBody').innerHTML = ''; BIZ.state.form = { type: ${JSON.stringify(d.form)}, id: ${JSON.stringify(d.id)} }; renderCrm()`);
        await until(`!!document.querySelector('#crmBody .biz-totals')`, 8000); await sleep(450);
        out.screens[lang][d.key] = await read();
        if (['S1', 'S3'].includes(d.key) || d.key.startsWith('T-')) fs.writeFileSync(path.join(dir, `${lang}-${d.key}.png`), (await wc.capturePage()).toPNG());
      }
      // hoá đơn gõ tay trên biểu mẫu nháp: giao diện tự tính (NUM.floatRound) trước khi lưu; số gõ theo thói quen của ngôn ngữ
      const typed = docs.find(x => x.typed); if (typed) {
        await js('crm.tab = "invoices"; BIZ.reset(); BIZ.state.sub.invoices = "inv"; renderCrm()'); await sleep(700);
        await js(click('#crmAdd')); await sleep(800);
        await js(`(async () => { const c = document.querySelector('[data-f=partner_id]'); c.value = [...c.options].find(o => o.text.includes('Sen Vàng')).value; c.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 350)); })()`);
        for (let i = 0; i < typed.lines.length; i++) {
          const l = typed.lines[i]; await js(click('[data-biz-act=addLine]')); await sleep(350);
          for (const [f, v] of [['name', l.name], ['qty', l.qty], ['price', l.price], ['discount_pct', l.discount_pct], ['vat_pct', l.vat_pct]]) {
            await js(`(async () => { const i = document.querySelector('tr[data-line="${i}"] [data-lf=${f}]'); i.value = ${f === 'name' || f === 'vat_pct' ? JSON.stringify(String(v)) : `window.AIVN_NUM.fmtInput(${JSON.stringify(v)}, UIL(), 3)`}; i.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); })()`);
          }
        }
        await sleep(400); const draft = await read();
        fs.writeFileSync(path.join(dir, `${lang}-go-tay-nhap.png`), (await wc.capturePage()).toPNG());
        await js(click('[data-biz-act=saveInvoice]')); await until(`!document.querySelector('[data-biz-act=saveInvoice]')`, 8000); await sleep(600);
        const saved = await read(); const id = await js('BIZ.state.form && BIZ.state.form.id');
        out.typed[lang] = { key: typed.key, draft, saved, stored: id ? await C('getInvoice', id) : null };
      }
    }
    await js(`I18N.setLang('vi')`);
  } catch (e) { out.error = e.message; }
  fs.writeFileSync(path.join(dir, 'qatax41.json'), JSON.stringify(out, null, 2)); app.exit(0);
}
module.exports = { qaPurchase };
