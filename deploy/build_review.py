#!/usr/bin/env python3
"""Build the test-session review page from collected run reports.

    python deploy/build_review.py [reports-dir] [out.html]

Organised around the tester's own experiment, not around raw runs. They ran
named cases — А…Л are reference solutions that should score full marks, X1–X7
are deliberate traps, P14–P21 are photographs — each under configurations
K0–K7 that switch one feature flag at a time.

That design is the finding. A case that fails under *every* configuration is a
prompt or criteria bug; one that fails under a single K is a flag bug. The
matrix near the top exists to make that difference visible at a glance, which
a list of 125 runs cannot.

Photographs are downscaled for this page and shipped at full size in
`images/`: the page is meant to be opened and scrolled, not archived.
"""

from __future__ import annotations

import base64
import hashlib
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


# --- reading the tester's labels -------------------------------------------
TEST_RE = re.compile(r"Тест\s+([A-ZА-ЯЁ]\d*)")
CONF_RE = re.compile(r"конфигурац\w*\s+(K\d)")
PHOTO_RE = re.compile(r"(\d+(?:\.\d+)?\.jpg)")
CONFIGS = ["K0", "K1", "K2", "K3", "K4", "K5", "K6", "K7"]
CONFIG_MEANING = {
    "K0*": "по умолчанию (прогон без пометки, сопоставлен по фотографии)",
    "K0": "по умолчанию",
    "K1": "solve_independently выкл",
    "K2": "exhaustive_findings выкл",
    "K3": "solve_independently + exhaustive_findings выкл",
    "K4": "по умолчанию, дан верный ответ",
    "K5": "use_reference_solution выкл",
    "K6": "normalize_artifacts выкл",
    "K7": "describe_drawings выкл",
}

# Which problem a run exposes, read out of the tester's own sentence. A
# hardcoded per-case map got this wrong: А, В and Д are photo cases whose
# disputes the tester describes as misreads, but the map filed them as
# reference solutions because of their letter.
GROUP_CUES = [
    ("ocr", ("прочитал", "прочитано", "потерян минус", "потерял минус", "распозна",
             "повёрнут", "повернут", "дописа", "фото экрана")),
    ("criteria", ("устаревш", "зашитым в бот", "зашитых в бот", "актуальным критериям")),
    ("loyalty", ("лояльност", "совпал с его собственным", "совпало с его собственным")),
    ("etalon", ("эталон",)),
]


def group_of(r: dict) -> str:
    """Which bucket this run's dispute belongs in, from the tester's wording."""
    c = ((r.get("feedback") or {}).get("comment") or "").lower()
    for name, cues in GROUP_CUES:
        if any(cue in c for cue in cues):
            return name
    name = (label(r)[0] or "")
    if name.startswith(("P", "M")):
        return "ocr"
    if name.startswith("X"):
        return "rubric"
    return "other"
GROUPS = {
    "ocr": (
        "Распознавание",
        "Бот неверно прочитал то, что написано на фотографии. Всё, что решается дальше, "
        "относится уже не к работе ученика.",
    ),
    "etalon": (
        "Эталон занижен",
        "Решение верное и полное, но балл за оформление всё равно снят — чаще всего "
        "за невыписанную ОДЗ или за отбор корней, показанный на окружности.",
    ),
    "criteria": (
        "Устаревшие критерии",
        "Критерии, зашитые в бота, расходятся с действующими критериями ФИПИ. "
        "Правится не промпт, а файлы в prompts/criteria/.",
    ),
    "loyalty": (
        "Лояльность к своему ответу",
        "Если итоговый ответ ученика совпал с собственным ответом бота, бот прощает "
        "необоснованный переход и ставит выше, чем следует.",
    ),
    "rubric": (
        "Применение критериев",
        "Балл выставлен не по той строке критериев: вычислительная ошибка обнулена, "
        "потеря точки не учтена, нарушение ОДЗ засчитано.",
    ),
    "other": ("Прочее", "Расхождения, не попавшие в остальные группы."),
}
GROUP_ORDER = ["ocr", "etalon", "criteria", "loyalty", "rubric", "other"]


def label(r: dict) -> tuple[str | None, str | None, list[str]]:
    c = (r.get("feedback") or {}).get("comment") or ""
    t, k = TEST_RE.search(c), CONF_RE.search(c)
    return (t.group(1) if t else None, k.group(1) if k else None, PHOTO_RE.findall(c))


