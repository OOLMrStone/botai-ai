# prompts/

Every instruction the model receives lives here, outside the Python. Editing a
prompt is editing a file in this folder — no code change, no redeploy of logic,
and the folder can be copied to another project as-is.

## Layout

```
prompts/
  stage1_reconstruction.md   photo → clean transcript   (vision; skippable, see below)
  stage2_analysis.md         work  → every finding      (text, or vision when stage 1 is off)
  stage3_grading.md          findings → two grades      (text)
  shared/
    _handwriting.md          artifact-vs-error rules, included by stages 1 and 2
    _notation.md             Russian maths notation conventions
  criteria/
    13.md … 19.md            per-task ФИПИ criteria + known failure modes
```

Files starting with `_` are fragments: included into others, never used alone.

## File format

A `---` frontmatter block, then the template body.

```markdown
---
id: stage1_reconstruction
version: 1
description: Распознавание рукописного решения по фотографии
required: task_number, statement
---
Тело промпта. Подстановка: {{ statement }}
Вставка фрагмента: {% include shared/_notation.md %}
```

| key | meaning |
|---|---|
| `id` | how code refers to it; must match the filename |
| `version` | bump on any meaningful edit — it is recorded on every grade |
| `required` | comma-separated variables that must be supplied; rendering fails loudly if one is missing |

### Feature-gated passages

Wrap an instruction that is a *hypothesis* rather than a fact:

```markdown
{% if solve_independently %}
1. **Сначала реши задачу сам.** …
{% else %}
1. **Разбирай работу напрямую.** …
{% endif %}
```

Blocks nest, `{% else %}` is optional, and the flag must exist in
`app/features.py` — an unknown name is an error, never a silent "off", so a
typo cannot quietly delete an instruction. Conditionals collapse *before*
variable substitution, so a `{{ var }}` used only inside a switched-off branch
is not required.

Toggles gate text. Adding one: add a `Feature` to the registry, wrap the
passage, bump `version`. The test page reads the registry, so a new toggle
appears there with no UI work.

One toggle, `reconstruct_first`, also decides *which stages run* — see
"Reading the photograph" below. It is marked `changes_flow=True` in the
registry; everything else gates text only.

## Rules when editing

1. **Bump `version`.** It is stored with each grading result, so a change in
   quality can be traced to the prompt that caused it.
2. **`required` must list every `{{ var }}` you use.** A typo in a variable
   name then fails at render time instead of silently sending the model the
   literal text `{{ statment }}`.
3. **Substitution is single-pass.** A student's solution containing `{{ }}` or
   `{% include %}` is inserted literally and never re-scanned. Do not "fix"
   this — it is what stops a photographed prompt-injection from reaching the
   template engine.
4. **Do not move the score bounds into the prompt.** The model proposes;
   `app/grading/postprocess.py` clamps. A prompt cannot be the only thing
   standing between a student and a 7-out-of-4.
5. **Preview before spending.** `POST /debug/grading/preview-prompt` renders
   the exact text with no model call.

## Reading the photograph: `reconstruct_first`

Normally stage 1 reads the handwriting and stage 2 analyses the transcript.
With `reconstruct_first` off, stage 1 does not run at all: the photograph goes
to stage 2, which reads the handwriting and finds the errors in the same pass.

Both templates branch on the flag. In stage 2 it swaps the transcript block for
instructions on reading a photographed sheet; in stage 3 it changes what stage
3 is told about where the findings came from. Stage 1's own toggles
(`normalize_artifacts`, `describe_drawings`) have no template to act on in that
mode, and the run's `notes` say so.

The reason it exists: in the first test session most of the score-affecting
damage on photographs entered through stage 1's reading, and a misread digit is
never revisited afterwards. The same answer was misread identically on three
different photographs of one sheet. Whether one pass beats two is an open
question — that is what the toggle is for.

## The stages, and why they are separate calls

Normally stage 1 is the only call that sees the photograph, and stages 2 and 3
are text-only. That split is deliberate:

- **Cost.** Image tokens are paid once, not three times.
- **Correctability.** A wrong grade is usually a wrong *reading*. With the
  transcript as a separate artefact, the student can be shown "this is what we
  read" and fix it, then stages 2–3 re-run for a fraction of the price.
- **Different jobs need different temperatures.** Reading handwriting rewards
  cautious literalism; grading rewards decisiveness.
- **Debuggability.** When a grade is wrong you can tell at a glance whether the
  model misread the work or misjudged it. Those have opposite fixes.

The counter-argument is the one `reconstruct_first` tests: a separate reading
step commits to a reading before anything checks whether it makes mathematical
sense, and nothing downstream can revisit it.

Stage 2 finds *everything* and judges *nothing*. Stage 3 judges and finds
nothing new. Keeping detection and judgement apart is what lets one pass of
analysis produce two different grades — what the mathematics earned, and what
survives an examiner who only credits what is written down. See
`stage3_grading.md`.
