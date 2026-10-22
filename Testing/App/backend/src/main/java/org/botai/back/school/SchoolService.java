package org.botai.back.school;

import java.util.*;
import lombok.RequiredArgsConstructor;
import org.botai.back.b2b.*;
import org.botai.back.common.*;
import org.botai.back.grading.*;
import org.botai.back.media.MediaService;
import org.botai.back.media.port.ObjectStorage;
import org.botai.back.security.CurrentActor;
import org.botai.back.user.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

@Service
@RequiredArgsConstructor
public class SchoolService {
    public record Create(UUID retryOfId) { }
    private final CurrentActor actors;private final B2bConfig config;private final SubmissionOrigins origins;
    private final JdbcTemplate db;private final JsonCodec json;private final SubmissionStore submissions;
    private final TransactionTemplate tx;private final ObjectStorage storage;
    private final SchoolTaskContent taskContent;
    private final SchoolFixtureService fixtures;
    private User student(Authentication auth){config.requireEnabled();var u=actors.require(auth);if(u.getRole()!=Role.USER)throw new ApiException(403,"forbidden","Доступ запрещён");return u;}
    public JsonNode me(Authentication auth){var u=student(auth);var schools=db.queryForList("SELECT s.id,s.name FROM schools s JOIN school_students ss ON ss.school_id=s.id WHERE ss.user_id=? AND ss.enabled AND s.enabled ORDER BY s.id",u.getId());if(schools.isEmpty())throw new ApiException(403,"forbidden","Доступ запрещён");var result=new LinkedHashMap<String,Object>();result.put("id",u.getId());result.put("email",u.getEmail());result.put("displayName",u.getDisplayName());result.put("schools",schools);result.put("taskNumbers",List.of(14,15,16,17,18,19,20));return json.read(tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(result));}
    private Map<String,Object> assignment(UUID owner,UUID id,boolean lock){var rows=db.queryForList("SELECT a.*,es.expert_user_id "+SubmissionOrigins.ACTIVE_SCHOOL+" AND a.id=? AND a.student_user_id=?"+(lock?" FOR UPDATE OF a FOR SHARE OF sc,ss,su,es,se,eu":""),id,owner);if(rows.isEmpty())throw ApiException.notFound();return rows.getFirst();}
    private static final String SUMMARY="""
        SELECT jsonb_build_object('id',a.id,'school',jsonb_build_object('id',sc.id,'name',sc.name),'title',a.title,'taskNumber',t.task_number,'maxScore',t.max_score,'assignedAt',a.assigned_at,'dueAt',a.due_at,
        'status',CASE WHEN s.id IS NULL THEN 'not_started' WHEN w.status='sent' THEN 'returned' WHEN w.status='draft' THEN 'reviewing' WHEN w.id IS NOT NULL THEN 'awaiting_expert' ELSE s.status END,
        'submissionId',s.id,'updatedAt',coalesce(w.updated_at,s.updated_at,a.created_at))::text
        FROM school_assignments a JOIN schools sc ON sc.id=a.school_id JOIN school_tasks t ON t.id=a.task_id
        JOIN school_students ss ON ss.school_id=a.school_id AND ss.user_id=a.student_user_id
        JOIN expert_students es ON es.school_id=a.school_id AND es.student_user_id=a.student_user_id
        JOIN school_experts se ON se.school_id=es.school_id AND se.user_id=es.expert_user_id
        JOIN users eu ON eu.id=se.user_id
        LEFT JOIN LATERAL(SELECT * FROM grading_submissions gs WHERE gs.school_assignment_id=a.id ORDER BY gs.created_at DESC,gs.id DESC LIMIT 1)s ON true
        LEFT JOIN expert_works w ON w.submission_id=s.id
        WHERE a.student_user_id=? AND a.enabled AND sc.enabled AND ss.enabled AND se.enabled AND eu.enabled AND eu.role='EXPERT'
        """;
    public Page<JsonNode> list(Authentication auth,Integer requestedLimit,String cursor){var u=student(auth);int limit=Page.limit(requestedLimit),offset=Page.offset(cursor);var rows=db.query(SUMMARY+" ORDER BY a.assigned_at DESC,a.id LIMIT ? OFFSET ?",(r,n)->json.read(r.getString(1)),u.getId(),limit+1,offset);return Page.of(rows,offset,limit);}
    public JsonNode detail(Authentication auth,UUID id){var u=student(auth);return tx.execute(t->{var a=assignment(u.getId(),id,false);var result=(ObjectNode)json.read(db.queryForObject(SUMMARY+" AND a.id=?",String.class,u.getId(),id));result.set("task",json.read(db.queryForObject("SELECT jsonb_build_object('taskNumber',task_number,'maxScore',max_score,'statement',statement,'content',content)::text FROM school_tasks WHERE id=?",String.class,a.get("task_id"))));((ObjectNode)result.get("task")).set("content",taskContent.project((UUID)a.get("task_id"),"/api/school/assignments/"+id+"/task-media/"));String sid=result.path("submissionId").asText();result.set("submission",result.get("submissionId").isNull()?json.read("null"):submissions.get(u.getId(),UUID.fromString(sid)));result.put("fixtureAvailable",fixtures.available((UUID)a.get("task_id")));result.put("fixtureAttachmentIncomplete",!result.get("submissionId").isNull() && db.queryForObject("SELECT count(*) FROM school_fixture_attachments WHERE submission_id=? AND NOT complete",Integer.class,UUID.fromString(sid))>0);var history=new ArrayList<JsonNode>();for(UUID previous:db.queryForList("SELECT id FROM grading_submissions WHERE school_assignment_id=? ORDER BY created_at DESC,id DESC",UUID.class,id))history.add(submissions.get(u.getId(),previous));result.set("history",json.read(json.write(history)));result.put("canResubmit",db.queryForObject("SELECT count(*) FROM grading_submissions WHERE school_assignment_id=? AND (status IN('draft','queued','running') OR error_code='unknown_after_dispatch')",Integer.class,id)==0 && a.get("closed_at")==null);return result;});}
    public JsonNode fixture(Authentication auth,UUID assignmentId,UUID submission){var u=student(auth);UUID task=tx.execute(t->{var a=assignment(u.getId(),assignmentId,true);if(db.queryForObject("SELECT count(*) FROM grading_submissions WHERE id=? AND school_assignment_id=? AND user_id=?",Integer.class,submission,assignmentId,u.getId())!=1)throw ApiException.notFound();return (UUID)a.get("task_id");});return fixtures.attach(u.getId(),submission,task);}
    public record Creation(JsonNode document,boolean created) { }
    public JsonNode create(Authentication auth,UUID assignment,String key,Create request){return createOutcome(auth,assignment,key,request).document();}
    public Creation createOutcome(Authentication auth,UUID assignment,String key,Create request){var u=student(auth);SubmissionService.key(key);String hash=json.hash(Map.of("origin","school","assignmentId",assignment,"retryOfId",request.retryOfId()==null?"":request.retryOfId().toString()));Map.Entry<UUID,Boolean> outcome=tx.execute(t->{var a=assignment(u.getId(),assignment,true);var prior=db.queryForList("SELECT id,request_hash FROM grading_submissions WHERE user_id=? AND idempotency_key=?",u.getId(),key);if(!prior.isEmpty()){if(!hash.equals(prior.getFirst().get("request_hash")))throw ApiException.conflict("idempotency_conflict");return Map.entry((UUID)prior.getFirst().get("id"),false);}if(a.get("closed_at")!=null)throw ApiException.conflict("assignment_closed");var active=db.queryForList("SELECT id FROM grading_submissions WHERE school_assignment_id=? AND status IN('draft','queued','running')",assignment);if(!active.isEmpty())throw ApiException.conflict("submission_in_progress");var previous=db.queryForList("SELECT id,status,error_code FROM grading_submissions WHERE school_assignment_id=? ORDER BY created_at DESC,id DESC LIMIT 1",assignment);if(!previous.isEmpty()&&("unknown_after_dispatch".equals(previous.getFirst().get("error_code"))||(Set.of("failed","cancelled","expired").contains(previous.getFirst().get("status"))&&(request.retryOfId()==null||!request.retryOfId().equals(previous.getFirst().get("id"))))||(!Set.of("failed","cancelled","expired").contains(previous.getFirst().get("status"))&&request.retryOfId()!=null)))throw ApiException.conflict("invalid_retry");if(previous.isEmpty()&&request.retryOfId()!=null)throw ApiException.conflict("invalid_retry");if(db.queryForObject("SELECT count(*) FROM grading_submissions WHERE origin='school' AND user_id=? AND created_at>now()-interval '1 hour'",Integer.class,u.getId())>=100)throw new ApiException(429,"submission_rate_limit","Слишком много проверок");UUID created=UUID.randomUUID();db.update("INSERT INTO grading_submissions(id,user_id,origin,school_assignment_id,input_revision,idempotency_key,request_hash,retry_of_id,request_id) VALUES(?,?,'school',?,0,?,?,?,?)",created,u.getId(),assignment,key,hash,request.retryOfId(),UUID.fromString(RequestIds.current()));submissions.event(created,"intent_created",u.getId(),Map.of("origin","school"));db.update("INSERT INTO local_demo_runs(id,submission_id,actor_id) VALUES(?,?,?)",UUID.randomUUID(),created,a.get("expert_user_id"));return Map.entry(created,true);});return new Creation(submissions.get(u.getId(),outcome.getKey()),outcome.getValue());}
    public JsonNode result(Authentication auth,UUID assignment){var detail=detail(auth,assignment);var result=json.read("{}");var out=(ObjectNode)result;out.set("submissionId",detail.get("submissionId"));out.set("status",detail.get("status"));var s=detail.get("submission");out.set("result",s.isNull()?json.read("null"):s.get("result"));out.set("sentAt",s.isNull()||s.path("expertReview").isNull()?json.read("null"):s.path("expertReview").get("sentAt"));return result;}
    public MediaService.Content taskMedia(Authentication auth,UUID assignment,UUID asset){var u=student(auth);var row=tx.execute(t->{var a=assignment(u.getId(),assignment,false);var rows=db.queryForList("SELECT object_key,mime_type FROM school_task_assets WHERE id=? AND task_id=? AND school_id=? AND kind='statement'",asset,a.get("task_id"),a.get("school_id"));if(rows.isEmpty())throw ApiException.notFound();return rows.getFirst();});byte[] bytes=storage.get(row.get("object_key").toString(),8*1024*1024);tx.executeWithoutResult(t->assignment(u.getId(),assignment,false));return new MediaService.Content(bytes,row.get("mime_type").toString());}
}
