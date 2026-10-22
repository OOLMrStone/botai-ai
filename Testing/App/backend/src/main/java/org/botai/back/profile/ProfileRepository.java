package org.botai.back.profile;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.ApiException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.UUID;
import static org.botai.back.profile.ProfileDtos.*;

@Repository
@RequiredArgsConstructor
public class ProfileRepository {
    private final JdbcClient jdbc;
    private final org.botai.back.billing.BillingEntitlements billing;
    public Profile get(UUID user) {
        return jdbc.sql("SELECT * FROM users WHERE id=:id AND enabled").param("id",user).query((r,n)->new Profile(user,r.getString("email"),r.getString("display_name"),r.getTimestamp("created_at").toInstant(),
            r.getObject("avatar_object_id")==null?null:"/api/media/"+r.getObject("avatar_object_id"),r.getString("goal_id"),r.getString("level_id"),r.getInt("daily_goal_minutes"),r.getString("time_zone"),r.getBoolean("notifications_enabled"),r.getString("plan_id"),("pro".equals(r.getString("plan_id"))||billing.hasAccess(user))?List.of("aiReview"):List.of())).optional().orElseThrow(ApiException::notFound);
    }
    public void patch(UUID user,Patch patch) {
        if(patch.goalId()!=null&&!jdbc.sql("SELECT EXISTS(SELECT 1 FROM preparation_goals WHERE id=:id)").param("id",patch.goalId()).query(Boolean.class).single())throw ApiException.invalid("Неизвестная цель");
        if(patch.levelId()!=null&&!jdbc.sql("SELECT EXISTS(SELECT 1 FROM preparation_levels WHERE id=:id)").param("id",patch.levelId()).query(Boolean.class).single())throw ApiException.invalid("Неизвестный уровень");
        jdbc.sql("UPDATE users SET display_name=coalesce(:name,display_name),goal_id=coalesce(:goal,goal_id),level_id=coalesce(:level,level_id),daily_goal_minutes=coalesce(:minutes,daily_goal_minutes),notifications_enabled=coalesce(:notifications,notifications_enabled),updated_at=now() WHERE id=:id")
            .param("name",patch.displayName()).param("goal",patch.goalId()).param("level",patch.levelId()).param("minutes",patch.dailyGoalMinutes()).param("notifications",patch.notificationsEnabled()).param("id",user).update();
    }
}
