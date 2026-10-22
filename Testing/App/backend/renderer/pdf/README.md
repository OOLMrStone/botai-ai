# Isolated PDF raster renderer

Independent Java21 Gradle project; PDFBox 3.0.8 is absent from the Spring API classpath. The HTTP supervisor launches one secret-free JVM per PDF with a 256MiB heap. The entire request staging/parse/render deadline is 45s; a timed-out child is forcibly killed and reaped before the concurrency slot is released. No parser retry or partial response is emitted.

RPC is documented in `../../docs/integration/PDF-SUPPORT.md`: raw PDF 8MiB, reserved 1..4 pages, strict framed JSON/JPEG response. Strict PDF parsing rejects encrypted PDFs including empty passwords, active content/actions/XFA/attachments, invalid page trees and non-finite/excessive geometry. RGB JPEG rendering starts at 200DPI and adapts to 4096 side/6MP/page, 24MP total. Each decoded stream is capped at 32MiB and total decoded streams at 96MiB; PDFBox decoding itself remains inside the heap, tmpfs and hard deadline limits. Existing passive Ink/FreeText appearances are retained.

Run targeted tests separately from backend reports:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew -p renderer/pdf test --no-daemon --max-workers=2
```

Tests use actual child JVMs, including forced hang/kill/reap and subsequent successful request; encrypted, active, malformed/cyclic, page-budget, geometry and compressed-stream fixtures. Visual fixture outputs: `renderer/pdf/build/qa/passive-two-pages.pdf`, `page-1.jpg`, `page-2.jpg`. Page 1 includes red passive Ink and green FreeText; page 2 has 90° rotation. These generated fixtures are synthetic.

Local Compose service `pdf-renderer` has no secrets, host bind mounts or published port; read-only filesystem, `/tmp` 128MiB, 512MiB container memory, 1 CPU, 64 PID limit, dropped capabilities and `no-new-privileges`. Its sole network is Docker `internal` network `pdf`, shared only with the backend. This denies internet routing and published ingress; it does not isolate the renderer from its backend peer. The backend uses `APP_PDF_RENDERER_BASE_URL=http://pdf-renderer:8080`. Original PDF bytes are immutable private backend storage and never enter AI requests; this renderer produces raster previews, not a claim of PDF sanitization.

Dependency provenance: [PDFBox 3.0.8 download](https://pdfbox.apache.org/download.html), [official security guidance](https://pdfbox.apache.org/security.html), [3.0 parser/IO migration](https://pdfbox.apache.org/3.0/migration.html). Updates to PDFBox require sandbox tests and review.
