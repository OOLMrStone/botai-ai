package org.botai.back.expert;

import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import java.util.*;

@Component
public class ExpertReviewDocument {
    private static final tools.jackson.databind.json.JsonMapper DOCUMENT_JSON = tools.jackson.databind.json.JsonMapper.builder().build();
    private static final Set<String> STATUSES = Set.of("correct", "error", "warning", "follow_through");
    private static final Set<String> PHASES = Set.of("ocr", "analysis", "graded", "rejected");
    private final JsonCodec json;
    public ExpertReviewDocument(JsonCodec json) { this.json = json; }

    public void validate(JsonNode doc, List<String> imageIds, int maxScore, boolean finalSend) {
        validate(doc,imageIds,maxScore,finalSend,Set.of());
    }
    public void validate(JsonNode doc, List<String> imageIds, int maxScore, boolean finalSend, Set<String> artifactIds) {
        validateDocument(doc,imageIds,maxScore,finalSend,artifactIds,false);
    }
    /** Internal v2 adapter validation; clients still may submit only origin=expert. */
    public void validateAi(JsonNode doc,List<String> imageIds,int maxScore,Set<String> artifactIds){validateDocument(doc,imageIds,maxScore,true,artifactIds,true);}
    private void validateDocument(JsonNode doc,List<String> imageIds,int maxScore,boolean finalSend,Set<String> artifactIds,boolean generated){
        require(json.write(doc).getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 1048576);
        object(doc, "schema_version", "origin", "phase", "solution_image_ids", "ocr", "analysis", "grading", "rejection_reason");
        String version=doc.path("schema_version").asText();require(Set.of("expert-review.v1","expert-review.v2").contains(version));boolean v2=version.equals("expert-review.v2");
        if(generated)require(v2);choice(doc.get("origin"), generated?Set.of("structured_ai"):Set.of("expert")); choice(doc.get("phase"), PHASES);
        require(doc.get("solution_image_ids").equals(json.read(json.write(imageIds))));
        nullableText(doc.get("rejection_reason"));
        String phase = doc.get("phase").asText();
        if (finalSend) require(phase.equals("graded") || phase.equals("rejected"));
        if (phase.equals("rejected")) {
            require(!doc.get("rejection_reason").isNull() && !doc.get("rejection_reason").asText().isBlank());
            require(doc.get("ocr").isNull() && doc.get("analysis").isNull() && doc.get("grading").isNull());
            return;
        }
        require(doc.get("rejection_reason").isNull());
        var ocr = doc.get("ocr"); object(ocr, "blocks"); array(ocr.get("blocks"), 200);
        Set<String> blockIds = new HashSet<>();
        for (JsonNode block : ocr.get("blocks")) {
            if(v2){require(block.isObject()&&(block.size()==3||block.size()==4));for(String key:List.of("id","sources","content"))require(block.has(key));if(block.size()==4){text(block.get("title"));require(block.get("title").asText().length()<=500);}}else object(block, "id", "sources", "content"); require(blockIds.add(id(block.get("id"))));
            array(block.get("sources"), 4);
            for (JsonNode source : block.get("sources")) {
                object(source, "image_id", "bbox"); require(imageIds.contains(id(source.get("image_id"))));
                if (!source.get("bbox").isNull()) {
                    var bbox = source.get("bbox"); object(bbox, "x", "y", "width", "height");
                    double x = number(bbox.get("x")), y = number(bbox.get("y")), w = number(bbox.get("width")), h = number(bbox.get("height"));
                    require(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1);
                }
            }
            content(block.get("content"),v2,artifactIds);
        }
        var analysis = doc.get("analysis");
        object(analysis, "block_reviews", "summary", "checks", "student_answer", "strengths", "findings");
        array(analysis.get("block_reviews"), 200); array(analysis.get("findings"), 200); array(analysis.get("strengths"), 200);
        Map<String, JsonNode> reviews = new HashMap<>();
        for (JsonNode review : analysis.get("block_reviews")) {
            object(review, "block_id", "status", "explanation", "follows_from_block_ids");
            String blockId = id(review.get("block_id")); require(blockIds.contains(blockId) && reviews.put(blockId, review) == null);
            nullableChoice(review.get("status"), STATUSES); nullableText(review.get("explanation"));
            array(review.get("follows_from_block_ids"), 200);
        }
        require(reviews.size() == blockIds.size());
        Set<String> previousErrors = new HashSet<>();
        for (JsonNode block : ocr.get("blocks")) {
            var review = reviews.get(block.get("id").asText()); Set<String> refs = new HashSet<>();
            for (JsonNode ref : review.get("follows_from_block_ids")) require(refs.add(id(ref)) && previousErrors.contains(ref.asText()));
            boolean follow = review.get("status").asText().equals("follow_through"); require(follow ? !refs.isEmpty() : refs.isEmpty());
            if (review.get("status").asText().equals("error")) previousErrors.add(block.get("id").asText());
            if (phase.equals("ocr")) require(review.get("status").isNull() && review.get("explanation").isNull());
        }
        Set<String> findingIds = new HashSet<>();
        for (JsonNode finding : analysis.get("findings")) {
            if(v2&&finding.has("penalty")){require(finding.isObject()&&finding.size()==9);for(String key:List.of("id","block_ids","kind","code","description","where","correct_version","advice"))require(finding.has(key));var penalty=finding.get("penalty");require(penalty.isIntegralNumber()&&penalty.canConvertToInt()&&penalty.asInt()>=0&&penalty.asInt()<=maxScore);}else object(finding, "id", "block_ids", "kind", "code", "description", "where", "correct_version", "advice");
            require(findingIds.add(id(finding.get("id")))); choice(finding.get("kind"), Set.of("error", "warning"));
            array(finding.get("block_ids"), 200); Set<String> refs = new HashSet<>();
            for (JsonNode ref : finding.get("block_ids")) require(refs.add(id(ref)) && blockIds.contains(ref.asText()));
            text(finding.get("description"));
            for (String key : List.of("code", "where", "correct_version", "advice")) nullableText(finding.get(key));
        }
        nullableText(analysis.get("summary"));
        for (JsonNode strength : analysis.get("strengths")) text(strength);
        var checks = analysis.get("checks");
        if (!checks.isNull()) {
            object(checks, "domain", "transformations", "completeness");
            for (String key : List.of("domain", "transformations")) {
                var check = checks.get(key); if (!check.isNull()) { object(check, "is_correct", "reason"); bool(check.get("is_correct")); text(check.get("reason")); }
            }
            object(checks.get("completeness"), "is_complete", "reason"); bool(checks.get("completeness").get("is_complete")); text(checks.get("completeness").get("reason"));
        }
        var answer = analysis.get("student_answer");
        if (!answer.isNull()) { object(answer, "text", "is_correct"); text(answer.get("text")); bool(answer.get("is_correct")); }
        if (phase.equals("graded")) {
            var grading = doc.get("grading"); object(grading, "score", "criterion", "explanation");
            require(grading.get("score").isIntegralNumber() && grading.get("score").canConvertToInt());
            require(grading.get("score").asInt() >= 0 && grading.get("score").asInt() <= maxScore);
            text(grading.get("criterion")); text(grading.get("explanation"));
        } else require(doc.get("grading").isNull());
        if (phase.equals("ocr")) require(analysis.get("findings").isEmpty() && analysis.get("strengths").isEmpty() && analysis.get("summary").isNull() && checks.isNull() && answer.isNull());
    }

