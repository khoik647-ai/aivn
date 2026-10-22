#!/usr/bin/env python3
"""Chặn mất nội dung chỉ có trên gh-pages khi release.sh ghi đè trang web (sửa nóng như B68 chưa được chép vào site/).
Dùng: python3 tools/site_drift.py --rendered dist/site --live <bản clone nhánh gh-pages, CÓ lịch sử>
  - So 3 chiều: gốc = lần triển khai gần nhất của release.sh (commit “Trang web AIVN …”); nội dung chỉ-có-trên-trang-thật = dòng được THÊM
    trên gh-pages sau gốc đó (sửa nóng, site_fixes…). Mỗi dòng như vậy phải có trong trang dựng từ site/ (site/ mới hơn trang thật thì không sao).
  - Khối beta/hero/huy hiệu do tools/site_beta.py quản lý được gỡ khỏi bản sao trang thật trước khi so (đúng cách --clear).
  - Chữ số bị che ('#') trước khi so: dung lượng/phiên bản đổi theo bản phát hành là hợp lệ.
  - Dòng hay tệp chỉ có trên trang thật → thoát 1 và in ra. Cố ý bỏ: SITE_DRIFT_ACK=<12 ký tự đầu sha256 của index.html trang thật>.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile
ap = argparse.ArgumentParser(); ap.add_argument('--rendered', required=True); ap.add_argument('--live', required=True); a = ap.parse_args()
HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = {'.git', '.nojekyll', 'verified.html', 'revoked.json'}  # verified.html do release.sh tạo; revoked.json được trộn (merge-revoked)
live_idx = os.path.join(a.live, 'index.html'); ren_idx = os.path.join(a.rendered, 'index.html')
digest = hashlib.sha256(open(live_idx, 'rb').read()).hexdigest()[:12]
tmp = tempfile.mkdtemp(prefix='aivn-drift-')
git = lambda *x: subprocess.run(['git', '-C', a.live, *x], check=True, capture_output=True, text=True).stdout
base = git('log', '--format=%H', '--grep=^Trang web AIVN [0-9]', '-n', '1', 'HEAD').strip()
if not base: sys.exit('SITE DRIFT: không thấy commit triển khai gốc (“Trang web AIVN …”) trong lịch sử gh-pages — cần clone CÓ lịch sử')
def cleared(name, text):
    f = os.path.join(tmp, name); open(f, 'w', encoding='utf-8').write(text)
    subprocess.run([sys.executable, os.path.join(HERE, 'site_beta.py'), '--html', f, '--clear'], check=True, stdout=subprocess.DEVNULL)
    return open(f, encoding='utf-8').read()
DICT = re.compile(r'/\*I18N\*/(.*?)/\*END\*/', re.S)
mask = lambda x: re.sub(r'\d+', '#', x).strip()
norm = lambda s: {mask(l) for l in DICT.sub('/*I18N*//*END*/', s).splitlines() if l.strip()}  # từ điển i18n so riêng theo khoá
def dic(s):
    m = DICT.search(s)
    if not m: return {}
    d = json.loads(m.group(1)); return {(lang, k): mask(str(v)) for lang, kv in d.items() if isinstance(kv, dict) for k, v in kv.items()}
live_t = cleared('live.html', open(live_idx, encoding='utf-8').read()); base_t = cleared('base.html', git('show', f'{base}:index.html')); ren_t = open(ren_idx, encoding='utf-8').read()
added = norm(live_t) - norm(base_t)  # sửa trên gh-pages sau lần triển khai gốc
lost = sorted(added - norm(ren_t))
ld, bd, rd = dic(live_t), dic(base_t), dic(ren_t)
dkeys = [k for k in ld if bd.get(k) != ld[k]]  # khoá i18n thêm/sửa trên gh-pages
lost += [f'i18n {lang}.{k} = {ld[(lang, k)][:160]}' + (' (site/ có giá trị khác)' if (lang, k) in rd else ' (site/ không có)') for lang, k in sorted(dkeys) if rd.get((lang, k)) != ld[(lang, k)]]
added |= {f'i18n:{k}' for k in dkeys}
base_files = set(git('ls-tree', '--name-only', base).split())
files = sorted(f for f in os.listdir(a.live) if f not in SKIP and f not in base_files and not os.path.exists(os.path.join(a.rendered, f)))
print(f'gốc so sánh: {base[:7]} ({git("log", "-1", "--format=%s", base).strip()}); {len(added)} dòng sửa trên gh-pages sau đó')
shutil.rmtree(tmp, ignore_errors=True)
if not lost and not files: print(f'SITE DRIFT OK: trang dựng từ site/ giữ đủ nội dung trang thật (live {digest})'); sys.exit(0)
print(f'SITE DRIFT: trang thật (index.html sha256 {digest}) có nội dung KHÔNG có trong trang dựng từ site/ — triển khai sẽ làm mất:', file=sys.stderr)
for f in files: print(f'  tệp chỉ có trên gh-pages: {f}', file=sys.stderr)
for l in lost[:30]: print('  - ' + (l[:220] + '…' if len(l) > 220 else l), file=sys.stderr)
if len(lost) > 30: print(f'  … và {len(lost) - 30} dòng khác', file=sys.stderr)
if os.environ.get('SITE_DRIFT_ACK') == digest: print(f'SITE_DRIFT_ACK={digest}: đã xác nhận cố ý bỏ — tiếp tục', file=sys.stderr); sys.exit(0)
print('Chép các sửa đổi đó vào site/index.html (và site/i18n) rồi chạy lại; nếu CỐ Ý bỏ thì đặt SITE_DRIFT_ACK=' + digest, file=sys.stderr); sys.exit(1)
