#!/usr/bin/env python3
# AIVN 0.16 — #41 (C4): bộ số mẫu “đúng như Odoo” cho thuế GTGT làm tròn từng dòng (round_per_line).
#
# Odoo không cài trên máy kiểm thử, nên số kỳ vọng được TÍNH LẠI từ mã nguồn Odoo 17.0
# (commit 657d92130e501843316542524f074a2f094c27e2, github.com/odoo/odoo):
#   • odoo/tools/float_utils.py — nạp NGUYÊN VĂN tệp gốc và gọi chính hàm float_round() của Odoo
#     (sha256 a0e6c3f4de20b1d26eb4bd3d8ce91d2617dc7c6dfe933bf3c44c8f9bae23c647);
#   • addons/account/models/account_tax.py (sha256 038835eeb58206634fe2d2699b8a6cad7c79f2c5f3f84f8b49933f67243dadbf):
#       _compute_taxes_for_single_line (dòng 1116): price_unit_after_discount = price_unit * (1 - (discount / 100.0))
#       compute_all (dòng 669…): prec = currency.rounding (dòng 732); round_per_line → không nhân 1e-5 (dòng 738–743);
#         base = price_unit * quantity; base = currency.round(base) (dòng 808–810);
#         thuế phần trăm: _compute_amount → base_amount * self.amount / 100 (dòng 608);
#         tax_amount = float_round(tax_amount, precision_rounding=prec) (dòng 922);
#         total_excluded = currency.round(...) → price_subtotal (dòng 877–879, 1139);
#       _compute_taxes (dòng 1328…): amount_untaxed = Σ price_subtotal; thuế mỗi nhóm = currency.round(Σ tax_amount của nhóm).
#   • odoo/addons/base/data/res_currency_data.xml: VND rounding = 1.00 → precision_rounding = 1.0.
#   • l10n_vn (Odoo 18.0 có thêm nhóm VAT 8%): mỗi mức 0/5/8/10% là một thuế “percent”, không gồm trong giá, một nhóm thuế riêng.
#   Đối chiếu thêm Odoo 18.0 (_get_tax_details / _add_tax_details_in_base_line): raw_base = quantity * price_unit làm tròn
#   bằng float_round, thuế = raw_base * amount / 100.0 rồi float_round — cùng kết quả với 17.0 cho thuế phần trăm không gồm trong giá.
# Báo giá/đơn bán (sale.order.line) và đơn mua (purchase.order.line) dùng cùng account.tax (_compute_taxes) nên cùng quy tắc.
#
# Chạy:  python3 test/fixtures/odoo-round-per-line.py <đường dẫn float_utils.py của Odoo 17.0> > test/fixtures/odoo-round-per-line.json
import importlib.util, json, sys

spec = importlib.util.spec_from_file_location('odoo_float_utils', sys.argv[1])
fu = importlib.util.module_from_spec(spec); spec.loader.exec_module(fu)
VND_ROUNDING = 1.0
cur_round = lambda v: fu.float_round(v, precision_rounding=VND_ROUNDING)  # res.currency.round()

def compute_line(price_unit, quantity, discount, rate):
    price_unit_after_discount = price_unit * (1 - (discount / 100.0))
    base = cur_round(price_unit_after_discount * quantity)          # compute_all: base = currency.round(price_unit * quantity)
    tax_amount = fu.float_round(base * rate / 100, precision_rounding=VND_ROUNDING)  # round_per_line: prec = 1.0
    return {'price_subtotal': int(base), 'tax': int(tax_amount)}

def compute_doc(lines):
    out, groups, untaxed = [], {}, 0.0
    for l in lines:
        r = compute_line(l['price'], l['qty'], l.get('discount_pct', 0), l['vat_pct'])
        out.append(r); untaxed += r['price_subtotal']
        g = groups.setdefault(l['vat_pct'], {'rate': l['vat_pct'], 'base': 0.0, 'tax': 0.0})
        g['base'] += r['price_subtotal']; g['tax'] += r['tax']
    tg = [{'rate': g['rate'], 'base': int(g['base']), 'tax': int(cur_round(g['tax']))} for g in sorted(groups.values(), key=lambda g: g['rate'])]
    tax = sum(g['tax'] for g in tg)
    return {'lines': out, 'tax_groups': tg, 'amount_untaxed': int(untaxed), 'amount_tax': tax, 'amount_total': int(untaxed) + tax}

