package org.botai.back.expert;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.ApiException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ExpertGradingCoordinator {
    private final ExpertService service;
    private final ExpertGradingGateway gateway;
    @org.springframework.transaction.annotation.Transactional(propagation=org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public JsonNode grade(Authentication auth, UUID workId, String key, ExpertDtos.Save request) {
        var started = service.prepareGrade(auth, workId, key, request);
        if (started.request() == null) return started.replay();
        try {
            var response = gateway.grade(started.request());
            return service.finishGrade(auth, started, response);
        } catch (ApiException error) {
            String state = java.util.Set.of("grading_unavailable", "expert_grading_rejected").contains(error.code()) ? "failed" : error.status() < 500 ? "stale" : "unknown";
            service.failGrade(started.jobId(), state, error.code(),error instanceof org.botai.back.b2b.B2bAiException ai?ai.failure():null);
            if (error.status() < 500) throw error;
            return service.gradeJob(auth, workId, started.jobId());
        } catch (RuntimeException error) {
            service.failGrade(started.jobId(), "unknown", "unknown_after_dispatch");
            return service.gradeJob(auth, workId, started.jobId());
        }
    }
    public void executeQueued(UUID jobId) {
        ExpertService.QueuedGrade queued;
        try { queued=service.admittedGrade(jobId); }
        catch(RuntimeException error){service.failGrade(jobId,"failed",error instanceof ApiException api?api.code():"grading_unavailable");return;}
        try {var response=gateway.grade(queued.started().request());service.finishGrade(queued.auth(),queued.started(),response);}
        catch(ApiException error){String state=java.util.Set.of("grading_unavailable","expert_grading_rejected").contains(error.code())?"failed":error.status()<500?"stale":"unknown";service.failGrade(jobId,state,error.code(),error instanceof org.botai.back.b2b.B2bAiException ai?ai.failure():null);}
        catch(RuntimeException error){service.failGrade(jobId,"unknown","unknown_after_dispatch");}
    }

}
