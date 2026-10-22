#!/usr/bin/env python3
"""Thêm/cập nhật (hoặc gỡ) khối “Tải bản beta …” ngay dưới hàng nút tải bản ổn định trên trang web AIVN, đủ vi/en/zh.

Khối nằm giữa <!--AIVN-BETA--> … <!--/AIVN-BETA--> (chạy lại thì THAY, không nhân đôi); khoá dịch là "beta.1".
- Trang mẫu (site/index.html, có --i18n-dir site/i18n): ghi bản dịch vào site/i18n/{en,zh}.json rồi ghép như tools/site_i18n_build.py
  (release.sh dựng trang từ mẫu này nên khối beta không mất khi phát hành bản ổn định).
- Trang đang chạy (bản sao nhánh gh-pages, không có --i18n-dir): sửa thẳng từ điển /*I18N*/…/*END*/ trong trang.
Dùng: python3 tools/site_beta.py --html F --version 0.16.0-beta.2.8 --assets beta.json --stable stable.json [--i18n-dir site/i18n]
      (B174: khối theo hệ điều hành, dựng từ danh sách tài sản THẬT; cách cũ --url URL --sha256 HEX --size BYTES vẫn dùng được cho .exe)
      python3 tools/site_beta.py --html F --clear [--i18n-dir site/i18n]      # gỡ khối beta (vd. khi phát hành bản ổn định)
Cách làm đầy đủ (kiểm tài sản, đăng gh-pages, kiểm trang thật): tools/publish-beta-site.sh"""
import argparse, html as H, json, os, re, sys

ap = argparse.ArgumentParser()
ap.add_argument('--html', required=True); ap.add_argument('--i18n-dir'); ap.add_argument('--clear', action='store_true')
ap.add_argument('--version'); ap.add_argument('--url'); ap.add_argument('--sha256'); ap.add_argument('--size', type=int)
ap.add_argument('--assets', help='JSON tài sản thật của bản beta (gh release view TAG --json assets)'); ap.add_argument('--stable', help='JSON bản ổn định Latest: {"version":"0.15.3","assets":[…]} — tệp Mac cho máy Mac khi bản beta chưa có')
a = ap.parse_args()
page = open(a.html, encoding='utf-8').read()
START, END = '<!--AIVN-BETA-->', '<!--/AIVN-BETA-->'
page = re.sub(r'\n?' + re.escape(START) + r'.*?' + re.escape(END), '', page, flags=re.S)
# B152: link “Hoặc thử bản thử nghiệm …” ngay dưới hàng nút tải + câu nhắc trong huy hiệu phiên bản (hero.1) — cập nhật/gỡ cùng khối beta
HSTART, HEND, BSTART, BEND = '<!--AIVN-BETA-HERO-->', '<!--/AIVN-BETA-HERO-->', '<!--AIVN-BETA-BADGE-->', '<!--/AIVN-BETA-BADGE-->'
unbadge = lambda t: re.sub(re.escape(BSTART) + r'.*?' + re.escape(BEND), '', t, flags=re.S)
page = re.sub(r'\n?' + re.escape(HSTART) + r'.*?' + re.escape(HEND), '', page, flags=re.S)
page = unbadge(page)

T = None
def asset_list(path):
    """Danh sách tài sản THẬT của release: JSON của `gh release view --json assets` (hoặc mảng) → [{name,size,sha256,url}]."""
    j = json.load(open(path, encoding='utf-8')); arr = j.get('assets', []) if isinstance(j, dict) else j
    out = []
    for x in arr:
        sha = (x.get('digest') or x.get('sha256') or '').replace('sha256:', '')
        out.append({'name': x['name'], 'size': int(x['size']), 'sha256': sha, 'url': x.get('url') or x.get('browser_download_url')})
    return out
def pick(assets, rx):
    m = [x for x in assets if re.fullmatch(rx, x['name'])]
    return m[0] if m else None
def check_asset(x, what):
    if not re.fullmatch(r'[0-9a-f]{64}', x['sha256'] or ''): sys.exit(f'{what}: thiếu SHA-256 ({x["name"]})')
    if not (x['url'] or '').startswith('https://github.com/') or '/releases/download/' not in x['url']: sys.exit(f'{what}: URL phải là tài sản trực tiếp trên GitHub Releases ({x["url"]})')
