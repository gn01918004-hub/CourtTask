#!/usr/bin/env python3
"""打包離線散發版：python3 tools/build.py

版本號只寫在 app/js/version.js（window.APP_VERSION），這裡自動讀取。
產出（dist/ 不進版控）：
  dist/CourtTask.html      — 單一檔案版（CSS/JS 全部內嵌，複製這一個檔案即可使用）
  dist/release_notes.md    — 從 README「## vX.Y：…」章節擷取的版本說明，給 GitHub Release 用

GitHub Release 的附件檔名固定為 CourtTask.html（不含版本號），
所以 https://github.com/<帳號>/CourtTask/releases/latest/download/CourtTask.html 永遠是最新版。
"""
import datetime
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')
DIST = os.path.join(ROOT, 'dist')
ASSET = 'CourtTask.html'


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def version():
    m = re.search(r"APP_VERSION\s*=\s*'([0-9]+(?:\.[0-9]+)+)'", read(os.path.join(APP, 'js', 'version.js')))
    if not m:
        sys.exit('app/js/version.js 裡找不到 APP_VERSION')
    return m.group(1)


def single_file(ver):
    html = read(os.path.join(APP, 'index.html'))
    css = read(os.path.join(APP, 'css', 'style.css'))
    html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>')

    def inline(m):
        js = read(os.path.join(APP, m.group(1)))
        assert '</script' not in js, m.group(1)
        return '<script>\n' + js + '\n</script>'
    html = re.sub(r'<script src="(js/[^"]+)"></script>', inline, html)
    assert 'src="js/' not in html and 'href="css/' not in html
    tag = '<meta name="version" content="v%s (%s)">' % (ver, datetime.date.today().isoformat())
    return html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + tag, 1)


def notes(ver):
    """README 裡「## vX.Y：」開頭的章節（到下一個 ## 為止）"""
    readme = read(os.path.join(ROOT, 'README.md'))
    m = re.search(r'^## v%s[：:](.*?)$(.*?)(?=^## |\Z)' % re.escape(ver), readme, re.M | re.S)
    if not m:
        sys.exit('README.md 裡找不到「## v%s：…」章節，請先補上這次的修改說明' % ver)
    body = m.group(2).strip()
    return '**%s**\n\n%s\n\n---\n下載：附件 `%s`（單一檔案，複製到內網電腦用 Chrome 開啟即可）\n' % (m.group(1).strip(), body, ASSET)


def main():
    ver = version()
    if len(sys.argv) > 1 and sys.argv[1].lstrip('v') != ver:
        sys.exit('指定的版本 %s 和 app/js/version.js 的 %s 不一致' % (sys.argv[1], ver))
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, ASSET)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(single_file(ver))
    with open(os.path.join(DIST, 'release_notes.md'), 'w', encoding='utf-8') as f:
        f.write(notes(ver))
    print('v%s' % ver, out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
