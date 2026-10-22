package org.botai.back.media;

import org.botai.back.media.port.ObjectStorage;
import org.botai.back.b2b.SubmissionOrigins;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.common.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import lombok.RequiredArgsConstructor;
import tools.jackson.databind.JsonNode;
import java.util.*;
import java.security.MessageDigest;

@Service
@RequiredArgsConstructor
public class MediaService {
    private final SubmissionOrigins origins;private final ObjectStorage storage;private final ImageNormalizer normalizer;private final SolutionDocumentService documents;private final SubmissionStore store;private final TransactionTemplate tx;
    private record Reservation(UUID id,UUID submission,String key,int revision) { }
    public JsonNode upload(UUID user,UUID submission,MultipartFile file){return upload(user,submission,file,false);}
    public JsonNode uploadFixture(UUID user,UUID submission,MultipartFile file){return upload(user,submission,file,true);}
    private JsonNode upload(UUID user,UUID submission,MultipartFile file,boolean fixture){Reservation reserved=tx.execute(t->{var s=owner(submission,user,true);store.draft(s);if(!fixture && store.db().queryForObject("SELECT count(*) FROM school_fixture_attachments WHERE submission_id=? AND NOT complete",Integer.class,submission)>0)throw ApiException.conflict("fixture_attachment_in_progress");if(origins.b2b(submission))origins.requireInput(submission);else if(s.version()==null)throw ApiException.conflict("invalid_target");if(store.db().queryForObject("SELECT count(*) FROM stored_objects WHERE submission_id=? AND purpose='solution' AND state IN('staged','ready')",Integer.class,submission)>=4){store.event(submission,"upload_rejected",user,Map.of("reason","image_count"));return null;}int ordinal=store.db().queryForObject("SELECT coalesce(max(ordinal),-1)+1 FROM stored_objects WHERE submission_id=?",Integer.class,submission);UUID id=UUID.randomUUID();String key="solution/"+UUID.randomUUID();store.db().update("INSERT INTO stored_objects(id,user_id,submission_id,purpose,bucket,object_key,state,file_name,ordinal) VALUES(?,?,?,'solution',?,?,'staged',?,?)",id,user,submission,storage.bucket(),key,name(file),ordinal);store.event(submission,"upload_staged",user,Map.of("imageId",id));return new Reservation(id,submission,key,s.revision());});
        if(reserved==null)throw new ApiException(422,"image_count","Можно добавить до четырёх изображений");
        ImageNormalizer.Normalized image;
        try{image=normalizer.normalize(file.getInputStream(),false);storage.put(reserved.key,image.bytes(),image.mimeType());}
        catch(Exception e){String code=e instanceof ApiException a?a.code():"storage_unavailable";failed(reserved,user,code);throw new ApiException(e instanceof ApiException a?a.status():503,code,"Не удалось загрузить изображение");}
        boolean accepted=tx.execute(t->{var s=store.row(submission,null,true);String state=store.db().queryForObject("SELECT state FROM stored_objects WHERE id=? FOR UPDATE",String.class,reserved.id);if(!s.status().equals("draft")||s.revision()!=reserved.revision||!state.equals("staged")||(origins.b2b(submission)&&!origins.valid(submission,true))){store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE id=?",reserved.id);store.event(submission,"upload_stale",user,Map.of("imageId",reserved.id));return false;}ready(reserved.id,image);store.db().update("UPDATE grading_submissions SET revision=revision+1,updated_at=now() WHERE id=?",submission);store.event(submission,"upload_ready",user,Map.of("imageId",reserved.id));store.touchAttempt(s.attempt());return true;});
        if(!accepted){cleanup(reserved.id,reserved.key);throw ApiException.conflict("upload_revision_conflict");}return attachment(reserved.id);
    }
    private void failed(Reservation r,UUID user,String code){tx.executeWithoutResult(t->{store.row(r.submission,null,true);store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE id=?",r.id);store.event(r.submission,"upload_rejected",user,Map.of("imageId",r.id,"reason",code));store.db().update("UPDATE grading_submissions SET error_code=?,updated_at=now() WHERE id=?",code,r.submission);});cleanup(r.id,r.key);}
    private void ready(UUID id,ImageNormalizer.Normalized image){String hash;try{hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(image.bytes()));}catch(Exception e){throw new IllegalStateException(e);}store.db().update("UPDATE stored_objects SET state='ready',mime_type=?,size_bytes=?,width=?,height=?,sha256=? WHERE id=?",image.mimeType(),image.bytes().length,image.width(),image.height(),hash,id);}
    private String name(MultipartFile f){String n=f.getOriginalFilename();if(n==null)return "image";n=n.replaceAll("[\\p{Cntrl}/\\\\]","_");return n.substring(0,Math.min(200,n.length()));}
    private JsonNode attachment(UUID id){return store.json().read(store.db().queryForObject("SELECT jsonb_build_object('id',id,'fileName',file_name,'mimeType',mime_type,'sizeBytes',size_bytes,'status',state,'previewUrl','/api/media/'||id)::text FROM stored_objects WHERE id=?",String.class,id));}
    public void delete(UUID user,UUID submission,UUID id){
        UUID document=tx.execute(t->{var s=owner(submission,user,true);store.draft(s);if(store.db().queryForObject("SELECT count(*) FROM school_fixture_attachments WHERE submission_id=? AND NOT complete",Integer.class,submission)>0)throw ApiException.conflict("fixture_attachment_in_progress");var rows=store.db().queryForList("SELECT source_document_id FROM stored_objects WHERE id=? AND submission_id=? AND user_id=? AND purpose='solution'",id,submission,user);if(rows.isEmpty())throw ApiException.notFound();return (UUID)rows.getFirst().get("source_document_id");});
        if(document!=null){documents.delete(user,submission,document);return;}
        String key=tx.execute(t->{var s=owner(submission,user,true);store.draft(s);var rows=store.db().queryForList("SELECT object_key,state FROM stored_objects WHERE id=? AND user_id=? AND submission_id=? AND purpose='solution' FOR UPDATE",id,user,submission);if(rows.isEmpty())throw ApiException.notFound();var row=rows.getFirst();if(!Set.of("ready","staged").contains(row.get("state")))return null;store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE id=?",id);store.db().update("UPDATE grading_submissions SET revision=revision+1,updated_at=now() WHERE id=?",submission);store.event(submission,"image_deleted",user,Map.of("imageId",id));store.touchAttempt(s.attempt());return (String)row.get("object_key");});if(key!=null)cleanup(id,key);}
    public record Content(byte[] bytes,String mimeType) { }
    private SubmissionStore.Row owner(UUID submission,UUID user,boolean lock){if(origins.b2b(submission))origins.requireOwner(user,submission,lock);return store.row(submission,user,lock);}
    public Content read(UUID actor,boolean admin,UUID id){
        var row=tx.execute(t->{var rows=store.db().queryForList("SELECT user_id,submission_id,purpose,object_key,mime_type,size_bytes FROM stored_objects WHERE id=? AND state='ready' AND purpose IN('solution','avatar')",id);if(rows.isEmpty())throw ApiException.notFound();var value=rows.getFirst();UUID submission=(UUID)value.get("submission_id");
            if(submission!=null&&origins.b2b(submission)){if(admin)throw ApiException.notFound();origins.requireOwner(actor,submission,false);}
            else {if(!admin&&!actor.equals(value.get("user_id")))throw ApiException.notFound();if(!admin&&submission!=null)store.row(submission,actor,false);if(admin)store.db().update("INSERT INTO admin_access_events(actor_id,action,target_id) VALUES(?,'media_read',?)",actor,id);}
            return value;});
        byte[] bytes;try{bytes=storage.get((String)row.get("object_key"),8*1024*1024);}catch(Exception e){throw new ApiException(503,"storage_unavailable","Изображение временно недоступно");}
        UUID submission=(UUID)row.get("submission_id");if(submission!=null&&origins.b2b(submission))tx.executeWithoutResult(t->origins.requireOwner(actor,submission,false));
        return new Content(bytes,(String)row.get("mime_type"));
    }
    public Map<String,Object> avatar(UUID user,MultipartFile file){var image=normalizeAvatar(file);UUID id=UUID.randomUUID();String key="avatar/"+UUID.randomUUID();tx.executeWithoutResult(t->store.db().update("INSERT INTO stored_objects(id,user_id,purpose,bucket,object_key,state,file_name) VALUES(?,?,'avatar',?,?,'staged','avatar.jpg')",id,user,storage.bucket(),key));try{storage.put(key,image.bytes(),image.mimeType());}catch(Exception e){store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE id=?",id);throw new ApiException(503,"storage_unavailable","Не удалось сохранить аватар");}
        tx.executeWithoutResult(t->{var rows=store.db().queryForList("SELECT avatar_object_id FROM users WHERE id=? FOR UPDATE",user);UUID old=(UUID)rows.getFirst().get("avatar_object_id");ready(id,image);store.db().update("UPDATE users SET avatar_object_id=?,updated_at=now() WHERE id=?",id,user);if(old!=null)store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE id=?",old);});return Map.of("avatarUrl","/api/media/"+id);}
    private ImageNormalizer.Normalized normalizeAvatar(MultipartFile f){try{return normalizer.normalize(f.getInputStream(),true);}catch(java.io.IOException e){throw new ApiException(422,"decode_failed","Не удалось прочитать изображение");}}
    public Map<String,Object> removeAvatar(UUID user){tx.executeWithoutResult(t->{var rows=store.db().queryForList("SELECT avatar_object_id FROM users WHERE id=? FOR UPDATE",user);UUID id=(UUID)rows.getFirst().get("avatar_object_id");store.db().update("UPDATE users SET avatar_object_id=NULL,updated_at=now() WHERE id=?",user);if(id!=null)store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE id=?",id);});var result=new HashMap<String,Object>();result.put("avatarUrl",null);return result;}
    public void cleanup(UUID id,String key){try{storage.delete(key);store.db().update("UPDATE stored_objects SET state='deleted',deleted_at=now() WHERE id=? AND state='delete_pending'",id);}catch(Exception ignored){/* Reconciler retries private object deletion. */}}
    public void reap(){
        // Current authorization governs reads, never retention of accepted historical inputs.
        tx.executeWithoutResult(t->{var rows=store.db().queryForList("SELECT id FROM grading_submissions WHERE status='draft' AND updated_at<now()-interval '24 hours' LIMIT 100");for(var r:rows){var s=store.row((UUID)r.get("id"),null,true);if(s.status().equals("draft")){store.terminal(s,"expired","upload_abandoned");store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE submission_id=? AND state='staged'",s.id());}}store.db().update("UPDATE stored_objects SET state='delete_pending' WHERE state='staged' AND source_document_id IS NULL AND created_at<now()-interval '10 minutes'");});
        for(var r:store.db().queryForList("SELECT id,object_key FROM stored_objects WHERE state='delete_pending' LIMIT 100"))cleanup((UUID)r.get("id"),(String)r.get("object_key"));}
}
