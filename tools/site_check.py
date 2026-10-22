"""Kiểm bố cục trang web AIVN (B143–B150, B162, B174) ở 280/320/375/1280 px × vi/en/zh bằng Playwright + Chrome. Thoát 1 nếu có lỗi.
B174: máy Mac (Safari Apple Silicon và Intel — Safari không cho biết chip; Chrome trên Mac Apple Silicon), iPhone, Android, Linux, Windows:
khối beta và link đầu trang KHÔNG mời tải .exe trên máy không phải Windows; Mac thấy tệp Mac đúng chip (hoặc được chọn khi không biết chip)
— tệp Mac của bản beta nếu release có, nếu không thì dòng “chỉ có cho Windows” + tệp Mac của bản ổn định — kèm cách mở lần đầu (Gatekeeper).
Dùng: python tools/site_check.py URL out.json [thư-mục-ảnh]"""
import sys, json, re
from playwright.sync_api import sync_playwright
URL = sys.argv[1]; OUT = sys.argv[2]; SHOTS = sys.argv[3] if len(sys.argv) > 3 else None
CREDIT = 'NGUYỄN NGỌC KHÔI SINH VIÊN VLU'
IPH = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
SAF = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'  # Safari trên Mac M… và Mac Intel: y hệt
MCH = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
LNX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
def nav(platform, touch=0, uad=None):
    """Giả navigator.platform / maxTouchPoints / userAgentData như trình duyệt thật (Chrome headless trên Linux tự báo Linux)."""
    u = 'undefined' if uad is None else ('{platform:%s,mobile:false,brands:[],getHighEntropyValues:function(){return Promise.resolve({architecture:%s})}}' % (json.dumps(uad[0]), json.dumps(uad[1])))
    return ("Object.defineProperty(Navigator.prototype,'platform',{get:function(){return %s}});"
            "Object.defineProperty(Navigator.prototype,'maxTouchPoints',{get:function(){return %d}});"
            "Object.defineProperty(Navigator.prototype,'userAgentData',{get:function(){return %s}});") % (json.dumps(platform), touch, u)
D1280 = {'width': 1280, 'height': 800}
# (tên, Playwright context, init script, loại máy)
CONF = [('fold-280', dict(viewport={'width': 280, 'height': 653}, user_agent=AND, is_mobile=True, has_touch=True, device_scale_factor=2), nav('Linux armv8l', 5), 'android'),  # B162
        ('iphoneSE-320', dict(viewport={'width': 320, 'height': 568}, user_agent=IPH, is_mobile=True, has_touch=True, device_scale_factor=2), nav('iPhone', 5), 'ios'),
        ('iphone-375', dict(viewport={'width': 375, 'height': 667}, user_agent=IPH, is_mobile=True, has_touch=True, device_scale_factor=2), nav('iPhone', 5), 'ios'),
        ('android-320', dict(viewport={'width': 320, 'height': 640}, user_agent=AND, is_mobile=True, has_touch=True), nav('Linux armv8l', 5), 'android'),
        ('mac-safari-arm64-1280', dict(viewport=D1280, user_agent=SAF), nav('MacIntel'), 'mac'),        # B174: Mac M… dùng Safari (không biết chip)
        ('mac-safari-intel-1280', dict(viewport=D1280, user_agent=SAF), nav('MacIntel'), 'mac'),        # B174: Mac Intel dùng Safari
        ('mac-chrome-arm64-1280', dict(viewport=D1280, user_agent=MCH), nav('MacIntel', 0, ('macOS', 'arm')), 'mac-arm64'),
        ('linux-1280', dict(viewport=D1280, user_agent=LNX), nav('Linux x86_64'), 'linux'),
        ('desktop-1280', dict(viewport=D1280, user_agent=WIN), nav('Win32', 0, ('Windows', 'x86')), 'win')]
