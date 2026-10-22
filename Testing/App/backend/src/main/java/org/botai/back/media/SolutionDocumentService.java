package org.botai.back.media;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.*;
import org.botai.back.b2b.SubmissionOrigins;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.media.port.*;
import org.botai.back.security.RateLimits;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;
import java.util.*;

@Service
@RequiredArgsConstructor
public class SolutionDocumentService {
    private static final long ADMISSION_LOCK=726118117L;
    private final SubmissionOrigins origins;
    private final SubmissionStore store;
    private final ObjectStorage storage;
    private final PdfRenderer renderer;
    private final ImageNormalizer normalizer;
    private final TransactionTemplate tx;
    private final RateLimits rates;
    public record Claim(UUID id,UUID submission,UUID user,String key,String sha,int pages,int revision,long fence) { }
    public record Original(byte[] bytes,String fileName) { }
    private record PageObject(UUID id,String key,int number) { }

    public JsonNode upload(UUID user,UUID submission,MultipartFile file) {
        if(!renderer.available()) throw problem(503,"pdf_renderer_unavailable");
        tx.executeWithoutResult(t->{var s=owner(submission,user,true);store.draft(s);if(origins.b2b(submission))origins.requireInput(submission);else if(s.version()==null)throw ApiException.conflict("invalid_target");});
        rates.check("pdf-upload",user.toString(),6,60);
        byte[] bytes;
        try(var input=file.getInputStream()) { bytes=input.readNBytes(PdfLimits.INPUT_BYTES+1); }
        catch(java.io.IOException failure) { throw problem(422,"pdf_invalid"); }
        if(bytes.length>PdfLimits.INPUT_BYTES) throw problem(413,"file_size");
        if(bytes.length<5 || !new String(bytes,0,5,java.nio.charset.StandardCharsets.US_ASCII).equals("%PDF-")) throw problem(422,"pdf_invalid");
        UUID document=UUID.randomUUID(); String key="solution/pdf-original/"+UUID.randomUUID();
        tx.executeWithoutResult(t->{
            var s=owner(submission,user,true);store.draft(s);if(origins.b2b(submission))origins.requireInput(submission);
            store.db().execute("SELECT pg_advisory_xact_lock("+ADMISSION_LOCK+")");
            if(store.db().queryForObject("SELECT count(*) FROM solution_documents WHERE user_id=? AND state='processing'",Integer.class,user)>0) throw problem(429,"pdf_busy");
            if(store.db().queryForObject("SELECT count(*) FROM solution_documents WHERE state='processing'",Integer.class)>=8) throw problem(429,"pdf_busy");
            int remaining=PdfLimits.PAGES-store.db().queryForObject("SELECT count(*) FROM stored_objects WHERE submission_id=? AND purpose='solution' AND state IN('staged','ready')",Integer.class,submission);
            if(remaining<1) throw problem(422,"pdf_page_budget");
            int ordinal=store.db().queryForObject("SELECT coalesce(max(ordinal),-1)+1 FROM stored_objects WHERE submission_id=?",Integer.class,submission);
            store.db().update("INSERT INTO solution_documents(id,user_id,submission_id,bucket,object_key,file_name,size_bytes,sha256,reserved_pages,state,base_revision) VALUES(?,?,?,?,?,?,?,?,?,'processing',?)",document,user,submission,storage.bucket(),key,name(file),bytes.length,PdfLimits.hash(bytes),remaining,s.revision());
            for(int i=1;i<=remaining;i++) store.db().update("INSERT INTO stored_objects(id,user_id,submission_id,purpose,bucket,object_key,state,file_name,ordinal,source_document_id,page_number) VALUES(?,?,?,'solution',?,?,'staged',?,?,?,?)",UUID.randomUUID(),user,submission,storage.bucket(),"solution/pdf-pages/"+UUID.randomUUID(),"pdf-page-"+i+".jpg",ordinal+i-1,document,i);
            store.event(submission,"pdf_upload_reserved",user,Map.of("documentId",document,"reservedPages",remaining));
        });
        boolean published=false;
        try {
            storage.put(key,bytes,"application/pdf");
            published=Boolean.TRUE.equals(tx.execute(t->{
                var s=store.row(submission,null,true);var documentRow=lock(document);
                if(!valid(s,documentRow) || !documentRow.get("state").equals("processing")) { if(documentRow.get("state").equals("processing"))failLocked(documentRow,failureCode(s,"upload_revision_conflict"),false);return false; }
                store.db().update("UPDATE solution_documents SET uploaded_at=now(),updated_at=now() WHERE id=?",document);return true;
            }));
            if(!published) throw ApiException.conflict("upload_revision_conflict");
            return get(user,submission,document);
        } catch(RuntimeException failure) {
            fail(document,failure instanceof ApiException api?api.code():"storage_unavailable",false);
            throw failure instanceof ApiException api?api:problem(503,"storage_unavailable");
        } finally { if(!published) cleanup(document); }
    }
    public JsonNode get(UUID owner,UUID submission,UUID document) {
        owner(submission,owner,false);
        for(JsonNode value:list(submission)) if(value.path("id").asText().equals(document.toString())) return value;
        throw ApiException.notFound();
    }
    public JsonNode list(UUID submission) { return store.json().read(store.db().queryForObject("SELECT solution_documents_json(?)::text",String.class,submission)); }
    public Original original(UUID owner,UUID submission,UUID document) {
        var row=tx.execute(t->{owner(submission,owner,false);var values=store.db().queryForList("SELECT * FROM solution_documents WHERE id=? AND submission_id=? AND user_id=? AND state='ready' FOR SHARE",document,submission,owner);if(values.isEmpty())throw ApiException.notFound();return values.getFirst();});
        try { byte[] bytes=storage.get(row.get("object_key").toString(),PdfLimits.INPUT_BYTES);if(bytes.length!=(Integer)row.get("size_bytes") || !PdfLimits.hash(bytes).equals(row.get("sha256")))throw new IllegalStateException("Original integrity");return checkedOriginal(owner,submission,bytes,row.get("file_name").toString()); }
        catch(ApiException failure) {throw failure;}
        catch(Exception failure) { throw problem(503,"storage_unavailable"); }
    }
    private Original checkedOriginal(UUID owner,UUID submission,byte[] bytes,String name){if(origins.b2b(submission))tx.executeWithoutResult(t->origins.requireOwner(owner,submission,false));return new Original(bytes,name);}
    public void delete(UUID owner,UUID submission,UUID document) {
        tx.executeWithoutResult(t->{var s=owner(submission,owner,true);store.draft(s);var row=lock(document);if(!row.get("submission_id").equals(submission)||!row.get("user_id").equals(owner))throw ApiException.notFound();
            if(Set.of("delete_pending","deleted").contains(row.get("state")))return;
            failLocked(row,"pdf_deleted",true);store.db().update("UPDATE grading_submissions SET revision=revision+1,updated_at=now() WHERE id=?",submission);store.touchAttempt(s.attempt());store.event(submission,"pdf_deleted",owner,Map.of("documentId",document));});
        cleanup(document);
    }
    public Claim claim() {
        if(!renderer.available())return null;
        return tx.execute(t->{
            store.db().execute("SELECT pg_advisory_xact_lock("+ADMISSION_LOCK+")");
            if(store.db().queryForObject("SELECT count(*) FROM solution_documents WHERE state='processing' AND lease_until>now()",Integer.class)>0)return null;
            var rows=store.db().queryForList("SELECT * FROM solution_documents WHERE state='processing' AND uploaded_at IS NOT NULL AND lease_until IS NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
            if(rows.isEmpty())return null;var row=rows.getFirst();UUID id=(UUID)row.get("id");long fence=(Long)row.get("fencing_token")+1;
            store.db().update("UPDATE solution_documents SET fencing_token=?,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=?",fence,id);
            return new Claim(id,(UUID)row.get("submission_id"),(UUID)row.get("user_id"),row.get("object_key").toString(),row.get("sha256").toString(),(Integer)row.get("reserved_pages"),(Integer)row.get("base_revision"),fence);
        });
    }
    public void execute(Claim claim) {
        boolean committed=false;
        try {
            boolean allowed=Boolean.TRUE.equals(tx.execute(t->{var s=store.row(claim.submission,null,true);var row=lock(claim.id);return row.get("state").equals("processing")&&row.get("fencing_token").equals(claim.fence)&&valid(s,row);}));
            if(!allowed)throw problem(409,"upload_revision_conflict");
            byte[] original=storage.get(claim.key,PdfLimits.INPUT_BYTES);if(!PdfLimits.hash(original).equals(claim.sha))throw problem(422,"pdf_invalid");
            var rendered=renderer.render(claim.id,original,claim.sha,claim.pages);
            if(rendered.pages().isEmpty()||rendered.pages().size()>claim.pages||!rendered.version().equals("pdf-raster.v1"))throw problem(502,"pdf_invalid_renderer_response");
            var objects=objects(claim.id);var normalized=new ArrayList<ImageNormalizer.Normalized>();
            for(int i=0;i<rendered.pages().size();i++) {
                var page=rendered.pages().get(i);if(page.number()!=i+1||page.bytes().length>PdfLimits.INPUT_BYTES)throw problem(502,"pdf_invalid_renderer_response");
                var image=normalizer.normalizePdf(new java.io.ByteArrayInputStream(page.bytes()));
                if(!image.mimeType().equals("image/jpeg")||image.width()!=page.width()||image.height()!=page.height()||image.width()>PdfLimits.PAGE_SIDE||image.height()>PdfLimits.PAGE_SIDE||(long)image.width()*image.height()>PdfLimits.PAGE_PIXELS)throw problem(502,"pdf_invalid_renderer_response");
                normalized.add(image);storage.put(objects.get(i).key,image.bytes(),image.mimeType());
            }
            committed=Boolean.TRUE.equals(tx.execute(t->{
                var s=store.row(claim.submission,null,true);var row=lock(claim.id);
                if(!row.get("state").equals("processing")||!row.get("fencing_token").equals(claim.fence)||!valid(s,row)) { if(row.get("state").equals("processing"))failLocked(row,failureCode(s,"upload_revision_conflict"),false);return false; }
                if(store.db().queryForObject("SELECT count(*) FROM solution_documents WHERE id=? AND lease_until>clock_timestamp()",Integer.class,claim.id)!=1) {failLocked(row,"pdf_conversion_abandoned",false);return false;}
                if(store.db().queryForObject("SELECT count(*) FROM stored_objects WHERE source_document_id=? AND state='staged'",Integer.class,claim.id)!=objects.size()) {failLocked(row,failureCode(s,"upload_revision_conflict"),false);return false;}
                for(int i=0;i<normalized.size();i++) {var image=normalized.get(i);store.db().update("UPDATE stored_objects SET state='ready',mime_type=?,size_bytes=?,width=?,height=?,sha256=? WHERE id=?",image.mimeType(),image.bytes().length,image.width(),image.height(),PdfLimits.hash(image.bytes()),objects.get(i).id);}
                store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE source_document_id=? AND page_number>?",claim.id,normalized.size());
                store.db().update("UPDATE solution_documents SET state='ready',page_count=?,renderer_version=?,updated_at=now() WHERE id=?",normalized.size(),rendered.version(),claim.id);
                store.db().update("UPDATE grading_submissions SET revision=revision+1,error_code=NULL,updated_at=now() WHERE id=?",claim.submission);store.touchAttempt(s.attempt());
                store.event(claim.submission,"pdf_ready",claim.user,Map.of("documentId",claim.id,"pages",normalized.size()));return true;
            }));
        } catch(Exception failure) { fail(claim.id,failure instanceof ApiException api?api.code():"storage_unavailable",false); }
        finally { if(!committed)cleanup(claim.id); }
    }
    private SubmissionStore.Row owner(UUID submission,UUID user,boolean lock){if(origins.b2b(submission))origins.requireOwner(user,submission,lock);return store.row(submission,user,lock);}
    private boolean valid(SubmissionStore.Row s,Map<String,Object> row) {
        return s.status().equals("draft") && s.revision()==(Integer)row.get("base_revision")
            && Boolean.TRUE.equals(store.db().queryForObject("SELECT enabled FROM users WHERE id=? FOR SHARE",Boolean.class,s.user()))
            && (origins.b2b(s.id())?origins.valid(s.id(),true):store.db().queryForObject("SELECT count(*) FROM attempts WHERE id=coalesce(?,?) AND deleted_at IS NULL",Integer.class,s.attempt(),s.requestedAttempt())==1);
    }
    private Map<String,Object> lock(UUID id) {var rows=store.db().queryForList("SELECT * FROM solution_documents WHERE id=? FOR UPDATE",id);if(rows.isEmpty())throw ApiException.notFound();return rows.getFirst();}
    private List<PageObject> objects(UUID id) {return store.db().query("SELECT id,object_key,page_number FROM stored_objects WHERE source_document_id=? ORDER BY page_number",(r,n)->new PageObject(r.getObject("id",UUID.class),r.getString("object_key"),r.getInt("page_number")),id);}
    private void fail(UUID id,String code,boolean deleted) {tx.executeWithoutResult(t->{var rows=store.db().queryForList("SELECT submission_id FROM solution_documents WHERE id=?",id);if(rows.isEmpty())return;var s=store.row((UUID)rows.getFirst().get("submission_id"),null,true);var row=lock(id);if(row.get("state").equals("processing"))failLocked(row,deleted?code:failureCode(s,code),deleted);});}
    private String failureCode(SubmissionStore.Row s,String fallback) {
        // A stopped conversion may discard its staged pages, but revocation never discards the accepted original.
        return origins.b2b(s.id())&&!Set.of("cancelled","expired").contains(s.status())&&!origins.valid(s.id(),true)?"pdf_access_revoked":fallback;
    }
    private void failLocked(Map<String,Object> row,String code,boolean deleted) {
        store.db().update("UPDATE solution_documents SET state=?,error_code=?,fencing_token=fencing_token+1,cleanup_until=now()+interval '15 minutes',cleanup_complete=false,updated_at=now() WHERE id=?",deleted?"delete_pending":"failed",code,row.get("id"));
        store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE source_document_id=?",row.get("id"));
    }
    public void cleanup(UUID id) {
        var rows=store.db().queryForList("SELECT object_key,state,error_code FROM solution_documents WHERE id=?",id);if(rows.isEmpty()||rows.getFirst().get("state").equals("ready")||rows.getFirst().get("state").equals("processing"))return;
        boolean all=true;
        for(var page:objects(id))try{storage.delete(page.key);store.db().update("UPDATE stored_objects SET state='deleted',deleted_at=now() WHERE id=? AND state IN('delete_pending','deleted')",page.id);}catch(Exception unavailable){all=false;}
        boolean preserveOriginal=rows.getFirst().get("state").equals("failed")&&"pdf_access_revoked".equals(rows.getFirst().get("error_code"));
        if(!preserveOriginal)try{storage.delete(rows.getFirst().get("object_key").toString());}catch(Exception unavailable){all=false;}
        if(all)store.db().update("UPDATE solution_documents SET cleanup_complete=true,state=CASE WHEN state='delete_pending' THEN 'deleted' ELSE state END WHERE id=?",id);
    }
    private UUID reapCursor;
    public void reap() {
        // Authorization failures stop processing while retaining accepted originals; ready history is not revoked by deletion.
        var candidates=store.db().queryForList("SELECT d.id,d.submission_id FROM solution_documents d LEFT JOIN grading_submissions s ON s.id=d.submission_id LEFT JOIN attempts a ON a.id=coalesce(s.attempt_id,s.requested_attempt_id) WHERE d.state IN('ready','processing','failed') AND (s.status IN('cancelled','expired') OR (s.origin='b2c' AND a.deleted_at IS NOT NULL) OR d.state='processing') AND (?::uuid IS NULL OR d.id>?::uuid) ORDER BY d.id LIMIT 100",reapCursor,reapCursor);
        for(var candidate:candidates) {
            tx.executeWithoutResult(t->{UUID submission=(UUID)candidate.get("submission_id");var s=store.row(submission,null,true);var row=lock((UUID)candidate.get("id"));
                boolean deleted=Set.of("cancelled","expired").contains(s.status())||(!origins.b2b(submission)&&store.db().queryForObject("SELECT count(*) FROM attempts WHERE id=coalesce(?,?) AND deleted_at IS NOT NULL",Integer.class,s.attempt(),s.requestedAttempt())==1);
                if(Set.of("ready","failed").contains(row.get("state"))&&deleted)failLocked(row,"pdf_deleted",true);
                if(row.get("state").equals("processing")) {
                    boolean expired=store.db().queryForObject("SELECT count(*) FROM solution_documents WHERE id=? AND ((uploaded_at IS NULL AND created_at<now()-interval '10 minutes') OR (lease_until IS NULL AND created_at<now()-interval '45 minutes') OR lease_until<now())",Integer.class,row.get("id"))>0;
                    if(!valid(s,row)||expired)failLocked(row,failureCode(s,"pdf_conversion_abandoned"),false);
                }
            });
        }
        reapCursor=candidates.size()<100?null:(UUID)candidates.getLast().get("id");
        for(var row:store.db().queryForList("SELECT id FROM solution_documents WHERE state IN('failed','delete_pending','deleted') AND (NOT cleanup_complete OR cleanup_until>now()) LIMIT 100"))cleanup((UUID)row.get("id"));
    }
    private String name(MultipartFile file) {String value=file.getOriginalFilename();if(value==null||value.isBlank())value="solution.pdf";value=value.replaceAll("[\\p{Cntrl}/\\\\]","_");return value.substring(0,Math.min(200,value.length()));}
    private static ApiException problem(int status,String code) {return new ApiException(status,code,"Не удалось принять PDF решения");}
}
