package org.botai.back.billing;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.botai.back.common.ApiProblems;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

/** Bounds bytes before JSON binding, including chunked requests. */
public final class BillingBodyFilter extends OncePerRequestFilter {
  private final ObjectMapper json;

  public BillingBodyFilter(ObjectMapper json) {
    this.json = json;
  }

  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    if (!request.getRequestURI().startsWith("/api/billing/")
        || !request.getMethod().equals("POST")) {
      chain.doFilter(request, response);
      return;
    }
    byte[] bytes = request.getInputStream().readNBytes(16385);
    if (bytes.length > 16384) {
      response.setStatus(413);
      response.setContentType("application/problem+json");
      json.writeValue(
          response.getOutputStream(),
          ApiProblems.of(413, "request_too_large", "Слишком большой запрос"));
      return;
    }
    chain.doFilter(
        new HttpServletRequestWrapper(request) {
          @Override
          public ServletInputStream getInputStream() {
            var input = new ByteArrayInputStream(bytes);
            return new ServletInputStream() {
              public int read() {
                return input.read();
              }

              public boolean isFinished() {
                return input.available() == 0;
              }

              public boolean isReady() {
                return true;
              }

              public void setReadListener(ReadListener listener) {
                throw new UnsupportedOperationException();
              }
            };
          }

          @Override
          public BufferedReader getReader() {
            return new BufferedReader(
                new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
          }
        },
        response);
  }
}
