package org.botai.back.expert;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.JsonCodec;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import java.util.*;

@Component
@RequiredArgsConstructor
public class ExpertGradingBasis {
    private final JsonCodec json;
    public String hash(JsonNode document) {
        var input = new TreeMap<String,Object>();
        input.put("ocr", ordered(document.get("ocr")));
        var analysis = document.get("analysis");
        if (analysis == null || analysis.isNull()) input.put("analysis", analysis);
        else {
            var normalized = new TreeMap<String,Object>();
            for (var entry : analysis.properties()) {
                if (entry.getKey().equals("block_reviews")) {
                    List<JsonNode> reviews = new ArrayList<>(); entry.getValue().forEach(reviews::add);
                    reviews.sort(Comparator.comparing(review -> review.path("block_id").asText()));
                    normalized.put(entry.getKey(), reviews.stream().map(this::ordered).toList());
                } else normalized.put(entry.getKey(), ordered(entry.getValue()));
            }
            input.put("analysis", normalized);
        }
        return json.hash(input);
    }
    public String requestHash(int revision, JsonNode document) {
        var request = new TreeMap<String,Object>(); request.put("expectedRevision", revision); request.put("document", ordered(document)); return json.hash(request);
    }
    private Object ordered(JsonNode node) {
        if (node == null || !node.isContainer()) return node;
        if (node.isObject()) { var result = new TreeMap<String,Object>(); for (var entry : node.properties()) result.put(entry.getKey(), ordered(entry.getValue())); return result; }
        List<Object> result = new ArrayList<>(); node.forEach(item -> result.add(ordered(item))); return result;
    }
}
