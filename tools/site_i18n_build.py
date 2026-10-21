#!/usr/bin/env python3
"""Ghép bản dịch site/i18n/{en,zh,vi}.json vào site/index.html (giữa /*I18N*/ và /*END*/).
Tiếng Việt là văn bản gốc trong HTML (thuộc tính data-i18n giữ khoá). Chạy lại sau mỗi lần sửa bản dịch."""
import json, os, re, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
site = os.path.join(root, 'site')
L = {l: json.load(open(os.path.join(site, 'i18n', l + '.json'), encoding='utf-8')) for l in ('vi', 'en', 'zh')}
D = {'en': {**L['en']['text'], **L['en']['attr']}, 'zh': {**L['zh']['text'], **L['zh']['attr']}, 'meta': {l: L[l]['meta'] for l in L}}
p = os.path.join(site, 'index.html'); html = open(p, encoding='utf-8').read()
new = re.sub(r'/\*I18N\*/.*?/\*END\*/', lambda m: '/*I18N*/' + json.dumps(D, ensure_ascii=False) + '/*END*/', html, count=1, flags=re.S)
if '--check' in sys.argv:
    sys.exit(0 if new == html else 'site/index.html chưa ghép bản dịch mới: chạy python3 tools/site_i18n_build.py')
open(p, 'w', encoding='utf-8').write(new); print('đã ghép bản dịch vào site/index.html')
