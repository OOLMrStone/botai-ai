package org.botai.back.expert;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

/** Independent adversarial checks for the wire document, including null-preserving adaptation. */
class ExpertReviewDocumentSecurityTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final ExpertReviewDocument validator = new ExpertReviewDocument(new JsonCodec(JSON));
    private static final String IMAGE = "d4c08a1a-c1f3-44be-a065-c749060d74ea";

    @Test void nullStatusIsValidButMissingRequiredNullKeysAreRejected() {
        var doc = document();
        accepted(doc);
        for (String key : List.of("summary", "checks", "student_answer")) {
            var incomplete = document(); analysis(incomplete).remove(key); rejected(incomplete);
        }
        var review = review("b1", null); review.remove("explanation");
        analysis(doc).put("block_reviews", List.of(review)); rejected(doc);
    }

    @Test void originVersionUnknownFieldsAndImageBindingCannotBeSpoofed() {
        for (String origin : List.of("ai", "legacy_adapter", "system", "")) {
            var doc = document(); doc.put("origin", origin); rejected(doc);
        }
        var version = document(); version.put("schema_version", "expert-review.v3"); rejected(version);
        var unknown = document(); unknown.put("admin", true); rejected(unknown);
        var images = document(); images.put("solution_image_ids", List.of(UUID.randomUUID().toString())); rejected(images);
        var foreignSource = block("b1");
        foreignSource.put("sources", List.of(map("image_id", UUID.randomUUID().toString(), "bbox", null)));
        var doc = document(); ocr(doc).put("blocks", List.of(foreignSource)); rejected(doc);
    }

    @Test void followThroughRequiresAnEarlierErrorAndCannotReferenceSelfFutureOrWarning() {
        var error = review("error", "error");
        var follow = review("follow", "follow_through"); follow.put("follows_from_block_ids", List.of("error"));
        var doc = document(); ocr(doc).put("blocks", List.of(block("error"), block("follow")));
        // Reviews are deliberately reversed: relation and preceding order come from OCR IDs.
        analysis(doc).put("block_reviews", List.of(follow, error)); accepted(doc);
        for (List<String> refs : List.of(List.<String>of(), List.of("follow"), List.of("missing"), List.of("error", "error"))) {
            follow.put("follows_from_block_ids", refs); rejected(doc);
        }
        follow.put("follows_from_block_ids", List.of("error"));
        ocr(doc).put("blocks", List.of(block("follow"), block("error"))); rejected(doc);
        error.put("status", "warning"); ocr(doc).put("blocks", List.of(block("error"), block("follow"))); rejected(doc);
        error.put("status", "error"); follow.put("status", "correct"); rejected(doc);
    }

    @Test void rejectsDuplicateBlocksDanglingFindingsAndUnknownStatuses() {
        var doc = document(); ocr(doc).put("blocks", List.of(block("same"), block("same"))); rejected(doc);
        doc = document(); analysis(doc).put("block_reviews", List.of(review("b1", "approved"))); rejected(doc);
        doc = document(); analysis(doc).put("findings", List.of(map("id", "f1", "block_ids", List.of("missing"), "kind", "error", "code", null, "description", "Ошибка", "where", null, "correct_version", null, "advice", null))); rejected(doc);
    }

    @Test void everyOcrBlockHasExactlyOneReviewResolvedById() {
        var doc = document();
        for (List<Map<String,Object>> reviews : List.of(List.<Map<String,Object>>of(),
                List.of(review("missing", null)), List.of(review("b1", null), review("b1", null)),
                List.of(review("b1", null), review("missing", null)))) {
            analysis(doc).put("block_reviews", reviews); rejected(doc);
        }
        ocr(doc).put("blocks", List.of(block("b1"), block("b2")));
        analysis(doc).put("block_reviews", List.of(review("b2", "correct"), review("b1", null))); accepted(doc);
        analysis(doc).put("block_reviews", List.of(review("b1", null))); rejected(doc);
    }

    @Test void ocrAndAnalysisRemainSeparateAndFlatLegacyFieldsAreRejected() {
        var doc = document(); var block = block("b1"); block.put("status", null);
        ocr(doc).put("blocks", List.of(block)); rejected(doc);
        block.remove("status"); block.put("comment", null); rejected(doc);
        doc = document(); var review = review("b1", null); review.put("content", Map.of("type", "text", "text", "forged OCR"));
        analysis(doc).put("block_reviews", List.of(review)); rejected(doc);
        for (String key : List.of("blocks", "findings", "summary", "checks", "student_answer", "strengths")) {
            var flat = document(); flat.put(key, null); rejected(flat);
        }
        doc = document(); analysis(doc).put("ocr", Map.of("blocks", List.of())); rejected(doc);
    }

    @Test void ocrPhaseRequiresUnclassifiedReviewsAndRejectedHasNoOcrOrAnalysis() {
        var doc = document(); doc.put("phase", "ocr"); accepted(doc);
        analysis(doc).put("block_reviews", List.of(review("b1", "correct"))); rejected(doc);
        doc = document(); doc.put("phase", "ocr"); doc.put("analysis", null); rejected(doc);
        doc = document(); doc.put("phase", "rejected"); doc.put("rejection_reason", "Нечитаемо"); rejected(doc);
        doc.put("ocr", null); doc.put("analysis", null); validator.validate(tree(doc), List.of(IMAGE), 3, true);
        doc.put("rejection_reason", " "); rejected(doc);
    }

    @Test void boundingBoxesMustBeFiniteNormalizedAndInsideTheImage() {
        for (Map<String,Object> bbox : List.of(
                map("x", -0.1, "y", 0, "width", 0.2, "height", 0.2),
                map("x", 0.9, "y", 0, "width", 0.2, "height", 0.2),
                map("x", 0, "y", 0, "width", 0, "height", 0.2),
                map("x", "Infinity", "y", 0, "width", 0.2, "height", 0.2))) {
            var block = block("b1"); block.put("sources", List.of(map("image_id", IMAGE, "bbox", bbox)));
            var doc = document(); ocr(doc).put("blocks", List.of(block)); rejected(doc);
        }
    }

    @Test void numberLineRequiresOrderedFinitePointsAndContiguousIntervalReferences() {
        var line = map("type", "number_line", "axis_label", "x", "points", List.of(point("p1", 0)),
                "intervals", List.of(interval(null, "p1"), interval("p1", null)));
        var doc = withContent(line); accepted(doc);
        line.put("intervals", List.of(interval(null, "missing"), interval("p1", null))); rejected(doc);
        line.put("intervals", List.of(interval(null, "p1"), interval("p1", "p2"), interval("p2", null)));
        line.put("points", List.of(point("p1", 2), point("p2", 1))); rejected(doc);
        line.put("points", List.of(point("p1", 1), point("p2", 1))); rejected(doc);
        line.put("points", List.of(point("p1", 0)));
        line.put("intervals", List.of(interval(null, "p1"), interval("p1", null)));
        String overflow = JSON.writeValueAsString(doc).replace("\"value\":0", "\"value\":1e9999");
        assertThatThrownBy(() -> validator.validate(JSON.readTree(overflow), List.of(IMAGE), 3, false)).isInstanceOf(ApiException.class);
    }

    @Test void circleRequiresKnownEndpointsFiniteAnglesAndConsistentFullCircle() {
        var circle = map("type", "unit_circle", "points", List.of(map("id", "p1", "angle_rad", 0, "label_latex", "0", "marker", null)),
                "arcs", List.of(map("from_point_id", "p1", "to_point_id", "p1", "direction", "ccw", "full_circle", true, "selected", true)));
        var doc = withContent(circle); accepted(doc);
        circle.put("arcs", List.of(map("from_point_id", "p1", "to_point_id", "missing", "direction", "ccw", "full_circle", false, "selected", true))); rejected(doc);
        circle.put("arcs", List.of(map("from_point_id", "p1", "to_point_id", "p1", "direction", "ccw", "full_circle", false, "selected", true))); rejected(doc);
        circle.put("arcs", List.of()); circle.put("points", List.of(map("id", "p1", "angle_rad", 2 * Math.PI, "label_latex", "0", "marker", null))); rejected(doc);
    }

    @Test void finalRequiresTerminalPhaseAndBoundedIntegerScore() {
        var doc = document();
        assertThatThrownBy(() -> validator.validate(tree(doc), List.of(IMAGE), 3, true)).isInstanceOf(ApiException.class);
        doc.put("phase", "graded"); doc.put("grading", map("score", 3, "criterion", "Верно", "explanation", "Верно"));
        validator.validate(tree(doc), List.of(IMAGE), 3, true);
        for (Object score : List.of(-1, 4, 1.5, "3", 2147483648L)) {
            doc.put("grading", map("score", score, "criterion", "", "explanation", "")); rejected(doc);
        }
    }

    @Test void aggregateSizeIsBoundedEvenWhenEveryIndividualTextFits() {
        var doc = document(); var blocks = new ArrayList<Object>(); var reviews = new ArrayList<Object>();
        for (int i = 0; i < 8; i++) { var block = block("b" + i); block.put("content", Map.of("type", "text", "text", "Ж".repeat(100000))); blocks.add(block); reviews.add(review("b" + i, null)); }
        ocr(doc).put("blocks", blocks); analysis(doc).put("block_reviews", reviews); rejected(doc);
    }

    @Test void legacyAdapterPreservesNullFieldsDespiteApplicationNonNullSerialization() {
        var nonNullMapper = JsonMapper.builder().changeDefaultPropertyInclusion(v ->
                v.withValueInclusion(JsonInclude.Include.NON_NULL).withContentInclusion(JsonInclude.Include.NON_NULL)).build();
        var adapter = new ExpertReviewDocument(new JsonCodec(nonNullMapper));
        var feedback = tree(map("ocr", "x=1", "analysis", map("summary", "Верно", "checks", map("domain", null, "transformations", null, "completeness", map("isComplete", true, "reason", "Верно")), "studentAnswer", null, "errors", List.of(), "strengths", List.of()), "grading", map("score", 3, "criterion", "Верно", "explanation", "Верно")));
        var adapted = adapter.legacy(feedback, true, null, List.of(IMAGE));
        assertThat(adapted.has("rejection_reason")).isTrue();
        assertThat(adapted.get("rejection_reason").isNull()).isTrue();
        assertThat(adapted.get("analysis").get("block_reviews").get(0).has("status")).isTrue();
        assertThat(adapted.get("analysis").get("checks").has("domain")).isTrue();
        String edited = JSON.writeValueAsString(adapted).replace("\"legacy_adapter\"", "\"expert\"");
        validator.validate(JSON.readTree(edited), List.of(IMAGE), 3, true);
        var rejection = adapter.legacy(null, false, "Нечитаемо", List.of(IMAGE));
        validator.validate(JSON.readTree(JSON.writeValueAsString(rejection).replace("\"legacy_adapter\"", "\"expert\"")), List.of(IMAGE), 3, true);
    }

    @Test void historicalFeedbackWithOmittedNullableFieldsCanBeEditedAndSent() {
        // Actual persisted v1 feedback dropped these nulls under global NON_NULL serialization.
        var feedback = tree(map("ocr", "  x=1\n", "analysis", map("summary", "Верно",
                "checks", map("completeness", map("isComplete", true, "reason", "Верно")),
                "errors", List.of(map("id", "E1", "description", "Неточность", "where", "x", "correctVersion", "x", "advice", "Проверь")),
                "strengths", List.of()), "grading", map("score", 3, "criterion", "Верно", "explanation", "Верно")));
        var adapted = validator.legacy(feedback, true, null, List.of(IMAGE));
        var analysis = adapted.get("analysis");
        assertThat(analysis.get("checks").get("domain").isNull()).isTrue();
        assertThat(analysis.get("checks").get("transformations").isNull()).isTrue();
        assertThat(analysis.get("student_answer").isNull()).isTrue();
        assertThat(analysis.get("findings").get(0).get("code").isNull()).isTrue();
        assertThat(adapted.get("ocr").get("blocks").get(0).get("content").get("text").asText()).isEqualTo("  x=1\n");
        validator.validate(JSON.readTree(JSON.writeValueAsString(adapted).replace("\"legacy_adapter\"", "\"expert\"")), List.of(IMAGE), 3, true);
    }

    @Test void v2PreservesOneStepOneStatusWithTitleSeveralLinesAndBoundCrop() {
        String artifact=UUID.randomUUID().toString();var doc=document();doc.put("schema_version","expert-review.v2");var block=block("b1");block.put("title","Отбор корней");block.put("content",map("type","step","lines",List.of("x=1","x=2"),"image",map("type","image","artifact_id",artifact,"alt","Чертёж ученика")));ocr(doc).put("blocks",List.of(block));
        validator.validate(tree(doc),List.of(IMAGE),3,false,Set.of(artifact));assertThat(tree(doc).path("analysis").path("block_reviews")).hasSize(1);
        assertThatThrownBy(()->validator.validate(tree(doc),List.of(IMAGE),3,false,Set.of())).isInstanceOf(ApiException.class);
        doc.put("schema_version","expert-review.v1");rejected(doc);
    }
    @Test void v2AllowsPureDiagramButRequiresNonblankLinesWithoutImage() {
        String artifact=UUID.randomUUID().toString();var doc=document();doc.put("schema_version","expert-review.v2");var block=block("b1");var content=map("type","step","lines",List.of(),"image",map("type","image","artifact_id",artifact,"alt",""));block.put("content",content);ocr(doc).put("blocks",List.of(block));validator.validate(tree(doc),List.of(IMAGE),3,false,Set.of(artifact));content.remove("image");rejected(doc);content.put("lines",List.of(" ","\n"));rejected(doc);content.put("lines",List.of("x=1"));accepted(doc);
    }
    @Test void v2BoundsTitleLinesAltAndRejectsUnknownStepFields() {
        var doc=document();doc.put("schema_version","expert-review.v2");var block=block("b1");var content=map("type","step","lines",List.of("x=1"));block.put("content",content);ocr(doc).put("blocks",List.of(block));block.put("title","a".repeat(501));rejected(doc);block.put("title","a");content.put("lines",Collections.nCopies(65,"x"));rejected(doc);content.put("lines",List.of("a".repeat(16001)));rejected(doc);content.put("lines",List.of("x"));content.put("url","https://arbitrary.invalid");rejected(doc);content.remove("url");String artifact=UUID.randomUUID().toString();content.put("image",map("type","image","artifact_id",artifact,"alt","a".repeat(201)));assertThatThrownBy(()->validator.validate(tree(doc),List.of(IMAGE),3,false,Set.of(artifact))).isInstanceOf(ApiException.class);
    }
    @Test void v2StepRetainsNativeEditableDiagramsWithoutSplittingItsStatus(){
        var diagram=map("type","number_line","axis_label","x","points",List.of(point("p1",0)),"intervals",List.of(interval(null,"p1"),interval("p1",null)));
        var doc=document();doc.put("schema_version","expert-review.v2");var block=block("b1");var content=map("type","step","lines",List.of(),"diagram",diagram);block.put("content",content);ocr(doc).put("blocks",List.of(block));accepted(doc);assertThat(tree(doc).path("analysis").path("block_reviews")).hasSize(1);
        content.put("image",map("type","image","artifact_id",UUID.randomUUID().toString(),"alt",""));rejected(doc);content.remove("image");diagram.put("type","svg");rejected(doc);
        var circle=map("type","unit_circle","points",List.of(map("id","p1","angle_rad",0,"label_latex","0","marker",null)),"arcs",List.of(map("from_point_id","p1","to_point_id","p1","direction","ccw","full_circle",true,"selected",true)));content.put("diagram",circle);accepted(doc);circle.put("points",List.of(map("id","p1","angle_rad",Double.NaN,"label_latex","0","marker",null)));rejected(doc);
    }
    @Test void v2FindingsPreserveOptionalBoundedIntegerPenaltyWithoutChangingV1(){
        var doc=document();doc.put("schema_version","expert-review.v2");var finding=map("id","f1","block_ids",List.of("b1"),"kind","error","code",null,"description","Нет обоснования","where",null,"correct_version",null,"advice",null);analysis(doc).put("findings",List.of(finding));accepted(doc);assertThat(tree(doc).path("analysis").path("findings").get(0).has("penalty")).isFalse();finding.put("penalty",0);accepted(doc);finding.put("penalty",3);accepted(doc);for(Object invalid:List.of(-1,4,1.5,"1",2147483648L)){finding.put("penalty",invalid);rejected(doc);}finding.put("penalty",0);doc.put("schema_version","expert-review.v1");rejected(doc);
    }
    @Test void generatedV2ProvenanceIsValidatedInternallyButCannotBeClaimedByClientWrites(){var doc=document();doc.put("schema_version","expert-review.v2");doc.put("origin","structured_ai");doc.put("phase","graded");doc.put("grading",map("score",3,"criterion","Верно","explanation","Верно"));validator.validateAi(tree(doc),List.of(IMAGE),3,Set.of());rejected(doc);doc.put("origin","expert");accepted(doc);assertThatThrownBy(()->validator.validateAi(tree(doc),List.of(IMAGE),3,Set.of())).isInstanceOf(ApiException.class);doc.put("origin","structured_ai");doc.put("schema_version","expert-review.v1");assertThatThrownBy(()->validator.validateAi(tree(doc),List.of(IMAGE),3,Set.of())).isInstanceOf(ApiException.class);}

    private Map<String,Object> document() { return map("schema_version", "expert-review.v1", "origin", "expert", "phase", "analysis", "solution_image_ids", List.of(IMAGE), "ocr", map("blocks", List.of(block("b1"))), "analysis", map("block_reviews", List.of(review("b1", null)), "findings", List.of(), "summary", null, "checks", null, "student_answer", null, "strengths", List.of()), "grading", null, "rejection_reason", null); }
    private static Map<String,Object> block(String id) { return map("id", id, "sources", List.of(), "content", Map.of("type", "math", "latex", "x=1")); }
    private static Map<String,Object> review(String id, String status) { return map("block_id", id, "status", status, "explanation", null, "follows_from_block_ids", List.of()); }
    private Map<String,Object> withContent(Map<String,Object> content) { var doc = document(); var block = block("b1"); block.put("content", content); ocr(doc).put("blocks", List.of(block)); return doc; }
    @SuppressWarnings("unchecked") private static Map<String,Object> ocr(Map<String,Object> doc) { return (Map<String,Object>) doc.get("ocr"); }
    @SuppressWarnings("unchecked") private static Map<String,Object> analysis(Map<String,Object> doc) { return (Map<String,Object>) doc.get("analysis"); }
    private static Map<String,Object> point(String id, Object value) { return map("id", id, "value", value, "label_latex", "0", "marker", null, "sign", "unknown"); }
    private static Map<String,Object> interval(String left, String right) { return map("left_point_id", left, "right_point_id", right, "sign", "unknown", "selected", false); }
    private static Map<String,Object> map(Object... values) { var result = new LinkedHashMap<String,Object>(); for (int i = 0; i < values.length; i += 2) result.put((String)values[i], values[i + 1]); return result; }
    private static JsonNode tree(Object value) { return JSON.readTree(JSON.writeValueAsString(value)); }
    private void accepted(Map<String,Object> doc) { validator.validate(tree(doc), List.of(IMAGE), 3, false); }
    private void rejected(Map<String,Object> doc) { assertThatThrownBy(() -> accepted(doc)).isInstanceOf(ApiException.class); }
}
