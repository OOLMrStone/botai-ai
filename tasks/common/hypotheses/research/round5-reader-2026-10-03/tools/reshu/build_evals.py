"""Package independent Reshu EGE expert-school examples into eval folders (outside the repo)."""
import json
import shutil
from pathlib import Path

HERE = Path(__file__).parent
EXCLUDE_PROBLEMS = {'559475', '559477', '559478', '559482', '559484', '559486', '559522', '559524', '559525'}
SITE_TASK = {'14': 'rx1', '15': 'rx2', '18': 'rx5'}

for task in ('14', '15', '18'):
    problems = json.loads((HERE / f'parsed-{task}.json').read_text(encoding='utf-8'))
    out = HERE / 'evals' / task
    shutil.rmtree(out, ignore_errors=True)
    (out / 'problems').mkdir(parents=True)
    cases, skipped = [], []
    for p in problems:
        card = HERE / 'cards' / f"{p['id']}.png"
        for order, ex in enumerate(p['examples'], 1):
            case_id = f"{p['id']}.{order}"
            if p['id'] in EXCLUDE_PROBLEMS or ex.get('fipi_match'):
                skipped.append((case_id, 'FIPI-2026 problem or scan'))
                continue
            if not card.exists() or not ex['student_imgs'] or len(ex['student_imgs']) > 4:
                skipped.append((case_id, 'no task card or 0/>4 images'))
                continue
            shutil.copyfile(card, out / 'problems' / card.name)
            folder = out / case_id
            folder.mkdir()
            names = []
            for k, image in enumerate(ex['student_imgs'], 1):
                name = 'solution.png' if len(ex['student_imgs']) == 1 else f'solution-{k:02}.png'
                shutil.copyfile(HERE / 'img' / f'{image}.png', folder / name)
                names.append(f'{case_id}/{name}')
            (folder / 'expected.json').write_text(json.dumps({
                'score': ex['score'],
                'verdict': ex['comment_text'] or '(комментарий эксперта — картинкой)',
                'source': f"https://math-ege.sdamgia.ru/expert?task={SITE_TASK[task][2:]}&m=true, задание {p['id']}, пример {ex['n']} (по порядку {order})",
            }, ensure_ascii=False, indent=2), encoding='utf-8')
            cases.append({'id': case_id, 'problem_and_reference_answer': f'problems/{card.name}',
                          'solution': names if len(names) > 1 else names[0],
                          'expected': f'{case_id}/expected.json'})
    (out / 'manifest.json').write_text(json.dumps({
        'source': 'Решу ЕГЭ, Школа экспертов (баллы экспертов сайта)', 'target_task_number': int(task),
        'cases': cases}, ensure_ascii=False, indent=1), encoding='utf-8')
    print(task, 'cases', len(cases), 'skipped', len(skipped), 'scores',
          {s: sum(1 for c in cases if json.loads((out / c['expected']).read_text(encoding='utf-8'))['score'] == s) for s in range(4)})
