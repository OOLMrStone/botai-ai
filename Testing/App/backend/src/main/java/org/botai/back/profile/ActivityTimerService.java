package org.botai.back.profile;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.UUID;
import static org.botai.back.profile.ActivityTimerDtos.*;

@Service
@RequiredArgsConstructor
@Transactional
public class ActivityTimerService {
    public static final int HEARTBEAT_SECONDS = 15;
    public static final int MAX_GAP_SECONDS = 45;
    private static final long NANOS_PER_SECOND = 1_000_000_000L;
    private final JdbcClient jdbc;
    private final ProfileService profiles;
    private final ActivityTimerClock clock;
    private final JsonCodec json;
    private final ObjectMapper mapper;

    private record State(UUID session, UUID client, UUID attempt, boolean active, Instant acknowledged) { }
    private record Event(UUID owner, String hash, String response) { }

    /** Reads reconcile the canonical state without crediting time or renewing a lease. */
    public TimerState get(UUID user) {
        lock(user);
        Instant now = serverNow();
        return view(user, state(user), now, 0);
    }

    public TimerState start(UUID user, Start request) {
        lock(user);
        lockEvent(request.eventId());
        Instant now = serverNow(); // Read after lock acquisition, never transaction-start DB now().
        String hash = json.hash(new Object[]{"start", request});
        TimerState replay = replay(user, request.eventId(), hash);
        if (replay != null) return replay;
        requireAttempt(user, request.attemptId());
        State previous = state(user);
        Instant anchor = previous == null ? now : later(now, previous.acknowledged());
        State next = new State(UUID.randomUUID(), request.clientId(), request.attemptId(), true, anchor);
        // A takeover/reload discards the unacknowledged prior interval.
        save(user, next);
        TimerState response = view(user, next, now, 0);
        remember(user, request.eventId(), next.attempt(), hash, 0, response, now);
        return response;
    }

    public TimerState heartbeat(UUID user, Tick request) { return tick(user, request, false); }
    public TimerState pause(UUID user, Tick request) { return tick(user, request, true); }

    private TimerState tick(UUID user, Tick request, boolean pause) {
        lock(user);
        lockEvent(request.eventId());
        Instant now = serverNow();
        String hash = json.hash(new Object[]{pause ? "pause" : "heartbeat", request});
        TimerState replay = replay(user, request.eventId(), hash);
        if (replay != null) return replay;
        State current = state(user);
        if (current == null || !current.session().equals(request.sessionId()) || !current.active())
            throw ApiException.conflict("activity_session_stale");
        Instant cutoff;
        if (pause) cutoff = pauseCutoff(user, current.attempt(), current.acknowledged(), now);
        else {
            requireAttempt(user, current.attempt());
            cutoff = later(now, current.acknowledged());
        }
        Instant anchor = later(now, current.acknowledged());
        Duration elapsed = Duration.between(current.acknowledged(), anchor);
        // Expiration reanchors with zero credit; offline/backdated intervals are never capped into credit.
        long nanos = elapsed.compareTo(Duration.ofSeconds(MAX_GAP_SECONDS)) <= 0
            ? Duration.between(current.acknowledged(), cutoff).toNanos() : 0;
        int accepted = nanos == 0 ? 0 : creditDays(user, current.acknowledged(), cutoff);
        State next = new State(current.session(), current.client(), current.attempt(), !pause, anchor);
        save(user, next);
        // Persist the interval before constructing totals, inside the same locked transaction.
        remember(user, request.eventId(), next.attempt(), hash, nanos, null, now);
        TimerState response = view(user, next, now, accepted);
        jdbc.sql("UPDATE activity_timer_events SET response=CAST(:response AS jsonb) WHERE event_id=:event")
            .param("response", json.write(response)).param("event", request.eventId()).update();
        return response;
    }

    private void lock(UUID user) {
        jdbc.sql("SELECT id FROM users WHERE id=:user AND enabled FOR UPDATE")
            .param("user", user).query(UUID.class).optional().orElseThrow(ApiException::notFound);
    }

    private void lockEvent(UUID event) {
        // Different owners can race on the same UUID; serialize before checking the global ledger key.
        jdbc.sql("SELECT pg_advisory_xact_lock(hashtextextended(:event,0))")
            .param("event", event.toString()).query((r,n) -> 0).single();
    }

    private boolean available(UUID user, UUID attempt) {
        return jdbc.sql("SELECT EXISTS(SELECT 1 FROM attempts WHERE id=:attempt AND user_id=:user AND status<>'completed' AND deleted_at IS NULL)")
            .param("attempt", attempt).param("user", user).query(Boolean.class).single();
    }

    private void requireAttempt(UUID user, UUID attempt) {
        if (!available(user, attempt)) throw ApiException.notFound();
    }

    private Instant pauseCutoff(UUID user, UUID attempt, Instant acknowledged, Instant now) {
        record Completion(String status, Instant at) { }
        Completion completion = jdbc.sql("SELECT status,completed_at FROM attempts WHERE id=:attempt AND user_id=:user AND deleted_at IS NULL")
            .param("attempt", attempt).param("user", user)
            .query((r,n) -> new Completion(r.getString("status"),
                r.getTimestamp("completed_at") == null ? null : r.getTimestamp("completed_at").toInstant()))
            .optional().orElseThrow(ApiException::notFound);
        if (!"completed".equals(completion.status())) return later(now, acknowledged);
        // Completion may precede the frontend's final pause. Only its reliable foreground tail is eligible.
        // An absent/future completion timestamp cannot manufacture activity; close with zero credit.
        if (completion.at() == null || completion.at().isAfter(now)) return acknowledged;
        return later(completion.at(), acknowledged);
    }

