package org.botai.back.media;

import java.util.*;
import java.util.concurrent.*;
import org.botai.back.common.ApiException;
import org.botai.back.expert.ExpertService;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.media.port.ObjectStorage;
import org.botai.back.user.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties={"spring.docker.compose.enabled=false","management.server.port=0","app.grading.worker-enabled=false","app.pdf.worker-enabled=false","app.b2b.local-enabled=true","app.b2b.operator-user-ids=aaaaaaaa-1000-4000-8000-000000000001"})
@Testcontainers
class SubmissionArtifactIntegrationTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    static class Storage implements ObjectStorage {
        final Map<String,byte[]> objects=new ConcurrentHashMap<>();volatile CountDownLatch entered,release;
        public void put(String key,byte[] bytes,String mime){assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isFalse();if(key.startsWith("solution/artifacts/")&&entered!=null){entered.countDown();try{if(!release.await(10,TimeUnit.SECONDS))throw new IllegalStateException("timeout");}catch(InterruptedException e){throw new IllegalStateException(e);}}objects.put(key,bytes);}
        public byte[] get(String key,long max){assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isFalse();return Objects.requireNonNull(objects.get(key));}
        public void delete(String key){objects.remove(key);}public String bucket(){return "test-private";}
    }
    @TestConfiguration static class Ports {
        @Bean @Primary Storage storage(){return new Storage();}
        @Bean @Primary org.botai.back.media.port.PdfRenderer renderer(){return new org.botai.back.media.port.PdfRenderer(){public boolean available(){return true;}public Rendered render(UUID request,byte[] bytes,String hash,int max){try{return new Rendered("pdf-raster.v1",List.of(new Page(1,32,32,StudentCropperTest.jpeg(32,32))));}catch(Exception e){throw new IllegalStateException(e);}}};}
    }
    @Autowired org.botai.back.b2b.B2bConfig config;@Autowired SubmissionArtifactService artifacts;@Autowired SubmissionStore store;@Autowired UserRepository users;@Autowired Storage storage;@Autowired MediaService media;@Autowired SolutionDocumentService documents;
    UUID school,student,expert,assignment,submission,source,run,work;Authentication auth;
    UUID account(Role role){return users.save(User.builder().email(UUID.randomUUID()+"@test.local").passwordHash("{noop}test").role(role).build()).getId();}
    @BeforeEach void setup() throws Exception {
        storage.entered=null;storage.release=null;school=UUID.randomUUID();student=account(Role.USER);expert=account(Role.EXPERT);UUID task=UUID.randomUUID();assignment=UUID.randomUUID();submission=UUID.randomUUID();source=UUID.randomUUID();run=UUID.randomUUID();work=UUID.randomUUID();
        var db=store.db();db.update("INSERT INTO schools(id,name) VALUES(?,'Crop School')",school);db.update("INSERT INTO school_experts(school_id,user_id) VALUES(?,?)",school,expert);db.update("INSERT INTO school_students(school_id,user_id,first_name,last_name,contact) VALUES(?,?,'Иван','Тест','test')",school,student);db.update("INSERT INTO expert_students(school_id,student_user_id,expert_user_id) VALUES(?,?,?)",school,student,expert);
        db.update("INSERT INTO school_tasks(id,school_id,task_number,max_score,title,statement,content,reference_answer) VALUES(?,?,16,2,'Task','Statement','[]','Answer')",task,school);
        db.update("INSERT INTO school_assignments(id,school_id,student_user_id,task_id,title) VALUES(?,?,?,?,'Assignment')",assignment,school,student,task);
        db.update("INSERT INTO grading_submissions(id,user_id,input_revision,idempotency_key,request_hash,request_id,status,origin,school_assignment_id) VALUES(?,?,0,?,'hash',?,'running','school',?)",submission,student,UUID.randomUUID().toString(),UUID.randomUUID(),assignment);
        byte[] bytes=StudentCropperTest.jpeg(100,80);String key="solution/"+UUID.randomUUID();storage.objects.put(key,bytes);
        db.update("INSERT INTO stored_objects(id,user_id,submission_id,purpose,bucket,object_key,state,file_name,mime_type,size_bytes,width,height,sha256,ordinal) VALUES(?,?,?,'solution','test',?,'ready','source.jpg','image/jpeg',?,100,80,?,0)",source,student,submission,key,bytes.length,PdfLimits.hash(bytes));
        db.update("INSERT INTO grading_jobs(submission_id,state,fencing_token,lease_until,run_id) VALUES(?,'dispatching',7,now()+interval '5 minutes',?)",submission,run);
        db.update("INSERT INTO grading_results(submission_id,is_graded,score,max_score,feedback,is_demo,exact_response,provider_mode,package_id) VALUES(?,true,2,2,'{}',true,'fixture','mock','fixture')",submission);
        db.update("INSERT INTO expert_works(id,school_id,student_user_id,expert_user_id,submission_id,ai_document) VALUES(?,?,?,?,?,'{}')",work,school,student,expert,submission);
        auth=new UsernamePasswordAuthenticationToken(users.findById(expert).orElseThrow().getEmail(),"",List.of(new SimpleGrantedAuthority("ROLE_EXPERT")));
    }
    StudentCropper.Crop crop(){return new StudentCropper.Crop(.1,.1,.5,.5);}
    UUID create(){return artifacts.createForSubmission(submission,run,7,source,crop(),"Фрагмент");}
    String state(UUID id){return store.db().queryForObject("SELECT state FROM submission_artifacts WHERE id=?",String.class,id);}
    void sent(UUID id){String doc="{\"schema_version\":\"expert-review.v2\",\"ocr\":{\"blocks\":[{\"content\":{\"type\":\"image\",\"artifact_id\":\""+id+"\",\"alt\":\"Фрагмент\"}}]}}";store.db().update("UPDATE expert_works SET status='sent',revision=1,document=?::jsonb,sent_at=now() WHERE id=?",doc,work);}
    @Test void actualWorkerCropIsStoredPrivateAndOnlySentFinalReferencedArtifactReadable() {
        UUID id=create();assertThat(id).isNotEqualTo(source);assertThat(state(id)).isEqualTo("ready");assertThat(artifacts.expertPreview(auth,work,id).mimeType()).isEqualTo("image/jpeg");
        assertThatThrownBy(()->artifacts.ownerPreview(student,submission,id)).extracting("status").isEqualTo(404);
        assertThatThrownBy(()->media.read(student,false,id)).extracting("status").isEqualTo(404);
        UUID unused=create();sent(id);
        assertThat(artifacts.ownerPreview(student,submission,id).bytes()).isNotEmpty();assertThatThrownBy(()->artifacts.ownerPreview(student,submission,unused)).extracting("status").isEqualTo(404);
        assertThatThrownBy(()->artifacts.ownerPreview(account(Role.USER),submission,id)).extracting("status").isEqualTo(404);
        assertThatThrownBy(()->artifacts.create(auth,work,new SubmissionArtifactService.Proposal(source,crop(),""))).extracting("code").isEqualTo("review_sent");
    }
    @Test void rejectsCrossSubmissionAvatarReferenceAndUnreadySources() {
        UUID otherAssignment=UUID.randomUUID(),otherSubmission=UUID.randomUUID(),foreignImage=UUID.randomUUID();
        store.db().update("INSERT INTO school_assignments(id,school_id,student_user_id,task_id,title) SELECT ?,school_id,student_user_id,task_id,'Another' FROM school_assignments WHERE id=?",otherAssignment,assignment);
        store.db().update("INSERT INTO grading_submissions(id,user_id,input_revision,idempotency_key,request_hash,request_id,status,origin,school_assignment_id) VALUES(?,?,0,?,'hash',?,'draft','school',?)",otherSubmission,student,UUID.randomUUID().toString(),UUID.randomUUID(),otherAssignment);
        store.db().update("INSERT INTO stored_objects(id,user_id,submission_id,purpose,bucket,object_key,state,file_name,mime_type,size_bytes,width,height,sha256,ordinal) SELECT ?,user_id,?,'solution',bucket,?,'ready',file_name,mime_type,size_bytes,width,height,sha256,0 FROM stored_objects WHERE id=?",foreignImage,otherSubmission,UUID.randomUUID().toString(),source);
        assertThatThrownBy(()->artifacts.createForSubmission(submission,run,7,foreignImage,crop(),"")).extracting("status").isEqualTo(404);
        assertThatThrownBy(()->artifacts.createForSubmission(submission,run,7,UUID.randomUUID(),crop(),"")).extracting("status").isEqualTo(404);
        store.db().update("UPDATE stored_objects SET purpose='avatar' WHERE id=?",source);assertThatThrownBy(this::create).extracting("status").isEqualTo(404);
        store.db().update("UPDATE stored_objects SET purpose='solution',state='staged' WHERE id=?",source);assertThatThrownBy(this::create).extracting("status").isEqualTo(404);
        UUID reference=UUID.randomUUID();UUID task=store.db().queryForObject("SELECT task_id FROM school_assignments WHERE id=?",UUID.class,assignment);store.db().update("INSERT INTO school_task_assets(id,school_id,task_id,kind,bucket,object_key,file_name,mime_type,size_bytes,sha256) VALUES(?,?,?,'reference','test',?,'ref.jpg','image/jpeg',100,'hash')",reference,school,task,UUID.randomUUID().toString());
        assertThatThrownBy(()->artifacts.createForSubmission(submission,run,7,reference,crop(),"")).extracting("status").isEqualTo(404);assertThatThrownBy(()->media.read(student,false,reference)).extracting("status").isEqualTo(404);
    }
    @Test void currentRosterRevocationDeniesReadsButPreservesAndRestoresFinalPixels() {
        UUID id=create();sent(id);store.db().update("UPDATE school_students SET enabled=false WHERE school_id=? AND user_id=?",school,student);
        assertThatThrownBy(()->media.read(student,false,source)).extracting("status").isEqualTo(404);assertThatThrownBy(()->media.read(account(Role.ADMIN),true,source)).extracting("status").isEqualTo(404);
        assertThatThrownBy(()->artifacts.ownerPreview(student,submission,id)).extracting("status").isEqualTo(404);assertThatThrownBy(()->artifacts.expertPreview(auth,work,id)).extracting("status").isEqualTo(404);
        assertThatThrownBy(this::create).extracting("status").isEqualTo(404);String key=store.db().queryForObject("SELECT object_key FROM submission_artifacts WHERE id=?",String.class,id);String hash=PdfLimits.hash(storage.objects.get(key));String finalDocument=store.db().queryForObject("SELECT document::text FROM expert_works WHERE id=?",String.class,work);
        artifacts.reap();media.reap();documents.reap();assertThat(state(id)).isEqualTo("ready");assertThat(PdfLimits.hash(storage.objects.get(key))).isEqualTo(hash);
        store.db().update("UPDATE school_students SET enabled=true WHERE school_id=? AND user_id=?",school,student);
        assertThat(PdfLimits.hash(artifacts.ownerPreview(student,submission,id).bytes())).isEqualTo(hash);assertThat(media.read(student,false,source).bytes()).isNotEmpty();
        assertThat(store.db().queryForObject("SELECT document::text FROM expert_works WHERE id=?",String.class,work)).isEqualTo(finalDocument);
    }
    @Test void schoolRoleAndExpertReassignmentDenyAccessWithoutDeletingHistory() {
        UUID id=create();sent(id);var db=store.db();UUID colleague=account(Role.EXPERT);db.update("INSERT INTO school_experts(school_id,user_id) VALUES(?,?)",school,colleague);
        var changes=List.<Runnable[]>of(
            new Runnable[]{()->db.update("UPDATE schools SET enabled=false WHERE id=?",school),()->db.update("UPDATE schools SET enabled=true WHERE id=?",school)},
            new Runnable[]{()->db.update("UPDATE users SET enabled=false WHERE id=?",student),()->db.update("UPDATE users SET enabled=true WHERE id=?",student)},
            new Runnable[]{()->db.update("UPDATE users SET role='ADMIN' WHERE id=?",student),()->db.update("UPDATE users SET role='USER' WHERE id=?",student)},
            new Runnable[]{()->db.update("UPDATE school_assignments SET enabled=false WHERE id=?",assignment),()->db.update("UPDATE school_assignments SET enabled=true WHERE id=?",assignment)},
            new Runnable[]{()->db.update("UPDATE school_experts SET enabled=false WHERE school_id=? AND user_id=?",school,expert),()->db.update("UPDATE school_experts SET enabled=true WHERE school_id=? AND user_id=?",school,expert)},
            new Runnable[]{()->db.update("UPDATE users SET role='USER' WHERE id=?",expert),()->db.update("UPDATE users SET role='EXPERT' WHERE id=?",expert)},
            new Runnable[]{()->db.update("UPDATE expert_students SET expert_user_id=? WHERE school_id=? AND student_user_id=?",colleague,school,student),()->db.update("UPDATE expert_students SET expert_user_id=? WHERE school_id=? AND student_user_id=?",expert,school,student)});
        var hashes=new HashMap<String,String>();for(String key:db.queryForList("SELECT object_key FROM stored_objects WHERE submission_id=? UNION ALL SELECT object_key FROM submission_artifacts WHERE submission_id=?",String.class,submission,submission))hashes.put(key,PdfLimits.hash(storage.objects.get(key)));String finalDocument=db.queryForObject("SELECT document::text FROM expert_works WHERE id=?",String.class,work);
        for(var change:changes){change[0].run();try{assertThatThrownBy(()->artifacts.ownerPreview(student,submission,id)).extracting("status").isEqualTo(404);media.reap();documents.reap();artifacts.reap();assertThat(state(id)).isEqualTo("ready");for(var entry:hashes.entrySet())assertThat(PdfLimits.hash(storage.objects.get(entry.getKey()))).isEqualTo(entry.getValue());assertThat(db.queryForObject("SELECT document::text FROM expert_works WHERE id=?",String.class,work)).isEqualTo(finalDocument);}finally{change[1].run();}assertThat(artifacts.ownerPreview(student,submission,id).bytes()).isNotEmpty();}
    }
    @Test void expiredOrWrongWorkerFenceCannotCreateAndSixteenLimitCountsReservations() {
        assertThatThrownBy(()->artifacts.createForSubmission(submission,run,8,source,crop(),"")).extracting("code").isEqualTo("artifact_stale");
        assertThatThrownBy(()->artifacts.createForSubmission(submission,UUID.randomUUID(),7,source,crop(),"")).extracting("code").isEqualTo("artifact_stale");
        for(int i=0;i<16;i++)create();assertThatThrownBy(this::create).extracting("code").isEqualTo("artifact_budget");
        store.db().update("UPDATE grading_jobs SET lease_until=now()-interval '1 second' WHERE submission_id=?",submission);assertThatThrownBy(this::create).extracting("code").isEqualTo("artifact_stale");
    }
    @Test void developerPreviewRequiresAllowlistedCurrentAssignedExpertEvenBeforeFinal() {
        UUID id=create();UUID operator=UUID.fromString("aaaaaaaa-1000-4000-8000-000000000001");
        User user=User.builder().email("crop-operator@test.local").passwordHash("{noop}test").role(Role.EXPERT).build();user.setId(operator);users.save(user);
        store.db().update("INSERT INTO school_experts(school_id,user_id) VALUES(?,?)",school,operator);
        assertThatThrownBy(()->artifacts.operatorPreview(expert,submission,id)).extracting("status").isEqualTo(403);
        assertThatThrownBy(()->artifacts.operatorPreview(operator,submission,id)).extracting("status").isEqualTo(404);
        store.db().update("UPDATE expert_students SET expert_user_id=? WHERE school_id=? AND student_user_id=?",operator,school,student);
        assertThat(artifacts.operatorPreview(operator,submission,id).bytes()).isNotEmpty();
        store.db().update("UPDATE schools SET enabled=false WHERE id=?",school);
        assertThatThrownBy(()->artifacts.operatorPreview(operator,submission,id)).extracting("status").isEqualTo(404);
    }
    @Test void aggregatePixelQuotaIncludesInFlightReservations() {
        for(int i=0;i<4;i++)store.db().update("INSERT INTO submission_artifacts(id,submission_id,source_image_id,kind,bbox,state,bucket,object_key,file_name,mime_type,size_bytes,width,height,sha256,alt) VALUES(?,?,?,'student_crop','{\"x\":0,\"y\":0,\"width\":1,\"height\":1}','staged','test',?,'crop.jpg','image/jpeg',100,3000,2000,'hash','')",UUID.randomUUID(),submission,source,UUID.randomUUID().toString());
        assertThatThrownBy(this::create).extracting("code").isEqualTo("artifact_budget");
    }
    @Test void schoolPdfRevocationPreservesOriginalPagesAndRestoresExactBytes() {
        store.db().update("UPDATE grading_submissions SET status='draft' WHERE id=?",submission);
        byte[] pdf="%PDF-1.7 original school solution".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        UUID document=UUID.fromString(documents.upload(student,submission,new org.springframework.mock.web.MockMultipartFile("file","school.pdf","application/pdf",pdf)).path("id").asText());
        documents.execute(documents.claim());assertThat(documents.original(student,submission,document).bytes()).isEqualTo(pdf);
        store.db().update("UPDATE school_assignments SET enabled=false WHERE id=?",assignment);
        assertThatThrownBy(()->documents.original(student,submission,document)).extracting("status").isEqualTo(404);
        assertThatThrownBy(()->documents.get(student,submission,document)).extracting("status").isEqualTo(404);
        assertThatThrownBy(()->documents.delete(student,submission,document)).extracting("status").isEqualTo(404);
        documents.reap();media.reap();artifacts.reap();assertThat(store.db().queryForObject("SELECT state FROM solution_documents WHERE id=?",String.class,document)).isEqualTo("ready");
        for(String key:store.db().queryForList("SELECT object_key FROM stored_objects WHERE source_document_id=? AND state='ready' UNION ALL SELECT object_key FROM solution_documents WHERE id=?",String.class,document,document))assertThat(storage.objects).containsKey(key);
        store.db().update("UPDATE school_assignments SET enabled=true WHERE id=?",assignment);assertThat(documents.original(student,submission,document).bytes()).isEqualTo(pdf);
        documents.delete(student,submission,document);documents.reap();for(String key:store.db().queryForList("SELECT object_key FROM stored_objects WHERE source_document_id=? UNION ALL SELECT object_key FROM solution_documents WHERE id=?",String.class,document,document))assertThat(storage.objects).doesNotContainKey(key);
    }
    @Test void featureShutdownReapersPreserveReadyOriginalPagesCropAndImmutableFinal() {
        store.db().update("UPDATE grading_submissions SET status='draft' WHERE id=?",submission);
        byte[] pdf="%PDF-1.7 preserved original".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        UUID document=UUID.fromString(documents.upload(student,submission,new org.springframework.mock.web.MockMultipartFile("file","retained.pdf","application/pdf",pdf)).path("id").asText());documents.execute(documents.claim());
        store.db().update("UPDATE grading_submissions SET status='running' WHERE id=?",submission);UUID crop=create();sent(crop);store.db().update("UPDATE grading_submissions SET status='graded' WHERE id=?",submission);
        var hashes=new HashMap<String,String>();for(String key:store.db().queryForList("SELECT object_key FROM stored_objects WHERE submission_id=? AND state='ready' UNION ALL SELECT object_key FROM solution_documents WHERE submission_id=? AND state='ready' UNION ALL SELECT object_key FROM submission_artifacts WHERE submission_id=? AND state='ready'",String.class,submission,submission,submission))hashes.put(key,PdfLimits.hash(storage.objects.get(key)));
        String finalDocument=store.db().queryForObject("SELECT document::text FROM expert_works WHERE id=?",String.class,work);
        org.springframework.test.util.ReflectionTestUtils.setField(config,"enabled",false);
        try {
            assertThatThrownBy(()->media.read(student,false,source)).extracting("status").isEqualTo(404);assertThatThrownBy(()->documents.original(student,submission,document)).extracting("status").isEqualTo(404);assertThatThrownBy(()->artifacts.ownerPreview(student,submission,crop)).extracting("status").isEqualTo(404);
            media.reap();documents.reap();artifacts.reap();
            for(var entry:hashes.entrySet())assertThat(PdfLimits.hash(storage.objects.get(entry.getKey()))).isEqualTo(entry.getValue());
            assertThat(state(crop)).isEqualTo("ready");assertThat(store.db().queryForObject("SELECT state FROM solution_documents WHERE id=?",String.class,document)).isEqualTo("ready");assertThat(store.db().queryForObject("SELECT document::text FROM expert_works WHERE id=?",String.class,work)).isEqualTo(finalDocument);
        }finally{org.springframework.test.util.ReflectionTestUtils.setField(config,"enabled",true);}
        assertThat(documents.original(student,submission,document).bytes()).isEqualTo(pdf);assertThat(artifacts.ownerPreview(student,submission,crop).bytes()).isNotEmpty();assertThat(media.read(student,false,source).bytes()).isNotEmpty();
    }
    @Test void revokedProcessingPdfStopsConversionButRetainsOriginalUntilExplicitDelete() {
        store.db().update("UPDATE grading_submissions SET status='draft' WHERE id=?",submission);byte[] pdf="%PDF-1.7 pending retained original".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        UUID document=UUID.fromString(documents.upload(student,submission,new org.springframework.mock.web.MockMultipartFile("file","retained.pdf","application/pdf",pdf)).path("id").asText());var claim=documents.claim();String key=store.db().queryForObject("SELECT object_key FROM solution_documents WHERE id=?",String.class,document);
        store.db().update("UPDATE school_students SET enabled=false WHERE school_id=? AND user_id=?",school,student);documents.execute(claim);documents.reap();media.reap();artifacts.reap();
        assertThat(store.db().queryForObject("SELECT state FROM solution_documents WHERE id=?",String.class,document)).isEqualTo("failed");assertThat(store.db().queryForObject("SELECT error_code FROM solution_documents WHERE id=?",String.class,document)).isEqualTo("pdf_access_revoked");assertThat(storage.objects.get(key)).isEqualTo(pdf);
        assertThat(store.db().queryForObject("SELECT count(*) FROM stored_objects WHERE source_document_id=? AND state='ready'",Integer.class,document)).isZero();
        store.db().update("UPDATE school_students SET enabled=true WHERE school_id=? AND user_id=?",school,student);documents.delete(student,submission,document);documents.reap();assertThat(storage.objects).doesNotContainKey(key);
    }
    @Test void latePutAfterRevocationNeverPublishesAndIsDeletedAgain() throws Exception {
        storage.entered=new CountDownLatch(1);storage.release=new CountDownLatch(1);
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {var pending=executor.submit(this::create);assertThat(storage.entered.await(5,TimeUnit.SECONDS)).isTrue();UUID id=store.db().queryForObject("SELECT id FROM submission_artifacts WHERE submission_id=?",UUID.class,submission);store.db().update("UPDATE school_assignments SET enabled=false WHERE id=?",assignment);storage.release.countDown();assertThatThrownBy(()->pending.get(5,TimeUnit.SECONDS)).hasCauseInstanceOf(ApiException.class);assertThat(state(id)).isEqualTo("deleted");String key=store.db().queryForObject("SELECT object_key FROM submission_artifacts WHERE id=?",String.class,id);assertThat(storage.objects).doesNotContainKey(key);}finally{storage.release.countDown();}
    }
}
