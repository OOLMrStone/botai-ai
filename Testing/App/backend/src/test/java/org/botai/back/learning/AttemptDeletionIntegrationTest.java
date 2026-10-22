package org.botai.back.learning;

import org.botai.back.attempt.*;
import org.botai.back.catalog.*;
import org.botai.back.common.ApiException;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.user.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"spring.docker.compose.enabled=false","management.server.port=0","app.grading.worker-enabled=false"})
@AutoConfigureTestRestTemplate
@Testcontainers
class AttemptDeletionIntegrationTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    @Autowired TestRestTemplate rest;
    @Autowired ObjectMapper mapper;
    @Autowired AttemptService attempts;
    @Autowired CatalogService catalog;
    @Autowired UserRepository users;
    @Autowired JdbcClient jdbc;
    @Autowired SubmissionStore submissions;
    User owner;
    AttemptDtos.Attempt attempt;
    HttpHeaders headers;
    String creationKey;

    @BeforeEach void prepare() {
        owner=account();headers=login(owner);creationKey=UUID.randomUUID().toString();
        attempt=attempts.startTraining(owner.getId(),creationKey,request(7));
    }

    @Test void softDeleteHidesListsAndDirectAccessButPreservesDraftAndReplayIdentity() {
        var item=attempt.items().getFirst();
        var saved=send(HttpMethod.PATCH,path(),Map.of("revision",0,"title","Моя геометрия","items",List.of(Map.of("id",item.id(),"answer","2","drawing",List.of(Map.of("id","stroke","points",List.of(Map.of("x",1,"y",2))))))),headers);
        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(remove(headers).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        var deletedAt=jdbc.sql("SELECT deleted_at FROM attempts WHERE id=:id").param("id",attempt.id()).query(java.time.OffsetDateTime.class).single();
        assertThat(deletedAt).isNotNull();
        int revision=jdbc.sql("SELECT revision FROM attempts WHERE id=:id").param("id",attempt.id()).query(Integer.class).single();
        assertThat(remove(headers).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(jdbc.sql("SELECT revision FROM attempts WHERE id=:id").param("id",attempt.id()).query(Integer.class).single()).isEqualTo(revision);
        assertThat(send(HttpMethod.GET,path(),null,headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(send(HttpMethod.PATCH,path(),Map.of("revision",revision,"title","Вернуть"),headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(send(HttpMethod.POST,path()+"/checks",Map.of("revision",revision),headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(body(send(HttpMethod.GET,"/api/attempts",null,headers)).path("items")).isEmpty();
        assertThat(body(send(HttpMethod.GET,"/api/attempts?status=unfinished",null,headers)).path("items")).isEmpty();
        assertThat(jdbc.sql("SELECT answer FROM attempt_items WHERE id=:id").param("id",item.id()).query(String.class).single()).isEqualTo("2");
        assertThat(jdbc.sql("SELECT drawing::text FROM attempt_items WHERE id=:id").param("id",item.id()).query(String.class).single()).contains("stroke");
        assertThat(jdbc.sql("SELECT title FROM attempts WHERE id=:id").param("id",attempt.id()).query(String.class).single()).isEqualTo("Моя геометрия");
        assertThatThrownBy(()->attempts.startTraining(owner.getId(),creationKey,request(7))).isInstanceOf(ApiException.class).extracting("status").isEqualTo(404);
        assertThat(jdbc.sql("SELECT count(*) FROM attempts WHERE user_id=:user").param("user",owner.getId()).query(Integer.class).single()).isEqualTo(1);
    }

    @Test void examLinksFallBackToRemainingAttemptAndDisappearAfterBothAreDeleted() {
        var exam=attempts.exams(owner.getId(),null,20).items().getFirst();
        var first=attempts.startExam(owner.getId(),exam.id(),UUID.randomUUID().toString());
        var latest=attempts.startExam(owner.getId(),exam.id(),UUID.randomUUID().toString());
        attempts.delete(owner.getId(),latest.id());
        var remaining=attempts.exams(owner.getId(),null,20).items().getFirst();
        assertThat(remaining.activeAttemptId()).isEqualTo(first.id());
        assertThat(remaining.latestAttempt().id()).isEqualTo(first.id());
        attempts.delete(owner.getId(),first.id());
        var empty=attempts.exams(owner.getId(),null,20).items().getFirst();
        assertThat(empty.activeAttemptId()).isNull();assertThat(empty.latestAttempt()).isNull();
        assertThat(attempts.history(owner.getId(),"mock-exam",exam.id(),null,20).items()).isEmpty();
        assertThat(attempts.startExam(owner.getId(),exam.id(),UUID.randomUUID().toString()).id()).isNotIn(first.id(),latest.id());
    }

    @Test void deletionPreservesGradesProgressAndActivity() {
        var item=attempt.items().getFirst();
        String answer=catalog.snapshot(item.task().taskVersionId()).acceptedAnswers().getFirst();
        var patched=attempts.patch(owner.getId(),attempt.id(),new AttemptDtos.Patch(0,null,List.of(new AttemptDtos.ItemPatch(item.id(),answer,null))));
        var checked=send(HttpMethod.POST,path()+"/checks",Map.of("revision",patched.revision()),headers);
        assertThat(checked.getStatusCode()).isEqualTo(HttpStatus.OK);
        UUID submission=UUID.fromString(body(checked).path("items").get(0).path("submission").path("id").asText());
        jdbc.sql("INSERT INTO user_task_results(user_id,task_id,submission_id,first_solved_at,last_solved_at) VALUES(:user,:task,:submission,now(),now())").param("user",owner.getId()).param("task",item.task().id()).param("submission",submission).update();
        jdbc.sql("INSERT INTO user_activity_days(user_id,local_date,qualified,active_seconds) VALUES(:user,current_date,true,120)").param("user",owner.getId()).update();
        assertThat(remove(headers).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(jdbc.sql("SELECT score FROM grading_results WHERE submission_id=:id").param("id",submission).query(Integer.class).single()).isEqualTo(1);
        assertThat(jdbc.sql("SELECT count(*) FROM user_task_results WHERE user_id=:user").param("user",owner.getId()).query(Integer.class).single()).isEqualTo(1);
        assertThat(jdbc.sql("SELECT active_seconds FROM user_activity_days WHERE user_id=:user").param("user",owner.getId()).query(Integer.class).single()).isEqualTo(120);
        assertThat(send(HttpMethod.GET,path()+"/items/"+item.id()+"/solution",null,headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(submissions.row(submission,null,false).id()).isEqualTo(submission);
    }

    @Test void deletedPhotoCannotBeReadOrMutatedThroughSubmissionAndMediaRoutes() {
        var photo=attempts.startTraining(owner.getId(),UUID.randomUUID().toString(),request(16));
        var item=photo.items().getFirst();
        var intent=send(HttpMethod.POST,"/api/submissions",Map.of("attemptId",photo.id(),"attemptItemId",item.id(),"inputRevision",0),headers);
        assertThat(intent.getStatusCode()).isEqualTo(HttpStatus.OK);
        UUID submission=UUID.fromString(body(intent).path("id").asText());UUID media=UUID.randomUUID();
        jdbc.sql("INSERT INTO stored_objects(id,user_id,submission_id,purpose,bucket,object_key,state,file_name,mime_type,size_bytes,ordinal) VALUES(:id,:user,:submission,'solution','test',:key,'ready','answer.png','image/png',10,0)").param("id",media).param("user",owner.getId()).param("submission",submission).param("key",media.toString()).update();
        attempts.delete(owner.getId(),photo.id());
        assertThat(send(HttpMethod.GET,"/api/submissions/"+submission,null,headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(send(HttpMethod.POST,"/api/submissions/"+submission+"/finalize",Map.of("expectedRevision",0),headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(send(HttpMethod.GET,"/api/media/"+media,null,headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(send(HttpMethod.DELETE,"/api/submissions/"+submission+"/images/"+media,null,headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(jdbc.sql("SELECT state FROM stored_objects WHERE id=:id").param("id",media).query(String.class).single()).isEqualTo("ready");
        assertThat(submissions.row(submission,null,false).status()).isEqualTo("draft");
    }

    @Test void deletionIsOwnerScopedAndRequiresAuthenticatedCsrfProtectedSession() {
        assertThat(remove(login(account())).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        var anonymousCsrf=send(HttpMethod.GET,"/api/auth/csrf",null,new HttpHeaders());
        assertThat(remove(csrfHeaders(null,cookie(anonymousCsrf,"XSRF-TOKEN"))).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        var noCsrf=new HttpHeaders();noCsrf.set(HttpHeaders.COOKIE,headers.getFirst(HttpHeaders.COOKIE));
        assertThat(remove(noCsrf).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(send(HttpMethod.DELETE,"/api/attempts/"+UUID.randomUUID(),null,headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        owner.setEnabled(false);users.saveAndFlush(owner);
        assertThat(remove(headers).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(attempts.get(owner.getId(),attempt.id()).id()).isEqualTo(attempt.id());
    }

    AttemptDtos.TrainingRequest request(int number) { return new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(number,null,1)),null,"catalog",null); }
    String path() { return "/api/attempts/"+attempt.id(); }
    ResponseEntity<String> remove(HttpHeaders requestHeaders) { return send(HttpMethod.DELETE,path(),null,requestHeaders); }
    User account() { return users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}test-password").build()); }
    HttpHeaders login(User account) {
        var csrf=send(HttpMethod.GET,"/api/auth/csrf",null,new HttpHeaders());
        var response=send(HttpMethod.POST,"/api/auth/login",Map.of("email",account.getEmail(),"password","test-password"),csrfHeaders(null,cookie(csrf,"XSRF-TOKEN")));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        String session=cookie(response,"SESSION");var sessionHeaders=new HttpHeaders();sessionHeaders.set(HttpHeaders.COOKIE,"SESSION="+session);
        var fresh=send(HttpMethod.GET,"/api/auth/csrf",null,sessionHeaders);
        return csrfHeaders(session,cookie(fresh,"XSRF-TOKEN"));
    }
    HttpHeaders csrfHeaders(String session,String csrf) {
        var result=new HttpHeaders();result.setContentType(MediaType.APPLICATION_JSON);result.set("X-XSRF-TOKEN",csrf);
        result.set(HttpHeaders.COOKIE,"XSRF-TOKEN="+csrf+(session==null?"":"; SESSION="+session));return result;
    }
    ResponseEntity<String> send(HttpMethod method,String path,Object body,HttpHeaders original) {
        var requestHeaders=new HttpHeaders();requestHeaders.putAll(original);requestHeaders.set("Idempotency-Key",UUID.randomUUID().toString());
        return rest.exchange(path,method,new HttpEntity<>(body==null?null:mapper.writeValueAsString(body),requestHeaders),String.class);
    }
    JsonNode body(ResponseEntity<String> response) { return mapper.readTree(response.getBody()); }
    String cookie(ResponseEntity<String> response,String name) { return response.getHeaders().getOrEmpty(HttpHeaders.SET_COOKIE).stream().filter(c->c.startsWith(name+"=")).map(c->c.substring(name.length()+1,c.indexOf(';'))).findFirst().orElseThrow(); }
}
