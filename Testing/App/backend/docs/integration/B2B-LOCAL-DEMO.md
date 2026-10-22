# B2B local demo — frontend contract v1 (2026-10-16)

Current 2026-10-21: expanded school catalog supports all annotated works14–20, ordered fixture attachment and repeated student submissions with preserved history. From-image preparation is immutable per submission (V21). The private personal-recording presentation override for fipi15.1.1 is disabled for real evaluation; its original manifest is preserved privately. This prevents a prepared recording document from replacing the displayed AI result. Expert analysis rerun remains unavailable.

Historical 2026-10-20: ordinary school→real AI→editable expert review→explicit confirm→student result verified. Local personal-recording fixture matches only fipi15.1.1 + exact normalized image hash: displays prepared7steps/2-of-2; genuine AI0/2 remains immutable. No standalone preview. Post-save normal expert document wins. Targeted reset complete; assignment ready for another user recording; see current [worklog](B2B-WORKLOG.md). This fixture test does not validate model grading accuracy.

Historical checkpoint 2026-10-16 18:39 MSK: LIVE idle; AI `84ad91d8c8250b0e332edb6e42295bfcfebec2b3`. Full15.2.3 browser E2E PASS: realAI1/2 matches fixture expected score; TeX/native number line→expert editor/comment/reset/Cancel→confirm→student reload/result. DB exactsinglefinal1/2 retains all25OCRlines and native diagram; previous final2/2 unchanged. Duration108.949s,8completed modelcalls,1summaryrepair,allfinishstop. Owner937 full/95 focused tests passed, independent review passed; frontend lint/TypeScript PASS; browser375px fits viewport, long formulas/diagram scroll inside blocks (frontend report; physical Android not tested). Backend/control/profile unchanged, chat32000/OCR8000/SDK0/deadline360. No root/runtime model calls; production read-only. Evidence: [B2B-WORKLOG.md](B2B-WORKLOG.md).

## Fixed product boundary

- School student sees only assignments explicitly provisioned to that student in an active school; task numbers `14|15|16|17|18|19|20`. One assignment = one immutable task snapshot.
- School submission is a typed origin in immutable grading/media pipeline, never a synthetic training/mock-exam attempt. No B2C history, favourites, solved-task/activity metrics or billing charges arise from school/local-demo origins.
- Photos and PDF use current private media pipeline; PDF original remains private, JPEG pages only go to AI; 1..4 solution images total, <=8MiB each. A task/reference image is **not** a solution image or part of the four-image budget.
- Valid AI completion creates one expert work and one durable in-app notification automatically. Frontend does not call the existing explicit `POST .../expert-review`. AI rejection with a valid document also reaches expert review. Transport/validation failure is a failed run, never a fabricated score/document.
- Existing expert edit/draft/grade-only/manual-grade/send APIs remain the review editor contract; new school structured documents use `expert-review.v2`, existing v1 documents remain supported. Student gets `result:null` until atomic expert send, then immutable final only. Task reference answer/solution, task/reference images, raw AI response and expert draft never appear in any student response/media route.
- Owner clarification, 21 October: expert grade-only recalculates the score from existing analysis. There is no expert action to rerun AI analysis, including after analysis failure; do not add one now. Automatic retries of a running AI step and operator creation of a new manual run are separate operations.

## Common transport

Same-origin `/api/*`, cookie credentials, existing login/CSRF flow; refresh CSRF after login. Mutations send `X-XSRF-TOKEN`, including multipart. UUID strings; timestamps ISO8601 UTC; optional values shown as `null` unless explicitly marked optional. All responses/media `Cache-Control: private, no-store`.

`Page<T> = {items:T[],nextCursor:string|null}`; `limit` default20, 1..50. Cursor opaque to frontend. School/schoolStudent/expert identity is server-derived; no body `schoolId`, `studentId`, provider key, external URL, storage key or arbitrary task ID.

