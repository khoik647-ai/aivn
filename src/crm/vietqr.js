// VietQR (NAPAS 247) — chuỗi mã QR chuyển khoản theo chuẩn EMVCo Merchant-Presented Mode, tự viết theo đặc tả NAPAS:
//   00 “01” · 01 “11” (mã tĩnh) / “12” (mã động, có số tiền) · 38 thông tin người nhận { 00 GUID A000000727 · 01 { 00 BIN ngân hàng · 01 số tài khoản } · 02 QRIBFTTA }
//   · 53 “704” (VND) · 54 số tiền · 58 “VN” · 62 { 08 nội dung chuyển khoản } · 63 CRC-16/CCITT-FALSE (đa thức 0x1021, khởi tạo 0xFFFF) tính trên cả “6304”.
// Không cần mạng: chỉ ghép chuỗi; app ngân hàng tra tên chủ tài khoản từ BIN + số tài khoản.
'use strict';
// Danh sách ngân hàng nhận chuyển khoản VietQR (BIN do NAPAS cấp) — theo danh sách công khai của VietQR (api.vietqr.io/v2/banks, 22/10/2026), chỉ giữ ngân hàng nhận chuyển khoản
const BANKS = [
  ['970436', 'VCB', 'Vietcombank'], ['970415', 'ICB', 'VietinBank'], ['970418', 'BIDV', 'BIDV'], ['970405', 'VBA', 'Agribank'], ['970407', 'TCB', 'Techcombank'],
  ['970422', 'MB', 'MBBank'], ['970416', 'ACB', 'ACB'], ['970432', 'VPB', 'VPBank'], ['970423', 'TPB', 'TPBank'], ['970403', 'STB', 'Sacombank'],
  ['970437', 'HDB', 'HDBank'], ['970441', 'VIB', 'VIB'], ['970443', 'SHB', 'SHB'], ['970431', 'EIB', 'Eximbank'], ['970426', 'MSB', 'MSB'],
  ['970448', 'OCB', 'OCB'], ['970440', 'SEAB', 'SeABank'], ['970449', 'LPB', 'LPBank'], ['970454', 'VCCB', 'BVBank (Bản Việt)'], ['970429', 'SCB', 'SCB'],
  ['970428', 'NAB', 'Nam A Bank'], ['970409', 'BAB', 'Bac A Bank'], ['970425', 'ABB', 'ABBANK'], ['970427', 'VAB', 'VietABank'], ['970433', 'VIETBANK', 'VietBank'],
  ['970438', 'BVB', 'BaoViet Bank'], ['970412', 'PVCB', 'PVcomBank'], ['970452', 'KLB', 'KienlongBank'], ['970419', 'NCB', 'NCB'], ['970430', 'PGB', 'PGBank'],
  ['970400', 'SGICB', 'Saigonbank'], ['970414', 'MBV', 'MBV'], ['970444', 'CBB', 'Vietcombank Neo (CBBank)'], ['970446', 'COOPBANK', 'Co-opBank'], ['970424', 'SHBVN', 'Shinhan Bank'],
  ['970457', 'WVN', 'Woori Bank'], ['970434', 'IVB', 'Indovina Bank'], ['422589', 'CIMB', 'CIMB'], ['668888', 'KBANK', 'KBank'], ['546034', 'CAKE', 'Cake by VPBank'],
  ['546035', 'UBANK', 'Ubank by VPBank'], ['963388', 'TIMO', 'Timo'], ['971133', 'PVDB', 'PVcomBank Pay'], ['970462', 'KBHN', 'Kookmin Bank Hà Nội'], ['970463', 'KBHCM', 'Kookmin Bank TP.HCM'],
].map(([bin, code, name]) => ({ bin, code, name }));
const bankOf = (bin) => BANKS.find(b => b.bin === String(bin || '').trim()) || null;

// CRC-16/CCITT-FALSE trên byte UTF-8 (chuỗi VietQR chỉ có ASCII)
function crc16(str) {
  let crc = 0xffff;
  for (const b of Buffer.from(String(str), 'utf8')) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
const tlv = (id, v) => { v = String(v); if (v.length > 99) throw new Error(`Trường ${id} dài quá 99 ký tự.`); return id + String(v.length).padStart(2, '0') + v; };
// nội dung chuyển khoản: bỏ dấu tiếng Việt; chỉ giữ chữ, số, dấu cách và “_ . -” như Odoo l10n_vn (nhiều app ngân hàng từ chối “/”, “#”, “&”…),
// “/” trong số hoá đơn đổi thành “-” (INV/2026/00001 → INV-2026-00001) cho dễ đối chiếu; NAPAS giới hạn 25 ký tự cho trường 62-08
const memoOf = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[\/\\]/g, '-').replace(/[^A-Za-z0-9 _.-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25).trim();
const accountOk = (a) => /^[0-9A-Za-z]{6,19}$/.test(String(a || ''));

// payload VietQR. amount (số nguyên VND) bỏ trống → mã tĩnh (người trả tự nhập số tiền)
function build({ bin, account, amount = null, memo = '', service = 'QRIBFTTA' } = {}) {
  bin = String(bin || '').trim(); account = String(account || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(bin)) throw new Error('Mã BIN ngân hàng phải có 6 chữ số.');
  if (!accountOk(account)) throw new Error('Số tài khoản phải có 6–19 chữ số hoặc chữ cái, không có dấu cách.');
  const amt = amount == null || amount === '' ? null : Math.round(Number(amount));
  if (amt != null && !(Number.isFinite(amt) && amt > 0 && String(amt).length <= 13)) throw new Error('Số tiền trên mã QR phải là số nguyên dương (tối đa 13 chữ số).');
  const m = memoOf(memo);
  let s = tlv('00', '01') + tlv('01', amt != null ? '12' : '11')
    + tlv('38', tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', account)) + tlv('02', service))
    + tlv('53', '704') + (amt != null ? tlv('54', String(amt)) : '') + tlv('58', 'VN') + (m ? tlv('62', tlv('08', m)) : '');
  s += '6304'; return s + crc16(s);
}
// đọc ngược (để tự kiểm tra và cho bài kiểm thử): trả các trường + kiểm CRC
function parse(payload) {
  const s = String(payload || ''); const read = (str) => { const o = {}; let i = 0; while (i + 4 <= str.length) { const id = str.slice(i, i + 2); const n = Number(str.slice(i + 2, i + 4)); if (!Number.isInteger(n)) break; o[id] = str.slice(i + 4, i + 4 + n); i += 4 + n; } return o; };
  const top = read(s); const crcOk = s.length > 8 && s.slice(-8, -4) === '6304' && crc16(s.slice(0, -4)) === s.slice(-4);
  const m38 = read(top['38'] || ''); const ben = read(m38['01'] || ''); const add = read(top['62'] || '');
  return { crcOk, dynamic: top['01'] === '12', guid: m38['00'] || '', bin: ben['00'] || '', account: ben['01'] || '', service: m38['02'] || '', currency: top['53'] || '', amount: top['54'] ? Number(top['54']) : null, country: top['58'] || '', memo: add['08'] || '' };
}
module.exports = { BANKS, bankOf, crc16, build, parse, memoOf, accountOk };
