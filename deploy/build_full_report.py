#!/usr/bin/env python3
"""Build the full test-session report from the tester's folder.

    python deploy/build_full_report.py <folder> <out.html>

`folder` is the extracted Yandex Disk share: photographs, `ИТОГ.docx`,
`Тесты бота-проверяющего.xlsx` and the `логи/` JSON reports.

The spreadsheet is the tester's real work — ten sheets, of which four carry
analysis that exists nowhere else: «Сводка» (18 numbered findings, each with
evidence, impact and a recommendation), «Ошибки» (115 individual defects with
ground truth beside the bot's output), «Конфигурации» (accuracy per flag
combination) and «Логи» (every run). The in-app feedback we collected from the
server is an abbreviation of this; where the two disagree, this wins.

CSS is a plain constant and never passed through `.format()`. Brace escaping
in a formatted stylesheet has silently emitted literal `{"wrong": …}` into the
page twice already.
"""

from __future__ import annotations

import base64
import html
import io
import json
import pathlib
import re
import sys
from collections import Counter, defaultdict
from typing import Any

E = html.escape


def esc(v: Any) -> str:
    return E(str(v if v is not None else ""))


# --- reading the sources ----------------------------------------------------
def read_sheets(xlsx: pathlib.Path) -> dict[str, list[list[str]]]:
    from openpyxl import load_workbook

    wb = load_workbook(xlsx, data_only=True, read_only=True)
    out: dict[str, list[list[str]]] = {}
    for name in wb.sheetnames:
        rows = [
            [("" if c is None else str(c).strip()) for c in row]
            for row in wb[name].iter_rows(values_only=True)
        ]
        out[name] = [r for r in rows if any(r)]
    wb.close()
    return out


def read_docx(path: pathlib.Path) -> list[str]:
    try:
        import docx
    except ImportError:
        return []
    if not path.is_file():
        return []
    return [p.text.strip() for p in docx.Document(path).paragraphs if p.text.strip()]


def as_dicts(rows: list[list[str]], header_row: int = 0) -> list[dict[str, str]]:
    if not rows:
        return []
    head = rows[header_row]
    out = []
    for r in rows[header_row + 1 :]:
        out.append({h: (r[i] if i < len(r) else "") for i, h in enumerate(head) if h})
    return out


def photo_data_url(path: pathlib.Path, max_w: int = 900, quality: int = 68) -> str:
    """Downscaled for the page; the originals ship alongside in `фото/`."""
    try:
        from PIL import Image

        img = Image.open(path)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        if img.width > max_w:
            img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:  # noqa: BLE001 - a bad image must not sink the report
        return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode()


# --- fragments --------------------------------------------------------------
def pct(v: str) -> str:
    try:
        return f"{float(v) * 100:.0f}%"
    except (TypeError, ValueError):
        return esc(v or "—")


def findings_section(sheet: list[list[str]]) -> str:
    """«Сводка» → the 18 numbered patterns. The heart of the report."""
    hdr = next((i for i, r in enumerate(sheet) if "Закономерность" in r), None)
    if hdr is None:
        return ""
    base = sheet[hdr].index("Закономерность")
    blocks = []
    for r in sheet[hdr + 1 :]:
        if len(r) <= base or not r[base].strip():
            continue
        num = r[base - 1] if base else "?"
        text, runs = r[base], r[base + 1] if len(r) > base + 1 else ""
        impact = r[base + 2] if len(r) > base + 2 else ""
        rec = r[base + 3] if len(r) > base + 3 else ""
        crit = "critical" if impact.startswith(("Критично", "Критичн")) else (
            "good" if impact.startswith("Позитив") else
            "high" if impact.startswith("Высок") else "mid"
        )
        badge = {"critical": "критично", "high": "высокое", "mid": "среднее",
                 "good": "позитив"}[crit]
        blocks.append(
            f'<article class="pat pat-{crit}" id="v{esc(num)}">'
            f'<header><span class="pnum">{esc(num)}</span>'
            f'<span class="pbadge b-{crit}">{badge}</span></header>'
            f'<p class="ptext">{esc(text)}</p>'
            + (f'<p class="pmeta"><b>Влияние.</b> {esc(impact)}</p>' if impact else "")
            + (f'<p class="prec"><b>Что делать.</b> {esc(rec)}</p>' if rec else "")
            + (f'<p class="pruns">прогоны: {esc(runs)}</p>' if runs else "")
            + "</article>"
        )
    return '<div class="pats">' + "".join(blocks) + "</div>"


