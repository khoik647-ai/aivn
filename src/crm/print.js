// 0.16 Kinh doanh — mẫu in A4 (báo giá / đơn bán, hoá đơn / giấy báo có / hoá đơn NCC, phiếu giao / phiếu nhập, yêu cầu báo giá / đơn mua):
// thông tin công ty + logo, bảng hàng có thuế suất từng dòng, thuế theo từng mức, số tiền bằng chữ, VietQR (hoá đơn còn phải thu), chỗ ký.
// Trả về HTML đầy đủ để tiến trình chính in ra PDF bằng webContents.printToPDF (src/biz-pdf.js). Chữ được dịch theo ngôn ngữ giao diện (vi/en/zh).
'use strict';
const T = require('./text');
const TAX = require('./tax');
const V = require('./vietqr');
const QR = require('./qr');
const CORE = require('../i18n/core');
let I18N = null; const i18n = () => I18N || (I18N = CORE.create({ en: require('../i18n/en'), zh: require('../i18n/zh') }));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LOCALE = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN' };

// số tiền bằng chữ: tiếng Việt (chuẩn chứng từ), tiếng Anh, chữ số viết hoa tiếng Trung (大写)
const EN1 = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN10 = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function en3(n) { const h = Math.floor(n / 100), r = n % 100; const p = []; if (h) p.push(EN1[h] + ' hundred'); if (r) p.push(r < 20 ? EN1[r] : EN10[Math.floor(r / 10)] + (r % 10 ? '-' + EN1[r % 10] : '')); return p.join(' and '); }
function enWords(n) {
  n = Math.round(Math.abs(Number(n) || 0)); if (!n) return 'Zero Vietnamese dong';
  const U = ['', ' thousand', ' million', ' billion', ' trillion', ' quadrillion']; const parts = []; let i = 0;
  while (n > 0) { const g = n % 1000; if (g) parts.unshift(en3(g) + U[i]); n = Math.floor(n / 1000); i++; }
  const s = parts.join(' '); return s.charAt(0).toUpperCase() + s.slice(1) + ' Vietnamese dong';
}
const ZH_D = '零壹贰叁肆伍陆柒捌玖'; const ZH_U = ['', '拾', '佰', '仟'];
function zh4(n) { let s = '', zero = false; for (let i = 3; i >= 0; i--) { const d = Math.floor(n / 10 ** i) % 10; if (!d) { zero = s !== ''; continue; } if (zero) { s += '零'; zero = false; } s += ZH_D[d] + ZH_U[i]; } return s; }
function zhWords(n) {
  n = Math.round(Math.abs(Number(n) || 0)); if (!n) return '零越南盾整';
  const G = ['', '万', '亿', '万亿']; const groups = []; while (n > 0) { groups.push(n % 10000); n = Math.floor(n / 10000); }
  let s = ''; let gap = false;
  for (let i = groups.length - 1; i >= 0; i--) { const g = groups[i]; if (!g) { gap = s !== ''; continue; } if (s && (gap || g < 1000)) s += '零'; s += zh4(g) + G[i]; gap = false; }
  return s + '越南盾整';
}
const amountWords = (n, lang) => lang === 'en' ? enWords(n) : lang === 'zh' ? zhWords(n) : T.vndWords(n);

