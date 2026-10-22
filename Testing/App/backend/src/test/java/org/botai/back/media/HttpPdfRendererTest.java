package org.botai.back.media;

import com.sun.net.httpserver.*;
import org.botai.back.common.ApiException;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import java.io.*;
import java.net.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;

class HttpPdfRendererTest {
    HttpServer server; HttpPdfRenderer renderer; UUID id=UUID.randomUUID(); byte[] pdf="%PDF-test-original".getBytes(),jpeg={1,2,3}; String hash=PdfLimits.hash(pdf);
    interface Handler {void handle(HttpExchange x)throws Exception;}
    @BeforeEach void setup()throws Exception {server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());server.start();renderer=new HttpPdfRenderer("http://127.0.0.1:"+server.getAddress().getPort(),Duration.ofSeconds(2));}
    @AfterEach void close(){server.stop(0);}
    void handler(Handler action){server.createContext("/internal/v1/pdf/render",x->{try{action.handle(x);}catch(Exception ignored){}finally{x.close();}});}
    byte[] frame(Object count,int number,int width,String pageHash,boolean trailing)throws Exception {var out=new ByteArrayOutputStream();var data=new DataOutputStream(out);byte[] manifest=JsonMapper.builder().build().writeValueAsBytes(Map.of("contract_version","pdf-raster.v1","request_id",id.toString(),"pdf_sha256",hash,"page_count",count,"pages",List.of(Map.of("page_number",number,"width",width,"height",2,"size_bytes",jpeg.length,"sha256",pageHash))));data.writeInt(manifest.length);data.write(manifest);data.writeInt(jpeg.length);data.write(jpeg);if(trailing)data.write(1);return out.toByteArray();}
    void send(HttpExchange x,byte[] frame)throws Exception {x.getResponseHeaders().set("Content-Type","application/vnd.botai.pdf-pages");x.getResponseHeaders().set("X-Request-ID",id.toString());x.sendResponseHeaders(200,frame.length);x.getResponseBody().write(frame);}
    void invalid(){assertThatThrownBy(()->renderer.render(id,pdf,hash,4)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("pdf_invalid_renderer_response");}
    @Test void sendsExactOriginalAndBudgetAndAcceptsOrderedFrame()throws Exception {handler(x->{assertThat(x.getRequestHeaders().getFirst("X-Max-Pages")).isEqualTo("3");assertThat(x.getRequestBody().readAllBytes()).isEqualTo(pdf);send(x,frame(1,1,2,PdfLimits.hash(jpeg),false));});var result=renderer.render(id,pdf,hash,3);assertThat(result.pages()).hasSize(1);assertThat(result.pages().getFirst().bytes()).isEqualTo(jpeg);}
    @Test void rejectsOverflowingCount(){handler(x->send(x,frame(new java.math.BigInteger("4294967297"),1,2,PdfLimits.hash(jpeg),false)));invalid();}
    @Test void rejectsPageOrder(){handler(x->send(x,frame(1,2,2,PdfLimits.hash(jpeg),false)));invalid();}
    @Test void rejectsDimensionsBeforeImageDecode(){handler(x->send(x,frame(1,1,4097,PdfLimits.hash(jpeg),false)));invalid();}
    @Test void rejectsTransportHash(){handler(x->send(x,frame(1,1,2,"forged",false)));invalid();}
    @Test void rejectsTrailingFrame(){handler(x->send(x,frame(1,1,2,PdfLimits.hash(jpeg),true)));invalid();}
    @Test void preservesKnownRendererRejection(){handler(x->{byte[] body="{\"code\":\"pdf_encrypted\"}".getBytes();x.sendResponseHeaders(422,body.length);x.getResponseBody().write(body);});assertThatThrownBy(()->renderer.render(id,pdf,hash,4)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("pdf_encrypted");}
    @Test void errorBodyStallHasTotalDeadline(){renderer=new HttpPdfRenderer("http://127.0.0.1:"+server.getAddress().getPort(),Duration.ofMillis(200));handler(x->{x.sendResponseHeaders(422,100);x.getResponseBody().write('{');x.getResponseBody().flush();Thread.sleep(2000);});long start=System.nanoTime();assertThatThrownBy(()->renderer.render(id,pdf,hash,4)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("pdf_timeout");assertThat(Duration.ofNanos(System.nanoTime()-start)).isLessThan(Duration.ofSeconds(1));}
    @Test void disabledRendererDoesNotDispatch(){assertThatThrownBy(()->new HttpPdfRenderer("").render(id,pdf,hash,4)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("pdf_renderer_unavailable");}
}
