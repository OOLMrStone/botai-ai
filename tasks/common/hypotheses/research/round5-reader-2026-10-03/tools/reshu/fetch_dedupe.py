"""Download student scans from the parsed pages and flag ones that duplicate FIPI eval scans."""
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
REPO = Path('/mnt/c/Users/kosti/Desktop/botai-ai')
PAGES = {'14': 'rx1.json', '15': 'rx2.json', '18': 'rx5.json'}


def ahash(img, size=16):
    g = img.convert('L').resize((size, size))
    px = list(g.getdata())
    mean = sum(px) / len(px)
    return [p > mean for p in px]


def dist(a, b):
    return sum(x != y for x, y in zip(a, b))


def fetch(file_id):
    target = HERE / 'img' / f'{file_id}.png'
    if not target.exists():
        req = urllib.request.Request(f'https://math-ege.sdamgia.ru/get_file?id={file_id}',
                                     headers={'User-Agent': 'Mozilla/5.0'})
        data = urllib.request.urlopen(req, timeout=30).read()
        target.parent.mkdir(exist_ok=True)
        Image.open(io.BytesIO(data)).save(target)
        time.sleep(0.5)
    return target


fipi = {}
for task in PAGES:
    for path in (REPO / 'tasks' / task / 'evals' / 'fipi').glob('*/solution*.png'):
        fipi[str(path.relative_to(REPO))] = ahash(Image.open(path))

report = {}
for task, page in PAGES.items():
    problems = json.loads((HERE / page).read_text(encoding='utf-8'))
    for p in problems:
        for ex in p['examples']:
            hashes = [ahash(Image.open(fetch(i))) for i in ex['student_imgs']]
            for i in ex['comment_imgs']:
                fetch(i)
            best = min(((dist(h, f), name) for h in hashes for name, f in fipi.items()), default=(999, ''))
            ex['fipi_match'] = best[1] if best[0] <= 30 else None
            ex['fipi_dist'] = best[0]
    (HERE / f'parsed-{task}.json').write_text(json.dumps(problems, ensure_ascii=False, indent=1), encoding='utf-8')
    exs = [e for p in problems for e in p['examples']]
    report[task] = {'examples': len(exs), 'fipi_duplicates': sum(1 for e in exs if e['fipi_match'])}
print(json.dumps(report, ensure_ascii=False))
