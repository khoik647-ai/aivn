"""Kiểm bố cục trang web AIVN (B143–B150, B162, B174, B183, B185, B186) ở 280/320/375/810/820/1280 px và dải 768–900 px × vi/en/zh bằng Playwright + Chrome. Thoát 1 nếu có lỗi.
Một nút “Tải AIVN bản mới nhất” (#tai-ve .dl): API GitHub /releases được giả bằng dữ liệu thật trong test/fixtures/site-releases-api.json
(bỏ bản nháp như khi khách không đăng nhập xem). Kiểm: chọn đúng tệp theo máy (Windows → .exe, Mac → .zip đúng chip, không biết chip → Apple Silicon
+ link “Mac dùng chip Intel?”, Linux → nút chính trỏ trang Releases + ghi chú “chưa có bản Linux”, không có .exe), điện thoại/máy tính bảng không thấy link .exe/.zip nào (chỉ nút “Gửi link”),
hướng dẫn mở lần đầu trên Mac (Gatekeeper “Vẫn mở”/“Open Anyway”, 4 bước) vẫn còn, và khi API lỗi (403/giới hạn) nút giữ link tĩnh + link trang releases.
Dùng: python tools/site_check.py URL out.json [thư-mục-ảnh]"""
import sys, json, re, os
from playwright.sync_api import sync_playwright
URL = sys.argv[1]; OUT = sys.argv[2]; SHOTS = sys.argv[3] if len(sys.argv) > 3 else None
CREDIT = 'NGUYỄN NGỌC KHÔI SINH VIÊN VLU'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'test', 'fixtures', 'site-releases-api.json')
API_BODY = json.dumps([r for r in json.load(open(FIX, encoding='utf-8')) if not r['draft']])
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
def exercise_cta(pg):
    """Mở .mac-toggle nếu còn, bấm mọi nút nhìn thấy trong .cta, rồi bắt đường tải trùng.
    Cuộn mượt làm el.click chờ quá 3 giây; dispatch_event không chờ trang đứng yên.
    Mọi href được chuẩn hoá bằng new URL(h, location.href). Href trông như tệp tải
    (đuôi exe/zip/dmg/msi/pkg/AppImage, hoặc đường dẫn có /releases/) phải có origin
    https://github.com và pathname bắt đầu bằng /khoik647-ai/aivn/releases/.
    Tên tệp cùng trang, không scheme không / không .., vẫn là bản tĩnh dự phòng.
    Lỗi nếu đường tải không thuộc kho, lặp lại, hoặc thuộc tính download nằm ngoài #tai-ve."""
    pg.evaluate("() => { document.documentElement.style.scrollBehavior = 'auto'; }")
    for sel in ('.mac-toggle', '.cta a', '.cta button:not(.mac-toggle)'):
        loc = pg.locator(sel)
        for i in range(loc.count()):
            el = loc.nth(i)
            if el.is_visible():
                el.dispatch_event('click', {'bubbles': True, 'cancelable': True})
    return pg.evaluate(r'''() => {
      /*AIVN-DL-FN*/
      function aivnDl(h, base) {
        const ASSET = /\.(exe|zip|dmg|msi|pkg|AppImage)(\?|#|$)/i;
        let u;
        try { u = new URL(h, base); } catch (e) { return {looks: true, ok: false}; }
        const raw = String(h || '');
        const path = u.pathname || '';
        const looks = ASSET.test(raw) || ASSET.test(path) || raw.indexOf('/releases/') >= 0 || path.indexOf('/releases/') >= 0;
        if (!looks) return {looks: false, ok: true};
        if (u.origin === 'https://github.com' && path.startsWith('/khoik647-ai/aivn/releases/')) return {looks: true, ok: true};
        const file = raw.split(/[?#]/)[0];
        const leaf = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && raw.indexOf('//') !== 0 && file.indexOf('..') < 0 && file.indexOf('/') < 0 && file.indexOf('\\') < 0 && ASSET.test(file);
        if (leaf && u.origin === new URL(base).origin) return {looks: true, ok: true};
        return {looks: true, ok: false};
      }
      /*END-AIVN-DL-FN*/
      const shown = el => { for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
      const groups = {};
      const outside = [];
      const foreign = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const h = a.getAttribute('href') || '';
        const attr = a.hasAttribute('download');
        const v = aivnDl(h, location.href);
        if (v.looks && !v.ok) { foreign.push(h); return; }
        if (!v.looks && !attr) return;
        (groups[h] = groups[h] || []).push(a);
        if (!a.closest('#tai-ve')) outside.push(h || a.tagName);
      });
      const dup = Object.keys(groups).filter(h => {
        const list = groups[h];
        const visible = list.filter(shown).length;
        const outsideN = list.filter(a => !a.closest('#tai-ve')).length;
        return visible > 1 || outsideN > 1 || (outsideN > 0 && list.length > 1);
      });
      const attrOut = [...document.querySelectorAll('[download]')].filter(el => !el.closest('#tai-ve')).map(el => el.getAttribute('href') || el.tagName);
      return {dup, outside, attr: attrOut, foreign};
    }''')
