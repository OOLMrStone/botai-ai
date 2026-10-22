# Backend implementation handoff

2026-10-05; read frozen SPEC first. Core owner: data_architect; grading/media/admin owner: next backend implementer. Java21/Boot4.1/Jackson3 (`tools.jackson.*`). Baseline fast-forwarded to `0295e72` email-ops; V1–V4 untouched. **V5__learning_and_grading.sql is shared schema**, V6 is core catalog seed. New SQL uses feature-specific JdbcClient/JdbcTemplate; auth existing JPA retained. No runtime compose/Dockerfile ownership here.

## Shared interfaces and data

- `catalog.TaskSnapshot(UUID id, UUID taskVersionId, int taskNumber, int maxScore, String statement, String referenceAnswer, String referenceSolution, List<String> acceptedAnswers, boolean isDemo)`. Core provides `CatalogService.snapshot(UUID versionId)`; no public reference leakage.
- `grading.port.GradingGateway`: `Map<Integer,Capability> capabilities()`; `Response grade(UUID runId,TaskSnapshot,List<Image>,String pinnedPackageId)`. Records in interface; adapter owns caching, fail-closed capability, bounded no-retry HTTP, strict response validation. Interface does not imply upstream is implemented.
- `media.port.ObjectStorage`: `put(key,byte[],mimeType)`, `get(key,maxBytes)`, `delete(key)`, `bucket()`; official SDK, private immutable keys. Media owner adds SDK/decoder dependency to build after informing core.
- Core common helpers: `ApiException(status,code,detail)`, `CurrentActor.require(Authentication): User`, `CurrentActor.requireAdmin(Authentication): User`, `JsonCodec.write(Object)/read(String):JsonNode`, `RequestIds.current()`. CurrentActor checks DB enabled/current role. `ProfileService.acceptGraded(userId,taskId,submissionId,score,maxScore,isDemo)` updates progress within caller's transaction; no-op for demo. Available and tested; exact public methods will not change silently.

## SQL contract (V5 is authoritative)

- `grading_submissions`: owner/nullable verified attempt+item FKs, immutable requested IDs; input_revision, revision, idempotency_key/request_hash unique per owner, retry_of_id, status, answer_snapshot, task_version_id, error_code, is_demo, package_id/provider_mode/request_id, timestamps. Partial unique one active draft/queued/running per item. Insert intent first, commit; attach verified item or persist rejection afterward.
- `submission_events`: append-only id bigint, submission_id, event_type, nullable actor_id, metadata JSONB, created_at. `grading_results`: unique submission_id, is_graded, nullable score/max_score, feedback JSONB safe camelCase projection, rejection_reason,is_demo, exact_response text,response_hash, provider_mode/package_id. Immutable triggers; rejected/failed/unsupported score null.
- `grading_jobs`: submission_id PK,state ready/claimed/dispatching/done,fencing_token,lease_until,available_at,run_id,timestamps. `grading_runs`: UUID, unique submission_id,fencing_token,pinned package_id,actual provider_mode,outcome,timestamps. No after-dispatch automatic retry; one dispatch per submission.
- `stored_objects`: UUID,user_id,nullable submission_id,purpose solution/avatar,bucket,unique object_key,state staged/ready/delete_pending/deleted/failed,file_name,mime_type,size_bytes,width,height,sha256,nullable ordinal,timestamps. Max4 staged+ready checked under submission row lock. Submission input revision/upload revision follows SPEC. `users.avatar_object_id` FK ready object.
- `attempts`: owner,kind training/mock-exam,template/format,status active/checking/completed,revision,current_index,idempotency_key/request_hash,timestamps. `attempt_items`: immutable membership/version,ordinal **zero-based**,answer,drawing JSONB array,answer_revision. Lock attempt before updating item+attempt revisions. Other owner returns404.
- `user_task_results`: PK user/task,submission_id,nullable first/last_solved_at; `user_activity_days`: PK user/local_date,qualified,active_seconds; `activity_events`: id unique,user/attempt,seconds,time. Demo/synthetic/unsupported never qualify progress. `attempt_checks` dedupes batch user/idempotency_key + request_hash.
- `admin_access_events(actor_id,action,target_id,time)`; admin detail/media access must insert event before delivering. `rate_limit_windows(scope,subject_hash,window_start,count)` allows atomic PostgreSQL budgets. Profile keeps plan free/pro; AI quotas must check persisted user under lock.

## Ownership split

Core owns all files in catalog/attempt/profile/common/auth/security/user plus V5/V6, core tests. Core `AttemptController` **does not map checks**; worker owner `SubmissionController` maps `/api/attempts/{id}/checks`, routes all submission APIs and owns short answer check+atomic result path so grading result acceptance has one owner. Core owns item solution endpoint and daily-task/solution.
Grading owner owns grading/ except shared port, media/ except port, admin/, worker tests, extra media/grading config. Worker returns safe `Submission` JSON in camelCase SPEC; core attempt reader projects stored submission/result via SQL (no circular service dependency). Notify core before table changes. Short checker uses server acceptedAnswers; normalized decimal comma/dot and surrounding whitespace only, no evaluation of client math.

Frozen v1.1 core/public DTOs: gradingCapability `available|unsupported|unavailable`; Task.progressStatus `unstarted|in-progress|solved`; Attempt.status `active|checking|completed`; stats.week `[{date,qualified,minutes}]`. Admin list/detail exact DTO coordinate with frontend owner. Raw AI JSON is admin-only.

## Ops

Runtime only grants Adminer operator SELECT on learning tables and a safe user view, **never users itself**, one_time_codes, spring_session, spring_session_attributes or credentials. Suggested `operator_users` view id/display_name/email/created_at; grants provisioned by runtime owner, not by public application. Exact bucket/object-key access should also be omitted from read-only operator unless operationally needed. Runtime DB role cannot update/delete immutable content/events/results; migrations use separate role.
Tests run Gradle in Java21 container; paid AI disabled. Core Java21 compile and 16 PostgreSQL17 integration tests passed; see CORE-IMPLEMENTATION.md. No production deploy authorization implied by this handoff.

## Core checkpoint

- Core read/write APIs and signatures above are implemented. `ProfileService.acceptGraded` requires a saved `graded` submission/result matching task/user/score, rejects fabricated flags, and no-ops for demo; invoke in the same transaction after setting terminal status.
- `AttemptService.get(user,id)` provides check response; `AttemptRepository` reads submission/results/media directly without circular service dependencies. Owner checks use live enabled/role; stale authority revokes indexed sessions.
- `stats.resumeAttempt` is nullable UUID; profile goal/level null until onboarding; `solution.referenceSolution` nullable string. 140 source topics, 100 labelled fixtures (5 per number), one exact20 template. Public version integers, year2027.
- Avatar bounds frozen by coordinator:2MiB,staticJPEG/PNG/WebP,4MP,side4096,normalize512. Main photo unchanged8MiB20MP8192max4. Worker owns durable multipart failure events; global MVC size limit failures can precede media controller, so handler/reconciler must preserve intent lifecycle.
- Runtime needs explicit development user/admin/pro provisioning and safe SMTP sink if email flow is exercised; core has no hardcoded account. `SESSION_COOKIE_SECURE` now controls Secure flag; HTTPS production must set true. Existing management health remains8081/internal.
