package org.botai.back.b2b;

import java.util.*;
import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.grading.AiResponseValidator;
import org.botai.back.grading.port.GradingGateway;

/** Versioned private v2 boundary; deliberately has no legacy transport fallback. */
public interface B2bGradingGateway {
 record Validated(GradingGateway.Response raw,AiResponseValidator.Validated result,TaskSnapshot task) { }
 Map<Integer,GradingGateway.Capability> capabilities();
 default int concurrency(){return 1;}
 default int availableRunRecords(){return 1;}
 default boolean acknowledge(UUID runId){return false;}
 default boolean gradeAnalysisAvailable(){return false;}
 Validated grade(UUID runId,UUID submissionId,long fencingToken,TaskSnapshot task,List<GradingGateway.Image> images,String pinnedPackage,String expectedMode);
}