def scores(r: dict) -> tuple[Any, Any, Any]:
    g = r.get("grades") or {}
    return (
        (g.get("base") or {}).get("score"),
        (g.get("presentation") or {}).get("score"),
        g.get("max_score"),
    )


def verdict(r: dict) -> str:
    return (r.get("feedback") or {}).get("verdict") or "none"


# --- images -----------------------------------------------------------------
def shrink(url: str, max_w: int = 950, quality: int = 70) -> str:
    """Downscale for the page. Full-size originals ship in images/."""
    try:
        from PIL import Image
    except ImportError:
        return url
    try:
        header, _, payload = url.partition(",")
        img = Image.open(io.BytesIO(base64.b64decode(payload)))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        if img.width > max_w:
            img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True)
        out = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        return out if len(out) < len(url) else url
    except Exception:  # noqa: BLE001 - an unreadable image must not sink the page
        return url


def load(root: pathlib.Path) -> list[dict]:
    out = []
    for p in sorted(root.rglob("*.json")):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001
            print(f"  skipped {p}", file=sys.stderr)
    out.sort(key=lambda r: r.get("created_at") or "")
    return out


# --- pieces -----------------------------------------------------------------
def answers_from(transcript: str) -> list[str]:
    """The final-answer lines — where a misread digit actually shows up."""
    if not transcript:
        return []
    out, grab = [], False
    for line in transcript.splitlines():
        if line.startswith("### Итоговые ответы"):
            grab = True
            continue
        if grab:
            if line.startswith("###"):
                break
            if line.strip():
                out.append(line.strip())
    return out


def cell(runs: list[dict] | None) -> str:
    if not runs:
        return '<td class="mx none">·</td>'
    # A repeated combination shows the disputed run: that is the one worth opening.
    r = next((x for x in runs if verdict(x) == "wrong"), runs[0])
    repeat = f'<span class="rep">×{len(runs)}</span>' if len(runs) > 1 else ""
    b, p, _ = scores(r)
    v = verdict(r)
    fb = r.get("feedback") or {}
    exp = ""
    if v == "wrong" and fb.get("expected_base") is not None:
        exp = f'<span class="exp">ждали {fb["expected_base"]}/{fb["expected_presentation"]}</span>'
    got = "—" if b is None else f"{b}/{p}"
    return (
        f'<td class="mx {v}"><a href="#{esc(r["request_id"])}">'
        f'<span class="got">{got}</span>{repeat}{exp}</a></td>'
    )


def case_group(runs: dict[str, list[dict]]) -> str:
    """Bucket for a whole case: what its disputed runs say, else all of them."""
    flat = [r for rs in runs.values() for r in rs]
    bad = [r for r in flat if verdict(r) == "wrong"]
    votes = Counter(group_of(r) for r in (bad or flat))
    return votes.most_common(1)[0][0] if votes else "other"


def matrix(cases: dict[str, dict[str, list[dict]]]) -> str:
    def sort_key(name: str) -> tuple:
        return (GROUP_ORDER.index(case_group(cases[name])), name)

    head = "".join(
        f'<th title="{esc(CONFIG_MEANING[k])}">{k}</th>' for k in CONFIGS
    )
    rows = []
    for name in sorted(cases, key=sort_key):
        by_conf = cases[name]
        grp = case_group(by_conf)
        bad = sum(1 for rs in by_conf.values() for r in rs if verdict(r) == "wrong")
        rows.append(
            f'<tr class="grp-{grp}"><th class="case"><a href="#case-{esc(name)}">{esc(name)}</a>'
            f'<span class="gdot" title="{esc(GROUPS[grp][0])}"></span></th>'
            + "".join(cell(by_conf.get(k)) for k in CONFIGS)
            + f'<td class="tot{" bad" if bad else ""}">{bad or ""}</td></tr>'
        )
    return (
        '<div class="mxwrap"><table class="matrix">'
        f'<thead><tr><th class="case">тест</th>{head}<th class="tot">спорных</th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table></div>'
    )


