package org.botai.back.grading.port;

import org.botai.back.catalog.TaskSnapshot;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface GradingGateway {
    record Capability(int taskNumber, int maxScore, boolean supported, String packageId, String providerMode) { }
    record Image(UUID id, byte[] bytes, String mimeType) { }
    record Response(String exactJson, String providerMode, String packageId, String rejectionCode) { }
    Map<Integer, Capability> capabilities();
    Response grade(UUID runId, TaskSnapshot task, List<Image> images, String pinnedPackageId);
}