Errors use existing `application/problem+json` `{type,title,status,detail,code}`. Frontend branches on `status/code`, displays safe detail. `401 session_required`; `403 forbidden` for role/disabled membership/CSRF; inaccessible object `404 not_found` regardless of existence. `400 validation_error|invalid_request`; `409 revision_conflict|idempotency_conflict|submission_in_progress|submission_not_draft|assignment_closed|expert_assignment_required`; `413 upload_too_large`; `422 images_required|unsupported_task_number`; `429 queue_full|daily_grading_limit|submission_rate_limit|pdf_busy`; `503 grading_unavailable|storage_unavailable|manual_input_unavailable`. Exact additional upload/PDF error codes retain existing contract.

## `/school`

`GET /api/school/me` →
```ts
type SchoolMe = {
  id: UUID; email: string; displayName: string | null;
  schools: {id:UUID; name:string}[];
  taskNumbers: [14,15,16,17,18,19,20];
};
```
Requires current enabled USER + >=1 active school roster + enabled school. Multi-school membership is supported in listing; assignment scope disambiguates every write.

`GET /api/school/assignments?limit=20&cursor=...` → `Page<AssignmentSummary>`.
`GET /api/school/assignments/{assignmentId}` → `AssignmentDetail`.
```ts
type SchoolStatus = 'not_started'|'draft'|'queued'|'running'|
  'awaiting_expert'|'reviewing'|'returned'|'failed'|'cancelled'|'expired';
type AssignmentSummary = {
  id:UUID; school:{id:UUID;name:string}; title:string;
  taskNumber:14|15|16|17|18|19|20; maxScore:number;
  assignedAt:string; dueAt:string|null; status:SchoolStatus;
  submissionId:UUID|null; updatedAt:string;
};
type StudentTask = {
  taskNumber:14|15|16|17|18|19|20; maxScore:number;
  statement:string; content:ContentBlock[];
};
type AssignmentDetail = AssignmentSummary & {
  task:StudentTask; submission:SchoolSubmission|null;
};
type SchoolSubmission = {
  id:UUID; assignmentId:UUID; origin:'school';
  revision:number; status:Exclude<SchoolStatus,'not_started'>;
  images:SolutionImage[]; documents:SolutionDocument[];
  createdAt:string; updatedAt:string;
  errorCode:string|null; retryable:boolean;
  expertReview:{status:'queued'|'draft'|'sent';sentAt:string|null}|null;
  imageArtifacts:ImageArtifact[];
  result:CanonicalDocument|null; // immutable final expert-review.v1|v2 only
};
```
`ContentBlock` reuses existing frontend task contract; content projection contains statement assets only. Assignment detail contains no references, including before/after send. Lists omit result/document; final is fetched in detail/submission/result. Dates are display metadata, not an unapproved automatic deadline lock.

Exact existing media shapes reused by school JSON (camelCase):
```ts
type ImageArtifact = {id:UUID;mimeType:'image/jpeg';previewUrl:string;width:number;height:number};
type SolutionImage = {
  id:UUID; fileName:string; mimeType:'image/jpeg'; sizeBytes:number;
  previewUrl:string; sourceDocumentId:UUID|null; pageNumber:number|null;
  status?:'ready'; // present in submission.images, absent in document.pages
};
type SolutionDocument = {
  id:UUID;fileName:string;mimeType:'application/pdf';sizeBytes:number;sha256:string;
  state:'processing'|'ready'|'failed'|'delete_pending'|'deleted';
  revision:number;pageCount:number|null;pages:SolutionImage[];
  errorCode:string|null;downloadUrl:string|null;
};
```
Submission JSON omits deleted/delete_pending documents. Document revision is current submission revision, not a separately incremented document counter. Processing → `pageCount:null,pages:[],downloadUrl:null`; ready → ordered complete pages1..N and private download URL; failed → `pages:[],downloadUrl:null,errorCode:<typed code>`. Every returned URL is backend-projected for current actor.

`POST /api/school/assignments/{assignmentId}/submissions`, JSON `{retryOfId?:UUID}`, required `Idempotency-Key` → `201 SchoolSubmission`; replay → `200` same submission. Server pins immutable assignment/task/student/school/expert routing. Active draft/queued/running/reviewing submission → `409 submission_in_progress` for a different key; detail lets frontend recover its ID. New retry only after a retryable terminal pipeline failure/cancel/expiry; v1 does not permit student to replace an already-sent final. A retry uses a new key and the actual previous ID; never overwrite original inputs/results.

