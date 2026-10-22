package org.botai.back.grading;

import org.botai.back.grading.port.GradingGateway;
import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.common.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.*;
import java.io.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

@Component
public class HttpGradingGateway implements GradingGateway {
    private static final tools.jackson.databind.json.JsonMapper STRICT_JSON=tools.jackson.databind.json.JsonMapper.builder().enable(tools.jackson.core.StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    private final String base,token;private final JsonCodec json;private final HttpClient client;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private org.botai.back.billing.BillingConfig billingConfig;
    private volatile Map<Integer,Capability> cached=Map.of();private volatile Instant expires=Instant.EPOCH;
    public HttpGradingGateway(@Value("${app.grading.base-url:}") String base,@Value("${app.grading.token:}") String token,JsonCodec json){
        this.base=base.replaceAll("/$","");this.token=token;this.json=json;
        System.setProperty("jdk.httpclient.disableRetryConnect","true");System.setProperty("jdk.httpclient.enableAllMethodRetry","false");
        client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    }
    private HttpRequest.Builder request(String path,int seconds){if(base.isBlank()||token.isBlank())throw unavailable();return HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofSeconds(seconds)).header("Authorization","Bearer "+token);}
    public synchronized Map<Integer,Capability> capabilities(){
        if(Instant.now().isBefore(expires))return cached;
        try{
            var response=send(request("/internal/v1/grading/capabilities",10).GET().build(),10);if(response.statusCode()!=200)throw unavailable();
            var root=STRICT_JSON.readTree(response.body());if(!root.isObject()||root.size()!=6||!root.path("tasks").isArray()||!root.path("deadline_seconds").isIntegralNumber()||!root.path("max_solution_images").isIntegralNumber()||!root.path("max_image_bytes").isIntegralNumber()||!root.path("contract_version").asText().equals("photo-grade.v1")||!Set.of("mock","live").contains(root.path("provider_mode").asText())||root.path("deadline_seconds").asInt()!=360||root.path("max_solution_images").asInt()!=4||root.path("max_image_bytes").asInt()!=8388608||root.path("tasks").size()!=7)throw unavailable();
            var result=new HashMap<Integer,Capability>();int[] maxima={2,3,2,2,3,4,4};
            for(var n:root.get("tasks")){if(!n.isObject()||n.size()!=6||!n.path("task_number").isIntegralNumber()||!n.path("max_score").isIntegralNumber()||!n.path("supported").isBoolean()||!n.path("package_available").isBoolean()||(!n.path("package_id").isNull()&&!n.path("package_id").isString())||(n.path("supported").asBoolean()&&!n.path("package_available").asBoolean()))throw unavailable();int number=n.path("task_number").asInt();if(number<14||number>20||result.containsKey(number)||n.path("max_score").asInt()!=maxima[number-14]||!n.path("response_contract").asText().equals("photo-grade.v1"))throw unavailable();boolean supported=n.path("supported").asBoolean()&&n.path("package_available").asBoolean();String pkg=n.path("package_id").isString()?n.get("package_id").asText():null;if(supported&&(pkg==null||pkg.isBlank()||pkg.length()>80))throw unavailable();result.put(number,new Capability(number,maxima[number-14],supported,pkg,root.get("provider_mode").asText()));}
            cached=Map.copyOf(result);expires=Instant.now().plusSeconds(30);return cached;
        }catch(Exception e){cached=Map.of();expires=Instant.now().plusSeconds(5);return cached;}
    }
    public Response grade(UUID run,TaskSnapshot task,List<Image> images,String pinned){
        if(billingConfig!=null&&billingConfig.enabled()){
            // Defense in depth; sandbox deployment must also run mock AI without live credentials.
            expires=Instant.EPOCH;
            var capability=capabilities().get(task.taskNumber());
            if(capability==null||!"mock".equals(capability.providerMode()))throw unavailable();
        }
        String boundary="botai-"+UUID.randomUUID();var bytes=new ByteArrayOutputStream();
        try{
            var meta=Map.of("contract_version","photo-grade.v1","task_version_id",task.taskVersionId().toString(),"task",AiResponseValidator.task(task),"solution_image_ids",images.stream().map(i->i.id().toString()).toList());
            bytes.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n"+json.write(meta)+"\r\n").getBytes(StandardCharsets.UTF_8));
            for(Image image:images){bytes.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"solution_images\"; filename=\""+image.id()+".jpg\"\r\nContent-Type: "+image.mimeType()+"\r\n\r\n").getBytes(StandardCharsets.UTF_8));bytes.write(image.bytes());bytes.write("\r\n".getBytes(StandardCharsets.UTF_8));}
            bytes.write(("--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
            var r=send(request("/internal/v1/grading",390).header("X-Request-ID",run.toString()).header("Content-Type","multipart/form-data; boundary="+boundary).POST(HttpRequest.BodyPublishers.ofByteArray(bytes.toByteArray())).build(),390);
            String mode=single(r.headers(),"X-Grading-Provider-Mode");String pkg=single(r.headers(),"X-Grading-Package-Id");
            if(!single(r.headers(),"X-Grading-Contract-Version").equals("photo-grade.v1")||!single(r.headers(),"X-Request-ID").equals(run.toString())||!Set.of("mock","live").contains(mode)||!pinned.equals(pkg)||(billingConfig!=null&&billingConfig.enabled()&&!"mock".equals(mode)))throw new ApiException(502,"invalid_ai_headers","Не удалось подтвердить результат проверки");
            if(r.statusCode()!=200)throw new ApiException(502,"ai_error_"+r.statusCode(),"Проверка временно недоступна");
            if(!single(r.headers(),"Content-Type").split(";",2)[0].strip().equalsIgnoreCase("application/json"))throw new ApiException(502,"invalid_ai_response","Некорректный ответ проверки");
            String rejection=r.headers().firstValue("X-Grading-Rejection-Code").orElse(null);if(rejection!=null&&!Set.of("other_task","multiple_tasks","unrelated","attack","unreadable").contains(rejection))throw unavailable();
            return new Response(r.body(),mode,pkg,rejection);
        }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(502,"unknown_after_dispatch","Результат проверки неизвестен. Можно начать новую проверку");}
    }
    private String single(HttpHeaders headers,String name){var values=headers.allValues(name);if(values.size()!=1)throw new ApiException(502,"invalid_ai_headers","Не удалось подтвердить результат проверки");return values.getFirst();}
    private record BoundedResponse(int statusCode,HttpHeaders headers,String body) { }
    private BoundedResponse send(HttpRequest request,int seconds)throws Exception{
        // ofInputStream is bounded while reading, and the same deadline includes all body reads.
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(seconds);var future=client.sendAsync(request,HttpResponse.BodyHandlers.ofInputStream());HttpResponse<InputStream> r;
        try{r=future.get(seconds,TimeUnit.SECONDS);}catch(Exception e){future.cancel(true);throw e;}
        try(var body=r.body();var executor=Executors.newVirtualThreadPerTaskExecutor()){
            var read=executor.submit(()->{byte[] b=body.readNBytes(1048577);if(b.length>1048576)throw new IOException("Response limit");return new String(b,StandardCharsets.UTF_8);});
            try{return new BoundedResponse(r.statusCode(),r.headers(),read.get(Math.max(1,deadline-System.nanoTime()),TimeUnit.NANOSECONDS));}catch(Exception e){body.close();read.cancel(true);throw e;}
        }
    }
    private ApiException unavailable(){return new ApiException(503,"grading_unavailable","Проверка временно недоступна");}
}
