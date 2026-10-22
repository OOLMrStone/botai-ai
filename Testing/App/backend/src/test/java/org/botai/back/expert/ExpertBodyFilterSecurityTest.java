package org.botai.back.expert;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.assertj.core.api.Assertions.*;

class ExpertBodyFilterSecurityTest {
    private final ExpertBodyFilter filter = new ExpertBodyFilter(JsonMapper.builder().build());

    @Test void oversizedChunkedBodyIsRejectedBeforeJsonBinding() throws Exception {
        var request = request("/api/expert/works/123/draft", " ".repeat(1049601), true);
        var response = new MockHttpServletResponse(); var downstream = new AtomicBoolean();
        filter.doFilter(request, response, (req, res) -> downstream.set(true));
        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(downstream).isFalse();
    }

    @Test void duplicateObjectKeysCannotSilentlyReplaceReviewFields() throws Exception {
        var request = request("/api/expert/works/123/draft", "{\"expectedRevision\":0,\"document\":{\"origin\":\"ai\",\"origin\":\"expert\"}}", false);
        var response = new MockHttpServletResponse(); var downstream = new AtomicBoolean();
        filter.doFilter(request, response, (req, res) -> downstream.set(true));
        assertThat(response.getStatus()).isEqualTo(400);
        assertThat(downstream).isFalse();
    }

    @Test void studentRoutingAlsoHasABeforeParseBodyBound() throws Exception {
        var request = request("/api/submissions/123/expert-review", " ".repeat(1049601), true);
        request.setMethod("POST");
        var response = new MockHttpServletResponse(); var downstream = new AtomicBoolean();
        filter.doFilter(request, response, (req, res) -> downstream.set(true));
        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(downstream).isFalse();
    }

    @Test void acceptedBodyIsAvailableUnmodifiedForControllerBinding() throws Exception {
        String payload = "{\"expectedRevision\":0,\"document\":{\"ocr\":{\"blocks\":[]},\"analysis\":{\"summary\":null}}}";
        var request = request("/api/expert/works/123/draft", payload, true);
        var response = new MockHttpServletResponse(); var downstream = new AtomicBoolean();
        filter.doFilter(request, response, (req, res) -> {
            assertThat(new String(((HttpServletRequest) req).getInputStream().readAllBytes(), StandardCharsets.UTF_8)).isEqualTo(payload);
            downstream.set(true);
        });
        assertThat(downstream).isTrue();
    }

    private MockHttpServletRequest request(String path, String payload, boolean chunked) {
        var request = new MockHttpServletRequest() {
            @Override public long getContentLengthLong() { return chunked ? -1 : super.getContentLengthLong(); }
            @Override public int getContentLength() { return chunked ? -1 : super.getContentLength(); }
        };
        request.setMethod("PUT"); request.setRequestURI(path); request.setContentType("application/json");
        request.setContent(payload.getBytes(StandardCharsets.UTF_8)); return request;
    }
}
