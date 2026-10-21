// QA 0.16 Kinh doanh P0/P1 (AIVN_QA_PURCHASE=thư mục, chỉ khi phát triển): đi bằng giao diện thật —
// Cài đặt › Công ty (logo, MST, ngân hàng → mã VietQR thử) → yêu cầu báo giá → xác nhận đơn mua → nhận 6/10 (phiếu chờ 4) → hoá đơn NCC → trả một phần
// → báo cáo mua hàng, công nợ phải trả → hoá đơn khách 8% + 10% có VietQR → PDF (hoá đơn, đơn mua, phiếu nhập). Chụp từng màn hình;
// AIVN_QA_BIZ_LANG=en|zh thì liệt kê chữ tiếng Việt còn sót trên màn hình.
'use strict';
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function qaPurchase({ win, app, VI }) {
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
    out.pdfs = fs.existsSync(process.env.AIVN_QA_PDF_DIR) ? fs.readdirSync(process.env.AIVN_QA_PDF_DIR) : [];
    out.toasts = await js(`[...document.querySelectorAll('.toast-stack .toast-item')].map(t => t.innerText.trim())`);
  } catch (e) { out.error = e.message; }
  fs.writeFileSync(path.join(dir, `qapurchase-${lang}.json`), JSON.stringify(out, null, 2)); app.exit(0);
}
module.exports = { qaPurchase };