def config_table(sheet: list[list[str]], itog: list[list[str]]) -> str:
    """K0–K7: what each switches, and how accurate it was."""
    rows = as_dicts(sheet)
    # the measured accuracy per config lives on «Итог», not «Конфигурации»
    measured: dict[str, dict[str, str]] = {}
    for r in itog:
        m = re.match(r"^(K\d(?:/K\d)?)\s*(.*)$", (r[0] or "").strip())
        if m and len(r) > 4 and r[1]:
            measured[m.group(1)] = {
                "runs": r[1], "base": r[2], "pres": r[3],
                "low": r[4] if len(r) > 4 else "", "high": r[5] if len(r) > 5 else "",
                "tok": r[6] if len(r) > 6 else "",
            }
    body = []
    for r in rows:
        code = r.get("Код", "")
        if not code:
            continue
        m = measured.get(code, {})
        body.append(
            f"<tr><td class=k>{esc(code)}</td>"
            f"<td>{esc(r.get('Что переключить'))}</td>"
            f"<td class=c>{esc(r.get('Вход'))}</td>"
            f"<td class=n>{esc(m.get('runs') or '—')}</td>"
            f"<td class=n>{pct(m.get('base', ''))}</td>"
            f"<td class=n>{pct(m.get('pres', ''))}</td>"
            f"<td class=n>{esc(m.get('low') or '—')}</td>"
            f"<td class=n>{esc(m.get('high') or '—')}</td>"
            f"<td class=n>{esc(m.get('tok') or '—')}</td></tr>"
        )
    return (
        '<div class="scroll"><table class="grid"><thead><tr>'
        "<th>код</th><th>что переключено</th><th>вход</th><th>прогонов</th>"
        "<th>точность: решение</th><th>точность: оформление</th>"
        "<th>занижено</th><th>завышено</th><th>токенов</th>"
        "</tr></thead><tbody>" + "".join(body) + "</tbody></table></div>"
    )


STAGE_CLASS = {"1 Распознавание": "s1", "2 Анализ": "s2", "3 Оценивание": "s3"}


def errors_section(sheet: list[list[str]]) -> tuple[str, Counter, Counter]:
    rows = as_dicts(sheet)
    by_stage: Counter = Counter()
    by_cause: Counter = Counter()
    blocks = []
    for r in rows:
        if not r.get("Категория"):
            continue
        stage = r.get("Этап", "")
        by_stage[stage] += 1
        cause = r.get("Предполагаемая причина", "")
        if cause:
            by_cause[cause] += 1
        hits = (r.get("Влияет на балл?") or "").strip().lower().startswith("да")
        cls = STAGE_CLASS.get(stage, "sx")
        blocks.append(
            f'<article class="err {cls}{" err-hit" if hits else ""}" '
            f'data-stage="{esc(stage)}" data-hit="{1 if hits else 0}" '
            f'data-cause="{esc(cause)}">'
            f'<header><span class="enum">#{esc(r.get("№"))}</span>'
            f'<span class="estage">{esc(stage)}</span>'
            f'<span class="ecat">{esc(r.get("Категория"))}</span>'
            + (f'<span class="ehit">стоило балла</span>' if hits else "")
            + f'<span class="ewhere">{esc(r.get("Где (строка / элемент)"))}</span>'
            + (f'<span class="ephoto">{esc(r.get("Фото прогона"))}</span>'
               if r.get("Фото прогона") else "")
            + "</header>"
            f'<div class="ecmp"><div class="etruth"><span class="el">на листе / верно</span>'
            f'{esc(r.get("Как на самом деле (фото / верно)"))}</div>'
            f'<div class="ebot"><span class="el">бот выдал</span>'
            f'{esc(r.get("Что выдал бот"))}</div></div>'
            + (f'<p class="econs"><b>Последствие.</b> {esc(r.get("Последствие (находки, баллы)"))}</p>'
               if r.get("Последствие (находки, баллы)") else "")
            + (f'<p class="ewhy"><b>Причина ({esc(r.get("Уверенность в причине") or "—").lower()}).</b> '
               f'{esc(cause)}'
               + (f' · {esc(r.get("Доп. причина"))}' if r.get("Доп. причина") else "")
               + (f' — {esc(r.get("Обоснование причины / рекомендация"))}'
                  if r.get("Обоснование причины / рекомендация") else "")
               + "</p>")
            + "</article>"
        )
    return '<div class="errs">' + "".join(blocks) + "</div>", by_stage, by_cause


