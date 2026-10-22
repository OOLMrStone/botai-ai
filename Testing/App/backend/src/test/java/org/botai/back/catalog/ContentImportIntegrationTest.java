package org.botai.back.catalog;

import org.botai.back.catalog.importing.*;
import org.botai.back.attempt.*;
import org.botai.back.common.*;
import org.botai.back.grading.*;
import org.botai.back.grading.port.GradingGateway;
import org.botai.back.media.*;
import org.botai.back.media.port.ObjectStorage;
import org.botai.back.user.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.support.*;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.io.*;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import static org.assertj.core.api.Assertions.*;

@org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"spring.docker.compose.enabled=false","management.server.port=0","app.grading.worker-enabled=false"})
@Testcontainers
class ContentImportIntegrationTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    @TestConfiguration static class Ports {
        @Bean @Primary MemoryStorage storage() { return new MemoryStorage(); }
        @Bean @Primary GradingGateway gateway() { return new GradingGateway() {
            public Map<Integer,Capability> capabilities() { return Map.of(16,new Capability(16,2,true,"fixture","mock"),14,new Capability(14,2,false,"fixture","mock")); }
            public Response grade(UUID run,TaskSnapshot task,List<Image> images,String pinned) { throw new AssertionError("No model calls in import tests"); }
        }; }
    }
    static class MemoryStorage implements ObjectStorage {
        final Map<String,byte[]> data=new ConcurrentHashMap<>();volatile boolean fail;volatile CountDownLatch entered,release;
        public void put(String key,byte[] bytes,String type) { if(entered!=null) { entered.countDown();try { if(!release.await(5,TimeUnit.SECONDS))throw new IllegalStateException(); }catch(InterruptedException failure) { throw new IllegalStateException(); } }if(fail)throw new IllegalStateException();data.put(key,bytes); }
        public byte[] get(String key,long max) { return data.get(key); }
        public void delete(String key) { data.remove(key); }
        public String bucket() { return "private-test"; }
    }
    @Autowired ContentPublisher publisher;
    @Autowired ImportPackageValidator validator;
    @Autowired CatalogService catalog;
    @Autowired CatalogMediaService media;
    @Autowired AttemptService attempts;
    @Autowired SubmissionService submissions;
    @Autowired MediaService studentMedia;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate db;
    @Autowired JsonCodec json;
    @Autowired MemoryStorage storage;
    @Autowired TransactionTemplate transactions;
    @Autowired org.springframework.boot.resttestclient.TestRestTemplate rest;
    @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;
    @TempDir Path files;
    UUID user;
    @BeforeEach void setup() { user=users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}fixture-only").build()).getId();db.update("UPDATE users SET plan_id='pro' WHERE id=?",user);storage.fail=false;storage.entered=null;storage.release=null; }
    Map<String,Object> task(int number) {
        String id=Long.toUnsignedString(UUID.randomUUID().getMostSignificantBits());
        String topic=db.queryForObject("SELECT id FROM topics WHERE exam_number=? AND active ORDER BY sort_order LIMIT 1",String.class,number);
        Map<String,Object> provenance=new LinkedHashMap<>();provenance.put("sourceUrl","https://3.shkolkovo.online/catalog/203/"+id);provenance.put("sourceGroups",List.of("past-ege","fipi"));provenance.put("originalPublisher",null);provenance.put("originalReferences",List.of());provenance.put("permissionRef",ImportPackageValidator.GRANT);provenance.put("mappingRevision","reviewed-fixture");provenance.put("retrievedAt","2026-10-05T00:00:00Z");provenance.put("extractorVersion","test");
        Map<String,Object> root=new LinkedHashMap<>();root.put("schemaVersion","botai-content.v1");root.put("provider","shkolkovo");root.put("externalId",id);root.put("formatId",CatalogRepository.FORMAT);root.put("examNumber",number);root.put("topicIds",List.of(topic));root.put("difficulty","easy");root.put("sourceYear",null);root.put("content",List.of(Map.of("type","text","value","Compute 1+1")));root.put("statement","Compute 1+1");root.put("referenceAnswer","2");root.put("referenceSolution","1+1=2");root.put("referenceContent",List.of(Map.of("type","text","value","1+1=2")));root.put("acceptedAnswers",List.of("2"));root.put("provenance",provenance);root.put("assets",List.of());return root;
    }
    ContentPublisher.Outcome publish(Map<String,Object> root) { return publisher.publish(validator.validate(validator.parse(manifest(root)),files)); }
    String manifest(Object value) { return tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(value); }
    UUID taskId(UUID version) { return db.queryForObject("SELECT task_id FROM task_versions WHERE id=?",UUID.class,version); }
    AttemptDtos.Attempt attempt(UUID task,int number) { return attempts.startTraining(user,UUID.randomUUID().toString(),new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(number,null,1)),null,"catalog",List.of(task))); }
    @Test void numericDifficultyCreatesImmutableVersionsAndDerivedGrob() {
        var root=task(7);var legacy=publish(root);var oldAttempt=attempt(taskId(legacy.version()),7);
        root.put("difficulty",5);var rated=publish(root);var task=catalog.task(user,taskId(rated.version()));
        assertThat(task.difficulty()).isEqualTo(5);assertThat(task.isGrob()).isTrue();
        assertThat(db.queryForObject("SELECT is_grob FROM task_versions WHERE id=?",Boolean.class,rated.version())).isTrue();
        assertThat(db.queryForObject("SELECT difficulty FROM task_versions WHERE id=?",String.class,legacy.version())).isEqualTo("easy");
        assertThat(attempts.get(user,oldAttempt.id()).items().getFirst().task().difficulty()).isNull();
        assertThat(publish(root).state()).isEqualTo("noop");
        var response=http("GET","/api/tasks/"+task.id(),login(user),null);
        assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(response.getBody()).contains("\"difficulty\":5","\"isGrob\":true");
        root.put("difficulty",null);var unknown=publish(root);var unknownTask=catalog.task(user,taskId(unknown.version()));
        assertThat(unknownTask.difficulty()).isNull();assertThat(unknownTask.isGrob()).isFalse();assertThat(json.write(unknownTask)).contains("\"difficulty\":null");
        assertThat(catalog.version(user,rated.version()).difficulty()).isEqualTo(5);
        for(Object invalid:List.of(0,6,2.5,true)) {
            root.put("difficulty",invalid);
            assertThatThrownBy(()->validator.validate(validator.parse(manifest(root)),files)).isInstanceOf(ImportFailure.class);
        }
    }
    @Test void trainingEndpointsUnknownFallbackAndCatalogNumericFilterAgree() {
        String topic="difficulty-"+UUID.randomUUID();
        db.update("INSERT INTO topics(id,format_id,exam_number,title,source_url,sort_order) VALUES(?, ?,7,'Difficulty test','https://example.test',999)",topic,CatalogRepository.FORMAT);
        var taskIds=new ArrayList<UUID>();
        for(int level=0;level<=5;level++) {
            var root=task(7);root.put("topicIds",List.of(topic));root.put("difficulty",level==0?null:level);
            taskIds.add(taskId(publish(root).version()));
        }
        java.util.function.BiFunction<Integer,Integer,AttemptDtos.TrainingRequest> request=(preference,count)->new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(7,List.of(topic),count)),null,"catalog",null,preference);
        var easy=attempts.startTraining(user,"numeric-easy",request.apply(0,1));assertThat(easy.items()).allMatch(i->Objects.equals(i.task().difficulty(),1));
        var hard=attempts.startTraining(user,"numeric-hard",request.apply(100,2));assertThat(hard.items()).allMatch(i->i.task().difficulty()>=4);
        assertThatThrownBy(()->attempts.startTraining(user,"numeric-short",request.apply(0,2))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("insufficient_tasks");
        var middle=attempts.startTraining(user,"numeric-middle",request.apply(50,6));assertThat(middle.items().getLast().task().difficulty()).isNull();
        assertThat(middle.items().subList(0,5)).allMatch(i->i.task().difficulty()!=null);
        assertThat(attempts.startTraining(user,"numeric-middle",request.apply(50,6)).id()).isEqualTo(middle.id());
        assertThat(catalog.list(user,7,topic,5,false,null,20).items()).singleElement().satisfies(t->assertThat(t.isGrob()).isTrue());
        catalog.favourite(user,taskIds.get(5),true);
        var favorite=new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(7,List.of(topic),1)),null,"favorites",null,100);
        assertThat(attempts.startTraining(user,"numeric-favourite",favorite).items().getFirst().task().id()).isEqualTo(taskIds.get(5));
    }
    @Test void replaysNullableYearAndChangedVersionsPreservePinnedAttempts() {
        var root=task(7);var first=publish(root);var attempt=attempt(taskId(first.version()),7);
        assertThat(publish(root).state()).isEqualTo("noop");
        var projected=catalog.task(user,taskId(first.version()));assertThat(projected.sourceYear()).isNull();assertThat(json.write(projected)).contains("\"sourceYear\":null","\"sources\"").doesNotContain("permissionRef","referenceAnswer","referenceContent","shkolkovo","sourceUrl","provider");
        root.put("content",List.of(Map.of("type","text","value","Compute 2+2")));root.put("statement","Compute 2+2");root.put("referenceAnswer","4");root.put("acceptedAnswers",List.of("4"));root.put("referenceSolution","2+2=4");root.put("referenceContent",List.of(Map.of("type","text","value","2+2=4")));
        var changed=publish(root);assertThat(changed.version()).isNotEqualTo(first.version());assertThat(catalog.task(user,taskId(first.version())).version()).isEqualTo(2);
        var pinned=attempts.get(user,attempt.id()).items().getFirst().task();assertThat(pinned.taskVersionId()).isEqualTo(first.version());assertThat(pinned.content().get(0).path("value").asText()).isEqualTo("Compute 1+1");
        assertThatThrownBy(()->db.update("UPDATE task_version_provenance SET snapshot='{}'::jsonb WHERE task_version_id=?",first.version())).hasMessageContaining("immutable content");
        assertThat(db.queryForObject("SELECT count(*) FROM task_versions WHERE is_demo",Integer.class)).isEqualTo(100);
    }
    @Test void bankzadachPolicyPublishesIdempotentlyAndRejectsCrossProviderProvenance() {
        var root=task(7);String id=UUID.randomUUID().toString();root.put("provider","bankzadach");root.put("externalId",id);
        var provenance=(Map<String,Object>)root.get("provenance");provenance.put("sourceUrl","https://bank-zadach.ru/task/"+id+"/");
        provenance.put("sourceGroups",List.of("bankzadach"));provenance.put("permissionRef",ImportPackageValidator.BANKZADACH_GRANT);
        var first=publish(root);assertThat(publish(root).state()).isEqualTo("noop");
        assertThat(catalog.task(user,taskId(first.version())).sources().isEmpty()).isTrue();
        assertThat(db.queryForObject("SELECT count(*) FROM task_source_links WHERE provider='bankzadach' AND external_id=?",Integer.class,id)).isEqualTo(1);
        provenance.put("permissionRef",ImportPackageValidator.GRANT);
        assertThatThrownBy(()->validator.validate(validator.parse(manifest(root)),files)).hasMessage("permission_scope");
        provenance.put("permissionRef",ImportPackageValidator.BANKZADACH_GRANT);provenance.put("sourceGroups",List.of("fipi"));
        assertThatThrownBy(()->validator.validate(validator.parse(manifest(root)),files)).hasMessage("source_scope");
        provenance.put("sourceGroups",List.of("bankzadach"));
        for(String url:List.of("https://bank-zadach.ru/task/"+UUID.randomUUID()+"/","https://evil.test/task/"+id+"/","https://bank-zadach.ru/task/"+id+"/?x=1","https://bank-zadach.ru/task/"+id+"/#x","https://bank-zadach.ru/task/"+id+"/%2e%2e/")) {
            provenance.put("sourceUrl",url);assertThatThrownBy(()->validator.validate(validator.parse(manifest(root)),files)).hasMessage("source_url");
        }
    }
    @Test void archivedTemplateMemberStopsNewExamsButPreservesPinnedAttempts() {
        UUID template=db.queryForObject("SELECT id FROM exam_templates WHERE published AND is_demo LIMIT 1",UUID.class);
        UUID task=db.queryForObject("SELECT v.task_id FROM exam_template_items i JOIN task_versions v ON v.id=i.task_version_id WHERE i.template_id=? ORDER BY i.ordinal LIMIT 1",UUID.class,template);
        var existing=attempts.startExam(user,template,UUID.randomUUID().toString());
        try {
            db.update("UPDATE tasks SET archived=true WHERE id=?",task);
            assertThat(attempts.exams(user,null,50).items()).noneMatch(exam->exam.id().equals(template));
            assertThatThrownBy(()->attempts.startExam(user,template,UUID.randomUUID().toString())).isInstanceOf(ApiException.class);
            assertThatThrownBy(()->catalog.task(user,task)).isInstanceOf(ApiException.class);
            assertThat(attempts.get(user,existing.id()).items()).hasSize(20);
            assertThat(attempts.get(user,existing.id()).items().getFirst().task().id()).isEqualTo(task);
        } finally { db.update("UPDATE tasks SET archived=false WHERE id=?",task); }
        assertThat(attempts.exams(user,null,50).items()).anyMatch(exam->exam.id().equals(template));
    }
    @Test void concurrentSameIdentityPublishesExactlyOnce()throws Exception {
        var prepared=validator.validate(validator.parse(manifest(task(7))),files);
        try(var executor=Executors.newFixedThreadPool(2)) {
            var results=executor.invokeAll(List.<Callable<ContentPublisher.Outcome>>of(()->publisher.publish(prepared),()->publisher.publish(prepared)));
            var first=results.get(0).get();var second=results.get(1).get();assertThat(first.version()).isEqualTo(second.version());assertThat(List.of(first.state(),second.state())).containsExactlyInAnyOrder("published","noop");
        }
    }
    @Test void sourceTimestampNoopMappingChangeCreatesVersion() {
        var root=task(7);var first=publish(root);
        ((Map<String,Object>)root.get("provenance")).put("retrievedAt","2026-10-06T00:00:00Z");assertThat(publish(root).version()).isEqualTo(first.version());
        ((Map<String,Object>)root.get("provenance")).put("mappingRevision","reviewed-fixture-2");assertThat(publish(root).version()).isNotEqualTo(first.version());
    }
    @Test void privateReferenceMediaOnlyAfterOwnedCurrentRevisionGrade()throws Exception {
        var root=withImages(task(7));var published=publish(root);var attempt=attempt(taskId(published.version()),7);var item=attempt.items().getFirst();
        UUID statement=db.queryForObject("SELECT a.id FROM catalog_assets a JOIN task_version_assets va ON va.asset_id=a.id WHERE va.task_version_id=? AND purpose='statement'",UUID.class,published.version());
        UUID reference=db.queryForObject("SELECT a.id FROM catalog_assets a JOIN task_version_assets va ON va.asset_id=a.id WHERE va.task_version_id=? AND purpose='reference'",UUID.class,published.version());
        assertThat(media.statement(user,statement).mimeType()).isEqualTo("image/png");assertThatThrownBy(()->media.statement(user,reference)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->attempts.solution(user,attempt.id(),item.id())).isInstanceOf(ApiException.class);
        var saved=attempts.patch(user,attempt.id(),new AttemptDtos.Patch(0,null,List.of(new AttemptDtos.ItemPatch(item.id(),"2",null))));
        submissions.checks(user,attempt.id(),"check:"+UUID.randomUUID(),new SubmissionService.Check(saved.revision(),null));
        var solution=attempts.solution(user,attempt.id(),item.id());assertThat(solution.referenceContent().get(1).path("src").asText()).isEqualTo("/api/attempts/"+attempt.id()+"/items/"+item.id()+"/solution-media/"+reference);
        assertThat(media.reference(attempts.solutionVersion(user,attempt.id(),item.id()),reference).mimeType()).isEqualTo("image/png");
        var foreign=publish(withImages(task(7)));assertThatThrownBy(()->media.reference(foreign.version(),reference)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->attempts.solutionVersion(UUID.randomUUID(),attempt.id(),item.id())).isInstanceOf(ApiException.class);
        var current=attempts.get(user,attempt.id());assertThatThrownBy(()->attempts.patch(user,attempt.id(),new AttemptDtos.Patch(current.revision(),null,List.of(new AttemptDtos.ItemPatch(item.id(),"3",null))))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("input_frozen");
        db.update("UPDATE attempt_items SET answer_revision=answer_revision+1 WHERE id=?",item.id());
        assertThatThrownBy(()->attempts.solutionVersion(user,attempt.id(),item.id())).isInstanceOf(ApiException.class);
    }
    @Test void visuallyCompleteImageTaskDoesNotDispatchIncompleteAiInput()throws Exception {
        var root=withImages(task(16));var published=publish(root);assertThat(catalog.task(user,taskId(published.version())).gradingCapability()).isEqualTo("unsupported");
        var attempt=attempt(taskId(published.version()),16);var item=attempt.items().getFirst();
        var intent=submissions.create(user,UUID.randomUUID().toString(),new SubmissionService.Intent(attempt.id(),item.id(),0,null));UUID id=UUID.fromString(intent.path("id").asText());
        var upload=studentMedia.upload(user,id,new MockMultipartFile("file","fixture.png","image/png",png()));
        int revision=db.queryForObject("SELECT revision FROM grading_submissions WHERE id=?",Integer.class,id);
        assertThat(submissions.finalizeSubmission(user,id,revision).path("status").asText()).isEqualTo("unsupported");
        assertThat(db.queryForObject("SELECT count(*) FROM grading_jobs WHERE submission_id=?",Integer.class,id)).isZero();
    }
    @Test void malformedOutOfScopeCrossNumberAndDuplicateBatchStayUnpublished()throws Exception {
        var wrong=task(7);wrong.put("topicIds",List.of("sdamgia-166"));Path file=files.resolve("tasks.jsonl");Files.writeString(file,manifest(wrong)+"\n");var report=publisher.importFile(file,files,true);assertThat(report.quarantined()).isEqualTo(1);assertThat(report.quarantineReasons()).containsExactlyEntriesOf(Map.of("topic_mapping",1));
        var root=task(7);Files.writeString(file,manifest(root)+"\n"+manifest(root)+"\n");report=publisher.importFile(file,files,true);assertThat(report.quarantined()).isEqualTo(2);assertThat(report.published()).isZero();assertThat(report.quarantineReasons()).containsExactlyEntriesOf(Map.of("duplicate_identity",2));
        assertThatThrownBy(()->validator.parse("{\"provider\":\"a\",\"provider\":\"b\"}")).isInstanceOf(ImportFailure.class);
        root.put("extra",true);assertThatThrownBy(()->validator.validate(validator.parse(manifest(root)),files)).hasMessage("unknown_field");root.remove("extra");
        ((Map<String,Object>)root.get("provenance")).put("sourceGroups",List.of("author"));assertThatThrownBy(()->validator.validate(validator.parse(manifest(root)),files)).hasMessage("source_scope");
    }
    @Test void failedStoragePublicationRollsBackTaskAndRetainsNoReadyReferences()throws Exception {
        var root=withImages(task(7));storage.fail=true;assertThatThrownBy(()->publish(root)).hasMessage("publication_failed");storage.fail=false;
        assertThat(db.queryForObject("SELECT count(*) FROM task_source_links WHERE external_id=?",Integer.class,root.get("externalId"))).isZero();
        var outcome=publish(root);assertThat(outcome.state()).isEqualTo("published");assertThat(publish(root).state()).isEqualTo("noop");
    }
    @Test void uncertainCommitNeverDeletesCommittedReadyAssets()throws Exception {
        var root=withImages(task(7));var prepared=validator.validate(validator.parse(manifest(root)),files);
        var uncertain=new TransactionTemplate(transactions.getTransactionManager()) {
            @Override public <T> T execute(TransactionCallback<T> callback) { super.execute(callback);throw new IllegalStateException("Simulated acknowledgement loss after commit"); }
        };
        var publisherWithLostAcknowledgement=new ContentPublisher(db,uncertain,json,validator,storage);
        var result=publisherWithLostAcknowledgement.publish(prepared);assertThat(result.state()).isEqualTo("noop");
        for(var row:db.queryForList("SELECT a.id,a.object_key,a.purpose FROM catalog_assets a JOIN task_version_assets va ON va.asset_id=a.id WHERE va.task_version_id=?",result.version())) {
            assertThat(storage.data).containsKey((String)row.get("object_key"));if(row.get("purpose").equals("statement"))assertThat(media.statement(user,(UUID)row.get("id"))).isNotNull();
        }
        assertThat(publish(root).version()).isEqualTo(result.version());
    }
    @Test void reaperClaimsOnlyStaleUnpublishedObjectsAndPreservesReadyState()throws Exception {
        var root=withImages(task(7));var version=publish(root).version();var publishedKeys=db.queryForList("SELECT a.object_key FROM catalog_assets a JOIN task_version_assets va ON va.asset_id=a.id WHERE va.task_version_id=?",version);
        UUID stale=UUID.randomUUID();String key="catalog/stale-owned-fixture";storage.put(key,png(),"image/png");
        db.update("INSERT INTO catalog_assets(id,bucket,object_key,state,purpose,mime_type,size_bytes,width,height,original_sha256,normalized_sha256,created_at) VALUES(?,? ,?,'staged','statement','image/png',1,1,1,?, ?,now()-interval '2 days')",stale,storage.bucket(),key,"a".repeat(64),"b".repeat(64));
        publisher.reapStaged();assertThat(storage.data).doesNotContainKey(key);assertThat(db.queryForObject("SELECT state FROM catalog_assets WHERE id=?",String.class,stale)).isEqualTo("deleted");
        for(var row:publishedKeys)assertThat(storage.data).containsKey((String)row.get("object_key"));
        assertThatThrownBy(()->db.update("UPDATE catalog_assets SET state='failed' WHERE id IN(SELECT asset_id FROM task_version_assets WHERE task_version_id=?)",version)).hasMessageContaining("immutable catalogue asset");
    }
    @Test void actualHttpMediaRequiresSessionAndOwnedCheckedItemAndAdminRole()throws Exception {
        var published=publish(withImages(task(7)));var attempt=attempt(taskId(published.version()),7);var item=attempt.items().getFirst();
        UUID statement=db.queryForObject("SELECT a.id FROM catalog_assets a JOIN task_version_assets va ON va.asset_id=a.id WHERE va.task_version_id=? AND purpose='statement'",UUID.class,published.version());
        UUID reference=db.queryForObject("SELECT a.id FROM catalog_assets a JOIN task_version_assets va ON va.asset_id=a.id WHERE va.task_version_id=? AND purpose='reference'",UUID.class,published.version());
        String referencePath="/api/attempts/"+attempt.id()+"/items/"+item.id()+"/solution-media/"+reference;
        assertThat(rest.getForEntity("/api/catalog-media/"+statement,String.class).getStatusCode().value()).isEqualTo(401);
        Login actor=login(user);assertThat(http("GET","/api/catalog-media/"+statement,actor,null).getStatusCode().value()).isEqualTo(200);
        assertThat(http("GET","/api/catalog-media/"+reference,actor,null).getStatusCode().value()).isEqualTo(404);
        assertThat(http("GET",referencePath,actor,null).getStatusCode().value()).isEqualTo(404);
        assertThat(http("GET","/api/admin/catalog-media/"+reference,actor,null).getStatusCode().value()).isEqualTo(403);
        var saved=attempts.patch(user,attempt.id(),new AttemptDtos.Patch(0,null,List.of(new AttemptDtos.ItemPatch(item.id(),"2",null))));submissions.checks(user,attempt.id(),UUID.randomUUID().toString(),new SubmissionService.Check(saved.revision(),null));
        var accepted=http("GET",referencePath,actor,null);assertThat(accepted.getStatusCode().value()).isEqualTo(200);assertThat(accepted.getHeaders().getFirst("Cache-Control")).isEqualTo("private, no-store");assertThat(accepted.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
        UUID other=users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}fixture-only").build()).getId();assertThat(http("GET",referencePath,login(other),null).getStatusCode().value()).isEqualTo(404);
    }
    @Test void databaseOperatorSeesOnlySafeImportProjections()throws Exception {
        publish(withImages(task(7)));db.execute("CREATE ROLE botai_operator NOLOGIN");db.execute(Files.readString(Path.of("scripts/integration/operator-views.sql")));
        try(var connection=db.getDataSource().getConnection();var statement=connection.createStatement()) {
            statement.execute("SET ROLE botai_operator");try(var rows=statement.executeQuery("SELECT sources,ai_input_ready FROM operator_task_versions LIMIT 1")) { assertThat(rows.next()).isTrue(); }
            for(String table:List.of("task_version_provenance","catalog_assets","content_import_items","task_versions","task_version_answers","users"))assertThatThrownBy(()->statement.executeQuery("SELECT * FROM "+table)).isInstanceOf(java.sql.SQLException.class).hasMessageContaining("permission denied");
            try(var rows=statement.executeQuery("SELECT * FROM operator_catalog_assets LIMIT 1")) { var metadata=rows.getMetaData();for(int index=1;index<=metadata.getColumnCount();index++)assertThat(metadata.getColumnName(index)).isNotIn("object_key","bucket","reference_content"); }
            statement.execute("RESET ROLE");
        }
    }
    @Test void richExtendedAnswerRemainsPrivateAndShortAnswerCannotBeReplacedByPicture()throws Exception {
        var root=withImages(task(16));root.put("referenceAnswer",null);root.put("referenceAnswerContent",List.of(Map.of("type","paragraph","runs",List.of(Map.of("type","formula","assetId","solution","alt","Ответ")))));
        var version=publish(root).version();var attempt=attempt(taskId(version),16);var item=attempt.items().getFirst();
        assertThat(catalog.snapshot(version).referenceAnswer()).isNull();assertThat(catalog.task(user,taskId(version)).gradingCapability()).isEqualTo("unsupported");assertThat(json.write(catalog.task(user,taskId(version)))).doesNotContain("referenceAnswerContent","Ответ");
        var solution=attempts.reveal(user,attempt.id(),item.id(),new AttemptDtos.SolutionReveal(0,null,null));assertThat(solution.referenceAnswer()).isNull();assertThat(solution.referenceAnswerContent().get(0).path("runs").get(0).path("src").asText()).startsWith("/api/attempts/"+attempt.id());assertThat(json.write(solution)).contains("\"referenceAnswer\":null");
        var shortRoot=task(7);shortRoot.put("referenceAnswer",null);shortRoot.put("referenceAnswerContent",List.of(Map.of("type","text","value","2")));assertThatThrownBy(()->validator.validate(validator.parse(manifest(shortRoot)),files)).hasMessage("missing_answer");
    }
    @Test void explicitUnsupportedRevealIsCsrfOwnerCheckedIdempotentAndDoesNotGrade()throws Exception {
        var version=publish(withImages(task(16))).version();var attempt=attempt(taskId(version),16);var item=attempt.items().getFirst();Login actor=login(user);
        var request=new LinkedHashMap<String,Object>();request.put("expectedAnswerRevision",0);request.put("expectedSubmissionId",null);request.put("expectedSubmissionRevision",null);
        String path="/api/attempts/"+attempt.id()+"/items/"+item.id()+"/solution-reveal";
        assertThat(http("POST",path,new Login(actor.session(),null),request).getStatusCode().value()).isEqualTo(403);
        UUID other=users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}fixture-only").build()).getId();assertThat(http("POST",path,login(other),request).getStatusCode().value()).isEqualTo(404);
        assertThat(http("POST",path,actor,request).getStatusCode().value()).isEqualTo(200);assertThat(http("POST",path,actor,request).getStatusCode().value()).isEqualTo(200);
        assertThat(db.queryForObject("SELECT count(*) FROM solution_reveal_grants WHERE item_id=?",Integer.class,item.id())).isEqualTo(1);
        assertThat(db.queryForObject("SELECT count(*) FROM grading_submissions WHERE user_id=?",Integer.class,user)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM user_task_results WHERE user_id=?",Integer.class,user)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM activity_events WHERE user_id=?",Integer.class,user)).isZero();assertThat(attempts.get(user,attempt.id()).summary().graded()).isZero();
        assertThatThrownBy(()->attempts.reveal(user,attempt.id(),UUID.randomUUID(),new AttemptDtos.SolutionReveal(0,null,null))).isInstanceOf(ApiException.class);
    }
    @Test void textStrokeNewSubmissionAndPhotoEditsInvalidateRevealGrant()throws Exception {
        var version=publish(withImages(task(16))).version();var attempt=attempt(taskId(version),16);var item=attempt.items().getFirst();
        attempts.reveal(user,attempt.id(),item.id(),new AttemptDtos.SolutionReveal(0,null,null));
        attempt=attempts.patch(user,attempt.id(),new AttemptDtos.Patch(attempt.revision(),null,List.of(new AttemptDtos.ItemPatch(item.id(),"work",null))));
        UUID aid=attempt.id(),iid=item.id();assertThatThrownBy(()->attempts.solutionVersion(user,aid,iid)).isInstanceOf(ApiException.class);assertThatThrownBy(()->attempts.reveal(user,aid,iid,new AttemptDtos.SolutionReveal(0,null,null))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("revision_conflict");
        attempts.reveal(user,aid,iid,new AttemptDtos.SolutionReveal(1,null,null));
        var drawing=json.read("[{\"id\":\"stroke\",\"points\":[{\"x\":0.1,\"y\":0.2}]}]");attempts.patch(user,aid,new AttemptDtos.Patch(attempt.revision(),null,List.of(new AttemptDtos.ItemPatch(iid,null,drawing))));assertThatThrownBy(()->attempts.solutionVersion(user,aid,iid)).isInstanceOf(ApiException.class);
        attempts.reveal(user,aid,iid,new AttemptDtos.SolutionReveal(2,null,null));var intent=submissions.create(user,UUID.randomUUID().toString(),new SubmissionService.Intent(aid,iid,2,null));UUID submission=UUID.fromString(intent.path("id").asText());
        assertThatThrownBy(()->attempts.solutionVersion(user,aid,iid)).isInstanceOf(ApiException.class);attempts.reveal(user,aid,iid,new AttemptDtos.SolutionReveal(2,submission,0));
        storage.entered=new CountDownLatch(1);storage.release=new CountDownLatch(1);
        var upload=CompletableFuture.supplyAsync(()->studentMedia.upload(user,submission,fixtureUpload()));
        try {
            assertThat(storage.entered.await(5,TimeUnit.SECONDS)).isTrue();assertThatThrownBy(()->attempts.solutionVersion(user,aid,iid)).isInstanceOf(ApiException.class);assertThatThrownBy(()->attempts.reveal(user,aid,iid,new AttemptDtos.SolutionReveal(2,submission,0))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("uploads_in_flight");
        }finally { storage.release.countDown(); }
        UUID image=UUID.fromString(upload.get(10,TimeUnit.SECONDS).path("id").asText());storage.entered=null;storage.release=null;
        assertThatThrownBy(()->attempts.solutionVersion(user,aid,iid)).isInstanceOf(ApiException.class);attempts.reveal(user,aid,iid,new AttemptDtos.SolutionReveal(2,submission,1));
        studentMedia.delete(user,submission,image);assertThatThrownBy(()->attempts.solutionVersion(user,aid,iid)).isInstanceOf(ApiException.class);attempts.reveal(user,aid,iid,new AttemptDtos.SolutionReveal(2,submission,2));
        assertThat(db.queryForObject("SELECT count(*) FROM grading_results WHERE submission_id=?",Integer.class,submission)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM grading_jobs WHERE submission_id=?",Integer.class,submission)).isZero();
    }
    @Test void availableShortUnknownOrTransientUnavailableDoNotUnlockReveal() {
        for(int number:List.of(7,15,16)) {
            var version=publish(task(number)).version();var attempt=attempt(taskId(version),number);var item=attempt.items().getFirst();db.update("UPDATE users SET plan_id='free' WHERE id=?",user);
            assertThatThrownBy(()->attempts.reveal(user,attempt.id(),item.id(),new AttemptDtos.SolutionReveal(0,null,null))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("solution_reveal_unavailable");
        }
        var version=publish(task(14)).version();var attempt=attempt(taskId(version),14);assertThat(attempts.reveal(user,attempt.id(),attempt.items().getFirst().id(),new AttemptDtos.SolutionReveal(0,null,null))).isNotNull();
    }
    @Test void mismatchingRichAnswerNeverBecomesReadyAiInput() {
        var root=task(16);root.put("referenceAnswerContent",List.of(Map.of("type","text","value","5")));var prepared=validator.validate(validator.parse(manifest(root)),files);assertThat(prepared.aiReady()).isFalse();var version=publisher.publish(prepared).version();assertThat(catalog.task(user,taskId(version)).gradingCapability()).isEqualTo("unsupported");
        var shortRoot=task(7);shortRoot.put("referenceAnswer","5");assertThatThrownBy(()->validator.validate(validator.parse(manifest(shortRoot)),files)).hasMessage("answer_mismatch");
    }
    MockMultipartFile fixtureUpload() { try { return new MockMultipartFile("file","fixture.png","image/png",png()); }catch(Exception failure) { throw new IllegalStateException(failure); } }
    record Login(String session,String csrf) { }
    String cookie(org.springframework.http.HttpHeaders headers,String name) { return headers.getOrEmpty("Set-Cookie").stream().filter(value->value.startsWith(name+"=")).map(value->value.substring(name.length()+1,value.indexOf(';'))).findFirst().orElse(null); }
    Login login(UUID id) {
        String password="Fixture-Content-Password-238";db.update("UPDATE users SET password_hash=? WHERE id=?",passwords.encode(password),id);
        var bootstrap=rest.getForEntity("/api/auth/csrf",String.class);var response=http("POST","/api/auth/login",new Login(null,cookie(bootstrap.getHeaders(),"XSRF-TOKEN")),Map.of("email",users.findById(id).orElseThrow().getEmail(),"password",password));assertThat(response.getStatusCode().value()).isEqualTo(200);
        String session=cookie(response.getHeaders(),"SESSION");var fresh=http("GET","/api/auth/csrf",new Login(session,null),null);return new Login(session,cookie(fresh.getHeaders(),"XSRF-TOKEN"));
    }
    org.springframework.http.ResponseEntity<String> http(String method,String path,Login login,Object body) {
        var headers=new org.springframework.http.HttpHeaders();headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);headers.set("Cookie",(login.session()==null?"":"SESSION="+login.session()+"; ")+(login.csrf()==null?"":"XSRF-TOKEN="+login.csrf()));if(login.csrf()!=null)headers.set("X-XSRF-TOKEN",login.csrf());
        return rest.exchange(path,org.springframework.http.HttpMethod.valueOf(method),new org.springframework.http.HttpEntity<>(body==null?null:json.write(body),headers),String.class);
    }
    @Test void pathsUnsafeImagesAndLatexFailClosed()throws Exception {
        var pathRoot=withImages(task(7));var asset=(Map<String,Object>)((List<?>)pathRoot.get("assets")).getFirst();asset.put("path","../private.png");assertThatThrownBy(()->validator.validate(validator.parse(manifest(pathRoot)),files)).hasMessage("asset_path");
        var mathRoot=task(7);mathRoot.put("content",List.of(Map.of("type","latex","value","\\frac{1}{2}")));assertThatThrownBy(()->validator.validate(validator.parse(manifest(mathRoot)),files)).hasMessage("math_validator_required");
        Files.writeString(files.resolve("link.svg"),"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>");var svgRoot=task(7);svgRoot.put("assets",List.of(Map.of("id","a","path","link.svg","sha256",ImportPackageValidator.hash(Files.readAllBytes(files.resolve("link.svg"))),"purpose","statement")));assertThatThrownBy(()->validator.validate(validator.parse(manifest(svgRoot)),files)).hasMessage("unsafe_media");
    }
    Map<String,Object> withImages(Map<String,Object> root)throws Exception {
        byte[] bytes=png();Files.write(files.resolve("fixture.png"),bytes);var first=new LinkedHashMap<String,Object>();first.put("id","figure");first.put("path","fixture.png");first.put("sha256",ImportPackageValidator.hash(bytes));first.put("purpose","statement");
        root.put("assets",List.of(first,Map.of("id","solution","path","fixture.png","sha256",ImportPackageValidator.hash(bytes),"purpose","reference")));
        root.put("content",List.of(Map.of("type","text","value","Compute 1+1"),Map.of("type","paragraph","runs",List.of(Map.of("type","formula","assetId","figure","alt","Формула")))));
        root.put("referenceContent",List.of(Map.of("type","text","value","1+1=2"),Map.of("type","image","assetId","solution","alt","Иллюстрация решения")));return root;
    }
    byte[] png()throws Exception { var image=new BufferedImage(16,16,BufferedImage.TYPE_INT_RGB);image.setRGB(3,3,0xff3344);var bytes=new ByteArrayOutputStream();ImageIO.write(image,"png",bytes);return bytes.toByteArray(); }
}
