package org.botai.back.grading;
import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.grading.port.GradingGateway.*;
import org.botai.back.common.ApiException;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class AiResponseValidatorTest {
    static final JsonMapper JSON=JsonMapper.builder().build();
    static TaskSnapshot task(){return new TaskSnapshot(UUID.randomUUID(),UUID.randomUUID(),16,2,"Statement","answer",null,List.of(),false);}
    static String body(TaskSnapshot task,List<Image> images,boolean graded){var r=new LinkedHashMap<String,Object>();r.put("task",AiResponseValidator.task(task));r.put("solution_image_ids",images.stream().map(i->i.id().toString()).toList());r.put("is_graded",graded);r.put("rejection_reason",graded?"":"Не удалось прочитать решение");r.put("ocr",graded?"x=1":null);var checks=new HashMap<String,Object>();checks.put("domain",null);checks.put("transformations",null);checks.put("completeness",Map.of("is_complete",true,"reason","ok"));var analysis=new HashMap<String,Object>();analysis.put("summary","ok");analysis.put("checks",checks);analysis.put("student_answer",null);analysis.put("errors",List.of());analysis.put("strengths",List.of());r.put("analysis",graded?analysis:null);r.put("grading",graded?Map.of("score",2,"criterion","ok","explanation","ok"):null);return JSON.writeValueAsString(r);}
    @Test void validatesProjectionAndRejectsBindingModeAndDuplicateKeys(){var task=task();var images=List.of(new Image(UUID.randomUUID(),new byte[]{1},"image/jpeg"));String raw=body(task,images,true);var validator=new AiResponseValidator();var accepted=validator.validate(new Response(raw,"mock","digest",null),task,images,"digest","mock");assertThat(accepted.graded()).isTrue();assertThat(accepted.demo()).isTrue();assertThat(JSON.writeValueAsString(accepted.feedback())).doesNotContain("reference_answer","statement","task_number").contains("isComplete");for(String broken:List.of(raw.replace("\"score\":2","\"score\":3"),raw.replace("\"score\":2","\"score\":2,\"score\":2"),raw.replace(task.id().toString(),UUID.randomUUID().toString()),raw.replace(images.getFirst().id().toString(),UUID.randomUUID().toString()))){assertThatThrownBy(()->validator.validate(new Response(broken,"mock","digest",null),task,images,"digest","mock")).isInstanceOf(ApiException.class);}assertThatThrownBy(()->validator.validate(new Response(raw,"mock","digest",null),task,images,"digest","live")).isInstanceOf(ApiException.class);}
    @Test void rejectionIsNullScore(){var t=task();var images=List.of(new Image(UUID.randomUUID(),new byte[]{1},"image/jpeg"));var accepted=new AiResponseValidator().validate(new Response(body(t,images,false),"live","digest","unreadable"),t,images,"digest","live");assertThat(accepted.graded()).isFalse();assertThat(accepted.score()).isNull();}
}