function render(doc, { company: c, lang = 'vi', qr = null, generatedAt = new Date() } = {}) {
  lang = ['vi', 'en', 'zh'].includes(lang) ? lang : 'vi';
  // từ viết tắt không dấu (bộ trích khoá chỉ lấy chữ có dấu) + tên chứng từ in khác tên thẻ giao diện (“Receipts” → “Goods receipt”)
  const ASCII = { en: { MST: 'Tax ID', STT: 'No.', 'Phiếu nhập kho': 'Goods receipt', 'Phiếu giao hàng': 'Delivery slip' }, zh: { MST: '税号', STT: '序号' } };
  const t = (s) => lang === 'vi' ? s : (ASCII[lang][s] || i18n().tr(s, lang));
  const loc = LOCALE[lang];
  const money = (n) => (Math.round(Number(n) || 0)).toLocaleString(loc) + ' ₫';
  const qty = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString(loc);
  const date = (s) => { if (!/^\d{4}-\d{2}-\d{2}/.test(String(s || ''))) return ''; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return lang === 'vi' ? `Ngày ${String(d).padStart(2, '0')} tháng ${String(m).padStart(2, '0')} năm ${y}` : lang === 'zh' ? `${y}年${m}月${d}日` : new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const short = (s) => { if (!/^\d{4}-\d{2}-\d{2}/.test(String(s || ''))) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return lang === 'en' ? `${d}/${m}/${y}` : lang === 'zh' ? `${y}-${m}-${d}` : `${d}/${m}/${y}`; };
  const row = (label, val) => val ? `<div class="kv"><span>${esc(t(label))}:</span> <b>${esc(val)}</b></div>` : '';

  // ---- đầu trang: công ty
  const coLines = [c.address, [c.tax_id ? `${t('MST')}: ${c.tax_id}` : '', c.phone ? `${t('Điện thoại')}: ${c.phone}` : ''].filter(Boolean).join(' · '), [c.email, c.website].filter(Boolean).join(' · '),
    c.bank_account ? `${t('Tài khoản')}: ${c.bank_account}${c.bank_name ? ' — ' + c.bank_name : ''}${c.bank_branch ? ', ' + c.bank_branch : ''}` : ''].filter(Boolean);
  const head = `<header class="co">${c.logo ? `<img class="logo" src="${esc(c.logo)}" alt="">` : ''}<div class="co-info"><div class="co-name">${esc(c.name || t('(Chưa nhập tên công ty — Cài đặt › Công ty)'))}</div>${coLines.map(l => `<div>${esc(l)}</div>`).join('')}</div></header>`;

  const K = doc.type; // quote | invoice | picking | purchase
  const title = t(doc.title); const number = doc.number || t('Nháp');
  const partyLabel = doc.side === 'in' ? 'Nhà cung cấp' : K === 'quote' ? 'Kính gửi' : K === 'picking' ? 'Đơn vị nhận hàng' : 'Đơn vị mua hàng';
  const p = doc.partner || {};
  const party = `<section class="party"><div class="party-l">${row(partyLabel, p.name || '—')}${row('Địa chỉ', p.address)}${row('MST', p.tax_id)}${row('Điện thoại', p.phone)}${row('Email', p.email)}</div>
    <div class="party-r">${doc.meta.map(([k, v, tr]) => row(k, tr ? t(v) : v)).join('')}</div></section>`;

  // ---- bảng hàng
  let table, totals = '', words = '';
  if (K === 'picking') {
    table = `<table class="lines"><thead><tr><th class="c">${esc(t('STT'))}</th><th>${esc(t('Tên hàng hoá'))}</th><th>${esc(t('Mã'))}</th><th>${esc(t('ĐVT'))}</th><th class="n">${esc(t('Yêu cầu'))}</th><th class="n">${esc(t('Thực tế'))}</th>${doc.kind === 'in' ? `<th class="n">${esc(t('Đơn giá'))}</th><th class="n">${esc(t('Thành tiền'))}</th>` : ''}</tr></thead><tbody>
      ${doc.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td>${esc(l.sku || '')}</td><td>${esc(l.unit || '')}</td><td class="n">${qty(l.qty)}</td><td class="n">${doc.state === 'done' ? qty(l.qty_done) : ''}</td>${doc.kind === 'in' ? `<td class="n">${money(l.unit_cost)}</td><td class="n">${money(Math.round((doc.state === 'done' ? l.qty_done : l.qty) * (l.unit_cost || 0)))}</td>` : ''}</tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td colspan="3"><b>${esc(t('Cộng'))}</b></td><td class="n"><b>${qty(doc.lines.reduce((a, l) => a + (l.qty || 0), 0))}</b></td><td class="n"><b>${doc.state === 'done' ? qty(doc.lines.reduce((a, l) => a + (l.qty_done || 0), 0)) : ''}</b></td>${doc.kind === 'in' ? `<td></td><td class="n"><b>${money(doc.lines.reduce((a, l) => a + Math.round((doc.state === 'done' ? l.qty_done : l.qty) * (l.unit_cost || 0)), 0))}</b></td>` : ''}</tr></tfoot></table>`;
  } else {
    const disc = doc.lines.some(l => l.discount_pct);
    table = `<table class="lines"><thead><tr><th class="c">${esc(t('STT'))}</th><th>${esc(t('Tên hàng hoá, dịch vụ'))}</th><th>${esc(t('ĐVT'))}</th><th class="n">${esc(t('Số lượng'))}</th><th class="n">${esc(t('Đơn giá'))}</th>${disc ? `<th class="n">${esc(t('CK %'))}</th>` : ''}<th class="n">${esc(t('Thuế suất'))}</th><th class="n">${esc(t('Thành tiền'))}</th></tr></thead><tbody>
      ${doc.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td>${esc(l.unit || '')}</td><td class="n">${qty(l.qty)}</td><td class="n">${money(l.price)}</td>${disc ? `<td class="n">${l.discount_pct ? qty(l.discount_pct) + '%' : ''}</td>` : ''}<td class="n">${TAX.fmtRate(l.vat_pct)}</td><td class="n">${money(TAX.lineSubtotal(l))}</td></tr>`).join('')}</tbody></table>`;
    const tt = TAX.totals(doc.lines, TAX.roundingOf(doc.tax_rounding));
    const total = doc.amount_total ?? tt.amount_total;
    const taxRows = tt.tax_groups.map(g => `<tr><td>${esc(t(`Thuế GTGT ${TAX.fmtRate(g.rate)}`))} <span class="muted">(${esc(t('trên'))} ${money(g.base)})</span></td><td class="n">${money(g.tax)}</td></tr>`).join('');
    totals = `<table class="tot"><tr><td>${esc(t('Cộng tiền hàng'))}</td><td class="n">${money(doc.amount_untaxed ?? tt.amount_untaxed)}</td></tr>${taxRows}
      <tr class="grand"><td>${esc(t('Tổng cộng thanh toán'))}</td><td class="n">${money(total)}</td></tr>
      ${(doc.payments || []).map(pm => `<tr class="small"><td>${esc(t(pm.label))} ${esc(short(pm.date))}</td><td class="n">− ${money(pm.amount)}</td></tr>`).join('')}
      ${doc.residual != null && doc.state === 'posted' ? `<tr class="grand"><td>${esc(t(doc.residualLabel))}</td><td class="n">${money(doc.residual)}</td></tr>` : ''}</table>`;
    words = `<p class="words"><b>${esc(t('Số tiền viết bằng chữ'))}:</b> <i>${esc(amountWords(total, lang))}.</i></p>`;
  }
  const qrBox = qr && qr.ok ? `<section class="qr"><div class="qr-img">${qr.svg}</div><div><div class="qr-t">${esc(t('Quét mã VietQR để chuyển khoản'))}</div>${row('Ngân hàng', qr.bank)}${row('Số tài khoản', qr.account)}${row('Chủ tài khoản', qr.holder)}${row('Số tiền', money(qr.amount))}${row('Nội dung', qr.memo)}<div class="muted small">${esc(t('Dùng ứng dụng ngân hàng hoặc ví hỗ trợ VietQR (NAPAS 247).'))}</div></div></section>` : '';
  const notes = doc.notes ? `<p class="notes"><b>${esc(t(doc.notesLabel || 'Ghi chú'))}:</b> ${esc(doc.notes).replace(/\n/g, '<br>')}</p>` : '';
  const sig = `<section class="sign" style="grid-template-columns:repeat(${doc.signs.length},1fr)">${doc.signs.map(([role, name]) => `<div><div class="role">${esc(t(role))}</div><div class="hint">${esc(t('(Ký, ghi rõ họ tên)'))}</div><div class="name">${esc(name || '')}</div></div>`).join('')}</section>`;
  const legal = doc.legal ? `<p class="legal">${esc(t(doc.legal))}</p>` : '';
  const footer = c.doc_footer ? `<p class="foot">${esc(c.doc_footer)}</p>` : '';
  const font = lang === 'zh' ? '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Segoe UI", Arial, sans-serif' : '"Segoe UI", "Helvetica Neue", Arial, "Noto Sans", "DejaVu Sans", sans-serif';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)} ${esc(number)}</title><style>
@page { size: A4; margin: 14mm 14mm 18mm 14mm; }
* { box-sizing: border-box; } html, body { margin: 0; } body { font: 10.5pt/1.45 ${font}; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.co { display: flex; gap: 14px; align-items: center; border-bottom: 2px solid #1f3a5f; padding-bottom: 8px; }
.logo { max-height: 22mm; max-width: 45mm; object-fit: contain; } .co-name { font-weight: 700; font-size: 13pt; text-transform: uppercase; color: #1f3a5f; } .co-info { font-size: 9.5pt; }
h1 { text-align: center; font-size: 17pt; margin: 14px 0 2px; letter-spacing: .5px; text-transform: uppercase; } .sub { text-align: center; margin: 0 0 12px; } .sub b { font-size: 11pt; }
.party { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; margin: 6px 0 10px; } .kv { margin: 1px 0; } .kv span { color: #444; }
table { width: 100%; border-collapse: collapse; } .lines th, .lines td { border: 1px solid #9aa5b1; padding: 4px 6px; vertical-align: top; } .lines thead th { background: #eef2f6; font-weight: 600; text-align: left; } .lines tfoot td { background: #f7f9fb; }
.n { text-align: right !important; white-space: nowrap; } .c { text-align: center !important; width: 9mm; } tr { break-inside: avoid; } thead { display: table-header-group; }
.tot { width: 58%; margin: 8px 0 0 auto; } .tot td { padding: 3px 6px; } .tot .grand td { font-weight: 700; border-top: 1.5px solid #111; font-size: 11pt; } .small { font-size: 9pt; } .muted { color: #666; font-weight: normal; }
.words { margin: 8px 0; } .notes { margin: 8px 0; } .qr { display: flex; gap: 14px; align-items: center; border: 1px solid #9aa5b1; border-radius: 6px; padding: 8px; margin: 10px 0; break-inside: avoid; width: fit-content; }
.qr-img svg { width: 34mm; height: 34mm; display: block; } .qr-t { font-weight: 700; margin-bottom: 2px; }
.sign { display: grid; gap: 10px; text-align: center; margin-top: 18px; break-inside: avoid; } .role { font-weight: 700; } .hint { font-style: italic; font-size: 9pt; color: #444; } .name { margin-top: 24mm; font-weight: 600; }
.date-r { text-align: right; font-style: italic; margin-top: 12px; } .legal { font-size: 8.5pt; color: #555; margin-top: 14px; border-top: 1px dashed #bbb; padding-top: 4px; } .foot { font-size: 9pt; text-align: center; color: #333; margin-top: 8px; }
.stamp { position: fixed; top: 60mm; left: 0; right: 0; text-align: center; font-size: 60pt; color: rgba(200, 0, 0, .12); transform: rotate(-20deg); font-weight: 800; pointer-events: none; }
</style></head><body>
${doc.stamp ? `<div class="stamp">${esc(t(doc.stamp))}</div>` : ''}
${head}
<h1>${esc(title)}</h1><p class="sub">${esc(t('Số'))}: <b>${esc(number)}</b>${doc.date ? ` · ${esc(date(doc.date))}` : ''}</p>
${party}${table}${totals}${words}${qrBox}${notes}
${doc.date ? `<p class="date-r">${esc(date(doc.date))}</p>` : ''}${sig}${legal}${footer}
</body></html>`;
}

