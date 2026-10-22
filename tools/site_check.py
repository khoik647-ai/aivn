"""Kiểm bố cục trang web AIVN (B143–B150) ở 320/375/1280 px × vi/en/zh bằng Playwright + Chrome. Thoát 1 nếu có lỗi.
Dùng: python tools/site_check.py URL out.json [thư-mục-ảnh]"""
import sys, json
from playwright.sync_api import sync_playwright
URL = sys.argv[1]; OUT = sys.argv[2]; SHOTS = sys.argv[3] if len(sys.argv) > 3 else None
CREDIT = 'NGUYỄN NGỌC KHÔI SINH VIÊN VLU'
IPH = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
CONF = [('iphoneSE-320', dict(viewport={'width': 320, 'height': 568}, user_agent=IPH, is_mobile=True, has_touch=True, device_scale_factor=2)),
        ('iphone-375', dict(viewport={'width': 375, 'height': 667}, user_agent=IPH, is_mobile=True, has_touch=True, device_scale_factor=2)),
        ('android-320', dict(viewport={'width': 320, 'height': 640}, user_agent=AND, is_mobile=True, has_touch=True)),
        ('desktop-1280', dict(viewport={'width': 1280, 'height': 800}))]
JS = r'''() => {
 const d=document.documentElement, cw=d.clientWidth, off=[];
 document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect(); if(r.width&&r.right>cw+0.5&&getComputedStyle(e).position!=='fixed'||(r.width&&r.right>cw+0.5&&e.closest('.mobile-menu.open'))) off.push((e.tagName+'.'+e.className).slice(0,40)+':'+Math.round(r.right));});
 const a=document.querySelector('.beta-dl .beta-link'), n=document.querySelector('.beta-dl .beta-mnote');
 const nw=[...document.querySelectorAll('.beta-dl .nw')].map(e=>e.getClientRects().length);
 const foot=document.querySelector('footer').innerText;
 return {lang:d.lang, sw:d.scrollWidth, cw, overflow:d.scrollWidth>cw, off:off.slice(0,8), mobileCls:d.classList.contains('is-mobile'),
  linkH:a&&Math.round(a.getBoundingClientRect().height), linkText:a&&a.innerText, mnoteShown:!!(n&&n.offsetParent), nwLines:nw,
  beta:document.querySelector('.beta-dl').innerText, detected:[...document.querySelectorAll('.dl-btn.detected')].map(b=>b.dataset.os),
  creditCount:(foot.match(/NGUYỄN NGỌC KHÔI SINH VIÊN VLU/g)||[]).length, footPhone:(foot.match(/(Điện thoại|Phone|电话)[:：]?\s*[^\n]*/)||[''])[0],
  footer2:(document.querySelector('[data-i18n="footer.2"]')||{}).innerText, footSub:((document.querySelector('[data-i18n="footer.sub"]')||{}).innerText||'').trim(), titles:[...document.querySelectorAll('[data-i18n-title]')].map(e=>e.title).filter(t=>/MB/.test(t)),
  sizes:[...document.querySelectorAll('.mac-menu a small')].map(e=>e.textContent)};
}'''
res = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    for name, kw in CONF:
        for lang in ('vi', 'en', 'zh'):
            c = b.new_context(**kw); pg = c.new_page(); reqs = []
            pg.on('request', lambda r: reqs.append(r.url) if '.exe' in r.url else None)
            pg.on('download', lambda dl: reqs.append('DOWNLOAD ' + dl.url))
            pg.goto(URL + ('&' if '?' in URL else '?') + 'lang=' + lang, wait_until='load'); pg.wait_for_timeout(600)
            r = pg.evaluate(JS); r['conf'] = name
            # menu di động mở → tràn?
            if 'desktop' not in name:
                pg.click('#burger'); pg.wait_for_timeout(500); r['menuOpen'] = pg.evaluate('()=>({sw:document.documentElement.scrollWidth,mw:Math.round(document.querySelector("#mobileMenu").scrollWidth),cw:document.documentElement.clientWidth})'); pg.click('#burger'); pg.wait_for_timeout(400)
                pg.locator('.beta-dl .beta-link').scroll_into_view_if_needed(); pg.locator('.beta-dl .beta-link').tap(); pg.wait_for_timeout(1500)
                r['afterTapUrl'] = pg.url; r['exeRequests'] = list(reqs)
            if SHOTS: pg.locator('.beta-dl').scroll_into_view_if_needed(); pg.screenshot(path=f'{SHOTS}/{name}-{lang}.png')
            res.append(r); c.close()
    b.close()
json.dump(res, open(OUT, 'w'), ensure_ascii=False, indent=1)
for r in res:
    print(r['conf'], r['lang'], 'overflow' if r['overflow'] else 'ok', r['sw'], '/', r['cw'], r['off'][:4], 'menu', r.get('menuOpen'), 'mobile', r['mobileCls'], 'linkH', r['linkH'], 'nw', r['nwLines'], 'mnote', r['mnoteShown'], 'det', r['detected'], 'exe', r.get('exeRequests'), 'credit', r['creditCount'])

LABEL = {'vi': 'Điện thoại', 'en': 'Phone', 'zh-CN': '电话'}
bad = []
for r in res:
    k = f"{r['conf']} {r['lang']}"
    if r['overflow']: bad.append(f'{k}: tràn ngang {r["sw"]}>{r["cw"]}')
    if r.get('menuOpen') and r['menuOpen']['sw'] > r['menuOpen']['cw']: bad.append(f'{k}: mở menu bị tràn')
    if (r['linkH'] or 0) < 44: bad.append(f'{k}: link beta cao {r["linkH"]} px < 44')
    if any(n != 1 for n in r['nwLines']): bad.append(f'{k}: “SHA-256”/số phiên bản bị ngắt dòng')
    if r['creditCount'] < 3: bad.append(f'{k}: dòng ghi công chỉ còn {r["creditCount"]}')
    if not r['footPhone'].startswith(LABEL.get(r['lang'], '?')): bad.append(f'{k}: nhãn điện thoại “{r["footPhone"]}”')
    if (r['lang'] != 'vi') != bool(r['footSub']): bad.append(f'{k}: phụ đề ghi công “{r["footSub"]}” (en/zh phải có, vi để trống)')
    if 'desktop' in r['conf']:
        if r['mnoteShown'] or r['mobileCls']: bad.append(f'{k}: máy tính mà hiện dòng điện thoại')
    else:
        if not (r['mobileCls'] and r['mnoteShown']): bad.append(f'{k}: điện thoại không hiện dòng “chỉ cho Windows”')
        if r.get('exeRequests'): bad.append(f'{k}: bấm link beta trên điện thoại vẫn tải {r["exeRequests"]}')
        if r['detected']: bad.append(f'{k}: điện thoại bị nhận là {r["detected"]}')
print('\n'.join(bad) if bad else f'KIỂM BỐ CỤC OK: {len(res)} cấu hình')
sys.exit(1 if bad else 0)