Reuse routes with **origin-aware authorization and projection**:

| Method/path | Body | Response |
|---|---|---|
| `GET /api/submissions/{id}` | — | `SchoolSubmission` for school origin; existing B2C DTO unchanged |
| `POST /api/submissions/{id}/images` | multipart `file` | existing upload response; GET submission to refresh revision |
| `DELETE /api/submissions/{id}/images/{imageId}` | — | existing response; PDF-derived image deletes entire document group |
| `POST /api/submissions/{id}/documents` | multipart `file` | `202 SolutionDocument`, poll GET submission |
| `DELETE /api/submissions/{id}/documents/{documentId}` | — | `204` |
| `GET /api/submissions/{id}/documents/{documentId}/download` | — | own PDF exact bytes, attachment/private/no-store |
| `POST /api/submissions/{id}/finalize` | `{expectedRevision:number}` | `SchoolSubmission`, async queue acceptance |
| `POST /api/submissions/{id}/cancel` | `{}` | `SchoolSubmission`; existing fencing prevents late completion |
| `GET /api/school/assignments/{assignmentId}/result` | — | `{submissionId:UUID|null,status:SchoolStatus,result:CanonicalDocument|null,sentAt:string|null}` |

Student preview URLs are returned by backend and always same-origin/private. Generic `/api/media/{id}`, generic submission GET, document GET/download, explicit expert-review route and any admin route must honor school origin scope/redaction; UI hiding alone is insufficient. Student may never route a school submission to another school using old `expert-review` request.

Projection lifecycle: `draft → queued → running → awaiting_expert → reviewing → returned`.

| Internal submission / work | School JSON status | School JSON result |
|---|---|---|
| no submission | `not_started` (assignment only) | `null` |
| `draft`, including PDF processing/failed | `draft` | `null` |
| `queued` / no work | `queued` | `null` |
| `running` / no work | `running` | `null` |
| valid AI `graded|rejected|unsupported` + work `queued` | `awaiting_expert` | `null` |
| work `draft` | `reviewing` | `null` |
| work `sent` | `returned` | immutable final canonical document |
| pipeline `failed` | `failed` | `null` |
| `cancelled` / `expired` | `cancelled` / `expired` | `null` |

Valid AI completion/work creation is atomic; missing work after terminal AI success is a server invariant failure, never student-visible grading. AI graded/rejected/unsupported is never student `returned`; raw internal status is not delivery signal. `result` remains null in **all** reads/mutations before work `sent`; after send it uses canonical final snapshot, not `grading_results.feedback`. `expertReview` is null before work exists, then exposes status+sentAt only, never review/draft/aiResult.

Polling: GET submission every2s while PDF `processing` or status queued/running; every5s while awaiting/reviewing; pause hidden tab, retry after focus; stop on returned/failure/cancel/expiry/401/403/404. Polling may back off to10s for long waits. Serialize uploads; GET current revision after each mutation. Finalize only when at least1 ready image, no processing PDF, no failed document. `409 uploads_in_flight` → poll; `409 pdf_failed` → delete failed PDF before finalize. `409 revision_conflict` → reload, retain selected files locally; do not silently resend with updated revision.

Access revocation, local flag off, school disable and reassignment deny reads/dispatch but preserve historical originals/finals/crops. Revoked queued work becomes `failed/access_revoked`, with no automatic retry; user cancel and abandoned reservation cleanup remain explicit separate lifecycle facts.

## Expert notifications

`GET /api/expert/notifications?after=0&limit=20` → `{items:[{id:UUID,seq:number,type:'work_queued',workId:UUID,studentId:UUID,taskNumber:14|15|16|17|18|19|20,createdAt:string,readAt:string|null}],nextAfter:number,hasMore:boolean,unreadCount:number}`. `seq` strictly increasing, gaps allowed. Current assignment/school scope rechecked at read. `POST /api/expert/notifications/{id}/read` `{}` → `204`, idempotent. Notification/work/result creation shares one transaction; uniqueness by work/type, no duplicate on completion replay. UI polling5s while active. No email/Telegram/external messages are authorized.

## `/grade/dev`: local runs

