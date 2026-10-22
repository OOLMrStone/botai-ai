package org.botai.back.media;

import org.botai.back.common.ApiException;
import org.botai.back.media.port.PdfRenderer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.net.http.*;
import java.io.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

@Component
public class HttpPdfRenderer implements PdfRenderer {
    private static final JsonMapper JSON=JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private final String base;
    private final Duration timeout;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).version(HttpClient.Version.HTTP_1_1).build();
    @org.springframework.beans.factory.annotation.Autowired
    public HttpPdfRenderer(@Value("${app.pdf.renderer-base-url:}") String base) { this(base,Duration.ofSeconds(55)); }
    HttpPdfRenderer(String base,Duration timeout) { this.base=base.replaceAll("/$", "");this.timeout=timeout; }
    public boolean available() { return !base.isBlank(); }
    public Rendered render(UUID id, byte[] original, String hash, int remaining) {
        if(!available()) throw error(503,"pdf_renderer_unavailable");
        if(original.length>PdfLimits.INPUT_BYTES || remaining<1 || remaining>PdfLimits.PAGES) throw error(422,"pdf_page_budget");
        long deadline=System.nanoTime()+timeout.toNanos();
        var request=HttpRequest.newBuilder(URI.create(base+"/internal/v1/pdf/render")).timeout(timeout)
            .header("Content-Type","application/pdf").header("X-Request-ID",id.toString()).header("X-Max-Pages",Integer.toString(remaining))
            .POST(HttpRequest.BodyPublishers.ofByteArray(original)).build();
        var pending=client.sendAsync(request,HttpResponse.BodyHandlers.ofInputStream());
        try {
            var response=pending.get(timeout.toNanos(),TimeUnit.NANOSECONDS);
            try(var input=response.body();var reader=Executors.newVirtualThreadPerTaskExecutor()) {
                if(response.statusCode()==200 && (!single(response.headers(),"Content-Type").split(";",2)[0].strip().equals("application/vnd.botai.pdf-pages") || !single(response.headers(),"X-Request-ID").equals(id.toString()))) throw error(502,"pdf_invalid_renderer_response");
                var read=reader.submit(()-> {
                    if(response.statusCode()==200)return decode(new DataInputStream(input),id,hash,remaining);
                    var body=input.readNBytes(PdfLimits.MANIFEST_BYTES+1);
                    if(body.length>PdfLimits.MANIFEST_BYTES)throw error(503,"pdf_renderer_unavailable");
                    JsonNode problem=JSON.readTree(body);String code=problem==null?"":problem.path("code").asText();
                    if(response.statusCode()==422 && Set.of("pdf_invalid","pdf_encrypted","pdf_active_content","pdf_page_budget","pdf_geometry").contains(code))throw error(422,code);
                    if(response.statusCode()==429)throw error(429,"pdf_busy");
                    if(code.equals("pdf_timeout"))throw error(503,code);
                    throw error(503,"pdf_renderer_unavailable");
                });
                try { return read.get(Math.max(1,deadline-System.nanoTime()),TimeUnit.NANOSECONDS); }
                catch(ExecutionException failed) { if(failed.getCause() instanceof ApiException e) throw e; throw error(502,"pdf_invalid_renderer_response"); }
                catch(Exception failed) { input.close(); read.cancel(true); throw error(503,"pdf_timeout"); }
            }
        } catch(ApiException problem) { throw problem; }
        catch(Exception unavailable) { pending.cancel(true); throw error(503,unavailable instanceof TimeoutException?"pdf_timeout":"pdf_renderer_unavailable"); }
    }
    private Rendered decode(DataInputStream input, UUID request, String hash, int remaining) throws IOException {
        int length=input.readInt(); require(length>0 && length<=PdfLimits.MANIFEST_BYTES);
        byte[] raw=input.readNBytes(length); require(raw.length==length);
        String utf8; try { utf8=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(raw)).toString(); } catch(java.nio.charset.CharacterCodingException invalid) { throw error(502,"pdf_invalid_renderer_response"); }
        JsonNode manifest=JSON.readTree(utf8); object(manifest,"contract_version","request_id","pdf_sha256","page_count","pages");
        for(String field:List.of("contract_version","request_id","pdf_sha256"))require(manifest.get(field).isTextual());
        require(manifest.path("contract_version").asText().equals("pdf-raster.v1") && manifest.path("request_id").asText().equals(request.toString()) && manifest.path("pdf_sha256").asText().equals(hash));
        require(manifest.get("page_count").isIntegralNumber() && manifest.get("page_count").canConvertToInt()); int count=manifest.get("page_count").asInt();
        require(count>=1 && count<=remaining && manifest.get("pages").isArray() && manifest.get("pages").size()==count);
        List<Page> pages=new ArrayList<>();
        for(int i=0;i<count;i++) {
            var page=manifest.get("pages").get(i); object(page,"page_number","width","height","size_bytes","sha256");
            for(String field:List.of("page_number","width","height","size_bytes")) require(page.get(field).isIntegralNumber() && page.get(field).canConvertToInt());
            int width=page.get("width").asInt(),height=page.get("height").asInt();
            require(page.get("page_number").asInt()==i+1 && width>0 && height>0 && width<=PdfLimits.PAGE_SIDE && height<=PdfLimits.PAGE_SIDE && (long)width*height<=PdfLimits.PAGE_PIXELS);
            int size=input.readInt(); require(size>0 && size<=PdfLimits.INPUT_BYTES && size==page.get("size_bytes").asInt());
            byte[] bytes=input.readNBytes(size); require(bytes.length==size && PdfLimits.hash(bytes).equals(page.get("sha256").asText()));
            pages.add(new Page(i+1,width,height,bytes));
        }
        require(input.read()==-1); return new Rendered("pdf-raster.v1",List.copyOf(pages));
    }
    private static void object(JsonNode node,String... fields) { require(node!=null && node.isObject() && node.size()==fields.length); for(String field:fields) require(node.has(field)); }
    private static String single(HttpHeaders headers,String name) { var values=headers.allValues(name); require(values.size()==1); return values.getFirst(); }
    private static void require(boolean value) { if(!value) throw error(502,"pdf_invalid_renderer_response"); }
    private static ApiException error(int status,String code) { return new ApiException(status,code,"Не удалось принять PDF решения"); }
}