    private void content(JsonNode c,boolean v2,Set<String> artifactIds) {
        require(c != null && c.isObject()); text(c.get("type"));
        switch (c.get("type").asText()) {
            case "text" -> { object(c, "type", "text"); text(c.get("text")); }
            case "math" -> { object(c, "type", "latex"); text(c.get("latex")); }
            case "number_line" -> numberLine(c);
            case "unit_circle" -> unitCircle(c);
            case "step" -> {
                require(v2&&c.has("lines")&&(c.size()==2||(c.size()==3&&(c.has("image")||c.has("diagram")))));require(!(c.has("image")&&c.has("diagram")));array(c.get("lines"),64);
                boolean nonblank=false;for(JsonNode line:c.get("lines")){text(line);require(line.asText().length()<=16000);nonblank|=!line.asText().isBlank();}
                if(c.has("image")){var image=c.get("image");object(image,"type","artifact_id","alt");choice(image.get("type"),Set.of("image"));String artifact=id(image.get("artifact_id"));try{UUID.fromString(artifact);}catch(IllegalArgumentException e){require(false);}require(artifactIds.contains(artifact));text(image.get("alt"));require(image.get("alt").asText().length()<=200);}else if(c.has("diagram")){
                    var diagram=c.get("diagram");
                    switch(diagram.path("type").asText()) {
                        case "number_line" -> numberLine(diagram);
                        case "unit_circle" -> unitCircle(diagram);
                        case "number_line_v2" -> symbolicDiagram(diagram,false);
                        case "unit_circle_v2" -> symbolicDiagram(diagram,true);
                        default -> require(false);
                    }
                }else require(nonblank);
            }
            default -> require(false);
        }
    }
    public static Set<String> artifactIds(JsonNode document){var ids=new HashSet<String>();for(JsonNode block:document.path("ocr").path("blocks")){var image=block.path("content").path("image");if(image.path("artifact_id").isString())ids.add(image.get("artifact_id").asText());}return ids;}
    /** Symbolic v2 figures retain supplied fields/order; coordinates are never evaluated here. */
    private void symbolicDiagram(JsonNode c,boolean circle) {
        if(circle) object(c,"type","points","arcs");
        else {
            object(c,"type","variable","note","points","arcs");
            boundedNonblank(c.get("variable"),64);
            require(c.get("note")!=null);
            if(!c.get("note").isNull()) boundedNonblank(c.get("note"),2000);
        }
        array(c.get("points"),64);array(c.get("arcs"),128);
        Set<String> ids=new HashSet<>();
        for(JsonNode point:c.get("points")) {
            if(point.has("bound")) {object(point,"id","value","included","sign","bound");bool(point.get("bound"));}
            else object(point,"id","value","included","sign");
            String pointId=id(point.get("id"));
            require(!Set.of("-inf","+inf").contains(pointId)&&ids.add(pointId));
            boundedNonblank(point.get("value"),500);
            var included=point.get("included");require(included!=null);
            if(included.isNull())require(point.path("bound").isBoolean()&&point.get("bound").asBoolean());
            else bool(included);
            nullableChoice(point.get("sign"),Set.of("+","-","0"));
        }
        Set<String> endpoints=new HashSet<>(ids);
        if(!circle) endpoints.addAll(Set.of("-inf","+inf"));
        for(JsonNode arc:c.get("arcs")) {
            if(circle)object(arc,"from","to","sign","selected","direction","full_circle");
            else object(arc,"from","to","sign","selected");
            String from=id(arc.get("from")),to=id(arc.get("to"));
            require(endpoints.contains(from)&&endpoints.contains(to));
            nullableChoice(arc.get("sign"),Set.of("+","-","0"));bool(arc.get("selected"));
            if(circle){choice(arc.get("direction"),Set.of("cw","ccw"));bool(arc.get("full_circle"));require(arc.get("full_circle").asBoolean()==from.equals(to));}
        }
    }
    private void numberLine(JsonNode c) {
        object(c, "type", "axis_label", "points", "intervals"); text(c.get("axis_label"));
        array(c.get("points"), 64); array(c.get("intervals"), 65);
        List<String> ids = new ArrayList<>(); double previous = Double.NEGATIVE_INFINITY;
        for (JsonNode point : c.get("points")) {
            object(point, "id", "value", "label_latex", "marker", "sign"); String id = id(point.get("id")); require(!ids.contains(id)); ids.add(id);
            double value = number(point.get("value")); require(value > previous); previous = value;
            text(point.get("label_latex")); nullableChoice(point.get("marker"), Set.of("open", "closed")); choice(point.get("sign"), Set.of("+", "-", "0", "undefined", "unknown"));
        }
        require(c.get("intervals").size() == ids.size() + 1);
        for (int i = 0; i <= ids.size(); i++) {
            var interval = c.get("intervals").get(i); object(interval, "left_point_id", "right_point_id", "sign", "selected");
            require(Objects.equals(nullableId(interval.get("left_point_id")), i == 0 ? null : ids.get(i - 1)));
            require(Objects.equals(nullableId(interval.get("right_point_id")), i == ids.size() ? null : ids.get(i)));
            choice(interval.get("sign"), Set.of("+", "-", "unknown")); bool(interval.get("selected"));
        }
    }
    private void unitCircle(JsonNode c) {
        object(c, "type", "points", "arcs"); array(c.get("points"), 64); array(c.get("arcs"), 128);
        Set<String> ids = new HashSet<>();
        for (JsonNode point : c.get("points")) {
            object(point, "id", "angle_rad", "label_latex", "marker"); require(ids.add(id(point.get("id"))));
            double angle = number(point.get("angle_rad")); require(angle >= 0 && angle < 2 * Math.PI);
            text(point.get("label_latex")); nullableChoice(point.get("marker"), Set.of("open", "closed"));
        }
        for (JsonNode arc : c.get("arcs")) {
            object(arc, "from_point_id", "to_point_id", "direction", "full_circle", "selected");
            String from = id(arc.get("from_point_id")), to = id(arc.get("to_point_id")); require(ids.contains(from) && ids.contains(to));
            choice(arc.get("direction"), Set.of("ccw", "cw")); bool(arc.get("full_circle")); bool(arc.get("selected"));
            require(arc.get("full_circle").asBoolean() == from.equals(to));
        }
    }

