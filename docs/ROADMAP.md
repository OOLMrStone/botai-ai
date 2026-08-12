# Roadmap

What this service is not yet, in the order it probably wants to become it.
Each item says where it plugs in, so the next session can start from a
concrete file rather than a blank page.

## Deliberately absent right now

No database, no queue, no auth, no caching, no rate limiting, no metrics
endpoint. The service is stateless: a request goes in, a grade comes out.
That is the right shape for a basis — everything below can be added without
restructuring the layers.

---

## 1. Rubric fidelity — the highest-value work

`domain/tasks.py` holds generalised rubrics (see
[DOMAIN_EGE.md](DOMAIN_EGE.md)). Grade quality is bounded by them.

- Reconcile all seven against the current ФИПИ demo version.
- Model per-problem criteria properly. Tasks 14/17/18/19 have criteria that
  only exist per variant; `criteria_override` covers this at the API level,
  but there is nowhere to *store* a problem's criteria yet. Wants a problem
  bank (item 3).
- Consider a `criteria_version` field on the registry and on responses, so
  re-grades are comparable after a rubric changes.

## 2. Quality measurement — needed before any prompt tuning

Right now there is no way to tell whether a prompt change helped.

- Build a labelled corpus: real работы with expert-assigned scores. A few
  dozen per task number is enough to see movement. `domain/samples.py` has the
  shape; `expected_score_hint` is the seed of it.
- An eval harness that grades the corpus and reports exact-match rate, mean
  absolute error in points, and the confusion matrix per task. MAE matters
  more than accuracy — being one point off on задание 18 is a different
  failure from being three.
- Wire it into CI against the mock provider for smoke, and run it against a
  real model on demand.
- Only then tune prompts, and measure per task number: 13 and 15 will be near
  perfect long before 18 and 19 are usable.

## 3. Persistence

First real need is the problem bank: statement, reference solution, official
per-problem criteria, source variant.

- Postgres + SQLAlchemy 2.x async + Alembic. Add `app/db/`, a repository per
  aggregate, session dependency in `api/deps.py`.
- Grading history (request, response, model, prompt version, cost) — for
  billing, analytics and re-grades. The `TraceRecorder` ring buffer is
  explicitly *not* this; it is a per-process debugging aid.
- Idempotency: hash of (task, statement, solution, criteria, prompt version)
  → cached grade. Grading identical work twice is pure waste, and students
  resubmit constantly.

## 4. Handwriting → text

The biggest product gap: students photograph their work.

- A separate pipeline stage, not part of this service: image → LaTeX/text via
  a vision model, then the existing `/grade`.
- Add `input_format: "text" | "latex" | "image_url"` to `GradeRequest` and a
  transcription step in front of `GradingService`.
- Transcription confidence must reach the grader — a misread `−` costs a point
  and the student never knows why. Surface it in `confidence` and
  `meta.notes`.

## 5. Production hardening

- **Auth**: service-to-service key or JWT. `api/deps.py` is the place.
- **Rate limiting**: per student and per tenant. Grading is expensive.
- **Cost accounting**: usage is already tracked per call; add a pricing table
  and report roubles per grade. Deliberately not guessed at now — prices
  change and a wrong table is worse than none.
- **Metrics**: Prometheus. Grades/minute, p95 latency, retry rate, downgrade
  rate, normalisation-note rate (a prompt-quality canary), tokens per grade.
- **Timeouts and circuit breaking** around the provider; a degraded upstream
  should shed load rather than queue.

## 6. Grading quality mechanics

- **Self-consistency only where it pays.** `GRADING_SELF_CONSISTENCY` is
  all-or-nothing today. Better: one pass, then re-sample only when confidence
  is low or the score sits on a rubric boundary.
- **Per-criterion grading.** For 18 and 19, ask about each rubric band
  separately instead of one holistic score. More calls, but partial credit is
  exactly where the single-call approach is weakest.
- **Reference-solution retrieval.** Accuracy jumps when `reference_solution`
  is supplied. With a problem bank it can be looked up instead of passed in.
- **Escalation to a human.** Confidence, sample disagreement and
  normalisation notes are already computed; use them to route borderline work
  to a real expert.

## 7. Operational

- `docker-compose.override.yml` for personal settings without touching the
  tracked file.
- Ruff + mypy in CI. Type hints are already thorough enough for `--strict` to
  be realistic.
- Structured log shipping — `APP_LOG_FORMAT=json` already emits one object per
  line with `request_id`.
- Health checks are container-ready; add readiness gating on the DB when
  item 3 lands.

---

## Sequencing

Items 1 and 2 first, and in that order. Everything else is engineering that
can be added at any time; rubric fidelity and the ability to measure quality
are what decide whether this feature is good enough to show a student. A
faster, cheaper, better-instrumented service that marks задание 18 wrong is
not useful.
