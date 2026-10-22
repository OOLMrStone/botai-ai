package org.botai.back.catalog;

import org.botai.back.common.JsonCodec;
import tools.jackson.databind.JsonNode;

/** Происхождение остаётся в аудите, но не показывается ученику. */
final class CatalogSources {
    private CatalogSources() { }
    static JsonNode project(JsonNode stored,JsonCodec json) {
        return json.read("[]");
    }
}
