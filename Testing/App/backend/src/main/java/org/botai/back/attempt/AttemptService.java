package org.botai.back.attempt;

import lombok.RequiredArgsConstructor;
import org.botai.back.catalog.CatalogRepository;
import org.botai.back.catalog.CatalogService;
import org.botai.back.catalog.CatalogDtos;
import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.botai.back.common.Page;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import static org.botai.back.attempt.AttemptDtos.*;

@Service
@RequiredArgsConstructor
@Transactional(readOnly=true)
public class AttemptService {
    private final JdbcClient jdbc;
    private final AttemptRepository repository;
    private final CatalogRepository catalogRepository;
    private final CatalogService catalog;
    private final JsonCodec json;

    public Attempt get(UUID user,UUID id) { return repository.get(user,id,false); }
    @Transactional public void delete(UUID user,UUID id) {
        jdbc.sql("UPDATE attempts SET deleted_at=coalesce(deleted_at,now()),revision=revision+CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END WHERE id=:id AND user_id=:user RETURNING id")
            .param("id",id).param("user",user).query(UUID.class).optional().orElseThrow(ApiException::notFound);
    }
    @Transactional public void exit(UUID user,UUID id,Exit request) {
        jdbc.sql("SELECT id FROM attempts WHERE id=:id AND user_id=:user AND deleted_at IS NULL FOR UPDATE")
            .param("id",id).param("user",user).query(UUID.class).optional().orElseThrow(ApiException::notFound);
        jdbc.sql("INSERT INTO attempt_exit_events(event_id,attempt_id) VALUES(:event,:attempt) ON CONFLICT(event_id) DO NOTHING")
            .param("event",request.eventId()).param("attempt",id).update();
        var exitedAt=jdbc.sql("SELECT exited_at FROM attempt_exit_events WHERE event_id=:event AND attempt_id=:attempt")
            .param("event",request.eventId()).param("attempt",id).query(java.time.OffsetDateTime.class).optional().orElseThrow(()->ApiException.conflict("exit_event_conflict"));
        // Повтор потерянного ответа не меняет порядок и не конфликтует с сохранением черновика.
        jdbc.sql("UPDATE attempts SET last_exited_at=greatest(last_exited_at,:exited) WHERE id=:id")
            .param("exited",exitedAt).param("id",id).update();
    }
    public Page<Attempt> history(UUID user,String kind,UUID template,String cursor,Integer size) { return history(user,kind,template,null,cursor,size); }
    public Page<Attempt> history(UUID user,String kind,UUID template,String status,String cursor,Integer size) {
        if(status!=null&&!status.equals("unfinished"))throw ApiException.invalid("Неизвестный фильтр статуса");
        if(kind!=null&&!List.of("training","mock-exam").contains(kind))throw ApiException.invalid("Неизвестный тип попытки");
        int limit=Page.limit(size),offset=Page.offset(cursor);
        return Page.of(repository.recentIds(user,kind,template,status,offset,limit+1).stream().map(id->get(user,id)).toList(),offset,limit);
    }
    public static String idempotencyKey(String key) {
        if(key==null||!key.matches("[A-Za-z0-9._:-]{1,128}"))throw ApiException.invalid("Нужен корректный Idempotency-Key");return key;
    }
    private UUID existing(UUID user,String key,String hash) {
        jdbc.sql("SELECT id FROM users WHERE id=:user FOR UPDATE").param("user",user).query(UUID.class).single();
        return jdbc.sql("SELECT id,request_hash FROM attempts WHERE user_id=:user AND idempotency_key=:key").param("user",user).param("key",key)
            .query((r,n)->{if(!hash.equals(r.getString("request_hash")))throw ApiException.conflict("idempotency_conflict");return r.getObject("id",UUID.class);}).optional().orElse(null);
    }
    @Transactional public Attempt startTraining(UUID user,String key,TrainingRequest request) {
        idempotencyKey(key);String hash=json.hash(request);UUID old=existing(user,key,hash);if(old!=null)return get(user,old);
        catalogRepository.format(request.formatId());
        if(request.source()!=null&&!List.of("catalog","favorites").contains(request.source()))throw ApiException.invalid("Неизвестный источник задач");
        DifficultySelection.validate(request.difficultyPreference());
        if(request.difficulty()!=null&&(request.difficulty()<1||request.difficulty()>5))throw ApiException.invalid("Неизвестная сложность");
        var versions=new ArrayList<UUID>();var numbers=new HashSet<Integer>();boolean favourites="favorites".equals(request.source());
        if(request.taskIds()!=null&&!request.taskIds().isEmpty()) {
            if(new HashSet<>(request.taskIds()).size()!=request.taskIds().size())throw ApiException.invalid("Задачи не должны повторяться");
            for(UUID id:request.taskIds()) {
                var task=catalog.task(user,id);var snapshot=catalog.snapshot(task.taskVersionId());
                if(favourites&&!task.isFavourite())throw ApiException.notFound();
                if(request.difficulty()!=null&&!request.difficulty().equals(task.difficulty()))throw ApiException.invalid("Задача не соответствует сложности");
                if(!DifficultySelection.eligible(task.difficulty(),request.difficultyPreference()))throw ApiException.invalid("Задача не соответствует предпочтению сложности");
                if(!request.formatId().equals(jdbc.sql("SELECT format_id FROM task_versions WHERE id=:id").param("id",snapshot.taskVersionId()).query(String.class).single()))throw ApiException.invalid("Задача из другого формата");
                if(request.selections()!=null&&!request.selections().isEmpty()) {
                    var matching=request.selections().stream().filter(selection->selection.examNumber()==task.examNumber()).findFirst().orElseThrow(()->ApiException.invalid("Номер отсутствует в выборе"));
                    if(matching.topicIds()!=null&&!matching.topicIds().isEmpty()&&Collections.disjoint(matching.topicIds(),task.topicIds()))throw ApiException.invalid("Задача не соответствует теме");
                }
                versions.add(task.taskVersionId());
            }
            if(!request.selections().isEmpty()) {
                for(var selection:request.selections()) {
                    if(!numbers.add(selection.examNumber()))throw ApiException.invalid("Номера не должны повторяться");
                    long actual=versions.stream().filter(id->catalog.snapshot(id).taskNumber()==selection.examNumber()).count();
                    if(actual!=selection.count())throw ApiException.invalid("Количество задач не совпадает с выбором");
                }
                if(request.selections().stream().mapToInt(Selection::count).sum()!=versions.size())throw ApiException.invalid("Выбраны лишние задачи");
            }
        } else {
            for(var selection:request.selections()) {
                if(!numbers.add(selection.examNumber()))throw ApiException.invalid("Номера не должны повторяться");
                List<String> topics=selection.topicIds()==null?List.of():selection.topicIds();
                if(new HashSet<>(topics).size()!=topics.size())throw ApiException.invalid("Темы не должны повторяться");
                for(String topic:topics) {
                    boolean valid=jdbc.sql("SELECT EXISTS(SELECT 1 FROM topics WHERE id=:topic AND exam_number=:number AND format_id=:format)").param("topic",topic).param("number",selection.examNumber()).param("format",request.formatId()).query(Boolean.class).single();
                    if(!valid)throw ApiException.invalid("Тема не соответствует номеру");
                }
                String sql="SELECT v.id,v.difficulty_level,EXISTS(SELECT 1 FROM user_task_results r WHERE r.user_id=:user AND r.task_id=t.id AND r.first_solved_at IS NOT NULL) solved FROM tasks t JOIN task_versions v ON v.id=t.current_version_id WHERE NOT t.archived AND v.format_id=:format AND v.exam_number=:number";
                if(request.difficulty()!=null)sql+=" AND v.difficulty_level=:difficulty";
                if(!topics.isEmpty())sql+=" AND EXISTS(SELECT 1 FROM task_version_topics vt WHERE vt.task_version_id=v.id AND vt.topic_id IN(:topics))";
                if(favourites)sql+=" AND EXISTS(SELECT 1 FROM user_favourites f WHERE f.user_id=:user AND f.task_id=t.id)";
                sql+=" ORDER BY t.id";
                var candidates=jdbc.sql(sql).param("format",request.formatId()).param("number",selection.examNumber()).param("difficulty",request.difficulty()).param("topics",topics).param("user",user)
                    .query((r,n)->new DifficultySelection.Candidate(r.getObject("id",UUID.class),r.getObject("difficulty_level",Integer.class),r.getBoolean("solved"))).list();
                var random=new SplittableRandom(user.getMostSignificantBits()^user.getLeastSignificantBits()^key.hashCode()^selection.examNumber());
                versions.addAll(DifficultySelection.select(candidates,selection.count(),request.difficultyPreference(),random));
            }
        }
        for(int number=1;number<=20;number++) {
            final int selectedNumber=number;
            if(versions.stream().filter(version->catalog.snapshot(version).taskNumber()==selectedNumber).count()>20)throw ApiException.invalid("Не больше 20 задач на номер");
        }
        if(versions.isEmpty()||versions.size()>50)throw ApiException.invalid("Выбери от 1 до 50 задач");
        UUID id=insert(user,key,hash,"training",null,request.formatId(),versions);
        for(var selection:request.selections())jdbc.sql("INSERT INTO practice_selections(attempt_id,exam_number,count) VALUES(:id,:number,:count)").param("id",id).param("number",selection.examNumber()).param("count",selection.count()).update();
        return get(user,id);
    }
    private static final String AVAILABLE_EXAM="published AND NOT EXISTS(SELECT 1 FROM exam_template_items ei JOIN task_versions ev ON ev.id=ei.task_version_id JOIN tasks et ON et.id=ev.task_id WHERE ei.template_id=exam_templates.id AND et.archived)";
    @Transactional public Attempt startExam(UUID user,UUID template,String key) {
        idempotencyKey(key);String hash=json.hash(Map.of("template",template));UUID old=existing(user,key,hash);if(old!=null)return get(user,old);
        String format=jdbc.sql("SELECT format_id FROM exam_templates WHERE id=:id AND "+AVAILABLE_EXAM+" FOR SHARE").param("id",template).query(String.class).optional().orElseThrow(ApiException::notFound);
        var versions=jdbc.sql("SELECT task_version_id FROM exam_template_items WHERE template_id=:id ORDER BY ordinal").param("id",template).query(UUID.class).list();
        if(versions.size()!=20)throw new ApiException(409,"incomplete_template","Пробник ещё не готов");
        return get(user,insert(user,key,hash,"mock-exam",template,format,versions));
    }
    private UUID insert(UUID user,String key,String hash,String kind,UUID template,String format,List<UUID> versions) {
        UUID id=UUID.randomUUID();
        jdbc.sql("INSERT INTO attempts(id,user_id,kind,template_id,format_id,idempotency_key,request_hash) VALUES(:id,:user,:kind,:template,:format,:key,:hash)").param("id",id).param("user",user).param("kind",kind).param("template",template).param("format",format).param("key",key).param("hash",hash).update();
        for(int i=0;i<versions.size();i++)jdbc.sql("INSERT INTO attempt_items(id,attempt_id,ordinal,task_version_id) VALUES(:id,:attempt,:ordinal,:version)").param("id",UUID.randomUUID()).param("attempt",id).param("ordinal",i).param("version",versions.get(i)).update();
        return id;
    }
    @Transactional public Attempt patch(UUID user,UUID id,Patch patch) {
        var attempt=repository.get(user,id,true);
        if(attempt.revision()!=patch.revision())throw ApiException.conflict("revision_conflict");
        if(patch.currentIndex()!=null&&patch.currentIndex()>attempt.items().size())throw ApiException.invalid("Неверная позиция в попытке");
        String title=attempt.title();
        if(patch.title()!=null) {
            if(!patch.title().isTextual())throw ApiException.invalid("Введи название подборки");
            title=patch.title().asText().strip();
            if(title.isEmpty()||title.length()>80)throw ApiException.invalid("Название должно содержать от 1 до 80 символов");
        }
        Set<UUID> changed=new HashSet<>();
        if(patch.items()!=null)for(var edit:patch.items()) {
            if(!changed.add(edit.id()))throw ApiException.invalid("Ответ не должен повторяться");
            var item=attempt.items().stream().filter(i->i.id().equals(edit.id())).findFirst().orElseThrow(ApiException::notFound);
            if(item.submission()!=null&&List.of("queued","running","graded").contains(item.submission().path("status").asText()))throw ApiException.conflict("input_frozen");
            var drawing=edit.drawing()==null?item.drawing():edit.drawing();validateDrawing(drawing);
            String answer=edit.answer()==null?item.answer():edit.answer();
            if(!answer.equals(item.answer())||!drawing.equals(item.drawing()))jdbc.sql("UPDATE attempt_items SET answer=:answer,drawing=CAST(:drawing AS jsonb),answer_revision=answer_revision+1 WHERE id=:id").param("answer",answer).param("drawing",json.write(drawing)).param("id",item.id()).update();
        }
        jdbc.sql("UPDATE attempts SET revision=revision+1,current_index=:index,title=:title,updated_at=now() WHERE id=:id").param("index",patch.currentIndex()==null?attempt.currentIndex():patch.currentIndex()).param("title",title).param("id",id).update();
        return get(user,id);
    }
    private void validateDrawing(tools.jackson.databind.JsonNode drawing) {
        if(!drawing.isArray()||drawing.size()>300||json.write(drawing).length()>250000)throw ApiException.invalid("Рисунок слишком большой");
        int points=0;
        for(var stroke:drawing) {
            if(!stroke.isObject()||!stroke.path("id").isTextual()||stroke.path("id").asText().length()>100||!stroke.path("points").isArray())throw ApiException.invalid("Некорректный рисунок");
            for(var point:stroke.path("points")) {
                points++;if(points>10000||!point.path("x").isNumber()||!point.path("y").isNumber()||Math.abs(point.path("x").asDouble())>100000||Math.abs(point.path("y").asDouble())>100000)throw ApiException.invalid("Некорректные координаты рисунка");
            }
        }
    }
    public Page<Exam> exams(UUID user,String cursor,Integer size) {
        int limit=Page.limit(size),offset=Page.offset(cursor);
        var rows=jdbc.sql("SELECT exam_templates.*,f.total_tasks,f.max_points FROM exam_templates JOIN exam_formats f ON f.id=exam_templates.format_id WHERE "+AVAILABLE_EXAM+" ORDER BY exam_templates.created_at DESC,exam_templates.id LIMIT :limit OFFSET :offset").param("limit",limit+1).param("offset",offset)
            .query((r,n)->{
                UUID id=r.getObject("id",UUID.class);var latestIds=repository.ids(user,null,id,0,1);Attempt latest=latestIds.isEmpty()?null:get(user,latestIds.getFirst());
                UUID active=jdbc.sql("SELECT id FROM attempts WHERE user_id=:user AND template_id=:template AND deleted_at IS NULL AND status<>'completed' ORDER BY created_at DESC,id DESC LIMIT 1").param("user",user).param("template",id).query(UUID.class).optional().orElse(null);
                return new Exam(id,r.getString("title"),r.getTimestamp("created_at").toInstant(),r.getInt("total_tasks"),r.getInt("max_points"),r.getBoolean("is_demo"),latest==null?null:new Latest(latest.id(),latest.status(),latest.createdAt(),latest.completedAt(),latest.summary()),active);
            }).list();return Page.of(rows,offset,limit);
    }
    public CatalogDtos.Solution solution(UUID user,UUID attempt,UUID item) {
        return catalog.solution(solutionVersion(user,attempt,item),"/api/attempts/"+attempt+"/items/"+item+"/solution-media/");
    }
    @Transactional public CatalogDtos.Solution reveal(UUID user,UUID attempt,UUID item,SolutionReveal request) {
        if(request.expectedAnswerRevision()==null||(request.expectedSubmissionId()==null)!=(request.expectedSubmissionRevision()==null))throw ApiException.invalid("Нужна текущая версия ответа");
        jdbc.sql("SELECT id FROM attempts WHERE id=:attempt AND user_id=:user AND deleted_at IS NULL FOR UPDATE").param("attempt",attempt).param("user",user).query(UUID.class).optional().orElseThrow(ApiException::notFound);
        var current=jdbc.sql("SELECT task_version_id,answer_revision FROM attempt_items WHERE id=:item AND attempt_id=:attempt FOR UPDATE").param("item",item).param("attempt",attempt).query((r,n)->new Object[]{r.getObject("task_version_id",UUID.class),r.getInt("answer_revision")}).optional().orElseThrow(ApiException::notFound);
        UUID version=(UUID)current[0];int revision=(int)current[1];
        var submissions=jdbc.sql("SELECT id,revision FROM grading_submissions WHERE attempt_item_id=:item AND user_id=:user ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE").param("item",item).param("user",user).query((r,n)->new Object[]{r.getObject("id",UUID.class),r.getInt("revision")}).list();
        UUID submission=submissions.isEmpty()?null:(UUID)submissions.getFirst()[0];Integer submissionRevision=submissions.isEmpty()?null:(Integer)submissions.getFirst()[1];
        if(revision!=request.expectedAnswerRevision()||!Objects.equals(submission,request.expectedSubmissionId())||!Objects.equals(submissionRevision,request.expectedSubmissionRevision()))throw ApiException.conflict("revision_conflict");
        if(submission!=null&&jdbc.sql("SELECT EXISTS(SELECT 1 FROM stored_objects WHERE submission_id=:submission AND state='staged')").param("submission",submission).query(Boolean.class).single())throw ApiException.conflict("uploads_in_flight");
        var task=catalog.version(user,version);
        if(task.part()!=2||!task.gradingCapability().equals("unsupported"))throw new ApiException(403,"solution_reveal_unavailable","Решение можно открыть после проверки");
        String hash=json.hash(List.of(version,revision,submission==null?"none":submission,submissionRevision==null?-1:submissionRevision));
        // The immutable grant is also the audit event; replay cannot add another event or a grade.
        jdbc.sql("INSERT INTO solution_reveal_grants(id,user_id,attempt_id,item_id,task_version_id,answer_revision,latest_submission_id,latest_submission_revision,input_fingerprint) VALUES(:id,:user,:attempt,:item,:version,:revision,:submission,:submissionRevision,:hash) ON CONFLICT(user_id,item_id,input_fingerprint) DO NOTHING")
            .param("id",UUID.randomUUID()).param("user",user).param("attempt",attempt).param("item",item).param("version",version).param("revision",revision).param("submission",submission).param("submissionRevision",submissionRevision).param("hash",hash).update();
        return solution(user,attempt,item);
    }
    public UUID solutionVersion(UUID user,UUID attempt,UUID item) {
        UUID version=jdbc.sql("""
            SELECT i.task_version_id FROM attempt_items i JOIN attempts a ON a.id=i.attempt_id
            LEFT JOIN LATERAL(SELECT id,revision FROM grading_submissions WHERE attempt_item_id=i.id AND user_id=a.user_id ORDER BY created_at DESC,id DESC LIMIT 1) latest ON true
            WHERE a.user_id=:user AND a.id=:attempt AND a.deleted_at IS NULL AND i.id=:item AND
                (EXISTS(SELECT 1 FROM grading_submissions s JOIN grading_results r ON r.submission_id=s.id WHERE s.attempt_item_id=i.id AND s.input_revision=i.answer_revision AND s.status='graded' AND r.is_graded)
                OR EXISTS(SELECT 1 FROM solution_reveal_grants g WHERE g.user_id=a.user_id AND g.attempt_id=a.id AND g.item_id=i.id AND g.task_version_id=i.task_version_id AND g.answer_revision=i.answer_revision
                    AND g.latest_submission_id IS NOT DISTINCT FROM latest.id AND g.latest_submission_revision IS NOT DISTINCT FROM latest.revision
                    AND NOT EXISTS(SELECT 1 FROM stored_objects WHERE submission_id=latest.id AND state='staged')))
            """)
            .param("user",user).param("attempt",attempt).param("item",item).query(UUID.class).optional().orElseThrow(ApiException::notFound);
        return version;
    }
}
