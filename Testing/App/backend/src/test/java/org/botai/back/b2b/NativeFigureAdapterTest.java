package org.botai.back.b2b;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import static org.assertj.core.api.Assertions.*;

class NativeFigureAdapterTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test void acceptedAiNumberLineFixtureStaysLosslessThroughCanonicalValidation() throws Exception {
        assertResourceHash("ai-456512-native-16.json", "3bb443cb3fa301111cafaac35e03b1d9a9099f7688a638630a9e22b8e187a1fd");
        var raw = resource("ai-456512-native-16.json");
        JsonNode result = project(raw);
        assertLossless(raw, result, "number_line_v2");
        assertThat(result.path("points").get(1).path("included").isNull()).isTrue();
        assertThat(result.path("points").get(1).path("bound").asBoolean()).isTrue();
        assertThat(result.path("arcs").get(0).path("from").asText()).isEqualTo("-inf");
    }

    @Test void notesSparseArcsLoopsAndUnrecognizedCoordinatesAreRetainedExactly() throws Exception {
        ObjectNode raw = resource("ai-456512-native-16.json");
        raw.put("note", "При t > 0; подпись ученика");
        raw.put("variable", "t");
        ((ObjectNode) raw.path("points").get(0)).put("value", "\\frac{-3\\pi}{2}");
        ((ObjectNode) raw.path("points").get(1)).put("value", "неразборчиво: a или α");
        ArrayNode arcs = (ArrayNode) raw.get("arcs");
        arcs.removeAll();
        arcs.add(JSON.readTree("""
            {"from":"p1","to":"p1","sign":"0","selected":true}
            """));
        assertLossless(raw, project(raw), "number_line_v2");
        assertThat(project(raw).path("arcs")).hasSize(1);
    }

    @Test void unknownExpressionsAreSourceDataAndAreNeverEvaluatedOrRewritten() throws Exception {
        for (String value : new String[]{"π/2", "-2π", "sqrt(2)", "\\sqrt{2}", "a", "1/0",
                "NaN", "2^999999999", "1;System.exit(0)", "(".repeat(250)}) {
            ObjectNode raw = resource("ai-456512-native-16.json");
            ((ObjectNode) raw.path("points").get(0)).put("value", value);
            assertLossless(raw, project(raw), "number_line_v2");
        }
    }

    @Test void circlePreservesSymbolicAnglesBoundsSignsDirectionAndFullCircle() {
        ObjectNode raw = (ObjectNode) JSON.readTree("""
            {"kind":"unit_circle","points":[
                {"id":"p1","value":"-π/3","included":true,"sign":"+"},
                {"id":"p2","value":"2pi","included":null,"sign":"0","bound":true}],
             "arcs":[{"from":"p1","to":"p2","sign":"-","selected":true,"direction":"cw","full_circle":false},
                     {"from":"p2","to":"p2","sign":null,"selected":false,"direction":"ccw","full_circle":true}]}
            """);
        assertLossless(raw, project(raw), "unit_circle_v2");
        ((ObjectNode) raw.path("arcs").get(0)).put("full_circle", true);
        assertInvalid(raw);
    }

    @Test void oldAcceptedAiCircleWithoutDirectionFailsInsteadOfInventingOrientation() throws Exception {
        assertResourceHash("ai-456512-native-14.json", "9fa82c95c0798204dd2652d72fdb2c4d110c3ecdcf6e9df418a082c45622038d");
        assertInvalid(resource("ai-456512-native-14.json"));
    }

    @Test void newImmutableAiCircleHasExplicitDirectionAndIsLosslesslyAccepted() throws Exception {
        assertResourceHash("ai-131fd-native-14.json", "ad92ad046c93c4a0599f0736bcf1f547a20cb787f8477db340c721395d3803e3");
        ObjectNode raw = resource("ai-131fd-native-14.json");
        assertLossless(raw, project(raw), "unit_circle_v2");
        assertThat(raw.path("arcs").get(0).path("direction").asText()).isEqualTo("ccw");
        assertThat(raw.path("arcs").get(0).path("full_circle").asBoolean()).isFalse();
    }

    @Test void newImmutableAiNumberLineIsUnchangedFromTheOldCheckpoint() throws Exception {
        assertResourceHash("ai-131fd-native-16.json", "3bb443cb3fa301111cafaac35e03b1d9a9099f7688a638630a9e22b8e187a1fd");
        ObjectNode raw = resource("ai-131fd-native-16.json");
        assertThat(raw).isEqualTo(resource("ai-456512-native-16.json"));
        assertLossless(raw, project(raw), "number_line_v2");
    }

    @Test void unknownFieldsMalformedReferencesInclusionAndSignsFailAtCanonicalBoundary() throws Exception {
        for (int variant = 0; variant < 11; variant++) {
            ObjectNode raw = resource("ai-456512-native-16.json");
            ObjectNode point = (ObjectNode) raw.path("points").get(0);
            ObjectNode arc = (ObjectNode) raw.path("arcs").get(0);
            switch (variant) {
                case 0 -> raw.put("provider_secret", "not allowed");
                case 1 -> point.put("reasoning", "not allowed");
                case 2 -> arc.put("url", "https://invalid.example");
                case 3 -> arc.put("to", "foreign");
                case 4 -> point.put("id", "-inf");
                case 5 -> point.putNull("included");
                case 6 -> point.put("bound", "true");
                case 7 -> point.put("sign", "positive");
                case 8 -> point.put("id", "p2");
                case 9 -> arc.put("selected", "true");
                case 10 -> raw.put("type", "unit_circle_v2");
            }
            assertInvalid(raw);
        }
    }

    @Test void canonicalStringAndCollectionBoundsAreEnforcedWithoutMathematicalEvaluation() throws Exception {
        for (int variant = 0; variant < 10; variant++) {
            ObjectNode raw = resource("ai-456512-native-16.json");
            ObjectNode point = (ObjectNode) raw.path("points").get(0);
            switch (variant) {
                case 0 -> point.put("value", "x".repeat(501));
                case 1 -> point.put("value", " ");
                case 2 -> point.put("id", "x".repeat(129));
                case 3 -> raw.put("variable", "x".repeat(65));
                case 4 -> raw.put("variable", " ");
                case 5 -> raw.put("note", "x".repeat(2001));
                case 6 -> raw.put("note", " ");
                case 7 -> {
                    ArrayNode points = (ArrayNode) raw.get("points");
                    for (int i = 2; i < 65; i++) points.add(point.deepCopy().put("id", "extra" + i));
                }
                case 8 -> {
                    ArrayNode arcs = (ArrayNode) raw.get("arcs");
                    while (arcs.size() < 129) arcs.add(arcs.get(0).deepCopy());
                }
                case 9 -> point.put("value", 1);
            }
            assertInvalid(raw);
        }
        ObjectNode maximum = resource("ai-456512-native-16.json");
        maximum.put("variable", "x".repeat(64));
        maximum.put("note", "x".repeat(2000));
        ((ObjectNode) maximum.path("points").get(0)).put("value", "x".repeat(500));
        assertLossless(maximum, project(maximum), "number_line_v2");
    }

    private static void assertResourceHash(String name, String expected) throws Exception {
        try (var stream = NativeFigureAdapterTest.class.getResourceAsStream("/b2b/" + name)) {
            assertThat(stream).isNotNull();
            String actual = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(stream.readAllBytes()));
            assertThat(actual).as("immutable fixture bytes: " + name).isEqualTo(expected);
        }
    }

    private static ObjectNode resource(String name) throws Exception {
        try (var stream = NativeFigureAdapterTest.class.getResourceAsStream("/b2b/" + name)) {
            assertThat(stream).isNotNull();
            return (ObjectNode) JSON.readTree(stream);
        }
    }

    private static JsonNode project(JsonNode raw) {
        var body = B2bAiResponseValidatorTest.body();
        var step = (ObjectNode) body.path("ocr").path("steps").get(0);
        step.set("figure", raw);
        step.set("lines", JSON.createArrayNode());
        var fixture = new B2bAiResponseValidatorTest();
        var parsed = fixture.parse(body);
        assertThat(parsed.diagrams()).isEmpty();
        return JSON.valueToTree(parsed.document()).path("ocr").path("blocks").get(0).path("content").path("diagram");
    }

    private static void assertLossless(JsonNode raw, JsonNode result, String type) {
        ObjectNode expected = ((ObjectNode) raw).deepCopy();
        expected.remove("kind");
        expected.put("type", type);
        assertThat(result).isEqualTo(expected);
    }

    private static void assertInvalid(JsonNode raw) {
        assertThatThrownBy(() -> project(raw)).extracting("code").isEqualTo("invalid_ai_response");
    }
}
