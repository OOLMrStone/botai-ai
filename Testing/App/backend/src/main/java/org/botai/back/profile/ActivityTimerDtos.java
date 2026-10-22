package org.botai.back.profile;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.UUID;

public final class ActivityTimerDtos {
    private ActivityTimerDtos() { }
    public record Start(@NotNull UUID eventId, @NotNull UUID attemptId, @NotNull UUID clientId) { }
    public record Tick(@NotNull UUID eventId, @NotNull UUID sessionId) { }
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS)
    public record TimerState(UUID sessionId, UUID clientId, UUID attemptId, boolean active,
        Instant lastAcknowledgedAt, Instant serverNow, int heartbeatSeconds, int maxGapSeconds,
        int acceptedSeconds, int dailyActiveSeconds, long attemptActiveSeconds, ProfileDtos.Stats stats) { }
}
