package org.botai.back.attempt;

import lombok.RequiredArgsConstructor;
import org.botai.back.catalog.CatalogService;
import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;
import static org.botai.back.attempt.AttemptDtos.*;
import static org.botai.back.grading.SubmissionStore.RETRYABLE_STATUSES;

@Repository
@RequiredArgsConstructor
public class AttemptRepository {
    private final JdbcClient jdbc;
    private final CatalogService catalog;
    private final JsonCodec json;
    public Attempt get(UUID user,UUID id,boolean lock) {
        return jdbc.sql("SELECT * FROM attempts WHERE id=:id AND user_id=:user AND deleted_at IS NULL"+(lock?" FOR UPDATE":"")).param("id",id).param("user",user)
            .query((r,n)->{
                var items=items(user,id);
                return new Attempt(id,r.getString("kind"),r.getObject("template_id",UUID.class),r.getString("format_id"),r.getString("status"),r.getInt("revision"),r.getInt("current_index"),
                    r.getTimestamp("created_at").toInstant(),r.getTimestamp("updated_at").toInstant(),r.getTimestamp("completed_at")==null?null:r.getTimestamp("completed_at").toInstant(),items,summary(items),r.getString("title"),r.getTimestamp("last_exited_at")==null?null:r.getTimestamp("last_exited_at").toInstant());
            }).optional().orElseThrow(ApiException::notFound);
    }
    private List<Item> items(UUID user,UUID attempt) {
        return jdbc.sql("SELECT * FROM attempt_items WHERE attempt_id=:id ORDER BY ordinal").param("id",attempt).query((r,n)->{
            UUID id=r.getObject("id",UUID.class);JsonNode submission=latestSubmission(user,id);
            return new Item(id,catalog.version(user,r.getObject("task_version_id",UUID.class)),r.getString("answer"),json.read(r.getString("drawing")),r.getInt("answer_revision"),submission,submission==null?null:submission.get("result"));
        }).list();
    }
    private JsonNode latestSubmission(UUID user,UUID item) {
        return jdbc.sql("""
            SELECT jsonb_build_object('id',s.id,'attemptId',s.attempt_id,'attemptItemId',s.attempt_item_id,'inputRevision',s.input_revision,'revision',s.revision,'status',s.status,
              'createdAt',s.created_at,'updatedAt',s.updated_at,'isDemo',s.is_demo,'errorCode',s.error_code,'retryable',s.status IN(%s),
              'documents',solution_documents_json(s.id),'images',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'fileName',o.file_name,'mimeType',o.mime_type,'sizeBytes',o.size_bytes,'status',o.state,'sourceDocumentId',o.source_document_id,'pageNumber',o.page_number,'previewUrl','/api/media/'||o.id) ORDER BY o.ordinal) FROM stored_objects o WHERE o.submission_id=s.id AND o.purpose='solution' AND o.state='ready'),'[]'::jsonb),
              'result',CASE WHEN r.submission_id IS NULL THEN NULL ELSE jsonb_build_object('isGraded',r.is_graded,'score',r.score,'maxScore',r.max_score,'feedback',r.feedback,'rejectionReason',r.rejection_reason,'isDemo',r.is_demo) END)::text body
            FROM grading_submissions s LEFT JOIN grading_results r ON r.submission_id=s.id
            WHERE s.user_id=:user AND s.attempt_item_id=:item ORDER BY s.created_at DESC,s.id DESC LIMIT 1
            """.formatted(RETRYABLE_STATUSES)).param("user",user).param("item",item).query(String.class).optional().map(json::read).orElse(null);
    }
    public static Summary summary(List<Item> items) {
        int answered=0,graded=0,earned=0,maximum=0,pending=0,unsupported=0;
        for(Item item:items) {
            maximum+=item.task().maxPoints();
            if(!item.answer().isBlank()||(item.submission()!=null&&item.submission().path("images").size()>0))answered++;
            if(item.result()!=null&&item.result().path("isGraded").asBoolean()) { graded++;earned+=item.result().path("score").asInt(); }
            if(item.submission()!=null) {
                String status=item.submission().path("status").asText();
                if(status.equals("queued")||status.equals("running"))pending++;
                if(status.equals("unsupported"))unsupported++;
            }
        }
        return new Summary(items.size(),answered,graded,earned,maximum,pending,unsupported);
    }
    public List<UUID> ids(UUID user,String kind,UUID template,int offset,int limit) { return ids(user,kind,template,null,offset,limit); }
    public List<UUID> recentIds(UUID user,String kind,UUID template,String status,int offset,int limit) {
        return ids(user,kind,template,status,offset,limit,true);
    }
    public List<UUID> ids(UUID user,String kind,UUID template,String status,int offset,int limit) {
        return ids(user,kind,template,status,offset,limit,false);
    }
    private List<UUID> ids(UUID user,String kind,UUID template,String status,int offset,int limit,boolean recent) {
        String order=recent?"coalesce(last_exited_at,created_at)":status==null?"created_at":"updated_at";
        return jdbc.sql("SELECT id FROM attempts WHERE user_id=:user AND deleted_at IS NULL"+(kind==null?"":" AND kind=:kind")+(template==null?"":" AND template_id=:template")+(status==null?"":" AND status IN ('active','checking')")+" ORDER BY "+order+" DESC,id DESC LIMIT :limit OFFSET :offset")
            .param("user",user).param("kind",kind).param("template",template).param("limit",limit).param("offset",offset).query(UUID.class).list();
    }
}
