// Thông tin công ty (Odoo: Cài đặt › Công ty) — tên, MST, địa chỉ, logo, tài khoản ngân hàng nhận tiền (cho VietQR), người ký chứng từ,
// cách làm tròn thuế. Lưu trong bảng meta của CSDL Kinh doanh (đi cùng sao lưu/khôi phục), không gửi đi đâu.
'use strict';
const T = require('./text');
const V = require('./vietqr');
const fail = (m) => { const { CrmError } = require('./crm'); return new CrmError(m); };
const str = (v, max = 300) => (v == null ? '' : String(v)).trim().slice(0, max);
const DEFAULTS = { name: '', tax_id: '', address: '', phone: '', email: '', website: '', logo: null, bank_bin: '', bank_account: '', bank_holder: '', bank_branch: '',
  signer: '', signer_title: 'Giám đốc', accountant: '', doc_footer: '', tax_rounding: 'line', default_vat: 10 };
const LOGO_MAX = 400 * 1024; // ảnh logo dạng data URL (PNG/JPEG/WebP), giao diện đã thu nhỏ trước khi lưu
function companyOf(db) {
  let c = {}; try { const r = db.get("SELECT value FROM meta WHERE key = 'company'"); c = r ? JSON.parse(r.value) || {} : {}; } catch { c = {}; }
  const out = { ...DEFAULTS, ...c };
  out.tax_rounding = out.tax_rounding === 'global' ? 'global' : 'line';
  const b = V.bankOf(out.bank_bin); out.bank_name = b ? b.name : ''; out.bank_code = b ? b.code : '';
  out.qr_ready = !!(b && V.accountOk(out.bank_account));
  return out;
}
function saveCompany(db, input = {}) {
  const old = companyOf(db); const c = { ...old, ...Object.fromEntries(Object.entries(input || {}).filter(([k, v]) => v !== undefined && k in DEFAULTS)) };
  c.name = str(c.name, 200); if (!c.name) throw fail('Hãy nhập tên công ty.'); c.address = str(c.address, 400); c.phone = str(c.phone, 40); c.email = str(c.email, 200).toLowerCase(); c.website = str(c.website, 200);
  c.tax_id = T.normTax(c.tax_id); if (!T.validTax(c.tax_id)) throw fail(`Mã số thuế "${input.tax_id}" phải có 10 số (hoặc 10 số-3 số cho chi nhánh, 12 số với cá nhân).`);
  if (!T.validEmail(c.email)) throw fail(`Email "${c.email}" chưa đúng.`);
  if (c.phone && !T.validPhone(T.normPhone(c.phone))) throw fail(`Số điện thoại "${c.phone}" chưa đúng định dạng Việt Nam (vd. 0912 345 678 hoặc +84 912 345 678).`);
  if (c.phone) c.phone = T.fmtPhone(c.phone);
  c.bank_bin = str(c.bank_bin, 6); c.bank_account = str(c.bank_account, 40).replace(/[\s.-]/g, ''); c.bank_holder = str(c.bank_holder, 120); c.bank_branch = str(c.bank_branch, 120);
  if (c.bank_bin && !V.bankOf(c.bank_bin)) throw fail('Ngân hàng không có trong danh sách VietQR.');
  if (c.bank_account && !V.accountOk(c.bank_account)) throw fail(`Số tài khoản "${input.bank_account}" chỉ gồm 6–19 chữ số hoặc chữ cái.`);
  if (c.bank_account && !c.bank_bin) throw fail('Hãy chọn ngân hàng cho số tài khoản.');
  c.signer = str(c.signer, 120); c.signer_title = str(c.signer_title, 80); c.accountant = str(c.accountant, 120); c.doc_footer = str(c.doc_footer, 600);
  c.tax_rounding = c.tax_rounding === 'global' ? 'global' : 'line';
  const dv = Number(String(c.default_vat ?? 10).replace('%', '')); if (![0, 5, 8, 10].includes(dv)) throw fail(`Thuế suất GTGT “${c.default_vat}” không hợp lệ — chỉ nhận 0%, 5%, 8% hoặc 10%.`); c.default_vat = dv;
  if (c.logo === '' || c.logo === false) c.logo = null;
  if (c.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.logo)) throw fail('Logo phải là ảnh PNG, JPEG hoặc WebP.');
  if (c.logo && c.logo.length > LOGO_MAX) throw fail('Ảnh logo quá lớn (tối đa khoảng 300 KB). Hãy chọn ảnh nhỏ hơn.');
  const keep = Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, c[k]]));
  db.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', ['company', JSON.stringify(keep)]);
  return companyOf(db);
}
module.exports = { companyOf, saveCompany, DEFAULTS };
