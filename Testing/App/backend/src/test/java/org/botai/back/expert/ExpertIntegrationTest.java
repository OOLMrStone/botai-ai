package org.botai.back.expert;

import org.botai.back.attempt.*;
import org.botai.back.catalog.CatalogRepository;
import org.botai.back.common.JsonCodec;
import org.botai.back.media.port.ObjectStorage;
import org.botai.back.user.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.*;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataAccessException;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.botai.back.common.ApiException;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"spring.docker.compose.enabled=false","management.server.port=0","app.grading.worker-enabled=false"})
@AutoConfigureTestRestTemplate
@Testcontainers
class ExpertIntegrationTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    static class StageGateway implements ExpertGradingGateway {
        final AtomicInteger calls = new AtomicInteger(); volatile CountDownLatch entered, release; volatile boolean unknown, invalid;
        public Response grade(Request request) {
            assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isFalse(); calls.incrementAndGet();
            if (entered != null) { entered.countDown(); try { if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Gateway timeout"); } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); } }
            if (unknown) throw new ApiException(502,"unknown_after_dispatch","Unknown result");
            long errors = java.util.stream.StreamSupport.stream(request.analysis().get("block_reviews").spliterator(), false).filter(review -> review.path("status").asText().equals("error")).count();
            var grading = tools.jackson.databind.json.JsonMapper.builder().build().readTree("{\"score\":"+(invalid ? 99 : Math.max(0, request.task().maxScore()-errors))+",\"criterion\":\"Mock\",\"explanation\":\"Тест\"}");
            return new Response(grading, request.providerMode(), request.packageId());
        }
        void reset() { calls.set(0); entered = null; release = null; unknown = false; invalid = false; }
    }
    @TestConfiguration static class Ports {
        @Bean @Primary StageGateway stageGateway() { return new StageGateway(); }
        @Bean @Primary ObjectStorage storage() {
            return new ObjectStorage() {
                public void put(String key, byte[] value, String type) { }
                public byte[] get(String key, long cap) { return (key.startsWith("pdf-fixture/")?"%PDF-1.7 original fixture\n%%EOF":"photo").getBytes(java.nio.charset.StandardCharsets.UTF_8); }
                public void delete(String key) { }
                public String bucket() { return "test-private"; }
            };
        }
    }
    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate db;
    @Autowired UserRepository users;
    @Autowired AttemptService attempts;
    @Autowired JsonCodec json;
    @Autowired StageGateway stage;
    UUID school, otherSchool, expert, colleague, foreignExpert, student, outsider, submission, image;
    Login expertLogin, studentLogin;
    record Login(String session, String csrf) { }
    record Submitted(UUID id, UUID image, UUID attempt) { }

    @BeforeEach void setup() {
        stage.reset();
        school = school(); otherSchool = school();
        expert = account(Role.EXPERT); colleague = account(Role.EXPERT); foreignExpert = account(Role.EXPERT);
        student = account(Role.USER); outsider = account(Role.USER);
        member(school, expert); member(school, colleague); member(otherSchool, foreignExpert);
        roster(school, student); roster(otherSchool, outsider);
        var fixture = submitted(student, true); submission = fixture.id; image = fixture.image;
        expertLogin = login(expert); studentLogin = login(student);
    }
    @Test void explicitRoutingDraftAndFinalRoundTripPreserveAiAndDeliverOnlyFinal() {
        assertThat(items(http("GET", "/api/expert/works", expertLogin, null))).isEmpty();
        assertThat(code(http("GET", "/api/expert/works/" + submission, expertLogin, null))).isEqualTo(404);
        assertThat(code(http("POST", "/api/expert/students", expertLogin, Map.of("studentId", student)))).isEqualTo(200);
        assertThat(code(http("POST", "/api/expert/students", expertLogin, Map.of("studentId", student)))).isEqualTo(200);
        assertThat(items(http("GET", "/api/expert/works", expertLogin, null))).isEmpty();
        var routed = route(submission); UUID id = UUID.fromString(routed.path("id").asText());
        assertThat(route(submission).path("id")).isEqualTo(routed.path("id"));
        var initial = getWork(id); var ai = initial.get("aiResult");
        assertThat(ai.path("schema_version").asText()).isEqualTo("expert-review.v1");
        assertThat(ai.get("analysis").get("block_reviews").get(0).get("status").isNull()).isTrue();
        assertThat(ai.get("analysis").get("block_reviews").get(0).has("explanation")).isTrue();
        assertThat(ai.get("analysis").get("checks").get("domain").isNull()).isTrue();
        assertThat(initial.path("isDemo").asBoolean()).isTrue();
        assertThat(initial.get("review")).isEqualTo(ai);
        assertThat(items(http("GET", "/api/expert/works?status=queued&studentId=" + student, expertLogin, null))).hasSize(1);
        ObjectNode edited = expertDocument(ai);
        ((ObjectNode)edited.get("ocr").get("blocks").get(0).get("content")).put("text", "Исправленный OCR");
        var saved = http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, Map.of("expectedRevision", 0, "document", edited));
        assertThat(code(saved)).isEqualTo(200); assertThat(body(saved).path("revision").asInt()).isEqualTo(1);
        assertThat(body(saved).get("review")).isEqualTo(edited); assertThat(body(saved).get("aiResult")).isEqualTo(ai);
        assertThat(body(saved).get("review").get("analysis")).isEqualTo(ai.get("analysis"));
        assertThat(body(saved).get("review").get("grading")).isEqualTo(ai.get("grading"));
        JsonNode correctedOcr = json.read(json.write(edited.get("ocr")));
        ((ObjectNode)edited.get("analysis").get("block_reviews").get(0)).put("status", "warning");
        ((ObjectNode)edited.get("grading")).put("score", 1);
        var analyzed = http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, Map.of("expectedRevision", 1, "document", edited));
        assertThat(code(analyzed)).isEqualTo(200);
        assertThat(body(analyzed).get("review").get("ocr")).isEqualTo(correctedOcr);
        assertThat(body(analyzed).get("aiResult")).isEqualTo(ai);
        assertThat(studentReview(submission).get("document").isNull()).isTrue();
        assertThat(code(http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, Map.of("expectedRevision", 0, "document", edited)))).isEqualTo(409);
        assertThat(getWork(id).path("gradingStale").asBoolean()).isTrue();
        assertThat(code(http("POST", "/api/expert/works/" + id + "/send", expertLogin, Map.of("expectedRevision", 2, "document", edited)))).isEqualTo(409);
        var manual = http("POST", "/api/expert/works/" + id + "/manual-grade", expertLogin, Map.of("expectedRevision", 2, "document", edited));
        assertThat(code(manual)).isEqualTo(200); assertThat(body(manual).path("gradingStale").asBoolean()).isFalse();
        var sent = http("POST", "/api/expert/works/" + id + "/send", expertLogin, Map.of("expectedRevision", 3, "document", edited));
        assertThat(code(sent)).isEqualTo(200); assertThat(body(sent).path("status").asText()).isEqualTo("sent");
        assertThat(studentReview(submission).get("document")).isEqualTo(edited);
        assertThat(studentReview(submission).get("sentAt").isString()).isTrue();
        assertThat(getWork(id).get("aiResult")).isEqualTo(ai);
        assertThat(code(http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, Map.of("expectedRevision", 4, "document", edited)))).isEqualTo(409);
        assertThat(db.queryForObject("SELECT count(*) FROM expert_review_versions WHERE work_id=?", Integer.class, id)).isEqualTo(4);
        assertThat(db.queryForObject("SELECT score FROM grading_results WHERE submission_id=?", Integer.class, submission)).isEqualTo(2);
        assertThatThrownBy(() -> db.update("UPDATE expert_works SET revision=3 WHERE id=?", id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> db.update("UPDATE expert_review_versions SET kind='draft' WHERE work_id=?", id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> db.update("UPDATE grading_results SET score=0 WHERE submission_id=?", submission)).isInstanceOf(DataAccessException.class);
    }
    @Test void isolateSchoolsExpertsImagesAndFinalRecipientsWithoutGlobalStudentLookup() {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText());
        var other = login(colleague); var foreign = login(foreignExpert); var ordinary = login(outsider); var admin = login(account(Role.ADMIN));
        for (Login actor : List.of(other, foreign)) {
            assertThat(code(http("GET", "/api/expert/works/" + id, actor, null))).isEqualTo(404);
            assertThat(code(http("GET", "/api/expert/works/" + id + "/images/" + image, actor, null))).isEqualTo(404);
            assertThat(code(http("PUT", "/api/expert/works/" + id + "/draft", actor, Map.of("expectedRevision", 0, "document", expertDocument(getWork(id).get("review")))))).isEqualTo(404);
            assertThat(items(http("GET", "/api/expert/works?studentId=" + student, actor, null))).isEmpty();
        }
        assertThat(code(http("GET", "/api/expert/me", ordinary, null))).isEqualTo(403);
        assertThat(code(http("GET", "/api/expert/me", admin, null))).isEqualTo(403);
        assertThat(code(http("POST", "/api/expert/students", expertLogin, Map.of("studentId", outsider)))).isEqualTo(404);
        assertThat(code(http("POST", "/api/expert/students", foreign, Map.of("studentId", student)))).isEqualTo(404);
        assertThat(code(http("POST", "/api/expert/students", other, Map.of("studentId", student)))).isEqualTo(409);
        assertThat(code(http("GET", "/api/submissions/" + submission + "/expert-review?schoolId=" + school, ordinary, null))).isEqualTo(404);
        assertThat(code(http("POST", "/api/submissions/" + submission + "/expert-review", ordinary, Map.of("schoolId", school)))).isEqualTo(404);
        assertThat(code(http("POST", "/api/submissions/" + submission + "/expert-review", studentLogin, Map.of("schoolId", otherSchool)))).isEqualTo(404);
        var readable = http("GET", "/api/expert/works/" + id + "/images/" + image, expertLogin, null);
        assertThat(code(readable)).isEqualTo(200); assertThat(readable.getHeaders().getFirst("Cache-Control")).isEqualTo("private, no-store");
        assertThat(code(http("GET", "/api/media/" + image, expertLogin, null))).isEqualTo(404);
        var different = submitted(student, true);
        assertThat(code(http("GET", "/api/expert/works/" + id + "/images/" + different.image, expertLogin, null))).isEqualTo(404);
        UUID avatar = UUID.randomUUID();
        db.update("INSERT INTO stored_objects(id,user_id,purpose,bucket,object_key,state,file_name,mime_type) VALUES(?,?,'avatar','test',?,'ready','avatar.png','image/png')", avatar, student, avatar.toString());
        assertThat(code(http("GET", "/api/expert/works/" + id + "/images/" + avatar, expertLogin, null))).isEqualTo(404);
        db.update("DELETE FROM expert_students WHERE school_id=? AND student_user_id=?", school, student);
        assertThat(code(http("GET", "/api/expert/works/" + id, expertLogin, null))).isEqualTo(404);
        assertThat(code(http("GET", "/api/expert/works/" + id + "/images/" + image, expertLogin, null))).isEqualTo(404);
    }
    @Test void requiresCurrentMembershipCsrfAndBoundedValidCanonicalPayload() {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText());
        var doc = expertDocument(getWork(id).get("review"));
        assertThat(code(http("GET", "/api/expert/me", new Login(null, null), null))).isEqualTo(401);
        assertThat(code(http("PUT", "/api/expert/works/" + id + "/draft", new Login(expertLogin.session, null), Map.of("expectedRevision", 0, "document", doc)))).isEqualTo(403);
        ObjectNode invalid = expertDocument(doc); ((ObjectNode)invalid.get("grading")).put("score", 3);
        assertThat(code(http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, Map.of("expectedRevision", 0, "document", invalid)))).isEqualTo(400);
        invalid = expertDocument(doc); invalid.put("origin", "structured_ai");
        assertThat(code(http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, Map.of("expectedRevision", 0, "document", invalid)))).isEqualTo(400);
        assertThat(code(http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, " ".repeat(1049601)))).isEqualTo(413);
        assertThat(code(http("POST", "/api/submissions/" + submission + "/expert-review", studentLogin, " ".repeat(1049601)))).isEqualTo(413);
        assertThat(getWork(id).path("revision").asInt()).isZero();
        db.update("UPDATE school_experts SET enabled=false WHERE user_id=?", expert);
        assertThat(code(http("GET", "/api/expert/me", expertLogin, null))).isEqualTo(403);
        db.update("UPDATE school_experts SET enabled=true WHERE user_id=?", expert);
        db.update("UPDATE schools SET enabled=false WHERE id=?", school);
        assertThat(code(http("GET", "/api/expert/works/" + id, expertLogin, null))).isEqualTo(403);
        db.update("UPDATE schools SET enabled=true WHERE id=?", school);
        db.update("UPDATE users SET role='USER' WHERE id=?", expert);
        assertThat(code(http("GET", "/api/expert/me", expertLogin, null))).isEqualTo(401);
    }
    @Test void concurrentDraftCompareAndSwapHasOneWinner() throws Exception {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText()); var doc = expertDocument(getWork(id).get("review"));
        try (var executor = Executors.newFixedThreadPool(2)) {
            var start = new CountDownLatch(1);
            Callable<Integer> save = () -> { start.await(); return code(http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, Map.of("expectedRevision", 0, "document", doc))); };
            var first = executor.submit(save); var second = executor.submit(save); start.countDown();
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS))).containsExactlyInAnyOrder(200, 409);
        }
        assertThat(getWork(id).path("revision").asInt()).isEqualTo(1);
        assertThat(db.queryForObject("SELECT count(*) FROM expert_review_versions WHERE work_id=?", Integer.class, id)).isEqualTo(1);
    }
    @Test void rejectedAiStaysUnscoredAndShortAnswerCannotBecomeAiReview() {
        assign(); var rejected = submitted(student, false); UUID id = UUID.fromString(route(rejected.id).path("id").asText());
        var doc = getWork(id).get("aiResult"); assertThat(doc.path("phase").asText()).isEqualTo("rejected"); assertThat(doc.get("grading").isNull()).isTrue();
        assertThat(code(http("POST", "/api/expert/works/" + id + "/send", expertLogin, Map.of("expectedRevision", 0, "document", expertDocument(doc))))).isEqualTo(200);
        assertThat(studentReview(rejected.id).get("document").path("grading").isNull()).isTrue();
        var another = submitted(student, true);
        // Обычный short-answer результат создаётся без feedback и не является AI-разбором.
        var noFeedback = UUID.randomUUID();
        var row = db.queryForMap("SELECT * FROM grading_submissions WHERE id=?", another.id);
        db.update("INSERT INTO grading_submissions(id,user_id,attempt_id,attempt_item_id,requested_attempt_id,requested_item_id,input_revision,idempotency_key,request_hash,request_id,status,task_version_id) VALUES(?,?,?,?,?,?,0,?,'hash',?,'graded',?)", noFeedback, student, row.get("attempt_id"), row.get("attempt_item_id"), row.get("requested_attempt_id"), row.get("requested_item_id"), noFeedback.toString(), UUID.randomUUID(), row.get("task_version_id"));
        db.update("INSERT INTO grading_results(submission_id,is_graded,score,max_score,is_demo) VALUES(?,true,2,2,true)", noFeedback);
        assertThat(code(http("POST", "/api/submissions/" + noFeedback + "/expert-review", studentLogin, Map.of("schoolId", school)))).isEqualTo(409);
    }
    @Test void gradingStageOnlyAppliesScoreWithDurableJobAndIdempotentReplay() {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText()); var original = getWork(id).get("aiResult");
        var doc = expertDocument(original); ((ObjectNode)doc.get("analysis").get("block_reviews").get(0)).put("status", "error");
        String key = UUID.randomUUID().toString(); var request = Map.of("expectedRevision", 0, "document", doc);
        var response = http("POST", "/api/expert/works/" + id + "/grade", expertLogin, request, key);
        assertThat(code(response)).as(response.getBody()).isEqualTo(200); var graded = body(response);
        assertThat(graded.path("revision").asInt()).isEqualTo(2); assertThat(graded.path("gradingStale").asBoolean()).isFalse();
        assertThat(graded.path("gradeJob").path("state").asText()).isEqualTo("succeeded");
        assertThat(graded.get("review").get("ocr")).isEqualTo(doc.get("ocr")); assertThat(graded.get("review").get("analysis")).isEqualTo(doc.get("analysis"));
        assertThat(graded.get("review").get("grading").path("score").asInt()).isEqualTo(1); assertThat(graded.get("aiResult")).isEqualTo(original);
        assertThat(code(http("POST", "/api/expert/works/" + id + "/grade", expertLogin, request, key))).isEqualTo(200); assertThat(stage.calls).hasValue(1);
        assertThat(getWork(id).get("gradeJob")).isEqualTo(graded.get("gradeJob"));
        assertThat(code(http("POST", "/api/expert/works/" + id + "/grade", expertLogin, Map.of("expectedRevision", 2, "document", doc), key))).isEqualTo(409);
        assertThat(code(http("POST", "/api/expert/works/" + id + "/send", expertLogin, Map.of("expectedRevision", 2, "document", graded.get("review"))))).isEqualTo(200);
    }
    @Test void staleAndRevokedResponsesCannotOverwriteDraftAndCallRunsWithoutTransaction() throws Exception {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText()); var doc = expertDocument(getWork(id).get("review"));
        stage.entered = new CountDownLatch(1); stage.release = new CountDownLatch(1);
        try (var executor = Executors.newSingleThreadExecutor()) {
            var result = executor.submit(() -> http("POST", "/api/expert/works/" + id + "/grade", expertLogin, Map.of("expectedRevision", 0, "document", doc)));
            assertThat(stage.entered.await(5, TimeUnit.SECONDS)).isTrue();
            var pending = getWork(id); assertThat(pending.path("gradeJob").path("state").asText()).isEqualTo("pending");
            assertThat(code(http("POST", "/api/expert/works/" + id + "/grade", expertLogin, Map.of("expectedRevision", 1, "document", doc)))).isEqualTo(409);
            var newer = expertDocument(doc); ((ObjectNode)newer.get("analysis")).put("summary", "Новая рецензия");
            assertThat(code(http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, Map.of("expectedRevision", 1, "document", newer)))).isEqualTo(200);
            stage.release.countDown(); assertThat(code(result.get(10, TimeUnit.SECONDS))).isEqualTo(409);
            assertThat(getWork(id).get("review")).isEqualTo(newer); assertThat(getWork(id).path("gradeJob").path("state").asText()).isEqualTo("stale");
        }
        stage.reset(); stage.entered = new CountDownLatch(1); stage.release = new CountDownLatch(1);
        try (var executor = Executors.newSingleThreadExecutor()) {
            var result = executor.submit(() -> http("POST", "/api/expert/works/" + id + "/grade", expertLogin, Map.of("expectedRevision", 2, "document", expertDocument(getWork(id).get("review")))));
            assertThat(stage.entered.await(5, TimeUnit.SECONDS)).isTrue();
            db.update("DELETE FROM expert_students WHERE school_id=? AND student_user_id=?", school, student); stage.release.countDown();
            assertThat(code(result.get(10, TimeUnit.SECONDS))).isEqualTo(404);
            assertThat(db.queryForObject("SELECT revision FROM expert_works WHERE id=?", Integer.class, id)).isEqualTo(3);
            assertThat(db.queryForObject("SELECT state FROM expert_grading_jobs WHERE work_id=? ORDER BY created_at DESC LIMIT 1", String.class, id)).isEqualTo("stale");
        }
    }
    @Test void unknownStageSurvivesReloadAndNeverRetriesWithoutExplicitManualResolution() {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText()); var doc = expertDocument(getWork(id).get("review"));
        ((ObjectNode)doc.get("analysis")).put("summary", "Правка"); stage.unknown = true;
        String key = UUID.randomUUID().toString(); var request = Map.of("expectedRevision", 0, "document", doc);
        var result = http("POST", "/api/expert/works/" + id + "/grade", expertLogin, request, key); assertThat(code(result)).isEqualTo(200);
        assertThat(body(result).path("gradeJob").path("state").asText()).isEqualTo("unknown"); assertThat(body(result).path("gradingStale").asBoolean()).isTrue();
        assertThat(code(http("POST", "/api/expert/works/" + id + "/grade", expertLogin, request, key))).isEqualTo(200); assertThat(stage.calls).hasValue(1);
        assertThat(getWork(id).path("gradeJob").path("state").asText()).isEqualTo("unknown");
        assertThat(code(http("POST", "/api/expert/works/" + id + "/grade", expertLogin, Map.of("expectedRevision", 1, "document", doc)))).isEqualTo(409);
        assertThat(code(http("POST", "/api/expert/works/" + id + "/send", expertLogin, Map.of("expectedRevision", 1, "document", doc)))).isEqualTo(409);
        assertThat(code(http("POST", "/api/expert/works/" + id + "/manual-grade", expertLogin, Map.of("expectedRevision", 1, "document", doc)))).isEqualTo(200);
        assertThat(getWork(id).path("gradingStale").asBoolean()).isFalse(); assertThat(getWork(id).path("gradeJob").path("state").asText()).isEqualTo("stale");
    }
    @Test void ordinaryScoreChangeDoesNotApproveGradeAndLargeRevisionUsesValueEquality() {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText()); var doc = expertDocument(getWork(id).get("review"));
        ((ObjectNode)doc.get("grading")).put("score", 1);
        assertThat(code(http("PUT", "/api/expert/works/" + id + "/draft", expertLogin, Map.of("expectedRevision", 0, "document", doc)))).isEqualTo(200);
        assertThat(getWork(id).path("gradingStale").asBoolean()).isTrue();
        db.update("UPDATE expert_works SET revision=128 WHERE id=?", id);
        assertThat(code(http("POST", "/api/expert/works/" + id + "/manual-grade", expertLogin, Map.of("expectedRevision", 128, "document", doc)))).isEqualTo(200);
        assertThat(getWork(id).path("revision").asInt()).isEqualTo(129); assertThat(getWork(id).path("gradingStale").asBoolean()).isFalse();
    }
    @Test void expiredPendingJobBecomesUnknownThroughOrdinaryFullWorkReload() {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText()); var doc = expertDocument(getWork(id).get("review")); UUID job = UUID.randomUUID();
        db.update("INSERT INTO expert_grading_jobs(id,work_id,school_id,expert_user_id,idempotency_key,request_hash,input_hash,base_revision,prepared_revision,document,state,deadline_at) VALUES(?,?,?,?,?,'hash','input',0,1,?::jsonb,'pending',now()-interval '1 second')", job, id, school, expert, job.toString(), json.write(doc));
        var reloaded = getWork(id); assertThat(reloaded.path("gradeJob").path("id").asText()).isEqualTo(job.toString());
        assertThat(reloaded.path("gradeJob").path("state").asText()).isEqualTo("unknown"); assertThat(stage.calls).hasValue(0);
    }
    @Test void invalidGradeStageResponseCannotChangeGradeOrAcceptedBasis() {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText()); var doc = expertDocument(getWork(id).get("review")); stage.invalid = true;
        ((ObjectNode)doc.get("analysis")).put("summary", "Новая рецензия");
        var result = http("POST", "/api/expert/works/" + id + "/grade", expertLogin, Map.of("expectedRevision", 0, "document", doc));
        assertThat(code(result)).isEqualTo(200); assertThat(body(result).path("revision").asInt()).isEqualTo(1);
        assertThat(body(result).get("review").get("grading")).isEqualTo(doc.get("grading"));
        assertThat(body(result).path("gradeJob").path("state").asText()).isEqualTo("unknown"); assertThat(body(result).path("gradingStale").asBoolean()).isTrue();
    }
    @Test void disconnectedClientRecoversLatestJobWithoutRedispatch() throws Exception {
        assign(); UUID id = UUID.fromString(route(submission).path("id").asText()); var doc = expertDocument(getWork(id).get("review"));
        stage.entered = new CountDownLatch(1); stage.release = new CountDownLatch(1);
        try (var client = java.net.http.HttpClient.newHttpClient()) {
            var request = java.net.http.HttpRequest.newBuilder(java.net.URI.create(rest.getRootUri()+"/api/expert/works/"+id+"/grade"))
                .timeout(java.time.Duration.ofMillis(300)).header("Content-Type", "application/json").header("Idempotency-Key", UUID.randomUUID().toString())
                .header("Cookie", "SESSION="+expertLogin.session+"; XSRF-TOKEN="+expertLogin.csrf).header("X-XSRF-TOKEN", expertLogin.csrf)
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.write(Map.of("expectedRevision", 0, "document", doc)))).build();
            var response = client.sendAsync(request, java.net.http.HttpResponse.BodyHandlers.ofString());
            assertThat(stage.entered.await(5, TimeUnit.SECONDS)).isTrue();
            try { assertThatThrownBy(() -> response.get(5, TimeUnit.SECONDS)).hasRootCauseInstanceOf(java.net.http.HttpTimeoutException.class); }
            finally { stage.release.countDown(); }
            JsonNode recovered = getWork(id);
            for (int i=0; i<100 && recovered.path("gradeJob").path("state").asText().equals("pending"); i++) { Thread.sleep(20); recovered = getWork(id); }
            assertThat(recovered.path("gradeJob").path("state").asText()).isEqualTo("succeeded");
            assertThat(recovered.path("revision").asInt()).isEqualTo(2); assertThat(stage.calls).hasValue(1);
        } finally { stage.release.countDown(); }
    }
    @Test void pdfOriginalDownloadsExactBytesOnlyWithinAssignedWorkAndUsesAttachmentHeaders() {
        UUID document=UUID.randomUUID();byte[] bytes="%PDF-1.7 original fixture\n%%EOF".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        db.update("INSERT INTO solution_documents(id,user_id,submission_id,bucket,object_key,file_name,size_bytes,sha256,reserved_pages,state,base_revision,page_count,uploaded_at,renderer_version) VALUES(?,?,?,'test',?,'solution.pdf',?,?,1,'ready',0,1,now(),'pdf-raster.v1')",document,student,submission,"pdf-fixture/"+document,bytes.length,org.botai.back.media.PdfLimits.hash(bytes));
        db.update("INSERT INTO stored_objects(id,user_id,submission_id,purpose,bucket,object_key,state,file_name,mime_type,size_bytes,ordinal,source_document_id,page_number) VALUES(?,?,?,'solution','test',?,'ready','page.jpg','image/jpeg',5,1,?,1)",UUID.randomUUID(),student,submission,UUID.randomUUID().toString(),document);
        assign(); UUID work=UUID.fromString(route(submission).path("id").asText());
        assertThat(getWork(work).path("documents").get(0).path("downloadUrl").asText()).isEqualTo("/api/expert/works/"+work+"/documents/"+document);
        var downloaded=http("GET","/api/expert/works/"+work+"/documents/"+document,expertLogin,null);
        assertThat(code(downloaded)).isEqualTo(200);assertThat(downloaded.getBody()).isEqualTo(new String(bytes,java.nio.charset.StandardCharsets.UTF_8));
        assertThat(downloaded.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_PDF);
        assertThat(downloaded.getHeaders().getFirst("Content-Disposition")).startsWith("attachment;");assertThat(downloaded.getHeaders().getFirst("Cache-Control")).contains("no-store");
        assertThat(downloaded.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");assertThat(downloaded.getHeaders().getFirst("Content-Security-Policy")).contains("sandbox","frame-ancestors 'none'");
        for(UUID actor:List.of(colleague,foreignExpert,outsider,account(Role.ADMIN)))assertThat(code(http("GET","/api/expert/works/"+work+"/documents/"+document,login(actor),null))).isIn(403,404);
        assertThat(code(http("GET","/api/submissions/"+submission+"/documents/"+document+"/download",studentLogin,null))).isEqualTo(200);
        assertThat(code(http("GET","/api/submissions/"+submission+"/documents/"+document+"/download",login(outsider),null))).isEqualTo(404);
        assertThat(code(http("GET","/api/expert/works/"+work+"/documents/"+UUID.randomUUID(),expertLogin,null))).isEqualTo(404);
        db.update("UPDATE school_experts SET enabled=false WHERE user_id=?",expert);
        assertThat(code(http("GET","/api/expert/works/"+work+"/documents/"+document,expertLogin,null))).isEqualTo(403);
    }
    UUID school() { UUID id = UUID.randomUUID(); db.update("INSERT INTO schools(id,name) VALUES(?,'Школа')", id); return id; }
    UUID account(Role role) { return users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}test-password").role(role).build()).getId(); }
    void member(UUID school, UUID expert) { db.update("INSERT INTO school_experts(school_id,user_id) VALUES(?,?)", school, expert); }
    void roster(UUID school, UUID student) { db.update("INSERT INTO school_students(school_id,user_id,first_name,last_name,contact) VALUES(?,?,'Имя','Фамилия','@student')", school, student); }
    void assign() { assertThat(code(http("POST", "/api/expert/students", expertLogin, Map.of("studentId", student)))).isEqualTo(200); }
    Submitted submitted(UUID user, boolean graded) {
        var attempt = attempts.startTraining(user, UUID.randomUUID().toString(), new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT, List.of(new AttemptDtos.Selection(16, null, 1)), null, "catalog", null));
        var item = attempt.items().getFirst(); UUID id = UUID.randomUUID(), image = UUID.randomUUID();
        UUID version = db.queryForObject("SELECT task_version_id FROM attempt_items WHERE id=?", UUID.class, item.id());
        db.update("INSERT INTO grading_submissions(id,user_id,attempt_id,attempt_item_id,requested_attempt_id,requested_item_id,input_revision,idempotency_key,request_hash,request_id,status,task_version_id) VALUES(?,?,?,?,?,?,0,?,'hash',?,?,?)", id, user, attempt.id(), item.id(), attempt.id(), item.id(), id.toString(), UUID.randomUUID(), graded ? "graded" : "rejected", version);
        String feedback = """
            {"ocr":"Исходный OCR\\n x=1","analysis":{"summary":"Разбор","checks":{"completeness":{"isComplete":true,"reason":"Полно"}},"studentAnswer":{"text":"1","isCorrect":true},"errors":[],"strengths":[]},"grading":{"score":2,"criterion":"Верно","explanation":"Полный балл"}}
            """;
        db.update("INSERT INTO grading_results(submission_id,is_graded,score,max_score,feedback,rejection_reason,is_demo,exact_response,provider_mode,package_id) VALUES(?,?,?,2,?::jsonb,?,true,'original-ai','mock','fixture')", id, graded, graded ? 2 : null, graded ? feedback : null, graded ? null : "Нечитаемое фото");
        db.update("INSERT INTO stored_objects(id,user_id,submission_id,purpose,bucket,object_key,state,file_name,mime_type,size_bytes,ordinal) VALUES(?,?,?,'solution','test',?,'ready','solution.png','image/png',5,0)", image, user, id, image.toString());
        return new Submitted(id, image, attempt.id());
    }
    ObjectNode expertDocument(JsonNode document) { ObjectNode copy = (ObjectNode)json.read(json.write(document)); copy.put("origin", "expert"); return copy; }
    JsonNode route(UUID id) { var result = http("POST", "/api/submissions/" + id + "/expert-review", studentLogin, Map.of("schoolId", school)); assertThat(code(result)).as(result.getBody()).isEqualTo(200); return body(result); }
    JsonNode studentReview(UUID id) { return body(http("GET", "/api/submissions/" + id + "/expert-review?schoolId=" + school, studentLogin, null)); }
    JsonNode getWork(UUID id) { var result = http("GET", "/api/expert/works/" + id, expertLogin, null); assertThat(code(result)).as(result.getBody()).isEqualTo(200); return body(result); }
    JsonNode items(ResponseEntity<String> response) { assertThat(code(response)).as(response.getBody()).isEqualTo(200); return body(response).get("items"); }
    JsonNode body(ResponseEntity<String> response) { return json.read(response.getBody()); }
    int code(ResponseEntity<?> response) { return response.getStatusCode().value(); }
    Login login(UUID id) {
        var bootstrap = http("GET", "/api/auth/csrf", new Login(null, null), null);
        var result = http("POST", "/api/auth/login", new Login(null, cookie(bootstrap, "XSRF-TOKEN")), Map.of("email", users.findById(id).orElseThrow().getEmail(), "password", "test-password"));
        assertThat(code(result)).isEqualTo(200); String session = cookie(result, "SESSION");
        var csrf = http("GET", "/api/auth/csrf", new Login(session, null), null); return new Login(session, cookie(csrf, "XSRF-TOKEN"));
    }
    String cookie(ResponseEntity<?> response, String name) { return response.getHeaders().getOrEmpty(HttpHeaders.SET_COOKIE).stream().filter(value -> value.startsWith(name+"=")).map(value -> value.substring(name.length()+1, value.indexOf(';'))).findFirst().orElseThrow(); }
    ResponseEntity<String> http(String method, String path, Login login, Object data) { return http(method, path, login, data, UUID.randomUUID().toString()); }
    ResponseEntity<String> http(String method, String path, Login login, Object data, String key) {
        HttpHeaders headers = new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON); headers.set("Idempotency-Key", key);
        headers.set(HttpHeaders.COOKIE, (login.session == null ? "" : "SESSION="+login.session+"; ")+(login.csrf == null ? "" : "XSRF-TOKEN="+login.csrf));
        if (login.csrf != null) headers.set("X-XSRF-TOKEN", login.csrf);
        return rest.exchange(path, HttpMethod.valueOf(method), new HttpEntity<>(data instanceof String ? data : data == null ? null : json.write(data), headers), String.class);
    }
}
