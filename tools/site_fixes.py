#!/usr/bin/env python3
"""Sửa chung cho trang web AIVN (chạy lại bao nhiêu lần cũng được; dùng cho cả trang mẫu site/ lẫn bản đang chạy trên gh-pages).
- B143: nhận hệ điều hành — iPhone/iPad/Android KHÔNG bị coi là mac/linux; gắn lớp html.is-mobile.
- B147: dung lượng thật cho mọi nút/mục tải và cả title, đủ vi/en/zh (1 MB = 10^6 byte, làm tròn — như release.sh và khối beta).
        Trang mẫu: giữ chỗ __MB_WIN__/__MB_ARM__/__MB_X64__ để release.sh điền; trang đang chạy: --sizes WIN,ARM,X64 (byte).
- B149: chân trang en/zh: nhãn “Phone:”/“电话：”; dòng ghi công “NGUYỄN NGỌC KHÔI SINH VIÊN VLU” giữ NGUYÊN, chỉ thêm phụ đề dịch bên dưới/bên cạnh.
- B150: không tràn ngang ở màn 320 px (vi/en/zh).
Dùng: python3 tools/site_fixes.py --html F [--i18n-dir site/i18n] [--sizes 240075606,259835253,272736118]"""
import argparse, json, os, re, sys

ap = argparse.ArgumentParser()
ap.add_argument('--html', required=True); ap.add_argument('--i18n-dir'); ap.add_argument('--sizes')
a = ap.parse_args()
page = open(a.html, encoding='utf-8').read()
CREDIT = 'NGUYỄN NGỌC KHÔI SINH VIÊN VLU'
n_credit0 = page.count(CREDIT)
if a.sizes:
    w, r, x = (round(int(b) / 1e6) for b in a.sizes.split(','))
    MB = {'WIN': str(w), 'ARM': str(r), 'X64': str(x)}
else:
    MB = {k: f'__MB_{k}__' for k in ('WIN', 'ARM', 'X64')}

def sizes(s):
    """B147: thay mọi con số dung lượng ở đúng ngữ cảnh của từng nút (vi/en/zh, cả title)."""
    N = r'(?:\d+|__MB_[A-Z0-9]+__)'
    for pat, k in [(r'(64-bit, ~)' + N + r'( MB\))', 'WIN'), (r'(64 位，约 )' + N + r'( MB）)', 'WIN'),
                   (r'(M1, M2, M3, M4… · ~)' + N + r'( MB)', 'ARM'), (r'(M1, M2, M3, M4… chips · ~)' + N + r'( MB)', 'ARM'), (r'(M1、M2、M3、M4… 芯片 · 约 )' + N + r'( MB)', 'ARM'),
                   (r'(Intel · ~)' + N + r'( MB)', 'X64'), (r'(Intel processor · ~)' + N + r'( MB)', 'X64'), (r'(Intel 处理器的 Mac · 约 )' + N + r'( MB)', 'X64'),
                   (r'(Apple Silicon ~)' + N + r'( MB)', 'ARM'), (r'(Apple 芯片约 )' + N + r'( MB)', 'ARM'), (r'(Intel ~)' + N + r'( MB)', 'X64'), (r'(Intel 约 )' + N + r'( MB)', 'X64')]:
        s = re.sub(pat, lambda m: m.group(1) + MB[k] + m.group(2), s)
    return s

def sub1(s, old, new, why):
    if new in s: return s
    if old not in s: sys.exit(f'không thấy chỗ cần sửa ({why}): {old[:80]}')
    return s.replace(old, new)

# --- B143: nhận hệ điều hành
OS_OLD = 'var os=/win/.test(ua)?"windows":/mac|iphone|ipad/.test(ua)?"mac":/linux|x11|cros/.test(ua)?"linux":null;'
OS_NEW = ('var nua=navigator.userAgent||"";'
          'var phone=/android|iphone|ipad|ipod|mobile/i.test(nua)||(/mac/.test(ua)&&navigator.maxTouchPoints>1)||!!(navigator.userAgentData&&navigator.userAgentData.mobile);'  # iPadOS báo “MacIntel”
          'document.documentElement.classList.toggle("is-mobile",phone);'
          'var os=phone?null:/win/.test(ua)?"windows":/mac/.test(ua)?"mac":/linux|x11|cros/.test(ua)?"linux":null;')