Authorization approved: local-demo flag disabled by default + isolated local deployment + current enabled EXPERT account with separate server-side UUID allowlist/permission; same cookie/CSRF. Flag absent/off → routes `404`; wrong actor →403. No query/body bypass, no browser secret. Developer visibility includes school runs only from own active school/expert assignment; manual runs only created by current allowlisted developer. No global admin bypass to expert/student media.

Approved isolated runtime: project `botai-b2b-local`, DB `botai_b2b_local`, API18086, Mailpit18027, frontend13004. Separate `student.localhost`, `expert.localhost`, `dev.localhost` (browser verification pending); host-only `B2B_SESSION` + `XSRF-TOKEN`. Existing expert-local stack preserved. Dev may log in with the allowlisted expert account through its separate hostname/session. Hostname separation does not grant permission.

**Mandatory live gate:** separate server-side B2B full-pipeline `allow-live=false` by default, checked against fresh AI capability immediately before dispatch. Existing `APP_EXPERT_GRADING_ALLOW_LIVE` covers grade-only; it does not protect full photo with billing disabled. Gate applies to school/manual full-photo, task-image extraction and expert grade-only as applicable. Frontend cannot enable it; only explicitly authorized minimal local smoke may temporarily enable server configuration. No production or bulk evaluation.

`GET /api/local-demo/runs?origin=school|manual&status=...&limit=20&cursor=...` → `Page<RunSummary>`; omitted filters = authorized runs. `run.id` is a stable local-demo identifier allocated before AI dispatch; do not assume equality with existing `grading_runs.id`.
`GET /api/local-demo/runs/{runId}` → `RunDetail`.
Private operator media routes (frontend uses only returned URLs): `GET /api/local-demo/runs/{runId}/task-input/{assetId}/preview` (manual input or same-school reference), `/api/local-demo/runs/{runId}/task-media/{assetId}` (statement), `/api/local-demo/runs/{runId}/images/{imageId}/preview`, `/api/local-demo/runs/{runId}/documents/{docId}/download`, `/api/local-demo/runs/{runId}/image-artifacts/{artifactId}/preview`. Each rechecks current allowlisted operator + exact run/source school/assignment; task/reference input never enters generic/student media.

```ts
type RunState = 'preparing'|'queued'|'running'|'completed'|'awaiting_expert'|
  'reviewing'|'returned'|'failed'|'unknown'|'cancelled';
type RunSummary = {
  id:UUID; origin:'school'|'manual'; submissionId:UUID;
  assignmentId:UUID|null; workId:UUID|null; taskNumber:14|15|16|17|18|19|20;
  state:RunState; phase:string; revision:number;
  isDemo:boolean; createdAt:string;updatedAt:string;errorCode:string|null;
};
type ObserverStatus = {state:'not_started'|'pending'|'finished'|'incomplete';expiresAt:string|null};
type RunDetail = RunSummary & {
  observer:ObserverStatus;
  task:{taskNumber:14|15|16|17|18|19|20;maxScore:number;statement:string|null;
    content:ContentBlock[];referenceAnswer:string|null;referenceSolution:string|null;
    inputImage:{id:UUID;previewUrl:string}|null};
  images:SolutionImage[]; documents:SolutionDocument[];
  imageArtifacts:ImageArtifact[];
  aiResult:CanonicalDocument|null; // validated public structured output
  artifacts:{id:UUID;kind:'ocr'|'analysis'|'grading'|'task_input';
    state:'available'|'unavailable';document:object|null;previewUrl:string|null}[];
  lastEventSeq:number;
};
```
`GET /api/local-demo/runs/{runId}/events?after=0&limit=100` → `{items:[{seq:number,type:string,phase:string,state:RunState,createdAt:string,data:object}],nextAfter:number,hasMore:boolean,observer:ObserverStatus}`. `after` exclusive, seq monotonic per run, gaps allowed; empty page retains cursor. Cursor advances only to last delivered event. Deduplicate by seq. Whitelist `data` (counts, durationMs, safe errorCode, artifact IDs), never forward raw event metadata. Events are append-only progress facts, not model reasoning. No SSE requirement; poll2s, drain `hasMore` immediately, refresh detail on new events; restore after reload from0 or saved cursor. After terminal grading, continue event polling while observer.state=pending; stop only after advancing the events cursor, draining `hasMore=false`, and observer.state is finished/incomplete/not_started. A RunDetail first read never skips event pagination; observer.finished means all known facts have been published, not that this browser has consumed them. Awaiting_expert/reviewing may poll5s. Valid manual AI completion maps to `completed`; valid school AI completion maps to `awaiting_expert` after work creation.