JS = r'''() => {
 const d=document.documentElement, cw=d.clientWidth, off=[];
 const vis=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
 document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect(); if(r.width&&r.right>cw+0.5&&getComputedStyle(e).position!=='fixed'||(r.width&&r.right>cw+0.5&&e.closest('.mobile-menu.open'))) off.push((e.tagName+'.'+e.className).slice(0,40)+':'+Math.round(r.right));});
 const box=document.querySelector('.beta-dl'), links=[...document.querySelectorAll('.beta-dl .beta-link')].filter(vis), n=document.querySelector('.beta-dl .beta-mnote');
 const nw=[...document.querySelectorAll('.beta-dl .nw')].filter(vis).map(e=>e.getClientRects().length);
 const foot=document.querySelector('footer').innerText, hero=document.querySelector('.beta-hero a'), gk=document.querySelector('.beta-dl .beta-gk');
 return {lang:d.lang, sw:d.scrollWidth, cw, overflow:d.scrollWidth>cw, off:off.slice(0,8), mobileCls:d.classList.contains('is-mobile'), htmlCls:d.className,
  betaMac:box&&box.dataset.betaMac==='1', linkH:links.length?Math.min(...links.map(a=>Math.round(a.getBoundingClientRect().height))):null, linkText:links.map(a=>a.innerText),
  hrefs:links.map(a=>a.getAttribute('href')), exeVisible:links.some(a=>/\.exe$/i.test(a.getAttribute('href'))),
  macLinks:links.filter(a=>a.classList.contains('beta-mac-link')).map(a=>a.dataset.arch+' '+a.getAttribute('href')),
  onlyWin:vis(document.querySelector('.beta-dl .beta-onlywin'))?document.querySelector('.beta-dl .beta-onlywin').innerText:'',
  lnote:vis(document.querySelector('.beta-dl .beta-lnote')), archHint:vis(document.querySelector('.beta-dl .beta-archhint')),
  gk:vis(gk), gkSummaryH:vis(gk)?Math.round(gk.querySelector('summary').getBoundingClientRect().height):null,
  mnoteShown:vis(n), nwLines:nw, heroText:hero?hero.innerText.trim():null, heroH:hero&&vis(hero)?Math.round(hero.getBoundingClientRect().height):null,
  beta:box.innerText, detected:[...document.querySelectorAll('.dl-btn.detected')].map(b=>b.dataset.os),
  creditCount:(foot.match(/NGUYỄN NGỌC KHÔI SINH VIÊN VLU/g)||[]).length, footPhone:(foot.match(/(Điện thoại|Phone|电话)[:：]?\s*[^\n]*/)||[''])[0],
  footer2:(document.querySelector('[data-i18n="footer.2"]')||{}).innerText, footSub:((document.querySelector('[data-i18n="footer.sub"]')||{}).innerText||'').trim(), titles:[...document.querySelectorAll('[data-i18n-title]')].map(e=>e.title).filter(t=>/MB/.test(t)),
  sizes:[...document.querySelectorAll('.mac-menu a small')].map(e=>e.textContent)};
}'''
ONLYWIN = {'vi': 'Bản thử nghiệm hiện chỉ có cho Windows', 'en': 'available for Windows only', 'zh-CN': '仅提供 Windows'}
res = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    for name, kw, init, kind in CONF:
        for lang in ('vi', 'en', 'zh'):
            c = b.new_context(**kw); c.add_init_script(init); pg = c.new_page(); reqs = []
            pg.on('request', lambda r: reqs.append(r.url) if re.search(r'\.(exe|zip)(\?|$)', r.url) else None)
            pg.on('download', lambda dl: (reqs.append('DOWNLOAD ' + dl.url), dl.cancel()))
            pg.goto(URL + ('&' if '?' in URL else '?') + 'lang=' + lang, wait_until='load'); pg.wait_for_timeout(700)
            r = pg.evaluate(JS); r['conf'] = name; r['kind'] = kind
            # B152: link beta đầu trang → bấm thì cuộn tới khối beta (không tải gì)
            hl = pg.locator('.beta-hero a')
            if hl.count():
                hl.click(); pg.wait_for_timeout(1200)
                r['heroScroll'] = pg.evaluate('()=>{const b=document.getElementById("tai-beta").getBoundingClientRect();return b.top>=0&&b.top<innerHeight}')
                pg.evaluate('()=>scrollTo(0,0)'); pg.wait_for_timeout(300)
            # B174: mở phần hướng dẫn Gatekeeper (Mac/iPhone) → không tải gì, các bước hiện ra
            gs = pg.locator('.beta-dl .beta-gk summary')
            if r['gk']:
                gs.scroll_into_view_if_needed(); gs.click(); pg.wait_for_timeout(300)
                r['gkSteps'] = pg.evaluate('()=>[...document.querySelectorAll(".beta-dl .beta-gk li")].filter(e=>e.getClientRects().length).length')
            if kind in ('ios', 'android'):
                pg.click('#burger'); pg.wait_for_timeout(500); r['menuOpen'] = pg.evaluate('()=>({sw:document.documentElement.scrollWidth,mw:Math.round(document.querySelector("#mobileMenu").scrollWidth),cw:document.documentElement.clientWidth})'); pg.click('#burger'); pg.wait_for_timeout(400)
                r['overflowAfter'] = pg.evaluate('()=>document.documentElement.scrollWidth>document.documentElement.clientWidth')
            r['afterUrl'] = pg.url; r['requests'] = list(reqs)
            if SHOTS: pg.locator('.beta-dl').scroll_into_view_if_needed(); pg.screenshot(path=f'{SHOTS}/{name}-{lang}.png')
            res.append(r); c.close()
    b.close()
