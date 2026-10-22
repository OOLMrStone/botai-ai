package org.botai.back.expert;

import org.botai.back.common.ApiException;
import org.botai.back.grading.AiResponseValidator;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.io.InputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

@Component
public class HttpExpertGradingGateway implements ExpertGradingGateway {
    private static final int MAX_BYTES = 1048576;
    private static final int DEADLINE_SECONDS = 390;
    // An independent mapper preserves mandatory nested null fields in the wire contract.
    private static final JsonMapper JSON = JsonMapper.builder()
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private final String base, token;
    private final boolean allowLive;
    private final HttpClient client;
    @org.springframework.beans.factory.annotation.Autowired(required=false) private org.botai.back.b2b.B2bConfig b2bConfig;
    @org.springframework.beans.factory.annotation.Autowired(required=false) private org.botai.back.b2b.B2bGradingGateway b2bGateway;
    @org.springframework.beans.factory.annotation.Autowired(required=false) private ExpertService dispatchScopes;

    public HttpExpertGradingGateway(String base, String token) { this(base, token, false); }
    @org.springframework.beans.factory.annotation.Autowired
    public HttpExpertGradingGateway(@Value("${app.grading.base-url:}") String base,
                                   @Value("${app.grading.token:}") String token,
                                   @Value("${app.expert-grading.allow-live:false}") boolean allowLive) {
        this.base = base.replaceAll("/$", ""); this.token = token; this.allowLive = allowLive;
        System.setProperty("jdk.httpclient.disableRetryConnect", "true");
        System.setProperty("jdk.httpclient.enableAllMethodRetry", "false");
        client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    @Override public Response grade(Request input) {
        if (base.isBlank() || token.isBlank()) throw unavailable();
        HttpRequest request;
        try {
            Map<String,Object> body = new LinkedHashMap<>();
            body.put("contract_version", "expert-grading.v1");
            body.put("task", AiResponseValidator.task(input.task()));
            body.put("ocr_block_ids", input.ocrBlockIds());
            body.put("analysis", input.analysis());
            byte[] payload = JSON.writeValueAsBytes(body);
            if (payload.length > MAX_BYTES) throw ApiException.invalid("Документ оценки слишком большой");
            request = HttpRequest.newBuilder(URI.create(base + (input.b2b()?"/internal/v2/grading/grade-analysis":"/internal/v1/grading/grade-analysis")))
                .timeout(Duration.ofSeconds(DEADLINE_SECONDS)).header("Authorization", "Bearer " + token)
                .header("X-Request-ID", input.requestId().toString()).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload)).build();
        } catch (ApiException e) { throw e; }
        catch (Exception e) { throw unavailable(); }