# (tên, Playwright context, init script, loại máy)
CONF = [('fold-280', dict(viewport={'width': 280, 'height': 653}, user_agent=AND, is_mobile=True, has_touch=True, device_scale_factor=2), nav('Linux armv8l', 5), 'android'),  # B162
        ('iphoneSE-320', dict(viewport={'width': 320, 'height': 568}, user_agent=IPH, is_mobile=True, has_touch=True, device_scale_factor=2), nav('iPhone', 5), 'ios'),
        ('iphone-375', dict(viewport={'width': 375, 'height': 667}, user_agent=IPH, is_mobile=True, has_touch=True, device_scale_factor=2), nav('iPhone', 5), 'ios'),
        ('android-320', dict(viewport={'width': 320, 'height': 640}, user_agent=AND, is_mobile=True, has_touch=True), nav('Linux armv8l', 5), 'android'),
        ('ipad-810', dict(viewport={'width': 810, 'height': 1080}, user_agent='Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', is_mobile=True, has_touch=True, device_scale_factor=2), nav('iPad', 5), 'ios'),  # B186
        ('ipados-mac-820', dict(viewport={'width': 820, 'height': 1180}, user_agent=SAF, is_mobile=True, has_touch=True, device_scale_factor=2), nav('MacIntel', 5), 'ios'),  # B186: iPadOS báo Macintosh + cảm ứng
        ('mac-safari-arm64-1280', dict(viewport=D1280, user_agent=SAF), nav('MacIntel'), 'mac'),        # B174: Mac M… dùng Safari (không biết chip)
        ('mac-safari-intel-1280', dict(viewport=D1280, user_agent=SAF), nav('MacIntel'), 'mac'),        # B174: Mac Intel dùng Safari
        ('mac-chrome-arm64-1280', dict(viewport=D1280, user_agent=MCH), nav('MacIntel', 0, ('macOS', 'arm')), 'mac-arm64'),
        ('linux-1280', dict(viewport=D1280, user_agent=LNX), nav('Linux x86_64'), 'linux'),
        ('desktop-1280', dict(viewport=D1280, user_agent=WIN), nav('Win32', 0, ('Windows', 'x86')), 'win'),
        ('desktop-1280-apifail', dict(viewport=D1280, user_agent=WIN), nav('Win32', 0, ('Windows', 'x86')), 'win'),      # API 403 → link tĩnh
        ('mac-safari-1280-apifail', dict(viewport=D1280, user_agent=SAF), nav('MacIntel'), 'mac'),
        ('linux-1280-apifail', dict(viewport=D1280, user_agent=LNX), nav('Linux x86_64'), 'linux'),
        ('android-390-apifail', dict(viewport={'width': 390, 'height': 844}, user_agent=AND, is_mobile=True, has_touch=True), nav('Linux armv8l', 5), 'android')]