def run_row(r: dict, conf: str | None) -> str:
    b, p, mx = scores(r)
    v = verdict(r)
    fb = r.get("feedback") or {}
    g = r.get("grades") or {}
    exp = (
        f'<span class="want">ждали {fb.get("expected_base")}/{fb.get("expected_presentation")}</span>'
        if v == "wrong" and fb.get("expected_base") is not None
        else ""
    )
    vlabel = {"wrong": "неверно", "ok": "верно", "unsure": "не уверен", "none": "без отзыва"}[v]
    ans = answers_from(r.get("transcript") or "")
    read = (
        '<div class="read"><span class="rl">бот прочитал ответ</span>'
        + "".join(f"<code>{esc(a)}</code>" for a in ans)
        + "</div>"
        if ans
        else ""
    )
    findings = r.get("findings") or []
    fl = r.get("features_changed") or {}
    return f"""
<div class="run v-{v}" id="{esc(r["request_id"])}">
  <div class="rhead">
    <span class="conf">{esc(conf or "—")}</span>
    <span class="cfgnote">{esc(CONFIG_MEANING.get(conf or "", "") or (", ".join(f"{k}={'вкл' if x else 'выкл'}" for k, x in sorted(fl.items())) or "по умолчанию"))}</span>
    <span class="score {"off" if v == "wrong" else ""}">{"—" if b is None else f"{b}/{p}"} <i>из {mx}</i></span>
    {exp}
    <span class="vb v-{v}">{vlabel}</span>
  </div>
  {f'<blockquote class="tcomment"><span class="tq">Тестировщик</span>{esc(fb.get("comment"))}</blockquote>' if fb.get("comment") else ""}
  {read}
  <p class="bsum">{esc(g.get("summary"))}</p>
  <details><summary>подробно — находки ({len(findings)}), расшифровка, обоснования</summary>
    <div class="det">
      {"".join(f'<div class="fi"><code>{esc(f.get("id"))}</code> <b>{esc(f.get("type"))}</b> · {"оформление" if f.get("is_defensible") else "содержание"}<br>{esc(f.get("what"))}</div>' for f in findings) or '<p class="muted">находок нет</p>'}
      <div class="just"><b>за решение:</b> {esc((g.get("base") or {}).get("justification"))}</div>
      <div class="just"><b>с оформлением:</b> {esc((g.get("presentation") or {}).get("justification"))}</div>
      <pre class="tr">{esc(r.get("transcript") or "распознавание не выполнялось — решение передано текстом")}</pre>
    </div>
  </details>
</div>"""


def comments_table(reports: list[dict]) -> str:
    """Every tester comment in one scannable list.

    They are shown per-run as well, but a reader who wants to know what the
    tester actually thought should not have to open 31 cases to find out.
    Confirmations are included: several describe deliberate negative tests and
    say why a grade was right, which matters as much as the complaints.
    """
    rows = []
    for r in reports:
        fb = r.get("feedback") or {}
        if not fb.get("comment"):
            continue
        name, conf, _ = label(r)
        b, p_, mx = scores(r)
        v = verdict(r)
        vshort = {"wrong": "неверно", "ok": "верно", "unsure": "?"}.get(v, "")
        want = (
            f'{fb.get("expected_base")}/{fb.get("expected_presentation")}'
            if v == "wrong" and fb.get("expected_base") is not None
            else "—"
        )
        rows.append(
            f'<tr class="cv-{v}"><td class="ct"><a href="#{esc(r["request_id"])}">'
            f'{esc(name or "—")}</a></td><td class="cc">{esc(conf or "—")}</td>'
            f'<td class="cs">{"—" if b is None else f"{b}/{p_}"}</td>'
            f'<td class="cs want">{esc(want)}</td>'
            f'<td class="cvd">{vshort}</td>'
            f'<td class="cx">{esc(fb["comment"])}</td></tr>'
        )
    return (
        '<div class="mxwrap"><table class="comments"><thead><tr>'
        "<th>тест</th><th>конф.</th><th>оценка</th><th>ждали</th><th>вердикт</th>"
        "<th>комментарий тестировщика</th></tr></thead>"
        f'<tbody>{"".join(rows)}</tbody></table></div>'
    )