def work_sections(logs: list[dict[str, str]], runs: list[dict[str, str]],
                  errors: list[dict[str, str]], tests: list[dict[str, str]],
                  photos: dict[str, pathlib.Path]) -> str:
    """One block per photograph: the work, every run on it, and its defects."""
    by_photo: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in logs:
        for name in re.findall(r"\d+(?:\.\d+)?\.jpg", row.get("Фото", "")):
            by_photo[name].append(row)
    err_by_photo: dict[str, list[dict[str, str]]] = defaultdict(list)
    for e in errors:
        for name in re.findall(r"\d+(?:\.\d+)?\.jpg", e.get("Фото прогона", "")):
            err_by_photo[name].append(e)
    test_by_id = {t.get("ID", ""): t for t in tests}

    out = []
    for name in sorted(photos, key=lambda n: [float(x) for x in re.findall(r"\d+", n)] or [0]):
        runs_here = by_photo.get(name, [])
        errs_here = err_by_photo.get(name, [])
        tid = next((r.get("Тест-ID") for r in runs_here if r.get("Тест-ID")), "")
        test = test_by_id.get(tid or "", {})
        rows = "".join(
            f"<tr><td class=k>{esc(r.get('Конфигурация') or '—')}</td>"
            f"<td class=n>{esc(r.get('Бот: решение'))}/{esc(r.get('Бот: оформление'))}</td>"
            f"<td class=n>{esc(r.get('Ожид.: решение'))}/{esc(r.get('Ожид.: оформление'))}</td>"
            f"<td class=\"n {'ok' if (r.get('Итог') or '').lower().startswith('совп') else 'bad'}\">"
            f"{esc(r.get('Итог') or '—')}</td>"
            f"<td class=n>{esc(r.get('Уверенность'))}</td>"
            f"<td class=n>{esc(r.get('Находок'))}</td>"
            f"<td class=mono>{esc(r.get('request_id'))}</td></tr>"
            for r in runs_here
        )
        hit = sum(1 for e in errs_here if (e.get("Влияет на балл?") or "").lower().startswith("да"))
        out.append(
            f'<article class="work" id="photo-{esc(name)}" data-bad="{1 if hit else 0}">'
            f'<div class="whead"><h3>{esc(name)}</h3>'
            + (f'<span class="wtest">тест {esc(tid)}</span>' if tid else "")
            + (f'<span class="wtask">задание {esc(test.get("Задание №"))}</span>'
               if test.get("Задание №") else "")
            + (f'<span class="wexp">ожидалось {esc(test.get("Ожид.: решение"))}/'
               f'{esc(test.get("Ожид.: оформление"))}</span>' if test.get("Ожид.: решение") else "")
            + f'<span class="werr">{len(errs_here)} ошибок, {hit} стоили балла</span></div>'
            + (f'<p class="wwhat">{esc(test.get("Что проверяет / дефект"))}</p>'
               if test.get("Что проверяет / дефект") else "")
            + f'<div class="wbody"><img src="{photo_data_url(photos[name])}" '
              f'alt="Работа {esc(name)}" loading="lazy">'
            + ('<div class="wruns"><table class="grid"><thead><tr>'
               "<th>конф.</th><th>бот</th><th>ожид.</th><th>итог</th>"
               "<th>увер.</th><th>наход.</th><th>request_id</th></tr></thead>"
               f"<tbody>{rows}</tbody></table>"
               + ("".join(
                   f'<div class="werrrow"><span class="es {STAGE_CLASS.get(e.get("Этап",""), "sx")}">'
                   f'{esc(e.get("Этап"))}</span> <b>{esc(e.get("Категория"))}</b>'
                   f'<div class="ecmp2"><span>на листе: {esc(e.get("Как на самом деле (фото / верно)"))}</span>'
                   f'<span>бот: {esc(e.get("Что выдал бот"))}</span></div></div>'
                   for e in errs_here) or '<p class="muted">ошибок не зафиксировано</p>')
               + "</div>")
            + "</div></article>"
        )
    return "".join(out)