    public JsonNode legacy(JsonNode feedback, boolean graded, String rejection, List<String> images) {
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("schema_version", "expert-review.v1"); doc.put("origin", "legacy_adapter");
        doc.put("phase", graded ? "graded" : "rejected"); doc.put("solution_image_ids", images);
        doc.put("ocr", null); doc.put("analysis", null); doc.put("grading", null); doc.put("rejection_reason", graded ? null : rejection);
        if (graded) {
            Map<String, Object> block = new LinkedHashMap<>(); block.put("id", "legacy-ocr-1"); block.put("sources", List.of());
            block.put("content", Map.of("type", "text", "text", feedback.path("ocr").asText()));
            doc.put("ocr", Map.of("blocks", List.of(block)));
            Map<String, Object> review = new LinkedHashMap<>(); review.put("block_id", "legacy-ocr-1");
            review.put("status", null); review.put("explanation", null); review.put("follows_from_block_ids", List.of());
            Map<String, Object> projected = new LinkedHashMap<>(); projected.put("block_reviews", List.of(review));
            List<Object> findings = new ArrayList<>(); projected.put("findings", findings);
            projected.put("summary", null); projected.put("checks", null); projected.put("student_answer", null); projected.put("strengths", List.of());
            doc.put("analysis", projected);
            var analysis = feedback.get("analysis");
            if (analysis != null && analysis.isObject()) {
                projected.put("summary", analysis.get("summary"));
                var sourceChecks = analysis.get("checks");
                if (sourceChecks != null && sourceChecks.isObject()) {
                    Map<String, Object> checks = new LinkedHashMap<>();
                    for (String key : List.of("domain", "transformations", "completeness")) checks.put(key, snake(sourceChecks.get(key)));
                    projected.put("checks", checks);
                }
                projected.put("student_answer", snake(analysis.get("studentAnswer"))); projected.put("strengths", analysis.get("strengths"));
                if (analysis.path("errors").isArray()) for (JsonNode error : analysis.get("errors")) {
                    Map<String, Object> finding = new LinkedHashMap<>(); finding.put("id", error.get("id")); finding.put("block_ids", List.of()); finding.put("kind", "error");
                    for (String key : List.of("code", "description", "where", "advice")) finding.put(key, error.get(key));
                    finding.put("correct_version", error.get("correctVersion")); findings.add(finding);
                }
            }
            doc.put("grading", feedback.get("grading"));
        }
        return json.read(DOCUMENT_JSON.writeValueAsString(doc));
    }
    private Object snake(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (node.isObject()) { Map<String, Object> result = new LinkedHashMap<>(); for (var entry : node.properties()) result.put(entry.getKey().replaceAll("([a-z])([A-Z])", "$1_$2").toLowerCase(Locale.ROOT), snake(entry.getValue())); return result; }
        if (node.isArray()) { List<Object> result = new ArrayList<>(); node.forEach(item -> result.add(snake(item))); return result; }
        return node;
    }
    private static void object(JsonNode n, String... keys) { require(n != null && n.isObject() && n.size() == keys.length); for (String key : keys) require(n.has(key)); }
    private static void array(JsonNode n, int limit) { require(n != null && n.isArray() && n.size() <= limit); }
    private static void text(JsonNode n) { require(n != null && n.isString() && n.asText().length() <= 200000); }
    private static void boundedNonblank(JsonNode n,int limit) { text(n);require(!n.asText().isBlank()&&n.asText().length()<=limit); }
    private static void nullableText(JsonNode n) { require(n != null); if (!n.isNull()) text(n); }
    private static String id(JsonNode n) { text(n); require(!n.asText().isBlank() && n.asText().length() <= 128); return n.asText(); }
    private static String nullableId(JsonNode n) { require(n != null); return n.isNull() ? null : id(n); }
    private static void choice(JsonNode n, Set<String> choices) { text(n); require(choices.contains(n.asText())); }
    private static void nullableChoice(JsonNode n, Set<String> choices) { require(n != null); if (!n.isNull()) choice(n, choices); }
    private static void bool(JsonNode n) { require(n != null && n.isBoolean()); }
    private static double number(JsonNode n) { require(n != null && n.isNumber() && Double.isFinite(n.asDouble())); return n.asDouble(); }
    private static void require(boolean value) { if (!value) throw ApiException.invalid("Некорректный документ экспертной проверки"); }
}
