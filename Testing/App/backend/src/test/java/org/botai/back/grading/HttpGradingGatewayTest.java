package org.botai.back.grading;

import com.sun.net.httpserver.HttpServer;
import org.botai.back.common.*;
import org.botai.back.grading.port.GradingGateway;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;

class HttpGradingGatewayTest {
    HttpServer server;HttpGradingGateway gateway;AtomicInteger calls;
    @BeforeEach void setup()throws Exception{server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.start();calls=new AtomicInteger();gateway=new HttpGradingGateway("http://127.0.0.1:"+server.getAddress().getPort(),"local-test-token",new JsonCodec(JsonMapper.builder().build()));}
    @AfterEach void close(){server.stop(0);}
    @Test void authenticatedMultipartRunBindingAndExactResponse() {
        var task=AiResponseValidatorTest.task();var images=List.of(new GradingGateway.Image(UUID.randomUUID(),new byte[]{1,2,3},"image/jpeg"));UUID run=UUID.randomUUID();String exact=AiResponseValidatorTest.body(task,images,true);
        server.createContext("/internal/v1/grading",e->{calls.incrementAndGet();assertThat(e.getProtocol()).isEqualTo("HTTP/1.1");assertThat(e.getRequestHeaders().getFirst("Upgrade")).isNull();assertThat(e.getRequestHeaders().getFirst("HTTP2-Settings")).isNull();assertThat(e.getRequestHeaders().getFirst("Authorization")).isEqualTo("Bearer local-test-token");assertThat(e.getRequestHeaders().getFirst("X-Request-ID")).isEqualTo(run.toString());String multipart=new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);assertThat(multipart).contains("name=\"metadata\"","name=\"solution_images\"",task.taskVersionId().toString(),task.referenceAnswer()).doesNotContain("user_id","object_key","Cookie");e.getResponseHeaders().set("X-Request-ID",run.toString());e.getResponseHeaders().set("X-Grading-Contract-Version","photo-grade.v1");e.getResponseHeaders().set("X-Grading-Provider-Mode","mock");e.getResponseHeaders().set("X-Grading-Package-Id","digest");e.getResponseHeaders().set("Content-Type","application/json");byte[] body=exact.getBytes(StandardCharsets.UTF_8);e.sendResponseHeaders(200,body.length);e.getResponseBody().write(body);e.close();});
        var response=gateway.grade(run,task,images,"digest");assertThat(response.exactJson()).isEqualTo(exact);assertThat(calls.get()).isEqualTo(1);
    }
    @Test void redirectsNeverFollowAndOversizedResponsesNeverParse() {
        server.createContext("/internal/v1/grading",e->{calls.incrementAndGet();e.getRequestBody().readAllBytes();e.getResponseHeaders().set("Location","/leak");e.sendResponseHeaders(307,-1);e.close();});server.createContext("/leak",e->{calls.incrementAndGet();e.sendResponseHeaders(200,-1);e.close();});
        assertThatThrownBy(()->gateway.grade(UUID.randomUUID(),AiResponseValidatorTest.task(),List.of(),"digest")).isInstanceOf(ApiException.class);assertThat(calls.get()).isEqualTo(1);
        server.removeContext("/internal/v1/grading");server.createContext("/internal/v1/grading",e->{calls.incrementAndGet();e.getRequestBody().readAllBytes();e.sendResponseHeaders(200,0);try{e.getResponseBody().write(new byte[1048577]);}finally{e.close();}});
        assertThatThrownBy(()->gateway.grade(UUID.randomUUID(),AiResponseValidatorTest.task(),List.of(),"digest")).isInstanceOf(ApiException.class);assertThat(calls.get()).isEqualTo(2);
    }
    @Test void missingOrMismatchedHeadersFailClosedAndUnavailableRegistryIsNotUnsupported(){
        server.createContext("/internal/v1/grading",e->{calls.incrementAndGet();e.getRequestBody().readAllBytes();e.getResponseHeaders().set("X-Grading-Package-Id","other-package");e.sendResponseHeaders(200,2);e.getResponseBody().write("{}".getBytes(StandardCharsets.UTF_8));e.close();});
        assertThatThrownBy(()->gateway.grade(UUID.randomUUID(),AiResponseValidatorTest.task(),List.of(),"digest")).isInstanceOf(ApiException.class).extracting("code").isEqualTo("invalid_ai_headers");assertThat(gateway.capabilities()).isEmpty();
    }
    @Test void sandboxRechecksCapabilitiesBeforeAnyGradingPostAfterProviderDrift(){
        var db=org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);org.mockito.Mockito.when(db.queryForObject("SELECT current_database()",String.class)).thenReturn("test_payments_test");
        var config=new org.botai.back.billing.BillingConfig("test","test_payments_test","12345","test_fixture_only","http://localhost:13002","test@example.test",db);
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"billingConfig",config);
        var mode=new java.util.concurrent.atomic.AtomicReference<>("mock");var json=new JsonCodec(JsonMapper.builder().build());
        server.createContext("/internal/v1/grading/capabilities",e->{var tasks=new ArrayList<Map<String,Object>>();int[] maxima={2,3,2,2,3,4,4};for(int n=14;n<=20;n++)tasks.add(Map.of("task_number",n,"max_score",maxima[n-14],"supported",true,"package_available",true,"package_id","digest","response_contract","photo-grade.v1"));byte[] body=json.write(Map.of("contract_version","photo-grade.v1","provider_mode",mode.get(),"deadline_seconds",360,"max_solution_images",4,"max_image_bytes",8388608,"tasks",tasks)).getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().set("Content-Type","application/json");e.sendResponseHeaders(200,body.length);e.getResponseBody().write(body);e.close();});
        server.createContext("/internal/v1/grading",e->{calls.incrementAndGet();e.sendResponseHeaders(500,-1);e.close();});
        assertThat(gateway.capabilities().get(16).providerMode()).isEqualTo("mock");mode.set("live");
        assertThatThrownBy(()->gateway.grade(UUID.randomUUID(),AiResponseValidatorTest.task(),List.of(),"digest")).isInstanceOf(ApiException.class).extracting("code").isEqualTo("grading_unavailable");assertThat(calls.get()).isZero();
    }
}