page = sub1(page, OS_OLD, OS_NEW, 'B143 nhận hệ điều hành')
page = page.replace("var mobile=/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent||'')||(navigator.userAgentData&&navigator.userAgentData.mobile);", 'var mobile=phone;')

# --- B147: mục Apple Silicon dịch được (có dung lượng), title nút macOS có dung lượng
ARM_VI = '<b>Apple Silicon</b><small>Chip M1, M2, M3, M4… · ~'
_n = iter(('hero.arm', 'cta.arm'))   # hai mục Apple Silicon (hàng nút đầu trang, hàng nút cuối trang) — khoá riêng, không trùng
page = re.sub(r'<a download="" href="([^"]*AIVN-mac-arm64\.zip)" role="menuitem">', lambda m: f'<a data-i18n="{next(_n)}" download="" href="{m.group(1)}" role="menuitem">', page)
if 'data-i18n="hero.arm"' not in page or 'data-i18n="cta.arm"' not in page: sys.exit('không thấy mục tải Apple Silicon')
page = re.sub(r'title="Tải AIVN cho macOS 13 trở lên"', 'title="Tải AIVN cho macOS 13 trở lên (Apple Silicon ~__MB_ARM__ MB, Intel ~__MB_X64__ MB)"', page)

# --- B149: nhãn điện thoại (trang đang chạy chưa có khoá dịch)
page = page.replace('<ul aria-label="Liên hệ nhà phát triển" class="foot-contact"><li>Email: <a href="mailto:khoik647@gmail.com">khoik647@gmail.com</a></li><li>Điện thoại: <a href="tel:0896403538">0896 403 538</a></li></ul>',
                    '<ul aria-label="Liên hệ nhà phát triển" data-i18n-aria-label="@aria-label.contact" class="foot-contact"><li>Email: <a href="mailto:khoik647@gmail.com">khoik647@gmail.com</a></li><li><span data-i18n="foot.phone">Điện thoại:</span> <a href="tel:+84896403538" data-i18n="foot.phonenum">0896 403 538</a></li></ul>')
if 'data-i18n="foot.phone"' not in page: sys.exit('không thấy dòng điện thoại ở chân trang')
# B149: phụ đề dịch của dòng ghi công — phần tử RIÊNG ngay dưới dòng ghi công (bản vi để trống, ẩn); dòng ghi công giữ nguyên văn
SUB = '<small class="credit-sub" data-i18n="footer.sub"></small>'
if SUB not in page:
    m = re.search(r'<p data-i18n="footer\.2">.*?</p>', page, flags=re.S)
    if not m: sys.exit('không thấy dòng ghi công footer.2')
    page = page[:m.end()] + SUB + page[m.end():]

# --- B150: không tràn ngang ở 320 px
CSS = ('/*AIVN-FIX-320*/@media (max-width:380px){header .wrap{padding-left:14px;padding-right:14px}.nav{gap:6px}.nav-cta{gap:6px}.logo{flex-shrink:0;gap:6px;font-size:1.08rem}.logo small{padding:1px 6px}.lang button{padding:6px 5px;min-width:27px}.burger{width:40px;height:40px;flex-shrink:0}'
       '.mobile-menu,.mobile-menu.open{padding-left:16px;padding-right:16px}.mobile-menu a{overflow-wrap:anywhere}'
       'h1,h2,h3,.lead,.checks li{overflow-wrap:anywhere}}.dev-grid>*,.privacy>*{min-width:0}.credit-sub{display:block;font-size:.85em;opacity:.8;margin-top:2px}.credit-sub:empty{display:none}/*END-FIX-320*/')
page = re.sub(r'/\*AIVN-FIX-320\*/.*?/\*END-FIX-320\*/', '', page, flags=re.S)
i = page.index('</style>'); page = page[:i] + CSS + page[i:]

