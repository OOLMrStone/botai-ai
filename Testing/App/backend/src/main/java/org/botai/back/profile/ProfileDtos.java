package org.botai.back.profile;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class ProfileDtos {
    private ProfileDtos() { }
    public record Profile(UUID id,String email,String displayName,Instant registeredAt,String avatarUrl,String goalId,String levelId,int dailyGoalMinutes,String timeZone,boolean notificationsEnabled,String plan,List<String> features) { }
    public record Patch(@Size(max=100) String displayName,@Size(max=32) String goalId,@Size(max=32) String levelId,@Min(1) @Max(240) Integer dailyGoalMinutes,Boolean notificationsEnabled) { }
    public record Activity(@NotNull UUID id,@NotNull UUID attemptId,@Min(1) @Max(60) int seconds) { }
    public record Day(LocalDate date,boolean qualified,int minutes) { }
    public record Stats(int xp,int streakDays,int dailyGoalMinutes,int dailyProgressMinutes,LocalDate date,String timeZone,List<Day> week,UUID resumeAttempt) { }
}
