package org.botai.back.expert;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.*;
import org.botai.back.security.CurrentActor;
import org.botai.back.user.Role;
import org.botai.back.media.MediaService;
import org.botai.back.catalog.CatalogService;
import org.botai.back.security.RateLimits;
import tools.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import java.util.*;

@Service
@Transactional
@RequiredArgsConstructor
public class ExpertService {
    @org.springframework.beans.factory.annotation.Value("${app.grading.queue-limit:100}") private int queueLimit;
    private final CurrentActor actors;
    private final JdbcTemplate db;
    private final JsonCodec json;
    private final ExpertReviewDocument documents;
    private final MediaService media;
    private final org.botai.back.media.SolutionDocumentService sourceDocuments;
    private final ExpertGradingBasis basis;
    private final CatalogService catalog;
    private final RateLimits rateLimits;
    private final org.springframework.transaction.support.TransactionTemplate transactions;
    private final org.botai.back.b2b.SubmissionOrigins origins;
    private final org.botai.back.b2b.B2bConfig b2b;
    private final org.botai.back.media.port.ObjectStorage storage;
    private final org.botai.back.school.SchoolTaskContent taskContent;
    private record Expert(UUID id, UUID school, String name, String email, String displayName) { }

    private Expert expert(Authentication auth) {
        var user = actors.require(auth);
        if (user.getRole() != Role.EXPERT) throw new ApiException(403, "forbidden", "Доступ запрещён");
        var rows = db.query("""
            SELECT e.school_id,s.name,u.email,u.display_name FROM school_experts e
            JOIN schools s ON s.id=e.school_id JOIN users u ON u.id=e.user_id
            WHERE e.user_id=? AND e.enabled AND s.enabled AND u.enabled AND u.role='EXPERT'
            FOR SHARE OF e,s,u
            """, (r,n) -> new Expert(user.getId(), r.getObject("school_id", UUID.class), r.getString("name"), r.getString("email"), r.getString("display_name")), user.getId());
        if (rows.isEmpty()) throw new ApiException(403, "forbidden", "Доступ запрещён");
        return rows.getFirst();
    }
    public JsonNode me(Authentication auth) {
        var e = expert(auth); Map<String,Object> result = new LinkedHashMap<>();
        result.put("id", e.id); result.put("email", e.email); result.put("displayName", e.displayName); result.put("school", Map.of("id", e.school, "name", e.name));
        return json.read(json.write(result));
    }
    public Page<JsonNode> students(Authentication auth, Integer requestedLimit, String cursor) {
        var e = expert(auth); int limit = Page.limit(requestedLimit), offset = Page.offset(cursor);
        var rows = db.query("""
            SELECT jsonb_build_object('id',r.user_id,'firstName',r.first_name,'lastName',r.last_name,'email',u.email,'contact',r.contact)::text
            FROM school_students r JOIN users u ON u.id=r.user_id
            JOIN expert_students a ON a.school_id=r.school_id AND a.student_user_id=r.user_id
            WHERE r.school_id=? AND a.expert_user_id=? AND r.enabled AND u.enabled AND u.role='USER'
            ORDER BY r.last_name,r.first_name,r.user_id LIMIT ? OFFSET ?
            """, (r,n) -> json.read(r.getString(1)), e.school, e.id, limit + 1, offset);
        return Page.of(rows, offset, limit);
    }
    public JsonNode assign(Authentication auth, UUID student) {
        var e = expert(auth);
        var roster = db.queryForList("""
            SELECT r.user_id FROM school_students r JOIN users u ON u.id=r.user_id
            WHERE r.school_id=? AND r.user_id=? AND r.enabled AND u.enabled AND u.role='USER'
            FOR UPDATE OF r FOR SHARE OF u
            """, e.school, student);
        if (roster.isEmpty()) throw ApiException.notFound();
        var assignment = db.queryForList("SELECT expert_user_id FROM expert_students WHERE school_id=? AND student_user_id=? FOR UPDATE", e.school, student);
        if (!assignment.isEmpty() && !e.id.equals(assignment.getFirst().get("expert_user_id"))) throw ApiException.conflict("student_assigned");
        if (assignment.isEmpty()) db.update("INSERT INTO expert_students(school_id,student_user_id,expert_user_id) VALUES(?,?,?)", e.school, student, e.id);
        return student(e.school, student);
    }
    private JsonNode student(UUID school, UUID user) {
        return json.read(db.queryForObject("""
            SELECT jsonb_build_object('id',r.user_id,'firstName',r.first_name,'lastName',r.last_name,'email',u.email,'contact',r.contact)::text
            FROM school_students r JOIN users u ON u.id=r.user_id WHERE r.school_id=? AND r.user_id=?
            """, String.class, school, user));
    }
    private static final String VISIBLE = """
        FROM expert_works w JOIN expert_students es ON es.school_id=w.school_id AND es.student_user_id=w.student_user_id AND es.expert_user_id=w.expert_user_id
        JOIN school_students ss ON ss.school_id=w.school_id AND ss.user_id=w.student_user_id
        JOIN users u ON u.id=w.student_user_id JOIN grading_submissions gs ON gs.id=w.submission_id
        LEFT JOIN attempts a ON a.id=coalesce(gs.attempt_id,gs.requested_attempt_id)
        LEFT JOIN school_assignments sa ON sa.id=gs.school_assignment_id
        JOIN grading_task_snapshots tv ON tv.submission_id=gs.id JOIN grading_results gr ON gr.submission_id=gs.id
        WHERE w.school_id=? AND w.expert_user_id=? AND ss.enabled AND u.enabled AND u.role='USER' AND ((gs.origin='b2c' AND a.id IS NOT NULL AND a.deleted_at IS NULL) OR (gs.origin='school' AND sa.enabled))
        """;
    private static final String SUMMARY = """
        jsonb_build_object('id',w.id,'submissionId',w.submission_id,'student',jsonb_build_object('id',u.id,'firstName',ss.first_name,'lastName',ss.last_name,'email',u.email,'contact',ss.contact),
        'taskNumber',tv.exam_number,'maxScore',gr.max_score,'isDemo',gr.is_demo,'status',w.status,'revision',w.revision,'createdAt',w.created_at,'updatedAt',w.updated_at)
        """;
    private String visible(){return VISIBLE+(b2b.enabled()?"":" AND gs.origin='b2c' ");}
    public Page<JsonNode> works(Authentication auth, String status, UUID student, Integer requestedLimit, String cursor) {
        var e = expert(auth); int limit = Page.limit(requestedLimit), offset = Page.offset(cursor);
        if (status != null && !Set.of("queued", "draft", "sent").contains(status)) throw ApiException.invalid("Некорректный статус");
        var rows = db.query("SELECT " + SUMMARY + "::text summary,w.ai_document::text,w.document::text,w.graded_input_hash,w.accepted_grading::text " + visible() + " AND (?::text IS NULL OR w.status=?) AND (?::uuid IS NULL OR w.student_user_id=?) ORDER BY w.created_at DESC,w.id LIMIT ? OFFSET ?",
            (r,n) -> {
                var summary = (ObjectNode)json.read(r.getString("summary"));
                Map<String,Object> row = new HashMap<>(); for (String key : List.of("ai_document", "document", "graded_input_hash", "accepted_grading")) row.put(key, r.getString(key));
                summary.put("gradingStale", gradingStale(row, currentDocument(row))); return (JsonNode)summary;
            }, e.school, e.id, status, status, student, student, limit + 1, offset);
        return Page.of(rows, offset, limit);
    }
    private Map<String,Object> lockWork(Expert e, UUID id, boolean write) {
        var rows = db.queryForList("SELECT w.student_user_id,w.submission_id,a.id attempt_id " + visible() + " AND w.id=?", e.school, e.id, id);
        if (rows.isEmpty()) throw ApiException.notFound();
        UUID student = (UUID)rows.getFirst().get("student_user_id");
        if(origins.b2b((UUID)rows.getFirst().get("submission_id"))){if(!origins.valid((UUID)rows.getFirst().get("submission_id"),true))throw ApiException.notFound();}else if (db.queryForList("SELECT id FROM attempts WHERE id=? AND deleted_at IS NULL FOR SHARE", rows.getFirst().get("attempt_id")).isEmpty()) throw ApiException.notFound();
        lockAssignment(e.school, student, e.id);
        var locked = db.queryForList("SELECT w.* " + visible() + " AND w.id=?" + (write ? " FOR UPDATE OF w" : " FOR SHARE OF w"), e.school, e.id, id);
        if (locked.isEmpty()) throw ApiException.notFound();
        return locked.getFirst();
    }
    public UUID requireArtifactWork(Authentication auth,UUID id,boolean write){var e=expert(auth);var work=lockWork(e,id,write);if(write&&"sent".equals(work.get("status")))throw ApiException.conflict("review_sent");return(UUID)work.get("submission_id");}
    private void lockAssignment(UUID school, UUID student, UUID expert) {
        var roster = db.queryForList("SELECT r.user_id FROM school_students r JOIN users u ON u.id=r.user_id WHERE r.school_id=? AND r.user_id=? AND r.enabled AND u.enabled AND u.role='USER' FOR SHARE OF r,u", school, student);
        if (roster.isEmpty()) throw ApiException.notFound();
        var assignments = db.queryForList("SELECT student_user_id FROM expert_students WHERE school_id=? AND student_user_id=? AND expert_user_id=? FOR SHARE", school, student, expert);
        if (assignments.isEmpty()) throw ApiException.notFound();
    }
    public JsonNode work(Authentication auth, UUID id) { var e = expert(auth); lockWork(e, id, false); return detail(e, id); }
    private JsonNode detail(Expert e, UUID id) {
        var result = (ObjectNode)json.read(db.queryForObject("SELECT (" + SUMMARY + """
            || jsonb_build_object('task',jsonb_build_object('statement',tv.statement,'content',tv.content,'referenceAnswer',tv.reference_answer,'referenceSolution',tv.reference_solution),
            'images',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'fileName',o.file_name,'mimeType',o.mime_type,'sizeBytes',o.size_bytes,'sourceDocumentId',o.source_document_id,'pageNumber',o.page_number,'previewUrl','/api/expert/works/'||w.id||'/images/'||o.id) ORDER BY o.ordinal) FROM stored_objects o WHERE o.submission_id=w.submission_id AND o.purpose='solution' AND o.state='ready'),'[]'::jsonb),
            'documents',solution_documents_json(w.submission_id),'aiResult',w.ai_document,'review',coalesce(w.document,w.ai_document),'sentAt',w.sent_at)
            """.stripTrailing() + ")::text " + visible() + " AND w.id=?", String.class, e.school, e.id, id));
        var schoolTask=db.queryForList("SELECT a.task_id FROM expert_works w JOIN grading_submissions s ON s.id=w.submission_id JOIN school_assignments a ON a.id=s.school_assignment_id WHERE w.id=?",id);if(!schoolTask.isEmpty())((ObjectNode)result.get("task")).set("content",taskContent.project((UUID)schoolTask.getFirst().get("task_id"),"/api/expert/works/"+id+"/task-media/"));
        for(var document:result.get("documents")) {
            var source=(ObjectNode)document;if(source.path("state").asText().equals("ready"))source.put("downloadUrl","/api/expert/works/"+id+"/documents/"+source.path("id").asText());
            for(var page:source.get("pages"))((ObjectNode)page).put("previewUrl","/api/expert/works/"+id+"/images/"+page.path("id").asText());
        }
        var row = db.queryForMap("SELECT * FROM expert_works WHERE id=?", id); result.put("gradingStale", gradingStale(row, currentDocument(row)));
        db.update("UPDATE expert_grading_jobs SET state='unknown',error_code='unknown_after_dispatch',updated_at=now() WHERE work_id=? AND state='pending' AND deadline_at<now()", id);
        var latest = db.queryForList("SELECT jsonb_build_object('id',id,'state',state,'baseRevision',base_revision,'preparedRevision',prepared_revision,'appliedRevision',applied_revision,'errorCode',error_code,'failure',failure)::text payload FROM expert_grading_jobs WHERE work_id=? AND school_id=? AND expert_user_id=? ORDER BY created_at DESC,id DESC LIMIT 1", id, e.school, e.id);
        result.set("imageArtifacts",json.read(db.queryForObject("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'mimeType','image/jpeg','previewUrl','/api/expert/works/'||?::text||'/artifacts/'||id||'/preview','width',width,'height',height)),'[]'::jsonb)::text FROM submission_artifacts WHERE submission_id=(SELECT submission_id FROM expert_works WHERE id=?) AND state='ready'",String.class,id,id)));
        result.set("gradeJob", latest.isEmpty() ? json.read("null") : json.read(latest.getFirst().get("payload").toString()));
        return result;
    }
    public JsonNode save(Authentication auth, UUID id, ExpertDtos.Save request, boolean send) {
        var e = expert(auth); var work = lockWork(e, id, true);
        if (work.get("status").equals("sent")) throw ApiException.conflict("review_sent");
        int revision = (Integer)work.get("revision");
        if (revision != request.expectedRevision()) throw ApiException.conflict("revision_conflict");
        var ai = json.read(work.get("ai_document").toString());
        var images = new ArrayList<String>(); ai.get("solution_image_ids").forEach(image -> images.add(image.asText()));
        int max = db.queryForObject("SELECT max_score FROM grading_results WHERE submission_id=?", Integer.class, work.get("submission_id"));
        documents.validate(request.document(), images, max, send,readyArtifacts((UUID)work.get("submission_id")));
        if (send && gradingStale(work, request.document())) throw ApiException.conflict("grading_stale");
        persist(e, id, revision, request.document(), send, false);
        return detail(e, id);
    }
    private JsonNode currentDocument(Map<String,Object> row) { return json.read((row.get("document") == null ? row.get("ai_document") : row.get("document")).toString()); }
    private boolean gradingStale(Map<String,Object> row, JsonNode document) {
        if (document.path("phase").asText().equals("rejected")) return false;
        if (!document.path("phase").asText().equals("graded")) return true;
        var ai = json.read(row.get("ai_document").toString());
        String acceptedHash = row.get("graded_input_hash") == null ? basis.hash(ai) : row.get("graded_input_hash").toString();
        var acceptedGrade = row.get("accepted_grading") == null ? ai.get("grading") : json.read(row.get("accepted_grading").toString());
        return !basis.hash(document).equals(acceptedHash) || !document.get("grading").equals(acceptedGrade);
    }
    private void persist(Expert e, UUID id, int revision, JsonNode document, boolean send, boolean acceptGrade) {
        String raw = json.write(document);
        db.update("INSERT INTO expert_review_versions(work_id,revision,kind,document,actor_id) VALUES(?,?,?,?::jsonb,?)", id, revision + 1, send ? "final" : "draft", raw, e.id);
        db.update("""
            UPDATE expert_works SET status=?,revision=revision+1,document=?::jsonb,updated_at=now(),sent_at=CASE WHEN ? THEN now() ELSE NULL END,
            graded_input_hash=CASE WHEN ? THEN ? ELSE graded_input_hash END,accepted_grading=CASE WHEN ? THEN ?::jsonb ELSE accepted_grading END WHERE id=?
            """, send ? "sent" : "draft", raw, send, acceptGrade, acceptGrade ? basis.hash(document) : null, acceptGrade, acceptGrade ? json.write(document.get("grading")) : null, id);
        db.update("INSERT INTO submission_events(submission_id,event_type,actor_id,metadata) SELECT submission_id,?,?,'{}'::jsonb FROM expert_works WHERE id=?",send?"expert_sent":"expert_draft",e.id,id);
    }
    public JsonNode manualGrade(Authentication auth, UUID id, ExpertDtos.Save request) {
        var e = expert(auth); var work = lockWork(e, id, true); validateWrite(work, request);
        if (!request.document().path("phase").asText().equals("graded")) throw ApiException.invalid("Для ручной оценки нужен балл");
        persist(e, id, (Integer)work.get("revision"), request.document(), false, true);
        db.update("UPDATE expert_grading_jobs SET state='stale',error_code='manual_grade',updated_at=now() WHERE work_id=? AND state IN('queued','pending','unknown')", id);
        return detail(e, id);
    }
    private void validateWrite(Map<String,Object> work, ExpertDtos.Save request) {
        if (work.get("status").equals("sent")) throw ApiException.conflict("review_sent");
        if (((Integer)work.get("revision")).intValue() != request.expectedRevision().intValue()) throw ApiException.conflict("revision_conflict");
        var ai = json.read(work.get("ai_document").toString()); var images = new ArrayList<String>(); ai.get("solution_image_ids").forEach(image -> images.add(image.asText()));
        int max = db.queryForObject("SELECT max_score FROM grading_results WHERE submission_id=?", Integer.class, work.get("submission_id")); documents.validate(request.document(), images, max, false,readyArtifacts((UUID)work.get("submission_id")));
    }
    public record GradeStart(UUID jobId, UUID workId, ExpertGradingGateway.Request request, JsonNode replay) { }
    public GradeStart prepareGrade(Authentication auth, UUID id, String key, ExpertDtos.Save request) {
        org.botai.back.grading.SubmissionService.key(key);
        var e = expert(auth); var work = lockWork(e, id, true);
        String hash = basis.requestHash(request.expectedRevision(), request.document());
        var prior = db.queryForList("SELECT * FROM expert_grading_jobs WHERE work_id=? AND expert_user_id=? AND idempotency_key=?", id, e.id, key);
        if (!prior.isEmpty()) {
            if (!hash.equals(prior.getFirst().get("request_hash"))) throw ApiException.conflict("idempotency_conflict");
            return new GradeStart((UUID)prior.getFirst().get("id"), id, null, gradeJob(auth, id, (UUID)prior.getFirst().get("id")));
        }
        validateWrite(work, request);
        String phase = request.document().path("phase").asText();
        if (!Set.of("analysis", "graded").contains(phase)) throw ApiException.invalid("Перед оценкой нужен анализ");
        var analysis = request.document().get("analysis"); boolean reviewed = true;
        for (JsonNode review : analysis.get("block_reviews")) if (review.get("status").isNull()) reviewed = false;
        if (analysis.get("summary").isNull() || analysis.get("summary").asText().isBlank()) { if (!reviewed) throw ApiException.invalid("Перед оценкой нужен анализ"); }
        if (db.queryForObject("SELECT count(*) FROM expert_grading_jobs WHERE work_id=? AND state IN('queued','pending','unknown')", Integer.class, id) > 0) throw ApiException.conflict("grading_in_progress");
        var submission = db.queryForMap("SELECT gs.task_version_id,gr.provider_mode,gr.package_id FROM grading_submissions gs JOIN grading_results gr ON gr.submission_id=gs.id WHERE gs.id=?", work.get("submission_id"));
        if (submission.get("provider_mode") == null || submission.get("package_id") == null) throw new ApiException(503,"grading_unavailable","Оценка пока недоступна");
        if(origins.b2b((UUID)work.get("submission_id")))b2b.requireProvider(submission.get("provider_mode").toString());
        if(org.botai.back.grading.SharedGradingQueue.full(db,queueLimit))throw new ApiException(429,"queue_full","Очередь заполнена. Повтори позже");
        rateLimits.check("expert-grade", e.id.toString(), 6, 60);
        UUID job = UUID.randomUUID(); int revision = (Integer)work.get("revision");
        persist(e, id, revision, request.document(), false, false);
        boolean queued = origins.b2b((UUID)work.get("submission_id"));
        db.update("INSERT INTO expert_grading_jobs(id,work_id,school_id,expert_user_id,idempotency_key,request_hash,input_hash,base_revision,prepared_revision,document,state,deadline_at) VALUES(?,?,?,?,?,?,?,?,?,?::jsonb,?,CASE WHEN ? THEN NULL ELSE clock_timestamp()+interval '7 minutes' END)", job, id, e.school, e.id, key, hash, basis.hash(request.document()), revision, revision + 1, json.write(request.document()), queued?"queued":"pending", queued);
        if(queued)return new GradeStart(job,id,null,gradeJob(auth,id,job));
        var ids = new ArrayList<String>(); request.document().get("ocr").get("blocks").forEach(block -> ids.add(block.get("id").asText()));
        var stage = new ExpertGradingGateway.Request(job, origins.b2b((UUID)work.get("submission_id"))?origins.task((UUID)work.get("submission_id")):catalog.snapshot((UUID)submission.get("task_version_id")), analysis, ids, submission.get("package_id").toString(), submission.get("provider_mode").toString(),origins.b2b((UUID)work.get("submission_id")));
        return new GradeStart(job, id, stage, null);
    }
    public record QueuedGrade(Authentication auth,GradeStart started) { }
    /** Called only after the shared scheduler atomically changes queued to pending. */
    public QueuedGrade admittedGrade(UUID jobId) {
        var rows=db.queryForList("SELECT j.*,u.email,w.submission_id FROM expert_grading_jobs j JOIN users u ON u.id=j.expert_user_id JOIN expert_works w ON w.id=j.work_id WHERE j.id=? AND j.state='pending' AND j.deadline_at>clock_timestamp()",jobId);
        if(rows.isEmpty())throw ApiException.conflict("grading_stale");
        var job=rows.getFirst();
        Authentication auth=new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(job.get("email"),"",List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_EXPERT")));
        var e=expert(auth);var work=lockWork(e,(UUID)job.get("work_id"),false);
        if("sent".equals(work.get("status"))||!work.get("revision").equals(job.get("prepared_revision"))||!basis.hash(currentDocument(work)).equals(job.get("input_hash")))throw ApiException.conflict("grading_stale");
        UUID submission=(UUID)job.get("submission_id");
        var provenance=db.queryForMap("SELECT provider_mode,package_id FROM grading_results WHERE submission_id=?",submission);
        b2b.requireProvider(provenance.get("provider_mode").toString());
        var document=json.read(job.get("document").toString());var ids=new ArrayList<String>();document.path("ocr").path("blocks").forEach(block->ids.add(block.path("id").asText()));
        var request=new ExpertGradingGateway.Request(jobId,origins.task(submission),document.get("analysis"),ids,provenance.get("package_id").toString(),provenance.get("provider_mode").toString(),true);
        return new QueuedGrade(auth,new GradeStart(jobId,(UUID)job.get("work_id"),request,null));
    }
    public JsonNode finishGrade(Authentication auth, GradeStart started, ExpertGradingGateway.Response response) {
        var e = expert(auth); var work = lockWork(e, started.workId(), true);
        var jobs = db.queryForList("SELECT * FROM expert_grading_jobs WHERE id=? AND work_id=? AND school_id=? AND expert_user_id=? FOR UPDATE", started.jobId(), started.workId(), e.school, e.id);
        if (jobs.isEmpty()) throw ApiException.notFound(); var job = jobs.getFirst();
        if (!job.get("state").equals("pending") || ((java.sql.Timestamp)job.get("deadline_at")).toInstant().isBefore(java.time.Instant.now()) || work.get("status").equals("sent") || !work.get("revision").equals(job.get("prepared_revision")) || !basis.hash(currentDocument(work)).equals(job.get("input_hash"))) throw ApiException.conflict("grading_stale");
        if (!response.providerMode().equals(started.request().providerMode()) || !response.packageId().equals(started.request().packageId())) throw new ApiException(502,"invalid_ai_response","Некорректный ответ оценки");
        var document = (ObjectNode)json.read(job.get("document").toString()); document.put("phase", "graded"); document.set("grading", response.grading());
        try { validateWrite(work, new ExpertDtos.Save((Integer)job.get("prepared_revision"), document)); }
        catch (ApiException invalid) { if (invalid.status() == 400) throw new ApiException(502,"invalid_ai_response","Некорректный ответ оценки"); throw invalid; }
        persist(e, started.workId(), (Integer)work.get("revision"), document, false, true);
        db.update("UPDATE expert_grading_jobs SET state='succeeded',grading=?::jsonb,applied_revision=prepared_revision+1,updated_at=now() WHERE id=?", json.write(response.grading()), started.jobId());
        return gradeJob(auth, started.workId(), started.jobId());
    }
    public void failGrade(UUID job, String state, String code) { failGrade(job,state,code,null); }
    public void failGrade(UUID job,String state,String code,Map<String,Object> failure) {
        db.update("UPDATE expert_grading_jobs SET state=?,error_code=?,failure=?::jsonb,updated_at=now() WHERE id=? AND state='pending'",state,code,failure==null?null:json.write(failure),job);
    }
    /** Rechecked after provider capabilities, immediately before the private B2B grade-only POST. */
    public void authorizeGradeDispatch(UUID jobId){
        var rows=db.queryForList("SELECT j.work_id,j.expert_user_id,j.school_id,sc.name,u.email,u.display_name FROM expert_grading_jobs j JOIN school_experts se ON se.school_id=j.school_id AND se.user_id=j.expert_user_id JOIN schools sc ON sc.id=se.school_id JOIN users u ON u.id=se.user_id WHERE j.id=? AND se.enabled AND sc.enabled AND u.enabled AND u.role='EXPERT' FOR SHARE OF se,sc,u",jobId);
        if(rows.isEmpty())throw ApiException.notFound();var r=rows.getFirst();var e=new Expert((UUID)r.get("expert_user_id"),(UUID)r.get("school_id"),r.get("name").toString(),r.get("email").toString(),(String)r.get("display_name"));var work=lockWork(e,(UUID)r.get("work_id"),false);
        var jobs=db.queryForList("SELECT prepared_revision,input_hash FROM expert_grading_jobs WHERE id=? AND state='pending' AND deadline_at>clock_timestamp() FOR SHARE",jobId);
        if(jobs.isEmpty()||"sent".equals(work.get("status"))||!work.get("revision").equals(jobs.getFirst().get("prepared_revision"))||!basis.hash(currentDocument(work)).equals(jobs.getFirst().get("input_hash")))throw ApiException.conflict("grading_stale");
    }
    public JsonNode gradeJob(Authentication auth, UUID workId, UUID jobId) {
        var e = expert(auth); lockWork(e, workId, false);
        var rows = db.queryForList("SELECT id FROM expert_grading_jobs WHERE id=? AND work_id=? AND school_id=? AND expert_user_id=?", jobId, workId, e.school, e.id);
        if (rows.isEmpty()) throw ApiException.notFound();
        db.update("UPDATE expert_grading_jobs SET state='unknown',error_code='unknown_after_dispatch',updated_at=now() WHERE id=? AND state='pending' AND deadline_at<now()", jobId);
        var result = (ObjectNode)detail(e, workId);
        result.set("gradeJob", json.read(db.queryForObject("SELECT jsonb_build_object('id',id,'state',state,'baseRevision',base_revision,'preparedRevision',prepared_revision,'appliedRevision',applied_revision,'errorCode',error_code,'failure',failure)::text FROM expert_grading_jobs WHERE id=?", String.class, jobId)));
        return result;
    }
    @Transactional(propagation=org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public org.botai.back.media.SolutionDocumentService.Original originalDocument(Authentication auth,UUID workId,UUID documentId) {
        var work=transactions.execute(t->{var e=expert(auth);return lockWork(e,workId,false);});
        var original=sourceDocuments.original((UUID)work.get("student_user_id"),(UUID)work.get("submission_id"),documentId);
        transactions.executeWithoutResult(t->{var e=expert(auth);lockWork(e,workId,false);});return original;
    }
    public MediaService.Content image(Authentication auth, UUID workId, UUID imageId) {
        var e = expert(auth); var work = lockWork(e, workId, false);
        var images = db.queryForList("SELECT id FROM stored_objects WHERE id=? AND submission_id=? AND user_id=? AND purpose='solution' AND state='ready' FOR SHARE", imageId, work.get("submission_id"), work.get("student_user_id"));
        if (images.isEmpty()) throw ApiException.notFound();
        return media.read((UUID)work.get("student_user_id"), false, imageId);
    }
    public JsonNode route(Authentication auth, UUID submission, UUID school) {
        if(origins.b2b(submission))throw ApiException.notFound();
        var owner = actors.require(auth); if (owner.getRole() != Role.USER) throw new ApiException(403,"forbidden","Доступ запрещён");
        var memberships = db.queryForList("""
            SELECT es.expert_user_id FROM schools s JOIN school_experts e ON e.school_id=s.id
            JOIN users u ON u.id=e.user_id JOIN expert_students es ON es.school_id=e.school_id AND es.expert_user_id=e.user_id
            WHERE s.id=? AND es.student_user_id=? AND s.enabled AND e.enabled AND u.enabled AND u.role='EXPERT'
            FOR SHARE OF s,e,u
            """, school, owner.getId());
        if (memberships.isEmpty()) {
            if (db.queryForObject("SELECT count(*) FROM school_students r JOIN schools s ON s.id=r.school_id WHERE r.school_id=? AND r.user_id=? AND r.enabled AND s.enabled", Integer.class, school, owner.getId()) == 0) throw ApiException.notFound();
            throw ApiException.conflict("expert_assignment_required");
        }
        UUID expert = (UUID)memberships.getFirst().get("expert_user_id");
        var rows = db.queryForList("""
            SELECT gs.id,gs.status,gr.is_graded,gr.feedback::text,gr.rejection_reason FROM grading_submissions gs
            JOIN attempts a ON a.id=coalesce(gs.attempt_id,gs.requested_attempt_id)
            LEFT JOIN grading_results gr ON gr.submission_id=gs.id
            WHERE gs.id=? AND gs.user_id=? AND a.user_id=? AND a.deleted_at IS NULL FOR SHARE OF a FOR UPDATE OF gs
            """, submission, owner.getId(), owner.getId());
        if (rows.isEmpty()) throw ApiException.notFound();
        lockAssignment(school, owner.getId(), expert);
        var prior = db.queryForList("SELECT id FROM expert_works WHERE school_id=? AND submission_id=?", school, submission);
        if (prior.isEmpty()) {
            var result = rows.getFirst();
            if (result.get("is_graded") == null || !Set.of("graded", "rejected", "unsupported").contains(result.get("status"))) throw ApiException.conflict("ai_result_required");
            var images = db.queryForList("SELECT id FROM stored_objects WHERE submission_id=? AND purpose='solution' AND state='ready' ORDER BY ordinal", UUID.class, submission).stream().map(UUID::toString).toList();
            if (Boolean.TRUE.equals(result.get("is_graded")) && result.get("feedback") == null) throw ApiException.conflict("ai_result_required");
            var ai = documents.legacy(json.read((String)result.get("feedback")), Boolean.TRUE.equals(result.get("is_graded")), (String)result.get("rejection_reason"), images);
            db.update("INSERT INTO expert_works(id,school_id,student_user_id,expert_user_id,submission_id,ai_document) VALUES(?,?,?,?,?,?::jsonb)", UUID.randomUUID(), school, owner.getId(), expert, submission, json.write(ai));
        }
        return studentReviewLocked(owner.getId(), submission, school);
    }
    public JsonNode studentReview(Authentication auth, UUID submission, UUID school) {
        var owner = actors.require(auth);
        return studentReviewLocked(owner.getId(), submission, school);
    }
    private Set<String> readyArtifacts(UUID submission){return new HashSet<>(db.query("SELECT id::text FROM submission_artifacts WHERE submission_id=? AND state='ready' FOR SHARE",(r,n)->r.getString(1),submission));}
    public JsonNode notifications(Authentication auth,long after,Integer requestedLimit){var e=expert(auth);if(after<0)throw ApiException.invalid("Некорректный курсор");int limit=Page.limit(requestedLimit);var rows=db.query("SELECT n.seq,jsonb_build_object('id',n.id,'seq',n.seq,'type',n.type,'workId',n.work_id,'studentId',w.student_user_id,'taskNumber',tv.exam_number,'createdAt',n.created_at,'readAt',n.read_at)::text payload FROM expert_notifications n JOIN expert_works w ON w.id=n.work_id JOIN grading_task_snapshots tv ON tv.submission_id=w.submission_id WHERE n.seq>? AND n.expert_user_id=? AND EXISTS(SELECT 1 "+visible()+" AND w.id=n.work_id) ORDER BY n.seq LIMIT ?",(r,n)->json.read(r.getString("payload")),after,e.id,e.school,e.id,limit+1);var delivered=rows.stream().limit(limit).toList();long cursor=delivered.isEmpty()?after:delivered.getLast().path("seq").asLong();int unread=db.queryForObject("SELECT count(*) FROM expert_notifications n WHERE n.read_at IS NULL AND n.expert_user_id=? AND EXISTS(SELECT 1 "+visible()+" AND w.id=n.work_id)",Integer.class,e.id,e.school,e.id);return json.read(json.write(Map.of("items",delivered,"nextAfter",cursor,"hasMore",rows.size()>limit,"unreadCount",unread)));}
    public void readNotification(Authentication auth,UUID notification){var e=expert(auth);var rows=db.queryForList("SELECT work_id FROM expert_notifications WHERE id=? AND expert_user_id=?",notification,e.id);if(rows.isEmpty())throw ApiException.notFound();lockWork(e,(UUID)rows.getFirst().get("work_id"),false);db.update("UPDATE expert_notifications SET read_at=coalesce(read_at,now()) WHERE id=?",notification);}
    @Transactional(propagation=org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public MediaService.Content taskMedia(Authentication auth,UUID work,UUID asset){var row=transactions.execute(t->taskAsset(auth,work,asset));byte[] bytes=storage.get(row.get("object_key").toString(),8*1024*1024);transactions.executeWithoutResult(t->taskAsset(auth,work,asset));return new MediaService.Content(bytes,row.get("mime_type").toString());}
    private Map<String,Object> taskAsset(Authentication auth,UUID work,UUID asset){UUID submission=requireArtifactWork(auth,work,false);var rows=db.queryForList("SELECT o.object_key,o.mime_type FROM grading_submissions s JOIN school_assignments a ON a.id=s.school_assignment_id JOIN school_task_assets o ON o.task_id=a.task_id AND o.school_id=a.school_id WHERE s.id=? AND o.id=? AND o.kind='statement'",submission,asset);if(rows.isEmpty())throw ApiException.notFound();return rows.getFirst();}
    private JsonNode studentReviewLocked(UUID owner, UUID submission, UUID school) {
        if(origins.b2b(submission)){origins.requireOwner(owner,submission,true);var schoolRows=db.queryForList("SELECT sa.id FROM grading_submissions s JOIN school_assignments sa ON sa.id=s.school_assignment_id WHERE s.id=? AND sa.school_id=?",submission,school);if(schoolRows.isEmpty())throw ApiException.notFound();}
        var rows = db.query("""
            SELECT jsonb_build_object('id',w.id,'submissionId',w.submission_id,'status',w.status,'revision',w.revision,
                'document',CASE WHEN w.status='sent' THEN w.document ELSE NULL END,'sentAt',w.sent_at)::text
            FROM expert_works w JOIN grading_submissions gs ON gs.id=w.submission_id LEFT JOIN attempts a ON a.id=coalesce(gs.attempt_id,gs.requested_attempt_id)
            WHERE w.school_id=? AND w.submission_id=? AND w.student_user_id=? AND gs.user_id=? AND ((gs.origin='b2c' AND a.id IS NOT NULL AND a.deleted_at IS NULL) OR gs.origin='school')
            """, (r,n) -> json.read(r.getString(1)), school, submission, owner, owner);
        if (rows.isEmpty()) throw ApiException.notFound(); return rows.getFirst();
    }
}
