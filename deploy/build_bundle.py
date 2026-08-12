#!/usr/bin/env python3
"""Package a test session into one shareable archive.

    python deploy/build_bundle.py [reports-dir] [out.zip]

The archive is meant to be forwarded to someone who has none of this
repository and no access to the server. It therefore carries the rendered
report, the photographs as ordinary files, and the full run data — enough to
re-examine any grade, or to rebuild the report after adding more runs.

Photographs are extracted rather than left as `data:` URLs. The same image is
embedded in every run that used it, so a session where one photo was tried
under six flag configurations stores it six times; pulling them out and
referencing by filename cuts the JSON to a fraction of its size and lets the
recipient open a photo without decoding anything.
"""

from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import shutil
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import UTC, datetime

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from build_review import GROUPS, GROUP_ORDER, build, group_of, label, load, scores, verdict  # noqa: E402

EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def extract_images(reports: list[dict], out_dir: pathlib.Path) -> dict[str, str]:
    """data: URL -> relative filename, written once per distinct image."""
    out_dir.mkdir(parents=True, exist_ok=True)
    mapping: dict[str, str] = {}
    for report in reports:
        for url in report.get("image_data_urls") or []:
            if url in mapping or not url.startswith("data:"):
                continue
            header, _, payload = url.partition(",")
            media = header[5:].split(";")[0]
            digest = hashlib.sha1(url.encode()).hexdigest()[:8]
            name = f"{len(mapping) + 1:02d}_{digest}{EXT.get(media, '.bin')}"
            try:
                (out_dir / name).write_bytes(base64.b64decode(payload))
            except Exception:  # noqa: BLE001 - a corrupt image must not stop the bundle
                print(f"  could not decode an image in {report.get('request_id')}", file=sys.stderr)
                continue
            mapping[url] = f"images/{name}"
    return mapping


def slim(report: dict, mapping: dict[str, str]) -> dict:
    """Same report, photographs by reference instead of inline base64."""
    out = dict(report)
    urls = out.pop("image_data_urls", None) or []
    out["image_files"] = [mapping.get(u, "(не извлечено)") for u in urls]
    return out


