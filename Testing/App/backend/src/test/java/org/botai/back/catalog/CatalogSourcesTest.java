package org.botai.back.catalog;

import org.botai.back.common.JsonCodec;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.assertThat;

class CatalogSourcesTest {
    private final JsonCodec json=new JsonCodec(JsonMapper.builder().build());
    @Test void hidesProviderWithoutChangingStoredProvenance() {
        var stored=json.read("""
            [{"provider":"shkolkovo","externalId":"92097","sourceUrl":"https://3.shkolkovo.online/catalog/203/92097","originalPublisher":null,"originalReferences":[{"publisher":"ФИПИ","label":"Банк ФИПИ","url":null,"year":2024,"examNumber":4}]}]
            """);
        String before=json.write(stored);String publicJson=json.write(CatalogSources.project(stored,json));
        assertThat(publicJson).isEqualTo("[]");
        assertThat(json.write(stored)).isEqualTo(before);
    }
    @Test void missingProvenanceAlsoReturnsCompatibleEmptyArray() {
        assertThat(CatalogSources.project(null,json).isArray()).isTrue();
        assertThat(CatalogSources.project(null,json).isEmpty()).isTrue();
    }
}