Phases guaranteed from existing backend facts: `input_received`, `media_processing`, `queued`, `ai_running`, `ai_completed`, `expert_queued`, `expert_draft`, `expert_sent`, `failed`, `unknown`, `cancelled`. OCR/analysis/grading phase start/end events are emitted only if the AI integration supplies actual stage evidence. The v2 observer supplies actual stage facts; never synthesize stage percentages/timestamps. UI labels phases generically and treats unknown additive values as plain status text.

`POST /api/local-demo/runs/manual`, required `Idempotency-Key`, multipart:

- `task_number`: decimal14–20.
- `task_image`: exactly1 JPEG/PNG, <=8MiB; contains condition + official reference answer/solution (developer-only input).
- `solution_images`: repeated1..4 JPEG/PNG files, <=8MiB each, order significant. V1 manual form accepts images; `/school` separately supports PDF through existing upload flow.

Response `202 RunDetail`; same key+same raw input file bytes/order →200 existing run, different input →409 idempotency_conflict. Hash includes task_number, raw task file bytes, raw ordered solution file bytes; ignores multipart boundary and original filename. Identical pixels in differently encoded files are different inputs. Server allocates durable input/run before dispatch; reload/poll recovers network loss. No duplicate AI call on same key. New key never auto-retries unknown after dispatch. Admission before enqueue; no server request waits for full AI run.

Private AI boundary implemented: `photo-grade.v2`, `/internal/v2/grading` for trusted school task snapshots, `/internal/v2/grading/from-images` for separate manual task/reference image. Service authentication/capabilities stay backend-only. Manual extraction is persisted once under the live worker fence; no invented reference, fake B2C task or reference image in solution images. Missing capability → `503 manual_input_unavailable`. Manual diagnostic runs do not create a student/expert work.

Allowed artifact payload: validated OCR blocks, concise pedagogical analysis, grading criteria/score, input images and server-safe phase/error facts. Exclude hidden reasoning/chain-of-thought, prompts/system messages, provider raw response, transport headers, API keys, bearer/session tokens, storage bucket/keys, internal filesystem paths. `isDemo` follows mock/content flags; live local run is not falsely labelled mock.

## Canonical and data constraints

Configuration: `APP_B2B_LOCAL_ENABLED` / `app.b2b.local-enabled=false`; `APP_B2B_ALLOW_LIVE` / `app.b2b.allow-live=false`; `APP_B2B_OPERATOR_USER_IDS` / `app.b2b.operator-user-ids` comma-separated UUID allowlist, empty denies all operators.

Statement image route fixed: `GET /api/school/assignments/{assignmentId}/task-media/{assetId}` → private normalized statement image. Validates active current student assignment and exact asset role `statement`; `reference` is never readable here or via generic media. Backend puts this exact prefix in student task content. Expert statement assets use `GET /api/expert/works/{workId}/task-media/{assetId}` with current expert scope; developer reference asset uses run-scoped operator route only.

Canonical **expert-review.v2** additive extension approved (persisted v1 reads and old v1 writes retain their strict previous behavior): optional block `title:string` (<=500); `content:{type:'step',lines:string[],diagram?:NumberLineContent|UnitCircleContent|NumberLineV2|UnitCircleV2,image?:{type:'image',artifact_id:UUID,alt:string}}`. Lines0..64, each<=16000; alt<=200. Empty lines only when diagram or image exists; otherwise at least one nonblank line. Diagram and image are mutually exclusive. Existing editable number_line/unit_circle schemas remain unchanged; symbolic types below are additive only inside v2 step.diagram. Only geometric student drawings use stored image crops. ONE stable block_id and ONE block_review across all lines/image. Existing text/math/number_line/unit_circle remain valid. Image artifact is a distinct server-generated UUID for a real normalized stored crop, bound to this submission+sourceImageId+validated bbox metadata; no CSS-generated crop, URLs from AI or arbitrary cross-submission UUID. Private artifact endpoints recheck parent submission/work scope. Task/reference input is never a crop source. Title/lines/native diagram/image changes participate in existing semantic stale-grading hash. Work, SchoolSubmission and RunDetail expose `imageArtifacts:ImageArtifact[]`; student gets ready artifacts referenced by sent final only; expert/dev gets scoped ready artifacts. Frontend uses projected previewUrl and canonical artifact_id.

