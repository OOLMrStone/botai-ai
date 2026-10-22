package org.botai.back.expert;

import org.botai.back.catalog.TaskSnapshot;
import tools.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;

/** Grading from an existing analysis; never runs OCR or mathematical analysis. */
public interface ExpertGradingGateway {
    record Request(UUID requestId, TaskSnapshot task, JsonNode analysis,
                   List<String> ocrBlockIds, String packageId, String providerMode,boolean b2b) {
        public Request(UUID requestId,TaskSnapshot task,JsonNode analysis,List<String> ids,String packageId,String providerMode){this(requestId,task,analysis,ids,packageId,providerMode,false);}
    }
    record Response(JsonNode grading, String providerMode, String packageId) { }
    Response grade(Request request);
}
