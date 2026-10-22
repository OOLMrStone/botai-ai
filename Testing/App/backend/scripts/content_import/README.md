# Content acquisition and normalization

## Numeric difficulty revision

V8 adds nullable `difficulty_level` (1..5) and generated `is_grob` while preserving legacy labels and immutable history. New BankZadach manifests retain the provider's numeric rating; unknown is null. The private repair candidate `runtime/content-import/bankzadach/package-native-difficulty-1` contains 1,708 records with only the top-level difficulty changed from final candidate 3; `repair-audit.json` binds the exact differences and assets. Apply only after V8 and publisher preflight. Original final candidate 3 below remains the historical content baseline, not the numeric-rating repair package. Do not send an importer-controlled `isGrob` flag.

## Current workflow: BankZadach (2026-10-06)

The active adapter is `bankzadach_acquire.py` / `bankzadach_media.py` / `bankzadach_normalize.py`. The complete observed mathematics census contains 1,731 unique captures. The reviewed immutable release candidate is:

`/Users/vasiliyslobozhanov/projects/botai/botai-back/runtime/content-import/bankzadach/package-final-candidate-3`

It contains **1,708 accepted tasks** in four batches (500/500/500/208) and **23 quarantined tasks**. Exact manifest counts, sizes and SHA256 hashes are in its `release-audit.json`; `summary.json`, `quality.json`, `quarantine.json` and `duplicates.json` retain the evidence. Do not overwrite this directory or treat these package counts as final database counts. Publication receipts and database verification are separate gates.

### Native difficulty correction (2026-10-06)

The current BankZadach payload preserves the provider's integer **1–5**, and missing difficulty remains **`null`**. It does not map to `easy/medium/hard` or invent a middle level for unknown values. The backend derives `isGrob` exactly when difficulty is 5; the package does not supply an independent flag. Boolean, fractional, string and out-of-range source values are rejected.

The initial `package-final-candidate-3` above has the earlier coarse difficulty mapping and remains immutable evidence. Prepare a new metadata-only replacement from its reviewed records, checking every capture SHA and asset SHA, without rerendering or changing content, answers, solutions, topics, assets or provenance:

```sh
python3 scripts/content_import/bankzadach_repair_difficulty.py \
  --raw-root runtime/content-import/bankzadach \
  --baseline runtime/content-import/bankzadach/package-final-candidate-3 \
  --output runtime/content-import/bankzadach/package-native-difficulty-1
```

`repair-audit.json` records the exact manifest hashes, native difficulty distribution and the proof that only `difficulty` changed. The 1,708 accepted captures contain 219 level-1, 384 level-2, 285 level-3, 161 level-4, 55 level-5 and 604 unknown values. The 23 content-quality holds remain outside this repair. Publication requires the matching numeric-difficulty backend migration/runtime and preflight; preparation does not publish anything. Reusing the exact prepared package after publication must be a noop. The repair deliberately preserves the original provenance revision so that its record diff contains only difficulty. A later full normalization uses the explicit v3/native-difficulty mapping revision and can therefore create new metadata versions even when the mathematical content is identical; the no-op guarantee here applies to replaying the exact prepared repair package.

Public source labels are hidden by the current catalog API/UI. Provider identity, canonical URL, capture hashes, source-reported labels and import history remain private provenance for auditing and idempotency. The BankZadach permission grant is `user-grant-2026-10-06-bankzadach`; it is not a claim that every provider-reported original publisher was independently verified. The historical Shkolkovo source-display policy below does not describe the current UI.

All captures, answer-containing packages, review decisions and media stay in ignored `runtime/content-import/` (0700 directories / 0600 files). Preserve raw files. Never infer missing formulas, answers or figures. Topic, typesetting, supplemental-animation, exact-answer and table decisions are bound to the source capture SHA. Unsupported content and known source errors remain quarantined.

Run from the backend repository. Acquisition is resumable and already complete; only resume it when required:

```sh
python3 scripts/content_import/bankzadach_acquire.py --root runtime/content-import/bankzadach
```

Prepare the pinned fonts as described below. Normalize media offline with the retained exact renderer image:

```sh
python3 scripts/content_import/bankzadach_media.py \
  --root runtime/content-import/bankzadach \
  --image-id sha256:cc82e8a333a081839e100f68fa8ad213f7315d82346a1be48c0dc6aca6858c24
```