Seed-facing schema (approved dedicated school task domain; exact names): `school_tasks(id,school_id,task_number,max_score,title,statement,content,reference_answer,reference_solution,is_demo,created_at)`, unique(id,school_id), immutable. `school_assignments(id,school_id,student_user_id,task_id,title,assigned_at,due_at,enabled,closed_at,created_at)`, composite school/student roster and school/task FK. `school_task_assets(id,school_id,task_id,kind,bucket,object_key,file_name,mime_type,size_bytes,sha256,created_at)` kind `statement|reference`, immutable private media; never student-owned stored_objects. Tasks14–20; official references nullable full solution, official answer preserved. Runtime seed provisions these directly in new isolated DB; no B2C tasks/attempts.

Generated immutable v2 `aiResult` has `origin:'structured_ai'`; internal-only validation accepts it. Client draft/send accepts `origin:'expert'` only; persisted v1 behavior is unchanged. V2 findings optionally retain `penalty:integer` in0..taskMaxScore, including explicit0; absent legacy penalties stay absent. Title/lines/diagram/crop/penalty participate in stale-grading hash; total score is never recomputed from penalties.

B2B grade-only discovers exact `grade_analysis:{path:'/internal/v2/grading/grade-analysis',contract_version:'expert-grading.v1'}` through fresh v2 capabilities. Request/response stays expert-grading.v1, analysis (including penalty) passes unchanged, no OCR/photos. After capabilities, server rechecks current scope, pending job, prepared revision and input hash immediately before POST, outside network transactions. Live grade-only requires BOTH `APP_B2B_ALLOW_LIVE` and `APP_EXPERT_GRADING_ALLOW_LIVE`; old v1 policy remains unchanged.

B2B dispatch lease1200s covers HTTP390s plus bounded private storage/crop IO (max8 AI crops); B2C lease stays420s. B2B fencing uses actual clock_timestamp, including inside an older transaction. Expired dispatched work becomes unknown after dispatch, never auto-replayed. Provider retry budgets are unchanged.

Security-approved DB checks: B2C requested IDs nonnull, actual attempt/task IDs may remainnull for existing rejected invalid intents. School/manual all actual/requested attempt IDs NULL. One school assignment active submission includes terminal AI graded/rejected/unsupported while awaiting review; final sent is nonreplaceable. Lock assignment and durable unique constraint, not application-only count. Manual five8MiB files require route-bound41MiB parser, not global upload bypass; parser-rejected413 cannot promise persisted file payload, only safe request/audit metadata.

### Lossless native figure contract — approved

Only `expert-review.v2` `step.diagram` gains these symbolic types. AI `figure.kind:'number_line'|'unit_circle'` is renamed to canonical `type:'number_line_v2'|'unit_circle_v2'`; every other field, null, optional-field presence and array order is retained. Existing numeric diagrams remain valid both top-level and inside step.diagram; v1 validation is unchanged. New symbolic types are forbidden as top-level block content. The AI raw adapter emits only the new symbolic branches, never numeric backprojection.

```ts
type NativeSign = '+'|'-'|'0'|null;
type NativePoint = {
  id:string; value:string; included:boolean|null; sign:NativeSign; bound?:boolean;
};
type NativeArc = {from:string;to:string;sign:NativeSign;selected:boolean};
type NumberLineV2 = {
  type:'number_line_v2'; variable:string; note:string|null;
  points:NativePoint[]; arcs:NativeArc[];
};
type UnitCircleV2 = {
  type:'unit_circle_v2'; points:NativePoint[];
  arcs:(NativeArc & {direction:'cw'|'ccw';full_circle:boolean})[];
};
```

