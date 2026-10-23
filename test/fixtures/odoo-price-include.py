#!/usr/bin/env python3
# AIVN 0.16 — #42 K3: bộ số mẫu “đúng như Odoo” cho GIÁ ĐÃ GỒM THUẾ (account.tax price_include = True), làm tròn từng dòng
# (tax_calculation_rounding_method = 'round_per_line'), VND rounding 1.0. Nối tiếp bộ 10 mẫu của #41 (odoo-round-per-line.py).
#
# Odoo không cài trên máy kiểm thử: số kỳ vọng TÍNH LẠI từ mã nguồn Odoo, gọi CHÍNH float_round() của odoo/tools/float_utils.py
# (nạp nguyên văn tệp gốc 17.0, như #41), và tính MỖI dòng theo HAI phiên bản — kết quả phải trùng nhau, không thì dừng:
#   • Odoo 17.0 account.tax.compute_all (addons/account/models/account_tax.py):
#       base = currency.round(price_unit_after_discount * quantity)                         (dòng 808–810)
#       total_excluded = currency.round(recompute_base(base)) = round(base / (1 + amount/100)) (recompute_base dòng 753 + dòng 876–878)
#       tax_amount = total_included_checkpoint − base_excluded = base − total_excluded        (dòng 909–912, rồi float_round)
#   • Odoo 18.0 account.tax._get_tax_details / _add_tax_details_in_base_line:
#       raw_base = float_round(quantity * price_unit)                                        (round_per_line, dòng 1168–1170)
#       tax = float_round(raw_base * (1 / (1 + amount/100)) * amount / 100.0)                (_eval_tax_amount_price_included, dòng 1027–1042)
#       base (thành tiền trước thuế) = raw_base − tax                                       (dòng 1222–1223)
#   price_unit_after_discount = price_unit * (1 - (discount / 100.0)) (account.move.line._compute_totals), giống #41.
#   Tổng chứng từ: tiền trước thuế = Σ price_subtotal; thuế mỗi nhóm = currency.round(Σ thuế dòng cùng mức) — giống #41.
# Dòng có 'price_include': False tính như #41 (giá chưa gồm thuế) để kiểm tra chứng từ trộn hai loại dòng.
#
# Chạy: python3 test/fixtures/odoo-price-include.py <float_utils.py của Odoo 17.0> > test/fixtures/odoo-price-include.json
import importlib.util, json, sys

spec = importlib.util.spec_from_file_location('odoo_float_utils', sys.argv[1])
fu = importlib.util.module_from_spec(spec); spec.loader.exec_module(fu)
PREC = 1.0
rnd = lambda v: fu.float_round(v, precision_rounding=PREC)

def line17(price, qty, disc, rate, incl):
    pu = price * (1 - (disc / 100.0)); base = rnd(pu * qty)
    if not incl: return base, rnd(base * rate / 100)
    excl = rnd(base / (1.0 + rate / 100.0)); return excl, rnd(base - excl)

def line18(price, qty, disc, rate, incl):
    pu = price * (1 - (disc / 100.0)); raw = rnd(qty * pu)
    if not incl: return raw, rnd(raw * rate / 100.0)
    f = 1 / (1 + rate / 100.0); tax = rnd(raw * f * rate / 100.0); return raw - tax, tax

def compute_doc(lines):
    out, groups, untaxed = [], {}, 0.0
    for l in lines:
        a = line17(l['price'], l['qty'], l['discount_pct'], l['vat_pct'], l['price_include'])
        b = line18(l['price'], l['qty'], l['discount_pct'], l['vat_pct'], l['price_include'])
        assert a == b, (l, a, b)
        sub, tax = int(a[0]), int(a[1]); out.append({'price_subtotal': sub, 'tax': tax, 'price_total': sub + tax}); untaxed += sub
        g = groups.setdefault(l['vat_pct'], {'rate': l['vat_pct'], 'base': 0, 'tax': 0.0}); g['base'] += sub; g['tax'] += tax
    tg = [{'rate': g['rate'], 'base': g['base'], 'tax': int(rnd(g['tax']))} for g in sorted(groups.values(), key=lambda g: g['rate'])]
    tax = sum(g['tax'] for g in tg)
    return {'lines': out, 'tax_groups': tg, 'amount_untaxed': int(untaxed), 'amount_tax': tax, 'amount_total': int(untaxed) + tax}

L = lambda name, qty, price, vat, disc=0, incl=True: {'name': name, 'qty': qty, 'price': price, 'vat_pct': vat, 'discount_pct': disc, 'price_include': incl}
SAMPLES = [
    ('S11', 'quote', 'Báo giá giá bán lẻ đã gồm thuế, đủ bốn mức 0/5/8/10%', [L('Sách', 3, 52000, 0), L('Gạo ST25 (kg)', 25, 34000, 5), L('Phần mềm', 1, 1990000, 8), L('Ghế xoay', 2, 1650000, 10)]),
    ('S12', 'sale_order', 'Đơn bán: giá gồm thuế có phần lẻ — tách thuế lệch nếu làm tròn sai chỗ', [L('Nước suối', 7, 4999, 10), L('Bánh', 3, 12345, 8), L('Trà', 11, 7777, 5), L('Báo', 1, 9, 10), L('Kẹo', 1, 1, 8)]),
    ('S13', 'invoice', 'Hoá đơn: giá gồm thuế + chiết khấu + số lượng lẻ', [L('Thép (kg)', 86.1, 18150, 10, 3.5), L('Cáp (m)', 42.861, 835380, 8, 12.85), L('Hạt điều (kg)', 0.125, 408450, 5), L('Gói', 2.375, 1999, 0, 12.5)]),
    ('S14', 'purchase_order', 'Đơn mua: trộn dòng giá gồm thuế và dòng giá chưa thuế cùng mức', [L('Linh kiện (gồm thuế)', 100, 92247, 10, 66.5), L('Linh kiện (chưa thuế)', 100, 83861, 10, 66.5, False), L('Vỏ hộp', 485, 248, 8, 77), L('Ốc vít', 29, 184, 5), L('Ốc vít (chưa thuế)', 29, 175, 5, 0, False)]),
    ('S15', 'vendor_bill', 'Hoá đơn NCC: số tiền lớn giá gồm thuế, chiết khấu 100% và giá 0', [L('Máy CNC', 647, 316250, 10, 51.46), L('Vật tư', 600, 61695, 8, 35.83), L('Hàng tặng', 5, 132000, 10, 100), L('Miễn phí', 2, 0, 5), L('Không chịu thuế', 3, 99999999, 0)]),
]
docs = [{'id': i, 'doc': d, 'title': t, 'lines': ls, 'odoo': compute_doc(ls)} for i, d, t, ls in SAMPLES]
print(json.dumps({'source': 'Odoo 17.0 @657d92130e501843316542524f074a2f094c27e2 float_round; compute_all 17.0 = _add_tax_details_in_base_line 18.0 (price_include, round_per_line, VND rounding 1.0)',
                  'samples': docs}, ensure_ascii=False, indent=1))
