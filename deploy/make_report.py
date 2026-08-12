#!/usr/bin/env python3
"""Render the test-session report.

    python deploy/make_report.py <folder> <out.html>

Written text comes from `report_content.py`; verbatim material — the 24 run
verdicts, the 18 patterns, the 115 errors, the configuration table — is read
out of the tester's workbook so it is quoted rather than retyped.
"""

from __future__ import annotations

import base64
import html
import io
import pathlib
import re
import sys
from collections import Counter, defaultdict
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import report_content as C  # noqa: E402

E = html.escape


def esc(v: Any) -> str:
    return E(str(v if v is not None else ""))


def sheets_of(xlsx: pathlib.Path) -> dict[str, list[list[str]]]:
    from openpyxl import load_workbook

    wb = load_workbook(xlsx, data_only=True, read_only=True)
    out = {}
    for name in wb.sheetnames:
        rows = [
            [("" if c is None else str(c).strip()) for c in row]
            for row in wb[name].iter_rows(values_only=True)
        ]
        out[name] = [r for r in rows if any(r)]
    wb.close()
    return out


def dicts(rows: list[list[str]]) -> list[dict[str, str]]:
    if not rows:
        return []
    head = rows[0]
    return [
        {h: (r[i] if i < len(r) else "") for i, h in enumerate(head) if h}
        for r in rows[1:]
    ]


