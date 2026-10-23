'use strict';
// #39: bộ chứng từ mẫu dùng chung cho test/v016-pdf.test.js (Node) và tiến trình Electron in PDF thật
const fs = require('fs'); const os = require('os'); const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
// Dữ liệu người dùng (tên, địa chỉ, sản phẩm, ghi chú) được phép giữ tiếng Việt trong bản en/zh
const COMPANY = { name: 'Công ty TNHH Giải pháp AIVN', tax_id: '0312345678', address: '12 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh', phone: '028 3822 1234', email: 'ketoan@aivn.vn', website: 'aivn.vn',
  bank_bin: '970436', bank_account: '0011001234567', bank_holder: 'CONG TY TNHH GIAI PHAP AIVN', bank_branch: 'CN Sài Gòn', signer: 'Đặng Văn Khôi', accountant: 'Lê Thị Mỹ Duyên', doc_footer: 'Cảm ơn quý khách đã dùng sản phẩm của AIVN.' };
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'build/icons/128x128.png')).toString('base64');

function seed(crm, biz) {
  biz.saveCompany({ ...COMPANY, logo: LOGO });
  const cus = crm.saveContact({ name: 'Công ty Cổ phần Thương mại Sen Vàng', kind: 'company', tax_id: '0109876543', address: '45 Trần Hưng Đạo, Hoàn Kiếm, Hà Nội', phone: '024 3936 5678', email: 'muahang@senvang.vn' });
  const ven = crm.saveContact({ name: 'Công ty Gỗ Bình Dương', kind: 'company', tax_id: '3701234567', address: 'KCN Sóng Thần, Dĩ An, Bình Dương' });
  const ban = crm.saveProduct({ name: 'Bàn làm việc gỗ sồi', sku: 'BAN-01', price: 2500000, type: 'product', unit: 'cái' });
  const ghe = crm.saveProduct({ name: 'Ghế xoay lưới', sku: 'GHE-02', price: 1200000, type: 'product', unit: 'chiếc' });
  const sw = crm.saveProduct({ name: 'Phần mềm kế toán', price: 12000000, type: 'service', vat_pct: 8 });
  biz.validatePicking(biz.createReceipt({ lines: [{ product_id: ban.id, qty: 20, unit_cost: 1000000 }, { product_id: ghe.id, qty: 20, unit_cost: 600000 }] }).id);
  const lines = [{ product_id: ban.id, name: 'Bàn làm việc gỗ sồi', qty: 3, price: 2500000, discount_pct: 5 }, { product_id: ghe.id, name: 'Ghế xoay lưới', qty: 6, price: 1200000 }, { product_id: sw.id, name: 'Phần mềm kế toán', qty: 1, price: 12000000, vat_pct: 8 }];
  const q = crm.saveQuote({ contact_id: cus.id, valid_until: '2026-11-20', payment_days: 30, notes: 'Giá đã gồm vận chuyển.', lines });
  const so = crm.saveQuote({ contact_id: cus.id, valid_until: '2026-11-20', payment_days: 15, commitment_date: '2026-10-28', lines }); biz.confirmOrder(so.id);
  const out = biz.getOrder(so.id).pickings[0];
  const inv = biz.postInvoice(biz.invoiceOrder(so.id).id); biz.registerPayment(inv.id, { amount: 10000000 });
  const rfq = biz.savePurchase({ partner_id: ven.id, partner_ref: 'BG-778', date_planned: '2026-10-30', lines: [{ product_id: ban.id, qty: 10, price: 1000000 }] });
  const po = biz.confirmPurchase(biz.savePurchase({ partner_id: ven.id, payment_days: 30, lines: [{ product_id: ban.id, qty: 10, price: 1000000 }, { product_id: ghe.id, qty: 5, price: 600000 }] }).id);
  const rc = biz.getPicking(po.pickings[0].id); biz.setDone(rc.id, Object.fromEntries(rc.moves.map(m => [m.id, m.product_id === ban.id ? 6 : m.qty]))); biz.validatePicking(rc.id, { backorder: true });
  const docs = [['quote', q.id, 'bao-gia'], ['quote', so.id, 'don-ban'], ['invoice', inv.id, 'hoa-don'], ['picking', out.id, 'phieu-giao'], ['picking', rc.id, 'phieu-nhap'], ['purchase', rfq.id, 'rfq'], ['purchase', po.id, 'don-mua']];
  return { cus, ven, ban, ghe, q, so, inv, rfq, po, rc, docs };
}
async function make(R = ROOT, { many = 60 } = {}) {
  const { openDb } = require(R + '/src/crm/db'); const { createCrm } = require(R + '/src/crm/crm'); const { createBiz } = require(R + '/src/crm/biz');
  const db = await openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-pdf-')), 'crm.db'));
  const crm = createCrm({ db, defaultOwner: () => 'Nguyễn Thị Hương' }); const biz = createBiz({ db, crm, today: () => '2026-10-21' });
  const out = { db, crm, biz, ...seed(crm, biz) };
  if (many) out.many = crm.saveQuote({ contact_id: out.cus.id, lines: Array.from({ length: many }, (_, i) => ({ product_id: out.ghe.id, name: 'Ghế xoay lưới', qty: i + 1, price: 1200000 })) });
  return out;
}
module.exports = { make, seed, COMPANY, LOGO };