def build(reports: list[dict]) -> str:
    # (case, config) -> runs. A list, not a single run: the tester repeated
    # some combinations, and keying by one run silently dropped the rest.
    cases: dict[str, dict[str, list[dict]]] = defaultdict(dict)
    unlabelled: list[dict] = []
    photos: dict[str, str] = {}
    case_photo: dict[str, str] = {}
    case_files: dict[str, list[str]] = {}
    case_statement: dict[str, str] = {}
    case_task: dict[str, Any] = {}

    for r in reports:
        name, conf, files = label(r)
        if not name:
            unlabelled.append(r)
            continue
        cases[name].setdefault(conf or "—", []).append(r)
        case_statement.setdefault(name, r.get("statement") or "")
        case_task.setdefault(name, r.get("task_number"))
        if files:
            # the tester sometimes names the same file twice in one sentence
            case_files.setdefault(name, list(dict.fromkeys(files)))
        urls = r.get("image_data_urls") or []
        if urls and name not in case_photo:
            key = hashlib.sha1("".join(urls).encode()).hexdigest()[:10]
            if key not in photos:
                photos[key] = "".join(
                    f'<img src="{shrink(u)}" alt="Лист {i + 1}" loading="lazy">'
                    for i, u in enumerate(urls)
                )
            case_photo[name] = key

    # An unlabelled run that used the same photograph belongs with its case.
    # The K0 run where a misread first appeared is often unlabelled, and
    # filing it separately hides it from the very photo it misread.
    photo_case = {case_photo[n]: n for n in case_photo}
    still_loose = []
    for r in unlabelled:
        urls = r.get("image_data_urls") or []
        key = hashlib.sha1("".join(urls).encode()).hexdigest()[:10] if urls else ""
        owner = photo_case.get(key)
        if owner:
            cases[owner].setdefault("K0*", []).append(r)
        else:
            still_loose.append(r)
    unlabelled = still_loose

    disputed = [r for r in reports if verdict(r) == "wrong"]
    judged = [r for r in reports if verdict(r) in ("wrong", "ok")]
    by_group = Counter(group_of(r) for r in disputed)

    # sections, grouped by the problem each case exposes
    sections = []
    for grp in GROUP_ORDER:
        names = sorted(n for n in cases if case_group(cases[n]) == grp)
        def has_bad(n: str) -> bool:
            return any(verdict(r) == "wrong" for rs in cases[n].values() for r in rs)

        names = [n for n in names if has_bad(n)] + [n for n in names if not has_bad(n)]
        if not names:
            continue
        title, why = GROUPS[grp]
        blocks = []
        for name in names:
            runs = cases[name]
            bad = sum(1 for rs in runs.values() for r in rs if verdict(r) == "wrong")
            pic = photos.get(case_photo.get(name, ""), "")
            files = ", ".join(case_files.get(name, []))
            ordered = sorted(runs.items(), key=lambda kv: (kv[0] not in CONFIGS, kv[0]))
            blocks.append(f"""
<article class="case{" has-bad" if bad else ""}" id="case-{esc(name)}" data-bad="{1 if bad else 0}">
  <div class="chead">
    <h3>Тест {esc(name)}</h3>
    <span class="tasknum">задание {esc(case_task.get(name))}</span>
    {f'<span class="files">{esc(files)}</span>' if files else ""}
    <span class="cbad">{f"{bad} из {sum(len(v) for v in runs.values())} прогонов спорные" if bad else "расхождений нет"}</span>
  </div>
  <p class="stmt">{esc(case_statement.get(name, "")[:400])}</p>
  {f'<div class="shots">{pic}</div>' if pic else ""}
  <div class="runs">{"".join(run_row(r, k) for k, rs in ordered for r in rs)}</div>
</article>""")
        sections.append(
            f'<section class="group" id="grp-{grp}" data-group="{grp}">'
            f'<div class="ghead"><h2>{esc(title)}</h2>'
            f'<span class="gcount">{by_group.get(grp, 0)} спорных прогонов</span></div>'
            f'<p class="gwhy">{esc(why)}</p>{"".join(blocks)}</section>'
        )

    if unlabelled:
        rows = "".join(run_row(r, None) for r in unlabelled)
        sections.append(
            '<section class="group" id="grp-unlabelled" data-group="other">'
            '<div class="ghead"><h2>Без пометки теста</h2>'
            f'<span class="gcount">{len(unlabelled)} прогонов</span></div>'
            '<p class="gwhy">Прогоны, которые тестировщик не подписал — в основном '
            'прогревочные и повторные.</p>'
            f'<article class="case" data-bad="0"><div class="runs">{rows}</div></article></section>'
        )

    tiles = "".join(
        f'<a class="tile g-{g}" href="#grp-{g}"><span class="tn">{by_group[g]}</span>'
        f"<span class=\"tt\">{esc(GROUPS[g][0])}</span></a>"
        for g in GROUP_ORDER
        if by_group.get(g)
    )
    tokens = sum((r.get("total_usage") or {}).get("total_tokens", 0) for r in reports)

    return TEMPLATE.format(
        runs=len(reports),
        cases=len(cases),
        judged=len(judged),
        wrong=len(disputed),
        ok=len(judged) - len(disputed),
        tokens=f"{tokens:,}".replace(",", " "),
        tiles=tiles,
        matrix=matrix(cases),
        comments=comments_table(reports),
        commented=sum(1 for r in reports if (r.get("feedback") or {}).get("comment")),
        sections="".join(sections),
    )


