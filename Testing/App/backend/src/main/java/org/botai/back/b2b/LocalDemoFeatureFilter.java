package org.botai.back.b2b;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.botai.back.common.*;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Disabled local routes are absent, including before authentication and body parsing. */
@Component
@Order(-110)
@RequiredArgsConstructor
public class LocalDemoFeatureFilter extends OncePerRequestFilter {
    private final B2bConfig config;private final JsonCodec json;
    @Override protected boolean shouldNotFilter(HttpServletRequest request){return !request.getRequestURI().startsWith("/api/local-demo/")||(config.enabled()&&!(request.getMethod().equals("POST")&&request.getRequestURI().equals("/api/local-demo/runs/manual")&&(request.getHeader("X-XSRF-TOKEN")==null||request.getHeader("X-XSRF-TOKEN").isBlank())));}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws IOException{int status=config.enabled()?403:404;response.setStatus(status);response.setContentType("application/problem+json");response.setHeader("Cache-Control","private, no-store");response.getWriter().write(json.write(ApiProblems.of(status,status==404?"not_found":"forbidden",status==404?"Объект не найден":"Доступ запрещён")));}
}
