package org.botai.back.expert;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import tools.jackson.databind.JsonNode;
import java.util.UUID;

public final class ExpertDtos {
    private ExpertDtos() { }
    public record Assign(@NotNull UUID studentId) { }
    public record Route(@NotNull UUID schoolId) { }
    public record Save(@NotNull @Min(0) Integer expectedRevision, @NotNull JsonNode document) { }
}
