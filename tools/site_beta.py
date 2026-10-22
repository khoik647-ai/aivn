#!/usr/bin/env python3
"""Thêm/cập nhật (hoặc gỡ) khối “Tải bản beta …” ngay dưới hàng nút tải bản ổn định trên trang web AIVN, đủ vi/en/zh.

Khối nằm giữa <!--AIVN-BETA--> … <!--/AIVN-BETA--> (chạy lại thì THAY, không nhân đôi); khoá dịch là "beta.1".
- Trang mẫu (site/index.html, có --i18n-dir site/i18n): ghi bản dịch vào site/i18n/{en,zh}.json rồi ghép như tools/site_i18n_build.py
  (release.sh dựng trang từ mẫu này nên khối beta không mất khi phát hành bản ổn định).
- Trang đang chạy (bản sao nhánh gh-pages, không có --i18n-dir): sửa thẳng từ điển /*I18N*/…/*END*/ trong trang.
Dùng: python3 tools/site_beta.py --html F --version 0.16.0-beta.2.7 --url URL --sha256 HEX --size BYTES [--i18n-dir site/i18n]
      python3 tools/site_beta.py --html F --clear [--i18n-dir site/i18n]      # gỡ khối beta (vd. khi phát hành bản ổn định)
Cách làm đầy đủ (kiểm tài sản, đăng gh-pages, kiểm trang thật): tools/publish-beta-site.sh"""
import argparse, html as H, json, os, re, sys

ap = argparse.ArgumentParser()
ap.add_argument('--html', required=True); ap.add_argument('--i18n-dir'); ap.add_argument('--clear', action='store_true')
ap.add_argument('--version'); ap.add_argument('--url'); ap.add_argument('--sha256'); ap.add_argument('--size', type=int)
a = ap.parse_args()
page = open(a.html, encoding='utf-8').read()
START, END = '<!--AIVN-BETA-->', '<!--/AIVN-BETA-->'
page = re.sub(r'\n?' + re.escape(START) + r'.*?' + re.escape(END), '', page, flags=re.S)
# B152: link “Hoặc thử bản beta …” ngay dưới hàng nút tải + câu nhắc trong huy hiệu phiên bản (hero.1) — cập nhật/gỡ cùng khối beta
HSTART, HEND, BSTART, BEND = '<!--AIVN-BETA-HERO-->', '<!--/AIVN-BETA-HERO-->', '<!--AIVN-BETA-BADGE-->', '<!--/AIVN-BETA-BADGE-->'
unbadge = lambda t: re.sub(re.escape(BSTART) + r'.*?' + re.escape(BEND), '', t, flags=re.S)
page = re.sub(r'\n?' + re.escape(HSTART) + r'.*?' + re.escape(HEND), '', page, flags=re.S)
page = unbadge(page)