def tests_table(tests: list[dict[str, str]]) -> str:
    body = "".join(
        f"<tr><td class=k>{esc(t.get('ID'))}</td><td class=n>{esc(t.get('Задание №'))}</td>"
        f"<td>{esc(t.get('Тип'))}</td><td>{esc(t.get('Что проверяет / дефект'))}</td>"
        f"<td class=n>{esc(t.get('Ожид.: решение'))}/{esc(t.get('Ожид.: оформление'))}</td>"
        f"<td class=mono>{esc(t.get('Фото (файлы)') or '—')}</td></tr>"
        for t in tests if t.get("ID")
    )
    return ('<div class="scroll"><table class="grid"><thead><tr><th>ID</th><th>№</th>'
            "<th>тип</th><th>что проверяет</th><th>ожид.</th><th>фото</th>"
            f"</tr></thead><tbody>{body}</tbody></table></div>")


CSS = """
:root{--paper:#f6f7f9;--card:#fff;--sunk:#eef1f5;--ink:#141820;--ink2:#4c5563;--ink3:#7b8492;
--rule:#d9dfe7;--soft:#e8ecf2;--accent:#2f5fd0;--bad:#c5302a;--badbg:#fbeae8;
--ok:#15764f;--okbg:#e6f2ec;--warn:#a2660c;--warnbg:#fbf2e3;--vio:#6d4aa8;--viobg:#f0ebf9}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--paper:#0e1218;--card:#151a22;--sunk:#1b212b;--ink:#e8ecf2;--ink2:#a6b0be;--ink3:#79828f;
--rule:#29313d;--soft:#212833;--accent:#7ba3f8;--bad:#ef7168;--badbg:#331c1b;
--ok:#4dbf90;--okbg:#13281e;--warn:#dca548;--warnbg:#2b2215;--vio:#a88ae0;--viobg:#231c33}}
:root[data-theme="dark"]{--paper:#0e1218;--card:#151a22;--sunk:#1b212b;--ink:#e8ecf2;--ink2:#a6b0be;
--ink3:#79828f;--rule:#29313d;--soft:#212833;--accent:#7ba3f8;--bad:#ef7168;--badbg:#331c1b;
--ok:#4dbf90;--okbg:#13281e;--warn:#dca548;--warnbg:#2b2215;--vio:#a88ae0;--viobg:#231c33}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
font:400 15px/1.6 "IBM Plex Sans",-apple-system,BlinkMacSystemFont,sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:34px 20px 90px}
h1,h2,h3{font-family:"IBM Plex Serif",Georgia,serif;margin:0;text-wrap:balance}
h1{font-size:31px;font-weight:700;letter-spacing:-.01em}
h2{font-size:21px;margin:0 0 4px}
code,.mono,.n{font-family:"IBM Plex Mono",ui-monospace,monospace}
.n{font-variant-numeric:tabular-nums}
a{color:var(--accent)}
.mast{border-bottom:2px solid var(--ink);padding-bottom:16px;margin-bottom:18px}
.eyebrow{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);font-weight:600}
.lede{color:var(--ink2);max-width:72ch;margin:10px 0 0;font-size:15px}
nav.toc{position:sticky;top:0;z-index:10;background:var(--paper);border-bottom:1px solid var(--rule);
padding:10px 0;margin-bottom:20px;display:flex;gap:6px;flex-wrap:wrap}
nav.toc a{font-size:12.5px;padding:6px 11px;border:1px solid var(--rule);background:var(--card);
text-decoration:none;color:var(--ink2)}
nav.toc a:hover{border-color:var(--accent);color:var(--accent)}
section{margin:0 0 42px;scroll-margin-top:58px}
.shead{border-bottom:1px solid var(--rule);padding-bottom:7px;margin-bottom:14px;
display:flex;align-items:baseline;gap:12px}
.shead .cnt{margin-left:auto;font-size:12.5px;color:var(--ink3)}
.sintro{color:var(--ink2);font-size:14px;max-width:74ch;margin:0 0 16px}
.figs{display:flex;flex-wrap:wrap;gap:1px;background:var(--rule);border:1px solid var(--rule);margin:16px 0}
.fig{background:var(--card);padding:12px 16px;flex:1;min-width:132px}
.fig .v{font:600 25px/1.1 "IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;display:block}
.fig .l{font-size:11.5px;color:var(--ink2)}
.fig.bad .v{color:var(--bad)}.fig.ok .v{color:var(--ok)}.fig.warn .v{color:var(--warn)}
.verdict{background:var(--card);border:1px solid var(--rule);border-left:4px solid var(--ink);padding:18px 22px}
.verdict p{margin:0 0 10px;max-width:76ch}.verdict p:last-child{margin-bottom:0}
.verdict .big{font-size:16px;font-weight:600}
.scroll{overflow-x:auto;border:1px solid var(--rule);background:var(--card)}
table.grid{border-collapse:collapse;width:100%;font-size:13px}
.grid th{background:var(--sunk);font:600 11px/1.3 "IBM Plex Sans",sans-serif;text-transform:uppercase;
letter-spacing:.05em;color:var(--ink3);text-align:left;padding:7px 9px;border-bottom:1px solid var(--rule);
white-space:nowrap}
.grid td{padding:6px 9px;border-bottom:1px solid var(--soft);vertical-align:top}
.grid td.k{font-family:"IBM Plex Mono",monospace;font-weight:600;white-space:nowrap}
.grid td.n{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;text-align:center;white-space:nowrap}
.grid td.c{color:var(--ink3);white-space:nowrap}
.grid td.mono{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink3)}
.grid td.ok{color:var(--ok)}.grid td.bad{color:var(--bad)}
.pats{display:flex;flex-direction:column;gap:11px}
.pat{background:var(--card);border:1px solid var(--rule);border-left:4px solid var(--ink3);padding:14px 17px}
.pat-critical{border-left-color:var(--bad)}.pat-high{border-left-color:var(--warn)}
.pat-good{border-left-color:var(--ok)}.pat-mid{border-left-color:var(--accent)}
.pat header{display:flex;align-items:center;gap:9px;margin-bottom:7px}
.pnum{font:700 13px/1 "IBM Plex Mono",monospace;background:var(--sunk);padding:4px 8px}
.pbadge{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;padding:3px 8px}
.b-critical{background:var(--badbg);color:var(--bad)}.b-high{background:var(--warnbg);color:var(--warn)}
.b-good{background:var(--okbg);color:var(--ok)}.b-mid{background:var(--sunk);color:var(--ink2)}
.ptext{margin:0 0 9px;max-width:80ch}
.pmeta,.prec{margin:0 0 6px;font-size:13.5px;color:var(--ink2);max-width:80ch}
.prec{background:var(--sunk);padding:8px 11px;border-left:2px solid var(--accent)}
.pruns{margin:6px 0 0;font-size:11.5px;color:var(--ink3);font-family:"IBM Plex Mono",monospace}
.errs{display:flex;flex-direction:column;gap:9px}
.err{background:var(--card);border:1px solid var(--rule);padding:11px 14px;border-left:3px solid var(--ink3)}
.err.s1{border-left-color:var(--bad)}.err.s2{border-left-color:var(--warn)}.err.s3{border-left-color:var(--vio)}
.err header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11.5px;margin-bottom:7px}
.enum{font-family:"IBM Plex Mono",monospace;color:var(--ink3);font-weight:600}
.estage{font-weight:600}
.err.s1 .estage{color:var(--bad)}.err.s2 .estage{color:var(--warn)}.err.s3 .estage{color:var(--vio)}
.ecat{background:var(--sunk);padding:2px 8px}
.ehit{background:var(--badbg);color:var(--bad);font-weight:700;padding:2px 8px}
.ewhere{color:var(--ink3)}.ephoto{margin-left:auto;font-family:"IBM Plex Mono",monospace;color:var(--ink3)}
.ecmp{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:7px}
@media(max-width:640px){.ecmp{grid-template-columns:1fr}}
.etruth,.ebot{padding:8px 10px;font-size:13px;border:1px solid var(--soft)}
.etruth{background:var(--okbg)}.ebot{background:var(--badbg)}
.el{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:3px}
.etruth .el{color:var(--ok)}.ebot .el{color:var(--bad)}
.econs,.ewhy{margin:0 0 5px;font-size:13px;color:var(--ink2);max-width:82ch}
.work{background:var(--card);border:1px solid var(--rule);margin-bottom:16px}
.whead{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:13px 16px 0}
.whead h3{font-size:17px;font-family:"IBM Plex Mono",monospace}
.wtest,.wtask,.wexp{font-size:12px;color:var(--ink3)}
.werr{margin-left:auto;font-size:12px;color:var(--bad);font-weight:600}
.wwhat{margin:5px 16px 0;font-size:13.5px;color:var(--ink2);max-width:78ch}
.wbody{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:16px;padding:13px 16px 16px}
@media(max-width:760px){.wbody{grid-template-columns:1fr}}
.wbody img{width:100%;border:1px solid var(--rule);background:#fff}
.werrrow{border-top:1px solid var(--soft);padding:8px 0;font-size:12.5px}
.es{font-size:10.5px;padding:1px 6px;background:var(--sunk);margin-right:6px}
.es.s1{color:var(--bad)}.es.s2{color:var(--warn)}.es.s3{color:var(--vio)}
.ecmp2{display:flex;flex-direction:column;gap:2px;margin-top:4px;color:var(--ink2)}
.ecmp2 span:first-child{color:var(--ok)}.ecmp2 span:last-child{color:var(--bad)}
.bar{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:13px}
.bar button{font:500 12.5px/1 "IBM Plex Sans",sans-serif;cursor:pointer;padding:7px 12px;
border:1px solid var(--rule);background:var(--card);color:var(--ink2)}
.bar button:hover{border-color:var(--accent);color:var(--accent)}
.bar button[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.bar button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.muted{color:var(--ink3);font-size:13px}
.hidden{display:none!important}
footer{margin-top:40px;padding-top:15px;border-top:1px solid var(--rule);font-size:12.5px;color:var(--ink3)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
"""