Exact required/optional keys; unknown keys rejected. Max64 points/128 arcs. IDs nonblank <=128, unique within points; point IDs `-inf`/`+inf` reserved. Value nonblank string <=500; variable nonblank <=64; note null or nonblank <=2000. Optional bound is boolean; included may be null only with bound:true. Arc endpoints name supplied point IDs; only number-line endpoints additionally allow `-inf`/`+inf`. Sparse arcs/self-loops/sign0/null and supplied point order are valid; no inferred arcs, sorting, expression evaluation or numeric placeholders. Circle direction is required; full_circle equals `(from===to)`. Circle rendering may parse known angle expressions in frontend; unknown expressions remain original data for manual clarification. All fields and presence/order participate in semantic hash. Invalid AI structures fail as invalid_ai_response before any grade/work publication.

Local-demo public event sequences have a per-run publication lock and unique source binding; out-of-order source commits cannot disappear behind a cursor. Actual AI events use a separate import lock and whitelist, never the grading submission lock. Durable observer jobs are registered before the paid POST and survive gateway return/restart; max4 workers, each drain <=3s/6pages. At25min or scope revocation they become explicitly incomplete; no fabricated AI completion. Lost manual preparation after10min becomes inspectable `failed/preparation_interrupted`; same-key replay never queues it automatically.

## Local failure diagnostics — 21 October 2026

Local run summaries/details add nullable `failure`. Old runs without classified facts keep
`failure:null` and their existing `errorCode`; no attempt count is inferred. A classified
failure has `category: 'model_response'|'network'|'provider'|'configuration'|'input'|'timeout'|'internal'`
and optional evidence fields `diagnosticCode`, `reasonCode`, `phase`, `step`, `attempt`,
`maxAttempts`, `failureCounts`, `retryable`, `exhausted`, `issueCodes`, `issuePaths`.
Diagnostic numeric ranges are **not HTTP status codes**: 3xx input, 4xx network,
5xx provider, 6xx model response, 7xx configuration, 8xx deadline, 9xx internal.
Attempts are per validated step (1..4, maxAttempts=4); failureCounts counts categories
within that step (0..4). Do not infer four attempts from a terminal failure.

The event importer projects the same fields in camelCase (`failureCategory` for the
wire `failure_category`). Only enum categories/phases, bounded identifiers, bounded
JSON field paths, typed counts and booleans pass. Raw model text, messages, request
headers, URLs and private artifacts remain excluded. Existing event `attempt` may
also identify a model-call counter; use classified step metadata for retry displays.
Actual AI terminal facts take precedence over the bounded HTTP `error.details`
fallback. The fallback is stored as a separate `local_ai_http_failure` observation,
not a fabricated model completion. The existing `errorCode=ai_error_<HTTP>` remains
available for compatibility. No backend POST replay is introduced: retries belong
inside the AI step and preserve already completed stages.


## Shared local AI queue — 21 October 2026

Full-photo grading and B2B expert grade-only now share durable FIFO admission through
`B2bAiScheduler`. `B2B_AI_CONCURRENCY` (1..8, default **1**) supplies both local
`PHOTO_CONCURRENCY` and backend `APP_B2B_AI_CONCURRENCY`. Backend admission uses the
minimum of its configured limit and fresh AI capabilities `concurrency`; an older
AI without that field is treated as capacity one. No frontend capacity is enforced.
A full AI trace store (`available_run_records=0`) leaves work queued without claiming
it or consuming an execution slot. The legacy non-B2B synchronous grade-only path
is unchanged; the dedicated local runtime routes use v2 and shared admission.

These are operating limits, not a claim of measured provider/network capacity.
Keep the conservative default until representative load and resource measurements
justify another value. In the current 512MiB AI container, large photo decoding can
limit safe concurrency before the provider's account allowance does.

Backend memory is now capped at 1 GiB (previously 768 MiB); the running container
was updated without restart or image/environment changes, and Compose persists
the new cap. AI remains 512 MiB for its entire process/container, not per check.
This resource-only change does not increase the configured one-slot AI capacity.

