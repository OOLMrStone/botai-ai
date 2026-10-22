package org.botai.pdf;

import org.apache.pdfbox.io.IOUtils;
import org.apache.pdfbox.io.RandomAccessReadBufferedFile;
import org.apache.pdfbox.pdfparser.PDFParser;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.pdmodel.interactive.annotation.PDAnnotation;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import static org.botai.pdf.PdfFailure.require;

/** Only this disposable, secret-free child parses untrusted PDF bytes. */
public final class RenderWorker {
    public static void main(String[] arguments) {
        Path directory = Path.of(arguments[0]);
        try {
            render(directory, Integer.parseInt(arguments[1]), UUID.fromString(arguments[2]));
        } catch (Throwable failure) {
            String code = failure instanceof PdfFailure typed ? typed.code :
                failure instanceof org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException ? "pdf_encrypted" : "pdf_invalid";
            try { Files.writeString(directory.resolve("error"), code); } catch (IOException ignored) { }
            System.exit(1);
        }
    }

    static void render(Path directory, int budget, UUID requestId) throws Exception {
        Path input = directory.resolve("input.pdf");
        byte[] bytes = Files.readAllBytes(input);
        require(bytes.length > 12 && bytes.length <= 8 * 1024 * 1024, "pdf_invalid");
        require(new String(bytes, 0, 5, java.nio.charset.StandardCharsets.US_ASCII).equals("%PDF-"), "pdf_invalid");
        String tail = new String(bytes, Math.max(0, bytes.length - 1024), Math.min(1024, bytes.length), java.nio.charset.StandardCharsets.ISO_8859_1);
        require(tail.stripTrailing().endsWith("%%EOF"), "pdf_invalid");
        String inputHash = hash(bytes);
        bytes = null;
        try (var source = new RandomAccessReadBufferedFile(input);
             var document = new PDFParser(source, "", null, null, IOUtils.createTempFileOnlyStreamCache()).parse(false)) {
            int count = PdfPolicy.validate(document, budget);
            var renderer = new PDFRenderer(document);
            renderer.setSubsamplingAllowed(true);
            var records = new ArrayList<String>();
            long pixels = 0;
            for (int index = 0; index < count; index++) {
                var page = document.getPage(index);
                for (PDAnnotation annotation : page.getAnnotations()) {
                    if (("Ink".equals(annotation.getSubtype()) || "FreeText".equals(annotation.getSubtype()))
                        && annotation.getNormalAppearanceStream() == null) annotation.constructAppearances(document);
                }
                var image = renderer.renderImage(index, PdfPolicy.scale(page), ImageType.RGB);
                long area = (long)image.getWidth() * image.getHeight(); pixels += area;
                require(image.getWidth() <= 4096 && image.getHeight() <= 4096 && area <= 6000000 && pixels <= 24000000, "pdf_geometry");
                Path jpeg = directory.resolve("page-" + (index + 1) + ".jpg");
                var writer = ImageIO.getImageWritersByFormatName("JPEG").next();
                try (var output = ImageIO.createImageOutputStream(jpeg.toFile())) {
                    writer.setOutput(output);
                    var parameters = writer.getDefaultWriteParam();
                    parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT); parameters.setCompressionQuality(.92f);
                    writer.write(null, new javax.imageio.IIOImage(image, null, null), parameters);
                } finally { writer.dispose(); image.flush(); }
                long size = Files.size(jpeg); require(size > 0 && size <= 8 * 1024 * 1024, "pdf_invalid");
                records.add("{\"page_number\":" + (index + 1) + ",\"width\":" + image.getWidth() + ",\"height\":" + image.getHeight()
                    + ",\"size_bytes\":" + size + ",\"sha256\":\"" + hash(Files.readAllBytes(jpeg)) + "\"}");
            }
            String manifest = "{\"contract_version\":\"pdf-raster.v1\",\"request_id\":\"" + requestId + "\",\"pdf_sha256\":\"" + inputHash
                + "\",\"page_count\":" + count + ",\"pages\":[" + String.join(",", records) + "]}";
            byte[] metadata = manifest.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            require(metadata.length <= 16384, "pdf_invalid");
            try (var output = new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(directory.resolve("result"))))) {
                output.writeInt(metadata.length); output.write(metadata);
                for (int index = 1; index <= count; index++) {
                    Path jpeg = directory.resolve("page-" + index + ".jpg");
                    output.writeInt(Math.toIntExact(Files.size(jpeg))); Files.copy(jpeg, output);
                }
            }
        }
    }
    static String hash(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
}
