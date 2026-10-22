package org.botai.back.profile;

import org.botai.back.attempt.AttemptDtos;
import org.botai.back.attempt.AttemptService;
import org.botai.back.catalog.CatalogRepository;
import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.botai.back.user.User;
import org.botai.back.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.botai.back.profile.ActivityTimerDtos.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties={"spring.docker.compose.enabled=false","management.server.port=0","app.grading.worker-enabled=false"})
@AutoConfigureTestRestTemplate
@Testcontainers
class ActivityTimerIntegrationTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @Autowired ActivityTimerService timers;
    @Autowired ProfileService profiles;
    @Autowired AttemptService attempts;
    @Autowired UserRepository users;
    @Autowired JdbcClient jdbc;
    @Autowired JsonCodec json;
    @Autowired TestRestTemplate rest;
    @Autowired PasswordEncoder passwords;
    @MockitoBean ActivityTimerClock clock;
    AtomicReference<Instant> time = new AtomicReference<>();
    UUID user, attempt;
    @BeforeEach void setup() {
        time.set(Instant.parse("2026-10-07T12:00:00Z"));
        when(clock.now()).thenAnswer(invocation -> time.get());
        user = users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}test-password").build()).getId();
        attempt = attempts.startTraining(user, UUID.randomUUID().toString(), new AttemptDtos.TrainingRequest(
            CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(7,null,1)),null,"catalog",null)).id();
    }
    TimerState start() { return timers.start(user,new Start(UUID.randomUUID(),attempt,UUID.randomUUID())); }
    Tick tick(UUID session) { return new Tick(UUID.randomUUID(),session); }
    void advance(long seconds) { time.updateAndGet(now -> now.plusSeconds(seconds)); }
    int seconds(LocalDate day) { return jdbc.sql("SELECT active_seconds FROM user_activity_days WHERE user_id=:user AND local_date=:day")
        .param("user",user).param("day",day).query(Integer.class).optional().orElse(0); }

    @Test void startHeartbeatRetryAndReadNeverCreditTwiceOrRenew() {
        Start request = new Start(UUID.randomUUID(),attempt,UUID.randomUUID());
        TimerState started = timers.start(user,request);
        assertThat(started.dailyActiveSeconds()).isZero();
        advance(15); Tick heartbeat=tick(started.sessionId());
        TimerState first=timers.heartbeat(user,heartbeat);
        assertThat(first.acceptedSeconds()).isEqualTo(15);
        advance(10);
        assertThat(timers.heartbeat(user,heartbeat)).isEqualTo(first);
        assertThat(timers.start(user,request)).isEqualTo(started);
        assertThat(timers.get(user).lastAcknowledgedAt()).isEqualTo(first.lastAcknowledgedAt());
        assertThat(timers.get(user).dailyActiveSeconds()).isEqualTo(15);
        assertThat(timers.heartbeat(user,tick(started.sessionId())).dailyActiveSeconds()).isEqualTo(25);
        assertThatThrownBy(() -> timers.pause(user,heartbeat)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("activity_event_conflict");
    }
    @Test void pauseAndReloadDiscardHiddenAndUnacknowledgedIntervals() {
        var started=start(); advance(15);
        var paused=timers.pause(user,tick(started.sessionId()));
        assertThat(paused.active()).isFalse(); assertThat(paused.dailyActiveSeconds()).isEqualTo(15);
        advance(300);
        assertThatThrownBy(() -> timers.heartbeat(user,tick(started.sessionId()))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("activity_session_stale");
        var resumed=start(); assertThat(resumed.dailyActiveSeconds()).isEqualTo(15);
        advance(10); var reloaded=start(); assertThat(reloaded.dailyActiveSeconds()).isEqualTo(15);
        advance(15); assertThat(timers.heartbeat(user,tick(reloaded.sessionId())).dailyActiveSeconds()).isEqualTo(30);
    }
    @Test void secondTabFencesBothHeartbeatAndPause() {
        var first=start(); advance(10); var second=start();
        assertThat(second.sessionId()).isNotEqualTo(first.sessionId());
        assertThatThrownBy(() -> timers.heartbeat(user,tick(first.sessionId()))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> timers.pause(user,tick(first.sessionId()))).isInstanceOf(ApiException.class);
        advance(15); assertThat(timers.heartbeat(user,tick(second.sessionId())).dailyActiveSeconds()).isEqualTo(15);
    }
    @Test void exactGapBoundaryAndSubmicrosecondClockUseDurableAnchors() {
        time.set(Instant.parse("2026-10-07T12:00:00.123456789Z")); var started=start();
        assertThat(started.lastAcknowledgedAt()).isEqualTo(Instant.parse("2026-10-07T12:00:00.123456Z"));
        assertThat(timers.get(user).lastAcknowledgedAt()).isEqualTo(started.lastAcknowledgedAt());
        advance(45); var ticked=timers.heartbeat(user,tick(started.sessionId()));
        assertThat(ticked.acceptedSeconds()).isEqualTo(45);
        assertThat(timers.get(user).lastAcknowledgedAt()).isEqualTo(ticked.lastAcknowledgedAt());
    }
    @Test void longGapAndDelayedHiddenPauseCreditZeroAndReanchor() {
        var started=start(); advance(46);
        assertThat(timers.get(user).active()).isFalse();
        assertThat(timers.heartbeat(user,tick(started.sessionId())).acceptedSeconds()).isZero();
        advance(15); assertThat(timers.heartbeat(user,tick(started.sessionId())).dailyActiveSeconds()).isEqualTo(15);
        advance(3600); var paused=timers.pause(user,tick(started.sessionId()));
        assertThat(paused.acceptedSeconds()).isZero(); assertThat(paused.active()).isFalse();
    }
    @Test void serverClockRollbackDoesNotMoveAnchorOrDoubleCredit() {
        var started=start(); advance(15); timers.heartbeat(user,tick(started.sessionId()));
        advance(-10); var backwards=timers.heartbeat(user,tick(started.sessionId()));
        assertThat(backwards.acceptedSeconds()).isZero();
        assertThat(backwards.lastAcknowledgedAt()).isEqualTo(Instant.parse("2026-10-07T12:00:15Z"));
        advance(15); assertThat(timers.heartbeat(user,tick(started.sessionId())).dailyActiveSeconds()).isEqualTo(20);
    }
    @Test void localMidnightAndFractionalSecondsArePreserved() {
        jdbc.sql("UPDATE users SET time_zone='Europe/Moscow' WHERE id=:user").param("user",user).update();
        time.set(Instant.parse("2026-10-07T20:59:50.500Z")); var started=start();
        time.set(Instant.parse("2026-10-07T21:00:10.500Z")); var result=timers.heartbeat(user,tick(started.sessionId()));
        assertThat(seconds(LocalDate.of(2026,10,7))).isEqualTo(9);
        assertThat(seconds(LocalDate.of(2026,10,8))).isEqualTo(10);
        assertThat(result.stats().date()).isEqualTo(LocalDate.of(2026,10,8));
        assertThat(result.attemptActiveSeconds()).isEqualTo(20);
        time.set(Instant.parse("2026-10-07T21:00:11Z"));
        var fractional=timers.heartbeat(user,tick(started.sessionId()));
        assertThat(fractional.dailyActiveSeconds()).isEqualTo(11);
        assertThat(fractional.attemptActiveSeconds()).isEqualTo(20);
    }
    @Test void goalMinutesUseDurableTimeWithoutAwardingXpOrStreak() {
        profiles.patch(user,new ProfileDtos.Patch(null,null,null,1,null)); var started=start();
        for(int i=0;i<4;i++) { advance(15); timers.heartbeat(user,tick(started.sessionId())); }
        var result=timers.get(user);
        assertThat(result.stats().dailyGoalMinutes()).isEqualTo(1);
        assertThat(result.stats().dailyProgressMinutes()).isEqualTo(1);
        assertThat(result.stats().xp()).isZero(); assertThat(result.stats().streakDays()).isZero();
    }
    @Test void adoptionDisablesFreshLegacyButRetainsHistoricalRetry() {
        jdbc.sql("UPDATE attempts SET created_at=now()-interval '2 minutes' WHERE id=:id").param("id",attempt).update();
        var legacy=new ProfileDtos.Activity(UUID.randomUUID(),attempt,60); var legacyStats=profiles.activity(user,legacy);
        // Legacy uses the wall clock; anchor the controlled timer to the same credited local day.
        time.set(legacyStats.date().atTime(12,0).atZone(ZoneId.of(legacyStats.timeZone())).toInstant());
        var started=start(); assertThat(started.dailyActiveSeconds()).isEqualTo(60);
        profiles.activity(user,legacy);
        assertThatThrownBy(() -> profiles.activity(user,new ProfileDtos.Activity(UUID.randomUUID(),attempt,60)))
            .isInstanceOf(ApiException.class).extracting("code").isEqualTo("activity_timer_required");
        advance(15); assertThat(timers.heartbeat(user,tick(started.sessionId())).dailyActiveSeconds()).isEqualTo(75);
    }
    @Test void foreignCompletedAndDeletedAttemptsCannotAccrueButHistoryRemains() {
        UUID foreign=users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}test-password").build()).getId();
        assertThatThrownBy(() -> timers.start(foreign,new Start(UUID.randomUUID(),attempt,UUID.randomUUID())))
            .isInstanceOf(ApiException.class).extracting("status").isEqualTo(404);
        var started=start(); advance(15); timers.heartbeat(user,tick(started.sessionId()));
        jdbc.sql("UPDATE attempts SET deleted_at=now() WHERE id=:id").param("id",attempt).update();
        assertThat(timers.get(user).active()).isFalse(); assertThat(timers.get(user).dailyActiveSeconds()).isEqualTo(15);
        assertThat(timers.get(user).stats().resumeAttempt()).isNull();
        assertThatThrownBy(() -> timers.heartbeat(user,tick(started.sessionId()))).isInstanceOf(ApiException.class).extracting("status").isEqualTo(404);
        assertThatThrownBy(() -> timers.pause(user,tick(started.sessionId()))).isInstanceOf(ApiException.class).extracting("status").isEqualTo(404);
        jdbc.sql("UPDATE attempts SET deleted_at=NULL,status='completed' WHERE id=:id").param("id",attempt).update();
        assertThatThrownBy(() -> timers.start(user,new Start(UUID.randomUUID(),attempt,UUID.randomUUID()))).isInstanceOf(ApiException.class).extracting("status").isEqualTo(404);
    }
    void completeAt(Instant at) {
        jdbc.sql("UPDATE attempts SET status='completed',completed_at=:at WHERE id=:id")
            .param("at",at == null ? null : at.atOffset(ZoneOffset.UTC)).param("id",attempt).update();
    }
    @Test void completedFinalPauseCreditsOnlyTailBeforeCompletionAndDeduplicates() {
        var started=start(); advance(10); completeAt(time.get()); advance(5);
        assertThat(timers.get(user).active()).isFalse();
        assertThatThrownBy(() -> timers.heartbeat(user,tick(started.sessionId()))).isInstanceOf(ApiException.class).extracting("status").isEqualTo(404);
        assertThatThrownBy(() -> timers.start(user,new Start(UUID.randomUUID(),attempt,UUID.randomUUID()))).isInstanceOf(ApiException.class).extracting("status").isEqualTo(404);
        Tick pause=tick(started.sessionId()); var closed=timers.pause(user,pause);
        assertThat(closed.active()).isFalse(); assertThat(closed.acceptedSeconds()).isEqualTo(10);
        assertThat(closed.dailyActiveSeconds()).isEqualTo(10); assertThat(closed.attemptActiveSeconds()).isEqualTo(10);
        advance(60); assertThat(timers.pause(user,pause)).isEqualTo(closed);
        assertThat(timers.get(user).lastAcknowledgedAt()).isEqualTo(closed.lastAcknowledgedAt());
        assertThatThrownBy(() -> timers.pause(user,tick(started.sessionId()))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("activity_session_stale");
    }
    @Test void delayedCompletedPauseCannotResurrectExpiredTail() {
        var started=start(); advance(10); completeAt(time.get()); advance(36);
        var closed=timers.pause(user,tick(started.sessionId()));
        assertThat(closed.active()).isFalse(); assertThat(closed.acceptedSeconds()).isZero();
        assertThat(closed.dailyActiveSeconds()).isZero();
    }
    @Test void unreliableCompletionTimesCloseWithoutManufacturingSeconds() {
        for(String timestamp:List.of("missing","future","beforeAnchor")) {
            jdbc.sql("UPDATE attempts SET status='active',completed_at=NULL WHERE id=:id").param("id",attempt).update();
            var started=start(); advance(10);
            completeAt(switch(timestamp) {
                case "missing" -> null;
                case "future" -> time.get().plusSeconds(5);
                default -> started.lastAcknowledgedAt().minusSeconds(1);
            });
            var closed=timers.pause(user,tick(started.sessionId()));
            assertThat(closed.active()).as(timestamp).isFalse();
            assertThat(closed.acceptedSeconds()).as(timestamp).isZero();
        }
    }
    @Test void simultaneousDistinctHeartbeatsSerializeOneInterval() throws Exception {
        var started=start(); advance(15);
        try(var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var ready=new java.util.concurrent.CountDownLatch(2); var go=new java.util.concurrent.CountDownLatch(1);
            var first=executor.submit(() -> {ready.countDown();go.await();return timers.heartbeat(user,tick(started.sessionId()));});
            var second=executor.submit(() -> {ready.countDown();go.await();return timers.heartbeat(user,tick(started.sessionId()));});
            assertThat(ready.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue(); go.countDown();
            assertThat(first.get().acceptedSeconds()+second.get().acceptedSeconds()).isEqualTo(15);
        }
        assertThat(timers.get(user).dailyActiveSeconds()).isEqualTo(15);
    }
    @Test void concurrentForeignEventCollisionReturnsConflictAndNeverLeaksSnapshot() throws Exception {
        UUID other=users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}test-password").build()).getId();
        UUID otherAttempt=attempts.startTraining(other,UUID.randomUUID().toString(),new AttemptDtos.TrainingRequest(
            CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(7,null,1)),null,"catalog",null)).id();
        UUID event=UUID.randomUUID();
        try(var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var go=new java.util.concurrent.CountDownLatch(1);
            var first=executor.submit(() -> {go.await();try {timers.start(user,new Start(event,attempt,UUID.randomUUID()));return 200;}catch(ApiException e){return e.status();}});
            var second=executor.submit(() -> {go.await();try {timers.start(other,new Start(event,otherAttempt,UUID.randomUUID()));return 200;}catch(ApiException e){return e.status();}});
            go.countDown(); assertThat(List.of(first.get(),second.get())).containsExactlyInAnyOrder(200,409);
        }
    }
    record Login(String session,String csrf) { }
    String cookie(HttpHeaders headers,String name) { return headers.getOrEmpty("Set-Cookie").stream().filter(value -> value.startsWith(name+"="))
        .map(value -> value.substring(name.length()+1,value.indexOf(';'))).findFirst().orElse(null); }
    ResponseEntity<String> http(HttpMethod method,String path,Login login,Object body) {
        var headers=new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Cookie",(login.session()==null?"":"SESSION="+login.session()+"; ")+(login.csrf()==null?"":"XSRF-TOKEN="+login.csrf()));
        if(login.csrf()!=null) headers.set("X-XSRF-TOKEN",login.csrf());
        return rest.exchange(path,method,new HttpEntity<>(body==null?null:json.write(body),headers),String.class);
    }
    Login login() {
        String password="Timer-Integration-Password-238";
        jdbc.sql("UPDATE users SET password_hash=:password WHERE id=:user").param("password",passwords.encode(password)).param("user",user).update();
        var bootstrap=rest.getForEntity("/api/auth/csrf",String.class);
        var response=http(HttpMethod.POST,"/api/auth/login",new Login(null,cookie(bootstrap.getHeaders(),"XSRF-TOKEN")),
            Map.of("email",users.findById(user).orElseThrow().getEmail(),"password",password));
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        String session=cookie(response.getHeaders(),"SESSION");
        var fresh=http(HttpMethod.GET,"/api/auth/csrf",new Login(session,null),null);
        return new Login(session,cookie(fresh.getHeaders(),"XSRF-TOKEN"));
    }
    @Test void realHttpRequiresSessionCsrfOwnershipAndEnabledActor() {
        assertThat(http(HttpMethod.GET,"/api/activity-timer",new Login(null,null),null).getStatusCode().value()).isEqualTo(401);
        Login login=login(); Start request=new Start(UUID.randomUUID(),attempt,UUID.randomUUID());
        var initial=http(HttpMethod.GET,"/api/activity-timer",login,null);
        assertThat(initial.getStatusCode().value()).isEqualTo(200);
        assertThat(initial.getHeaders().getCacheControl()).isEqualTo("no-store");
        var initialState=json.read(initial.getBody());
        for(String field:List.of("sessionId","clientId","attemptId","lastAcknowledgedAt")) {
            assertThat(initialState.has(field)).as("initial response contains %s",field).isTrue();
            assertThat(initialState.path(field).isNull()).as("initial %s is null",field).isTrue();
        }
        assertThat(http(HttpMethod.POST,"/api/activity-timer/start",new Login(login.session(),null),request).getStatusCode().value()).isEqualTo(403);
        assertThat(http(HttpMethod.POST,"/api/activity-timer/start",login,new Start(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID())).getStatusCode().value()).isEqualTo(404);
        var started=http(HttpMethod.POST,"/api/activity-timer/start",login,request);
        assertThat(started.getStatusCode().value()).isEqualTo(200);
        assertThat(started.getHeaders().getCacheControl()).isEqualTo("no-store");
        UUID session=UUID.fromString(json.read(started.getBody()).path("sessionId").asText());
        for(String action:List.of("heartbeat","pause")) assertThat(http(HttpMethod.POST,"/api/activity-timer/"+action,new Login(login.session(),null),tick(session)).getStatusCode().value()).isEqualTo(403);
        assertThat(http(HttpMethod.GET,"/api/activity-timer",login,null).getHeaders().getCacheControl()).isEqualTo("no-store");
        jdbc.sql("UPDATE users SET enabled=false WHERE id=:id").param("id",user).update();
        assertThat(http(HttpMethod.GET,"/api/activity-timer",login,null).getStatusCode().value()).isEqualTo(401);
    }
}
