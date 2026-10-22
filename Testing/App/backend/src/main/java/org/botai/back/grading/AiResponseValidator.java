package org.botai.back.grading;

import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.grading.port.GradingGateway;
import org.botai.back.common.ApiException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.util.*;

public final class AiResponseValidator {
    private static final JsonMapper JSON=JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    public record Validated(boolean graded,Integer score,String rejectionReason,Map<String,Object> feedback,boolean demo) { }
    public static Map<String,Object> task(TaskSnapshot t){var map=new LinkedHashMap<String,Object>();map.put("id",t.id().toString());map.put("task_number",t.taskNumber());map.put("max_score",t.maxScore());map.put("statement",t.statement());map.put("reference_answer",t.referenceAnswer());map.put("reference_solution",t.referenceSolution());return map;}
    public Validated validate(GradingGateway.Response response,TaskSnapshot task,List<GradingGateway.Image> images,String pinned,String expectedMode){
        try {
            require(Set.of("mock","live").contains(response.providerMode())&&response.providerMode().equals(expectedMode)&&pinned.equals(response.packageId()));
            String raw=response.exactJson();require(raw!=null&&raw.length()<=1048576&&raw.startsWith("{")&&raw.endsWith("}"));
            JsonNode root=JSON.readTree(raw);object(root,"task","solution_image_ids","is_graded","rejection_reason","ocr","analysis","grading");
            require(root.get("task").equals(JSON.valueToTree(task(task))));
            require(root.get("solution_image_ids").equals(JSON.valueToTree(images.stream().map(i->i.id().toString()).toList())));
            bool(root.get("is_graded"));str(root.get("rejection_reason"));boolean graded=root.get("is_graded").asBoolean();
            if(!graded){require(!root.get("rejection_reason").asText().isBlank());for(String key:List.of("ocr","analysis","grading"))require(root.get(key).isNull());return new Validated(false,null,root.get("rejection_reason").asText(),null,task.isDemo()||response.providerMode().equals("mock"));}
            require(root.get("rejection_reason").asText().isEmpty());str(root.get("ocr"));
            var analysis=root.get("analysis");object(analysis,"summary","checks","student_answer","errors","strengths");str(analysis.get("summary"));
            var checks=analysis.get("checks");object(checks,"domain","transformations","completeness");
            for(String key:List.of("domain","transformations")){var c=checks.get(key);if(!c.isNull()){object(c,"is_correct","reason");bool(c.get("is_correct"));str(c.get("reason"));}}
            var complete=checks.get("completeness");object(complete,"is_complete","reason");bool(complete.get("is_complete"));str(complete.get("reason"));
            var answer=analysis.get("student_answer");if(!answer.isNull()){object(answer,"text","is_correct");str(answer.get("text"));bool(answer.get("is_correct"));}
            require(analysis.get("errors").isArray()&&analysis.get("strengths").isArray());Set<String> ids=new HashSet<>();
            for(var e:analysis.get("errors")){object(e,"id","code","description","where","correct_version","advice");for(String k:List.of("id","description","where","correct_version","advice"))str(e.get(k));if(!e.get("code").isNull())str(e.get("code"));require(ids.add(e.get("id").asText()));}
            for(var s:analysis.get("strengths"))str(s);
            var grading=root.get("grading");object(grading,"score","criterion","explanation");require(grading.get("score").isIntegralNumber()&&grading.get("score").canConvertToInt());int score=grading.get("score").asInt();require(score>=0&&score<=task.maxScore());str(grading.get("criterion"));str(grading.get("explanation"));
            // Only pedagogical fields are projected. Snapshot/reference and transport metadata stay private.
            return new Validated(true,score,null,Map.of("ocr",root.get("ocr").asText(),"analysis",camel(analysis),"grading",camel(grading)),task.isDemo()||response.providerMode().equals("mock"));
        }catch(Exception e){throw new ApiException(502,"invalid_ai_response","Ответ проверки не прошёл проверку формата");}
    }
    private Object camel(JsonNode node){if(node.isObject()){var map=new LinkedHashMap<String,Object>();for(var entry:node.properties()){String[] parts=entry.getKey().split("_");String key=parts[0];for(int i=1;i<parts.length;i++)key+=Character.toUpperCase(parts[i].charAt(0))+parts[i].substring(1);map.put(key,camel(entry.getValue()));}return map;}if(node.isArray()){var list=new ArrayList<Object>();node.forEach(n->list.add(camel(n)));return list;}if(node.isNull())return null;if(node.isBoolean())return node.asBoolean();if(node.isNumber())return node.asInt();return node.asText();}
    private static void require(boolean value){if(!value)throw new IllegalArgumentException();}
    private static void object(JsonNode n,String...keys){require(n!=null&&n.isObject()&&n.size()==keys.length);for(String k:keys)require(n.has(k));}
    private static void str(JsonNode n){require(n!=null&&n.isString()&&n.asText().length()<=200000);}
    private static void bool(JsonNode n){require(n!=null&&n.isBoolean());}
}
