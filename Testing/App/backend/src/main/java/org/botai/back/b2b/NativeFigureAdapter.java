package org.botai.back.b2b;

import java.util.Map;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Lossless reader figure adaptation. Canonical v2 validation runs before persistence. */
public final class NativeFigureAdapter {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private NativeFigureAdapter() { }

    /**
     * Preserve source strings, nullable inclusion/signs, sparse arcs, bounds and loops exactly.
     * Coordinates are source material: mathematical evaluation belongs to the diagram editor.
     * Unknown fields survive here so that the strict canonical validator rejects them, rather
     * than silently removing potentially meaningful or unsafe source data.
     */
    public static Map<String, Object> adapt(JsonNode figure) {
        if (figure == null || !figure.isObject() || !figure.path("kind").isString()
                || !Set.of("number_line", "unit_circle").contains(figure.get("kind").asText())
                || figure.has("type")) {
            throw new IllegalArgumentException("Invalid native figure");
        }
        Map<String, Object> result = JSON.convertValue(figure, Map.class);
        result.put("type", result.remove("kind") + "_v2");
        return result;
    }
}
