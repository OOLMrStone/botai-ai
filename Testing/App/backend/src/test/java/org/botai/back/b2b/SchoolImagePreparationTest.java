package org.botai.back.b2b;

import java.util.List;
import java.util.UUID;
import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.school.SchoolService;
import org.botai.back.user.Role;
import org.botai.back.user.User;
import org.botai.back.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.docker.compose.enabled=false", "management.server.port=0",
    "app.grading.worker-enabled=false", "app.pdf.worker-enabled=false", "app.b2b.local-enabled=true"
})
@Testcontainers
class SchoolImagePreparationTest {
    @Container @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @Autowired JdbcTemplate db;
    @Autowired SubmissionOrigins origins;
    @Autowired SchoolService schools;
    @Autowired SubmissionStore store;
    @Autowired UserRepository users;
    UUID school, student, expert, task, assignment;
    Authentication studentAuth;

    @BeforeEach void setup() {
        school = UUID.randomUUID(); student = account(Role.USER); expert = account(Role.EXPERT);
        task = UUID.randomUUID(); assignment = UUID.randomUUID();
        db.update("INSERT INTO schools(id,name) VALUES(?,'Image school')", school);
        db.update("INSERT INTO school_experts(school_id,user_id) VALUES(?,?)", school, expert);
        db.update("INSERT INTO school_students(school_id,user_id,first_name,last_name) VALUES(?,?,'Test','Student')", school, student);
        db.update("INSERT INTO expert_students(school_id,student_user_id,expert_user_id) VALUES(?,?,?)", school, student, expert);
        db.update("INSERT INTO school_tasks(id,school_id,task_number,max_score,title,statement,content,reference_answer,input_mode) VALUES(?,?,15,3,'Image task','PUBLIC-PLACEHOLDER','[]',NULL,'from-images')", task, school);
        db.update("INSERT INTO school_assignments(id,school_id,student_user_id,task_id,title) VALUES(?,?,?,?,'Assignment')", assignment, school, student, task);
        studentAuth = auth(student);
    }

