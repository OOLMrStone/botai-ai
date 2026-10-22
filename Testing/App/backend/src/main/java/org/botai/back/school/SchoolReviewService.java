package org.botai.back.school;

import java.util.*;
import lombok.RequiredArgsConstructor;
import org.botai.back.b2b.SubmissionOrigins;
import org.botai.back.common.JsonCodec;
import org.botai.back.expert.ExpertReviewDocument;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** Called inside the fenced result transaction: result/work/notification become visible together. */
@Service
@RequiredArgsConstructor
public class SchoolReviewService {
 private final JdbcTemplate db;private final SubmissionOrigins origins;private final ExpertReviewDocument documents;private final JsonCodec json;
 public void complete(UUID submission){
   var source=db.queryForList("SELECT s.user_id,s.school_assignment_id,gr.is_graded,gr.feedback::text,gr.rejection_reason FROM grading_submissions s JOIN grading_results gr ON gr.submission_id=s.id WHERE s.id=? AND s.origin='school'",submission);
   if(source.isEmpty())return;var s=source.getFirst();
   if(!origins.valid(submission,true))throw org.botai.back.common.ApiException.notFound();
   var a=db.queryForMap("SELECT a.school_id,a.student_user_id,es.expert_user_id "+SubmissionOrigins.ACTIVE_SCHOOL+" AND a.id=? FOR SHARE OF a,sc,ss,su,es,se,eu",s.get("school_assignment_id"));
   var images=db.query("SELECT id::text FROM stored_objects WHERE submission_id=? AND purpose='solution' AND state='ready' ORDER BY ordinal",(r,n)->r.getString(1),submission);
   JsonNode feedback=json.read((String)s.get("feedback"));
   var ai=feedback!=null&&feedback.path("schema_version").asText().startsWith("expert-review.")?feedback:documents.legacy(feedback,Boolean.TRUE.equals(s.get("is_graded")),(String)s.get("rejection_reason"),images);
   UUID work=UUID.randomUUID();int created=db.update("INSERT INTO expert_works(id,school_id,student_user_id,expert_user_id,submission_id,ai_document) VALUES(?,?,?,?,?,?::jsonb) ON CONFLICT(school_id,submission_id) DO NOTHING",work,a.get("school_id"),a.get("student_user_id"),a.get("expert_user_id"),submission,json.write(ai));
   if(created==1)db.update("INSERT INTO submission_events(submission_id,event_type,metadata) VALUES(?,'expert_queued','{}'::jsonb)",submission);
   UUID actual=db.queryForObject("SELECT id FROM expert_works WHERE school_id=? AND submission_id=?",UUID.class,a.get("school_id"),submission);
   db.update("INSERT INTO expert_notifications(id,work_id,school_id,expert_user_id,type) VALUES(?,?,?,?,'work_queued') ON CONFLICT(work_id,type) DO NOTHING",UUID.randomUUID(),actual,a.get("school_id"),a.get("expert_user_id"));
 }
}
