package org.botai.back.catalog;

import tools.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;

public final class CatalogDtos {
    private CatalogDtos() { }
    public record Format(String id,int version,String title,int totalTasks,int maxPoints) { }
    public record Topic(String id,String title,int availableCount,String sourceUrl) { }
    public record Number(int examNumber,int part,String title,String responseType,int maxPoints,String gradingCapability,int availableCount,List<Topic> topics) { }
    public record Catalog(Format format,List<Number> numbers) { }
    public record Task(UUID id,UUID taskVersionId,int version,int examNumber,int part,List<String> topicIds,@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS) Integer difficulty,boolean isGrob,
                       String responseType,int maxPoints,JsonNode content,boolean isFavourite,String progressStatus,
                       String gradingCapability,boolean isDemo,@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS) Integer sourceYear,JsonNode sources) { }
    public record Solution(@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS) String referenceAnswer,String referenceSolution,JsonNode referenceContent,JsonNode referenceAnswerContent) { }
}
