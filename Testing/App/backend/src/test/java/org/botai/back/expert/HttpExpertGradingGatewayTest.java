package org.botai.back.expert;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.common.ApiException;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.*;
import static org.assertj.core.api.Assertions.*;

class HttpExpertGradingGatewayTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private HttpServer server;
    private HttpExpertGradingGateway gateway;
    private AtomicInteger calls;
    private ExpertGradingGateway.Request input;
    private AtomicReference<String> currentMode;
    private AtomicReference<String> currentPackage;
    private AtomicInteger preflights;

    @BeforeEach void setup() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0); server.start();
        gateway = new HttpExpertGradingGateway("http://127.0.0.1:" + server.getAddress().getPort(), "unit-fixture-only");
        calls = new AtomicInteger();
        var task = new TaskSnapshot(UUID.randomUUID(), UUID.randomUUID(), 16, 2, "Решите x > 0", "(0;+∞)", null, List.of(), true);
        var analysis = JSON.readTree("""
            {"block_reviews":[{"block_id":"stable-1","status":null,"explanation":null,"follows_from_block_ids":[]}],
             "summary":"Готовый экспертный анализ","checks":{"domain":null,"transformations":null,"completeness":{"is_complete":true,"reason":"Полное решение"}},
             "student_answer":null,"strengths":[],"findings":[]}
            """);
        input = new ExpertGradingGateway.Request(UUID.randomUUID(), task, analysis, List.of("stable-1"), "package-fixture", "mock");
        currentMode = new AtomicReference<>("mock"); currentPackage = new AtomicReference<>(input.packageId()); preflights = new AtomicInteger();
        server.createContext("/internal/v1/grading/capabilities", exchange -> {
            preflights.incrementAndGet();
            int[] maxima = {2, 3, 2, 2, 3, 4, 4}; var tasks = new ArrayList<Map<String,Object>>();
            for (int number = 14; number <= 20; number++) tasks.add(Map.of("task_number", number, "max_score", maxima[number - 14],
                "supported", true, "package_available", true, "package_id", currentPackage.get(), "response_contract", "photo-grade.v1"));
            reply(exchange, JSON.writeValueAsString(Map.of("contract_version", "photo-grade.v1", "provider_mode", currentMode.get(),
                "deadline_seconds", 360, "max_solution_images", 4, "max_image_bytes", 8388608, "tasks", tasks)));
        });
    }
    @AfterEach void stop() { server.stop(0); }

    @Test void b2bGradeOnlyUsesDiscoveredV2RouteAndIndependentLiveGateWithoutRunningOcr(){
        var available=new AtomicBoolean(true);var freshMode=new AtomicReference<>("mock");var capabilityReads=new AtomicInteger();
        var b2b=new org.botai.back.b2b.B2bGradingGateway(){
            public Map<Integer,org.botai.back.grading.port.GradingGateway.Capability> capabilities(){capabilityReads.incrementAndGet();return Map.of(16,new org.botai.back.grading.port.GradingGateway.Capability(16,2,true,input.packageId(),freshMode.get()));}
            public boolean gradeAnalysisAvailable(){return available.get();}
            public Validated grade(UUID run,UUID submission,long fence,TaskSnapshot task,List<org.botai.back.grading.port.GradingGateway.Image> images,String pkg,String mode){throw new AssertionError("Full OCR pipeline must not be invoked");}
        };
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"b2bConfig",new org.botai.back.b2b.B2bConfig(true,false,""));org.springframework.test.util.ReflectionTestUtils.setField(gateway,"b2bGateway",b2b);
        var scopes=org.mockito.Mockito.mock(ExpertService.class);org.springframework.test.util.ReflectionTestUtils.setField(gateway,"dispatchScopes",scopes);
        input=new ExpertGradingGateway.Request(input.requestId(),input.task(),input.analysis(),input.ocrBlockIds(),input.packageId(),"mock",true);
        var captured=new AtomicReference<String>();server.createContext("/internal/v2/grading/grade-analysis",exchange->{calls.incrementAndGet();captured.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));headers(exchange);reply(exchange,result());});
        assertThat(gateway.grade(input).grading().get("score").asInt()).isEqualTo(2);assertThat(calls.get()).isEqualTo(1);assertThat(preflights.get()).isZero();assertThat(capabilityReads.get()).isEqualTo(1);assertThat(JSON.readTree(captured.get()).get("contract_version").asText()).isEqualTo("expert-grading.v1");assertThat(captured.get()).doesNotContain("solution_images","ocr\":");
        org.mockito.Mockito.verify(scopes).authorizeGradeDispatch(input.requestId());available.set(false);assertThatThrownBy(()->gateway.grade(input)).extracting("code").isEqualTo("grading_unavailable");available.set(true);freshMode.set("live");assertThatThrownBy(()->gateway.grade(input)).extracting("code").isEqualTo("grading_unavailable");input=new ExpertGradingGateway.Request(input.requestId(),input.task(),input.analysis(),input.ocrBlockIds(),input.packageId(),"live",true);assertThatThrownBy(()->gateway.grade(input)).extracting("code").isEqualTo("b2b_live_disabled");assertThat(calls.get()).isEqualTo(1);
        freshMode.set("mock");input=new ExpertGradingGateway.Request(input.requestId(),input.task(),input.analysis(),input.ocrBlockIds(),input.packageId(),"mock",true);org.mockito.Mockito.doThrow(new ApiException(404,"not_found","Revoked during capabilities")).when(scopes).authorizeGradeDispatch(input.requestId());assertThatThrownBy(()->gateway.grade(input)).extracting("status").isEqualTo(404);assertThat(calls.get()).isEqualTo(1);
    }
    @Test void b2bAllowLiveCannotOverrideDisabledExpertGate(){
        var b2b=new org.botai.back.b2b.B2bGradingGateway(){public Map<Integer,org.botai.back.grading.port.GradingGateway.Capability> capabilities(){return Map.of(16,new org.botai.back.grading.port.GradingGateway.Capability(16,2,true,input.packageId(),"live"));}public boolean gradeAnalysisAvailable(){return true;}public Validated grade(UUID run,UUID submission,long fence,TaskSnapshot task,List<org.botai.back.grading.port.GradingGateway.Image> images,String pkg,String mode){throw new AssertionError("No full pipeline");}};
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"b2bConfig",new org.botai.back.b2b.B2bConfig(true,true,""));org.springframework.test.util.ReflectionTestUtils.setField(gateway,"b2bGateway",b2b);org.springframework.test.util.ReflectionTestUtils.setField(gateway,"dispatchScopes",org.mockito.Mockito.mock(ExpertService.class));input=new ExpertGradingGateway.Request(input.requestId(),input.task(),input.analysis(),input.ocrBlockIds(),input.packageId(),"live",true);server.createContext("/internal/v2/grading/grade-analysis",exchange->{calls.incrementAndGet();exchange.getRequestBody().readAllBytes();headers(exchange);exchange.getResponseHeaders().set("X-Grading-Provider-Mode","live");reply(exchange,result());});assertThatThrownBy(()->gateway.grade(input)).extracting("code").isEqualTo("grading_unavailable");assertThat(calls.get()).isZero();
    }

    @Test void b2bEarlyFailureWithoutPackageKeepsSafeReasonAndNeverReplays(){
        var b2b=org.mockito.Mockito.mock(org.botai.back.b2b.B2bGradingGateway.class);
        org.mockito.Mockito.when(b2b.capabilities()).thenReturn(Map.of(16,new org.botai.back.grading.port.GradingGateway.Capability(16,2,true,input.packageId(),"mock")));
        org.mockito.Mockito.when(b2b.gradeAnalysisAvailable()).thenReturn(true);
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"b2bConfig",new org.botai.back.b2b.B2bConfig(true,false,""));
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"b2bGateway",b2b);
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"dispatchScopes",org.mockito.Mockito.mock(ExpertService.class));
        input=new ExpertGradingGateway.Request(input.requestId(),input.task(),input.analysis(),input.ocrBlockIds(),input.packageId(),"mock",true);
        server.createContext("/internal/v2/grading/grade-analysis",exchange->{calls.incrementAndGet();exchange.getRequestBody().readAllBytes();headers(exchange);exchange.getResponseHeaders().set("X-Grading-Package-Id","none");byte[] bytes=JSON.writeValueAsBytes(Map.of("error",Map.of("details",Map.of("failure_category","provider","diagnostic_code",501,"reason_code","rate_limit","phase","grading","private_text","SECRET"))));exchange.sendResponseHeaders(429,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();});
        var thrown=catchThrowable(()->gateway.grade(input));assertThat(thrown).isInstanceOf(org.botai.back.b2b.B2bAiException.class);
        var failure=((org.botai.back.b2b.B2bAiException)thrown).failure();assertThat(failure).containsEntry("diagnosticCode",501).containsEntry("reasonCode","rate_limit").doesNotContainKey("private_text");assertThat(calls).hasValue(1);
    }

    private void headers(HttpExchange exchange) {
        exchange.getResponseHeaders().set("X-Request-ID", input.requestId().toString());
        exchange.getResponseHeaders().set("X-Grading-Contract-Version", "expert-grading.v1");
        exchange.getResponseHeaders().set("X-Grading-Provider-Mode", "mock");
        exchange.getResponseHeaders().set("X-Grading-Package-Id", input.packageId());
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
    }
    private void reply(HttpExchange exchange, String body) throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes); exchange.close();
    }
    private String result() { return "{\"grading\":{\"score\":2,\"criterion\":\"Демо\",\"explanation\":\"Только оценка\"}}"; }

    @Test void sendsOnlyAnalysisAndOrderedIdsWithNullsAndTrustedTask() {
        var captured = new AtomicReference<String>(); var authorization = new AtomicReference<String>();
        var requestId = new AtomicReference<String>();
        server.createContext("/internal/v1/grading/grade-analysis", exchange -> {
            calls.incrementAndGet(); captured.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            requestId.set(exchange.getRequestHeaders().getFirst("X-Request-ID"));
            assertThat(exchange.getProtocol()).isEqualTo("HTTP/1.1");
            headers(exchange); reply(exchange, result());
        });
        var response = gateway.grade(input); var wire = JSON.readTree(captured.get());
        assertThat(authorization.get()).isEqualTo("Bearer unit-fixture-only");
        assertThat(requestId.get()).isEqualTo(input.requestId().toString());
        assertThat(wire.size()).isEqualTo(4);
        assertThat(wire.get("contract_version").asText()).isEqualTo("expert-grading.v1");
        assertThat(wire.get("ocr_block_ids")).isEqualTo(JSON.valueToTree(input.ocrBlockIds()));
        assertThat(wire.get("analysis")).isEqualTo(input.analysis());
        assertThat(wire.get("task").size()).isEqualTo(6);
        assertThat(wire.get("task").get("id").asText()).isEqualTo(input.task().id().toString());
        assertThat(wire.get("task").get("reference_solution").isNull()).isTrue();
        assertThat(captured.get()).doesNotContain("solution_images", "solution_image_ids", "ocr\":", "storageKey", "user_id", "provider_mode");
        assertThat(response.grading().get("score").asInt()).isEqualTo(2);
        assertThat(response.providerMode()).isEqualTo("mock"); assertThat(calls.get()).isOne();
    }

    @Test void bindsResponseToProviderPackageContractAndRequestId() {
        var mismatch = new AtomicReference<String>();
        server.createContext("/internal/v1/grading/grade-analysis", exchange -> {
            calls.incrementAndGet(); exchange.getRequestBody().readAllBytes(); headers(exchange);
            exchange.getResponseHeaders().set(mismatch.get(), "different"); reply(exchange, result());
        });
        for (String key : List.of("X-Request-ID", "X-Grading-Contract-Version", "X-Grading-Provider-Mode", "X-Grading-Package-Id", "Content-Type", "Cache-Control")) {
            mismatch.set(key);
            assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("invalid_ai_headers");
        }
        assertThat(calls.get()).isEqualTo(6);
    }

    @Test void rejectsExtraDuplicateTrailingAndOutOfRangeGradingWithoutClamping() {
        var body = new AtomicReference<String>();
        server.createContext("/internal/v1/grading/grade-analysis", exchange -> {
            calls.incrementAndGet(); exchange.getRequestBody().readAllBytes(); headers(exchange); reply(exchange, body.get());
        });
        var invalid = List.of("{\"grading\":{\"score\":-1,\"criterion\":\"x\",\"explanation\":\"x\"}}",
            "{\"grading\":{\"score\":3,\"criterion\":\"x\",\"explanation\":\"x\"}}",
            "{\"grading\":{\"score\":1.5,\"criterion\":\"x\",\"explanation\":\"x\"}}",
            "{\"grading\":{\"score\":1,\"score\":2,\"criterion\":\"x\",\"explanation\":\"x\"}}",
            result().replace("}}", "},\"ocr\":\"unexpected\"}"), result() + "{}", "null", "{}",
            result().replace("Демо", " "), result().replace("Демо", "\\ud800"), result().replace("Демо", "x".repeat(16001)));
        for (String value : invalid) {
            body.set(value);
            assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("invalid_ai_response");
        }
        assertThat(calls.get()).isEqualTo(invalid.size());
    }

    @Test void refusesDisabledOrOversizedRequestsBeforeDispatchAndNeverFollowsRedirect() {
        server.createContext("/internal/v1/grading/grade-analysis", exchange -> {
            calls.incrementAndGet(); exchange.getRequestBody().readAllBytes();
            exchange.getResponseHeaders().set("Location", "/leak"); exchange.sendResponseHeaders(307, -1); exchange.close();
        });
        server.createContext("/leak", exchange -> { calls.incrementAndGet(); exchange.sendResponseHeaders(200, -1); exchange.close(); });
        assertThatThrownBy(() -> new HttpExpertGradingGateway("", "").grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("grading_unavailable");
        var large = JSON.createObjectNode().put("summary", "x".repeat(1048576));
        var oversized = new ExpertGradingGateway.Request(input.requestId(), input.task(), large, input.ocrBlockIds(), input.packageId(), input.providerMode());
        assertThatThrownBy(() -> gateway.grade(oversized)).isInstanceOf(ApiException.class).extracting("status").isEqualTo(400);
        assertThat(calls.get()).isZero();
        assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("expert_grading_provider_error");
        assertThat(calls.get()).isOne();
    }

    @Test void boundsResponseBytesAndRejectsMalformedUtf8() {
        var bytes = new AtomicReference<byte[]>(new byte[1048577]);
        server.createContext("/internal/v1/grading/grade-analysis", exchange -> {
            calls.incrementAndGet(); exchange.getRequestBody().readAllBytes(); headers(exchange);
            byte[] response = bytes.get(); exchange.sendResponseHeaders(200, response.length);
            try { exchange.getResponseBody().write(response); } finally { exchange.close(); }
        });
        assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("invalid_ai_response");
        bytes.set(new byte[]{(byte)0xC3, (byte)0x28});
        assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("invalid_ai_response");
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test void uncachedRegistryDriftRefusesPostAndLostResponseNeverRepeatsPost() {
        server.createContext("/internal/v1/grading/grade-analysis", exchange -> {
            calls.incrementAndGet(); exchange.getRequestBody().readAllBytes(); exchange.close();
        });
        currentMode.set("live");
        assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("grading_unavailable");
        currentMode.set("mock"); currentPackage.set("changed-package");
        assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("grading_unavailable");
        assertThat(preflights.get()).isEqualTo(2); assertThat(calls.get()).isZero();
        currentPackage.set(input.packageId());
        assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("unknown_after_dispatch");
        assertThat(preflights.get()).isEqualTo(3); assertThat(calls.get()).isOne();
        var liveInput = new ExpertGradingGateway.Request(input.requestId(), input.task(), input.analysis(), input.ocrBlockIds(), input.packageId(), "live");
        currentMode.set("live");
        assertThatThrownBy(() -> gateway.grade(liveInput)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("grading_unavailable");
        assertThat(preflights.get()).isEqualTo(3); assertThat(calls.get()).isOne();
    }

    @Test void distinguishesDocumentedEarlyRejectionFromAmbiguousProviderFailure() {
        var status = new AtomicInteger(500);
        server.createContext("/internal/v1/grading/grade-analysis", exchange -> {
            calls.incrementAndGet(); exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(status.get(), -1); exchange.close();
        });
        assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("expert_grading_provider_error");
        assertThat(calls.get()).isOne();
        status.set(422);
        assertThatThrownBy(() -> gateway.grade(input)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("expert_grading_rejected");
        assertThat(calls.get()).isEqualTo(2);
    }
}
