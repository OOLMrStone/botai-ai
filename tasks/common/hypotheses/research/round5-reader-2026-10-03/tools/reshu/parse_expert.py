"""Parse Reshu EGE 'expert school' pages into problems with graded student examples.

Usage: python3 parse_expert.py rx1.html > rx1.json
"""
import html
import json
import re
import sys

src = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
blocks = re.split(r'<a name="pr\d+"></a>', src)[1:]
problems = []
for block in blocks:
    head = re.search(r'Задание № (\d+)', block)
    if not head:
        continue
    pid = head.group(1)
    # statement: first pbody after the header, up to the "Решение" marker
    stmt_html = block[head.end():block.find('<b>Решение</b>')]
    sol_start = block.find('<b>Решение</b>')
    crit = block.find('Кри­те­рии оце­ни­ва­ния')
    solution_html = block[sol_start:crit if crit > 0 else sol_start + 20000]
    answer = None
    m = re.search(r'Ответ:(.*?)</p>', solution_html, re.S)
    if m:
        answer = m.group(1)
    examples = []
    for ex in re.finditer(r'<b>При­мер (\d+)\.</b>(.*?)правильная оценка[^\d]*(\d)|<b>При­мер (\d+)\.</b>(.*?)value == (\d)\)', block, re.S):
        pass
    # Simpler: walk each "Пример" chunk and read its button
    for chunk in re.split(r'<b>При­мер ', block)[1:]:
        num = re.match(r'(\d+)\.?</b>', chunk)
        imgs = re.findall(r'get_file\?id=(\d+)', chunk.split('<div id="comm')[0])
        comm = re.search(r'<div id="comm\d+" style="display:none">(.*?)</div></div>', chunk, re.S)
        comm_imgs = re.findall(r'get_file\?id=(\d+)', comm.group(1)) if comm else []
        comm_text = html.unescape(re.sub(r'<[^>]+>', ' ', comm.group(1))).strip() if comm else ''
        score = re.search(r"value == (\d+)\)", chunk)
        if num and score:
            examples.append({'n': int(num.group(1)), 'student_imgs': imgs, 'comment_imgs': comm_imgs,
                             'comment_text': re.sub(r'\s+', ' ', comm_text)[:2000], 'score': int(score.group(1))})
    problems.append({'id': pid, 'statement_html': stmt_html, 'answer_html': answer,
                     'examples': examples})
json.dump(problems, sys.stdout, ensure_ascii=False, indent=1)
