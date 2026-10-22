package org.botai.back.b2b;

import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.botai.back.catalog.TaskSnapshot;
import org.botai.back.common.*;
import org.botai.back.expert.ExpertReviewDocument;
import org.botai.back.grading.AiResponseValidator;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.grading.port.GradingGateway;
import org.botai.back.media.SubmissionArtifactService;
import org.botai.back.media.port.ObjectStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.*;
import tools.jackson.databind.json.JsonMapper;

/** B2B v2 transport is isolated from the existing strict v1 gateway. */
@Component
public class HttpB2bGradingGateway implements B2bGradingGateway {
    private static final JsonMapper STRICT=JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    // The interservice task contract requires explicit reference_solution:null.
    private static final JsonMapper METADATA_JSON=JsonMapper.builder().build();
    private final String base,token;private final JsonCodec json;private final B2bConfig config;private final SubmissionStore store;private final ObjectStorage storage;private final SubmissionArtifactService artifacts;private final B2bAiResponseValidator validator;private final HttpClient client;
    private static final org.slf4j.Logger LOG=org.slf4j.LoggerFactory.getLogger(HttpB2bGradingGateway.class);
    private volatile boolean manualAvailable,gradeAnalysisAvailable;
    private volatile String lastCapabilityFailure;
    private volatile int advertisedConcurrency=1,availableRunRecords=1;
    String capabilityFailureCode(){return lastCapabilityFailure;}
    private final ExecutorService observerWorkers=Executors.newFixedThreadPool(4);
    private final Semaphore observerSlots=new Semaphore(4);
    @org.springframework.beans.factory.annotation.Autowired(required=false) private LocalDemoEvents events;
    @org.springframework.beans.factory.annotation.Autowired private SubmissionOrigins origins;
    @org.springframework.beans.factory.annotation.Autowired private org.springframework.transaction.support.TransactionTemplate transactions;
    public HttpB2bGradingGateway(@Value("${app.grading.base-url:}")String base,@Value("${app.grading.token:}")String token,JsonCodec json,B2bConfig config,SubmissionStore store,ObjectStorage storage,SubmissionArtifactService artifacts,ExpertReviewDocument document){this.base=base.replaceAll("/$","");this.token=token;this.json=json;this.config=config;this.store=store;this.storage=storage;this.artifacts=artifacts;validator=new B2bAiResponseValidator(json,document);System.setProperty("jdk.httpclient.disableRetryConnect","true");System.setProperty("jdk.httpclient.enableAllMethodRetry","false");client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();}
    public Map<Integer,GradingGateway.Capability> capabilities(){
        manualAvailable=false;gradeAnalysisAvailable=false;if(!config.enabled())return Map.of();
        String failure="transport_unavailable";
        try {var r=send(request("/internal/v2/grading/capabilities",10).GET().build(),10);if(r.status!=200)throw unavailable();failure="invalid_response_headers";requireHeader(single(r.headers,"Content-Type").split(";",2)[0].strip().equalsIgnoreCase("application/json"));failure="invalid_json";var n=STRICT.readTree(r.body);failure="invalid_capability_shape";var shape=n.deepCopy();if(shape.isObject())((tools.jackson.databind.node.ObjectNode)shape).remove(List.of("concurrency","available_run_records"));fields(shape,"contract_version","provider_mode","deadline_seconds","input_modes","live_calls_allowed","grade_analysis","max_solution_images","max_image_bytes","artifact_ttl_seconds","max_diagram_artifacts","max_artifact_bytes","tasks");
            int records=1;if(n.has("available_run_records")){var available=n.get("available_run_records");require(available.isIntegralNumber()&&available.canConvertToInt()&&available.asInt()>=0&&available.asInt()<=10000);records=available.asInt();}
            int capacity=1;if(n.has("concurrency")){var c=n.get("concurrency");require(c.isIntegralNumber()&&c.canConvertToInt()&&c.asInt()>=1&&c.asInt()<=8);capacity=c.asInt();}
            failure="invalid_contract";require(n.path("contract_version").asText().equals("photo-grade.v2")&&Set.of("mock","live").contains(n.path("provider_mode").asText())&&n.path("live_calls_allowed").isBoolean());
            // AI declares this duration as float; 360 and 360.0 have the same bounded meaning.
            failure="invalid_deadline_seconds";var deadline=n.get("deadline_seconds");require(deadline.isNumber()&&Double.isFinite(deadline.asDouble())&&deadline.asDouble()>0&&deadline.asDouble()<=360);
            failure="ai_live_calls_disabled";if(n.path("provider_mode").asText().equals("live")&&!n.get("live_calls_allowed").asBoolean())throw unavailable();
            failure="invalid_limits";require(n.path("max_solution_images").isIntegralNumber()&&n.path("max_solution_images").asInt()==4&&n.path("max_image_bytes").isIntegralNumber()&&n.path("max_image_bytes").asInt()==8388608&&n.path("artifact_ttl_seconds").isIntegralNumber()&&n.path("artifact_ttl_seconds").asInt()==1800&&n.path("max_diagram_artifacts").isIntegralNumber()&&n.path("max_diagram_artifacts").asInt()==8&&n.path("max_artifact_bytes").isIntegralNumber()&&n.path("max_artifact_bytes").asInt()==1048576);
            failure="invalid_grade_analysis";var gradeAnalysis=n.get("grade_analysis");fields(gradeAnalysis,"path","contract_version");require(gradeAnalysis.path("path").asText().equals("/internal/v2/grading/grade-analysis")&&gradeAnalysis.path("contract_version").asText().equals("expert-grading.v1"));gradeAnalysisAvailable=true;
            failure="invalid_input_modes";require(n.path("input_modes").isArray());Set<String> modes=new HashSet<>();for(var m:n.get("input_modes"))require(m.isString()&&Set.of("prepared","from-images").contains(m.asText())&&modes.add(m.asText()));require(modes.contains("prepared"));manualAvailable=modes.contains("from-images");failure="invalid_task_registry";require(n.path("tasks").isArray()&&n.get("tasks").size()==7);Map<Integer,GradingGateway.Capability> result=new HashMap<>();int[] maxima={2,3,2,2,3,4,4};Set<Integer> seen=new HashSet<>();for(var t:n.get("tasks")){fields(t,"task_number","max_score","supported","package_available","package_id","response_contract");require(t.path("task_number").isIntegralNumber());int num=t.path("task_number").asInt();require(num>=14&&num<=20&&seen.add(num)&&t.path("max_score").isIntegralNumber()&&t.get("max_score").asInt()==maxima[num-14]&&t.path("supported").isBoolean()&&t.path("package_available").isBoolean()&&t.path("response_contract").asText().equals("photo-grade.v2"));boolean supported=t.get("supported").asBoolean();require(!supported||t.get("package_available").asBoolean());require(t.get("package_id").isNull()||t.get("package_id").isString());String pkg=t.get("package_id").isNull()?null:t.get("package_id").asText();require(!supported||(pkg!=null&&!pkg.isBlank()&&pkg.length()<=80));result.put(num,new GradingGateway.Capability(num,maxima[num-14],supported,pkg,n.get("provider_mode").asText()));}advertisedConcurrency=capacity;availableRunRecords=records;lastCapabilityFailure=null;return Map.copyOf(result);
        }catch(Exception e){manualAvailable=false;gradeAnalysisAvailable=false;if(!Objects.equals(lastCapabilityFailure,failure))LOG.warn("B2B capability registry unavailable: {}",failure);lastCapabilityFailure=failure;return Map.of();}
    }
    public int concurrency(){return advertisedConcurrency;}
    public int availableRunRecords(){return availableRunRecords;}
    public boolean acknowledge(UUID runId){try{var response=send(request("/internal/v2/grading/runs/"+runId,3).DELETE().build(),3);return Set.of(200,204,404).contains(response.status);}catch(Exception error){return false;}}
    public boolean gradeAnalysisAvailable(){return gradeAnalysisAvailable;}
    public void requireManualAvailable(){if(!manualAvailable)throw new ApiException(503,"manual_input_unavailable","Распознавание условия временно недоступно");}
    public Validated grade(UUID run,UUID submission,long fence,TaskSnapshot task,List<GradingGateway.Image> images,String pinned,String expectedMode){
        if(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive())throw new IllegalStateException("AI IO must not run in a database transaction");
        config.requireEnabled();
        boolean manual=origins.requiresImagePreparation(submission);
        Map<String,Object> meta=new LinkedHashMap<>();meta.put("contract_version","photo-grade.v2");meta.put("task_version_id",task.taskVersionId().toString());meta.put("solution_image_ids",images.stream().map(i->i.id().toString()).toList());byte[] taskImage=null;
        if(manual){var input=origins.referenceImage(submission);meta.put("task_id",task.id().toString());meta.put("task_number",task.taskNumber());meta.put("task_image_id",input.get("id").toString());taskImage=storage.get(input.get("object_key").toString(),8388608);if(!org.botai.back.media.PdfLimits.hash(taskImage).equals(input.get("sha256")))throw new ApiException(503,"storage_unavailable","Исходное изображение временно недоступно");}else meta.put("task",AiResponseValidator.task(task));
        String boundary="botai-v2-"+UUID.randomUUID();byte[] body=multipart(boundary,meta,taskImage,images);
        var fresh=capabilities().get(task.taskNumber());if(fresh==null||!fresh.supported()||!Objects.equals(fresh.packageId(),pinned)||!Objects.equals(fresh.providerMode(),expectedMode))throw unavailable();config.requireProvider(fresh.providerMode());if(manual)requireManualAvailable();
        transactions.executeWithoutResult(t->{store.row(submission,null,true);if(!origins.valid(submission,true)||store.db().queryForObject("SELECT count(*) FROM grading_jobs WHERE submission_id=? AND run_id=? AND fencing_token=? AND state='dispatching' AND lease_until>clock_timestamp()",Integer.class,submission,run,fence)!=1)throw ApiException.notFound();if(events!=null)events.track(run,submission);});
        try {
            var r=send(request("/internal/v2/grading"+(manual?"/from-images":""),390).header("X-Request-ID",run.toString()).header("Content-Type","multipart/form-data; boundary="+boundary).POST(HttpRequest.BodyPublishers.ofByteArray(body)).build(),390);
            String mode=single(r.headers,"X-Grading-Provider-Mode"),pkg=single(r.headers,"X-Grading-Package-Id");requireHeader(single(r.headers,"X-Grading-Contract-Version").equals("photo-grade.v2")&&single(r.headers,"X-Request-ID").equals(run.toString())&&mode.equals(expectedMode)&&(pkg.equals(pinned)||(r.status!=200&&pkg.equals("none"))));
            if(r.status!=200){
                if(events!=null)try{var error=STRICT.readTree(r.body).path("error");events.recordHttpFailure(run,submission,error.path("details"));}catch(Exception ignored){/* Old or malformed errors keep their existing fallback; never expose raw body. */}
                throw new ApiException(502,"ai_error_"+r.status,"Проверка временно недоступна");
            }requireHeader(single(r.headers,"Content-Type").split(";",2)[0].strip().equalsIgnoreCase("application/json"));String rejection=null;var reject=r.headers.allValues("X-Grading-Rejection-Code");requireHeader(reject.size()<=1);if(!reject.isEmpty()){rejection=reject.getFirst();requireHeader(Set.of("other_task","multiple_tasks","unrelated","attack","unreadable").contains(rejection));}
            var raw=new GradingGateway.Response(r.body,mode,pkg,rejection);var parsed=validator.parse(raw,task,images,pinned,expectedMode,manual);var validated=validator.adapt(parsed,d->artifacts.createForSubmission(submission,run,fence,d.source(),d.crop(),d.alt()));return new Validated(raw,validated,parsed.task());
        }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(502,"unknown_after_dispatch","Результат проверки неизвестен. Начни новую проверку только вручную");}
    }
    @org.springframework.scheduling.annotation.Scheduled(fixedDelayString="${app.b2b.observer-poll-ms:2000}")
    public void reconcileObservers(){if(!config.enabled()||events==null||observerSlots.availablePermits()==0)return;try{for(var job:events.claimObservers()){if(!observerSlots.tryAcquire())break;observerWorkers.submit(()->{try{drainObserver(job);}finally{observerSlots.release();}});}}catch(Exception ignored){/* Durable jobs remain due after their short claim lease. */}}
    private void drainObserver(LocalDemoEvents.ObserverJob job){
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        try{
            if(!events.observerTarget(job))return;
            if(!origins.valid(job.submission(),false)){events.revokeObserver(job.run());return;}
            for(int page=0;page<6;page++){
                long remainingMillis=TimeUnit.NANOSECONDS.toMillis(deadline-System.nanoTime())-800;
                if(remainingMillis<1)return;
                long after=events.observerCursor(job.run());
                var request=request("/internal/v2/grading/runs/"+job.run()+"/events?after="+after+"&limit=100",3).timeout(Duration.ofMillis(remainingMillis)).GET().build();
                var response=sendMillis(request,remainingMillis);
                if(response.status!=200)return;
                requireHeader(single(response.headers,"Content-Type").split(";",2)[0].strip().equalsIgnoreCase("application/json"));
                if(!origins.valid(job.submission(),false)){events.revokeObserver(job.run());return;}
                boolean more=events.importPage(job.run(),job.submission(),response.body,deadline);
                if(!more){if(events.observedTerminal(job.run()))events.finishObserver(job.run());return;}
            }
        }catch(Exception ignored){/* No fabricated terminal fact: expiry is exposed as observer=incomplete. */}
    }
    @jakarta.annotation.PreDestroy public void stopObservers(){observerWorkers.shutdownNow();}
    private byte[] multipart(String boundary,Object metadata,byte[] task,List<GradingGateway.Image> images){try{var out=new ByteArrayOutputStream();out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n"+METADATA_JSON.writeValueAsString(metadata)+"\r\n").getBytes(StandardCharsets.UTF_8));if(task!=null)part(out,boundary,"task_image","task.jpg","image/jpeg",task);for(var i:images)part(out,boundary,"solution_images",i.id()+".jpg",i.mimeType(),i.bytes());out.write(("--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));return out.toByteArray();}catch(IOException e){throw new IllegalStateException(e);}}
    private static void part(OutputStream out,String b,String field,String name,String mime,byte[] bytes)throws IOException{out.write(("--"+b+"\r\nContent-Disposition: form-data; name=\""+field+"\"; filename=\""+name+"\"\r\nContent-Type: "+mime+"\r\n\r\n").getBytes(StandardCharsets.UTF_8));out.write(bytes);out.write("\r\n".getBytes(StandardCharsets.UTF_8));}
    private HttpRequest.Builder request(String path,int seconds){if(base.isBlank()||token.isBlank())throw unavailable();return HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofSeconds(seconds)).header("Authorization","Bearer "+token);}
    private record Reply(int status,HttpHeaders headers,String body) { }
    private Reply send(HttpRequest request,int seconds)throws Exception{return sendMillis(request,TimeUnit.SECONDS.toMillis(seconds));}
    private Reply sendMillis(HttpRequest request,long millis)throws Exception{long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(millis);var pending=client.sendAsync(request,HttpResponse.BodyHandlers.ofInputStream());HttpResponse<InputStream> r;try{r=pending.get(millis,TimeUnit.MILLISECONDS);}catch(Exception e){pending.cancel(true);throw e;}try(var stream=r.body();var reads=Executors.newVirtualThreadPerTaskExecutor()){var read=reads.submit(()->{byte[] bytes=stream.readNBytes(1048577);if(bytes.length>1048576)throw new IOException("Response limit");return StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();});try{return new Reply(r.statusCode(),r.headers(),read.get(Math.max(1,deadline-System.nanoTime()),TimeUnit.NANOSECONDS));}catch(Exception e){stream.close();read.cancel(true);throw e;}}}
    private static String single(HttpHeaders headers,String key){var values=headers.allValues(key);requireHeader(values.size()==1);return values.getFirst();}
    private static void requireHeader(boolean value){if(!value)throw new ApiException(502,"invalid_ai_headers","Не удалось подтвердить результат проверки");}
    private static void fields(JsonNode n,String...keys){require(n.isObject()&&n.size()==keys.length);for(String key:keys)require(n.has(key));}
    private static void require(boolean value){if(!value)throw new IllegalArgumentException();}
    private static ApiException unavailable(){return new ApiException(503,"grading_unavailable","Проверка временно недоступна");}
}