T = None
if not a.clear:
    if not (a.version and a.url and a.sha256 and a.size): sys.exit('cần --version --url --sha256 --size (hoặc --clear)')
    if not re.fullmatch(r'\d+\.\d+\.\d+-beta[0-9.]*', a.version): sys.exit('phiên bản beta không hợp lệ: ' + a.version)
    if not re.fullmatch(r'[0-9a-f]{64}', a.sha256): sys.exit('SHA-256 phải là 64 ký tự hex thường')
    if not a.url.startswith('https://github.com/') or '/releases/download/' not in a.url: sys.exit('URL phải là tài sản trực tiếp trên GitHub Releases')
    mb = round(a.size / 1e6); u = H.escape(a.url, quote=True); v = H.escape(a.version)
    nv = f'<span class="nw">{v}</span>'
    # B148: vùng bấm ≥ 44 px; B146: “SHA-256” và số phiên bản không bị ngắt ở dấu gạch; B143: trên điện thoại hiện dòng “chỉ cho Windows”
    link = lambda label, size: f'<a class="beta-link" href="{u}" rel="noopener">🧪 {label} <span class="beta-size">· {size}</span></a>'
    sha = lambda lab: f'<span class="nw">{lab}</span>' + ('' if lab.endswith('：') else ' ') + f'<code class="beta-sha">{a.sha256}</code>'
    mnote = lambda t: f'<span class="beta-mnote">📱 {t}</span>'
    # B144/B145: lời theo góp ý QA — không lặp “beta”, zh không dùng 试用版, vi có “Nếu”
    T = {
        'vi': link(f'Tải bản thử nghiệm {nv} cho Windows', f'~{mb} MB') + mnote('Bản này chỉ cài được trên máy tính Windows. Hãy mở trang này trên máy tính để tải.')
              + f'<small>⚠ Bản thử nghiệm có thể còn lỗi và không tự cập nhật. Nếu dùng hằng ngày, bạn nên chọn bản ổn định ở trên. {sha("SHA-256:")}</small>',
        'en': link(f'Download the {nv} beta for Windows', f'~{mb} MB') + mnote('This beta only installs on Windows PCs. Open this page on a computer to download it.')
              + f'<small>⚠ Beta: it may still have bugs and does not update automatically. For everyday use, choose the stable version above. {sha("SHA-256:")}</small>',
        'zh': link(f'下载 {nv} 测试版（Windows）', f'约 {mb} MB') + mnote('此测试版只能安装在 Windows 电脑上，请在电脑上打开本页下载。')
              + f'<small>⚠ 测试版可能仍有错误，也不会自动更新。日常使用请选择上方的稳定版。{sha("SHA-256：")}</small>',
    }
    css = ('<style>.beta-dl{margin-top:.6rem;padding:.35rem .8rem .55rem;border:1px dashed var(--muted);border-radius:10px;max-width:46rem;line-height:1.6;overflow-wrap:anywhere}'
           '.beta-dl .beta-link{display:block;min-height:44px;padding:.55rem 0;line-height:1.5;box-sizing:border-box;font-weight:600;color:var(--accent)}.beta-dl .beta-size{font-weight:400;color:var(--muted);white-space:nowrap}'
           '.beta-dl .nw{white-space:nowrap}.beta-dl small{display:block}.beta-dl .beta-sha{word-break:break-all;font-size:.82em}'
           '.beta-dl .beta-mnote{display:none;font-weight:600}html.is-mobile .beta-dl .beta-mnote{display:block}'
           'html.is-mobile .beta-dl .beta-link{color:var(--muted)}.beta-dl .beta-mnote.flash{color:var(--accent)}</style>')
    # B143: điện thoại/máy tính bảng (kể cả iPad báo “MacIntel”) → không tải tệp .exe, chỉ nhắc dòng “chỉ cho Windows”
    js = ('<script>(function(){var d=document.documentElement,u=navigator.userAgent||"",p=(navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||"";'
          'if(/android|iphone|ipad|ipod|mobile/i.test(u)||(/mac/i.test(p)&&navigator.maxTouchPoints>1)||(navigator.userAgentData&&navigator.userAgentData.mobile))d.classList.add("is-mobile");'
          'document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest(".beta-dl .beta-link");if(!a||!d.classList.contains("is-mobile"))return;'
          'e.preventDefault();var n=a.closest(".beta-dl").querySelector(".beta-mnote");if(n){n.classList.add("flash");n.scrollIntoView({block:"nearest"});}},true);})();</script>')
    css = css.replace('</style>', '#tai-beta{scroll-margin-top:calc(var(--hdr,68px) + 16px)}'
                      '.beta-hero{margin:.5rem 0 .2rem}.beta-hero .nw{white-space:nowrap}.badge{display:inline-block;line-height:1.5}.badge .dot{display:inline-block;vertical-align:middle;margin-right:8px}.badge .nw{white-space:nowrap}.beta-hero a{display:inline-block;min-height:44px;padding:.6rem 0;line-height:1.5;box-sizing:border-box;font-weight:600;color:var(--accent);text-decoration:underline;text-underline-offset:3px}</style>')
    block = (f'\n{START}{css}<p class="hero-note beta-dl" id="tai-beta" data-i18n="beta.1" data-beta-version="{v}">{T["vi"]}</p>{js}{END}')
    H2 = {'vi': f'<a href="#tai-beta">🧪 Hoặc thử bản beta {nv} →</a>', 'en': f'<a href="#tai-beta">🧪 Or try the {nv} beta →</a>',
          'zh': f'<a href="#tai-beta">🧪 或者试试 {nv} 测试版 →</a>'}
    BADGE = {'vi': f' · Có bản thử nghiệm {nv}', 'en': f' · {nv} beta available', 'zh': f' · 已推出 {nv} 测试版'}
    BADGE = {l: BSTART + t + BEND for l, t in BADGE.items()}
    m = re.search(r'<p class="hero-note"[^>]*data-i18n="hero\.9"[^>]*>.*?</p>', page, flags=re.S)
    if not m: sys.exit('không thấy dòng ghi chú dưới hàng nút tải (data-i18n="hero.9")')
    page = page[:m.end()] + block + page[m.end():]
    hero = f'\n{HSTART}<p class="beta-hero" data-i18n="beta.2">{H2["vi"]}</p>{HEND}'
    page = page[:m.start()] + hero.lstrip('\n') + '\n' + page[m.start():]   # ngay dưới hàng nút tải, trên dòng ghi chú hero.9
    mb = re.search(r'(<span class="badge" data-i18n="hero\.1">.*?)(</span>)(?=\s*\n)', page)
    if not mb: sys.exit('không thấy huy hiệu phiên bản (data-i18n="hero.1")')
    page = page[:mb.end(1)] + BADGE['vi'] + page[mb.end(1):]

