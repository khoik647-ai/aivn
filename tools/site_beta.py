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

T = None
if not a.clear:
    if not (a.version and a.url and a.sha256 and a.size): sys.exit('cần --version --url --sha256 --size (hoặc --clear)')
    if not re.fullmatch(r'\d+\.\d+\.\d+-beta[0-9.]*', a.version): sys.exit('phiên bản beta không hợp lệ: ' + a.version)
    if not re.fullmatch(r'[0-9a-f]{64}', a.sha256): sys.exit('SHA-256 phải là 64 ký tự hex thường')
    if not a.url.startswith('https://github.com/') or '/releases/download/' not in a.url: sys.exit('URL phải là tài sản trực tiếp trên GitHub Releases')
    mb = round(a.size / 1e6); u = H.escape(a.url, quote=True); v = H.escape(a.version)
    link = lambda label: f'🧪 <a class="beta-link" href="{u}" rel="noopener" style="font-weight:600;color:var(--accent)">{label}</a> · ~{mb} MB'
    sha = f'<code class="beta-sha" style="word-break:break-all;font-size:.82em">{a.sha256}</code>'
    T = {
        'vi': link(f'Tải bản beta {v} (thử nghiệm, Windows)') + f'<br/><small>⚠ Bản thử nghiệm, có thể còn lỗi và không tự cập nhật. Dùng hằng ngày, bạn nên chọn bản ổn định ở trên. SHA-256: {sha}</small>',
        'en': link(f'Download beta {v} (test version, Windows)') + f'<br/><small>⚠ Test version: it may still have bugs and does not update automatically. For everyday use, choose the stable version above. SHA-256: {sha}</small>',
        'zh': link(f'下载测试版 {v}（试用版，Windows）') + f'<br/><small>⚠ 测试版本，可能仍有错误，且不会自动更新。日常使用请选择上方的稳定版。SHA-256：{sha}</small>',
    }
    block = (f'\n{START}<p class="hero-note beta-dl" style="margin-top:.6rem;padding:.55rem .8rem;border:1px dashed var(--muted);border-radius:10px;max-width:46rem;line-height:1.6" '
             f'data-i18n="beta.1" data-beta-version="{v}">{T["vi"]}</p>{END}')
    m = re.search(r'<p class="hero-note"[^>]*data-i18n="hero\.9"[^>]*>.*?</p>', page, flags=re.S)
    if not m: sys.exit('không thấy dòng ghi chú dưới hàng nút tải (data-i18n="hero.9")')
    page = page[:m.end()] + block + page[m.end():]

if a.i18n_dir:  # trang mẫu: lưu bản dịch vào site/i18n rồi ghép lại từ điển
    L = {}
    for l in ('vi', 'en', 'zh'):
        p = os.path.join(a.i18n_dir, l + '.json'); L[l] = json.load(open(p, encoding='utf-8'))
        if l != 'vi':
            L[l].setdefault('text', {}).pop('beta.1', None)
            if T: L[l]['text']['beta.1'] = T[l]
            open(p, 'w', encoding='utf-8').write(json.dumps(L[l], ensure_ascii=False, indent=1) + '\n')
    D = {'en': {**L['en']['text'], **L['en']['attr']}, 'zh': {**L['zh']['text'], **L['zh']['attr']}, 'meta': {l: L[l]['meta'] for l in L}}
    page, n = re.subn(r'/\*I18N\*/.*?/\*END\*/', lambda m: '/*I18N*/' + json.dumps(D, ensure_ascii=False) + '/*END*/', page, count=1, flags=re.S)
else:  # trang đang chạy: sửa thẳng từ điển trong trang
    m = re.search(r'/\*I18N\*/(.*?)/\*END\*/', page, flags=re.S)
    if not m: sys.exit('không thấy từ điển /*I18N*/…/*END*/ trong trang')
    D = json.loads(m.group(1))
    for l in ('en', 'zh'):
        D[l].pop('beta.1', None)
        if T: D[l]['beta.1'] = T[l]
    page = page[:m.start()] + '/*I18N*/' + json.dumps(D, ensure_ascii=False) + '/*END*/' + page[m.end():]
open(a.html, 'w', encoding='utf-8').write(page)
print(('đã gỡ khối beta khỏi ' if a.clear else f'đã đặt khối beta {a.version} vào ') + a.html)