if not a.clear:
    if a.assets:  # B174: dựng khối từ danh sách tài sản thật của bản beta (Windows .exe, Mac arm64/x64 .zip)
        A = asset_list(a.assets); v0 = re.escape(a.version or '')
        exe = pick(A, r'AIVN-Setup-' + v0 + r'\.exe')
        if not exe: sys.exit('bản beta không có AIVN-Setup-<phiên bản>.exe')
        a.url, a.sha256, a.size = exe['url'], exe['sha256'], exe['size']
        MACB = {arch: pick(A, f'AIVN-{v0}-{arch}-mac\\.zip') for arch in ('arm64', 'x64')}
        if any(MACB.values()) and not all(MACB.values()): sys.exit('bản beta chỉ có MỘT trong hai tệp Mac (arm64/x64) — phải có đủ cả hai')
        if not all(MACB.values()): MACB = None
        for x in (MACB or {}).values(): check_asset(x, 'tệp Mac của bản beta')
    else: MACB = None
    STABLE = None   # bản ổn định (Latest) cho máy Mac khi bản beta chưa có tệp Mac
    if a.stable:
        sj = json.load(open(a.stable, encoding='utf-8')); sv = sj.get('version') or sj.get('tagName', '').lstrip('v'); SA = asset_list(a.stable)
        STABLE = {'version': sv, **{arch: pick(SA, f'AIVN-{re.escape(sv)}-{arch}-mac\\.zip') for arch in ('arm64', 'x64')}}
        if not (re.fullmatch(r'\d+\.\d+\.\d+', sv) and STABLE['arm64'] and STABLE['x64']): sys.exit('bản ổn định thiếu phiên bản hoặc tệp Mac arm64/x64')
        for arch in ('arm64', 'x64'): check_asset(STABLE[arch], 'tệp Mac của bản ổn định')
    if not (a.version and a.url and a.sha256 and a.size): sys.exit('cần --version và (--assets hoặc --url --sha256 --size), hoặc --clear')
    if not re.fullmatch(r'\d+\.\d+\.\d+-beta[0-9.]*', a.version): sys.exit('phiên bản beta không hợp lệ: ' + a.version)
    if not re.fullmatch(r'[0-9a-f]{64}', a.sha256): sys.exit('SHA-256 phải là 64 ký tự hex thường')
    if not a.url.startswith('https://github.com/') or '/releases/download/' not in a.url: sys.exit('URL phải là tài sản trực tiếp trên GitHub Releases')
    mb = round(a.size / 1e6); u = H.escape(a.url, quote=True); v = H.escape(a.version)
    nv = f'<span class="nw">{v}</span>'
    MBs = lambda x, l: ('约 ' if l == 'zh' else '~') + f'{round(x["size"] / 1e6)} MB'
    # B148: vùng bấm ≥ 44 px; B146: “SHA-256” và số phiên bản không bị ngắt ở dấu gạch; B143: trên điện thoại hiện dòng “chỉ cho Windows”
    link = lambda label, size: f'<a class="beta-link" href="{u}" rel="noopener">🧪 {label} <span class="beta-size">· {size}</span></a>'
    sha = lambda lab: f'<span class="nw">{lab}</span>' + ('' if lab.endswith('：') else ' ') + f'<code class="beta-sha">{a.sha256}</code>'
    mnote = lambda t: f'<span class="beta-mnote">📱 {t}</span>'
    # B174: chữ theo hệ điều hành — Windows thấy .exe; Mac thấy tệp Mac (bản beta nếu có, nếu không thì bản ổn định) + cách mở lần đầu; điện thoại/Linux không được mời tải .exe
    ARCH = {'vi': {'arm64': 'Mac Apple Silicon (chip M1, M2, M3, M4…)', 'x64': 'Mac Intel'},
            'en': {'arm64': 'Mac with Apple silicon (M1, M2, M3, M4… chips)', 'x64': 'Intel Mac'},
            'zh': {'arm64': 'Apple 芯片 Mac：M1、M2、M3、M4…', 'x64': 'Intel 芯片 Mac'}}
    HINT = {'vi': 'Không chắc máy mình dùng chip gì? Bấm logo Apple ở góc trên trái → Giới thiệu về máy Mac này: thấy “Chip Apple M…” là Apple Silicon, thấy “Bộ xử lý Intel” là Intel.',
            'en': 'Not sure which chip your Mac has? Click the Apple menu → About This Mac: “Chip Apple M…” means Apple silicon, “Processor Intel” means Intel.',
            'zh': '不确定你的 Mac 用哪种芯片？点按左上角的苹果菜单 →“关于本机”：显示“芯片 Apple M…”即为 Apple 芯片，显示“处理器 Intel”即为 Intel。'}
    def maclinks(l, files, beta):
        out = []
        for arch in ('arm64', 'x64'):
            x = files[arch]; lab = (f'Tải bản thử nghiệm {nv} cho {ARCH[l][arch]}' if l == 'vi' else f'Download the {nv} beta for {ARCH[l][arch]}' if l == 'en' else f'下载 {nv} 测试版（{ARCH[l][arch]}）') if beta else \
                  (f'Tải bản ổn định {STABLE["version"]} cho {ARCH[l][arch]}' if l == 'vi' else f'Download stable {STABLE["version"]} for {ARCH[l][arch]}' if l == 'en' else f'下载稳定版 {STABLE["version"]}（{ARCH[l][arch]}）')
            out.append(f'<a class="beta-link beta-mac-link" data-arch="{arch}" href="{H.escape(x["url"], quote=True)}" rel="noopener">{"🧪" if beta else "⬇"} {lab} <span class="beta-size">· {MBs(x, l)}</span></a>')
        return ''.join(out) + f'<span class="beta-archhint">{HINT[l]}</span>'
    # Gatekeeper: bản Mac chỉ ký ad-hoc, chưa công chứng (notarize) với Apple → lần đầu phải cho phép mở (macOS 15 không còn cách nhấp phải → Mở)
    GK = {'vi': ('🔒 Lần đầu mở AIVN trên Mac (ứng dụng chưa được Apple công chứng)',
                 ['Mở tệp .zip vừa tải (Safari thường tự giải nén), rồi kéo <b>AIVN</b> vào thư mục <b>Ứng dụng</b>.',
                  'Mở AIVN. Nếu macOS báo không thể xác minh AIVN, bấm <b>Xong</b> (đừng bấm Chuyển vào Thùng rác).',
                  'Mở <b>Cài đặt hệ thống › Quyền riêng tư &amp; Bảo mật</b>, kéo xuống phần <b>Bảo mật</b>, bấm <b>Vẫn mở</b> cạnh dòng nói về AIVN, nhập mật khẩu máy Mac rồi bấm <b>Vẫn mở</b> lần nữa.',
                  'Trên macOS 13 và 14 cũng có thể làm nhanh: trong thư mục Ứng dụng, nhấp phải (hoặc giữ Control và bấm) vào AIVN, chọn <b>Mở</b>, rồi bấm <b>Mở</b>. Từ macOS 15, cách này không còn tác dụng, hãy dùng bước 3.'],
                 'Chỉ cần làm một lần. Nếu macOS báo “AIVN bị hỏng”, mở Terminal, chạy <code>xattr -dr com.apple.quarantine /Applications/AIVN.app</code> rồi mở lại AIVN.'),
          'en': ('🔒 Opening AIVN on a Mac for the first time (the app is not notarized by Apple)',
                 ['Open the downloaded .zip (Safari usually unzips it for you), then drag <b>AIVN</b> into your <b>Applications</b> folder.',
                  'Open AIVN. If macOS says it can’t verify AIVN, click <b>Done</b> (not Move to Trash).',
                  'Open <b>System Settings › Privacy &amp; Security</b>, scroll down to <b>Security</b>, click <b>Open Anyway</b> next to the message about AIVN, enter your Mac password, then click <b>Open Anyway</b> again.',
                  'On macOS 13 and 14 there is a shortcut: in Applications, right-click (or Control-click) AIVN, choose <b>Open</b>, then click <b>Open</b>. From macOS 15 this no longer works, so use step 3.'],
                 'You only need to do this once. If macOS says “AIVN is damaged”, open Terminal, run <code>xattr -dr com.apple.quarantine /Applications/AIVN.app</code>, then open AIVN again.'),
          'zh': ('🔒 在 Mac 上首次打开 AIVN（此应用未经 Apple 公证）',
                 ['打开下载的 .zip 文件（Safari 通常会自动解压），然后把 <b>AIVN</b> 拖到“<b>应用程序</b>”文件夹。',
                  '打开 AIVN。如果 macOS 提示无法验证 AIVN，请点按“<b>完成</b>”（不要点“移到废纸篓”）。',
                  '打开“<b>系统设置 › 隐私与安全性</b>”，向下滚动到“<b>安全性</b>”，点按关于 AIVN 的提示旁边的“<b>仍要打开</b>”，输入 Mac 登录密码，然后再次点按“<b>仍要打开</b>”。',
                  '在 macOS 13 和 14 上也可以更快：在“应用程序”中按住 Control 键点按（或右键点按）AIVN，选择“<b>打开</b>”，再点按“<b>打开</b>”。从 macOS 15 起此方法已失效，请使用第 3 步。'],
                 '只需操作一次。如果 macOS 提示“AIVN 已损坏”，请打开“终端”，运行 <code>xattr -dr com.apple.quarantine /Applications/AIVN.app</code>，然后重新打开 AIVN。')}
    gk = lambda l: f'<details class="beta-gk"><summary>{GK[l][0]}</summary><ol>' + ''.join(f'<li>{x}</li>' for x in GK[l][1]) + f'</ol><span class="beta-gk-note">{GK[l][2]}</span></details>'
    ONLYWIN = {'vi': 'Bản thử nghiệm hiện chỉ có cho Windows.', 'en': 'The beta is currently available for Windows only.', 'zh': '测试版目前仅提供 Windows 版本。'}
    MACSTABLE = {'vi': f'Trên Mac, bạn hãy dùng bản ổn định {STABLE["version"] if STABLE else ""}:', 'en': f'On a Mac, please use the stable version {STABLE["version"] if STABLE else ""}:',
                 'zh': f'在 Mac 上请使用稳定版 {STABLE["version"] if STABLE else ""}：'}
    MACNOSTABLE = {'vi': 'Trên Mac, hãy dùng nút macOS của bản ổn định ở trên.', 'en': 'On a Mac, use the stable macOS button above.', 'zh': '在 Mac 上请使用上方稳定版的 macOS 按钮。'}
    def macsec(l):
        if MACB: body = maclinks(l, MACB, True)
        elif STABLE: body = f'<span class="beta-onlywin">ℹ️ {ONLYWIN[l]}</span><span class="beta-macstable">{MACSTABLE[l]}</span>' + maclinks(l, STABLE, False)
        else: body = f'<span class="beta-onlywin">ℹ️ {ONLYWIN[l]}</span><span class="beta-macstable">{MACNOSTABLE[l]}</span>'
        return f'<div class="beta-sec beta-mac">{body}{gk(l) if (MACB or STABLE) else ""}</div>'
    LNOTE = {'vi': ('Bản thử nghiệm hiện chỉ có cho Windows và Mac.' if MACB else ONLYWIN['vi']) + ' AIVN chưa có bản cho Linux.',
             'en': ('The beta is currently available for Windows and Mac only.' if MACB else ONLYWIN['en']) + ' AIVN is not available for Linux yet.',
             'zh': ('测试版目前仅提供 Windows 和 Mac 版本。' if MACB else ONLYWIN['zh']) + 'AIVN 暂无 Linux 版本。'}
    MNOTE = {'vi': ('Bản này cài được trên máy tính Windows và Mac.' if MACB else 'Bản thử nghiệm hiện chỉ có cho Windows.') + ' Hãy mở trang này trên máy tính để tải.',
             'en': ('This beta installs on Windows PCs and Macs.' if MACB else 'The beta is currently available for Windows only.') + ' Open this page on a computer to download it.',
             'zh': ('此测试版可安装在 Windows 电脑和 Mac 上。' if MACB else '测试版目前仅提供 Windows 版本。') + '请在电脑上打开本页下载。'}
    SHALAB = {'vi': {'arm64': 'Mac Apple Silicon', 'x64': 'Mac Intel'}, 'en': {'arm64': 'Mac Apple silicon', 'x64': 'Intel Mac'}, 'zh': {'arm64': 'Apple 芯片 Mac', 'x64': 'Intel 芯片 Mac'}}
    colon = lambda l: '：' if l == 'zh' else ':'
    shas = lambda l: ('' if l == 'zh' else ' ') + (f'<span class="nw">SHA-256 Windows{colon(l)}</span> <code class="beta-sha">{a.sha256}</code>' if MACB else sha('SHA-256' + colon(l))) + \
                     ''.join(f' <span class="nw">SHA-256 {SHALAB[l][arch]}{colon(l)}</span> <code class="beta-sha">{MACB[arch]["sha256"]}</code>' for arch in ('arm64', 'x64') if MACB)
    WARN = {'vi': '⚠ Bản thử nghiệm có thể còn lỗi và không tự cập nhật. Nếu dùng hằng ngày, bạn nên chọn bản ổn định ở trên.',
            'en': '⚠ Beta: it may still have bugs and does not update automatically. For everyday use, choose the stable version above.',
            'zh': '⚠ 测试版可能仍有错误，也不会自动更新。日常使用请选择上方的稳定版。'}
    WINLAB = {'vi': (f'Tải bản thử nghiệm {nv} cho Windows', f'~{mb} MB'), 'en': (f'Download the {nv} beta for Windows', f'~{mb} MB'), 'zh': (f'下载 {nv} 测试版（Windows）', f'约 {mb} MB')}
    # B144/B145: lời theo góp ý QA — không lặp “beta”, zh không dùng 试用版, vi có “Nếu”
    T = {l: f'<div class="beta-sec beta-win">{link(*WINLAB[l])}</div>' + macsec(l) + mnote(MNOTE[l]) + f'<span class="beta-lnote">🐧 {LNOTE[l]}</span>'
            + f'<small>{WARN[l]}{shas(l)}</small>' for l in ('vi', 'en', 'zh')}
    css = ('<style>.beta-dl{margin-top:.6rem;padding:.35rem .8rem .55rem;border:1px dashed var(--muted);border-radius:10px;max-width:46rem;line-height:1.6;overflow-wrap:anywhere}'
           '.beta-dl .beta-link{display:block;min-height:44px;padding:.55rem 0;line-height:1.5;box-sizing:border-box;font-weight:600;color:var(--accent)}.beta-dl .beta-size{font-weight:400;color:var(--muted);white-space:nowrap}'
           '.beta-dl .nw{white-space:nowrap}.beta-dl small{display:block}.beta-dl .beta-sha{word-break:break-all;font-size:.82em}'
           '.beta-dl .beta-mnote{display:none;font-weight:600}html.is-mobile .beta-dl .beta-mnote{display:block}'
           'html.is-mobile .beta-dl .beta-link{color:var(--muted)}.beta-dl .beta-mnote.flash{color:var(--accent)}</style>')
    # B174: khối theo hệ điều hành. Chưa biết máy (tắt JS…) → hiện cả Windows lẫn Mac. Mac/iPhone/iPad/Android/Linux không bao giờ thấy link .exe.
    css = css.replace('</style>', '.beta-dl .beta-sec{display:block}.beta-dl .beta-onlywin{display:block;font-weight:600;padding-top:.35rem}.beta-dl .beta-macstable,.beta-dl .beta-archhint{display:block;font-size:.88em;color:var(--muted)}'
                      '.beta-dl .beta-lnote{display:none;font-weight:600}.beta-dl .beta-gk{margin:.2rem 0 .4rem;font-size:.9em}.beta-dl .beta-gk summary{cursor:pointer;min-height:44px;padding:.55rem 0;box-sizing:border-box;font-weight:600}'
                      '.beta-dl .beta-gk ol{margin:.2rem 0 .3rem 1.2rem;padding:0}.beta-dl .beta-gk li{margin:.15rem 0}.beta-dl .beta-gk-note{display:block;color:var(--muted)}.beta-dl .beta-gk code{word-break:break-all}'
                      'html.beta-os-mac .beta-dl .beta-win,html.is-mobile .beta-dl .beta-win,html.beta-os-linux .beta-dl .beta-win{display:none}'
                      'html.beta-os-win .beta-dl .beta-mac,html.beta-os-linux .beta-dl .beta-mac,html.beta-os-android .beta-dl .beta-mac{display:none}'
                      'html.beta-os-linux .beta-dl .beta-lnote{display:block}html.is-mobile .beta-dl .beta-mac .beta-link{color:var(--accent)}'
                      'html.beta-arch-arm64 .beta-dl .beta-mac-link[data-arch=x64],html.beta-arch-x64 .beta-dl .beta-mac-link[data-arch=arm64],html.beta-arch-arm64 .beta-dl .beta-archhint,html.beta-arch-x64 .beta-dl .beta-archhint{display:none}'
                      '.beta-hero .bh-nowin{display:none}html.beta-nowin .beta-hero .bh-any{display:none}html.beta-nowin .beta-hero .bh-nowin{display:inline}</style>')
    # B143: điện thoại/máy tính bảng (kể cả iPad báo “MacIntel”) → không tải tệp .exe, chỉ nhắc dòng “chỉ cho Windows”
    # B174: nhận hệ điều hành cho khối beta + link đầu trang; chip Mac chỉ biết chắc qua User-Agent Client Hints (Chrome/Edge) — Safari không cho biết → để người dùng chọn
    nowin = '"mac":' + ('0' if MACB else '1') + ',"ios":1,"android":1,"linux":1'
    js = ('<script>(function(){var d=document.documentElement,n=navigator,u=n.userAgent||"",c=n.userAgentData,p=((c&&c.platform)||n.platform||"").toLowerCase();'
          'var ios=/iphone|ipad|ipod/i.test(u)||(/mac/.test(p)&&n.maxTouchPoints>1),mob=ios||/android|mobile/i.test(u)||!!(c&&c.mobile);'
          'var bos=mob?(ios?"ios":"android"):/win/.test(p)?"win":/mac/.test(p)?"mac":/linux|x11|cros/.test(p)?"linux":"";'
          'if(mob)d.classList.add("is-mobile");if(bos)d.classList.add("beta-os-"+bos);if({' + nowin + '}[bos])d.classList.add("beta-nowin");'
          'if(bos==="mac"&&c&&c.getHighEntropyValues)c.getHighEntropyValues(["architecture"]).then(function(v){var a=v&&v.architecture==="arm"?"arm64":v&&v.architecture==="x86"?"x64":"";if(a)d.classList.add("beta-arch-"+a);}).catch(function(){});'
          'document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest(".beta-dl .beta-win .beta-link");if(!a||!(mob||bos==="mac"||bos==="linux"))return;'
          'e.preventDefault();var m=a.closest(".beta-dl").querySelector(".beta-mnote");if(m){m.classList.add("flash");m.scrollIntoView({block:"nearest"});}},true);})();</script>')
    css = css.replace('</style>', '#tai-beta{scroll-margin-top:calc(var(--hdr,68px) + 16px)}'
                      '.beta-hero{margin:.5rem 0 .2rem}.beta-hero .nw{white-space:nowrap}.badge{display:inline-block;line-height:1.5}.badge .dot{display:inline-block;vertical-align:middle;margin-right:8px}.badge .nw{white-space:nowrap}.beta-hero a{display:inline-block;min-height:44px;padding:.6rem 0;line-height:1.5;box-sizing:border-box;font-weight:600;color:var(--accent);text-decoration:underline;text-underline-offset:3px}</style>')
    block = (f'\n{START}{css}<div class="hero-note beta-dl" id="tai-beta" data-i18n="beta.1" data-beta-version="{v}" data-beta-mac="{"1" if MACB else "0"}">{T["vi"]}</div>{js}{END}')
    # B145 (QA web beta.2.8): không lặp “beta” — số phiên bản đã có chữ beta. B174: máy không có tệp của bản beta (Mac khi chưa có, điện thoại, Linux) thấy câu “chỉ có cho Windows …”
    NOWIN = {'vi': f'🧪 Bản thử nghiệm {nv} hiện chỉ có cho Windows' + (' và Mac' if MACB else '') + ' →',
             'en': f'🧪 Test version {nv} is for Windows' + (' and Mac' if MACB else '') + ' only →',
             'zh': f'🧪 测试版 {nv} 目前仅支持 Windows' + (' 和 Mac' if MACB else '') + ' →'}
    ANY = {'vi': f'🧪 Hoặc thử bản thử nghiệm {nv} →', 'en': f'🧪 Or try the test version {nv} →', 'zh': f'🧪 或者试试测试版 {nv} →'}
    H2 = {l: f'<a href="#tai-beta"><span class="bh-any">{ANY[l]}</span><span class="bh-nowin">{NOWIN[l]}</span></a>' for l in ('vi', 'en', 'zh')}
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