SCRIPT = """
(function(){
  var errs=[].slice.call(document.querySelectorAll('.err'));
  var btns=[].slice.call(document.querySelectorAll('.bar button'));
  function apply(f){
    errs.forEach(function(e){
      var keep=true;
      if(f==='hit') keep=e.dataset.hit==='1';
      else if(f!=='all') keep=(e.dataset.stage||'').indexOf(f)===0;
      e.classList.toggle('hidden',!keep);
    });
    btns.forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.f===f));});
    var n=errs.filter(function(e){return !e.classList.contains('hidden');}).length;
    document.getElementById('errcount').textContent=n+' из '+errs.length;
  }
  btns.forEach(function(b){b.addEventListener('click',function(){apply(b.dataset.f);});});
  apply('all');
})();
"""


def build(folder: pathlib.Path) -> str:
    xlsx = next(folder.rglob("*.xlsx"))
    sheets = read_sheets(xlsx)
    itog_doc = read_docx(next(iter(folder.rglob("ИТОГ.docx")), folder / "_"))
    photos = {p.name: p for p in folder.rglob("*.jpg")}
    photos.update({p.name: p for p in folder.rglob("*.png")})

    n_logs = len(list((folder / "логи").glob("*.json")))
    logs = as_dicts(sheets.get("Логи", []))
    runs = as_dicts(sheets.get("Прогоны", []))
    errors = as_dicts(sheets.get("Ошибки", []))
    tests = as_dicts(sheets.get("Тестовый набор", []))
    ideas = as_dicts(sheets.get("Идеи", []))

    errs_html, by_stage, by_cause = errors_section(sheets.get("Ошибки", []))
    verdict_paras = [p for p in itog_doc if not p.endswith(":")][1:]

    # headline numbers, taken from «Итог» rather than recomputed: the tester's
    # own denominators exclude the negative tests, and quietly using different
    # ones would put two different truths in one archive.
    itog = sheets.get("Итог", [])
    mode = {}
    for r in itog:
        if r and r[0] in ("Фото", "Текст") and len(r) > 3:
            mode[r[0]] = r
    photo_row, text_row = mode.get("Фото", []), mode.get("Текст", [])

    def acc(row, i, j):
        try:
            return f"{int(row[i]) / int(row[j]) * 100:.0f}%"
        except (ValueError, IndexError, ZeroDivisionError, TypeError):
            return "—"

    parts = [
        "<title>Отчёт по тестированию бота</title>",
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
        'family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:wght@600;700&'
        'family=IBM+Plex+Mono:wght@400;500;600&display=swap">',
        f"<style>{CSS}</style>",
        '<div class="wrap">',
        '<header class="mast"><div class="eyebrow">Бот-проверяющий ЕГЭ · профильная математика · '
        'сессия 12–13 сентября 2026</div><h1>Отчёт по тестированию</h1>'
        f'<p class="lede">Собрано из материалов тестировщика: таблица на десяти листах, '
        f'итоговый документ, {len(photos)} снимков работ и {n_logs} журналов прогонов. '
        f'Разделы ниже — его выводы и его разбор ошибок; ничего не пересчитывалось '
        f'заново.</p></header>',
        '<nav class="toc">'
        '<a href="#verdict">Вывод</a><a href="#numbers">Цифры</a>'
        '<a href="#patterns">18 закономерностей</a><a href="#errors">Каталог ошибок</a>'
        '<a href="#works">Работы и фото</a><a href="#configs">Конфигурации</a>'
        '<a href="#tests">Тест-набор</a><a href="#bugs">Баги и идеи</a></nav>',
    ]

    # --- verdict
    parts.append('<section id="verdict"><div class="shead"><h2>Вывод тестировщика</h2></div>'
                 '<div class="verdict">'
                 + "".join(
                     f'<p class="{"big" if i == 0 else ""}">{esc(p)}</p>'
                     for i, p in enumerate(verdict_paras)
                 )
                 + "</div></section>")

    # --- numbers
    parts.append(
        '<section id="numbers"><div class="shead"><h2>Цифры</h2></div>'
        '<p class="sintro">Главное разделение — не по заданиям и не по флагам, а по тому, '
        'пришла работа фотографией или текстом.</p>'
        '<div class="figs">'
        f'<div class="fig"><span class="v">{esc(len(logs))}</span><span class="l">прогонов</span></div>'
        f'<div class="fig"><span class="v">{esc(len(tests))}</span><span class="l">тестов</span></div>'
        f'<div class="fig bad"><span class="v">{esc(len(errors))}</span>'
        '<span class="l">ошибок разобрано</span></div>'
        f'<div class="fig"><span class="v">{esc(photo_row[1] if len(photo_row) > 1 else "—")}</span>'
        '<span class="l">прогонов по фото</span></div>'
        f'<div class="fig"><span class="v">{esc(text_row[1] if len(text_row) > 1 else "—")}</span>'
        '<span class="l">прогонов текстом</span></div>'
        "</div>"
        '<div class="scroll"><table class="grid"><thead><tr><th>режим</th><th>прогонов</th>'
        "<th>базовая совпала</th><th>полностью совпала</th><th>точность: базовая</th>"
        "<th>точность: полная</th></tr></thead><tbody>"
        + "".join(
            f"<tr><td class=k>{esc(r[0])}</td><td class=n>{esc(r[1])}</td>"
            f"<td class=n>{esc(r[2])}</td><td class=n>{esc(r[3])}</td>"
            f"<td class=\"n {'bad' if r[0] == 'Фото' else 'ok'}\">{acc(r, 2, 1)}</td>"
            f"<td class=\"n {'bad' if r[0] == 'Фото' else 'ok'}\">{acc(r, 3, 1)}</td></tr>"
            for r in (photo_row, text_row) if r
        )
        + "</tbody></table></div></section>"
    )

    # --- 18 patterns
    parts.append('<section id="patterns"><div class="shead"><h2>18 закономерностей</h2>'
                 '<span class="cnt">лист «Сводка»</span></div>'
                 '<p class="sintro">Разбор тестировщика: что именно ломается, на каких прогонах '
                 'это видно и что он предлагает сделать. Полоса слева — оценка влияния.</p>'
                 + findings_section(sheets.get("Сводка", [])) + "</section>")

    # --- errors
    stage_btns = "".join(
        f'<button data-f="{esc(s)}">{esc(s)} ({n})</button>'
        for s, n in sorted(by_stage.items()) if s
    )
    parts.append(
        '<section id="errors"><div class="shead"><h2>Каталог ошибок</h2>'
        f'<span class="cnt" id="errcount">{len(errors)}</span></div>'
        '<p class="sintro">Каждая ошибка разобрана вручную: что на листе, что выдал бот, '
        'чего это стоило и почему так вышло. Зелёное — как на самом деле, красное — что прочитал '
        'или написал бот.</p>'
        f'<div class="bar"><button data-f="all">Все</button>'
        f'<button data-f="hit">Стоили балла</button>{stage_btns}</div>'
        + errs_html + "</section>"
    )

    # --- works
    parts.append('<section id="works"><div class="shead"><h2>Работы и фотографии</h2>'
                 f'<span class="cnt">{len(photos)} файлов</span></div>'
                 '<p class="sintro">Каждый снимок, все прогоны по нему и зафиксированные '
                 'на нём ошибки распознавания.</p>'
                 + work_sections(logs, runs, errors, tests, photos) + "</section>")

    # --- configs
    parts.append('<section id="configs"><div class="shead"><h2>Конфигурации флагов</h2></div>'
                 '<p class="sintro">Точность посчитана на текстовом наборе: 13 тестов, '
                 'первый прогон в каждой конфигурации. Флаги этапа 1 (K6, K7) мерились только '
                 'на фото — 7 прогонов.</p>'
                 + config_table(sheets.get("Конфигурации", []), itog) + "</section>")

    # --- tests
    parts.append('<section id="tests"><div class="shead"><h2>Тестовый набор</h2>'
                 f'<span class="cnt">{len(tests)}</span></div>'
                 '<p class="sintro">А…Л — верные решения, X1–X7 — с внесёнными ошибками, '
                 'P14–P21 и M1–M4 — фотографии и негативные тесты.</p>'
                 + tests_table(tests) + "</section>")

    # --- bugs and ideas
    bug_items = "".join(
        f"<li>{esc(p)}</li>" for p in itog_doc
        if p.startswith(("Если на фото", "Уверенность бота"))
    )
    idea_items = "".join(
        f'<li><b>{esc(i.get("Идея / замечание"))}</b><br>'
        f'<span class="muted">{esc(i.get("Что предлагается / проверить"))} · '
        f'{esc(i.get("Статус"))}</span></li>'
        for i in ideas if i.get("Идея / замечание")
    )
    parts.append(
        '<section id="bugs"><div class="shead"><h2>Баги и идеи</h2></div>'
        f'<div class="verdict"><p><b>Баги бэкенда.</b></p><ul>{bug_items}</ul>'
        + (f"<p><b>Идеи тестировщика.</b></p><ul>{idea_items}</ul>" if idea_items else "")
        + "</div></section>"
    )

    parts.append(
        "<footer>Источники: «Тесты бота-проверяющего.xlsx» (листы "
        + ", ".join(f"«{esc(n)}»" for n in sheets)
        + "), ИТОГ.docx, папка «логи» и снимки работ. Фотографии на странице уменьшены; "
        "оригиналы — в папке «фото».</footer></div>"
        f"<script>{SCRIPT}</script>"
    )
    return "\n".join(parts)


def main() -> None:
    folder = pathlib.Path(sys.argv[1])
    dest = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "full-report.html")
    dest.write_text(build(folder), encoding="utf-8")
    print(f"{dest} ({dest.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