The renderer automatically reads private `media-quality-issues.json` and `media-render-reviews.json`. A held source SHA is rejected before cache reuse. A reviewed browser PNG override requires its source SHA, PNG SHA, dimensions, exact private path and explicit review flag; it does not rerender the SVG. This preserves the browser-verified curve that the pinned Sharp renderer omitted. Other SVGs use the bounded inert subset in an offline container; no source scripts or interactive widgets execute.

To build a *new* candidate without changing the approved release, use a fresh output directory and the merged review files:

```sh
python3 scripts/content_import/bankzadach_normalize.py \
  --raw-root runtime/content-import/bankzadach \
  --output runtime/content-import/bankzadach/package-next-reviewed \
  --node /opt/homebrew/bin/node \
  --katex-package ../botai-front/node_modules/katex/package.json \
  --reviews runtime/content-import/bankzadach/topic-reviews-final.json \
  --typesetting-reviews runtime/content-import/bankzadach/typesetting-reviews.json \
  --content-reviews runtime/content-import/bankzadach/content-reviews.json \
  --quality-issues runtime/content-import/bankzadach/content-quality-issues-final.json \
  --answer-reviews runtime/content-import/bankzadach/answer-reviews.json \
  --table-reviews runtime/content-import/bankzadach/table-reviews.json
```

Use the equivalent installed Node path on another machine. Run offline tests and build only the operator importer image; this does not recreate the live backend:

```sh
python3 -m unittest discover -s scripts/content_import -p 'test_*.py'
scripts/integration/compose.sh build content-import
```

Before publishing, confirm the intended local stack (`runtime/STAGE` must be absent for local work), create an online database backup, record task/version/attempt baselines, and inspect each preflight receipt. For example, batch 1 preflight:

```sh
scripts/integration/publish-content.sh \
  /Users/vasiliyslobozhanov/projects/botai/botai-back/runtime/content-import/bankzadach/package-final-candidate-3/batch-0001 \
  tasks.jsonl
```

Repeat for `batch-0002`, `batch-0003`, `batch-0004`. Only the separately authorized publish invocation adds `--publish`; publish sequentially, retain receipts, replay for idempotency, and verify old attempts/versions remain intact. Synthetic retirement is a separate guarded, reversible archival operation after real-content coverage verification.

Java math validation batches structurally checked formulas per record (at most 128 formulas / 64 KiB per Node invocation). Display/inline cache keys remain separate; `trust:false`, strict errors, expansion/size limits and a shared five-second process/write deadline remain enforced. Stdin buffers are joined before UTF-8 decoding. Failures never populate the positive cache.

Independent candidate 3 review found zero leaked commands, raw backslashes, dollar delimiters, URLs, HTML or parser markers in 36,301 native text runs; 34,085 formula runs remain typed math. Full publication/database status is recorded separately in the integration journal.

---

## Historical / deferred: Shkolkovo acquisition

Contract: `docs/integration/CONTENT-IMPORT-SPEC.md`. This adapter fetches only observed read-only routes of the fixed Shkolkovo HTTPS origin. It does not accept arbitrary destinations, inherit proxies/cookies, follow redirects, or bypass challenges. Strict certificate/hostname verification and a pinned DNS snapshot use the existing provider VPN route; this is not a claim that DNS addresses are public.

Raw responses, source captures, assets, reviews and answer-containing packages belong under ignored `runtime/content-import/`, directories 0700 / files 0600. No source statements or reference solutions are checked into these fixtures.

Public source labels mean the verified original publication: FIPI, EGE, Yashchenko, StatGrad or EGKR. Shkolkovo is an internal acquisition provider; capture URL/ID remain private provenance, not the displayed source. Preserve observed originalReferences and unknown values. Change the public projection separately; do not rewrite published content/fingerprints solely to alter labels.

- `acquire.py`: JSONL `{url,kind,body?}` observed request manifest; SHA cache and resumable private ledger. Budgets: 250 rows / 1 MiB manifest, 16 MiB response, 64 MiB job, 300 s job, 30 s request, minimum 0.5 s spacing. Failure/challenge stops the batch; an oversized response can read one detection byte beyond the remaining budget. Failed-transfer byte count is unknown and never represented as successful stored bytes.
- `svg.py` validates the inert vector subset before `render_svg.py` invokes existing pinned Sharp in an offline, bounded container. Renderer output is checked against the declared hash filenames and PNG dimensions before the host reads it. Unknown SVG/XML/path constructs are rejected.
- `html_parser.py` preserves paragraph/text/formula/figure order. Formula alt is not exact TeX; it never enters math, answer strings or grading text. U+FFFC is an explicit private object placeholder. Source math typography is normalized from observed 24 px/middle alignment; figures retain their aspect.
- `classification.py` requires a capture-hash-bound editorial review and a current same-position topic. Source memberships provide candidates, never a blanket automatic mapping. The current 141 topics preserve legacy version memberships separately.
- `normalize.py` / `build_package.py` produce a private **candidate** package from manual whitespace-normalized DOM captures, source assets and explicit classification. This is not a raw API export. Extended answers have separate typed blocks; short answers require an exact source literal. Publisher validation and root content approval remain required.
- `preview.py` is an ephemeral loopback-only review page using escaped typed text and package PNGs. It never renders upstream HTML or serves arbitrary files.