JS = r'''() => {
 const d=document.documentElement, cw=d.clientWidth, off=[];
 const vis=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().height>0);
 const H=e=>Math.round(e.getBoundingClientRect().height);
 document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect(); if(r.width&&r.right>cw+0.5&&getComputedStyle(e).position!=='fixed'||(r.width&&r.right>cw+0.5&&e.closest('.mobile-menu.open'))) off.push((e.tagName+'.'+e.className).slice(0,40)+':'+Math.round(r.right));});
 const row=document.getElementById('tai-ve'), main=row&&row.querySelector('a.dl-main'), share=row&&row.querySelector('.dl-share');
 const binVis=[...document.querySelectorAll('a[href]')].filter(vis).map(a=>a.getAttribute('href')).filter(h=>/\.(exe|zip)(\?|#|$)/i.test(h));
 const ctrls=[...row.querySelectorAll('a,button,summary')].filter(vis).map(e=>({t:(e.innerText||'').trim().slice(0,30),h:H(e)}));
 const gk=document.querySelector('#mo-tren-mac details.dl-gk'), foot=document.querySelector('footer').innerText;
 const hdr=document.querySelector('header .nav-cta a.btn');
 return {lang:d.lang, sw:d.scrollWidth, cw, overflow:d.scrollWidth>cw, off:off.slice(0,8), mobileCls:d.classList.contains('is-mobile'),
  single:document.querySelectorAll('a.dl-main').length, betaBlock:!!document.querySelector('.beta-dl,#tai-beta'),
  state:row.dataset.state, os:row.dataset.os, t:row.dataset.t, arch:row.dataset.arch, pre:row.dataset.pre,
  mainVis:vis(main), mainH:vis(main)?H(main):null, mainHref:main.getAttribute('href'), mainText:vis(main)?main.innerText.trim():'',
  sub:vis(row.querySelector('.dl-sub'))?row.querySelector('.dl-sub').innerText.trim():'', ver:row.querySelector('.dl-ver').textContent,
  beta:vis(row.querySelector('.dl-beta')), failLink:[...row.querySelectorAll('.dl-s-fail a')].filter(vis).map(a=>a.getAttribute('href')),
  intelq:vis(row.querySelector('.o-intelq')), lnx:vis(row.querySelector('.dl-lnx')), hint:vis(row.querySelector('.dl-hint')), gkLink:vis(row.querySelector('.dl-gklink')),
  other:[...row.querySelectorAll('.dl-other a')].filter(vis).map(a=>a.dataset.k+' '+a.getAttribute('href')),
  shareVis:vis(share), shareH:vis(share)?H(share):null, mobnote:vis(row.querySelector('.dl-mobnote')),
  ctrls, binVis, ctaHrefs:[...document.querySelectorAll('.cta .dl-row a[href]')].map(a=>a.getAttribute('href')),
  gk:!!gk, gkSteps:gk?gk.querySelectorAll('li').length:0, gkText:gk?gk.textContent:'', gkSummaryH:gk&&vis(gk.querySelector('summary'))?H(gk.querySelector('summary')):null,
  hdrHref:hdr?hdr.getAttribute('href'):null, raw:/__MB_|__SHA|__VER/.test(document.body.innerText)||[...document.querySelectorAll('[title]')].some(e=>/__MB_/.test(e.title)),
  stableWin:[...document.querySelectorAll('.dl-row .dl-btn[data-os=windows]')].filter(vis).map(a=>a.getAttribute('href')),
  stableMac:[...document.querySelectorAll('.cta .dl-btn[data-os=mac]')].filter(vis).length,
  ctaWinTitle:((document.querySelector('.cta [data-os=windows]')||{}).getAttribute&&document.querySelector('.cta [data-os=windows]').getAttribute('title'))||'',
  dlNotes:[...document.querySelectorAll('.dl-mnote')].filter(vis).map(e=>e.innerText.trim()),
  outsideOverflow:[...document.querySelectorAll('body *')].some(e=>!e.closest('header')&&e.getBoundingClientRect().width&&e.getBoundingClientRect().right>cw+0.5&&getComputedStyle(e).position!=='fixed'&&getComputedStyle(e).display!=='none'),
  creditCount:(foot.match(/NGUYỄN NGỌC KHÔI SINH VIÊN VLU/g)||[]).length, footPhone:(foot.match(/(Điện thoại|Phone|电话)[:：]?\s*[^\n]*/)||[''])[0],
  footSub:((document.querySelector('[data-i18n="footer.sub"]')||{}).innerText||'').trim(),
  heroText:(()=>{const a=document.querySelector('.beta-hero a');return a?a.innerText:'';})()};
}'''
res = []
bad_band = []
band_log = []
BAND = list(range(768, 901, 2))  # B185: 768, 780, 800, 810, 820, 834, 850, 880, 900 và mọi bước 2 px
CTA = {'vi': 'Tải miễn phí', 'en': 'Download free', 'zh': '免费下载'}
def api(c, fail):
    if fail: c.route('https://api.github.com/**', lambda rt: rt.fulfill(status=403, content_type='application/json', body='{"message":"API rate limit exceeded"}'))
    else: c.route('https://api.github.com/**', lambda rt: rt.fulfill(status=200, content_type='application/json', body=API_BODY))
