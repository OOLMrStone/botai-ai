package org.botai.back.learning;

import org.botai.back.attempt.AttemptService;
import org.botai.back.attempt.AttemptDtos;
import org.botai.back.catalog.CatalogRepository;
import org.botai.back.catalog.CatalogService;
import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.botai.back.profile.ProfileService;
import org.botai.back.profile.ProfileDtos;
import org.botai.back.security.CurrentActor;
import org.botai.back.security.PasswordRules;
import org.botai.back.user.User;
import org.botai.back.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties={"spring.docker.compose.enabled=false","management.server.port=0", "app.grading.worker-enabled=false"})
@Testcontainers
class LearningIntegrationTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    @Autowired CatalogService catalog;
    @Autowired AttemptService attempts;
    @Autowired ProfileService profiles;
    @Autowired UserRepository users;
    @Autowired CurrentActor actors;
    @Autowired JdbcClient jdbc;
    @Autowired JsonCodec json;
    @Autowired TransactionTemplate transactions;
    UUID user;
    @BeforeEach void user() { user=users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}test-password").build()).getId(); }
    AttemptDtos.TrainingRequest request(int number,int count) { return new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(number,null,count)),null,"catalog",null); }
    @Test void completeTaxonomyAndNoAnswerLeak() {
        var result=catalog.catalog();assertThat(result.numbers()).hasSize(20);assertThat(result.format().maxPoints()).isEqualTo(33);
        assertThat(result.numbers().stream().mapToInt(n->n.topics().size()).sum()).isEqualTo(141);
        assertThat(result.numbers()).allMatch(n->n.availableCount()==5);
        String publicTask=json.write(catalog.list(user,16,null,null,false,null,20).items().getFirst());
        assertThat(publicTask).doesNotContain("referenceAnswer","referenceSolution","acceptedAnswers").contains("\"isDemo\":true");
    }
    @Test void selectionIdempotencyShortageAndOwnership() {
        var first=attempts.startTraining(user,"same",request(7,3));var replay=attempts.startTraining(user,"same",request(7,3));
        assertThat(first.id()).isEqualTo(replay.id());assertThat(first.items()).hasSize(3);assertThat(first.items()).allMatch(i->i.answer().isEmpty());
        assertThatThrownBy(()->attempts.startTraining(user,"same",request(7,2))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("idempotency_conflict");
        assertThatThrownBy(()->attempts.startTraining(user,"shortage",request(7,6))).isInstanceOf(ApiException.class).extracting("code").isEqualTo("insufficient_tasks");
        assertThatThrownBy(()->attempts.get(UUID.randomUUID(),first.id())).isInstanceOf(ApiException.class).extracting("status").isEqualTo(404);
    }
    @Test void draftRevisionAndImmutableMembership() {
        var attempt=attempts.startTraining(user,"draft",request(7,1));var item=attempt.items().getFirst();
        var changed=attempts.patch(user,attempt.id(),new AttemptDtos.Patch(0,0,List.of(new AttemptDtos.ItemPatch(item.id(),"2",json.read("[]")))));
        assertThat(changed.revision()).isEqualTo(1);assertThat(changed.items().getFirst().answerRevision()).isEqualTo(1);
        assertThat(attempts.get(user,attempt.id()).items().getFirst().answer()).isEqualTo("2");
        assertThatThrownBy(()->attempts.patch(user,attempt.id(),new AttemptDtos.Patch(0,0,null))).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->jdbc.sql("UPDATE attempt_items SET ordinal=10 WHERE id=:id").param("id",item.id()).update()).hasMessageContaining("immutable attempt membership");
    }
    @Test void examSnapshotAndFavouritesResolveFromSameCatalog() {
        var exam=attempts.exams(user,null,20).items().getFirst();var first=attempts.startExam(user,exam.id(),"exam-1");
        assertThat(first.items()).hasSize(20);assertThat(first.summary().maxPoints()).isEqualTo(33);
        var item=first.items().getLast();catalog.favourite(user,item.task().id(),true);catalog.favourite(user,item.task().id(),true);
        assertThat(catalog.list(user,null,null,null,true,null,20).items()).extracting(t->t.id()).containsExactly(item.task().id());
        var second=attempts.startExam(user,exam.id(),"exam-2");assertThat(second.id()).isNotEqualTo(first.id());
        assertThat(attempts.history(user,null,exam.id(),null,20).items()).hasSize(2);
        assertThatThrownBy(()->jdbc.sql("UPDATE task_versions SET statement='changed' WHERE id=:id").param("id",item.task().taskVersionId()).update()).hasMessageContaining("immutable content");
        assertThatThrownBy(()->attempts.solution(user,first.id(),item.id())).isInstanceOf(ApiException.class);
    }
    @Test void profileAndBoundedIdempotentActivity() {
        var profile=profiles.patch(user,new ProfileDtos.Patch("Ученик","good","basics",20,true));assertThat(profile.plan()).isEqualTo("free");assertThat(profile.features()).isEmpty();
        var attempt=attempts.startTraining(user,"activity",request(7,1));jdbc.sql("UPDATE attempts SET created_at=now()-interval '2 minutes' WHERE id=:id").param("id",attempt.id()).update();
        var event=new ProfileDtos.Activity(UUID.randomUUID(),attempt.id(),60);var first=profiles.activity(user,event);var replay=profiles.activity(user,event);
        assertThat(first.dailyProgressMinutes()).isEqualTo(1);assertThat(replay.dailyProgressMinutes()).isEqualTo(1);assertThat(first.streakDays()).isZero();
        assertThatThrownBy(()->profiles.activity(user,new ProfileDtos.Activity(event.id(),attempt.id(),10))).isInstanceOf(ApiException.class);
        assertThat(profiles.activity(user,new ProfileDtos.Activity(UUID.randomUUID(),attempt.id(),60)).dailyProgressMinutes()).isEqualTo(1);
    }
    @Test void demoCannotAwardProgressAndDisabledPrincipalCannotAct() {
        transactions.executeWithoutResult(s->profiles.acceptGraded(user,UUID.randomUUID(),UUID.randomUUID(),1,1,true));
        assertThat(profiles.stats(user).streakDays()).isZero();
        var account=users.findById(user).orElseThrow();var authentication=UsernamePasswordAuthenticationToken.authenticated(account.getEmail(),null,List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_USER")));
        assertThat(actors.require(authentication).getId()).isEqualTo(user);account.setEnabled(false);users.saveAndFlush(account);
        assertThatThrownBy(()->actors.require(authentication)).isInstanceOf(ApiException.class).extracting("status").isEqualTo(401);
        assertThatThrownBy(()->PasswordRules.validate("я".repeat(37))).isInstanceOf(ApiException.class);
    }
    @Test void concurrentStartHasOneIdentity() throws Exception {
        try(var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var first=executor.submit(()->attempts.startTraining(user,"concurrent",request(7,1)));
            var second=executor.submit(()->attempts.startTraining(user,"concurrent",request(7,1)));
            assertThat(first.get().id()).isEqualTo(second.get().id());
            assertThat(jdbc.sql("SELECT count(*) FROM attempts WHERE user_id=:user AND idempotency_key='concurrent'").param("user",user).query(Integer.class).single()).isEqualTo(1);
        }
    }
    @Test void catalogRevisionCannotChangeHistoricalAttempt() {
        var attempt=attempts.startTraining(user,"snapshot",request(7,1));var task=attempt.items().getFirst().task();UUID next=UUID.randomUUID();
        transactions.executeWithoutResult(status->{
            jdbc.sql("INSERT INTO task_versions(id,task_id,version,format_id,exam_number,difficulty,source_year,content,statement,reference_answer,reference_solution,is_demo) SELECT :next,task_id,version+1,format_id,exam_number,difficulty,source_year,'[]'::jsonb,'New condition',reference_answer,reference_solution,is_demo FROM task_versions WHERE id=:old")
                .param("next",next).param("old",task.taskVersionId()).update();
            jdbc.sql("UPDATE tasks SET current_version_id=:next WHERE id=:task").param("next",next).param("task",task.id()).update();
        });
        assertThat(catalog.task(user,task.id()).taskVersionId()).isEqualTo(next);
        assertThat(attempts.get(user,attempt.id()).items().getFirst().task().taskVersionId()).isEqualTo(task.taskVersionId());
        assertThatThrownBy(()->jdbc.sql("INSERT INTO exam_templates(id,title,format_id,published) VALUES(:id,'Invalid',:format,true)").param("id",UUID.randomUUID()).param("format",CatalogRepository.FORMAT).update()).hasMessageContaining("published exam requires exact 20 positions");
    }

}
