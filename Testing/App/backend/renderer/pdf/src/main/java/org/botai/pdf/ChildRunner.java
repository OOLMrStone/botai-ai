package org.botai.pdf;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

final class ChildRunner {
    private final String classpath;
    private final String mainClass;
    ChildRunner() { this(System.getProperty("java.class.path"), RenderWorker.class.getName()); }
    ChildRunner(String classpath, String mainClass) { this.classpath = classpath; this.mainClass = mainClass; }

    void run(Path directory, int maxPages, UUID id, long deadlineNanos) throws IOException, InterruptedException {
        long remaining = deadlineNanos - System.nanoTime();
        if (remaining <= 0) throw new PdfFailure("pdf_timeout");
        var builder = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
            "-Xmx256m", "-XX:MaxMetaspaceSize=64m", "-Djava.awt.headless=true", "-Djava.io.tmpdir=" + directory,
            "-cp", classpath, mainClass, directory.toString(), Integer.toString(maxPages), id.toString());
        builder.environment().clear(); builder.environment().put("LANG", "C.UTF-8");
        builder.directory(directory.toFile());
        builder.redirectOutput(ProcessBuilder.Redirect.DISCARD); builder.redirectError(ProcessBuilder.Redirect.DISCARD);
        Process child = builder.start();
        try {
            if (!child.waitFor(Math.max(1, deadlineNanos - System.nanoTime()), TimeUnit.NANOSECONDS)) throw new PdfFailure("pdf_timeout");
            if (child.exitValue() != 0) {
                Path error = directory.resolve("error");
                String code = Files.exists(error) && Files.size(error) <= 64 ? Files.readString(error) : "pdf_invalid";
                if (!Set.of("pdf_invalid", "pdf_encrypted", "pdf_active_content", "pdf_page_budget", "pdf_geometry").contains(code)) code = "pdf_invalid";
                throw new PdfFailure(code);
            }
        } finally {
            child.descendants().forEach(ProcessHandle::destroyForcibly);
            if (child.isAlive()) child.destroyForcibly();
            // A cancelled thread must still reap its child before releasing the slot.
            boolean interrupted = Thread.interrupted();
            while (child.isAlive()) {
                try { child.waitFor(); } catch (InterruptedException ignored) { interrupted = true; }
            }
            if (interrupted) Thread.currentThread().interrupt();
        }
    }
}