def findings_markdown(reports: list[dict]) -> str:
    wrong = [r for r in reports if verdict(r) == "wrong"]
    judged = [r for r in reports if verdict(r) in ("wrong", "ok")]
    by_group: dict[str, list[dict]] = defaultdict(list)
    for r in wrong:
        by_group[group_of(r)].append(r)
    tokens = sum((r.get("total_usage") or {}).get("total_tokens", 0) for r in reports)

    lines = [
        "# Что показала тестовая сессия",
        "",
        # the space-separated form is built on its own: replacing commas across
        # the whole sentence also removed the one before "оспорил"
        f"Прогонов: **{len(reports)}**. Тестировщик вынес вердикт по **{len(judged)}**: "
        f"подтвердил **{len(judged) - len(wrong)}**, оспорил **{len(wrong)}**. "
        f"Израсходовано около **{f'{tokens:,}'.replace(',', chr(160))} токенов**.",
        "",
        "Тесты названы самим тестировщиком: А…Л — эталонные решения, которые должны "
        "получать полный балл; X1–X7 — намеренные ловушки; P14–P21 и M1–M4 — фотографии. "
        "Каждый тест прогонялся в конфигурациях K0–K7, отличающихся одним флагом. "
        "Тест, который падает во **всех** конфигурациях, указывает на промпт или критерии; "
        "тест, падающий только в одной, — на конкретный флаг.",
        "",
        "| причина | спорных прогонов |",
        "|---|---:|",
    ]
    for g in GROUP_ORDER:
        if by_group.get(g):
            lines.append(f"| **{GROUPS[g][0]}** | {len(by_group[g])} |")

    lines += [
        "",
        "## Что чинить",
        "",
        "1. **Эталон занижен** — самая массовая поломка и самая дешёвая правка. Верное "
        "и полное решение получает 2/1 вместо 2/2 на тестах Е, Ж, З, И, К, Л, причём во "
        "всех конфигурациях сразу. Балл снимается за невыписанную ОДЗ и за отбор корней, "
        "показанный на тригонометрической окружности. От флагов не зависит — значит, дело "
        "в правилах снятия в `prompts/stage3_grading.md`, они строже реальных критериев.",
        "",
        "2. **Распознавание.** На фото 6.jpg бот во всех трёх прогонах прочитал ответ как "
        "−13π/6, −11π/6, −7π/6, тогда как на листе написано −17π/6 и −19π/6. Выключение "
        "флага «Исправлять артефакты распознавания» (K6) ничего не изменило — цифры "
        "путаются в самом распознавании, а не в нормализации. То же на 1.jpg (потерян "
        "минус в −π/2 + 2πn) и 11.jpg (исправленное 22 прочитано как 23, молча дописаны "
        "скобки логарифма). Отдельно: 15.jpg повёрнут на 90°, 16.x и 19.x — две страницы, "
        "где на второй начинается уже другая задача.",
        "",
        "3. **Устаревшие критерии.** Тест X1 даёт 0/0 там, где по действующим критериям "
        "ФИПИ положен 1 балл. Правится не промптом, а файлами `prompts/criteria/`.",
        "",
        "4. **Лояльность к своему ответу.** Тест X7: когда итоговый ответ ученика совпал "
        "с собственным ответом бота, бот прощает необоснованный переход и ставит 2 вместо "
        "1. Ловушка сработала во всех конфигурациях.",
        "",
        "5. **Применение критериев** — X3–X6: вычислительная ошибка обнулена вместо 1 балла, "
        "потеря точки не учтена, нарушение ОДЗ засчитано.",
        "",
        "## Все оспоренные прогоны",
        "",
    ]
    for g in GROUP_ORDER:
        group = by_group.get(g)
        if not group:
            continue
        lines += [f"### {GROUPS[g][0]} ({len(group)})", ""]
        for r in sorted(group, key=lambda x: (label(x)[0] or "", label(x)[1] or "")):
            name, conf, _ = label(r)
            fb = r["feedback"]
            base, pres, mx = scores(r)
            lines += [
                f"- **Тест {name or '—'}** · {conf or 'K?'} · задание {r.get('task_number')} · "
                f"`{r['request_id']}`",
                f"  - получено **{base}/{pres}**, ожидалось "
                f"**{fb.get('expected_base')}/{fb.get('expected_presentation')}** (из {mx})",
                f"  - {(fb.get('comment') or '').strip()}",
            ]
        lines.append("")

    confirmed = [r for r in reports
                 if verdict(r) == "ok" and (r.get("feedback") or {}).get("comment")]
    if confirmed:
        lines += [
            "## Подтверждённые прогоны",
            "",
            f"{len(confirmed)} прогонов тестировщик счёл верными и всё равно прокомментировал. "
            "Читать стоит: часть из них — негативные тесты, где объясняется, почему оценка "
            "верна, и что именно проверялось.",
            "",
        ]
        for r in sorted(confirmed, key=lambda x: (label(x)[0] or "", label(x)[1] or "")):
            name, conf, _ = label(r)
            base, pres, mx = scores(r)
            lines += [
                f"- **Тест {name or '—'}** · {conf or 'K?'} · {base}/{pres} из {mx} · "
                f"`{r['request_id']}`",
                f"  - {((r.get('feedback') or {}).get('comment') or '').strip()}",
            ]
        lines.append("")

    return "\n".join(lines)


def comments_csv(reports: list[dict]) -> str:
    """All comments as CSV, for sorting and filtering in a spreadsheet."""
    import csv
    import io as _io

    buf = _io.StringIO()
    w = csv.writer(buf, delimiter=";")  # ; so Excel opens it with Russian locales
    w.writerow([
        "тест", "конфигурация", "задание", "вердикт", "база", "оформление",
        "ждали базу", "ждали оформление", "макс", "комментарий", "request_id",
    ])
    for r in reports:
        fb = r.get("feedback") or {}
        if not fb.get("comment"):
            continue
        name, conf, _ = label(r)
        base, pres, mx = scores(r)
        w.writerow([
            name or "", conf or "", r.get("task_number", ""), fb.get("verdict", ""),
            base, pres, fb.get("expected_base", ""), fb.get("expected_presentation", ""),
            mx, fb["comment"], r.get("request_id", ""),
        ])
    return buf.getvalue()