with sync_playwright() as p:
    try: b = p.chromium.launch(channel='chrome')
    except Exception: b = p.chromium.launch()
    for name, kw, init, kind in CONF:
        for lang in ('vi', 'en', 'zh'):
            c = b.new_context(**kw); c.add_init_script(init); api(c, name.endswith('apifail')); pg = c.new_page(); reqs = []
            pg.on('request', lambda r: reqs.append(r.url) if re.search(r'\.(exe|zip)(\?|$)', r.url) else None)
            pg.on('download', lambda dl: (reqs.append('DOWNLOAD ' + dl.url), dl.cancel()))
            pg.goto(URL + ('&' if '?' in URL else '?') + 'lang=' + lang, wait_until='load'); pg.wait_for_timeout(900)
            r = pg.evaluate(JS); r['conf'] = name; r['kind'] = kind; r['apifail'] = name.endswith('apifail')
            # M8: nút “Tải miễn phí” ở đầu trang chỉ cuộn tới #tai-ve (không tải gì)
            hb = pg.locator('header .nav-cta a.btn')
            if hb.count() and hb.is_visible():
                hb.click(); pg.wait_for_timeout(1200)
                r['hdrScroll'] = pg.evaluate('()=>{const b=document.getElementById("tai-ve").getBoundingClientRect();return b.top>=0&&b.top<innerHeight}')
                pg.evaluate('()=>scrollTo(0,0)'); pg.wait_for_timeout(300)
            # B174: Mac → “Lần đầu mở AIVN trên Mac? Xem cách mở” mở phần hướng dẫn Gatekeeper, 4 bước hiện ra, không tải gì
            if r['gkLink']:
                pg.locator('#tai-ve .dl-gklink').click(); pg.wait_for_timeout(900)
                r['gkOpen'] = pg.evaluate('()=>{const g=document.querySelector("#mo-tren-mac details");return g.open&&[...g.querySelectorAll("li")].filter(e=>e.getClientRects().length).length}')
                r['gkSummaryH'] = pg.evaluate('()=>Math.round(document.querySelector("#mo-tren-mac summary").getBoundingClientRect().height)')
                pg.evaluate('()=>scrollTo(0,0)'); pg.wait_for_timeout(300)
            if kind in ('ios', 'android'):
                if kw['viewport']['width'] <= 760:  # trên iPad nút menu đang ẩn (chỉ hiện ≤ 760 px)
                    pg.click('#burger'); pg.wait_for_timeout(500); r['menuOpen'] = pg.evaluate('()=>({sw:document.documentElement.scrollWidth,mw:Math.round(document.querySelector("#mobileMenu").scrollWidth),cw:document.documentElement.clientWidth})'); pg.click('#burger'); pg.wait_for_timeout(400)
                    r['overflowAfter'] = pg.evaluate('()=>document.documentElement.scrollWidth>document.documentElement.clientWidth')
                note = pg.locator('.dl-mnote').first
                if note.count() and note.is_visible(): note.click()
            got = exercise_cta(pg)
            r['outsideBin'] = got['outside']; r['dupUrls'] = got['dup']; r['outsideAttr'] = got['attr']; r['foreign'] = got['foreign']
            r['afterUrl'] = pg.url; r['requests'] = list(reqs)
            if SHOTS: pg.locator('#tai-ve').scroll_into_view_if_needed(); pg.evaluate('()=>scrollTo(0,0)'); pg.screenshot(path=f'{SHOTS}/{name}-{lang}.png')
            res.append(r); c.close()
    # B185 (#45): 768–900 px, bước 2 px, vi/en/zh. Nút tải ở đầu trang không đẩy trang cuộn ngang và vẫn bấm tới #tai-ve.
    band_js = r'''() => {
      const d=document.documentElement, cw=d.clientWidth;
      const a=document.querySelector('header .nav-cta a.btn');
      const rc=a.getBoundingClientRect(), cs=getComputedStyle(a);
      const vis=!!(rc.width && cs.display!=='none' && cs.visibility!=='hidden');
      const hit=vis?document.elementFromPoint(Math.min(cw-2, rc.left+rc.width/2), rc.top+rc.height/2):null;
      return {sw:d.scrollWidth, cw, vis, left:rc.left, right:rc.right, h:rc.height, text:(a.innerText||'').replace(/\s+/g,' ').trim(),
        hit:!!(hit && (hit===a || a.contains(hit)))};
    }'''
    bc = b.new_context(viewport={'width': 900, 'height': 1000}, user_agent=LNX)
    bc.add_init_script(nav('Linux x86_64')); api(bc, False)
    bp = bc.new_page()
    for lang in ('vi', 'en', 'zh'):
        bp.goto(URL + ('&' if '?' in URL else '?') + 'lang=' + lang, wait_until='load')
        bp.evaluate('() => document.fonts.ready')
        bp.evaluate("() => { document.documentElement.style.scrollBehavior = 'auto'; }")
        for w in BAND:
            bp.set_viewport_size({'width': w, 'height': 1000})
            br = bp.evaluate(band_js)
            k = f'band-{w} {lang}'
            if br['sw'] > br['cw'] or br['right'] > br['cw'] + 0.5 or br['left'] < -0.5:
                bad_band.append(f'{k}: tràn ngang {br["sw"]}>{br["cw"]} nút {br["left"]:.0f}..{br["right"]:.0f}')
            if (not br['vis']) or br['text'] != CTA[lang] or (not br['hit']) or not (32 <= br['h'] <= 48):
                bad_band.append(f'{k}: nút tải đầu trang không bấm được {br["text"]!r} vis={br["vis"]} hit={br["hit"]} h={br["h"]:.0f}')
        bp.set_viewport_size({'width': 820, 'height': 1000})
        bp.locator('header .nav-cta a.btn').click()
        bp.wait_for_timeout(300)
        if not bp.evaluate('()=>{const e=document.getElementById("tai-ve"); if(!e) return false; const b=e.getBoundingClientRect(); return b.top<innerHeight && b.bottom>0}'):
            bad_band.append(f'band-820 {lang}: bấm nút đầu trang không tới #tai-ve')
        band_log.append(f'band {lang} 768..900 bước 2: {len(BAND)} bề rộng, nút “{CTA[lang]}” trong khung')
    bc.close()
    b.close()
