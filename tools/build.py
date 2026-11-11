#!/usr/bin/env python3
"""打包離線散發版：python3 tools/build.py [版本號]

產出 dist/CourtTask_v<版本>.zip，內含：
  CourtTask.html  — 單一檔案版（CSS/JS 全部內嵌，複製這一個檔案即可使用）
  app/            — 多檔版（與單檔版功能相同，方便日後替換個別檔案）
  README.txt      — 使用說明
"""
import datetime
import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')
DIST = os.path.join(ROOT, 'dist')
VERSION = sys.argv[1] if len(sys.argv) > 1 else '1.0'
TODAY = datetime.date.today().isoformat()
NAME = '法院略圖繪製系統'
PKG = 'CourtTask'   # 壓縮檔內一律用英文檔名，避免舊版解壓縮程式中文亂碼


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def single_file():
    html = read(os.path.join(APP, 'index.html'))
    css = read(os.path.join(APP, 'css', 'style.css'))
    html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>')

    def inline(m):
        js = read(os.path.join(APP, m.group(1)))
        assert '</script' not in js, m.group(1)
        return '<script>\n' + js + '\n</script>'
    html = re.sub(r'<script src="(js/[^"]+)"></script>', inline, html)
    assert 'src="js/' not in html and 'href="css/' not in html
    return html


def stamp(html):
    tag = '<meta name="version" content="v%s (%s)">' % (VERSION, TODAY)
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + tag, 1)
    return html.replace('<div class="brand">法院略圖繪製系統</div>',
                        '<div class="brand" title="v%s（%s）">法院略圖繪製系統 <small>v%s</small></div>' % (VERSION, TODAY, VERSION), 1)


def main():
    out_dir = os.path.join(DIST, '%s_v%s' % (PKG, VERSION))
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)
    # 單檔版
    with open(os.path.join(out_dir, PKG + '.html'), 'w', encoding='utf-8') as f:
        f.write(stamp(single_file()))
    # 多檔版
    shutil.copytree(APP, os.path.join(out_dir, 'app'))
    idx = os.path.join(out_dir, 'app', 'index.html')
    content = stamp(read(idx))
    with open(idx, 'w', encoding='utf-8') as f:
        f.write(content)
    # 說明（Windows 記事本可直接開啟：UTF-8 BOM、CRLF）
    readme = read(os.path.join(ROOT, 'README.md'))
    with open(os.path.join(out_dir, 'README.txt'), 'w', encoding='utf-8-sig', newline='\r\n') as f:
        f.write('%s v%s（%s）\n\n' % (NAME, VERSION, TODAY) + readme)
    zpath = out_dir + '.zip'
    if os.path.exists(zpath):
        os.remove(zpath)
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(out_dir):
            for fn in sorted(files):
                full = os.path.join(base, fn)
                z.write(full, os.path.relpath(full, DIST))
    print(zpath, os.path.getsize(zpath), 'bytes')


if __name__ == '__main__':
    main()
