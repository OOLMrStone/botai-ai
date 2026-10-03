"""Render a task card (statement + answer) for each Reshu problem as a PNG.

Formulas are the site's own SVG images; they are downloaded and embedded.
"""
import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import fitz

HERE = Path(__file__).parent
SVG = HERE / 'svg'
CARDS = HERE / 'cards'
CSS = 'body { font-family: sans-serif; font-size: 12pt; line-height: 1.5; } img { vertical-align: middle; }'


def local_svg(url):
    stem = hashlib.md5(url.encode()).hexdigest()
    path, png = SVG / (stem + '.svg'), SVG / (stem + '.png')
    if not path.exists():
        SVG.mkdir(exist_ok=True)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        path.write_bytes(urllib.request.urlopen(req, timeout=30).read())
        time.sleep(0.2)
    if not png.exists():
        svg = fitz.open(str(path))
        svg[0].get_pixmap(dpi=144, alpha=False).save(str(png))
    return png.name


def svg_height(tag):
    url = __import__('re').search(r'src="([^"]+)"', tag).group(1)
    stem = hashlib.md5(url.encode()).hexdigest()
    return f"{fitz.open(str(SVG / (stem + '.svg')))[0].rect.height:.1f}pt"


def clean(fragment):
    fragment = re.sub(r'<img src="(https://ege\.sdamgia\.ru/formula/svg/[^"]+)"[^>]*>',
                      lambda m: f'<img src="{local_svg(m.group(1))}" style="height:{svg_height(m.group(0))}"/>', fragment)
    fragment = re.sub(r'<img src="/get_file[^>]*>', '', fragment)
    fragment = re.sub(r'</?(div|span|center|table|tr|td|th)[^>]*>', ' ', fragment)
    return fragment.replace('\xad', '')


def answer_of(block):
    sol = block[block.find('<b>Решение</b>'):]
    m = re.search(r'Ответ:(.*?)(?=<p|</div>|<br><br>)', sol, re.S)
    return m.group(1) if m else None


def render(pid, statement, answer):
    html = f'<p>{clean(statement)}</p><p><b>Ответ:</b> {clean(answer)}</p>'
    story = fitz.Story(html=html, user_css=CSS, archive=fitz.Archive(str(SVG)))
    import io
    buffer = io.BytesIO()
    writer = fitz.DocumentWriter(buffer)
    device = writer.begin_page(fitz.Rect(0, 0, 600, 2000))
    _, filled = story.place(fitz.Rect(20, 20, 580, 1980))
    story.draw(device)
    writer.end_page()
    writer.close()
    bottom = (filled[3] if isinstance(filled, tuple) else filled.y1) + 20
    page = fitz.open('pdf', buffer.getvalue())[0]
    CARDS.mkdir(exist_ok=True)
    out = CARDS / f'{pid}.png'
    page.get_pixmap(dpi=144, clip=fitz.Rect(0, 0, 600, bottom)).save(str(out))
    return out


if __name__ == '__main__':
    src_page, pids = sys.argv[1], set(sys.argv[2:])
    src = open(HERE.parent.parent / 'rx' / src_page if False else src_page, encoding='utf-8', errors='ignore').read()
    blocks = re.split(r'<a name="pr\d+"></a>', src)[1:]
    done = {}
    for block in blocks:
        pid = re.search(r'Задание № (\d+)', block).group(1)
        if pids and pid not in pids:
            continue
        head = re.search(r'Задание № \d+', block)
        statement = block[head.end():block.find('<b>Решение</b>')]
        answer = answer_of(block)
        done[pid] = str(render(pid, statement, answer)) if answer else None
    print(json.dumps(done, ensure_ascii=False))
