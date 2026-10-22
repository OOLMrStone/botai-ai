package org.botai.back.b2b;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.botai.back.grading.SubmissionStore;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class LocalDemoFailureTest {
    private static final org.botai.back.common.JsonCodec JSON=B2bAiResponseValidatorTest.JSON;
    @Test void preservesClassificationAttemptsAndExactSafeIssuesWithoutRawContents() {
        var raw=JSON.read("""
            {"failure_category":"model_response","diagnostic_code":606,"reason_code":"missing_source_lines",
             "phase":"layout","step":"layout","attempt":4,"max_attempts":4,"failure_counts":{"model_response":3,"network":1},
             "retryable":false,"exhausted":true,"issue_codes":["missing_source_lines"],"issue_paths":["$.steps[2].line_ids"],
             "prompt":"PRIVATE","response":"PRIVATE","headers":{"authorization":"PRIVATE"},"url":"https://private"}
            """);
        var safe=LocalDemoEvents.safeData(raw);
        assertThat(safe).containsEntry("diagnosticCode",606).containsEntry("failureCategory","model_response")
            .containsEntry("attempt",4).containsEntry("maxAttempts",4).containsEntry("issuePaths",List.of("$.steps[2].line_ids"));
        assertThat(safe).doesNotContainKeys("prompt","response","headers","url");
        var failure=LocalDemoFailure.failure(JSON.read(JSON.write(safe)));
        assertThat(failure).containsEntry("category","model_response").containsEntry("failureCounts",Map.of("model_response",3,"network",1)).doesNotContainKey("failureCategory");
    }
    @Test void rejectsOutOfRangeContradictoryAndUnsafeFacts() {
        var safe=LocalDemoFailure.safe(JSON.read("""
            {"failure_category":"network","diagnostic_code":602,"reason_code":"PRIVATE text","phase":"/private/path",
             "step":"https://private","attempt":5,"max_attempts":3,"failure_counts":{"network":5,"secret":1},
             "retryable":"true","exhausted":1,"issue_codes":["safe_code","private text"],
             "issue_paths":["$.analysis","/private/file","$.x['secret text']"]}
            """));
        assertThat(safe).containsOnly(entry("failureCategory","network"),entry("issueCodes",List.of("safe_code")),entry("issuePaths",List.of("$.analysis")));
        assertThat(LocalDemoFailure.failure(JSON.read("{\"errorCode\":\"llm_error\"}"))).isNull();
        assertThat(LocalDemoEvents.safeData(JSON.read("{\"failure_category\":\"network\",\"attempt\":5}"))).doesNotContainKeys("attempt","maxAttempts");
    }
    @Test void terminalFactsTakePrecedenceAndOldEventsDoNotInventAttemptCounts() {
        var store=mock(SubmissionStore.class);var db=mock(JdbcTemplate.class);when(store.db()).thenReturn(db);when(store.json()).thenReturn(JSON);
        var events=new LocalDemoEvents(store,mock(TransactionTemplate.class));var submission=UUID.randomUUID();
        when(db.queryForList(anyString(),eq(submission))).thenReturn(List.of(
            Map.of("metadata","{\"data\":{\"errorCode\":\"llm_bad_response\"}}"),
            Map.of("metadata","{\"data\":{\"failureCategory\":\"network\",\"diagnosticCode\":401,\"reasonCode\":\"provider_connection_error\"}}")));
        assertThat(events.failure(submission)).containsEntry("category","network").containsEntry("diagnosticCode",401).doesNotContainKeys("attempt","maxAttempts");
    }
}
