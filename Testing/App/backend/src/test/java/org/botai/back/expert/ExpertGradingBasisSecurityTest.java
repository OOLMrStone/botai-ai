package org.botai.back.expert;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.botai.back.common.JsonCodec;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

class ExpertGradingBasisSecurityTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final ExpertGradingBasis basis = new ExpertGradingBasis(new JsonCodec(JSON));

    @Test void jsonbObjectKeyOrderingAndReviewArrayOrderingDoNotInvalidateGrading() {
        var before = JSON.readTree("""
            {"ocr":{"blocks":[{"id":"b1","content":{"type":"math","latex":"x=1"},"sources":[]},
                                {"id":"b2","content":{"type":"text","text":"Ответ"},"sources":[]}]},
             "analysis":{"summary":null,"block_reviews":[{"block_id":"b1","status":"error","explanation":null,"follows_from_block_ids":[]},
                                                          {"block_id":"b2","status":"follow_through","explanation":null,"follows_from_block_ids":["b1"]}]}}
            """);
        var after = JSON.readTree("""
            {"analysis":{"block_reviews":[{"follows_from_block_ids":["b1"],"explanation":null,"status":"follow_through","block_id":"b2"},
                                          {"status":"error","block_id":"b1","explanation":null,"follows_from_block_ids":[]}],"summary":null},
             "ocr":{"blocks":[{"sources":[],"content":{"latex":"x=1","type":"math"},"id":"b1"},
                                {"sources":[],"id":"b2","content":{"text":"Ответ","type":"text"}}]}}
            """);
        assertThat(basis.hash(before)).isEqualTo(basis.hash(after));
        var nonNull = JsonMapper.builder().changeDefaultPropertyInclusion(v ->
                v.withValueInclusion(JsonInclude.Include.NON_NULL).withContentInclusion(JsonInclude.Include.NON_NULL)).build();
        assertThat(new ExpertGradingBasis(new JsonCodec(nonNull)).hash(before)).isEqualTo(basis.hash(before));
    }

    @Test void correctedOcrAndAnalysisInvalidateBasisButChangedScoreCannotEstablishANewBasis() {
        String input = "{\"ocr\":{\"blocks\":[{\"id\":\"b1\",\"content\":{\"type\":\"math\",\"latex\":\"x=1\"}}]},\"analysis\":{\"summary\":\"Верно\",\"block_reviews\":[]},\"grading\":{\"score\":2}}";
        var original = JSON.readTree(input);
        assertThat(basis.hash(original)).isNotEqualTo(basis.hash(JSON.readTree(input.replace("x=1", "x=2"))));
        assertThat(basis.hash(original)).isNotEqualTo(basis.hash(JSON.readTree(input.replace("Верно", "Ошибка"))));
        assertThat(basis.hash(original)).isEqualTo(basis.hash(JSON.readTree(input.replace("\"score\":2", "\"score\":1"))));
        assertThat(basis.requestHash(1, original)).isNotEqualTo(basis.requestHash(2, original));
        assertThat(basis.requestHash(1, original)).isNotEqualTo(basis.requestHash(1, JSON.readTree(input.replace("\"score\":2", "\"score\":1"))));
    }

    @Test void meaningfulOcrArrayOrderingIsPreservedAndRequestKeysAreCanonical() {
        var first = JSON.readTree("{\"ocr\":{\"blocks\":[{\"id\":\"a\"},{\"id\":\"b\"}]},\"analysis\":null}");
        var reverse = JSON.readTree("{\"ocr\":{\"blocks\":[{\"id\":\"b\"},{\"id\":\"a\"}]},\"analysis\":null}");
        var keys = JSON.readTree("{\"analysis\":null,\"ocr\":{\"blocks\":[{\"id\":\"a\"},{\"id\":\"b\"}]}}");
        assertThat(basis.hash(first)).isNotEqualTo(basis.hash(reverse));
        assertThat(basis.requestHash(1, first)).isEqualTo(basis.requestHash(1, keys));
    }
    @Test void v2TitleLinesNativeDiagramAndCropReferenceAllInvalidateGrading(){
        String source="{\"ocr\":{\"blocks\":[{\"id\":\"b1\",\"title\":\"Шаг\",\"content\":{\"type\":\"step\",\"lines\":[\"x=1\"],\"diagram\":{\"type\":\"number_line\",\"axis_label\":\"x\"}}}]},\"analysis\":null}";String hash=basis.hash(JSON.readTree(source));for(String changed:java.util.List.of(source.replace("Шаг","Другой шаг"),source.replace("x=1","x=2"),source.replace("number_line","unit_circle"),source.replace("\"diagram\":{\"type\":\"number_line\",\"axis_label\":\"x\"}","\"image\":{\"type\":\"image\",\"artifact_id\":\"abc\",\"alt\":\"Фрагмент\"}")))assertThat(basis.hash(JSON.readTree(changed))).isNotEqualTo(hash);
    }
    @Test void explicitFindingPenaltyIncludingZeroParticipatesInGradingBasis(){String input="{\"ocr\":null,\"analysis\":{\"findings\":[{\"id\":\"f1\",\"penalty\":0}]}}";assertThat(basis.hash(JSON.readTree(input))).isNotEqualTo(basis.hash(JSON.readTree(input.replace("\"penalty\":0","\"penalty\":1"))));assertThat(basis.hash(JSON.readTree(input))).isNotEqualTo(basis.hash(JSON.readTree(input.replace(",\"penalty\":0",""))));}
}