json.dump(res, open(OUT, 'w'), ensure_ascii=False, indent=1)
for r in res:
    print(r['conf'], r['lang'], 'overflow' if r['overflow'] else 'ok', r['sw'], '/', r['cw'], r['off'][:3], 'mobile', r['mobileCls'], 'state', r['state'], 'os', r['os'], 't', r['t'],
          'main', (r['mainHref'] or '').split('/')[-1] if r['mainVis'] else '(ẩn)', r['mainH'], 'ver', r['ver'], 'beta', r['beta'], 'intelq', r['intelq'], 'share', r['shareH'],
          'bin', [h.split('/')[-1] for h in r['binVis']], 'gk', r['gkSteps'], r.get('gkOpen'), 'req', r['requests'], 'credit', r['creditCount'])

LABEL = {'vi': 'Điện thoại', 'en': 'Phone', 'zh-CN': '电话'}
WANT = {'win': 'AIVN-Setup-0.16.0-beta.3.exe', 'arm64': 'AIVN-0.16.0-beta.3-arm64-mac.zip'}  # dữ liệu mẫu: bản mới nhất (cờ INCLUDE_PRERELEASE=true) là v0.16.0-beta.3
STATIC = {'win': r'(^|/releases/latest/download/)AIVN-Setup\.exe$', 'mac': r'(^|/releases/latest/download/)AIVN-mac-arm64\.zip$'}
bad = []
for r in res:
    k = f"{r['conf']} {r['lang']}"; kind = r['kind']; fail = r['apifail']; phone = kind in ('ios', 'android')
    if r['overflow'] and not (r['cw'] > 760 and not r['outsideOverflow']): bad.append(f'{k}: tràn ngang {r["sw"]}>{r["cw"]}')
    if r.get('menuOpen') and r['menuOpen']['sw'] > r['menuOpen']['cw']: bad.append(f'{k}: mở menu bị tràn')
    if r.get('overflowAfter'): bad.append(f'{k}: tràn ngang sau khi mở menu')
    if r['single'] != 1 or r['betaBlock']: bad.append(f'{k}: phải có đúng một nút tải chính, không còn khối beta ({r["single"]}, beta={r["betaBlock"]})')
    if r.get('dupUrls'): bad.append(f'{k}: cùng một đường tải xuất hiện nhiều lần {r["dupUrls"]}')
    if r.get('outsideAttr'): bad.append(f'{k}: thuộc tính download nằm ngoài #tai-ve {r["outsideAttr"]}')
    if r.get('outsideBin'): bad.append(f'{k}: ngoài #tai-ve còn href tệp {r["outsideBin"]}')
    if r.get('foreign'): bad.append(f'{k}: đường tải không thuộc khoik647-ai/aivn {r["foreign"]}')
    win_title = {'vi': 'Xem bản tải cho Windows', 'en': 'See the Windows download', 'zh-CN': '查看 Windows 版下载'}.get(r['lang'])
    if win_title and r.get('ctaWinTitle') != win_title: bad.append(f'{k}: gợi ý nút Windows cuối trang “{r.get("ctaWinTitle")}”')
    # B145: chỉ khi khối beta còn trên trang (INCLUDE_PRERELEASE=false vẫn chèn khối đó). Nút tự động không có dòng này.
    if r.get('heroText') and r['heroText'].lower().count('beta') > 1: bad.append(f'{k}: link đầu trang lặp “beta”: {r["heroText"]}')  # B145
    if r['creditCount'] < 3: bad.append(f'{k}: dòng ghi công chỉ còn {r["creditCount"]}')
    if not r['footPhone'].startswith(LABEL.get(r['lang'], '?')): bad.append(f'{k}: nhãn điện thoại “{r["footPhone"]}”')
    if (r['lang'] != 'vi') != bool(r['footSub']): bad.append(f'{k}: phụ đề ghi công “{r["footSub"]}” (en/zh phải có, vi để trống)')
    if r['requests']: bad.append(f'{k}: mở trang/bấm nút đầu trang/hướng dẫn mà trình duyệt tải tệp {r["requests"]}')
    if r['raw']: bad.append(f'{k}: trang hiện chữ giữ chỗ (__MB_…)')
    if r['hdrHref'] != '#tai-ve' or r.get('hdrScroll') is False: bad.append(f'{k}: nút đầu trang phải là neo #tai-ve ({r["hdrHref"]}, cuộn={r.get("hdrScroll")})')
    small = [c for c in r['ctrls'] if c['h'] < 24]
    if small: bad.append(f'{k}: nút/link trong khối tải thấp hơn 24 px: {small}')
    if not r['gk'] or r['gkSteps'] != 4 or not re.search(r'Vẫn mở|Open Anyway|仍要打开', r['gkText']): bad.append(f'{k}: thiếu hướng dẫn mở lần đầu trên Mac (Gatekeeper, 4 bước): {r["gk"]} {r["gkSteps"]}')
    if r['state'] != ('fail' if fail else 'ok'): bad.append(f'{k}: trạng thái {r["state"]}, cần {"fail" if fail else "ok"}')
    if fail and not phone and r['failLink'] != ['https://github.com/khoik647-ai/aivn/releases']: bad.append(f'{k}: API lỗi mà không hiện link trang releases: {r["failLink"]}')
    if phone:  # B183/B186/M1: điện thoại và máy tính bảng không thấy link .exe/.zip nào; nút “Gửi link tải về máy tính” ≥ 44 px
        if not r['mobileCls'] or r['os'] != 'mobile': bad.append(f'{k}: điện thoại không được nhận ra ({r["os"]})')
        if r['binVis']: bad.append(f'{k}: điện thoại vẫn thấy link tải tệp {r["binVis"]}')
        if r['mainVis'] or not r['shareVis'] or (r['shareH'] or 0) < 44 or not r['mobnote']: bad.append(f'{k}: điện thoại: nút chính {r["mainVis"]}, nút gửi link {r["shareVis"]} {r["shareH"]} px, ghi chú {r["mobnote"]}')
        if re.search(r'\.(exe|zip)$', r['mainHref'] or ''): bad.append(f'{k}: nút chính (ẩn) vẫn trỏ tệp {r["mainHref"]}')
        if r['stableWin'] or r['stableMac']: bad.append(f'{k}: điện thoại vẫn hiện nút tải bản ổn định ở cuối trang')
        want = {'vi': '📱 Hãy mở trang này trên máy tính để tải.', 'en': '📱 Open this page on a computer to download it.', 'zh-CN': '📱 请在电脑上打开本页下载。'}[r['lang']]
        if want not in r['dlNotes']: bad.append(f'{k}: thiếu dòng 📱 {r["dlNotes"]!r}')
        continue
    if r['mobileCls'] or r['shareVis']: bad.append(f'{k}: máy tính mà hiện phần điện thoại')
    if not r['mainVis'] or (r['mainH'] or 0) < 44: bad.append(f'{k}: nút chính không hiện / thấp {r["mainH"]} px')
    if r['dlNotes'] or not r['stableWin'] or r['stableMac'] != 1: bad.append(f'{k}: hàng nút cuối trang đổi notes={r["dlNotes"]!r} win={r["stableWin"]} mac={r["stableMac"]}')
    if kind == 'win':
        if fail:
            if not re.search(STATIC['win'], r['mainHref']): bad.append(f'{k}: API lỗi mà nút chính không giữ link tĩnh AIVN-Setup.exe: {r["mainHref"]}')
        elif not r['mainHref'].endswith('/v0.16.0-beta.3/' + WANT['win']) or r['ver'] != 'v0.16.0-beta.3' or not r['beta']: bad.append(f'{k}: Windows: {r["mainHref"]} {r["ver"]} beta={r["beta"]}')
        if r['gkLink'] or r['intelq']: bad.append(f'{k}: Windows mà hiện phần Mac')
    elif kind in ('mac', 'mac-arm64'):
        if re.search(r'\.exe$', r['mainHref']): bad.append(f'{k}: {kind} vẫn được mời tải .exe: {r["mainHref"]}')  # B174
        if fail:
            if not re.search(STATIC['mac'], r['mainHref']): bad.append(f'{k}: API lỗi mà nút chính không giữ link tĩnh AIVN-mac-arm64.zip: {r["mainHref"]}')
        elif not r['mainHref'].endswith('/v0.16.0-beta.3/' + WANT['arm64']) or not r['beta']: bad.append(f'{k}: Mac: nút chính {r["mainHref"]} beta={r["beta"]} (không biết chip → Apple Silicon)')
        if (kind == 'mac') != r['intelq']: bad.append(f'{k}: link “Mac dùng chip Intel?” {"thiếu" if kind == "mac" else "thừa"}')
        if not r['gkLink'] or r.get('gkOpen') != 4 or (r.get('gkSummaryH') or 0) < 44: bad.append(f'{k}: Mac: hướng dẫn Gatekeeper không mở được từ khối tải: {r["gkLink"]} {r.get("gkOpen")} {r.get("gkSummaryH")}')
        if not fail and not any(o.startswith('x64 ') and o.endswith('/v0.16.0-beta.3/AIVN-0.16.0-beta.3-x64-mac.zip') for o in r['other']): bad.append(f'{k}: Mac: thiếu link bản Intel đúng release {r["other"]}')
    elif kind == 'linux':
        if re.search(r'\.(exe|zip)$', r['mainHref']): bad.append(f'{k}: {kind} vẫn được mời tải .exe: {r["mainHref"]}')  # B174
        # M2/QA2: Linux không bao giờ được mời tải .exe; nút chính → trang Releases, có ghi chú “chưa có bản Linux”, vẫn giữ link nhỏ Windows/Mac
        if r['mainHref'] != 'https://github.com/khoik647-ai/aivn/releases' or not r['lnx']: bad.append(f'{k}: Linux: nút chính phải trỏ trang Releases và hiện ghi chú chưa có bản Linux: {r["mainHref"]} lnx={r["lnx"]}')
        if not re.search(r'Xem các bản AIVN trên GitHub|See AIVN releases on GitHub|在 GitHub 查看 AIVN 各版本', r['mainText']): bad.append(f'{k}: Linux: nhãn nút chính “{r["mainText"]}”')
        if sorted(o.split(' ')[0] for o in r['other']) != ['arm64', 'win', 'x64']: bad.append(f'{k}: Linux: thiếu link nhỏ Windows/Mac {r["other"]}')
        if r['gkLink'] or r['intelq']: bad.append(f'{k}: Linux mà hiện phần Mac')
bad.extend(bad_band)
for line in band_log: print(line)
print('\n'.join(bad) if bad else f'KIỂM BỐ CỤC OK: {len(res)} lần chạy ({len(CONF)} cấu hình × vi/en/zh); dải 768–900 px × vi/en/zh ({len(BAND)} bề rộng) không tràn')
sys.exit(1 if bad else 0)