README = """# Тестовая сессия сервиса проверки ЕГЭ · {date}

## Начните отсюда

**`report.html`** — откройте двойным щелчком в браузере. Весь разбор в одном
файле, картинки внутри. Ничего устанавливать не нужно.

Наверху — **матрица «тест × конфигурация»**. Строки — тесты, которые придумал
тестировщик: А…Л эталонные решения (должны получать полный балл), X1–X7
намеренные ловушки, P14–P21 и M1–M4 фотографии. Столбцы K0–K7 — конфигурации,
каждая отличается одним переключённым флагом.

Читать её так:

* **строка красная целиком** — тест падает при любых настройках. Дело в
  промпте или в критериях, флаги ни при чём;
* **красная одна ячейка** — виноват именно тот флаг, что переключён в этой
  конфигурации;
* в ячейке — «за решение / с оформлением», ниже мелким — чего ожидал
  тестировщик;
* клик по ячейке ведёт к самому прогону.

Ниже матрицы разделы по причинам расхождения — распознавание, эталон занижен,
устаревшие критерии, лояльность к своему ответу, применение критериев. Внутри
каждого теста: фотография, все прогоны по ней, комментарий тестировщика,
строка «бот прочитал ответ» и, под катом, находки, расшифровка и обоснования.

Кнопка **«Только спорные»** оставляет лишь то, с чем тестировщик не согласился.

**`findings.md`** — те же выводы текстом, на пять минут чтения. Ниже — все
комментарии тестировщика: сперва по оспоренным прогонам, затем по
подтверждённым.

**`comments.csv`** — все комментарии одной таблицей (разделитель `;`, открывается
в Excel). Удобно отсортировать по тесту или по вердикту.

## Остальное

| путь | что это |
|---|---|
| `report.html` | разбор целиком, открывается в браузере |
| `findings.md` | выводы, все оспоренные прогоны и все подтверждённые — с комментариями |
| `comments.csv` | все {ncomments} комментария таблицей: открыть в Excel, отсортировать, отфильтровать |
| `images/` | фотографии решений в оригинальном размере |
| `reports/` | полные данные прогонов в JSON: промпты, ответы модели, оценки, отзывы |
| `build_review.py` | пересобрать `report.html`, когда прогонов станет больше |

В `report.html` фотографии уменьшены, чтобы файл открывался быстро; оригиналы
лежат в `images/`.

`reports/` — то же, что в отчёте, но машиночитаемо: по файлу на прогон,
сгруппированы по датам. Фотографии заменены ссылками вида
`images/03_a1b2c3d4.jpg` — один и тот же снимок использовался в нескольких
прогонах, и хранить его каждый раз заново незачем.

Пересобрать отчёт после новых прогонов:

```
python3 build_review.py reports report.html
```

## Что внутри данных

В каждом `reports/*.json` — полная история прогона: отправленные промпты
целиком, сырые ответы модели, разобранные объекты, обе оценки с обоснованиями,
токены и стоимость, включённые флаги, версии промптов и отзыв тестировщика.

Ключи API замаскированы (`sk-3...0327`) — секретов в архиве нет.

## Осторожно

Внутри — **фотографии реальных ученических работ**. Архив не для публикации.
"""


def main() -> None:
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "collected-reports")
    out_zip = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "ege-test-session.zip")

    reports = load(src)
    if not reports:
        sys.exit(f"no reports under {src}")

    today = datetime.now(UTC).strftime("%Y-%m-%d")
    root_name = f"ege-test-session-{today}"
    staging = out_zip.parent / f".{root_name}-staging"
    if staging.exists():
        shutil.rmtree(staging)
    bundle = staging / root_name
    bundle.mkdir(parents=True)

    mapping = extract_images(reports, bundle / "images")
    print(f"  extracted {len(mapping)} distinct photos")

    reports_dir = bundle / "reports"
    for report in reports:
        day = (report.get("created_at") or "")[:10] or "unknown"
        target = reports_dir / day
        target.mkdir(parents=True, exist_ok=True)
        (target / f"{report['request_id']}.json").write_text(
            json.dumps(slim(report, mapping), ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # The rendered report keeps its images inline: it has to work as a single
    # file that someone can open or forward on its own.
    (bundle / "report.html").write_text(build(reports), encoding="utf-8")
    (bundle / "findings.md").write_text(findings_markdown(reports), encoding="utf-8")
    # utf-8-sig: without the BOM Excel opens Cyrillic CSV as mojibake
    (bundle / "comments.csv").write_text(comments_csv(reports), encoding="utf-8-sig")
    ncomments = sum(1 for r in reports if (r.get("feedback") or {}).get("comment"))
    (bundle / "README.md").write_text(
        README.format(date=today, ncomments=ncomments), encoding="utf-8"
    )
    shutil.copy2(pathlib.Path(__file__).with_name("build_review.py"), bundle / "build_review.py")

    if out_zip.exists():
        out_zip.unlink()
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(bundle.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(staging))
    shutil.rmtree(staging)

    size = out_zip.stat().st_size / 1e6
    print(f"  {len(reports)} runs, {len(mapping)} photos → {out_zip} ({size:.1f} MB)")


if __name__ == "__main__":
    main()