The scheduler reserves shared DB capacity under an advisory transaction lock, chooses
the oldest ready full-photo or queued grade-only item, then releases the DB lock
before I/O. A free slot starts the next item; it does not wait for the entire batch.
Full-photo fencing, cancellation and uncertain-dispatch rules remain intact. A
queued grade-only job has no deadline; admission transitions it to `pending` and
starts its seven-minute deadline exactly once. Expired pending jobs become `unknown`
and are never automatically replayed. Rights, current revision and analysis hash are
checked again after admission and immediately before dispatch. The slot is released
in `finally`; an invalidated queued edit fails before model dispatch.

`POST /api/expert/works/{id}/grade` keeps its existing HTTP200 work-envelope response;
for B2B it now returns `gradeJob.state='queued'` immediately. Poll the existing grade-job
GET while state is `queued` **or** `pending`. The remaining states and fields are
unchanged. Idempotent replay returns the same job, not another queue entry. Migration
V19 adds queued state/deadline rules and the durable AI acknowledgement ledger.

AI traces are acknowledged through authenticated DELETE only after the backend outcome
is durable. Full-photo acknowledgement additionally requires imported terminal observer
events; no early ACK during response parsing or while the observer is incomplete.
Grade-only acknowledges its persisted terminal outcome. ACK409 remains pending, 404
means already expired, repeated success is idempotent. AI now immediately deletes
temporary event/artifact payloads on ACK, after backend has durably copied them.
Only a bounded UUID receipt remains to prevent replay. Uncertain or failed POSTs
are never replayed; producing final JSON at AI alone does not trigger deletion.

Grade-only возвращает тот же nullable allowlisted объект диагностики в `gradeJob.failure`. Неопределённый исход отправленного запроса сохраняет резерв слота до срока AI или подтверждённого ACK; освобождение Java-потока само по себе не разрешает новый вызов. HTTP-ошибка до загрузки пакета допускает `X-Grading-Package-Id: none` только с совпадающими request ID, contract и provider mode; успешный ответ всегда требует pinned package.

Backlog ограничен общим `app.grading.queue-limit` (default 100): незавершённые full-photo jobs плюс queued grade-only и pending/unknown с ещё действующим deadline. Обе операции enqueue используют один transaction advisory lock 726118013; переполнение возвращает `queue_full` до сохранения экспертной правки/задания и без списания проверки. Истёкший unknown не занимает backlog бессрочно.

## Student fixture attachment and repeat submissions — 21 October 2026

The local school catalog supports project task numbers14–20. Assignment detail adds `fixtureAvailable:boolean`, `fixtureAttachmentIncomplete:boolean`, `canResubmit:boolean`, and `history:SchoolSubmission[]` (newest first). Catalog consumers must paginate to include every seeded assignment. History retains previous immutable results; starting a new submission never overwrites a sent expert final. `canResubmit` is false while a draft, queued/running submission or unknown dispatch exists. For a known failed/cancelled/expired latest submission, use its `retryOfId`; after a successfully completed submission create with no `retryOfId` and a fresh idempotency key.

`POST /api/school/assignments/{assignmentId}/submissions/{submissionId}/fixture` has no request payload and returns the full updated submission. Existing session authentication and CSRF apply. The assignment must belong to the active school student, the submission must belong to that assignment and remain draft, and `app.b2b.local-enabled` must be true. Server-only fixture rows select1–4 ordered images; the browser cannot specify a path or object key. Images pass through the ordinary `MediaService` normalization and ownership checks. The action only attaches photos; it never finalizes or invokes AI.

The first attachment requires an empty draft. A completed replay returns the same submission without adding photos. A concurrent or interrupted attachment returns409 `fixture_attachment_in_progress`; finalization is blocked until the entire batch completes. For a failed/interrupted batch cancel the draft and create a new attempt; never blindly replay partial uploads. Previous results remain readable in history. Source images and fixture mappings stay private, and expected evaluation scores are not part of the seed package or model inputs.

V20 adds the task input mode, private ordered fixture mapping and attachment claim, and narrows the assignment uniqueness guard to active/unknown work. Existing tasks, submissions and expert results are preserved. New image-based source cases use `inputMode:from-images`; only scoped reference imagery is used for AI task preparation. Original prepared cases keep their approved text and answer.