    private State state(UUID user) {
        return jdbc.sql("SELECT * FROM activity_timer_state WHERE user_id=:user").param("user", user)
            .query((r,n) -> new State(r.getObject("session_id", UUID.class), r.getObject("client_id", UUID.class),
                r.getObject("attempt_id", UUID.class), r.getBoolean("active"), r.getTimestamp("acknowledged_at").toInstant()))
            .optional().orElse(null);
    }

    private void save(UUID user, State state) {
        jdbc.sql("""
            INSERT INTO activity_timer_state(user_id,session_id,client_id,attempt_id,active,acknowledged_at)
            VALUES(:user,:session,:client,:attempt,:active,:at)
            ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,client_id=excluded.client_id,
                attempt_id=excluded.attempt_id,active=excluded.active,acknowledged_at=excluded.acknowledged_at
            """).param("user", user).param("session", state.session()).param("client", state.client())
            .param("attempt", state.attempt()).param("active", state.active())
            .param("at", OffsetDateTime.ofInstant(state.acknowledged(), ZoneOffset.UTC)).update();
    }

    private TimerState replay(UUID user, UUID event, String hash) {
        Event existing = jdbc.sql("SELECT user_id,request_hash,response::text FROM activity_timer_events WHERE event_id=:event")
            .param("event", event).query((r,n) -> new Event(r.getObject(1, UUID.class), r.getString(2), r.getString(3)))
            .optional().orElse(null);
        if (existing == null) return null;
        if (!existing.owner().equals(user) || !existing.hash().equals(hash)) throw ApiException.conflict("activity_event_conflict");
        return mapper.readValue(existing.response(), TimerState.class);
    }

    private void remember(UUID user, UUID event, UUID attempt, String hash, long nanos, TimerState response, Instant now) {
        jdbc.sql("""
            INSERT INTO activity_timer_events(event_id,user_id,attempt_id,request_hash,accepted_nanos,response,created_at)
            VALUES(:event,:user,:attempt,:hash,:nanos,CAST(:response AS jsonb),:at)
            """).param("event", event).param("user", user).param("attempt", attempt).param("hash", hash)
            .param("nanos", nanos).param("response", json.write(response))
            .param("at", OffsetDateTime.ofInstant(now, ZoneOffset.UTC)).update();
    }

    private int creditDays(UUID user, Instant from, Instant until) {
        ZoneId zone = ZoneId.of(profiles.get(user).timeZone());
        int accepted = 0;
        while (from.isBefore(until)) {
            LocalDate date = from.atZone(zone).toLocalDate();
            Instant midnight = date.plusDays(1).atStartOfDay(zone).toInstant();
            Instant end = midnight.isBefore(until) ? midnight : until;
            long nanos = Duration.between(from, end).toNanos();
            int remainder = jdbc.sql("SELECT timer_remainder_nanos FROM user_activity_days WHERE user_id=:user AND local_date=:date")
                .param("user", user).param("date", date).query(Integer.class).optional().orElse(0);
            long total = nanos + remainder;
            int seconds = (int)(total / NANOS_PER_SECOND);
            jdbc.sql("""
                INSERT INTO user_activity_days(user_id,local_date,active_seconds,timer_remainder_nanos)
                VALUES(:user,:date,:seconds,:remainder)
                ON CONFLICT(user_id,local_date) DO UPDATE SET active_seconds=user_activity_days.active_seconds+excluded.active_seconds,
                    timer_remainder_nanos=excluded.timer_remainder_nanos
                """).param("user", user).param("date", date).param("seconds", seconds)
                .param("remainder", (int)(total % NANOS_PER_SECOND)).update();
            accepted += seconds;
            from = end;
        }
        return accepted;
    }

    private TimerState view(UUID user, State state, Instant now, int accepted) {
        ProfileDtos.Stats stats = profiles.stats(user, now);
        int daily = jdbc.sql("SELECT active_seconds FROM user_activity_days WHERE user_id=:user AND local_date=:date")
            .param("user", user).param("date", stats.date()).query(Integer.class).optional().orElse(0);
        long attempt = state == null ? 0 : jdbc.sql("""
            SELECT (SELECT floor(coalesce(sum(accepted_nanos),0)/1000000000)::bigint FROM activity_timer_events WHERE user_id=:user AND attempt_id=:attempt)
                 + (SELECT coalesce(sum(seconds),0) FROM activity_events WHERE user_id=:user AND attempt_id=:attempt)
            """).param("user", user).param("attempt", state.attempt()).query(Long.class).single();
        boolean active = state != null && state.active() && available(user, state.attempt())
            && Duration.between(state.acknowledged(), later(now, state.acknowledged())).compareTo(Duration.ofSeconds(MAX_GAP_SECONDS)) <= 0;
        return new TimerState(state == null ? null : state.session(), state == null ? null : state.client(),
            state == null ? null : state.attempt(), active, state == null ? null : state.acknowledged(), now,
            HEARTBEAT_SECONDS, MAX_GAP_SECONDS, accepted, daily, attempt, stats);
    }

    private Instant serverNow() { return clock.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS); }

    private Instant later(Instant first, Instant second) { return first.isAfter(second) ? first : second; }
}
