package org.botai.back.admin;
import lombok.RequiredArgsConstructor;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.security.CurrentActor;
import org.botai.back.common.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/admin/submissions")
@RequiredArgsConstructor
public class AdminSubmissionController {
    private final CurrentActor actors;private final SubmissionStore store;private final TransactionTemplate tx;private final org.botai.back.b2b.SubmissionOrigins origins;
    @GetMapping public Object list(Authentication a,@RequestParam(required=false)String status,@RequestParam(required=false)UUID userId,@RequestParam(required=false)Instant from,@RequestParam(required=false)Instant to,@RequestParam(required=false)String cursor,@RequestParam(required=false)Integer limit){actors.requireAdmin(a);int size=Page.limit(limit),offset=Page.offset(cursor);if(status!=null&&!Set.of("draft","queued","running","graded","rejected","failed","cancelled","expired","unsupported").contains(status))throw ApiException.invalid("Некорректный статус");String sql="SELECT id FROM grading_submissions WHERE origin='b2c'";var args=new ArrayList<Object>();if(status!=null){sql+=" AND status=?";args.add(status);}if(userId!=null){sql+=" AND user_id=?";args.add(userId);}if(from!=null){sql+=" AND created_at>=?";args.add(java.sql.Timestamp.from(from));}if(to!=null){sql+=" AND created_at<=?";args.add(java.sql.Timestamp.from(to));}sql+=" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?";args.add(size+1);args.add(offset);var rows=store.db().queryForList(sql,UUID.class,args.toArray()).stream().map(this::summary).toList();return Page.of(rows,offset,size);}
    private Object summary(UUID id){var result=new LinkedHashMap<String,Object>();var s=store.get(null,id);for(String key:List.of("id","attemptId","attemptItemId","status","createdAt","updatedAt","isDemo","errorCode","result"))result.put(key,s.get(key));result.put("user",user(id));return result;}
    private Object user(UUID id){return store.json().read(store.db().queryForObject("SELECT jsonb_build_object('id',u.id,'email',u.email,'displayName',u.display_name)::text FROM users u JOIN grading_submissions s ON s.user_id=u.id WHERE s.id=?",String.class,id));}
    @GetMapping("/{id}") public Object detail(Authentication a,@PathVariable UUID id){UUID actor=actors.requireAdmin(a).getId();return tx.execute(t->{if(origins.b2b(id))throw ApiException.notFound();store.row(id,null,false);store.db().update("INSERT INTO admin_access_events(actor_id,action,target_id) VALUES(?,'submission_detail',?)",actor,id);var result=new LinkedHashMap<String,Object>();result.put("submission",store.get(null,id));result.put("user",user(id));result.put("events",store.db().query("SELECT id,event_type,created_at,metadata::text FROM submission_events WHERE submission_id=? ORDER BY id",(r,n)->Map.of("id",r.getLong(1),"type",r.getString(2),"createdAt",r.getTimestamp(3).toInstant(),"metadata",store.json().read(r.getString(4))),id));var raw=store.db().queryForList("SELECT exact_response FROM grading_results WHERE submission_id=?",id);result.put("exactResponse",raw.isEmpty()?null:raw.getFirst().get("exact_response"));return result;});}
}
