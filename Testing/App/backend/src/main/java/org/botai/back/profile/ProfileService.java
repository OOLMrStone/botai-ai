package org.botai.back.profile;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.ApiException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;
import static org.botai.back.profile.ProfileDtos.*;

@Service
@RequiredArgsConstructor
@Transactional(readOnly=true)
public class ProfileService {
    private final ProfileRepository profiles;
    private final JdbcClient jdbc;
    public Profile get(UUID user) { return profiles.get(user); }
    @Transactional public Profile patch(UUID user,Patch patch) { profiles.patch(user,patch);return get(user); }
    public Stats stats(UUID user) {
        return stats(user,Instant.now());
    }
    public Stats stats(UUID user,Instant now) {
        var profile=get(user);LocalDate today=now.atZone(ZoneId.of(profile.timeZone())).toLocalDate();
        var days=jdbc.sql("SELECT local_date,qualified,active_seconds FROM user_activity_days WHERE user_id=:user ORDER BY local_date DESC").param("user",user)
            .query((r,n)->new Day(r.getObject("local_date",LocalDate.class),r.getBoolean("qualified"),r.getInt("active_seconds")/60)).list();
        Map<LocalDate,Day> map=new HashMap<>();days.forEach(day->map.put(day.date(),day));
        LocalDate cursor=map.getOrDefault(today,new Day(today,false,0)).qualified()?today:today.minusDays(1);int streak=0;
        while(map.getOrDefault(cursor,new Day(cursor,false,0)).qualified()) { streak++;cursor=cursor.minusDays(1); }
        LocalDate monday=today.with(java.time.temporal.TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        List<Day> week=new ArrayList<>();for(int i=0;i<7;i++){LocalDate date=monday.plusDays(i);week.add(map.getOrDefault(date,new Day(date,false,0)));}
        int xp=jdbc.sql("SELECT count(*)*10 FROM user_task_results WHERE user_id=:user AND first_solved_at IS NOT NULL").param("user",user).query(Integer.class).single();
        UUID resume=jdbc.sql("SELECT id FROM attempts WHERE user_id=:user AND status<>'completed' AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT 1").param("user",user).query(UUID.class).optional().orElse(null);
        return new Stats(xp,streak,profile.dailyGoalMinutes(),map.getOrDefault(today,new Day(today,false,0)).minutes(),today,profile.timeZone(),week,resume);
    }
    @Transactional public Stats activity(UUID user,Activity event) {
        jdbc.sql("SELECT id FROM users WHERE id=:user FOR UPDATE").param("user",user).query(UUID.class).single();
        var existing=jdbc.sql("SELECT user_id,attempt_id,requested_seconds FROM activity_events WHERE id=:id").param("id",event.id()).query((r,n)->Map.of("user",r.getObject("user_id",UUID.class),"attempt",r.getObject("attempt_id",UUID.class),"seconds",r.getInt("requested_seconds"))).optional();
        if(existing.isPresent()) {
            if(!existing.get().get("user").equals(user)||!existing.get().get("attempt").equals(event.attemptId())||!existing.get().get("seconds").equals(event.seconds()))throw ApiException.conflict("activity_conflict");
            return stats(user);
        }
        if(jdbc.sql("SELECT EXISTS(SELECT 1 FROM activity_timer_state WHERE user_id=:user)").param("user",user).query(Boolean.class).single())throw ApiException.conflict("activity_timer_required");
        Instant started=jdbc.sql("SELECT created_at FROM attempts WHERE id=:id AND user_id=:user AND status<>'completed' AND deleted_at IS NULL").param("id",event.attemptId()).param("user",user).query((r,n)->r.getTimestamp(1).toInstant()).optional().orElseThrow(ApiException::notFound);
        Instant last=jdbc.sql("SELECT created_at FROM activity_events WHERE user_id=:user ORDER BY created_at DESC LIMIT 1").param("user",user).query((r,n)->r.getTimestamp(1).toInstant()).optional().orElse(started);
        Instant earliest=last.isAfter(started)?last:started;
        int accepted=(int)Math.max(0,Math.min(Math.min(event.seconds(),60),Duration.between(earliest,Instant.now()).getSeconds()));
        jdbc.sql("INSERT INTO activity_events(id,user_id,attempt_id,seconds,requested_seconds) VALUES(:id,:user,:attempt,:seconds,:requested)").param("id",event.id()).param("user",user).param("attempt",event.attemptId()).param("seconds",accepted).param("requested",event.seconds()).update();
        var profile=get(user);LocalDate today=LocalDate.now(ZoneId.of(profile.timeZone()));
        jdbc.sql("INSERT INTO user_activity_days(user_id,local_date,active_seconds) VALUES(:user,:date,:seconds) ON CONFLICT(user_id,local_date) DO UPDATE SET active_seconds=user_activity_days.active_seconds+excluded.active_seconds")
            .param("user",user).param("date",today).param("seconds",accepted).update();
        return stats(user);
    }
    @Transactional(propagation=Propagation.MANDATORY)
    public void acceptGraded(UUID userId,UUID taskId,UUID submissionId,int score,int maxScore,boolean isDemo) {
        if(isDemo)return;
        // The accepted result is the authority; callers cannot manufacture progress flags.
        boolean eligible=jdbc.sql("SELECT EXISTS(SELECT 1 FROM grading_results r JOIN grading_submissions s ON s.id=r.submission_id JOIN task_versions v ON v.id=s.task_version_id WHERE r.submission_id=:id AND s.user_id=:user AND v.task_id=:task AND r.is_graded AND NOT r.is_demo AND NOT v.is_demo AND r.score=:score AND r.max_score=:maximum AND s.status='graded')")
            .param("id",submissionId).param("user",userId).param("task",taskId).param("score",score).param("maximum",maxScore).query(Boolean.class).single();
        if(!eligible)throw new IllegalStateException("Progress requires accepted real result");
        jdbc.sql("INSERT INTO user_task_results(user_id,task_id,submission_id,first_solved_at,last_solved_at) VALUES(:user,:task,:submission,CASE WHEN :solved THEN now() END,CASE WHEN :solved THEN now() END) ON CONFLICT(user_id,task_id) DO UPDATE SET submission_id=excluded.submission_id,first_solved_at=coalesce(user_task_results.first_solved_at,excluded.first_solved_at),last_solved_at=coalesce(excluded.last_solved_at,user_task_results.last_solved_at)")
            .param("user",userId).param("task",taskId).param("submission",submissionId).param("solved",score==maxScore).update();
        LocalDate today=LocalDate.now(ZoneId.of(get(userId).timeZone()));
        jdbc.sql("INSERT INTO user_activity_days(user_id,local_date,qualified) VALUES(:user,:date,true) ON CONFLICT(user_id,local_date) DO UPDATE SET qualified=true").param("user",userId).param("date",today).update();
    }
}
