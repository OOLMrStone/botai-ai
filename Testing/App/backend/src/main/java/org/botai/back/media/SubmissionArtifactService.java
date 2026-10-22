package org.botai.back.media;

import lombok.RequiredArgsConstructor;
import org.botai.back.b2b.SubmissionOrigins;
import org.botai.back.common.*;
import org.botai.back.expert.ExpertService;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.media.port.ObjectStorage;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import java.util.*;

@Service
@RequiredArgsConstructor
public class SubmissionArtifactService {
    private final org.botai.back.b2b.B2bConfig config;
    private final ExpertService experts;
    private final SubmissionOrigins origins;
    private final SubmissionStore store;
    private final ObjectStorage storage;
    private final StudentCropper cropper;
    private final TransactionTemplate tx;
    public record Proposal(UUID sourceImageId,StudentCropper.Crop crop,String alt) { }
    private record Reserved(UUID id,UUID submission,UUID source,String key) { }
    public Map<String,Object> create(Authentication auth,UUID work,Proposal request) {
        return create(()->experts.requireArtifactWork(auth,work,true),"/api/expert/works/"+work,request);
    }
    /** Trusted grading worker boundary: the model never supplies the issued artifact UUID or storage key. */
    public UUID createForSubmission(UUID submission,UUID run,long fence,UUID source,StudentCropper.Crop crop,String alt) {
        if(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive())throw new IllegalStateException("Crop IO must run outside the grading completion transaction");
        var result=create(()->{requireWorker(submission,run,fence);return submission;},"/api/submissions/"+submission,new Proposal(source,crop,alt));
        return (UUID)result.get("id");
    }
    private void requireWorker(UUID submission,UUID run,long fence) {
        var row=store.row(submission,null,true);
        if(!origins.b2b(submission)||!origins.valid(submission,true)||!row.status().equals("running"))throw ApiException.notFound();
        if(store.db().queryForObject("SELECT count(*) FROM grading_jobs WHERE submission_id=? AND run_id=? AND fencing_token=? AND state='dispatching' AND lease_until>clock_timestamp()",Integer.class,submission,run,fence)!=1)throw ApiException.conflict("artifact_stale");
    }
    private Map<String,Object> create(java.util.function.Supplier<UUID> scope,String prefix,Proposal request) {
        if(request==null||request.sourceImageId==null||request.alt==null||request.alt.length()>200)throw invalid();StudentCropper.validate(request.crop);
        var source=tx.execute(t->{UUID submission=scope.get();return source(submission,request.sourceImageId);});
        byte[] bytes;try{bytes=storage.get(source.get("object_key").toString(),8*1024*1024);}catch(RuntimeException unavailable){throw storageError();}
        if(!PdfLimits.hash(bytes).equals(source.get("sha256")))throw storageError();
        var image=cropper.crop(bytes,request.crop);
        Reserved reserved=tx.execute(t->{UUID submission=scope.get();source(submission,request.sourceImageId);
            store.db().queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?::text,882116))",submission.toString());
            int count=store.db().queryForObject("SELECT count(*) FROM submission_artifacts WHERE submission_id=? AND state IN('staged','ready')",Integer.class,submission);
            long pixels=store.db().queryForObject("SELECT coalesce(sum(width::bigint*height),0) FROM submission_artifacts WHERE submission_id=? AND state IN('staged','ready')",Long.class,submission);
            if(count>=16||pixels+(long)image.width()*image.height()>24_000_000)throw new ApiException(422,"artifact_budget","Слишком много фрагментов");
            UUID id=UUID.randomUUID();String key="solution/artifacts/"+UUID.randomUUID();
            store.db().update("INSERT INTO submission_artifacts(id,submission_id,source_image_id,kind,bbox,state,bucket,object_key,file_name,mime_type,size_bytes,width,height,sha256,alt) VALUES(?,?,?,'student_crop',?::jsonb,'staged',?,?,'student-crop.jpg','image/jpeg',?,?,?,?,?)",id,submission,request.sourceImageId,store.json().write(request.crop),storage.bucket(),key,image.bytes().length,image.width(),image.height(),PdfLimits.hash(image.bytes()),request.alt);
            return new Reserved(id,submission,request.sourceImageId,key);
        });
        boolean ready=false;
        try {
            storage.put(reserved.key,image.bytes(),"image/jpeg");
            tx.executeWithoutResult(t->{UUID submission=scope.get();if(!submission.equals(reserved.submission))throw ApiException.notFound();source(submission,reserved.source);
                if(store.db().update("UPDATE submission_artifacts SET state='ready' WHERE id=? AND state='staged'",reserved.id)!=1)throw ApiException.conflict("artifact_stale");});
            ready=true;return dto(reserved.id,prefix+"/artifacts/"+reserved.id+"/preview",image.width(),image.height());
        } finally {if(!ready){store.db().update("UPDATE submission_artifacts SET state='delete_pending' WHERE id=? AND state IN('staged','ready')",reserved.id);cleanup(reserved.id,reserved.key);}}
    }
    private Map<String,Object> source(UUID submission,UUID id) {
        var rows=store.db().queryForList("SELECT object_key,sha256 FROM stored_objects WHERE id=? AND submission_id=? AND purpose='solution' AND state='ready' AND mime_type='image/jpeg' FOR SHARE",id,submission);
        if(rows.isEmpty())throw ApiException.notFound();return rows.getFirst();
    }
    private Map<String,Object> artifact(UUID submission,UUID id) {
        var rows=store.db().queryForList("SELECT a.object_key,a.sha256,a.size_bytes FROM submission_artifacts a JOIN stored_objects o ON o.id=a.source_image_id AND o.submission_id=a.submission_id WHERE a.id=? AND a.submission_id=? AND a.kind='student_crop' AND a.state='ready' AND o.purpose='solution' AND o.state='ready'",id,submission);
        if(rows.isEmpty())throw ApiException.notFound();return rows.getFirst();
    }
    public MediaService.Content expertPreview(Authentication auth,UUID work,UUID artifact) {
        var row=tx.execute(t->artifact(experts.requireArtifactWork(auth,work,false),artifact));byte[] bytes=read(row);
        tx.executeWithoutResult(t->artifact(experts.requireArtifactWork(auth,work,false),artifact));return new MediaService.Content(bytes,"image/jpeg");
    }
    /** Run controller resolves the run; this boundary independently rechecks current operator and exact submission. */
    public MediaService.Content operatorPreview(UUID operator,UUID submission,UUID id) {
        var row=tx.execute(t->{requireOperator(operator,submission);return artifact(submission,id);});
        byte[] bytes=read(row);tx.executeWithoutResult(t->{requireOperator(operator,submission);artifact(submission,id);});return new MediaService.Content(bytes,"image/jpeg");
    }
    private void requireOperator(UUID operator,UUID submission) {
        config.requireOperator(operator);
        if(store.db().queryForObject("SELECT count(*) FROM users WHERE id=? AND enabled AND role='EXPERT'",Integer.class,operator)!=1)throw ApiException.notFound();
        if(!origins.b2b(submission)||!origins.valid(submission,false))throw ApiException.notFound();
        var target=store.db().queryForMap("SELECT origin,user_id,school_assignment_id FROM grading_submissions WHERE id=?",submission);
        if("local_demo".equals(target.get("origin"))){if(!operator.equals(target.get("user_id")))throw ApiException.notFound();}
        else if(!"school".equals(target.get("origin"))||store.db().queryForObject("SELECT count(*) FROM school_assignments a JOIN expert_students es ON es.school_id=a.school_id AND es.student_user_id=a.student_user_id WHERE a.id=? AND es.expert_user_id=?",Integer.class,target.get("school_assignment_id"),operator)!=1)throw ApiException.notFound();
    }
    public MediaService.Content ownerPreview(UUID owner,UUID submission,UUID id) {
        var row=tx.execute(t->{requireFinal(owner,submission,id);return artifact(submission,id);});byte[] bytes=read(row);
        tx.executeWithoutResult(t->{requireFinal(owner,submission,id);artifact(submission,id);});return new MediaService.Content(bytes,"image/jpeg");
    }
    private void requireFinal(UUID owner,UUID submission,UUID id) {
        if(origins.b2b(submission))origins.requireOwner(owner,submission,false);else store.row(submission,owner,false);
        var rows=store.db().queryForList("SELECT w.document FROM expert_works w JOIN schools sc ON sc.id=w.school_id AND sc.enabled JOIN school_students ss ON ss.school_id=w.school_id AND ss.user_id=w.student_user_id AND ss.enabled JOIN expert_students es ON es.school_id=w.school_id AND es.student_user_id=w.student_user_id AND es.expert_user_id=w.expert_user_id JOIN school_experts se ON se.school_id=w.school_id AND se.user_id=w.expert_user_id AND se.enabled JOIN users su ON su.id=w.student_user_id AND su.enabled JOIN users eu ON eu.id=w.expert_user_id AND eu.enabled WHERE w.submission_id=? AND w.student_user_id=? AND w.status='sent'",submission,owner);
        for(var row:rows)if(referenced(store.json().read(row.get("document").toString()),id))return;throw ApiException.notFound();
    }
    public static boolean referenced(JsonNode document,UUID id) {
        if(document==null||!document.isObject()||!document.path("schema_version").asText().equals("expert-review.v2"))return false;
        for(var block:document.path("ocr").path("blocks")) {
            var content=block.path("content");if(content.path("type").asText().equals("image")&&imageId(content,id))return true;
            if(content.path("type").asText().equals("step")&&imageId(content.path("image"),id))return true;
        }return false;
    }
    private static boolean imageId(JsonNode leaf,UUID id){return leaf.isObject()&&leaf.path("type").asText().equals("image")&&leaf.path("artifact_id").asText().equals(id.toString());}
    private byte[] read(Map<String,Object> row){try{byte[] bytes=storage.get(row.get("object_key").toString(),8*1024*1024);if(bytes.length!=((Number)row.get("size_bytes")).longValue()||!PdfLimits.hash(bytes).equals(row.get("sha256")))throw storageError();return bytes;}catch(RuntimeException e){throw storageError();}}
    public static Map<String,Object> dto(UUID id,String preview,int width,int height){return Map.of("id",id,"mimeType","image/jpeg","previewUrl",preview,"width",width,"height",height);}
    private UUID cleanupCursor;
    @Scheduled(fixedDelayString="${app.media.reap-ms:60000}") public void reap(){
        // Revocation/feature shutdown only denies access; it does not authorize deletion.
        store.db().update("UPDATE submission_artifacts a SET state='delete_pending' FROM grading_submissions s,stored_objects o WHERE a.submission_id=s.id AND o.id=a.source_image_id AND a.state IN('ready','staged') AND (s.status IN('cancelled','expired') OR o.state IN('delete_pending','deleted'))");
        // Metadata precedes every put; failed or abandoned reservations remain independently reapable.
        store.db().update("UPDATE submission_artifacts SET state='delete_pending' WHERE state='staged' AND created_at<now()-interval '10 minutes'");
        for(var row:store.db().queryForList("SELECT id,object_key FROM submission_artifacts WHERE state='delete_pending' ORDER BY created_at,id LIMIT 100"))cleanup((UUID)row.get("id"),row.get("object_key").toString());
        // Reconcile retained tombstones against a late storage put after process loss.
        var tombstones=store.db().queryForList("SELECT id,object_key FROM submission_artifacts WHERE state='deleted' AND created_at>now()-interval '30 minutes' AND (?::uuid IS NULL OR id>?::uuid) ORDER BY id LIMIT 100",cleanupCursor,cleanupCursor);
        for(var row:tombstones)cleanup((UUID)row.get("id"),row.get("object_key").toString());
        cleanupCursor=tombstones.size()<100?null:(UUID)tombstones.getLast().get("id");
    }
    private void cleanup(UUID id,String key){try{storage.delete(key);store.db().update("UPDATE submission_artifacts SET state='deleted' WHERE id=? AND state IN('delete_pending','deleted')",id);}catch(RuntimeException ignored){}}
    private static ApiException invalid(){return new ApiException(400,"validation_error","Некорректный фрагмент изображения");}
    private static ApiException storageError(){return new ApiException(503,"storage_unavailable","Фрагмент временно недоступен");}
}
