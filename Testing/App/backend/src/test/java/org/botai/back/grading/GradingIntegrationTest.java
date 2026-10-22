package org.botai.back.grading;

import org.botai.back.attempt.*;
import org.botai.back.catalog.*;
import org.botai.back.common.*;
import org.botai.back.grading.port.GradingGateway;
import org.botai.back.media.*;
import org.botai.back.media.port.ObjectStorage;
import org.botai.back.user.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.*;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.io.*;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import static org.assertj.core.api.Assertions.*;

@org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"spring.docker.compose.enabled=false","management.server.port=0","app.grading.worker-enabled=false"})
@Testcontainers
class GradingIntegrationTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    @TestConfiguration static class Ports {
        @Bean @Primary TestStorage testStorage(){return new TestStorage();}
        @Bean @Primary TestGateway testGateway(){return new TestGateway();}
    }
    static class TestStorage implements ObjectStorage {
        Map<String,byte[]> objects=new ConcurrentHashMap<>();volatile boolean fail;volatile CountDownLatch entered,release;
        public void put(String key,byte[] bytes,String mime){if(entered!=null){entered.countDown();try{if(!release.await(10,TimeUnit.SECONDS))throw new IllegalStateException("Upload timeout");}catch(InterruptedException e){throw new IllegalStateException(e);}}if(fail)throw new IllegalStateException();objects.put(key,bytes);}
        public byte[] get(String key,long cap){if(fail||!objects.containsKey(key))throw new IllegalStateException();return objects.get(key);}
        public void delete(String key){if(fail)throw new IllegalStateException();objects.remove(key);}
        public String bucket(){return "test-private";}
    }
    static class TestGateway implements GradingGateway {
        AtomicInteger calls=new AtomicInteger();volatile boolean rejected,malformed;
        public Map<Integer,Capability> capabilities(){var map=new HashMap<Integer,Capability>();int[] max={2,3,2,2,3,4,4};for(int n=14;n<=20;n++)map.put(n,new Capability(n,max[n-14],n==16,n==16?"digest":null,"mock"));return map;}
        public Response grade(UUID run,TaskSnapshot task,List<Image> images,String pinned){calls.incrementAndGet();return new Response(malformed?"{}":AiResponseValidatorTest.body(task,images,!rejected),"mock","digest",rejected?"unreadable":null);}
    }
    @Autowired SubmissionStore store;@Autowired SubmissionService submissions;@Autowired GradingWorker worker;@Autowired AttemptService attempts;@Autowired CatalogService catalog;@Autowired MediaService media;@Autowired UserRepository users;@Autowired TestStorage storage;@Autowired TestGateway gateway;@Autowired TransactionTemplate tx;
    @Autowired org.springframework.boot.resttestclient.TestRestTemplate rest;
    @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;
    UUID user;
    record Login(String session,String csrf) {}
    String cookie(org.springframework.http.HttpHeaders headers,String name){return headers.getOrEmpty("Set-Cookie").stream().filter(c->c.startsWith(name+"=")).map(c->c.substring(name.length()+1,c.indexOf(';'))).findFirst().orElse(null);}
    Login login(UUID id){var u=users.findById(id).orElseThrow();store.db().update("UPDATE users SET password_hash=? WHERE id=?",passwords.encode("test-secure-password"),id);var bootstrap=rest.getForEntity("/api/auth/csrf",String.class);String csrf=cookie(bootstrap.getHeaders(),"XSRF-TOKEN");var response=http("POST","/api/auth/login",new Login(null,csrf),Map.of("email",u.getEmail(),"password","test-secure-password"));assertThat(response.getStatusCode().value()).isEqualTo(200);String session=cookie(response.getHeaders(),"SESSION");var fresh=http("GET","/api/auth/csrf",new Login(session,null),null);return new Login(session,cookie(fresh.getHeaders(),"XSRF-TOKEN"));}
    org.springframework.http.ResponseEntity<String> http(String method,String path,Login login,Object body){var headers=new org.springframework.http.HttpHeaders();headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);headers.set("Cookie",(login.session==null?"":"SESSION="+login.session+"; ")+(login.csrf==null?"":"XSRF-TOKEN="+login.csrf));if(login.csrf!=null)headers.set("X-XSRF-TOKEN",login.csrf);return rest.exchange(path,org.springframework.http.HttpMethod.valueOf(method),new org.springframework.http.HttpEntity<>(body==null?null:store.json().write(body),headers),String.class);}

    @BeforeEach void setup(){storage.fail=false;storage.entered=null;storage.release=null;gateway.rejected=false;gateway.malformed=false;gateway.calls.set(0);user=users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}test").build()).getId();store.db().update("UPDATE users SET plan_id='pro' WHERE id=?",user);}
    AttemptDtos.Attempt attempt(int number){return attempts.startTraining(user,UUID.randomUUID().toString(),new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(number,null,1)),null,"catalog",null));}
    UUID intent(AttemptDtos.Attempt attempt){return UUID.fromString(submissions.create(user,UUID.randomUUID().toString(),new SubmissionService.Intent(attempt.id(),attempt.items().getFirst().id(),0,null)).path("id").asText());}
    MockMultipartFile image()throws Exception{var out=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(32,32,BufferedImage.TYPE_INT_RGB),"png",out);return new MockMultipartFile("file","answer.png","image/png",out.toByteArray());}
    UUID queued()throws Exception{UUID id=intent(attempt(16));media.upload(user,id,image());submissions.finalizeSubmission(user,id,1);return id;}
    @Test void durableInvalidTargetOwnershipAndPayloadConflict(){String key=UUID.randomUUID().toString();var input=new SubmissionService.Intent(UUID.randomUUID(),UUID.randomUUID(),0,null);var first=submissions.create(user,key,input);assertThat(first.path("status").asText()).isEqualTo("rejected");assertThat(first.path("result").isNull()).isTrue();assertThat(submissions.create(user,key,input).path("id")).isEqualTo(first.path("id"));assertThatThrownBy(()->submissions.create(user,key,new SubmissionService.Intent(UUID.randomUUID(),input.attemptItemId(),0,null))).isInstanceOf(ApiException.class);assertThatThrownBy(()->store.get(UUID.randomUUID(),UUID.fromString(first.path("id").asText()))).isInstanceOf(ApiException.class).extracting("status").isEqualTo(404);assertThat(store.db().queryForObject("SELECT count(*) FROM submission_events WHERE submission_id=?",Integer.class,UUID.fromString(first.path("id").asText()))).isGreaterThanOrEqualTo(2);}
    @Test void uploadsFailureAndOwnershipAreDurable()throws Exception{UUID id=intent(attempt(16));assertThatThrownBy(()->media.upload(user,id,new MockMultipartFile("file","bad.svg","image/png","<svg/>".getBytes()))).isInstanceOf(ApiException.class);assertThat(store.db().queryForObject("SELECT count(*) FROM submission_events WHERE submission_id=? AND event_type='upload_rejected'",Integer.class,id)).isEqualTo(1);storage.fail=true;assertThatThrownBy(()->media.upload(user,id,image())).isInstanceOf(ApiException.class);storage.fail=false;media.reap();assertThat(store.get(user,id).path("images")).isEmpty();var attachment=media.upload(user,id,image());UUID imageId=UUID.fromString(attachment.path("id").asText());assertThatThrownBy(()->media.read(UUID.randomUUID(),false,imageId)).isInstanceOf(ApiException.class);assertThat(media.read(user,false,imageId).bytes()).isNotEmpty();assertThatThrownBy(()->submissions.finalizeSubmission(user,id,0)).isInstanceOf(ApiException.class);}
    @Test void repeatedFinalizeTwoWorkersAndDemoProgress()throws Exception{UUID id=queued();submissions.finalizeSubmission(user,id,1);assertThat(store.db().queryForObject("SELECT count(*) FROM grading_jobs WHERE submission_id=?",Integer.class,id)).isEqualTo(1);try(var exec=Executors.newFixedThreadPool(2)){var claims=exec.invokeAll(List.<Callable<GradingWorker.Claim>>of(worker::claim,worker::claim));var actual=new ArrayList<GradingWorker.Claim>();for(var c:claims){var v=c.get();if(v!=null)actual.add(v);}assertThat(actual).hasSize(1);worker.execute(actual.getFirst());}assertThat(gateway.calls.get()).isEqualTo(1);assertThat(store.get(user,id).path("status").asText()).isEqualTo("graded");assertThat(store.get(user,id).path("result").path("isDemo").asBoolean()).isTrue();assertThat(store.db().queryForObject("SELECT count(*) FROM user_task_results WHERE user_id=?",Integer.class,user)).isZero();assertThat(store.get(user,id).toString()).doesNotContain("reference_answer","exactResponse");}
    @Test void staleWorkerCannotDispatchAndPostDispatchCrashNeverRequeues()throws Exception{UUID id=queued();var old=worker.claim();store.db().update("UPDATE grading_jobs SET lease_until=now()-interval '1 second' WHERE submission_id=?",id);worker.reap();var fresh=worker.claim();assertThat(worker.dispatch(old)).isNull();assertThat(worker.dispatch(fresh)).isNotNull();store.db().update("UPDATE grading_jobs SET lease_until=now()-interval '1 second' WHERE submission_id=?",id);worker.reap();assertThat(worker.claim()).isNull();assertThat(store.get(user,id).path("errorCode").asText()).isEqualTo("unknown_after_dispatch");assertThat(gateway.calls.get()).isZero();}
    @Test void cancellationFencesLateResultAndRejectionHasNoZero()throws Exception{UUID id=queued();var claim=worker.claim();UUID run=worker.dispatch(claim);assertThat(run).isNotNull();submissions.cancel(user,id);worker.complete(claim,new GradingGateway.Response("{}","mock","digest",null),new AiResponseValidator.Validated(true,2,null,Map.of(),true));assertThat(store.get(user,id).path("status").asText()).isEqualTo("cancelled");assertThat(store.db().queryForObject("SELECT count(*) FROM grading_results WHERE submission_id=?",Integer.class,id)).isZero();UUID rejected=queued();gateway.rejected=true;worker.execute(worker.claim());assertThat(store.get(user,rejected).path("status").asText()).isEqualTo("rejected");assertThat(store.get(user,rejected).path("result").path("score").isNull()).isTrue();}
    @Test void unsupportedEntitlementInvalidAiAndShortAnswers()throws Exception{UUID unsupported=intent(attempt(14));media.upload(user,unsupported,image());assertThat(submissions.finalizeSubmission(user,unsupported,1).path("status").asText()).isEqualTo("unsupported");UUID id=intent(attempt(16));media.upload(user,id,image());store.db().update("UPDATE users SET plan_id='free' WHERE id=?",user);assertThatThrownBy(()->submissions.finalizeSubmission(user,id,1)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("ai_review_required");store.db().update("UPDATE users SET plan_id='pro' WHERE id=?",user);submissions.finalizeSubmission(user,id,1);gateway.malformed=true;worker.execute(worker.claim());assertThat(store.get(user,id).path("status").asText()).isEqualTo("failed");assertThat(store.get(user,id).path("result").isNull()).isTrue();var a=attempt(7);var item=a.items().getFirst();String answer=catalog.snapshot(item.task().taskVersionId()).acceptedAnswers().getFirst();var changed=attempts.patch(user,a.id(),new AttemptDtos.Patch(0,null,List.of(new AttemptDtos.ItemPatch(item.id()," "+answer+" ",null))));String key=UUID.randomUUID().toString();var result=submissions.checks(user,a.id(),key,new SubmissionService.Check(changed.revision(),null));assertThat(result.status()).isEqualTo("completed");assertThat(result.summary().earnedPoints()).isEqualTo(1);assertThat(submissions.checks(user,a.id(),key,new SubmissionService.Check(changed.revision(),null)).summary().graded()).isEqualTo(1);}
    @Test void unfinishedCollectionsSurviveLogoutAndResumeExactDraftsAndPhotos()throws Exception {
        var first=attempts.startTraining(user,UUID.randomUUID().toString(),new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(7,null,2)),null,"catalog",null));
        var second=attempt(16);var exam=attempts.startExam(user,attempts.exams(user,null,10).items().getFirst().id(),UUID.randomUUID().toString());
        var drawing=store.json().read("[{\"id\":\"stroke1\",\"points\":[{\"x\":12,\"y\":24}]}]");
        first=attempts.patch(user,first.id(),new AttemptDtos.Patch(first.revision(),1,List.of(new AttemptDtos.ItemPatch(first.items().getFirst().id(),"2",drawing))));
        first=submissions.checks(user,first.id(),UUID.randomUUID().toString(),new SubmissionService.Check(first.revision(),List.of(first.items().getFirst().id())));
        assertThat(first.status()).isEqualTo("active");assertThat(first.summary().graded()).isEqualTo(1);
        UUID submission=intent(second);var image=media.upload(user,submission,image());submissions.finalizeSubmission(user,submission,1);second=attempts.get(user,second.id());assertThat(second.status()).isEqualTo("checking");
        exam=attempts.patch(user,exam.id(),new AttemptDtos.Patch(0,13,List.of(new AttemptDtos.ItemPatch(exam.items().get(13).id(),"черновик",drawing))));
        Login logged=login(user);var before=http("GET","/api/attempts?status=unfinished&limit=2",logged,null);assertThat(before.getStatusCode().value()).isEqualTo(200);var page=store.json().read(before.getBody());assertThat(page.path("items")).hasSize(2);assertThat(page.path("items").get(0).path("id").asText()).isEqualTo(exam.id().toString());assertThat(page.path("nextCursor").isTextual()).isTrue();
        var next=store.json().read(http("GET","/api/attempts?status=unfinished&limit=2&cursor="+page.path("nextCursor").asText(),logged,null).getBody());assertThat(next.path("items")).hasSize(1);
        assertThat(http("POST","/api/auth/logout",logged,null).getStatusCode().value()).isEqualTo(200);assertThat(http("GET","/api/attempts/"+first.id(),logged,null).getStatusCode().value()).isEqualTo(401);
        logged=login(user);for(var expected:List.of(first,second,exam)){var actual=store.json().read(http("GET","/api/attempts/"+expected.id(),logged,null).getBody());assertThat(actual).isEqualTo(store.json().read(store.json().write(expected)));}
        assertThat(http("GET",image.path("previewUrl").asText(),logged,null).getHeaders().getFirst("Cache-Control")).isEqualTo("private, no-store");
        UUID foreign=users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}x").build()).getId();Login other=login(foreign);assertThat(store.json().read(http("GET","/api/attempts?status=unfinished",other,null).getBody()).path("items")).isEmpty();assertThat(http("GET","/api/attempts/"+first.id(),other,null).getStatusCode().value()).isEqualTo(404);assertThat(http("GET",image.path("previewUrl").asText(),other,null).getStatusCode().value()).isEqualTo(404);
        submissions.cancel(user,submission);assertThat(attempts.get(user,second.id()).status()).isEqualTo("active");
    }
    @Test void adminAuditCurrentRoleAndAvatarOwnership()throws Exception {
        UUID id=intent(attempt(16));var attached=media.upload(user,id,image());UUID imageId=UUID.fromString(attached.path("id").asText());
        Login regular=login(user);assertThat(http("GET","/api/admin/submissions/"+id,regular,null).getStatusCode().value()).isEqualTo(403);
        store.db().update("UPDATE users SET role='ADMIN' WHERE id=?",user);Login admin=login(user);assertThat(http("GET","/api/admin/submissions/"+id,admin,null).getStatusCode().value()).isEqualTo(200);assertThat(http("GET","/api/media/"+imageId,admin,null).getStatusCode().value()).isEqualTo(200);assertThat(store.db().queryForObject("SELECT count(*) FROM admin_access_events WHERE actor_id=?",Integer.class,user)).isEqualTo(2);
        store.db().update("UPDATE users SET role='USER' WHERE id=?",user);assertThat(http("GET","/api/admin/submissions/"+id,admin,null).getStatusCode().value()).isEqualTo(403);assertThat(http("GET","/api/media/"+imageId,admin,null).getStatusCode().value()).isEqualTo(401);
        var avatar=media.avatar(user,image());UUID avatarId=UUID.fromString(avatar.get("avatarUrl").toString().substring("/api/media/".length()));assertThat(media.read(user,false,avatarId).bytes()).isNotEmpty();assertThatThrownBy(()->media.read(UUID.randomUUID(),false,avatarId)).isInstanceOf(ApiException.class);media.removeAvatar(user);media.reap();assertThatThrownBy(()->media.read(user,false,avatarId)).isInstanceOf(ApiException.class);
    }

    @Test void stagedUploadReservationsBoundConcurrencyAndPreventFinalize()throws Exception {
        UUID id=intent(attempt(16));storage.entered=new CountDownLatch(4);storage.release=new CountDownLatch(1);
        try(var executor=Executors.newFixedThreadPool(4)){
            var futures=new ArrayList<Future<Boolean>>();for(int i=0;i<4;i++)futures.add(executor.submit(()->{try{media.upload(user,id,image());return true;}catch(ApiException expected){assertThat(expected.code()).isEqualTo("upload_revision_conflict");return false;}}));
            try{assertThat(storage.entered.await(5,TimeUnit.SECONDS)).isTrue();assertThatThrownBy(()->media.upload(user,id,image())).isInstanceOf(ApiException.class).extracting("code").isEqualTo("image_count");assertThatThrownBy(()->submissions.finalizeSubmission(user,id,0)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("uploads_in_flight");}finally{storage.release.countDown();}
            int accepted=0;for(var future:futures)if(future.get(10,TimeUnit.SECONDS))accepted++;assertThat(accepted).isEqualTo(1);
        }finally{storage.entered=null;storage.release=null;}
        assertThat(store.get(user,id).path("images")).hasSize(1);assertThat(store.db().queryForObject("SELECT count(*) FROM stored_objects WHERE submission_id=? AND state='staged'",Integer.class,id)).isZero();
    }

    UUID photographed()throws Exception{UUID id=intent(attempt(16));media.upload(user,id,image());return id;}
    @Test void expiredUploadCanBeRetriedWithoutLosingOriginalPhotosOrDraft()throws Exception {
        var original=attempt(16);var item=original.items().getFirst();UUID expired=intent(original);
        var previousImage=media.upload(user,expired,image());
        store.db().update("UPDATE grading_submissions SET updated_at=now()-interval '25 hours' WHERE id=?",expired);media.reap();
        assertThat(store.get(user,expired).path("status").asText()).isEqualTo("expired");
        assertThat(store.get(user,expired).path("retryable").asBoolean()).isTrue();
        var latest=attempts.get(user,original.id());assertThat(latest.items().getFirst().submission().path("retryable").asBoolean()).isTrue();
        var drawing=store.json().read("[{\"id\":\"draft\",\"points\":[{\"x\":1,\"y\":2}]}]");
        var edited=attempts.patch(user,latest.id(),new AttemptDtos.Patch(latest.revision(),0,List.of(new AttemptDtos.ItemPatch(item.id(),null,drawing))));
        int revision=edited.items().getFirst().answerRevision();assertThat(revision).isEqualTo(1);
        String key=UUID.randomUUID().toString();var input=new SubmissionService.Intent(original.id(),item.id(),revision,expired);
        var created=submissions.create(user,key,input);UUID retry=UUID.fromString(created.path("id").asText());
        assertThat(retry).isNotEqualTo(expired);assertThat(created.path("status").asText()).isEqualTo("draft");assertThat(created.path("images")).isEmpty();
        assertThat(created.path("inputRevision").asInt()).isEqualTo(revision);assertThat(created.path("revision").asInt()).isZero();
        assertThat(submissions.create(user,key,input).path("id")).isEqualTo(created.path("id"));
        assertThatThrownBy(()->submissions.create(user,key,new SubmissionService.Intent(original.id(),item.id(),0,expired))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("idempotency_conflict");
        var uploaded=media.upload(user,retry,image());assertThat(uploaded.path("id")).isNotEqualTo(previousImage.path("id"));
        assertThatThrownBy(()->submissions.finalizeSubmission(user,retry,0)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("revision_conflict");
        assertThat(submissions.finalizeSubmission(user,retry,1).path("status").asText()).isEqualTo("queued");
        assertThat(store.get(user,expired).path("images").get(0).path("id")).isEqualTo(previousImage.path("id"));
        assertThat(media.read(user,false,UUID.fromString(previousImage.path("id").asText())).bytes()).isNotEmpty();
        assertThat(attempts.get(user,original.id()).items().getFirst().drawing()).isEqualTo(drawing);
        assertThat(store.db().queryForObject("SELECT retry_of_id FROM grading_submissions WHERE id=?",UUID.class,retry)).isEqualTo(expired);
        submissions.cancel(user,retry);
    }
    @Test void agedDraftAdmissionsChargeTodayAndRemainChargedAfterFailureOrCancellation()throws Exception {
        UUID predecessor=null;
        for(int i=0;i<30;i++){
            UUID id=photographed();predecessor=id;store.db().update("UPDATE grading_submissions SET created_at=now()-interval '25 hours' WHERE id=?",id);
            assertThat(submissions.finalizeSubmission(user,id,1).path("status").asText()).isEqualTo("queued");submissions.finalizeSubmission(user,id,1);
            if(i%2==0)submissions.cancel(user,id);else{var claim=worker.claim();assertThat(claim.submission()).isEqualTo(id);worker.fail(claim,"storage_unavailable",false);}
            assertThat(store.db().queryForObject("SELECT count(*) FROM submission_events WHERE submission_id=? AND event_type='queued'",Integer.class,id)).isEqualTo(1);
        }
        assertThat(store.db().queryForObject("SELECT count(*) FROM grading_submissions WHERE user_id=? AND package_id IS NOT NULL AND created_at>now()-interval '24 hours'",Integer.class,user)).isZero();
        UUID next=photographed();assertThatThrownBy(()->submissions.finalizeSubmission(user,next,1)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("daily_grading_limit");assertThat(store.get(user,next).path("status").asText()).isEqualTo("draft");assertThat(store.db().queryForObject("SELECT count(*) FROM grading_jobs WHERE submission_id=?",Integer.class,next)).isZero();
        var prior=store.row(predecessor,user,false);UUID retry=UUID.fromString(submissions.create(user,UUID.randomUUID().toString(),new SubmissionService.Intent(prior.attempt(),prior.item(),prior.inputRevision(),predecessor)).path("id").asText());media.upload(user,retry,image());assertThatThrownBy(()->submissions.finalizeSubmission(user,retry,1)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("daily_grading_limit");
    }
    @Test void normalAdmissionsSerializeTheThirtiethSlotAcrossConcurrentFinalizations()throws Exception {
        for(int i=0;i<29;i++){UUID id=photographed();submissions.finalizeSubmission(user,id,1);submissions.cancel(user,id);}
        List<UUID> candidates=List.of(photographed(),photographed());var start=new CountDownLatch(1);
        try(var executor=Executors.newFixedThreadPool(2)){
            var results=new ArrayList<Future<String>>();for(UUID id:candidates)results.add(executor.submit(()->{start.await();try{return submissions.finalizeSubmission(user,id,1).path("status").asText();}catch(ApiException expected){return expected.code();}}));start.countDown();
            assertThat(List.of(results.get(0).get(15,TimeUnit.SECONDS),results.get(1).get(15,TimeUnit.SECONDS))).containsExactlyInAnyOrder("queued","daily_grading_limit");
        }
        assertThat(store.db().queryForObject("SELECT count(*) FROM submission_events e JOIN grading_submissions s ON s.id=e.submission_id WHERE s.user_id=? AND e.event_type='queued'",Integer.class,user)).isEqualTo(30);for(UUID id:candidates)submissions.cancel(user,id);
    }
    @Test void oldAdmissionsExpireByImmutableEventTimeNotMutableSubmissionTimes()throws Exception {
        for(int i=0;i<30;i++){UUID id=UUID.randomUUID();store.db().update("INSERT INTO grading_submissions(id,user_id,requested_attempt_id,requested_item_id,input_revision,idempotency_key,request_hash,status,package_id,request_id) VALUES(?,?,?,?,0,?,?,'cancelled','digest',?)",id,user,UUID.randomUUID(),UUID.randomUUID(),"old:"+id,"fixture",UUID.randomUUID());store.db().update("INSERT INTO submission_events(submission_id,event_type,created_at) VALUES(?,'queued',now()-interval '25 hours')",id);}
        UUID next=photographed();assertThat(submissions.finalizeSubmission(user,next,1).path("status").asText()).isEqualTo("queued");submissions.cancel(user,next);
    }

}
