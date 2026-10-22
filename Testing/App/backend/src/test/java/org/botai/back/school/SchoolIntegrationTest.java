package org.botai.back.school;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.botai.back.b2b.*;
import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.common.*;
import org.botai.back.expert.*;
import org.botai.back.grading.*;
import org.botai.back.grading.port.GradingGateway;
import org.botai.back.media.*;
import org.botai.back.media.port.ObjectStorage;
import org.botai.back.user.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.*;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.*;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"spring.docker.compose.enabled=false","management.server.port=0","app.grading.worker-enabled=false","app.pdf.worker-enabled=false","app.b2b.local-enabled=true"})
@AutoConfigureTestRestTemplate
@Testcontainers
class SchoolIntegrationTest {
 @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
 static class Storage implements ObjectStorage {final Map<String,byte[]> objects=new ConcurrentHashMap<>();volatile Runnable onGet;public void put(String k,byte[] b,String m){assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();objects.put(k,b);}public byte[] get(String k,long cap){assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();var callback=onGet;onGet=null;if(callback!=null)callback.run();return Objects.requireNonNull(objects.get(k));}public void delete(String k){objects.remove(k);}public String bucket(){return "private";}}
 static class Gateway implements B2bGradingGateway {
   AtomicInteger calls=new AtomicInteger();boolean reject,unknown,live;
   public Map<Integer,GradingGateway.Capability> capabilities(){return Map.of(16,new GradingGateway.Capability(16,2,true,"school-package",live?"live":"mock"));}
   public Validated grade(UUID run,UUID submission,long fence,TaskSnapshot task,List<GradingGateway.Image> images,String pinned,String mode){assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();calls.incrementAndGet();if(unknown)throw new ApiException(502,"unknown_after_dispatch","Unknown");var mapper=tools.jackson.databind.json.JsonMapper.builder().build();var codec=new JsonCodec(mapper);var adapter=new ExpertReviewDocument(codec);JsonNode document;if(reject)document=adapter.legacy(null,false,"Нечитаемо",images.stream().map(i->i.id().toString()).toList());else{var grading=Map.of("score",2,"criterion","Критерий","explanation","Верно");var feedback=codec.read(codec.write(Map.of("ocr","x=1","analysis",Map.of("summary","Верно","strengths",List.of(),"errors",List.of()),"grading",grading)));document=adapter.legacy(feedback,true,null,images.stream().map(i->i.id().toString()).toList());}((ObjectNode)document).put("schema_version","expert-review.v2");var feedback=mapper.convertValue(document,Map.class);return new Validated(new GradingGateway.Response("{\"fixture\":true}","mock",pinned,null),new AiResponseValidator.Validated(!reject,reject?null:2,reject?"Нечитаемо":null,feedback,true),task);}
 }
 @TestConfiguration static class Ports {@Bean @Primary Storage storage(){return new Storage();}@Bean @Primary Gateway gateway(){return new Gateway();}}
 @Autowired B2bAiScheduler scheduler;@Autowired SchoolService schools;@Autowired SubmissionStore store;@Autowired SubmissionService submissions;@Autowired GradingWorker worker;@Autowired ExpertService experts;@Autowired MediaService media;@Autowired UserRepository users;@Autowired JdbcTemplate db;@Autowired JsonCodec json;@Autowired Storage storage;@Autowired Gateway gateway;@Autowired TestRestTemplate rest;@Autowired PasswordEncoder passwords;@Autowired SolutionDocumentService documents;@Autowired SubmissionArtifactService artifacts;@Autowired B2bConfig config;@Autowired SubmissionOrigins origins;@Autowired org.springframework.transaction.support.TransactionTemplate transactions;
 UUID school,student,expert,outsider,assignment,task;Authentication studentAuth,expertAuth;
 @BeforeEach void setup(){db.update("INSERT INTO local_ai_acknowledgements(run_id) SELECT id FROM grading_runs WHERE outcome IS NOT NULL ON CONFLICT DO NOTHING");db.update("UPDATE expert_grading_jobs SET state='stale' WHERE state IN('queued','pending','unknown')");db.update("INSERT INTO local_ai_acknowledgements(run_id) SELECT id FROM expert_grading_jobs WHERE state='stale' ON CONFLICT DO NOTHING");storage.onGet=null;gateway.calls.set(0);gateway.reject=false;gateway.unknown=false;gateway.live=false;school=UUID.randomUUID();student=account(Role.USER);expert=account(Role.EXPERT);outsider=account(Role.USER);task=UUID.randomUUID();assignment=UUID.randomUUID();db.update("INSERT INTO schools(id,name) VALUES(?,'Local school')",school);db.update("INSERT INTO school_experts(school_id,user_id) VALUES(?,?)",school,expert);db.update("INSERT INTO school_students(school_id,user_id,first_name,last_name) VALUES(?,?,'Тест','Ученик')",school,student);db.update("INSERT INTO expert_students(school_id,student_user_id,expert_user_id) VALUES(?,?,?)",school,student,expert);db.update("INSERT INTO school_tasks(id,school_id,task_number,max_score,title,statement,content,reference_answer) VALUES(?,?,16,2,'Задача','Условие','[{\"type\":\"text\",\"text\":\"Условие\"}]','PRIVATE-REFERENCE')",task,school);db.update("INSERT INTO school_assignments(id,school_id,student_user_id,task_id,title) VALUES(?,?,?,?,'Домашняя работа')",assignment,school,student,task);studentAuth=auth(student);expertAuth=auth(expert);}
 UUID account(Role role){return users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash(passwords.encode("test-password-secure")).role(role).build()).getId();}
 Authentication auth(UUID id){var u=users.findById(id).orElseThrow();return new UsernamePasswordAuthenticationToken(u.getEmail(),"",List.of(new SimpleGrantedAuthority("ROLE_"+u.getRole())));}
 UUID create(){return UUID.fromString(schools.create(studentAuth,assignment,UUID.randomUUID().toString(),new SchoolService.Create(null)).path("id").asText());}
 MockMultipartFile image()throws Exception{var bytes=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(32,32,java.awt.image.BufferedImage.TYPE_INT_RGB),"png",bytes);return new MockMultipartFile("file","answer.png","image/png",bytes.toByteArray());}
 UUID queued()throws Exception{UUID id=create();media.upload(student,id,image());submissions.finalizeSubmission(student,id,1);return id;}
 UUID completed()throws Exception{UUID id=queued();worker.execute(worker.claim());assertThat(db.queryForObject("SELECT status FROM grading_submissions WHERE id=?",String.class,id)).isEqualTo(gateway.reject?"rejected":"graded");return id;}
 UUID work(UUID id){return db.queryForObject("SELECT id FROM expert_works WHERE submission_id=?",UUID.class,id);}
 ObjectNode editable(UUID work){var doc=(ObjectNode)json.read(json.write(experts.work(expertAuth,work).get("review")));doc.put("origin","expert");return doc;}

 void fixture(int ordinal,byte[] bytes)throws Exception{String key="fixture/"+UUID.randomUUID();storage.objects.put(key,bytes);db.update("INSERT INTO school_solution_fixtures(id,task_id,ordinal,object_key,size_bytes,sha256) VALUES(?,?,?,?,?,?)",UUID.randomUUID(),task,ordinal,key,bytes.length,HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes)));}
 @Test void fixtureUsesRegularNormalizationAndReplayDoesNotDuplicateOrGrade()throws Exception{
   fixture(0,image().getBytes());fixture(1,image().getBytes());UUID id=create();
   assertThat(schools.detail(studentAuth,assignment).path("fixtureAvailable").asBoolean()).isTrue();
   var first=schools.fixture(studentAuth,assignment,id);var second=schools.fixture(studentAuth,assignment,id);
   assertThat(first.path("revision")).isEqualTo(second.path("revision"));
   assertThat(db.queryForObject("SELECT count(*) FROM stored_objects WHERE submission_id=? AND state='ready'",Integer.class,id)).isEqualTo(2);
   assertThat(db.queryForList("SELECT mime_type FROM stored_objects WHERE submission_id=? ORDER BY ordinal",String.class,id)).containsExactly("image/jpeg","image/jpeg");
   assertThat(gateway.calls.get()).isZero();assertThat(store.get(student,id).path("status").asText()).isEqualTo("draft");
   assertThatThrownBy(()->schools.fixture(auth(outsider),assignment,id)).extracting("status").isEqualTo(404);
   assertThatThrownBy(()->schools.fixture(studentAuth,UUID.randomUUID(),id)).extracting("status").isEqualTo(404);
 }
 @Test void concurrentFixtureAttachmentHasOneCopyAndIncompleteBatchCannotFinalize()throws Exception{
   fixture(0,image().getBytes());UUID id=create();var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
   storage.onGet=()->{entered.countDown();try{assertThat(release.await(10,TimeUnit.SECONDS)).isTrue();}catch(InterruptedException e){throw new RuntimeException(e);}};
   try(var pool=Executors.newSingleThreadExecutor()){
     var first=pool.submit(()->schools.fixture(studentAuth,assignment,id));assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();
     try{assertThatThrownBy(()->schools.fixture(studentAuth,assignment,id)).extracting("code").isEqualTo("fixture_attachment_in_progress");
       assertThatThrownBy(()->submissions.finalizeSubmission(student,id,0)).extracting("code").isEqualTo("fixture_attachment_in_progress");
     }finally{release.countDown();}first.get(10,TimeUnit.SECONDS);
   }
   assertThat(db.queryForObject("SELECT count(*) FROM stored_objects WHERE submission_id=?",Integer.class,id)).isEqualTo(1);
 }
 @Test void fixtureIntegrityFailureCannotBeSubmittedOrSilentlyReplayed()throws Exception{
   fixture(0,image().getBytes());UUID id=create();storage.objects.replaceAll((key,bytes)->new byte[]{1});
   assertThatThrownBy(()->schools.fixture(studentAuth,assignment,id)).extracting("code").isEqualTo("fixture_unavailable");
   assertThatThrownBy(()->schools.fixture(studentAuth,assignment,id)).extracting("code").isEqualTo("fixture_attachment_in_progress");
   assertThatThrownBy(()->submissions.finalizeSubmission(student,id,0)).extracting("code").isEqualTo("fixture_attachment_in_progress");
   assertThat(gateway.calls.get()).isZero();
 }
 @Test void fullPipelineDeliversOnlyExpertFinalAndNeverCreatesB2cState()throws Exception{
   UUID id=completed(),work=work(id);assertThat(gateway.calls.get()).isEqualTo(1);assertThat(store.get(student,id).path("status").asText()).isEqualTo("awaiting_expert");assertThat(store.get(student,id).get("result").isNull()).isTrue();assertThat(schools.result(studentAuth,assignment).get("result").isNull()).isTrue();assertThat(experts.studentReview(studentAuth,id,school).get("document").isNull()).isTrue();assertThat(store.get(student,id).toString()).doesNotContain("PRIVATE-REFERENCE","aiResult","feedback");
   var notification=experts.notifications(expertAuth,0,20);assertThat(notification.path("items")).hasSize(1);assertThat(experts.notifications(expertAuth,notification.path("nextAfter").asLong(),20).path("items")).isEmpty();UUID n=UUID.fromString(notification.path("items").get(0).path("id").asText());experts.readNotification(expertAuth,n);experts.readNotification(expertAuth,n);assertThat(experts.notifications(expertAuth,0,20).path("unreadCount").asInt()).isZero();
   var doc=editable(work);experts.save(expertAuth,work,new ExpertDtos.Save(0,doc),false);assertThat(store.get(student,id).path("status").asText()).isEqualTo("reviewing");assertThat(store.get(student,id).get("result").isNull()).isTrue();experts.save(expertAuth,work,new ExpertDtos.Save(1,doc),true);assertThat(store.get(student,id).path("status").asText()).isEqualTo("returned");assertThat(store.get(student,id).get("result")).isEqualTo(doc);assertThat(schools.detail(studentAuth,assignment).toString()).doesNotContain("PRIVATE-REFERENCE","referenceAnswer","referenceSolution");
   assertThat(db.queryForObject("SELECT count(*) FROM attempts WHERE user_id=?",Integer.class,student)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM user_task_results WHERE user_id=?",Integer.class,student)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM activity_events WHERE user_id=?",Integer.class,student)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM billing_test_usage WHERE submission_id=?",Integer.class,id)).isZero();UUID next=create();assertThat(next).isNotEqualTo(id);assertThat(store.get(student,id).get("result")).isEqualTo(doc);assertThat(schools.detail(studentAuth,assignment).path("history")).hasSize(2);
 }
 @Test void concurrentIntentKeysAreIdempotentAndDatabaseRejectsSecondActive()throws Exception{
   String key=UUID.randomUUID().toString();try(var pool=Executors.newFixedThreadPool(2)){var gate=new CountDownLatch(1);Callable<JsonNode> create=()->{gate.await();return schools.create(studentAuth,assignment,key,new SchoolService.Create(null));};var first=pool.submit(create);var second=pool.submit(create);gate.countDown();assertThat(first.get(10,TimeUnit.SECONDS).path("id")).isEqualTo(second.get(10,TimeUnit.SECONDS).path("id"));}assertThat(db.queryForObject("SELECT count(*) FROM grading_submissions WHERE school_assignment_id=?",Integer.class,assignment)).isEqualTo(1);assertThatThrownBy(this::create).extracting("code").isEqualTo("submission_in_progress");assertThatThrownBy(()->schools.create(studentAuth,assignment,key,new SchoolService.Create(UUID.randomUUID()))).extracting("code").isEqualTo("idempotency_conflict");assertThatThrownBy(()->db.update("INSERT INTO grading_submissions(id,user_id,origin,school_assignment_id,input_revision,idempotency_key,request_hash,request_id) VALUES(?,?,'school',?,0,?,'hash',?)",UUID.randomUUID(),student,assignment,UUID.randomUUID().toString(),UUID.randomUUID())).isInstanceOf(org.springframework.dao.DataAccessException.class);
 }
 @Test void rejectedAiAlsoWaitsForExpertAndHasNoInventedScore()throws Exception{gateway.reject=true;UUID id=completed(),work=work(id);assertThat(store.get(student,id).get("result").isNull()).isTrue();experts.save(expertAuth,work,new ExpertDtos.Save(0,editable(work)),true);assertThat(store.get(student,id).path("result").path("phase").asText()).isEqualTo("rejected");assertThat(store.get(student,id).path("result").path("grading").isNull()).isTrue();}
 @Test void cancellationFencesLateResponseAndRetryUsesNewImmutableSubmission()throws Exception{UUID id=queued();var claim=worker.claim();worker.dispatch(claim);submissions.cancel(student,id);worker.complete(claim,new GradingGateway.Response("{}","mock","school-package",null),new AiResponseValidator.Validated(true,2,null,Map.of(),true));assertThat(db.queryForObject("SELECT count(*) FROM expert_works WHERE submission_id=?",Integer.class,id)).isZero();UUID retry=UUID.fromString(schools.create(studentAuth,assignment,UUID.randomUUID().toString(),new SchoolService.Create(id)).path("id").asText());assertThat(retry).isNotEqualTo(id);assertThat(store.get(student,id).path("status").asText()).isEqualTo("cancelled");}
 @Test void liveDisabledBeforeQueueAndUnknownAfterDispatchCannotAutomaticallyRetry()throws Exception{UUID id=create();media.upload(student,id,image());gateway.live=true;assertThatThrownBy(()->submissions.finalizeSubmission(student,id,1)).extracting("code").isEqualTo("b2b_live_disabled");assertThat(gateway.calls.get()).isZero();assertThat(db.queryForObject("SELECT count(*) FROM grading_jobs WHERE submission_id=?",Integer.class,id)).isZero();gateway.live=false;submissions.finalizeSubmission(student,id,1);gateway.unknown=true;worker.execute(worker.claim());assertThat(store.get(student,id).path("errorCode").asText()).isEqualTo("unknown_after_dispatch");assertThat(store.get(student,id).path("retryable").asBoolean()).isFalse();assertThatThrownBy(()->schools.create(studentAuth,assignment,UUID.randomUUID().toString(),new SchoolService.Create(id))).extracting("code").isEqualTo("invalid_retry");}
 @Test void originAndTaskSnapshotsAreImmutableAndReferencesNeverUseStudentGenericMedia()throws Exception{UUID id=create();assertThatThrownBy(()->db.update("UPDATE grading_submissions SET origin='b2c',school_assignment_id=NULL,requested_attempt_id=?,requested_item_id=? WHERE id=?",UUID.randomUUID(),UUID.randomUUID(),id)).isInstanceOf(org.springframework.dao.DataAccessException.class);assertThatThrownBy(()->db.update("UPDATE school_tasks SET reference_answer='changed' WHERE id=?",task)).isInstanceOf(org.springframework.dao.DataAccessException.class);UUID ref=UUID.randomUUID();db.update("INSERT INTO school_task_assets(id,school_id,task_id,kind,bucket,object_key,file_name,mime_type,size_bytes,sha256) VALUES(?,?,?,'reference','test',?,'ref.jpg','image/jpeg',1,'hash')",ref,school,task,ref.toString());assertThatThrownBy(()->schools.taskMedia(studentAuth,assignment,ref)).extracting("status").isEqualTo(404);assertThatThrownBy(()->media.read(student,false,ref)).extracting("status").isEqualTo(404);assertThatThrownBy(()->experts.route(studentAuth,id,school)).extracting("status").isEqualTo(404);}

 @Test void revocationDuringSourceReadPreventsPaidDispatchAndAllReapersRetainOriginalsAndCrops()throws Exception{
   UUID id=queued();UUID image=db.queryForObject("SELECT id FROM stored_objects WHERE submission_id=? AND purpose='solution'",UUID.class,id);String key=db.queryForObject("SELECT object_key FROM stored_objects WHERE id=?",String.class,image);byte[] photo=storage.objects.get(key).clone();UUID document=UUID.randomUUID(),artifact=UUID.randomUUID();byte[] pdf="%PDF-1.7 retained original".getBytes(java.nio.charset.StandardCharsets.US_ASCII);String pdfKey="solution/pdf-original/"+document,cropKey="solution/artifacts/"+artifact;storage.objects.put(pdfKey,pdf);storage.objects.put(cropKey,photo);
   db.update("INSERT INTO solution_documents(id,user_id,submission_id,bucket,object_key,file_name,size_bytes,sha256,page_count,reserved_pages,state,base_revision,uploaded_at,renderer_version) VALUES(?,?,?,'private',?,'solution.pdf',?,?,1,1,'ready',0,now(),'fixture')",document,student,id,pdfKey,pdf.length,PdfLimits.hash(pdf));
   db.update("INSERT INTO submission_artifacts(id,submission_id,source_image_id,kind,bbox,state,bucket,object_key,file_name,mime_type,size_bytes,width,height,sha256,alt) VALUES(?,?,?,'student_crop','{\"x\":0,\"y\":0,\"width\":1,\"height\":1}','ready','private',?,'crop.jpg','image/jpeg',?,32,32,?,'crop')",artifact,id,image,cropKey,photo.length,PdfLimits.hash(photo));
   storage.onGet=()->db.update("UPDATE school_experts SET enabled=false WHERE user_id=?",expert);worker.execute(worker.claim());assertThat(gateway.calls.get()).isZero();assertThat(db.queryForObject("SELECT status FROM grading_submissions WHERE id=?",String.class,id)).isEqualTo("failed");assertThat(db.queryForObject("SELECT error_code FROM grading_submissions WHERE id=?",String.class,id)).isEqualTo("access_revoked");documents.reap();artifacts.reap();media.reap();assertThat(db.queryForObject("SELECT state FROM solution_documents WHERE id=?",String.class,document)).isEqualTo("ready");assertThat(db.queryForObject("SELECT state FROM submission_artifacts WHERE id=?",String.class,artifact)).isEqualTo("ready");assertThat(storage.objects.get(key)).isEqualTo(photo);assertThat(storage.objects.get(pdfKey)).isEqualTo(pdf);assertThat(storage.objects.get(cropKey)).isEqualTo(photo);db.update("UPDATE school_experts SET enabled=true WHERE user_id=?",expert);assertThat(documents.original(student,id,document).bytes()).isEqualTo(pdf);assertThat(media.read(student,false,image).bytes()).isEqualTo(photo);
 }
 @Test void expertReassignmentDuringOriginalDownloadCannotReturnPdfToFormerExpert()throws Exception{UUID id=completed(),work=work(id),document=UUID.randomUUID();byte[] bytes="%PDF-1.7 original".getBytes(java.nio.charset.StandardCharsets.US_ASCII);String key="solution/pdf-original/"+document;storage.objects.put(key,bytes);db.update("INSERT INTO solution_documents(id,user_id,submission_id,bucket,object_key,file_name,size_bytes,sha256,page_count,reserved_pages,state,base_revision,uploaded_at,renderer_version) VALUES(?,?,?,'private',?,'solution.pdf',?,?,1,1,'ready',0,now(),'fixture')",document,student,id,key,bytes.length,PdfLimits.hash(bytes));UUID replacement=account(Role.EXPERT);db.update("INSERT INTO school_experts(school_id,user_id) VALUES(?,?)",school,replacement);storage.onGet=()->db.update("UPDATE expert_students SET expert_user_id=? WHERE school_id=? AND student_user_id=?",replacement,school,student);assertThatThrownBy(()->experts.originalDocument(expertAuth,work,document)).extracting("status").isEqualTo(404);assertThat(storage.objects).containsKey(key);}
 @Test void flagOffHidesSchoolWorkAndNotificationListsWithoutDeletingItsInputs()throws Exception{UUID id=completed();String key=db.queryForObject("SELECT object_key FROM stored_objects WHERE submission_id=?",String.class,id);byte[] before=storage.objects.get(key).clone();try{org.springframework.test.util.ReflectionTestUtils.setField(config,"enabled",false);assertThat(experts.works(expertAuth,null,null,20,null).items()).isEmpty();assertThat(experts.notifications(expertAuth,0,20).path("items")).isEmpty();assertThat(experts.notifications(expertAuth,0,20).path("unreadCount").asInt()).isZero();assertThatThrownBy(()->store.get(student,id)).extracting("status").isEqualTo(404);media.reap();documents.reap();artifacts.reap();assertThat(storage.objects.get(key)).isEqualTo(before);}finally{org.springframework.test.util.ReflectionTestUtils.setField(config,"enabled",true);}assertThat(experts.works(expertAuth,null,null,20,null).items()).hasSize(1);assertThat(store.get(student,id).path("status").asText()).isEqualTo("awaiting_expert");}
 @Test void sharedImmutableTaskProjectsOnlyStatementAssetsIntoEachCurrentAssignmentRoute(){UUID shared=UUID.randomUUID(),statementAsset=UUID.randomUUID(),referenceAsset=UUID.randomUUID(),first=UUID.randomUUID(),second=UUID.randomUUID();String content=json.write(List.of(Map.of("type","text","value","Условие"),Map.of("type","image","assetId",statementAsset,"alt","Условие"),Map.of("type","image","assetId",referenceAsset,"alt","Скрытый эталон")));db.update("INSERT INTO school_tasks(id,school_id,task_number,max_score,title,statement,content,reference_answer) VALUES(?,?,16,2,'Shared','Statement',?::jsonb,'PRIVATE-REFERENCE')",shared,school,content);for(var asset:Map.of(statementAsset,"statement",referenceAsset,"reference").entrySet())db.update("INSERT INTO school_task_assets(id,school_id,task_id,kind,bucket,object_key,file_name,mime_type,size_bytes,sha256) VALUES(?,?,?,?,'private',?,'task.jpg','image/jpeg',1,'hash')",asset.getKey(),school,shared,asset.getValue(),asset.getKey().toString());for(UUID id:List.of(first,second))db.update("INSERT INTO school_assignments(id,school_id,student_user_id,task_id,title) VALUES(?,?,?,?,'Shared')",id,school,student,shared);String output=schools.detail(studentAuth,second).toString();assertThat(output).contains("/api/school/assignments/"+second+"/task-media/"+statementAsset).doesNotContain(first.toString(),referenceAsset.toString(),"PRIVATE-REFERENCE","referenceAnswer");assertThat(schools.detail(studentAuth,second).get("submission").isNull()).isTrue();}

 B2bGradingGateway.Validated response(UUID id,UUID run,long fence){var images=db.query("SELECT id,object_key,mime_type FROM stored_objects WHERE submission_id=? AND purpose='solution' AND state='ready' ORDER BY ordinal",(r,n)->new GradingGateway.Image(r.getObject("id",UUID.class),storage.get(r.getString("object_key"),8388608),r.getString("mime_type")),id);return gateway.grade(run,id,fence,origins.task(id),images,"school-package","mock");}
 @Test void b2bLeaseAllowsRealCropAfterLegacyWindowWhileFenceRemainsLive()throws Exception{UUID id=queued();var claim=worker.claim();UUID run=worker.dispatch(claim);double seconds=db.queryForObject("SELECT extract(epoch FROM lease_until-clock_timestamp()) FROM grading_jobs WHERE submission_id=?",Double.class,id);assertThat(seconds).isBetween(1190d,1200d);db.update("UPDATE grading_runs SET created_at=now()-interval '500 seconds' WHERE id=?",run);db.update("UPDATE grading_jobs SET lease_until=clock_timestamp()+interval '600 seconds' WHERE submission_id=?",id);UUID source=db.queryForObject("SELECT id FROM stored_objects WHERE submission_id=?",UUID.class,id);UUID crop=artifacts.createForSubmission(id,run,claim.fence(),source,new StudentCropper.Crop(.1,.1,.5,.5),"Реальный фрагмент");var response=response(id,run,claim.fence());worker.complete(claim,response.raw(),response.result(),response.task());assertThat(store.get(student,id).path("status").asText()).isEqualTo("awaiting_expert");assertThat(db.queryForObject("SELECT state FROM submission_artifacts WHERE id=?",String.class,crop)).isEqualTo("ready");assertThat(db.queryForObject("SELECT count(*) FROM expert_works WHERE submission_id=?",Integer.class,id)).isEqualTo(1);}
 @Test void b2bLeaseExpiryUsesActualClockEvenInsideAnOlderTransaction()throws Exception{UUID id=queued();var claim=worker.claim();UUID run=worker.dispatch(claim);var response=response(id,run,claim.fence());transactions.executeWithoutResult(t->{db.update("UPDATE grading_jobs SET lease_until=clock_timestamp()+interval '100 milliseconds' WHERE submission_id=?",id);db.execute("SELECT pg_sleep(0.15)");worker.complete(claim,response.raw(),response.result(),response.task());});assertThat(db.queryForObject("SELECT count(*) FROM grading_results WHERE submission_id=?",Integer.class,id)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM expert_works WHERE submission_id=?",Integer.class,id)).isZero();worker.reap();assertThat(db.queryForObject("SELECT error_code FROM grading_submissions WHERE id=?",String.class,id)).isEqualTo("unknown_after_dispatch");assertThat(worker.claim()).isNull();}
 @Test void b2bGradeOnlyDispatchRequiresCurrentScopePendingJobRevisionAndExactInputHash()throws Exception{UUID id=completed(),work=work(id);var doc=editable(work);var start=admit(experts.prepareGrade(expertAuth,work,UUID.randomUUID().toString(),new ExpertDtos.Save(0,doc)));assertThat(start.request().b2b()).isTrue();experts.authorizeGradeDispatch(start.jobId());db.update("UPDATE school_experts SET enabled=false WHERE user_id=?",expert);assertThatThrownBy(()->experts.authorizeGradeDispatch(start.jobId())).extracting("status").isEqualTo(404);db.update("UPDATE school_experts SET enabled=true WHERE user_id=?",expert);String original=db.queryForObject("SELECT document::text FROM expert_works WHERE id=?",String.class,work);db.update("UPDATE expert_works SET document=replace(document::text,'x=1','x=2')::jsonb WHERE id=?",work);assertThatThrownBy(()->experts.authorizeGradeDispatch(start.jobId())).extracting("code").isEqualTo("grading_stale");db.update("UPDATE expert_works SET document=?::jsonb WHERE id=?",original,work);experts.authorizeGradeDispatch(start.jobId());experts.save(expertAuth,work,new ExpertDtos.Save(1,doc),false);assertThatThrownBy(()->experts.authorizeGradeDispatch(start.jobId())).extracting("code").isEqualTo("grading_stale");}

 record Login(String session,String csrf){}
 String cookie(HttpHeaders headers,String name){return headers.getOrEmpty("Set-Cookie").stream().filter(c->c.startsWith(name+"=")).map(c->c.substring(name.length()+1,c.indexOf(';'))).findFirst().orElse(null);}
 ResponseEntity<String> http(String method,String path,Login login,Object body,String key){var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);headers.set("Cookie",(login.session==null?"":"SESSION="+login.session+"; ")+(login.csrf==null?"":"XSRF-TOKEN="+login.csrf));if(login.csrf!=null)headers.set("X-XSRF-TOKEN",login.csrf);if(key!=null)headers.set("Idempotency-Key",key);return rest.exchange(path,HttpMethod.valueOf(method),new HttpEntity<>(body==null?null:json.write(body),headers),String.class);}
 Login login(UUID id){var bootstrap=rest.getForEntity("/api/auth/csrf",String.class);String token=cookie(bootstrap.getHeaders(),"XSRF-TOKEN");var response=http("POST","/api/auth/login",new Login(null,token),Map.of("email",users.findById(id).orElseThrow().getEmail(),"password","test-password-secure"),null);assertThat(response.getStatusCode().value()).isEqualTo(200);String session=cookie(response.getHeaders(),"SESSION");var fresh=http("GET","/api/auth/csrf",new Login(session,null),null,null);return new Login(session,cookie(fresh.getHeaders(),"XSRF-TOKEN"));}
 @Test void schoolHttpCookiesCsrfOwnerIsolationAndRevocationAreEnforced()throws Exception{Login own=login(student),other=login(outsider),admin=login(account(Role.ADMIN));assertThat(http("GET","/api/school/me",own,null,null).getStatusCode().value()).isEqualTo(200);assertThat(http("GET","/api/school/assignments/"+assignment,other,null,null).getStatusCode().value()).isEqualTo(404);assertThat(http("POST","/api/school/assignments/"+assignment+"/submissions",new Login(own.session,null),Map.of(),UUID.randomUUID().toString()).getStatusCode().value()).isEqualTo(403);var created=http("POST","/api/school/assignments/"+assignment+"/submissions",own,Map.of(),UUID.randomUUID().toString());assertThat(created.getStatusCode().value()).isBetween(200,201);assertThat(created.getHeaders().getFirst("Cache-Control")).isEqualTo("private, no-store");UUID id=UUID.fromString(json.read(created.getBody()).path("id").asText());assertThat(http("GET","/api/submissions/"+id,other,null,null).getStatusCode().value()).isEqualTo(404);assertThat(http("GET","/api/admin/submissions/"+id,admin,null,null).getStatusCode().value()).isEqualTo(404);db.update("UPDATE school_students SET enabled=false WHERE school_id=? AND user_id=?",school,student);assertThat(http("GET","/api/submissions/"+id,own,null,null).getStatusCode().value()).isEqualTo(404);assertThat(http("GET","/api/school/assignments/"+assignment,own,null,null).getStatusCode().value()).isEqualTo(404);}

 @Test void productionNonNullMapperPreservesCanonicalNullsAndOptionalAbsenceThroughPersistenceHttpAndGradeOnly()throws Exception{
   // This injected codec uses application.yaml, not a test-created NON_NULL mapper.
   assertThat(json.write(Collections.singletonMap("probe",null))).isEqualTo("{}");
   UUID id=queued();var claim=worker.claim();UUID run=worker.dispatch(claim);var response=response(id,run,claim.fence());
   var independent=tools.jackson.databind.json.JsonMapper.builder().build();
   var canonical=(ObjectNode)json.read(independent.writeValueAsString(response.result().feedback()));canonical.put("origin","structured_ai");
   ((ObjectNode)canonical.path("ocr").path("blocks").get(0)).set("content",json.read("""
     {"type":"step","lines":[],"diagram":{"type":"number_line_v2","variable":"x","note":null,
       "points":[{"id":"p1","value":"0","included":null,"sign":null,"bound":true},
                 {"id":"p2","value":"\\\\sqrt{2}","included":true,"sign":"0"}],
       "arcs":[{"from":"-inf","to":"p1","sign":null,"selected":false}]}}
     """));
   ((ObjectNode)canonical.get("analysis")).set("findings",json.read("""
     [{"id":"f1","block_ids":["legacy-ocr-1"],"kind":"warning","code":null,
       "description":"Проверь границу","where":null,"correct_version":null,"advice":null}]
     """));
   var feedback=independent.convertValue(canonical,Map.class);
   worker.complete(claim,response.raw(),new AiResponseValidator.Validated(true,2,null,feedback,true),response.task());
   UUID work=work(id);assertCanonicalNulls(json.read(db.queryForObject("SELECT feedback::text FROM grading_results WHERE submission_id=?",String.class,id)));
   assertCanonicalNulls(json.read(db.queryForObject("SELECT ai_document::text FROM expert_works WHERE id=?",String.class,work)));
   Login expertLogin=login(expert),studentLogin=login(student);
   var read=http("GET","/api/expert/works/"+work,expertLogin,null,null);assertThat(read.getStatusCode().value()).isEqualTo(200);
   assertCanonicalNulls(json.read(read.getBody()).get("aiResult"));assertCanonicalNulls(json.read(read.getBody()).get("review"));
   var hidden=json.read(http("GET","/api/submissions/"+id,studentLogin,null,null).getBody());assertThat(hidden.has("result")).isTrue();assertThat(hidden.get("result").isNull()).isTrue();
   var doc=editable(work);var saved=http("PUT","/api/expert/works/"+work+"/draft",expertLogin,Map.of("expectedRevision",0,"document",doc),null);
   assertThat(saved.getStatusCode().value()).isEqualTo(200);assertCanonicalNulls(json.read(saved.getBody()).get("review"));
   var start=admit(experts.prepareGrade(expertAuth,work,UUID.randomUUID().toString(),new ExpertDtos.Save(1,doc)));
   assertCanonicalNulls(json.read(db.queryForObject("SELECT document::text FROM expert_grading_jobs WHERE id=?",String.class,start.jobId())));
   var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);server.start();
   var captured=new java.util.concurrent.atomic.AtomicReference<JsonNode>();
   try{
     server.createContext("/internal/v2/grading/grade-analysis",exchange->{
       captured.set(json.read(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)));
       for(var header:Map.of("X-Request-ID",start.jobId().toString(),"X-Grading-Contract-Version","expert-grading.v1","X-Grading-Provider-Mode","mock","X-Grading-Package-Id","school-package","Content-Type","application/json","Cache-Control","no-store").entrySet())exchange.getResponseHeaders().set(header.getKey(),header.getValue());
       byte[] body="{\"grading\":{\"score\":2,\"criterion\":\"Критерий\",\"explanation\":\"Верно\"}}".getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();
     });
     var wire=new HttpExpertGradingGateway("http://127.0.0.1:"+server.getAddress().getPort(),"test-only");
     org.springframework.test.util.ReflectionTestUtils.setField(wire,"b2bConfig",config);
     org.springframework.test.util.ReflectionTestUtils.setField(wire,"dispatchScopes",experts);
     org.springframework.test.util.ReflectionTestUtils.setField(wire,"b2bGateway",new B2bGradingGateway(){public Map<Integer,GradingGateway.Capability> capabilities(){return gateway.capabilities();}public boolean gradeAnalysisAvailable(){return true;}public Validated grade(UUID a,UUID b,long c,TaskSnapshot d,List<GradingGateway.Image> e,String f,String g){throw new AssertionError("No OCR");}});
     var graded=wire.grade(start.request());assertAnalysisNulls(captured.get().get("analysis"));
     assertThat(captured.get().path("task").has("reference_solution")).isTrue();assertThat(captured.get().path("task").get("reference_solution").isNull()).isTrue();
     assertThat(captured.get().has("ocr")).isFalse();experts.finishGrade(expertAuth,start,graded);
   }finally{server.stop(0);}
   doc=editable(work);assertCanonicalNulls(doc);int revision=db.queryForObject("SELECT revision FROM expert_works WHERE id=?",Integer.class,work);
   var sent=http("POST","/api/expert/works/"+work+"/send",expertLogin,Map.of("expectedRevision",revision,"document",doc),null);
   assertThat(sent.getStatusCode().value()).isEqualTo(200);assertCanonicalNulls(json.read(sent.getBody()).get("review"));
   assertCanonicalNulls(json.read(http("GET","/api/submissions/"+id,studentLogin,null,null).getBody()).get("result"));
   assertCanonicalNulls(json.read(http("GET","/api/school/assignments/"+assignment+"/result",studentLogin,null,null).getBody()).get("result"));
   for(String stored:db.queryForList("SELECT document::text FROM expert_review_versions WHERE work_id=?",String.class,work))assertCanonicalNulls(json.read(stored));
 }
 void assertCanonicalNulls(JsonNode doc){var diagram=doc.path("ocr").path("blocks").get(0).path("content").path("diagram");assertThat(diagram.has("note")).isTrue();assertThat(diagram.get("note").isNull()).isTrue();var point=diagram.path("points").get(0);for(String key:List.of("included","sign")){assertThat(point.has(key)).isTrue();assertThat(point.get(key).isNull()).isTrue();}assertThat(point.get("bound").asBoolean()).isTrue();assertThat(diagram.path("points").get(1).has("bound")).isFalse();assertThat(diagram.path("arcs").get(0).has("sign")).isTrue();assertThat(diagram.path("arcs").get(0).get("sign").isNull()).isTrue();assertAnalysisNulls(doc.get("analysis"));}
 void assertAnalysisNulls(JsonNode analysis){for(String key:List.of("student_answer")){assertThat(analysis.has(key)).isTrue();assertThat(analysis.get(key).isNull()).isTrue();}var finding=analysis.path("findings").get(0);assertThat(finding.has("penalty")).isFalse();for(String key:List.of("code","where","correct_version","advice")){assertThat(finding.has(key)).isTrue();assertThat(finding.get(key).isNull()).isTrue();}}
 ExpertService.GradeStart admit(ExpertService.GradeStart start){assertThat(start.request()).isNull();assertThat(start.replay().path("gradeJob").path("state").asText()).isEqualTo("queued");assertThat(db.queryForObject("SELECT deadline_at IS NULL FROM expert_grading_jobs WHERE id=?",Boolean.class,start.jobId())).isTrue();var admitted=scheduler.claimNext(1);assertThat(admitted.id()).isEqualTo(start.jobId());return experts.admittedGrade(start.jobId()).started();}
 @Test void durableGradeOnlyQueueWaitsBehindPhotoThenStartsDeadlineExactlyOnce()throws Exception{
  UUID submission=completed(),workId=work(submission);var doc=editable(workId);
  // Create an older full-photo queue entry from another assignment.
  UUID nextAssignment=UUID.randomUUID();db.update("INSERT INTO school_assignments(id,school_id,student_user_id,task_id,title) VALUES(?,?,?,?,'Next')",nextAssignment,school,student,task);assignment=nextAssignment;UUID photo=queued();
  var grade=experts.prepareGrade(expertAuth,workId,UUID.randomUUID().toString(),new ExpertDtos.Save(0,doc));
  assertThat(grade.request()).isNull();assertThat(grade.replay().path("gradeJob").path("state").asText()).isEqualTo("queued");
  var admitted=scheduler.claimNext(1);assertThat(admitted.kind()).isEqualTo("photo");assertThat(admitted.id()).isEqualTo(photo);
  assertThat(scheduler.claimNext(1)).isNull();assertThat(db.queryForObject("SELECT deadline_at IS NULL FROM expert_grading_jobs WHERE id=?",Boolean.class,grade.jobId())).isTrue();
  worker.execute(new GradingWorker.Claim(admitted.id(),admitted.fence()));
  var next=scheduler.claimNext(1);assertThat(next.kind()).isEqualTo("expert");assertThat(next.id()).isEqualTo(grade.jobId());
  assertThat(db.queryForObject("SELECT deadline_at>clock_timestamp() FROM expert_grading_jobs WHERE id=?",Boolean.class,grade.jobId())).isTrue();assertThat(scheduler.claimNext(1)).isNull();
  assertThatThrownBy(()->db.update("UPDATE expert_grading_jobs SET state='queued',deadline_at=NULL WHERE id=?",grade.jobId())).isInstanceOf(org.springframework.dao.DataAccessException.class);
  experts.failGrade(grade.jobId(),"unknown","unknown_after_dispatch");assertThat(scheduler.claimNext(1)).isNull();
 }
 @Test void fullAndGradeOnlyShareBacklogLimitBeforeAnyWriteOrCharge()throws Exception{
  UUID first=completed(),workId=work(first);var doc=editable(workId);
  int baseline=db.queryForObject("SELECT (SELECT count(*) FROM grading_jobs WHERE state<>'done')+(SELECT count(*) FROM expert_grading_jobs WHERE state='queued' OR(state IN('pending','unknown') AND deadline_at>clock_timestamp()))",Integer.class);
  org.springframework.test.util.ReflectionTestUtils.setField(submissions,"queueLimit",baseline+1);org.springframework.test.util.ReflectionTestUtils.setField(experts,"queueLimit",baseline+1);
  try {
   assignment=UUID.randomUUID();db.update("INSERT INTO school_assignments(id,school_id,student_user_id,task_id,title) VALUES(?,?,?,?,'Queue')",assignment,school,student,task);UUID photo=queued();
   assertThatThrownBy(()->experts.prepareGrade(expertAuth,workId,UUID.randomUUID().toString(),new ExpertDtos.Save(0,doc))).extracting("code").isEqualTo("queue_full");
   assertThat(db.queryForObject("SELECT revision FROM expert_works WHERE id=?",Integer.class,workId)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM expert_grading_jobs WHERE work_id=?",Integer.class,workId)).isZero();
   worker.execute(worker.claim());experts.prepareGrade(expertAuth,workId,UUID.randomUUID().toString(),new ExpertDtos.Save(0,doc));
   assignment=UUID.randomUUID();db.update("INSERT INTO school_assignments(id,school_id,student_user_id,task_id,title) VALUES(?,?,?,?,'Queue2')",assignment,school,student,task);UUID rejected=create();media.upload(student,rejected,image());
   assertThatThrownBy(()->submissions.finalizeSubmission(student,rejected,1)).extracting("code").isEqualTo("queue_full");
   assertThat(db.queryForObject("SELECT count(*) FROM grading_jobs WHERE submission_id=?",Integer.class,rejected)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM billing_test_usage WHERE submission_id=?",Integer.class,rejected)).isZero();assertThat(db.queryForObject("SELECT count(*) FROM submission_events WHERE submission_id=? AND event_type='queued'",Integer.class,rejected)).isZero();
  }finally{org.springframework.test.util.ReflectionTestUtils.setField(submissions,"queueLimit",100);org.springframework.test.util.ReflectionTestUtils.setField(experts,"queueLimit",100);}
 }
 @Test void gradeOnlyFailureDiagnosticsSurviveDurableOutcome()throws Exception{
  UUID submission=completed(),workId=work(submission);var grade=experts.prepareGrade(expertAuth,workId,UUID.randomUUID().toString(),new ExpertDtos.Save(0,editable(workId)));admit(grade);
  var failure=Map.<String,Object>of("category","model_response","diagnosticCode",602,"reasonCode","provider_output_truncated","phase","grading","attempt",4,"maxAttempts",4);
  experts.failGrade(grade.jobId(),"failed","expert_grading_provider_error",failure);
  var stored=experts.gradeJob(expertAuth,workId,grade.jobId()).path("gradeJob");assertThat(stored.path("failure").path("diagnosticCode").asInt()).isEqualTo(602);assertThat(stored.path("failure").path("phase").asText()).isEqualTo("grading");assertThat(stored.path("state").asText()).isEqualTo("failed");
 }
 @Test void queuedGradeChangedByExpertIsRejectedBeforeModelDispatch()throws Exception{
  UUID submission=completed(),workId=work(submission);var doc=editable(workId);
  var grade=experts.prepareGrade(expertAuth,workId,UUID.randomUUID().toString(),new ExpertDtos.Save(0,doc));
  experts.save(expertAuth,workId,new ExpertDtos.Save(1,doc),false);
  assertThat(scheduler.claimNext(1).id()).isEqualTo(grade.jobId());
  assertThatThrownBy(()->experts.admittedGrade(grade.jobId())).extracting("code").isEqualTo("grading_stale");
 }

}
