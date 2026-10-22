'use strict';
// B105 (QA beta.2.4): “CUDA 12.4 CHO GPU NVIDIA” lọt qua en/zh — chữ Việt KHÔNG DẤU không bị regex dấu bắt.
// Từ điển từ tiếng Việt thông dụng viết không dấu, chọn từ KHÔNG trùng từ tiếng Anh (bỏ: gui/GUI, them, roi/ROI, may, ban, tin, an, the, do, to, la, de, mo, va, thu, nam, sau, tai…).
// Không phân biệt hoa thường (CSS text-transform: uppercase); chỉ bắt TỪ nguyên vẹn (ranh giới chữ ASCII).
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
// từ mạnh (không phải từ tiếng Anh, không hay là tên riêng) → 1 từ là đủ
const STRONG = new Set(['cho', 'cua', 'khong', 'duoc', 'nguoi', 'trong', 'voi', 'chua', 'nhung', 'nhan', 'xoa', 'luu', 'chon', 'kiem', 'nhieu', 'hoac', 'truoc', 'duoi',
  'tieng', 'nhap', 'thoat', 'soan', 'nhiem', 'chuyen', 'thoai', 'xong', 'phien', 'buoc', 'viec', 'nhanh', 'chay', 'giay', 'phut', 'thang', 'tuan', 'nhom', 'cuoi', 'tiep', 'thiet', 'chinh']);
// từ yếu (có thể là tên riêng / viết tắt: Hien, Ngay, Tinh…) → cần ≥ 2 từ khác nhau trong cùng câu
const WEAK = new Set(['hien', 'ngay', 'tinh', 'dien', 'cuoc', 'hinh', 'khoi', 'dong', 'canh', 'cham', 'thao', 'nhat', 'mot', 'hai', 'lai', 'bat', 'tat', 'huy', 'loi', 'dung', 'dang', 'cap', 'mau', 'tim', 'tai', 'bao']);
const WORDS = [...STRONG, ...WEAK];
const WSET = new Set(WORDS);
function unaccentedHits(text) {
  // tên tệp / đường dẫn / địa chỉ (bao-cao-tuan.md, C:\\Users\\…, https://…) là dữ liệu, không phải chữ giao diện
  const t = String(text || '').replace(/https?:\/\/\S+/gi, ' ').replace(/[\w.-]*[\\/][^\s]*/g, ' ').replace(/[\w-]+\.[a-z0-9]{2,5}\b/gi, ' ');
  const ws = t.toLowerCase().match(/[a-z]+/g) || [];
  return [...new Set(ws.filter(w => WSET.has(w)))];
}
function looksUnaccentedVi(text) {
  const h = unaccentedHits(text);
  return h.some(w => STRONG.has(w)) || h.length >= 2;
}
const looksVi = (text) => VI.test(String(text || '')) || looksUnaccentedVi(text);
module.exports = { VI, WORDS, STRONG, WEAK, unaccentedHits, looksUnaccentedVi, looksVi };