// chuyển dữ liệu chứng từ của biz/crm thành mô tả in chung
function describe(biz, crm, type, id) {
  const c = biz.getCompany();
  const signer = c.signer ? `${c.signer}` : '';
  if (type === 'quote') {
    const o = biz.getOrder(id); const sale = o.status === 'sale';
    return { type, title: sale ? 'Đơn bán hàng' : 'Báo giá', number: o.number, date: o.date, partner: o.contact, side: 'out', lines: o.lines, tax_rounding: o.tax_rounding,
      amount_untaxed: o.subtotal, amount_total: o.total, notes: o.notes, notesLabel: 'Điều khoản và ghi chú', stamp: o.status === 'cancel' ? 'Đã huỷ' : '',
      meta: [['Ngày báo giá', o.date], ['Hiệu lực đến', o.valid_until], ['Điều khoản thanh toán', o.payment_days ? `${o.payment_days} ngày` : 'Thanh toán ngay', true], ['Ngày giao cam kết', o.commitment_date], ['Người phụ trách', o.owner]].filter(x => x[1]).map(([k, v, tr]) => [k, /^\d{4}-\d{2}-\d{2}$/.test(v) ? dmy(v) : v, tr]),
      signs: [[sale ? 'Khách hàng' : 'Khách hàng xác nhận', ''], [c.signer_title || 'Đại diện công ty', signer]], company: c };
  }
  if (type === 'invoice') {
    const inv = biz.getInvoice(id); const vendor = inv.side === 'in';
    const label = { out_invoice: 'Hoá đơn bán hàng', out_refund: 'Giấy báo có', in_invoice: 'Hoá đơn nhà cung cấp', in_refund: 'Giấy báo có nhà cung cấp' }[inv.kind];
    const pay = { out_invoice: 'Đã thu', out_refund: 'Đã hoàn', in_invoice: 'Đã trả', in_refund: 'Đã nhận hoàn' }[inv.kind];
    return { type, title: label, number: inv.number, date: inv.invoice_date, partner: inv.partner, side: inv.side, lines: inv.lines, tax_rounding: inv.tax_rounding, state: inv.state,
      amount_untaxed: inv.amount_untaxed, amount_total: inv.amount_total, residual: inv.residual, residualLabel: (inv.kind === 'out_invoice' || inv.kind === 'in_refund') ? 'Còn phải thu' : 'Còn phải trả',
      payments: (inv.payments || []).map(p => ({ label: pay, date: p.date, amount: p.amount })), notes: inv.notes,
      stamp: inv.state === 'cancel' ? 'Đã huỷ' : inv.state === 'draft' ? 'Nháp' : inv.payment_state === 'paid' ? 'Đã thanh toán' : '',
      meta: [['Ngày hoá đơn', dmy(inv.invoice_date)], ['Hạn thanh toán', dmy(inv.due_date)], ['Đơn bán hàng', inv.so_number], ['Đơn mua hàng', inv.po_number], ['Số tham chiếu', inv.ref], ['Đảo của', inv.reversed_number]].filter(x => x[1]),
      signs: vendor ? [['Người lập', c.accountant], ['Kế toán', ''], [c.signer_title || 'Giám đốc', signer]] : [['Người mua hàng', ''], ['Người bán hàng', signer]],
      legal: inv.side === 'out' ? 'Chứng từ nội bộ — không thay thế hoá đơn điện tử theo Nghị định 123/2020/NĐ-CP.' : '', company: c,
      qr: inv.kind === 'out_invoice' && inv.state === 'posted' && inv.residual > 0 ? biz.invoiceQr(id) : null };
  }
  if (type === 'picking') {
    const p = biz.getPicking(id); const products = Object.fromEntries((crm.listProducts({ all: true }) || []).map(x => [x.id, x]));
    return { type, kind: p.kind, title: p.kind === 'in' ? 'Phiếu nhập kho' : p.kind === 'out' ? 'Phiếu giao hàng' : 'Phiếu điều chỉnh tồn kho', number: p.number, date: p.done_at ? localYmd(p.done_at) : p.scheduled,
      partner: p.partner_id ? (crm.getContact ? (crm.getContact(p.partner_id) || {}) : {}) : {}, side: p.kind === 'in' ? 'in' : 'out', state: p.state, stamp: p.state === 'cancel' ? 'Đã huỷ' : '',
      lines: p.moves.map(m => ({ name: m.product_name, sku: (products[m.product_id] || {}).sku, unit: m.unit, qty: m.qty, qty_done: m.qty_done, unit_cost: m.unit_cost })), notes: p.notes,
      meta: [['Ngày dự kiến', dmy(p.scheduled)], ['Chứng từ gốc', p.origin], ['Trạng thái', p.state_vi, true]].filter(x => x[1]),
      signs: p.kind === 'in' ? [['Người lập phiếu', ''], ['Người giao hàng', ''], ['Thủ kho', ''], ['Kế toán trưởng', c.accountant]] : [['Người lập phiếu', ''], ['Thủ kho', ''], ['Người giao hàng', ''], ['Người nhận hàng', '']], company: c };
  }
  if (type === 'purchase') {
    const o = biz.getPurchase(id); const po = ['purchase', 'done'].includes(o.state);
    return { type, title: po ? 'Đơn mua hàng' : 'Yêu cầu báo giá', number: o.number, date: o.date_order, partner: o.partner, side: 'in', lines: o.lines, tax_rounding: o.tax_rounding,
      amount_untaxed: o.subtotal, amount_total: o.total, notes: o.notes, stamp: o.state === 'cancel' ? 'Đã huỷ' : '',
      meta: [['Ngày đặt hàng', dmy(o.date_order)], ['Ngày nhận dự kiến', dmy(o.date_planned)], ['Điều khoản thanh toán', o.payment_days ? `${o.payment_days} ngày` : 'Thanh toán ngay', true], ['Mã tham chiếu NCC', o.partner_ref], ['Người mua', o.owner]].filter(x => x[1]),
      signs: [['Nhà cung cấp xác nhận', ''], [c.signer_title || 'Đại diện bên mua', signer]], company: c };
  }
  throw new Error('Loại chứng từ không hỗ trợ: ' + type);
}
const localYmd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dmy = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10).split('-').reverse().join('/') : '';
// tên tệp gợi ý: INV/2026/00001 → INV-2026-00001.pdf
const fileName = (d) => `${String(d.number || d.title).replace(/[\\/:*?"<>|\s]+/g, '-')}.pdf`;
function renderDoc(biz, crm, type, id, lang = 'vi') { const d = describe(biz, crm, type, id); return { html: render(d, { company: d.company, lang, qr: d.qr }), name: fileName(d), title: d.title, number: d.number }; }
module.exports = { render, describe, renderDoc, amountWords, enWords, zhWords, fileName };
