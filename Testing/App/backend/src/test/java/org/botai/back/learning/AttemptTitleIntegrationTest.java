package org.botai.back.learning;

import org.botai.back.attempt.AttemptDtos;
import org.botai.back.attempt.AttemptService;
import org.botai.back.catalog.CatalogRepository;
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
class AttemptTitleIntegrationTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    @Autowired TestRestTemplate rest;
    @Autowired ObjectMapper mapper;
    @Autowired AttemptService attempts;
    @Autowired UserRepository users;
    @Autowired JdbcClient jdbc;
    User owner;
    AttemptDtos.Attempt attempt;
    HttpHeaders headers;

    @BeforeEach void prepare() {
        owner=account();headers=login(owner);
        attempt=attempts.startTraining(owner.getId(),UUID.randomUUID().toString(),new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(7,null,1)),null,"catalog",null));
    }

    @Test void renameRoundTripPreservesDraftAndSurvivesOrdinaryAutosave() {
        assertThat(attempt.title()).isNull();
        var item=attempt.items().getFirst();
        var draft=patch("""
            {"revision":0,"currentIndex":1,"items":[{"id":"%s","answer":"2","drawing":[]}]}
            """.formatted(item.id()),headers);
        assertThat(draft.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(body(draft).hasNonNull("title")).isFalse();

        var renamed=patch("{\"revision\":1,\"title\":\"  Геометрия к пятнице  \"}",headers);
        assertThat(renamed.getStatusCode()).isEqualTo(HttpStatus.OK);
        var result=body(renamed);
        assertThat(result.path("title").asText()).isEqualTo("Геометрия к пятнице");
        assertThat(result.path("revision").asInt()).isEqualTo(2);
        assertThat(result.path("currentIndex").asInt()).isEqualTo(1);
        assertThat(result.path("items").get(0).path("answer").asText()).isEqualTo("2");
        assertThat(result.path("items").get(0).path("answerRevision").asInt()).isEqualTo(1);

        var autosaved=patch("{\"revision\":2,\"currentIndex\":0,\"items\":[{\"id\":\""+item.id()+"\",\"answer\":\"3\"}]}",headers);
        assertThat(autosaved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(body(autosaved).path("title").asText()).isEqualTo("Геометрия к пятнице");
        var reloaded=get("/api/attempts/"+attempt.id(),headers);
        assertThat(body(reloaded).path("title").asText()).isEqualTo("Геометрия к пятнице");
        assertThat(body(reloaded).path("items").get(0).path("answer").asText()).isEqualTo("3");
        var history=get("/api/attempts",headers);
        assertThat(body(history).path("items").get(0).path("title").asText()).isEqualTo("Геометрия к пятнице");
    }

    @Test void rejectsNullBlankOversizedAndNonStringTitlesWithoutChangingDraft() {
        for(String value:List.of("null","\"\"","\"   \"","\"\\t\\n\"",mapper.writeValueAsString("я".repeat(81)),"42","true","[]","{}")) {
            var response=patch("{\"revision\":0,\"title\":"+value+"}",headers);
            assertThat(response.getStatusCode()).as(value).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(body(response).path("code").asText()).isEqualTo("validation_error");
        }
        assertThat(attempts.get(owner.getId(),attempt.id()).revision()).isZero();
        assertThat(attempts.get(owner.getId(),attempt.id()).title()).isNull();
        var maximum=patch("{\"revision\":0,\"title\":"+mapper.writeValueAsString("  "+"я".repeat(80)+"  ")+"}",headers);
        assertThat(maximum.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(body(maximum).path("title").asText()).hasSize(80);
        var minimum=patch("{\"revision\":1,\"title\":\"Я\"}",headers);
        assertThat(minimum.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test void staleRenameCannotOverwriteNewerTitle() {
        assertThat(patch("{\"revision\":0,\"title\":\"Первое имя\"}",headers).getStatusCode()).isEqualTo(HttpStatus.OK);
        var stale=patch("{\"revision\":0,\"title\":\"Устаревшее имя\"}",headers);
        assertThat(stale.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(body(stale).path("code").asText()).isEqualTo("revision_conflict");
        assertThat(attempts.get(owner.getId(),attempt.id()).title()).isEqualTo("Первое имя");
    }

    @Test void anotherUserCannotRenameOrReadTheAttempt() {
        var foreign=login(account());
        assertThat(patch("{\"revision\":0,\"title\":\"Чужая подборка\"}",foreign).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(get("/api/attempts/"+attempt.id(),foreign).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(attempts.get(owner.getId(),attempt.id()).title()).isNull();
        assertThat(attempts.get(owner.getId(),attempt.id()).revision()).isZero();
    }

    @Test void renameRequiresSessionAndCsrfAndRejectsDisabledAccount() {
        var csrf=get("/api/auth/csrf",new HttpHeaders());
        var anonymous=csrfHeaders(null,cookie(csrf,"XSRF-TOKEN"));
        assertThat(patch("{\"revision\":0,\"title\":\"Имя\"}",anonymous).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        var noCsrf=new HttpHeaders();noCsrf.setContentType(MediaType.APPLICATION_JSON);noCsrf.set(HttpHeaders.COOKIE,headers.getFirst(HttpHeaders.COOKIE));
        assertThat(patch("{\"revision\":0,\"title\":\"Имя\"}",noCsrf).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        owner.setEnabled(false);users.saveAndFlush(owner);
        assertThat(patch("{\"revision\":0,\"title\":\"Имя\"}",headers).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(attempts.get(owner.getId(),attempt.id()).title()).isNull();
    }

    @Test void exitWithoutEditsPersistsAndOrdersByExitInsteadOfAutosaveOrRename() {
        UUID firstEvent=UUID.randomUUID();
        assertThat(exit(attempt.id(),firstEvent,headers).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        var first=attempts.get(owner.getId(),attempt.id());
        assertThat(first.lastExitedAt()).isAfterOrEqualTo(first.createdAt());
        assertThat(first.updatedAt()).isEqualTo(attempt.updatedAt());
        assertThat(first.revision()).isEqualTo(attempt.revision());
        assertThat(first.items().getFirst().answer()).isEmpty();
        assertThat(body(get("/api/attempts/"+attempt.id(),headers)).path("lastExitedAt").asText()).isNotBlank();

        var other=attempts.startTraining(owner.getId(),UUID.randomUUID().toString(),new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(7,null,1)),null,"catalog",null));
        assertThat(body(get("/api/attempts",headers)).path("items").get(0).path("id").asText()).isEqualTo(other.id().toString());
        assertThat(exit(other.id(),UUID.randomUUID(),headers).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(exit(attempt.id(),firstEvent,headers).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(attempts.get(owner.getId(),attempt.id()).lastExitedAt()).isEqualTo(first.lastExitedAt());
        assertThat(patch("{\"revision\":0,\"title\":\"Новое имя\"}",headers).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(body(get("/api/attempts",headers)).path("items").get(0).path("id").asText()).isEqualTo(other.id().toString());

        jdbc.sql("UPDATE attempts SET status='completed' WHERE id=:id").param("id",attempt.id()).update();
        assertThat(exit(attempt.id(),UUID.randomUUID(),headers).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        var latest=body(get("/api/attempts",headers)).path("items").get(0);
        assertThat(latest.path("id").asText()).isEqualTo(attempt.id().toString());
        assertThat(latest.path("status").asText()).isEqualTo("completed");
    }

    @Test void exitRequiresOwnedVisibleAttemptAndCsrfAndDoesNotReuseAnotherAttemptsEvent() {
        UUID event=UUID.randomUUID();
        var foreign=login(account());
        assertThat(exit(attempt.id(),event,foreign).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        var noCsrf=new HttpHeaders();noCsrf.setContentType(MediaType.APPLICATION_JSON);noCsrf.set(HttpHeaders.COOKIE,headers.getFirst(HttpHeaders.COOKIE));
        assertThat(exit(attempt.id(),event,noCsrf).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(attempts.get(owner.getId(),attempt.id()).lastExitedAt()).isNull();
        assertThat(exit(attempt.id(),event,headers).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        var other=attempts.startTraining(owner.getId(),UUID.randomUUID().toString(),new AttemptDtos.TrainingRequest(CatalogRepository.FORMAT,List.of(new AttemptDtos.Selection(7,null,1)),null,"catalog",null));
        assertThat(exit(other.id(),event,headers).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(attempts.get(owner.getId(),other.id()).lastExitedAt()).isNull();
        attempts.delete(owner.getId(),attempt.id());
        assertThat(exit(attempt.id(),UUID.randomUUID(),headers).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    User account() { return users.save(User.builder().email(UUID.randomUUID()+"@example.test").passwordHash("{noop}test-password").build()); }
    HttpHeaders login(User account) {
        var csrf=get("/api/auth/csrf",new HttpHeaders());
        var response=rest.exchange("/api/auth/login",HttpMethod.POST,new HttpEntity<>(mapper.writeValueAsString(Map.of("email",account.getEmail(),"password","test-password")),csrfHeaders(null,cookie(csrf,"XSRF-TOKEN"))),String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        String session=cookie(response,"SESSION");
        var sessionHeaders=new HttpHeaders();sessionHeaders.set(HttpHeaders.COOKIE,"SESSION="+session);
        var fresh=get("/api/auth/csrf",sessionHeaders);
        return csrfHeaders(session,cookie(fresh,"XSRF-TOKEN"));
    }
    HttpHeaders csrfHeaders(String session,String csrf) {
        var result=new HttpHeaders();result.setContentType(MediaType.APPLICATION_JSON);result.set("X-XSRF-TOKEN",csrf);
        result.set(HttpHeaders.COOKIE,"XSRF-TOKEN="+csrf+(session==null?"":"; SESSION="+session));return result;
    }
    ResponseEntity<String> patch(String body,HttpHeaders requestHeaders) { return rest.exchange("/api/attempts/"+attempt.id(),HttpMethod.PATCH,new HttpEntity<>(body,requestHeaders),String.class); }
    ResponseEntity<String> exit(UUID id,UUID event,HttpHeaders requestHeaders) { return rest.exchange("/api/attempts/"+id+"/exit",HttpMethod.POST,new HttpEntity<>(mapper.writeValueAsString(Map.of("eventId",event)),requestHeaders),String.class); }
    ResponseEntity<String> get(String path,HttpHeaders requestHeaders) { return rest.exchange(path,HttpMethod.GET,new HttpEntity<>(requestHeaders),String.class); }
    JsonNode body(ResponseEntity<String> response) { return mapper.readTree(response.getBody()); }
    String cookie(ResponseEntity<String> response,String name) { return response.getHeaders().getOrEmpty(HttpHeaders.SET_COOKIE).stream().filter(c->c.startsWith(name+"=")).map(c->c.substring(name.length()+1,c.indexOf(';'))).findFirst().orElseThrow(); }
}
