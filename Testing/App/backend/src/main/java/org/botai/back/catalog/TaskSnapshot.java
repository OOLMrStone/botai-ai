package org.botai.back.catalog;

import java.util.List;
import java.util.UUID;

public record TaskSnapshot(UUID id, UUID taskVersionId, int taskNumber, int maxScore,
                           String statement, String referenceAnswer, String referenceSolution,
                           List<String> acceptedAnswers, boolean isDemo) { }