Run the offline checks:

```sh
python3 -m unittest discover -s scripts/content_import -p 'test_*.py' -v
```

Historical Shkolkovo acquisition limit: the observed public question-list endpoint returned an uninformative 500 for the two authorized research payloads. No further payload guessing or bulk crawl is implemented. Root independently observed 74 allowed sections, 4257 overlapping occurrences / 249 pages; private manifest contains exact IDs/counts. Three pilot records retain 41 image occurrences with 32 scoped PNG assets, pending publisher gates. Source criteria 408166 were not captured and no grading rubric is fabricated.

### Historical Shkolkovo resume checkpoint

Root whole-card content comparison approved the unchanged private package:
`runtime/content-import/pilot-candidate/tasks.jsonl`, SHA256
`95a806cf386bb7de1a591bf5e5eb9e9cc4f8f3e291f52d9df5985bc3b7cfc1cc`.
`quality-review.json` binds this hash; `completeness.json` lists each record and limitations.
The renderer/source ledgers are in `runtime/content-import/rendered-v2/pilot-*`
and `runtime/content-import/raw/{manual-captures,pilot-*}`.

1. Before bulk work, obtain the actual authorized public-list payload or verify a lossless page export. Ordinary Chrome Save Page As / Webpage, Complete in a confirmed task-owned window is an allowed UI path to test on one expanded card; check saved condition/answer/full solution and all assets. A saved file alone does not prove completeness. Read only task data, not user/auth props. Preserve export bytes privately; update only documented adapters/query schemas with evidence. Do not infer another wrapper or retry a challenge.
2. Enumerate the private 74-section manifest with bounded pages. Verify response section/page/IDs against each observed total; record unique provider IDs separately from section occurrences. Reconcile multi-source memberships and excluded-source conflicts.
3. Parse all statement, answer and solution sessions with their exact assets. Unsupported HTML/SVG, absent fields, unknown short-answer notation and uncertain method mapping go to quarantine, with explicit counts. Preserve raw source criteria separately until a reviewed adapter supports them.
4. Rasterize only validated vectors using the existing pinned image, isolated offline. A renderer failure never becomes a successful package.
5. Bind classification reviews to capture hashes. Build a candidate, compare complete cards, then pass the exact package hash to the existing publisher preflight. Publisher validation/publication and replay/history/media-access checks are separate gates; local/stage apply sequentially.

The historical loopback review process serves `http://127.0.0.1:18094` from typed blocks.
It is a temporary engineering preview, not a product route or final responsive UX gate.
The Shkolkovo bank remains deferred pending the upstream payload/export; the three-row pilot does not establish complete acquisition.

## Offline fonts for BankZadach figure labels

SVG labels explicitly name DejaVu Serif. The renderer requires the exact approved regular/italic fonts and fails rather than silently using a substitute. Prepare the private bundle once using an existing installed DejaVu distribution:

```sh
python3 scripts/content_import/bankzadach_fonts.py --root runtime/content-import/bankzadach --source-dir /absolute/path/to/fonts/truetype
```

On this workstation the source directory is `/Users/vasiliyslobozhanov/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype`. On another machine use a local distribution containing the identical files; do not bypass the SHA256 checks. The helper verifies both pinned hashes, copies only the two fonts, and extracts the original embedded redistribution license into private `renderer-fonts/LICENSE.txt`. No font is downloaded. The renderer copies these files into its read-only input mount and uses an isolated Fontconfig file; external font loading is not enabled.

The few source SVGs naming Times New Roman additionally require the existing locally licensed macOS font, only for local rasterization. Pass `--times-font '/System/Library/Fonts/Supplemental/Times New Roman.ttf'` to the same helper. It verifies the pinned file hash and writes a private use notice; do not commit or distribute this font. The renderer mounts only the font families actually required by each batch. Its PNG results preserve labels; no font files enter the content package.
