package org.botai.back.attempt;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.botai.back.catalog.CatalogDtos;
import tools.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AttemptDtos {
    private AttemptDtos() { }
    public record Selection(@Min(1) @Max(20) int examNumber,@Size(max=140) List<String> topicIds,@Min(1) @Max(20) int count) { }
    public record TrainingRequest(@NotBlank @Size(max=64) String formatId,@NotNull @Size(max=20) List<@Valid Selection> selections,
                                  @Min(1) @Max(5) Integer difficulty,String source,@Size(max=50) List<UUID> taskIds,@Min(0) @Max(100) Integer difficultyPreference) {
        public TrainingRequest(String formatId,List<Selection> selections,Integer difficulty,String source,List<UUID> taskIds) { this(formatId,selections,difficulty,source,taskIds,null); }
    }
    public record ItemPatch(@NotNull UUID id,@Size(max=2000) String answer,JsonNode drawing) { }
    // JsonNode отличает пропущенное поле от явного null, чтобы автосохранение не сбрасывало имя.
    public record Patch(@Min(0) int revision,@Min(0) Integer currentIndex,@Size(max=50) List<@Valid ItemPatch> items,JsonNode title) {
        public Patch(int revision,Integer currentIndex,List<ItemPatch> items) { this(revision,currentIndex,items,null); }
    }
    public record SolutionReveal(@NotNull @Min(0) Integer expectedAnswerRevision,UUID expectedSubmissionId,@Min(0) Integer expectedSubmissionRevision) { }
    public record Exit(@NotNull UUID eventId) { }
    public record Item(UUID id,CatalogDtos.Task task,String answer,JsonNode drawing,int answerRevision,JsonNode submission,JsonNode result) { }
    public record Summary(int total,int answered,int graded,int earnedPoints,int maxPoints,int pending,int unsupported) { }
    public record Attempt(UUID id,String kind,UUID templateId,String formatId,String status,int revision,int currentIndex,Instant createdAt,Instant updatedAt,Instant completedAt,List<Item> items,Summary summary,String title,Instant lastExitedAt) { }
    public record Latest(UUID id,String status,Instant createdAt,Instant completedAt,Summary summary) { }
    public record Exam(UUID id,String title,Instant createdAt,int totalTasks,int maxPoints,boolean isDemo,Latest latestAttempt,UUID activeAttemptId) { }
}
