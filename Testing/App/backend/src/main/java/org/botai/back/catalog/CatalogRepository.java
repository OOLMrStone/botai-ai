package org.botai.back.catalog;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import static org.botai.back.catalog.CatalogDtos.*;

@Repository
@RequiredArgsConstructor
public class CatalogRepository {
    public static final String FORMAT="ege-profile-20-v1";
    private final JdbcClient jdbc;
    private final JsonCodec json;
    private final GradingCapabilities capabilities;

    public Format format(String id) {
        return jdbc.sql("SELECT * FROM exam_formats WHERE id=:id").param("id",id)
            .query((r,n)->new Format(r.getString("id"),r.getInt("version"),r.getString("title"),r.getInt("total_tasks"),r.getInt("max_points")))
            .optional().orElseThrow(ApiException::notFound);
    }
    public List<CatalogDtos.Number> numbers(String formatId) {
        return jdbc.sql("SELECT p.*,(SELECT count(*) FROM tasks t JOIN task_versions v ON v.id=t.current_version_id WHERE NOT t.archived AND v.format_id=p.format_id AND v.exam_number=p.exam_number) available FROM exam_positions p WHERE p.format_id=:format ORDER BY exam_number")
            .param("format",formatId).query((r,n)->new CatalogDtos.Number(r.getInt("exam_number"),r.getInt("part"),r.getString("title"),r.getString("response_type"),r.getInt("max_points"),
                capabilities.forNumber(r.getInt("exam_number"),r.getInt("max_points")),r.getInt("available"),topics(formatId,r.getInt("exam_number")))).list();
    }
    private List<Topic> topics(String format,int number) {
        return jdbc.sql("SELECT p.*,(SELECT count(*) FROM task_version_topics vt JOIN tasks t ON t.current_version_id=vt.task_version_id WHERE vt.topic_id=p.id AND NOT t.archived) available FROM topics p WHERE format_id=:format AND exam_number=:number AND p.active ORDER BY sort_order")
            .param("format",format).param("number",number).query((r,n)->new Topic(r.getString("id"),r.getString("title"),r.getInt("available"),r.getString("source_url"))).list();
    }
    public UUID currentVersion(UUID taskId) {
        return jdbc.sql("SELECT current_version_id FROM tasks WHERE id=:id AND NOT archived").param("id",taskId).query(UUID.class).optional().orElseThrow(ApiException::notFound);
    }
    public Task version(UUID versionId,UUID userId) {
        return jdbc.sql("""
            SELECT v.*,p.part,p.response_type,p.max_points,
              EXISTS(SELECT 1 FROM user_favourites f WHERE f.user_id=:user AND f.task_id=v.task_id) favourite,
              CASE WHEN EXISTS(SELECT 1 FROM user_task_results r WHERE r.user_id=:user AND r.task_id=v.task_id AND r.first_solved_at IS NOT NULL) THEN 'solved'
                   WHEN EXISTS(SELECT 1 FROM attempt_items i JOIN attempts a ON a.id=i.attempt_id JOIN task_versions vi ON vi.id=i.task_version_id WHERE a.user_id=:user AND a.deleted_at IS NULL AND vi.task_id=v.task_id AND (i.answer<>'' OR i.drawing<>'[]'::jsonb OR EXISTS(SELECT 1 FROM grading_submissions s WHERE s.attempt_item_id=i.id))) THEN 'in-progress'
                   ELSE 'unstarted' END progress
            FROM task_versions v JOIN exam_positions p USING(format_id,exam_number) WHERE v.id=:version
            """).param("user",userId).param("version",versionId).query((r,n)->new Task(r.getObject("task_id",UUID.class),versionId,r.getInt("version"),r.getInt("exam_number"),r.getInt("part"),
                jdbc.sql("SELECT topic_id FROM task_version_topics WHERE task_version_id=:id ORDER BY topic_id").param("id",versionId).query(String.class).list(),
                r.getObject("difficulty_level",Integer.class),r.getBoolean("is_grob"),r.getString("response_type"),r.getInt("max_points"),json.read(r.getString("content")),r.getBoolean("favourite"),r.getString("progress"),
                r.getInt("exam_number")>=14&&!r.getBoolean("ai_input_ready")?"unsupported":capabilities.forNumber(r.getInt("exam_number"),r.getInt("max_points")),r.getBoolean("is_demo"),r.getObject("source_year",Integer.class),CatalogSources.project(json.read(r.getString("sources")),json))).optional().orElseThrow(ApiException::notFound);
    }
    public List<UUID> find(UUID user,Integer number,String topic,Integer difficulty,boolean favourites,int offset,int limit) {
        if(number!=null&&(number<1||number>20))throw ApiException.invalid("Номер задания от 1 до 20");
        if(difficulty!=null&&(difficulty<1||difficulty>5))throw ApiException.invalid("Неизвестная сложность");
        String sql="SELECT v.id FROM tasks t JOIN task_versions v ON v.id=t.current_version_id WHERE NOT t.archived";
        if(number!=null)sql+=" AND v.exam_number=:number";
        if(topic!=null)sql+=" AND EXISTS(SELECT 1 FROM task_version_topics vt WHERE vt.task_version_id=v.id AND vt.topic_id=:topic)";
        if(difficulty!=null)sql+=" AND v.difficulty_level=:difficulty";
        if(favourites)sql+=" AND EXISTS(SELECT 1 FROM user_favourites f WHERE f.user_id=:user AND f.task_id=t.id)";
        return jdbc.sql(sql+" ORDER BY v.exam_number,t.id LIMIT :limit OFFSET :offset").param("number",number).param("topic",topic).param("difficulty",difficulty)
            .param("user",user).param("limit",limit).param("offset",offset).query(UUID.class).list();
    }
    public TaskSnapshot snapshot(UUID id) {
        return jdbc.sql("SELECT v.*,p.max_points FROM task_versions v JOIN exam_positions p USING(format_id,exam_number) WHERE v.id=:id").param("id",id)
            .query((r,n)->new TaskSnapshot(r.getObject("task_id",UUID.class),id,r.getInt("exam_number"),r.getInt("max_points"),r.getString("statement"),r.getString("reference_answer"),r.getString("reference_solution"),
                jdbc.sql("SELECT answer FROM task_version_answers WHERE task_version_id=:id ORDER BY answer").param("id",id).query(String.class).list(),r.getBoolean("is_demo"))).optional().orElseThrow(ApiException::notFound);
    }
    public boolean aiInputReady(UUID version) {
        return jdbc.sql("SELECT ai_input_ready FROM task_versions WHERE id=:id").param("id",version).query(Boolean.class).optional().orElse(false);
    }
    public JsonNode referenceContent(UUID version,String mediaPrefix) {
        return referenceBlocks(version,mediaPrefix,"reference_content");
    }
    public JsonNode referenceAnswerContent(UUID version,String mediaPrefix) {
        return referenceBlocks(version,mediaPrefix,"reference_answer_content");
    }
    private JsonNode referenceBlocks(UUID version,String mediaPrefix,String column) {
        String content=jdbc.sql("SELECT "+column+"::text FROM task_versions WHERE id=:id").param("id",version).query(String.class).optional().orElseThrow(ApiException::notFound);
        return json.read(json.write(json.read(content)).replace("\"src\":\"/api/catalog-reference-media/","\"src\":\""+mediaPrefix));
    }
    public void favourite(UUID user,UUID task,boolean add) {
        currentVersion(task);
        if(add)jdbc.sql("INSERT INTO user_favourites(user_id,task_id) VALUES(:user,:task) ON CONFLICT DO NOTHING").param("user",user).param("task",task).update();
        else jdbc.sql("DELETE FROM user_favourites WHERE user_id=:user AND task_id=:task").param("user",user).param("task",task).update();
    }
}