KEYS = {
    'en': {'hero.arm': '<b>Apple Silicon</b><small>M1, M2, M3, M4… chips · ~__MB_ARM__ MB</small>', 'cta.arm': '<b>Apple Silicon</b><small>M1, M2, M3, M4… chips · ~__MB_ARM__ MB</small>',
           'foot.phone': 'Phone:', 'foot.phonenum': '+84 896 403 538', '@aria-label.contact': 'Contact the developer',
           '@title.5': 'Download AIVN for macOS 13 or later (Apple Silicon ~__MB_ARM__ MB, Intel ~__MB_X64__ MB)',
           'footer.2': f'Developed by <b style="color:var(--accent)">{CREDIT}</b>', 'footer.sub': '(student at Van Lang University)',
           'footer.12': f'<span>© 2026 AIVN · {CREDIT}</span><span>Developed by {CREDIT} (student at Van Lang University)</span>'},
    'zh': {'hero.arm': '<b>Apple Silicon</b><small>M1、M2、M3、M4… 芯片 · 约 __MB_ARM__ MB</small>', 'cta.arm': '<b>Apple Silicon</b><small>M1、M2、M3、M4… 芯片 · 约 __MB_ARM__ MB</small>',
           'foot.phone': '电话：', 'foot.phonenum': '+84 896 403 538', '@aria-label.contact': '联系开发者',
           '@title.5': '下载 macOS 13 及以上版本的 AIVN（Apple 芯片约 __MB_ARM__ MB，Intel 约 __MB_X64__ MB）',
           'footer.2': f'开发者：<b style="color:var(--accent)">{CREDIT}</b>', 'footer.sub': '（文郎大学学生）',
           'footer.12': f'<span>© 2026 AIVN · {CREDIT}</span><span>开发者：{CREDIT}（文郎大学学生）</span>'},
}
for l in KEYS:
    KEYS[l] = {k: sizes(v) for k, v in KEYS[l].items()}

page = sizes(page)
if a.i18n_dir:
    L = {}
    for l in ('vi', 'en', 'zh'):
        p = os.path.join(a.i18n_dir, l + '.json'); L[l] = json.load(open(p, encoding='utf-8'))
        if l == 'vi': continue
        for k, v in KEYS[l].items(): L[l]['attr' if k.startswith('@') else 'text'][k] = v
        for part in ('text', 'attr'): L[l][part] = {k: sizes(v) for k, v in L[l][part].items()}
        open(p, 'w', encoding='utf-8').write(json.dumps(L[l], ensure_ascii=False, indent=1) + '\n')
    D = {'en': {**L['en']['text'], **L['en']['attr']}, 'zh': {**L['zh']['text'], **L['zh']['attr']}, 'meta': {l: L[l]['meta'] for l in L}}
    page = re.sub(r'/\*I18N\*/.*?/\*END\*/', lambda m: '/*I18N*/' + json.dumps(D, ensure_ascii=False) + '/*END*/', page, count=1, flags=re.S)
else:
    m = re.search(r'/\*I18N\*/(.*?)/\*END\*/', page, flags=re.S); D = json.loads(m.group(1))
    for l in ('en', 'zh'):
        D[l].update(KEYS[l])
        D[l] = {k: sizes(v) for k, v in D[l].items()}
    page = page[:m.start()] + '/*I18N*/' + json.dumps(D, ensure_ascii=False) + '/*END*/' + page[m.end():]

# ghi công phải còn nguyên ở mọi nơi (không bị thay/dịch)
if page.count(CREDIT) < n_credit0: sys.exit('dòng ghi công bị mất/đổi — dừng')
for l in ('en', 'zh'):
    for k in ('footer.2', 'footer.12'):
        if CREDIT not in (D[l].get(k) or ''): sys.exit(f'{l}/{k} thiếu dòng ghi công nguyên văn')
if a.sizes and re.search(r'__MB_[A-Z0-9]+__', page): sys.exit('còn chỗ dung lượng chưa điền')
open(a.html, 'w', encoding='utf-8').write(page)
print(f'đã sửa chung {a.html}: dung lượng {MB}')