if a.i18n_dir:  # trang mẫu: lưu bản dịch vào site/i18n rồi ghép lại từ điển
    L = {}
    for l in ('vi', 'en', 'zh'):
        p = os.path.join(a.i18n_dir, l + '.json'); L[l] = json.load(open(p, encoding='utf-8'))
        if l != 'vi':
            L[l].setdefault('text', {}).pop('beta.1', None); L[l]['text'].pop('beta.2', None)
            L[l]['text']['hero.1'] = unbadge(L[l]['text']['hero.1'])
            if T: L[l]['text']['beta.1'] = T[l]; L[l]['text']['beta.2'] = H2[l]; L[l]['text']['hero.1'] += BADGE[l]
            open(p, 'w', encoding='utf-8').write(json.dumps(L[l], ensure_ascii=False, indent=1) + '\n')
    D = {'en': {**L['en']['text'], **L['en']['attr']}, 'zh': {**L['zh']['text'], **L['zh']['attr']}, 'meta': {l: L[l]['meta'] for l in L}}
    page, n = re.subn(r'/\*I18N\*/.*?/\*END\*/', lambda m: '/*I18N*/' + json.dumps(D, ensure_ascii=False) + '/*END*/', page, count=1, flags=re.S)
else:  # trang đang chạy: sửa thẳng từ điển trong trang
    m = re.search(r'/\*I18N\*/(.*?)/\*END\*/', page, flags=re.S)
    if not m: sys.exit('không thấy từ điển /*I18N*/…/*END*/ trong trang')
    D = json.loads(m.group(1))
    for l in ('en', 'zh'):
        D[l].pop('beta.1', None); D[l].pop('beta.2', None); D[l]['hero.1'] = unbadge(D[l]['hero.1'])
        if T: D[l]['beta.1'] = T[l]; D[l]['beta.2'] = H2[l]; D[l]['hero.1'] += BADGE[l]
    page = page[:m.start()] + '/*I18N*/' + json.dumps(D, ensure_ascii=False) + '/*END*/' + page[m.end():]
open(a.html, 'w', encoding='utf-8').write(page)
print(('đã gỡ khối beta khỏi ' if a.clear else f'đã đặt khối beta {a.version} vào ') + a.html)