TEMPLATE = """<title>Разбор тестовой сессии</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:wght@600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {{
  --paper:#f6f7f9; --card:#fff; --sunk:#eef1f5; --ink:#141820; --ink2:#4c5563; --ink3:#7b8492;
  --rule:#d9dfe7; --soft:#e8ecf2; --accent:#2f5fd0; --bad:#c5302a; --badbg:#fbeae8;
  --ok:#15764f; --okbg:#e6f2ec; --warn:#a2660c; --warnbg:#fbf2e3;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --paper:#0e1218; --card:#151a22; --sunk:#1b212b; --ink:#e8ecf2; --ink2:#a6b0be; --ink3:#79828f;
    --rule:#29313d; --soft:#212833; --accent:#7ba3f8; --bad:#ef7168; --badbg:#331c1b;
    --ok:#4dbf90; --okbg:#13281e; --warn:#dca548; --warnbg:#2b2215;
  }}
}}
:root[data-theme="dark"] {{
  --paper:#0e1218; --card:#151a22; --sunk:#1b212b; --ink:#e8ecf2; --ink2:#a6b0be; --ink3:#79828f;
  --rule:#29313d; --soft:#212833; --accent:#7ba3f8; --bad:#ef7168; --badbg:#331c1b;
  --ok:#4dbf90; --okbg:#13281e; --warn:#dca548; --warnbg:#2b2215;
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--paper);color:var(--ink);
  font:400 15px/1.55 "IBM Plex Sans",-apple-system,BlinkMacSystemFont,sans-serif}}
.wrap{{max-width:1080px;margin:0 auto;padding:34px 20px 80px}}
h1,h2,h3{{font-family:"IBM Plex Serif",Georgia,serif;margin:0;text-wrap:balance}}
h1{{font-size:30px;font-weight:700;letter-spacing:-.01em}}
code,pre,.mono{{font-family:"IBM Plex Mono",ui-monospace,monospace}}
a{{color:var(--accent)}}
.mast{{border-bottom:2px solid var(--ink);padding-bottom:16px;margin-bottom:20px}}
.eyebrow{{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);font-weight:600}}
.lede{{color:var(--ink2);max-width:70ch;margin:10px 0 0;font-size:14.5px}}
.figs{{display:flex;flex-wrap:wrap;gap:1px;background:var(--rule);border:1px solid var(--rule);margin:18px 0}}
.fig{{background:var(--card);padding:11px 16px;flex:1;min-width:118px}}
.fig .n{{font:600 23px/1.1 "IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;display:block}}
.fig .l{{font-size:11.5px;color:var(--ink2)}}
.fig.bad .n{{color:var(--bad)}} .fig.ok .n{{color:var(--ok)}}
.tiles{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:16px 0 22px}}
.tile{{background:var(--card);border:1px solid var(--rule);border-left:3px solid var(--bad);
  padding:10px 13px;text-decoration:none;color:inherit}}
.tile:hover{{border-color:var(--accent);border-left-color:var(--bad)}}
.tile .tn{{font:600 21px/1 "IBM Plex Mono",monospace;color:var(--bad);display:block}}
.tile .tt{{font-size:12.5px;color:var(--ink2);display:block;margin-top:4px}}
.note{{background:var(--badbg);border-left:3px solid var(--bad);padding:14px 18px;margin:18px 0}}
.note h3{{font-size:16px;margin-bottom:5px}}
.note p{{margin:0 0 8px;color:var(--ink2);max-width:74ch;font-size:14px}}
.note p:last-child{{margin-bottom:0}}
/* matrix */
.mxwrap{{overflow-x:auto;border:1px solid var(--rule);background:var(--card);margin:8px 0 26px}}
table.matrix{{border-collapse:collapse;width:100%;font-size:12.5px}}
.matrix th,.matrix td{{border:1px solid var(--soft);padding:5px 7px;text-align:center;white-space:nowrap}}
.matrix thead th{{background:var(--sunk);font:600 11px/1.3 "IBM Plex Sans",sans-serif;
  text-transform:uppercase;letter-spacing:.05em;color:var(--ink3)}}
.matrix th.case{{text-align:left;font-family:"IBM Plex Mono",monospace;font-weight:600;
  background:var(--card);position:sticky;left:0;z-index:1}}
.matrix th.case a{{text-decoration:none;color:var(--ink)}}
.gdot{{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ink3);margin-left:5px}}
.grp-ocr .gdot{{background:var(--bad)}} .grp-etalon .gdot{{background:var(--warn)}}
.grp-criteria .gdot{{background:#8b5cf6}} .grp-loyalty .gdot{{background:#0ea5e9}}
.grp-rubric .gdot{{background:var(--accent)}}
td.mx a{{text-decoration:none;color:inherit;display:block}}
td.mx .got{{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;font-weight:500}}
td.mx .rep{{font-size:10px;color:var(--ink3);margin-left:3px}}
td.mx .exp{{display:block;font-size:10px;color:var(--bad)}}
td.mx.wrong{{background:var(--badbg)}} td.mx.wrong .got{{color:var(--bad);font-weight:700}}
td.mx.ok{{background:var(--okbg)}} td.mx.none{{color:var(--ink3)}}
td.tot{{font-weight:600;font-family:"IBM Plex Mono",monospace}}
td.tot.bad{{color:var(--bad);background:var(--badbg)}}
table.comments{{border-collapse:collapse;width:100%;font-size:13px}}
.comments th{{background:var(--sunk);font:600 11px/1.3 "IBM Plex Sans",sans-serif;
  text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);text-align:left;
  padding:6px 9px;border-bottom:1px solid var(--rule);white-space:nowrap}}
.comments td{{padding:7px 9px;border-bottom:1px solid var(--soft);vertical-align:top}}
.comments .ct{{font-family:"IBM Plex Mono",monospace;font-weight:600;white-space:nowrap}}
.comments .ct a{{text-decoration:none}}
.comments .cc{{font-family:"IBM Plex Mono",monospace;color:var(--ink3);white-space:nowrap}}
.comments .cs{{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;
  text-align:center;white-space:nowrap}}
.comments .cs.want{{color:var(--bad)}}
.comments .cvd{{font-weight:600;white-space:nowrap;font-size:12px}}
.comments tr.cv-wrong .cvd{{color:var(--bad)}}
.comments tr.cv-wrong{{background:var(--badbg)}}
.comments tr.cv-ok .cvd{{color:var(--ok)}}
.comments .cx{{min-width:30ch;color:var(--ink)}}
/* groups */
.group{{margin:0 0 34px}}
.ghead{{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule);
  padding-bottom:7px;margin-bottom:7px}}
.ghead h2{{font-size:20px}}
.gcount{{margin-left:auto;font-size:12.5px;color:var(--bad);font-weight:600}}
.gwhy{{color:var(--ink2);font-size:14px;margin:0 0 16px;max-width:74ch}}
.case{{border:1px solid var(--rule);background:var(--card);margin-bottom:14px}}
.case.has-bad{{border-left:3px solid var(--bad)}}
.chead{{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:12px 16px 0}}
.chead h3{{font-size:16px}}
.tasknum,.files{{font-size:12px;color:var(--ink3)}}
.files{{font-family:"IBM Plex Mono",monospace}}
.cbad{{margin-left:auto;font-size:12px;color:var(--ink3)}}
.case.has-bad .cbad{{color:var(--bad);font-weight:600}}
.stmt{{margin:6px 16px 10px;font-size:13.5px;color:var(--ink2);max-width:76ch}}
.shots{{display:flex;gap:10px;padding:0 16px 12px;overflow-x:auto}}
.shots img{{max-height:330px;border:1px solid var(--rule);background:#fff}}
/* run */
.run{{border-top:1px solid var(--soft);padding:11px 16px}}
.rhead{{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:12.5px}}
.conf{{font-family:"IBM Plex Mono",monospace;font-weight:600;background:var(--sunk);padding:1px 7px}}
.cfgnote{{color:var(--ink3);font-size:11.5px}}
.score{{font-family:"IBM Plex Mono",monospace;font-weight:700;font-size:15px;margin-left:auto}}
.score i{{font-style:normal;font-weight:400;color:var(--ink3);font-size:11px;margin-left:3px}}
.score.off{{color:var(--bad)}}
.want{{font-size:11.5px;color:var(--bad);font-weight:600}}
.vb{{font-size:11px;padding:2px 7px;font-weight:600}}
.vb.v-wrong{{background:var(--badbg);color:var(--bad)}}
.vb.v-ok{{background:var(--okbg);color:var(--ok)}}
.vb.v-unsure{{background:var(--warnbg);color:var(--warn)}}
.vb.v-none{{background:var(--sunk);color:var(--ink3)}}
.tcomment{{margin:9px 0 0;padding:10px 13px;background:var(--badbg);border-left:3px solid var(--bad);
  font-size:14px;line-height:1.55;max-width:78ch;color:var(--ink)}}
.tq{{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;
  font-weight:700;color:var(--bad);margin-bottom:3px}}
.run.v-ok .tq{{color:var(--ok)}} .run.v-none .tq,.run.v-unsure .tq{{color:var(--ink3)}}
.run.v-ok .tcomment{{background:var(--okbg);border-left-color:var(--ok)}}
.run.v-none .tcomment,.run.v-unsure .tcomment{{background:var(--sunk);border-left-color:var(--ink3)}}
.read{{margin:8px 0 0;padding:7px 11px;background:var(--sunk);font-size:12.5px}}
.read .rl{{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink3);
  font-weight:600;margin-right:8px}}
.read code{{display:inline-block;margin-right:10px}}
.bsum{{margin:8px 0 0;font-size:13px;color:var(--ink2);max-width:78ch}}
details{{margin-top:8px}}
summary{{cursor:pointer;font-size:12.5px;color:var(--accent);font-weight:600}}
summary:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
.det{{padding:9px 0 2px}}
.fi{{background:var(--sunk);padding:7px 10px;margin-bottom:6px;font-size:12.5px}}
.just{{font-size:12.5px;color:var(--ink2);margin-bottom:6px;max-width:80ch}}
pre.tr{{background:var(--sunk);border:1px solid var(--soft);padding:10px 12px;font-size:12px;
  line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:330px;overflow:auto;margin:0}}
.muted{{color:var(--ink3);font-size:12.5px}}
.bar{{position:sticky;top:0;z-index:5;background:var(--paper);border-bottom:1px solid var(--rule);
  padding:9px 0;margin-bottom:14px;display:flex;gap:7px;flex-wrap:wrap;align-items:center}}
.bar button{{font:500 12.5px/1 "IBM Plex Sans",sans-serif;cursor:pointer;padding:7px 12px;
  border:1px solid var(--rule);background:var(--card);color:var(--ink2)}}
.bar button:hover{{border-color:var(--accent);color:var(--accent)}}
.bar button[aria-pressed="true"]{{background:var(--ink);color:var(--paper);border-color:var(--ink)}}
.bar button:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
.hidden{{display:none!important}}
footer{{margin-top:36px;padding-top:14px;border-top:1px solid var(--rule);font-size:12.5px;color:var(--ink3)}}
@media (prefers-reduced-motion:reduce){{*{{animation:none!important;transition:none!important}}}}
@media (max-width:640px){{.wrap{{padding:20px 12px 50px}}h1{{font-size:23px}}.shots img{{max-height:230px}}}}
</style>

<div class="wrap">
<header class="mast">
  <div class="eyebrow">Сервис проверки ЕГЭ · тестовая сессия 12–13 сентября 2026</div>
  <h1>Разбор тестовой сессии</h1>
  <p class="lede">Тестировщик прогнал {cases} именованных тестов в восьми конфигурациях K0–K7,
  каждая из которых переключает один флаг. Порядок здесь — по причине расхождения, а не по
  номеру прогона: тест, который падает во <em>всех</em> конфигурациях, указывает на промпт или
  критерии; тест, который падает только в одной, — на конкретный флаг.</p>
</header>

<div class="figs">
  <div class="fig"><span class="n">{runs}</span><span class="l">прогонов</span></div>
  <div class="fig"><span class="n">{cases}</span><span class="l">тестов</span></div>
  <div class="fig"><span class="n">{judged}</span><span class="l">с вердиктом</span></div>
  <div class="fig bad"><span class="n">{wrong}</span><span class="l">оспорено</span></div>
  <div class="fig ok"><span class="n">{ok}</span><span class="l">подтверждено</span></div>
  <div class="fig"><span class="n">{tokens}</span><span class="l">токенов</span></div>
</div>

<div class="note">
  <h3>Четыре разные поломки, а не одна</h3>
  <p><b>Распознавание.</b> На фото 6.jpg бот во всех трёх конфигурациях прочитал ответ как
  −13π/6, −11π/6, −7π/6, тогда как на листе написано −17π/6 и −19π/6. Выключение флага
  «Исправлять артефакты распознавания» ничего не изменило — значит, цифры путаются в самом
  распознавании, а не в нормализации. То же на 1.jpg (потерян минус) и 11.jpg (исправленное
  22 прочитано как 23, молча дописаны скобки логарифма).</p>
  <p><b>Эталон занижен.</b> Самая массовая поломка: верное и полное решение получает 2/1
  вместо 2/2 — на тестах Е, Ж, З, И, К, Л и во <em>всех</em> конфигурациях сразу. Балл
  снимается за невыписанную ОДЗ и за отбор корней, показанный на окружности. Раз от флагов
  не зависит — дело в правилах снятия в <code>prompts/stage3_grading.md</code>.</p>
  <p><b>Устаревшие критерии.</b> Тест X1 даёт 0/0 там, где по действующим критериям ФИПИ
  положен 1 балл. Это правится не промптом, а файлами <code>prompts/criteria/</code>.</p>
  <p><b>Лояльность к своему ответу.</b> Тест X7: когда ответ ученика совпадает с ответом
  бота, бот прощает необоснованный переход и ставит 2 вместо 1.</p>
</div>

<div class="tiles">{tiles}</div>

<h2 style="font-size:18px;margin-bottom:6px">Матрица: тест × конфигурация</h2>
<p class="gwhy">Ячейка — оценка «за решение / с оформлением». Красная — тестировщик не согласен.
Строка, красная целиком, не зависит от флагов. Клик ведёт к прогону.</p>
{matrix}

<h2 style="font-size:18px;margin:30px 0 6px">Все комментарии тестировщика</h2>
<p class="gwhy">Все {commented} комментария — и к оспоренным прогонам, и к подтверждённым.
Подтверждения тоже стоит читать: часть из них описывает негативные тесты и объясняет,
почему оценка верна. Клик по имени теста ведёт к прогону.</p>
{comments}

<nav class="bar" aria-label="Фильтр">
  <button data-f="all" aria-pressed="true">Все тесты</button>
  <button data-f="bad" aria-pressed="false">Только спорные</button>
  <button data-f="expand" aria-pressed="false">Раскрыть подробности</button>
</nav>

{sections}

<footer>Собрано из отчётов прогонов (<code>reports/</code>). Расшифровки показаны как есть,
моноширинным шрифтом и без вёрстки формул: самая частая ошибка этапа 1 — перепутанная цифра,
и вёрстка её бы спрятала. Фотографии на странице уменьшены, оригиналы — в <code>images/</code>.</footer>
</div>

<script>
(function () {{
  var cases = [].slice.call(document.querySelectorAll(".case"));
  var btns = [].slice.call(document.querySelectorAll(".bar button"));
  function apply(f) {{
    cases.forEach(function (c) {{
      c.classList.toggle("hidden", f === "bad" && c.dataset.bad !== "1");
      [].forEach.call(c.querySelectorAll(".run"), function (r) {{
        r.classList.toggle("hidden", f === "bad" && !r.classList.contains("v-wrong"));
      }});
    }});
    document.querySelectorAll(".group").forEach(function (g) {{
      var any = [].some.call(g.querySelectorAll(".case"), function (c) {{ return !c.classList.contains("hidden"); }});
      g.classList.toggle("hidden", !any);
    }});
    btns.forEach(function (b) {{ b.setAttribute("aria-pressed", String(b.dataset.f === f)); }});
  }}
  btns.forEach(function (b) {{
    b.addEventListener("click", function () {{
      if (b.dataset.f === "expand") {{
        var open = b.getAttribute("aria-pressed") !== "true";
        document.querySelectorAll("details").forEach(function (d) {{ d.open = open; }});
        b.setAttribute("aria-pressed", String(open));
        return;
      }}
      apply(b.dataset.f);
    }});
  }});
}})();
</script>
"""


def main() -> None:
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "collected-reports")
    dest = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "report.html")
    reports = load(src)
    if not reports:
        sys.exit(f"no reports under {src}")
    dest.write_text(build(reports), encoding="utf-8")
    print(f"{len(reports)} runs → {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
