import re
import sys

for t in sys.argv[1:]:
    s = open(f'rx{t}.html', encoding='utf-8', errors='ignore').read()
    blocks = re.split(r'<a name="pr\d+"></a>', s)[1:]
    out = []
    for b in blocks:
        pid = re.search(r'Задание № (\d+)', b)
        crit = b[b.find('Кри­те­рии оце­ни­ва­ния'):]
        mx = re.findall(r'<td style="text-align:center">(\d)</td>', crit[:6000])
        n = len(re.findall(r'<b>При­мер ', b))
        out.append(f"{pid.group(1) if pid else '-'}:max{max(mx) if mx else '-'}:{n}")
    print(t, ' '.join(out))