def img(path: pathlib.Path, max_w: int = 760, q: int = 66) -> str:
    from PIL import Image

    im = Image.open(path)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def load_logs(folder: pathlib.Path) -> dict[str, dict]:
    """The run reports the bot itself produced, keyed by request_id."""
    import json

    out = {}
    for p in (folder / "логи").glob("*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            out[d.get("request_id", p.stem)] = d
        except Exception:  # noqa: BLE001
            continue
    return out


def err_card(e: dict[str, str], compact: bool = False) -> str:
    """One catalogued defect. `compact` is the form used inside a run."""
    hit = e.get("Влияет на балл?", "").lower().startswith("да")
    stage = e.get("Этап", "")
    cls = {"1 Распознавание": "s1", "2 Анализ": "s2", "3 Оценивание": "s3"}.get(stage, "sx")
    head = (
        f'<header><span class="en">#{esc(e.get("№"))}</span>'
        f'<span class="es">{esc(stage)}</span>'
        f'<span class="ec">{esc(e.get("Категория"))}</span>'
        + ('<span class="eh">стоило балла</span>' if hit else "")
        + f'<span class="ew">{esc(e.get("Где (строка / элемент)"))}</span>'
        + ("" if compact or not e.get("Фото прогона")
           else f'<span class="ep">{esc(e.get("Фото прогона"))}</span>')
        + "</header>"
    )
    body = (
        f'<div class="cmp"><div class="t"><span>на листе</span>'
        f'{esc(e.get("Как на самом деле (фото / верно)"))}</div>'
        f'<div class="b"><span>бот выдал</span>{esc(e.get("Что выдал бот"))}</div></div>'
        + (f'<p class="ecn">{esc(e.get("Последствие (находки, баллы)"))}</p>'
           if e.get("Последствие (находки, баллы)") else "")
        + f'<p class="ecz"><b>{esc(e.get("Предполагаемая причина") or "—")}</b>'
        + (f' · {esc(e.get("Доп. причина"))}' if e.get("Доп. причина") else "")
        + f' · уверенность {esc(e.get("Уверенность в причине") or "—").lower()}'
        + (f' — {esc(e.get("Обоснование причины / рекомендация"))}'
           if e.get("Обоснование причины / рекомендация") else "")
        + "</p>"
    )
    attrs = ("" if compact else
             f' data-stage="{esc(stage)}" data-hit="{1 if hit else 0}"'
             f' data-cause="{esc(e.get("Предполагаемая причина"))}"')
    return f'<article class="err {cls}{" cmpct" if compact else ""}"{attrs}>{head}{body}</article>'


def json_detail(log: dict) -> str:
    """What the bot actually produced, from its own run report.

    Collapsed: it is the evidence behind the verdict above, wanted when you
    disagree with a grade and noise the rest of the time.
    """
    if not log:
        return ""
    g = log.get("grades") or {}
    base, pres = g.get("base") or {}, g.get("presentation") or {}
    fi = log.get("findings") or []
    finds = "".join(
        f'<li><code>{esc(f.get("id"))}</code> <b>{esc(f.get("type"))}</b> · '
        f'{"оформление" if f.get("is_defensible") else "содержание"} · '
        f'{esc(f.get("severity"))}<br>{esc(f.get("what"))}'
        + (f'<br><span class="fix">как надо: {esc(f.get("correct_version"))}</span>'
           if f.get("correct_version") else "")
        + "</li>"
        for f in fi
    )
    stages = "".join(
        f"<tr><td>{esc(st.get('stage'))}</td>"
        f"<td class=\"n\">{(st.get('latency_ms') or 0)/1000:.1f} с</td>"
        f"<td class=\"n\">{(st.get('usage') or {}).get('total_tokens', 0)}</td>"
        f"<td class=\"n\">{(st.get('usage') or {}).get('reasoning_tokens', 0)}</td>"
        f"<td class=\"n\">{esc(st.get('attempts'))}</td></tr>"
        for st in (log.get("stages") or [])
    )
    notes = "".join(f"<li>{esc(n)}</li>" for n in (log.get("notes") or []))
    return (
        '<details class="jd"><summary>Что выдал бот: расшифровка, находки, обоснования '
        f'({len(fi)} находок)</summary><div class="jdb">'
        + (f'<h4>Этап 1 — расшифровка</h4><pre>{esc(log.get("transcript"))}</pre>'
           if log.get("transcript") else
           '<p class="muted">Этап 1 не выполнялся — решение подано текстом.</p>')
        + (f'<h4>Этап 2 — находки</h4><ul class="fl">{finds}</ul>' if finds else "")
        + '<h4>Этап 3 — обоснования</h4>'
        + f'<p class="jg"><b>За решение {esc(base.get("score"))}.</b> '
          f'{esc(base.get("justification"))}<br>'
          f'<span class="crit">{esc(base.get("criterion_matched"))}</span></p>'
        + f'<p class="jg"><b>С оформлением {esc(pres.get("score"))}.</b> '
          f'{esc(pres.get("justification"))}<br>'
          f'<span class="crit">{esc(pres.get("criterion_matched"))}</span></p>'
        + (f'<p class="jg"><b>Итог ученику.</b> {esc(g.get("summary"))}</p>'
           if g.get("summary") else "")
        + (f'<h4>Этапы</h4><table><thead><tr><th>этап</th><th>время</th><th>токены</th>'
           f'<th>рассуждений</th><th>попыток</th></tr></thead><tbody>{stages}</tbody></table>'
           if stages else "")
        + (f'<h4>Заметки пайплайна</h4><ul class="nl">{notes}</ul>' if notes else "")
        + "</div></details>"
    )


def num(x: Any) -> float:
    try:
        return float(str(x).replace(",", ".") or 0)
    except ValueError:
        return 0.0


# --- blocks -----------------------------------------------------------------
def priorities_html() -> str:
    out = []
    for p in C.PRIORITIES:
        todo = "".join(f"<li>{t}</li>" for t in p["todo"])
        out.append(
            f'<article class="pri" id="p{p["n"]}">'
            f'<div class="phead"><span class="pn">{p["n"]}</span>'
            f'<h3>{esc(p["title"])}</h3>'
            f'<span class="pwhere">{esc(p["where"])}</span>'
            f'<span class="pcost">{esc(p["cost"])}</span></div>'
            f'<p class="pwhy">{p["why"]}</p>'
            f'<p class="pev"><b>Чем подтверждается.</b> {p["evidence"]}</p>'
            f'<ul class="ptodo">{todo}</ul></article>'
        )
    return "".join(out)


def runs_html(runs: list[dict[str, str]], photos: dict[str, pathlib.Path],
              logs: list[dict[str, str]], errs: list[dict[str, str]],
              jlogs: dict[str, dict]) -> str:
    """24 detailed runs, grouped by the work — the tester's own grouping.

    Grouping by work rather than by run number is what makes the instability
    visible: the same solution photographed three ways scored 1/1, 2/1 and 0/0.
    """
    by_id = {l.get("request_id", ""): l for l in logs}
    # Defects belong beside the photograph they were found on, not in a list
    # at the other end of the page: the comparison «на листе / бот выдал» only
    # means something with the sheet in view.
    errs_by_run: dict[str, list[dict[str, str]]] = defaultdict(list)
    for e in errs:
        errs_by_run[(e.get("Прогон №") or "").strip()].append(e)
    by_work: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in runs:
        work = r.get("Работа (одна буква = одно и то же решение)", "").strip() or "—"
        # one row has the verdict text pasted into the file column as well;
        # the work name is still the last field, so key on its first token
        by_work[work.split("|")[-1].strip()].append(r)

    out = []
    for work, group in by_work.items():
        scores = {f'{g.get("Бот: решение")}/{g.get("Бот: оформление")}' for g in group}
        unstable = len(scores) > 1 and len(group) > 1
        cards = []
        for r in group:
            # Photo names come from «Логи», keyed by request_id: that column is
            # clean, whereas one row of «Прогоны» has the verdict text pasted
            # into its file cell, and a text run there names the photo it was
            # transcribed *from* — both would attach the wrong image.
            log = by_id.get(r.get("request_id", ""), {})
            field = log.get("Фото", "")
            files = [] if field.strip() in ("", "—") else re.findall(
                r"\d+(?:\.\d+)?\.jpg", field
            )
            shots = "".join(
                f'<img src="{img(photos[f])}" alt="{esc(f)}" loading="lazy">'
                for f in files if f in photos
            )
            got = f'{r.get("Бот: решение")}/{r.get("Бот: оформление")}'
            want = f'{r.get("Ожид. балл: решение")}/{r.get("Ожид. балл: оформление")}'
            ok = got == want
            verdict = r.get("Вердикт по прогону", "")
            mine = errs_by_run.get((r.get("№") or "").strip(), [])
            tone = ("ok" if verdict.startswith("Бот прав")
                    else "part" if verdict.startswith(("Частично", "Баллы совпали", "Балл верный"))
                    else "bad")
            cards.append(
                f'<article class="run r-{tone}">'
                f'<div class="rhead"><span class="rn">прогон {esc(r.get("№"))}</span>'
                f'<span class="rtask">зад. {esc(r.get("Задание №"))}</span>'
                f'<span class="rscore {"" if ok else "off"}">{esc(got)}'
                f'<i> ждали {esc(want)}</i></span>'
                f'<span class="rmeta">{esc(r.get("Уверенность бота"))} увер. · '
                f'{esc(r.get("Время, с"))} с · {esc(r.get("Токены"))} ток.</span></div>'
                f'<p class="rshoot">{esc(r.get("Фото (кол-во, условия съёмки)"))}</p>'
                + (f'<div class="rshots">{shots}</div>' if shots else "")
                + f'<blockquote class="rverd"><span class="vq">вердикт тестировщика</span>'
                  f'{esc(verdict)}</blockquote>'
                + (f'<div class="rerrs"><div class="reh">Ошибки на этом прогоне '
                   f'({len(mine)}, из них стоили балла '
                   f'{sum(1 for x in mine if x.get("Влияет на балл?", "").lower().startswith("да"))})'
                   f'</div>{"".join(err_card(x, compact=True) for x in mine)}</div>'
                   if mine else "")
                + json_detail(jlogs.get(r.get("request_id", "")))
                + "</article>"
            )
        out.append(
            f'<section class="work"><div class="whead"><h3>{esc(work)}</h3>'
            f'<span class="wn">{len(group)} прогон(ов)</span>'
            + ('<span class="wunstable">оценка нестабильна: '
               + esc(", ".join(sorted(scores))) + "</span>" if unstable else "")
            + f'</div><div class="wruns">{"".join(cards)}</div></section>'
        )
    return "".join(out)


def patterns_html(svodka: list[list[str]]) -> str:
    hdr = next(i for i, r in enumerate(svodka) if "Закономерность" in r)
    b = svodka[hdr].index("Закономерность")
    out = []
    for r in svodka[hdr + 1 :]:
        if len(r) <= b or not r[b].strip():
            continue
        n, text = r[b - 1], r[b]
        runs = r[b + 1] if len(r) > b + 1 else ""
        imp = r[b + 2] if len(r) > b + 2 else ""
        rec = r[b + 3] if len(r) > b + 3 else ""
        tone = ("crit" if imp.startswith("Критич") else "good" if imp.startswith("Позитив")
                else "high" if imp.startswith("Высок") else "mid")
        label = {"crit": "критично", "high": "высокое", "mid": "среднее", "good": "позитив"}[tone]
        out.append(
            f'<article class="pat t-{tone}"><header><span class="pnum">{esc(n)}</span>'
            f'<span class="ptag">{label}</span></header>'
            f'<p>{esc(text)}</p>'
            + (f'<p class="pi"><b>Влияние.</b> {esc(imp)}</p>' if imp else "")
            + (f'<p class="pr"><b>Что делать.</b> {esc(rec)}</p>' if rec else "")
            + (f'<p class="pru">прогоны: {esc(runs)}</p>' if runs else "")
            + "</article>"
        )
    return "".join(out)


def errors_html(errs: list[dict[str, str]]) -> str:
    return "".join(err_card(e) for e in errs if e.get("Категория"))


def _unused(errs: list[dict[str, str]]) -> str:
    out = []
    for e in errs:
        if not e.get("Категория"):
            continue
        hit = e.get("Влияет на балл?", "").lower().startswith("да")
        stage = e.get("Этап", "")
        cls = {"1 Распознавание": "s1", "2 Анализ": "s2", "3 Оценивание": "s3"}.get(stage, "sx")
        out.append(
            f'<article class="err {cls}" data-stage="{esc(stage)}" data-hit="{1 if hit else 0}" '
            f'data-cause="{esc(e.get("Предполагаемая причина"))}">'
            f'<header><span class="en">#{esc(e.get("№"))}</span>'
            f'<span class="es">{esc(stage)}</span>'
            f'<span class="ec">{esc(e.get("Категория"))}</span>'
            + ('<span class="eh">стоило балла</span>' if hit else "")
            + f'<span class="ew">{esc(e.get("Где (строка / элемент)"))}</span>'
            + (f'<span class="ep">{esc(e.get("Фото прогона"))}</span>'
               if e.get("Фото прогона") else "")
            + "</header>"
            f'<div class="cmp"><div class="t"><span>на листе</span>'
            f'{esc(e.get("Как на самом деле (фото / верно)"))}</div>'
            f'<div class="b"><span>бот выдал</span>{esc(e.get("Что выдал бот"))}</div></div>'
            + (f'<p class="ecn">{esc(e.get("Последствие (находки, баллы)"))}</p>'
               if e.get("Последствие (находки, баллы)") else "")
            + f'<p class="ecz"><b>{esc(e.get("Предполагаемая причина") or "—")}</b>'
            + (f' · {esc(e.get("Доп. причина"))}' if e.get("Доп. причина") else "")
            + f' · уверенность {esc(e.get("Уверенность в причине") or "—").lower()}'
            + (f' — {esc(e.get("Обоснование причины / рекомендация"))}'
               if e.get("Обоснование причины / рекомендация") else "")
            + "</p></article>"
        )
    return "".join(out)


CSS = """
:root{--paper:#f7f8fa;--card:#fff;--sunk:#eef1f6;--ink:#13171e;--ink2:#4a5462;--ink3:#7a838f;
--rule:#d8dee6;--soft:#e7ebf1;--accent:#2f5fd0;--bad:#c4302a;--badbg:#fbeae8;--ok:#15754e;
--okbg:#e6f2ec;--warn:#a2660c;--warnbg:#fbf2e3;--vio:#6d4aa8;--viobg:#f0ebf9}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){
--paper:#0e1218;--card:#151a22;--sunk:#1b212b;--ink:#e8ecf2;--ink2:#a6b0be;--ink3:#79828f;
--rule:#29313d;--soft:#212833;--accent:#7ba3f8;--bad:#ef7168;--badbg:#331c1b;--ok:#4dbf90;
--okbg:#13281e;--warn:#dca548;--warnbg:#2b2215;--vio:#a88ae0;--viobg:#231c33}}
:root[data-theme="dark"]{--paper:#0e1218;--card:#151a22;--sunk:#1b212b;--ink:#e8ecf2;
--ink2:#a6b0be;--ink3:#79828f;--rule:#29313d;--soft:#212833;--accent:#7ba3f8;--bad:#ef7168;
--badbg:#331c1b;--ok:#4dbf90;--okbg:#13281e;--warn:#dca548;--warnbg:#2b2215;--vio:#a88ae0;--viobg:#231c33}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
font:400 16px/1.62 "IBM Plex Sans",-apple-system,BlinkMacSystemFont,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:38px 20px 90px}
h1,h2,h3{font-family:"IBM Plex Serif",Georgia,serif;margin:0;text-wrap:balance}
h1{font-size:33px;font-weight:700;letter-spacing:-.015em}
h2{font-size:23px}h3{font-size:17px}
code{font-family:"IBM Plex Mono",monospace;font-size:.92em;background:var(--sunk);padding:1px 5px}
a{color:var(--accent)}
.mast{border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:22px}
.eyebrow{font-size:11.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink3);font-weight:600}
.lede{color:var(--ink2);max-width:68ch;margin:12px 0 0}
.headline{font-family:"IBM Plex Serif",Georgia,serif;font-size:20px;line-height:1.45;
margin:22px 0 0;max-width:62ch;font-weight:600}
nav{position:sticky;top:0;z-index:10;background:var(--paper);border-bottom:1px solid var(--rule);
padding:10px 0;margin:22px 0 26px;display:flex;gap:6px;flex-wrap:wrap}
nav a{font-size:12.5px;padding:6px 11px;border:1px solid var(--rule);background:var(--card);
text-decoration:none;color:var(--ink2)}
nav a:hover{border-color:var(--accent);color:var(--accent)}
section.lvl{margin:0 0 46px;scroll-margin-top:60px}
.sh{border-bottom:1px solid var(--rule);padding-bottom:8px;margin-bottom:16px;
display:flex;align-items:baseline;gap:12px}
.sh .c{margin-left:auto;font-size:12.5px;color:var(--ink3)}
.intro{color:var(--ink2);font-size:15px;max-width:70ch;margin:0 0 20px}
.key{background:var(--card);border:1px solid var(--rule);border-left:4px solid var(--bad);
padding:17px 21px;margin:0 0 22px}
.key p{margin:0;max-width:72ch}
.good-box{border-left-color:var(--ok)}
.figs{display:flex;flex-wrap:wrap;gap:1px;background:var(--rule);border:1px solid var(--rule);margin:0 0 20px}
.fig{background:var(--card);padding:13px 17px;flex:1;min-width:126px}
.fig .v{font:600 25px/1.1 "IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;display:block}
.fig .l{font-size:11.5px;color:var(--ink2)}
.fig.bad .v{color:var(--bad)}.fig.ok .v{color:var(--ok)}
table{border-collapse:collapse;width:100%;font-size:13.5px;background:var(--card)}
.scroll{overflow-x:auto;border:1px solid var(--rule);margin-bottom:18px}
th{background:var(--sunk);font:600 11px/1.3 "IBM Plex Sans",sans-serif;text-transform:uppercase;
letter-spacing:.05em;color:var(--ink3);text-align:left;padding:8px 10px;
border-bottom:1px solid var(--rule);white-space:nowrap}
td{padding:7px 10px;border-bottom:1px solid var(--soft);vertical-align:top}
td.k{font-family:"IBM Plex Mono",monospace;font-weight:600;white-space:nowrap}
td.n{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;text-align:center;white-space:nowrap}
td.bad{color:var(--bad);font-weight:600}td.ok{color:var(--ok);font-weight:600}
.pri{background:var(--card);border:1px solid var(--rule);border-left:4px solid var(--accent);
padding:16px 20px;margin-bottom:13px}
.phead{display:flex;align-items:baseline;gap:11px;flex-wrap:wrap;margin-bottom:9px}
.pn{font:700 15px/1 "IBM Plex Mono",monospace;background:var(--accent);color:#fff;padding:5px 9px}
.pwhere{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink3)}
.pcost{margin-left:auto;font-size:11.5px;color:var(--warn);font-weight:600}
.pwhy{margin:0 0 9px;max-width:74ch}
.pev{margin:0 0 9px;font-size:14px;color:var(--ink2);background:var(--sunk);padding:9px 12px;max-width:76ch}
.ptodo{margin:0;padding-left:20px;font-size:14px;color:var(--ink2)}
.ptodo li{margin-bottom:3px}
.work{margin-bottom:22px}
.whead{display:flex;align-items:baseline;gap:11px;margin-bottom:9px}
.whead h3{font-size:16px}
.wn{font-size:12px;color:var(--ink3)}
.wunstable{margin-left:auto;font-size:12px;color:var(--bad);font-weight:600;
background:var(--badbg);padding:2px 9px}
.wruns{display:flex;flex-direction:column;gap:9px}
.run{background:var(--card);border:1px solid var(--rule);border-left:3px solid var(--ink3);padding:13px 16px}
.r-bad{border-left-color:var(--bad)}.r-ok{border-left-color:var(--ok)}.r-part{border-left-color:var(--warn)}
.rhead{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px;font-size:12.5px}
.rn{font-weight:700;font-family:"IBM Plex Mono",monospace}
.rtask{color:var(--ink3)}
.rscore{font-family:"IBM Plex Mono",monospace;font-weight:700;font-size:15px;margin-left:auto}
.rscore.off{color:var(--bad)}
.rscore i{font-style:normal;font-weight:400;font-size:11.5px;color:var(--ink3);margin-left:5px}
.rmeta{width:100%;font-size:11.5px;color:var(--ink3);font-family:"IBM Plex Mono",monospace}
.rshoot{margin:0 0 9px;font-size:13px;color:var(--ink2);max-width:78ch}
.rshots{display:flex;gap:9px;margin-bottom:10px;overflow-x:auto}
.rshots img{max-height:260px;border:1px solid var(--rule);background:#fff}
.rverd{margin:0;padding:11px 14px;background:var(--badbg);border-left:3px solid var(--bad);
font-size:14.5px;line-height:1.55;max-width:80ch}
.r-ok .rverd{background:var(--okbg);border-left-color:var(--ok)}
.r-part .rverd{background:var(--warnbg);border-left-color:var(--warn)}
.vq{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.09em;font-weight:700;
margin-bottom:4px;color:var(--bad)}
.r-ok .vq{color:var(--ok)}.r-part .vq{color:var(--warn)}
.pat{background:var(--card);border:1px solid var(--rule);border-left:4px solid var(--ink3);
padding:14px 18px;margin-bottom:10px}
.t-crit{border-left-color:var(--bad)}.t-high{border-left-color:var(--warn)}
.t-good{border-left-color:var(--ok)}.t-mid{border-left-color:var(--accent)}
.pat header{display:flex;gap:9px;align-items:center;margin-bottom:7px}
.pnum{font:700 13px/1 "IBM Plex Mono",monospace;background:var(--sunk);padding:4px 8px}
.ptag{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;padding:3px 8px}
.t-crit .ptag{background:var(--badbg);color:var(--bad)}
.t-high .ptag{background:var(--warnbg);color:var(--warn)}
.t-good .ptag{background:var(--okbg);color:var(--ok)}
.t-mid .ptag{background:var(--sunk);color:var(--ink2)}
.pat p{margin:0 0 7px;max-width:80ch}
.pi,.pr{font-size:14px;color:var(--ink2)}
.pr{background:var(--sunk);padding:8px 11px;border-left:2px solid var(--accent)}
.pru{font-size:11.5px;color:var(--ink3);font-family:"IBM Plex Mono",monospace;margin:0}
.bar{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}
.bar button{font:500 12.5px/1 "IBM Plex Sans",sans-serif;cursor:pointer;padding:7px 12px;
border:1px solid var(--rule);background:var(--card);color:var(--ink2)}
.bar button:hover{border-color:var(--accent);color:var(--accent)}
.bar button[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.bar button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.err{background:var(--card);border:1px solid var(--rule);border-left:3px solid var(--ink3);
padding:11px 14px;margin-bottom:8px}
.err.s1{border-left-color:var(--bad)}.err.s2{border-left-color:var(--warn)}.err.s3{border-left-color:var(--vio)}
.err header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11.5px;margin-bottom:7px}
.en{font-family:"IBM Plex Mono",monospace;color:var(--ink3);font-weight:600}
.es{font-weight:600}.err.s1 .es{color:var(--bad)}.err.s2 .es{color:var(--warn)}.err.s3 .es{color:var(--vio)}
.ec{background:var(--sunk);padding:2px 8px}
.eh{background:var(--badbg);color:var(--bad);font-weight:700;padding:2px 8px}
.ew{color:var(--ink3)}
.ep{margin-left:auto;font-family:"IBM Plex Mono",monospace;color:var(--ink3)}
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:7px}
@media(max-width:640px){.cmp{grid-template-columns:1fr}}
.cmp>div{padding:8px 11px;font-size:13px;border:1px solid var(--soft)}
.cmp .t{background:var(--okbg)}.cmp .b{background:var(--badbg)}
.cmp span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;
font-weight:700;margin-bottom:3px}
.cmp .t span{color:var(--ok)}.cmp .b span{color:var(--bad)}
.ecn,.ecz{margin:0 0 4px;font-size:13px;color:var(--ink2);max-width:84ch}
.hidden{display:none!important}
footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--rule);font-size:12.5px;color:var(--ink3)}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media(max-width:640px){.wrap{padding:22px 13px 60px}h1{font-size:25px}.rshots img{max-height:190px}}
"""

JS = """
(function(){var es=[].slice.call(document.querySelectorAll('.err')),
b=[].slice.call(document.querySelectorAll('.bar button')),c=document.getElementById('ec');
function f(k,v){es.forEach(function(e){
var keep = k==='all' ? true : k==='hit' ? e.dataset.hit==='1'
 : k==='cause' ? e.dataset.cause===v : e.dataset.stage===v;
e.classList.toggle('hidden',!keep);});
b.forEach(function(x){x.setAttribute('aria-pressed',String(x.dataset.k===k&&x.dataset.v===v));});
c.textContent=es.filter(function(e){return !e.classList.contains('hidden');}).length+' из '+es.length;}
b.forEach(function(x){x.addEventListener('click',function(){f(x.dataset.k,x.dataset.v);});});
f('all','');})();
"""


EXTRA_CSS = """
.rerrs{margin-top:11px;border-top:1px solid var(--soft);padding-top:10px}
.reh{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;
color:var(--bad);margin-bottom:7px}
.err.cmpct{margin-bottom:7px;padding:9px 12px;background:var(--sunk)}
.err.cmpct .cmp{gap:7px;margin-bottom:5px}
.err.cmpct .cmp>div{padding:7px 9px;font-size:12.5px}
.err.cmpct .ecn,.err.cmpct .ecz{font-size:12.5px}
details.jd{margin-top:11px;border-top:1px solid var(--soft);padding-top:9px}
details.jd>summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--accent)}
details.jd>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.jdb{padding-top:10px}
.jdb h4{font:600 11px/1.3 "IBM Plex Sans",sans-serif;text-transform:uppercase;
letter-spacing:.07em;color:var(--ink3);margin:13px 0 6px}
.jdb h4:first-child{margin-top:0}
.jdb pre{background:var(--sunk);border:1px solid var(--soft);padding:11px 13px;font-size:12px;
line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto;margin:0}
.fl{margin:0;padding-left:19px;font-size:13px;color:var(--ink2)}
.fl li{margin-bottom:6px}
.fl code{font-weight:600}
.fix{color:var(--ink3);font-size:12.5px}
.jg{margin:0 0 8px;font-size:13.5px;max-width:80ch}
.crit{color:var(--ink3);font-size:12.5px;font-style:italic}
.nl{margin:0;padding-left:19px;font-size:12.5px;color:var(--ink3)}
.jdb table{font-size:12.5px;border:1px solid var(--soft)}
"""


def build(folder: pathlib.Path) -> str:
    S = sheets_of(next(folder.rglob("*.xlsx")))
    runs = dicts(S["Прогоны"])
    logs = dicts(S["Логи"])
    errs = [e for e in dicts(S["Ошибки"]) if e.get("Категория")]
    photos = {p.name: p for p in folder.rglob("*.jpg")}
    jlogs = load_logs(folder)

    photo_runs = [r for r in logs if r.get("Режим") == "фото"]
    text_runs = [r for r in logs if r.get("Режим") == "текст"]
    tok = sum(num(r.get("Токены")) for r in logs)
    rtok = sum(num(r.get("Токены рассуждений")) for r in logs)
    secs = sum(num(r.get("Время, с")) for r in logs)
    by_cause = Counter(e.get("Предполагаемая причина", "") for e in errs)
    hit_by_cause = Counter(
        e.get("Предполагаемая причина", "") for e in errs
        if e.get("Влияет на балл?", "").lower().startswith("да")
    )
    by_stage = Counter(e.get("Этап", "") for e in errs)
    hits = sum(1 for e in errs if e.get("Влияет на балл?", "").lower().startswith("да"))

    P = []
    A = P.append
    A("<title>Тестирование бота-проверяющего</title>")
    A('<link rel="preconnect" href="https://fonts.googleapis.com">')
    A('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    A('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
      'family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:wght@600;700&'
      'family=IBM+Plex+Mono:wght@400;500;600;700&display=swap">')
    A(f"<style>{CSS}{EXTRA_CSS}</style>")
    A('<div class="wrap">')
    A('<header class="mast"><div class="eyebrow">Бот-проверяющий ЕГЭ · профильная математика · '
      '12–13 сентября 2026</div><h1>Тестирование: что сломано и что чинить первым</h1>'
      f'<p class="lede">{C.LEDE}</p>'
      f'<p class="headline">{C.HEADLINE}</p></header>')
    A('<nav><a href="#prio">Что чинить</a><a href="#money">Цифры и деньги</a>'
      '<a href="#runs">24 прогона с вердиктами</a><a href="#pats">18 закономерностей</a>'
      '<a href="#errs">115 ошибок</a><a href="#flags">Флаги</a><a href="#works">Что работает</a></nav>')

    # priorities — the editorial core
    A('<section class="lvl" id="prio"><div class="sh"><h2>Что чинить, по порядку</h2></div>'
      f'<div class="key"><p>{C.WHY_IT_MATTERS}</p></div>'
      + priorities_html() + "</section>")

    # numbers and money
    A('<section class="lvl" id="money"><div class="sh"><h2>Цифры и деньги</h2></div>'
      f'<p class="intro">{C.MODE_STORY}</p>'
      '<div class="figs">'
      f'<div class="fig"><span class="v">{len(logs)}</span><span class="l">прогонов</span></div>'
      f'<div class="fig"><span class="v">{len(photo_runs)}</span><span class="l">по фото</span></div>'
      f'<div class="fig"><span class="v">{len(text_runs)}</span><span class="l">текстом</span></div>'
      f'<div class="fig bad"><span class="v">{len(errs)}</span><span class="l">ошибок разобрано</span></div>'
      f'<div class="fig bad"><span class="v">{hits}</span><span class="l">из них стоили балла</span></div>'
      f'<div class="fig"><span class="v">{secs/60:.0f} мин</span><span class="l">машинного времени</span></div>'
      "</div>"
      '<div class="scroll"><table><thead><tr><th>режим</th><th>прогонов</th>'
      "<th>базовая совпала</th><th>полностью совпала</th><th>ср. токенов</th><th>ср. время</th>"
      "</tr></thead><tbody>"
      f'<tr><td class="k">Фото</td><td class="n">28</td><td class="n bad">14 — 50%</td>'
      f'<td class="n bad">12 — 43%</td>'
      f'<td class="n">{sum(num(r.get("Токены")) for r in photo_runs)/max(len(photo_runs),1):,.0f}</td>'
      f'<td class="n">{sum(num(r.get("Время, с")) for r in photo_runs)/max(len(photo_runs),1):.0f} с</td></tr>'
      f'<tr><td class="k">Текст</td><td class="n">86</td><td class="n ok">72 — 84%</td>'
      f'<td class="n">49 — 57%</td>'
      f'<td class="n">{sum(num(r.get("Токены")) for r in text_runs)/max(len(text_runs),1):,.0f}</td>'
      f'<td class="n">{sum(num(r.get("Время, с")) for r in text_runs)/max(len(text_runs),1):.0f} с</td></tr>'
      "</tbody></table></div>"
      f'<div class="key"><p>{C.COST_NOTE}</p></div>'
      f'<p class="intro">Всего {tok:,.0f} токенов, из них {rtok:,.0f} на рассуждения '
      f"({rtok/tok*100:.0f}%).</p>".replace(",", " ")
      + "</section>")

    # the verdicts — what the team asked for
    A('<section class="lvl" id="runs"><div class="sh"><h2>24 прогона: вердикт к каждому</h2>'
      f'<span class="c">по листу «Прогоны»</span></div>'
      '<p class="intro">Разбор тестировщика по каждому прогону, дословно. Сгруппировано по '
      'работам: одна буква — одно и то же решение ученика, снятое или введённое по-разному. '
      'Так видно главное — как балл за одну работу меняется от кадра к кадру.</p>'
      + runs_html(runs, photos, logs, errs, jlogs) + "</section>")

    A('<section class="lvl" id="pats"><div class="sh"><h2>18 закономерностей</h2>'
      '<span class="c">по листу «Сводка»</span></div>'
      '<p class="intro">Обобщения тестировщика по всей сессии: что ломается, где это видно и '
      'что он предлагает сделать. Дословно.</p>'
      + patterns_html(S["Сводка"]) + "</section>")

    cause_btns = "".join(
        f'<button data-k="cause" data-v="{esc(c)}">{esc(c)} ({n})</button>'
        for c, n in by_cause.most_common(4) if c
    )
    stage_btns = "".join(
        f'<button data-k="stage" data-v="{esc(s)}">{esc(s)} ({n})</button>'
        for s, n in sorted(by_stage.items()) if s
    )
    A('<section class="lvl" id="errs"><div class="sh"><h2>115 ошибок, разобранных вручную</h2>'
      f'<span class="c" id="ec">{len(errs)}</span></div>'
      '<p class="intro">По каждой: что на листе, что выдал бот, чего это стоило и почему так '
      'вышло. Зелёное — как на самом деле, красное — что прочитал или написал бот.</p>'
      '<div class="scroll"><table><thead><tr><th>причина</th><th>ошибок</th>'
      "<th>из них стоили балла</th></tr></thead><tbody>"
      + "".join(
          f'<tr><td>{esc(c or "—")}</td><td class="n">{n}</td>'
          f'<td class="n {"bad" if hit_by_cause[c] else ""}">{hit_by_cause[c]}</td></tr>'
          for c, n in by_cause.most_common()
      )
      + "</tbody></table></div>"
      f'<div class="bar"><button data-k="all" data-v="">Все</button>'
      f'<button data-k="hit" data-v="">Стоили балла ({hits})</button>{stage_btns}{cause_btns}</div>'
      + errors_html(errs) + "</section>")

    A('<section class="lvl" id="flags"><div class="sh"><h2>Флаги</h2></div>'
      f'<p class="intro">{C.FLAGS_STORY}</p>'
      '<div class="scroll"><table><thead><tr><th>конфигурация</th><th>прогонов</th>'
      "<th>точность: решение</th><th>точность: оформление</th><th>занижено</th>"
      "<th>токенов</th></tr></thead><tbody>"
      + "".join(
          f'<tr><td class="k">{esc(r[0])}</td><td class="n">{esc(r[1])}</td>'
          f'<td class="n">{num(r[2])*100:.0f}%</td>'
          f'<td class="n {"ok" if num(r[3])>0.7 else "bad" if num(r[3])<0.6 else ""}">'
          f'{num(r[3])*100:.0f}%</td>'
          f'<td class="n">{esc(r[4])}</td><td class="n">{esc(r[6]) if len(r)>6 else "—"}</td></tr>'
          for r in S["Итог"] if r and re.match(r"^K\d", r[0] or "") and len(r) > 4 and r[1]
      )
      + "</tbody></table></div></section>")

    A('<section class="lvl" id="works"><div class="sh"><h2>Что уже работает</h2></div>'
      f'<div class="key good-box"><p>{C.WHAT_WORKS}</p></div>'
      f'<p class="intro">{C.CLOSING}</p>'
      '<div class="key"><p><b>Идея тестировщика.</b> Флаг «Показывать эталонное решение и '
      'ответ» по описанию передаёт этапу 2 эталонное <i>решение</i>, но в форме есть только '
      'поле «Верный ответ» — приложить решение нельзя. Либо не хватает поля, либо описание '
      'флага вводит в заблуждение. Он предлагает добавить поле и сравнить три режима: без '
      'эталона / только ответ / ответ + решение.</p></div></section>')

    A("<footer>Источник — материалы тестировщика: «Тесты бота-проверяющего.xlsx» "
      "(листы Итог, Справочник, Сводка, Конфигурации, План, Прогоны, Тестовый набор, Логи, "
      "Ошибки, Идеи), ИТОГ.docx, 26 снимков и 118 журналов прогонов. Вердикты, закономерности "
      "и разбор ошибок приведены дословно; порядок разделов и расстановка приоритетов — наши. "
      "Фотографии на странице уменьшены, оригиналы — в папке photos/.</footer></div>")
    A(f"<script>{JS}</script>")
    return "\n".join(P)


def main() -> None:
    folder = pathlib.Path(sys.argv[1])
    dest = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "REPORT.html")
    dest.write_text(build(folder), encoding="utf-8")
    print(f"{dest} ({dest.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()

