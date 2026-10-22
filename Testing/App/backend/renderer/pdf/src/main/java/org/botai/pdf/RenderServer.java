package org.botai.pdf;

import com.sun.net.httpserver.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/** HTTP/framing supervisor. Untrusted parsing lives only in the disposable child. */
public final class RenderServer implements AutoCloseable {
    private static final long MAX_FRAME = 32L * 1024 * 1024 + 16384 + 20;
    private final HttpServer server;
    private final Semaphore slot = new Semaphore(1);
    private final ChildRunner runner;
    private final Duration timeout;
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor();
    private final ExecutorService http = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(4), new ThreadPoolExecutor.AbortPolicy());

    public static void main(String[] args) throws IOException { new RenderServer(8080, new ChildRunner(), Duration.ofSeconds(45)).start(); }
    RenderServer(int port, ChildRunner runner, Duration timeout) throws IOException {
        this.runner = runner; this.timeout = timeout;
        server = HttpServer.create(new InetSocketAddress(port), 16);
        server.setExecutor(http);
        server.createContext("/health", exchange -> {
            if (!exchange.getRequestURI().getPath().equals("/health") || !exchange.getRequestMethod().equals("GET")) { exchange.sendResponseHeaders(404, -1); exchange.close(); return; }
            exchange.sendResponseHeaders(200, 2); exchange.getResponseBody().write("ok".getBytes(StandardCharsets.US_ASCII)); exchange.close();
        });
        server.createContext("/internal/v1/pdf/render", this::handle);
    }
    void start() { server.start(); }
    int port() { return server.getAddress().getPort(); }

    private void handle(HttpExchange exchange) throws IOException {
        if (!exchange.getRequestURI().toString().equals("/internal/v1/pdf/render") || !exchange.getRequestMethod().equals("POST")) { exchange.sendResponseHeaders(404, -1); exchange.close(); return; }
        if (!slot.tryAcquire()) { error(exchange, 429, "pdf_busy"); return; }
        Path directory = null;
        long deadline = System.nanoTime() + timeout.toNanos();
        ScheduledFuture<?> inputTimeout = null;
        try {
            String idHeader = exchange.getRequestHeaders().getFirst("X-Request-ID");
            UUID id;
            int maxPages;
            try {
                id = UUID.fromString(idHeader);
                if (!id.toString().equals(idHeader)) throw new IllegalArgumentException();
                maxPages = Integer.parseInt(exchange.getRequestHeaders().getFirst("X-Max-Pages"));
            } catch (RuntimeException failure) { throw new PdfFailure("pdf_invalid"); }
            PdfFailure.require(maxPages >= 1 && maxPages <= 4 && "application/pdf".equals(exchange.getRequestHeaders().getFirst("Content-Type")), "pdf_invalid");
            directory = Files.createTempDirectory("pdf-render-", PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            // Closing a stalled inbound connection bounds upload/staging as well as parsing.
            inputTimeout = watchdog.schedule(exchange::close, Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
            try (var input = exchange.getRequestBody(); var output = Files.newOutputStream(directory.resolve("input.pdf"))) {
                byte[] buffer = new byte[16384]; int length; long total = 0;
                while ((length = input.read(buffer)) != -1) {
                    total += length;
                    PdfFailure.require(total <= 8 * 1024 * 1024 && System.nanoTime() < deadline, "pdf_invalid");
                    output.write(buffer, 0, length);
                }
            }
            inputTimeout.cancel(false); inputTimeout = null;
            runner.run(directory, maxPages, id, deadline);
            Path result = directory.resolve("result");
            PdfFailure.require(Files.isRegularFile(result) && Files.size(result) > 4 && Files.size(result) <= MAX_FRAME, "pdf_invalid");
            exchange.getResponseHeaders().set("Content-Type", "application/vnd.botai.pdf-pages");
            exchange.getResponseHeaders().set("X-Request-ID", id.toString());
            exchange.getResponseHeaders().set("Cache-Control", "no-store");
            exchange.sendResponseHeaders(200, Files.size(result));
            Files.copy(result, exchange.getResponseBody());
        } catch (PdfFailure failure) {
            error(exchange, failure.code.equals("pdf_timeout") ? 503 : 422, failure.code);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt(); error(exchange, 503, "pdf_renderer_unavailable");
        } catch (IOException failure) {
            error(exchange, 503, "pdf_renderer_unavailable");
        } finally {
            if (inputTimeout != null) inputTimeout.cancel(false);
            exchange.close();
            if (directory != null) {
                try (var paths = Files.walk(directory)) {
                    for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
                } finally { slot.release(); }
            } else slot.release();
        }
    }
    private static void error(HttpExchange exchange, int status, String code) throws IOException {
        byte[] bytes = ("{\"code\":\"" + code + "\"}").getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
    }
    @Override public void close() { server.stop(0); http.shutdownNow(); watchdog.shutdownNow(); }
}
