package org.botai.back.media.port;

import java.util.List;
import java.util.UUID;

public interface PdfRenderer {
    record Page(int number, int width, int height, byte[] bytes) { }
    record Rendered(String version, List<Page> pages) { }
    boolean available();
    Rendered render(UUID requestId, byte[] original, String sha256, int remainingPages);
}
