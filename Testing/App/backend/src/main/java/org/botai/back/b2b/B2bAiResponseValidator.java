package org.botai.back.b2b;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.common.*;
import org.botai.back.expert.ExpertReviewDocument;
import org.botai.back.grading.AiResponseValidator;
import org.botai.back.grading.port.GradingGateway;
import org.botai.back.media.StudentCropper;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.*;
import tools.jackson.databind.json.JsonMapper;

/** Strict, additive photo-grade.v2 boundary. Never repairs or guesses causal links. */
public final class B2bAiResponseValidator {
    private static final JsonMapper JSON=JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private final JsonCodec json;private final ExpertReviewDocument canonical;
    public B2bAiResponseValidator(JsonCodec json,ExpertReviewDocument canonical){this.json=json;this.canonical=canonical;}
    public record Diagram(UUID id,UUID source,StudentCropper.Crop crop,String alt) { }
    public record Parsed(TaskSnapshot task,boolean graded,Integer score,String rejection,Map<String,Object> document,List<Diagram> diagrams,boolean demo) { }
    public Parsed parse(GradingGateway.Response response,TaskSnapshot input,List<GradingGateway.Image> images,String pinned,String mode,boolean manual){
        try {
            require(Set.of("mock","live").contains(mode)&&mode.equals(response.providerMode())&&pinned.equals(response.packageId()));
            String raw=response.exactJson();require(raw!=null&&raw.getBytes(StandardCharsets.UTF_8).length<=1048576&&raw.startsWith("{")&&raw.endsWith("}"));
            JsonNode root=JSON.readTree(raw);object(root,"task","solution_image_ids","is_graded","rejection_reason","ocr","analysis","grading","artifacts");
            var t=root.get("task");object(t,"id","task_number","max_score","statement","reference_answer","reference_solution");
            require(uuid(t.get("id")).equals(input.id())&&integer(t.get("task_number"),14,20)==input.taskNumber()&&integer(t.get("max_score"),1,4)==input.maxScore());
            text(t.get("statement"),16000);require(!t.get("statement").asText().isBlank());text(t.get("reference_answer"),16000);require(!t.get("reference_answer").asText().isBlank());nullableText(t.get("reference_solution"),32000);
            TaskSnapshot task=manual?new TaskSnapshot(input.id(),input.taskVersionId(),input.taskNumber(),input.maxScore(),t.get("statement").asText(),t.get("reference_answer").asText(),t.get("reference_solution").isNull()?null:t.get("reference_solution").asText(),List.of(),input.isDemo()):input;
            require(t.equals(JSON.valueToTree(AiResponseValidator.task(task))));
            List<String> imageIds=images.stream().map(i->i.id().toString()).toList();require(new HashSet<>(imageIds).size()==imageIds.size()&&root.get("solution_image_ids").equals(JSON.valueToTree(imageIds)));
            require(root.get("is_graded").isBoolean());text(root.get("rejection_reason"),16000);boolean graded=root.get("is_graded").asBoolean();array(root.get("artifacts"),8);
            Map<String,Object> doc=new LinkedHashMap<>();doc.put("schema_version","expert-review.v2");doc.put("origin","structured_ai");doc.put("phase",graded?"graded":"rejected");doc.put("solution_image_ids",imageIds);doc.put("rejection_reason",graded?null:root.get("rejection_reason").asText());
            boolean demo=task.isDemo()||mode.equals("mock");
            if(!graded){require(!root.get("rejection_reason").asText().isBlank()&&root.get("artifacts").isEmpty());for(String k:List.of("ocr","analysis","grading")){require(root.get(k).isNull());doc.put(k,null);}canonical.validateAi(JSON.valueToTree(doc),imageIds,task.maxScore(),Set.of());return new Parsed(task,false,null,root.get("rejection_reason").asText(),doc,List.of(),demo);}
            require(root.get("rejection_reason").asText().isEmpty()&&response.rejectionCode()==null);var ocr=root.get("ocr");object(ocr,"steps","answer");nullableText(ocr.get("answer"),16000);array(ocr.get("steps"),200);require(!ocr.get("steps").isEmpty());
            Map<UUID,JsonNode> artifacts=new LinkedHashMap<>();for(var a:root.get("artifacts")){object(a,"id","kind","source_image_id","bbox","media_type","byte_size","width","height","sha256");UUID aid=uuid(a.get("id"));require(artifacts.put(aid,a)==null&&!imageIds.contains(aid.toString()));require(a.get("kind").asText().equals("diagram")&&a.get("media_type").asText().equals("image/jpeg")&&imageIds.contains(uuid(a.get("source_image_id")).toString()));bbox(a.get("bbox"));integer(a.get("byte_size"),1,1048576);int w=integer(a.get("width"),1,8192),h=integer(a.get("height"),1,8192);require((long)w*h<=20_000_000);text(a.get("sha256"),64);require(a.get("sha256").asText().matches("[0-9a-f]{64}"));}
            List<Map<String,Object>> blocks=new ArrayList<>();Set<String> ids=new LinkedHashSet<>();Map<UUID,String> used=new LinkedHashMap<>();List<Diagram> diagrams=new ArrayList<>();
            for(var step:ocr.get("steps")){object(step,"id","type","title","lines","figure");String id=id(step.get("id"));require(ids.add(id)&&types(task.taskNumber()).contains(step.get("type").asText()));text(step.get("title"),500);require(!step.get("title").asText().isBlank());array(step.get("lines"),64);List<String> lines=new ArrayList<>();for(var line:step.get("lines")){text(line,16000);lines.add(line.asText());}
                var content=new LinkedHashMap<String,Object>();content.put("type","step");content.put("lines",lines);List<Object> sources=new ArrayList<>();var f=step.get("figure");
                if(!f.isNull()&&Set.of("number_line","unit_circle").contains(f.path("kind").asText())){require(Set.of(14,16).contains(task.taskNumber()));content.put("diagram",NativeFigureAdapter.adapt(f));}
                else if(!f.isNull()){object(f,"kind","artifact_id","alt");require(f.get("kind").asText().equals("image"));UUID aid=uuid(f.get("artifact_id"));var a=artifacts.get(aid);require(a!=null);text(f.get("alt"),200);require(!f.get("alt").asText().isBlank());content.put("image",Map.of("type","image","artifact_id",aid.toString(),"alt",f.get("alt").asText()));sources.add(Map.of("image_id",a.get("source_image_id").asText(),"bbox",plain(a.get("bbox"))));if(!used.containsKey(aid)){used.put(aid,f.get("alt").asText());diagrams.add(new Diagram(aid,uuid(a.get("source_image_id")),bbox(a.get("bbox")),f.get("alt").asText()));}}
                else require(lines.stream().anyMatch(s->!s.isBlank()));
                blocks.add(new LinkedHashMap<>(Map.of("id",id,"title",step.get("title").asText(),"content",content,"sources",sources)));
            }
            require(used.keySet().equals(artifacts.keySet()));
            var analysis=root.get("analysis");object(analysis,"summary","checks","student_answer","errors","strengths","statuses");text(analysis.get("summary"),200000);array(analysis.get("statuses"),200);array(analysis.get("errors"),200);array(analysis.get("strengths"),200);
            Map<String,JsonNode> statuses=new HashMap<>();for(var s:analysis.get("statuses")){optionalObject(s,Set.of("id","status","note","follows_from_step_ids"),Set.of("correct"));String sid=id(s.get("id"));require(ids.contains(sid)&&statuses.put(sid,s)==null);require(Set.of("ok","error","consequence","minor").contains(s.get("status").asText()));nullableText(s.get("note"),200000);if(!s.get("status").asText().equals("ok"))require(!s.get("note").isNull()&&!s.get("note").asText().isBlank());boolean correction=Set.of("error","consequence").contains(s.get("status").asText());require(correction==s.has("correct"));if(correction){text(s.get("correct"),16000);require(!s.get("correct").asText().isBlank());}array(s.get("follows_from_step_ids"),200);}
            require(statuses.size()==ids.size());List<Object> reviews=new ArrayList<>();Set<String> previousErrors=new HashSet<>();for(String sid:ids){var s=statuses.get(sid);List<String> refs=new ArrayList<>();for(var ref:s.get("follows_from_step_ids")){String r=id(ref);require(previousErrors.contains(r)&&!refs.contains(r));refs.add(r);}String status=s.get("status").asText();require(status.equals("consequence")?!refs.isEmpty():refs.isEmpty());if(status.equals("error"))previousErrors.add(sid);Map<String,Object> review=new LinkedHashMap<>();review.put("block_id",sid);review.put("status",Map.of("ok","correct","error","error","consequence","follow_through","minor","warning").get(status));review.put("explanation",s.get("note").isNull()?null:s.get("note").asText()+(s.has("correct")?"\nПравильная запись: "+s.get("correct").asText():""));review.put("follows_from_block_ids",refs);reviews.add(review);}
            var grading=root.get("grading");object(grading,"score","criterion","explanation");int score=integer(grading.get("score"),0,task.maxScore());text(grading.get("criterion"),200000);text(grading.get("explanation"),200000);
            List<Object> findings=new ArrayList<>();Set<String> findingIds=new HashSet<>();int penalties=0;for(var e:analysis.get("errors")){object(e,"id","code","description","where","correct_version","advice","step_id","penalty");String eid=id(e.get("id"));require(findingIds.add(eid));for(String key:List.of("description","where","correct_version","advice"))text(e.get(key),200000);nullableText(e.get("code"),128);nullableText(e.get("step_id"),128);int penalty=integer(e.get("penalty"),0,task.maxScore());penalties+=penalty;String linked=e.get("step_id").isNull()?null:e.get("step_id").asText();if(linked!=null){require(ids.contains(linked));String st=statuses.get(linked).get("status").asText();require(!st.equals("ok")&&(!Set.of("consequence","minor").contains(st)||penalty==0));}Map<String,Object> f=new LinkedHashMap<>();f.put("id",eid);f.put("penalty",penalty);f.put("block_ids",linked==null?List.of():List.of(linked));f.put("kind",linked!=null&&statuses.get(linked).get("status").asText().equals("minor")?"warning":"error");for(String k:List.of("code","description","where","correct_version","advice"))f.put(k,plain(e.get(k)));findings.add(f);}
            require(penalties<=task.maxScore()-score);for(var strength:analysis.get("strengths"))text(strength,200000);
            var projected=new LinkedHashMap<String,Object>();projected.put("block_reviews",reviews);projected.put("findings",findings);for(String key:List.of("summary","checks","student_answer","strengths"))projected.put(key,plain(analysis.get(key)));doc.put("ocr",Map.of("blocks",blocks));doc.put("analysis",projected);doc.put("grading",plain(grading));canonical.validateAi(JSON.valueToTree(doc),imageIds,task.maxScore(),used.keySet().stream().map(UUID::toString).collect(java.util.stream.Collectors.toSet()));
            return new Parsed(task,true,score,null,doc,List.copyOf(diagrams),demo);
        } catch(Exception e){throw new ApiException(502,"invalid_ai_response","Ответ проверки не прошёл проверку формата");}
    }
    /** Only validated proposals reach storage; remap AI identifiers to independently issued backend IDs. */
    public AiResponseValidator.Validated adapt(Parsed parsed,java.util.function.Function<Diagram,UUID> create){
        Map<String,Object> doc=JSON.convertValue(parsed.document(),Map.class);Map<String,String> mapped=new HashMap<>();for(Diagram d:parsed.diagrams())mapped.put(d.id().toString(),create.apply(d).toString());
        if(parsed.graded())for(Object value:(List<?>)((Map<?,?>)doc.get("ocr")).get("blocks")){var content=(Map<String,Object>)((Map<?,?>)value).get("content");if(content.containsKey("image")){var image=(Map<String,Object>)content.get("image");image.put("artifact_id",mapped.get(image.get("artifact_id")));}}
        return new AiResponseValidator.Validated(parsed.graded(),parsed.score(),parsed.rejection(),doc,parsed.demo());
    }
    private static Set<String> types(int n){return switch(n){case 14->Set.of("condition","odz","substitution","transform","solve","back_substitution","selection","answer","other");case 16->Set.of("condition","odz","substitution","transform","solve","intervals","back_substitution","selection","answer","other");case 17->Set.of("condition","model","transform","computation","solve","answer","other");case 15,18->Set.of("condition","construction","proof","computation","answer","other");case 19->Set.of("condition","odz","substitution","transform","model","construction","critical","cases","answer","other");case 20->Set.of("condition","example","proof","estimate","computation","answer","other");default->Set.of();};}
    private static Object plain(JsonNode n){return JSON.convertValue(n,Object.class);}
    private static StudentCropper.Crop bbox(JsonNode n){object(n,"x","y","width","height");for(String k:List.of("x","y","width","height"))require(n.get(k).isNumber()&&Double.isFinite(n.get(k).asDouble()));var b=new StudentCropper.Crop(n.get("x").asDouble(),n.get("y").asDouble(),n.get("width").asDouble(),n.get("height").asDouble());StudentCropper.validate(b);return b;}
    private static UUID uuid(JsonNode n){text(n,36);UUID u=UUID.fromString(n.asText());require(u.toString().equals(n.asText()));return u;}
    private static String id(JsonNode n){text(n,128);require(!n.asText().isBlank());return n.asText();}
    private static int integer(JsonNode n,int min,int max){require(n!=null&&n.isIntegralNumber()&&n.canConvertToInt()&&n.asInt()>=min&&n.asInt()<=max);return n.asInt();}
    private static void object(JsonNode n,String...keys){require(n!=null&&n.isObject()&&n.size()==keys.length);for(String k:keys)require(n.has(k));}
    private static void optionalObject(JsonNode n,Set<String> required,Set<String> optional){require(n!=null&&n.isObject());for(String k:required)require(n.has(k));for(var p:n.properties())require(required.contains(p.getKey())||optional.contains(p.getKey()));}
    private static void text(JsonNode n,int max){require(n!=null&&n.isString()&&n.asText().length()<=max);}
    private static void nullableText(JsonNode n,int max){require(n!=null);if(!n.isNull())text(n,max);}
    private static void array(JsonNode n,int max){require(n!=null&&n.isArray()&&n.size()<=max);}
    private static void require(boolean ok){if(!ok)throw new IllegalArgumentException();}
}
