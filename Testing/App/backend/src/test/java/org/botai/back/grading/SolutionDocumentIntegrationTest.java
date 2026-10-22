package org.botai.back.grading;

import org.botai.back.attempt.*;
import org.botai.back.catalog.CatalogRepository;
import org.botai.back.common.ApiException;
import org.botai.back.media.*;
import org.botai.back.media.port.*;
import org.botai.back.user.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.*;
import org.springframework.mock.web.MockMultipartFile;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.*;
import java.util.concurrent.*;
import java.io.*;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties={"spring.docker.compose.enabled=false","management.server.port=0","app.grading.worker-enabled=false","app.pdf.worker-enabled=false"})
@Testcontainers
class SolutionDocumentIntegrationTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    static final byte[] PDF="%PDF-1.7\nOriginal untouched bytes\n%%EOF".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    static class Storage extends GradingIntegrationTest.TestStorage {
        volatile String gatePrefix; volatile int failPage; int pagePuts;
        @Override public void put(String key,byte[] bytes,String mime){if(gatePrefix!=null&&key.startsWith(gatePrefix)){entered.countDown();try{if(!release.await(10,TimeUnit.SECONDS))throw new IllegalStateException("Gate timeout");}catch(InterruptedException e){throw new IllegalStateException(e);}}if(key.startsWith("solution/pdf-pages/")&&++pagePuts==failPage)throw new IllegalStateException("Partial upload");objects.put(key,bytes);}
    }
    static class Renderer implements PdfRenderer {
        volatile int count=2; volatile String code; volatile int budget; volatile CountDownLatch entered,release;
        public boolean available(){return true;}
        public Rendered render(UUID id,byte[] bytes,String sha,int remaining){assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isFalse();assertThat(bytes).isEqualTo(PDF);budget=remaining;if(entered!=null){entered.countDown();try{release.await(10,TimeUnit.SECONDS);}catch(InterruptedException e){throw new IllegalStateException(e);}}if(code!=null)throw new ApiException(422,code,"fixture");var pages=new ArrayList<Page>();for(int n=1;n<=count;n++)pages.add(new Page(n,32,32,jpeg(n)));return new Rendered("pdf-raster.v1",pages);}
    }
    static class Gateway extends GradingIntegrationTest.TestGateway {
        volatile List<Image> received;
        @Override public Response grade(UUID run,org.botai.back.catalog.TaskSnapshot task,List<Image> images,String pinned){received=images;return super.grade(run,task,images,pinned);}
    }
    @TestConfiguration static class Ports {
        @Bean @Primary Storage storage(){return new Storage();}
        @Bean @Primary Renderer renderer(){return new Renderer();}
        @Bean @Primary Gateway gateway(){return new Gateway();}
    }
    @Autowired SolutionDocumentService documents;@Autowired SubmissionStore store;@Autowired SubmissionService submissions;@Autowired AttemptService attempts;@Autowired MediaService media;@Autowired UserRepository users;@Autowired Storage storage;@Autowired Renderer renderer;@Autowired Gateway gateway;@Autowired GradingWorker worker;
    UUID user,submission;
    @BeforeEach void setup(){storage.objects.clear();storage.gatePrefix=null;storage.failPage=0;storage.pagePuts=0;renderer.count=2;renderer.code=null;renderer.entered=null;renderer.release=null;gateway.calls.set(0);gateway.received=null;user=users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}test").build()).getId();store.db().update("UPDATE users SET plan_id='pro' WHERE id=?",user);var a=attempts.startTraining(user,UUID.randomUUID().toString(),new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(16,null,1)),null,"catalog",null));submission=UUID.fromString(submissions.create(user,UUID.randomUUID().toString(),new SubmissionService.Intent(a.id(),a.items().getFirst().id(),0,null)).path("id").asText());}
    static byte[] jpeg(int n){try{var out=new ByteArrayOutputStream();var image=new BufferedImage(32,32,BufferedImage.TYPE_INT_RGB);image.setRGB(n,n,0xffffff);ImageIO.write(image,"jpeg",out);return out.toByteArray();}catch(IOException e){throw new IllegalStateException(e);}}
    MockMultipartFile pdf(){return new MockMultipartFile("file","solution.pdf","application/pdf",PDF);}
    UUID upload(){return UUID.fromString(documents.upload(user,submission,pdf()).path("id").asText());}
    UUID photo(){return UUID.fromString(media.upload(user,submission,new MockMultipartFile("file","photo.jpg","image/jpeg",jpeg(1))).path("id").asText());}
    String state(UUID id){return store.db().queryForObject("SELECT state FROM solution_documents WHERE id=?",String.class,id);}
    List<String> keys(UUID id){var keys=store.db().queryForList("SELECT object_key FROM stored_objects WHERE source_document_id=?",String.class,id);keys.add(store.db().queryForObject("SELECT object_key FROM solution_documents WHERE id=?",String.class,id));return keys;}
    void absent(UUID id){assertThat(store.db().queryForObject("SELECT count(*) FROM stored_objects WHERE source_document_id=? AND state='ready'",Integer.class,id)).isZero();for(String key:keys(id))assertThat(storage.objects).doesNotContainKey(key);}
    @Test void originalAndOrderedPagesArePrivateAtomicAndOnlyJpegsReachAi(){UUID id=upload();assertThat(state(id)).isEqualTo("processing");assertThat(store.get(user,submission).path("images")).isEmpty();assertThatThrownBy(()->submissions.finalizeSubmission(user,submission,0)).extracting("code").isEqualTo("uploads_in_flight");documents.execute(documents.claim());assertThat(state(id)).isEqualTo("ready");var result=store.get(user,submission);assertThat(result.path("revision").asInt()).isEqualTo(1);assertThat(result.path("images")).hasSize(2);assertThat(result.path("documents").get(0).path("pages").get(1).path("pageNumber").asInt()).isEqualTo(2);assertThat(documents.original(user,submission,id).bytes()).isEqualTo(PDF);for(var page:store.db().queryForList("SELECT object_key,sha256,size_bytes FROM stored_objects WHERE source_document_id=? AND state='ready'",id)){var actual=storage.objects.get(page.get("object_key"));assertThat(page.get("sha256")).isEqualTo(PdfLimits.hash(actual));assertThat(((Number)page.get("size_bytes")).longValue()).isEqualTo((long)actual.length);}assertThatThrownBy(()->documents.original(UUID.randomUUID(),submission,id)).extracting("status").isEqualTo(404);assertThatThrownBy(()->media.read(user,false,id)).extracting("status").isEqualTo(404);submissions.finalizeSubmission(user,submission,1);worker.execute(worker.claim());assertThat(gateway.received).hasSize(2);assertThat(gateway.received).allSatisfy(image->assertThat(image.mimeType()).isEqualTo("image/jpeg"));assertThat(gateway.calls).hasValue(1);assertThat(store.get(user,submission).path("status").asText()).isEqualTo("graded");}
    @Test void reservationCountsExistingPhotoAndPreventsParallelUploads(){photo();UUID id=upload();assertThatThrownBy(this::photo).extracting("code").isEqualTo("image_count");assertThatThrownBy(this::upload).extracting("code").isEqualTo("pdf_busy");documents.execute(documents.claim());assertThat(renderer.budget).isEqualTo(3);assertThat(store.get(user,submission).path("images")).hasSize(3);assertThat(state(id)).isEqualTo("ready");}
    @Test void rejectsWholeOverBudgetGroup(){photo();renderer.count=4;UUID id=upload();documents.execute(documents.claim());assertThat(state(id)).isEqualTo("failed");absent(id);assertThat(store.get(user,submission).path("images")).hasSize(1);}
    @Test void failedPdfBlocksPartialPhotoFinalizeUntilDeleted(){photo();renderer.code="pdf_encrypted";UUID id=upload();documents.execute(documents.claim());assertThat(state(id)).isEqualTo("failed");assertThatThrownBy(()->submissions.finalizeSubmission(user,submission,1)).extracting("code").isEqualTo("pdf_failed");assertThat(gateway.calls).hasValue(0);assertThat(store.db().queryForObject("SELECT count(*) FROM grading_jobs WHERE submission_id=?",Integer.class,submission)).isZero();documents.delete(user,submission,id);assertThat(submissions.finalizeSubmission(user,submission,2).path("status").asText()).isEqualTo("queued");submissions.cancel(user,submission);}
    @Test void partialStorageFailurePublishesNoPagesAndCleansAllKeys(){storage.failPage=2;UUID id=upload();documents.execute(documents.claim());assertThat(state(id)).isEqualTo("failed");absent(id);assertThat(store.get(user,submission).path("images")).isEmpty();}
    @Test void deleteDerivedPageDeletesWholePdfButKeepsPhoto(){UUID photo=photo();UUID id=upload();documents.execute(documents.claim());UUID page=store.db().queryForObject("SELECT id FROM stored_objects WHERE source_document_id=? AND page_number=1",UUID.class,id);media.delete(user,submission,page);assertThat(state(id)).isEqualTo("deleted");absent(id);assertThat(store.get(user,submission).path("documents")).isEmpty();assertThat(store.get(user,submission).path("images").get(0).path("id").asText()).isEqualTo(photo.toString());}
    @Test void cancelledOriginalPutCannotResurrectDeletedGroup()throws Exception {storage.gatePrefix="solution/pdf-original/";storage.entered=new CountDownLatch(1);storage.release=new CountDownLatch(1);try(var executor=Executors.newVirtualThreadPerTaskExecutor()){var pending=executor.submit(this::upload);assertThat(storage.entered.await(5,TimeUnit.SECONDS)).isTrue();UUID id=store.db().queryForObject("SELECT id FROM solution_documents WHERE submission_id=?",UUID.class,submission);documents.delete(user,submission,id);documents.reap();storage.release.countDown();assertThatThrownBy(()->pending.get(5,TimeUnit.SECONDS)).hasCauseInstanceOf(ApiException.class);assertThat(state(id)).isEqualTo("deleted");absent(id);assertThat(store.get(user,submission).path("documents")).isEmpty();}finally{storage.release.countDown();}}
    @Test void cancelledLatePagePutIsRecleanedAfterLostFence()throws Exception {UUID id=upload();storage.gatePrefix="solution/pdf-pages/";storage.entered=new CountDownLatch(1);storage.release=new CountDownLatch(1);var claim=documents.claim();try(var executor=Executors.newVirtualThreadPerTaskExecutor()){var pending=executor.submit(()->documents.execute(claim));assertThat(storage.entered.await(5,TimeUnit.SECONDS)).isTrue();documents.delete(user,submission,id);documents.reap();storage.release.countDown();pending.get(5,TimeUnit.SECONDS);assertThat(state(id)).isEqualTo("deleted");absent(id);}finally{storage.release.countDown();}}
    @Test void expiredLeaseIsFailedAndNeverReclaimed(){UUID id=upload();documents.claim();store.db().update("UPDATE solution_documents SET lease_until=now()-interval '1 second' WHERE id=?",id);documents.reap();assertThat(documents.claim()).isNull();assertThat(state(id)).isEqualTo("failed");absent(id);}
    @Test void expiredLeaseCannotPublishEvenBeforeReaper(){UUID id=upload();var claim=documents.claim();store.db().update("UPDATE solution_documents SET lease_until=now()-interval '1 second' WHERE id=?",id);documents.execute(claim);assertThat(state(id)).isEqualTo("failed");absent(id);assertThat(store.get(user,submission).path("documents").get(0).path("errorCode").asText()).isEqualTo("pdf_conversion_abandoned");}
    @Test void deletedAttemptReapsReadyOriginalAndPages(){UUID id=upload();documents.execute(documents.claim());attempts.delete(user,store.row(submission,user,false).attempt());documents.reap();assertThat(state(id)).isEqualTo("deleted");absent(id);assertThatThrownBy(()->documents.original(user,submission,id)).extracting("status").isEqualTo(404);}
    @Test void disabledOwnerCannotPublishPages(){UUID id=upload();var claim=documents.claim();store.db().update("UPDATE users SET enabled=false WHERE id=?",user);documents.execute(claim);assertThat(state(id)).isEqualTo("failed");absent(id);}
    @Test void staleRevisionCannotPublishAnyPages(){UUID id=upload();var claim=documents.claim();store.db().update("UPDATE grading_submissions SET revision=revision+1 WHERE id=?",submission);documents.execute(claim);assertThat(state(id)).isEqualTo("failed");absent(id);}
}