        preflight(input);
        if(input.b2b()){if(dispatchScopes==null)throw unavailable();dispatchScopes.authorizeGradeDispatch(input.requestId());}
        try {
            var response = send(request, DEADLINE_SECONDS);
            if (response.status() != 200) {
                String code = Set.of(401, 403, 404, 422).contains(response.status()) ? "expert_grading_rejected" : "expert_grading_provider_error";
                if(input.b2b()) {
                    var h=response.headers();String pkg=single(h,"X-Grading-Package-Id");
                    if(!single(h,"X-Grading-Contract-Version").equals("expert-grading.v1")||!single(h,"X-Request-ID").equals(input.requestId().toString())||!single(h,"X-Grading-Provider-Mode").equals(input.providerMode())||!(pkg.equals(input.packageId())||pkg.equals("none")))throw invalidHeaders();
                    JsonNode details=null;try{details=JSON.readTree(response.body()).path("error").path("details");}catch(Exception ignored){/* Legacy error fallback keeps raw body private. */}
                    throw org.botai.back.b2b.B2bAiException.from(code,details);
                }
                throw new ApiException(502, code, "Оценка временно недоступна");
            }
            var headers = response.headers();
            String mode = single(headers, "X-Grading-Provider-Mode"), packageId = single(headers, "X-Grading-Package-Id");
            if (!single(headers, "X-Grading-Contract-Version").equals("expert-grading.v1")
                || !single(headers, "X-Request-ID").equals(input.requestId().toString())
                || !Set.of("mock", "live").contains(mode) || !mode.equals(input.providerMode())
                || !packageId.equals(input.packageId())
                || !single(headers, "Content-Type").split(";", 2)[0].strip().equalsIgnoreCase("application/json")
                || Arrays.stream(single(headers, "Cache-Control").split(",")).noneMatch(value -> value.strip().equalsIgnoreCase("no-store")))
                throw invalidHeaders();
            JsonNode body;
            try { body = JSON.readTree(response.body()); }
            catch (Exception e) { throw invalidResponse(); }
            if (body == null || !body.isObject() || body.size() != 1 || !body.has("grading")) throw invalidResponse();
            var grading = body.get("grading");
            if (!grading.isObject() || grading.size() != 3 || !grading.has("score") || !grading.has("criterion") || !grading.has("explanation")) throw invalidResponse();
            var score = grading.get("score");
            if (!score.isIntegralNumber() || !score.canConvertToInt() || score.asInt() < 0 || score.asInt() > input.task().maxScore()) throw invalidResponse();
            for (String field : List.of("criterion", "explanation"))
                if (!validText(grading.get(field))) throw invalidResponse();
            return new Response(grading, mode, packageId);
        } catch (ApiException e) { throw e; }
        catch (Exception e) { throw new ApiException(502, "unknown_after_dispatch", "Результат оценки неизвестен. Обнови работу перед повтором"); }
    }

    /** Uncached GET prevents historical mock provenance from dispatching into live AI. */
    private void preflight(Request input) {
        if(input.b2b()){
            if(b2bConfig==null||b2bGateway==null)throw unavailable();b2bConfig.requireProvider(input.providerMode());
            if("live".equals(input.providerMode())&&!allowLive)throw unavailable();
            var capability=b2bGateway.capabilities().get(input.task().taskNumber());
            if(capability==null||!capability.supported()||!b2bGateway.gradeAnalysisAvailable()||capability.maxScore()!=input.task().maxScore()||!Objects.equals(capability.packageId(),input.packageId())||!Objects.equals(capability.providerMode(),input.providerMode()))throw unavailable();
            b2bConfig.requireProvider(capability.providerMode());return;
        }
        if (!"mock".equals(input.providerMode()) && (!allowLive || !"live".equals(input.providerMode()))) throw unavailable();
        try {
            var request = HttpRequest.newBuilder(URI.create(base + "/internal/v1/grading/capabilities"))
                .timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer " + token).GET().build();
            var response = send(request, 10);
            if (response.status() != 200) throw unavailable();
            var registry = JSON.readTree(response.body());
            if (registry == null || !registry.isObject() || registry.size() != 6
                || !registry.path("contract_version").asText().equals("photo-grade.v1")
                || !registry.path("provider_mode").asText().equals(input.providerMode())
                || !registry.path("deadline_seconds").isIntegralNumber() || !registry.path("deadline_seconds").canConvertToInt() || registry.path("deadline_seconds").asInt() != 360
                || !registry.path("max_solution_images").isIntegralNumber() || !registry.path("max_solution_images").canConvertToInt() || registry.path("max_solution_images").asInt() != 4
                || !registry.path("max_image_bytes").isIntegralNumber() || !registry.path("max_image_bytes").canConvertToInt() || registry.path("max_image_bytes").asInt() != 8388608
                || !registry.path("tasks").isArray() || registry.get("tasks").size() != 7) throw unavailable();
            int[] maxima = {2, 3, 2, 2, 3, 4, 4}; Set<Integer> seen = new HashSet<>(); boolean matched = false;
            for (var task : registry.get("tasks")) {
                int number = task.path("task_number").asInt();
                if (!task.isObject() || task.size() != 6 || !task.path("task_number").isIntegralNumber() || !task.path("task_number").canConvertToInt()
                    || number < 14 || number > 20 || !seen.add(number)
                    || !task.path("max_score").isIntegralNumber() || !task.path("max_score").canConvertToInt() || task.path("max_score").asInt() != maxima[number - 14]
                    || !task.path("supported").isBoolean() || !task.path("package_available").isBoolean()
                    || !task.path("response_contract").asText().equals("photo-grade.v1")
                    || (!task.path("package_id").isNull() && !task.path("package_id").isString())) throw unavailable();
                if (number == input.task().taskNumber()) matched = task.get("supported").asBoolean()
                    && task.get("package_available").asBoolean() && task.get("max_score").asInt() == input.task().maxScore() && task.get("package_id").isString()
                    && task.get("package_id").asText().equals(input.packageId());
            }
            if (!matched) throw unavailable();
        } catch (Exception e) { throw unavailable(); }
    }

    private static boolean validText(JsonNode node) {
        if (node == null || !node.isString()) return false;
        String value = node.asText();
        if (value.isBlank() || value.codePointCount(0, value.length()) > 16000) return false;
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (Character.isHighSurrogate(current)) {
                if (++index >= value.length() || !Character.isLowSurrogate(value.charAt(index))) return false;
            } else if (Character.isLowSurrogate(current)) return false;
        }
        return true;
    }

    private record Wire(int status, HttpHeaders headers, String body) { }
    private Wire send(HttpRequest request, int seconds) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        var pending = client.sendAsync(request, HttpResponse.BodyHandlers.ofInputStream());
        HttpResponse<InputStream> response;
        try { response = pending.get(seconds, TimeUnit.SECONDS); }
        catch (Exception e) { pending.cancel(true); throw e; }
        var executor = Executors.newVirtualThreadPerTaskExecutor();
        try (var stream = response.body()) {
            var read = executor.submit(() -> {
                byte[] bytes = stream.readNBytes(MAX_BYTES + 1);
                if (bytes.length > MAX_BYTES) throw invalidResponse();
                try {
                    return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
                } catch (java.nio.charset.CharacterCodingException e) { throw invalidResponse(); }
            });
            try {
                return new Wire(response.statusCode(), response.headers(), read.get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS));
            } catch (ExecutionException e) {
                if (e.getCause() instanceof ApiException problem) throw problem;
                throw e;
            } catch (Exception e) {
                read.cancel(true); stream.close(); throw e;
            }
        } finally { executor.shutdownNow(); }
    }
    private static String single(HttpHeaders headers, String key) {
        var values = headers.allValues(key); if (values.size() != 1) throw invalidHeaders(); return values.getFirst();
    }
    private static ApiException unavailable() { return new ApiException(503, "grading_unavailable", "Оценка временно недоступна"); }
    private static ApiException invalidHeaders() { return new ApiException(502, "invalid_ai_headers", "Не удалось подтвердить результат оценки"); }
    private static ApiException invalidResponse() { return new ApiException(502, "invalid_ai_response", "Ответ оценки не прошёл проверку формата"); }
}