    UUID account(Role role) {
        return users.save(User.builder().email(UUID.randomUUID() + "@example.test")
            .passwordHash("unused-isolated-test-password").role(role).build()).getId();
    }
    Authentication auth(UUID id) {
        var user = users.findById(id).orElseThrow();
        return new UsernamePasswordAuthenticationToken(user.getEmail(), "",
            List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole())));
    }
    UUID submission(UUID previous) {
        return UUID.fromString(schools.create(studentAuth, assignment, UUID.randomUUID().toString(),
            new SchoolService.Create(previous)).path("id").asText());
    }
    TaskSnapshot extracted(String suffix) {
        return new TaskSnapshot(task, task, 15, 3, "EXTRACTED-" + suffix,
            "PRIVATE-ANSWER-" + suffix, "PRIVATE-SOLUTION-" + suffix, List.of(), false);
    }
    UUID reference(String kind) {
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO school_task_assets(id,school_id,task_id,kind,bucket,object_key,file_name,mime_type,size_bytes,sha256) VALUES(?,?,?,?,'private',?,'task.jpg','image/jpeg',1,?)",
            id, school, task, kind, "private/" + id, "a".repeat(64));
        return id;
    }

    @Test void eachSubmissionGetsItsOwnImmutablePreparationWithoutChangingSharedTask() {
        UUID first = submission(null);
        assertThat(origins.requiresImagePreparation(first)).isTrue();
        origins.materialize(first, extracted("FIRST"));
        store.terminal(store.row(first, student, false), "failed", "test_failure");
        UUID second = submission(first);
        assertThat(origins.task(second).statement()).isEqualTo("PUBLIC-PLACEHOLDER");
        assertThat(origins.task(second).referenceAnswer()).isNull();
        origins.materialize(second, extracted("SECOND"));
        assertThat(origins.task(first).referenceAnswer()).isEqualTo("PRIVATE-ANSWER-FIRST");
        assertThat(origins.task(second).referenceAnswer()).isEqualTo("PRIVATE-ANSWER-SECOND");
        assertThat(db.queryForObject("SELECT statement FROM school_tasks WHERE id=?", String.class, task)).isEqualTo("PUBLIC-PLACEHOLDER");
        assertThat(db.queryForObject("SELECT reference_answer FROM school_tasks WHERE id=?", String.class, task)).isNull();
        assertThatThrownBy(() -> db.update("UPDATE school_submission_task_preparations SET statement='changed' WHERE submission_id=?", first)).hasMessageContaining("immutable");
        assertThatThrownBy(() -> db.update("DELETE FROM school_submission_task_preparations WHERE submission_id=?", first)).hasMessageContaining("immutable");
        assertThatThrownBy(() -> origins.materialize(first, extracted("REPLACEMENT"))).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }

    @Test void referenceSelectionRequiresExactlyOneReferenceAndNeverSelectsStatement() {
        UUID id = submission(null);
        reference("statement");
        assertThatThrownBy(() -> origins.referenceImage(id)).extracting("code").isEqualTo("manual_input_unavailable");
        UUID expected = reference("reference");
        assertThat(origins.referenceImage(id).get("id")).isEqualTo(expected);
        reference("reference");
        assertThatThrownBy(() -> origins.referenceImage(id)).extracting("code").isEqualTo("manual_input_unavailable");
    }

    @Test void databaseRejectsPreparationForPreparedSchoolTask() {
        UUID preparedTask = UUID.randomUUID(), preparedAssignment = UUID.randomUUID();
        db.update("INSERT INTO school_tasks(id,school_id,task_number,max_score,title,statement,content,reference_answer) VALUES(?,?,16,2,'Prepared','PUBLIC','[]','PRIVATE')", preparedTask, school);
        db.update("INSERT INTO school_assignments(id,school_id,student_user_id,task_id,title) VALUES(?,?,?,?,'Prepared assignment')", preparedAssignment, school, student, preparedTask);
        UUID id = UUID.fromString(schools.create(studentAuth, preparedAssignment, UUID.randomUUID().toString(), new SchoolService.Create(null)).path("id").asText());
        assertThat(origins.requiresImagePreparation(id)).isFalse();
        origins.materialize(id, extracted("IGNORED"));
        assertThat(origins.task(id).referenceAnswer()).isEqualTo("PRIVATE");
        assertThatThrownBy(() -> db.update("INSERT INTO school_submission_task_preparations(submission_id,statement,reference_answer) VALUES(?,'BAD','BAD')", id))
            .hasMessageContaining("requires an image-based school submission");
    }

    @Test void preparationDoesNotExposeReferenceToStudentOrBypassSchoolPermissions() {
        UUID id = submission(null); reference("reference"); origins.materialize(id, extracted("SECRET"));
        assertThat(schools.detail(studentAuth, assignment).toString()).doesNotContain("PRIVATE-ANSWER", "PRIVATE-SOLUTION", "private/");
        assertThat(store.get(student, id).toString()).doesNotContain("PRIVATE-ANSWER", "PRIVATE-SOLUTION", "private/");
        UUID outsider = account(Role.USER);
        assertThatThrownBy(() -> schools.detail(auth(outsider), assignment)).extracting("status").isEqualTo(404);
        assertThatThrownBy(() -> origins.requireOwner(outsider, id, false)).extracting("status").isEqualTo(404);
        db.update("UPDATE school_students SET enabled=false WHERE school_id=? AND user_id=?", school, student);
        assertThat(origins.valid(id, false)).isFalse();
        assertThatThrownBy(() -> store.get(student, id)).extracting("status").isEqualTo(404);
    }
    @Test void incompleteFixtureIsVisibleOnlyForCurrentSubmissionAndCancelAllowsReplacement() {
        UUID first = submission(null);
        assertThat(schools.detail(studentAuth, assignment).path("fixtureAttachmentIncomplete").asBoolean()).isFalse();
        db.update("INSERT INTO school_fixture_attachments(submission_id,complete) VALUES(?,false)", first);
        assertThat(schools.detail(studentAuth, assignment).path("fixtureAttachmentIncomplete").asBoolean()).isTrue();
        store.terminal(store.row(first, student, false), "cancelled", "cancelled");
        UUID second = submission(first);
        var detail = schools.detail(studentAuth, assignment);
        assertThat(detail.path("submissionId").asText()).isEqualTo(second.toString());
        assertThat(detail.path("fixtureAttachmentIncomplete").asBoolean()).isFalse();
        assertThat(detail.path("history")).hasSize(2);
    }

}
