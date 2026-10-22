package org.botai.back.b2b;

import java.util.*;
import lombok.RequiredArgsConstructor;
import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Central authorization for non-attempt submissions; never treats UUID secrecy as permission. */
@Component
@RequiredArgsConstructor
public class SubmissionOrigins {
    private final JdbcTemplate db;private final B2bConfig config;
    public boolean b2b(UUID id){var rows=db.queryForList("SELECT origin FROM grading_submissions WHERE id=?",id);return !rows.isEmpty()&&!"b2c".equals(rows.getFirst().get("origin"));}
    public void requireOwner(UUID owner,UUID submission,boolean lock){
        config.requireEnabled();
        var rows=db.queryForList("SELECT user_id FROM grading_submissions WHERE id=?",submission);
        if(rows.isEmpty()||!owner.equals(rows.getFirst().get("user_id"))||!valid(submission,lock))throw ApiException.notFound();
    }
    public boolean operatorActive(UUID actor,boolean lock){return config.operator(actor)&&!db.queryForList("SELECT u.id FROM users u JOIN school_experts e ON e.user_id=u.id JOIN schools s ON s.id=e.school_id WHERE u.id=? AND u.enabled AND u.role='EXPERT' AND e.enabled AND s.enabled"+(lock?" FOR SHARE OF u,e,s":""),actor).isEmpty();}
    public void requireOperator(UUID actor,UUID submission,boolean lock){config.requireOperator(actor);if(!operatorActive(actor,lock))throw new ApiException(403,"forbidden","Доступ запрещён");var rows=db.queryForList("SELECT origin,user_id,school_assignment_id FROM grading_submissions WHERE id=?",submission);if(rows.isEmpty()||!valid(submission,lock))throw ApiException.notFound();var s=rows.getFirst();if("local_demo".equals(s.get("origin"))){if(!actor.equals(s.get("user_id")))throw ApiException.notFound();}else if(!"school".equals(s.get("origin"))||db.queryForObject("SELECT count(*) "+ACTIVE_SCHOOL+" AND a.id=? AND es.expert_user_id=?",Integer.class,s.get("school_assignment_id"),actor)!=1)throw ApiException.notFound();}
    public static final String ACTIVE_SCHOOL = """
        FROM school_assignments a JOIN schools sc ON sc.id=a.school_id
        JOIN school_students ss ON ss.school_id=a.school_id AND ss.user_id=a.student_user_id
        JOIN users su ON su.id=a.student_user_id
        JOIN expert_students es ON es.school_id=a.school_id AND es.student_user_id=a.student_user_id
        JOIN school_experts se ON se.school_id=es.school_id AND se.user_id=es.expert_user_id
        JOIN users eu ON eu.id=se.user_id
        WHERE a.enabled AND sc.enabled AND ss.enabled AND su.enabled AND su.role='USER' AND se.enabled AND eu.enabled AND eu.role='EXPERT'
        """;
    public boolean valid(UUID submission,boolean lock){
        if(!config.enabled())return false;
        var rows=db.queryForList("SELECT origin,school_assignment_id,user_id FROM grading_submissions WHERE id=?",submission);
        if(rows.isEmpty())return false;var s=rows.getFirst();
        if("school".equals(s.get("origin")))return !db.queryForList("SELECT a.id "+ACTIVE_SCHOOL+" AND a.id=? AND a.student_user_id=?"+(lock?" FOR SHARE OF a,sc,ss,su,es,se,eu":""),s.get("school_assignment_id"),s.get("user_id")).isEmpty();
        if("local_demo".equals(s.get("origin")))return operatorActive((UUID)s.get("user_id"),lock);
        return false;
    }
    public void requireInput(UUID id){if(!valid(id,true)||db.queryForObject("SELECT count(*) FROM grading_task_snapshots WHERE submission_id=?",Integer.class,id)!=1)throw ApiException.notFound();}
    public boolean requiresImagePreparation(UUID submission){
        return Boolean.TRUE.equals(db.queryForObject("SELECT s.origin='local_demo' OR (s.origin='school' AND t.input_mode='from-images') FROM grading_submissions s LEFT JOIN school_assignments a ON a.id=s.school_assignment_id LEFT JOIN school_tasks t ON t.id=a.task_id WHERE s.id=?",Boolean.class,submission));
    }
    public Map<String,Object> referenceImage(UUID submission){
        var rows=db.queryForList("SELECT t.id,t.object_key,t.sha256 FROM grading_submissions s JOIN b2b_manual_tasks t ON t.id=s.manual_task_id WHERE s.id=? AND s.origin='local_demo' UNION ALL SELECT asset.id,asset.object_key,asset.sha256 FROM grading_submissions s JOIN school_assignments a ON a.id=s.school_assignment_id JOIN school_tasks t ON t.id=a.task_id JOIN school_task_assets asset ON asset.task_id=t.id AND asset.school_id=a.school_id AND asset.kind='reference' WHERE s.id=? AND s.origin='school' AND t.input_mode='from-images'",submission,submission);
        if(rows.size()!=1)throw new ApiException(503,"manual_input_unavailable","Изображение условия временно недоступно");
        return rows.getFirst();
    }
    /** Materialize only this submission after validated, fenced completion; shared task stays immutable. */
    public void materialize(UUID submission,TaskSnapshot extracted){
        if(!requiresImagePreparation(submission))return;
        boolean manual=Boolean.TRUE.equals(db.queryForObject("SELECT origin='local_demo' FROM grading_submissions WHERE id=?",Boolean.class,submission));
        if(manual){
            db.update("UPDATE b2b_manual_tasks SET statement=?,reference_answer=?,reference_solution=?,content=?::jsonb,is_demo=? WHERE id=(SELECT manual_task_id FROM grading_submissions WHERE id=?) AND statement IS NULL",extracted.statement(),extracted.referenceAnswer(),extracted.referenceSolution(),"[]",extracted.isDemo(),submission);
        }else{
            db.update("INSERT INTO school_submission_task_preparations(submission_id,statement,reference_answer,reference_solution) VALUES(?,?,?,?)",submission,extracted.statement(),extracted.referenceAnswer(),extracted.referenceSolution());
        }
    }
    public TaskSnapshot task(UUID id){
        var rows=db.query("SELECT * FROM grading_task_snapshots WHERE submission_id=?",(r,n)->new TaskSnapshot(r.getObject("task_id",UUID.class),r.getObject("id",UUID.class),r.getInt("exam_number"),r.getInt("max_score"),r.getString("statement"),r.getString("reference_answer"),r.getString("reference_solution"),List.of(),r.getBoolean("is_demo")),id);
        if(rows.isEmpty())throw ApiException.notFound();return rows.getFirst();
    }
}