json.dump(res, open(OUT, 'w'), ensure_ascii=False, indent=1)
for r in res:
    print(r['conf'], r['lang'], 'overflow' if r['overflow'] else 'ok', r['sw'], '/', r['cw'], r['off'][:4], 'menu', r.get('menuOpen'), 'mobile', r['mobileCls'], 'linkH', r['linkH'],
          'exe', r['exeVisible'], 'mac', [m.split('/')[-1] for m in r['macLinks']], 'onlyWin', bool(r['onlyWin']), 'gk', r['gk'], r.get('gkSteps'), 'hero', r['heroText'], 'det', r['detected'], 'req', r['requests'], 'credit', r['creditCount'])

LABEL = {'vi': 'Điện thoại', 'en': 'Phone', 'zh-CN': '电话'}
bad = []
for r in res:
    k = f"{r['conf']} {r['lang']}"; kind = r['kind']; mac_beta = r['betaMac']
    if r['overflow']: bad.append(f'{k}: tràn ngang {r["sw"]}>{r["cw"]}')
    if r.get('menuOpen') and r['menuOpen']['sw'] > r['menuOpen']['cw']: bad.append(f'{k}: mở menu bị tràn')
    if r['linkH'] is not None and r['linkH'] < 44: bad.append(f'{k}: link beta cao {r["linkH"]} px < 44')
    if any(n != 1 for n in r['nwLines']): bad.append(f'{k}: “SHA-256”/số phiên bản bị ngắt dòng')
    if r['heroH'] is not None and (r['heroH'] < 44 or not r.get('heroScroll')): bad.append(f'{k}: link beta ở đầu trang cao {r["heroH"]} px / cuộn tới khối: {r.get("heroScroll")}')
    if r.get('heroText') and r['heroText'].lower().count('beta') > 1: bad.append(f'{k}: link đầu trang lặp “beta”: {r["heroText"]}')  # B145
    if r['creditCount'] < 3: bad.append(f'{k}: dòng ghi công chỉ còn {r["creditCount"]}')
    if not r['footPhone'].startswith(LABEL.get(r['lang'], '?')): bad.append(f'{k}: nhãn điện thoại “{r["footPhone"]}”')
    if (r['lang'] != 'vi') != bool(r['footSub']): bad.append(f'{k}: phụ đề ghi công “{r["footSub"]}” (en/zh phải có, vi để trống)')
    if r['requests']: bad.append(f'{k}: mở trang/bấm link đầu trang/hướng dẫn mà trình duyệt tải tệp {r["requests"]}')
    if kind == 'win':
        if r['mnoteShown'] or r['mobileCls']: bad.append(f'{k}: máy tính mà hiện dòng điện thoại')
        if not r['exeVisible']: bad.append(f'{k}: Windows không thấy link tải .exe của bản beta')
        if r['macLinks'] or r['onlyWin'] or r['gk']: bad.append(f'{k}: Windows mà hiện phần Mac')
        if 'Windows' in (r['heroText'] or '') : bad.append(f'{k}: link đầu trang trên Windows lại nói “chỉ có cho Windows”: {r["heroText"]}')
    else:
        if r['exeVisible']: bad.append(f'{k}: {kind} vẫn được mời tải .exe: {r["hrefs"]}')   # B174
        if kind in ('ios', 'android'):
            if not (r['mobileCls'] and r['mnoteShown']): bad.append(f'{k}: điện thoại không hiện dòng “mở trên máy tính”')
            if r['detected']: bad.append(f'{k}: điện thoại bị nhận là {r["detected"]}')
            if r.get('overflowAfter'): bad.append(f'{k}: tràn ngang sau khi mở menu')
        if kind in ('mac', 'mac-arm64'):  # B183: iPhone/iPad không hiện tệp Mac (cùng cách android — chỉ dòng 📱)
            arch = [m.split(' ')[0] for m in r['macLinks']]; want = ['arm64'] if kind == 'mac-arm64' else ['arm64', 'x64']
            if arch != want: bad.append(f'{k}: tệp Mac hiện {arch}, cần {want}')
            for m in r['macLinks']:
                a, h = m.split(' ', 1)
                if not re.search(rf'/AIVN-[0-9][^/]*-{a}-mac\.zip$', h): bad.append(f'{k}: link Mac {a} sai tệp: {h}')
                if mac_beta and '-beta' not in h: bad.append(f'{k}: bản beta có tệp Mac mà link Mac lại trỏ bản ổn định: {h}')
                if not mac_beta and '-beta' in h: bad.append(f'{k}: {h}')
            if (kind != 'mac-arm64') != r['archHint']: bad.append(f'{k}: dòng “không chắc chip” {"thiếu" if kind != "mac-arm64" else "thừa"} (Safari không cho biết chip → phải cho chọn; Chrome báo chip → chỉ một tệp)')
            if not mac_beta and ONLYWIN[r['lang']] not in r['onlyWin']: bad.append(f'{k}: thiếu dòng “bản beta chỉ có cho Windows”: {r["onlyWin"]!r}')
            if not r['gk'] or r.get('gkSteps') != 4 or (r['gkSummaryH'] or 0) < 44: bad.append(f'{k}: hướng dẫn mở lần đầu trên Mac (Gatekeeper) không hiện đủ: {r["gk"]} {r.get("gkSteps")} {r["gkSummaryH"]}')
            if kind != 'ios' and 'mac' not in r['detected']: bad.append(f'{k}: Mac không được nhận ra ({r["detected"]})')
        else:
            if r['macLinks']: bad.append(f'{k}: {kind} mà hiện tệp Mac')
        if kind == 'linux' and not r['lnote']: bad.append(f'{k}: Linux không hiện dòng “chỉ có cho Windows …”')
        if not (kind.startswith('mac') and mac_beta) and 'Windows' not in (r['heroText'] or ''): bad.append(f'{k}: link đầu trang chưa nói bản beta chỉ có cho Windows: {r["heroText"]}')
print('\n'.join(bad) if bad else f'KIỂM BỐ CỤC OK: {len(res)} cấu hình')
sys.exit(1 if bad else 0)
