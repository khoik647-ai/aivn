#!/usr/bin/env python3
"""Soát chính tả vi (hunspell vi_VN) + en (hunspell en_US) cho chuỗi giao diện AIVN và trang web.
Từ đúng mà từ điển không biết: thêm vào docs/spelling-allow.txt. Thoát mã 1 nếu còn từ chưa duyệt."""
import json, os, re, subprocess, sys
from collections import defaultdict
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
VI_CH = re.compile(r'[ăâđêôơưàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]', re.I)
def strip_tags(s): return re.sub(r'\b[0-9a-f]{64}\b', ' ', re.sub(r'<[^>]+>', ' ', s))  # bỏ thẻ và mã SHA-256
def js_strings(src):
    out = []
    for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`", src):
        s = next(g for g in m.groups() if g is not None)
        if VI_CH.search(s): out.append(re.sub(r'\\[ntr]', ' ', re.sub(r'\$\{[^}]*\}', ' ', s)))
    return out
def collect():
    vi, en = defaultdict(set), defaultdict(set)
    site = open(os.path.join(ROOT, 'site/index.html'), encoding='utf-8').read()
    body = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>|<pre[\s\S]*?</pre>', ' ', site)
    vi['site/index.html'].add(strip_tags(body))
    for l in ('en',):
        p = os.path.join(ROOT, 'site/i18n', l + '.json')
        if os.path.exists(p):
            d = json.load(open(p, encoding='utf-8'))
            for v in list(d.get('text', {}).values()) + list(d.get('attr', {}).values()) + list(d.get('meta', {}).values()):
                en['site/i18n/en.json'].add(strip_tags(str(v)))
    files = ['src/renderer/index.html', 'src/renderer/app.js', 'src/renderer/error-view.js', 'src/main.js', 'src/preload.js', 'src/desktop-agent.js', 'src/agent/agent.js', 'src/agent/shot-guard.js', 'src/qa-runner.js', 'src/recommend.js', 'src/catalog.js', 'src/catalog-claims.js', 'src/updater.js']
    for f in files:
        p = os.path.join(ROOT, f)
        if not os.path.exists(p): continue
        src = open(p, encoding='utf-8').read()
        if f.endswith('.html'): vi[f].add(strip_tags(re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', ' ', src)))
        else:
            src = re.sub(r'^\s*//.*$', '', src, flags=re.M)  # bỏ chú thích dòng
            vi[f].update(js_strings(src))
    for f in ['docs/verified.md']:  # tài liệu tiếng Việt phát hành kèm (bỏ khối mã, đường dẫn, thẻ HTML)
        p = os.path.join(ROOT, f)
        if os.path.exists(p): vi[f + '.html'].add(strip_tags(re.sub(r'`[^`]*`|\]\([^)]*\)', ' ', open(p, encoding='utf-8').read())))
    for f in ['docs/verified.en.md']:  # bản tiếng Anh của trang kiểm chứng (bỏ khối mã, đường dẫn, thẻ HTML và câu lệnh tiếng Việt trích nguyên văn)
        p = os.path.join(ROOT, f)
        if os.path.exists(p):
            t = strip_tags(re.sub(r'`[^`]*`|\]\([^)]*\)', ' ', open(p, encoding='utf-8').read()))
            t = re.sub(r'“[^”]*”', lambda m: ' ' if VI_CH.search(m.group(0)) else m.group(0), t)
            en[f + '.html'].add(' '.join(w for w in t.split() if not VI_CH.search(w)))
    for p in ['src/i18n/en.json']:
        q = os.path.join(ROOT, p)
        if os.path.exists(q): en[p].update(map(str, json.load(open(q, encoding='utf-8')).values()))
    return vi, en
def words(text, lang, plain=True):
    text = re.sub(r'https?://\S+|\S+@\S+|\b[\w.-]+\.(?:js|md|csv|gguf|json|png|exe|zip|txt|docx?|pdf)\b|/v1/\S*', ' ', text)
    pat = r'[A-Za-zÀ-ỹđĐ]+' if lang == 'vi' else r"[A-Za-z]+(?:'[a-z]+)?"
    for w in re.findall(pat, text):
        if lang == 'vi' and not VI_CH.search(w) and (not plain or not re.fullmatch(r'[a-zđ]+', w)): continue  # chuỗi trong mã: chỉ soát từ có dấu; HTML: soát cả từ thường không dấu
        if lang == 'en' and (w.isupper() or re.search(r'\d', w) or (w[0].isupper() and len(w) > 1 and w[1:].islower() is False)): continue
        yield w
def hunspell(dic, ws):
    if not ws: return set()
    r = subprocess.run(['hunspell', '-d', dic, '-l'], input='\n'.join(ws), capture_output=True, text=True)
    if r.returncode != 0: sys.exit('Không chạy được hunspell (' + dic + '): ' + r.stderr)
    return set(r.stdout.split())
def main():
    allow = set()
    ap = os.path.join(ROOT, 'docs/spelling-allow.txt')
    if os.path.exists(ap): allow = {l.strip() for l in open(ap, encoding='utf-8') if l.strip() and not l.startswith('#')}
    vi, en = collect(); hits = defaultdict(set)
    for lang, dic, groups in (('vi', 'vi_VN', vi), ('en', 'en_US', en)):
        where = defaultdict(set)
        for f, texts in groups.items():
            for t in texts:
                for w in words(t, lang, f.endswith('.html') or f.endswith('.json')): where[w].add(f)
        bad = hunspell(dic, sorted(where))
        for w in bad:
            if w in allow or w.lower() in allow: continue
            hits[(lang, w)] = where[w]
    if '--json' in sys.argv: print(json.dumps({f'{l}:{w}': sorted(fs) for (l, w), fs in hits.items()}, ensure_ascii=False, indent=1))
    else:
        for (l, w), fs in sorted(hits.items()): print(f'[{l}] {w}  ← {", ".join(sorted(fs))}')
    print(f'{len(hits)} từ chưa duyệt', file=sys.stderr)
    sys.exit(1 if hits else 0)
if __name__ == '__main__': main()
