package org.botai.pdf;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.apache.pdfbox.cos.*;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.*;
import org.apache.pdfbox.pdmodel.encryption.*;
import org.apache.pdfbox.pdmodel.interactive.annotation.*;
import javax.imageio.ImageIO;
import java.awt.Color;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class RenderTest {
    @TempDir Path temporary;
    final UUID id = UUID.randomUUID();
    final HttpClient client = HttpClient.newHttpClient();

    @Test void actualChildProducesOrderedHashedJpegsAndPreservesVisibleAnnotations() throws Exception {
        Path directory = directory(fixture());
        new ChildRunner(System.getProperty("pdf.test.classpath"), RenderWorker.class.getName()).run(directory, 4, id, System.nanoTime()+TimeUnit.SECONDS.toNanos(45));
        try (var frame = new DataInputStream(Files.newInputStream(directory.resolve("result")))) {
            String manifest = new String(frame.readNBytes(frame.readInt()), java.nio.charset.StandardCharsets.UTF_8);
            assertTrue(manifest.contains("\"page_count\":2")); assertTrue(manifest.contains(RenderWorker.hash(Files.readAllBytes(directory.resolve("input.pdf")))));
            for (int number = 1; number <= 2; number++) {
                byte[] bytes = frame.readNBytes(frame.readInt());
                assertTrue(manifest.contains(RenderWorker.hash(bytes)));
                var image = ImageIO.read(new ByteArrayInputStream(bytes)); assertNotNull(image);
                assertTrue(image.getWidth() <= 4096 && image.getHeight() <= 4096 && (long)image.getWidth()*image.getHeight() <= 6000000);
                assertEquals(number == 2, image.getWidth() > image.getHeight());
                int ink = 0, freeText = 0;
                for (int y = 0; y < image.getHeight(); y++) for (int x = 0; x < image.getWidth(); x++) {
                    var pixel = new Color(image.getRGB(x,y));
                    if (pixel.getRed() > 140 && pixel.getGreen() < 100 && pixel.getBlue() < 100) ink++;
                    if (pixel.getGreen() > 70 && pixel.getGreen() > pixel.getRed()*1.5 && pixel.getBlue() < 100) freeText++;
                }
                if (number == 1) { assertTrue(ink > 1000, "Ink must be visibly preserved"); assertTrue(freeText > 500, "FreeText appearance must be visibly preserved"); }
                Path artifacts = Path.of("build/qa"); Files.createDirectories(artifacts);
                Files.write(artifacts.resolve("page-"+number+".jpg"), bytes);
            }
            assertEquals(-1, frame.read());
        }
        Files.copy(directory.resolve("input.pdf"), Path.of("build/qa/passive-two-pages.pdf"), StandardCopyOption.REPLACE_EXISTING);
    }

    @Test void rejectsEncryptionIncludingEmptyPasswordAndRestoresNextGoodRequest() throws Exception {
        for (String password : List.of("secret", "")) {
            try (var document = basic(1)) {
                document.protect(new StandardProtectionPolicy("owner-secret", password, new AccessPermission()));
                byte[] data = save(document);
                if(password.isEmpty()) artifact("encrypted-empty-password.pdf", data);
                assertCode(data, 4, "pdf_encrypted");
            }
        }
        RenderWorker.render(directory(fixture()), 4, id);
    }
    @Test void rejectsActiveActionsXfaAndAttachmentsInReferencedObjects() throws Exception {
        for (String key : List.of("JS", "AA", "OpenAction", "XFA", "EmbeddedFiles", "EF", "RichMediaContent")) {
            try (var document = basic(1)) {
                var unsafe = new COSDictionary(); unsafe.setString(COSName.getPDFName(key), "unsafe");
                document.getDocumentCatalog().getCOSObject().setItem(COSName.getPDFName("HiddenFixture"), unsafe);
                byte[] data = save(document);
                if(key.equals("JS")) artifact("unsafe-javascript.pdf", data);
                assertCode(data, 4, "pdf_active_content");
            }
        }
        try (var document = basic(1)) {
            var action = new COSDictionary(); action.setName(COSName.S, "Launch");
            document.getPage(0).getCOSObject().setItem(COSName.getPDFName("FixtureAction"), action);
            assertCode(save(document),4,"pdf_active_content");
        }
    }
    @Test void rejectsPageBudgetTruncationAndCyclicPageTree() throws Exception {
        try (var document = basic(2)) { assertCode(save(document),1,"pdf_page_budget"); }
        byte[] good = fixture(); assertCode(Arrays.copyOf(good, good.length - 32),4,"pdf_invalid");
        try (var document = basic(1)) {
            var root = document.getPages().getCOSObject();
            var children = new COSArray(); children.add(root); root.setItem(COSName.KIDS, children);
            byte[] invalid = save(document);
            assertCode(invalid,4,"pdf_invalid");
        }
    }
    @Test void finiteGeometryChecksRejectBombsAndAdaptiveRenderingIsBounded() throws Exception {
        for (String mutation : List.of("media", "crop", "reversed", "extra-coordinate", "unit", "rotation", "image")) {
            try (var document = basic(1)) {
                var page = document.getPage(0);
                switch(mutation) {
                    case "media" -> page.setMediaBox(new PDRectangle(1000000,1000000));
                    case "crop" -> page.setCropBox(new PDRectangle(-10,-10,900,900));
                    case "reversed" -> {var box=new COSArray(); for(int value:List.of(500,500,0,0))box.add(COSInteger.get(value));page.getCOSObject().setItem(COSName.MEDIA_BOX,box);}
                    case "extra-coordinate" -> {var box=new COSArray(); for(int value:List.of(0,0,500,500,600))box.add(COSInteger.get(value));page.getCOSObject().setItem(COSName.CROP_BOX,box);}
                    case "unit" -> page.setUserUnit(75001);
                    case "rotation" -> page.getCOSObject().setInt(COSName.ROTATE,45);
                    case "image" -> { var image = new COSDictionary(); image.setName(COSName.SUBTYPE,"Image"); image.setInt(COSName.WIDTH,100000); image.setInt(COSName.HEIGHT,100000); page.getCOSObject().setItem(COSName.getPDFName("Bomb"),image); }
                }
                assertCode(save(document),4,"pdf_geometry");
            }
        }
        try (var document = basic(1)) {
            document.getPage(0).setMediaBox(new PDRectangle(10000,10000));
            Path directory = directory(save(document)); RenderWorker.render(directory,4,id);
            var image = ImageIO.read(directory.resolve("page-1.jpg").toFile()); assertTrue((long)image.getWidth()*image.getHeight() <= 6000000);
        }
    }
    @Test void hardTimeoutKillsAndReapsChildThenAcceptsNextGoodRequest() throws Exception {
        Path directory = directory(fixture());
        var runner = new ChildRunner(System.getProperty("pdf.test.classpath"), HangingWorker.class.getName());
        PdfFailure error = assertThrows(PdfFailure.class, () -> runner.run(directory,4,id,System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(1000)));
        assertEquals("pdf_timeout",error.code);
        long pid = Long.parseLong(Files.readString(directory.resolve("pid")));
        assertFalse(ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false));
        new ChildRunner(System.getProperty("pdf.test.classpath"), RenderWorker.class.getName()).run(directory,4,id,System.nanoTime()+TimeUnit.SECONDS.toNanos(45));
        assertTrue(Files.exists(directory.resolve("result")));
    }
    @Test void rejectsCompressedStreamBombThenNextGoodChildSucceeds() throws Exception {
        try (var document = basic(1)) {
            var stream = new org.apache.pdfbox.pdmodel.common.PDStream(document);
            try(var output = stream.createOutputStream(COSName.FLATE_DECODE)) {
                byte[] repeated = new byte[1024 * 1024]; Arrays.fill(repeated,(byte)' ');
                for(int count = 0; count < 33; count++) output.write(repeated);
            }
            document.getPage(0).setContents(stream);
            byte[] bytes = save(document); assertTrue(bytes.length < 100000);
            assertCode(bytes,4,"pdf_invalid");
        }
        new ChildRunner(System.getProperty("pdf.test.classpath"),RenderWorker.class.getName()).run(directory(fixture()),4,id,System.nanoTime()+TimeUnit.SECONDS.toNanos(45));
    }
    @Test void httpProtocolRejectsConcurrentRequestsAndRecoversAfterTimeout() throws Exception {
        try (var service = new RenderServer(0, new ChildRunner(System.getProperty("pdf.test.classpath"), ConditionalWorker.class.getName()), Duration.ofMillis(1800))) {
            service.start();
            byte[] good = fixture();
            var first = client.sendAsync(request(service.port(), new byte[]{1}), HttpResponse.BodyHandlers.ofByteArray());
            Thread.sleep(500);
            var concurrent = client.send(request(service.port(),good),HttpResponse.BodyHandlers.ofByteArray()); assertEquals(429,concurrent.statusCode());
            var timeout = first.get(5,TimeUnit.SECONDS); assertEquals(503,timeout.statusCode()); assertTrue(new String(timeout.body()).contains("pdf_timeout"));
            var success = client.send(request(service.port(),good),HttpResponse.BodyHandlers.ofByteArray()); assertEquals(200,success.statusCode());
            assertEquals("application/vnd.botai.pdf-pages",success.headers().firstValue("Content-Type").orElseThrow());
            assertEquals(id.toString(),success.headers().firstValue("X-Request-ID").orElseThrow());
        }
    }
    @Test void stalledInboundBodyCannotBlockWatchdogOrNextGoodRequest() throws Exception {
        try (var service = new RenderServer(0,new ChildRunner(System.getProperty("pdf.test.classpath"),RenderWorker.class.getName()),Duration.ofMillis(1800));
             var socket = new java.net.Socket()) {
            service.start(); socket.connect(new java.net.InetSocketAddress("127.0.0.1",service.port()));socket.setSoTimeout(5000);
            String headers="POST /internal/v1/pdf/render HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/pdf\r\nX-Request-ID: "+id+"\r\nX-Max-Pages: 4\r\nContent-Length: 8388608\r\n\r\n%";
            socket.getOutputStream().write(headers.getBytes(java.nio.charset.StandardCharsets.US_ASCII));socket.getOutputStream().flush();
            assertEquals(-1,socket.getInputStream().read(),"Watchdog must close stalled upload without draining the unfinished body");
            var success=client.send(request(service.port(),fixture()),HttpResponse.BodyHandlers.ofByteArray());assertEquals(200,success.statusCode());
        }
    }
    HttpRequest request(int port,byte[] data) { return HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/internal/v1/pdf/render")).header("Content-Type","application/pdf").header("X-Request-ID",id.toString()).header("X-Max-Pages","4").POST(HttpRequest.BodyPublishers.ofByteArray(data)).build(); }
    void assertCode(byte[] data,int budget,String code) throws Exception { Path directory=directory(data); var error=assertThrows(PdfFailure.class,()->new ChildRunner(System.getProperty("pdf.test.classpath"),RenderWorker.class.getName()).run(directory,budget,id,System.nanoTime()+TimeUnit.SECONDS.toNanos(45))); assertEquals(code,error.code); }
    Path directory(byte[] bytes) throws IOException { Path directory=Files.createTempDirectory(temporary,"job-"); Files.write(directory.resolve("input.pdf"),bytes); return directory; }
    static PDDocument basic(int count) { var document=new PDDocument(); for(int i=0;i<count;i++)document.addPage(new PDPage(PDRectangle.A4)); return document; }
    static byte[] save(PDDocument document) throws IOException { var output=new ByteArrayOutputStream(); document.save(output); return output.toByteArray(); }
    static void artifact(String name,byte[] data) throws IOException { Path directory=Path.of("build/qa");Files.createDirectories(directory);Files.write(directory.resolve(name),data); }
    static byte[] fixture() throws Exception {
        try(var document=basic(2)) {
            var font=new PDType1Font(Standard14Fonts.FontName.HELVETICA);
            for(int index=0;index<2;index++) {
                var page=document.getPage(index); if(index==1)page.setRotation(90);
                try(var content=new PDPageContentStream(document,page)) {
                    content.beginText(); content.setFont(font,22); content.newLineAtOffset(50,760); content.showText("PDF solution - page "+(index+1)); content.endText();
                    content.beginText(); content.setFont(font,17); content.newLineAtOffset(50,700); content.showText("x + 2 = 5    =>    x = 3"); content.endText();
                    content.setStrokingColor(Color.BLUE); content.setLineWidth(3); content.moveTo(80,500);content.lineTo(300,500);content.lineTo(190,620);content.closePath();content.stroke();
                }
            }
            var page=document.getPage(0);
            for(String subtype:List.of("Ink","FreeText")) {
                var annotation=new PDAnnotationMarkup(); annotation.getCOSObject().setName(COSName.SUBTYPE,subtype); annotation.setRectangle(new PDRectangle(70,350,250,80));
                var appearance=new PDAppearanceStream(document); appearance.setBBox(new PDRectangle(250,80)); appearance.setResources(new PDResources());
                try(var content=new PDPageContentStream(document,appearance)) {
                    if(subtype.equals("Ink")) { content.setStrokingColor(Color.RED);content.setLineWidth(5);content.moveTo(10,60);content.lineTo(70,15);content.lineTo(140,70);content.lineTo(220,30);content.stroke(); }
                    else { content.setNonStrokingColor(new Color(0,150,0));content.beginText();content.setFont(font,20);content.newLineAtOffset(20,5);content.showText("Passive FreeText");content.endText(); }
                }
                var dictionary=new PDAppearanceDictionary();dictionary.setNormalAppearance(appearance);annotation.setAppearance(dictionary);page.getAnnotations().add(annotation);
            }
            return save(document);
        }
    }
    public static class HangingWorker { public static void main(String[] args) throws Exception { Files.writeString(Path.of(args[0],"pid"),Long.toString(ProcessHandle.current().pid())); Thread.sleep(120000); } }
    public static class ConditionalWorker { public static void main(String[] args) throws Exception { if(Files.size(Path.of(args[0],"input.pdf"))==1)HangingWorker.main(args);else RenderWorker.main(args); } }
}