L = lambda name, qty, price, vat, disc=0: {'name': name, 'qty': qty, 'price': price, 'vat_pct': vat, 'discount_pct': disc}
SAMPLES = [
    ('S1', 'quote', 'Báo giá đủ bốn mức 0/5/8/10%', [L('Sách giáo khoa', 10, 45000, 0), L('Gạo ST25', 25, 32500, 5), L('Phần mềm', 3, 333333, 8), L('Bàn làm việc', 2, 2150000, 10)]),
    ('S2', 'sale_order', 'Đơn bán: thuế 5% có phần lẻ 0,25 / 0,5 trên từng dòng', [L('Phụ kiện A', 1, 105, 5), L('Phụ kiện B', 1, 105, 5), L('Phụ kiện C', 1, 10, 5), L('Dịch vụ', 1, 1005, 10), L('Hàng 8%', 7, 1563, 8)]),
    ('S3', 'invoice', 'Hoá đơn: chiết khấu làm thành tiền rơi đúng ,5 mà số thực máy tính ra ,4999…', [L('Khuyến mãi 67%', 1, 50, 10, 67), L('Hàng sale 90%', 799, 175, 8, 90), L('CK 61,26%', 1, 982500, 5, 61.26), L('Không thuế', 3, 411000, 0, 60.45)]),
    ('S4', 'invoice', 'Hoá đơn: số lượng lẻ (kg, mét) và chiết khấu', [L('Thép (kg)', 86.1, 165, 10), L('Cáp (m)', 42.861, 773500, 8), L('Hạt điều (kg)', 0.125, 389000, 5), L('Gói', 2.375, 1999, 0, 12.5)]),
    ('S5', 'credit_note', 'Giấy báo có: trả lại một phần hàng nhiều mức thuế', [L('Trả hàng 10%', 2, 267500, 10, 31.19), L('Trả hàng 8%', 2, 230 * 1000 + 500, 8, 12.85), L('Trả hàng 5%', 1, 195000, 5, 48.35), L('Trả hàng 0%', 1, 15000, 0)]),
    ('S6', 'purchase_order', 'Đơn mua: thứ tự nhân của Odoo (giá × (1 − CK) × SL) khác SL × giá × (1 − CK)', [L('Linh kiện', 100, 83861, 10, 66.5), L('Vỏ hộp', 485, 230, 8, 77), L('Ốc vít', 29, 175, 5, 90), L('Mẫu thử', 1, 0, 0)]),
    ('S7', 'vendor_bill', 'Hoá đơn NCC: số tiền lớn (hàng trăm triệu)', [L('Máy CNC', 647, 287500, 10, 51.46), L('Vật tư', 600, 57125, 8, 35.83), L('Vận chuyển', 1, 12345678, 10), L('Thuế 0%', 3, 99999999, 0)]),
    ('S8', 'invoice', 'Hoá đơn: nhiều dòng nhỏ — tổng thuế từng dòng khác làm tròn gộp', [L('Kẹo', 1, 15, 10), L('Kẹo', 1, 15, 10), L('Kẹo', 1, 15, 10), L('Bánh', 1, 25, 8), L('Bánh', 1, 25, 8), L('Nước', 1, 30, 5), L('Nước', 1, 30, 5), L('Báo', 1, 9, 0)]),
    ('S9', 'invoice', 'Hoá đơn: dòng chiết khấu 100% và dòng giá 0', [L('Quà tặng', 5, 120000, 10, 100), L('Hàng chính', 4, 1234567, 10, 5), L('Hàng 8%', 13, 77777, 8, 33.33), L('Miễn phí', 2, 0, 5)]),
    ('S10', 'invoice', 'Hoá đơn: giá ,500 đ và chiết khấu 2 chữ số thập phân', [L('Dòng 1', 2, 835500, 10, 62.95), L('Dòng 2', 2, 49075, 8, 55), L('Dòng 3', 3, 487500, 5, 74.98), L('Dòng 4', 2, 352500, 0, 60.95), L('Dòng 5', 1, 627500, 10, 81.94), L('Dòng 6', 1, 505000, 8, 65.15)]),
]
print(json.dumps({'source': 'Odoo 17.0 @657d92130e501843316542524f074a2f094c27e2 float_round + account.tax compute_all (round_per_line, VND rounding 1.0)',
                  'samples': [{'id': i, 'doc': d, 'title': t, 'lines': ls, 'odoo': compute_doc(ls)} for i, d, t, ls in SAMPLES]}, ensure_ascii=False, indent=1))
